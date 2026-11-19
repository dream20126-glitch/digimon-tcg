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
