// デッキビルダーロジック（GAS API版）
import { gasPost } from './firebase-config.js';
import { loadCardAndKeywordData, getCardImageUrl, getGoogleDriveDirectLink, isBehaviorOk, renderLevelBarHtml, renderDeckByLevelHtml } from './cards.js';

let searchMode = 'name';
let selectedColors = [];
let selectedLevels = [];
let selectedTypes = [];

// デッキビルダー初期化
window.initBuilder = async function() {
  isTutorialMode = false;
  window.isSampleMode = false;
  searchMode = 'name';
  selectedColors = [];
  selectedLevels = [];
  selectedTypes = [];
  window._editDeckName = '';
  window._editPassword = '';
  tempDeck = [];
  updateDeckUI();
  const label = document.getElementById('back-btn-label');
  if (label) label.innerText = 'TOPへ戻る';
  showScreen('deck-make-screen');

  if (allCards.length === 0) {
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadCardAndKeywordData();
    document.getElementById('loading-overlay').style.display = 'none';
  }
  filterCards();
};

window.editDeckByIndex = async function(idx) {
  isTutorialMode = false;
  window.isSampleMode = false;
  const d = window.latestDecks[idx];
  window._editDeckName = d.name;
  window._editPassword = currentSessionPassword;
  tempDeck = [];
  showScreen('deck-make-screen');

  if (allCards.length === 0) {
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadCardAndKeywordData();
    document.getElementById('loading-overlay').style.display = 'none';
  }

  tempDeck = [];
  d.list.split(',').forEach(line => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (m) {
      const card = allCards.find(c => c["カードNo"] === m[2]);
      if (card) tempDeck.push({ card, count: parseInt(m[3]) });
    }
  });
  updateDeckUI();
  filterCards();
};

window.toggleZoom = function(img) {
  zoomScale = (zoomScale === 1) ? 2.5 : 1;
  img.style.transform = `scale(${zoomScale})`;
  img.style.cursor = (zoomScale === 1) ? 'zoom-out' : 'zoom-in';
};

window.setSearchMode = function(mode) {
  searchMode = mode;
  document.getElementById('mode-name').classList.toggle('active', mode === 'name');
  document.getElementById('mode-effect').classList.toggle('active', mode === 'effect');
  filterCards();
};

window.toggleFilter = function(btn, type, val) {
  btn.classList.toggle('selected');
  const arr = (type === 'colors') ? selectedColors : (type === 'levels' ? selectedLevels : selectedTypes);
  const idx = arr.indexOf(val);
  if (idx > -1) arr.splice(idx, 1); else arr.push(val);
  filterCards();
};

// 記述検索の対象（総合ルール 4-23-1「カード全体の記述されている情報」・公式Q&A Q7603）:
// 名称・特徴・効果・進化元効果・セキュリティ効果・進化条件・リンク条件・使用条件。ジョグレス／デジクロス／アセンブリ等の条件は効果の文に含まれる。
// 以前は「効果」欄だけを見ていて、進化元効果・進化条件（「ジェムモン」記述Lv.5 等）・名称・特徴にだけ書かれたカードが出なかった
const DESCRIPTION_FIELDS = ['名前', '特徴', '効果', '効果テキスト', '進化元効果', '進化元テキスト', 'セキュリティ効果', 'セキュリティテキスト', '進化条件', 'リンク条件', '使用条件（オプション）'];
function descriptionText(c) {
  return DESCRIPTION_FIELDS.map(k => c[k]).filter(v => v != null && String(v).trim() && String(v).trim() !== 'なし')
    .map(v => String(v)).join('\n').toLowerCase();
}

// 検索結果の並び順（name: 同じ名称ごと／no: カードNo順／lv: Lv順／cost: コスト順）。このブラウザに覚えておく
let sortMode = 'name';
try { sortMode = localStorage.getItem('builder-sort') || 'name'; } catch (_) {}
window.setSortMode = function(mode) {
  sortMode = mode || 'name';
  try { localStorage.setItem('builder-sort', sortMode); } catch (_) {}
  filterCards();
};
function _numOr(v, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; }
// 並べ替え。元の並び（カードNo順）を基準にし、同じ値の中では元の順を保つ。
// 「同じ名称ごと」は、名称が最初に出てくる位置の順に、その名称のカードをまとめて並べる
function sortResults(list) {
  const base = list.map((c, i) => ({ c, i }));
  const nameKey = (c) => String(c["名前"] || '');
  if (sortMode === 'no') return list;
  if (sortMode === 'name') {
    const firstIdx = {};
    base.forEach(({ c, i }) => { const k = nameKey(c); if (!(k in firstIdx)) firstIdx[k] = i; });
    return base.sort((a, b) => (firstIdx[nameKey(a.c)] - firstIdx[nameKey(b.c)]) || (a.i - b.i)).map(x => x.c);
  }
  const valOf = sortMode === 'lv'
    ? (c) => _numOr(c["レベル"] != null && c["レベル"] !== '' ? c["レベル"] : c["Lv"], 99) // Lvの無いテイマー・オプションは後ろ
    : (c) => _numOr(String(c["タイプ"]) === 'オプション' ? c["使用コスト"] : c["登場コスト"], 99);
  return base.sort((a, b) => (valOf(a.c) - valOf(b.c)) || nameKey(a.c).localeCompare(nameKey(b.c), 'ja') || (a.i - b.i)).map(x => x.c);
}

window.filterCards = function() {
  const input = document.getElementById('s-input').value.toLowerCase();
  const feature = document.getElementById('s-feature').value.toLowerCase();
  // 何も絞り込んでいないときは全件を出さず、案内だけ表示する
  const hasFilter = input.trim() || feature.trim() || selectedColors.length || selectedLevels.length || selectedTypes.length;
  if (!hasFilter) {
    if (resultObserver) resultObserver.disconnect();
    resultList = [];
    renderedCount = 0;
    document.getElementById('search-results').innerHTML =
      '<div class="search-guide">左の絞り込み（キーワード・色・レベル・タイプ・特徴）でカードを検索してください</div>';
    return;
  }
  const filtered = allCards.filter(c => {
    // トークンはデッキに入れられないので検索結果から除外
    if (String(c["タイプ"]) === 'トークン') return false;
    // 挙動確認済み（カード情報一覧の「挙動OK」にチェック）のカードだけを出す
    if (!isBehaviorOk(c)) return false;
    const targetText = (searchMode === 'name')
      ? (String(c["名前"]) + String(c["カードNo"])).toLowerCase()
      : descriptionText(c);
    const matchText = targetText.includes(input);
    const matchFeature = String(c["特徴"]).toLowerCase().includes(feature);
    const matchColor = selectedColors.length === 0 || selectedColors.some(col => String(c["色"]).includes(col));
    const matchLevel = selectedLevels.length === 0 || selectedLevels.some(lv => String(c["レベル"]) === lv);
    const matchType = selectedTypes.length === 0 || selectedTypes.some(t => String(c["タイプ"]) === t);
    return matchText && matchFeature && matchColor && matchLevel && matchType;
  });
  renderResults(sortResults(filtered));
};

// 検索結果は一度に全件描画せず、PAGE_SIZE 件ずつ追加する。
// 全件分の <img> を一斉に作ると Drive サムネイルへのリクエストが千件単位で詰まり、表示が遅くなるため。
// 末尾の番兵要素が見えたら次のページを追加する（IntersectionObserver）。
const PAGE_SIZE = 60;
let resultList = [];
let renderedCount = 0;
let resultObserver = null;

function thumbHtml(c) {
  const safeId = c["カードNo"].replace(/[^a-z0-9]/gi, '');
  const imgUrl = getCardImageUrl(c);
  return `<div class="card-thumb" onclick="showPreview('${c["カードNo"]}')">
      <div id="img-box-${safeId}">${imgUrl ? `<img src="${imgUrl}" loading="lazy" decoding="async" style="width:100%">` : '<div style="height:100px; background:#111;"></div>'}</div>
      <div style="font-size:9px; color:#555; margin-top:3px;">${c["カードNo"]}</div>
    </div>`;
}

function renderNextPage() {
  const sentinel = document.getElementById('search-results-sentinel');
  const next = resultList.slice(renderedCount, renderedCount + PAGE_SIZE);
  if (next.length === 0) return;
  sentinel.insertAdjacentHTML('beforebegin', next.map(thumbHtml).join(''));
  renderedCount += next.length;
  if (renderedCount >= resultList.length) sentinel.remove();
}

function renderResults(list) {
  const res = document.getElementById('search-results');
  resultList = list;
  renderedCount = 0;
  if (resultObserver) resultObserver.disconnect();
  const panel = res.closest('.center-panel');
  if (panel) panel.scrollTop = 0;
  // 件数の行の右側に並べ替えのボタン（押した並び順で並べ直す）
  const _sortOpts = [['name', '名称ごと'], ['no', 'カードNo'], ['lv', 'Lv'], ['cost', 'コスト']];
  const _sortBtns = _sortOpts.map(([k, l]) =>
    `<button type="button" class="sort-btn${sortMode === k ? ' active' : ''}" aria-pressed="${sortMode === k}" onclick="setSortMode('${k}')">${l}</button>`).join('');
  res.innerHTML = `<div class="search-hit-bar"><span class="search-hit-count">${list.length}件</span>`
    + `<span class="sort-bar"><span class="sort-label">並べ替え</span>${_sortBtns}</span></div><div id="search-results-sentinel"></div>`;
  renderNextPage();
  const sentinel = document.getElementById('search-results-sentinel');
  if (!sentinel) return;
  if (!('IntersectionObserver' in window)) {
    // 古いブラウザは従来どおり全件描画
    while (renderedCount < resultList.length) renderNextPage();
    return;
  }
  resultObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) renderNextPage();
  }, { rootMargin: '600px 0px' });
  resultObserver.observe(sentinel);
}

window.showPreview = function(id) {
  const card = allCards.find(c => c["カードNo"] === id);
  if (!card) return;
  zoomScale = 1;
  document.getElementById('preview-img').style.transform = 'scale(1)';
  document.getElementById('preview-img').src = getCardImageUrl(card) || '';
  const titleEl = document.getElementById('preview-title');
  titleEl.innerText = `${card["名前"]} (${card["カードNo"]})`;
  // 特徴行（特徴指定の進化等でよく参照するため）
  let featEl = document.getElementById('preview-feature');
  if (!featEl) {
    featEl = document.createElement('div');
    featEl.id = 'preview-feature';
    featEl.style.cssText = 'margin:-10px 0 12px 0; font-size:0.9rem; color:#ffcc66;';
    titleEl.parentNode.insertBefore(featEl, titleEl.nextSibling);
  }
  const feat = String(card["特徴"] || '').trim();
  featEl.innerText = (feat && feat !== 'なし' && feat !== '-') ? '特徴：' + feat : '';
  featEl.style.display = featEl.innerText ? 'block' : 'none';
  // 効果（メイン効果／進化元効果。デュアルカードの下段はオプション効果、リンクカードはリンク効果）とセキュリティ効果
  const sections = previewEffectSections(card);
  document.getElementById('effect-preview-area').innerHTML = sections.length
    ? sections.map(s => `<div class="effect-item"><span class="effect-label">${escHtml(s.label)}</span><div class="effect-text">${effectTextHtml(s.text)}</div></div>`).join('')
    : '<div class="effect-item"><div class="effect-text" style="color:#666;">効果なし</div></div>';
  // キーワード効果の説明は、効果の文の中のキーワード（ボタン）を押したときに小さなボックスで出す（showKeywordPopover）
  const _kwWrap = document.getElementById('keyword-preview-wrap');
  if (_kwWrap) _kwWrap.style.display = 'none';
  hideKeywordPopover();
  previewCardId = id;
  renderQtyButtons(id);
  updateQtyMsg(id);
  document.getElementById('card-preview-window').style.display = 'block';
};

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const _noText = (v) => { const t = String(v == null ? '' : v).trim(); return !t || t === 'なし' || t === '-'; };
// カード詳細に出す効果の欄。下段（進化元効果の欄）は、デュアルカードならオプション効果、リンクカードならリンク効果
function previewEffectSections(card) {
  const out = [];
  const isDual = String(card["タイプ"]) === 'デュアル';
  const isLink = !_noText(card["リンク条件"]) || !_noText(card["リンクDP"]);
  if (!_noText(card["効果"])) out.push({ label: 'メイン効果', text: String(card["効果"]).trim() });
  if (!_noText(card["進化元効果"])) out.push({ label: isDual ? 'オプション効果' : isLink ? 'リンク効果' : '進化元効果', text: String(card["進化元効果"]).trim() });
  if (!_noText(card["セキュリティ効果"])) out.push({ label: 'セキュリティ効果', text: String(card["セキュリティ効果"]).trim() });
  return out;
}
// カードの文に書かれているキーワード（【〇〇】≪〇〇≫《〇〇》。数値つき【1ドロー】【リカバリー+1】【Sアタック+1】等も）の説明を
// キーワード辞書（window.keywordEffects）から引く。辞書の見出しとカードの書き方が違うものは別名で引く
const KEYWORD_ALIASES = { 'セキュリティアタック': ['Sアタック', 'セキュリティアタック'] };
function keywordsInText(text) {
  const dict = Array.isArray(window.keywordEffects) ? window.keywordEffects : [];
  const t = String(text || '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return dict.filter(k => {
    const names = KEYWORD_ALIASES[k.keyword] || [k.keyword];
    return names.some(n => new RegExp('[【≪《][0-9０-９]*' + esc(n)).test(t));
  });
}

// 効果の文を HTML にする。キーワード辞書にあるキーワード（【〇〇】≪〇〇≫《〇〇》。数値つきも）はボタンにし、押すと説明を出す
function _keywordEntryFor(inner) {
  const dict = Array.isArray(window.keywordEffects) ? window.keywordEffects : [];
  const t = String(inner || '').replace(/^[0-9０-９]+/, '');
  let best = null;
  dict.forEach(k => {
    (KEYWORD_ALIASES[k.keyword] || [k.keyword]).forEach(n => {
      // 一番長く一致する見出し（「マテリアルセーブ」を「セーブ」と取り違えない）
      if (t.startsWith(n) && (!best || n.length > best.len)) best = { k, len: n.length };
    });
  });
  return best ? best.k : null;
}
function effectTextHtml(text) {
  const s = String(text || '');
  const re = /([【≪《])([^】≫》\n]+)([】≫》])/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s)) !== null) {
    out += escHtml(s.slice(last, m.index));
    const k = _keywordEntryFor(m[2]);
    out += k
      ? `<button type="button" class="kw-chip" data-kw="${escHtml(k.keyword)}" onclick="showKeywordPopover(this, event)" aria-haspopup="dialog">${escHtml(m[0])}</button>`
      : escHtml(m[0]);
    last = m.index + m[0].length;
  }
  return out + escHtml(s.slice(last));
}
// キーワードの説明の小さなボックス（押したボタンの近くに出す。もう一度押す・外を押す・スクロールで閉じる）
function hideKeywordPopover() {
  const p = document.getElementById('kw-popover');
  if (p) p.remove();
}
window.showKeywordPopover = function(btn, ev) {
  if (ev) ev.stopPropagation();
  const name = btn && btn.getAttribute('data-kw');
  if (!btn.dataset.kwIdx) btn.dataset.kwIdx = String(Math.random()).slice(2, 10);
  const cur = document.getElementById('kw-popover');
  if (cur && cur.dataset.anchor === btn.dataset.kwIdx) { hideKeywordPopover(); return; }
  hideKeywordPopover();
  const dict = Array.isArray(window.keywordEffects) ? window.keywordEffects : [];
  const k = dict.find(x => x.keyword === name);
  if (!k) return;
  const p = document.createElement('div');
  p.id = 'kw-popover';
  p.setAttribute('role', 'dialog');
  p.dataset.anchor = btn.dataset.kwIdx;
  p.innerHTML = `<div class="kw-pop-name">【${escHtml(k.keyword)}】</div><div class="kw-pop-desc">${escHtml(k.description)}</div>`;
  document.body.appendChild(p);
  // 位置: ボタンの下（画面の下にはみ出すなら上）。左右は画面内に収める
  const r = btn.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 24);
  p.style.width = w + 'px';
  const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
  let top = r.bottom + 6;
  const h = p.offsetHeight;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  p.style.left = left + 'px';
  p.style.top = top + 'px';
};
document.addEventListener('click', (e) => {
  const p = document.getElementById('kw-popover');
  if (p && !p.contains(e.target)) hideKeywordPopover();
});
window.addEventListener('scroll', hideKeywordPopover, true);
window.addEventListener('resize', hideKeywordPopover);

let previewCardId = null; // 開いているカード詳細のカードNo
// カード詳細の枚数ボタン（0〜4）。押した数をこのカードの枚数にする（0＝デッキから外す）。今の枚数のボタンを光らせる
function renderQtyButtons(id) {
  const area = document.getElementById('qty-area');
  if (!area) return;
  const item = tempDeck.find(i => i.card["カードNo"] === id);
  const cur = item ? item.count : 0;
  area.innerHTML = [0, 1, 2, 3, 4].map(n =>
    `<button class="ctrl-btn qty-btn${n === cur ? ' active' : ''}" style="width:100%;" aria-pressed="${n === cur}" onclick="setDeckCount('${id}', ${n})">${n}</button>`
  ).join('');
}
window.setDeckCount = function(id, n) {
  const card = allCards.find(c => c["カードNo"] === id);
  if (!card) return;
  const limit = (card["効果"] || '').includes('50枚まで') ? 50 : 4;
  const item = tempDeck.find(i => i.card["カードNo"] === id);
  const cur = item ? item.count : 0;
  const diff = n - cur;
  if (diff === 0) return;
  if (diff > 0) {
    // 4枚制限は「カードNoの _ より前」が同じカード（絵違い）を合算して判定
    if (baseDeckCount(id) + diff > limit) return alert(`最大 ${limit} 枚までです（絵違い合計）`);
    if (String(card["レベル"]) === '2') {
      const tamaTotal = tempDeck.filter(i => String(i.card["レベル"]) === '2').reduce((s, i) => s + i.count, 0);
      if (tamaTotal + diff > 5) return alert('デジタマデッキは最大5枚までです');
    }
  }
  if (n <= 0) tempDeck = tempDeck.filter(i => i.card["カードNo"] !== id);
  else if (item) item.count = n;
  else tempDeck.push({ card, count: n });
  updateDeckUI();
  updateQtyMsg(id);
  renderQtyButtons(id);
};

window.hidePreview = function() {
  hideKeywordPopover();
  document.getElementById('card-preview-window').style.display = 'none';
};

// カードNoの「_」より前（絵違いをまとめた基準ID）。例: BT1-087_P → BT1-087
function baseCardNo(id) { return String(id || '').split('_')[0]; }
// tempDeck 内で baseCardNo が一致するカード（絵違い含む）の合計枚数
function baseDeckCount(id) {
  const b = baseCardNo(id);
  return tempDeck.filter(i => baseCardNo(i.card["カードNo"]) === b).reduce((s, i) => s + i.count, 0);
}

window.addToDeck = function(id, num, limit) {
  const card = allCards.find(c => c["カードNo"] === id);
  if (!card) return;
  const isTama = (String(card["レベル"]) === '2');
  let item = tempDeck.find(i => i.card["カードNo"] === id);
  // 4枚制限は「カードNoの _ より前」が同じカード（絵違い）を合算して判定
  const current = baseDeckCount(id);
  if (current + num > limit) return alert(`最大 ${limit} 枚までです（絵違い合計）`);
  if (isTama) {
    const tamaTotal = tempDeck.filter(i => String(i.card["レベル"]) === '2').reduce((s, i) => s + i.count, 0);
    if (tamaTotal + num > 5) return alert('デジタマデッキは最大5枚までです');
  }
  if (item) item.count += num; else tempDeck.push({ card, count: num });
  updateDeckUI();
  updateQtyMsg(id);
};

function updateQtyMsg(id) {
  // 投入数は絵違い合算で表示（4枚制限と同じ基準）
  const msgEl = document.getElementById('current-qty-msg');
  if (msgEl) msgEl.innerText = `現在投入数: ${baseDeckCount(id)} 枚`;
}

window.changeQty = function(id, diff) {
  let item = tempDeck.find(i => i.card["カードNo"] === id);
  if (!item) return;
  const isTama = (String(item.card["レベル"]) === '2');
  const limit = (item.card["効果"] || '').includes('50枚まで') ? 50 : 4;
  // 4枚制限は絵違い合算で判定（カードNoの _ より前で集計）
  if (diff > 0 && baseDeckCount(id) + diff > limit) return;
  if (isTama && diff > 0) {
    const tamaTotal = tempDeck.filter(i => String(i.card["レベル"]) === '2').reduce((s, i) => s + i.count, 0);
    if (tamaTotal >= 5) return alert('デジタマデッキは最大5枚までです');
  }
  item.count += diff;
  if (item.count <= 0) tempDeck = tempDeck.filter(i => i.card["カードNo"] !== id);
  updateDeckUI();
  // 開いているカード詳細の枚数ボタン（0〜4）・投入数も合わせる
  if (previewCardId === id) { renderQtyButtons(id); updateQtyMsg(id); }
};

window.updateDeckUI = function() {
  let mainTotal = 0, tamaTotal = 0;
  const listArea = document.getElementById('deck-list-area');
  if (!listArea) return;
  // Lv ごと（デジタマ・Lv3〜7・テイマー・オプション）に分けて、カード画像＋枚数で並べる
  tempDeck.forEach(i => {
    if (String(i.card["レベル"]) === '2') tamaTotal += i.count; else mainTotal += i.count;
  });
  listArea.innerHTML = renderDeckByLevelHtml(tempDeck, {
    onImgClick: (i) => `showPreview('${i.card["カードNo"]}')`,
    thumbExtra: (i) => `<div class="deck-thumb-ctrl">
            <button onclick="changeQty('${i.card["カードNo"]}', -1)">−</button>
            <button onclick="changeQty('${i.card["カードNo"]}', 1)">＋</button>
          </div>`,
  });
  const lvBar = document.getElementById('deck-lv-bar');
  if (lvBar) lvBar.innerHTML = tempDeck.length ? renderLevelBarHtml(tempDeck) : '';
  const mainEl = document.getElementById('main-count');
  const tamaEl = document.getElementById('tama-count');
  if (mainEl) mainEl.innerText = mainTotal;
  if (tamaEl) tamaEl.innerText = tamaTotal;
};

// ===== 保存処理（GAS API） =====
window.showSaveScreen = function() {
  if (tempDeck.length === 0) return alert('空です');
  showScreen('save-settings-screen');
  if (window._editDeckName) document.getElementById('deck-name-input').value = window._editDeckName;
  document.getElementById('cover-select-area').innerHTML = tempDeck.map(i => {
    const imgUrl = i.card["ImageURL"] || '';
    const src = getCardImageUrl(i.card);
    return `<div onclick="selectCover(this, '${imgUrl}')" style="border:2px solid transparent; cursor:pointer;"><img src="${src}" style="width:100%"></div>`;
  }).join('');
};

window.selectCover = function(el, url) {
  document.querySelectorAll('#cover-select-area div').forEach(d => d.style.borderColor = 'transparent');
  el.style.borderColor = 'var(--main-cyan)';
  selectedCoverUrl = url;
};

window.handleSaveRequest = async function() {
  const name = document.getElementById('deck-name-input').value;
  const pw = currentSessionPassword;
  if (!name || !selectedCoverUrl) return alert('デッキ名とカバー画像を選択してください');
  if (!pw) return alert('合言葉が設定されていません。一度ログアウトして再ログインしてください');

  const btn = document.getElementById('save-confirm-btn');
  btn.disabled = true; btn.innerText = 'SAVING...';

  try {
    // 既存デッキチェック
    const checkResult = await gasPost('checkExistingDeck', { name, password: pw });
    const exists = checkResult.exists;

    if (exists) {
      if (!confirm('同じデッキ名と合言葉のデータが存在します。上書き保存しますか？')) {
        btn.disabled = false; btn.innerText = '保存を確定する';
        return;
      }
    }

    const list = tempDeck.map(i => `${i.card["名前"]}(${i.card["カードNo"]})x${i.count}`).join(',');

    const saveResult = await gasPost('saveDeck', {
      name, cover: selectedCoverUrl, list, password: pw, isUpdate: exists
    });

    // 保存できなかった（GAS のエラー）なら「保存が完了しました」を出さない
    if (!saveResult || saveResult.error || !/^SUCCESS/.test(String(saveResult.status || ''))) {
      throw new Error((saveResult && saveResult.error) || '保存できませんでした');
    }
    const isUpdate = saveResult.status === 'SUCCESS_UPDATE';
    document.getElementById('finish-status-title').innerText =
      isUpdate ? 'デッキの編集が完了しました' : 'デッキの保存が完了しました';
    document.getElementById('finish-deck-name').innerText = name;

    const coverCard = tempDeck.find(i => i.card["ImageURL"] === selectedCoverUrl);
    if (coverCard) {
      document.getElementById('finish-cover-img').src = getCardImageUrl(coverCard.card);
    } else {
      document.getElementById('finish-cover-img').src = getGoogleDriveDirectLink(selectedCoverUrl);
    }

    btn.disabled = false; btn.innerText = '保存を確定する';
    window._editDeckName = '';
    window._editPassword = '';
    showScreen('save-finish-screen');
  } catch (e) {
    alert('保存エラー: ' + e.message);
    btn.disabled = false; btn.innerText = '保存を確定する';
  }
};
