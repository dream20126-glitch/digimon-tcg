// AI対戦（オフラインで CPU と対戦）の準備画面
// - 自分のデッキ: マイデッキ
// - AIのデッキ: 「おすすめデッキ」＝サンプルデッキのうち「AI用」にチェックしたもの（管理画面で作成）／マイデッキ
// - 難易度: window._aiLevel（'low' | 'mid' | 'high'）。CPU の判断はこの値で切り替える（今は「低」のみ）
// - 対戦は startBattleGame（チュートリアルと同じオフライン対戦）を使う
import { gasGet } from './firebase-config.js';
import { loadCardsByNo, getGoogleDriveDirectLink, isBehaviorOk } from './cards.js';

let myDecks = [];       // マイデッキ（getDecks）
let aiSampleDecks = []; // おすすめデッキ（getSampleDecks forAi=1）
let aiSource = 'sample';
let selMy = -1;
let selAi = -1;
let level = 'low';
let order = 'random';
// 難易度ごとの AI の名前（対戦画面の相手の名前・ターン開始の表示に出す）
const AI_NAMES = { low: '見習いテイマー', mid: 'ベテランテイマー', high: 'デジモンマスター' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const countList = (list) => String(list || '').split(',').reduce((s, l) => { const m = l.match(/x(\d+)$/); return s + (m ? parseInt(m[1], 10) : 0); }, 0);

function deckRow(d, active, onclick, sub) {
  return `<div class="aib-deck${active ? ' active' : ''}" onclick="${onclick}">
    <img src="${esc(getGoogleDriveDirectLink(d.cover))}" onerror="this.style.visibility='hidden'">
    <div style="min-width:0; flex:1;">
      <div class="aib-deck-name">${esc(d.name || d.deckName)}</div>
      <div class="aib-deck-sub">${esc(sub)}</div>
    </div>
  </div>`;
}

function renderMy() {
  const area = document.getElementById('aib-my-decks');
  if (!area) return;
  if (myDecks.length === 0) { area.innerHTML = '<div class="aib-empty">マイデッキがありません。先に「デッキ作成」でデッキを作ってください</div>'; return; }
  area.innerHTML = myDecks.map((d, i) => deckRow(d, i === selMy, `aibSelectMy(${i})`, `${countList(d.list)}枚`)).join('');
}

function renderAi() {
  const area = document.getElementById('aib-ai-decks');
  if (!area) return;
  document.getElementById('aib-tab-sample').classList.toggle('active', aiSource === 'sample');
  document.getElementById('aib-tab-mine').classList.toggle('active', aiSource === 'mine');
  const list = aiSource === 'sample' ? aiSampleDecks : myDecks;
  if (list.length === 0) {
    area.innerHTML = `<div class="aib-empty">${aiSource === 'sample' ? 'おすすめデッキはまだありません' : 'マイデッキがありません'}</div>`;
    return;
  }
  area.innerHTML = list.map((d, i) => deckRow(d, i === selAi, `aibSelectAi(${i})`,
    aiSource === 'sample' ? (d.category || d.description || `${countList(d.list)}枚`) : `${countList(d.list)}枚`)).join('');
}

window.showAiBattleSetup = async function() {
  showScreen('ai-battle-screen');
  selMy = -1; selAi = -1;
  const myArea = document.getElementById('aib-my-decks');
  const aiArea = document.getElementById('aib-ai-decks');
  myArea.innerHTML = aiArea.innerHTML = '<div class="aib-empty">読み込み中...</div>';
  const [mine, samples] = await Promise.all([
    gasGet('getDecks', { pw: currentSessionPassword }).catch((e) => ({ error: e.message })),
    gasGet('getSampleDecks', { forAi: '1' }).catch((e) => ({ error: e.message })),
  ]);
  myDecks = Array.isArray(mine) ? mine : [];
  aiSampleDecks = Array.isArray(samples) ? samples : [];
  if (mine && mine.error) myArea.innerHTML = `<div class="aib-empty" style="color:#ff4444;">読み込みエラー: ${esc(mine.error)}</div>`;
  else renderMy();
  if (aiSampleDecks.length === 0 && myDecks.length > 0) aiSource = 'mine';
  renderAi();
};

window.aibSelectMy = function(i) { selMy = i; renderMy(); };
window.aibSelectAi = function(i) { selAi = i; renderAi(); };
window.aibSetAiSource = function(src) { if (aiSource !== src) { aiSource = src; selAi = -1; } renderAi(); };
window.aibSetLevel = function(el) {
  if (el.classList.contains('disabled')) return;
  level = el.dataset.v;
  document.querySelectorAll('#aib-levels .aib-opt').forEach((x) => x.classList.toggle('active', x === el));
};
window.aibSetOrder = function(el) {
  order = el.dataset.v;
  document.querySelectorAll('#aib-orders .aib-opt').forEach((x) => x.classList.toggle('active', x === el));
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

window.aibStart = async function() {
  const my = myDecks[selMy];
  const ai = (aiSource === 'sample' ? aiSampleDecks : myDecks)[selAi];
  if (!my) return alert('自分のデッキを選んでください');
  if (!ai) return alert('AIのデッキを選んでください');
  const btn = document.getElementById('aib-start-btn');
  btn.disabled = true; btn.innerText = '準備中...';
  try {
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

    const playerFirst = order === 'first' ? true : order === 'second' ? false : Math.random() < 0.5;
    // チュートリアルが残っていれば止める（CPU の行動がチュートリアルのスクリプトに切り替わるため）
    if (window._tutorialRunner) { try { window._tutorialRunner.stop(); } catch (_) {} }
    window._aiLevel = level;
    window._aiName = AI_NAMES[level] || 'AI';
    window._aiBattleActive = true;
    // 勝敗が決まったら AI対戦の準備画面に戻る
    window._onGameEnd = () => {
      window._aiBattleActive = false;
      window._onGameEnd = null;
      showAiBattleSetup();
    };
    await window.startBattleGame({ list: my.list }, { list: ai.list }, playerFirst);
    const oppLabel = document.getElementById('opponent-name-label');
    if (oppLabel) oppLabel.innerText = '🤖 ' + window._aiName;
  } catch (e) {
    alert('開始できませんでした: ' + e.message);
  } finally {
    btn.disabled = false; btn.innerText = '対戦開始';
  }
};
