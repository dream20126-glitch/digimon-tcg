// ===================================================================
// チュートリアルシナリオ管理画面ロジック
// admin.html から派生した管理機能。シナリオCRUD + 編集フォーム。
// ===================================================================
import { gasGet, gasPost } from './firebase-config.js';
import { loadCardAndKeywordData, getCardImageUrl } from './cards.js';

// 進行条件・クリア条件の種別定義（プルダウン用）
// ここに追加/削除すれば管理画面のプルダウンに自動反映される
// 新しい条件タイプを追加するときは tutorial-runner.js の CONDITION_EVALUATORS にも追加すること
const CONDITION_TYPES = [
  // 育成フェイズ関連
  { value: 'breed_end',          label: '育成フェイズ終了（孵化/移動/何もしない）', needsCardNo: false },
  // 進化
  { value: 'evolve_any',         label: 'デジモンを進化させた',     needsCardNo: false },
  { value: 'evolve_lv6',         label: 'レベル6に進化させた',       needsCardNo: false },
  // 登場・カード使用
  { value: 'play_digimon',       label: 'デジモンを登場させた',     needsCardNo: false },
  { value: 'play_option',        label: 'オプションカードを使った', needsCardNo: false },
  { value: 'play_tamer',         label: 'テイマーカードを使った',   needsCardNo: false },
  // アタック
  { value: 'attack_declared',    label: 'アタック宣言した（アタックボタン押下）', needsCardNo: false },
  { value: 'attack_resolved',    label: 'バトルを解決した（デジモン/セキュリティ）', needsCardNo: false },
  { value: 'direct_attack',      label: 'ダイレクトアタックした',   needsCardNo: false },
  { value: 'block',              label: 'ブロックした',             needsCardNo: false },
  // 効果
  { value: 'use_effect',         label: '効果を使った（任意）',     needsCardNo: false },
  { value: 'effect_triggered',   label: '効果を誘発させた',         needsCardNo: false },
  { value: 'security_effect',    label: 'セキュリティ効果を発動させた', needsCardNo: false },
  // 特殊
  { value: 'security_zero',      label: '相手セキュリティを0枚にした', needsCardNo: false },
  { value: 'card_detail_closed', label: 'カード詳細を見た（閉じた）', needsCardNo: false },
  // 既存の進行系（互換のため残す）
  { value: 'turn_end',           label: 'ターン終了した',           needsCardNo: false },
  { value: 'turn_start',         label: 'ターン開始した',           needsCardNo: false },
];

// 指差しマーカーの対象エリア定義（全シナリオ共通で使用）
const TARGET_AREAS = [
  { value: '',                label: 'なし（指差しなし）' },
  { value: 'raising',         label: '育成エリア' },
  { value: 'hand',            label: '手札エリア' },
  { value: 'battle',          label: 'バトルエリア' },
  { value: 'end_turn_btn',    label: 'ターン終了ボタン' },
  { value: 'opp_security',        label: '相手セキュリティ' },
  { value: 'opp_battle',          label: '相手バトルエリア' },
  { value: 'memory_gauge',        label: 'メモリーゲージ（全体）' },
  { value: 'memory_gauge_player', label: 'メモリーゲージ（自分側）' },
  { value: 'memory_gauge_opp',    label: 'メモリーゲージ（相手側）' },
  // カード詳細モーダル内部の部位
  { value: 'card_detail',            label: 'カード詳細：モーダル全体' },
  { value: 'card_detail_name',       label: 'カード詳細：カード名' },
  { value: 'card_detail_stats',      label: 'カード詳細：Lv/DP/コスト' },
  { value: 'card_detail_effect',    label: 'カード詳細：効果欄' },
  { value: 'card_detail_evo_source', label: 'カード詳細：進化元効果' },
  { value: 'card_detail_sec_effect', label: 'カード詳細：セキュリティ効果' },
];

// ステップタイプ定義
const STEP_TYPES = [
  { value: 'action',    label: '操作誘導（ユーザーが操作→次へ）' },
  { value: 'message',   label: '説明ポップアップ（「次へ」ボタンで進行）' },
  { value: 'spotlight', label: 'スポットライト説明（焦点+暗転+「次へ」ボタン）' },
];

// 操作タイプ定義（ステップごとに選択可能）
const OPERATION_TYPES = [
  { value: '',             label: 'なし（指差しのみ）' },
  { value: 'tap',          label: 'タップ 👆' },
  { value: 'drag',         label: 'ドラッグ ➡️' },
  { value: 'long_press',   label: '長押し ✋' },
  { value: 'swipe_left',   label: '左スワイプ ⬅️' },
  { value: 'rest_action',  label: 'レスト操作（PC:長押し / SP:左スワイプ 自動判定）' },
];

// ボタン制御対象の定義
const BUTTON_TARGETS = [
  { value: 'mulligan_redo', label: '引き直しボタン' },
  { value: 'game_start',    label: 'ゲーム開始ボタン' },
  { value: 'end_turn',      label: 'ターン終了ボタン' },
];

// 割り込みトリガー定義（詳細プレビュー/サマリー用、ALL_FLOW_SLOTSからラベル引き）
const TRIGGER_TYPES = [
  // ターン境界
  { value: 'turn_start_self',       label: '自分のターン開始' },
  { value: 'before_end_turn',      label: '自分のターン終了直前' },
  { value: 'memory_crossed',       label: 'メモリー相手側到達時' },
  { value: 'before_opponent_turn', label: '相手ターン開始前' },
  { value: 'turn_end_opp',         label: '相手ターン終了後' },
  // アクション中間点（コスト支払い後、効果発動前）
  { value: 'after_play_cost',      label: '登場コスト支払い後（効果前）' },
  { value: 'after_evolve_cost',    label: '進化コスト支払い+ドロー後（効果前）' },
  // アクション完了後（効果処理完了後）
  { value: 'after_hatch',          label: '孵化完了後' },
  { value: 'after_play',           label: '登場時効果完了後' },
  { value: 'after_evolve',         label: '進化時効果完了後' },
  { value: 'after_attack',         label: 'アタック解決後' },
  { value: 'after_use_effect',     label: '効果使用完了後' },
  // UI系
  { value: 'on_card_detail_open',  label: 'カード詳細表示中' },
];

// フェーズ定義（表示用）
const PHASE_DEFS = [
  { value: 'mulligan',  label: '🎴 マリガン',         color: '#ff88ff' },
  { value: 'unsuspend', label: '🔄 アクティブフェーズ', color: '#88ccff' },
  { value: 'draw',      label: '🃏 ドローフェーズ',     color: '#88ffcc' },
  { value: 'breed',     label: '🥚 育成フェーズ',       color: '#ffcc44' },
  { value: 'main',      label: '⚔️ メインフェーズ',     color: '#ff6666' },
];

// モジュール状態
let _scenarioEditData = null; // 編集中のシナリオ (null = 新規)
let _scenarioFlow = [];       // 編集中フロー配列 [{phase, turn, trigger?, steps:[]}]
let _tutorialDecksCache = [];
let _scenariosCache = [];     // 前提シナリオプルダウン用
let _initialBoardState = null; // 初期盤面の編集中状態
let _opponentScript = [];      // 相手AIスクリプトの編集中状態

// 相手AIアクション種別定義（新しいアクションを追加したい場合はここに1行）
// fields: 入力欄として表示するフィールド名
const OPPONENT_ACTION_TYPES = [
  { value: 'hatch',           label: '孵化',               fields: [] },
  { value: 'play',            label: 'カードをプレイ',       fields: ['cardNo'] },
  { value: 'evolve',          label: '進化',               fields: ['sourceCardNo', 'targetCardNo'] },
  { value: 'attack_security', label: 'セキュリティアタック', fields: ['sourceCardNo'] },
  { value: 'attack_digimon',  label: '相手デジモンアタック', fields: ['sourceCardNo', 'targetCardNo'] },
  { value: 'pass',            label: '何もしない',         fields: [] },
  { value: 'end_turn',        label: 'ターン終了',         fields: [] },
];

const FIELD_LABELS = {
  cardNo:       'カードNo',
  sourceCardNo: '実行側のカードNo (自分の場)',
  targetCardNo: '対象カードNo',
};

// 初期盤面の空状態を作成
function _emptyBoardState() {
  return {
    playerHand: [],        // [{cardNo}, ...]
    playerBattleArea: [],  // [{cardNo}, ...]
    playerRaisingArea: null,  // {cardNo} or null
    opponentHand: [],
    opponentBattleArea: [],
    opponentRaisingArea: null,
  };
}

// ===================================================================
// シナリオ一覧
// ===================================================================
window.loadTutorialScenarioList = async function() {
  const area = document.getElementById('tutorial-scenario-list');
  if (!area) return;
  area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">読み込み中...</p>';

  try {
    const scenarios = await gasGet('getTutorialScenarios');
    if (scenarios && scenarios.error) {
      area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${scenarios.error}</p>`;
      return;
    }
    if (!scenarios || !scenarios.length) {
      area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">チュートリアルシナリオが登録されていません</p>';
      return;
    }

    // 詳細表示用にシナリオをキャッシュ
    _scenariosCache = scenarios;
    // デッキ名解決用にデッキキャッシュも用意（未取得なら取得）
    if (!_tutorialDecksCache.length) {
      try {
        const decks = await gasGet('getTutorialDecks');
        if (Array.isArray(decks)) _tutorialDecksCache = decks;
      } catch (e) {}
    }

    area.innerHTML = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
      <th style="width:40px;">順</th>
      <th>チュートリアル名</th>
      <th style="width:90px;">難易度</th>
      <th style="width:90px;">モード</th>
      <th style="width:150px;">クリア条件</th>
      <th style="width:170px;">操作</th>
    </tr></thead><tbody>${scenarios.map(s => {
      const condLabel = _conditionLabel(s.clearCondition);
      const esc = JSON.stringify(s).replace(/'/g, "\\'");
      return `<tr>
        <td style="color:#888; text-align:center;">${s.order || ''}</td>
        <td style="color:#fff; font-weight:bold;">${_escHtml(s.tutorialName || '')}</td>
        <td>${s.difficulty || '---'}</td>
        <td style="font-size:11px;">${_modeLabel(s.mode)}</td>
        <td style="font-size:11px; color:#aaa;">${_escHtml(condLabel)}</td>
        <td>
          <button class="admin-btn-sm" style="padding:4px 8px; font-size:10px;" onclick="showTutorialScenarioDetail('${s.id}')">詳細</button>
          <button class="admin-btn-sm" style="padding:4px 8px; font-size:10px;" onclick='editTutorialScenario(${esc})'>編集</button>
          <button class="admin-btn-danger" style="padding:4px 8px; font-size:10px;" onclick="deleteTutorialScenarioConfirm('${s.id}', '${_escJs(s.tutorialName || '')}')">削除</button>
        </td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  } catch (e) {
    area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${e.message}</p>`;
  }
};

function _conditionLabel(cond) {
  if (!cond || !cond.type) return '---';
  const found = CONDITION_TYPES.find(t => t.value === cond.type);
  let label = found ? found.label : cond.type;
  if (cond.params && cond.params.cardNo) {
    const name = _findCardName(cond.params.cardNo);
    label += ' (' + name + '/' + cond.params.cardNo + ')';
  }
  return label;
}

function _modeLabel(mode) {
  if (mode === 'strict') return '強制操作';
  if (mode === 'free') return '自由操作';
  return mode || '---';
}

function _deckNameById(deckId) {
  if (!deckId) return '未指定';
  const d = _tutorialDecksCache.find(x => (x.deckId || x.tutorialName) === deckId);
  if (!d) return deckId;
  return (d.tutorialName || '') + ' / ' + (d.deckName || '');
}

function _scenarioNameById(scenarioId) {
  if (!scenarioId) return '';
  const s = _scenariosCache.find(x => x.id === scenarioId);
  return s ? s.tutorialName : scenarioId;
}

// ===================================================================
// シナリオ詳細プレビューモーダル
// ===================================================================
window.showTutorialScenarioDetail = async function(scenarioId) {
  const scenario = _scenariosCache.find(s => s.id === scenarioId);
  if (!scenario) { alert('シナリオが見つかりません'); return; }

  // カードデータがあると配置表示が名前付きになる
  try {
    if (!window.allCards || !window.allCards.length) {
      await loadCardAndKeywordData();
    }
  } catch (e) {}

  document.getElementById('ts-detail-title').innerText = scenario.tutorialName || 'シナリオ詳細';
  document.getElementById('ts-detail-body').innerHTML = _renderScenarioDetail(scenario);
  document.getElementById('ts-detail-modal').style.display = 'block';
};

window.closeTutorialScenarioDetail = function() {
  document.getElementById('ts-detail-modal').style.display = 'none';
};

function _renderScenarioDetail(s) {
  const ib = s.initialBoard || {};
  const section = (title, body) =>
    `<div style="margin-bottom:14px;">
      <div style="color:var(--main-cyan); font-size:11px; font-weight:bold; margin-bottom:4px; border-bottom:1px solid #1a3030; padding-bottom:3px;">${title}</div>
      <div style="padding-left:8px;">${body}</div>
    </div>`;

  const kv = (label, value) =>
    `<div><span style="color:#888;">${label}:</span> <span style="color:#fff;">${value || '---'}</span></div>`;

  // 基本情報
  const basic =
    kv('難易度', _escHtml(s.difficulty || '')) +
    kv('モード', _modeLabel(s.mode)) +
    kv('表示順', s.order || '---') +
    kv('使用デッキ', _escHtml(_deckNameById(s.deckId))) +
    kv('前提シナリオ', _escHtml(_scenarioNameById(s.prerequisiteId)) || '（なし・最初から解放）') +
    kv('説明', _escHtml(s.description || ''));

  // クリア条件
  const clear = `<span style="color:#00ff88;">${_escHtml(_conditionLabel(s.clearCondition))}</span>`;

  // 初期盤面
  const boardItems = [];
  boardItems.push(`<div>先攻: ${ib.playerFirst === false ? '相手' : 'プレイヤー'}</div>`);
  boardItems.push(`<div>開始メモリー: ${ib.playerMemory ?? 0}</div>`);
  boardItems.push(`<div>セキュリティ: 自分 ${ib.playerSecurityCount ?? 5} / 相手 ${ib.opponentSecurityCount ?? 5}</div>`);
  const areaLine = (label, arr) => {
    if (!Array.isArray(arr) || !arr.length) return '';
    const names = arr.map(c => {
      const no = typeof c === 'string' ? c : (c && c.cardNo);
      return no ? _findCardName(no) + '(' + no + ')' : '';
    }).filter(Boolean).join(', ');
    return `<div>${label}: <span style="color:#fff;">${_escHtml(names)}</span></div>`;
  };
  const oneLine = (label, one) => {
    if (!one) return '';
    const no = typeof one === 'string' ? one : one.cardNo;
    if (!no) return '';
    return `<div>${label}: <span style="color:#fff;">${_escHtml(_findCardName(no) + '(' + no + ')')}</span></div>`;
  };
  boardItems.push(areaLine('自分 手札', ib.playerHand));
  boardItems.push(areaLine('自分 バトルエリア', ib.playerBattleArea));
  boardItems.push(oneLine('自分 育成エリア', ib.playerRaisingArea));
  boardItems.push(areaLine('相手 手札', ib.opponentHand));
  boardItems.push(areaLine('相手 バトルエリア', ib.opponentBattleArea));
  boardItems.push(oneLine('相手 育成エリア', ib.opponentRaisingArea));
  const board = boardItems.filter(Boolean).join('');

  // フロー
  const flowBlocks = Array.isArray(s.flow) && s.flow.length
    ? s.flow.map(block => {
        const isTrigger = block.phase === '_trigger';
        const pDef = PHASE_DEFS.find(p => p.value === block.phase);
        const tDef = TRIGGER_TYPES.find(t => t.value === block.trigger);
        const bLabel = isTrigger
          ? `⚡ ${tDef ? tDef.label : block.trigger}`
          : (pDef ? pDef.label : block.phase);
        const color = isTrigger ? '#ffaa00' : (pDef ? pDef.color : '#888');
        const stepsHtml = (block.steps || []).map((step, i) => {
          const condText = _conditionLabel(step.advanceCondition);
          const typeLabel = step.stepType === 'spotlight' ? '🔦' : step.stepType === 'message' ? '💬' : '👆';
          return `<div style="margin-bottom:4px; padding-left:16px;">
            <span style="color:#aaa;">${typeLabel} STEP ${i + 1}:</span>
            「${_escHtml(step.instructionText || '')}」
            ${step.stepType === 'action' ? `<div style="color:#888; font-size:10px; padding-left:16px;">→ 進行条件: ${_escHtml(condText)}</div>` : ''}
          </div>`;
        }).join('');
        return `<div style="margin-bottom:8px;">
          <span style="color:${color}; font-weight:bold;">${bLabel}</span>
          <span style="color:#666; font-size:10px;"> (T${block.turn || 1})</span>
          ${stepsHtml || '<div style="padding-left:16px; color:#666;">ステップなし</div>'}
        </div>`;
      }).join('')
    : '<span style="color:#666;">フロー未設定</span>';

  // クリア後メッセージ
  const clearMsg = s.clearMessage
    ? `<div style="color:#00ff88;">${_escHtml(s.clearMessage)}</div>`
    : '<span style="color:#666;">なし</span>';

  // 相手AIスクリプト
  const oppScript = Array.isArray(s.opponentScript) && s.opponentScript.length
    ? s.opponentScript.map(t => {
        const acts = (t.actions || []).map((a, i) => {
          const def = OPPONENT_ACTION_TYPES.find(x => x.value === a.type);
          let line = (def ? def.label : a.type);
          const extras = [];
          if (a.cardNo) extras.push(_findCardName(a.cardNo));
          if (a.sourceCardNo) extras.push('元:' + _findCardName(a.sourceCardNo));
          if (a.targetCardNo) extras.push('先:' + _findCardName(a.targetCardNo));
          if (extras.length) line += ' (' + extras.join(', ') + ')';
          return `<div style="padding-left:16px; color:#ccc;">${i + 1}. ${_escHtml(line)}</div>`;
        }).join('');
        return `<div style="margin-bottom:8px;">
          <span style="color:#ff00fb; font-weight:bold;">ターン ${t.turn}</span>
          ${acts || '<div style="padding-left:16px; color:#666;">（アクションなし）</div>'}
        </div>`;
      }).join('')
    : '<span style="color:#666;">スクリプトなし</span>';

  return (
    section('📌 基本情報', basic) +
    section('🎯 クリア条件', clear) +
    section('📝 クリア後メッセージ', clearMsg) +
    section('🎲 初期盤面', board) +
    section('🎬 フロー', flowBlocks) +
    section('🤖 相手AIスクリプト', oppScript)
  );
}

function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escJs(s) {
  return String(s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ===================================================================
// シナリオ削除
// ===================================================================
window.deleteTutorialScenarioConfirm = async function(scenarioId, name) {
  if (!confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)) return;
  try {
    const result = await gasPost('deleteTutorialScenario', { scenarioId });
    if (result.status === 'SUCCESS') {
      alert('削除しました');
      loadTutorialScenarioList();
    } else {
      alert('エラー: ' + (result.message || result.status));
    }
  } catch (e) {
    alert('通信エラー: ' + e.message);
  }
};

// ===================================================================
// 新規作成・編集開始
// ===================================================================
window.initTutorialScenarioBuilder = async function() {
  _scenarioEditData = null;
  _scenarioFlow = [];
  await _prepareEditForm();
  document.getElementById('ts-edit-title').innerText = 'チュートリアルシナリオ登録';
  showScreen('tutorial-scenario-edit-screen');
};

window.editTutorialScenario = async function(scenario) {
  _scenarioEditData = scenario;
  // フロー復元（ディープコピー）
  _scenarioFlow = Array.isArray(scenario.flow)
    ? scenario.flow.map(block => ({
        phase: block.phase,
        turn: block.turn || 1,
        trigger: block.trigger || undefined,
        steps: Array.isArray(block.steps) ? block.steps.map(s => Object.assign({}, s, {
          advanceCondition: s.advanceCondition ? Object.assign({}, s.advanceCondition, {
            params: s.advanceCondition.params ? Object.assign({}, s.advanceCondition.params) : undefined,
          }) : { type: 'hatch' },
        })) : [],
      }))
    : [];
  await _prepareEditForm();

  // 値を入れる
  document.getElementById('ts-tutorial-name').value = scenario.tutorialName || '';
  document.getElementById('ts-description').value = scenario.description || '';
  document.getElementById('ts-difficulty').value = scenario.difficulty || '⭐';
  document.getElementById('ts-order').value = scenario.order || 1;
  document.getElementById('ts-prerequisite').value = scenario.prerequisiteId || '';
  document.getElementById('ts-mode').value = scenario.mode || 'strict';
  const phaseGuideEditCheck = document.getElementById('ts-show-phase-guide');
  if (phaseGuideEditCheck) phaseGuideEditCheck.checked = !!scenario.showPhaseGuide;
  // フェーズ説明テキスト復元
  const pgt = scenario.phaseGuideTexts || {};
  _setPhaseGuideTexts(pgt);
  togglePhaseGuideTexts();
  document.getElementById('ts-deck-id').value = scenario.deckId || '';
  // クリア後メッセージ復元
  document.getElementById('ts-clear-message').value = scenario.clearMessage || '';

  // クリア条件
  const cc = scenario.clearCondition || null;
  if (cc) {
    document.getElementById('ts-clear-type').value = cc.type || '';
    if (cc.params && cc.params.cardNo) document.getElementById('ts-clear-param').value = cc.params.cardNo;
    updateClearConditionUI();
  }

  // 初期盤面
  const ib = scenario.initialBoard || {};
  document.getElementById('ts-player-first').value = ib.playerFirst === false ? 'false' : 'true';
  document.getElementById('ts-player-memory').value = ib.playerMemory ?? 0;
  document.getElementById('ts-player-sec').value = ib.playerSecurityCount ?? 5;
  document.getElementById('ts-opponent-sec').value = ib.opponentSecurityCount ?? 5;

  // 配置済みカードを復元（CardRef配列を {cardNo} 形式に統一）
  const normArr = (arr) => (Array.isArray(arr) ? arr : []).map(c => {
    if (typeof c === 'string') return { cardNo: c };
    return Object.assign({}, c);
  });
  const normOne = (c) => {
    if (!c) return null;
    if (typeof c === 'string') return { cardNo: c };
    return Object.assign({}, c);
  };
  _initialBoardState = {
    playerHand: normArr(ib.playerHand),
    playerBattleArea: normArr(ib.playerBattleArea),
    playerRaisingArea: normOne(ib.playerRaisingArea),
    opponentHand: normArr(ib.opponentHand),
    opponentBattleArea: normArr(ib.opponentBattleArea),
    opponentRaisingArea: normOne(ib.opponentRaisingArea),
  };
  _renderPlacedCards();

  // 相手AIスクリプト復元（ディープコピー）
  _opponentScript = Array.isArray(scenario.opponentScript)
    ? scenario.opponentScript.map(t => ({
        turn: Number(t.turn || 0),
        actions: Array.isArray(t.actions) ? t.actions.map(a => Object.assign({}, a)) : [],
      }))
    : [];
  _renderOpponentScript();

  _renderFlowSummary();
  document.getElementById('ts-edit-title').innerText = 'チュートリアルシナリオ編集';
  showScreen('tutorial-scenario-edit-screen');
};

async function _prepareEditForm() {
  // クリア条件プルダウンを構築
  const clearSel = document.getElementById('ts-clear-type');
  if (clearSel && !clearSel.dataset.built) {
    clearSel.innerHTML = CONDITION_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    clearSel.dataset.built = '1';
  }
  document.getElementById('ts-clear-param').value = '';

  // フォームリセット
  document.getElementById('ts-tutorial-name').value = '';
  document.getElementById('ts-description').value = '';
  document.getElementById('ts-difficulty').value = '⭐';
  document.getElementById('ts-order').value = 1;
  document.getElementById('ts-mode').value = 'strict';
  const phaseGuideCheck = document.getElementById('ts-show-phase-guide');
  if (phaseGuideCheck) phaseGuideCheck.checked = false;
  _resetPhaseGuideTexts();
  togglePhaseGuideTexts();
  document.getElementById('ts-player-first').value = 'true';
  document.getElementById('ts-player-memory').value = 0;
  document.getElementById('ts-player-sec').value = 5;
  document.getElementById('ts-opponent-sec').value = 5;

  // 相手AIスクリプトリセット
  _opponentScript = [];

  // 初期盤面リセット + 検索欄クリア
  _initialBoardState = _emptyBoardState();
  const searchInput = document.getElementById('ts-card-search');
  if (searchInput) searchInput.value = '';
  const searchResults = document.getElementById('ts-card-search-results');
  if (searchResults) searchResults.innerHTML = '';

  // カードデータをロード（管理画面では初回読み込みが必要）
  try {
    if (!window.allCards || window.allCards.length === 0) {
      await loadCardAndKeywordData();
    }
  } catch (e) { console.error('[admin-scenario] card load failed:', e); }

  // デッキプルダウン + 前提シナリオプルダウン
  await Promise.all([_loadDeckOptions(), _loadPrerequisiteOptions()]);

  // 前提シナリオ初期値リセット
  const preSel = document.getElementById('ts-prerequisite');
  if (preSel) preSel.value = '';

  // クリア後メッセージリセット
  const clearMsgEl = document.getElementById('ts-clear-message');
  if (clearMsgEl) clearMsgEl.value = '';

  // フロー + 配置済みカード + 相手AIスクリプト表示初期化
  _renderFlowSummary();
  _renderPlacedCards();
  _renderOpponentScript();
  updateClearConditionUI();
}

async function _loadPrerequisiteOptions() {
  const sel = document.getElementById('ts-prerequisite');
  if (!sel) return;
  try {
    const list = await gasGet('getTutorialScenarios');
    _scenariosCache = Array.isArray(list) ? list : [];
    // 編集中シナリオ自身は除外
    const currentId = _scenarioEditData ? _scenarioEditData.id : null;
    const opts = ['<option value="">（なし・最初から解放）</option>'];
    _scenariosCache.forEach(s => {
      if (currentId && s.id === currentId) return;
      const label = (s.tutorialName || '(無題)');
      opts.push(`<option value="${_escHtml(s.id)}">${_escHtml(label)}</option>`);
    });
    sel.innerHTML = opts.join('');
  } catch (e) {
    sel.innerHTML = '<option value="">（読込失敗）</option>';
  }
}

async function _loadDeckOptions() {
  const sel = document.getElementById('ts-deck-id');
  if (!sel) return;
  try {
    const decks = await gasGet('getTutorialDecks');
    _tutorialDecksCache = Array.isArray(decks) ? decks : [];
    const opts = ['<option value="">（デッキを選択）</option>'];
    _tutorialDecksCache.forEach(d => {
      const id = d.deckId || d.tutorialName || '';
      const label = (d.tutorialName || '(無題)') + ' / ' + (d.deckName || '');
      opts.push(`<option value="${_escHtml(id)}">${_escHtml(label)}</option>`);
    });
    sel.innerHTML = opts.join('');
  } catch (e) {
    sel.innerHTML = '<option value="">読込失敗</option>';
  }
}

// ===================================================================
// クリア条件のUI切替（パラメータ欄の表示制御）
// ===================================================================
window.updateClearConditionUI = function() {
  const type = document.getElementById('ts-clear-type').value;
  const def = CONDITION_TYPES.find(t => t.value === type);
  const wrap = document.getElementById('ts-clear-param-wrap');
  if (def && def.needsCardNo) wrap.style.display = '';
  else wrap.style.display = 'none';
};

// ===================================================================
// フロー編集（トグル式フェーズ一覧）
// ===================================================================

// 全フェーズ＋割り込みの定義（表示順）
// 9大項目（ユーザー指定順）+ 各大項目の配下に入る割り込みサブ項目
// parentPhase: この項目をどの大項目の配下に表示するか
const ALL_FLOW_SLOTS = [
  // === 1. マリガン ===
  { key: 'mulligan',  phase: 'mulligan',  label: '🎴 マリガン画面',        color: '#ff88ff',
    hint: '手札の引き直し画面。引き直しボタンやゲーム開始ボタンの制御を設定。' },

  // === 2. 自分のターン開始 ===
  { key: 'trg_turn_start_self', phase: '_trigger', trigger: 'turn_start_self',
    label: '▶ 自分のターン開始',  color: '#ffbb44',
    hint: 'ターン開始アニメーションの直後、アクティブフェイズ進入前。' },

  // === 3. アクティブフェイズ ===
  { key: 'unsuspend', phase: 'unsuspend', label: '🔄 アクティブフェイズ',  color: '#88ccff',
    hint: 'レスト状態のカードを縦に戻す自動フェイズ。説明を挟みたい時にON。' },

  // === 4. ドローフェイズ ===
  { key: 'draw',      phase: 'draw',      label: '🃏 ドローフェイズ',      color: '#88ffcc',
    hint: 'デッキから1枚ドローする自動フェイズ。説明を挟みたい時にON。' },

  // === 5. 育成フェイズ ===
  { key: 'breed',     phase: 'breed',     label: '🥚 育成フェイズ',        color: '#ffcc44',
    hint: '孵化・育成エリアからの移動など。操作誘導や説明を設定。' },
  { key: 'trg_after_hatch', phase: '_trigger', trigger: 'after_hatch', parentPhase: 'breed',
    label: '  ⚡ 孵化完了直後', color: '#ffcc44',
    hint: '孵化演出の直後。孵化についての説明を挟む。' },

  // === 6. メインフェイズ ===
  { key: 'main',      phase: 'main',      label: '⚔️ メインフェイズ',      color: '#ff6666',
    hint: 'プレイ・進化・アタック・効果などの操作誘導や説明を設定。' },
  { key: 'trg_after_play_cost',  phase: '_trigger', trigger: 'after_play_cost',  parentPhase: 'main',
    label: '  ⚡ 登場コスト支払い直後（効果前）', color: '#ff9966',
    hint: 'メモリー消費した直後、登場時効果発動前。' },
  { key: 'trg_after_play',       phase: '_trigger', trigger: 'after_play',       parentPhase: 'main',
    label: '  ⚡ 登場時効果完了後', color: '#ff9966',
    hint: '登場時効果の処理が全て完了した後。' },
  { key: 'trg_after_evolve_cost', phase: '_trigger', trigger: 'after_evolve_cost', parentPhase: 'main',
    label: '  ⚡ 進化コスト+ドロー直後（効果前）', color: '#ff9966',
    hint: 'メモリー消費+進化ドロー完了後、進化時効果発動前。' },
  { key: 'trg_after_evolve',      phase: '_trigger', trigger: 'after_evolve',      parentPhase: 'main',
    label: '  ⚡ 進化時効果完了後', color: '#ff9966',
    hint: '進化時効果の処理が全て完了した後。' },
  { key: 'trg_after_attack',      phase: '_trigger', trigger: 'after_attack',      parentPhase: 'main',
    label: '  ⚡ アタック解決後', color: '#ff9966',
    hint: 'アタックが解決した直後。' },
  { key: 'trg_after_use_effect',  phase: '_trigger', trigger: 'after_use_effect',  parentPhase: 'main',
    label: '  ⚡ 効果使用完了後', color: '#ff9966',
    hint: 'メイン効果の処理が完了した後。' },
  { key: 'trg_on_card_detail_open', phase: '_trigger', trigger: 'on_card_detail_open', parentPhase: 'main',
    label: '  ⚡ カード詳細表示中', color: '#ff9966',
    hint: 'カード詳細モーダルが開いた瞬間（閉じるまで説明を表示）。' },

  // === 7. 自分のターン終了 ===
  { key: 'trg_before_end_turn', phase: '_trigger', trigger: 'before_end_turn',
    label: '🏁 自分のターン終了', color: '#ffaa00',
    hint: 'ターン終了アニメーションの前。手動終了/メモリー相手側での自動終了どちらでも発火。' },
  { key: 'trg_memory_crossed', phase: '_trigger', trigger: 'memory_crossed', parentPhase: 'trg_before_end_turn',
    label: '  ⚡ メモリー相手側到達時', color: '#ffaa00',
    hint: 'メモリーが相手側に振れた瞬間（自動ターン終了時のみ）。' },

  // === 8. 相手ターン開始 ===
  { key: 'trg_before_opponent_turn', phase: '_trigger', trigger: 'before_opponent_turn',
    label: '⏸ 相手ターン開始', color: '#aa88ff',
    hint: '相手ターン開始アニメーションの前。' },

  // === 9. 相手ターン終了 ===
  { key: 'trg_turn_end_opp', phase: '_trigger', trigger: 'turn_end_opp',
    label: '⏭ 相手ターン終了', color: '#8899ff',
    hint: '相手ターン終了後、自分のターン開始前。' },
];

let _flowEditTurn = 1;  // 現在編集中のターン番号
let _flowMaxTurn = 1;   // 最大ターン番号

function _conditionNeedsCard(type) {
  const def = CONDITION_TYPES.find(t => t.value === type);
  return !!(def && def.needsCardNo);
}

// フロー設定画面を開く
window.openFlowEditor = function() {
  // 最大ターン番号を算出
  _flowMaxTurn = Math.max(1, ...(_scenarioFlow.map(b => b.turn || 1)));
  _flowEditTurn = 1;
  showScreen('tutorial-flow-edit-screen');
  _renderTurnTabs();
  _renderFlowEditor();
};

// フロー設定画面から戻る
window.closeFlowEditor = function() {
  // ONだけどステップが0のブロックを除去（ク���ーンアップ）
  // → 残す。ONの意図がある可能性があるので、ステップ空でも残す
  showScreen('tutorial-scenario-edit-screen');
  _renderFlowSummary();
};

// ターンタブ
window.flowAddTurnTab = function() {
  _flowMaxTurn++;
  _flowEditTurn = _flowMaxTurn;
  _renderTurnTabs();
  _renderFlowEditor();
};

window.flowSelectTurn = function(turn) {
  _flowEditTurn = turn;
  _renderTurnTabs();
  _renderFlowEditor();
};

function _renderTurnTabs() {
  const wrap = document.getElementById('flow-turn-tabs');
  if (!wrap) return;
  let html = '';
  for (let t = 1; t <= _flowMaxTurn; t++) {
    // このターンにブロックがあるか
    const hasBlocks = _scenarioFlow.some(b => (b.turn || 1) === t);
    const isActive = t === _flowEditTurn;
    const bg = isActive ? 'var(--main-cyan)' : (hasBlocks ? '#1a3030' : '#111');
    const color = isActive ? '#000' : (hasBlocks ? 'var(--main-cyan)' : '#555');
    const border = hasBlocks ? 'var(--main-cyan)' : '#333';
    html += `<button onclick="flowSelectTurn(${t})" style="padding:4px 12px; font-size:11px; font-weight:bold; border-radius:4px; border:1px solid ${border}; background:${bg}; color:${color}; cursor:pointer;">T${t}</button>`;
  }
  wrap.innerHTML = html;
}

// スロッ���のON/OFF切替
window.flowToggleSlot = function(slotKey) {
  const slot = ALL_FLOW_SLOTS.find(s => s.key === slotKey);
  if (!slot) return;
  const blockIdx = _findBlockIndex(slot);
  if (blockIdx >= 0) {
    // OFF: ブロックを削除
    _scenarioFlow.splice(blockIdx, 1);
  } else {
    // ON: ブロックを追加
    const newBlock = { phase: slot.phase, turn: _flowEditTurn, steps: [] };
    if (slot.trigger) newBlock.trigger = slot.trigger;
    _scenarioFlow.push(newBlock);
  }
  _renderTurnTabs();
  _renderFlowEditor();
};

// 該当ターン＋スロットのブロックインデックスを探す
function _findBlockIndex(slot) {
  return _scenarioFlow.findIndex(b => {
    if ((b.turn || 1) !== _flowEditTurn) return false;
    if (slot.trigger) return b.phase === '_trigger' && b.trigger === slot.trigger;
    return b.phase === slot.phase && b.phase !== '_trigger';
  });
}

// ステップ追加
window.flowAddStep = function(slotKey) {
  const block = _getOrCreateBlock(slotKey);
  if (!block) return;
  block.steps.push({
    stepType: 'action', instructionText: '', advanceCondition: { type: 'hatch' },
    targetArea: '', secondTargetArea: '', operationType: '',
  });
  _renderFlowEditor();
};

function _getOrCreateBlock(slotKey) {
  const slot = ALL_FLOW_SLOTS.find(s => s.key === slotKey);
  if (!slot) return null;
  const idx = _findBlockIndex(slot);
  return idx >= 0 ? _scenarioFlow[idx] : null;
}

// ステップ削除
window.flowRemoveStep = function(slotKey, stepIdx) {
  const block = _getOrCreateBlock(slotKey);
  if (!block) return;
  block.steps.splice(stepIdx, 1);
  _renderFlowEditor();
};

// ステップ移動
window.flowMoveStep = function(slotKey, stepIdx, delta) {
  const block = _getOrCreateBlock(slotKey);
  if (!block || !block.steps) return;
  const to = stepIdx + delta;
  if (to < 0 || to >= block.steps.length) return;
  [block.steps[stepIdx], block.steps[to]] = [block.steps[to], block.steps[stepIdx]];
  _renderFlowEditor();
};

// ステップフィールド更新
window.flowUpdateStep = function(slotKey, stepIdx, field, value) {
  const block = _getOrCreateBlock(slotKey);
  if (!block) return;
  const step = block.steps[stepIdx];
  if (!step) return;
  if (field === 'instructionText') {
    step.instructionText = value;
  } else if (field === 'conditionType') {
    step.advanceCondition = { type: value };
    if (_conditionNeedsCard(value)) step.advanceCondition.params = { cardNo: '' };
    _renderFlowEditor();
  } else if (field === 'conditionCardNo') {
    if (!step.advanceCondition.params) step.advanceCondition.params = {};
    step.advanceCondition.params.cardNo = value;
  } else if (field === 'targetArea') {
    step.targetArea = value || '';
  } else if (field === 'secondTargetArea') {
    step.secondTargetArea = value || '';
  } else if (field === 'operationType') {
    step.operationType = value || '';
  } else if (field === 'stepType') {
    step.stepType = value || 'action';
    _renderFlowEditor();
  } else if (field === 'targetCardNo') {
    step.targetCardNo = value || '';
  } else if (field === 'secondTargetCardNo') {
    step.secondTargetCardNo = value || '';
  } else if (field === 'uiControl') {
    step.uiControl = !!value;
    _renderFlowEditor();
  } else if (field.startsWith('greyOut_')) {
    const key = field.replace('greyOut_', '');
    if (!Array.isArray(step.greyOut)) step.greyOut = [];
    if (value) { if (!step.greyOut.includes(key)) step.greyOut.push(key); }
    else { step.greyOut = step.greyOut.filter(g => g !== key); }
  } else if (field.startsWith('hlBtn_')) {
    const key = field.replace('hlBtn_', '');
    if (!Array.isArray(step.highlightButtons)) step.highlightButtons = [];
    if (value) { if (!step.highlightButtons.includes(key)) step.highlightButtons.push(key); }
    else { step.highlightButtons = step.highlightButtons.filter(b => b !== key); }
  }
};

// --- メインレンダリング（親子構造対応） ---
function _renderFlowEditor() {
  const container = document.getElementById('flow-phases-container');
  if (!container) return;

  // 親項目 + その子項目を再帰的にレンダリング
  const topLevelSlots = ALL_FLOW_SLOTS.filter(s => !s.parentPhase);
  container.innerHTML = topLevelSlots.map(slot => _renderSlotBlock(slot, 0)).join('');
}

// スロット1つのHTML生成（indent: インデント段数）
function _renderSlotBlock(slot, indent) {
  const blockIdx = _findBlockIndex(slot);
  const isOn = blockIdx >= 0;
  const block = isOn ? _scenarioFlow[blockIdx] : null;
  const stepCount = block ? (block.steps || []).length : 0;

  const headerBg = isOn ? `${slot.color}22` : '#0a0a0a';
  const headerBorder = isOn ? slot.color : '#222';
  const toggleChecked = isOn ? 'checked' : '';
  const badge = isOn && stepCount > 0
    ? `<span style="background:${slot.color}44; color:${slot.color}; font-size:9px; padding:1px 6px; border-radius:3px; margin-left:6px;">${stepCount}ステップ</span>`
    : '';

  const marginLeft = indent > 0 ? `margin-left:${indent * 20}px;` : '';

  let html = `
    <div style="border:1px solid ${headerBorder}; border-radius:8px; margin-bottom:6px; overflow:hidden; transition:border-color 0.2s; ${marginLeft}">
      <div style="background:${headerBg}; padding:8px 12px; display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="flowToggleSlot('${slot.key}')">
        <input type="checkbox" ${toggleChecked} style="accent-color:${slot.color}; pointer-events:none; width:16px; height:16px;">
        <div style="flex:1;">
          <span style="color:${isOn ? slot.color : '#666'}; font-weight:bold; font-size:12px;">${slot.label}</span>${badge}
          <div style="color:#666; font-size:10px; margin-top:1px;">${slot.hint}</div>
        </div>
      </div>`;

  if (isOn) {
    const stepsHtml = (block.steps || []).map((step, sIdx) =>
      _renderFlowStep(slot.key, sIdx, step)
    ).join('');
    html += `
      <div style="padding:10px 12px; border-top:1px solid ${slot.color}33;">
        ${stepsHtml || '<p style="color:#555; font-size:10px; margin:0 0 6px;">ステップが未登録です。下のボタンから追加してください。</p>'}
        <button class="admin-btn-sm" onclick="event.stopPropagation(); flowAddStep('${slot.key}')" style="width:100%; margin-top:4px; font-size:10px;">＋ ステップを追加</button>
      </div>`;
  }

  html += '</div>';

  // 子項目を追加（parentPhase がこの slot.key のもの）
  const children = ALL_FLOW_SLOTS.filter(s => s.parentPhase === slot.key);
  children.forEach(child => {
    html += _renderSlotBlock(child, indent + 1);
  });

  return html;
}

// 個別ステップの描画
function _renderFlowStep(slotKey, sIdx, step) {
  const sType = step.stepType || 'action';
  const isAction = sType === 'action';
  const isSpotlight = sType === 'spotlight';
  const cond = step.advanceCondition || { type: 'hatch' };
  const needsCard = _conditionNeedsCard(cond.type);
  const cardNo = (cond.params && cond.params.cardNo) || '';

  const sk = `'${slotKey}'`;
  const stepTypeOpts = STEP_TYPES.map(s =>
    `<option value="${s.value}"${s.value === sType ? ' selected' : ''}>${s.label}</option>`
  ).join('');
  const condOpts = CONDITION_TYPES.map(t =>
    `<option value="${t.value}"${t.value === cond.type ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  const areaOpts = TARGET_AREAS.map(a =>
    `<option value="${a.value}"${a.value === (step.targetArea || '') ? ' selected' : ''}>${a.label}</option>`
  ).join('');
  const areaOpts2 = TARGET_AREAS.map(a =>
    `<option value="${a.value}"${a.value === (step.secondTargetArea || '') ? ' selected' : ''}>${a.label}</option>`
  ).join('');
  const opOpts = OPERATION_TYPES.map(o =>
    `<option value="${o.value}"${o.value === (step.operationType || '') ? ' selected' : ''}>${o.label}</option>`
  ).join('');

  const borderColor = isAction ? '#333' : isSpotlight ? '#ffaa0066' : '#00fbff66';

  return `
    <div style="background:#0a0a0a; border:1px solid ${borderColor}; border-radius:6px; padding:10px; margin-bottom:6px;" onclick="event.stopPropagation()">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="color:#aaa; font-size:10px; font-weight:bold;">STEP ${sIdx + 1}</span>
        <div>
          <button class="admin-btn-sm" style="padding:2px 6px; font-size:9px;" onclick="flowMoveStep(${sk},${sIdx},-1)">↑</button>
          <button class="admin-btn-sm" style="padding:2px 6px; font-size:9px;" onclick="flowMoveStep(${sk},${sIdx},1)">↓</button>
          <button class="admin-btn-danger" style="padding:2px 6px; font-size:9px;" onclick="flowRemoveStep(${sk},${sIdx})">×</button>
        </div>
      </div>
      <div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">ステップタイプ</label>
        <select onchange="flowUpdateStep(${sk},${sIdx},'stepType',this.value)">${stepTypeOpts}</select>
      </div>
      <div class="tsave-field" style="margin-bottom:6px;">
        <label style="font-size:10px;">${isAction ? '指示テキスト' : '説明テキスト'} <span style="color:#888;">※ {{pc:XX|sp:YY}} でデバイス切替可</span></label>
        <textarea rows="${isAction ? 1 : 3}" oninput="flowUpdateStep(${sk},${sIdx},'instructionText',this.value)"
          placeholder="${isAction ? '例: 育成エリアをタップして孵化しよう!' : '例: セキュリティは5枚あるよ。相手のセキュリティを0にして...'}"
          style="resize:vertical;">${_escHtml(step.instructionText || '')}</textarea>
      </div>
      ${isAction ? `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
        <div class="tsave-field" style="margin-bottom:0;"><label style="font-size:10px;">次に進む条件</label>
          <select onchange="flowUpdateStep(${sk},${sIdx},'conditionType',this.value)">${condOpts}</select>
        </div>
        <div class="tsave-field" style="margin-bottom:0;"><label style="font-size:10px;">操作タイプ</label>
          <select onchange="flowUpdateStep(${sk},${sIdx},'operationType',this.value)">${opOpts}</select>
        </div>
      </div>` : ''}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
        <div class="tsave-field" style="margin-bottom:0;">
          <label style="font-size:10px;">${isSpotlight ? 'スポットライト対象' : '赤枠ハイライト1'}</label>
          <select onchange="flowUpdateStep(${sk},${sIdx},'targetArea',this.value)" style="margin-bottom:3px;">${areaOpts}</select>
          ${_renderCardPicker(slotKey, sIdx, 'targetCardNo', step.targetCardNo)}
        </div>
        <div class="tsave-field" style="margin-bottom:0;">
          <label style="font-size:10px;">赤枠ハイライト2</label>
          <select onchange="flowUpdateStep(${sk},${sIdx},'secondTargetArea',this.value)" style="margin-bottom:3px;">${areaOpts2}</select>
          ${_renderCardPicker(slotKey, sIdx, 'secondTargetCardNo', step.secondTargetCardNo)}
        </div>
      </div>
      ${isAction && needsCard ? `
      <div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">カードNo（進行条件用）</label>
        <input type="text" value="${_escHtml(cardNo)}"
          oninput="flowUpdateStep(${sk},${sIdx},'conditionCardNo',this.value)"
          placeholder="例: BT1-010">
      </div>` : ''}
      ${_renderStepUiControl(slotKey, sIdx, step)}
    </div>
  `;
}

// カード検索ピッカー（赤枠ハイライト用）
function _renderCardPicker(slotKey, sIdx, field, currentCardNo) {
  const sk = `'${slotKey}'`;
  const uid = `cp_${slotKey}_${sIdx}_${field}`;
  if (currentCardNo) {
    const name = _findCardName(currentCardNo);
    return `
      <div style="display:flex; align-items:center; gap:4px; margin-top:2px;">
        <span style="background:#111; border:1px solid #00ff88; border-radius:3px; padding:2px 6px; font-size:10px; color:#fff; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${_escHtml(name)} <span style="color:#888;">(${_escHtml(currentCardNo)})</span>
        </span>
        <button class="admin-btn-danger" style="padding:1px 6px; font-size:9px;" onclick="flowUpdateStep(${sk},${sIdx},'${field}',''); event.stopPropagation();">×</button>
      </div>`;
  }
  return `
    <div style="position:relative; margin-top:2px;">
      <input type="text" id="${uid}" placeholder="カード名で検索（空＝エリア全体）"
        oninput="flowCardSearch('${uid}',${sk},${sIdx},'${field}')"
        style="font-size:10px; padding:3px; width:100%;">
      <div id="${uid}_results" style="display:none; position:absolute; left:0; right:0; top:100%; z-index:100; max-height:180px; overflow-y:auto; background:#111; border:1px solid #333; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5);"></div>
    </div>`;
}

// カード検索結果を表示
window.flowCardSearch = function(uid, slotKey, sIdx, field) {
  const input = document.getElementById(uid);
  const results = document.getElementById(uid + '_results');
  if (!input || !results) return;
  const kw = (input.value || '').trim().toLowerCase();
  if (!kw || kw.length < 1) { results.style.display = 'none'; return; }
  if (!window.allCards || !window.allCards.length) {
    results.innerHTML = '<p style="color:#888; font-size:10px; padding:6px;">カードデータ読込中...</p>';
    results.style.display = 'block';
    return;
  }
  const matched = window.allCards.filter(c => {
    const name = String(c['名前'] || '').toLowerCase();
    const no   = String(c['カードNo'] || '').toLowerCase();
    return name.includes(kw) || no.includes(kw);
  }).slice(0, 20);

  if (!matched.length) {
    results.innerHTML = '<p style="color:#888; font-size:10px; padding:6px;">見つかりません</p>';
    results.style.display = 'block';
    return;
  }

  const sk = `'${slotKey}'`;
  results.innerHTML = matched.map(c => {
    const no = _escHtml(c['カードNo'] || '');
    const name = _escHtml(c['名前'] || '');
    const lv = _escHtml(c['Lv'] || c['レベル'] || '');
    return `<div onclick="flowUpdateStep(${sk},${sIdx},'${field}','${no}'); event.stopPropagation();"
      style="padding:4px 8px; cursor:pointer; font-size:10px; color:#fff; border-bottom:1px solid #1a1a1a; display:flex; align-items:center; gap:6px;"
      onmouseenter="this.style.background='#1a3030'" onmouseleave="this.style.background=''">
      <span style="color:#aaa; min-width:70px;">${no}</span>
      <span style="flex:1;">${name}</span>
      <span style="color:#666;">Lv.${lv}</span>
    </div>`;
  }).join('');
  results.style.display = 'block';
};

// ステップ内の UI制御セクション（トグル展開式）
function _renderStepUiControl(slotKey, sIdx, step) {
  const sk = `'${slotKey}'`;
  const hasUi = step.uiControl;
  const checked = hasUi ? 'checked' : '';
  const greyOut = Array.isArray(step.greyOut) ? step.greyOut : [];
  const hlButtons = Array.isArray(step.highlightButtons) ? step.highlightButtons : [];

  const GREYOUT_OPTIONS = [
    { value: 'other_cards',   label: 'ハイライト以外のカード' },
    { value: 'mulligan_redo', label: '引き直しボタン' },
    { value: 'game_start',    label: 'ゲーム開始ボタン' },
    { value: 'end_turn',      label: 'ターン終了ボタン' },
  ];

  const greyOutChecks = GREYOUT_OPTIONS.map(opt => `
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:10px; color:#aaa; margin-bottom:2px;">
      <input type="checkbox" ${greyOut.includes(opt.value) ? 'checked' : ''}
        onchange="flowUpdateStep(${sk},${sIdx},'greyOut_${opt.value}',this.checked)">
      ${opt.label}
    </label>`).join('');

  const hlBtnChecks = BUTTON_TARGETS.map(btn => `
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:10px; color:#aaa; margin-bottom:2px;">
      <input type="checkbox" ${hlButtons.includes(btn.value) ? 'checked' : ''}
        onchange="flowUpdateStep(${sk},${sIdx},'hlBtn_${btn.value}',this.checked)">
      ${btn.label}
    </label>`).join('');

  return `
    <div style="border-top:1px solid #1a1a1a; margin-top:8px; padding-top:6px;">
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:10px; color:#888; font-weight:bold;">
        <input type="checkbox" ${checked} onchange="flowUpdateStep(${sk},${sIdx},'uiControl',this.checked)">
        UI制御を設定する
      </label>
      ${hasUi ? `
      <div style="margin-top:8px; padding:8px; background:#050505; border:1px solid #1a1a1a; border-radius:4px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <div style="color:#ff6666; font-size:9px; font-weight:bold; margin-bottom:4px;">グレーアウト（無効化）</div>
            ${greyOutChecks}
          </div>
          <div>
            <div style="color:#00ff88; font-size:9px; font-weight:bold; margin-bottom:4px;">ボタンハイライト（緑発光）</div>
            ${hlBtnChecks}
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

// 編集フォームにフローサマリーを表示
function _renderFlowSummary() {
  const wrap = document.getElementById('ts-flow-summary');
  if (!wrap) return;
  if (!_scenarioFlow.length) {
    wrap.innerHTML = '<p style="color:#666; font-size:11px; text-align:center;">フロー未設定</p>';
    return;
  }
  // ターンごとにグループ化
  const turns = [...new Set(_scenarioFlow.map(b => b.turn || 1))].sort((a, b) => a - b);
  wrap.innerHTML = turns.map(t => {
    const blocks = _scenarioFlow.filter(b => (b.turn || 1) === t);
    const tags = blocks.map(block => {
      const isTrigger = block.phase === '_trigger';
      const slot = ALL_FLOW_SLOTS.find(s =>
        isTrigger ? s.trigger === block.trigger : s.phase === block.phase && !s.trigger
      );
      const label = slot ? slot.label : (block.phase || '?');
      const color = slot ? slot.color : '#888';
      const count = (block.steps || []).length;
      return `<span style="display:inline-block; background:${color}22; border:1px solid ${color}44; color:${color}; border-radius:4px; padding:2px 8px; margin:2px; font-size:10px;">
        ${label} (${count})
      </span>`;
    }).join('');
    const turnLabel = turns.length > 1 ? `<span style="color:#888; font-size:10px; margin-right:4px;">T${t}:</span>` : '';
    return `<div style="margin-bottom:2px;">${turnLabel}${tags}</div>`;
  }).join('');
}

// ===================================================================
// フェーズ説明テキストのトグル / リセット / 取得
// ===================================================================
const PHASE_KEYS = ['mulligan', 'unsuspend', 'draw', 'breed', 'main'];
const PHASE_DEFAULTS = {
  mulligan:  '最初の5枚が配られるよ。\n気に入らなければ1回だけ引き直すことが可能！',
  unsuspend: 'レスト（横向き）のカードを縦にするよ。\n縦向きになればもう一度行動可能！',
  draw:      '1枚デッキから手札にカードが引けるよ！\n1ターン目の先攻だけドロー不可\n（2ターン目から普通にドローできるよ）',
  breed:     '育成エリアのカードを操作できるよ。\nこのフェーズでは下記3行動のうち1つだけ選んで行動するよ。\n\n1. 孵化する（裏向きのカードを表向きにする）\n2. バトルエリアに移動する（レベル3以上になったら移動できるよ）\n3. 何もしない（このフェーズをスキップするよ）',
  main:      'このフェーズで相手とバトルしたり、\n進化や登場ができるよ！',
};

window.togglePhaseGuideTexts = function() {
  const check = document.getElementById('ts-show-phase-guide');
  const panel = document.getElementById('ts-phase-guide-texts');
  if (!check || !panel) return;
  panel.style.display = check.checked ? 'block' : 'none';
  // 初回チェック時にデフォルト文言をセット（空の場合のみ）
  if (check.checked) {
    PHASE_KEYS.forEach(k => {
      const el = document.getElementById('ts-pg-' + k);
      if (el && !el.value) el.value = PHASE_DEFAULTS[k] || '';
    });
  }
};

function _resetPhaseGuideTexts() {
  PHASE_KEYS.forEach(k => {
    const el = document.getElementById('ts-pg-' + k);
    if (el) el.value = '';
  });
}

function _setPhaseGuideTexts(pgt) {
  PHASE_KEYS.forEach(k => {
    const el = document.getElementById('ts-pg-' + k);
    if (el) el.value = pgt[k] || '';
  });
}

function _getPhaseGuideTexts() {
  const pgt = {};
  PHASE_KEYS.forEach(k => {
    const el = document.getElementById('ts-pg-' + k);
    if (el && el.value.trim()) pgt[k] = el.value.trim();
  });
  return pgt;
}

// ===================================================================
// カード検索 / 配置 / 配置済み表示
// ===================================================================
const AREA_LABELS = {
  playerHand:         '自分の手札',
  playerBattleArea:   '自分のバトルエリア',
  playerRaisingArea:  '自分の育成エリア',
  opponentHand:       '相手の手札',
  opponentBattleArea: '相手のバトルエリア',
  opponentRaisingArea:'相手の育成エリア',
};

window.tsFilterCardsForBoard = function() {
  const input = document.getElementById('ts-card-search');
  const results = document.getElementById('ts-card-search-results');
  if (!input || !results) return;
  const kw = (input.value || '').trim().toLowerCase();
  if (!kw) { results.innerHTML = ''; return; }
  if (!window.allCards || !window.allCards.length) {
    results.innerHTML = '<p style="color:#888; font-size:11px; text-align:center; padding:10px;">カードデータを読み込み中...</p>';
    return;
  }
  const matched = window.allCards.filter(c => {
    const name = String(c['名前'] || '').toLowerCase();
    const no   = String(c['カードNo'] || '').toLowerCase();
    return name.includes(kw) || no.includes(kw);
  }).slice(0, 30);

  if (!matched.length) {
    results.innerHTML = '<p style="color:#888; font-size:11px; text-align:center; padding:10px;">一致するカードがありません</p>';
    return;
  }

  results.innerHTML = matched.map(c => {
    const img  = getCardImageUrl(c) || '';
    const name = _escHtml(c['名前'] || '');
    const no   = _escHtml(c['カードNo'] || '');
    const lv   = _escHtml(c['Lv'] || c['レベル'] || '');
    const opts = Object.keys(AREA_LABELS).map(k => `<option value="${k}">${AREA_LABELS[k]}</option>`).join('');
    return `
      <div style="display:flex; align-items:center; padding:4px; border-bottom:1px solid #1a1a1a;">
        <img src="${img}" style="width:30px; height:42px; object-fit:cover; border-radius:2px; margin-right:8px; background:#000;" onerror="this.style.display='none'">
        <div style="flex:1; min-width:0;">
          <div style="color:#fff; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
          <div style="color:#888; font-size:10px;">${no} / Lv.${lv}</div>
        </div>
        <select onchange="tsPlaceCardFromSearch('${no}', this)" style="font-size:10px; padding:3px; max-width:130px;">
          <option value="">＋配置</option>
          ${opts}
        </select>
      </div>
    `;
  }).join('');
};

window.tsPlaceCardFromSearch = function(cardNo, selectEl) {
  const area = selectEl.value;
  if (!area || !_initialBoardState) { selectEl.value = ''; return; }
  const card = { cardNo };
  if (area === 'playerRaisingArea' || area === 'opponentRaisingArea') {
    _initialBoardState[area] = card;
  } else {
    _initialBoardState[area].push(card);
  }
  selectEl.value = '';
  _renderPlacedCards();
};

window.tsRemovePlacedCard = function(area, idx) {
  if (!_initialBoardState || !_initialBoardState[area]) return;
  _initialBoardState[area].splice(idx, 1);
  _renderPlacedCards();
};

window.tsRemovePlacedRaising = function(area) {
  if (!_initialBoardState) return;
  _initialBoardState[area] = null;
  _renderPlacedCards();
};

function _findCardName(cardNo) {
  if (!window.allCards) return cardNo;
  const c = window.allCards.find(c => String(c['カードNo']) === String(cardNo));
  return c ? (c['名前'] || cardNo) : cardNo;
}

function _placedCardChip(card, area, idx) {
  const cardNo = typeof card === 'string' ? card : (card && card.cardNo);
  if (!cardNo) return '';
  const name = _escHtml(_findCardName(cardNo));
  const removeFn = (idx === null) ? `tsRemovePlacedRaising('${area}')` : `tsRemovePlacedCard('${area}',${idx})`;
  return `<span style="display:inline-block; background:#111; border:1px solid #333; border-radius:3px; padding:2px 6px; margin:2px 2px 0 0; font-size:10px; color:#fff;">
    ${name} <span style="color:#888;">(${_escHtml(cardNo)})</span>
    <span onclick="${removeFn}" style="color:#ff4444; cursor:pointer; margin-left:4px; font-weight:bold;">×</span>
  </span>`;
}

function _renderAreaSection(title, area) {
  if (!_initialBoardState) return '';
  const val = _initialBoardState[area];
  const isRaising = area.endsWith('RaisingArea');
  let body;
  if (isRaising) {
    body = val ? _placedCardChip(val, area, null) : '<span style="color:#555; font-size:10px;">なし</span>';
  } else {
    const arr = Array.isArray(val) ? val : [];
    body = arr.length ? arr.map((c, i) => _placedCardChip(c, area, i)).join('') : '<span style="color:#555; font-size:10px;">なし</span>';
  }
  return `<div style="margin-bottom:6px;">
    <div style="color:#aaa; font-size:10px; margin-bottom:2px;">${title}</div>
    <div>${body}</div>
  </div>`;
}

function _renderPlacedCards() {
  const own = document.getElementById('ts-own-areas');
  const opp = document.getElementById('ts-opp-areas');
  if (!own || !opp) return;
  own.innerHTML =
    _renderAreaSection('手札', 'playerHand') +
    _renderAreaSection('バトルエリア', 'playerBattleArea') +
    _renderAreaSection('育成エリア', 'playerRaisingArea');
  opp.innerHTML =
    _renderAreaSection('手札', 'opponentHand') +
    _renderAreaSection('バトルエリア', 'opponentBattleArea') +
    _renderAreaSection('育成エリア', 'opponentRaisingArea');
}

// ===================================================================
// 相手AIスクリプト エディタ
// ===================================================================
window.tsAddOpponentTurn = function() {
  const nextTurn = _opponentScript.length
    ? Math.max(..._opponentScript.map(t => Number(t.turn || 0))) + 1
    : 1;
  _opponentScript.push({ turn: nextTurn, actions: [] });
  _renderOpponentScript();
};

window.tsRemoveOpponentTurn = function(idx) {
  _opponentScript.splice(idx, 1);
  _renderOpponentScript();
};

window.tsUpdateOpponentTurnNumber = function(idx, value) {
  if (!_opponentScript[idx]) return;
  _opponentScript[idx].turn = Number(value || 0);
};

window.tsAddOpponentAction = function(turnIdx) {
  if (!_opponentScript[turnIdx]) return;
  _opponentScript[turnIdx].actions.push({ type: 'hatch' });
  _renderOpponentScript();
};

window.tsRemoveOpponentAction = function(turnIdx, actionIdx) {
  if (!_opponentScript[turnIdx]) return;
  _opponentScript[turnIdx].actions.splice(actionIdx, 1);
  _renderOpponentScript();
};

window.tsUpdateOpponentActionType = function(turnIdx, actionIdx, newType) {
  if (!_opponentScript[turnIdx] || !_opponentScript[turnIdx].actions[actionIdx]) return;
  // 既存のパラメータはリセットして type だけ差し替え
  _opponentScript[turnIdx].actions[actionIdx] = { type: newType };
  _renderOpponentScript();
};

window.tsUpdateOpponentActionField = function(turnIdx, actionIdx, field, value) {
  const a = _opponentScript[turnIdx] && _opponentScript[turnIdx].actions[actionIdx];
  if (!a) return;
  a[field] = value;
};

function _renderOpponentScript() {
  const container = document.getElementById('ts-opponent-script-container');
  if (!container) return;
  if (!_opponentScript.length) {
    container.innerHTML = '<p style="color:#666; font-size:11px; text-align:center; padding:10px;">ターンが未登録です（「ターンを追加」でN手目の行動を追加）</p>';
    return;
  }
  container.innerHTML = _opponentScript.map((turnEntry, turnIdx) => {
    const actionsHtml = (turnEntry.actions || []).map((act, actIdx) => {
      return _renderOpponentActionRow(turnIdx, actIdx, act);
    }).join('');
    return `
      <div style="background:#0a0a0a; border:1px solid #333; border-radius:6px; padding:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#ff00fb; font-size:11px; font-weight:bold;">ターン</span>
            <input type="number" min="1" value="${turnEntry.turn}" style="width:50px; padding:3px; font-size:11px;" onchange="tsUpdateOpponentTurnNumber(${turnIdx}, this.value)">
          </div>
          <button class="admin-btn-danger" style="padding:2px 8px; font-size:10px;" onclick="tsRemoveOpponentTurn(${turnIdx})">×ターン削除</button>
        </div>
        <div>${actionsHtml || '<p style="color:#666; font-size:10px; padding:4px;">アクションなし</p>'}</div>
        <button class="admin-btn-sm" style="margin-top:6px; font-size:10px; padding:3px 10px;" onclick="tsAddOpponentAction(${turnIdx})">＋ アクションを追加</button>
      </div>
    `;
  }).join('');
}

function _renderOpponentActionRow(turnIdx, actIdx, action) {
  const typeOpts = OPPONENT_ACTION_TYPES.map(t =>
    `<option value="${t.value}"${t.value === action.type ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  const def = OPPONENT_ACTION_TYPES.find(t => t.value === action.type);
  const fieldsHtml = def && def.fields.length
    ? def.fields.map(f => `
        <input type="text" value="${_escHtml(action[f] || '')}"
          placeholder="${FIELD_LABELS[f] || f}"
          oninput="tsUpdateOpponentActionField(${turnIdx},${actIdx},'${f}',this.value)"
          style="font-size:10px; padding:3px; width:130px; margin-left:4px;">
      `).join('')
    : '';
  return `
    <div style="display:flex; align-items:center; padding:4px; background:#0f0f0f; border-radius:3px; margin-bottom:3px; flex-wrap:wrap; gap:4px;">
      <span style="color:#888; font-size:10px; min-width:30px;">${actIdx + 1}.</span>
      <select onchange="tsUpdateOpponentActionType(${turnIdx},${actIdx},this.value)" style="font-size:10px; padding:3px;">
        ${typeOpts}
      </select>
      ${fieldsHtml}
      <button class="admin-btn-danger" style="padding:2px 6px; font-size:10px; margin-left:auto;" onclick="tsRemoveOpponentAction(${turnIdx},${actIdx})">×</button>
    </div>
  `;
}

// ===================================================================
// 保存
// ===================================================================
window.executeTutorialScenarioSave = async function() {
  const tutorialName = document.getElementById('ts-tutorial-name').value.trim();
  if (!tutorialName) return alert('チュートリアル名を入力してください');
  const deckId = document.getElementById('ts-deck-id').value;
  if (!deckId) return alert('使用デッキを選択してください');

  // クリア条件
  const type = document.getElementById('ts-clear-type').value;
  let clearCondition = { type };
  const def = CONDITION_TYPES.find(t => t.value === type);
  if (def && def.needsCardNo) {
    const cardNo = document.getElementById('ts-clear-param').value.trim();
    if (!cardNo) return alert('クリア条件のカードNoを入力してください');
    clearCondition.params = { cardNo };
  }

  // 初期盤面（視覚UI経由の _initialBoardState から構築）
  const ibState = _initialBoardState || _emptyBoardState();
  const initialBoard = {
    playerFirst: document.getElementById('ts-player-first').value === 'true',
    playerMemory: Number(document.getElementById('ts-player-memory').value || 0),
    playerSecurityCount: Number(document.getElementById('ts-player-sec').value || 5),
    opponentSecurityCount: Number(document.getElementById('ts-opponent-sec').value || 5),
    playerHand:         ibState.playerHand         || [],
    playerBattleArea:   ibState.playerBattleArea   || [],
    playerRaisingArea:  ibState.playerRaisingArea  || null,
    opponentHand:       ibState.opponentHand       || [],
    opponentBattleArea: ibState.opponentBattleArea || [],
    opponentRaisingArea:ibState.opponentRaisingArea|| null,
  };

  // 相手AIスクリプト（選択式UIから構築済み）
  const opponentScript = _opponentScript.map(t => ({
    turn: Number(t.turn || 0),
    actions: (t.actions || []).map(a => Object.assign({}, a)),
  })).filter(t => t.actions.length > 0);

  // フロー検証（空ステップのフェーズは残すが、完全に空なフローもOK）
  const cleanedFlow = _scenarioFlow.map(block => ({
    phase: block.phase,
    turn: block.turn || 1,
    trigger: block.trigger || undefined,
    steps: (block.steps || []).filter(s => s && (s.instructionText || s.advanceCondition)),
  }));

  // クリア後メッセージ
  const clearMessage = (document.getElementById('ts-clear-message').value || '').trim() || undefined;

  const scenario = {
    id: _scenarioEditData ? _scenarioEditData.id : '',
    tutorialName,
    description: document.getElementById('ts-description').value.trim(),
    difficulty: document.getElementById('ts-difficulty').value,
    order: Number(document.getElementById('ts-order').value || 0),
    prerequisiteId: document.getElementById('ts-prerequisite').value.trim() || null,
    mode: document.getElementById('ts-mode').value,
    showPhaseGuide: !!(document.getElementById('ts-show-phase-guide') && document.getElementById('ts-show-phase-guide').checked),
    phaseGuideTexts: _getPhaseGuideTexts(),
    deckId,
    clearCondition,
    clearMessage,
    initialBoard,
    opponentScript,
    flow: cleanedFlow,
  };

  const btn = document.getElementById('ts-save-btn');
  btn.disabled = true; btn.innerText = '保存中...';

  try {
    const isUpdate = !!(_scenarioEditData && _scenarioEditData.id);
    const action = isUpdate ? 'updateTutorialScenario' : 'saveTutorialScenario';
    const result = await gasPost(action, { scenario });
    btn.disabled = false; btn.innerText = '保存する';
    if (result && (result.status === 'SUCCESS_NEW' || result.status === 'SUCCESS_UPDATE')) {
      alert(`「${tutorialName}」を${result.status === 'SUCCESS_UPDATE' ? '上書き保存' : '新規登録'}しました`);
      showScreen('tutorial-scenario-list-screen');
      loadTutorialScenarioList();
    } else {
      const detail = result
        ? (result.message || result.error || result.status || JSON.stringify(result))
        : '(レスポンスなし)';
      alert('保存エラー: ' + detail + '\n\nGAS API のデプロイが最新か、スプシの「チュートリアルシナリオ」シートが存在するか確認してください。');
      console.error('[saveTutorialScenario] result:', result);
    }
  } catch (e) {
    btn.disabled = false; btn.innerText = '保存する';
    alert('通信エラー: ' + e.message);
  }
};
