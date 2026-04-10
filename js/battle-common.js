/**
 * battle-common.js --- battle.js / test-battle.js 共通コード
 *
 * 効果エンジン接続、window公開、フック用コールバック実装を集約
 */

// --- 依存モジュール ---
import { bs } from './battle-state.js';
import { addLog } from './battle-ui.js';
import { renderAll, showBCD, closeBCD, showTrash, updateMemGauge, setIkuCallbacks, doIkuMove } from './battle-render.js';
import { onEndTurn, skipBreedPhase, breedActionDone, showYourTurn, showPhaseAnnounce, showSkipAnnounce, doDraw, aiTurn, setPhaseHooks } from './battle-phase.js';
import { doPlay, doEvolve, doEvolveIku, canEvolveOnto, startAttack, cancelAttack, resolveAttackTarget, battleVictory, battleDefeat, showPlayEffect, showEvolveEffect, showDestroyEffect, showSecurityCheck, showBattleResult, setCombatHooks } from './battle-combat.js';
import { expireBuffs as _expireBuffsEE, applyPermanentEffects as _applyPermanentEE, triggerEffect as _triggerEffectEE, loadAllDictionaries, registerFxRunners } from './effect-engine.js';
import { getFxRunners, fxSAttackPlus, fxHatchEffect, fxRemoteEffect, fxRemoteEffectClose, fxCardMove } from './battle-fx.js';
import { sendCommand, sendStateSync, isOnlineMode } from './battle-online.js';

// ===== TRIGGER_CODE_MAP =====
export const TRIGGER_CODE_MAP = {
  '【登場時】': 'on_play', '【進化時】': 'on_evolve', '【アタック時】': 'on_attack',
  '【アタック終了時】': 'on_attack_end', '【自分のターン開始時】': 'on_own_turn_start',
  '【自分のターン終了時】': 'on_own_turn_end', '【メイン】': 'main',
  '【相手のターン開始時】': 'on_opp_turn_start', '【相手のターン終了時】': 'on_opp_turn_end',
  '【消滅時】': 'on_destroy', '【セキュリティ】': 'security',
  '【レストしたとき】': 'when_rest', '【アタックされたとき】': 'when_attacked',
  '【ブロックされたとき】': 'when_blocked', 'ブロックされた時': 'when_blocked',
  'アタックされた時': 'when_attacked',
};

// ===== makeEffectContext =====
export function makeEffectContext(card, side) {
  window._lastBattleState = bs;
  return {
    card, side, bs, addLog, renderAll, updateMemGauge,
    doDraw, showYourTurn, aiTurn,
    showPlayEffect, showEvolveEffect, showDestroyEffect,
    showSecurityCheck, showBattleResult,
  };
}

// ===== checkAndTriggerEffect =====
export function checkAndTriggerEffect(card, triggerType, callback, side, alreadyConfirmed) {
  if (!card) { callback && callback(); return; }
  if (!side) {
    const inPlayer = bs.player.battleArea.includes(card) || bs.player.tamerArea.includes(card) || bs.player.hand.includes(card);
    side = inPlayer ? 'player' : 'ai';
  }
  const triggerCode = TRIGGER_CODE_MAP[triggerType] || triggerType;
  const context = makeEffectContext(card, side);
  if (alreadyConfirmed) context.alreadyConfirmed = true;
  _triggerEffectEE(triggerCode, card, side, context, () => {
    if (isOnlineMode()) sendStateSync();
    callback && callback();
  });
}

// ===== checkTurnStartEffects =====
export function checkTurnStartEffects(side, cb) {
  bs._usedLimits = {};
  const p = side === 'player' ? bs.player : bs.ai;
  const area = [...p.battleArea, ...(p.tamerArea || [])];
  const trigger = side === 'player' ? '【自分のターン開始時】' : '【相手のターン開始時】';
  const triggerCode = side === 'player' ? 'on_own_turn_start' : 'on_opp_turn_start';
  console.log('[turnStart] side:', side, 'area:', area.map(c => c ? c.name + '(recipe:' + !!c.recipe + ')' : 'null').join(','), 'tamerArea:', (p.tamerArea||[]).map(c => c ? c.name : 'null').join(','));
  const hasRecipeTrigger = (c) => {
    if (!c.recipe) return false;
    try {
      const r = typeof c.recipe === 'string' ? JSON.parse(c.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')) : c.recipe;
      return !!(r[triggerCode]);
    } catch(_) { return false; }
  };
  const cardsWithEffect = area.filter(c => c && ((c.effect && c.effect.includes(trigger)) || hasRecipeTrigger(c)));
  console.log('[turnStart] found:', cardsWithEffect.map(c => c.name).join(',') || 'NONE');
  if (cardsWithEffect.length === 0) { cb(); return; }
  let idx = 0;
  function next() {
    if (idx >= cardsWithEffect.length) { cb(); return; }
    checkAndTriggerEffect(cardsWithEffect[idx++], trigger, next);
  }
  next();
}

// ===== checkTurnEndEffects =====
export function checkTurnEndEffects(cb) {
  const allCards = [...bs.player.battleArea, ...(bs.player.tamerArea || [])];
  const hasEndRecipe = (c) => {
    if (!c.recipe) return false;
    try { const r = typeof c.recipe === 'string' ? JSON.parse(c.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')) : c.recipe; return !!(r['on_own_turn_end']); } catch(_) { return false; }
  };
  const cardsWithEffect = allCards.filter(c => c && ((c.effect && c.effect.includes('【自分のターン終了時】')) || hasEndRecipe(c)));
  if (cardsWithEffect.length === 0) { cb(); return; }
  let idx = 0;
  function next() {
    if (idx >= cardsWithEffect.length) { cb(); return; }
    checkAndTriggerEffect(cardsWithEffect[idx++], '【自分のターン終了時】', next);
  }
  next();
}

// ===== applyPermanentEffects (wrapper) =====
export function applyPermanentEffectsWrap(side) {
  try { _applyPermanentEE(bs, side, makeEffectContext(null, side)); } catch (e) { console.error('[applyPermanentEffects]', e); }
}

// ===== expireBuffs (wrapper) =====
export function expireBuffsWrap(timing, side) {
  try { _expireBuffsEE(bs, timing, side); } catch (e) { console.error('[expireBuffs]', e); }
}

// ===== triggerEffect (wrapper) =====
export function triggerEffectWrap(code, card, side, ctx, cb) {
  try { _triggerEffectEE(code, card, side, ctx, cb); } catch (e) { console.error('[triggerEffect]', e); cb && cb(); }
}

// ===== Combat Hooks を構築 =====
export function buildCombatHooks() {
  return {
    checkAndTriggerEffect,
    makeEffectContext,
    hasKeyword: (card, kw) => card && card.effect && card.effect.includes(kw),
    hasEvoKeyword: (card, kw) => card && card.stack && card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes(kw)),
    applyPermanentEffects: applyPermanentEffectsWrap,
    expireBuffs: expireBuffsWrap,
    triggerEffect: triggerEffectWrap,
  };
}

// ===== Online Modules 用の効果系コールバック =====
export function buildOnlineEffectHooks() {
  return {
    checkTurnStartEffects,
    applyPermanentEffects: (side) => { try { _applyPermanentEE(bs, side, { bs, side }); } catch (_) {} },
    expireBuffs: (timing, side) => { try { _expireBuffsEE(bs, timing, side); } catch (_) {} },
  };
}

// ===== IkuCallbacks を構築 =====
export function buildIkuCallbacks() {
  return {
    onHatch: (card) => {
      if (isOnlineMode()) sendCommand({ type: 'hatch', cardName: card.name, cardImg: card.imgSrc || '' });
      renderAll();
      fxHatchEffect(card, () => breedActionDone());
    },
    onBreedMove: (card) => {
      if (isOnlineMode()) {
        sendCommand({ type: 'breed_move', cardName: card.name, cardImg: card.imgSrc || '' });
        sendStateSync();
      }
      try { _applyPermanentEE(bs, 'player', makeEffectContext(null, 'player')); } catch (_) {}
      renderAll();
      breedActionDone();
    },
  };
}

// ===== 共通window公開 =====
export function setupCommonWindowExports() {
  // UI系
  window.showBCD = showBCD;
  window.closeBCD = closeBCD;
  window.showTrash = showTrash;
  window.renderAll = renderAll;

  // Phase 3: フェーズ進行
  window.onEndTurn = onEndTurn;
  window.skipBreedPhase = skipBreedPhase;
  window.doIkuMove = () => { doIkuMove(); breedActionDone(); };
  window.showYourTurn = showYourTurn;
  window.showPhaseAnnounce = showPhaseAnnounce;
  window.showSkipAnnounce = showSkipAnnounce;

  // Phase 4: 戦闘
  window.doPlay = doPlay;
  window.doEvolve = doEvolve;
  window.doEvolveIku = doEvolveIku;
  window.canEvolveOnto = canEvolveOnto;
  window.startAttack = startAttack;
  window.cancelAttack = cancelAttack;
  window.resolveAttackTarget = resolveAttackTarget;
  window.battleVictory = battleVictory;
  window.battleDefeat = battleDefeat;

  // 効果エンジン連携
  window._triggerMainEffect = function(card, callback) {
    const inPlayer = bs.player.battleArea.includes(card) || bs.player.tamerArea.includes(card);
    const side = inPlayer ? 'player' : 'ai';
    try { _triggerEffectEE('main', card, side, makeEffectContext(card, side), callback); }
    catch (_) { callback && callback(); }
  };

  window._fxCardMove = fxCardMove;

  window._applyPermanentEffects = function() {
    try { _applyPermanentEE(bs, 'player', makeEffectContext(null, 'player')); } catch(_) {}
    try { _applyPermanentEE(bs, 'ai', makeEffectContext(null, 'ai')); } catch(_) {}
  };

  window._triggerEffectFn = function(triggerCode, card, side, ctx, callback) {
    const fullCtx = makeEffectContext(card, side);
    try { _triggerEffectEE(triggerCode, card, side, fullCtx, callback); }
    catch (_) { callback && callback(); }
  };

  // スクロールボタン
  window.scrollHand = function(direction) {
    const el = document.getElementById('hand-wrap');
    if (el) el.scrollBy({ left: direction * 80, behavior: 'smooth' });
  };
  window.scrollBattleRow = function(side, direction) {
    const el = document.getElementById(side + '-battle-row');
    if (el) el.scrollBy({ left: direction * 80, behavior: 'smooth' });
  };

  // HTML onclick から呼ばれる補助関数
  window.hideCardActionMenu = function() {
    const menu = document.getElementById('card-action-menu');
    const backdrop = document.getElementById('card-action-backdrop');
    if (menu) menu.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
  };
  window.closePhaseOverlay = function() {
    const el = document.getElementById('phase-desc-overlay');
    if (el) el.style.display = 'none';
  };
}

// ===== 共通セットアップ（フック接続 + 演出エンジン + window公開）=====
export function setupCommonHooks() {
  // Combat Hooks
  setCombatHooks(buildCombatHooks());

  // Phase Hooks（ターン開始/終了時効果）
  setPhaseHooks({
    checkTurnStartEffects,
    checkTurnEndEffects,
  });

  // 演出エンジン接続
  registerFxRunners(getFxRunners());

  // 育成エリア操作コールバック
  setIkuCallbacks(buildIkuCallbacks());

  // window公開
  setupCommonWindowExports();
}
