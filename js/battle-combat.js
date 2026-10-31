/**
 * battle-combat.js — 戦闘システム
 *
 * カード登場・進化・アタック・ブロック・セキュリティチェック・勝敗判定
 * AI戦闘ロジック・戦闘演出を含む
 */

import { bs, spendMemory, addMemory, isMemoryOverflow, drawCards, placeOnBattleArea, removeFromBattleArea, destroyCard, MEM_MIN, MEM_MAX } from './battle-state.js';
import { addLog, showOverlay, removeOverlay, showConfirm, showToast, showScreen } from './battle-ui.js';
import { renderAll, renderHand, updateMemGauge, updatePhaseBadge, cardImg } from './battle-render.js';
import { fxLinkEffect, fxAppGattai, fxJogressFusion, fxDigixrossFusion } from './battle-fx.js';
import { cardAliasHasName } from './name-alias.js';
import { showYourTurn, showPhaseAnnounce, doDraw, showDrawEffect, aiTurn, exitBreedPhase, checkAutoTurnEnd, setPhaseHooks } from './battle-phase.js';
import { fireOptionUsedTriggers as _fireOptionUsed } from './effect-engine.js';
import { expireBuffs as _expireBuffs, applyPermanentEffects as _applyPermanent, triggerEffect as _triggerEffect, fireOnDestroyTriggers as _fireOnDestroy, fireOnDestroySubjectReactions as _fireOnDestroySubjectReactions, fireOnBattleDestroyTriggers as _fireOnBattleDestroy, fireWhenBattleDestroyTriggers as _fireWhenBattleDestroy, fireWhenOppRestTriggers as _fireWhenOppRest, fireWhenRestTriggers as _fireWhenRest, collectOwnRestReactions as _collectOwnRestReactions, fireWhenOwnBlockTriggers as _fireWhenOwnBlock, fireWhenOwnDestroyedTriggers as _fireWhenOwnDestroyed, hasRecipeTrigger as _hasRecipeTrigger, hasEvoStackTrigger as _hasEvoStackTrigger, getEffectivePlayCost as _getEffectivePlayCost, getAltEvolve as _getAltEvolve, getBurstEvolve as _getBurstEvolve, filterBurstEvolveTamerCandidates as _filterBurstEvolveTamerCandidates, getAppGattaiEvolve as _getAppGattaiEvolve, checkBeforeEvolveDiscount as _checkBeforeEvolveDiscount, checkAbsorbEvolveDiscount as _checkAbsorbEvolveDiscount, showEffectAnnounce as _showEffectAnnounce, extractTriggerSectionText as _extractTriggerSectionText, hasNoAnnounceOverride as _hasNoAnnounceOverride, evoSourceEffectLabel as _evoSourceEffectLabel, showTargetSelection as _showTargetSelection, getAssemblyOptions as _getAssemblyOptions, filterAssemblyCandidates as _filterAssemblyCandidates, showTrashCardPicker as _showTrashCardPicker, fireKeywordAttackEffects as _fireKeywordAttackEffects, tryCancelViaLeaveBattle as _tryCancelViaLeaveBattle, hasTrainingKeyword as _hasTrainingKeyword, fireWhenSecurityDecreaseTriggers as _fireWhenSecurityDecrease, fireLinkTriggers as _fireLinkTriggers, isCardInAnyZone as _isCardInAnyZone, fireWhenEvoSourceIncreaseTriggers as _fireWhenEvoSourceIncrease, checkWhenPlayDiscount as _checkWhenPlayDiscount, checkCostedSummonDiscount as _checkCostedSummonDiscount, cardHasActivePassiveFlag as _cardHasActivePassiveFlag, fireWhenTargetChangedTriggers as _fireWhenTargetChanged, getStaticEvoCostReduction as _getStaticEvoCostReduction, getJogressConditions as _getJogressConditions, jogressSlotMatches as _jogressSlotMatches, hasCostRestPending as _hasCostRestPending, getAltUseColors as _getAltUseColors } from './effect-engine.js';

// ===== 戦闘フック =====
// 効果エンジンとの連携。Phase後半で差し替え可能

let _hooks = {
  checkAndTriggerEffect: (_card, _trigger, cb, _side) => cb(),
  makeEffectContext: (card, side) => ({ card, side, bs }),
  // テキスト一致は撤廃。日本語トリガー名 → recipe トリガーコードのマップで構造的に判定する
  hasKeyword: (card, kw) => {
    if (!card) return false;
    const map = {
      '【登場時】': 'on_play', '【進化時】': 'on_evolve',
      '【アタック時】': 'on_attack', '【アタック終了時】': 'on_attack_end',
      '【消滅時】': 'on_destroy', '【セキュリティ】': 'security',
      '【自分のターン終了時】': 'on_own_turn_end', '【相手のターン終了時】': 'on_opp_turn_end',
      '【自分のターン開始時】': 'on_own_turn_start', '【相手のターン開始時】': 'on_opp_turn_start',
      '【メイン】': 'main', '【リンク時】': 'on_link', 'リンク時': 'on_link',
    };
    const trig = map[kw];
    return trig ? _hasRecipeTrigger(card, trig) : false;
  },
  hasEvoKeyword: (card, kw) => {
    if (!card) return false;
    const map = {
      '【登場時】': 'on_play', '【進化時】': 'on_evolve',
      '【アタック時】': 'on_attack', '【アタック終了時】': 'on_attack_end',
      '【消滅時】': 'on_destroy', '【セキュリティ】': 'security',
      '【自分のターン終了時】': 'on_own_turn_end', '【相手のターン終了時】': 'on_opp_turn_end',
    };
    const trig = map[kw];
    return trig ? _hasEvoStackTrigger(card, trig) : false;
  },
  applyPermanentEffects: (side) => {
    try { _applyPermanent(bs, side, { bs, side }); } catch (_) {}
  },
  expireBuffs: (timing, ownerSide, endingSide) => {
    try { _expireBuffs(bs, timing, ownerSide, endingSide); } catch (_) {}
  },
  triggerEffect: (code, card, side, ctx, cb) => {
    try { _triggerEffect(code, card, side, ctx, cb); } catch (_) { cb && cb(); }
  },
  fireOnAttackBothSubjectTriggers: (_attackerSide, cb) => cb && cb(),
  fireOnAttackOppSubjectTriggers: (_attackerSide, cb) => cb && cb(),
};

export function setCombatHooks(hooks) {
  Object.assign(_hooks, hooks);
}

// ===== effect-engine 等から呼び出すための window 公開（循環依存回避） =====
if (typeof window !== 'undefined') {
  window._tryDecoyRedirect = function(target, ownerSide) { return _tryDecoyRedirect(target, ownerSide); };
  window._tryScapegoat = function(target, ownerSide) { return _tryScapegoat(target, ownerSide); };
  window._tryFragment = function(target, ownerSide) { return _tryFragment(target, ownerSide); };
}

// レスト発生時に when_opp_rest トリガーを発火する共通ヘルパー
// restedOwnerSide: 'player' | 'ai' — レストしたカードの所有者
// cb はトリガー処理（効果使用ダイアログ等）の完了後に呼ばれる
// restedCard（省略可）: レストしたカード。渡すと、そのカードの側の「レストしたとき」（when_rest。テティスモン EX12-030
// 進化元「このデジモンがレストしたとき」等）も続けて発火する（以前は効果でレストしたときだけ発火し、アタックでレストしても発動しなかった）
// アタック宣言でレストした: 相手側の「相手がレストしたとき」→ 自分側の「レストしたとき」（このデジモン等）
// 自分側の「レストしたとき」はここでは発揮せず、【アタック時】と同時に誘発したものとして同じ列に入れる（bs._attackRestExtras。
// battle-common.js の checkAndTriggerEffect が【アタック時】のときに window._nextTriggerExtras に渡す）
function _fireAttackRestThen(side, card, cb) {
  try {
    const entries = _collectOwnRestReactions(side, card, bs, { bs, addLog, renderAll, updateMemGauge });
    bs._attackRestExtras = entries.length > 0 ? { card, entries } : null;
  } catch (e) { console.error('[attackRest]', e); bs._attackRestExtras = null; }
  fireOppRestThen(side, cb);
}
function fireOppRestThen(restedOwnerSide, cb, restedCard) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  const own = () => {
    if (!restedCard) { cb && cb(); return; }
    try { _fireWhenRest(restedOwnerSide, restedCard, bs, ctxBase, () => cb && cb()); }
    catch (e) { console.error('[fireOppRestThen/own]', e); cb && cb(); }
  };
  try { _fireWhenOppRest(restedOwnerSide, bs, ctxBase, own); }
  catch (e) { console.error('[fireOppRestThen]', restedOwnerSide, e); own(); }
}

// ブロック専用: blocker のオーナー側のテイマー/デジモンを反応させる
function fireOwnBlockThen(blockOwnerSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenOwnBlock(blockOwnerSide, bs, ctxBase, () => cb && cb()); }
  catch (_) { cb && cb(); }
}

// ブロック発生時の総合反応: 反対側の when_opp_rest + ブロッカー所有側の when_own_block を順次発火し、
// 最後に「アタックの対象が変更されたとき」(when_target_changed) を発火する
// （公式ルール 12-1-1: ブロックは≪ブロッカー≫を持つデジモンがアタックの対象をそのデジモンに
// 変更するルール。ウルヴァモン BT26-053 / ベアキャットモン BT26-057 等）
function fireBlockReactionThen(blockerSide, cb) {
  fireOppRestThen(blockerSide, () => fireOwnBlockThen(blockerSide, () => fireTargetChangedThen(blockerSide === 'player' ? 'ai' : 'player', cb)));
}
function fireTargetChangedThen(attackerSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenTargetChanged(attackerSide, bs, ctxBase, () => cb && cb()); }
  catch (e) { console.error('[fireTargetChangedThen]', e); cb && cb(); }
}

// 自分のデジモンが消滅したとき: destroyed のオーナー側のテイマー/デジモンを反応させる
function fireOwnDestroyedThen(destroyedSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenOwnDestroyed(destroyedSide, bs, ctxBase, () => cb && cb()); }
  catch (_) { cb && cb(); }
}

// セキュリティが減ったとき: 減った側（own系）と反対側（opp/both系）のテイマー/デジモンを反応させる
// （on_security_reduced）。セキュリティチェックによる減少なので原因は「バトル」（効果ではない。
// 沢城キョウ BT26-089「効果で減っていたなら」は成立しない）
function fireSecurityDecreaseThen(decreasedSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  const cause = { type: 'battle', causerSide: decreasedSide === 'player' ? 'ai' : 'player', causerCard: null };
  try { _fireWhenSecurityDecrease(decreasedSide, bs, ctxBase, () => cb && cb(), { cause }); }
  catch (e) { console.error('[fireSecurityDecreaseThen]', decreasedSide, e); cb && cb(); }
}

// passive flag を 効果テキスト / 進化元 / _permEffects / buffs / レシピ直読み で総合判定する
// flagName: 'blocker' / 'penetrate' / 'piercing' 等
// kwBracket: '【ブロッカー】' / '【貫通】' 等（テキスト判定用、無くても可）
function hasPassiveFlag(c, flagName, kwBracket) {
  if (!c) return false;
  // テキスト一致は誤検知が多い（メタルグレイモン「【ブロッカー】を得る」やカプリモン進化元
  // 「【ブロッカー】を持つ間」も【ブロッカー】を含んでしまう）。
  // 構造的な情報（_permEffects / buffs / recipe.passive / stack[].recipe.evo_source.passive）のみで判定する。
  if (c._permEffects && c._permEffects[flagName]) return true;
  // 効果で与えられたレシピ型のキーワード（grant_effect の _grantedRecipes[].kwFlag。【衝突】等）
  if (Array.isArray(c._grantedRecipes) && c._grantedRecipes.some(g => g && g.kwFlag === flagName)) return true;
  // 【衝突】で付けたブロッカー（source:'collision'）は、そのアタックのブロック判定（強制）以外では数えない
  if (c.buffs && c.buffs.some(b => b.type === 'keyword_' + flagName && !(flagName === 'blocker' && b.source === 'collision'))) return true;
  // gate（「〜の間」条件）付きのpassiveは、条件判定済みの _permEffects（applyPermanentEffects）に任せ、
  // ここでのレシピ直読みフォールバックでは数えない（条件不成立中も有効扱いになるのを防ぐ）
  const passiveContains = (arr) => Array.isArray(arr) && arr.some(p => (p && !p.gate && !p.gate_chain && (p.flag === flagName || p === flagName)));
  const parseRecipe = (rec) => {
    if (!rec) return null;
    try {
      if (typeof rec === 'string') return JSON.parse(rec.replace(/[\x00-\x1F\x7F]\s*/g, ''));
      return rec;
    } catch (_) { return null; }
  };
  const r = parseRecipe(c.recipe);
  if (r && passiveContains(r.passive)) return true;
  if (c.stack && Array.isArray(c.stack)) {
    for (const evo of c.stack) {
      if (!evo) continue;
      const er = parseRecipe(evo.recipe);
      if (!er || !er.evo_source) continue;
      // 進化元コンテキストでは evo_source.passive のみ参照
      // top-level passive はそのカードがメインで居るときの効果なので使わない
      if (passiveContains(er.evo_source.passive)) return true;
    }
  }
  return false;
}
// 「進化元を持たない相手のデジモンにはブロックされない」の表示情報 { text, steps } を取得。
// メタルシードラモン等は本体の during_own_turn、イッカクモン(BT1-034)等は進化元の
// evo_source.during_own_turn にこの能力を持つため、両方のケースを見て正しい方の
// テキスト（本体 or 進化元カードの evoSourceEffect。display_text指定があれば最優先）を返す。
// steps はレシピ作成時の no_announce:true 判定に使う。
function _getNoEvoBlockImmunityInfo(atk) {
  if (!atk) return { text: '', steps: null };
  const parseRec = (rec) => {
    if (!rec) return null;
    try { return typeof rec === 'string' ? JSON.parse(rec.replace(/[\x00-\x1F\x7F]\s*/g, '')) : rec; }
    catch (_) { return null; }
  };
  const hasNoEvoBlockerCustom = (steps) => Array.isArray(steps) && steps.some(s => {
    const cs = String((s && s.condition) || '');
    return s && s.action === 'custom' && cs.includes('cond_no_evo') && cs.includes('opp_blocker');
  });
  const r = parseRec(atk.recipe);
  if (r && hasNoEvoBlockerCustom(r.during_own_turn)) {
    return { text: _extractTriggerSectionText(atk.effect || '', 'during_own_turn', r.during_own_turn), steps: r.during_own_turn };
  }
  if (Array.isArray(atk.stack)) {
    for (const evo of atk.stack) {
      if (!evo) continue;
      const er = parseRec(evo.recipe);
      if (er && er.evo_source && hasNoEvoBlockerCustom(er.evo_source.during_own_turn)) {
        return {
          text: _extractTriggerSectionText(evo.evoSourceEffect || '', 'during_own_turn', er.evo_source.during_own_turn),
          steps: er.evo_source.during_own_turn,
        };
      }
    }
  }
  return { text: '', steps: null };
}
// ブロッカー判定（カブテリモン等）
function isBlocker(c) { return hasPassiveFlag(c, 'blocker', '【ブロッカー】'); }
// 貫通判定（ヘラクルカブテリモン等）: アタックで撃破時に追加セキュリティチェック
function hasPenetrate(c) { return hasPassiveFlag(c, 'penetrate', '【貫通】'); }
// 道連れ判定（ヴェノムヴァンデモン等）: バトルで自分だけ消滅したとき相手も消滅
function hasMichizure(c) { return hasPassiveFlag(c, 'michizure', '【道連れ】'); }

// 消滅キャンセル試行ヘルパー
// 戻り値: { canceled: true, reason: '...' } か null。
// 公式キーワード（防壁・回避・アーマー解除）は1ターンに何度でも、ただしコスト1回ごとに消費。
// AI 側はとりあえず防壁/アーマー解除/回避すべて使う（プレイヤー側は将来確認ダイアログ化）。
// onlyBattle: true なら防壁のみチェック（バトル消滅専用）
function _tryCancelDestroy(card, ownerSidePlayer, onlyBattle, skipBarrier) {
  if (!card || !ownerSidePlayer) return null;
  // cant_destroy（消滅できない付与）: keyword_prevent_battle_destroy/keyword_prevent_destroy
  // バフを持つ場合、コスト無しで即座に消滅そのものをキャンセルする（_runWhenBattleDestroyと
  // 同じ判定をここでも行い、when_battle_destroyトリガーを持たないカードでも一般消滅
  // 判定パイプライン全体でこの保護が効くようにする）
  if (card.buffs && card.buffs.some(b => b.type === 'keyword_prevent_battle_destroy' || b.type === 'keyword_prevent_destroy')) {
    addLog('🛡 「' + card.name + '」は消滅しない！');
    return { canceled: true, reason: 'prevent_destroy' };
  }
  // 防壁（バトル消滅時、自セキュリティ1枚破棄で回避）
  if (!skipBarrier && hasBarrier(card) && ownerSidePlayer.security && ownerSidePlayer.security.length > 0) {
    var trashed = ownerSidePlayer.security.shift();
    if (trashed) ownerSidePlayer.trash.push(trashed);
    addLog('🛡 【防壁】「' + card.name + '」がセキュリティ1枚破棄で消滅回避！');
    return { canceled: true, reason: 'barrier' };
  }
  if (onlyBattle) return null;
  // アーマー解除（消滅時、進化元1枚破棄で回避）
  if (hasArmorBreak(card) && card.stack && card.stack.length > 0) {
    var ev = card.stack.pop();
    if (ev) ownerSidePlayer.trash.push(ev);
    addLog('🛡 【アーマー解除】「' + card.name + '」が進化元1枚破棄で消滅回避！');
    return { canceled: true, reason: 'armor_break' };
  }
  // 回避（消滅時、レストすることで回避）アクティブな場合のみ
  if (hasEvade(card) && !card.suspended) {
    card.suspended = true;
    addLog('🛡 【回避】「' + card.name + '」がレストして消滅回避！');
    return { canceled: true, reason: 'evade' };
  }
  // 不屈（進化元を持つこのデジモンが消滅したとき、コスト無しで再登場）
  if (hasIndomitable(card) && card.stack && card.stack.length > 0) {
    card.stack.forEach(function(s){ ownerSidePlayer.trash.push(s); });
    if (card.linkedCards) card.linkedCards.forEach(function(s){ ownerSidePlayer.trash.push(s); });
    card.stack = [];
    card.suspended = false;
    card.summonedThisTurn = false;
    addLog('💪 【不屈】「' + card.name + '」が進化元全破棄でコスト無し再登場！');
    return { canceled: true, reason: 'indomitable' };
  }
  // スケープゴート（自分の効果以外で消滅時、他デジモンを身代わりに消滅させて回避）
  if (_tryScapegoat(card, ownerSidePlayer)) {
    return { canceled: true, reason: 'scapegoat' };
  }
  return null;
}

// _tryCancelDestroy（同期の防壁/アーマー解除/回避/不屈/スケープゴート/フラグメント判定）に
// 加えて、【分離】（リンクカードを1枚破棄して回避。確認ダイアログを要するため非同期）も試す。
// リンクカードが尽きるまで何度でも発動できる（回数制限は無い＝毎回このヘルパーで判定し直す）。
// callback(result) — result は _tryCancelDestroy と同じ形（{canceled,reason} か null）
// 消滅を回避したキーワードを大きく表示する（両方の画面）。表示が終わってから cb
const _CANCEL_FLASH_LABEL = { barrier: '【防壁】', armor_break: '【アーマー解除】', evade: '【回避】', indomitable: '【不屈】', scapegoat: '【スケープゴート】' };
function _showCancelFlash(card, reason, cb, remote) {
  const done = () => { try { cb && cb(); } catch (e) { console.error('[cancelFlash]', e); } };
  const kw = _CANCEL_FLASH_LABEL[reason];
  if (!kw || typeof document === 'undefined') { done(); return; }
  if (!remote && _onlineMode && _sendCommand) { try { _sendCommand({ type: 'fx_cancelFlash', cardName: (card && card.name) || '', reason }); } catch (_) {} }
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:70500;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,0.55);pointer-events:none;animation:fadeIn 0.15s ease;';
  ov.innerHTML = '<div style="font-size:clamp(1.8rem,8vw,3.2rem);font-weight:900;color:#00fbff;text-shadow:0 0 18px #00fbff,0 0 4px #fff;letter-spacing:0.05em;">🛡 ' + kw + 'で回避！</div>'
    + '<div style="font-size:clamp(0.9rem,3.5vw,1.2rem);color:#fff;text-shadow:0 0 6px #000;">' + (remote ? '相手の' : '') + '「' + ((card && card.name) || '') + '」は消滅しない</div>';
  document.body.appendChild(ov);
  setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); done(); }, 1600);
}
if (typeof window !== 'undefined') window._showCancelFlash = _showCancelFlash;
// 効果（≪防壁≫等）で自分のセキュリティが減ったとき →「セキュリティが減ったとき」（battle-online.js の fx_barrierRequest から）
if (typeof window !== 'undefined') window._fireSecurityDecreaseByEffect = (side, card, cb) => {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenSecurityDecrease(side, bs, ctxBase, () => cb && cb(), { cause: { type: 'effect', causerSide: side, causerCard: card } }); }
  catch (e) { console.error('[secDecreaseByEffect]', e); cb && cb(); }
};
function _tryCancelDestroyAsync(card, ownerSidePlayer, side, onlyBattle, callback0) {
  // キーワードで回避したら「【防壁】で回避！」等を大きく出してから続ける
  const callback = (r) => {
    if (r && r.canceled && _CANCEL_FLASH_LABEL[r.reason]) { _showCancelFlash(card, r.reason, () => callback0(r)); return; }
    callback0(r);
  };
  // ≪防壁≫は任意（公式ルール 25-3「自分のセキュリティを上から1枚破棄することで」は任意処理条件）。
  // プレイヤーのデジモンなら使うかを確認する（以前は確認なしで必ず使っていた）。使ったら「セキュリティが減ったとき」も誘発する
  const _prevented = !!(card && card.buffs && card.buffs.some(b => b && (b.type === 'keyword_prevent_battle_destroy' || b.type === 'keyword_prevent_destroy')));
  if (side === 'player' && !_prevented && card && hasBarrier(card) && ownerSidePlayer && Array.isArray(ownerSidePlayer.security)
      && ownerSidePlayer.security.length > 0 && typeof window !== 'undefined' && typeof window._showEffectConfirm === 'function') {
    const rule = (window._keywordRuleText && window._keywordRuleText('barrier')) || '【防壁】このデジモンがバトルで消滅するとき、自分のセキュリティを上から1枚破棄することで、消滅しない';
    window._showEffectConfirm(card, rule + '\n\nセキュリティを上から1枚破棄して【防壁】を使いますか？', (yes) => {
      if (!yes) { addLog('☓ 【防壁】を使わない'); _proceed(true); return; }
      const trashed = ownerSidePlayer.security.shift();
      if (trashed) ownerSidePlayer.trash.push(trashed);
      addLog('🛡 【防壁】「' + card.name + '」がセキュリティ1枚破棄で消滅回避！（残り' + ownerSidePlayer.security.length + '枚）');
      renderAll(); _dispatchStateSync();
      const ctxBase = { bs, addLog, renderAll, updateMemGauge };
      const cause = { type: 'effect', causerSide: side, causerCard: card };
      const _fin = () => callback({ canceled: true, reason: 'barrier' });
      try { _fireWhenSecurityDecrease(side, bs, ctxBase, _fin, { cause }); } catch (e) { console.error('[barrier secDecrease]', e); _fin(); }
    });
    return;
  }
  // オンラインの相手のデジモンの≪防壁≫: 使うかは持ち主が決め、持ち主の端末が自分のセキュリティを破棄する
  // （以前はこちらの端末が確認なしで使い、こちらの画面の相手のセキュリティだけを1枚減らしていたため、
  // 両方の画面でセキュリティの枚数が違っていた。クーガモン BT26-026）
  if (side === 'ai' && _onlineMode && !_prevented && card && hasBarrier(card) && ownerSidePlayer && Array.isArray(ownerSidePlayer.security)
      && ownerSidePlayer.security.length > 0 && typeof window._requestRemoteBarrier === 'function') {
    const slotIdx = (ownerSidePlayer.battleArea || []).indexOf(card);
    window._requestRemoteBarrier(card, slotIdx, (used) => {
      if (!used) { addLog('☓ 相手は【防壁】を使わなかった'); _proceed(true); return; }
      // 相手の端末で破棄済み。こちらの画面の相手のセキュリティも1枚減らす（同期が先に届いていれば減らさない）
      if (typeof used === 'object' && typeof used.remaining === 'number') {
        while (ownerSidePlayer.security.length > used.remaining) { const t = ownerSidePlayer.security.shift(); if (t) ownerSidePlayer.trash.push(t); }
      }
      addLog('🛡 【防壁】相手の「' + card.name + '」がセキュリティ1枚破棄で消滅回避！');
      renderAll();
      callback({ canceled: true, reason: 'barrier' });
    });
    return;
  }
  _proceed(false);
  function _proceed(skipBarrier) {
  var syncResult = _tryCancelDestroy(card, ownerSidePlayer, onlyBattle, skipBarrier || (side === 'ai' && _onlineMode));
  if (syncResult) { if (syncResult.reason === 'barrier') { renderAll(); _dispatchStateSync(); } callback(syncResult); return; }
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  // バトルで負けて離れる（≪デコード≫等「バトル以外でバトルエリアを離れるとき」は発揮しない。effect-engine.js が見る）
  bs._leaveByBattle = true;
  try {
    _tryCancelViaLeaveBattle(card, side, bs, ctxBase, (canceled) => {
      bs._leaveByBattle = false;
      // 相手の端末で「離れるとき」により進化していれば、相手側に【進化時】の保留が残っている
      if (canceled && side === 'ai' && _onlineMode) bs._oppDeferredEvoPending = true;
      callback(canceled ? { canceled: true, reason: 'protection' } : null);
    });
  } catch (_) { bs._leaveByBattle = false; callback(null); }
  }
}

// オンラインのブロック解決（battle-online.js の resolveOnlineBlock。防御側の端末でバトルを解決する）から、
// バトルで消滅するカードの消滅回避を確認するための入口。callback(true)=消滅を回避した
if (typeof window !== 'undefined') {
  window._tryCancelBattleDestroy = (card, side, callback) => {
    const owner = side === 'ai' ? bs.ai : bs.player;
    try { _tryCancelDestroyAsync(card, owner, side, false, (r) => callback(!!r)); }
    catch (_) { callback(false); }
  };
}

// 両者消滅（DP同値）用: 防壁/回避/【分離】/「バトルエリアを離れるとき」の置換効果（_tryCancelDestroyAsync）を
// 先に試し、回避できなければ when_battle_destroy / when_destroy（_runWhenBattleDestroy）を確認する。
// 片方だけ勝つ分岐は以前からこの順で確認していたが、両者消滅の分岐では離れるときの置換効果を見ておらず
// 不発になっていた（巨神兵器 BT26-085「離れるとき、デストロイモードに進化させることで離れない」等）
function _runBattleDestroyAvoid(side, card, onDestroy, onCancel0) {
  // 消滅を回避したら、先に出していた消滅時効果の「発揮待ち」予告を外す
  const onCancel = () => { if (typeof window._hudClearDestroyPreview === 'function') window._hudClearDestroyPreview(card); onCancel0(); };
  const owner = side === 'ai' ? bs.ai : bs.player;
  _tryCancelDestroyAsync(card, owner, side, false, (canceled) => {
    if (canceled) { addLog('🛡 「' + card.name + '」が消滅を回避'); renderAll(); onCancel(); return; }
    _runWhenBattleDestroy(side, card, onDestroy, onCancel);
  });
}

// when_battle_destroy / when_destroy トリガーを発火し、コスト払いでバフが付与されていれば
// 消滅をキャンセルする。when_destroyは原因を問わず発火する汎用トリガー（フラグメント等）
// のため、バトルでの消滅時もここで確認する（効果消滅時はeffect-engine.jsのdoDestroy側で
// 同様に確認する。原因を指定しないレシピはどちらの消滅経路でも発動する）。
// onDestroy: 消滅実行コールバック / onCancel: 消滅回避コールバック
function _runWhenBattleDestroy(side, card, onDestroy, onCancel) {
  const hasWBD = _hasRecipeTrigger(card, 'when_battle_destroy');
  const hasWD = _hasRecipeTrigger(card, 'when_destroy');
  if (!hasWBD && !hasWD) { onDestroy(); return; }
  const ctxWBD = _hooks.makeEffectContext(card, side);
  // 置換効果（「〜することで、消滅しない」）で付いた「消滅しない」は、この消滅を防ぐだけで外す（ターン終了まで残さない）
  const _wbBefore = new Set(Array.isArray(card.buffs) ? card.buffs : []);
  const checkPrevented = () => {
    const prevented = !!(card.buffs && card.buffs.some(b =>
      b.type === 'keyword_prevent_battle_destroy' || b.type === 'keyword_prevent_destroy'
    ));
    if (Array.isArray(card.buffs)) {
      card.buffs = card.buffs.filter(b => _wbBefore.has(b) || !(b && (b.type === 'keyword_prevent_destroy' || b.type === 'keyword_prevent_battle_destroy')));
    }
    return prevented;
  };
  const finish = () => {
    if (checkPrevented()) {
      addLog('🛡 「' + card.name + '」はコストを払い消滅を回避！');
      onCancel();
    } else {
      onDestroy();
    }
  };
  const fireWhenDestroyThenFinish = () => {
    if (!hasWD) { finish(); return; }
    _hooks.triggerEffect('when_destroy', card, side, ctxWBD, finish);
  };
  if (hasWBD) {
    _hooks.triggerEffect('when_battle_destroy', card, side, ctxWBD, () => {
      if (checkPrevented()) {
        addLog('🛡 「' + card.name + '」はコストを払い消滅を回避！');
        onCancel();
        return;
      }
      fireWhenDestroyThenFinish();
    });
  } else {
    fireWhenDestroyThenFinish();
  }
}

// ≪連携≫の処理: アタック時、他のアクティブデジモン1体をレストさせて
// そのアタックの終了まで DP+(対象DP) と Sアタック+1 を一時付与する (総合ルール 24-1)。
// 以前は「このターン」で付与していたうえ付与した側の情報が無く、ターン終了でも消えずに残っていた
// target 省略時（CPU）は先頭のアクティブなデジモン
function _tryCombo(atk, ownerSidePlayer, target) {
  if (!atk || !hasCombo(atk) || !ownerSidePlayer) return false;
  if (!target) {
    var others = [];
    for (var i = 0; i < ownerSidePlayer.battleArea.length; i++) {
      var c = ownerSidePlayer.battleArea[i];
      if (c && c !== atk && !c.suspended && !c.cantRest) others.push(c);
    }
    if (others.length === 0) return false;
    target = others[0];
  }
  target.suspended = true;
  var addedDp = parseInt(target.dp) || 0;
  if (!atk.buffs) atk.buffs = [];
  atk.buffs.push({ type: 'dp_plus', value: addedDp, duration: 'dur_until_attack_end', source: 'combo' });
  atk.buffs.push({ type: 'security_attack_plus', value: 1, duration: 'dur_until_attack_end', source: 'combo' });
  if (atk.baseDp == null) atk.baseDp = parseInt(atk.dp) || 0;
  var mod = 0;
  atk.buffs.forEach(function(b){
    if (b.type === 'dp_plus') mod += (parseInt(b.value) || 0);
    if (b.type === 'dp_minus') mod -= (parseInt(b.value) || 0);
  });
  atk.dpModifier = mod;
  atk.dp = atk.baseDp + mod;
  addLog('🤝 【連携】「' + atk.name + '」が「' + target.name + '」をレスト。DP+' + addedDp + ' & Sアタック+1');
  return true;
}

// ≪デコイ≫の処理: 自分の他のデジモンが効果消滅するとき、デコイ持ちが身代わりに消滅
// (公式 18-18, 簡易実装: 色指定無視)
// 戻り値: { redirected:true, decoyCard, decoySlotIdx } or null
function _tryDecoyRedirect(destroyTarget, ownerSidePlayer) {
  if (!destroyTarget || !ownerSidePlayer) return null;
  var ba = ownerSidePlayer.battleArea;
  for (var i = 0; i < ba.length; i++) {
    var c = ba[i];
    if (!c || c === destroyTarget) continue;
    if (hasDecoy(c)) {
      addLog('🛡 【デコイ】「' + c.name + '」が「' + destroyTarget.name + '」の身代わりに消滅');
      return { redirected: true, decoyCard: c, decoySlotIdx: i };
    }
  }
  return null;
}

// ≪スケープゴート≫の処理: 自分の効果以外で消滅するとき、他のデジモン1体を消滅で回避
// (公式 18-32, 簡易実装: 効果元判別省略)
function _tryScapegoat(destroyTarget, ownerSidePlayer) {
  if (!destroyTarget || !ownerSidePlayer || !hasScapegoat(destroyTarget)) return false;
  var ba = ownerSidePlayer.battleArea;
  for (var i = 0; i < ba.length; i++) {
    var c = ba[i];
    if (!c || c === destroyTarget) continue;
    ba[i] = null;
    ownerSidePlayer.trash.push(c);
    if (c.stack) c.stack.forEach(function(s){ ownerSidePlayer.trash.push(s); });
    if (c.linkedCards) c.linkedCards.forEach(function(s){ ownerSidePlayer.trash.push(s); });
    addLog('🛡 【スケープゴート】「' + destroyTarget.name + '」が「' + c.name + '」を身代わりにして回避');
    return true;
  }
  return false;
}

// その他キーワード判定（フェーズ1〜2 実装分）
function hasRush(c)         { return hasPassiveFlag(c, 'rush', '【速攻】'); }
function hasJamming(c)      { return hasPassiveFlag(c, 'jamming', '【ジャミング】'); }
function hasCharge(c)       { return hasPassiveFlag(c, 'charge', '【進撃】'); }
function hasEvade(c)        { return hasPassiveFlag(c, 'evade', '【回避】'); }
function hasBarrier(c)      { return hasPassiveFlag(c, 'barrier', '【防壁】'); }
function hasArmorBreak(c)   { return hasPassiveFlag(c, 'armor_break', '【アーマー解除】'); }
function hasIndomitable(c)  { return hasPassiveFlag(c, 'indomitable', '【不屈】'); }
// プレイヤーの≪連携≫（任意）: アタック宣言のあと「【連携】を使いますか？」を確認し、「はい」なら連携させる
// デジモン（他のアクティブな自分のデジモン）を盤面で選んでレストさせ、そのDPとSアタック+1をアタック終了まで得る
function _askCombo(atk, done) {
  const finish = () => { try { done && done(); } catch (e) { console.error('[askCombo]', e); } };
  if (!atk || !hasCombo(atk)) { finish(); return; }
  const cands = [];
  bs.player.battleArea.forEach((c, i) => { if (c && c !== atk && !c.suspended && !c.cantRest) cands.push(i); });
  if (cands.length === 0) { finish(); return; }
  const rule = (window._keywordRuleText && window._keywordRuleText('combo')) || '【連携】このデジモンがアタックしたとき、他の自分のデジモン1体をレストさせることで、そのアタックの終了まで、このデジモンにレストさせたデジモンのDPをプラスし、≪Sアタック+1≫を得る';
  const ask = window._showEffectConfirm || ((c, t, cb) => cb(true));
  ask(atk, rule + '\n\n【連携】を使いますか？', (yes) => {
    if (!yes) { addLog('☓ 【連携】を使わない'); finish(); return; }
    const pick = (idx) => {
      const tgt = bs.player.battleArea[idx];
      if (tgt) _tryCombo(atk, bs.player, tgt);
      renderAll();
      if (_onlineMode && typeof window._onlineSendStateSync === 'function') { try { window._onlineSendStateSync(); } catch (_) {} }
      finish();
    };
    if (cands.length === 1) { pick(cands[0]); return; }
    _showTargetSelection('pl', cands, null, '#00ff88', (idx) => {
      if (idx === null || idx === undefined) { finish(); return; }
      pick(idx);
    }, '（【連携】でレストさせるデジモン）');
  });
}
function hasCombo(c)        { return hasPassiveFlag(c, 'combo', '【連携】'); }
function hasDecoy(c)        { return hasPassiveFlag(c, 'decoy', '【デコイ】'); }
function hasScapegoat(c)    { return hasPassiveFlag(c, 'scapegoat', '【スケープゴート】'); }

// ===== オンラインモード参照 =====
let _onlineMode = false;
let _onlineMyKey = null;
let _sendCommand = null;
let _sendStateSync = null;
let _sendMemoryUpdate = null;

export function setCombatOnlineHandlers(online, myKey, handlers = {}) {
  _onlineMode = online;
  _onlineMyKey = myKey;
  _sendCommand = handlers.sendCommand || null;
  _sendStateSync = handlers.sendStateSync || null;
  _sendMemoryUpdate = handlers.sendMemoryUpdate || null;
}

// 内部dispatcher: handlers経由で注入されたbattle-online.jsのsendStateSync/sendMemoryUpdate本体を呼ぶ
// 名前を本体と分けるのは、grepで本体と取り違えないようにするため
function _dispatchStateSync() { if (_onlineMode && _sendStateSync) _sendStateSync(); }
function _dispatchMemoryUpdate() { if (_onlineMode && _sendMemoryUpdate) _sendMemoryUpdate(); }

// ===== 戦闘演出背景（ちらつき防止） =====

let _combatAnimating = false;
export function isCombatAnimating() { return _combatAnimating; }

function showCombatBackdrop() {
  _combatAnimating = true;
  let bd = document.getElementById('_combat-backdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = '_combat-backdrop';
    bd.style.cssText = 'position:fixed;inset:0;background:#000;z-index:46999;';
    document.body.appendChild(bd);
  }
  bd.style.display = 'block';
}

// 道連れアナウンス: combat-backdrop(46999) の上に出すため独立z-indexで実装
// オンライン時は相手画面にも fx_michizure を送って同じ演出を再生
function showMichizureAnnounce(callback) {
  if (_onlineMode && _sendCommand && !window._suppressFxSend) {
    try { _sendCommand({ type: 'fx_michizure' }); } catch (_) {}
  }
  const overlay = document.createElement('div');
  overlay.id = '_michizure-announce';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:48000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,0.55);';
  const text = document.createElement('div');
  text.style.cssText = 'font-size:clamp(1.6rem,7vw,3.2rem);font-weight:900;color:#ff5577;letter-spacing:6px;text-shadow:0 0 20px #ff5577,0 0 40px #aa0033,0 0 60px #aa0033;animation:phaseSlideIn 1.4s ease forwards;';
  text.innerText = '💀 道連れ！';
  overlay.appendChild(text);
  const _kwRule = !!(window._appendKeywordRuleLine && window._appendKeywordRuleLine(overlay, 'michizure'));
  document.body.appendChild(overlay);
  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback && callback();
  }, _kwRule ? 2600 : 1200);
}
// window から呼べるように公開（battle-online.js のオンラインブロック処理で使う）
if (typeof window !== 'undefined') window._showMichizureAnnounce = showMichizureAnnounce;

// 貫通アナウンス: combat-backdrop(46999) の上に出すため独立z-indexで実装
function showPenetrateAnnounce(callback) {
  // オンライン: 相手画面にも演出を送る
  if (_onlineMode && _sendCommand && !window._suppressFxSend) {
    try { _sendCommand({ type: 'fx_penetrate' }); } catch (_) {}
  }
  const overlay = document.createElement('div');
  overlay.id = '_penetrate-announce';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:48000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,0.55);';
  const text = document.createElement('div');
  text.style.cssText = 'font-size:clamp(1.6rem,7vw,3.2rem);font-weight:900;color:#ff9900;letter-spacing:6px;text-shadow:0 0 20px #ff9900,0 0 40px #ff5500,0 0 60px #ff5500;animation:phaseSlideIn 1.4s ease forwards;';
  text.innerText = '🗡 貫通！';
  overlay.appendChild(text);
  const _kwRule = !!(window._appendKeywordRuleLine && window._appendKeywordRuleLine(overlay, 'penetrate'));
  document.body.appendChild(overlay);
  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback && callback();
  }, _kwRule ? 2800 : 1400);
}

// セキュリティデジモンとのバトルに勝ったときの「バトルに勝ったとき」（レシピ on_win_battle_any）。
// 「バトルで相手のデジモンを消滅させたとき」（on_win_battle）はセキュリティデジモンが消滅しないので発動しない。
// オンラインで相手のデジモンの勝利は相手の端末（持ち主）が処理する
function _fireSecurityBattleWin(atk, side, sec, next) {
  if (!atk || (side === 'ai' && _onlineMode)) { next && next(); return; }
  const area = side === 'player' ? bs.player.battleArea : bs.ai.battleArea;
  if (!area.includes(atk)) { next && next(); return; }
  bs._lastBattleWinner = atk;
  bs._lastBattleDefeatedCard = sec;
  const end = () => { bs._lastBattleWinner = null; bs._lastBattleDefeatedCard = null; renderAll(); next && next(); };
  try {
    const winCtx = _hooks.makeEffectContext(atk, side);
    _hooks.triggerEffect('on_battle_win_security', atk, side, winCtx, end);
  } catch (e) { console.error('[_fireSecurityBattleWin]', e); end(); }
}

function hideCombatBackdrop() {
  _combatAnimating = false;
  const bd = document.getElementById('_combat-backdrop');
  if (bd) bd.style.display = 'none';
}

// ===== キーワード判定ヘルパー =====

function hasKeyword(card, kw) { return _hooks.hasKeyword(card, kw); }
function hasEvoKeyword(card, kw) { return _hooks.hasEvoKeyword(card, kw); }

// ===== 自分のカード除去 =====

function removeOwnCard(slotIdx, reason) {
  const card = bs.player.battleArea[slotIdx];
  if (!card) return;
  bs.player.battleArea[slotIdx] = null;
  bs.player.trash.push(card);
  if (card.stack) card.stack.forEach(s => bs.player.trash.push(s));
  _dumpLinkedCardsUnlessDeferred(card, bs.player.trash);
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'own_card_removed', slotIdx, reason: reason || 'destroy' });
}

// リンクカードをトラッシュへ送る（消滅・バウンス等、バトルエリアを離れる全処理の共通部分）。
// 【分離】は「消滅自体をキャンセルする」効果のため、ここに到達している時点で既に
// _tryCancelDestroyAsync（呼び出し元）が判定済み＝消滅は確定している。よって
// ここでは常に一括破棄してよい
function _dumpLinkedCardsUnlessDeferred(card, trashArr) {
  if (!card || !Array.isArray(card.linkedCards) || card.linkedCards.length === 0) return;
  card.linkedCards.forEach(s => trashArr.push(s));
}

// オプションカード（デュアルのオプションとしての使用を含む）を使用し、その【メイン】を解決した後の
// 「オプションカードを使用したとき」（on_option_used。サクヤモン：巫女モードACE LM-023）
function _afterOptionUsed(side, cb) {
  try { _fireOptionUsed(side, bs, { bs, addLog, renderAll, updateMemGauge }, () => cb && cb()); }
  catch (e) { console.error('[on_option_used]', e); cb && cb(); }
}

// ===== オプション使用の色条件チェック =====
// 公式ルール: オプションカードを使用するには、場（バトルエリア/テイマーエリア/育成エリア）に
// そのオプションと同じ色のカードが1枚以上必要（無ければ使用できない）。
// 「使用条件」（基本形=「特徴：〇〇」）を満たせばこの色条件を無視できる。
// 複雑な文章形式の使用条件はレシピ側（use_cond）で個別対応する想定（現状は基本形のみ）。
function hasMatchingColorInPlay(optionCard, side) {
  const p = side === 'player' ? bs.player : bs.ai;
  if (!p) return true;
  const optColors = String(optionCard.color || '').split('').filter(Boolean);
  if (optColors.length === 0) return true; // 色情報が無いカードはチェック対象外
  // 「このカードは黒でも色条件を満たせる」（メモリーブースト LM-033〜053 の passive alt_use_color）: その色も持つものとして判定
  try { _getAltUseColors(optionCard, bs, side).forEach(c => { if (!optColors.includes(c)) optColors.push(c); }); } catch (e) { console.error('[alt_use_color]', e); }
  const areaCards = [...(p.battleArea || []), ...(p.tamerArea || [])].filter(Boolean);
  if (p.ikusei) areaCards.push(p.ikusei);
  return areaCards.some(c => {
    const cColors = String(c.color || '');
    return optColors.some(oc => cColors.includes(oc));
  });
}

// 「使用条件」欄（基本形）から特徴名を取り出す。"特徴：〇〇" / "特徴:〇〇" / "特徴「〇〇」" に対応
function parseUseCondFeature(useCond) {
  const list = parseUseCondFeatures(useCond);
  return list.length > 0 ? list[0] : null;
}
// 「使用条件」の特徴（複数可）。「特徴「NSp」「DS」「NSo」…」（巨大肉 EX12-073）/「特徴：A/B」/「特徴「A」」
function parseUseCondFeatures(useCond) {
  if (!useCond) return [];
  const s = String(useCond);
  const at = s.search(/特徴/);
  if (at < 0) return [];
  const rest = s.slice(at + 2);
  const quoted = [...rest.matchAll(/「([^」]+)」/g)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length > 0) return quoted;
  const m = rest.match(/^[:：]\s*(.+?)\s*$/);
  return m ? m[1].split(/[\/／、,]/).map(x => x.trim()).filter(Boolean) : [];
}

// 「このカードは色条件を無視できる」（passive flag 'ignore_evolve_color'。gate 成立中のみ）。
// ダーク・フィールド BT26-100「自分の表向きのセキュリティがない間、このカードは色条件を無視できる」:
// オプションなら使用時の色条件、デジモンなら進化条件の色の部分（進化先として）を無視する
function _ignoresColorCondition(card, side) {
  if (!card || !card.recipe) return false;
  try { return !!_cardHasActivePassiveFlag(card, 'ignore_evolve_color', bs, side); } catch (_) { return false; }
}
// カードの持ち主（手札/トラッシュ/場のどちらの陣営にあるか）。見つからなければ 'player'
function _ownerSideOfCard(card) {
  if (!bs || !card) return 'player';
  const p = bs.ai;
  if (p && ((p.hand || []).includes(card) || (p.trash || []).includes(card) || (p.battleArea || []).includes(card) || (p.tamerArea || []).includes(card) || p.ikusei === card)) return 'ai';
  return 'player';
}

// 使用条件（特徴：〇〇）を満たすか＝場に該当特徴を持つカードがあれば色条件を無視できる
function meetsUseCondition(optionCard, side) {
  const features = parseUseCondFeatures(optionCard.useCond);
  if (features.length === 0) return false;
  const p = side === 'player' ? bs.player : bs.ai;
  if (!p) return false;
  const areaCards = [...(p.battleArea || []), ...(p.tamerArea || [])].filter(Boolean);
  if (p.ikusei) areaCards.push(p.ikusei);
  // 特徴は「/」区切りで1つずつ比べる（「ME」が「MEW」等に部分一致しないように）
  return areaCards.some(c => { const fs = String(c.feature || '').split(/[\/／]/).map(x => x.trim()); return features.some(f => fs.includes(f)); });
}

// ===== 進化条件チェック =====

// 名称マッチング用に、カード名から「：」以降（サブタイトル/派生形表記）を除いた
// 基本名を取り出す。例: "アイギオテュースモン：ホーリー" → "アイギオテュースモン"。
// 「：」が無い名前（例: "オメガモンX抗体"）はそのまま1つの名称として扱う。
function _baseCardName(name) {
  const s = String(name || '');
  const i = s.indexOf('：');
  return i === -1 ? s : s.slice(0, i);
}

// baseCard（進化させるデジモン自身）の名称が reqName に一致するか判定する（「：」以降を除いた基本名で比較）。
// 進化条件の名称はそのデジモン自身の名称で判定し、進化元（重ねられているカード）の名称は見ない
// （以前は進化元も見ていたため、進化元に「ケルベロモン」を持つプルートモン Lv.6 等へ
// ケルベロモン：人狼モード BT26-056 がアーツ進化できてしまっていた）。
// exact=true: 基本名がreqNameと完全一致（デフォルト。例: "アイギオモン"→"アイギオモン"のみ）
// exact=false: 基本名がreqNameを含む（部分一致。"〜を含む"と書かれたときだけ使う。
//              例: "アイギオモンを含む"→"コアイギオモン"等も対象になる）
function _cardHasEvolveName(baseCard, reqName, exact) {
  const test = exact ? (n => n === reqName) : (n => n.includes(reqName));
  // 「としても扱う」名称（エイリアス）もチェックする。「〜を含むものとしても扱う」は部分一致のときだけ
  // （公式ルール 2-3-4-4-1: 名称「X」を含むものとしても扱うカードは、名称が「X」のカードではない）
  const matches = (c) => test(_baseCardName(c.name)) || cardAliasHasName(c, reqName, exact);
  return matches(baseCard);
}

// 「〜の記述がある」判定用。baseCard自身のカード情報一覧の各テキスト列
// （名前・特徴・効果テキスト・進化元テキスト・セキュリティテキスト）のいずれかに
// reqText という文字列が含まれていればtrue（公式ルール：カード上のどこかに記述が
// あればOK）。
function _cardHasDescription(baseCard, reqText) {
  const fields = [baseCard.name, baseCard.feature, baseCard.effect, baseCard.evoSourceEffect, baseCard.securityEffect];
  return fields.some(f => String(f || '').includes(reqText));
}

// クローズ末尾の「カード名」指定を読み取る。"「アイギオモン」を含む" のように末尾に
// "を含む" が付いていれば部分一致、無ければ完全一致（デフォルト）として扱う。
// 戻り値: マッチが無ければ null、あれば { name, exact }
function _parseNameSuffix(text) {
  const m = text.match(/「(.+?)」\s*(を含む)?\s*$/);
  if (!m) return null;
  return { name: m[1], exact: !m[2] };
}

// 特徴クローズ（例: "特徴:グローイングドーンLv.5" / "特徴「グローイングドーン」Lv.5"）が
// baseCardに一致するか判定する。
function _matchFeatureClause(c, baseCard) {
  const featureMatch = c.match(/特徴[:：「]\s*(.+?)」?\s*Lv\.(\d+)/);
  if (!featureMatch) return false;
  const reqFeature = featureMatch[1].trim();
  const reqLevel = featureMatch[2];
  const baseLevel = String(baseCard.level).trim();
  if (baseLevel !== reqLevel) return false;
  const baseFeature = String(baseCard.feature || '');
  if (!baseFeature.includes(reqFeature)) return false;
  // カード名の追加指定（例: "特徴:XLv.5「カード名」"）。特徴名自体の「」と混同しない
  // よう、featureMatch本体より後ろの残り文字列だけを対象に判定する
  const remainder = c.slice(featureMatch.index + featureMatch[0].length);
  const nameSuffix = _parseNameSuffix(remainder);
  if (nameSuffix && !_cardHasEvolveName(baseCard, nameSuffix.name, nameSuffix.exact)) return false;
  return true;
}

// 色クローズ（例: "赤Lv.5" / "Lv.5"=色不問）がbaseCardに一致するか判定する。
function _matchColorClause(c, baseCard, ignoreColor) {
  const m = c.match(/([赤青黄緑黒紫白]+)?Lv\.(\d+)/);
  if (!m) return false;
  const reqColor = m[1] || '';
  const reqLevel = m[2];
  // baseCard.level にスプレッドシート由来の前後空白（全角スペース含む）が
  // 混入していると文字列比較が外れるため trim で正規化する
  const baseLevel = String(baseCard.level).trim();
  const baseColor = baseCard.color || '';
  if (baseLevel !== reqLevel) return false;
  // 進化先が「色条件を無視できる」（ignore_evolve_color）なら色の部分は判定しない
  if (reqColor && !ignoreColor && !baseColor.includes(reqColor)) return false;
  const remainder = c.slice(m.index + m[0].length);
  const nameSuffix = _parseNameSuffix(remainder);
  if (nameSuffix && !_cardHasEvolveName(baseCard, nameSuffix.name, nameSuffix.exact)) return false;
  return true;
}

// 名称クローズ（例: "名称「アイギオモン」"=完全一致 / "名称「アイギオモン」を含む"=部分一致）が
// baseCardに一致するか判定する。色クローズ・特徴クローズと違ってLv指定が無い（レベル不問）。
// コロン記法（"名称:アイギオモン"）はブラケット無しなので常に完全一致扱い。
function _matchNameClause(c, baseCard) {
  const bracket = c.match(/名称[:：]?\s*「(.+?)」\s*(を含む)?\s*$/);
  if (bracket) return _cardHasEvolveName(baseCard, bracket[1].trim(), !bracket[2]);
  const plain = c.match(/名称[:：]\s*(.+?)\s*$/);
  if (!plain) return false;
  return _cardHasEvolveName(baseCard, plain[1].trim(), true);
}

// 登場コスト＋名称クローズ（例: "登場コスト12の「ケレスモン」"）がbaseCardに一致するか判定する。
// Lv・色は問わず、進化元の「登場コスト」の値とカード名の両方で絞り込む特殊パターン。
// 名称部分は「を含む」の有無で完全一致/部分一致を切り分ける（他のクローズと同様）。
function _matchPlayCostClause(c, baseCard) {
  const m = c.match(/登場コスト(\d+)の/);
  if (!m) return false;
  const reqCost = parseInt(m[1], 10);
  const baseCost = (baseCard.playCost != null) ? baseCard.playCost : (baseCard.cost || 0);
  if (baseCost !== reqCost) return false;
  const remainder = c.slice(m.index + m[0].length);
  const nameSuffix = _parseNameSuffix(remainder);
  if (!nameSuffix) return false; // 名称指定が無いと進化元を絞りきれないため不成立
  return _cardHasEvolveName(baseCard, nameSuffix.name, nameSuffix.exact);
}

// 名称＋登場コストクローズ（例: "巨神兵器：コスト5" = "名称：巨神兵器"と同義で、
// 「：コストN」部分はbaseCardの絞り込みには使わない（進化コスト（名称）列に転記済みの
// 値を条件文中でも明示しているだけ）。名前一致のみで判定する。
function _matchNameCostClause(c, baseCard) {
  const m = c.match(/^(.+?)：コスト\d+$/);
  if (!m) return false;
  return _cardHasEvolveName(baseCard, m[1].trim(), true);
}

// 「「XXX」の記述があるLvN」クローズ（例: "「クロノモン」の記述があるLv.6"）が
// baseCardに一致するか判定する。「記述がある」はカード情報一覧の各テキスト列の
// いずれかにXXXがあればOKという公式ルール。色指定が無いことが多く名称クローズに近い
// ため 'name' 種別に含める（コスト列は進化コスト（名称）列を共用）。
function _matchDescriptionClause(c, baseCard, ignoreColor) {
  const m = c.match(/^([赤青黄緑黒紫白]+)?「(.+?)」の記述がある(?:Lv\.(\d+))?$/);
  if (!m) return false;
  const reqColor = m[1] || '';
  const reqText = m[2];
  const reqLevel = m[3];
  if (reqLevel != null && String(baseCard.level).trim() !== reqLevel) return false;
  if (reqColor && !ignoreColor && !String(baseCard.color || '').includes(reqColor)) return false;
  return _cardHasDescription(baseCard, reqText);
}

// クローズの文字列から種別（'feature'|'name'|'color'）を判定する。
// 「登場コストNの『XXX』」（登場コスト＋名称の複合クローズ）「XXX：コストN」
// （名称＋登場コストの複合クローズ、例:"巨神兵器：コスト5"）「「XXX」の記述がある」
// （記述クローズ）も、いずれも色指定が無い（or 必須ではない）クローズなので、コスト列は
// 名称クローズと共用する（進化コスト列を増やしすぎないため）ので 'name' に含める。
function _clauseType(c) {
  if (/特徴[:：「]/.test(c)) return 'feature';
  if (/登場コスト\d+の/.test(c) || /名称[:：「]/.test(c) || /^.+：コスト\d+$/.test(c) || /「.+」の記述がある/.test(c)) return 'name';
  return 'color';
}

// 種別が'name'のクローズは、実際には「登場コスト＋名称」「名称＋登場コスト」「記述」
// 「名称のみ」の4パターンがあるので、書かれている内容によって判定関数を振り分ける
function _matchNameTypeClause(c, baseCard, ignoreColor) {
  if (/登場コスト\d+の/.test(c)) return _matchPlayCostClause(c, baseCard);
  if (/^.+：コスト\d+$/.test(c)) return _matchNameCostClause(c, baseCard);
  if (/「.+」の記述がある/.test(c)) return _matchDescriptionClause(c, baseCard, ignoreColor);
  return _matchNameClause(c, baseCard);
}

// 進化条件マッチング本体。evolveCond（進化条件列）1本に色クローズ・特徴クローズ・
// 名称クローズを混在させて書く（今まで通り）。各クローズはテキストから自動で種別判定
// され、マッチしたクローズについて { type, typeIdx } を返す（typeIdxは「同じ種別の
// クローズの中で何番目に書かれているか」＝0始まりの通し番号。書かれている順序で
// 振るため、種別が入り混じっていても種別ごとに独立して数える）。
// getEvolveCostForはこのtypeIdxを使って、進化コスト（色）/進化コスト（特徴）/
// 進化コスト（名称）のどの列の何番目の値を引くかを決める。
// 優先順位: 名称・特徴クローズを色クローズより先に判定する（書かれている順序に関わらず）。
// 例: 進化先が「黄Lv.5」かつ「特徴:グローイングドーンLv.5」の両方に当てはまる場合でも、
// 特徴側（グローイングドーン）を優先して採用する
function _resolveEvolveMatch(evoCard, baseCard) {
  const cond = evoCard.evolveCond || '';
  if (!cond || cond === 'なし') return null;
  const clauses = cond.split('/').map(s => s.trim());

  const seen = { color: 0, feature: 0, name: 0 };
  const entries = clauses.map((c) => {
    const type = _clauseType(c);
    const typeIdx = seen[type]++;
    return { c, type, typeIdx };
  });

  const order = entries.slice().sort((a, b) => {
    const aFirst = a.type !== 'color', bFirst = b.type !== 'color';
    return (aFirst === bFirst) ? 0 : (aFirst ? -1 : 1);
  });
  const MATCHERS = { color: _matchColorClause, feature: _matchFeatureClause, name: _matchNameTypeClause };
  // 進化先が「色条件を無視できる」（ignore_evolve_color・gate 成立中）なら色クローズの色を無視する
  const ignoreColor = _ignoresColorCondition(evoCard, _ownerSideOfCard(evoCard));
  for (const entry of order) {
    if (MATCHERS[entry.type](entry.c, baseCard, ignoreColor)) return entry;
  }
  return null;
}

export function canEvolveOnto(evoCard, baseCard) {
  // 「進化できない」（cant_evolve。ロゼモン：バーストモード BT26-050 のオプション「レスト状態の相手のデジモン/テイマー
  // 全ては進化できず」等）を持つデジモンは進化させられない（以前は表示だけで、進化は止めていなかった）
  if (baseCard && (baseCard.cantEvolve || (Array.isArray(baseCard.buffs) && baseCard.buffs.some(b => b && b.type === 'cant_evolve')))) return false;
  // 代替進化（alt_evolve / 進化条件を無視）が成立するなら進化可
  try { if (_getAltEvolve(evoCard, baseCard, bs, 'player')) return true; } catch (_) {}
  // バースト進化（burst_evolve）が成立するなら進化可（通常の進化条件は無視）
  try { if (_getBurstEvolve(evoCard, baseCard, bs, 'player')) return true; } catch (_) {}
  // アプ合体（app_gattai_evolve）は通常進化のドラッグ&ドロップ経路には含めない。
  // 公式ルール8-4通りバトルエリア本体の長押しメニュー（🔗アプ合体ボタン）専用の
  // 別ルートとして扱う（リンクカードの選択UIを挟むため。startAppGattaiMenu参照）
  return _resolveEvolveMatch(evoCard, baseCard) !== null;
}

// 「・」区切りのコスト欄から、マッチしたクローズ（同種別内でtypeIdx番目）のコストを選ぶ。
// 「値×回数」で連続コストをまとめて書ける（例: 4×2・3×2 → [4,4,3,3]）。
// 値が1個だけならその種別の全クローズ共通コストとして扱う。
// 値が同種別のクローズ数と一致すれば1対1対応。それ以外（数が合わない）は1個目にフォールバック。
function _pickCostFromList(raw, typeIdx, sameTypeCount) {
  const costs = String(raw || '').split('・').flatMap(part => {
    const repeat = part.trim().match(/^(\d+)[×x](\d+)$/);
    if (repeat) return Array(parseInt(repeat[2], 10)).fill(parseInt(repeat[1], 10));
    const n = parseInt(part.trim(), 10);
    return isNaN(n) ? [] : [n];
  });
  if (costs.length === 0) return null;
  if (costs.length === 1) return costs[0];
  if (costs.length === sameTypeCount) return costs[typeIdx];
  return costs[0];
}

// 進化コストの条件別出し分け。マッチしたクローズの種別に応じて、進化コスト（色）列
// （evolveCostRaw）/進化コスト（特徴）列（evolveCostFeatureRaw）/進化コスト（名称）列
// （evolveCostNameRaw）のいずれかから値を選ぶ（「登場コストNの『XXX』」クローズも
// name種別としてこの名称列を共用する）。列ごとに単一値/同種別クローズ数分だけ・区切り、
// を選べる。他の種別の列数は互いに影響しない。
export function getEvolveCostFor(evoCard, baseCard) {
  const match = _resolveEvolveMatch(evoCard, baseCard);
  if (!match) return evoCard.evolveCost; // フォールバック（代替進化等）

  const clauses = String(evoCard.evolveCond || '').split('/').map(s => s.trim()).filter(Boolean);
  const sameTypeCount = clauses.filter(c => _clauseType(c) === match.type).length;

  const RAW_BY_TYPE = {
    color: evoCard.evolveCostRaw, feature: evoCard.evolveCostFeatureRaw,
    name: evoCard.evolveCostNameRaw,
  };
  const picked = _pickCostFromList(RAW_BY_TYPE[match.type], match.typeIdx, sameTypeCount);
  return picked != null ? picked : evoCard.evolveCost;
}
// カード詳細の「進化コスト：」表示用の文字列（エスケープ前、進化不可なら null）。
// 進化条件の各クローズに、実際の進化（getEvolveCostFor）と同じ規則で種別ごとのコスト列から
// 引いたコストを付け、隣り合う同じコストのクローズはまとめる。
// 例: ブテンモン BT26-015「赤Lv.4/黄Lv.4/特徴「TS」Lv.4」色4・特徴3
//     → 「赤Lv.4/黄Lv.4から4コスト/特徴「TS」Lv.4から3コスト」
// （以前は進化コスト（色）だけを使い「…/特徴「TS」Lv.4から4」と表示していた）
export function formatEvolveCostDetail(card) {
  if (!card || card.evolveCost == null) return null;
  const cond = String(card.evolveCond || '').trim();
  if (!cond || cond === 'なし') return card.evolveCost + 'コスト';
  const clauses = cond.split('/').map(s => s.trim()).filter(Boolean);
  const RAW_BY_TYPE = { color: card.evolveCostRaw, feature: card.evolveCostFeatureRaw, name: card.evolveCostNameRaw };
  const counts = { color: 0, feature: 0, name: 0 };
  clauses.forEach(c => { counts[_clauseType(c)]++; });
  const seen = { color: 0, feature: 0, name: 0 };
  const groups = [];
  clauses.forEach(c => {
    const type = _clauseType(c);
    let cost = _pickCostFromList(RAW_BY_TYPE[type], seen[type]++, counts[type]);
    if (cost == null) cost = card.evolveCost;
    const last = groups[groups.length - 1];
    if (last && String(last.cost) === String(cost)) last.clauses.push(c);
    else groups.push({ cost, clauses: [c] });
  });
  return groups.map(g => g.clauses.join('/') + 'から' + g.cost + 'コスト').join('/');
}

// 効果による進化（effect-engine.js の _effectEvolveBaseCost）でも、選んだ進化条件のコストを
// 手動進化と同じ規則で引けるよう window に公開する（公式ルール8-1-3-2）
if (typeof window !== 'undefined') window.getEvolveCostFor = getEvolveCostFor;
// カード詳細表示（battle-render.js / effect-engine.js）からも同じ規則で進化コストを出せるよう公開する
if (typeof window !== 'undefined') window._formatEvolveCostDetail = formatEvolveCostDetail;

// 保留中の進化コスト軽減（スマッシュポテト等）を消費して合計軽減値を返す。
// bs._pendingEvoCostReductions の各エントリは color / baseLv / evoLv / name の記述子で
// 「どの進化に適用されるか」を絞る。once のものは消費して除去する。
function _consumePendingEvoCostReduction(evolved, base) {
  if (!bs || !Array.isArray(bs._pendingEvoCostReductions) || bs._pendingEvoCostReductions.length === 0) return 0;
  const evColor = evolved.color || '';
  const evLv = parseInt(String(evolved.level), 10) || 0;
  const evName = evolved.name || '';
  const baseLv = base ? (parseInt(String(base.level), 10) || 0) : 0;
  let total = 0;
  bs._pendingEvoCostReductions.forEach(r => {
    if (!r || r._used) return;
    if (r.side && r.side !== 'player') return;
    if (r.color && !evColor.includes(r.color)) return;
    if (r.baseLv != null && r.baseLv !== baseLv) return;
    if (r.evoLv != null && r.evoLv !== evLv) return;
    if (r.name && evName !== r.name) return;
    if (r.nameContains && !evName.includes(r.nameContains)) return;
    total += r.value || 0;
    if (r.once) r._used = true;
  });
  bs._pendingEvoCostReductions = bs._pendingEvoCostReductions.filter(r => r && !r._used);
  return total;
}

// ===== カード登場 =====

// distinct_by（recipe-editor-src側のcond_name_distinct等）の属性名 → 実際のcardプロパティ名 /
// 表示ラベル。名前/Lv/記述/色の4属性に対応（recipe-editor-src/src/recipe.tsの
// DISTINCT_MARKER_TO_ATTRと対応する属性名を使う）
const ASSEMBLY_DISTINCT_FIELD = { name: 'name', lv: 'level', description: 'effect', color: 'color' };
const ASSEMBLY_DISTINCT_LABEL = { name: '名称', lv: 'Lv', description: '記述', color: '色' };

// アセンブリで選んだカードを進化元に入れる順番の確認（巨神兵器 BT26-085 等）。
// 一番左が一番下で、左から順に上へ重ねていく（右端が本体のすぐ下＝stack[0]）。「順番を変更」で各カードの ◀ ▶ から並べ替えでき、
// 「OK」で確定 → callback(並べ替え後の配列。[0]＝一番下)。「やめる」→ callback(null)（アセンブリを使わない）
function _confirmAssemblyOrder(cards, callback) {
  if (!Array.isArray(cards) || cards.length <= 1) { callback(cards); return; }
  const order = cards.slice();
  let reorder = false;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:65000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:12px;';
  const btnCss = (bg, fg) => 'font-weight:bold;font-size:13px;padding:8px 18px;border-radius:999px;border:2px solid ' + bg + ';background:' + bg + ';color:' + fg + ';cursor:pointer;';
  const render = () => {
    ov.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'color:#00fbff;font-size:15px;font-weight:bold;text-shadow:0 0 8px #00fbff;text-align:center;';
    title.innerText = '💠 この順番で進化元に入れますか？';
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#aaa;font-size:11px;text-align:center;';
    sub.innerText = '一番左が一番下で、左から順に上へ重ねます' + (reorder ? '／◀ ▶ で並べ替え' : '');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:100%;';
    order.forEach((c, i) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;width:84px;';
      const pos = document.createElement('div');
      pos.style.cssText = 'color:#ffcc00;font-size:11px;font-weight:bold;';
      pos.innerText = i === 0 ? '1（一番下）' : (i === order.length - 1 ? (i + 1) + '（一番上）' : String(i + 1));
      const img = document.createElement('img');
      img.src = cardImg(c);
      img.alt = c.name || '';
      img.style.cssText = 'width:80px;border-radius:6px;border:2px solid ' + (reorder ? '#ffcc00' : '#00fbff') + ';';
      const name = document.createElement('div');
      name.style.cssText = 'color:#fff;font-size:10px;text-align:center;line-height:1.3;';
      name.innerText = (c.name || '') + (c.level ? ' Lv' + c.level : '');
      cell.append(pos, img, name);
      if (reorder) {
        const arrows = document.createElement('div');
        arrows.style.cssText = 'display:flex;gap:6px;';
        const mk = (label, delta) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.innerText = label;
          const to = i + delta;
          const ok = to >= 0 && to < order.length;
          b.disabled = !ok;
          b.style.cssText = 'width:34px;height:28px;border-radius:8px;border:1px solid #ffcc00;background:#222;color:#ffcc00;font-size:13px;cursor:pointer;' + (ok ? '' : 'opacity:.3;cursor:default;');
          b.onclick = () => { if (!ok) return; const t = order[i]; order[i] = order[to]; order[to] = t; render(); };
          return b;
        };
        arrows.append(mk('◀', -1), mk('▶', 1));
        cell.appendChild(arrows);
      }
      row.appendChild(cell);
    });
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button'; okBtn.innerText = 'OK'; okBtn.style.cssText = btnCss('#00fbff', '#000');
    okBtn.onclick = () => { ov.remove(); callback(order.slice()); };
    const reBtn = document.createElement('button');
    reBtn.type = 'button'; reBtn.innerText = reorder ? '並べ替えを終える' : '順番を変更';
    reBtn.style.cssText = btnCss('#ffcc00', '#000');
    reBtn.onclick = () => { reorder = !reorder; render(); };
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.innerText = 'やめる'; cancelBtn.style.cssText = btnCss('#555', '#fff');
    cancelBtn.onclick = () => { ov.remove(); callback(null); };
    btns.append(okBtn, reBtn, cancelBtn);
    ov.append(title, sub, row, btns);
  };
  render();
  document.body.appendChild(ov);
}

// アセンブリ等「トラッシュのカードを使うことで登場コストを軽減できる」パッシブキーワード:
// 手札のカードをバトルエリアへドロップした瞬間（＝実際に登場させる直前）にこの関数を経由させる。
// 発動できる条件（発動領域が手札、対象となるカードがトラッシュに規定枚数ある）を満たしていれば
// 「発動しますか？」の確認を挟み、発動を選べば対象カードをこのカードの下（進化元スタック）に
// 置いてから通常のdoPlayへ進む（発動しない/対象不足の場合はそのままdoPlay）
// 「登場するとき、このテイマーをレストさせることで、支払うコスト-N」（when_play。鷺坂ヒロコ BT26-088）:
// 手札のデジモンをコストを支払って登場させる直前（アセンブリの確認の後）に、使える効果ごとに
// 「レストして支払うコストを-Nしますか？」を確認する（effect-engine.js の checkWhenPlayDiscount）。
// 使うと選んだ軽減量は card._assemblyDiscount に加算して doPlay の実効登場コスト計算
// （getEffectivePlayCost）に反映させる。登場できない状態（メイン以外・デジタマ・進化専用・
// 支払うコストが0）なら確認せずそのまま doPlay へ
function _offerWhenPlayThenPlay(card, handIdx, slotIdx) {
  // 先に「このカードを使用/登場するとき、〇〇することで、支払うコスト-N」（summon_cost のコスト付き
  // エントリ。茨の女王 BT26-098 等）を確認し、その後で when_play（鷺坂ヒロコ）の確認へ
  _offerCostedSummonDiscount(card, () => {
    // コストで手札が動いた場合に備えて、手札の位置を取り直す
    const _hi = bs.player.hand.indexOf(card);
    _offerWhenPlayThenPlayInner(card, _hi !== -1 ? _hi : handIdx, slotIdx);
  });
}

// 「このカードを使用/登場するとき、〇〇することで、支払うコスト-N」（recipe.summon_cost のうち cost[] を伴い、
// 取得元がトラッシュのアセンブリ型ではないもの。effect-engine.js の checkCostedSummonDiscount）:
// 払えるものがあれば「〜することで、支払うコスト-Nしますか？」を確認し、はいならコストを実行して
// 軽減量を card._assemblyDiscount に加算する（doPlay の getEffectivePlayCost に反映）。
// オプション/デュアルは色条件で使用できない場合は確認しない（doPlay 側で使用不可になるため）
function _offerCostedSummonDiscount(card, next) {
  if (!card || bs.phase !== 'main' || _attackInProgress || card.level === '2' || card.playCost === null) { next(); return; }
  if ((card.type === 'オプション' || card.type === 'デュアル') && !hasMatchingColorInPlay(card, 'player')
      && !meetsUseCondition(card, 'player') && !_ignoresColorCondition(card, 'player')) { next(); return; }
  let _pay = 0;
  try { _pay = _getEffectivePlayCost(card, bs, 'player'); } catch (_) { _pay = card.playCost || 0; }
  if (!(_pay > 0)) { next(); return; }
  _checkCostedSummonDiscount(card, bs, 'player', _hooks.makeEffectContext(card, 'player'), (disc) => {
    // 盤面の表示（テイマーの下のカードの破棄等）は doPlay 内の renderAll で反映される
    if (disc > 0) card._assemblyDiscount = (parseInt(card._assemblyDiscount, 10) || 0) + disc;
    next();
  }, { addLog, baseCost: _pay });
}

function _offerWhenPlayThenPlayInner(card, handIdx, slotIdx) {
  if (!card || bs.phase !== 'main' || _attackInProgress || card.type !== 'デジモン'
      || card.level === '2' || card.playCost === null) { doPlay(card, handIdx, slotIdx); return; }
  let _pay = 0;
  try { _pay = _getEffectivePlayCost(card, bs, 'player'); } catch (_) { _pay = card.playCost || 0; }
  if (!(_pay > 0)) { doPlay(card, handIdx, slotIdx); return; }
  _checkWhenPlayDiscount(card, bs, 'player', (disc) => {
    // テイマーのレスト表示は doPlay 内の renderAll で反映される
    if (disc > 0) card._assemblyDiscount = (parseInt(card._assemblyDiscount, 10) || 0) + disc;
    doPlay(card, handIdx, slotIdx);
  }, { addLog, baseCost: _pay });
}

// アセンブリの候補計画（cost[] の各グループごとの候補・必要枚数）。トラッシュに必要枚数が無いグループがあれば null
function _assemblyPlan(card, costItems) {
  let eligible = true;
  const plan = costItems.map((costItem) => {
    const fromZones = Array.isArray(costItem.from) ? costItem.from : (costItem.from ? [costItem.from] : []);
    if (!fromZones.includes('trash')) { eligible = false; return null; } // 現状トラッシュ由来のみ対応
    const wantCount = parseInt(costItem.count, 10) || 1;
    const candidates = _filterAssemblyCandidates(costItem, bs.player.trash, bs, 'player');
    if (candidates.length < wantCount) { eligible = false; return null; }
    return { wantCount, candidates, distinctBy: Array.isArray(costItem.distinct_by) ? costItem.distinct_by : [] };
  });
  return eligible ? plan : null;
}

// アセンブリの確認 → トラッシュから使うカードを選ぶ → 重ね順の確認 → トラッシュから取り除く（公式ルール 7-3）。
// 完了で done(下に置くカードの配列。[0]＝一番上)。使わない/やめた場合は done(null)。カードを下に置くのは呼び出し側
function _runTrashAssembly(card, opt, costItems, done) {
  const plan = _assemblyPlan(card, costItems);
  if (!plan) { done(null); return; }
  const totalWant = plan.reduce((sum, p) => sum + p.wantCount, 0);
  showConfirm({
    title: '💠 アセンブリ',
    message: '「' + card.name + '」をアセンブリで登場させますか？（トラッシュのカードを' + totalWant + '枚使用・支払うコスト-' + (parseInt(opt.value, 10) || 0) + '）',
    yesText: '発動する', noText: '発動しない',
  }).then((yes) => {
    if (!yes) { done(null); return; }
    const allPicked = [];
    // 全グループ分の選択が完了 → 進化元に入れる順番を確認（並べ替え可）してから確定する。
    // 「やめる」ならアセンブリを使わず通常の登場へ（他の選択キャンセル時と同じ）
    const finish = () => {
      _confirmAssemblyOrder(allPicked, (ordered) => {
        if (!ordered) { done(null); return; }
        // 画面は左＝一番下、進化元(stack)は [0]＝一番上 なので逆順にする
        const top = ordered.slice().reverse();
        top.forEach((p) => {
          const ti = bs.player.trash.indexOf(p);
          if (ti !== -1) bs.player.trash.splice(ti, 1);
        });
        addLog('💠 「' + card.name + '」のアセンブリを発動（トラッシュから' + top.length + '枚使用）');
        done(top);
      });
    };
    // グループ内で1枚ずつ順番に選ばせる（distinctBy指定時は、同グループ内で既に選んだ
    // カードと指定属性（名前/Lv/記述/色）が同じ候補を都度除外して重複を防ぐ）
    const pickWithinGroup = (groupIdx, group, pickedInGroup, remainingWant, onGroupDone) => {
      if (remainingWant <= 0) { onGroupDone(pickedInGroup); return; }
      const distinctBy = group.distinctBy || [];
      const remaining = group.candidates.filter(c => {
        if (allPicked.includes(c) || pickedInGroup.includes(c)) return false;
        if (distinctBy.length === 0) return true;
        return !pickedInGroup.some(p => distinctBy.some(attr => {
          const field = ASSEMBLY_DISTINCT_FIELD[attr];
          return field && p[field] === c[field];
        }));
      });
      if (remaining.length < remainingWant) { done(null); return; } // 念のための保険
      const pickCount = distinctBy.length > 0 ? 1 : remainingWant;
      let title = '💠 アセンブリ: 使うカードを選んでください';
      if (plan.length > 1) title += '（グループ' + (groupIdx + 1) + '/' + plan.length + '）';
      if (distinctBy.length > 0 && group.wantCount > 1) {
        const labels = distinctBy.map(attr => ASSEMBLY_DISTINCT_LABEL[attr] || attr).join('・');
        title += '（' + (pickedInGroup.length + 1) + '/' + group.wantCount + '枚目・' + labels + 'が異なるカードのみ）';
      }
      // 使うカードが決まっている（＝全部使うしかない）なら「全て選択する」を出す。名称等が異なる指定なら、同名カードは
      // 1枚にまとめて数え、種類の数がちょうど必要な枚数のとき（同名カードは先頭の1枚を使う）。指定が無ければ候補が
      // ちょうど必要な枚数のとき。選んだカードは最後の「この順番で進化元に入れますか？」で並べて確認する（ダンテモン BT26-086）
      const _sameAttr = (a, b) => distinctBy.some(attr => {
        const field = ASSEMBLY_DISTINCT_FIELD[attr];
        return field && a[field] === b[field];
      });
      const _onePerKind = [];
      remaining.forEach((c) => { if (!_onePerKind.some(p => _sameAttr(p, c))) _onePerKind.push(c); });
      const _allOk = remainingWant >= 2 && _onePerKind.length === remainingWant;
      _showTrashCardPicker(remaining, pickCount, false, title, (picked) => {
        if (!picked || picked.length < pickCount) { done(null); return; }
        const nextPicked = [...pickedInGroup, ...picked];
        pickWithinGroup(groupIdx, group, nextPicked, remainingWant - pickCount, onGroupDone);
      }, remaining, _allOk ? { onSelectAll: () => onGroupDone([...pickedInGroup, ..._onePerKind]) } : undefined);
    };
    const pickNext = (idx) => {
      if (idx >= plan.length) { finish(); return; }
      pickWithinGroup(idx, plan[idx], [], plan[idx].wantCount, (groupPicked) => {
        allPicked.push(...groupPicked);
        pickNext(idx + 1);
      });
    };
    pickNext(0);
  });
}

// 効果で「支払うコスト-Nで登場」させるときのアセンブリ（公式ルール 7-3-2-10「効果でアセンブリ条件を持つデジモンカードを
// 登場させるときも、アセンブリできます」。ウィルスバスターズ EX12-069 の-3 にアセンブリの-6 を合わせて登場）。
// effect-engine.js の _summonCardFromEffect が支払いの直前に呼ぶ。done(下に置くカードの配列 or null, 軽減量)
function offerAssemblyForEffectPlay(card, done) {
  const options = card ? _getAssemblyOptions(card) : [];
  for (const opt of options) {
    if (opt.per_cost_card) continue; // デジクロスは対象外（手札からの登場のみ）
    const costItems = Array.isArray(opt.cost) ? opt.cost.filter(c => c) : [];
    if (costItems.length === 0 || costItems.some(ci => ci && ci._designatedAny)) continue;
    if (!_assemblyPlan(card, costItems)) continue;
    _runTrashAssembly(card, opt, costItems, (picked) => done(picked, picked ? (parseInt(opt.value, 10) || 0) : 0));
    return;
  }
  done(null, 0);
}
if (typeof window !== 'undefined') window._offerAssemblyForEffectPlay = offerAssemblyForEffectPlay;

export function offerAssemblyThenPlay(card, handIdx, slotIdx) {
  // 前回の登場時のデジクロスの印は消しておく（「デジクロスしていたなら」は今回の登場だけを見る）
  if (card) delete card._digicrossed;
  if (bs.phase !== 'main' || _attackInProgress) { doPlay(card, handIdx, slotIdx); return; }
  const options = card ? _getAssemblyOptions(card) : [];
  for (const opt of options) {
    // 発動領域指定があれば、手札にある時だけ対象（登場前の今がまさにそれ）
    if (opt.in_zone && opt.in_zone !== 'hand') continue;
    const costItems = Array.isArray(opt.cost) ? opt.cost.filter(c => c) : [];
    if (costItems.length === 0) continue;
    // 《デジクロス》（キーワードレシピの per_cost_card / 指定グループの「好きな枚数」）: 手札・バトルエリアの指定カードを
    // 1枚以上好きな枚数だけ下に置き、置いた1枚ごとに登場コスト-N（公式ルール 7-2）。置けるカードが無ければ次の候補へ
    if (opt.per_cost_card || costItems.some(ci => ci && ci._designatedAny)) {
      if (_offerDigixros(card, opt, costItems, handIdx, slotIdx)) return;
      continue;
    }
    if (!_assemblyPlan(card, costItems)) continue;
    _runTrashAssembly(card, opt, costItems, (picked) => {
      if (picked) {
        // このカードの下に置く（picked[0] が一番上）
        if (!card.stack) card.stack = [];
        card.stack = [...picked, ...card.stack];
        card._assemblyDiscount = (parseInt(card._assemblyDiscount, 10) || 0) + (parseInt(opt.value, 10) || 0);
      }
      _offerWhenPlayThenPlay(card, handIdx, slotIdx);
    });
    return;
  }
  _offerWhenPlayThenPlay(card, handIdx, slotIdx);
}

// デジクロスの素材にできる追加の場所（カード側の digixros_from、効果で増えた場所）
function _digixrossExtraZones(card) {
  const out = [];
  try {
    const r = typeof card.recipe === 'string' ? JSON.parse(card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')) : card.recipe;
    (r && Array.isArray(r.passive) ? r.passive : []).forEach((p) => {
      if (p && p.flag === 'digixros' && p.digixros_from) String(p.digixros_from).split(',').map(x => x.trim()).filter(Boolean).forEach(z => out.push(z));
    });
  } catch (_) {}
  (bs.player._digixrossExtraZones || []).forEach((e) => {
    if (!e) return;
    (e.zones || []).forEach(z => out.push(z));
  });
  return out;
}

// 《デジクロス》の確認と、置くカードの選択（公式ルール 7-2）。置ける指定カードが1枚も無ければ false（確認しない）
// - 置けるのは手札とバトルエリアの自分のカード（7-2-1）。指定カード（cost item＝グループ）ごとに最大 count 枚（7-2-2-5）
// - 1枚以上選ぶ（7-2-2-4）。選び終わったら「決定」。重なり順は条件の左側（グループの順）が上（7-2-2-8）
// - バトルエリアから置くカードの進化元・リンクカードは破棄（7-2-2-7）
// - 置いた枚数 × N だけ登場コストを軽減（card._assemblyDiscount）。card._digicrossed で「デジクロスしていたなら」を判定（7-2-2-9）
function _offerDigixros(card, opt, costItems, handIdx, slotIdx) {
  const per = parseInt(opt.value, 10) || 0;
  // 素材にできる場所: キーワードレシピの from（通常は手札・バトルエリア）＋ 効果で増えた場所
  //  - カード側のデジクロスの設定の digixros_from（例 "trash,tamer_stack"）
  //  - 効果（action:'digixros_zone_plus'）で一時的に増えた場所（bs.player._digixrossExtraZones）
  //  場所のコード: hand / battle_area / trash / tamer_stack（テイマーの下）/ evo_source（デジモンの進化元）
  const extraZones = _digixrossExtraZones(card);
  const zonesOf = (ci) => {
    const base = Array.isArray(ci.from) ? ci.from : (ci.from ? [ci.from] : ['hand', 'battle_area']);
    return Array.from(new Set([...base, ...extraZones]));
  };
  // 素材 → 取り除く処理（どこから置いたか）
  const srcOf = new Map();
  const slots = costItems.map((ci) => {
    const zones = zonesOf(ci);
    const pool = [];
    const add = (c, label, remove) => { if (!c || c === card) return; pool.push(c); if (!srcOf.has(c)) srcOf.set(c, { label, remove }); };
    if (zones.includes('hand')) bs.player.hand.forEach(c => add(c, '手札', () => { const i = bs.player.hand.indexOf(c); if (i !== -1) bs.player.hand.splice(i, 1); }));
    if (zones.includes('battle_area')) {
      bs.player.battleArea.forEach(c => add(c, 'バトルエリア', () => {
        const i = bs.player.battleArea.indexOf(c); if (i === -1) return;
        bs.player.battleArea[i] = null;
        // バトルエリアから置くカードの進化元・リンクカードは破棄（公式ルール 7-2-2-7）
        (c.stack || []).forEach(s2 => bs.player.trash.push(s2)); c.stack = [];
        (c.linkedCards || []).forEach(s2 => bs.player.trash.push(s2)); c.linkedCards = [];
      }));
      (bs.player.tamerArea || []).forEach(c => add(c, 'バトルエリア', () => {
        const i = bs.player.tamerArea.indexOf(c); if (i === -1) return;
        bs.player.tamerArea.splice(i, 1);
        (c.stack || []).forEach(s2 => bs.player.trash.push(s2)); c.stack = [];
      }));
    }
    if (zones.includes('trash')) bs.player.trash.forEach(c => add(c, 'トラッシュ', () => { const i = bs.player.trash.indexOf(c); if (i !== -1) bs.player.trash.splice(i, 1); }));
    if (zones.includes('tamer_stack')) (bs.player.tamerArea || []).forEach(t => (t && t.stack || []).forEach(c => add(c, '「' + t.name + '」の下', () => { const i = t.stack.indexOf(c); if (i !== -1) t.stack.splice(i, 1); })));
    if (zones.includes('evo_source')) bs.player.battleArea.forEach(d => (d && d.stack || []).forEach(c => add(c, '「' + d.name + '」の進化元', () => { const i = d.stack.indexOf(c); if (i !== -1) d.stack.splice(i, 1); })));
    return { max: Math.max(1, parseInt(ci.count, 10) || 1), cands: _filterAssemblyCandidates(ci, pool, bs, 'player') };
  });
  const allCands = [];
  slots.forEach(sl => sl.cands.forEach(c => { if (!allCands.includes(c)) allCands.push(c); }));
  if (allCands.length === 0) return false;
  const maxTotal = slots.reduce((n, sl) => n + sl.max, 0);
  showConfirm({
    title: '✖ デジクロス',
    message: '「' + card.name + '」をデジクロスで登場させますか？\n（指定のカードを1枚置くごとに登場コスト-' + per + '。最大' + maxTotal + '枚）',
    yesText: 'デジクロスする', noText: 'しない',
  }).then((yes) => {
    if (!yes) { _offerWhenPlayThenPlay(card, handIdx, slotIdx); return; }
    // 選んだカードをグループに割り当てられるか（各グループ最大 max 枚）。割り当て結果（カード→グループ番号）を返す
    const assign = (cards) => {
      const res = new Map();
      const used = slots.map(() => 0);
      const tryAt = (k) => {
        if (k >= cards.length) return true;
        for (let g = 0; g < slots.length; g++) {
          if (used[g] >= slots[g].max || !slots[g].cands.includes(cards[k])) continue;
          used[g]++; res.set(cards[k], g);
          if (tryAt(k + 1)) return true;
          used[g]--; res.delete(cards[k]);
        }
        return false;
      };
      return tryAt(0) ? res : null;
    };
    const picked = [];
    const pickMore = () => {
      // まだ足せるカード（足しても全体がグループに割り当てられるもの）
      const remaining = allCands.filter(c => !picked.includes(c) && assign([...picked, c]));
      if (remaining.length === 0) { commit(); return; }
      _showTrashCardPicker(remaining, 1, picked.length > 0,
        '✖ デジクロス: 下に置くカードを選んでください（' + picked.length + '枚選択中。' + (picked.length > 0 ? '「使わない」で選び終わる' : '1枚以上') + '）',
        (sel) => {
          const c = sel && sel[0];
          if (!c) {
            if (picked.length === 0) { _offerWhenPlayThenPlay(card, handIdx, slotIdx); return; }
            commit();
            return;
          }
          picked.push(c);
          pickMore();
        }, remaining, { labelOf: (c) => (srcOf.get(c) || {}).label || '' });
    };
    const commit = () => {
      const map = assign(picked);
      if (!map || picked.length === 0) { _offerWhenPlayThenPlay(card, handIdx, slotIdx); return; }
      // 条件の左側（グループの順）が上。同じグループ内は選んだ順
      const ordered = picked.slice().sort((a, b) => map.get(a) - map.get(b));
      ordered.forEach((c) => { const src = srcOf.get(c); if (src) src.remove(); });
      ordered.forEach(c => { delete c._faceDown; c.suspended = false; c.buffs = []; });
      if (!card.stack) card.stack = [];
      card.stack = [...ordered, ...card.stack];
      const disc = per * ordered.length;
      card._assemblyDiscount = (parseInt(card._assemblyDiscount, 10) || 0) + disc;
      card._digicrossed = ordered.length;
      // 登場の演出をデジクロス（素材が交差して1体になる）演出にする（showPlayEffect が見る。オンラインは play コマンドで相手へ）
      card._digixrossMats = ordered.map(c => ({ name: c.name, imgSrc: cardImg(c) || '' }));
      addLog('✖ 「' + card.name + '」のデジクロス（' + ordered.map(c => '「' + c.name + '」').join('') + 'を下に置く・登場コスト-' + disc + '）');
      renderAll();
      _offerWhenPlayThenPlay(card, handIdx, slotIdx);
    };
    pickMore();
  });
  return true;
}

export function doPlay(card, handIdx, slotIdx) {
  console.log('[doPlay] card=' + (card && card.name) + ' type=' + (card && card.type) + ' phase=' + bs.phase + ' attackInProgress=' + _attackInProgress);
  if (bs.phase !== 'main') { console.log('[doPlay] skip: phase != main'); return; }
  if (_attackInProgress) { console.log('[doPlay] skip: attack in progress'); return; }
  if (card.level === '2') { addLog('🚨 デジタマはバトルエリアに出せません'); return; }
  if (card.playCost === null) { addLog('🚨 「' + card.name + '」は進化専用カードです'); return; }
  // オプション使用の色条件（場に同色のカードが無ければ使用不可。使用条件を満たせば無視できる）。
  // デュアルカードもオプションとして使う際は同じ色条件を満たす必要がある
  if ((card.type === 'オプション' || card.type === 'デュアル') && !hasMatchingColorInPlay(card, 'player') && !meetsUseCondition(card, 'player') && !_ignoresColorCondition(card, 'player')) {
    addLog('🚨 「' + card.name + '」と同じ色のカードが場に無いため使用できません');
    return;
  }
  // recipe の summon_cost（条件付き登場コスト軽減）を反映した実効登場コスト
  // 例: ブラックウォーグレイモン「DP10000以上の相手がいる間、登場コスト-6」
  const _effPlayCost = _getEffectivePlayCost(card, bs, 'player');
  // アセンブリ等が発動した場合の一時的な軽減量（offerAssemblyThenPlay が設定）は
  // このコスト計算で使い切ったら消す（次に別の理由で登場するとき等に残らないように）
  delete card._assemblyDiscount;
  if (_effPlayCost !== card.playCost) {
    addLog('💠 「' + card.name + '」の登場コスト ' + card.playCost + ' → ' + _effPlayCost);
    // showPlayEffect/showOptionEffect の演出表示（自分側画面）にも軽減後コストを反映
    card._costReduction = card.playCost - _effPlayCost;
  }
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'play', handIdx, slotIdx, cardName: card.name, cardType: card.type, cardImg: card.imgSrc || '', playCost: _effPlayCost,
    digixrossMats: Array.isArray(card._digixrossMats) ? card._digixrossMats : undefined });

  // ----- オプションカード -----
  if (card.type === 'オプション') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    addLog('✦ 「' + card.name + '」を使用！（コスト ' + _effPlayCost + '）');
    if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
      try { window._tutorialHideInstruction(); } catch (e) {}
    }
    renderAll();
    showOptionEffect(card, async () => {
      // ★ 公式ルール: コスト支払い → 効果処理 → ターン終了判定
      playerSpendMemory(_effPlayCost, true); // defer=true
      // チュートリアル進行通知 → PERFECT/GREAT を先に流してから割り込み(説明等)へ
      if (window._tutorialRunner && window._tutorialRunner.active) {
        try { window._tutorialRunner.notifyEvent('play', { cardNo: card.cardNo, cardName: card.name, targetCardNo: card.cardNo, side: 'player' }); } catch (e) {}
      }
      if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play_cost');
      _hooks.checkAndTriggerEffect(card, '【メイン】', async () => {
        // 公式9-1-5: 【メイン】解決後、どの領域にも属していなければ破棄（「このカードをバトルエリアに
        // 置く」「セキュリティの下に置く」等で領域に置かれたならトラッシュへ送らない）
        if (!_isCardInAnyZone(card, bs.player)) {
          bs.player.trash.push(card);
          addLog('✦ 「' + card.name + '」をトラッシュへ');
        }
        renderAll();
        await new Promise((res) => _afterOptionUsed('player', res));
        // 割り込み2: 効果完了後（after_play / after_use_effect 両方発火）
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play');
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('use_effect');
        if (window._tutorialBattleDone) window._tutorialBattleDone();
        checkPlayerPendingTurnEnd();
      }, 'player');
    });
    return;
  }

  // ----- デュアルカード（オプションとして使用。使用後アーツ進化を提示） -----
  // 登場コストを持たないため常にこちらの分岐（空きスロットへドロップ=使用）。
  // 通常進化（既存のデジモンへドロップ）はdoEvolve/doEvolveIkuが型に依らず処理する
  if (card.type === 'デュアル') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    addLog('✦ 「' + card.name + '」を使用！（コスト ' + _effPlayCost + '）');
    if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
      try { window._tutorialHideInstruction(); } catch (e) {}
    }
    renderAll();
    showOptionEffect(card, async () => {
      playerSpendMemory(_effPlayCost, true);
      if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play_cost');
      // 【メイン】の効果からアーツ進化〜【進化時】までを1続きの処理として扱う（相手の【消滅時】等の非ターンプレイヤー側の効果は
      // その後。公式ルール 8-19-1: アーツ進化は使用後の保留処理）
      if (window._effectBusy) window._effectBusy(1);
      const _endBusy = (cb) => { if (window._effectBusyEnd) window._effectBusyEnd(cb); else cb(); };
      _hooks.checkAndTriggerEffect(card, '【メイン】', () => {
        renderAll();
        _afterOptionUsed('player', () => _offerArtsEvolve(card, (evolved) => {
          if (!evolved) {
            bs.player.trash.push(card);
            addLog('✦ 「' + card.name + '」をトラッシュへ');
            renderAll();
          }
          _endBusy(() => { renderAll(); checkPlayerPendingTurnEnd(); });
        }));
      }, 'player');
    });
    return;
  }

  // ----- テイマー登場 -----
  if (card.type === 'テイマー') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    if (window._freshOnFieldEnter) window._freshOnFieldEnter(card);
    bs.player.tamerArea.push(card);
    addLog('▶ 「' + card.name + '」を登場！（コスト ' + _effPlayCost + '）');
    if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
      try { window._tutorialHideInstruction(); } catch (e) {}
    }
    renderAll();
    showPlayEffect(card, async () => {
      // ★ 公式ルール: コスト支払い → 登場時効果 → ターン終了判定
      playerSpendMemory(_effPlayCost, true); // defer=true
      _hooks.applyPermanentEffects('player');
      renderAll();
      // チュートリアル進行通知 → PERFECT/GREAT を先に流してから割り込み(説明等)へ
      if (window._tutorialRunner && window._tutorialRunner.active) {
        try { window._tutorialRunner.notifyEvent('play', { cardNo: card.cardNo, cardName: card.name, targetCardNo: card.cardNo, side: 'player' }); } catch (e) {}
      }
      if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play_cost');
      const finishTamer = async () => {
        // 割り込み2: 効果完了後
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play');
        checkPlayerPendingTurnEnd();
      };
      // 登場時効果は常にスキャンする（このカード自身に【登場時】が無くても、
      // 他カードの「他のデジモンが登場したとき」誘発を拾うため。
      // 効果が無ければ checkAndTriggerEffect は即 callback して何も起きない）
      _hooks.checkAndTriggerEffect(card, '【登場時】', () => {
        renderAll();
        finishTamer();
      });
    });
    return;
  }

  // ----- デジモン登場 -----
  if (window._freshOnFieldEnter) window._freshOnFieldEnter(card);
  card.summonedThisTurn = true;
  while (bs.player.battleArea.length <= slotIdx) bs.player.battleArea.push(null);
  bs.player.battleArea[slotIdx] = card;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  addLog('▶ 「' + card.name + '」を登場！（コスト ' + _effPlayCost + '）');
  if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
    try { window._tutorialHideInstruction(); } catch (e) {}
  }
  renderAll();
  showPlayEffect(card, async () => {
    _hooks.applyPermanentEffects('player');
    renderAll(true);
    // ★ 公式ルール: コスト支払い(メモリー消費) → 登場時効果 → ターン終了判定
    playerSpendMemory(_effPlayCost, true); // defer=true: ターン終了は保留
    // チュートリアル進行通知 → PERFECT/GREAT を先に流してから割り込み(説明等)へ
    if (window._tutorialRunner && window._tutorialRunner.active) {
      try { window._tutorialRunner.notifyEvent('play', { cardNo: card.cardNo, cardName: card.name, targetCardNo: card.cardNo, side: 'player' }); } catch (e) {}
    }
    if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
    if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play_cost');
    const finishPlay = async () => {
      // 割り込み2: 効果完了後
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play');
      // 全工程 (登場演出 + コスト + 割り込み + 効果) 完了 → 次ステップ表示を解放
      if (window._tutorialBattleDone) window._tutorialBattleDone();
      checkPlayerPendingTurnEnd();
    };
    // 登場時効果は常にスキャン（他カードの「他のデジモンが登場したとき」誘発も拾う。
    // ダルクモン「黄Lv.3の自分のデジモンが登場したとき」等）
    _hooks.checkAndTriggerEffect(card, '【登場時】', () => {
      renderAll(true);
      finishPlay();
    });
  });
}

// ===== 進化 =====

export function doEvolve(card, handIdx, slotIdx, opts) {
  if (bs.phase !== 'main') return;
  if (_attackInProgress) return;
  // ★ オンライン通知は最終コスト確定後（_finishDoEvolve内）で送る。ここで送ると
  // 吸収進化等の軽減が確定する前の生コストが相手画面に表示されてしまうため
  const base = bs.player.battleArea[slotIdx];
  if (!base) return;
  // ジョグレス進化（［ジョグレス進化］を持つカードを、条件に合う自分のデジモンに重ねた）。
  // 通常の進化もできるなら「進化」「ジョグレス進化」を選ぶ（公式ルール 5-1-2-2）
  if (!(opts && opts.skipJogress)) {
    const _jgPairs = _handJogressPairs(card, base);
    if (_jgPairs.length > 0) {
      const _normalOk = card.evolveCost !== null && canEvolveOnto(card, base);
      if (!_normalOk) { _doHandJogress(card, base, _jgPairs); return; }
      showConfirm({
        title: '進化 or ジョグレス進化',
        message: '「' + card.name + '」をどうしますか？',
        yesText: '⬆ 進化', noText: '🔀 ジョグレス進化', color: '#ffd54f',
      }).then((normal) => {
        if (normal) doEvolve(card, handIdx, slotIdx, { skipJogress: true });
        else _doHandJogress(card, base, _jgPairs);
      });
      return;
    }
  }
  if (card.evolveCost === null) { addLog('🚨 「' + card.name + '」は進化できません‼'); return; }
  if (!canEvolveOnto(card, base)) { addLog('🚨 進化条件を満たしていません‼（' + card.evolveCond + '）'); return; }

  // バースト進化（burst_evolve。総合ルール8-3-3-1「バースト進化を宣言し」＝プレイヤーが選ぶ）:
  // バースト進化の条件（元のデジモン＋手札に戻すテイマーがいる）がそろっていれば、通常の進化もできるときは
  // 「通常進化」「バースト進化」を選ばせる（以前は通常進化ができると必ず通常進化になり、ロゼモン：バーストモード
  // BT26-050 にバースト進化できなかった）。バースト進化しかできないときはそのままバースト進化
  const _normalMatch = _resolveEvolveMatch(card, base) !== null;
  let _altEvoForBurstCheck = null;
  try { _altEvoForBurstCheck = _getAltEvolve(card, base, bs, 'player'); } catch (_) {}
  let _burstEvo = null;
  try { _burstEvo = _getBurstEvolve(card, base, bs, 'player'); } catch (_) {}
  let _burstTamers = [];
  if (_burstEvo) { try { _burstTamers = _filterBurstEvolveTamerCandidates(bs, 'player', _burstEvo.tamerConditions, _burstEvo.tamerConditionsOp, _burstEvo.tamerConditionsChain); } catch (_) {} }
  const _burstReady = !!_burstEvo && _burstTamers.length > 0;
  if (_burstReady && !_normalMatch && !_altEvoForBurstCheck) { _doBurstEvolve(card, base, handIdx, slotIdx, _burstEvo); return; }

  const _normalEvolve = () => {
  // 進化条件が複数(OR)ある場合、成立したclauseに対応するコスト（進化コスト欄の「・」区切り）を選ぶ
  let cost = getEvolveCostFor(card, base);
  // 代替進化（alt_evolve・進化条件を無視）が成立していれば、その指定コストを使う
  const _altEvo = _getAltEvolve(card, base, bs, 'player');
  if (_altEvo) { cost = _altEvo.cost; addLog('⬆ 代替進化（進化条件を無視）コスト' + cost); }
  const _evoDisc = _consumePendingEvoCostReduction(card, base);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  // 進化コストの常在の増減（evo_cost。ガサモン EX12-020「このデジモンが特徴TBを持つデジモンカードに進化するとき-1」）
  let _staticEvo = 0;
  try { _staticEvo = _getStaticEvoCostReduction(card, base, bs, 'player'); } catch (_) {}
  if (_staticEvo !== 0) { cost = Math.max(0, cost - _staticEvo); addLog('💠 進化コスト' + (_staticEvo > 0 ? '-' + _staticEvo : '+' + (-_staticEvo)) + '（コスト' + cost + 'で進化）'); }
  // before_evolve: 「〜のとき、このテイマーをレストさせることでコストを-N」のような
  // 進化コスト確定前の割り込み確認（タイガ BT2-088 等）。コスト確定後に本処理へ進む。
  _checkBeforeEvolveDiscount(card, bs, 'player', (discount) => {
    if (discount > 0) {
      cost = Math.max(0, cost - discount);
      addLog('💠 効果で進化コスト-' + discount + '（コスト' + cost + 'で進化）');
    }
    // 【吸収進化-N】: 進化先(card)自身が持つ能力。自分のデジモン1体をレストさせることで
    // 進化コストを-Nする（アルゴモン BT2-045等）
    _checkAbsorbEvolveDiscount(card, bs, 'player', (discount2) => {
      if (discount2 > 0) {
        cost = Math.max(0, cost - discount2);
        addLog('💠 吸収進化で進化コスト-' + discount2 + '（コスト' + cost + 'で進化）');
        // 吸収進化で自分のデジモンをレスト → 相手側の when_opp_rest 誘発（ヴェノムヴァンデモン等）
        fireOppRestThen('player', () => { _finishDoEvolve(card, base, handIdx, slotIdx, cost); });
      } else {
        _finishDoEvolve(card, base, handIdx, slotIdx, cost);
      }
    });
  }, { base }); // 進化元のデジモン（「このデジモンが進化するとき」の判定用）
  };

  if (_burstReady) {
    const _tn = _burstTamers.map(t => '「' + t.name + '」').join('か');
    const _normalCost = (() => { try { const a = _altEvoForBurstCheck; return a ? a.cost : getEvolveCostFor(card, base); } catch (_) { return card.evolveCost; } })();
    showConfirm({
      title: '⬆ 進化の方法を選んでください',
      // showConfirm の message は HTML として表示するので改行は <br>
      message: '「' + base.name + '」→「' + card.name + '」<br><br>'
        + '🔥 バースト進化：' + _tn + 'を手札に戻して、コスト' + (_burstEvo.cost || 0) + 'で進化（このターンの終了時に「' + card.name + '」を破棄）<br>'
        + '⬆ 通常進化：進化コスト' + _normalCost + 'で進化',
      yesText: '🔥 バースト進化', noText: '⬆ 通常進化', color: '#ff6633',
    }).then((burst) => {
      if (burst) { _doBurstEvolve(card, base, handIdx, slotIdx, _burstEvo); return; }
      _normalEvolve();
    });
    return;
  }
  _normalEvolve();
}

// バースト進化（総合ルール8-3）: バトルエリアの指定テイマー1体を手札に戻すコストを
// 払ってから進化を確定する。手札に戻せるテイマーが2体以上いるときは、盤面のテイマーをタップして選ぶ
// （下に裏向きのカードがあるテイマーを残したい場合等。以前は先頭の候補を自動で選んでいた）
function _doBurstEvolve(card, base, handIdx, slotIdx, burstEvo) {
  const cands = _filterBurstEvolveTamerCandidates(bs, 'player', burstEvo.tamerConditions, burstEvo.tamerConditionsOp, burstEvo.tamerConditionsChain);
  if (cands.length === 0) { addLog('🚨 バースト進化に必要なテイマーがいません‼'); return; }
  if (cands.length >= 2) {
    addLog('🎯 バースト進化で手札に戻すテイマーを選んでください');
    _showTargetSelection('both', cands.map(c => 300 + bs.player.tamerArea.indexOf(c)), null, '#ff6633', (v) => {
      const t = (v != null && v >= 300) ? bs.player.tamerArea[v - 300] : null;
      if (!t || !cands.includes(t)) { addLog('☓ バースト進化をやめた'); renderAll(); return; }
      _doBurstEvolveWith(card, base, handIdx, slotIdx, burstEvo, t);
    }, '（バースト進化で手札に戻すテイマー）');
    return;
  }
  _doBurstEvolveWith(card, base, handIdx, slotIdx, burstEvo, cands[0]);
}
function _doBurstEvolveWith(card, base, handIdx, slotIdx, burstEvo, chosen) {
  const idx = bs.player.tamerArea.indexOf(chosen);
  if (idx === -1) return;
  // テイマーエリアに空き（null）を残さない（永続効果の再計算等が null で止まっていた）
  bs.player.tamerArea.splice(idx, 1);
  // テイマーの下に重ねられていたカード（裏向きのカード等）はトラッシュへ（手札に戻るのはテイマーのカードだけ）
  if (Array.isArray(chosen.stack) && chosen.stack.length > 0) {
    chosen.stack.forEach((c) => { if (c) { delete c._faceDown; bs.player.trash.push(c); } });
    addLog('🗑 「' + chosen.name + '」の下のカード' + chosen.stack.length + '枚をトラッシュへ');
    chosen.stack = [];
  }
  // 手札に戻る = 一時的な状態は全てリセット（doBounceと同じ扱い）
  chosen.buffs = [];
  chosen.dpModifier = 0;
  chosen.suspended = false;
  bs.player.hand.push(chosen);
  addLog('🔥 バースト進化: 「' + chosen.name + '」を手札に戻した');
  renderAll();
  if (_onlineMode && window._onlineSendStateSync) { try { window._onlineSendStateSync(); } catch (_) {} }
  // バースト進化の条件（テイマーを手札に戻す）を、移動演出（両画面）で見せてから進化する（以前は演出が無く、
  // すぐ進化演出と【進化時】が出るため、手札に戻していないように見えていた。ロゼモン：バーストモード BT26-050）
  const _go = () => _finishDoEvolve(card, base, handIdx, slotIdx, burstEvo.cost, { isBurst: true });
  if (typeof window._fxMoveSync === 'function') {
    try { window._fxMoveSync(chosen, 'テイマーエリア', '手札', _go, { faceUp: true, remoteFrom: '相手のテイマーエリア', remoteTo: '相手の手札' }); return; } catch (_) {}
  }
  _go();
}

function _finishDoEvolve(card, base, handIdx, slotIdx, cost, opts) {
  // 最終コスト（吸収進化等の軽減を反映済み）が確定した時点で相手画面に通知する
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'evolve', handIdx, slotIdx, cardName: card.name, baseName: base.name || '', cardImg: card.imgSrc || '', evolveCost: cost });
  const evolved = Object.assign({}, card, {
    // デュアルカードは進化後デジモンとして扱う（アタック/ブロック判定等はtype==='デジモン'固定のため）
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    // デュアルカードのrecipe.mainはオプション使用時の効果であり、進化後に「⚡ 効果」
    // として再発動できるものではないため、進化後は抑制する
    _noMainAbility: card.type === 'デュアル',
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes, // 効果で付与された効果（【エグゼキュート】等）も進化後に引き継ぐ
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(base.stack || []),
  });
  // バースト進化（総合ルール8-3-2-1）: このターン終了時、重ねられているカードを
  // 上から1枚破棄する保留処理フラグ（processBurstEvolvePendingDiscardが消費する）
  if (opts && opts.isBurst) evolved._burstEvolvedPendingDiscard = true;
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  bs.player.battleArea[slotIdx] = evolved;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  // cond_evolved_this_turn 用カウンタを増加
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog((opts && opts.isBurst ? '🔥 バースト進化: ' : '⬆ ') + '「' + base.name + '」→「' + evolved.name + '」進化！（コスト ' + cost + '）');
  // チュートリアル: アクション完了の瞬間に指差し/吹き出しを消す
  if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
    try { window._tutorialHideInstruction(); } catch (e) {}
  }
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, async () => {
    // ★ 公式ルール: コスト支払い(メモリー消費) → ドロー → 進化時効果 → ターン終了判定
    playerSpendMemory(cost, true); // defer=true: ターン終了は保留
    // チュートリアル: 進化通知 → GREAT! を先に出してからドロー演出へ
    if (window._tutorialRunner && window._tutorialRunner.active) {
      try { window._tutorialRunner.notifyEvent('evolve', { cardNo: evolved.cardNo, cardName: evolved.name, targetCardNo: evolved.cardNo, side: 'player' }); } catch (e) {}
    }
    if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
    doDraw('player', '進化ドロー', async (dismissDraw) => {
      // 割り込み: ドロー直後 (drawn_card スポットライト等)
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('evolve_cost');
      if (typeof dismissDraw === 'function') dismissDraw();
      const finishEvolve = async () => {
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('evolve');
        // 全工程完了 → 次ステップ表示を解放
        if (window._tutorialBattleDone) window._tutorialBattleDone();
        checkPlayerPendingTurnEnd();
      };
      // 進化コストの支払いでレストしたカードの「レストしたとき」（エアドラモン LM-009）が保留中なら、
      // 【進化時】が無くても誘発の処理を通す（checkAndTriggerEffect が同時誘発の列に足す）
      if (hasKeyword(evolved, '【進化時】') || _hasCostRestPending(bs)) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
          renderAll(true);
          finishEvolve();
        });
      } else {
        finishEvolve();
      }
    }, { deferDismiss: true });
  });
}

// ===== アプ合体（公式ルール8-4） =====
// 「本体（バトルエリアの指定名称デジモン）+ 本体にリンクしているカード（指定名称）」を
// 合わせて手札のアプ合体デジモンの進化元とする特殊ルート。通常進化と違い、進化条件
// （色/Lv/特徴）は無視し、_getAppGattaiEvolveが判定したlinkedPartnersのみを消費する。
// コストも進化コスト欄ではなく、アプ合体自体に指定されたコスト（appGattai.cost）を使う。
// ドラッグ&ドロップの通常進化経路（doEvolve/canEvolveOnto）には含めず、バトルエリア
// 本体の長押しメニュー「🔗 アプ合体」専用ルートとする（battle-render.jsから呼ばれる）

// slotIdxの本体に対して、アプ合体可能な手札カード一覧を返す（🔗ボタンの表示判定用）
export function getAppGattaiCandidates(slotIdx) {
  const base = bs.player.battleArea[slotIdx];
  if (!base) return [];
  return (bs.player.hand || []).map((c, i) => {
    let appGattai = null;
    try { appGattai = _getAppGattaiEvolve(c, base, bs, 'player'); } catch (_) {}
    return appGattai ? { card: c, handIdx: i, appGattai } : null;
  }).filter(Boolean);
}

// 長押しメニュー「🔗 アプ合体」から呼ばれる実行本体。chosenPartnersを指定すると
// （リンク+1等で候補が複数ある場合にプレイヤーが選んだ部分集合）そのカードのみ消費し、
// 未指定なら成立している全リンクカードを消費する（候補1枚のみの通常ケース）
export function doAppGattaiEvolve(handIdx, slotIdx, chosenPartners) {
  const card = bs.player.hand[handIdx];
  const base = bs.player.battleArea[slotIdx];
  if (!card || !base) return;
  const appGattai = _getAppGattaiEvolve(card, base, bs, 'player');
  if (!appGattai) { addLog('🚨 アプ合体の条件を満たしていません'); return; }
  const partners = (Array.isArray(chosenPartners) && chosenPartners.length > 0)
    ? appGattai.linkedPartners.filter(lc => chosenPartners.includes(lc))
    : appGattai.linkedPartners;
  if (partners.length === 0) { addLog('🚨 アプ合体で使用するリンクカードがありません'); return; }
  _finishAppGattaiEvolve(card, base, handIdx, slotIdx, { cost: appGattai.cost, linkedPartners: partners });
}

function _finishAppGattaiEvolve(card, base, handIdx, slotIdx, appGattai) {
  const cost = appGattai.cost;
  const partners = appGattai.linkedPartners || [];
  if (_onlineMode && _sendCommand) {
    _sendCommand({
      type: 'evolve', handIdx, slotIdx, cardName: card.name, baseName: base.name || '',
      cardImg: card.imgSrc || '', evolveCost: cost, appGattai: true,
      partnerNames: partners.map(p => p.name || '?'),
    });
  }
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    _noMainAbility: card.type === 'デュアル',
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes, // 効果で付与された効果（【エグゼキュート】等）も進化後に引き継ぐ
    dpModifier: base.dpModifier || 0,
    // 公式8-4-3-3: 選んだデジモンのリンクカードを本体の上に重ね、その上にアプ合体先を重ねる
    stack: [base].concat(partners).concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  base.linkedCards = (base.linkedCards || []).filter(lc => !partners.includes(lc));
  bs.player.battleArea[slotIdx] = evolved;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog('🔗 「' + base.name + '」＋' + partners.map(p => '「' + (p.name || '?') + '」').join('＋') + ' →「' + evolved.name + '」アプ合体！（コスト ' + cost + '）');
  if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
    try { window._tutorialHideInstruction(); } catch (e) {}
  }
  renderAll();
  showAppGattaiEffect(cost, base, partners, evolved, async () => {
    // 公式ルール: コスト支払い(メモリー消費) → ドロー → 進化時効果 → ターン終了判定
    playerSpendMemory(cost, true); // defer=true: ターン終了は保留
    doDraw('player', 'アプ合体ドロー', async (dismissDraw) => {
      if (typeof dismissDraw === 'function') dismissDraw();
      const finishEvolve = () => checkPlayerPendingTurnEnd();
      if (hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
          renderAll(true);
          finishEvolve();
        });
      } else {
        finishEvolve();
      }
    }, { deferDismiss: true });
  });
}

// アプ合体演出（fxAppGattai）を呼び、完了後にonDoneする薄いラッパー。
// showEvolveEffectと違いテンプレートDOMに依存せず自己完結のオーバーレイを都度生成する
export function showAppGattaiEffect(cost, baseCard, partnerCards, resultCard, onDone) {
  try {
    fxAppGattai(baseCard, partnerCards, resultCard, cost, () => { onDone && onDone(); });
  } catch (e) {
    console.error('[showAppGattaiEffect] error', e);
    onDone && onDone();
  }
}

// 効果から直接進化を実行する（進化条件チェック・進化先候補の絞り込みは呼び出し元
// （effect-engine.js の action:'evolve'）で完了している前提）。ピョコモン(BT26-001)
// 「デッキが自分の効果で増えたとき、手札の『クロノモン』の記述があるデジモンカードに
// 支払うコスト-1で進化できる」のように、効果起点で進化させたい場合に使う（進化条件
// （canEvolveOnto）の判定は呼び出し元の _effectEvoAllowed で行う。公式ルール8-1-2-2）。
// doEvolve/_finishDoEvolveのコア処理（スタック構築・メモリー消費・ドロー・進化時効果発火）を
// 両サイド対応で再利用できるようにした版。
// card: 進化先(手札)カード, handIdx: p.hand内index, slotIdx: 進化元(base)のbattleArea内index,
// cost: 実際に支払う進化コスト（呼び出し側で軽減計算済み）, side: 'player'|'ai'
// 置き換えの処理中に保留した【進化時】を、保留した順に発揮する（まだ場にいるものだけ）。done()
// 実行中に再度呼ばれたら（アタック終了時と相手の端末からの依頼が重なった等）、実行中の分が全て終わってから
// 完了を返す（以前は2回目が「保留は空」として即座に完了を返し、相手の端末が先へ進んでいた）
let _flushingDeferredEvo = false;
const _flushDeferredEvoWaiters = [];
export function flushDeferredEvoTriggers(done0) {
  if (_flushingDeferredEvo) { _flushDeferredEvoWaiters.push(done0); return; }
  _flushingDeferredEvo = true;
  const done = () => {
    // 発揮中に新しく保留が増えていれば続けて発揮する
    if (Array.isArray(bs._deferredEvoTriggers) && bs._deferredEvoTriggers.length > 0) { _flushingDeferredEvo = false; flushDeferredEvoTriggers(done0); return; }
    _flushingDeferredEvo = false;
    const ws = _flushDeferredEvoWaiters.splice(0);
    done0 && done0();
    ws.forEach(w => { try { w && w(); } catch (_) {} });
  };
  const list = Array.isArray(bs._deferredEvoTriggers) ? bs._deferredEvoTriggers.splice(0) : [];
  if (typeof window._hudSetDeferredEvo === 'function') window._hudSetDeferredEvo(list);
  let i = 0;
  const next = () => {
    if (i >= list.length) { if (typeof window._hudSetDeferredEvo === 'function') window._hudSetDeferredEvo([]); renderAll(true); done && done(); return; }
    const d = list[i++];
    // 発揮を始めた分は「保留中」の表示から外す（発揮すると【進化時】の各効果が発揮待ちとして別に表示されるため、
    // 残していると同じ効果が2回並んで見えていた）
    if (typeof window._hudSetDeferredEvo === 'function') window._hudSetDeferredEvo(list.slice(i));
    const p = d.side === 'player' ? bs.player : bs.ai;
    if (!d.card || !(p.battleArea || []).includes(d.card)) {
      addLog('💨 「' + (d.card && d.card.name) + '」は【進化時】を発揮する前に場を離れたため、効果を発揮できない');
      next();
      return;
    }
    _hooks.checkAndTriggerEffect(d.card, '【進化時】', () => { renderAll(true); next(); }, d.side);
  };
  next();
}
if (typeof window !== 'undefined') window._flushDeferredEvoTriggers = flushDeferredEvoTriggers;

export function doEvolveFromEffect(card, handIdx, slotIdx, cost, side, callback) {
  const p = side === 'player' ? bs.player : bs.ai;
  const base = p.battleArea[slotIdx];
  if (!base || !card) { callback && callback(false); return; }
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    _noMainAbility: card.type === 'デュアル',
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes, // 効果で付与された効果（【エグゼキュート】等）も進化後に引き継ぐ
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  p.battleArea[slotIdx] = evolved;
  const _hi = p.hand.indexOf(card);
  if (_hi !== -1) p.hand.splice(_hi, 1);
  if (side === 'player') bs.selHand = null;
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog('⬆ 「' + base.name + '」→「' + evolved.name + '」進化！（効果・コスト ' + cost + '）');
  // オンライン: 相手画面に進化演出を通知（盤面自体は効果完了後の state_sync で同期）
  if (side === 'player' && _onlineMode && _sendCommand) {
    try { _sendCommand({ type: 'evolve', cardName: evolved.name, baseName: base.name || '', cardImg: evolved.imgSrc || '', evolveCost: cost }); } catch (_) {}
  }
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, () => {
    // 公式ルール: コスト支払い(メモリー消費) → ドロー → 進化時効果 → ターン終了判定
    if (side === 'player') playerSpendMemory(cost, true); // defer=true: ターン終了は保留
    else aiSpendMemory(cost);
    doDraw(side, '進化ドロー（効果）', () => {
      const finish = () => {
        if (side === 'player') checkPlayerPendingTurnEnd({ noFlush: true });
        callback && callback(true);
      };
      // 「離れるとき」等の置き換えの処理中の進化なら、【進化時】は保留して元の処理の後に発揮する
      // （flushDeferredEvoTriggers。effect-engine.js の _tryCancelLeaveLocal 参照）
      if (hasKeyword(evolved, '【進化時】') && (bs._deferEvoTriggerDepth || 0) > 0) {
        if (!Array.isArray(bs._deferredEvoTriggers)) bs._deferredEvoTriggers = [];
        bs._deferredEvoTriggers.push({ card: evolved, side });
        addLog('⏳ 「' + evolved.name + '」の【進化時】は、消滅等の処理が終わってから発揮します');
        if (typeof window._hudSetDeferredEvo === 'function') window._hudSetDeferredEvo(bs._deferredEvoTriggers);
        renderAll(true);
        finish();
      } else if (hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => { renderAll(true); finish(); }, side);
      } else {
        finish();
      }
    }, { deferDismiss: false });
  });
}

// ===== 効果によるジョグレス進化（公式ルール 8-2） =====
// left: 上に重ねる進化元（ジョグレスの条件の左側） / right: その下。それぞれの進化元ごと重ねる（8-2-2-3）。
// 進化したデジモンは別の1体（新しいカード。8-2-2-1）: アクティブ・登場したターンの情報なし・付与された効果は失われる・
// 【ターンに1回】はリセット。リンクカードは重ねる前に破棄（8-2-2-1-2）。コスト支払い → 1枚ドロー → 【進化時】
// callback(evolved | false)
export function doJogressFromEffect(card, left, right, cost, side, callback, opts) {
  opts = opts || {};
  const p = side === 'player' ? bs.player : bs.ai;
  const li = p.battleArea.indexOf(left), ri = p.battleArea.indexOf(right);
  if (!card || li === -1 || ri === -1 || left === right) { callback && callback(false); return; }
  [left, right].forEach((m) => {
    (m.linkedCards || []).forEach(lc => p.trash.push(lc));
    m.linkedCards = [];
  });
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    _noMainAbility: card.type === 'デュアル',
    suspended: false,
    summonedThisTurn: false,
    buffs: [], _grantedRecipes: undefined,
    dpModifier: 0,
    linkedCards: [],
    stack: [left].concat(left.stack || [], [right], right.stack || []),
    _jogressEvolved: true,
    // 別の1体（新しいカード）: 【ターンに1回】等の回数は進化元とは別に数え直す（公式ルール 8-2-2-1-6）
    _uid: undefined,
    cantAttack: false, _attackWithoutRest: undefined, _digicrossed: undefined,
  });
  evolved.dp = evolved.baseDp;
  p.battleArea[li] = evolved;
  p.battleArea[ri] = null;
  const _hi = p.hand.indexOf(card);
  if (_hi !== -1) p.hand.splice(_hi, 1);
  else { const _ti = p.trash.indexOf(card); if (_ti !== -1) p.trash.splice(_ti, 1); }
  if (side === 'player') bs.selHand = null;
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog('🔀 「' + left.name + '」＋「' + right.name + '」→「' + evolved.name + '」ジョグレス進化！（コスト ' + cost + '）');
  if (side === 'player' && _onlineMode && _sendCommand) {
    // 相手の画面にもジョグレス（融合）演出を出す（盤面は完了後の state_sync で同期）
    try {
      _sendCommand({ type: 'jogress', cardName: evolved.name, cardImg: evolved.imgSrc || '', evolveCost: cost,
        leftName: left.name, leftImg: left.imgSrc || '', rightName: right.name, rightImg: right.imgSrc || '' });
    } catch (_) {}
  }
  renderAll();
  const _jgFx = (next) => { try { fxJogressFusion(left, right, evolved, cost, next); } catch (_) { next(); } };
  _jgFx(() => {
    if (side === 'player') playerSpendMemory(cost, true);
    else aiSpendMemory(cost);
    doDraw(side, 'ジョグレス進化ドロー', () => {
      const finish = () => {
        // 手札からの通常のジョグレス進化はプレイヤーの行動なので、ターン終了の判定もそのまま行う
        if (side === 'player') checkPlayerPendingTurnEnd(opts.fromHand ? undefined : { noFlush: true });
        if (side === 'player' && _onlineMode) _dispatchStateSync();
        callback && callback(evolved);
      };
      if (hasKeyword(evolved, '【進化時】') && (bs._deferEvoTriggerDepth || 0) > 0) {
        if (!Array.isArray(bs._deferredEvoTriggers)) bs._deferredEvoTriggers = [];
        bs._deferredEvoTriggers.push({ card: evolved, side });
        addLog('⏳ 「' + evolved.name + '」の【進化時】は、消滅等の処理が終わってから発揮します');
        if (typeof window._hudSetDeferredEvo === 'function') window._hudSetDeferredEvo(bs._deferredEvoTriggers);
        renderAll(true);
        finish();
      } else if (hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => { renderAll(true); finish(); }, side);
      } else {
        finish();
      }
    }, { deferDismiss: false });
  });
}

// ===== 手札からの通常のジョグレス進化（公式ルール 5-1-2-2 / 8-2-3） =====
// base（重ねた先の自分のデジモン）を進化元の1体として使える組み合わせ [{left,right,cost}] を返す
function _handJogressPairs(card, base) {
  if (!card || !base || (card.type !== 'デジモン' && card.type !== 'デュアル')) return [];
  let conds = [];
  try { conds = _getJogressConditions(card) || []; } catch (_) { conds = []; }
  if (conds.length === 0) return [];
  const mats = bs.player.battleArea.filter(c => c && c !== base && (c.type === 'デジモン' || c.type === 'デュアル' || !c.type));
  const out = [];
  conds.forEach((jc) => {
    mats.forEach((o) => {
      if (_jogressSlotMatches(base, jc.slots[0], bs, 'player') && _jogressSlotMatches(o, jc.slots[1], bs, 'player')) out.push({ left: base, right: o, cost: jc.cost });
      if (_jogressSlotMatches(o, jc.slots[0], bs, 'player') && _jogressSlotMatches(base, jc.slots[1], bs, 'player')) out.push({ left: o, right: base, cost: jc.cost });
    });
  });
  return out;
}
// 手札の［ジョグレス進化］を持つカードをバトルエリアの空いている所に置いたとき: 場の2体でジョグレス進化できるなら
// 「ジョグレス進化しますか？」を聞く（グソクモン EX12-028。以前は確認なしで普通に登場していた）。
// ジョグレスするなら1体目を選んでからもう1体を選ぶ。しないなら elsePlay（通常の登場）。ジョグレスできる組み合わせが
// 無ければ false を返す（呼び出し側がそのまま登場させる）
export function offerHandJogressOnEmpty(card, handIdx, slotIdx, elsePlay) {
  if (!card || bs.phase !== 'main' || _attackInProgress) return false;
  const bases = bs.player.battleArea.filter(c => c && (c.type === 'デジモン' || c.type === 'デュアル' || !c.type));
  const byBase = new Map();
  bases.forEach((b) => { const ps = _handJogressPairs(card, b); if (ps.length > 0) byBase.set(b, ps); });
  if (byBase.size === 0) return false;
  showConfirm({
    title: 'ジョグレス進化',
    message: '「' + card.name + '」を場のデジモン2体でジョグレス進化しますか？',
    yesText: '🔀 ジョグレス進化', noText: (card.playCost === null || card.playCost === undefined) ? 'やめる' : '⬇ 登場させる', color: '#ffd54f',
  }).then((yes) => {
    if (!yes) { if (card.playCost === null || card.playCost === undefined) { addLog('☓ ジョグレス進化をやめた'); return; } elsePlay && elsePlay(); return; }
    const firsts = [...byBase.keys()];
    // 素材にできるデジモンが1体だけ（他は無い）ことは無いので、常に1体目を選んでもらう（自動で決めない）
    if (firsts.length <= 1) { const b = firsts[0]; _doHandJogress(card, b, byBase.get(b)); return; }
    const idxs = firsts.map(b => bs.player.battleArea.indexOf(b)).filter(i => i >= 0);
    _showTargetSelection('pl', idxs, null, '#ffd54f', (idx) => {
      if (idx === null || idx === undefined) { addLog('☓ ジョグレス進化をやめた'); return; }
      const b = bs.player.battleArea[idx];
      _doHandJogress(card, b, byBase.get(b) || []);
    }, '（「' + card.name + '」にジョグレス進化するデジモン・1体目）');
  });
  return true;
}
// もう1体を選んでジョグレス進化する（候補が1体ならそのまま）
function _doHandJogress(card, base, pairs) {
  const others = [];
  pairs.forEach(p => { const o = p.left === base ? p.right : p.left; if (!others.includes(o)) others.push(o); });
  const go = (other) => {
    const pair = pairs.find(p => (p.left === base && p.right === other) || (p.right === base && p.left === other));
    if (!pair) return;
    let cost = pair.cost || 0;
    // 進化に影響を及ぼす効果はジョグレス進化にも及ぶ（公式ルール 8-2-2-5）
    try { cost = Math.max(0, cost - _getStaticEvoCostReduction(card, base, bs, 'player')); } catch (_) {}
    const _ed = _consumePendingEvoCostReduction(card, base);
    if (_ed > 0) cost = Math.max(0, cost - _ed);
    addLog('🔀 ジョグレス進化を宣言: 「' + card.name + '」（「' + pair.left.name + '」＋「' + pair.right.name + '」）');
    doJogressFromEffect(card, pair.left, pair.right, cost, 'player', () => { renderAll(); }, { fromHand: true });
  };
  if (others.length === 1) { go(others[0]); return; }
  const idxs = others.map(o => bs.player.battleArea.indexOf(o)).filter(i => i >= 0);
  _showTargetSelection('pl', idxs, null, '#ffd54f', (idx) => {
    if (idx === null || idx === undefined) { addLog('☓ ジョグレス進化をやめた'); return; }
    go(bs.player.battleArea[idx]);
  }, '（「' + card.name + '」にジョグレス進化する、もう1体のデジモン）');
}

// ===== 【トレーニング】キーワード起動効果 =====
// 公式ルール4-41:「メインフェイズ中、このデジモンをレストさせることで、自分のデッキの
// 上から1枚をこのデジモンの進化元の下に裏向きで置く。この効果は育成エリアでも発揮できる」
// レシピ非依存のハードコード実装（passive の training フラグのみで判定・発動）。
// card はバトルエリア/育成エリアどちらのカード参照でもよい（呼び出し側が対象を渡す）
export function doTrainingEffect(card, side) {
  if (!card) return false;
  if (!_hasTrainingKeyword(card)) return false;
  if (card.suspended || card.cantRest) return false;
  if (bs.phase !== 'main') return false;
  const p = side === 'player' ? bs.player : bs.ai;
  if (!p.deck || p.deck.length === 0) { addLog('⚠ デッキが空です'); return false; }
  card.suspended = true;
  if (!card.stack) card.stack = [];
  const top = p.deck.shift();
  top._faceDown = true;
  card.stack.push(top);
  addLog('🎓 【トレーニング】「' + card.name + '」をレスト。デッキの上から1枚を進化元の下に裏向きで置いた');
  renderAll();
  if (side === 'player' && window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
    try { window._onlineSendStateSync(); } catch (_) {}
  }
  // バトルエリアのデジモンなら「進化元にカードが（効果で）置かれたとき」を発火
  // （トレーマニュアル BT26-099「自分のデジモンの進化元に裏向きのカードが置かれたとき」等）
  const _afterMove = () => {
    if ((p.battleArea || []).includes(card)) {
      try {
        _fireWhenEvoSourceIncrease(card, side, bs, { bs, addLog, renderAll, updateMemGauge }, () => renderAll(), [top], { type: 'effect', causerSide: side, causerCard: card });
      } catch (e) { console.error('[doTrainingEffect] evo source increase trigger', e); }
    }
  };
  // デッキ→進化元の移動演出（自分の画面は表向き、相手の画面は裏向き）
  if (typeof window !== 'undefined' && typeof window._fxMoveSyncSide === 'function') {
    window._fxMoveSyncSide(side, top, 'デッキ', '「' + card.name + '」の進化元', _afterMove, side === 'player' ? { remoteFaceDown: true } : { faceDown: true });
  } else {
    _afterMove();
  }
  return true;
}

// ===== 育成エリア進化 =====

export function doEvolveIku(card, handIdx) {
  if (bs.phase !== 'main') return;
  if (_attackInProgress) return;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'breed_evolve', handIdx, cardName: card.name, baseName: bs.player.ikusei?.name || '', cardImg: card.imgSrc || '', evolveCost: card.evolveCost || 0 });
  const base = bs.player.ikusei;
  if (!base) return;
  if (card.evolveCost === null) { addLog('🚨 「' + card.name + '」は進化できません‼'); return; }
  if (!canEvolveOnto(card, base)) { addLog('🚨 進化条件を満たしていません‼（' + card.evolveCond + '）'); return; }

  // 進化条件が複数(OR)ある場合、成立したclauseに対応するコスト（進化コスト欄の「・」区切り）を選ぶ
  let cost = getEvolveCostFor(card, base);
  // 代替進化（alt_evolve・進化条件を無視）が成立していれば、その指定コストを使う
  const _altEvo = _getAltEvolve(card, base, bs, 'player');
  if (_altEvo) { cost = _altEvo.cost; addLog('⬆ 代替進化（進化条件を無視）コスト' + cost); }
  const _evoDisc = _consumePendingEvoCostReduction(card, base);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    // デュアルカードのrecipe.mainはオプション使用時の効果であり、進化後に「⚡ 効果」
    // として再発動できるものではないため、進化後は抑制する
    _noMainAbility: card.type === 'デュアル',
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes, // 効果で付与された効果（【エグゼキュート】等）も進化後に引き継ぐ
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  bs.player.ikusei = evolved;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  addLog('⬆ 育成「' + base.name + '」→「' + evolved.name + '」進化！（コスト ' + cost + '）');
  // チュートリアル: アクション完了の瞬間に指差し/吹き出しを消す
  if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
    try { window._tutorialHideInstruction(); } catch (e) {}
  }
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, async () => {
    // ★ 公式ルール: コスト支払い(メモリー消費) → ドロー → 進化時効果 → ターン終了判定
    playerSpendMemory(cost, true); // defer=true: ターン終了は保留
    // チュートリアル: 進化通知 → GREAT! を先に出してからドロー演出へ
    if (window._tutorialRunner && window._tutorialRunner.active) {
      try { window._tutorialRunner.notifyEvent('evolve', { cardNo: evolved.cardNo, cardName: evolved.name, targetCardNo: evolved.cardNo, side: 'player' }); } catch (e) {}
    }
    if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
    doDraw('player', '進化ドロー', async (dismissDraw) => {
      // 割り込み: ドロー直後 (drawn_card スポットライト等)
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('evolve_cost');
      if (typeof dismissDraw === 'function') dismissDraw();
      const finishEvolveIku = async () => {
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('evolve');
        // 全工程完了 → 次ステップ表示を解放
        if (window._tutorialBattleDone) window._tutorialBattleDone();
        checkPlayerPendingTurnEnd();
      };
      // ＜育成＞ 限定の発火条件は廃止。on_evolve レシピがあれば発火する。
      if (hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
          renderAll(true);
          finishEvolveIku();
        });
      } else {
        finishEvolveIku();
      }
    }, { deferDismiss: true });
  });
}

// リンク容量が上限に達している時、どのリンクカードを外すか選ばせる（2枚以上いる場合のみ）。
// Promise<card> — 選ばれたリンクカードを返す
function showLinkReplaceChoice(linkedCards) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65500;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
    const title = document.createElement('div');
    title.style.cssText = 'color:#ffaa00;font-size:14px;font-weight:bold;margin-bottom:16px;text-shadow:0 0 8px #ffaa0066;text-align:center;';
    title.innerText = '🔗 リンク上限です。外すカードを選んでください';
    overlay.appendChild(title);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;';
    linkedCards.forEach((lc) => {
      const btn = document.createElement('div');
      btn.style.cssText = 'width:100px;height:140px;border-radius:8px;border:2px solid #ffaa00;overflow:hidden;cursor:pointer;box-shadow:0 0 10px #ffaa0044;';
      const src = cardImg(lc);
      btn.innerHTML = src
        ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">'
        : '<div style="color:#ffaa00;font-size:10px;padding:8px;">' + (lc.name || '?') + '</div>';
      btn.onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(lc); };
      list.appendChild(btn);
    });
    overlay.appendChild(list);
    document.body.appendChild(overlay);
  });
}

// リンク条件（linkCond）を満たすか判定。「特徴:XXX」「特徴「XXX」」形式に対応（Lv指定は無し＝色/レベル不問）。
// 条件が空なら誰にでもリンク可
export function meetsLinkCondition(card, base) {
  const cond = String(card.linkCond || '').trim();
  if (!cond) return true;
  const m = cond.match(/特徴[:：「]\s*(.+?)」?\s*$/);
  if (!m) return true; // 未知の形式は素通り（今後拡張）
  const reqFeature = m[1].trim();
  return String(base.feature || '').includes(reqFeature);
}

// ===== リンク =====
// リンクありのカードをバトルエリアの既存デジモンにドラッグした際、進化の代わりに
// 選べる操作。進化コストの代わりにリンクコストを支払い、対象デジモンの横に
// リンクする（card.linkedCards に追加）。リンク時効果（【リンク時】）があれば発動する。
// opts.fromField: バトルエリアのカードをリンクする（公式ルール 6-5-1-4「手札/バトルエリアのカードのリンク」）。
// handIdx の代わりに opts.fromIdx（リンクするカードのバトルエリアの位置）を使う。リンクするカードの下の
// 進化元・リンクカードはトラッシュへ（リンクカードは進化元・リンクを持たない）
export function doLink(card, handIdx, slotIdx, opts) {
  opts = opts || {};
  if (bs.phase !== 'main') return;
  if (_attackInProgress) return;
  const base = bs.player.battleArea[slotIdx];
  if (!base) return;
  const _fromField = !!opts.fromField;
  if (_fromField && (bs.player.battleArea[opts.fromIdx] !== card || opts.fromIdx === slotIdx)) return;
  if (card.linkCost == null) { addLog('🚨 「' + card.name + '」はリンクできません‼'); return; }
  if (!meetsLinkCondition(card, base)) { addLog('🚨 リンク条件を満たしていません‼（' + card.linkCond + '）'); return; }
  if (!base.linkedCards) base.linkedCards = [];

  const proceedLink = () => {
    const cost = card.linkCost;
    const _rp = card._linkReplaced || null; // 差し替えで外したカード（リンク演出で入れ替える）
    if (_onlineMode && _sendCommand) _sendCommand({ type: 'link', handIdx, slotIdx, cardName: card.name, baseName: base.name, cardImg: card.imgSrc || '', baseImg: cardImg(base) || '', linkCost: cost,
      replacedName: _rp ? _rp.name : '', replacedImg: _rp ? (cardImg(_rp) || '') : '', fromField: _fromField });
    if (_fromField) {
      // バトルエリアから外し、下にあったカードはトラッシュへ。リンクカードとして状態を初期化する
      bs.player.battleArea[opts.fromIdx] = null;
      (card.stack || []).forEach((c) => { if (c) bs.player.trash.push(c); });
      (card.linkedCards || []).forEach((c) => { if (c) bs.player.trash.push(c); });
      card.stack = []; card.linkedCards = [];
      card.suspended = false; card.buffs = []; card._grantedRecipes = []; card._permEffects = {};
      card.cantAttack = false; card.cantBlock = false; card.cantRest = false;
      if (card.baseDp != null) card.dp = card.baseDp;
      card.dpModifier = 0;
      addLog('🔗 「' + card.name + '」をバトルエリアからリンク');
    } else {
      bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    }
    base.linkedCards.push(card);
    addLog('🔗 「' + base.name + '」に「' + card.name + '」をリンク！（コスト ' + cost + '）');
    card._lastLinkCost = cost; // リンク演出の「〇コストでリンク！」用
    if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
      try { window._tutorialHideInstruction(); } catch (e) {}
    }
    renderAll();
    fxLinkEffect(base, card, () => {
      // ★ 登場/進化と同じ順序: コスト支払い → 永続効果再計算 → リンク時効果 → ターン終了判定
      playerSpendMemory(cost, true); // defer=true
      _hooks.applyPermanentEffects('player');
      renderAll(true);
      const finishLink = () => {
        checkPlayerPendingTurnEnd();
      };
      _fireLinkTriggers(card, 'player', base, 'player', _hooks.makeEffectContext(card, 'player'), () => {
        renderAll(true);
        finishLink();
      });
    });
  };

  // リンク容量チェック（cond_link_eligible と同じ計算式）。上限に達している場合は
  // 差し替え扱いで、既存のリンクカードを1枚トラッシュへ送って空きを作る
  // （「破棄された時」の効果ではないため、消滅トリガー等は発生させず直接trashへ送る）。
  // 2枚以上リンクされている場合はどちらを外すか選ばせる
  const cap = (base._linkCapacityBonus || 0) + (base._linkPlusPassive || 0) + 1;
  if (base.linkedCards.length >= cap) {
    const doReplace = (replaced) => {
      if (!replaced) { proceedLink(); return; }
      const ri = base.linkedCards.indexOf(replaced);
      if (ri >= 0) base.linkedCards.splice(ri, 1);
      bs.player.trash.push(replaced);
      addLog('🔄 リンク上限のため「' + replaced.name + '」がリンクから外れてトラッシュへ');
      card._linkReplaced = replaced; // リンク演出で、刺さっていたカードと入れ替えるアニメーションにする
      renderAll();
      proceedLink();
    };
    if (base.linkedCards.length === 1) {
      doReplace(base.linkedCards[0]);
    } else {
      showLinkReplaceChoice(base.linkedCards).then(doReplace);
    }
    return;
  }
  proceedLink();
}

// ===== アーツ進化（デュアルカード専用） =====
// オプションとして使用した後、進化コストを支払わず進化できる（任意）。
// 進化条件を満たす自分のデジモンが場（バトルエリア/育成エリア）にいる場合のみ提示する
function _findArtsEvolveCandidates(card, side) {
  const p = side === 'ai' ? bs.ai : bs.player;
  const candidates = [];
  (p.battleArea || []).forEach((base, i) => {
    if (base && (base.type === 'デジモン' || base.type === 'デュアル') && canEvolveOnto(card, base)) {
      candidates.push({ base, area: 'battle', idx: i });
    }
  });
  if (p.ikusei && p.ikusei.type === 'デジモン' && canEvolveOnto(card, p.ikusei)) {
    candidates.push({ base: p.ikusei, area: 'ikusei', idx: -1 });
  }
  return candidates;
}

function _placeArtsEvolve(card, target, side) {
  const p = side === 'ai' ? bs.ai : bs.player;
  const { base, area, idx } = target;
  const evolved = Object.assign({}, card, {
    type: 'デジモン', // デュアルカードは進化後デジモンとして扱う
    _noMainAbility: true, // recipe.mainはオプション使用時の効果のため進化後は再発動不可にする
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes, // 効果で付与された効果（【エグゼキュート】等）も進化後に引き継ぐ
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  if (area === 'battle') p.battleArea[idx] = evolved;
  else p.ikusei = evolved;
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog((side === 'ai' ? '🤖 AIが' : '') + '「' + base.name + '」→「' + evolved.name + '」にアーツ進化！（コスト無し）');
  renderAll();
  return evolved;
}

// 「アーツ進化しますか？」を確認し、承諾かつ対象が複数いれば他の効果と同じ対象選択UI
// （場のカードを直接タップして選ぶ）で選ばせてから進化させる（プレイヤー専用）。
// onDone(evolved) — 進化した場合は進化後カード、しなかった場合は null/undefined を渡す
if (typeof window !== 'undefined') window._offerArtsEvolve = (card, onDone) => _offerArtsEvolve(card, onDone);
function _offerArtsEvolve(card, onDone0) {
  const candidates = _findArtsEvolveCandidates(card, 'player');
  if (candidates.length === 0) {
    // 進化元にできるデジモンが「進化できない」状態（ロゼモン：バーストモード BT26-050 等）だけなら、理由を出してからトラッシュへ
    // （以前は何も出さずにトラッシュへ送っていて、アーツ進化の確認が出ないように見えていた）
    const _blocked = (bs.player.battleArea || []).filter(b => b && (b.type === 'デジモン' || b.type === 'デュアル')
      && (b.cantEvolve || (Array.isArray(b.buffs) && b.buffs.some(x => x && x.type === 'cant_evolve')))
      && (() => { try { return _resolveEvolveMatch(card, b) !== null || !!_getAltEvolve(card, b, bs, 'player'); } catch (_) { return false; } })());
    if (_blocked.length > 0) {
      const _msg = '「' + _blocked.map(b => b.name).join('」「') + '」は進化できない状態のため、「' + card.name + '」にアーツ進化できません';
      addLog('🔒 ' + _msg);
      try { _showEffectAnnounce(card, _msg, 'player', () => onDone0()); } catch (_) { onDone0(); }
      return;
    }
    onDone0();
    return;
  }
  // 「アーツ進化しますか？」の確認から【進化時】の解決が終わるまでは効果の処理中として扱う（メモリーが相手側に
  // 移っていても、この間にターン終了に進まない。ロゼモン：バーストモード BT26-050 で【進化時】の前にターンが終わっていた）
  if (typeof window !== 'undefined' && window._effectBusy) window._effectBusy(1);
  let _busyDone = false;
  const onDone = (...a) => {
    if (_busyDone) { onDone0(...a); return; }
    _busyDone = true;
    if (typeof window !== 'undefined' && window._effectBusyEnd) { window._effectBusyEnd(() => onDone0(...a)); return; }
    if (typeof window !== 'undefined' && window._effectBusy) window._effectBusy(-1);
    onDone0(...a);
  };

  const finishWith = (cand) => {
    const evolved = _placeArtsEvolve(card, cand, 'player');
    if (_onlineMode && _sendCommand) {
      _sendCommand({ type: 'fx_artsEvolve', baseName: cand.base.name, baseImg: cardImg(cand.base), cardName: evolved.name, cardImg: cardImg(evolved) });
      if (typeof window !== 'undefined' && window._onlineSendStateSync) window._onlineSendStateSync();
    }
    showEvolveEffect(0, cand.base.name, cand.base, evolved, () => afterPlace(evolved), { arts: true });
  };
  const afterPlace = (evolved) => {
    if (hasKeyword(evolved, '【進化時】')) {
      _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
        _hooks.applyPermanentEffects('player');
        renderAll(true);
        onDone(evolved);
      });
    } else {
      _hooks.applyPermanentEffects('player');
      renderAll(true);
      onDone(evolved);
    }
  };

  showConfirm({
    title: '✨ アーツ進化',
    message: 'コストを支払わず進化しますか？',
    yesText: 'はい', noText: 'いいえ', color: '#ffcc00',
  }).then((yes) => {
    if (!yes) { onDone(); return; }
    if (candidates.length === 1) { finishWith(candidates[0]); return; }
    // 対象選択UIはバトルエリアのスロットしか対象にできないため、バトルエリア候補が
    // 無い場合（育成エリアのみ複数、という現状あり得ないケース含む）は先頭を確定させる
    const battleCandidates = candidates.filter(c => c.area === 'battle');
    if (battleCandidates.length === 0) { finishWith(candidates[0]); return; }
    const validIndices = battleCandidates.map(c => c.idx);
    _showTargetSelection('pl', validIndices, null, '#ffcc00', (selectedIdx) => {
      const cand = battleCandidates.find(c => c.idx === selectedIdx) || battleCandidates[0];
      finishWith(cand);
    }, '（アーツ進化させるデジモン）');
  });
}

// ===== メモリー消費（プレイヤー） =====

// cost を消費し、メモリーが相手側に超過した場合は checkAutoTurnEnd を呼ぶ。
// defer=true の場合はターン終了判定を bs._pendingTurnEnd に保留し、呼び出し側で
// 全ての効果処理完了後に checkPlayerPendingTurnEnd() を呼ぶ。
function playerSpendMemory(cost, defer) {
  if (cost === 0) { updateMemGauge(); return false; }
  bs.memory -= cost;
  updateMemGauge();
  _dispatchMemoryUpdate();
  if (bs.memory < 0) {
    if (defer) {
      bs._pendingTurnEnd = true;
      // 操作（進化・登場等）の続き（進化ドロー → 【進化時】等）が終わってからターン終了を判定する印。
      // battle-phase.js の見張り（_autoTurnEndWatch）は、この印がある間はターン終了を始めない
      bs._actionDeferTurnEnd = Date.now();
      return true;
    }
    checkAutoTurnEnd();
    return true;
  }
  return false;
}

// 効果処理完了後、保留中のターン終了判定を実行
// ターンが続くなら、効果の解決中に保留した「そのデジモンでアタックできる」をここで順に行う
// （全ての効果処理が終わってからアタック。2件目以降はアタック終了時の checkPendingTurnEnd が続ける）。
// opts.noFlush: 外側の効果処理がまだ残っている途中から呼ぶ場合（効果による進化 doEvolveFromEffect）
function checkPlayerPendingTurnEnd(opts) {
  delete bs._actionDeferTurnEnd;
  // 保留中のアタックは、メモリーが相手側に移っていてもターン内に発揮された効果なので先に行い、
  // 全て終わってからターン終了判定をする（2件目以降・最後の判定はアタック終了時の checkPendingTurnEnd が続ける）
  const _hasHeld = Array.isArray(bs._heldAttackResumes) && bs._heldAttackResumes.length > 0;
  const hasPendingAttack = ((Array.isArray(bs._pendingEffectAttacks) && bs._pendingEffectAttacks.length > 0) || _hasHeld) && typeof window._runPendingEffectAttack === 'function';
  if (hasPendingAttack) {
    // 外側の効果処理の途中 / 別のアタック中なら、そちらの完了時に改めて処理される
    // （アタック宣言のタイミングで止めたアタックは、アタック中でも続ける）
    if ((opts && opts.noFlush) || (_attackInProgress && !_hasHeld)) return;
    window._runPendingEffectAttack(bs, (started) => { if (!started) checkPendingTurnEndOnly(); });
    return;
  }
  if (bs._pendingTurnEnd) {
    bs._pendingTurnEnd = false;
    checkAutoTurnEnd();
  }
}

// AI メモリー消費
function aiSpendMemory(cost) {
  if (cost === 0) return false;
  bs.memory += cost;
  updateMemGauge();
  return bs.memory > 0;
}

// 自動ターン終了（メモリーオーバーフロー）→ battle-phase.jsのcheckAutoTurnEndに統合済み

// ===== アタック状態管理 =====

let _atkState = null; // { card, slotIdx }
let _attackInProgress = false; // アタック処理中フラグ（操作ロック用）
// ターン終了判定（battle-phase.js checkAutoTurnEnd）から、アタック処理中かを参照できるようにする
if (typeof window !== 'undefined') window._isAttackInProgress = () => _attackInProgress;
// 起動効果（デジモン/テイマーの【メイン】）の完了時用: 保留中の効果アタックだけを行う（ターン終了判定はしない）
if (typeof window !== 'undefined') window._flushPendingEffectAttacks = () => {
  const _hasHeld = Array.isArray(bs._heldAttackResumes) && bs._heldAttackResumes.length > 0;
  if ((_attackInProgress && !_hasHeld) || !bs.isPlayerTurn) return;
  if (((Array.isArray(bs._pendingEffectAttacks) && bs._pendingEffectAttacks.length > 0) || _hasHeld) && typeof window._runPendingEffectAttack === 'function') {
    // メモリーが相手側に移っていても保留中のアタックを先に行い、その後でターン終了判定
    window._runPendingEffectAttack(bs, (started) => { if (!started) checkPendingTurnEndOnly(); });
  }
};

export function isAttackInProgress() { return _attackInProgress; }

// 戦闘・操作ロック系フラグの強制リセット（チュートリアル再開時等の状態漏洩対策）
// 前シナリオで attack 中に異常終了すると _attackInProgress=true のまま残り、
// 次シナリオで doPlay 等が早期 return して反応しなくなる不具合の防止
export function resetCombatLocks() {
  _atkState = null;
  _attackInProgress = false;
}
if (typeof window !== 'undefined') {
  window._tutorialResetCombatLocks = resetCombatLocks;
}

// callback(ok): アタック宣言そのものの成否を非同期で通知する。when_opp_rest 誘発
// （オンラインでは相手機への委譲を含む）が完全に解決してからでないと、対象選択・
// バトル進行に進めない（効果発動ポップアップのOKを待たずバトルが進んでしまう不具合の修正）
export function startAttack(card, slotIdx, callback) {
  // ≪進撃≫: メモリーが相手側のとき（bs.memory < 0）でも進撃持ちならアタック可（公式ルール 18-16）
  var chargeAllowed = card && hasCharge(card) && bs.memory < 0;
  if (bs.phase !== 'main' && !chargeAllowed) { callback && callback(false); return false; }
  if (!card) { callback && callback(false); return false; }
  if (_attackInProgress) { callback && callback(false); return false; }
  if (chargeAllowed) addLog('⚔ 【進撃】「' + card.name + '」がメモリー相手側でアタック宣言');
  // アタック宣言でレストする（長押しメニューを開いただけではレストしない）
  // 公式ルール1194: レストさせることができないデジモンはアタック宣言ができない
  if (card.cantAttack || card.cantRest) { callback && callback(false); return false; }

  // when_opp_rest の解決待ちの間、別の攻撃宣言で状態が競合しないようロックする
  // （resolveAttackTarget 到達時に改めて true になるが、多重にしても問題ない）
  _attackInProgress = true;
  // アタック（バトル・セキュリティチェック）の消滅演出は、効果の消滅演出のまとめ（window._destroyFxBatch）に入れず
  // その場で出す。【エグゼキュート】等の効果でアタックしたとき、セキュリティデジモンの消滅演出が
  // 効果のステップの終わり（アタック終了時の自壊の後）まで後回しになっていた
  if (typeof window !== 'undefined') window._destroyFxBatch = null;
  // 「レストせずアタックできる」（attack options:without_rest）ならレストしない（その1回のアタックだけ）
  if (!card._attackWithoutRest) card.suspended = true;
  delete card._attackWithoutRest;
  card._attackedOnTurn = bs.turn; // cond_self_attacked 用（このターンにアタックしたか）
  bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
  _atkState = { card, slotIdx };
  addLog('⚔ 「' + card.name + '」でアタック！');
  renderAll();
  // ≪連携≫（任意）: 使うかを確認し、「はい」なら連携させるデジモンを選んでレストさせる（他に対象がなければ聞かない）
  _askCombo(card, () => {
  // アタック宣言による自身のレスト → 相手側の when_opp_rest 誘発（ヴェノムヴァンデモン等）。
  // ブロック時のレストと同じ反応経路。ここで発火しなければ「アタックでレスト」は
  // when_opp_rest を一切拾えない
  _fireAttackRestThen('player', card, () => {
    if (_onlineMode && _sendCommand) _sendCommand({ type: 'attack_start', atkIdx: slotIdx, atkName: card.name, atkDp: card.dp, atkImg: cardImg(card) });
    callback && callback(true);
  });
  });
  return true;
}

export function cancelAttack() {
  if (_atkState) {
    _atkState.card.suspended = false;
    _atkState = null;
    renderAll();
  }
}

export function getAttackState() { return _atkState; }

// 突進等の on_attack 効果（effect-engine.js の redirect_attack アクション）が
// ctx.bs._redirectedAttack = {side:'ai', idx, cardNo} を書き込んでいた場合、元の宣言
// （セキュリティ／デジモン問わず）を、そのデジモンへのアタックに差し替える。
// このヘルパーはプレイヤーがAI側をアタックする経路（resolveAttackTarget）専用のため、
// side!=='ai' のリダイレクト（反応系の自陣営リダイレクト等）は無視する。
// 呼び出し後は bs._redirectedAttack を消費（null化）する
// 「アタックの対象は変更されない」（ゲコモン BT26-021 cant_redirect_attack）を持つデジモンのアタック。
// ブロック（【ブロッカー】も効果）でアタック対象が変わることもないので、ブロックされない
function _cantRedirectAttack(c) {
  return !!(c && (c.cantRedirectAttack || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'cant_redirect_attack'))));
}
function _consumeRedirectedAttack(defaultTarget, defaultIdx) {
  const ra = bs._redirectedAttack;
  bs._redirectedAttack = null;
  const fallback = { target: defaultTarget, idx: defaultIdx, def: defaultTarget === 'digimon' ? bs.ai.battleArea[defaultIdx] : null };
  if (!ra || ra.side !== 'ai') return fallback;
  // cant_redirect_attack:「アタックの対象は変更されない」— 元々の宣言先デジモンが
  // この状態なら、リダイレクトを適用せず元の宣言のまま解決する
  if (fallback.def && fallback.def.cantRedirectAttack) return fallback;
  const def = bs.ai.battleArea[ra.idx];
  if (!def) return fallback;
  return { target: 'digimon', idx: ra.idx, def, redirected: true, byDefender: !!ra.byDefender };
}

// 【衝突】を持つか（このデジモンのアタック中、相手のデジモン全ては【ブロッカー】を得て、可能ならブロックしなければならない）。
// オンラインではブロックするかどうかは防御側の端末が決めるので、アタック宣言コマンドに載せて伝える（巨神兵器 BT26-085）
function _hasCollision(card) {
  if (!card) return false;
  if (card._permEffects && card._permEffects.collision) return true;
  if (Array.isArray(card.buffs) && card.buffs.some(b => b && b.type === 'keyword_collision')) return true;
  try { return !!_cardHasActivePassiveFlag(card, 'collision', bs, 'player'); } catch (_) { return false; }
}

// オンライン対戦: デジモンアタックの宣言送信 → ブロック応答待ち → バトル解決。
// 通常の宣言・突進等でセキュリティ宣言から差し替わった場合の両方から呼ばれる
// オンライン: ブロックされたら、防御側の端末がバトルを解決する（消滅・離れるとき・消滅時効果まで）。それが全て終わった
// 合図（block_battle_done）を待ってからアタック終了に進む（以前はすぐ進んでいたため、メモリーが相手側だと
// バトルの解決中に【自分のターン終了時】のエグゼキュート等が始まっていた）。≪貫通≫でセキュリティチェックに続く
// ときは、そのセキュリティチェックの終わりでアタック終了になる
function _afterOnlineBlockBattle(atk, atkIdx) {
  if (_onlineMode && typeof window._waitForBlockBattleDone === 'function') {
    window._waitForBlockBattleDone((res) => {
      renderAll();
      if (res && res.penetrate) return;
      // こちらの効果（自分のデジモンの消滅時効果で登場したデジモンの【登場時】等）を処理している途中なら、
      // それが終わってからアタック終了に進む
      const _t0 = Date.now();
      const _go = () => {
        if (window._isEffectRunning && window._isEffectRunning()) { setTimeout(_go, 300); return; }
        // アタックしたデジモンが残っていれば【アタック終了時】（≪エグゼキュート≫の消滅等）を発揮してから（以前はブロックのバトルの後に
        // 【アタック終了時】を通らず、エグゼキュートでアタックしたスカージキロプモン＆デスペアブラストが消滅しなかった）
        if (atk && bs.player.battleArea[atkIdx] === atk) { checkAttackEnd(atk, atkIdx); return; }
        checkPendingTurnEnd();
      };
      _go();
    });
    return;
  }
  checkPendingTurnEnd();
}
// オンライン: ブロックされた（＝アタックの対象がブロッカーに変更された。公式ルール 12-1-1）。こちら（攻撃側）の
// 「アタックの対象が変更されたとき」を発揮してから「ブロックされたとき」へ。防御側の分は防御側の端末が発揮する
function _onlineBlockedThen(atk, atkSlotIdx, cb) {
  _beginAttackResolution();
  const go = () => afterBlockedEffect(atk, atkSlotIdx, 'player', cb);
  if (typeof window._fireWhenTargetChangedLocal === 'function') window._fireWhenTargetChangedLocal('player', go);
  else go();
}
// noBlock: 効果でアタックの対象を変更した後（どちらの効果でも）。変更先はもう選ばれているので、相手の画面に
// 「ブロックしますか？」を出さない（ブロックの確認は、ブロックする側が選べるときだけ出す。ユーザー決定事項。
// ウォーグレイモン EX12-017【カウンター】・【突進】等）
function _sendAndResolveOnlineDigimonAttack(atk, atkSlotIdx, def, targetIdx, noBlock) {
  // 送るDPは付与中のバフから計算し直した値にする（防御側はこの値で勝敗を判定する）
  try { if (window._recalcDp) window._recalcDp(atk); } catch (_) {}
  _sendCommand({ type: 'attack_digimon', atkIdx: atkSlotIdx, defIdx: targetIdx, atkName: atk.name, defName: def.name, atkDp: atk.dp, atkBaseDp: atk.baseDp != null ? atk.baseDp : atk.dp, atkImg: cardImg(atk), atkCantBeBlocked: !!noBlock || !!(atk._permEffects && atk._permEffects.cantBeBlocked) || _cantRedirectAttack(atk), atkCantBeBlockedByNoEvo: !!(atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo), atkCollision: _hasCollision(atk) });
  if (typeof window._waitForBlockResponse === 'function') {
    window._waitForBlockResponse((resp) => {
      if (!resp.blocked) {
        resolveBattle(atk, atkSlotIdx, def, targetIdx, 'ai');
      } else {
        _onlineBlockedThen(atk, atkSlotIdx, () => {
          if (_onlineMode && _sendCommand) _sendCommand({ type: 'blocked_effect_done' });
          renderAll();
          _afterOnlineBlockBattle(atk, atkSlotIdx);
        });
      }
    });
  } else {
    resolveBattle(atk, atkSlotIdx, def, targetIdx, 'ai');
  }
}

// ===== アタック解決 =====

// アタック時の効果の間にアタッカーが進化した（アーツ進化等）なら、進化後のカードがアタッカー（同じデジモン）。
// 以前は進化前のカードのままブロック確認を送っていたため、進化後に得た【衝突】等が伝わらなかった
// （クーガモン→ムラサメモン＆豪ノ斬・叢時雨で進化→咲夜レーナ BT26-093 で【衝突】）
// アタック中のデジモンがバトルエリアを離れていれば、アタックはどこにも成立しない（公式ルール 11-2-7-4 / 11-5-1-4）。
// 【カウンター】等でアタック中のデジモンが消滅したのに、ブロックの確認やバトルに進んでいた（テティスモン → オメガモン）。
// 離れていれば true を返し、アタック終了に進める
function _attackerLeftField(atk, slotIdx) {
  const cur = bs.player.battleArea[slotIdx];
  if (cur && (cur === atk || (Array.isArray(cur.stack) && cur.stack.indexOf(atk) >= 0))) return false;
  addLog('⚔ アタック中の「' + ((atk && atk.name) || '?') + '」がバトルエリアにいないので、アタックは成立しない');
  bs._redirectedAttack = null;
  renderAll();
  checkAttackEnd(atk, slotIdx);
  return true;
}
function _evolvedAttacker(atk, slotIdx) {
  const cur = bs.player.battleArea[slotIdx];
  if (cur && cur !== atk && Array.isArray(cur.stack) && cur.stack.indexOf(atk) >= 0) return cur;
  return atk;
}

export function resolveAttackTarget(target, targetIdx) {
  if (!_atkState) { console.warn('[resolveAttackTarget] _atkState is null'); return; }
  _attackInProgress = true;
  console.log('[resolveAttackTarget]', target, targetIdx, '_atkState:', _atkState.card?.name);
  // 前回のブロック応答をクリア
  if (window._clearPendingBlock) window._clearPendingBlock();
  let atk = _atkState.card;
  const atkSlotIdx = _atkState.slotIdx;
  _atkState = null;

  // アタック対象タイプを bs に記録（cond_attack_target_digimon で参照）
  bs._lastAttackTarget = target;
  // アタック対象の具体的なインデックス（cond_attack_target_highest_dp 等で参照）
  bs._lastAttackTargetIdx = (target === 'digimon') ? targetIdx : -1;

  // チュートリアル通知: 対象選択完了
  const _isDirect = (target === 'security') && (bs.ai.battleArea || []).filter(c => c).length === 0;
  bs._lastAttackIsDirect = _isDirect;
  if (window._tutorialRunner && window._tutorialRunner.active) {
    try {
      window._tutorialRunner.notifyEvent('attack_target_selected', {
        cardNo: atk && atk.cardNo,
        cardName: atk && atk.name,
        target,
        isDirect: _isDirect,
        side: 'player',
      });
    } catch (e) {}
  }

  function _proceedAttack() {
  if (target === 'security') {
    // ★ チュートリアルAIブロック intent: セキュリティアタックでも intent あれば割り込む
    const aiBlockIntent = window._tutorialAiBlockIntent;
    console.log('[ブロック診断] security attack, intent=', aiBlockIntent, 'ai.battleArea=', (bs.ai.battleArea||[]).map(c=>c?{name:c.name,cardNo:c.cardNo,suspended:c.suspended,hasBlocker:isBlocker(c)}:null));
    if (aiBlockIntent && !_onlineMode) {
      const blockerKey = (typeof aiBlockIntent === 'string') ? aiBlockIntent : null;
      // カードNo/カード名 両方で検索 + ブロッカー条件を満たすか
      let blockerIdx = -1;
      if (blockerKey) {
        const k = String(blockerKey).trim();
        bs.ai.battleArea.forEach((c, i) => {
          if (blockerIdx >= 0 || !c || !_canBlockNow(c)) return;
          if (!isBlocker(c)) return;
          if (String(c.cardNo) === k || String(c.name) === k || String(c.name || '').includes(k)) blockerIdx = i;
        });
      }
      console.log('[ブロック診断] blockerIdx=', blockerIdx);
      if (blockerIdx >= 0) {
        window._tutorialAiBlockIntent = null;
        const blocker = bs.ai.battleArea[blockerIdx];
        addLog('🛡 [AI] 「' + blocker.name + '」でブロック！');
        blocker.suspended = true;
        try {
          if (window._tutorialRunner) {
            window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'ai' });
          }
        } catch (_) {}
        renderAll();
        // AI 側のブロッカーがレストした → プレイヤー側の when_opp_rest + AI 側の when_own_block 発火
        fireBlockReactionThen('ai', () => {
          afterAtkEffect(atk, atkSlotIdx, () => { if (_attackerLeftField(atk, atkSlotIdx)) return; atk = _evolvedAttacker(atk, atkSlotIdx);
            afterBlockedEffect(atk, atkSlotIdx, 'player', () => {
              resolveBattle(atk, atkSlotIdx, blocker, blockerIdx, 'ai');
            });
          });
        });
        return;
      }
    }
    // セキュリティアタック
    if (_onlineMode && _sendCommand) {
      // ★ アタック時効果を先に処理 → 完了後にブロック要求を送信
      // （これでターンプレイヤーが効果処理中に相手の画面にブロック確認が出ない）
      afterAtkEffect(atk, atkSlotIdx, () => { if (_attackerLeftField(atk, atkSlotIdx)) return; atk = _evolvedAttacker(atk, atkSlotIdx);
        // 突進等でセキュリティ→デジモンアタックに差し替わっていれば、そちらの経路へ
        const _rt = _consumeRedirectedAttack('security', -1);
        if (_rt.target === 'digimon') { _sendAndResolveOnlineDigimonAttack(atk, atkSlotIdx, _rt.def, _rt.idx, !!_rt.redirected); return; }
        // 効果処理完了 → このタイミングで attack_security を送る
        // 送るDPは付与中のバフから計算し直した値にする（防御側はこの値でブロックの勝敗を判定する）
        try { if (window._recalcDp) window._recalcDp(atk); } catch (_) {}
        _sendCommand({ type: 'attack_security', atkIdx: atkSlotIdx, atkName: atk.name, atkDp: atk.dp, atkBaseDp: atk.baseDp != null ? atk.baseDp : atk.dp, atkImg: cardImg(atk), atkCantBeBlocked: !!(atk._permEffects && atk._permEffects.cantBeBlocked) || _cantRedirectAttack(atk), atkCantBeBlockedByNoEvo: !!(atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo), atkCollision: _hasCollision(atk) });
        if (typeof window._waitForBlockResponse === 'function') {
          window._waitForBlockResponse((resp) => {
            if (!resp.blocked) {
              resolveSecurityCheck(atk, atkSlotIdx);
            } else {
              // ブロックされた時効果を発動 → 完了シグナル送信
              _onlineBlockedThen(atk, atkSlotIdx, () => {
                if (_onlineMode && _sendCommand) _sendCommand({ type: 'blocked_effect_done' });
                renderAll();
                _afterOnlineBlockBattle(atk, atkSlotIdx);
              });
            }
          });
        } else { resolveSecurityCheck(atk, atkSlotIdx); }
      });
    } else {
      afterAtkEffect(atk, atkSlotIdx, () => { if (_attackerLeftField(atk, atkSlotIdx)) return; atk = _evolvedAttacker(atk, atkSlotIdx);
        // 突進等でセキュリティ→デジモンアタックに差し替わっていれば、そちらの経路へ
        const _rt = _consumeRedirectedAttack('security', -1);
        if (_rt.target === 'digimon') { resolveBattle(atk, atkSlotIdx, _rt.def, _rt.idx, 'ai'); return; }
        resolveSecurityCheck(atk, atkSlotIdx);
      });
    }
  } else if (target === 'digimon') {
    // デジモンアタック
    const def = bs.ai.battleArea[targetIdx];
    if (!def) { cancelAttack(); return; }
    // アクティブ状態のデジモンには宣言できない（公式ルール）。突進は宣言時の対象拡張ではなく
    // 「宣言後、任意でDP最大のアクティブなデジモンへ対象を差し替える」効果のため、ここでの
    // 例外は無い（redirect_attack アクション経由でafterAtkEffect後に差し替わる）
    // ≪エグゼキュート≫でのアタック（_executeAttacking）は「アクティブ状態の相手のデジモンにもアタックできる」
    // （スカージキロプモン＆デスペアブラストでアクティブ状態のデジモンを選んでもアタックが始まらなかった）
    if (!def.suspended && !atk._executeAttacking) {
      addLog('🚨 アクティブ状態のデジモンにはアタックできません');
      atk.suspended = false; renderAll();
      return;
    }
    // ★ チュートリアルAIブロック intent: スクリプトで指定されたブロッカーがAIバトルエリアに
    //   いれば、afterAtkEffect → ブロック処理 に流す
    const aiBlockIntent = window._tutorialAiBlockIntent;
    if (aiBlockIntent && !_onlineMode) {
      const blockerKey = (typeof aiBlockIntent === 'string') ? aiBlockIntent : null;
      // カードNo/カード名 両方で検索 + ブロッカー条件を満たすか
      let blockerIdx = -1;
      if (blockerKey) {
        const k = String(blockerKey).trim();
        bs.ai.battleArea.forEach((c, i) => {
          if (blockerIdx >= 0 || !c || !_canBlockNow(c)) return;
          if (!isBlocker(c)) return;
          if (String(c.cardNo) === k || String(c.name) === k || String(c.name || '').includes(k)) blockerIdx = i;
        });
      }
      if (blockerIdx >= 0) {
        // intent 消費
        window._tutorialAiBlockIntent = null;
        const blocker = bs.ai.battleArea[blockerIdx];
        addLog('🛡 [AI] 「' + blocker.name + '」でブロック！');
        blocker.suspended = true;
        try {
          if (window._tutorialRunner) {
            window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'ai' });
          }
        } catch (_) {}
        renderAll();
        // AI 側のブロッカーがレストした → プレイヤー側の when_opp_rest + AI 側の when_own_block 発火
        fireBlockReactionThen('ai', () => {
          afterAtkEffect(atk, atkSlotIdx, () => { if (_attackerLeftField(atk, atkSlotIdx)) return; atk = _evolvedAttacker(atk, atkSlotIdx);
            // ブロックされた側 (player) の効果
            afterBlockedEffect(atk, atkSlotIdx, 'player', () => {
              // ブロッカー vs アタッカー のバトル解決 (def を blocker に差し替え)
              resolveBattle(atk, atkSlotIdx, blocker, blockerIdx, 'ai');
            });
          });
        });
        return;
      }
    }
    if (_onlineMode && _sendCommand) {
      // ★ アタック時効果を先に処理 → 完了後にブロック要求を送信
      afterAtkEffect(atk, atkSlotIdx, () => { if (_attackerLeftField(atk, atkSlotIdx)) return; atk = _evolvedAttacker(atk, atkSlotIdx);
        // 突進等でアタック対象が差し替わっていれば、そちらを対象にする
        const _rt = _consumeRedirectedAttack('digimon', targetIdx);
        _sendAndResolveOnlineDigimonAttack(atk, atkSlotIdx, _rt.def, _rt.idx, !!_rt.redirected);
      });
    } else {
      afterAtkEffect(atk, atkSlotIdx, () => { if (_attackerLeftField(atk, atkSlotIdx)) return; atk = _evolvedAttacker(atk, atkSlotIdx);
        const _rt = _consumeRedirectedAttack('digimon', targetIdx);
        resolveBattle(atk, atkSlotIdx, _rt.def, _rt.idx, 'ai');
      });
    }
  }
  } // _proceedAttack

  // 「進化元を持たない相手のデジモンにはブロックされない」等、アタック宣言時に
  // アナウンスしておきたい常在型能力（メタルシードラモン/イッカクモン等）。
  // アタックするたびに毎回表示する（相手の盤面状況による条件分岐は行わない）。
  if (atk && atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo) {
    const _noEvoInfo = _getNoEvoBlockImmunityInfo(atk);
    if (_hasNoAnnounceOverride(_noEvoInfo.steps)) {
      _proceedAttack();
    } else {
      _showEffectAnnounce(atk, _noEvoInfo.text, 'player', () => {
        if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_effectClose' });
        _proceedAttack();
      });
    }
  } else {
    _proceedAttack();
  }
}

// アタック時効果
// 常にスキャンする（アタッカー自身に【アタック時】が無くても、付与効果
// (ヘブンズリッパー等)や他カードの誘発を拾うため。効果が無ければ即 callback）
// カード自身の【アタック時】効果（あれば）を先に解決し、その後に突進等キーワードの
// on_attack型効果（redirect_attack等）を、カード自身の効果とは独立した確認ダイアログで
// 発動する（アタック宣言後、最終的にアタックする直前に突進が発動する、という順序）
if (typeof window !== 'undefined') window._afterAtkHoldSupported = () => true;
function afterAtkEffect(atk, atkSlotIdx, callback) {
  // 効果でアタック宣言した（「このデジモンでアタックする」）: 【アタック時】は派生誘発なので先に発揮し（公式ルール 15-4-5-2）、
  // そのあと、まだ発揮していない他の効果（同時に誘発したメインフェイズ開始時の効果等）をアタック宣言のタイミングで解決してから
  // カウンタータイミング以降に進む（11-1-4）。【アタック時】の後でアタックを止め、アタックさせた効果を完了させる
  // （bs._attackDeclHoldReady）。効果の処理が全て終わったら runPendingEffectAttack が続ける
  if (bs._attackDeclHold) {
    bs._attackDeclHold = false;
    const _ready = bs._attackDeclHoldReady; bs._attackDeclHoldReady = null;
    // 効果の処理中は割り込まない: アタック宣言（対象の決定）までで止め、アタックさせた効果の残り（デュアルカードの
    // オプション側の効果の後のアーツ進化〜【進化時】等）を全て処理してから、【アタック時】・「アタックしたとき」
    // （派生誘発）を発揮してアタックを続ける（シリウスモン＆プラネイトナックル EX12-018 のオプション側で、アタック対象を
    // 選んだ直後に天ノ河宙 EX12-066 の「アタックしたとき」が割り込んでいた）
    // 【アタック時】は、アタックさせた効果の処理が終わった時点で（それ以前からの発揮待ちより先に）発揮する（effect-engine.js
    // _runHeldAttackDerived）。アタックの続き（カウンタータイミング以降）は、発揮待ちが全て解決してから（runPendingEffectAttack）
    const _owner = bs._attackDeclOwner; bs._attackDeclOwner = null;
    let _p1State = 0; let _p1Waiters = [];
    const _phase1 = (done) => {
      if (_p1State === 2) { done && done(); return; }
      if (done) _p1Waiters.push(done);
      if (_p1State === 1) return;
      _p1State = 1;
      _afterAtkEffectBody(_evolvedAttacker(atk, atkSlotIdx) || atk, atkSlotIdx, () => {
        _p1State = 2;
        const ws = _p1Waiters; _p1Waiters = [];
        ws.forEach((w) => { try { w(); } catch (e) { console.error('[heldAttackDerived]', e); } });
      });
    };
    if (!Array.isArray(window._heldAttackDerived)) window._heldAttackDerived = [];
    window._heldAttackDerived.push({ owner: _owner, run: _phase1 });
    _holdAfterAttackEffects(atk, () => {
      // 派生誘発として発揮されないまま続けることになった（保険）なら、ここで発揮してから続ける
      const _i = window._heldAttackDerived.findIndex(r => r && r.run === _phase1);
      if (_i !== -1) window._heldAttackDerived.splice(_i, 1);
      _phase1(callback);
    }, _ready);
    return;
  }
  _afterAtkEffectBody(atk, atkSlotIdx, callback);
}
// 【アタック時】まで解決したアタックを止め、アタックさせた効果を完了させる（ready）。効果の処理が全て終わったら続ける（cont）
// ブロックできる状態か（ブロックはデジモンをレストさせて行うので、「レストできない」デジモンはブロックできない。
// 「ブロックできない」も含む）
function _canBlockNow(c) {
  if (!c || c.suspended || c.cantBlock || c.cantRest) return false;
  if (Array.isArray(c.buffs) && c.buffs.some(b => b && (b.type === 'cant_rest' || b.type === 'cant_block' || b.type === 'cant_attack_block'))) return false;
  return true;
}
function _holdAfterAttackEffects(atk, cont, ready) {
  {
    if (!Array.isArray(bs._heldAttackResumes)) bs._heldAttackResumes = [];
    const _resume = () => cont();
    bs._heldAttackResumes.push(_resume);
    // 保険: 続ける呼び出しが無い経路でも止まったままにならないよう、効果の処理が無い状態が少し続いたら続ける
    let _idleSince = 0;
    const _watch = () => {
      if (!Array.isArray(bs._heldAttackResumes) || !bs._heldAttackResumes.includes(_resume)) return;
      // 発揮待ちの順番を選んでいる間（効果のキューに発揮待ちが残っている等）も処理中として待つ
      const busy = !!(window._heldAttackBusy && window._heldAttackBusy());
      if (busy) { _idleSince = 0; setTimeout(_watch, 300); return; }
      if (!_idleSince) _idleSince = Date.now();
      if (Date.now() - _idleSince < 800) { setTimeout(_watch, 200); return; }
      // 続ける処理は runPendingEffectAttack に任せる（非ターンプレイヤー側の発揮待ちを先に解決する）
      const k = bs._heldAttackResumes.indexOf(_resume);
      if (k !== -1) {
        if (k > 0) { bs._heldAttackResumes.splice(k, 1); bs._heldAttackResumes.unshift(_resume); }
        if (typeof window._runPendingEffectAttack === 'function') window._runPendingEffectAttack(bs, () => {});
        else { bs._heldAttackResumes.shift(); _resume(); }
      }
    };
    setTimeout(_watch, 500);
    addLog('⏳ アタック宣言のタイミング: 発揮待ちの効果を解決してから「' + atk.name + '」のアタックを続けます');
    if (typeof ready === 'function') ready();
  }
}
function _afterAtkEffectBody(atk, atkSlotIdx, callback) {
  _hooks.checkAndTriggerEffect(atk, '【アタック時】', () => {
    // subject:"both"（お互いのターンでアタック時発動）の進化元効果を相手側で反応させる
    _hooks.fireOnAttackBothSubjectTriggers('player', () => {
      // subject:"opp"（相手のデジモンがアタックしたとき）の進化元効果を相手側で反応させる
      _hooks.fireOnAttackOppSubjectTriggers('player', () => {
        const ctxBase = { bs, addLog, renderAll, updateMemGauge };
        try { _fireKeywordAttackEffects(atk, 'player', bs, ctxBase, callback); }
        catch (_) { callback(); }
      });
    });
  });
}

// ブロックされた時効果
function afterBlockedEffect(atk, atkSlotIdx, side, callback) {
  if (!atk) { callback(); return; }
  const blockedRegex = /ブロックされた時|【ブロックされたとき】|ブロックされたとき/;
  const hasInMain = atk.effect && blockedRegex.test(atk.effect);
  const hasInEvo = atk.stack && atk.stack.some(s => s.evoSourceEffect && blockedRegex.test(s.evoSourceEffect));
  if (!hasInMain && !hasInEvo) { callback(); return; }
  addLog('⚡ 「' + atk.name + '」のブロックされた時効果！');
  const context = _hooks.makeEffectContext(atk, side || 'player');
  _hooks.triggerEffect('when_blocked', atk, side || 'player', context, callback);
}

// アタック終了時効果
// ≪貫通≫のセキュリティチェック(resolveSecurityCheck)は完了コールバックを持たず、
// 内部の全終了経路が最終的にここへ到達する。バトル勝利から同時誘発した効果
// （ターンプレイヤー側: on_battle_win等 → 非ターンプレイヤー側: defの消滅時チェーン）
// の解決を、≪貫通≫のセキュリティ効果解決が終わるまで遅らせたい場合、ここに積んで
// おく（公式ルール15-4-3-5: 同時誘発はターンプレイヤー側を全て解決してから非ターン
// プレイヤー側に進む）。通常のアタックでは未設定なので挙動は変わらない。
//
// bs._pendingNonTurnPlayerBattleTrigger は、貫通のセキュリティ効果解決中に新たに
// 誘発した非ターンプレイヤー側効果（例: セキュリティで登場したテイマーの登場時効果）
// が合流できるよう、effect-engine.js 側からも直接参照・上書きされる
// （公式ルール15-4-3-3: ルールチェックで誘発した効果は、その時点で誘発していた
// 効果と同時誘発になる）。
// ≪貫通≫等でターンプレイヤー側/非ターンプレイヤー側の同時誘発を保留するときに
// このペアで登録する。オンライン対戦では、非ターンプレイヤー側（相手機）にも
// 「まだ発動しないで」と信号で伝える（相手機のセキュリティ効果解決で誘発する登場時
// 等は相手機ローカルの処理のため、こちらのbs._pendingNonTurnPlayerBattleTriggerを
// 直接参照できない）
function _setPendingBattleTriggers(turnPlayerHook, nonTurnPlayerHook) {
  bs._pendingTurnPlayerBattleTrigger = turnPlayerHook;
  bs._pendingNonTurnPlayerBattleTrigger = nonTurnPlayerHook;
  if (_onlineMode && _sendCommand) {
    _sendCommand({ type: 'fx_deferOppNonTurnPlayerTriggers', active: true });
  }
}

function _consumePendingBattleTriggers(finalCallback) {
  if (bs._pendingTurnPlayerBattleTrigger) {
    const pending = bs._pendingTurnPlayerBattleTrigger;
    bs._pendingTurnPlayerBattleTrigger = null;
    pending(() => _consumePendingBattleTriggers(finalCallback));
    return;
  }
  if (bs._pendingNonTurnPlayerBattleTrigger) {
    // ターンプレイヤー側が全て解決した → 相手機（非ターンプレイヤー側）に保留解除を伝える
    if (_onlineMode && _sendCommand) {
      _sendCommand({ type: 'fx_deferOppNonTurnPlayerTriggers', active: false });
    }
    const pending = bs._pendingNonTurnPlayerBattleTrigger;
    bs._pendingNonTurnPlayerBattleTrigger = null;
    pending(() => _consumePendingBattleTriggers(finalCallback));
    return;
  }
  // バトルの解決中に後回しにした非ターンプレイヤー側の効果（効果でDP0になった相手のデジモンの消滅時効果等）
  if (typeof window !== 'undefined' && window._hasNonTurnDeferred && window._hasNonTurnDeferred()) {
    window._flushNonTurnDeferred(finalCallback);
    return;
  }
  finalCallback();
}

// ≪貫通≫のセキュリティチェック（効果のキューの1件として実行。effect-engine.js の penetrate_check）。
// resolveSecurityCheck は完了コールバックを持たないので、最終的に到達する checkAttackEnd / checkPendingTurnEnd で
// bs._penetrateResume を呼んでキューの残り（同時誘発した他の「バトルに勝ったとき」等）に戻る
if (typeof window !== 'undefined') {
  window._runPenetrateCheck = (atk, done) => {
    const atkIdx = atk ? bs.player.battleArea.indexOf(atk) : -1;
    if (atkIdx === -1) { done && done(); return; }
    addLog('🗡 「' + atk.name + '」の【貫通】効果でセキュリティチェック！');
    bs._penetrateResume = done;
    showPenetrateAnnounce(() => { resolveSecurityCheck(atk, atkIdx); });
  };
}
function _resumeAfterPenetrate() {
  if (!bs._penetrateResume) return false;
  const r = bs._penetrateResume;
  bs._penetrateResume = null;
  hideCombatBackdrop();
  renderAll();
  r();
  return true;
}
function checkAttackEnd(atk, atkIdx) {
  if (_resumeAfterPenetrate()) return;
  _consumePendingBattleTriggers(() => {
    // 【アタック終了時】は、アタックしたデジモンが場に残っていれば必ず誘発を確かめる（効果の文の【アタック終了時】だけで判定していたため、
    // キーワード（≪エグゼキュート≫の「アタック終了時、このデジモンを消滅させる」）や与えられた効果の分を見落としていた）。
    // 誘発するものが無ければ何もせずに終わる
    // アタック中に進化していれば、進化後のカード（同じデジモン）で確かめる
    const _cur = _evolvedAttacker(atk, atkIdx);
    if (_cur && bs.player.battleArea[atkIdx] === _cur) {
      if (_cur !== atk && atk && atk._executeAttacking) _cur._executeAttacking = true;
      _hooks.checkAndTriggerEffect(_cur, '【アタック終了時】', () => checkPendingTurnEnd());
    } else { checkPendingTurnEnd(); }
  });
}

// ===== セキュリティチェック =====

// セキュリティチェック・バトルの解決（ルールの処理）に入った: この間は DP0 の消滅（ルールチェック）を保留する（公式ルール 17-1-2-1）。
// アタックの終了で解除して、保留したルールチェックを行う。オンラインでは相手の端末にも知らせる
function _beginAttackResolution() {
  if (bs._attackResolving) return;
  bs._attackResolving = true;
  if (_onlineMode && _sendCommand) { try { _sendCommand({ type: 'rule_proc_start' }); } catch (_) {} }
}
if (typeof window !== 'undefined') window._beginAttackResolution = _beginAttackResolution;
export function resolveSecurityCheck(atk, atkIdx) {
  _beginAttackResolution();
  showCombatBackdrop();
  const totalChecks = getSecurityAttackCount(atk);
  let checksRemaining = totalChecks;
  let checkNumber = 0;
  if (totalChecks > 1) addLog('⚔ セキュリティチェック x' + totalChecks + '！');
  if (totalChecks === 0) addLog('🛡 「' + atk.name + '」のセキュリティチェック数が0のため、セキュリティをチェックしません');

  function startChecks() {
    if (totalChecks === 0) {
      // SA- で0回チェック → セキュリティを1枚も捲らずアタック終了。理由を両方の画面に出す
      const _msg = _saMinusLabel(atk) + 'のため、セキュリティチェックできません';
      if (_onlineMode && _sendCommand) { try { _sendCommand({ type: 'fx_battleResult', text: 'チェックなし', color: '#3399ff', sub: _msg }); } catch (_) {} }
      showBattleResult('チェックなし', '#3399ff', _msg, () => { hideCombatBackdrop(); checkAttackEnd(atk, atkIdx); });
      return;
    }
    if (bs.ai.security.length > 0) {
      doNextCheck();
    } else {
      // ダイレクトアタック (= 相手セキュリティ0枚の相手にアタックして貫通)
      //   battleVictory() は checkPendingTurnEnd を呼ばないので、通知とフラッシュを
      //   ここで明示的に行い、流れを:
      //     吹き出し消去 → 成功演出 → ダイレクトアタック演出 → 勝利演出 → クリア演出
      //   にする。
      // クリアモーダルを勝利演出より先に出させないためのフラグ
      bs._tutorialExpectVictory = true;
      const _runDirect = () => showDirectAttack(atk, 'player', () => { battleVictory(); });
      if (window._tutorialRunner && window._tutorialRunner.active) {
        try {
          window._tutorialRunner.notifyEvent('attack_declared', {
            cardNo: atk.cardNo, cardName: atk.name,
            target: 'security', isDirect: true, side: 'player',
          });
          window._tutorialRunner.notifyEvent('attack_resolved', {
            side: 'player', isDirect: true,
          });
        } catch (_) {}
        // 成功演出フラッシュ (ANIMATED 条件だが checkPendingTurnEnd 経由しないのでここで flush)
        if (typeof window._tutorialFlushSuccess === 'function') {
          try { window._tutorialFlushSuccess(); } catch (_) {}
        }
        // 成功演出が出終わるのを待ってから次へ
        if (typeof window._tutorialAwaitSuccess === 'function') {
          window._tutorialAwaitSuccess().then(() => {
            if (typeof window._tutorialBattleDone === 'function') {
              try { window._tutorialBattleDone(); } catch (_) {}
            }
            _runDirect();
          });
          return;
        }
      }
      _runDirect();
    }
  }

  if (totalChecks > 1) {
    showSAttackPlusAnnounce(totalChecks - 1, () => startChecks());
  } else {
    startChecks();
  }

  function doNextCheck() {
    checksRemaining--;
    checkNumber++;
    // アタック中に進化した場合、進化後のカードが新しいアタッカー。
    // battleArea[atkIdx] が atk の進化先（stack に atk を含む）ならアタッカーを
    // 引き継ぎ、アタックを最後まで継続する。
    const _curAtk = bs.player.battleArea[atkIdx];
    if (_curAtk && _curAtk !== atk && Array.isArray(_curAtk.stack) && _curAtk.stack.indexOf(atk) >= 0) {
      addLog('⬆ アタッカー「' + atk.name + '」が「' + _curAtk.name + '」に進化（アタック継続）');
      atk = _curAtk;
    }
    // アタッカーが場を離れた / 退化等で別カードに置換された → アタック終了
    if (!bs.player.battleArea[atkIdx] || bs.player.battleArea[atkIdx] !== atk) {
      addLog('⚔ アタッカーが場を離れたためセキュリティチェックを終了');
      checkAttackEnd(atk, atkIdx);
      return;
    }
    // Sアタック+ を動的に再評価（退化や効果無効化で +1 が消えた場合は早期終了）
    const currentTotal = getSecurityAttackCount(atk);
    if (checkNumber > currentTotal) {
      addLog('⚔ Sアタック+効果が失われたためセキュリティチェック終了');
      checkAttackEnd(atk, atkIdx);
      return;
    }
    if (bs.ai.security.length <= 0) {
      addLog('🛡 相手のセキュリティが0枚になった');
      checkAttackEnd(atk, atkIdx);
      return;
    }

    const sec = bs.ai.security.splice(0, 1)[0];
    console.log('[SEC CHECK] めくったカード:', sec.name, 'type:', sec.type, 'dp:', sec.dp);
    // security_removeはテイマー以外で送信（テイマーはsecurity_tamer_playで処理）
    if (_onlineMode && _sendCommand && sec.type !== 'テイマー') {
      _sendCommand({ type: 'security_remove', secName: sec.name, secType: sec.type, remaining: bs.ai.security.length });
    }
    // チュートリアル通知: 相手側セキュリティが削れた
    if (typeof window !== 'undefined' && window._tutorialRunner && window._tutorialRunner.active) {
      try { window._tutorialRunner.notifyEvent('security_reduced', { side: 'opponent', count: 1, remaining: bs.ai.security.length }); } catch (e) {}
    }
    applySecurityBuffs(sec, 'ai');
    // 「セキュリティが減ったとき」は、チェック（セキュリティの公開）のあと、セキュリティ効果・バトルの前に解決する
    // （総合ルール13-1-8。以前はめくる演出より前に発動していた）。showSecurityCheck の完了時に呼ぶ
    doNextCheckAfterSecurityDecrease();
    return;

    function doNextCheckAfterSecurityDecrease() {

    // Sアタック+のチェック枚数ラベル表示
    if (totalChecks > 1) {
      const labelText = checkNumber + '枚目';
      if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_secCheckLabel', text: labelText });
      const old = document.getElementById('_sec-check-count-label');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      const el = document.createElement('div');
      el.id = '_sec-check-count-label';
      // チュートリアル中は自動フェードアウトせず、次のラベル or VS画面クローズまで表示を維持
      const tutorialActive = !!(window._tutorialRunner && window._tutorialRunner.active);
      const animCss = tutorialActive ? '' : 'animation:secCheckLabel 2.5s ease forwards;';
      el.style.cssText = 'position:fixed;top:10%;left:50%;transform:translateX(-50%);z-index:60001;pointer-events:none;font-size:clamp(0.9rem,4vw,1.3rem);font-weight:700;color:#fff;background:rgba(0,0,0,0.7);padding:6px 18px;border-radius:8px;border:1px solid #aaa;text-align:center;' + animCss;
      el.innerText = labelText;
      document.body.appendChild(el);
      if (!tutorialActive) {
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
      }
    }

    showSecurityCheck(sec, atk, () => fireSecurityDecreaseThen('ai', () => _secDigimonEffectFirst(sec, () => {
      // ----- セキュリティがデジモン -----
      if (_isSecurityDigimonCard(sec)) {
        // 引き分け（DPが同じ）は両方とも負け（公式ルール 14-2-1-3）。セキュリティデジモンは負けても消滅しないので、
        // 負けたときと同じ処理（≪ジャミング≫・≪防壁≫等の「消滅しない」の確認）を通す（以前は確認せずに消滅していた）
        const _secTie = atk.dp === sec.dp;
        if (atk.dp > sec.dp) {
          bs.ai.trash.push(sec); renderAll(); _dispatchStateSync();
          showBattleResult('Win!!', '#00ff88', 'セキュリティ突破！', () => {
            showDestroyEffect(sec, () => {
              addLog('✓ セキュリティ突破');
              // セキュリティデジモンとのバトルに勝った →「バトルに勝ったとき」（on_win_battle_any）
              _fireSecurityBattleWin(atk, 'player', sec, () => {
              if (bs.ai.security.length <= 0) {
                addLog('🛡 相手のセキュリティが0枚になった');
                checkAttackEnd(atk, atkIdx);
              } else if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
              else { checkAttackEnd(atk, atkIdx); }
              });
            });
          }, 'Lose...', '#ff4444');
        } else {
          // ≪ジャミング≫: セキュリティデジモンとのバトル敗北時、消滅しない
          if (hasJamming(atk)) {
            bs.ai.trash.push(sec);
            renderAll(); _dispatchStateSync();
            addLog('🛡 【ジャミング】「' + atk.name + '」がセキュリティバトルで消滅回避');
            showBattleResult('ジャミング！', '#00fbff', '「' + atk.name + '」が消滅を回避', () => {
              showDestroyEffect(sec, () => {
                if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
                else { checkAttackEnd(atk, atkIdx); }
              });
            }, 'ジャミング！', '#00fbff');
            return;
          }
          // ≪防壁≫: セキュリティバトル消滅時、自分のセキュリティ1枚破棄で回避
          // ≪回避≫/≪アーマー解除≫/【分離】もここで判定
          _tryCancelDestroyAsync(atk, bs.player, 'player', false, (cancelAtkInSec) => {
          if (cancelAtkInSec) {
            bs.ai.trash.push(sec);
            renderAll(); _dispatchStateSync();
            showBattleResult('回避！', '#00fbff', '「' + atk.name + '」が消滅を回避', () => {
              showDestroyEffect(sec, () => {
                if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
                else { checkAttackEnd(atk, atkIdx); }
              });
            }, '回避！', '#00fbff');
            return;
          }
          removeOwnCard(atkIdx, 'destroy');
          bs.ai.trash.push(sec);
          renderAll(); _dispatchStateSync();
          showBattleResult(_secTie ? '両者消滅' : 'Lost...', '#ff4444', _secTie ? '両者消滅！' : '「' + atk.name + '」が撃破された', () => {
            showDestroyEffect(atk, () => {
              addLog('✗ セキュリティに敗北'); _dispatchStateSync();
              try {
                _fireDestroyChain(['player'], () => checkPendingTurnEnd(), { player: atk });
              } catch(_) { checkPendingTurnEnd(); }
            });
          }, 'Win!!', '#00ff88');
          });
        }
        return;
      }
      // ----- セキュリティがテイマー -----
      if (sec.type === 'テイマー') {
        bs.ai.tamerArea.push(sec);
        addLog('👤 テイマー「' + sec.name + '」が相手に登場');
        // 相手に「自分のテイマーエリアにカードを追加して」と通知
        if (_onlineMode && _sendCommand) {
          _sendCommand({ type: 'security_tamer_play', cardName: sec.name, cardNo: sec.cardNo || '', cardImg: cardImg(sec), effect: sec.effect || '', securityEffect: sec.securityEffect || '', dp: sec.dp || 0, level: sec.level || '', color: sec.color || '', feature: sec.feature || '', imgSrc: sec.imgSrc || '', cost: sec.cost || 0, playCost: sec.playCost || 0 });
        }
        renderAll();
        const _afterSecTamer = () => {
          if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
          else { checkAttackEnd(atk, atkIdx); }
        };
        // セキュリティから登場したテイマーの【登場時】効果を発動（高石タケル等）。
        // オンラインでは「カード所有者(相手)」の機械で発動させる必要があるため
        // ここでは発動せず、security_tamer_play 受信側(所有者)で発動する。
        // （攻撃側で発動するとセキュリティ中身が攻撃側に見えてしまう）
        const _secTamerHasOnPlay = hasKeyword(sec, '【登場時】') || _hasRecipeTrigger(sec, 'on_play');
        if (!_onlineMode && _secTamerHasOnPlay) {
          const fireSecTamerOnPlay = (doneCb) => {
            _hooks.checkAndTriggerEffect(sec, '【登場時】', () => { renderAll(); doneCb && doneCb(); }, 'ai');
          };
          // ≪貫通≫等でまだターンプレイヤー側の同時誘発効果(on_battle_win等)が解決
          // していない場合は、この登場時効果をそちらが終わった後に合流させる
          // （公式ルール15-4-3-3。オンライン版のsecurity_tamer_playハンドラと同じ仕組み）
          if (bs._pendingNonTurnPlayerBattleTrigger) {
            const existingNonTurnPlayerPhase = bs._pendingNonTurnPlayerBattleTrigger;
            bs._pendingNonTurnPlayerBattleTrigger = (proceed) => { fireSecTamerOnPlay(() => existingNonTurnPlayerPhase(proceed)); };
            _afterSecTamer();
          } else {
            fireSecTamerOnPlay(_afterSecTamer);
          }
        } else if (_onlineMode && _secTamerHasOnPlay && checksRemaining > 0 && typeof window._waitForSecurityEffect === 'function') {
          // 相手(所有者)機でテイマーの【登場時】効果が解決するまで、2枚目以降のセキュリティ
          // チェックに進まず待機する（security_tamer_play受信側からのsecurity_effect_done待ち）。
          // ただしこれは「次のチェックがある場合」のみ必要。このチェックが最後（checksRemaining
          // <= 0）でcheckAttackEndに進む場合は待たない：≪貫通≫等でbs._deferNonTurnPlayerTriggers
          // が立っている（=まだターンプレイヤー側の同時誘発が解決していない）と、相手機の
          // テイマー効果はそのフラグが解除されるまで発揮されない。一方こちらがここで相手の
          // 効果完了を待ってしまうと、そのフラグ解除自体（checkAttackEnd経由）を待っている
          // ことになり、お互いが相手を待ち続ける相互デッドロックになってしまう。
          addLog('⏳ 相手がテイマーの効果を処理中...');
          window._waitForSecurityEffect(() => {
            _dispatchStateSync();
            _afterSecTamer();
          });
        } else {
          _afterSecTamer();
        }
        return;
      }
      // ----- セキュリティがオプション等 -----
      addLog('✦ セキュリティ効果：「' + sec.name + '」');
      if (window._tutorialRunner && window._tutorialRunner.active) {
        try { window._tutorialRunner.notifyEvent('security_effect', { cardNo: sec.cardNo, cardName: sec.name, side: 'opponent' }); } catch (e) {}
      }
      const hasSecField = sec.securityEffect && sec.securityEffect.trim() && sec.securityEffect !== 'なし';
      const hasSecInEffect = _hasRecipeTrigger(sec, 'security');
      setTimeout(() => {
        if (hasSecField || hasSecInEffect) {
          const doFinishSec = () => {
            // ヘブンズゲート/ヘブンズチャーム等: セキュリティ効果で「このカードを手札に加える」
            // - オフライン: 直接 sec._returnToHand に立つ
            // - オンライン: 防御側 (P2) で立つ → security_effect_done で
            //   window._lastSecEffectReturnToHand に伝達される
            const onlineRTH = window._lastSecEffectReturnToHand === true;
            window._lastSecEffectReturnToHand = false;
            if (sec._returnToHand || onlineRTH) {
              delete sec._returnToHand;
              bs.ai.hand.push(sec);
              addLog('🃏 相手は「' + sec.name + '」を手札に加えた');
            } else if (!_isCardInAnyZone(sec, bs.ai)) {
              // 【メイン】効果の発揮でバトルエリア等に置かれた（place_in_battle_area 等）ならトラッシュへ送らない
              bs.ai.trash.push(sec);
            }
            renderAll(); _dispatchStateSync();
            if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
            else { checkAttackEnd(atk, atkIdx); }
          };

          // ≪オプションのセキュリティ効果無効化≫（ウォーグレイモン等）:
          // アタッカーがこの効果を持ち、めくったカードがオプションなら
          // セキュリティ効果を発揮させずトラッシュへ。★オンライン分岐より前に判定する
          // （オンライン時は下の return で素通りしてしまうため）。
          // _permEffects 優先・未評価でも recipe.passive を直接スキャンしてフォールバック。
          const _atkSuppressOptSE = !!(atk && (
            (atk._permEffects && atk._permEffects.suppressOptSecurityEffect) ||
            (function () {
              try {
                const r = typeof atk.recipe === 'string'
                  ? JSON.parse(atk.recipe.replace(/[\x00-\x1F\x7F]\s*/g, ''))
                  : atk.recipe;
                const ps = r && r.passive;
                return Array.isArray(ps) && ps.some(function (p) {
                  return p && (p.flag === 'suppress_opt_security_effect' || p.flag === 'security_effect');
                });
              } catch (_) { return false; }
            })()
          ));
          if (_atkSuppressOptSE && sec.type === 'オプション') {
            addLog('🚫 ≪オプションSE無効化≫:「' + sec.name + '」のセキュリティ効果は発揮しない');
            // オンライン: P2 のセキュリティカードは既に security_remove で除去済。
            // security_effect_request を送らない＝P2 側も効果が走らない。
            bs.ai.trash.push(sec);
            renderAll();
            // VS画面の上に効果説明ポップアップ風のアナウンスを表示
            const _seOv = document.createElement('div');
            _seOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:60000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
            const _seBox = document.createElement('div');
            _seBox.style.cssText = 'max-width:85%;padding:20px;background:rgba(10,0,20,0.96);border:2px solid #9933ff;border-radius:12px;box-shadow:0 0 30px #9933ff66;text-align:center;';
            _seBox.innerHTML =
              '<div style="color:#c77dff;font-size:14px;font-weight:bold;margin-bottom:10px;text-shadow:0 0 8px #9933ff;">⚡ ' + atk.name + ' — 効果発動</div>'
              + '<div style="color:#eee;font-size:12px;line-height:1.7;">チェックしたオプションカード「' + sec.name + '」の<br>【セキュリティ】効果は発揮しない</div>';
            _seOv.appendChild(_seBox);
            document.body.appendChild(_seOv);
            setTimeout(() => {
              _seOv.style.animation = 'fadeOut 0.3s ease forwards';
              setTimeout(() => {
                if (_seOv.parentNode) _seOv.parentNode.removeChild(_seOv);
                hideCombatBackdrop();
                if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
                else { checkAttackEnd(atk, atkIdx); }
              }, 300);
            }, 2200);
            return;
          }

          // オンライン時: セキュリティ効果を防御側（P2）に委譲
          if (_onlineMode && _sendCommand && typeof window._waitForSecurityEffect === 'function') {
            hideCombatBackdrop();
            _sendCommand({
              type: 'security_effect_request',
              cardName: sec.name, cardNo: sec.cardNo || '', cardType: sec.type || '',
              effect: sec.effect || '', securityEffect: sec.securityEffect || '',
              recipe: typeof sec.recipe === 'object' ? JSON.stringify(sec.recipe) : (sec.recipe || ''),
              cardImg: cardImg(sec), dp: sec.dp || 0, level: sec.level || '',
              color: sec.color || '', feature: sec.feature || '',
              cost: sec.cost || 0, playCost: sec.playCost || 0,
            });
            addLog('⏳ 相手がセキュリティ効果を処理中...');
            window._waitForSecurityEffect(() => {
              // P2の処理完了 → 状態を再同期して続行
              _dispatchStateSync();
              doFinishSec();
            });
            return;
          }

          // オフライン時: ローカルで処理
          const secText = hasSecField ? sec.securityEffect : sec.effect;
          const originalEffect = sec.effect || '';
          if (hasSecField) {
            const secBlock = secText.includes('【セキュリティ】') ? secText : '【セキュリティ】' + secText;
            sec.effect = originalEffect + (originalEffect ? '\n' : '') + secBlock;
          }
          const afterSecEffect = () => {
            const mentionsMainEffect = /このカードの\s*【メイン】\s*効果/.test(secText);
            const finish = () => { sec.effect = originalEffect; doFinishSec(); };
            // recipe は文字列(JSON)とオブジェクト両方ありうる。security レシピに
            // use_main_effect が含まれていれば既に main が実行されているので二重発動防止。
            let hasRecipe = false;
            if (sec.recipe) {
              if (typeof sec.recipe === 'string') {
                hasRecipe = sec.recipe.includes('use_main_effect');
              } else if (typeof sec.recipe === 'object' && Array.isArray(sec.recipe.security)) {
                hasRecipe = sec.recipe.security.some(s => s && s.action === 'use_main_effect');
              }
            }
            if (mentionsMainEffect && originalEffect.includes('【メイン】') && !hasRecipe) {
              sec.effect = originalEffect;
              _hooks.checkAndTriggerEffect(sec, '【メイン】', finish, 'ai');
            } else { finish(); }
          };
          hideCombatBackdrop();
          _hooks.checkAndTriggerEffect(sec, '【セキュリティ】', afterSecEffect, 'ai');
        } else {
          bs.ai.trash.push(sec); renderAll();
          if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
          else { checkAttackEnd(atk, atkIdx); }
        }
      }, 500);
    })));
    }
  }
}
// 貫通効果のオンライン処理用: ブロック解決(防御側)から攻撃側へ追加セキュリティチェックを依頼するため公開
if (typeof window !== 'undefined') window._resolveSecurityCheck = resolveSecurityCheck;

// チェックしたセキュリティがデジモンで【セキュリティ】効果を持つなら、セキュリティデジモンとのバトルの前に発揮する
// （公式ルール 13-1-8-2: チェックによって誘発した効果を解決してから 13-1-8-3 のバトルへ）。オンラインは持ち主（防御側）の端末で
// 発揮してもらう（security_effect_request）。以前はセキュリティデジモンの【セキュリティ】効果を発揮せずにバトルしていた
// （スカージキロプモン＆デスペアブラスト BT26-075）
// ownerSide: セキュリティの持ち主（プレイヤーのアタック＝'ai' / CPU のアタック＝'player'）
// セキュリティからチェックされたカードがセキュリティデジモン（バトルする）か。デュアルカードもデジモンカードなので
// セキュリティデジモンとして扱う（総合ルール 13-1-7 / 4-5-1。ベアキャットモン＆ペネトレイトブロウ BT26-057 がめくれても
// バトルをせず、エグゼキュートでアタックしたパンプモンが負けず≪防壁≫も出なかった）
function _isSecurityDigimonCard(c) {
  const t = String((c && c.type) || '');
  return t === 'デジモン' || t === 'デュアル';
}
function _secDigimonEffectFirst(sec, cont, ownerSide) {
  ownerSide = ownerSide || 'ai';
  let has = false;
  try { has = !!(sec && _isSecurityDigimonCard(sec) && _hasRecipeTrigger(sec, 'security')); } catch (_) { has = false; }
  if (!has) { cont(); return; }
  addLog('✦ セキュリティ効果：「' + sec.name + '」（バトルの前に発揮）');
  if (ownerSide === 'ai' && _onlineMode && _sendCommand && typeof window._waitForSecurityEffect === 'function') {
    _sendCommand({
      type: 'security_effect_request',
      cardName: sec.name, cardNo: sec.cardNo || '', cardType: sec.type || '',
      effect: sec.effect || '', securityEffect: sec.securityEffect || '',
      recipe: typeof sec.recipe === 'object' ? JSON.stringify(sec.recipe) : (sec.recipe || ''),
      cardImg: cardImg(sec), dp: sec.dp || 0, level: sec.level || '',
      color: sec.color || '', feature: sec.feature || '',
      cost: sec.cost || 0, playCost: sec.playCost || 0,
    });
    addLog('⏳ 相手がセキュリティ効果を処理中...');
    window._waitForSecurityEffect(() => { _dispatchStateSync(); renderAll(); cont(); });
    return;
  }
  try { _hooks.checkAndTriggerEffect(sec, '【セキュリティ】', () => { renderAll(); cont(); }, ownerSide); }
  catch (e) { console.error('[secDigimonEffectFirst]', e); cont(); }
}
// 「Sアタック-N」の表示（チェック数が0になった理由）。N は Sアタック- の合計
function _saMinusLabel(card) {
  let n = 0;
  if (card && card._permEffects && card._permEffects.securityAttackMinus) n += parseInt(card._permEffects.securityAttackMinus, 10) || 0;
  ((card && card.buffs) || []).forEach(b => { if (b && b.type === 'security_attack_minus') n += parseInt(b.value, 10) || 0; });
  return 'Sアタック-' + (n || 1);
}
// Sアタック+計算
function getSecurityAttackCount(card) {
  let extra = 0;
  const side = bs.isPlayerTurn ? 'player' : 'ai';
  _hooks.applyPermanentEffects('player');
  _hooks.applyPermanentEffects('ai');

  // レシピベースの_permEffectsのみ使用
  let permPlus = 0, permMinus = 0, buffPlus = 0, buffMinus = 0;
  if (card._permEffects && card._permEffects.securityAttackPlus) {
    permPlus = card._permEffects.securityAttackPlus;
    extra += permPlus;
  }
  // Sアタック- は permEffects 経由でも減算
  if (card._permEffects && card._permEffects.securityAttackMinus) {
    permMinus = card._permEffects.securityAttackMinus;
    extra -= permMinus;
  }
  if (card.buffs && card.buffs.length > 0) {
    card.buffs.forEach(b => {
      if (b.type === 'security_attack_plus') { buffPlus += (parseInt(b.value) || 0); extra += (parseInt(b.value) || 0); }
      if (b.type === 'security_attack_minus') { buffMinus += (parseInt(b.value) || 0); extra -= (parseInt(b.value) || 0); }
    });
  }
  const result = Math.max(0, 1 + extra);
  console.log('[getSecurityAttackCount]', card.name, 'permSA+=' + permPlus, 'buffSA+=' + buffPlus, 'buffSA-=' + buffMinus, 'extra=' + extra, '→ checks=' + result);
  // SA- で0以下になる可能性あり（その場合セキュリティチェック0回）
  return result;
}

// ===== DP表示フォーマッタ =====
// バトル内のDP表示を「元値+バフ」形式で統一
// 例: バフなし → "7000", DP+1000 → "7000+1000", DP-2000 → "7000-2000"
// 元値の優先順: _origDp(セキュリティバフ用) > baseDp(永続/バトル中バフ用) > 現在値
export function formatDpDisplay(card) {
  if (!card) return '0';
  const cur = parseInt(card.dp) || 0;
  const baseRaw = (card._origDp != null) ? card._origDp : (card.baseDp != null ? card.baseDp : cur);
  const base = parseInt(baseRaw) || 0;
  const mod = cur - base;
  if (mod === 0) return String(cur);
  if (mod > 0) return base + '+' + mod;
  return base + '' + mod; // modが負の場合は自動的に "5000-2000" となる
}

// セキュリティバフ適用
function applySecurityBuffs(sec, ownerSide) {
  const buffs = bs._securityBuffs;
  if (!buffs || buffs.length === 0 || !_isSecurityDigimonCard(sec)) return;
  if (sec._origDp === undefined) sec._origDp = parseInt(sec.dp) || 0;
  let bonus = 0;
  buffs.forEach(b => {
    // どちらのセキュリティに効くか: secSide（相手のセキュリティへのバフ。ヴァイクモン LM-040）、無ければ付与本人(owner)
    const _tgtSide = b.secSide || b.owner;
    if (_tgtSide && _tgtSide !== ownerSide) return;
    if (b.type === 'dp_plus') bonus += (parseInt(b.value) || 0);
    if (b.type === 'dp_minus') bonus -= (parseInt(b.value) || 0);
  });
  if (bonus !== 0) {
    sec.dp = Math.max(0, sec._origDp + bonus); // DP-（相手のセキュリティへのバフ）で負にならないように
    addLog('🛡 セキュリティバフ適用: 「' + sec.name + '」DP ' + formatDpDisplay(sec));
  }
}

// ===== バトル中バフ一時適用 =====
// レシピの when:"cond_in_battle" や効果テキストの「バトルしている間」をバトル解決時に適用

export function applyBattleBuffs(atk, def) {
  const applied = [];
  const turnSide = bs.isPlayerTurn ? 'player' : 'ai';
  // カードがどちらのバトルエリアに属するか判定
  const sideOf = (card) => {
    if (!card) return null;
    if (bs.player.battleArea.indexOf(card) !== -1) return 'player';
    if (bs.ai.battleArea.indexOf(card) !== -1) return 'ai';
    return null;
  };
  [atk, def].forEach(card => {
    if (!card) return;
    const cardSide = sideOf(card);
    // レシピの when:"cond_in_battle" をチェック（親カード + 進化元カード）
    const recipeSources = [card.recipe];
    if (card.stack) card.stack.forEach(s => { if (s.recipe) recipeSources.push(s.recipe); });
    recipeSources.forEach(rawRecipe => {
      if (!rawRecipe) return;
      try {
        let recipes = typeof rawRecipe === 'string' ? JSON.parse(rawRecipe.replace(/[\x00-\x1F\x7F]\s*/g, '')) : rawRecipe;
        // evo_sourceラッパー対応
        if (recipes.evo_source) recipes = recipes.evo_source;
        const durKeys = ['during_own_turn', 'during_opp_turn', 'during_any_turn'];
        durKeys.forEach(key => {
          if (!recipes[key]) return;
          // ターンサイドフィルタ:【自分のターン】は自ターン中のみ、【相手のターン】は相手ターン中のみ発動
          if (cardSide) {
            if (key === 'during_own_turn' && cardSide !== turnSide) return;
            if (key === 'during_opp_turn' && cardSide === turnSide) return;
          }
          const steps = Array.isArray(recipes[key]) ? recipes[key] : [recipes[key]];
          steps.forEach(step => {
            if (step.when !== 'cond_in_battle') return;
            if (step.action !== 'dp_plus') return;
            const opponent = card === atk ? def : atk;
            if (step.condition === 'cond_no_evo' && opponent.stack && opponent.stack.length > 0) return;
            const val = step.value || 0;
            card.dp += val;
            applied.push({ card, value: val });
            addLog('⚔ バトル中効果: 「' + card.name + '」元のDP+' + val);
          });
        });
      } catch (_) {}
    });
  });
  return applied;
}

export function removeBattleBuffs(applied) {
  applied.forEach(({ card, value }) => {
    card.dp -= value;
  });
}

// ===== バトル解決（プレイヤー → AI デジモン） =====

// _fireOnDestroy + _fireOnBattleDestroy + _fireWhenOwnDestroyed をチェーン実行するヘルパー
// sides: ['ai','player'] のような配列、各要素は destroyedSide
// done: 全完了時 callback
// destroyedCardsBySide: { ai: card, player: card } - destroy 直前のカード参照（on_destroy 発火対象）
// バトル起因の消滅でのみ呼ばれるため、on_destroy に加えて on_battle_destroy も発火する
// causerCardsBySide: { player: card, ai: card } - 各sideの消滅を実際に引き起こしたカード
// （バトルなら勝った側のカード）。省略時は「原因の対象=このデジモン」判定が「自分側」への
// 近似にフォールバックする（_destroyCauseMatches参照）
function _fireDestroyChain(sides, done, destroyedCardsBySide, causerCardsBySide) {
  let i = 0;
  // この後に誘発する自分の「デジモンが消滅したとき」（久遠寺マコト BT26-095 等）を、消滅時効果の処理中も発揮待ちに表示
  if (typeof window._hudPreviewSubjectDestroy === 'function') window._hudPreviewSubjectDestroy(sides, true);
  // バトルで同時に消滅した（両者消滅）なら、「デジモンが消滅したとき」は1回だけ誘発する（公式ルール 4-26-5）
  const _grp = sides.length >= 2 && window._newDestroyGroup ? window._newDestroyGroup('battle') : null;
  function next() {
    if (i >= sides.length) { done && done(); return; }
    const s = sides[i++];
    // 演出コールバックも渡す。これが無いと on_destroy レシピの summon_from_trash /
    // summon_token 等で登場演出（showPlayEffect）が発火しない。
    const ctxBase = {
      bs, addLog, renderAll, updateMemGauge, doDraw, showDrawEffect,
      showPlayEffect, showEvolveEffect, showDestroyEffect, showSecurityCheck, showBattleResult,
    };
    const destroyedCard = destroyedCardsBySide && destroyedCardsBySide[s];
    // オンライン対戦中、相手側('ai')の on_destroy はここでは発火しない。
    // 相手（カードの所有者）の機械が card_removed 受信時に 3500ms 後、自機で発火する
    // （resolveOnlineBlock と同じ設計）。ここで発火すると、相手の効果の確認/演出
    // ポップアップが「効果発動していない側」の画面にも操作可能な形で二重表示されてしまう。
    // on_battle_destroy / when_own_destroyed には対応する所有者側発火経路が無いため、
    // これらは従来通りここで発火する。
    const skipLocalOnDestroy = _onlineMode && s === 'ai';
    const afterOnDestroy = (cb) => {
      if (skipLocalOnDestroy) {
        // 相手（カードの本当の持ち主）の機械に「on_destroyを発火してよい」と明示的に伝える。
        // 従来は card_removed 受信からの固定3500ms待ちに任せていたが、on_battle_win等に
        // ユーザー操作待ちの演出（メタルティラノモンのアクティブ化ポップアップ等）が挟まると
        // 間に合わず、消滅時ポップアップが重ねて表示されてしまっていた。
        if (_onlineMode && _sendCommand) {
          try { _sendCommand({ type: 'fx_ownDestroyReady' }); } catch (_) {}
        }
        // 相手側の消滅時チェーン（メモリー+1等のwhen_own_destroyed/on_destroy）が完全に
        // 解決するまで待ってから次へ進む。これが無いと、相手側の効果が終わる前に
        // こちらがcheckAttackEnd/ターン終了判定へ進んでしまい、相手側の効果で相手側へ
        // 渡ったメモリーによるターン終了判定を取りこぼす（バトル終了直後に本来ではない
        // アクティブフェイズに入ってしまう不具合の原因だった）
        if (typeof window !== 'undefined' && typeof window._waitForOwnDestroyDone === 'function') {
          window._waitForOwnDestroyDone(cb);
        } else {
          cb();
        }
        return;
      }
      try { _fireOnDestroy(s, bs, ctxBase, cb, destroyedCard); } catch (_) { cb(); }
    };
    // 【分離】は「消滅自体をキャンセルする」効果のため、この関数に到達している時点で
    // 既に呼び出し元（_tryCancelDestroyAsync）が判定済み＝消滅は確定している。
    // 「消滅した時」（when_own_destroyed=同sideの他カードの反応）を先に解決し、
    // 「消滅時」（on_destroy/on_battle_destroy=消滅したカード自体の効果）を最後に解決する。
    // on_battle_destroy/when_own_destroyed には対応する所有者側発火経路が無いため、
    // これらは従来通りここ（消滅させた側の機械）で発火する。
    try {
      _fireWhenOwnDestroyed(s, bs, ctxBase, () => {
        // 「原因」追跡: バトルによる消滅は常に反対側が原因（1対1のバトル解決なので、
        // 消滅したカードの反対側=勝った側。個別のカードまでは特定できないため
        // causerCard は null のままにし、_destroyCauseMatches 側で own/opp相当に近似する）
        bs._lastDestroyCause = {
          type: 'battle',
          causerSide: s === 'player' ? 'ai' : 'player',
          causerCard: (causerCardsBySide && causerCardsBySide[s]) || null,
          grp: _grp,
        };
        // on_destroy の発動主体=自分/相手/両方 の反応（新設。既存カードは on_destroy に
        // subjectを持たないため影響なし）
        _fireOnDestroySubjectReactions(s, bs, ctxBase, () => {
          bs._lastDestroyCause = null;
          afterOnDestroy(() => {
            try {
              _fireOnBattleDestroy(s, bs, ctxBase, next, destroyedCard);
            } catch (_) { next(); }
          });
        });
      });
    } catch (_) { next(); }
  }
  next();
}

// バトルの前（ブロックしてからバトルまでの効果等）に、その枠のデジモンが進化した（アーツ進化等）なら、進化後のカードが
// そのままバトルする（同じデジモン）。以前は進化前のカードのDP・名前でバトルしていた（ウルヴァモン →
// ベアキャットモン＆ペネトレイトブロウ BT26-057 でブロックしたのに、ウルヴァモンでバトルしていた）
function _evolvedInSlot(card, side, idx) {
  const cur = bs[side] && bs[side].battleArea ? bs[side].battleArea[idx] : null;
  if (cur && card && cur !== card && Array.isArray(cur.stack) && cur.stack.indexOf(card) >= 0) {
    addLog('⬆ 「' + card.name + '」が「' + cur.name + '」に進化（そのままバトル）');
    return cur;
  }
  return card;
}
export function resolveBattle(atk, atkIdx, def, defIdx, defSide) {
  _beginAttackResolution();
  atk = _evolvedInSlot(atk, defSide === 'ai' ? 'player' : 'ai', atkIdx);
  def = _evolvedInSlot(def, defSide || 'ai', defIdx);
  // 比べるDPは付与中のバフから計算し直した値にする（DP+の永続効果が反映されていないことがあった）
  // オンラインの相手のカード（def）は持ち主の端末の値を正とするので計算し直さない
  try { if (window._recalcDp) { window._recalcDp(atk); if (!_onlineMode) window._recalcDp(def); } } catch (_) {}
  showCombatBackdrop();
  const battleBuffs = applyBattleBuffs(atk, def);
  addLog('⚔ 「' + atk.name + '」(DP ' + formatDpDisplay(atk) + ') vs 「' + def.name + '」(DP ' + formatDpDisplay(def) + ')');

  function destroyDef() {
    if (defSide === 'ai') {
      bs.ai.battleArea[defIdx] = null;
      bs.ai.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.ai.trash.push(s));
      _dumpLinkedCardsUnlessDeferred(def, bs.ai.trash);
      if (_onlineMode && _sendCommand) {
        _sendCommand({ type: 'card_removed', zone: 'battle', slotIdx: defIdx, reason: 'destroy' });
        if (window._markDestroyed) window._markDestroyed('ai', defIdx);
      }
    }
  }
  function destroyAtk() {
    removeOwnCard(atkIdx, 'destroy');
  }

  showSecurityCheck(def, atk, () => {
    // バトル中効果適用済みのDPで勝敗判定 → その後バフ除去
    // ≪氷装≫: セキュリティデジモン以外とのバトルでは DP ではなく進化元枚数を比べる
    let _atkDp = atk.dp, _defDp = def.dp;
    const iceArmorActive = (atk._permEffects && atk._permEffects.iceArmor) || (def._permEffects && def._permEffects.iceArmor);
    if (iceArmorActive) {
      _atkDp = atk.stack ? atk.stack.length : 0;
      _defDp = def.stack ? def.stack.length : 0;
      addLog('🧊 ≪氷装≫: 進化元枚数比較 (atk=' + _atkDp + ' / def=' + _defDp + ')');
    }
    removeBattleBuffs(battleBuffs);
    // 「バトル終了まで」（dur_until_battle_end）のバフはここで期限切れにする
    // （例:「アタック中のこのデジモンは相手の効果を受けない」＝immune_effects）
    _expireBuffs(bs, 'dur_until_battle_end');
    if (_atkDp === _defDp) {
      // 両者消滅の前に、双方独立に when_battle_destroy（消滅回避コスト）を確認する。相手の確認を待っている間も、
      // 自分のデジモンの消滅時効果を発揮待ちとして表示しておく
      if (typeof window._hudPreviewDestroy === 'function') window._hudPreviewDestroy(atk, 'player');
      _runBattleDestroyAvoid('ai', def, () => {
        _runBattleDestroyAvoid('player', atk, () => {
          // 両者とも回避せず → 両者消滅
          destroyDef(); destroyAtk(); renderAll();
          showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => {
            showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
              addLog('💥 両者消滅！'); renderAll();
              // ターンプレイヤー（player）側の reactions を先 → 'ai' destroyed が reactSide='player'
              _fireDestroyChain(['ai', 'player'], () => checkPendingTurnEnd(), { ai: def, player: atk }, { ai: atk, player: def });
            }); });
          }, '両者消滅', '#ff4444');
        }, () => {
          // atk のみコストを払い消滅回避 → def のみ消滅
          destroyDef(); renderAll();
          showBattleResult('撃破！', '#00ff88', '「' + def.name + '」を撃破（自分は消滅回避）', () => {
            showDestroyEffect(def, () => {
              addLog('💥 「' + def.name + '」を撃破！'); renderAll();
              _fireDestroyChain(['ai'], () => checkPendingTurnEnd(), { ai: def }, { ai: atk });
            });
          }, '回避！', '#00fbff');
        });
      }, () => {
        _runBattleDestroyAvoid('player', atk, () => {
          // def のみコストを払い消滅回避 → atk のみ消滅
          destroyAtk(); renderAll();
          showBattleResult('Lost...', '#ff4444', '「' + atk.name + '」が撃破された...', () => {
            showDestroyEffect(atk, () => {
              addLog('💥 「' + atk.name + '」が撃破された...'); renderAll();
              _fireDestroyChain(['player'], () => checkPendingTurnEnd(), { player: atk }, { player: def });
            });
          }, '回避！', '#00fbff');
        }, () => {
          // 両者ともコストを払い消滅回避
          renderAll();
          showBattleResult('回避！', '#00fbff', '両者がコストを払い消滅を回避', () => { renderAll(); checkPendingTurnEnd(); }, '回避！', '#00fbff');
        });
      });
    } else if (_atkDp > _defDp) {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫/【分離】: def 側の消滅回避を試行
      _tryCancelDestroyAsync(def, bs.ai, 'ai', false, (cancelDef) => {
      if (cancelDef) {
        renderAll();
        showBattleResult('回避！', '#ff00fb', '相手「' + def.name + '」が消滅を回避', () => { renderAll(); checkAttackEnd(atk, atkIdx); }, 'Lost...', '#ff4444');
        return;
      }
      _runWhenBattleDestroy('ai', def,
        () => {
      destroyDef(); renderAll();
      showBattleResult('Win!!', '#00ff88', '「' + def.name + '」を撃破！', () => {
        showDestroyEffect(def, () => {
          addLog('💥 「' + def.name + '」を撃破！'); renderAll();
          // on_battle_win（本体+進化元）を発火するヘルパー。≪衝突≫/≪貫通≫も同じ
          // 「バトル勝利」から同時誘発するターンプレイヤー(atk)側の効果なので、
          // defの消滅チェーン（非ターンプレイヤー側）より前に、ターンプレイヤー側の
          // 効果同士（≪衝突≫/≪貫通≫→on_battle_win、の順で解決）を先に済ませる
          // （公式ルール15-4-3-5: 同時誘発はターンプレイヤー側を全て解決してから
          // 非ターンプレイヤー側に進む）
          const fireOnBattleWin = (afterDone) => {
            bs._lastBattleWinner = atk;
            // trigger_conditions（例: cond_lv_ge:6@opp）が「バトルで消滅させた相手」を
            // 正しく参照できるようにする（メタルティラノモン等）
            bs._lastBattleDefeatedCard = def;
            const winCtx = _hooks.makeEffectContext(atk, 'player');
            _hooks.triggerEffect('on_battle_win', atk, 'player', winCtx, () => {
              bs._lastBattleWinner = null;
              bs._lastBattleDefeatedCard = null;
              afterDone();
            });
          };
          // ≪道連れ≫: 撃破した相手(def)が【道連れ】を持つ場合、DPで上回っていても
          // 撃破した側(atk)も巻き込んで消滅する。道連れが優先されるため≪貫通≫の
          // ボーナスチェックは発揮せず、on_battle_winも発火しない（両者消滅と同じ扱い）
          if (hasMichizure(def)) {
            addLog('💀 【道連れ】「' + def.name + '」が「' + atk.name + '」を巻き込んで消滅！');
            bs.player.battleArea[atkIdx] = null;
            bs.player.trash.push(atk);
            if (atk.stack) atk.stack.forEach(function(s){ bs.player.trash.push(s); });
            _dumpLinkedCardsUnlessDeferred(atk, bs.player.trash);
            renderAll();
            showMichizureAnnounce(() => {
              showDestroyEffect(atk, function() {
                _fireDestroyChain(['ai', 'player'], function() { checkPendingTurnEnd(); }, { ai: def, player: atk }, { ai: atk, player: def });
              });
            });
            return;
          }
          // ≪貫通≫: アタックで相手デジモン撃破 → アタック終了直前に追加セキュリティチェック
          if (hasPenetrate(atk)) {
            // ≪貫通≫は「バトルで相手のデジモンを消滅させたとき」に誘発する効果なので、同時に誘発した
            // 「バトルに勝ったとき」（on_battle_win。本体・進化元）と並べて、ターンプレイヤーが順番を選ぶ
            // （公式ルール15-4-3。以前は貫通のセキュリティチェックを必ず先に行っていた）。
            // 非ターンプレイヤー側（defの消滅時チェーン）は、ターンプレイヤー側を全て解決してから。
            // 貫通のセキュリティ効果解決中に誘発した非ターンプレイヤー側トリガー（登場したテイマーの登場時等）は
            // effect-engine.js側からこのフックに合流する
            _setPendingBattleTriggers(
              null,
              (proceed) => { _fireDestroyChain(['ai'], proceed, { ai: def }, { ai: atk }); }
            );
            window._nextTriggerExtras = [{
              card: atk, side: 'turnPlayer', actualSide: 'player',
              block: { raw: '', trigger: { code: 'on_battle_win' }, actions: [], conditions: [],
                _grantedSteps: [{ action: 'penetrate_check', no_announce: true, _kwFlag: 'penetrate' }] },
            }];
            fireOnBattleWin(() => { checkAttackEnd(atk, atkIdx); });
          } else {
            fireOnBattleWin(() => {
              _fireDestroyChain(['ai'], () => { checkAttackEnd(atk, atkIdx); }, { ai: def }, { ai: atk });
            });
          }
        });
      }, 'Lose...', '#ff4444');
        },
        () => {
          renderAll();
          showBattleResult('回避！', '#ff00fb', '相手「' + def.name + '」がコストを払い消滅を回避', () => { renderAll(); checkAttackEnd(atk, atkIdx); }, 'Lose...', '#ff4444');
        }
      );
      });
    } else {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫/【分離】: 消滅回避を試行
      _tryCancelDestroyAsync(atk, bs.player, 'player', false, (cancelResult) => {
      if (cancelResult) {
        renderAll();
        showBattleResult('回避！', '#00fbff', '「' + atk.name + '」が消滅を回避', () => { renderAll(); checkAttackEnd(atk, atkIdx); }, 'Win!!', '#00ff88');
        return;
      }
      _runWhenBattleDestroy('player', atk,
        () => {
          destroyAtk(); renderAll();
          showBattleResult('Lost...', '#ff4444', '「' + atk.name + '」が撃破された', () => {
            showDestroyEffect(atk, () => {
              addLog('💥 「' + atk.name + '」が撃破された...'); renderAll();
              // ≪道連れ≫: バトルで自分だけ消滅 → 相手(def)も消滅させる
              if (hasMichizure(atk) && def && bs.ai.battleArea.indexOf(def) >= 0) {
                addLog('💀 【道連れ】「' + atk.name + '」が「' + def.name + '」を巻き込んで消滅！');
                const defIdx2 = bs.ai.battleArea.indexOf(def);
                bs.ai.battleArea[defIdx2] = null;
                bs.ai.trash.push(def);
                if (def.stack) def.stack.forEach(s => bs.ai.trash.push(s));
      _dumpLinkedCardsUnlessDeferred(def, bs.ai.trash);
                renderAll();
                showMichizureAnnounce(() => {
                  showDestroyEffect(def, () => {
                    _fireDestroyChain(['player', 'ai'], () => checkPendingTurnEnd(), { player: atk, ai: def }, { player: def, ai: atk });
                  });
                });
                return;
              }
              _fireDestroyChain(['player'], () => checkPendingTurnEnd(), { player: atk }, { player: def });
            });
          }, 'Win!!', '#00ff88');
        },
        () => {
          renderAll();
          showBattleResult('回避！', '#00fbff', '「' + atk.name + '」がコストを払い消滅を回避', () => { renderAll(); checkAttackEnd(atk, atkIdx); }, 'Win!!', '#00ff88');
        }
      );
      });
    }
  }, 'BATTLE!');
}

// ===== バトル解決（AI → プレイヤー ブロッカー戦） =====

export function resolveBattleAI(atk, atkIdx, def, defIdx, callback) {
  _beginAttackResolution();
  atk = _evolvedInSlot(atk, 'ai', atkIdx);
  def = _evolvedInSlot(def, 'player', defIdx);
  showCombatBackdrop();
  const origCb = callback;
  callback = () => { hideCombatBackdrop(); origCb(); };
  const battleBuffs = applyBattleBuffs(atk, def);
  addLog('⚔ 「' + atk.name + '」(DP ' + formatDpDisplay(atk) + ') vs 「' + def.name + '」(DP ' + formatDpDisplay(def) + ')');
  showSecurityCheck(def, atk, () => {
    // バトル中効果適用済みのDPで勝敗判定 → その後バフ除去
    // ≪氷装≫: 進化元枚数比較
    let _atkDp = atk.dp, _defDp = def.dp;
    const iceArmorActive2 = (atk._permEffects && atk._permEffects.iceArmor) || (def._permEffects && def._permEffects.iceArmor);
    if (iceArmorActive2) {
      _atkDp = atk.stack ? atk.stack.length : 0;
      _defDp = def.stack ? def.stack.length : 0;
      addLog('🧊 ≪氷装≫: 進化元枚数比較 (atk=' + _atkDp + ' / def=' + _defDp + ')');
    }
    removeBattleBuffs(battleBuffs);
    // 「バトル終了まで」（dur_until_battle_end）のバフはここで期限切れにする
    // （例:「アタック中のこのデジモンは相手の効果を受けない」＝immune_effects）
    _expireBuffs(bs, 'dur_until_battle_end');
    if (_atkDp === _defDp) {
      // 両者消滅の前に、双方独立に when_battle_destroy（消滅回避コスト）を確認する
      _runBattleDestroyAvoid('player', def, () => {
        _runBattleDestroyAvoid('ai', atk, () => {
          // 両者とも回避せず → 両者消滅
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
          bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
          if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(def, bs.player.trash);
          renderAll();
          showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
            // ターンプレイヤー（ai）側の reactions を先 → 'player' destroyed が reactSide='ai'
            _fireDestroyChain(['player', 'ai'], () => {
              showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => { addLog('💥 両者消滅！'); renderAll(); callback(); }, '両者消滅', '#ff4444');
            }, { player: def, ai: atk }, { player: atk, ai: def });
          }); });
        }, () => {
          // atk のみコストを払い消滅回避 → def のみ消滅
          bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
          if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(def, bs.player.trash);
          renderAll();
          showDestroyEffect(def, () => {
            _fireDestroyChain(['player'], () => {
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された（相手は消滅回避）', () => { addLog('💥 「' + def.name + '」が撃破された'); renderAll(); callback(); }, '回避！', '#00fbff');
            }, { player: def }, { player: atk });
          });
        });
      }, () => {
        _runBattleDestroyAvoid('ai', atk, () => {
          // def のみコストを払い消滅回避 → atk のみ消滅
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
          renderAll();
          showDestroyEffect(atk, () => {
            _fireDestroyChain(['ai'], () => {
              showBattleResult('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => { addLog('💥 「' + atk.name + '」を撃破！'); renderAll(); callback(); }, 'Lost...', '#ff4444');
            }, { ai: atk }, { ai: def });
          });
        }, () => {
          // 両者ともコストを払い消滅回避
          renderAll();
          showBattleResult('回避！', '#00fbff', '両者がコストを払い消滅を回避', () => { renderAll(); callback(); }, '回避！', '#00fbff');
        });
      });
    } else if (_atkDp > _defDp) {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫/【分離】: プレイヤー側 def の消滅回避を試行
      _tryCancelDestroyAsync(def, bs.player, 'player', false, (cancelPlayerDef) => {
      if (cancelPlayerDef) {
        renderAll();
        showBattleResult('回避！', '#00fbff', '「' + def.name + '」が消滅を回避', () => { renderAll(); callback(); }, '回避！', '#00fbff');
        return;
      }
      _runWhenBattleDestroy('player', def,
        () => {
          bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
          if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(def, bs.player.trash);
          renderAll();
          showDestroyEffect(def, () => {
            // on_battle_win（本体+進化元）を発火するヘルパー。≪衝突≫/≪貫通≫も同じ
            // 「バトル勝利」から同時誘発するターンプレイヤー(atk=ai)側の効果なので、
            // defの消滅チェーン（非ターンプレイヤー側）より前に、ターンプレイヤー側の
            // 効果同士（≪衝突≫/≪貫通≫→on_battle_win、の順で解決）を先に済ませる
            // （公式ルール15-4-3-5）
            const fireOnBattleWin = (afterDone) => {
              bs._lastBattleWinner = atk;
              // trigger_conditions（例: cond_lv_ge:6@opp）が「バトルで消滅させた相手」を
              // 正しく参照できるようにする（メタルティラノモン等）
              bs._lastBattleDefeatedCard = def;
              const winCtx = _hooks.makeEffectContext(atk, 'ai');
              _hooks.triggerEffect('on_battle_win', atk, 'ai', winCtx, () => {
                bs._lastBattleWinner = null;
                bs._lastBattleDefeatedCard = null;
                afterDone();
              });
            };
            // ≪道連れ≫: 撃破した相手(def)が【道連れ】を持つ場合、DPで上回っていても
            // 撃破した側(atk)も巻き込んで消滅する。道連れが優先されるため≪貫通≫の
            // ボーナスチェックは発揮せず、on_battle_winも発火しない（両者消滅と同じ扱い）
            if (hasMichizure(def)) {
              addLog('💀 【道連れ】「' + def.name + '」が「' + atk.name + '」を巻き込んで消滅！');
              bs.ai.battleArea[atkIdx] = null;
              bs.ai.trash.push(atk);
              if (atk.stack) atk.stack.forEach(function(s){ bs.ai.trash.push(s); });
              _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
              renderAll();
              showMichizureAnnounce(() => {
                showDestroyEffect(atk, function() {
                  _fireDestroyChain(['player', 'ai'], function() {
                    showBattleResult('両者消滅', '#ff4444', '両者消滅（道連れ）！', function() { renderAll(); callback(); }, '両者消滅', '#ff4444');
                  }, { player: def, ai: atk }, { player: atk, ai: def });
                });
              });
              return;
            }
            // ≪貫通≫: AI アタッカーが撃破したら追加セキュリティチェック
            if (hasPenetrate(atk)) {
              addLog('🗡 [AI] 「' + atk.name + '」の【貫通】効果でセキュリティチェック！');
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された', () => {
                addLog('💥 「' + def.name + '」が撃破された'); renderAll();
                showPenetrateAnnounce(() => {
                  // doAiSecurityCheckは完了コールバックを取れるので、貫通のセキュリティ解決が
                  // 終わってからon_battle_win(ターンプレイヤー)→defの消滅チェーン(非ターン
                  // プレイヤー)の順に繋ぐ。非ターンプレイヤー側フックは、セキュリティ効果解決中に
                  // 新たな非ターンプレイヤー側トリガーが誘発した場合、effect-engine.js側から
                  // 合流できるよう分けて保持する（checkAttackEnd側と同じ仕組みを共有）
                  _setPendingBattleTriggers(
                    (proceed) => { fireOnBattleWin(proceed); },
                    (proceed) => { _fireDestroyChain(['player'], proceed, { player: def }, { player: atk }); }
                  );
                  doAiSecurityCheck(atk, atkIdx, () => { _consumePendingBattleTriggers(callback); });
                });
              }, 'Win!!', '#00ff88');
            } else {
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された', () => {
                addLog('💥 「' + def.name + '」が撃破された'); renderAll();
                fireOnBattleWin(() => { _fireDestroyChain(['player'], callback, { player: def }, { player: atk }); });
              }, 'Win!!', '#00ff88');
            }
          });
        },
        () => {
          renderAll();
          showBattleResult('回避！', '#00fbff', '「' + def.name + '」がコストを払い消滅を回避', () => { renderAll(); callback(); }, '回避！', '#00fbff');
        }
      );
      });
    } else {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫/【分離】: AI 側 atk の消滅回避を試行
      _tryCancelDestroyAsync(atk, bs.ai, 'ai', false, (cancelAiAtk) => {
      if (cancelAiAtk) {
        renderAll();
        showBattleResult('回避！', '#ff00fb', '相手「' + atk.name + '」が消滅を回避', () => { renderAll(); callback(); }, '回避！', '#ff00fb');
        return;
      }
      _runWhenBattleDestroy('ai', atk,
        () => {
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
      if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
      renderAll();
      // ≪道連れ≫: AI のアタッカーが消滅したとき、防御側 (player の def) も巻き込む
      if (hasMichizure(atk) && def && bs.player.battleArea.indexOf(def) >= 0) {
        const defIdx2 = bs.player.battleArea.indexOf(def);
        bs.player.battleArea[defIdx2] = null;
        bs.player.trash.push(def);
        if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
        _dumpLinkedCardsUnlessDeferred(def, bs.player.trash);
        addLog('💀 【道連れ】「' + atk.name + '」が「' + def.name + '」を巻き込んで消滅！');
        renderAll();
        showDestroyEffect(atk, () => {
          // 巻き込まれた def の消滅前に「道連れ」演出
          showMichizureAnnounce(() => {
            showDestroyEffect(def, () => {
              _fireDestroyChain(['ai', 'player'], () => {
                showBattleResult('両者消滅', '#ff4444', '両者消滅（道連れ）！', () => { renderAll(); callback(); }, '両者消滅', '#ff4444');
              }, { ai: atk, player: def }, { ai: def, player: atk });
            });
          });
        });
        return;
      }
      showDestroyEffect(atk, () => {
        _fireDestroyChain(['ai'], () => {
          // 防御側 (def, player) が atk を撃破して生存 → on_battle_win on def
          bs._lastBattleWinner = def;
          // trigger_conditions（例: cond_lv_ge:6@opp）が「バトルで消滅させた相手」を
          // 正しく参照できるようにする
          bs._lastBattleDefeatedCard = atk;
          const winCtx = _hooks.makeEffectContext(def, 'player');
          _hooks.triggerEffect('on_battle_win', def, 'player', winCtx, () => {
            bs._lastBattleWinner = null;
            bs._lastBattleDefeatedCard = null;
            showBattleResult('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => { addLog('💥 「' + atk.name + '」を撃破！'); renderAll(); callback(); }, 'Lost...', '#ff4444');
          });
        }, { ai: atk }, { ai: def });
      });
        },
        () => {
          renderAll();
          showBattleResult('回避！', '#ff00fb', '相手「' + atk.name + '」がコストを払い消滅を回避', () => { renderAll(); callback(); }, '回避！', '#ff00fb');
        }
      );
      });
    }
  }, 'BATTLE!');
}

// ===== ブロック確認UI =====

// 【ブロッカー】を持っているカード（このデジモン自身／表向きの進化元／リンクカード）。分からなければこのデジモン自身
function _blockerHolder(c) {
  const parse = (r) => { try { return typeof r === 'string' ? JSON.parse(r.replace(/[\x00-\x1F\x7F]\s*/g, '')) : r; } catch (_) { return null; } };
  const hasBk = (arr) => Array.isArray(arr) && arr.some(p => p && (p.flag === 'blocker' || p === 'blocker'));
  const own = parse(c && c.recipe);
  if (own && hasBk(own.passive)) return c;
  if (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_blocker')) return c;
  for (const ev of (c.stack || [])) {
    if (!ev || ev._faceDown) continue;
    const er = parse(ev.recipe);
    if (er && er.evo_source && hasBk(er.evo_source.passive)) return ev;
  }
  for (const lc of (c.linkedCards || [])) {
    const lr = parse(lc && lc.recipe);
    if (lr && lr.link && hasBk(lr.link.passive)) return lc;
  }
  return c;
}
export function showBlockConfirm(blocker, attacker, callback, targetInfo) {
  // 旧コード準拠: effect-confirm-overlay を使用
  const overlay = document.getElementById('effect-confirm-overlay');
  if (!overlay) { callback(false); return; }
  const nameEl = document.getElementById('effect-confirm-name');
  const textEl = document.getElementById('effect-confirm-text');
  const questionEl = document.getElementById('effect-confirm-question');
  const imgEl = document.getElementById('effect-confirm-img');

  nameEl.innerText = '🚨💥 アタック中！！ 💥🚨';
  nameEl.style.color = '#ff2222';
  nameEl.style.textShadow = '0 0 10px #ff0000, 0 0 20px #ff000088';
  nameEl.style.fontSize = '1.2rem';
  let targetText = '';
  if (targetInfo) {
    if (targetInfo.type === 'security') targetText = '\n→ セキュリティへアタック';
    else if (targetInfo.type === 'digimon') targetText = '\n→「' + (targetInfo.name || '???') + '」へアタック';
  }
  textEl.innerText = '相手の「' + (attacker ? attacker.name : '???') + '」(DP:' + (attacker ? formatDpDisplay(attacker) : '?') + ')がアタックしてきました！' + targetText;
  // ブロックできるデジモンと、その【ブロッカー】を持っているカード（進化元のカードの効果なら「「グレイモン」の効果」）を出す
  try {
    const _cands = Array.isArray(window._blockConfirmCands) ? window._blockConfirmCands.map(i => bs.player.battleArea[i]).filter(Boolean) : (blocker ? [blocker] : []);
    window._blockConfirmCands = null;
    const _lines = _cands.map((c) => {
      const h = _blockerHolder(c);
      return '・「' + c.name + '」' + (h && h !== c ? '（「' + h.name + '」の効果【ブロッカー】）' : '');
    });
    if (_lines.length > 0) textEl.innerText += '\n\nブロックできるデジモン:\n' + _lines.join('\n');
  } catch (_) {}
  if (questionEl) questionEl.innerText = 'ブロックしますか？';
  if (imgEl) imgEl.style.display = 'none';
  overlay.style.display = 'flex';

  // チュートリアル: ダイアログ表示中に割り込み
  if (window._tutorialRunner && window._tutorialRunner.active) {
    setTimeout(() => {
      window._tutorialRunner.checkInterrupt('block_confirm').then(() => {});
    }, 100);
  }

  window._effectConfirmCallback = function(result) {
    nameEl.style.color = '#fff';
    nameEl.style.textShadow = '';
    nameEl.style.fontSize = '1rem';
    if (questionEl) questionEl.innerText = '効果を発動しますか？';
    if (imgEl) imgEl.style.display = '';
    overlay.style.display = 'none';
    // チュートリアル: 吹き出し/スポットライトを強制消去 + イベント通知
    if (window._tutorialRunner && window._tutorialRunner.active) {
      try {
        window._tutorialRunner.hideInstruction();
        document.body.classList.remove('tutorial-spotlight-mode');
        document.querySelectorAll('.tutorial-keep-visible').forEach(el => el.classList.remove('tutorial-keep-visible'));
        window._tutorialRunner.notifyEvent('modal_closed', { modal: 'block_confirm', result });
      } catch (e) {}
    }
    callback(result);
  };
}

// ===== ブロッカー選択UI =====

export function showBlockerSelection(blockerIndices, attacker, callback) {
  const row = document.getElementById('pl-battle-row');
  if (!row) { callback(null); return; }
  addLog('🛡 ブロックするデジモンを選んでください');

  const msgEl = document.createElement('div');
  msgEl.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:60000;background:rgba(0,0,0,0.9);border:1px solid #00fbff;border-radius:10px;padding:12px 24px;color:#00fbff;font-size:14px;font-weight:bold;text-align:center;box-shadow:0 0 20px #00fbff44;pointer-events:none;';
  msgEl.innerText = '🛡 ブロックするデジモンを選択';
  document.body.appendChild(msgEl);

  const slots = row.querySelectorAll('.b-slot');
  blockerIndices.forEach(idx => {
    const slot = slots[idx]; if (!slot) return;
    slot.style.border = '2px solid #00fbff';
    slot.style.boxShadow = '0 0 15px #00fbff';
    slot.style.cursor = 'pointer';
  });

  function cleanup() {
    if (msgEl.parentNode) msgEl.parentNode.removeChild(msgEl);
    blockerIndices.forEach(idx => {
      const slot = slots[idx]; if (!slot) return;
      slot.style.border = ''; slot.style.boxShadow = ''; slot.style.cursor = '';
    });
    document.removeEventListener('click', onSelect, true);
    document.removeEventListener('touchend', onSelect, true);
  }

  function onSelect(e) {
    if (e.target && e.target.closest && e.target.closest('#_pending-hud-own, #_pending-hud-opp, [data-hud-list]')) return; // 発揮待ちの効果の表示は対象外
    const cx = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    const cy = e.clientY || (e.changedTouches && e.changedTouches[0].clientY);
    if (!cx || !cy) return;
    let selectedIdx = null;
    blockerIndices.forEach(idx => {
      const slot = slots[idx]; if (!slot) return;
      const r = slot.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) selectedIdx = idx;
    });
    if (selectedIdx !== null) {
      // 選択候補のカード詳細 + 「このデジモンでブロックしますか？」確認ダイアログを出す
      // 「はい」で確定、「いいえ」で再選択に戻す（他効果の対象選択と同じ UX）
      document.removeEventListener('click', onSelect, true);
      document.removeEventListener('touchend', onSelect, true);
      const card = bs.player.battleArea[selectedIdx];
      // bubble で b-card-detail (BCD) が開いた場合は確認ダイアログ表示直前に閉じる
      setTimeout(() => {
        try {
          const bcd = document.getElementById('b-card-detail');
          if (bcd) bcd.style.display = 'none';
        } catch (_) {}
        showBlockerConfirm(card, () => {
          cleanup();
          callback(selectedIdx);
        }, () => {
          // キャンセル → 選択画面へ戻す
          setTimeout(() => {
            document.addEventListener('click', onSelect, true);
            document.addEventListener('touchend', onSelect, true);
          }, 100);
        });
      }, 30);
    }
  }

  setTimeout(() => {
    document.addEventListener('click', onSelect, true);
    document.addEventListener('touchend', onSelect, true);
  }, 100);
}

// ブロッカー候補のカード詳細 + 「このデジモンでブロックしますか？」確認ダイアログ
function showBlockerConfirm(card, onYes, onNo) {
  const borderColor = '#00fbff';
  const overlay = document.createElement('div');
  overlay.id = '_blocker-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#0a0a0a;border:1px solid ' + borderColor + ';border-radius:12px;padding:20px;max-width:320px;width:100%;text-align:center;';
  const imgSrc = card ? (card.imgSrc || cardImg(card) || card.imageUrl || '') : '';
  const _pc = (card.playCost != null) ? card.playCost : (card.cost != null ? card.cost : null);
  let _statsHtml = 'Lv.' + (card.level || '?') + ' ／ DP:' + (card.dp || '?') + ' ／ 登場コスト:' + (_pc != null ? _pc : '—');
  const _feat = String(card.feature || '').trim();
  if (_feat && _feat !== 'なし' && _feat !== '-') {
    _statsHtml += '<br><span style="color:#ffcc66;">特徴：' + _feat.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</span>';
  }
  if (card.evolveCost != null) {
    const _evoEsc = String(formatEvolveCostDetail(card)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    _statsHtml += '<br><span style="color:#00ff88;">進化コスト：' + _evoEsc + '</span>';
  }
  box.innerHTML = (imgSrc ? '<img src="' + imgSrc + '" style="width:160px;border-radius:8px;margin-bottom:12px;border:1px solid ' + borderColor + ';">' : '')
    + '<div style="color:#fff;font-weight:bold;font-size:14px;margin-bottom:8px;">' + (card.name || '不明') + ' (' + (card.cardNo || '') + ')</div>'
    + '<div style="font-size:12px;color:' + borderColor + ';margin-bottom:10px;line-height:1.5;">' + _statsHtml + '</div>';
  if (card.effect && card.effect !== 'なし') {
    box.innerHTML += '<div style="font-size:11px;color:#ddd;line-height:1.7;margin-bottom:10px;text-align:left;background:#111;padding:10px;border-radius:6px;border:1px solid #333;">'
      + '<div style="color:' + borderColor + ';font-size:10px;margin-bottom:4px;font-weight:bold;">効果</div>' + card.effect + '</div>';
  }
  if (card.evoSourceEffect && card.evoSourceEffect !== 'なし') {
    box.innerHTML += '<div style="font-size:11px;color:#aaa;line-height:1.7;margin-bottom:10px;text-align:left;background:#0a0a0a;padding:10px;border-radius:6px;border:1px solid #222;">'
      + '<div style="color:#ffaa00;font-size:10px;margin-bottom:4px;font-weight:bold;">' + _evoSourceEffectLabel(card) + '</div>' + card.evoSourceEffect + '</div>';
  }
  box.innerHTML += '<div style="color:' + borderColor + ';font-size:14px;font-weight:bold;margin:16px 0 12px;">🛡 このデジモンでブロックしますか？</div>'
    + '<div style="display:flex;gap:10px;justify-content:center;">'
    + '<button id="_blocker-yes" style="background:' + borderColor + ';color:#000;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">はい</button>'
    + '<button id="_blocker-no" style="background:#333;color:#fff;border:1px solid #666;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;">いいえ</button>'
    + '</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) e.stopPropagation(); });
  const cleanupConf = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
  document.getElementById('_blocker-yes').addEventListener('click', (e) => {
    e.stopPropagation();
    cleanupConf();
    // 確定後に裏で BCD が開いていたら閉じる
    try {
      const bcd = document.getElementById('b-card-detail');
      if (bcd) bcd.style.display = 'none';
    } catch (_) {}
    setTimeout(() => onYes && onYes(), 50);
  });
  document.getElementById('_blocker-no').addEventListener('click', (e) => {
    e.stopPropagation();
    cleanupConf();
    try {
      const bcd = document.getElementById('b-card-detail');
      if (bcd) bcd.style.display = 'none';
    } catch (_) {}
    setTimeout(() => onNo && onNo(), 50);
  });
}

// ===== AIアタックフェーズ =====

export function aiAttackPhase(callback) {
  hideCombatBackdrop();
  if (bs._battleAborted) return;
  if (_onlineMode) { callback && callback(); return; }
  // 前のアタックのセキュリティチェック・バトルの解決が終わった: 保留していた DP0 の消滅（ルールチェック）を行ってから次へ
  if (bs._attackResolving) {
    bs._attackResolving = false;
    if (typeof window !== 'undefined' && typeof window._runRuleDestroyCheckNow === 'function') {
      window._runRuleDestroyCheckNow(() => aiAttackPhase(callback));
      return;
    }
  }

  const atkIdx = bs.ai.battleArea.findIndex(c => c && (c.type === 'デジモン' || c.type === 'デュアル') && !c.suspended && !c.summonedThisTurn);
  if (atkIdx === -1) { callback(); return; }

  const atk = bs.ai.battleArea[atkIdx];
  atk.suspended = true;
  atk._attackedOnTurn = bs.turn; // cond_self_attacked 用
  bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
  addLog('🤖 「' + atk.name + '」でアタック！');
  // ≪連携≫: AI 側もバフ自動発動
  _tryCombo(atk, bs.ai);
  renderAll();
  // アタック宣言による自身のレスト → プレイヤー側の when_opp_rest 誘発（ヴェノムヴァンデモン等）。
  // この誘発（効果発動ポップアップのOK待ち）が解決するまでアタック演出・バトル進行に進めない
  _fireAttackRestThen('ai', atk, () => {

  showPhaseAnnounce('⚔ AIアタック！', '#ff4444', () => {
    const doAfterAtkEffect = (cb) => {
      // アタッカーの【アタック時】効果 → その後に防御側の
      // 「相手のデジモンがプレイヤーにアタックしたとき」誘発（ロゼモン BT1-082 等）
      const _afterAtkTime = () => {
        // subject:"both"（お互いのターンでアタック時発動）の進化元効果をプレイヤー側で反応させる
        _hooks.fireOnAttackBothSubjectTriggers('ai', () => {
          // subject:"opp"（相手のデジモンがアタックしたとき）の進化元効果をプレイヤー側で反応させる
          _hooks.fireOnAttackOppSubjectTriggers('ai', () => {
            if (window._fireWhenOppAttack) {
              window._fireWhenOppAttack('ai', bs, { bs, addLog, renderAll, updateMemGauge }, cb);
            } else { cb(); }
          });
        });
      };
      // 常にスキャン（付与効果・誘発も拾う。効果が無ければ即コールバック）
      _hooks.checkAndTriggerEffect(atk, '【アタック時】', _afterAtkTime, 'ai');
    };

    const _afterAnnounce = () => {
    doAfterAtkEffect(() => {
      // アタック中のデジモンがバトルエリアを離れていれば、アタックは成立しない（公式ルール 11-2-7-4 / 11-5-1-4）
      const _aiCur = bs.ai.battleArea[atkIdx];
      if (!(_aiCur && (_aiCur === atk || (Array.isArray(_aiCur.stack) && _aiCur.stack.indexOf(atk) >= 0)))) {
        addLog('⚔ アタック中の「' + atk.name + '」がバトルエリアにいないので、アタックは成立しない');
        bs._redirectedAttack = null;
        renderAll();
        if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
        return;
      }
      // こちらの効果（【カウンター】の「アタックの対象を自分のデジモン1体に変更できる」等）でアタックの対象が変わっていれば、
      // ブロックの確認は出さずに変更先とバトルする（変更先はもう選んでいる。ユーザー決定事項）
      {
        const _ra = bs._redirectedAttack;
        bs._redirectedAttack = null;
        const _raDef = _ra && _ra.side === 'player' ? bs.player.battleArea[_ra.idx] : null;
        if (_raDef) {
          resolveBattleAI(atk, atkIdx, _raDef, _ra.idx, () => {
            if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
          });
          return;
        }
      }
      // ブロッカーチェック（cantBlockのカードは除外）
      // デバッグ: 各カードの判定結果をログ出力（カブテリモン等のブロック発動不具合調査用）
      console.log('[ブロック判定:AI攻撃時]', (bs.player.battleArea || []).map((c, i) => {
        if (!c) return null;
        return {
          idx: i, name: c.name, type: c.type,
          suspended: c.suspended, cantBlock: c.cantBlock,
          isBlocker: isBlocker(c),
          effectHasBlocker: !!(c._permEffects && c._permEffects.blocker),
          recipePreview: typeof c.recipe === 'string' ? c.recipe.slice(0, 80) : (c.recipe ? JSON.stringify(c.recipe).slice(0, 80) : '(なし)'),
          permEffectsBlocker: !!(c._permEffects && c._permEffects.blocker),
        };
      }));
      const blockerIndices = [];
      // 「ブロックされない」フラグ: アタッカーが cantBeBlocked なら全ブロック不可
      const atkCantBeBlocked = (atk && atk._permEffects && atk._permEffects.cantBeBlocked) || _cantRedirectAttack(atk);
      // 「進化元を持たないデジモンにはブロックされない」(イッカクモン等)
      const atkCantBeBlockedByNoEvo = atk && atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo;
      bs.player.battleArea.forEach((c, i) => {
        if (c && _canBlockNow(c) && isBlocker(c)) {
          if (atkCantBeBlocked) return; // ブロックされない: スキップ
          if (atkCantBeBlockedByNoEvo && (!c.stack || c.stack.length === 0)) return; // 進化元なしブロッカーは不可
          blockerIndices.push(i);
        }
      });

      if (blockerIndices.length > 0) {
        // チュートリアル: ブロック確認画面の前に割り込み
        // aiAttackPhase: 常にセキュリティアタック
        const _showBlock = () => { window._blockConfirmCands = blockerIndices; return showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
          if (doBlock) {
            if (blockerIndices.length === 1) {
              const blockerIdx = blockerIndices[0];
              const blocker = bs.player.battleArea[blockerIdx];
              blocker.suspended = true;
              addLog('🛡 「' + blocker.name + '」でブロック！');
              if (window._tutorialRunner && window._tutorialRunner.active) {
                try { window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'player' }); } catch (e) {}
              }
              renderAll();
              // プレイヤー側ブロッカーがレストした → AI 側 when_opp_rest + プレイヤー側 when_own_block 発火
              fireBlockReactionThen('player', () => {
                afterBlockedEffect(atk, atkIdx, 'ai', () => {
                  resolveBattleAI(atk, atkIdx, blocker, blockerIdx, () => {
                    if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
                  });
                });
              });
            } else {
              showBlockerSelection(blockerIndices, atk, (selectedIdx) => {
                if (selectedIdx !== null) {
                  const blocker = bs.player.battleArea[selectedIdx];
                  blocker.suspended = true;
                  addLog('🛡 「' + blocker.name + '」でブロック！');
                  if (window._tutorialRunner && window._tutorialRunner.active) {
                    try { window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'player' }); } catch (e) {}
                  }
                  renderAll();
                  fireBlockReactionThen('player', () => {
                    afterBlockedEffect(atk, atkIdx, 'ai', () => {
                      resolveBattleAI(atk, atkIdx, blocker, selectedIdx, () => {
                        if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
                      });
                    });
                  });
                } else {
                  doAiSecurityCheck(atk, atkIdx, callback);
                }
              });
            }
          } else {
            doAiSecurityCheck(atk, atkIdx, callback);
          }
        }, { type: 'security' }); };
        _showBlock();
        return;
      }
      doAiSecurityCheck(atk, atkIdx, callback);
    });
    };

    // 「進化元を持たない相手のデジモンにはブロックされない」等、アタック宣言時に
    // アナウンスしておきたい常在型能力（メタルシードラモン/イッカクモン等）。AI側アタック用。
    if (atk && atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo) {
      const _noEvoInfo = _getNoEvoBlockImmunityInfo(atk);
      if (_hasNoAnnounceOverride(_noEvoInfo.steps)) {
        _afterAnnounce();
      } else {
        _showEffectAnnounce(atk, _noEvoInfo.text, 'ai', () => { _afterAnnounce(); });
      }
    } else {
      _afterAnnounce();
    }
  });
  }); // fireOppRestThen
}

// ===== AIセキュリティチェック =====

export function doAiSecurityCheck(atk, atkIdx, callback, _remainingChecks) {
  _beginAttackResolution();
  showCombatBackdrop();
  // Sアタック+Nのチェック枚数は最初の呼び出し時にセットし、各チェックで -1
  if (_remainingChecks === undefined) {
    _remainingChecks = getSecurityAttackCount(atk);
    if (_remainingChecks > 1) {
      addLog('⚔ AI「' + atk.name + '」のセキュリティチェック x' + _remainingChecks + '！');
      // プレイヤーと同じく「⚔ セキュリティアタック+N！！」アナウンス演出を挟んでから開始
      showSAttackPlusAnnounce(_remainingChecks - 1, () =>
        doAiSecurityCheck(atk, atkIdx, callback, _remainingChecks)
      );
      return;
    }
  }
  // Sアタック-Nでチェック数が0になっている場合はセキュリティを捲らずアタック終了
  if (_remainingChecks === 0) {
    addLog('🛡 「' + atk.name + '」のセキュリティチェック数が0のため、セキュリティをチェックしません');
    showBattleResult('チェックなし', '#3399ff', _saMinusLabel(atk) + 'のため、セキュリティチェックできません', () => {
      hideCombatBackdrop();
      if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
    });
    return;
  }
  // _remainingChecks -1 にしてから1枚めくる。0になったら次のアタッカー/callback へ、残があればこの関数を再帰
  const _nextRemaining = Math.max(0, _remainingChecks - 1);
  const _checkNumber = (getSecurityAttackCount(atk) - _nextRemaining);
  // Sアタック+表示ラベル (複数チェックのみ)
  if (getSecurityAttackCount(atk) > 1) {
    const labelText = _checkNumber + '枚目';
    const old = document.getElementById('_sec-check-count-label');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const el = document.createElement('div');
    el.id = '_sec-check-count-label';
    const tutorialActive = !!(window._tutorialRunner && window._tutorialRunner.active);
    const animCss = tutorialActive ? '' : 'animation:secCheckLabel 2.5s ease forwards;';
    el.style.cssText = 'position:fixed;top:10%;left:50%;transform:translateX(-50%);z-index:60001;pointer-events:none;font-size:clamp(0.9rem,4vw,1.3rem);font-weight:700;color:#fff;background:rgba(0,0,0,0.7);padding:6px 18px;border-radius:8px;border:1px solid #aaa;text-align:center;' + animCss;
    el.innerText = labelText;
    document.body.appendChild(el);
    if (!tutorialActive) {
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
    }
  }
  // 次の接続: 残があれば同じアタッカーで続ける、なければ aiAttackPhase or callback
  const _afterOne = () => {
    if (_nextRemaining > 0 && bs.ai.battleArea[atkIdx] === atk && bs.player.security.length > 0) {
      setTimeout(() => doAiSecurityCheck(atk, atkIdx, callback, _nextRemaining), 500);
    } else if (bs._aiScriptInProgress) {
      callback && callback();
    } else {
      setTimeout(() => aiAttackPhase(callback), 800);
    }
  };
  if (bs.player.security.length > 0) {
    const sec = bs.player.security.splice(0, 1)[0];
    applySecurityBuffs(sec, 'player');
    // チュートリアル通知: 自分側セキュリティが削れた
    if (typeof window !== 'undefined' && window._tutorialRunner && window._tutorialRunner.active) {
      try { window._tutorialRunner.notifyEvent('security_reduced', { side: 'own', count: 1, remaining: bs.player.security.length }); } catch (e) {}
    }
    // 「セキュリティが減ったとき」はチェック（公開）のあとに解決する（総合ルール13-1-8）
    {
    showSecurityCheck(sec, atk, () => fireSecurityDecreaseThen('player', () => _secDigimonEffectFirst(sec, () => {
      if (_isSecurityDigimonCard(sec)) {
        if (atk.dp === sec.dp) {
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
          bs.player.trash.push(sec);
          showDestroyEffect(atk, () => {
            addLog('💥 両者消滅！'); renderAll();
            _fireDestroyChain(['ai'], _afterOne, { ai: atk });
          });
        } else if (sec.dp > atk.dp) {
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
          bs.player.trash.push(sec);
          showDestroyEffect(atk, () => {
            addLog('💥 「' + atk.name + '」が撃破された'); renderAll();
            _fireDestroyChain(['ai'], _afterOne, { ai: atk });
          });
        } else {
          bs.player.trash.push(sec);
          renderAll();
          showDestroyEffect(sec, () => {
            showBattleResult('Lost...', '#ff4444', 'セキュリティ突破された', () => {
              addLog('✓ セキュリティ突破');
              if (bs.player.security.length <= 0) addLog('🛡 自分のセキュリティが0枚になった');
              renderAll();
              _fireSecurityBattleWin(atk, 'ai', sec, _afterOne);
            }, 'Win!!', '#00ff88');
          });
        }
      } else if (sec.type === 'テイマー') {
        bs.player.tamerArea.push(sec);
        addLog('👤 テイマー「' + sec.name + '」がプレイヤーに登場');
        renderAll();
        // セキュリティから登場したテイマーの【登場時】効果を発動（高石タケル等）
        if (hasKeyword(sec, '【登場時】') || _hasRecipeTrigger(sec, 'on_play')) {
          const fireSecTamerOnPlay = (doneCb) => {
            _hooks.checkAndTriggerEffect(sec, '【登場時】', () => { renderAll(); doneCb && doneCb(); }, 'player');
          };
          // ≪貫通≫等でまだターンプレイヤー側(AI)の同時誘発効果が解決していない場合は、
          // この登場時効果をそちらが終わった後に合流させる（公式ルール15-4-3-3）
          if (bs._pendingNonTurnPlayerBattleTrigger) {
            const existingNonTurnPlayerPhase = bs._pendingNonTurnPlayerBattleTrigger;
            bs._pendingNonTurnPlayerBattleTrigger = (proceed) => { fireSecTamerOnPlay(() => existingNonTurnPlayerPhase(proceed)); };
            _afterOne();
          } else {
            fireSecTamerOnPlay(_afterOne);
          }
        } else {
          _afterOne();
        }
      } else {
        addLog('✦ セキュリティ効果：「' + sec.name + '」');
        const hasSecField = sec.securityEffect && sec.securityEffect.trim() && sec.securityEffect !== 'なし';
        const hasSecInEffect = _hasRecipeTrigger(sec, 'security');
        if (hasSecField || hasSecInEffect) {
          const secText = hasSecField ? sec.securityEffect : sec.effect;
          const originalEffect = sec.effect || '';
          if (hasSecField) {
            const secBlock = secText.includes('【セキュリティ】') ? secText : '【セキュリティ】' + secText;
            sec.effect = originalEffect + (originalEffect ? '\n' : '') + secBlock;
          }
          const afterSec = () => {
            const mentionsMain = /このカードの\s*【メイン】\s*効果/.test(secText);
            const doFinish = () => {
              sec.effect = originalEffect;
              if (sec._returnToHand) {
                delete sec._returnToHand;
                bs.player.hand.push(sec);
                addLog('🃏 「' + sec.name + '」を手札に加えた');
              } else if (!_isCardInAnyZone(sec, bs.player)) {
                // 【メイン】効果の発揮でバトルエリア等に置かれた（place_in_battle_area 等）ならトラッシュへ送らない
                bs.player.trash.push(sec);
              }
              renderAll();
              _afterOne();
            };
            // recipe の security に use_main_effect があれば既に main が実行済みなので二重発動防止
            let hasRecipe = false;
            if (sec.recipe) {
              if (typeof sec.recipe === 'string') {
                hasRecipe = sec.recipe.includes('use_main_effect');
              } else if (typeof sec.recipe === 'object' && Array.isArray(sec.recipe.security)) {
                hasRecipe = sec.recipe.security.some(s => s && s.action === 'use_main_effect');
              }
            }
            if (mentionsMain && originalEffect.includes('【メイン】') && !hasRecipe) {
              sec.effect = originalEffect;
              _hooks.checkAndTriggerEffect(sec, '【メイン】', doFinish, 'player');
            } else { doFinish(); }
          };
          hideCombatBackdrop(); // セキュリティ効果の対象選択UIが見えるようにバックドロップを一時解除
          _hooks.checkAndTriggerEffect(sec, '【セキュリティ】', afterSec, 'player');
        } else {
          bs.player.trash.push(sec); renderAll();
          _afterOne();
        }
      }
    }, 'player')));
    }
  } else {
    const aiAtk = bs.ai.battleArea.find(c => c !== null) || { name: 'AI', dp: 0 };
    showDirectAttack(aiAtk, 'ai', () => { battleDefeat(); });
  }
}

// ===== AI メインフェイズ =====

const AI_SCRIPTS = {
  1: { play: ['ベムモン', 'ベムモン'] },
};

function aiCanAct() { return bs.memory <= 0; }
function aiAvailableMemory() { return Math.abs(bs.memory); }

export function aiMainPhase(callback) {
  if (!aiCanAct()) { callback(); return; }
  const script = AI_SCRIPTS[bs.turn];
  if (script && script.play && script.play.length > 0) {
    aiPlayScript([...script.play], callback);
  } else {
    aiPlayAuto(callback);
  }
}

function aiPlayCard(c, handIdx, onDone) {
  // 「このカードを使用/登場するとき、〇〇することで、支払うコスト-N」（summon_cost のコスト付きエントリ。
  // 茨の女王 BT26-098 等）: CPU は払えるなら自動で使う（checkCostedSummonDiscount は side!=='player' なら確認なし）
  if (c && (c.playCost || 0) > 0) {
    let _called = false;
    _checkCostedSummonDiscount(c, bs, 'ai', _hooks.makeEffectContext(c, 'ai'), (disc) => {
      if (_called) return; _called = true;
      const _hi = bs.ai.hand.indexOf(c);
      _aiPlayCardMain(c, _hi !== -1 ? _hi : handIdx, onDone, disc || 0);
    }, { addLog, baseCost: c.playCost });
    return;
  }
  _aiPlayCardMain(c, handIdx, onDone, 0);
}

function _aiPlayCardMain(c, handIdx, onDone, costedDisc) {
  // コストを払った軽減量を差し引いた支払うコスト
  const _aiBasePay = Math.max(0, (c.playCost || 0) - (costedDisc || 0));
  let empty = bs.ai.battleArea.findIndex(s => s === null);
  if (empty === -1) { empty = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }

  if (c.type === 'オプション') {
    bs.ai.hand.splice(handIdx, 1);
    addLog('🤖 AIが「' + c.name + '」を使用！（コスト' + _aiBasePay + '）');
    renderAll();
    showOptionEffect(c, () => {
      const turnEnded = aiSpendMemory(_aiBasePay);
      _hooks.checkAndTriggerEffect(c, '【メイン】', () => {
        // 公式9-1-5: どの領域にも属していなければ破棄（バトルエリア等に置かれたら残す）
        if (!_isCardInAnyZone(c, bs.ai)) bs.ai.trash.push(c);
        renderAll(true);
        _afterOptionUsed('ai', () => onDone(turnEnded));
      }, 'ai');
    });
    return;
  }

  // ----- デュアルカード（AIはオプションとして使用。アーツ進化できるなら常に受け入れる） -----
  if (c.type === 'デュアル') {
    bs.ai.hand.splice(handIdx, 1);
    addLog('🤖 AIが「' + c.name + '」を使用！（コスト' + _aiBasePay + '）');
    renderAll();
    showOptionEffect(c, () => {
      const turnEnded = aiSpendMemory(_aiBasePay);
      _hooks.checkAndTriggerEffect(c, '【メイン】', () => {
        const candidates = _findArtsEvolveCandidates(c, 'ai');
        if (candidates.length > 0) {
          const evolved = _placeArtsEvolve(c, candidates[0], 'ai');
          if (hasKeyword(evolved, '【進化時】')) {
            _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
              _hooks.applyPermanentEffects('ai'); renderAll(true);
              onDone(turnEnded);
            }, 'ai');
            return;
          }
          _hooks.applyPermanentEffects('ai'); renderAll(true);
          onDone(turnEnded);
          return;
        }
        bs.ai.trash.push(c); renderAll(true);
        onDone(turnEnded);
      }, 'ai');
    });
    return;
  }

  if (c.type === 'テイマー') {
    bs.ai.hand.splice(handIdx, 1);
    if (window._freshOnFieldEnter) window._freshOnFieldEnter(c);
    bs.ai.tamerArea.push(c);
    addLog('🤖 AIが「' + c.name + '」を登場！（コスト' + _aiBasePay + '）');
    renderAll();
    showPlayEffect(c, () => {
      const turnEnded = aiSpendMemory(_aiBasePay);
      _hooks.applyPermanentEffects('ai');
      renderAll(); onDone(turnEnded);
    });
    return;
  }

  // 「登場するとき、このテイマーをレストさせることで、支払うコスト-N」（when_play。鷺坂ヒロコ BT26-088）:
  // CPU は使える効果を自動で使う（checkWhenPlayDiscount は side!=='player' なら確認なしで適用）
  let _aiWhenPlayDisc = 0;
  if (c.type === 'デジモン' && _aiBasePay > 0) {
    _checkWhenPlayDiscount(c, bs, 'ai', (d) => { _aiWhenPlayDisc = d || 0; }, { addLog, baseCost: _aiBasePay });
  }
  const _aiPayCost = Math.max(0, _aiBasePay - _aiWhenPlayDisc);
  if (window._freshOnFieldEnter) window._freshOnFieldEnter(c);
  c.summonedThisTurn = true;
  bs.ai.battleArea[empty] = c;
  bs.ai.hand.splice(handIdx, 1);
  addLog('🤖 AIが「' + c.name + '」を登場！（コスト' + _aiPayCost + '）');
  renderAll();
  showPlayEffect(c, () => {
    const turnEnded = aiSpendMemory(_aiPayCost);
    _hooks.applyPermanentEffects('ai');
    renderAll();
    // 【登場時】効果を発動 (公式ルール準拠)。支払いでレストしたカードの「レストしたとき」（エアドラモン LM-009）が
    // 保留中なら【登場時】が無くても誘発の処理を通す
    if (hasKeyword(c, '【登場時】') || _hasCostRestPending(bs)) {
      _hooks.checkAndTriggerEffect(c, '【登場時】', () => {
        renderAll(true);
        onDone(turnEnded);
      }, 'ai');
    } else {
      onDone(turnEnded);
    }
  });
}

function aiPlayScript(cardNames, callback) {
  if (cardNames.length === 0 || !aiCanAct()) { callback(); return; }
  const targetName = cardNames.shift();
  const handIdx = bs.ai.hand.findIndex(c => c.name === targetName && c.level !== '2' && c.playCost !== null);
  if (handIdx !== -1) {
    aiPlayCard(bs.ai.hand[handIdx], handIdx, (turnEnded) => {
      if (turnEnded) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayScript(cardNames, callback), 500);
    });
  } else {
    setTimeout(() => aiPlayScript(cardNames, callback), 100);
  }
}

function aiPlayAuto(callback) {
  if (!aiCanAct()) { callback(); return; }

  // ① 育成エリアで進化
  if (bs.ai.ikusei && bs.ai.ikusei.type === 'デジモン') {
    const ikuseiLv = parseInt(bs.ai.ikusei.level) || 0;
    const evoCandidate = bs.ai.hand.find(c =>
      c.type === 'デジモン' && parseInt(c.level) === ikuseiLv + 1 &&
      c.evolveCost !== null && c.evolveCost <= aiAvailableMemory()
    );
    if (evoCandidate) {
      const handIdx = bs.ai.hand.indexOf(evoCandidate);
      bs.ai.hand.splice(handIdx, 1);
      const oldCard = bs.ai.ikusei;
      // stack[0] = 直前の進化形（top）, stack[N-1] = デジタマ（bottom）の規約に統一
      evoCandidate.stack = [oldCard, ...(oldCard.stack || [])];
      // 進化しても同じ1体なので「登場したターン」は引き継ぐ（公式ルール 5-1-2-1。情報が失われるのはジョグレス進化だけ 8-2-2-1-7）
      evoCandidate.summonedThisTurn = !!oldCard.summonedThisTurn;
      evoCandidate.suspended = oldCard.suspended;
      evoCandidate.baseDp = parseInt(evoCandidate.dp) || 0;
      evoCandidate.dpModifier = 0; evoCandidate.buffs = [];
      bs.ai.ikusei = evoCandidate;
      addLog('🤖 AIが育成エリアで「' + oldCard.name + '」→「' + evoCandidate.name + '」に進化！');
      const turnEnded = aiSpendMemory(evoCandidate.evolveCost);
      renderAll();
      showEvolveEffect(evoCandidate.evolveCost, oldCard.name, oldCard, evoCandidate, () => {
        if (turnEnded) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 600);
      });
      return;
    }
  }

  // ② バトルエリアで進化
  for (let i = 0; i < bs.ai.battleArea.length; i++) {
    const base = bs.ai.battleArea[i];
    if (!base || (base.type !== 'デジモン' && base.type !== 'デュアル')) continue;
    const baseLv = parseInt(base.level) || 0;
    const evoCandidate = bs.ai.hand.find(c =>
      c.type === 'デジモン' && parseInt(c.level) === baseLv + 1 &&
      c.evolveCost !== null && c.evolveCost <= aiAvailableMemory()
    );
    if (evoCandidate) {
      const handIdx = bs.ai.hand.indexOf(evoCandidate);
      bs.ai.hand.splice(handIdx, 1);
      // stack[0] = 直前の進化形（top）, stack[N-1] = デジタマ（bottom）の規約に統一
      evoCandidate.stack = [base, ...(base.stack || [])];
      // 進化しても同じ1体なので「登場したターン」は引き継ぐ（公式ルール 5-1-2-1。情報が失われるのはジョグレス進化だけ 8-2-2-1-7）
      evoCandidate.summonedThisTurn = !!base.summonedThisTurn;
      evoCandidate.suspended = base.suspended;
      evoCandidate.baseDp = parseInt(evoCandidate.dp) || 0;
      evoCandidate.dpModifier = 0; evoCandidate.buffs = [];
      bs.ai.battleArea[i] = evoCandidate;
      addLog('🤖 AIが「' + base.name + '」→「' + evoCandidate.name + '」に進化！');
      const turnEnded = aiSpendMemory(evoCandidate.evolveCost);
      renderAll();
      showEvolveEffect(evoCandidate.evolveCost, base.name, base, evoCandidate, () => {
        _hooks.checkAndTriggerEffect(evoCandidate, '【進化時】', () => {
          _hooks.applyPermanentEffects('ai'); renderAll();
          if (turnEnded) { setTimeout(() => callback(), 500); return; }
          setTimeout(() => aiPlayAuto(callback), 600);
        }, 'ai');
      });
      return;
    }
  }

  const available = aiAvailableMemory();

  // ③ オプション/テイマー/デュアル（オプション・デュアルは場に同色が無ければ使用不可。使用条件を満たせば無視できる）
  const optionOrTamer = bs.ai.hand.find(c =>
    (c.type === 'オプション' || c.type === 'テイマー' || c.type === 'デュアル') &&
    c.playCost !== null && c.playCost <= available &&
    (c.type === 'テイマー' || hasMatchingColorInPlay(c, 'ai') || meetsUseCondition(c, 'ai') || _ignoresColorCondition(c, 'ai'))
  );
  if (optionOrTamer) {
    const handIdx = bs.ai.hand.indexOf(optionOrTamer);
    aiPlayCard(optionOrTamer, handIdx, (turnEnded) => {
      if (turnEnded) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 500);
    });
    return;
  }

  // ③' ［トラッシュ］【メイン】（ゾンビプルートモン BT26-079「このカードを支払うコスト-4で登場させる」等）。
  // 使える効果があり、支払うメモリーが足りるなら使う（同じカードはこのターン1回だけ試す＝無限ループ防止）
  const zoneMain = (window._getUsableZoneMainEffects ? window._getUsableZoneMainEffects('ai', 'trash') : [])
    .find(z => z && z.card && z.payCost <= available && z.card._aiZoneMainTurn !== bs.turn);
  if (zoneMain && window._activateZoneMainEffect) {
    zoneMain.card._aiZoneMainTurn = bs.turn;
    addLog('🤖 AIがトラッシュの「' + zoneMain.card.name + '」の効果を使用！');
    window._activateZoneMainEffect(zoneMain.card, 'ai', 'trash', () => {
      _hooks.applyPermanentEffects('ai');
      renderAll(true);
      if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 500);
    });
    return;
  }

  // ④ デジモン登場
  const playable = bs.ai.hand.filter(c =>
    c.type === 'デジモン' && c.level !== '2' && c.playCost !== null && c.playCost <= available
  );
  if (playable.length > 0) {
    playable.sort((a, b) => a.playCost - b.playCost);
    const c = playable[0];
    const handIdx = bs.ai.hand.indexOf(c);
    aiPlayCard(c, handIdx, (turnEnded) => {
      if (turnEnded) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 500);
    });
  } else {
    callback();
  }
}

// ===== ターン終了チェック =====

export async function checkPendingTurnEnd() {
  // 保険: アタック宣言のタイミングで止めるはずだったアタックが、止める前に終わった（アタックが成立しなかった等）なら、
  // アタックさせた効果をここで完了させる
  if (bs._attackDeclHoldReady || bs._attackDeclHold) {
    const _r = bs._attackDeclHoldReady; bs._attackDeclHoldReady = null; bs._attackDeclHold = false;
    if (typeof _r === 'function') { try { _r(); } catch (e) { console.error('[attackDeclHoldReady]', e); } }
  }
  // ≪貫通≫のセキュリティチェック中にアタックしたデジモンが消滅した等でここに来たら、キューの残りに戻る
  if (_resumeAfterPenetrate()) return;
  // 保険: 後回しにした非ターンプレイヤー側の効果が残っていれば、アタックを終える前に発揮する
  if (typeof window !== 'undefined' && window._hasNonTurnDeferred && window._hasNonTurnDeferred()) {
    await new Promise((resolve) => window._flushNonTurnDeferred(resolve));
  }
  _attackInProgress = false;
  bs._attackResolving = false;
  // 「そのアタックの終了まで」（≪連携≫のDP+・Sアタック+1）のバフをここで外す
  _expireBuffs(bs, 'dur_until_attack_end');
  // アタックが終わればバトルも終わっている: 「バトル終了まで」（≪プログレス≫の「アタック中、相手の効果を受けない」等）も外す
  // （セキュリティデジモンとのバトルやバトルの無いアタックでは外れずに残っていた）
  _expireBuffs(bs, 'dur_until_battle_end');
  hideCombatBackdrop();
  // アタック中に保留していた DP0 の消滅（ルールチェック）を、アタックの処理が全て終わったここで行う
  if (typeof window !== 'undefined' && typeof window._runRuleDestroyCheckNow === 'function') {
    await new Promise((resolve) => window._runRuleDestroyCheckNow(resolve));
  }
  // バトル中の「離れるとき」等で保留した「〜したとき」の反応（【デコード】で登場したデジモンの【登場時】等）を処理する
  if (typeof window !== 'undefined' && typeof window._drainPendingReactions === 'function') {
    await new Promise((resolve) => window._drainPendingReactions(resolve));
  }
  // 相手の端末にもアタックの終了を伝える（相手側で保留している DP0 の消滅をここで行ってもらう）
  if (_onlineMode && _sendCommand) { try { _sendCommand({ type: 'attack_end' }); } catch (_) {} }
  // アタックが終わったので【衝突】のブロッカーを外す
  if (typeof window !== 'undefined' && window._clearCollisionBlockers) window._clearCollisionBlockers(bs);
  renderAll();
  // バトル中の「離れるとき」で進化して保留していた【進化時】を、バトルの消滅処理が終わったここで発揮する
  // （ターンプレイヤー＝自分の分を先に、相手の端末に残っている分を後に）
  if (Array.isArray(bs._deferredEvoTriggers) && bs._deferredEvoTriggers.length > 0) {
    await new Promise((resolve) => flushDeferredEvoTriggers(resolve));
  }
  if (bs._oppDeferredEvoPending && typeof window._flushOppDeferredEvo === 'function') {
    await new Promise((resolve) => window._flushOppDeferredEvo(resolve));
  }
  // チュートリアル通知: バトル解決完了（attack_resolved 条件用）
  if (window._tutorialRunner && window._tutorialRunner.active) {
    try {
      window._tutorialRunner.notifyEvent('attack_resolved', {
        side: bs.isPlayerTurn ? 'player' : 'ai',
        isDirect: !!bs._lastAttackIsDirect,
      });
    } catch (_) {}
  }
  // 解決完了 → isDirect フラグをリセット
  bs._lastAttackIsDirect = false;
  // チュートリアル割り込み: アタック後 → 終了後にキュー中の成功演出 flush
  if (window._tutorialRunner && window._tutorialRunner.active) {
    const atkKey = bs.isPlayerTurn ? 'after_attack' : 'opp_after_attack';
    await window._tutorialRunner.checkInterrupt(atkKey);
    if (window._tutorialFlushSuccess) {
      try { await window._tutorialFlushSuccess(); } catch (_) {}
    }
    // 全工程完了 → 次ステップ表示を解放
    if (window._tutorialBattleDone) window._tutorialBattleDone();
  }
  // 【自分のターン終了時】の効果（≪急襲≫）によるアタックが終わった → その効果（とターン終了処理）を再開する
  if (Array.isArray(bs._effectAttackResolveCbs) && bs._effectAttackResolveCbs.length > 0) {
    const cbs = bs._effectAttackResolveCbs.splice(0);
    cbs.forEach(cb => { try { cb(); } catch (e) { console.error('[effectAttackResolve]', e); } });
    return;
  }
  // アタック中に発揮されて保留していた「そのデジモンでアタックできる」（ブテンモン BT26-015 等）を、
  // ターン終了判定より先に行う。新しいアタックを宣言したら、その終了時に再びここへ来る
  if (Array.isArray(bs._pendingEffectAttacks) && bs._pendingEffectAttacks.length > 0 && typeof window._runPendingEffectAttack === 'function') {
    window._runPendingEffectAttack(bs, (started) => { if (!started) checkPendingTurnEndOnly(); });
    return;
  }
  if (bs._pendingTurnEnd) {
    bs._pendingTurnEnd = false;
    checkAutoTurnEnd();
  }
}

// checkPendingTurnEnd からアタック解決の付随処理（_attackInProgress解除・
// combat backdrop非表示・チュートリアル通知等）を除いた、判定部分のみの版。
// 非ターンプレイヤー側の反応キュー(_pendingNonTurnPlayerReactions)がドレインを
// 終えたタイミング等、アタック解決の文脈外からも安全に呼べるようにするため
// battle-online.js に公開する（相手機に委譲された消滅時効果等が、通常の
// checkPendingTurnEnd呼び出し地点より後に解決してターンを持ち越されるのを防ぐ）
function checkPendingTurnEndOnly() {
  if (bs._pendingTurnEnd) {
    bs._pendingTurnEnd = false;
    delete bs._actionDeferTurnEnd;
    checkAutoTurnEnd();
  }
}
if (typeof window !== 'undefined') window._checkPendingTurnEndOnly = checkPendingTurnEndOnly;

// ===== 勝敗判定 =====

export function battleVictory() {
  const wasOnline = _onlineMode;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'game_end', result: 'defeat' });
  showGameEndOverlay('🎉 勝利！', 'victory', () => {
    cleanupBattle();
    if (wasOnline && window._cleanupOnline) window._cleanupOnline();
    // position:fixedの残りを念のため全消し（勝利オーバーレイの残骸含む）
    document.querySelectorAll('body > div[style*="position:fixed"]').forEach(el => {
      if (!el.classList.contains('screen')) el.remove();
    });
    if (window._onGameEnd) { window._onGameEnd(); return; }
    showScreen(wasOnline ? 'room-entrance-screen' : 'tutorial-screen');
  });
}

export function battleDefeat() {
  const wasOnline = _onlineMode;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'game_end', result: 'victory' });
  showGameEndOverlay('😢 敗北...', 'defeat', () => {
    cleanupBattle();
    if (wasOnline && window._cleanupOnline) window._cleanupOnline();
    document.querySelectorAll('body > div[style*="position:fixed"]').forEach(el => {
      if (!el.classList.contains('screen')) el.remove();
    });
    if (window._onGameEnd) { window._onGameEnd(); return; }
    showScreen(wasOnline ? 'room-entrance-screen' : 'tutorial-screen');
  });
}

function cleanupBattle() {
  bs._battleAborted = true;
}

// =====================================================
//  戦闘演出
// =====================================================

// ----- 登場演出 -----

// 登場・進化の演出は同じ画面部品（evolve-overlay）とタイマーを使うので、重なったら前の演出が終わってから次を再生する。
// 以前は後から始まった演出が前の演出の終了処理（タイマー）を消し、表示が途中のまま止まって画面が真っ暗になっていた
// （ユノモン：ヒステリックモードの【デコード】で進化元のパンプモンを登場させたとき）
// 演出の部品がページ内の別の箱（重なり順を持つ要素）の中にあると、ページ直下のバトルの黒い背景（_combat-backdrop）より
// 奥に描かれてしまう（z-index はその箱の中でしか効かない）。表示するときにページ直下へ移す
// （エグゼキュートのアタック直後、【デコード】で登場したパンプモンの登場演出が黒い背景に隠れていた）
function _overlayToBody(el) {
  try { if (el && el.parentNode !== document.body) document.body.appendChild(el); } catch (_) {}
}
if (typeof window !== 'undefined') window._overlayToBody = _overlayToBody;
// ページ内の箱の中に置かれている演出の部品（登場・進化／コスト軽減の演出）は、読み込んだ時点でページ直下へ移す
if (typeof document !== 'undefined') {
  const _mvOverlays = () => ['evolve-overlay', 'cost-effect-overlay'].forEach(id => _overlayToBody(document.getElementById(id)));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _mvOverlays); else _mvOverlays();
}
let _evoOverlayBusy = false;
const _evoOverlayQueue = [];
function _evoOverlayRun(fn) {
  if (_evoOverlayBusy) { console.log('[playFx] 前の演出の終了待ち（順番待ち' + (_evoOverlayQueue.length + 1) + '件目）'); _evoOverlayQueue.push(fn); return; }
  _evoOverlayBusy = true;
  let ended = false;
  const end = () => {
    if (ended) return; ended = true; clearTimeout(safety);
    _evoOverlayBusy = false;
    const nx = _evoOverlayQueue.shift();
    if (nx) _evoOverlayRun(nx);
  };
  const safety = setTimeout(end, 6000);
  try { fn(end); } catch (e) { console.error('[evoOverlay]', e); end(); }
}
export function showPlayEffect(card, onDone0) {
  // デジクロスで登場: 素材が交差して1体になる演出（_offerDigixros が card._digixrossMats を付ける。相手の画面は play コマンドの digixrossMats）
  if (card && Array.isArray(card._digixrossMats) && card._digixrossMats.length > 0) {
    const mats = card._digixrossMats;
    delete card._digixrossMats;
    _evoOverlayRun((end) => {
      try { fxDigixrossFusion(mats, card, card._costReduction != null ? (card.playCost - card._costReduction) : null, () => { end(); onDone0 && onDone0(); }); }
      catch (_) { end(); onDone0 && onDone0(); }
    });
    return;
  }
  _evoOverlayRun((end) => _showPlayEffectBody(card, () => { end(); onDone0 && onDone0(); }));
}
function _showPlayEffectBody(card, onDone) {
  const overlay = document.getElementById('evolve-overlay');
  if (!overlay) { onDone && onDone(); return; }
  _overlayToBody(overlay);
  const flash = document.getElementById('evo-flash'), label = document.getElementById('evo-label'),
    imgEl = document.getElementById('evo-card-img'), nameEl = document.getElementById('evo-card-name'),
    costEl = document.getElementById('evo-cost-text'), effectEl = document.getElementById('evo-effect-text');

  label.style.opacity = '0'; imgEl.style.opacity = '0'; imgEl.style.transform = 'scale(0.7)';
  nameEl.style.opacity = '0'; costEl.style.opacity = '0'; costEl.style.transform = 'scale(0.5)';
  effectEl.style.opacity = '0'; effectEl.style.display = 'none'; flash.style.opacity = '0';

  const src = cardImg(card);
  imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ffaa00;font-size:10px;padding:8px;">${card.name}</div>`;
  nameEl.innerText = card.name;
  const isOption = card.type === 'オプション';
  if (card._costReduction) {
    costEl.innerText = (card.playCost - card._costReduction) + ' コストで' + (isOption ? '使用！！' : '登場！！');
    delete card._costReduction;
  } else {
    costEl.innerText = card.playCost + ' コストで' + (isOption ? '使用！！' : '登場！！');
  }
  imgEl.style.borderColor = '#ffaa00'; imgEl.style.boxShadow = '0 0 40px rgba(255,170,0,0.8)';
  costEl.style.color = '#ffaa00'; costEl.style.textShadow = '0 0 20px rgba(255,170,0,0.8)';
  label.style.color = isOption ? '#aa66ff' : '#ffaa00';
  label.innerText = isOption ? 'OPTION ACTIVATE' : 'DIGITAL APPEAR';
  overlay.style.display = 'flex';

  setTimeout(() => { flash.style.transition = 'opacity 0.1s'; flash.style.opacity = '0.9';
    setTimeout(() => { flash.style.transition = 'opacity 0.3s'; flash.style.opacity = '0'; label.style.opacity = '1'; imgEl.style.opacity = '1'; imgEl.style.transform = 'scale(1)'; nameEl.style.opacity = '1';
      setTimeout(() => { costEl.style.opacity = '1'; costEl.style.transform = 'scale(1)'; }, 300);
    }, 150);
  }, 50);
  clearTimeout(window._evoTimer);
  window._evoTimer = setTimeout(() => { overlay.style.display = 'none'; onDone && onDone(); }, 2500);
}

// ----- 進化演出 -----

// opts.arts: アーツ進化（デュアルカード BT26-056 等）の演出。通常の進化と見分けられるよう、金色で
// 「ARTS EVOLUTION」と出し、カードを2回転させて光の輪を広げる
export function showEvolveEffect(cost, baseName, baseCard, evolvedCard, onDone0, opts) {
  _evoOverlayRun((end) => _showEvolveEffectBody(cost, baseName, baseCard, evolvedCard, () => { end(); onDone0 && onDone0(); }, opts));
}
function _showEvolveEffectBody(cost, baseName, baseCard, evolvedCard, onDone, opts) {
  const _arts = !!(opts && opts.arts);
  const overlay = document.getElementById('evolve-overlay');
  if (!overlay) { onDone && onDone(); return; }
  _overlayToBody(overlay);
  const flash = document.getElementById('evo-flash'), label = document.getElementById('evo-label'),
    imgEl = document.getElementById('evo-card-img'), nameEl = document.getElementById('evo-card-name'),
    costEl = document.getElementById('evo-cost-text'), effectEl = document.getElementById('evo-effect-text');

  const isLv6 = !_arts && parseInt(evolvedCard.level) >= 6;
  label.style.opacity = '0'; nameEl.style.opacity = '0'; costEl.style.opacity = '0'; costEl.style.transform = 'scale(0.5)';
  effectEl.style.display = 'none'; flash.style.opacity = '0';

  const evoColor = _arts ? '#ffcc00' : (isLv6 ? '#ff00fb' : '#00ff88');
  imgEl.style.borderColor = evoColor;
  imgEl.style.boxShadow = `0 0 ${isLv6 ? 80 : 40}px ${evoColor}${isLv6 ? ', 0 0 150px ' + evoColor + '66' : ''}`;
  label.style.color = evoColor; label.innerText = _arts ? '✦ ARTS EVOLUTION ✦' : (isLv6 ? '★ MEGA EVOLUTION ★' : 'DIGITAL EVOLUTION');
  label.style.fontSize = (isLv6 || _arts) ? '1.1rem' : '0.9rem';
  costEl.style.color = evoColor; costEl.style.textShadow = `0 0 20px ${evoColor}`;
  if (evolvedCard._costReduction) {
    delete evolvedCard._costReduction;
  }
  costEl.innerText = _arts ? 'アーツ進化！！' : (cost + ' コスト進化！！');

  imgEl.style.transition = 'none'; imgEl.style.transform = 'scale(1) rotate(0deg)'; imgEl.style.opacity = '1';
  const baseSrc = cardImg(baseCard);
  imgEl.innerHTML = baseSrc ? `<img src="${baseSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#aaa;font-size:10px;padding:8px;">${baseName}</div>`;
  overlay.style.display = 'flex';

  setTimeout(() => {
    imgEl.style.transition = 'opacity 0.4s, transform 0.4s';
    imgEl.style.transform = `scale(0.3) rotate(${(isLv6 || _arts) ? 720 : 360}deg)`; imgEl.style.opacity = '0';
    setTimeout(() => {
      flash.style.transition = 'opacity 0.1s'; flash.style.opacity = isLv6 ? '1' : '0.95';
      setTimeout(() => {
        flash.style.transition = 'opacity 0.2s'; flash.style.opacity = '0';
        nameEl.innerText = evolvedCard.name;
        const evoSrc = cardImg(evolvedCard);
        imgEl.innerHTML = evoSrc ? `<img src="${evoSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:${evoColor};font-size:10px;padding:8px;">${evolvedCard.name}</div>`;
        imgEl.style.transition = 'none'; imgEl.style.transform = `scale(${isLv6 ? 1.4 : 1.2}) rotate(-10deg)`; imgEl.style.opacity = '1';
        if (_arts) {
          // アーツ進化: 金色の光の輪を2重に広げる
          [0, 180].forEach((d) => setTimeout(() => {
            const ring = document.createElement('div');
            ring.style.cssText = 'position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px 0 0 -30px;border:3px solid #ffcc00;border-radius:50%;box-shadow:0 0 25px #ffcc00,inset 0 0 15px #ffcc0088;pointer-events:none;transition:transform 0.8s ease-out,opacity 0.8s ease-out;opacity:1;transform:scale(0.5);z-index:1;';
            overlay.appendChild(ring);
            requestAnimationFrame(() => { ring.style.transform = 'scale(6)'; ring.style.opacity = '0'; });
            setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 900);
          }, d));
        }
        setTimeout(() => { imgEl.style.transition = 'transform 0.25s'; imgEl.style.transform = 'scale(1) rotate(0deg)'; label.style.opacity = '1'; nameEl.style.opacity = '1';
          setTimeout(() => { costEl.style.opacity = '1'; costEl.style.transform = 'scale(1)'; }, 150);
        }, 50);
      }, 120);
    }, 400);
  }, 300);
  clearTimeout(window._evoTimer);
  window._evoTimer = setTimeout(() => { overlay.style.display = 'none'; onDone && onDone(); }, (isLv6 || _arts) ? 2500 : 1800);
}

// ----- オプション使用演出 -----

export function showOptionEffect(card, onDone) {
  // 表示するコスト（効果で軽減したら軽減後）。相手の画面にも同じコストを出す
  const _shownCost = card._costReduction ? (card.playCost - card._costReduction) : card.playCost;
  if (_onlineMode && _sendCommand && !window._suppressFxSend) _sendCommand({ type: 'fx_option', cardName: card.name, cardImg: cardImg(card), cost: _shownCost });
  const overlay = document.getElementById('option-overlay');
  if (!overlay) { onDone && onDone(); return; }
  const flash = document.getElementById('option-flash');
  const particles = document.getElementById('option-particles');
  const label = document.getElementById('option-label');
  const imgEl = document.getElementById('option-card-img');
  const nameEl = document.getElementById('option-card-name');
  const costEl = document.getElementById('option-cost-text');

  flash.style.opacity = '0'; label.style.opacity = '0'; nameEl.style.opacity = '0'; costEl.style.opacity = '0';
  imgEl.style.opacity = '0'; imgEl.style.transform = 'scale(0.7)'; particles.innerHTML = '';

  const src = cardImg(card);
  imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#aa66ff;padding:8px;">${card.name}</div>`;
  imgEl.style.animation = 'optionGlow 1s ease-in-out infinite';
  nameEl.innerText = card.name;
  delete card._costReduction;
  costEl.innerText = (_shownCost != null && !isNaN(_shownCost)) ? _shownCost + ' コストで使用！' : '使用！';
  overlay.style.display = 'flex';

  setTimeout(() => { flash.style.opacity = '1'; }, 50);
  setTimeout(() => { flash.style.opacity = '0'; label.style.opacity = '1'; }, 200);
  setTimeout(() => { imgEl.style.opacity = '1'; imgEl.style.transform = 'scale(1)'; }, 400);
  setTimeout(() => { nameEl.style.opacity = '1'; costEl.style.opacity = '1'; }, 700);
  setTimeout(() => {
    const colors = ['#aa66ff', '#cc88ff', '#7733ff', '#fff', '#ddaaff'];
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      const px = -60 + Math.random() * 120, py = -(50 + Math.random() * 150);
      const size = 3 + Math.random() * 6;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const delay = Math.random() * 0.3;
      p.style.cssText = `position:absolute;left:50%;top:55%;width:${size}px;height:${size}px;background:${color};border-radius:50%;box-shadow:0 0 ${size + 2}px ${color};--px:${px}px;--py:${py}px;animation:optionParticle 1s ease-out ${delay}s forwards;opacity:0;`;
      setTimeout(() => { p.style.opacity = '1'; }, delay * 1000);
      particles.appendChild(p);
    }
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);border:2px solid #aa66ff;border-radius:50%;animation:optionRing 0.8s ease-out forwards;';
    particles.appendChild(ring);
  }, 500);
  setTimeout(() => { overlay.style.display = 'none'; imgEl.style.animation = ''; onDone && onDone(); }, 2500);
}

// ----- セキュリティチェック演出 -----

export function showSecurityCheck(secCard, atkCard, callback, customLabel, onOpen) {
  if (_onlineMode && _sendCommand && !window._suppressFxSend) {
    // バフ付きカードを受信側でも「元値+バフ」表示できるよう、baseDpを送る
    const secBase = parseInt(secCard._origDp != null ? secCard._origDp : (secCard.baseDp != null ? secCard.baseDp : secCard.dp)) || 0;
    const atkBase = parseInt(atkCard._origDp != null ? atkCard._origDp : (atkCard.baseDp != null ? atkCard.baseDp : atkCard.dp)) || 0;
    _sendCommand({ type: 'fx_securityCheck', secName: secCard.name || '', secImg: cardImg(secCard), secCardNo: secCard.cardNo || '', secDp: parseInt(secCard.dp) || 0, secBaseDp: secBase, secType: secCard.type || '', atkName: atkCard.name || '', atkImg: cardImg(atkCard), atkCardNo: atkCard.cardNo || '', atkDp: parseInt(atkCard.dp) || 0, atkBaseDp: atkBase, customLabel: customLabel || '' });
  }
  const overlay = document.getElementById('security-check-overlay');
  if (!overlay) { callback && callback(); return; }

  const label = document.getElementById('sec-check-label');
  const atkImgEl = document.getElementById('sec-atk-card-img');
  const atkNameEl = document.getElementById('sec-atk-name');
  const atkDpEl = document.getElementById('sec-atk-dp');
  const imgEl = document.getElementById('sec-check-card-img');
  const nameEl = document.getElementById('sec-check-card-name');
  const typeEl = document.getElementById('sec-check-type');
  const resultEl = document.getElementById('sec-check-result');

  label.style.opacity = '0';
  atkImgEl.style.opacity = '0'; atkNameEl.style.opacity = '0'; atkDpEl.style.opacity = '0';
  imgEl.style.opacity = '0'; imgEl.style.transform = 'rotateY(180deg)';
  nameEl.style.opacity = '0'; typeEl.style.opacity = '0'; resultEl.style.opacity = '0'; resultEl.style.transform = 'scale(0.5)';

  const atkSrc = cardImg(atkCard);
  atkImgEl.innerHTML = atkSrc ? `<img src="${atkSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#00fbff;padding:8px;">${atkCard.name}</div>`;
  atkNameEl.innerText = atkCard.name;
  atkDpEl.innerText = 'DP: ' + formatDpDisplay(atkCard);

  const src = cardImg(secCard);
  imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#fff;padding:8px;">${secCard.name}</div>`;
  nameEl.innerText = secCard.name;
  const isDigimon = _isSecurityDigimonCard(secCard);
  const isOption = secCard.type === 'オプション';
  const isTamer = secCard.type === 'テイマー';
  typeEl.innerText = isDigimon ? 'DP: ' + formatDpDisplay(secCard) : isOption ? 'セキュリティ効果' : isTamer ? 'テイマー登場' : '';

  label.innerText = customLabel || 'SECURITY CHECK!';
  overlay.style.display = 'flex';
  if (onOpen) onOpen();

  setTimeout(() => { label.style.opacity = '1'; }, 100);
  setTimeout(() => { atkImgEl.style.opacity = '1'; atkNameEl.style.opacity = '1'; atkDpEl.style.opacity = '1'; }, 300);
  setTimeout(() => { imgEl.style.opacity = '1'; imgEl.style.transform = 'rotateY(0deg)'; }, 700);
  setTimeout(() => { nameEl.style.opacity = '1'; typeEl.style.opacity = '1'; }, 1100);

  let resultText = '', resultColor = '';
  if (isOption) { resultText = 'セキュリティ効果発動'; resultColor = '#ffaa00'; }
  else if (isTamer) { resultText = 'テイマー登場'; resultColor = '#00fbff'; }
  else if (!isDigimon) { resultText = 'トラッシュへ'; resultColor = '#888'; }

  // チュートリアル: VS画面の割り込み（カード表示後、結果表示前にメッセージ挿入）
  const tutRunner = window._tutorialRunner;
  const _removeCountLabel = () => {
    const cl = document.getElementById('_sec-check-count-label');
    if (cl && cl.parentNode) cl.parentNode.removeChild(cl);
  };
  if (tutRunner && tutRunner.active && typeof tutRunner.checkInterrupt === 'function') {
    setTimeout(async () => {
      const vsKey = bs.isPlayerTurn ? 'battle_vs' : 'opp_battle_vs';
      await tutRunner.checkInterrupt(vsKey);
      resultEl.innerText = resultText; resultEl.style.color = resultColor;
      resultEl.style.textShadow = `0 0 20px ${resultColor}`;
      resultEl.style.opacity = '1'; resultEl.style.transform = 'scale(1)';
      setTimeout(() => { overlay.style.display = 'none'; _removeCountLabel(); callback && callback(); }, 1300);
    }, 1500);
  } else {
    setTimeout(() => { resultEl.innerText = resultText; resultEl.style.color = resultColor; resultEl.style.textShadow = `0 0 20px ${resultColor}`; resultEl.style.opacity = '1'; resultEl.style.transform = 'scale(1)'; }, 1500);
    setTimeout(() => { overlay.style.display = 'none'; _removeCountLabel(); callback && callback(); }, 2800);
  }
}

// ----- バトル結果演出 -----

export function showBattleResult(text, color, sub, callback, oppText, oppColor) {
  if (_onlineMode && _sendCommand && !window._suppressFxSend) _sendCommand({ type: 'fx_battleResult', text: oppText || text, color: oppColor || color, sub });
  const overlay = document.getElementById('battle-result-overlay');
  if (!overlay) { callback && callback(); return; }
  const textEl = document.getElementById('battle-result-text');
  const subEl = document.getElementById('battle-result-sub');
  textEl.innerText = text; textEl.style.color = color;
  textEl.style.textShadow = `0 0 30px ${color}, 0 0 60px ${color}`;
  textEl.style.opacity = '0'; textEl.style.transform = 'scale(0.5)';
  subEl.innerText = sub || ''; subEl.style.opacity = '0';
  overlay.style.display = 'flex'; overlay.style.background = 'rgba(0,0,0,0.7)';
  setTimeout(() => { textEl.style.opacity = '1'; textEl.style.transform = 'scale(1)'; setTimeout(() => { subEl.style.opacity = '1'; }, 200); }, 50);
  setTimeout(() => { overlay.style.display = 'none'; callback && callback(); }, 1500);
}

// ----- 消滅演出 -----

export function showDestroyEffect(card, callback) {
  // 1つの効果でまとめて消滅させている間（window._destroyFxBatch）は1体ずつの演出を出さず、
  // 最後に「以下のN体が消滅」の一括演出（showDestroyBatch）で見せる
  // まとめるのはこの画面で実際に場から消滅したカードだけ（相手の画面から届いた演出＝_remoteFx の仮カードや、
  // カードNoを持たない仮カードは含めない。相手の画面の分まで合計して、相手のカードがこちらの一覧に出ていた）
  const _batch = (typeof window !== 'undefined') ? window._destroyFxBatch : null;
  if (_batch && card && !card._remoteFx && card.cardNo) { _batch.gone.push(card); callback && callback(); return; }
  if (_onlineMode && _sendCommand && !window._suppressFxSend) _sendCommand({ type: 'fx_destroy', cardName: card.name, cardImg: cardImg(card) });
  const overlay = document.getElementById('destroy-overlay');
  if (!overlay) { callback && callback(); return; }
  const imgEl = document.getElementById('destroy-card-img');
  const nameEl = document.getElementById('destroy-card-name');
  const labelEl = document.getElementById('destroy-label');
  const flashEl = document.getElementById('destroy-flash');
  const particlesEl = document.getElementById('destroy-particles');

  imgEl.style.opacity = '0'; imgEl.style.animation = '';
  nameEl.style.opacity = '0'; labelEl.style.opacity = '0';
  flashEl.style.opacity = '0'; flashEl.style.animation = '';
  particlesEl.innerHTML = '';

  const src = cardImg(card);
  imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ff4444;padding:8px;">${card.name}</div>`;
  nameEl.innerText = card.name;
  overlay.style.display = 'flex';

  setTimeout(() => { imgEl.style.opacity = '1'; imgEl.style.animation = 'destroyShake 0.6s ease'; }, 50);
  setTimeout(() => {
    flashEl.style.animation = 'destroyFlash 0.8s ease forwards';
    const colors = ['#fff', '#fff', '#ff4444', '#ff8800', '#ffcc00', '#fff', '#ff6666'];
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 180;
      const px = Math.cos(angle) * dist, py = Math.sin(angle) * dist;
      const size = 3 + Math.random() * 10;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const delay = Math.random() * 0.15;
      const dur = 0.5 + Math.random() * 0.5;
      p.style.cssText = `position:absolute;left:50%;top:45%;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random() > 0.5 ? '50%' : '2px'};box-shadow:0 0 ${size}px ${color};--px:${px}px;--py:${py}px;animation:destroyParticle ${dur}s ease-out ${delay}s forwards;opacity:0;animation-fill-mode:forwards;`;
      setTimeout(() => { p.style.opacity = '1'; }, delay * 1000);
      particlesEl.appendChild(p);
    }
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);border:3px solid rgba(255,255,255,0.8);border-radius:50%;animation:destroyShockwave 0.6s ease-out forwards;pointer-events:none;';
    particlesEl.appendChild(ring);
    nameEl.style.opacity = '1'; labelEl.style.opacity = '1';
    imgEl.style.animation = 'destroyExplode 0.8s ease forwards';
  }, 700);
  setTimeout(() => { overlay.style.display = 'none'; imgEl.style.animation = ''; flashEl.style.animation = ''; callback && callback(); }, 1900);
}

// ----- 複数体の一括消滅演出 -----
// 「〜全てを消滅させる」等で2体以上が消滅したとき、1体ずつではなく一覧で1回だけ見せる（時短）。
// cards: [{name, imgSrc}] / opts.remote: 相手から受信した表示（送り返さない）
export function showDestroyBatch(cards, callback, opts) {
  opts = opts || {};
  const list = (cards || []).filter(Boolean);
  if (list.length === 0) { callback && callback(); return; }
  if (!opts.remote && _onlineMode && _sendCommand && !window._suppressFxSend) {
    _sendCommand({ type: 'fx_destroyBatch', cards: list.map(c => ({ name: c.name || '', imgSrc: cardImg(c) || '' })) });
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:66000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;pointer-events:none;';
  const title = document.createElement('div');
  title.style.cssText = 'color:#ff4444;font-size:clamp(1rem,4.5vw,1.4rem);font-weight:900;letter-spacing:2px;text-shadow:0 0 16px #ff4444;';
  title.innerText = '💥 以下の' + list.length + '体が消滅';
  overlay.appendChild(title);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:92vw;';
  const w = list.length > 6 ? 56 : 72;
  const cells = list.map((c) => {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;width:' + w + 'px;';
    const src = c.imgSrc && !/^https?:/.test(String(c.name)) ? (cardImg(c) || c.imgSrc) : cardImg(c);
    cell.innerHTML = '<div class="_dbimg" style="width:' + w + 'px;height:' + Math.round(w * 1.4) + 'px;border-radius:5px;overflow:hidden;border:2px solid #ff4444;box-shadow:0 0 10px #ff444488;">'
      + (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#ff4444;font-size:9px;padding:4px;">' + (c.name || '') + '</div>') + '</div>'
      + '<div style="color:#fff;font-size:9px;text-align:center;line-height:1.2;max-width:' + w + 'px;overflow:hidden;">' + (c.name || '') + '</div>';
    grid.appendChild(cell);
    return cell;
  });
  overlay.appendChild(grid);
  document.body.appendChild(overlay);
  setTimeout(() => { cells.forEach(cell => { const im = cell.querySelector('._dbimg'); if (im) im.style.animation = 'destroyShake 0.6s ease'; }); }, 300);
  setTimeout(() => { cells.forEach(cell => { const im = cell.querySelector('._dbimg'); if (im) { im.style.transition = 'all 0.5s ease'; im.style.opacity = '0'; im.style.transform = 'scale(1.3)'; im.style.filter = 'brightness(3)'; } }); }, 1000);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 1800);
}

// ----- ダイレクトアタック演出 -----

export function showDirectAttack(atkCard, side, callback) {
  if (_onlineMode && _sendCommand && !window._suppressFxSend) _sendCommand({ type: 'fx_directAttack', atkName: atkCard.name, atkImg: cardImg(atkCard), side });
  hideCombatBackdrop();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:48000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:clamp(1.2rem,5vw,1.8rem);font-weight:900;color:#ff0000;letter-spacing:4px;text-shadow:0 0 30px #ff0000,0 0 60px #ff0000;margin-bottom:20px;opacity:0;transition:opacity 0.3s;';
  label.innerText = 'DIRECT ATTACK!!';
  overlay.appendChild(label);

  const cardRow = document.createElement('div');
  cardRow.style.cssText = 'display:flex;gap:24px;align-items:center;';
  overlay.appendChild(cardRow);

  const atkWrap = document.createElement('div');
  atkWrap.style.cssText = 'text-align:center;opacity:0;transition:opacity 0.3s;';
  const atkImgDiv = document.createElement('div');
  atkImgDiv.style.cssText = 'width:100px;height:140px;border:3px solid #ff4444;border-radius:8px;overflow:hidden;box-shadow:0 0 20px rgba(255,68,68,0.5);';
  const atkSrc = cardImg(atkCard);
  atkImgDiv.innerHTML = atkSrc ? '<img src="' + atkSrc + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#ff4444;padding:8px;">' + atkCard.name + '</div>';
  atkWrap.appendChild(atkImgDiv);
  const atkName = document.createElement('div');
  atkName.style.cssText = 'color:#fff;font-size:11px;margin-top:6px;font-weight:bold;';
  atkName.innerText = atkCard.name;
  atkWrap.appendChild(atkName);
  cardRow.appendChild(atkWrap);

  const vs = document.createElement('div');
  vs.style.cssText = 'font-size:1.5rem;font-weight:900;color:#ff4444;text-shadow:0 0 20px #ff0000;opacity:0;transition:opacity 0.3s;';
  vs.innerText = '⚔';
  cardRow.appendChild(vs);

  const defWrap = document.createElement('div');
  defWrap.style.cssText = 'text-align:center;opacity:0;transition:opacity 0.3s;';
  const defImgDiv = document.createElement('div');
  defImgDiv.style.cssText = 'width:100px;height:140px;border:3px solid #ffaa00;border-radius:8px;overflow:hidden;box-shadow:0 0 20px rgba(255,170,0,0.5);display:flex;align-items:center;justify-content:center;background:#111;';
  defImgDiv.innerHTML = '<div style="font-size:3rem;">👤</div>';
  defWrap.appendChild(defImgDiv);
  const defName = document.createElement('div');
  defName.style.cssText = 'color:#ffaa00;font-size:11px;margin-top:6px;font-weight:bold;';
  defName.innerText = side === 'player' ? '相手プレイヤー' : '自分';
  defWrap.appendChild(defName);
  cardRow.appendChild(defWrap);

  document.body.appendChild(overlay);

  setTimeout(() => { label.style.opacity = '1'; }, 100);
  setTimeout(() => { atkWrap.style.opacity = '1'; }, 300);
  setTimeout(() => { vs.style.opacity = '1'; }, 600);
  setTimeout(() => { defWrap.style.opacity = '1'; }, 900);

  let called = false;
  function finish() {
    if (called) return; called = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback();
  }
  setTimeout(finish, 2500);
  overlay.addEventListener('click', finish, { once: true });
}

// ----- Sアタック+演出 -----

function showSAttackPlusAnnounce(n, callback) {
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_sAttackPlus', n });
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:61000;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;top:50%;left:50%;font-size:clamp(1.8rem,8vw,3rem);font-weight:900;color:#ff2255;text-shadow:0 0 10px #ff2255,0 0 30px #ff4466,0 0 60px #ff0044,0 0 100px #ff006688;letter-spacing:3px;white-space:nowrap;padding:16px 36px;border:3px solid #ff3366;border-radius:14px;background:linear-gradient(135deg,rgba(40,0,10,0.95),rgba(80,0,20,0.95));animation:sAttackPlusSlam 2s cubic-bezier(0.22,1,0.36,1) forwards, sAttackPlusGlow 0.6s ease-in-out 0.25s 2;';
  el.innerText = '⚔ セキュリティアタック+' + n + '！！';
  overlay.appendChild(el);
  const _kwRule = !!(window._appendKeywordRuleLine && window._appendKeywordRuleLine(overlay, 'security_attack_plus'));
  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, _kwRule ? 3000 : 2200);
}

// ----- 勝敗演出 -----

export function showGameEndOverlay(text, type, callback) {
  const isVictory = type === 'victory';
  const color = isVictory ? '#00ff88' : '#ff4444';
  const bgColor = isVictory ? 'rgba(0,40,20,0.95)' : 'rgba(40,0,0,0.95)';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:' + bgColor + ';z-index:50000;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;';

  if (isVictory) {
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      const x = Math.random() * 100, delay = Math.random() * 2, dur = 2 + Math.random() * 2;
      const size = 3 + Math.random() * 6;
      const colors = ['#ffdd00', '#ffaa00', '#00ff88', '#fff', '#00fbff'];
      const c = colors[Math.floor(Math.random() * colors.length)];
      p.style.cssText = 'position:absolute;left:' + x + '%;bottom:-10px;width:' + size + 'px;height:' + size + 'px;background:' + c + ';border-radius:50%;box-shadow:0 0 ' + size * 2 + 'px ' + c + ';animation:victoryParticle ' + dur + 's ease ' + delay + 's infinite;';
      overlay.appendChild(p);
    }
  } else {
    const fog = document.createElement('div');
    fog.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at center, rgba(255,0,0,0.15) 0%, transparent 70%);animation:defeatPulse 2s ease-in-out infinite;';
    overlay.appendChild(fog);
  }

  const lineTop = document.createElement('div');
  lineTop.style.cssText = 'position:absolute;top:28%;left:0;right:0;height:3px;background:linear-gradient(90deg, transparent, ' + color + ', transparent);transform:scaleX(0);animation:gateLineExpand 1s ease 0.3s forwards;';
  overlay.appendChild(lineTop);
  const lineBottom = document.createElement('div');
  lineBottom.style.cssText = 'position:absolute;top:72%;left:0;right:0;height:3px;background:linear-gradient(90deg, transparent, ' + color + ', transparent);transform:scaleX(0);animation:gateLineExpand 1s ease 0.4s forwards;';
  overlay.appendChild(lineBottom);

  const mainText = document.createElement('div');
  mainText.style.cssText = 'position:relative;z-index:1;font-size:clamp(2.5rem,12vw,5rem);font-weight:900;color:' + color + ';text-shadow:0 0 30px ' + color + ',0 0 60px ' + color + ',0 0 100px ' + color + ';opacity:0;animation:gateTextAppear 1.5s ease 0.5s forwards;text-align:center;';
  mainText.innerText = text;
  overlay.appendChild(mainText);

  const subText = document.createElement('div');
  subText.style.cssText = 'position:relative;z-index:1;font-size:clamp(0.8rem,3vw,1.1rem);color:#ffffff88;margin-top:16px;opacity:0;animation:gateTextAppear 1s ease 1s forwards;';
  subText.innerText = isVictory ? 'Congratulations!' : 'Game Over';
  overlay.appendChild(subText);

  // チュートリアルクリア時 (勝利 & runner.cleared): ボタン無しで自動遷移 (クリア演出へ)
  const _tutorialAutoDismiss = isVictory
    && !!(window._tutorialRunner && window._tutorialRunner.active && window._tutorialRunner.cleared);

  if (_tutorialAutoDismiss) {
    document.body.appendChild(overlay);
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      callback();
    }, 3500);
    return;
  }

  const btn = document.createElement('button');
  btn.style.cssText = 'position:relative;z-index:1;margin-top:30px;background:' + color + '22;color:' + color + ';border:2px solid ' + color + ';padding:12px 32px;border-radius:10px;font-size:1rem;font-weight:bold;cursor:pointer;opacity:0;animation:gateTextAppear 1s ease 1.5s forwards;';
  btn.innerText = '戻る';
  btn.onclick = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback();
  };
  overlay.appendChild(btn);

  document.body.appendChild(overlay);
}

// ===================================================================
// AI スクリプト用 公開 helper
//   チュートリアルの相手AIスクリプトから呼ばれる。
//   公式ルール準拠（コスト消費 / 効果発動 / アニメーション）で動作。
//   key には カードNo または カード名 を指定可能（部分一致対応）
// ===================================================================

// 配列からカードNo/名前 で1枚見つける
//   key: 検索キー (カードNo 完全一致優先 → 名前 完全一致 → 名前 部分一致)
function _findCardInArray(arr, key) {
  if (!Array.isArray(arr) || !key) return -1;
  const k = String(key).trim();
  // 1) cardNo 完全一致
  let idx = arr.findIndex(c => c && String(c.cardNo) === k);
  if (idx >= 0) return idx;
  // 2) name 完全一致
  idx = arr.findIndex(c => c && String(c.name) === k);
  if (idx >= 0) return idx;
  // 3) name 部分一致
  idx = arr.findIndex(c => c && String(c.name || '').includes(k));
  return idx;
}

// AI: 手札のカードを登場（オプション/テイマー/デジモン）
//   key: カードNo または カード名
//   onDone(turnEnded) で完了通知
export function aiScriptPlayCard(key, onDone) {
  const handIdx = _findCardInArray(bs.ai.hand, key);
  const cardNo = key;
  if (handIdx < 0) {
    addLog('🤖 [スクリプト] 手札に「' + key + '」が見つかりません');
    onDone && onDone(false);
    return;
  }
  const card = bs.ai.hand[handIdx];
  if (card.playCost == null) {
    addLog('🤖 [スクリプト] 「' + card.name + '」は登場できません (進化専用)');
    onDone && onDone(false);
    return;
  }
  aiPlayCard(card, handIdx, (turnEnded) => onDone && onDone(turnEnded));
}

// AI: バトルエリアで進化（コスト+ドロー+【進化時】）
//   sourceKey/targetKey: カードNo または カード名
export function aiScriptEvolveBattle(sourceKey, targetKey, onDone) {
  const slotIdx = _findCardInArray(bs.ai.battleArea, sourceKey);
  const handIdx = _findCardInArray(bs.ai.hand, targetKey);
  if (slotIdx < 0) {
    addLog('🤖 [スクリプト] バトルエリアに「' + sourceKey + '」がありません');
    onDone && onDone(false); return;
  }
  if (handIdx < 0) {
    addLog('🤖 [スクリプト] 手札に「' + targetKey + '」がありません');
    onDone && onDone(false); return;
  }
  const base = bs.ai.battleArea[slotIdx];
  const evo  = bs.ai.hand[handIdx];
  if (evo.evolveCost == null) {
    addLog('🤖 [スクリプト] 「' + evo.name + '」は進化できません');
    onDone && onDone(false); return;
  }
  bs.ai.hand.splice(handIdx, 1);
  // stack[0] = 直前の進化形（top）, stack[N-1] = デジタマ（bottom）の規約に統一
  evo.stack = [base, ...(base.stack || [])];
  // 進化しても同じ1体なので「登場したターン」は引き継ぐ（公式ルール 5-1-2-1。情報が失われるのはジョグレス進化だけ 8-2-2-1-7）
  evo.summonedThisTurn = !!base.summonedThisTurn;
  evo.suspended = base.suspended;
  evo.baseDp = parseInt(evo.dp) || 0;
  evo.dpModifier = 0;
  evo.buffs = [];
  bs.ai.battleArea[slotIdx] = evo;
  const cost = evo.evolveCost;
  addLog('🤖 AIが「' + base.name + '」→「' + evo.name + '」進化！（コスト ' + cost + '）');
  renderAll();
  showEvolveEffect(cost, base.name, base, evo, () => {
    const turnEnded = aiSpendMemory(cost);
    // 進化したら 1 ドロー
    if (bs.ai.deck.length > 0) {
      bs.ai.hand.push(bs.ai.deck.shift());
      addLog('🤖 進化ドロー');
    }
    _hooks.applyPermanentEffects('ai');
    renderAll(true);
    if (hasKeyword(evo, '【進化時】')) {
      _hooks.checkAndTriggerEffect(evo, '【進化時】', () => {
        renderAll(true);
        onDone && onDone(turnEnded);
      }, 'ai');
    } else {
      onDone && onDone(turnEnded);
    }
  });
}

// AI: 育成エリアで進化（targetKey: カードNo または カード名）
export function aiScriptEvolveBreed(targetKey, onDone) {
  const handIdx = _findCardInArray(bs.ai.hand, targetKey);
  if (handIdx < 0) {
    addLog('🤖 [スクリプト] 手札に「' + targetKey + '」がありません');
    onDone && onDone(false); return;
  }
  const base = bs.ai.ikusei;
  if (!base) {
    addLog('🤖 [スクリプト] 育成エリアにカードがありません');
    onDone && onDone(false); return;
  }
  const evo = bs.ai.hand[handIdx];
  if (evo.evolveCost == null) {
    addLog('🤖 [スクリプト] 「' + evo.name + '」は進化できません');
    onDone && onDone(false); return;
  }
  bs.ai.hand.splice(handIdx, 1);
  // stack[0] = 直前の進化形（top）, stack[N-1] = デジタマ（bottom）の規約に統一
  evo.stack = [base, ...(base.stack || [])];
  // 進化しても同じ1体なので「登場したターン」は引き継ぐ（公式ルール 5-1-2-1。情報が失われるのはジョグレス進化だけ 8-2-2-1-7）
  evo.summonedThisTurn = !!base.summonedThisTurn;
  evo.suspended = base.suspended;
  evo.baseDp = parseInt(evo.dp) || 0;
  evo.dpModifier = 0;
  evo.buffs = [];
  bs.ai.ikusei = evo;
  const cost = evo.evolveCost;
  addLog('🤖 AIが育成「' + base.name + '」→「' + evo.name + '」進化！');
  renderAll();
  showEvolveEffect(cost, base.name, base, evo, () => {
    const turnEnded = aiSpendMemory(cost);
    if (bs.ai.deck.length > 0) {
      bs.ai.hand.push(bs.ai.deck.shift());
    }
    renderAll(true);
    // 育成エリアでは <育成> を持つ進化時効果のみ発動
    if (hasKeyword(evo, '【進化時】')) {
      _hooks.checkAndTriggerEffect(evo, '【進化時】', () => {
        renderAll(true);
        onDone && onDone(turnEnded);
      }, 'ai');
    } else {
      onDone && onDone(turnEnded);
    }
  });
}

// AI: 育成エリア → バトルエリアに移動
export function aiScriptMoveToBattle(onDone) {
  const card = bs.ai.ikusei;
  if (!card) {
    addLog('🤖 [スクリプト] 育成エリアにカードがありません');
    onDone && onDone(false); return;
  }
  if (card.level === '2') {
    addLog('🤖 [スクリプト] レベル2のカードはバトルエリアに移動できません');
    onDone && onDone(false); return;
  }
  bs.ai.ikusei = null;
  let empty = bs.ai.battleArea.findIndex(s => s === null);
  if (empty === -1) { empty = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }
  bs.ai.battleArea[empty] = card;

  showPhaseAnnounce('🚀 バトルエリアへ移動！', '#ff9900', () => {
    addLog('🤖 AIが「' + card.name + '」を育成→バトルエリアへ移動');
    _hooks.applyPermanentEffects('ai');
    renderAll(true);
    // 登場時効果があれば発動
    _hooks.checkAndTriggerEffect(card, '【登場時】', () => {
      onDone && onDone(false);
    }, 'ai');
  });
}

// AI: 指定アタッカーで指定対象に攻撃
//   attackerKey: カードNo または カード名
//   target: 'security' | { type:'digimon', cardNo: 'XX' or name }
export function aiScriptAttack(attackerKey, target, onDone) {
  // スクリプト経由のアタックでは、doAiSecurityCheck 内で aiAttackPhase を
  // 連鎖呼び出ししないようフラグを立てる (script で指示したアタックのみ実行)
  bs._aiScriptInProgress = true;
  const _wrappedDone = () => {
    bs._aiScriptInProgress = false;
    onDone && onDone();
  };
  const atkIdx = _findCardInArray(bs.ai.battleArea, attackerKey);
  if (atkIdx < 0) {
    addLog('🤖 [スクリプト] バトルエリアに「' + attackerKey + '」がありません');
    _wrappedDone(); return;
  }
  const atk = bs.ai.battleArea[atkIdx];
  if (atk.suspended) {
    addLog('🤖 [スクリプト] 「' + atk.name + '」はレスト中でアタックできません');
    _wrappedDone(); return;
  }
  if (atk.summonedThisTurn) {
    addLog('🤖 [スクリプト] 「' + atk.name + '」は登場ターンのためアタックできません');
    _wrappedDone(); return;
  }
  let targetMode = 'security';
  let targetIdx = -1;
  if (target && typeof target === 'object' && target.type === 'digimon') {
    const k = target.cardNo || target.name || '';
    targetIdx = _findCardInArray(bs.player.battleArea, k);
    if (targetIdx < 0) {
      addLog('🤖 [スクリプト] プレイヤー「' + k + '」が見つからないためセキュリティをアタック');
    } else {
      targetMode = 'digimon';
    }
  }

  // 本物のアタックフロー（演出・ブロック確認・効果処理すべて含む）
  atk.suspended = true;
  atk._attackedOnTurn = bs.turn; // cond_self_attacked 用
  bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
  addLog('🤖 「' + atk.name + '」でアタック！');
  // ≪連携≫: AI 側もバフ自動発動
  _tryCombo(atk, bs.ai);
  renderAll();
  // アタック宣言による自身のレスト → プレイヤー側の when_opp_rest 誘発（ヴェノムヴァンデモン等）。
  // この誘発（効果発動ポップアップのOK待ち）が解決するまでアタック演出・バトル進行に進めない
  _fireAttackRestThen('ai', atk, () => {

  const _aiIsDirect = targetMode === 'security' && (bs.player.battleArea || []).filter(c => c).length === 0;
  bs._lastAttackIsDirect = _aiIsDirect;
  try {
    if (window._tutorialRunner) {
      window._tutorialRunner.notifyEvent('attack_declared', {
        cardNo: atk.cardNo, cardName: atk.name,
        target: targetMode, isDirect: _aiIsDirect,
        side: 'ai',
      });
    }
  } catch (_) {}

  showPhaseAnnounce('⚔ AIアタック！', '#ff4444', () => {
    // アタック時効果
    const doAfterAtkEffect = (cb) => {
      // 【アタック時】効果 → プレイヤーへのアタック時のみ防御側の
      // 「相手のデジモンがプレイヤーにアタックしたとき」誘発（ロゼモン BT1-082 等）
      const _afterAtkTime = () => {
        // subject:"both"（お互いのターンでアタック時発動）の進化元効果をプレイヤー側で反応させる
        // （デジモン対象/プレイヤー対象どちらのアタックでも発動するため targetMode で絞らない）
        _hooks.fireOnAttackBothSubjectTriggers('ai', () => {
          // subject:"opp"（相手のデジモンがアタックしたとき）の進化元効果をプレイヤー側で反応させる
          _hooks.fireOnAttackOppSubjectTriggers('ai', () => {
            if (targetMode !== 'digimon' && window._fireWhenOppAttack) {
              window._fireWhenOppAttack('ai', bs, { bs, addLog, renderAll, updateMemGauge }, cb);
            } else { cb(); }
          });
        });
      };
      // 常にスキャン（付与効果・誘発も拾う。効果が無ければ即コールバック）
      _hooks.checkAndTriggerEffect(atk, '【アタック時】', _afterAtkTime, 'ai');
    };

    doAfterAtkEffect(() => {
      if (targetMode === 'digimon') {
        // デジモンバトル → 本物の resolveBattleAI
        const def = bs.player.battleArea[targetIdx];
        if (!def) { _wrappedDone(); return; }
        resolveBattleAI(atk, atkIdx, def, targetIdx, () => {
          checkPendingTurnEnd();
          _wrappedDone();
        });
      } else {
        // セキュリティアタック → ブロッカーチェック付き
        const blockerIndices = [];
        bs.player.battleArea.forEach((c, i) => {
          if (_cantRedirectAttack(atk)) return; // アタック対象を変更されない（ブロックされない）
          if (c && _canBlockNow(c) && isBlocker(c)) {
            blockerIndices.push(i);
          }
        });

        if (blockerIndices.length > 0) {
          const _showBlock = () => { window._blockConfirmCands = blockerIndices; return showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
            if (doBlock) {
              if (blockerIndices.length === 1) {
                const blockerIdx = blockerIndices[0];
                const blocker = bs.player.battleArea[blockerIdx];
                blocker.suspended = true;
                addLog('🛡 「' + blocker.name + '」でブロック！');
                if (window._tutorialRunner && window._tutorialRunner.active) {
                  try { window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'player' }); } catch (e) {}
                }
                renderAll();
                fireOppRestThen('player', () => {
                  afterBlockedEffect(atk, atkIdx, 'ai', () => {
                    resolveBattleAI(atk, atkIdx, blocker, blockerIdx, () => {
                      checkPendingTurnEnd();
                      _wrappedDone();
                    });
                  });
                });
              } else {
                showBlockerSelection(blockerIndices, atk, (selectedIdx) => {
                  if (selectedIdx !== null) {
                    const blocker = bs.player.battleArea[selectedIdx];
                    blocker.suspended = true;
                    addLog('🛡 「' + blocker.name + '」でブロック！');
                    if (window._tutorialRunner && window._tutorialRunner.active) {
                      try { window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'player' }); } catch (e) {}
                    }
                    renderAll();
                    fireBlockReactionThen('player', () => {
                      afterBlockedEffect(atk, atkIdx, 'ai', () => {
                        resolveBattleAI(atk, atkIdx, blocker, selectedIdx, () => {
                          checkPendingTurnEnd();
                          _wrappedDone();
                        });
                      });
                    });
                  } else {
                    doAiSecurityCheck(atk, atkIdx, () => { checkPendingTurnEnd(); _wrappedDone(); });
                  }
                });
              }
            } else {
              doAiSecurityCheck(atk, atkIdx, () => { checkPendingTurnEnd(); _wrappedDone(); });
            }
          }, { type: 'security' }); };
          _showBlock();
        } else {
          doAiSecurityCheck(atk, atkIdx, () => { checkPendingTurnEnd(); _wrappedDone(); });
        }
      }
    });
  });
  }); // fireOppRestThen
}
