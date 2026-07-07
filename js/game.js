// ============================================================
// ゲームエンジン
// 成長・アイテムはゲーム内のみ(次のプレイに持ち越さない)。
// ============================================================

const DIRS = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1],
};
const DIR_NAMES = { n: '北', s: '南', e: '東', w: '西', ne: '北東', nw: '北西', se: '南東', sw: '南西' };

const G = {
  char: null, storedCharId: null,
  depth: 1, level: null,
  explored: null, visible: null,
  player: null, pet: null,
  msgs: [], turn: 0,
  over: false, overInfo: null,
  prayedDepth: 0,
};

function addMsg(text, cls) {
  G.msgs.push({ text, cls: cls || '' });
  if (G.msgs.length > 200) G.msgs.shift();
}

// ---------- 開始・フロア移動 ----------
function startGame(character) {
  G.char = JSON.parse(JSON.stringify(character));
  G.storedCharId = character.id;
  G.depth = 1;
  G.turn = 0;
  G.over = false;
  G.overInfo = null;
  G.msgs = [];
  G.prayedDepth = 0;
  const s = character.stats;
  G.player = {
    x: 0, y: 0,
    maxHp: 12 + s.con, hp: 12 + s.con,
    level: 1, xp: 0, gold: 20 + s.cha,
    weapon: null, armor: null,
    inventory: [],
    buffAtk: null, buffDef: null,
  };
  G.pet = { name: '相棒の子犬', emoji: '🐕', hp: 12, maxHp: 12, atk: 3, alive: true, x: 0, y: 0 };
  enterLevel(1);
  addMsg(`${character.name}(${character.clazz})は子犬を連れて迷宮に足を踏み入れた。`, 'm-good');
}

function enterLevel(depth) {
  G.depth = depth;
  G.level = genLevel(depth);
  G.explored = new Uint8Array(G.level.w * G.level.h);
  G.visible = new Uint8Array(G.level.w * G.level.h);
  G.player.x = G.level.start.x;
  G.player.y = G.level.start.y;
  if (G.pet.alive) placeAdjacent(G.pet, G.player.x, G.player.y);
  computeFov();
}

function placeAdjacent(unit, x, y) {
  for (const k of Object.keys(DIRS)) {
    const [dx, dy] = DIRS[k];
    if (walkable(x + dx, y + dy) && !unitAt(x + dx, y + dy)) {
      unit.x = x + dx; unit.y = y + dy; return;
    }
  }
  unit.x = x; unit.y = y;
}

// ---------- 参照ヘルパー ----------
function inBounds(x, y) { return x >= 0 && y >= 0 && x < G.level.w && y < G.level.h; }
function tileAt(x, y) { return inBounds(x, y) ? G.level.t[y * G.level.w + x] : T_WALL; }
function setTile(x, y, t) { if (inBounds(x, y)) G.level.t[y * G.level.w + x] = t; }
function walkable(x, y) {
  const t = tileAt(x, y);
  return t !== T_WALL && t !== T_DOOR && t !== T_SDOOR; // 閉じたドア・隠しドアは通れない
}
function opaque(x, y) {
  const t = tileAt(x, y);
  return t === T_WALL || t === T_DOOR || t === T_SDOOR; // 視線を遮る
}
function monsterAt(x, y) { return G.level.monsters.find(m => m.x === x && m.y === y); }
function itemsAt(x, y) { return G.level.items.filter(i => i.x === x && i.y === y); }
function unitAt(x, y) {
  if (G.player.x === x && G.player.y === y) return G.player;
  if (G.pet.alive && G.pet.x === x && G.pet.y === y) return G.pet;
  return monsterAt(x, y);
}
function roomAt(x, y) {
  return G.level.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}
function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function removeItem(it) { G.level.items = G.level.items.filter(i => i !== it); }
function removeMonster(m) { G.level.monsters = G.level.monsters.filter(x => x !== m); }
function hostiles() { return G.level.monsters.filter(m => !m.peaceful && !m.ally); }
function isVisible(x, y) { return !!G.visible[y * G.level.w + x]; }

function playerAtk() {
  const p = G.player;
  return 2 + Math.floor(G.char.stats.str / 3) + (p.weapon ? p.weapon.bonus : 0) +
         Math.floor(p.level / 2) + (p.buffAtk ? p.buffAtk.amt : 0);
}
function playerDef() {
  const p = G.player;
  return Math.floor(G.char.stats.dex / 4) + (p.armor ? p.armor.bonus : 0) + (p.buffDef ? p.buffDef.amt : 0);
}

// ---------- 視界 ----------
function los(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0) && opaque(x, y)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function computeFov() {
  const R = 7, p = G.player, w = G.level.w;
  G.visible.fill(0);
  for (let y = Math.max(0, p.y - R); y <= Math.min(G.level.h - 1, p.y + R); y++) {
    for (let x = Math.max(0, p.x - R); x <= Math.min(w - 1, p.x + R); x++) {
      if (Math.hypot(x - p.x, y - p.y) > R + 0.5) continue;
      if (los(p.x, p.y, x, y)) { G.visible[y * w + x] = 1; G.explored[y * w + x] = 1; }
    }
  }
}

// ---------- プレイヤー行動 ----------
function tryStep(dx, dy) {
  if (G.over) return false;
  const p = G.player, nx = p.x + dx, ny = p.y + dy;
  if (!inBounds(nx, ny)) return false;
  const m = monsterAt(nx, ny);
  if (m) {
    if (m.ally) { addMsg(`${m.name}が場所を譲ってくれた。`); [m.x, m.y] = [p.x, p.y]; [p.x, p.y] = [nx, ny]; onEnterTile(); endTurn(); return true; }
    if (m.peaceful) {
      if (m.typeId === 'keeper') addMsg('「商品は大事に扱ってくれよ」と店主が言った。');
      else addMsg(`${m.name}は敵意がないようだ。`);
      endTurn(); return true;
    }
    meleeAttack(m); endTurn(); return true;
  }
  if (G.pet.alive && G.pet.x === nx && G.pet.y === ny) {
    [G.pet.x, G.pet.y] = [p.x, p.y];
    [p.x, p.y] = [nx, ny];
    addMsg(`${G.pet.name}と入れ替わった。`);
    onEnterTile(); endTurn(); return true;
  }
  if (tileAt(nx, ny) === T_DOOR) {
    setTile(nx, ny, T_DOOR_OPEN);
    addMsg('ドアを開けた。');
    endTurn();
    return true;
  }
  if (!walkable(nx, ny)) return false;
  p.x = nx; p.y = ny;
  onEnterTile();
  endTurn();
  return true;
}

function onEnterTile() {
  const p = G.player;
  for (const g of itemsAt(p.x, p.y).filter(i => i.kind === 'gold' && !i.price)) {
    p.gold += g.amount;
    removeItem(g);
    addMsg(`${g.amount}枚の金貨を拾った(所持金 ${p.gold}G)。`, 'm-good');
  }
  for (const it of itemsAt(p.x, p.y)) {
    if (it.kind === 'chest') addMsg('宝箱がある。「開ける」で開けられる。');
    else if (it.price) addMsg(`${it.name}が売られている(価格 ${it.price}G)。「拾う」で購入できる。`);
    else addMsg(`${it.name}が落ちている。`);
  }
  if (tileAt(p.x, p.y) === T_STAIRS) addMsg('下り階段がある。「降りる」で次の階へ。');
  const room = roomAt(p.x, p.y);
  if (room && !room.announced) {
    room.announced = true;
    if (room.type === 'mhouse') {
      addMsg('モンスターハウスだ!!', 'm-warn');
    } else if (room.type === 'shop') {
      addMsg('「いらっしゃい! 掘り出し物が揃ってるよ」と店主が声をかけてきた。');
    }
  }
}

function meleeAttack(m) {
  const dmg = Math.max(1, playerAtk() + Math.floor(Math.random() * 3) - m.def);
  if (m.peaceful && m.typeId === 'keeper') {
    m.peaceful = false;
    addMsg('店主が激怒した! 「泥棒め!!」', 'm-warn');
  }
  damageMonster(m, dmg, G.char.name);
}

function damageMonster(m, dmg, srcName) {
  m.hp -= dmg;
  m.sleep = 0; // 攻撃されると目を覚ます
  if (m.hp <= 0) {
    addMsg(`${srcName}は${m.name}を倒した!`, 'm-good');
    killMonster(m);
  } else {
    addMsg(`${srcName}の攻撃! ${m.name}に${dmg}のダメージ。`);
  }
}

function killMonster(m) {
  removeMonster(m);
  if (!m.ally) gainXp(m.xp);
  // 敵はアイテムをドロップする
  if (!m.ally && Math.random() < m.drop) {
    const it = Math.random() < 0.45 ? makeItem('gold', G.depth) : makeItem(randomItemKind(), G.depth);
    it.x = m.x; it.y = m.y;
    G.level.items.push(it);
    addMsg(`${m.name}は${it.name}を落とした。`);
  }
}

function gainXp(n) {
  const p = G.player;
  p.xp += n;
  while (p.xp >= p.level * 15) {
    p.xp -= p.level * 15;
    p.level++;
    const up = 4 + Math.floor(G.char.stats.con / 6);
    p.maxHp += up;
    p.hp = Math.min(p.maxHp, p.hp + up);
    addMsg(`レベル${p.level}に上がった! 最大HPが${up}増えた。`, 'm-good');
  }
}

function doWait() { if (!G.over) { addMsg('様子をうかがった。'); endTurn(); } }

function doPickup() {
  if (G.over) return;
  const p = G.player;
  const here = itemsAt(p.x, p.y).filter(i => i.kind !== 'chest');
  if (!here.length) { addMsg('ここには拾える物がない。'); return; }
  const it = here[0];
  if (it.price) {
    if (p.gold < it.price) { addMsg(`所持金が足りない(${it.price}G 必要)。店主がじっと見ている。`, 'm-warn'); return; }
    p.gold -= it.price;
    addMsg(`${it.name}を${it.price}Gで購入した。「まいど!」`, 'm-good');
    delete it.price;
  } else if (it.kind === 'gold') {
    p.gold += it.amount;
    removeItem(it);
    addMsg(`${it.amount}枚の金貨を拾った。`, 'm-good');
    endTurn(); return;
  } else {
    addMsg(`${it.name}を拾った。`, 'm-good');
  }
  if (G.player.inventory.length >= 20) { addMsg('持ち物がいっぱいだ!', 'm-warn'); return; }
  removeItem(it);
  G.player.inventory.push(it);
  endTurn();
}

function doDescend() {
  if (G.over) return;
  if (tileAt(G.player.x, G.player.y) !== T_STAIRS) { addMsg('ここに階段はない。'); return; }
  enterLevel(G.depth + 1);
  G.prayedDepth = 0;
  addMsg(`地下${G.depth}階に降りた。空気が重くなってきた…`, 'm-good');
  if (window.UI) UI.refresh();
}

function adjacentTiles(pred) {
  const out = [];
  for (const k of Object.keys(DIRS)) {
    const [dx, dy] = DIRS[k];
    const x = G.player.x + dx, y = G.player.y + dy;
    if (pred(tileAt(x, y))) out.push({ dir: k, x, y });
  }
  return out;
}

function doOpen() {
  if (G.over) return;
  const chest = itemsAt(G.player.x, G.player.y).find(i => i.kind === 'chest');
  if (!chest) {
    const doors = adjacentTiles(t => t === T_DOOR);
    if (doors.length === 1) {
      setTile(doors[0].x, doors[0].y, T_DOOR_OPEN);
      addMsg('ドアを開けた。');
      endTurn(); return;
    }
    if (doors.length > 1) {
      if (window.UI) UI.requestDirection('どのドアを開ける?', d => {
        const s = doors.find(o => o.dir === d);
        if (s) { setTile(s.x, s.y, T_DOOR_OPEN); addMsg('ドアを開けた。'); endTurn(); }
        else addMsg('そちらにドアはない。');
        if (window.UI) UI.refresh();
      });
      return;
    }
    addMsg('ここに開けられる物はない。'); return;
  }
  removeItem(chest);
  if (Math.random() < 0.15) {
    const dmg = 3 + Math.floor(Math.random() * G.depth * 2);
    G.player.hp -= dmg;
    addMsg(`罠だ! 針が飛び出して${dmg}のダメージ!`, 'm-warn');
    if (!checkDeath('宝箱の罠')) endTurn();
    return;
  }
  const n = 1 + Math.floor(Math.random() * 3);
  addMsg(`宝箱を開けた! 中から${n}個の何かが転がり出た。`, 'm-good');
  for (let i = 0; i < n; i++) {
    const it = makeItem(randomItemKind(), G.depth);
    it.x = G.player.x; it.y = G.player.y;
    G.level.items.push(it);
  }
  onEnterTile();
  endTurn();
}

function doSearch() {
  if (G.over) return;
  // 隠しドアの探索(NetHackの s コマンド相当)
  let found = false;
  for (const s of adjacentTiles(t => t === T_SDOOR)) {
    if (Math.random() < 0.45) {
      setTile(s.x, s.y, T_DOOR);
      addMsg(`${DIR_NAMES[s.dir]}の壁に隠しドアを発見した!`, 'm-good');
      found = true;
    }
  }
  if (!found) {
    if (Math.random() < 0.15) {
      const g = 3 + Math.floor(Math.random() * 10);
      G.player.gold += g;
      addMsg(`床の隙間から${g}枚の金貨を見つけた!`, 'm-good');
    } else {
      addMsg('周囲を調べたが、何も見つからなかった。');
    }
  }
  endTurn();
}

function doClose() {
  if (G.over) return;
  const doors = adjacentTiles(t => t === T_DOOR_OPEN);
  if (!doors.length) { addMsg('閉められるドアが近くにない。'); return; }
  const closeAt = s => {
    if (unitAt(s.x, s.y) || itemsAt(s.x, s.y).length) { addMsg('何かがつっかえていて閉まらない。'); return; }
    setTile(s.x, s.y, T_DOOR);
    addMsg('ドアを閉めた。');
    endTurn();
  };
  if (doors.length === 1) { closeAt(doors[0]); return; }
  if (window.UI) UI.requestDirection('どのドアを閉める?', d => {
    const s = doors.find(o => o.dir === d);
    if (s) closeAt(s); else addMsg('そちらにドアはない。');
    if (window.UI) UI.refresh();
  });
}

function doKick(dirKey) {
  if (G.over) return;
  const run = d => {
    const [dx, dy] = DIRS[d];
    const x = G.player.x + dx, y = G.player.y + dy;
    const m = monsterAt(x, y);
    if (m) {
      if (m.peaceful && m.typeId === 'keeper') { m.peaceful = false; addMsg('店主が激怒した! 「泥棒め!!」', 'm-warn'); }
      m.sleep = 0;
      damageMonster(m, Math.max(1, 2 + Math.floor(G.char.stats.str / 4) - m.def), 'キック');
      endTurn(); return;
    }
    const t = tileAt(x, y);
    if (t === T_DOOR) {
      if (Math.random() < 0.5) {
        setTile(x, y, T_DOOR_OPEN);
        addMsg('バキッ! ドアを蹴破った!', 'm-good');
      } else {
        addMsg('ドアはびくともしない。つま先が痛い…', 'm-warn');
        G.player.hp -= 1;
        checkDeath('ドアへのキック');
      }
      if (!G.over) endTurn(); return;
    }
    const chest = itemsAt(x, y).find(i => i.kind === 'chest');
    if (chest) { addMsg('宝箱を蹴った。ゴトッと音がしただけだった。'); endTurn(); return; }
    if (t === T_WALL || t === T_SDOOR) {
      addMsg('壁を思い切り蹴った。痛い!!', 'm-warn');
      G.player.hp -= 2;
      if (!checkDeath('壁へのキック')) endTurn();
      return;
    }
    addMsg('空を蹴った。バランスを崩しそうになった。');
    endTurn();
  };
  if (dirKey && DIRS[dirKey]) run(dirKey);
  else if (window.UI) UI.requestDirection('どの方向を蹴る?', d => { run(d); if (window.UI) UI.refresh(); });
}

function doPray() {
  if (G.over) return;
  if (G.prayedDepth >= 2) {
    const dmg = 5;
    G.player.hp -= dmg;
    addMsg(`神は祈りすぎに苛立った! 雷が落ちて${dmg}のダメージ!`, 'm-warn');
    if (!checkDeath('神罰')) endTurn();
    return;
  }
  G.prayedDepth++;
  if (G.player.hp < G.player.maxHp * 0.35) {
    G.player.hp = G.player.maxHp;
    addMsg('神は汝を憐れんだ。全身が光に包まれ、傷が癒えた!', 'm-good');
  } else {
    addMsg('あなたは祈った。空気がわずかに温かくなった気がする。');
  }
  endTurn();
}

// ---------- アイテム補助 ----------
function itemLabel(it) {
  let base = it.name;
  if (it.kind === 'wand') base = `${it.known ? it.trueName : it.name}(残り${it.charges}回)`;
  return base;
}

function unequipIfEquipped(it) {
  if (G.player.weapon === it) G.player.weapon = null;
  if (G.player.armor === it) G.player.armor = null;
}

function canSellHere() {
  const room = roomAt(G.player.x, G.player.y);
  if (!room || room.type !== 'shop') return false;
  return G.level.monsters.some(m => m.typeId === 'keeper' && m.peaceful);
}

// ---------- 捨てる ----------
function dropItem(idx) {
  if (G.over) return;
  const it = G.player.inventory[idx];
  if (!it) { addMsg('そのアイテムは持っていない。'); return; }
  unequipIfEquipped(it);
  G.player.inventory.splice(idx, 1);
  it.x = G.player.x; it.y = G.player.y;
  G.level.items.push(it);
  addMsg(`${itemLabel(it)}を足元に置いた。`);
  endTurn();
}

// ---------- 売る(ショップ内のみ) ----------
function sellItem(idx) {
  if (G.over) return;
  if (!canSellHere()) { addMsg('ここでは売れない。店主のいる店の中で売ろう。'); return; }
  const it = G.player.inventory[idx];
  if (!it) { addMsg('そのアイテムは持っていない。'); return; }
  const price = Math.max(3, Math.floor((it.value || 10) / 2));
  unequipIfEquipped(it);
  G.player.inventory.splice(idx, 1);
  G.player.gold += price;
  // 売った品は店の商品として床に並ぶ
  it.price = Math.max(5, Math.round((it.value || 10) * 1.4));
  it.x = G.player.x; it.y = G.player.y;
  G.level.items.push(it);
  addMsg(`${itemLabel(it)}を${price}Gで売った。「いい品だね、まいど!」`, 'm-good');
  endTurn();
}

// ---------- 方向指定つき行動(投げる/杖を振る/掘る) ----------
// 自由入力で方向の指示が無い場合は、UI側の方向ボタン入力で指定させる
function prepareTargeted(kind, idx, dirKey) {
  const it = G.player.inventory[idx];
  if (!it) { addMsg('そのアイテムは持っていない。'); return; }
  if (kind === 'zap' && it.kind !== 'wand') { addMsg(`${itemLabel(it)}は振っても何も起きなさそうだ。`); return; }
  if (kind === 'dig' && it.kind !== 'tool') { addMsg('それでは掘れない。'); return; }
  const run = d => {
    const i = G.player.inventory.indexOf(it);
    if (i < 0) { addMsg('そのアイテムはもう手元にない。'); return; }
    if (kind === 'throw') throwItem(i, d);
    else if (kind === 'zap') zapWand(i, d);
    else digDir(d);
    if (window.UI) UI.refresh();
  };
  if (dirKey && dirKey !== 'none' && DIRS[dirKey]) { run(dirKey); return; }
  const labels = { throw: `${itemLabel(it)}をどの方向に投げる?`, zap: `${itemLabel(it)}をどの方向に振る?`, dig: 'どの方向を掘る?' };
  if (window.UI) UI.requestDirection(labels[kind], run);
}

// ---------- 投げる ----------
function throwItem(idx, dirKey) {
  if (G.over) return;
  const p = G.player;
  const it = p.inventory[idx];
  if (!it) { addMsg('そのアイテムは持っていない。'); return; }
  unequipIfEquipped(it);
  p.inventory.splice(idx, 1); // 消費(手元から確実に離れる)
  const [dx, dy] = DIRS[dirKey];
  let x = p.x, y = p.y, hit = null, hitPet = false;
  for (let i = 0; i < 6; i++) {
    const nx = x + dx, ny = y + dy;
    if (!walkable(nx, ny)) break;
    x = nx; y = ny;
    const m = monsterAt(x, y);
    if (m) { hit = m; break; }
    if (G.pet.alive && G.pet.x === x && G.pet.y === y) { hitPet = true; break; }
  }
  addMsg(`${itemLabel(it)}を${DIR_NAMES[dirKey]}へ投げた。`);
  if (hit) {
    if (hit.peaceful && hit.typeId === 'keeper') { hit.peaceful = false; addMsg('店主が激怒した! 「泥棒め!!」', 'm-warn'); }
    hit.sleep = 0;
    let dmg = 1;
    if (it.kind === 'weapon') dmg = 3 + it.bonus * 2 + Math.floor(G.char.stats.str / 4);
    else if (it.kind === 'potion') dmg = 2;
    damageMonster(hit, dmg, '投擲');
  } else if (hitPet) {
    addMsg(`わっ! ${G.pet.name}が慌てて飛びのいた。`);
  } else {
    addMsg('何にも当たらなかった。');
  }
  if (it.kind === 'potion') {
    addMsg('薬瓶は砕け散った。');
  } else {
    it.x = x; it.y = y;
    G.level.items.push(it); // 落下地点に残る
  }
  endTurn();
}

// ---------- 杖を振る(効果対象は方向から決定論的に解決) ----------
function beamTiles(dx, dy, range) {
  const tiles = [];
  let x = G.player.x, y = G.player.y;
  for (let i = 0; i < range; i++) {
    x += dx; y += dy;
    if (!inBounds(x, y) || opaque(x, y)) break;
    tiles.push({ x, y });
  }
  return tiles;
}

function zapWand(idx, dirKey) {
  if (G.over) return;
  const it = G.player.inventory[idx];
  if (!it || it.kind !== 'wand') { addMsg('それは杖ではない。'); return; }
  if (it.charges <= 0) {
    addMsg(`${itemLabel(it)}を振ったが、うんともすんとも言わない。使い切ったようだ。`);
    endTurn(); return;
  }
  it.charges--;
  const [dx, dy] = DIRS[dirKey];
  addMsg(`${it.known ? it.trueName : it.name}を${DIR_NAMES[dirKey]}へ振った。`);
  if (!it.known) { it.known = true; addMsg(`(それは${it.trueName}だった!)`, 'm-good'); }
  const angerIfKeeper = m => {
    if (m.peaceful && m.typeId === 'keeper') { m.peaceful = false; addMsg('店主が激怒した!', 'm-warn'); }
  };
  switch (it.wandType) {
    case 'striking': {
      const m = beamTiles(dx, dy, 7).map(t => monsterAt(t.x, t.y)).find(Boolean);
      if (m) { angerIfKeeper(m); m.sleep = 0; damageMonster(m, 10 + Math.floor(Math.random() * 8), '魔力の一撃'); }
      else addMsg('魔力の弾は何にも当たらず消えた。');
      break;
    }
    case 'sleep': {
      const m = beamTiles(dx, dy, 7).map(t => monsterAt(t.x, t.y)).find(Boolean);
      if (m) { m.sleep = 6 + Math.floor(Math.random() * 6); addMsg(`${m.name}はぐっすり眠り込んだ!`, 'm-good'); }
      else addMsg('眠りの光は虚空に消えた。');
      break;
    }
    case 'fire': {
      const targets = beamTiles(dx, dy, 7).map(t => monsterAt(t.x, t.y)).filter(Boolean);
      addMsg('杖の先から炎の奔流がほとばしった!', 'm-warn');
      for (const m of targets) { angerIfKeeper(m); m.sleep = 0; damageMonster(m, 7 + Math.floor(Math.random() * 6), '炎'); }
      if (!targets.length) addMsg('炎は誰も焼かずに消えた。');
      break;
    }
    case 'digging': {
      let x = G.player.x, y = G.player.y, dug = 0;
      for (let i = 0; i < 6; i++) {
        x += dx; y += dy;
        if (!digTile(x, y) && !walkable(x, y)) break;
        if (tileAt(x, y) === T_CORR) dug++;
      }
      addMsg(dug ? '土煙とともに壁が崩れ、道ができた!' : '掘れるものが無かった。');
      break;
    }
    case 'teleport': {
      const m = beamTiles(dx, dy, 7).map(t => monsterAt(t.x, t.y)).find(Boolean);
      if (m) {
        for (let k = 0; k < 200; k++) {
          const tx = 1 + Math.floor(Math.random() * (G.level.w - 2));
          const ty = 1 + Math.floor(Math.random() * (G.level.h - 2));
          if (walkable(tx, ty) && !unitAt(tx, ty)) { m.x = tx; m.y = ty; break; }
        }
        addMsg(`${m.name}の姿がかき消えた!`, 'm-good');
      } else addMsg('光は誰にも当たらなかった。');
      break;
    }
  }
  endTurn();
}

// ---------- 掘る(ツルハシ / 穴掘りの杖) ----------
function digTile(x, y) {
  if (x <= 0 || y <= 0 || x >= G.level.w - 1 || y >= G.level.h - 1) return false; // 外周は掘れない
  const t = tileAt(x, y);
  if (t === T_WALL || t === T_SDOOR || t === T_DOOR) { setTile(x, y, T_CORR); return true; }
  return false;
}

function digDir(dirKey) {
  if (G.over) return;
  const [dx, dy] = DIRS[dirKey];
  const x = G.player.x + dx, y = G.player.y + dy;
  if (digTile(x, y)) {
    addMsg(`ツルハシで${DIR_NAMES[dirKey]}の壁を掘り抜いた!`, 'm-good');
  } else {
    addMsg('そこは掘れない。');
    return;
  }
  endTurn();
}

// ---------- アイテム使用(効果はAIが都度判定) ----------
async function useItem(idx) {
  if (G.over) return;
  const p = G.player;
  const it = p.inventory[idx];
  if (!it) { addMsg('そのアイテムは持っていない。'); return; }

  if (it.kind === 'weapon') {
    p.weapon = (p.weapon === it) ? null : it;
    addMsg(p.weapon ? `${it.name}を装備した(攻撃+${it.bonus})。` : `${it.name}を外した。`);
    endTurn(); return;
  }
  if (it.kind === 'armor') {
    p.armor = (p.armor === it) ? null : it;
    addMsg(p.armor ? `${it.name}を装備した(防御+${it.bonus})。` : `${it.name}を脱いだ。`);
    endTurn(); return;
  }
  if (it.kind === 'food') {
    p.inventory.splice(idx, 1);
    const heal = 4 + Math.floor(Math.random() * 5);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    addMsg(`${it.name}を食べた。おいしい! HPが${heal}回復した。`, 'm-good');
    endTurn(); return;
  }
  if (it.kind === 'wand') { prepareTargeted('zap', idx); return; }
  if (it.kind === 'tool') { prepareTargeted('dig', idx); return; }

  // ポーション・巻物: AIが効果を判定
  let res;
  try {
    if (window.UI) UI.showBusy('AIが効果を判定しています…');
    res = await aiItemEffect(it, stateSummary(), G.char);
  } catch (e) {
    res = localItemEffect(it);
    addMsg(e instanceof ApiKeyMissingError
      ? '(APIキー未設定のため運任せの判定になった)'
      : '(AIに繋がらなかったので運任せの判定になった)', 'm-warn');
  } finally {
    if (window.UI) UI.hideBusy();
  }
  p.inventory.splice(p.inventory.indexOf(it), 1);
  addMsg(`${it.name}を${it.kind === 'scroll' ? '読んだ' : '飲んだ'}。`);
  addMsg(res.narration, 'm-ai');
  if (res.item_true_name) addMsg(`(それは${res.item_true_name}だったようだ)`);
  applyEffect(res.effect, res.power || 0);
  if (!G.over) endTurn();
}

// ---------- 効果適用 ----------
function applyEffects(list) {
  for (const e of (list || []).slice(0, 2)) applyEffect(e.effect, e.power || 0);
}

function applyEffect(effect, power) {
  const p = G.player;
  const pw = Math.max(0, Math.min(20, Math.round(power)));
  switch (effect) {
    case 'heal': {
      const n = Math.max(3, pw);
      p.hp = Math.min(p.maxHp, p.hp + n);
      addMsg(`HPが${n}回復した。`, 'm-good');
      break;
    }
    case 'damage_self': {
      const n = Math.max(1, pw);
      p.hp -= n;
      addMsg(`${n}のダメージを受けた!`, 'm-warn');
      checkDeath('不運な出来事');
      break;
    }
    case 'damage_adjacent': {
      const targets = hostiles().filter(m => dist(m, p) <= 1);
      for (const m of targets) damageMonster(m, Math.max(1, pw), '衝撃');
      if (!targets.length) addMsg('しかし周囲に敵はいなかった。');
      break;
    }
    case 'damage_visible': {
      const targets = hostiles().filter(m => isVisible(m.x, m.y));
      for (const m of targets) damageMonster(m, Math.max(1, Math.ceil(pw * 0.8)), '波動');
      if (!targets.length) addMsg('しかし見える範囲に敵はいなかった。');
      break;
    }
    case 'teleport': {
      for (let k = 0; k < 200; k++) {
        const x = 1 + Math.floor(Math.random() * (G.level.w - 2));
        const y = 1 + Math.floor(Math.random() * (G.level.h - 2));
        if (walkable(x, y) && !unitAt(x, y)) { p.x = x; p.y = y; break; }
      }
      addMsg('景色が一瞬で切り替わった!');
      computeFov();
      onEnterTile();
      break;
    }
    case 'reveal_map':
      G.explored.fill(1);
      addMsg('フロア全体の構造が頭に流れ込んできた!', 'm-good');
      break;
    case 'spawn_item': {
      const it = makeItem(randomItemKind(), G.depth);
      it.x = p.x; it.y = p.y;
      G.level.items.push(it);
      addMsg(`足元に${it.name}が現れた!`, 'm-good');
      break;
    }
    case 'spawn_monster': {
      const n = pw >= 10 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const m = makeMonster(G.depth);
        placeAdjacent(m, p.x, p.y);
        if (!unitAt(m.x, m.y) || (m.x === p.x && m.y === p.y)) placeAdjacent(m, p.x, p.y);
        G.level.monsters.push(m);
        addMsg(`${m.name}が現れた!`, 'm-warn');
      }
      break;
    }
    case 'buff_attack':
      p.buffAtk = { amt: Math.max(1, Math.ceil(pw / 3)), turns: 12 };
      addMsg(`攻撃力が上がった(+${p.buffAtk.amt} / 12ターン)。`, 'm-good');
      break;
    case 'buff_defense':
      p.buffDef = { amt: Math.max(1, Math.ceil(pw / 3)), turns: 12 };
      addMsg(`防御力が上がった(+${p.buffDef.amt} / 12ターン)。`, 'm-good');
      break;
    case 'scare_enemies': {
      const targets = hostiles().filter(m => isVisible(m.x, m.y));
      for (const m of targets) m.scared = 5 + pw;
      addMsg(targets.length ? '敵たちが怯えて後ずさった!' : 'あたりに怯える者はいなかった。');
      break;
    }
    case 'tame_adjacent': {
      const m = hostiles().find(x => dist(x, p) <= 1);
      if (m) {
        m.ally = true; m.peaceful = true; m.scared = 0;
        addMsg(`${m.name}はあなたに懐いた! 仲間になった。`, 'm-good');
      } else {
        addMsg('しかし隣に手なずけられる相手はいなかった。');
      }
      break;
    }
    case 'gain_gold': {
      const n = Math.max(5, pw * 5);
      p.gold += n;
      addMsg(`${n}枚の金貨を手に入れた!`, 'm-good');
      break;
    }
    case 'lose_gold': {
      const n = Math.min(p.gold, Math.max(5, pw * 5));
      p.gold -= n;
      addMsg(`${n}枚の金貨がこぼれ落ちて消えた…`, 'm-warn');
      break;
    }
    case 'satiate':
      p.hp = Math.min(p.maxHp, p.hp + 3);
      addMsg('少し元気が出た。');
      break;
    case 'nothing':
    default:
      break;
  }
}

// ---------- 自由入力 ----------
async function handleFreeform(text) {
  if (G.over) return;
  const r = await aiInterpret(text, stateSummary(), G.char);
  if (r.kind === 'command') {
    switch (r.command) {
      case 'move': {
        const d = DIRS[r.direction];
        if (d) { if (!tryStep(d[0], d[1])) addMsg('そちらへは進めない。'); }
        else addMsg('どの方向か分からなかった。');
        break;
      }
      case 'use_item':
        if (r.item_index >= 0 && r.item_index < G.player.inventory.length) await useItem(r.item_index);
        else addMsg('どのアイテムのことか分からなかった。');
        break;
      case 'pickup': doPickup(); break;
      case 'descend': doDescend(); break;
      case 'open': doOpen(); break;
      case 'close': doClose(); break;
      case 'search': doSearch(); break;
      case 'wait': doWait(); break;
      case 'pray': doPray(); break;
      case 'kick': doKick(r.direction !== 'none' ? r.direction : null); break;
      case 'throw':
        if (r.item_index >= 0 && r.item_index < G.player.inventory.length) prepareTargeted('throw', r.item_index, r.direction);
        else addMsg('どのアイテムを投げるのか分からなかった。');
        break;
      case 'zap':
        if (r.item_index >= 0 && r.item_index < G.player.inventory.length) prepareTargeted('zap', r.item_index, r.direction);
        else addMsg('どの杖を振るのか分からなかった。');
        break;
      case 'drop':
        if (r.item_index >= 0 && r.item_index < G.player.inventory.length) dropItem(r.item_index);
        else addMsg('どのアイテムを捨てるのか分からなかった。');
        break;
      case 'sell':
        if (r.item_index >= 0 && r.item_index < G.player.inventory.length) sellItem(r.item_index);
        else addMsg('どのアイテムを売るのか分からなかった。');
        break;
      default: addMsg(r.narration || 'うまく行動に移せなかった。', 'm-ai');
    }
  } else if (r.kind === 'special') {
    addMsg(r.narration, 'm-ai');
    applyEffects(r.effects);
    if (!G.over) endTurn();
  } else {
    addMsg(r.narration || '(意図がうまく伝わらなかったようだ)', 'm-ai');
  }
}

// ---------- 状態サマリ(AIへの入力) ----------
function stateSummary() {
  const p = G.player;
  const lines = [];
  lines.push(`迷宮: 地下${G.depth}階(ターン${G.turn})`);
  lines.push(`HP: ${p.hp}/${p.maxHp} / レベル${p.level} / 所持金${p.gold}G`);
  const here = itemsAt(p.x, p.y);
  lines.push(`足元: ${here.length ? here.map(i => i.name + (i.price ? `(価格${i.price}G)` : '')).join('、') : (tileAt(p.x, p.y) === T_STAIRS ? '下り階段' : '何もない')}`);
  const room = roomAt(p.x, p.y);
  lines.push(`現在地: ${room ? (room.type === 'shop' ? '店の中' : room.type === 'mhouse' ? 'モンスターハウス' : '部屋の中') : '通路'}`);
  const adj = G.level.monsters.filter(m => dist(m, p) <= 1);
  lines.push(`隣接: ${adj.length ? adj.map(m => `${m.name}${m.ally ? '(仲間)' : m.peaceful ? '(友好的)' : ''}`).join('、') : 'なし'}`);
  const vis = hostiles().filter(m => isVisible(m.x, m.y) && dist(m, p) > 1);
  lines.push(`見えている敵: ${vis.length ? vis.map(m => m.name).join('、') : 'なし'}`);
  lines.push(`ペット: ${G.pet.alive ? `${G.pet.name}(HP ${G.pet.hp}/${G.pet.maxHp})` : '倒れてしまった'}`);
  const doors = adjacentTiles(t => t === T_DOOR).map(s => DIR_NAMES[s.dir]);
  if (doors.length) lines.push(`閉じたドア: ${doors.join('、')}にある`);
  if (canSellHere()) lines.push('(店の中なので sell でアイテムを売れる)');
  lines.push('所持品(各行の[ ]は種類):');
  if (!p.inventory.length) lines.push('(なし)');
  p.inventory.forEach((it, i) => {
    const eq = (it === p.weapon || it === p.armor) ? '(装備中)' : '';
    lines.push(`${i}: ${itemLabel(it)} [${KIND_LABELS[it.kind] || it.kind}]${eq}`);
  });
  return lines.join('\n');
}

// ---------- ターン進行 ----------
function endTurn() {
  if (G.over) return;
  const p = G.player;
  G.turn++;
  if (p.buffAtk && --p.buffAtk.turns <= 0) { p.buffAtk = null; addMsg('攻撃力上昇の効果が切れた。'); }
  if (p.buffDef && --p.buffDef.turns <= 0) { p.buffDef = null; addMsg('防御力上昇の効果が切れた。'); }
  if (G.turn % 6 === 0 && p.hp < p.maxHp) p.hp++;

  for (const m of [...G.level.monsters]) {
    if (m.ally) friendlyAct(m);
    else monsterAct(m);
    if (G.over) break;
  }
  if (!G.over && G.pet.alive) friendlyAct(G.pet, true);

  computeFov();
  checkDeath('魔物の攻撃');
  if (window.UI) UI.refresh();
}

function checkDeath(cause) {
  if (G.over) return true;
  if (G.player.hp > 0) return false;
  G.player.hp = 0;
  G.over = true;
  G.overInfo = {
    cause: cause || '力尽きた',
    score: G.depth * 100 + G.player.level * 20 + G.player.gold,
  };
  addMsg('あなたは死んでしまった…', 'm-warn');
  if (window.UI) UI.refresh();
  return true;
}

// ---------- モンスターAI ----------
function stepToward(u, tx, ty) {
  const dx = Math.sign(tx - u.x), dy = Math.sign(ty - u.y);
  const cands = [[dx, dy], [dx, 0], [0, dy]];
  for (const [cx, cy] of cands) {
    if (cx === 0 && cy === 0) continue;
    const nx = u.x + cx, ny = u.y + cy;
    if (walkable(nx, ny) && !unitAt(nx, ny)) { u.x = nx; u.y = ny; return true; }
  }
  return false;
}

function stepAway(u, tx, ty) {
  return stepToward(u, u.x + (u.x - tx) * 2, u.y + (u.y - ty) * 2);
}

function stepRandom(u) {
  const ks = Object.keys(DIRS);
  for (let i = 0; i < 6; i++) {
    const [dx, dy] = DIRS[ks[Math.floor(Math.random() * ks.length)]];
    const nx = u.x + dx, ny = u.y + dy;
    if (walkable(nx, ny) && !unitAt(nx, ny)) { u.x = nx; u.y = ny; return true; }
  }
  return false;
}

function attackPlayer(m) {
  const p = G.player;
  const dmg = Math.max(0, m.atk + Math.floor(Math.random() * 3) - 1 - playerDef());
  if (dmg <= 0) { addMsg(`${m.name}の攻撃をかわした!`); return; }
  p.hp -= dmg;
  addMsg(`${m.name}の攻撃! ${dmg}のダメージ。`, 'm-warn');
}

function attackPet(m) {
  const dmg = Math.max(1, m.atk + Math.floor(Math.random() * 2) - 1);
  G.pet.hp -= dmg;
  if (G.pet.hp <= 0) {
    G.pet.alive = false;
    addMsg(`${G.pet.name}は${m.name}に倒されてしまった…`, 'm-warn');
  } else {
    addMsg(`${m.name}が${G.pet.name}に${dmg}のダメージ!`, 'm-warn');
  }
}

function monsterAct(m) {
  if (m.sleep > 0) { m.sleep--; return; }
  if (m.peaceful) return;
  const p = G.player;
  if (m.scared > 0) { m.scared--; stepAway(m, p.x, p.y); return; }
  if (m.erratic && Math.random() < 0.5) { stepRandom(m); return; }

  const petAdj = G.pet.alive && dist(m, G.pet) <= 1;
  const playerAdj = dist(m, p) <= 1;
  if (playerAdj && (!petAdj || Math.random() < 0.6)) { attackPlayer(m); return; }
  if (petAdj) { attackPet(m); return; }

  const allyAdj = G.level.monsters.find(a => a.ally && dist(m, a) <= 1);
  if (allyAdj) { damageMonster(allyAdj, Math.max(1, m.atk - allyAdj.def), m.name); return; }

  if (dist(m, p) <= 8 && los(m.x, m.y, p.x, p.y)) { stepToward(m, p.x, p.y); return; }
  if (Math.random() < 0.3) stepRandom(m);
}

function friendlyAct(u, isPet) {
  const p = G.player;
  const target = hostiles()
    .filter(m => dist(m, u) <= 6 && los(u.x, u.y, m.x, m.y))
    .sort((a, b) => dist(a, u) - dist(b, u))[0];
  if (target && dist(target, u) <= 1) {
    const dmg = Math.max(1, (u.atk || 3) + Math.floor(Math.random() * 2) - target.def);
    damageMonster(target, dmg, isPet ? G.pet.name : u.name);
    return;
  }
  if (target) { stepToward(u, target.x, target.y); return; }
  if (dist(u, p) > 2) stepToward(u, p.x, p.y);
  else if (Math.random() < 0.4) stepRandom(u);
}

// ---------- リピート移動(道なり) ----------
function corridorTurn(dirKey) {
  const p = G.player;
  if (tileAt(p.x, p.y) !== T_CORR) return null;
  const [bdx, bdy] = DIRS[dirKey];
  const back = { x: -bdx, y: -bdy };
  const options = [];
  for (const k of ['n', 's', 'e', 'w']) {
    const [dx, dy] = DIRS[k];
    if (dx === back.x && dy === back.y) continue;
    if (walkable(p.x + dx, p.y + dy) && !monsterAt(p.x + dx, p.y + dy)) options.push(k);
  }
  return options.length === 1 ? options[0] : null;
}

function travelStep(dirKey) {
  if (G.over) return { cont: false, dir: dirKey };
  let nd = dirKey;
  let [dx, dy] = DIRS[nd];
  const blocked = (x, y) => !walkable(x, y) || monsterAt(x, y) || (G.pet.alive && G.pet.x === x && G.pet.y === y);
  if (blocked(G.player.x + dx, G.player.y + dy)) {
    const alt = corridorTurn(nd);
    if (!alt) return { cont: false, dir: nd };
    nd = alt; [dx, dy] = DIRS[nd];
    if (blocked(G.player.x + dx, G.player.y + dy)) return { cont: false, dir: nd };
  }
  if (!tryStep(dx, dy)) return { cont: false, dir: nd };
  const p = G.player;
  const stop =
    hostiles().some(m => isVisible(m.x, m.y) && dist(m, p) <= 2) ||
    itemsAt(p.x, p.y).length > 0 ||
    tileAt(p.x, p.y) === T_STAIRS ||
    G.over;
  return { cont: !stop, dir: nd };
}

// ---------- マス情報(タップで確認) ----------
function tileDescription(x, y) {
  if (!inBounds(x, y)) return 'マップの外。';
  const idx = y * G.level.w + x;
  if (!G.explored[idx]) return 'まだ見えていない場所。';
  const lines = [];
  const t = tileAt(x, y);
  lines.push(
    (t === T_WALL || t === T_SDOOR) ? '🧱 壁' : // 隠しドアは見つけるまで壁として表示
    t === T_STAIRS ? '🔻 下り階段' :
    t === T_DOOR ? '🚪 閉じたドア' :
    t === T_DOOR_OPEN ? '開いたドア' :
    t === T_CORR ? '通路' : '部屋の床');
  const room = roomAt(x, y);
  if (room && room.announced) {
    if (room.type === 'shop') lines.push('🏪 ここは店の中。値札付きの商品は購入が必要。');
    if (room.type === 'mhouse') lines.push('⚠️ モンスターハウスの中!');
  }
  if (G.player.x === x && G.player.y === y) lines.push(`🧙 ${G.char.name}(あなた) HP ${G.player.hp}/${G.player.maxHp}`);
  if (G.pet.alive && G.pet.x === x && G.pet.y === y) lines.push(`🐕 ${G.pet.name} HP ${G.pet.hp}/${G.pet.maxHp}`);
  const m = monsterAt(x, y);
  if (m && G.visible[idx]) {
    const rel = m.ally ? '仲間' : m.peaceful ? '友好的' : '敵対';
    lines.push(`${m.emoji} ${m.name}(${rel}) HP ${m.hp}/${m.maxHp} / 攻撃${m.atk} 防御${m.def}`);
  }
  for (const it of itemsAt(x, y)) {
    lines.push(`${it.emoji} ${it.name}${it.price ? `(価格 ${it.price}G)` : ''}`);
  }
  return lines.join('\n');
}
