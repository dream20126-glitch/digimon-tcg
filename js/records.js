// 戦績の画面（pages/records.html）。4つのタブ:
//  - オンライン: 勝率・勝率の移り変わり・相手ごと・相手のデッキの色ごと・決着の理由 → 対戦の一覧
//  - AI: 勝率・AIのレベルごと・勝率の移り変わり・AIのデッキごと・決着の理由 → 対戦の一覧
//  - デッキごと: 自分のデッキごとの勝率 → 選んだデッキの「相手のデッキごと」「相手のデッキの色ごと」の勝ち負け・先攻/後攻
// 勝率は「勝ち ÷（勝ち＋負け）」。中断は数に出すが勝率には入れない（「中断を表示」を切ると数にも出さない）。
//  - 対戦の一覧: オンライン・AI の全対戦（日付・勝敗・相手の1行）。「詳細」で詳しい情報・メモ・削除。一覧からも削除できる
// 読み込み: 前回読んだ記録を端末に覚えておき、開いたらすぐ出す → 裏で最新を読み直して差し替える
// 記録は js/match-record.js が付ける（GAS のシート「戦績」）
import { gasGet, gasPost } from './firebase-config.js';
import { getGoogleDriveDirectLink } from './cards.js';

const AI_LV = { low: { name: '見習いテイマー', short: '低' }, mid: { name: 'ベテランテイマー', short: '中' }, high: { name: 'デジモンマスター', short: '高' } };
const AI_ORDER = ['low', 'mid', 'high'];
// カードの色（デッキの色の印）
const CARD_COLORS = { 赤: '#ff4d4d', 青: '#3d8bff', 黄: '#ffd400', 緑: '#21c55d', 黒: '#1b1b1b', 紫: '#a855f7', 白: '#f2f2f2' };
const PERIODS = [['all', '全期間'], ['month', '今月'], ['30', '直近30日'], ['7', '直近7日']];
const REASONS = ['ダイレクトアタック', 'デッキ切れ', '投了', 'その他'];

let records = [];
let loaded = false;
let loading = false;
let refreshing = false;
let mergeOpen = false;
let resetting = false;

// 開いていたタブ・絞り込み（この端末に覚える）
const PREF_KEY = 'recPrefs';
const prefs = Object.assign({ tab: 'online', period: 'all', showAbort: true, onlineDeck: '', aiLevel: '', aiDeck: '', deckMode: 'all', deckSel: '' },
  { listMode: 'all', listDeck: '' },
  (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (_) { return {}; } })());
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) {} }

const cacheKey = () => 'recCache:' + (window.currentPlayerName || '');
function saveCache() { try { localStorage.setItem(cacheKey(), JSON.stringify(records)); } catch (_) {} }
function loadCache() { try { const a = JSON.parse(localStorage.getItem(cacheKey()) || 'null'); return Array.isArray(a) ? a : null; } catch (_) { return null; } }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsArg = (v) => esc(JSON.stringify(v));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (t) => { if (!t) return '—'; const d = new Date(t); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtShort = (t) => { if (!t) return '—'; const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : m + '分' + pad(s % 60) + '秒'; };
const lvName = (lv) => (AI_LV[lv] ? AI_LV[lv].name : (lv || '—'));
const resKey = (r) => (r.result === '勝ち' ? 'win' : r.result === '負け' ? 'lose' : 'abort');

function stats(list) {
  const w = list.filter((r) => r.result === '勝ち').length;
  const l = list.filter((r) => r.result === '負け').length;
  const a = list.length - w - l;
  return { n: list.length, w, l, a, rate: w + l ? w / (w + l) : null };
}
const pct = (rate) => (rate == null ? '—' : Math.round(rate * 100) + '%');

// 期間・中断の表示で絞る（全タブ共通）
function base(list) {
  let out = list;
  if (prefs.period !== 'all') {
    const now = new Date();
    const from = prefs.period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : Date.now() - Number(prefs.period) * 86400000;
    out = out.filter((r) => (r.startedAt || 0) >= from);
  }
  if (!prefs.showAbort) out = out.filter((r) => r.result !== '中断');
  return out;
}

// ===== デッキの見た目（表紙カード・色の印） =====
function colorDots(colors) {
  const cs = String(colors || '').split('/').filter(Boolean);
  if (!cs.length) return '';
  return '<span class="rec-cols" title="' + esc(cs.join('/')) + '">' + cs.map((c) => '<i style="background:' + (CARD_COLORS[c] || '#888') + '"></i>').join('') + '</span>';
}
function thumb(cover) {
  const u = cover ? getGoogleDriveDirectLink(cover) : '';
  return u ? '<img class="rec-thumb" src="' + esc(u) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="rec-thumb rec-thumb-ph">🃏</span>';
}
// デッキ名 → 表紙（マイデッキ・おすすめデッキ（AI用）の表紙）。表紙を記録する前の対戦や、記録に表紙が無い対戦の表示に使う
const deckCovers = { my: {}, ai: {} };
let coversLoaded = false;
async function loadDeckCovers() {
  if (coversLoaded) return;
  coversLoaded = true;
  try {
    const [mine, ai] = await Promise.all([
      gasGet('getDecks', { pw: window.currentSessionPassword || '' }).catch(() => []),
      gasGet('getSampleDecks', { forAi: '1' }).catch(() => []),
    ]);
    (Array.isArray(mine) ? mine : []).forEach((d) => { if (d && d.name && d.cover) deckCovers.my[d.name] = d.cover; });
    (Array.isArray(ai) ? ai : []).forEach((d) => { const n = d && (d.deckName || d.name); if (n && d.cover) deckCovers.ai[n] = d.cover; });
    if (loaded) render();
  } catch (e) { console.warn('[戦績] デッキの表紙を読めませんでした', e); }
}
// デッキ名 → 最後に記録した表紙・色（記録ごとに付いているので、いちばん新しいものを使う）。表紙が無ければマイデッキ等の表紙
function deckInfo(side, name) {
  const r = records.find((x) => (side === 'my' ? x.myDeck : x.oppDeck) === name && (side === 'my' ? (x.myCover || x.myColors) : (x.oppCover || x.oppColors)));
  const inf = r ? { cover: side === 'my' ? r.myCover : r.oppCover, colors: side === 'my' ? r.myColors : r.oppColors } : { cover: '', colors: '' };
  if (!inf.cover) inf.cover = side === 'my' ? (deckCovers.my[name] || '') : (deckCovers.ai[name] || deckCovers.my[name] || '');
  return inf;
}
function deckLabel(side, name, opt = {}) {
  const inf = deckInfo(side, name);
  return '<span class="rec-deck' + (opt.small ? ' sm' : '') + '">' + thumb(inf.cover) + '<span class="rec-deck-name">' + esc(name || '（名前なし）') + '</span>' + colorDots(inf.colors) + '</span>';
}
// AIのアイコン（ベテラン・マスターは顔のアイコン、見習いは絵文字。ai-battle.js の _aiIconHtml）
const aiIcon = (lv, size) => (typeof window._aiIconHtml === 'function' ? window._aiIconHtml(size || 20, lv) : '🤖');
const aiLabel = (lv, size) => '<span class="rec-ai">' + aiIcon(lv, size) + '<span>' + esc(lvName(lv)) + '</span></span>';

// ===== 部品 =====
// 勝率のドーナツ（勝ち・負け・中断の割合）。真ん中に勝率
function donut(s) {
  const R = 42, C = 2 * Math.PI * R, total = s.n || 1;
  const segs = [['win', s.w], ['lose', s.l], ['abort', s.a]].filter(([, v]) => v > 0);
  let off = 0;
  const gap = segs.length > 1 ? 2 : 0;
  const arcs = segs.map(([k, v]) => {
    const len = Math.max(0, (v / total) * C - gap);
    const el = '<circle class="rec-arc rec-c-' + k + '" r="' + R + '" cx="50" cy="50" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '"></circle>';
    off += (v / total) * C;
    return el;
  }).join('');
  return '<svg class="rec-donut" viewBox="0 0 100 100" aria-hidden="true"><circle class="rec-arc-bg" r="' + R + '" cx="50" cy="50"></circle><g transform="rotate(-90 50 50)">' + arcs + '</g>'
    + '<text x="50" y="49" class="rec-donut-val">' + pct(s.rate) + '</text><text x="50" y="64" class="rec-donut-lbl">勝率</text></svg>';
}

// 勝ち・負け・中断の横棒（行の合計＝100%）
function stackBar(s, label) {
  if (!s.n) return '<div class="rec-bar rec-bar-empty"></div>';
  const seg = (k, v, name) => v > 0 ? '<span class="rec-seg rec-c-' + k + '" style="flex:' + v + '" data-tip="' + esc((label ? label + '\n' : '') + name + ' ' + v + '回（' + Math.round(v / s.n * 100) + '%）') + '"></span>' : '';
  return '<div class="rec-bar">' + seg('win', s.w, '勝ち') + seg('lose', s.l, '負け') + seg('abort', s.a, '中断') + '</div>';
}
const wl = (s) => '<span class="rec-w">' + s.w + '勝</span> <span class="rec-l">' + s.l + '敗</span>' + (s.a ? ' <span class="rec-a">中断' + s.a + '</span>' : '');

function legend() {
  return '<div class="rec-legend"><span><i class="rec-c-win"></i>勝ち</span><span><i class="rec-c-lose"></i>負け</span>' + (prefs.showAbort ? '<span><i class="rec-c-abort"></i>中断</span>' : '') + '</div>';
}

// いちばん上の成績（ドーナツ＋数字のタイル）
function summary(list) {
  const s = stats(list);
  const f = stats(list.filter((r) => r.first)), b = stats(list.filter((r) => !r.first));
  const done = list.filter((r) => r.result !== '中断');
  const avgT = done.length ? (done.reduce((x, r) => x + (r.turns || 0), 0) / done.length) : 0;
  const avgD = done.length ? (done.reduce((x, r) => x + (r.durationSec || 0), 0) / done.length) : 0;
  // 今の連勝・連敗（中断は飛ばす）
  let streak = 0, kind = '';
  for (const r of done) { if (!kind) { kind = r.result; streak = 1; } else if (r.result === kind) streak++; else break; }
  return '<div class="rec-summary">'
    + '<div class="rec-hero">' + donut(s) + '<div class="rec-hero-txt"><div class="rec-hero-n">' + s.n + '<small>戦</small></div><div>' + wl(s) + '</div>'
    + (streak >= 2 ? '<div class="rec-streak ' + (kind === '勝ち' ? 'win' : 'lose') + '">' + (kind === '勝ち' ? '🔥 ' + streak + '連勝中' : streak + '連敗中') + '</div>' : '') + '</div></div>'
    + '<div class="rec-tiles">'
    + tile('先攻の勝率', pct(f.rate), f.n + '戦 ' + f.w + '勝' + f.l + '敗')
    + tile('後攻の勝率', pct(b.rate), b.n + '戦 ' + b.w + '勝' + b.l + '敗')
    + tile('平均ターン数', done.length ? avgT.toFixed(1) : '—', '決着した対戦')
    + tile('平均対戦時間', done.length ? fmtDur(avgD) : '—', '決着した対戦')
    + '</div></div>';
}
const tile = (lbl, val, sub) => '<div class="rec-tile"><div class="rec-tile-lbl">' + lbl + '</div><div class="rec-tile-val">' + val + '</div><div class="rec-tile-sub">' + esc(sub) + '</div></div>';

// 直近20戦（左が古い・右が新しい）
function recent(list) {
  const last = list.slice(0, 20).reverse();
  if (!last.length) return '';
  const cell = (r) => {
    const ch = r.result === '勝ち' ? '勝' : r.result === '負け' ? '負' : '中';
    const tip = fmtDate(r.startedAt) + '\n' + (r.mode === 'ai' ? lvName(r.aiLevel) : 'vs ' + r.opp) + '\n' + r.myDeck + ' → ' + r.oppDeck + '\n' + r.result + (r.result === '中断' ? '' : '（' + r.reason + '）');
    return '<span class="rec-dot rec-c-' + resKey(r) + '" data-tip="' + esc(tip) + '">' + ch + '</span>';
  };
  return section('直近' + last.length + '戦の流れ', '<div class="rec-strip">' + last.map(cell).join('') + '</div><div class="rec-strip-axis"><span>古い</span><span>新しい →</span></div>');
}

// 勝率の移り変わり（決着した対戦を古い順に並べ、それぞれの時点の「直近10戦の勝率」を線で結ぶ）
function trend(list) {
  const done = list.filter((r) => r.result !== '中断').slice().reverse();
  if (done.length < 3) return section('勝率の移り変わり', '<div class="rec-empty-sm">決着した対戦が3戦以上になると表示します</div>');
  const N = 10;
  const pts = done.map((r, i) => {
    const win = done.slice(Math.max(0, i - N + 1), i + 1);
    const w = win.filter((x) => x.result === '勝ち').length;
    return { r, i, rate: w / win.length, n: win.length };
  });
  const W = 600, H = 170, L = 40, Rr = 10, T = 10, B = 24;
  const x = (i) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - Rr));
  const y = (v) => T + (1 - v) * (H - T - B);
  const grid = [0, 0.5, 1].map((v) => '<line class="rec-tr-grid' + (v === 0.5 ? ' mid' : '') + '" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) + '" y2="' + y(v) + '"></line><text class="rec-tr-ax" x="' + (L - 6) + '" y="' + (y(v) + 5) + '" text-anchor="end">' + (v * 100) + '%</text>').join('');
  const line = '<polyline class="rec-tr-line" points="' + pts.map((p) => x(p.i).toFixed(1) + ',' + y(p.rate).toFixed(1)).join(' ') + '"></polyline>';
  const last = pts[pts.length - 1];
  const lastDot = '<circle class="rec-tr-last" cx="' + x(last.i) + '" cy="' + y(last.rate) + '" r="4.5"></circle>';
  // 当たり判定（点より広い縦の帯）
  const bw = (W - L - Rr) / Math.max(1, pts.length - 1);
  const hits = pts.map((p) => '<rect class="rec-tr-hit" x="' + (x(p.i) - bw / 2) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" data-tip="' + esc(fmtDate(p.r.startedAt) + '（' + (p.i + 1) + '戦目）\n直近' + p.n + '戦の勝率 ' + Math.round(p.rate * 100) + '%\nこの対戦: ' + p.r.result) + '"></rect>').join('');
  const xl = '<text class="rec-tr-ax" x="' + L + '" y="' + (H - 6) + '">' + esc(fmtShort(done[0].startedAt)) + '</text><text class="rec-tr-ax" x="' + (W - Rr) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(fmtShort(last.r.startedAt)) + '</text>';
  return section('勝率の移り変わり <small>（直近10戦の勝率・いまは ' + Math.round(last.rate * 100) + '%）</small>',
    '<svg class="rec-trend" viewBox="0 0 ' + W + ' ' + H + '">' + grid + line + lastDot + xl + hits + '</svg>');
}

// 名前ごとの棒の表（相手ごと・レベルごと・デッキごと等）。g.html があれば名前の所に使う
function groupRows(groups, opt = {}) {
  if (!groups.length) return '<div class="rec-empty-sm">まだ記録がありません</div>';
  return '<div class="rec-rows">' + groups.map((g) => {
    const s = stats(g.list);
    return '<div class="rec-row' + (opt.onclick ? ' rec-row-btn' + (opt.sel === g.key ? ' sel' : '') : '') + '"' + (opt.onclick ? ' onclick="' + opt.onclick + '(' + jsArg(g.key) + ')"' : '') + '>'
      + '<div class="rec-row-name" title="' + esc(g.label) + '">' + (g.html || esc(g.label)) + '</div>'
      + '<div class="rec-row-bar">' + stackBar(s, g.label) + '</div>'
      + '<div class="rec-row-num">' + wl(s) + '</div>'
      + '<div class="rec-row-rate">' + pct(s.rate) + '</div></div>';
  }).join('') + '</div>';
}
function groupBy(list, keyFn, labelFn) {
  const m = new Map();
  list.forEach((r) => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].map(([key, l]) => ({ key, label: labelFn ? labelFn(key) : (key || '（名前なし）'), list: l })).sort((a, b) => b.list.length - a.list.length);
}
// 相手のデッキの色ごと（色が記録されていない対戦は「色の記録なし」）
function oppColorGroups(list) {
  return groupBy(list, (r) => r.oppColors || '', (k) => k || '色の記録なし').map((g) => Object.assign(g, { html: (g.key ? colorDots(g.key) + ' ' : '') + esc(g.label) }));
}

// 決着の理由（勝った理由・負けた理由）
function reasons(list) {
  const done = list.filter((r) => r.result !== '中断');
  if (!done.length) return '<div class="rec-empty-sm">まだ決着した対戦がありません</div>';
  const rows = REASONS.map((k) => {
    const w = done.filter((r) => r.result === '勝ち' && (REASONS.includes(r.reason) ? r.reason : 'その他') === k).length;
    const l = done.filter((r) => r.result === '負け' && (REASONS.includes(r.reason) ? r.reason : 'その他') === k).length;
    return { k, w, l };
  }).filter((x) => x.w || x.l);
  const max = Math.max(1, ...rows.map((x) => Math.max(x.w, x.l)));
  return '<table class="rec-reason"><thead><tr><th>決着の理由</th><th>勝ち</th><th>負け</th></tr></thead><tbody>' + rows.map((x) =>
    '<tr><td>' + esc(x.k) + '</td>'
    + '<td><div class="rec-hbar"><span class="rec-c-win" style="width:' + (x.w / max * 100) + '%" data-tip="' + esc(x.k + 'で勝ち ' + x.w + '回') + '"></span><b>' + x.w + '</b></div></td>'
    + '<td><div class="rec-hbar"><span class="rec-c-lose" style="width:' + (x.l / max * 100) + '%" data-tip="' + esc(x.k + 'で負け ' + x.l + '回') + '"></span><b>' + x.l + '</b></div></td></tr>').join('') + '</tbody></table>';
}

const section = (title, body, extra) => '<div class="rec-sec"><div class="rec-sec-head"><div class="rec-sec-title">' + title + '</div>' + (extra || '') + '</div>' + body + '</div>';
const resultBadge = (r) => '<span class="rec-badge rec-c-' + resKey(r) + '">' + esc(r.result) + '</span>';
const secText = (r) => (r.mySec == null && r.oppSec == null ? '—' : (r.mySec ?? '?') + ' - ' + (r.oppSec ?? '?'));

// 対戦の一覧: 1試合1行で「日付・勝敗・相手」だけ（横にスクロールしない）。「詳細」で詳しい情報・メモ・削除。
// 一覧の「削除」は押し間違えないよう、赤い枠の別のボタンにして「詳細」から離して置く（押すと確認が出る）
const oppOf = (r) => (r.mode === 'ai' ? '🤖 ' + lvName(r.aiLevel) : '🌐 ' + (r.opp || '相手'));
const oppHtml = (r) => (r.mode === 'ai' ? aiLabel(r.aiLevel, 20) : esc('🌐 ' + (r.opp || '相手')));
function history(list) {
  if (!list.length) return '<div class="rec-empty-sm">まだ記録がありません</div>';
  return '<div class="rec-hist">' + list.map((r) => '<div class="rec-hr rec-hr-' + resKey(r) + '">'
    + '<span class="rec-hr-date">' + fmtShort(r.startedAt) + '</span>'
    + resultBadge(r)
    + '<span class="rec-hr-opp">' + oppHtml(r) + (r.memo ? '<span class="rec-hr-memo" title="メモあり">📝</span>' : '') + '</span>'
    + '<button class="rec-hr-detail" onclick="recOpen(' + jsArg(r.id) + ')">詳細</button>'
    + '<button class="rec-hr-del" title="この記録を削除" onclick="recDelete(' + jsArg(r.id) + ')">削除</button>'
    + '</div>').join('') + '</div>';
}

function deckSelect(list, cur, fn) {
  const names = [...new Set(list.map((r) => r.myDeck).filter(Boolean))].sort();
  return '<select class="rec-select" onchange="' + fn + '(this.value)"><option value="">自分のデッキ: すべて</option>'
    + names.map((n) => '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>';
}
function chips(items, cur, fn) {
  // items: [値, 名前, 前に付けるアイコンのHTML（任意）]
  return '<div class="rec-chips">' + items.map(([v, l, icon]) => '<button class="rec-chip' + (v === cur ? ' sel' : '') + '" onclick="' + fn + '(' + jsArg(v) + ')">' + (icon ? '<span class="rec-chip-ic">' + icon + '</span>' : '') + esc(l) + '</button>').join('') + '</div>';
}

// ===== リセット =====
const _resetArgs = [];
function resetBtn(label, mode, myDeck, n) {
  _resetArgs.push({ label, mode, myDeck, n });
  return '<div class="rec-reset"><button class="rec-reset-btn" onclick="recReset(' + (_resetArgs.length - 1) + ')">🗑 ' + esc(label) + '</button>'
    + '<div class="rec-reset-sub">' + n + '件の記録を消します（期間・中断の表示に関わらず）。元に戻せません。</div></div>';
}
window.recReset = async function(i) {
  const a = _resetArgs[i];
  if (!a || resetting) return;
  if (!confirm(a.label + '\n\n' + a.n + '件の記録を消します。消した記録は元に戻せません。\nリセットしますか？')) return;
  resetting = true;
  try {
    const r = await gasPost('deleteMatchRecords', { playerName: window.currentPlayerName || '', password: window.currentSessionPassword || '', mode: a.mode, myDeck: a.myDeck });
    if (!r || r.status !== 'OK') throw new Error((r && r.message) || '不明なエラー');
    records = records.filter((x) => !((!a.mode || x.mode === a.mode) && (!a.myDeck || x.myDeck === a.myDeck)));
    if (a.myDeck && prefs.deckSel === a.myDeck) prefs.deckSel = '';
    saveCache(); savePrefs(); render();
    alert('リセットしました（' + (r.deleted || 0) + '件）');
  } catch (e) {
    alert('リセットできませんでした: ' + e.message);
  } finally {
    resetting = false;
  }
};

// ===== 各タブ =====
function renderOnline() {
  const allRaw = records.filter((r) => r.mode === 'online');
  if (!allRaw.length) return emptyTab('オンライン対戦の記録はまだありません', 'オンライン対戦をすると、ここに勝ち負けが記録されます。');
  const all = base(allRaw);
  const list = prefs.onlineDeck ? all.filter((r) => r.myDeck === prefs.onlineDeck) : all;
  return '<div class="rec-filter">' + deckSelect(allRaw, prefs.onlineDeck, 'recOnlineDeck') + '</div>'
    + (list.length ? summary(list)
      + recent(list)
      + trend(list)
      + section('相手ごと', groupRows(groupBy(list, (r) => r.opp)), legend())
      + section('相手のデッキの色ごと', groupRows(oppColorGroups(list)))
      + section('決着の理由', reasons(list))
      + listLink(list.length, 'online')
      : emptyTab('この条件の記録はありません', '期間や絞り込みを変えてみてください。'))
    + resetBtn('オンライン対戦の戦績をすべてリセット', 'online', '', allRaw.length);
}

function renderAi() {
  const allRaw = records.filter((r) => r.mode === 'ai');
  if (!allRaw.length) return emptyTab('AI対戦の記録はまだありません', 'AI対戦をすると、ここに勝ち負けが記録されます。');
  const all = base(allRaw);
  let list = prefs.aiDeck ? all.filter((r) => r.myDeck === prefs.aiDeck) : all;
  const byLv = AI_ORDER.map((lv) => ({ key: lv, label: lvName(lv), html: aiLabel(lv, 24), list: list.filter((r) => r.aiLevel === lv) })).filter((g) => g.list.length);
  if (prefs.aiLevel) list = list.filter((r) => r.aiLevel === prefs.aiLevel);
  const aiDecks = groupBy(list, (r) => r.oppDeck).map((g) => Object.assign(g, { html: deckLabel('opp', g.key) }));
  return '<div class="rec-filter">' + chips([['', 'すべて'], ...AI_ORDER.map((lv) => [lv, AI_LV[lv].name, aiIcon(lv, 18)])], prefs.aiLevel, 'recAiLevel') + deckSelect(allRaw, prefs.aiDeck, 'recAiDeck') + '</div>'
    + (list.length ? summary(list)
      + section('AIのレベルごと <small>（押すとそのレベルだけ）</small>', groupRows(byLv, { onclick: 'recAiLevel', sel: prefs.aiLevel }), legend())
      + recent(list)
      + trend(list)
      + section('AIのデッキごと', groupRows(aiDecks))
      + section('決着の理由', reasons(list))
      + listLink(list.length, 'ai')
      : emptyTab('この条件の記録はありません', '期間や絞り込みを変えてみてください。'))
    + resetBtn('AI対戦の戦績をすべてリセット', 'ai', '', allRaw.length);
}

function renderDeck() {
  const allRaw = prefs.deckMode === 'all' ? records : records.filter((r) => r.mode === prefs.deckMode);
  const all = base(allRaw);
  const modeChips = chips([['all', 'すべて'], ['online', '🌐 オンライン'], ['ai', '🤖 AI']], prefs.deckMode, 'recDeckMode');
  if (!all.length) return '<div class="rec-filter">' + modeChips + '</div>' + emptyTab('この条件の記録はありません', '対戦をすると、デッキごとの成績がここに出ます。');
  const decks = groupBy(all, (r) => r.myDeck).map((g) => Object.assign(g, { html: deckLabel('my', g.key) }));
  if (!prefs.deckSel || !decks.some((d) => d.key === prefs.deckSel)) prefs.deckSel = decks[0].key;
  const sel = prefs.deckSel;
  const mine = all.filter((r) => r.myDeck === sel);
  const s = stats(mine);
  const fs = stats(mine.filter((r) => r.first)), bs2 = stats(mine.filter((r) => !r.first));
  const inf = deckInfo('my', sel);
  // 相手のデッキごと
  const opps = groupBy(mine, (r) => r.oppDeck);
  const fb = (l, first) => { const x = l.filter((r) => r.first === first); const t = stats(x); return x.length ? x.length + '回 <small>(' + t.w + '勝' + t.l + '敗)</small>' : '0回'; };
  const matchRows = opps.map((g) => {
    const t = stats(g.list);
    return '<tr><td class="rec-mu-name">' + deckLabel('opp', g.key) + '</td>'
      + '<td class="r">' + t.n + '</td><td class="r rec-w">' + t.w + '</td><td class="r rec-l">' + t.l + '</td>'
      + '<td class="rec-mu-bar">' + stackBar(t, 'vs ' + g.label) + '<span class="rec-mu-rate">' + pct(t.rate) + '</span></td>'
      + '<td class="nw">' + fb(g.list, true) + '</td><td class="nw">' + fb(g.list, false) + '</td></tr>';
  }).join('');
  // スマホ: 相手のデッキごとをカードで
  const matchCards = opps.map((g) => {
    const t = stats(g.list);
    return '<div class="rec-mc"><div class="rec-mc-top">' + deckLabel('opp', g.key) + '<span class="rec-mc-rate">' + pct(t.rate) + '</span></div>'
      + stackBar(t, 'vs ' + g.label)
      + '<div class="rec-mc-facts"><span>' + t.n + '戦 ' + wl(t) + '</span><span>先攻 ' + fb(g.list, true) + '</span><span>後攻 ' + fb(g.list, false) + '</span></div></div>';
  }).join('');
  const others = [...new Set(records.map((r) => r.myDeck).filter((n) => n && n !== sel))].sort();
  const merge = mergeOpen
    ? '<div class="rec-merge"><div class="rec-merge-t">「' + esc(sel) + '」の記録を、別の名前にまとめます（名前を変えたデッキの記録を1つにするとき）</div>'
      + '<div class="rec-merge-row"><select id="rec-merge-to" class="rec-select">' + others.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('') + '<option value="__new__">（新しい名前を入力する）</option></select>'
      + '<button class="rec-chip sel" onclick="recMergeDo()">まとめる</button><button class="rec-chip" onclick="recMergeToggle()">やめる</button></div></div>'
    : '';
  return '<div class="rec-filter">' + modeChips + '</div>'
    + section('自分のデッキごと <small>（押すと相手のデッキごとの成績を表示）</small>', groupRows(decks, { onclick: 'recDeckSel', sel }), legend())
    + '<div class="rec-sec rec-deck-detail">'
    + '<div class="rec-deck-head">' + thumb(inf.cover) + '<div class="rec-deck-head-txt"><div class="rec-deck-title">' + esc(sel || '（名前なし）') + ' ' + colorDots(inf.colors) + '</div>'
    + '<div class="rec-deck-sum">' + s.n + '戦 ' + wl(s) + '　勝率 <b>' + pct(s.rate) + '</b></div>'
    + '<div class="rec-deck-sum2">先攻 ' + fs.n + '回（' + pct(fs.rate) + '）・後攻 ' + bs2.n + '回（' + pct(bs2.rate) + '）</div></div>'
    + '<button class="rec-mini-btn" onclick="recMergeToggle()">✏ 名前をまとめる</button></div>'
    + merge
    + '<div class="rec-sec-title" style="margin-top:14px;">相手のデッキごと</div>'
    + '<div class="rec-table-wrap rec-hist-table"><table class="rec-table rec-mu"><thead><tr><th>相手のデッキ</th><th class="r">対戦</th><th class="r">勝</th><th class="r">敗</th><th>勝率</th><th>先攻</th><th>後攻</th></tr></thead><tbody>' + matchRows + '</tbody></table></div>'
    + '<div class="rec-hist-cards">' + matchCards + '</div>'
    + '<div class="rec-sec-title" style="margin-top:14px;">相手のデッキの色ごと</div>'
    + groupRows(oppColorGroups(mine))
    + '</div>'
    + listLink(mine.length, prefs.deckMode, sel)
    + resetBtn('「' + (sel || '（名前なし）') + '」の' + (prefs.deckMode === 'online' ? 'オンライン対戦の' : prefs.deckMode === 'ai' ? 'AI対戦の' : '') + '戦績をリセット', prefs.deckMode === 'all' ? '' : prefs.deckMode, sel, allRaw.filter((r) => r.myDeck === sel).length);
}

// 各タブの下: 「対戦の一覧」タブへ（そのタブの種類・デッキで絞った状態で開く）
function listLink(n, mode, deck) {
  return '<button class="rec-list-link" onclick="recGoList(' + jsArg(mode || 'all') + ',' + jsArg(deck || '') + ')">📋 この対戦の一覧を見る（' + n + '件） →</button>';
}
window.recGoList = (mode, deck) => { prefs.listMode = mode; prefs.listDeck = deck; prefs.tab = 'list'; savePrefs(); render(); window.scrollTo(0, 0); };

function renderList() {
  const allRaw = records;
  if (!allRaw.length) return emptyTab('記録はまだありません', 'オンライン対戦・AI対戦をすると、ここに1試合ずつ並びます。');
  let list = base(allRaw);
  if (prefs.listMode !== 'all') list = list.filter((r) => r.mode === prefs.listMode);
  const deckPool = prefs.listMode === 'all' ? allRaw : allRaw.filter((r) => r.mode === prefs.listMode);
  if (prefs.listDeck) list = list.filter((r) => r.myDeck === prefs.listDeck);
  return '<div class="rec-filter">' + chips([['all', 'すべて'], ['online', '🌐 オンライン'], ['ai', '🤖 AI']], prefs.listMode, 'recListMode')
    + deckSelect(deckPool, prefs.listDeck, 'recListDeck') + '</div>'
    + section('対戦の一覧（' + list.length + '件）<small>　「詳細」で詳しい情報・メモ</small>', history(list));
}

const emptyTab = (t, sub) => '<div class="rec-empty"><div class="rec-empty-icon">📭</div><div>' + t + '</div><div class="rec-empty-sub">' + sub + '</div></div>';

// 期間・中断の表示（全タブ共通）
function commonFilter() {
  return '<div class="rec-common">' + chips(PERIODS, prefs.period, 'recPeriod')
    + '<label class="rec-toggle"><input type="checkbox"' + (prefs.showAbort ? ' checked' : '') + ' onchange="recShowAbort(this.checked)"> 中断を表示</label></div>';
}

function render() {
  document.querySelectorAll('#records-screen .rec-tab').forEach((b) => b.classList.toggle('sel', b.dataset.tab === prefs.tab));
  const st = document.getElementById('rec-status');
  if (st) st.textContent = refreshing ? '最新の記録を読み込み中…' : '';
  const body = document.getElementById('rec-body');
  if (!body) return;
  _resetArgs.length = 0;
  if (!loaded) { body.innerHTML = '<div class="rec-empty">' + (loading ? '読み込み中...' : '') + '</div>'; return; }
  body.innerHTML = commonFilter() + (prefs.tab === 'ai' ? renderAi() : prefs.tab === 'deck' ? renderDeck() : prefs.tab === 'list' ? renderList() : renderOnline());
}

// ===== 1試合の詳しい情報とメモ =====
window.recOpen = function(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  closeModal();
  const m = document.createElement('div');
  m.id = 'rec-modal';
  m.className = 'rec-modal';
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  const row = (k, v) => '<div class="rec-md-row"><span>' + k + '</span><b>' + v + '</b></div>';
  m.innerHTML = '<div class="rec-md">'
    + '<div class="rec-md-title">対戦の詳細</div>'
    + '<div class="rec-md-head">' + resultBadge(r) + '<span>' + fmtDate(r.startedAt) + '</span><button class="rec-md-x" onclick="recCloseModal()">✕</button></div>'
    + '<div class="rec-md-decks">' + deckLabel('my', r.myDeck) + '<span class="rec-hc-vs">→</span>' + deckLabel('opp', r.oppDeck) + '</div>'
    + row(r.mode === 'ai' ? 'AIのレベル' : '相手', r.mode === 'ai' ? aiLabel(r.aiLevel, 22) : esc(r.opp))
    + row('先攻/後攻', r.first ? '先攻' : '後攻')
    + row('決着の理由', esc(r.result === '中断' ? '—' : r.reason))
    + row('ターン数', r.turns ? r.turns + 'ターン' : '—')
    + row('対戦時間', r.durationSec ? fmtDur(r.durationSec) : '—')
    + row('決着時のセキュリティ', secText(r) === '—' ? '—' : '自分 ' + (r.mySec ?? '?') + '枚 ／ 相手 ' + (r.oppSec ?? '?') + '枚')
    + '<div class="rec-md-memo-t">📝 メモ</div>'
    + '<textarea id="rec-md-memo" maxlength="500" placeholder="例: 序盤に事故った／〇〇が刺さった">' + esc(r.memo || '') + '</textarea>'
    + '<div class="rec-md-btns"><button class="rec-md-del" onclick="recDelete(' + jsArg(r.id) + ')">🗑 この記録を削除</button><button class="rec-chip" onclick="recCloseModal()">閉じる</button><button class="rec-chip sel" id="rec-md-save" onclick="recSaveMemo(' + jsArg(r.id) + ')">メモを保存</button></div>'
    + '</div>';
  document.getElementById('records-screen').appendChild(m);
};
function closeModal() { const m = document.getElementById('rec-modal'); if (m) m.remove(); }
window.recCloseModal = closeModal;
window.recSaveMemo = async function(id) {
  const ta = document.getElementById('rec-md-memo');
  const btn = document.getElementById('rec-md-save');
  if (!ta) return;
  const memo = ta.value.trim();
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    const r = await gasPost('updateMatchMemo', { playerName: window.currentPlayerName || '', password: window.currentSessionPassword || '', id, memo });
    if (!r || r.status !== 'OK') throw new Error((r && r.message) || '不明なエラー');
    const rec = records.find((x) => x.id === id);
    if (rec) rec.memo = memo;
    saveCache();
    closeModal();
    render();
  } catch (e) {
    alert('メモを保存できませんでした: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'メモを保存'; }
  }
};

// ===== 1試合ずつ削除 =====
let deleting = false;
window.recDelete = async function(id) {
  const r = records.find((x) => x.id === id);
  if (!r || deleting) return;
  const desc = fmtDate(r.startedAt) + '　' + oppOf(r) + '\n' + (r.myDeck || '') + ' → ' + (r.oppDeck || '') + '　' + r.result;
  if (!confirm('この対戦の記録を削除しますか？\n\n' + desc + '\n\n削除した記録は元に戻せません。')) return;
  deleting = true;
  try {
    const res = await gasPost('deleteMatchRecord', { playerName: window.currentPlayerName || '', password: window.currentSessionPassword || '', id });
    if (!res || res.status !== 'OK') throw new Error((res && res.message) || '不明なエラー');
    records = records.filter((x) => x.id !== id);
    saveCache();
    closeModal();
    render();
  } catch (e) {
    alert('削除できませんでした: ' + e.message);
  } finally {
    deleting = false;
  }
};

// ===== デッキ名をまとめる =====
window.recMergeToggle = () => { mergeOpen = !mergeOpen; render(); };
window.recMergeDo = async function() {
  const from = prefs.deckSel;
  const selEl = document.getElementById('rec-merge-to');
  let to = selEl ? selEl.value : '';
  if (to === '__new__') to = (prompt('新しいデッキ名', from) || '').trim();
  if (!to || to === from) return;
  if (!confirm('「' + from + '」の記録を「' + to + '」にまとめます。よろしいですか？')) return;
  try {
    const r = await gasPost('renameMatchDeck', { playerName: window.currentPlayerName || '', password: window.currentSessionPassword || '', from, to });
    if (!r || r.status !== 'OK') throw new Error((r && r.message) || '不明なエラー');
    records.forEach((x) => { if (x.myDeck === from) x.myDeck = to; });
    prefs.deckSel = to; mergeOpen = false;
    saveCache(); savePrefs(); render();
  } catch (e) {
    alert('まとめられませんでした: ' + e.message);
  }
};

// ===== 読み込み・操作 =====
// 端末に覚えた記録をすぐ出し、裏で最新を読み直す
window.loadRecords = async function(force) {
  if (loading || refreshing) return;
  if (!loaded) {
    const c = loadCache();
    if (c) { records = c; loaded = true; }
  }
  if (loaded && !force) { render(); return; }
  if (loaded) refreshing = true; else loading = true;
  render();
  try {
    const res = await gasGet('getMatchRecords', { player: window.currentPlayerName || '', pw: window.currentSessionPassword || '' });
    if (res && res.error) throw new Error(res.error);
    records = (Array.isArray(res) ? res : []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    loaded = true;
    saveCache();
  } catch (e) {
    if (!loaded) {
      loading = false;
      const body = document.getElementById('rec-body');
      if (body) body.innerHTML = '<div class="rec-empty">読み込めませんでした<div class="rec-empty-sub">' + esc(e.message) + '</div></div>';
      return;
    }
    console.warn('[戦績] 最新の読み込みに失敗', e);
  } finally {
    loading = false; refreshing = false;
  }
  render();
};
let _recUser = '';
window.showRecords = function() {
  // ログインし直したら前の人の記録を出さない
  if (_recUser !== (window.currentPlayerName || '')) { _recUser = window.currentPlayerName || ''; loaded = false; records = []; coversLoaded = false; deckCovers.my = {}; deckCovers.ai = {}; }
  mergeOpen = false;
  showScreen('records-screen');
  window.loadRecords(true);
  loadDeckCovers();
};
const setPref = (k, v) => { prefs[k] = v; savePrefs(); render(); };
window.recSetTab = (t) => { mergeOpen = false; setPref('tab', t); };
window.recOnlineDeck = (v) => setPref('onlineDeck', v);
window.recAiLevel = (v) => setPref('aiLevel', prefs.aiLevel === v ? '' : v);
window.recAiDeck = (v) => setPref('aiDeck', v);
window.recDeckMode = (v) => setPref('deckMode', v);
window.recDeckSel = (v) => { mergeOpen = false; setPref('deckSel', v); };
window.recPeriod = (v) => setPref('period', v);
window.recListMode = (v) => { prefs.listDeck = ''; setPref('listMode', v); };
window.recListDeck = (v) => setPref('listDeck', v);
window.recShowAbort = (v) => setPref('showAbort', !!v);

// 数字の吹き出し（マウスを乗せる・タップする）
function tipAt(el, x, y) {
  const tip = document.getElementById('rec-tip');
  if (!tip) return;
  if (!el) { tip.style.display = 'none'; return; }
  tip.textContent = el.getAttribute('data-tip');
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
  tip.style.top = Math.max(8, y - h - 14) + 'px';
}
const inRec = (e) => e.target && e.target.closest && e.target.closest('#records-screen') && !e.target.closest('#rec-modal');
document.addEventListener('mousemove', (e) => { if (inRec(e)) tipAt(e.target.closest('[data-tip]'), e.clientX, e.clientY); });
document.addEventListener('click', (e) => { if (inRec(e)) tipAt(e.target.closest('[data-tip]'), e.clientX, e.clientY); else tipAt(null); });
