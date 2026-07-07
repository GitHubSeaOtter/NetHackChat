// ============================================================
// AIタスク層
//   aiInterpret  … 自由入力の解釈(judge: Haiku 4.5)
//   aiItemEffect … 未識別アイテムの効果判定(judge: Haiku 4.5)
//   aiCharacterFromImage … 画像からキャラ生成(vision: Sonnet 5)
// 弱いモデルを使う分、システムプロンプトを網羅的に書き、
// JSONスキーマ(構造化出力)で形式を保証する。
// ============================================================

const EFFECT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    effect: { type: 'string', enum: EFFECT_IDS },
    power: { type: 'integer' },
  },
  required: ['effect', 'power'],
  additionalProperties: false,
};

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['command', 'special', 'invalid'] },
    command: { type: 'string', enum: ['move', 'use_item', 'pickup', 'descend', 'open', 'close', 'search', 'wait', 'pray', 'throw', 'zap', 'drop', 'sell', 'kick', 'none'] },
    direction: { type: 'string', enum: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'none'] },
    item_index: { type: 'integer' },
    effects: { type: 'array', items: EFFECT_ITEM_SCHEMA },
    narration: { type: 'string' },
  },
  required: ['kind', 'command', 'direction', 'item_index', 'effects', 'narration'],
  additionalProperties: false,
};

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    effect: { type: 'string', enum: EFFECT_IDS },
    power: { type: 'integer' },
    item_true_name: { type: 'string' },
    narration: { type: 'string' },
  },
  required: ['effect', 'power', 'item_true_name', 'narration'],
  additionalProperties: false,
};

const CHAR_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    personality: { type: 'string' },
    clazz: { type: 'string', enum: ['戦士', '魔法使い', '僧侶', '盗賊', '騎士', '観光客', '考古学者'] },
    str: { type: 'integer' }, dex: { type: 'integer' }, con: { type: 'integer' },
    int: { type: 'integer' }, wis: { type: 'integer' }, cha: { type: 'integer' },
    backstory: { type: 'string' },
  },
  required: ['name', 'personality', 'clazz', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'backstory'],
  additionalProperties: false,
};

const JUDGE_SYSTEM = `あなたはローグライクRPG「NetHackChat」のゲームマスターAIです。プレイヤーの自由入力テキストを解釈し、指定のJSONスキーマに従って必ず応答します。

# 判定手順
1. 入力が次の基本コマンドで表現できるなら kind="command" にし、該当する command と direction / item_index を設定する。
   - 移動、方向を指定した攻撃・体当たり: command="move"(direction を8方位で指定。移動先に敵がいれば攻撃になる)
   - アイテムを使う/飲む/読む/食べる/装備する: command="use_item"(item_index=所持品リストの番号)
   - アイテムを投げる: command="throw"(item_index 必須。「北に投げる」のように方向が明示されていれば direction を設定し、無ければ "none" のままにする=ゲーム側がプレイヤーに方向入力を求める)
   - 杖を振る/杖を使う([杖]タグのアイテム): command="zap"(item_index 必須。方向の扱いは throw と同じ)
   - アイテムを捨てる/置く: command="drop"(item_index)
   - 店でアイテムを売る: command="sell"(item_index)
   - 足元のアイテムを拾う/買う: command="pickup"
   - 階段を降りる: command="descend"
   - 宝箱やドアを開ける: command="open"
   - ドアを閉める: command="close"
   - 蹴る(ドアを蹴破る・敵を蹴る): command="kick"(方向が明示されていれば direction)
   - 周囲を調べる/隠しドアや隠し通路を探す: command="search"
   - ツルハシで壁を掘る: command="use_item"(item_index=ツルハシの番号。方向はゲーム側が確認する)
   - 休む/待つ/様子を見る: command="wait"
   - 神に祈る: command="pray"
2. 基本コマンドで表現できない創造的な行動(呪文を唱える、歌う、叫ぶ、踊る、脅す、交渉する、ペットを褒める等)は kind="special" にし、effects 配列(0〜2個)と narration を返す。
   - narration はキャラクターの性格・口調を反映した2〜3文の日本語の実況。ユーモアを大切に。
   - ゲームバランスを守ること。強力な効果(damage_visible, reveal_map, gain_gold 等)は控えめな power にするか、リスク(damage_self, spawn_monster)と組み合わせる。
   - 「何も起きない」のも良い結果。effects=[] で narration だけでもよい。同じ行動を繰り返されたら効果を渋くする。
   - power の目安: 小=1〜5, 中=6〜12, 大=13〜20。20 を超えてはならない。
3. 意味が読み取れない入力は kind="invalid" にし、narration で短く聞き返す。

# effects で使える effect 値
heal(HP回復) / damage_self(自分がダメージ) / damage_adjacent(隣接する敵にダメージ) / damage_visible(見えている敵全体にダメージ) / teleport(ランダム転移) / reveal_map(フロア全体を明らかに) / spawn_item(足元にアイテム出現) / spawn_monster(敵が出現) / buff_attack(攻撃力上昇) / buff_defense(防御力上昇) / scare_enemies(敵が怯えて逃げる) / tame_adjacent(隣接する敵を仲間にする) / gain_gold(金貨入手) / lose_gold(金貨喪失) / satiate(小回復・満足) / nothing(何も起きない)

# 注意
- 使わないフィールドには command="none", direction="none", item_index=-1, effects=[] を入れる。
- 所持品リストの各行には [薬][巻物][武器][防具][食料][杖][道具] の種類タグが付いている。投げる・振る対象はこのタグと名前から item_index を選ぶ。
- 投げる・振る・蹴るで方向が入力文に無い場合は direction="none" にすること(勝手に方向を決めない。ゲーム側が方向入力を求める)。
- アイテムを消費・投擲する行動は必ず対応する command を使うこと(kind="special" の effects でアイテム効果を再現しない。消費や対象の判定はゲーム側が行う)。
- narration は必ず日本語で書く。`;

const ITEM_SYSTEM = `あなたはローグライクRPG「NetHackChat」のアイテム効果判定AIです。プレイヤーが未識別のアイテムを使用しました。アイテムの見た目・種類と現在の状況から、ふさわしい効果を1つ選び、JSONで返します。

# ガイドライン
- ポーション(飲む)の典型: heal / damage_self / buff_attack / buff_defense / teleport / satiate / nothing
- 巻物(読む)の典型: reveal_map / teleport / scare_enemies / spawn_monster / gain_gold / nothing
- おおよそ7割は有益、3割は不利かハズレにする。プレイヤーが瀕死のときは少しだけ慈悲深く。
- power の目安: 小=1〜5, 中=6〜12, 大=13〜20。20 を超えてはならない。
- item_true_name は「体力回復のポーション」「地図の巻物」のような正体の名前。
- narration はキャラクターの性格を反映した1〜2文の日本語の実況。`;

const CHAR_SYSTEM = `あなたはローグライクRPG「NetHackChat」のキャラクターメーカーです。渡された画像の外見・色使い・雰囲気から、ファンタジー世界の冒険者キャラクターを1人生成し、JSONで返します。

- name: 画像の印象に合う名前(日本語かカタカナ、10文字以内)
- personality: 口調や行動の傾向がわかる性格説明(50〜80文字の日本語)
- clazz: 戦士/魔法使い/僧侶/盗賊/騎士/観光客/考古学者 から最も似合うもの
- 能力値(str, dex, con, int, wis, cha): それぞれ6〜18。画像の印象を反映し、合計が60〜75程度になるようにする
- backstory: 2文程度の背景設定(日本語)

画像に実在の人物が写っている場合も、本人を特定せず「その雰囲気に似た架空の冒険者」を創作してください。人物以外(動物、風景、物)の画像でも、その特徴を擬人化して冒険者にしてください。`;

// ---------- 自由入力の解釈 ----------
async function aiInterpret(inputText, stateSummary, character) {
  const content = [
    `# キャラクター\n名前: ${character.name}(${character.clazz})\n性格: ${character.personality}`,
    `# 現在の状況\n${stateSummary}`,
    `# プレイヤーの入力\n「${inputText}」`,
  ].join('\n\n');
  return callClaude({
    task: 'judge',
    system: JUDGE_SYSTEM,
    content,
    schema: JUDGE_SCHEMA,
    maxTokens: 600,
  });
}

// ---------- アイテム効果判定 ----------
async function aiItemEffect(item, stateSummary, character) {
  const content = [
    `# キャラクター\n名前: ${character.name}(${character.clazz})\n性格: ${character.personality}`,
    `# 現在の状況\n${stateSummary}`,
    `# 使用したアイテム\n種類: ${item.kind === 'scroll' ? '巻物' : 'ポーション'}\n見た目: ${item.name}`,
  ].join('\n\n');
  return callClaude({
    task: 'judge',
    system: ITEM_SYSTEM,
    content,
    schema: ITEM_SCHEMA,
    maxTokens: 400,
  });
}

// ---------- 画像からキャラ生成 ----------
async function aiCharacterFromImage(base64Data, mediaType) {
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
    { type: 'text', text: 'この画像から冒険者キャラクターを生成してください。' },
  ];
  const r = await callClaude({
    task: 'vision',
    system: CHAR_SYSTEM,
    content,
    schema: CHAR_SCHEMA,
    maxTokens: 700,
  });
  const clamp = v => Math.max(6, Math.min(18, Math.round(v) || 10));
  return {
    name: (r.name || '名無し').slice(0, 20),
    personality: r.personality || '無口な冒険者。',
    clazz: r.clazz,
    stats: { str: clamp(r.str), dex: clamp(r.dex), con: clamp(r.con), int: clamp(r.int), wis: clamp(r.wis), cha: clamp(r.cha) },
    backstory: r.backstory || '',
  };
}
