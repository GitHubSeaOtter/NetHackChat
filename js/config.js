// ============================================================
// モデルルーティング設定
//
// タスクをフェーズ分解し、それぞれ「品質基準を満たす最も
// コスト効率の良い Claude モデル」に割り当てる。
// 弱いモデルには詳細な指示書(網羅的なシステムプロンプト +
// 厳密な JSON スキーマ)を渡して品質を補う。
//
//   タスク              頻度          モデル              単価(入/出 per MTok)
//   --------------------------------------------------------------------
//   judge  行動・効果判定 毎ターン級     claude-haiku-4-5    $1 / $5
//   vision 画像キャラ生成 キャラ作成時    claude-sonnet-5     $3 / $15
//   fallback 判定失敗時   まれ          claude-sonnet-5     $3 / $15
//
// ・judge は高頻度なので最安の Haiku 4.5。構造化出力
//   (output_config.format)で JSON の妥当性を保証する。
// ・vision は画像解析の品質が必要だが低頻度なので Sonnet 5。
// ・設定画面からモデルを上書き可能。
// ============================================================

const DEFAULT_MODELS = {
  judge: 'claude-haiku-4-5',
  vision: 'claude-sonnet-5',
  fallback: 'claude-sonnet-5',
};

const LS_KEYS = {
  API_KEY: 'nhc.apiKey',
  MODELS: 'nhc.models',
  CHARS: 'nhc.characters',
};

const Store = {
  apiKey() { return localStorage.getItem(LS_KEYS.API_KEY) || ''; },
  setApiKey(k) { localStorage.setItem(LS_KEYS.API_KEY, (k || '').trim()); },

  models() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEYS.MODELS)) || {}; } catch (e) { /* 破損時は既定値 */ }
    return { ...DEFAULT_MODELS, ...saved };
  },
  setModels(m) { localStorage.setItem(LS_KEYS.MODELS, JSON.stringify(m)); },

  characters() {
    try { return JSON.parse(localStorage.getItem(LS_KEYS.CHARS)) || []; } catch (e) { return []; }
  },
  saveCharacters(list) { localStorage.setItem(LS_KEYS.CHARS, JSON.stringify(list)); },

  upsertCharacter(ch) {
    const list = this.characters();
    const i = list.findIndex(c => c.id === ch.id);
    if (i >= 0) list[i] = ch; else list.push(ch);
    this.saveCharacters(list);
  },
  deleteCharacter(id) {
    this.saveCharacters(this.characters().filter(c => c.id !== id));
  },
};
