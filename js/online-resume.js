// オンライン対戦の再接続（読み込み直してもルームに戻る）
//
// iPhone の Safari はメモリが足りなくなると、操作していなくてもページを読み込み直す。読み込み直すとログイン画面に戻り、
// 手札・デッキの並び・セキュリティ等（その端末にしかない情報）も消えて対戦を続けられなかった。そこで:
//  1. 対戦中は、自分の盤面（bs）をこの端末（localStorage）に保存しておく（同期のたび・数秒ごと・画面を離れるとき）
//  2. 読み込み直したら「対戦に戻りますか？」を出し、保存した盤面でルームに入り直す（battle.js resumeOnlineBattle）
//  3. 相手がルームから外れている間は「接続中…」と「ルームを退出する」を出して待つ。相手が戻ったら自動で消す
//  4. 相手がルームを退出していたら（ルームが無い）、入り直せない
import { rtdb, ref, update, onValue, onDisconnect } from './firebase-config.js';

const RESUME_KEY = 'dtcg-online-resume';
const SNAP_KEY = 'dtcg-online-snapshot';
const RESUME_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3時間より前の対戦には戻らない

const _ls = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('[online-resume] 保存できませんでした', k, e && e.message); return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

// ===== 盤面の保存・復元 =====
// カード等の普通のデータだけを写す（関数・DOM は捨てる）。同じオブジェクトが2か所にあってもそれぞれ写す（祖先だけで循環を判定）。
// カードの効果の文・レシピ・画像のURL等はカードNoからカードデータで作り直せるので保存しない（保存を軽くする。iPhone のメモリ対策）
const CARD_STATIC_KEYS = new Set(['recipe', 'effect', 'evoSourceEffect', 'securityEffect', 'imgSrc', 'imageUrl', 'useCond', 'evolveCond', 'linkCond',
  'evolveCostRaw', 'evolveCostFeatureRaw', 'evolveCostNameRaw']);
const _isCard = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.cardNo === 'string' && v.cardNo && typeof v.name === 'string';
function _clone(v, anc, depth) {
  if (v === null || typeof v !== 'object') return (typeof v === 'function' || typeof v === 'symbol') ? undefined : v;
  if (depth > 14 || anc.has(v)) return undefined;
  if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
  anc.add(v);
  let out;
  if (Array.isArray(v)) out = v.map(x => { const c = _clone(x, anc, depth + 1); return c === undefined ? null : c; });
  else {
    out = {};
    const card = _isCard(v);
    Object.keys(v).forEach(k => {
      if (card && CARD_STATIC_KEYS.has(k)) return;
      const c = _clone(v[k], anc, depth + 1); if (c !== undefined) out[k] = c;
    });
    if (card) out._rs = 1; // 効果の文・レシピを省いた印（戻すときにカードデータから補う）
  }
  anc.delete(v);
  return out;
}
// 戻すとき: 省いた効果の文・レシピ等をカードデータから補う（makeCard(cardNo, name) は新しいカード。battle.js が渡す）
function _rehydrate(v, makeCard, depth) {
  if (!v || typeof v !== 'object' || depth > 14) return;
  if (Array.isArray(v)) { v.forEach(x => _rehydrate(x, makeCard, depth + 1)); return; }
  if (v._rs && _isCard(v)) {
    delete v._rs;
    const fresh = makeCard(v.cardNo, v.name);
    if (fresh) CARD_STATIC_KEYS.forEach(k => { if (v[k] === undefined && fresh[k] !== undefined) v[k] = fresh[k]; });
  }
  Object.keys(v).forEach(k => { const x = v[k]; if (x && typeof x === 'object') _rehydrate(x, makeCard, depth + 1); });
}
// 盤面のうち保存するもの（両側の場・手札・デッキ等と、ターン・フェイズ・メモリー・効果の記録）
const BS_KEYS = ['turn', 'phase', 'isPlayerTurn', 'isFirstTurn', 'memory', '_usedLimits', '_securityBuffs', '_globalEffects',
  '_oppPhase', '_currentTurnAttackCount', '_skipUnsuspend', '_aiSecuritySynced'];
function snapshotOf(bs) {
  const s = { savedAt: Date.now(), player: _clone(bs.player, new Set(), 0), ai: _clone(bs.ai, new Set(), 0) };
  BS_KEYS.forEach(k => { if (bs[k] !== undefined) { const c = _clone(bs[k], new Set(), 0); if (c !== undefined) s[k] = c; } });
  return s;
}
function applySnapshot(bs, s, makeCard) {
  if (!s || !s.player || !s.ai) return false;
  if (typeof makeCard === 'function') { _rehydrate(s.player, makeCard, 0); _rehydrate(s.ai, makeCard, 0); }
  bs.player = s.player;
  bs.ai = s.ai;
  BS_KEYS.forEach(k => { if (s[k] !== undefined) bs[k] = s[k]; });
  bs._battleAborted = false;
  return true;
}

let _saveTimer = null;
let _active = null; // 対戦中の情報 { roomId, myKey, oppKey, ... }
function saveSnapshotNow() {
  if (!_active || !window.bs || window.bs._battleAborted) return;
  if (!(window._isOnlineMode && window._isOnlineMode())) return;
  _ls.set(SNAP_KEY, snapshotOf(window.bs));
  const info = _ls.get(RESUME_KEY);
  if (info) { info.savedAt = Date.now(); _ls.set(RESUME_KEY, info); }
}
function saveSnapshotSoon() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; saveSnapshotNow(); }, 800);
}

// ===== 相手の接続の見張り・待機の画面 =====
let _unsubRoom = null, _unsubConn = null;
function _overlay() { return document.getElementById('_reconnect-wait-overlay'); }
function showWaitOverlay(kind) {
  let ov = _overlay();
  if (!ov) {
    ov = document.createElement('div');
    ov.id = '_reconnect-wait-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;';
    ov.innerHTML = '<div id="_reconnect-wait-msg" style="color:#00fbff;font-size:16px;font-weight:bold;line-height:1.7;text-shadow:0 0 8px #00fbff;"></div>'
      + '<div id="_reconnect-wait-sub" style="color:#aaa;font-size:12px;line-height:1.6;"></div>'
      + '<button type="button" onclick="window._leaveDisconnectedRoom()" style="padding:10px 22px;border-radius:8px;border:1px solid #ff4444;background:#220000;color:#ff6666;font-weight:bold;font-size:14px;cursor:pointer;">ルームを退出する</button>';
    document.body.appendChild(ov);
  }
  const msg = document.getElementById('_reconnect-wait-msg');
  const sub = document.getElementById('_reconnect-wait-sub');
  if (kind === 'left') {
    msg.innerText = '相手がルームを退出しました';
    sub.innerText = '「ルームを退出する」でルームの入口に戻ります。';
  } else {
    msg.innerText = '相手の接続を待っています…';
    sub.innerText = '相手が戻ると自動で対戦を再開します。\n戻らないときは「ルームを退出する」で退出できます（退出すると相手は戻れなくなります）。';
  }
  ov.style.display = 'flex';
}
function hideWaitOverlay() { const ov = _overlay(); if (ov) ov.remove(); }

function stopPresence() {
  if (_unsubRoom) { try { _unsubRoom(); } catch (_) {} _unsubRoom = null; }
  if (_unsubConn) { try { _unsubConn(); } catch (_) {} _unsubConn = null; }
  hideWaitOverlay();
}
function startPresence() {
  stopPresence();
  const a = _active;
  if (!a) return;
  const myRef = ref(rtdb, `rooms/${a.roomId}/${a.myKey}`);
  // 自分の通信が一度切れて戻ったとき（onDisconnect で自分の参加情報が消えている）に、参加情報を戻す
  _unsubConn = onValue(ref(rtdb, '.info/connected'), (snap) => {
    if (snap.val() !== true || _active !== a) return;
    try { onDisconnect(myRef).remove(); } catch (_) {}
    update(myRef, a.myNode || { name: a.myName || '', active: true }).catch(() => {});
  });
  // 相手の参加情報: 無ければ「接続中…」、ルームごと無ければ「退出しました」、戻ったら消す
  let _seen = false;
  _unsubRoom = onValue(ref(rtdb, `rooms/${a.roomId}`), (snap) => {
    if (_active !== a) return;
    const d = snap.val();
    if (!d || d.closed) { if (_seen || (d && d.closed)) showWaitOverlay('left'); return; }
    _seen = true;
    if (!d[a.oppKey]) showWaitOverlay('wait');
    else hideWaitOverlay();
  });
}

// 「ルームを退出する」: ルームを閉じて（ルームを消す）入口へ。相手は戻ろうとしても入れない
window._leaveDisconnectedRoom = function() {
  const roomId = _active && _active.roomId;
  onBattleEnded();
  try { if (window._cleanupOnline) window._cleanupOnline(); } catch (_) {}
  // 対戦の処理が止まっていてルームが残っていた場合も消す
  if (roomId) { try { update(ref(rtdb, `rooms/${roomId}`), { closed: true }).catch(() => {}); } catch (_) {} }
  if (typeof window.showScreen === 'function') window.showScreen('room-entrance-screen');
};

// ===== 対戦の開始・終了（battle.js / battle-online.js から呼ぶ） =====
function onBattleStarted(info) {
  const a = Object.assign({}, info, { oppKey: info.myKey === 'player1' ? 'player2' : 'player1' });
  _active = a;
  _ls.set(RESUME_KEY, Object.assign({}, a, { savedAt: Date.now() }));
  // 対戦中は他の人が空いた枠に入れないようにする（online.js joinRoom が見る）
  update(ref(rtdb, `rooms/${a.roomId}`), { inBattle: true }).catch(() => {});
  startPresence();
  saveSnapshotSoon();
}
function onBattleEnded() {
  _active = null;
  stopPresence();
  _ls.del(RESUME_KEY);
  _ls.del(SNAP_KEY);
}

// 数秒ごと・画面を離れるときにも保存する（同期を送らない相手のターン中も、自分の手札等が変わることがあるため）
setInterval(() => { if (_active && document.visibilityState !== 'hidden') saveSnapshotNow(); }, 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSnapshotNow(); });
window.addEventListener('pagehide', saveSnapshotNow);

// ===== 読み込み直した後: 「対戦に戻りますか？」 =====
function pendingResume() {
  const info = _ls.get(RESUME_KEY);
  const snap = _ls.get(SNAP_KEY);
  if (!info || !snap) return null;
  if (!info.savedAt || Date.now() - info.savedAt > RESUME_MAX_AGE_MS) { onBattleEnded(); return null; }
  // 最初のマリガンの前（セキュリティが置かれる前）は戻れない
  if (!(snap.player && Array.isArray(snap.player.security) && snap.player.security.length > 0) && !(snap.turn > 1)) { onBattleEnded(); return null; }
  return { info, snap };
}
function readRoomOnce(roomId) {
  return new Promise((resolve) => onValue(ref(rtdb, `rooms/${roomId}`), (s) => resolve(s.val()), { onlyOnce: true }));
}
async function resumeNow(p) {
  const { info, snap } = p;
  const room = await readRoomOnce(info.roomId);
  if (!room || room.closed) {
    onBattleEnded();
    alert('相手がルームを退出したため、対戦に戻れません。');
    return;
  }
  // ログイン状態も戻す（読み込み直すとログイン画面に戻っているため）
  if (info.myName) window.currentPlayerName = info.myName;
  if (info.password) window.currentSessionPassword = info.password;
  const el = document.getElementById('display-player-name');
  if (el && info.myName) el.innerText = info.myName + ' さん';
  window.currentRoomId = info.roomId;
  window.myPlayerKey = info.myKey;
  // 自分の参加情報を戻す（読み込み直したときに onDisconnect で消えている）
  const myRef = ref(rtdb, `rooms/${info.roomId}/${info.myKey}`);
  try { onDisconnect(myRef).remove(); } catch (_) {}
  await update(myRef, info.myNode || { name: info.myName || '', active: true }).catch(() => {});
  _active = Object.assign({}, info);
  if (typeof window.resumeOnlineBattle !== 'function') { alert('対戦に戻れませんでした（画面の読み込み前）。'); return; }
  try {
    await window.resumeOnlineBattle(info, snap, (bs, s, makeCard) => applySnapshot(bs, s, makeCard));
    startPresence();
    saveSnapshotSoon();
  } catch (e) {
    console.error('[online-resume] 対戦に戻れませんでした', e);
    alert('対戦に戻れませんでした: ' + (e && e.message ? e.message : e));
  }
}
function promptResume() {
  const p = pendingResume();
  if (!p) return;
  const box = document.createElement('div');
  box.id = '_resume-prompt';
  box.style.cssText = 'position:fixed;inset:0;z-index:99995;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;padding:20px;';
  box.innerHTML = '<div style="max-width:340px;width:100%;background:#0a0f18;border:2px solid #00fbff;border-radius:12px;padding:20px;text-align:center;box-shadow:0 0 24px rgba(0,251,255,0.4);">'
    + '<div style="color:#00fbff;font-size:16px;font-weight:bold;margin-bottom:10px;">対戦の途中です</div>'
    + '<div style="color:#ccc;font-size:13px;line-height:1.7;margin-bottom:16px;">ページが読み込み直されました。<br>「' + String(p.info.oppName || '相手').replace(/[<>&]/g, '') + '」との対戦に戻りますか？</div>'
    + '<button type="button" id="_resume-yes" style="width:100%;padding:12px;margin-bottom:10px;border-radius:8px;border:1px solid #00fbff;background:#002a33;color:#00fbff;font-weight:bold;font-size:15px;cursor:pointer;">対戦に戻る</button>'
    + '<button type="button" id="_resume-no" style="width:100%;padding:10px;border-radius:8px;border:1px solid #555;background:#111;color:#999;font-size:13px;cursor:pointer;">戻らない（ルームを退出する）</button>'
    + '</div>';
  document.body.appendChild(box);
  document.getElementById('_resume-yes').onclick = () => { box.remove(); resumeNow(p); };
  document.getElementById('_resume-no').onclick = () => {
    box.remove();
    // 戻らないならルームを閉じる（相手の画面に「相手がルームを退出しました」が出る）
    update(ref(rtdb, `rooms/${p.info.roomId}`), { closed: true }).catch(() => {});
    onBattleEnded();
  };
}
if (window._appPagesLoaded) promptResume();
else window.addEventListener('app-pages-loaded', promptResume, { once: true });

window._onlineResume = { onBattleStarted, onBattleEnded, saveSnapshotSoon, applySnapshot };
