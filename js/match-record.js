// 戦績の記録（オンライン対戦・AI対戦）。保存先は GAS のシート「戦績」（プレイヤー名＋パスワードごと。どの端末からでも見られる）
// - 対戦の開始で「中断」の記録を1行作る → 決着したら同じ記録IDを勝ち/負けに書き換える。途中で終わった対戦は「中断」のまま残る
// - 自分の分だけ記録する（オンラインは両方の端末がそれぞれ自分の記録を付ける）
// - チュートリアル・テスト画面は記録しない（start を呼ぶのは AI対戦・オンライン対戦の開始だけ）
// - 送る記録は端末の「送信待ち」に入れてから送り、届いたら消す。送れないまま画面を閉じても、次に開いたときに送り直す
//   （決着の直後にブラウザを閉じて、片方の記録だけ「中断」のまま残るのを防ぐ）
import { gasPost, GAS_URL } from './firebase-config.js';

const LS_KEY = 'matchRecordCur';
const LS_OUTBOX = 'matchRecordOutbox';
let cur = null; // 記録中の対戦

function saveLocal() { try { if (cur) localStorage.setItem(LS_KEY, JSON.stringify(cur)); else localStorage.removeItem(LS_KEY); } catch (_) {} }

// ===== 送信待ち =====
function readOutbox() { try { return JSON.parse(localStorage.getItem(LS_OUTBOX) || '[]') || []; } catch (_) { return []; } }
function writeOutbox(list) { try { if (list.length) localStorage.setItem(LS_OUTBOX, JSON.stringify(list)); else localStorage.removeItem(LS_OUTBOX); } catch (_) {} }
let outboxMem = null; // localStorage が使えない端末用
function getOutbox() { const l = readOutbox(); return l.length || !outboxMem ? l : outboxMem; }
function setOutbox(l) { outboxMem = l; writeOutbox(l); }

function payloadOf(rec) {
  const body = Object.assign({}, rec);
  delete body._player; delete body._pw; delete body._lastSide; delete body.roomId;
  return { action: 'saveMatchRecord', playerName: rec._player, password: rec._pw, record: body };
}

let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const box = getOutbox();
      if (!box.length) break;
      const item = box[0];
      let ok = false;
      try {
        const r = await gasPost('saveMatchRecord', { playerName: item.playerName, password: item.password, record: item.record });
        ok = !!(r && r.status === 'OK');
        if (!ok) console.warn('[戦績] 保存できませんでした', r);
      } catch (e) { console.warn('[戦績] 保存できませんでした', e); }
      if (!ok) break; // 次の機会（次の記録・次に開いたとき）に送り直す
      // 送っている間に同じ記録が新しくなっていたら、新しい方は残す
      const now = getOutbox();
      const i = now.findIndex((x) => x.record.id === item.record.id && x.seq === item.seq);
      if (i >= 0) now.splice(i, 1);
      setOutbox(now);
    }
  } finally { draining = false; }
}

let seq = 0;
function post(rec) {
  if (!rec._player || !rec._pw) return;
  const p = payloadOf(rec);
  p.seq = Date.now() + '-' + (seq++);
  // 同じ記録の古い送信待ちは新しいものに置き換える（開始の「中断」が決着の記録を上書きしないように）
  // （いま送っている途中の先頭は残し、その後ろに新しいものを並べる。1つずつ順に送るので最後に届くのは新しい方）
  const box = getOutbox().filter((x, i) => x.record.id !== p.record.id || (draining && i === 0));
  box.push(p);
  setOutbox(box);
  drain();
}

// 画面を閉じる・別のページへ移るとき: 送信待ちが残っていれば sendBeacon で送っておく（届かなくても次に開いたとき送り直す）
window.addEventListener('pagehide', () => {
  const box = getOutbox();
  if (!box.length || !navigator.sendBeacon) return;
  box.forEach((p) => { try { navigator.sendBeacon(GAS_URL, new Blob([JSON.stringify({ action: p.action, playerName: p.playerName, password: p.password, record: p.record })], { type: 'text/plain;charset=UTF-8' })); } catch (_) {} });
});
// 開いたとき: 前に送れなかった記録を送る
setTimeout(() => { if (getOutbox().length) drain(); }, 3000);

// デッキの色（カードの「色」を数えて、2割以上を占める色。多い順に最大3色。例: '赤/黄'）
function deckColors(list) {
  try { return typeof window._deckColorsOf === 'function' ? window._deckColorsOf(list) : ''; } catch (_) { return ''; }
}

// info: { mode:'online'|'ai', opp, aiLevel, myDeck, oppDeck, myList, oppList, myCover, oppCover, first, roomId }
function start(info) {
  const now = Date.now();
  cur = {
    id: 'm' + now + '-' + Math.floor(Math.random() * 100000),
    mode: info.mode, opp: info.opp || '', aiLevel: info.aiLevel || '',
    myDeck: info.myDeck || '', oppDeck: info.oppDeck || '',
    myColors: deckColors(info.myList), oppColors: deckColors(info.oppList),
    myCover: info.myCover || '', oppCover: info.oppCover || '',
    first: !!info.first, startedAt: now,
    result: '中断', reason: '中断', turns: 1, durationSec: 0,
    roomId: info.roomId || '', _lastSide: !!info.first,
    _player: window.currentPlayerName || '', _pw: window.currentSessionPassword || '',
  };
  saveLocal();
  post(cur);
}

// ターンが変わったとき（bs.isPlayerTurn が切り替わった所から呼ばれる）。同じ側が続けて呼ばれても数えない
function turnStart(isPlayerTurn) {
  if (!cur) return;
  const side = !!isPlayerTurn;
  if (side === cur._lastSide) return;
  cur._lastSide = side;
  cur.turns++;
  saveLocal();
}

// 決着したときのセキュリティの枚数（接戦だったか）
function secNow() {
  const b = window.bs || window._lastBattleState;
  if (!b || !b.player || !b.ai) return { mySec: null, oppSec: null };
  const n = (a) => (Array.isArray(a) ? a.length : null);
  return { mySec: n(b.player.security), oppSec: n(b.ai.security) };
}

// result: '勝ち' | '負け'、reason: 'ダイレクトアタック' | 'デッキ切れ' | '投了' 等
function end(result, reason) {
  if (!cur) return;
  cur.result = result;
  cur.reason = reason || 'その他';
  cur.durationSec = Math.round((Date.now() - cur.startedAt) / 1000);
  Object.assign(cur, secNow());
  post(cur);
  cur = null;
  saveLocal();
  api.justRecorded = true; // 勝敗の画面に「戦績に記録しました」を出す
}

// 途中で終わった（ゲートを出た・相手が退室した）: 「中断」のまま、ターン数と時間だけ書き込んで終える
function abort() {
  if (!cur) return;
  cur.result = '中断'; cur.reason = '中断';
  cur.durationSec = Math.round((Date.now() - cur.startedAt) / 1000);
  Object.assign(cur, secNow());
  post(cur);
  cur = null;
  saveLocal();
}

// 読み込み直してオンライン対戦に戻った: 端末に残した記録の続きから
function resume(roomId) {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (s && s.mode === 'online' && s.roomId && s.roomId === roomId) { cur = s; return true; }
  } catch (_) {}
  return false;
}

const api = { start, end, abort, resume, turnStart, isActive: () => !!cur, justRecorded: false, pending: () => getOutbox().length };
window._matchRecord = api;
window._matchTurnStart = (isPlayerTurn) => turnStart(isPlayerTurn);
