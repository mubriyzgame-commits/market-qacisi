// Server və klient tərəfindən paylaşılan xəritə məlumatı (ES module)

export const WORLD = { minX: -35, maxX: 35, minZ: -25, maxZ: 25 };
export const PLAYER_R = 0.4;

// Siyahıdakı 30 ərzaq: [ad, rəng]
export const ITEMS = [
  ['Çörək', '#d9a35b'], ['Süd', '#f4f4f4'], ['Yumurta', '#f2e2b8'], ['Pendir', '#ffd23f'], ['Kərə yağı', '#f7e98e'],
  ['Qaymaq', '#fff3e0'], ['Qatıq', '#cfe3ff'], ['Düyü', '#f5f0e6'], ['Makaron', '#e9b44c'], ['Un', '#fafafa'],
  ['Şəkər', '#ffffff'], ['Duz', '#dfe6e9'], ['Çay', '#8b4513'], ['Qəhvə', '#6b3e26'], ['Alma', '#e63946'],
  ['Banan', '#ffe135'], ['Portağal', '#ff8c00'], ['Pomidor', '#d62828'], ['Xiyar', '#4caf50'], ['Kartof', '#b08968'],
  ['Soğan', '#c77dff'], ['Yağ', '#f4d35e'], ['Toyuq', '#f1b98a'], ['Qiymə', '#c1453b'], ['Bal', '#f0a202'],
  ['Mürəbbə', '#9b2335'], ['Meyvə şirəsi', '#ff9f1c'], ['Su', '#4cc9f0'], ['Peçenye', '#c68642'], ['Şokolad', '#7b4a2a'],
];

// Rəflər
export const SHELF = { d: 1.4, h: 2.0, boards: [0.3, 0.85, 1.4] };
const ROWS_Z = [-19, -14, -9, -4, 1, 6];
const SEGS = [
  { x: -22, w: 11 }, { x: -9, w: 11 }, { x: 4, w: 11 }, { x: 17, w: 11 }, { x: 28.5, w: 9 },
];
export const SHELVES = [];
for (const z of ROWS_Z) for (const s of SEGS) SHELVES.push({ x: s.x, z, w: s.w, d: SHELF.d, h: SHELF.h });

// Kassalar, masalar, sütunlar, soyuducu divar
export const COUNTERS = [
  { x: -30, z: 18, w: 5, d: 1.4, h: 1.0 },
  { x: -23, z: 18, w: 5, d: 1.4, h: 1.0 },
  { x: -16, z: 18, w: 5, d: 1.4, h: 1.0 },
];
export const TABLES = [
  { x: -6, z: 15, w: 4.5, d: 2, h: 0.9 },
  { x: 2, z: 15, w: 4.5, d: 2, h: 0.9 },
  { x: 9.5, z: 15, w: 4.5, d: 2, h: 0.9 },
];
export const PILLARS = [
  { x: -12, z: 10, s: 1.2 }, { x: -12, z: 22, s: 1.2 },
  { x: 6, z: 22, s: 1.2 }, { x: -20, z: 10, s: 1.2 },
];
export const FRIDGE_WALL = { z: -24.3, d: 1.4, h: 2.3 };

// Türmə
export const PRISON = {
  box: { minX: 26, maxX: 34, minZ: 14, maxZ: 22 },
  inner: { minX: 26.6, maxX: 33.4, minZ: 14.6, maxZ: 21.4 },
  slots: [[28, 16], [31, 16], [28, 20], [31, 20], [29.5, 18]],
  zone: { x: 23.2, z: 18, r: 2.4 },
  exit: { x: 23.0, z: 18 },
};

// Başlanğıc nöqtələri. yaw: irəli vektor = (-sin yaw, -cos yaw)
export const SPAWNS = {
  friends: [[-32, -8], [-32, -4], [-32, 0], [-32, 4], [-32, 8]],
  police: [[16, 12], [16, 16], [16, 20]],
};
export const SPAWN_YAW = { friends: -Math.PI / 2, police: Math.PI / 2 };

// Toqquşma qutuları [minX, maxX, minZ, maxZ]
export function getColliders(includeShelves = true, includeTables = true, mapId = 'market') {
  if (mapId === 'school') {
    const boxes = [];
    const rooms = [
      { x1: -35, x2: -14, cx: -24.5 }, { x1: -14, x2: 6, cx: -4 },
      { x1: 6, x2: 26, cx: 16 },
    ];
    // Görünən yan divarlarla eyni ölçüdə toqquşma sərhədləri
    for (const x of [-35,-14,6]) for (const cz of [-12,12]) {
      boxes.push([x-0.16,x+0.16,cz-10,cz+10]);
    }
    boxes.push([25.84,26.16,-22,-2]);
    boxes.push([25.84,26.16,2,14]);
    // Türmənin qərb barmaqlığı məktəblə türməni ayırır
    boxes.push([25.6,26,14,22]);
    // Otaqların arxa divarları — hər iki sıra tam bağlanır
    for (const room of rooms) for (const z of [-22,22]) {
      boxes.push([room.x1,room.x2,z-0.16,z+0.16]);
    }
    // Dəhlizə açılan qapılar: yalnız qapı boşluqları keçilə bilər
    for (const room of rooms) for (const z of [-2,2]) {
      const gap = 1.5;
      boxes.push([room.x1, room.cx-gap, z-0.16, z+0.16]);
      boxes.push([room.cx+gap, room.x2, z-0.16, z+0.16]);
      // Açıq qapı qanadının real toqquşma sərhədi
      const hingeX=room.cx-gap;
      boxes.push([hingeX-0.05,hingeX+0.05,z < 0 ? z-1.15 : z-0.05,z < 0 ? z+0.05 : z+1.15]);
    }
    // Partalar və kitab rəfləri
    for (const room of rooms) for (const cz of [-12,12]) {
      for (const [dx,dz] of [[-5,-4],[0,-4],[5,-4],[-2.5,4],[2.5,4]]) {
        const x=room.cx+dx, z=cz+dz;
        boxes.push([x-1.2,x+1.2,z-0.65,z+0.65]);
      }
      const shelfX = room.x1 < -30 ? room.x1+2.0 : room.x1+1.1;
      boxes.push([shelfX-0.45,shelfX+0.45,cz-1.6,cz+1.6]);
    }
    return boxes;
  }
  const c = [];
  if (includeShelves) {
    for (const s of SHELVES) c.push([s.x - s.w / 2, s.x + s.w / 2, s.z - s.d / 2, s.z + s.d / 2]);
  }
  for (const o of [...COUNTERS, ...(includeTables ? TABLES : [])]) c.push([o.x - o.w / 2, o.x + o.w / 2, o.z - o.d / 2, o.z + o.d / 2]);
  for (const p of PILLARS) c.push([p.x - p.s / 2, p.x + p.s / 2, p.z - p.s / 2, p.z + p.s / 2]);
  c.push([WORLD.minX, WORLD.maxX, FRIDGE_WALL.z - FRIDGE_WALL.d / 2, FRIDGE_WALL.z + FRIDGE_WALL.d / 2]);
  const b = PRISON.box;
  c.push([b.minX - 0.4, b.maxX + 0.4, b.minZ - 0.4, b.minZ]); // şimal
  c.push([b.minX - 0.4, b.maxX + 0.4, b.maxZ, b.maxZ + 0.4]); // cənub
  c.push([b.maxX, b.maxX + 0.4, b.minZ - 0.4, b.maxZ + 0.4]); // şərq
  c.push([b.minX - 0.4, b.minX, b.minZ - 0.4, b.maxZ + 0.4]); // qərb (barmaqlıq)
  return c;
}

// Dairə - AABB toqquşma həlli (pos: {x, z})
export function resolveCollisions(pos, r, boxes) {
  for (let it = 0; it < 3; it++) {
    for (const b of boxes) {
      const cx = Math.max(b[0], Math.min(pos.x, b[1]));
      const cz = Math.max(b[2], Math.min(pos.z, b[3]));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = r - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          const l = pos.x - b[0], rr = b[1] - pos.x, t = pos.z - b[2], bt = b[3] - pos.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) pos.x = b[0] - r;
          else if (m === rr) pos.x = b[1] + r;
          else if (m === t) pos.z = b[2] - r;
          else pos.z = b[3] + r;
        }
      }
    }
  }
  pos.x = Math.max(WORLD.minX + r, Math.min(WORLD.maxX - r, pos.x));
  pos.z = Math.max(WORLD.minZ + r, Math.min(WORLD.maxZ - r, pos.z));
}

// Ərzağların yerləşə biləcəyi rəf yuvaları
export function makeItemSlots(mapId = 'market') {
  if (mapId === 'school') {
    const slots = [];
    const rooms = [-24.5, -4, 16];
    for (const cx of rooms) for (const row of [-12, 12]) {
      for (const [dx,dz] of [[-5,-4],[0,-4],[5,-4],[-2.5,4],[2.5,4]]) {
        slots.push({ x: cx + dx, y: 0.92, z: row + dz });
      }
    }
    return slots;
  }
  const slots = [];
  for (const s of SHELVES) {
    const n = Math.floor(s.w / 1.5);
    const off = (s.w - n * 1.5) / 2;
    for (let k = 0; k < n; k++) {
      const x = s.x - s.w / 2 + off + 0.75 + k * 1.5;
      for (const side of [-1, 1]) {
        for (const b of SHELF.boards) {
          slots.push({ x, y: b + 0.03 + 0.27, z: s.z + side * 0.5 });
        }
      }
    }
  }
  return slots;
}



export const MAPS = [
  { id: 'market', name: '🛒 Market' },
  { id: 'school', name: '🏫 Məktəb' },
];
export const MAP_ITEMS = {
  market: ITEMS,
  school: [
    ['Riyaziyyat kitabı','#4f83cc'],['Azərbaycan dili kitabı','#d94c4c'],['İngilis dili kitabı','#e0b34d'],
    ['Tarix kitabı','#a66b42'],['Coğrafiya atlası','#55a7a0'],['Biologiya kitabı','#5a9b55'],
    ['Fizika kitabı','#6e79c9'],['Kimya kitabı','#a66ac2'],['Ədəbiyyat kitabı','#c96c91'],
    ['Dəftər','#e7eaf0'],['Lüğət','#d88a45'],['Ensiklopediya','#6386a8'],
    ['Həndəsə kitabı','#4d9cba'],['İnformatika kitabı','#556070'],['Rəsm albomu','#e8a8bc'],
    ['Musiqi kitabı','#9a79c7'],['Test toplusu','#dbdce2'],['Oxu kitabı','#a1b86a'],
    ['Şeir kitabı','#ce8fba'],['Nağıl kitabı','#e7a64a'],['Fizika dəftəri','#7aa6d8'],
    ['Qrammatika kitabı','#c76c5e'],['Xəritə kitabı','#5a9d83'],['Təcrübə dəftəri','#b2a05e'],
    ['Sözlük','#9a7b5e'],['İş dəftəri','#d0a2d8'],['Məntiq kitabı','#7d91b7'],
    ['Rəngli atlas','#e17d54'],['Oxu gündəliyi','#73a8a1'],['Kitabça','#d4bd78']
  ]
};
export function getMapItems(id = 'market') {
  return MAP_ITEMS[id] || ITEMS;
}
