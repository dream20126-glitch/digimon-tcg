// 対戦の振り返り（リプレイ）。演出は無く、行動ごとの盤面を1コマずつ見る（パラパラ式）
//
// 記録（対戦中）:
//  - 戦績の記録（match-record.js）と同じ対戦だけ記録する（オンライン・AI。チュートリアル・テストはしない）
//  - ログ（addLog）が出たり盤面を描き直したりしたら、少し待ってから盤面を1コマ記録する。前のコマと同じなら記録しない
//  - 1コマは「変わった所だけ」（自分の手札・相手のバトルエリア等の場所ごと）。カードはカードNo・DP・レスト・進化元だけ
//  - 相手の手札も記録する（振り返りでは表向きで見せる。2026-11-26 ユーザー決定）。セキュリティ・デッキは枚数だけ
// 保存（決着したとき）: Firebase Realtime Database
//  - replayData/{ukey}/{記録ID} = 圧縮した記録（gzip → 文字）、replayMeta/{ukey}/{記録ID} = { at, fav, n }
//  - ukey = 「名前＋パスワード」から作った推測できない文字（SHA-256）。ルールで replayData・replayMeta の一覧は読めない
//    ようにしてあるので、他の人は置き場所を探せない（ルールは Firebase のコンソールで設定）
//  - 残すのは最新20試合。お気に入り（最大30試合）は消さない。中断した対戦は残さない
// 見る（戦績の「詳細」→「▶ 対戦を振り返る」）: このファイルの viewer
import { rtdb, ref, set, update, remove, get } from './firebase-config.js';
import { loadCardsByNo, getCardImageUrl } from './cards.js';

const KEEP = 20;        // お気に入り以外で残す試合数
const FAV_MAX = 30;     // お気に入りの上限
const MAX_FRAMES = 2500;
const CARD_BACK = 'https://drive.google.com/thumbnail?id=1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9&sz=w200';
const PENDING_KEY = 'replayPending';

// ===== 置き場所の名前（名前＋パスワードから） =====
const _ukeyCache = {};
async function ukey(name, pw) {
  const name0 = name || window.currentPlayerName || '', pw0 = pw || window.currentSessionPassword || '';
  if (!name0 || !pw0) return '';
  const k = name0 + '\n' + pw0;
  if (_ukeyCache[k]) return _ukeyCache[k];
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dtcg-replay|' + name0 + '|' + pw0));
  return (_ukeyCache[k] = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

// ===== 盤面を小さく写す =====
const cno = (c) => (c && c.cardNo ? c.cardNo : c ? '?' : null);
function cardC(c) {
  if (!c) return null;
  const o = { n: c.cardNo || '?' };
  if (typeof c.dp === 'number') o.d = c.dp;
  if (c.suspended) o.r = 1;
  if (Array.isArray(c.stack) && c.stack.length) o.s = c.stack.map(cno);
  if (Array.isArray(c.linkedCards) && c.linkedCards.length) o.l = c.linkedCards.map(cno);
  return o;
}
function sideC(s) {
  s = s || {};
  return {
    h: (s.hand || []).map(cno), dk: (s.deck || []).length, td: (s.tamaDeck || []).length, sc: (s.security || []).length,
    t: (s.trash || []).map(cno), b: (s.battleArea || []).map(cardC), tm: (s.tamerArea || []).map(cardC), ik: cardC(s.ikusei),
  };
}
// 平らにする: { 'P.h': [...], 'A.b': [...], m: 3, ... }
function flatState(bs) {
  const out = { m: bs.memory, pt: bs.isPlayerTurn ? 1 : 0, ph: bs.phase || '', op: bs._oppPhase || '' };
  const P = sideC(bs.player), A = sideC(bs.ai);
  Object.keys(P).forEach((k) => { out['P.' + k] = P[k]; });
  Object.keys(A).forEach((k) => { out['A.' + k] = A[k]; });
  return out;
}

// ===== 記録 =====
let rec = null; // { id, frames, last, logs, timer, firstAt, t0 }
function start(id) {
  rec = { id, frames: [], last: {}, logs: [], timer: null, firstAt: 0, t0: Date.now() };
  setTimeout(() => capture(['対戦開始']), 0);
}
function schedule() {
  if (!rec) return;
  if (rec.timer) {
    if (Date.now() - rec.firstAt > 1500) return; // 続けて起きても 1.5 秒以内には必ず1コマ
    clearTimeout(rec.timer);
  } else rec.firstAt = Date.now();
  rec.timer = setTimeout(() => { if (rec) { rec.timer = null; capture(); } }, 350);
}
function onLog(text) { if (!rec) return; rec.logs.push(String(text == null ? '' : text)); schedule(); }
function poke() { if (rec) schedule(); }
function capture(extra) {
  const b = window.bs;
  if (!rec || !b || !b.player || !b.ai) return;
  let flat;
  try { flat = flatState(b); } catch (e) { return; }
  const d = {};
  let changed = false;
  Object.keys(flat).forEach((k) => {
    const s = JSON.stringify(flat[k] === undefined ? null : flat[k]);
    if (rec.last[k] !== s) { rec.last[k] = s; d[k] = flat[k] === undefined ? null : flat[k]; changed = true; }
  });
  const logs = (extra || []).concat(rec.logs.splice(0)).map((x) => x.slice(0, 160)).filter(Boolean);
  const lastF = rec.frames[rec.frames.length - 1];
  if (!changed) {
    if (logs.length && lastF) lastF.L = (lastF.L || []).concat(logs).slice(-24);
    return;
  }
  if (rec.frames.length >= MAX_FRAMES) return;
  const f = { t: Date.now() - rec.t0, d };
  if (logs.length) f.L = logs.slice(-24);
  rec.frames.push(f);
}
function discard() { if (rec && rec.timer) clearTimeout(rec.timer); rec = null; }

// 決着した: 最後のコマを記録して保存
async function finish() {
  if (!rec) return;
  const r = rec;
  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
  capture();
  rec = null;
  if (r.frames.length < 2) return;
  try {
    const k = await ukey();
    if (!k) return;
    const data = await pack({ v: 1, f: r.frames });
    await saveData(k, r.id, data, r.frames.length);
  } catch (e) {
    console.warn('[振り返り] 保存できませんでした', e);
  }
}
async function saveData(k, id, data, n) {
  try {
    await set(ref(rtdb, `replayData/${k}/${id}`), data);
    await set(ref(rtdb, `replayMeta/${k}/${id}`), { at: Date.now(), fav: false, n: n || 0 });
    try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
    await prune(k);
  } catch (e) {
    // 送れなかった: 端末に置いて、次に開いたとき送り直す（大きすぎるものは諦める）
    try { if (data.length < 2500000) localStorage.setItem(PENDING_KEY, JSON.stringify({ k, id, data, n })); } catch (_) {}
    throw e;
  }
}
// 前に送れなかった記録を送る
setTimeout(async () => {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (_) {}
  if (p && p.k && p.id && p.data) { try { await saveData(p.k, p.id, p.data, p.n); } catch (_) {} }
}, 5000);

// 古いもの（お気に入り以外で最新20試合より前）を消す
async function prune(k) {
  const snap = await get(ref(rtdb, `replayMeta/${k}`));
  const all = snap.val() || {};
  const normal = Object.entries(all).filter(([, m]) => !(m && m.fav)).sort((a, b) => ((b[1] && b[1].at) || 0) - ((a[1] && a[1].at) || 0));
  const old = normal.slice(KEEP).map(([id]) => id);
  if (!old.length) return;
  const upd = {};
  old.forEach((id) => { upd[`replayData/${k}/${id}`] = null; upd[`replayMeta/${k}/${id}`] = null; });
  await update(ref(rtdb), upd);
}

// ===== 圧縮 =====
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) { const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return 'J' + json;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return 'G' + b64(await new Response(stream).arrayBuffer());
}
async function unpack(str) {
  if (!str) return null;
  if (str[0] === 'J') return JSON.parse(str.slice(1));
  const stream = new Blob([unb64(str.slice(1))]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

// ===== 戦績の画面から使うもの =====
async function listMeta() {
  const k = await ukey();
  if (!k) return {};
  const snap = await get(ref(rtdb, `replayMeta/${k}`));
  return snap.val() || {};
}
async function setFav(id, fav) {
  const k = await ukey();
  if (fav) {
    const all = await listMeta();
    const n = Object.entries(all).filter(([i, m]) => i !== id && m && m.fav).length;
    if (n >= FAV_MAX) throw new Error('お気に入りは' + FAV_MAX + '試合までです。ほかの試合のお気に入りを外してください。');
  }
  await update(ref(rtdb, `replayMeta/${k}/${id}`), { fav: !!fav });
  if (!fav) await prune(k);
}
async function del(ids) {
  const k = await ukey();
  if (!k || !ids || !ids.length) return;
  const upd = {};
  ids.forEach((id) => { upd[`replayData/${k}/${id}`] = null; upd[`replayMeta/${k}/${id}`] = null; });
  await update(ref(rtdb), upd);
}

// ===== 見る（パラパラ式） =====
const PHASE = { standby: '準備', unsuspend: 'アクティブ', draw: 'ドロー', breed: '育成', main: 'メイン', end: 'エンド' };
let V = null; // { states, frames, i, timer, speed, rec }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cardOf = (no) => (window.allCards || []).find((c) => c['カードNo'] === no);
const imgOf = (no) => { if (!no || no === '?') return CARD_BACK; const c = cardOf(no); return (c && getCardImageUrl(c)) || ''; };
const nameOf = (no) => { const c = cardOf(no); return (c && c['名前']) || no || ''; };

async function open(id, record) {
  const ov = document.createElement('div');
  ov.id = 'rp-overlay';
  ov.className = 'rp-ov';
  ov.innerHTML = '<div class="rp-loading">振り返りを読み込み中…</div>';
  document.body.appendChild(ov);
  try {
    const k = await ukey();
    const snap = await get(ref(rtdb, `replayData/${k}/${id}`));
    const data = await unpack(snap.val());
    if (!data || !Array.isArray(data.f) || !data.f.length) throw new Error('この対戦の振り返りはありません');
    // 各コマの盤面を作る（変わった所だけの記録を前から順に重ねる）。ターンは「手番が変わった回数＋1」
    const states = [];
    let cur = {}, turn = 1, lastPt = null;
    const nos = new Set();
    data.f.forEach((f) => {
      cur = Object.assign({}, cur, f.d || {});
      if (lastPt !== null && cur.pt !== lastPt) turn++;
      lastPt = cur.pt;
      states.push(Object.assign({ _turn: turn }, cur));
      Object.values(f.d || {}).forEach((v) => collectNos(v, nos));
    });
    await loadCardsByNo([...nos].filter((n) => n && n !== '?'));
    V = { states, frames: data.f, i: 0, timer: null, speed: 1, rec: record || {} };
    renderViewer();
  } catch (e) {
    ov.innerHTML = '<div class="rp-loading">振り返りを開けませんでした<br><small>' + esc(e.message) + '</small><br><button class="rp-btn" onclick="replayClose()">閉じる</button></div>';
  }
}
function collectNos(v, set0) {
  if (!v) return;
  if (typeof v === 'string') { set0.add(v); return; }
  if (Array.isArray(v)) { v.forEach((x) => collectNos(x, set0)); return; }
  if (typeof v === 'object') { if (v.n) set0.add(v.n); if (v.s) v.s.forEach((x) => set0.add(x)); if (v.l) v.l.forEach((x) => set0.add(x)); }
}

function cardHtml(c, prev, opt = {}) {
  if (!c) return '';
  const isNew = !prev || prev.n !== c.n;
  const changed = !isNew && JSON.stringify(prev) !== JSON.stringify(c);
  return '<div class="rp-card' + (c.r ? ' rest' : '') + (isNew ? ' new' : changed ? ' chg' : '') + (opt.small ? ' sm' : '') + '" onclick="replayCard(' + esc(JSON.stringify(JSON.stringify(c))) + ')">'
    + '<img src="' + esc(imgOf(c.n)) + '" alt="" loading="lazy">'
    + (typeof c.d === 'number' && c.d > 0 ? '<span class="rp-dp">' + c.d + '</span>' : '')
    + (c.s && c.s.length ? '<span class="rp-src">' + c.s.length + '</span>' : '')
    + (c.l && c.l.length ? '<span class="rp-link">🔗' + c.l.length + '</span>' : '')
    + '</div>';
}
function handHtml(list, prevList) {
  if (!list || !list.length) return '<span class="rp-none">なし</span>';
  const prevCount = {};
  (prevList || []).forEach((n) => { prevCount[n] = (prevCount[n] || 0) + 1; });
  return list.map((n) => {
    const isNew = !(prevCount[n] > 0);
    if (!isNew) prevCount[n]--;
    return '<div class="rp-card sm' + (isNew && prevList ? ' new' : '') + '" onclick="replayCard(' + esc(JSON.stringify(JSON.stringify({ n }))) + ')"><img src="' + esc(imgOf(n)) + '" alt="" loading="lazy"></div>';
  }).join('');
}
function sideHtml(st, pv, S, label, mine) {
  const g = (k) => st[S + '.' + k], gp = (k) => (pv ? pv[S + '.' + k] : undefined);
  const trash = g('t') || [];
  const zone = (title, inner, cls) => '<div class="rp-zone ' + (cls || '') + '"><div class="rp-zt">' + title + '</div><div class="rp-zc">' + inner + '</div></div>';
  const area = (k) => { const a = (g(k) || []).filter(Boolean), p = (gp(k) || []).filter(Boolean); return a.length ? a.map((c, i) => cardHtml(c, p[i])).join('') : '<span class="rp-none">なし</span>'; };
  const stats = '<div class="rp-stats">'
    + '<span title="セキュリティ">🛡 ' + (g('sc') || 0) + '</span>'
    + '<span title="デッキ">🂠 ' + (g('dk') || 0) + '</span>'
    + '<span title="デジタマデッキ">🥚 ' + (g('td') || 0) + '</span>'
    + '<span class="rp-trash" onclick="replayTrash(' + esc(JSON.stringify(S)) + ')" title="トラッシュ（押すと一覧）">🗑 ' + trash.length + (trash.length ? '<img src="' + esc(imgOf(trash[trash.length - 1])) + '" alt="">' : '') + '</span>'
    + '</div>';
  const hand = zone('手札 ' + (g('h') || []).length + '枚', handHtml(g('h'), pv ? gp('h') : null), 'rp-hand');
  const ik = zone('育成', g('ik') ? cardHtml(g('ik'), gp('ik')) : '<span class="rp-none">なし</span>', 'rp-ik');
  const field = '<div class="rp-row">' + ik + zone('バトルエリア', area('b'), 'rp-battle') + '</div>' + zone('テイマー', area('tm'), 'rp-tamer');
  return '<div class="rp-side ' + (mine ? 'me' : 'opp') + '"><div class="rp-side-head"><b>' + label + '</b>' + stats + '</div>'
    + (mine ? field + hand : hand + field) + '</div>';
}
function memHtml(m) {
  // 左＝相手側10 … 0 … 自分側10＝右
  let cells = '';
  for (let v = -10; v <= 10; v++) cells += '<i class="' + (v === m ? 'on' : '') + (v === 0 ? ' z' : '') + (v < 0 ? ' o' : v > 0 ? ' p' : '') + '"></i>';
  const txt = m > 0 ? '自分側 ' + m : m < 0 ? '相手側 ' + (-m) : '0';
  return '<div class="rp-mem"><span class="rp-mem-l">相手</span><div class="rp-mem-bar">' + cells + '</div><span class="rp-mem-l">自分</span><span class="rp-mem-t">メモリー ' + txt + '</span></div>';
}
function renderViewer() {
  const ov = document.getElementById('rp-overlay');
  if (!ov || !V) return;
  const st = V.states[V.i], pv = V.i > 0 ? V.states[V.i - 1] : null, f = V.frames[V.i];
  const r = V.rec;
  const oppName = r.mode === 'ai' ? (r.opp || 'AI') : (r.opp || '相手');
  const ph = st.pt ? PHASE[st.ph] || st.ph : PHASE[st.op] || st.op || '';
  const logs = (f.L || []);
  ov.innerHTML = '<div class="rp-wrap">'
    + '<div class="rp-top"><button class="rp-x" onclick="replayClose()">✕</button><div class="rp-title">対戦の振り返り<small>' + esc((r.myDeck || '') + ' → ' + (r.oppDeck || '')) + '</small></div>'
    + '<div class="rp-turn ' + (st.pt ? 'me' : 'opp') + '">ターン' + st._turn + '・' + (st.pt ? 'あなた' : esc(oppName)) + 'のターン' + (ph ? '・' + esc(ph) : '') + '</div></div>'
    + sideHtml(st, pv, 'A', esc(oppName), false)
    + memHtml(st.m || 0)
    + sideHtml(st, pv, 'P', 'あなた', true)
    + '<div class="rp-log">' + (logs.length ? logs.slice(-6).map((l) => '<div>' + esc(l) + '</div>').join('') : '<div class="rp-none">（このコマの記録はありません）</div>') + '</div>'
    + '<div class="rp-ctrl">'
    + '<button class="rp-btn" onclick="replayGo(0)" title="最初">⏮</button>'
    + '<button class="rp-btn" onclick="replayTurn(-1)" title="前のターン">⏪</button>'
    + '<button class="rp-btn" onclick="replayStep(-1)" title="1コマ戻る">◀</button>'
    + '<button class="rp-btn rp-play" onclick="replayPlay()">' + (V.timer ? '⏸ 停止' : '▶ 再生') + '</button>'
    + '<button class="rp-btn" onclick="replayStep(1)" title="1コマ進む">▶</button>'
    + '<button class="rp-btn" onclick="replayTurn(1)" title="次のターン">⏩</button>'
    + '<button class="rp-btn" onclick="replayGo(' + (V.states.length - 1) + ')" title="最後">⏭</button>'
    + '</div>'
    + '<div class="rp-seek"><input type="range" min="0" max="' + (V.states.length - 1) + '" value="' + V.i + '" oninput="replayGo(+this.value)"><span>' + (V.i + 1) + ' / ' + V.states.length + '</span>'
    + '<button class="rp-speed" onclick="replaySpeed()">速さ ×' + V.speed + '</button></div>'
    + '</div><div id="rp-pop" class="rp-pop" onclick="if(event.target===this)this.style.display=\'none\'"></div>';
}
function stopPlay() { if (V && V.timer) { clearInterval(V.timer); V.timer = null; } }
window.replayClose = () => { stopPlay(); V = null; const ov = document.getElementById('rp-overlay'); if (ov) ov.remove(); };
window.replayGo = (i) => { if (!V) return; V.i = Math.max(0, Math.min(V.states.length - 1, i)); renderViewer(); };
window.replayStep = (d) => { stopPlay(); window.replayGo(V.i + d); };
window.replayTurn = (d) => {
  if (!V) return; stopPlay();
  const t = V.states[V.i]._turn;
  let i = V.i;
  if (d > 0) { while (i < V.states.length - 1 && V.states[i]._turn === t) i++; }
  else { // 今のターンの最初へ。すでに最初なら前のターンの最初へ
    while (i > 0 && V.states[i - 1]._turn === t) i--;
    if (i === V.i && i > 0) { const t2 = V.states[i - 1]._turn; i--; while (i > 0 && V.states[i - 1]._turn === t2) i--; }
  }
  window.replayGo(i);
};
window.replayPlay = () => {
  if (!V) return;
  if (V.timer) { stopPlay(); renderViewer(); return; }
  if (V.i >= V.states.length - 1) V.i = 0;
  V.timer = setInterval(() => {
    if (!V) return;
    if (V.i >= V.states.length - 1) { stopPlay(); renderViewer(); return; }
    V.i++; renderViewer();
  }, 1400 / V.speed);
  renderViewer();
};
window.replaySpeed = () => {
  if (!V) return;
  V.speed = V.speed === 1 ? 2 : V.speed === 2 ? 4 : 1;
  if (V.timer) { stopPlay(); window.replayPlay(); } else renderViewer();
};
// カードを押す: 大きい画像と進化元・リンク
window.replayCard = (json) => {
  const c = JSON.parse(json);
  const pop = document.getElementById('rp-pop');
  if (!pop) return;
  const small = (list, title) => (list && list.length ? '<div class="rp-pop-t">' + title + '（' + list.length + '枚）</div><div class="rp-pop-row">' + list.map((n) => '<div class="rp-pop-mini"><img src="' + esc(imgOf(n)) + '" alt=""><span>' + esc(nameOf(n)) + '</span></div>').join('') + '</div>' : '');
  pop.innerHTML = '<div class="rp-pop-box"><img class="rp-pop-img" src="' + esc(imgOf(c.n)) + '" alt=""><div class="rp-pop-name">' + esc(nameOf(c.n)) + (typeof c.d === 'number' && c.d > 0 ? '　DP ' + c.d : '') + (c.r ? '　（レスト）' : '') + '</div>'
    + small(c.s, '進化元') + small(c.l, 'リンク') + '<button class="rp-btn" onclick="document.getElementById(\'rp-pop\').style.display=\'none\'">閉じる</button></div>';
  pop.style.display = 'flex';
};
window.replayTrash = (S) => {
  if (!V) return;
  const list = (V.states[V.i][S + '.t'] || []).slice().reverse();
  const pop = document.getElementById('rp-pop');
  if (!pop) return;
  pop.innerHTML = '<div class="rp-pop-box"><div class="rp-pop-t">' + (S === 'P' ? 'あなた' : '相手') + 'のトラッシュ（' + list.length + '枚・新しい順）</div><div class="rp-pop-row">'
    + (list.length ? list.map((n) => '<div class="rp-pop-mini"><img src="' + esc(imgOf(n)) + '" alt=""><span>' + esc(nameOf(n)) + '</span></div>').join('') : '<span class="rp-none">なし</span>')
    + '</div><button class="rp-btn" onclick="document.getElementById(\'rp-pop\').style.display=\'none\'">閉じる</button></div>';
  pop.style.display = 'flex';
};

window._replay = { start, finish, discard, listMeta, setFav, del, open, FAV_MAX, KEEP, isRecording: () => !!rec };
window._replayOnLog = onLog;
window._replayPoke = poke;
