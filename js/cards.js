// カードデータ・画像管理
// 読み込み戦略:
//   1) data/cards.json (静的) → 50-300ms
//   2) localhost なら GAS API (常時最新) → 1-5s
//   3) 静的が無ければ GAS にフォールバック
import { gasGet } from './firebase-config.js';

// グローバルキャッシュ
window.allCards = [];
window.keywords = [];
window.masterKeywords = [];
window.cardImages = {};

// 静的 JSON のパス（リポジトリルート相対）
const CARDS_JSON_PATH = 'data/cards.json';

// localhost / file:// は開発モード扱い（GAS 直 → 常に最新）
function isDevMode() {
  if (typeof window === 'undefined') return false;
  const h = window.location && window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '' || (window.location && window.location.protocol === 'file:');
}

// data/cards-version.json からバージョン文字列を取得（cache buster用）。
// 取得できなければ Date.now() をフォールバックに使う（キャッシュは効かないが動作はする）
let _cachedVersionParam = null;
async function getVersionParam() {
  if (_cachedVersionParam) return _cachedVersionParam;
  try {
    const vRes = await fetch('data/cards-version.json?_=' + Date.now(), { cache: 'no-store' });
    if (vRes.ok) {
      const v = await vRes.json();
      if (v && v.version) { _cachedVersionParam = '?v=' + v.version; return _cachedVersionParam; }
    }
  } catch (_) {}
  return '?v=' + Date.now();
}

// 静的 JSON から読み込み（version は cache buster として URL に付与）
async function loadFromStaticJson() {
  const versionParam = await getVersionParam();
  const url = CARDS_JSON_PATH + versionParam;
  const res = await fetch(url);
  if (!res.ok) throw new Error('static cards.json not found: ' + res.status);
  return await res.json();
}

// カード1件分の列名正規化（新旧スプシ両対応）。loadCardAndKeywordData / loadCardsByNo で共用
function normalizeCard(card) {
  // スプシのヘッダー改行・列名変更に対応
  // Lv → レベル
  if (card["レベル"] === undefined && card["Lv"] !== undefined) card["レベル"] = card["Lv"];
  // 「登場\nコスト」→「登場コスト」（セル内改行対応）
  // 「進化\nコスト」→「進化コスト」（セル内改行対応）
  for (const key of Object.keys(card)) {
    const normalized = key.replace(/\n/g, '');
    if (normalized !== key && card[normalized] === undefined) {
      card[normalized] = card[key];
    }
  }
  // 新列名 → 旧列名にコピー（parseDeckや他のコードが旧名を参照するため）
  if (!card["効果"] && card["効果テキスト"]) card["効果"] = card["効果テキスト"];
  if (!card["進化元効果"] && card["進化元テキスト"]) card["進化元効果"] = card["進化元テキスト"];
  if (!card["セキュリティ効果"] && card["セキュリティテキスト"]) card["セキュリティ効果"] = card["セキュリティテキスト"];
  // レシピの制御文字除去（スプシのセル内改行対策）
  if (card["レシピ"] && typeof card["レシピ"] === 'string') card["レシピ"] = card["レシピ"].replace(/[\x00-\x1F\x7F]/g, '');
  if (card["効果レシピ"] && typeof card["効果レシピ"] === 'string') card["効果レシピ"] = card["効果レシピ"].replace(/[\x00-\x1F\x7F]/g, '');
  if (!card["効果レシピ"] && card["レシピ"]) card["効果レシピ"] = card["レシピ"];
  // 旧列名 → 新列名にもコピー（逆方向の互換性）
  if (!card["効果テキスト"] && card["効果"]) card["効果テキスト"] = card["効果"];
  if (!card["進化元テキスト"] && card["進化元効果"]) card["進化元テキスト"] = card["進化元効果"];
  if (!card["セキュリティテキスト"] && card["セキュリティ効果"]) card["セキュリティテキスト"] = card["セキュリティ効果"];
  if (!card["レシピ"] && card["効果レシピ"]) card["レシピ"] = card["効果レシピ"];
  // キーワードコードの別名をエンジンが扱う正規コードへ置き換える（スプシ辞書の登録コードが
  // エンジンと食い違っているもの。例: 辞書「Sアタック+」= attack_plus → security_attack_plus）
  ["レシピ", "効果レシピ"].forEach((k) => {
    if (typeof card[k] === 'string' && card[k]) card[k] = normalizeRecipeKeywordAliases(card[k]);
  });
  return card;
}

// 辞書コード → エンジンの正規コード
export const KEYWORD_CODE_ALIASES = {
  attack_plus: 'security_attack_plus',
  attack_minus: 'security_attack_minus',
  Link_plus: 'link_plus',
  Execute: 'execute',
};
function normalizeKeywordCode(code) {
  return Object.prototype.hasOwnProperty.call(KEYWORD_CODE_ALIASES, code) ? KEYWORD_CODE_ALIASES[code] : code;
}
// レシピJSON文字列中の passive の flag / grant_keyword の keyword（カンマ区切り可）を正規化する。
// 解析できない文字列はそのまま返す
export function normalizeRecipeKeywordAliases(recipeStr) {
  let obj;
  try { obj = JSON.parse(recipeStr); } catch (_) { return recipeStr; }
  let changed = false;
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.flag === 'string') {
      const n = normalizeKeywordCode(v.flag);
      if (n !== v.flag) { v.flag = n; changed = true; }
    }
    if (typeof v.keyword === 'string' && v.keyword) {
      const n = v.keyword.split(',').map((s) => normalizeKeywordCode(s.trim())).join(',');
      if (n !== v.keyword) { v.keyword = n; changed = true; }
    }
    Object.values(v).forEach(walk);
  };
  walk(obj);
  return changed ? JSON.stringify(obj) : recipeStr;
}

// Google Drive URL → 直リンク変換（GAS経由Base64不要に）
export function getGoogleDriveDirectLink(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:')) return url;
  if (url.includes('drive.google.com/thumbnail')) return url;
  if (url.includes('lh3.googleusercontent.com')) return url;
  const match = url.match(/\/d\/([^/]+)/) || url.match(/id=([^&]+)/);
  if (match && match[1]) {
    // thumbnail形式なら認証不要で表示可能
    return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w400';
  }
  return url;
}

// カード画像URLを取得（Drive直リンク）
export function getCardImageUrl(card) {
  if (!card) return '';
  const cardNo = card["カードNo"] || card.cardNo;
  if (cardImages[cardNo]) return cardImages[cardNo];
  const url = card["ImageURL"] || card.imageUrl || '';
  const directUrl = getGoogleDriveDirectLink(url);
  if (directUrl) cardImages[cardNo] = directUrl;
  return directUrl;
}

// カードデータ読み込み（静的JSON優先 → GAS フォールバック）
export async function loadCardAndKeywordData() {
  if (allCards.length > 0) return { cards: allCards, keywords };

  let data = null;
  let source = '';

  // 1) 開発モード以外はまず静的 JSON を試す
  if (!isDevMode()) {
    try {
      data = await loadFromStaticJson();
      source = 'static (' + (data.exportedAt || '?') + ')';
    } catch (e) {
      console.warn('[cards] 静的 JSON 失敗、GAS にフォールバック:', e.message);
    }
  }

  // 2) フォールバック: GAS API
  if (!data) {
    try {
      data = await gasGet('getCards');
      source = 'GAS';
    } catch (e) {
      console.error('[cards] GAS API 失敗:', e);
      return { cards: [], keywords: [] };
    }
  }

  try {
    if (data.error) {
      console.error('カード読み込みエラー:', data.error);
      return { cards: [], keywords: [] };
    }

    allCards = data.cards || [];
    keywords = data.keywords || [];
    masterKeywords = keywords;

    // 列名の正規化（新旧スプシ両対応）
    allCards.forEach(normalizeCard);

    // 画像URLをキャッシュ
    allCards.forEach(card => {
      const url = card["ImageURL"] || '';
      if (url) {
        cardImages[card["カードNo"]] = getGoogleDriveDirectLink(url);
      }
    });

    console.log('[cards] Loaded:', allCards.length, 'cards,', keywords.length, 'keywords (source: ' + source + ')');
    return { cards: allCards, keywords };
  } catch (e) {
    console.error("カードデータ読み込みエラー:", e);
    return { cards: [], keywords: [] };
  }
}

// カードNo指定で、指定分だけをピンポイントで読み込む（バトル開始時・効果テスト実行時用）。
// カード数が将来大きく増えても、デッキ/シナリオに実際に使うカードだけを取得すれば
// 全件読み込みを避けられる。データ層は data/cards/<カードNo>.json（1枚1ファイル）を使う。
// 既に allCards に読み込み済みのカードは再取得しない（累積キャッシュとして使える）。
// dev モード（localhost）は個別ファイルが無い場合があるため、素直に全件読み込みに任せる。
export async function loadCardsByNo(cardNos) {
  const wanted = Array.from(new Set((cardNos || []).filter(Boolean)));
  if (wanted.length === 0) return { cards: allCards, keywords };

  if (isDevMode()) {
    // dev モードは GAS 直叩きの全件取得のみサポート（開発時は件数が少なく実害小さい）
    return await loadCardAndKeywordData();
  }

  const existingNos = new Set(allCards.map(c => c["カードNo"]));
  const missing = wanted.filter(no => !existingNos.has(no));
  if (missing.length === 0) return { cards: allCards, keywords };

  const versionParam = await getVersionParam();
  const results = await Promise.all(missing.map(async (no) => {
    try {
      const res = await fetch('data/cards/' + encodeURIComponent(no) + '.json' + versionParam);
      if (!res.ok) { console.warn('[cards] カード「' + no + '」が見つかりません (' + res.status + ')'); return null; }
      return await res.json();
    } catch (e) {
      console.warn('[cards] カード「' + no + '」の取得に失敗:', e.message);
      return null;
    }
  }));

  results.filter(Boolean).forEach(card => {
    normalizeCard(card);
    const url = card["ImageURL"] || '';
    if (url) cardImages[card["カードNo"]] = getGoogleDriveDirectLink(url);
    allCards.push(card);
  });

  console.log('[cards] loadCardsByNo: ' + missing.length + '件要求 → ' + results.filter(Boolean).length + '件取得（allCards合計 ' + allCards.length + '件）');
  return { cards: allCards, keywords };
}

// カード画像を表示用のHTMLとして返す
export function cardImageHtml(card, style = 'width:100%') {
  const url = getCardImageUrl(card);
  if (url) return `<img src="${url}" style="${style}" onerror="this.style.display='none'">`;
  return '';
}

// 検索結果のサムネイルにカード画像を設定
export function loadCardImage(card, callback) {
  const cardNo = card["カードNo"];
  const safeId = cardNo.replace(/[^a-z0-9]/gi, '');
  const url = getCardImageUrl(card);
  if (url) {
    const el = document.getElementById(`img-box-${safeId}`);
    if (el) el.innerHTML = `<img src="${url}" style="width:100%">`;
    if (callback) callback(url);
  }
}

// カバー画像読み込み
export function loadCoverImage(url, imgEl) {
  if (!url) return;
  const directUrl = getGoogleDriveDirectLink(url);
  if (directUrl) imgEl.src = directUrl;
}
