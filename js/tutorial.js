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

  if (targetArea) {
    _showPointer(resolvedText, targetArea, opType, secondArea);
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
  _clearStepUiControl(); // 前回の制御をクリア
  if (!step) return;

  // --- カードハイライト ---
  const hlCards = step.highlightCardNos;
  const blockOther = step.blockOther;
  if (Array.isArray(hlCards) && hlCards.length > 0) {
    // 全カード要素を取得（手札 .h-card / バトルエリア .b-slot[data-card-no]）
    const allCards = document.querySelectorAll('#hand-wrap .h-card, #pl-battle-row .b-slot[data-card-no]');
    allCards.forEach(cardEl => {
      const cardNo = cardEl.dataset.cardNo || (cardEl.querySelector('[data-card-no]') || {}).dataset?.cardNo || '';
      if (hlCards.includes(cardNo)) {
        cardEl.classList.add('tutorial-card-highlight');
      } else if (blockOther) {
        cardEl.classList.add('tutorial-card-disabled');
      }
    });
    _uiControlActive = true;
  }

  // --- ボタン制御 ---
  const btnCtrl = step.buttonControl;
  if (btnCtrl && typeof btnCtrl === 'object') {
    Object.entries(btnCtrl).forEach(([btnKey, state]) => {
      if (!state) return;
      const selector = _BUTTON_SELECTOR_MAP[btnKey];
      if (!selector) return;
      const btn = document.querySelector(selector);
      if (!btn) return;

      // 元の状態を保存
      _savedButtonStates.push({
        el: btn,
        disabled: btn.disabled,
        classes: [...btn.classList],
      });

      if (state === 'disabled') {
        btn.disabled = true;
        btn.classList.add('tutorial-btn-disabled');
      } else if (state === 'highlighted') {
        btn.classList.add('tutorial-btn-highlighted');
      }
    });
    _uiControlActive = true;
  }

  // blockOther時: ブロック用オーバーレイは不要、CSS pointer-events で制御
  if (blockOther && _uiControlActive) {
    document.body.classList.add('tutorial-block-other');
  }
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
const TARGET_AREA_SELECTORS = {
  raising:       () => document.getElementById('pl-iku-slot'),
  hand:          () => document.getElementById('hand-wrap'),
  battle:        () => document.getElementById('pl-battle-row'),
  end_turn_btn:  () => document.getElementById('action-bar'),
  opp_security:  () => document.querySelector('#ai-security-row, [id*="ai-sec"]'),
  opp_battle:    () => document.getElementById('ai-battle-row'),
  memory_gauge:  () => document.getElementById('memory-gauge-row'),
};

let _highlightedEls = []; // 現在ハイライト中のDOM要素群

function _showPointer(text, targetArea, opType, secondArea) {
  const overlay = document.getElementById('tutorial-pointer-overlay');
  const bubble = document.getElementById('tutorial-pointer-text');
  const finger = document.getElementById('tutorial-pointer-finger');
  const wrap   = document.getElementById('tutorial-pointer-wrap');
  if (!overlay || !bubble || !finger || !wrap) return;

  const finder = TARGET_AREA_SELECTORS[targetArea];
  const targetEl = finder ? finder() : null;

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

  // 赤枠ハイライト（2つ目）
  if (secondArea) {
    const finder2 = TARGET_AREA_SELECTORS[secondArea];
    const el2 = finder2 ? finder2() : null;
    if (el2) {
      el2.classList.add('tutorial-highlight');
      _highlightedEls.push(el2);
    }
  }

  // 操作アイコン設定
  const opInfo = _getOperationIcon(opType);
  finger.innerText = opInfo.icon;
  finger.style.animation = opInfo.anim;

  // 表示
  overlay.style.display = 'block';

  // 対象要素の位置を取得
  const rect = targetEl.getBoundingClientRect();
  const screenH = window.innerHeight;
  const pointerH = wrap.offsetHeight || 80;
  const bubbleW = 260;

  // 対象が画面下半分 → 吹き出しを対象の上に
  // 対象が画面上半分 → 吹き出しを対象の下に
  const targetCenter = rect.top + rect.height / 2;
  const isBelow = targetCenter > screenH * 0.5;

  if (isBelow) {
    wrap.style.flexDirection = 'column';
    const top = rect.top - pointerH - 4;
    overlay.style.top = Math.max(4, top) + 'px';
  } else {
    wrap.style.flexDirection = 'column-reverse';
    const top = rect.bottom + 4;
    overlay.style.top = top + 'px';
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

window._tutorialShowStepPopup = function(step, sType) {
  return new Promise(resolve => {
    const resolvedText = _resolveDeviceText(step.instructionText || '');
    const targetArea = step.targetArea || '';

    if (sType === 'spotlight' && targetArea) {
      // スポットライト: 他エリアを暗転 + 対象を赤枠ハイライト
      _showSpotlight(targetArea, step.secondTargetArea || '');
    }

    // ポップアップ表示（フェーズ説明と同じモーダルを流用）
    const popup = document.getElementById('tutorial-phase-popup');
    if (!popup) { resolve(); return; }
    const iconEl = document.getElementById('tutorial-phase-icon');
    const titleEl = document.getElementById('tutorial-phase-title');
    const bodyEl = document.getElementById('tutorial-phase-body');
    if (iconEl) iconEl.innerText = sType === 'spotlight' ? '🔦' : '💬';
    if (titleEl) titleEl.innerText = '';
    if (bodyEl) bodyEl.innerText = resolvedText;
    popup.style.display = 'flex';
    _stepPopupResolve = resolve;
  });
};

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
  // 対象を赤枠ハイライト
  _clearHighlight();
  const finder = TARGET_AREA_SELECTORS[targetArea];
  const el = finder ? finder() : null;
  if (el) {
    el.classList.add('tutorial-highlight');
    _highlightedEls.push(el);
  }
  if (secondArea) {
    const finder2 = TARGET_AREA_SELECTORS[secondArea];
    const el2 = finder2 ? finder2() : null;
    if (el2) {
      el2.classList.add('tutorial-highlight');
      _highlightedEls.push(el2);
    }
  }
}

function _hideSpotlight() {
  _clearHighlight();
}

// ===================================================================
// ヘルパー
// ===================================================================
function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
