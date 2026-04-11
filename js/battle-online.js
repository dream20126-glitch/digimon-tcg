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
let _onlineCmdSeq = 0;         // コマンド連番
let _pendingBlockCallback = null;
let _pendingBlockResponse = null;
let _pendingSecEffectCallback = null;
let _pendingSecEffectResponse = null;

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
  fn(() => { window._suppressFxSend = false; drainFxQueue(); });
}

// ===== 状態アクセサ =====
export function isOnlineMode() { return _onlineMode; }
export function getMyKey() { return _onlineMyKey; }
export function getRoomId() { return _onlineRoomId; }

// ===== コマンド送信 =====

export function sendCommand(cmd) {
  if (!_onlineMode || !_onlineRoomId) return;
  _onlineCmdSeq++;
  const path = `rooms/${_onlineRoomId}/commands/${_onlineCmdSeq}`;
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
      imgSrc: c.imgSrc || '', imageUrl: c.imageUrl || '', color: c.color || '', feature: c.feature || '',
      evolveCond: c.evolveCond || '', buffs: c.buffs || [],
      stack: (c.stack || []).map(serializeCard),
      recipe: c.recipe || null,
      _permEffects: c._permEffects || {}, _usedEffects: c._usedEffects || [],
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
  _onlineCmdListener = onValue(ref(rtdb, `rooms/${_onlineRoomId}/commands`), (snap) => {
    const cmds = snap.val();
    if (!cmds) return;
    Object.values(cmds).sort((a, b) => a.seq - b.seq).forEach(cmd => {
      if (cmd.from === _onlineMyKey) return;
      if (cmd.seq <= _onlineCmdSeq) return;
      if (cmd.time && cmd.time < startTime) return;
      _onlineCmdSeq = cmd.seq;
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
  _pendingBlockCallback = null;
  _pendingBlockResponse = null;
  _pendingSecEffectCallback = null;
  _pendingSecEffectResponse = null;
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
          markDestroyed('ai', cmd.slotIdx);
          renderAll();
        }
      }
      break;
    }
    case 'card_removed': {
      if (cmd.zone === 'battle' && cmd.slotIdx !== undefined) {
        const card = bs.player.battleArea[cmd.slotIdx];
        if (card) {
          bs.player.battleArea[cmd.slotIdx] = null;
          if (cmd.reason === 'bounce') {
            bs.player.hand.push(card);
          } else {
            bs.player.trash.push(card);
          }
          if (card.stack) card.stack.forEach(s => bs.player.trash.push(s));
          markDestroyed('player', cmd.slotIdx);
          renderAll();
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
      if (cmd.memory !== undefined) { bs.memory = -cmd.memory; updateMemGauge(); }
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
        evoCard.stack = [...(old.stack || []), old];
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
      addLog('🎮 相手の「' + atkName + '」でセキュリティアタック！');
      if (m.showYourTurn) m.showYourTurn('⚔ 相手アタック！', '「' + atkName + '」→ セキュリティ', '#ff4444', () => { checkOnlineBlock(cmd); });
      break;
    }
    case 'attack_digimon': {
      const atkName2 = cmd.atkName || '???';
      const defName2 = cmd.defName || '???';
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
        feature: cmd.feature || '', imgSrc: cmd.cardImg || cmd.imgSrc || '',
        cost: cmd.cost || 0, playCost: cmd.playCost || 0,
        suspended: false, buffs: [], stack: [],
      };
      bs.player.tamerArea.push(tamer);
      addLog('👤 テイマー「' + tamer.name + '」がセキュリティから登場！');
      renderAll();
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
      renderAll();
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
        if (statusEl) statusEl.innerText = cmd.accepted ? '⚡ 効果処理中...' : '💨 効果を発動しませんでした';
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
        dp: cmd.dp || 0, level: cmd.level || '', color: cmd.color || '', feature: cmd.feature || '',
        cost: cmd.cost || 0, playCost: cmd.playCost || 0,
        stack: [], buffs: [], suspended: false,
      };
      // セキュリティ効果テキストを効果テキストにマージ（triggerEffect用）
      const hasSecField = secCard.securityEffect && secCard.securityEffect.trim() && secCard.securityEffect !== 'なし';
      const originalEffect = secCard.effect || '';
      if (hasSecField) {
        const secBlock = secCard.securityEffect.includes('【セキュリティ】') ? secCard.securityEffect : '【セキュリティ】' + secCard.securityEffect;
        secCard.effect = originalEffect + (originalEffect ? '\n' : '') + secBlock;
      }
      const afterEffect = () => {
        const mentionsMain = /このカードの\s*【メイン】\s*効果/.test(secCard.securityEffect || secCard.effect);
        const doFinish = () => {
          secCard.effect = originalEffect;
          // メモリー変動を相手に通知 + 状態同期 + 処理完了通知
          sendMemoryUpdate();
          sendStateSync();
          sendCommand({ type: 'security_effect_done', memory: bs.memory });
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
      if (_pendingSecEffectCallback) {
        const cb = _pendingSecEffectCallback; _pendingSecEffectCallback = null; cb();
      } else {
        _pendingSecEffectResponse = true;
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
          // 最近進化元が変更されたカードのstackを保護（古いsyncで復元されるのを防止）
          if (newArea[i] && isRecentlyEvoModified('ai', i) && bs.ai.battleArea[i]) {
            newArea[i].stack = bs.ai.battleArea[i].stack;
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
      // 相手から汎用バフ付与コマンドを受信 → 自分の対象カードに buff を直接 push
      // state_sync は oppBattleArea を上書きしないため、相手のカードに付与した buff は
      // この個別コマンドで同期する
      const myCard = bs.player.battleArea[cmd.targetIdx];
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
        renderAll();
      }
      addLog('⚔ 「' + (cmd.targetName || '???') + '」に' + (cmd.buffType || 'バフ') + '+' + (cmd.value || 0) + ' 付与');
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

function checkOnlineBlock(cmd) {
  const blockerIndices = [];
  bs.player.battleArea.forEach((c, i) => {
    if (c && !c.suspended && !c.cantBlock) {
      const hasBlocker = (c.effect && c.effect.includes('【ブロッカー】'))
        || (c.stack && c.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes('【ブロッカー】')));
      if (hasBlocker) blockerIndices.push(i);
    }
  });
  if (blockerIndices.length === 0) {
    sendCommand({ type: 'block_response', blocked: false });
    return;
  }
  // baseDp を含めて再構築（showBlockConfirm 内の formatDpDisplay が「元値+バフ」を表示できるように）
  const attacker = { name: cmd.atkName || '???', dp: cmd.atkDp || 0, baseDp: cmd.atkBaseDp != null ? cmd.atkBaseDp : (cmd.atkDp || 0), imgSrc: cmd.atkImg || '' };
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
    });
  } else {
    // ブロック確認UIがない場合、ブロックなしとして応答
    sendCommand({ type: 'block_response', blocked: false });
  }
}

function resolveOnlineBlock(blockerIdx, cmd) {
  const blocker = bs.player.battleArea[blockerIdx];
  const atk = bs.ai.battleArea[cmd.atkIdx];
  if (!blocker || !atk) { sendCommand({ type: 'block_response', blocked: false }); return; }

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
        bs.ai.battleArea[cmd.atkIdx] = null; bs.ai.trash.push(atk); if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
        bs.player.battleArea[blockerIdx] = null; bs.player.trash.push(blocker); if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s));
        sendCommand({ type: 'own_card_removed', slotIdx: blockerIdx, reason: 'destroy' });
        renderAll();
        sendCommand({ type: 'fx_battleResult', text: '両者消滅', color: '#ff4444', sub: '両者消滅！' });
        showBR('両者消滅', '#ff4444', '両者消滅！', () => {
          showDE(blocker, () => { showDE(atk, () => {
            addLog('💥 両者消滅！'); window._suppressFxSend = false; sendStateSync();
          }); });
        });
      } else if (_atkDp > _blkDp) {
        bs.player.battleArea[blockerIdx] = null; bs.player.trash.push(blocker); if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s));
        sendCommand({ type: 'own_card_removed', slotIdx: blockerIdx, reason: 'destroy' });
        renderAll();
        sendCommand({ type: 'fx_battleResult', text: 'Win!!', color: '#00ff88', sub: '「' + blocker.name + '」を撃破！' });
        showBR('Lost...', '#ff4444', '「' + blocker.name + '」が撃破された', () => {
          showDE(blocker, () => {
            addLog('💥 「' + blocker.name + '」が撃破された'); window._suppressFxSend = false; sendStateSync();
          });
        });
      } else {
        bs.ai.battleArea[cmd.atkIdx] = null; bs.ai.trash.push(atk); if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
        renderAll();
        sendCommand({ type: 'fx_battleResult', text: 'Lost...', color: '#ff4444', sub: '「' + atk.name + '」が撃破された' });
        showBR('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => {
          showDE(atk, () => {
            addLog('💥 「' + atk.name + '」を撃破！'); window._suppressFxSend = false; sendStateSync();
          });
        });
      }
    }, 'BLOCK!');
  }

  // 攻撃側の「ブロックされた時」効果完了シグナルを待つ（最大10秒）
  let battleStarted = false;
  let unsubBlockedDone = null;
  unsubBlockedDone = onValue(ref(rtdb, `rooms/${_onlineRoomId}/commands`), (snap) => {
    if (battleStarted) return;
    if (!unsubBlockedDone) return; // 初期化前の即時コールバックをスキップ
    const cmds = snap.val();
    if (!cmds) return;
    const keys = Object.keys(cmds);
    for (const k of keys) {
      if (cmds[k] && cmds[k].type === 'blocked_effect_done' && cmds[k].from !== _onlineMyKey) {
        battleStarted = true;
        unsubBlockedDone(); // リスナー解除
        startBattleResolution();
        return;
      }
    }
  });
  // タイムアウト: 10秒待っても来なければバトル開始
  setTimeout(() => {
    if (!battleStarted) {
      battleStarted = true;
      if (unsubBlockedDone) unsubBlockedDone();
      startBattleResolution();
    }
  }, 10000);
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
window._clearPendingBlock = () => { _pendingBlockCallback = null; _pendingBlockResponse = null; };
window._markDestroyed = (side, slotIdx) => markDestroyed(side, slotIdx);
window._markEvoModified = (side, slotIdx) => markEvoModified(side, slotIdx);
window._markBuffExpired = (cardName, type, duration) => markBuffExpired(cardName, type, duration);
window._cleanupOnline = () => cleanupOnline();

// battle-combat.jsの戦闘演出中フラグをwindow経由で公開
import { isCombatAnimating } from './battle-combat.js';
window._isCombatAnimating = isCombatAnimating;
