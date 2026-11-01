import * as THREE from 'three';
import {
  WORLD, PLAYER_R, ITEMS, SHELF, SHELVES, COUNTERS, TABLES, PILLARS, FRIDGE_WALL, PRISON,
  getColliders, resolveCollisions,
} from './map.js';

/* =====================================================================
   Köməkçilər
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/* =====================================================================
   Profil
   ===================================================================== */
const COLORS = ['#ff5a5f', '#ffb400', '#2ec4b6', '#4cc9f0', '#9b5de5', '#f15bb5', '#8ac926', '#ffffff'];
function loadProfile() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('mq_profile') || '{}'); } catch { /* ignore */ }
  return {
    name: p.name || ('Oyunçu' + Math.floor(100 + Math.random() * 900)),
    color: p.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    games: p.games || 0, wins: p.wins || 0, items: p.items || 0, caught: p.caught || 0,
  };
}
const profile = loadProfile();
function saveProfile() { try { localStorage.setItem('mq_profile', JSON.stringify(profile)); } catch { /* ignore */ } }
saveProfile();

/* =====================================================================
   Səs effektləri
   ===================================================================== */
let actx = null;
function ac() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur = 0.15, type = 'sine', vol = 0.15, delay = 0, slide = 0) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
}
const sfx = {
  click: () => tone(520, 0.06, 'triangle', 0.08),
  pick: () => { tone(660, 0.1, 'triangle', 0.16); tone(990, 0.16, 'triangle', 0.16, 0.08); },
  soft: () => tone(520, 0.08, 'sine', 0.06),
  caught: () => { for (let i = 0; i < 4; i++) tone(760, 0.14, 'square', 0.09, i * 0.17, -280); },
  free: () => { tone(440, 0.1, 'triangle', 0.16); tone(660, 0.1, 'triangle', 0.16, 0.1); tone(880, 0.22, 'triangle', 0.16, 0.2); },
  beep: () => tone(880, 0.12, 'square', 0.08),
  go: () => tone(1250, 0.45, 'square', 0.1),
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.16, i * 0.14)); },
  lose: () => { [440, 370, 311, 247].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.1, i * 0.18)); },
};
document.addEventListener('click', (e) => { if (e.target.closest('button')) sfx.click(); }, true);

/* =====================================================================
   Vəziyyət
   ===================================================================== */
let room = null;
let myId = null;
let inGame = false;
let gamePhase = 'lobby';
let timeLeft = 0, cdLeft = 0, collected = 0, relProg = 0, relActive = false, needCount = 30;
let lastCd = 99;
const me = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, team: 'friends', jailed: false, stamina: 100, exhausted: false, bob: 0, moving: false };
const remotes = new Map();   // id -> { av, x,y,z,ry, tx,ty,tz,try, j, has }
const spawnInfo = new Map(); // id -> {x,z,ry}
const itemsMap = new Map();  // id -> { id,n,x,y,z, group, mesh, label, glow, got }
const speaking = new Set();
const keys = {};
let showList = true;
let adminMode = false, adminHidden = false, adminSuperJump = false, adminSpeed = false;
let catchCd = 0;
let lastPosSent = 0;
let nearItem = null, nearFriend = null;

/* Admin paneli — Ctrl+0 */
const canUseAdmin = () => profile.name.includes('00_');
const adminPanel = document.createElement('div');
adminPanel.id = 'admin-panel';
adminPanel.className = 'hidden';
adminPanel.innerHTML = `
  <div class="admin-card">
    <div class="admin-head"><strong>👑 ADMIN PANEL</strong><button id="admin-close" type="button">✕</button></div>
    <p>Güc seçimlərini buradan dəyiş.</p>
    <button id="admin-hide" class="admin-option" type="button">👻 Görünməzlik: OFF</button>
    <button id="admin-jump" class="admin-option" type="button">🦘 Super jump: OFF</button>
    <button id="admin-speed" class="admin-option" type="button">⚡ Super sürət: OFF</button>
    <div class="admin-scare">
      <label for="admin-target">😈 Jumpscare üçün oyunçu</label>
      <select id="admin-target"><option value="">Oyunçu seç...</option></select>
      <button id="admin-jumpscare" class="admin-option scare-option" type="button">💀 JUMPSCARE GÖNDƏR</button>
    </div>
    <div class="admin-scare admin-mutes">
      <label>🔇 Səs idarəsi (yalnız sənin üçün)</label>
      <button id="admin-mute-all" class="admin-option" type="button">🔇 Hamını susdur: OFF</button>
      <select id="admin-mute-target"><option value="">Oyunçu seç...</option></select>
      <button id="admin-mute-player" class="admin-option" type="button">🔇 Bu oyunçunu susdur</button>
    </div>
    <div class="admin-note">Panel: Ctrl + 0</div>
  </div>`;
document.body.appendChild(adminPanel);

// Ayrı səs paneli — bütün oyunçular üçün, yalnız bu brauzerdə səsi idarə edir.
const soundPanel = document.createElement('div');
soundPanel.id = 'sound-panel';
soundPanel.innerHTML = `
  <button id="sound-panel-toggle" type="button">🔊 Səs idarəsi</button>
  <div id="sound-panel-card" class="hidden">
    <div class="sound-panel-head"><strong>🔇 Səs idarəsi</strong><button id="sound-panel-close" type="button">✕</button></div>
    <p>Bu seçimlər yalnız səndə səsi dəyişir.</p>
    <button id="sound-mute-all" class="admin-option" type="button">🔇 Hamını susdur: OFF</button>
    <label for="sound-mute-target">Oyunçu seç</label>
    <select id="sound-mute-target"><option value="">Oyunçu seç...</option></select>
    <button id="sound-mute-player" class="admin-option" type="button">🔇 Bu oyunçunu susdur</button>
  </div>`;
document.body.appendChild(soundPanel);
function updateSoundPanel() {
  const target = $('#sound-mute-target');
  if (!target) return;
  const selected = target.value;
  target.innerHTML = '<option value="">Oyunçu seç...</option>' + (room?.players || [])
    .filter((p) => p.id !== myId)
    .map((p) => `<option value="${p.id}">${esc(p.name)}${rtc.mutedPlayers.has(p.id) ? ' — SUSDURULUB' : ''}</option>`).join('');
  if ((room?.players || []).some((p) => String(p.id) === selected && p.id !== myId)) target.value = selected;
  $('#sound-mute-all').textContent = `🔇 Hamını susdur: ${rtc.muteAll ? 'ON' : 'OFF'}`;
  $('#sound-mute-all').classList.toggle('enabled', rtc.muteAll);
  const id = Number(target.value);
  $('#sound-mute-player').textContent = id && rtc.mutedPlayers.has(id) ? '🔊 Bu oyunçunun səsini aç' : '🔇 Bu oyunçunu susdur';
}
$('#sound-panel-toggle').addEventListener('click', () => $('#sound-panel-card').classList.toggle('hidden'));
$('#sound-panel-close').addEventListener('click', () => $('#sound-panel-card').classList.add('hidden'));
$('#sound-mute-all').addEventListener('click', () => {
  rtc.muteAll = !rtc.muteAll;
  updateSoundPanel();
  updateAdminPanel();
  updateSoundPanel();
  updateVoiceVolumes();
  toast(rtc.muteAll ? 'Hamının səsi yalnız səndə susduruldu' : 'Hamının səsi yenidən açıldı');
});
$('#sound-mute-player').addEventListener('click', () => {
  const target = Number($('#sound-mute-target').value);
  if (!target) return toast('Əvvəl oyunçu seç', true);
  if (rtc.mutedPlayers.has(target)) {
    rtc.mutedPlayers.delete(target);
    toast('Oyunçunun səsi yalnız səndə açıldı');
  } else {
    rtc.mutedPlayers.add(target);
    toast('Oyunçu yalnız səndə susduruldu');
  }
  updateSoundPanel();
  updateAdminPanel();
  updateVoiceVolumes();
});
function updateAdminPanel() {
  $('#admin-hide').textContent = `👻 Görünməzlik: ${adminHidden ? 'ON' : 'OFF'}`;
  $('#admin-jump').textContent = `🦘 Super jump: ${adminSuperJump ? 'ON' : 'OFF'}`;
  $('#admin-speed').textContent = `⚡ Super sürət: ${adminSpeed ? 'ON' : 'OFF'}`;
  $('#admin-hide').classList.toggle('enabled', adminHidden);
  $('#admin-jump').classList.toggle('enabled', adminSuperJump);
  $('#admin-speed').classList.toggle('enabled', adminSpeed);
  const target = $('#admin-target');
  if (target) {
    const selected = target.value;
    target.innerHTML = '<option value="">Oyunçu seç...</option>' + (room?.players || [])
      .filter((p) => p.id !== myId)
      .map((p) => `<option value="${p.id}">${esc(p.name)} (${p.team === 'police' ? 'Polis' : 'Dost'})</option>`).join('');
    if ((room?.players || []).some((p) => String(p.id) === selected && p.id !== myId)) target.value = selected;
  }
  const muteTarget = $('#admin-mute-target');
  if (muteTarget) {
    const muteSelected = muteTarget.value;
    muteTarget.innerHTML = '<option value="">Oyunçu seç...</option>' + (room?.players || [])
      .filter((p) => p.id !== myId)
      .map((p) => `<option value="${p.id}">${esc(p.name)}${rtc.mutedPlayers.has(p.id) ? ' — SUSDURULUB' : ''}</option>`).join('');
    if ((room?.players || []).some((p) => String(p.id) === muteSelected && p.id !== myId)) muteTarget.value = muteSelected;
  }
  const allBtn = $('#admin-mute-all');
  if (allBtn) {
    allBtn.textContent = `🔇 Hamını susdur: ${rtc.muteAll ? 'ON' : 'OFF'}`;
    allBtn.classList.toggle('enabled', rtc.muteAll);
  }
  const playerBtn = $('#admin-mute-player');
  if (playerBtn) {
    const id = Number(muteTarget?.value);
    playerBtn.textContent = id && rtc.mutedPlayers.has(id) ? '🔊 Bu oyunçunun səsini aç' : '🔇 Bu oyunçunu susdur';
  }
}
function sendAdminState() {
  send({ t: 'admin', enabled: adminMode, invisible: adminHidden, superJump: adminSuperJump, speed: adminSpeed });
  updateAdminPanel();
}
$('#admin-close').addEventListener('click', () => adminPanel.classList.add('hidden'));
$('#admin-hide').addEventListener('click', () => { adminHidden = !adminHidden; sendAdminState(); });
$('#admin-jump').addEventListener('click', () => { adminSuperJump = !adminSuperJump; sendAdminState(); });
$('#admin-speed').addEventListener('click', () => { adminSpeed = !adminSpeed; sendAdminState(); });
$('#admin-jumpscare').addEventListener('click', () => {
  const target = Number($('#admin-target').value);
  if (!target) return toast('Əvvəl oyunçu seç', true);
  send({ t: 'jumpscare', target });
  toast('Jumpscare göndərildi!');
});
$('#admin-mute-all').addEventListener('click', toggleMuteAll);
$('#admin-mute-player').addEventListener('click', () => {
  const target = Number($('#admin-mute-target').value);
  if (!target) return toast('Əvvəl oyunçu seç', true);
  if (rtc.mutedPlayers.has(target)) {
    rtc.mutedPlayers.delete(target);
    toast('Oyunçunun səsi yalnız səndə açıldı');
  } else {
    rtc.mutedPlayers.add(target);
    toast('Oyunçu yalnız səndə susduruldu');
  }
  updateAdminPanel();
  updateVoiceVolumes();
});

/* =====================================================================
   Şəbəkə
   ===================================================================== */
let ws = null;
let wsOpen = false;
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const connectTimer = setTimeout(() => {
    if (!wsOpen) {
      $('#loading').classList.add('hidden');
      $('#conn-state').textContent = 'yenidən qoşulur';
      toast('Serverə qoşulmaq alınmadı. Yenidən yoxlanılır…', true);
    }
  }, 10000);
  ws.onopen = () => {
    clearTimeout(connectTimer);
    wsOpen = true;
    $('#conn-state').textContent = 'qoşuldu';
    $('#loading').classList.add('hidden');
    send({ t: 'hello', name: profile.name, color: profile.color });
  };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    onMsg(m);
  };
  ws.onclose = () => {
    const was = wsOpen;
    wsOpen = false;
    $('#conn-state').textContent = 'kəsildi';
    if (was) toast('Serverlə bağlantı kəsildi', true);
    resetToMenu();
    setTimeout(connect, 2000);
  };
  ws.onerror = () => {};
}

function onMsg(m) {
  switch (m.t) {
    case 'welcome': myId = m.id; break;
    case 'rooms': renderServerList(m.rooms); break;
    case 'joined': room = m.room; showScreen('lobby'); onRoomUpdate(); break;
    case 'room': if (room) { room = m.room; onRoomUpdate(); } break;
    case 'left': break;
    case 'error': toast(m.msg, true); break;
    case 'start': startGame(m); break;
    case 's': applyState(m); break;
    case 'go': flash('BAŞLA!', '#fff'); sfx.go(); break;
    case 'got': onGot(m); break;
    case 'caught': onCaught(m); break;
    case 'freed': onFreed(m); break;
    case 'end': onEnd(m); break;
    case 'rtc': onRtc(m); break;
    case 'speak': if (m.on) speaking.add(m.id); else speaking.delete(m.id); updateSpeakingUI(); break;
    case 'jumpscare': showJumpscare(); break;
    default: break;
  }
}

/* =====================================================================
   3D səhnə
   ===================================================================== */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c12);
scene.fog = new THREE.Fog(0x0a0c12, 22, 85);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 160);
camera.rotation.order = 'YXZ';

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// İşıqlar
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x4a4f66, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(-10, 30, 14);
scene.add(sun);

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function textSprite(text, { color = '#fff', bg = 'rgba(0,0,0,0.55)', font = 52, depthTest = true, height = 0.3 } = {}) {
  const w = 512, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = `bold ${font}px 'Trebuchet MS', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (bg) { g.fillStyle = bg; rr(g, 6, 14, w - 12, h - 28, 28); g.fill(); }
  g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 3);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest, depthWrite: false }));
  s.scale.set(height * (w / h), height, 1);
  s.renderOrder = 10;
  return s;
}
function checkerTexture(a, b, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size * 2;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, size * 2, size * 2);
  g.fillStyle = b; g.fillRect(0, 0, size, size); g.fillRect(size, size, size, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = glowTexture();

const matCache = {};
const L = (c) => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));
const world = new THREE.Group(); scene.add(world);
function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), L(color));
  m.position.set(x, y, z); world.add(m); return m;
}
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let zoneRing = null, zoneDisc = null;
function buildWorld() {
  const W = WORLD.maxX - WORLD.minX, D = WORLD.maxZ - WORLD.minZ;
  // Döşəmə
  const ft = checkerTexture('#cfd6e4', '#b3bccf'); ft.repeat.set(W / 4, D / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: ft }));
  floor.rotation.x = -Math.PI / 2; world.add(floor);
  // Divarlar
  box(W + 1.2, 5, 0.6, 0x34415e, 0, 2.5, WORLD.minZ - 0.3);
  box(W + 1.2, 5, 0.6, 0x34415e, 0, 2.5, WORLD.maxZ + 0.3);
  box(0.6, 5, D, 0x34415e, WORLD.minX - 0.3, 2.5, 0);
  box(0.6, 5, D, 0x34415e, WORLD.maxX + 0.3, 2.5, 0);
  // Divar zolağı
  box(W, 0.35, 0.1, 0xff7a1a, 0, 1.3, WORLD.maxZ - 0.05);
  box(0.1, 0.35, D, 0xff7a1a, WORLD.minX + 0.05, 1.3, 0);
  box(0.1, 0.35, D, 0xff7a1a, WORLD.maxX - 0.05, 1.3, 0);
  // Tavan (yalnız aşağıdan görünür)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), L(0x222a3d));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 4.6; world.add(ceil);
  // Tavan işıq panelləri
  const pg = new THREE.BoxGeometry(2.6, 0.06, 0.7);
  const pm = new THREE.MeshBasicMaterial({ color: 0xf5fbff });
  const pxs = [-28, -14, 0, 14, 28], pzs = [-20, -10, 0, 10, 20];
  const panels = new THREE.InstancedMesh(pg, pm, pxs.length * pzs.length);
  const dum = new THREE.Object3D(); let pi = 0;
  for (const x of pxs) for (const z of pzs) { dum.position.set(x, 4.55, z); dum.updateMatrix(); panels.setMatrixAt(pi++, dum.matrix); }
  world.add(panels);

  // Giriş işarəsi
  const entry = textSprite('GİRİŞ', { color: '#7dffb0', bg: 'rgba(0,0,0,.6)', height: 0.7 });
  entry.position.set(WORLD.minX + 1, 3.6, 0); world.add(entry);

  // Rəflər
  const frameMat = L(0x3c4a6b), boardMat = L(0xb9c3d9);
  const rnd = mulberry(1234);
  const prod = [];
  const palette = ['#e63946', '#f1c453', '#2a9d8f', '#457b9d', '#f4a261', '#9aa5bd', '#f5f5f5', '#9b5de5', '#06d6a0', '#ef476f', '#ff9f1c'];
  for (const s of SHELVES) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
    const div = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, 0.06), frameMat); div.position.y = s.h / 2; g.add(div);
    for (const ex of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.08, s.h, s.d), frameMat); up.position.set(ex * s.w / 2, s.h / 2, 0); g.add(up);
    }
    for (const by of [...SHELF.boards, s.h]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.06, s.d), boardMat); b.position.y = by; g.add(b);
    }
    world.add(g);
    for (const side of [-1, 1]) for (const by of SHELF.boards) {
      for (let x = -s.w / 2 + 0.35; x < s.w / 2 - 0.3; x += 0.42) {
        const h = 0.22 + rnd() * 0.25;
        prod.push({ x: s.x + x, y: by + 0.03 + h / 2, z: s.z + side * (0.28 + rnd() * 0.22), w: 0.3 + rnd() * 0.08, h, d: 0.28, c: palette[Math.floor(rnd() * palette.length)] });
      }
    }
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), prod.length);
  const col = new THREE.Color();
  prod.forEach((p, i) => {
    dum.position.set(p.x, p.y, p.z); dum.scale.set(p.w, p.h, p.d); dum.rotation.set(0, 0, 0); dum.updateMatrix();
    inst.setMatrixAt(i, dum.matrix); inst.setColorAt(i, col.set(p.c));
  });
  inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
  world.add(inst);

  // Kassalar
  for (const c of COUNTERS) {
    box(c.w, c.h, c.d, 0x6b7a99, c.x, c.h / 2, c.z);
    box(c.w, 0.06, c.d + 0.1, 0xff7a1a, c.x, c.h + 0.03, c.z);
    box(0.5, 0.45, 0.4, 0x222222, c.x + 1.4, c.h + 0.3, c.z);
  }
  // Meyvə masaları
  const fruit = ['#e63946', '#ffb703', '#8ac926', '#ff8c00'];
  TABLES.forEach((t, ti) => {
    box(t.w, t.h, t.d, 0x8a5a33, t.x, t.h / 2, t.z);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), L(fruit[(i + ti) % fruit.length]));
      m.position.set(t.x - t.w / 2 + 0.5 + i * (t.w - 1) / 8, t.h + 0.18, t.z + (i % 2 ? 0.4 : -0.4)); world.add(m);
    }
  });
  // Sütunlar
  for (const p of PILLARS) box(p.s, 4.6, p.s, 0x56627f, p.x, 2.3, p.z);
  // Soyuducu divar
  box(W, FRIDGE_WALL.h, FRIDGE_WALL.d, 0x2c3650, 0, FRIDGE_WALL.h / 2, FRIDGE_WALL.z);
  const glass = new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.55 });
  for (let x = -32; x <= 32; x += 4) {
    const gm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.9, 0.05), glass);
    gm.position.set(x, 1.2, FRIDGE_WALL.z + FRIDGE_WALL.d / 2 + 0.03); world.add(gm);
  }

  // Türmə
  const pb = PRISON.box, cx = (pb.minX + pb.maxX) / 2, cz = (pb.minZ + pb.maxZ) / 2;
  const pw = pb.maxX - pb.minX, pd = pb.maxZ - pb.minZ;
  const cell = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), L(0x4a4f5c));
  cell.rotation.x = -Math.PI / 2; cell.position.set(cx, 0.02, cz); world.add(cell);
  box(pw + 0.8, 3.2, 0.4, 0x6c7385, cx + 0.2, 1.6, pb.minZ - 0.2);
  box(pw + 0.8, 3.2, 0.4, 0x6c7385, cx + 0.2, 1.6, pb.maxZ + 0.2);
  box(0.4, 3.2, pd + 0.8, 0x6c7385, pb.maxX + 0.2, 1.6, cz);
  for (let z = pb.minZ + 0.15; z <= pb.maxZ - 0.1; z += 0.5) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8), L(0x20242e));
    bar.position.set(pb.minX - 0.2, 1.6, z); world.add(bar);
  }
  box(0.14, 0.14, pd + 0.4, 0x20242e, pb.minX - 0.2, 3.2, cz);
  box(0.14, 0.14, pd + 0.4, 0x20242e, pb.minX - 0.2, 0.1, cz);
  box(pw + 1, 0.3, pd + 1, 0x3a3f4b, cx, 3.35, cz);
  const jl = new THREE.PointLight(0xff4d5e, 30, 14, 2); jl.position.set(cx, 3, cz); world.add(jl);
  const sign = textSprite('TÜRMƏ', { color: '#ff6b78', height: 0.9, depthTest: true });
  sign.position.set(pb.minX - 0.4, 4.0, cz); world.add(sign);
  // Türmənin iç küncündə: yazı lövhənin öz taxtasına qələmlə yazılmış kimi
  const signX = pb.maxX - 2.0, signY = 2.25, signZ = pb.maxZ - 0.38;
  box(2.9, 1.0, 0.16, 0x252936, signX, signY, signZ); // tünd çərçivə
  box(2.72, 0.82, 0.06, 0x8a5a33, signX, signY, signZ - 0.105); // taxta lövhə
  box(0.08, 0.24, 0.08, 0x9aa3b5, signX - 0.95, signY + 0.61, signZ + 0.02); // asılqan
  box(0.08, 0.24, 0.08, 0x9aa3b5, signX + 0.95, signY + 0.61, signZ + 0.02);

  // Şəffaf tekstura: yalnız əl yazısı görünür, ayrıca lövhə və ya etiket yoxdur.
  const inkCanvas = document.createElement('canvas');
  inkCanvas.width = 768; inkCanvas.height = 240;
  const ink = inkCanvas.getContext('2d');
  ink.save();
  ink.translate(384, 120);
  ink.rotate(-0.025);
  ink.font = 'italic 58px "Comic Sans MS", "Segoe Print", cursive';
  ink.textAlign = 'center'; ink.textBaseline = 'middle';
  ink.lineJoin = 'round'; ink.lineCap = 'round';
  ink.strokeStyle = 'rgba(48,25,12,0.45)'; ink.lineWidth = 1.8;
  ink.strokeText('Əsgərxan göt', 0, 0);
  ink.fillStyle = '#29170d';
  ink.fillText('Əsgərxan göt', 0, 0);
  ink.restore();
  const inkTexture = new THREE.CanvasTexture(inkCanvas);
  inkTexture.colorSpace = THREE.SRGBColorSpace;
  // Plane içəriyə çevrildiyi üçün teksturanı ayrıca güzgüləmək lazım deyil.
  const inkPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.64, 0.78),
    new THREE.MeshBasicMaterial({ map: inkTexture, transparent: true, side: THREE.FrontSide, depthTest: true, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  // Yazı taxtanın ön səthinə yerləşdirilir; güzgü effekti və divarın arxasından görünmə bağlanır.
  // Lövhənin oyunçuya baxan daxili (-Z) səthinə yapışdır.
  inkPlane.position.set(signX, signY, signZ - 0.14);
  inkPlane.rotation.y = Math.PI;
  inkPlane.renderOrder = 1;
  world.add(inkPlane);
  // Azad etmə zonası
  const z = PRISON.zone;
  zoneRing = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.18, z.r, 48), new THREE.MeshBasicMaterial({ color: 0x38d996, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
  zoneRing.rotation.x = -Math.PI / 2; zoneRing.position.set(z.x, 0.04, z.z); world.add(zoneRing);
  zoneDisc = new THREE.Mesh(new THREE.CircleGeometry(z.r - 0.18, 48), new THREE.MeshBasicMaterial({ color: 0x38d996, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  zoneDisc.rotation.x = -Math.PI / 2; zoneDisc.position.set(z.x, 0.035, z.z); world.add(zoneDisc);
  const zl = textSprite('DOSTU AZAD ET · 5 san', { color: '#8dffc4', height: 0.45, font: 40 });
  zl.position.set(z.x, 2.2, z.z); world.add(zl);
}
buildWorld();
const COLLIDERS = getColliders();
const COLLIDERS_NO_TABLES = getColliders(true, false);
const COLLIDERS_NO_SHELVES = getColliders(false, false);

/* ---------------- Ərzaqlar ---------------- */
const itemGroup = new THREE.Group(); scene.add(itemGroup);
function spawnItem(d) {
  const [name, color] = ITEMS[d.n];
  const g = new THREE.Group(); g.position.set(d.x, d.y, d.z);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.36),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.5 }),
  );
  g.add(mesh);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
  glow.scale.set(1.5, 1.5, 1); g.add(glow);
  const label = textSprite(name, { font: 58, height: 0.32 });
  label.position.y = 0.55; label.visible = false; g.add(label);
  itemGroup.add(g);
  itemsMap.set(d.id, { ...d, group: g, mesh, label, glow, got: false, baseY: d.y, ph: Math.random() * 6 });
}
function clearItems() {
  for (const it of itemsMap.values()) itemGroup.remove(it.group);
  itemsMap.clear();
}

/* ---------------- Avatarlar ---------------- */
function makeAvatar(p) {
  const g = new THREE.Group();
  const police = p.team === 'police';
  const bodyMat = new THREE.MeshLambertMaterial({ color: police ? 0x1f3f9e : new THREE.Color(p.color) });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.8, 4, 12), bodyMat);
  body.position.y = 0.75; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), L(0xf1c9a5));
  head.position.y = 1.62; g.add(head);
  for (const ex of [-0.08, 0.08]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), L(0x111111));
    e.position.set(ex, 1.66, -0.19); g.add(e);
  }
  if (police) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.25, 0.1, 16), L(0x111a44)); cap.position.y = 1.8; g.add(cap);
    const vis = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.16), L(0x111a44)); vis.position.set(0, 1.76, -0.22); g.add(vis);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8), L(0xffd23f)); badge.rotation.x = Math.PI / 2; badge.position.set(0.12, 1.05, -0.28); g.add(badge);
  }
  const mate = p.team === me.team;
  const tag = textSprite(p.name + (p.adminEligible ? '  ADMIN' : ''), { color: police ? '#9bb8ff' : '#ffe08a', depthTest: !mate, height: 0.28 });
  tag.position.y = 2.2; g.add(tag);
  g.visible = false;
  return { group: g, body, bodyMat, police, color: police ? 0x1f3f9e : new THREE.Color(p.color), tag };
}
function setAvatarJailed(av, j) {
  if (av.j === j) return; av.j = j;
  av.bodyMat.color.set(j ? 0x6e7280 : av.color);
}
function syncAvatars() {
  if (!inGame || !room) return;
  const ids = new Set(room.players.map((p) => p.id));
  for (const [id, r] of remotes) {
    if (!ids.has(id) || id === myId) { scene.remove(r.av.group); remotes.delete(id); }
  }
  for (const p of room.players) {
    if (p.id === myId) continue;
    if (remotes.has(p.id)) {
      const existing = remotes.get(p.id).av;
      existing.group.visible = !p.invisible;
      existing.tag.visible = !p.invisible;
      continue;
    }
    const av = makeAvatar(p);
    av.group.visible = !p.invisible;
    scene.add(av.group);
    const sp = spawnInfo.get(p.id) || { x: 0, z: 0, ry: 0 };
    remotes.set(p.id, { av, x: sp.x, y: 0, z: sp.z, ry: sp.ry, tx: sp.x, ty: 0, tz: sp.z, try: sp.ry, j: 0, has: false });
  }
}
function clearAvatars() {
  for (const r of remotes.values()) scene.remove(r.av.group);
  remotes.clear();
}

/* =====================================================================
   Ekranlar və menyu
   ===================================================================== */
const SCREENS = ['main', 'servers', 'create', 'join', 'profile', 'how', 'lobby', 'end'];
function showScreen(name) {
  for (const s of SCREENS) $('#scr-' + s).classList.toggle('hidden', s !== name);
  if (name === 'servers') { send({ t: 'list' }); refreshServers(); }
  if (name === 'profile') fillProfile();
  if (name === 'create') $('#cr-name').placeholder = `${profile.name} serveri`;
}
let serverTimer = null;
function refreshServers() {
  clearInterval(serverTimer);
  serverTimer = setInterval(() => {
    if ($('#scr-servers').classList.contains('hidden')) { clearInterval(serverTimer); return; }
    send({ t: 'list' });
  }, 2500);
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.go)));
$('#btn-refresh').addEventListener('click', () => send({ t: 'list' }));

function renderServerList(list) {
  const el = $('#server-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Açıq server yoxdur. Özün yarat!</div>'; return; }
  el.innerHTML = list.map((r) => {
    const busy = r.phase !== 'lobby' || r.count >= r.max;
    return `<div class="trow"><span>${esc(r.name)} <small style="color:#98a2bd">#${esc(r.code)}</small></span><span>${r.count}/${r.max}</span>` +
      `<span><i class="badge ${r.phase !== 'lobby' ? 'busy' : ''}">${r.phase !== 'lobby' ? 'Oyunda' : 'Lobbi'}</i></span>` +
      `<button class="mini" data-code="${esc(r.code)}" ${busy ? 'disabled' : ''}>Qoşul</button></div>`;
  }).join('');
  $$('#server-list button[data-code]').forEach((b) => b.addEventListener('click', () => joinRoom(b.dataset.code)));
}

async function joinRoom(code) {
  ac();
  await ensureMic();
  send({ t: 'join', code });
}
$('#btn-join').addEventListener('click', () => {
  const code = $('#jn-code').value.trim().toUpperCase();
  if (code.length < 3) return toast('Server kodunu yaz', true);
  joinRoom(code);
});
$('#jn-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
$('#cr-max').addEventListener('input', () => { $('#cr-max-val').textContent = $('#cr-max').value; });
$('#btn-create').addEventListener('click', async () => {
  ac();
  await ensureMic();
  send({ t: 'create', name: $('#cr-name').value.trim(), max: +$('#cr-max').value, pub: $('#cr-pub').checked });
});

// Profil
function fillProfile() {
  $('#pf-name').value = profile.name;
  $('#pf-colors').innerHTML = COLORS.map((c) => `<div class="swatch ${c === profile.color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
  $$('#pf-colors .swatch').forEach((s) => s.addEventListener('click', () => {
    $$('#pf-colors .swatch').forEach((x) => x.classList.remove('sel')); s.classList.add('sel'); profile.color = s.dataset.c;
  }));
  $('#st-games').textContent = profile.games; $('#st-wins').textContent = profile.wins;
  $('#st-items').textContent = profile.items; $('#st-caught').textContent = profile.caught;
}
function updateChip() { $('#chip-name').textContent = profile.name; $('#chip-dot').style.background = profile.color; }
$('#btn-save-profile').addEventListener('click', () => {
  profile.name = ($('#pf-name').value.trim() || profile.name).slice(0, 16);
  saveProfile(); updateChip(); send({ t: 'hello', name: profile.name, color: profile.color });
  toast('Profil yadda saxlandı'); showScreen('main');
});
updateChip();

/* =====================================================================
   Lobbi
   ===================================================================== */
function onRoomUpdate() {
  if (!room) return;
  renderLobby();
  updateSoundPanel();
  if (adminMode) updateAdminPanel();
  syncPeers();
  if (inGame) { syncAvatars(); renderHudPlayers(); }
}
function playerCard(p) {
  const me_ = p.id === myId;
  return `<div class="pcard ${speaking.has(p.id) ? 'speaking' : ''}" data-id="${p.id}"><span class="pd" style="background:${esc(p.color)}"></span>` +
    `<span>${esc(p.name)}${p.adminEligible ? ' <span style="color:#ffd23f">ADMIN</span>' : ''}</span>${p.id === room.hostId ? '<span title="Server sahibi">👑</span>' : ''}${me_ ? '<span class="me">(sən)</span>' : ''}<span class="sp">🎤</span></div>`;
}
function renderLobby() {
  $('#lobby-name').textContent = room.name;
  $('#lobby-code').textContent = room.code;
  const pol = room.players.filter((p) => p.team === 'police');
  const fr = room.players.filter((p) => p.team === 'friends');
  const slots = (n, cap) => Array.from({ length: Math.max(0, cap - n) }, () => '<div class="pcard slot">boş yer</div>').join('');
  $('#list-police').innerHTML = pol.map(playerCard).join('') + slots(pol.length, 3);
  $('#list-friends').innerHTML = fr.map(playerCard).join('') + slots(fr.length, 5);
  $('#cnt-police').textContent = `${pol.length}/${room.max}`;
  $('#cnt-friends').textContent = `${fr.length}/${room.max}`;
  const mine = room.players.find((p) => p.id === myId);
  $('#join-police').disabled = !mine || mine.team === 'police';
  $('#join-friends').disabled = !mine || mine.team === 'friends';
  const host = room.hostId === myId;
  const btn = $('#btn-start');
  btn.classList.toggle('hidden', !host);
  btn.disabled = fr.length < 1;
  $('#lobby-hint').textContent = host
    ? (fr.length < 1 ? 'Başlamaq üçün ən azı 1 dost lazımdır.' : (pol.length < 1 ? 'Polis yoxdur — məşq rejimi kimi başlaya bilərsən.' : 'Hazırsan? Oyunu başlat!'))
    : 'Server sahibinin oyunu başlatmasını gözlə…';
  updateMicUI();
}
function updateSpeakingUI() {
  $$('.pcard[data-id]').forEach((el) => el.classList.toggle('speaking', speaking.has(+el.dataset.id)));
  if (inGame) renderHudPlayers();
}
$('#join-police').addEventListener('click', () => send({ t: 'team', team: 'police' }));
$('#join-friends').addEventListener('click', () => send({ t: 'team', team: 'friends' }));
$('#btn-start').addEventListener('click', () => send({ t: 'start' }));
$('#btn-copy').addEventListener('click', () => {
  navigator.clipboard?.writeText(room.code).then(() => toast('Kod kopyalandı'), () => toast(room.code));
});
$('#btn-leave').addEventListener('click', leaveRoom);
function leaveRoom() {
  send({ t: 'leave' });
  room = null;
  closeAllPeers();
  resetToMenu();
}
function resetToMenu() {
  if (inGame) endGameLocal();
  room = null;
  closeAllPeers();
  $('#pause').classList.add('hidden');
  showScreen('main');
}

/* =====================================================================
   Səs çat (WebRTC)
   ===================================================================== */
const rtc = { stream: null, tried: false, peers: new Map(), audios: new Map(), muted: false, mutedPlayers: new Set(), muteAll: false, analyser: null, speakingNow: false };
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

async function ensureMic() {
  if (rtc.tried) return;
  rtc.tried = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Səs çat üçün localhost və ya HTTPS lazımdır. Yalnız dinləyə bilərsən.', true);
    return;
  }
  try {
    rtc.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    setupAnalyser();
  } catch {
    rtc.stream = null;
    toast('Mikrofon açılmadı — yalnız dinləyə bilərsən', true);
  }
}
function setupAnalyser() {
  const c = ac(); if (!c || !rtc.stream) return;
  const src = c.createMediaStreamSource(rtc.stream);
  rtc.analyser = c.createAnalyser(); rtc.analyser.fftSize = 512;
  src.connect(rtc.analyser);
  const buf = new Uint8Array(rtc.analyser.fftSize);
  setInterval(() => {
    if (!room || !rtc.analyser) return;
    rtc.analyser.getByteTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const on = !rtc.muted && Math.sqrt(sum / buf.length) > 0.03;
    if (on !== rtc.speakingNow) {
      rtc.speakingNow = on;
      send({ t: 'speak', on });
      if (on) speaking.add(myId); else speaking.delete(myId);
      updateSpeakingUI(); updateMicUI();
    }
  }, 120);
}
function toggleMute() {
  if (!rtc.stream) { toast('Mikrofon yoxdur', true); return; }
  rtc.muted = !rtc.muted;
  rtc.stream.getAudioTracks().forEach((t) => { t.enabled = !rtc.muted; });
  if (rtc.muted && rtc.speakingNow) { rtc.speakingNow = false; send({ t: 'speak', on: false }); speaking.delete(myId); updateSpeakingUI(); }
  updateMicUI();
}
function updateMicUI() {
  let txt, cls = '';
  if (!rtc.stream) { txt = '🎤 Mikrofon yoxdur'; cls = 'off'; }
  else if (rtc.muted) { txt = '🔇 Mikrofon bağlı (M)'; cls = 'off'; }
  else { txt = rtc.speakingNow ? '🎤 Danışırsan…' : '🎤 Mikrofon açıq (M)'; cls = rtc.speakingNow ? 'talk' : ''; }
  const b = $('#btn-mic'); b.textContent = txt;
  const h = $('#hud-mic'); h.textContent = txt; h.className = cls;
}
$('#btn-mic').addEventListener('click', toggleMute);

function ensurePeer(id) {
  let peer = rtc.peers.get(id);
  if (peer) return peer;
  const pc = new RTCPeerConnection(ICE);
  peer = { pc, pending: [], hasRemote: false };
  if (rtc.stream) rtc.stream.getTracks().forEach((t) => pc.addTrack(t, rtc.stream));
  else pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: id, data: { c: e.candidate } }); };
  pc.ontrack = (e) => {
    let a = rtc.audios.get(id);
    if (!a) { a = new Audio(); a.autoplay = true; rtc.audios.set(id, a); }
    a.srcObject = e.streams[0] || new MediaStream([e.track]);
    a.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') { closePeer(id); }
  };
  rtc.peers.set(id, peer);
  return peer;
}
async function callPeer(id) {
  const peer = ensurePeer(id);
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    send({ t: 'rtc', to: id, data: { d: peer.pc.localDescription } });
  } catch { /* ignore */ }
}
async function onRtc(m) {
  const { from, data } = m;
  const peer = ensurePeer(from);
  try {
    if (data.d) {
      await peer.pc.setRemoteDescription(data.d);
      peer.hasRemote = true;
      for (const c of peer.pending) await peer.pc.addIceCandidate(c).catch(() => {});
      peer.pending = [];
      if (data.d.type === 'offer') {
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        send({ t: 'rtc', to: from, data: { d: peer.pc.localDescription } });
      }
    } else if (data.c) {
      if (peer.hasRemote) await peer.pc.addIceCandidate(data.c).catch(() => {});
      else peer.pending.push(data.c);
    }
  } catch { /* ignore */ }
}
function closePeer(id) {
  const p = rtc.peers.get(id);
  if (p) { try { p.pc.close(); } catch { /* ignore */ } rtc.peers.delete(id); }
  const a = rtc.audios.get(id);
  if (a) { a.srcObject = null; rtc.audios.delete(id); }
  speaking.delete(id);
}
function closeAllPeers() { for (const id of [...rtc.peers.keys()]) closePeer(id); }
function syncPeers() {
  if (!room || myId == null) return;
  const ids = new Set(room.players.map((p) => p.id));
  for (const id of [...rtc.peers.keys()]) if (!ids.has(id)) closePeer(id);
  for (const p of room.players) {
    if (p.id === myId || rtc.peers.has(p.id)) continue;
    if (myId < p.id) callPeer(p.id); // kiçik id-li tərəf zəng edir
  }
}
// Oyun daxilində məsafəyə görə səs: dostlar bir-birini həmişə eşidir, rəqiblər yalnız yaxında
function updateVoiceVolumes() {
  if (!room) return;
  for (const [id, a] of rtc.audios) {
    const p = room.players.find((q) => q.id === id);
    if (!p) continue;
    let vol = 1;
    if (inGame && p.team !== me.team) {
      const r = remotes.get(id);
      if (r) {
        const d = Math.hypot(r.x - me.x, r.z - me.z);
        vol = d < 8 ? 1 : d > 38 ? 0 : 1 - (d - 8) / 30;
      }
    }
    a.volume = rtc.muteAll || rtc.mutedPlayers.has(id) ? 0 : clamp(vol, 0, 1);
  }
}
function toggleMuteAll() {
  rtc.muteAll = !rtc.muteAll;
  updateAdminPanel();
  updateVoiceVolumes();
  toast(rtc.muteAll ? 'Hamının səsi yalnız səndə susduruldu' : 'Hamının səsi yenidən açıldı');
}

/* =====================================================================
   Oyunun başlaması / bitməsi
   ===================================================================== */
// HUD siyahısını bir dəfə qur
$('#hud-items').innerHTML = ITEMS.map((it, i) => `<li data-n="${i}"><i style="background:${it[1]}"></i>${esc(it[0])}</li>`).join('');

function startGame(m) {
  if (!room) return;
  inGame = true;
  gamePhase = 'countdown';
  collected = 0; needCount = m.need; relProg = 0; relActive = false; cdLeft = m.cd; timeLeft = m.dur; lastCd = 99;
  clearItems(); clearAvatars(); spawnInfo.clear();
  $$('#hud-items li').forEach((li) => li.classList.remove('done'));
  for (const d of m.items) spawnItem(d);
  for (const p of m.players) spawnInfo.set(p.id, { x: p.x, z: p.z, ry: p.ry });
  const mine = m.players.find((p) => p.id === myId);
  if (mine) {
    me.team = mine.team; me.x = mine.x; me.z = mine.z; me.y = 0; me.vy = 0; me.yaw = mine.ry; me.pitch = 0;
    me.jailed = false; me.stamina = 100; me.exhausted = false;
  }
  syncAvatars();
  document.body.classList.add('ingame');
  for (const s of SCREENS) $('#scr-' + s).classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#hud-list').classList.toggle('hidden', !showList);
  $('#hud-role').textContent = me.team === 'police' ? 'POLİS' : 'DOST';
  $('#hud-role').className = me.team;
  profile.games++; saveProfile();
  renderHudPlayers(); updateMicUI(); updateHudCount();
  tryLock();
  updatePause();
}
function endGameLocal() {
  inGame = false;
  gamePhase = 'lobby';
  clearItems(); clearAvatars();
  document.body.classList.remove('ingame');
  $('#hud').classList.add('hidden');
  $('#pause').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  for (const k of Object.keys(keys)) keys[k] = false;
}
function onEnd(m) {
  const won = (m.winner === 'friends') === (me.team === 'friends');
  const wasIn = inGame;
  endGameLocal();
  if (!wasIn) return;
  if (won) { profile.wins++; sfx.win(); } else sfx.lose();
  const mineStat = m.stats.find((s) => s.id === myId);
  if (mineStat) { profile.items += mineStat.picks; profile.caught += mineStat.catches; }
  saveProfile();
  $('#end-title').textContent = m.winner === 'friends' ? '🛒 DOSTLAR QAZANDI!' : '🚓 POLİS QAZANDI!';
  $('#end-title').style.color = m.winner === 'friends' ? 'var(--friends)' : '#7da2ff';
  $('#end-reason').textContent = `${m.reason} · Yığılan ərzaq: ${m.collected}/${m.need}`;
  $('#end-stats').innerHTML = m.stats.map((s) =>
    `<div class="trow"><span>${esc(s.name)}${s.id === myId ? ' (sən)' : ''}</span><span>${s.team === 'police' ? 'Polis' : 'Dost'}</span><span>${s.picks}</span><span>${s.catches}</span></div>`).join('');
  showScreen('end');
}
$('#btn-back-lobby').addEventListener('click', () => { if (room) showScreen('lobby'); else showScreen('main'); });

/* ---------------- Hadisələr ---------------- */
function onGot(m) {
  const it = itemsMap.get(m.id);
  if (it && !it.got) { it.got = true; itemGroup.remove(it.group); }
  $(`#hud-items li[data-n="${m.n}"]`)?.classList.add('done');
  collected = m.c; updateHudCount();
  if (m.by === myId) sfx.pick(); else sfx.soft();
  toast(`${m.name}: ${ITEMS[m.n][0]} götürdü (${m.c}/${needCount})`);
}
function onCaught(m) {
  const r = remotes.get(m.id);
  if (r) { setAvatarJailed(r.av, 1); r.j = 1; r.x = r.tx = m.x; r.z = r.tz = m.z; }
  if (m.id === myId) {
    me.jailed = true; me.x = m.x; me.z = m.z; me.y = 0; me.vy = 0;
    flash('TUTULDUN!', '#ff6b78'); sfx.caught();
    $('#hud-role').textContent = 'TÜRMƏDƏ'; $('#hud-role').className = 'jailed';
  } else {
    toast(`${m.name} tutuldu! (${m.byName})`, true); sfx.caught();
  }
  renderHudPlayers();
}
function onFreed(m) {
  const r = remotes.get(m.id);
  if (r) { setAvatarJailed(r.av, 0); r.j = 0; r.x = r.tx = m.x; r.z = r.tz = m.z; }
  if (m.id === myId) {
    me.jailed = false; me.x = m.x; me.z = m.z; me.y = 0; me.vy = 0;
    flash('AZADSAN!', '#8dffc4');
    $('#hud-role').textContent = 'DOST'; $('#hud-role').className = 'friends';
  } else toast(`${m.name} azad edildi!`);
  sfx.free(); renderHudPlayers();
}
function applyState(m) {
  if (!inGame) return;
  gamePhase = m.ph; timeLeft = m.tl; cdLeft = m.cd; relProg = m.rp; relActive = !!m.ra; collected = m.c;
  for (const [id, x, y, z, ry, j, admin, invisible] of m.p) {
    if (id === myId) continue;
    const r = remotes.get(id); if (!r) continue;
    r.tx = x; r.ty = y; r.tz = z; r.try = ry;
    r.av.group.visible = !invisible;
    r.av.tag.visible = !invisible;
    if (!r.has) { r.x = x; r.y = y; r.z = z; r.ry = ry; r.has = true; }
    if (r.j !== j) { r.j = j; setAvatarJailed(r.av, j); }
  }
  updateHudCount();
}

/* =====================================================================
   HUD
   ===================================================================== */
const jumpscareOverlay = document.createElement('div');
jumpscareOverlay.id = 'jumpscare-overlay';
jumpscareOverlay.innerHTML = '<div class="scare-face">☠</div><div class="scare-title">GOTCHA!</div>';
document.body.appendChild(jumpscareOverlay);
let jumpscareTimer = null;
function showJumpscare() {
  jumpscareOverlay.classList.remove('hidden');
  jumpscareOverlay.classList.add('active');
  const c = ac();
  if (c) {
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.75);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.85);
  }
  clearTimeout(jumpscareTimer);
  jumpscareTimer = setTimeout(() => {
    jumpscareOverlay.classList.remove('active');
    jumpscareOverlay.classList.add('hidden');
  }, 1800);
}
let flashT = null;
function flash(text, color = '#fff') {
  const el = $('#hud-flash');
  el.textContent = text; el.style.color = color; el.classList.add('show');
  clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('show'), 1600);
}
function updateHudCount() { $('#hud-count').textContent = `${collected}/${needCount}`; }
let hudPlayersKey = '';
function renderHudPlayers() {
  if (!room) return;
  const rows = room.players.map((p) => {
    const jailed = p.id === myId ? me.jailed : (remotes.get(p.id)?.j === 1);
    return { p, jailed };
  });
  const key = rows.map((r) => `${r.p.id}${r.jailed ? 1 : 0}${speaking.has(r.p.id) ? 1 : 0}`).join('|');
  if (key === hudPlayersKey) return;
  hudPlayersKey = key;
  const fr = rows.filter((r) => r.p.team === 'friends'), po = rows.filter((r) => r.p.team === 'police');
  const row = (r) => `<div class="hp ${r.jailed ? 'jail' : ''}"><span class="d" style="background:${r.p.team === 'police' ? '#5b86ff' : esc(r.p.color)}"></span>${esc(r.p.name)}${r.jailed ? ' 🔒' : ''}<span class="sp">${speaking.has(r.p.id) ? '🎤' : ''}</span></div>`;
  $('#hud-players').innerHTML = `<div style="color:#ffb400;font-weight:800;font-size:11px;letter-spacing:.1em">DOSTLAR</div>${fr.map(row).join('')}<div style="color:#7da2ff;font-weight:800;font-size:11px;letter-spacing:.1em;margin-top:6px">POLİS</div>${po.map(row).join('')}`;
}

// Mini xəritə
const mm = $('#mm'), mmc = mm.getContext('2d');
const MMS = 3;
const mmStatic = document.createElement('canvas'); mmStatic.width = mm.width; mmStatic.height = mm.height;
(function drawStatic() {
  const g = mmStatic.getContext('2d');
  g.fillStyle = '#10141f'; g.fillRect(0, 0, mm.width, mm.height);
  const X = (x) => (x - WORLD.minX) * MMS, Z = (z) => (z - WORLD.minZ) * MMS;
  g.fillStyle = '#3a4768';
  for (const b of COLLIDERS) g.fillRect(X(b[0]), Z(b[2]), (b[1] - b[0]) * MMS, (b[3] - b[2]) * MMS);
  const pb = PRISON.box;
  g.strokeStyle = '#ff4d5e'; g.lineWidth = 2; g.strokeRect(X(pb.minX), Z(pb.minZ), (pb.maxX - pb.minX) * MMS, (pb.maxZ - pb.minZ) * MMS);
  g.strokeStyle = '#38d996'; g.beginPath(); g.arc(X(PRISON.zone.x), Z(PRISON.zone.z), PRISON.zone.r * MMS, 0, Math.PI * 2); g.stroke();
})();
function drawMinimap() {
  mmc.drawImage(mmStatic, 0, 0);
  const X = (x) => (x - WORLD.minX) * MMS, Z = (z) => (z - WORLD.minZ) * MMS;
  for (const r of remotes.values()) {
    const p = room?.players.find((q) => remotes.get(q.id) === r);
    if (!p || !r.has) continue;
    if (p.team !== me.team && !(r.j === 1)) continue;
    mmc.fillStyle = r.j ? '#ff4d5e' : p.team === 'police' ? '#5b86ff' : '#ffb400';
    mmc.beginPath(); mmc.arc(X(r.x), Z(r.z), 3, 0, Math.PI * 2); mmc.fill();
  }
  // mən
  mmc.save(); mmc.translate(X(me.x), Z(me.z)); mmc.rotate(-me.yaw);
  mmc.fillStyle = '#fff'; mmc.beginPath(); mmc.moveTo(0, -6); mmc.lineTo(4, 4); mmc.lineTo(-4, 4); mmc.closePath(); mmc.fill();
  mmc.restore();
}

/* =====================================================================
   Giriş (klaviatura / siçan)
   ===================================================================== */
const touchMode = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
function tryLock() {
  if (touchMode) { updatePause(); return; }
  const p = canvas.requestPointerLock?.();
  if (p && p.catch) p.catch(() => {});
}
function isLocked() { return document.pointerLockElement === canvas || (touchMode && inGame); }
function updatePause() {
  const show = inGame && !isLocked();
  $('#pause').classList.toggle('hidden', !show);
}
document.addEventListener('pointerlockchange', updatePause);
$('#btn-resume').addEventListener('click', tryLock);
$('#pause').addEventListener('click', (e) => { if (e.target.id === 'pause') tryLock(); });
$('#btn-quit').addEventListener('click', leaveRoom);

// Tam ekran düyməsi — kompüter, Android və iPhone üçün
const fullscreenBtn = document.querySelector('#btn-fullscreen');
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandaloneApp = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

fullscreenBtn?.addEventListener('click', async () => {
  // iPhone Safari adi səhifələrə tam ekran icazəsi verməyə bilər.
  // Ana ekrana əlavə edilmiş web-app isə brauzer çərçivəsiz açılır.
  if (isIOSDevice && !isStandaloneApp) {
    toast('iPhone: Safari-də Paylaş ⬆ → “Add to Home Screen” seç, sonra oyunu ana ekrandakı ikonla aç.');
    return;
  }

  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }

    const root = document.documentElement;
    if (root.requestFullscreen) {
      await root.requestFullscreen({ navigationUI: 'hide' });
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    } else if (isIOSDevice && isStandaloneApp) {
      toast('Oyun iPhone-da artıq tam ekran tətbiq kimi açılıb.');
      return;
    } else {
      toast('Bu brauzer tam ekranı dəstəkləmir. Brauzer menyusundan Tam ekran seç.');
      return;
    }

    // Yalnız telefon/planşetdə üfüqi rejimi istə; kompüterə toxunma.
    if (touchMode && screen.orientation?.lock) {
      try { await screen.orientation.lock('landscape'); } catch (_) {}
    }
  } catch (err) {
    console.warn('Tam ekran açıla bilmədi:', err);
    if (isIOSDevice) {
      toast('iPhone-da Safari → Paylaş ⬆ → “Add to Home Screen” seç və ana ekrandakı ikonla aç.');
    } else {
      toast('Tam ekran alınmadı. Brauzerin menyusundan “Tam ekran” seç.');
    }
  }
});
function updateFullscreenButton() {
  if (!fullscreenBtn) return;
  if (isIOSDevice && !isStandaloneApp) {
    fullscreenBtn.textContent = '⛶ Tam ekran';
  } else if (isIOSDevice && isStandaloneApp) {
    fullscreenBtn.textContent = '✓ Tətbiq rejimi';
  } else {
    fullscreenBtn.textContent =
      (document.fullscreenElement || document.webkitFullscreenElement)
        ? '⤢ Pəncərə' : '⛶ Tam ekran';
  }
}
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
updateFullscreenButton();

document.addEventListener('mousemove', (e) => {
  if (!inGame || !isLocked() || touchMode) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch = clamp(me.pitch - e.movementY * 0.0022, -1.45, 1.45);
});
document.addEventListener('mousedown', (e) => {
  if (inGame && !touchMode && e.button === 0) { e.preventDefault(); doAction(); }
});

// Telefon: ekranda barmaqla sürüşdürərək kameraya bax.
let lookPointer = null, lookX = 0, lookY = 0;
canvas.style.touchAction = 'none';
document.addEventListener('pointerdown', (e) => {
  if (!touchMode || !inGame) return;
  // İdarəetmə düymələrinə toxunanda kamera dönməsin.
  if (e.target.closest('#mobile-controls, button, input, .panel')) return;
  lookPointer = e.pointerId;
  lookX = e.clientX; lookY = e.clientY;
}, { passive: true });
document.addEventListener('pointermove', (e) => {
  if (!touchMode || !inGame || e.pointerId !== lookPointer) return;
  const dx = e.clientX - lookX, dy = e.clientY - lookY;
  lookX = e.clientX; lookY = e.clientY;
  me.yaw -= dx * 0.006;
  me.pitch = clamp(me.pitch - dy * 0.006, -1.35, 1.35);
});
function stopLook(e) { if (e.pointerId === lookPointer) lookPointer = null; }
document.addEventListener('pointerup', stopLook);
document.addEventListener('pointercancel', stopLook);

// Telefon üçün sürüşdürülən virtual joystick.
const joystick = $('#mobile-joystick');
const joystickKnob = $('#joystick-knob');
let joystickPointer = null;
function resetJoystick() {
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) keys[k] = false;
  joystickKnob.style.transform = 'translate(0, 0)';
  joystick?.classList.remove('active');
  joystickPointer = null;
}
function moveJoystick(e) {
  if (!joystick || joystickPointer !== e.pointerId) return;
  const r = joystick.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = r.width * 0.29, len = Math.hypot(dx, dy);
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  const nx = dx / max, ny = dy / max, dead = 0.28;
  keys.KeyW = ny < -dead; keys.KeyS = ny > dead;
  keys.KeyA = nx < -dead; keys.KeyD = nx > dead;
}
joystick?.addEventListener('pointerdown', (e) => {
  if (!inGame) return;
  e.preventDefault();
  joystickPointer = e.pointerId;
  joystick.classList.add('active');
  joystick.setPointerCapture(e.pointerId);
  moveJoystick(e);
});
joystick?.addEventListener('pointermove', moveJoystick);
joystick?.addEventListener('pointerup', resetJoystick);
joystick?.addEventListener('pointercancel', resetJoystick);
joystick?.addEventListener('lostpointercapture', resetJoystick);
joystick?.addEventListener('contextmenu', (e) => e.preventDefault());
$('#mobile-action').addEventListener('pointerdown', (e) => { e.preventDefault(); doAction(); });
$('#mobile-list').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  showList = !showList;
  $('#hud-list').classList.toggle('hidden', !showList);
});

// Qaç və tullan düymələri: basılı saxlayanda aktiv, buraxanda sönür.
const mobileKeyPointers = new Map();
document.querySelectorAll('#mobile-controls [data-key]').forEach((button) => {
  const key = button.dataset.key;
  button.addEventListener('pointerdown', (e) => {
    if (!inGame) return;
    e.preventDefault();
    mobileKeyPointers.set(e.pointerId, key);
    keys[key] = true;
    button.classList.add('pressed');
    try { button.setPointerCapture(e.pointerId); } catch (_) {}
  });
  const releaseKey = (e) => {
    const heldKey = mobileKeyPointers.get(e.pointerId);
    if (!heldKey) return;
    mobileKeyPointers.delete(e.pointerId);
    if (![...mobileKeyPointers.values()].includes(heldKey)) keys[heldKey] = false;
    if (![...mobileKeyPointers.values()].includes(heldKey)) button.classList.remove('pressed');
  };
  button.addEventListener('pointerup', releaseKey);
  button.addEventListener('pointercancel', releaseKey);
  button.addEventListener('lostpointercapture', releaseKey);
});
addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.code === 'Digit0' || e.code === 'Numpad0')) {
    e.preventDefault();
    if (!canUseAdmin()) return;
    adminMode = !adminMode;
    if (adminMode) {
      adminPanel.classList.remove('hidden');
      sendAdminState();
      toast('Admin xüsusiyyətləri aktiv oldu');
    } else {
      adminPanel.classList.add('hidden');
      adminHidden = false;
      adminSuperJump = false;
      adminSpeed = false;
      sendAdminState();
      toast('Admin xüsusiyyətləri söndü');
    }
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!inGame) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
    e.preventDefault();
    doAction();
  }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Tab') { showList = !showList; $('#hud-list').classList.toggle('hidden', !showList); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
function releaseAllControls() {
  for (const k of Object.keys(keys)) keys[k] = false;
  mobileKeyPointers.clear();
  document.querySelectorAll('#mobile-controls [data-key]').forEach((button) => button.classList.remove('pressed'));
  if (joystickPointer !== null) resetJoystick();
  lookPointer = null;
}
addEventListener('blur', releaseAllControls);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllControls();
});

function doAction() {
  if (!inGame || gamePhase !== 'play' || me.jailed) return;

  if (me.team === 'friends') {
    // Düymə basılan anda ən yaxın ərzağı yenidən hesabla; köhnə nearItem dəyərinə güvənmə.
    let target = null;
    let best = 1.5;
    for (const it of itemsMap.values()) {
      if (it.got) continue;
      const d = Math.hypot(it.x - me.x, it.z - me.z);
      if (d < best) { best = d; target = it; }
    }
    if (target) {
      send({ t: 'pickup', id: target.id });
    } else {
      toast('E — Götür');
    }
  } else if (nearFriend && performance.now() > catchCd) {
    catchCd = performance.now() + 800;
    send({ t: 'catch', id: nearFriend.id });
  }
}

/* =====================================================================
   Oyun yenilənməsi
   ===================================================================== */
const colliders = COLLIDERS;
function updateGame(dt) {
  const frozen = me.team === 'police' && gamePhase === 'countdown';
  const active = isLocked() && !frozen && gamePhase !== 'lobby';
  me.moving = false;
  if (active) {
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let mx = 0, mz = 0;
    if (f || s) {
      const len = Math.hypot(f, s), ff = f / len, ss = s / len;
      mx = -Math.sin(me.yaw) * ff + Math.cos(me.yaw) * ss;
      mz = -Math.cos(me.yaw) * ff - Math.sin(me.yaw) * ss;
      me.moving = true;
    }
    const police = me.team === 'police';
    let speed = adminMode && adminSpeed ? 12 : (police ? 4.7 : 4.5);
    const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && me.moving && !me.jailed && !me.exhausted;
    if (wantSprint && me.stamina > 0) {
      speed = police ? 6.8 : 7.0;
      me.stamina = Math.max(0, me.stamina - 24 * dt);
      if (me.stamina <= 0) me.exhausted = true;
    } else {
      me.stamina = Math.min(100, me.stamina + (me.moving ? 12 : 22) * dt);
      if (me.exhausted && me.stamina > 30) me.exhausted = false;
    }
    if (me.jailed) speed = 3;
    me.x += mx * speed * dt; me.z += mz * speed * dt;
    if (keys.Space && me.y <= 0.001 && !me.jailed) me.vy = adminMode && adminSuperJump ? 11 : 6;
    me.bob += dt * (wantSprint ? 13 : 9) * (me.moving ? 1 : 0);
  }
  // Cazibə
  me.vy -= 20 * dt; me.y += me.vy * dt;
  if (me.y < 0) { me.y = 0; me.vy = 0; }
  const pos = { x: me.x, z: me.z };
  // Super jump zamanı əvvəl meyvə masalarının, sonra hündür rəflərin baryerini keçməyə icazə ver.
  const jumpColliders = me.y > SHELF.h
    ? COLLIDERS_NO_SHELVES
    : me.y > 0.9 ? COLLIDERS_NO_TABLES : colliders;
  resolveCollisions(pos, PLAYER_R, jumpColliders);
  if (me.jailed) {
    pos.x = clamp(pos.x, PRISON.inner.minX, PRISON.inner.maxX);
    pos.z = clamp(pos.z, PRISON.inner.minZ, PRISON.inner.maxZ);
  }
  me.x = pos.x; me.z = pos.z;

  // Serverə mövqeyi müntəzəm göndər; yoxsa server oyunçunu köhnə yerdə saxlayır.
  const nowPos = performance.now();
  if (inGame && wsOpen && nowPos - lastPosSent >= 50) {
    lastPosSent = nowPos;
    send({ t: 'pos', x: me.x, y: me.y, z: me.z, ry: me.yaw });
  }

  // Kamera
  const bob = me.moving && me.y <= 0.001 ? Math.sin(me.bob) * 0.04 : 0;
  camera.position.set(me.x, me.y + 1.65 + bob, me.z);
  camera.rotation.set(me.pitch, me.yaw, 0);

  // Digər oyunçular
  const k = 1 - Math.exp(-dt * 12);
  for (const r of remotes.values()) {
    if (!r.has) continue;
    r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
    r.ry += angDiff(r.ry, r.try) * k;
    r.av.group.position.set(r.x, r.y, r.z);
    r.av.group.rotation.y = r.ry;
  }

  // Yaxınlıq (götür / tut)
  nearItem = null; nearFriend = null;
  if (gamePhase === 'play' && !me.jailed) {
    if (me.team === 'friends') {
      let best = 1.5;
      for (const it of itemsMap.values()) {
        if (it.got) continue;
        const d = Math.hypot(it.x - me.x, it.z - me.z);
        if (d < best) { best = d; nearItem = it; }
      }
    } else {
      let best = 2.9;
      for (const [id, r] of remotes) {
        if (!r.has || r.j === 1) continue;
        const p = room?.players.find((q) => q.id === id);
        if (!p || p.team !== 'friends') continue;
        const d = Math.hypot(r.x - me.x, r.z - me.z);
        if (d < best) { best = d; nearFriend = { id, name: p.name }; }
      }
    }
  }

  updateHudFrame(dt);
  updateVoiceVolumes();
  drawMinimap();
}

let hudAcc = 0;
function updateHudFrame(dt) {
  // Taymer
  const t = Math.max(0, Math.ceil(timeLeft));
  $('#hud-timer').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  // Banner
  const banner = $('#hud-banner');
  if (gamePhase === 'countdown') {
    const n = Math.max(1, Math.ceil(cdLeft));
    banner.innerHTML = me.team === 'police'
      ? `Gözlə… ${n}<small>Dostlar gizlənir. Polis ${n} saniyəyə açılır.</small>`
      : `Qaç və gizlən! ${n}<small>Polis ${n} saniyəyə açılır. Rəflərdəki parlayan ərzaqları yığ.</small>`;
    if (n <= 3 && n !== lastCd) { sfx.beep(); }
    lastCd = n;
  } else if (me.jailed) {
    banner.innerHTML = 'Türmədəsən<small>Dostların yaşıl zonada 5 saniyə dayanıb səni azad etməlidir.</small>';
  } else banner.innerHTML = '';
  // Çağırış
  const pr = $('#hud-prompt');
  if (nearItem) { pr.style.display = 'block'; pr.innerHTML = `<kbd>E</kbd> ${esc(ITEMS[nearItem.n][0])} götür`; }
  else if (nearFriend) { pr.style.display = 'block'; pr.innerHTML = `<kbd>E</kbd> ${esc(nearFriend.name)} tut`; }
  else pr.style.display = 'none';
  // Azad etmə barı
  const rl = $('#hud-release');
  if (relActive && gamePhase === 'play') {
    rl.style.display = 'block';
    $('#hud-release-fill').style.width = `${clamp(relProg / 5, 0, 1) * 100}%`;
    $('#hud-release-text').textContent = me.jailed ? `Dostların səni azad edir… ${relProg.toFixed(1)} / 5 san`
      : me.team === 'police' ? `Dostlar türməni açır! ${relProg.toFixed(1)} / 5 san` : `Dost azad edilir… ${relProg.toFixed(1)} / 5 san`;
  } else rl.style.display = 'none';
  // Dözümlülük
  const sf = $('#hud-stamina-fill');
  sf.style.width = `${me.stamina}%`; sf.classList.toggle('low', me.exhausted);
  hudAcc += dt;
  if (hudAcc > 0.25) { hudAcc = 0; renderHudPlayers(); }
}

/* =====================================================================
   Əsas dövr
   ===================================================================== */
let last = performance.now();
let menuT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (inGame) {
    updateGame(dt);
  } else {
    // Menyu: üstdən yavaş fırlanan kamera
    menuT += dt * 0.07;
    const R = 44;
    camera.position.set(Math.cos(menuT) * R, 17, Math.sin(menuT) * R * 0.75);
    camera.lookAt(0, 0.5, 0);
  }
  // Animasiyalar
  const tt = now / 1000;
  for (const it of itemsMap.values()) {
    if (it.got) continue;
    it.mesh.rotation.y += dt * 1.6;
    it.group.position.y = it.baseY + Math.sin(tt * 2 + it.ph) * 0.04;
    it.glow.material.opacity = 0.6 + Math.sin(tt * 3 + it.ph) * 0.2;
    if (inGame && me.team === 'friends') {
      const d = Math.hypot(it.x - me.x, it.z - me.z);
      it.label.visible = d < 9;
    } else it.label.visible = false;
  }
  if (zoneRing) {
    const pulse = 0.55 + Math.sin(tt * 3) * 0.25;
    zoneRing.material.opacity = relActive ? 1 : pulse;
    zoneDisc.material.opacity = relActive ? 0.4 : 0.14;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Başlat
showScreen('main');
connect();
// Server cavab verməsə yükləmə ekranı sonsuz qalmasın
setTimeout(() => { if (!wsOpen) $('#loading p').textContent = 'Serverə qoşulmaq alınmır… yenidən yoxlanılır'; }, 4000);
