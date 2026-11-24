/**
 * battle-combat.js — 戦闘システム
 *
 * カード登場・進化・アタック・ブロック・セキュリティチェック・勝敗判定
 * AI戦闘ロジック・戦闘演出を含む
 */

import { bs, spendMemory, addMemory, isMemoryOverflow, drawCards, placeOnBattleArea, removeFromBattleArea, destroyCard, MEM_MIN, MEM_MAX, canPayMemory, memoryShortText } from './battle-state.js';
import { addLog, showOverlay, removeOverlay, showConfirm, showToast, showScreen } from './battle-ui.js';
import { renderAll, renderHand, updateMemGauge, updatePhaseBadge, cardImg } from './battle-render.js';
import { fxLinkEffect, fxAppGattai, fxJogressFusion, fxDigixrossFusion, fxBattleClashBegin, fxBattleClashReset, fxBattleResultBurst, registerClashLoser, consumeClashLoser } from './battle-fx.js';
import { cardAliasHasName } from './name-alias.js';
import { classifyCard as _aiTagsOf, buildDeckProfile as _aiBuildProfile } from './ai-brain.js';
import { showYourTurn, showPhaseAnnounce, doDraw, showDrawEffect, aiTurn, exitBreedPhase, checkAutoTurnEnd, setPhaseHooks } from './battle-phase.js';
import { fireOptionUsedTriggers as _fireOptionUsed, hasOwnMainEffect as _hasOwnMainEffect, mainEffectButtonState as _mainEffectButtonState, mainEffectWillDoAnything as _mainEffectWillDoAnything, cpuMainEffectWorthIt as _cpuMainEffectWorthIt } from './effect-engine.js';
import { expireBuffs as _expireBuffs, applyPermanentEffects as _applyPermanent, triggerEffect as _triggerEffect, fireOnDestroyTriggers as _fireOnDestroy, fireOnDestroySubjectReactions as _fireOnDestroySubjectReactions, fireOnBattleDestroyTriggers as _fireOnBattleDestroy, fireWhenBattleDestroyTriggers as _fireWhenBattleDestroy, fireWhenOppRestTriggers as _fireWhenOppRest, fireWhenRestTriggers as _fireWhenRest, collectOwnRestReactions as _collectOwnRestReactions, fireWhenOwnBlockTriggers as _fireWhenOwnBlock, fireWhenOwnDestroyedTriggers as _fireWhenOwnDestroyed, hasRecipeTrigger as _hasRecipeTrigger, hasEvoStackTrigger as _hasEvoStackTrigger, whenDestroyApplies as _whenDestroyApplies, getEffectivePlayCost as _getEffectivePlayCost, getAltEvolve as _getAltEvolve, getBurstEvolve as _getBurstEvolve, filterBurstEvolveTamerCandidates as _filterBurstEvolveTamerCandidates, getAppGattaiEvolve as _getAppGattaiEvolve, checkBeforeEvolveDiscount as _checkBeforeEvolveDiscount, fireBeforeEvolveEffects as _fireBeforeEvolveEffects, checkAbsorbEvolveDiscount as _checkAbsorbEvolveDiscount, showEffectAnnounce as _showEffectAnnounce, extractTriggerSectionText as _extractTriggerSectionText, hasNoAnnounceOverride as _hasNoAnnounceOverride, evoSourceEffectLabel as _evoSourceEffectLabel, showTargetSelection as _showTargetSelection, getAssemblyOptions as _getAssemblyOptions, filterAssemblyCandidates as _filterAssemblyCandidates, showTrashCardPicker as _showTrashCardPicker, fireKeywordAttackEffects as _fireKeywordAttackEffects, tryCancelViaLeaveBattle as _tryCancelViaLeaveBattle, hasTrainingKeyword as _hasTrainingKeyword, fireWhenSecurityDecreaseTriggers as _fireWhenSecurityDecrease, fireLinkTriggers as _fireLinkTriggers, isCardInAnyZone as _isCardInAnyZone, fireWhenEvoSourceIncreaseTriggers as _fireWhenEvoSourceIncrease, checkWhenPlayDiscount as _checkWhenPlayDiscount, checkCostedSummonDiscount as _checkCostedSummonDiscount, cardHasActivePassiveFlag as _cardHasActivePassiveFlag, fireWhenTargetChangedTriggers as _fireWhenTargetChanged, getStaticEvoCostReduction as _getStaticEvoCostReduction, getJogressConditions as _getJogressConditions, jogressSlotMatches as _jogressSlotMatches, hasCostRestPending as _hasCostRestPending, getAltUseColors as _getAltUseColors } from './effect-engine.js';

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
// ≪氷装≫を持つか。オンラインでは相手のカードの永続効果（_permEffects）をこちらで計算しないので、レシピの passive・バフも見る
// （ヴァイクモン LM-040 で、相手の端末でのバトルが DP で比べられて負けていた）
function _hasIceArmor(c) {
  if (!c) return false;
  return hasPassiveFlag(c, 'iceArmor', '【氷装】') || hasPassiveFlag(c, 'ice_armor', '【氷装】')
    || (Array.isArray(c.buffs) && c.buffs.some(b => b && (b.type === 'ice_armor' || b.type === 'keyword_ice_armor')));
}
if (typeof window !== 'undefined') window._hasIceArmor = (c) => _hasIceArmor(c);
// バトルの≪氷装≫の判定・進化元の枚数は、場にいる実物のカードで行う（演出やアタック先の変更の経路では、カードの写し
// （名前・DP等だけ）が渡ってくることがあり、写しにはレシピが無いので≪氷装≫を見落としていた。ユキナモン BT27-033）
function _realBattleCard(c, side, idx) {
  if (!c) return c;
  const area = (bs[side] && bs[side].battleArea) || [];
  if (area.includes(c)) return c;
  const same = (x) => !!(x && (x.name || '') === (c.name || '') && (!c.cardNo || x.cardNo === c.cardNo));
  if (idx != null && idx >= 0 && same(area[idx])) return area[idx];
  for (const sd of ['player', 'ai']) { const x = ((bs[sd] && bs[sd].battleArea) || []).find(same); if (x) return x; }
  return c;
}
function _iceBattleCounts(atk, atkSide, atkIdx, def, defSide, defIdx) {
  const ra = _realBattleCard(atk, atkSide, atkIdx), rd = _realBattleCard(def, defSide, defIdx);
  const active = _hasIceArmor(ra) || _hasIceArmor(rd) || _hasIceArmor(atk) || _hasIceArmor(def);
  const cnt = (c, r) => (c && typeof c._stackCount === 'number') ? c._stackCount : ((r && r.stack) || (c && c.stack) || []).length;
  console.log('[ice-check]', atk && atk.name, '氷装=' + _hasIceArmor(ra), '進化元=' + cnt(atk, ra), '/', def && def.name, '氷装=' + _hasIceArmor(rd), '進化元=' + cnt(def, rd), '→', active);
  return { active, a: cnt(atk, ra), d: cnt(def, rd) };
}
// ≪氷装≫のバトル（VS画面）: 進化元の枚数で比べることを見せ、負けた方のカード全体を氷で包んで、ひびが入り、ばらばらに砕く
function _iceArmorVsFx(overlay, atkArea, defArea, a, d, winner, atkSide) {
  const defSide = atkSide === 'player' ? 'ai' : atkSide === 'ai' ? 'player' : null;
  try {
    if (!document.getElementById('ice-armor-style2')) {
      const st = document.createElement('style'); st.id = 'ice-armor-style2';
      st.textContent = '@keyframes iceIn{0%{opacity:0;transform:translateX(-50%) scale(0.6)}60%{opacity:1;transform:translateX(-50%) scale(1.08)}100%{opacity:1;transform:translateX(-50%) scale(1)}}'
        + '@keyframes iceFall{0%{transform:translateY(-20px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(110vh) rotate(360deg);opacity:0.2}}'
        + '@keyframes iceFade{0%{opacity:0}100%{opacity:1}}'
        + '@keyframes iceGrow{0%{clip-path:inset(100% 0 0 0)}100%{clip-path:inset(0 0 0 0)}}'
        + '@keyframes iceCrack{0%{stroke-dashoffset:200}100%{stroke-dashoffset:0}}'
        + '@keyframes iceShake{0%,100%{transform:translate(0,0)}25%{transform:translate(-3px,1px)}50%{transform:translate(3px,-1px)}75%{transform:translate(-2px,-1px)}}';
      document.head.appendChild(st);
    }
    const box = document.createElement('div');
    box.className = '_ice-armor-fx';
    box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147480000;overflow:hidden;';
    document.body.appendChild(box);
    box.innerHTML = '<div style="position:absolute;inset:0;box-shadow:inset 0 0 120px rgba(170,230,255,0.75);background:radial-gradient(ellipse at center,rgba(150,220,255,0) 45%,rgba(150,220,255,0.18) 100%);animation:iceFade 0.5s ease-out forwards;"></div>';
    for (let i = 0; i < 26; i++) {
      const f = document.createElement('div');
      f.textContent = '❄';
      f.style.cssText = 'position:absolute;left:' + (Math.random() * 100) + '%;top:-20px;color:#e6f7ff;font-size:' + (10 + Math.random() * 16) + 'px;text-shadow:0 0 6px #8fd8ff;animation:iceFall ' + (2.4 + Math.random() * 1.8) + 's linear ' + (Math.random() * 1.2) + 's forwards;';
      box.appendChild(f);
    }
    const ban = document.createElement('div');
    ban.style.cssText = 'position:absolute;left:50%;top:12%;transform:translateX(-50%);text-align:center;padding:8px 18px;border-radius:12px;background:rgba(10,30,60,0.85);border:2px solid #9be3ff;box-shadow:0 0 18px #6ccfff,inset 0 0 14px rgba(155,227,255,0.5);color:#fff;animation:iceIn 0.45s ease-out forwards;white-space:nowrap;';
    ban.innerHTML = '<div style="font-size:clamp(1rem,4.6vw,1.5rem);font-weight:900;text-shadow:0 0 10px #6ccfff;">🧊 氷装 ― 進化元の枚数で勝負！</div>'
      + '<div style="font-size:clamp(1.2rem,6vw,2rem);font-weight:900;margin-top:2px;"><span style="color:' + (winner === 'atk' ? '#bff0ff' : '#8aa') + '">' + a + '枚</span>'
      + '<span style="color:#9be3ff;margin:0 10px;">vs</span><span style="color:' + (winner === 'def' ? '#bff0ff' : '#8aa') + '">' + d + '枚</span></div>';
    box.appendChild(ban);
    const hidden = [];
    // 負けた方のカード: 氷が下から包み込む → ひびが入る → ばらばらに砕けて飛び散る
    // 負けた方のカード: VS画面の押し合いの1回目で下1/3、2回目で2/3、3回目で全体が凍り → ひびが入り → 砕け散る。
    // 氷はVS画面のカード（押し合いで動く）の中に重ねるので、カードと一緒に動く
    const HITS = [340, 960, 1690]; // 押し合いでぶつかる時刻（fxBattleClashBegin と同じ。VS画面のカードの動き始めから）
    const svgNS = 'http://www.w3.org/2000/svg';
    if (!document.getElementById('ice-armor-style4')) {
      const st = document.createElement('style'); st.id = 'ice-armor-style4';
      st.textContent = '@keyframes icFrost{0%{stroke-dashoffset:120;opacity:0}20%{opacity:1}100%{stroke-dashoffset:0;opacity:1}}'
        + '@keyframes icSpike{0%{transform:scale(0);opacity:0}70%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}'
        + '@keyframes icDrip{0%{transform:scaleY(0)}100%{transform:scaleY(1)}}'
        + '@keyframes icGlint{0%,100%{opacity:0;transform:scale(0.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}'
        + '@keyframes icMist{0%{opacity:0;transform:translate(0,0) scale(0.6)}40%{opacity:0.55}100%{opacity:0;transform:translate(var(--mx),var(--my)) scale(1.6)}}'
        + '@keyframes icGloss{0%{transform:translateX(-120%) skewX(-20deg)}100%{transform:translateX(220%) skewX(-20deg)}}'
        + '@keyframes icBurst{0%{opacity:0.9;transform:scale(0.4)}100%{opacity:0;transform:scale(1.6)}}'
        + '@keyframes hxFlashIce{0%{opacity:0}15%{opacity:1}100%{opacity:0}}'
        + '@keyframes icQuake{0%,100%{translate:0 0}15%{translate:-9px 4px}30%{translate:8px -5px}45%{translate:-6px -3px}60%{translate:5px 4px}80%{translate:-2px 1px}}'
        + '@keyframes icPop{0%{opacity:0;transform:scale(2.4)}45%{opacity:1;transform:scale(0.9)}70%{transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}'
        + '@keyframes icRing{0%{opacity:1;transform:scale(0.5)}100%{opacity:0;transform:scale(2.4)}}'
        + '@keyframes icRise{0%{transform:scaleY(0);opacity:0}60%{transform:scaleY(1.2);opacity:1}100%{transform:scaleY(1);opacity:1}}'
        + '@keyframes icStreak{0%{opacity:0;transform:translateX(0) scaleX(0.3)}30%{opacity:0.9}100%{opacity:0;transform:translateX(var(--sx)) scaleX(1)}}'
        + '@keyframes icVortex{0%{opacity:0;transform:rotate(0) scale(0.4)}25%{opacity:1}100%{opacity:0;transform:rotate(540deg) scale(1.1)}}';
      document.head.appendChild(st);
    }
    const cleanups = [];
    const freezeStaged = (area, loserSide) => {
      if (!area) return;
      const r0 = area.getBoundingClientRect();
      if (!r0.width) return;
      const imgEl = area.querySelector('img');
      const src = imgEl ? imgEl.src : '';
      // 氷を重ねる先: VS画面のカードのエリア（押し合いで一緒に動く）。カードの画像の枠（はみ出しを切る）の外側に重ね、
      // 画像の枠と同じ位置・大きさにする（とげ・つらら・文字が枠で切れないように）
      const host = area;
      const prevPos = host.style.position;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const frame = (imgEl && imgEl.parentElement && imgEl.parentElement !== area) ? imgEl.parentElement : area;
      const prevImgFilter = imgEl ? imgEl.style.filter : '';
      const fz = document.createElement('div');
      const fl0 = frame === area ? 0 : frame.offsetLeft, ft0 = frame === area ? 0 : frame.offsetTop;
      fz.style.cssText = 'position:absolute;left:' + (fl0 - 6) + 'px;top:' + (ft0 - 6) + 'px;width:' + (frame.offsetWidth + 12) + 'px;height:' + (frame.offsetHeight + 12) + 'px;pointer-events:none;z-index:50;';
      host.appendChild(fz);
      cleanups.push(() => { try { fz.remove(); } catch (_) {} if (imgEl) imgEl.style.filter = prevImgFilter; host.style.position = prevPos; });
      // 霜（段階ごとに下から上へ）
      const frost = document.createElementNS(svgNS, 'svg');
      frost.setAttribute('viewBox', '0 0 100 140'); frost.setAttribute('preserveAspectRatio', 'none');
      frost.style.cssText = 'position:absolute;inset:6px;width:calc(100% - 12px);height:calc(100% - 12px);overflow:visible;filter:drop-shadow(0 0 2px #bff3ff);';
      fz.appendChild(frost);
      const branch = (x0, y0, a, len, depth, delay) => {
        if (depth <= 0 || len < 4) return;
        const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
        const pth = document.createElementNS(svgNS, 'path');
        pth.setAttribute('d', 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' L' + x1.toFixed(1) + ' ' + y1.toFixed(1));
        pth.setAttribute('stroke', 'rgba(240,252,255,0.95)'); pth.setAttribute('stroke-width', String(0.5 + depth * 0.35)); pth.setAttribute('fill', 'none');
        pth.setAttribute('stroke-linecap', 'round'); pth.setAttribute('stroke-dasharray', '120');
        pth.style.cssText = 'stroke-dashoffset:120;opacity:0;animation:icFrost 0.35s ease-out ' + delay.toFixed(2) + 's forwards;';
        frost.appendChild(pth);
        const nd = delay + 0.08;
        branch(x1, y1, a + 0.55 + (Math.random() - 0.5) * 0.3, len * 0.62, depth - 1, nd);
        branch(x1, y1, a - 0.55 + (Math.random() - 0.5) * 0.3, len * 0.62, depth - 1, nd);
        if (depth > 2) branch(x1, y1, a + (Math.random() - 0.5) * 0.2, len * 0.7, depth - 1, nd);
      };
      const frostStage = (k) => {
        // k=1: 下の縁から / k=2: 左右の中ほどから / k=3: 上の縁から
        const sets = {
          1: [[0, 140, -Math.PI / 4], [100, 140, -Math.PI * 3 / 4], [50, 140, -Math.PI / 2], [25, 140, -Math.PI / 2], [75, 140, -Math.PI / 2]],
          2: [[0, 85, -0.3], [100, 85, Math.PI + 0.3], [0, 70, 0], [100, 70, Math.PI]],
          3: [[0, 0, Math.PI / 4], [100, 0, Math.PI * 3 / 4], [50, 0, Math.PI / 2], [0, 35, 0.2], [100, 35, Math.PI - 0.2]],
        };
        (sets[k] || []).forEach(([ex, ey, ea], j) => branch(ex, ey, ea, 18 + Math.random() * 8, 4, j * 0.03));
      };
      // 氷の層（下から何割まで凍ったか）
      const ice = document.createElement('div');
      ice.style.cssText = 'position:absolute;inset:0;border-radius:10px;overflow:hidden;clip-path:inset(100% 0 0 0);transition:clip-path 0.35s cubic-bezier(.2,.9,.3,1.2);'
        + 'background:linear-gradient(115deg,rgba(255,255,255,0.55) 0%,rgba(255,255,255,0) 18%,rgba(255,255,255,0) 46%,rgba(255,255,255,0.35) 52%,rgba(255,255,255,0) 60%),'
        + 'repeating-linear-gradient(60deg,rgba(255,255,255,0.12) 0 2px,rgba(255,255,255,0) 2px 9px),'
        + 'linear-gradient(180deg,rgba(225,248,255,0.72),rgba(150,215,255,0.62) 45%,rgba(110,190,245,0.72));'
        + 'box-shadow:inset 0 0 0 2px rgba(255,255,255,0.85),inset 4px 4px 10px rgba(255,255,255,0.75),inset -6px -8px 14px rgba(60,140,220,0.55),0 0 22px rgba(155,227,255,0.9);';
      fz.appendChild(ice);
      // 氷の上端の線（凍った境目がはっきり見えるように）
      const edge = document.createElement('div');
      // 凍った境目: ギザギザの氷のとげの列（境目がひと目でわかるように）
      edge.style.cssText = 'position:absolute;left:0;right:0;height:16px;margin-top:-15px;top:100%;transition:top 0.35s cubic-bezier(.2,.9,.3,1.2),opacity 0.3s;filter:drop-shadow(0 0 5px #bff3ff) drop-shadow(0 0 2px #fff);';
      {
        let pts = '0,16';
        const n = 9;
        for (let q = 0; q <= n; q++) pts += ' ' + (q / n * 100).toFixed(1) + ',' + (q % 2 ? (2 + Math.random() * 5) : (9 + Math.random() * 4)).toFixed(1);
        pts += ' 100,16';
        edge.innerHTML = '<svg viewBox="0 0 100 16" preserveAspectRatio="none" style="width:100%;height:100%;display:block;"><polygon points="' + pts + '" fill="rgba(235,250,255,0.95)" stroke="#ffffff" stroke-width="0.8"/></svg>';
      }
      fz.appendChild(edge);
      const lbl = document.createElement('div');
      lbl.style.cssText = 'position:absolute;left:-40px;right:-40px;top:-34px;text-align:center;font-size:20px;font-weight:900;color:#fff;text-shadow:0 0 10px #3bb6ff,0 0 20px #3bb6ff,0 0 2px #035;opacity:0;white-space:nowrap;z-index:3;';
      fz.appendChild(lbl);
      const burst = () => {
        const b = document.createElement('div');
        b.style.cssText = 'position:absolute;inset:-10px;border-radius:12px;border:3px solid #dff8ff;box-shadow:0 0 18px #9be3ff;animation:icBurst 0.45s ease-out forwards;';
        fz.appendChild(b);
        setTimeout(() => b.remove(), 500);
        for (let q = 0; q < 8; q++) {
          const g = document.createElement('div');
          const an = Math.random() * Math.PI * 2, dd = 20 + Math.random() * 40;
          g.style.cssText = 'position:absolute;left:50%;top:' + (40 + Math.random() * 50) + '%;width:5px;height:5px;background:#fff;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);box-shadow:0 0 6px #9be3ff;transition:transform 0.5s ease-out,opacity 0.5s;';
          fz.appendChild(g);
          requestAnimationFrame(() => { g.style.transform = 'translate(' + Math.cos(an) * dd + 'px,' + Math.sin(an) * dd + 'px)'; g.style.opacity = '0'; });
          setTimeout(() => g.remove(), 600);
        }
      };
      // ぶつかった瞬間の派手な演出: 画面のフラッシュ・揺れ・氷の衝撃波・大きな欠片・境目に結晶がせり上がる・冷気の筋
      const stageImpact = (k, pct) => {
        const R = fz.getBoundingClientRect();
        const cx = R.left + R.width / 2, cy = R.top + R.height * (k === 3 ? 0.5 : pct / 100);
        const fl = document.createElement('div');
        fl.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at ' + cx + 'px ' + cy + 'px,rgba(255,255,255,' + (0.55 + k * 0.12) + ') 0%,rgba(155,227,255,0.45) ' + (10 + k * 5) + '%,rgba(120,200,255,0.12) 45%,rgba(0,0,0,0) 70%);animation:hxFlashIce ' + (0.4 + k * 0.08) + 's ease-out forwards;';
        box.appendChild(fl); setTimeout(() => fl.remove(), 800);
        { const qe = overlay || document.body; qe.style.animation = 'none'; void qe.offsetWidth; qe.style.animation = 'icQuake ' + (0.25 + k * 0.08) + 's linear'; setTimeout(() => { qe.style.animation = ''; }, 800); }
        for (let q = 0; q < 2; q++) {
          const rg = document.createElement('div');
          const sz = Math.max(R.width, R.height) * (0.7 + k * 0.15);
          rg.style.cssText = 'position:absolute;left:' + (cx - sz / 2) + 'px;top:' + (cy - sz / 2) + 'px;width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;border:' + (5 - q * 2) + 'px solid rgba(225,248,255,0.95);box-shadow:0 0 24px #9be3ff,inset 0 0 18px #9be3ff;opacity:0;animation:icRing ' + (0.55 + q * 0.15) + 's ease-out ' + (q * 0.12) + 's forwards;';
          box.appendChild(rg); setTimeout(() => rg.remove(), 1100);
        }
        for (let q = 0; q < 10 + k * 4; q++) {
          const g = document.createElement('div');
          const gs = 7 + Math.random() * 9;
          g.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + gs + 'px;height:' + (gs * 1.6) + 'px;background:linear-gradient(135deg,#ffffff,#9fdcff);clip-path:polygon(50% 0,100% 40%,60% 100%,0 60%);filter:drop-shadow(0 0 5px #9be3ff);transition:transform 0.7s cubic-bezier(.15,.8,.3,1),opacity 0.7s;';
          box.appendChild(g);
          const an = Math.random() * Math.PI * 2, dd = 60 + Math.random() * (90 + k * 30);
          requestAnimationFrame(() => { g.style.transform = 'translate(' + Math.cos(an) * dd + 'px,' + Math.sin(an) * dd + 'px) rotate(' + (Math.random() * 720 - 360) + 'deg)'; g.style.opacity = '0'; });
          setTimeout(() => g.remove(), 800);
        }
        for (let q = 0; q < 8; q++) {
          const sk = document.createElement('div');
          const dir = q % 2 ? 1 : -1;
          sk.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + (cy + (Math.random() - 0.5) * R.height * 0.8) + 'px;width:' + (60 + Math.random() * 80) + 'px;height:2px;margin-left:' + (dir < 0 ? '-140px' : '0') + ';background:linear-gradient(90deg,rgba(255,255,255,0),#e6f8ff,rgba(255,255,255,0));--sx:' + (dir * (80 + Math.random() * 80)) + 'px;opacity:0;animation:icStreak 0.5s ease-out ' + (Math.random() * 0.12).toFixed(2) + 's forwards;';
          box.appendChild(sk); setTimeout(() => sk.remove(), 800);
        }
        if (k < 3) {
          for (let q = 0; q < 5; q++) {
            const cr = document.createElement('div');
            const ch = 16 + Math.random() * 18 + k * 4, cw = 8 + Math.random() * 6;
            cr.style.cssText = 'position:absolute;left:' + (10 + q * 20 + (Math.random() - 0.5) * 8) + '%;top:' + pct + '%;width:' + cw + 'px;height:' + ch + 'px;margin-left:' + (-cw / 2) + 'px;margin-top:' + (-ch + 4) + 'px;transform-origin:50% 100%;clip-path:polygon(50% 0,100% 30%,80% 100%,20% 100%,0 30%);background:linear-gradient(180deg,#ffffff,rgba(160,220,255,0.9));filter:drop-shadow(0 0 4px #bff3ff);opacity:0;animation:icRise 0.35s cubic-bezier(.2,.9,.3,1.4) ' + (q * 0.03).toFixed(2) + 's forwards;z-index:2;';
            fz.appendChild(cr);
            setTimeout(() => { cr.style.transition = 'opacity 0.3s'; cr.style.opacity = '0'; }, 520);
            setTimeout(() => cr.remove(), 900);
          }
        }
      };
      const setLevel = (k) => {
        const pct = k === 1 ? 66.7 : k === 2 ? 33.3 : 0;
        ice.style.clipPath = 'inset(' + pct + '% 0 0 0)';
        edge.style.top = pct + '%';
        if (k === 3) edge.style.opacity = '0';
        if (imgEl) imgEl.style.filter = k === 1 ? 'saturate(0.75) brightness(1.05) hue-rotate(20deg)' : k === 2 ? 'saturate(0.5) brightness(1.12) hue-rotate(110deg)' : 'saturate(0.25) brightness(1.2) contrast(1.05) sepia(0.2) hue-rotate(165deg)';
        lbl.textContent = k === 3 ? '❄ 完全凍結 ❄' : '❄ 凍結 ' + k + '/3';
        lbl.style.fontSize = k === 3 ? '26px' : '20px';
        lbl.style.animation = 'none'; void lbl.offsetWidth; lbl.style.animation = 'icPop 0.45s cubic-bezier(.2,.9,.3,1.3) forwards';
        frostStage(k);
        burst();
        stageImpact(k, pct);
      };
      setTimeout(() => setLevel(1), HITS[0]);
      setTimeout(() => setLevel(2), HITS[1]);
      setTimeout(() => {
        setLevel(3);
        // つやの光・結晶のとげ・つらら・もや・きらめき
        const gl = document.createElement('div');
        gl.style.cssText = 'position:absolute;top:-10%;left:0;width:35%;height:120%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.75),rgba(255,255,255,0));animation:icGloss 0.9s ease-in-out 0.1s 1 both;';
        ice.appendChild(gl);
        const R = fz.getBoundingClientRect();
        const Wd = R.width, Ht = R.height;
        for (let k = 0; k < 14; k++) {
          const t = k / 14;
          let sx, sy, sa;
          if (t < 0.25) { sx = t / 0.25 * Wd; sy = 0; sa = -90; }
          else if (t < 0.5) { sx = Wd; sy = (t - 0.25) / 0.25 * Ht; sa = 0; }
          else if (t < 0.75) { sx = Wd - (t - 0.5) / 0.25 * Wd; sy = Ht; sa = 90; }
          else { sx = 0; sy = Ht - (t - 0.75) / 0.25 * Ht; sa = 180; }
          const h = 12 + Math.random() * 16, w = 7 + Math.random() * 6;
          const sp = document.createElement('div');
          sp.style.cssText = 'position:absolute;left:' + sx + 'px;top:' + sy + 'px;width:' + h + 'px;height:' + w + 'px;margin-top:' + (-w / 2) + 'px;transform-origin:0 50%;transform:rotate(' + (sa + (Math.random() - 0.5) * 40) + 'deg);';
          sp.innerHTML = '<div style="width:100%;height:100%;clip-path:polygon(0 0,100% 50%,0 100%);transform-origin:0 50%;background:linear-gradient(90deg,rgba(235,250,255,0.95),rgba(140,210,255,0.85));filter:drop-shadow(0 0 3px #bff3ff);opacity:0;animation:icSpike 0.3s cubic-bezier(.2,.9,.3,1.4) ' + (Math.random() * 0.2).toFixed(2) + 's forwards;"></div>';
          fz.appendChild(sp);
        }
        for (let k = 0; k < 6; k++) {
          const ix = 8 + (Wd - 16) * (k + 0.3 + Math.random() * 0.4) / 6;
          const ih = 12 + Math.random() * 20, iw = 5 + Math.random() * 5;
          const ic = document.createElement('div');
          ic.style.cssText = 'position:absolute;left:' + (ix - iw / 2) + 'px;top:' + (Ht - 3) + 'px;width:' + iw + 'px;height:' + ih + 'px;clip-path:polygon(0 0,100% 0,50% 100%);transform-origin:50% 0;transform:scaleY(0);background:linear-gradient(180deg,rgba(235,250,255,0.95),rgba(150,215,255,0.7));filter:drop-shadow(0 0 3px #bff3ff);animation:icDrip 0.4s ease-out ' + (0.15 + Math.random() * 0.2).toFixed(2) + 's forwards;';
          fz.appendChild(ic);
        }
        for (let k = 0; k < 6; k++) {
          const m = document.createElement('div');
          const mx = (Math.random() - 0.5) * 70, my = -10 - Math.random() * 40;
          m.style.cssText = 'position:absolute;left:' + (Wd * Math.random()) + 'px;top:' + (Ht * (0.3 + Math.random() * 0.7)) + 'px;width:30px;height:30px;margin:-15px;border-radius:50%;background:radial-gradient(circle,rgba(235,250,255,0.85),rgba(235,250,255,0));filter:blur(3px);--mx:' + mx + 'px;--my:' + my + 'px;opacity:0;animation:icMist 1.2s ease-out ' + (k * 0.08).toFixed(2) + 's forwards;';
          fz.appendChild(m);
        }
        for (let k = 0; k < 5; k++) {
          const g = document.createElement('div');
          g.textContent = '✦';
          g.style.cssText = 'position:absolute;left:' + (Wd * (0.1 + Math.random() * 0.8)) + 'px;top:' + (Ht * (0.1 + Math.random() * 0.8)) + 'px;color:#fff;font-size:' + (9 + Math.random() * 8) + 'px;text-shadow:0 0 6px #bff3ff;opacity:0;animation:icGlint 0.5s ease-in-out ' + (0.2 + k * 0.08).toFixed(2) + 's 1;';
          fz.appendChild(g);
        }
      }, HITS[2]);
      // ひび
      setTimeout(() => {
        const sv = document.createElementNS(svgNS, 'svg');
        sv.setAttribute('viewBox', '0 0 100 140'); sv.setAttribute('preserveAspectRatio', 'none');
        sv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        ['M50 0 L44 38 L58 60 L40 96 L54 140', 'M44 38 L12 52 L0 48', 'M58 60 L88 66 L100 80', 'M40 96 L14 112 L0 120', 'M54 120 L80 108 L100 116', 'M50 70 L70 30 L92 20', 'M30 0 L36 22 L22 30'].forEach((d0, k) => {
          const pth = document.createElementNS(svgNS, 'path');
          pth.setAttribute('d', d0); pth.setAttribute('fill', 'none'); pth.setAttribute('stroke', '#ffffff'); pth.setAttribute('stroke-width', '1.8');
          pth.setAttribute('stroke-dasharray', '200');
          pth.style.cssText = 'stroke-dashoffset:200;filter:drop-shadow(0 0 2px #6ccfff);animation:iceCrack 0.25s ease-out ' + (k * 0.04) + 's forwards;';
          sv.appendChild(pth);
        });
        fz.appendChild(sv);
        fz.style.animation = 'iceShake 0.22s linear 3';
      }, HITS[2] + 650);
      // 砕け散る（その時のカードの位置で、カードの絵の入った氷の欠片にする）
      setTimeout(() => {
        const r = frame.getBoundingClientRect();
        if (!r.width) return;
        const pad = 6;
        const L = r.left - pad, T = r.top - pad, Wd = r.width + pad * 2, Ht = r.height + pad * 2;
        hidden.push({ el: area, v: area.style.visibility });
        area.style.visibility = 'hidden';
        // 吸い寄せる先: 負けた側のトラッシュ（見つからなければ画面の下）
        let tx = window.innerWidth / 2, ty = window.innerHeight + 40;
        try {
          const cnt = loserSide ? document.getElementById(loserSide === 'player' ? 'pl-trash-count' : 'ai-trash-count') : null;
          const tEl = cnt ? (cnt.parentElement || cnt) : null;
          const tr = tEl ? tEl.getBoundingClientRect() : null;
          if (tr && tr.width) { tx = tr.left + tr.width / 2; ty = tr.top + tr.height / 2; }
        } catch (_) {}
        const cols = 4, rows = 5;
        for (let k = 0; k < cols * rows; k++) {
          const cx0 = k % cols, cy0 = Math.floor(k / cols);
          const pw = Wd / cols, ph = Ht / rows;
          const px = L + cx0 * pw, py = T + cy0 * ph;
          const sh = document.createElement('div');
          sh.style.cssText = 'position:absolute;left:' + px + 'px;top:' + py + 'px;width:' + pw + 'px;height:' + ph + 'px;'
            + (src ? 'background:linear-gradient(135deg,rgba(255,255,255,0.55),rgba(150,215,255,0.35)),url(' + src + ') ' + (-cx0 * pw + pad) + 'px ' + (-cy0 * ph + pad) + 'px/' + r.width + 'px ' + r.height + 'px no-repeat;' : 'background:rgba(190,235,255,0.85);')
            + 'clip-path:polygon(' + (Math.random() * 25) + '% 0,100% ' + (Math.random() * 25) + '%,' + (75 + Math.random() * 25) + '% 100%,0 ' + (75 + Math.random() * 25) + '%);'
            + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,0.9),inset 0 0 8px #fff;filter:drop-shadow(0 0 4px #9be3ff) saturate(0.4) hue-rotate(165deg);transition:transform 1s cubic-bezier(.2,.7,.4,1),opacity 1s;';
          box.appendChild(sh);
          // 粉々に割れて少し浮き上がり → 一瞬止まって → 持ち主のトラッシュへ吸い寄せられる
          const a3 = Math.atan2(py + ph / 2 - (T + Ht / 2), px + pw / 2 - (L + Wd / 2)) + (Math.random() - 0.5) * 0.8;
          const dist = 14 + Math.random() * 26;
          const rot0 = Math.random() * 60 - 30;
          sh.style.transition = 'transform 0.35s cubic-bezier(.2,.8,.3,1)';
          requestAnimationFrame(() => { sh.style.transform = 'translate(' + Math.cos(a3) * dist + 'px,' + Math.sin(a3) * dist + 'px) rotate(' + rot0 + 'deg) scale(0.92)'; });
          const dly = 480 + Math.random() * 260;
          setTimeout(() => {
            const dx = tx - (px + pw / 2), dy = ty - (py + ph / 2);
            sh.style.transition = 'transform 0.75s cubic-bezier(.55,0,.85,.35),opacity 0.75s cubic-bezier(.7,0,1,.5),filter 0.75s';
            sh.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (rot0 + (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360)) + 'deg) scale(0.08)';
            sh.style.opacity = '0.15';
          }, dly);
          setTimeout(() => sh.remove(), dly + 800);
        }
        for (let q = 0; q < 24; q++) {
          const g = document.createElement('div');
          const gx = L + Wd / 2, gy = T + Ht / 2;
          g.style.cssText = 'position:absolute;left:' + gx + 'px;top:' + gy + 'px;width:' + (3 + Math.random() * 4) + 'px;height:' + (3 + Math.random() * 4) + 'px;background:#fff;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);box-shadow:0 0 8px #9be3ff;transition:transform 0.9s ease-out,opacity 0.9s;';
          box.appendChild(g);
          const an = Math.random() * Math.PI * 2, dd = 25 + Math.random() * 45;
          requestAnimationFrame(() => { g.style.transform = 'translate(' + Math.cos(an) * dd + 'px,' + Math.sin(an) * dd + 'px) rotate(' + (Math.random() * 360) + 'deg)'; });
          const gd = 520 + Math.random() * 300;
          setTimeout(() => { g.style.transition = 'transform 0.7s cubic-bezier(.55,0,.85,.35),opacity 0.7s'; g.style.transform = 'translate(' + (tx - gx) + 'px,' + (ty - gy) + 'px) scale(0.3)'; g.style.opacity = '0'; }, gd);
          setTimeout(() => g.remove(), gd + 750);
        }
        // トラッシュに渦（吸い込み口）→ 欠片が吸い込まれたら光る
        const vs = 90;
        const vx = document.createElement('div');
        vx.style.cssText = 'position:absolute;left:' + (tx - vs / 2) + 'px;top:' + (ty - vs / 2) + 'px;width:' + vs + 'px;height:' + vs + 'px;border-radius:50%;background:conic-gradient(from 0deg,rgba(155,227,255,0),rgba(220,248,255,0.9),rgba(155,227,255,0),rgba(220,248,255,0.9),rgba(155,227,255,0));-webkit-mask:radial-gradient(circle,transparent 22%,#000 24%,#000 62%,transparent 64%);mask:radial-gradient(circle,transparent 22%,#000 24%,#000 62%,transparent 64%);filter:drop-shadow(0 0 8px #9be3ff);opacity:0;animation:icVortex 1.5s ease-in-out 0.35s forwards;';
        box.appendChild(vx);
        setTimeout(() => {
          const tf = document.createElement('div');
          tf.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at ' + tx + 'px ' + ty + 'px,rgba(255,255,255,0.95) 0%,rgba(155,227,255,0.6) 5%,rgba(0,0,0,0) 16%);animation:hxFlashIce 0.5s ease-out forwards;';
          box.appendChild(tf);
        }, 1250);
        const fl = document.createElement('div');
        fl.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at ' + (L + Wd / 2) + 'px ' + (T + Ht / 2) + 'px,rgba(255,255,255,0.95) 0%,rgba(155,227,255,0.55) 18%,rgba(120,200,255,0.15) 45%,rgba(0,0,0,0) 65%);animation:hxFlashIce 0.6s ease-out forwards;';
        box.appendChild(fl);
        { const qe = overlay || document.body; qe.style.animation = 'none'; void qe.offsetWidth; qe.style.animation = 'icQuake ' + 0.45 + 's linear'; setTimeout(() => { qe.style.animation = ''; }, 800); }
        try { fz.remove(); } catch (_) {}
      }, HITS[2] + 1250);
    };
    if (winner === 'atk' || winner === 'tie') freezeStaged(defArea, defSide);
    if (winner === 'def' || winner === 'tie') freezeStaged(atkArea, atkSide);
    setTimeout(() => { box.style.transition = 'opacity 0.4s'; box.style.opacity = '0'; }, 4800);
    setTimeout(() => box.remove(), 5300);
    // 隠したVS画面のカードは、VS画面が閉じたら（念のため最長12秒で）元に戻す
    const t0 = Date.now();
    const restore = () => {
      const closed = !overlay || overlay.style.display === 'none';
      if (!closed && Date.now() - t0 < 12000) { setTimeout(restore, 300); return; }
      hidden.forEach(h => { try { h.el.style.visibility = h.v || ''; } catch (_) {} });
      cleanups.forEach(f => { try { f(); } catch (_) {} });
    };
    setTimeout(restore, 3000);
  } catch (e) { console.error('[iceArmorVsFx]', e); }
}
function hasPassiveFlag(c, flagName, kwBracket) {
  if (!c) return false;
  // テキスト一致は誤検知が多い（メタルグレイモン「【ブロッカー】を得る」やカプリモン進化元
  // 「【ブロッカー】を持つ間」も【ブロッカー】を含んでしまう）。
  // 構造的な情報（_permEffects / buffs / recipe.passive / stack[].recipe.evo_source.passive）のみで判定する。
  if (c._permEffects && c._permEffects[flagName]) return true;
  // 効果で与えられたレシピ型のキーワード（grant_effect の _grantedRecipes[].kwFlag。【衝突】等）
  if (Array.isArray(c._grantedRecipes) && c._grantedRecipes.some(g => g && g.kwFlag === flagName)) return true;
  // 場を離れたばかりのカード（バトルで消滅した直後の【道連れ】の判定等）は、離れる直前に得ていた効果・キーワードで判定する
  // （ヴェノムヴァンデモン ST6-12 で【道連れ】を得たヨウコモンが、バトルで消滅したときに【道連れ】を発揮しなかった）
  if (Array.isArray(c._leftGrantedRecipes) && c._leftGrantedRecipes.some(g => g && g.kwFlag === flagName)) return true;
  if (Array.isArray(c._leftKeywords) && c._leftKeywords.includes(flagName)) return true;
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
if (typeof window !== 'undefined') window._hasPenetrateFn = (c) => hasPenetrate(c);
// 道連れ判定（ヴェノムヴァンデモン等）: バトルで自分だけ消滅したとき相手も消滅
function hasMichizure(c) { return hasPassiveFlag(c, 'michizure', '【道連れ】'); }
// オンラインのブロックのバトル（battle-online.js）でも、レシピ・進化元・付与まで見て判定する
if (typeof window !== 'undefined') window._hasMichizure = (c) => hasMichizure(c);

// 進化しても付与された効果（バフ）は引き継がれる。バフ由来の「アタックできない」「ブロックできない」の印も立て直す
// （進化先のカードの値＝false のままだと、「アタックできない」のバフがあるのにアタックできていた）
function _carryRestrictionFlags(c) {
  if (!c || !Array.isArray(c.buffs)) return;
  if (c.buffs.some(b => b && (b.type === 'cant_attack' || b.type === 'cant_attack_block'))) c.cantAttack = true;
  if (c.buffs.some(b => b && (b.type === 'cant_block' || b.type === 'cant_attack_block'))) c.cantBlock = true;
  if (c.buffs.some(b => b && b.type === 'cant_rest')) c.cantRest = true;
}
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
  // 【アーマー解除】はここでは処理しない（任意＝公式ルール 16-19-3。キーワードのレシピ「消滅するとき、このデジモンに
  // 重ねられているカードを上から1枚（＝このカード自身）破棄することで、消滅しない」を _runWhenBattleDestroy / doDestroy が
  // 確認つきで発揮する）。以前はここで確認なしに、一番下の進化元を破棄していた
  // 回避（消滅時、レストすることで回避）アクティブな場合のみ
  if (hasEvade(card) && !card.suspended) {
    card.suspended = true;
    addLog('🛡 【回避】「' + card.name + '」がレストして消滅回避！');
    return { canceled: true, reason: 'evade' };
  }
  // 【不屈】は消滅のキャンセルではない（公式ルール 16-27: 進化元を持つこのデジモンが消滅したとき、このカードを登場させる）。
  // 一度消滅させ、キーワードのレシピ（on_destroy の「トラッシュのこのカードを登場」）で登場し直す。【消滅時】等も誘発する
  // 【スケープゴート】はここでは処理しない（任意＝公式ルール 16-32-3。キーワードのレシピ「消滅するとき、他の自分のデジモン
  // 1体を消滅させることで、消滅しない」を _runWhenBattleDestroy / doDestroy が確認つき・身代わりを選んで発揮する）。
  // 以前は確認なしで、場の先頭のデジモンを身代わりにしていた
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
  if (!remote && _onlineMode && _sendCommand) { try { _sendCommand({ type: 'fx_cancelFlash', cardName: (card && card.name) || '', cardImg: (card && cardImg(card)) || '', reason, subImgs: (card && card._clashSubImgs) || [] }); } catch (_) {} }
  // VS画面のぶつかり合いの途中なら、回避の仕方は決着の演出で見せる
  if (_clashNote(card, _CLASH_REASON_KIND[reason] || 'shield')) { done(); return; }
  // 【回避】: カードが残像を残して横によけ、レスト（横向き）になる
  if (reason === 'evade') { _showEvadeDodge(card, remote, done); return; }
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:70500;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,0.55);pointer-events:none;animation:fadeIn 0.15s ease;';
  ov.innerHTML = '<div style="font-size:clamp(1.8rem,8vw,3.2rem);font-weight:900;color:#00fbff;text-shadow:0 0 18px #00fbff,0 0 4px #fff;letter-spacing:0.05em;">🛡 ' + kw + 'で回避！</div>'
    + '<div style="font-size:clamp(0.9rem,3.5vw,1.2rem);color:#fff;text-shadow:0 0 6px #000;">' + (remote ? '相手の' : '') + '「' + ((card && card.name) || '') + '」は消滅しない</div>';
  document.body.appendChild(ov);
  setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); done(); }, 1600);
}
if (typeof window !== 'undefined') window._showCancelFlash = _showCancelFlash;
// 【回避】の演出: 消滅させる一撃（赤い斬撃）をカードが残像を残してよけ、レスト（横向き）になる
function _showEvadeDodge(card, remote, done) {
  if (!document.getElementById('fx-evade-style')) {
    const st = document.createElement('style');
    st.id = 'fx-evade-style';
    st.textContent = '@keyframes evSlash{0%{transform:translate(-50%,-50%) rotate(-35deg) scaleX(0);opacity:0}30%{opacity:1}60%{transform:translate(-50%,-50%) rotate(-35deg) scaleX(1);opacity:1}100%{transform:translate(-50%,-50%) rotate(-35deg) scaleX(1.1);opacity:0}}'
      + '@keyframes evLbl{0%{transform:scale(1.8);opacity:0}50%{transform:scale(0.95);opacity:1}100%{transform:scale(1);opacity:1}}';
    document.head.appendChild(st);
  }
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:70500;background:rgba(0,0,0,0.7);pointer-events:none;overflow:hidden;opacity:0;transition:opacity 0.15s;';
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H / 2;
  const CW = Math.min(120, W * 0.3), CH = CW * 1.4;
  const src = card ? (card.imgSrc || cardImg(card)) : '';
  const mk = (op) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:' + (cx - CW / 2) + 'px;top:' + (cy - CH / 2) + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid #00fbff;box-shadow:0 0 20px #00fbff;background:#111;opacity:' + op + ';transition:transform 0.28s cubic-bezier(.2,.9,.3,1),opacity 0.4s;';
    d.innerHTML = src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:12px;">' + ((card && card.name) || '') + '</div>';
    ov.appendChild(d); return d;
  };
  const ghosts = [mk(0), mk(0), mk(0)];
  const main = mk(1);
  // ① 一撃（赤い斬撃）が来る
  setTimeout(() => {
    const slash = document.createElement('div');
    slash.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + (CW * 2.6) + 'px;height:6px;border-radius:3px;background:linear-gradient(90deg,transparent,#ff4d4d,#fff,#ff4d4d,transparent);box-shadow:0 0 18px #ff3b3b;animation:evSlash 0.5s ease-out forwards;';
    ov.appendChild(slash);
  }, 250);
  // ② 残像を残して横によける
  setTimeout(() => {
    ghosts.forEach((g, i) => { g.style.transition = 'none'; g.style.opacity = String(0.45 - i * 0.12); });
    requestAnimationFrame(() => {
      ghosts.forEach((g, i) => { g.style.transition = 'transform ' + (0.2 + i * 0.06) + 's ease-out,opacity 0.5s ' + (0.15 + i * 0.05) + 's'; g.style.transform = 'translateX(' + (CW * 0.35 * (i + 1)) + 'px)'; g.style.opacity = '0'; });
      main.style.transform = 'translateX(' + (CW * 1.25) + 'px)';
    });
  }, 300);
  // ③ 戻りながらレスト（横向き）になる
  setTimeout(() => {
    main.style.transition = 'transform 0.45s cubic-bezier(.3,.8,.3,1.2)';
    main.style.transform = 'translateX(0) rotate(90deg) scale(0.9)';
    const t = document.createElement('div');
    t.style.cssText = 'position:absolute;left:0;right:0;top:' + Math.max(20, cy - CH / 2 - 86) + 'px;text-align:center;animation:evLbl 0.4s ease-out forwards;';
    t.innerHTML = '<div style="font-size:clamp(1.8rem,8vw,3rem);font-weight:900;color:#00fbff;text-shadow:0 0 18px #00fbff,0 0 4px #fff;">【回避】でよけた！</div>'
      + '<div style="font-size:clamp(0.9rem,3.5vw,1.15rem);color:#fff;text-shadow:0 0 6px #000;margin-top:4px;">' + (remote ? '相手の' : '') + '「' + ((card && card.name) || '') + '」はレストして消滅しない</div>';
    ov.appendChild(t);
  }, 900);
  setTimeout(() => { ov.style.opacity = '0'; }, 2300);
  setTimeout(() => { ov.remove(); done(); }, 2500);
}
// 効果（≪防壁≫等）で自分のセキュリティが減ったとき →「セキュリティが減ったとき」（battle-online.js の fx_barrierRequest から）
if (typeof window !== 'undefined') window._fireSecurityDecreaseByEffect = (side, card, cb) => {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenSecurityDecrease(side, bs, ctxBase, () => cb && cb(), { cause: { type: 'effect', causerSide: side, causerCard: card } }); }
  catch (e) { console.error('[secDecreaseByEffect]', e); cb && cb(); }
};
function _tryCancelDestroyAsync(card, ownerSidePlayer, side, onlyBattle, callback0) {
  // VS画面の決着の演出用: 回避の前の進化元・リンクカードの枚数（どう回避したかを見分ける）
  const _linkN0 = (card && Array.isArray(card.linkedCards)) ? card.linkedCards.length : 0;
  const _stackN0 = (card && Array.isArray(card.stack)) ? card.stack.length : 0;
  const _snap = _clashSnapshot(card, ownerSidePlayer);
  const _subImgsNow = () => _clashSubCards(_snap, card, ownerSidePlayer).map(c => cardImg(c) || ('name:' + (c.name || ''))).filter(Boolean);
  const _cb0 = callback0;
  callback0 = (r) => {
    if (r && r.canceled && _clashPending) {
      let kind = _CLASH_REASON_KIND[r.reason] || 'shield';
      if (r.reason === 'protection') {
        // 前後の差から決める（場の他の自分のデジモンが代わりに消滅した＝身代わり。ポコモン LM-019「このデジモンを消滅させることで
        // 離れない」で、以前はバリア（消滅しない）の演出になっていた）
        kind = _clashKindByDiff(_snap, card);
        // キーワードの【スケープゴート】ではない身代わり（ポコモン等）は「身代わり！」
        if (kind === 'scapegoat') kind = 'substitute';
        // 「重ねられているカードを上から1枚（＝このカード）〜の下に置くことで離れない」（ハイアンドロモン BT26-058）:
        // 一番上のカードがはがれ、下のカード（新しい姿）が見えた状態で終わる（以前は進化元がトラッシュへ行く演出だった）
        if (card && card._stackPeeledTo && Date.now() - (card._stackPeeledAt || 0) < 15000) {
          const _to = card._stackPeeledTo;
          delete card._stackPeeledTo;
          const _pk = card._stackPeelKind || 'peel'; delete card._stackPeelKind;
          _clashNoteAndSend(card, _pk, [cardImg(card) || ('name:' + (card.name || ''))], cardImg(_to) || '', { name: _to.name || '', dp: (typeof formatDpDisplay === 'function' ? formatDpDisplay(_to) : String(_to.dp || '')) });
          _cb0(r);
          return;
        }
      }
      // キーワード（防壁・回避等）は fx_cancelFlash で相手に伝わる。それ以外（「離れるとき〜離れない」等）はここで送る
      if (_CANCEL_FLASH_LABEL[r.reason]) _clashNote(card, kind, _subImgsNow());
      else _clashNoteAndSend(card, kind, _subImgsNow());
    }
    if (card) delete card._stackPeeledTo;
    _cb0(r);
  };
  // キーワードで回避したら「【防壁】で回避！」等を大きく出してから続ける
  const callback = (r) => {
    if (r && r.canceled && _CANCEL_FLASH_LABEL[r.reason]) {
      // 代わりにトラッシュへ送られたカードを、VS画面の決着の演出（相手の画面にも）で見せる
      try { const _si = _subImgsNow(); if (_si.length || !Array.isArray(card._clashSubImgs)) card._clashSubImgs = _si; } catch (_) {}
      _showCancelFlash(card, r.reason, () => { delete card._clashSubImgs; callback0(r); });
      return;
    }
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
      // 確認のときに相手の画面に出した「相手が効果を発動中…」を閉じる（残ったままになっていた）
      const _fin = () => {
        if (_onlineMode && _sendCommand) { try { _sendCommand({ type: 'fx_effectClose' }); } catch (_) {} }
        callback({ canceled: true, reason: 'barrier' });
      };
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
      // 相手のセキュリティの中身はこちらでは分からないので、持ち主の端末から届いた画像を使う
      if (typeof used === 'object' && used.trashedImg) card._clashSubImgs = [used.trashedImg];
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
  // オンラインの相手のデジモン: 「バトルで消滅するとき」（【スケープゴート】等）も持ち主の端末で確認してもらう（withWBD）。
  // こちらで発揮すると、持ち主の画面で身代わりを選べず、こちらで消した身代わりも持ち主の同期で戻っていた（ダークドラモンACE LM-043）
  const _wbdRemote = side === 'ai' && _onlineMode;
  const _wbdPrev = bs._wbdDelegate;
  if (_wbdRemote) bs._wbdDelegate = true;
  try {
    _tryCancelViaLeaveBattle(card, side, bs, ctxBase, (canceled) => {
      bs._leaveByBattle = false;
      if (_wbdRemote) { bs._wbdDelegate = _wbdPrev; if (card) card._wbdDelegated = true; }
      // 相手の端末で「離れるとき」により進化していれば、相手側に【進化時】の保留が残っている
      if (canceled && side === 'ai' && _onlineMode) bs._oppDeferredEvoPending = true;
      callback(canceled ? { canceled: true, reason: 'protection' } : null);
    });
  } catch (_) { bs._leaveByBattle = false; if (_wbdRemote) bs._wbdDelegate = _wbdPrev; callback(null); }
  }
}

// オンラインのブロック解決（battle-online.js の resolveOnlineBlock。防御側の端末でバトルを解決する）から、
// バトルで消滅するカードの消滅回避を確認するための入口。callback(true)=消滅を回避した
if (typeof window !== 'undefined') {
  window._tryCancelBattleDestroy = (card, side, callback) => {
    const owner = side === 'ai' ? bs.ai : bs.player;
    // 回避できなければ「バトルで消滅するとき〜することで消滅しない」（when_battle_destroy / when_destroy）も確認する
    // （オンラインのブロック解決はここだけを呼んでいて、充填プラグインQ P-146 の進化元効果等が確認されなかった）。
    // オンラインの相手のカードは、離れるときの判定を持ち主に任せる依頼（fx_leaveBattleDelegate）に
    // 「バトルで消滅するときも確認して」（withWBD）を付け、持ち主の端末で確認してもらう
    const _remote = side === 'ai' && _onlineMode;
    if (_remote) bs._wbdDelegate = true;
    try {
      _tryCancelDestroyAsync(card, owner, side, false, (r) => {
        if (_remote) bs._wbdDelegate = false;
        if (r) { callback(true); return; }
        if (_remote) { callback(false); return; }
        try { _runWhenBattleDestroy(side, card, () => callback(false), () => { renderAll(); callback(true); }); }
        catch (e) { console.error('[tryCancelBattleDestroy WBD]', e); callback(false); }
      });
    }
    catch (_) { if (_remote) bs._wbdDelegate = false; callback(false); }
  };
  // 持ち主の端末で「バトルで消滅するとき」を確認する（battle-online.js の fx_leaveBattleDelegate withWBD から）。cb(canceled)
  window._runWhenBattleDestroyLocal = (card, cb) => {
    try { _runWhenBattleDestroy('player', card, () => cb(false), () => { renderAll(); cb(true); }); }
    catch (e) { console.error('[runWhenBattleDestroyLocal]', e); cb(false); }
  };
}

// 両者消滅（DP同値）用: 防壁/回避/【分離】/「バトルエリアを離れるとき」の置換効果（_tryCancelDestroyAsync）を
// 先に試し、回避できなければ when_battle_destroy / when_destroy（_runWhenBattleDestroy）を確認する。
// 片方だけ勝つ分岐は以前からこの順で確認していたが、両者消滅の分岐では離れるときの置換効果を見ておらず
// 不発になっていた（巨神兵器 BT26-085「離れるとき、デストロイモードに進化させることで離れない」等）
// _runBattleDestroyAvoid を cb(canceled) の形で呼ぶ（セキュリティデジモンとのバトルで負けたとき用）
function _avoidBattleDestroy(side, card, cb) {
  _runBattleDestroyAvoid(side, card, () => cb(false), () => cb(true));
}
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
  // オンラインの相手のデジモンは、直前の _tryCancelDestroyAsync で持ち主の端末が「バトルで消滅するとき」まで確認済み
  // （withWBD）。こちらでもう一度発揮しない（相手のカードの効果をこちらで発揮して、身代わりを勝手に選んでいた。LM-043）
  if (side === 'ai' && _onlineMode && card && card._wbdDelegated) { delete card._wbdDelegated; onDestroy(); return; }
  if (card) delete card._wbdDelegated;
  // 進化元のカードの「このデジモンが（バトルで）消滅するとき」も見る（充填プラグインQ P-146 の進化元効果。以前は
  // このデジモン自身のレシピだけを見ていて、進化元の効果だと確認が出なかった）
  const hasWBD = _hasRecipeTrigger(card, 'when_battle_destroy') || _hasEvoStackTrigger(card, 'when_battle_destroy');
  // 「効果で消滅するとき」（cause:'effect'）だけのものはバトルでは発揮しない
  const hasWD = _whenDestroyApplies(card, 'when_destroy', 'battle');
  if (!hasWBD && !hasWD) { onDestroy(); return; }
  // 確認中は消滅の原因を「バトル」にしておく（cause:'battle' のステップが原因を見て絞るため）。以前はこの時点で原因が
  // 記録されておらず、ブロックされて負けたとき等に「バトルで消滅するとき」（充填プラグインQ P-146 の進化元効果）が
  // 発揮されなかった。終わったら元に戻す
  const _wbPrevCause = bs._lastDestroyCause;
  bs._lastDestroyCause = { type: 'battle', causerSide: side === 'ai' ? 'player' : 'ai', causerCard: null };
  const _wbRestore = () => { bs._lastDestroyCause = _wbPrevCause; };
  { const _od = onDestroy, _oc = onCancel; onDestroy = (...a) => { _wbRestore(); return _od(...a); }; onCancel = (...a) => { _wbRestore(); return _oc(...a); }; }
  // VS画面の決着の演出用: 消滅しなかったら、前後の差から回避の仕方と代わりにトラッシュへ送ったカードを記録する（相手の画面にも）
  // オンラインで相手から任されて（fx_leaveBattleDelegate withWBD）こちらで確認するときは、こちらのVS画面がまだ始まっていない
  // ことがある。そのときも記録しておき（VS画面が始まったら反映）、相手の画面へも送る（ダークドラモンACE LM-043 の【スケープゴート】の
  // 演出が出ず、普通の勝敗の演出になっていた）
  {
    const _owner = side === 'ai' ? bs.ai : bs.player;
    const _snapW = _clashSnapshot(card, _owner);
    const _oc2 = onCancel;
    onCancel = (...a) => {
      try {
        if (!_clashPending || _clashSideOf(card)) {
          const _purged = card._armorPurgedTo;
          const _imgs = _purged ? [cardImg(card) || ('name:' + (card.name || ''))] : _clashSubCards(_snapW, card, _owner).map(c => cardImg(c) || ('name:' + (c.name || ''))).filter(Boolean);
          const _kind = _clashKindByDiff(_snapW, card);
          const _swap = _purged ? cardImg(_purged) : '';
          console.log('[clash note wbd]', card.name, _kind, 'pending=' + !!_clashPending, 'subs=' + _imgs.length);
          if (_clashPending) _clashNoteAndSend(card, _kind, _imgs, _swap);
          else {
            _clashEarlyNotes.push({ card, kind: _kind, subImgs: _imgs, swapImg: _swap, swapInfo: null, at: Date.now() });
            if (_onlineMode && _sendCommand) { try { _sendCommand({ type: 'fx_clashNote', cardName: card.name || '', kind: _kind, subImgs: _imgs, swapImg: _swap || '' }); } catch (_) {} }
          }
        }
      } catch (e) { console.error('[clash note wbd]', e); }
      return _oc2(...a);
    };
  }
  const ctxWBD = _hooks.makeEffectContext(card, side);
  // 置換効果（「〜することで、消滅しない」）で付いた「消滅しない」は、この消滅を防ぐだけで外す（ターン終了まで残さない）
  const _wbBefore = new Set(Array.isArray(card.buffs) ? card.buffs : []);
  const checkPrevented = () => {
    // 【アーマー解除】で一番上のカードを破棄したら、残った下のカードに「消滅しない」が付いている
    const cur = card._armorPurgedTo || card;
    const prevented = !!(cur.buffs && cur.buffs.some(b =>
      b.type === 'keyword_prevent_battle_destroy' || b.type === 'keyword_prevent_destroy'
    ));
    if (Array.isArray(cur.buffs)) {
      cur.buffs = cur.buffs.filter(b => _wbBefore.has(b) || !(b && (b.type === 'keyword_prevent_destroy' || b.type === 'keyword_prevent_battle_destroy')));
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
// 【道連れ】の演出: 巻き込まれるカード（victim）の盤面の場所で、もやが引きずり込む演出（battle-fx.js fxBoardMichizure）。
// 相手の画面にも同じ演出を送る（相手から見た側に読み替える）。盤面の場所が分からなければ「💀 道連れ！」＋消滅の演出。
// slot: { side:'player'|'ai', idx }（victim がいた枠。もう盤面からは外していてよい）、loserSide: 【道連れ】を持っていた側
// 流れ（ピエモン BT2-080 で決めた演出）: バトルで負けた【道連れ】のデジモンは通常のバトルと同じくVS画面の隅のトラッシュへ →
// 道連れから発揮するなら、VS画面のまま、そのトラッシュから黒いもやが出て相手のデジモンを包み、引きずり込む（_michiVsHook で出し済み）。
// 他の効果の後に発揮するときは盤面で演出する。loser・victimRole は相手の画面へ送る情報
// 【道連れ】で場から外したデジモンを、オンラインの相手の画面からも外す（以前は送っておらず、相手の画面に消滅したはずの
// デジモンが残っていた。ピエモン BT2-080 台帳）。side: 'player'＝自分のデジモン / 'ai'＝相手のデジモン（持ち主の端末が消滅時を発揮）
function _michiSyncRemoved(side, idx) {
  if (!_onlineMode || !_sendCommand || idx == null || idx < 0) return;
  try {
    if (side === 'player') _sendCommand({ type: 'own_card_removed', slotIdx: idx, reason: 'destroy' });
    else {
      _sendCommand({ type: 'card_removed', zone: 'battle', slotIdx: idx, reason: 'destroy' });
      if (window._markDestroyed) window._markDestroyed('ai', idx);
    }
  } catch (e) { console.error('[michiSyncRemoved]', e); }
}
function playMichizureFx(victim, slot, loserSide, cb, loser, victimRole) {
  // バトル（VS画面）の黒い背景が残っていると盤面の演出が見えず、画面が真っ暗のままになる（ピエモン BT2-080）
  try { hideCombatBackdrop(); } catch (_) {}
  // VS画面の決着で道連れの演出を出し済み（_michiVsHook）なら重ねない
  const _pl = window._michiVsPlan;
  if (_pl && _pl.shown && victim && _pl.victimName === victim.name && Date.now() - _pl.at < 120000) {
    window._michiVsPlan = null;
    cb && cb();
    return;
  }
  if (_onlineMode && _sendCommand) {
    try { _sendCommand({ type: 'fx_michizure', board: { victimSide: slot.side === 'player' ? 'opp' : 'self', idx: slot.idx, cardNo: (victim && victim.cardNo) || '', name: (victim && victim.name) || '', img: (victim && cardImg(victim)) || '' },
      vs: loser ? { name: loser.name || '', cardNo: loser.cardNo || '', img: cardImg(loser) || '', victimRole: victimRole || 'def' } : null }); } catch (_) {}
  }
  // VS画面で出していない【道連れ】（他の効果の後に発揮した）は盤面で演出する（ユーザー決定事項。VS画面を出し直さない）
  void victimRole;
  const fx = window._fxBoardMichizure;
  if (fx && fx({ card: victim, slot }, loserSide, cb)) return;
  showMichizureAnnounce(() => showDestroyEffect(victim, cb), true);
}
if (typeof window !== 'undefined') window._playMichizureFx = playMichizureFx;

function showMichizureAnnounce(callback, noSend) {
  if (!noSend && _onlineMode && _sendCommand && !window._suppressFxSend) {
    try { _sendCommand({ type: 'fx_michizure' }); } catch (_) {}
  }
  // VS画面の決着で【道連れ】（黒いもやが引きずり込む演出）を見せたなら重ねない（1回分。長い演出の後でも出さない）
  if (window._clashRecoilPending > 0 && window._clashRecoilAt && Date.now() - window._clashRecoilAt < 60000) { window._clashRecoilPending = 0; callback && callback(); return; }
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

// 【消滅時】と【道連れ】の両方を持つデジモンがバトルで消滅したとき、どちらから発揮するかを持ち主が選ぶ
// （同時に誘発した自分の効果は、発揮する順を自分で選ぶ。公式ルール 15-4-3-4）。
// 【消滅時】（本体・進化元）を持たないなら聞かずに 'michizure'。cb('destroy' | 'michizure')
// force: 【消滅時】が無くても聞く（同じ側の「自分のデジモンが消滅したとき」等、他に同時に誘発した効果があるとき。_michiVsHook）
function askMichizureOrder(card, cb, force) {
  let hasOnDestroy = false;
  try { hasOnDestroy = !!card && (_hasRecipeTrigger(card, 'on_destroy') || _hasEvoStackTrigger(card, 'on_destroy')); } catch (_) {}
  if (!hasOnDestroy && !force) { cb('michizure'); return; }
  // 同時に誘発した効果の順番は、通常の効果の順番選択の画面で選ぶ（ユーザー決定事項 2026-11-24。専用の画面は作らない）
  if (typeof window._showQueueOrderSelect === 'function') {
    try {
      const entries = [];
      const kinds = [];
      const blk = (code, extra) => Object.assign({ raw: '', trigger: { code }, actions: [], conditions: [] }, extra || {});
      // 【道連れ】
      entries.push({ card, block: blk('michizure', { _grantedSteps: [{ action: 'michizure', display_text: '【道連れ】', _kwFlag: 'michizure' }] }) });
      kinds.push('michizure');
      // このデジモンの【消滅時】（本体・進化元）
      try {
        if (_hasRecipeTrigger(card, 'on_destroy')) { entries.push({ card, block: blk('on_destroy', { raw: card.effect || '' }) }); kinds.push('destroy'); }
        (card.stack || []).forEach((src) => {
          if (src && !src._faceDown && _hasEvoStackTrigger({ stack: [src] }, 'on_destroy')) { entries.push({ card, block: blk('on_destroy', { _recipeCard: src }) }); kinds.push('destroy'); }
        });
      } catch (_) {}
      // 同じ側の他のカードの「自分のデジモンが消滅したとき」等
      try {
        const rival = window._battleMichizureRivalTriggers;
        const P = bs.player || {};
        if (typeof rival === 'function') {
          [...(P.battleArea || []), ...(P.tamerArea || [])].forEach((c) => {
            if (!c || c === card) return;
            if (rival('player', { name: '', stack: [] }, { player: { battleArea: [c], tamerArea: [] } }, 'loser')) { entries.push({ card: c, block: blk('on_destroy', { raw: c.effect || '' }) }); kinds.push('destroy'); }
          });
        }
      } catch (_) {}
      if (entries.length < 2) { entries.push({ card, block: blk('on_destroy', { _grantedSteps: [{ action: 'other', display_text: 'ほかに同時に誘発した効果' }] }) }); kinds.push('destroy'); }
      window._showQueueOrderSelect(entries, (i) => {
        const val = kinds[i] === 'destroy' ? 'destroy' : 'michizure';
        addLog('↕ 「' + (card.name || '') + '」は' + (val === 'destroy' ? (hasOnDestroy ? '【消滅時】' : 'ほかの効果') : '【道連れ】') + 'から発揮');
        cb(val);
      });
      return;
    } catch (e) { console.error('[askMichizureOrder]', e); }
  }
  const overlay = document.createElement('div');
  overlay.id = '_michizure-order';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:65000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);padding:16px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#0a0a14;border:2px solid #ff5577;border-radius:12px;padding:18px;max-width:420px;width:100%;text-align:center;color:#fff;box-shadow:0 0 24px rgba(255,85,119,0.45);';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:15px;font-weight:bold;color:#ff8899;margin-bottom:8px;';
  title.innerText = '「' + (card.name || '') + '」の効果を発揮する順番';
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:12px;color:#ccc;line-height:1.6;margin-bottom:14px;';
  sub.innerText = (hasOnDestroy ? '【消滅時】' : 'ほかの効果') + 'と【道連れ】が同時に誘発しました。どちらから発揮しますか？';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';
  const mk = (label, val, color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'flex:1 1 140px;padding:10px 14px;border-radius:8px;border:2px solid ' + color + ';background:#111;color:' + color + ';font-size:14px;font-weight:bold;cursor:pointer;';
    b.innerText = label;
    b.onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); addLog('↕ 「' + (card.name || '') + '」は' + (val === 'destroy' ? (hasOnDestroy ? '【消滅時】' : 'ほかの効果') : '【道連れ】') + 'から発揮'); cb(val); };
    return b;
  };
  row.appendChild(mk(hasOnDestroy ? '【消滅時】から' : 'ほかの効果から', 'destroy', '#00fbff'));
  row.appendChild(mk('【道連れ】から', 'michizure', '#ff5577'));
  box.appendChild(title); box.appendChild(sub); box.appendChild(row);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
// VS画面の決着で【道連れ】の順番をもう決めていれば（_michiVsHook）、それを使う。決めていなければ今までどおり聞く
function _michiPlanFor(card) {
  const pl = typeof window !== 'undefined' ? window._michiVsPlan : null;
  if (!pl || !card || pl.loserName !== card.name || Date.now() - pl.at > 120000) return null;
  return pl;
}
function michizureOrder(card, cb) {
  const pl = _michiPlanFor(card);
  if (pl && (pl.order === 'michizure' || pl.order === 'destroy')) {
    if (pl.order === 'destroy') window._michiVsPlan = null;
    cb(pl.order);
    return;
  }
  if (pl) window._michiVsPlan = null;
  askMichizureOrder(card, cb);
}
if (typeof window !== 'undefined') window._askMichizureOrder = michizureOrder;

// バトルの決着（LOSE が出た後）、VS画面を閉じる前: 【道連れ】になるなら、同時に誘発した効果と合わせて順番を決める
// （ピエモン BT2-080。ユーザー決定事項 2026-11-24）。
//  ・道連れの側が非ターンプレイヤーで、ターンプレイヤー（勝った側）にも誘発した効果がある → ターンプレイヤーの効果が先
//    （公式ルール 15-4-3-5）。ここでは決めず、今までどおり後で選ぶ・盤面で演出
//  ・道連れの側に他の効果（【消滅時】・「自分のデジモンが消滅したとき」等）もある → VS画面の上で順番を選ぶ（CPU は道連れから）
//  ・他に無い → 道連れから
//  道連れからなら、そのままVS画面で演出（負けたカードが入ったトラッシュから黒いもや → 相手を引きずり込む）。実際の消滅は
//  それぞれの経路で行い、演出は出し済みなので重ねない（playMichizureFx）
// オンラインで【道連れ】のデジモンが相手（持ち主はもう一方の端末）のとき: 順番を選ぶのは持ち主（公式ルール 15-4-3-4）。
// バトルを解決する端末 → 持ち主の端末へ michi_q（mode: 'ask' 選んでほしい / 'later' 先に解決する効果があるので選ばない /
// 'none' 道連れにならない）、持ち主の端末 → michi_a（order）。届いた方が先なら取っておく
let _michiQBuf = null, _michiQWait = null, _michiABuf = null, _michiAWait = null;
function _michiRecv(kind, cmd) {
  if (kind === 'q') {
    if (cmd && cmd.board) { _michiBoardAsk(cmd); return; }
    if (_michiQWait) { const f = _michiQWait; _michiQWait = null; f(cmd); return; }
    // こちらのVS画面はまだ始まっていないことがある（相手の端末の方が先に決着する）ので、決着まで取っておく。
    // VS画面が決着を待たずに閉じたときも、_michiVsHookRemote（skip）が取っておいた問い合わせに返す
    _michiQBuf = { cmd, at: Date.now() };
  }
  else { if (_michiAWait) { const f = _michiAWait; _michiAWait = null; f(cmd); } else _michiABuf = { cmd, at: Date.now() }; }
}
// 盤面で順番を聞く（ターンプレイヤーの効果を解決した後。相手の端末から michi_q board:true）
function _michiBoardAsk(q) {
  const send = (order) => { try { _sendCommand && _sendCommand({ type: 'michi_a', order }); } catch (_) {} };
  try {
    const tr = (bs.player && bs.player.trash) || [];
    let card = null;
    for (let i = tr.length - 1; i >= 0; i--) { const c = tr[i]; if (c && c.name === q.loserName && (!q.loserNo || c.cardNo === q.loserNo)) { card = c; break; } }
    if (!card) card = { name: q.loserName || '', cardNo: q.loserNo || '' };
    const rival = window._battleMichizureRivalTriggers || (() => true);
    if (!rival('player', card, bs, 'loser')) { send('michizure'); return; }
    askMichizureOrder(card, send, true);
  } catch (e) { console.error('[michiBoardAsk]', e); send('destroy'); }
}
// 相手の【道連れ】のデジモンの順番を、持ち主の端末に盤面で聞く。cb('michizure' | 'destroy')
function _askRemoteMichiOrder(card, cb) {
  _michiABuf = null;
  try { _sendCommand({ type: 'michi_q', mode: 'ask', board: true, loserName: (card && card.name) || '', loserNo: (card && card.cardNo) || '' }); } catch (_) { cb('destroy'); return; }
  _michiWait('a', (a) => cb(a && a.order === 'michizure' ? 'michizure' : 'destroy'));
}
function _michiAnswerLater(q) {
  if (q && q.mode === 'ask' && _sendCommand) { try { _sendCommand({ type: 'michi_a', order: 'destroy' }); } catch (_) {} }
}
function _michiWait(kind, cb) {
  const buf = kind === 'q' ? _michiQBuf : _michiABuf;
  if (kind === 'q') _michiQBuf = null; else _michiABuf = null;
  if (buf && Date.now() - buf.at < 120000) { cb(buf.cmd); return; }
  if (kind === 'q') _michiQWait = cb; else _michiAWait = cb;
}
if (typeof window !== 'undefined') {
  window._onMichiQ = (cmd) => _michiRecv('q', cmd);
  window._onMichiA = (cmd) => _michiRecv('a', cmd);
}
// 相手の端末が解決したバトルの決着（こちらは見ているだけ）: こちらの【道連れ】のデジモンが負けたら、相手の端末の問い合わせを待ち、
// こちらのVS画面の上で順番を選んで返す
function _michiVsHookRemote(p, out, remoteInfo, go) {
  // 待たないときは、届いている問い合わせに返しておく（相手の端末を待たせない）
  const skip = () => { const b = _michiQBuf; _michiQBuf = null; if (b) _michiAnswerLater(b.cmd); go(); };
  if (!_onlineMode || !_sendCommand || !remoteInfo || !remoteInfo.recoilName || !p.winner || p.winner === 'tie') { skip(); return; }
  const w = p.winner, ls = w === 'atk' ? 'def' : 'atk';
  const turnSide = bs.isPlayerTurn ? 'player' : 'ai';
  const loserSide = ls === 'atk' ? turnSide : (turnSide === 'player' ? 'ai' : 'player');
  if (loserSide !== 'player') { skip(); return; } // 相手の【道連れ】: 相手の端末で決めて演出が届く
  const loser = (ls === 'atk' ? p.atkReal : p.defReal) || p[ls];
  const winner = (w === 'atk' ? p.atkReal : p.defReal) || p[w];
  _michiWait('q', (q) => {
    try {
      if (!q || q.mode !== 'ask' || !loser || !winner) { go(); return; }
      const answer = (order) => {
        try { _sendCommand({ type: 'michi_a', order }); } catch (_) {}
        if (order === 'michizure' && typeof window._fxVsMichizure === 'function') window._fxVsMichizure(loser, winner, w, go);
        else go();
      };
      const rival = window._battleMichizureRivalTriggers || (() => true);
      if (!rival('player', loser, bs, 'loser')) { answer('michizure'); return; }
      askMichizureOrder(loser, answer, true);
    } catch (e) { console.error('[michiVsHookRemote]', e); go(); }
  });
}
function _michiVsHook(p, out, remoteInfo, go) {
  try {
    if (remoteInfo || p.remote) { _michiVsHookRemote(p, out, remoteInfo, go); return; } // 相手の端末で決まった決着
    const w = _clashRecoilSide(p);
    if (!w) { go(); return; }
    const ls = w === 'atk' ? 'def' : 'atk';
    const turnSide = bs.isPlayerTurn ? 'player' : 'ai';
    const loserSide = ls === 'atk' ? turnSide : (turnSide === 'player' ? 'ai' : 'player');
    const winSide = loserSide === 'player' ? 'ai' : 'player';
    // 相手の【道連れ】（オンライン）: 持ち主の端末は問い合わせを待っているので、どの場合も必ず返す
    const oppLoser = !!(_onlineMode && _sendCommand && loserSide === 'ai');
    const sendQ = (mode) => { if (oppLoser) { try { _sendCommand({ type: 'michi_q', mode }); } catch (_) {} } };
    if (!['trash', 'indomitable'].includes(out && out[ls])) { sendQ('none'); go(); return; } // 負けた側が消滅しなかった
    const loser = (ls === 'atk' ? p.atkReal : p.defReal) || p[ls];
    const winner = (w === 'atk' ? p.atkReal : p.defReal) || p[w];
    if (!loser || !winner || typeof window._fxVsMichizure !== 'function') { sendQ('none'); go(); return; }
    const rival = window._battleMichizureRivalTriggers || (() => true);
    const plan = { loserName: loser.name, victimName: winner.name, at: Date.now(), order: 'later' };
    window._michiVsPlan = plan;
    if (loserSide !== turnSide && rival(winSide, winner, bs, 'winner')) { sendQ('later'); go(); return; }
    if (oppLoser) {
      // 持ち主の端末で選んでもらう（こちらのカードは同期した写しなので、持ち主の端末が本物のカードで判断する）
      sendQ('ask');
      _michiWait('a', (a) => {
        if (a && a.order === 'michizure') { plan.order = 'michizure'; plan.shown = true; window._fxVsMichizure(loser, winner, w, go); }
        else { plan.order = 'destroy'; go(); }
      });
      return;
    }
    const playVs = () => {
      plan.order = 'michizure'; plan.shown = true;
      if (_onlineMode && _sendCommand) {
        try { _sendCommand({ type: 'fx_michiVs', victimRole: w, loser: { name: loser.name || '', cardNo: loser.cardNo || '', img: cardImg(loser) || '' }, victim: { name: winner.name || '', cardNo: winner.cardNo || '', img: cardImg(winner) || '' } }); } catch (_) {}
      }
      window._fxVsMichizure(loser, winner, w, go);
    };
    if (!rival(loserSide, loser, bs, 'loser')) { playVs(); return; }
    if (loserSide === 'player') {
      askMichizureOrder(loser, (o) => { if (o === 'michizure') playVs(); else { plan.order = 'destroy'; go(); } }, true);
      return;
    }
    playVs(); // CPU は道連れから
  } catch (e) { console.error('[michiVsHook]', e); go(); }
}

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
  // アタックが終わったのに決着していないVS画面が残っていれば閉じる
  if (_clashPending) _clashFinish('', () => {}, { cleanup: true });
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
  // デュアルカードはオプション側（下段）の色で判定する（「色（下段）」が空ならデジモン側の色と同じ）。
  // 区切りの「/」は色ではないので除く（「黄/緑」の「/」が場の多色カードに一致していた）
  const _useColor = (optionCard.type === 'デュアル' && optionCard.optionColor) ? optionCard.optionColor : optionCard.color;
  const optColors = String(_useColor || '').split('').filter(ch => '赤青黄緑黒紫白'.includes(ch));
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
  // 「：」を含む名称（「ジャスティモン：ブリッツアーム」P-203）・「：」以降の部分一致（名称「巫女モード」を含む P-223）は
  // 「：」以降も含めた名前でも比べる
  const matches = (c) => test(_baseCardName(c.name)) || test(String(c.name || '')) || cardAliasHasName(c, reqName, exact);
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

// ===== 進化条件の読み取り（部品ごと） =====
// 進化条件列は「/」区切りの条件（クローズ）の並び。1つのクローズを、前に付く条件・特徴・名称・記述・
// 登場コスト・色・Lv・テイマー等の部品に分けて読み、全ての部品を満たす進化元にだけ進化できる。
// 部品は前から順に読むので、「自分の「X」がいる間、名称「Y」」「特徴「A」を持つ名称「B」」
// 「3色以外の「C」」「特徴に「D」を持たない「E」を含むLv.4」のように、名称の前に条件をいくつ付けてもよい。
// 読めない文字が残ったクローズは「どの進化元にも一致しない」扱いにする（以前は一部だけ読んで
// 「「ジェムモン」記述Lv.2」が全ての Lv.2 から進化できる等、広く一致してしまっていた）。
//
// クローズの種別（どの進化コスト列を使うか）:
//   name    … 名称の指定がある（特徴「A」を持つ名称「B」も名称）。名称が無くても記述・登場コスト・下のカード・色の数・特徴を持たない だけのもの
//   feature … 名称が無く、進化元自身の特徴を「持つ」指定がある（特徴「A」Lv.5／特徴「A」を持つテイマー）
//   color   … 色・Lv だけ
const _EVO_COLOR_CHARS = '赤青黄緑黒紫白';

// 表記ゆれをそろえる（全角数字・空白・「L.4」「Lv4」・「含む」の「を」抜け・「特徴:X」「特徴X」「名称:X」）
function _normalizeEvoClause(raw) {
  let s = String(raw || '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/[\s　]+/g, '');
  s = s.replace(/特徴[:：]?(?!に「|「)([^「」\/:：]+?)(?=L[vV]?[.．]?\d|を持|$)/g, '特徴「$1」');
  s = s.replace(/名称[:：](?!「)([^「」\/]+?)(?=L[vV]?[.．]?\d|を含|$)/g, '名称「$1」');
  s = s.replace(/L[vV]?[.．]?(\d+)/g, 'Lv.$1');
  s = s.replace(/([^を])含([むみ])/g, '$1を含$2');
  return s;
}

function _evoColorsOf(card) {
  return String((card && card.color) || '').split('').filter((ch) => _EVO_COLOR_CHARS.includes(ch));
}
function _evoHasFeature(card, f) {
  return String((card && card.feature) || '').split(/[\/／]/).map((x) => x.trim()).includes(f);
}
function _evoCmp(v, n, mode) {
  if (mode === '以下') return v <= n;
  if (mode === '以上') return v >= n;
  return v === n;
}

// 部品の読み方。re は残りの文字列の先頭に当てる。fn は { kind, test(base, ctx) } を返す（kind が無い部品はつなぎ言葉）
const _EVO_TOKENS = [
  // --- 前に付く条件（進化元ではなく自分の状況を見る） ---
  { re: /^自分の(?:場に)?「(.+?)」(を含むカード)?がいる間、/, fn: (m) => ({ kind: 'cond', test: (b, ctx) => {
    const p = bs && bs[ctx.side]; if (!p) return false;
    const cards = [...(p.battleArea || []), ...(p.tamerArea || [])].filter(Boolean);
    return cards.some((c) => _cardHasEvolveName(c, m[1], !m[2]));
  } }) },
  { re: /^自分のセキュリティが(\d+)枚(以下|以上)?の間、/, fn: (m) => ({ kind: 'cond', test: (b, ctx) => {
    const p = bs && bs[ctx.side]; if (!p) return false;
    return _evoCmp((p.security || []).length, Number(m[1]), m[2]);
  } }) },
  // --- 進化元の下のカード ---
  { re: /^進化元に「(.+?)」(を含むカード)?がある/, fn: (m) => ({ kind: 'stack', test: (b) =>
    (Array.isArray(b.stack) ? b.stack : []).some((c) => c && _cardHasEvolveName(c, m[1], !m[2])) }) },
  { re: /^特徴「(.+?)」を持つカードが(?:下|進化元)に(\d+)枚(以上|以下)?ある/, fn: (m) => ({ kind: 'stack', test: (b) =>
    _evoCmp((Array.isArray(b.stack) ? b.stack : []).filter((c) => c && _evoHasFeature(c, m[1])).length, Number(m[2]), m[3]) }) },
  // --- 特徴 ---
  { re: /^特徴に?「(.+?)」を持たない/, fn: (m) => ({ kind: 'notfeature', test: (b) => !_evoHasFeature(b, m[1]) }) },
  { re: /^名称に「(.+?)」を含[みむ]/, fn: (m) => ({ kind: 'name', test: (b) => _cardHasEvolveName(b, m[1], false) }) },
  // 「特徴「水棲」を含む」（BT24-028 等）・「特徴「三銃士」記述」（LM-067）＝特徴のどれかにその文字を含む
  { re: /^特徴に?「(.+?)」(?:を含[むみ]|の?記述(?:がある)?)/, fn: (m) => ({ kind: 'feature', test: (b) =>
    String(b.feature || '').split(/[\/／]/).some((x) => x.trim().includes(m[1])) }) },
  { re: /^特徴に?「(.+?)」(?:を持つ|を持ち)?/, fn: (m) => ({ kind: 'feature', test: (b) => _evoHasFeature(b, m[1]) }) },
  // --- 色の数・色以外 ---
  { re: /^(\d+)色以外の/, fn: (m) => ({ kind: 'colorcount', test: (b) => _evoColorsOf(b).length !== Number(m[1]) }) },
  { re: /^(\d+)色(以上|以下)?の/, fn: (m) => ({ kind: 'colorcount', test: (b) => _evoCmp(_evoColorsOf(b).length, Number(m[1]), m[2]) }) },
  { re: /^([赤青黄緑黒紫白]+)以外の/, fn: (m) => ({ kind: 'colornot', test: (b) => !_evoColorsOf(b).some((c) => m[1].includes(c)) }) },
  // --- 登場コスト ---
  { re: /^登場コストを持たない/, fn: () => ({ kind: 'playcost', test: (b) => b.playCost == null }) },
  { re: /^登場コスト(\d+)(以下|以上)?の?/, fn: (m) => ({ kind: 'playcost', test: (b) => b.playCost != null && _evoCmp(Number(b.playCost), Number(m[1]), m[2]) }) },
  // --- 記述・名称 ---
  { re: /^「(.+?)」の?記述(?:がある)?/, fn: (m) => ({ kind: 'desc', test: (b) => _cardHasDescription(b, m[1]) }) },
  { re: /^(?:名称)?「(.+?)」(を含む)?/, fn: (m) => ({ kind: 'name', test: (b) => _cardHasEvolveName(b, m[1], !m[2]) }) },
  { re: /^([^「」]+?)：コスト\d+$/, fn: (m) => ({ kind: 'name', test: (b) => _cardHasEvolveName(b, m[1], true) }) },
  // --- 色・Lv・カードの種類 ---
  { re: /^([赤青黄緑黒紫白]+)(?=Lv\.)/, fn: (m) => ({ kind: 'color', test: (b, ctx) => ctx.ignoreColor || _evoColorsOf(b).some((c) => m[1].includes(c)) }) },
  { re: /^Lv\.(\d+)/, fn: (m) => ({ kind: 'lv', test: (b) => String(b.level == null ? '' : b.level).trim() === m[1] }) },
  { re: /^テイマー/, fn: () => ({ kind: 'tamer', test: (b) => b.type === 'テイマー' }) },
  { re: /^デジモン/, fn: () => ({ kind: 'digimon', test: (b) => b.type !== 'テイマー' }) },
  // --- つなぎ言葉 ---
  { re: /^(?:を持つ|を持ち|かつ|の|、)/, fn: () => ({}) },
];
// これらのどれかが無いクローズ（「赤」だけ等）は進化元を決められないので不成立
const _EVO_HEAD_KINDS = ['lv', 'name', 'tamer', 'digimon', 'feature', 'desc', 'playcost', 'stack'];

// 1クローズを読む。戻り値 { c, ok, kinds, tests, type }
function _parseEvoClause(raw) {
  const c = String(raw || '').trim();
  let s = _normalizeEvoClause(c);
  const kinds = [], tests = [];
  let ok = s.length > 0;
  while (ok && s.length > 0) {
    let hit = false;
    for (const t of _EVO_TOKENS) {
      const m = s.match(t.re);
      if (!m || m[0].length === 0) continue;
      const part = t.fn(m);
      if (part.kind) { kinds.push(part.kind); tests.push(part.test); }
      s = s.slice(m[0].length);
      hit = true;
      break;
    }
    if (!hit) ok = false;
  }
  if (ok && !kinds.some((k) => _EVO_HEAD_KINDS.includes(k))) ok = false;
  // テイマーも名称も指定していないクローズはデジモンからだけ（「特徴「A」」だけのクローズがテイマーに一致しないように）
  if (ok && !kinds.includes('tamer') && !kinds.includes('name')) tests.push((b) => b.type !== 'テイマー');
  // コスト列は「何から進化するか」で選ぶ: 名称の指定があれば名称（特徴「A」を持つ名称「B」も名称）、
  // 名称が無く特徴を持つ指定があれば特徴（特徴「A」Lv.5／特徴「A」を持つテイマー）、
  // 記述・登場コスト・下のカード等だけなら名称、色・Lv だけなら色
  const type = kinds.includes('name') ? 'name'
    : kinds.includes('feature') ? 'feature'
    : kinds.some((k) => k === 'desc' || k === 'playcost' || k === 'stack' || k === 'notfeature' || k === 'colorcount') ? 'name'
    : 'color';
  return { c, ok, kinds, tests, type };
}

// 進化条件列を読む（同じ文字列は使い回す）。空のクローズ（「//」）は飛ばす。typeIdx は同じ種別の中で何番目か
const _evoCondCache = new Map();
function _parseEvolveCond(cond) {
  const key = String(cond || '').trim();
  if (!key || key === 'なし') return [];
  if (_evoCondCache.has(key)) return _evoCondCache.get(key);
  const seen = { color: 0, feature: 0, name: 0 };
  const entries = key.split('/').map((x) => x.trim()).filter(Boolean).map((x) => {
    const e = _parseEvoClause(x);
    e.typeIdx = seen[e.type]++;
    if (!e.ok) console.warn('[進化条件] 読めない条件のため、この条件では進化できません: 「' + x + '」');
    return e;
  });
  _evoCondCache.set(key, entries);
  return entries;
}
if (typeof window !== 'undefined') window._parseEvolveCond = _parseEvolveCond;

// 進化条件マッチング本体。一致したクローズ { c, type, typeIdx, ... } を返す（無ければ null）。
// getEvolveCostFor は type と typeIdx で、進化コスト（色）/（特徴）/（名称）列のどの値を使うかを決める。
// 優先順位: 名称・特徴等のクローズを色クローズより先に判定する（書かれている順序に関わらず）
function _resolveEvolveMatch(evoCard, baseCard) {
  if (!evoCard || !baseCard) return null;
  const entries = _parseEvolveCond(evoCard.evolveCond);
  if (entries.length === 0) return null;
  const side = _ownerSideOfCard(evoCard);
  // 進化先が「色条件を無視できる」（ignore_evolve_color・gate 成立中）なら色の部品を判定しない
  const ctx = { side, ignoreColor: _ignoresColorCondition(evoCard, side) };
  const order = entries.slice().sort((a, b) => (a.type === 'color' ? 1 : 0) - (b.type === 'color' ? 1 : 0));
  for (const e of order) {
    if (e.ok && e.tests.every((t) => t(baseCard, ctx))) return e;
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
// カードごとに、各クローズがどのコスト列の何番目を使うかを決める。
// 名称と特徴の両方を指定したクローズ（「名称に「アグモン」を含み特徴「恐竜型」を持つLv.3」ST24-05）は、
// 名称列に値があれば名称列、名称列が空（なし）なら特徴列を使う（どちらに書いてもよい。2026-11-21 ユーザー指定）。
// 戻り値: [{ entry, type, typeIdx }]（進化条件の並び順）と counts（種別ごとのクローズ数）
function _evoCostPlan(card) {
  const entries = _parseEvolveCond(card && card.evolveCond);
  const nameEmpty = _pickCostFromList(card && card.evolveCostNameRaw, 0, 1) == null;
  const counts = { color: 0, feature: 0, name: 0 };
  const plan = entries.map((entry) => {
    let type = entry.type;
    if (type === 'name' && nameEmpty && entry.kinds.includes('name') && entry.kinds.includes('feature')) type = 'feature';
    return { entry, type, typeIdx: counts[type]++ };
  });
  return { plan, counts };
}
function _evoCostRawByType(card) {
  return { color: card.evolveCostRaw, feature: card.evolveCostFeatureRaw, name: card.evolveCostNameRaw };
}

export function getEvolveCostFor(evoCard, baseCard) {
  const match = _resolveEvolveMatch(evoCard, baseCard);
  if (!match) return evoCard.evolveCost; // フォールバック（代替進化等）
  const { plan, counts } = _evoCostPlan(evoCard);
  const p = plan.find((x) => x.entry === match);
  if (!p) return evoCard.evolveCost;
  const picked = _pickCostFromList(_evoCostRawByType(evoCard)[p.type], p.typeIdx, counts[p.type]);
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
  const { plan, counts } = _evoCostPlan(card);
  const RAW_BY_TYPE = _evoCostRawByType(card);
  const groups = [];
  plan.forEach(({ entry, type, typeIdx }) => {
    const c = entry.c;
    let cost = _pickCostFromList(RAW_BY_TYPE[type], typeIdx, counts[type]);
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
  if (!canPayMemory('player', _effPlayCost)) { addLog('🚨 「' + card.name + '」の' + memoryShortText('player', _effPlayCost)); delete card._costReduction; return; }
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
          _endBusy(() => { try { _hooks.applyPermanentEffects('player'); } catch (_) {} renderAll(); checkPlayerPendingTurnEnd(); });
        }));
      }, 'player');
    });
    return;
  }

  // ----- テイマー登場 -----
  if (card.type === 'テイマー') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    if (window._freshOnFieldEnter) window._freshOnFieldEnter(card);
    // 「登場したターン」の記録（テイマーから進化したデジモンは、テイマーが登場したターンにはアタックできない。BT27-048 Q7720）
    card.summonedThisTurn = true;
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
    _aiObservePlayer('play', card);
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
  // 「進化するとき」のコスト軽減ではない効果（P-074/P-075）を先に発揮する。その中の「〜1枚ごとに進化コスト-1」は軽減量で返る
  _fireBeforeEvolveEffects(card, bs, 'player', { base }, (_preDisc) => {
  if (_preDisc > 0) { cost = Math.max(0, cost - _preDisc); addLog('💠 効果で進化コスト-' + _preDisc + '（コスト' + cost + 'で進化）'); }
  _checkBeforeEvolveDiscount(card, bs, 'player', (discount) => {
    if (discount > 0) {
      cost = Math.max(0, cost - discount);
      addLog('💠 効果で進化コスト-' + discount + '（コスト' + cost + 'で進化）');
    }
    // 【吸収進化-N】: 進化先(card)自身が持つ能力。自分のデジモン1体をレストさせることで
    // 進化コストを-Nする（アルゴモン BT2-045等）
    _checkAbsorbEvolveDiscount(card, bs, 'player', (discount2) => {
      if (!canPayMemory('player', Math.max(0, cost - (discount2 > 0 ? discount2 : 0)))) {
        addLog('🚨 「' + card.name + '」への進化の' + memoryShortText('player', Math.max(0, cost - (discount2 > 0 ? discount2 : 0))));
        return;
      }
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
  });
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
  if (!canPayMemory('player', burstEvo.cost)) { addLog('🚨 バースト進化の' + memoryShortText('player', burstEvo.cost)); return; }
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
  _carryRestrictionFlags(evolved);
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
    _aiObservePlayer('evolve', evolved);
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

// 効果でアプ合体させる（「自分のデジモン1体を手札のデジモンカードにアプ合体できる」大空勇仁 P-240。公式 8-4-2-2）。
// 自分（player）側のみ。コストはアプ合体のコストを支払う。【進化時】まで解決したら onDone（ターン終了の判定は効果の側で）
export function doAppGattaiFromEffect(handIdx, slotIdx, onDone) {
  const card = bs.player.hand[handIdx];
  const base = bs.player.battleArea[slotIdx];
  const appGattai = card && base ? _getAppGattaiEvolve(card, base, bs, 'player') : null;
  if (!appGattai || !(appGattai.linkedPartners || []).length) { addLog('🚨 アプ合体の条件を満たしていません'); onDone && onDone(false); return; }
  _finishAppGattaiEvolve(card, base, handIdx, slotIdx, { cost: appGattai.cost, linkedPartners: appGattai.linkedPartners }, () => onDone && onDone(true));
}

function _finishAppGattaiEvolve(card, base, handIdx, slotIdx, appGattai, onDone) {
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
  _carryRestrictionFlags(evolved);
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
      const finishEvolve = () => (onDone ? onDone() : checkPlayerPendingTurnEnd());
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
  if (!canPayMemory(side === 'ai' ? 'ai' : 'player', cost)) { addLog('🚨 進化の' + memoryShortText(side === 'ai' ? 'ai' : 'player', cost)); callback && callback(false); return; }
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
  _carryRestrictionFlags(evolved);
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

// ===== テイマーからの進化（進化条件「特徴「倉田軍団」を持つテイマー」BT27-017/026/038/048・「〜がある「神原拓也」」AD1-002 等） =====
// 公式Q&A（BT27-048 Q7718〜7723・BT18-022 Q2933/2935/6589〜6592）:
//  - テイマーはデジモンとして扱わず、そのまま進化元になる（デジモンはバトルエリアへ。テイマーの下のカードも進化元）
//  - 「デジモンが進化するとき」「デジモンが進化したとき」の効果は誘発しない（進化するカード自身の【進化時】は発揮する）
//  - 進化ドローは行う
//  - テイマーが登場したターンはアタックできない（summonedThisTurn をテイマーから引き継ぐ）
//  - テイマーの進化元効果は得る／【セキュリティ】効果は得ない（進化元効果の読み取りがそうなっている）
// レスト/アクティブは通常の進化と同じく引き継ぐ。
// card: 進化先（手札）, tamer: 自分のテイマーエリアのテイマー, cost: 支払うコスト（軽減計算済み）, side: 'player'|'ai'
export function doEvolveFromTamer(card, tamer, cost, side, callback) {
  side = side === 'ai' ? 'ai' : 'player';
  const p = bs[side];
  const ti = (p.tamerArea || []).indexOf(tamer);
  if (!card || ti === -1) { callback && callback(false); return; }
  if (!canPayMemory(side, cost)) { addLog('🚨 「' + card.name + '」への進化の' + memoryShortText(side, cost)); callback && callback(false); return; }
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    _noMainAbility: card.type === 'デュアル',
    suspended: !!tamer.suspended,
    summonedThisTurn: !!tamer.summonedThisTurn,
    buffs: tamer.buffs || [], _grantedRecipes: tamer._grantedRecipes,
    dpModifier: 0,
    linkedCards: [],
    stack: [tamer].concat(tamer.stack || []),
    // 「デジモンが進化したとき」を誘発させない印（effect-engine の反応スキャンが見る。【進化時】の後に外す）
    _evolvedFromTamer: true,
  });
  evolved.dp = evolved.baseDp;
  p.tamerArea.splice(ti, 1);
  placeOnBattleArea(side, evolved);
  const _hi = p.hand.indexOf(card);
  if (_hi !== -1) p.hand.splice(_hi, 1);
  if (side === 'player') bs.selHand = null;
  addLog('⬆ テイマー「' + tamer.name + '」→「' + evolved.name + '」進化！（コスト ' + cost + '）');
  if (side === 'player' && _onlineMode && _sendCommand) {
    try { _sendCommand({ type: 'evolve', cardName: evolved.name, baseName: tamer.name || '', cardImg: evolved.imgSrc || '', evolveCost: cost }); } catch (_) {}
  }
  renderAll();
  if (side === 'player' && _onlineMode && window._onlineSendStateSync) { try { window._onlineSendStateSync(); } catch (_) {} }
  showEvolveEffect(cost, tamer.name, tamer, evolved, () => {
    // 公式ルール: コスト支払い(メモリー消費) → ドロー → 進化時効果 → ターン終了判定
    if (side === 'player') playerSpendMemory(cost, true);
    else aiSpendMemory(cost);
    doDraw(side, '進化ドロー', () => {
      const finish = () => { delete evolved._evolvedFromTamer; renderAll(true); callback && callback(true); };
      if (hasKeyword(evolved, '【進化時】')) _hooks.checkAndTriggerEffect(evolved, '【進化時】', finish, side);
      else finish();
    }, { deferDismiss: false });
  });
}

// テイマーへ進化できる手札のカードか（進化条件に合う・進化コストを持つ）
export function canEvolveOntoTamer(card, tamer) {
  if (!card || !tamer || tamer.type !== 'テイマー') return false;
  if (card.type !== 'デジモン' && card.type !== 'デュアル') return false;
  if (card.evolveCost == null && !card.evolveCostFeatureRaw && !card.evolveCostNameRaw) return false;
  return canEvolveOnto(card, tamer);
}

// 手札のカードを自分のテイマーへドロップしたとき（battle-render.js から呼ぶ）
export function doEvolveTamer(card, handIdx, tamerIdx) {
  if (bs.phase !== 'main' || _attackInProgress) return;
  const tamer = bs.player.tamerArea[tamerIdx];
  if (!tamer || !card) return;
  if (!canEvolveOntoTamer(card, tamer)) { addLog('🚨 「' + tamer.name + '」から「' + card.name + '」へは進化できません（' + (card.evolveCond || '進化条件なし') + '）'); return; }
  let cost = getEvolveCostFor(card, tamer);
  const _evoDisc = _consumePendingEvoCostReduction(card, tamer);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  let _staticEvo = 0;
  try { _staticEvo = _getStaticEvoCostReduction(card, tamer, bs, 'player'); } catch (_) {}
  if (_staticEvo !== 0) { cost = Math.max(0, cost - _staticEvo); addLog('💠 進化コスト' + (_staticEvo > 0 ? '-' + _staticEvo : '+' + (-_staticEvo)) + '（コスト' + cost + 'で進化）'); }
  // 「デジモンが進化するとき」の効果（before_evolve）は誘発しない（公式Q&A BT27-048 Q7718）。
  // 【吸収進化】は進化するカード自身の能力なので使える
  _checkAbsorbEvolveDiscount(card, bs, 'player', (discount2) => {
    const _final = Math.max(0, cost - (discount2 > 0 ? discount2 : 0));
    if (!canPayMemory('player', _final)) { addLog('🚨 「' + card.name + '」への進化の' + memoryShortText('player', _final)); return; }
    const _go = () => doEvolveFromTamer(card, tamer, _final, 'player', () => { checkPlayerPendingTurnEnd(); });
    if (discount2 > 0) { addLog('💠 吸収進化で進化コスト-' + discount2 + '（コスト' + _final + 'で進化）'); fireOppRestThen('player', _go); }
    else _go();
  });
}

// ===== 効果によるジョグレス進化（公式ルール 8-2） =====
// left: 上に重ねる進化元（ジョグレスの条件の左側） / right: その下。それぞれの進化元ごと重ねる（8-2-2-3）。
// 進化したデジモンは別の1体（新しいカード。8-2-2-1）: アクティブ・登場したターンの情報なし・付与された効果は失われる・
// 【ターンに1回】はリセット。リンクカードは重ねる前に破棄（8-2-2-1-2）。コスト支払い → 1枚ドロー → 【進化時】
// callback(evolved | false)
export function doJogressFromEffect(card, left, right, cost, side, callback, opts) {
  if (!canPayMemory(side === 'ai' ? 'ai' : 'player', cost)) { addLog('🚨 ジョグレス進化の' + memoryShortText(side === 'ai' ? 'ai' : 'player', cost)); callback && callback(false); return; }
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
function _handJogressPairs(card, base, side) {
  side = side === 'ai' ? 'ai' : 'player';
  if (!card || !base || (card.type !== 'デジモン' && card.type !== 'デュアル')) return [];
  let conds = [];
  try { conds = _getJogressConditions(card) || []; } catch (_) { conds = []; }
  if (conds.length === 0) return [];
  const mats = bs[side].battleArea.filter(c => c && c !== base && (c.type === 'デジモン' || c.type === 'デュアル' || !c.type));
  const out = [];
  conds.forEach((jc) => {
    mats.forEach((o) => {
      if (_jogressSlotMatches(base, jc.slots[0], bs, side) && _jogressSlotMatches(o, jc.slots[1], bs, side)) out.push({ left: base, right: o, cost: jc.cost });
      if (_jogressSlotMatches(o, jc.slots[0], bs, side) && _jogressSlotMatches(base, jc.slots[1], bs, side)) out.push({ left: o, right: base, cost: jc.cost });
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
  if (!canPayMemory('player', cost)) { addLog('🚨 「' + card.name + '」への進化の' + memoryShortText('player', cost)); return; }
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
  _carryRestrictionFlags(evolved);
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
    _aiObservePlayer('evolve', evolved);
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
      // 育成エリアのカードの効果は、育成エリアを指定・参照していない限り誘発しない（公式ルール 3-4-7-4
      // 「育成エリアのデジモンが【進化時】効果を持つカードに進化しても、そのデジモンの【進化時】効果は誘発しません」）
      if (hasKeyword(evolved, '【進化時】') && _ikuEvolveEffectAllowed(evolved)) {
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
  if (!canPayMemory('player', card.linkCost)) { addLog('🚨 「' + card.name + '」のリンク' + memoryShortText('player', card.linkCost)); return; }
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
  _carryRestrictionFlags(evolved);
  if (area === 'battle') p.battleArea[idx] = evolved;
  else p.ikusei = evolved;
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog((side === 'ai' ? '🤖 AIが' : '') + '「' + base.name + '」→「' + evolved.name + '」にアーツ進化！（コスト無し）');
  // 場に置いたらすぐ継続効果（【自分のターン】DP8000ごとにSアタック+1 等）を計算する。以前は【進化時】の後まで計算されず、
  // ルビウスドラモン＆バーニングドライブ ST25-05 のSアタック+1が、別の効果でDPが変わるまで付いていなかった
  try { _hooks.applyPermanentEffects(side); } catch (_) {}
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
// アタック・ブロックでのレスト（ルールによるレスト）の印。盤面の変化の演出（battle-fx.js boardStateDiff）は
// 効果の処理中のレストを「効果でレスト」として見せるので、≪急襲≫等の効果でのアタックのレストが効果のレストに見えていた
function _markRuleRest(c) { try { if (c && typeof window !== 'undefined') { if (!window._ruleRestSet) window._ruleRestSet = new WeakSet(); window._ruleRestSet.add(c); } } catch (_) {} }
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
// AI対戦（オフライン）: プレイヤーのアタックを CPU がブロックできるなら、先頭のブロッカーでブロックする。
// ブロックしたら true（バトルまで進める）。できなければ false（呼び出し元がそのまま続ける）
function _aiBattleTryBlock(atk, atkSlotIdx, targetIdx) {
  if (!window._aiBattleActive || _onlineMode || !atk) return false;
  if ((atk._permEffects && atk._permEffects.cantBeBlocked) || _cantRedirectAttack(atk)) return false;
  const noEvoOnly = !!(atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo);
  // 【衝突】: このデジモンのアタック中、相手（CPU）のデジモン全ては【ブロッカー】を得て、可能ならブロックしなければならない
  // （オンラインの防御側 checkOnlineBlock と同じ判定）
  const forced = _hasCollision(atk, 'player');
  const _canBlk = (c, i) => c && i !== targetIdx && _canBlockNow(c)
    && (forced ? (!c.type || c.type === 'デジモン') : isBlocker(c))
    && !(noEvoOnly && (!c.stack || c.stack.length === 0));
  let blockerIdx = bs.ai.battleArea.findIndex(_canBlk);
  if (blockerIdx < 0) {
    if (_aiIsMid() && atk) _aiWhy('あなたの「' + atk.name + '」のアタックは、ブロックせずに受けます ← ' + ((bs.ai.battleArea || []).some(c => c && isBlocker(c)) ? 'ブロッカーはいますが、レスト中などで今はブロックできないからです。' : 'ブロックできるデジモン（ブロッカー）がいないからです。'));
    return false;
  }
  // 中: ブロックするかと、どのデジモンでブロックするかを判断する（【衝突】でブロックが強制なら必ずブロック）
  if (_aiIsMid()) {
    const cands = bs.ai.battleArea.map((c, i) => (_canBlk(c, i) ? i : -1)).filter(i => i >= 0);
    const pick = _aiIsHigh() ? _aiHighChooseBlocker(atk, cands, targetIdx) : _aiMidChooseBlocker(atk, cands, targetIdx);
    if (pick >= 0) {
      blockerIdx = pick;
      const _bo = _aiBattleOutcome(atk, bs.ai.battleArea[pick], 'ai');
      _aiWhy('「' + bs.ai.battleArea[pick].name + '」でブロックします ← ' + (!_bo.defDies && _bo.atkDies ? 'ブロックすれば相手のデジモンを倒せて、こちらは生き残れるからです。' : !_bo.defDies ? 'ブロックしてもこちらは消滅しないので、セキュリティを守れるからです。' : _bo.atkDies ? '相打ちにして、相手のデジモンも一緒に倒せるからです。' : 'このデジモンは負けてしまいますが、セキュリティが少ないので身代わりにして守ります。'));
    }
    else if (forced) { blockerIdx = cands.slice().sort((a, b) => _dpOf(bs.ai.battleArea[a]) - _dpOf(bs.ai.battleArea[b]))[0]; _aiWhy('「' + bs.ai.battleArea[blockerIdx].name + '」でブロックします ← あなたのデジモンの【衝突】でブロックしなければならないので、失っても痛くない一番弱いデジモンを選びました。'); }
    else { addLog('🤖 AIはブロックしなかった'); _aiWhy('ブロックしません ← どのブロッカーで止めても負けてしまうからです。' + (hasPenetrate(atk) ? 'あなたのデジモンは【貫通】を持っているので、負けるブロックをしてもセキュリティは守れません。' : 'セキュリティにはまだ余裕があるので、デジモンを失う方が痛いと判断しました。')); return false; }
  }
  const blocker = bs.ai.battleArea[blockerIdx];
  blocker.suspended = true; _markRuleRest(blocker);
  addLog('🛡 [AI] 「' + blocker.name + '」でブロック！');
  renderAll();
  // AI 側のブロッカーがレストした → プレイヤー側の when_opp_rest + AI 側の when_own_block 発火
  fireBlockReactionThen('ai', () => {
    afterBlockedEffect(atk, atkSlotIdx, 'player', () => {
      resolveBattle(atk, atkSlotIdx, blocker, blockerIdx, 'ai');
    });
  });
  return true;
}

export function startAttack(card, slotIdx, callback) {
  // ≪進撃≫: メモリーが相手側のとき（bs.memory < 0）でも進撃持ちならアタック可（公式ルール 18-16）
  var chargeAllowed = card && hasCharge(card) && bs.memory < 0;
  // 宣言できないときは理由をログに出す（以前は何も出ず、対象を選んでもアタックが始まらない理由が分からなかった）
  if (bs.phase !== 'main' && !chargeAllowed) { addLog('🚨 アタックできません（メインフェイズではありません: ' + bs.phase + '）'); callback && callback(false); return false; }
  if (!card) { callback && callback(false); return false; }
  if (_attackInProgress) { addLog('🚨 アタックできません（前のアタックの処理が終わっていません）'); console.warn('[startAttack] _attackInProgress が残っています', { atkState: _atkState && _atkState.card && _atkState.card.name, resolving: bs._attackResolving }); callback && callback(false); return false; }
  if (chargeAllowed) addLog('⚔ 【進撃】「' + card.name + '」がメモリー相手側でアタック宣言');
  // アタック宣言でレストする（長押しメニューを開いただけではレストしない）
  // 公式ルール1194: レストさせることができないデジモンはアタック宣言ができない
  if (card.cantAttack || card.cantRest) { addLog('🚨 「' + card.name + '」はアタックできません（' + (card.cantAttack ? 'アタックできない効果' : 'レストできない効果') + '）'); callback && callback(false); return false; }

  // when_opp_rest の解決待ちの間、別の攻撃宣言で状態が競合しないようロックする
  // （resolveAttackTarget 到達時に改めて true になるが、多重にしても問題ない）
  _attackInProgress = true;
  bs._attackEndRequested = false; // 前のアタックの「アタックを終了させる」が残らないように
  // アタック（バトル・セキュリティチェック）の消滅演出は、効果の消滅演出のまとめ（window._destroyFxBatch）に入れず
  // その場で出す。【エグゼキュート】等の効果でアタックしたとき、セキュリティデジモンの消滅演出が
  // 効果のステップの終わり（アタック終了時の自壊の後）まで後回しになっていた
  if (typeof window !== 'undefined') window._destroyFxBatch = null;
  // 「レストせずアタックできる」（attack options:without_rest）ならレストしない（その1回のアタックだけ）
  if (!card._attackWithoutRest) { card.suspended = true; _markRuleRest(card); }
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
  return !!(c && (c.cantRedirectAttack || (c._permEffects && c._permEffects.cantRedirectAttack) || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'cant_redirect_attack'))));
}
function _consumeRedirectedAttack(defaultTarget, defaultIdx) {
  const ra = bs._redirectedAttack;
  bs._redirectedAttack = null;
  const fallback = { target: defaultTarget, idx: defaultIdx, def: defaultTarget === 'digimon' ? bs.ai.battleArea[defaultIdx] : null };
  if (!ra || ra.side !== 'ai') return fallback;
  // cant_redirect_attack:「アタックの対象は変更されない」— 元々の宣言先デジモンが
  // この状態なら、リダイレクトを適用せず元の宣言のまま解決する
  if (fallback.def && fallback.def.cantRedirectAttack) return fallback;
  // アタックしているデジモン自身が「アタックの対象は変更されない」なら変更しない（ヴァルキリモン LM-039）
  if (_atkState && _cantRedirectAttack(_atkState.card)) return fallback;
  const def = bs.ai.battleArea[ra.idx];
  if (!def) return fallback;
  return { target: 'digimon', idx: ra.idx, def, redirected: true, byDefender: !!ra.byDefender };
}

// 【衝突】を持つか（このデジモンのアタック中、相手のデジモン全ては【ブロッカー】を得て、可能ならブロックしなければならない）。
// オンラインではブロックするかどうかは防御側の端末が決めるので、アタック宣言コマンドに載せて伝える（巨神兵器 BT26-085）
// side: アタックしているデジモンの側（省略時 'player'。CPU のアタックでは 'ai'）
function _hasCollision(card, side) {
  if (!card) return false;
  if (card._permEffects && card._permEffects.collision) return true;
  if (Array.isArray(card.buffs) && card.buffs.some(b => b && b.type === 'keyword_collision')) return true;
  try { return !!_cardHasActivePassiveFlag(card, 'collision', bs, side || 'player'); } catch (_) { return false; }
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
  const tc = () => {
    if (typeof window._fireWhenTargetChangedLocal === 'function') window._fireWhenTargetChangedLocal('player', go);
    else go();
  };
  // 相手のデジモンがブロックでレストした → こちら（攻撃側）の「相手のデジモンがレストしたとき」を先に発火する
  // （オフライン・AI対戦の fireBlockReactionThen と同じ順番。マメティラモン P-141 の進化元を持つラストティラノモンが
  // ブロックされても、アクティブにする効果が出なかった）
  try { fireOppRestThen('ai', tc); } catch (e) { console.error('[_onlineBlockedThen oppRest]', e); tc(); }
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
// cur が atk と同じデジモンか: 同じカード／atk から進化した（stack に atk）／atk が退化した（_dedigiFrom をたどる）。
// 進化と退化が続いても同じ1体として扱う
function _isSameDigimon(cur, atk) {
  if (!cur || !atk) return false;
  const seen = new Set(); const q = [cur];
  while (q.length && seen.size < 40) {
    const n = q.shift(); if (!n || seen.has(n)) continue; seen.add(n);
    if (n === atk) return true;
    if (Array.isArray(n.stack) && n.stack.indexOf(atk) >= 0) return true;
    if (n._dedigiFrom) q.push(n._dedigiFrom);
  }
  return false;
}
function _attackerLeftField(atk, slotIdx) {
  // 相手の効果で「そのアタックを終了させる」（アンフィモン P-089）: ブロック・バトル・セキュリティチェックをせずにアタックを終える
  if (bs._attackEndRequested) {
    bs._attackEndRequested = false;
    addLog('✋ 「' + ((atk && atk.name) || '?') + '」のアタックは効果で終了した');
    bs._redirectedAttack = null;
    renderAll();
    checkAttackEnd(atk, slotIdx);
    return true;
  }
  const cur = bs.player.battleArea[slotIdx];
  if (_isSameDigimon(cur, atk)) return false;
  addLog('⚔ アタック中の「' + ((atk && atk.name) || '?') + '」がバトルエリアにいないので、アタックは成立しない');
  bs._redirectedAttack = null;
  renderAll();
  checkAttackEnd(atk, slotIdx);
  return true;
}
function _evolvedAttacker(atk, slotIdx) {
  const cur = bs.player.battleArea[slotIdx];
  if (cur && cur !== atk && _isSameDigimon(cur, atk)) return cur;
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
        blocker.suspended = true; _markRuleRest(blocker);
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
        // AI対戦: CPU はブロックできるならブロックする
        if (_aiBattleTryBlock(atk, atkSlotIdx, -1)) return;
        resolveSecurityCheck(atk, atkSlotIdx);
      });
    }
  } else if (target === 'digimon') {
    // デジモンアタック
    const def = bs.ai.battleArea[targetIdx];
    // アタックが成立しないまま戻るときは「アタック中」を外す（残っていると、以後のアタックが全て
    // 「前のアタックの処理が終わっていません」で断られていた）。相手には開始を送っているので終了も送る
    const _abortAttack = () => {
      atk.suspended = false;
      _attackInProgress = false;
      bs._attackResolving = false;
      if (_onlineMode && _sendCommand) { try { _sendCommand({ type: 'attack_end' }); } catch (_) {} }
      renderAll();
      // 【自分のターン終了時】の効果（≪急襲≫・雪片の絆 ED01-10 の【ディレイ】等）でのアタックが成立しなかったときも、
      // アタックの終わりを待っているその効果（とターン終了処理）を再開する（以前は待ったままでターンが終わらなかった）
      if (Array.isArray(bs._effectAttackResolveCbs) && bs._effectAttackResolveCbs.length > 0) {
        const cbs = bs._effectAttackResolveCbs.splice(0);
        cbs.forEach(cb => { try { cb(); } catch (e) { console.error('[effectAttackResolve]', e); } });
      }
    };
    if (!def) { _abortAttack(); return; }
    // アクティブ状態のデジモンには宣言できない（公式ルール）。突進は宣言時の対象拡張ではなく
    // 「宣言後、任意でDP最大のアクティブなデジモンへ対象を差し替える」効果のため、ここでの
    // 例外は無い（redirect_attack アクション経由でafterAtkEffect後に差し替わる）
    // ≪エグゼキュート≫でのアタック（_executeAttacking）は「アクティブ状態の相手のデジモンにもアタックできる」
    // （スカージキロプモン＆デスペアブラストでアクティブ状態のデジモンを選んでもアタックが始まらなかった）
    // 「アタックされない」・継続効果の「アクティブ状態の相手にもアタックできる」（P-051 / P-058）もここで判定する
    const _canAtkDef = window._canAttackDigimonTarget ? window._canAttackDigimonTarget(atk, def, bs, 'player') : (def.suspended || atk._executeAttacking);
    // 効果でのアタック1回分の「アクティブ状態にもアタックできる」（ED01-10）はここで使い切る（後の通常のアタックに残さない）
    delete bs._effectAttackAllowActive;
    if (!_canAtkDef) {
      addLog(def.suspended ? '🚨 このデジモンにはアタックできません' : '🚨 アクティブ状態のデジモンにはアタックできません');
      _abortAttack();
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
        blocker.suspended = true; _markRuleRest(blocker);
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
        // AI対戦: CPU はブロックできるならブロックする（効果でアタック先が変わったときはブロックの確認をしない）
        if (!_rt.redirected && _aiBattleTryBlock(atk, atkSlotIdx, _rt.idx)) return;
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
// アタックの【アタック時】・キーワードの効果の後: その間に誘発して後回しにした効果を、アタックを先に進める前に発揮する
function _flushAtAttackStep(cb) {
  if (typeof window !== 'undefined' && typeof window._flushNonTurnDeferredAtAttackStep === 'function') { window._flushNonTurnDeferredAtAttackStep(cb); return; }
  cb();
}
function _afterAtkEffectBody(atk, atkSlotIdx, callback) {
  _hooks.checkAndTriggerEffect(atk, '【アタック時】', () => _flushAtAttackStep(() => {
    // アタックしたデジモンのキーワード（【衝突】等）はターンプレイヤー側の効果なので、相手の「アタックしたとき」より先に処理する
    // （以前は後だったため、アンフィモン P-089 の「そのアタックを終了させる」が先に処理され、その後で【衝突】のブロッカーが付いていた）
    const ctxBase = { bs, addLog, renderAll, updateMemGauge };
    const _afterKw = () => {
      // subject:"both"（お互いのターンでアタック時発動）の進化元効果を相手側で反応させる
      _hooks.fireOnAttackBothSubjectTriggers('player', () => {
        // subject:"opp"（相手のデジモンがアタックしたとき）の進化元効果を相手側で反応させる
        _hooks.fireOnAttackOppSubjectTriggers('player', () => {
          // オフライン（CPU 戦）: プレイヤーへのアタックなら CPU 側の「相手のデジモンがプレイヤーにアタックしたとき」
          // （when_opp_attack）を発揮する。CPU のアタックでプレイヤー側に出しているのと同じ。オンラインは相手の端末が発揮する
          if (!_onlineMode && bs._lastAttackTarget === 'security' && !bs._attackEndRequested && window._fireWhenOppAttack) {
            window._fireWhenOppAttack('player', bs, { bs, addLog, renderAll, updateMemGauge }, () => callback());
          } else callback();
        });
      });
    };
    const _afterKwF = () => _flushAtAttackStep(_afterKw);
    try { _fireKeywordAttackEffects(atk, 'player', bs, ctxBase, _afterKwF); }
    catch (_) { _afterKwF(); }
  }));
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
    // チェックする相手のセキュリティが無ければ何もしない。≪貫通≫はセキュリティチェックで、プレイヤーへのアタックではないので、
    // セキュリティ0枚でも勝利にはならない（公式ルール 1-2-3-1・11-5-1-2：勝利はプレイヤーへのアタックが成立したとき）
    if ((bs.ai.security || []).length === 0) { addLog('🗡 【貫通】: 相手のセキュリティが0枚なので、チェックするカードが無い'); done && done(); return; }
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
      // バトルの演出（セキュリティチェック・VS画面）は終わっているので、バトル用の黒い背景を外してから【アタック終了時】を発揮する
      // （背景が残ったままだと、盤面の演出がその裏になり、効果の処理中ずっと画面が真っ黒だった。メガドラモン EX12-064 の進化元効果）
      hideCombatBackdrop();
      renderAll();
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
    if (_curAtk && _curAtk !== atk && _isSameDigimon(_curAtk, atk)) {
      addLog('⬆ アタッカー「' + atk.name + '」が「' + _curAtk.name + '」になった（同じデジモンなのでアタック継続）');
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
    // AIの考え（あなたのアタックでセキュリティを何枚チェックされたか）用の記録
    if (bs.isPlayerTurn && sec) (bs._aiSecLost = bs._aiSecLost || []).push(sec);
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
          const _secToHand = _secDigimonToZone(sec, bs.ai, true); renderAll(); _dispatchStateSync();
          showBattleResult('Win!!', '#00ff88', 'セキュリティ突破！', () => {
            showSecurityDigimonLeave(sec, true, _secToHand, 'ai', () => {
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
            const _secToHand = _secDigimonToZone(sec, bs.ai, true);
            renderAll(); _dispatchStateSync();
            addLog('🛡 【ジャミング】「' + atk.name + '」がセキュリティバトルで消滅回避');
            showBattleResult('ジャミング！', '#00fbff', '「' + atk.name + '」が消滅を回避', () => {
              showSecurityDigimonLeave(sec, _secTie, _secToHand, 'ai', () => {
                if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
                else { checkAttackEnd(atk, atkIdx); }
              });
            }, 'ジャミング！', '#00fbff');
            return;
          }
          // ≪防壁≫等のキーワードに加え、「（バトルで）消滅するとき〜することで消滅しない」（【フラグメント】【アーマー解除】・
          // 充填プラグインQ 等）も確認する（以前はキーワードだけで、ギロモン BT26-055 の【フラグメント】が発動しなかった）
          _avoidBattleDestroy('player', atk, (cancelAtkInSec) => {
          if (cancelAtkInSec) {
            const _secToHand = _secDigimonToZone(sec, bs.ai, true);
            renderAll(); _dispatchStateSync();
            showBattleResult('回避！', '#00fbff', '「' + atk.name + '」が消滅を回避', () => {
              showSecurityDigimonLeave(sec, _secTie, _secToHand, 'ai', () => {
                if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
                else { checkAttackEnd(atk, atkIdx); }
              });
            }, '回避！', '#00fbff');
            return;
          }
          removeOwnCard(atkIdx, 'destroy');
          const _secToHand = _secDigimonToZone(sec, bs.ai, true);
          renderAll(); _dispatchStateSync();
          showBattleResult(_secTie ? '両者負け' : 'Lost...', '#ff4444', _secTie ? '両方ともバトルに負けた' : '「' + atk.name + '」が撃破された', () => {
            showDestroyEffect(atk, () => showSecurityDigimonLeave(sec, _secTie, _secToHand, 'ai', () => {
              addLog('✗ セキュリティに敗北'); _dispatchStateSync();
              try {
                _fireDestroyChain(['player'], () => checkPendingTurnEnd(), { player: atk });
              } catch(_) { checkPendingTurnEnd(); }
            }));
          }, 'Win!!', '#00ff88');
          });
        }
        return;
      }
      // ----- セキュリティがテイマー -----
      if (sec.type === 'テイマー') {
        sec.summonedThisTurn = true;
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
          const _atkSuppressOptSE = _atkSuppressesOptSecurityEffect(atk);
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

// ≪オプションのセキュリティ効果無効化≫（ウォーグレイモン等）をアタッカーが持つか（プレイヤー・CPU のアタック共通）。
// _permEffects 優先・未評価でも recipe.passive を直接スキャンしてフォールバック
function _atkSuppressesOptSecurityEffect(atk) {
  return !!(atk && (
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
}

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
// opts.beforeOnDestroy[side](go): その側の「デジモンが消滅したとき」等の反応の後、消滅したカード自身の【消滅時】の前に
// 挟む処理（【道連れ】を【消滅時】より先に発揮すると持ち主が選んだとき）。go() で続きへ
function _fireDestroyChain(sides, done, destroyedCardsBySide, causerCardsBySide, opts) {
  // 両者消滅（相打ち）で同時に誘発した消滅時効果は、ターンプレイヤー側から発揮する（公式ルール 15-4-3-5。
  // P1 のターンにレイヴモンとミレニアモンが相打ちになったとき、非ターンプレイヤーのミレニアモンから発揮していた）
  if (Array.isArray(sides) && sides.length >= 2) {
    const _turnSide = bs.isPlayerTurn ? 'player' : 'ai';
    sides = sides.slice().sort((a, b) => (a === _turnSide ? 0 : 1) - (b === _turnSide ? 0 : 1));
  }
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
        const _battleCause = bs._lastDestroyCause;
        _fireOnDestroySubjectReactions(s, bs, ctxBase, () => {
          const _goOnDestroy = () => {
            // 消滅したカード自身の【消滅時】（進化元効果を含む）も原因＝バトルのまま判定する（ファルコモン P-142 の進化元
            // 「【消滅時】バトル以外で消滅していたなら」が、バトルで消滅したのに発揮していた。以前はここで原因を消していた）
            bs._lastDestroyCause = _battleCause;
            afterOnDestroy(() => {
              bs._lastDestroyCause = null;
              try {
                _fireOnBattleDestroy(s, bs, ctxBase, next, destroyedCard);
              } catch (_) { next(); }
            });
          };
          const _hook = opts && opts.beforeOnDestroy && opts.beforeOnDestroy[s];
          if (typeof _hook === 'function') { try { _hook(_goOnDestroy); } catch (e) { console.error('[beforeOnDestroy]', e); _goOnDestroy(); } }
          else _goOnDestroy();
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
    const _ice = _iceBattleCounts(atk, defSide === 'ai' ? 'player' : 'ai', atkIdx, def, defSide || 'ai', defIdx);
    const iceArmorActive = _ice.active;
    if (iceArmorActive) {
      _atkDp = _ice.a;
      _defDp = _ice.d;
      addLog('🧊 ≪氷装≫: 進化元枚数比較 「' + atk.name + '」' + _atkDp + '枚 / 「' + def.name + '」' + _defDp + '枚');
    }
    removeBattleBuffs(battleBuffs);
    // 「バトル終了まで」（dur_until_battle_end）のバフはここで期限切れにする
    // （例:「アタック中のこのデジモンは相手の効果を受けない」＝immune_effects）
    _expireBuffs(bs, 'dur_until_battle_end');
    // 相手のデジモン（def）だけがバトルで消滅した後（勝ったとき・相打ちで自分が消滅を回避したとき共通）:
    // 「バトルで相手のデジモンを消滅させたとき」の効果・≪貫通≫（公式ルール 16-7-1。相打ちでも自分が残っていれば発揮する）・≪道連れ≫
    const _afterAtkDestroyedDef = (isTie) => {
      // AIの考え: あなたのアタックで AI のデジモンがバトルで倒された
      try {
        if (_aiIsMid() && def) _aiWhy('「' + def.name + '」がバトルで倒されました ← ' + (_aiIsFinisher(def) ? '切り札がやられたのは痛い…立て直しを急ぐ。' : (_lvOf(def) >= 5 ? '育てていたデジモンだったので痛い。' : 'この程度ならまだ立て直せる。'))
          + (atk ? 'キミの「' + atk.name + '」は要注意だ。' : ''));
      } catch (_) {}
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
              // 相打ちで残ったときは「バトルに勝ったとき」を除く（「消滅させたとき」と≪貫通≫だけ）
              if (isTie) window._battleTieNoWin = true;
              const winCtx = _hooks.makeEffectContext(atk, 'player');
              _hooks.triggerEffect('on_battle_win', atk, 'player', winCtx, () => {
                window._battleTieNoWin = false;
                bs._lastBattleWinner = null;
                bs._lastBattleDefeatedCard = null;
                afterDone();
              });
            };
            // ≪道連れ≫: 撃破した相手(def)が【道連れ】を持つ場合、撃破した側(atk)も消滅させる。
            // 【道連れ】は非ターンプレイヤー（def側）の誘発効果なので、ターンプレイヤー（atk側）の同時誘発
            // （バトルに勝ったとき・「バトルで相手のデジモンだけを消滅させたとき」ディルビットモン P-090 等）を先に
            // 全て解決してから発揮する（公式ルール 15-4-3-5）。def の【消滅時】の後に発揮する（非ターンプレイヤーが
            // 選べる順番の1つ）。以前は【道連れ】を先に処理し、atk 側の効果が発揮できなかった
            if (hasMichizure(def)) {
              // VS画面の決着で「道連れから」に決まっていれば（ターンプレイヤー側に先に解決する効果が無いとき。_michiVsHook）、
              // CPU の【消滅時】より先に道連れで atk を消滅させる（演出は出し済み）
              const _p1Plan = _michiPlanFor(def);
              // 道連れから: atk を消滅させてから、両方の消滅時（演出はVS画面で出し済みなら重ねない）
              const _michiFirst = () => {
                const _mzIdx = bs.player.battleArea.indexOf(atk);
                if (_mzIdx < 0) { window._michiVsPlan = null; _fireDestroyChain(['ai'], () => checkPendingTurnEnd(), { ai: def }, { ai: atk }); return; }
                addLog('💀 【道連れ】「' + def.name + '」が「' + atk.name + '」を巻き込んで消滅！');
                bs.player.battleArea[_mzIdx] = null;
                bs.player.trash.push(atk);
                if (atk.stack) atk.stack.forEach(function(s){ bs.player.trash.push(s); });
                _dumpLinkedCardsUnlessDeferred(atk, bs.player.trash);
                _michiSyncRemoved('player', _mzIdx);
                renderAll();
                playMichizureFx(atk, { side: 'player', idx: _mzIdx }, 'ai', function() {
                  _fireDestroyChain(['player', 'ai'], function() { checkPendingTurnEnd(); }, { player: atk, ai: def }, { player: def, ai: atk });
                }, def, 'atk');
              };
              if (_p1Plan && _p1Plan.order === 'michizure') {
                fireOnBattleWin(_michiFirst);
                return;
              }
              const _p1Asked = !!(_p1Plan && _p1Plan.order === 'destroy'); // VS画面で持ち主が「消滅時から」を選び済み
              if (_p1Plan) window._michiVsPlan = null;
              fireOnBattleWin(() => {
                // オンライン: ターンプレイヤー（こちら）の効果を解決した後、【道連れ】と【消滅時】等の順番は持ち主（相手）が選ぶ
                // （公式ルール 15-4-3-5。以前はこの場合、聞かずに【消滅時】からにしていた）
                if (_onlineMode && _sendCommand && !_p1Asked) {
                  _askRemoteMichiOrder(def, (order) => { if (order === 'michizure') _michiFirst(); else _destroyFirst(); });
                  return;
                }
                _destroyFirst();
              });
              return;
              function _destroyFirst() {
                _fireDestroyChain(['ai'], () => {
                  const _mzIdx = bs.player.battleArea.indexOf(atk);
                  if (_mzIdx < 0) { checkPendingTurnEnd(); return; } // 先に別の効果で場を離れていた
                  addLog('💀 【道連れ】「' + def.name + '」が「' + atk.name + '」を巻き込んで消滅！');
                  bs.player.battleArea[_mzIdx] = null;
                  bs.player.trash.push(atk);
                  if (atk.stack) atk.stack.forEach(function(s){ bs.player.trash.push(s); });
                  _dumpLinkedCardsUnlessDeferred(atk, bs.player.trash);
                  _michiSyncRemoved('player', _mzIdx);
                  renderAll();
                  playMichizureFx(atk, { side: 'player', idx: _mzIdx }, 'ai', function() {
                    _fireDestroyChain(['player'], function() { checkPendingTurnEnd(); }, { player: atk }, { player: def });
                  }, def, 'atk');
                }, { ai: def }, { ai: atk });
              }
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
    };
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
              _afterAtkDestroyedDef(true);
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
          _afterAtkDestroyedDef();
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
                // 【道連れ】で def を消滅させる。next(消滅させたか)
                const doMichi = (next) => {
                  const defIdx2 = bs.ai.battleArea.indexOf(def);
                  if (defIdx2 < 0) { next(false); return; }
                  addLog('💀 【道連れ】「' + atk.name + '」が「' + def.name + '」を巻き込んで消滅！');
                  bs.ai.battleArea[defIdx2] = null;
                  bs.ai.trash.push(def);
                  if (def.stack) def.stack.forEach(s => bs.ai.trash.push(s));
                  _dumpLinkedCardsUnlessDeferred(def, bs.ai.trash);
                  _michiSyncRemoved('ai', defIdx2);
                  renderAll();
                  playMichizureFx(def, { side: 'ai', idx: defIdx2 }, 'player', () => next(true), atk, 'def');
                };
                // 【消滅時】と【道連れ】の両方があれば、どちらから発揮するかを選ぶ（公式ルール 15-4-3-4）
                michizureOrder(atk, (order) => {
                  if (order === 'michizure') {
                    doMichi((r) => {
                      if (r) _fireDestroyChain(['player', 'ai'], () => checkPendingTurnEnd(), { player: atk, ai: def }, { player: def, ai: atk });
                      else _fireDestroyChain(['player'], () => checkPendingTurnEnd(), { player: atk }, { player: def });
                    });
                  } else {
                    _fireDestroyChain(['player'], () => {
                      doMichi((r) => {
                        if (r) _fireDestroyChain(['ai'], () => checkPendingTurnEnd(), { ai: def }, { ai: atk });
                        else checkPendingTurnEnd();
                      });
                    }, { player: atk }, { player: def });
                  }
                });
                return;
              }
              _fireDestroyChain(['player'], () => {
                // 防御側（CPU）が atk を撃破して生存 →「バトルに勝ったとき」（on_battle_win）。CPU のアタックで
                // プレイヤーの防御側が勝ったとき（resolveBattleAI）と同じ。オンラインは相手の端末が発揮するのでここでは出さない
                if (_onlineMode || !def || bs.ai.battleArea.indexOf(def) < 0) { checkPendingTurnEnd(); return; }
                bs._lastBattleWinner = def;
                bs._lastBattleDefeatedCard = atk;
                const winCtx = _hooks.makeEffectContext(def, 'ai');
                _hooks.triggerEffect('on_battle_win', def, 'ai', winCtx, () => {
                  bs._lastBattleWinner = null;
                  bs._lastBattleDefeatedCard = null;
                  checkPendingTurnEnd();
                });
              }, { player: atk }, { player: def });
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
  // 比べるDPは付与中のバフから計算し直した値にする（プレイヤーのアタックの resolveBattle と同じ）
  try { if (window._recalcDp) { window._recalcDp(atk); window._recalcDp(def); } } catch (_) {}
  showCombatBackdrop();
  const origCb = callback;
  callback = () => { hideCombatBackdrop(); origCb(); };
  const battleBuffs = applyBattleBuffs(atk, def);
  addLog('⚔ 「' + atk.name + '」(DP ' + formatDpDisplay(atk) + ') vs 「' + def.name + '」(DP ' + formatDpDisplay(def) + ')');
  showSecurityCheck(def, atk, () => {
    // バトル中効果適用済みのDPで勝敗判定 → その後バフ除去
    // ≪氷装≫: 進化元枚数比較
    let _atkDp = atk.dp, _defDp = def.dp;
    const _ice2 = _iceBattleCounts(atk, 'ai', atkIdx, def, 'player', defIdx);
    const iceArmorActive2 = _ice2.active;
    if (iceArmorActive2) {
      _atkDp = _ice2.a;
      _defDp = _ice2.d;
      addLog('🧊 ≪氷装≫: 進化元枚数比較 「' + atk.name + '」' + _atkDp + '枚 / 「' + def.name + '」' + _defDp + '枚');
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
            // ≪貫通≫: 相打ちでもアタックしたデジモンが消滅を回避して残っていれば、バトルで相手のデジモンを
            // 消滅させたので発揮する（公式ルール 16-7-1・16-7-6）
            if (hasPenetrate(atk) && bs.ai.battleArea.indexOf(atk) >= 0 && (bs.player.security || []).length > 0) {
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された（相手は消滅回避）', () => {
                addLog('💥 「' + def.name + '」が撃破された'); renderAll();
                addLog('🗡 [AI] 「' + atk.name + '」の【貫通】効果でセキュリティチェック！');
                showPenetrateAnnounce(() => {
                  _setPendingBattleTriggers((proceed) => { _aiTieFireDestroyedTrigger(atk, def, proceed); }, (proceed) => { _fireDestroyChain(['player'], proceed, { player: def }, { player: atk }); });
                  doAiSecurityCheck(atk, atkIdx, () => { _consumePendingBattleTriggers(callback); });
                });
              }, '回避！', '#00fbff');
              return;
            }
            const _defChain = () => _fireDestroyChain(['player'], () => {
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された（相手は消滅回避）', () => { addLog('💥 「' + def.name + '」が撃破された'); renderAll(); callback(); }, '回避！', '#00fbff');
            }, { player: def }, { player: atk });
            // CPU のデジモンが残っていれば「消滅させたとき」を先に（ターンプレイヤー側から。「バトルに勝ったとき」は除く）
            if (bs.ai.battleArea.indexOf(atk) >= 0) _aiTieFireDestroyedTrigger(atk, def, _defChain);
            else _defChain();
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
            // 【道連れ】は非ターンプレイヤー（def=player側）の効果なので、ターンプレイヤー（atk=ai側）の効果を先に解決してから
            // （公式ルール 15-4-3-5。プレイヤー側のアタックと同じ）
            if (hasMichizure(def)) {
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された', () => { addLog('💥 「' + def.name + '」が撃破された'); renderAll(); fireOnBattleWin(() => {
                // 【道連れ】: atk がまだ場にいれば消滅させる。next(消滅させたか)
                const doMichi = (next) => {
                  const _mzIdx = bs.ai.battleArea.indexOf(atk);
                  if (_mzIdx < 0) { next(false); return; }
                  addLog('💀 【道連れ】「' + def.name + '」が「' + atk.name + '」を巻き込んで消滅！');
                  bs.ai.battleArea[_mzIdx] = null;
                  bs.ai.trash.push(atk);
                  if (atk.stack) atk.stack.forEach(function(s){ bs.ai.trash.push(s); });
                  _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
                  renderAll();
                  playMichizureFx(atk, { side: 'ai', idx: _mzIdx }, 'player', () => next(true), def, 'atk');
                };
                const finish = (removed) => {
                  if (removed) _fireDestroyChain(['ai'], function() { renderAll(); callback(); }, { ai: atk }, { ai: def });
                  else { renderAll(); callback(); }
                };
                // 【消滅時】と【道連れ】の両方があれば、どちらから発揮するかを持ち主（プレイヤー）が選ぶ（公式ルール 15-4-3-4）
                michizureOrder(def, (order) => {
                  if (order === 'michizure') {
                    let _removed = false;
                    _fireDestroyChain(['player'], () => finish(_removed), { player: def }, { player: atk },
                      { beforeOnDestroy: { player: (go) => doMichi((r) => { _removed = r; go(); }) } });
                  } else {
                    _fireDestroyChain(['player'], () => doMichi(finish), { player: def }, { player: atk });
                  }
                });
              }); }, 'Win!!', '#00ff88');
              return;
            }
            // ≪貫通≫: AI アタッカーが撃破したら追加セキュリティチェック（相手のセキュリティが0枚ならチェックするカードが無いので行わない。
            // ≪貫通≫はプレイヤーへのアタックではないので勝利にはならない。公式ルール 1-2-3-1）
            if (hasPenetrate(atk) && (bs.player.security || []).length > 0) {
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
          // 巻き込まれた def に VS 画面で「道連れ」の演出
          playMichizureFx(def, { side: 'player', idx: defIdx2 }, 'ai', () => {
            _fireDestroyChain(['ai', 'player'], () => {
              showBattleResult('両者消滅', '#ff4444', '両者消滅（道連れ）！', () => { renderAll(); callback(); }, '両者消滅', '#ff4444');
            }, { ai: atk, player: def }, { ai: def, player: atk });
          }, atk, 'def');
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

// ===== AI対戦「中」（ベテランテイマー）の判断 =====
// ルールの処理は低と同じ。変わるのは「どれを選ぶか」だけ
function _aiIsMid() {
  return typeof window !== 'undefined' && !!window._aiBattleActive && (window._aiLevel === 'mid' || window._aiLevel === 'high') && !_onlineMode;
}
const _dpOf = (c) => (c ? (parseInt(c.dp, 10) || 0) : 0);
const _lvOf = (c) => (c ? (parseInt(c.level, 10) || 0) : 0);
// プレイヤーのデジモンのうち、CPU のアタッカー atk をブロックできるもの（除外 exceptIdx）
function _aiPlayerBlockersFor(atk, exceptIdx) {
  if (!atk) return [];
  if ((atk._permEffects && atk._permEffects.cantBeBlocked) || _cantRedirectAttack(atk)) return [];
  const forced = _hasCollision(atk, 'ai');
  const noEvoOnly = !!(atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo);
  return (bs.player.battleArea || []).filter((c, i) => c && i !== exceptIdx && _canBlockNow(c)
    && (forced ? (!c.type || c.type === 'デジモン') : isBlocker(c))
    && !(noEvoOnly && (!c.stack || c.stack.length === 0)));
}
// ===== セキュリティへのアタックの危険（中・高）=====
// セキュリティからめくれそうなデジモンの最高DPの見積もり。めくれたデジモンにはプレイヤー側のセキュリティDP+も乗る
//  中（ベテラン）: 相手が見せた Lv.5 以下のデジモンの最高DP（見えていなければ 5000）
//  高（マスター）: 相手が見せたデジモン全ての最高DP（相手のデッキの型の読み。4種類見えるまでは 7000 と考える）
function _aiEstSecDp() {
  const seen = [..._aiCollectSeenOpp().values()].filter(c => c && (c.type === 'デジモン' || c.type === 'デュアル'));
  let est;
  if (_aiIsHigh()) {
    // デジモンカードのDPの上限: Lv.6 は 13000、Lv.7 は 16000 が最高。相手のデッキに Lv.7 が見えたら 16000、
    // 見えていなければ 13000 がセキュリティから出てくる最高DPと考える
    est = seen.some(c => _lvOf(c) >= 7) ? 16000 : 13000;
  } else {
    // 中（ベテラン）は自分のデッキが中心なので、そこまで慎重にならない: 見えた Lv.5 以下の最高DP（見えていなければ 4000）
    const mx = Math.max(0, ...seen.filter(c => _lvOf(c) <= 5).map(c => parseInt(c.baseDp != null ? c.baseDp : c.dp, 10) || 0));
    est = mx || 4000;
  }
  (bs._securityBuffs || []).forEach(b => {
    if (!b || (b.secSide || b.owner) !== 'player') return;
    const v = parseInt(b.value, 10) || 0;
    if (b.type === 'dp_plus') est += v; else if (b.type === 'dp_minus') est -= v;
  });
  return est;
}
// このデジモンがアタックすることに意味があるか（DPが低くてセキュリティのデジモンに負けそうでも行く理由）:
// 【アタック時】の効果がある／【消滅時】の効果がある（負けて消滅しても得をする）。進化元の効果も含む
function _aiAttackMeaningful(c) {
  if (!c) return false;
  // マスター: アタックしてもターン終了時にアクティブに戻るなら、アタックしておく意味がある（アクティブのまま終えると戻る効果が無駄）
  if (_aiWillReactivateAtTurnEnd(c)) return true;
  const top = _aiTagsOf(c);
  if (top.onDestroy) return true;
  if ((c.stack || []).some(x => _aiTagsOf(x).onDestroyEvo)) return true;
  return _aiOnAttackUseful(c);
}
// 【アタック時】の効果が今使えるか: 相手のデジモンに効く手順は、対象（条件に合う相手のデジモン）がいるときだけ意味がある。
// 自分に効く手順（ドロー・DP+・メモリー等）は常に意味がある。レシピが読めなければ効果テキストの有無で判断
function _aiOnAttackUseful(c) {
  const parse = (r) => { if (typeof r === 'string') { try { return r ? JSON.parse(r) : null; } catch (_) { return null; } } return r; };
  const stepsOf = (obj) => {
    const out = [];
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(k => { if (k.split(',').map(s => s.trim()).includes('on_attack') && Array.isArray(obj[k])) out.push(...obj[k].filter(Boolean)); });
    return out;
  };
  const steps = [];
  let textOnly = false;
  const r0 = parse(c.recipe);
  if (r0) steps.push(...stepsOf(r0)); else if (_aiTagsOf(c).onAttack) textOnly = true;
  (c.stack || []).forEach(x => {
    const r = parse(x.recipe);
    if (r && r.evo_source) steps.push(...stepsOf(r.evo_source));
    else if (!r && _aiTagsOf(x).onAttackEvo) textOnly = true;
  });
  if (textOnly) return true;
  return steps.some(st => {
    const t = String(st.target || '');
    if (/^opp/.test(t)) { const n = _aiMidStepTargetCount(st, c); return n === null ? true : n > 0; }
    return true;
  });
}
// セキュリティのデジモンとのバトルで消滅しない（負けても失わない）: 【ジャミング】・「バトルで消滅しない」「消滅しない」の付与、
// 【防壁】（自分のセキュリティが3枚以上あるとき。1枚破棄して残る）
function _aiSurvivesSecBattle(c) {
  if (!c) return false;
  if (hasJamming(c)) return true;
  if (hasPassiveFlag(c, 'prevent_battle_destroy', '') || hasPassiveFlag(c, 'prevent_destroy', '')) return true;
  if (hasBarrier(c) && (bs.ai.security || []).length >= 3) return true;
  return false;
}
// 【プログレス】（アタック中、相手の効果を受けない）・効果耐性: セキュリティのオプションの効果を受けない
function _aiImmuneDuringAttack(c) {
  return !!c && (hasPassiveFlag(c, 'attack_immunity', '') || hasPassiveFlag(c, 'immune', ''));
}
// セキュリティへアタックしてよいか（中・高）:
//  ・DPが見積もりより高い（めくれたデジモンに勝てる）
//  ・セキュリティのデジモンとのバトルで消滅しない（ジャミング等）
//  ・アタックする意味がある（使える【アタック時】・【消滅時】）
//  ・高: セキュリティの枚数で2枚以上負けているときは、Lv.4 以下（失っても痛くない）なら危険を取って削りに行く
function _aiSecAttackSafe(c) {
  if (_dpOf(c) > _aiEstSecDp()) return true;
  if (_aiSurvivesSecBattle(c)) return true;
  if (_aiAttackMeaningful(c)) return true;
  if (_aiIsHigh() && (bs.ai.security || []).length - (bs.player.security || []).length <= -2 && _lvOf(c) <= 4) return true;
  return false;
}
// アタックしてレストすると、次の相手のターンに倒されるか: 相手にこのデジモンよりDPの高いデジモンがいる
// （レスト中のデジモンはアタックされる。アクティブのままなら狙われない）
function _aiExposedAfterAttack(c) {
  if (!c || _aiSurvivesSecBattle(c)) return false;
  // 相手のデジモンがこのデジモンにアタックしたときのバトル（≪氷装≫・消滅しない・≪防壁≫も見る）で、このデジモンが消滅するか
  return (bs.player.battleArea || []).some(d => _aiIsDigi(d) && _aiBattleOutcome(d, c, 'ai').defDies);
}
// 高: 相手のセキュリティから、アタックしたデジモンを弱らせる・取り除くオプションが出てきそうか（相手のデッキの型から）。
// 相手のオプションが2種類以上見えていて、そういうカードが1枚も無ければ「入っていない」と読む。まだ読めないうちは「ありうる」
function _aiOppSecOptionThreat() {
  if (!_aiIsHigh()) return false;
  const seen = [..._aiCollectSeenOpp().values()];
  const opts = seen.filter(c => c && c.type === 'オプション');
  if (opts.some(c => _aiTagsOf(c).secHarm)) return true;
  return !(seen.length >= 4 && opts.length >= 2);
}

// ===== AI のバトルの見積もり（中・高）=====
// DP だけでなく、カードの効果で変わるバトルの結果を見積もる:
//  ・≪氷装≫（どちらかが持てば、セキュリティデジモン以外とのバトルは進化元の枚数で比べる。公式ルール 16-35）
//  ・バトルで消滅しない（「バトルで消滅しない」「消滅しない」の付与）・≪防壁≫（セキュリティを1枚破棄して消滅しない）
//  ・≪道連れ≫（相手のデジモンだけが消滅したとき、相手も消滅させる）
// 戻り値: { atkWins, defWins, tie, atkDies, defDies, ice }
function _aiBattleOutcome(atk, def, defSide) {
  const ice = _hasIceArmor(atk) || _hasIceArmor(def);
  const a = ice ? (atk.stack || []).length : _dpOf(atk);
  const d = ice ? (def.stack || []).length : _dpOf(def);
  const atkSide = defSide === 'player' ? 'ai' : 'player';
  const survives = (c, side) => {
    if (hasPassiveFlag(c, 'prevent_battle_destroy', '') || hasPassiveFlag(c, 'prevent_destroy', '')) return true;
    if (hasBarrier(c) && ((bs[side] && bs[side].security) || []).length > 0) return true;
    return false;
  };
  const atkWins = a > d, defWins = d > a, tie = a === d;
  let defDies = (atkWins || tie) && !survives(def, defSide);
  let atkDies = (defWins || tie) && !survives(atk, atkSide);
  // ≪道連れ≫: 相手のデジモンだけがバトルで消滅したら、相手（アタックした側）も消滅
  if (defDies && !atkDies && hasMichizure(def)) atkDies = true;
  if (atkDies && !defDies && hasMichizure(atk)) defDies = true;
  return { atkWins, defWins, tie, atkDies, defDies, ice };
}
if (typeof window !== 'undefined') window._aiBattleOutcome = (atk, def, defSide) => { try { return _aiBattleOutcome(atk, def, defSide || 'player'); } catch (_) { return null; } };
// ≪突進≫（アタックの対象を、最もDPの高いアクティブ状態の相手のデジモン1体に変更できる）等の「アタック先の変更」を CPU が使うか:
// 変更先の候補（フィルタ・最大/最小の絞り込み）のどれかを消滅させられて、自分は残る（または相手の方が価値が高い相打ち）なら使う
if (typeof window !== 'undefined') window._aiWantsRedirect = (attacker, step) => {
  try {
    if (!attacker) return false;
    const f = (step && step.filter) || {};
    let cands = (bs.player.battleArea || []).filter(c => _aiIsDigi(c) && (f.suspended === undefined || !!c.suspended === !!f.suspended));
    if (cands.length === 0) return false;
    const pick = (val, hi) => { const vs = cands.map(val); const ex = hi ? Math.max(...vs) : Math.min(...vs); cands = cands.filter(c => val(c) === ex); };
    if (f.dp_extreme) pick(c => _dpOf(c), f.dp_extreme !== 'lowest');
    if (f.evo_extreme) pick(c => (c.stack || []).length, f.evo_extreme !== 'lowest');
    return cands.some(t => { const o = _aiBattleOutcome(attacker, t, 'player'); return o.defDies && (!o.atkDies || _aiThreat(t) > _aiOwnValue(attacker)); });
  } catch (_) { return false; }
};

// 中のアタック先: 相手のセキュリティが0ならとどめ（プレイヤーへ）→ 勝てるデジモン（強い順）→ セキュリティ。
// 負けるアタックはしない（ブロックしてくるデジモンのDPがアタッカー以上なら、そのアタック自体をやめる）。null＝アタックしない
function _aiMidPickTarget(c) {
  const atkDp = _dpOf(c);
  // Sアタック-でチェック数が0のデジモンはプレイヤーにアタックしない（セキュリティをチェックできずに終わるだけ。
  // セキュリティ0枚でもチェック0回なら勝てない）
  const cantPlayer = (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'cant_attack_player'))
    || getSecurityAttackCount(c) <= 0;
  const secLeft = (bs.player.security || []).length;
  // とどめ: ブロックされても、ほかに手が無いので狙う
  if (!cantPlayer && secLeft === 0) return { mode: 'security' };
  // 自分のセキュリティが2枚以下なら、【ブロッカー】は守りに残す（相手にデジモンがいるとき）
  if (isBlocker(c) && (bs.ai.security || []).length <= 2 && (bs.player.battleArea || []).some(_aiIsDigi)) return null;
  const pa = bs.player.battleArea || [];
  const wins = [];
  for (let i = 0; i < pa.length; i++) {
    const d = pa[i];
    if (!d || (d.type !== 'デジモン' && d.type !== 'デュアル')) continue;
    const ok = window._canAttackDigimonTarget ? window._canAttackDigimonTarget(c, d, bs, 'ai') : d.suspended;
    if (!ok) continue;
    // 勝てる相手（消滅させられて、自分は残る）。相打ちは、相手の方がレベルが高いときだけ。
    // ≪氷装≫（進化元の枚数で比べる）・バトルで消滅しない・≪防壁≫・≪道連れ≫も見る（_aiBattleOutcome）
    const o = _aiBattleOutcome(c, d, 'player');
    if (o.defDies && (!o.atkDies || _lvOf(d) > _lvOf(c))) wins.push(i);
  }
  // ブロックされて負ける（自分が消滅する、または相手を消滅させられない）ブロッカーがいるか
  const strongBlock = (exceptIdx) => _aiPlayerBlockersFor(c, exceptIdx).some(b => { const o = _aiBattleOutcome(c, b, 'player'); return o.atkDies || !o.defDies; });
  if (wins.length > 0) {
    wins.sort((a, b) => (_lvOf(pa[b]) - _lvOf(pa[a])) || (_dpOf(pa[b]) - _dpOf(pa[a])));
    const i = wins.find(w => !strongBlock(w));
    if (i !== undefined) return { mode: 'digimon', idx: i, def: pa[i] };
  }
  if (cantPlayer) return null;
  if (strongBlock(-1)) return null;
  // セキュリティからめくれそうなデジモンに負けるDPなら、【アタック時】【消滅時】などアタックする意味があるときだけ行く
  if (!_aiSecAttackSafe(c)) return null;
  // 勝ち筋のデジモン（設計図の一番上のレベル）は、アタックしてレストすると次の相手のターンに倒されるなら、
  // 意味のあるアタックでない限り残す（相手のセキュリティが2枚以下なら攻める）
  if (_aiIsFinisher(c) && _aiExposedAfterAttack(c) && secLeft > 2 && !_aiAttackMeaningful(c)) return null;
  return { mode: 'security' };
}
// 中のブロック: 勝てる・相打ちならブロック。負けるブロックは、自分のセキュリティが2枚以下のプレイヤーへのアタック
// （0枚なら必ず）のときだけ。選ぶのは「勝てる中で一番弱い」→「相打ち」→「一番弱い（負けてもよい1体）」
function _aiMidChooseBlocker(atk, cands, targetIdx) {
  const area = bs.ai.battleArea;
  const byWeak = (a, b) => (_lvOf(area[a]) - _lvOf(area[b])) || (_dpOf(area[a]) - _dpOf(area[b]));
  // ブロックしたときのバトル（ブロッカーが守る側）。≪氷装≫・消滅しない・≪防壁≫・≪道連れ≫も見る
  const oc = (i) => _aiBattleOutcome(atk, area[i], 'ai');
  const win = cands.filter(i => { const o = oc(i); return !o.defDies && o.atkDies; }).sort(byWeak);
  if (win.length) return win[0];
  // 負けない（どちらも残る）ブロックも、守れるので使う
  const safe = cands.filter(i => !oc(i).defDies).sort(byWeak);
  if (safe.length) return safe[0];
  const tie = cands.filter(i => { const o = oc(i); return o.defDies && o.atkDies; }).sort(byWeak);
  if (tie.length) return tie[0];
  const secLeft = (bs.ai.security || []).length;
  // 負けるブロックで守るのは、プレイヤーへのアタックでセキュリティ2枚以下のときだけ。≪貫通≫のアタッカーはブロッカーを
  // 消滅させるとセキュリティチェックするので、負けるブロックでは守れない
  if (targetIdx < 0 && secLeft <= 2 && !hasPenetrate(atk)) return cands.slice().sort(byWeak)[0];
  return -1;
}

// ===== AI対戦「高」（デジモンマスター）の判断 =====
// 中の判断（_aiIsMid は高でも true）に加えて、行動の候補ごとに結果を点数で見積もり、一番良いものを選ぶ。
// ずるはしない: プレイヤーの手札・セキュリティの中身・デッキは見ない（場・枚数・公開情報だけ）
function _aiIsHigh() { return _aiIsMid() && window._aiLevel === 'high'; }
const _aiThreat = (c) => (typeof window !== 'undefined' && window._cpuThreat ? window._cpuThreat(c) : _dpOf(c) + _lvOf(c) * 1500);
// 自分のデジモンを失ったときの痛さ（【消滅時】で得をするデジモンは、身代わりにしても痛くない）
function _aiOwnValue(c) {
  if (!c) return 0;
  let v = _aiThreat(c);
  if (/【消滅時】/.test(String(c.effect || '') + String(c.evoSourceEffect || ''))) v -= 2500;
  return v;
}
function _aiChecksOf(c) { try { return getSecurityAttackCount(c); } catch (_) { return 1; } }
const _aiIsDigi = (c) => c && (c.type === 'デジモン' || c.type === 'デュアル');
function _aiCantHitPlayer(c) {
  return (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'cant_attack_player')) || _aiChecksOf(c) <= 0;
}
// このターンに勝ち切れるか: プレイヤーのアクティブなブロッカーが、チェック数の多いアタッカーから順に止めると考えて、
// 残りのアタッカーでセキュリティを0にしたうえでもう1回プレイヤーにアタックできるか
function _aiHighLethal(attackers) {
  let sec = (bs.player.security || []).length;
  const chk = attackers.filter(c => !_aiCantHitPlayer(c)).map(_aiChecksOf).sort((a, b) => b - a);
  const blockers = (bs.player.battleArea || []).filter(c => c && _canBlockNow(c) && isBlocker(c)).length;
  for (const k of chk.slice(blockers)) {
    if (sec === 0) return true;
    sec = Math.max(0, sec - k);
  }
  return false;
}
// 守りを固めるべきか: 次のプレイヤーのターンに来るチェック数の合計が、自分のセキュリティ以上（＝負けうる）か、セキュリティ2枚以下
function _aiHighDefense() {
  const sec = (bs.ai.security || []).length;
  const incoming = (bs.player.battleArea || []).filter(_aiIsDigi).reduce((s, c) => {
    const pe = c._permEffects || {};
    let n = 1 + (parseInt(pe.securityAttackPlus, 10) || 0);
    (c.buffs || []).forEach(b => { if (b && b.type === 'security_attack_plus') n += parseInt(b.value, 10) || 0; });
    return s + n;
  }, 0);
  // 相手を速攻型と読んだら、セキュリティ3枚から守りに入る
  const opp = _aiOppRead();
  return sec <= (opp && opp.style === 'aggro' ? 3 : 2) || incoming >= sec;
}

// ===== AIの考え（行動の理由だけを集めたログ。js/ai-battle.js の「🧠 AIの考え」パネルに出す）=====
function _aiWhy(msg) {
  if (typeof window === 'undefined' || !window._aiBattleActive || _onlineMode) return;
  try { if (typeof window._aiWhyPush === 'function') window._aiWhyPush(msg); } catch (_) {}
}
if (typeof window !== 'undefined') window._aiWhy = (m) => _aiWhy(m);
// このデジモンがアタックしない／できない理由（AIの考え・効果のアタックをしない理由に使う）
function _aiNoAttackReason(c) {
  const parts = [];
  try {
    if (c.cantAttack) parts.push('「アタックできない」状態の');
    if (c.cantRest) parts.push('「レストできない」状態でアタックできない');
    if (c.summonedThisTurn) parts.push('登場したばかりでアタックできない');
    const bl = _aiPlayerBlockersFor(c, -1).filter(b => { const o = _aiBattleOutcome(c, b, 'player'); return o.atkDies || !o.defDies; });
    if (bl.length) parts.push('アタックしてもブロックされると負けてしまう（' + bl.map(b => '「' + b.name + '」' + (_hasIceArmor(b) || _hasIceArmor(c) ? '（氷装 進化元' + (c.stack || []).length + '対' + (b.stack || []).length + '）' : '（DP' + _dpOf(c) + '対' + _dpOf(b) + '）')).join('・') + '）');
    if (!_aiSecAttackSafe(c)) parts.push('セキュリティから出てくるデジモンに負けるおそれがある（DP' + _dpOf(c) + 'に対して、最大' + _aiEstSecDp() + 'くらいのデジモンが出てくると見ている）');
    if (_aiCantHitPlayer(c)) parts.push('セキュリティをチェックできない状態の');
    if (_aiIsHigh() && _lvOf(c) >= 5 && (bs.player.security || []).length > 2 && !_aiAttackMeaningful(c) && _aiExposedAfterAttack(c)) parts.push('アタックしてレストすると、次のあなたのターンに倒されてしまう');
    if (_aiIsHigh() && _aiHighDefense() && isBlocker(c)) parts.push('守りのためにブロッカーとして残しておきたい');
  } catch (_) {}
  return parts.length ? parts.join('、') : '勝てるアタック先が見つからない';
}

// このターンに、実際にアタックする価値のあるアタックがあるか（CPU の「ターン終了まで〜を得る」等の効果を使う判断用。
// アタックできても、勝てるアタック先が無くてアタックしないなら、このターンだけの攻めの効果は無駄になる）
if (typeof window !== 'undefined') window._aiHasWorthAttack = (only) => {
  if (!_aiIsMid()) return true;
  const rush = (c) => !!((c._permEffects && c._permEffects.rush) || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_rush')));
  const can = (c) => !!c && _aiIsDigi(c) && !c.suspended && !c.cantAttack && !c.cantRest && (!c.summonedThisTurn || rush(c)) && (!only || c === only);
  try {
    if (_aiIsHigh()) return !!_aiHighPickAttack(can);
    return (bs.ai.battleArea || []).some(c => can(c) && !!_aiMidPickTarget(c));
  } catch (_) { return true; }
};

// マスター: 育成エリアのデジモン（Lv.3以上）を、出さずに育成エリアで育て続けるべきか（相手の次の行動の予測）。理由の文か null。
// 育成エリアでは効果を使えないので、育て続けるのは次のどれかで「今出すと危ない」と読んだときだけ:
//  ・相手の場に、除去や進化元破棄の効果を持つデジモン/テイマーがいる（出すとすぐ狙われる）
//  ・相手の場に、このデジモンにバトルで勝つ、レベルが上のデジモンがいる
//  ・相手の育成エリアに Lv.4 以上がいて、次のターンに脅威になりそう
//  ・相手のデッキをコントロール型（除去が多い）と読んでいる
//  自分のセキュリティが2枚以下なら、場に出して守りに使う（育て続けない）
function _aiMasterNurseryHoldReason(iku) {
  if (!_aiIsHigh() || !iku) return null;
  if ((bs.ai.security || []).length <= 2) return null;
  try {
    const pl = bs.player;
    const removers = [...(pl.battleArea || []), ...(pl.tamerArea || [])].filter(c => { if (!c) return false; const t = _aiTagsOf(c); return t.removal || t.evoDiscard; });
    if (removers.length) return 'あなたの場の「' + removers[0].name + '」は除去や進化元破棄の効果を持っているので、今出すとすぐ狙われるからです。育成エリアで安全に育ててから出します。';
    const strong = (pl.battleArea || []).filter(_aiIsDigi).filter(d => _aiBattleOutcome(d, iku, 'ai').defDies && _lvOf(d) > _lvOf(iku));
    if (strong.length) return 'あなたの「' + strong[0].name + '」にバトルで勝てないので、今出しても倒されやすいからです。もう少し育ててから出します。';
    const pi = pl.ikusei;
    if (pi && _lvOf(pi) >= 4) return 'あなたの育成エリアの「' + pi.name + '」（Lv.' + _lvOf(pi) + '）が次のターンに出てきそうなので、それに負けないくらいまで育てたいからです。';
    const opp = _aiOppRead();
    if (opp && opp.style === 'control') return 'あなたのデッキは除去が多いと読んでいるので、育成エリアで強くしてから出したいからです。';
  } catch (_) {}
  return null;
}
if (typeof window !== 'undefined') window._aiMasterNurseryHoldReason = (iku) => _aiMasterNurseryHoldReason(iku);

// マスター: このデジモンは、アタックしてレストしても自分のターン終了時にアクティブに戻るか（その効果を読む）。
// 例: 進化元のセッカモン（ST26-04/BT27-029）の【自分のターン終了時】「相手のデジモン1体の進化元を2枚破棄する。破棄しなかったなら、
// このデジモンをアクティブにできる」は、相手に進化元を持つデジモンがいなければ破棄できないので、アクティブに戻る
function _aiWillReactivateAtTurnEnd(c) {
  if (!_aiIsHigh() || !c) return false;
  const parse = (r) => { if (typeof r === 'string') { try { return r ? JSON.parse(r) : null; } catch (_) { return null; } } return r; };
  const stepsOf = (obj) => {
    const out = [];
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(k => { if (k.split(',').map(x => x.trim()).includes('on_own_turn_end') && Array.isArray(obj[k])) out.push(...obj[k].filter(Boolean)); });
    return out;
  };
  const steps = [];
  const r0 = parse(c.recipe);
  if (r0) steps.push(...stepsOf(r0));
  (c.stack || []).forEach(x => { const r = parse(x && x.recipe); if (r && r.evo_source) steps.push(...stepsOf(r.evo_source)); });
  const oppHasEvo = (bs.player.battleArea || []).some(d => _aiIsDigi(d) && (d.stack || []).length > 0);
  return steps.some(st => {
    const all = [st, ...(Array.isArray(st.alt_actions) ? st.alt_actions : [])];
    const act = all.find(a => a && a.action === 'active' && /^self/.test(String(a.target || '')));
    if (!act) return false;
    // 「この効果で破棄しなかったなら」（cond_last_action_eq:0）: 前の手順が相手の進化元の破棄なら、破棄できない（進化元を持つ
    // 相手のデジモンがいない）ときだけアクティブに戻る
    if (/cond_last_action_eq:0/.test(String(act.condition || ''))) {
      const evoDisc = st.filter && st.filter.target_evo_source && /^opp/.test(String(st.target || ''));
      return evoDisc ? !oppHasEvo : false;
    }
    return !act.condition;
  });
}

// ===== マスターの「あなたのターン中の考え」=====
// あなたのデジモンが登場・進化したとき、どう見ているか（脅威の大きさ・倒し方）。あなたのターンが終わったら次のターンの方針
function _aiDescribe(c) {
  const kws = [];
  try {
    if (isBlocker(c)) kws.push('【ブロッカー】');
    if (_hasIceArmor(c)) kws.push('【氷装】');
    if (hasPenetrate(c)) kws.push('【貫通】');
    if (hasJamming(c)) kws.push('【ジャミング】');
    const t = _aiTagsOf(c);
    if (t.rush) kws.push('【速攻】');
    if (t.raid) kws.push('【急襲】');
  } catch (_) {}
  return 'Lv.' + _lvOf(c) + '・DP' + _dpOf(c) + (kws.length ? '・' + kws.join('') : '') + ((c.stack || []).length ? '・進化元' + c.stack.length + '枚' : '');
}
function _aiObservePlayer(kind, card) {
  // マスターは脅威の大きさと倒し方まで、ベテランは脅威の大きさと手持ちで倒せるかだけ
  if (!_aiIsMid() || !card || bs.isPlayerTurn !== true) return;
  if (!(bs.player.battleArea || []).includes(card) || !_aiIsDigi(card)) return;
  try {
    const threat = _aiThreat(card);
    const lv = threat >= 15000 ? '大きな脅威' : threat >= 9000 ? '注意が必要なデジモン' : 'まだ大きな脅威ではない';
    const mine = (bs.ai.battleArea || []).filter(_aiIsDigi);
    const beaters = mine.filter(m => { const o = _aiBattleOutcome(m, card, 'player'); return o.defDies && !o.atkDies; });
    const removal = (bs.ai.hand || []).filter(h => { const t = _aiTagsOf(h); return h.type !== 'デジモン' && (t.removal || t.evoDiscard); });
    let plan;
    if (beaters.length) plan = 'こちらの「' + beaters[0].name + '」ならバトルで倒せるので、レスト状態になったら狙います。';
    else if (!_aiIsHigh()) plan = '今の場には、これをバトルで倒せるデジモンがいません。';
    else if (removal.length) plan = '手札の「' + removal[0].name + '」で取り除くことを考えています。';
    else if (isBlocker(card)) plan = 'ブロッカーなので、こちらのアタックを止められないように、これを上回るデジモンを用意したいです。';
    else plan = '今はこれを倒す手段が無いので、守りを固めながら切り札の準備を急ぎます。';
    if (_hasIceArmor(card)) plan += '【氷装】があるので、DPではなく進化元の枚数で勝負になる点に注意しています。';
    _aiWhy('あなたの「' + card.name + '」が' + (kind === 'evolve' ? '進化して出てきました' : '登場しました') + '（' + _aiDescribe(card) + '） ← ' + lv + 'だと見ています。' + plan);
  } catch (e) { console.error('[aiObservePlayer]', e); }
}
if (typeof window !== 'undefined') window._aiObservePlayer = (k, c) => _aiObservePlayer(k, c);
// あなたのターンが終わって、このターンを始める前に、盤面を見て方針を決める（マスター）
if (typeof window !== 'undefined') window._aiObserveTurnStart = () => {
  if (!_aiIsHigh()) return;
  try {
    const aSec = (bs.ai.security || []).length, pSec = (bs.player.security || []).length;
    const threats = (bs.player.battleArea || []).filter(_aiIsDigi).sort((a, b) => _aiThreat(b) - _aiThreat(a));
    const plan = _aiPlan();
    const p = _aiProfile();
    const head = 'セキュリティはこちら' + aSec + '枚、あなた' + pSec + '枚です。'
      + (threats.length ? 'あなたの場で一番の脅威は「' + threats[0].name + '」（' + _aiDescribe(threats[0]) + '）です。' : 'あなたの場にデジモンはいません。');
    const tail = plan === 'defend' ? 'このままだと次のあなたのターンに負けるおそれがあるので、守りを優先します。'
      : plan === 'push' ? '今の場のデジモンで勝ち切れる見込みがあるので、攻めの準備を優先します。'
      : 'まだ勝ち切れないので、切り札' + (p && p.finisherNames.length ? '「' + p.finisherNames[0] + '」' : '') + 'に向けて育てつつ、倒せる相手は倒していきます。';
    _aiWhy('あなたのターンを見て、このターンの方針を決めました ← ' + head + tail);
  } catch (e) { console.error('[aiObserveTurnStart]', e); }
};

// ===== AIの作戦（デッキの設計図・相手のデッキの読み・勝ち筋の逆算）=====
// 設計図は対戦開始時に作る（battle.js startBattleGame → ai-brain.js buildDeckProfile）。中・高とも使う
function _aiProfile() { return (typeof window !== 'undefined' && window._aiProfile) || null; }
// 勝ち筋のカード（設計図の一番上のレベルのデジモン）か
function _aiIsFinisher(c) { const p = _aiProfile(); return !!(p && c && p.finisherNames.includes(c.name)); }
// 勝ち筋へつながるデジモン（デッキの軸の特徴を持つ）か
function _aiOnLine(c) {
  const p = _aiProfile();
  if (!p || !c || !_aiIsDigi(c)) return false;
  return p.finisherNames.includes(c.name) || (!!p.axis && String(c.feature || '').split(/[\/／]/).map(s => s.trim()).includes(p.axis));
}
// 守りのカード（ブロッカー・相手のデジモンを取り除く・進化元を破棄する）
function _aiIsDefensive(c) { const t = _aiTagsOf(c); return !!(t.blocker || t.removal || t.evoDiscard); }
// 相手のデッキの読み（高だけ）: 相手が見せたカード（場・進化元・育成・テイマー・トラッシュ）を覚えておき、
// 4種類以上見えたら設計図と同じやり方で型を推測する。読みが変わったらログに出す。手札・セキュリティ・デッキは見ない
// 相手が見せたカード（場・進化元・育成・テイマー・トラッシュ）を覚えて返す（中・高）。カードNoごとに1枚
function _aiCollectSeenOpp() {
  const seen = bs._aiSeenOpp || (bs._aiSeenOpp = new Map());
  const add = (c) => { if (c && c.cardNo && String(c.level) !== '2' && !seen.has(c.cardNo)) seen.set(c.cardNo, c); };
  const pl = bs.player;
  [...(pl.battleArea || []), pl.ikusei].forEach(c => { if (!c) return; add(c); (c.stack || []).forEach(add); });
  (pl.tamerArea || []).forEach(add);
  (pl.trash || []).forEach(add);
  return seen;
}
function _aiOppRead() {
  if (!_aiIsHigh()) return null;
  const seen = _aiCollectSeenOpp();
  if (seen.size < 4) return null;
  if (bs._aiOppReadN !== seen.size) {
    bs._aiOppReadN = seen.size;
    try { bs._aiOppRead = _aiBuildProfile([...seen.values()]); } catch (_) { bs._aiOppRead = null; }
    if (bs._aiOppRead && bs._aiOppRead.label !== bs._aiOppLabel) {
      bs._aiOppLabel = bs._aiOppRead.label;
      addLog('👑 ' + (window._aiName || 'デジモンマスター') + 'の読み: 相手は「' + bs._aiOppRead.label + '」');
      _aiWhy('あなたのデッキは「' + bs._aiOppRead.label + '」だと読みました ← これまでに見えたカード' + seen.size + '種類の特徴・色・効果から判断しました。この読みに合わせて、守りに入るタイミングやメモリーの渡し方を変えます。');
    }
  }
  return bs._aiOppRead || null;
}
// 勝ち筋の逆算（高だけ）: 今の盤面から、次に何をすべきかを決める
//  'defend'  … 次の相手のターンに負けうる（_aiHighDefense）→ 守りのカードを優先、それ以外にメモリーを渡さない
//  'push'    … 今の自分のデジモン（育成の Lv.3 以上も）で、次の自分のターンに勝ち切れる見込み → アタックできるデジモンを育てる
//  'develop' … まだ届かない → 設計図の勝ち筋（一番上のレベルのデジモン）に向けて育てる
function _aiPlan() {
  if (!_aiIsHigh()) return 'develop';
  if (_aiHighDefense()) return 'defend';
  const own = (bs.ai.battleArea || []).filter(_aiIsDigi);
  const chk = own.filter(c => !_aiCantHitPlayer(c)).map(_aiChecksOf);
  if (bs.ai.ikusei && _lvOf(bs.ai.ikusei) >= 3) chk.push(1);
  chk.sort((a, b) => b - a);
  const blockers = (bs.player.battleArea || []).filter(c => c && _aiIsDigi(c) && isBlocker(c)).length;
  let sec = (bs.player.security || []).length;
  for (const k of chk.slice(blockers)) { if (sec === 0) return 'push'; sec = Math.max(0, sec - k); }
  return 'develop';
}
const _AI_PLAN_JA = { defend: '守りを固める', push: '次のターンで勝ち切る準備', develop: '勝ち筋を育てる' };
// 作戦が変わったらログに出す（高のメインフェイズ）
function _aiLogPlan() {
  if (!_aiIsHigh()) return;
  const plan = _aiPlan();
  const key = bs.turn + ':' + plan;
  if (bs._aiPlanLog === key) return;
  bs._aiPlanLog = key;
  const p = _aiProfile();
  addLog('👑 作戦: ' + _AI_PLAN_JA[plan] + (plan === 'develop' && p && p.finisherNames.length ? '（' + p.finisherNames[0] + '）' : ''));
  _aiWhy(plan === 'defend' ? 'このターンは守りを固めます ← 自分のセキュリティが少ない、または次のあなたのアタックで負ける可能性があるからです。ブロッカーや除去を優先して使い、守り以外のカードにはメモリーをなるべく渡しません。'
    : plan === 'push' ? 'このターンは、次のターンで勝ち切るための準備をします ← 今の場のデジモンで、次のターンにセキュリティを削り切れる見込みがあるからです。アタックできるデジモンを強くすることを優先します。'
    : '切り札' + (p && p.finisherNames.length ? 'の「' + p.finisherNames[0] + '」' : '') + 'を目指して育てます ← まだ勝ち切れる状況ではないので、勝ち筋のデジモンを場に出す準備を進めます。');
}
// アタッカーとアタック先の組み合わせを全部見積もって、一番良いものを選ぶ。{ atkIdx, tgt } か null（アタックしない）
//  ・勝ち切れるターン: 全員でプレイヤーへ（ブロックされても続ける）
//  ・守りを固めるべきとき: 【ブロッカー】のデジモンはアタックせずに残す
//  ・デジモンを倒す: 倒す相手の脅威（【ブロッカー】はさらに高く）。相打ちは、相手の脅威が自分のデジモンの価値を上回るときだけ
//  ・セキュリティ: チェック数 ×（相手のセキュリティが2枚以下なら大きく）。ブロックされて負けるなら行かない
//  同じ相手なら、弱いアタッカーで倒して強いデジモンを残す
function _aiHighPickAttack(canAttack) {
  const area = bs.ai.battleArea || [];
  const idxs = area.map((c, i) => (canAttack(c) ? i : -1)).filter(i => i >= 0);
  if (idxs.length === 0) return null;
  const lethal = _aiHighLethal(idxs.map(i => area[i]));
  const defense = !lethal && _aiHighDefense();
  const pa = bs.player.battleArea || [];
  const secLeft = (bs.player.security || []).length;
  const _secThreat = !lethal && _aiOppSecOptionThreat();
  const _secDiff = (bs.ai.security || []).length - secLeft;   // セキュリティの枚数の差（プラス＝リード）
  const _oppHand = (bs.player.hand || []).length;
  const _oppHasDigi = pa.some(_aiIsDigi);
  let best = null;
  const consider = (v, atkIdx, tgt) => { if (!best || v > best.v) best = { v, atkIdx, tgt }; };
  for (const i of idxs) {
    const c = area[i];
    const atkDp = _dpOf(c);
    // ターン終了時にアクティブに戻るデジモンは、アタックしても守り（ブロッカー）に使える・レスト状態で狙われない
    const _react = _aiWillReactivateAtTurnEnd(c);
    if (defense && isBlocker(c) && !_react) continue;
    const _meaning = _aiAttackMeaningful(c);
    // 【アタック時】で相手のデジモンを取り除けるデジモンは先にアタックする（ブロッカー等を消してから本命が殴る）
    const _first = (_oppHasDigi && _aiOnAttackUseful(c) && [c, ...(c.stack || [])].some(x => { const t = _aiTagsOf(x); return t.removal || t.evoDiscard; })) ? 1500 : 0;
    // 相手の手札が多い（6枚以上）ときは、カウンター・ブラスト進化を警戒して、価値の高いデジモン（Lv.6 以上）の意味のないアタックを控えめに
    const _handRisk = (_oppHand >= 6 && _lvOf(c) >= 6 && !_meaning) ? 1500 : 0;
    // ブロックされたら負ける（自分が消滅する／相手を消滅させられない）ブロッカー（≪氷装≫等の効果も見る）
    const _badBlock = (exceptIdx) => _aiPlayerBlockersFor(c, exceptIdx).some(b => { const o = _aiBattleOutcome(c, b, 'player'); return o.atkDies || !o.defDies; });
    if (!_aiCantHitPlayer(c)) {
      const checks = _aiChecksOf(c);
      if (lethal) consider(1000000 + checks * 10 - atkDp / 1000, i, { mode: 'security' });
      else if (!_badBlock(-1) && _aiSecAttackSafe(c)) {
        // 相手のセキュリティから弱らせるオプションが出てきそうなら、価値の低いデジモンから先にセキュリティを削る
        // （強いデジモンはあとに残す）
        //  【プログレス】等で相手の効果を受けないデジモンは、セキュリティのオプションを気にしなくてよい
        const _risk = (_secThreat && !_aiImmuneDuringAttack(c)) ? _aiOwnValue(c) * 0.05 : 0;
        // アタックしてレストすると次の相手のターンに倒される Lv.5 以上は、意味のあるアタックでなければ控える（相手のセキュリティ2枚以下なら攻める）
        const _expose = (!_react && secLeft > 2 && _lvOf(c) >= 5 && !_meaning && _aiExposedAfterAttack(c)) ? _aiOwnValue(c) * 0.15 : 0;
        consider(checks * (secLeft <= 2 ? 6000 : 2500) - atkDp * 0.05 - _risk - _expose - _handRisk + _first, i, { mode: 'security' });
      }
    }
    if (lethal) continue;
    for (let j = 0; j < pa.length; j++) {
      const d = pa[j];
      if (!_aiIsDigi(d)) continue;
      const ok = window._canAttackDigimonTarget ? window._canAttackDigimonTarget(c, d, bs, 'ai') : d.suspended;
      if (!ok) continue;
      // 消滅させられる相手だけ（≪氷装≫・バトルで消滅しない・≪防壁≫・≪道連れ≫も見る）。自分も消滅するなら自分の価値を引く
      const _o = _aiBattleOutcome(c, d, 'player');
      if (!_o.defDies) continue;
      if (_badBlock(j)) continue;
      let v = _aiThreat(d) + (isBlocker(d) ? 2500 : 0);
      if (_o.atkDies) v -= _aiOwnValue(c);
      // ≪貫通≫: 消滅させて自分が残れば、さらにセキュリティチェック
      if (!_o.atkDies && hasPenetrate(c)) v += _aiChecksOf(c) * (secLeft <= 2 ? 6000 : 2500);
      // セキュリティで2枚以上リードしているときは、相手のデジモンを倒して安全に進める
      if (_secDiff >= 2) v += 1000;
      consider(v - atkDp * 0.05 - _handRisk + _first, i, { mode: 'digimon', idx: j, def: d });
    }
  }
  return best && best.v > 0 ? { atkIdx: best.atkIdx, tgt: best.tgt } : null;
}
// 高のブロック: 勝てるなら一番価値の低い勝てるデジモンで。相打ちは相手の脅威が上なら。
// 負けるブロックは、プレイヤーへのアタックでチェック数が残りのセキュリティ以上・セキュリティ2枚以下・Sアタック+のときに、
// 一番価値の低いデジモン（【消滅時】持ちは身代わりに向く）で。自分のデジモンが狙われたときは、そのデジモンの方がずっと価値が高いなら身代わりを出す
function _aiHighChooseBlocker(atk, cands, targetIdx) {
  const area = bs.ai.battleArea;
  const val = (i) => _aiOwnValue(area[i]);
  const cheap = cands.slice().sort((a, b) => val(a) - val(b));
  // バトルの見積もり（≪氷装≫・消滅しない・≪防壁≫・≪道連れ≫も見る）
  const oc = (d) => _aiBattleOutcome(atk, d, 'ai');
  if (targetIdx >= 0 && area[targetIdx] && !oc(area[targetIdx]).defDies) return -1; // 狙われたデジモンが残る
  const win = cheap.filter(i => { const o = oc(area[i]); return !o.defDies && o.atkDies; });
  if (win.length) return win[0];
  const safe = cheap.filter(i => !oc(area[i]).defDies);
  if (safe.length) return safe[0];
  const tie = cheap.filter(i => { const o = oc(area[i]); return o.defDies && o.atkDies; });
  if (tie.length && _aiThreat(atk) >= val(tie[0])) return tie[0];
  if (cheap.length === 0) return -1;
  // ≪貫通≫のアタッカーは、ブロッカーを消滅させるとセキュリティチェックするので、負けるブロックで守れない
  if (hasPenetrate(atk)) return -1;
  if (targetIdx < 0) {
    const sec = (bs.ai.security || []).length;
    const checks = _aiChecksOf(atk);
    if (sec === 0 || checks >= sec || sec <= 2 || (checks >= 2 && val(cheap[0]) < 9000)) return cheap[0];
    return -1;
  }
  return _aiOwnValue(area[targetIdx]) > val(cheap[0]) + 3000 ? cheap[0] : -1;
}
// 高: 相手のデジモンを取り除くオプションは、弱い相手には使わず強い相手が出るまで手札に残す（負けそうなら今使う）
function _aiHighHoldOption(c) {
  if (!c || (c.type !== 'オプション' && c.type !== 'デュアル')) return false;
  if ((bs.ai.security || []).length <= 2) return false;
  // 守りを固める作戦（このままだと次の相手のターンに負けうる）なら、取っておかずに今使う
  if (_aiPlan() === 'defend') return false;
  let r = c.recipe;
  if (typeof r === 'string') { try { r = r ? JSON.parse(r) : null; } catch (_) { r = null; } }
  const steps = (r && Array.isArray(r.main)) ? r.main.filter(Boolean) : [];
  const removal = steps.some(st => /^opp/.test(String(st.target || '')) && /^(destroy|bounce|return_deck|dedigivolve|return_hand)$/.test(String(st.action || '')))
    || (steps.some(st => st.action === 'select' || st.action === 'select_multi') && steps.some(st => st.card && /^(destroy|bounce|return_deck)$/.test(String(st.action || ''))));
  if (!removal) return false;
  const maxThreat = Math.max(0, ...(bs.player.battleArea || []).filter(_aiIsDigi).map(_aiThreat));
  return maxThreat < 9000;
}
// 高: 考えている間「👑 デジモンマスターが考え中...」を出す（行動の前に少し待つ）
function _aiThink(cb) {
  if (!_aiIsHigh() || typeof document === 'undefined') { cb(); return; }
  let el = document.getElementById('ai-think-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ai-think-banner';
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:59000;pointer-events:none;'
      + 'background:rgba(20,0,30,0.88);border:1px solid #ff00fb;color:#fff;font-size:13px;font-weight:bold;'
      + 'padding:6px 16px;border-radius:20px;box-shadow:0 0 12px rgba(255,0,251,0.5);white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.innerHTML = (typeof window._aiIconHtml === 'function' ? window._aiIconHtml(22) : (window._aiIcon || '👑')) + ' ' + String(window._aiName || 'デジモンマスター').replace(/[&<>]/g, '') + 'が考え中...';
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
    if (bs._battleAborted) return;
    cb();
  }, 700);
}

// 相打ちで CPU のアタックしたデジモンが残ったとき: 「バトルで相手のデジモンを消滅させたとき」を発揮する
// （「バトルに勝ったとき」は相打ちなので除く。window._battleTieNoWin）
function _aiTieFireDestroyedTrigger(atk, def, done) {
  bs._lastBattleWinner = atk;
  bs._lastBattleDefeatedCard = def;
  window._battleTieNoWin = true;
  _hooks.triggerEffect('on_battle_win', atk, 'ai', _hooks.makeEffectContext(atk, 'ai'), () => {
    window._battleTieNoWin = false;
    bs._lastBattleWinner = null;
    bs._lastBattleDefeatedCard = null;
    done && done();
  });
}
// AI対戦: 画面の演出が終わるまで待ってから fn（battle-online.js window._cpuFxIdle）
function _aiAfterFx(fn) {
  if (typeof window !== 'undefined' && window._aiBattleActive && !_onlineMode && typeof window._cpuFxIdle === 'function') { window._cpuFxIdle(fn); return; }
  fn();
}
// ===== CPU の「効果でアタックする」（【急襲】・【ディレイ】の「〜でアタックできる」等）=====
// 効果の発動・確認・表示はプレイヤーと同じエンジンの流れ（【自分のターン終了時】の誘発 → 「発動しますか？」→ 効果の
// attack アクション）で行い、アタックそのもの（アタック先の選び方・バトル）は CPU のアタックの処理で行う。
// effect-engine.js の attack アクションが ctx.side==='ai' のとき window._aiEffectAttack を呼ぶ
let _aiEffectAtkSet = null; // 効果でアタックしてよいデジモン（この中の1体が1回アタックする）
let _aiRaidMode = false;    // 効果のアタック中（メモリーが相手側でもアタックする）
// 進化元の【自分のターン】「〜このデジモンは【急襲】を得る」（レプティリモン ST25-04/BT27-014 の進化元）で得た【急襲】は
// _evoGrantedKeywords に入る（_permEffects には入らない）ので、そちらも見る。以前は見ておらず、進化元のレプティリモンで
// 【急襲】を得たルビウスドラモンがターン終了時にアタックしなかった
function _aiHasRaid(c) {
  if (!c) return false;
  if (hasPassiveFlag(c, 'attack_at_end_phase', '')) return true;
  const ek = c._evoGrantedKeywords;
  return !!(ek && typeof ek.has === 'function' && ek.has('attack_at_end_phase'));
}
// 効果のアタックを実行する: cands（アタックできる候補）から、ふつうのアタックと同じ判断で1体と先を選んでアタックし、
// バトル・アタック終了まで終わったら done。アタックする意味が無ければ（中・高の判断）アタックせずに done
let _aiEffectAtkOnDeclare = null; // 効果のアタックを宣言したときに呼ぶ（他の【ターン終了時】を発揮しない等）
let _aiEffectAtkWithoutRest = false; // 「レストせずアタックできる」（options:without_rest）
if (typeof window !== 'undefined') window._aiEffectAttack = (cands, step, done, onDeclare) => {
  if (!window._aiBattleActive || _onlineMode || bs._battleAborted || !Array.isArray(cands) || cands.length === 0) { done && done(); return; }
  _aiEffectAtkSet = new Set(cands);
  _aiEffectAtkOnDeclare = onDeclare || null;
  const _opts = (step && Array.isArray(step.options)) ? step.options : [];
  _aiEffectAtkWithoutRest = _opts.includes('without_rest');
  // 「この効果では、アクティブ状態の相手のデジモンにもアタックできる」（allow_active。雪片の絆 ED01-10）: 候補のどれでも
  if (_opts.includes('allow_active')) bs._effectAttackAllowActive = new Set(cands);
  _aiRaidMode = true;
  aiAttackPhase(() => {
    _aiRaidMode = false; _aiEffectAtkSet = null; _aiEffectAtkWithoutRest = false;
    if (bs._effectAttackAllowActive instanceof Set) delete bs._effectAttackAllowActive;
    done && done();
  });
};
// 効果のアタックをするか（任意の効果の「発動しますか？」の CPU の判断。effect-engine.js _cpuStepWorthIt から）:
// 候補のどれかで、ふつうのアタックと同じ判断のアタック先があれば「する」
if (typeof window !== 'undefined') window._aiWantsEffectAttack = (cands) => {
  if (!Array.isArray(cands) || cands.length === 0) { console.log('[aiWantsEffectAttack] 候補なし'); return false; }
  if (!_aiIsMid()) return true;
  const set = new Set(cands);
  const prevRaid = _aiRaidMode; _aiRaidMode = true;
  let ok = true;
  try {
    if (_aiIsHigh()) ok = !!_aiHighPickAttack((c) => !!c && set.has(c) && !c.suspended);
    else ok = cands.some(c => !!_aiMidPickTarget(c));
  } catch (e) { console.error('[aiWantsEffectAttack]', e); ok = true; } finally { _aiRaidMode = prevRaid; }
  console.log('[aiWantsEffectAttack]', cands.map(c => c.name + '(DP' + _dpOf(c) + ')').join(','), '→', ok, '見積もり', _aiEstSecDp());
  if (!ok) {
    // しない理由（調査用）: ブロックされたら負けるブロッカー（≪氷装≫等も見た結果）・セキュリティの見積もり
    const why = cands.map(c => c.name + '（' + _aiNoAttackReason(c) + '）').join('・');
    addLog('🧠 効果のアタックはしない: ' + why);
    _aiWhy('【急襲】などの効果でのアタックはしません ← ' + cands.map(c => '「' + c.name + '」は、' + _aiNoAttackReason(c) + 'ためです').join('。') + '。');
  }
  return ok;
};
// 進化させると【急襲】を持つか（進化先のカード自身か、進化元になる base / その下のカードが【急襲】を与える）
function _aiWillHaveRaid(base, evoCard) {
  if (!base || !evoCard) return false;
  if (_aiTagsOf(evoCard).raid) return true;
  return [base, ...(base.stack || [])].some(x => _aiTagsOf(x).raidEvo);
}
// 先を見た行動（中・高）: このデジモンをアタックさせずに残し、アタックの後に進化させて【急襲】でターン終了時にアタックするか。
//  条件: アクティブ／このターンで勝ち切れない／手札に、このデジモンから進化できて【急襲】になるカードがある（勝ち筋のカードか、
//  セキュリティのデジモンに負けないDP）／進化コストが、自分のメモリー＋相手に渡してよい分で払える
function _aiHoldForRaid(c) {
  if (!_aiIsMid() || !c || c.suspended || _aiRaidMode || _aiOverflowOK) return false;
  if (bs._aiRaidPlanTurn === bs.turn && bs._aiRaidPlanCard === c) return true;
  const area = (bs.ai.battleArea || []).filter(x => _aiIsDigi(x) && !x.suspended);
  if (_aiIsHigh() && _aiHighLethal(area)) return false;
  const best = _aiRaidEvolveFor(c, Math.abs(bs.memory) + 10);
  if (!best) return false;
  bs._aiRaidPlanTurn = bs.turn; bs._aiRaidPlanCard = c;
  addLog('🧠 「' + c.name + '」は今はアタックせず、あとで「' + best.card.name + '」に進化して【急襲】でアタックする');
  _aiWhy('「' + c.name + '」は今はアタックさせずに残します ← アタックの後でメモリーを使って「' + best.card.name + '」に進化させ、ターン終了時に【急襲】でアタックしたいからです。先にアタックしてレストすると【急襲】が使えなくなります。');
  return true;
}
// c から進化できて【急襲】になる手札のカード（コスト maxCost 以下）で、ターン終了時のアタックに意味があるもの
function _aiRaidEvolveFor(c, maxCost) {
  // 登場したターンのデジモン（から進化したデジモン）は、≪速攻≫が無ければ【急襲】でもアタックできない（公式ルール 7-1-2-1）
  if (!c || (c.summonedThisTurn && !((c._permEffects && c._permEffects.rush) || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_rush'))))) return null;
  let best = null;
  for (const e of (bs.ai.hand || [])) {
    if (!e || (e.type !== 'デジモン' && e.type !== 'デュアル')) continue;
    if (!_aiWillHaveRaid(c, e)) continue;
    let ok = false;
    try { ok = _resolveEvolveMatch(e, c) !== null || !!_getAltEvolve(e, c, bs, 'ai'); } catch (_) { ok = false; }
    if (!ok) continue;
    const cost = getEvolveCostFor(e, c);
    if (cost === null || cost === undefined || cost > maxCost) continue;
    if (!(_aiIsFinisher(e) || _dpOf(e) > _aiEstSecDp())) continue;
    if (!best || _dpOf(e) > _dpOf(best.card)) best = { card: e, cost };
  }
  return best;
}

// ===== DP+・キーワード付与の対象選び（中・高。effect-engine.js _cpuOrder 'buff' から呼ぶ）=====
// 先を見て、効果が一番役に立つデジモンを選ぶ。点数が高いほど優先
//  CPU のターン・このターンだけの効果:
//   ・【急襲】になるカードに進化してターン終了時にアタックする予定のデジモン（今は残しておく分も）＋15000
//   ・このターンに勝ち筋のカード（ルビウスドラモン等）へ進化できるデジモン ＋8000
//   ・このターンにアタックできるデジモン（アクティブ・登場したターンでない or ≪速攻≫）＋10000
//   ・DP+で、セキュリティから出てくるデジモンのDPを超える（負けなくなる）＋6000
//   ・「DP8000ごとに〜」を持ち、DP+で段階が上がる ＋4000
//   ・アタックできない（レスト中・登場したターン）デジモンは −8000（このターンの効果が無駄になる）
//  相手のターンまで続く効果／相手のターン中: 狙われやすい（レスト中）・ブロッカー・勝ち筋のデジモンを守る
if (typeof window !== 'undefined') window._aiBuffScore = (c, opt) => {
  if (!c || !_aiIsMid()) return 0;
  const ownTurn = bs.isPlayerTurn === false;
  const dur = String((opt && opt.duration) || 'dur_this_turn');
  const thisTurn = /this_turn|until_(attack|battle)_end/.test(dur) || dur === '';
  const val = parseInt(opt && opt.value, 10) || 0;
  const dp = _dpOf(c);
  let v = dp / 1000;
  if (ownTurn && thisTurn) {
    const rush = !!((c._permEffects && c._permEffects.rush) || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_rush')));
    const canSwing = !c.suspended && !c.cantAttack && (!c.summonedThisTurn || rush);
    const raidPlan = !c.suspended && ((bs._aiRaidPlanTurn === bs.turn && bs._aiRaidPlanCard === c) || !!_aiRaidEvolveFor(c, Math.abs(Math.min(0, bs.memory)) + 10));
    if (raidPlan) v += 15000;
    if (!c.suspended && (bs.ai.hand || []).some(e => {
      if (!e || !_aiIsFinisher(e)) return false;
      try { if (_resolveEvolveMatch(e, c) === null && !_getAltEvolve(e, c, bs, 'ai')) return false; } catch (_) { return false; }
      const cost = getEvolveCostFor(e, c);
      return cost !== null && cost !== undefined && cost <= Math.abs(Math.min(0, bs.memory)) + _aiOverflowAllowance(e, c);
    })) v += 8000;
    if (canSwing) v += 10000;
    else if (!raidPlan) v -= 8000;
    if (val > 0) {
      const est = _aiEstSecDp();
      if (dp <= est && dp + val > est) v += 6000;
      if (/DP\s*8000ごと/.test(String(c.effect || '')) && Math.floor((dp + val) / 8000) > Math.floor(dp / 8000)) v += 4000;
    }
  } else {
    // 守り: 相手のターンにアタックされるのはレスト中のデジモン。ブロッカー・勝ち筋のデジモンも守る
    if (c.suspended) v += 6000;
    if (isBlocker(c)) v += 5000;
    if (_aiIsFinisher(c)) v += 3000;
  }
  return v;
};

// 高（デジモンマスター）はアタックのたびに「考え中」を出してから決める
export function aiAttackPhase(callback, _fxWaited) {
  // 前の演出（デッキオープン・カードの移動等）が終わってからアタックを決める（アタックのたびに）
  if (!_fxWaited) { _aiAfterFx(() => aiAttackPhase(callback, true)); return; }
  if (_aiIsHigh() && !bs._battleAborted && !(bs.memory > 0 && !bs._aiScriptInProgress && !_aiRaidMode)) { _aiThink(() => _aiAttackPhaseBody(callback)); return; }
  _aiAttackPhaseBody(callback);
}
function _aiAttackPhaseBody(callback) {
  hideCombatBackdrop();
  if (bs._battleAborted) return;
  if (_onlineMode) { callback && callback(); return; }
  // 前の CPU のアタックは終わっている（_aiAttackEnd で外す。保険）
  _attackInProgress = false;
  // 前のアタックのセキュリティチェック・バトルの解決が終わった: 保留していた DP0 の消滅（ルールチェック）を行ってから次へ
  if (bs._attackResolving) {
    bs._attackResolving = false;
    if (typeof window !== 'undefined' && typeof window._runRuleDestroyCheckNow === 'function') {
      window._runRuleDestroyCheckNow(() => aiAttackPhase(callback));
      return;
    }
  }

  // メモリーが相手（プレイヤー）側に移っていれば AI のターンは終わっている（公式ルール）。アタックしない
  // ただし【急襲】のアタック（自分のターン終了時）はメモリーが相手側でも行う
  if (bs.memory > 0 && !bs._aiScriptInProgress && !_aiRaidMode) { callback(); return; }
  // アタックできるデジモン（自分のメインと同じ条件）: アクティブ・登場したターンでない（≪速攻≫は可）・
  // 「アタックできない」「レストできない」でない
  const _aiCanAttack = (c) => {
    if (!c || (c.type !== 'デジモン' && c.type !== 'デュアル') || c.suspended) return false;
    // 効果のアタック（≪急襲≫等）: 候補はエンジンが効果の条件（登場したターンでも≪ヴォルテクス≫等なら可）で出している
    if (_aiEffectAtkSet) return _aiEffectAtkSet.has(c) && !c.cantAttack && !c.cantRest;
    const rush = !!((c._permEffects && c._permEffects.rush) || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_rush')));
    if (c.summonedThisTurn && !rush) return false;
    if (c.cantAttack || c.cantRest) return false;
    // 中・高: このあと進化させて【急襲】でアタックする予定のデジモンは、今はアタックさせずに残す（先を見た行動）
    if (_aiHoldForRaid(c)) return false;
    return true;
  };
  // アタック先: アタックできる相手のデジモンがいればそのデジモン（先頭から）。いなければプレイヤー（セキュリティ）。
  // 「プレイヤーにアタックできない」ならプレイヤーは選べない
  const _aiPickTarget = (c) => {
    if (_aiIsMid()) return _aiMidPickTarget(c);
    const pa = bs.player.battleArea || [];
    for (let i = 0; i < pa.length; i++) {
      const d = pa[i];
      if (!d || (d.type !== 'デジモン' && d.type !== 'デュアル')) continue;
      const ok = window._canAttackDigimonTarget ? window._canAttackDigimonTarget(c, d, bs, 'ai') : d.suspended;
      if (ok) return { mode: 'digimon', idx: i, def: d };
    }
    if (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'cant_attack_player')) return null;
    return { mode: 'security' };
  };
  let atkIdx = -1, _tgt = null;
  if (_aiIsHigh()) {
    // 高: アタッカーとアタック先の組み合わせを全部見積もって選ぶ（勝ち切り・守り・脅威の大きい相手から）
    const _hp = _aiHighPickAttack(_aiCanAttack);
    if (_hp) { atkIdx = _hp.atkIdx; _tgt = _hp.tgt; }
  } else {
    for (let i = 0; i < bs.ai.battleArea.length; i++) {
      const c = bs.ai.battleArea[i];
      if (!_aiCanAttack(c)) continue;
      const t = _aiPickTarget(c);
      if (t) { atkIdx = i; _tgt = t; break; }
    }
  }
  if (atkIdx === -1) {
    // アタックしない理由（アクティブなデジモンごと）
    if (!_aiEffectAtkSet && !bs._aiScriptInProgress) {
      const _idle = (bs.ai.battleArea || []).filter(x => _aiIsDigi(x) && !x.suspended);
      if (_idle.length) _aiWhy('これ以上アタックしません ← ' + _idle.map(x => '「' + x.name + '」は、' + _aiNoAttackReason(x) + 'ため').join('。') + '。');
    }
    callback(); return;
  }
  {
    const _a = bs.ai.battleArea[atkIdx];
    if (_tgt && _tgt.mode === 'digimon' && _tgt.def) {
      const _o = _aiBattleOutcome(_a, _tgt.def, 'player');
      _aiWhy('「' + _a.name + '」で、あなたの「' + _tgt.def.name + '」にアタックします ← ' + (_o.ice ? '【氷装】があるので進化元の枚数で比べると' + (_a.stack || []).length + '枚対' + (_tgt.def.stack || []).length + '枚です。' : 'DPは' + _dpOf(_a) + '対' + _dpOf(_tgt.def) + 'です。')
        + (_o.atkDies ? '相打ちになりますが、あなたのデジモンの方が脅威なので倒しておきたいからです。' : 'こちらは生き残って、あなたのデジモンを倒せるからです。') + (isBlocker(_tgt.def) ? 'ブロッカーを先に倒しておくと、このあとのアタックが通りやすくなります。' : ''));
    } else {
      const _l = _aiIsHigh() && (() => { try { return _aiHighLethal((bs.ai.battleArea || []).filter(x => _aiIsDigi(x) && !x.suspended)); } catch (_) { return false; } })();
      if (!_aiEffectAtkSet && _aiWillReactivateAtTurnEnd(_a)) _aiWhy('「' + _a.name + '」は、今アタックしてもターン終了時にアクティブに戻る ← 進化元の効果で「進化元を破棄しなかったならアクティブにする」が働くからです（あなたの場に進化元を持つデジモンがいないので、破棄は起きません）。アクティブのまま終えるとこの効果が無駄になるので、今アタックしておきます。');
      _aiWhy('「' + _a.name + '」でセキュリティにアタックします ← ' + ((bs.player.security || []).length === 0 ? 'セキュリティが0枚なので、とどめを刺します。' : _l ? 'このターンで勝ち切れる計算なので、全員で攻めます。' : 'このアタックを止められるブロッカーがいなく、セキュリティから強いデジモンが出ても負けないDP（' + _dpOf(_a) + '）なので、セキュリティを削ります。'));
    }
  }
  // 効果のアタックは1回だけ（このアタックが終わって戻ってきたら、候補なしで done へ）
  if (_aiEffectAtkSet) {
    _aiEffectAtkSet = new Set();
    const _od = _aiEffectAtkOnDeclare; _aiEffectAtkOnDeclare = null;
    if (_od) { try { _od(); } catch (e) { console.error('[aiEffectAtkDeclare]', e); } }
  }

  // アタック中に進化（アーツ進化等）したら、進化後のカードを同じデジモンのアタッカーとして扱う（プレイヤーの _evolvedAttacker と同じ）
  let atk = bs.ai.battleArea[atkIdx];
  const _evolvedAiAttacker = () => {
    const cur = bs.ai.battleArea[atkIdx];
    if (cur && cur !== atk && _isSameDigimon(cur, atk)) atk = cur;
    return atk;
  };
  // このアタックが終わった後: 次のアタッカーへ（チュートリアルのスクリプトなら呼び出し元へ）
  const _nextAttacker = () => {
    if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
  };
  // アタックの終了: 【アタック終了時】・「アタック終了まで」の期限切れ・保留していた DP0 の消滅等（プレイヤーの checkAttackEnd と同じ）
  const _endAiAttack = () => _aiAttackEnd(atk, atkIdx, _nextAttacker);
  // プレイヤーのアタック（startAttack）と同じく、アタックの処理中の印を立てる（アタック終了の _attackEndCommon で外す）。
  // アタック中は保留中の DP0 の消滅・【衝突】のブロッカー等がアタック中として扱われる
  _attackInProgress = true;
  if (typeof window !== 'undefined') window._destroyFxBatch = null;
  // 効果の「レストせずアタックできる」（without_rest）ならレストしない
  if (!(_aiEffectAtkSet && _aiEffectAtkWithoutRest)) { atk.suspended = true; _markRuleRest(atk); }
  atk._attackedOnTurn = bs.turn; // cond_self_attacked 用
  bs._attackEndRequested = false;
  bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
  // アタック対象（cond_attack_target_digimon 等の条件で参照。プレイヤーのアタックと同じ記録）
  bs._lastAttackTarget = _tgt.mode;
  bs._lastAttackTargetIdx = _tgt.mode === 'digimon' ? _tgt.idx : -1;
  bs._lastAttackIsDirect = _tgt.mode === 'security' && (bs.player.battleArea || []).filter(c => c).length === 0;
  addLog('🤖 「' + atk.name + '」でアタック！ → ' + (_tgt.mode === 'digimon' ? '「' + _tgt.def.name + '」' : 'プレイヤー'));
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
      const _afterKw = () => {
        // subject:"both"（お互いのターンでアタック時発動）の進化元効果をプレイヤー側で反応させる
        _hooks.fireOnAttackBothSubjectTriggers('ai', () => {
          // subject:"opp"（相手のデジモンがアタックしたとき）の進化元効果をプレイヤー側で反応させる
          _hooks.fireOnAttackOppSubjectTriggers('ai', () => {
            if (_tgt.mode === 'security' && window._fireWhenOppAttack && !bs._attackEndRequested) {
              window._fireWhenOppAttack('ai', bs, { bs, addLog, renderAll, updateMemGauge }, cb);
            } else { cb(); }
          });
        });
      };
      // アタックしたデジモンのキーワード（【突進】【衝突】【プログレス】等の on_attack 型）は、【アタック時】の後、
      // 相手の「アタックしたとき」より先に処理する（プレイヤーのアタックの _afterAtkEffectBody と同じ。CPU は任意効果を自動で使う）
      const _afterAtkTime = () => {
        const ctxBase = { bs, addLog, renderAll, updateMemGauge };
        const _afterKwF = () => _flushAtAttackStep(_afterKw);
        try { _fireKeywordAttackEffects(_evolvedAiAttacker(), 'ai', bs, ctxBase, _afterKwF); }
        catch (e) { console.error('[aiAttack keyword]', e); _afterKwF(); }
      };
      // 常にスキャン（付与効果・誘発も拾う。効果が無ければ即コールバック）。【アタック時】で誘発して後回しにした効果は、
      // キーワードの効果へ進む前に発揮する
      _hooks.checkAndTriggerEffect(atk, '【アタック時】', () => _flushAtAttackStep(_afterAtkTime), 'ai');
    };

    // ブロックされなかったときの続き: デジモンへのアタックならそのデジモンとバトル、プレイヤーならセキュリティチェック
    const _aiProceed = () => {
      _evolvedAiAttacker();
      if (_tgt.mode === 'digimon') {
        const _defNow = bs.player.battleArea[_tgt.idx];
        if (!_defNow || !_isSameDigimon(_defNow, _tgt.def)) {
          // アタック対象がバトルエリアを離れた: バトルは起きずアタック終了
          addLog('⚔ アタック対象の「' + _tgt.def.name + '」がいないので、バトルは発生しない');
          renderAll();
          _endAiAttack();
          return;
        }
        resolveBattleAI(atk, atkIdx, _defNow, _tgt.idx, _endAiAttack);
        return;
      }
      doAiSecurityCheck(atk, atkIdx, _endAiAttack);
    };
    // プレイヤーがブロックした: プレイヤー側ブロッカーがレストした → AI 側 when_opp_rest + プレイヤー側 when_own_block 発火
    // → 「ブロックされたとき」→ バトル
    const _aiBlocked = (blockerIdx) => {
      const blocker = bs.player.battleArea[blockerIdx];
      if (!blocker) { _aiProceed(); return; }
      blocker.suspended = true; _markRuleRest(blocker);
      addLog('🛡 「' + blocker.name + '」でブロック！');
      if (window._tutorialRunner && window._tutorialRunner.active) {
        try { window._tutorialRunner.notifyEvent('block', { cardNo: blocker.cardNo, cardName: blocker.name, side: 'player' }); } catch (e) {}
      }
      renderAll();
      fireBlockReactionThen('player', () => {
        afterBlockedEffect(_evolvedAiAttacker(), atkIdx, 'ai', () => {
          resolveBattleAI(_evolvedAiAttacker(), atkIdx, blocker, blockerIdx, _endAiAttack);
        });
      });
    };

    const _afterAnnounce = () => {
    doAfterAtkEffect(() => {
      // アタック中のデジモンがバトルエリアを離れていれば、アタックは成立しない（公式ルール 11-2-7-4 / 11-5-1-4）
      const _aiCur = bs.ai.battleArea[atkIdx];
      const _aiEnded = !!bs._attackEndRequested;
      if (_aiEnded || !_isSameDigimon(_aiCur, atk)) {
        bs._attackEndRequested = false;
        addLog(_aiEnded ? '✋ 「' + atk.name + '」のアタックは効果で終了した' : '⚔ アタック中の「' + atk.name + '」がバトルエリアにいないので、アタックは成立しない');
        bs._redirectedAttack = null;
        renderAll();
        // プレイヤーのアタック（_attackerLeftField → checkAttackEnd）と同じくアタック終了の処理をする
        _endAiAttack();
        return;
      }
      // アタック時の効果の間に進化していれば、進化後のカードがアタッカー（同じデジモン）
      _evolvedAiAttacker();
      // こちらの効果（【カウンター】の「アタックの対象を自分のデジモン1体に変更できる」等）や CPU の【突進】でアタックの対象が
      // 変わっていれば、ブロックの確認は出さずに変更先とバトルする（変更先はもう選んでいる。ユーザー決定事項）
      {
        const _ra = bs._redirectedAttack;
        bs._redirectedAttack = null;
        // 「アタックの対象は変更されない」: アタッカー自身か元の宣言先のデジモンが持つなら変更しない
        // （プレイヤーのアタックの _consumeRedirectedAttack と同じ）
        const _origDef = _tgt.mode === 'digimon' ? bs.player.battleArea[_tgt.idx] : null;
        const _raLocked = _cantRedirectAttack(atk) || !!(_origDef && _origDef.cantRedirectAttack);
        const _raDef = (!_raLocked && _ra && _ra.side === 'player') ? bs.player.battleArea[_ra.idx] : null;
        if (_raDef) {
          resolveBattleAI(atk, atkIdx, _raDef, _ra.idx, _endAiAttack);
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
      // 【衝突】: CPU のデジモンのアタック中、プレイヤーのデジモン全ては【ブロッカー】を得て、可能ならブロックしなければならない
      // （オンラインの防御側 checkOnlineBlock と同じ判定。ブロックするデジモンはプレイヤーが選ぶ）
      const forcedBlock = _hasCollision(atk, 'ai');
      bs.player.battleArea.forEach((c, i) => {
        if (c && _canBlockNow(c) && (forcedBlock ? (!c.type || c.type === 'デジモン') : isBlocker(c))) {
          if (atkCantBeBlocked) return; // ブロックされない: スキップ
          if (atkCantBeBlockedByNoEvo && (!c.stack || c.stack.length === 0)) return; // 進化元なしブロッカーは不可
          blockerIndices.push(i);
        }
      });

      if (forcedBlock && blockerIndices.length > 0) {
        // 【衝突】のブロックは強制: 「ブロックしますか？」は出さず、ブロックするデジモンを選ぶだけ（1体なら自動）。
        // 選択をキャンセルしても必ずどれかでブロックする（選び直し）
        addLog('💥 相手の「' + atk.name + '」の【衝突】: ブロックしなければならない');
        if (blockerIndices.length === 1) { _aiBlocked(blockerIndices[0]); return; }
        const _pickForced = () => showBlockerSelection(blockerIndices, atk, (selectedIdx) => {
          if (selectedIdx !== null && blockerIndices.includes(selectedIdx)) _aiBlocked(selectedIdx);
          else _pickForced();
        });
        _pickForced();
        return;
      }
      if (blockerIndices.length > 0) {
        // チュートリアル: ブロック確認画面の前に割り込み
        const _showBlock = () => { window._blockConfirmCands = blockerIndices; return showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
          if (doBlock) {
            if (blockerIndices.length === 1) {
              _aiBlocked(blockerIndices[0]);
            } else {
              showBlockerSelection(blockerIndices, atk, (selectedIdx) => {
                if (selectedIdx !== null) {
                  _aiBlocked(selectedIdx);
                } else {
                  _aiProceed();
                }
              });
            }
          } else {
            _aiProceed();
          }
        }, _tgt.mode === 'digimon' ? { type: 'digimon', name: _tgt.def.name } : { type: 'security' }); };
        _showBlock();
        return;
      }
      _aiProceed();
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

// callback: このセキュリティチェックが全て終わったら呼ぶ（次のアタッカーへ進むのは呼び出し側。以前は中で aiAttackPhase を
// 呼んでいたため、≪貫通≫のセキュリティチェックの後の「バトルに勝ったとき」・消滅時効果の順番が崩れていた）
export function doAiSecurityCheck(atk, atkIdx, callback, _remainingChecks, _checksDone) {
  _beginAttackResolution();
  showCombatBackdrop();
  _checksDone = _checksDone || 0;
  // Sアタック+Nのチェック枚数は最初の呼び出し時にセットし、各チェックで -1
  if (_remainingChecks === undefined) {
    _remainingChecks = getSecurityAttackCount(atk);
    if (_remainingChecks > 1) {
      addLog('⚔ AI「' + atk.name + '」のセキュリティチェック x' + _remainingChecks + '！');
      // プレイヤーと同じく「⚔ セキュリティアタック+N！！」アナウンス演出を挟んでから開始
      showSAttackPlusAnnounce(_remainingChecks - 1, () =>
        doAiSecurityCheck(atk, atkIdx, callback, _remainingChecks, _checksDone)
      );
      return;
    }
  }
  // Sアタック-Nでチェック数が0になっている場合はセキュリティを捲らずアタック終了
  if (_remainingChecks === 0) {
    addLog('🛡 「' + atk.name + '」のセキュリティチェック数が0のため、セキュリティをチェックしません');
    showBattleResult('チェックなし', '#3399ff', _saMinusLabel(atk) + 'のため、セキュリティチェックできません', () => {
      hideCombatBackdrop();
      callback && callback();
    });
    return;
  }
  // プレイヤーのアタック（resolveSecurityCheck の doNextCheck）と同じく、1枚ごとにアタッカーを確かめる:
  // 進化していれば進化後のカードでアタックを続け、場を離れていればアタック終了。Sアタック+が失われていれば終了
  {
    const _curAtk = bs.ai.battleArea[atkIdx];
    if (_curAtk && _curAtk !== atk && _isSameDigimon(_curAtk, atk)) {
      addLog('⬆ アタッカー「' + atk.name + '」が「' + _curAtk.name + '」になった（同じデジモンなのでアタック継続）');
      atk = _curAtk;
    }
    if (bs.ai.battleArea[atkIdx] !== atk) {
      addLog('⚔ アタッカーが場を離れたためセキュリティチェックを終了');
      hideCombatBackdrop();
      callback && callback();
      return;
    }
    if (_checksDone > 0 && _checksDone + 1 > getSecurityAttackCount(atk)) {
      addLog('⚔ Sアタック+効果が失われたためセキュリティチェック終了');
      hideCombatBackdrop();
      callback && callback();
      return;
    }
  }
  // _remainingChecks -1 にしてから1枚めくる。0になったら callback へ、残があればこの関数を再帰
  const _nextRemaining = Math.max(0, _remainingChecks - 1);
  const _checkNumber = _checksDone + 1;
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
  // 次の接続: 残があれば同じアタッカー（進化していれば進化後）で続ける、なければ callback
  const _afterOne = () => {
    const _curA = bs.ai.battleArea[atkIdx];
    if (_nextRemaining > 0 && _curA && _isSameDigimon(_curA, atk) && bs.player.security.length > 0) {
      setTimeout(() => doAiSecurityCheck(atk, atkIdx, callback, _nextRemaining, _checkNumber), 500);
    } else {
      hideCombatBackdrop();
      callback && callback();
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
        if (atk.dp <= sec.dp) {
          // CPU のデジモンが負けた（相打ち含む）: 消滅回避（キーワード・「消滅するとき〜消滅しない」）を先に確認する
          // （以前は確認しておらず、CPU の【防壁】【フラグメント】等が発動しなかった）
          const _aiTie = atk.dp === sec.dp;
          // ≪ジャミング≫: セキュリティデジモンとのバトルでは消滅しない（プレイヤーのアタックと同じ）
          if (hasJamming(atk)) {
            const _secToHandJ = _secDigimonToZone(sec, bs.player, false);
            renderAll();
            addLog('🛡 【ジャミング】「' + atk.name + '」がセキュリティバトルで消滅回避');
            showBattleResult('ジャミング！', '#ff00fb', '相手「' + atk.name + '」が消滅を回避', () => {
              showSecurityDigimonLeave(sec, _aiTie, _secToHandJ, 'player', () => { renderAll(); _afterOne(); });
            }, 'ジャミング！', '#ff00fb');
            return;
          }
          _avoidBattleDestroy('ai', atk, (canceledAi) => {
            if (canceledAi) {
              const _secToHand = _secDigimonToZone(sec, bs.player, false);
              renderAll();
              showBattleResult('回避！', '#ff00fb', '相手「' + atk.name + '」が消滅を回避', () => {
                showSecurityDigimonLeave(sec, _aiTie, _secToHand, 'player', () => { renderAll(); _afterOne(); });
              });
              return;
            }
            const _atkNow = bs.ai.battleArea[atkIdx] === atk ? atk : null;
            if (_atkNow) {
              bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
              if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
              _dumpLinkedCardsUnlessDeferred(atk, bs.ai.trash);
            }
            const _secToHand = _secDigimonToZone(sec, bs.player, false);
            showDestroyEffect(atk, () => showSecurityDigimonLeave(sec, _aiTie, _secToHand, 'player', () => {
              addLog(_aiTie ? '💥 両方ともバトルに負けた' : '💥 「' + atk.name + '」が撃破された'); renderAll();
              _fireDestroyChain(['ai'], _afterOne, { ai: atk });
            }));
          });
        } else {
          const _secToHand = _secDigimonToZone(sec, bs.player, false);
          renderAll();
          showSecurityDigimonLeave(sec, true, _secToHand, 'player', () => {
            showBattleResult('Lost...', '#ff4444', 'セキュリティ突破された', () => {
              addLog('✓ セキュリティ突破');
              if (bs.player.security.length <= 0) addLog('🛡 自分のセキュリティが0枚になった');
              renderAll();
              _fireSecurityBattleWin(atk, 'ai', sec, _afterOne);
            }, 'Win!!', '#00ff88');
          });
        }
      } else if (sec.type === 'テイマー') {
        sec.summonedThisTurn = true;
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
        // ≪オプションのセキュリティ効果無効化≫: CPU のアタッカーが持つなら、チェックしたオプションの【セキュリティ】は発揮しない
        // （プレイヤーのアタックと同じ）
        if ((hasSecField || hasSecInEffect) && sec.type === 'オプション' && _atkSuppressesOptSecurityEffect(atk)) {
          addLog('🚫 ≪オプションSE無効化≫:「' + sec.name + '」のセキュリティ効果は発揮しない');
          bs.player.trash.push(sec);
          renderAll();
          hideCombatBackdrop();
          _showEffectAnnounce(atk, 'チェックしたオプションカード「' + sec.name + '」の【セキュリティ】効果は発揮しない', 'ai', () => _afterOne());
          return;
        }
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
// AI対戦: アタックを終えたあとは、メモリーが相手側に渡っても（相手側10まで）払えるものは使う（＝できる行動は全て取る）。
// 払ってメモリーが相手側に移ればターン終了
let _aiOverflowOK = false;
if (typeof window !== 'undefined') window._aiSetOverflow = (v) => { _aiOverflowOK = !!v; };
// 中（ベテランテイマー）: 相手に渡すのは3まで（普通のプレイヤーと同じく、出したいカードを出してターンを終える。
// 先攻1ターン目はメモリー0から始まるので、相手に渡さないと何もできない）。低は10まで（できることは全てやる）
function aiAvailableMemory(card, base) {
  // 高（デジモンマスター）は基本2まで（相手に渡すメモリーが少ないほど良い）。得な効果のカードはその分多く渡す
  const over = (_aiOverflowOK && bs.memory <= 0) ? (_aiIsMid() ? _aiOverflowAllowance(card, base) : 10) : 0;
  return Math.abs(bs.memory) + over;
}
// 中・高: アタックの後、このカードのために相手に渡してよいメモリー（デッキの設計図・作戦・相手の読みで変える）
//  基本: 中3・高2 ＋ 効果の得（_aiMidMemoryBonus）
//  設計図: 勝ち筋のカード（一番上のレベル）は＋2。「自分のターン開始時にメモリーが3に戻る」テイマーが場にいれば＋1
//  高の作戦: 守りを固めるときは守りのカード＋2・それ以外−1。相手を速攻型と読んだら守り以外−1
function _aiOverflowAllowance(card, base) {
  // 先を見た行動: アタックさせずに残したデジモンを【急襲】になるカードに進化させる → ターン終了時にアタックできるので、
  // メモリーが相手側に渡っても進化する（相手に渡すのは最大10まで）
  if (base && card && bs._aiRaidPlanTurn === bs.turn && bs._aiRaidPlanCard === base && !base.suspended && _aiWillHaveRaid(base, card)) return 10;
  let n = (_aiIsHigh() ? 2 : 3) + _aiMidMemoryBonus(card);
  const p = _aiProfile();
  if (p && card) {
    if (_aiIsFinisher(card)) n += 2;
    if (p.memResetNames.length && (bs.ai.tamerArea || []).some(t => t && p.memResetNames.includes(t.name))) n += 1;
  }
  if (_aiIsHigh() && card) {
    const def = _aiIsDefensive(card);
    if (_aiPlan() === 'defend') n += def ? 2 : -1;
    const opp = _aiOppRead();
    if (opp && opp.style === 'aggro' && !def) n -= 1;
    // セキュリティを効果で破棄するカード: 相手のセキュリティから弱らせるオプションが出てきそうなら＋1
    if (_aiTagsOf(card).secTrash && _aiOppSecOptionThreat()) n += 1;
  }
  // ターン終了（何もせずに終える）でも相手のメモリーは3になるので、3までなら渡しても損はない（意味のある行動なら使う）
  return Math.max(3, Math.min(10, n));
}
// 中: このカードを使うために、相手に3より多くメモリーを渡してもよいか（損得）。カードの効果から得の大きさを見積もる。
//   相手のデジモンを消滅・手札/デッキに戻す・DP-・レスト（相手にデジモンがいるとき）＋2、相手のセキュリティを減らす＋2、
//   ドロー＋1、メモリー+N（相手に渡す分が戻る）＋N。合計を3に足した数まで渡す（最大10）
function _aiMidMemoryBonus(card) {
  if (!card) return 0;
  const t = String(card.effect || '');
  let bonus = 0;
  const oppHas = (bs.player.battleArea || []).some(c => c && (c.type === 'デジモン' || c.type === 'デュアル'));
  if (oppHas && /相手の[^。]*?(消滅|手札に戻す|デッキの(下|上)に戻す|DP\s*-|DP－|レストさせ)/.test(t)) bonus += 2;
  if (/相手のセキュリティ[^。]*?(破棄|トラッシュ|手札に)/.test(t)) bonus += 2;
  if (/(\d+)枚ドロー|カードを\d+枚引く|ドローする/.test(t)) bonus += 1;
  const m = /メモリー\s*[+＋]\s*(\d+)/.exec(t);
  if (m) bonus += parseInt(m[1], 10) || 0;
  return bonus;
}

export function aiMainPhase(callback) {
  if (!aiCanAct()) { callback(); return; }
  // AI_SCRIPTS は昔のデモ用（1ターン目にベムモンを出す）。AI対戦では使わない
  const script = window._aiBattleActive ? null : AI_SCRIPTS[bs.turn];
  if (script && script.play && script.play.length > 0) {
    aiPlayScript([...script.play], callback);
  } else {
    aiPlayAuto(callback);
  }
}

// CPU が払う登場/使用コスト: プレイヤーと同じく効果による増減（summon_cost・アセンブリ等）を反映した値
function _aiPlayCost(c) {
  try { return _getEffectivePlayCost(c, bs, 'ai'); } catch (_) { return (c && c.playCost) || 0; }
}

function aiPlayCard(c, handIdx, onDone) {
  // アセンブリ／デジクロス（プレイヤーの offerAssemblyThenPlay と同じく、登場の前に素材を下に置いて登場コストを下げる）
  if (c && c.type === 'デジモン') {
    delete c._digicrossed;
    const _mp = _aiMaterialPlan(c);
    if (_mp) _aiApplyMaterials(c, _mp);
  }
  // 「このカードを使用/登場するとき、〇〇することで、支払うコスト-N」（summon_cost のコスト付きエントリ。
  // 茨の女王 BT26-098 等）: CPU は払えるなら自動で使う（checkCostedSummonDiscount は side!=='player' なら確認なし）
  if (c && _aiPlayCost(c) > 0) {
    let _called = false;
    _checkCostedSummonDiscount(c, bs, 'ai', _hooks.makeEffectContext(c, 'ai'), (disc) => {
      if (_called) return; _called = true;
      const _hi = bs.ai.hand.indexOf(c);
      _aiPlayCardMain(c, _hi !== -1 ? _hi : handIdx, onDone, disc || 0);
    }, { addLog, baseCost: _aiPlayCost(c) });
    return;
  }
  _aiPlayCardMain(c, handIdx, onDone, 0);
}

function _aiPlayCardMain(c, handIdx, onDone, costedDisc) {
  // コストを払った軽減量を差し引いた支払うコスト
  const _aiBasePay = Math.max(0, _aiPlayCost(c) - (costedDisc || 0));
  // アセンブリ等の一時的な軽減はこの支払いで使い切る（プレイヤーの doPlay と同じ）
  delete c._assemblyDiscount;
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
    if (_aiIsHigh()) { addLog('👑 「' + c.name + '」はオプションとして使う（効果を使ってからアーツ進化）'); _aiWhy('デュアルカード「' + c.name + '」をオプションとして使います ← この効果は ' + _aiExplainSteps(c) + '。使う価値があると判断しました。使ったあとはアーツ進化もします。'); }
    addLog('🤖 AIが「' + c.name + '」を使用！（コスト' + _aiBasePay + '）');
    renderAll();
    showOptionEffect(c, () => {
      const turnEnded = aiSpendMemory(_aiBasePay);
      // プレイヤーと同じく【メイン】〜アーツ進化〜【進化時】を1続きの処理として扱う（公式ルール 8-19-1）
      if (window._effectBusy) window._effectBusy(1);
      const _endBusy = (cb) => { if (window._effectBusyEnd) window._effectBusyEnd(cb); else cb(); };
      const _onDoneDual = onDone;
      onDone = (te) => _endBusy(() => _onDoneDual(te));
      _hooks.checkAndTriggerEffect(c, '【メイン】', () => { _afterOptionUsed('ai', () => {
        // プレイヤーと同じく「オプションを使用したとき」の効果（on_option_used）を発揮してからアーツ進化へ
        const candidates = _findArtsEvolveCandidates(c, 'ai');
        // 高: アーツ進化先は、このターンにアタックできるバトルエリアのデジモン → レベルの高いもの を優先
        if (_aiIsHigh() && candidates.length > 1) {
          const _rk = (t) => (t.area === 'battle' && !t.base.suspended && !t.base.summonedThisTurn ? 100 : 0) + _lvOf(t.base);
          candidates.sort((a, b) => _rk(b) - _rk(a));
        }
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
        if (!_isCardInAnyZone(c, bs.ai)) bs.ai.trash.push(c);
        renderAll(true);
        onDone(turnEnded);
      }); }, 'ai');
    });
    return;
  }

  if (c.type === 'テイマー') {
    bs.ai.hand.splice(handIdx, 1);
    if (window._freshOnFieldEnter) window._freshOnFieldEnter(c);
    c.summonedThisTurn = true;
    bs.ai.tamerArea.push(c);
    addLog('🤖 AIが「' + c.name + '」を登場！（コスト' + _aiBasePay + '）');
    renderAll();
    showPlayEffect(c, () => {
      const turnEnded = aiSpendMemory(_aiBasePay);
      _hooks.applyPermanentEffects('ai');
      renderAll();
      // プレイヤーのテイマー登場（doPlay）と同じく【登場時】は常にスキャンする
      // （このテイマー自身の【登場時】・他のカードの「テイマーが登場したとき」を拾う）
      _hooks.checkAndTriggerEffect(c, '【登場時】', () => { renderAll(true); onDone(turnEnded); }, 'ai');
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
    // プレイヤーの登場（doPlay）と同じく【登場時】は常にスキャンする（他のカードの「デジモンが登場したとき」も拾う）
    _hooks.checkAndTriggerEffect(c, '【登場時】', () => {
      renderAll(true);
      onDone(turnEnded);
    }, 'ai');
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

// CPU の進化: 進化しても同じ1体なので、効果で与えられた状態（DP±・Sアタック±・付与された効果等）は引き継ぐ
// （プレイヤーの進化 _finishDoEvolve と同じ。以前は CPU だけ消していて、Sアタック-3 を与えても進化で消えていた）
function _aiCarryEvolveState(evo, base) {
  evo.baseDp = parseInt(evo.dp) || 0;
  evo.buffs = Array.isArray(base.buffs) ? base.buffs : [];
  evo._grantedRecipes = base._grantedRecipes;
  evo.dpModifier = base.dpModifier || 0;
  evo.dp = evo.baseDp + evo.dpModifier;
}

// CPU: base に進化できる手札のカードと、その進化コスト（進化条件の色・特徴・名称どおり。払えるものだけ）
// 【移動時】（育成エリアからバトルエリアへ移動したとき）の効果を持つカードか（レシピのキーに on_move があるか）
function _aiHasOnMove(c) {
  if (!c || !c.recipe) return false;
  try {
    const r = typeof c.recipe === 'string' ? JSON.parse(c.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')) : c.recipe;
    return !!(r && typeof r === 'object' && Object.keys(r).some(k => k.split(',').map(s => s.trim()).includes('on_move')));
  } catch (_) { return false; }
}
if (typeof window !== 'undefined') window._aiHasOnMove = (c) => _aiHasOnMove(c);
// 中・高: 手札の【移動時】のカードは、育成エリアで育ててから移動した方が得（登場コストがかからず【移動時】も発揮する）。
// 育成エリアのデジモン（Lv.2 等）から進化させられる見込みがあれば、手札から登場させずに取っておく
function _aiKeepForNursery(c) {
  if (!_aiIsMid() || !_aiHasOnMove(c)) return false;
  const iku = bs.ai.ikusei;
  const lv = _lvOf(c);
  // 育成エリアにいるデジモンが、このカードの1つ下のレベル（今かこの先に進化させられる）
  if (iku && (iku.type === 'デジモン' || iku.type === 'デジタマ') && _lvOf(iku) === lv - 1) return true;
  // 育成エリアが空でデジタマが残っている Lv.3 は、次のターンに孵化して育てられる（場にデジモンがいて、急いで出す必要が無いとき）
  if (!iku && lv === 3 && (bs.ai.tamaDeck || []).length > 0 && (bs.ai.battleArea || []).some(x => x && x.type === 'デジモン')) return true;
  return false;
}
function _aiFindEvolve(base) {
  if (!base || base.cantEvolve || (Array.isArray(base.buffs) && base.buffs.some(b => b && b.type === 'cant_evolve'))) return null;
  // 高: 進化できるカードを全部比べて、進化後に一番良くなるもの（DP・Lv・【進化時】等の得な効果、安いコスト）を選ぶ
  // 中・高の育成エリアでの進化: 【移動時】を持つカードを優先する（移動したときに効果を発揮できる）
  const _iku = base === bs.ai.ikusei && _aiIsMid();
  if (_iku) {
    const _onMove = bs.ai.hand.filter(c => c && c.type === 'デジモン' && _aiHasOnMove(c));
    if (_onMove.length > 0) {
      const _hand0 = bs.ai.hand;
      // 【移動時】のカードだけで探し、無ければふつうに探す
      bs.ai.hand = _onMove;
      let _r = null;
      try { _r = _aiFindEvolveFrom(base); } finally { bs.ai.hand = _hand0; }
      if (_r) return _r;
    }
    // 次に【登場時】を持たないカード（育成エリアで進化させても失う効果が無い）
    const _hand1 = bs.ai.hand;
    bs.ai.hand = _hand1.filter(c => c && !_aiHasOnPlay(c));
    let _r2 = null;
    try { _r2 = _aiFindEvolveFrom(base); } finally { bs.ai.hand = _hand1; }
    if (_r2) return _r2;
    // 【登場時】のカードしか無い: 育成エリアで進化させた方が得なら進化させる（進化コストが安い・進化ドローがある・
    // 育成エリアは相手に狙われない）。ただし、そのカードが手札に1枚だけで、バトルエリアにデジモンがいなくて、
    // 今のメモリーで手札から登場させられる（＝【登場時】を使いながら場に出せる）なら、進化させずに登場させる方に取っておく
    const _r3 = _aiFindEvolveFrom(base);
    if (_r3 && _aiHasOnPlay(_r3.card)) {
      const _same = _hand1.filter(c => c && c.name === _r3.card.name).length;
      const _noField = !(bs.ai.battleArea || []).some(_aiIsDigi);
      const _canPlay = _r3.card.playCost !== null && _aiPlayCost(_r3.card) <= Math.abs(bs.memory);
      if (_same <= 1 && _noField && _canPlay) return null;
    }
    return _r3;
  }
  return _aiFindEvolveFrom(base);
}
// 【登場時】を持つか（レシピの on_play。無ければ効果テキスト）
function _aiHasOnPlay(c) {
  if (!c) return false;
  try {
    const r = typeof c.recipe === 'string' ? JSON.parse(c.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')) : c.recipe;
    if (r && typeof r === 'object') return Object.keys(r).some(k => k.split(',').map(s => s.trim()).includes('on_play'));
  } catch (_) {}
  return /【登場時】/.test(String(c.effect || ''));
}
function _aiFindEvolveFrom(base) {
  let _best = null;
  const _high = _aiIsHigh();
  const _plan = _high ? _aiPlan() : 'develop';
  let _fin = null; // 中: 勝ち筋のカードに進化できるならそれを選ぶ
  for (const c of bs.ai.hand) {
    if (!c) continue;
    // デュアルカード: 高（デジモンマスター）が「直接進化」を選んだときだけ進化に使う（それ以外はオプションとして使う ③）
    if (c.type === 'デュアル') { if (_aiDualMode(c) !== 'evolve') continue; }
    else if (c.type !== 'デジモン') continue;
    // 進化できるか・コストはプレイヤーの進化（doEvolve の _normalEvolve）と同じ判定（代替進化・常在の進化コスト増減も含む）
    let ok = false, alt = null;
    try { ok = _resolveEvolveMatch(c, base) !== null; } catch (_) { ok = false; }
    try { alt = _getAltEvolve(c, base, bs, 'ai'); } catch (_) { alt = null; }
    // バースト進化（テイマー1体を手札に戻して進化。プレイヤーと同じ getBurstEvolve）。中・高は勝ち筋につながるカードだけ
    let burst = null;
    if (base !== bs.ai.ikusei && bs.ai.battleArea.includes(base)) {
      try {
        const be = _getBurstEvolve(c, base, bs, 'ai');
        if (be && _filterBurstEvolveTamerCandidates(bs, 'ai', be.tamerConditions, be.tamerConditionsOp, be.tamerConditionsChain).length > 0
            && (!_aiIsMid() || _aiIsFinisher(c) || _aiOnLine(c))) burst = be;
      } catch (_) { burst = null; }
    }
    if (!ok && !alt && !burst) continue;
    let cost = (ok || alt) ? (alt ? alt.cost : getEvolveCostFor(c, base)) : null;
    if (cost !== null && cost !== undefined) { try { const st = _getStaticEvoCostReduction(c, base, bs, 'ai'); if (st) cost = Math.max(0, cost - st); } catch (_) {} }
    let useBurst = null;
    if (burst && (cost === null || cost === undefined || burst.cost < cost)) { cost = burst.cost; useBurst = burst; }
    if (cost === null || cost === undefined) continue;
    if (cost > aiAvailableMemory(c, base)) continue;
    if (!_high) {
      if (!_best) _best = { card: c, cost, alt: !!alt, burst: useBurst };
      if (!_fin && _aiIsFinisher(c)) _fin = { card: c, cost, alt: !!alt, burst: useBurst };
      continue;
    }
    // 高: 強さ＋効果の得に、設計図（勝ち筋のカード・勝ち筋につながるカード）と作戦（守るなら守りのカード）を加える
    const score = _dpOf(c) + _lvOf(c) * 1500 + _aiMidMemoryBonus(c) * 1500 - cost * 300
      + (_aiIsFinisher(c) ? 4000 : 0) + (_aiOnLine(c) ? 1000 : 0)
      + (_plan === 'defend' && _aiIsDefensive(c) ? 3000 : 0)
      + (_aiTagsOf(c).secTrash && _aiOppSecOptionThreat() ? 2000 : 0);
    if (!_best || score > _best.score) _best = { card: c, cost, alt: !!alt, burst: useBurst, score };
  }
  return _fin || _best;
}

// 育成フェイズの判断用（battle-phase.js）: この CPU のデジモンを、今のメモリーで手札から進化させられるか
if (typeof window !== 'undefined') window._aiCanEvolveNow = (base) => { try { return !!_aiFindEvolve(base); } catch (_) { return false; } };

// CPU のバトルエリアでの進化。プレイヤーの進化（doEvolve の _normalEvolve）と同じ順で、side だけ 'ai' にして処理する
function _aiEvolveInBattleArea(card, slotIdx, done) {
  const base = bs.ai.battleArea[slotIdx];
  if (!base || !card) { done(); return; }
  if (card && card.type === 'デュアル' && _aiIsHigh()) addLog('👑 「' + card.name + '」はオプションとして使わず、直接進化する（コストを抑える）');
  let cost = getEvolveCostFor(card, base);
  let _alt = null;
  try { _alt = _getAltEvolve(card, base, bs, 'ai'); } catch (_) {}
  if (_alt) { cost = _alt.cost; addLog('⬆ 代替進化（進化条件を無視）コスト' + cost); }
  const _evoDisc = _consumePendingEvoCostReduction(card, base);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  let _staticEvo = 0;
  try { _staticEvo = _getStaticEvoCostReduction(card, base, bs, 'ai'); } catch (_) {}
  if (_staticEvo !== 0) { cost = Math.max(0, cost - _staticEvo); addLog('💠 進化コスト' + (_staticEvo > 0 ? '-' + _staticEvo : '+' + (-_staticEvo)) + '（コスト' + cost + 'で進化）'); }
  _fireBeforeEvolveEffects(card, bs, 'ai', { base }, (_preDisc) => {
    if (_preDisc > 0) { cost = Math.max(0, cost - _preDisc); addLog('💠 効果で進化コスト-' + _preDisc + '（コスト' + cost + 'で進化）'); }
    _checkBeforeEvolveDiscount(card, bs, 'ai', (discount) => {
      if (discount > 0) { cost = Math.max(0, cost - discount); addLog('💠 効果で進化コスト-' + discount + '（コスト' + cost + 'で進化）'); }
      _checkAbsorbEvolveDiscount(card, bs, 'ai', (discount2) => {
        const go = () => {
          const slot = bs.ai.battleArea.indexOf(base);
          const hi = bs.ai.hand.indexOf(card);
          if (slot === -1 || hi === -1) { done(); return; } // 「進化するとき」の効果で状況が変わった
          addLog('🤖 AIが「' + base.name + '」→「' + card.name + '」に進化！');
          doEvolveFromEffect(card, hi, slot, cost, 'ai', () => done());
        };
        if (discount2 > 0) {
          cost = Math.max(0, cost - discount2);
          addLog('💠 吸収進化で進化コスト-' + discount2 + '（コスト' + cost + 'で進化）');
          fireOppRestThen('ai', go);
        } else go();
      });
    }, { base });
  });
}

// CPU の育成エリアでの進化（プレイヤーの doEvolveIku と同じ処理。side だけ 'ai'）。done(turnEnded)
// 育成エリアで進化したデジモンの【進化時】を発揮してよいか: その【進化時】の文が育成エリアを指定・参照しているときだけ
// （公式ルール 3-4-7-4。それ以外の【進化時】は育成エリアでは誘発しない）
function _ikuEvolveEffectAllowed(card) {
  const t = String((card && card.effect) || '');
  const m = /【進化時】[\s\S]*?(?=\r?\n\s*【(?!進化時|登場時|移動時|ターンに1回|ターン1回)|$)/.exec(t);
  return !!(m && /育成エリア/.test(m[0]));
}
function _aiEvolveIku(card, done) {
  const base = bs.ai.ikusei;
  if (!base || !card) { done(false); return; }
  if (card && card.type === 'デュアル' && _aiIsHigh()) addLog('👑 「' + card.name + '」はオプションとして使わず、直接進化する（コストを抑える）');
  let cost = getEvolveCostFor(card, base);
  let _altEvo = null;
  try { _altEvo = _getAltEvolve(card, base, bs, 'ai'); } catch (_) {}
  if (_altEvo) { cost = _altEvo.cost; addLog('⬆ 代替進化（進化条件を無視）コスト' + cost); }
  const _evoDisc = _consumePendingEvoCostReduction(card, base);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  if (!canPayMemory('ai', cost)) { done(false); return; }
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    _noMainAbility: card.type === 'デュアル',
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes,
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  _carryRestrictionFlags(evolved);
  bs.ai.ikusei = evolved;
  const hi = bs.ai.hand.indexOf(card);
  if (hi !== -1) bs.ai.hand.splice(hi, 1);
  addLog('🤖 AIが育成「' + base.name + '」→「' + evolved.name + '」進化！（コスト ' + cost + '）');
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, () => {
    const turnEnded = aiSpendMemory(cost);
    doDraw('ai', '進化ドロー', (dismissDraw) => {
      if (typeof dismissDraw === 'function') dismissDraw();
      // 育成エリアでは【進化時】は誘発しない（公式ルール 3-4-7-4。プレイヤーの doEvolveIku と同じ）
      if (hasKeyword(evolved, '【進化時】') && _ikuEvolveEffectAllowed(evolved)) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => { renderAll(true); done(turnEnded); }, 'ai');
      } else {
        done(turnEnded);
      }
    }, { deferDismiss: false });
  });
}

// 中: 使っても意味の無いオプション・デュアル（相手のデジモンに使う効果なのに、相手のデジモンがいない）は使わない
// 判定はレシピの【メイン】の手順で行う: 盤面のデジモン（相手の/自分の）を対象にする手順に対象が1体もいなくて、
// ほかに単独で意味のある手順（ドロー・メモリー+・デッキオープン・登場・【ディレイ】等）も無ければ「使わない」。
// 対象の絞り込み（DP以下・Lv以下・レスト中）も見る。レシピが読めないカードは効果テキストで判断する
const _AI_DEPENDENT_ACTIONS = new Set(['destroy', 'bounce', 'dp_minus', 'rest', 'select_evo_source', 'dedigivolve', 'evo_discard_all', 'return_deck', 'grant_keyword', 'dp_plus']);
// 相手のデジモンが、その手順で付ける状態をすでに持っているか（重ねても意味がない）
function _aiAlreadyHas(c, st) {
  const a = String((st && st.action) || '');
  const bf = Array.isArray(c.buffs) ? c.buffs : [];
  if (a === 'cant_rest') return !!c.cantRest || bf.some(b => b && b.type === 'cant_rest');
  if (a === 'cant_attack') return !!c.cantAttack || bf.some(b => b && (b.type === 'cant_attack' || b.type === 'cant_attack_block'));
  if (a === 'cant_block') return !!c.cantBlock || bf.some(b => b && (b.type === 'cant_block' || b.type === 'cant_attack_block'));
  if (a === 'cant_attack_block') return (!!c.cantAttack && !!c.cantBlock);
  if (a === 'cant_evolve') return !!c.cantEvolve || bf.some(b => b && b.type === 'cant_evolve');
  if (a === 'rest') return !!c.suspended;
  return false;
}
// オプション等の【メイン】の手順を1つずつ説明する（AIの考え用）: 何をする効果で、今使うと効くか
const _AI_ACT_JA = { destroy: '消滅させる', bounce: '手札に戻す', return_hand: '手札に戻す', return_deck: 'デッキに戻す', dp_minus: 'DPを下げる',
  discard: '進化元を破棄する', evo_discard_all: '進化元を全て破棄する', cant_rest: 'レストできなくする', cant_attack: 'アタックできなくする',
  cant_block: 'ブロックできなくする', cant_attack_block: 'アタックもブロックもできなくする', cant_evolve: '進化できなくする', rest: 'レストさせる',
  evolve: '手札のデジモンに進化させる', draw: 'ドローする', deck_open: 'デッキの上を見て手札に加える', summon_appear: '手札から登場させる',
  dp_plus: 'DPを上げる', memory_plus: 'メモリーを増やす', memory: 'メモリーを増やす', grant_keyword: 'キーワード効果を付ける', dedigivolve: '退化させる' };
function _aiExplainSteps(card) {
  let r = card && card.recipe;
  if (typeof r === 'string') { try { r = r ? JSON.parse(r) : null; } catch (_) { r = null; } }
  const steps = (r && Array.isArray(r.main)) ? r.main.filter(st => st && st.action && st.action !== 'delay') : [];
  const nums = '①②③④⑤';
  return steps.slice(0, 5).map((st, i) => {
    const a = String(st.action);
    const ja = _AI_ACT_JA[a] || a;
    const t = String(st.target || '');
    let note = '';
    if (/^opp/.test(t)) {
      const all = (bs.player.battleArea || []).filter(_aiIsDigi);
      const n = _aiMidStepTargetCount(st, card);
      if (n === 0) {
        if (all.length && all.every(c => _aiAlreadyHas(c, st))) note = '（キミのデジモンはもう全部その状態なので意味なし）';
        else if (st.filter && st.filter.target_evo_source) note = '（進化元を持つデジモンがいないので空振り）';
        else note = '（狙える相手がいないので空振り）';
      } else {
        note = '（狙える相手: ' + n + '体）';
        if (st.filter && st.filter.target_evo_source && (bs.player.battleArea || []).some(c => _aiIsDigi(c) && _hasIceArmor(c))) note += '。進化元を減らすと【氷装】の勝負で有利になる';
        else if (st.filter && st.filter.target_evo_source && (bs.ai.battleArea || []).some(c => _aiIsDigi(c) && _hasIceArmor(c))) note += '。こちらの【氷装】の勝負で有利になる';
      }
    } else if (a === 'evolve') {
      note = _aiOptionEvolveAffordable(card) ? '（進化できる組み合わせがあり、コストも払える）' : '（進化できる組み合わせが無い）';
    } else if (/^(draw|deck_open)$/.test(a)) {
      note = '（手札が増える）';
    }
    return nums[i] + ja + note;
  }).join('、');
}
function _aiMidStepTargetCount(st, srcCard) {
  const t = String((st && st.target) || '');
  if (!t || /^(same_target|target_trigger_source|self)/.test(t)) return null;
  let area;
  const oppM = /^opp(?:onent)?(_suspended)?(?::|$)/.exec(t);
  // 相手のデジモンのうち、この効果を受けない（選んでも何も起きない）ものは数えない（公式ルール 15-15-5。高は相手のターンまで
  // 続く効果で、効果を受けない状態がこのターンで切れるなら数える）
  const _useless = (c) => !!(srcCard && typeof window !== 'undefined' && typeof window._cpuTargetUseless === 'function' && window._cpuTargetUseless(c, srcCard, st && st.duration));
  if (oppM) area = (bs.player.battleArea || []).filter(c => c && (c.type === 'デジモン' || c.type === 'デュアル') && (!oppM[1] || c.suspended) && !_useless(c)
    // すでにその状態（レストできない・アタックできない等）のデジモンに付けても意味がない
    && !_aiAlreadyHas(c, st)
    // 「進化元を破棄」は進化元を持つデジモンだけが対象として意味がある
    && !(st && st.filter && st.filter.target_evo_source && !(c.stack || []).length));
  else if (/^own(?::|$)/.test(t)) area = (bs.ai.battleArea || []).filter(c => c && (c.type === 'デジモン' || c.type === 'デュアル'));
  else if (/^own_tamer/.test(t)) area = (bs.ai.tamerArea || []).filter(Boolean);
  else return null; // セキュリティ・手札・トラッシュ等は盤面の対象ではない（使えるものとして扱う）
  const f = (st.filter && typeof st.filter === 'object') ? st.filter : {};
  const lim = { dp_le: f.dp_le, dp_ge: f.dp_ge, lv_le: f.lv_le };
  const cm = /cond_(dp_le|dp_ge|lv_le):(\d+)/.exec(String(st.condition || ''));
  if (cm) lim[cm[1]] = parseInt(cm[2], 10);
  return area.filter(c => !(typeof lim.dp_le === 'number' && _dpOf(c) > lim.dp_le)
    && !(typeof lim.dp_ge === 'number' && _dpOf(c) < lim.dp_ge)
    && !(typeof lim.lv_le === 'number' && _lvOf(c) > lim.lv_le)).length;
}
function _aiMidOptionIsWasted(c) {
  if (!c || (c.type !== 'オプション' && c.type !== 'デュアル')) return false;
  let r = c.recipe;
  if (typeof r === 'string') { try { r = r ? JSON.parse(r) : null; } catch (_) { r = null; } }
  const steps = (r && Array.isArray(r.main)) ? r.main.filter(Boolean) : null;
  if (!steps || steps.length === 0) {
    const oppHas = (bs.player.battleArea || []).some(x => x);
    if (oppHas) return false;
    const t = String(c.effect || '');
    return /相手のデジモン/.test(t) && !/自分の|ドロー|メモリー|セキュリティ|手札|デッキ/.test(t);
  }
  // 自分のセキュリティデジモンを強くする効果（ST1-14 スターライトエクスプロージョン等）は、次のプレイヤーのターンに
  // アタックされうるときだけ意味がある: プレイヤーのバトルエリアにデジモンがいるか、育成エリアに Lv.3 以上がいる
  // （育成エリアから出したデジモンはそのターンにアタックできる）
  const _plCanAttackNext = () => (bs.player.battleArea || []).some(x => x && (x.type === 'デジモン' || x.type === 'デュアル'))
    || (bs.player.ikusei && (parseInt(bs.player.ikusei.level, 10) || 0) >= 3);
  let targeted = 0;
  for (const st of steps) {
    if (/^own_security/.test(String(st.target || '')) && /^(dp_plus|grant_keyword)$/.test(String(st.action || ''))) {
      targeted++;
      if (_plCanAttackNext()) return false;
      continue;
    }
    const n = _aiMidStepTargetCount(st, c);
    if (n === null) {
      // 対象を持たない手順: 前の手順で選んだ対象に効くもの以外（ドロー・メモリー+等）は単独で意味がある
      if (!(st.card || _AI_DEPENDENT_ACTIONS.has(st.action))) return false;
      continue;
    }
    targeted++;
    if (n > 0) return false;
  }
  return targeted > 0;
}

// デュアルカードの使い方: 'option'（オプションとして使う→アーツ進化）／'evolve'（手札から直接進化）／null（今は使わない）
// 低・中（ベテランテイマー）は常にオプションから。高（デジモンマスター）は勝ち筋で選ぶ:
//  ・オプションとして使えない（メモリー不足・色・効果の対象がいない・強い相手まで取っておく）→ 直接進化
//  ・進化できる相手がいない／進化コストが払えない → オプション
//  ・両方できる → オプションの効果に価値があればオプション（使用コストは高いが、効果＋アーツ進化）。
//    価値: 相手のデジモン/テイマー/セキュリティに効く手順に対象がいる、ドロー・メモリー+、
//    守りを固める作戦で守りの効果、アタック前に自分のデジモンを強くする（このターンにアタックできるデジモンがいて、相手にデジモンがいる）。
//    価値が無ければ、コストの安い直接進化
function _aiDualMode(c) {
  if (!c || c.type !== 'デュアル') return null;
  if (!_aiIsHigh()) return 'option';
  const avail = aiAvailableMemory(c);
  const canOpt = c.playCost !== null && _aiPlayCost(c) <= avail
    && (hasMatchingColorInPlay(c, 'ai') || meetsUseCondition(c, 'ai') || _ignoresColorCondition(c, 'ai'))
    && !_aiMidOptionIsWasted(c) && !_aiHighHoldOption(c);
  const bases = [...(bs.ai.battleArea || []), bs.ai.ikusei].filter(b => b && _aiIsDigi(b) && canEvolveOnto(c, b));
  const evoCosts = bases.map(b => getEvolveCostFor(c, b)).filter(v => v !== null && v !== undefined);
  const canEvo = evoCosts.length > 0 && Math.min(...evoCosts) <= avail;
  // 進化できないとき: オプション効果に価値があるときだけ使う。無ければ手札に残して、あとの進化に取っておく
  if (!canEvo) return canOpt && _aiDualOptionValuable(c) ? 'option' : null;
  if (!canOpt) return 'evolve';
  return _aiDualOptionValuable(c) ? 'option' : 'evolve';
}
function _aiDualOptionValuable(c) {
  let r = c.recipe;
  if (typeof r === 'string') { try { r = r ? JSON.parse(r) : null; } catch (_) { r = null; } }
  const steps = (r && Array.isArray(r.main)) ? r.main.filter(Boolean) : [];
  if (steps.length === 0) return true; // レシピが読めないときは従来どおりオプション
  const oppDigi = (bs.player.battleArea || []).some(_aiIsDigi);
  const canSwing = !_aiOverflowOK && (bs.ai.battleArea || []).some(x => _aiIsDigi(x) && !x.suspended && (!x.summonedThisTurn || _aiTagsOf(x).rush));
  const defend = _aiPlan() === 'defend';
  for (const st of steps) {
    const a = String(st.action || ''), t = String(st.target || '');
    if (/^(draw|memory|memory_plus)$/.test(a)) return true;
    if (/^opp/.test(t)) {
      const n = _aiMidStepTargetCount(st, c);
      if (n === null ? true : n > 0) return true;
    }
    if (a === 'dp_plus' && /^own/.test(t) && canSwing && oppDigi) return true;
    if (defend && /^(grant_keyword|dp_plus)$/.test(a) && /^own/.test(t)) return true;
  }
  return false;
}

// ===== CPU の特別な登場・進化（アセンブリ・デジクロス・バースト進化・アプ合体・リンク・トレーニング）=====
// 判定・処理はプレイヤーと同じエンジンの関数（getAssemblyOptions / filterAssemblyCandidates / getBurstEvolve /
// filterBurstEvolveTamerCandidates / getAppGattaiEvolve / fireLinkTriggers / doTrainingEffect 等）を side 'ai' で使い、
// プレイヤーが画面で選ぶところだけを CPU が選ぶ

// アセンブリ／デジクロスで下に置く素材の計画（盤面は変えない）。{ kind, picks:[{card, remove, group}], discount, opt } か null
function _aiMaterialPlan(card) {
  if (!card || card.type !== 'デジモン' || card.playCost === null) return null;
  let options = [];
  try { options = _getAssemblyOptions(card) || []; } catch (_) { options = []; }
  const P = bs.ai;
  let basePay = 0;
  try { basePay = _getEffectivePlayCost(card, bs, 'ai'); } catch (_) { basePay = card.playCost || 0; }
  const avail = aiAvailableMemory(card);
  for (const opt of options) {
    if (!opt || (opt.in_zone && opt.in_zone !== 'hand')) continue;
    const costItems = (Array.isArray(opt.cost) ? opt.cost : []).filter(Boolean);
    if (costItems.length === 0) continue;
    const per = parseInt(opt.value, 10) || 0;
    if (opt.per_cost_card || costItems.some(ci => ci && ci._designatedAny)) {
      // 《デジクロス》: 払えないときだけ、足りない分を素材で補う（素材を使いすぎない）。
      // 素材の優先: トラッシュ → バトルエリアの価値の低いデジモン（勝ち筋でない Lv.4 以下・ブロッカーでない）→ 手札（勝ち筋でない）
      const need = basePay - avail;
      if (need <= 0 || per <= 0) continue;
      const want = Math.ceil(need / per);
      const used = new Set();
      const picks = [];
      const srcList = (ci) => {
        const zones = Array.isArray(ci.from) ? ci.from : (ci.from ? [ci.from] : ['hand', 'battle_area']);
        const out = [];
        if (zones.includes('trash')) P.trash.forEach(c => out.push({ card: c, rank: 0, remove: () => { const i = P.trash.indexOf(c); if (i !== -1) P.trash.splice(i, 1); } }));
        if (zones.includes('battle_area')) P.battleArea.forEach(c => {
          if (!c || _aiIsFinisher(c) || _lvOf(c) > 4 || isBlocker(c)) return;
          out.push({ card: c, rank: 1, remove: () => {
            const i = P.battleArea.indexOf(c); if (i === -1) return;
            P.battleArea[i] = null;
            (c.stack || []).forEach(s2 => P.trash.push(s2)); c.stack = [];
            (c.linkedCards || []).forEach(s2 => P.trash.push(s2)); c.linkedCards = [];
          } });
        });
        if (zones.includes('hand')) P.hand.forEach(c => { if (c && c !== card && !_aiIsFinisher(c)) out.push({ card: c, rank: 2, remove: () => { const i = P.hand.indexOf(c); if (i !== -1) P.hand.splice(i, 1); } }); });
        return out.sort((a, b) => a.rank - b.rank);
      };
      costItems.forEach((ci, g) => {
        const max = Math.max(1, parseInt(ci.count, 10) || 1);
        const list = srcList(ci);
        const okCards = new Set(_filterAssemblyCandidates(ci, list.map(x => x.card), bs, 'ai'));
        let n = 0;
        for (const x of list) {
          if (picks.length >= want || n >= max) break;
          if (used.has(x.card) || !okCards.has(x.card)) continue;
          used.add(x.card); picks.push(Object.assign({ group: g }, x)); n++;
        }
      });
      if (picks.length === 0 || per * picks.length < need) continue;
      return { kind: 'digixros', picks, discount: per * picks.length, opt };
    }
    // アセンブリ: トラッシュのカードだけを使う（トラッシュは失っても痛くないので、使えるなら使う）
    if (costItems.some(ci => { const z = Array.isArray(ci.from) ? ci.from : (ci.from ? [ci.from] : []); return !z.includes('trash'); })) continue;
    const picks = [];
    let ok = true;
    costItems.forEach((ci, g) => {
      if (!ok) return;
      const want = parseInt(ci.count, 10) || 1;
      const distinctBy = Array.isArray(ci.distinct_by) ? ci.distinct_by : [];
      const cands = _filterAssemblyCandidates(ci, P.trash.filter(c => !picks.some(p => p.card === c)), bs, 'ai');
      const inGroup = [];
      for (const c of cands) {
        if (inGroup.length >= want) break;
        if (distinctBy.length && inGroup.some(p => distinctBy.some(attr => { const f = ASSEMBLY_DISTINCT_FIELD[attr]; return f && p[f] === c[f]; }))) continue;
        inGroup.push(c);
      }
      if (inGroup.length < want) { ok = false; return; }
      inGroup.forEach(c => picks.push({ card: c, group: g, remove: () => { const i = P.trash.indexOf(c); if (i !== -1) P.trash.splice(i, 1); } }));
    });
    if (!ok || picks.length === 0) continue;
    return { kind: 'assembly', picks, discount: per, opt };
  }
  return null;
}
// 素材を実際に下に置き、登場コストの軽減（card._assemblyDiscount）を付ける（プレイヤーの offerAssemblyThenPlay / _offerDigixros と同じ結果）
function _aiApplyMaterials(card, plan) {
  if (!card || !plan) return;
  const ordered = plan.picks.slice().sort((a, b) => a.group - b.group);
  ordered.forEach(p => p.remove());
  ordered.forEach(p => { delete p.card._faceDown; p.card.suspended = false; p.card.buffs = []; });
  if (!card.stack) card.stack = [];
  card.stack = [...ordered.map(p => p.card), ...card.stack];
  card._assemblyDiscount = (parseInt(card._assemblyDiscount, 10) || 0) + plan.discount;
  if (plan.kind === 'digixros') {
    card._digicrossed = ordered.length;
    card._digixrossMats = ordered.map(p => ({ name: p.card.name, imgSrc: cardImg(p.card) || '' }));
    addLog('✖ AIが「' + card.name + '」のデジクロス（' + ordered.map(p => '「' + p.card.name + '」').join('') + 'を下に置く・登場コスト-' + plan.discount + '）');
  } else {
    addLog('💠 AIが「' + card.name + '」のアセンブリを発動（トラッシュから' + ordered.length + '枚使用・登場コスト-' + plan.discount + '）');
  }
  renderAll();
}
// 素材による登場コストの軽減量（登場できるかの判定用）
function _aiMaterialDiscount(card) {
  try { const p = _aiMaterialPlan(card); return p ? p.discount : 0; } catch (_) { return 0; }
}

// バースト進化: テイマー1体を手札に戻してから進化する（プレイヤーの _doBurstEvolveWith と同じ）。進化したデジモンは
// このターン終了時に重ねられているカードを1枚破棄する（_burstEvolvedPendingDiscard → endAiTurn の processBurstEvolvePendingDiscard）
function _aiDoBurstEvolve(card, slotIdx, burst, done) {
  const base = bs.ai.battleArea[slotIdx];
  const cands = _filterBurstEvolveTamerCandidates(bs, 'ai', burst.tamerConditions, burst.tamerConditionsOp, burst.tamerConditionsChain);
  if (!base || cands.length === 0) { done(); return; }
  // 手札に戻すテイマー: 「メモリーが3に戻る」テイマー以外を優先（また出し直せる安いもの）
  const p = _aiProfile();
  const chosen = cands.slice().sort((a, b) => ((p && p.memResetNames.includes(a.name)) ? 1 : 0) - ((p && p.memResetNames.includes(b.name)) ? 1 : 0)
    || ((a.playCost || 0) - (b.playCost || 0)))[0];
  const ti = bs.ai.tamerArea.indexOf(chosen);
  if (ti === -1) { done(); return; }
  bs.ai.tamerArea.splice(ti, 1);
  if (Array.isArray(chosen.stack) && chosen.stack.length > 0) { chosen.stack.forEach(c => { if (c) { delete c._faceDown; bs.ai.trash.push(c); } }); chosen.stack = []; }
  chosen.buffs = []; chosen.dpModifier = 0; chosen.suspended = false;
  bs.ai.hand.push(chosen);
  addLog('🔥 AIのバースト進化: 「' + chosen.name + '」を手札に戻した');
  renderAll();
  const go = () => {
    const hi = bs.ai.hand.indexOf(card);
    const slot = bs.ai.battleArea.indexOf(base);
    if (hi === -1 || slot === -1) { done(); return; }
    addLog('🔥 AIが「' + base.name + '」→「' + card.name + '」にバースト進化！');
    doEvolveFromEffect(card, hi, slot, burst.cost, 'ai', () => {
      const ev = bs.ai.battleArea[slot];
      if (ev) ev._burstEvolvedPendingDiscard = true;
      done();
    });
  };
  if (typeof window._fxMoveSync === 'function') { try { window._fxMoveSync(chosen, '相手のテイマーエリア', '相手の手札', go, { faceUp: true }); return; } catch (_) {} }
  go();
}

// アプ合体（プレイヤーの _finishAppGattaiEvolve と同じ。本体の上にリンクカード、その上にアプ合体先を重ねる。公式 8-4）
function _aiFindAppGattai(base) {
  if (!base || !_aiIsDigi(base)) return null;
  for (const c of (bs.ai.hand || [])) {
    let ag = null;
    try { ag = _getAppGattaiEvolve(c, base, bs, 'ai'); } catch (_) { ag = null; }
    if (ag && (ag.linkedPartners || []).length > 0 && ag.cost <= aiAvailableMemory(c, base)) return { card: c, ag };
  }
  return null;
}
function _aiDoAppGattai(card, slotIdx, ag, done) {
  const base = bs.ai.battleArea[slotIdx];
  const hi = bs.ai.hand.indexOf(card);
  if (!base || hi === -1) { done(false); return; }
  const cost = ag.cost;
  const partners = ag.linkedPartners || [];
  const evolved = Object.assign({}, card, {
    type: card.type === 'デュアル' ? 'デジモン' : card.type,
    _noMainAbility: card.type === 'デュアル',
    suspended: base.suspended, summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [], _grantedRecipes: base._grantedRecipes,
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(partners).concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  _carryRestrictionFlags(evolved);
  base.linkedCards = (base.linkedCards || []).filter(lc => !partners.includes(lc));
  bs.ai.battleArea[slotIdx] = evolved;
  bs.ai.hand.splice(hi, 1);
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog('🔗 AIが「' + base.name + '」＋' + partners.map(p => '「' + (p.name || '?') + '」').join('＋') + ' →「' + evolved.name + '」アプ合体！（コスト ' + cost + '）');
  renderAll();
  showAppGattaiEffect(cost, base, partners, evolved, () => {
    const turnEnded = aiSpendMemory(cost);
    doDraw('ai', 'アプ合体ドロー', (dismissDraw) => {
      if (typeof dismissDraw === 'function') dismissDraw();
      if (hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => { _hooks.applyPermanentEffects('ai'); renderAll(true); done(turnEnded); }, 'ai');
      } else { _hooks.applyPermanentEffects('ai'); renderAll(true); done(turnEnded); }
    }, { deferDismiss: false });
  });
}

// リンク（プレイヤーの doLink と同じ。リンクコストを払い、デジモンの横にリンク → 【リンク時】）。
// 使う: リンク条件を満たし空きのあるデジモンがいて、リンクコストを払えるとき。デジモンとして出す方が良い場合
// （場のデジモンが1体以下で、登場コストの方が安い）はリンクしない。リンク先は勝ち筋 → アタックできる → DPの高い順
function _aiTryLink(callback) {
  if (!window._aiBattleActive) return false;
  const area = bs.ai.battleArea || [];
  const digiCount = area.filter(_aiIsDigi).length;
  for (const c of (bs.ai.hand || []).slice()) {
    if (!c || c.linkCost === null || c.linkCost === undefined || !c.isLink) continue;
    if (c._aiLinkTriedTurn === bs.turn) continue;
    if (c.linkCost > aiAvailableMemory(c)) continue;
    if (c.playCost !== null && digiCount <= 1 && c.playCost <= c.linkCost) continue;
    const bases = area.filter(b => _aiIsDigi(b) && meetsLinkCondition(c, b)
      && ((b.linkedCards || []).length < ((b._linkCapacityBonus || 0) + (b._linkPlusPassive || 0) + 1)));
    if (bases.length === 0) continue;
    const rank = (b) => (_aiIsFinisher(b) ? 3 : 0) + (!b.suspended && !b.summonedThisTurn ? 2 : 0) + _dpOf(b) / 100000;
    const base = bases.sort((a, b) => rank(b) - rank(a))[0];
    c._aiLinkTriedTurn = bs.turn;
    const hi = bs.ai.hand.indexOf(c);
    if (hi === -1) continue;
    const cost = c.linkCost;
    bs.ai.hand.splice(hi, 1);
    if (!base.linkedCards) base.linkedCards = [];
    base.linkedCards.push(c);
    c._lastLinkCost = cost;
    addLog('🔗 AIが「' + base.name + '」に「' + c.name + '」をリンク！（コスト ' + cost + '）');
    _aiWhy('「' + c.name + '」を「' + base.name + '」にリンクします ← ' + (_aiIsFinisher(base) ? '切り札のデジモンをさらに強くしたいからです。' : 'アタックできるデジモンを強くしたいからです。') + 'デジモンとして出すより、リンクした方が得だと判断しました。');
    renderAll();
    fxLinkEffect(base, c, () => {
      const turnEnded = aiSpendMemory(cost);
      _hooks.applyPermanentEffects('ai');
      renderAll(true);
      _fireLinkTriggers(c, 'ai', base, 'ai', _hooks.makeEffectContext(c, 'ai'), () => {
        renderAll(true);
        if (turnEnded || bs.memory > 0) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 500);
      });
    });
    return true;
  }
  return false;
}

// ≪トレーニング≫（メインフェイズ中、このデジモンをレストさせて、デッキの上から1枚を進化元の下に裏向きで置く。育成エリアでも可）。
// プレイヤーと同じ doTrainingEffect を使う。使う: 育成エリアのデジモン（アタックしない）／バトルエリアでこのターンもう
// アタックしないデジモン（登場したターン・アタックの後）。守りに残すブロッカー（自分のセキュリティ3枚以下）と、
// 【急襲】でアタックする予定のデジモンには使わない
function _aiTryTraining(callback) {
  if (!window._aiBattleActive) return false;
  const P = bs.ai;
  if (!P.deck || P.deck.length <= 3) return false;
  const cands = [];
  if (P.ikusei && _aiIsDigi(P.ikusei)) cands.push(P.ikusei);
  (P.battleArea || []).forEach(c => {
    if (!_aiIsDigi(c)) return;
    const willNotAttack = _aiOverflowOK || c.summonedThisTurn;
    if (!willNotAttack) return;
    if (isBlocker(c) && (P.security || []).length <= 3) return;
    if (bs._aiRaidPlanTurn === bs.turn && bs._aiRaidPlanCard === c) return;
    if (_aiHasRaid(c)) return;
    cands.push(c);
  });
  for (const c of cands) {
    if (c.suspended || c.cantRest || c._aiTrainTurn === bs.turn) continue;
    let has = false;
    try { has = _hasTrainingKeyword(c); } catch (_) { has = false; }
    if (!has) continue;
    c._aiTrainTurn = bs.turn;
    const prevPhase = bs.phase;
    bs.phase = 'main';
    let ok = false;
    try { ok = doTrainingEffect(c, 'ai'); } catch (e) { console.error('[aiTraining]', e); } finally { bs.phase = prevPhase; }
    if (!ok) continue;
    _aiWhy('「' + c.name + '」で【トレーニング】します ← このターンはもうアタックしないので、レストさせて進化元を増やしておきます。');
    setTimeout(() => aiPlayAuto(callback), 600);
    return true;
  }
  return false;
}


// オプションの【メイン】が「自分のデジモン1体を手札の〜に（進化コスト-N で）進化できる」（ブルー/レッド・スクランブル LM-027/028、
// オフェンス・トレーニング等）のとき、オプションの使用コストを払ったあとに、その進化のコストも払えるか。
// 払えないなら、オプションを使っても進化できずに終わる（以前は使ってから進化できずに終わっていた）
function _aiOptionEvolveAffordable(opt) {
  let r = opt && opt.recipe;
  if (typeof r === 'string') { try { r = r ? JSON.parse(r) : null; } catch (_) { r = null; } }
  const steps = (r && Array.isArray(r.main)) ? r.main.filter(Boolean) : [];
  const ev = steps.find(st => st.action === 'evolve' && /^own(:|$)/.test(String(st.target || '')) && (!st.from || st.from === 'hand' || (Array.isArray(st.from) && st.from.includes('hand'))));
  if (!ev) return true;
  const disc = -(parseInt(ev.value, 10) || 0); // value:-3 → 3 下がる
  const left = aiAvailableMemory(opt) - _aiPlayCost(opt);
  const ff = ev.from_filter || ev.filter || {};
  for (const base of (bs.ai.battleArea || [])) {
    if (!_aiIsDigi(base) || base.cantEvolve) continue;
    for (const h of (bs.ai.hand || [])) {
      if (!h || h === opt || (h.type !== 'デジモン' && h.type !== 'デュアル')) continue;
      if (ff.color && !String(h.color || '').includes(ff.color)) continue;
      let ok = false;
      try { ok = canEvolveOnto(h, base); } catch (_) { ok = false; }
      if (!ok) continue;
      const cost = getEvolveCostFor(h, base);
      if (cost === null || cost === undefined) continue;
      if (Math.max(0, cost - disc) <= left) return true;
    }
  }
  return false;
}
// 高（デジモンマスター）は1つ行動するたびに「考え中」を出してから決める
function aiPlayAuto(callback, _fxWaited) {
  // 前の演出（デッキオープン・手札に加えたカードの表示・カードの移動等）が終わってから次の行動を決める（行動のたびに）
  // （演出の途中で進化の演出等が重なっていた。オンラインの相手の操作を見ているときと同じ間合いにする）
  if (!_fxWaited) { _aiAfterFx(() => aiPlayAuto(callback, true)); return; }
  if (_aiIsHigh() && aiCanAct() && !bs._battleAborted) { _aiThink(() => _aiPlayAutoBody(callback)); return; }
  _aiPlayAutoBody(callback);
}
function _aiPlayAutoBody(callback) {
  if (!aiCanAct()) { callback(); return; }
  _aiLogPlan();
  // 高: 相手をコントロール型（除去・進化元破棄が多い）と読んだら、1体に重ねて育てる前に、自分のメモリーで出せるデジモンを
  // 先に出して2体以上並べる（1体だけだと、除去されたときに何も残らない）
  if (_aiIsHigh() && !_aiOverflowOK) {
    const opp = _aiOppRead();
    if (opp && opp.style === 'control' && (bs.ai.battleArea || []).filter(_aiIsDigi).length <= 1
        && _aiTryPlayDigimon(callback, c => _aiPlayCost(c) <= Math.abs(bs.memory))) return;
  }

  // ① 育成エリアで進化（プレイヤーの doEvolveIku と同じ処理: 代替進化・進化コスト-の予約 → 状態を引き継いだ新しい1体 →
  //    コスト支払い → 進化ドロー → 【進化時】）
  //    孵化したデジタマ（タイプ「デジタマ」の Lv.2）も進化させる（以前はタイプがデジモンのときだけで、育成エリアで一切進化していなかった）
  // 育成エリアでは【進化時】等の効果が使えない。Lv.3以上を育成エリアで進化させるのは（中・高）:
  //  ・バトルエリアに進化できるデジモンがいるなら、先にそちらを進化させる（効果を使える方を優先）
  //  ・高: 育成エリアで育て続けると判断したとき（_aiMasterNurseryHoldReason）だけ。それ以外は次の育成フェイズで出して、場で進化させる
  //  ・中: Lv.3 → Lv.4 の1段だけ（進化ドローを得る）。それ以上は場に出してから進化させる
  let _ikuOk = true;
  if (bs.ai.ikusei && _aiIsMid() && _lvOf(bs.ai.ikusei) >= 3) {
    const _battleEvo = (bs.ai.battleArea || []).some(b => b && _aiIsDigi(b) && (() => { try { return !!_aiFindEvolve(b); } catch (_) { return false; } })());
    if (_battleEvo) _ikuOk = false;
    else if (_aiIsHigh()) _ikuOk = !!_aiMasterNurseryHoldReason(bs.ai.ikusei);
    else _ikuOk = _lvOf(bs.ai.ikusei) === 3;
  }
  if (_ikuOk && bs.ai.ikusei && (bs.ai.ikusei.type === 'デジモン' || bs.ai.ikusei.type === 'デジタマ')) {
    const _ev = _aiFindEvolve(bs.ai.ikusei);
    if (_ev) {
      _aiWhy('育成エリアの「' + bs.ai.ikusei.name + '」を「' + _ev.card.name + '」に進化させます ← '
        + (_aiHasOnMove(_ev.card) ? '「' + _ev.card.name + '」は【移動時】の効果を持っているので、育成エリアで育ててからバトルエリアに移動させ、その効果を使いたいからです。'
          : !_aiHasOnPlay(_ev.card) ? '「' + _ev.card.name + '」は【登場時】の効果を持たないので、手札から出すより育成エリアで進化させる方が安く、進化ドローも得られるからです。'
          : '手札から出すより育成エリアで進化させる方が安く、進化ドローも得られるからです。'));
      _aiEvolveIku(_ev.card, (turnEnded) => {
        _hooks.applyPermanentEffects('ai'); renderAll();
        if (turnEnded) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 600);
      });
      return;
    }
  }

  // ②' ジョグレス進化（AI対戦: 手札の［ジョグレス進化］カードで、場の2体を使えるならする）
  if (window._aiBattleActive) {
    for (const jc of bs.ai.hand.slice()) {
      if (!jc || (jc.type !== 'デジモン' && jc.type !== 'デュアル')) continue;
      let pair = null;
      for (const base of bs.ai.battleArea) {
        if (!base) continue;
        pair = _handJogressPairs(jc, base, 'ai').find(p => (parseInt(p.cost, 10) || 0) <= aiAvailableMemory(jc));
        if (pair) break;
      }
      if (!pair) continue;
      addLog('🤖 AIが「' + pair.left.name + '」と「' + pair.right.name + '」で「' + jc.name + '」にジョグレス進化！');
      // 進化に影響を及ぼす効果はジョグレス進化にも及ぶ（公式ルール 8-2-2-5。プレイヤーの _doHandJogress と同じ）
      let _jCost = parseInt(pair.cost, 10) || 0;
      try { _jCost = Math.max(0, _jCost - _getStaticEvoCostReduction(jc, pair.left, bs, 'ai')); } catch (_) {}
      { const _ed = _consumePendingEvoCostReduction(jc, pair.left); if (_ed > 0) _jCost = Math.max(0, _jCost - _ed); }
      doJogressFromEffect(jc, pair.left, pair.right, _jCost, 'ai', () => {
        _hooks.applyPermanentEffects('ai'); renderAll(true);
        if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 600);
      });
      return;
    }
  }

  // ② バトルエリアで進化（プレイヤーの進化と同じ処理: 進化コストの増減・「進化するとき」の効果・吸収進化 →
  //    共通の doEvolveFromEffect（状態の引き継ぎ・コスト支払い・進化ドロー・【進化時】）
  // 中: レベルの高いデジモンから進化させる（1体を大きく育てる）。低は並び順のまま
  const _evoOrder = bs.ai.battleArea.map((_, i) => i);
  // 高: このターンにアタックできるデジモン（アクティブで、登場したターンでない）を先に進化させる
  // このターンにアタックできるか: アクティブ・登場したターンでない（≪速攻≫なら可。育成エリアから移動したデジモンは登場ではないので可）・
  // 「アタックできない」「レストできない」が付いていない（以前は付与を見ておらず、アタックできないデジモンを先に進化させていた）
  const _canSwing = (c) => (c && !c.suspended && !c.cantAttack && !c.cantRest
    && (!c.summonedThisTurn || !!((c._permEffects && c._permEffects.rush) || (Array.isArray(c.buffs) && c.buffs.some(b => b && b.type === 'keyword_rush')))) ? 1 : 0);
  if (_aiIsHigh()) _evoOrder.sort((a, b) => (_canSwing(bs.ai.battleArea[b]) - _canSwing(bs.ai.battleArea[a])) || (_lvOf(bs.ai.battleArea[b]) - _lvOf(bs.ai.battleArea[a])));
  else if (_aiIsMid()) _evoOrder.sort((a, b) => _lvOf(bs.ai.battleArea[b]) - _lvOf(bs.ai.battleArea[a]));
  for (const i of _evoOrder) {
    const base = bs.ai.battleArea[i];
    if (!base || (base.type !== 'デジモン' && base.type !== 'デュアル')) continue;
    // アプ合体（本体にアプ合体の相手がリンクしていて、手札にアプ合体先がある）: 進化より先に行う
    const _ag = _aiFindAppGattai(base);
    if (_ag) {
      _aiWhy('「' + base.name + '」を「' + _ag.card.name + '」にアプ合体させます ← アプ合体に必要なカードがリンクしていて、コストも払えるからです。');
      _aiDoAppGattai(_ag.card, i, _ag.ag, () => {
        _hooks.applyPermanentEffects('ai'); renderAll(true);
        if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 600);
      });
      return;
    }
    const _ev = _aiFindEvolve(base);
    if (!_ev) continue;
    if (_ev.burst) {
      _aiWhy('「' + base.name + '」を「' + _ev.card.name + '」にバースト進化させます ← 切り札につながるカードを、ふつうの進化より安く出せるからです。手札に戻すテイマーは、また出し直せます。');
      _aiDoBurstEvolve(_ev.card, i, _ev.burst, () => {
        _hooks.applyPermanentEffects('ai'); renderAll(true);
        if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 600);
      });
      return;
    }
    {
      const _rs = [];
      if (bs._aiRaidPlanTurn === bs.turn && bs._aiRaidPlanCard === base) _rs.push('前もって決めていたとおり、進化させてターン終了時に【急襲】でアタックします。');
      if (_aiIsFinisher(_ev.card)) _rs.push('このデッキの切り札（最上位のデジモン）なので、早く場に出したいからです。');
      if (_aiIsHigh() && _aiPlan() === 'defend' && _aiIsDefensive(_ev.card)) _rs.push('今は守りを固めたいので、守りに強いカードを選びました。');
      if (_canSwing(base)) _rs.push('このターンにアタックできるデジモンなので、強くしてから攻めたいからです。');
      else if (base.cantAttack) _rs.push('このデジモンは今「アタックできない」状態ですが、次のターン以降のために育てておきます。');
      if (_ev.alt) _rs.push('代替進化でコストを安くできます。');
      _aiWhy('「' + base.name + '」を「' + _ev.card.name + '」に進化させます（コスト' + _ev.cost + '） ← ' + (_rs.length ? _rs.join('') : 'まだ攻められる状況ではないので、レベルを上げて育てておきます。'));
    }
    _aiEvolveInBattleArea(_ev.card, i, () => {
      _hooks.applyPermanentEffects('ai'); renderAll(true);
      if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 600);
    });
    return;
  }

  // ②' テイマーから進化（進化条件「特徴「倉田軍団」を持つテイマー」BT27-048 等）。プレイヤーと同じ doEvolveFromTamer
  for (const t of (bs.ai.tamerArea || []).slice()) {
    if (!t) continue;
    const _ev = _aiFindEvolve(t);
    if (!_ev || _ev.alt || _ev.burst) continue;
    addLog('🤖 AIがテイマー「' + t.name + '」から「' + _ev.card.name + '」に進化！');
    // 「次の進化コスト-N」の予約もプレイヤー（doEvolveTamer）と同じく使う（常在の増減は _ev.cost に入っている）
    let _tCost = _ev.cost;
    { const _ed = _consumePendingEvoCostReduction(_ev.card, t); if (_ed > 0) _tCost = Math.max(0, _tCost - _ed); }
    doEvolveFromTamer(_ev.card, t, _tCost, 'ai', () => {
      _hooks.applyPermanentEffects('ai'); renderAll(true);
      if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 600);
    });
    return;
  }

  const available = aiAvailableMemory();

  // ③ オプション/テイマー/デュアル（オプション・デュアルは場に同色が無ければ使用不可。使用条件を満たせば無視できる）
  const _otCands = bs.ai.hand.filter(c =>
    (c.type === 'オプション' || c.type === 'テイマー' || c.type === 'デュアル') &&
    c.playCost !== null && _aiPlayCost(c) <= aiAvailableMemory(c) &&
    (c.type === 'テイマー' || hasMatchingColorInPlay(c, 'ai') || meetsUseCondition(c, 'ai') || _ignoresColorCondition(c, 'ai')) &&
    !(_aiIsMid() && _aiMidOptionIsWasted(c)) &&
    // 中・高: 使っても何も起きない（エンジンの判定: 手札に進化できるカードが無い等）／効果の進化コストが払えないなら使わない
    !(_aiIsMid() && (c.type === 'オプション' || c.type === 'デュアル') && (!_mainEffectWillDoAnything(c, bs, 'ai') || !_aiOptionEvolveAffordable(c))) &&
    !(_aiIsHigh() && _aiHighHoldOption(c)) &&
    // 高: デュアルカードは「オプションとして使う」と決めたときだけ（直接進化は ② で）
    !(c.type === 'デュアル' && _aiIsHigh() && _aiDualMode(c) !== 'option')
  );
  // 高: メモリーを増やすテイマーを優先して出す。守りを固める作戦なら、守りのカード（除去・ブロッカー等）をその次に
  if (_aiIsHigh()) {
    const _defPlan = _aiPlan() === 'defend';
    // 相手のセキュリティから弱らせるオプションが出てきそうなら、セキュリティを効果で破棄するカードも先に使う
    const _secT = _aiOppSecOptionThreat();
    const _rank = (c) => ((c.type === 'テイマー' && /メモリー/.test(String(c.effect || ''))) ? 2 : 0) + (_defPlan && _aiIsDefensive(c) ? 1 : 0)
      + (_secT && _aiTagsOf(c).secTrash ? 1.5 : 0);
    _otCands.sort((a, b) => _rank(b) - _rank(a));
  }
  const optionOrTamer = _otCands[0];
  if (optionOrTamer) {
    {
      const _t = _aiTagsOf(optionOrTamer);
      const _r = optionOrTamer.type === 'テイマー'
        ? (/メモリー/.test(String(optionOrTamer.effect || '')) ? 'メモリーを増やせるテイマーなので、早めに出しておくと次のターン以降が楽になるからです。' : 'テイマーを場に出して、その効果を使えるようにしておきたいからです。')
        : (_t.removal ? 'あなたのデジモンを取り除ける効果で、狙える相手がいるからです。' : _t.evoDiscard ? 'あなたのデジモンの進化元を減らせる効果で、狙える相手がいるからです。' : _t.secTrash ? 'あなたのセキュリティを効果で減らせるからです。'
          : _t.search ? '手札を増やして、次の行動につなげたいからです。' : _t.cheat ? 'コストを抑えてデジモンを登場・進化させられるからです。' : '今使うと効果がきちんと働くからです。');
      const _ex = (optionOrTamer.type === 'オプション' || optionOrTamer.type === 'デュアル') ? _aiExplainSteps(optionOrTamer) : '';
      _aiWhy('「' + optionOrTamer.name + '」を使います（コスト' + _aiPlayCost(optionOrTamer) + '） ← '
        + (_ex ? 'この効果は ' + _ex + '。少なくとも1つは今使って効くので使います。' : _r)
        + (bs.memory > 0 || _aiOverflowOK ? 'アタックの後に残ったメモリーを有効に使います。' : ''));
    }
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
    .find(z => z && z.card && z.payCost <= aiAvailableMemory(z.card) && z.card._aiZoneMainTurn !== bs.turn);
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

  // ③'' 場のデジモン・テイマーの【メイン】効果（AI対戦: 使えるものは全て使う。同じカードはこのターン1回だけ試す）
  if (window._aiBattleActive && window._triggerMainEffect) {
    const mainCard = [...bs.ai.battleArea, ...bs.ai.tamerArea].find(c => {
      if (!c || c._noMainAbility || c._aiMainTurn === bs.turn) return false;
      try {
        if (!_hasOwnMainEffect(c)) return false;
        const st = _mainEffectButtonState(c) || {};
        // 使っても何も起きない【メイン】（対象がいない・≪ディレイ≫の後ろの効果ができない等）は使わない
        return !st.usedUp && !st.unusable && _mainEffectWillDoAnything(c, bs, 'ai') && (!_aiIsMid() || _cpuMainEffectWorthIt(c, bs));
      } catch (_) { return false; }
    });
    if (mainCard) {
      mainCard._aiMainTurn = bs.turn;
      if (!mainCard._usedEffects) mainCard._usedEffects = [];
      mainCard._usedEffects.push('self');
      addLog('🤖 AIが「' + mainCard.name + '」の【メイン】効果を使用！');
      _aiWhy('「' + mainCard.name + '」の【メイン】効果を使います ← 効果の対象がいて、今使うと得になるからです。このターンだけの効果なら、アタックできるデジモンがいることも確認しています。');
      window._triggerMainEffect(mainCard, () => {
        _hooks.applyPermanentEffects('ai');
        renderAll(true);
        if (bs.memory > 0) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 500);
      });
      return;
    }
  }

  // ④' リンク（手札のリンクカードを場のデジモンにリンク）
  if (_aiTryLink(callback)) return;
  // ④ デジモン登場 → 出せるものが無ければ ≪トレーニング≫（もうアタックしないデジモン・育成エリア）
  if (!_aiTryPlayDigimon(callback) && !_aiTryTraining(callback)) callback();
}

// ④ デジモン登場（出したら true）。extra で候補をさらに絞れる
function _aiTryPlayDigimon(callback, extra) {
  const playable = bs.ai.hand.filter(c =>
    c.type === 'デジモン' && c.level !== '2' && c.playCost !== null && _aiPlayCost(c) - _aiMaterialDiscount(c) <= aiAvailableMemory(c)
    // 中・高: 【移動時】のカードは育成エリアで育てて移動する（手札から登場させない）
    && !_aiKeepForNursery(c)
    && (!extra || extra(c))
  );
  if (playable.length === 0) return false;
  // 低: 安いものから。中: 出せる中で一番強い（コストの高い）ものから
  // 高: さらに作戦で並べ替える（守るならブロッカー等の守りのデジモン、育てるなら勝ち筋につながるデジモンを先に）
  if (_aiIsHigh()) {
    const plan = _aiPlan();
    const _secT = _aiOppSecOptionThreat();
    const rank = (c) => (plan === 'defend' && _aiIsDefensive(c) ? 20000 : 0) + (plan !== 'defend' && _aiOnLine(c) ? 3000 : 0)
      + (_secT && _aiTagsOf(c).secTrash ? 5000 : 0)
      + _aiPlayCost(c) * 1000 + _lvOf(c);
    playable.sort((a, b) => rank(b) - rank(a));
  } else if (_aiIsMid()) playable.sort((a, b) => (_aiPlayCost(b) - _aiPlayCost(a)) || (_lvOf(b) - _lvOf(a)));
  else playable.sort((a, b) => _aiPlayCost(a) - _aiPlayCost(b));
  const c = playable[0];
  {
    const _mp = _aiMaterialPlan(c);
    const _r = [];
    if (_mp) _r.push(_mp.kind === 'digixros' ? 'デジクロスで登場コストを下げられます。' : 'アセンブリでトラッシュのカードを使い、登場コストを下げられます。');
    if (_aiIsHigh() && _aiPlan() === 'defend' && _aiIsDefensive(c)) _r.push('今は守りを固めたいので、守りに強いデジモンを出します。');
    else if (_aiOnLine(c)) _r.push('切り札へ進化していくための土台になるデジモンです。');
    if (_aiTagsOf(c).search) _r.push('【登場時】の効果で手札を増やせます。');
    if (extra) _r.push('あなたのデッキは除去が多いと読んだので、1体に重ねる前にデジモンを並べておきます。');
    _aiWhy('「' + c.name + '」を登場させます（コスト' + Math.max(0, _aiPlayCost(c) - (_mp ? _mp.discount : 0)) + '） ← ' + (_r.length ? _r.join('') : '今のメモリーで出せる中で、一番強いデジモンだからです。'));
  }
  const handIdx = bs.ai.hand.indexOf(c);
  aiPlayCard(c, handIdx, (turnEnded) => {
    if (turnEnded) { setTimeout(() => callback(), 500); return; }
    setTimeout(() => aiPlayAuto(callback), 500);
  });
  return true;
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
  await _attackEndCommon();
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

// アタックの終了（公式ルール 11-6）のルールの処理。プレイヤーのアタック（checkPendingTurnEnd）と CPU のアタック（_aiAttackEnd）で共通:
// 後回しにした非ターンプレイヤー側の効果 → 「アタック終了まで」「バトル終了まで」の期限切れ → 保留していた DP0 の消滅 →
// 保留した「〜したとき」の反応 → 【衝突】のブロッカーを外す → 保留していた【進化時】
// あなたのアタックで AI のセキュリティがチェックされたときの反応（AIの考え）
function _aiReactSecurityLoss() {
  const lost = bs._aiSecLost;
  bs._aiSecLost = null;
  if (!lost || !lost.length || !_aiIsMid()) return;
  const rem = (bs.ai.security || []).length;
  const atk = bs._attackingCard;
  const shown = lost.map(c => '「' + c.name + '」').join('');
  const feel = rem === 0 ? '追い詰められた。次にアタックが通ったら負けてしまう。ブロッカーと除去で全力で守る。'
    : rem === 1 ? 'あと1枚しかない…次のターンは守りを最優先にする。'
    : rem === 2 ? 'このままだと危ない。次のターンは守りも意識して動く。'
    : 'まだ余裕はある。次のターンで取り返す。';
  _aiWhy((atk ? 'あなたの「' + atk.name + '」のアタックで、' : '') + 'セキュリティを' + lost.length + '枚チェックされました（残り' + rem + '枚） ← '
    + (lost.length >= 3 ? '一度に' + lost.length + '枚も…！' : '') + 'めくれたのは' + shown + 'でした。' + feel);
}
async function _attackEndCommon() {
  try { _aiReactSecurityLoss(); } catch (_) {}
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
}

// CPU のアタックの終了: プレイヤーのアタックの checkAttackEnd → checkPendingTurnEnd と同じ処理を side='ai' で行う。
// アタックしたデジモン（進化していれば進化後）が場に残っていれば【アタック終了時】を発揮し、アタック終了のルールの処理
// （_attackEndCommon）をしてから next（次のアタッカーへ）
function _aiAttackEnd(atk, atkIdx, next) {
  const finish = () => {
    _attackEndCommon().catch((e) => console.error('[_aiAttackEnd]', e)).then(() => { next && next(); });
  };
  const cur = bs.ai.battleArea[atkIdx];
  if (cur && _isSameDigimon(cur, atk)) {
    hideCombatBackdrop();
    renderAll();
    try { _hooks.checkAndTriggerEffect(cur, '【アタック終了時】', finish, 'ai'); }
    catch (e) { console.error('[_aiAttackEnd]', e); finish(); }
    return;
  }
  finish();
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

// 魔法を使ったような演出（時間はミリ秒）:
//   0〜   足もとに魔法陣が開く
//   100〜 星の砂が魔法陣の周りをぐるっと回りながら中心へ集まる
//   950〜 魔法陣から光の柱が立ち、星屑がぱぁっと湧き出す
//   1050〜 光の中からカードが現れる → 名前・コスト → カードを光が横切る・まわりで星がまたたく
const _OPT_CARD_AT = 1050;
const _OPT_TOTAL = 3000;
function _optionMagicFx(layer) {
  if (!document.getElementById('_opt-magic-style')) {
    const st = document.createElement('style');
    st.id = '_opt-magic-style';
    st.textContent = `
@keyframes optCircleOpen { 0% { transform:translate(-50%,-50%) perspective(700px) rotateX(68deg) scale(0.15); opacity:0; } 60% { opacity:1; } 100% { transform:translate(-50%,-50%) perspective(700px) rotateX(68deg) scale(1); opacity:1; } }
@keyframes optMagicSpin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
@keyframes optCircleGlow { 0%,100% { opacity:0.55; } 50% { opacity:1; } }
@keyframes optPillar { 0% { transform:translateX(-50%) scaleY(0); opacity:0; } 20% { opacity:1; } 60% { transform:translateX(-50%) scaleY(1); opacity:0.9; } 100% { transform:translateX(-50%) scaleY(1); opacity:0; } }
@keyframes optCoreFlash { 0% { transform:translate(-50%,-50%) scale(0.2); opacity:0; } 30% { opacity:1; } 100% { transform:translate(-50%,-50%) scale(2.6); opacity:0; } }
@keyframes optRise { 0% { transform:translate(-50%,-50%) scale(0.2) rotate(0deg); opacity:0; } 12% { opacity:1; } 70% { opacity:1; } 100% { transform:translate(calc(-50% + var(--dx)),calc(-50% - var(--dy))) scale(1) rotate(var(--sr)); opacity:0; } }
@keyframes optTwinkle { 0%,100% { transform:translate(-50%,-50%) scale(0) rotate(0deg); opacity:0; } 40% { transform:translate(-50%,-50%) scale(1.25) rotate(45deg); opacity:1; } 55% { transform:translate(-50%,-50%) scale(0.85) rotate(60deg); opacity:1; } 70% { transform:translate(-50%,-50%) scale(1.15) rotate(80deg); opacity:1; } }
@keyframes optShine { 0% { left:-80%; } 100% { left:130%; } }`;
    document.head.appendChild(st);
  }
  const W = layer.clientWidth || window.innerWidth;
  const H = layer.clientHeight || window.innerHeight;
  const CX = W / 2, CY = H * 0.6;            // 魔法陣の中心（カードの足もと）
  const R = Math.min(W * 0.4, 180);          // 魔法陣の半径
  // 十字の光の筋が長い星（中心は白く光らせる）
  const STAR = 'polygon(50% 0%,58% 42%,100% 50%,58% 58%,50% 100%,42% 58%,0% 50%,42% 42%)';
  const COLORS = ['#ffffff', '#fff3a8', '#e8c8ff', '#cc88ff', '#aee6ff'];
  const star = (size, color) => {
    const s = document.createElement('div');
    s.style.cssText = `position:absolute;width:${size}px;height:${size}px;pointer-events:none;filter:drop-shadow(0 0 ${Math.round(size / 5)}px #fff) drop-shadow(0 0 ${Math.round(size / 2.5)}px ${color}) drop-shadow(0 0 ${Math.round(size / 1.5)}px ${color});`;
    const body = document.createElement('div');
    body.style.cssText = `position:absolute;inset:0;clip-path:${STAR};background:radial-gradient(circle,#fff 0%,#fff 18%,${color} 45%,${color} 100%);`;
    s.appendChild(body);
    return s;
  };
  const dot = (size, color) => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;border-radius:50%;background:#fff;box-shadow:0 0 ${size + 2}px ${color},0 0 ${size * 3}px ${color};pointer-events:none;will-change:transform,opacity;`;
    return d;
  };

  // --- 足もとの魔法陣（奥に倒した円。ゆっくり回る） ---
  const circle = document.createElement('div');
  circle.style.cssText = `position:absolute;left:${CX}px;top:${CY}px;width:${R * 2}px;height:${R * 2}px;transform:translate(-50%,-50%) perspective(700px) rotateX(68deg) scale(0.15);opacity:0;animation:optCircleOpen 0.6s ease-out forwards;pointer-events:none;`;
  const pts = (r, n, rot) => Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * i) / n + rot; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]; });
  const tri = (rot) => pts(70, 3, rot).map((p) => p.join(',')).join(' ');
  const dots = pts(88, 12, 0).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff3a8"/>`).join('');
  circle.innerHTML = `<div style="position:absolute;inset:-12%;border-radius:50%;background:radial-gradient(circle,rgba(204,136,255,0.55) 0%,rgba(170,102,255,0.25) 45%,transparent 70%);animation:optCircleGlow 0.9s ease-in-out infinite;"></div>
  <svg viewBox="0 0 200 200" width="100%" height="100%" style="position:relative;animation:optMagicSpin 5s linear infinite;filter:drop-shadow(0 0 4px #fff) drop-shadow(0 0 10px #cc88ff) drop-shadow(0 0 20px #aa66ff);">
    <circle cx="100" cy="100" r="96" fill="none" stroke="#e8c8ff" stroke-width="2"/>
    <circle cx="100" cy="100" r="80" fill="none" stroke="#cc88ff" stroke-width="1.4" stroke-dasharray="5 3"/>
    <circle cx="100" cy="100" r="70" fill="none" stroke="#fff" stroke-width="1.4"/>
    <polygon points="${tri(-Math.PI / 2)}" fill="none" stroke="#fff3a8" stroke-width="1.6"/>
    <polygon points="${tri(Math.PI / 2)}" fill="none" stroke="#fff3a8" stroke-width="1.6"/>
    <circle cx="100" cy="100" r="36" fill="none" stroke="#e8c8ff" stroke-width="1.2"/>
    ${dots}</svg>`;
  // カードが出たら薄くして、名前・コストの文字を読みやすくする
  const circleWrap = document.createElement('div');
  circleWrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;transition:opacity 0.6s ease-out;';
  circleWrap.appendChild(circle);
  layer.appendChild(circleWrap);
  setTimeout(() => { circleWrap.style.opacity = '0.3'; }, _OPT_CARD_AT + 450);

  // --- 星の砂: 魔法陣の周りをぐるっと回りながら、少しずつ内側・上へ寄っていく ---
  const SAND = 80;
  const sand = [];
  for (let i = 0; i < SAND; i++) {
    const d = dot(2 + Math.random() * 3.5, COLORS[i % COLORS.length]);
    d.style.opacity = '0';
    layer.appendChild(d);
    sand.push({ el: d, a0: Math.random() * Math.PI * 2, sp: 2.2 + Math.random() * 1.6, r0: 0.95 + Math.random() * 0.35, lift: Math.random() * 40, wob: Math.random() * 6 });
  }
  const SAND_FROM = 100, SAND_TO = 980;
  const t0 = performance.now();
  const tick = (now) => {
    const t = now - t0;
    if (t < SAND_FROM) { requestAnimationFrame(tick); return; }
    const k = Math.min(1, (t - SAND_FROM) / (SAND_TO - SAND_FROM)); // 0→1
    for (const p of sand) {
      const a = p.a0 + k * p.sp * Math.PI * 2;
      const rr = R * p.r0 * (1 - 0.85 * k * k);                       // 最後に中心へ吸い込まれる
      const x = CX + rr * Math.cos(a);
      const y = CY + rr * 0.32 * Math.sin(a) - p.lift * k - Math.sin(k * 9 + p.wob) * 3;
      const front = (Math.sin(a) + 1) / 2;                            // 手前ほど明るく
      const fadeIn = Math.min(1, (t - SAND_FROM) / 200);
      p.el.style.transform = `translate(${x}px,${y}px) scale(${0.7 + front * 0.6})`;
      p.el.style.opacity = String(fadeIn * (0.35 + front * 0.65) * (k > 0.97 ? (1 - k) / 0.03 : 1));
    }
    if (k < 1) requestAnimationFrame(tick);
    else sand.forEach((p) => p.el.remove());
  };
  requestAnimationFrame(tick);

  // --- 魔法陣から光の柱と星屑が湧き出す ---
  setTimeout(() => {
    const flash = document.createElement('div');
    flash.style.cssText = `position:absolute;left:${CX}px;top:${CY}px;width:${R * 1.4}px;height:${R * 0.6}px;border-radius:50%;background:radial-gradient(ellipse,#fff 0%,rgba(255,243,168,0.9) 25%,rgba(204,136,255,0.6) 55%,transparent 75%);animation:optCoreFlash 0.7s ease-out forwards;pointer-events:none;`;
    layer.appendChild(flash);
    const pillar = document.createElement('div');
    pillar.style.cssText = `position:absolute;left:${CX}px;top:${CY - H * 0.55}px;width:${R * 1.1}px;height:${H * 0.55}px;transform-origin:50% 100%;background:linear-gradient(to top,rgba(255,255,255,0.85) 0%,rgba(232,200,255,0.55) 35%,rgba(170,102,255,0.15) 75%,transparent 100%);filter:blur(6px);animation:optPillar 1.3s ease-out forwards;pointer-events:none;border-radius:40% 40% 0 0;`;
    layer.appendChild(pillar);
    for (let i = 0; i < 46; i++) {
      const big = i % 2 === 0;
      const s = big ? star(14 + Math.random() * 22, COLORS[i % COLORS.length]) : dot(3 + Math.random() * 4, COLORS[i % COLORS.length]);
      s.style.left = (CX + (Math.random() - 0.5) * R * 0.9) + 'px';
      s.style.top = (CY + (Math.random() - 0.5) * R * 0.2) + 'px';
      s.style.transform = 'translate(-50%,-50%) scale(0.2)';
      s.style.opacity = '0';
      s.style.setProperty('--dx', Math.round((Math.random() - 0.5) * R * 1.8) + 'px');
      s.style.setProperty('--dy', Math.round(H * (0.25 + Math.random() * 0.4)) + 'px');
      s.style.setProperty('--sr', Math.round(Math.random() * 540) + 'deg');
      s.style.animation = `optRise ${1.0 + Math.random() * 0.8}s cubic-bezier(.2,.8,.35,1) ${Math.random() * 0.45}s forwards`;
      layer.appendChild(s);
    }
  }, 950);

  // --- カードが出たあと、まわりで大きな星がまたたく ---
  setTimeout(() => {
    for (let i = 0; i < 12; i++) {
      const s = star(24 + Math.random() * 26, COLORS[i % COLORS.length]);
      const a = Math.random() * Math.PI * 2, d = R * (0.8 + Math.random() * 0.7);
      s.style.left = (CX + Math.cos(a) * d) + 'px';
      s.style.top = (H * 0.45 + Math.sin(a) * d * 0.9) + 'px';
      s.style.transform = 'translate(-50%,-50%) scale(0)';
      s.style.animation = `optTwinkle ${0.8 + Math.random() * 0.4}s ease-in-out ${Math.random() * 0.8}s 2 both`;
      layer.appendChild(s);
    }
  }, _OPT_CARD_AT + 250);
}

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
  particles.innerHTML = '';
  // カードは光の柱の中から、下からせり上がって現れる
  imgEl.style.transition = 'none';
  imgEl.style.opacity = '0';
  imgEl.style.transform = 'translateY(90px) scale(0.2)';
  imgEl.style.filter = 'brightness(4) saturate(0.3)';

  const src = cardImg(card);
  imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#aa66ff;padding:8px;">${card.name}</div>`;
  imgEl.style.animation = '';
  nameEl.innerText = card.name;
  delete card._costReduction;
  costEl.innerText = (_shownCost != null && !isNaN(_shownCost)) ? _shownCost + ' コストで使用！' : '使用！';
  overlay.style.display = 'flex';

  _optionMagicFx(particles);
  setTimeout(() => { label.style.opacity = '1'; }, 200);
  setTimeout(() => { flash.style.opacity = '1'; }, 950);
  setTimeout(() => { flash.style.opacity = '0'; }, 1250);
  setTimeout(() => {
    imgEl.style.transition = 'opacity 0.35s ease-out, transform 0.6s cubic-bezier(.2,1.4,.4,1), filter 0.8s ease-out';
    imgEl.style.opacity = '1';
    imgEl.style.transform = 'translateY(0) scale(1)';
    imgEl.style.filter = 'brightness(1) saturate(1)';
  }, _OPT_CARD_AT);
  nameEl.style.textShadow = '0 0 6px #000,0 0 14px #000';
  setTimeout(() => { imgEl.style.animation = 'optionGlow 1s ease-in-out infinite'; nameEl.style.opacity = '1'; costEl.style.opacity = '1'; }, _OPT_CARD_AT + 550);
  // カードの表面を光が横切る
  setTimeout(() => {
    const sh = document.createElement('div');
    sh.style.cssText = 'position:absolute;top:0;left:-80%;width:60%;height:100%;background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,0.75) 50%,transparent 100%);animation:optShine 0.7s ease-in-out forwards;pointer-events:none;';
    imgEl.appendChild(sh);
  }, _OPT_CARD_AT + 700);
  setTimeout(() => {
    overlay.style.display = 'none';
    imgEl.style.animation = ''; imgEl.style.transition = ''; imgEl.style.filter = ''; imgEl.style.transform = '';
    particles.innerHTML = '';
    onDone && onDone();
  }, _OPT_TOTAL);
}

// ----- セキュリティチェック演出 -----

export function showSecurityCheck(secCard, atkCard, callback, customLabel, onOpen) {
  // 相手の端末から届いたVS画面か（battle-online.js fx_securityCheck が立てる。1回分）
  const _vsRemote = typeof window !== 'undefined' && !!window._vsRemoteOpen;
  if (typeof window !== 'undefined') window._vsRemoteOpen = false;
  if (_onlineMode && _sendCommand && !window._suppressFxSend) {
    // バフ付きカードを受信側でも「元値+バフ」表示できるよう、baseDpを送る
    const secBase = parseInt(secCard._origDp != null ? secCard._origDp : (secCard.baseDp != null ? secCard.baseDp : secCard.dp)) || 0;
    const atkBase = parseInt(atkCard._origDp != null ? atkCard._origDp : (atkCard.baseDp != null ? atkCard.baseDp : atkCard.dp)) || 0;
    _sendCommand({ type: 'fx_securityCheck', secStack: Array.isArray(secCard.stack) ? secCard.stack.length : (typeof secCard._stackCount === 'number' ? secCard._stackCount : null), atkStack: Array.isArray(atkCard.stack) ? atkCard.stack.length : (typeof atkCard._stackCount === 'number' ? atkCard._stackCount : null), secName: secCard.name || '', secImg: cardImg(secCard), secCardNo: secCard.cardNo || '', secDp: parseInt(secCard.dp) || 0, secBaseDp: secBase, secType: secCard.type || '', atkName: atkCard.name || '', atkImg: cardImg(atkCard), atkCardNo: atkCard.cardNo || '', atkDp: parseInt(atkCard.dp) || 0, atkBaseDp: atkBase, customLabel: customLabel || '' });
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

  // 前回のぶつかり合い演出の状態（移動・ひび・WIN の文字）を戻す
  const _vsAtkArea = document.getElementById('sec-atk-area'), _vsDefArea = document.getElementById('sec-def-area'), _vsLabel = document.getElementById('sec-vs-label');
  try { fxBattleClashReset(_vsAtkArea, _vsDefArea, _vsLabel); } catch (_) {}
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
  } else if (isDigimon) {
    // デジモン同士のバトル（セキュリティデジモン・ブロック・デジモンへのアタック）: カードがぶつかり合い、火花を散らして
    // 負けた方は砕け、勝った方が光る。その後の Win/Lost・消滅の演出はいつも通り
    // （≪氷装≫は進化元の枚数で比べる）
    // 相手から届いたVS画面のカードは名前と画像だけなので、盤面の同じカードで見る
    // 同じカードが2枚あるとき、名前で探すと別のカードになる（アルクトゥルスモン2体で、もう一方の進化元の枚数が出ていた）ので、
    // まず同じものを探し、無いときだけ名前で探す。相手から届いたカードは、送ってきた進化元の枚数（_stackCount）を使う
    const _iceReal = (c) => {
      if (!c) return c;
      for (const sd of ['player', 'ai']) { if ((bs[sd].battleArea || []).includes(c)) return c; }
      for (const sd of ['player', 'ai']) { const x = (bs[sd].battleArea || []).find(y => y && y.name === c.name && (!c.cardNo || y.cardNo === c.cardNo)); if (x) return x; }
      return c;
    };
    const _cnt = (c, real) => (c && typeof c._stackCount === 'number') ? c._stackCount : ((real && real.stack) || []).length;
    const _iA = _iceReal(atkCard), _iD = _iceReal(secCard);
    // セキュリティデジモンとのバトルは DP で比べる（場にいない＝セキュリティのカード）
    const _isSecurity = !['player', 'ai'].some(sd => (bs[sd].battleArea || []).includes(_iD));
    const _ice = !_isSecurity && (_hasIceArmor(_iA) || _hasIceArmor(_iD));
    const _a = _ice ? _cnt(atkCard, _iA) : (parseInt(atkCard.dp) || 0);
    const _d = _ice ? _cnt(secCard, _iD) : (parseInt(secCard.dp) || 0);
    const _winner = _a > _d ? 'atk' : _a < _d ? 'def' : 'tie';
    const _iceAtkSide = (bs.player.battleArea || []).includes(_iA) ? 'player' : (bs.ai.battleArea || []).includes(_iA) ? 'ai' : null;
    if (_ice) setTimeout(() => _iceArmorVsFx(overlay, _vsAtkArea, _vsDefArea, _a, _d, _winner, _iceAtkSide), 1350);
    // 3回目の押し合いに入ったら callback（勝敗・消滅回避の判定）へ進む。VS画面は決着（_clashFinish）まで出したまま
    if (_clashPending) _clashForceClose();
    window._fxMoveHold = (window._fxMoveHold || 0) + 1;
    let _held = true;
    const _onFieldNow = (c) => !!c && ['player', 'ai'].some(sd => (bs[sd].battleArea || []).some(x => x && (x === c || (x.name === c.name && (!c.cardNo || x.cardNo === c.cardNo)))));
    // 相手から届いたVS画面のカードは名前と画像だけなので、こちらの盤面の同じカード（効果の情報を持つ）を探す
    // 同じカードがあればそれ（同名のデジモンが2体いると、名前で先に見つかった別の1体を使っていた。ピエモン BT2-080 台帳 c6）
    const _realOf = (c) => { if (!c) return c; for (const sd of ['player', 'ai']) { if ((bs[sd].battleArea || []).includes(c)) return c; } for (const sd of ['player', 'ai']) { const x = (bs[sd].battleArea || []).find(y => y && y.name === c.name && (!c.cardNo || y.cardNo === c.cardNo)); if (x) return x; } return c; };
    _michiABuf = null; // 前のバトルの【道連れ】の返事が残っていれば捨てる（問い合わせはVS画面より先に届くことがあるので捨てない）
    const _p = _clashPending = { atk: atkCard, def: secCard, winner: _winner, notes: {}, ctrl: null, defOnField: _onFieldNow(secCard), atkOnField: _onFieldNow(atkCard),
      atkReal: _realOf(atkCard), defReal: _realOf(secCard),
      // 相手の端末から届いたVS画面か（この端末はバトルを解決していない。【道連れ】の順番はここでは決めない。_michiVsHook）
      remote: _vsRemote,
      close: () => { overlay.style.display = 'none'; _removeCountLabel(); if (_held) { _held = false; window._fxMoveHold = Math.max(0, (window._fxMoveHold || 1) - 1); } } };
    // VS画面より先に決まっていた「はがれる」「下へ潜り込む」（守備側の端末で、VS画面が出る前に離れるときの効果を処理したとき）を反映
    if (Array.isArray(_clashEarlyNotes) && _clashEarlyNotes.length) {
      const _now = Date.now();
      _clashEarlyNotes.splice(0).forEach((n) => { if (_now - n.at < 20000) _clashNote(n.card, n.kind, n.subImgs, n.swapImg, n.swapInfo); });
    }
    setTimeout(() => {
      try {
        _p.ctrl = fxBattleClashBegin(document.getElementById('sec-vs-cards') || overlay, _vsAtkArea, _vsDefArea, _vsLabel, _winner, !!bs.isPlayerTurn, () => { callback && callback(); });
      } catch (e) { console.error('[clash]', e); if (_clashPending === _p) _clashPending = null; overlay.style.display = 'none'; _removeCountLabel(); callback && callback(); }
    }, 1350);
  } else {
    setTimeout(() => { resultEl.innerText = resultText; resultEl.style.color = resultColor; resultEl.style.textShadow = `0 0 20px ${resultColor}`; resultEl.style.opacity = '1'; resultEl.style.transform = 'scale(1)'; }, 1500);
    setTimeout(() => { overlay.style.display = 'none'; _removeCountLabel(); callback && callback(); }, 2800);
  }
}

// ----- ぶつかり合い演出の決着 -----
// VS画面の3回目の押し合いの間に、消滅回避の判定（確認のポップアップを含む）を行い、その結果で決着の演出を変える。
// 回避の結果は _clashNote で記録し、勝敗の表示（showBattleResult）・消滅演出（showDestroyEffect）等の手前で _clashFinish する
let _clashPending = null;
function _clashSideOf(card) {
  const p = _clashPending;
  if (!p || !card) return null;
  if (card === p.atk) return 'atk';
  if (card === p.def) return 'def';
  const n = card.name || '';
  if (!n || p.atk.name === p.def.name) return null;
  if (n === p.atk.name) return 'atk';
  if (n === p.def.name) return 'def';
  return null;
}
let _clashEarlyNotes = [];
function _clashNote(card, kind, subImgs, swapImg, swapInfo) {
  // VS画面がまだ始まっていない（守備側の端末で先に処理した）「はがれる」等は、始まったときに反映する
  if (!_clashPending && (kind === 'peel' || kind === 'under') && card) {
    _clashEarlyNotes.push({ card, kind, subImgs, swapImg, swapInfo, at: Date.now() });
    return false;
  }
  const side = _clashSideOf(card);
  // VS画面のカードではないカード（身代わりにしたメギドラモンACE 等）が、別のデジモンの下に入った（'under'）: 身代わりの行き先として
  // 記録し、決着の演出で「身代わり → そのデジモン（ギルモン）の進化元へ」と順に見せる（ダークドラモンACE LM-043 台帳）
  if (!side && kind === 'under' && _clashPending) {
    _clashPending.subUnder = { from: (Array.isArray(subImgs) && subImgs[0]) || '', to: swapImg || '', name: (swapInfo && swapInfo.name) || '' };
    return true;
  }
  // 持ち主の端末から届いた「はがれる」（'peel'）・身代わり（'scapegoat'）は、こちらの前後の差で上書きしない
  // （相手のカードは同期で作り直されるので、こちらの差では場のカードが全部入れ替わったように見える）
  const _STICKY = ['peel', 'under', 'scapegoat'];
  if (side && kind && !_STICKY.includes(kind) && _STICKY.includes(_clashPending.notes[side])) return true;
  if (side && kind) {
    _clashPending.notes[side] = kind;
    // 残るカード（【アーマー解除】で下から出てくるカード）の画像。決着の演出でVS画面のカードを差し替える
    if (swapImg) { if (!_clashPending.swap) _clashPending.swap = {}; _clashPending.swap[side] = swapImg; }
    // 残るカードの名前・DP（画像だけ差し替えて名前が元のカードのままだった。メギドラモンACE LM-026 → ギルモン）
    if (swapInfo && swapInfo.name) { if (!_clashPending.swapInfo) _clashPending.swapInfo = {}; _clashPending.swapInfo[side] = swapInfo; }
    // 代わりにトラッシュへ送られたカードの画像（演出に出す）
    const imgs = subImgs || (card && card._clashSubImgs) || null;
    if (Array.isArray(imgs) && imgs.length) { if (!_clashPending.subs) _clashPending.subs = {}; _clashPending.subs[side] = imgs; }
  }
  return !!side;
}
// 回避の仕方と代わりのカードの画像を、こちらのVS画面に記録し、相手の画面にも送る（相手の画面の決着の演出用）
function _clashNoteAndSend(card, kind, imgs, swapImg, swapInfo) {
  _clashNote(card, kind, imgs, swapImg, swapInfo);
  if (_onlineMode && _sendCommand && card) {
    try { _sendCommand({ type: 'fx_clashNote', cardName: card.name || '', kind, subImgs: Array.isArray(imgs) ? imgs : [], swapImg: swapImg || '', swapName: (swapInfo && swapInfo.name) || '', swapDp: (swapInfo && swapInfo.dp) || '' }); } catch (_) {}
  }
}
// 回避の前後の差から決める演出の種類（リンクカードが減った＝分離／進化元が減った＝フラグメント／場所が移った／それ以外は「消滅しない」）
function _clashKindByDiff(snap, card) {
  if (card && card._armorPurgedTo) return 'armor_break';
  // 場の他の自分のデジモンが減った（身代わりに消滅した）
  if ((snap.field || []).some(c => c && c !== card && !(bs.player.battleArea || []).includes(c) && !(bs.ai.battleArea || []).includes(c))) return 'scapegoat';
  // 減った進化元がトラッシュではなくセキュリティへ行った（充填プラグインQ P-146「進化元から…セキュリティの下に置くことで消滅しない」）
  // なら、代わりのカードが弾き飛ぶのではなく光のバリア（消滅しない）
  const _goneStack = (snap.stack || []).filter(c => c && !((card && card.stack) || []).includes(c));
  if (_goneStack.length && _goneStack.every(c => (bs.player.security || []).includes(c) || (bs.ai.security || []).includes(c))) return 'shield';
  const ln = (card && Array.isArray(card.linkedCards)) ? card.linkedCards.length : 0;
  const sn = (card && Array.isArray(card.stack)) ? card.stack.length : 0;
  return _clashKindByZone(card) || (ln < snap.link.length ? 'separate' : sn < snap.stack.length ? 'fragment' : 'shield');
}
// 消滅回避の前後の差から、代わりにトラッシュへ送られたカード（進化元・リンクカード・身代わりのデジモン・破棄したセキュリティ）を探す
function _clashSnapshot(card, owner) {
  return {
    stack: (card && Array.isArray(card.stack)) ? card.stack.slice() : [],
    link: (card && Array.isArray(card.linkedCards)) ? card.linkedCards.slice() : [],
    field: (owner && Array.isArray(owner.battleArea)) ? owner.battleArea.slice() : [],
    secTop: (owner && Array.isArray(owner.security)) ? owner.security[0] : null,
  };
}
function _clashSubCards(snap, card, owner) {
  if (!snap) return [];
  const out = [];
  const now = (arr) => Array.isArray(arr) ? arr : [];
  snap.stack.forEach(c => { if (c && !now(card && card.stack).includes(c)) out.push(c); });
  snap.link.forEach(c => { if (c && !now(card && card.linkedCards).includes(c)) out.push(c); });
  snap.field.forEach(c => { if (c && c !== card && !now(owner && owner.battleArea).includes(c)) out.push(c); });
  if (snap.secTop && !now(owner && owner.security).includes(snap.secTop)) out.push(snap.secTop);
  return out;
}
const _CLASH_REASON_KIND = { barrier: 'barrier', armor_break: 'armor_break', evade: 'evade', scapegoat: 'scapegoat', prevent_destroy: 'shield', protection: 'shield', indomitable: 'indomitable', fragment: 'fragment', separate: 'separate' };
// 消滅せずに別の場所へ行ったとき、カードの今の場所から演出の種類を決める（自分の端末のカードのとき）
function _clashKindByZone(card) {
  for (const sd of ['player', 'ai']) {
    const P = bs[sd];
    if (!P) continue;
    if ((P.hand || []).includes(card)) return 'to_hand';
    if ((P.deck || []).includes(card)) return 'to_deck';
    if ((P.security || []).includes(card)) return 'to_security';
  }
  return null;
}
function _clashForceClose() {
  const p = _clashPending; _clashPending = null;
  if (!p) return;
  // （close() で移動演出の保留も解除される）
  try { p.ctrl && p.ctrl.close(); } catch (_) {}
  try { p.close(); } catch (_) {}
}
if (typeof window !== 'undefined') window._clashNote = (card, kind, imgs, swapImg, swapInfo) => _clashNote(card, kind, imgs, swapImg, swapInfo);
if (typeof window !== 'undefined') window._clashIsPending = () => !!_clashPending;
function _closeRemoteConfirm() {
  // 決着の時点で、相手の確認（【防壁】等）の「相手が効果を発動中…」が残っていれば閉じる
  try { const el = document.getElementById('_remote-effect-announce'); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
}
// 【道連れ】になるか（負けた側が【道連れ】を持ち、勝った側がVS開始時に場のデジモンだった）
function _clashRecoilSide(p) {
  if (!p || p.winner === 'tie') return null;
  const ls = p.winner === 'atk' ? 'def' : 'atk';
  const winOnField = p.winner === 'def' ? p.defOnField : p.atkOnField;
  const loserReal = (ls === 'atk' ? p.atkReal : p.defReal) || p[ls];
  return ((hasMichizure(loserReal) || hasMichizure(p[ls])) && winOnField) ? p.winner : null;
}
function _clashFinish(textHint, cb, remoteInfo) {
  const p = _clashPending;
  if (!p) { cb && cb(); return; }
  // 相手の端末で決まった【道連れ】（こちらの画面の相手のカードには【道連れ】の情報が無いことがある）
  if (remoteInfo && remoteInfo.recoilName) p._forceRecoilName = remoteInfo.recoilName;
  _clashPending = null;
  _closeRemoteConfirm();
  const hint = String(textHint || '');
  const avoidedHint = /回避|ジャミング/.test(hint) && !/両者消滅/.test(hint);
  const out = {};
  const loserOf = (side) => p.winner === 'tie' || p.winner !== side;
  ['atk', 'def'].forEach((side) => {
    const card = p[side];
    if (!loserOf(side)) { out[side] = 'win'; return; }
    let kind = p.notes[side] || _clashKindByZone(card);
    // 【ジャミング】で消滅しなかった: バリアを張った瞬間に「ジャミング！」と出す（それ以外の「消滅しない」は「消滅しない！」）
    if (!kind && avoidedHint && p.winner !== 'tie') kind = /ジャミング/.test(hint) ? 'jamming' : 'shield';
    if (!kind) kind = 'trash'; // 【不屈】もここではトラッシュへ（消滅時の効果の後、不屈で登場するときに戻ってくる演出を出す）
    out[side] = kind;
  });
  // 【道連れ】: 負けた側がバトルで消滅するなら、勝った側も続けて吹き飛ばされる
  if (p.winner !== 'tie') {
    const ls = p.winner === 'atk' ? 'def' : 'atk';
    // 勝った側が場のデジモンのときだけ（セキュリティのデジモンとのバトルでは【道連れ】は発揮しない。セキュリティのデジモンは
    // 通常どおり勝ち）。相手の画面では作り直したカードなので名前でも探す
    // （場にいたかはVSの開始時に記録。決着の時点では【道連れ】で既に場から外れていることがある）
    // 【道連れ】は誘発効果なので、決着の演出では見せない（勝った側は勝ちのまま）。同時に誘発したターンプレイヤーの効果等の後、
    // 【道連れ】を発揮する順番が来たときに「道連れ！」と消滅の演出を出す（P-090 の効果より先に道連れの演出が出ていた）
    void ls; void _clashRecoilSide;
  }
  // トラッシュへ飛ばしたカードは、この後の消滅演出・セキュリティデジモンの LOSE 演出を重ねない
  ['atk', 'def'].forEach((side) => { if (['trash', 'indomitable', 'recoil'].includes(out[side])) registerClashLoser(p[side]); });
  if (p.subs) out._subs = p.subs;
  if (p.swap) out._swap = p.swap;
  if (p.swapInfo) out._swapInfo = p.swapInfo;
  if (p.subUnder) out._subUnder = p.subUnder;
  const end0 = () => { try { p.close(); } catch (_) {} window._clashAt = Date.now(); cb && cb(); };
  // 決着（LOSE が出た後）、VS画面を閉じる前に【道連れ】の順番を決める（_michiVsHook）
  const end = () => _michiVsHook(p, out, remoteInfo, end0);
  if (!p.ctrl) { end(); return; }
  try { p.ctrl.finish(out, end); } catch (e) { console.error('[clashFinish]', e); end(); }
}
if (typeof window !== 'undefined') window._clashFinish = (hint, cb, info) => _clashFinish(hint, cb, info);
// 決着の演出を始めることを相手の画面にも伝える（相手の画面も同時に決着の演出を始める）。以前は決着の演出が
// 終わってから勝敗の表示（fx_battleResult）を送っていたので、相手の画面ではこちらの演出が終わった後に始まっていた
function _clashFinishSync(hint, cb) {
  if (_clashPending && _onlineMode && _sendCommand && !window._suppressFxSend) {
    const _rs = _clashRecoilSide(_clashPending);
    try { _sendCommand({ type: 'fx_clashFinish', hint: String(hint || ''), recoilName: _rs ? (_clashPending[_rs].name || '') : '' }); } catch (_) {}
  }
  _clashFinish(hint, cb);
}

// ----- バトル結果演出 -----

export function showBattleResult(text, color, sub, callback, oppText, oppColor) {
  _closeRemoteConfirm();
  // VS画面の押し合いが続いていれば、先に決着の演出を見せる
  if (_clashPending) { _clashFinishSync(text, () => showBattleResult(text, color, sub, callback, oppText, oppColor)); return; }
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
  // 勝ち（Win!!・撃破！）は金色の光線と紙吹雪で大きく、負け（Lost...・両者消滅等）は赤い破片と揺れ
  const _win = /win|撃破！/i.test(String(text)) && !/撃破された/.test(String(text));
  const _lose = /lost|lose|両者/i.test(String(text));
  let _cleanup = null;
  // 直前のぶつかり合い演出で WIN/LOSE を大きく見せたので、ここは何が起きたか（「〜を撃破！」等）を短く出すだけ
  if ((_win || _lose) && window._clashAt && Date.now() - window._clashAt < 3000) {
    textEl.style.opacity = '0';
    overlay.style.background = 'rgba(0,0,0,0.35)';
    subEl.style.fontSize = '1.05rem'; subEl.style.color = '#fff'; subEl.style.opacity = '1';
    setTimeout(() => { overlay.style.display = 'none'; subEl.style.fontSize = ''; subEl.style.color = ''; callback && callback(); }, 1000);
    return;
  }
  if (_win || _lose) {
    overlay.style.overflow = 'hidden';
    overlay.style.background = _win ? 'radial-gradient(ellipse at center,rgba(60,40,0,0.85) 0%,rgba(0,0,0,0.8) 70%)' : 'radial-gradient(ellipse at center,rgba(60,0,0,0.85) 0%,rgba(0,0,0,0.85) 70%)';
    try { _cleanup = fxBattleResultBurst(overlay, textEl, _win); } catch (_) { _cleanup = null; }
    setTimeout(() => { subEl.style.opacity = '1'; }, 450);
  } else {
    setTimeout(() => { textEl.style.opacity = '1'; textEl.style.transform = 'scale(1)'; setTimeout(() => { subEl.style.opacity = '1'; }, 200); }, 50);
  }
  setTimeout(() => { overlay.style.display = 'none'; if (_cleanup) { try { _cleanup(); } catch (_) {} } callback && callback(); }, _cleanup ? 1900 : 1500);
}

// ----- セキュリティデジモンのバトル後 -----
// セキュリティデジモンはバトルに負けても消滅しない。勝っても負けても、チェックの最後にトラッシュに置かれる
// （総合ルール 14-2-3 / 13-1-8-4）。【セキュリティ】効果で「このカードを手札に加える」（インプモン P-071 等）なら手札へ。
// owner: セキュリティの持ち主（bs.ai / bs.player）。useOnlineFlag: オンラインで持ち主の端末が効果を処理したとき、
// 手札に加えたかを security_effect_done（window._lastSecEffectReturnToHand）で受け取っている
// 戻り値: 手札に加えたら true
function _secDigimonToZone(sec, owner, useOnlineFlag) {
  const onlineRTH = useOnlineFlag && window._lastSecEffectReturnToHand === true;
  if (useOnlineFlag) window._lastSecEffectReturnToHand = false;
  const toHand = !!sec._returnToHand || onlineRTH;
  delete sec._returnToHand;
  (toHand ? owner.hand : owner.trash).push(sec);
  if (toHand) addLog('🃏 「' + sec.name + '」を手札に加えた');
  return toHand;
}
// 演出: 負けたなら「LOSE」を見せてから、セキュリティ → トラッシュ（手札に加えるなら手札）への移動演出。消滅演出は出さない
// ownerSide: セキュリティの持ち主（'ai'＝相手 / 'player'＝自分）。opts.remote: 相手から受信した演出（送り返さない）
export function showSecurityDigimonLeave(sec, lost, toHand, ownerSide, callback, opts) {
  opts = opts || {};
  if (_clashPending && _clashSideOf(sec)) { (opts.remote ? _clashFinish : _clashFinishSync)(lost ? '' : '回避', () => showSecurityDigimonLeave(sec, lost, toHand, ownerSide, callback, opts)); return; }
  if (!opts.remote && _onlineMode && _sendCommand && !window._suppressFxSend) {
    _sendCommand({ type: 'fx_secDigimonLeave', cardName: sec.name || '', cardNo: sec.cardNo || '', cardImg: cardImg(sec) || '', lost: !!lost, toHand: !!toHand, ownerSide: ownerSide === 'ai' ? 'player' : 'ai' });
  }
  const pre = ownerSide === 'ai' ? '相手の' : '';
  // バトルのぶつかり合い演出で吹き飛ばしてトラッシュに送ったなら、LOSE と移動演出を重ねない
  if (lost && !toHand && consumeClashLoser(sec)) { callback && callback(); return; }
  const move = () => {
    if (typeof window._fxCardMove === 'function') window._fxCardMove(sec, pre + 'セキュリティ', pre + (toHand ? '手札' : 'トラッシュ'), callback);
    else callback && callback();
  };
  if (!lost) { move(); return; }
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:66000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;pointer-events:none;';
  const src = cardImg(sec);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'width:120px;border-radius:8px;filter:grayscale(0.7) brightness(0.8);';
    ov.appendChild(img);
  }
  const t = document.createElement('div');
  t.style.cssText = 'font-size:clamp(2.2rem,11vw,3.6rem);font-weight:900;color:#ff4444;letter-spacing:6px;text-shadow:0 0 20px #ff4444,0 0 40px #ff4444;';
  t.innerText = 'LOSE';
  ov.appendChild(t);
  const sub = document.createElement('div');
  sub.style.cssText = 'color:#ddd;font-size:13px;text-align:center;padding:0 16px;';
  sub.innerText = '「' + (sec.name || '') + '」はバトルに負けた（セキュリティデジモンは消滅しない）';
  ov.appendChild(sub);
  document.body.appendChild(ov);
  setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); move(); }, 1300);
}
if (typeof window !== 'undefined') window._showSecurityDigimonLeave = showSecurityDigimonLeave;

// ----- 消滅演出 -----

export function showDestroyEffect(card, callback) {
  // VS画面の押し合い中・効果での消滅回避（稲妻）の判定中に消滅したカード（【スケープゴート】の身代わり）は、
  // 決着・稲妻の演出で見せるので、消滅演出を重ねない
  if (typeof window !== 'undefined' && window._fxMoveHold > 0 && !(_clashPending && _clashSideOf(card))) {
    if (_onlineMode && _sendCommand && !window._suppressFxSend && card && !card._remoteFx) { /* 相手の画面も同じ演出が出るので送らない */ }
    callback && callback(); return;
  }
  if (_clashPending && _clashSideOf(card)) { (card && card._remoteFx ? _clashFinish : _clashFinishSync)('', () => showDestroyEffect(card, callback)); return; }
  // 1つの効果でまとめて消滅させている間（window._destroyFxBatch）は1体ずつの演出を出さず、
  // 最後に「以下のN体が消滅」の一括演出（showDestroyBatch）で見せる
  // まとめるのはこの画面で実際に場から消滅したカードだけ（相手の画面から届いた演出＝_remoteFx の仮カードや、
  // カードNoを持たない仮カードは含めない。相手の画面の分まで合計して、相手のカードがこちらの一覧に出ていた）
  const _batch = (typeof window !== 'undefined') ? window._destroyFxBatch : null;
  if (_batch && card && !card._remoteFx && card.cardNo) { _batch.gone.push(card); callback && callback(); return; }
  if (_onlineMode && _sendCommand && !window._suppressFxSend) _sendCommand({ type: 'fx_destroy', cardName: card.name, cardImg: cardImg(card) });
  // バトルのぶつかり合い演出で吹き飛ばしてトラッシュに送ったカードは、消滅演出を重ねない
  if (consumeClashLoser(card)) { callback && callback(); return; }
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
  // 勝敗が決まったら、オンライン対戦の再接続の見張り（相手の接続待ちの表示）と端末の保存をやめる
  // （相手が先に結果を閉じてルームを消すと、こちらの結果画面の上に「相手がルームを退出しました」が出ないように）
  try { if (window._onlineResume) window._onlineResume.onBattleEnded(); } catch (_) {}
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
  _aiCarryEvolveState(evo, base);
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
  _aiCarryEvolveState(evo, base);
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
  atk.suspended = true; _markRuleRest(atk);
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
                blocker.suspended = true; _markRuleRest(blocker);
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
                    blocker.suspended = true; _markRuleRest(blocker);
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
