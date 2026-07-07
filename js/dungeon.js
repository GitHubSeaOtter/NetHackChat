// ============================================================
// ダンジョン生成
// 部屋+短い通路の構成(迷路は作らない)。
// 特殊部屋: ショップ / モンスターハウス。宝箱・アイテム・敵を配置。
// ============================================================

const T_WALL = 0, T_FLOOR = 1, T_CORR = 2, T_STAIRS = 3,
      T_DOOR = 4, T_DOOR_OPEN = 5, T_SDOOR = 6; // T_SDOOR=隠しドア(見た目は壁)

const ri = n => Math.floor(Math.random() * n);
const pick = arr => arr[ri(arr.length)];

function roomsOverlap(a, b, pad) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
         a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

function roomCenter(r) {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

function carveCorridor(t, w, a, b) {
  // L字通路(迷路化しない)
  const horizFirst = Math.random() < 0.5;
  const put = (x, y) => { if (t[y * w + x] === T_WALL) t[y * w + x] = T_CORR; };
  let x = a.x, y = a.y;
  if (horizFirst) {
    while (x !== b.x) { x += Math.sign(b.x - x); put(x, y); }
    while (y !== b.y) { y += Math.sign(b.y - y); put(x, y); }
  } else {
    while (y !== b.y) { y += Math.sign(b.y - y); put(x, y); }
    while (x !== b.x) { x += Math.sign(b.x - x); put(x, y); }
  }
}

// ---------- アイテム生成 ----------
let ITEM_SEQ = 1;

function makeItem(kind, depth) {
  const id = ITEM_SEQ++;
  switch (kind) {
    case 'gold': {
      const amount = 5 + ri(10 + depth * 6);
      return { id, kind, name: `${amount}枚の金貨`, emoji: '💰', amount, value: amount };
    }
    case 'potion': {
      const look = pick(POTION_LOOKS);
      return { id, kind, name: `${look}ポーション`, emoji: '🧪', value: 40 + depth * 8 };
    }
    case 'scroll': {
      const label = pick(SCROLL_LABELS);
      return { id, kind, name: `「${label}」と書かれた巻物`, emoji: '📜', value: 60 + depth * 8 };
    }
    case 'food': {
      return { id, kind, name: pick(FOODS), emoji: '🍖', value: 25 };
    }
    case 'weapon': {
      const cands = WEAPONS.filter(x => x.minDepth <= depth);
      const spec = cands[cands.length - 1 - ri(Math.min(2, cands.length))];
      return { id, kind, name: spec.name, emoji: '🗡️', bonus: spec.bonus, value: 60 * spec.bonus };
    }
    case 'armor': {
      const cands = ARMORS.filter(x => x.minDepth <= depth);
      const spec = cands[cands.length - 1 - ri(Math.min(2, cands.length))];
      return { id, kind, name: spec.name, emoji: '🛡️', bonus: spec.bonus, value: 70 * spec.bonus };
    }
    case 'wand': {
      const look = pick(WAND_LOOKS);
      const spec = pickWandType();
      return {
        id, kind, name: `${look}杖`, emoji: '🪄',
        wandType: spec.id, trueName: spec.name, known: false,
        charges: 3 + ri(4), value: 120,
      };
    }
    case 'tool': {
      return { id, kind, name: 'ツルハシ', emoji: '⛏️', value: 80 };
    }
    case 'chest': {
      return { id, kind, name: '宝箱', emoji: '📦', value: 0 };
    }
  }
}

function randomItemKind() {
  const r = Math.random();
  if (r < 0.24) return 'potion';
  if (r < 0.40) return 'scroll';
  if (r < 0.52) return 'food';
  if (r < 0.70) return 'gold';
  if (r < 0.78) return 'weapon';
  if (r < 0.85) return 'armor';
  if (r < 0.95) return 'wand';
  return 'tool';
}

// ---------- モンスター生成 ----------
let MON_SEQ = 1;

function makeMonster(depth, typeId) {
  const cands = MONSTER_TYPES.filter(m => depth >= m.minDepth && depth <= m.maxDepth);
  const spec = typeId ? MONSTER_TYPES.find(m => m.id === typeId) : pick(cands.length ? cands : [MONSTER_TYPES[0]]);
  const scale = 1 + Math.max(0, depth - spec.minDepth) * 0.12;
  return {
    id: MON_SEQ++,
    typeId: spec.id,
    name: spec.name,
    emoji: spec.emoji,
    hp: Math.round(spec.hp * scale),
    maxHp: Math.round(spec.hp * scale),
    atk: Math.round(spec.atk * scale),
    def: spec.def,
    xp: spec.xp,
    drop: spec.drop,
    erratic: !!spec.erratic,
    peaceful: false,
    ally: false,
    scared: 0, sleep: 0,
    x: 0, y: 0,
  };
}

function makeShopkeeper() {
  return {
    id: MON_SEQ++, typeId: 'keeper', name: '店主', emoji: '🧑‍💼',
    hp: 70, maxHp: 70, atk: 14, def: 5, xp: 120, drop: 1,
    erratic: false, peaceful: true, ally: false, scared: 0, sleep: 0, x: 0, y: 0,
  };
}

// ---------- レベル生成 ----------
function genLevel(depth) {
  const w = 48, h = 32;
  const t = new Uint8Array(w * h); // 全部 T_WALL
  const rooms = [];

  for (let tries = 0; tries < 80 && rooms.length < 9; tries++) {
    const rw = 5 + ri(6), rh = 4 + ri(4);
    const rx = 1 + ri(w - rw - 2), ry = 1 + ri(h - rh - 2);
    const room = { x: rx, y: ry, w: rw, h: rh, type: 'normal', announced: false };
    if (rooms.some(o => roomsOverlap(o, room, 2))) continue;
    rooms.push(room);
  }

  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) t[y * w + x] = T_FLOOR;
    }
  }
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(t, w, roomCenter(rooms[i - 1]), roomCenter(rooms[i]));
  }

  // ドア設置: 部屋の周壁を貫く通路タイルのうち「戸口の形」
  // (垂直か水平どちらか一方の軸だけ両側が壁)のものをドアにする
  const tileOf = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? T_WALL : t[y * w + x];
  const isDoorway = (x, y) => {
    const horizWalls = tileOf(x - 1, y) === T_WALL && tileOf(x + 1, y) === T_WALL;
    const vertWalls = tileOf(x, y - 1) === T_WALL && tileOf(x, y + 1) === T_WALL;
    return horizWalls !== vertWalls;
  };
  for (const r of rooms) {
    const spots = [];
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      for (const y of [r.y - 1, r.y + r.h]) {
        if (tileOf(x, y) === T_CORR && isDoorway(x, y)) spots.push({ x, y });
      }
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      for (const x of [r.x - 1, r.x + r.w]) {
        if (tileOf(x, y) === T_CORR && isDoorway(x, y)) spots.push({ x, y });
      }
    }
    const doors = [];
    for (const s of spots) {
      if (Math.random() < 0.75) { t[s.y * w + s.x] = T_DOOR; doors.push(s); }
    }
    // 隠しドア: 出入口が2つ以上ある部屋に限って作る(閉じ込め防止)
    if (doors.length >= 2 && Math.random() < 0.35) {
      const s = pick(doors);
      t[s.y * w + s.x] = T_SDOOR;
    }
  }

  // 特殊部屋(開始部屋・階段部屋以外から選ぶ)
  const middle = rooms.slice(1, -1);
  if (middle.length >= 1 && Math.random() < 0.35) pick(middle).type = 'shop';
  const mhCands = middle.filter(r => r.type === 'normal');
  if (mhCands.length >= 1 && Math.random() < 0.3) pick(mhCands).type = 'mhouse';

  const startRoom = rooms[0];
  const stairsRoom = rooms[rooms.length - 1];
  const start = roomCenter(startRoom);
  const stairs = { x: stairsRoom.x + 1 + ri(stairsRoom.w - 2), y: stairsRoom.y + 1 + ri(stairsRoom.h - 2) };
  t[stairs.y * w + stairs.x] = T_STAIRS;

  const level = { w, h, t, rooms, start, stairs, depth };

  const randInRoom = r => ({ x: r.x + ri(r.w), y: r.y + ri(r.h) });
  const items = [];
  const monsters = [];
  const occupied = (x, y) =>
    (x === start.x && y === start.y) || (x === stairs.x && y === stairs.y) ||
    items.some(i => i.x === x && i.y === y) || monsters.some(m => m.x === x && m.y === y);

  const placeInRoom = (r, obj) => {
    for (let k = 0; k < 30; k++) {
      const p = randInRoom(r);
      if (!occupied(p.x, p.y)) { obj.x = p.x; obj.y = p.y; return true; }
    }
    return false;
  };

  // 通常アイテム・宝箱・金貨
  const normalRooms = rooms.filter(r => r.type === 'normal');
  const itemCount = 4 + ri(3);
  for (let i = 0; i < itemCount; i++) {
    const it = makeItem(randomItemKind(), depth);
    if (placeInRoom(pick(normalRooms), it)) items.push(it);
  }
  const chestCount = ri(3); // 0-2
  for (let i = 0; i < chestCount; i++) {
    const c = makeItem('chest', depth);
    if (placeInRoom(pick(normalRooms), c)) items.push(c);
  }

  // 通常モンスター
  const monCount = 3 + Math.min(8, depth) + ri(3);
  for (let i = 0; i < monCount; i++) {
    const m = makeMonster(depth);
    const r = pick(rooms.filter(x => x !== startRoom && x.type !== 'shop'));
    if (r && placeInRoom(r, m)) monsters.push(m);
  }

  // ショップ
  for (const r of rooms) {
    if (r.type !== 'shop') continue;
    const keeper = makeShopkeeper();
    if (placeInRoom(r, keeper)) monsters.push(keeper);
    const n = 3 + ri(3);
    for (let i = 0; i < n; i++) {
      const it = makeItem(pick(['potion', 'scroll', 'food', 'weapon', 'armor', 'wand', 'tool']), depth);
      it.price = Math.round(it.value * (1.2 + Math.random() * 0.6));
      if (placeInRoom(r, it)) items.push(it);
    }
  }

  // モンスターハウス
  for (const r of rooms) {
    if (r.type !== 'mhouse') continue;
    const n = 5 + ri(4);
    for (let i = 0; i < n; i++) {
      const m = makeMonster(Math.min(depth + 1, 99));
      if (placeInRoom(r, m)) monsters.push(m);
    }
    for (let i = 0; i < 3 + ri(3); i++) {
      const it = makeItem(randomItemKind(), depth);
      if (placeInRoom(r, it)) items.push(it);
    }
  }

  level.items = items;
  level.monsters = monsters;
  return level;
}
