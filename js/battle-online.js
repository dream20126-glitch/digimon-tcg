/**
 * battle-online.js — Firebase Realtime DB オンライン同期
 *
 * コマンド送受信・状態同期・ブロック応答・演出同期
 * オフライン（AI対戦）時は全関数がno-opで安全
 */

import { bs } from './battle-state.js';
import { addLog, showScreen } from './battle-ui.js';
import { renderAll, updateMemGauge, cardImg } from './battle-render.js';
import { rtdb, ref, set, onValue, remove } from './firebase-config.js';
import { applyBattleBuffs, removeBattleBuffs } from './battle-combat.js';

// ===== オンライン状態 =====
let _onlineMode = false;
let _onlineRoomId = null;
let _onlineMyKey = null;       // 'player1' | 'player2'
let _onlineCmdListener = null; // Firebaseリスナー解除関数
let _onlineCmdSeq = 0;         // 自分の送信専用連番（受信側のしきい値とは完全に分離する）
// 送信者ごとの受信済み連番しきい値（重複排除用）。かつては_onlineCmdSeq 1変数を送信/受信
// 両方に使い回していたため、双方が相手の最新連番を受信する前に連続送信すると同じ
// Firebaseパス（rooms/{roomId}/commands/{seq}）に書き込んで片方が消えることがあった。
// 送信者ごとにパス(commands/{fromKey}/{seq})と連番空間を完全に分離して解消する。
let _lastSeqBySender = {};

// commands ノード（送信者ごとにネストされた {fromKey: {seq: cmd}} 構造）を
// フラットなコマンド配列に変換する
function _flattenCommandsSnapshot(bySender) {
  const all = [];
  if (!bySender) return all;
  Object.keys(bySender).forEach((fromKey) => {
    const cmdsForSender = bySender[fromKey];
    if (!cmdsForSender) return;
    Object.values(cmdsForSender).forEach((cmd) => { if (cmd) all.push(cmd); });
  });
  return all;
}
let _pendingBlockCallback = null;
let _pendingBlockResponse = null;
let _pendingSecEffectCallback = null;
let _pendingSecEffectResponse = null;
let _pendingReactionDelegateCallback = null;
let _pendingReactionDelegateResponse = null;
let _pendingOwnDestroyFire = null; // card_removed受信済みだがon_destroy発火待ちのカード（1件分）
let _nonTurnPlayerReactionDraining = false; // bs._pendingNonTurnPlayerReactionsを順に発揮中かどうか
let _deferStuckWatchdog = null; // active:false未受信のまま保留し続けるのを防ぐフェイルセーフタイマー

// 非ターンプレイヤー側の発揮待ち効果（セキュリティで登場したカードの登場時、消滅時等）を
// 1件ずつ順番に発揮する（公式ルール15-4-4「発揮待ち」）。テイマーの登場時効果ポップアップの
// 上に消滅時効果ポップアップが重なって表示されるのを防ぐため、fx_ownDestroyReady側も
// この同じ待ち行列を経由させ、既に発揮中の効果が終わるまで割り込ませない。
function _drainNonTurnPlayerReactionQueue() {
  const queueLenAtCall = (bs._pendingNonTurnPlayerReactions || []).length;
  if (_nonTurnPlayerReactionDraining) {
    if (queueLenAtCall > 0) console.warn('[_drainNonTurnPlayerReactionQueue] 既に排出中のためスキップ (queue=' + queueLenAtCall + ')');
    return;
  }
  // まだターンプレイヤー側の同時誘発が解決中（active:trueの間）は、ここでは発揮を開始しない。
  // active:false受信時に改めてこの関数が呼ばれて排出される
  if (bs._deferNonTurnPlayerTriggers) {
    if (queueLenAtCall > 0) console.warn('[_drainNonTurnPlayerReactionQueue] active:false待ちのためスキップ (queue=' + queueLenAtCall + ')');
    // フェイルセーフ: active:false受信の見逃し等でここが永久にブロックされないよう、
    // 一定時間後に強制的に保留を解除して排出する（本来は fx_deferOppNonTurnPlayerTriggers
    // の active:false 受信で解除されるのが正常系）
    if (!_deferStuckWatchdog) {
      _deferStuckWatchdog = setTimeout(() => {
        _deferStuckWatchdog = null;
        if (bs._deferNonTurnPlayerTriggers) {
          console.warn('[_drainNonTurnPlayerReactionQueue] active:false未受信のまま10秒経過 → 強制解除');
          bs._deferNonTurnPlayerTriggers = false;
          _drainNonTurnPlayerReactionQueue();
        }
      }, 10000);
    }
    return;
  }
  _nonTurnPlayerReactionDraining = true;
  const step = () => {
    const queue = bs._pendingNonTurnPlayerReactions;
    if (!queue || queue.length === 0) {
      _nonTurnPlayerReactionDraining = false;
      // 相手機に委譲された消滅時効果等（memory_plus等でbs._pendingTurnEndが立つ場合が
      // ある）が、通常のcheckPendingTurnEnd呼び出し地点より後にここで解決することがある。
      // キューが完全に空になったこのタイミングで改めて判定し、ターン終了の持ち越しを防ぐ
      if (bs._pendingTurnEnd && window._checkPendingTurnEndOnly) {
        try { window._checkPendingTurnEndOnly(); } catch (_) {}
      }
      return;
    }
    const fn = queue.shift();
    try { fn(step); } catch (e) { console.error('[_drainNonTurnPlayerReactionQueue] 反応実行中に例外', e); step(); }
  };
  step();
}

// 最近消滅したスロットの追跡（state_syncによるカード復活を防止）
// { side: 'ai'|'player', slotIdx: number, time: number }
let _recentlyDestroyed = [];
const DESTROY_COOLDOWN = 5000; // 5秒間はstate_syncでの復活を無視

function markDestroyed(side, slotIdx) {
  _recentlyDestroyed.push({ side, slotIdx, time: Date.now() });
  // 古いエントリを削除
  _recentlyDestroyed = _recentlyDestroyed.filter(d => Date.now() - d.time < DESTROY_COOLDOWN);
}

function isRecentlyDestroyed(side, slotIdx) {
  return _recentlyDestroyed.some(d => d.side === side && d.slotIdx === slotIdx && Date.now() - d.time < DESTROY_COOLDOWN);
}

// 最近進化元が変更されたスロットの追跡（state_syncによる復元を防止）
let _recentlyEvoModified = [];
const EVO_MOD_COOLDOWN = 5000;

function markEvoModified(side, slotIdx) {
  _recentlyEvoModified.push({ side, slotIdx, time: Date.now() });
  _recentlyEvoModified = _recentlyEvoModified.filter(d => Date.now() - d.time < EVO_MOD_COOLDOWN);
}

function isRecentlyEvoModified(side, slotIdx) {
  return _recentlyEvoModified.some(d => d.side === side && d.slotIdx === slotIdx && Date.now() - d.time < EVO_MOD_COOLDOWN);
}

// 最近suspended状態を変更したスロットの追跡（state_syncによる上書きを防止）
// { side, slotIdx, suspended, time }
let _recentlySuspendChanged = [];
const SUSPEND_COOLDOWN = 5000;

function markSuspendChanged(side, slotIdx, suspended) {
  _recentlySuspendChanged.push({ side, slotIdx, suspended, time: Date.now() });
  _recentlySuspendChanged = _recentlySuspendChanged.filter(d => Date.now() - d.time < SUSPEND_COOLDOWN);
}

function recentSuspendOverride(side, slotIdx) {
  const e = _recentlySuspendChanged.find(d => d.side === side && d.slotIdx === slotIdx && Date.now() - d.time < SUSPEND_COOLDOWN);
  return e ? e.suspended : null;
}

// 最近期限切れで削除されたバフの追跡（state_syncによる復元を防止）
let _recentlyExpiredBuffs = []; // {cardName, type, duration, time}
const BUFF_EXPIRE_COOLDOWN = 8000;

export function markBuffExpired(cardName, type, duration) {
  console.log('[buff-mark]', cardName, type, duration);
  _recentlyExpiredBuffs.push({ cardName, type, duration, time: Date.now() });
  _recentlyExpiredBuffs = _recentlyExpiredBuffs.filter(e => Date.now() - e.time < BUFF_EXPIRE_COOLDOWN);
}

function isBuffRecentlyExpired(cardName, type, duration) {
  const found = _recentlyExpiredBuffs.some(e => e.cardName === cardName && e.type === type && e.duration === duration && Date.now() - e.time < BUFF_EXPIRE_COOLDOWN);
  if (found) console.log('[buff-skip]', cardName, type, duration);
  return found;
}

// ===== 外部モジュール参照（battle.jsから注入） =====
let _modules = {
  showYourTurn: null,
  showPhaseAnnounce: null,
  startPhase: null,
  showPlayEffect: null,
  showEvolveEffect: null,
  showSecurityCheck: null,
  showBattleResult: null,
  showDestroyEffect: null,
  showDirectAttack: null,
  showOptionEffect: null,
  showBlockConfirm: null,
  showBlockerSelection: null,
  showGameEndOverlay: null,
  fxSAttackPlus: null,
  fxRemoteEffect: null,
  fxRemoteEffectClose: null,
  checkTurnStartEffects: null,
  applyPermanentEffects: null,
  expireBuffs: null,
};

/**
 * 外部モジュールの関数参照を注入
 */
export function setOnlineModules(modules) {
  Object.assign(_modules, modules);
}

// ===== 演出キュー（受信側で演出が並列起動してバチバチするのを防止） =====
let _fxQueue = [];
let _fxRunning = false;

function enqueueFx(fn) {
  _fxQueue.push(fn);
  if (!_fxRunning) drainFxQueue();
}

function drainFxQueue() {
  if (_fxQueue.length === 0) { _fxRunning = false; return; }
  _fxRunning = true;
  const fn = _fxQueue.shift();
  // 受信側の演出実行中はfxコマンド送信を抑制（ping-pong防止）
  window._suppressFxSend = true;
  // 演出と演出の間に小休止を入れ、立て続けに表示されないようにする。
  // 安全弁: fn が done を呼ばなくても一定時間で次へ進む（キュー停止防止）。
  let _advanced = false;
  const _advance = () => {
    if (_advanced) return;
    _advanced = true;
    clearTimeout(_safety);
    window._suppressFxSend = false;
    setTimeout(drainFxQueue, 280);
  };
  const _safety = setTimeout(_advance, 7000);
  fn(_advance);
}

// ===== 状態アクセサ =====
export function isOnlineMode() { return _onlineMode; }
export function getMyKey() { return _onlineMyKey; }
export function getRoomId() { return _onlineRoomId; }

// ===== コマンド送信用カードシリアライザ =====
// card_removed 等で消滅カードのフル情報 (stack の recipe 含む) を相手機に送るためのヘルパー
function serializeCardForCmd(c) {
  if (!c) return null;
  const ser = (cc) => {
    if (!cc) return null;
    return {
      name: cc.name || '', cardNo: cc.cardNo || '',
      effect: cc.effect || '', evoSourceEffect: cc.evoSourceEffect || '',
      securityEffect: cc.securityEffect || '',
      recipe: cc.recipe || null,
      imgSrc: cc.imgSrc || cc.imageUrl || '',
      dp: cc.dp || 0, level: cc.level || '',
      color: cc.color || '', feature: cc.feature || '',
      type: cc.type || '',
      stack: (cc.stack || []).map(ser),
      buffs: cc.buffs || [],
      _permEffects: cc._permEffects || {},
    };
  };
  return ser(c);
}

// ===== コマンド送信 =====

export function sendCommand(cmd) {
  if (!_onlineMode || !_onlineRoomId) return;
  _onlineCmdSeq++;
  // 送信者ごとに独立したパス・連番空間に書き込むため、相手と同時に送信しても衝突しない
  const path = `rooms/${_onlineRoomId}/commands/${_onlineMyKey}/${_onlineCmdSeq}`;
  set(ref(rtdb, path), { ...cmd, from: _onlineMyKey, seq: _onlineCmdSeq, time: Date.now() });
}

export function sendStateSync() {
  if (!_onlineMode) return;
  const safeNum = (v) => (v === undefined || v === null || isNaN(v)) ? 0 : v;
  const serializeCard = (c) => {
    if (!c) return null;
    return {
      cardNo: c.cardNo || '', name: c.name || '', type: c.type || '', level: c.level || '',
      dp: safeNum(c.dp), baseDp: safeNum(c.baseDp), dpModifier: safeNum(c.dpModifier),
      cost: safeNum(c.cost), playCost: c.playCost !== null ? safeNum(c.playCost) : null,
      evolveCost: c.evolveCost !== null ? safeNum(c.evolveCost) : null,
      effect: c.effect || '', evoSourceEffect: c.evoSourceEffect || '', securityEffect: c.securityEffect || '',
      suspended: !!c.suspended, summonedThisTurn: !!c.summonedThisTurn,
      cantAttack: !!c.cantAttack, cantBlock: !!c.cantBlock, cantEvolve: !!c.cantEvolve,
      imgSrc: c.imgSrc || '', imageUrl: c.imageUrl || '', color: c.color || '', feature: c.feature || '', isLink: !!c.isLink,
      evolveCond: c.evolveCond || '', buffs: c.buffs || [],
      stack: (c.stack || []).map(serializeCard),
      recipe: c.recipe || null,
      _permEffects: c._permEffects || {}, _usedEffects: c._usedEffects || [],
      _isToken: !!c._isToken,
    };
  };
  sendCommand({
    type: 'state_sync',
    state: {
      battleArea: bs.player.battleArea.map(serializeCard),
      tamerArea: bs.player.tamerArea.map(serializeCard),
      ikusei: serializeCard(bs.player.ikusei),
      handCount: bs.player.hand.length,
      deckCount: bs.player.deck.length,
      trashCount: bs.player.trash.length,
      trashCards: bs.player.trash.map(serializeCard),
      securityCount: bs.player.security.length,
      oppSecurityCount: bs.ai.security.length,
      oppDeckCount: bs.ai.deck.length,
      oppTrashCount: bs.ai.trash.length,
      oppBattleArea: bs.ai.battleArea.map(serializeCard),
      oppTamerArea: bs.ai.tamerArea.map(serializeCard),
      memory: bs.memory,
      securityBuffs: (bs._securityBuffs || []).filter(b => b.owner === 'player'),
    },
  });
}

export function sendMemoryUpdate() {
  if (!_onlineMode) return;
  sendCommand({ type: 'memory_update', memory: bs.memory });
}

// ===== Firebaseリスナー =====

export function startOnlineListener() {
  if (_onlineCmdListener) _onlineCmdListener();
  const startTime = Date.now();
  _lastSeqBySender = {};
  _onlineCmdListener = onValue(ref(rtdb, `rooms/${_onlineRoomId}/commands`), (snap) => {
    const bySender = snap.val();
    if (!bySender) return;
    _flattenCommandsSnapshot(bySender)
      .filter(cmd => cmd.from !== _onlineMyKey)
      .sort((a, b) => a.seq - b.seq)
      .forEach(cmd => {
        const lastSeq = _lastSeqBySender[cmd.from] || 0;
        if (cmd.seq <= lastSeq) return;
        if (cmd.time && cmd.time < startTime) return;
        _lastSeqBySender[cmd.from] = cmd.seq;
        onRemoteCommand(cmd);
      });
  });
}

// ===== オンラインバトル開始 =====

export async function initOnline(roomId, myKey) {
  _onlineMode = true;
  _onlineRoomId = roomId;
  _onlineMyKey = myKey;
  _onlineCmdSeq = 0;
  _lastSeqBySender = {};
  _pendingBlockCallback = null;
  _pendingBlockResponse = null;
  _pendingSecEffectCallback = null;
  _pendingSecEffectResponse = null;
  _pendingReactionDelegateCallback = null;
  _pendingReactionDelegateResponse = null;
  _recentlyDestroyed = [];
  _fxQueue = [];
  _fxRunning = false;
  await set(ref(rtdb, `rooms/${_onlineRoomId}/commands`), null);
}

// ===== コマンド受信 =====

function onRemoteCommand(cmd) {
  if (!cmd || cmd.from === _onlineMyKey) return;
  const m = _modules;

  switch (cmd.type) {
    case 'mulligan': break;
    case 'acceptHand': break;
    case 'security_init': {
      // 相手のセキュリティ実データを受信 → bs.ai.securityを正しいデータで上書き
      if (cmd.cards && Array.isArray(cmd.cards)) {
        bs.ai.security = cmd.cards.map(c => ({ ...c, buffs: c.buffs || [], stack: c.stack || [] }));
        bs._aiSecuritySynced = true;
        console.log('[security_init] 相手セキュリティ同期:', bs.ai.security.length + '枚', bs.ai.security.map(c => c.name + '(' + c.type + ')'));
      }
      break;
    }

    // --- カード除去 ---
    case 'own_card_removed': {
      if (cmd.slotIdx !== undefined) {
        const card = bs.ai.battleArea[cmd.slotIdx];
        if (card) {
          bs.ai.battleArea[cmd.slotIdx] = null;
          bs.ai.trash.push(card);
          if (card.stack) card.stack.forEach(s => bs.ai.trash.push(s));
          if (card.linkedCards) card.linkedCards.forEach(s => bs.ai.trash.push(s));
          markDestroyed('ai', cmd.slotIdx);
          renderAll();
        }
      }
      break;
    }
    case 'card_removed': {
      if (cmd.zone === 'battle' && cmd.slotIdx !== undefined) {
        let card = bs.player.battleArea[cmd.slotIdx];
        if (card) {
          bs.player.battleArea[cmd.slotIdx] = null;
          if (cmd.reason === 'bounce') {
            bs.player.hand.push(card);
          } else {
            bs.player.trash.push(card);
          }
          if (card.stack) card.stack.forEach(s => bs.player.trash.push(s));
          if (card.linkedCards) card.linkedCards.forEach(s => bs.player.trash.push(s));
          markDestroyed('player', cmd.slotIdx);
          renderAll();
        }
        // 消滅 (destroy) の場合は on_destroy / on_battle_destroy / when_own_destroyed を
        // 自分側 (player) で発火する。受信側のローカルでカードが見つからないケース (同期ずれ等)
        // でも cmd.cardData にフルカード情報があれば、そちらを使って destroy chain を発火する。
        // タイマーによる推測発火はやめ、相手機からの fx_ownDestroyReady（on_battle_win等の
        // 解決完了後に送られる）を受け取ってから発火する。全ての card_removed(destroy) 送信元は
        // 対になる fx_ownDestroyReady も送るように統一済み。
        if (cmd.reason === 'destroy' && window._fireOnlineDestroyChain) {
          const cardForChain = card || cmd.cardData;
          if (cardForChain) {
            _pendingOwnDestroyFire = (afterDone) => {
              try {
                // on_destroy 完了時に盤面を同期（summon_from_trash 等で盤面が変化するケースがあるため）
                window._fireOnlineDestroyChain(['player'], { player: cardForChain }, () => { sendStateSync(); afterDone && afterDone(); });
              } catch (_) { afterDone && afterDone(); }
            };
          }
        }
      }
      break;
    }
    case 'waiting_close': {
      ['_block-wait-overlay', '_remote-effect-announce', '_remote-confirm-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      break;
    }

    // --- メモリー ---
    case 'memory_update': {
      if (cmd.memory !== undefined) {
        bs.memory = -cmd.memory;
        updateMemGauge();
        // 相手機での効果（ヴェノムヴァンデモンの進化元効果等）によりこちらのメモリーが
        // 相手側へ渡った場合、こちらが自分のターン中ならターン終了フラグを立てる。
        // ここは_memoryOverflow経由のprocessQueue完了処理を通らない別経路（ネットワーク
        // 経由でbs.memoryが変化する唯一の場所）なので、ここで直接判定する必要がある
        if (bs.isPlayerTurn && bs.memory < 0) bs._pendingTurnEnd = true;
      }
      break;
    }

    // --- カード操作 ---
    case 'play': {
      const cardName = cmd.cardName || '???';
      const dummy = { name: cardName, imgSrc: cmd.cardImg || '', type: cmd.cardType || '', playCost: cmd.playCost || 0 };
      addLog('🎮 相手が「' + cardName + '」を' + (cmd.cardType === 'オプション' ? '使用！' : '登場！'));
      if (cmd.cardType === 'オプション' && m.showOptionEffect) m.showOptionEffect(dummy, () => {});
      else if (m.showPlayEffect) m.showPlayEffect(dummy, () => {});
      break;
    }
    case 'evolve': {
      const dummyEvolved = { name: cmd.cardName || '???', imgSrc: cmd.cardImg || '', level: '', dp: 0 };
      const dummyBase = { name: cmd.baseName || '???', imgSrc: '' };
      addLog('🎮 相手が「' + cmd.baseName + '」→「' + cmd.cardName + '」に進化！');
      if (m.showEvolveEffect) m.showEvolveEffect(cmd.evolveCost || 0, cmd.baseName || '', dummyBase, dummyEvolved, () => {});
      break;
    }
    case 'hatch': {
      if (bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0) {
        bs.ai.ikusei = bs.ai.tamaDeck.splice(0, 1)[0];
      }
      renderAll();
      addLog('🎮 相手が「' + (cmd.cardName || '???') + '」を孵化！');
      break;
    }
    case 'breed_evolve': {
      const evoCard = bs.ai.hand[cmd.handIdx];
      if (evoCard && bs.ai.ikusei) {
        bs.ai.hand.splice(cmd.handIdx, 1);
        const old = bs.ai.ikusei;
        // stack[0] = 直前の進化形（top）, stack[N-1] = デジタマ（bottom）の規約に統一
        evoCard.stack = [old, ...(old.stack || [])];
        evoCard.suspended = old.suspended;
        evoCard.baseDp = parseInt(evoCard.dp) || 0;
        evoCard.dpModifier = 0; evoCard.buffs = [];
        bs.ai.ikusei = evoCard;
      }
      renderAll();
      addLog('🎮 相手が育成で「' + (cmd.baseName || '') + '」→「' + (cmd.cardName || '') + '」に進化！');
      if (m.showEvolveEffect) m.showEvolveEffect(cmd.evolveCost || 0, cmd.baseName || '', { name: cmd.baseName || '', imgSrc: '' }, { name: cmd.cardName || '', imgSrc: cmd.cardImg || '', level: '', dp: 0 }, () => {});
      break;
    }
    case 'breed_move': {
      if (bs.ai.ikusei) {
        let slot = bs.ai.battleArea.findIndex(s => s === null);
        if (slot === -1) { slot = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }
        bs.ai.battleArea[slot] = bs.ai.ikusei;
        bs.ai.ikusei = null;
      }
      renderAll();
      addLog('🎮 相手が「' + (cmd.cardName || '???') + '」をバトルエリアへ移動！');
      if (m.showYourTurn) m.showYourTurn('🐾 バトルエリアへ移動', cmd.cardName || '', '#00fbff', () => {});
      break;
    }

    // --- アタック ---
    case 'attack_security': {
      const atkName = cmd.atkName || '???';
      // 相手がアタックしたことを記録（cond_opp_no_attack_this_turn 判定用）
      bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
      addLog('🎮 相手の「' + atkName + '」でセキュリティアタック！');
      // ロゼモン(BT1-082) 等「相手のデジモンがプレイヤーにアタックしたとき」誘発 →
      // 完了後にブロック確認へ進む
      const _afterOppAtkTrig = () => { checkOnlineBlock(cmd); };
      const _runOppAtkTrig = () => {
        if (window._fireWhenOppAttack) {
          window._fireWhenOppAttack('ai', bs, null, _afterOppAtkTrig);
        } else { _afterOppAtkTrig(); }
      };
      if (m.showYourTurn) m.showYourTurn('⚔ 相手アタック！', '「' + atkName + '」→ セキュリティ', '#ff4444', _runOppAtkTrig);
      break;
    }
    case 'attack_digimon': {
      const atkName2 = cmd.atkName || '???';
      const defName2 = cmd.defName || '???';
      // 相手がアタックしたことを記録（cond_opp_no_attack_this_turn 判定用）
      bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
      addLog('🎮 相手の「' + atkName2 + '」が「' + defName2 + '」にアタック！');
      if (m.showYourTurn) m.showYourTurn('⚔ 相手アタック！', '「' + atkName2 + '」→「' + defName2 + '」', '#ff4444', () => { checkOnlineBlock(cmd); });
      break;
    }
    case 'security_remove': {
      if (bs.player.security.length > 0) {
        const removed = bs.player.security.splice(0, 1)[0];
        bs.player.trash.push(removed);
        addLog('🛡 セキュリティが減少（残り' + bs.player.security.length + '枚）');
        renderAll();
      }
      break;
    }
    case 'security_tamer_play': {
      // 相手がセキュリティからテイマーをめくった → セキュリティから除去してテイマーエリアに登場
      // セキュリティから該当テイマーを探して除去（見つからなければ先頭を除去）
      let tamerFromSec = null;
      const tIdx = bs.player.security.findIndex(c => c.name === cmd.cardName || c.cardNo === cmd.cardNo);
      if (tIdx !== -1) {
        tamerFromSec = bs.player.security.splice(tIdx, 1)[0];
      } else if (bs.player.security.length > 0) {
        tamerFromSec = bs.player.security.splice(0, 1)[0];
      }
      // テイマーカード（セキュリティの実データ or コマンドから復元）
      const tamer = tamerFromSec || {
        name: cmd.cardName || '???', cardNo: cmd.cardNo || '', type: 'テイマー',
        effect: cmd.effect || '', securityEffect: cmd.securityEffect || '',
        dp: cmd.dp || 0, level: cmd.level || '', color: cmd.color || '',
        feature: cmd.feature || '', isLink: !!cmd.isLink, imgSrc: cmd.cardImg || cmd.imgSrc || '',
        cost: cmd.cost || 0, playCost: cmd.playCost || 0,
        suspended: false, buffs: [], stack: [],
      };
      bs.player.tamerArea.push(tamer);
      addLog('👤 テイマー「' + tamer.name + '」がセキュリティから登場！');
      renderAll();
      // セキュリティから登場したテイマーの【登場時】効果を「所有者(自分)」の機械で発動。
      // （攻撃側ではなくカード所有者側で処理する。高石タケルの security_open 等は
      //   所有者だけがセキュリティ中身を見る非公開効果のため必須）
      let _stHasOnPlay = false;
      try {
        const _r = tamer.recipe
          ? (typeof tamer.recipe === 'string'
              ? JSON.parse(tamer.recipe.replace(/[\x00-\x1F\x7F]\s*/g, ''))
              : tamer.recipe)
          : null;
        _stHasOnPlay = !!(_r && _r.on_play);
      } catch (_) {}
      if (_stHasOnPlay && window._triggerEffectFn) {
        const _stCtx = { card: tamer, side: 'player', bs, addLog, renderAll: () => renderAll(), updateMemGauge: () => {} };
        const _ackSecTamerDone = () => {
          sendMemoryUpdate();
          sendStateSync();
          sendCommand({ type: 'security_effect_done', memory: bs.memory });
        };
        const _fireStOnPlay = (doneCb) => {
          try { window._triggerEffectFn('on_play', tamer, 'player', _stCtx, () => { renderAll(); _ackSecTamerDone(); doneCb && doneCb(); }); }
          catch (_) { _ackSecTamerDone(); doneCb && doneCb(); }
        };
        // 必ず非ターンプレイヤー側の待ち行列を経由させる（直接発火する分岐を持たない）。
        // ≪貫通≫等でまだターンプレイヤー側の同時誘発効果が解決していない場合は
        // _drainNonTurnPlayerReactionQueue側でactive:false受信まで排出を待つ（公式ルール
        // 15-4-3-3）。そうでない通常時は即座に排出される。これを経由しない「即時発火」の
        // 分岐が残っていると、後から届くfx_ownDestroyReady等が「発揮中の効果」を認識できず、
        // ポップアップが重ねて表示されてしまう。
        // 効果解決後にsecurity_effect_doneで攻撃側へackし、攻撃側の2枚目以降のセキュリティ
        // チェック（_waitForSecurityEffect待機）を進める。
        if (!bs._pendingNonTurnPlayerReactions) bs._pendingNonTurnPlayerReactions = [];
        bs._pendingNonTurnPlayerReactions.push((next) => _fireStOnPlay(next));
        _drainNonTurnPlayerReactionQueue();
      }
      break;
    }

    // --- ターン ---
    case 'endTurn': {
      bs.memory = cmd.memory !== undefined ? -cmd.memory : 3;
      bs.isFirstTurn = false;
      updateMemGauge();
      // 相手(ai)のターンが終わった → endingSide='ai'を明示
      if (m.expireBuffs) {
        m.expireBuffs('dur_this_turn', null, 'ai');
        m.expireBuffs('dur_next_opp_turn', null, 'ai');
        m.expireBuffs('dur_next_own_turn', null, 'ai');
      }
      // 自分のカードの「相手のターン終了時」効果を発火
      // scanTriggers が盤面全体（本体 + 進化元レシピ）をスキャンするので、
      // 任意の自分カードを source として triggerEffect を 1 度だけ呼ぶ
      const fireOppTurnEnd = (done) => {
        try {
          const te = window._triggerEffectFn;
          const anyOwn = (bs.player.battleArea || []).find(c => c)
            || (bs.player.tamerArea || []).find(c => c);
          if (te && anyOwn) {
            te('on_opp_turn_end', anyOwn, 'player', null, () => done());
            return;
          }
        } catch(_) {}
        done();
      };
      renderAll();
      // 効果処理完了 → 「相手のターン終了」演出 → 自分のターン開始
      fireOppTurnEnd(() => {
        if (m.showYourTurn) {
          m.showYourTurn('相手のターン終了', '', '#555555', () => {
            bs.isPlayerTurn = true;
            m.showYourTurn('自分のターン開始', '', '#00fbff', () => {
              const afterStart = () => {
                if (m.applyPermanentEffects) { m.applyPermanentEffects('player'); m.applyPermanentEffects('ai'); }
                renderAll();
                if (m.startPhase) setTimeout(() => m.startPhase('unsuspend'), 300);
              };
              if (m.checkTurnStartEffects) m.checkTurnStartEffects('player', afterStart);
              else afterStart();
            });
          });
        }
      });
      break;
    }
    case 'phase': {
      const PHASE_NAMES = { unsuspend: { icon: '🔄', name: 'アクティブフェイズ' }, draw: { icon: '🃏', name: 'ドローフェイズ' }, breed: { icon: '🥚', name: '育成フェイズ' }, main: { icon: '⚡', name: 'メインフェイズ' } };
      const PHASE_COLORS = { unsuspend: '#00fbff', draw: '#00ff88', breed: '#ff9900', main: '#ff00fb' };
      const info = PHASE_NAMES[cmd.phase];
      if (info && m.showPhaseAnnounce) m.showPhaseAnnounce(`${info.icon} 相手: ${info.name}`, PHASE_COLORS[cmd.phase], () => {});
      break;
    }

    // --- ブロック ---
    case 'block_response': {
      if (cmd.blocked) {
        const atkIdx = cmd.atkIdx;
        const atk = bs.player.battleArea[atkIdx];
        if (atk && (cmd.atkResult === 'destroyed' || cmd.atkResult === 'both_destroyed')) {
          bs.player.battleArea[atkIdx] = null;
          bs.player.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.player.trash.push(s));
          if (atk.linkedCards) atk.linkedCards.forEach(s => bs.player.trash.push(s));
          markDestroyed('player', atkIdx);
          renderAll();
        }
      }
      if (_pendingBlockCallback) {
        const cb = _pendingBlockCallback; _pendingBlockCallback = null; cb(cmd);
      } else {
        _pendingBlockResponse = cmd;
      }
      break;
    }

    // --- 貫通: 防御側でブロッカーが貫通持ちアタッカーに撃破された → 攻撃側が追加セキュリティチェック ---
    case 'penetrate_security_check': {
      const atk = bs.player.battleArea[cmd.atkIdx];
      if (atk && typeof window._resolveSecurityCheck === 'function') {
        addLog('🗡 「' + atk.name + '」の【貫通】効果でセキュリティチェック！');
        window._resolveSecurityCheck(atk, cmd.atkIdx);
      }
      break;
    }

    // --- 効果 ---
    case 'effect_start': {
      addLog('🎮 相手が「' + cmd.cardName + '」の効果を発動！');
      if (m.fxRemoteEffect) m.fxRemoteEffect(cmd.cardName, cmd.effectText);
      break;
    }
    case 'fx_confirmShow': {
      if (m.fxRemoteEffect) m.fxRemoteEffect(cmd.cardName, cmd.effectText || '');
      break;
    }
    case 'fx_confirmClose': {
      // ポップアップを消さずにテキストを更新（fx_effectAnnounceで上書きされるので消す必要なし）
      const remoteOv = document.getElementById('_remote-effect-announce');
      if (remoteOv) {
        const statusEl = remoteOv.querySelector('div[style*="color:#888"]');
        if (statusEl) statusEl.innerText = cmd.accepted ? '⚡ 相手が効果を発動中...' : '💨 効果を発動しませんでした';
        // 「いいえ」の場合は3秒後に消す
        if (!cmd.accepted) setTimeout(() => { if (m.fxRemoteEffectClose) m.fxRemoteEffectClose(); }, 3000);
      }
      break;
    }
    case 'fx_effectDeclined': {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);z-index:56000;background:rgba(30,30,40,0.9);border:1px solid #888;border-radius:10px;padding:12px 24px;color:#aaa;font-size:13px;font-weight:bold;text-align:center;pointer-events:none;animation:fadeIn 0.2s ease;';
      el.innerText = '💨 相手は「' + (cmd.cardName || '') + '」の効果を発動しませんでした';
      document.body.appendChild(el);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);
      break;
    }
    case 'activate_effect': {
      const card = bs.ai.battleArea[cmd.slotIdx];
      if (card) addLog('🎮 相手が「' + card.name + '」の効果を発動！');
      break;
    }
    case 'activate_tamer_effect': {
      const tamer = bs.ai.tamerArea[cmd.tamerIdx];
      if (tamer) addLog('🎮 相手がテイマー「' + tamer.name + '」の効果を発動！');
      break;
    }

    // --- セキュリティ効果委譲（防御側が処理する） ---
    case 'security_effect_request': {
      // 相手がアタック→自分のセキュリティからカードがめくれた→自分が効果を処理
      addLog('✦ セキュリティ効果：「' + cmd.cardName + '」');
      const secCard = {
        name: cmd.cardName, cardNo: cmd.cardNo || '', type: cmd.cardType || 'オプション',
        effect: cmd.effect || '', securityEffect: cmd.securityEffect || '',
        recipe: cmd.recipe || null, imgSrc: cmd.cardImg || '',
        dp: cmd.dp || 0, level: cmd.level || '', color: cmd.color || '', feature: cmd.feature || '', isLink: !!cmd.isLink,
        cost: cmd.cost || 0, playCost: cmd.playCost || 0,
        stack: [], buffs: [], suspended: false,
      };
      // セキュリティ効果はレシピ側 (recipe.security) で扱うため、
      // テキストマージは廃止。表示用に originalEffect は残す。
      const hasSecField = secCard.securityEffect && secCard.securityEffect.trim() && secCard.securityEffect !== 'なし';
      const originalEffect = secCard.effect || '';
      const afterEffect = () => {
        const mentionsMain = /このカードの\s*【メイン】\s*効果/.test(secCard.securityEffect || secCard.effect);
        const doFinish = () => {
          secCard.effect = originalEffect;
          // ヘブンズゲート/ヘブンズチャーム等: secCard._returnToHand が立っていれば
          // P2 のローカル状態でも、すでに security_remove でトラッシュに送られた実カードを
          // 探して手札へ戻す
          if (secCard._returnToHand) {
            const tIdx = bs.player.trash.findIndex(c =>
              c && (c.cardNo === (cmd.cardNo || secCard.cardNo) || c.name === (cmd.cardName || secCard.name))
            );
            if (tIdx !== -1) {
              const realCard = bs.player.trash.splice(tIdx, 1)[0];
              bs.player.hand.push(realCard);
              addLog('🃏 「' + realCard.name + '」を手札に加えた');
              renderAll();
            }
          }
          // メモリー変動を相手に通知 + 状態同期 + 処理完了通知
          sendMemoryUpdate();
          sendStateSync();
          sendCommand({ type: 'security_effect_done', memory: bs.memory, returnToHand: !!secCard._returnToHand });
        };
        const hasUseMain = secCard.recipe && typeof secCard.recipe === 'string' && secCard.recipe.includes('use_main_effect');
        if (mentionsMain && originalEffect.includes('【メイン】') && !hasUseMain) {
          secCard.effect = originalEffect;
          if (_modules.checkTurnStartEffects) {
            // checkAndTriggerEffectフック経由で処理
          }
          // メイン効果をトリガー
          const ctx = { card: secCard, side: 'player', bs, addLog, renderAll: () => renderAll(), updateMemGauge: () => {}, doDraw: () => {} };
          try {
            const te = window._triggerEffectFn;
            if (te) te('main', secCard, 'player', ctx, doFinish);
            else doFinish();
          } catch(_) { doFinish(); }
        } else { doFinish(); }
      };
      // セキュリティ効果を自分側(player)として処理
      const ctx = { card: secCard, side: 'player', bs, addLog, renderAll: () => renderAll(), updateMemGauge: () => {} };
      // 攻撃側に効果発動を通知
      sendCommand({ type: 'fx_effectAnnounce', cardName: secCard.name, effectText: '✦ ' + secCard.name + ' の効果発動！' });
      try {
        const te = window._triggerEffectFn;
        if (te) te('security', secCard, 'player', ctx, afterEffect);
        else afterEffect();
      } catch(_) { afterEffect(); }
      break;
    }
    case 'security_effect_done': {
      // アタック側：防御側のセキュリティ効果処理が完了した
      // メモリー反映（セキュリティ効果でメモリーが変動した場合）
      if (cmd.memory !== undefined) {
        bs.memory = -cmd.memory; // 相手のメモリーを反転して自分の値に
        updateMemGauge();
        // メモリーが相手側に渡った場合、アタック終了後にターン終了
        if (bs.memory < 0) {
          bs._pendingTurnEnd = true;
          addLog('💾 メモリーが相手側へ（アタック終了後にターン終了）');
        }
      }
      // ヘブンズゲート/ヘブンズチャーム等の「手札に戻る」セキュリティ効果用フラグ
      // doFinishSec がこのグローバルを参照して ai.hand vs ai.trash を判断する
      window._lastSecEffectReturnToHand = !!cmd.returnToHand;
      if (_pendingSecEffectCallback) {
        const cb = _pendingSecEffectCallback; _pendingSecEffectCallback = null; cb();
      } else {
        // 誰も待っていない状態で届いたack（例: セキュリティ最終チェックで登場したテイマーの
        // 【登場時】効果は、こちらは待たずに次へ進んでいるため）。waitForSecurityEffect呼び出し
        // 前にackが届く短い競合状態のためだけの一時フラグなので、無関係な将来のwaitForSecurityEffect
        // 呼び出しを誤って即完了させてしまわないよう、短時間で自動的に消す
        _pendingSecEffectResponse = true;
        setTimeout(() => { _pendingSecEffectResponse = null; }, 3000);
      }
      break;
    }

    // --- 反応系トリガー委譲（when_opp_rest等、相手が本当の持ち主のカードの効果） ---
    case 'fx_reactionDelegate': {
      // こちら（本当の持ち主）側で side='player' として本物のUIを操作し、
      // 完了したらメモリー等の変動を相手に返してあげる
      const ctx = { bs, addLog, renderAll, updateMemGauge };
      const done = () => {
        sendMemoryUpdate();
        sendStateSync();
        sendCommand({ type: 'fx_reactionDelegateDone' });
      };
      try {
        if (window._fireDelegatedReactionTriggers) window._fireDelegatedReactionTriggers(cmd.recipeKey, bs, ctx, done);
        else done();
      } catch (_) { done(); }
      break;
    }
    case 'fx_reactionDelegateDone': {
      // メモリー等の変動は直前に送られる memory_update/state_sync で既に反映されている
      if (_pendingReactionDelegateCallback) {
        const cb = _pendingReactionDelegateCallback; _pendingReactionDelegateCallback = null; cb();
      } else {
        // 誰も待っていない状態で届いたack。短い競合状態のためだけの一時フラグなので、
        // 無関係な将来のwaitForReactionDelegate呼び出しを誤って即完了させないよう自動で消す
        _pendingReactionDelegateResponse = true;
        setTimeout(() => { _pendingReactionDelegateResponse = null; }, 3000);
      }
      break;
    }
    case 'fx_ownDestroyReady': {
      // 相手（攻撃側）機がon_battle_win等の解決を終え、こちら（本当の持ち主）の
      // on_destroy発火に進んでよいと明示的に伝えてきた。
      // ただし、テイマーの登場時等（bs._pendingNonTurnPlayerReactions）がまだ発揮待ちの
      // 場合は、それを飛び越えて重ねて表示せず、同じ非ターンプレイヤー側の待ち行列に
      // 積んで順番を守る（公式ルール15-4-4「発揮待ち」は1つずつ発揮させる）
      if (_pendingOwnDestroyFire) {
        const fn = _pendingOwnDestroyFire; _pendingOwnDestroyFire = null;
        if (!bs._pendingNonTurnPlayerReactions) bs._pendingNonTurnPlayerReactions = [];
        bs._pendingNonTurnPlayerReactions.push((next) => fn(next));
        _drainNonTurnPlayerReactionQueue();
      }
      break;
    }
    case 'fx_deferOppNonTurnPlayerTriggers': {
      // 相手（攻撃側）がon_battle_win等のターンプレイヤー側同時誘発を解決中/解決完了。
      // active:true の間、こちら側でローカルに誘発する非ターンプレイヤー側トリガー
      // （セキュリティ効果で登場したカードの登場時等）は即座に発動せず保留する
      // （公式ルール15-4-3-5: ターンプレイヤー側を全て解決してから非ターンプレイヤー側へ）。
      bs._deferNonTurnPlayerTriggers = !!cmd.active;
      if (!cmd.active) {
        if (_deferStuckWatchdog) { clearTimeout(_deferStuckWatchdog); _deferStuckWatchdog = null; }
        _drainNonTurnPlayerReactionQueue();
      }
      break;
    }

    // --- ゲーム終了 ---
    case 'game_end': {
      if (m.showGameEndOverlay) {
        // fxキューをクリアして演出を即停止
        _fxQueue = [];
        _fxRunning = false;
        window._suppressFxSend = false;
        // ダイレクトアタック等の残留オーバーレイを消す
        document.querySelectorAll('body > div[style*="position:fixed"]').forEach(el => {
          if (!el.classList.contains('screen')) el.remove();
        });
        const isWin = cmd.result === 'victory';
        m.showGameEndOverlay(isWin ? '🎉 勝利！' : '😢 敗北...', isWin ? 'victory' : 'defeat', () => {
          cleanupOnline();
          if (window._onGameEnd) { window._onGameEnd(); return; }
          showScreen('room-entrance-screen');
        });
      }
      break;
    }
    case 'player_exit': {
      const exitOv = document.createElement('div');
      exitOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:60000;display:flex;align-items:center;justify-content:center;';
      const exitBox = document.createElement('div');
      exitBox.style.cssText = 'background:#0a0a1a;border:2px solid #ff4444;border-radius:12px;padding:24px;text-align:center;max-width:300px;width:90%;';
      exitBox.innerHTML = '<div style="color:#ff4444;font-size:16px;font-weight:bold;margin-bottom:12px;">⚠ 途中退室</div>'
        + '<div style="color:#ccc;font-size:13px;margin-bottom:20px;">「' + (cmd.playerName || '相手') + '」が途中退室しました。</div>'
        + '<button id="_exit-return-btn" style="background:#ff4444;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">ゲートを出る</button>';
      exitOv.appendChild(exitBox);
      document.body.appendChild(exitOv);
      document.getElementById('_exit-return-btn').onclick = () => {
        if (exitOv.parentNode) exitOv.parentNode.removeChild(exitOv);
        cleanupOnline(); showScreen('room-entrance-screen');
      };
      break;
    }

    // --- 状態同期 ---
    case 'state_sync': {
      const st = cmd.state;
      if (!st) break;
      const restoreCard = (data) => {
        if (!data) return null;
        // 最近削除されたバフはフィルタリング（state_syncで復活しないように）
        const filteredBuffs = (data.buffs || []).filter(b => {
          if (isBuffRecentlyExpired(data.name, b.type, b.duration)) return false;
          return true;
        });
        // _appliedSideを送信側視点から受信側視点に反転
        const flippedBuffs = filteredBuffs.map(b => {
          if (!b._appliedSide) return b;
          const flipped = b._appliedSide === 'player' ? 'ai' : (b._appliedSide === 'ai' ? 'player' : b._appliedSide);
          return { ...b, _appliedSide: flipped };
        });
        return { ...data, buffs: flippedBuffs, stack: (data.stack || []).map(restoreCard) };
      };
      const adjustArr = (arr, count) => { while (arr.length > count) arr.pop(); while (arr.length < count) arr.push({ name: '?', type: '不明', dp: 0 }); };
      // Firebaseはnull要素を含む配列をObjectとして保存するため安全に変換
      // 例: [null, {card}, null] → Firebase → {"1": {card}} → 復元時にインデックスを維持
      const toArray = (v) => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') {
          const keys = Object.keys(v).map(Number).filter(k => !isNaN(k));
          if (keys.length === 0) return [];
          const maxIdx = Math.max(...keys);
          const arr = new Array(maxIdx + 1).fill(null);
          keys.forEach(k => { arr[k] = v[k]; });
          return arr;
        }
        return [];
      };

      if (st.battleArea) {
        const newArea = toArray(st.battleArea).map(restoreCard);
        for (let i = 0; i < newArea.length; i++) {
          // 最近消滅したスロットにカードが復活するのを防止
          if (newArea[i] && isRecentlyDestroyed('ai', i)) {
            newArea[i] = null;
          }
          // 最近進化元が変更されたスロットはカード本体ごと保護（退化等で新キャリアに昇格した
          // ローカル状態を、まだ反映前の古い相手 state_sync に上書きされないようにする）
          if (isRecentlyEvoModified('ai', i)) {
            newArea[i] = bs.ai.battleArea[i] || null;
          }
          // 最近自分がレスト/アクティブにしたカードの suspended を保護（古いsyncで戻されないように）
          if (newArea[i]) {
            const ov = recentSuspendOverride('ai', i);
            if (ov !== null) newArea[i].suspended = ov;
          }
        }
        bs.ai.battleArea = newArea;
      }
      if (st.tamerArea) bs.ai.tamerArea = toArray(st.tamerArea).map(restoreCard);
      bs.ai.ikusei = st.ikusei ? restoreCard(st.ikusei) : bs.ai.ikusei;
      if (st.deckCount !== undefined) adjustArr(bs.ai.deck, st.deckCount);
      if (st.handCount !== undefined) adjustArr(bs.ai.hand, st.handCount);
      if (st.trashCards) bs.ai.trash = toArray(st.trashCards).map(restoreCard);
      else if (st.trashCount !== undefined) adjustArr(bs.ai.trash, st.trashCount);
      if (st.securityCount !== undefined && st.securityCount > 0 && st.securityCount < bs.ai.security.length && bs._aiSecuritySynced) {
        while (bs.ai.security.length > st.securityCount) bs.ai.security.shift();
      }
      // 注意: oppBattleArea/oppTamerArea による自分の状態の強制上書きは削除
      // 理由: タイムラグで古い情報に基づき自分のカードが誤削除されるため
      // カード除去は own_card_removed / card_removed コマンドで個別に同期する
      if (st.securityBuffs) {
        const myBuffs = (bs._securityBuffs || []).filter(b => b.owner === 'player');
        const oppBuffs = st.securityBuffs.map(b => ({ ...b, owner: 'ai' }));
        bs._securityBuffs = [...myBuffs, ...oppBuffs];
      }
      // メモリーはmemory_update/endTurnで個別同期する（state_syncは古い値で上書きするリスクがあるため除外）
      renderAll();
      break;
    }

    // --- 演出コマンド（キュー経由で順次再生、並列起動によるバチバチを防止） ---
    case 'fx_remoteBuff': {
      // 相手から汎用バフ付与コマンドを受信 → 対象カードに buff を直接 push
      // state_sync は oppBattleArea を上書きしないため、この個別コマンドで同期する
      // senderOwn=true : 送信者が自分のカードに付与 → 受信側では相手(ai)のカード
      // senderOwn なし : 送信者が相手のカードに付与 → 受信側では自分(player)のカード
      const _buffZone = cmd.senderOwn ? 'ai' : 'player';
      const myCard = bs[_buffZone].battleArea[cmd.targetIdx];
      if (myCard) {
        if (!myCard.buffs) myCard.buffs = [];
        // 送信側 _appliedSide を受信側目線に反転
        const senderSide = cmd.appliedFromSender || 'player';
        const myAppliedSide = senderSide === 'player' ? 'ai' : 'player';
        myCard.buffs.push({
          type: cmd.buffType,
          value: cmd.value || 0,
          duration: cmd.duration || 'dur_this_turn',
          source: 'remote',
          _appliedSide: myAppliedSide,
          _appliedDuringOwnTurn: cmd.appliedDuringOwnTurn !== undefined ? cmd.appliedDuringOwnTurn : true,
          _ticks: 0,
        });
        // dp_plus/dp_minus は recalcDp で実DP値を更新する（インライン実装）
        if (cmd.buffType === 'dp_plus' || cmd.buffType === 'dp_minus') {
          if (myCard.baseDp == null) myCard.baseDp = parseInt(myCard.dp) || 0;
          let mod = 0;
          myCard.buffs.forEach(b => {
            if (b.type === 'dp_plus') mod += (parseInt(b.value) || 0);
            if (b.type === 'dp_minus') mod -= (parseInt(b.value) || 0);
          });
          myCard.dpModifier = mod;
          myCard.dp = myCard.baseDp + mod;
          // DP0以下なら消滅マーク
          if (myCard.dp <= 0) myCard._pendingDestroy = true;
        }
        renderAll();
      }
      const sign = cmd.buffType === 'dp_minus' ? '-' : '+';
      addLog('⚔ 「' + (cmd.targetName || '???') + '」に' + (cmd.buffType || 'バフ') + sign + (cmd.value || 0) + ' 付与');
      break;
    }
    case 'fx_remoteDeckOpenStart': {
      // 相手が「デッキオープン」効果を発動 → 観戦用オーバーレイを表示（操作不可・表向き）
      showRemoteDeckOpenOverlay(cmd);
      addLog('📖 相手が「' + (cmd.sourceCardName || 'カード') + '」の効果でデッキ ' + ((cmd.cards && cmd.cards.length) || 0) + '枚をオープン');
      break;
    }
    case 'fx_remoteDeckOpenAct': {
      // 観戦オーバーレイから対象カードを抜き、移動演出を再生
      handleRemoteDeckOpenAct(cmd);
      break;
    }
    case 'fx_remoteDeckOpenEnd': {
      // 観戦オーバーレイを閉じる
      hideRemoteDeckOpenOverlay();
      break;
    }
    case 'fx_shuffle': {
      // 相手のシャッフル演出を自分側でも再生（fxキューで順次再生）
      if (window._fxShuffle) {
        enqueueFx((done) => { try { window._fxShuffle(cmd.label || 'シャッフル', done); } catch (_) { done(); } });
      }
      break;
    }
    case 'fx_preventUnsuspendAll': {
      // 「次のアクティブフェイズで全デジモンがアクティブにならない」フラグの同期。
      // 送信側 side を受信側目線に反転（player↔ai）。clear:true なら解除。
      const _puSide = cmd.side === 'ai' ? 'player' : 'ai';
      if (!bs._skipUnsuspend) bs._skipUnsuspend = {};
      bs._skipUnsuspend[_puSide] = !cmd.clear;
      renderAll();
      break;
    }
    case 'fx_securityPeek': {
      // 相手がセキュリティを非公開で確認中 → 「確認中」ポップアップを表示/消去
      if (cmd.state === 'start') {
        let ov = document.getElementById('_security-peek-popup');
        if (!ov) {
          ov = document.createElement('div');
          ov.id = '_security-peek-popup';
          ov.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:55000;background:rgba(0,0,0,0.9);border:1px solid #00fbff;border-radius:10px;padding:10px 20px;color:#00fbff;font-size:13px;font-weight:bold;text-align:center;box-shadow:0 0 20px #00fbff44;pointer-events:none;animation:fadeIn 0.2s ease;';
          document.body.appendChild(ov);
        }
        ov.innerText = '🛡 相手がセキュリティを確認中...' + (cmd.sourceName ? '（' + cmd.sourceName + '）' : '');
      } else {
        const ov = document.getElementById('_security-peek-popup');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
      }
      break;
    }
    case 'fx_securityReveal': {
      // 相手がセキュリティ確認で選んだカードを公開 → 一定時間カードを表示（fxキューで順次）
      enqueueFx((done) => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:56000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;animation:fadeIn 0.2s ease;';
        const label = document.createElement('div');
        label.style.cssText = 'color:#00fbff;font-size:13px;font-weight:bold;text-shadow:0 0 8px #00fbff;';
        label.innerText = '🛡 相手がセキュリティから公開 → 手札へ';
        ov.appendChild(label);
        if (cmd.cardImg) {
          const img = document.createElement('img');
          img.src = cmd.cardImg;
          img.style.cssText = 'width:150px;border-radius:8px;border:2px solid #00fbff;box-shadow:0 0 20px #00fbff88;';
          ov.appendChild(img);
        }
        const nm = document.createElement('div');
        nm.style.cssText = 'color:#fff;font-size:13px;font-weight:bold;';
        nm.innerText = cmd.cardName || '';
        ov.appendChild(nm);
        document.body.appendChild(ov);
        setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); done(); }, 2000);
      });
      break;
    }
    case 'fx_recover': {
      // リカバリー同期 → セキュリティに実カードを追加し、
      // デッキ→セキュリティの移動演出（裏向き）を再生する。
      // recoverSide = 送信側でリカバリーした side。受信側ではその逆サイドに適用。
      // （送信側 player → 受信側 ai / 送信側 ai → 受信側 player）
      const recCards = Array.isArray(cmd.cards) ? cmd.cards : [];
      const recTargetSide = (cmd.recoverSide === 'ai') ? 'player' : 'ai';
      const recArea = bs[recTargetSide];
      const recLabel = recTargetSide === 'player' ? '自分の' : '相手の';
      enqueueFx((done) => {
        let ri = 0;
        const playNextRecover = () => {
          if (ri >= recCards.length) { renderAll(); done(); return; }
          const c = { ...recCards[ri++], buffs: [], stack: [], suspended: false };
          // animOnly: 演出のみ（枚数は別途 security_init 等で同期済み）
          if (!cmd.animOnly) recArea.security.push(c);
          renderAll();
          if (window._fxCardMove) {
            try { window._fxCardMove(c, recLabel + 'デッキ', recLabel + 'セキュリティ', () => { renderAll(); playNextRecover(); }); }
            catch (_) { renderAll(); playNextRecover(); }
          } else { renderAll(); playNextRecover(); }
        };
        playNextRecover();
      });
      break;
    }
    case 'fx_remoteCardMove': {
      // 相手側でのカード移動演出を自分側でも再生（受信側視点で from/to ラベルは反転表示しない）
      if (window._fxCardMove) {
        const dummy = { name: cmd.cardName || '???', imgSrc: cmd.cardImg || '', cardNo: cmd.cardNo || '' };
        try { window._fxCardMove(dummy, '相手の' + (cmd.fromLabel || ''), '相手の' + (cmd.toLabel || ''), () => {}); } catch(_) {}
      }
      break;
    }
    case 'fx_targetSelectStart': {
      // 相手が対象選択を開始 → 「相手が対象選択中...」専用ポップアップを表示
      let ov = document.getElementById('_remote-target-select');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = '_remote-target-select';
        ov.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:55000;background:rgba(0,0,0,0.9);border:1px solid #ff00fb;border-radius:10px;padding:10px 20px;color:#ff00fb;font-size:13px;font-weight:bold;text-align:center;box-shadow:0 0 20px #ff00fb44;pointer-events:none;animation:fadeIn 0.2s ease;';
        document.body.appendChild(ov);
      }
      ov.innerText = '🎯 相手が対象を選択中...' + (cmd.label || '');
      break;
    }
    case 'fx_targetSelectEnd': {
      const ov = document.getElementById('_remote-target-select');
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
      break;
    }
    case 'fx_michizure': {
      // 相手の道連れ発動 → 自分側でも演出を再生
      const movly = document.createElement('div');
      movly.style.cssText = 'position:fixed;inset:0;z-index:48000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,0.55);';
      const mtxt = document.createElement('div');
      mtxt.style.cssText = 'font-size:clamp(1.6rem,7vw,3.2rem);font-weight:900;color:#ff5577;letter-spacing:6px;text-shadow:0 0 20px #ff5577,0 0 40px #aa0033,0 0 60px #aa0033;animation:phaseSlideIn 1.4s ease forwards;';
      mtxt.innerText = '💀 道連れ！';
      movly.appendChild(mtxt);
      document.body.appendChild(movly);
      setTimeout(() => { if (movly.parentNode) movly.parentNode.removeChild(movly); }, 1200);
      break;
    }
    case 'fx_penetrate': {
      // 相手の貫通発動 → 自分側でも演出を再生
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:48000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,0.55);';
      const text = document.createElement('div');
      text.style.cssText = 'font-size:clamp(1.6rem,7vw,3.2rem);font-weight:900;color:#ff9900;letter-spacing:6px;text-shadow:0 0 20px #ff9900,0 0 40px #ff5500,0 0 60px #ff5500;animation:phaseSlideIn 1.4s ease forwards;';
      text.innerText = '🗡 貫通！';
      overlay.appendChild(text);
      document.body.appendChild(overlay);
      setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 1400);
      addLog('🗡 相手の【貫通】効果でセキュリティチェック！');
      break;
    }
    case 'fx_remoteSelfEvoDiscard': {
      // 相手が自分の進化元を破棄したことを通知（state は state_sync で同期される）
      // 受信側目線では「相手のカード」なので bs.ai.battleArea を参照
      const targetName = cmd.targetName || '???';
      const discardedNames = Array.isArray(cmd.discardedNames) ? cmd.discardedNames : (cmd.discardedNames ? [cmd.discardedNames] : []);
      addLog('📤 相手「' + targetName + '」の進化元から「' + discardedNames.join(', ') + '」破棄');
      // カード移動演出のみ再生（演出のために必要なら image src を補う）
      let i = 0;
      function next() {
        if (i >= discardedNames.length) return;
        const name = discardedNames[i++];
        // 名前から DB を探して image を補強（無くても演出はOK）
        const card = { name };
        if (window.allCards) {
          const found = window.allCards.find(c => c['名前'] === name);
          if (found) {
            card.imgSrc = (typeof getCardImageUrl === 'function' ? getCardImageUrl(found) : '') || found['ImageURL'] || '';
            card.cardNo = found['カードNo'] || '';
          }
        }
        if (window._fxCardMove) {
          window._fxCardMove(card, targetName + 'の進化元', 'トラッシュ', next);
        } else { setTimeout(next, 500); }
      }
      if (discardedNames.length > 0) next();
      break;
    }
    case 'fx_remoteSuspend': {
      // 相手から rest/active コマンドを受信 → 対象カードの suspended を直接書き換え
      // state_sync は oppBattleArea を上書きしないため、この個別コマンドで同期する
      // senderOwn=true : 送信者が自分のカードを操作 → 受信側では相手(ai)側のカード
      // senderOwn なし : 送信者が相手のカードを操作 → 受信側では自分(player)側のカード
      const _suspZone = cmd.senderOwn ? 'ai' : 'player';
      const myCard = bs[_suspZone].battleArea[cmd.targetIdx];
      if (myCard) {
        myCard.suspended = !!cmd.suspended;
        // 保護フラグを立てて、相手からの古い state_sync で戻されないようにする
        markSuspendChanged(_suspZone, cmd.targetIdx, !!cmd.suspended);
        renderAll();
      }
      addLog((cmd.suspended ? '💤 ' : '🔄 ') + '「' + (cmd.targetName || '???') + '」が' + (cmd.suspended ? 'レスト' : 'アクティブ'));
      break;
    }
    case 'fx_cantAttackBlock': {
      // 相手から状態付与コマンドを受信 → 自分のカードに状態を付与
      const myCard = bs.player.battleArea[cmd.targetIdx];
      if (myCard) {
        if (cmd.action === 'cant_attack_block' || cmd.action === 'cant_attack') myCard.cantAttack = true;
        if (cmd.action === 'cant_attack_block' || cmd.action === 'cant_block') myCard.cantBlock = true;
        if (!myCard.buffs) myCard.buffs = [];
        // 送信者から見たappliedSideを受信側目線に反転（player→ai）
        const senderSide = cmd.appliedFromSender || 'player';
        const myAppliedSide = senderSide === 'player' ? 'ai' : 'player';
        myCard.buffs.push({
          type: cmd.action || 'cant_attack_block',
          value: 0,
          duration: cmd.duration || 'dur_this_turn',
          source: 'remote',
          _appliedSide: myAppliedSide,
          _appliedDuringOwnTurn: cmd.appliedDuringOwnTurn !== undefined ? cmd.appliedDuringOwnTurn : true,
          _ticks: 0,
        });
        renderAll();
      }
      // 状態付与演出
      const iconMap = { 'cant_attack_block': '⚔🛡✖', 'cant_attack': '⚔✖', 'cant_block': '🛡✖' };
      const labelMap = { 'cant_attack_block': 'アタック・ブロック不可', 'cant_attack': 'アタック不可', 'cant_block': 'ブロック不可' };
      const icon = iconMap[cmd.action] || '🔒';
      const label = (labelMap[cmd.action] || '行動制限') + '付与！';
      if (window._fxBuffStatus && myCard) {
        window._fxBuffStatus(myCard, icon, label, '#9933ff', () => {});
      }
      addLog('🔒 「' + (cmd.targetName || '???') + '」' + (labelMap[cmd.action] || '行動制限') + '付与');
      break;
    }
    case 'fx_dedigivolve': {
      // 退化: 受信側でキャリアを破棄 + stack 先頭から N-1 枚破棄 + 残り stack 先頭を新キャリアに昇格
      // onSide: 'self' = 自分側 (bs.player) / 'opp' = 相手側 (bs.ai)。送信側の対象側と反転する。
      const tgtPlayer = cmd.onSide === 'opp' ? bs.ai : bs.player;
      const tgt = tgtPlayer.battleArea[cmd.targetIdx];
      const removeCount = cmd.removeCount || 1;
      if (!tgt) break;
      const removed = [];
      removed.push(tgt);
      for (let k = 1; k < removeCount; k++) {
        if (tgt.stack && tgt.stack.length > 0) removed.push(tgt.stack.shift());
      }
      let newCarrier = null;
      if (tgt.stack && tgt.stack.length > 0) {
        newCarrier = tgt.stack.shift();
        newCarrier.stack = (tgt.stack || []).slice();
        newCarrier.suspended = !!tgt.suspended;
        newCarrier.buffs = [];
        newCarrier._permEffects = {};
        newCarrier.summonedThisTurn = false;
        newCarrier._usedEffects = [];
        newCarrier.baseDp = parseInt(newCarrier.dp) || 0;
        newCarrier.dp = newCarrier.baseDp;
        newCarrier.dpModifier = 0;
      }
      tgtPlayer.battleArea[cmd.targetIdx] = newCarrier;
      removed.forEach(r => tgtPlayer.trash.push(r));
      addLog('🔻 「' + tgt.name + '」を退化' + removeCount + (newCarrier ? ' (新形態: ' + newCarrier.name + ')' : ' (完全消滅)'));
      // 退化後の永続効果を再評価
      try {
        if (window._applyPermanentEffects) window._applyPermanentEffects();
      } catch(_) {}
      renderAll();
      // 受信側の bs.* を更新したので、相手画面にも新状態を伝えるため state_sync を送る。
      // また、5秒の cooldown 中にこちらの古い state_sync で相手の正しい状態が
      // 上書きされないよう markEvoModified で保護。
      // - cmd.onSide==='self' (退化対象は自分側=bs.player) → 相手側の view では 'ai'
      // - cmd.onSide==='opp'  (退化対象は相手側=bs.ai)    → こちら側の view では 'ai'
      try {
        if (cmd.onSide === 'self') {
          // bs.player を変更した → 相手の bs.ai 上書き防止用フラグ送信
          // ただし markEvoModified はローカル状態を守る fn なので、自身の bs.player を守るために
          // 'player' を引数に。ここでは player 側の上書きは state_sync の対象外なので
          // 自分側 bs.player は安全。
        } else if (cmd.onSide === 'opp') {
          // bs.ai を変更した → 自分のローカル bs.ai が古い state_sync で戻されないように保護
          if (window._markEvoModified) window._markEvoModified('ai', cmd.targetIdx);
        }
        // 反映後の state を相手機にも送信
        if (window._onlineSendStateSync) window._onlineSendStateSync();
      } catch(_) {}
      // 1枚ずつ移動演出
      let dedi = 0;
      function dediShowAnim() {
        if (dedi >= removed.length) return;
        const card = removed[dedi++];
        if (window._fxCardMove) {
          window._fxCardMove(card, tgt.name + (card === tgt ? '' : 'の進化元'), 'トラッシュ', dediShowAnim);
        } else { setTimeout(dediShowAnim, 300); }
      }
      dediShowAnim();
      break;
    }
    case 'fx_evoDiscard': {
      // 進化元破棄：自分のカードのstackを実際に操作
      const discardedCards = [];
      if (cmd.targetIdx !== undefined && cmd.count) {
        const myCard = bs.player.battleArea[cmd.targetIdx];
        if (myCard && myCard.stack && myCard.stack.length > 0) {
          for (let i = 0; i < cmd.count && myCard.stack.length > 0; i++) {
            const removed = cmd.fromTop ? myCard.stack.shift() : myCard.stack.pop();
            bs.player.trash.push(removed);
            discardedCards.push(removed);
          }
          renderAll();
        }
      }
      addLog('📤 「' + (cmd.targetName || '???') + '」の進化元から「' + (cmd.discardedNames || '???') + '」破棄！');
      // カード移動演出（1枚ずつ）
      let di = 0;
      function showNextFx() {
        if (di >= discardedCards.length) return;
        const card = discardedCards[di++];
        if (window._fxCardMove) {
          window._fxCardMove(card, (cmd.targetName || '???') + 'の進化元', 'トラッシュ', showNextFx);
        } else { setTimeout(showNextFx, 500); }
      }
      if (discardedCards.length > 0) { showNextFx(); }
      break;
    }
    case 'fx_battleResult': {
      if (m.showBattleResult) enqueueFx((done) => m.showBattleResult(cmd.text, cmd.color, cmd.sub, done));
      break;
    }
    case 'fx_destroy': {
      if (m.showDestroyEffect) enqueueFx((done) => m.showDestroyEffect({ name: cmd.cardName, imgSrc: cmd.cardImg }, done));
      break;
    }
    case 'fx_securityCheck': {
      // ブロック待ちオーバーレイがあれば先に消す（BLOCK!演出が見えるように）
      const blockWait = document.getElementById('_block-wait-overlay');
      if (blockWait && blockWait.parentNode) blockWait.parentNode.removeChild(blockWait);
      // baseDp を含めて再構築（受信側でも formatDpDisplay が「元値+バフ」を表示できるように）
      const secCard = { name: cmd.secName, imgSrc: cmd.secImg, cardNo: cmd.secCardNo || '', dp: cmd.secDp, baseDp: cmd.secBaseDp != null ? cmd.secBaseDp : cmd.secDp, type: cmd.secType };
      const atkCard = { name: cmd.atkName, imgSrc: cmd.atkImg, cardNo: cmd.atkCardNo || '', dp: cmd.atkDp, baseDp: cmd.atkBaseDp != null ? cmd.atkBaseDp : cmd.atkDp };
      if (m.showSecurityCheck) enqueueFx((done) => m.showSecurityCheck(secCard, atkCard, () => { renderAll(); done(); }, cmd.customLabel || null));
      break;
    }
    case 'fx_directAttack': {
      if (m.showDirectAttack) enqueueFx((done) => m.showDirectAttack({ name: cmd.atkName, imgSrc: cmd.atkImg }, cmd.side, done));
      break;
    }
    case 'fx_option': {
      if (m.showOptionEffect) enqueueFx((done) => m.showOptionEffect({ name: cmd.cardName, imgSrc: cmd.cardImg }, done));
      break;
    }
    case 'fx_sAttackPlus': {
      if (m.fxSAttackPlus) m.fxSAttackPlus(cmd.n, () => {});
      break;
    }
    case 'fx_secCheckLabel': {
      const old = document.getElementById('_sec-check-count-label');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      const el = document.createElement('div');
      el.id = '_sec-check-count-label';
      el.style.cssText = 'position:fixed;top:10%;left:50%;transform:translateX(-50%);z-index:60001;pointer-events:none;font-size:clamp(0.9rem,4vw,1.3rem);font-weight:700;color:#fff;background:rgba(0,0,0,0.7);padding:6px 18px;border-radius:8px;border:1px solid #aaa;text-align:center;animation:secCheckLabel 2.5s ease forwards;';
      el.innerText = cmd.text || '';
      document.body.appendChild(el);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
      break;
    }
    case 'fx_effectAnnounce': {
      if (m.fxRemoteEffect) m.fxRemoteEffect(cmd.cardName, cmd.effectText || '');
      break;
    }
    case 'fx_effectClose': {
      if (m.fxRemoteEffectClose) m.fxRemoteEffectClose();
      break;
    }
    case 'fx_effectResult': {
      const erOv = document.createElement('div');
      erOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:55500;display:flex;align-items:center;justify-content:center;cursor:pointer;animation:fadeIn 0.2s ease;';
      const erBx = document.createElement('div');
      erBx.style.cssText = 'text-align:center;max-width:85%;';
      if (cmd.cardImg) erBx.innerHTML += '<div style="margin-bottom:12px;"><img src="' + cmd.cardImg + '" style="width:100px;height:140px;object-fit:cover;border-radius:8px;border:2px solid #ff00fb;box-shadow:0 0 20px #ff00fb44;"></div>';
      const actionColors = { '登場！': '#ffaa00', '消滅！': '#ff4444', '手札に戻す！': '#00fbff', 'レスト！': '#ff9900', 'アクティブ！': '#00ff88', '進化！': '#aa66ff', 'リカバリー！': '#00ff88', 'DP強化！': '#00ff88', 'DP弱体化！': '#ff4444' };
      const labelColor = actionColors[cmd.actionLabel] || '#ff00fb';
      erBx.innerHTML += '<div style="color:#fff;font-size:14px;font-weight:bold;margin-bottom:8px;">「' + (cmd.cardName || '') + '」</div>';
      erBx.innerHTML += '<div style="color:' + labelColor + ';font-size:18px;font-weight:bold;text-shadow:0 0 15px ' + labelColor + ';letter-spacing:3px;">' + (cmd.actionLabel || '') + '</div>';
      erOv.appendChild(erBx);
      document.body.appendChild(erOv);
      let erDone = false;
      function erFinish() { if (erDone) return; erDone = true; if (erOv.parentNode) erOv.parentNode.removeChild(erOv); }
      setTimeout(() => { erOv.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(erFinish, 300); }, 2500);
      erOv.onclick = erFinish;
      break;
    }
    case 'fx_deckOpen': {
      if (!cmd.cards || cmd.cards.length === 0) break;
      const openOv = document.createElement('div');
      openOv.id = '_remote-deck-open';
      openOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;pointer-events:none;';
      openOv.innerHTML = '<div style="font-size:1rem;font-weight:bold;color:#ffaa00;letter-spacing:2px;text-shadow:0 0 10px #ffaa00;">📖 相手: DECK OPEN</div>';
      const openRow = document.createElement('div');
      openRow.style.cssText = 'display:flex;gap:10px;justify-content:center;padding:12px 20px;background:rgba(0,15,25,0.9);border:1px solid #ffaa0044;border-radius:12px;';
      cmd.cards.forEach(c => {
        const wrap = document.createElement('div');
        wrap.dataset.cardname = c.name;
        wrap.style.cssText = 'text-align:center;transition:opacity 0.5s;';
        wrap.innerHTML = (c.imgSrc ? '<img src="' + c.imgSrc + '" style="width:55px;height:77px;object-fit:cover;border-radius:4px;border:1px solid #ffaa00;">' : '') + '<div style="color:#fff;font-size:9px;margin-top:2px;">' + c.name + '</div>';
        openRow.appendChild(wrap);
      });
      openOv.appendChild(openRow);
      document.body.appendChild(openOv);
      window._remoteDeckOpenOverlay = openOv;
      setTimeout(() => { if (openOv.parentNode) openOv.parentNode.removeChild(openOv); }, 30000);
      break;
    }
    case 'fx_cardPlace': {
      const toast = document.createElement('div');
      toast.innerText = '🎮 ' + (cmd.msg || (cmd.cardName + ' → ' + cmd.zone));
      toast.style.cssText = 'position:fixed;bottom:25%;left:50%;transform:translateX(-50%);z-index:95000;background:rgba(255,170,0,0.2);border:1px solid #ffaa00;color:#fff;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:10px;text-align:center;pointer-events:none;';
      document.body.appendChild(toast);
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2500);
      if (window._remoteDeckOpenOverlay) {
        const cards = window._remoteDeckOpenOverlay.querySelectorAll('[data-cardname]');
        for (const el of cards) {
          if (el.dataset.cardname === cmd.cardName && el.style.opacity !== '0.2') { el.style.opacity = '0.2'; break; }
        }
      }
      break;
    }
    case 'fx_deckOpenClose': {
      if (window._remoteDeckOpenOverlay && window._remoteDeckOpenOverlay.parentNode) {
        window._remoteDeckOpenOverlay.parentNode.removeChild(window._remoteDeckOpenOverlay);
        window._remoteDeckOpenOverlay = null;
      }
      break;
    }

    case 'effect_confirm': window.confirmEffect(cmd.yes); break;

    case 'fx_effectFailed': {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:45%;left:0;z-index:60000;font-size:clamp(0.85rem,3.5vw,1.1rem);font-weight:700;color:#aaa;background:rgba(30,30,40,0.85);padding:10px 28px;border-radius:20px;border:1px solid #555;box-shadow:0 2px 12px rgba(0,0,0,0.4);white-space:nowrap;pointer-events:none;animation:effectFizzleSlide 3.5s cubic-bezier(0.25,1,0.5,1) forwards;';
      el.innerText = cmd.text || '💨 効果発動できませんでした';
      document.body.appendChild(el);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
      break;
    }
  }
}

// ===== ブロック応答 =====

export function waitForBlockResponse(callback) {
  const waitOv = document.createElement('div');
  waitOv.id = '_block-wait-overlay';
  waitOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:55000;display:flex;align-items:center;justify-content:center;';
  waitOv.innerHTML = '<div style="color:#ff00fb;font-size:14px;font-weight:bold;text-align:center;text-shadow:0 0 10px #ff00fb;">⏳ 相手のブロック確認中...</div>';
  document.body.appendChild(waitOv);

  function onResponse(resp) {
    if (waitOv.parentNode) waitOv.parentNode.removeChild(waitOv);
    callback(resp);
  }
  if (_pendingBlockResponse !== null) {
    const resp = _pendingBlockResponse; _pendingBlockResponse = null; onResponse(resp);
  } else {
    _pendingBlockCallback = onResponse;
  }
  setTimeout(() => {
    if (_pendingBlockCallback === onResponse) { _pendingBlockCallback = null; onResponse({ blocked: false }); }
  }, 30000);
}

// ===== セキュリティ効果待機（アタック側が防御側の処理完了を待つ） =====

export function waitForSecurityEffect(callback) {
  const waitOv = document.createElement('div');
  waitOv.id = '_sec-effect-wait-overlay';
  waitOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:55000;display:flex;align-items:center;justify-content:center;';
  waitOv.innerHTML = '<div style="color:#ffaa00;font-size:14px;font-weight:bold;text-align:center;text-shadow:0 0 10px #ffaa00;">⏳ 相手がセキュリティ効果を処理中...</div>';
  document.body.appendChild(waitOv);

  function onDone() {
    if (waitOv.parentNode) waitOv.parentNode.removeChild(waitOv);
    callback();
  }
  if (_pendingSecEffectResponse !== null) {
    _pendingSecEffectResponse = null; onDone();
  } else {
    _pendingSecEffectCallback = onDone;
  }
  // 30秒タイムアウト
  setTimeout(() => {
    if (_pendingSecEffectCallback === onDone) { _pendingSecEffectCallback = null; onDone(); }
  }, 30000);
}

// ===== 反応系トリガー委譲待機（相手のカードの効果を相手機に委譲した側が完了を待つ） =====
// when_opp_rest等、相手が本当の持ち主のカードの効果は、相手機に委譲して相手自身に
// 本物のUI（OKボタン等）を操作してもらう。ブロック確認/セキュリティ効果と同じ設計。
export function waitForReactionDelegate(callback) {
  const waitOv = document.createElement('div');
  waitOv.id = '_reaction-delegate-wait-overlay';
  waitOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:55000;display:flex;align-items:center;justify-content:center;';
  waitOv.innerHTML = '<div style="color:#ffaa00;font-size:14px;font-weight:bold;text-align:center;text-shadow:0 0 10px #ffaa00;">⏳ 相手が効果を確認中...</div>';
  document.body.appendChild(waitOv);

  function onDone() {
    if (waitOv.parentNode) waitOv.parentNode.removeChild(waitOv);
    callback();
  }
  if (_pendingReactionDelegateResponse !== null) {
    _pendingReactionDelegateResponse = null; onDone();
  } else {
    _pendingReactionDelegateCallback = onDone;
  }
  // 30秒タイムアウト（相手の切断等でackが来ない場合にゲームが止まらないように）
  setTimeout(() => {
    if (_pendingReactionDelegateCallback === onDone) { _pendingReactionDelegateCallback = null; onDone(); }
  }, 30000);
}

function checkOnlineBlock(cmd) {
  // ブロッカー判定: テキスト一致は「【ブロッカー】を得る」「【ブロッカー】を持つ間」等の
  // 言及にも誤マッチするため、構造的な情報（_permEffects / buffs / recipe.passive /
  // stack[].recipe.evo_source.passive）のみで判定する
  const passiveHasBlocker = (arr) =>
    Array.isArray(arr) && arr.some(p => p && (p.flag === 'blocker' || p === 'blocker'));
  const parseR = (rec) => {
    if (!rec) return null;
    try {
      if (typeof rec === 'string') return JSON.parse(rec.replace(/[\x00-\x1F\x7F]\s*/g, ''));
      return rec;
    } catch (_) { return null; }
  };
  const isBlocker = (c) => {
    if (!c) return false;
    if (c._permEffects && c._permEffects.blocker) return true;
    if (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_blocker')) return true;
    const r = parseR(c.recipe);
    if (r && passiveHasBlocker(r.passive)) return true;
    if (Array.isArray(c.stack)) {
      for (const evo of c.stack) {
        const er = parseR(evo && evo.recipe);
        if (!er || !er.evo_source) continue;
        if (passiveHasBlocker(er.evo_source.passive)) return true;
      }
    }
    return false;
  };
  const blockerIndices = [];
  bs.player.battleArea.forEach((c, i) => {
    if (c && !c.suspended && !c.cantBlock && isBlocker(c)) {
      if (cmd.atkCantBeBlocked) return; // アタッカーがブロックされない
      if (cmd.atkCantBeBlockedByNoEvo && (!c.stack || c.stack.length === 0)) return; // 進化元なしブロッカーは不可
      blockerIndices.push(i);
    }
  });
  if (blockerIndices.length === 0) {
    sendCommand({ type: 'block_response', blocked: false });
    return;
  }
  // baseDp を含めて再構築（showBlockConfirm 内の formatDpDisplay が「元値+バフ」を表示できるように）
  const attacker = { name: cmd.atkName || '???', dp: cmd.atkDp || 0, baseDp: cmd.atkBaseDp != null ? cmd.atkBaseDp : (cmd.atkDp || 0), imgSrc: cmd.atkImg || '' };
  // アタック対象情報（受信側の表示用）
  let targetInfo = null;
  if (cmd.type === 'attack_security') targetInfo = { type: 'security' };
  else if (cmd.type === 'attack_digimon') targetInfo = { type: 'digimon', name: cmd.defName || '' };
  if (_modules.showBlockConfirm) {
    _modules.showBlockConfirm(bs.player.battleArea[blockerIndices[0]], attacker, (doBlock) => {
      if (!doBlock) { sendCommand({ type: 'block_response', blocked: false }); return; }
      if (blockerIndices.length === 1) {
        resolveOnlineBlock(blockerIndices[0], cmd);
      } else if (_modules.showBlockerSelection) {
        _modules.showBlockerSelection(blockerIndices, attacker, (selectedIdx) => {
          if (selectedIdx !== null) resolveOnlineBlock(selectedIdx, cmd);
          else sendCommand({ type: 'block_response', blocked: false });
        });
      } else {
        // ブロッカー選択UIがない場合、最初のブロッカーで自動ブロック
        resolveOnlineBlock(blockerIndices[0], cmd);
      }
    }, targetInfo);
  } else {
    // ブロック確認UIがない場合、ブロックなしとして応答
    sendCommand({ type: 'block_response', blocked: false });
  }
}

function resolveOnlineBlock(blockerIdx, cmd) {
  const blocker = bs.player.battleArea[blockerIdx];
  const atk = bs.ai.battleArea[cmd.atkIdx];
  if (!blocker || !atk) { sendCommand({ type: 'block_response', blocked: false }); return; }

  // ≪貫通≫: 攻撃側カードが【貫通】を持つか（_permEffects / buffs / recipe.passive / 進化元passive）
  const atkHasPenetrate = (() => {
    if (atk._permEffects && atk._permEffects.penetrate) return true;
    if (Array.isArray(atk.buffs) && atk.buffs.some(b => b && b.type === 'keyword_penetrate')) return true;
    const pHas = (arr) => Array.isArray(arr) && arr.some(p => p && (p.flag === 'penetrate' || p === 'penetrate'));
    const parseRec = (rec) => {
      if (!rec) return null;
      try { return typeof rec === 'string' ? JSON.parse(rec.replace(/[\x00-\x1F\x7F]\s*/g, '')) : rec; }
      catch (_) { return null; }
    };
    const r = parseRec(atk.recipe);
    if (r && pHas(r.passive)) return true;
    if (Array.isArray(atk.stack)) {
      for (const evo of atk.stack) {
        const er = parseRec(evo && evo.recipe);
        if (er && er.evo_source && pHas(er.evo_source.passive)) return true;
      }
    }
    return false;
  })();

  blocker.suspended = true;
  addLog('🛡 「' + blocker.name + '」でブロック！');
  renderAll();
  sendCommand({ type: 'waiting_close' });

  // ★ バトル中効果を適用してから勝敗判定（DP+1000等の進化元効果を反映）
  const battleBuffs = applyBattleBuffs(atk, blocker);

  // ★ ブロック決定を通知（攻撃側で「ブロックされた時」効果を先に処理してもらう）
  // バフ適用後のDPで勝敗判定
  let atkResult = 'survived';
  if (atk.dp <= blocker.dp) atkResult = atk.dp === blocker.dp ? 'both_destroyed' : 'destroyed';
  sendCommand({ type: 'block_response', blocked: true, atkIdx: cmd.atkIdx, atkResult, blockerName: blocker.name, blockerImg: cardImg(blocker), blockerDp: blocker.dp });

  // 攻撃側の「ブロックされた時」効果完了を待ってからバトル解決
  function startBattleResolution() {
    const showSC = _modules.showSecurityCheck || ((a, b, cb) => cb());
    const showBR = _modules.showBattleResult || ((a, b, c, cb) => cb());
    const showDE = _modules.showDestroyEffect || ((a, cb) => cb());

    // 表示関数からの自動送信を抑制（手動送信のみP1に届ける）
    window._suppressFxSend = true;
    // 注: battleBuffsは既に resolveOnlineBlock 冒頭で applyBattleBuffs 済み

    // VS演出を相手にも送信（バフ適用後のDPで送る）
    // baseDpも送って受信側の formatDpDisplay で「元値+バフ」表示できるようにする
    const blockerBase = parseInt(blocker._origDp != null ? blocker._origDp : (blocker.baseDp != null ? blocker.baseDp : blocker.dp)) || 0;
    const atkBase = parseInt(atk._origDp != null ? atk._origDp : (atk.baseDp != null ? atk.baseDp : atk.dp)) || 0;
    sendCommand({ type: 'fx_securityCheck', secName: blocker.name, secImg: cardImg(blocker), secDp: blocker.dp, secBaseDp: blockerBase, secType: 'デジモン', atkName: atk.name, atkImg: cardImg(atk), atkDp: atk.dp, atkBaseDp: atkBase, customLabel: 'BLOCK!' });

    showSC(blocker, atk, () => {
      // バトル中効果適用済みのDPで勝敗判定 → その後バフ除去
      const _atkDp = atk.dp, _blkDp = blocker.dp;
      removeBattleBuffs(battleBuffs);
      if (_atkDp === _blkDp) {
        bs.ai.battleArea[cmd.atkIdx] = null; bs.ai.trash.push(atk); if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s)); if (atk.linkedCards) atk.linkedCards.forEach(s => bs.ai.trash.push(s));
        bs.player.battleArea[blockerIdx] = null; bs.player.trash.push(blocker); if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s)); if (blocker.linkedCards) blocker.linkedCards.forEach(s => bs.player.trash.push(s));
        sendCommand({ type: 'own_card_removed', slotIdx: blockerIdx, reason: 'destroy' });
        // 攻撃側 atk の消滅を相手(攻撃側オーナー)に通知 → 受信側で on_destroy 等を発火
        // 送信側 (防御側) で観測している atk のフルカード情報を含める。
        // 受信側 (オーナー機) のローカル状態が同期遅延でずれていても、
        // この cardData から on_destroy 用の stack/recipe を取得できる
        sendCommand({
          type: 'card_removed', zone: 'battle', slotIdx: cmd.atkIdx, reason: 'destroy',
          cardData: serializeCardForCmd(atk),
        });
        sendCommand({ type: 'fx_ownDestroyReady' });
        renderAll();
        sendCommand({ type: 'fx_battleResult', text: '両者消滅', color: '#ff4444', sub: '両者消滅！' });
        // 両者の消滅演出を相手機にも明示送信
        sendCommand({ type: 'fx_destroy', cardName: blocker.name, cardImg: cardImg(blocker) });
        sendCommand({ type: 'fx_destroy', cardName: atk.name, cardImg: cardImg(atk) });
        showBR('両者消滅', '#ff4444', '両者消滅！', () => {
          showDE(blocker, () => { showDE(atk, () => {
            addLog('💥 両者消滅！');
            // 自分側 (blocker = bs.player) のみここで発火。
            // 相手側 (atk) の on_destroy はカード所有者 (相手機) で card_removed 受信時に発火される
            // ので、ここで 'ai' を発火すると「相手の効果」が自機側にもポップアップ表示されて
            // 「P1 と P2 で popup が逆」状態になるため発火しない。
            const fire = window._fireOnlineDestroyChain;
            const finish = () => { window._suppressFxSend = false; sendStateSync(); };
            if (fire) fire(['player'], { player: blocker }, finish);
            else finish();
          }); });
        });
      } else if (_atkDp > _blkDp) {
        bs.player.battleArea[blockerIdx] = null; bs.player.trash.push(blocker); if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s)); if (blocker.linkedCards) blocker.linkedCards.forEach(s => bs.player.trash.push(s));
        sendCommand({ type: 'own_card_removed', slotIdx: blockerIdx, reason: 'destroy' });
        renderAll();
        // ≪道連れ≫: ブロッカーが「自分だけバトルで消滅」したとき相手(atk)も消滅
        const blockerHasMichizure = !!(
          (blocker._permEffects && blocker._permEffects.michizure)
          || (Array.isArray(blocker.buffs) && blocker.buffs.some(b => b && b.type === 'keyword_michizure'))
        );
        if (blockerHasMichizure && bs.ai.battleArea[cmd.atkIdx] === atk) {
          addLog('💀 【道連れ】「' + blocker.name + '」が「' + atk.name + '」を巻き込んで消滅！');
          bs.ai.battleArea[cmd.atkIdx] = null;
          bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          if (atk.linkedCards) atk.linkedCards.forEach(s => bs.ai.trash.push(s));
          // 相手機にも atk 消滅を通知
          // 送信側 (防御側) で観測している atk のフルカード情報を含める。
        // 受信側 (オーナー機) のローカル状態が同期遅延でずれていても、
        // この cardData から on_destroy 用の stack/recipe を取得できる
        sendCommand({
          type: 'card_removed', zone: 'battle', slotIdx: cmd.atkIdx, reason: 'destroy',
          cardData: serializeCardForCmd(atk),
        });
          sendCommand({ type: 'fx_ownDestroyReady' });
          renderAll();
          sendCommand({ type: 'fx_battleResult', text: '両者消滅', color: '#ff4444', sub: '道連れで両者消滅！' });
          showBR('両者消滅', '#ff4444', '道連れで両者消滅！', () => {
            showDE(blocker, () => {
              // 巻き込まれた atk の消滅前に「道連れ」演出（自他両画面）
              sendCommand({ type: 'fx_michizure' });
              const showMichi = window._showMichizureAnnounce || ((cb) => cb && cb());
              showMichi(() => {
                showDE(atk, () => {
                  addLog('💥 両者消滅（道連れ）！');
                  // blocker (player) のみ発火。atk の on_destroy はオーナー機側で発火される。
                  const fire = window._fireOnlineDestroyChain;
                  const finish = () => { window._suppressFxSend = false; sendStateSync(); };
                  if (fire) fire(['player'], { player: blocker }, finish);
                  else finish();
                });
              });
            });
          });
          return;
        }
        sendCommand({ type: 'fx_battleResult', text: 'Win!!', color: '#00ff88', sub: '「' + blocker.name + '」を撃破！' });
        sendCommand({ type: 'fx_destroy', cardName: blocker.name, cardImg: cardImg(blocker) });
        showBR('Lost...', '#ff4444', '「' + blocker.name + '」が撃破された', () => {
          showDE(blocker, () => {
            addLog('💥 「' + blocker.name + '」が撃破された');
            const fire = window._fireOnlineDestroyChain;
            const finish = () => {
              window._suppressFxSend = false;
              sendStateSync();
              // ≪貫通≫: ブロッカーを撃破し atk が貫通を持つなら攻撃側に追加セキュリティチェックを要求
              if (atkHasPenetrate) sendCommand({ type: 'penetrate_security_check', atkIdx: cmd.atkIdx });
            };
            if (fire) fire(['player'], { player: blocker }, finish);
            else finish();
          });
        });
      } else {
        bs.ai.battleArea[cmd.atkIdx] = null; bs.ai.trash.push(atk); if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s)); if (atk.linkedCards) atk.linkedCards.forEach(s => bs.ai.trash.push(s));
        // 攻撃側 atk の消滅を相手(攻撃側オーナー)に通知
        // 送信側 (防御側) で観測している atk のフルカード情報を含める。
        // 受信側 (オーナー機) のローカル状態が同期遅延でずれていても、
        // この cardData から on_destroy 用の stack/recipe を取得できる
        sendCommand({
          type: 'card_removed', zone: 'battle', slotIdx: cmd.atkIdx, reason: 'destroy',
          cardData: serializeCardForCmd(atk),
        });
        sendCommand({ type: 'fx_ownDestroyReady' });
        renderAll();
        // ≪道連れ≫: 攻撃側 atk が「自分だけバトルで消滅」したとき blocker も消滅
        const atkHasMichizure = !!(
          (atk._permEffects && atk._permEffects.michizure)
          || (Array.isArray(atk.buffs) && atk.buffs.some(b => b && b.type === 'keyword_michizure'))
        );
        if (atkHasMichizure && bs.player.battleArea[blockerIdx] === blocker) {
          addLog('💀 【道連れ】「' + atk.name + '」が「' + blocker.name + '」を巻き込んで消滅！');
          bs.player.battleArea[blockerIdx] = null;
          bs.player.trash.push(blocker);
          if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s));
          if (blocker.linkedCards) blocker.linkedCards.forEach(s => bs.player.trash.push(s));
          sendCommand({ type: 'own_card_removed', slotIdx: blockerIdx, reason: 'destroy' });
          renderAll();
          sendCommand({ type: 'fx_battleResult', text: '両者消滅', color: '#ff4444', sub: '道連れで両者消滅！' });
          showBR('両者消滅', '#ff4444', '道連れで両者消滅！', () => {
            showDE(atk, () => {
              // 巻き込まれた blocker の消滅前に「道連れ」演出（自他両画面）
              sendCommand({ type: 'fx_michizure' });
              const showMichi = window._showMichizureAnnounce || ((cb) => cb && cb());
              showMichi(() => {
                showDE(blocker, () => {
                  addLog('💥 両者消滅（道連れ）！');
                  // blocker (player) のみ発火。atk の on_destroy はオーナー機側で発火される。
                  const fire = window._fireOnlineDestroyChain;
                  const finish = () => { window._suppressFxSend = false; sendStateSync(); };
                  if (fire) fire(['player'], { player: blocker }, finish);
                  else finish();
                });
              });
            });
          });
          return;
        }
        sendCommand({ type: 'fx_battleResult', text: 'Lost...', color: '#ff4444', sub: '「' + atk.name + '」が撃破された' });
        // _suppressFxSend のせいで showDE(atk) 内の自動 fx_destroy 送信が抑止されるため、
        // 攻撃側カードの消滅演出を相手機にも明示的に送る
        sendCommand({ type: 'fx_destroy', cardName: atk.name, cardImg: cardImg(atk) });
        showBR('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => {
          showDE(atk, () => {
            addLog('💥 「' + atk.name + '」を撃破！');
            // atk の on_destroy はカード所有者 (相手機) で card_removed 受信時に発火される
            window._suppressFxSend = false;
            sendStateSync();
          });
        });
      }
    }, 'BLOCK!');
  }

  // 攻撃側の「ブロックされた時」効果完了シグナルを待つ（最大10秒）
  let battleStarted = false;
  let unsubBlockedDone = null;
  // when_own_block (八神太一(黒)等) を VS 画面前に発火するためのラッパ
  const goResolution = () => {
    if (battleStarted) return;
    battleStarted = true;
    if (unsubBlockedDone) unsubBlockedDone();
    // VS 画面表示前に「自分のブロッカーがブロックしたとき」効果を完了まで処理
    let fired = false;
    const startFn = () => { if (fired) return; fired = true; startBattleResolution(); };
    try {
      if (window._fireWhenOwnBlock) {
        const ctxBase = { bs, addLog, renderAll, updateMemGauge: _modules.updateMemGauge };
        window._fireWhenOwnBlock('player', bs, ctxBase, startFn);
        return;
      }
    } catch(_) {}
    startFn();
  };
  unsubBlockedDone = onValue(ref(rtdb, `rooms/${_onlineRoomId}/commands`), (snap) => {
    if (battleStarted) return;
    if (!unsubBlockedDone) return; // 初期化前の即時コールバックをスキップ
    const bySender = snap.val();
    if (!bySender) return;
    const found = _flattenCommandsSnapshot(bySender)
      .some(c => c && c.type === 'blocked_effect_done' && c.from !== _onlineMyKey);
    if (found) goResolution();
  });
  // タイムアウト: 10秒待っても来なければバトル開始
  setTimeout(() => { goResolution(); }, 10000);
}

// ===== クリーンアップ =====

export function cleanupOnline() {
  bs._battleAborted = true;
  // オーバーレイ全消し
  ['your-turn-overlay', 'phase-announce-overlay', 'skip-announce-overlay', 'security-check-overlay', 'battle-result-overlay', 'draw-overlay', 'effect-confirm-overlay', 'b-card-detail', 'card-action-menu', 'evolve-overlay', 'hatch-overlay', 'option-overlay', 'destroy-overlay', 'trash-modal'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  // 動的オーバーレイ削除
  document.querySelectorAll('body > div[style*="position:fixed"]').forEach(el => {
    if (!el.classList.contains('screen')) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  });
  // Firebaseリスナー解除
  if (_onlineCmdListener) { _onlineCmdListener(); _onlineCmdListener = null; }
  // ルームデータ削除
  if (_onlineMode && _onlineRoomId) {
    try { remove(ref(rtdb, `rooms/${_onlineRoomId}`)); } catch (e) {}
    _onlineRoomId = null;
  }
  _onlineMode = false;
}

// ===== window公開（effect-engine等から参照用） =====

window._isOnlineMode = () => _onlineMode;
window._onlineSendCommand = (cmd) => sendCommand(cmd);
window._onlineSendStateSync = () => sendStateSync();
window._sendMemoryUpdate = () => sendMemoryUpdate();
window._waitForBlockResponse = (cb) => waitForBlockResponse(cb);
window._waitForSecurityEffect = (cb) => waitForSecurityEffect(cb);
window._waitForReactionDelegate = (cb) => waitForReactionDelegate(cb);
window._drainNonTurnPlayerReactionQueue = () => _drainNonTurnPlayerReactionQueue();
window._clearPendingBlock = () => { _pendingBlockCallback = null; _pendingBlockResponse = null; };
window._markDestroyed = (side, slotIdx) => markDestroyed(side, slotIdx);
window._markEvoModified = (side, slotIdx) => markEvoModified(side, slotIdx);
window._markSuspendChanged = (side, slotIdx, suspended) => markSuspendChanged(side, slotIdx, suspended);
window._markBuffExpired = (cardName, type, duration) => markBuffExpired(cardName, type, duration);
window._cleanupOnline = () => cleanupOnline();

// battle-combat.jsの戦闘演出中フラグをwindow経由で公開
import { isCombatAnimating } from './battle-combat.js';
window._isCombatAnimating = isCombatAnimating;

// ===== 相手の「デッキオープン」観戦オーバーレイ =====
// 公式ルール上「オープン」効果は両プレイヤーに公開されるため、発動側と同じデザインで
// 1枚ずつめくれる演出を再生し、移動内容も逐次表示する。
let _remoteDeckOpenState = null;

function showRemoteDeckOpenOverlay(cmd) {
  console.log('[fx_remoteDeckOpenStart] received', cmd);
  // 二重表示防止
  hideRemoteDeckOpenOverlay();
  const cards = Array.isArray(cmd.cards) ? cmd.cards : [];

  // めくれ用 keyframe（既に効果テスト発動側で挿入済の可能性ありなのでガード）
  if (!document.getElementById('deck-open-flip-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'deck-open-flip-style';
    styleEl.textContent = `
      @keyframes deckOpenFlip {
        0% { transform: rotateY(0deg); }
        50% { transform: rotateY(90deg); }
        50.01% { transform: rotateY(-90deg); }
        100% { transform: rotateY(0deg); }
      }
      .deck-open-card-flipping { animation: deckOpenFlip 360ms ease-in-out forwards; transform-style: preserve-3d; }
    `;
    document.head.appendChild(styleEl);
  }

  const overlay = document.createElement('div');
  // z-index は selection UI(60000) より上、fxCardMove(66000) より下
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:65000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;pointer-events:none;animation:fadeIn 0.2s ease;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff00fb;font-size:14px;font-weight:bold;margin-bottom:4px;text-shadow:0 0 8px #ff00fb;';
  title.innerText = '👁 相手のデッキオープン (' + cards.length + '枚)';
  overlay.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'color:#ffaa00;font-size:11px;margin-bottom:10px;';
  subtitle.innerText = cmd.sourceCardName ? '「' + cmd.sourceCardName + '」の効果' : 'カード効果による';
  overlay.appendChild(subtitle);

  const cardArea = document.createElement('div');
  cardArea.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;background:rgba(20,5,30,0.85);border:1px solid #ff00fb44;border-radius:12px;padding:14px 20px;margin-bottom:10px;';
  overlay.appendChild(cardArea);

  const footer = document.createElement('div');
  footer.style.cssText = 'color:#fff;font-size:11px;opacity:0.85;min-height:14px;';
  footer.innerText = '相手がオープン中...';
  overlay.appendChild(footer);

  // 最初は裏向きで設置
  const entries = cards.map(c => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:90px;height:126px;border:2px solid #444;border-radius:6px;overflow:hidden;background:linear-gradient(135deg,#2a0a30 0%,#3a1448 50%,#2a0a30 100%);position:relative;transition:border 0.2s, box-shadow 0.2s;';
    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff00fb66;font-size:36px;font-weight:bold;text-shadow:0 0 6px #ff00fb44;';
    back.innerText = '◆';
    wrap.appendChild(back);
    cardArea.appendChild(wrap);
    return { wrap, cardNo: c.cardNo, name: c.name, imgSrc: c.imgSrc, _flipped: false, _removed: false };
  });

  document.body.appendChild(overlay);
  _remoteDeckOpenState = { overlay, cardArea, footer, entries };

  // 1枚ずつめくる（発動側と同じタイミング・速度）
  let idx = 0;
  const FLIP_INTERVAL = 220;
  const FLIP_HALFWAY = 180;
  function flipNext() {
    if (!_remoteDeckOpenState || idx >= entries.length) return;
    const entry = entries[idx++];
    entry.wrap.classList.add('deck-open-card-flipping');
    setTimeout(() => {
      if (entry._flipped) return;
      entry._flipped = true;
      while (entry.wrap.firstChild) entry.wrap.removeChild(entry.wrap.firstChild);
      entry.wrap.style.background = '#111';
      if (entry.imgSrc) {
        const img = document.createElement('img');
        img.src = entry.imgSrc;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        entry.wrap.appendChild(img);
      } else {
        const fb = document.createElement('div');
        fb.style.cssText = 'padding:6px;font-size:9px;color:#aaa;';
        fb.innerText = entry.name || '?';
        entry.wrap.appendChild(fb);
      }
    }, FLIP_HALFWAY);
    setTimeout(() => {
      entry.wrap.classList.remove('deck-open-card-flipping');
      flipNext();
    }, FLIP_INTERVAL);
  }
  flipNext();
}

function handleRemoteDeckOpenAct(cmd) {
  console.log('[fx_remoteDeckOpenAct] received', cmd);
  if (!_remoteDeckOpenState) return;
  const ent = _remoteDeckOpenState.entries.find(e => !e._removed && e.cardNo === cmd.cardNo);
  if (!ent) return;
  ent._removed = true;
  const labelMap = {
    'hand': '手札へ', 'trash': 'トラッシュへ',
    'deck_top': 'デッキの上へ', 'deck_bottom': 'デッキの下へ',
  };
  const toLabel = labelMap[cmd.to] || '???';
  if (_remoteDeckOpenState.footer) {
    _remoteDeckOpenState.footer.innerText = '📥 「' + (cmd.name || '?') + '」を ' + toLabel;
  }
  // 全宛先で fxCardMove を再生（手前で表示されるよう z-index は 66000）
  if (window._fxCardMove) {
    const imgEl = ent.wrap.querySelector('img');
    const cardObj = { name: cmd.name, cardNo: cmd.cardNo, imgSrc: imgEl ? imgEl.src : (ent.imgSrc || '') };
    const dest = labelMap[cmd.to] ? labelMap[cmd.to].replace('へ', '') : '???';
    // 発動側の操作が見えるよう、対象カードを薄くしてから演出
    ent.wrap.style.transition = 'opacity 0.15s, transform 0.15s';
    ent.wrap.style.opacity = '0.25';
    ent.wrap.style.transform = 'scale(0.92)';
    window._fxCardMove(cardObj, 'デッキ', dest, () => {
      if (ent.wrap.parentNode) ent.wrap.parentNode.removeChild(ent.wrap);
    });
  } else {
    setTimeout(() => { if (ent.wrap.parentNode) ent.wrap.parentNode.removeChild(ent.wrap); }, 350);
  }
}

function hideRemoteDeckOpenOverlay() {
  console.log('[fx_remoteDeckOpenEnd] received');
  if (!_remoteDeckOpenState) return;
  const ov = _remoteDeckOpenState.overlay;
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  _remoteDeckOpenState = null;
}
