// 戦績の画面（pages/records.html）。3つのタブ:
//  - オンライン: 勝率・先攻/後攻・相手ごと・決着の理由 → 対戦の一覧
//  - AI: 勝率・AIのレベルごと・先攻/後攻・決着の理由 → 対戦の一覧
//  - デッキごと: 自分のデッキごとの勝率 → 選んだデッキの「相手のデッキごと」の勝ち負け・先攻/後攻
// 勝率は「勝ち ÷（勝ち＋負け）」。中断は数に出すが勝率には入れない。
// 記録は js/match-record.js が付ける（GAS のシート「戦績」）
import { gasGet, gasPost } from './firebase-config.js';

const AI_LV = { low: { name: '見習いテイマー', short: '低' }, mid: { name: 'ベテランテイマー', short: '中' }, high: { name: 'デジモンマスター', short: '高' } };
const AI_ORDER = ['low', 'mid', 'high'];

let records = [];
let loaded = false;
let loading = false;
let tab = 'online';
let onlineDeck = '';     // オンラインの一覧: 自分のデッキで絞る
let aiLevel = '';        // AIの一覧: レベルで絞る
let aiDeck = '';
let deckMode = 'all';    // デッキごと: all / online / ai
let deckSel = '';        // デッキごと: 選んだ自分のデッキ

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (t) => { if (!t) return '—'; const d = new Date(t); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : m + '分' + pad(s % 60) + '秒'; };
const lvName = (lv) => (AI_LV[lv] ? AI_LV[lv].name : (lv || '—'));

function stats(list) {
  const w = list.filter((r) => r.result === '勝ち').length;
  const l = list.filter((r) => r.result === '負け').length;
  const a = list.length - w - l;
  return { n: list.length, w, l, a, rate: w + l ? w / (w + l) : null };
}
const pct = (rate) => (rate == null ? '—' : Math.round(rate * 100) + '%');

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
  return '<div class="rec-legend"><span><i class="rec-c-win"></i>勝ち</span><span><i class="rec-c-lose"></i>負け</span><span><i class="rec-c-abort"></i>中断</span></div>';
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
    const k = r.result === '勝ち' ? 'win' : r.result === '負け' ? 'lose' : 'abort';
    const ch = r.result === '勝ち' ? '勝' : r.result === '負け' ? '負' : '中';
    const tip = fmtDate(r.startedAt) + '\n' + (r.mode === 'ai' ? lvName(r.aiLevel) : 'vs ' + r.opp) + '\n' + r.myDeck + ' → ' + r.oppDeck + '\n' + r.result + '（' + r.reason + '）';
    return '<span class="rec-dot rec-c-' + k + '" data-tip="' + esc(tip) + '">' + ch + '</span>';
  };
  return section('直近' + last.length + '戦の流れ', '<div class="rec-strip">' + last.map(cell).join('') + '</div><div class="rec-strip-axis"><span>古い</span><span>新しい →</span></div>');
}

// 名前ごとの棒の表（相手ごと・レベルごと・決着の理由ごと等）
function groupRows(groups, opt = {}) {
  if (!groups.length) return '<div class="rec-empty-sm">まだ記録がありません</div>';
  return '<div class="rec-rows">' + groups.map((g) => {
    const s = stats(g.list);
    return '<div class="rec-row' + (opt.onclick ? ' rec-row-btn' + (opt.sel === g.key ? ' sel' : '') : '') + '"' + (opt.onclick ? ' onclick="' + opt.onclick + '(' + esc(JSON.stringify(g.key)) + ')"' : '') + '>'
      + '<div class="rec-row-name" title="' + esc(g.label) + '">' + esc(g.label) + '</div>'
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

// 決着の理由（勝った理由・負けた理由）
function reasons(list) {
  const keys = ['ダイレクトアタック', 'デッキ切れ', '投了', 'その他'];
  const done = list.filter((r) => r.result !== '中断');
  if (!done.length) return '<div class="rec-empty-sm">まだ決着した対戦がありません</div>';
  const rows = keys.map((k) => {
    const w = done.filter((r) => r.result === '勝ち' && (r.reason || 'その他') === k).length;
    const l = done.filter((r) => r.result === '負け' && (r.reason || 'その他') === k).length;
    return { k, w, l };
  }).filter((x) => x.w || x.l);
  const max = Math.max(1, ...rows.map((x) => Math.max(x.w, x.l)));
  return '<table class="rec-reason"><thead><tr><th>決着の理由</th><th class="r">勝ち</th><th class="r">負け</th></tr></thead><tbody>' + rows.map((x) =>
    '<tr><td>' + esc(x.k) + '</td>'
    + '<td><div class="rec-hbar"><span class="rec-c-win" style="width:' + (x.w / max * 100) + '%" data-tip="' + esc(x.k + 'で勝ち ' + x.w + '回') + '"></span><b>' + x.w + '</b></div></td>'
    + '<td><div class="rec-hbar"><span class="rec-c-lose" style="width:' + (x.l / max * 100) + '%" data-tip="' + esc(x.k + 'で負け ' + x.l + '回') + '"></span><b>' + x.l + '</b></div></td></tr>').join('') + '</tbody></table>';
}

const section = (title, body, extra) => '<div class="rec-sec"><div class="rec-sec-head"><div class="rec-sec-title">' + title + '</div>' + (extra || '') + '</div>' + body + '</div>';

function resultBadge(r) {
  const k = r.result === '勝ち' ? 'win' : r.result === '負け' ? 'lose' : 'abort';
  return '<span class="rec-badge rec-c-' + k + '">' + esc(r.result) + '</span>';
}

// 対戦の一覧
function historyTable(list, mode) {
  if (!list.length) return '<div class="rec-empty-sm">まだ記録がありません</div>';
  const head = mode === 'ai'
    ? ['日時', 'AIのレベル', '自分のデッキ', 'AIのデッキ', '勝敗', '先/後', '決着の理由', 'ターン', '対戦時間']
    : ['日時', '相手', '自分のデッキ', '相手のデッキ', '勝敗', '先/後', '決着の理由', 'ターン', '対戦時間'];
  const rows = list.map((r) => '<tr>'
    + '<td class="nw">' + fmtDate(r.startedAt) + '</td>'
    + '<td>' + esc(mode === 'ai' ? lvName(r.aiLevel) : r.opp) + '</td>'
    + '<td>' + esc(r.myDeck) + '</td><td>' + esc(r.oppDeck) + '</td>'
    + '<td>' + resultBadge(r) + '</td>'
    + '<td class="nw">' + (r.first ? '先攻' : '後攻') + '</td>'
    + '<td class="nw">' + esc(r.result === '中断' ? '—' : r.reason) + '</td>'
    + '<td class="r">' + (r.turns || '—') + '</td>'
    + '<td class="r nw">' + (r.durationSec ? fmtDur(r.durationSec) : '—') + '</td></tr>').join('');
  return '<div class="rec-table-wrap"><table class="rec-table"><thead><tr>' + head.map((h, i) => '<th' + (i >= 7 ? ' class="r"' : '') + '>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function deckSelect(list, cur, fn) {
  const names = [...new Set(list.map((r) => r.myDeck).filter(Boolean))].sort();
  return '<select class="rec-select" onchange="' + fn + '(this.value)"><option value="">自分のデッキ: すべて</option>'
    + names.map((n) => '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>';
}
function chips(items, cur, fn) {
  return '<div class="rec-chips">' + items.map(([v, l]) => '<button class="rec-chip' + (v === cur ? ' sel' : '') + '" onclick="' + fn + '(' + esc(JSON.stringify(v)) + ')">' + esc(l) + '</button>').join('') + '</div>';
}

// ===== 各タブ =====
function renderOnline() {
  const all = records.filter((r) => r.mode === 'online');
  if (!all.length) return emptyTab('オンライン対戦の記録はまだありません', 'オンライン対戦をすると、ここに勝ち負けが記録されます。');
  const list = onlineDeck ? all.filter((r) => r.myDeck === onlineDeck) : all;
  return '<div class="rec-filter">' + deckSelect(all, onlineDeck, 'recOnlineDeck') + '</div>'
    + summary(list)
    + recent(list)
    + section('相手ごと', groupRows(groupBy(list, (r) => r.opp)), legend())
    + section('決着の理由', reasons(list))
    + section('対戦の一覧（' + list.length + '件）', historyTable(list, 'online'))
    + resetBtn('オンライン対戦の戦績をすべてリセット', 'online', '', all.length);
}

function renderAi() {
  const all = records.filter((r) => r.mode === 'ai');
  if (!all.length) return emptyTab('AI対戦の記録はまだありません', 'AI対戦をすると、ここに勝ち負けが記録されます。');
  let list = aiDeck ? all.filter((r) => r.myDeck === aiDeck) : all;
  const byLv = AI_ORDER.map((lv) => ({ key: lv, label: lvName(lv), list: list.filter((r) => r.aiLevel === lv) })).filter((g) => g.list.length);
  if (aiLevel) list = list.filter((r) => r.aiLevel === aiLevel);
  return '<div class="rec-filter">' + chips([['', 'すべて'], ...AI_ORDER.map((lv) => [lv, AI_LV[lv].short + '：' + AI_LV[lv].name])], aiLevel, 'recAiLevel') + deckSelect(all, aiDeck, 'recAiDeck') + '</div>'
    + summary(list)
    + section('AIのレベルごと', groupRows(byLv, { onclick: 'recAiLevel', sel: aiLevel }), legend())
    + recent(list)
    + section('AIのデッキごと', groupRows(groupBy(list, (r) => r.oppDeck)))
    + section('決着の理由', reasons(list))
    + section('対戦の一覧（' + list.length + '件）', historyTable(list, 'ai'))
    + resetBtn('AI対戦の戦績をすべてリセット', 'ai', '', all.length);
}

function renderDeck() {
  const all = deckMode === 'all' ? records : records.filter((r) => r.mode === deckMode);
  const modeChips = chips([['all', 'すべて'], ['online', '🌐 オンライン'], ['ai', '🤖 AI']], deckMode, 'recDeckMode');
  if (!all.length) return '<div class="rec-filter">' + modeChips + '</div>' + emptyTab('記録はまだありません', '対戦をすると、デッキごとの成績がここに出ます。');
  const decks = groupBy(all, (r) => r.myDeck);
  if (!deckSel || !decks.some((d) => d.key === deckSel)) deckSel = decks[0].key;
  const mine = all.filter((r) => r.myDeck === deckSel);
  const s = stats(mine);
  const f = mine.filter((r) => r.first).length;
  // 相手のデッキごと
  const opps = groupBy(mine, (r) => r.oppDeck);
  const fb = (l, first) => { const x = l.filter((r) => r.first === first); const t = stats(x); return x.length ? x.length + '回 <small>(' + t.w + '勝' + t.l + '敗)</small>' : '0回'; };
  const matchRows = opps.map((g) => {
    const t = stats(g.list);
    return '<tr><td class="rec-mu-name">' + esc(g.label) + '</td>'
      + '<td class="r">' + t.n + '</td><td class="r rec-w">' + t.w + '</td><td class="r rec-l">' + t.l + '</td>'
      + '<td class="rec-mu-bar">' + stackBar(t, 'vs ' + g.label) + '<span class="rec-mu-rate">' + pct(t.rate) + '</span></td>'
      + '<td class="nw">' + fb(g.list, true) + '</td><td class="nw">' + fb(g.list, false) + '</td></tr>';
  }).join('');
  return '<div class="rec-filter">' + modeChips + '</div>'
    + section('自分のデッキごと <small>（押すと相手のデッキごとの成績を表示）</small>', groupRows(decks, { onclick: 'recDeckSel', sel: deckSel }), legend())
    + '<div class="rec-sec rec-deck-detail">'
    + '<div class="rec-deck-title">🃏 ' + esc(deckSel || '（名前なし）') + '</div>'
    + '<div class="rec-deck-sum">' + s.n + '戦 ' + wl(s) + '　勝率 <b>' + pct(s.rate) + '</b>　先攻 ' + f + '回・後攻 ' + (s.n - f) + '回</div>'
    + '<div class="rec-sec-title" style="margin-top:12px;">相手のデッキごと</div>'
    + '<div class="rec-table-wrap"><table class="rec-table rec-mu"><thead><tr><th>相手のデッキ</th><th class="r">対戦</th><th class="r">勝</th><th class="r">敗</th><th>勝率</th><th>先攻</th><th>後攻</th></tr></thead><tbody>' + matchRows + '</tbody></table></div>'
    + '</div>'
    + resetBtn('「' + (deckSel || '（名前なし）') + '」の' + (deckMode === 'online' ? 'オンライン対戦の' : deckMode === 'ai' ? 'AI対戦の' : '') + '戦績をリセット', deckMode === 'all' ? '' : deckMode, deckSel, mine.length);
}

// リセットのボタン（押すと確認 → GAS で記録を消す）。mode: 'online' / 'ai' / ''（両方）、myDeck: 空なら全デッキ
const _resetArgs = [];
function resetBtn(label, mode, myDeck, n) {
  _resetArgs.push({ label, mode, myDeck, n });
  return '<div class="rec-reset"><button class="rec-reset-btn" onclick="recReset(' + (_resetArgs.length - 1) + ')">🗑 ' + esc(label) + '</button>'
    + '<div class="rec-reset-sub">' + n + '件の記録を消します。元に戻せません。</div></div>';
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
    if (a.myDeck && deckSel === a.myDeck) deckSel = '';
    render();
    alert('リセットしました（' + (r.deleted || 0) + '件）');
  } catch (e) {
    alert('リセットできませんでした: ' + e.message);
  } finally {
    resetting = false;
  }
};
let resetting = false;

const emptyTab = (t, sub) => '<div class="rec-empty"><div class="rec-empty-icon">📭</div><div>' + t + '</div><div class="rec-empty-sub">' + sub + '</div></div>';

function render() {
  document.querySelectorAll('#records-screen .rec-tab').forEach((b) => b.classList.toggle('sel', b.dataset.tab === tab));
  const body = document.getElementById('rec-body');
  if (!body) return;
  _resetArgs.length = 0;
  if (!loaded) { body.innerHTML = '<div class="rec-empty">' + (loading ? '読み込み中...' : '') + '</div>'; return; }
  body.innerHTML = tab === 'ai' ? renderAi() : tab === 'deck' ? renderDeck() : renderOnline();
}

// ===== 読み込み・操作 =====
window.loadRecords = async function(force) {
  if (loading) return;
  if (loaded && !force) { render(); return; }
  loading = true; render();
  try {
    const res = await gasGet('getMatchRecords', { player: window.currentPlayerName || '', pw: window.currentSessionPassword || '' });
    if (res && res.error) throw new Error(res.error);
    records = (Array.isArray(res) ? res : []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    loaded = true;
  } catch (e) {
    const body = document.getElementById('rec-body');
    loading = false;
    if (body) body.innerHTML = '<div class="rec-empty">読み込めませんでした<div class="rec-empty-sub">' + esc(e.message) + '</div></div>';
    return;
  }
  loading = false;
  render();
};
window.showRecords = function() {
  showScreen('records-screen');
  window.loadRecords(true);
};
window.recSetTab = (t) => { tab = t; render(); };
window.recOnlineDeck = (v) => { onlineDeck = v; render(); };
window.recAiLevel = (v) => { aiLevel = aiLevel === v ? '' : v; render(); };
window.recAiDeck = (v) => { aiDeck = v; render(); };
window.recDeckMode = (v) => { deckMode = v; render(); };
window.recDeckSel = (v) => { deckSel = v; render(); };

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
document.addEventListener('mousemove', (e) => {
  if (!e.target || !e.target.closest || !e.target.closest('#records-screen')) return;
  tipAt(e.target.closest('[data-tip]'), e.clientX, e.clientY);
});
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest || !e.target.closest('#records-screen')) return;
  tipAt(e.target.closest('[data-tip]'), e.clientX, e.clientY);
});
