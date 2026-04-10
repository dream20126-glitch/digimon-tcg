// カードデータ・画像管理（GAS API版）
import { gasGet } from './firebase-config.js?v=20260410-3';

// グローバルキャッシュ
window.allCards = [];
window.keywords = [];
window.masterKeywords = [];
window.cardImages = {};

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

// カードデータ読み込み（GAS API経由 → スプレッドシート）
export async function loadCardAndKeywordData() {
  if (allCards.length > 0) return { cards: allCards, keywords };

  try {
    const data = await gasGet('getCards');

    if (data.error) {
      console.error('GAS API エラー:', data.error);
      return { cards: [], keywords: [] };
    }

    allCards = data.cards || [];
    keywords = data.keywords || [];
    masterKeywords = keywords;

    // 列名の正規化（新旧スプシ両対応）
    allCards.forEach(card => {
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
    });

    // 画像URLをキャッシュ
    allCards.forEach(card => {
      const url = card["ImageURL"] || '';
      if (url) {
        cardImages[card["カードNo"]] = getGoogleDriveDirectLink(url);
      }
    });

    console.log("Data Loaded:", allCards.length, "cards,", keywords.length, "keywords");
    return { cards: allCards, keywords };
  } catch (e) {
    console.error("カードデータ読み込みエラー:", e);
    return { cards: [], keywords: [] };
  }
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
