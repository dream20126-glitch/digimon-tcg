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
import { expireBuffs as _expireBuffs, applyPermanentEffects as _applyPermanent, triggerEffect as _triggerEffect, calcPerCountValue as _calcPerCountValue } from './effect-engine.js';

// ===== 戦闘フック =====
// 効果エンジンとの連携。Phase後半で差し替え可能

let _hooks = {
  checkAndTriggerEffect: (_card, _trigger, cb, _side) => cb(),
  makeEffectContext: (card, side) => ({ card, side, bs }),
  hasKeyword: (card, kw) => card && card.effect && card.effect.includes(kw),
  hasEvoKeyword: (card, kw) => card && card.stack && card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes(kw)),
  applyPermanentEffects: (side) => {
    try { _applyPermanent(bs, side, { bs, side }); } catch (_) {}
  },
  expireBuffs: (timing, side) => {
    try { _expireBuffs(bs, timing, side); } catch (_) {}
  },
  triggerEffect: (code, card, side, ctx, cb) => {
    try { _triggerEffect(code, card, side, ctx, cb); } catch (_) { cb && cb(); }
  },
  calcPerCountValue: (text, card, side) => {
    try { return _calcPerCountValue(text, card, bs, side); } catch (_) { return 0; }
  },
};

export function setCombatHooks(hooks) {
  Object.assign(_hooks, hooks);
}

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

function sendStateSync() { if (_onlineMode && _sendStateSync) _sendStateSync(); }
function sendMemoryUpdate() { if (_onlineMode && _sendMemoryUpdate) _sendMemoryUpdate(); }

// ===== 戦闘演出背景（ちらつき防止） =====

function showCombatBackdrop() {
  let bd = document.getElementById('_combat-backdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = '_combat-backdrop';
    bd.style.cssText = 'position:fixed;inset:0;background:#000;z-index:46999;';
    document.body.appendChild(bd);
  }
  bd.style.display = 'block';
}

function hideCombatBackdrop() {
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
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'card_removed', zone: 'battle', slotIdx, reason });
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
      const baseLevel = String(baseCard.level);
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

// ===== カード登場 =====

export function doPlay(card, handIdx, slotIdx) {
  if (bs.phase !== 'main') return;
  if (card.level === '2') { addLog('🚨 デジタマはバトルエリアに出せません'); return; }
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'play', handIdx, slotIdx, cardName: card.name, cardType: card.type, cardImg: card.imgSrc || '', playCost: card.playCost || 0 });
  if (card.playCost === null) { addLog('🚨 「' + card.name + '」は進化専用カードです'); return; }

  // ----- オプションカード -----
  if (card.type === 'オプション') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    addLog('✦ 「' + card.name + '」を使用！（コスト ' + card.playCost + '）');
    renderAll();
    showOptionEffect(card, () => {
      bs.memory -= card.playCost;
      updateMemGauge();
      sendMemoryUpdate();
      _hooks.checkAndTriggerEffect(card, '【メイン】', () => {
        bs.player.trash.push(card);
        addLog('✦ 「' + card.name + '」をトラッシュへ');
        renderAll();
        if (bs.memory < 0) handleAutoTurnEnd();
      }, 'player');
    });
    return;
  }

  // ----- テイマー登場 -----
  if (card.type === 'テイマー') {
    bs.player.hand.splice(handIdx, 1); bs.selHand = null;
    bs.player.tamerArea.push(card);
    addLog('▶ 「' + card.name + '」を登場！（コスト ' + card.playCost + '）');
    renderAll();
    showPlayEffect(card, () => {
      const turnEnded = playerSpendMemory(card.playCost);
      if (!turnEnded) {
        _hooks.applyPermanentEffects('player');
        renderAll();
        if (hasKeyword(card, '【登場時】')) {
          _hooks.checkAndTriggerEffect(card, '【登場時】', () => renderAll());
        }
      }
    });
    return;
  }

  // ----- デジモン登場 -----
  card.summonedThisTurn = true;
  while (bs.player.battleArea.length <= slotIdx) bs.player.battleArea.push(null);
  bs.player.battleArea[slotIdx] = card;
  bs.player.hand.splice(handIdx, 1); bs.selHand = null;
  addLog('▶ 「' + card.name + '」を登場！（コスト ' + card.playCost + '）');
  renderAll();
  showPlayEffect(card, () => {
    _hooks.applyPermanentEffects('player');
    renderAll(true);
    if (hasKeyword(card, '【登場時】')) {
      _hooks.checkAndTriggerEffect(card, '【登場時】', () => {
        renderAll(true);
        playerSpendMemory(card.playCost);
      });
    } else {
      playerSpendMemory(card.playCost);
    }
  });
}

// ===== 進化 =====

export function doEvolve(card, handIdx, slotIdx) {
  if (bs.phase !== 'main') return;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'evolve', handIdx, slotIdx, cardName: card.name, baseName: bs.player.battleArea[slotIdx]?.name || '', cardImg: card.imgSrc || '', evolveCost: card.evolveCost || 0 });
  const base = bs.player.battleArea[slotIdx];
  if (!base) return;
  if (card.evolveCost === null) { addLog('🚨 「' + card.name + '」は進化できません‼'); return; }
  if (!canEvolveOnto(card, base)) { addLog('🚨 進化条件を満たしていません‼（' + card.evolveCond + '）'); return; }

  const cost = card.evolveCost;
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
  addLog('⬆ 「' + base.name + '」→「' + evolved.name + '」進化！（コスト ' + cost + '）');
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, () => {
    doDraw('player', '進化ドロー', () => {
      if (hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
          renderAll(true);
          playerSpendMemory(cost);
        });
      } else {
        playerSpendMemory(cost);
      }
    });
  });
}

// ===== 育成エリア進化 =====

export function doEvolveIku(card, handIdx) {
  if (bs.phase !== 'main') return;
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'breed_evolve', handIdx, cardName: card.name, baseName: bs.player.ikusei?.name || '', cardImg: card.imgSrc || '', evolveCost: card.evolveCost || 0 });
  const base = bs.player.ikusei;
  if (!base) return;
  if (card.evolveCost === null) { addLog('🚨 「' + card.name + '」は進化できません‼'); return; }
  if (!canEvolveOnto(card, base)) { addLog('🚨 進化条件を満たしていません‼（' + card.evolveCond + '）'); return; }

  const cost = card.evolveCost;
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
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, () => {
    doDraw('player', '進化ドロー', () => {
      if (evolved.effect && evolved.effect.includes('＜育成＞') && hasKeyword(evolved, '【進化時】')) {
        _hooks.checkAndTriggerEffect(evolved, '【進化時】', () => {
          renderAll(true);
          playerSpendMemory(cost);
        });
      } else {
        playerSpendMemory(cost);
      }
    });
  });
}

// ===== メモリー消費（プレイヤー） =====

function playerSpendMemory(cost) {
  if (cost === 0) { updateMemGauge(); return false; }
  bs.memory -= cost;
  updateMemGauge();
  sendMemoryUpdate();
  if (bs.memory < 0) {
    handleAutoTurnEnd();
    return true;
  }
  return false;
}

// AI メモリー消費
function aiSpendMemory(cost) {
  if (cost === 0) return false;
  bs.memory += cost;
  updateMemGauge();
  return bs.memory > 0;
}

// 自動ターン終了（メモリーオーバーフロー）
function handleAutoTurnEnd() {
  const over = Math.abs(bs.memory);
  addLog('💾 メモリー' + over + 'で相手側へ');
  bs.isPlayerTurn = false;
  _hooks.expireBuffs('dur_this_turn');
  _hooks.expireBuffs('permanent', 'player');
  renderAll(true);
  if (_onlineMode) {
    if (_sendCommand) _sendCommand({ type: 'endTurn', memory: bs.memory });
    showYourTurn('自分のターン終了', '', '#555555', () => {
      showYourTurn('相手のターン', '🎮 相手の操作を待っています...', '#ff00fb', () => {});
    });
  } else {
    bs.memory = over;
    updateMemGauge();
    showYourTurn('自分のターン終了', '', '#555555', () => {
      setTimeout(() => aiTurn(), 500);
    });
  }
}

// ===== アタック状態管理 =====

let _atkState = null; // { card, slotIdx }

export function startAttack(card, slotIdx) {
  if (bs.phase !== 'main') return false;
  if (!card) return false;
  // suspended チェックは行わない（長押しメニューで既にレスト済み）
  if (card.cantAttack) return false;

  card.suspended = true;
  _atkState = { card, slotIdx };
  addLog('⚔ 「' + card.name + '」でアタック！');
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
  if (!_atkState) return;
  const atk = _atkState.card;
  const atkSlotIdx = _atkState.slotIdx;
  _atkState = null;

  if (target === 'security') {
    // セキュリティアタック
    afterAtkEffect(atk, atkSlotIdx, () => resolveSecurityCheck(atk, atkSlotIdx));
  } else if (target === 'digimon') {
    // デジモンアタック
    const def = bs.ai.battleArea[targetIdx];
    if (!def) { cancelAttack(); return; }
    const canHitActive = hasEvoKeyword(atk, '【突進】') || hasKeyword(atk, 'アクティブ状態のデジモンにもアタックできる');
    if (!def.suspended && !canHitActive) {
      addLog('🚨 アクティブ状態のデジモンにはアタックできません');
      atk.suspended = false; renderAll();
      return;
    }
    afterAtkEffect(atk, atkSlotIdx, () => resolveBattle(atk, atkSlotIdx, def, targetIdx, 'ai'));
  }
}

// アタック時効果
function afterAtkEffect(atk, atkSlotIdx, callback) {
  const hasAtk = hasKeyword(atk, '【アタック時】') ||
    (atk.stack && atk.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes('【アタック時】')));
  if (hasAtk) {
    _hooks.checkAndTriggerEffect(atk, '【アタック時】', callback);
  } else callback();
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

  function startChecks() {
    if (bs.ai.security.length > 0) {
      doNextCheck();
    } else {
      showDirectAttack(atk, 'player', () => { battleVictory(); });
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
    if (!bs.player.battleArea[atkIdx]) { checkAttackEnd(atk, atkIdx); return; }
    if (bs.ai.security.length <= 0) {
      addLog('🛡 相手のセキュリティが0枚になった');
      checkAttackEnd(atk, atkIdx);
      return;
    }

    const sec = bs.ai.security.splice(0, 1)[0];
    if (_onlineMode && _sendCommand) _sendCommand({ type: 'security_remove', secName: sec.name, secType: sec.type, remaining: bs.ai.security.length });
    applySecurityBuffs(sec, 'ai');

    showSecurityCheck(sec, atk, () => {
      // ----- セキュリティがデジモン -----
      if (sec.type === 'デジモン') {
        if (atk.dp === sec.dp) {
          bs.ai.trash.push(sec);
          removeOwnCard(atkIdx, 'destroy');
          renderAll(); sendStateSync();
          showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => {
            showDestroyEffect(sec, () => { showDestroyEffect(atk, () => {
              addLog('💥 両者消滅！'); sendStateSync(); checkPendingTurnEnd();
            }); });
          }, '両者消滅', '#ff4444');
        } else if (atk.dp > sec.dp) {
          bs.ai.trash.push(sec); renderAll(); sendStateSync();
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
          removeOwnCard(atkIdx, 'destroy');
          bs.ai.trash.push(sec);
          renderAll(); sendStateSync();
          showBattleResult('Lost...', '#ff4444', '「' + atk.name + '」が撃破された', () => {
            showDestroyEffect(atk, () => {
              addLog('✗ セキュリティに敗北'); sendStateSync(); checkPendingTurnEnd();
            });
          }, 'Win!!', '#00ff88');
        }
        return;
      }
      // ----- セキュリティがテイマー -----
      if (sec.type === 'テイマー') {
        bs.ai.tamerArea.push(sec);
        addLog('👤 テイマー「' + sec.name + '」が相手に登場'); renderAll();
        if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
        else { checkAttackEnd(atk, atkIdx); }
        return;
      }
      // ----- セキュリティがオプション等 -----
      addLog('✦ セキュリティ効果：「' + sec.name + '」');
      const hasSecField = sec.securityEffect && sec.securityEffect.trim() && sec.securityEffect !== 'なし';
      const hasSecInEffect = sec.effect && sec.effect.includes('【セキュリティ】');
      setTimeout(() => {
        if (hasSecField || hasSecInEffect) {
          const secText = hasSecField ? sec.securityEffect : sec.effect;
          const originalEffect = sec.effect || '';
          if (hasSecField) {
            const secBlock = secText.includes('【セキュリティ】') ? secText : '【セキュリティ】' + secText;
            sec.effect = originalEffect + (originalEffect ? '\n' : '') + secBlock;
          }
          const afterSecEffect = () => {
            const mentionsMainEffect = /このカードの\s*【メイン】\s*効果/.test(secText);
            const doFinish = () => {
              sec.effect = originalEffect;
              bs.ai.trash.push(sec); renderAll(); sendStateSync();
              if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
              else { checkAttackEnd(atk, atkIdx); }
            };
            if (mentionsMainEffect && originalEffect.includes('【メイン】')) {
              sec.effect = originalEffect;
              _hooks.checkAndTriggerEffect(sec, '【メイン】', doFinish, 'ai');
            } else { doFinish(); }
          };
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

// Sアタック+計算
function getSecurityAttackCount(card) {
  let extra = 0;
  const side = bs.isPlayerTurn ? 'player' : 'ai';
  _hooks.applyPermanentEffects('player');
  _hooks.applyPermanentEffects('ai');

  function calcFromText(text) {
    if (!text || text === 'なし') return;
    if (/【(自分のターン|相手のターン|お互いのターン)】/.test(text)) return;
    if (/(いる間|いるとき|いる場合|がいる(?![ぁ-ん]))/.test(text)) return;

    if (text.includes('ごとに') && (text.includes('Sアタック') || text.includes('セキュリティアタック'))) {
      const saMatch = text.match(/(?:Sアタック|セキュリティアタック)\+(\d+)/);
      const perValue = saMatch ? parseInt(saMatch[1]) : 1;
      const val = _hooks.calcPerCountValue(text, card, side);
      if (val > 0) { extra += val; }
      else {
        const conditions = text.match(/(\d+)枚ごとに/);
        if (conditions) {
          const n = parseInt(conditions[1]);
          const count = card.stack ? card.stack.length : 0;
          extra += perValue * Math.floor(count / n);
        }
      }
      return;
    }
    const matches = text.matchAll(/(?:Sアタック|セキュリティアタック)\+(\d+)/g);
    for (const m of matches) extra += parseInt(m[1]);
  }

  calcFromText(card.effect);
  if (card.stack) {
    card.stack.forEach(s => {
      calcFromText(s.evoSourceEffect);
      if (!s.evoSourceEffect && s.effect && s.effect !== 'なし') calcFromText(s.effect);
    });
  }
  if (card._permEffects && card._permEffects.securityAttackPlus) extra += card._permEffects.securityAttackPlus;
  if (card.buffs && card.buffs.length > 0) {
    card.buffs.forEach(b => { if (b.type === 'security_attack_plus') extra += (parseInt(b.value) || 0); });
  }
  return 1 + extra;
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
    addLog('🛡 セキュリティバフ適用: 「' + sec.name + '」DP ' + sec._origDp + ' → ' + sec.dp);
  }
}

// ===== バトル解決（プレイヤー → AI デジモン） =====

export function resolveBattle(atk, atkIdx, def, defIdx, defSide) {
  showCombatBackdrop();
  addLog('⚔ 「' + atk.name + '」(' + atk.dp + 'DP) vs 「' + def.name + '」(' + def.dp + 'DP)');

  function destroyDef() {
    if (defSide === 'ai') {
      bs.ai.battleArea[defIdx] = null;
      bs.ai.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.ai.trash.push(s));
      if (_onlineMode && _sendCommand) _sendCommand({ type: 'card_removed', zone: 'battle', slotIdx: defIdx, reason: 'destroy' });
    }
  }
  function destroyAtk() { removeOwnCard(atkIdx, 'destroy'); }

  showSecurityCheck(def, atk, () => {
    if (atk.dp === def.dp) {
      destroyDef(); destroyAtk(); renderAll();
      showBattleResult('両者消滅', '#ff4444', '両者消滅！', () => {
        showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
          addLog('💥 両者消滅！'); checkPendingTurnEnd();
        }); });
      }, '両者消滅', '#ff4444');
    } else if (atk.dp > def.dp) {
      destroyDef(); renderAll();
      showBattleResult('Win!!', '#00ff88', '「' + def.name + '」を撃破！', () => {
        showDestroyEffect(def, () => { addLog('💥 「' + def.name + '」を撃破！'); checkAttackEnd(atk, atkIdx); });
      }, 'Lose...', '#ff4444');
    } else {
      destroyAtk(); renderAll();
      showBattleResult('Lost...', '#ff4444', '「' + atk.name + '」が撃破された', () => {
        showDestroyEffect(atk, () => { addLog('💥 「' + atk.name + '」が撃破された...'); checkPendingTurnEnd(); });
      }, 'Win!!', '#00ff88');
    }
  }, 'BATTLE!');
}

// ===== バトル解決（AI → プレイヤー ブロッカー戦） =====

export function resolveBattleAI(atk, atkIdx, def, defIdx, callback) {
  showCombatBackdrop();
  const origCb = callback;
  callback = () => { hideCombatBackdrop(); origCb(); };
  addLog('⚔ 「' + atk.name + '」(' + atk.dp + 'DP) vs 「' + def.name + '」(' + def.dp + 'DP)');
  showSecurityCheck(def, atk, () => {
    if (atk.dp === def.dp) {
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
      if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
      renderAll();
      showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
        showBattleResult('Lost...', '#ff4444', '両者消滅！', () => { addLog('💥 両者消滅！'); renderAll(); callback(); });
      }); });
    } else if (atk.dp > def.dp) {
      bs.player.battleArea[defIdx] = null; bs.player.trash.push(def);
      if (def.stack) def.stack.forEach(s => bs.player.trash.push(s));
      renderAll();
      showDestroyEffect(def, () => {
        showBattleResult('Lost...', '#ff4444', '「' + def.name + '」が撃破された', () => { addLog('💥 「' + def.name + '」が撃破された'); renderAll(); callback(); });
      });
    } else {
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
      if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      renderAll();
      showDestroyEffect(atk, () => {
        showBattleResult('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => { addLog('💥 「' + atk.name + '」を撃破！'); renderAll(); callback(); });
      });
    }
  }, 'BATTLE!');
}

// ===== ブロック確認UI =====

export function showBlockConfirm(blocker, attacker, callback) {
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
  textEl.innerText = '相手の「' + (attacker ? attacker.name : '???') + '」(DP:' + (attacker ? attacker.dp : '?') + ')がアタックしてきました！';
  if (questionEl) questionEl.innerText = 'ブロックしますか？';
  if (imgEl) imgEl.style.display = 'none';
  overlay.style.display = 'flex';

  window._effectConfirmCallback = function(result) {
    nameEl.style.color = '#fff';
    nameEl.style.textShadow = '';
    nameEl.style.fontSize = '1rem';
    if (questionEl) questionEl.innerText = '効果を発動しますか？';
    if (imgEl) imgEl.style.display = '';
    overlay.style.display = 'none';
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
    if (selectedIdx !== null) { cleanup(); callback(selectedIdx); }
  }

  setTimeout(() => {
    document.addEventListener('click', onSelect, true);
    document.addEventListener('touchend', onSelect, true);
  }, 100);
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
  addLog('🤖 「' + atk.name + '」でアタック！');
  renderAll();

  showPhaseAnnounce('⚔ AIアタック！', '#ff4444', () => {
    const doAfterAtkEffect = (cb) => {
      if (hasKeyword(atk, '【アタック時】') || hasEvoKeyword(atk, '【アタック時】')) {
        _hooks.checkAndTriggerEffect(atk, '【アタック時】', cb, 'ai');
      } else { cb(); }
    };

    doAfterAtkEffect(() => {
      // ブロッカーチェック
      const blockerIndices = [];
      bs.player.battleArea.forEach((c, i) => {
        if (!c) return;
        const hasBlocker = hasKeyword(c, '【ブロッカー】') || hasEvoKeyword(c, '【ブロッカー】');
        console.log('[ブロッカーチェック]', c.name, 'effect:', (c.effect||'').substring(0,20), 'suspended:', c.suspended, 'hasBlocker:', hasBlocker);
        if (!c.suspended && hasBlocker) {
          blockerIndices.push(i);
        }
      });
      console.log('[ブロッカー結果]', blockerIndices.length, '体検出');

      if (blockerIndices.length > 0) {
        showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
          if (doBlock) {
            if (blockerIndices.length === 1) {
              const blockerIdx = blockerIndices[0];
              const blocker = bs.player.battleArea[blockerIdx];
              blocker.suspended = true;
              addLog('🛡 「' + blocker.name + '」でブロック！');
              renderAll();
              afterBlockedEffect(atk, atkIdx, 'ai', () => {
                resolveBattleAI(atk, atkIdx, blocker, blockerIdx, () => {
                  setTimeout(() => aiAttackPhase(callback), 800);
                });
              });
            } else {
              showBlockerSelection(blockerIndices, atk, (selectedIdx) => {
                if (selectedIdx !== null) {
                  const blocker = bs.player.battleArea[selectedIdx];
                  blocker.suspended = true;
                  addLog('🛡 「' + blocker.name + '」でブロック！');
                  renderAll();
                  afterBlockedEffect(atk, atkIdx, 'ai', () => {
                    resolveBattleAI(atk, atkIdx, blocker, selectedIdx, () => {
                      setTimeout(() => aiAttackPhase(callback), 800);
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
        });
        return;
      }
      doAiSecurityCheck(atk, atkIdx, callback);
    });
  });
}

// ===== AIセキュリティチェック =====

export function doAiSecurityCheck(atk, atkIdx, callback) {
  showCombatBackdrop();
  if (bs.player.security.length > 0) {
    const sec = bs.player.security.splice(0, 1)[0];
    applySecurityBuffs(sec, 'player');
    showSecurityCheck(sec, atk, () => {
      if (sec.type === 'デジモン') {
        if (atk.dp === sec.dp) {
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          bs.player.trash.push(sec);
          showDestroyEffect(atk, () => { addLog('💥 両者消滅！'); renderAll(); setTimeout(() => aiAttackPhase(callback), 800); });
        } else if (sec.dp > atk.dp) {
          bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
          bs.player.trash.push(sec);
          showDestroyEffect(atk, () => { addLog('💥 「' + atk.name + '」が撃破された'); renderAll(); setTimeout(() => aiAttackPhase(callback), 800); });
        } else {
          bs.player.trash.push(sec);
          addLog('✓ セキュリティ突破'); renderAll();
          if (bs.player.security.length <= 0) addLog('🛡 自分のセキュリティが0枚になった');
          setTimeout(() => aiAttackPhase(callback), 800);
        }
      } else if (sec.type === 'テイマー') {
        bs.player.tamerArea.push(sec);
        addLog('👤 テイマー「' + sec.name + '」がプレイヤーに登場');
        renderAll(); setTimeout(() => aiAttackPhase(callback), 800);
      } else {
        addLog('✦ セキュリティ効果：「' + sec.name + '」');
        const hasSecField = sec.securityEffect && sec.securityEffect.trim() && sec.securityEffect !== 'なし';
        const hasSecInEffect = sec.effect && sec.effect.includes('【セキュリティ】');
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
              bs.player.trash.push(sec); renderAll();
              setTimeout(() => aiAttackPhase(callback), 800);
            };
            if (mentionsMain && originalEffect.includes('【メイン】')) {
              sec.effect = originalEffect;
              _hooks.checkAndTriggerEffect(sec, '【メイン】', doFinish, 'player');
            } else { doFinish(); }
          };
          _hooks.checkAndTriggerEffect(sec, '【セキュリティ】', afterSec, 'player');
        } else {
          bs.player.trash.push(sec); renderAll();
          setTimeout(() => aiAttackPhase(callback), 800);
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
    const turnEnded = aiSpendMemory(c.playCost); renderAll();
    onDone(turnEnded);
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
      evoCandidate.stack = [...(oldCard.stack || []), oldCard];
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
      evoCandidate.stack = [...(base.stack || []), base];
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

export function checkPendingTurnEnd() {
  hideCombatBackdrop();
  renderAll();
  if (bs._pendingTurnEnd) {
    bs._pendingTurnEnd = false;
    handleAutoTurnEnd();
  }
}

// ===== 勝敗判定 =====

export function battleVictory() {
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'game_end', result: 'defeat' });
  showGameEndOverlay('🎉 勝利！', 'victory', () => { cleanupBattle(); showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen'); });
}

export function battleDefeat() {
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'game_end', result: 'victory' });
  showGameEndOverlay('😢 敗北...', 'defeat', () => { cleanupBattle(); showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen'); });
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
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_option', cardName: card.name, cardImg: cardImg(card) });
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
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_securityCheck', secName: secCard.name || '', secImg: cardImg(secCard), secCardNo: secCard.cardNo || '', secDp: parseInt(secCard.dp) || 0, secType: secCard.type || '', atkName: atkCard.name || '', atkImg: cardImg(atkCard), atkCardNo: atkCard.cardNo || '', atkDp: parseInt(atkCard.dp) || 0, customLabel: customLabel || '' });
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
  atkDpEl.innerText = 'DP: ' + atkCard.dp;

  const src = cardImg(secCard);
  imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#fff;padding:8px;">${secCard.name}</div>`;
  nameEl.innerText = secCard.name;
  const isDigimon = secCard.type === 'デジモン';
  const isOption = secCard.type === 'オプション';
  const isTamer = secCard.type === 'テイマー';
  typeEl.innerText = isDigimon ? 'DP: ' + secCard.dp : isOption ? 'セキュリティ効果' : isTamer ? 'テイマー登場' : '';

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

  setTimeout(() => { resultEl.innerText = resultText; resultEl.style.color = resultColor; resultEl.style.textShadow = `0 0 20px ${resultColor}`; resultEl.style.opacity = '1'; resultEl.style.transform = 'scale(1)'; }, 1500);
  setTimeout(() => { overlay.style.display = 'none'; callback && callback(); }, 2800);
}

// ----- バトル結果演出 -----

export function showBattleResult(text, color, sub, callback, oppText, oppColor) {
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_battleResult', text: oppText || text, color: oppColor || color, sub });
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
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_destroy', cardName: card.name, cardImg: cardImg(card) });
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
  if (_onlineMode && _sendCommand) _sendCommand({ type: 'fx_directAttack', atkName: atkCard.name, atkImg: cardImg(atkCard), side });
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:35000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

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

function showGameEndOverlay(text, type, callback) {
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
