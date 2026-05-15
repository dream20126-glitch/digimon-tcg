#!/usr/bin/env node
// スプシ → data/cards.json 同期スクリプト
// 使い方: node scripts/sync-cards.js
// 必要に応じて npm run sync-cards で叩けるように package.json に登録可
//
// GAS API から全カード情報を取得し data/cards.json に書き出す。
// 同時に version (UNIXタイムスタンプ) を埋め込んで、クライアント側で
// cache buster として利用する。

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxB3kIy-fSGrGfJm65RWaNxGGvpCeF0GqrqGitXT7yBRLZE9LtW-SbpOqydxTLgDKf8/exec';
const OUT_FILE = path.join(__dirname, '..', 'data', 'cards.json');
const VERSION_FILE = path.join(__dirname, '..', 'data', 'cards-version.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      // GAS は 302 リダイレクトすることがあるので follow
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchJson(res.headers.location));
      }
      // チャンクは Buffer のまま貯め、最後にまとめて UTF-8 デコードする。
      // 各チャンクを個別に toString() するとマルチバイト文字がチャンク境界で
      // 分断され U+FFFD に化けるため、必ず Buffer.concat してからデコードする。
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message + '\n' + data.slice(0, 500))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
  });
}

async function main() {
  console.log('[sync-cards] GAS からカード情報を取得中...');
  const start = Date.now();
  const url = GAS_URL + '?action=getCards';
  const data = await fetchJson(url);

  if (data.error) {
    console.error('[sync-cards] GAS エラー:', data.error);
    process.exit(1);
  }

  const cards = data.cards || [];
  const keywords = data.keywords || [];

  if (cards.length === 0) {
    console.error('[sync-cards] カード0件。スプシまたは GAS を確認してください');
    process.exit(1);
  }

  // クライアント側のフィールド正規化を事前に適用しておく（読み込み時の処理を軽くする）
  cards.forEach(card => {
    if (card['レベル'] === undefined && card['Lv'] !== undefined) card['レベル'] = card['Lv'];
    for (const key of Object.keys(card)) {
      const normalized = key.replace(/\n/g, '');
      if (normalized !== key && card[normalized] === undefined) card[normalized] = card[key];
    }
    if (!card['効果'] && card['効果テキスト']) card['効果'] = card['効果テキスト'];
    if (!card['進化元効果'] && card['進化元テキスト']) card['進化元効果'] = card['進化元テキスト'];
    if (!card['セキュリティ効果'] && card['セキュリティテキスト']) card['セキュリティ効果'] = card['セキュリティテキスト'];
    if (card['レシピ'] && typeof card['レシピ'] === 'string') card['レシピ'] = card['レシピ'].replace(/[\x00-\x1F\x7F]/g, '');
    if (card['効果レシピ'] && typeof card['効果レシピ'] === 'string') card['効果レシピ'] = card['効果レシピ'].replace(/[\x00-\x1F\x7F]/g, '');
    if (!card['効果レシピ'] && card['レシピ']) card['効果レシピ'] = card['レシピ'];
    if (!card['効果テキスト'] && card['効果']) card['効果テキスト'] = card['効果'];
    if (!card['進化元テキスト'] && card['進化元効果']) card['進化元テキスト'] = card['進化元効果'];
    if (!card['セキュリティテキスト'] && card['セキュリティ効果']) card['セキュリティテキスト'] = card['セキュリティ効果'];
    if (!card['レシピ'] && card['効果レシピ']) card['レシピ'] = card['効果レシピ'];
  });

  const version = String(Date.now());
  const out = {
    version,
    exportedAt: new Date().toISOString(),
    cardCount: cards.length,
    keywordCount: keywords.length,
    cards,
    keywords,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version, exportedAt: out.exportedAt, cardCount: cards.length }));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const sizeKB = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`[sync-cards] 完了 ${elapsed}s / ${cards.length} 枚 / ${sizeKB} KB`);
  console.log(`[sync-cards] version=${version}`);
  console.log(`[sync-cards] 出力: ${OUT_FILE}`);
  console.log(`[sync-cards] 次の手順: git add data/cards.json data/cards-version.json && git commit && git push`);
}

main().catch(e => {
  console.error('[sync-cards] エラー:', e);
  process.exit(1);
});
