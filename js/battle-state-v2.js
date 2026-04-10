/**
 * battle-state.js — ゲーム状態管理
 *
 * bs（BattleState）オブジェクトの定義・初期化・メモリー管理
 * 全モジュールがimportして共有する
 */

// ===== ゲーム状態 =====
export const bs = {
  // ターン管理
  turn: 1,
  phase: 'standby',   // standby | unsuspend | draw | breed | main
  isPlayerTurn: true,
  isFirstTurn: true,
  memory: 0,           // +: 自分側、-: 相手側。0=自分のターン

  // プレイヤー
  player: createEmptySide(),
  ai: createEmptySide(),

  // 選択状態
  selHand: null,
  selSlot: null,
  attackingSlot: null,

  // 効果処理用
  _battleAborted: false,
  _pendingTurnEnd: false,
  _usedLimits: {},
  _securityBuffs: [],
};

// 片側のフィールド初期状態を生成
function createEmptySide() {
  return {
    deck: [],
    tamaDeck: [],
    hand: [],
    battleArea: [],      // 無制限（横スクロール）
    tamerArea: [],
    linkedCards: [],      // リンクカード用（将来）
    ikusei: null,         // 育成エリア（1枚）
    security: [],
    trash: [],
  };
}

// ===== メモリー定数 =====
export const MEM_MIN = -10;
export const MEM_MAX = 10;

// ===== ゲーム状態リセット =====
export function resetBattleState(playerFirst) {
  bs.turn = 1;
  bs.phase = 'standby';
  bs.isPlayerTurn = playerFirst;
  bs.isFirstTurn = true;
  bs.memory = 0;
  bs.selHand = null;
  bs.selSlot = null;
  bs.attackingSlot = null;
  bs._battleAborted = false;
  bs._pendingTurnEnd = false;
  bs._usedLimits = {};
  bs._securityBuffs = [];

  bs.player = createEmptySide();
  bs.ai = createEmptySide();
}

// ===== メモリー操作 =====

/**
 * メモリーを消費（登場/進化コスト）
 * @returns {boolean} ターンが終了するか（memory < 0）
 */
export function spendMemory(cost) {
  if (cost === 0) return false;
  bs.memory -= cost;
  return bs.memory < 0;  // 0はまだ自ターン、負でターン終了
}

/**
 * メモリーを増加（効果によるメモリー+N）
 */
export function addMemory(value) {
  bs.memory += value;
  // 上限/下限クランプ
  bs.memory = Math.max(MEM_MIN, Math.min(MEM_MAX, bs.memory));
}

/**
 * 手動ターン終了時のメモリー設定
 * 相手のメモリーは必ず3でスタート
 */
export function endTurnManual() {
  bs.memory = -3;  // 相手側3
}

/**
 * メモリーが相手側に入っているか
 * @returns {boolean}
 */
export function isMemoryOverflow() {
  return bs.memory < 0;
}

// ===== デッキ操作ヘルパー =====

/**
 * デッキからN枚ドロー
 * @returns {Array} ドローしたカード
 */
export function drawCards(side, count) {
  const s = bs[side];
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (s.deck.length > 0) {
      drawn.push(s.deck.splice(0, 1)[0]);
    }
  }
  s.hand.push(...drawn);
  return drawn;
}

/**
 * デッキが空か
 */
export function isDeckEmpty(side) {
  return bs[side].deck.length === 0;
}

// ===== カード操作ヘルパー =====

/**
 * バトルエリアにカードを配置
 * @returns {number} 配置されたスロットインデックス
 */
export function placeOnBattleArea(side, card) {
  const area = bs[side].battleArea;
  let slot = area.indexOf(null);
  if (slot === -1) {
    slot = area.length;
    area.push(null);
  }
  area[slot] = card;
  return slot;
}

/**
 * バトルエリアからカードを除去 → トラッシュへ
 */
export function removeFromBattleArea(side, slotIdx) {
  const card = bs[side].battleArea[slotIdx];
  if (!card) return null;
  bs[side].battleArea[slotIdx] = null;
  bs[side].trash.push(card);
  if (card.stack) card.stack.forEach(s => bs[side].trash.push(s));
  return card;
}

/**
 * 消滅処理
 */
export function destroyCard(side, slotIdx) {
  return removeFromBattleArea(side, slotIdx);
}

/**
 * バウンス（手札に戻す）
 */
export function bounceCard(side, slotIdx) {
  const card = bs[side].battleArea[slotIdx];
  if (!card) return null;
  bs[side].battleArea[slotIdx] = null;
  bs[side].hand.push(card);
  if (card.stack) card.stack.forEach(s => bs[side].trash.push(s));
  return card;
}
