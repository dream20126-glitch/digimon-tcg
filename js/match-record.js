// 戦績の記録（オンライン対戦・AI対戦）。保存先は GAS のシート「戦績」（プレイヤー名＋パスワードごと。どの端末からでも見られる）
// - 対戦の開始で「中断」の記録を1行作る → 決着したら同じ記録IDを勝ち/負けに書き換える。途中で終わった対戦は「中断」のまま残る
// - 自分の分だけ記録する（オンラインは両方の端末がそれぞれ自分の記録を付ける）
// - チュートリアル・テスト画面は記録しない（start を呼ぶのは AI対戦・オンライン対戦の開始だけ）
import { gasPost } from './firebase-config.js';

const LS_KEY = 'matchRecordCur';
let cur = null; // 記録中の対戦

function saveLocal() { try { if (cur) localStorage.setItem(LS_KEY, JSON.stringify(cur)); else localStorage.removeItem(LS_KEY); } catch (_) {} }

function post(rec) {
  const name = rec._player, pw = rec._pw;
  if (!name || !pw) return;
  const body = Object.assign({}, rec);
  delete body._player; delete body._pw; delete body._lastSide; delete body.roomId;
  // 1つずつ順番に送る（開始の「中断」が決着の記録より後に届いて上書きしないように）
  _chain = _chain.then(() => gasPost('saveMatchRecord', { playerName: name, password: pw, record: body }))
    .then((r) => { if (r && r.status !== 'OK') console.warn('[戦績] 保存できませんでした', r); })
    .catch((e) => console.warn('[戦績] 保存できませんでした', e));
}
let _chain = Promise.resolve();

// info: { mode:'online'|'ai', opp, aiLevel, myDeck, oppDeck, first, roomId }
function start(info) {
  const now = Date.now();
  cur = {
    id: 'm' + now + '-' + Math.floor(Math.random() * 100000),
    mode: info.mode, opp: info.opp || '', aiLevel: info.aiLevel || '',
    myDeck: info.myDeck || '', oppDeck: info.oppDeck || '',
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

// result: '勝ち' | '負け'、reason: 'ダイレクトアタック' | 'デッキ切れ' | '投了' 等
function end(result, reason) {
  if (!cur) return;
  cur.result = result;
  cur.reason = reason || 'その他';
  cur.durationSec = Math.round((Date.now() - cur.startedAt) / 1000);
  post(cur);
  cur = null;
  saveLocal();
}

// 途中で終わった（ゲートを出た・相手が退室した）: 「中断」のまま、ターン数と時間だけ書き込んで終える
function abort() {
  if (!cur) return;
  cur.result = '中断'; cur.reason = '中断';
  cur.durationSec = Math.round((Date.now() - cur.startedAt) / 1000);
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

window._matchRecord = { start, end, abort, resume, turnStart, isActive: () => !!cur };
window._matchTurnStart = (isPlayerTurn) => turnStart(isPlayerTurn);
