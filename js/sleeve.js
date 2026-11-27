// スリーブ（デッキの裏面）。カードのイラストの部分だけを切り取り、縁・つや・小さな印を付けて「スリーブに入ったカードの裏」に見せる
// - 保存する形（デッキの「スリーブ」列。JSON 文字）: { no: カードNo, img: カード画像のURL, y: 上下の位置 0〜100, z: 拡大 %, c: 縁の色 }
//   空ならスリーブなし（今までの裏面）
// - 選ぶ画面: openSleevePicker({ current, deckNos, title }) → 決定で { sleeve }（なしは sleeve:null）、キャンセルで null
// - 対戦: 始める前に window._nextSleeves = { player, ai } を置く → battle.js startBattleGame が window._sleeves にする。
//   盤面の裏面（デッキの山・セキュリティ・引き直しの裏面）は window._sleeveBackHtml(side) で描く（無ければ今までの裏面）
import { loadCardAndKeywordData, getGoogleDriveDirectLink, getCardImageUrl } from './cards.js';

export const SLEEVE_COLORS = [
  ['#00fbff', 'シアン'], ['#ff00fb', 'マゼンタ'], ['#ff3b3b', '赤'], ['#2f7bff', '青'], ['#ffd400', '金'],
  ['#21c55d', '緑'], ['#a855f7', '紫'], ['#f2f2f2', '白'], ['#111111', '黒'],
];
const DEF = { y: 22, z: 175, c: '#00fbff' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function parseSleeve(v) {
  if (!v) return null;
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    if (!o || !o.img) return null;
    return { no: o.no || '', img: o.img, y: num(o.y, DEF.y), z: num(o.z, DEF.z), c: o.c || DEF.c };
  } catch (_) { return null; }
}
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (v != null && v !== '' && isFinite(+v) ? +v : d));
export const sleeveStr = (sl) => (sl ? JSON.stringify({ no: sl.no || '', img: sl.img, y: Math.round(sl.y), z: Math.round(sl.z), c: sl.c }) : '');

// スリーブの見た目（入れ物の大きさいっぱいに描く）。radius: 角の丸み(px)
export function sleeveHtml(sl, opts = {}) {
  if (!sl) return '';
  const url = getGoogleDriveDirectLink(sl.img) || sl.img;
  const r = opts.radius != null ? opts.radius : 4;
  return '<div class="slv' + (opts.thin ? ' slv-thin' : '') + '" style="--slv:' + esc(sl.c) + ';border-radius:' + r + 'px;' + (opts.style || '') + '">'
    + '<div class="slv-art" style="background-image:url(\'' + esc(url) + '\');background-size:' + sl.z + '% auto;background-position:50% ' + sl.y + '%;"></div>'
    + '<div class="slv-gloss"></div><div class="slv-emb">◆</div></div>';
}

// 対戦での見え方（デッキの山・セキュリティ・手札の裏）のプレビュー
export function sleeveSceneHtml(sl) {
  if (!sl) return '';
  const card = (st, thin) => '<div style="' + st + '">' + sleeveHtml(sl, { radius: 3, thin }) + '</div>';
  let pile = '';
  for (let i = 4; i >= 0; i--) pile += card('left:' + (i * 1.5) + 'px;top:' + (-i * 2) + 'px;', true);
  let secs = '';
  for (let i = 0; i < 5; i++) secs += card('top:' + (i * 10) + 'px;', true);
  let hand = '';
  for (let i = 0; i < 5; i++) hand += card('left:' + (i * 13) + 'px;transform:rotate(' + ((i - 2) * 9) + 'deg);', true);
  return '<div class="slv-scene"><span class="slv-scene-t">対戦での見え方</span>'
    + '<div><div class="slv-pile">' + pile + '</div><div class="slv-scene-lbl">デッキ</div></div>'
    + '<div><div class="slv-secs">' + secs + '</div><div class="slv-scene-lbl">セキュリティ</div></div>'
    + '<div><div class="slv-hand">' + hand + '</div><div class="slv-scene-lbl">手札（裏）</div></div></div>';
}
// スリーブを大きく見る（マイデッキ・保存の画面の見本を押したとき）
export function showSleevePreview(v, title) {
  const sl = parseSleeve(v);
  if (!sl) return;
  const ov = document.createElement('div');
  ov.className = 'slv-big-ov';
  ov.innerHTML = '<div class="slv-big"><b style="color:#00fbff;">🎴 ' + esc(title || 'スリーブ') + '</b>'
    + '<div class="slv-big-card">' + sleeveHtml(sl, { radius: 10 }) + '</div>' + sleeveSceneHtml(sl)
    + '<button class="slvp-cancel" style="margin-top:12px;">閉じる</button></div>';
  ov.onclick = (e) => { if (e.target === ov || e.target.tagName === 'BUTTON') ov.remove(); };
  document.body.appendChild(ov);
}

// ===== 対戦 =====
if (typeof window !== 'undefined') {
  window._sleeves = window._sleeves || {};
  window._parseSleeve = parseSleeve;
  // side: 'player' / 'ai'（'pl' も可）。スリーブが無ければ ''（呼び出し側が今までの裏面を描く）
  window._sleeveBackHtml = (side, opts) => {
    const sl = (window._sleeves || {})[side === 'ai' ? 'ai' : 'player'];
    return sl ? sleeveHtml(sl, opts || {}) : '';
  };
}

// ===== 選ぶ画面 =====
let _all = null;
async function allCards() {
  if (_all) return _all;
  try { await loadCardAndKeywordData(); } catch (_) {}
  _all = (window.allCards || []).filter((c) => c && c['カードNo'] && c['ImageURL'] && c['タイプ'] !== 'トークン');
  return _all;
}
const normQ = (v) => String(v || '').normalize('NFKC').toLowerCase().trim().replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

export function openSleevePicker(opts = {}) {
  return new Promise((resolve) => {
    let cur = opts.current ? Object.assign({}, parseSleeve(opts.current)) : null;
    if (cur && !cur.img) cur = null;
    let results = [];
    const ov = document.createElement('div');
    ov.className = 'slvp-ov';
    ov.innerHTML = '<div class="slvp">'
      + '<div class="slvp-head"><b>🎴 ' + esc(opts.title || 'スリーブを選ぶ') + '</b><button class="slvp-x" data-act="cancel">✕</button></div>'
      + '<div class="slvp-body">'
      + '<div class="slvp-left">'
      + '<div class="slvp-search"><input type="search" class="slvp-q" placeholder="カード名・カードNoで検索"><button class="slvp-go" data-act="search">🔍 検索</button></div>'
      + '<div class="slvp-hint"></div><div class="slvp-grid"></div></div>'
      + '<div class="slvp-right">'
      + '<div class="slvp-prev-wrap"><div class="slvp-prev"></div><div class="slvp-prev-sm"></div></div>'
      + '<div class="slvp-scene"></div>'
      + '<label class="slvp-l">上下の位置<input type="range" class="slvp-y" min="0" max="100" step="1"></label>'
      + '<label class="slvp-l">拡大<input type="range" class="slvp-z" min="100" max="300" step="5"></label>'
      + '<div class="slvp-l">縁の色</div><div class="slvp-colors">'
      + SLEEVE_COLORS.map(([c, n]) => '<button class="slvp-c" data-c="' + c + '" title="' + n + '" style="background:' + c + '"></button>').join('')
      + '<label class="slvp-c slvp-c-custom" title="好きな色"><input type="color" class="slvp-cc"></label></div>'
      + '<div class="slvp-note">カードのイラストの部分だけを使います（効果の文は映りません）</div>'
      + '</div></div>'
      + '<div class="slvp-foot"><button class="slvp-none" data-act="none">スリーブなし（いつもの裏面）</button><span style="flex:1"></span>'
      + '<button class="slvp-cancel" data-act="cancel">キャンセル</button><button class="slvp-ok" data-act="ok">決定</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    const close = (val) => { ov.remove(); resolve(val); };

    const refresh = () => {
      $('.slvp-prev').innerHTML = cur ? sleeveHtml(cur, { radius: 10 }) : '<div class="slvp-empty">左の一覧からカードを選んでください<br><small>（いまは「スリーブなし」）</small></div>';
      $('.slvp-prev-sm').innerHTML = cur ? sleeveHtml(cur, { radius: 3, thin: true }) : '';
      $('.slvp-scene').innerHTML = cur ? sleeveSceneHtml(cur) : '';
      $('.slvp-y').value = cur ? cur.y : DEF.y; $('.slvp-z').value = cur ? cur.z : DEF.z;
      $('.slvp-y').disabled = $('.slvp-z').disabled = !cur;
      ov.querySelectorAll('.slvp-c[data-c]').forEach((b) => b.classList.toggle('sel', !!cur && b.dataset.c.toLowerCase() === String(cur.c).toLowerCase()));
      $('.slvp-cc').value = cur && /^#[0-9a-f]{6}$/i.test(cur.c) ? cur.c : '#00fbff';
      ov.querySelectorAll('.slvp-card').forEach((el) => el.classList.toggle('sel', !!cur && el.dataset.no === cur.no));
    };
    const renderGrid = (list, hint) => {
      results = list;
      $('.slvp-hint').textContent = hint;
      $('.slvp-grid').innerHTML = list.map((c) => '<div class="slvp-card" data-no="' + esc(c['カードNo']) + '" title="' + esc(c['名前'] + '（' + c['カードNo'] + '）') + '"><img src="' + esc(getCardImageUrl(c)) + '" loading="lazy" alt=""><span>' + esc(c['名前']) + '</span></div>').join('');
      refresh();
    };
    const search = async () => {
      const q = normQ($('.slvp-q').value);
      const all = await allCards();
      if (!q) { showDeck(); return; }
      const hit = all.filter((c) => normQ(c['名前']).includes(q) || normQ(c['カードNo']).includes(q));
      renderGrid(hit.slice(0, 80), hit.length ? '「' + $('.slvp-q').value.trim() + '」の検索結果：' + hit.length + '件' + (hit.length > 80 ? '（先頭の80件）' : '') : '検索結果はありません');
    };
    const showDeck = async () => {
      const all = await allCards();
      const nos = [...new Set(opts.deckNos || [])];
      const list = nos.map((no) => all.find((c) => c['カードNo'] === no)).filter(Boolean);
      renderGrid(list, list.length ? 'このデッキのカード（' + list.length + '種類）。ほかのカードは検索してください' : 'カード名・カードNoで検索してください');
    };

    ov.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'cancel') return close(null);
        if (a === 'none') return close({ sleeve: null });
        if (a === 'ok') return close({ sleeve: cur });
        if (a === 'search') return search();
      }
      const card = e.target.closest('.slvp-card');
      if (card) {
        const c = results.find((x) => x['カードNo'] === card.dataset.no);
        if (c) { cur = Object.assign({ y: DEF.y, z: DEF.z, c: DEF.c }, cur ? { y: cur.y, z: cur.z, c: cur.c } : {}, { no: c['カードNo'], img: c['ImageURL'] }); refresh(); }
        return;
      }
      const col = e.target.closest('.slvp-c[data-c]');
      if (col && cur) { cur.c = col.dataset.c; refresh(); }
      if (e.target === ov) close(null);
    });
    $('.slvp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); search(); } });
    $('.slvp-y').addEventListener('input', (e) => { if (cur) { cur.y = +e.target.value; refresh(); } });
    $('.slvp-z').addEventListener('input', (e) => { if (cur) { cur.z = +e.target.value; refresh(); } });
    $('.slvp-cc').addEventListener('input', (e) => { if (cur) { cur.c = e.target.value; refresh(); } });
    refresh();
    showDeck();
  });
}
// デッキの保存・マイデッキ・管理画面の「スリーブ」の欄（いまのスリーブの見本＋選ぶボタン）
export function sleeveFieldHtml(sl, onclickJs) {
  const prev = sl ? sleeveHtml(sl, { radius: 3 }) : '<div class="slv-field-def" style="background-image:url(\'' + esc(DEFAULT_BACK) + '\')"></div>';
  return '<div class="slv-field"><div class="slv-field-prev"' + (sl ? ' style="cursor:pointer" title="押すと大きく見られます" onclick="window._showSleevePreview(' + esc(JSON.stringify(sleeveStr(sl))) + ')"' : '') + '>' + prev + '</div>'
    + '<div class="slv-field-txt"><b>🎴 スリーブ</b>' + (sl ? '対戦でこのデッキの裏面になります' : 'スリーブなし（いつもの裏面）') + '</div>'
    + '<button type="button" class="slv-field-btn" onclick="' + onclickJs + '">' + (sl ? '変える' : '選ぶ') + '</button></div>';
}
const DEFAULT_BACK = 'https://drive.google.com/thumbnail?id=1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9&sz=w200';
// デッキのリスト（"名前(カードNo)x2,..."）→ カードNoの並び
export const deckNosOf = (list) => [...String(list || '').matchAll(/\(([^()]+)\)x\d+/g)].map((m) => m[1]);
if (typeof window !== 'undefined') {
  window._sleeveFieldHtml = sleeveFieldHtml;
  window._showSleevePreview = showSleevePreview;
  window._sleeveSceneHtml = sleeveSceneHtml;
  window._deckNosOf = deckNosOf;
  window._openSleevePicker = openSleevePicker;
  window._sleeveHtml = sleeveHtml;
  window._sleeveStr = sleeveStr;
}
