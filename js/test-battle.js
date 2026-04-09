/**
 * test-battle.js — エフェクトテスト用エントリポイント
 *
 * battle.js と同様に全バトルモジュールをimportし、
 * シナリオベースで盤面を構築してオンライン同期付きでテストする
 */

import { getCardImageUrl, loadCardAndKeywordData } from './cards.js';
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
import { getFxRunners, fxSAttackPlus, fxHatchEffect, fxRemoteEffect, fxRemoteEffectClose } from './battle-fx.js';
import { expireBuffs as _expireBuffsEE, applyPermanentEffects as _applyPermanentEE, triggerEffect as _triggerEffectEE } from './effect-engine.js';
// Phase 6: オンライン
import { initOnline, startOnlineListener, sendCommand, sendStateSync, sendMemoryUpdate, cleanupOnline, isOnlineMode, setOnlineModules } from './battle-online.js';
// Firebase直接アクセス（シナリオ共有用）
import { rtdb, ref, set, onValue } from './firebase-config.js';

// ===== シナリオ定義 =====
const SCENARIOS = {
  'giga-destroyer': {
    name: 'ギガデストロイヤーテスト',
    description: '自分の手札: ギガデストロイヤー\n自分のバトルエリア: アグモン(Lv3, DP3000)\n相手のバトルエリア: グリズモン(Lv4, DP7000), ガブモン(Lv3, DP2000)\nメモリー: 5',
    memory: 5,
    player: {
      hand: ['ギガデストロイヤー'],
      battleArea: ['アグモン'],
      tamerArea: [],
      security: 5,
      deckSize: 20,
    },
    ai: {
      hand: [],
      battleArea: ['グリズモン', 'ガブモン'],
      tamerArea: [],
      security: 5,
      deckSize: 20,
    },
  },
  'sorrow-blue': {
    name: 'ソローブルーテスト',
    description: '自分の手札: ソローブルー\n自分のバトルエリア: グレイモン(Lv4, DP5000)\n相手のバトルエリア: ガルルモン(Lv4, DP5000)\nメモリー: 3',
    memory: 3,
    player: {
      hand: ['ソローブルー'],
      battleArea: ['グレイモン'],
      tamerArea: [],
      security: 5,
      deckSize: 20,
    },
    ai: {
      hand: [],
      battleArea: ['ガルルモン'],
      tamerArea: [],
      security: 5,
      deckSize: 20,
    },
  },
};

// ===== window公開（HTML onclick等から呼べるように） =====
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

// テスト画面用: 勝敗後にシナリオ画面に戻る
function backToScenarioScreen() {
  // cleanupOnlineは呼び出し元(battleVictory/battleDefeat/game_endハンドラ)で実行済み
  // 残留オーバーレイを念のため消す
  document.querySelectorAll('body > div[style*="position:fixed"]').forEach(el => {
    if (!el.classList.contains('screen')) el.remove();
  });
  document.getElementById('battle-screen').style.display = 'none';
  document.getElementById('battle-screen').classList.remove('active');
  document.getElementById('scenario-screen').style.display = 'flex';
  document.getElementById('start-test-btn').disabled = false;
}
window._onGameEnd = backToScenarioScreen;
window._cleanupOnline = cleanupOnline;

// HTML onclick から呼ばれる補助関数
window.confirmExitGate = function() {
  showConfirm({ title: '退室確認', message: 'テストを終了しますか？', yesText: 'はい', noText: 'いいえ', color: '#ff4444' }).then(yes => {
    if (!yes) return;
    cleanupOnline();
    backToScenarioScreen();
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

// スクロールボタン
window.scrollHand = function(direction) {
  const el = document.getElementById('hand-wrap');
  if (el) el.scrollBy({ left: direction * 80, behavior: 'smooth' });
};
window.scrollBattleRow = function(side, direction) {
  const el = document.getElementById(side + '-battle-row');
  if (el) el.scrollBy({ left: direction * 80, behavior: 'smooth' });
};

// ===== 効果エンジン接続（battle.jsと同じ） =====
const TRIGGER_CODE_MAP = {
  '【登場時】': 'on_play', '【進化時】': 'on_evolve', '【アタック時】': 'on_attack',
  '【アタック終了時】': 'on_attack_end', '【自分のターン開始時】': 'on_own_turn_start',
  '【自分のターン終了時】': 'on_own_turn_end', '【メイン】': 'main',
  '【相手のターン開始時】': 'on_opp_turn_start', '【相手のターン終了時】': 'on_opp_turn_end',
  '【消滅時】': 'on_destroy', '【セキュリティ】': 'security',
  '【レストしたとき】': 'when_rest', '【アタックされたとき】': 'when_attacked',
  '【ブロックされたとき】': 'when_blocked', 'ブロックされた時': 'when_blocked',
  'アタックされた時': 'when_attacked',
};

function makeEffectContext(card, side) {
  window._lastBattleState = bs;
  return {
    card, side, bs, addLog, renderAll, updateMemGauge,
    doDraw, showYourTurn, aiTurn,
    showPlayEffect, showEvolveEffect, showDestroyEffect,
    showSecurityCheck, showBattleResult,
  };
}

function checkAndTriggerEffect(card, triggerType, callback, side, alreadyConfirmed) {
  if (!card) { callback && callback(); return; }
  const hasInMain = card.effect && card.effect.includes(triggerType);
  const hasInEvo = card.stack && card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes(triggerType));
  if (!hasInMain && !hasInEvo) { callback && callback(); return; }
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

// Phase 3 フック
setPhaseHooks({
  aiMainPhase: aiMainPhase,
  aiAttackPhase: aiAttackPhase,
  onDeckOut: () => { addLog('デッキ切れ！'); battleDefeat(); },
});

// Phase 4→効果エンジン接続
setCombatHooks({
  checkAndTriggerEffect,
  makeEffectContext,
  hasKeyword: (card, kw) => card && card.effect && card.effect.includes(kw),
  hasEvoKeyword: (card, kw) => card && card.stack && card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes(kw)),
  applyPermanentEffects: (side) => { try { _applyPermanentEE(bs, side, makeEffectContext(null, side)); } catch (e) { console.error('[applyPermanentEffects]', e); } },
  expireBuffs: (timing, side) => { try { _expireBuffsEE(bs, timing, side); } catch (e) { console.error('[expireBuffs]', e); } },
  triggerEffect: (code, card, side, ctx, cb) => { try { _triggerEffectEE(code, card, side, ctx, cb); } catch (e) { console.error('[triggerEffect]', e); cb && cb(); } },
});

// Phase 3→効果エンジン接続（ターン開始/終了時効果）
setPhaseHooks({
  checkTurnStartEffects: (side, cb) => {
    bs._usedLimits = {};
    const p = side === 'player' ? bs.player : bs.ai;
    const area = [...p.battleArea, ...(p.tamerArea || [])];
    const trigger = side === 'player' ? '【自分のターン開始時】' : '【相手のターン開始時】';
    const cardsWithEffect = area.filter(c => c && c.effect && c.effect.includes(trigger));
    if (cardsWithEffect.length === 0) { cb(); return; }
    let idx = 0;
    function next() {
      if (idx >= cardsWithEffect.length) { cb(); return; }
      checkAndTriggerEffect(cardsWithEffect[idx++], trigger, next);
    }
    next();
  },
  checkTurnEndEffects: (cb) => {
    const allCards = [...bs.player.battleArea, ...(bs.player.tamerArea || [])];
    const cardsWithEffect = allCards.filter(c => c && c.effect && c.effect.includes('【自分のターン終了時】'));
    if (cardsWithEffect.length === 0) { cb(); return; }
    let idx = 0;
    function next() {
      if (idx >= cardsWithEffect.length) { cb(); return; }
      checkAndTriggerEffect(cardsWithEffect[idx++], '【自分のターン終了時】', next);
    }
    next();
  },
});

// Phase 5: 演出エンジン接続
registerFxRunners(getFxRunners());

// Phase 6: オンラインモジュールに各演出/フェーズ関数を注入
setOnlineModules({
  showYourTurn, showPhaseAnnounce, startPhase,
  showPlayEffect, showEvolveEffect, showSecurityCheck, showBattleResult,
  showDestroyEffect, showDirectAttack, showOptionEffect,
  showBlockConfirm, showBlockerSelection,
  showGameEndOverlay,
  fxSAttackPlus, fxRemoteEffect, fxRemoteEffectClose,
  checkTurnStartEffects: (side, cb) => cb(),
  applyPermanentEffects: (side) => { try { _applyPermanentEE(bs, side, { bs, side }); } catch (_) {} },
  expireBuffs: (timing, side) => { try { _expireBuffsEE(bs, timing, side); } catch (_) {} },
});

// 育成エリア操作コールバック
setIkuCallbacks({
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
});

// Phase 3/4 にオンラインハンドラーを接続（初期はオフライン、テスト開始時にオンに）
setOnlineHandlers(false, null, { sendCommand, sendStateSync, sendMemoryUpdate });
setCombatOnlineHandlers(false, null, { sendCommand, sendStateSync, sendMemoryUpdate });

// ===== カードDBからカードを名前で検索してカードオブジェクトを構築 =====
// スプシのヘッダー名揺れ対応ヘルパー（改行入り列名・旧列名の両方を探す）
function cardField(card, ...names) {
  for (const n of names) {
    if (card[n] !== undefined && card[n] !== null && card[n] !== '') return card[n];
  }
  return undefined;
}

function findCardByName(name) {
  const card = window.allCards.find(c => c['名前'] === name);
  if (!card) {
    console.warn(`[test] カード "${name}" がDBに見つかりません`);
    return null;
  }
  const level = cardField(card, 'レベル', 'Lv');
  const playCost = cardField(card, '登場コスト', '登場\nコスト');
  const evolveCost = cardField(card, '進化コスト', '進化\nコスト');
  const hasPlay = playCost !== undefined;
  const hasEvolve = evolveCost !== undefined;
  return {
    name: card['名前'] || name,
    cardNo: card['カードNo'] || '',
    level: String(level ?? '?'),
    dp: parseInt(card['DP'] || 0),
    baseDp: parseInt(card['DP'] || 0),
    dpModifier: 0,
    playCost: hasPlay ? parseInt(playCost) : null,
    evolveCost: hasEvolve ? parseInt(evolveCost) : null,
    evolveCond: card['進化条件'] || '',
    cost: hasPlay ? parseInt(playCost) : hasEvolve ? parseInt(evolveCost) : 0,
    effect: card['効果テキスト'] || card['効果'] || '',
    evoSourceEffect: card['進化元テキスト'] || card['進化元効果'] || '',
    securityEffect: card['セキュリティテキスト'] || card['セキュリティ効果'] || '',
    recipe: card['レシピ'] || card['効果レシピ'] || null,
    imageUrl: card['ImageURL'] || '',
    imgSrc: getCardImageUrl(card) || '',
    type: card['タイプ'] || '',
    color: card['色'] || '',
    feature: card['特徴'] || '',
    stack: [],
    suspended: false,
    buffs: [],
    cantBeActive: false,
    cantAttack: false,
    cantBlock: false,
    summonedThisTurn: false,
    _pendingDestroy: false,
  };
}

// ダミーカードを生成（デッキ/セキュリティ充填用）
function makeDummyCard(index) {
  return {
    name: `ダミーカード${index}`, cardNo: `DUMMY-${index}`, level: '3',
    dp: 1000, baseDp: 1000, dpModifier: 0,
    playCost: 3, evolveCost: null, evolveCond: '',
    cost: 3, effect: '', evoSourceEffect: '', securityEffect: '',
    recipe: null, imageUrl: '', imgSrc: '', type: 'デジモン',
    color: '赤', feature: '', stack: [], suspended: false, buffs: [],
    cantBeActive: false, cantAttack: false, cantBlock: false,
    summonedThisTurn: false, _pendingDestroy: false,
  };
}

// ===== シナリオから盤面を構築 =====
function buildBoardFromScenario(scenario, isPlayer1) {
  const sc = SCENARIOS[scenario];
  if (!sc) { console.error('不明なシナリオ:', scenario); return false; }

  // Player1 = シナリオのplayer側、Player2 = シナリオのai側（盤面反転）
  const mySc  = isPlayer1 ? sc.player : sc.ai;
  const oppSc = isPlayer1 ? sc.ai : sc.player;

  // 状態リセット
  resetBattleState(isPlayer1);
  bs.phase = 'main';
  bs.isFirstTurn = false;
  // Player1: 正のメモリー（自分のターン）、Player2: 負のメモリー（相手のターン）
  bs.memory = isPlayer1 ? sc.memory : -sc.memory;
  bs.isPlayerTurn = isPlayer1;

  // --- サイド構築ヘルパー ---
  function buildSide(target, sc, dummyOffset) {
    (sc.hand || []).forEach(name => {
      const card = findCardByName(name);
      if (card) target.hand.push(card);
    });
    (sc.battleArea || []).forEach(name => {
      const card = findCardByName(name);
      if (card) target.battleArea.push(card);
    });
    // 進化元: evoSourceMap（新形式）= { battleIdx: [cardName, ...] }
    if (sc.evoSourceMap) {
      Object.keys(sc.evoSourceMap).forEach(idx => {
        const bi = parseInt(idx);
        if (target.battleArea[bi]) {
          (sc.evoSourceMap[idx] || []).forEach(name => {
            const card = findCardByName(name);
            if (card) target.battleArea[bi].stack.push(card);
          });
        }
      });
    }
    // 進化元: evoSource（旧形式）= 1体目に積む
    if (!sc.evoSourceMap && (sc.evoSource || []).length > 0 && target.battleArea[0]) {
      sc.evoSource.forEach(name => {
        const card = findCardByName(name);
        if (card) target.battleArea[0].stack.push(card);
      });
    }
    (sc.tamerArea || []).forEach(name => {
      const card = findCardByName(name);
      if (card) target.tamerArea.push(card);
    });
    (sc.trash || []).forEach(name => {
      const card = findCardByName(name);
      if (card) target.trash.push(card);
    });
    // セキュリティ: 指定カード + ダミーで合計枚数を埋める
    const secCards = sc.securityCards || [];
    secCards.forEach(name => {
      const card = findCardByName(name);
      if (card) target.security.push(card);
    });
    const secDummy = sc.securityDummy ?? (secCards.length > 0 ? 0 : (sc.security ?? 5));
    for (let i = 0; i < secDummy; i++) target.security.push(makeDummyCard(dummyOffset + i));
    for (let i = 0; i < (sc.deckSize || 20); i++) target.deck.push(makeDummyCard(dummyOffset + 100 + i));
  }

  // --- 自分側 ---
  buildSide(bs.player, mySc, 100);

  // --- 相手側 ---
  buildSide(bs.ai, oppSc, 300);

  addLog(`[TEST] シナリオ "${sc.name}" を読み込みました（${isPlayer1 ? 'Player1' : 'Player2'}）`);
  addLog(`[TEST] メモリー: ${bs.memory} / 手札: ${bs.player.hand.length}枚 / バトルエリア: ${bs.player.battleArea.length}体`);
  addLog(`[TEST] 相手バトルエリア: ${bs.ai.battleArea.length}体`);

  return true;
}

// ===== シナリオ選択UI =====
let _selectedPlayer = 'player1';
let _selectedCardName = null; // 検索で選択中のカード名
let _customCards = { 'p1-hand': [], 'p1-battle': [], 'p1-tamer': [], 'p1-trash': [], 'p1-security': [], 'p2-hand': [], 'p2-battle': [], 'p2-tamer': [], 'p2-trash': [], 'p2-security': [] };
let _customEvo = { p1: {}, p2: {} }; // { p1: { 0: ['カード名', ...], 1: [...] }, p2: { ... } }
let _cardsLoaded = false;

window.selectPlayer = function(player) {
  _selectedPlayer = player;
  document.getElementById('btn-p1').classList.toggle('selected', player === 'player1');
  document.getElementById('btn-p2').classList.toggle('selected', player === 'player2');
};

window.updateScenarioDesc = function() {
  const sel = document.getElementById('scenario-select');
  const panel = document.getElementById('custom-scenario-panel');
  const descEl = document.getElementById('scenario-desc');
  if (sel.value === '__custom__') {
    panel.style.display = 'block';
    descEl.innerText = 'カードを検索して配置してください';
    // カードDB未読み込みなら読み込み
    if (!_cardsLoaded) {
      loadCardAndKeywordData().then(() => { _cardsLoaded = true; document.getElementById('test-status').innerText = `カード${window.allCards.length}件読み込み済み`; });
    }
  } else {
    panel.style.display = 'none';
    const sc = SCENARIOS[sel.value];
    if (sc && descEl) descEl.innerText = sc.description;
  }
};

// カード検索
window.searchCards = function() {
  const query = document.getElementById('card-search-input').value.trim();
  if (!query || !window.allCards) return;
  const results = window.allCards.filter(c => (c['名前'] || '').includes(query)).slice(0, 15);
  const el = document.getElementById('card-search-results');
  if (results.length === 0) { el.innerHTML = '<div style="color:#666;font-size:11px;padding:4px;">見つかりません</div>'; return; }
  el.innerHTML = results.map(c => {
    const name = c['名前'] || '???';
    const type = c['タイプ'] || '';
    const lv = c['レベル'] || '';
    const dp = c['DP'] || '';
    const color = type === 'デジモン' ? '#00fbff' : type === 'テイマー' ? '#00ff88' : '#ffaa00';
    return `<div onclick="selectSearchCard('${name.replace(/'/g, "\\'")}')" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid #222;font-size:11px;color:${color};transition:background 0.15s;" onmouseover="this.style.background='#1a1a2e'" onmouseout="this.style.background=''">
      <b>${name}</b> <span style="color:#888;">${type} ${lv ? 'Lv.' + lv : ''} ${dp ? 'DP:' + dp : ''}</span>
    </div>`;
  }).join('');
};

// Enterキーで検索
document.getElementById('card-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchCards(); });

// 検索結果からカードを選択
window.selectSearchCard = function(name) {
  _selectedCardName = name;
  document.getElementById('card-search-results').innerHTML = `<div style="color:#00ff88;font-size:11px;padding:4px;">✓「${name}」を選択中 → 追加先の「+追加」を押してください</div>`;
};

// カードを配置先に追加
window.addCardTo = function(zone) {
  if (!_selectedCardName) { alert('先にカードを検索して選択してください'); return; }
  _customCards[zone].push(_selectedCardName);
  // バトルカード削除時に進化元もクリーンアップするため、evo indexは自動管理
  renderCustomCards();
  _selectedCardName = null;
  document.getElementById('card-search-results').innerHTML = '';
};

// カードを配置先から削除
window.removeCardFrom = function(zone, idx) {
  _customCards[zone].splice(idx, 1);
  // バトルエリアから削除した場合、進化元データも調整
  if (zone === 'p1-battle' || zone === 'p2-battle') {
    const side = zone === 'p1-battle' ? 'p1' : 'p2';
    const newEvo = {};
    Object.keys(_customEvo[side]).forEach(key => {
      const k = parseInt(key);
      if (k < idx) newEvo[k] = _customEvo[side][k];
      else if (k > idx) newEvo[k - 1] = _customEvo[side][k];
      // k === idx は削除（そのデジモンの進化元ごと消える）
    });
    _customEvo[side] = newEvo;
  }
  renderCustomCards();
};

// 進化元を特定のバトルエリアデジモンに追加
window.addEvoTo = function(side, battleIdx) {
  if (!_selectedCardName) { alert('先にカードを検索して選択してください'); return; }
  if (!_customEvo[side][battleIdx]) _customEvo[side][battleIdx] = [];
  _customEvo[side][battleIdx].push(_selectedCardName);
  renderCustomCards();
  _selectedCardName = null;
  document.getElementById('card-search-results').innerHTML = '';
};

// 進化元を削除
window.removeEvoFrom = function(side, battleIdx, evoIdx) {
  if (_customEvo[side][battleIdx]) {
    _customEvo[side][battleIdx].splice(evoIdx, 1);
    if (_customEvo[side][battleIdx].length === 0) delete _customEvo[side][battleIdx];
  }
  renderCustomCards();
};

function renderCustomCards() {
  Object.keys(_customCards).forEach(zone => {
    const el = document.getElementById('custom-' + zone);
    if (!el) return;
    const isP1 = zone.startsWith('p1');
    const color = isP1 ? '#00fbff' : '#ff00fb';

    // バトルエリアは進化元付きで特別レンダリング
    if (zone === 'p1-battle' || zone === 'p2-battle') {
      const side = isP1 ? 'p1' : 'p2';
      const btnBorder = isP1 ? '#0f0' : '#f0f';
      if (_customCards[zone].length === 0) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = _customCards[zone].map((name, i) => {
        const evoCards = _customEvo[side][i] || [];
        const evoHtml = evoCards.map((eName, ei) =>
          `<span style="background:#ffaa0022;color:#ffaa00;border:1px solid #ffaa0044;border-radius:4px;padding:1px 5px;font-size:9px;cursor:pointer;" onclick="removeEvoFrom('${side}',${i},${ei})" title="クリックで削除">${eName} ✕</span>`
        ).join('');
        return `<div style="background:#111;border:1px solid ${color}44;border-radius:6px;padding:4px 6px;margin-bottom:3px;">
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="color:${color};font-size:10px;font-weight:bold;">${name}</span>
            <span style="color:#666;font-size:9px;cursor:pointer;" onclick="removeCardFrom('${zone}',${i})" title="デジモン削除">✕</span>
            <button onclick="addEvoTo('${side}',${i})" style="font-size:8px;padding:1px 4px;background:#332200;color:#ffaa00;border:1px solid #ffaa0066;border-radius:3px;cursor:pointer;margin-left:auto;">+進化元</button>
          </div>
          ${evoCards.length > 0 ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px;padding-left:8px;border-left:2px solid #ffaa0033;">${evoHtml}</div>` : ''}
        </div>`;
      }).join('');
      return;
    }

    // 通常のゾーン
    el.innerHTML = _customCards[zone].map((name, i) => {
      return `<span style="background:${color}22;color:${color};border:1px solid ${color}44;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;" onclick="removeCardFrom('${zone}',${i})" title="クリックで削除">${name} ✕</span>`;
    }).join('');
  });
}

// ===== シナリオ保存/読み込み（localStorage） =====
const STORAGE_KEY = 'digimon-test-scenarios';

function getSavedScenarios() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function refreshSavedList() {
  const sel = document.getElementById('saved-scenario-select');
  if (!sel) return;
  const saved = getSavedScenarios();
  sel.innerHTML = '<option value="">-- 保存済みシナリオ --</option>';
  Object.keys(saved).forEach(name => {
    sel.innerHTML += `<option value="${name}">${name}</option>`;
  });
}

window.saveScenario = function() {
  const name = document.getElementById('save-name-input').value.trim();
  if (!name) { alert('シナリオ名を入力してください'); return; }
  const data = {
    cards: JSON.parse(JSON.stringify(_customCards)),
    evo: JSON.parse(JSON.stringify(_customEvo)),
    memory: parseInt(document.getElementById('custom-memory').value) || 5,
    p1SecDummy: parseInt(document.getElementById('custom-p1-sec').value) || 0,
    p2SecDummy: parseInt(document.getElementById('custom-p2-sec').value) || 0,
  };
  const saved = getSavedScenarios();
  saved[name] = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  refreshSavedList();
  document.getElementById('test-status').innerText = `✅「${name}」を保存しました`;
};

window.loadScenario = function() {
  const sel = document.getElementById('saved-scenario-select');
  const name = sel.value;
  if (!name) { alert('読み込むシナリオを選択してください'); return; }
  const saved = getSavedScenarios();
  const data = saved[name];
  if (!data) return;
  // カード配置を復元
  Object.keys(data.cards).forEach(zone => { _customCards[zone] = data.cards[zone] || []; });
  // 進化元を復元（旧形式対応）
  if (data.evo) {
    _customEvo = JSON.parse(JSON.stringify(data.evo));
  } else {
    _customEvo = { p1: {}, p2: {} };
  }
  // セキュリティ（旧形式: p1Sec/p2Sec → 新形式: p1SecDummy/p2SecDummy）
  document.getElementById('custom-memory').value = data.memory || 5;
  document.getElementById('custom-p1-sec').value = data.p1SecDummy ?? data.p1Sec ?? 5;
  document.getElementById('custom-p2-sec').value = data.p2SecDummy ?? data.p2Sec ?? 0;
  document.getElementById('save-name-input').value = name;
  renderCustomCards();
  document.getElementById('test-status').innerText = `📂「${name}」を読み込みました`;
};

window.deleteScenario = function() {
  const sel = document.getElementById('saved-scenario-select');
  const name = sel.value;
  if (!name) { alert('削除するシナリオを選択してください'); return; }
  if (!confirm(`「${name}」を削除しますか？`)) return;
  const saved = getSavedScenarios();
  delete saved[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  refreshSavedList();
  document.getElementById('test-status').innerText = `🗑「${name}」を削除しました`;
};

// 初期表示
refreshSavedList();
window.updateScenarioDesc();

// ===== カスタムシナリオをFirebaseに書き込み/読み取り =====
function buildCustomScenarioData() {
  return {
    name: 'カスタムシナリオ',
    description: 'カスタム',
    memory: parseInt(document.getElementById('custom-memory').value) || 5,
    player: {
      hand: _customCards['p1-hand'],
      battleArea: _customCards['p1-battle'],
      evoSourceMap: _customEvo['p1'],
      tamerArea: _customCards['p1-tamer'],
      trash: _customCards['p1-trash'],
      securityCards: _customCards['p1-security'],
      securityDummy: parseInt(document.getElementById('custom-p1-sec').value) || 0,
      deckSize: 20,
    },
    ai: {
      hand: _customCards['p2-hand'],
      battleArea: _customCards['p2-battle'],
      evoSourceMap: _customEvo['p2'],
      tamerArea: _customCards['p2-tamer'],
      trash: _customCards['p2-trash'],
      securityCards: _customCards['p2-security'],
      securityDummy: parseInt(document.getElementById('custom-p2-sec').value) || 0,
      deckSize: 20,
    },
  };
}

async function saveScenarioToFirebase(roomId, scenarioData) {
  await set(ref(rtdb, `rooms/${roomId}/scenario`), scenarioData);
}

function loadScenarioFromFirebase(roomId) {
  return new Promise((resolve) => {
    const scenRef = ref(rtdb, `rooms/${roomId}/scenario`);
    const unsub = onValue(scenRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        unsub(); // リスナー解除
        resolve(data);
      }
    });
    // 30秒タイムアウト
    setTimeout(() => { unsub(); resolve(null); }, 30000);
  });
}

// ===== テスト開始 =====
window.startTest = async function() {
  const statusEl = document.getElementById('test-status');
  const startBtn = document.getElementById('start-test-btn');
  startBtn.disabled = true;
  statusEl.innerText = 'カードデータを読み込み中...';

  try {
    // カードデータ読み込み
    await loadCardAndKeywordData();
    statusEl.innerText = `カード ${window.allCards.length} 件読み込み完了。辞書を読み込み中...`;

    // 効果辞書読み込み
    await loadAllDictionaries();
    statusEl.innerText = 'オンライン接続中...';

    // オンライン接続
    const roomId = document.getElementById('room-id-input').value.trim();
    if (!roomId) { statusEl.innerText = 'ルームIDを入力してください'; startBtn.disabled = false; return; }

    const myKey = _selectedPlayer;
    const isFirst = _selectedPlayer === 'player1';

    await initOnline(roomId, myKey);
    setFirstPlayer(isFirst);
    window._isFirstPlayer = isFirst;

    // オンラインハンドラー有効化
    setOnlineHandlers(true, myKey, { sendCommand, sendStateSync, sendMemoryUpdate });
    setCombatOnlineHandlers(true, myKey, { sendCommand, sendStateSync, sendMemoryUpdate });
    setOnlineInfo(true, myKey);

    statusEl.innerText = 'シナリオを構築中...';

    // シナリオ選択（Player1/Player2で盤面反転）
    const scenarioKey = document.getElementById('scenario-select').value;

    if (scenarioKey === '__custom__') {
      if (isFirst) {
        // Player1: カスタムシナリオを構築してFirebaseに保存
        const scenarioData = buildCustomScenarioData();
        SCENARIOS['__custom__'] = scenarioData;
        await saveScenarioToFirebase(roomId, scenarioData);
        statusEl.innerText = 'シナリオをFirebaseに保存しました';
      } else {
        // Player2: Player1のシナリオをFirebaseから読み取り
        statusEl.innerText = 'Player1のシナリオを待機中...';
        const scenarioData = await loadScenarioFromFirebase(roomId);
        if (!scenarioData) {
          statusEl.innerText = 'シナリオの読み取りがタイムアウトしました。Player1が先にテスト開始してください。';
          startBtn.disabled = false;
          return;
        }
        // evoSourceMap はFirebaseでオブジェクト化される可能性があるので復元
        if (scenarioData.player && scenarioData.player.evoSourceMap) {
          const map = scenarioData.player.evoSourceMap;
          Object.keys(map).forEach(k => { if (!Array.isArray(map[k])) map[k] = Object.values(map[k] || {}); });
        }
        if (scenarioData.ai && scenarioData.ai.evoSourceMap) {
          const map = scenarioData.ai.evoSourceMap;
          Object.keys(map).forEach(k => { if (!Array.isArray(map[k])) map[k] = Object.values(map[k] || {}); });
        }
        SCENARIOS['__custom__'] = scenarioData;
        statusEl.innerText = 'シナリオを受信しました';
      }
    }

    const ok = buildBoardFromScenario(scenarioKey, isFirst);
    if (!ok) { statusEl.innerText = 'シナリオの構築に失敗しました'; startBtn.disabled = false; return; }

    // 永続効果を初期適用（テイマー効果やバフなど、盤面構築後に反映が必要）
    try { _applyPermanentEE(bs, 'player', makeEffectContext(null, 'player')); } catch (e) { console.warn('[test] applyPermanent player:', e); }
    try { _applyPermanentEE(bs, 'ai', makeEffectContext(null, 'ai')); } catch (e) { console.warn('[test] applyPermanent ai:', e); }

    // 画面切り替え
    document.getElementById('scenario-screen').style.display = 'none';
    document.getElementById('battle-screen').style.display = 'block';
    document.getElementById('battle-screen').classList.add('active');

    // 描画
    renderAll();
    updateMemGauge();

    // ターン開始演出
    if (isFirst) {
      showYourTurn('あなたのターン', 'メインフェイズ - カードをプレイしよう', '#00fbff', () => {
        addLog('[TEST] メインフェイズ開始 - カードをプレイしてテストしてください');
        renderAll();
      });
    } else {
      showYourTurn('相手のターン', '相手の操作を待っています...', '#ff00fb', () => {
        addLog('[TEST] 相手のターンです（操作待ち）');
        renderAll();
      });
    }

    // 相手プレイヤーの名前表示
    const oppLabel = document.getElementById('opponent-name-label');
    if (oppLabel) oppLabel.innerText = isFirst ? 'Player 2' : 'Player 1';

    // リスナー開始
    startOnlineListener();

    // 状態同期を送信
    sendStateSync();

    addLog('[TEST] テスト開始！オンライン同期有効');

  } catch (e) {
    console.error('[test] エラー:', e);
    statusEl.innerText = 'エラー: ' + e.message;
    startBtn.disabled = false;
  }
};

// ===== 初期化 =====
console.log('[test-battle.js] エフェクトテスト用モジュール読み込み完了');
