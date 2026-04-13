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
  return c ? String(c['種類'] || c['カード種類'] || '') : '';
}
function _getCardLevel(cardNo) {
  const c = _findCardMeta(cardNo);
  if (!c) return '';
  return String(c['Lv'] || c['レベル'] || '');
}

export const CONDITION_EVALUATORS = {
  // 育成フェイズ終了（breed→main 遷移で発火）
  breed_end: (params, ev) => ev.type === 'phase_enter' && ev.phase === 'main',

  // 進化（既存 + レベル6判定）
  evolve_any: (params, ev) => ev.type === 'evolve',
  evolve_lv6: (params, ev) => ev.type === 'evolve' && _getCardLevel(ev.targetCardNo) === '6',

  // カード登場・使用（カード種類で判定）
  play_digimon: (params, ev) => ev.type === 'play' && _getCardType(ev.cardNo).includes('デジモン'),
  play_option:  (params, ev) => ev.type === 'play' && _getCardType(ev.cardNo).includes('オプション'),
  play_tamer:   (params, ev) => ev.type === 'play' && _getCardType(ev.cardNo).includes('テイマー'),

  // アタック関連
  attack_declared: (params, ev) => ev.type === 'attack_declared',
  attack_resolved: (params, ev) => ev.type === 'attack_resolved',
  direct_attack:   (params, ev) => ev.type === 'attack_declared' && ev.isDirect === true,
  block:           (params, ev) => ev.type === 'block',

  // 効果
  use_effect:        (params, ev) => ev.type === 'use_effect',
  effect_triggered:  (params, ev) => ev.type === 'effect_triggered',
  security_effect:   (params, ev) => ev.type === 'security_effect',

  // 特殊
  security_zero: (params, ev) =>
    ev.type === 'security_reduced' && ev.side === 'opponent' && (ev.remaining ?? -1) === 0,
  card_detail_closed: (params, ev) => ev.type === 'card_detail_closed',
  mulligan_accepted: (params, ev) => ev.type === 'mulligan_accepted',

  // 既存の進行系（互換維持）
  turn_end: (params, ev) => {
    if (ev.type !== 'turn_end') return false;
    const wantSide = params.side || 'player';
    return wantSide === 'any' || ev.side === wantSide;
  },
  turn_start: (params, ev) => {
    if (ev.type !== 'turn_start') return false;
    const wantSide = params.side || 'player';
    return wantSide === 'any' || ev.side === wantSide;
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

    // 割り込み制御
    this._interruptResolve = null; // checkInterrupt の Promise resolve
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

    // フェーズ説明ポップアップ（showPhaseGuide=true のシナリオ）
    if (this.scenario.showPhaseGuide) {
      if (!this._shownPhases[phaseKey]) {
        this._shownPhases[phaseKey] = true;
        if (typeof window._tutorialShowPhaseGuide === 'function') {
          await window._tutorialShowPhaseGuide(phaseKey);
        }
      }
    }

    // 該当フェーズのブロックをアクティブにする
    this._tryActivatePhaseBlock(phaseKey);
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

    // 該当する割り込みブロックを探す
    const blockIdx = this._flow.findIndex((b, i) =>
      b.phase === '_trigger' &&
      b.trigger === triggerKey &&
      (b.turn || 1) === turn &&
      !this._completedBlocks.has(i)
    );
    if (blockIdx < 0) return; // 該当なし → 即return

    // ブロックのステップを順番に実行して完了を待つ
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

    // 相手ターン開始時: 相手AIスクリプトを実行
    if (type === 'turn_start' && ev.side === 'ai' && this.opponentScriptRunner) {
      const turnNumber = (window.bs && window.bs.turn) || 1;
      try { this.opponentScriptRunner.runTurn(turnNumber, () => {}); }
      catch (e) { console.error('[TutorialRunner] opponent script error:', e); }
    }

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
    const turn = this._currentTurn;
    // 該当フェーズ＋ターンのブロックを探す（未完了のもの）
    const blockIdx = this._flow.findIndex((b, i) =>
      b.phase === phaseKey &&
      b.phase !== '_trigger' &&
      (b.turn || 1) === turn &&
      !this._completedBlocks.has(i)
    );
    if (blockIdx < 0) return; // 該当なし

    this._activateBlock(blockIdx);
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
    // ただし mulligan_accepted のような UI ボタン押下系は演出を抑制
    const step = this._currentBlock && this._currentBlock.steps[this._currentStepIdx];
    const condType = step && step.advanceCondition && step.advanceCondition.type;
    const SILENT_CONDITIONS = ['mulligan_accepted'];
    const silent = SILENT_CONDITIONS.includes(condType);
    if (step && step.stepType === 'action' && !silent) {
      const successMessages = ['OK!', 'GREAT!', 'NICE!', 'PERFECT!'];
      const msg = successMessages[Math.min(this._currentStepIdx, successMessages.length - 1)];
      if (typeof window._tutorialShowSuccess === 'function') {
        window._tutorialShowSuccess(msg);
      }
    }

    this._currentStepIdx++;
    if (!this._currentBlock || this._currentStepIdx >= (this._currentBlock.steps || []).length) {
      this._completeCurrentBlock();
      return;
    }
    // 次のステップ表示（少し間を置く）
    setTimeout(() => this._showCurrentStep(), step && step.stepType === 'action' ? 800 : 100);
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
    }
  }

  // 割り込みブロックのステップを全実行して完了を待つ
  _runBlockSteps(blockIdx) {
    return new Promise(resolve => {
      this._interruptResolve = resolve;
      this._activateBlock(blockIdx);

      // ブロックにステップがなかった場合（即complete済み）
      if (!this._currentBlock) {
        this._interruptResolve = null;
        resolve();
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
      if (!password || !scenarioId) return;
      await gasPost('saveTutorialProgress', { playerName, password, scenarioId });
    } catch (e) {
      console.error('[TutorialRunner] 進捗保存失敗:', e);
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

    // セキュリティ枚数調整
    const adjustSecurity = (side, want) => {
      if (typeof want !== 'number') return;
      const s = bs[side];
      while (s.security.length > want && s.security.length > 0) s.security.pop();
      while (s.security.length < want && s.deck.length > 0) s.security.push(s.deck.shift());
    };
    adjustSecurity('player', ib.playerSecurityCount);
    adjustSecurity('ai', ib.opponentSecurityCount);

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

    // デッキトップ指定
    if (Array.isArray(ib.playerDeckTop) && ib.playerDeckTop.length) {
      const top = this._resolveCardRefs(ib.playerDeckTop);
      bs.player.deck = [...top, ...bs.player.deck];
    }
    if (Array.isArray(ib.opponentDeckTop) && ib.opponentDeckTop.length) {
      const top = this._resolveCardRefs(ib.opponentDeckTop);
      bs.ai.deck = [...top, ...bs.ai.deck];
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
    this.hideInstruction();
    if (this._interruptResolve) {
      this._interruptResolve();
      this._interruptResolve = null;
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

  runTurn(turnNumber, done) {
    if (this.executedTurns[turnNumber]) { done && done(); return; }
    this.executedTurns[turnNumber] = true;
    const entry = this.script.find(t => Number(t.turn) === Number(turnNumber));
    if (!entry || !Array.isArray(entry.actions) || entry.actions.length === 0) {
      done && done();
      return;
    }
    this._runActions(entry.actions, 0, done);
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
        case 'play': {
          if (bs && action.cardNo) {
            const idx = bs.ai.hand.findIndex(c => c && c.cardNo === action.cardNo);
            if (idx >= 0) {
              const card = bs.ai.hand.splice(idx, 1)[0];
              card.summonedThisTurn = true;
              bs.ai.battleArea.push(card);
              log('相手が「' + card.name + '」をプレイ');
              if (typeof window.renderAll === 'function') window.renderAll();
            }
          }
          cb(); break;
        }
        case 'evolve': {
          if (bs && action.sourceCardNo && action.targetCardNo) {
            const slotIdx = bs.ai.battleArea.findIndex(c => c && c.cardNo === action.sourceCardNo);
            const handIdx = bs.ai.hand.findIndex(c => c && c.cardNo === action.targetCardNo);
            if (slotIdx >= 0 && handIdx >= 0) {
              const base = bs.ai.battleArea[slotIdx];
              const evo  = bs.ai.hand.splice(handIdx, 1)[0];
              evo.stack = [...(base.stack || []), base];
              evo.suspended = base.suspended;
              bs.ai.battleArea[slotIdx] = evo;
              log('相手が「' + base.name + '」→「' + evo.name + '」に進化');
              if (typeof window.renderAll === 'function') window.renderAll();
            }
          }
          cb(); break;
        }
        case 'attack_security':
        case 'attack_digimon': {
          log('[未実装] 相手アタック: ' + action.type);
          console.warn('[OpponentScriptRunner] attack action not fully implemented:', action);
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
