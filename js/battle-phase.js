/**
 * battle-phase.js — フェーズ進行の状態マシン
 *
 * ターン開始 → アクティブ → ドロー → 育成 → メイン → ターン終了
 * プレイヤー側・AI側の両方を管理
 */

import { bs, spendMemory, addMemory, endTurnManual, isMemoryOverflow, drawCards, isDeckEmpty } from './battle-state.js';
import { addLog, showOverlay, removeOverlay } from './battle-ui.js';
import { renderAll, renderHand, updateMemGauge, updatePhaseBadge, cardImg } from './battle-render.js';
import { expireBuffs as _expireBuffs, applyPermanentEffects as _applyPermanent } from './effect-engine.js';

// ===== 定数 =====

const PHASE_NAMES = {
  unsuspend: { icon: '🔄', name: 'アクティブフェイズ' },
  draw:      { icon: '🃏', name: 'ドローフェイズ' },
  breed:     { icon: '🥚', name: '育成フェイズ' },
  main:      { icon: '⚡', name: 'メインフェイズ' },
};

const PHASE_COLORS = {
  unsuspend: '#00fbff',
  draw:      '#00ff88',
  breed:     '#ff9900',
  main:      '#ff00fb',
};

// ===== 効果フック =====
// Phase 4以降で差し替え可能。デフォルトはスルー

let _hooks = {
  /** ターン開始時効果 (side, callback) */
  checkTurnStartEffects: (_side, cb) => cb(),
  /** ターン終了時効果 (callback) */
  checkTurnEndEffects: (cb) => cb(),
  /** 永続効果再計算 (side) */
  refreshPermanentEffects: (_side) => {},
  /** バフ期限切れ (timing, ownerSide?, endingSide?) */
  expireBuffs: (timing, ownerSide, endingSide) => {
    try { _expireBuffs(bs, timing, ownerSide, endingSide); } catch (_) { /* effect-engine未接続時は無視 */ }
  },
  /** 永続効果適用 (side) */
  applyPermanentEffects: (side) => {
    try { _applyPermanent(bs, side, { bs, side }); } catch (_) { /* effect-engine未接続時は無視 */ }
  },
  /** カードがキーワードを持つか */
  hasKeyword: (card, kw) => card && card.effect && card.effect.includes(kw),
  /** 効果トリガー (card, triggerType, callback, side) */
  checkAndTriggerEffect: (_card, _trigger, cb, _side) => cb(),
  /** デッキ切れ負け */
  onDeckOut: () => { addLog('⚠ デッキ切れ！'); },
  /** AI メインフェイズ処理 (callback) */
  aiMainPhase: (cb) => cb(),
  /** AI アタックフェイズ処理 (callback) */
  aiAttackPhase: (cb) => cb(),
};

/**
 * 外部からフックを登録
 * @param {Object} hooks - 上書きしたいフック関数のオブジェクト
 */
export function setPhaseHooks(hooks) {
  Object.assign(_hooks, hooks);
}

// ===== オンラインモード参照 =====
let _onlineMode = false;
let _onlineMyKey = null;
let _sendCommand = null;
let _sendStateSync = null;
let _sendMemoryUpdate = null;

export function setOnlineHandlers(online, myKey, handlers = {}) {
  _onlineMode = online;
  _onlineMyKey = myKey;
  _sendCommand = handlers.sendCommand || null;
  _sendStateSync = handlers.sendStateSync || null;
  _sendMemoryUpdate = handlers.sendMemoryUpdate || null;
}

// ===== 演出: ターン開始オーバーレイ =====

export function showYourTurn(text, sub, color, callback) {
  const overlay = document.getElementById('your-turn-overlay');
  const textEl = document.getElementById('your-turn-text');
  const subEl = document.getElementById('your-turn-sub');
  const flashBg = document.getElementById('turn-flash-bg');
  const lineTop = document.getElementById('turn-line-top');
  const lineBottom = document.getElementById('turn-line-bottom');

  let c = color || 'var(--main-cyan)';
  if (_onlineMode) {
    if (text.includes('自分のターン開始')) c = getMyTurnColor();
    else if (text.includes('相手のターン') && !text.includes('終了')) c = getOppTurnColor();
  }

  textEl.innerText = text;
  textEl.style.color = c;
  textEl.style.textShadow = `0 0 30px ${c}, 0 0 60px ${c}, 0 0 100px ${c}`;

  if (sub) { subEl.innerText = sub; subEl.style.opacity = '1'; }
  else { subEl.innerText = ''; subEl.style.opacity = '0'; }

  flashBg.style.background = c;
  flashBg.style.animation = 'none'; void flashBg.offsetWidth;
  flashBg.style.animation = 'turnFlash 1.5s ease forwards';

  lineTop.style.background = `linear-gradient(90deg, transparent, ${c}, transparent)`;
  lineTop.style.animation = 'none'; void lineTop.offsetWidth;
  lineTop.style.animation = 'turnLineExpand 1.5s ease forwards';

  lineBottom.style.background = `linear-gradient(90deg, transparent, ${c}, transparent)`;
  lineBottom.style.animation = 'none'; void lineBottom.offsetWidth;
  lineBottom.style.animation = 'turnLineExpand 1.5s ease 0.1s forwards';

  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; if (callback) callback(); }, 1800);
}

// ===== 演出: フェーズアナウンス =====

export function showPhaseAnnounce(text, color, callback) {
  const overlay = document.getElementById('phase-announce-overlay');
  const textEl = document.getElementById('phase-announce-text');
  const bar = document.getElementById('phase-highlight-bar');
  const c = color || 'var(--main-cyan)';

  textEl.innerText = text;
  textEl.style.color = '#fff';
  textEl.style.textShadow = `0 0 20px ${c}`;

  bar.style.background = `linear-gradient(90deg, transparent, ${c}33, ${c}55, ${c}33, transparent)`;
  bar.style.animation = 'none'; void bar.offsetWidth;
  bar.style.animation = 'phaseHighlight 1.4s ease forwards';

  textEl.style.animation = 'none'; void textEl.offsetWidth;
  textEl.style.animation = 'phaseSlideIn 1.4s ease forwards';

  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; if (callback) callback(); }, 1500);
}

// ===== 演出: スキップアナウンス =====

export function showSkipAnnounce(text, callback) {
  const overlay = document.getElementById('skip-announce-overlay');
  const textEl = document.getElementById('skip-announce-text');

  textEl.innerText = text;
  textEl.style.animation = 'none'; void textEl.offsetWidth;
  textEl.style.animation = 'skipFadeUp 1s ease forwards';

  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; if (callback) callback(); }, 1100);
}

// ===== 演出: ドロー =====

export function doDraw(side, reason, callback) {
  const deck = bs[side].deck;
  const hand = bs[side].hand;
  if (deck.length === 0) { callback && callback(); return; }

  const c = deck.splice(0, 1)[0];
  hand.push(c);
  const isLv6 = parseInt(c.level) >= 6;
  addLog('🃏 ' + reason + '：「' + c.name + '」');
  showDrawEffect(c, isLv6, () => { renderAll(); callback && callback(); });
}

export function showDrawEffect(card, isLv6Plus, callback) {
  const overlay = document.getElementById('draw-overlay');
  if (!overlay) { callback && callback(); return; }

  const imgEl = document.getElementById('draw-card-img');
  const nameEl = document.getElementById('draw-card-name');
  const labelEl = document.getElementById('draw-label');

  imgEl.style.opacity = '0'; imgEl.style.transform = 'translateY(40px)';
  nameEl.style.opacity = '0'; labelEl.style.opacity = '0';

  const src = cardImg(card);
  imgEl.innerHTML = src
    ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="color:#fff;font-size:10px;padding:8px;">${card.name}</div>`;
  nameEl.innerText = card.name;

  if (isLv6Plus) {
    imgEl.style.borderColor = '#ff00fb';
    imgEl.style.boxShadow = '0 0 80px rgba(255,0,251,0.9), 0 0 150px rgba(255,0,251,0.5)';
    imgEl.style.width = '160px'; imgEl.style.height = '224px'; imgEl.style.borderWidth = '3px';
    labelEl.style.color = '#ff00fb'; labelEl.innerText = '★ MEGA DRAW! ★';
    labelEl.style.fontSize = '1.3rem'; labelEl.style.textShadow = '0 0 20px #ff00fb, 0 0 40px #ff00fb';
    nameEl.style.fontSize = '1.2rem';
  } else {
    imgEl.style.borderColor = '#00ff88';
    imgEl.style.boxShadow = '0 0 30px rgba(0,255,136,0.6)';
    imgEl.style.width = '100px'; imgEl.style.height = '140px'; imgEl.style.borderWidth = '2px';
    labelEl.style.color = '#00ff88'; labelEl.innerText = 'DRAW!';
    labelEl.style.fontSize = '0.8rem'; labelEl.style.textShadow = '';
    nameEl.style.fontSize = '1rem';
  }

  overlay.style.display = 'flex';

  if (isLv6Plus) {
    // ===== 前兆演出（暗転→振動→光の筋→「...!?」→パルスリング）→ カード登場 =====
    overlay.style.background = 'rgba(0,0,0,0.97)';
    const premon = document.getElementById('draw-premonition');
    const streak1 = document.getElementById('draw-light-streak1');
    const streak2 = document.getElementById('draw-light-streak2');
    const prText = document.getElementById('draw-premonition-text');
    const pulseRing = document.getElementById('draw-pulse-ring');
    const shakeLayer = document.getElementById('draw-shake-layer');

    if (premon) {
      premon.style.display = 'block';
      // Phase1: 画面振動（0～800ms）
      shakeLayer.style.animation = 'megaDrawShake 0.3s ease infinite';
      // Phase2: 光の筋が横切る（200ms, 500ms）
      setTimeout(() => { streak1.style.animation = 'megaDrawLightStreak 0.4s ease forwards'; }, 200);
      setTimeout(() => { streak2.style.animation = 'megaDrawLightStreak 0.35s ease forwards'; }, 500);
      // Phase3: 「...!?」テキスト（400ms）
      setTimeout(() => { prText.style.opacity = '1'; }, 400);
      // Phase4: パルスリング（700ms）
      setTimeout(() => { pulseRing.style.animation = 'megaDrawPulseRing 0.5s ease-out forwards'; }, 700);
      // Phase5: 振動停止、前兆消去、カード登場へ（1200ms）
      setTimeout(() => {
        shakeLayer.style.animation = '';
        prText.style.opacity = '0';
        premon.style.display = 'none';
        streak1.style.animation = ''; streak2.style.animation = ''; pulseRing.style.animation = '';
        // カード登場
        labelEl.style.opacity = '1';
        setTimeout(() => {
          imgEl.style.opacity = '1';
          imgEl.style.transform = 'translateY(0) scale(1.2)';
          imgEl.style.transition = 'opacity 0.4s, transform 0.5s cubic-bezier(0.2,0.8,0.2,1)';
        }, 100);
        setTimeout(() => { imgEl.style.transform = 'translateY(0) scale(1)'; nameEl.style.opacity = '1'; }, 500);
        setTimeout(() => {
          imgEl.style.boxShadow = '0 0 100px rgba(255,0,251,1), 0 0 200px rgba(255,0,251,0.6)';
          setTimeout(() => { imgEl.style.boxShadow = '0 0 80px rgba(255,0,251,0.9), 0 0 150px rgba(255,0,251,0.5)'; }, 200);
        }, 800);
      }, 1200);
    }
    setTimeout(() => {
      overlay.style.display = 'none'; overlay.style.background = ''; imgEl.style.transition = '';
      callback && callback();
    }, 4200);
  } else {
    // ===== 通常ドロー =====
    overlay.style.background = 'rgba(0,0,0,0.85)';
    setTimeout(() => { imgEl.style.opacity = '1'; imgEl.style.transform = 'translateY(0)'; labelEl.style.opacity = '1';
      setTimeout(() => { nameEl.style.opacity = '1'; }, 200);
    }, 100);
    setTimeout(() => { overlay.style.display = 'none'; overlay.style.background = ''; callback && callback(); }, 1300);
  }
}

// ===== オンラインターン色 =====

// 先攻=シアン、後攻=ピンク（_isFirstPlayer はゲーム開始時に設定）
let _isFirstPlayer = true;

export function setFirstPlayer(isFirst) { _isFirstPlayer = isFirst; }

export function getMyTurnColor() {
  if (!_onlineMode) return '#00fbff';
  return _isFirstPlayer ? '#00fbff' : '#ff00fb';
}

export function getOppTurnColor() {
  if (!_onlineMode) return '#ff00fb';
  return _isFirstPlayer ? '#ff00fb' : '#00fbff';
}

// ===== プレイヤーターン開始 =====

export function startPlayerTurn() {
  bs.isPlayerTurn = true;
  showYourTurn('自分のターン開始', '', '#00fbff', () => {
    _hooks.checkTurnStartEffects('player', () => {
      // 両サイドの永続効果を再計算
      _hooks.applyPermanentEffects('player');
      _hooks.applyPermanentEffects('ai');
      renderAll();
      setTimeout(() => startPhase('unsuspend'), 300);
    });
  });
}

/**
 * ゲーム開始直後の初回ターン開始（先攻表示付き）
 */
export function startFirstTurn() {
  bs.isPlayerTurn = true;
  showYourTurn('自分のターン開始', '【先攻プレイヤー】', '#00fbff', () => {
    _hooks.checkTurnStartEffects('player', () => {
      _hooks.applyPermanentEffects('player');
      _hooks.applyPermanentEffects('ai');
      renderAll();
      setTimeout(() => startPhase('unsuspend'), 300);
    });
  });
}

// ===== フェーズ進行 =====

export function startPhase(phase) {
  bs.phase = phase;
  if (_onlineMode && _sendStateSync) { _sendStateSync(); }
  if (_onlineMode && _sendCommand) { _sendCommand({ type: 'phase', phase }); }

  const info = PHASE_NAMES[phase];

  // チュートリアル: フェーズ変更通知（指差し表示/非表示制御用）
  const runner = (typeof window !== 'undefined') ? window._tutorialRunner : null;
  if (runner && runner.active && typeof runner.onPhaseChange === 'function') {
    try { runner.onPhaseChange(phase); } catch (e) {}
  }

  // チュートリアル: フェーズ説明ポップアップ (showPhaseGuide=true のシナリオのみ)
  const needsGuide = runner && runner.active && typeof runner.notifyPhaseChange === 'function'
    && runner.scenario && runner.scenario.showPhaseGuide
    && runner._shownPhases && !runner._shownPhases[phase];

  const proceed = () => {
    if (!info) { execPhase(phase); return; }
    showPhaseAnnounce(`${info.icon} ${info.name}`, PHASE_COLORS[phase], () => execPhase(phase));
  };

  if (needsGuide) {
    runner.notifyPhaseChange(phase).then(proceed);
  } else {
    proceed();
  }
}

function execPhase(phase) {
  if (phase === 'unsuspend') execUnsuspend();
  else if (phase === 'draw') execDraw();
  else if (phase === 'breed') execBreed();
  else if (phase === 'main') execMain();
}

// ----- アクティブフェイズ -----

function execUnsuspend() {
  const hasRested = bs.player.battleArea.some(c => c && c.suspended && !c.cantBeActive)
    || bs.player.tamerArea.some(c => c && c.suspended);

  if (hasRested) {
    bs.player.battleArea.forEach(c => {
      if (c) { if (!c.cantBeActive) c.suspended = false; c.summonedThisTurn = false; c._usedEffects = []; }
    });
    bs.player.tamerArea.forEach(c => {
      if (c) { c.suspended = false; c._usedEffects = []; }
    });
    addLog('🔄 アクティブフェイズ完了');
    renderAll();
    setTimeout(() => startPhase('draw'), 500);
  } else {
    // レスト無しでもリセットは実行
    bs.player.battleArea.forEach(c => { if (c) { c.summonedThisTurn = false; c._usedEffects = []; } });
    bs.player.tamerArea.forEach(c => { if (c) c.suspended = false; });
    showSkipAnnounce('🔄 アクティブフェイズ スキップ！', () => {
      addLog('🔄 アクティブフェイズ スキップ');
      setTimeout(() => startPhase('draw'), 300);
    });
  }
}

// ----- ドローフェイズ -----

function execDraw() {
  // 先攻1ターン目はドローなし
  if (bs.isFirstTurn && bs.turn <= 1) {
    bs.isFirstTurn = false;
    showSkipAnnounce('🃏 ドローフェイズ スキップ！（先攻1ターン目）', () => {
      addLog('🃏 先攻1ターン目：ドローなし');
      setTimeout(() => startPhase('breed'), 300);
    });
    return;
  }

  if (bs.player.deck.length > 0) {
    doDraw('player', 'ドロー', () => {
      setTimeout(() => startPhase('breed'), 300);
    });
  } else {
    _hooks.onDeckOut();
    return;
  }
}

// ----- 育成フェイズ -----

function execBreed() {
  const hasTama = bs.player.tamaDeck && bs.player.tamaDeck.length > 0;
  const canMove = bs.player.ikusei && bs.player.ikusei.level !== '2';
  if (!hasTama && !canMove) {
    addLog('🥚 育成フェイズ スキップ（デジタマなし）');
    setTimeout(() => startPhase('main'), 300);
    return;
  }

  addLog('🥚 育成フェイズ');
  const actionBar = document.getElementById('breed-action-bar');
  if (actionBar) {
    actionBar.innerHTML = '<button class="a-btn a-btn-cyan" onclick="skipBreedPhase()" style="width:100%;">何もしない → メインフェイズへ</button>';
    actionBar.style.display = 'block';
  }
  const ikuEl = document.getElementById('pl-iku-slot');
  if (ikuEl) ikuEl.classList.add('breed-hover-active');
  renderAll();
  // プレイヤーの操作を待つ（孵化/移動/パス）
}

export function exitBreedPhase() {
  const actionBar = document.getElementById('breed-action-bar');
  if (actionBar) actionBar.style.display = 'none';
  const ikuEl = document.getElementById('pl-iku-slot');
  if (ikuEl) {
    ikuEl.classList.remove('breed-hover-active');
    ikuEl.style.border = ''; ikuEl.style.boxShadow = '';
    ikuEl.onclick = null; ikuEl.ontouchstart = null; ikuEl.ontouchend = null;
  }
}

export function breedActionDone() {
  renderAll();
  exitBreedPhase();
  setTimeout(() => startPhase('main'), 600);
}

export function skipBreedPhase() {
  showSkipAnnounce('🥚 育成フェイズ スキップ！', () => {
    addLog('🥚 育成フェイズをスキップ');
    breedActionDone();
  });
}

// ----- メインフェイズ -----

function execMain() {
  exitBreedPhase();
  addLog('⚡ メインフェイズ');
  renderAll();
  // プレイヤーの操作を待つ（登場/進化/アタック/ターン終了）
}

// ===== 手動ターン終了 =====

export function onEndTurn() {
  if (!bs.isPlayerTurn) return;
  exitBreedPhase();

  if (_onlineMode) {
    bs.memory = -3;
    if (_sendCommand) _sendCommand({ type: 'endTurn', memory: bs.memory });
    updateMemGauge();
    // プレイヤーのターン終了 → endingSide='player'
    _hooks.expireBuffs('dur_this_turn', null, 'player');
    _hooks.expireBuffs('dur_next_opp_turn', null, 'player');
    _hooks.expireBuffs('dur_next_own_turn', null, 'player');
    _hooks.expireBuffs('permanent', 'player');
    renderAll();
    showYourTurn('自分のターン終了', '', '#555555', () => {
      bs.isPlayerTurn = false;
      showYourTurn('相手のターン', '🎮 相手の操作を待っています...', '#ff00fb', () => {
        addLog('⏳ 相手のターン（操作待ち）');
      });
    });
    return;
  }

  // AI対戦
  _hooks.checkTurnEndEffects(async () => {
    // チュートリアル割り込み: ターン終了直前
    if (window._tutorialRunner && window._tutorialRunner.active) {
      await window._tutorialRunner.checkInterrupt('before_end_turn');
    }
    bs.memory = -3;
    updateMemGauge();
    // プレイヤーのターン終了
    _hooks.expireBuffs('dur_this_turn', null, 'player');
    _hooks.expireBuffs('dur_next_opp_turn', null, 'player');
    _hooks.expireBuffs('dur_next_own_turn', null, 'player');
    _hooks.expireBuffs('permanent', 'player');
    renderAll();
    showYourTurn('自分のターン終了', '', '#555555', () => {
      bs.isPlayerTurn = false;
      setTimeout(() => aiTurn(), 500);
    });
  });
}

// ===== 自動ターン終了（メモリーオーバーフロー時） =====

export function checkAutoTurnEnd() {
  if (bs.memory >= 0) return false;

  const over = Math.abs(bs.memory);
  addLog('💾 メモリー' + over + 'で相手側へ');
  bs.isPlayerTurn = false;
  // プレイヤーのターン終了
  _hooks.expireBuffs('dur_this_turn', null, 'player');
  _hooks.expireBuffs('dur_next_opp_turn', null, 'player');
  _hooks.expireBuffs('dur_next_own_turn', null, 'player');
  _hooks.expireBuffs('permanent', 'player');
  renderAll(true);

  _hooks.checkTurnEndEffects(async () => {
    // チュートリアル割り込み: メモリー相手側到達
    if (window._tutorialRunner && window._tutorialRunner.active) {
      await window._tutorialRunner.checkInterrupt('memory_crossed');
      await window._tutorialRunner.checkInterrupt('before_end_turn');
    }
    if (_onlineMode) {
      if (_sendCommand) _sendCommand({ type: 'endTurn', memory: bs.memory });
      showYourTurn('自分のターン終了', '', '#555555', () => {
        showYourTurn('相手のターン', '🎮 相手の操作を待っています...', '#ff00fb', () => {});
      });
    } else {
      // AI対戦: 相手メモリーは超過した絶対値
      bs.memory = over;
      updateMemGauge();
      showYourTurn('自分のターン終了', '', '#555555', () => {
        setTimeout(() => aiTurn(), 500);
      });
    }
  });
  return true;
}

// ===== AI ターン =====

export async function aiTurn() {
  if (bs._battleAborted) return;
  if (_onlineMode) return;

  // チュートリアル割り込み: 相手ターン開始前
  if (window._tutorialRunner && window._tutorialRunner.active) {
    await window._tutorialRunner.checkInterrupt('before_opponent_turn');
  }

  bs.turn++;
  showYourTurn('相手のターン開始', '🤖 デジモンマスター', '#ff00fb', () => {
    _hooks.checkTurnStartEffects('ai', () => {
      _hooks.applyPermanentEffects('player');
      _hooks.applyPermanentEffects('ai');
      renderAll();
      addLog('🤖 AIのターン');
      aiPhaseUnsuspend();
    });
  });
}

// ----- AI アクティブフェイズ -----

function aiPhaseUnsuspend() {
  const hasRested = bs.ai.battleArea.some(c => c && c.suspended);
  if (hasRested) {
    showPhaseAnnounce('🔄 アクティブフェイズ', '#00fbff', () => {
      bs.ai.battleArea.forEach(c => {
        if (c) { c.suspended = false; c.summonedThisTurn = false; c._usedEffects = []; }
      });
      addLog('🤖 アクティブフェイズ完了');
      renderAll();
      setTimeout(() => aiPhaseDraw(), 500);
    });
  } else {
    showSkipAnnounce('🔄 アクティブフェイズ スキップ！', () => {
      bs.ai.battleArea.forEach(c => { if (c) { c.summonedThisTurn = false; c._usedEffects = []; } });
      setTimeout(() => aiPhaseDraw(), 300);
    });
  }
}

// ----- AI ドローフェイズ -----

function aiPhaseDraw() {
  if (bs.ai.deck.length > 0) {
    const c = bs.ai.deck.splice(0, 1)[0];
    bs.ai.hand.push(c);
    showPhaseAnnounce('🃏 ドローフェイズ', '#00ff88', () => {
      addLog('🤖 AIがドロー');
      renderAll();
      setTimeout(() => aiPhaseBreed(), 500);
    });
  } else {
    addLog('⚠ AIのデッキ切れ！');
    // TODO: Phase 4 で勝利処理を実装
    return;
  }
}

// ----- AI 育成フェイズ -----

function aiPhaseBreed() {
  // 育成エリアにLv3以上 → バトルエリアへ移動
  if (bs.ai.ikusei && parseInt(bs.ai.ikusei.level) >= 3) {
    let slot = bs.ai.battleArea.findIndex(s => s === null);
    if (slot === -1) { slot = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }
    showPhaseAnnounce('🥚 育成フェイズ', '#ff9900', () => {
      const moved = bs.ai.ikusei;
      bs.ai.battleArea[slot] = moved;
      bs.ai.ikusei = null;
      addLog('🤖 AIが「' + moved.name + '」を育成エリアからバトルエリアへ移動');
      renderAll();
      _hooks.checkAndTriggerEffect(moved, '【登場時】', () => {
        // 育成エリアが空 → 孵化も試みる
        if (!bs.ai.ikusei && bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0) {
          const c = bs.ai.tamaDeck.splice(0, 1)[0];
          bs.ai.ikusei = c;
          addLog('🤖 AIがデジタマを孵化！');
          renderAll();
          setTimeout(() => aiPhaseMain(), 500);
        } else {
          setTimeout(() => aiPhaseMain(), 500);
        }
      }, 'ai');
    });
  }
  // 育成エリアが空でデジタマあり → 孵化
  else if (!bs.ai.ikusei && bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0) {
    const c = bs.ai.tamaDeck.splice(0, 1)[0];
    bs.ai.ikusei = c;
    showPhaseAnnounce('🥚 育成フェイズ', '#ff9900', () => {
      addLog('🤖 AIがデジタマを孵化！');
      renderAll();
      setTimeout(() => aiPhaseMain(), 500);
    });
  }
  // スキップ
  else {
    showSkipAnnounce('🥚 育成フェイズ スキップ！', () => {
      setTimeout(() => aiPhaseMain(), 300);
    });
  }
}

// ----- AI メインフェイズ -----

function aiPhaseMain() {
  showPhaseAnnounce('⚡ メインフェイズ', '#ff00fb', () => {
    addLog('🤖 メインフェイズ');
    _hooks.aiMainPhase(() => {
      _hooks.aiAttackPhase(() => {
        endAiTurn();
      });
    });
  });
}

// ----- AI ターン終了 -----

function endAiTurn() {
  // AIのターン終了 → endingSide='ai'
  _hooks.expireBuffs('dur_this_turn', null, 'ai');
  _hooks.expireBuffs('dur_next_opp_turn', null, 'ai');
  _hooks.expireBuffs('dur_next_own_turn', null, 'ai');
  _hooks.expireBuffs('permanent', 'ai');
  renderAll();

  // プレイヤー側3にメモリ移動
  bs.memory = 3;
  updateMemGauge();

  showYourTurn('相手のターン終了', '', '#555555', () => {
    bs.isPlayerTurn = true;
    startPlayerTurn();
  });
}

// ===== エクスポート: フェーズ定数 =====

export { PHASE_NAMES, PHASE_COLORS };
