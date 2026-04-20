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

// 新規解放マーク用: 既に見たシナリオを localStorage に保持
function _seenKey() {
  const player = window.currentPlayerName || '';
  const pw = window.currentSessionPassword || '';
  return `tutorial_seen::${player}::${pw}`;
}
function _getSeenSet() {
  try {
    const raw = localStorage.getItem(_seenKey());
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) { return new Set(); }
}
function _markSeen(scenarioId) {
  if (!scenarioId) return;
  const set = _getSeenSet();
  if (set.has(scenarioId)) return;
  set.add(scenarioId);
  try { localStorage.setItem(_seenKey(), JSON.stringify([...set])); } catch (e) {}
}
// 解放済みかつ未クリアかつ未閲覧 = New
function _isNew(scenario, seenSet) {
  if (_isLocked(scenario)) return false;
  if (_isCleared(scenario.id)) return false;
  return !seenSet.has(scenario.id);
}

function _renderScenarioList() {
  const area = document.getElementById('tutorial-scenario-select-area');
  if (!area) return;

  // order昇順（API側でソート済みだが念のため）
  const list = [..._scenariosCache].sort((a, b) => (a.order || 0) - (b.order || 0));
  const seenSet = _getSeenSet();

  area.innerHTML = list.map(s => {
    const cleared = _isCleared(s.id);
    const locked  = _isLocked(s);
    const isNew   = _isNew(s, seenSet);
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
        : isNew
          ? 'cursor:pointer; border:1px solid #ffcc00; box-shadow:0 0 8px rgba(255,204,0,0.4);'
          : 'cursor:pointer; border:1px solid #222;';

    const clickAttr = locked ? '' : `onclick="selectTutorialScenario('${s.id}')"`;

    // クリア済み ✔ / ロック 🔒 / 新規解放 NEW
    let badge = '';
    if (cleared) {
      badge = '<span style="background:#00ff88; color:#000; font-size:12px; font-weight:bold; padding:2px 7px; border-radius:3px; margin-left:6px;">✔</span>';
    } else if (locked) {
      badge = '<span style="background:#444; color:#aaa; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">🔒</span>';
    } else if (isNew) {
      badge = '<span style="background:#ffcc00; color:#000; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:3px; margin-left:6px; animation:tutorialNewPulse 1.2s ease-in-out infinite;">NEW</span>';
    }

    return `
      <div style="${baseStyle}${bgStyle}" ${clickAttr}>
        <img src="${imgUrl}" style="width:40px; height:56px; flex-shrink:0; border-radius:3px; object-fit:cover; margin-right:12px; background:#000;" onerror="this.style.display='none'">
        <div style="flex:1; min-width:0; overflow:hidden;">
          <div style="color:#fff; font-size:13px; font-weight:bold; word-break:break-all; overflow-wrap:anywhere;">
            ${_escHtml(title)}${badge}
          </div>
          <div style="color:#888; font-size:11px;">${diff ? '難易度: ' + _escHtml(diff) : ''}</div>
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

  // 一度詳細画面を開いたら NEW バッジを消す
  _markSeen(scenarioId);

  _selectedScenario = scenario;
  _selectedDeck = _decksCache.find(d => (d.deckId || d.tutorialName) === scenario.deckId) || null;

  // タイトル・目的表示
  document.getElementById('tl-scenario-title').innerText = scenario.tutorialName || '';
  document.getElementById('tl-scenario-difficulty').innerText = scenario.difficulty ? `難易度: ${scenario.difficulty}` : '';
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
  const p = cond.params || {};

  // パラメータ付きの動的テキスト
  if (cond.type === 'turn_end') {
    const turn = p.turn;
    return turn ? `🎯 ${turn}ターン目を終了しよう` : '🎯 ターンを終了しよう';
  }
  if (cond.type === 'turn_start') {
    const turn = p.turn;
    return turn ? `🎯 ${turn}ターン目を開始しよう` : '🎯 ターンを開始しよう';
  }
  if (cond.type === 'security_check_n') {
    const count = p.count || 1;
    return `🎯 相手セキュリティを${count}枚チェックしよう`;
  }
  if (cond.type === 'evolve_lv') {
    return `🎯 Lv.${p.level || '?'}に進化させよう`;
  }
  if (cond.type === 'play_lv') {
    return `🎯 Lv.${p.level || '?'}を登場させよう`;
  }

  const map = {
    hatch: '育成エリアで孵化しよう',
    play_any: 'カードをプレイしよう',
    play_specific: 'カードをプレイしよう',
    play_digimon: 'デジモンを登場させよう',
    play_option: 'オプションカードを使おう',
    play_tamer: 'テイマーカードを登場させよう',
    evolve_any: 'デジモンを進化させよう',
    evolve_specific: 'デジモンを進化させよう',
    attack_declared: 'アタック宣言しよう',
    attack_target_selected: '対象を選択しよう',
    attack_resolved: 'バトルを解決しよう',
    direct_attack: 'ダイレクトアタックしよう',
    block: 'ブロックしよう',
    destroy_opponent: '相手デジモンを消滅させよう',
    security_reduced: '相手のセキュリティを削ろう',
    security_zero: '相手セキュリティを0枚にしよう',
    effect_target_selected: '効果の対象を選ぼう',
    use_effect: '効果を発動しよう',
    effect_triggered: '効果を誘発させよう',
    security_effect: 'セキュリティ効果を発動しよう',
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
// 空行で分割された複数パートに対応:
//   - 中間パート: 「次へ ▶」ボタンで進める
//   - 最後のパート: ボタン非表示、進行条件 (タップ/進化等) を待つ
window._tutorialShowInstruction = function(text, targetArea, step) {
  const resolvedText = _resolveDeviceText(text);
  const opType = (step && step.operationType) || '';
  const secondArea = (step && step.secondTargetArea) || '';
  const targetCardNo = (step && step.targetCardNo) || '';
  const secondCardNo = (step && step.secondTargetCardNo) || '';

  const parts = _splitMessageParts(resolvedText);
  let idx = 0;
  const showPart = () => {
    const partText = parts[idx];
    _showPointer(partText, targetArea, opType, secondArea, targetCardNo, secondCardNo);
    const isLast = (idx + 1) >= parts.length;
    if (isLast) {
      _hideSpotlightNextBtn();
    } else {
      const okBtn = document.getElementById('tutorial-spotlight-ok');
      if (okBtn) okBtn.innerText = '次へ ▶';
      _showSpotlightNextBtn(() => {
        idx++;
        showPart();
      });
    }
  };
  showPart();

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
  breed_skip:    '#breed-skip-btn',
  exit_gate:     '#exit-gate-btn',
  confirm_yes:   '#effect-confirm-yes',
  confirm_no:    '#effect-confirm-no',
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
  // area-aware ペア: area 指定があればそのエリア内のカードだけ赤枠対象にする
  const hlPairs = [
    { area: step.targetArea || '', cardNo: step.targetCardNo || '' },
    { area: step.secondTargetArea || '', cardNo: step.secondTargetCardNo || '' },
  ].filter(p => p.cardNo);
  const greyOutCards = greyOut.includes('other_cards');

  // --- カードハイライト + グレーアウト ---
  if (hlPairs.length > 0 || greyOutCards) {
    const _cardAreaSelectors = {
      hand: '#hand-wrap .h-card, #mulligan-hand-preview .mulligan-card',
      battle: '#pl-battle-row .b-slot[data-card-no]',
      raising: '#pl-iku-slot',
      opp_battle: '#ai-battle-row .b-slot[data-card-no]',
    };
    const allCards = document.querySelectorAll('#hand-wrap .h-card, #pl-battle-row .b-slot[data-card-no], #mulligan-hand-preview .mulligan-card');
    allCards.forEach(cardEl => {
      const no = cardEl.dataset.cardNo || '';
      let isHighlight = false;
      for (const p of hlPairs) {
        if (p.cardNo !== no) continue;
        if (!p.area) { isHighlight = true; break; }          // エリア未指定 → 全域マッチ
        const sel = _cardAreaSelectors[p.area];
        if (!sel) { isHighlight = true; break; }              // 未知エリア → 全域マッチ
        if (cardEl.matches(sel)) { isHighlight = true; break; }
      }
      if (isHighlight) {
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

  // --- 育成エリアグレーアウト ---
  if (greyOut.includes('raising_area')) {
    const iku = document.getElementById('pl-iku-slot');
    if (iku) {
      _savedButtonStates.push({ el: iku, disabled: false });
      iku.classList.add('tutorial-card-disabled');
      iku.style.pointerEvents = 'none';
      _uiControlActive = true;
    }
  }

  // --- ボタングレーアウト ---
  greyOut.forEach(key => {
    if (key === 'other_cards' || key === 'raising_area') return;
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

  // ボタン/エリア状態復元
  _savedButtonStates.forEach(({ el, disabled }) => {
    el.disabled = disabled;
    el.style.pointerEvents = '';
    el.classList.remove('tutorial-btn-disabled', 'tutorial-btn-highlighted');
  });
  _savedButtonStates = [];

  // ブロック解除
  document.body.classList.remove('tutorial-block-other');
  _uiControlActive = false;
  _activeUiStep = null;
}

// renderHand 等から呼ばれる再適用フック
// 手札が innerHTML='' で描き直されると tutorial-card-* クラスが剥がれる、
// 育成フェイズの「何もしない」ボタンは execBreed で動的生成されるため
// step show時にはまだ存在しない → 再適用が必要
window._tutorialReapplyUiControl = function() {
  // renderAll 後にスポットライト対象も再マーク (keep-visible クラス剥がれ対策)
  if (typeof window._tutorialReapplySpotlight === 'function') {
    try { window._tutorialReapplySpotlight(); } catch (_) {}
  }
  if (!_activeUiStep) return;
  const step = _activeUiStep;
  const greyOut = Array.isArray(step.greyOut) ? step.greyOut : [];
  const hlButtons = Array.isArray(step.highlightButtons) ? step.highlightButtons : [];
  const hlPairs = [
    { area: step.targetArea || '', cardNo: step.targetCardNo || '' },
    { area: step.secondTargetArea || '', cardNo: step.secondTargetCardNo || '' },
  ].filter(p => p.cardNo);
  const greyOutCards = greyOut.includes('other_cards');

  // --- カード再適用 (area-aware) ---
  if (hlPairs.length > 0 || greyOutCards) {
    const _cardAreaSelectors = {
      hand: '#hand-wrap .h-card, #mulligan-hand-preview .mulligan-card',
      battle: '#pl-battle-row .b-slot[data-card-no]',
      raising: '#pl-iku-slot',
      opp_battle: '#ai-battle-row .b-slot[data-card-no]',
    };
    const allCards = document.querySelectorAll('#hand-wrap .h-card, #pl-battle-row .b-slot[data-card-no], #mulligan-hand-preview .mulligan-card');
    allCards.forEach(cardEl => {
      const no = cardEl.dataset.cardNo || '';
      let isHighlight = false;
      for (const p of hlPairs) {
        if (p.cardNo !== no) continue;
        if (!p.area) { isHighlight = true; break; }
        const sel = _cardAreaSelectors[p.area];
        if (!sel) { isHighlight = true; break; }
        if (cardEl.matches(sel)) { isHighlight = true; break; }
      }
      if (isHighlight) {
        cardEl.classList.add('tutorial-card-highlight');
      } else if (greyOutCards) {
        cardEl.classList.add('tutorial-card-disabled');
      }
    });
  }

  // --- ボタンハイライト 再適用 ---
  hlButtons.forEach(btnKey => {
    const selector = _BUTTON_SELECTOR_MAP[btnKey];
    if (!selector) return;
    const btn = document.querySelector(selector);
    if (!btn) return;
    if (!btn.classList.contains('tutorial-btn-highlighted')) {
      _savedButtonStates.push({ el: btn, disabled: btn.disabled });
      btn.classList.add('tutorial-btn-highlighted');
    }
  });

  // --- ボタングレーアウト 再適用 ---
  greyOut.forEach(key => {
    if (key === 'other_cards') return;
    const selector = _BUTTON_SELECTOR_MAP[key];
    if (!selector) return;
    const btn = document.querySelector(selector);
    if (!btn) return;
    if (btn.classList.contains('tutorial-btn-highlighted')) return;
    if (!btn.classList.contains('tutorial-btn-disabled')) {
      _savedButtonStates.push({ el: btn, disabled: btn.disabled });
      btn.disabled = true;
      btn.classList.add('tutorial-btn-disabled');
    }
  });
};

// 成功演出（ステップ進行時）
// 成功演出: queue → battle側でflush → 完了をawait できる設計
//   queue : _advanceStep から呼ぶ。すぐには出さない（バトル演出中に重なるのを防ぐ）
//   flush : バトル演出が終わった直後に battle 側から呼ぶ。pending を実演出に変える
//   await : 次ステップ表示を遅らせる用。実演出が終わるまで Promise を返す
let _pendingSuccessMsg     = null;
let _pendingSuccessTimer   = null;
let _activeSuccessPromise  = null;

window._tutorialQueueSuccess = function(message) {
  _pendingSuccessMsg = message;
  // 安全装置: バトル側が flush を呼ばないケースに備えて 8s 後に自動 flush
  if (_pendingSuccessTimer) clearTimeout(_pendingSuccessTimer);
  _pendingSuccessTimer = setTimeout(() => {
    if (typeof window._tutorialFlushSuccess === 'function') window._tutorialFlushSuccess();
  }, 8000);
};

window._tutorialFlushSuccess = function() {
  if (_pendingSuccessTimer) { clearTimeout(_pendingSuccessTimer); _pendingSuccessTimer = null; }
  if (!_pendingSuccessMsg) return _activeSuccessPromise || Promise.resolve();
  const msg = _pendingSuccessMsg;
  _pendingSuccessMsg = null;
  return _runSuccessAnim(msg);
};

window._tutorialAwaitSuccess = function() {
  // queue 中ならまず flush して await。実演出中ならそのまま await。
  if (_pendingSuccessMsg) return window._tutorialFlushSuccess();
  return _activeSuccessPromise || Promise.resolve();
};

// ===== 「battle 側の一連の処理が完全に終わるまで次ステップ表示を待つ」仕組み =====
// バトル演出 → 成功演出 → 割り込み(ドロー説明等) を全て見せきってから、
// main block の次ステップを表示するために使う。
//   _tutorialAwaitBattleDone(): battle 側が done を呼ぶまで await
//   _tutorialBattleDone(): battle 側が「全工程完了」を通知
// 安全タイマー: 10s 経っても呼ばれなかったら自動解除（保険）
let _battleDoneResolve = null;
let _battleDoneTimer = null;
window._tutorialAwaitBattleDone = function() {
  return new Promise(resolve => {
    _battleDoneResolve = resolve;
    if (_battleDoneTimer) clearTimeout(_battleDoneTimer);
    _battleDoneTimer = setTimeout(() => {
      if (_battleDoneResolve === resolve) {
        _battleDoneResolve = null;
        resolve();
      }
    }, 10000);
  });
};
window._tutorialBattleDone = function() {
  if (_battleDoneTimer) { clearTimeout(_battleDoneTimer); _battleDoneTimer = null; }
  if (_battleDoneResolve) {
    const r = _battleDoneResolve;
    _battleDoneResolve = null;
    r();
  }
};

// 直接表示（後方互換用）
window._tutorialShowSuccess = function(message) {
  if (_pendingSuccessTimer) { clearTimeout(_pendingSuccessTimer); _pendingSuccessTimer = null; }
  _pendingSuccessMsg = null;
  return _runSuccessAnim(message);
};

// ランクごとの色テーマ
function _successTheme(message) {
  const m = String(message || '').toUpperCase();
  if (m.includes('PERFECT'))   return { c1:'#ffd700', c2:'#ff8800', c3:'#ff00ff', stroke:'#fff', glow:'255,215,0', label:'rainbow' };
  if (m.includes('NICE'))      return { c1:'#00d4ff', c2:'#0088ff', c3:'#00ffaa', stroke:'#fff', glow:'0,212,255',  label:'blue' };
  if (m.includes('GREAT'))     return { c1:'#00ff88', c2:'#00cc66', c3:'#88ffaa', stroke:'#fff', glow:'0,255,136',  label:'green' };
  if (m.includes('OK'))        return { c1:'#ffffff', c2:'#cccccc', c3:'#88ddff', stroke:'#00fbff', glow:'200,240,255', label:'white' };
  if (m.includes('AMAZING'))   return { c1:'#ff5577', c2:'#ff0044', c3:'#ffaa00', stroke:'#fff', glow:'255,85,119',  label:'red' };
  return { c1:'#ffdd44', c2:'#ff9933', c3:'#00fbff', stroke:'#fff', glow:'255,221,68', label:'gold' };
}

function _runSuccessAnim(message) {
  const overlay   = document.getElementById('tutorial-success-overlay');
  const textEl    = document.getElementById('tutorial-success-text');
  const panelEl   = document.getElementById('tutorial-success-panel');
  const flashEl   = document.getElementById('tutorial-success-flash');
  const ringEl    = document.getElementById('tutorial-success-ring');
  const ring2El   = document.getElementById('tutorial-success-ring2');
  const convEl    = document.getElementById('tutorial-success-converge');
  const sparkleEl = document.getElementById('tutorial-success-sparkles');
  if (!overlay || !textEl) return Promise.resolve();
  textEl.innerText = message || 'OK!';

  // ===== ランクごとの色を適用 =====
  const t = _successTheme(message);
  const isRainbow = t.label === 'rainbow';
  if (isRainbow) {
    textEl.style.color = 'transparent';
    textEl.style.backgroundImage = 'linear-gradient(135deg,' + t.c1 + ',' + t.c2 + ' 50%,' + t.c3 + ')';
    textEl.style.backgroundClip = 'text';
    textEl.style.webkitBackgroundClip = 'text';
  } else {
    textEl.style.color = t.c1;
    textEl.style.backgroundImage = 'none';
  }
  textEl.style.webkitTextStroke = '3px ' + t.stroke;
  textEl.style.textShadow = '0 0 30px rgba(' + t.glow + ',0.95), 0 0 80px rgba(' + t.glow + ',0.6)';
  if (flashEl) flashEl.style.background = 'radial-gradient(circle, rgba(255,255,200,0.95) 0%, rgba(' + t.glow + ',0.55) 35%, rgba(' + t.glow + ',0) 70%)';
  if (ringEl)  { ringEl.style.borderColor = t.c1; ringEl.style.boxShadow = '0 0 30px rgba(' + t.glow + ',0.85)'; }

  // ===== 先に表示してからアニメリセット =====
  // display:none 状態でアニメを設定すると即終了状態と判断されるブラウザがあるため、
  // 必ず flex で見せてから reset → reflow → animation の順で組む
  overlay.style.display = 'flex';
  overlay.style.animation = 'none';
  textEl.style.animation  = 'none';
  // textEl の前回 forwards で残った transform/opacity/filter をリセット
  textEl.style.transform = '';
  textEl.style.opacity = '';
  textEl.style.filter = '';
  if (panelEl)  panelEl.style.animation  = 'none';
  if (flashEl)  flashEl.style.animation  = 'none';
  if (ringEl)   ringEl.style.animation   = 'none';
  if (ring2El)  ring2El.style.animation  = 'none';
  void textEl.offsetHeight; // reflow

  // ===== 集中線生成 (12 本、画面端から中央へ) =====
  if (convEl) {
    convEl.innerHTML = '';
    const lineCount = 12;
    for (let i = 0; i < lineCount; i++) {
      const angle = (360 / lineCount) * i;
      const rad = angle * Math.PI / 180;
      const dist = Math.max(window.innerWidth, window.innerHeight) * 0.55;
      const fromX = Math.cos(rad) * dist;
      const fromY = Math.sin(rad) * dist;
      const len = 100 + Math.random() * 80;
      const colorPick = i % 3 === 0 ? t.c1 : i % 3 === 1 ? t.c2 : t.c3;
      const line = document.createElement('div');
      line.style.cssText =
        'position:absolute; left:50%; top:50%;' +
        'width:' + len + 'px; height:4px;' +
        'background:linear-gradient(90deg, transparent, ' + colorPick + ', transparent);' +
        'box-shadow:0 0 12px ' + colorPick + ';' +
        'transform-origin:50% 50%;' +
        '--from-x:' + fromX + 'px; --from-y:' + fromY + 'px; --rot:' + angle + 'deg;' +
        'animation:tutorialSuccessConverge 0.55s ease-out forwards;';
      convEl.appendChild(line);
    }
  }

  // ===== アニメ開始 (reflow 後に設定) =====
  // 二重 requestAnimationFrame でブラウザのレイアウト確定を保証してから動かす
  // → 「アニメが効かず静止状態になる」現象の予防
  const startAnimations = () => {
    overlay.style.animation = 'tutorialSuccessBg 1.3s ease forwards';
    // Slam (scale) は textEl に、Shake (translate) は panelEl に分離
    textEl.style.animation  = 'tutorialSuccessSlam 1.3s cubic-bezier(0.2,0.9,0.3,1) forwards';
    if (panelEl)  panelEl.style.animation = 'tutorialSuccessShake 0.5s ease 0.18s';
    if (flashEl)  flashEl.style.animation = 'tutorialSuccessLightFlash 0.85s ease-out forwards';
    if (ringEl)   ringEl.style.animation  = 'tutorialSuccessRing 0.7s ease-out 0.18s forwards';
    if (ring2El)  ring2El.style.animation = 'tutorialSuccessRing2 0.6s ease-out 0.25s forwards';
  };
  requestAnimationFrame(() => requestAnimationFrame(startAnimations));

  // ===== 粒子フィニッシュ (爆発時に発生) =====
  if (sparkleEl) {
    sparkleEl.innerHTML = '';
    setTimeout(() => {
      const colors = [t.c1, t.c2, t.c3, '#ffffff'];
      for (let i = 0; i < 24; i++) {
        const sz = 4 + Math.random() * 7;
        const ang = Math.random() * Math.PI * 2;
        const radius = 80 + Math.random() * 220;
        const dx = Math.cos(ang) * radius;
        const dy = Math.sin(ang) * radius;
        const rot = (Math.random() - 0.5) * 720;
        const dur = 0.7 + Math.random() * 0.4;
        const c = colors[Math.floor(Math.random() * colors.length)];
        const p = document.createElement('div');
        p.style.cssText =
          'position:absolute; left:50%; top:50%;' +
          'width:' + sz + 'px; height:' + sz + 'px;' +
          'background:' + c + '; border-radius:' + (Math.random() < 0.5 ? '50%' : '2px') + ';' +
          'box-shadow:0 0 10px ' + c + ';' +
          '--dx:' + dx + 'px; --dy:' + dy + 'px; --rot:' + rot + 'deg;' +
          'animation:tutorialSuccessSparkle ' + dur + 's ease-out forwards;';
        sparkleEl.appendChild(p);
      }
    }, 180);
  }

  _activeSuccessPromise = new Promise(resolve => {
    setTimeout(() => {
      overlay.style.display = 'none';
      if (convEl) convEl.innerHTML = '';
      if (sparkleEl) sparkleEl.innerHTML = '';
      _activeSuccessPromise = null;
      resolve();
    }, 1350);
  });
  return _activeSuccessPromise;
}

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
  card_detail_evo_source:           () => document.getElementById('bcd-evo-source'),
  card_detail_evo_source_stack:     () => document.getElementById('bcd-evo-source-stack'),
  card_detail_evo_source_stack_0:   () => document.getElementById('bcd-evo-source-stack-0'),
  card_detail_evo_source_stack_1:   () => document.getElementById('bcd-evo-source-stack-1'),
  card_detail_evo_source_stack_2:   () => document.getElementById('bcd-evo-source-stack-2'),
  card_detail_evo_source_stack_3:   () => document.getElementById('bcd-evo-source-stack-3'),
  card_detail_evo_source_stack_4:   () => document.getElementById('bcd-evo-source-stack-4'),
  card_detail_sec_effect: () => document.getElementById('bcd-security-effect'),
  card_detail_close:      () => document.getElementById('bcd-close-btn'),
  // 効果確認ダイアログ
  // 確認ダイアログ: 効果発動確認 (#effect-confirm-*) と対象確認 (#_target-*) の両方を
  // サポート。現在表示中の方を返す (offsetParent で可視判定)。
  effect_confirm:         () => {
    const panels = [document.getElementById('effect-confirm-panel'),
                    document.querySelector('#_target-confirm-overlay > div')];
    return panels.find(e => e && e.offsetParent) || panels.find(e => e) || null;
  },
  effect_confirm_yes:     () => {
    const btns = [document.getElementById('effect-confirm-yes'),
                  document.getElementById('_target-yes')];
    return btns.find(e => e && e.offsetParent) || btns.find(e => e) || null;
  },
  effect_confirm_no:      () => {
    const btns = [document.getElementById('effect-confirm-no'),
                  document.getElementById('_target-no')];
    return btns.find(e => e && e.offsetParent) || btns.find(e => e) || null;
  },
  // トラッシュモーダル
  trash_modal:       () => document.getElementById('trash-modal'),
  trash_close_btn:   () => document.getElementById('trash-close-btn'),
  // VS画面（セキュリティチェック/バトル演出）
  vs_screen:         () => document.getElementById('security-check-overlay'),
  vs_cards:          () => document.getElementById('sec-vs-cards'),
  vs_atk_area:       () => document.getElementById('sec-atk-area'),
  vs_atk_card:       () => document.getElementById('sec-atk-card-img'),
  vs_atk_name:       () => document.getElementById('sec-atk-name'),
  vs_atk_dp:         () => document.getElementById('sec-atk-dp'),
  vs_def_area:       () => document.getElementById('sec-def-area'),
  vs_def_card:       () => document.getElementById('sec-check-card-img'),
  vs_def_name:       () => document.getElementById('sec-check-card-name'),
  vs_def_dp:         () => document.getElementById('sec-check-type'),
  vs_label:          () => document.getElementById('sec-vs-label'),
  vs_title:          () => document.getElementById('sec-check-label'),
  vs_result:         () => document.getElementById('sec-check-result'),
};

let _highlightedEls = []; // 現在ハイライト中のDOM要素群

// カードNoからDOM要素を探す
// エリア限定: "battle:ST1-03" → バトルエリアのST1-03のみ
//   プレフィックス: hand: / battle: / raising: / trash:
function _findCardElement(rawCardNo) {
  if (!rawCardNo) return null;

  // エリア指定を分離
  let area = null, cardNo = rawCardNo;
  const colonIdx = rawCardNo.indexOf(':');
  if (colonIdx > 0 && colonIdx < rawCardNo.length - 1) {
    const prefix = rawCardNo.substring(0, colonIdx).toLowerCase();
    if (['hand', 'battle', 'raising', 'trash'].includes(prefix)) {
      area = prefix;
      cardNo = rawCardNo.substring(colonIdx + 1);
    }
  }

  // マリガン中の最初の5枚
  if ((!area || area === 'hand') && _isMulliganActive()) {
    const mul = document.querySelectorAll('#mulligan-hand-preview .mulligan-card');
    for (const el of mul) { if (el.dataset.cardNo === cardNo) return el; }
  }
  // 手札
  if (!area || area === 'hand') {
    const hand = document.querySelectorAll('#hand-wrap .h-card');
    for (const el of hand) { if (el.dataset.cardNo === cardNo) return el; }
  }
  // バトルエリア
  if (!area || area === 'battle') {
    const battle = document.querySelectorAll('#pl-battle-row .b-slot');
    for (const el of battle) { if (el.dataset.cardNo === cardNo) return el; }
  }
  // 育成エリア
  if (!area || area === 'raising') {
    const raising = document.querySelector('#pl-iku-slot .b-slot, #pl-iku-slot');
    if (raising && raising.dataset && raising.dataset.cardNo === cardNo) return raising;
  }
  // トラッシュモーダル内
  if (!area || area === 'trash') {
    const trashModal = document.getElementById('trash-modal');
    if (trashModal && trashModal.style.display !== 'none') {
      const trashCards = trashModal.querySelectorAll('[data-card-no]');
      for (const el of trashCards) {
        if (el.dataset.cardNo === cardNo) return el;
      }
      for (const el of trashCards) {
        if (el.dataset.cardName && el.dataset.cardName.includes(cardNo)) return el;
      }
    }
  }
  return null;
}

// 単一/配列どちらでも要素を配列で返す
// targetArea + targetCardNo 両方指定 → そのエリア内のカードを検索
function _resolveTargets(targetArea, targetCardNo) {
  if (targetArea && targetCardNo) {
    // エリア内のカードを検索
    const areaToScope = {
      hand: '#hand-wrap .h-card',
      battle: '#pl-battle-row .b-slot',
      raising: '#pl-iku-slot .b-slot, #pl-iku-slot',
      opp_battle: '#ai-battle-row .b-slot',
      opp_security: '#ai-sec-area .sec-card',
    };
    const selector = areaToScope[targetArea];
    if (selector) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        if (el.dataset.cardNo === targetCardNo) return [el];
        if (el.dataset.cardNo && el.dataset.cardNo.includes(targetCardNo)) return [el];
      }
      // カード名での検索（data-card-no にカード名が入っていない場合）
      for (const el of els) {
        const nameEl = el.querySelector('.card-name, .b-name');
        if (nameEl && nameEl.textContent.includes(targetCardNo)) return [el];
      }
    }
    // エリア限定が効かない場合は従来のグローバル検索にフォールバック
    const el = _findCardElement(targetCardNo);
    if (el) return [el];
  }
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

  // 前回のフォールバック用スタイルをリセット
  overlay.style.transform = '';
  finger.style.display = '';

  // 対象解決（単一 or 配列）
  let targets = _resolveTargets(targetArea, targetCardNo);
  // ターゲットが見つからない場合、少し待って再試行（動的生成ボタン等のため）
  if (!targets.length && (targetArea || targetCardNo)) {
    // 動的生成ボタン等のため複数回リトライ
    let retryCount = 0;
    const retryTimer = setInterval(() => {
      retryCount++;
      const retryTargets = _resolveTargets(targetArea, targetCardNo);
      if (retryTargets.length) {
        clearInterval(retryTimer);
        _showPointer(text, targetArea, opType, secondArea, targetCardNo, secondCardNo);
      } else if (retryCount >= 5) {
        clearInterval(retryTimer);
      }
    }, 200);
  }
  if (!targets.length) {
    // ターゲットなしでもテキストは表示（画面中央付近）
    bubble.innerText = text || '';
    overlay.style.display = 'block';
    wrap.style.flexDirection = 'column';
    overlay.style.top = '40%';
    overlay.style.left = '50%';
    overlay.style.transform = 'translateX(-50%)';
    finger.style.display = 'none';
    return;
  }
  finger.style.display = '';

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
  // 対象の bounds が (0,0,0,0) (非表示直後や transition 中) の場合は少し待って再計算
  if ((rect.width === 0 && rect.height === 0) || (rect.top === 0 && rect.left === 0 && rect.right === 0 && rect.bottom === 0)) {
    let rc = 0;
    const rt = setInterval(() => {
      rc++;
      const rt2 = _resolveTargets(targetArea, targetCardNo);
      if (rt2.length) {
        const r2 = _unionRect(rt2);
        if (r2.width > 0 || r2.height > 0) {
          clearInterval(rt);
          _showPointer(text, targetArea, opType, secondArea, targetCardNo, secondCardNo);
        }
      }
      if (rc >= 10) clearInterval(rt);
    }, 100);
    // 本関数はそのまま進める (暫定的に画面中央 or 対象位置に描画されるが、retry で更新)
  }
  const pointerH = wrap.offsetHeight || 100;
  // 吹き出しは可変幅（CSS で max-width: min(85vw, 440px)）→ 実測値を使う
  const bubbleW = wrap.offsetWidth || 320;

  // 対象との隙間 = 赤枠 outline (3px) + outline-offset (2px) + 視認用 margin
  // 合計 18px を確保して、説明枠と赤枠が重ならないようにする
  const TARGET_GAP = 18;
  const viewH = window.innerHeight;
  const canFitAbove = rect.top > pointerH + TARGET_GAP + 8;
  const canFitBelow = (rect.bottom + TARGET_GAP + pointerH) < viewH - 8;

  if (canFitAbove) {
    wrap.style.flexDirection = 'column';   // [bubble][finger]
    const top = rect.top - pointerH - TARGET_GAP;
    overlay.style.top = Math.max(4, top) + 'px';
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.remove('tutorial-bubble-below');
  } else if (canFitBelow) {
    wrap.style.flexDirection = 'column-reverse';  // [finger][bubble]
    const top = rect.bottom + TARGET_GAP;
    overlay.style.top = top + 'px';
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.add('tutorial-bubble-below');
  } else {
    // 上にも下にも収まらない → 画面上部に配置、吹き出し(下向き尻尾)→👇 の順
    wrap.style.flexDirection = 'column';
    overlay.style.top = '4px';
    const bubbleEl = document.getElementById('tutorial-pointer-bubble');
    if (bubbleEl) bubbleEl.classList.remove('tutorial-bubble-below');
  }

  // 👆/👇 は吹き出しの位置に応じて常に対象を指す向きに
  if (opType === 'tap' || !opType) {
    // 上に配置 or フォールバック上部配置 → 👇（下を指す）、下に配置 → 👆（上を指す）
    finger.innerText = (canFitAbove || !canFitBelow) ? '👇' : '👆';
  }

  // 水平位置: 吹き出しが画面に収まる範囲で対象中央寄せ
  const targetCenterX = rect.left + rect.width / 2;
  const left = Math.max(8, Math.min(window.innerWidth - bubbleW - 8, targetCenterX - bubbleW / 2));
  overlay.style.left = left + 'px';

  // 👆/👇 を対象の中央に合わせて横方向にオフセット
  // (対象が画面端で吹き出しがズレても、指マーカーは対象を指すように)
  // 位置補正は finger 親の anchor に position:left でかける
  // (finger 自身の transform はアニメーションキーフレームで上書きされるため避ける)
  const wrapCenterX = left + bubbleW / 2;
  const fingerOffsetX = targetCenterX - wrapCenterX;
  const anchor = document.getElementById('tutorial-pointer-finger-anchor');
  if (anchor) {
    anchor.style.position = 'relative';
    anchor.style.left = fingerOffsetX + 'px';
    finger.style.marginLeft = '0';  // 旧マージン残りをクリア
  } else {
    finger.style.marginLeft = fingerOffsetX + 'px';
  }

  // 吹き出しのしっぽも対象方向に向ける
  // bubble の左端からの相対 px を CSS変数 --arrow-left にセット
  const bubbleEl = document.getElementById('tutorial-pointer-bubble');
  if (bubbleEl) {
    const bRect = bubbleEl.getBoundingClientRect();
    const arrowLeftPx = targetCenterX - bRect.left;
    // bubble の端から 24px 以上内側に収める（しっぽが角に出ないように）
    const clamped = Math.max(24, Math.min(bRect.width - 24, arrowLeftPx));
    bubbleEl.style.setProperty('--arrow-left', clamped + 'px');
  }
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

// クリア演出を表示（多段階アニメ）
//   1) 暗転（0〜400ms）
//   2) シナリオタイトル fade-in（400〜900ms）
//   3) 「シナリオクリア!」がバンッ（1000〜1700ms）+ 紙吹雪
//   4) 詳細パネル fade-in（1900ms〜）
window._tutorialShowClear = function(scenario) {
  const overlay   = document.getElementById('tutorial-clear-overlay');
  const titleStage= document.getElementById('tutorial-clear-title-stage');
  const banner    = document.getElementById('tutorial-clear-banner');
  const detail    = document.getElementById('tutorial-clear-detail');
  const titleEl   = document.getElementById('tutorial-clear-title');
  const msgEl     = document.getElementById('tutorial-clear-message');
  const nextBtn   = document.getElementById('tutorial-clear-next-btn');
  const particles = document.getElementById('tutorial-clear-particles');
  const goldEl    = document.getElementById('tutorial-clear-goldflash');
  const raysEl    = document.getElementById('tutorial-clear-rays');
  const ringEl    = document.getElementById('tutorial-clear-ring-stage');
  if (!overlay) return;

  // テキストセット
  if (titleEl) titleEl.innerText = (scenario && scenario.tutorialName) || 'シナリオ';
  if (msgEl) {
    if (scenario && scenario.clearMessage) {
      msgEl.innerText = scenario.clearMessage;
      msgEl.style.display = 'block';
    } else {
      msgEl.innerText = '';
      msgEl.style.display = 'none';
    }
  }
  const next = _findNextScenario(scenario);
  _pendingNextScenario = next;
  if (nextBtn) {
    nextBtn.style.display = next ? 'block' : 'none';
    if (next) nextBtn.innerText = `次のシナリオ：${next.tutorialName || ''} ▷`;
  }

  // 状態リセット
  if (titleStage) { titleStage.style.opacity = '0'; titleStage.style.transform = 'translateY(40px)'; }
  if (banner)     { banner.style.opacity = '0'; banner.style.animation = 'none'; }
  if (detail)     { detail.style.opacity = '0'; detail.style.transform = 'translateY(30px)'; }
  if (particles)  particles.innerHTML = '';
  if (ringEl)     ringEl.innerHTML = '';
  if (goldEl)     { goldEl.style.opacity = '0'; goldEl.style.animation = 'none'; }
  if (raysEl)     { raysEl.style.opacity = '0'; raysEl.style.animation = 'none'; }

  // 表示
  overlay.style.background = 'rgba(0,0,0,0)';
  overlay.style.backdropFilter = 'blur(0)';
  overlay.style.animation = 'tutorialClearBgFade 0.5s ease forwards';
  overlay.style.display = 'flex';

  // 黄金フラッシュ (画面全体が一瞬明るくなる)
  setTimeout(() => {
    if (goldEl) {
      void goldEl.offsetHeight;
      goldEl.style.animation = 'tutorialClearGoldFlash 0.7s ease-out forwards';
    }
    if (raysEl) {
      void raysEl.offsetHeight;
      raysEl.style.animation = 'tutorialClearRays 6s linear forwards';
    }
  }, 100);

  // タイトル スライドアップ + fade-in
  setTimeout(() => {
    if (titleStage) { titleStage.style.opacity = '1'; titleStage.style.transform = 'translateY(0)'; }
  }, 600);

  // 「シナリオクリア!」バンッ + 揺れ + 紙吹雪 + リング波
  setTimeout(() => {
    if (banner) {
      banner.style.opacity = '1';
      banner.style.animation = 'tutorialClearBangIn 0.9s cubic-bezier(0.2,0.9,0.3,1) forwards, tutorialClearShake 0.5s ease 0.28s';
    }
    _spawnRingWaves(ringEl);
    _spawnConfettiBurst(particles, 60);
    _spawnConfettiFall(particles, 50);
  }, 1200);

  // 詳細パネル スライドアップ
  setTimeout(() => {
    if (detail) { detail.style.opacity = '1'; detail.style.transform = 'translateY(0)'; }
  }, 2300);
};

// リング波: 中央から外へ拡散する金色のリング3〜4重
function _spawnRingWaves(container) {
  if (!container) return;
  const colors = ['#ffdd44', '#ffaa00', '#00fbff', '#00ff88'];
  for (let i = 0; i < 4; i++) {
    const ring = document.createElement('div');
    const c = colors[i % colors.length];
    ring.style.cssText =
      'position:absolute; left:0; top:0;' +
      'width:200px; height:200px;' +
      'border:6px solid ' + c + ';' +
      'border-radius:50%;' +
      'box-shadow:0 0 30px ' + c + ', inset 0 0 20px ' + c + '88;' +
      'transform:translate(-50%,-50%) scale(0);' +
      'animation:tutorialClearRingExpand ' + (1.0 + i * 0.15) + 's ease-out ' + (i * 0.12) + 's forwards;';
    container.appendChild(ring);
  }
  setTimeout(() => { if (container) container.innerHTML = ''; }, 2400);
}

// 紙吹雪 (中央から爆発)
function _spawnConfettiBurst(container, count) {
  if (!container) return;
  const colors = ['#ffdd44', '#ff5577', '#00fbff', '#00ff88', '#ff00fb', '#ffaa00', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const sz = 6 + Math.random() * 10;
    const ang = Math.random() * Math.PI * 2;
    const radius = 200 + Math.random() * 500;
    const dx = Math.cos(ang) * radius;
    const dy = Math.sin(ang) * radius - 100; // 上方向に少しバイアス
    const dr = (Math.random() - 0.5) * 1080;
    const dur = 1.2 + Math.random() * 0.9;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText =
      'position:absolute; left:50%; top:50%;' +
      'width:' + sz + 'px; height:' + sz + 'px;' +
      'background:' + color + '; border-radius:' + (Math.random() < 0.5 ? '50%' : '2px') + ';' +
      'box-shadow:0 0 10px ' + color + ';' +
      '--dx:' + dx + 'px; --dy:' + dy + 'px; --dr:' + dr + 'deg;' +
      'animation:tutorialClearConfetti ' + dur + 's ease-out forwards;';
    container.appendChild(p);
  }
}

// 紙吹雪 (上から降る、複数色)
function _spawnConfettiFall(container, count) {
  if (!container) return;
  const colors = ['#ffdd44', '#ff5577', '#00fbff', '#00ff88', '#ff00fb', '#ffaa00', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const sz = 6 + Math.random() * 8;
    const startX = Math.random() * window.innerWidth;
    const dx = (Math.random() - 0.5) * 200;
    const dr = (Math.random() - 0.5) * 720;
    const dur = 2.5 + Math.random() * 1.5;
    const delay = Math.random() * 0.8;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText =
      'position:absolute; left:' + startX + 'px; top:0;' +
      'width:' + sz + 'px; height:' + (sz * (Math.random() < 0.5 ? 1.6 : 1)) + 'px;' +
      'background:' + color + '; border-radius:' + (Math.random() < 0.4 ? '50%' : '2px') + ';' +
      'box-shadow:0 0 8px ' + color + ';' +
      '--dx:' + dx + 'px; --dr:' + dr + 'deg;' +
      'animation:tutorialClearConfettiFall ' + dur + 's ease-in ' + delay + 's forwards;';
    container.appendChild(p);
  }
  setTimeout(() => { if (container) container.innerHTML = ''; }, 5000);
}

// 次に進むべきシナリオを判定（order昇順 + 未クリア + 前提クリア済みの最初のもの）
let _pendingNextScenario = null;
function _findNextScenario(currentScenario) {
  if (!currentScenario) return null;
  const list = [..._scenariosCache].sort((a, b) => (a.order || 0) - (b.order || 0));
  // 1) prerequisiteId === currentScenario.id のものを優先
  const byPrereq = list.find(s => s.id !== currentScenario.id && s.prerequisiteId === currentScenario.id);
  if (byPrereq) return byPrereq;
  // 2) order 順で current より後のものを順に探し、ロックされていない最初のものを返す
  const curOrder = currentScenario.order || 0;
  for (const s of list) {
    if (s.id === currentScenario.id) continue;
    if ((s.order || 0) <= curOrder) continue;
    if (s.prerequisiteId && s.prerequisiteId !== currentScenario.id && !_isCleared(s.prerequisiteId)) continue;
    return s;
  }
  return null;
}

// 「次のシナリオへ」ボタン
window.goToNextScenario = function() {
  const next = _pendingNextScenario;
  if (!next) return;
  // 現在のクリア演出を閉じる + ランナー停止 + 一覧再読込はせず、直接シナリオ詳細へ
  const overlay = document.getElementById('tutorial-clear-overlay');
  if (overlay) overlay.style.display = 'none';
  if (window._tutorialRunner && typeof window._tutorialRunner.stop === 'function') {
    try { window._tutorialRunner.stop(); } catch (e) {}
  }
  window._tutorialHideInstruction();
  if (typeof window._tutorialHideGoal === 'function') window._tutorialHideGoal();
  // 次シナリオの詳細画面を開く（シナリオ一覧を経由しない）
  if (typeof window.selectTutorialScenario === 'function') {
    window.selectTutorialScenario(next.id);
  } else if (typeof window.loadTutorialScreen === 'function') {
    window.loadTutorialScreen();
  } else {
    showScreen('tutorial-screen');
  }
};

function _spawnConfetti(container, count) {
  if (!container) return;
  const colors = ['#ffdd44', '#ff5577', '#00fbff', '#00ff88', '#ff00fb', '#ffaa00'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const sz = 6 + Math.random() * 8;
    const dx = (Math.random() - 0.5) * 600;
    const dy = (Math.random() - 0.2) * 700;
    const dr = (Math.random() - 0.5) * 720;
    const dur = 1.2 + Math.random() * 0.8;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `position:absolute; left:50%; top:50%; width:${sz}px; height:${sz}px; background:${color}; border-radius:${Math.random()<0.5?'50%':'2px'}; --dx:${dx}px; --dy:${dy}px; --dr:${dr}deg; animation:tutorialClearConfetti ${dur}s ease-out forwards; box-shadow:0 0 8px ${color}80;`;
    container.appendChild(p);
  }
  // 後始末（演出終了後にDOM片付け）
  setTimeout(() => { if (container) container.innerHTML = ''; }, 2200);
}

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
        btn.innerText = isLast ? 'OK' : '次へ ▶';
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
    _createSpotlightDimOverlay(targetEls, secondEls, { targetArea, targetCardNo, secondArea, secondCardNo });

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
// renderAll 後に再適用できるように、現在のスポットライト対象情報を保持
let _activeSpotlightArgs = null;  // { targetArea, targetCardNo, secondArea, secondCardNo }

function _createSpotlightDimOverlay(targetEls, secondEls, spotlightArgs) {
  _removeSpotlightDimOverlay();
  // 単一要素/配列どちらでも受け付け、フラットな配列にまとめる
  const flat = [];
  const collect = (x) => { if (!x) return; if (Array.isArray(x)) x.forEach(collect); else flat.push(x); };
  collect(targetEls); collect(secondEls);
  if (!flat.length) return;

  flat.forEach(el => { _markElementAndKin(el); });
  document.body.classList.add('tutorial-spotlight-mode');
  // 再適用用に対象情報を保存
  if (spotlightArgs) _activeSpotlightArgs = spotlightArgs;
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
  _activeSpotlightArgs = null;
}

// renderAll 等で DOM 再生成されても keep-visible クラスを再適用する
window._tutorialReapplySpotlight = function() {
  if (!_activeSpotlightArgs) return;
  const a = _activeSpotlightArgs;
  const targetEls = _resolveTargets(a.targetArea || '', a.targetCardNo || '');
  const secondEls = _resolveTargets(a.secondArea || '', a.secondCardNo || '');
  const flat = [];
  const collect = (x) => { if (!x) return; if (Array.isArray(x)) x.forEach(collect); else flat.push(x); };
  collect(targetEls); collect(secondEls);
  if (!flat.length) return;
  // 既存の keep-visible をクリアしてから再マーク (body クラスは保持)
  document.querySelectorAll('.tutorial-keep-visible').forEach(el =>
    el.classList.remove('tutorial-keep-visible')
  );
  flat.forEach(el => { _markElementAndKin(el); });
};

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
