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

// t: デジタマデッキのスリーブ。'same'（または無し）= メインと同じ / 'none' = いつものデジタマの裏面 / { no, img, y, z, c } = 別のスリーブ
// メインがスリーブなし（img が空）で、デジタマだけ別のスリーブ、もできる
export function parseSleeve(v) {
  if (!v) return null;
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    if (!o) return null;
    const one = (x) => (x && x.img ? { no: x.no || '', img: x.img, y: num(x.y, DEF.y), z: num(x.z, DEF.z), c: x.c || DEF.c } : null);
    const main = one(o);
    const t = o.t === 'none' ? 'none' : (o.t && typeof o.t === 'object' ? one(o.t) : null) || 'same';
    if (!main && !(t && typeof t === 'object')) return null;
    return Object.assign({ no: '', img: '', y: DEF.y, z: DEF.z, c: DEF.c }, main || {}, { t });
  } catch (_) { return null; }
}
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (v != null && v !== '' && isFinite(+v) ? +v : d));
const oneStr = (x) => ({ no: x.no || '', img: x.img, y: Math.round(x.y), z: Math.round(x.z), c: x.c });
export const sleeveStr = (sl) => {
  if (!sl) return '';
  const main = sl.img ? oneStr(sl) : { img: '' };
  const t = sl.t === 'none' ? 'none' : (sl.t && typeof sl.t === 'object' && sl.t.img ? oneStr(sl.t) : 'same');
  if (!sl.img && typeof t !== 'object') return '';
  return JSON.stringify(Object.assign(main, t === 'same' ? {} : { t }));
};
// デジタマデッキのスリーブ（無ければ null＝いつものデジタマの裏面）
export function tamaSleeveOf(sl) {
  if (!sl || sl.t === 'none') return null;
  if (sl.t && typeof sl.t === 'object') return sl.t;
  return sl.img ? sl : null;
}

// スリーブの見た目（入れ物の大きさいっぱいに描く）。radius: 角の丸み(px)
export function sleeveHtml(sl, opts = {}) {
  if (!sl || !sl.img) return '';
  const url = getGoogleDriveDirectLink(sl.img) || sl.img;
  const r = opts.radius != null ? opts.radius : 4;
  return '<div class="slv' + (opts.thin ? ' slv-thin' : '') + '" style="--slv:' + esc(sl.c) + ';border-radius:' + r + 'px;' + (opts.style || '') + '">'
    + '<div class="slv-art" style="background-image:url(\'' + esc(url) + '\');background-size:' + sl.z + '% auto;background-position:50% ' + sl.y + '%;"></div>'
    + '<div class="slv-gloss"></div><div class="slv-emb">◆</div></div>';
}

// 対戦での見え方（デッキの山・セキュリティ・手札の裏）のプレビュー
export function sleeveSceneHtml(sl) {
  if (!sl) return '';
  const tama = tamaSleeveOf(sl);
  const card = (x, st) => '<div style="' + st + '">' + (sleeveHtml(x, { radius: 3, thin: true }) || '<div class="slv-def-back"></div>') + '</div>';
  const pileOf = (x) => { let h = ''; for (let i = 4; i >= 0; i--) h += card(x, 'left:' + (i * 1.5) + 'px;top:' + (-i * 2) + 'px;'); return h; };
  let secs = '';
  for (let i = 0; i < 5; i++) secs += card(sl, 'top:' + (i * 10) + 'px;');
  let hand = '';
  for (let i = 0; i < 5; i++) hand += card(sl, 'left:' + (i * 13) + 'px;transform:rotate(' + ((i - 2) * 9) + 'deg);');
  return '<div class="slv-scene"><span class="slv-scene-t">対戦での見え方</span>'
    + '<div><div class="slv-pile">' + pileOf(sl) + '</div><div class="slv-scene-lbl">デッキ</div></div>'
    + '<div><div class="slv-pile' + (tama ? '' : ' tama-def') + '">' + (tama ? pileOf(tama) : pileOf(null)) + '</div><div class="slv-scene-lbl">デジタマ</div></div>'
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
    + '<div class="slv-big-cards"><div><div class="slv-big-card">' + (sleeveHtml(sl, { radius: 10 }) || '<div class="slv-def-back"></div>') + '</div><div class="slv-scene-lbl">デッキ</div></div>'
    + '<div><div class="slv-big-card sm">' + (sleeveHtml(tamaSleeveOf(sl), { radius: 8 }) || '<div class="slv-def-back tama"></div>') + '</div><div class="slv-scene-lbl">デジタマ</div></div></div>' + sleeveSceneHtml(sl)
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
  // デジタマデッキ（育成エリアの裏・デジタマデッキの山）。無ければ ''（いつものデジタマの裏面）
  window._tamaSleeveBackHtml = (side, opts) => {
    const sl = (window._sleeves || {})[side === 'ai' ? 'ai' : 'player'];
    return sleeveHtml(tamaSleeveOf(sl), opts || {});
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
    const init = parseSleeve(opts.current);
    // main: メインのスリーブ（null＝なし）/ tamaMode: 'same' | 'none' | 'own' / tama: デジタマ用のスリーブ（tamaMode==='own'）
    let main = init && init.img ? { no: init.no, img: init.img, y: init.y, z: init.z, c: init.c } : null;
    let tamaMode = !init ? 'same' : (init.t === 'none' ? 'none' : (init.t && typeof init.t === 'object' ? 'own' : 'same'));
    let tama = init && init.t && typeof init.t === 'object' ? Object.assign({}, init.t) : null;
    let tab = 'main';
    let results = [];
    const ov = document.createElement('div');
    ov.className = 'slvp-ov';
    ov.innerHTML = '<div class="slvp">'
      + '<div class="slvp-head"><b>🎴 ' + esc(opts.title || 'スリーブを選ぶ') + '</b><button class="slvp-x" data-act="cancel">✕</button></div>'
      + '<div class="slvp-tabs"><button class="slvp-tab" data-tab="main">🃏 メインデッキ</button><button class="slvp-tab" data-tab="tama">🥚 デジタマデッキ</button></div>'
      + '<div class="slvp-tama-modes"><label><input type="radio" name="slvp-tm" value="same"> メインと同じスリーブ</label>'
      + '<label><input type="radio" name="slvp-tm" value="own"> 別のスリーブにする</label>'
      + '<label><input type="radio" name="slvp-tm" value="none"> スリーブなし（いつものデジタマの裏面）</label></div>'
      + '<div class="slvp-body">'
      + '<div class="slvp-left">'
      + '<div class="slvp-search"><input type="search" class="slvp-q" placeholder="カード名・カードNoで検索"><button class="slvp-go" data-act="search">🔍 検索</button></div>'
      + '<div class="slvp-hint"></div><div class="slvp-grid"></div></div>'
      + '<div class="slvp-right">'
      + '<div class="slvp-prev-wrap"><div class="slvp-prev"></div><div class="slvp-prev-sm"></div></div>'
      + '<label class="slvp-l">上下の位置<input type="range" class="slvp-y" min="0" max="100" step="1"></label>'
      + '<label class="slvp-l">拡大<input type="range" class="slvp-z" min="100" max="300" step="5"></label>'
      + '<div class="slvp-l">縁の色</div><div class="slvp-colors">'
      + SLEEVE_COLORS.map(([c, n]) => '<button class="slvp-c" data-c="' + c + '" title="' + n + '" style="background:' + c + '"></button>').join('')
      + '<label class="slvp-c slvp-c-custom" title="好きな色"><input type="color" class="slvp-cc"></label></div>'
      + '<div class="slvp-scene"></div>'
      + '<div class="slvp-note">カードのイラストの部分だけを使います（効果の文は映りません）</div>'
      + '</div></div>'
      + '<div class="slvp-foot"><button class="slvp-none" data-act="none"></button><span style="flex:1"></span>'
      + '<button class="slvp-cancel" data-act="cancel">キャンセル</button><button class="slvp-ok" data-act="ok">決定</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    const $ = (q) => ov.querySelector(q);
    const close = (val) => { ov.remove(); resolve(val); };
    // いま編集しているスリーブ（メインのタブ＝main、デジタマのタブ＝「別のスリーブ」のときの tama）
    const editing = () => (tab === 'main' ? main : (tamaMode === 'own' ? tama : null));
    const canEdit = () => tab === 'main' || tamaMode === 'own';
    const setEditing = (v) => { if (tab === 'main') main = v; else tama = v; };
    const result = () => {
      const t = tamaMode === 'none' ? 'none' : (tamaMode === 'own' && tama ? tama : 'same');
      if (!main && typeof t !== 'object') return tamaMode === 'none' && !main ? null : null;
      return Object.assign({}, main || { no: '', img: '', y: DEF.y, z: DEF.z, c: DEF.c }, { t });
    };

    const refresh = () => {
      ov.querySelectorAll('.slvp-tab').forEach((b) => b.classList.toggle('sel', b.dataset.tab === tab));
      $('.slvp-tama-modes').style.display = tab === 'tama' ? '' : 'none';
      ov.querySelectorAll('input[name=slvp-tm]').forEach((r) => { r.checked = r.value === tamaMode; });
      const cur = editing();
      const lockMsg = tab === 'tama' && tamaMode === 'same' ? 'メインデッキと同じスリーブを使います' : tab === 'tama' && tamaMode === 'none' ? 'いつものデジタマの裏面を使います' : '';
      $('.slvp-left').style.opacity = canEdit() ? '' : '0.35';
      $('.slvp-left').style.pointerEvents = canEdit() ? '' : 'none';
      const shown = tab === 'tama' && tamaMode === 'same' ? main : cur;
      $('.slvp-prev').innerHTML = shown ? sleeveHtml(shown, { radius: 10 })
        : '<div class="slvp-empty">' + (lockMsg || '左の一覧からカードを選んでください') + '<br><small>' + (tab === 'main' ? '（いまは「スリーブなし」）' : '') + '</small></div>';
      $('.slvp-prev-sm').innerHTML = shown ? sleeveHtml(shown, { radius: 3, thin: true }) : '';
      $('.slvp-scene').innerHTML = sleeveSceneHtml(result() || { img: '', t: 'none' });
      $('.slvp-y').value = cur ? cur.y : DEF.y; $('.slvp-z').value = cur ? cur.z : DEF.z;
      $('.slvp-y').disabled = $('.slvp-z').disabled = !cur;
      ov.querySelectorAll('.slvp-c[data-c]').forEach((b) => b.classList.toggle('sel', !!cur && b.dataset.c.toLowerCase() === String(cur.c).toLowerCase()));
      $('.slvp-cc').value = cur && /^#[0-9a-f]{6}$/i.test(cur.c) ? cur.c : '#00fbff';
      ov.querySelectorAll('.slvp-card').forEach((el) => el.classList.toggle('sel', !!cur && el.dataset.no === cur.no));
      $('.slvp-none').textContent = tab === 'main' ? 'メインデッキはスリーブなし' : 'デジタマはスリーブなし';
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
      const tb = e.target.closest('.slvp-tab');
      if (tb) { tab = tb.dataset.tab; refresh(); return; }
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'cancel') return close(null);
        if (a === 'none') {
          if (tab === 'main') main = null; else { tamaMode = 'none'; }
          refresh(); return;
        }
        if (a === 'ok') return close({ sleeve: result() });
        if (a === 'search') return search();
      }
      const card = e.target.closest('.slvp-card');
      if (card && canEdit()) {
        const c = results.find((x) => x['カードNo'] === card.dataset.no);
        const cur = editing();
        if (c) { setEditing(Object.assign({ y: DEF.y, z: DEF.z, c: DEF.c }, cur ? { y: cur.y, z: cur.z, c: cur.c } : {}, { no: c['カードNo'], img: c['ImageURL'] })); refresh(); }
        return;
      }
      const col = e.target.closest('.slvp-c[data-c]');
      const cur = editing();
      if (col && cur) { cur.c = col.dataset.c; refresh(); }
      if (e.target === ov) close(null);
    });
    ov.querySelectorAll('input[name=slvp-tm]').forEach((r) => r.addEventListener('change', () => {
      tamaMode = r.value;
      if (tamaMode === 'own' && !tama && main) tama = Object.assign({}, main); // 最初はメインの写しから
      refresh();
    }));
    $('.slvp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); search(); } });
    $('.slvp-y').addEventListener('input', (e) => { const cur = editing(); if (cur) { cur.y = +e.target.value; refresh(); } });
    $('.slvp-z').addEventListener('input', (e) => { const cur = editing(); if (cur) { cur.z = +e.target.value; refresh(); } });
    $('.slvp-cc').addEventListener('input', (e) => { const cur = editing(); if (cur) { cur.c = e.target.value; refresh(); } });
    refresh();
    showDeck();
  });
}
// デッキの保存・マイデッキ・管理画面の「スリーブ」の欄（いまのスリーブの見本＋選ぶボタン）
export function sleeveFieldHtml(sl, onclickJs) {
  const prev = (sl && sl.img) ? sleeveHtml(sl, { radius: 3 }) : '<div class="slv-field-def" style="background-image:url(\'' + esc(DEFAULT_BACK) + '\')"></div>';
  const tm = sl ? (sl.t === 'none' ? 'デジタマはいつもの裏面' : (sl.t && typeof sl.t === 'object' ? 'デジタマは別のスリーブ' : 'デジタマも同じスリーブ')) : '';
  return '<div class="slv-field"><div class="slv-field-prev"' + (sl ? ' style="cursor:pointer" title="押すと大きく見られます" onclick="window._showSleevePreview(' + esc(JSON.stringify(sleeveStr(sl))) + ')"' : '') + '>' + prev + '</div>'
    + '<div class="slv-field-txt"><b>🎴 スリーブ</b>' + (sl ? (sl.img ? '対戦でこのデッキの裏面になります' : 'メインデッキはいつもの裏面') + '<br><small>' + tm + '</small>' : 'スリーブなし（いつもの裏面）') + '</div>'
    + '<button type="button" class="slv-field-btn" onclick="' + onclickJs + '">' + (sl ? '変える' : '選ぶ') + '</button></div>';
}
const DEFAULT_BACK = 'https://drive.google.com/thumbnail?id=1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9&sz=w200';
// デッキのリスト（"名前(カードNo)x2,..."）→ カードNoの並び
export const deckNosOf = (list) => [...String(list || '').matchAll(/\(([^()]+)\)x\d+/g)].map((m) => m[1]);
if (typeof window !== 'undefined') {
  window._sleeveFieldHtml = sleeveFieldHtml;
  window._tamaSleeveOf = tamaSleeveOf;
  window._showSleevePreview = showSleevePreview;
  window._sleeveSceneHtml = sleeveSceneHtml;
  window._deckNosOf = deckNosOf;
  window._openSleevePicker = openSleevePicker;
  window._sleeveHtml = sleeveHtml;
  window._sleeveStr = sleeveStr;
}
