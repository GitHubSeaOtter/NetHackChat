// ============================================================
// ゲームデータ定義(モンスター・アイテム・ランダム生成用テーブル)
// ============================================================

const MONSTER_TYPES = [
  { id: 'rat',    name: 'ドブネズミ', emoji: '🐀', hp: 4,  atk: 2,  def: 0, xp: 2,  minDepth: 1, maxDepth: 3,  drop: 0.20 },
  { id: 'bat',    name: 'コウモリ',   emoji: '🦇', hp: 5,  atk: 2,  def: 0, xp: 3,  minDepth: 1, maxDepth: 4,  drop: 0.15, erratic: true },
  { id: 'snake',  name: 'ヘビ',       emoji: '🐍', hp: 7,  atk: 3,  def: 1, xp: 5,  minDepth: 2, maxDepth: 5,  drop: 0.20 },
  { id: 'goblin', name: 'ゴブリン',   emoji: '👺', hp: 9,  atk: 4,  def: 1, xp: 7,  minDepth: 2, maxDepth: 6,  drop: 0.35 },
  { id: 'zombie', name: 'ゾンビ',     emoji: '🧟', hp: 12, atk: 4,  def: 2, xp: 9,  minDepth: 3, maxDepth: 7,  drop: 0.30 },
  { id: 'wolf',   name: 'オオカミ',   emoji: '🐺', hp: 14, atk: 6,  def: 2, xp: 12, minDepth: 4, maxDepth: 8,  drop: 0.25 },
  { id: 'orc',    name: 'オーク',     emoji: '👹', hp: 18, atk: 7,  def: 3, xp: 16, minDepth: 5, maxDepth: 9,  drop: 0.40 },
  { id: 'ghost',  name: 'ゴースト',   emoji: '👻', hp: 15, atk: 6,  def: 4, xp: 18, minDepth: 6, maxDepth: 10, drop: 0.20 },
  { id: 'troll',  name: 'トロル',     emoji: '🗿', hp: 26, atk: 9,  def: 4, xp: 26, minDepth: 7, maxDepth: 12, drop: 0.40 },
  { id: 'dragon', name: 'ドラゴン',   emoji: '🐉', hp: 40, atk: 12, def: 6, xp: 50, minDepth: 9, maxDepth: 99, drop: 0.80 },
];

const POTION_LOOKS = ['赤い', '青い', '緑の', '黄色い', '紫の', '乳白色の', '黒い', '虹色の', '泡立つ', '濁った'];
const SCROLL_LABELS = ['ZELGO MER', 'JUYED AWK', 'PRATYAVAYAH', 'DAIYEN FOOELS', 'LEP GEX', 'VE FORBRYDERNE', 'HACKEM MUCHE', 'READ ME'];

const WEAPONS = [
  { name: 'ダガー',         bonus: 1, minDepth: 1 },
  { name: 'ショートソード', bonus: 2, minDepth: 2 },
  { name: 'メイス',         bonus: 3, minDepth: 4 },
  { name: 'ロングソード',   bonus: 4, minDepth: 6 },
  { name: 'バトルアックス', bonus: 5, minDepth: 8 },
];
const ARMORS = [
  { name: '革の鎧',           bonus: 1, minDepth: 1 },
  { name: 'スケイルメイル',   bonus: 2, minDepth: 3 },
  { name: 'チェインメイル',   bonus: 3, minDepth: 5 },
  { name: 'プレートメイル',   bonus: 4, minDepth: 8 },
];
const FOODS = ['食料の缶詰', '干し肉', 'リンゴ', 'ハードチーズ', '謎のクッキー'];

// 自由入力・アイテム判定でAIが使える効果の一覧(エンジン側と対応)
const EFFECT_IDS = [
  'heal', 'damage_self', 'damage_adjacent', 'damage_visible',
  'teleport', 'reveal_map', 'spawn_item', 'spawn_monster',
  'buff_attack', 'buff_defense', 'scare_enemies', 'tame_adjacent',
  'gain_gold', 'lose_gold', 'satiate', 'nothing',
];

// ---------- ランダムキャラ生成用テーブル(画像なし・API失敗時) ----------
const RANDOM_NAMES = ['アルテ', 'ボルグ', 'カエデ', 'ドランド', 'エリシア', 'フンババ', 'ギデオン', 'ハクア', 'イオリ', 'ジャバル', 'キリエ', 'ルーン', 'モルガナ', 'ノクト', 'オリバー', 'ピノ'];
const RANDOM_CLASSES = ['戦士', '魔法使い', '僧侶', '盗賊', '騎士', '観光客', '考古学者'];
const RANDOM_PERSONALITIES = [
  '豪快で細かいことは気にしない。危険なほど笑う。',
  '慎重で理屈っぽい。行動の前に必ず一言うんちくを垂れる。',
  '温厚で信心深い。困っている者は魔物でも放っておけない。',
  '軽口が多くて手癖が悪い。光り物に目がない。',
  '生真面目で誇り高い。約束と決闘は絶対に断らない。',
  'のんきな旅行気分。危機感がなく、何でも写真に撮りたがる。',
  '好奇心の塊。古代の遺物を見ると我を忘れる。',
];

function randomCharacterLocal() {
  const clazz = RANDOM_CLASSES[Math.floor(Math.random() * RANDOM_CLASSES.length)];
  const roll = () => 6 + Math.floor(Math.random() * 13); // 6-18
  return {
    name: RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)],
    personality: RANDOM_PERSONALITIES[Math.floor(Math.random() * RANDOM_PERSONALITIES.length)],
    clazz,
    stats: { str: roll(), dex: roll(), con: roll(), int: roll(), wis: roll(), cha: roll() },
    backstory: `${clazz}として迷宮に挑む冒険者。`,
  };
}

// ---------- API失敗時のローカルフォールバック効果 ----------
function localItemEffect(item) {
  const potion = [
    { effect: 'heal', power: 10, narration: '傷がみるみる塞がっていく。' },
    { effect: 'damage_self', power: 5, narration: 'うっ、これは毒だ!' },
    { effect: 'buff_attack', power: 6, narration: '力が湧いてくる!' },
    { effect: 'teleport', power: 0, narration: '視界がぐにゃりと歪んだ。' },
    { effect: 'nothing', power: 0, narration: '妙な味がしたが、何も起きなかった。' },
  ];
  const scroll = [
    { effect: 'reveal_map', power: 0, narration: 'フロアの構造が頭に流れ込んでくる。' },
    { effect: 'scare_enemies', power: 8, narration: '轟音が響き、魔物たちが怯えた。' },
    { effect: 'spawn_monster', power: 1, narration: 'まずい、魔物を呼び寄せてしまった!' },
    { effect: 'gain_gold', power: 8, narration: '巻物が金貨に変わった!' },
    { effect: 'nothing', power: 0, narration: '呪文を唱えたが、埃が舞っただけだった。' },
  ];
  const table = item.kind === 'scroll' ? scroll : potion;
  const r = { ...table[Math.floor(Math.random() * table.length)] };
  r.item_true_name = item.kind === 'scroll' ? '正体不明の巻物' : '正体不明のポーション';
  return r;
}
