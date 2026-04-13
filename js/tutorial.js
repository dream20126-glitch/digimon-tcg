// ===================================================================
// チュートリアル画面 (シナリオ選択 → 詳細 → バトル起動)
// ===================================================================
import { gasGet } from './firebase-config.js';
import { getGoogleDriveDirectLink } from './cards.js';
import { getTutorialRunner } from './tutorial-runner.js';

let _scenariosCache = [];
let _decksCache = [];
let _progressCache = [];    // クリア済みシナリオID一覧
let _selectedScenario = null;
let _selectedDeck = null;

// ===================================================================
// シナリオ一覧画面 (top-menu の「チュートリアル」押下時に呼ばれる)
// ===================================================================
window.loadTutorialScreen = async function() {
  const area = document.getElementById('tutorial-scenario-select-area');
  if (!area) return;
  area.innerHTML = '<p style="color:#555;">シナリオを取得中...</p>';
  showScreen('tutorial-screen');

  try {
    const [scenarios, decks, progress] = await Promise.all([
      gasGet('getTutorialScenarios'),
      gasGet('getTutorialDecks'),
      gasGet('getTutorialProgress', {
        player: window.currentPlayerName || '',
        pw: window.currentSessionPassword || ''
      }),
    ]);

    if (scenarios && scenarios.error) {
      area.innerHTML = `<p style="color:#ff4444;">エラー: ${scenarios.error}</p>`;
      return;
    }
    _scenariosCache = Array.isArray(scenarios) ? scenarios : [];
    _decksCache     = Array.isArray(decks) ? decks : [];
    _progressCache  = Array.isArray(progress) ? progress : [];

    if (!_scenariosCache.length) {
      area.innerHTML = '<p style="color:#aaa; padding:20px;">シナリオが登録されていません</p>';
      return;
    }

    _renderScenarioList();
  } catch (e) {
    area.innerHTML = `<p style="color:#ff4444;">エラー: ${e.message}</p>`;
  }
};

// クリア済みかどうか
function _isCleared(scenarioId) {
  return _progressCache.some(p => p.scenarioId === scenarioId);
}

// ロック判定 (前提シナリオ未クリア = ロック)
function _isLocked(scenario) {
  if (!scenario.prerequisiteId) return false;
  return !_isCleared(scenario.prerequisiteId);
}

function _renderScenarioList() {
  const area = document.getElementById('tutorial-scenario-select-area');
  if (!area) return;

  // order昇順（API側でソート済みだが念のため）
  const list = [..._scenariosCache].sort((a, b) => (a.order || 0) - (b.order || 0));

  area.innerHTML = list.map(s => {
    const cleared = _isCleared(s.id);
    const locked  = _isLocked(s);
    const deck    = _decksCache.find(d => (d.deckId || d.tutorialName) === s.deckId);
    const imgUrl  = deck ? getGoogleDriveDirectLink(deck.cover || deck['代表画像URL'] || '') : '';
    const title   = s.tutorialName || '(無題)';
    const desc    = s.description || '';
    const diff    = s.difficulty || '';

    // スタイル調整
    const baseStyle = 'display:flex; align-items:center; background:#0a1a1a; border-radius:8px; padding:10px 12px; margin-bottom:8px; text-align:left; transition:all 0.15s;';
    const bgStyle = locked
      ? 'opacity:0.45; cursor:not-allowed; border:1px solid #333;'
      : cleared
        ? 'cursor:pointer; border:1px solid #00ff88;'
        : 'cursor:pointer; border:1px solid #222;';

    const clickAttr = locked ? '' : `onclick="selectTutorialScenario('${s.id}')"`;

    const badge = cleared
      ? '<span style="background:#00ff88; color:#000; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">済</span>'
      : locked
        ? '<span style="background:#444; color:#aaa; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">🔒</span>'
        : '';

    return `
      <div style="${baseStyle}${bgStyle}" ${clickAttr}>
        <img src="${imgUrl}" style="width:40px; height:56px; border-radius:3px; object-fit:cover; margin-right:12px; background:#000;" onerror="this.style.display='none'">
        <div style="flex:1; min-width:0;">
          <div style="color:#fff; font-size:13px; font-weight:bold;">
            ${_escHtml(title)}${badge}
          </div>
          <div style="color:#888; font-size:11px;">${_escHtml(diff)}</div>
          <div style="color:#aaa; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escHtml(desc)}</div>
          ${locked ? `<div style="color:#666; font-size:10px; margin-top:2px;">前提シナリオをクリアで解放</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ===================================================================
// シナリオ詳細画面
// ===================================================================
window.selectTutorialScenario = function(scenarioId) {
  const scenario = _scenariosCache.find(s => s.id === scenarioId);
  if (!scenario) return;
  if (_isLocked(scenario)) { alert('前提シナリオをクリアしてください'); return; }

  _selectedScenario = scenario;
  _selectedDeck = _decksCache.find(d => (d.deckId || d.tutorialName) === scenario.deckId) || null;

  // タイトル・目的表示
  document.getElementById('tl-scenario-title').innerText = scenario.tutorialName || '';
  document.getElementById('tl-scenario-difficulty').innerText = scenario.difficulty || '';
  document.getElementById('tl-scenario-description').innerText = scenario.description || '(目的の説明がありません)';

  // デッキ情報表示
  if (_selectedDeck) {
    const imgUrl = getGoogleDriveDirectLink(_selectedDeck.cover || _selectedDeck['代表画像URL'] || '');
    document.getElementById('tl-deck-img').innerHTML = `<img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'">`;
    document.getElementById('tl-deck-name').innerText = _selectedDeck.deckName || '';
    document.getElementById('tl-deck-tutorial-name').innerText = _selectedDeck.tutorialName || '';
  } else {
    document.getElementById('tl-deck-img').innerHTML = '';
    document.getElementById('tl-deck-name').innerText = '(デッキが見つかりません)';
    document.getElementById('tl-deck-tutorial-name').innerText = '';
  }

  const msg = document.getElementById('tutorial-status-msg');
  if (_selectedDeck) {
    msg.style.color = '#00ff88';
    msg.innerText = 'READY';
  } else {
    msg.style.color = '#ff4444';
    msg.innerText = '使用デッキが未設定です。管理画面で確認してください';
  }

  showScreen('tutorial-lobby-screen');
};

// ===================================================================
// バトル起動 (TutorialRunner 経由)
// ===================================================================
window.enterTutorialBattle = async function() {
  if (!_selectedScenario) { alert('シナリオが選択されていません'); return; }
  if (!_selectedDeck) { alert('使用デッキが取得できません。管理画面で使用デッキを確認してください'); return; }

  const pDeckList = _selectedDeck.list || _selectedDeck['カードリスト'];
  if (!pDeckList) { alert('デッキのカードリストが空です'); return; }

  const runner = getTutorialRunner();
  try {
    await runner.start(
      _selectedScenario,
      { list: pDeckList },
      { list: pDeckList } // 相手も同じデッキ (シナリオで盤面を上書きするので影響なし)
    );
  } catch (e) {
    console.error('[tutorial] start failed:', e);
    alert('シナリオ開始に失敗: ' + e.message);
  }
};

// ===================================================================
// バトル画面 UI フック (TutorialRunner から呼ばれる)
// ===================================================================

// ゴール（クリア条件）を上部に表示
window._tutorialShowGoal = function(clearCondition) {
  const overlay = document.getElementById('tutorial-instruction-overlay');
  const el = document.getElementById('tutorial-instruction-text');
  if (!overlay || !el) return;
  // クリア条件を日本語に変換（簡易）
  const label = _clearConditionToJapanese(clearCondition);
  el.innerText = label;
  overlay.style.display = 'block';
};

function _clearConditionToJapanese(cond) {
  if (!cond || !cond.type) return '';
  const map = {
    hatch: '育成エリアで孵化しよう',
    play_any: 'カードをプレイしよう',
    play_specific: 'カードをプレイしよう',
    evolve_any: 'デジモンを進化させよう',
    evolve_specific: 'デジモンを進化させよう',
    attack_declared: 'アタック宣言しよう',
    attack_resolved: 'バトルを解決しよう',
    destroy_opponent: '相手デジモンを消滅させよう',
    security_reduced: '相手のセキュリティを削ろう',
    use_effect: '効果を発動しよう',
    turn_end: 'ターンを終了しよう',
    turn_start: 'ターンを開始しよう',
  };
  return '🎯 ' + (map[cond.type] || cond.type);
}

// デバイス分岐テキスト変換: {{pc:XXX|sp:YYY}} → デバイスに合わせて置換
function _resolveDeviceText(text) {
  if (!text) return '';
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  return text.replace(/\{\{pc:(.+?)\|sp:(.+?)\}\}/g, (_, pcText, spText) => {
    return isMobile ? spText : pcText;
  });
}

// 操作タイプに応じたアイコン/アニメを取得
function _getOperationIcon(opType) {
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  switch (opType) {
    case 'tap':        return { icon: '👆', anim: 'tutorialTap 0.8s ease-in-out infinite' };
    case 'drag':       return { icon: '➡️', anim: 'tutorialDragArrow 1.2s ease-in-out infinite' };
    case 'long_press': return { icon: '✋', anim: 'tutorialLongPress 1.5s ease-in-out infinite' };
    case 'swipe_left': return { icon: '⬅️', anim: 'tutorialSwipeLeft 1s ease-in-out infinite' };
    case 'rest_action':
      return isMobile
        ? { icon: '⬅️', anim: 'tutorialSwipeLeft 1s ease-in-out infinite' }
        : { icon: '✋', anim: 'tutorialLongPress 1.5s ease-in-out infinite' };
    default:           return { icon: '👇', anim: 'tutorialBounce 0.8s ease-in-out infinite' };
  }
}

// 指示テキストを指差しマーカーの吹き出しに表示
window._tutorialShowInstruction = function(text, targetArea, step) {
  const resolvedText = _resolveDeviceText(text);
  const opType = (step && step.operationType) || '';
  const secondArea = (step && step.secondTargetArea) || '';

  // カードNo指定があればカード単位の赤枠（エリアより優先）
  const targetCardNo = (step && step.targetCardNo) || '';
  const secondCardNo = (step && step.secondTargetCardNo) || '';

  if (targetCardNo || targetArea) {
    _showPointer(resolvedText, targetArea, opType, secondArea, targetCardNo, secondCardNo);
  } else {
    _hidePointer();
    const overlay = document.getElementById('tutorial-instruction-overlay');
    const el = document.getElementById('tutorial-instruction-text');
    if (overlay && el) {
      el.innerText = resolvedText;
      overlay.style.display = 'block';
    }
  }

  // UI制御: カードハイライト + ボタン制御
  _applyStepUiControl(step);
};

// 指示テキストを非表示
window._tutorialHideInstruction = function() {
  _hidePointer();
  _clearStepUiControl();
  // 上部オーバーレイは残す（ゴール表示用なのでシナリオ終了まで表示）
};

// ===================================================================
// ステップUI制御（カードハイライト + ボタン制御）
// ===================================================================

// ボタンキー → DOMセレクタのマッピング
const _BUTTON_SELECTOR_MAP = {
  mulligan_redo: '#mulligan-btn',
  game_start:    '#mulligan-overlay .menu-btn.primary',
  end_turn:      '.a-btn-end',
};

let _uiControlActive = false;
let _savedButtonStates = [];  // 復元用

function _applyStepUiControl(step) {
  _clearStepUiControl();
  if (!step || !step.uiControl) return;

  const greyOut = Array.isArray(step.greyOut) ? step.greyOut : [];
  const hlButtons = Array.isArray(step.highlightButtons) ? step.highlightButtons : [];
  const greyOutCards = greyOut.includes('other_cards');

  // ハイライト対象カード = 赤枠ハイライト1/2のカードNo
  const hlCards = [step.targetCardNo, step.secondTargetCardNo].filter(Boolean);

  // --- カードハイライト + グレーアウト ---
  if (hlCards.length > 0 || greyOutCards) {
    const allCards = document.querySelectorAll('#hand-wrap .h-card, #pl-battle-row .b-slot[data-card-no]');
    allCards.forEach(cardEl => {
      const no = cardEl.dataset.cardNo || '';
      if (hlCards.length > 0 && hlCards.includes(no)) {
        cardEl.classList.add('tutorial-card-highlight');
      } else if (greyOutCards) {
        cardEl.classList.add('tutorial-card-disabled');
      }
    });
    _uiControlActive = true;
  }

  // --- ボタンハイライト ---
  hlButtons.forEach(btnKey => {
    const selector = _BUTTON_SELECTOR_MAP[btnKey];
    if (!selector) return;
    const btn = document.querySelector(selector);
    if (!btn) return;
    _savedButtonStates.push({ el: btn, disabled: btn.disabled });
    btn.classList.add('tutorial-btn-highlighted');
    _uiControlActive = true;
  });

  // --- ボタングレーアウト ---
  greyOut.forEach(key => {
    if (key === 'other_cards') return; // カードは上で処理済み
    const selector = _BUTTON_SELECTOR_MAP[key];
    if (!selector) return;
    const btn = document.querySelector(selector);
    if (!btn) return;
    // ハイライト済みならスキップ
    if (btn.classList.contains('tutorial-btn-highlighted')) return;
    _savedButtonStates.push({ el: btn, disabled: btn.disabled });
    btn.disabled = true;
    btn.classList.add('tutorial-btn-disabled');
    _uiControlActive = true;
  });
}

function _clearStepUiControl() {
  if (!_uiControlActive) return;

  // カードクラス除去
  document.querySelectorAll('.tutorial-card-highlight').forEach(el => el.classList.remove('tutorial-card-highlight'));
  document.querySelectorAll('.tutorial-card-disabled').forEach(el => el.classList.remove('tutorial-card-disabled'));

  // ボタン状態復元
  _savedButtonStates.forEach(({ el, disabled, classes }) => {
    el.disabled = disabled;
    el.classList.remove('tutorial-btn-disabled', 'tutorial-btn-highlighted');
  });
  _savedButtonStates = [];

  // ブロック解除
  document.body.classList.remove('tutorial-block-other');
  _uiControlActive = false;
}

// 成功演出（ステップ進行時）
window._tutorialShowSuccess = function(message) {
  const overlay = document.getElementById('tutorial-success-overlay');
  const textEl = document.getElementById('tutorial-success-text');
  if (!overlay || !textEl) return;
  textEl.innerText = message || 'OK!';
  // アニメリセット
  textEl.style.animation = 'none';
  void textEl.offsetHeight; // reflow
  textEl.style.animation = 'tutorialSuccessFlash 1.2s ease forwards';
  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; }, 1300);
};

// ===================================================================
// 指差しマーカーの表示/非表示
// ===================================================================
// マリガン表示中か判定
function _isMulliganActive() {
  const mul = document.getElementById('mulligan-overlay');
  return !!(mul && mul.style.display !== 'none' && getComputedStyle(mul).display !== 'none');
}

const TARGET_AREA_SELECTORS = {
  raising:       () => document.getElementById('pl-iku-slot'),
  // マリガン中なら最初の5枚プレビューを、通常時は手札エリアを返す
  hand:          () => _isMulliganActive()
    ? document.getElementById('mulligan-hand-preview')
    : document.getElementById('hand-wrap'),
  battle:        () => document.getElementById('pl-battle-row'),
  end_turn_btn:  () => document.getElementById('action-bar'),
  mulligan_btn_start: () => document.querySelector('#mulligan-overlay .menu-btn.primary'),
  mulligan_btn_redo:  () => document.getElementById('mulligan-btn'),
  opp_security:  () => document.querySelector('#ai-security-row, [id*="ai-sec"]'),
  opp_battle:    () => document.getElementById('ai-battle-row'),
  memory_gauge:        () => document.getElementById('memory-gauge-row'),
  memory_gauge_player: () => {
    // 自分側のメモリーセル群をラップ要素として返す（最初のm-plセルの親=row）
    const row = document.getElementById('memory-gauge-row');
    if (!row) return null;
    // m-pl セルが複数あるので、row 内で自分側をハイライトするため範囲を特定
    // 簡易: 自分側セル群の最初と最後を含む仮想範囲 → row 自体に pl クラスを付けて CSS で制御
    const cells = row.querySelectorAll('.m-pl');
    return cells.length ? cells[Math.floor(cells.length / 2)] : row;
  },
  memory_gauge_opp: () => {
    const row = document.getElementById('memory-gauge-row');
    if (!row) return null;
    const cells = row.querySelectorAll('.m-ai');
    return cells.length ? cells[Math.floor(cells.length / 2)] : row;
  },
  // カード詳細モーダル内部
  card_detail:            () => document.getElementById('b-card-detail'),
  card_detail_name:       () => document.getElementById('bcd-name'),
  card_detail_stats:      () => document.getElementById('bcd-stats'),
  card_detail_effect:     () => document.getElementById('bcd-effect'),
  card_detail_evo_source: () => document.getElementById('bcd-evo-source'),
  card_detail_sec_effect: () => document.getElementById('bcd-security-effect'),
};

let _highlightedEls = []; // 現在ハイライト中のDOM要素群

// カードNoからDOM要素を探す
function _findCardElement(cardNo) {
  if (!cardNo) return null;
  // 手札
  const hand = document.querySelectorAll('#hand-wrap .h-card');
  for (const el of hand) { if (el.dataset.cardNo === cardNo) return el; }
  // バトルエリア
  const battle = document.querySelectorAll('#pl-battle-row .b-slot');
  for (const el of battle) { if (el.dataset.cardNo === cardNo) return el; }
  // 育成エリア
  const raising = document.querySelector('#pl-iku-slot .b-slot, #pl-iku-slot');
  if (raising && raising.dataset && raising.dataset.cardNo === cardNo) return raising;
  return null;
}

function _showPointer(text, targetArea, opType, secondArea, targetCardNo, secondCardNo) {
  const overlay = document.getElementById('tutorial-pointer-overlay');
  const bubble = document.getElementById('tutorial-pointer-text');
  const finger = document.getElementById('tutorial-pointer-finger');
  const wrap   = document.getElementById('tutorial-pointer-wrap');
  if (!overlay || !bubble || !finger || !wrap) return;

  // カードNo指定があればカード要素を優先、なければエリア
  let targetEl = null;
  if (targetCardNo) targetEl = _findCardElement(targetCardNo);
  if (!targetEl && targetArea) {
    const finder = TARGET_AREA_SELECTORS[targetArea];
    targetEl = finder ? finder() : null;
  }

  if (!targetEl) {
    _hidePointer();
    return;
  }

  // テキスト設定
  bubble.innerText = text || '';

  // 赤枠ハイライト（1つ目）
  _clearHighlight();
  targetEl.classList.add('tutorial-highlight');
  _highlightedEls.push(targetEl);

  // 赤枠ハイライト（2つ目）: カードNo優先、なければエリア
  let secondEl = null;
  if (secondCardNo) secondEl = _findCardElement(secondCardNo);
  if (!secondEl && secondArea) {
    const finder2 = TARGET_AREA_SELECTORS[secondArea];
    secondEl = finder2 ? finder2() : null;
  }
  if (secondEl) {
    secondEl.classList.add('tutorial-highlight');
    _highlightedEls.push(secondEl);
  }

  // 操作アイコン設定
  const opInfo = _getOperationIcon(opType);
  finger.innerText = opInfo.icon;
  finger.style.animation = opInfo.anim;

  // 表示
  overlay.style.display = 'block';

  // 対象要素の位置を取得
  const rect = targetEl.getBoundingClientRect();
  const pointerH = wrap.offsetHeight || 100;
  const bubbleW = 320;

  // 対象の上に吹き出しを置く余白があれば上、なければ下
  // （多くの場合 = 上に表示。👇が下を指して target にツッコむ）
  const canFitAbove = rect.top > pointerH + 12;

  if (canFitAbove) {
    wrap.style.flexDirection = 'column';   // [bubble][finger]
    const top = rect.top - pointerH - 4;
    overlay.style.top = Math.max(4, top) + 'px';
    // 通常向き吹き出し（しっぽ下）
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.remove('tutorial-bubble-below');
  } else {
    wrap.style.flexDirection = 'column-reverse';  // [finger][bubble]
    const top = rect.bottom + 4;
    overlay.style.top = top + 'px';
    // 上向き吹き出し（しっぽ上）
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.add('tutorial-bubble-below');
  }

  // 水平位置: 対象の中央に合わせる
  const left = Math.max(8, Math.min(window.innerWidth - bubbleW - 8, rect.left + rect.width / 2 - bubbleW / 2));
  overlay.style.left = left + 'px';
}

function _clearHighlight() {
  _highlightedEls.forEach(el => el.classList.remove('tutorial-highlight'));
  _highlightedEls = [];
  // 念のため残留ハイライトも除去
  document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
}

function _hidePointer() {
  const overlay = document.getElementById('tutorial-pointer-overlay');
  if (overlay) overlay.style.display = 'none';
  _clearHighlight();
}

// クリア演出を表示
window._tutorialShowClear = function(scenario) {
  const overlay = document.getElementById('tutorial-clear-overlay');
  const titleEl = document.getElementById('tutorial-clear-title');
  const descEl = document.getElementById('tutorial-clear-desc');
  const msgEl = document.getElementById('tutorial-clear-message');
  if (!overlay) return;
  if (titleEl) titleEl.innerText = (scenario && scenario.tutorialName) || 'シナリオクリア!';
  if (descEl) descEl.innerText = (scenario && scenario.description) || '';
  // クリア後メッセージ
  if (msgEl) {
    if (scenario && scenario.clearMessage) {
      msgEl.innerText = scenario.clearMessage;
      msgEl.style.display = 'block';
    } else {
      msgEl.innerText = '';
      msgEl.style.display = 'none';
    }
  }
  overlay.style.display = 'flex';
};

// クリア演出を閉じる → シナリオ一覧へ戻る
window.closeTutorialClear = function() {
  const overlay = document.getElementById('tutorial-clear-overlay');
  if (overlay) overlay.style.display = 'none';

  // TutorialRunner を停止
  if (window._tutorialRunner && typeof window._tutorialRunner.stop === 'function') {
    try { window._tutorialRunner.stop(); } catch (e) {}
  }

  // 指示オーバーレイ + ゴール表示も確実に消す
  window._tutorialHideInstruction();
  const goalOverlay = document.getElementById('tutorial-instruction-overlay');
  if (goalOverlay) goalOverlay.style.display = 'none';

  // シナリオ一覧を再読込して進捗を反映
  if (typeof window.loadTutorialScreen === 'function') {
    window.loadTutorialScreen();
  } else {
    showScreen('tutorial-screen');
  }
};

// ===================================================================
// フェーズ説明ポップアップ（showPhaseGuide=true のシナリオのみ）
// ===================================================================
const PHASE_GUIDE_ICONS = {
  mulligan:  { icon: '🎴', title: 'マリガン（手札の引き直し）' },
  unsuspend: { icon: '🔄', title: 'アクティブフェーズ' },
  draw:      { icon: '🃏', title: 'ドローフェーズ' },
  breed:     { icon: '🥚', title: '育成フェーズ' },
  main:      { icon: '⚔️', title: 'メインフェーズ' },
};

let _phasePopupResolve = null;

window._tutorialShowPhaseGuide = function(phaseKey) {
  return new Promise(resolve => {
    const iconData = PHASE_GUIDE_ICONS[phaseKey];
    if (!iconData) { resolve(); return; }

    // シナリオのフェーズ説明テキストを取得（管理画面で設定したもの）
    const runner = window._tutorialRunner;
    const pgt = (runner && runner.scenario && runner.scenario.phaseGuideTexts) || {};
    const body = pgt[phaseKey];
    if (!body) { resolve(); return; } // テキスト未設定 = このフェーズはスキップ

    const data = { icon: iconData.icon, title: iconData.title, body };
    const popup = document.getElementById('tutorial-phase-popup');
    if (!popup) { resolve(); return; }
    document.getElementById('tutorial-phase-icon').innerText = data.icon;
    document.getElementById('tutorial-phase-title').innerText = data.title;
    document.getElementById('tutorial-phase-body').innerText = data.body;
    popup.style.display = 'flex';
    _phasePopupResolve = resolve;
  });
};

window.closeTutorialPhasePopup = function() {
  const popup = document.getElementById('tutorial-phase-popup');
  if (popup) popup.style.display = 'none';
  if (_phasePopupResolve) {
    const r = _phasePopupResolve;
    _phasePopupResolve = null;
    r();
  }
};

// ===================================================================
// message / spotlight ステップ用ポップアップ
// ===================================================================
let _stepPopupResolve = null;

// ブロックコンテキスト → 表示用フェーズ名
const _PHASE_DISPLAY_NAMES = {
  mulligan:  'マリガン',
  unsuspend: 'アクティブフェイズ',
  draw:      'ドローフェイズ',
  breed:     '育成フェイズ',
  main:      'メインフェイズ',
};
const _TRIGGER_DISPLAY_NAMES = {
  turn_start_self:       '自分のターン開始',
  before_end_turn:       '自分のターン終了',
  memory_crossed:        'メモリー相手側到達',
  before_opponent_turn:  '相手ターン開始',
  turn_end_opp:          '相手ターン終了',
  after_hatch:           '孵化完了後',
  after_play_cost:       '登場コスト支払い後',
  after_play:            '登場時効果完了後',
  after_evolve_cost:     '進化コスト+ドロー後',
  after_evolve:          '進化時効果完了後',
  after_attack:          'アタック解決後',
  after_use_effect:      '効果使用完了後',
  on_card_detail_open:   'カード詳細',
};
function _getStepContextTitle(ctx) {
  if (!ctx) return '';
  if (ctx.trigger) return _TRIGGER_DISPLAY_NAMES[ctx.trigger] || '';
  if (ctx.phase)   return _PHASE_DISPLAY_NAMES[ctx.phase]   || '';
  return '';
}

window._tutorialShowStepPopup = function(step, sType, ctx) {
  // spotlight: インライン表示（全画面モーダルを出さない）
  if (sType === 'spotlight') {
    return _tutorialShowInlineSpotlight(step, ctx);
  }
  // message: 全画面モーダル（従来通り）
  return new Promise(resolve => {
    const resolvedText = _resolveDeviceText(step.instructionText || '');
    const popup = document.getElementById('tutorial-phase-popup');
    if (!popup) { resolve(); return; }
    const iconEl = document.getElementById('tutorial-phase-icon');
    const titleEl = document.getElementById('tutorial-phase-title');
    const bodyEl = document.getElementById('tutorial-phase-body');
    if (iconEl) iconEl.innerText = '💬';
    if (titleEl) titleEl.innerText = _getStepContextTitle(ctx);
    if (bodyEl) bodyEl.innerText = resolvedText;
    popup.style.display = 'flex';
    _stepPopupResolve = resolve;
  });
};

// ===================================================================
// スポットライト（インライン表示）: マリガン画面を映したまま対象を浮かび上がらせる
// ===================================================================
function _tutorialShowInlineSpotlight(step, ctx) {
  return new Promise(resolve => {
    const text = _resolveDeviceText(step.instructionText || '');
    const targetArea = step.targetArea || '';
    const targetCardNo = step.targetCardNo || '';
    const secondArea = step.secondTargetArea || '';
    const secondCardNo = step.secondTargetCardNo || '';

    // 対象要素を取得（_showPointerと同じロジック）
    let targetEl = null;
    if (targetCardNo) targetEl = _findCardElement(targetCardNo);
    if (!targetEl && targetArea) {
      const finder = TARGET_AREA_SELECTORS[targetArea];
      targetEl = finder ? finder() : null;
    }

    // 吹き出し + 👇 + 赤枠を表示（通常のポインター表示を流用）
    _showPointer(text, targetArea, '', secondArea, targetCardNo, secondCardNo);

    // 対象に tutorial-spotlight-focus を追加 → 周囲が白く暗転
    if (targetEl) targetEl.classList.add('tutorial-spotlight-focus');
    if (secondCardNo || secondArea) {
      let secondEl = null;
      if (secondCardNo) secondEl = _findCardElement(secondCardNo);
      if (!secondEl && secondArea) {
        const f = TARGET_AREA_SELECTORS[secondArea];
        secondEl = f ? f() : null;
      }
      if (secondEl) secondEl.classList.add('tutorial-spotlight-focus');
    }

    // 「次へ」ボタンを画面下部に表示
    _showSpotlightNextBtn(() => {
      _hideSpotlightNextBtn();
      _hidePointer();
      _hideSpotlight();
      resolve();
    });
  });
}

// スポットライト専用「次へ」ボタン（画面下部に固定表示）
function _showSpotlightNextBtn(onClick) {
  let btn = document.getElementById('tutorial-spotlight-next');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'tutorial-spotlight-next';
    btn.className = 'menu-btn primary';
    btn.innerText = '次へ';
    btn.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:56500; padding:12px 48px; font-size:14px; font-weight:bold; border-radius:24px; box-shadow:0 4px 20px rgba(0,251,255,0.5); min-width:180px;';
    document.body.appendChild(btn);
  }
  btn.style.display = 'block';
  btn.onclick = onClick;
}

function _hideSpotlightNextBtn() {
  const btn = document.getElementById('tutorial-spotlight-next');
  if (btn) btn.style.display = 'none';
}

// closeTutorialPhasePopup は既存の「次へ」ボタン → stepPopup にも共用
const _origClosePhasePopup = window.closeTutorialPhasePopup;
window.closeTutorialPhasePopup = function() {
  const popup = document.getElementById('tutorial-phase-popup');
  if (popup) popup.style.display = 'none';

  // スポットライト暗転解除
  _hideSpotlight();

  // フェーズ説明 or ステップポップアップ、どちらのresolveがあるか
  if (_phasePopupResolve) {
    const r = _phasePopupResolve;
    _phasePopupResolve = null;
    r();
  }
  if (_stepPopupResolve) {
    const r = _stepPopupResolve;
    _stepPopupResolve = null;
    r();
  }
};

// ===================================================================
// スポットライト（暗転＋対象ハイライト）
// ===================================================================
function _showSpotlight(targetArea, secondArea) {
  // 対象を赤枠ハイライト + 周囲暗転（box-shadow で画面全体を覆う）
  _clearHighlight();
  const finder = TARGET_AREA_SELECTORS[targetArea];
  const el = finder ? finder() : null;
  if (el) {
    el.classList.add('tutorial-highlight', 'tutorial-spotlight-focus');
    _highlightedEls.push(el);
  }
  if (secondArea) {
    const finder2 = TARGET_AREA_SELECTORS[secondArea];
    const el2 = finder2 ? finder2() : null;
    if (el2) {
      el2.classList.add('tutorial-highlight', 'tutorial-spotlight-focus');
      _highlightedEls.push(el2);
    }
  }
}

function _hideSpotlight() {
  // spotlight-focus クラスも除去
  document.querySelectorAll('.tutorial-spotlight-focus').forEach(el =>
    el.classList.remove('tutorial-spotlight-focus')
  );
  _clearHighlight();
}

// ===================================================================
// ヘルパー
// ===================================================================
function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
