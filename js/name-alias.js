/**
 * name-alias.js — 「各名称『XXX』を含むものとしても扱う」ルールの共通ヘルパー
 *
 * EX12-041サンダーボールモン等、メイン効果欄に基本ルールとして印刷されている
 * 「各名称「XXX」を含むものとしても扱う。」を読み取り、名称参照系の判定（進化条件・
 * ターゲット選択・効果条件・リンク名称チェック等）すべてで「本来の名前」に加えて
 * XXXでも一致するようにする。カード個別のレシピ登録は不要（効果テキストに印刷された
 * 通りの文言を書くだけで、他のカードにも同じ仕組みがそのまま適用される）。
 */

const ALIAS_RE = /各名称「(.+?)」を含むものとしても扱う/g;

// カードのメイン効果（効果テキスト）から、このカードが「XXXとしても扱う」対象名を
// 全て抽出する（該当ルールが無ければ空配列）。
export function getNameAliases(card) {
  if (!card) return [];
  const text = String(card.effect || '');
  const aliases = [];
  let m;
  ALIAS_RE.lastIndex = 0;
  while ((m = ALIAS_RE.exec(text))) aliases.push(m[1]);
  return aliases;
}

// カードの名前（またはルールによるエイリアス名）が reqName に一致するか判定する。
// exact=true: 完全一致 / exact=false(またはundefined): 部分一致（includes）
export function cardHasName(card, reqName, exact) {
  if (!card || !reqName) return false;
  const test = exact ? (n => n === reqName) : (n => n.includes(reqName));
  if (test(String(card.name || ''))) return true;
  return getNameAliases(card).some(test);
}
