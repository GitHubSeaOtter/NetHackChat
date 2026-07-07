// ============================================================
// UI層: 画面遷移・キャンバス描画・入力・モーダル
// ============================================================

const UI = (() => {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const TILE = 30;

  let editingCharId = null;   // 編集中の保存済みキャラID
  let pendingChar = null;     // 作成直後・保存前のキャラ
  let repeatTimer = null;
  let repeatDir = null;
  let holdTimer = null;

  // ---------- 汎用 ----------
  function showModal(id) {
    $('modal-backdrop').classList.remove('hidden');
    $(id).classList.remove('hidden');
  }
  function closeModals() {
    $('modal-backdrop').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  }
  function showBusy(text) {
    $('busy-text').textContent = text || 'AIが考えています…';
    $('busy').classList.remove('hidden');
  }
  function hideBusy() { $('busy').classList.add('hidden'); }

  function uuid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ---------- スタート画面 ----------
  function renderCharList() {
    const wrap = $('char-list');
    wrap.innerHTML = '';
    const chars = Store.characters();
    if (!chars.length) {
      wrap.innerHTML = '<p class="empty-note">キャラクターがまだいません。<br>「新しいキャラクターを作る」から始めましょう。</p>';
      return;
    }
    for (const ch of chars) {
      const card = document.createElement('div');
      card.className = 'char-card';
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (ch.thumb) {
        const img = document.createElement('img');
        img.src = ch.thumb;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '🧙';
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      const nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = `${ch.name}(${ch.clazz})`;
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = ch.personality;
      meta.appendChild(nm); meta.appendChild(desc);
      const btns = document.createElement('div');
      btns.className = 'buttons';
      const play = document.createElement('button');
      play.className = 'primary';
      play.textContent = '冒険へ';
      play.onclick = () => beginGame(ch);
      const edit = document.createElement('button');
      edit.textContent = '編集';
      edit.onclick = () => openEdit(ch.id);
      btns.appendChild(play); btns.appendChild(edit);
      card.appendChild(thumb); card.appendChild(meta); card.appendChild(btns);
      wrap.appendChild(card);
    }
  }

  function beginGame(ch) {
    startGame(ch);
    $('screen-start').classList.add('hidden');
    $('screen-game').classList.remove('hidden');
    resizeCanvas();
    refresh();
  }

  function backToStart() {
    closeModals();
    $('screen-game').classList.add('hidden');
    $('screen-start').classList.remove('hidden');
    renderCharList();
  }

  // ---------- キャラ作成 ----------
  async function createFromImage(file) {
    try {
      showBusy('画像を解析してキャラクターを生成しています…');
      const { apiData, mediaType, thumb } = await processImage(file);
      const gen = await aiCharacterFromImage(apiData, mediaType);
      pendingChar = { id: uuid(), ...gen, thumb, createdAt: Date.now() };
      hideBusy();
      openPendingEdit();
    } catch (e) {
      hideBusy();
      if (e instanceof ApiKeyMissingError) {
        alert(e.message);
        openSettings();
      } else {
        alert('キャラクター生成に失敗しました: ' + e.message + '\nランダム生成で作成します。');
        pendingChar = { id: uuid(), ...randomCharacterLocal(), thumb: null, createdAt: Date.now() };
        openPendingEdit();
      }
    }
  }

  function createRandom() {
    pendingChar = { id: uuid(), ...randomCharacterLocal(), thumb: null, createdAt: Date.now() };
    openPendingEdit();
  }

  function processImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('画像を解釈できませんでした'));
        img.onload = () => {
          const scale = (max, w, h) => {
            const r = Math.min(1, max / Math.max(w, h));
            return [Math.round(w * r), Math.round(h * r)];
          };
          const draw = (w, h) => {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            return c;
          };
          const [aw, ah] = scale(640, img.width, img.height);
          const apiUrl = draw(aw, ah).toDataURL('image/jpeg', 0.85);
          const [tw, th] = scale(120, img.width, img.height);
          const thumb = draw(tw, th).toDataURL('image/jpeg', 0.7);
          resolve({
            apiData: apiUrl.split(',')[1],
            mediaType: 'image/jpeg',
            thumb,
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- キャラ編集(名前・性格はいつでも編集可) ----------
  function fillEditModal(ch, isNew) {
    $('edit-title').textContent = isNew ? '新しい冒険者' : 'キャラクター編集';
    $('edit-name').value = ch.name;
    $('edit-personality').value = ch.personality;
    const tw = $('edit-thumb-wrap');
    tw.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'thumb';
    if (ch.thumb) {
      const img = document.createElement('img');
      img.src = ch.thumb;
      t.appendChild(img);
    } else t.textContent = '🧙';
    tw.appendChild(t);
    const s = ch.stats;
    $('edit-stats').textContent =
      `${ch.clazz} / 力${s.str} 敏${s.dex} 体${s.con} 知${s.int} 賢${s.wis} 魅${s.cha}` +
      (ch.backstory ? `\n${ch.backstory}` : '');
    $('btn-edit-delete').classList.toggle('hidden', isNew);
  }

  function openPendingEdit() {
    editingCharId = null;
    fillEditModal(pendingChar, true);
    showModal('modal-edit');
  }

  function openEdit(id) {
    const ch = Store.characters().find(c => c.id === id);
    if (!ch) return;
    editingCharId = id;
    pendingChar = null;
    fillEditModal(ch, false);
    showModal('modal-edit');
  }

  function openEditInGame() {
    editingCharId = G.storedCharId;
    pendingChar = null;
    fillEditModal(G.char, false);
    $('btn-edit-delete').classList.add('hidden');
    showModal('modal-edit');
  }

  function saveEdit() {
    const name = $('edit-name').value.trim() || '名無し';
    const personality = $('edit-personality').value.trim() || '無口な冒険者。';
    if (pendingChar) {
      pendingChar.name = name;
      pendingChar.personality = personality;
      Store.upsertCharacter(pendingChar);
      pendingChar = null;
    } else if (editingCharId) {
      const ch = Store.characters().find(c => c.id === editingCharId);
      if (ch) {
        ch.name = name;
        ch.personality = personality;
        Store.upsertCharacter(ch);
      }
      // プレイ中のキャラにも反映
      if (G.char && G.storedCharId === editingCharId) {
        G.char.name = name;
        G.char.personality = personality;
      }
    }
    closeModals();
    renderCharList();
    refresh();
  }

  function deleteEditing() {
    if (editingCharId && confirm('このキャラクターを削除しますか?')) {
      Store.deleteCharacter(editingCharId);
      closeModals();
      renderCharList();
    }
  }

  // ---------- 設定 ----------
  function openSettings() {
    const m = Store.models();
    $('input-apikey').value = Store.apiKey();
    $('input-model-judge').value = m.judge;
    $('input-model-vision').value = m.vision;
    $('input-model-fallback').value = m.fallback;
    showModal('modal-settings');
  }

  function saveSettings() {
    Store.setApiKey($('input-apikey').value);
    Store.setModels({
      judge: $('input-model-judge').value.trim() || DEFAULT_MODELS.judge,
      vision: $('input-model-vision').value.trim() || DEFAULT_MODELS.vision,
      fallback: $('input-model-fallback').value.trim() || DEFAULT_MODELS.fallback,
    });
    closeModals();
  }

  // ---------- 描画 ----------
  function resizeCanvas() {
    const wrap = $('canvas-wrap');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!G.level) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, 0, w, h);

    const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
    const ox = G.player.x - Math.floor(cols / 2);
    const oy = G.player.y - Math.floor(rows / 2);
    ctx.font = `${TILE - 6}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let sy = 0; sy < rows; sy++) {
      for (let sx = 0; sx < cols; sx++) {
        const mx = ox + sx, my = oy + sy;
        if (!inBounds(mx, my)) continue;
        const idx = my * G.level.w + mx;
        if (!G.explored[idx]) continue;
        const vis = !!G.visible[idx];
        const t = G.level.t[idx];
        const px = sx * TILE, py = sy * TILE;
        if (t === T_WALL) {
          ctx.fillStyle = vis ? '#3c3c50' : '#232330';
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        } else {
          ctx.fillStyle = vis ? (t === T_CORR ? '#1c1c26' : '#22222e') : '#15151d';
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          if (t === T_STAIRS) {
            ctx.fillStyle = vis ? '#e8c060' : '#7a6a40';
            ctx.fillText('▼', px + TILE / 2, py + TILE / 2 + 1);
          }
        }
      }
    }

    const drawGlyph = (x, y, glyph, dim) => {
      const sx = x - ox, sy = y - oy;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return;
      ctx.globalAlpha = dim ? 0.5 : 1;
      ctx.fillStyle = '#fff';
      ctx.fillText(glyph, sx * TILE + TILE / 2, sy * TILE + TILE / 2 + 1);
      ctx.globalAlpha = 1;
    };

    for (const it of G.level.items) {
      const idx = it.y * G.level.w + it.x;
      if (G.explored[idx]) drawGlyph(it.x, it.y, it.emoji, !G.visible[idx]);
    }
    for (const m of G.level.monsters) {
      if (isVisible(m.x, m.y)) drawGlyph(m.x, m.y, m.emoji, false);
    }
    if (G.pet.alive && isVisible(G.pet.x, G.pet.y)) drawGlyph(G.pet.x, G.pet.y, G.pet.emoji, false);
    drawGlyph(G.player.x, G.player.y, '🧙', false);
  }

  function renderStats() {
    if (!G.player) return;
    const p = G.player;
    $('stat-text').textContent =
      `${G.char.name} B${G.depth}F | HP ${p.hp}/${p.maxHp} | Lv${p.level} | 💰${p.gold} | 攻${playerAtk()} 防${playerDef()}` +
      (G.pet.alive ? ` | 🐕${G.pet.hp}` : '');
  }

  function renderLog() {
    const log = $('log');
    log.innerHTML = '';
    for (const m of G.msgs.slice(-30)) {
      const div = document.createElement('div');
      if (m.cls) div.className = m.cls;
      div.textContent = m.text;
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }

  function refresh() {
    if ($('screen-game').classList.contains('hidden')) return;
    renderStats();
    renderLog();
    draw();
    if (G.over && G.overInfo && !G.overInfo.shown) {
      G.overInfo.shown = true;
      stopRepeat();
      $('gameover-title').textContent = 'ゲームオーバー';
      $('gameover-body').innerHTML =
        `<b>${G.char.name}</b>は地下${G.depth}階で${G.overInfo.cause}により倒れた。<br>` +
        `到達: 地下${G.depth}階 / レベル${G.player.level} / 所持金${G.player.gold}G<br>` +
        `スコア: <b>${G.overInfo.score}</b><br>` +
        `<span class="note">成長とアイテムは次の冒険には引き継がれません。</span>`;
      showModal('modal-gameover');
    }
  }

  // ---------- 入力: D-pad(押しっぱなしで道なりにリピート移動) ----------
  function stepOnce(dirKey) {
    if (dirKey === 'wait') { doWait(); return; }
    const [dx, dy] = DIRS[dirKey];
    tryStep(dx, dy);
    refresh();
  }

  function startRepeat(dirKey) {
    stopRepeat();
    repeatDir = dirKey;
    repeatTimer = setInterval(() => {
      if (repeatDir === 'wait') { doWait(); refresh(); return; }
      const r = travelStep(repeatDir);
      refresh();
      if (!r.cont) stopRepeat();
      else repeatDir = r.dir;
    }, 160);
  }

  function stopRepeat() {
    if (repeatTimer) clearInterval(repeatTimer);
    if (holdTimer) clearTimeout(holdTimer);
    repeatTimer = null; holdTimer = null; repeatDir = null;
  }

  function bindDpad() {
    document.querySelectorAll('#dpad button').forEach(btn => {
      const dir = btn.dataset.dir;
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (G.over || !$('busy').classList.contains('hidden')) return;
        stepOnce(dir);
        holdTimer = setTimeout(() => startRepeat(dir), 320);
      });
      const stop = e => { e.preventDefault(); stopRepeat(); };
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  // ---------- 入力: マップタップでマス情報 ----------
  function bindCanvasTap() {
    canvas.addEventListener('click', e => {
      if (!G.level) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
      const ox = G.player.x - Math.floor(cols / 2);
      const oy = G.player.y - Math.floor(rows / 2);
      const mx = ox + Math.floor((e.clientX - rect.left) / TILE);
      const my = oy + Math.floor((e.clientY - rect.top) / TILE);
      $('info-body').textContent = tileDescription(mx, my);
      showModal('modal-info');
    });
  }

  // ---------- 入力: 自由入力 ----------
  async function submitFreeform() {
    const input = $('freeform');
    const text = input.value.trim();
    if (!text || G.over) return;
    input.value = '';
    input.blur();
    addMsg(`> ${text}`);
    refresh();
    try {
      showBusy('AIが行動を解釈しています…');
      await handleFreeform(text);
    } catch (e) {
      if (e instanceof ApiKeyMissingError) {
        addMsg('自由入力にはAPIキーが必要です。設定画面で登録してください。', 'm-warn');
        openSettings();
      } else {
        addMsg('AIとの通信に失敗しました: ' + e.message, 'm-warn');
      }
    } finally {
      hideBusy();
      refresh();
    }
  }

  // ---------- 持ち物 ----------
  function openInventory() {
    const wrap = $('inventory-list');
    wrap.innerHTML = '';
    const inv = G.player.inventory;
    if (!inv.length) wrap.innerHTML = '<p class="note">何も持っていない。</p>';
    inv.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'inv-row';
      const name = document.createElement('span');
      name.className = 'inv-name';
      const eq = (it === G.player.weapon || it === G.player.armor) ? ' [装備中]' : '';
      name.textContent = `${it.emoji} ${it.name}${eq}`;
      const use = document.createElement('button');
      use.textContent = it.kind === 'weapon' || it.kind === 'armor'
        ? ((it === G.player.weapon || it === G.player.armor) ? '外す' : '装備')
        : it.kind === 'scroll' ? '読む' : it.kind === 'food' ? '食べる' : '飲む';
      use.onclick = async () => {
        closeModals();
        await useItem(i);
        refresh();
      };
      row.appendChild(name);
      row.appendChild(use);
      wrap.appendChild(row);
    });
    showModal('modal-inventory');
  }

  // ---------- 初期化 ----------
  function init() {
    renderCharList();

    $('btn-settings').onclick = openSettings;
    $('btn-settings-save').onclick = saveSettings;

    $('btn-new-char').onclick = () => showModal('modal-newchar');
    $('btn-char-from-image').onclick = () => {
      if (!Store.apiKey()) {
        alert('画像からの生成にはAPIキーが必要です。先に設定してください。');
        closeModals();
        openSettings();
        return;
      }
      $('char-image-input').click();
    };
    $('char-image-input').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) { closeModals(); createFromImage(file); }
    });
    $('btn-char-random').onclick = () => { closeModals(); createRandom(); };

    $('btn-edit-save').onclick = saveEdit;
    $('btn-edit-delete').onclick = deleteEditing;
    $('btn-edit-char').onclick = openEditInGame;
    $('btn-quit').onclick = () => {
      if (confirm('冒険をあきらめてキャラクター選択に戻りますか?(成長とアイテムは失われます)')) backToStart();
    };

    $('btn-pickup').onclick = () => { doPickup(); refresh(); };
    $('btn-inventory').onclick = openInventory;
    $('btn-open').onclick = () => { doOpen(); refresh(); };
    $('btn-descend').onclick = () => { doDescend(); refresh(); };
    $('btn-search').onclick = () => { doSearch(); refresh(); };

    $('btn-freeform').onclick = submitFreeform;
    $('freeform').addEventListener('keydown', e => { if (e.key === 'Enter') submitFreeform(); });

    $('btn-gameover-back').onclick = backToStart;

    document.querySelectorAll('.btn-close').forEach(b => b.onclick = closeModals);
    $('modal-backdrop').onclick = () => {
      // ゲームオーバー中は背景タップで閉じない
      if ($('modal-gameover').classList.contains('hidden')) closeModals();
    };

    bindDpad();
    bindCanvasTap();
    window.addEventListener('resize', () => { resizeCanvas(); draw(); });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { refresh, showBusy, hideBusy };
})();

// ゲームエンジン(game.js)から window.UI 経由で再描画できるように公開する
window.UI = UI;
