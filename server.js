import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { ITEMS, PRISON, SPAWNS, SPAWN_YAW, WORLD, makeItemSlots } from './map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- Qaydalar ----
const MAX_POLICE = 3;
const MAX_FRIENDS = 5;
const GAME_SECONDS = 600;
const COUNTDOWN = Number(process.env.COUNTDOWN) || 10;
const RELEASE_SECONDS = Number(process.env.RELEASE_SECONDS) || 10; // dostu azad etmək üçün türmənin qarşısında dayanma müddəti
const CATCH_RANGE = 3.6;
const PICK_RANGE = 4.5;
const NEED = ITEMS.length; // 30

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
    isPublic: room.isPublic,
    phase: room.phase,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, jailed: p.jailed,
    })),
  };
}
function listRooms() {
  return [...rooms.values()]
    .filter((r) => r.isPublic)
    .map((r) => ({ code: r.code, name: r.name, count: r.players.size, max: r.max, phase: r.phase }));
}
const teamCount = (room, team) => [...room.players.values()].filter((p) => p.team === team).length;

function addToRoom(room, p) {
  // Komandanı oyunçu əlavə olunmazdan ƏVVƏL hesabla (yoxsa özünü də sayır)
  p.team = teamCount(room, 'friends') < MAX_FRIENDS ? 'friends' : 'police';
  room.players.set(p.id, p);
  p.room = room;
  p.jailed = false;
  p.picks = 0;
  p.catches = 0;
}

function leaveRoom(p) {
  const room = p.room;
  if (!room) return;
  room.players.delete(p.id);
  p.room = null;
  p.jailed = false;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === p.id) room.hostId = [...room.players.keys()][0];
  broadcast(room, { t: 'room', room: roomInfo(room) });
  if (room.phase === 'play' || room.phase === 'countdown') checkEnd(room);
}

function startGame(room) {
  // Ərzaqların yerləşdirilməsi
  const slots = shuffle(makeItemSlots());
  const chosen = [];
  for (const s of slots) {
    if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 1.8 || Math.abs(c.y - s.y) > 0.3)) chosen.push(s);
    if (chosen.length === NEED) break;
  }
  const names = shuffle([...Array(NEED).keys()]);
  room.items = new Map();
  const itemsOut = chosen.map((s, i) => {
    const it = { id: i, n: names[i], x: s.x, y: s.y, z: s.z, got: false };
    room.items.set(i, it);
    return { id: i, n: it.n, x: it.x, y: it.y, z: it.z };
  });

  // Başlanğıc nöqtələri
  let fi = 0, pi = 0;
  const out = [];
  for (const p of room.players.values()) {
    const sp = p.team === 'police' ? SPAWNS.police[pi++ % SPAWNS.police.length] : SPAWNS.friends[fi++ % SPAWNS.friends.length];
    p.x = sp[0]; p.z = sp[1]; p.y = 0;
    p.ry = SPAWN_YAW[p.team];
    p.jailed = false; p.picks = 0; p.catches = 0; p.catchCd = 0;
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
  broadcast(room, { t: 'start', items: itemsOut, players: out, cd: COUNTDOWN, dur: GAME_SECONDS, need: NEED });
  broadcast(room, { t: 'room', room: roomInfo(room) });
}

function endGame(room, winner, reason) {
  if (room.phase === 'lobby') return;
  const stats = [...room.players.values()].map((q) => ({
    id: q.id, name: q.name, team: q.team, picks: q.picks, catches: q.catches,
  }));
  room.phase = 'lobby';
  broadcast(room, { t: 'end', winner, reason, stats, collected: room.collected, need: NEED });
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
  target.jailedAt = Date.now();
  target.x = slot[0]; target.z = slot[1]; target.y = 0;
  target.ignoreUntil = Date.now() + 400;
  by.catches++;
  broadcast(room, { t: 'caught', id: target.id, by: by.id, name: target.name, byName: by.name, x: slot[0], z: slot[1] });
  checkEnd(room);
}

function freeOne(room) {
  const jailed = [...room.players.values()].filter((p) => p.jailed).sort((a, b) => a.jailedAt - b.jailedAt);
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
    arr.push([q.id, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +(q.ry || 0).toFixed(2), q.jailed ? 1 : 0]);
  }
  broadcast(room, {
    t: 's', ph: room.phase, cd: +room.cd.toFixed(1), tl: +room.timeLeft.toFixed(1),
    rp: +room.rp.toFixed(1), ra: room.ra ? 1 : 0, c: room.collected, p: arr,
  });
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
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
      p.name = cleanText(m.name, 'Oyunçu', 16);
      if (typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color)) p.color = m.color;
      if (p.room) broadcast(p.room, { t: 'room', room: roomInfo(p.room) });
      break;
    }
    case 'list':
      send(p.ws, { t: 'rooms', rooms: listRooms() });
      break;
    case 'create': {
      if (p.room) return;
      const room = {
        code: genCode(),
        name: cleanText(m.name, `${p.name} serveri`, 24),
        max: clamp(parseInt(m.max, 10) || 8, 2, MAX_POLICE + MAX_FRIENDS),
        isPublic: m.pub !== false,
        hostId: p.id,
        players: new Map(),
        phase: 'lobby',
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
      addToRoom(room, p);
      send(p.ws, { t: 'joined', room: roomInfo(room) });
      broadcast(room, { t: 'room', room: roomInfo(room) }, p.id);
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
      // Oyunçular istədikləri komandanı seçə bilərlər; komanda limiti yoxdur.
      p.team = team;
      broadcast(room, { t: 'room', room: roomInfo(room) });
      break;
    }
    case 'start': {
      const room = p.room;
      if (!room || room.hostId !== p.id || room.phase !== 'lobby') return;
      if (teamCount(room, 'friends') < 1) return send(p.ws, { t: 'error', msg: 'Ən azı 1 dost lazımdır' });
      startGame(room);
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
      y = clamp(y, 0, 3);
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
      if (Math.hypot(it.x - p.x, it.z - p.z) > PICK_RANGE) return;
      it.got = true;
      room.collected++;
      p.picks++;
      broadcast(room, { t: 'got', id: it.id, n: it.n, by: p.id, name: p.name, c: room.collected });
      if (room.collected >= NEED) endGame(room, 'friends', 'Bütün 30 ərzaq yığıldı!');
      break;
    }
    case 'catch': {
      const room = p.room;
      if (!room || room.phase !== 'play' || p.team !== 'police' || p.jailed) return;
      const now = Date.now();
      if (now < (p.catchCd || 0)) return;
      const t = room.players.get(m.id);
      if (!t || t.team !== 'friends' || t.jailed) return;
      if (Math.hypot(t.x - p.x, t.z - p.z) > CATCH_RANGE) return;
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
    x: 0, y: 0, z: 0, ry: 0, jailed: false, jailedAt: 0, picks: 0, catches: 0, ignoreUntil: 0, catchCd: 0, alive: true,
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
