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
// 表示はバトル画面アクティブ かつ マリガン受諾後 に限定
let _tutorialGoalLabel = '';
let _tutorialGoalActive = false;
let _tutorialMulliganDone = false;

window._tutorialShowGoal = function(clearCondition) {
  _tutorialGoalLabel = _clearConditionToJapanese(clearCondition);
  _tutorialGoalActive = true;
  _refreshGoalBanner();
};

window._tutorialHideGoal = function() {
  _tutorialGoalActive = false;
  _refreshGoalBanner();
};

// battle.js から呼ばれる: マリガン状態の通知
// state: 'shown'(マリガン表示中) | 'accepted'(承諾済み)
window._tutorialNotifyMulligan = function(state) {
  _tutorialMulliganDone = (state === 'accepted');
  _refreshGoalBanner();
};

function _refreshGoalBanner() {
  const overlay = document.getElementById('tutorial-instruction-overlay');
  const el = document.getElementById('tutorial-instruction-text');
  if (!overlay || !el) return;
  const battleScreen = document.getElementById('battle-screen');
  const battleActive = battleScreen && battleScreen.classList.contains('active');
  const shouldShow = _tutorialGoalActive && battleActive && _tutorialMulliganDone;
  if (shouldShow) {
    el.innerText = _tutorialGoalLabel;
    overlay.style.display = 'block';
  } else {
    overlay.style.display = 'none';
  }
}

// 画面遷移時にゴール表示を再評価（バトル画面を離れたら自動で消える）
if (typeof window.showScreen === 'function' && !window._tutorialShowScreenWrapped) {
  const _origShowScreen = window.showScreen;
  window.showScreen = function(id) {
    const r = _origShowScreen.apply(this, arguments);
    try { _refreshGoalBanner(); } catch (e) {}
    return r;
  };
  window._tutorialShowScreenWrapped = true;
}

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
    // 対象未指定の action ステップは指差しを出さない
    // （tutorial-instruction-overlay は ゴール表示専用なので上書きしない）
    _hidePointer();
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

// 現在適用中のステップを保持（renderHand 後の再適用用）
let _activeUiStep = null;

function _applyStepUiControl(step) {
  _clearStepUiControl();
  if (!step || !step.uiControl) return;
  _activeUiStep = step;

  const greyOut = Array.isArray(step.greyOut) ? step.greyOut : [];
  const hlButtons = Array.isArray(step.highlightButtons) ? step.highlightButtons : [];
  const hlCards = [step.targetCardNo, step.secondTargetCardNo].filter(Boolean);
  const greyOutCards = greyOut.includes('other_cards');

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
  _activeUiStep = null;
}

// renderHand 等から呼ばれる再適用フック
// 手札が innerHTML='' で描き直されると tutorial-card-* クラスが剥がれるため、
// 直近の step に基づいて再適用する
window._tutorialReapplyUiControl = function() {
  if (!_activeUiStep) return;
  const step = _activeUiStep;
  const greyOut = Array.isArray(step.greyOut) ? step.greyOut : [];
  const hlCards = [step.targetCardNo, step.secondTargetCardNo].filter(Boolean);
  const greyOutCards = greyOut.includes('other_cards');
  if (hlCards.length === 0 && !greyOutCards) return;
  const allCards = document.querySelectorAll('#hand-wrap .h-card, #pl-battle-row .b-slot[data-card-no]');
  allCards.forEach(cardEl => {
    const no = cardEl.dataset.cardNo || '';
    if (hlCards.length > 0 && hlCards.includes(no)) {
      cardEl.classList.add('tutorial-card-highlight');
    } else if (greyOutCards) {
      cardEl.classList.add('tutorial-card-disabled');
    }
  });
};

// 成功演出（ステップ進行時）
window._tutorialShowSuccess = function(message) {
  const overlay = document.getElementById('tutorial-success-overlay');
  const textEl = document.getElementById('tutorial-success-text');
  if (!overlay || !textEl) return;
  textEl.innerText = message || 'OK!';
  // アニメリセット
  textEl.style.animation = 'none';
  void textEl.offsetHeight; // reflow
  textEl.style.animation = 'tutorialSuccessFlash 0.9s ease forwards';
  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; }, 950);
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
  // 手札の最後尾 = 直近ドローしたカード（drawCards は末尾に push するため）
  hand_last:     () => {
    const hw = document.getElementById('hand-wrap');
    if (!hw) return null;
    const cards = hw.querySelectorAll('.h-card');
    return cards.length ? cards[cards.length - 1] : null;
  },
  // ドロー演出中の中央カード
  drawn_card:    () => document.getElementById('draw-card-img'),
  battle:        () => document.getElementById('pl-battle-row'),
  end_turn_btn:  () => document.getElementById('action-bar'),
  mulligan_btn_start: () => document.querySelector('#mulligan-overlay .menu-btn.primary'),
  mulligan_btn_redo:  () => document.getElementById('mulligan-btn'),
  opp_security:  () => document.getElementById('ai-sec-area'),
  opp_battle:    () => document.getElementById('ai-battle-row'),
  // 自分・相手のセキュリティ/トラッシュ
  own_security:  () => document.getElementById('pl-sec-area'),
  own_trash:     () => {
    const cnt = document.getElementById('pl-trash-count');
    return cnt ? cnt.parentElement : null;
  },
  opp_trash:     () => {
    const cnt = document.getElementById('ai-trash-count');
    return cnt ? cnt.parentElement : null;
  },
  own_deck:      () => document.getElementById('pl-deck-img'),
  opp_deck:      () => document.getElementById('ai-deck-img'),
  memory_gauge:        () => document.getElementById('memory-gauge-row'),
  // 自分/相手側のメモリーゲージ全体を配列で返す（赤枠とスポットライトを全セルに付ける）
  memory_gauge_player: () => {
    const cells = document.querySelectorAll('#memory-gauge-row .m-pl');
    return cells.length ? Array.from(cells) : null;
  },
  memory_gauge_opp: () => {
    const cells = document.querySelectorAll('#memory-gauge-row .m-ai');
    return cells.length ? Array.from(cells) : null;
  },
  // 現在のメモリー（点灯中セル）
  memory_gauge_current: () => document.querySelector('#memory-gauge-row .m-active'),
  // カード詳細モーダル内部
  card_detail:            () => document.getElementById('b-card-detail'),
  card_detail_name:       () => document.getElementById('bcd-name'),
  card_detail_stats:      () => document.getElementById('bcd-stats'),
  card_detail_evo_cost:   () => document.getElementById('bcd-evo-cost'),
  card_detail_effect:     () => document.getElementById('bcd-effect'),
  card_detail_evo_source: () => document.getElementById('bcd-evo-source'),
  card_detail_sec_effect: () => document.getElementById('bcd-security-effect'),
  card_detail_close:      () => document.getElementById('bcd-close-btn'),
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

// 単一/配列どちらでも要素を配列で返す
function _resolveTargets(targetArea, targetCardNo) {
  if (targetCardNo) {
    const el = _findCardElement(targetCardNo);
    if (el) return [el];
  }
  if (targetArea) {
    const finder = TARGET_AREA_SELECTORS[targetArea];
    const result = finder ? finder() : null;
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }
  return [];
}

// 複数要素を包括する矩形を計算
function _unionRect(elements) {
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  elements.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < top) top = r.top;
    if (r.left < left) left = r.left;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  });
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

function _showPointer(text, targetArea, opType, secondArea, targetCardNo, secondCardNo) {
  const overlay = document.getElementById('tutorial-pointer-overlay');
  const bubble = document.getElementById('tutorial-pointer-text');
  const finger = document.getElementById('tutorial-pointer-finger');
  const wrap   = document.getElementById('tutorial-pointer-wrap');
  if (!overlay || !bubble || !finger || !wrap) return;

  // 対象解決（単一 or 配列）
  const targets = _resolveTargets(targetArea, targetCardNo);
  if (!targets.length) { _hidePointer(); return; }

  // テキスト設定
  bubble.innerText = text || '';

  // 赤枠ハイライト（1つ目: 全要素に付与）
  _clearHighlight();
  targets.forEach(el => { el.classList.add('tutorial-highlight'); _highlightedEls.push(el); });

  // 赤枠ハイライト（2つ目）
  const seconds = _resolveTargets(secondArea, secondCardNo);
  seconds.forEach(el => { el.classList.add('tutorial-highlight'); _highlightedEls.push(el); });

  // 操作アイコン設定
  const opInfo = _getOperationIcon(opType);
  finger.innerText = opInfo.icon;
  finger.style.animation = opInfo.anim;

  // 表示
  overlay.style.display = 'block';
  // 表示直後は wrap の offsetHeight が古い可能性があるので強制リフロー
  void wrap.offsetHeight;

  // 吹き出しと👆の位置は target1（プライマリ）で決める
  // （target2 が離れた場所にあると結合矩形の中央が変な所に行くため）
  const rect = _unionRect(targets.length ? targets : seconds);
  const pointerH = wrap.offsetHeight || 100;
  // 吹き出しは可変幅（CSS で max-width: min(85vw, 440px)）→ 実測値を使う
  const bubbleW = wrap.offsetWidth || 320;

  // 対象の上に吹き出しを置く余白があれば上、なければ下
  const canFitAbove = rect.top > pointerH + 12;

  if (canFitAbove) {
    wrap.style.flexDirection = 'column';   // [bubble][finger]
    const top = rect.top - pointerH - 4;
    overlay.style.top = Math.max(4, top) + 'px';
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.remove('tutorial-bubble-below');
  } else {
    wrap.style.flexDirection = 'column-reverse';  // [finger][bubble]
    const top = rect.bottom + 4;
    overlay.style.top = top + 'px';
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.add('tutorial-bubble-below');
  }

  // 👆/👇 は吹き出しの位置に応じて常に対象を指す向きに
  if (opType === 'tap' || !opType) {
    finger.innerText = canFitAbove ? '👇' : '👆';
  }

  // 水平位置: 吹き出しが画面に収まる範囲で対象中央寄せ
  const targetCenterX = rect.left + rect.width / 2;
  const left = Math.max(8, Math.min(window.innerWidth - bubbleW - 8, targetCenterX - bubbleW / 2));
  overlay.style.left = left + 'px';

  // 👆/👇 を対象の中央に合わせて横方向にオフセット
  // （対象が画面端で吹き出しがズレても、指マーカーは対象を指すように）
  // transform はアニメーションキーフレームで上書きされるので marginLeft を使う
  const wrapCenterX = left + bubbleW / 2;
  const fingerOffsetX = targetCenterX - wrapCenterX;
  finger.style.marginLeft = fingerOffsetX + 'px';
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
  if (typeof window._tutorialHideGoal === 'function') window._tutorialHideGoal();

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
  on_draw:               'ドロー演出',
};
function _getStepContextTitle(ctx) {
  if (!ctx) return '';
  if (ctx.trigger) return _TRIGGER_DISPLAY_NAMES[ctx.trigger] || '';
  if (ctx.phase)   return _PHASE_DISPLAY_NAMES[ctx.phase]   || '';
  return '';
}

// テキストを空行（連続する改行）で複数バブルに分割
// 例: "前半文章\n\n後半文章" → ["前半文章", "後半文章"]
function _splitMessageParts(text) {
  if (!text) return [''];
  // 改行正規化: \r\n / \r → \n
  const normalized = String(text).replace(/\r\n?/g, '\n');
  // 空行（改行 + 横方向空白のみの行 + 改行）で分割
  // [ \t\u3000\u00a0]* = 半角空白/タブ/全角空白/NBSP
  const parts = normalized
    .split(/\n[ \t\u3000\u00a0]*\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.length ? parts : [normalized];
}

window._tutorialShowStepPopup = function(step, sType, ctx) {
  // spotlight: インライン表示（全画面モーダルを出さない）
  if (sType === 'spotlight') {
    return _tutorialShowInlineSpotlight(step, ctx);
  }
  // message: 全画面モーダル（複数パート対応）
  return new Promise(resolve => {
    const fullText = _resolveDeviceText(step.instructionText || '');
    const parts = _splitMessageParts(fullText);
    const popup = document.getElementById('tutorial-phase-popup');
    if (!popup) { resolve(); return; }
    const iconEl  = document.getElementById('tutorial-phase-icon');
    const titleEl = document.getElementById('tutorial-phase-title');
    const bodyEl  = document.getElementById('tutorial-phase-body');
    const btn     = popup.querySelector('button');

    let idx = 0;
    const showPart = () => {
      if (iconEl)  iconEl.innerText  = '💬';
      if (titleEl) titleEl.innerText = _getStepContextTitle(ctx) +
        (parts.length > 1 ? ` (${idx + 1}/${parts.length})` : '');
      if (bodyEl)  bodyEl.innerText  = parts[idx];
      popup.style.display = 'flex';
      if (btn) {
        const isLast = (idx + 1) >= parts.length;
        btn.innerText = isLast ? '次へ' : '次へ ▶';
        btn.onclick = () => {
          if (isLast) {
            popup.style.display = 'none';
            btn.onclick = window.closeTutorialPhasePopup; // 元に戻す
            resolve();
          } else {
            idx++;
            showPart();
          }
        };
      }
    };
    showPart();
  });
};

// ===================================================================
// スポットライト（インライン表示）: 画面はそのまま、対象以外を黒く暗転
// ===================================================================
function _tutorialShowInlineSpotlight(step, ctx) {
  return new Promise(resolve => {
    const fullText = _resolveDeviceText(step.instructionText || '');
    const parts = _splitMessageParts(fullText);
    const targetArea = step.targetArea || '';
    const targetCardNo = step.targetCardNo || '';
    const secondArea = step.secondTargetArea || '';
    const secondCardNo = step.secondTargetCardNo || '';

    // 対象要素を取得（配列対応）
    const targetEls = _resolveTargets(targetArea, targetCardNo);
    const secondEls = _resolveTargets(secondArea, secondCardNo);

    // UI制御（グレーアウト/ハイライト）を spotlight にも適用
    _applyStepUiControl(step);

    // 黒い暗転オーバーレイは1度だけ表示（パート切替で消えないように）
    _createSpotlightDimOverlay(targetEls, secondEls);

    let idx = 0;
    const showPart = () => {
      _showPointer(parts[idx], targetArea, '', secondArea, targetCardNo, secondCardNo);
      const isLast = (idx + 1) >= parts.length;
      const okBtn = document.getElementById('tutorial-spotlight-ok');
      if (okBtn) okBtn.innerText = isLast ? 'OK' : '次へ ▶';
      _showSpotlightNextBtn(() => {
        idx++;
        if (idx < parts.length) {
          showPart();
        } else {
          _hideSpotlightNextBtn();
          if (okBtn) okBtn.innerText = 'OK'; // 元に戻す
          _removeSpotlightDimOverlay();
          _hidePointer();
          _hideSpotlight();
          resolve();
        }
      });
    };
    showPart();
  });
}

// スポットライト暗転（opacity方式）:
// 対象+祖先+子孫に .tutorial-keep-visible を付け、それ以外の兄弟要素を透明度で薄く
// → マリガン背景が既に暗い場合も、非対象要素が消えるように暗く見える
function _createSpotlightDimOverlay(targetEls, secondEls) {
  _removeSpotlightDimOverlay();
  // 単一要素/配列どちらでも受け付け、フラットな配列にまとめる
  const flat = [];
  const collect = (x) => { if (!x) return; if (Array.isArray(x)) x.forEach(collect); else flat.push(x); };
  collect(targetEls); collect(secondEls);
  if (!flat.length) return;

  flat.forEach(el => { _markElementAndKin(el); });
  document.body.classList.add('tutorial-spotlight-mode');
}

// 対象 + 祖先全部 + 子孫全部に .tutorial-keep-visible を付与
function _markElementAndKin(el) {
  // 祖先（自分含む）
  let cur = el;
  while (cur) {
    cur.classList.add('tutorial-keep-visible');
    cur = cur.parentElement;
  }
  // 子孫
  const walk = (node) => {
    Array.from(node.children).forEach(child => {
      child.classList.add('tutorial-keep-visible');
      walk(child);
    });
  };
  walk(el);
}

function _removeSpotlightDimOverlay() {
  document.body.classList.remove('tutorial-spotlight-mode');
  document.querySelectorAll('.tutorial-keep-visible').forEach(el =>
    el.classList.remove('tutorial-keep-visible')
  );
}

// スポットライト専用OKボタン（吹き出し内に表示）
function _showSpotlightNextBtn(onClick) {
  const btn = document.getElementById('tutorial-spotlight-ok');
  if (!btn) return;
  btn.style.display = 'inline-block';
  btn.onclick = onClick;
}

function _hideSpotlightNextBtn() {
  const btn = document.getElementById('tutorial-spotlight-ok');
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
// レガシー: 現在は _tutorialShowInlineSpotlight がメイン
function _showSpotlight(targetArea, secondArea) {
  // 旧: box-shadow 方式（未使用だが closeTutorialPhasePopup 互換のため残置）
  _clearHighlight();
}

function _hideSpotlight() {
  // 念のため spotlight-focus も除去
  document.querySelectorAll('.tutorial-spotlight-focus').forEach(el =>
    el.classList.remove('tutorial-spotlight-focus')
  );
  _clearHighlight();
  // 暗転オーバーレイも念のため削除
  _removeSpotlightDimOverlay();
}

// ===================================================================
// ヘルパー
// ===================================================================
function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
