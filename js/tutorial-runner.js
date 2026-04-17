// ===================================================================
// チュートリアルランナー（フェーズベース）
// シナリオの flow 構造を読み込み、フェーズ切替・割り込みトリガーに
// 応じてステップを順番に実行する。
// effect-engine / battle-combat / battle-phase からイベント通知を受けて
// 現在ステップの進行条件・シナリオのクリア条件をチェックする。
// ===================================================================
import { gasPost } from './firebase-config.js';

// ===================================================================
// 進行条件判定ディスパッチテーブル
// 新しい条件を追加するときはここに1行足すだけ（コードはこの1箇所のみ編集）
// params はシナリオの advanceCondition.params、ev は notifyEvent の引数
// ===================================================================
// カード参照ヘルパー（admin/battle で共通の allCards を参照）
function _findCardMeta(cardNo) {
  if (!cardNo || typeof window === 'undefined' || !window.allCards) return null;
  return window.allCards.find(c => String(c['カードNo']) === String(cardNo)) || null;
}
function _getCardType(cardNo) {
  const c = _findCardMeta(cardNo);
  // カードデータは「タイプ」カラム（parseDeck と同一）。
  // 旧名「種類」「カード種類」も後方互換で許容
  return c ? String(c['タイプ'] || c['種類'] || c['カード種類'] || '') : '';
}
function _getCardLevel(cardNo) {
  const c = _findCardMeta(cardNo);
  if (!c) return '';
  return String(c['レベル'] || c['Lv'] || '');
}
// runner インスタンス上の累計カウンタを参照
function _getOppSecChecks() {
  const r = (typeof window !== 'undefined') ? window._tutorialRunner : null;
  return (r && r._oppSecurityChecks) || 0;
}
function _getOwnSecChecks() {
  const r = (typeof window !== 'undefined') ? window._tutorialRunner : null;
  return (r && r._ownSecurityChecks) || 0;
}

export const CONDITION_EVALUATORS = {
  // 育成フェイズ終了（breed→main 遷移で発火）
  breed_end: (params, ev) => ev.type === 'phase_enter' && ev.phase === 'main',

  // 進化（任意 + レベル別パラメータ）
  evolve_any: (params, ev) => ev.type === 'evolve',
  evolve_lv: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === String(params.level || ''),
  // 旧固定キー（互換用、既存シナリオが壊れないように残す）
  evolve_lv3: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === '3',
  evolve_lv4: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === '4',
  evolve_lv5: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === '5',
  evolve_lv6: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === '6',
  evolve_lv7: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === '7',

  // カード登場・使用（カード種類で判定）
  play_digimon: (params, ev) => ev.type === 'play' && _getCardType(ev.cardNo).includes('デジモン'),
  play_option:  (params, ev) => ev.type === 'play' && _getCardType(ev.cardNo).includes('オプション'),
  play_tamer:   (params, ev) => ev.type === 'play' && _getCardType(ev.cardNo).includes('テイマー'),
  // レベル別登場（パラメータ）+ 旧固定キー
  play_lv: (params, ev) => ev.type === 'play' && _getCardLevel(ev.cardNo) === String(params.level || ''),
  play_lv3: (params, ev) => ev.type === 'play' && _getCardLevel(ev.cardNo) === '3',
  play_lv4: (params, ev) => ev.type === 'play' && _getCardLevel(ev.cardNo) === '4',
  play_lv5: (params, ev) => ev.type === 'play' && _getCardLevel(ev.cardNo) === '5',
  play_lv6: (params, ev) => ev.type === 'play' && _getCardLevel(ev.cardNo) === '6',
  play_lv7: (params, ev) => ev.type === 'play' && _getCardLevel(ev.cardNo) === '7',

  // セキュリティチェック累計（params.count または旧固定キー）
  security_check_n: (params, ev) => ev.type === 'security_reduced' && ev.side === 'opponent' && _getOppSecChecks() >= Number(params.count || 1),
  security_check_1: (params, ev) => ev.type === 'security_reduced' && ev.side === 'opponent' && _getOppSecChecks() >= 1,
  security_check_2: (params, ev) => ev.type === 'security_reduced' && ev.side === 'opponent' && _getOppSecChecks() >= 2,
  security_check_3: (params, ev) => ev.type === 'security_reduced' && ev.side === 'opponent' && _getOppSecChecks() >= 3,
  security_check_4: (params, ev) => ev.type === 'security_reduced' && ev.side === 'opponent' && _getOppSecChecks() >= 4,
  security_check_5: (params, ev) => ev.type === 'security_reduced' && ev.side === 'opponent' && _getOppSecChecks() >= 5,

  // アタック関連
  attack_declared: (params, ev) => ev.type === 'attack_declared',
  attack_target_selected: (params, ev) => ev.type === 'attack_target_selected',
  attack_resolved: (params, ev) => ev.type === 'attack_resolved',
  direct_attack:   (params, ev) => ev.type === 'attack_declared' && ev.isDirect === true,
  block:           (params, ev) => ev.type === 'block',

  // 効果
  use_effect:        (params, ev) => ev.type === 'use_effect',
  effect_triggered:  (params, ev) => ev.type === 'effect_triggered',
  security_effect:   (params, ev) => ev.type === 'security_effect',

  // 閉じるボタン押下（カード詳細/トラッシュ/各種モーダル共通）
  modal_closed: (params, ev) => ev.type === 'modal_closed',
  // キャンセルボタン押下（長押しメニュー/効果確認いいえ 共通）
  action_cancelled: (params, ev) => ev.type === 'action_cancelled',

  // 特殊
  security_zero: (params, ev) =>
    ev.type === 'security_reduced' && ev.side === 'opponent' && (ev.remaining ?? -1) === 0,
  card_detail_opened: (params, ev) => ev.type === 'card_detail_opened',
  card_detail_closed: (params, ev) => ev.type === 'card_detail_closed',
  mulligan_accepted: (params, ev) => ev.type === 'mulligan_accepted',

  // 既存の進行系（互換維持 + ターン数指定）
  turn_end: (params, ev) => {
    if (ev.type !== 'turn_end') return false;
    const wantSide = params.side || 'player';
    if (wantSide !== 'any' && ev.side !== wantSide) return false;
    // params.turn が指定されていれば該当ターン数の終了時のみ
    if (params.turn != null && params.turn !== '') {
      const cur = (window.bs && window.bs.turn) || 0;
      if (Number(params.turn) !== cur) return false;
    }
    return true;
  },
  turn_start: (params, ev) => {
    if (ev.type !== 'turn_start') return false;
    const wantSide = params.side || 'player';
    if (wantSide !== 'any' && ev.side !== wantSide) return false;
    if (params.turn != null && params.turn !== '') {
      const cur = (window.bs && window.bs.turn) || 0;
      if (Number(params.turn) !== cur) return false;
    }
    return true;
  },

  // --- 互換用（旧条件を使っているシナリオのため残す）---
  hatch:              (params, ev) => ev.type === 'hatch',
  play_any:           (params, ev) => ev.type === 'play',
  play_specific:      (params, ev) => ev.type === 'play' && String(ev.cardNo || '') === String(params.cardNo || ''),
  evolve_specific:    (params, ev) => ev.type === 'evolve' && String(ev.targetCardNo || '') === String(params.cardNo || ''),
  destroy_opponent:   (params, ev) => ev.type === 'destroy' && ev.targetSide === 'opponent',
  security_reduced: (params, ev) => {
    if (ev.type !== 'security_reduced') return false;
    const wantSide = params.side || 'opponent';
    if (wantSide !== 'any' && ev.side !== wantSide) return false;
    return (ev.count || 1) >= Number(params.count || 1);
  },
  custom: () => false,
};

// ===================================================================
// 条件評価
// ===================================================================
export function evaluateCondition(condition, ev) {
  if (!condition || !condition.type) return false;
  const evaluator = CONDITION_EVALUATORS[condition.type];
  if (!evaluator) {
    console.warn('[TutorialRunner] 未知の条件タイプ:', condition.type);
    return false;
  }
  try {
    return !!evaluator(condition.params || {}, ev || {});
  } catch (e) {
    console.error('[TutorialRunner] 条件判定エラー:', e);
    return false;
  }
}

// ===================================================================
// TutorialRunner 本体（フェーズベース）
// ===================================================================
class TutorialRunner {
  constructor() {
    this.scenario = null;
    this.cleared = false;
    this.active = false;

    // フェーズベース進行状態
    this._flow = [];              // scenario.flow のコピー
    this._currentBlock = null;    // 現在実行中のフローブロック
    this._currentStepIdx = 0;     // ブロック内のステップインデックス
    this._completedBlocks = new Set(); // 完了済みブロックのインデックス
    this._shownPhases = {};
    this._currentTurn = 1;        // 現在のターン番号
    this._oppSecurityChecks = 0;  // 相手セキュリティチェック累計
    this._ownSecurityChecks = 0;  // 自分セキュリティチェック累計

    // 割り込み制御
    this._interruptResolve = null; // checkInterrupt の Promise resolve
    this._pausedBlock = null;      // 割り込み前のブロック状態（完了後にレジューム）
    this._phaseBlockResolve = null; // notifyPhaseChange 待ち Promise の resolver
    this._triggerCounts = {};       // トリガー発生回数カウンター（ターンごとにリセット）
    this._lastCountTurn = 0;       // カウンターの最終リセットターン
  }

  // ---------------------------------------------------------------
  // シナリオ開始
  // ---------------------------------------------------------------
  async start(scenario, playerDeckData, aiDeckData) {
    if (!scenario) { console.error('[TutorialRunner] scenario is null'); return; }
    this.scenario = scenario;
    this.cleared = false;
    this.active = true;
    this._shownPhases = {};
    this._currentTurn = 1;
    this._completedBlocks = new Set();
    this._currentBlock = null;
    this._currentStepIdx = 0;
    this._interruptResolve = null;
    this._oppSecurityChecks = 0;
    this._ownSecurityChecks = 0;
    // 前シナリオの残留 intent を必ずクリア
    if (typeof window !== 'undefined') {
      window._tutorialAiBlockIntent = null;
      window._tutorialAiSelectTarget = null;
    }
    window._tutorialRunner = this;

    // フロー構築（flow がなければ空）
    this._flow = Array.isArray(scenario.flow) ? scenario.flow : [];

    const deckForAi = aiDeckData || playerDeckData;
    const playerFirst = (scenario.initialBoard && scenario.initialBoard.playerFirst !== false);

    // バトル画面起動
    if (typeof window.showScreen === 'function') window.showScreen('battle-screen');
    if (typeof window.startBattleGame !== 'function') {
      console.error('[TutorialRunner] startBattleGame が見つかりません');
      return;
    }
    await window.startBattleGame(playerDeckData, deckForAi, playerFirst);

    // 初期盤面セットアップ
    try {
      this.setupInitialBoard(scenario.initialBoard || {});
    } catch (e) {
      console.error('[TutorialRunner] 初期盤面セットアップ失敗:', e);
    }

    // 相手AIスクリプトの準備
    this.opponentScriptRunner = new OpponentScriptRunner(scenario.opponentScript || []);

    // ゴール（クリア条件）を上部に常時表示
    if (typeof window._tutorialShowGoal === 'function' && scenario.clearCondition) {
      window._tutorialShowGoal(scenario.clearCondition);
    }

    // マリガンフェーズのブロック発火は battle.js 側のゲート演出終了後に
    // notifyPhaseChange('mulligan') から駆動する（ゲート演出中の早期発火を防ぐ）
  }

  // ---------------------------------------------------------------
  // フェーズ切替通知（battle-phase.js から呼ばれる）
  // ---------------------------------------------------------------
  async notifyPhaseChange(phaseKey) {
    if (!this.active || this.cleared) return;
    // フェーズ説明ポップは管理画面のフロー設定（message ステップ）で個別に作る方針。
    // message/spotlight ステップが先頭に並んでいる場合は「次へ」を押すまで
    // execPhase を待たせる。action ステップが来たら解放（フェーズ動作を進める）
    await this._tryActivatePhaseBlock(phaseKey);
  }

  // 自動進行フェーズ（unsuspend/draw）では指差しを隠す
  onPhaseChange(phase) {
    if (!this.active || this.cleared) return;
    if (phase === 'unsuspend' || phase === 'draw') {
      this.hideInstruction();
    }
    // フェーズ進入イベントを notifyEvent 経由で流す（breed_end 等の条件判定用）
    this.notifyEvent('phase_enter', { phase });
    // notifyPhaseChange で処理するので、ここではフェーズブロック探索はしない
  }

  // ---------------------------------------------------------------
  // 割り込みチェック（battle-phase.js 等から await で呼ばれる）
  // triggerKey: 'before_end_turn' | 'after_attack' | 'memory_crossed' | 'before_opponent_turn'
  // 該当する割り込みブロックがあればステップを全て実行してから resolve する
  // ---------------------------------------------------------------
  async checkInterrupt(triggerKey) {
    if (!this.active || this.cleared) return;
    const turn = this._currentTurn;

    // ターンが変わったらカウンターリセット
    const bsTurn = (window.bs && window.bs.turn) || 0;
    if (bsTurn !== this._lastCountTurn) {
      this._triggerCounts = {};
      this._lastCountTurn = bsTurn;
    }

    // 発生回数をインクリメント
    const countKey = triggerKey + ':' + turn;
    this._triggerCounts[countKey] = (this._triggerCounts[countKey] || 0) + 1;
    const currentOccurrence = this._triggerCounts[countKey];

    // 該当する割り込みブロックを探す（occurrence マッチ付き）
    const blockIdx = this._flow.findIndex((b, i) =>
      b.phase === '_trigger' &&
      b.trigger === triggerKey &&
      (b.turn || 1) === turn &&
      !this._completedBlocks.has(i) &&
      (b.occurrence || 1) === currentOccurrence
    );
    if (blockIdx < 0) return;

    await this._runBlockSteps(blockIdx);
  }

  // ---------------------------------------------------------------
  // イベント通知（battle-combat / effect-engine から呼ばれる）
  // ---------------------------------------------------------------
  notifyEvent(type, data) {
    if (!this.active || this.cleared) return;
    const ev = Object.assign({ type }, data || {});

    // ターン番号を追跡
    if (type === 'turn_start' && ev.side === 'player') {
      this._currentTurn = (window.bs && window.bs.turn) || this._currentTurn;
    }

    // セキュリティチェック累計を追跡（security_check_N の判定用）
    if (type === 'security_reduced') {
      if (ev.side === 'opponent') this._oppSecurityChecks = (this._oppSecurityChecks || 0) + (Number(ev.count) || 1);
      if (ev.side === 'own')      this._ownSecurityChecks = (this._ownSecurityChecks || 0) + (Number(ev.count) || 1);
    }

    // 相手ターン開始は記録のみ（スクリプト実行は aiPhaseMain から呼ばれる）

    // 現在アクティブなブロックのステップ進行条件をチェック
    if (this._currentBlock) {
      const step = this._currentBlock.steps && this._currentBlock.steps[this._currentStepIdx];
      if (step && step.stepType === 'action' && evaluateCondition(step.advanceCondition, ev)) {
        this._advanceStep();
      }
    }

    // シナリオ全体のクリア条件チェック
    const clearCond = this.scenario.clearCondition;
    if (clearCond && evaluateCondition(clearCond, ev)) {
      this.onClear();
    }
  }

  // ---------------------------------------------------------------
  // フェーズブロックのアクティベート
  // ---------------------------------------------------------------
  _tryActivatePhaseBlock(phaseKey) {
    // 相手フェーズの場合: ターン番号は「相手の何ターン目か」で照合
    // bs.turn はAIターン開始時に加算されるので、相手1ターン目 = bs.turn 2
    const isOppPhase = phaseKey === 'opp_breed' || phaseKey === 'opp_main';
    const turn = isOppPhase
      ? ((window.bs && window.bs.turn) || 1) - 1  // bs.turn 2 → T1, bs.turn 3 → T2
      : this._currentTurn;
    const blockIdx = this._flow.findIndex((b, i) =>
      b.phase === phaseKey &&
      b.phase !== '_trigger' &&
      (b.turn || 1) === turn &&
      !this._completedBlocks.has(i)
    );
    if (blockIdx < 0) return Promise.resolve();

    return new Promise(resolve => {
      this._phaseBlockResolve = resolve;
      this._activateBlock(blockIdx);
      // _activateBlock 内で _showCurrentStep が走り、先頭ステップが表示される。
      // 先頭が action なら即解放（フェーズ通常進行）。
      // message/spotlight なら _advanceStep を経て action/block完了時に解放される。
      this._maybeReleasePhaseBlock();
    });
  }

  // フェーズブロックの Promise を解放できる状態なら解放
  //   - ブロックが完了した（_currentBlock=null）
  //   - 現在ステップが action（=フェーズを進めていい）
  _maybeReleasePhaseBlock() {
    if (!this._phaseBlockResolve) return;
    const step = this._currentBlock && this._currentBlock.steps && this._currentBlock.steps[this._currentStepIdx];
    const sType = step && (step.stepType || 'action');
    if (!this._currentBlock || !step || sType === 'action') {
      const r = this._phaseBlockResolve;
      this._phaseBlockResolve = null;
      r();
    }
  }

  _activateBlock(blockIdx) {
    const block = this._flow[blockIdx];
    if (!block || !block.steps || !block.steps.length) {
      this._completedBlocks.add(blockIdx);
      return;
    }
    this._currentBlock = block;
    this._currentBlock._flowIdx = blockIdx;
    this._currentStepIdx = 0;
    this._showCurrentStep();
  }

  // ---------------------------------------------------------------
  // ステップ表示・進行
  // ---------------------------------------------------------------
  _showCurrentStep() {
    if (!this._currentBlock) { this.hideInstruction(); return; }
    const step = this._currentBlock.steps[this._currentStepIdx];
    if (!step) { this._completeCurrentBlock(); return; }

    const sType = step.stepType || 'action';

    // action ステップに到達したらフェーズ進行を解放
    if (sType === 'action') this._maybeReleasePhaseBlock();

    if (sType === 'message' || sType === 'spotlight') {
      this.hideInstruction();
      if (typeof window._tutorialShowStepPopup === 'function') {
        // 現在のブロック情報を渡して、ポップアップタイトルに使う
        const ctx = {
          phase: this._currentBlock ? this._currentBlock.phase : null,
          trigger: this._currentBlock ? this._currentBlock.trigger : null,
        };
        window._tutorialShowStepPopup(step, sType, ctx).then(() => {
          this._advanceStep();
        });
      } else {
        alert(step.instructionText || '');
        this._advanceStep();
      }
      return;
    }

    // action ステップ: 指差し表示
    this._showInstruction(step.instructionText || '', step.targetArea || '', step);
  }

  _advanceStep() {
    // 成功演出（actionステップのみ）
    // step.successPopup で挙動を制御:
    //   未設定 or 'auto' → 自動切替（OK→GREAT→NICE→PERFECT）
    //   'none'           → 表示しない
    //   その他の文字列   → そのテキストをそのまま表示
    // 後方互換: mulligan_accepted は明示設定なしのとき silent
    const step = this._currentBlock && this._currentBlock.steps[this._currentStepIdx];
    const condType = step && step.advanceCondition && step.advanceCondition.type;
    // action ステップは進行条件達成と同時に指差し/吹き出しを消す
    // （成功演出やバトル演出が始まる前に古い指差しを消しておくことで重なりを防ぐ）
    if (step && step.stepType === 'action') {
      this.hideInstruction();
    }
    if (step && step.stepType === 'action') {
      let mode = step.successPopup;
      if (!mode) {
        // 未設定: mulligan_accepted のみデフォルト silent、その他 auto
        mode = (condType === 'mulligan_accepted') ? 'none' : 'auto';
      }
      let msg = null;
      if (mode === 'none') {
        msg = null;
      } else if (mode === 'auto') {
        const seq = ['OK!', 'GREAT!', 'NICE!', 'PERFECT!'];
        msg = seq[Math.min(this._currentStepIdx, seq.length - 1)];
      } else {
        msg = mode;
      }
      // 成功演出は queue（バトル演出が走っている可能性があるので、battle側からの
      // flush または安全タイマー (2.5s) で実演出に変わる）
      // 演出が無い系（カード詳細・マリガン・ターン等）は即 flush して即座に表示
      const ANIMATED_CONDITIONS = new Set([
        'hatch', 'evolve_any', 'evolve_specific',
        'play_any', 'play_specific',
        'attack_resolved', 'destroy_opponent',
      ]);
      if (msg && typeof window._tutorialQueueSuccess === 'function') {
        window._tutorialQueueSuccess(msg);
        if (!ANIMATED_CONDITIONS.has(condType) && typeof window._tutorialFlushSuccess === 'function') {
          // バトル演出を待つ必要が無い → 即フラッシュ
          setTimeout(() => { try { window._tutorialFlushSuccess(); } catch (e) {} }, 0);
        }
      }
    }

    this._currentStepIdx++;
    if (!this._currentBlock || this._currentStepIdx >= (this._currentBlock.steps || []).length) {
      this._completeCurrentBlock();
      return;
    }
    // 次ステップ表示は「成功演出が完全に終わってから」
    // action: queue → battle演出が flush → 演出完了 を待つ
    //         ANIMATED 系 (進化/登場/孵化/アタック) はさらに battle 側の
    //         全工程 (割り込み含む) 完了通知を待つ。
    //         → 「ドロー説明の前に main block の次ステップが一瞬出る」を防ぐ
    // message/spotlight: 即座に次へ
    if (step && step.stepType === 'action') {
      const ANIMATED = new Set([
        'hatch', 'evolve_any', 'evolve_specific',
        'play_any', 'play_specific', 'play_digimon', 'play_tamer', 'play_option',
        'attack_resolved', 'destroy_opponent',
      ]);
      const waitForBattle = ANIMATED.has(condType);
      (async () => {
        if (typeof window._tutorialAwaitSuccess === 'function') {
          try { await window._tutorialAwaitSuccess(); } catch (e) {}
        }
        if (waitForBattle && typeof window._tutorialAwaitBattleDone === 'function') {
          try { await window._tutorialAwaitBattleDone(); } catch (e) {}
        }
        setTimeout(() => this._showCurrentStep(), 150);
      })();
    } else {
      setTimeout(() => this._showCurrentStep(), 100);
    }
  }

  _completeCurrentBlock() {
    if (this._currentBlock && typeof this._currentBlock._flowIdx === 'number') {
      this._completedBlocks.add(this._currentBlock._flowIdx);
    }
    this._currentBlock = null;
    this._currentStepIdx = 0;
    this.hideInstruction();

    // 割り込み完了通知
    if (this._interruptResolve) {
      const resolve = this._interruptResolve;
      this._interruptResolve = null;
      resolve();
      // 割り込み前にブロックが動いていたならレジューム
      this._resumePausedBlock();
    }
    // フェーズブロックが全ステップ終えた場合もPromiseを解放
    this._maybeReleasePhaseBlock();
  }

  // 割り込み前のブロック状態を復元して次ステップ表示
  _resumePausedBlock() {
    if (!this._pausedBlock) return;
    const p = this._pausedBlock;
    this._pausedBlock = null;
    // 中断前のブロックが既に完了扱いでなく、まだステップが残っている場合のみ復元
    if (!p.block || !p.block.steps || p.stepIdx >= p.block.steps.length) return;
    this._currentBlock = p.block;
    this._currentStepIdx = p.stepIdx;
    setTimeout(() => this._showCurrentStep(), 200);
  }

  // 割り込みブロックのステップを全実行して完了を待つ
  _runBlockSteps(blockIdx) {
    return new Promise(resolve => {
      // 実行中ブロックがあれば退避（割り込み後に復元）
      if (this._currentBlock && this._currentBlock._flowIdx !== blockIdx) {
        this._pausedBlock = {
          block: this._currentBlock,
          stepIdx: this._currentStepIdx,
        };
      }
      this._interruptResolve = resolve;
      this._activateBlock(blockIdx);

      // ブロックにステップがなかった場合（即complete済み）
      if (!this._currentBlock) {
        this._interruptResolve = null;
        resolve();
        this._resumePausedBlock();
      }
    });
  }

  // ---------------------------------------------------------------
  // 指示表示
  // ---------------------------------------------------------------
  _showInstruction(text, targetArea, step) {
    if (typeof window._tutorialShowInstruction === 'function') {
      window._tutorialShowInstruction(text, targetArea || '', step || null);
    } else {
      console.log('[Tutorial Instruction]', text, targetArea || '');
    }
  }

  hideInstruction() {
    if (typeof window._tutorialHideInstruction === 'function') {
      window._tutorialHideInstruction();
    }
  }

  // ---------------------------------------------------------------
  // クリア処理
  // ---------------------------------------------------------------
  onGoalReached(action, ctx) {
    this.onClear();
  }

  onClear() {
    if (this.cleared) return;
    this.cleared = true;
    this.hideInstruction();
    // バトル進行を停止（AIターン/フェーズ遷移/戦闘をすべて中断）
    if (window.bs) {
      window.bs._battleAborted = true;
      window.bs._pendingTurnEnd = false;
    }
    this.saveProgress();
    this.showClearModal();
  }

  showClearModal() {
    if (typeof window._tutorialShowClear === 'function') {
      window._tutorialShowClear(this.scenario);
    } else {
      console.log('[Tutorial Cleared]', this.scenario && this.scenario.tutorialName);
      const msg = this.scenario.clearMessage
        ? this.scenario.clearMessage
        : 'シナリオクリア: ' + (this.scenario.tutorialName || '');
      setTimeout(() => { alert(msg); }, 300);
    }
  }

  async saveProgress() {
    try {
      const playerName = window.currentPlayerName || '';
      const password = window.currentSessionPassword || '';
      const scenarioId = this.scenario && this.scenario.id;
      console.log('[TutorialRunner] saveProgress 呼出', { playerName, hasPassword: !!password, scenarioId });
      if (!password) {
        console.warn('[TutorialRunner] パスワード未設定のため進捗保存スキップ');
        return;
      }
      if (!scenarioId) {
        console.warn('[TutorialRunner] scenarioId 未設定のため進捗保存スキップ');
        return;
      }
      const res = await gasPost('saveTutorialProgress', { playerName, password, scenarioId });
      console.log('[TutorialRunner] saveTutorialProgress 応答:', res);
      if (res && res.error) {
        console.error('[TutorialRunner] GAS エラー:', res.error);
      } else if (res && res.status && res.status !== 'SUCCESS_NEW' && res.status !== 'ALREADY_CLEARED') {
        console.error('[TutorialRunner] 進捗保存失敗:', res);
      }
    } catch (e) {
      console.error('[TutorialRunner] 進捗保存失敗 (例外):', e);
    }
  }

  // ---------------------------------------------------------------
  // 初期盤面セットアップ
  // ---------------------------------------------------------------
  setupInitialBoard(initialBoard) {
    const bs = window.bs;
    if (!bs) { console.warn('[TutorialRunner] window.bs not available'); return; }
    if (typeof window.parseDeck !== 'function') {
      console.warn('[TutorialRunner] window.parseDeck not available');
      return;
    }

    const ib = initialBoard || {};

    // メモリー
    if (typeof ib.playerMemory === 'number') bs.memory = ib.playerMemory;

    // 手札上書き
    if (Array.isArray(ib.playerHand))   bs.player.hand = this._resolveCardRefs(ib.playerHand);
    if (Array.isArray(ib.opponentHand)) bs.ai.hand     = this._resolveCardRefs(ib.opponentHand);

    // バトルエリア上書き
    if (Array.isArray(ib.playerBattleArea))   bs.player.battleArea = this._resolveCardRefs(ib.playerBattleArea);
    if (Array.isArray(ib.opponentBattleArea)) bs.ai.battleArea     = this._resolveCardRefs(ib.opponentBattleArea);

    // 育成エリア
    if (ib.playerRaisingArea !== undefined) {
      if (ib.playerRaisingArea === null) bs.player.ikusei = null;
      else {
        const arr = this._resolveCardRefs([ib.playerRaisingArea]);
        bs.player.ikusei = arr[0] || null;
      }
    }
    if (ib.opponentRaisingArea !== undefined) {
      if (ib.opponentRaisingArea === null) bs.ai.ikusei = null;
      else {
        const arr = this._resolveCardRefs([ib.opponentRaisingArea]);
        bs.ai.ikusei = arr[0] || null;
      }
    }

    // セキュリティ指定（先頭=最初にチェックされるカード）
    if (Array.isArray(ib.playerSecurity) && ib.playerSecurity.length) {
      bs.player.security = this._resolveCardRefs(ib.playerSecurity);
    }
    if (Array.isArray(ib.opponentSecurity) && ib.opponentSecurity.length) {
      bs.ai.security = this._resolveCardRefs(ib.opponentSecurity);
      bs._aiSecuritySynced = true;
    }

    // セキュリティ枚数調整（指定カードの後にデッキから補充/超過分を削除）
    // ※ デッキトップ指定より先に実行（デッキ上のカードがセキュリティに消費されるのを防ぐ）
    const adjustSecurity = (side, want) => {
      if (typeof want !== 'number') return;
      const s = bs[side];
      while (s.security.length > want && s.security.length > 0) s.security.pop();
      while (s.security.length < want && s.deck.length > 0) s.security.push(s.deck.shift());
    };
    adjustSecurity('player', ib.playerSecurityCount);
    adjustSecurity('ai', ib.opponentSecurityCount);

    // デッキトップ指定（先頭=次に引く順）
    // ※ セキュリティ調整の後に実行し、指定カードが確実にデッキ上に残るようにする
    if (Array.isArray(ib.playerDeckTop) && ib.playerDeckTop.length) {
      const top = this._resolveCardRefs(ib.playerDeckTop);
      bs.player.deck = [...top, ...bs.player.deck];
    }
    if (Array.isArray(ib.opponentDeckTop) && ib.opponentDeckTop.length) {
      const top = this._resolveCardRefs(ib.opponentDeckTop);
      bs.ai.deck = [...top, ...bs.ai.deck];
    }

    // トラッシュ指定
    if (Array.isArray(ib.playerTrash) && ib.playerTrash.length) {
      bs.player.trash = this._resolveCardRefs(ib.playerTrash);
    }
    if (Array.isArray(ib.opponentTrash) && ib.opponentTrash.length) {
      bs.ai.trash = this._resolveCardRefs(ib.opponentTrash);
    }

    // 再描画
    if (typeof window.renderAll === 'function') window.renderAll(true);
    if (typeof window.updateMemGauge === 'function') window.updateMemGauge();
  }

  _resolveCardRefs(refs) {
    if (!Array.isArray(refs) || typeof window.parseDeck !== 'function') return [];
    const result = [];
    refs.forEach(ref => {
      if (!ref) return;
      const cardNo = typeof ref === 'string' ? ref : ref.cardNo;
      if (!cardNo) return;
      const parsed = window.parseDeck({ list: `dummy(${cardNo})x1` });
      if (!parsed.length) return;
      const card = parsed[0];
      if (typeof ref === 'object' && Array.isArray(ref.evolutionSources)) {
        ref.evolutionSources.forEach(srcNo => {
          const srcArr = window.parseDeck({ list: `dummy(${srcNo})x1` });
          if (srcArr.length) card.stack.push(srcArr[0]);
        });
      }
      if (typeof ref === 'object' && ref.suspended) card.suspended = true;
      if (typeof ref === 'object' && typeof ref.dpBuff === 'number') {
        card.dp = (card.dp || 0) + ref.dpBuff;
        card.dpModifier = (card.dpModifier || 0) + ref.dpBuff;
      }
      result.push(card);
    });
    return result;
  }

  // ---------------------------------------------------------------
  // シナリオ停止
  // ---------------------------------------------------------------
  stop() {
    this.active = false;
    this.cleared = false;
    this.scenario = null;
    this._flow = [];
    this._currentBlock = null;
    this._currentStepIdx = 0;
    this._completedBlocks = new Set();
    this._pausedBlock = null;
    this.hideInstruction();
    if (this._interruptResolve) {
      this._interruptResolve();
      this._interruptResolve = null;
    }
    if (this._phaseBlockResolve) {
      this._phaseBlockResolve();
      this._phaseBlockResolve = null;
    }
    if (window._tutorialRunner === this) {
      window._tutorialRunner = null;
    }
  }
}

// ===================================================================
// OpponentScriptRunner
// ===================================================================
class OpponentScriptRunner {
  constructor(script) {
    this.script = Array.isArray(script) ? script : [];
    this.executedTurns = {};
  }

  // 育成フェイズ系アクション
  static BREED_ACTIONS = new Set(['hatch', 'move_to_battle', 'evolve_breed']);
  // メインフェイズ系アクション
  static MAIN_ACTIONS = new Set(['attack', 'play_card', 'play', 'evolve_battle', 'evolve', 'block', 'select_target', 'pass', 'end_turn']);

  runTurn(turnNumber, done) {
    if (this.executedTurns[turnNumber]) { done && done(); return; }
    this.executedTurns[turnNumber] = true;
    done && done();
  }

  // 指定フェーズのアクションだけ実行
  runPhase(turnNumber, phase, done) {
    const entry = this.script.find(t => Number(t.turn) === Number(turnNumber));
    if (!entry || !Array.isArray(entry.actions) || entry.actions.length === 0) {
      done && done(); return;
    }
    const filter = phase === 'breed' ? OpponentScriptRunner.BREED_ACTIONS : OpponentScriptRunner.MAIN_ACTIONS;
    const actions = entry.actions.filter(a => filter.has(a.type));
    if (actions.length === 0) { done && done(); return; }
    this._runActions(actions, 0, done);
  }

  hasActionsForPhase(turnNumber, phase) {
    const entry = this.script.find(t => Number(t.turn) === Number(turnNumber));
    if (!entry || !Array.isArray(entry.actions)) return false;
    const filter = phase === 'breed' ? OpponentScriptRunner.BREED_ACTIONS : OpponentScriptRunner.MAIN_ACTIONS;
    return entry.actions.some(a => filter.has(a.type));
  }

  _runActions(actions, idx, done) {
    if (idx >= actions.length) { done && done(); return; }
    const action = actions[idx];
    this._runOneAction(action, () => {
      setTimeout(() => this._runActions(actions, idx + 1, done), 400);
    });
  }

  _runOneAction(action, cb) {
    const bs = window.bs;
    const log = (msg) => { if (typeof window.addLog === 'function') window.addLog('🤖 ' + msg); };

    try {
      switch (action.type) {
        case 'hatch': {
          if (bs && bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0 && !bs.ai.ikusei) {
            bs.ai.ikusei = bs.ai.tamaDeck.splice(0, 1)[0];
            log('相手が孵化');
            if (typeof window.renderAll === 'function') window.renderAll();
          }
          cb(); break;
        }
        // ===== 公式ルール準拠アクション (新) =====
        case 'play_card':
        case 'play': {
          // デジモン/オプション/テイマー登場（コスト+【登場時】効果）
          if (window._aiScriptPlayCard && action.cardNo) {
            window._aiScriptPlayCard(action.cardNo, () => cb());
          } else { cb(); }
          break;
        }
        case 'evolve_battle':
        case 'evolve': {
          // バトルエリアで進化（コスト+ドロー+【進化時】）
          if (window._aiScriptEvolveBattle && action.sourceCardNo && action.targetCardNo) {
            window._aiScriptEvolveBattle(action.sourceCardNo, action.targetCardNo, () => cb());
          } else { cb(); }
          break;
        }
        case 'evolve_breed': {
          // 育成エリアで進化（コスト+ドロー）
          if (window._aiScriptEvolveBreed && action.targetCardNo) {
            window._aiScriptEvolveBreed(action.targetCardNo, () => cb());
          } else { cb(); }
          break;
        }
        case 'move_to_battle': {
          // 育成エリア → バトルエリア移動
          if (window._aiScriptMoveToBattle) {
            window._aiScriptMoveToBattle(() => cb());
          } else { cb(); }
          break;
        }
        case 'attack': {
          // 相手 (プレイヤー) にアタック
          //   action.cardNo:       アタッカー (AIバトルエリア)
          //   action.targetMode:   'security' | 'digimon'
          //   action.targetCardNo: 攻撃する相手デジモンのカードNo/名前 (digimon時)
          if (window._aiScriptAttack && action.cardNo) {
            const mode = action.targetMode || 'security';
            const target = (mode === 'digimon')
              ? { type: 'digimon', cardNo: action.targetCardNo || '' }
              : 'security';
            window._aiScriptAttack(action.cardNo, target, () => cb());
          } else { cb(); }
          break;
        }
        case 'block': {
          // 次にプレイヤーがアタックしてきた時、指定カードでブロックする意図を登録
          //   action.cardNo: AIバトルエリアのブロッカー
          window._tutorialAiBlockIntent = action.cardNo || true;
          log('相手は次のアタックをブロックする予定');
          cb(); break;
        }
        case 'select_target': {
          // 効果対象選択時、指定カードを選ぶ意図を登録
          //   action.cardNo: 対象として選ぶカード
          window._tutorialAiSelectTarget = action.cardNo;
          log('相手は次の対象選択で「' + action.cardNo + '」を選ぶ予定');
          cb(); break;
        }
        // ===== 旧アクション (互換) =====
        case 'attack_security':
        case 'attack_digimon': {
          log('[非推奨] attack に統一: ' + action.type);
          cb(); break;
        }
        case 'pass': {
          log('相手が何もしない');
          cb(); break;
        }
        case 'end_turn': {
          log('相手がターン終了');
          cb(); break;
        }
        default:
          console.warn('[OpponentScriptRunner] unknown action type:', action.type);
          cb();
      }
    } catch (e) {
      console.error('[OpponentScriptRunner] action error:', e);
      cb();
    }
  }
}

// ===================================================================
// グローバル公開
// ===================================================================
let _runnerInstance = null;

export function getTutorialRunner() {
  if (!_runnerInstance) _runnerInstance = new TutorialRunner();
  return _runnerInstance;
}

if (typeof window !== 'undefined') {
  window._getTutorialRunner = getTutorialRunner;
}
