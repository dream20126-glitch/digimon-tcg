/**
 * battle.js — バトル画面エントリポイント
 *
 * 各サブモジュールをimportし、window公開・イベント配線を行う
 * ロジック本体はサブモジュール側に記述
 */

import { getCardImageUrl } from './cards.js';
// Phase 1: 状態管理
import { bs, resetBattleState, drawCards } from './battle-state.js';
// Phase 2: UI・描画
import { addLog, showConfirm, showScreen } from './battle-ui.js';
import { renderAll, showBCD, closeBCD, showTrash, cardImg, setOnlineInfo, setIkuCallbacks } from './battle-render.js';
// Phase 3: フェーズ進行
import { startFirstTurn, startPhase, onEndTurn, skipBreedPhase, breedActionDone, showYourTurn, showPhaseAnnounce, showSkipAnnounce, doDraw, aiTurn, setPhaseHooks, setOnlineHandlers } from './battle-phase.js';
// Phase 4: 戦闘
import { doPlay, doEvolve, doEvolveIku, canEvolveOnto, startAttack, cancelAttack, resolveAttackTarget, aiAttackPhase, aiMainPhase, battleVictory, battleDefeat, showPlayEffect, showEvolveEffect, showOptionEffect, showSecurityCheck, showBattleResult, showDestroyEffect, showDirectAttack, showBlockConfirm, showBlockerSelection, setCombatOnlineHandlers } from './battle-combat.js';
// Phase 5: 演出
import { loadAllDictionaries, registerFxRunners } from './effect-engine.js';
import { getFxRunners, fxSAttackPlus, fxRemoteEffect, fxRemoteEffectClose } from './battle-fx.js';
import { expireBuffs as _expireBuffsEE, applyPermanentEffects as _applyPermanentEE, triggerEffect as _triggerEffectEE } from './effect-engine.js';
// Phase 6: オンライン
import { initOnline, startOnlineListener, sendCommand, sendStateSync, sendMemoryUpdate, cleanupOnline, isOnlineMode, setOnlineModules } from './battle-online.js';

// ===== デッキパーサー =====
function parseDeck(deckData) {
  if (!deckData || !deckData.list) return [];
  const out = [];
  deckData.list.split(',').forEach(line => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (!m) return;
    const cardNo = m[2], count = parseInt(m[3]);
    const obj = allCards.find(c => c["カードNo"] === cardNo) || {};
    const playCost = obj["登場コスト"], evolveCost = obj["進化コスト"];
    const hasPlay = playCost !== undefined && playCost !== '' && playCost !== null;
    const hasEvolve = evolveCost !== undefined && evolveCost !== '' && evolveCost !== null;
    for (let i = 0; i < count; i++) out.push({
      name: obj["名前"] || m[1], cardNo, level: String(obj["レベル"] || '?'),
      dp: parseInt(obj["DP"] || 0), baseDp: parseInt(obj["DP"] || 0), dpModifier: 0,
      playCost: hasPlay ? parseInt(playCost) : null,
      evolveCost: hasEvolve ? parseInt(evolveCost) : null,
      evolveCond: obj["進化条件"] || '',
      cost: hasPlay ? parseInt(playCost) : hasEvolve ? parseInt(evolveCost) : 0,
      effect: obj["効果"] || '', evoSourceEffect: obj["進化元効果"] || '',
      securityEffect: obj["セキュリティ効果"] || '', recipe: obj["効果レシピ"] || null,
      imageUrl: obj["ImageURL"] || '', imgSrc: getCardImageUrl(obj) || '',
      type: obj["タイプ"] || '', color: obj["色"] || '', feature: obj["特徴"] || '',
      stack: [], suspended: false, buffs: [],
      cantBeActive: false, cantAttack: false, cantBlock: false,
      summonedThisTurn: false, _pendingDestroy: false,
    });
  });
  return out;
}

// ===== シャッフル =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function strToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  function next() { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== window公開（HTML onclick等から呼べるように） =====
window.showBCD = showBCD;
window.closeBCD = closeBCD;
window.showTrash = showTrash;
window.renderAll = renderAll;

// Phase 3: フェーズ進行
window.onEndTurn = onEndTurn;
window.skipBreedPhase = skipBreedPhase;
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

// 効果エンジン連携（battle-render.jsのactivateEffectから使用）
window._triggerMainEffect = function(card, callback) {
  const inPlayer = bs.player.battleArea.includes(card) || bs.player.tamerArea.includes(card);
  const side = inPlayer ? 'player' : 'ai';
  try { _triggerEffectEE('main', card, side, { card, side, bs, addLog, renderAll, updateMemGauge: () => { import('./battle-render.js').then(m => m.updateMemGauge()); } }, callback); }
  catch (_) { callback && callback(); }
};

// HTML onclick から呼ばれる補助関数
window.confirmExitGate = function() {
  showConfirm({ title: '⚠ 退室確認', message: 'ゲートを出ますか？\nバトルの進行状況は失われます。', yesText: 'はい', noText: 'いいえ', color: '#ff4444' }).then(yes => {
    if (!yes) return;
    if (isOnlineMode()) sendCommand({ type: 'player_exit', playerName: '' });
    cleanupOnline();
    showScreen(isOnlineMode() ? 'room-entrance-screen' : 'tutorial-screen');
  });
};
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
// ===== マリガン =====
let _mulliganUsed = false;

function showMulliganOverlay() {
  _mulliganUsed = false;
  const btn = document.getElementById('mulligan-btn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerText = '引き直す'; }
  document.getElementById('mulligan-overlay').style.display = 'flex';
  renderMulliganPreview(true);
}

function renderMulliganPreview(animate) {
  const area = document.getElementById('mulligan-hand-preview'); if (!area) return;
  const backUrl = 'https://drive.google.com/thumbnail?id=1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9&sz=w200';
  area.innerHTML = '';
  const cards = [];
  bs.player.hand.forEach((c, i) => {
    const src = cardImg(c);
    const div = document.createElement('div');
    div.className = 'mulligan-card';
    div.style.perspective = '200px';
    div.innerHTML = `<div class="mulligan-card-inner" style="width:100%;height:100%;position:relative;transition:transform 0.5s;transform-style:preserve-3d;">
      <div style="position:absolute;inset:0;backface-visibility:hidden;">${backUrl ? `<img src="${backUrl}" style="width:100%;height:100%;object-fit:cover;">` : '<div style="width:100%;height:100%;background:#1a1a3a;border-radius:4px;"></div>'}</div>
      <div style="position:absolute;inset:0;backface-visibility:hidden;transform:rotateY(180deg);">${src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="font-size:7px;color:#aaa;padding:3px;">${c.name}</div>`}</div>
    </div>`;
    if (animate) div.style.animation = `mulliganDeal 0.4s ease ${i * 0.15}s forwards`;
    else { div.style.opacity = '1'; const inner = div.querySelector('.mulligan-card-inner'); if (inner) inner.style.transform = 'rotateY(180deg)'; }
    area.appendChild(div);
    cards.push(div);
  });
  if (animate) {
    const flipDelay = 5 * 150 + 400 + 200;
    setTimeout(() => {
      cards.forEach((div, i) => {
        const inner = div.querySelector('.mulligan-card-inner');
        if (inner) { inner.style.transition = `transform 0.5s ease ${i * 0.08}s`; inner.style.transform = 'rotateY(180deg)'; }
      });
    }, flipDelay);
  }
}

function animateSecuritySet(callback) {
  const tempPlSec = bs.player.security;
  const tempAiSec = bs.ai.security;
  bs.player.security = []; bs.ai.security = [];
  renderAll();
  let count = 0;
  const total = tempPlSec.length;
  function placeNext() {
    if (count >= total) { setTimeout(callback, 400); return; }
    bs.player.security.push(tempPlSec[count]);
    bs.ai.security.push(tempAiSec[count]);
    count++;
    renderAll();
    // セキュリティエリアにアニメーション
    ['pl', 'ai'].forEach(side => {
      const area = document.getElementById(side + '-sec-area'); if (!area) return;
      const cards = area.querySelectorAll('.sec-card');
      const last = cards[cards.length - 1]; if (!last) return;
      last.style.transition = 'none'; last.style.opacity = '0'; last.style.transform = 'translateX(60px) scale(0.5)';
      requestAnimationFrame(() => {
        last.style.transition = 'all 0.3s cubic-bezier(0.2,0.8,0.2,1)';
        last.style.opacity = '1'; last.style.transform = 'translateX(0) scale(1)';
      });
    });
    setTimeout(placeNext, 250);
  }
  setTimeout(placeNext, 300);
}

window.acceptHand = function() {
  document.getElementById('mulligan-overlay').style.display = 'none';
  bs.player.security = bs.player.deck.splice(0, 5);
  bs.ai.security = bs.ai.deck.splice(0, 5);
  addLog('🛡 セキュリティをセットしています...');
  animateSecuritySet(() => {
    addLog('🛡 セキュリティセット完了！');
    if (isOnlineMode() && !bs.isPlayerTurn) {
      showYourTurn('相手のターン', '🎮 相手の操作を待っています...', '#ff00fb', () => {
        addLog('⏳ 相手のターン（操作待ち）'); renderAll();
      });
    } else {
      startFirstTurn();
    }
  });
};

window.doMulligan = function() {
  if (_mulliganUsed) return;
  _mulliganUsed = true;
  bs.player.deck = bs.player.deck.concat(bs.player.hand);
  bs.player.hand = [];
  bs.player.deck = shuffle(bs.player.deck);
  drawCards('player', 5);
  const btn = document.getElementById('mulligan-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.3'; btn.innerText = '引き直し済み'; }
  renderMulliganPreview(true);
  addLog('🔄 マリガン！手札を引き直しました');
};

// Phase 3 ↔ Phase 4 フック接続
setPhaseHooks({
  aiMainPhase: aiMainPhase,
  aiAttackPhase: aiAttackPhase,
  onDeckOut: () => { addLog('⚠ デッキ切れ！'); battleDefeat(); },
});

// Phase 5: 演出エンジン接続
registerFxRunners(getFxRunners());

// Phase 6: オンラインモジュールに各演出/フェーズ関数を注入
setOnlineModules({
  showYourTurn, showPhaseAnnounce, startPhase,
  showPlayEffect, showEvolveEffect, showSecurityCheck, showBattleResult,
  showDestroyEffect, showDirectAttack, showOptionEffect,
  showBlockConfirm, showBlockerSelection,
  showGameEndOverlay: null, // battle-combat.js 内の showGameEndOverlay は非export → battleVictory/battleDefeat で代替
  fxSAttackPlus, fxRemoteEffect, fxRemoteEffectClose,
  checkTurnStartEffects: (side, cb) => cb(), // Phase 3 のフック経由
  applyPermanentEffects: (side) => { try { _applyPermanentEE(bs, side, { bs, side }); } catch (_) {} },
  expireBuffs: (timing, side) => { try { _expireBuffsEE(bs, timing, side); } catch (_) {} },
});

// 育成エリア操作コールバック
setIkuCallbacks({
  onHatch: (card) => {
    if (isOnlineMode()) sendCommand({ type: 'hatch', cardName: card.name, cardImg: card.imgSrc || '' });
    renderAll();
    breedActionDone();
  },
  onBreedMove: (card) => {
    if (isOnlineMode()) {
      sendCommand({ type: 'breed_move', cardName: card.name, cardImg: card.imgSrc || '' });
      sendStateSync();
    }
    breedActionDone();
  },
});

// Phase 3/4 にオンラインハンドラーを接続
setOnlineHandlers(false, null, { sendCommand, sendStateSync, sendMemoryUpdate });
setCombatOnlineHandlers(false, null, { sendCommand, sendStateSync, sendMemoryUpdate });

// ===== ゲーム開始（デッキデータから初期化 → 描画テスト） =====
window.startBattleGame = async function(playerDeckData, aiDeckData, playerFirst) {
  addLog('🎮 バトル開始');

  // 辞書読み込み
  await loadAllDictionaries();

  // 状態リセット
  resetBattleState(playerFirst);
  bs.phase = 'standby';

  // デッキパース
  const plCards = parseDeck(playerDeckData);
  const aiCards = parseDeck(aiDeckData);

  // シャッフル & デッキセット
  bs.player.tamaDeck = shuffle(plCards.filter(c => c.level === '2'));
  bs.player.deck = shuffle(plCards.filter(c => c.level !== '2'));
  bs.ai.tamaDeck = shuffle(aiCards.filter(c => c.level === '2'));
  bs.ai.deck = shuffle(aiCards.filter(c => c.level !== '2'));

  // 手札5枚ドロー
  drawCards('player', 5);
  drawCards('ai', 5);

  addLog('🃏 手札: ' + bs.player.hand.length + '枚 / デッキ: ' + bs.player.deck.length + '枚');

  // 画面描画
  showScreen('battle-screen');
  renderAll();

  addLog('✅ バトル画面描画完了');

  // マリガン画面を表示 → acceptHand でセキュリティ配置 → ターン開始
  showMulliganOverlay();
};

// ===== デモ用: ダミーデッキでバトル開始 =====
window.startBattleDemo = async function() {
  // ダミーのデッキデータ（50枚になるよう各カードを複数枚入れる）
  const mainCards = allCards.filter(c => c["タイプ"] !== 'デジタマ');
  const tamaCards = allCards.filter(c => c["タイプ"] === 'デジタマ');

  // メインデッキ: 50枚になるまでカードを繰り返す
  const mainList = [];
  let idx = 0;
  while (mainList.length < 50 && mainCards.length > 0) {
    const c = mainCards[idx % mainCards.length];
    mainList.push(c["名前"] + '(' + c["カードNo"] + ')x1');
    idx++;
  }

  // デジタマデッキ: 最大5枚
  const tamaList = tamaCards.slice(0, 5).map(c =>
    c["名前"] + '(' + c["カードNo"] + ')x1'
  );

  const dummyDeck = { list: mainList.join(',') + ',' + tamaList.join(',') };

  addLog('📦 ダミーデッキ: メイン' + mainList.length + '枚 + タマ' + tamaList.length + '枚');
  await window.startBattleGame(dummyDeck, dummyDeck, true);
};

// ===== スクロールボタン =====
window.scrollHand = function(direction) {
  const el = document.getElementById('hand-wrap');
  if (el) el.scrollBy({ left: direction * 80, behavior: 'smooth' });
};
window.scrollBattleRow = function(side, direction) {
  const el = document.getElementById(side + '-battle-row');
  if (el) el.scrollBy({ left: direction * 80, behavior: 'smooth' });
};

// ===== オンラインバトル開始 =====
window.startOnlineBattle = async function(playerDeckData, oppDeckData, playerFirst, roomId, myKey, oppName) {
  await initOnline(roomId, myKey);
  // Phase 3/4 のオンラインハンドラーを有効化
  setOnlineHandlers(true, myKey, { sendCommand, sendStateSync, sendMemoryUpdate });
  setCombatOnlineHandlers(true, myKey, { sendCommand, sendStateSync, sendMemoryUpdate });
  setOnlineInfo(true, myKey);
  // ゲーム開始
  await window.startBattleGame(playerDeckData, oppDeckData, playerFirst);
  // 相手の名前を表示
  const oppLabel = document.getElementById('opponent-name-label');
  if (oppLabel) oppLabel.innerText = '🎮 ' + (oppName || '相手プレイヤー');
  // リスナー開始
  startOnlineListener();
};

// ===== 初期化 =====
console.log('[battle.js] 新バトルモジュール読み込み完了');
