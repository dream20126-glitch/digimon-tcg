/**
 * battle-combat.js — 戦闘システム
 *
 * カード登場・進化・アタック・ブロック・セキュリティチェック・勝敗判定
 * AI戦闘ロジック・戦闘演出を含む
 */

import { bs, spendMemory, addMemory, isMemoryOverflow, drawCards, placeOnBattleArea, removeFromBattleArea, destroyCard, MEM_MIN, MEM_MAX } from './battle-state.js';
import { addLog, showOverlay, removeOverlay, showConfirm, showToast, showScreen } from './battle-ui.js';
import { renderAll, renderHand, updateMemGauge, updatePhaseBadge, cardImg } from './battle-render.js';
import { showYourTurn, showPhaseAnnounce, doDraw, aiTurn, exitBreedPhase, checkAutoTurnEnd, setPhaseHooks } from './battle-phase.js';
import { expireBuffs as _expireBuffs, applyPermanentEffects as _applyPermanent, triggerEffect as _triggerEffect, fireOnDestroyTriggers as _fireOnDestroy, fireOnBattleDestroyTriggers as _fireOnBattleDestroy, fireWhenOppRestTriggers as _fireWhenOppRest, fireWhenOwnBlockTriggers as _fireWhenOwnBlock, fireWhenOwnDestroyedTriggers as _fireWhenOwnDestroyed, hasRecipeTrigger as _hasRecipeTrigger, hasEvoStackTrigger as _hasEvoStackTrigger } from './effect-engine.js';

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
      '【メイン】': 'main',
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
function fireOppRestThen(restedOwnerSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenOppRest(restedOwnerSide, bs, ctxBase, () => cb && cb()); }
  catch (_) { cb && cb(); }
}

// ブロック専用: blocker のオーナー側のテイマー/デジモンを反応させる
function fireOwnBlockThen(blockOwnerSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenOwnBlock(blockOwnerSide, bs, ctxBase, () => cb && cb()); }
  catch (_) { cb && cb(); }
}

// ブロック発生時の総合反応: 反対側の when_opp_rest + ブロッカー所有側の when_own_block を順次発火
function fireBlockReactionThen(blockerSide, cb) {
  fireOppRestThen(blockerSide, () => fireOwnBlockThen(blockerSide, cb));
}

// 自分のデジモンが消滅したとき: destroyed のオーナー側のテイマー/デジモンを反応させる
function fireOwnDestroyedThen(destroyedSide, cb) {
  const ctxBase = { bs, addLog, renderAll, updateMemGauge };
  try { _fireWhenOwnDestroyed(destroyedSide, bs, ctxBase, () => cb && cb()); }
  catch (_) { cb && cb(); }
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
  if (c.buffs && c.buffs.some(b => b.type === 'keyword_' + flagName)) return true;
  const passiveContains = (arr) => Array.isArray(arr) && arr.some(p => (p && (p.flag === flagName || p === flagName)));
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
function _tryCancelDestroy(card, ownerSidePlayer, onlyBattle) {
  if (!card || !ownerSidePlayer) return null;
  // 防壁（バトル消滅時、自セキュリティ1枚破棄で回避）
  if (hasBarrier(card) && ownerSidePlayer.security && ownerSidePlayer.security.length > 0) {
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
  // フラグメント（消滅時、進化元を破棄することで消滅回避）
  if (_tryFragment(card, ownerSidePlayer)) {
    return { canceled: true, reason: 'fragment' };
  }
  return null;
}
// ≪連携≫の処理: アタック時、他のアクティブデジモン1体をレストさせて
// このターン DP+(対象DP) と Sアタック+1 を一時付与する (公式 18-24)
function _tryCombo(atk, ownerSidePlayer) {
  if (!atk || !hasCombo(atk) || !ownerSidePlayer) return false;
  var others = [];
  for (var i = 0; i < ownerSidePlayer.battleArea.length; i++) {
    var c = ownerSidePlayer.battleArea[i];
    if (c && c !== atk && !c.suspended) others.push(c);
  }
  if (others.length === 0) return false;
  var target = others[0];
  target.suspended = true;
  var addedDp = parseInt(target.dp) || 0;
  if (!atk.buffs) atk.buffs = [];
  atk.buffs.push({ type: 'dp_plus', value: addedDp, duration: 'dur_this_turn', source: 'combo' });
  atk.buffs.push({ type: 'security_attack_plus', value: 1, duration: 'dur_this_turn', source: 'combo' });
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
    addLog('🛡 【スケープゴート】「' + destroyTarget.name + '」が「' + c.name + '」を身代わりにして回避');
    return true;
  }
  return false;
}

// ≪フラグメント≫の処理: 自身が消滅するとき、進化元を選んでN枚破棄することで消滅しない
// 簡易実装: 上から N 枚（指定値、なければ 1）破棄。0枚なら回避不可
function _tryFragment(destroyTarget, ownerSidePlayer) {
  if (!destroyTarget || !ownerSidePlayer || !hasFragment(destroyTarget)) return false;
  var stack = destroyTarget.stack || [];
  if (stack.length === 0) return false;
  // フラグメントN: passive.flag='fragment' の value（または 1）枚破棄
  var n = 1;
  try {
    var pe = destroyTarget._permEffects;
    if (pe && pe.fragmentValue) n = pe.fragmentValue;
  } catch(_) {}
  if (n > stack.length) n = stack.length;
  for (var i = 0; i < n; i++) {
    var s = stack.shift();
    if (s) ownerSidePlayer.trash.push(s);
  }
  addLog('🛡 【フラグメント】「' + destroyTarget.name + '」が進化元 ' + n + ' 枚を破棄して消滅回避');
  return true;
}
function hasFragment(c) { return hasPassiveFlag(c, 'fragment', '【フラグメント】'); }

// その他キーワード判定（フェーズ1〜2 実装分）
function hasRush(c)         { return hasPassiveFlag(c, 'rush', '【速攻】'); }
function hasPiercing(c)     { return hasPassiveFlag(c, 'piercing', '【突進】'); }
function hasJamming(c)      { return hasPassiveFlag(c, 'jamming', '【ジャミング】'); }
function hasCharge(c)       { return hasPassiveFlag(c, 'charge', '【進撃】'); }
function hasCollision(c)    { return hasPassiveFlag(c, 'collision', '【衝突】'); }
function hasEvade(c)        { return hasPassiveFlag(c, 'evade', '【回避】'); }
function hasBarrier(c)      { return hasPassiveFlag(c, 'barrier', '【防壁】'); }
function hasArmorBreak(c)   { return hasPassiveFlag(c, 'armor_break', '【アーマー解除】'); }
function hasIndomitable(c)  { return hasPassiveFlag(c, 'indomitable', '【不屈】'); }
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
  document.body.appendChild(overlay);
  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback && callback();
  }, 1200);
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
  document.body.appendChild(overlay);
  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback && callback();
  }, 1400);
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
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'own_card_removed', slotIdx, reason: reason || 'destroy' });
}

// ===== 進化条件チェック =====

export function canEvolveOnto(evoCard, baseCard) {
  const cond = evoCard.evolveCond || '';
  if (!cond || cond === 'なし' || cond === '') return false;
  const conditions = cond.split('/').map(s => s.trim());
  for (const c of conditions) {
    const m = c.match(/([赤青黄緑黒紫白]+)?Lv\.(\d+)/);
    if (m) {
      const reqColor = m[1] || '';
      const reqLevel = m[2];
      // baseCard.level にスプレッドシート由来の前後空白（全角スペース含む）が
      // 混入していると文字列比較が外れるため trim で正規化する
      const baseLevel = String(baseCard.level).trim();
      const baseColor = baseCard.color || '';
      if (baseLevel !== reqLevel) continue;
      if (reqColor && !baseColor.includes(reqColor)) continue;
      const nameMatch = c.match(/「(.+?)」/);
      if (nameMatch) {
        const reqName = nameMatch[1];
        const hasName = baseCard.name.includes(reqName) ||
          (baseCard.stack && baseCard.stack.some(s => s.name.includes(reqName)));
        if (!hasName) continue;
      }
      return true;
    }
  }
  return false;
}

// 保留中の進化コスト軽減（スマッシュポテト等）を消費して合計軽減値を返す。
// bs._pendingEvoCostReductions の各エントリは color / baseLv / evoLv の記述子で
// 「どの進化に適用されるか」を絞る。once のものは消費して除去する。
function _consumePendingEvoCostReduction(evolved, base) {
  if (!bs || !Array.isArray(bs._pendingEvoCostReductions) || bs._pendingEvoCostReductions.length === 0) return 0;
  const evColor = evolved.color || '';
  const evLv = parseInt(String(evolved.level), 10) || 0;
  const baseLv = base ? (parseInt(String(base.level), 10) || 0) : 0;
  let total = 0;
  bs._pendingEvoCostReductions.forEach(r => {
    if (!r || r._used) return;
    if (r.side && r.side !== 'player') return;
    if (r.color && !evColor.includes(r.color)) return;
    if (r.baseLv != null && r.baseLv !== baseLv) return;
    if (r.evoLv != null && r.evoLv !== evLv) return;
    total += r.value || 0;
    if (r.once) r._used = true;
  });
  bs._pendingEvoCostReductions = bs._pendingEvoCostReductions.filter(r => r && !r._used);
  return total;
}

// ===== カード登場 =====

export function doPlay(card, handIdx, slotIdx) {
  console.log('[doPlay] card=' + (card && card.name) + ' type=' + (card && card.type) + ' phase=' + bs.phase + ' attackInProgress=' + _attackInProgress);
  if (bs.phase !== 'main') { console.log('[doPlay] skip: phase != main'); return; }
  if (_attackInProgress) { console.log('[doPlay] skip: attack in progress'); return; }
  if (card.level === '2') { addLog('🚨 デジタマはバトルエリアに出せません'); return; }
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'play', handIdx, slotIdx, cardName: card.name, cardType: card.type, cardImg: card.imgSrc || '', playCost: card.playCost || 0 });
  if (card.playCost === null) { addLog('🚨 「' + card.name + '」は進化専用カードです'); return; }

  // ----- オプションカード -----
  if (card.type === 'オプション') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    addLog('✦ 「' + card.name + '」を使用！（コスト ' + card.playCost + '）');
    if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
      try { window._tutorialHideInstruction(); } catch (e) {}
    }
    renderAll();
    showOptionEffect(card, async () => {
      // ★ 公式ルール: コスト支払い → 効果処理 → ターン終了判定
      playerSpendMemory(card.playCost, true); // defer=true
      // チュートリアル進行通知 → PERFECT/GREAT を先に流してから割り込み(説明等)へ
      if (window._tutorialRunner && window._tutorialRunner.active) {
        try { window._tutorialRunner.notifyEvent('play', { cardNo: card.cardNo, cardName: card.name, targetCardNo: card.cardNo, side: 'player' }); } catch (e) {}
      }
      if (window._tutorialFlushSuccess) await window._tutorialFlushSuccess();
      if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play_cost');
      _hooks.checkAndTriggerEffect(card, '【メイン】', async () => {
        bs.player.trash.push(card);
        addLog('✦ 「' + card.name + '」をトラッシュへ');
        renderAll();
        // 割り込み2: 効果完了後（after_play / after_use_effect 両方発火）
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('play');
        if (window._tutorialInterruptAfter) await window._tutorialInterruptAfter('use_effect');
        if (window._tutorialBattleDone) window._tutorialBattleDone();
        checkPlayerPendingTurnEnd();
      }, 'player');
    });
    return;
  }

  // ----- テイマー登場 -----
  if (card.type === 'テイマー') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    bs.player.tamerArea.push(card);
    addLog('▶ 「' + card.name + '」を登場！（コスト ' + card.playCost + '）');
    if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
      try { window._tutorialHideInstruction(); } catch (e) {}
    }
    renderAll();
    showPlayEffect(card, async () => {
      // ★ 公式ルール: コスト支払い → 登場時効果 → ターン終了判定
      playerSpendMemory(card.playCost, true); // defer=true
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
  card.summonedThisTurn = true;
  while (bs.player.battleArea.length <= slotIdx) bs.player.battleArea.push(null);
  bs.player.battleArea[slotIdx] = card;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  addLog('▶ 「' + card.name + '」を登場！（コスト ' + card.playCost + '）');
  if (window._tutorialRunner && window._tutorialRunner.active && window._tutorialHideInstruction) {
    try { window._tutorialHideInstruction(); } catch (e) {}
  }
  renderAll();
  showPlayEffect(card, async () => {
    _hooks.applyPermanentEffects('player');
    renderAll(true);
    // ★ 公式ルール: コスト支払い(メモリー消費) → 登場時効果 → ターン終了判定
    playerSpendMemory(card.playCost, true); // defer=true: ターン終了は保留
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

export function doEvolve(card, handIdx, slotIdx) {
  if (bs.phase !== 'main') return;
  if (_attackInProgress) return;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'evolve', handIdx, slotIdx, cardName: card.name, baseName: bs.player.battleArea[slotIdx]?.name || '', cardImg: card.imgSrc || '', evolveCost: card.evolveCost || 0 });
  const base = bs.player.battleArea[slotIdx];
  if (!base) return;
  if (card.evolveCost === null) { addLog('🚨 「' + card.name + '」は進化できません‼'); return; }
  if (!canEvolveOnto(card, base)) { addLog('🚨 進化条件を満たしていません‼（' + card.evolveCond + '）'); return; }

  let cost = card.evolveCost;
  const _evoDisc = _consumePendingEvoCostReduction(card, base);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  const evolved = Object.assign({}, card, {
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [],
    dpModifier: base.dpModifier || 0,
    stack: [base].concat(base.stack || []),
  });
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  bs.player.battleArea[slotIdx] = evolved;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  // cond_evolved_this_turn 用カウンタを増加
  bs._evolveCountThisTurn = (bs._evolveCountThisTurn || 0) + 1;
  addLog('⬆ 「' + base.name + '」→「' + evolved.name + '」進化！（コスト ' + cost + '）');
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

// ===== 育成エリア進化 =====

export function doEvolveIku(card, handIdx) {
  if (bs.phase !== 'main') return;
  if (_attackInProgress) return;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'breed_evolve', handIdx, cardName: card.name, baseName: bs.player.ikusei?.name || '', cardImg: card.imgSrc || '', evolveCost: card.evolveCost || 0 });
  const base = bs.player.ikusei;
  if (!base) return;
  if (card.evolveCost === null) { addLog('🚨 「' + card.name + '」は進化できません‼'); return; }
  if (!canEvolveOnto(card, base)) { addLog('🚨 進化条件を満たしていません‼（' + card.evolveCond + '）'); return; }

  let cost = card.evolveCost;
  const _evoDisc = _consumePendingEvoCostReduction(card, base);
  if (_evoDisc > 0) { cost = Math.max(0, cost - _evoDisc); addLog('💠 進化コスト-' + _evoDisc + '（コスト' + cost + 'で進化）'); }
  const evolved = Object.assign({}, card, {
    suspended: base.suspended,
    summonedThisTurn: base.summonedThisTurn,
    buffs: base.buffs || [],
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
      return true;
    }
    checkAutoTurnEnd();
    return true;
  }
  return false;
}

// 効果処理完了後、保留中のターン終了判定を実行
function checkPlayerPendingTurnEnd() {
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

export function startAttack(card, slotIdx) {
  // ≪進撃≫: メモリーが相手側のとき（bs.memory < 0）でも進撃持ちならアタック可（公式ルール 18-16）
  var chargeAllowed = card && hasCharge(card) && bs.memory < 0;
  if (bs.phase !== 'main' && !chargeAllowed) return false;
  if (!card) return false;
  if (_attackInProgress) return false;
  if (chargeAllowed) addLog('⚔ 【進撃】「' + card.name + '」がメモリー相手側でアタック宣言');
  // suspended チェックは行わない（長押しメニューで既にレスト済み）
  if (card.cantAttack) return false;

  card.suspended = true;
  card._attackedOnTurn = bs.turn; // cond_self_attacked 用（このターンにアタックしたか）
  bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
  _atkState = { card, slotIdx };
  addLog('⚔ 「' + card.name + '」でアタック！');
  // ≪連携≫: アタック時に他デジモンレストでバフ（自動発動・他に対象なければスキップ）
  _tryCombo(card, bs.player);
  renderAll();
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'attack_start', atkIdx: slotIdx, atkName: card.name, atkDp: card.dp, atkImg: cardImg(card) });
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

// ===== アタック解決 =====

export function resolveAttackTarget(target, targetIdx) {
  if (!_atkState) { console.warn('[resolveAttackTarget] _atkState is null'); return; }
  _attackInProgress = true;
  console.log('[resolveAttackTarget]', target, targetIdx, '_atkState:', _atkState.card?.name);
  // 前回のブロック応答をクリア
  if (window._clearPendingBlock) window._clearPendingBlock();
  const atk = _atkState.card;
  const atkSlotIdx = _atkState.slotIdx;
  _atkState = null;

  // アタック対象タイプを bs に記録（cond_attack_target_digimon で参照）
  bs._lastAttackTarget = target;

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
          if (blockerIdx >= 0 || !c || c.suspended) return;
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
          afterAtkEffect(atk, atkSlotIdx, () => {
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
      afterAtkEffect(atk, atkSlotIdx, () => {
        // 効果処理完了 → このタイミングで attack_security を送る
        _sendCommand({ type: 'attack_security', atkIdx: atkSlotIdx, atkName: atk.name, atkDp: atk.dp, atkBaseDp: atk.baseDp != null ? atk.baseDp : atk.dp, atkImg: cardImg(atk), atkCantBeBlocked: !!(atk._permEffects && atk._permEffects.cantBeBlocked), atkCantBeBlockedByNoEvo: !!(atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo) });
        if (typeof window._waitForBlockResponse === 'function') {
          window._waitForBlockResponse((resp) => {
            if (!resp.blocked) {
              resolveSecurityCheck(atk, atkSlotIdx);
            } else {
              // ブロックされた時効果を発動 → 完了シグナル送信
              afterBlockedEffect(atk, atkSlotIdx, 'player', () => {
                if (_onlineMode && _sendCommand) _sendCommand({ type: 'blocked_effect_done' });
                renderAll();
                checkPendingTurnEnd();
              });
            }
          });
        } else { resolveSecurityCheck(atk, atkSlotIdx); }
      });
    } else {
      afterAtkEffect(atk, atkSlotIdx, () => resolveSecurityCheck(atk, atkSlotIdx));
    }
  } else if (target === 'digimon') {
    // デジモンアタック
    const def = bs.ai.battleArea[targetIdx];
    if (!def) { cancelAttack(); return; }
    // 「アクティブ状態のデジモンにもアタックできる」は突進(piercing)で判定
    const canHitActive = hasPiercing(atk);
    if (!def.suspended && !canHitActive) {
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
          if (blockerIdx >= 0 || !c || c.suspended) return;
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
          afterAtkEffect(atk, atkSlotIdx, () => {
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
      afterAtkEffect(atk, atkSlotIdx, () => {
        _sendCommand({ type: 'attack_digimon', atkIdx: atkSlotIdx, defIdx: targetIdx, atkName: atk.name, defName: def.name, atkDp: atk.dp, atkBaseDp: atk.baseDp != null ? atk.baseDp : atk.dp, atkImg: cardImg(atk), atkCantBeBlocked: !!(atk._permEffects && atk._permEffects.cantBeBlocked), atkCantBeBlockedByNoEvo: !!(atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo) });
        if (typeof window._waitForBlockResponse === 'function') {
          window._waitForBlockResponse((resp) => {
            if (!resp.blocked) {
              resolveBattle(atk, atkSlotIdx, def, targetIdx, 'ai');
            } else {
              // ブロックされた時効果を発動 → 完了シグナル送信 → P2側でバトル解決開始
              afterBlockedEffect(atk, atkSlotIdx, 'player', () => {
                if (_onlineMode && _sendCommand) _sendCommand({ type: 'blocked_effect_done' });
                renderAll();
                checkPendingTurnEnd();
              });
            }
          });
        } else { resolveBattle(atk, atkSlotIdx, def, targetIdx, 'ai'); }
      });
    } else {
      afterAtkEffect(atk, atkSlotIdx, () => resolveBattle(atk, atkSlotIdx, def, targetIdx, 'ai'));
    }
  }
}

// アタック時効果
// 常にスキャンする（アタッカー自身に【アタック時】が無くても、付与効果
// (ヘブンズリッパー等)や他カードの誘発を拾うため。効果が無ければ即 callback）
function afterAtkEffect(atk, atkSlotIdx, callback) {
  _hooks.checkAndTriggerEffect(atk, '【アタック時】', callback);
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
function checkAttackEnd(atk, atkIdx) {
  if (hasKeyword(atk, '【アタック終了時】') && bs.player.battleArea[atkIdx]) {
    _hooks.checkAndTriggerEffect(atk, '【アタック終了時】', () => checkPendingTurnEnd());
  } else { checkPendingTurnEnd(); }
}

// ===== セキュリティチェック =====

export function resolveSecurityCheck(atk, atkIdx) {
  showCombatBackdrop();
  const totalChecks = getSecurityAttackCount(atk);
  let checksRemaining = totalChecks;
  let checkNumber = 0;
  if (totalChecks > 1) addLog('⚔ セキュリティチェック x' + totalChecks + '！');
  if (totalChecks === 0) addLog('🛡 「' + atk.name + '」のセキュリティチェック数が0のため、セキュリティをチェックしません');

  function startChecks() {
    if (totalChecks === 0) {
      // SA- で0回チェック → セキュリティを1枚も捲らずアタック終了
      hideCombatBackdrop();
      checkAttackEnd(atk, atkIdx);
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

    showSecurityCheck(sec, atk, () => {
      // ----- セキュリティがデジモン -----
      if (sec.type === 'デジモン') {
        if (atk.dp === sec.dp) {
          bs.ai.trash.push(sec);
          removeOwnCard(atkIdx, 'destroy');
          renderAll(); _dispatchStateSync();
          showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => {
            showDestroyEffect(sec, () => { showDestroyEffect(atk, () => {
              addLog('💥 両者消滅！'); _dispatchStateSync();
              // 演出完了 → on_destroy リアクション完了 → ターンエンド
              try {
                _fireOnDestroy('player', bs, { bs, addLog, renderAll, updateMemGauge }, () => {
                  checkPendingTurnEnd();
                });
              } catch(_) { checkPendingTurnEnd(); }
            }); });
          }, '両者消滅', '#ff4444');
        } else if (atk.dp > sec.dp) {
          bs.ai.trash.push(sec); renderAll(); _dispatchStateSync();
          showBattleResult('Win!!', '#00ff88', 'セキュリティ突破！', () => {
            showDestroyEffect(sec, () => {
              addLog('✓ セキュリティ突破');
              if (bs.ai.security.length <= 0) {
                addLog('🛡 相手のセキュリティが0枚になった');
                checkAttackEnd(atk, atkIdx);
              } else if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
              else { checkAttackEnd(atk, atkIdx); }
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
          // ≪回避≫/≪アーマー解除≫もここで判定
          var cancelAtkInSec = _tryCancelDestroy(atk, bs.player, false);
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
          showBattleResult('Lost...', '#ff4444', '「' + atk.name + '」が撃破された', () => {
            showDestroyEffect(atk, () => {
              addLog('✗ セキュリティに敗北'); _dispatchStateSync();
              try {
                _fireOnDestroy('player', bs, { bs, addLog, renderAll, updateMemGauge }, () => {
                  checkPendingTurnEnd();
                });
              } catch(_) { checkPendingTurnEnd(); }
            });
          }, 'Win!!', '#00ff88');
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
        if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
        else { checkAttackEnd(atk, atkIdx); }
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
            } else {
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
    });
  }
}
// 貫通効果のオンライン処理用: ブロック解決(防御側)から攻撃側へ追加セキュリティチェックを依頼するため公開
if (typeof window !== 'undefined') window._resolveSecurityCheck = resolveSecurityCheck;

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
  if (!buffs || buffs.length === 0 || sec.type !== 'デジモン') return;
  if (sec._origDp === undefined) sec._origDp = parseInt(sec.dp) || 0;
  let bonus = 0;
  buffs.forEach(b => {
    if (b.owner && b.owner !== ownerSide) return;
    if (b.type === 'dp_plus') bonus += (parseInt(b.value) || 0);
    if (b.type === 'dp_minus') bonus -= (parseInt(b.value) || 0);
  });
  if (bonus !== 0) {
    sec.dp = sec._origDp + bonus;
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
function _fireDestroyChain(sides, done, destroyedCardsBySide) {
  let i = 0;
  function next() {
    if (i >= sides.length) { done && done(); return; }
    const s = sides[i++];
    const ctxBase = { bs, addLog, renderAll, updateMemGauge };
    const destroyedCard = destroyedCardsBySide && destroyedCardsBySide[s];
    try {
      _fireOnDestroy(s, bs, ctxBase, () => {
        try {
          _fireOnBattleDestroy(s, bs, ctxBase, () => {
            // 自分のデジモンが消滅したとき（同 side のテイマー/デジモンが反応）
            try { _fireWhenOwnDestroyed(s, bs, ctxBase, next); } catch (_) { next(); }
          }, destroyedCard);
        } catch (_) { next(); }
      }, destroyedCard);
    } catch (_) { next(); }
  }
  next();
}

export function resolveBattle(atk, atkIdx, def, defIdx, defSide) {
  showCombatBackdrop();
  const battleBuffs = applyBattleBuffs(atk, def);
  addLog('⚔ 「' + atk.name + '」(DP ' + formatDpDisplay(atk) + ') vs 「' + def.name + '」(DP ' + formatDpDisplay(def) + ')');

  function destroyDef() {
    if (defSide === 'ai') {
      bs.ai.battleArea[defIdx] = null;
      bs.ai.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.ai.trash.push(s));
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
    if (_atkDp === _defDp) {
      destroyDef(); destroyAtk(); renderAll();
      showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => {
        showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
          addLog('💥 両者消滅！'); renderAll();
          // ターンプレイヤー（player）側の reactions を先 → 'ai' destroyed が reactSide='player'
          _fireDestroyChain(['ai', 'player'], () => checkPendingTurnEnd(), { ai: def, player: atk });
        }); });
      }, '両者消滅', '#ff4444');
    } else if (_atkDp > _defDp) {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫: def 側の消滅回避を試行
      var cancelDef = _tryCancelDestroy(def, bs.ai, false);
      if (cancelDef) {
        renderAll();
        showBattleResult('回避！', '#ff00fb', '相手「' + def.name + '」が消滅を回避', () => { renderAll(); checkAttackEnd(atk, atkIdx); }, 'Lost...', '#ff4444');
        return;
      }
      destroyDef(); renderAll();
      showBattleResult('Win!!', '#00ff88', '「' + def.name + '」を撃破！', () => {
        showDestroyEffect(def, () => {
          addLog('💥 「' + def.name + '」を撃破！'); renderAll();
          _fireDestroyChain(['ai'], () => {
            // バトル勝利トリガー（atk が生存・def 消滅）
            bs._lastBattleWinner = atk;
            const winCtx = _hooks.makeEffectContext(atk, 'player');
            _hooks.triggerEffect('on_battle_win', atk, 'player', winCtx, () => {
              bs._lastBattleWinner = null;
              // ≪衝突≫: アタックで相手デジモン撃破 → 自身も消滅 (公式 18-30 推定: 相互道連れ)
              if (hasCollision(atk)) {
                addLog('💥 【衝突】「' + atk.name + '」が相手撃破とともに消滅！');
                bs.player.battleArea[atkIdx] = null;
                bs.player.trash.push(atk);
                if (atk.stack) atk.stack.forEach(function(s){ bs.player.trash.push(s); });
                renderAll();
                showDestroyEffect(atk, function() {
                  _fireDestroyChain(['player'], function() { checkPendingTurnEnd(); }, { player: atk });
                });
                return;
              }
              // ≪貫通≫: アタックで相手デジモン撃破 → アタック終了直前に追加セキュリティチェック
              if (hasPenetrate(atk)) {
                addLog('🗡 「' + atk.name + '」の【貫通】効果でセキュリティチェック！');
                showPenetrateAnnounce(() => {
                  resolveSecurityCheck(atk, atkIdx);
                });
              } else {
                checkAttackEnd(atk, atkIdx);
              }
            });
          }, { ai: def });
        });
      }, 'Lose...', '#ff4444');
    } else {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫: 消滅回避を試行
      var cancelResult = _tryCancelDestroy(atk, bs.player, false);
      if (cancelResult) {
        renderAll();
        showBattleResult('回避！', '#00fbff', '「' + atk.name + '」が消滅を回避', () => { renderAll(); checkAttackEnd(atk, atkIdx); }, 'Win!!', '#00ff88');
        return;
      }
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
            renderAll();
            // 巻き込まれた相手 (def) の消滅前に「道連れ」演出を挟む
            showMichizureAnnounce(() => {
              showDestroyEffect(def, () => {
                _fireDestroyChain(['player', 'ai'], () => checkPendingTurnEnd(), { player: atk, ai: def });
              });
            });
            return;
          }
          _fireDestroyChain(['player'], () => checkPendingTurnEnd(), { player: atk });
        });
      }, 'Win!!', '#00ff88');
    }
  }, 'BATTLE!');
}

// ===== バトル解決（AI → プレイヤー ブロッカー戦） =====

export function resolveBattleAI(atk, atkIdx, def, defIdx, callback) {
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
    if (_atkDp === _defDp) {
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
      if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
      renderAll();
      showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
        // ターンプレイヤー（ai）側の reactions を先 → 'player' destroyed が reactSide='ai'
        _fireDestroyChain(['player', 'ai'], () => {
          showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => { addLog('💥 両者消滅！'); renderAll(); callback(); }, '両者消滅', '#ff4444');
        }, { player: def, ai: atk });
      }); });
    } else if (_atkDp > _defDp) {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫: プレイヤー側 def の消滅回避を試行
      var cancelPlayerDef = _tryCancelDestroy(def, bs.player, false);
      if (cancelPlayerDef) {
        renderAll();
        showBattleResult('回避！', '#00fbff', '「' + def.name + '」が消滅を回避', () => { renderAll(); callback(); }, '回避！', '#00fbff');
        return;
      }
      bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
      renderAll();
      showDestroyEffect(def, () => {
        _fireDestroyChain(['player'], () => {
          // AI が attacker として勝利 → on_battle_win on atk (AI side)
          bs._lastBattleWinner = atk;
          const winCtx = _hooks.makeEffectContext(atk, 'ai');
          _hooks.triggerEffect('on_battle_win', atk, 'ai', winCtx, () => {
            bs._lastBattleWinner = null;
            // ≪衝突≫: AI アタッカーが撃破したら自身も消滅
            if (hasCollision(atk)) {
              addLog('💥 【衝突】相手「' + atk.name + '」が撃破とともに消滅！');
              bs.ai.battleArea[atkIdx] = null;
              bs.ai.trash.push(atk);
              if (atk.stack) atk.stack.forEach(function(s){ bs.ai.trash.push(s); });
              renderAll();
              showDestroyEffect(atk, function() {
                _fireDestroyChain(['ai'], function() {
                  showBattleResult('両者消滅', '#ff4444', '衝突で両者消滅', function() { renderAll(); callback(); }, '両者消滅', '#ff4444');
                }, { ai: atk });
              });
              return;
            }
            // ≪貫通≫: AI アタッカーが撃破したら追加セキュリティチェック
            if (hasPenetrate(atk)) {
              addLog('🗡 [AI] 「' + atk.name + '」の【貫通】効果でセキュリティチェック！');
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された', () => {
                addLog('💥 「' + def.name + '」が撃破された'); renderAll();
                showPenetrateAnnounce(() => {
                  doAiSecurityCheck(atk, atkIdx, callback);
                });
              }, 'Win!!', '#00ff88');
            } else {
              showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された', () => { addLog('💥 「' + def.name + '」が撃破された'); renderAll(); callback(); }, 'Win!!', '#00ff88');
            }
          });
        }, { player: def });
      });
    } else {
      // ≪防壁≫/≪回避≫/≪アーマー解除≫: AI 側 atk の消滅回避を試行
      var cancelAiAtk = _tryCancelDestroy(atk, bs.ai, false);
      if (cancelAiAtk) {
        renderAll();
        showBattleResult('回避！', '#ff00fb', '相手「' + atk.name + '」が消滅を回避', () => { renderAll(); callback(); }, '回避！', '#ff00fb');
        return;
      }
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
      if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      renderAll();
      // ≪道連れ≫: AI のアタッカーが消滅したとき、防御側 (player の def) も巻き込む
      if (hasMichizure(atk) && def && bs.player.battleArea.indexOf(def) >= 0) {
        const defIdx2 = bs.player.battleArea.indexOf(def);
        bs.player.battleArea[defIdx2] = null;
        bs.player.trash.push(def);
        if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
        addLog('💀 【道連れ】「' + atk.name + '」が「' + def.name + '」を巻き込んで消滅！');
        renderAll();
        showDestroyEffect(atk, () => {
          // 巻き込まれた def の消滅前に「道連れ」演出
          showMichizureAnnounce(() => {
            showDestroyEffect(def, () => {
              _fireDestroyChain(['ai', 'player'], () => {
                showBattleResult('両者消滅', '#ff4444', '両者消滅（道連れ）！', () => { renderAll(); callback(); }, '両者消滅', '#ff4444');
              }, { ai: atk, player: def });
            });
          });
        });
        return;
      }
      showDestroyEffect(atk, () => {
        _fireDestroyChain(['ai'], () => {
          // 防御側 (def, player) が atk を撃破して生存 → on_battle_win on def
          bs._lastBattleWinner = def;
          const winCtx = _hooks.makeEffectContext(def, 'player');
          _hooks.triggerEffect('on_battle_win', def, 'player', winCtx, () => {
            bs._lastBattleWinner = null;
            showBattleResult('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => { addLog('💥 「' + atk.name + '」を撃破！'); renderAll(); callback(); }, 'Lost...', '#ff4444');
          });
        }, { ai: atk });
      });
    }
  }, 'BATTLE!');
}

// ===== ブロック確認UI =====

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
  if (card.evolveCost != null) {
    const _cond = (card.evolveCond || '').trim();
    const _condEsc = _cond.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    _statsHtml += '<br><span style="color:#00ff88;">進化コスト：' + (_cond ? _condEsc + 'から' : '') + card.evolveCost + '</span>';
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
      + '<div style="color:#ffaa00;font-size:10px;margin-bottom:4px;font-weight:bold;">進化元効果</div>' + card.evoSourceEffect + '</div>';
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

  const atkIdx = bs.ai.battleArea.findIndex(c => c && c.type === 'デジモン' && !c.suspended && !c.summonedThisTurn);
  if (atkIdx === -1) { callback(); return; }

  const atk = bs.ai.battleArea[atkIdx];
  atk.suspended = true;
  atk._attackedOnTurn = bs.turn; // cond_self_attacked 用
  bs._currentTurnAttackCount = (bs._currentTurnAttackCount || 0) + 1;
  addLog('🤖 「' + atk.name + '」でアタック！');
  // ≪連携≫: AI 側もバフ自動発動
  _tryCombo(atk, bs.ai);
  renderAll();

  showPhaseAnnounce('⚔ AIアタック！', '#ff4444', () => {
    const doAfterAtkEffect = (cb) => {
      // アタッカーの【アタック時】効果 → その後に防御側の
      // 「相手のデジモンがプレイヤーにアタックしたとき」誘発（ロゼモン BT1-082 等）
      const _afterAtkTime = () => {
        if (window._fireWhenOppAttack) {
          window._fireWhenOppAttack('ai', bs, { bs, addLog, renderAll, updateMemGauge }, cb);
        } else { cb(); }
      };
      // 常にスキャン（付与効果・誘発も拾う。効果が無ければ即コールバック）
      _hooks.checkAndTriggerEffect(atk, '【アタック時】', _afterAtkTime, 'ai');
    };

    doAfterAtkEffect(() => {
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
      const atkCantBeBlocked = atk && atk._permEffects && atk._permEffects.cantBeBlocked;
      // 「進化元を持たないデジモンにはブロックされない」(イッカクモン等)
      const atkCantBeBlockedByNoEvo = atk && atk._permEffects && atk._permEffects.cantBeBlockedByNoEvo;
      bs.player.battleArea.forEach((c, i) => {
        if (c && !c.suspended && !c.cantBlock && isBlocker(c)) {
          if (atkCantBeBlocked) return; // ブロックされない: スキップ
          if (atkCantBeBlockedByNoEvo && (!c.stack || c.stack.length === 0)) return; // 進化元なしブロッカーは不可
          blockerIndices.push(i);
        }
      });

      if (blockerIndices.length > 0) {
        // チュートリアル: ブロック確認画面の前に割り込み
        // aiAttackPhase: 常にセキュリティアタック
        const _showBlock = () => showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
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
        }, { type: 'security' });
        _showBlock();
        return;
      }
      doAiSecurityCheck(atk, atkIdx, callback);
    });
  });
}

// ===== AIセキュリティチェック =====

export function doAiSecurityCheck(atk, atkIdx, callback, _remainingChecks) {
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
    hideCombatBackdrop();
    if (bs._aiScriptInProgress) { callback && callback(); } else { setTimeout(() => aiAttackPhase(callback), 800); }
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
    showSecurityCheck(sec, atk, () => {
      if (sec.type === 'デジモン') {
        if (atk.dp === sec.dp) {
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          bs.player.trash.push(sec);
          showDestroyEffect(atk, () => {
            addLog('💥 両者消滅！'); renderAll();
            _fireDestroyChain(['ai'], _afterOne, { ai: atk });
          });
        } else if (sec.dp > atk.dp) {
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
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
              _afterOne();
            }, 'Win!!', '#00ff88');
          });
        }
      } else if (sec.type === 'テイマー') {
        bs.player.tamerArea.push(sec);
        addLog('👤 テイマー「' + sec.name + '」がプレイヤーに登場');
        renderAll();
        // セキュリティから登場したテイマーの【登場時】効果を発動（高石タケル等）
        if (hasKeyword(sec, '【登場時】') || _hasRecipeTrigger(sec, 'on_play')) {
          _hooks.checkAndTriggerEffect(sec, '【登場時】', () => { renderAll(); _afterOne(); }, 'player');
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
              } else {
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
    });
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
  let empty = bs.ai.battleArea.findIndex(s => s === null);
  if (empty === -1) { empty = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }

  if (c.type === 'オプション') {
    bs.ai.hand.splice(handIdx, 1);
    addLog('🤖 AIが「' + c.name + '」を使用！（コスト' + c.playCost + '）');
    renderAll();
    showOptionEffect(c, () => {
      const turnEnded = aiSpendMemory(c.playCost);
      _hooks.checkAndTriggerEffect(c, '【メイン】', () => {
        bs.ai.trash.push(c); renderAll(true);
        onDone(turnEnded);
      }, 'ai');
    });
    return;
  }

  if (c.type === 'テイマー') {
    bs.ai.hand.splice(handIdx, 1);
    bs.ai.tamerArea.push(c);
    addLog('🤖 AIが「' + c.name + '」を登場！（コスト' + c.playCost + '）');
    renderAll();
    showPlayEffect(c, () => {
      const turnEnded = aiSpendMemory(c.playCost);
      _hooks.applyPermanentEffects('ai');
      renderAll(); onDone(turnEnded);
    });
    return;
  }

  c.summonedThisTurn = true;
  bs.ai.battleArea[empty] = c;
  bs.ai.hand.splice(handIdx, 1);
  addLog('🤖 AIが「' + c.name + '」を登場！（コスト' + c.playCost + '）');
  renderAll();
  showPlayEffect(c, () => {
    const turnEnded = aiSpendMemory(c.playCost);
    _hooks.applyPermanentEffects('ai');
    renderAll();
    // 【登場時】効果を発動 (公式ルール準拠)
    if (hasKeyword(c, '【登場時】')) {
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
      evoCandidate.summonedThisTurn = false;
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
    if (!base || base.type !== 'デジモン') continue;
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
      evoCandidate.summonedThisTurn = false;
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

  // ③ オプション/テイマー
  const optionOrTamer = bs.ai.hand.find(c =>
    (c.type === 'オプション' || c.type === 'テイマー') &&
    c.playCost !== null && c.playCost <= available
  );
  if (optionOrTamer) {
    const handIdx = bs.ai.hand.indexOf(optionOrTamer);
    aiPlayCard(optionOrTamer, handIdx, (turnEnded) => {
      if (turnEnded) { setTimeout(() => callback(), 500); return; }
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
  _attackInProgress = false;
  hideCombatBackdrop();
  renderAll();
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
  if (bs._pendingTurnEnd) {
    bs._pendingTurnEnd = false;
    checkAutoTurnEnd();
  }
}

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

export function showPlayEffect(card, onDone) {
  const overlay = document.getElementById('evolve-overlay');
  if (!overlay) { onDone && onDone(); return; }
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
    costEl.innerText = '-' + card._costReduction + ' で' + (isOption ? '使用！！' : '登場！！');
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

export function showEvolveEffect(cost, baseName, baseCard, evolvedCard, onDone) {
  const overlay = document.getElementById('evolve-overlay');
  if (!overlay) { onDone && onDone(); return; }
  const flash = document.getElementById('evo-flash'), label = document.getElementById('evo-label'),
    imgEl = document.getElementById('evo-card-img'), nameEl = document.getElementById('evo-card-name'),
    costEl = document.getElementById('evo-cost-text'), effectEl = document.getElementById('evo-effect-text');

  const isLv6 = parseInt(evolvedCard.level) >= 6;
  label.style.opacity = '0'; nameEl.style.opacity = '0'; costEl.style.opacity = '0'; costEl.style.transform = 'scale(0.5)';
  effectEl.style.display = 'none'; flash.style.opacity = '0';

  const evoColor = isLv6 ? '#ff00fb' : '#00ff88';
  imgEl.style.borderColor = evoColor;
  imgEl.style.boxShadow = `0 0 ${isLv6 ? 80 : 40}px ${evoColor}${isLv6 ? ', 0 0 150px ' + evoColor + '66' : ''}`;
  label.style.color = evoColor; label.innerText = isLv6 ? '★ MEGA EVOLUTION ★' : 'DIGITAL EVOLUTION';
  label.style.fontSize = isLv6 ? '1.1rem' : '0.9rem';
  costEl.style.color = evoColor; costEl.style.textShadow = `0 0 20px ${evoColor}`;
  if (evolvedCard._costReduction) {
    costEl.innerText = '-' + evolvedCard._costReduction + ' で進化！！';
    delete evolvedCard._costReduction;
  } else {
    costEl.innerText = cost + ' コスト進化！！';
  }

  imgEl.style.transition = 'none'; imgEl.style.transform = 'scale(1) rotate(0deg)'; imgEl.style.opacity = '1';
  const baseSrc = cardImg(baseCard);
  imgEl.innerHTML = baseSrc ? `<img src="${baseSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#aaa;font-size:10px;padding:8px;">${baseName}</div>`;
  overlay.style.display = 'flex';

  setTimeout(() => {
    imgEl.style.transition = 'opacity 0.4s, transform 0.4s';
    imgEl.style.transform = `scale(0.3) rotate(${isLv6 ? 720 : 360}deg)`; imgEl.style.opacity = '0';
    setTimeout(() => {
      flash.style.transition = 'opacity 0.1s'; flash.style.opacity = isLv6 ? '1' : '0.95';
      setTimeout(() => {
        flash.style.transition = 'opacity 0.2s'; flash.style.opacity = '0';
        nameEl.innerText = evolvedCard.name;
        const evoSrc = cardImg(evolvedCard);
        imgEl.innerHTML = evoSrc ? `<img src="${evoSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:${evoColor};font-size:10px;padding:8px;">${evolvedCard.name}</div>`;
        imgEl.style.transition = 'none'; imgEl.style.transform = `scale(${isLv6 ? 1.4 : 1.2}) rotate(-10deg)`; imgEl.style.opacity = '1';
        setTimeout(() => { imgEl.style.transition = 'transform 0.25s'; imgEl.style.transform = 'scale(1) rotate(0deg)'; label.style.opacity = '1'; nameEl.style.opacity = '1';
          setTimeout(() => { costEl.style.opacity = '1'; costEl.style.transform = 'scale(1)'; }, 150);
        }, 50);
      }, 120);
    }, 400);
  }, 300);
  clearTimeout(window._evoTimer);
  window._evoTimer = setTimeout(() => { overlay.style.display = 'none'; onDone && onDone(); }, isLv6 ? 2500 : 1800);
}

// ----- オプション使用演出 -----

export function showOptionEffect(card, onDone) {
  if (_onlineMode && _sendCommand && !window._suppressFxSend) _sendCommand({ type: 'fx_option', cardName: card.name, cardImg: cardImg(card) });
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
  costEl.innerText = card.playCost + ' コストで使用！';
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
  const isDigimon = secCard.type === 'デジモン';
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
  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2200);
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
  evo.summonedThisTurn = false;
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
  evo.summonedThisTurn = false;
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
        if (targetMode !== 'digimon' && window._fireWhenOppAttack) {
          window._fireWhenOppAttack('ai', bs, { bs, addLog, renderAll, updateMemGauge }, cb);
        } else { cb(); }
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
          if (c && !c.suspended && !c.cantBlock && isBlocker(c)) {
            blockerIndices.push(i);
          }
        });

        if (blockerIndices.length > 0) {
          const _showBlock = () => showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
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
          }, { type: 'security' });
          _showBlock();
        } else {
          doAiSecurityCheck(atk, atkIdx, () => { checkPendingTurnEnd(); _wrappedDone(); });
        }
      }
    });
  });
}
