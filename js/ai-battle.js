// AI対戦（オフラインで CPU と対戦）の準備画面
// - 自分のデッキ: マイデッキ
// - AIのデッキ: 「おすすめデッキ」＝サンプルデッキのうち「AI用」にチェックしたもの（管理画面で作成）／マイデッキ
//   どちらも「選んだデッキ」の枠を押すと、検索つきの一覧が開く（デッキが多くても探しやすいように）
// - 難易度: window._aiLevel（'low' | 'mid' | 'high'）。CPU の判断はこの値で切り替える（低・中・高）
// - 先攻・後攻: オンライン対戦と同じくサイコロ（大きい方が先攻・同じ目は振り直し）
// - 対戦は startBattleGame（チュートリアルと同じオフライン対戦）を使う
import { gasGet } from './firebase-config.js';
import { loadCardsByNo, getGoogleDriveDirectLink, isBehaviorOk } from './cards.js';

let myDecks = [];       // マイデッキ（getDecks）
let aiSampleDecks = []; // おすすめデッキ（getSampleDecks forAi=1）
let aiSource = 'sample';
let selMy = null;       // 選んだデッキ（オブジェクト）
let selAi = null;       // { deck, source }
let pickerKind = 'my';  // 一覧を開いている側
let level = 'low';
let starting = false;
// 難易度ごとの AI の名前（対戦画面の相手の名前・ターン開始の表示に出す）
const AI_NAMES = { low: '見習いテイマー', mid: 'ベテランテイマー', high: 'デジモンマスター' };
const AI_ICONS = { low: '🐣', mid: '⚔️', high: '👑' };
const LS_KEY = 'aibLastDecks';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const countList = (list) => String(list || '').split(',').reduce((s, l) => { const m = l.match(/x(\d+)$/); return s + (m ? parseInt(m[1], 10) : 0); }, 0);
const deckName = (d) => d.name || d.deckName || '';
const subOf = (d, source) => (source === 'sample' ? [d.category, `${countList(d.list)}枚`].filter(Boolean).join('・') : `${countList(d.list)}枚`);

// 前回選んだデッキを覚えておく（この端末だけ・無くても動く）
function loadLast() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (_) { return {}; } }
function saveLast() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ my: selMy ? deckName(selMy) : '', ai: selAi ? deckName(selAi.deck) : '', aiSrc: selAi ? selAi.source : '' })); } catch (_) {}
}

function renderPick(elId, deck, sub, emptyText) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.toggle('chosen', !!deck);
  el.innerHTML = deck
    ? `<img src="${esc(getGoogleDriveDirectLink(deck.cover))}" onerror="this.style.visibility='hidden'">
       <div class="aib-pick-body"><div class="aib-pick-name">${esc(deckName(deck))}</div><div class="aib-pick-sub">${esc(sub)}</div></div>
       <div class="aib-pick-btn">変更</div>`
    : `<div class="aib-pick-ph">＋</div>
       <div class="aib-pick-body"><div class="aib-pick-name" style="color:#aaa;">${esc(emptyText)}</div></div>
       <div class="aib-pick-btn">選ぶ</div>`;
}

function renderPicks() {
  renderPick('aib-my-pick', selMy, selMy ? subOf(selMy, 'mine') : '', myDecks.length ? 'デッキを選んでください' : 'マイデッキがありません（先に「デッキ作成」で作ってください）');
  renderPick('aib-ai-pick', selAi && selAi.deck, selAi ? (selAi.source === 'sample' ? 'おすすめ・' : 'マイデッキ・') + subOf(selAi.deck, selAi.source) : '', 'AIに使わせるデッキを選んでください');
}

window.aibRenderPicker = function() {
  const listEl = document.getElementById('aib-list');
  if (!listEl) return;
  const isAi = pickerKind === 'ai';
  document.getElementById('aib-picker-tabs').style.display = isAi ? 'flex' : 'none';
  document.getElementById('aib-tab-sample').classList.toggle('sel', aiSource === 'sample');
  document.getElementById('aib-tab-mine').classList.toggle('sel', aiSource === 'mine');
  const source = isAi ? aiSource : 'mine';
  const all = source === 'sample' ? aiSampleDecks : myDecks;
  const q = (document.getElementById('aib-search').value || '').trim().toLowerCase();
  const items = all.map((d, i) => ({ d, i })).filter(({ d }) => !q || deckName(d).toLowerCase().includes(q) || String(d.category || '').toLowerCase().includes(q));
  if (all.length === 0) {
    listEl.innerHTML = `<div class="aib-empty">${source === 'sample' ? 'おすすめデッキはまだありません' : 'マイデッキがありません'}</div>`;
    return;
  }
  if (items.length === 0) { listEl.innerHTML = '<div class="aib-empty">見つかりませんでした</div>'; return; }
  const cur = isAi ? (selAi && selAi.source === source ? selAi.deck : null) : selMy;
  listEl.innerHTML = items.map(({ d, i }) => `<div class="aib-deck${d === cur ? ' sel' : ''}" onclick="aibPick(${i})">
      <img src="${esc(getGoogleDriveDirectLink(d.cover))}" onerror="this.style.visibility='hidden'">
      <div style="min-width:0; flex:1;"><div class="aib-deck-name">${esc(deckName(d))}</div><div class="aib-deck-sub">${esc(subOf(d, source))}</div></div>
    </div>`).join('');
};

window.aibOpenPicker = function(kind) {
  pickerKind = kind;
  if (kind === 'ai' && selAi) aiSource = selAi.source;
  document.getElementById('aib-picker-title').innerText = kind === 'ai' ? 'AIのデッキを選ぶ' : '自分のデッキを選ぶ';
  document.getElementById('aib-search').value = '';
  aibRenderPicker();
  document.getElementById('aib-picker').classList.add('show');
};
window.aibClosePicker = function() { document.getElementById('aib-picker').classList.remove('show'); };
window.aibSetAiSource = function(src) { aiSource = src; aibRenderPicker(); };
window.aibPick = function(i) {
  if (pickerKind === 'ai') {
    const d = (aiSource === 'sample' ? aiSampleDecks : myDecks)[i];
    if (d) selAi = { deck: d, source: aiSource };
  } else {
    selMy = myDecks[i] || null;
  }
  saveLast();
  renderPicks();
  aibClosePicker();
};

window.showAiBattleSetup = async function() {
  showScreen('ai-battle-screen');
  selMy = null; selAi = null;
  const myEl = document.getElementById('aib-my-pick');
  const aiEl = document.getElementById('aib-ai-pick');
  myEl.innerHTML = aiEl.innerHTML = '<div class="aib-empty" style="flex:1;">読み込み中...</div>';
  const [mine, samples] = await Promise.all([
    gasGet('getDecks', { pw: currentSessionPassword }).catch((e) => ({ error: e.message })),
    gasGet('getSampleDecks', { forAi: '1' }).catch((e) => ({ error: e.message })),
  ]);
  myDecks = Array.isArray(mine) ? mine : [];
  aiSampleDecks = Array.isArray(samples) ? samples : [];
  aiSource = aiSampleDecks.length === 0 && myDecks.length > 0 ? 'mine' : 'sample';
  // 前回のデッキを選んだ状態にする
  const last = loadLast();
  selMy = myDecks.find((d) => deckName(d) === last.my) || null;
  const lastSrc = last.aiSrc === 'mine' ? 'mine' : 'sample';
  const lastAi = (lastSrc === 'sample' ? aiSampleDecks : myDecks).find((d) => deckName(d) === last.ai);
  if (lastAi) selAi = { deck: lastAi, source: lastSrc };
  renderPicks();
  if (mine && mine.error) myEl.innerHTML = `<div class="aib-empty" style="flex:1; color:#ff4444;">読み込みエラー: ${esc(mine.error)}</div>`;
};

window.aibSetLevel = function(el) {
  if (el.classList.contains('disabled')) return;
  level = el.dataset.v;
  document.querySelectorAll('#aib-levels .aib-lv').forEach((x) => x.classList.toggle('sel', x === el));
};

// デッキの中身を確かめる（メイン50枚・デジタマ5枚まで）。図鑑に無いカード・挙動確認前のカードも数える
function checkDeck(list) {
  let main = 0, tama = 0;
  const missing = [], notOk = [];
  String(list || '').split(',').forEach((line) => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (!m) return;
    const n = parseInt(m[3], 10);
    const card = allCards.find((c) => c['カードNo'] === m[2]);
    if (!card) { missing.push(m[1]); return; }
    if (String(card['レベル']) === '2') tama += n; else main += n;
    if (!isBehaviorOk(card)) notOk.push(card['名前'] + '（' + m[2] + '）');
  });
  return { main, tama, missing, notOk };
}

// 対戦開始: デッキを確かめてから、サイコロで先攻・後攻を決める
window.aibStart = async function() {
  if (!selMy) return alert('自分のデッキを選んでください');
  if (!selAi) return alert('AIのデッキを選んでください');
  const btn = document.getElementById('aib-start-btn');
  btn.disabled = true; btn.innerText = '準備中...';
  try {
    const my = selMy, ai = selAi.deck;
    const nos = [my.list, ai.list].join(',').split(',').map((l) => { const m = l.match(/\((.+)\)x\d+/); return m ? m[1] : null; }).filter(Boolean);
    await loadCardsByNo(nos);
    const cm = checkDeck(my.list), ca = checkDeck(ai.list);
    const bad = (c, who) => (c.main !== 50 ? `${who}のメインデッキが50枚ではありません（${c.main}枚）\n` : '')
      + (c.tama > 5 ? `${who}のデジタマデッキが5枚を超えています（${c.tama}枚）\n` : '')
      + (c.missing.length ? `${who}のデッキに見つからないカードがあります: ${c.missing.join('、')}\n` : '');
    const errs = bad(cm, '自分') + bad(ca, 'AI');
    if (errs) { alert(errs); return; }
    const notOk = [...new Set([...cm.notOk, ...ca.notOk])];
    if (notOk.length && !confirm(`挙動確認がまだのカードが入っています（効果が正しく動かないことがあります）:\n${notOk.slice(0, 10).join('\n')}${notOk.length > 10 ? `\n…ほか${notOk.length - 10}種類` : ''}\n\nこのまま対戦しますか？`)) return;
    openDice();
  } catch (e) {
    alert('開始できませんでした: ' + e.message);
  } finally {
    btn.disabled = false; btn.innerText = '対戦開始';
  }
};

// ===== サイコロ =====
const DOTS = {
  1: [[2,2]], 2: [[1,3],[3,1]], 3: [[1,3],[2,2],[3,1]],
  4: [[1,1],[1,3],[3,1],[3,3]], 5: [[1,1],[1,3],[2,2],[3,1],[3,3]],
  6: [[1,1],[1,3],[2,1],[2,3],[3,1],[3,3]],
};
function drawFace(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!n) { el.className = 'aib-dice-face q'; el.innerHTML = '?'; return; }
  el.className = 'aib-dice-face';
  let html = '';
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) {
    html += DOTS[n].some(([dr, dc]) => dr === r && dc === c) ? '<div class="aib-dot" style="grid-row:' + r + ';grid-column:' + c + ';"></div>' : '';
  }
  el.innerHTML = html;
}
function setDiceMsg(t, color) { const m = document.getElementById('aib-dice-msg'); if (m) { m.innerText = t; m.style.color = color || 'var(--main-cyan)'; } }
function setRollBtn(enabled) {
  const b = document.getElementById('aib-roll-btn'); if (b) { b.disabled = !enabled; b.style.opacity = enabled ? '1' : '0.35'; }
  const c = document.getElementById('aib-dice-cancel'); if (c) c.style.display = enabled ? '' : 'none';
}
function resetDice() {
  drawFace('aib-dface-me', 0); drawFace('aib-dface-ai', 0);
  document.getElementById('aib-dbox-me').classList.remove('win');
  document.getElementById('aib-dbox-ai').classList.remove('win');
  setDiceMsg('サイコロを振ってください（大きい方が先攻）');
  setRollBtn(true);
}
function openDice() {
  document.getElementById('aib-dwho-ai').innerText = (AI_ICONS[level] || '🤖') + ' ' + (AI_NAMES[level] || 'AI');
  resetDice();
  starting = false;
  document.getElementById('aib-dice').classList.add('show');
}
window.aibCloseDice = function() { if (!starting) document.getElementById('aib-dice').classList.remove('show'); };

// 自分は 3D のサイコロ（オンライン対戦と同じ演出）、AI は枠の中で転がして目を出す
window.aibRoll = function() {
  setRollBtn(false);
  const afterMine = (me) => {
    drawFace('aib-dface-me', me);
    setDiceMsg('AIがサイコロを振っています...');
    const ai = Math.ceil(Math.random() * 6);
    let n = 0;
    const iv = setInterval(() => {
      drawFace('aib-dface-ai', Math.ceil(Math.random() * 6));
      if (++n > 14) {
        clearInterval(iv);
        drawFace('aib-dface-ai', ai);
        if (me === ai) {
          setDiceMsg('引き分け！もう一度', '#ffcc00');
          setTimeout(resetDice, 1500);
          return;
        }
        const playerFirst = me > ai;
        document.getElementById(playerFirst ? 'aib-dbox-me' : 'aib-dbox-ai').classList.add('win');
        setDiceMsg(playerFirst ? '🎉 あなたが先攻です！' : 'AIが先攻です', '#00ff88');
        starting = true;
        setTimeout(() => {
          document.getElementById('aib-dice').classList.remove('show');
          beginBattle(playerFirst);
        }, 1600);
      }
    }, 80);
  };
  if (typeof window.rollDiceShared === 'function' && document.getElementById('dice-overlay')) window.rollDiceShared(afterMine);
  else afterMine(Math.ceil(Math.random() * 6));
};

async function beginBattle(playerFirst) {
  const my = selMy, ai = selAi.deck;
  try {
    // チュートリアルが残っていれば止める（CPU の行動がチュートリアルのスクリプトに切り替わるため）
    if (window._tutorialRunner) { try { window._tutorialRunner.stop(); } catch (_) {} }
    window._aiLevel = level;
    window._aiName = AI_NAMES[level] || 'AI';
    window._aiIcon = AI_ICONS[level] || '🤖';
    window._aiBattleActive = true;
    // 勝敗が決まったら AI対戦の準備画面に戻る
    window._onGameEnd = () => {
      window._aiBattleActive = false;
      window._onGameEnd = null;
      showAiBattleSetup();
    };
    await window.startBattleGame({ list: my.list }, { list: ai.list }, playerFirst);
    const oppLabel = document.getElementById('opponent-name-label');
    if (oppLabel) oppLabel.innerText = window._aiIcon + ' ' + window._aiName;
  } catch (e) {
    window._aiBattleActive = false;
    alert('開始できませんでした: ' + e.message);
  } finally {
    starting = false;
  }
}

// ===== AIの考え（AIが何を考えてその行動をしたか、だけを集めたログ）=====
// battle-combat.js / battle-phase.js / effect-engine.js の判断の箇所が window._aiWhy(文) を呼ぶ。
// 「🧠 AIの考え」ボタンで右側のパネルを開閉する（開いている間は新しい考えが下に足されていく）
const _aiWhyList = [];
window._aiWhyReset = () => { _aiWhyList.length = 0; _renderWhy(); };
window._aiWhyPush = (msg) => {
  const b = window._lastBattleState;
  const turn = b ? b.turn : 0;
  const mine = b ? b.isPlayerTurn === false : true;
  _aiWhyList.push({ turn, mine, msg: String(msg || '') });
  if (_aiWhyList.length > 400) _aiWhyList.splice(0, _aiWhyList.length - 400);
  _renderWhy();
};
function _renderWhy() {
  const panel = document.getElementById('ai-why-panel');
  const btn = document.getElementById('ai-why-btn');
  if (btn) btn.innerText = '🧠 AIの考え' + (_aiWhyList.length ? '（' + _aiWhyList.length + '）' : '');
  if (!panel) return;
  const list = panel.querySelector('._why-list');
  if (!list) return;
  let lastKey = '';
  list.innerHTML = _aiWhyList.map((e) => {
    const key = e.turn + ':' + e.mine;
    const head = key !== lastKey ? '<div style="margin:10px 0 4px;color:#c9b6ff;font-size:11px;font-weight:bold;border-bottom:1px solid #3a2a66;padding-bottom:2px;">ターン' + esc(e.turn) + (e.mine ? '（AIのターン）' : '（あなたのターン）') + '</div>' : '';
    lastKey = key;
    // 「行動 ← 理由」の形なら、行動を太字、理由をその下に文章で出す
    const k = e.msg.indexOf(' ← ');
    const act = k >= 0 ? e.msg.slice(0, k) : e.msg;
    const why = k >= 0 ? e.msg.slice(k + 3) : '';
    const icon = e.mine ? '🤖' : '👀';
    return head + '<div style="margin:6px 0;padding:6px 8px;border-left:3px solid ' + (e.mine ? '#6a2cff' : '#ff9f43') + ';background:rgba(255,255,255,0.03);border-radius:0 6px 6px 0;">'
      + '<div style="color:#fff;font-size:12.5px;font-weight:bold;line-height:1.5;">' + icon + ' ' + esc(act) + '</div>'
      + (why ? '<div style="color:#c8c8d8;font-size:12px;line-height:1.6;margin-top:2px;">' + esc(why) + '</div>' : '')
      + '</div>';
  }).join('') || '<div style="color:#777;font-size:12px;padding:12px;">まだありません</div>';
  list.scrollTop = list.scrollHeight;
}
window.aiToggleWhy = function() {
  let panel = document.getElementById('ai-why-panel');
  if (panel) { panel.remove(); return; }
  panel = document.createElement('div');
  panel.id = 'ai-why-panel';
  panel.style.cssText = 'position:fixed;right:8px;top:60px;bottom:80px;width:min(360px,calc(100vw - 16px));z-index:69000;background:rgba(12,8,24,0.96);'
    + 'border:1px solid #6a2cff;border-radius:12px;box-shadow:0 0 18px rgba(106,44,255,0.5);display:flex;flex-direction:column;';
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #3a2a66;">'
    + '<div style="color:#c9b6ff;font-weight:bold;font-size:14px;">🧠 ' + esc(window._aiName || 'AI') + 'の考え</div>'
    + '<button onclick="aiToggleWhy()" style="background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;">✕</button></div>'
    + '<div class="_why-list" style="flex:1;overflow-y:auto;padding:4px 12px 12px;"></div>';
  document.body.appendChild(panel);
  _renderWhy();
};

// ===== テスト用: AIの手札を見る =====
// テスト中だけ有効。公開するときは false にする（ボタンが出なくなる）
const AI_HAND_PEEK = true;
window._aiHandPeekEnabled = AI_HAND_PEEK;
window.aiPeekHand = function() {
  const b = window._lastBattleState;
  if (!b || !b.ai || !window._aiBattleActive) return;
  const old = document.getElementById('ai-peek-overlay');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'ai-peek-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:70000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  // 開いている間は1秒ごとに中身を更新する（AIが引いた・使ったカードがすぐ反映される）
  const _sig = () => (b.ai.hand || []).map((c) => c.cardNo || c.name).join(',') + '|' + b.memory + '|' + (b.ai.deck || []).length + '|' + (b.ai.security || []).length;
  const _s0 = _sig();
  const _iv = setInterval(() => {
    if (!document.body.contains(ov) || !window._aiBattleActive) { clearInterval(_iv); return; }
    if (_sig() !== _s0) { clearInterval(_iv); window.aiPeekHand(); }
  }, 1000);
  const imgOf = (c) => c.imgSrc || getGoogleDriveDirectLink(c.imageUrl || c['ImageURL'] || '') || '';
  const cards = (b.ai.hand || []).map((c) => {
    const cost = c.playCost != null && c.playCost !== '' ? c.playCost : '-';
    const sub = [c.type, c.level && c.level !== 'なし' ? 'Lv.' + c.level : '', c.dp ? 'DP' + c.dp : '', 'コスト' + cost].filter(Boolean).join('・');
    return `<div style="width:92px;text-align:center;">
      <img src="${esc(imgOf(c))}" onerror="this.style.visibility='hidden'" style="width:92px;height:128px;object-fit:cover;border-radius:6px;background:#222;display:block;">
      <div style="color:#fff;font-size:11px;font-weight:bold;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</div>
      <div style="color:#aaa;font-size:9px;line-height:1.3;">${esc(sub)}</div>
    </div>`;
  }).join('');
  ov.innerHTML = `<div style="background:#0b0f18;border:1px solid #ff00fb;border-radius:14px;padding:14px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;box-sizing:border-box;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="color:#ff9cff;font-weight:bold;font-size:14px;">👁 AIの手札</div>
      <button onclick="document.getElementById('ai-peek-overlay').remove()" style="background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;">✕</button>
    </div>
    <div style="color:#888;font-size:11px;margin-bottom:10px;">AI側のメモリー ${Math.max(0, -b.memory)}（${b.isPlayerTurn ? 'あなたのターン' : 'AIのターン'}） / 手札 ${(b.ai.hand || []).length}枚 / デッキ ${(b.ai.deck || []).length}枚 / デジタマ ${(b.ai.tamaDeck || []).length}枚 / セキュリティ ${(b.ai.security || []).length}枚</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;">${cards || '<div style="color:#666;font-size:12px;padding:16px;">手札はありません</div>'}</div>
  </div>`;
  document.body.appendChild(ov);
};
