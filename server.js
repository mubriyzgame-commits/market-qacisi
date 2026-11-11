import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { ITEMS, PRISON, SPAWNS, SPAWN_YAW, WORLD, MAPS, getMapItems, makeItemSlots } from './map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- Qaydalar ----
const DEFAULT_POLICE = 3;
const DEFAULT_FRIENDS = 5;
const MAX_PLAYERS = 15;
const GAME_SECONDS = 600;
const COUNTDOWN = Number(process.env.COUNTDOWN) || 10;
const RELEASE_SECONDS = Number(process.env.RELEASE_SECONDS) || 5; // dostu azad etmək üçün türmənin qarşısında dayanma müddəti
const CATCH_RANGE = 3.6;
const PICK_RANGE = 1.6;
const NEED = ITEMS.length; // 30 ərzaq

const app = express();
app.use('/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map();
const players = new Map();
let nextId = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cleanText = (s, def, max) => {
  const t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  return t || def;
};
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, exceptId = null) {
  const data = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(c)) return c;
  }
}

function roomInfo(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    max: room.max,
    policeMax: room.policeMax,
    friendsMax: room.friendsMax,
    mode: room.mode || 'market',
    isPublic: room.isPublic,
    map: room.map || 'market',
    phase: room.phase,
    vote: room.vote ? { yes: [...room.vote.yes], holdouts: room.vote.holdouts || [], deadline: room.vote.deadline || 0 } : null,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, jailed: p.jailed, adminJailed: !!p.adminJailed, admin: !!p.admin, adminEligible: !!p.adminEligible, invisible: !!p.invisible,
    })),
  };
}
function listRooms() {
  return [...rooms.values()]
    .filter((r) => r.isPublic)
    .map((r) => ({ code: r.code, name: r.name, count: r.players.size, max: r.max, phase: r.phase, map: r.map || 'market' }));
}
const teamCount = (room, team) => [...room.players.values()].filter((p) => p.team === team).length;

function addToRoom(room, p) {
  if (teamCount(room, 'friends') < room.friendsMax) p.team = 'friends';
  else p.team = 'police';
  room.players.set(p.id, p);
  p.room = room;
  // Admin oyunçu qoşulanda, adi server başçısını əvəz edir.
  const currentHost = room.players.get(room.hostId);
  if (!currentHost || (p.adminEligible && !currentHost.adminEligible)) room.hostId = p.id;
  p.jailed = false;
  p.adminJailed = false;
  p.picks = 0;
  p.catches = 0;
}

function leaveRoom(p) {
  const room = p.room;
  if (!room) return;
  room.players.delete(p.id);
  if (room.vote) { room.vote.yes.delete(p.id); room.vote.holdouts = (room.vote.holdouts || []).filter((id) => id !== p.id); }
  p.room = null;
  p.jailed = false;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === p.id) {
    const nextHost = [...room.players.values()].find((player) => player.adminEligible) || [...room.players.values()][0];
    room.hostId = nextHost?.id ?? null;
  }
  broadcast(room, { t: 'room', room: roomInfo(room) });
  if (room.phase === 'lobby' && room.vote) evaluateLobbyVote(room);
  if (room.phase === 'play' || room.phase === 'countdown') checkEnd(room);
}

function evaluateLobbyVote(room) {
  if (!room || room.phase !== 'lobby' || !room.vote) return;
  const remaining = [...room.players.values()].filter((player) => !room.vote.yes.has(player.id));
  if (remaining.length === 0) {
    if (teamCount(room, 'friends') < 1) {
      room.vote = null;
      broadcast(room, { t: 'system', msg: 'Başlamaq üçün ən azı 1 dost lazımdır.' });
      broadcast(room, { t: 'room', room: roomInfo(room) });
      return;
    }
    startGame(room);
    return;
  }
  if (remaining.length === 2 && !room.vote.deadline) {
    room.vote.holdouts = remaining.map((player) => player.id);
    room.vote.deadline = Date.now() + 15000;
    broadcast(room, { t: 'system', msg: '2 oyunçu razılıq verməyib. Onlara 15 saniyə vaxt verildi.' });
    broadcast(room, { t: 'room', room: roomInfo(room) });
  } else if (remaining.length !== 2 && room.vote.deadline) {
    room.vote.deadline = 0;
    room.vote.holdouts = [];
    broadcast(room, { t: 'system', msg: 'Səsvermə davam edir.' });
    broadcast(room, { t: 'room', room: roomInfo(room) });
  }
}

function finishLobbyVote(room) {
  if (!room || room.phase !== 'lobby' || !room.vote || !room.vote.deadline) return;
  const remaining = [...room.players.values()].filter((player) => !room.vote.yes.has(player.id));
  if (remaining.length !== 2) { evaluateLobbyVote(room); return; }
  for (const target of remaining) {
    send(target.ws, { t: 'kicked', msg: 'Səsvermədə 15 saniyə ərzində razılıq vermədin.' });
    leaveRoom(target);
  }
  room.vote = null;
  broadcast(room, { t: 'system', msg: 'Razılıq verməyən 2 oyunçu çıxarıldı. Oyun başlayır!' });
  if (room.players.size > 0 && teamCount(room, 'friends') > 0) startGame(room);
  else {
    broadcast(room, { t: 'system', msg: 'Oyun başlamaq üçün ən azı 1 dost və 1 oyunçu lazımdır.' });
    broadcast(room, { t: 'room', room: roomInfo(room) });
  }
}

function startGame(room) {
  room.vote = null;
  // Ərzaqların yerləşdirilməsi
  const catalog = getMapItems(room.map || 'market');
  const need = catalog.length;
  const slots = shuffle(makeItemSlots(room.map || 'market'));
  const chosen = [];
  for (const s of slots) {
    if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 1.8 || Math.abs(c.y - s.y) > 0.3)) chosen.push(s);
    if (chosen.length === need) break;
  }
  const names = shuffle([...Array(need).keys()]);
  room.items = new Map();
  const itemsOut = chosen.map((s, i) => {
    const it = { id: i, n: names[i], x: s.x, y: s.y, z: s.z, got: false };
    room.items.set(i, it);
    return { id: i, n: it.n, x: it.x, y: it.y, z: it.z };
  });

  // Başlanğıc nöqtələri
  let fi = 0, pi = 0;
  const out = [];
  const spawnSet = SPAWNS;
  for (const p of room.players.values()) {
    const sp = p.team === 'police' ? spawnSet.police[pi++ % spawnSet.police.length] : spawnSet.friends[fi++ % spawnSet.friends.length];
    p.x = sp[0]; p.z = sp[1]; p.y = 0;
    p.ry = SPAWN_YAW[p.team];
    p.jailed = false; p.adminJailed = false; p.picks = 0; p.catches = 0; p.catchCd = 0;
    p.ignoreUntil = Date.now() + 500;
    out.push({ id: p.id, team: p.team, x: p.x, z: p.z, ry: p.ry });
  }

  room.phase = 'countdown';
  room.cd = COUNTDOWN;
  room.timeLeft = GAME_SECONDS;
  room.collected = 0;
  room.rp = 0;
  room.ra = false;
  room.lastTick = Date.now();
  room.nextEventAt = Date.now() + 60000;
  room.activeEvents = {};
  broadcast(room, { t: 'start', map: room.map || 'market', catalog, items: itemsOut, players: out, cd: COUNTDOWN, dur: GAME_SECONDS, need });
  broadcast(room, { t: 'room', room: roomInfo(room) });
}

function endGame(room, winner, reason) {
  if (room.phase === 'lobby') return;
  const stats = [...room.players.values()].map((q) => ({
    id: q.id, name: q.name, team: q.team, picks: q.picks, catches: q.catches,
  }));
  room.phase = 'lobby';
  broadcast(room, { t: 'end', winner, reason, stats, collected: room.collected, need: getMapItems(room.map || 'market').length });
  for (const q of room.players.values()) q.jailed = false;
  broadcast(room, { t: 'room', room: roomInfo(room) });
}

function checkEnd(room) {
  if (room.phase !== 'play' && room.phase !== 'countdown') return;
  const friends = [...room.players.values()].filter((p) => p.team === 'friends');
  if (friends.length === 0) return endGame(room, 'police', 'Bütün dostlar oyundan çıxdı');
  if (friends.every((f) => f.jailed)) return endGame(room, 'police', 'Bütün dostlar tutuldu!');
}

function jail(room, target, by) {
  const idx = [...room.players.values()].filter((p) => p.jailed).length;
  const slot = PRISON.slots[idx % PRISON.slots.length];
  target.jailed = true;
  target.adminJailed = false;
  target.jailedAt = Date.now();
  target.x = slot[0]; target.z = slot[1]; target.y = 0;
  target.ignoreUntil = Date.now() + 400;
  by.catches++;
  broadcast(room, { t: 'caught', id: target.id, by: by.id, name: target.name, byName: by.name, x: slot[0], z: slot[1] });
  checkEnd(room);
}

function freeOne(room) {
  const jailed = [...room.players.values()].filter((p) => p.jailed && !p.adminJailed).sort((a, b) => a.jailedAt - b.jailedAt);
  const t = jailed[0];
  if (!t) return;
  t.jailed = false;
  t.x = PRISON.exit.x; t.z = PRISON.exit.z + (Math.random() - 0.5) * 2; t.y = 0;
  t.ignoreUntil = Date.now() + 400;
  broadcast(room, { t: 'freed', id: t.id, name: t.name, x: t.x, z: t.z });
}

function tickRoom(room, dt) {
  if (room.phase === 'countdown') {
    room.cd -= dt;
    if (room.cd <= 0) {
      room.cd = 0;
      room.phase = 'play';
      broadcast(room, { t: 'go' });
    }
  } else if (room.phase === 'play') {
    room.timeLeft -= dt;
    const now = Date.now();
    let eventExpired = false;
    for (const [eventName, endsAt] of Object.entries(room.activeEvents || {})) {
      if (now >= endsAt) {
        broadcast(room, { t: 'event', name: eventName, active: false });
        delete room.activeEvents[eventName];
        eventExpired = true;
      }
    }
    if (eventExpired && Object.keys(room.activeEvents || {}).length === 0) room.nextEventAt = now + 60000;
    if (Object.keys(room.activeEvents || {}).length === 0 && now >= room.nextEventAt) {
      const eventName = ['lights', 'speed', 'fog'][Math.floor(Math.random() * 3)];
      const duration = eventName === 'speed' ? 12000 : 60000;
      room.activeEvents[eventName] = now + duration;
      broadcast(room, { t: 'event', name: eventName, active: true, duration: duration / 1000 });
    }
    // Azad etmə məntiqi: azad dost türmənin qarşısındakı zonada dayanmalıdır
    const jailedCount = [...room.players.values()].filter((p) => p.jailed).length;
    const z = PRISON.zone;
    const occupied = [...room.players.values()].some(
      (p) => p.team === 'friends' && !p.jailed && Math.hypot(p.x - z.x, p.z - z.z) <= z.r,
    );
    room.ra = jailedCount > 0 && occupied;
    if (room.ra) {
      room.rp += dt;
      if (room.rp >= RELEASE_SECONDS) {
        room.rp = 0;
        freeOne(room);
      }
    } else {
      room.rp = 0;
    }
    if (room.timeLeft <= 0) {
      room.timeLeft = 0;
      return endGame(room, 'police', 'Vaxt bitdi, siyahı tamamlanmadı');
    }
  } else {
    return;
  }
  const arr = [];
  for (const q of room.players.values()) {
    arr.push([q.id, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +(q.ry || 0).toFixed(2), q.jailed ? 1 : 0, q.admin ? 1 : 0, q.invisible ? 1 : 0]);
  }
  broadcast(room, {
    t: 's', ph: room.phase, cd: +room.cd.toFixed(1), tl: +room.timeLeft.toFixed(1),
    rp: +room.rp.toFixed(1), ra: room.ra ? 1 : 0, c: room.collected, p: arr,
  });
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'lobby' && room.vote && room.vote.deadline && now >= room.vote.deadline) finishLobbyVote(room);
    if (room.phase === 'countdown' || room.phase === 'play') {
      const dt = Math.min(0.2, (now - room.lastTick) / 1000);
      room.lastTick = now;
      tickRoom(room, dt);
    }
  }
}, 50);

function handle(p, m) {
  switch (m.t) {
    case 'hello': {
      const rawName = String(m.name ?? '');
      p.adminEligible = rawName.includes('00_');
      const cleanName = cleanText(rawName.replace(/00_/g, '').trim(), 'Oyunçu', 16);
      p.name = p.adminEligible ? `👑 ${cleanName}` : cleanName;
      if (typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color)) p.color = m.color;
      if (p.room) {
        if (p.adminEligible) p.room.hostId = p.id;
        else if (p.room.hostId === p.id && !p.adminEligible) {
          const nextHost = [...p.room.players.values()].find((player) => player.id !== p.id && player.adminEligible);
          if (nextHost) p.room.hostId = nextHost.id;
        }
        broadcast(p.room, { t: 'room', room: roomInfo(p.room) });
      }
      break;
    }
    case 'list':
      send(p.ws, { t: 'rooms', rooms: listRooms() });
      break;
    case 'create': {
      if (p.room) return;
      const max = clamp(parseInt(m.max, 10) || 8, 2, MAX_PLAYERS);
      const mode = 'market';
      const defaultPolice = Math.min(DEFAULT_POLICE, max - 1);
      const requestedPolice = Number.parseInt(m.policeMax, 10);
      const policeMax = clamp(Number.isFinite(requestedPolice) ? requestedPolice : defaultPolice, 0, max - 1);
      const friendsMax = clamp(parseInt(m.friendsMax, 10) || Math.max(1, max - policeMax), 1, max);
      if (policeMax + friendsMax > max) return send(p.ws, { t: 'error', msg: 'Komanda limitlərinin cəmi maksimum oyunçu sayından çox ola bilməz' });
      const room = {
        code: genCode(),
        name: cleanText(m.name, `${p.name} serveri`, 24),
        max, policeMax, friendsMax,
        isPublic: m.pub !== false,
        map: mode, mode,
        hostId: p.id,
        players: new Map(),
        phase: 'lobby',
        vote: null,
        activeEvents: {},
        items: new Map(),
        cd: 0, timeLeft: 0, collected: 0, rp: 0, ra: false, lastTick: Date.now(),
      };
      rooms.set(room.code, room);
      addToRoom(room, p);
      send(p.ws, { t: 'joined', room: roomInfo(room) });
      break;
    }
    case 'join': {
      if (p.room) return;
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(p.ws, { t: 'error', msg: 'Belə server tapılmadı' });
      if (room.phase !== 'lobby') return send(p.ws, { t: 'error', msg: 'Oyun artıq başlayıb' });
      if (room.players.size >= room.max) return send(p.ws, { t: 'error', msg: 'Server doludur' });
      const hasFriendSlot = teamCount(room, 'friends') < room.friendsMax;
      const hasPoliceSlot = teamCount(room, 'police') < room.policeMax;
      if (!hasFriendSlot && !hasPoliceSlot) return send(p.ws, { t: 'error', msg: 'Komandaların yerləri doludur' });
      addToRoom(room, p);
      send(p.ws, { t: 'joined', room: roomInfo(room) });
      broadcast(room, { t: 'room', room: roomInfo(room) }, p.id);
      break;
    }
    case 'map': {
      const room = p.room;
      if (!room || room.hostId !== p.id || room.phase !== 'lobby') return;
      if (m.map !== 'market') return;
      room.mode = 'market'; room.map = 'market';
      broadcast(room, { t: 'room', room: roomInfo(room) });
      break;
    }
    case 'leave':
      leaveRoom(p);
      send(p.ws, { t: 'left' });
      break;
    case 'team': {
      const room = p.room;
      if (!room || room.phase !== 'lobby') return;
      const team = m.team === 'police' ? 'police' : 'friends';
      if (p.team === team) return;
      const limit = team === 'police' ? room.policeMax : room.friendsMax;
      if (teamCount(room, team) >= limit) return send(p.ws, { t: 'error', msg: 'Bu komanda doludur' });
      p.team = team;
      broadcast(room, { t: 'room', room: roomInfo(room) });
      break;
    }
    case 'teamLimits': {
      const room = p.room;
      if (!room || room.hostId !== p.id || room.phase !== 'lobby') return;
      const policeMax = Number(m.policeMax);
      const friendsMax = Number(m.friendsMax);
      if (!Number.isInteger(policeMax) || !Number.isInteger(friendsMax) ||
          policeMax < 0 || friendsMax < 1 || policeMax + friendsMax > room.max) {
        return send(p.ws, { t: 'error', msg: 'Komanda limitləri düzgün deyil.' });
      }
      if (teamCount(room, 'police') > policeMax || teamCount(room, 'friends') > friendsMax) {
        return send(p.ws, { t: 'error', msg: 'Əvvəlcə artıq oyunçular başqa komandaya keçsin.' });
      }
      room.policeMax = policeMax;
      room.friendsMax = friendsMax;
      broadcast(room, { t: 'room', room: roomInfo(room) });
      send(p.ws, { t: 'system', msg: 'Polis və dost limitləri yeniləndi.' });
      break;
    }
    case 'start': {
      const room = p.room;
      if (!room || room.hostId !== p.id || room.phase !== 'lobby') return;
      if (room.vote) return send(p.ws, { t: 'error', msg: 'Səsvermə artıq davam edir.' });
      if (teamCount(room, 'friends') < 1) return send(p.ws, { t: 'error', msg: 'Ən azı 1 dost lazımdır' });
      room.vote = { yes: new Set([p.id]), holdouts: [], deadline: 0 };
      broadcast(room, { t: 'system', msg: 'Oyun başlama səsverməsi başladı!' });
      evaluateLobbyVote(room);
      broadcast(room, { t: 'room', room: roomInfo(room) });
      break;
    }
    case 'voteYes': {
      const room = p.room;
      if (!room || room.phase !== 'lobby' || !room.vote) return;
      room.vote.yes.add(p.id);
      evaluateLobbyVote(room);
      if (room.phase === 'lobby') broadcast(room, { t: 'room', room: roomInfo(room) });
      break;
    }
    case 'admin': {
      if (!p.adminEligible) return;
      p.admin = !!m.enabled;
      p.invisible = p.admin && !!m.invisible;
      p.superJump = p.admin && !!m.superJump;
      p.adminSpeed = p.admin && !!m.speed;
      p.adminCatchRange = p.admin && !!m.catchRange;
      if (p.room) broadcast(p.room, { t: 'room', room: roomInfo(p.room) });
      break;
    }
    case 'controlEvent': {
      const room = p.room;
      if (!p.adminEligible || !p.admin || !room || room.phase !== 'play') return;
      if (m.name === 'stop') {
        for (const eventName of Object.keys(room.activeEvents || {})) {
          broadcast(room, { t: 'event', name: eventName, active: false });
        }
        room.activeEvents = {};
        room.nextEventAt = Date.now() + 60000;
        return;
      }
      if (!['lights', 'speed', 'fog'].includes(m.name)) return;
      room.activeEvents ||= {};
      if (room.activeEvents[m.name]) return;
      const duration = m.name === 'speed' ? 12000 : 60000;
      room.activeEvents[m.name] = Date.now() + duration;
      broadcast(room, { t: 'event', name: m.name, active: true, duration: duration / 1000 });
      break;
    }
    case 'kick': {
      const room = p.room;
      if (!p.adminEligible || !p.admin || !room) return;
      const target = room.players.get(Number(m.target));
      if (!target || target.id === p.id) return send(p.ws, { t: 'error', msg: 'Oyunçu seçimi yanlışdır' });
      // Kick bildirişi otaqdakı digər oyunçulara göstərilmir.
      // Yalnız çıxarılan oyunçuya neytral səbəb göndərilir.
      send(target.ws, { t: 'kicked', msg: 'Server xətası' });
      leaveRoom(target);
      break;
    }
    case 'adminJail': {
      const room = p.room;
      if (!p.adminEligible || !p.admin || !room || room.phase !== 'play') return;
      const target = room.players.get(Number(m.target));
      if (!target || target.id === p.id) return send(p.ws, { t: 'error', msg: 'Oyunçu seçimi yanlışdır' });
      if (m.enabled) {
        if (target.jailed) return;
        const slotIndex = [...room.players.values()].filter((q) => q.jailed).length;
        const slot = PRISON.slots[slotIndex % PRISON.slots.length];
        target.jailed = true; target.adminJailed = true; target.jailedAt = Date.now();
        target.x = slot[0]; target.z = slot[1]; target.y = 0;
        target.ignoreUntil = Date.now() + 400;
        broadcast(room, { t: 'caught', id: target.id, by: p.id, name: target.name, byName: p.name, x: slot[0], z: slot[1], admin: true });
      } else {
        if (!target.jailed) return send(p.ws, { t: 'error', msg: 'Bu oyunçu türmədə deyil' });
        target.jailed = false; target.adminJailed = false;
        target.x = PRISON.exit.x; target.z = PRISON.exit.z; target.y = 0;
        target.ignoreUntil = Date.now() + 400;
        broadcast(room, { t: 'freed', id: target.id, name: target.name, x: target.x, z: target.z, admin: true });
      }
      broadcast(room, { t: 'room', room: roomInfo(room) });
      break;
    }
    case 'announcement': {
      const room = p.room;
      if (!p.adminEligible || !p.admin || !room) return;
      const message = cleanText(String(m.message || '').trim(), '', 120);
      if (!message) return send(p.ws, { t: 'error', msg: 'Elan boş ola bilməz' });
      broadcast(room, { t: 'announcement', name: p.name, message });
      break;
    }
    case 'jumpscare': {
      const room = p.room;
      if (!p.adminEligible || !p.admin || !room) return;
      const target = room.players.get(Number(m.target));
      if (!target || target.id === p.id) return send(p.ws, { t: 'error', msg: 'Oyunçu seçimi yanlışdır' });
      send(target.ws, { t: 'jumpscare' });
      break;
    }
    case 'pos': {
      const room = p.room;
      if (!room || (room.phase !== 'play' && room.phase !== 'countdown')) return;
      if (Date.now() < p.ignoreUntil) return;
      let x = num(m.x), y = num(m.y), z = num(m.z);
      const ry = num(m.ry);
      if (x === null || y === null || z === null || ry === null) return;
      x = clamp(x, WORLD.minX, WORLD.maxX);
      z = clamp(z, WORLD.minZ, WORLD.maxZ);
      y = clamp(y, 0, p.admin && p.superJump ? 8 : 3);
      if (p.jailed) {
        x = clamp(x, PRISON.inner.minX, PRISON.inner.maxX);
        z = clamp(z, PRISON.inner.minZ, PRISON.inner.maxZ);
        y = 0;
      }
      p.x = x; p.y = y; p.z = z; p.ry = ry;
      break;
    }
    case 'pickup': {
      const room = p.room;
      if (!room || room.phase !== 'play' || p.team !== 'friends' || p.jailed) return;
      const it = room.items.get(m.id);
      if (!it || it.got) return;
      if (!(p.admin && p.adminCatchRange) && Math.hypot(it.x - p.x, it.z - p.z) > PICK_RANGE) return;
      it.got = true;
      room.collected++;
      p.picks++;
      broadcast(room, { t: 'got', id: it.id, n: it.n, by: p.id, name: p.name, c: room.collected });
      if (room.collected >= getMapItems(room.map || 'market').length) endGame(room, 'friends', 'Bütün əşyalar tapıldı!');
      break;
    }
    case 'catch': {
      const room = p.room;
      const adminCatch = !!(p.admin && p.adminCatchRange);
      if (!room || room.phase !== 'play' || (!adminCatch && p.team !== 'police') || p.jailed) return;
      const now = Date.now();
      if (now < (p.catchCd || 0)) return;
      const t = room.players.get(m.id);
      if (!t || t.id === p.id || t.jailed) return;
      if (!adminCatch && (t.team !== 'friends' || Math.hypot(t.x - p.x, t.z - p.z) > CATCH_RANGE)) return;
      p.catchCd = now + 700;
      jail(room, t, p);
      break;
    }
    case 'rtc': {
      const room = p.room;
      if (!room) return;
      const to = room.players.get(m.to);
      if (to) send(to.ws, { t: 'rtc', from: p.id, data: m.data });
      break;
    }
    case 'speak': {
      const room = p.room;
      if (!room) return;
      broadcast(room, { t: 'speak', id: p.id, on: !!m.on }, p.id);
      break;
    }
    default:
      break;
  }
}

wss.on('connection', (ws) => {
  const p = {
    id: nextId++, ws, name: 'Oyunçu', color: '#ffb400', room: null, team: 'friends',
    x: 0, y: 0, z: 0, ry: 0, jailed: false, jailedAt: 0, picks: 0, catches: 0, ignoreUntil: 0, catchCd: 0, admin: false, adminEligible: false, invisible: false, superJump: false, adminSpeed: false, alive: true,
  };
  players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id });
  ws.on('pong', () => { p.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(p, m); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => {
    leaveRoom(p);
    players.delete(p.id);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const p of players.values()) {
    if (!p.alive) { p.ws.terminate(); continue; }
    p.alive = false;
    try { p.ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Market Qaçışı serveri işləyir: http://localhost:${PORT}`);
});
