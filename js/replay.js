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
  // 付与されている効果（DP+・キーワード等。振り返りで本番と同じバッジ・DPの増減を出す）
  if (Array.isArray(c.buffs) && c.buffs.length) o.b = c.buffs.filter(Boolean).map(prim);
  if (Array.isArray(c._grantedKw) && c._grantedKw.length) o.k = c._grantedKw.filter((x) => typeof x === 'string');
  if (Array.isArray(c._grantedRecipes) && c._grantedRecipes.length) { const g = c._grantedRecipes.filter((x) => x && x.kwFlag).map((x) => x.kwFlag); if (g.length) o.g = g; }
  return o;
}
// 付与の記録は文字・数・真偽だけ（長い文は短く）
function prim(o) {
  const r = {};
  Object.keys(o || {}).forEach((k) => { const v = o[k]; if (v === null || typeof v === 'number' || typeof v === 'boolean') r[k] = v; else if (typeof v === 'string') r[k] = v.slice(0, 40); });
  return r;
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
  rec = { id, frames: [], last: {}, logs: [], timer: null, firstAt: 0, t0: Date.now(), slv: null };
  // その対戦のスリーブ（振り返りの裏面に使う）。start は対戦の画面の準備の後に呼ばれる
  setTimeout(() => { if (rec && rec.id === id) rec.slv = window._sleeves || null; }, 0);
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
// 出来事（効果の発動・デッキオープン・アタック・バトル等）: いまの盤面を記録してから、出来事だけのコマを1つ足す
// （振り返りで出来事ごとに1コマずつ見せる。盤面はその直前と同じ）
let _lastOpen = { key: '', at: 0 };
function onEvent(ev) {
  if (!rec || !ev) return;
  if (ev.k === 'open') { // AI対戦の CPU は同じデッキオープンが2つの経路から届くので1つにする
    const key = (ev.w || '') + (ev.ns || []).join(',');
    if (key === _lastOpen.key && Date.now() - _lastOpen.at < 5000) return;
    _lastOpen = { key, at: Date.now() };
  }
  if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
  capture();
  if (rec.frames.length >= MAX_FRAMES) return;
  Object.keys(ev).forEach((k) => { if (typeof ev[k] === 'string') ev[k] = ev[k].slice(0, 120); });
  rec.frames.push({ t: Date.now() - rec.t0, d: {}, E: [ev] });
}
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
// デッキオープンしたカードの実際の行き先（effect-engine.js のデッキオープンの処理・相手のデッキオープンの受け取りから）。
// 直前のデッキオープンの出来事に書き込む（以前は後の盤面から推測していて、同じターンに同じカードで育成エリアのデジモンを
// 進化させると「育成エリアへ」と出ていた。レッド・メモリーブースト!! P-035）
const DEST_LABEL = { hand: '手札へ', trash: 'トラッシュへ', deck_top: 'デッキの上へ', deck_bottom: 'デッキの下へ', play: '登場', evolve: '進化' };
function onOpenDest(cardNo, to) {
  if (!rec || !cardNo) return;
  for (let j = rec.frames.length - 1; j >= Math.max(0, rec.frames.length - 80); j--) {
    const ev = (rec.frames[j].E || []).find((x) => x.k === 'open');
    if (!ev) continue;
    ev.dest = ev.dest || [];
    const k = (ev.ns || []).findIndex((n, i) => n === cardNo && !ev.dest[i]);
    if (k >= 0) ev.dest[k] = DEST_LABEL[to] || String(to || '');
    return;
  }
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
    const data = await pack({ v: 1, f: r.frames, slv: r.slv || null });
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

// ===== 見る（本番のバトル画面に記録した盤面を流し込む。演出の動きは無く、出来事は盤面の上の表示で見せる） =====
// 出来事（記録のとき E に入れたもの）:
//  eff  効果の発動（帯＋発動したカードを光らせる） / open デッキオープン（めくったカードと行き先） / atk アタック（矢印）
//  vs   セキュリティチェック・バトル（アタックしたカード VS 相手のカード） / direct ダイレクトアタック / rev 相手が手札に加えたカード
//  ブロックはログ（「〜でブロック！」）から見つけて、矢印をブロックしたデジモンへ向け直す
// 登場・進化（新しく出たカード）は黄色、DP・レスト・付与が変わったカードは水色に光らせる
const PHASE = { standby: '準備', unsuspend: 'アクティブ', draw: 'ドロー', breed: '育成', main: 'メイン', end: 'エンド' };
let V = null; // { states, frames, i, timer, speed, rec, scr, guard }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cardOf = (no) => (window.allCards || []).find((c) => c['カードNo'] === no);
const imgOf = (no) => { if (!no || no === '?') return CARD_BACK; const c = cardOf(no); return (c && getCardImageUrl(c)) || ''; };
const nameOf = (no) => { const c = cardOf(no); return (c && c['名前']) || no || ''; };
const noByName = (name) => { const c = (window.allCards || []).find((x) => x['名前'] === name); return c ? c['カードNo'] : ''; };

function collectNos(v, set0) {
  if (!v) return;
  if (typeof v === 'string') { set0.add(v); return; }
  if (Array.isArray(v)) { v.forEach((x) => collectNos(x, set0)); return; }
  if (typeof v === 'object') { ['n', 'a', 'd'].forEach((k) => { if (typeof v[k] === 'string') set0.add(v[k]); }); ['s', 'l', 'ns'].forEach((k) => { if (Array.isArray(v[k])) v[k].forEach((x) => set0.add(x)); }); }
}

async function open(id, record) {
  if (window._aiBattleActive || (typeof window._isOnlineMode === 'function' && window._isOnlineMode())) { alert('対戦中は振り返りを開けません'); return; }
  const ld = document.createElement('div');
  ld.id = 'rp-loading';
  ld.className = 'rp-loading-ov';
  ld.innerHTML = '<div>振り返りを読み込み中…</div>';
  document.body.appendChild(ld);
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
      // カードの所だけ見る（メモリー・手番・フェイズの値をカードNoと間違えて読みに行っていた）
      Object.entries(f.d || {}).forEach(([k, v]) => { if (k.indexOf('.') > 0) collectNos(v, nos); });
      (f.E || []).forEach((e) => collectNos(e, nos));
    });
    await loadCardsByNo([...nos].filter((n) => n && n !== '?'));
    // 名前しか届いていない出来事（オンラインの相手の効果）のカードも読む
    V = { states, frames: data.f, i: 0, timer: null, speed: 1, rec: record || {} };
    window._sleeves = data.slv || {}; // 記録した対戦のスリーブで裏面を描く
    enter();
    show(0);
  } catch (e) {
    alert('振り返りを開けませんでした: ' + e.message);
  } finally {
    ld.remove();
  }
}

// ----- 本番のバトル画面を振り返り用にする -----
function enter() {
  const scr = document.getElementById('battle-screen');
  if (!scr) throw new Error('バトル画面がありません');
  V.scr = scr;
  window._replayViewing = true;
  // 前の対戦の表示が残っていれば消す（「相手が手札に加えた（タップで詳細）」の小さい札など）
  ['_remote-reveal-chip'].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
  scr.classList.add('rp-mode');
  const r = V.rec;
  scr.classList.toggle('side-p2', r.mode === 'online' && !r.first);
  const oppLabel = document.getElementById('opponent-name-label');
  if (oppLabel) oppLabel.innerHTML = r.mode === 'ai' && typeof window._aiIconHtml === 'function' ? window._aiIconHtml(18, r.aiLevel) + ' ' + esc(r.opp || 'AI') : '🎮 ' + esc(r.opp || '相手');
  const myLabel = document.getElementById('my-name-label');
  if (myLabel) myLabel.innerText = window.currentPlayerName || 'あなた';
  // 相手の手札（表向き）
  const oppInfo = scr.querySelector('.opp-info-row');
  const strip = document.createElement('div');
  strip.id = 'rp-opphand';
  if (oppInfo && oppInfo.parentNode) oppInfo.parentNode.insertBefore(strip, oppInfo.nextSibling); else scr.prepend(strip);
  // 自分の手札: 本番の手札の場所は操作バーに隠れるので、相手と同じ小さい並びにしてフェイズの帯の上（右寄せ）に置く
  const myStrip = document.createElement('div');
  myStrip.id = 'rp-myhand';
  const phaseBar = scr.querySelector('.phase-bar');
  if (phaseBar && phaseBar.parentNode) phaseBar.parentNode.insertBefore(myStrip, phaseBar); else scr.appendChild(myStrip);
  // 矢印・出来事・操作バー・カードの詳細
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.id = 'rp-arrow';
  document.body.appendChild(arrow);
  const ev = document.createElement('div'); ev.id = 'rp-ev'; document.body.appendChild(ev);
  const bar = document.createElement('div'); bar.id = 'rp-bar'; document.body.appendChild(bar);
  // そのコマで起きたこと（ログ）は、盤面の真ん中の表示（効果の発動・デッキオープン等と同じ所）に出す
  const pop = document.createElement('div'); pop.id = 'rp-pop'; pop.className = 'rp-pop'; pop.onclick = (e) => { if (e.target === pop) pop.style.display = 'none'; }; document.body.appendChild(pop);
  // 盤面を押しても操作は動かさない。カードを押したら詳細だけ出す
  V.guard = (e) => {
    if (!window._replayViewing) return;
    const t0 = e.target;
    // 振り返り用に足した手札の並び（相手・自分）は、そのまま押せるようにする（ここで止めると画像の onclick に届かず、
    // 押しても大きい画像が出なかった）
    if (t0 && t0.closest && t0.closest('#rp-opphand, #rp-myhand')) return;
    e.stopPropagation();
    if (e.type !== 'click') return;
    e.preventDefault();
    const c = cardFromEl(e.target);
    if (c) cardDetail(c);
  };
  ['click', 'pointerdown', 'mousedown', 'touchstart', 'contextmenu', 'dblclick'].forEach((tp) => scr.addEventListener(tp, V.guard, true));
  // カーソルを当てたカードを横のパネルに大きく出す（広い画面だけ）
  V.hover = (e) => {
    if (!V || !isWide()) return;
    if (e.target && e.target.closest && e.target.closest('#rp-side')) return; // パネルの中（読んでいる途中）では切り替えない
    const c = cardFromEl(e.target);
    if (c && JSON.stringify(c) !== V.sideKey) { V.sideKey = JSON.stringify(c); renderSide(c); }
  };
  document.addEventListener('mouseover', V.hover);
  // 横のパネル（広い画面）
  const side = document.createElement('div'); side.id = 'rp-side'; document.body.appendChild(side);
  // パネルの中の進化元を押したら、そのカードの詳細へ
  side.onclick = (e) => { const t = e.target.closest && e.target.closest('[data-rp-no]'); if (t) renderSide({ n: t.dataset.rpNo }); };
  renderSide(null);
  window.addEventListener('resize', onResize);
  if (typeof window.showScreen === 'function') window.showScreen('battle-screen');
  document.body.classList.toggle('rp-wide', isWide());
}
function onResize() { if (V) { document.body.classList.toggle('rp-wide', isWide()); fitBoard(); drawEvents(); } }
// 広い画面（横にカードの詳細のパネルを置ける幅）
const isWide = () => window.innerWidth >= 900;
// 要素 → そのカードの記録（盤面・手札の並び・出来事の表示）
function cardFromEl(t) {
  if (!V || !t || !t.closest) return null;
  const st = V.states[V.i];
  const tagged = t.closest('[data-rp-no]');
  if (tagged) return { n: tagged.dataset.rpNo };
  const hand = t.closest('#battle-screen .h-card');
  if (hand) { const i = [...hand.parentNode.children].filter((x) => x.classList.contains('h-card')).indexOf(hand); const n = (st['P.h'] || [])[i]; return n ? { n } : null; }
  // 育成エリア（カードNoの印が無いことがある）
  const iku = t.closest('#pl-iku-slot, #ai-iku-slot');
  if (iku) { const c = st[iku.id === 'ai-iku-slot' ? 'A.ik' : 'P.ik']; return c || null; }
  const el = t.closest('#battle-screen [data-card-no]');
  if (!el || !el.dataset.cardNo) return null;
  const S = el.closest('#ai-battle-row, #ai-tamer-row, #ai-iku-slot') ? 'A' : 'P';
  // 並びの何番目か（同じカードが2体いても、それぞれの進化元・DPを出す）
  const row = el.closest('#ai-battle-row, #pl-battle-row, #ai-tamer-row, #pl-tamer-row');
  if (row) {
    const idx = [...row.children].indexOf(el.closest('#' + row.id + ' > *'));
    const list = st[S + (row.id.indexOf('tamer') >= 0 ? '.tm' : '.b')] || [];
    if (list[idx] && list[idx].n === el.dataset.cardNo) return list[idx];
  }
  const found = [...(st[S + '.b'] || []), ...(st[S + '.tm'] || []), st[S + '.ik']].find((c) => c && c.n === el.dataset.cardNo);
  return found || { n: el.dataset.cardNo };
}
// 押したカードの詳細: 広い画面は横のパネル、狭い画面は大きい画像
function cardDetail(c) { if (isWide()) { V.sideKey = JSON.stringify(c); renderSide(c); } else popCard(c); }
// 横のパネル: 大きい画像・DP・付与・進化元・効果の文
// 真ん中の表示（出来事・ログ）を盤面の中に収める（はみ出していた）。大きすぎるときは中をスクロール
function fitEvBox(box) {
  const wrap = V && V.scr && V.scr.querySelector('.battle-wrap');
  const bar = document.getElementById('rp-bar');
  const wr = wrap ? wrap.getBoundingClientRect() : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
  const minX = Math.max(4, wr.left + 4), maxX = Math.min(window.innerWidth - 4, wr.right - 4);
  const minY = Math.max(4, wr.top + 4), maxY = Math.min(window.innerHeight - (bar ? bar.offsetHeight : 0) - 4, wr.bottom - 4);
  box.style.transform = 'none';
  box.style.maxWidth = Math.max(160, maxX - minX) + 'px';
  box.style.maxHeight = Math.max(120, maxY - minY) + 'px';
  box.style.overflowY = 'auto';
  const r = box.getBoundingClientRect();
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  box.style.left = Math.min(Math.max(minX, cx - r.width / 2), Math.max(minX, maxX - r.width)) + 'px';
  box.style.top = Math.min(Math.max(minY, cy - r.height / 2), Math.max(minY, maxY - r.height)) + 'px';
}
function renderSide(c) {
  const el = document.getElementById('rp-side');
  if (!el) return;
  if (!c || !c.n || c.n === '?') { el.innerHTML = '<div class="rp-side-empty">盤面や手札のカードに<br>カーソルを当てる（タップする）と<br>ここに大きく表示されます</div>'; return; }
  const cd = cardOf(c.n) || {};
  const txt = (k) => String(cd[k] || '').trim();
  const kws = [...(c.k || []), ...(c.g || [])];
  const buffs = (c.b || []).map((b) => (b.type === 'dp_plus' ? 'DP+' + b.value : b.type === 'dp_minus' ? 'DP-' + b.value : b.type || '')).filter(Boolean);
  const meta = [cd['タイプ'], cd['色'], cd['レベル'] || cd['Lv'] ? 'Lv.' + (cd['レベル'] || cd['Lv']) : '', cd['特徴']].filter(Boolean).join('・');
  const sec = (title, body) => (body ? '<div class="rp-side-h">' + title + '</div><div class="rp-side-txt">' + esc(body) + '</div>' : '');
  el.innerHTML = '<img class="rp-side-img" src="' + esc(imgOf(c.n)) + '" alt="">'
    + '<div class="rp-side-name">' + esc(nameOf(c.n)) + '<small>' + esc(c.n) + '</small></div>'
    + (meta ? '<div class="rp-side-meta">' + esc(meta) + '</div>' : '')
    + (typeof c.d === 'number' && c.d > 0 ? '<div class="rp-side-dp">DP ' + c.d + (c.r ? '　（レスト）' : '') + '</div>' : (c.r ? '<div class="rp-side-dp">（レスト）</div>' : ''))
    + (buffs.length || kws.length ? '<div class="rp-pop-buffs">' + [...buffs, ...kws].map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' : '')
    + '<div class="rp-side-body">'
    + (c.s && c.s.length ? '<div class="rp-side-h">進化元（' + c.s.length + '枚）</div><div class="rp-side-src">' + c.s.map((n) => '<img data-rp-no="' + esc(n) + '" src="' + esc(imgOf(n)) + '" alt="" title="' + esc(nameOf(n)) + '">').join('') + '</div>' : '')
    + sec('効果', txt('効果テキスト'))
    + sec('進化元効果', txt('進化元テキスト'))
    + sec('セキュリティ効果', txt('セキュリティテキスト'))
    + '</div>';
}
// 盤面が画面（操作バーの上まで）に収まるよう縮める（スクロールしないと自分の手札が見えなかった）
function fitBoard() {
  if (!V || !V.scr) return;
  const wrap = V.scr.querySelector('.battle-wrap');
  const bar = document.getElementById('rp-bar');
  if (!wrap) return;
  wrap.style.transform = ''; wrap.style.marginBottom = ''; wrap.style.position = ''; wrap.style.left = ''; wrap.style.top = '';
  const availH = window.innerHeight - (bar ? bar.offsetHeight : 0) - 6;
  const side = document.getElementById('rp-side'), ev = document.getElementById('rp-ev');
  if (isWide()) {
    // 盤面（幅を詰めたもの）を拡大し、そのすぐ右にカードの詳細のパネルを上から並べる。2つを1組にして画面の真ん中に置く
    const SIDE_W = 340, GAP = 12;
    const natW = wrap.offsetWidth, natH = wrap.scrollHeight;
    if (!natW || !natH) return;
    const k = Math.min((window.innerWidth - SIDE_W - GAP - 24) / natW, availH / natH, 2.2);
    const boardW = natW * k, total = boardW + GAP + SIDE_W;
    const left = Math.max(8, (window.innerWidth - total) / 2);
    wrap.style.position = 'absolute';
    wrap.style.top = '0';
    wrap.style.left = left + 'px';
    wrap.style.transformOrigin = 'top left';
    wrap.style.transform = 'scale(' + k.toFixed(4) + ')';
    if (side) { side.style.left = (left + boardW + GAP) + 'px'; side.style.top = '8px'; side.style.width = SIDE_W + 'px'; side.style.height = (Math.min(natH * k, availH) - 8) + 'px'; }
    if (ev) ev.style.left = (left + boardW / 2) + 'px';
    if (bar) { bar.style.left = left + 'px'; bar.style.width = total + 'px'; }
    return;
  }
  if (ev) ev.style.left = '';
  if (bar) { bar.style.left = ''; bar.style.width = ''; }
  const natural = wrap.scrollHeight;
  if (natural > availH && availH > 100) {
    const k = availH / natural;
    wrap.style.transformOrigin = 'top center';
    wrap.style.transform = 'scale(' + k.toFixed(4) + ')';
    wrap.style.marginBottom = (-(natural - availH)) + 'px';
  }
}
function leave() {
  stopPlay();
  if (V && V.scr) {
    ['click', 'pointerdown', 'mousedown', 'touchstart', 'contextmenu', 'dblclick'].forEach((tp) => V.scr.removeEventListener(tp, V.guard, true));
    V.scr.classList.remove('rp-mode');
  }
  window.removeEventListener('resize', onResize);
  if (V && V.hover) document.removeEventListener('mouseover', V.hover);
  document.body.classList.remove('rp-wide');
  const _wrap = V && V.scr && V.scr.querySelector('.battle-wrap');
  if (_wrap) { _wrap.style.transform = ''; _wrap.style.transformOrigin = ''; _wrap.style.marginBottom = ''; _wrap.style.position = ''; _wrap.style.left = ''; _wrap.style.top = ''; }
  ['rp-opphand', 'rp-myhand', 'rp-arrow', 'rp-ev', 'rp-bar', 'rp-pop', 'rp-logbox', 'rp-side'].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
  window._replayViewing = false;
  window._sleeves = {};
  if (window.bs) window.bs._battleAborted = true;
  V = null;
  if (typeof window.showScreen === 'function') window.showScreen('records-screen');
}

// ----- 記録した盤面 → 本番の盤面のデータ -----
const _baseCache = {};
function baseCard(no) {
  if (!_baseCache[no]) {
    let c = null;
    try { const cd = cardOf(no); c = window.parseDeck({ list: ((cd && cd['名前']) || no) + '(' + no + ')x1' })[0]; } catch (_) {}
    _baseCache[no] = c || { cardNo: no, name: nameOf(no), dp: 0, level: '', type: '' };
  }
  return _baseCache[no];
}
function mk(c) {
  if (!c) return null;
  if (typeof c === 'string') c = { n: c };
  if (!c.n || c.n === '?') return { cardNo: '', name: '', dp: 0, stack: [], buffs: [] };
  const b = Object.assign({}, baseCard(c.n));
  b.stack = (c.s || []).map((n) => mk(n));
  b.linkedCards = (c.l || []).map((n) => mk(n));
  if (typeof c.d === 'number') b.dp = c.d;
  b.suspended = !!c.r;
  b.buffs = (c.b || []).map((x) => Object.assign({}, x));
  b._grantedKw = (c.k || []).slice();
  b._grantedRecipes = (c.g || []).map((f) => ({ kwFlag: f }));
  return b;
}
const dummies = (n) => Array.from({ length: Math.max(0, n || 0) }, () => ({ cardNo: '', name: '' }));
function sideOf(st, S) {
  const g = (k) => st[S + '.' + k];
  return {
    hand: (g('h') || []).map((n) => mk(n)), deck: dummies(g('dk')), tamaDeck: dummies(g('td')), security: dummies(g('sc')),
    trash: (g('t') || []).map((n) => mk(n)), battleArea: (g('b') || []).map(mk), tamerArea: (g('tm') || []).map(mk),
    ikusei: mk(g('ik')), linkedCards: [],
  };
}

function show(i) {
  if (!V) return;
  V.i = Math.max(0, Math.min(V.states.length - 1, i));
  const st = V.states[V.i], pv = V.i > 0 ? V.states[V.i - 1] : null;
  const B = window.bs;
  // 振り返り中は対戦の進行を止めておく（メモリーが相手側のコマで「ターン終了の判定」が動き、AIのターンが始まっていた）
  B._battleAborted = true;
  B._turnPassed = false; B._autoTurnEnding = false; B._endingTurn = false; B._pendingTurnEnd = false;
  B.memory = st.m || 0; B.isPlayerTurn = !!st.pt; B.phase = st.ph || 'main'; B._oppPhase = st.op || null; B.turn = st._turn;
  B.selHand = null; B.selSlot = null; B.attackingSlot = null;
  B.player = sideOf(st, 'P'); B.ai = sideOf(st, 'A');
  try { (window.renderAll || (() => {}))(true); } catch (e) { console.warn('[振り返り] 盤面を描けませんでした', e); }
  markChanges(st, pv);
  renderOppHand(st, pv);
  renderBar();
  fitBoard();
  drawEvents();
}

// 新しく出たカード（黄）・変わったカード（水色）
function markChanges(st, pv) {
  const rows = [['pl-battle-row', 'P.b'], ['ai-battle-row', 'A.b'], ['pl-tamer-row', 'P.tm'], ['ai-tamer-row', 'A.tm']];
  rows.forEach(([id, key]) => {
    const row = document.getElementById(id);
    if (!row || !pv) return;
    const a = st[key] || [], p = pv[key] || [];
    [...row.children].forEach((el, i) => {
      const c = a[i], q = p[i];
      if (!c) return;
      if (!q || q.n !== c.n) el.classList.add('rp-new');
      else if (JSON.stringify(q) !== JSON.stringify(c)) el.classList.add('rp-chg');
    });
  });
  [['pl-iku-slot', 'P.ik'], ['ai-iku-slot', 'A.ik']].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el || !pv) return;
    const c = st[key], q = pv[key];
    if (c && (!q || q.n !== c.n)) el.classList.add('rp-new');
    else if (c && JSON.stringify(q) !== JSON.stringify(c)) el.classList.add('rp-chg');
  });
}
function renderOppHand(st, pv) {
  handStrip('rp-opphand', 'A.h', '相手の手札', '・振り返りだけ表向き', st, pv);
  handStrip('rp-myhand', 'P.h', 'あなたの手札', '', st, pv);
}
function handStrip(id, key, title, note, st, pv) {
  const el = document.getElementById(id);
  if (!el) return;
  const list = st[key] || [];
  const prev = {};
  (pv ? pv[key] || [] : list).forEach((n) => { prev[n] = (prev[n] || 0) + 1; });
  el.innerHTML = '<span class="rp-oh-t">' + title + '（' + list.length + '枚' + note + '）</span><div class="rp-oh-row">'
    + (list.length ? list.map((n) => { const isNew = !(prev[n] > 0); if (!isNew) prev[n]--; return '<img class="' + (isNew ? 'rp-new' : '') + '" data-rp-no="' + esc(n) + '" src="' + esc(imgOf(n)) + '" alt="" onclick="replayPopNo(' + esc(JSON.stringify(n)) + ')">'; }).join('') : '<span class="rp-none">なし</span>')
    + '</div>';
}

// ----- 出来事 -----
function lastAttack(i) {
  for (let j = i; j >= Math.max(0, i - 12); j--) { const e = (V.frames[j].E || []).find((x) => x.k === 'atk'); if (e) return { e, j }; }
  return null;
}
// デッキオープンしたカードの行き先（この後のコマで、どこに増えたか）
function openDest(i, ev) {
  const base = V.states[i];
  const own = ev.w === 'A' ? 'A' : 'P', oth = own === 'A' ? 'P' : 'A';
  const zones = [
    [own, 'h', '手札へ'], [own, 't', 'トラッシュへ'], [own, 'b', '登場'], [own, 'bs', '進化元へ'], [own, 'tm', '登場'], [own, 'ik', '育成エリアへ'],
    [oth, 'h', '相手の手札へ'], [oth, 't', '相手のトラッシュへ'], [oth, 'b', '相手の場へ'], [oth, 'bs', '相手の進化元へ'],
  ];
  const cnt = (st, S, z, no) => {
    const g = (k) => st[S + '.' + k];
    if (z === 'h' || z === 't') return (g(z) || []).filter((x) => x === no).length;
    if (z === 'b' || z === 'tm') return (g(z) || []).filter((c) => c && c.n === no).length;
    if (z === 'ik') return g('ik') && g('ik').n === no ? 1 : 0;
    if (z === 'bs') return (g('b') || []).reduce((s, c) => s + ((c && c.s) || []).filter((x) => x === no).length, 0);
    return 0;
  };
  const used = {};
  let end = Math.min(V.states.length - 1, i + 30);
  for (let j = i + 1; j <= end; j++) { if ((V.frames[j].E || []).some((x) => x.k === 'open') || V.states[j]._turn !== base._turn) { end = j - 1; break; } }
  // （行き先を記録していない古い振り返りだけ）めくったカードが最初に動いてから3秒の間だけを見る（その後の進化などを行き先と取り違えないように）
  const anyMoved = (j) => (ev.ns || []).some((no) => zones.some(([S, z]) => cnt(V.states[j], S, z, no) > cnt(base, S, z, no)));
  for (let j = i + 1; j <= end; j++) {
    if (anyMoved(j)) { const t0 = V.frames[j].t || 0; let e2 = j; while (e2 + 1 <= end && (V.frames[e2 + 1].t || 0) - t0 <= 3000) e2++; end = e2; break; }
  }
  return (ev.ns || []).map((no) => {
    for (let j = i + 1; j <= end; j++) {
      for (const [S, z, label] of zones) {
        const key = S + z + no;
        if (cnt(V.states[j], S, z, no) - cnt(base, S, z, no) > (used[key] || 0)) { used[key] = (used[key] || 0) + 1; return label; }
      }
    }
    const secUp = (V.states[end] ? (V.states[end][own + '.sc'] || 0) : 0) > (base[own + '.sc'] || 0);
    return secUp ? 'セキュリティへ？' : 'デッキに戻す';
  });
}
function slotEl(S, idx) {
  const row = document.getElementById((S === 'P' ? 'pl' : 'ai') + '-battle-row');
  return row && idx != null && idx >= 0 ? row.children[idx] : null;
}
function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 }; }
function drawArrow(svg, a, b, color, label) {
  const id = 'rpah' + color.replace('#', '');
  svg.innerHTML += '<defs><marker id="' + id + '" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="' + color + '"/></marker></defs>'
    + '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + color + '" stroke-width="4" stroke-linecap="round" marker-end="url(#' + id + ')" opacity="0.9"/>'
    + (label ? '<text x="' + ((a.x + b.x) / 2 + 8) + '" y="' + ((a.y + b.y) / 2) + '" fill="#fff" font-size="13" font-weight="bold" stroke="#000" stroke-width="3" paint-order="stroke">' + esc(label) + '</text>' : '');
}
function drawEvents() {
  if (!V) return;
  const svg = document.getElementById('rp-arrow'), box = document.getElementById('rp-ev');
  if (!svg || !box) return;
  svg.innerHTML = '';
  svg.setAttribute('width', window.innerWidth); svg.setAttribute('height', window.innerHeight);
  const f = V.frames[V.i], st = V.states[V.i];
  const evs = f.E || [];
  const who = (w) => (w === 'A' ? (V.rec.mode === 'ai' ? (V.rec.opp || 'AI') : (V.rec.opp || '相手')) : 'あなた');
  const panels = [];
  // アタックの矢印（このコマ、または少し前のアタックの続き）。ブロックしたらブロックしたデジモンへ
  const la = evs.find((x) => x.k === 'atk') ? { e: evs.find((x) => x.k === 'atk'), j: V.i } : lastAttack(V.i);
  const blkLog = (f.L || []).find((l) => /でブロック/.test(l));
  if (la && (la.j === V.i || blkLog || evs.some((x) => x.k === 'vs'))) {
    const e = la.e, defS = e.w === 'A' ? 'P' : 'A';
    const from = slotEl(e.w, e.i);
    let to = null, label = '';
    if (blkLog) {
      const m = blkLog.match(/「([^」]+)」でブロック/);
      const bi = m ? (st[defS + '.b'] || []).findIndex((c) => c && nameOf(c.n) === m[1]) : -1;
      to = slotEl(defS, bi); label = '🛡 ブロック！';
    }
    if (!to) to = e.t === 'sec' ? document.getElementById((defS === 'P' ? 'pl' : 'ai') + '-sec-area') : slotEl(defS, e.t);
    if (from && to) { const a = centerOf(from), b = centerOf(to); if (a.ok && b.ok) drawArrow(svg, a, b, e.w === 'P' ? '#00fbff' : '#ff3d6e', label || (e.t === 'sec' ? 'アタック → プレイヤー' : 'アタック')); }
    if (from) from.classList.add('rp-atk');
  }
  evs.forEach((e) => {
    if (e.k === 'eff') {
      const no = e.n || noByName(e.nm);
      panels.push('<div class="rp-ev-eff ' + (e.w === 'A' ? 'opp' : 'me') + '">' + (no ? '<img src="' + esc(imgOf(no)) + '" alt="">' : '') + '<div><div class="rp-ev-t">⚡ ' + esc(who(e.w)) + '「' + esc(e.nm || nameOf(no)) + '」の効果</div>' + (e.x ? '<div class="rp-ev-x">' + esc(e.x) + '</div>' : '') + '</div></div>');
      // 発動したカードを光らせる
      document.querySelectorAll('#battle-screen [data-card-no="' + (no || '').replace(/"/g, '') + '"]').forEach((el) => el.classList.add('rp-eff'));
    } else if (e.k === 'open') {
      const dest = Array.isArray(e.dest) ? (e.ns || []).map((n, k) => e.dest[k] || 'デッキに戻す') : openDest(V.i, e);
      panels.push('<div class="rp-ev-open"><div class="rp-ev-t">📖 ' + esc(who(e.w)) + 'のデッキオープン（' + (e.ns || []).length + '枚）</div><div class="rp-ev-cards">'
        + (e.ns || []).map((n, k) => '<div class="rp-ev-c" data-rp-no="' + esc(n) + '" onclick="replayPopNo(' + esc(JSON.stringify(n)) + ')"><img src="' + esc(imgOf(n)) + '" alt=""><span class="rp-dest ' + (/手札|登場|進化|育成/.test(dest[k]) ? 'go' : 'out') + '">' + esc(dest[k]) + '</span></div>').join('') + '</div></div>');
    } else if (e.k === 'vs') {
      panels.push('<div class="rp-ev-vs"><div class="rp-ev-t">' + esc(e.lb || (e.bt ? '⚔ バトル' : '🛡 セキュリティチェック')) + '</div><div class="rp-ev-vsrow">'
        + '<div class="rp-ev-c"><img src="' + esc(imgOf(e.a || noByName(e.an))) + '" alt=""><span>' + esc(e.an || nameOf(e.a)) + (e.ad != null ? '<br>DP ' + e.ad : '') + '</span></div>'
        + '<b class="rp-vs">VS</b>'
        + '<div class="rp-ev-c"><img src="' + esc(imgOf(e.d || noByName(e.dn))) + '" alt=""><span>' + esc(e.dn || nameOf(e.d)) + (e.dd != null ? '<br>DP ' + e.dd : '') + '</span></div></div></div>');
    } else if (e.k === 'kw') {
      const no = e.n || noByName(e.nm);
      panels.push('<div class="rp-ev-eff">' + (no ? '<img src="' + esc(imgOf(no)) + '" alt="">' : '') + '<div><div class="rp-ev-t">✨ キーワード付与</div><div class="rp-ev-x">「' + esc(e.nm || nameOf(no)) + '」に【' + esc(e.kw) + '】</div></div></div>');
      document.querySelectorAll('#battle-screen [data-card-no="' + (no || '').replace(/"/g, '') + '"]').forEach((el) => el.classList.add('rp-eff'));
    } else if (e.k === 'direct') {
      panels.push('<div class="rp-ev-direct">💥 ' + esc(who(e.w)) + 'のダイレクトアタック！</div>');
    } else if (e.k === 'rev') {
      panels.push('<div class="rp-ev-open"><div class="rp-ev-t">📥 ' + esc(who(e.w)) + 'が手札に加えたカード</div><div class="rp-ev-cards">' + (e.ns || []).map((n) => '<div class="rp-ev-c"><img src="' + esc(imgOf(n)) + '" alt=""></div>').join('') + '</div></div>');
    } else if (e.k === 'atk' && !blkLog) {
      const c = (st[e.w + '.b'] || [])[e.i];
      panels.push('<div class="rp-ev-atk ' + (e.w === 'A' ? 'opp' : 'me') + '">⚔ ' + esc(who(e.w)) + 'の「' + esc(c ? nameOf(c.n) : '') + '」がアタック' + (e.t === 'sec' ? '（プレイヤーへ）' : '') + '</div>');
    }
  });
  if (blkLog) panels.push('<div class="rp-ev-atk">' + esc(blkLog.replace(/^[^「]*/, '🛡 ')) + '</div>');
  // このコマで起きたこと（ログ）: 出来事の表示の下に。アタック・進化・登場・効果の解決など、何が起きたかを1か所で見せる
  const logs = (f.L || []).filter((l) => l && !/描画完了|^\[|^🧠|^🃏 手札:/.test(l));
  if (logs.length) panels.push('<div class="rp-ev-log">' + logs.slice(-5).map((l) => '<div>' + esc(l) + '</div>').join('') + '</div>');
  box.innerHTML = panels.join('');
  box.style.display = panels.length ? 'flex' : 'none';
  if (panels.length) fitEvBox(box);
}

// ----- 操作バー -----
function renderBar() {
  const bar = document.getElementById('rp-bar');
  if (!bar || !V) return;
  const st = V.states[V.i], f = V.frames[V.i], r = V.rec;
  const oppName = r.mode === 'ai' ? (r.opp || 'AI') : (r.opp || '相手');
  const ph = st.pt ? PHASE[st.ph] || st.ph : PHASE[st.op] || st.op || '';
  bar.innerHTML = '<div class="rp-bar-top"><span class="rp-turn ' + (st.pt ? 'me' : 'opp') + '">ターン' + st._turn + '・' + (st.pt ? 'あなた' : esc(oppName)) + 'のターン' + (ph ? '・' + esc(ph) : '') + '</span>'
    + '<span class="rp-cnt">' + (V.i + 1) + ' / ' + V.states.length + '</span><button class="rp-close" onclick="replayClose()">✕ 閉じる</button></div>'
    + '<div class="rp-ctrl">'
    + '<button class="rp-btn" onclick="replayGo(0)" title="最初">⏮</button>'
    + '<button class="rp-btn" onclick="replayTurn(-1)" title="前のターン">⏪</button>'
    + '<button class="rp-btn" onclick="replayStep(-1)" title="1コマ戻る">◀</button>'
    + '<button class="rp-btn rp-play" onclick="replayPlay()">' + (V.timer ? '⏸ 停止' : '▶ 再生') + '</button>'
    + '<button class="rp-btn" onclick="replayStep(1)" title="1コマ進む">▶</button>'
    + '<button class="rp-btn" onclick="replayTurn(1)" title="次のターン">⏩</button>'
    + '<button class="rp-btn" onclick="replayGo(' + (V.states.length - 1) + ')" title="最後">⏭</button>'
    + '<button class="rp-speed" onclick="replaySpeed()">×' + V.speed + '</button>'
    + '</div>'
    + '<input class="rp-range" type="range" min="0" max="' + (V.states.length - 1) + '" value="' + V.i + '" oninput="replayGo(+this.value)">';
}
function stopPlay() { if (V && V.timer) { clearInterval(V.timer); V.timer = null; } }
window.replayClose = () => leave();
window.replayGo = (i) => { if (V) show(i); };
window.replayStep = (d) => { if (!V) return; stopPlay(); show(V.i + d); };
window.replayTurn = (d) => {
  if (!V) return; stopPlay();
  const t = V.states[V.i]._turn;
  let i = V.i;
  if (d > 0) { while (i < V.states.length - 1 && V.states[i]._turn === t) i++; }
  else { // 今のターンの最初へ。すでに最初なら前のターンの最初へ
    while (i > 0 && V.states[i - 1]._turn === t) i--;
    if (i === V.i && i > 0) { const t2 = V.states[i - 1]._turn; i--; while (i > 0 && V.states[i - 1]._turn === t2) i--; }
  }
  show(i);
};
window.replayPlay = () => {
  if (!V) return;
  if (V.timer) { stopPlay(); renderBar(); return; }
  if (V.i >= V.states.length - 1) V.i = 0;
  // 出来事のあるコマ（デッキオープン・バトル等）は少し長く見せる
  const tick = () => {
    if (!V || !V.timer) return;
    if (V.i >= V.states.length - 1) { stopPlay(); renderBar(); return; }
    show(V.i + 1);
    const hasEv = (V.frames[V.i].E || []).length > 0;
    V.timer = setTimeout(tick, (hasEv ? 2600 : 1300) / V.speed);
  };
  V.timer = setTimeout(tick, 300);
  renderBar();
};
window.replaySpeed = () => { if (!V) return; V.speed = V.speed === 1 ? 2 : V.speed === 2 ? 4 : 1; renderBar(); };
// カードの詳細（大きい画像・進化元・リンク）
function popCard(c) {
  const pop = document.getElementById('rp-pop');
  if (!pop || !c) return;
  const small = (list, title) => (list && list.length ? '<div class="rp-pop-t">' + title + '（' + list.length + '枚）</div><div class="rp-pop-row">' + list.map((n) => '<div class="rp-pop-mini"><img src="' + esc(imgOf(n)) + '" alt=""><span>' + esc(nameOf(n)) + '</span></div>').join('') + '</div>' : '');
  const kws = [...(c.k || []), ...(c.g || [])];
  const buffs = (c.b || []).map((b) => (b.type === 'dp_plus' ? 'DP+' + b.value : b.type === 'dp_minus' ? 'DP-' + b.value : b.type || '')).filter(Boolean);
  pop.innerHTML = '<div class="rp-pop-box"><img class="rp-pop-img" src="' + esc(imgOf(c.n)) + '" alt=""><div class="rp-pop-name">' + esc(nameOf(c.n)) + (typeof c.d === 'number' && c.d > 0 ? '　DP ' + c.d : '') + (c.r ? '　（レスト）' : '') + '</div>'
    + (buffs.length || kws.length ? '<div class="rp-pop-t">付与されている効果</div><div class="rp-pop-buffs">' + [...buffs, ...kws].map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' : '')
    + small(c.s, '進化元') + small(c.l, 'リンク') + '<button class="rp-btn" onclick="document.getElementById(\'rp-pop\').style.display=\'none\'">閉じる</button></div>';
  pop.style.display = 'flex';
}
window.replayPopNo = (no) => cardDetail({ n: no });

window._replay = { start, finish, discard, listMeta, setFav, del, open, FAV_MAX, KEEP, isRecording: () => !!rec };
window._replayOnLog = onLog;
window._replayPoke = poke;
window._replayOpenDest = (cardNo, to) => { try { onOpenDest(cardNo, to); } catch (_) {} };
window._replayEvent = (ev) => { try { onEvent(ev); } catch (e) { console.warn('[振り返り] 出来事を記録できませんでした', e); } };
