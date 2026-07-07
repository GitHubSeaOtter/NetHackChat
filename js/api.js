// ============================================================
// Claude API クライアント(ブラウザ直接呼び出し)
// - APIキーは localStorage のみに保存(config.js の Store)
// - anthropic-dangerous-direct-browser-access ヘッダで CORS 許可
// - task 名でモデルルーティングし、失敗時は fallback モデルに
//   1回だけエスカレーションする
// ============================================================

class ApiKeyMissingError extends Error {
  constructor() { super('APIキーが設定されていません。設定画面から登録してください。'); }
}

async function callClaude({ task, system, content, schema, maxTokens = 1024 }) {
  const key = Store.apiKey();
  if (!key) throw new ApiKeyMissingError();

  const models = Store.models();
  const primary = models[task] || DEFAULT_MODELS.judge;
  try {
    return await claudeRequest(key, primary, system, content, schema, maxTokens);
  } catch (e) {
    // 認証エラーやキー未設定はエスカレーションしても無駄なのでそのまま投げる
    if (e instanceof ApiKeyMissingError || e.status === 401 || e.status === 403) throw e;
    const fb = models.fallback;
    if (fb && fb !== primary) {
      return await claudeRequest(key, fb, system, content, schema, maxTokens);
    }
    throw e;
  }
}

async function claudeRequest(key, model, system, content, schema, maxTokens) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  };
  if (schema) {
    body.output_config = { format: { type: 'json_schema', schema } };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `APIエラー (${res.status})`;
    try {
      const err = await res.json();
      if (err && err.error && err.error.message) msg += `: ${err.error.message}`;
    } catch (e) { /* JSONでないエラー本文は無視 */ }
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('AIが応答を拒否しました');
  }
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  if (!schema) return text;
  return JSON.parse(text);
}
