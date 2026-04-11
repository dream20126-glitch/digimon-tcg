/**
 * battle.js --- バトル画面エントリポイント
 *
 * 各サブモジュールをimportし、window公開・イベント配線を行う
 * ロジック本体はサブモジュール側に記述
 */

import { getCardImageUrl } from './cards.js';
// Phase 1: 状態管理
import { bs, resetBattleState, drawCards } from './battle-state.js';
// Phase 2: UI・描画
import { addLog, showConfirm, showScreen } from './battle-ui.js';
import { renderAll, showBCD, closeBCD, showTrash, cardImg, updateMemGauge, setOnlineInfo, setIkuCallbacks, doIkuMove } from './battle-render.js';
// Phase 3: フェーズ進行
import { startFirstTurn, startPhase, onEndTurn, skipBreedPhase, breedActionDone, showYourTurn, showPhaseAnnounce, showSkipAnnounce, doDraw, aiTurn, setPhaseHooks, setOnlineHandlers, setFirstPlayer } from './battle-phase.js';
// Phase 4: 戦闘
import { doPlay, doEvolve, doEvolveIku, canEvolveOnto, startAttack, cancelAttack, resolveAttackTarget, aiAttackPhase, aiMainPhase, battleVictory, battleDefeat, showPlayEffect, showEvolveEffect, showOptionEffect, showSecurityCheck, showBattleResult, showDestroyEffect, showDirectAttack, showBlockConfirm, showBlockerSelection, showGameEndOverlay, setCombatHooks, setCombatOnlineHandlers } from './battle-combat.js';
// Phase 5: 演出
import { loadAllDictionaries, registerFxRunners } from './effect-engine.js';
import { getFxRunners, fxSAttackPlus, fxHatchEffect, fxRemoteEffect, fxRemoteEffectClose, fxCardMove } from './battle-fx.js';
import { expireBuffs as _expireBuffsEE, applyPermanentEffects as _applyPermanentEE, triggerEffect as _triggerEffectEE } from './effect-engine.js';
// Phase 6: オンライン
import { initOnline, startOnlineListener, sendCommand, sendStateSync, sendMemoryUpdate, cleanupOnline, isOnlineMode, setOnlineModules } from './battle-online.js';

// 共通コード
import { makeEffectContext, checkTurnStartEffects, buildOnlineEffectHooks, setupCommonHooks } from './battle-common.js';

// ===== スプシ列名揺れ対応ヘルパー =====
function _f(obj, ...names) {
  for (const n of names) {
    const v = obj[n];
    if (v !== undefined && v !== null && v !== '' && v !== 'なし') return v;
  }
  return undefined;
}

// ===== デッキパーサー =====
function parseDeck(deckData) {
  if (!deckData || !deckData.list) return [];
  const out = [];
  deckData.list.split(',').forEach(line => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (!m) return;
    const cardNo = m[2], count = parseInt(m[3]);
    const obj = allCards.find(c => c["カードNo"] === cardNo) || {};
    const playCost = _f(obj, '登場コスト', '登場\nコスト');
    const evolveCost = _f(obj, '進化コスト', '進化\nコスト');
    const level = _f(obj, 'レベル', 'Lv');
    const hasPlay = playCost !== undefined;
    const hasEvolve = evolveCost !== undefined;
    for (let i = 0; i < count; i++) out.push({
      name: obj["名前"] || m[1], cardNo, level: String(level ?? '?'),
      dp: parseInt(obj["DP"] || 0), baseDp: parseInt(obj["DP"] || 0), dpModifier: 0,
      playCost: hasPlay ? parseInt(playCost) : null,
      evolveCost: hasEvolve ? parseInt(evolveCost) : null,
      evolveCond: obj["進化条件"] || '',
      cost: hasPlay ? parseInt(playCost) : hasEvolve ? parseInt(evolveCost) : 0,
      effect: obj["効果テキスト"] || obj["効果"] || '', evoSourceEffect: obj["進化元テキスト"] || obj["進化元効果"] || '',
      securityEffect: obj["セキュリティテキスト"] || obj["セキュリティ効果"] || '', recipe: obj["レシピ"] || obj["効果レシピ"] || null,
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

// ===== 共通フック・window公開セットアップ =====
setupCommonHooks();

// HTML onclick から呼ばれる補助関数（battle.js固有）
window.confirmExitGate = function() {
  showConfirm({ title: '⚠ 退室確認', message: 'ゲートを出ますか？\nバトルの進行状況は失われます。', yesText: 'はい', noText: 'いいえ', color: '#ff4444' }).then(yes => {
    if (!yes) return;
    const wasOnline = isOnlineMode();
    if (wasOnline) sendCommand({ type: 'player_exit', playerName: '' });
    cleanupOnline();
    showScreen(wasOnline ? 'room-entrance-screen' : 'tutorial-screen');
  });
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
    // タップでカード詳細
    div.onclick = ((idx) => () => { if (window.showBCD) window.showBCD(idx, 'mulliganHand'); })(i);
    div.style.cursor = 'pointer';
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
  // 相手のセキュリティ:
  // - オフライン: 自分でAIのセキュリティをセット
  // - オンライン: 相手から security_init で送られてくる
  //   既にsecurity_initが届いて bs._aiSecuritySynced=true なら、ローカル推測で上書きしない
  //   （上書きすると相手側のデバッグ仕込み等が消えて不整合になる）
  const aiSecGuess = bs.ai.deck.splice(0, 5);
  if (!isOnlineMode() || !bs._aiSecuritySynced) {
    bs.ai.security = aiSecGuess;
  }

  // === デバッグ: セキュリティの先頭にテイマーを仕込む ===
  if (window._DEBUG_TAMER_IN_SECURITY) {
    const side = bs.player; // 自分のセキュリティにのみ仕込む
    const tamers = [...side.deck, ...side.hand, ...side.security].filter(c => c.type === 'テイマー').slice(0, 2);
    if (tamers.length > 0) { side.security.unshift(...tamers); console.log('[DEBUG] テイマー仕込み:', tamers.map(t => t.name)); }
    else {
      const dummies = [
        { name: '石田ヤマト(テスト)', cardNo: 'DEBUG-T1', type: 'テイマー', level: '', dp: 0, cost: 3, playCost: 3, effect: '【自分のターン開始時】メモリー+1する。', securityEffect: 'なし', evoSourceEffect: '', color: '青', feature: '', imgSrc: '', suspended: false, buffs: [], stack: [] },
        { name: '八神太一(テスト)', cardNo: 'DEBUG-T2', type: 'テイマー', level: '', dp: 0, cost: 4, playCost: 4, effect: '【自分のターン開始時】メモリー+1する。', securityEffect: 'なし', evoSourceEffect: '', color: '赤', feature: '', imgSrc: '', suspended: false, buffs: [], stack: [] },
      ];
      side.security.unshift(...dummies); console.log('[DEBUG] ダミーテイマー仕込み');
    }
  }

  // === デバッグ: 任意のカードをセキュリティの1番上(=最初にめくれる位置)に仕込む ===
  // 使い方:
  //   コンソールで window._DEBUG_INSERT_SECURITY_TOP = 'シャドーウィング' と入力してから新しいバトルを開始
  //   配列でも可: window._DEBUG_INSERT_SECURITY_TOP = ['シャドーウィング','スターライトエクスプロージョン']
  //   後方互換: window._DEBUG_SHADOW_WING_IN_SECURITY = true でもシャドーウィングを仕込める
  {
    const debugNames = window._DEBUG_INSERT_SECURITY_TOP
      ? (Array.isArray(window._DEBUG_INSERT_SECURITY_TOP) ? window._DEBUG_INSERT_SECURITY_TOP : [window._DEBUG_INSERT_SECURITY_TOP])
      : (window._DEBUG_SHADOW_WING_IN_SECURITY ? ['シャドーウィング'] : []);
    if (debugNames.length > 0) {
      const side = bs.player;
      // 配列順に unshift すると逆順に並ぶので、後ろから unshift して順序を保つ
      for (let i = debugNames.length - 1; i >= 0; i--) {
        const targetName = debugNames[i];
        // ① まずデッキ/手札/セキュリティから探す
        let card = null;
        let foundIn = null;
        const findIn = (arr) => {
          const idx = arr.findIndex(c => c && c.name === targetName);
          return idx !== -1 ? { arr, idx } : null;
        };
        let found = findIn(side.deck) || findIn(side.hand) || findIn(side.security);
        if (found) {
          card = found.arr.splice(found.idx, 1)[0];
          foundIn = found.arr === side.deck ? 'デッキ' : found.arr === side.hand ? '手札' : 'セキュリティ';
        } else {
          // ② allCards から探して新規生成（パース処理は parseDeck と同じ形式）
          const obj = (window.allCards || []).find(c => c['名前'] === targetName);
          if (obj) {
            const _f = (o, k1, k2) => o[k1] !== undefined ? o[k1] : o[k2];
            const playCost = _f(obj, '登場コスト', '登場\nコスト');
            const evolveCost = _f(obj, '進化コスト', '進化\nコスト');
            const level = _f(obj, 'レベル', 'Lv');
            const hasPlay = playCost !== undefined;
            const hasEvolve = evolveCost !== undefined;
            card = {
              name: obj['名前'], cardNo: obj['カードNo'] || '', level: String(level ?? '?'),
              dp: parseInt(obj['DP'] || 0), baseDp: parseInt(obj['DP'] || 0), dpModifier: 0,
              playCost: hasPlay ? parseInt(playCost) : null,
              evolveCost: hasEvolve ? parseInt(evolveCost) : null,
              evolveCond: obj['進化条件'] || '',
              cost: hasPlay ? parseInt(playCost) : hasEvolve ? parseInt(evolveCost) : 0,
              effect: obj['効果テキスト'] || obj['効果'] || '',
              evoSourceEffect: obj['進化元テキスト'] || obj['進化元効果'] || '',
              securityEffect: obj['セキュリティテキスト'] || obj['セキュリティ効果'] || '',
              recipe: obj['レシピ'] || obj['効果レシピ'] || null,
              imageUrl: obj['ImageURL'] || '', imgSrc: getCardImageUrl(obj) || '',
              type: obj['タイプ'] || '', color: obj['色'] || '', feature: obj['特徴'] || '',
              stack: [], suspended: false, buffs: [],
              cantBeActive: false, cantAttack: false, cantBlock: false,
              summonedThisTurn: false, _pendingDestroy: false,
            };
            foundIn = 'allCards (新規生成)';
          }
        }
        if (card) {
          side.security.unshift(card);
          console.log('[DEBUG] 「' + targetName + '」をセキュリティ1番上に仕込み (' + foundIn + ')');
        } else {
          console.error('[DEBUG] 「' + targetName + '」が見つかりません (allCards にも存在しない)');
        }
      }
      // 5枚を超えた場合は末尾を切り捨て（公式ルールでは初期セキュリティは5枚）
      if (side.security.length > 5) {
        const removed = side.security.splice(5);
        console.log('[DEBUG] 5枚超過分は破棄:', removed.map(c => c.name));
      }
    }
  }

  // オンライン: 自分のセキュリティの実データを相手に送信（相手のbs.ai.securityを正しいデータで上書き）
  if (isOnlineMode()) {
    const serializeCard = (c) => {
      if (!c) return null;
      const safe = (v) => (v === undefined || v === null || isNaN(v)) ? 0 : v;
      const safeNull = (v) => (v === undefined || v === null || isNaN(v)) ? null : v;
      return { cardNo: c.cardNo||'', name: c.name||'', type: c.type||'', level: c.level||'', dp: safe(c.dp), baseDp: safe(c.baseDp), cost: safe(c.cost), playCost: safeNull(c.playCost), evolveCost: safeNull(c.evolveCost), effect: c.effect||'', evoSourceEffect: c.evoSourceEffect||'', securityEffect: c.securityEffect||'', imgSrc: c.imgSrc||'', imageUrl: c.imageUrl||'', color: c.color||'', feature: c.feature||'', evolveCond: c.evolveCond||'', recipe: c.recipe||'', suspended: false, buffs: [], stack: [] };
    };
    sendCommand({ type: 'security_init', cards: bs.player.security.map(serializeCard) });
  }

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

// Phase 3 フック（aiMainPhase/aiAttackPhase/onDeckOut）
setPhaseHooks({
  aiMainPhase: aiMainPhase,
  aiAttackPhase: aiAttackPhase,
  onDeckOut: () => { addLog('⚠ デッキ切れ！'); battleDefeat(); },
});

// Phase 6: オンラインモジュールに各演出/フェーズ関数を注入
setOnlineModules({
  showYourTurn, showPhaseAnnounce, startPhase,
  showPlayEffect, showEvolveEffect, showSecurityCheck, showBattleResult,
  showDestroyEffect, showDirectAttack, showOptionEffect,
  showBlockConfirm, showBlockerSelection,
  showGameEndOverlay,
  fxSAttackPlus, fxRemoteEffect, fxRemoteEffectClose,
  ...buildOnlineEffectHooks(),
});

// Phase 3/4 にオンラインハンドラーを接続（初期はオフライン）
setOnlineHandlers(false, null, { sendCommand, sendStateSync, sendMemoryUpdate });
setCombatOnlineHandlers(false, null, { sendCommand, sendStateSync, sendMemoryUpdate });

// ===== ローディング＆ゲートオープン演出 =====

function showLoading() {
  const ov = document.createElement('div');
  ov.id = '_loading-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:50000;background:#000;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;';
  ov.innerHTML = '<div style="position:absolute;inset:0;opacity:0;background:#ffaa00;animation:turnFlash 2s ease infinite;"></div>'
    + '<div style="position:absolute;top:38%;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#ffaa00,transparent);animation:turnLineExpand 2s ease infinite;"></div>'
    + '<div style="position:absolute;top:62%;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#ffaa00,transparent);animation:turnLineExpand 2s ease 0.1s infinite;"></div>'
    + '<div style="position:relative;z-index:1;font-size:1.5rem;font-weight:900;color:#ffaa00;letter-spacing:4px;text-shadow:0 0 30px #ffaa00,0 0 60px #ffaa00,0 0 100px #ffaa00;">Loading...</div>'
    + '<div style="position:relative;z-index:1;font-size:0.8rem;color:#ffffff66;margin-top:8px;">データを読み込み中</div>';
  document.body.appendChild(ov);
  return ov;
}

function showGateOpen(callback) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:45000;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.95);overflow:hidden;';

  // 背景（放射状の光）
  ov.innerHTML = '<div style="position:absolute;inset:0;background:radial-gradient(circle at center,rgba(0,251,255,0.15) 0%,rgba(0,0,0,0) 70%);animation:gateGlow 2s ease-in-out;"></div>';

  // 横ライン
  const lt = document.createElement('div');
  lt.style.cssText = 'position:absolute;top:30%;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00fbff,transparent);animation:gateLineExpand 1.5s ease forwards;transform:scaleX(0);';
  ov.appendChild(lt);
  const lb = document.createElement('div');
  lb.style.cssText = 'position:absolute;top:70%;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00fbff,transparent);animation:gateLineExpand 1.5s ease 0.1s forwards;transform:scaleX(0);';
  ov.appendChild(lb);

  // メインテキスト
  const txt = document.createElement('div');
  txt.style.cssText = 'position:relative;z-index:1;font-size:clamp(1.8rem,9vw,3.5rem);font-weight:900;color:#00fbff;letter-spacing:clamp(3px,2vw,10px);text-shadow:0 0 30px #00fbff,0 0 60px #00fbff,0 0 100px #00fbff,0 0 150px rgba(0,251,255,0.3);opacity:0;animation:gateTextAppear 1.8s ease 0.3s forwards;text-align:center;padding:0 12px;line-height:1.4;';
  txt.innerHTML = 'デジタルゲート<br>オープン！';
  ov.appendChild(txt);

  // サブテキスト
  const sub = document.createElement('div');
  sub.style.cssText = 'position:relative;z-index:1;font-size:clamp(0.7rem,3vw,0.9rem);color:#ffffff88;letter-spacing:clamp(1px,1vw,3px);margin-top:12px;opacity:0;animation:gateTextAppear 1.5s ease 0.8s forwards;text-align:center;';
  sub.innerText = '— デジタルワールドへようこそ —';
  ov.appendChild(sub);

  // パーティクル
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    const x = Math.random() * 100, y = Math.random() * 100, sz = 2 + Math.random() * 4, del = Math.random() * 1.5;
    p.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;background:#00fbff;border-radius:50%;opacity:0;animation:gateParticle 2s ease ${del}s forwards;box-shadow:0 0 ${sz * 3}px #00fbff;`;
    ov.appendChild(p);
  }

  document.body.appendChild(ov);
  let called = false;
  function finish() {
    if (called) return; called = true;
    ov.style.transition = 'opacity 0.5s ease'; ov.style.opacity = '0';
    setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); callback(); }, 500);
  }
  setTimeout(finish, 5000);
  ov.addEventListener('click', finish, { once: true });
}

// ===== ゲーム開始 =====
window.startBattleGame = async function(playerDeckData, aiDeckData, playerFirst) {
  // ローディング表示
  const loadingOv = showLoading();

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

  // ローディング消去 → ゲートオープン演出
  if (loadingOv.parentNode) loadingOv.parentNode.removeChild(loadingOv);
  showGateOpen(() => {
    // 演出終了後にバトル画面 → マリガン
    showScreen('battle-screen');
    renderAll();
    addLog('✅ バトル画面描画完了');
    setTimeout(() => showMulliganOverlay(), 400);
  });
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

// ===== オンラインバトル開始 =====
window.startOnlineBattle = async function(playerDeckData, oppDeckData, playerFirst, roomId, myKey, oppName) {
  await initOnline(roomId, myKey);
  // 先攻/後攻を設定（色分けに使用）
  setFirstPlayer(playerFirst);
  window._isFirstPlayer = playerFirst;
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
