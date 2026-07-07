// 効果エンジン v2（効果辞書 + 効果アクション辞書 参照）
import { gasGet } from './firebase-config.js';
import { getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

// ===== 辞書データ =====
let _triggerDict = [];  // 効果辞書（トリガー定義）
let _actionDict = [];   // 効果アクション辞書（アクション・対象・条件・持続・判定）

// ===== 効果キュー =====
let _effectQueue = [];

// ===== 持続コードの正規化 =====
// レシピ JSON 由来の duration を内部コードに揃えるユーティリティ
//   undefined/空 → undefined
//   既に 'dur_' で始まる → そのまま (例: 'dur_this_turn')
//   それ以外      → 'dur_' を前置 (例: 'this_turn' → 'dur_this_turn')
// 使用箇所: dp_plus / grant_keyword 等の duration 参照時、ctx.block.duration への正規化
function normalizeRecipeDuration(d) {
  if (d === undefined || d === null || d === '') return undefined;
  const s = String(d).trim();
  if (s === '') return undefined;
  if (s.startsWith('dur_')) return s;
  return 'dur_' + s;
}

// ===== 辞書読み込み =====
// 統合「効果辞書」(コード/種類/表示名/演出タイプ...) と旧2分割辞書 両方対応
export async function loadAllDictionaries() {
  try {
    const data = await gasGet('getEffectDictionary');
    const all = Array.isArray(data) ? data : [];
    // 統合辞書 判定: 'コード' or '種類' 列を持つ
    const isUnified = all.length > 0 && (
      Object.prototype.hasOwnProperty.call(all[0], 'コード') ||
      Object.prototype.hasOwnProperty.call(all[0], '種類')
    );
    if (isUnified) {
      // 統合版: 種類列で振り分け
      _triggerDict = all.filter(e => {
        const k = String(e['種類']||'').trim();
        return k === 'trigger' || k === 'continuous' || k === 'condition' || k === 'limit' || k === 'duration' || k === 'target' || k === '';
      });
      _actionDict = all.filter(e => String(e['種類']||'').trim() === 'action');
      // 後方互換: getActionUI が 'アクションコード' を見るので 'コード' をコピー
      _actionDict.forEach(e => {
        if (!e['アクションコード'] && e['コード']) e['アクションコード'] = e['コード'];
      });
      // trigger も '処理コード' を補完
      _triggerDict.forEach(e => {
        if (!e['処理コード'] && e['コード']) e['処理コード'] = e['コード'];
      });
      console.log('[EffectEngine] 統合辞書ロード: trigger=' + _triggerDict.length + ' action=' + _actionDict.length);
    } else {
      // 旧仕様: 効果辞書 + 効果アクション辞書 の2分割
      _triggerDict = all;
      try {
        const actions = await gasGet('getEffectActionDictionary');
        _actionDict = actions || [];
      } catch(_) { _actionDict = []; }
      console.log('[EffectEngine] 旧仕様辞書ロード: trigger=' + _triggerDict.length + ' action=' + _actionDict.length);
    }
  } catch(e) {
    console.error('[EffectEngine] 辞書読み込みエラー:', e);
  }
}

// アクションコードからUI情報を取得
// 統合辞書 'コード' / 旧 'アクションコード' 両対応
function getActionUI(actionCode) {
  if (!actionCode) return null;
  // ロジック alias: 同コードに 'ロジックコード' が定義されてればそちらの行を返す
  const target = String(actionCode).trim();
  for (const entry of _actionDict) {
    const code = String(entry['アクションコード']||entry['コード']||'').trim();
    if (code === target) return entry;
  }
  return null;
}

// ロジック alias 解決: 辞書に 'ロジックコード' 列があれば既存ロジックに alias
// 例: 新 'dp_plus_strong' のロジックコード='dp_plus' → switch では 'dp_plus' として扱う
function resolveLogicCode(actionCode) {
  const ui = getActionUI(actionCode);
  if (!ui) return actionCode;
  const alias = String(ui['ロジックコード']||'').trim();
  return alias || actionCode;
}

// ===== 効果キュー管理 =====

// キューをクリア
function clearQueue() { _effectQueue = []; }

// キューにエントリを追加
function addToQueue(card, block, side, priority, actualSide) {
  const triggerCode = block.trigger?.code;
  // 同じカード+同じトリガー+同じ効果テキストが既にキューにあればスキップ
  // 注意1: 進化元効果は異なるカード由来でも同じ親カードで登録されるため、
  //         blockのraw(効果テキスト)も比較して区別する
  // 注意2: 同名・同効果テキストの進化元カードが2枚以上ある場合（例: トゲモン+パルモンが同時に
  //         進化元）、両方を別エントリとして扱う必要があるため _recipeCard の同一性も比較する
  const blockRaw = block.raw || '';
  const blockRecipeCard = block._recipeCard || null;
  // 付与効果(grant_effect)由来は _grantedSteps の同一性も比較する
  // （カード本来の同トリガー効果と別エントリ扱いにするため）
  const blockGrantedSteps = block._grantedSteps || null;
  const isDuplicate = _effectQueue.some(e =>
    e.block.trigger?.code === triggerCode &&
    (e.card === card || (e.card.name === card.name && e.card.cardNo === card.cardNo)) &&
    (e.block.raw || '') === blockRaw &&
    (e.block._recipeCard || null) === blockRecipeCard &&
    (e.block._grantedSteps || null) === blockGrantedSteps
  );
  if (isDuplicate) {
    return;
  }
  _effectQueue.push({ card, block, side, priority: priority || 'normal', status: 'waiting', actualSide });
}

// キューをルールに従いソート
function sortQueue() {
  _effectQueue.sort((a, b) => {
    if (a.priority === 'interrupt' && b.priority !== 'interrupt') return -1;
    if (b.priority === 'interrupt' && a.priority !== 'interrupt') return 1;
    if (a.side === 'turnPlayer' && b.side !== 'turnPlayer') return -1;
    if (b.side === 'turnPlayer' && a.side !== 'turnPlayer') return 1;
    if (!a.block.isOptional && b.block.isOptional) return -1;
    if (a.block.isOptional && !b.block.isOptional) return 1;
    return 0;
  });
}

// キュー処理メインループ
// 対象選択・コスト等でプレイヤー入力が必要なアクション
var MANUAL_INPUT_ACTIONS = {
  'destroy': 1, 'bounce': 1, 'evo_discard': 1, 'evo_discard_bottom': 1,
  'cost_discard': 1, 'cost_trash_self': 1, 'cost_digiburst': 1,
  'select': 1, 'select_multi': 1, 'select_evo_source': 1,
  'place_under_tamer': 1, 'place_under_digimon': 1, 'place_on_security_top': 1,
  'jogress_evolve': 1, 'app_gattai_evolve': 1, 'return_deck': 1,
  'add_to_hand': 1, 'security_trash_select': 1,
  'place_from_trash_under': 1, 'place_from_hand_battle_under': 1,
  'rest': 1, 'rest_chain': 1, 'cant_attack': 1, 'cant_block': 1, 'cant_attack_block': 1,
  'cant_evolve': 1, 'change_attack_target': 1,
  'trash_to_hand': 1, 'summon_from_trash': 1, 'summon': 1,
  'dedigivolve': 1, 'deck_open': 1, 'force_block': 1,
};

// キューエントリがプレイヤー入力（対象選択・コスト等）を必要とするか
function _entryNeedsUserInput(entry, ctx) {
  if (!entry || !entry.card) return true;
  const triggerCode = entry.block && entry.block.trigger && entry.block.trigger.code;
  if (!triggerCode) return true;
  const isEvoSource = !!(entry.block && entry.block._recipeCard);
  const recipeCard = (entry.block && entry.block._recipeCard) || entry.card;
  let recipe = null;
  try {
    if (recipeCard && recipeCard.recipe) {
      const raw = typeof recipeCard.recipe === 'string'
        ? recipeCard.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')
        : recipeCard.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      recipe = isEvoSource ? (r.evo_source && r.evo_source[triggerCode]) : r[triggerCode];
    }
  } catch(_) {}
  if (!recipe || !Array.isArray(recipe) || recipe.length === 0) return true;
  return recipe.some(step => {
    if (Array.isArray(step.cost) && step.cost.length > 0) return true;
    if (step.optional === true) return true;
    if (step.action && MANUAL_INPUT_ACTIONS[step.action]) return true;
    if (step.target) {
      const t = String(step.target);
      if (t === 'self') return false;
      if (/^(own|opponent):all$/.test(t)) return false;
      if (/^target_(self|all_own|all_opponent|all_own_security|battle_opponent)/.test(t)) return false;
      if (/^(own|opponent):(\d+|up_to_\d+)$/.test(t)) return true;
      if (/^target_/.test(t)) return true;
    }
    return false;
  });
}

// キュー内のエントリが「実際に発動可能か」を事前判定
// 主に limit_once_per_turn 済みの再発動を弾く
function _entryWillExecute(entry, ctx) {
  if (!entry || !entry.card || !ctx || !ctx.bs) return true;
  const triggerCode = entry.block && entry.block.trigger && entry.block.trigger.code;
  if (!triggerCode) return true;
  const isEvoSource = !!(entry.block && entry.block._recipeCard);
  const recipeCard = (entry.block && entry.block._recipeCard) || entry.card;
  let recipe = null;
  try {
    if (recipeCard.recipe) {
      const raw = typeof recipeCard.recipe === 'string'
        ? recipeCard.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')
        : recipeCard.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      recipe = isEvoSource ? (r.evo_source && r.evo_source[triggerCode]) : r[triggerCode];
    }
  } catch(_) {}
  if (!recipe || !Array.isArray(recipe) || recipe.length === 0) return true;
  // 少なくとも1つのstepが limit を超過していなければOK
  return recipe.some(step => {
    if (step.limit === 'once_per_turn' || step.limit === 'limit_once_per_turn') {
      const sourceId = (recipeCard.cardNo || recipeCard.name) || 'unknown';
      const carrierId = (entry.card.cardNo || entry.card.name) || 'unknown';
      const limitKey = sourceId + '@' + carrierId + '_recipe_' + step.action;
      if (ctx.bs._usedLimits && ctx.bs._usedLimits[limitKey]) return false;
    }
    return true;
  });
}

function processQueue(context, onComplete) {
  // ターン1回制限済みなど発動不可なエントリは完了扱いにスキップ
  _effectQueue.filter(e => e.status === 'waiting').forEach(e => {
    if (!_entryWillExecute(e, context)) {
      e.status = 'completed';
      const cn = (e.card && e.card.name) ? e.card.name : '?';
      context.addLog && context.addLog('⏸ 「' + cn + '」はターン1回制限により発動しません');
    }
  });
  const waiting = _effectQueue.filter(e => e.status === 'waiting');
  if (waiting.length === 0) {
    clearQueue();
    // 消滅処理 → on_destroy リアクション完了を待つ
    checkPendingDestroys(context, () => {
      // メモリー超過チェック
      if (context._memoryOverflow) {
        context._memoryOverflow = false;
        if (context._parentContext) context._parentContext._memoryOverflow = false;
        // アタック中の場合はバトル完了後にターン終了する（フラグだけ立てる）
        context.bs._pendingTurnEnd = true;
        context.addLog('💾 メモリーが相手側へ（アタック終了後にターン終了）');
        context.updateMemGauge();
      }
      onComplete && onComplete();
    });
    return;
  }

  // === 同レベル(同priority/同side/同optional)のwaiting が複数あり、
  //     かつローカルプレイヤー側なら順序選択UIを出す ===
  const head = waiting[0];
  const sameLevel = waiting.filter(e =>
    e.priority === head.priority &&
    e.side === head.side &&
    !!e.block.isOptional === !!head.block.isOptional
  );
  // ローカルプレイヤー判定: bs.isPlayerTurn と side('turnPlayer'/'nonTurnPlayer') から導出
  const isPlayerTurn = !!(context.bs && context.bs.isPlayerTurn);
  const isLocalSide = (head.side === 'turnPlayer' && isPlayerTurn) || (head.side === 'nonTurnPlayer' && !isPlayerTurn);

  // 同レベル内で「自動発動」を「手動入力必要」より先に実行する
  const sameLevelAutos = sameLevel.filter(e => !_entryNeedsUserInput(e, context));
  const sameLevelManuals = sameLevel.filter(e => _entryNeedsUserInput(e, context));
  // 自動が残っていれば自動を優先実行
  let next = null;
  if (sameLevelAutos.length > 0) {
    next = sameLevelAutos[0];
  } else if (sameLevelManuals.length > 1 && isLocalSide) {
    // 手動が複数残った → 順序選択UI
    showQueueOrderSelect(sameLevelManuals, (chosenIdx) => {
      const chosen = sameLevelManuals[chosenIdx];
      chosen.status = 'processing';
      executeQueueEntry(chosen, context, () => {
        chosen.status = 'completed';
        sortQueue();
        if (window._sendMemoryUpdate) try { window._sendMemoryUpdate(); } catch(_) {}
        checkPendingDestroys(context, () => {
          processQueue(context, onComplete);
        });
      });
    });
    return;
  } else {
    next = waiting[0]; // 手動1件 or 非ローカル → 通常処理
  }

  next.status = 'processing';
  executeQueueEntry(next, context, () => {
    next.status = 'completed';
    sortQueue();
    // ★ 各効果の完了直後に消滅判定 → on_destroy リアクションを処理
    // 加えてメモリー値が効果でズレている可能性に備え必ずメモリー同期も送る
    if (window._sendMemoryUpdate) try { window._sendMemoryUpdate(); } catch(_) {}
    checkPendingDestroys(context, () => {
      processQueue(context, onComplete);
    });
  });
}

// ===== キュー順序選択UI =====
// 同レベルで誘発した効果が複数ある時、プレイヤーがどれを先に発動するか選択する
function showQueueOrderSelect(entries, callback) {
  const overlay = document.createElement('div');
  overlay.id = '_queue-order-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:20px;animation:fadeIn 0.2s ease;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;margin-bottom:14px;text-shadow:0 0 8px #00fbff;';
  title.innerText = '⚡ どの効果から使用しますか？';
  overlay.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'color:#aaa;font-size:11px;margin-bottom:14px;';
  subtitle.innerText = entries.length + '件の効果が同時に誘発しました。発動順を選んでください。';
  overlay.appendChild(subtitle);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:90%;';
  overlay.appendChild(row);

  entries.forEach((entry, idx) => {
    const carrier = entry.card;
    // 進化元効果の場合は _recipeCard が効果を持つ進化元カード本体
    const fromEvo = !!(entry.block && entry.block._recipeCard);
    const effectOwner = (entry.block && entry.block._recipeCard) || carrier;
    const div = document.createElement('div');
    div.style.cssText = 'background:#0a0a0a;border:2px solid #00fbff;border-radius:10px;padding:10px;width:200px;cursor:pointer;text-align:center;transition:transform 0.15s ease, box-shadow 0.15s ease;';
    div.onmouseenter = () => { div.style.transform = 'translateY(-3px) scale(1.03)'; div.style.boxShadow = '0 0 18px #00fbff'; };
    div.onmouseleave = () => { div.style.transform = ''; div.style.boxShadow = ''; };
    // 画像・名前は「効果を持つカード本体」を表示（進化元効果なら進化元カード）
    const imgSrc = effectOwner.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(effectOwner) : '') || effectOwner.imageUrl || '';
    const effText = (fromEvo && effectOwner.evoSourceEffect && effectOwner.evoSourceEffect !== 'なし')
      ? effectOwner.evoSourceEffect
      : ((entry.block && entry.block.raw) || effectOwner.effect || '');
    div.innerHTML =
      (imgSrc ? '<img src="'+imgSrc+'" style="width:120px;border-radius:6px;margin-bottom:8px;border:1px solid #00fbff;">' : '')
      + '<div style="color:#fff;font-size:12px;font-weight:bold;margin-bottom:6px;">'+(effectOwner.name||'')+'</div>'
      + '<div style="color:#aaf;font-size:10px;line-height:1.5;text-align:left;max-height:80px;overflow-y:auto;background:#111;padding:6px;border-radius:4px;">'+effText+'</div>';
    div.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      callback(idx);
    };
    row.appendChild(div);
  });

  document.body.appendChild(overlay);
}

// キューエントリを実行
function executeQueueEntry(entry, context, callback) {
  const { card, block, side } = entry;
  // sideを実際のplayer/aiに変換
  const actualSide = entry.actualSide || (side === 'turnPlayer' ? (context.bs.isPlayerTurn ? 'player' : 'ai') : (context.bs.isPlayerTurn ? 'ai' : 'player'));
  const ctx = { ...context, card, side: actualSide, block, _parentContext: context };

  // 効果発動 → カード&効果テキストを数秒表示してから実行
  function executeWithAnnounce() {
    // 進化元由来の効果なら、進化元カードを announce に渡して表示を分かりやすくする
    const evoSourceCard = block && block._recipeCard;
    if (evoSourceCard) {
      ctx.addLog('⚡ 「' + card.name + '」の進化元【' + evoSourceCard.name + '】の効果発動');
    } else {
      ctx.addLog('⚡ 「' + card.name + '」の効果発動');
    }
    showEffectAnnounce(card, block.raw, actualSide, () => {
      // 効果完了時に相手のオーバーレイを閉じるコールバック（対象選択で既に閉じた場合は不要だが安全のため送る）
      const wrappedCallback = () => {
        if (window._isOnlineMode && window._isOnlineMode() && actualSide === 'player') {
          // 残っていれば閉じる（対象選択で既にcleanupから送信済みの場合はDOMが無いので影響なし）
          window._onlineSendCommand({ type: 'fx_effectClose' });
        }
        callback();
      };
      // レシピがあればレシピ実行、なければ従来処理
      // 進化元効果のレシピは _recipeCard に格納されている → inEvoSource=true で参照
      const recipeCard = block._recipeCard || card;
      const isEvoSourceLookup = !!block._recipeCard;
      const trigCode = block.trigger ? block.trigger.code : null;
      const recipe = block._grantedSteps || getRecipeForTrigger(recipeCard, trigCode, isEvoSourceLookup);
      if (recipe) {
        runRecipe(recipe, ctx, wrappedCallback);
      } else {
        executeCostAndActions(block, ctx, () => executeAfterActions(block, ctx, wrappedCallback));
      }
    }, evoSourceCard);
  }

  // 条件チェック（cond_exists等）
  if (block.conditions && block.conditions.length > 0) {
    if (!checkConditions(block.conditions, card, context.bs, actualSide)) {
      callback();
      return;
    }
  }

  // ターンに1回制限チェック
  if (block.limit) {
    if (!context.bs._usedLimits) context.bs._usedLimits = {};
    const limitKey = (card.cardNo || card.name) + '_' + (block.trigger ? block.trigger.code : 'unknown');
    if (context.bs._usedLimits[limitKey]) {
      ctx.addLog('⚠ 「' + card.name + '」はこのターン既に発動済み');
      callback();
      return;
    }
    context.bs._usedLimits[limitKey] = true;
  }

  // ★ 事前条件チェック: レシピの全ステップが条件で弾かれるなら効果発動ポップアップを出さない
  // 例: 石田ヤマトの「進化元を持たない相手デジモンがいるとき、メモリー+1」で
  //     条件を満たす相手デジモンがいない場合、ポップアップ自体を出さない
  {
    const recipeCardForCheck = block._recipeCard || card;
    const isEvoSourceCheck = !!block._recipeCard;
    const trigCodeForCheck = block.trigger ? block.trigger.code : null;
    const recipeForCheck = block._grantedSteps || (trigCodeForCheck ? getRecipeForTrigger(recipeCardForCheck, trigCodeForCheck, isEvoSourceCheck) : null);
    if (recipeForCheck && Array.isArray(recipeForCheck)) {
      // block を渡す: trigger_conditions を発火元カード(_eventSourceCard)に対して評価するため
      const willExecute = recipeWillExecuteAnything(recipeForCheck, { card, bs: context.bs, side: actualSide, block });
      if (!willExecute) {
        callback();
        return;
      }
    }
  }

  // recipe を見て任意効果か判定（コストを持つ / optional フラグ）→ 確認ダイアログの要否
  // 「手札を3枚破棄することで〜」等のコスト持ち効果は任意発動なので確認を挟む
  if (block.isOptional === undefined) {
    const _optRc = block._recipeCard || card;
    const _optTc = block.trigger ? block.trigger.code : null;
    const _optRecipe = block._grantedSteps || (_optTc ? getRecipeForTrigger(_optRc, _optTc, !!block._recipeCard) : null);
    block.isOptional = Array.isArray(_optRecipe) && _optRecipe.some(s =>
      s && (s.optional === true || (Array.isArray(s.cost) && s.cost.length > 0))
    );
  }

  // 強制効果 or 既に確認済み → 即実行
  if (!block.isOptional || context.alreadyConfirmed) {
    executeWithAnnounce();
    return;
  }

  // 任意効果 → 確認ダイアログ
  // B画面: fx_confirmShow → Aが「はい」→ fx_confirmClose → fx_effectAnnounce（処理中表示）
  //                        → Aが「いいえ」→ fx_confirmClose(accepted:false) → 「発動しませんでした」
  showConfirmDialog(card, block.raw, (accepted) => {
    if (accepted) {
      executeWithAnnounce();
    } else {
      // 「いいえ」→ 相手に「効果を発動しませんでした」を通知
      if (window._isOnlineMode && window._isOnlineMode() && actualSide === 'player') {
        window._onlineSendCommand({ type: 'fx_effectDeclined', cardName: card.name });
      }
      executeAfterActions(block, ctx, callback);
    }
  });
}

function executeAfterActions(block, ctx, callback) {
  if (block.afterActions && block.afterActions.length > 0) {
    runActionList(block.afterActions, block.afterTarget, ctx, callback);
  } else {
    callback && callback();
  }
}

function executeCostAndActions(block, ctx, callback) {
  // アクションが空 → 効果不発
  if (!block.actions || block.actions.length === 0) {
    ctx.addLog('⚠ 効果が発動しませんでした');
    showEffectFailed('効果を発動できませんでした', callback);
    return;
  }
  if (block.cost && block.cost.length > 0) {
    runActionList(block.cost, block.costTarget, ctx, (success) => {
      if (success === false) { ctx.addLog('⚠ コスト条件を満たせず効果不発'); showEffectFailed('効果を発動できませんでした', callback); return; }
      runActionList(block.actions, block.target, ctx, callback);
    });
  } else {
    runActionList(block.actions, block.target, ctx, callback);
  }
}

// ===== オンライン効果結果通知 =====
// 選択効果の結果（カード画像＋アクション）を相手に送信
function sendEffectResult(card, actionType, ctx) {
  if (!window._isOnlineMode || !window._isOnlineMode()) return;
  if (ctx.side !== 'player') return; // 自分の効果のみ送信
  const imgSrc = card ? (card.imgSrc || getCardImageUrl(card) || '') : '';
  const labels = { summon: '登場！', destroy: '消滅！', bounce: '手札に戻す！', rest: 'レスト！', active: 'アクティブ！', evolve: '進化！', recover: 'リカバリー！', dp_plus: 'DP強化！', dp_minus: 'DP弱体化！' };
  window._onlineSendCommand({
    type: 'fx_effectResult',
    cardName: card ? card.name : '',
    cardImg: imgSrc,
    actionType: actionType,
    actionLabel: labels[actionType] || actionType
  });
}

// ===== アクション実行 =====

function runActionList(actions, defaultTarget, ctx, callback) {
  // per_count倍率を適用
  const appliedActions = applyPerCountMultiplier(actions, ctx);
  let idx = 0;
  function next() {
    if (idx >= appliedActions.length) { callback && callback(); return; }
    runOneAction(appliedActions[idx++], defaultTarget, ctx, next);
  }
  next();
}

// per_count条件があれば倍率を計算してアクションのvalueに適用
function applyPerCountMultiplier(actions, ctx) {
  const block = ctx.block;
  if (!block || !block.conditions) return actions;
  const perCond = block.conditions.find(c => c.code === 'per_count');
  if (!perCond || !perCond.value) return actions;

  const n = perCond.value; // N枚ごと
  const refSource = perCond.refSource || 'evo_source';
  const count = getRefSourceCount(refSource, ctx);
  const multiplier = Math.floor(count / n);

  if (multiplier <= 0) return actions;

  // 各アクションのvalueに倍率を掛ける（valueがあるもののみ）
  return actions.map(a => {
    if (a.value != null && a.value > 0) {
      return { ...a, value: a.value * multiplier };
    }
    return a;
  });
}

// 参照先の枚数を取得（ctx版 - runActionList用）
function getRefSourceCount(refSource, ctx) {
  return getRefSourceCountDirect(refSource, ctx.card, ctx.bs, ctx.side);
}

// 参照先の枚数を取得（直接指定版 - calcPerCountValue用）
function getRefSourceCountDirect(refSource, card, bs, side, refFilter, refStateStr) {
  const player = side === 'player' ? bs.player : bs.ai;
  const opponent = side === 'player' ? bs.ai : bs.player;
  // refFilter (色/タイプ/特徴/Lv 等) を適用してカウント
  const hasFilter = refFilter && typeof refFilter === 'object' && Object.keys(refFilter).length > 0;
  // refStateStr ("cond_self_rest" 等) を checkConditions で評価
  const stateConds = refStateStr ? parseRecipeCondition(String(refStateStr)) : null;
  function passesState(c) {
    if (!stateConds) return true;
    return checkConditions(stateConds, c, bs, side);
  }
  function countWith(arr) {
    let result = arr.filter(c => c && passesState(c));
    if (!hasFilter) return result.length;
    if (typeof cardMatchesFilter === 'function') {
      return result.filter(c => cardMatchesFilter(c, refFilter)).length;
    }
    // フォールバック: 主要フィルタを手書き判定
    return result.filter(c => {
      if (refFilter.color && String(c.color || '') !== refFilter.color) return false;
      if (refFilter.type && String(c.type || '') !== refFilter.type) return false;
      if (refFilter.lv_le !== undefined && parseInt(c.level || c.Lv || c.lv) > refFilter.lv_le) return false;
      if (refFilter.lv_ge !== undefined && parseInt(c.level || c.Lv || c.lv) < refFilter.lv_ge) return false;
      if (refFilter.dp_le !== undefined && (c.dp || 0) > refFilter.dp_le) return false;
      if (refFilter.dp_ge !== undefined && (c.dp || 0) < refFilter.dp_ge) return false;
      if (refFilter.feature_contains && String(c.feature || '').indexOf(refFilter.feature_contains) < 0) return false;
      if (refFilter.name_contains && String(c.name || '').indexOf(refFilter.name_contains) < 0) return false;
      return true;
    }).length;
  }
  switch (refSource) {
    // --- 自分側 ---
    case 'evo_source':         return countWith(card && card.stack ? card.stack : []);
    case 'hand':               return countWith(player.hand);
    case 'trash':              return countWith(player.trash);
    case 'security':           return countWith(player.security);
    case 'battle_area':        return countWith(player.battleArea.filter(c => c !== null));
    case 'own_hand':           return countWith(player.hand);
    case 'own_trash':          return countWith(player.trash);
    case 'own_security':       return countWith(player.security);
    case 'own_battle_area':    return countWith(player.battleArea.filter(c => c !== null));
    case 'own_digimon':        return countWith(player.battleArea.filter(c => c && c.type === 'デジモン'));
    case 'own_rest_digimon':   return countWith(player.battleArea.filter(c => c && c.type === 'デジモン' && c.suspended));
    case 'own_active_digimon': return countWith(player.battleArea.filter(c => c && c.type === 'デジモン' && !c.suspended));
    case 'own_tamer':          return countWith((player.tamerArea || []).filter(c => c !== null));
    // --- 相手側 ---
    case 'opp_hand':           return countWith(opponent.hand);
    case 'opp_trash':          return countWith(opponent.trash);
    case 'opp_security':       return countWith(opponent.security);
    case 'opp_battle_area':    return countWith(opponent.battleArea.filter(c => c !== null));
    case 'opp_digimon':          return countWith(opponent.battleArea.filter(c => c && c.type === 'デジモン'));
    case 'opp_rest_digimon':     return countWith(opponent.battleArea.filter(c => c && c.type === 'デジモン' && c.suspended));
    case 'opp_active_digimon':   return countWith(opponent.battleArea.filter(c => c && c.type === 'デジモン' && !c.suspended));
    case 'opp_no_evo_digimon':   return countWith(opponent.battleArea.filter(c => c && c.type === 'デジモン' && (!c.stack || c.stack.length === 0)));
    case 'opp_tamer':            return countWith((opponent.tamerArea || []).filter(c => c !== null));
    // 直前の rest 効果でレストさせた枚数（bs._lastRestCount に保存）
    case 'last_rest_count':      return (bs && bs._lastRestCount != null) ? bs._lastRestCount : 0;
    default: return 0;
  }
}

// ===== 演出システム（スプシの「演出タイプ」列で駆動） =====
//
// スプシの演出タイプ列の値 → 対応する演出関数を実行
// 新しい演出タイプを追加する場合: このマップに1行追加 + 演出関数を実装
//
// 演出関数の引数: (options, callback)
//   options: { card, value, color, ctx, targets } — アクションごとに必要な情報を渡す
//   callback: 演出完了後に呼ぶ

// キー名はスプシ「効果アクション辞書」の「演出タイプ」列と完全一致させる
// battle-fx.js の registerFxRunners() で実装に上書きされる
const EFFECT_RUNNERS = {
  "数値ポップアップ": function(opts, cb) {
    showDpPopup(opts.value || 0, opts.label || (opts.card && opts.card.name) || null);
    cb();
  },
  "消滅演出": function(opts, cb) {
    if (opts.ctx && opts.ctx.showDestroyEffect && opts.card) { opts.ctx.showDestroyEffect(opts.card, cb); } else { cb(); }
  },
  "ドロー演出": function(opts, cb) {
    if (opts.ctx && opts.ctx.showDrawEffect && opts.cards && opts.cards.length > 0) {
      let idx = 0;
      function showNext() { if (idx >= opts.cards.length) { cb(); return; } const c = opts.cards[idx++]; opts.ctx.showDrawEffect(c, parseInt(c.level) >= 6, showNext); }
      showNext();
    } else { cb(); }
  },
  "カード移動": function(opts, cb) { cb(); },
  "カード登場": function(opts, cb) { cb(); },
  "カード進化": function(opts, cb) { cb(); },
  "VS画面": function(opts, cb) { cb(); },
  "対象選択UI": function(opts, cb) { cb(); },
  "効果確認ダイアログ": function(opts, cb) { cb(); },
  "状態付与演出": function(opts, cb) { cb(); },
  "オープン演出": function(opts, cb) { cb(); },
  "アプ合体": function(opts, cb) { cb(); },
  "リンク演出": function(opts, cb) { cb(); },
  "文字ポップアップ": function(opts, cb) { cb(); },
  "ブロックダイアログ": function(opts, cb) { cb(); },
  "Sアタック+": function(opts, cb) { cb(); },
  "ジョグレス進化": function(opts, cb) { cb(); },
  "テキスト表示": function(opts, cb) {
    if (opts.text) {
      const el = document.createElement('div');
      el.innerText = opts.text;
      el.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:1.5rem;font-weight:bold;z-index:60000;pointer-events:none;color:#00fbff;text-shadow:0 0 15px #00fbff;animation:dpChangePopup 1.2s ease forwards;';
      document.body.appendChild(el);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1300);
    }
    cb();
  },
  "ゲージ移動": function(opts, cb) {
    if (opts.ctx && opts.ctx.updateMemGauge) opts.ctx.updateMemGauge();
    cb();
  },
};

/**
 * battle-fx.js の演出ランナーで EFFECT_RUNNERS を上書き
 * @param {Object} runners - getFxRunners() の戻り値
 */
export function registerFxRunners(runners) {
  if (!runners) return;
  Object.keys(runners).forEach(key => {
    EFFECT_RUNNERS[key] = runners[key];
  });
}

// アクションコードから辞書のUI情報を使って演出を実行
// 戻り値: true=演出実行した, false=演出なし
function playEffect(actionCode, options, callback) {
  const ui = getActionUI(actionCode);
  if (!ui) { callback(); return false; }
  const typeName = ui['演出タイプ'];
  if (!typeName || typeName === 'なし') { callback(); return false; }
  const runner = EFFECT_RUNNERS[typeName];
  if (!runner) { callback(); return false; }

  // 辞書の各列をoptionsに自動セット
  options.actionCode = actionCode;

  const fxCode = ui['演出コード'] || '';
  if (fxCode && fxCode !== 'なし') options.fxCode = fxCode;

  // 枠色
  if (ui['枠色'] && ui['枠色'] !== 'なし') {
    const colorMap = { '赤': '#ff4444', '緑': '#00ff88', 'シアン': '#00fbff', 'オレンジ': '#ff9900', '黄': '#ffaa00', '紫': '#aa66ff' };
    options.color = colorMap[ui['枠色']] || ui['枠色'];
  }

  runner(options, callback);
  return true;
}

// 辞書から枠色を取得するヘルパー
function getUIColor(actionCode, fallback) {
  const ui = getActionUI(actionCode);
  if (!ui || !ui['枠色'] || ui['枠色'] === 'なし') return fallback || '#ff4444';
  const colorMap = { '赤': '#ff4444', '緑': '#00ff88', 'シアン': '#00fbff', 'オレンジ': '#ff9900', '黄': '#ffaa00', '紫': '#aa66ff' };
  return colorMap[ui['枠色']] || fallback || '#ff4444';
}


function runOneAction(action, defaultTarget, ctx, callback) {
  const ui = getActionUI(action.code);
  const player = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
  const opponent = ctx.side === 'player' ? ctx.bs.ai : ctx.bs.player;
  const sideLabel = ctx.side === 'player' ? '自分' : '相手';
  // 演出タイプを辞書から取得（スプシの「演出タイプ」列）
  const effectTypeName = ui ? ui['演出タイプ'] : null;
  // 枠色を辞書から取得（スプシの「枠色」列）
  const uiColor = getUIColor(action.code, '#ff4444');
  // 対象選択UIに渡すサイド（opponent側のDOM行ID用: 'ai' or 'pl'）
  const opponentRowSide = ctx.side === 'player' ? 'ai' : 'pl';
  // store経由で対象が確定済みの場合、AI自動選択と同じパスを通す
  const autoSelect = ctx._forceTargetIdx !== undefined;
  const effectiveSide = autoSelect ? 'ai' : ctx.side;

  // ロジック alias 解決: 辞書に 'ロジックコード' が定義されていれば既存ロジックを再利用
  // 例: 新アクション 'dp_plus_strong' の 'ロジックコード'='dp_plus' → switch では dp_plus 扱い
  const dispatchCode = resolveLogicCode(action.code);

  switch (dispatchCode) {
    case 'draw': {
      const n = action.value || 1;
      const drawn = [];
      for (let i = 0; i < n; i++) {
        if (player.deck.length > 0) {
          const c = player.deck.splice(0, 1)[0];
          player.hand.push(c);
          drawn.push(c);
          ctx.addLog('🃏 「' + c.name + '」をドロー');
        }
      }
      // 演出: ctx.showDrawEffect があれば 1 枚ずつ流す（辞書未設定でも確実に演出する）
      if (drawn.length > 0 && ctx.showDrawEffect) {
        let di = 0;
        const showOne = () => {
          if (di >= drawn.length) { ctx.renderAll(true); callback(); return; }
          const c = drawn[di++];
          ctx.showDrawEffect(c, parseInt(c.level) >= 6, showOne);
        };
        showOne();
      } else { ctx.renderAll(true); callback(); }
      break;
    }
    case 'dp_plus': {
      const val = action.value || 0;
      const target = defaultTarget || { code: 'target_self' };
      applyDpBuff(val, true, target, ctx, callback);
      break;
    }
    case 'dp_minus': {
      const val = action.value || 0;
      // 対象フィルタ（Lv/色等）。rest 等と同じく action.conditions / ctx.block.conditions を見る
      const _dpmConds = (action && action.conditions) || (ctx.block && ctx.block.conditions) || [];
      const _dpmCondSide = ctx.side === 'player' ? 'ai' : 'player';
      const dpTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) {
        const _dc = opponent.battleArea[i];
        if (!_dc) continue;
        if (_dpmConds.length > 0 && !checkConditions(_dpmConds, _dc, ctx.bs, _dpmCondSide)) continue;
        dpTargets.push(i);
      }
      if(dpTargets.length === 0) { callback(); break; }
      // 対象数（opponent:N の N）。opponent:all は全体。未指定は1体。
      let dpNeed = 1;
      if (defaultTarget && defaultTarget.code === 'target_all_opponent') dpNeed = dpTargets.length;
      else if (defaultTarget && defaultTarget.count) dpNeed = defaultTarget.count;
      dpNeed = Math.min(dpNeed, dpTargets.length);
      // 相手カードへの buff をオンライン同期するヘルパー
      const sendDpRemoteBuff = (idx, tgt) => {
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && idx != null && window._onlineSendCommand) {
          const dur = (ctx.block && ctx.block.duration && ctx.block.duration.code) || 'dur_this_turn';
          window._onlineSendCommand({
            type: 'fx_remoteBuff',
            targetIdx: idx,
            targetName: tgt.name,
            buffType: 'dp_minus',
            value: val,
            duration: dur,
            appliedFromSender: 'player',
            appliedDuringOwnTurn: ctx.bs && ctx.bs.isPlayerTurn,
          });
        }
      };
      const applyDpMinus = (idx) => {
        const tgt = opponent.battleArea[idx];
        if (!tgt) return;
        addBuff(tgt, 'dp_minus', val, ctx);
        ctx.addLog('💥 ' + tgt.name + ' DP-' + val + ' → ' + tgt.dp);
        playEffect(action.code, { value: -val, ctx, label: tgt.name }, () => {});
        if(tgt.dp <= 0) tgt._pendingDestroy = true;
        sendDpRemoteBuff(idx, tgt);
      };
      if(effectiveSide === 'ai') {
        // AI: _forceTargetIdx を優先しつつ先頭から dpNeed 体に適用
        const dpPick = [];
        if (ctx._forceTargetIdx != null && dpTargets.indexOf(ctx._forceTargetIdx) >= 0) dpPick.push(ctx._forceTargetIdx);
        for (const di of dpTargets) { if (dpPick.length >= dpNeed) break; if (dpPick.indexOf(di) < 0) dpPick.push(di); }
        dpPick.forEach(applyDpMinus);
        ctx.renderAll(); callback(); break;
      }
      // プレイヤー: dpNeed 体を順に選択
      const dpRemain = dpTargets.slice();
      let dpPicked = 0;
      const pickDpNext = () => {
        if (dpPicked >= dpNeed || dpRemain.length === 0) { ctx.renderAll(); callback(); return; }
        ctx.addLog('🎯 DP-' + val + 'の対象を選んでください' + (dpNeed > 1 ? '（' + (dpPicked + 1) + '/' + dpNeed + '体目）' : ''));
        showTargetSelection(opponentRowSide, dpRemain.slice(), null, uiColor, (selectedIdx) => {
          if(selectedIdx !== null) {
            const tgt = opponent.battleArea[selectedIdx];
            sendEffectResult(tgt, 'dp_minus', ctx);
            applyDpMinus(selectedIdx);
            const ri = dpRemain.indexOf(selectedIdx);
            if (ri >= 0) dpRemain.splice(ri, 1);
            dpPicked++;
            ctx.renderAll();
            pickDpNext();
          } else {
            ctx.renderAll(); callback();
          }
        });
      };
      pickDpNext();
      break;
    }
    // === 元々のDPを value に変更（base override）。対象は self / opponent:N / own:N ===
    case 'dp': {
      const dpSetVal = parseInt(String(action.value ?? 0), 10) || 0;
      const dpsTgt = defaultTarget || { code: 'target_self' };
      const dpSetDur = (ctx.block && ctx.block.duration && ctx.block.duration.code) || 'dur_this_turn';
      const applyDpSet = (c, isOpp, idx) => {
        if (!c) return;
        // 既存の dp_set を除去してから「元々のDPを変更」buff を付与（最新が有効）
        if (Array.isArray(c.buffs)) c.buffs = c.buffs.filter(b => b.type !== 'dp_set');
        addBuffDirect(c, 'dp_set', dpSetVal, dpSetDur, ctx);
        ctx.addLog('💪 「' + c.name + '」の元々のDPを ' + dpSetVal + ' に変更 → ' + c.dp);
        if (isOpp && idx != null && window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
          window._onlineSendCommand({ type: 'fx_remoteBuff', targetIdx: idx, targetName: c.name, buffType: 'dp_set', value: dpSetVal, duration: dpSetDur, appliedFromSender: 'player', appliedDuringOwnTurn: ctx.bs && ctx.bs.isPlayerTurn });
        }
      };
      if (dpsTgt.code === 'target_self') {
        if (ctx.card) applyDpSet(ctx.card, false, null);
        ctx.renderAll(); callback(); break;
      }
      const dpsIsOpp = dpsTgt.code === 'target_opponent' || dpsTgt.code === 'target_all_opponent';
      const dpsPlayer = dpsIsOpp ? opponent : player;
      const dpsRow = dpsIsOpp ? opponentRowSide : (ctx.side === 'player' ? 'pl' : 'ai');
      const dpsValid = [];
      for (let i = 0; i < dpsPlayer.battleArea.length; i++) if (dpsPlayer.battleArea[i]) dpsValid.push(i);
      if (dpsValid.length === 0) { showEffectFailed('効果を発動できませんでした', callback); break; }
      let dpsNeed = (dpsTgt.code === 'target_all_opponent' || dpsTgt.code === 'target_all_own') ? dpsValid.length : (dpsTgt.count || 1);
      dpsNeed = Math.min(dpsNeed, dpsValid.length);
      if (effectiveSide === 'ai') {
        const dpsPick = [];
        if (ctx._forceTargetIdx != null && dpsValid.indexOf(ctx._forceTargetIdx) >= 0) dpsPick.push(ctx._forceTargetIdx);
        for (const i of dpsValid) { if (dpsPick.length >= dpsNeed) break; if (dpsPick.indexOf(i) < 0) dpsPick.push(i); }
        dpsPick.forEach(i => applyDpSet(dpsPlayer.battleArea[i], dpsIsOpp, i));
        ctx.renderAll(); callback(); break;
      }
      const dpsRemain = dpsValid.slice();
      let dpsPicked = 0;
      const pickDpSet = () => {
        if (dpsPicked >= dpsNeed || dpsRemain.length === 0) { ctx.renderAll(); callback(); return; }
        ctx.addLog('🎯 元々のDPを' + dpSetVal + 'にする対象を選んでください');
        showTargetSelection(dpsRow, dpsRemain.slice(), null, uiColor, (idx) => {
          if (idx !== null) {
            applyDpSet(dpsPlayer.battleArea[idx], dpsIsOpp, idx);
            const ri = dpsRemain.indexOf(idx);
            if (ri >= 0) dpsRemain.splice(ri, 1);
            dpsPicked++;
            ctx.renderAll();
            pickDpSet();
          } else { ctx.renderAll(); callback(); }
        });
      };
      pickDpSet();
      break;
    }
    case 'memory_plus': {
      const val = action.value || 1;
      if (ctx.side === 'player') ctx.bs.memory += val; else ctx.bs.memory -= val;
      ctx.addLog('💎 ' + sideLabel + 'のメモリー+' + val);
      // revert_at_turn_end:「このターン終了時メモリー-N」をターン終了処理用キューに積む
      // （オプションカード等、トラッシュ移動後に on_own_turn_end が走らないケースに対応）
      if (action.revert_at_turn_end && ctx.bs) {
        ctx.bs._turnEndMemoryShift = (ctx.bs._turnEndMemoryShift || 0) + (ctx.side === 'player' ? -val : val);
        ctx.addLog('⏳ このターン終了時にメモリー-' + val + '（' + sideLabel + '）');
      }
      ctx.updateMemGauge();
      if (window._sendMemoryUpdate) window._sendMemoryUpdate(); // 相手に即時通知
      ctx.renderAll();
      callback();
      break;
    }
    case 'memory_minus': {
      const val = action.value || 1;
      if (ctx.side === 'player') ctx.bs.memory -= val; else ctx.bs.memory += val;
      ctx.addLog('💎 ' + sideLabel + 'のメモリー-' + val);
      ctx.updateMemGauge();
      if (window._sendMemoryUpdate) window._sendMemoryUpdate(); // 相手に即時通知
      // メモリー超過チェック（効果処理は完了させてからターン終了）
      if (ctx.side === 'player' && ctx.bs.memory < 0) {
        ctx._memoryOverflow = true;
        if (ctx._parentContext) ctx._parentContext._memoryOverflow = true;
      }
      callback();
      break;
    }
    case 'destroy': {
      // target_own の場合は自分側のカードを対象にする（cost 用途で「自分のデジモン1体を消滅させる」等）
      const isOwn = defaultTarget && defaultTarget.code === 'target_own';
      const tgtPlayer = isOwn ? player : opponent;
      const tgtRowId = isOwn ? (ctx.side === 'player' ? 'pl' : 'ai') : opponentRowSide;
      // 条件フィルタ（cond_lv_le:4 等）を適用して対象を絞る
      // action.conditions（executeRecipeStepから直接渡されたもの）を優先、フォールバックで ctx.block.conditions
      const dConds = (action && action.conditions) || (ctx.block && ctx.block.conditions) || [];
      const _dSideTag = isOwn ? (ctx.side === 'player' ? 'player' : 'ai') : (ctx.side === 'player' ? 'ai' : 'player');
      const destroyTargets = [];
      for(let i=0;i<tgtPlayer.battleArea.length;i++) {
        const c = tgtPlayer.battleArea[i];
        if(!c) continue;
        // 条件フィルタ（cond_keyword / cond_lv_le / cond_no_evo 等）を checkConditions で一括評価
        if (dConds.length > 0 && !checkConditions(dConds, c, ctx.bs, _dSideTag)) continue;
        destroyTargets.push(i);
      }
      if(destroyTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', () => callback(false)); break; }
      // 枠色を辞書から取得
      const borderColor = uiColor;
      if(effectiveSide === 'ai') {
        const di = ctx._forceTargetIdx ?? destroyTargets[0];
        const card = tgtPlayer.battleArea[di];
        // 消滅演出 → doDestroy（on_destroy リアクション完了まで待つ）→ callback
        playEffect(action.code, { card, ctx }, () => {
          doDestroy(tgtPlayer, di, ctx, () => callback(true));
        });
        break;
      }
      ctx.addLog(isOwn ? '🎯 自分のデジモンから消滅させる対象を選んでください' : '🎯 消滅させる対象を選んでください');
      showTargetSelection(tgtRowId, destroyTargets, null, borderColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          const card = tgtPlayer.battleArea[selectedIdx];
          // 消滅演出 → doDestroy（on_destroy リアクション完了まで待つ）→ callback
          playEffect(action.code, { card, ctx }, () => {
            doDestroy(tgtPlayer, selectedIdx, ctx, () => callback(true));
          });
        } else {
          // target_own は cost 用途とみなし、キャンセル時は callback(false) で後続中止
          callback(isOwn ? false : undefined);
        }
      });
      break;
    }
    case 'bounce': {
      // target_opponent_suspended が指定されていればレスト状態のみフィルタ
      const onlySuspended = defaultTarget && defaultTarget.code === 'target_opponent_suspended';
      // 追加の条件フィルタ（Lv/DP等）。rest/dp_minus 等と同じく action.conditions / ctx.block.conditions を見る
      const _bounceConds = (action && action.conditions) || (ctx.block && ctx.block.conditions) || [];
      const _bounceCondSide = ctx.side === 'player' ? 'ai' : 'player';
      const bounceTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) {
        const c = opponent.battleArea[i];
        if (!c) continue;
        if (onlySuspended && !c.suspended) continue;
        if (_bounceConds.length > 0 && !checkConditions(_bounceConds, c, ctx.bs, _bounceCondSide)) continue;
        bounceTargets.push(i);
      }
      if(bounceTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      const bounceColor = uiColor;
      // 複数対象（opponent:N / opponent:up_to_N）
      const bounceNeed = (defaultTarget && defaultTarget.count) || 1;
      const bounceUpTo = !!(defaultTarget && defaultTarget.upTo);
      if (bounceNeed > 1 || bounceUpTo) {
        if (effectiveSide === 'ai') {
          const picks = bounceTargets.slice(0, bounceNeed);
          picks.forEach(idx => doBounce(opponent, idx, ctx));
          ctx.renderAll(); callback(); break;
        }
        const rowId = ctx.side === 'player' ? 'ai' : 'pl';
        pickUpToNTargets(rowId, bounceTargets, bounceNeed, bounceColor, (idxs) => {
          idxs.forEach(idx => {
            sendEffectResult(opponent.battleArea[idx], 'bounce', ctx);
            doBounce(opponent, idx, ctx);
          });
          callback();
        });
        break;
      }
      if(effectiveSide === 'ai') {
        doBounce(opponent, ctx._forceTargetIdx ?? bounceTargets[0], ctx);
        callback(); break;
      }
      ctx.addLog('🎯 手札に戻す対象を選んでください' + (onlySuspended ? '（レスト状態のみ）' : ''));
      showTargetSelection(opponentRowSide, bounceTargets, null, bounceColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          sendEffectResult(opponent.battleArea[selectedIdx], 'bounce', ctx);
          doBounce(opponent, selectedIdx, ctx);
        }
        callback();
      });
      break;
    }
    case 'active': {
      // target: 'target_self' / 'target_own' (選択UI) / 'target_all_own'
      const tCode = (defaultTarget && defaultTarget.code) || 'target_self';
      const activateOne = (tgt) => {
        if (!tgt) return;
        tgt.suspended = false;
        // same_target（ブレイブシールド等: アクティブにしたデジモンにブロッカー付与）用に保存
        if (ctx.bs) ctx.bs._lastPickedCard = tgt;
        ctx.addLog('🔄 「' + tgt.name + '」アクティブ');
        // オンライン: 相手画面にも反映
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
          const idx = (ctx.bs.player.battleArea || []).indexOf(tgt);
          if (idx !== -1) {
            try {
              // senderOwn: 送信者の自分側カードを操作したことを示す（受信側では相手(ai)側のカード）
              window._onlineSendCommand({ type: 'fx_remoteSuspend', targetIdx: idx, suspended: false, targetName: tgt.name, senderOwn: true });
            } catch(_) {}
          }
        }
      };
      if (tCode === 'target_self') {
        const _activeSelfWasSuspended = ctx.card && ctx.card.suspended;
        if (ctx.card) activateOne(ctx.card);
        if (_activeSelfWasSuspended) {
          if (ctx.bs) ctx.bs._onActivePhase = 'main';
          scanTriggers('on_active', ctx.card, ctx.side, ctx);
          if (ctx.bs) delete ctx.bs._onActivePhase;
          ctx.renderAll();
          processQueue(ctx, callback);
        } else {
          ctx.renderAll(); callback();
        }
        break;
      }
      // 追加の条件フィルタ（例: cond_blocker:1 で「ブロッカーを持つ」デジモンのみ対象）
      const _activeConds = (action && action.conditions) || (ctx.block && ctx.block.conditions) || [];
      const _activeCondSide = ctx.side;
      const _activeCondPass = (c) => _activeConds.length === 0 || checkConditions(_activeConds, c, ctx.bs, _activeCondSide);
      if (tCode === 'target_all_own') {
        (player.battleArea || []).forEach(c => { if (c && c.suspended && _activeCondPass(c)) activateOne(c); });
        ctx.renderAll(); callback(); break;
      }
      if (tCode === 'target_own') {
        // 自分のレスト中デジモンから 1 体選択
        const valid = [];
        for (let i = 0; i < player.battleArea.length; i++) {
          const c = player.battleArea[i];
          if (c && c.suspended && _activeCondPass(c)) valid.push(i);
        }
        if (valid.length === 0) { ctx.addLog && ctx.addLog('💨 アクティブにできるレスト中デジモンがいません'); ctx.renderAll(); callback(); break; }
        if (effectiveSide === 'ai') {
          activateOne(player.battleArea[valid[0]]);
          ctx.renderAll(); callback(); break;
        }
        const rowId = ctx.side === 'player' ? 'pl' : 'ai';
        showTargetSelection(rowId, valid, null, '#00ff88', (selectedIdx) => {
          if (selectedIdx == null) { callback(); return; }
          activateOne(player.battleArea[selectedIdx]);
          ctx.renderAll();
          callback();
        });
        break;
      }
      // フォールバック: ctx.card
      if (ctx.card) activateOne(ctx.card);
      ctx.renderAll();
      callback();
      break;
    }
    case 'recover': {
      const n = action.value || 1;
      const recoverCard = player.deck.length > 0 ? player.deck[0] : null;
      const recoveredCards = [];
      for (let i = 0; i < n; i++) {
        if (player.deck.length > 0) {
          const rc = player.deck.splice(0, 1)[0];
          player.security.push(rc);
          recoveredCards.push(rc);
          ctx.addLog('🛡 セキュリティ+1');
        }
      }
      ctx.renderAll();
      // オンライン: 相手画面にもセキュリティ追加（実カード）＋移動演出を送る
      // （state_sync はセキュリティ増加を反映しないため個別コマンドで同期）
      // recoverSide にリカバリーした側（ctx.side）を載せ、受信側で逆サイドへ適用する。
      // 手札からの使用（side=player）でも、セキュリティからめくれて発動
      // （side=ai 側で処理される）でも、処理した機械から1回だけ送られる。
      // ※ security_open 内のリカバリーは animOnly:true で送る（演出のみ。
      //   セキュリティ枚数は security_open 側の security_init 再同期に集約し
      //   二重加算を防ぐ）。
      if (recoveredCards.length > 0
          && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
        try {
          window._onlineSendCommand({
            type: 'fx_recover',
            recoverSide: ctx.side,
            animOnly: !!ctx._securityOpenActive,
            cards: recoveredCards.map(c => ({
              name: c.name, cardNo: c.cardNo, type: c.type, color: c.color,
              level: c.level, dp: c.dp, baseDp: c.baseDp,
              playCost: c.playCost, evolveCost: c.evolveCost, cost: c.cost,
              effect: c.effect, evoSourceEffect: c.evoSourceEffect,
              securityEffect: c.securityEffect, recipe: c.recipe,
              evolveCond: c.evolveCond, imgSrc: c.imgSrc, imageUrl: c.imageUrl,
              feature: c.feature,
            })),
          });
        } catch (_) {}
      }
      // 辞書の演出パラメータ1=デッキ, パラメータ2=セキュリティ で自動決定
      playEffect(action.code, { card: recoverCard, ctx }, () => { callback(); });
      break;
    }
    case 'security_trash_top': {
      const n = action.value || 1;
      const trashCard = opponent.security.length > 0 ? opponent.security[0] : null;
      for (let i = 0; i < n; i++) {
        if (opponent.security.length > 0) { opponent.trash.push(opponent.security.shift()); ctx.addLog('🛡 セキュリティ破棄'); }
      }
      ctx.renderAll();
      // 辞書の演出パラメータ1=セキュリティ, パラメータ2=トラッシュ で自動決定
      playEffect(action.code, { card: trashCard, ctx }, () => { callback(); });
      break;
    }
    case 'evo_discard':
    case 'evo_discard_bottom':
    case 'evo_discard_top':
    case 'evo_discard_select': {
      // 進化元を持つ相手デジモンを列挙（条件フィルタ付き）
      const edConds = ctx.block && ctx.block.conditions ? ctx.block.conditions : [];
      const evoTargets = [];
      for (let i = 0; i < opponent.battleArea.length; i++) {
        const c = opponent.battleArea[i];
        if (!c || !c.stack || c.stack.length === 0) continue;
        // 条件フィルタ（Lv制限等）
        let valid = true;
        for (const cond of edConds) {
          if (cond.code === 'cond_lv_le' && cond.value != null && (parseInt(c.level) || 0) > cond.value) valid = false;
          if (cond.code === 'cond_lv_ge' && cond.value != null && (parseInt(c.level) || 0) < cond.value) valid = false;
          if (cond.code === 'cond_dp_le' && cond.value != null && (c.dp || 0) > cond.value) valid = false;
        }
        if (valid) evoTargets.push(i);
      }
      if (evoTargets.length === 0) {
        ctx.addLog('⚠ 進化元を破棄できる対象がいません');
        showEffectFailed('効果を発動できませんでした', callback);
        break;
      }
      const n = action.value || 1;
      // 破棄確定後の共通後処理（演出 + ログ + オンライン同期）
      const finalizeDiscard = (discarded, tgt, onDone) => {
        if (discarded.length === 0) { onDone && onDone(false); return; }
        const names = discarded.map(c => c.name || '???').join('、');
        ctx.addLog('📤 「' + tgt.name + '」の進化元から「' + names + '」破棄！');
        // オンラインの相手にも演出＋実データ操作コマンドを送信
        if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
          const tgtIdx = opponent.battleArea.indexOf(tgt);
          window._onlineSendCommand({ type: 'fx_evoDiscard', targetName: tgt.name, discardedNames: names, targetIdx: tgtIdx, count: discarded.length, fromTop: action.code === 'evo_discard_top' });
          if (window._markEvoModified) window._markEvoModified('ai', tgtIdx);
        }
        // カード移動演出（1枚ずつ順番に）
        let idx = 0;
        function showNextDiscard() {
          if (idx >= discarded.length) { onDone && onDone(true); return; }
          const card = discarded[idx++];
          if (window._fxCardMove) {
            window._fxCardMove(card, tgt.name + 'の進化元', 'トラッシュ', showNextDiscard);
          } else {
            // fxCardMoveがなければフォールバック（メッセージのみ）
            setTimeout(showNextDiscard, 500);
          }
        }
        showNextDiscard();
      };
      const discardFromTarget = (tgt, onDone) => {
        // 「選んで破棄」: 進化元カード選択UIをN回繰り返す（AIは先頭を自動選択）
        if (action.code === 'evo_discard_select') {
          const discarded = [];
          const pickNext = (remaining) => {
            if (remaining <= 0 || tgt.stack.length === 0) { finalizeDiscard(discarded, tgt, onDone); return; }
            const takeCard = (chosen) => {
              if (!chosen) { finalizeDiscard(discarded, tgt, onDone); return; }
              const si = tgt.stack.indexOf(chosen);
              if (si !== -1) tgt.stack.splice(si, 1);
              opponent.trash.push(chosen);
              discarded.push(chosen);
              pickNext(remaining - 1);
            };
            if (effectiveSide === 'ai') {
              takeCard(tgt.stack[0]);
            } else {
              showEvoSourceSelection(tgt, tgt.stack.slice(), null, takeCard);
            }
          };
          pickNext(n);
          return;
        }
        // 上から/下から: 自動で決め打ち
        const discarded = [];
        for (let i = 0; i < n && tgt.stack.length > 0; i++) {
          const fromTop = action.code === 'evo_discard_top';
          const removed = fromTop ? tgt.stack.shift() : tgt.stack.pop();
          opponent.trash.push(removed);
          discarded.push(removed);
        }
        finalizeDiscard(discarded, tgt, onDone);
      };
      // 破棄後の後処理（永続効果再計算 + 描画 + 同期 + 相手の進化元を破棄したとき反応）
      const afterDiscard = (didDiscard, doneCb) => {
        // 進化元が変わったので永続効果を再計算（SA+/DP+等）
        const oppSide = effectiveSide === 'player' ? 'ai' : 'player';
        try { applyPermanentEffects(ctx.bs, oppSide, ctx); } catch(_) {}
        ctx.renderAll();
        if (window._isOnlineMode && window._isOnlineMode()) { try { window._onlineSendStateSync(); } catch(_) {} }
        if (didDiscard) {
          try { fireWhenEvoDiscardTriggers(oppSide, ctx.bs, ctx, () => doneCb && doneCb()); return; } catch (_) {}
        }
        doneCb && doneCb();
      };
      // AIは自動選択、プレイヤーは対象選択UI
      if (effectiveSide === 'ai') {
        discardFromTarget(opponent.battleArea[ctx._forceTargetIdx ?? evoTargets[0]], (didDiscard) => {
          afterDiscard(didDiscard, callback);
        });
        break;
      }
      ctx.addLog('🎯 進化元を破棄する対象を選んでください');
      showTargetSelection(opponentRowSide, evoTargets, null, uiColor, (selectedIdx) => {
        if (selectedIdx !== null) {
          discardFromTarget(opponent.battleArea[selectedIdx], (didDiscard) => {
            afterDiscard(didDiscard, callback);
          });
        } else {
          callback();
        }
      });
      break;
    }
    case 'cant_attack_block': {
      // 持続時間
      const cabDur = (ctx.block && ctx.block.duration && ctx.block.duration.code) || 'dur_this_turn';
      // 条件: 進化元を持たない 等
      const cabHasNoEvoCond = ctx.block && ctx.block.conditions && ctx.block.conditions.some(c => c.code === 'cond_no_evo');
      const cabTargets = [];
      for (let i = 0; i < opponent.battleArea.length; i++) {
        const c = opponent.battleArea[i];
        if (!c) continue;
        if (cabHasNoEvoCond && c.stack && c.stack.length > 0) continue; // 進化元を持つカードは除外
        cabTargets.push(i);
      }
      if (cabTargets.length === 0) {
        ctx.addLog('⚠ 対象がいません');
        showEffectFailed('効果を発動できませんでした', callback);
        break;
      }
      const applyCab = (tgt, onDone) => {
        tgt.cantAttack = true; tgt.cantBlock = true;
        addBuffDirect(tgt, 'cant_attack_block', 0, cabDur, ctx);
        ctx.addLog('🔒 「' + tgt.name + '」アタック・ブロック不可（' + cabDur + '）');
        // 相手側でも自カードに状態付与してもらう（state_syncでは自カードは更新されないため）
        if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
          const tgtIdx = opponent.battleArea.indexOf(tgt);
          // 付与本人 = 自分(player)。相手側からは ai として扱う
          // 付与時のターン（自分ターン中か相手ターン中か）も送る
          const turnSide = ctx.bs.isPlayerTurn ? 'player' : 'ai';
          const appliedDuringOwnTurn = (turnSide === ctx.side);
          window._onlineSendCommand({ type: 'fx_cantAttackBlock', targetIdx: tgtIdx, targetName: tgt.name, duration: cabDur, action: 'cant_attack_block', appliedFromSender: 'player', appliedDuringOwnTurn: appliedDuringOwnTurn });
        }
        // 状態付与演出
        if (window._fxBuffStatus) {
          window._fxBuffStatus(tgt, '⚔🛡✖', 'アタック・ブロック不可付与！', '#9933ff', () => { onDone && onDone(); });
        } else { onDone && onDone(); }
      };
      const finishCab = () => {
        if (typeof ctx.renderAll === 'function') { try { ctx.renderAll(true); } catch(_) { ctx.renderAll(); } }
        if (window._isOnlineMode && window._isOnlineMode()) { try { window._onlineSendStateSync(); } catch(_) {} }
        callback();
      };
      if (effectiveSide === 'ai') {
        applyCab(opponent.battleArea[ctx._forceTargetIdx ?? cabTargets[0]], finishCab);
        break;
      }
      ctx.addLog('🎯 アタック・ブロック不可にする対象を選んでください');
      showTargetSelection(opponentRowSide, cabTargets, null, uiColor, (selectedIdx) => {
        if (selectedIdx !== null) {
          applyCab(opponent.battleArea[selectedIdx], finishCab);
        } else {
          finishCab();
        }
      });
      break;
    }
    // === コスト: 他のデジモン消滅 ===
    case 'cost_destroy_other': {
      // 自分側 battleArea から自身（card）以外のデジモンを1体消滅
      // step.condition に cond_name:xxx が指定された場合は名前でフィルタ
      const _cdoNameM = /cond_name:(.+)/.exec(String(step.condition || ''));
      const _cdoNameFilter = _cdoNameM ? _cdoNameM[1].trim() : null;
      const candidates = [];
      player.battleArea.forEach((c, i) => {
        if (!c || c === card) return;
        if (_cdoNameFilter && String(c.name || '') !== _cdoNameFilter) return;
        candidates.push(i);
      });
      if (candidates.length === 0) { callback(false); return; }
      const doDestroy = (idx) => {
        const tgt = player.battleArea[idx];
        if (!tgt) { callback(false); return; }
        ctx.addLog('💀 コスト: 「' + tgt.name + '」を消滅');
        // showDestroyEffect 経由で既存消滅ロジックへ流す（callback chain）
        if (window._showDestroyEffect) {
          window._showDestroyEffect(tgt, () => {
            const i2 = player.battleArea.indexOf(tgt);
            if (i2 >= 0) { player.trash.push(tgt); player.battleArea[i2] = null; }
            ctx.renderAll(); callback(true);
          });
        } else {
          player.trash.push(tgt);
          player.battleArea[idx] = null;
          ctx.renderAll(); callback(true);
        }
      };
      if (effectiveSide === 'ai' || ctx._forceTargetIdx !== undefined) {
        const tIdx = ctx._forceTargetIdx ?? candidates[0];
        doDestroy(tIdx);
        break;
      }
      ctx.addLog('🎯 コスト: 消滅させるデジモンを選択');
      showTargetSelection(ctx.side === 'player' ? 'pl' : 'ai', candidates, null, '#ff4444', (selectedIdx) => {
        if (selectedIdx === null) { callback(false); return; }
        doDestroy(selectedIdx);
      });
      break;
    }
    case 'cost_discard': {
      const n = action.value || 1;
      if (player.hand.length < n) { callback(false); return; }
      const isPlayerSide = ctx.side === 'player';
      const canShowPicker = isPlayerSide && typeof showHandDiscardPicker === 'function';
      // 1 枚ずつ破棄演出（自分側で fxCardMove, オンラインなら相手側にも fx_remoteCardMove 送信）
      const discardOne = (card, done) => {
        const idx = player.hand.indexOf(card);
        if (idx !== -1) player.hand.splice(idx, 1);
        player.trash.push(card);
        ctx.addLog('✦ 「' + card.name + '」を捨てた');
        // オンライン: 相手画面にもカード移動演出を送信
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
          try {
            window._onlineSendCommand({
              type: 'fx_remoteCardMove',
              cardName: card.name, cardNo: card.cardNo,
              cardImg: card.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(card) : '') || '',
              fromLabel: '手札', toLabel: 'トラッシュ',
            });
          } catch(_) {}
        }
        if (window._fxCardMove) {
          window._fxCardMove(card, '手札', 'トラッシュ', done);
        } else { setTimeout(done, 300); }
      };
      const runDiscards = (cards, finalize) => {
        let i = 0;
        const next = () => {
          if (i >= cards.length) { ctx.renderAll(); finalize(); return; }
          discardOne(cards[i++], next);
        };
        next();
      };
      if (!canShowPicker) {
        // AI 側 / UI なし: 末尾 N 枚を自動破棄
        const auto = player.hand.slice(-n);
        runDiscards(auto, () => callback());
        return;
      }
      // プレイヤー: 手札ピッカーで N 枚選択 → 破棄
      showHandDiscardPicker(player.hand.slice(), n, (picked) => {
        if (!picked || picked.length < n) { callback(false); return; }
        runDiscards(picked, () => callback());
      });
      break;
    }
    case 'use_main_effect': {
      // レシピのみ（テキスト解析フォールバックは廃止）
      const mainRecipe = getRecipeForCard(ctx.card, 'main');
      if (mainRecipe) {
        ctx.addLog('✦ 「' + ctx.card.name + '」の【メイン】効果を発揮！');
        runRecipe(mainRecipe, ctx, callback);
      } else {
        ctx.addLog('⚠ メイン効果のレシピが見つかりません');
        callback();
      }
      break;
    }

    case 'security_attack_plus': {
      // 期間付きでSアタック+Nを付与（対象デジモンのbuffsに追加）
      const saVal = action.value || 1;
      const saDur = normalizeRecipeDuration((ctx.block && ctx.block.duration && ctx.block.duration.code) || 'dur_this_turn');
      const saTarget = defaultTarget || { code: 'target_all_own' };
      const applySA = (tgt) => {
        if (!tgt) return;
        // addBuffDirect 経由で _appliedSide / _appliedDuringOwnTurn / _ticks を正しく設定
        // → expireBuffs の dur_next_own_turn 等のサイド判定が正しく動く
        addBuffDirect(tgt, 'security_attack_plus', saVal, saDur, ctx);
        console.log('[grant-SA+]', tgt.name, 'val=' + saVal, 'dur=' + saDur, 'appliedSide=' + ctx.side, 'isPlayerTurn=' + ctx.bs.isPlayerTurn);
        ctx.addLog('⚔ 「' + tgt.name + '」にSアタック+' + saVal + '（' + saDur + '）');
      };
      if (saTarget.code === 'target_all_own') {
        player.battleArea.forEach(c => { if (c) applySA(c); });
      } else if (saTarget.code === 'target_self' && ctx.card) {
        applySA(ctx.card);
      } else {
        player.battleArea.forEach(c => { if (c) applySA(c); });
      }
      ctx.renderAll();
      callback && callback();
      break;
    }

    case 'security_attack_minus': {
      // 期間付きでSアタック-Nを付与（相手デジモン対象）
      const smVal = action.value || 1;
      const smDur = normalizeRecipeDuration((ctx.block && ctx.block.duration && ctx.block.duration.code) || 'dur_this_turn');
      const smTarget = defaultTarget || { code: 'target_opponent', count: 1 };
      const applySM = (tgt, idx) => {
        if (!tgt) return;
        addBuffDirect(tgt, 'security_attack_minus', smVal, smDur, ctx);
        console.log('[grant-SA-]', tgt.name, 'val=' + smVal, 'dur=' + smDur, 'appliedSide=' + ctx.side, 'isPlayerTurn=' + ctx.bs.isPlayerTurn, 'buffs after:', JSON.stringify(tgt.buffs));
        ctx.addLog('⚔ 「' + tgt.name + '」にSアタック-' + smVal + '（' + smDur + '）');
        // オンライン: 相手側に buff を反映（state_sync は oppBattleArea を上書きしないため
        // 個別に fx_remoteBuff を送信する。ctx.side === 'player' の時だけ送信）
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && idx != null && window._onlineSendCommand) {
          window._onlineSendCommand({
            type: 'fx_remoteBuff',
            targetIdx: idx,
            targetName: tgt.name,
            buffType: 'security_attack_minus',
            value: smVal,
            duration: smDur,
            appliedFromSender: 'player',
            appliedDuringOwnTurn: ctx.bs && ctx.bs.isPlayerTurn,
          });
        }
      };
      // 全体対象
      if (smTarget.code === 'target_all_opponent') {
        opponent.battleArea.forEach((c, i) => { if (c) applySM(c, i); });
        ctx.renderAll();
        callback && callback();
        break;
      }
      // 単体対象（相手1体）
      const smTargets = [];
      for (let i = 0; i < opponent.battleArea.length; i++) {
        if (opponent.battleArea[i]) smTargets.push(i);
      }
      if (smTargets.length === 0) {
        ctx.addLog('⚠ 対象がいません');
        showEffectFailed('効果を発動できませんでした', callback);
        break;
      }
      if (effectiveSide === 'ai') {
        const ai = ctx._forceTargetIdx ?? smTargets[0];
        applySM(opponent.battleArea[ai], ai);
        ctx.renderAll();
        callback && callback();
        break;
      }
      ctx.addLog('🎯 Sアタック-' + smVal + 'の対象を選んでください');
      showTargetSelection(opponentRowSide, smTargets, null, uiColor, (selectedIdx) => {
        if (selectedIdx !== null) {
          applySM(opponent.battleArea[selectedIdx], selectedIdx);
        }
        ctx.renderAll();
        callback && callback();
      });
      break;
    }

    // === レストさせる ===
    case 'rest': {
      const restTarget = defaultTarget || { code: 'target_opponent' };
      // 対象が自分自身の場合
      if (restTarget.code === 'target_self') {
        if(ctx.card) { ctx.card.suspended = true; ctx.addLog('💤 「' + ctx.card.name + '」をレスト'); }
        ctx.renderAll(); callback(); break;
      }
      // 対象が相手デジモンの場合（condition があれば対象フィルタとして適用）
      // 例: テントモン進化元「DP3000以下の相手1体をレスト」の cond_dp_le:3000
      const _restConds = (action && action.conditions) || (ctx.block && ctx.block.conditions) || [];
      const _restCondTag = ctx.side === 'player' ? 'ai' : 'player';
      const restTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) {
        const _rc = opponent.battleArea[i];
        if(!_rc || _rc.suspended) continue;
        if(_restConds.length > 0 && !checkConditions(_restConds, _rc, ctx.bs, _restCondTag)) continue;
        restTargets.push(i);
      }
      if(restTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      const restColor = uiColor;
      // 相手デジモンがレスト → when_opp_rest 発火（restedSide = 相手側）
      const restedSide = ctx.side === 'player' ? 'ai' : 'player';
      const finishWithTrigger = () => {
        fireWhenOppRestTriggers(restedSide, ctx.bs, ctx, callback);
      };
      // 自分側プレイヤーが相手のカードをレストさせた場合、両者の画面で suspended を同期する
      // - 自分側: state_sync で false に戻されないよう保護フラグ
      // - 相手側: 個別 fx_remoteSuspend コマンドで反映
      const syncRest = (idx) => {
        if (ctx.side !== 'player') return;
        if (typeof window !== 'undefined' && window._markSuspendChanged) {
          window._markSuspendChanged('ai', idx, true);
        }
        if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
          const tgt = opponent.battleArea[idx];
          window._onlineSendCommand({ type: 'fx_remoteSuspend', targetIdx: idx, suspended: true, targetName: tgt ? tgt.name : '' });
        }
      };
      // 「全て」指定（条件でフィルタ済みの restTargets 全員に自動適用・選択UI無し）
      if (restTarget.code === 'target_all_opponent') {
        restTargets.forEach(idx => {
          const tgt = opponent.battleArea[idx];
          if (!tgt) return;
          tgt.suspended = true;
          ctx.addLog('💤 「' + tgt.name + '」をレスト');
          syncRest(idx);
        });
        ctx.renderAll();
        finishWithTrigger();
        break;
      }
      if(effectiveSide === 'ai') {
        const ri = ctx._forceTargetIdx ?? restTargets[0];
        opponent.battleArea[ri].suspended = true;
        ctx.addLog('💤 「' + opponent.battleArea[ri].name + '」をレスト');
        syncRest(ri);
        ctx.renderAll();
        finishWithTrigger();
        break;
      }
      ctx.addLog('🎯 レストさせる対象を選んでください');
      showTargetSelection(opponentRowSide, restTargets, null, restColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          sendEffectResult(opponent.battleArea[selectedIdx], 'rest', ctx);
          opponent.battleArea[selectedIdx].suspended = true;
          ctx.addLog('💤 「' + opponent.battleArea[selectedIdx].name + '」をレスト');
          syncRest(selectedIdx);
          ctx.renderAll();
          finishWithTrigger();
        } else {
          ctx.renderAll(); callback();
        }
      });
      break;
    }

    // === 自身をレスト（コスト） ===
    case 'rest_self': {
      if(ctx.card) { ctx.card.suspended = true; ctx.addLog('💤 「' + ctx.card.name + '」をレスト'); }
      ctx.renderAll(); callback();
      break;
    }

    // === アタック不可（単体） ===
    case 'cant_attack': {
      const caTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) caTargets.push(i); }
      if(caTargets.length === 0) { callback(); break; }
      if(effectiveSide === 'ai') {
        const cai = ctx._forceTargetIdx ?? caTargets[0];
        opponent.battleArea[cai].cantAttack = true;
        addBuffDirect(opponent.battleArea[cai], 'cant_attack', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
        ctx.addLog('🔒 「' + opponent.battleArea[cai].name + '」アタック不可');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 アタック不可の対象を選んでください');
      showTargetSelection(opponentRowSide, caTargets, null, uiColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          opponent.battleArea[selectedIdx].cantAttack = true;
          addBuffDirect(opponent.battleArea[selectedIdx], 'cant_attack', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
          ctx.addLog('🔒 「' + opponent.battleArea[selectedIdx].name + '」アタック不可');
        }
        ctx.renderAll(); callback();
      });
      break;
    }

    // === ブロック不可（単体） ===
    // === オプションのセキュリティ効果を無効化 ===
    // 旧コード 'security_effect' も alias として受け付け
    case 'security_effect':
    case 'suppress_opt_security_effect': {
      card._permEffects = card._permEffects || {};
      card._permEffects.suppressOptSecurityEffect = true;
      addBuffDirect(card, 'suppress_opt_security_effect', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
      ctx.addLog('🚫 「' + card.name + '」: オプションSE無効化');
      ctx.renderAll(); callback(); break;
    }
    // === 進化元枚数でバトル ===
    case 'battle_by_evo_count': {
      // 自身に iceArmor フラグを一時的に立てる（dur_this_turn 標準）
      card._permEffects = card._permEffects || {};
      card._permEffects.iceArmor = true;
      addBuffDirect(card, 'ice_armor', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
      ctx.addLog('🧊 「' + card.name + '」: 進化元枚数でバトル');
      ctx.renderAll(); callback(); break;
    }
    // === ブロックされない（アクション版: 自身に cantBeBlocked フラグ付与） ===
    // 旧コード 'custom' も alias として受け付け
    case 'custom':
    case 'cant_be_blocked': {
      const target = card; // 通常 self
      target._permEffects = target._permEffects || {};
      target._permEffects.cantBeBlocked = true;
      addBuffDirect(target, 'cant_be_blocked', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
      ctx.addLog('🛡 「' + target.name + '」はブロックされなくなった');
      ctx.renderAll(); callback(); break;
    }
    case 'cant_block': {
      const cbTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) cbTargets.push(i); }
      if(cbTargets.length === 0) { callback(); break; }
      if(effectiveSide === 'ai') {
        const cbi = ctx._forceTargetIdx ?? cbTargets[0];
        opponent.battleArea[cbi].cantBlock = true;
        addBuffDirect(opponent.battleArea[cbi], 'cant_block', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
        ctx.addLog('🔒 「' + opponent.battleArea[cbi].name + '」ブロック不可');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 ブロック不可の対象を選んでください');
      showTargetSelection(opponentRowSide, cbTargets, null, uiColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          opponent.battleArea[selectedIdx].cantBlock = true;
          addBuffDirect(opponent.battleArea[selectedIdx], 'cant_block', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
          ctx.addLog('🔒 「' + opponent.battleArea[selectedIdx].name + '」ブロック不可');
        }
        ctx.renderAll(); callback();
      });
      break;
    }

    // === 進化不可 ===
    case 'cant_evolve': {
      const ceTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) ceTargets.push(i); }
      if(ceTargets.length === 0) { callback(); break; }
      if(effectiveSide === 'ai') {
        const cei = ctx._forceTargetIdx ?? ceTargets[0];
        opponent.battleArea[cei].cantEvolve = true;
        addBuffDirect(opponent.battleArea[cei], 'cant_evolve', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
        ctx.addLog('❌ 「' + opponent.battleArea[cei].name + '」進化不可');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 進化不可の対象を選んでください');
      showTargetSelection(opponentRowSide, ceTargets, null, uiColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          opponent.battleArea[selectedIdx].cantEvolve = true;
          addBuffDirect(opponent.battleArea[selectedIdx], 'cant_evolve', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
          ctx.addLog('❌ 「' + opponent.battleArea[selectedIdx].name + '」進化不可');
        }
        ctx.renderAll(); callback();
      });
      break;
    }

    // === 手札に加える（セキュリティ効果用: ctx.card自身を手札に戻すフラグ） ===
    case 'add_to_hand': {
      const ahTarget = defaultTarget || { code: 'target_self' };
      // target:"self" → セキュリティ効果で「このカードを手札に加える」
      if (ahTarget.code === 'target_self' && ctx.card) {
        ctx.card._returnToHand = true;
        // ctx.card は dummy オブジェクトの可能性が高いため、実体を player.trash / player.security から探して移動する
        const matchFn = (c) => c && (
          (ctx.card.cardNo && c.cardNo === ctx.card.cardNo) ||
          (ctx.card.name && c.name === ctx.card.name)
        );
        let realCard = null;
        const trashIdx = player.trash.findIndex(matchFn);
        if (trashIdx >= 0) {
          realCard = player.trash.splice(trashIdx, 1)[0];
        } else {
          const secIdx = player.security.findIndex(matchFn);
          if (secIdx >= 0) realCard = player.security.splice(secIdx, 1)[0];
        }
        if (realCard) {
          player.hand.push(realCard);
          ctx.addLog('🃏 「' + realCard.name + '」を手札に加えた');
        } else {
          ctx.addLog('🃏 「' + ctx.card.name + '」を手札に加える（セキュリティ効果終了時）');
        }
        ctx.renderAll(); callback();
        break;
      }
      ctx.renderAll(); callback();
      break;
    }

    // === セキュリティ下から破棄 ===
    case 'security_trash_bottom': {
      const n = action.value || 1;
      for(let i = 0; i < n; i++) {
        if(opponent.security.length > 0) { opponent.trash.push(opponent.security.pop()); ctx.addLog('🛡 セキュリティ（下から）破棄'); }
      }
      ctx.renderAll(); callback();
      break;
    }

    // === 登場させる（コスト踏み倒し） ===
    case 'summon': {
      // 手札から登場可能なデジモン/テイマーを選択
      const summonTargets = player.hand.map((c, i) => ({ card: c, idx: i })).filter(x => x.card.type === 'デジモン' || x.card.type === 'テイマー');
      if(summonTargets.length === 0) { ctx.addLog('⚠ 登場可能なカードがありません'); callback(); break; }
      ctx.addLog('🎯 登場させるカードを手札から選んでください');
      showHandSelection(player.hand, summonTargets.map(x => x.idx), '#00fbff', (selectedIdx) => {
        if(selectedIdx !== null) {
          const card = player.hand.splice(selectedIdx, 1)[0];
          const emptySlot = player.battleArea.indexOf(null);
          if(emptySlot !== -1) { player.battleArea[emptySlot] = card; }
          else { player.battleArea.push(card); }
          card.summonedThisTurn = true;
          ctx.addLog('⚡ 「' + card.name + '」をコストなしで登場！');
        }
        ctx.renderAll(); callback();
      });
      break;
    }

    case 'goal_reached': {
      // チュートリアル専用アクション。チュートリアルランナーが動作中のときだけ通知する。
      // 通常のオンライン対戦では誰も呼ばないので副作用なし。
      try {
        if (typeof window !== 'undefined' && window._tutorialRunner && typeof window._tutorialRunner.onGoalReached === 'function') {
          window._tutorialRunner.onGoalReached(action, ctx);
          ctx.addLog('🎯 チュートリアルゴール達成');
        }
      } catch (e) {
        console.error('goal_reached action error:', e);
      }
      callback();
      break;
    }

    default:
      // キーワード効果（blocker, rush等）はパッシブなので実行不要
      callback();
  }
}

// ===== ヘルパー関数 =====

function doDestroy(targetSide, slotIdx, ctx, callback) {
  const destroyed = targetSide.battleArea[slotIdx];
  if (!destroyed) { callback && callback(); return; }
  // ≪デコイ≫ - 同 side の他デジモンが身代わりに消滅
  // ≪スケープゴート≫ - 消滅対象が他デジモンを身代わりに消滅させて回避
  // どちらも window 経由で battle-combat.js のヘルパーを呼ぶ
  if (window._tryDecoyRedirect) {
    var decoyRes = window._tryDecoyRedirect(destroyed, targetSide);
    if (decoyRes && decoyRes.decoyCard != null && decoyRes.decoySlotIdx != null) {
      // デコイ持ちを消滅させ、対象 (destroyed) はそのまま残す
      var dc = decoyRes.decoyCard;
      var di = decoyRes.decoySlotIdx;
      targetSide.battleArea[di] = null;
      targetSide.trash.push(dc);
      if (dc.stack) dc.stack.forEach(function(s){ targetSide.trash.push(s); });
      ctx.renderAll && ctx.renderAll();
      // デコイ自身の消滅で on_destroy 発火
      const decoyOwnerSide = (ctx.bs && targetSide === ctx.bs.player) ? 'player' : 'ai';
      fireDestroyChain(dc, decoyOwnerSide, ctx.bs, ctx, function() {
        callback && callback();
      });
      return;
    }
  }
  if (window._tryScapegoat) {
    if (window._tryScapegoat(destroyed, targetSide)) {
      // 他デジモンを身代わりにして destroyed は残す
      ctx.renderAll && ctx.renderAll();
      const sgOwnerSide = (ctx.bs && targetSide === ctx.bs.player) ? 'player' : 'ai';
      fireDestroyChain(destroyed, sgOwnerSide, ctx.bs, ctx, function() {
        callback && callback();
      });
      return;
    }
  }
  targetSide.battleArea[slotIdx] = null;
  targetSide.trash.push(destroyed);
  if (destroyed.stack) destroyed.stack.forEach(s => targetSide.trash.push(s));
  ctx.addLog('💀 「' + destroyed.name + '」を消滅');
  // オンライン: 相手のカードを消滅させた場合、直接通知 + 復活防止マーク
  if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player') {
    window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: slotIdx, reason: 'destroy' });
    if (window._markDestroyed) window._markDestroyed('ai', slotIdx);
  }
  ctx.renderAll();
  // on_destroy グローバル発火（消滅した側を引数に）
  // targetSide オブジェクトから 'player' / 'ai' を逆引き
  const destroyedSideName = (ctx.bs && targetSide === ctx.bs.player) ? 'player' : 'ai';
  // 共通の消滅トリガーチェーン
  fireDestroyChain(destroyed, destroyedSideName, ctx.bs, ctx, callback);
}

function doBounce(targetSide, slotIdx, ctx) {
  const bounced = targetSide.battleArea[slotIdx];
  if (!bounced) return;
  targetSide.battleArea[slotIdx] = null;
  targetSide.hand.push(bounced);
  if (bounced.stack) bounced.stack.forEach(s => targetSide.trash.push(s));
  ctx.addLog('↩ 「' + bounced.name + '」を手札に戻した');
  // オンライン: 相手のカードをバウンスした場合、直接通知 + 復活防止マーク
  if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player') {
    window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: slotIdx, reason: 'bounce' });
    if (window._markDestroyed) window._markDestroyed('ai', slotIdx);
  }
  ctx.renderAll();
}

// ===== 対象選択UI =====
let _targetSelecting = false; // 対象選択中フラグ（renderAll抑制用）
export function isTargetSelecting() { return _targetSelecting; }

function showTargetSelection(targetSide, validIndices, conditions, borderColor, callback) {
  // ★ チュートリアル AI 対象選択 intent: スクリプトで指定したカードがあれば自動選択
  //   _tutorialAiSelectTarget = カードNo or カード名 (部分一致対応)
  //   ※ AI が効果を使う時のみ消費する（AI のターン中、または targetSide='player' で AI が
  //   プレイヤーのカードを対象に選ぶ場合）。プレイヤーがメイン操作中（自分のターンの自分の
  //   効果）は AI 意図を絶対に消費しない（誤発火で UI スキップする不具合防止）。
  const _bsForIntent = (typeof window !== 'undefined') ? (window._lastBattleState || window.bs) : null;
  const _isPlayerTurnNow = !!(_bsForIntent && _bsForIntent.isPlayerTurn);
  const _aiIntentEligible = !_isPlayerTurnNow; // 相手ターン中だけ AI 意図を消費
  if (typeof window !== 'undefined' && window._tutorialAiSelectTarget && _aiIntentEligible) {
    const bs = _bsForIntent;
    if (bs) {
      const area = targetSide === 'ai' ? (bs.ai && bs.ai.battleArea) : (bs.player && bs.player.battleArea);
      const intentKey = String(window._tutorialAiSelectTarget).trim();
      if (Array.isArray(area)) {
        // cardNo 完全一致 → name 完全一致 → name 部分一致 の順
        let matchIdx = (validIndices || []).find(idx => area[idx] && String(area[idx].cardNo) === intentKey);
        if (matchIdx === undefined) matchIdx = (validIndices || []).find(idx => area[idx] && String(area[idx].name) === intentKey);
        if (matchIdx === undefined) matchIdx = (validIndices || []).find(idx => area[idx] && String(area[idx].name || '').includes(intentKey));
        if (matchIdx !== undefined && matchIdx >= 0) {
          window._tutorialAiSelectTarget = null; // intent 消費
          if (typeof window.addLog === 'function') {
            window.addLog('🎯 [AI] 対象「' + (area[matchIdx].name || intentKey) + '」を自動選択');
          }
          callback(matchIdx);
          return;
        }
      }
    }
  }

  const _showUI = () => {
  const rowId = targetSide === 'ai' ? 'ai-battle-row' : 'pl-battle-row';
  const row = document.getElementById(rowId);
  if (!row) { callback(null); return; }

  _targetSelecting = true;
  const slots = row.querySelectorAll('.b-slot');
  const color = borderColor || '#ff4444';

  // オンライン: 相手画面に「対象選択中」専用ポップアップを表示
  if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
    try { window._onlineSendCommand({ type: 'fx_targetSelectStart' }); } catch (_) {}
  }

  // メッセージを画面中央に表示
  const msgEl = document.createElement('div');
  msgEl.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:60000;background:rgba(0,0,0,0.9);border:1px solid '+color+';border-radius:10px;padding:12px 24px;color:'+color+';font-size:14px;font-weight:bold;text-align:center;box-shadow:0 0 20px '+color+'44;pointer-events:none;';
  msgEl.innerText = '🎯 対象を選んでください';
  document.body.appendChild(msgEl);

  // 対象を光らせる＋ホバー演出
  // チュートリアルの tutorial-spotlight-mode が残っていても確実にタップ可能にする保険:
  //   - body から spotlight クラスを除去
  //   - 対象スロットに pointer-events:auto / opacity:1 を強制（CSS !important を上書き）
  document.body.classList.remove('tutorial-spotlight-mode');
  document.querySelectorAll('.tutorial-keep-visible').forEach(el =>
    el.classList.remove('tutorial-keep-visible')
  );
  validIndices.forEach(idx => {
    const slot = slots[idx];
    if (!slot) return;
    slot.style.border = '2px solid ' + color;
    slot.style.boxShadow = '0 0 15px ' + color;
    slot.style.cursor = 'pointer';
    slot.style.setProperty('pointer-events', 'auto', 'important');
    slot.style.setProperty('opacity', '1', 'important');
    slot.onmouseenter = () => { slot.style.transform = 'translateY(-4px) scale(1.05)'; };
    slot.onmouseleave = () => { slot.style.transform = ''; };
  });

  function onSelect(e) {
    const cx = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    const cy = e.clientY || (e.changedTouches && e.changedTouches[0].clientY);
    if (!cx || !cy) return;

    let selectedIdx = null;
    validIndices.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      const r = slot.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        selectedIdx = idx;
      }
    });

    if (selectedIdx !== null) {
      // 対象カードの情報を取得
      const bs = window._lastBattleState;
      const area = targetSide === 'ai' ? (bs ? bs.ai.battleArea : []) : (bs ? bs.player.battleArea : []);
      const card = area[selectedIdx];
      // チュートリアル通知: 対象選択タップ完了（確認ダイアログ表示前）
      if (typeof window !== 'undefined' && window._tutorialRunner && window._tutorialRunner.active) {
        try {
          window._tutorialRunner.notifyEvent('effect_target_selected', {
            cardNo: card && card.cardNo,
            cardName: card && card.name,
            targetSide,
            side: 'player',
          });
        } catch (_) {}
      }
      // 確認ダイアログ表示
      showTargetConfirm(card, selectedIdx, color, (confirmed) => {
        if (confirmed) {
          // チュートリアル通知: 効果を使った（「はい」押下直後）
          if (typeof window !== 'undefined' && window._tutorialRunner && window._tutorialRunner.active) {
            try {
              window._tutorialRunner.notifyEvent('use_effect', {
                cardNo: card && card.cardNo,
                cardName: card && card.name,
                targetSide,
                side: 'player',
              });
            } catch (_) {}
          }
          cleanup();
          callback(selectedIdx);
        }
        // いいえ → 選択に戻る（何もしない）
      });
    }
  }

  // 対象確認ダイアログ（カード詳細＋確認ボタン）
  function showTargetConfirm(card, idx, borderColor, onResult) {
    // イベントを一時停止
    document.removeEventListener('click', onSelect, true);
    document.removeEventListener('touchend', onSelect, true);

    const overlay = document.createElement('div');
    overlay.id = '_target-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#0a0a0a;border:1px solid '+borderColor+';border-radius:12px;padding:20px;max-width:320px;width:100%;text-align:center;';

    // カード画像
    const imgSrc = card ? (card.imgSrc || getCardImageUrl(card) || card.imageUrl || '') : '';
    const _pc = (card.playCost != null) ? card.playCost : (card.cost != null ? card.cost : null);
    let _statsHtml = 'Lv.'+(card.level||'?')+' ／ DP:'+(card.dp||'?')+' ／ 登場コスト:'+(_pc != null ? _pc : '—');
    if (card.evolveCost != null) {
      const _cond = (card.evolveCond || '').trim();
      const _condEsc = _cond.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      _statsHtml += '<br><span style="color:#00ff88;">進化コスト：' + (_cond ? _condEsc + 'から' : '') + card.evolveCost + '</span>';
    }
    box.innerHTML = (imgSrc ? '<img src="'+imgSrc+'" style="width:160px;border-radius:8px;margin-bottom:12px;border:1px solid '+borderColor+';">' : '')
      + '<div style="color:#fff;font-weight:bold;font-size:14px;margin-bottom:8px;">'+(card.name||'不明')+' ('+(card.cardNo||'')+')</div>'
      + '<div style="font-size:12px;color:'+borderColor+';margin-bottom:10px;line-height:1.5;">'+_statsHtml+'</div>';

    // 効果
    if (card.effect && card.effect !== 'なし') {
      box.innerHTML += '<div style="font-size:11px;color:#ddd;line-height:1.7;margin-bottom:10px;text-align:left;background:#111;padding:10px;border-radius:6px;border:1px solid #333;">'
        + '<div style="color:'+borderColor+';font-size:10px;margin-bottom:4px;font-weight:bold;">効果</div>' + card.effect + '</div>';
    }
    // 進化元効果
    if (card.evoSourceEffect && card.evoSourceEffect !== 'なし') {
      box.innerHTML += '<div style="font-size:11px;color:#aaa;line-height:1.7;margin-bottom:10px;text-align:left;background:#0a0a0a;padding:10px;border-radius:6px;border:1px solid #222;">'
        + '<div style="color:#ffaa00;font-size:10px;margin-bottom:4px;font-weight:bold;">進化元効果</div>' + card.evoSourceEffect + '</div>';
    }

    // 確認ボタン
    box.innerHTML += '<div style="color:'+borderColor+';font-size:14px;font-weight:bold;margin:16px 0 12px;">このカードでいいですか？</div>'
      + '<div style="display:flex;gap:10px;justify-content:center;">'
      + '<button id="_target-yes" style="background:'+borderColor+';color:#000;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">はい</button>'
      + '<button id="_target-no" style="background:#333;color:#fff;border:1px solid #666;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;">いいえ</button>'
      + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // 背景クリックでは何もしない（ボタンのみ反応）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) e.stopPropagation();
    });

    // チュートリアル: 確認ダイアログ表示中の割り込み (効果確認/対象確認を統一)
    if (typeof window !== 'undefined' && window._tutorialRunner && window._tutorialRunner.active
        && typeof window._tutorialRunner.checkInterrupt === 'function') {
      try { window._tutorialRunner.checkInterrupt('confirm_dialog'); } catch (_) {}
    }

    function cleanupConfirm() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    document.getElementById('_target-yes').addEventListener('click', (e) => {
      e.stopPropagation();
      cleanupConfirm();
      setTimeout(() => onResult(true), 50);
    });
    document.getElementById('_target-no').addEventListener('click', (e) => {
      e.stopPropagation();
      cleanupConfirm();
      setTimeout(() => {
        document.addEventListener('click', onSelect, true);
        document.addEventListener('touchend', onSelect, true);
      }, 100);
      setTimeout(() => onResult(false), 50);
    });
  }

  function cleanup() {
    _targetSelecting = false;
    // 対象選択完了 → 相手の対象選択中ポップアップ + 効果発動ポップアップを閉じる
    // ただし、_skipFxEffectCloseフラグが立っている場合（複数選択途中等）は閉じない
    if (window._isOnlineMode && window._isOnlineMode() && !window._skipFxEffectClose) {
      window._onlineSendCommand({ type: 'fx_targetSelectEnd' });
      window._onlineSendCommand({ type: 'fx_effectClose' });
    }
    if (msgEl.parentNode) msgEl.parentNode.removeChild(msgEl);
    validIndices.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      slot.style.border = '';
      slot.style.boxShadow = '';
      slot.style.cursor = '';
      slot.style.transform = '';
      // 強制適用した pointer-events / opacity を解除（spotlight 復帰可能）
      slot.style.removeProperty('pointer-events');
      slot.style.removeProperty('opacity');
      slot.onmouseenter = null;
      slot.onmouseleave = null;
    });
    document.removeEventListener('click', onSelect, true);
    document.removeEventListener('touchend', onSelect, true);
  }

  // 少し遅延させてイベント登録（直前のクリックと被らないように）
  setTimeout(() => {
    document.addEventListener('click', onSelect, true);
    document.addEventListener('touchend', onSelect, true);
  }, 100);
  }; // end _showUI

  // チュートリアル: 対象選択画面の前に割り込み
  // 先に対象選択UIを起動してから割り込みを走らせる。
  // そうしないと、チュートリアルステップが effect_target_selected で進む設定の時、
  // そのイベントを発火する _showUI がまだ走っていないため永遠にステップが進まない。
  const runner = window._tutorialRunner;
  if (runner && runner.active && typeof runner.checkInterrupt === 'function') {
    _showUI();
    // 相手ターン中の対象選択（セキュリティ効果等）は opp_target_selection を使う
    const isOppTurn = !(window.bs && window.bs.isPlayerTurn);
    const triggerKey = isOppTurn ? 'opp_target_selection' : 'target_selection';
    runner.checkInterrupt(triggerKey);
  } else {
    _showUI();
  }
}

// ===== デッキオープンUI（新仕様: filter/selections/return_to対応） =====
// レシピ仕様: { value, optional, selections:[{filter,count,destination}], return_to }
// セミ自動: フィルタにマッチするカードのみタップ可能、残りはタップ順にデッキへ戻す

// カードがフィルタにマッチするか判定
// 「N体まで」式の対象選択ヘルパー
// ギガデストロイヤー (select_multi) と同じ UX:
//   - 1体目: 確認なしで即選択画面
//   - 2体目以降: 「もう1体選びますか？（残りN体まで）」確認ダイアログ
// rowSide: 'pl' | 'ai' (どちら側の battleArea を選択対象にするか)
// validIndices: 選択候補のインデックス配列
// maxCount: 最大選択数
// onPicked: (chosenIdxArr) => void
function pickUpToNTargets(rowSide, validIndices, maxCount, color, onPicked) {
  const picked = [];
  function showAskDialog(msgText, onYes, onNo) {
    const overlay = document.createElement('div');
    overlay.id = '_select-multi-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;padding:20px;';
    const box = document.createElement('div');
    box.id = '_select-multi-confirm-panel';
    box.style.cssText = 'background:#0a0a0a;border:1px solid ' + color + ';border-radius:12px;padding:24px;max-width:320px;width:100%;text-align:center;';
    box.innerHTML = '<div style="color:' + color + ';font-size:14px;font-weight:bold;margin-bottom:16px;">' + msgText + '</div>'
      + '<div style="display:flex;gap:10px;justify-content:center;">'
      + '<button id="_select-multi-yes" style="background:' + color + ';color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">はい</button>'
      + '<button id="_select-multi-no" style="background:#333;color:#fff;border:1px solid #666;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;">いいえ</button>'
      + '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('_select-multi-yes').onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); onYes(); };
    document.getElementById('_select-multi-no').onclick  = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); onNo(); };
  }
  function pickOne() {
    if (picked.length >= maxCount) { onPicked(picked.slice()); return; }
    const remaining = validIndices.filter(i => !picked.includes(i));
    if (remaining.length === 0) { onPicked(picked.slice()); return; }
    showTargetSelection(rowSide, remaining, null, color, (selectedIdx) => {
      if (selectedIdx == null) { onPicked(picked.slice()); return; }
      picked.push(selectedIdx);
      // 上限到達 or 候補なし → 終了
      if (picked.length >= maxCount) { onPicked(picked.slice()); return; }
      const stillValid = validIndices.filter(i => !picked.includes(i));
      if (stillValid.length === 0) { onPicked(picked.slice()); return; }
      // 2体目以降: 「もう1体選びますか？」確認
      const remainSlot = maxCount - picked.length;
      showAskDialog('もう1体選びますか？（残り' + remainSlot + '体まで）',
        () => pickOne(),
        () => onPicked(picked.slice())
      );
    });
  }
  pickOne();
}

// カード詳細を表示し、決定/キャンセルで選択するダイアログ
function _showCardConfirmDialog(card, onConfirm) {
  const conf = document.createElement('div');
  conf.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:62500;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.15s ease;';
  const src = card.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(card) : '') || card.imageUrl || '';
  const colorBadge = card.color ? `<span style="background:rgba(255,204,0,0.2);color:#ffcc00;border:1px solid #ffcc0066;border-radius:3px;padding:1px 6px;font-size:10px;margin-right:4px;">${card.color}</span>` : '';
  const lvText = card.level ? `Lv.${card.level}` : '';
  const dpText = card.dp ? `DP ${card.dp}` : '';
  const typeText = card.type || '';
  const stats = [lvText, typeText, dpText].filter(Boolean).join(' / ');
  const effHtml = card.effect && card.effect !== 'なし'
    ? `<div style="color:#00fbff;font-size:10px;margin-bottom:4px;font-weight:bold;">効果</div>${card.effect}`
    : '<span style="color:#666;">効果なし</span>';
  const evoHtml = (card.evoSourceEffect && card.evoSourceEffect !== 'なし')
    ? `<div style="margin-top:8px;color:#ffaa00;font-size:10px;font-weight:bold;">進化元効果</div>${card.evoSourceEffect}`
    : '';
  const cardBox = document.createElement('div');
  cardBox.style.cssText = 'background:#0a0a0a;border:2px solid #ffcc00;border-radius:12px;padding:18px;max-width:300px;width:90%;text-align:center;box-shadow:0 0 30px rgba(255,204,0,0.45);max-height:70vh;overflow-y:auto;';
  cardBox.innerHTML = `
    ${src ? `<img src="${src}" style="width:200px;max-width:100%;border-radius:8px;margin-bottom:10px;">` : ''}
    <div style="color:#fff;font-size:14px;font-weight:bold;margin-bottom:4px;">${card.name || '?'}</div>
    <div style="color:#888;font-size:10px;font-family:monospace;margin-bottom:6px;">${card.cardNo || ''}</div>
    <div style="margin-bottom:8px;">${colorBadge}<span style="color:#aaa;font-size:11px;">${stats}</span></div>
    <div style="color:#ddd;font-size:11px;text-align:left;background:#111;padding:8px;border-radius:6px;line-height:1.5;">${effHtml}${evoHtml}</div>
  `;
  conf.appendChild(cardBox);
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;margin-top:14px;';
  const okBtn = document.createElement('button');
  okBtn.innerText = '✓ このカードに決定';
  okBtn.style.cssText = 'background:#00ff88;color:#000;border:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
  okBtn.onclick = () => { if (conf.parentNode) conf.parentNode.removeChild(conf); onConfirm && onConfirm(); };
  const cancelBtn = document.createElement('button');
  cancelBtn.innerText = '✕ キャンセル';
  cancelBtn.style.cssText = 'background:#555;color:#fff;border:1px solid #888;padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;';
  cancelBtn.onclick = () => { if (conf.parentNode) conf.parentNode.removeChild(conf); };
  btnRow.appendChild(okBtn);
  btnRow.appendChild(cancelBtn);
  conf.appendChild(btnRow);
  document.body.appendChild(conf);
}

// 手札からN枚選んで破棄する UI（cost_discard 用）
// hand: プレイヤーの手札配列のスナップショット
// wantCount: 破棄枚数
// callback: (picked[]) => void  キャンセルは null
function showHandDiscardPicker(hand, wantCount, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:62000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.2s ease;';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#ff9900;font-size:14px;font-weight:bold;margin-bottom:8px;text-shadow:0 0 8px #ff9900;';
  titleEl.innerText = '🗑 手札から ' + wantCount + ' 枚破棄';
  overlay.appendChild(titleEl);
  const sub = document.createElement('div');
  sub.style.cssText = 'color:#ffaa00;font-size:11px;margin-bottom:12px;';
  sub.innerText = '0/' + wantCount + ' 選択';
  overlay.appendChild(sub);
  const cardArea = document.createElement('div');
  cardArea.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:90%;max-height:60vh;overflow-y:auto;background:rgba(0,15,25,0.8);border:1px solid #ff990044;border-radius:12px;padding:12px;margin-bottom:12px;';
  overlay.appendChild(cardArea);
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';
  overlay.appendChild(btnRow);

  const picked = [];
  const getImg = (c) => c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || c.imageUrl || '';
  const cleanup = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
  hand.forEach(card => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:80px;height:112px;border:2px solid #444;border-radius:6px;overflow:hidden;cursor:pointer;background:#111;transition:all 0.2s;';
    const src = getImg(card);
    wrap.innerHTML = src
      ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">'
      : '<div style="padding:6px;font-size:9px;color:#aaa;">' + (card.name||'') + '</div>';
    wrap.onclick = () => {
      const idx = picked.indexOf(card);
      if (idx !== -1) {
        picked.splice(idx, 1);
        wrap.style.border = '2px solid #444';
        wrap.style.boxShadow = '';
      } else {
        if (picked.length >= wantCount) return;
        picked.push(card);
        wrap.style.border = '2px solid #ff9900';
        wrap.style.boxShadow = '0 0 12px #ff9900aa';
        // wantCount に達したら自動確定
        if (picked.length >= wantCount) {
          setTimeout(() => { cleanup(); callback(picked.slice()); }, 200);
          return;
        }
      }
      sub.innerText = picked.length + '/' + wantCount + ' 選択';
    };
    cardArea.appendChild(wrap);
  });
  document.body.appendChild(overlay);
}

// トラッシュからフィルタ済み候補をN枚選ばせる UI
// candidates: 表示するカード配列（既にフィルタ済）
// wantCount: 選択する枚数
// optional: true なら「使わない」ボタン表示
// title: 上部に表示するメッセージ
// callback: (chosenCards[]) => void  キャンセル時は [] or null を渡す
// fullTrash: 全トラッシュ配列（指定すれば既存の trash-modal を使い対象だけハイライト表示）
function showTrashCardPicker(candidates, wantCount, optional, title, callback, fullTrash) {
  // 既存 trash-modal を使うインプレース版
  const modal = document.getElementById('trash-modal');
  if (modal && Array.isArray(fullTrash) && fullTrash.length > 0) {
    const titleEl = document.getElementById('trash-modal-title');
    const grid = document.getElementById('trash-modal-grid');
    const closeBtn = document.getElementById('trash-close-btn');
    if (titleEl) titleEl.innerText = (title || '🌟 カードを選択') + `（候補${candidates.length}枚 / 最大${wantCount}枚選択）`;
    const candSet = new Set(candidates);
    const picked = [];
    const renderItems = () => {
      if (!grid) return;
      grid.innerHTML = '';
      fullTrash.forEach((c) => {
        if (!c) return;
        const wrap = document.createElement('div');
        const isCand = candSet.has(c);
        const isPicked = picked.includes(c);
        const borderColor = isPicked ? '#00ff88' : (isCand ? '#ffcc00' : 'transparent');
        const opacity = isCand ? '1' : '0.35';
        const cursor = isCand ? 'pointer' : 'not-allowed';
        const shadow = isPicked ? '0 0 14px #00ff88aa' : (isCand ? '0 0 8px #ffcc0099' : 'none');
        wrap.style.cssText = `text-align:center;cursor:${cursor};padding:3px;border:2px solid ${borderColor};border-radius:6px;opacity:${opacity};transition:all 0.2s;box-shadow:${shadow};`;
        const src = c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || c.imageUrl || '';
        wrap.innerHTML = (src
          ? `<img src="${src}" style="width:100%;border-radius:4px;">`
          : `<div style="height:60px;background:#111;display:flex;align-items:center;justify-content:center;font-size:7px;color:#aaa;">${c.name||''}</div>`
        ) + `<div style="font-size:7px;color:#888;margin-top:2px;">${c.name||''}</div>`;
        if (isCand) {
          wrap.onclick = () => {
            // 既に選択済みなら確認なしで解除
            const pi = picked.indexOf(c);
            if (pi >= 0) { picked.splice(pi, 1); renderItems(); return; }
            // 上限到達ならスキップ
            if (picked.length >= wantCount) return;
            // カード詳細＋決定/キャンセルダイアログを開く
            _showCardConfirmDialog(c, () => {
              picked.push(c);
              // 指定枚数に達した時点で自動確定
              if (picked.length >= wantCount) {
                cleanup();
                callback(picked.slice());
                return;
              }
              renderItems();
            });
          };
        }
        grid.appendChild(wrap);
      });
    };
    renderItems();
    // 既存の「閉じる」ボタンは DOM から一時退避（×印もこの ID で兼用しているケースを考慮）
    let closeBtnHomeParent = null, closeBtnHomeNext = null;
    if (closeBtn && closeBtn.parentNode) {
      closeBtnHomeParent = closeBtn.parentNode;
      closeBtnHomeNext = closeBtn.nextSibling;
      closeBtn.parentNode.removeChild(closeBtn);
    }
    // optional のときだけ「⏭ 使わない」ボタンを表示。
    // それ以外は各カード詳細ダイアログの「このカードで決定」が確定操作を兼ねる。
    let actionRow = null, skipBtn = null;
    if (optional) {
      actionRow = document.createElement('div');
      actionRow.id = '_trash-picker-actions';
      actionRow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:10px;';
      skipBtn = document.createElement('button');
      skipBtn.innerText = '⏭ 使わない';
      skipBtn.style.cssText = 'background:#555;color:#fff;border:1px solid #888;padding:10px 22px;border-radius:6px;font-size:13px;cursor:pointer;';
      actionRow.appendChild(skipBtn);
      if (closeBtnHomeParent) closeBtnHomeParent.appendChild(actionRow); else modal.appendChild(actionRow);
    }
    // オンライン同期: トラッシュ選択中は相手画面の「効果発動ポップアップ」を閉じない
    // （複数枚選択の途中で消えないようフラグで保護し、最終確定時にまとめて閉じる）
    const _onlinePickerActive = !!(window._isOnlineMode && window._isOnlineMode());
    if (_onlinePickerActive) window._skipFxEffectClose = true;
    const cleanup = () => {
      modal.style.display = 'none';
      if (actionRow && actionRow.parentNode) actionRow.parentNode.removeChild(actionRow);
      // 元の閉じるボタンを元の場所に戻す（次回の通常のトラッシュ閲覧用）
      if (closeBtn && closeBtnHomeParent) {
        try { closeBtnHomeParent.insertBefore(closeBtn, closeBtnHomeNext); } catch(_) { closeBtnHomeParent.appendChild(closeBtn); }
      }
      // 最終確定時のみ相手画面のポップアップを閉じる。
      // ただし後続の登場演出 / カード移動演出が呼び出す play/state_sync コマンドより
      // 先に届いて演出が抑止されないよう、1tick 遅延 → さらに少し余裕を持たせる
      if (_onlinePickerActive) {
        window._skipFxEffectClose = false;
        setTimeout(() => {
          try { window._onlineSendCommand && window._onlineSendCommand({ type: 'fx_effectClose' }); } catch(_) {}
        }, 50);
      }
    };
    if (skipBtn) skipBtn.onclick = () => { cleanup(); callback([]); };
    modal.style.display = 'block';
    return;
  }
  // フォールバック: 旧版オーバーレイ（fullTrashが指定されない場合）
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:62000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.2s ease;';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;margin-bottom:8px;text-shadow:0 0 8px #00fbff;';
  titleEl.innerText = title || '🃏 カードを選択';
  overlay.appendChild(titleEl);

  const sub = document.createElement('div');
  sub.style.cssText = 'color:#ffaa00;font-size:11px;margin-bottom:12px;';
  sub.innerText = '対象: ' + candidates.length + '枚（最大' + wantCount + '枚選択）';
  overlay.appendChild(sub);

  const cardArea = document.createElement('div');
  cardArea.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:90%;max-height:60vh;overflow-y:auto;background:rgba(0,15,25,0.8);border:1px solid #00fbff44;border-radius:12px;padding:12px;margin-bottom:12px;';
  overlay.appendChild(cardArea);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';
  overlay.appendChild(btnRow);

  const picked = [];
  const getImg = (c) => c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || c.imageUrl || '';
  const wraps = candidates.map(card => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:80px;height:112px;border:2px solid #444;border-radius:6px;overflow:hidden;cursor:pointer;background:#111;transition:all 0.2s;';
    const src = getImg(card);
    if (src) {
      wrap.innerHTML = '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">';
    } else {
      wrap.innerHTML = '<div style="padding:6px;font-size:9px;color:#aaa;">' + card.name + '</div>';
    }
    wrap.onclick = () => {
      const idx = picked.indexOf(card);
      if (idx !== -1) {
        picked.splice(idx, 1);
        wrap.style.border = '2px solid #444';
        wrap.style.boxShadow = '';
      } else {
        if (picked.length >= wantCount) return;
        picked.push(card);
        wrap.style.border = '2px solid #00ff88';
        wrap.style.boxShadow = '0 0 12px #00ff88aa';
      }
      sub.innerText = '対象: ' + candidates.length + '枚（' + picked.length + '/' + wantCount + ' 選択）';
    };
    cardArea.appendChild(wrap);
    return wrap;
  });

  function cleanup() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  const okBtn = document.createElement('button');
  okBtn.innerText = '✓ 決定';
  okBtn.style.cssText = 'background:#00ff88;color:#000;border:none;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
  okBtn.onclick = () => { cleanup(); callback(picked.slice()); };
  btnRow.appendChild(okBtn);
  if (optional) {
    const skipBtn = document.createElement('button');
    skipBtn.innerText = '⏭ 使わない';
    skipBtn.style.cssText = 'background:#555;color:#fff;border:1px solid #888;padding:10px 22px;border-radius:6px;font-size:13px;cursor:pointer;';
    skipBtn.onclick = () => { cleanup(); callback([]); };
    btnRow.appendChild(skipBtn);
  }
  document.body.appendChild(overlay);
}

function cardMatchesFilter(card, filter) {
  if (!filter) return true;
  if (filter.type && card.type !== filter.type) return false;
  if (Array.isArray(filter.type_in) && !filter.type_in.includes(card.type)) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.cardno && card.cardNo !== filter.cardno) return false;
  if (filter.cardno_includes && !(card.cardNo || '').includes(filter.cardno_includes)) return false;
  if (filter.name && card.name !== filter.name) return false;
  const _nameInc = filter.name_includes || filter.name_contains;
  if (_nameInc && !(card.name || '').includes(_nameInc)) return false;
  if (filter.lv_ge != null && (parseInt(card.level) || 0) < filter.lv_ge) return false;
  if (filter.lv_le != null && (parseInt(card.level) || 0) > filter.lv_le) return false;
  if (filter.lv != null && (parseInt(card.level) || 0) !== filter.lv) return false;
  // コスト系: cost (登場/使用コスト) のフィルタ
  const cardCost = (card.playCost != null ? card.playCost : (card.cost || 0));
  if (filter.cost != null && cardCost !== filter.cost) return false;
  if (filter.cost_le != null && cardCost > filter.cost_le) return false;
  if (filter.cost_ge != null && cardCost < filter.cost_ge) return false;
  if (Array.isArray(filter.cost_in) && !filter.cost_in.includes(cardCost)) return false;
  // 特徴: 「竜人型/四大竜」のようにスラッシュ区切り
  const cardFeatures = (card.feature || '').split(/[\/、,]/).map(s => s.trim()).filter(s => s);
  if (filter.feature) {
    const wanted = Array.isArray(filter.feature) ? filter.feature : [filter.feature];
    if (!wanted.some(w => cardFeatures.includes(w))) return false;
  }
  if (filter.feature_includes) {
    const wanted = Array.isArray(filter.feature_includes) ? filter.feature_includes : [filter.feature_includes];
    if (!wanted.some(w => cardFeatures.some(f => f.includes(w)))) return false;
  }
  return true;
}

// 新 deck_open UI 関数
// step: { value, selections, return_to, optional }
function showDeckOpenUI(opened, step, ctx, callback) {
  const player = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
  const getImg = (c) => c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || c.imageUrl || '';
  const selections = Array.isArray(step.selections) ? step.selections : [];
  const returnTo = step.return_to || 'deck_bottom';

  // 「オープン」効果は両プレイヤーに公開されるため、自分側プレイヤー操作時は相手画面にも観戦UIを送る
  const isOnlineSelf = () => ctx.side === 'player' && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand;
  const sendRemote = (cmd) => {
    // private: セキュリティ非公開確認（高石タケル等）→ 中身を相手に送らない。
    // 公開はオプション側（security_open）が選択カードのみ個別に行う。
    if (step.private) return;
    if (!isOnlineSelf()) {
      console.log('[deckOpen sendRemote] skip', { ctxSide: ctx.side, online: !!(window._isOnlineMode && window._isOnlineMode()), hasSend: !!window._onlineSendCommand });
      return;
    }
    console.log('[deckOpen sendRemote] sending', cmd.type, cmd);
    try { window._onlineSendCommand(cmd); } catch (e) { console.error('[deckOpen sendRemote] error', e); }
  };
  // 開始通知: 全 opened カードを表向きで相手に公開
  sendRemote({
    type: 'fx_remoteDeckOpenStart',
    sourceCardName: ctx.card ? ctx.card.name : '',
    cards: opened.map(c => ({ cardNo: c.cardNo, name: c.name, imgSrc: getImg(c) })),
  });

  // === オーバーレイ ===
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:60000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.2s ease;';
  document.body.appendChild(overlay);

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;margin-bottom:8px;text-shadow:0 0 8px #00fbff;';
  titleEl.innerText = step.private
    ? '🛡 セキュリティを確認 (' + opened.length + '枚) — 相手には非公開'
    : '📖 デッキオープン (' + opened.length + '枚)';
  overlay.appendChild(titleEl);

  const stepEl = document.createElement('div');
  stepEl.style.cssText = 'color:#ffaa00;font-size:11px;margin-bottom:12px;text-align:center;max-width:90%;';
  overlay.appendChild(stepEl);

  const cardArea = document.createElement('div');
  cardArea.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;background:rgba(0,15,25,0.85);border:1px solid #00fbff44;border-radius:12px;padding:14px 20px;margin-bottom:12px;';
  overlay.appendChild(cardArea);

  const buttonArea = document.createElement('div');
  buttonArea.style.cssText = 'display:flex;gap:8px;';
  overlay.appendChild(buttonArea);

  // === 裏→表めくれ演出用のCSSキーフレーム挿入（重複追加防止） ===
  if (!document.getElementById('deck-open-flip-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'deck-open-flip-style';
    styleEl.textContent = `
      @keyframes deckOpenFlip {
        0% { transform: rotateY(0deg); }
        50% { transform: rotateY(90deg); }
        50.01% { transform: rotateY(-90deg); }
        100% { transform: rotateY(0deg); }
      }
      .deck-open-card-flipping { animation: deckOpenFlip 360ms ease-in-out forwards; transform-style: preserve-3d; }
    `;
    document.head.appendChild(styleEl);
  }

  // カード要素を作成（最初は裏向き → 1枚ずつ表にめくる）
  const cardEls = opened.map(card => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:90px;height:126px;border:2px solid #444;border-radius:6px;overflow:hidden;cursor:default;transition:border 0.2s, box-shadow 0.2s;background:linear-gradient(135deg,#0a1f2e 0%,#142838 50%,#0a1f2e 100%);position:relative;';
    // 裏面の装飾
    const back = document.createElement('div');
    back.className = 'deck-open-card-back';
    back.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#00fbff66;font-size:36px;font-weight:bold;text-shadow:0 0 6px #00fbff44;';
    back.innerText = '◆';
    wrap.appendChild(back);
    cardArea.appendChild(wrap);
    return { wrap, card, removed: false, _flipped: false, _back: back };
  });

  function buildFront(entry) {
    if (entry._flipped) return;
    entry._flipped = true;
    // 中身を表に差し替え
    while (entry.wrap.firstChild) entry.wrap.removeChild(entry.wrap.firstChild);
    entry.wrap.style.background = '#111';
    const src = getImg(entry.card);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      entry.wrap.appendChild(img);
    } else {
      const fb = document.createElement('div');
      fb.style.cssText = 'padding:6px;font-size:9px;color:#aaa;';
      fb.innerText = entry.card.name;
      entry.wrap.appendChild(fb);
    }
  }

  function flipAll(done) {
    let idx = 0;
    const FLIP_INTERVAL = 220;     // 次のカードへ移るまでの待ち時間
    const FLIP_HALFWAY  = 180;     // アニメ中盤で中身を差し替える時間
    function flipNext() {
      if (idx >= cardEls.length) {
        // 全フリップ完了後に少し見せてから次フェーズへ
        setTimeout(done, 250);
        return;
      }
      const entry = cardEls[idx++];
      entry.wrap.classList.add('deck-open-card-flipping');
      setTimeout(() => buildFront(entry), FLIP_HALFWAY);
      setTimeout(() => {
        entry.wrap.classList.remove('deck-open-card-flipping');
        flipNext();
      }, FLIP_INTERVAL);
    }
    flipNext();
  }

  function setCardActive(entry) {
    entry.wrap.style.border = '2px solid #00ff88';
    entry.wrap.style.boxShadow = '0 0 14px rgba(0,255,136,0.6)';
    entry.wrap.style.cursor = 'pointer';
    entry.wrap.style.opacity = '1';
  }
  function setCardDimmed(entry) {
    entry.wrap.style.border = '2px solid #444';
    entry.wrap.style.boxShadow = '';
    entry.wrap.style.cursor = 'default';
    entry.wrap.style.opacity = '0.4';
  }
  function setCardNeutral(entry) {
    entry.wrap.style.border = '2px solid #444';
    entry.wrap.style.boxShadow = '';
    entry.wrap.style.cursor = 'default';
    entry.wrap.style.opacity = '1';
    entry.wrap.onclick = null;
  }
  function setCardReturnable(entry) {
    entry.wrap.style.border = '2px solid #00fbff';
    entry.wrap.style.boxShadow = '0 0 12px rgba(0,251,255,0.6)';
    entry.wrap.style.cursor = 'pointer';
    entry.wrap.style.opacity = '1';
  }

  function removeEntry(entry) {
    entry.removed = true;
    if (entry.wrap.parentNode) entry.wrap.parentNode.removeChild(entry.wrap);
  }

  function clearButtons() {
    while (buttonArea.firstChild) buttonArea.removeChild(buttonArea.firstChild);
  }

  // === 選択フェーズ ===
  let selIdx = 0;
  let _selectionDoneFired = false;
  function runSelectionPhase() {
    if (selIdx >= selections.length) {
      // 選択フェーズ完了（戻しフェーズの前）→ フックを1回だけ発火
      if (!_selectionDoneFired && typeof step._onSelectionDone === 'function') {
        _selectionDoneFired = true;
        try { step._onSelectionDone(); } catch (_) {}
      }
      runReturnPhase();
      return;
    }
    const sel = selections[selIdx];
    selIdx++;
    const filter = sel.filter || {};
    const maxCount = sel.count === 'all' ? 999 : (sel.count || 1);
    const isOptional = !!sel.optional;
    const dest = sel.destination || 'hand';

    const matching = cardEls.filter(e => !e.removed && cardMatchesFilter(e.card, filter));
    if (matching.length === 0) {
      ctx.addLog && ctx.addLog('⏸ 条件を満たすカードがありません。次へ');
      runSelectionPhase();
      return;
    }

    let pickedCount = 0;

    function refreshSelectUI() {
      stepEl.innerText = 'ステップ ' + selIdx + '/' + selections.length + ': ' + describeFilter(filter) + ' を ' + maxCount + '枚選択 (' + pickedCount + '/' + maxCount + ')';
      cardEls.forEach(e => {
        if (e.removed) return;
        if (cardMatchesFilter(e.card, filter)) setCardActive(e);
        else setCardDimmed(e);
      });
      clearButtons();
      const skipLabel = isOptional ? '⏭ スキップ' : (pickedCount > 0 ? '✓ 完了' : null);
      if (skipLabel) {
        const btn = document.createElement('button');
        btn.innerText = skipLabel;
        btn.style.cssText = 'background:#005566;color:#fff;border:1px solid #00fbff;padding:8px 18px;border-radius:6px;font-size:13px;cursor:pointer;';
        btn.onclick = () => {
          cardEls.forEach(e => { if (!e.removed) setCardNeutral(e); });
          runSelectionPhase();
        };
        buttonArea.appendChild(btn);
      }
      // タップリスナー
      cardEls.forEach(entry => {
        if (entry.removed) return;
        if (!cardMatchesFilter(entry.card, filter)) { entry.wrap.onclick = null; return; }
        entry.wrap.onclick = () => {
          if (entry.removed) return;
          // 進化選択（ジャガモン等「デッキオープンで選んだカードに進化」）
          if (sel.action === 'evolve') {
            const _base = ctx.card;
            const _slot = _base ? player.battleArea.indexOf(_base) : -1;
            if (_slot < 0) { ctx.addLog && ctx.addLog('⚠ 進化元がバトルエリアにいません'); return; }
            // base を選んだカードに進化させる（コスト無し・特殊進化）
            const _evolved = Object.assign({}, entry.card, {
              suspended: _base.suspended,
              summonedThisTurn: _base.summonedThisTurn,
              buffs: _base.buffs || [],
              dpModifier: _base.dpModifier || 0,
              stack: [_base].concat(_base.stack || []),
            });
            _evolved.baseDp = parseInt(entry.card.dp) || parseInt(entry.card.baseDp) || 0;
            _evolved.dp = _evolved.baseDp + (_evolved.dpModifier || 0);
            player.battleArea[_slot] = _evolved;
            if (ctx.bs) ctx.bs._evolveCountThisTurn = (ctx.bs._evolveCountThisTurn || 0) + 1;
            ctx.addLog && ctx.addLog('⬆ 「' + _base.name + '」→「' + _evolved.name + '」進化！（コスト無し）');
            sendRemote({ type: 'fx_remoteDeckOpenAct', cardNo: entry.card.cardNo, name: entry.card.name, to: 'evolve' });
            // オンライン: 相手画面に進化演出を通知（盤面自体は効果完了後の state_sync で同期）
            if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
              try { window._onlineSendCommand({ type: 'evolve', cardName: _evolved.name, baseName: _base.name, cardImg: _evolved.imgSrc || '', evolveCost: 0 }); } catch (_) {}
            }
            removeEntry(entry);
            pickedCount++;
            ctx.renderAll && ctx.renderAll();
            const _contAfterEvo = () => {
              cardEls.forEach(e => { if (!e.removed) setCardNeutral(e); });
              runSelectionPhase();
            };
            // on_evolve はキューに積むだけにする。inline processQueue は deck_open の
            // 進行フロー（戻しフェーズ）と再入して UI が固まるため呼ばない
            // （積まれた効果は外側の効果処理ループが後で拾う）。
            try { scanTriggers('on_evolve', _evolved, ctx.side, ctx); } catch (_) {}
            // 自分の画面でも進化演出を表示（相手画面は上の evolve コマンドで表示）
            const _showEvo = (ctx && ctx.showEvolveEffect) || (typeof window !== 'undefined' && window.showEvolveEffect);
            if (_showEvo) { try { _showEvo(0, _base.name, _base, _evolved, _contAfterEvo); } catch (_) { _contAfterEvo(); } }
            else _contAfterEvo();
            return;
          }
          // 実際の移動処理 + 後続フロー
          const proceed = () => {
            if (dest === 'hand') player.hand.push(entry.card);
            else if (dest === 'trash') player.trash.push(entry.card);
            ctx.addLog && ctx.addLog('🃏 「' + entry.card.name + '」を' + (dest === 'hand' ? '手札に加えた' : 'トラッシュへ'));
            removeEntry(entry);
            pickedCount++;
            ctx.renderAll && ctx.renderAll();
            if (pickedCount >= maxCount) {
              cardEls.forEach(e => { if (!e.removed) setCardNeutral(e); });
              runSelectionPhase();
              return;
            }
            const stillMatching = cardEls.filter(e => !e.removed && cardMatchesFilter(e.card, filter));
            if (stillMatching.length === 0) {
              cardEls.forEach(e => { if (!e.removed) setCardNeutral(e); });
              runSelectionPhase();
            } else {
              refreshSelectUI();
            }
          };
          // 相手画面にもどこへ移動したか通知（カード移動演出付き）
          sendRemote({ type: 'fx_remoteDeckOpenAct', cardNo: entry.card.cardNo, name: entry.card.name, to: dest });
          // 「カード移動演出」を挟む（hand / trash のみ。fxCardMove が無い環境ではフォールバック）
          if ((dest === 'hand' || dest === 'trash') && window._fxCardMove) {
            const toLabel = dest === 'hand' ? '手札' : 'トラッシュ';
            // 選択カードを一旦dimして演出に集中させる
            entry.wrap.style.transition = 'opacity 0.15s';
            entry.wrap.style.opacity = '0.3';
            window._fxCardMove(entry.card, 'デッキ', toLabel, proceed);
          } else {
            proceed();
          }
        };
      });
    }

    refreshSelectUI();
  }

  function describeFilter(f) {
    const parts = [];
    if (f.type) parts.push(f.type);
    if (f.color) parts.push(f.color);
    if (f.feature) parts.push('特徴:' + (Array.isArray(f.feature) ? f.feature.join('/') : f.feature));
    if (f.feature_includes) parts.push('特徴含:' + (Array.isArray(f.feature_includes) ? f.feature_includes.join('/') : f.feature_includes));
    if (f.lv_ge != null) parts.push('Lv' + f.lv_ge + '以上');
    if (f.lv_le != null) parts.push('Lv' + f.lv_le + '以下');
    if (f.name) parts.push('名前:' + f.name);
    if (f.name_includes) parts.push('名前含:' + f.name_includes);
    return parts.length > 0 ? parts.join(' / ') : '任意のカード';
  }

  // === 戻しフェーズ ===
  // return_to の値別挙動:
  //   'trash'             : 全てトラッシュへ自動移動（操作なし）
  //   'deck_top'          : タップした順にデッキ上から積まれる
  //   'deck_bottom'       : ポップアップ無しで自動的にデッキ下へ自動送出（短アニメ）
  //   'deck_choice'       : 「好きな順番で」記載 → タップした順にデッキ下へ（ポップアップ無し）
  //   'deck_top_or_bottom': 「上か下に戻す」記載 → 1枚ずつポップアップで上下選択
  function runReturnPhase() {
    const remaining = cardEls.filter(e => !e.removed);
    if (remaining.length === 0) { cleanup(); callback(); return; }
    if (returnTo === 'trash') {
      remaining.forEach(e => {
        sendRemote({ type: 'fx_remoteDeckOpenAct', cardNo: e.card.cardNo, name: e.card.name, to: 'trash' });
        player.trash.push(e.card);
        ctx.addLog && ctx.addLog('🗑 「' + e.card.name + '」をトラッシュへ');
        removeEntry(e);
      });
      ctx.renderAll && ctx.renderAll();
      cleanup(); callback();
      return;
    }
    const placeFn = (card, position) => {
      if (position === 'top') player.deck.unshift(card);
      else player.deck.push(card);
      ctx.addLog && ctx.addLog('📥 「' + card.name + '」をデッキの' + (position === 'top' ? '上' : '下') + 'へ');
      // 相手画面にも通知
      sendRemote({ type: 'fx_remoteDeckOpenAct', cardNo: card.cardNo, name: card.name, to: position === 'top' ? 'deck_top' : 'deck_bottom' });
    };

    // deck_bottom（「デッキの下に戻す」明記）: ポップアップ無しで全自動
    if (returnTo === 'deck_bottom') {
      stepEl.innerText = '残りカードをデッキの下へ戻します...';
      clearButtons();
      let i = 0;
      const STEP = 220;
      function autoNext() {
        const entry = remaining[i++];
        if (!entry) {
          ctx.renderAll && ctx.renderAll();
          setTimeout(() => { cleanup(); callback(); }, 200);
          return;
        }
        // 軽いフェードアウト → 配置
        entry.wrap.style.transition = 'opacity 0.18s, transform 0.18s';
        entry.wrap.style.opacity = '0';
        entry.wrap.style.transform = 'translateY(20px) scale(0.92)';
        setTimeout(() => {
          placeFn(entry.card, 'bottom');
          removeEntry(entry);
          ctx.renderAll && ctx.renderAll();
          autoNext();
        }, STEP);
      }
      autoNext();
      return;
    }

    function refreshReturnUI() {
      const left = cardEls.filter(e => !e.removed);
      if (left.length === 0) { cleanup(); callback(); return; }
      let labelText = '残りカードをデッキに戻す';
      if (returnTo === 'deck_top') labelText += '（タップ順にデッキの上へ積まれます）';
      else if (returnTo === 'deck_choice') labelText += '（好きな順番で：タップした順にデッキの下へ）';
      else if (returnTo === 'deck_top_or_bottom') labelText += '（タップして上か下を選択）';
      stepEl.innerText = labelText;
      clearButtons();
      cardEls.forEach(entry => {
        if (entry.removed) return;
        setCardReturnable(entry);
        entry.wrap.onclick = () => {
          if (entry.removed) return;
          if (returnTo === 'deck_top_or_bottom') {
            showTopBottomChoice(entry.card, (pos) => {
              placeFn(entry.card, pos);
              removeEntry(entry);
              ctx.renderAll && ctx.renderAll();
              refreshReturnUI();
            });
          } else if (returnTo === 'deck_top') {
            placeFn(entry.card, 'top');
            removeEntry(entry);
            ctx.renderAll && ctx.renderAll();
            refreshReturnUI();
          } else {
            // deck_choice = 「好きな順番で」 → タップ順にデッキ下へ
            placeFn(entry.card, 'bottom');
            removeEntry(entry);
            ctx.renderAll && ctx.renderAll();
            refreshReturnUI();
          }
        };
      });
    }

    refreshReturnUI();
  }

  function showTopBottomChoice(card, cb) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:65000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#0a0a0a;border:2px solid #00fbff;border-radius:12px;padding:20px;text-align:center;';
    const txt = document.createElement('div');
    txt.style.cssText = 'color:#fff;font-size:13px;margin-bottom:14px;';
    txt.innerText = '「' + card.name + '」をどちらに戻しますか？';
    box.appendChild(txt);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';
    const topBtn = document.createElement('button');
    topBtn.innerText = '↑ デッキの上';
    topBtn.style.cssText = 'background:#00fbff;color:#000;border:none;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
    topBtn.onclick = () => { document.body.removeChild(modal); cb('top'); };
    btnRow.appendChild(topBtn);
    const botBtn = document.createElement('button');
    botBtn.innerText = '↓ デッキの下';
    botBtn.style.cssText = 'background:#005566;color:#fff;border:1px solid #00fbff;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
    botBtn.onclick = () => { document.body.removeChild(modal); cb('bottom'); };
    btnRow.appendChild(botBtn);
    box.appendChild(btnRow);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function cleanup() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    // 相手画面の観戦オーバーレイも閉じる
    sendRemote({ type: 'fx_remoteDeckOpenEnd' });
  }

  // 開始: まず1枚ずつめくれ演出を再生してから、選択/戻しフェーズへ
  flipAll(() => {
    if (selections.length === 0) {
      runReturnPhase();
    } else {
      runSelectionPhase();
    }
  });
}


// ===== 手札選択UI =====

function showHandSelection(hand, validIndices, borderColor, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:70000;display:flex;flex-direction:column;align-items:center;justify-content:center;';

  const title = document.createElement('div');
  title.style.cssText = 'color:' + borderColor + ';font-size:16px;font-weight:bold;margin-bottom:16px;text-shadow:0 0 10px ' + borderColor + ';';
  title.innerText = '🎯 手札からカードを選んでください';
  overlay.appendChild(title);

  const cardRow = document.createElement('div');
  cardRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:90%;';
  overlay.appendChild(cardRow);

  hand.forEach((card, i) => {
    const isValid = validIndices.includes(i);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border:2px solid ' + (isValid ? borderColor : '#333') + ';border-radius:8px;padding:4px;text-align:center;width:80px;' + (isValid ? 'cursor:pointer;' : 'opacity:0.4;');

    const img = document.createElement('img');
    img.src = card.imageUrl || '';
    img.alt = card.name;
    img.style.cssText = 'width:72px;height:auto;border-radius:4px;';
    img.onerror = function() { this.style.display='none'; };
    wrap.appendChild(img);

    const name = document.createElement('div');
    name.style.cssText = 'color:#fff;font-size:10px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.innerText = card.name;
    wrap.appendChild(name);

    if(isValid) {
      wrap.addEventListener('click', () => {
        if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
        callback(i);
      });
      wrap.addEventListener('mouseenter', () => { wrap.style.boxShadow = '0 0 15px ' + borderColor; wrap.style.transform = 'scale(1.05)'; });
      wrap.addEventListener('mouseleave', () => { wrap.style.boxShadow = ''; wrap.style.transform = ''; });
    }
    cardRow.appendChild(wrap);
  });

  // キャンセルボタン
  const cancelBtn = document.createElement('button');
  cancelBtn.innerText = '✕ キャンセル';
  cancelBtn.style.cssText = 'margin-top:16px;background:#333;color:#fff;border:1px solid #666;padding:8px 20px;border-radius:8px;font-size:14px;cursor:pointer;';
  cancelBtn.addEventListener('click', () => {
    if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback(null);
  });
  overlay.appendChild(cancelBtn);

  document.body.appendChild(overlay);
}

// ===== バフ管理 =====

function addBuff(card, type, value, ctx) {
  if (!card.buffs) card.buffs = [];
  const block = ctx.block || {};
  const dur = block.duration ? block.duration.code : 'dur_this_turn';
  card.buffs.push({ type, value, duration: dur, source: ctx.card ? ctx.card.cardNo : '' });
  recalcDp(card);
}

function applyDpBuff(val, isPlus, target, ctx, callback) {
  const player = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
  const block = ctx.block || {};
  const dur = block.duration ? block.duration.code : 'dur_this_turn';
  const type = isPlus ? 'dp_plus' : 'dp_minus';
  const label = isPlus ? '💪 ' : '💥 ';
  const sign = isPlus ? '+' : '-';

  function applyAndLog(card) {
    addBuffDirect(card, type, val, dur, ctx);
    ctx.addLog(label + card.name + ' DP' + sign + val + ' → ' + card.dp);
    showDpPopup(isPlus ? val : -val, card.name);
  }

  if (target.code === 'target_self' && ctx.card) {
    applyAndLog(ctx.card);
    ctx.renderAll(); callback && callback();
  } else if (target.code === 'target_trigger_source') {
    // 反応トリガー（on_play/on_evolve/on_attack 等の盤面スキャン反応）の発火元カードを対象にする。
    // 例: 武之内空「赤の自分のデジモンがアタックしたとき〜そのデジモンのDPを+2000」
    const src = block._eventSourceCard;
    if (src) applyAndLog(src);
    else ctx.addLog && ctx.addLog('⚠ 発火元カードが見つかりません（trigger_source）');
    ctx.renderAll(); callback && callback();
  } else if (target.code === 'target_all_own') {
    // target.filter（色/タイプ等）と block.conditions（cond_blocker 等）の両方で絞り込み可能
    const _dpAllConds = block.conditions || [];
    player.battleArea.forEach(c => {
      if (!c) return;
      if (target.filter && !cardMatchesFilter(c, target.filter)) return;
      if (_dpAllConds.length > 0 && !checkConditions(_dpAllConds, c, ctx.bs, ctx.side)) return;
      addBuffDirect(c, type, val, dur, ctx);
    });
    ctx.addLog(label + '全デジモン DP' + sign + val);
    showDpPopup(isPlus ? val : -val, '自分のデジモン全て');
    ctx.renderAll(); callback && callback();
  } else if (target.code === 'target_all_own_security') {
    // セキュリティバフを記録（セキュリティチェック時に参照）
    if (!ctx.bs._securityBuffs) ctx.bs._securityBuffs = [];
    // 付与時のターン保持者と付与本人(owner)が同じか判定（dur_this_turn のセキュリティ発動時の判定用）
    const turnSide = ctx.bs.isPlayerTurn ? 'player' : 'ai';
    const appliedDuringOwnTurn = (turnSide === ctx.side);
    ctx.bs._securityBuffs.push({ type, value: val, duration: dur, source: ctx.card ? ctx.card.cardNo : '', owner: ctx.side, _appliedDuringOwnTurn: appliedDuringOwnTurn });
    console.log('[security_buff added]', 'type=' + type, 'val=' + val, 'dur=' + dur, 'owner=' + ctx.side, 'appliedDuringOwnTurn=' + appliedDuringOwnTurn);
    ctx.addLog(label + 'セキュリティデジモン全体 DP' + sign + val + '（' + dur + '）');
    showDpPopup(isPlus ? val : -val, 'セキュリティ全て');
    ctx.renderAll();
    // オンライン: セキュリティバフを即時同期（debounce待ちで相手側の表示が遅れるのを防ぐ）
    if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
      window._onlineSendStateSync();
    }
    callback && callback();
  } else if (target.code === 'target_own') {
    const validTargets = [];
    for(let i=0;i<player.battleArea.length;i++) { if(player.battleArea[i]) validTargets.push(i); }
    if(validTargets.length === 0) { showEffectFailed(null, callback); return; }
    // _forceTargetIdx で対象が事前確定済みなら UI スキップして自動適用（same_target など）
    if(ctx.side === 'ai' || ctx._forceTargetIdx !== undefined) {
      const fixedIdx = (ctx._forceTargetIdx !== undefined) ? ctx._forceTargetIdx : validTargets[0];
      const tgtCard = player.battleArea[fixedIdx];
      if (tgtCard) {
        ctx.bs._lastPickedCard = tgtCard;
        applyAndLog(tgtCard);
      }
      ctx.renderAll(); callback && callback();
      return;
    }
    ctx.addLog('🎯 DP' + sign + val + 'の対象を選んでください');
    showTargetSelection(ctx.side === 'player' ? 'pl' : 'ai', validTargets, null, isPlus ? '#00ff88' : '#ff4444', (idx) => {
      if(idx !== null) {
        // 同一対象の連続適用 (same_target) のため、選んだカードを保存
        ctx.bs._lastPickedCard = player.battleArea[idx];
        applyAndLog(player.battleArea[idx]);
      }
      ctx.renderAll(); callback && callback();
    });
  } else {
    ctx.renderAll(); callback && callback();
  }
}

// 内部キーワードコード → 日本語表示名（バナー / ログ共通）
function _keywordJpName(flag) {
  const map = {
    blocker:'ブロッカー', rush:'速攻', piercing:'突進', penetrate:'貫通',
    jamming:'ジャミング', reboot:'再起動', michizure:'道連れ', charge:'進撃',
    barrier:'防壁', evade:'回避', armor_break:'アーマー解除', indomitable:'不屈',
    combo:'連携', collision:'衝突', decoy:'デコイ', scapegoat:'スケープゴート',
    save:'セーブ', delay:'ディレイ', absorb_evolve:'吸収進化',
    mind_link:'マインドリンク', partition:'パーティション',
    material_save:'マテリアルセーブ', blast_evolve:'ブラスト進化',
    blast_jogress:'ブラストジョグレス', vortex:'ヴォルテクス',
    overclock:'オーバークロック', ice_armor:'氷装', decode:'デコード',
    fragment:'フラグメント', execute:'エグゼキュート', progress:'プログレス',
    training:'トレーニング', prevent_destroy:'消滅耐性',
    prevent_battle_destroy:'バトル耐性', immune:'効果耐性',
    security_attack_plus:'Sアタック+',
  };
  return map[flag] || flag;
}

function addBuffDirect(card, type, value, duration, ctx) {
  if (!card.buffs) card.buffs = [];
  let appliedSide = null;
  if (ctx && ctx.side) {
    appliedSide = ctx.side;
  } else if (ctx && ctx.bs) {
    appliedSide = ctx.bs.isPlayerTurn ? 'player' : 'ai';
  }
  // 付与時が自分のターンか相手のターンかを判定
  // dur_next_own_turn の必要tick数判定に使用:
  //   自分ターン中の付与（main使用）: 2tick必要（付与ターン終了 + 次の自分ターン終了）
  //   相手ターン中の付与（security使用）: 1tick必要（次の自分ターン終了のみ）
  let appliedDuringOwnTurn = true;
  if (ctx && ctx.bs && appliedSide) {
    const turnSide = ctx.bs.isPlayerTurn ? 'player' : 'ai';
    appliedDuringOwnTurn = (turnSide === appliedSide);
  }
  card.buffs.push({
    type, value, duration,
    source: ctx && ctx.card ? ctx.card.cardNo : '',
    _appliedSide: appliedSide,
    _appliedDuringOwnTurn: appliedDuringOwnTurn,
    _ticks: 0,
  });
  recalcDp(card);
  // キーワードバフ追加時は cond_self_keyword 等の条件結果が変わるため永続効果を再評価
  if (typeof type === 'string' && type.indexOf('keyword_') === 0 && ctx && ctx.bs && !ctx._inApplyPerm) {
    try {
      ctx._inApplyPerm = true; // 再帰防止
      applyPermanentEffects(ctx.bs, 'player', ctx);
      applyPermanentEffects(ctx.bs, 'ai', ctx);
    } catch(_) {}
    finally { delete ctx._inApplyPerm; }
  }
}

function recalcDp(card) {
  // baseDpは初回のみ設定。以降は変更しない
  if (card.baseDp === undefined || card.baseDp === null) {
    card.baseDp = parseInt(card.dp) || 0;
  }
  let mod = 0;
  let overrideBase = null;
  if (card.buffs) {
    card.buffs.forEach(b => {
      if (b.type === 'dp_plus') mod += (parseInt(b.value) || 0);
      if (b.type === 'dp_minus') mod -= (parseInt(b.value) || 0);
      // dp_set: 「元々のDPを N に変更」。複数あれば最後に付与されたものが有効
      if (b.type === 'dp_set') overrideBase = (parseInt(b.value) || 0);
    });
  }
  card.dpModifier = mod;
  card.dp = (overrideBase != null ? overrideBase : card.baseDp) + mod;
}

// 持続切れバフを除去
// timing: 'dur_this_turn' / 'dur_next_opp_turn' / 'dur_next_own_turn' / 'permanent'
// ownerSide: 'player'/'ai' — permanent バフの持ち主（ターン切替時に指定）
//
// 削除ルール（_appliedSide = 付与した本人の陣営）:
// - dur_this_turn: 付与した本人のターンが終わる時に削除（付与本人ターン終了時）
// - dur_next_opp_turn: 次に来る相手ターン（付与した本人から見て相手）が終わる時に削除
// - dur_next_own_turn: 付与した本人の次のターン（付与本人ターンが2回目に終わる時）に削除
//
// 呼び出しタイミング: 各ターンの終了時。bs.isPlayerTurn = ちょうど終わろうとしているターンの陣営
// expireBuffs(bs, timing, ownerSide, endingSide)
// endingSide: 'player'/'ai' - 明示指定（省略時は bs.isPlayerTurn から推測、オンラインでは要明示）
export function expireBuffs(bs, timing, ownerSide, endingSide) {
  if (!endingSide) endingSide = bs.isPlayerTurn ? 'player' : 'ai';
  console.log('[expire]', timing, 'endingSide=' + endingSide);
  ['player', 'ai'].forEach(side => {
    [...bs[side].battleArea, ...(bs[side].tamerArea || [])].forEach(card => {
      if (!card || !card.buffs || card.buffs.length === 0) return;
      const before = card.buffs.length;
      const matching = card.buffs.filter(b => b.duration === timing);
      if (matching.length > 0) console.log('[expire-found]', side, card.name, matching.length, 'buffs');
      // 詳細デバッグ: 全ての buff の duration を見せる（match しなかった理由を追跡）
      if (card.buffs.length > 0 && (timing === 'dur_next_own_turn' || timing === 'dur_this_turn')) {
        const buffDurations = card.buffs.map(b => `${b.type}:[${JSON.stringify(b.duration)}](appliedSide=${b._appliedSide},dOwn=${b._appliedDuringOwnTurn})`).join('|');
        console.log('[expire-debug]', side, card.name, 'timing=' + JSON.stringify(timing), 'buffs:', buffDurations);
      }
      if (timing === 'permanent') {
        if (ownerSide) {
          if (side === ownerSide) {
            card.buffs = card.buffs.filter(b => b.duration !== 'permanent');
          }
        } else {
          card.buffs = card.buffs.filter(b => b.duration !== 'permanent');
        }
      } else {
        const removedBuffs = [];
        card.buffs = card.buffs.filter(b => {
          if (b.duration !== timing) return true;
          let shouldRemove = false;
          // dur_this_turn: 「このターン」= 付与時に走っていたターン終了で削除
          // 自ターン中に付与（_appliedDuringOwnTurn=true）→ 付与本人のターン終了で削除
          // 相手ターン中に付与（=セキュリティ発動など、_appliedDuringOwnTurn=false）→ 相手側のターン終了で削除
          if (timing === 'dur_this_turn') {
            if (b._appliedDuringOwnTurn === false) {
              // 付与時は相手のターンだった → 相手のターン終了 (=appliedSide と異なる側のターン終了) で削除
              shouldRemove = b._appliedSide !== endingSide;
            } else {
              // 通常: 付与本人のターン終了で削除
              shouldRemove = b._appliedSide === endingSide;
            }
          }
          // dur_next_opp_turn: 付与本人とは違う陣営のターン終了時に削除
          else if (timing === 'dur_next_opp_turn') {
            shouldRemove = b._appliedSide !== endingSide;
          }
          // dur_next_own_turn: 付与本人の次のターン終了で削除
          else if (timing === 'dur_next_own_turn') {
            if (b._appliedSide !== endingSide) return true;
            b._ticks = (b._ticks || 0) + 1;
            const needed = b._appliedDuringOwnTurn === false ? 1 : 2;
            shouldRemove = b._ticks >= needed;
            if (!shouldRemove) return true;
          }
          if (shouldRemove) {
            removedBuffs.push({ type: b.type, duration: b.duration });
          }
          return !shouldRemove;
        });
        // 削除したバフをstate_sync復活防止のためマーク
        if (removedBuffs.length > 0 && window._markBuffExpired) {
          removedBuffs.forEach(rb => window._markBuffExpired(card.name, rb.type, rb.duration));
        }
      }
      if (card.buffs.length !== before) {
        recalcDp(card);
        console.log('[expire-removed]', side, card.name, before, '→', card.buffs.length);
      }
      if (!card.buffs.some(b => ['cant_attack_block', 'cant_attack'].includes(b.type))) card.cantAttack = false;
      if (!card.buffs.some(b => ['cant_attack_block', 'cant_block'].includes(b.type))) card.cantBlock = false;
      if (!card.buffs.some(b => b.type === 'cant_evolve')) card.cantEvolve = false;
    });
  });
  // 付与効果(grant_effect)の期限切れ除去
  // buffs と同じサイド判定（付与本人 g.side と endingSide の比較）
  ['player', 'ai'].forEach(side => {
    [...bs[side].battleArea, ...(bs[side].tamerArea || [])].forEach(card => {
      if (!card || !Array.isArray(card._grantedRecipes) || card._grantedRecipes.length === 0) return;
      card._grantedRecipes = card._grantedRecipes.filter(g => {
        if (!g || g.duration !== timing) return true;
        if (timing === 'dur_this_turn') return g.side !== endingSide;
        if (timing === 'dur_next_opp_turn') return g.side === endingSide;
        if (timing === 'permanent') return false;
        return false;
      });
    });
  });

  // 進化コスト軽減の保留分（スマッシュポテト等）の期限切れ除去
  if (Array.isArray(bs._pendingEvoCostReductions) && bs._pendingEvoCostReductions.length > 0) {
    bs._pendingEvoCostReductions = bs._pendingEvoCostReductions.filter(r => {
      if (!r || r._used) return false;
      if (r.duration !== timing) return true;
      if (timing === 'dur_this_turn') return r.side !== endingSide;
      if (timing === 'dur_next_opp_turn') return r.side === endingSide;
      return false;
    });
  }

  // セキュリティバフも同じtimingで期限切れ除去
  // card.buffs と同じく付与本人のowner（=ctx.side）と endingSide を比較してサイド判定
  if (bs._securityBuffs && bs._securityBuffs.length > 0) {
    bs._securityBuffs = bs._securityBuffs.filter(b => {
      if (b.duration !== timing) return true;
      // dur_this_turn: 「このターン」= 付与時に走っていたターン終了で削除
      // セキュリティ発動など相手ターン中に付与した場合 (_appliedDuringOwnTurn=false) は
      // 相手側のターン終了で削除する
      if (timing === 'dur_this_turn') {
        if (b._appliedDuringOwnTurn === false) {
          // 相手ターン中に付与 → owner と異なる側のターン終了で削除 (= keep if same side)
          return b.owner === endingSide;
        }
        // 通常: 付与本人のターン終了で削除 (= keep if different side)
        return b.owner !== endingSide;
      }
      // dur_next_opp_turn: 付与本人とは違う陣営のターン終了時に削除
      if (timing === 'dur_next_opp_turn') {
        return b.owner === endingSide;
      }
      // dur_next_own_turn: 付与本人の次のターン終了で削除（tickベース）
      if (timing === 'dur_next_own_turn') {
        if (b.owner !== endingSide) return true; // 相手側ターン終了はカウントしない
        b._ticks = (b._ticks || 0) + 1;
        return b._ticks < 2; // 2tick目で削除（付与ターン終了 + 次の自分ターン終了）
      }
      // permanent も明示削除可
      if (timing === 'permanent') return false;
      return false; // フォールバック: 削除
    });
  }
  // バフ消失後、cond_self_keyword 等の条件結果が変わるため永続効果を再評価
  try {
    applyPermanentEffects(bs, 'player', { bs, side: 'player' });
    applyPermanentEffects(bs, 'ai', { bs, side: 'ai' });
  } catch(_) {}
}

// ===== 永続効果適用 =====

export function applyPermanentEffects(bs, side, context) {
  const turnSide = bs.isPlayerTurn ? 'player' : 'ai';

  // ① まず全カードの永続バフをクリア（対象side + そのsideのバフを受けている相手sideも）
  [...bs[side].battleArea, ...(bs[side].tamerArea || [])].forEach(card => {
    if (!card) return;
    if (card.buffs) { card.buffs = card.buffs.filter(b => b.duration !== 'permanent'); recalcDp(card); }
    if (card._permEffects) card._permEffects = {};
  });
  // 継続的（during_X）由来のセキュリティバフもクリア（再評価のため）
  // source='recipe_perm_security' は applyPermanentEffects で毎回再構築される
  if (bs._securityBuffs && bs._securityBuffs.length > 0) {
    bs._securityBuffs = bs._securityBuffs.filter(b => !(b.source === 'recipe_perm_security' && b.owner === side));
  }

  // ② 永続効果を全て再適用
  const allCards = [...(bs[side].battleArea.filter(c => c)), ...(bs[side].tamerArea || [])];

  allCards.forEach(card => {
    // ③ レシピベースの永続効果処理
    if (card.recipe) {
      // 文字列ならパース（キャッシュ）
      if (typeof card.recipe === 'string') {
        try { card.recipe = JSON.parse(card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')); } catch (_) { card.recipe = null; }
      }
      if (!card.recipe) return;
      // メイン効果テキストにトリガーがなく、進化元テキストにある場合は
      // 進化元専用効果なので③ではスキップ（④で処理）
      const cardMainEffect = card.effect || '';
      const cardEvoEffect = card.evoSourceEffect || '';
      const turnKeys = ['during_own_turn', 'during_opp_turn', 'during_any_turn'];
      const turnTextMap = { 'during_own_turn': '【自分のターン】', 'during_opp_turn': '【相手のターン】', 'during_any_turn': '【お互いのターン】' };
      turnKeys.forEach(tk => {
        if (!card.recipe[tk]) return;
        // 進化元効果のみのカード（メイン効果にターントリガーなし）はスキップ
        const triggerText = turnTextMap[tk];
        if (!cardMainEffect.includes(triggerText) && cardEvoEffect.includes(triggerText)) return;
        if (tk === 'during_own_turn' && side !== turnSide) return;
        if (tk === 'during_opp_turn' && side === turnSide) return;
        const steps = Array.isArray(card.recipe[tk]) ? card.recipe[tk] : [card.recipe[tk]];
        steps.forEach(step => {
          // grant_keyword for own:all（八神太一等）: condition/when はターゲット個別フィルタとして評価
          if (step.action === 'grant_keyword' || step.action === 'grant_keyword_to') {
            const kw = step.keyword || step.flag || '';
            const gv = step.value != null ? step.value : 1;
            const filterConds = [];
            if (step.condition) filterConds.push(...parseRecipeCondition(step.condition));
            if (step.when) filterConds.push(...parseRecipeCondition(step.when));
            const applyKw = (tgt) => {
              if (!tgt) return;
              if (filterConds.length && !checkConditions(filterConds, tgt, bs, side)) return;
              if (!tgt._permEffects) tgt._permEffects = {};
              if (kw === 'security_attack_plus' || /Sアタック/.test(String(kw))) {
                tgt._permEffects.securityAttackPlus = (tgt._permEffects.securityAttackPlus || 0) + gv;
              } else if (kw === 'jamming')     { tgt._permEffects.jamming = true; }
              else if (kw === 'reboot')        { tgt._permEffects.reboot = true; }
              else if (kw === 'blocker')       { tgt._permEffects.blocker = true; }
              else if (kw === 'rush')          { tgt._permEffects.rush = true; }
              else if (kw === 'penetrate')     { tgt._permEffects.penetrate = true; }
              else if (kw === 'piercing')      { tgt._permEffects.piercing = true; }
              else if (kw === 'michizure')     { tgt._permEffects.michizure = true; }
              else if (kw === 'barrier')       { tgt._permEffects.barrier = true; }
              else if (kw === 'evade')         { tgt._permEffects.evade = true; }
              else if (kw === 'armor_break')   { tgt._permEffects.armor_break = true; }
              else if (kw === 'indomitable')   { tgt._permEffects.indomitable = true; }
            };
            const gt = String(step.target || 'self');
            if (gt === 'own:all') bs[side].battleArea.forEach(applyKw);
            else if (gt === 'self') applyKw(card);
            return;
          }
          // custom: メインカード由来の特殊フラグ設定
          if (step.action === 'custom') {
            const cs = String(step.condition || '');
            if (cs.includes('cond_no_evo') && cs.includes('opp_blocker')) {
              if (!card._permEffects) card._permEffects = {};
              card._permEffects.cantBeBlockedByNoEvo = true;
            }
            return;
          }
          // 条件チェック
          if (step.condition) {
            const conds = parseRecipeCondition(step.condition);
            if (!checkConditions(conds, card, bs, side)) return;
          }
          // per_count倍率（valueが未指定なら1をデフォルトに）
          let value = step.value != null ? step.value : (step.per_count ? 1 : null);
          if (step.per_count && value != null) {
            const refSource = step.ref || 'evo_source';
            const count = getRefSourceCountDirect(refSource, card, bs, side, step.ref_filter, step.ref_state);
            value = value * Math.floor(count / step.per_count);
          }
          // アクション適用
          if (step.action === 'dp_plus') {
            const target = step.target || 'self';
            if (target === 'self') {
              if (!card.buffs) card.buffs = [];
              card.buffs.push({ type: 'dp_plus', value: value, duration: 'permanent', source: 'recipe_perm' });
              recalcDp(card);
            } else if (target === 'own:all') {
              bs[side].battleArea.forEach(tgt => {
                if (!tgt) return;
                if (!tgt.buffs) tgt.buffs = [];
                tgt.buffs.push({ type: 'dp_plus', value: value, duration: 'permanent', source: 'recipe_perm' });
                recalcDp(tgt);
              });
            } else if (target === 'own_security:all') {
              // 高石タケル等: during_opp_turn で自分のセキュリティデジモン全体に DP+
              // bs._securityBuffs に push（applySecurityBuffs/renderSecurity が参照）
              if (!bs._securityBuffs) bs._securityBuffs = [];
              bs._securityBuffs.push({
                type: 'dp_plus', value: value, duration: 'permanent',
                source: 'recipe_perm_security', owner: side,
                _appliedDuringOwnTurn: false,
              });
            }
          } else if (step.action === 'security_attack_plus') {
            if (!card._permEffects) card._permEffects = {};
            card._permEffects.securityAttackPlus = (card._permEffects.securityAttackPlus || 0) + (value || 1);
          }
        });
      });
      // passiveキーワードフラグ（バトルエリアにいるカード自身に適用）
      // ※evo_source内のpassiveはここでは適用しない（④で処理）
      if (card.recipe.passive) {
        const passives = Array.isArray(card.recipe.passive) ? card.recipe.passive : [card.recipe.passive];
        passives.forEach(p => {
          const flag = typeof p === 'string' ? p : (p.flag || p.action || '');
          if (!card._permEffects) card._permEffects = {};
          if (flag === 'security_attack_plus') {
            const val = (typeof p === 'object' && p.value) ? p.value : 1;
            card._permEffects.securityAttackPlus = (card._permEffects.securityAttackPlus || 0) + val;
          } else if (flag === 'blocker') { card._permEffects.blocker = true; }
          else if (flag === 'piercing') { card._permEffects.piercing = true; }
          else if (flag === 'rush') { card._permEffects.rush = true; }
          else if (flag === 'penetrate') { card._permEffects.penetrate = true; }
          else if (flag === 'jamming') { card._permEffects.jamming = true; }
          else if (flag === 'reboot') { card._permEffects.reboot = true; }
          else if (flag === 'michizure') { card._permEffects.michizure = true; }
          else if (flag === 'charge') { card._permEffects.charge = true; }
          else if (flag === 'collision') { card._permEffects.collision = true; }
          else if (flag === 'evade') { card._permEffects.evade = true; }
          else if (flag === 'barrier') { card._permEffects.barrier = true; }
          else if (flag === 'armor_break') { card._permEffects.armor_break = true; }
          else if (flag === 'indomitable') { card._permEffects.indomitable = true; }
          else if (flag === 'combo') { card._permEffects.combo = true; }
          // 新規追加
          else if (flag === 'progress') { card._permEffects.progress = true; }
          else if (flag === 'link_plus') {
            const val = (typeof p === 'object' && p.value) ? p.value : 1;
            card._permEffects.linkPlus = (card._permEffects.linkPlus || 0) + val;
            // 既存のリンク容量計算にも反映
            card._linkCapacityBonus = (card._linkCapacityBonus || 0) + val;
          }
          else if (flag === 'ice_armor') { card._permEffects.iceArmor = true; }
          else if (flag === 'advance') { card._permEffects.advance = true; card._permEffects.charge = true; /* charge にも alias */ }
          else if (flag === 'security_attack_minus') {
            const val = (typeof p === 'object' && p.value) ? p.value : 1;
            card._permEffects.securityAttackMinus = (card._permEffects.securityAttackMinus || 0) + val;
          }
          else if (flag === 'cant_be_blocked' || flag === 'custom') { card._permEffects.cantBeBlocked = true; }
          else if (flag === 'suppress_opt_security_effect' || flag === 'security_effect') { card._permEffects.suppressOptSecurityEffect = true; }
          // Stage 3 追加（passive flag 認識のみ。完全な game logic は別途）
          else if (flag === 'delay') { card._permEffects.delay = true; }
          else if (flag === 'save') { card._permEffects.save = true; }
          else if (flag === 'decoy') { card._permEffects.decoy = true; }
          else if (flag === 'fragment') { card._permEffects.fragment = true; }
          else if (flag === 'scapegoat') { card._permEffects.scapegoat = true; }
          else if (flag === 'material_save') { card._permEffects.materialSave = true; }
          else if (flag === 'vortex') { card._permEffects.vortex = true; }
          else if (flag === 'execute') { card._permEffects.execute = true; }
          else if (flag === 'decode') { card._permEffects.decode = true; }
          else if (flag === 'training') { card._permEffects.training = true; }
          else if (flag === 'absorb_evolve') { card._permEffects.absorbEvolve = true; }
          else if (flag === 'blast_evolve') { card._permEffects.blastEvolve = true; }
          else if (flag === 'blast_jogress') { card._permEffects.blastJogress = true; }
          else if (flag === 'mind_link') { card._permEffects.mindLink = true; }
          else if (flag === 'partition') { card._permEffects.partition = true; }
          else if (flag === 'overclock') { card._permEffects.overclock = true; }
        });
      }
    }

    // ④ 進化元カードのレシピ永続効果
    // 進化元として扱うときは evo_source.* のみを参照する。
    // top-level の passive / during_X は「そのカードがメインで居るとき」の効果なので
    // evo stack の文脈では適用しない。
    if (card.stack) {
      card.stack.forEach(evoCard => {
        if (!evoCard.recipe) return;
        if (typeof evoCard.recipe === 'string') {
          try { evoCard.recipe = JSON.parse(evoCard.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')); } catch (_) { evoCard.recipe = null; }
        }
        if (!evoCard.recipe || !evoCard.recipe.evo_source) return;
        const evoRecipe = evoCard.recipe.evo_source;
        const turnKeys = ['during_own_turn', 'during_opp_turn', 'during_any_turn'];
        turnKeys.forEach(tk => {
          if (!evoRecipe[tk]) return;
          if (tk === 'during_own_turn' && side !== turnSide) return;
          if (tk === 'during_opp_turn' && side === turnSide) return;
          const steps = Array.isArray(evoRecipe[tk]) ? evoRecipe[tk] : [evoRecipe[tk]];
          steps.forEach(step => {
            // custom: 進化元由来の特殊効果。condition はブロック判定用フィルタなので前提条件として評価しない
            if (step.action === 'custom') {
              const cs = String(step.condition || '');
              if (cs.includes('cond_no_evo') && cs.includes('opp_blocker')) {
                if (!card._permEffects) card._permEffects = {};
                card._permEffects.cantBeBlockedByNoEvo = true;
              }
              return;
            }
            if (step.condition) {
              const conds = parseRecipeCondition(step.condition);
              if (!checkConditions(conds, card, bs, side)) return;
            }
            let value = step.value != null ? step.value : (step.per_count ? 1 : null);
            if (step.per_count && value != null) {
              const refSource = step.ref || 'evo_source';
              const count = getRefSourceCountDirect(refSource, card, bs, side, step.ref_filter, step.ref_state);
              value = value * Math.floor(count / step.per_count);
            }
            if (step.action === 'dp_plus') {
              if (!card.buffs) card.buffs = [];
              card.buffs.push({ type: 'dp_plus', value: value, duration: 'permanent', source: 'evo_recipe_perm' });
              recalcDp(card);
            } else if (step.action === 'security_attack_plus') {
              if (!card._permEffects) card._permEffects = {};
              card._permEffects.securityAttackPlus = (card._permEffects.securityAttackPlus || 0) + (value || 1);
            }
          });
        });
        // 進化元のpassiveフラグ
        if (evoRecipe.passive) {
          const passives = Array.isArray(evoRecipe.passive) ? evoRecipe.passive : [evoRecipe.passive];
          passives.forEach(p => {
            const flag = typeof p === 'string' ? p : (p.flag || p.action || '');
            if (!card._permEffects) card._permEffects = {};
            if (flag === 'security_attack_plus') {
              const val = (typeof p === 'object' && p.value) ? p.value : 1;
              card._permEffects.securityAttackPlus = (card._permEffects.securityAttackPlus || 0) + val;
            } else if (flag === 'blocker') { card._permEffects.blocker = true; }
            else if (flag === 'piercing') { card._permEffects.piercing = true; }
            else if (flag === 'rush') { card._permEffects.rush = true; }
            else if (flag === 'penetrate') { card._permEffects.penetrate = true; }
            else if (flag === 'jamming') { card._permEffects.jamming = true; }
            else if (flag === 'reboot') { card._permEffects.reboot = true; }
            // 新規追加（進化元由来も同等扱い）
            else if (flag === 'progress') { card._permEffects.progress = true; }
            else if (flag === 'link_plus') {
              const val = (typeof p === 'object' && p.value) ? p.value : 1;
              card._permEffects.linkPlus = (card._permEffects.linkPlus || 0) + val;
            }
            else if (flag === 'ice_armor') { card._permEffects.iceArmor = true; }
            else if (flag === 'advance') { card._permEffects.advance = true; card._permEffects.charge = true; /* charge にも alias */ }
            else if (flag === 'security_attack_minus') {
              const val = (typeof p === 'object' && p.value) ? p.value : 1;
              card._permEffects.securityAttackMinus = (card._permEffects.securityAttackMinus || 0) + val;
            }
            // Stage 3 追加（進化元由来も同等）
            else if (flag === 'cant_be_blocked' || flag === 'custom') { card._permEffects.cantBeBlocked = true; }
            else if (flag === 'suppress_opt_security_effect' || flag === 'security_effect') { card._permEffects.suppressOptSecurityEffect = true; }
            else if (flag === 'delay') { card._permEffects.delay = true; }
            else if (flag === 'save') { card._permEffects.save = true; }
            else if (flag === 'decoy') { card._permEffects.decoy = true; }
            else if (flag === 'fragment') { card._permEffects.fragment = true; }
            else if (flag === 'scapegoat') { card._permEffects.scapegoat = true; }
            else if (flag === 'material_save') { card._permEffects.materialSave = true; }
            else if (flag === 'vortex') { card._permEffects.vortex = true; }
            else if (flag === 'execute') { card._permEffects.execute = true; }
            else if (flag === 'decode') { card._permEffects.decode = true; }
            else if (flag === 'training') { card._permEffects.training = true; }
            else if (flag === 'absorb_evolve') { card._permEffects.absorbEvolve = true; }
            else if (flag === 'blast_evolve') { card._permEffects.blastEvolve = true; }
            else if (flag === 'blast_jogress') { card._permEffects.blastJogress = true; }
            else if (flag === 'mind_link') { card._permEffects.mindLink = true; }
            else if (flag === 'partition') { card._permEffects.partition = true; }
            else if (flag === 'overclock') { card._permEffects.overclock = true; }
          });
        }
      });
    }
  });
}

// ===== レシピ条件パーサー =====

function parseRecipeCondition(condStr) {
  if (!condStr) return [];
  // 「進化元を持たない相手デジモンがいる」の自然語ショートカット
  // = cond_exists + cond_no_evo の組み合わせ
  if (condStr === 'opp_has_no_evo' || condStr === 'cond_opp_has_no_evo') {
    return [{code: 'cond_exists'}, {code: 'cond_no_evo'}];
  }
  // === @subject 抽出（レシピエディタ recipe.ts の serialize 規約） ===
  // 形式: "<base>[:<value>][@<subject>]"
  // 例: "cond_hand_le:4@own_any" → base=cond_hand_le / value=4 / subject=own_any
  let subject;
  const atIdx = condStr.lastIndexOf('@');
  if (atIdx >= 0) {
    subject = condStr.substring(atIdx + 1);
    condStr = condStr.substring(0, atIdx);
  }
  const parts = condStr.split(':');
  let result;
  if (parts[0] === 'cond_exists') {
    // "cond_exists:cond_no_evo" → [{code:'cond_exists'}, {code:'cond_no_evo'}]
    // "cond_exists:cond_has_evo:4" → [{code:'cond_exists'}, {code:'cond_has_evo', value:4}]
    result = [{code: 'cond_exists'}];
    if (parts.length >= 2) {
      const nested = parts.slice(1).join(':');
      const nestedParts = nested.split(':');
      result.push({code: nestedParts[0], value: nestedParts[1] ? parseInt(nestedParts[1]) : undefined});
    }
  } else {
    // "cond_lv_le:5" → [{code:'cond_lv_le', value:5}]
    // "cond_no_evo" → [{code:'cond_no_evo'}]
    // "dp_le:4000" → [{code:'cond_dp_le', value:4000}]  (auto-prefix cond_)
    let code = parts[0];
    if (!code.startsWith('cond_')) code = 'cond_' + code;
    // 数値ならparseInt、それ以外は文字列のまま保持（cond_self_keyword:blocker 等）
    let val = parts[1];
    if (val !== undefined) {
      const n = parseInt(val);
      if (!isNaN(n) && String(n) === String(val).trim()) val = n;
    }
    result = [{code: code, value: val}];
  }
  // subject を全 result エントリに付与（cond_exists の場合は両エントリに同じ subject）
  if (subject) result.forEach(r => r.subject = subject);
  return result;
}

// subject から side ('player'/'ai') を解決するヘルパ
// own系 → currentSide / opp系 → opposite / 未指定 → currentSide (既定)
function resolveSubjectSide(subject, currentSide) {
  if (!subject) return currentSide;
  const s = String(subject).toLowerCase();
  if (s === 'opp' || s === 'opp_any' || s === 'opp_card' || s === 'opp_player' || s === 'opp_tamer' || s === 'opponent' || s === 'opponent_card') {
    return currentSide === 'player' ? 'ai' : 'player';
  }
  return currentSide;
}

// ===== 条件チェック =====

function checkConditions(conditions, card, bs, side) {
  if (!conditions || conditions.length === 0) return true;
  // cond_exists / cond_has_evo_digimon (メタ条件) があれば先に評価し、
  // 他の条件はその候補集合に対して適用する
  const hasExists = conditions.some(c => c.code === 'cond_exists');
  const hasEvoDigimon = !hasExists && conditions.some(c => c.code === 'cond_has_evo_digimon');
  const orderedConds = hasExists
    ? [conditions.find(c => c.code === 'cond_exists'), ...conditions.filter(c => c.code !== 'cond_exists')]
    : hasEvoDigimon
      ? [conditions.find(c => c.code === 'cond_has_evo_digimon'), ...conditions.filter(c => c.code !== 'cond_has_evo_digimon')]
      : conditions;
  for (const cond of orderedConds) {
    switch (cond.code) {
      case 'cond_has_evo': if (!card.stack || card.stack.length < (cond.value || 0)) return false; break;
      case 'cond_no_evo': if (card.stack && card.stack.length > 0) return false; break;
      case 'cond_dp_le': if (card.dp > (cond.value || 0)) return false; break;
      case 'cond_dp_ge': if (card.dp < (cond.value || 0)) return false; break;
      case 'cond_dp':    if (card.dp !== (cond.value || 0)) return false; break;
      // 自分のトラッシュが N 枚以上（ベルゼブモン等）
      case 'cond_own_trash_ge': {
        const _p = side === 'player' ? bs.player : bs.ai;
        if (!_p || (_p.trash || []).length < (cond.value || 0)) return false;
        break;
      }
      // 相手にDP N以上のデジモンがいる（ブラックウォーグレイモン等）
      case 'cond_opp_dp_ge': {
        const _opp = side === 'player' ? bs.ai : bs.player;
        const _ok = _opp && (_opp.battleArea || []).some(c => c && (parseInt(c.dp) || 0) >= (cond.value || 0));
        if (!_ok) return false;
        break;
      }
      case 'cond_lv_le': if (parseInt(card.level) > (cond.value || 0)) return false; break;
      case 'cond_lv_ge': if (parseInt(card.level) < (cond.value || 0)) return false; break;
      case 'cond_lv':    if (parseInt(card.level) !== (cond.value || 0)) return false; break;
      case 'cond_cost_le': if ((card.playCost || card.cost || 0) > (cond.value || 0)) return false; break;
      case 'cond_cost_ge': if ((card.playCost || card.cost || 0) < (cond.value || 0)) return false; break;
      case 'cond_cost':    if ((card.playCost || card.cost || 0) !== (cond.value || 0)) return false; break;
      case 'cond_own_security_le': if (bs && bs[side] && bs[side].security && bs[side].security.length > (cond.value || 0)) return false; break;
      case 'cond_own_security_ge': if (bs && bs[side] && bs[side].security && bs[side].security.length < (cond.value || 0)) return false; break;
      // === ゾーン枚数条件（subject 駆動: @own_any/@opp_any 等で side 切替） ===
      case 'cond_hand_le': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].hand ? bs[ts].hand.length : 0;
        if (len > (cond.value || 0)) return false;
        break;
      }
      case 'cond_hand_ge': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].hand ? bs[ts].hand.length : 0;
        if (len < (cond.value || 0)) return false;
        break;
      }
      case 'cond_security_le': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].security ? bs[ts].security.length : 0;
        if (len > (cond.value || 0)) return false;
        break;
      }
      case 'cond_security_ge': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].security ? bs[ts].security.length : 0;
        if (len < (cond.value || 0)) return false;
        break;
      }
      case 'cond_trash_ge': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].trash ? bs[ts].trash.length : 0;
        if (len < (cond.value || 0)) return false;
        break;
      }
      case 'cond_trash_le': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].trash ? bs[ts].trash.length : 0;
        if (len > (cond.value || 0)) return false;
        break;
      }
      case 'cond_deck_le': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].deck ? bs[ts].deck.length : 0;
        if (len > (cond.value || 0)) return false;
        break;
      }
      case 'cond_deck_ge': {
        if (!bs) break;
        const ts = resolveSubjectSide(cond.subject, side);
        const len = bs[ts] && bs[ts].deck ? bs[ts].deck.length : 0;
        if (len < (cond.value || 0)) return false;
        break;
      }
      case 'cond_during_own_turn': {
        // 「自分のターン」中のみ true。bs.isPlayerTurn の判定を side と照合
        if (!bs) break;
        const myTurn = (side === 'player' && bs.isPlayerTurn) || (side === 'ai' && !bs.isPlayerTurn);
        if (!myTurn) return false;
        break;
      }
      case 'cond_during_any_turn': {
        // 「お互いのターン中」: 常時 true（ターン中なら必ず満たす・実質 no-op ゲート）
        // テキスト「お互いのターン中」を明示的に書きたい時用
        break;
      }
      case 'cond_attack_target_digimon': {
        // 「相手のデジモンにアタックしたとき」: bs._lastAttackTarget が 'digimon' なら true
        if (!bs || bs._lastAttackTarget !== 'digimon') return false;
        break;
      }
      case 'cond_attack_target_player': {
        // 「プレイヤーにアタックしたとき」: bs._lastAttackTarget は 'security'/'digimon' の
        // どちらかにしかならない（'player' という値は実際には設定されない）ため、
        // 'security' で判定する
        if (!bs || bs._lastAttackTarget !== 'security') return false;
        break;
      }
      case 'cond_attack_target_highest_dp':
      case 'cond_attack_target_lowest_dp': {
        // 「最もDPの高い/低い相手のデジモンにアタックしたとき」:
        // bs._lastAttackTargetIdx が指すカードが、相手側バトルエリア全体で
        // 最大/最小DPと一致するか判定
        if (!bs || bs._lastAttackTarget !== 'digimon' || bs._lastAttackTargetIdx == null || bs._lastAttackTargetIdx < 0) return false;
        const oppSide = side === 'player' ? 'ai' : 'player';
        const oppArea = (bs[oppSide] && bs[oppSide].battleArea) || [];
        const attackedCard = oppArea[bs._lastAttackTargetIdx];
        if (!attackedCard) return false;
        const dps = oppArea.filter(c => c).map(c => c.dp || 0);
        if (dps.length === 0) return false;
        const extreme = cond.code === 'cond_attack_target_highest_dp' ? Math.max(...dps) : Math.min(...dps);
        if ((attackedCard.dp || 0) !== extreme) return false;
        break;
      }
      case 'cond_picked_color':
      case 'cond_picked_type':
      case 'cond_picked_lv':
      case 'cond_picked_dp':
      case 'cond_picked_cost':
      case 'cond_picked_name': {
        // 直前にプレイヤーが選択したカード (bs._lastPickedCard) の属性参照
        // 例: cond_picked_color:黄 → bs._lastPickedCard.color === '黄'
        const picked = bs && bs._lastPickedCard;
        if (!picked) return false;
        const attrMap = {
          cond_picked_color: 'color', cond_picked_type: 'type',
          cond_picked_lv: 'lv', cond_picked_dp: 'dp',
          cond_picked_cost: 'playCost', cond_picked_name: 'name',
        };
        // cond.code で参照（parseRecipeCondition は base ではなく code を設定する）
        const attr = attrMap[cond.code];
        const want = String(cond.value || '');
        if (want === '') break; // 値未指定は no-op (true)
        const got = picked[attr];
        if (attr === 'lv' || attr === 'dp' || attr === 'playCost') {
          // 数値比較（lv/dp/cost は完全一致）
          if (parseInt(String(got || ''), 10) !== parseInt(want, 10)) return false;
        } else {
          if (String(got || '') !== want) return false;
        }
        break;
      }
      case 'cond_picked_feature_contains': {
        // 直前選択カードの feature(特徴) に want が含まれるとき true
        const picked = bs && bs._lastPickedCard;
        if (!picked) return false;
        const want = String(cond.value || '');
        if (want === '') break;
        const features = String(picked.feature || picked.features || '');
        if (!features.includes(want)) return false;
        break;
      }
      case 'cond_same_as_picked': {
        // 「選んだデジモンと同じ」: cond.value (カンマ区切り属性リスト) で指定された属性が
        // bs._lastPickedCard と card で全て一致する必要がある
        // 例: cond.value = "name" → card.name === picked.name
        // 例: cond.value = "name,color" → name と color の両方が一致
        const fields = String(cond.value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (fields.length === 0) break; // 属性指定なし → 常に true (no-op)
        const picked = bs && bs._lastPickedCard;
        if (!picked || !card) return false;
        for (const f of fields) {
          if (card[f] !== picked[f]) return false;
        }
        break;
      }
      case 'cond_battle_win': {
        // 「バトルで相手のデジモンを消滅させたとき」: bs._lastBattleWinner === card のときtrue
        if (!bs || bs._lastBattleWinner !== card) return false;
        break;
      }
      case 'cond_when_opp_rest': {
        // when_opp_rest トリガー時に bs._lastRestedOppCard がセットされる
        if (!bs || !bs._lastRestedOppCard) return false;
        break;
      }
      case 'cond_main': {
        // on_active トリガーで「メインフェイズにアクティブになった」= bs._onActivePhase === 'main'
        if (!bs || bs._onActivePhase !== 'main') return false;
        break;
      }
      case 'cond_active': {
        // on_active トリガーで「アクティブフェイズにアクティブになった」= bs._onActivePhase === 'unsuspend'
        if (!bs || bs._onActivePhase !== 'unsuspend') return false;
        break;
      }
      case 'cond_same_name_digimon': {
        // 「このデジモンと同じ名称の他の自分のデジモンがいる間」
        if (!bs || !card) return false;
        const _csnSide = resolveSubjectSide(cond.subject, side);
        const _csnArea = (bs[_csnSide] && bs[_csnSide].battleArea) || [];
        if (!_csnArea.some(c => c && c !== card && c.name === card.name)) return false;
        break;
      }
      case 'cond_self_active': {
        // 自身がアクティブ状態（レストしていない）の時 true
        if (card && card.suspended) return false;
        break;
      }
      case 'cond_rest': {
        // 「レスト状態」: 対象カードがレスト状態のとき true（cond_self_rest の汎用版）
        if (!card || !card.suspended) return false;
        break;
      }
      case 'cond_blocker': {
        // 「ブロッカーを持たない」: 対象カードが blocker フラグを持たないとき true
        // value="不持" 等で「持たない」反転指定可能だが、ここでは「持つ＝true」「持たない＝false」を返す
        // 「持たない条件」として使うなら、エンジン呼び出し側で否定するか辞書名で表現する
        const hasBlocker = !!(card && (
          (card._permEffects && card._permEffects.blocker) ||
          (card.buffs && card.buffs.some(b => b.type === 'keyword_blocker')) ||
          /ブロッカー/.test(String(card.keywords || card.effect || ''))
        ));
        // デフォルトは「ブロッカーを持たない」の意味（cond.value !== '1' のとき）
        const wantHas = String(cond.value || '') === '1';
        if (wantHas ? !hasBlocker : hasBlocker) return false;
        break;
      }
      case 'cond_tamer': {
        // 「テイマーがいるとき」: 自分側のテイマーエリアに少なくとも1人いれば true
        // cond.value に色指定（例: cond_tamer:青）があれば、その色のテイマーが必要
        if (!bs) return false;
        const ts = resolveSubjectSide(cond.subject || 'own', side);
        const tamerArea = bs[ts] && bs[ts].tamerArea;
        if (!Array.isArray(tamerArea)) return false;
        const _tamers = tamerArea.filter(t => t);
        if (_tamers.length === 0) return false;
        if (cond.value) {
          const _wantColor = String(cond.value);
          if (!_tamers.some(t => t.color && String(t.color).indexOf(_wantColor) >= 0)) return false;
        }
        break;
      }
      case 'cond_security': {
        // 「セキュリティN枚ごと」: value で指定された枚数刻みの条件（per_count と組み合わせて使う想定）
        // 単独ではセキュリティ枚数 >= value のとき true として実装
        if (!bs) return false;
        const ss = resolveSubjectSide(cond.subject || 'own', side);
        const len = bs[ss] && bs[ss].security ? bs[ss].security.length : 0;
        const need = parseInt(String(cond.value || '0'), 10) || 0;
        if (len < need) return false;
        break;
      }
      case 'cond_evolve_to_lv': {
        // 「進化先のLv（完全一致）」: evo_cost_minus 等の進化バフ評価時に
        // bs._evolveContext.toLv === cond.value のとき true
        const ctxEvo = bs && bs._evolveContext;
        if (!ctxEvo) return false;
        const want = parseInt(String(cond.value || '0'), 10) || 0;
        const got = parseInt(String(ctxEvo.toLv || 0), 10) || 0;
        if (got !== want) return false;
        break;
      }
      case 'cond_self_attacked': {
        // このデジモンがこのターンにアタック済みのとき true
        // （battle 側で attack 宣言時に card._attackedOnTurn = bs.turn をセット）
        if (!card || card._attackedOnTurn == null) return false;
        if (!bs || card._attackedOnTurn !== bs.turn) return false;
        break;
      }
      case 'cond_self_rest':
      case 'cond_self_suspended': {
        // 自身がレスト状態の時 true
        if (!card || !card.suspended) return false;
        break;
      }
      case 'cond_type': {
        // 「指定タイプ」: card.type が cond.value と一致する時 true
        // 完全一致。'カード' の場合は全タイプ許可（type フィルタ無効化マーカー）
        if (!cond.value) break;
        const want = String(cond.value);
        if (want === 'カード' || want === 'card') break; // 全カード許可
        if (!card || String(card.type || '') !== want) return false;
        break;
      }
      case 'cond_name': {
        // 「名前（完全一致）」: card.name === cond.value で判定
        if (!cond.value) break;
        if (!card || String(card.name || '') !== String(cond.value)) return false;
        break;
      }
      case 'cond_during_opp_turn': {
        if (!bs) break;
        const myTurn = (side === 'player' && bs.isPlayerTurn) || (side === 'ai' && !bs.isPlayerTurn);
        if (myTurn) return false;
        break;
      }
      case 'cond_opp_no_attack_this_turn': {
        // 「このターンに相手のデジモンが1度でもアタックしていないなら」
        // ターン中に相手がアタックすると bs._currentTurnAttackCount がインクリメントされる
        // ターン切り替え時にリセット
        if (bs && bs._currentTurnAttackCount > 0) return false;
        break;
      }
      case 'cond_own_trash_ge': {
        // 「自分のトラッシュがN枚以上の間」
        if (!bs) break;
        const trashLen = bs[side] && bs[side].trash ? bs[side].trash.length : 0;
        if (trashLen < (cond.value || 0)) return false;
        break;
      }
      case 'cond_exists': {
        // 「～がいるとき」「～がいる間」→ 相手バトルエリアに条件を満たすカードがいるか
        if (!bs) break; // bsがない場合はスキップ（後方互換）
        const oppSide = side === 'player' ? 'ai' : 'player';
        const oppArea = bs[oppSide].battleArea;
        // 同じconditions内の他の条件（cond_no_evo, cond_dp_le等）を相手カードに適用
        const otherConds = conditions.filter(c => c.code !== 'cond_exists' && c.code !== 'per_count');
        // DEBUG: oppArea のデジモン状態を出力
        const dump = oppArea.map((c, i) => c ? `[${i}]${c.name}(${c.type})stack=${c.stack ? c.stack.length : 0}` : `[${i}]null`).join(',');
        console.log('[cond_exists]', 'oppSide=' + oppSide, 'oppArea:', dump, 'otherConds=', JSON.stringify(otherConds));
        const hasMatch = oppArea.some(c => {
          if (!c) return false;
          if (c.type !== 'デジモン') return false; // デジモンのみ対象
          if (otherConds.length === 0) return true; // 条件なし＝相手デジモンがいればOK
          return otherConds.every(oc => {
            switch (oc.code) {
              case 'cond_no_evo': return !c.stack || c.stack.length === 0;
              case 'cond_has_evo': return c.stack && c.stack.length >= (oc.value || 0);
              case 'cond_dp_le': return c.dp <= (oc.value || 0);
              case 'cond_dp_ge': return c.dp >= (oc.value || 0);
              case 'cond_lv_le': return parseInt(c.level) <= (oc.value || 0);
              case 'cond_lv_ge': return parseInt(c.level) >= (oc.value || 0);
              default: return true;
            }
          });
        });
        console.log('[cond_exists] hasMatch=', hasMatch);
        if (!hasMatch) return false;
        // cond_existsで使った他の条件はスキップ（二重チェック防止）
        return true;
      }
      case 'cond_has_evo_digimon': {
        // 「進化元にデジモンカードを持つ」メタ条件。
        // subject='self' (既定) なら自身の stack をスキャン。
        // 同 step 内の他条件 (cond_lv_le 等) を進化元デジモンカード候補に対する filter として適用。
        // 候補が1つでもあれば true。動作的には cond_exists の進化元版。
        if (!card || !Array.isArray(card.stack) || card.stack.length === 0) return false;
        const otherConds = conditions.filter(c =>
          c.code !== 'cond_has_evo_digimon' && c.code !== 'per_count'
        );
        const matching = card.stack.filter(s => {
          if (!s || s.type !== 'デジモン') return false;
          if (otherConds.length === 0) return true;
          // 各 filter 条件を進化元カード s に対して評価（簡易版: cond_lv_le/ge, cond_dp_le/ge, cond_color, cond_no_evo, cond_has_evo, cond_cost_le/ge）
          return otherConds.every(oc => {
            switch (oc.code) {
              case 'cond_lv_le': return parseInt(s.level || s.Lv || s.lv) <= (oc.value || 0);
              case 'cond_lv_ge': return parseInt(s.level || s.Lv || s.lv) >= (oc.value || 0);
              case 'cond_dp_le': return (s.dp || 0) <= (oc.value || 0);
              case 'cond_dp_ge': return (s.dp || 0) >= (oc.value || 0);
              case 'cond_cost_le': return (s.playCost || s.cost || 0) <= (oc.value || 0);
              case 'cond_cost_ge': return (s.playCost || s.cost || 0) >= (oc.value || 0);
              case 'cond_color': return !oc.value || (s.color && String(s.color).indexOf(String(oc.value)) >= 0);
              case 'cond_no_evo': return !s.stack || s.stack.length === 0;
              case 'cond_has_evo': return s.stack && s.stack.length >= (oc.value || 0);
              case 'cond_feature': return !oc.value || (s.feature && String(s.feature).indexOf(String(oc.value)) >= 0);
              default: return true; // 知らない条件はパス（gate しない）
            }
          });
        });
        if (matching.length === 0) return false;
        // アクション側で再利用できるよう、候補を一時記録（mutation）
        if (card) card._evoSourceCandidates = matching;
        return true; // 他条件は filter として消費したので true 即返し
      }
      case 'cond_self_keyword': {
        // 自身（card）が指定キーワードを持つかチェック (cond.value: 'blocker' 等の英語コード)
        // テキスト一致は誤検知が多い（「ブロッカーを持つ間」のような言及で成立してしまう）ため
        // 構造的な情報（_permEffects / buffs / 本体&進化元のrecipe.passive）のみで判定する
        if (!cond.value) break;
        const kw = String(cond.value);
        let has = false;
        if (card._permEffects && card._permEffects[kw]) has = true;
        else if (Array.isArray(card.buffs) && card.buffs.some(b => b && b.type === 'keyword_' + kw)) has = true;
        // 本体カードの recipe.passive
        if (!has && card.recipe) {
          try {
            const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]/g, '') : card.recipe;
            const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const passives = r.passive;
            if (Array.isArray(passives) && passives.some(p => p && (p.flag === kw || p === kw))) has = true;
          } catch(_) {}
        }
        // 進化元の recipe.passive
        if (!has && Array.isArray(card.stack)) {
          for (const s of card.stack) {
            if (!s || !s.recipe) continue;
            try {
              const raw = typeof s.recipe === 'string' ? s.recipe.replace(/[\x00-\x1F\x7F]/g, '') : s.recipe;
              const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const passives = (r.evo_source && r.evo_source.passive) || r.passive;
              if (Array.isArray(passives) && passives.some(p => p && (p.flag === kw || p === kw))) { has = true; break; }
            } catch(_) {}
          }
        }
        if (!has) return false;
        break;
      }
      // === 旧 / 別名条件群（alias 実装） ===
      case 'cond_opp_digimon': {
        // 「相手のデジモンがいるとき」: 相手バトルエリアにデジモン存在
        if (!bs) return false;
        const oppSideX = side === 'player' ? 'ai' : 'player';
        const oppArea = bs[oppSideX] && bs[oppSideX].battleArea ? bs[oppSideX].battleArea : [];
        if (!oppArea.some(c => c && c.type === 'デジモン')) return false;
        break;
      }
      case 'cond_own': {
        // 「自分のデジモンがいるとき」: 自分バトルエリアにデジモン存在
        if (!bs) return false;
        const ownArea = bs[side] && bs[side].battleArea ? bs[side].battleArea : [];
        if (!ownArea.some(c => c && c.type === 'デジモン')) return false;
        break;
      }
      case 'cond_digimon': {
        // 「他のデジモンがいるとき」: 自分・相手いずれかにこのデジモン以外のデジモンが存在
        if (!bs) return false;
        const a1 = (bs.player && bs.player.battleArea) || [];
        const a2 = (bs.ai && bs.ai.battleArea) || [];
        const others = [...a1, ...a2].filter(c => c && c !== card && c.type === 'デジモン');
        if (others.length === 0) return false;
        break;
      }
      case 'cond_keyword': {
        // 「対象がキーワードを持つ」: 対象 card が cond.value で指定されたキーワードを持つか
        // cond_self_keyword と同じ判定だが、card は対象（ターゲット）として渡される想定
        if (!cond.value) break;
        const kw = String(cond.value);
        let has = false;
        if (card && card._permEffects && card._permEffects[kw]) has = true;
        if (!has && card && Array.isArray(card.buffs) && card.buffs.some(b => b && b.type === 'keyword_' + kw)) has = true;
        if (!has && card && card.recipe) {
          try {
            const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]/g, '') : card.recipe;
            const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const passives = r.passive;
            if (Array.isArray(passives) && passives.some(p => p && (p.flag === kw || p === kw))) has = true;
          } catch(_) {}
        }
        if (!has && card && Array.isArray(card.stack)) {
          for (const s of card.stack) {
            if (!s || !s.recipe) continue;
            try {
              const raw = typeof s.recipe === 'string' ? s.recipe.replace(/[\x00-\x1F\x7F]/g, '') : s.recipe;
              const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const passives = (r.evo_source && r.evo_source.passive) || r.passive;
              if (Array.isArray(passives) && passives.some(p => p && (p.flag === kw || p === kw))) { has = true; break; }
            } catch(_) {}
          }
        }
        if (!has) return false;
        break;
      }
      case 'cond_custom': {
        // 「手札を破棄する」: 条件として使う場合は「手札に1枚以上ある」を意味するマーカー
        // （アクション or コストとして使う場合はそちらで処理）
        if (!bs) break;
        const handLen = bs[side] && bs[side].hand ? bs[side].hand.length : 0;
        const need = cond.value || 1;
        if (handLen < need) return false;
        break;
      }
      case 'deck_trash_top': {
        // 条件タブに誤登録された action コード。条件としては「デッキに1枚以上ある」とみなす
        if (!bs) break;
        const deckLen = bs[side] && bs[side].deck ? bs[side].deck.length : 0;
        const needN = cond.value || 1;
        if (deckLen < needN) return false;
        break;
      }
      case 'cond_evolved_this_turn': {
        // このターンに自分が1回以上進化させていれば成立
        // bs._evolveCountThisTurn は進化解決時に++される（battle側で更新が必要）
        if (!bs) return false;
        if (!bs._evolveCountThisTurn || bs._evolveCountThisTurn < 1) return false;
        break;
      }
      case 'cond_rest_count_ge': {
        // 両陣営のバトルエリア内でレスト状態のデジモン合計が cond.value 体以上
        if (!bs) return false;
        const min = cond.value || 0;
        const own = (bs.player && bs.player.battleArea) ? bs.player.battleArea.filter(c => c && c.suspended).length : 0;
        const opp = (bs.ai && bs.ai.battleArea) ? bs.ai.battleArea.filter(c => c && c.suspended).length : 0;
        if (own + opp < min) return false;
        break;
      }
      case 'cond_memory_ge': {
        // メモリーが自分側で N 以上 (bs.memory >= N、自分側=正、相手側=負)
        if (!bs) return false;
        const min = cond.value || 0;
        // 自分側にメモリーがある時のみ判定（side === 'player' なら memory >= 0、 'ai' なら memory <= 0）
        const myMemory = side === 'player' ? bs.memory : -bs.memory;
        if (myMemory < min) return false;
        break;
      }
      case 'cond_memory_le': {
        // メモリーが自分側で N 以下 (bs.memory <= N、自分側=正、相手側=負)
        if (!bs) return false;
        const max = cond.value || 0;
        const myMemory = side === 'player' ? bs.memory : -bs.memory;
        if (myMemory > max) return false;
        break;
      }
      case 'cond_exists_count_ge': {
        // サブ条件を満たすデジモンが N 体以上いる
        // cond.value 形式: "<sub_cond>:<N>" or "<sub_cond>" (デフォルト1) や数字単独 (any)
        if (!bs) return false;
        const oppSide2 = side === 'player' ? 'ai' : 'player';
        const oppArea2 = bs[oppSide2].battleArea || [];
        let subCondCode = '';
        let minCount = 1;
        if (typeof cond.value === 'string' && cond.value.indexOf(':') >= 0) {
          const parts = cond.value.split(':');
          subCondCode = parts[0];
          minCount = parseInt(parts[1] || '1', 10) || 1;
        } else if (typeof cond.value === 'number') {
          minCount = cond.value;
        } else if (typeof cond.value === 'string') {
          subCondCode = cond.value;
        }
        const matched = oppArea2.filter(c => {
          if (!c || c.type !== 'デジモン') return false;
          if (!subCondCode) return true;
          // サブ条件評価（cond_exists 内のロジック流用）
          switch (subCondCode) {
            case 'cond_no_evo': return !c.stack || c.stack.length === 0;
            case 'cond_has_evo': return c.stack && c.stack.length >= 1;
            default: return true;
          }
        }).length;
        if (matched < minCount) return false;
        break;
      }
      case 'cond_jogress': {
        // ジョグレス進化していたなら
        if (!card._jogressEvolved) return false;
        break;
      }
      case 'cond_in_battle': {
        // バトル中のみ
        if (!bs || !bs._inBattle) return false;
        break;
      }
      case 'cond_color': {
        // 指定色（cond.value に色文字列）
        if (cond.value && card.color && !String(card.color).includes(cond.value)) return false;
        break;
      }
      case 'cond_feature': {
        // 指定特徴
        if (cond.value && card.feature && !String(card.feature).includes(cond.value)) return false;
        break;
      }
      case 'cond_memory_opponent': {
        // メモリーが相手側のN以上
        if (!bs) break;
        const oppMem = bs.isPlayerTurn ? -bs.memory : bs.memory;
        if (oppMem < (cond.value || 1)) return false;
        break;
      }
      case 'cond_no_tamer_evo': {
        // 進化元にテイマーカードが無い
        if (card.stack && card.stack.some(s => s && (s.type === 'テイマー' || String(s.type||'').toLowerCase().includes('tamer')))) return false;
        break;
      }
      case 'cond_not_own_effect': {
        // 自分の効果以外で消滅した場合のみ true
        // bs._lastDestroyCause が 'own_effect' なら false
        if (bs && bs._lastDestroyCause === 'own_effect') return false;
        break;
      }
      case 'cond_name_contains': {
        // 名称に指定文字列を含む
        if (cond.value && card.name && !String(card.name).includes(cond.value)) return false;
        break;
      }
      case 'cond_feature_contains': {
        // 特徴に指定文字列を含む
        if (cond.value && card.feature && !String(card.feature).includes(cond.value)) return false;
        break;
      }
      case 'cond_link_state': {
        // リンク状態
        if (!card.linkedCards || card.linkedCards.length === 0) return false;
        break;
      }
      case 'cond_link_eligible': {
        // リンク条件を満たす（簡易: linkedCards 上限内）
        const cap = (card._linkCapacityBonus || 0) + 1;
        if (card.linkedCards && card.linkedCards.length >= cap) return false;
        break;
      }
      case 'cond_assembly_eligible': {
        // アセンブリ条件を満たす（カード固有のフラグを参照）
        if (!card._assemblyEligible) return false;
        break;
      }
      case 'cond_digicross': {
        // デジクロスでカードが下に置かれた場合のみ
        if (!card._digicrossed) return false;
        break;
      }
    }
  }
  return true;
}

// ===== 消滅チェック =====
// callback: 消滅した全カードの 演出 + on_destroy リアクションが完了したら呼ぶ

function checkPendingDestroys(ctx, callback) {
  // 消滅対象を「演出 → 削除 → on_destroy」の順で逐次処理する
  // ターンプレイヤー側を先に処理するため順序付き
  const turnPlayerSide = ctx.bs.isPlayerTurn ? 'player' : 'ai';
  const orderedSides = [turnPlayerSide, turnPlayerSide === 'player' ? 'ai' : 'player'];

  // 1) 消滅対象カードを収集（まだ削除しない）
  const pending = [];
  orderedSides.forEach(side => {
    const area = ctx.bs[side].battleArea;
    for (let i = 0; i < area.length; i++) {
      if (area[i] && area[i]._pendingDestroy) {
        pending.push({ side, slot: i, card: area[i] });
      }
    }
  });
  if (pending.length === 0) { callback && callback(); return; }

  // showDestroyEffect の取得（ctx 経由 or window フォールバック）
  const showDE = (ctx && ctx.showDestroyEffect)
    || (window.showDestroyEffect)
    || ((c, cb) => cb && cb()); // フォールバック: 演出なし

  // 2) 1枚ずつ処理: 演出 → trash 移動 → on_destroy
  let idx = 0;
  function processNext() {
    if (idx >= pending.length) { callback && callback(); return; }
    const { side, slot, card } = pending[idx++];
    // 演出
    showDE(card, () => {
      // 削除（演出後に実際に消滅）
      if (ctx.bs[side].battleArea[slot] === card) {
        ctx.bs[side].battleArea[slot] = null;
        ctx.bs[side].trash.push(card);
        if (card.stack) card.stack.forEach(s => ctx.bs[side].trash.push(s));
      }
      ctx.addLog('💀 「' + card.name + '」消滅');
      // オンライン: DP0消滅を即時通知（state_sync遅延による復活を防止）
      if (window._isOnlineMode && window._isOnlineMode()) {
        if (side === 'ai') {
          window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: slot, reason: 'destroy' });
          if (window._markDestroyed) window._markDestroyed('ai', slot);
        } else if (side === 'player') {
          window._onlineSendCommand({ type: 'own_card_removed', slotIdx: slot, reason: 'destroy' });
        }
      }
      ctx.renderAll();
      if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
        window._onlineSendStateSync();
      }
      // 共通の消滅トリガーチェーン
      fireDestroyChain(card, side, ctx.bs, ctx, processNext);
    });
  }
  processNext();
}

// ===== 効果発動アナウンス（カード画像＋効果テキストを数秒表示） =====

function showEffectAnnounce(card, effectText, side, callback, evoSourceCard) {
  // effectTextが空の場合、カードの効果テキスト全文をフォールバック
  let displayText = effectText || card.effect || '';
  // セキュリティ効果が「このカードの【メイン】効果を発揮する」と書かれている場合、
  // card.effect 内の【メイン】ブロックを抽出して併記（プレイヤーがメイン効果の中身を確認できるように）
  const mentionsMain = /このカードの\s*【メイン】\s*効果/.test(displayText);
  if (mentionsMain && card.effect) {
    const mainMatch = card.effect.match(/【メイン】[\s\S]*?(?=\n*【(?:セキュリティ|アタック時|消滅時|登場時|進化時|自分のターン|相手のターン|お互いのターン)】|$)/);
    if (mainMatch) {
      const mainBlock = mainMatch[0].trim();
      if (mainBlock && !displayText.includes(mainBlock)) {
        displayText = displayText + '\n\n📌 ' + mainBlock;
      }
    }
  }
  // タイトルに進化元由来の効果であることを明示
  const titleName = evoSourceCard
    ? (card.name + '（進化元【' + evoSourceCard.name + '】の効果）')
    : card.name;
  // オンライン: 自分側 (side='player') の効果のときだけ相手機に送信。
  // 自機の bs.ai 側の効果 (=相手のカード視点) を送るとオーナー機側で「相手の効果」
  // として誤表示されてしまうので、所有者の機械からだけ送る運用に戻す。
  if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand && side === 'player') {
    try {
      window._onlineSendCommand({ type: 'fx_effectAnnounce', cardName: titleName, effectText: displayText.substring(0,400) });
    } catch (_) {}
  }
  const sideColor = side === 'player' ? '#00fbff' : '#ff00fb';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:55000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

  const box = document.createElement('div');
  box.style.cssText = 'max-width:85%;padding:20px;background:rgba(0,10,20,0.95);border:2px solid ' + sideColor + ';border-radius:12px;box-shadow:0 0 30px ' + sideColor + '44;text-align:center;';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'color:' + sideColor + ';font-size:14px;font-weight:bold;margin-bottom:10px;text-shadow:0 0 8px ' + sideColor + ';';
  nameEl.innerText = '⚡ ' + titleName + ' — 効果発動';
  box.appendChild(nameEl);
  // 進化元由来なら一目で分かるサブラベル
  if (evoSourceCard) {
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#ffaa00;font-size:11px;font-weight:bold;margin-bottom:8px;text-shadow:0 0 4px #ffaa0066;';
    sub.innerText = '◇ 進化元効果 ◇';
    box.appendChild(sub);
  }

  const effectEl = document.createElement('div');
  effectEl.style.cssText = 'color:#ddd;font-size:11px;line-height:1.6;max-height:100px;overflow-y:auto;text-align:left;';
  effectEl.innerText = displayText;
  box.appendChild(effectEl);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // コールバックの二重呼び出し防止
  let called = false;
  function finish() {
    if (called) return;
    called = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback();
  }

  // 2.5秒後に自動で消えてcallback（ローカル表示のみ）
  setTimeout(() => {
    overlay.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(finish, 300);
  }, 2500);

  // タップで早送り
  overlay.addEventListener('click', finish, { once: true });
}

// ===== 効果不発ポップアップ =====

function showEffectFailed(message, callback) {
  const text = message || '💨 対象がいないため、効果発動できませんでした';
  // オンライン: 相手にも不発メッセージを送信
  if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand && !window._suppressFxSend) {
    window._onlineSendCommand({ type: 'fx_effectFailed', text });
  }
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:45%;left:0;z-index:60000;font-size:clamp(0.85rem,3.5vw,1.1rem);font-weight:700;color:#aaa;background:rgba(30,30,40,0.85);padding:10px 28px;border-radius:20px;border:1px solid #555;box-shadow:0 2px 12px rgba(0,0,0,0.4);white-space:nowrap;cursor:pointer;animation:effectFizzleSlide 3.5s cubic-bezier(0.25,1,0.5,1) forwards;';
  el.innerText = text;
  document.body.appendChild(el);
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    if (el.parentNode) el.parentNode.removeChild(el);
    callback && callback();
  }
  // タップでスキップ
  el.addEventListener('click', finish);
  el.addEventListener('touchend', finish);
  setTimeout(finish, 3500);
}

// ===== 確認ダイアログ =====

function showConfirmDialog(card, effectText, callback) {
  const overlay = document.getElementById('effect-confirm-overlay');
  if (!overlay) { callback(false); return; }

  const _show = () => {
    document.getElementById('effect-confirm-name').innerText = card.name;
    document.getElementById('effect-confirm-text').innerText = effectText;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';
    window._effectConfirmCallback = callback;
    if (window._isOnlineMode && window._isOnlineMode()) {
      window._onlineSendCommand({ type: 'fx_confirmShow', cardName: card.name, effectText: (effectText||'').substring(0,200) });
    }
  };

  // チュートリアル: 効果確認画面表示後に割り込み（描画完了を待つ）
  const runner = window._tutorialRunner;
  if (runner && runner.active && typeof runner.checkInterrupt === 'function') {
    _show();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        runner.checkInterrupt('confirm_dialog').then(() => {});
      });
    });
  } else {
    _show();
  }
}

window._effectEngineConfirm = function(yes) {
  document.getElementById('effect-confirm-overlay').style.display = 'none';
  // オンライン: 確認ダイアログを相手側で閉じる
  if (window._isOnlineMode && window._isOnlineMode()) {
    window._onlineSendCommand({ type: 'fx_confirmClose', accepted: yes });
  }
  // ★ コールバック実行前に global を null 化する。
  // cb 内で showConfirmDialog が再度 _effectConfirmCallback を設定するケース
  // （テイマー効果ボタン → さらに engine の確認ダイアログ 等の連鎖）で、
  // 「cb 実行 → null」の順だと再設定されたコールバックまで消えて効果が止まる。
  const cb = window._effectConfirmCallback;
  window._effectConfirmCallback = null;
  if (cb) cb(yes);
};

// ===== DP変化ポップアップ =====

function showDpPopup(value, label) {
  const isPlus = value > 0;
  const popup = document.createElement('div');
  const color = isPlus ? '#00ff88' : '#ff4444';
  const sign = isPlus ? '+' : '';
  if (label) {
    popup.innerHTML = `<div style="font-size:1rem;color:#fff;text-shadow:0 0 10px ${color};margin-bottom:4px;">${label}</div>`
      + `<div>DP${sign}${value}</div>`;
  } else {
    popup.innerText = 'DP' + sign + value;
  }
  popup.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:2rem;font-weight:bold;z-index:60000;pointer-events:none;color:${color};text-shadow:0 0 15px ${color};animation:dpChangePopup 1s ease forwards;text-align:center;white-space:nowrap;`;
  document.body.appendChild(popup);
  setTimeout(() => { if (popup.parentNode) popup.parentNode.removeChild(popup); }, 1100);
}

// ===== 誘発スキャナー =====

// subject 駆動の反応レシピをスキャンしてキューに追加するヘルパ
// sourceOnly トリガー (on_play 等) で「他の自分のデジモンが登場した時」のような
// 反応効果を盤面全体から拾う。block._eventSourceCard に発火元を記録する。
function _scanReactiveSubjectsForSourceOnly(triggerCode, sourceCard, sourceSide, ctx, turnPlayer) {
  const matchSubject = (subject, cardSide) => {
    if (!subject) return false;
    switch (subject) {
      case 'other_own':
      case 'own':
      case 'own_any':
        return cardSide === sourceSide;
      case 'opp':
      case 'opp_any':
      case 'opp_card':
        return cardSide !== sourceSide;
      default: return false;
    }
  };
  const recipeHasReactiveSubject = (steps, cardSide) => {
    if (!Array.isArray(steps)) return false;
    // "他カードのイベントに反応する効果" かどうかは明示的な subject フィールドでのみ判定する。
    // trigger_conditions 内の @own/@opp/@self 等はイベント条件の単なる値スコープ指定であり
    // (例: ブラックウォーグレイモン「アタック時」の cond_attack_target_highest_dp@opp は
    //  “自分の”アタック対象を判定するための条件スコープであって、他カード反応の印ではない)、
    // これを反応判定に流用すると自分自身のイベント専用の効果まで他カードのイベントで誤発火する。
    return steps.some(s => s && matchSubject(s.subject, cardSide));
  };

  ['player', 'ai'].forEach(side => {
    const cards = [...ctx.bs[side].battleArea, ...(ctx.bs[side].tamerArea || [])];
    cards.forEach(card => {
      if (!card || card === sourceCard) return;
      const steps = getRecipeForTrigger(card, triggerCode);
      if (!recipeHasReactiveSubject(steps, side)) return;
      // 'other_own' で同じカード自体は対象外（card !== sourceCard でガード済）
      const dummyBlock = {
        raw: card.effect || '', trigger: { code: triggerCode },
        actions: [], conditions: [], _eventSourceCard: sourceCard,
      };
      addToQueue(card, dummyBlock,
        side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', side
      );
    });
    // 進化元効果側
    ctx.bs[side].battleArea.forEach(card => {
      if (!card || !card.stack) return;
      card.stack.forEach(evoCard => {
        if (!evoCard) return;
        const evoSteps = getRecipeForTrigger(evoCard, triggerCode, true);
        if (!recipeHasReactiveSubject(evoSteps, side)) return;
        const dummyBlock = {
          raw: evoCard.evoSourceEffect || '', trigger: { code: triggerCode },
          actions: [], conditions: [], _recipeCard: evoCard, _eventSourceCard: sourceCard,
        };
        addToQueue(card, dummyBlock,
          side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', side
        );
      });
    });
  });
}

function scanTriggers(triggerCode, sourceCard, sourceSide, ctx) {
  const turnPlayer = ctx.bs.isPlayerTurn ? 'player' : 'ai';

  // 起動効果（main等）はソースカードのみ処理。盤面スキャン不要
  const isActivated = ['main'].includes(triggerCode);
  // ソースカード限定のイベント系トリガー（そのカード固有のイベント）
  // これらは盤面全体をスキャンすると関係ない他カードの効果まで誘発してしまう
  const isSourceOnly = ['on_play', 'on_evolve', 'on_attack', 'on_attack_end', 'security', 'when_blocked', 'on_battle_win', 'on_battle_destroy', 'on_active'].includes(triggerCode);
  // ターン境界トリガー: 「相手のターン終了時」「自分のターン終了時」等は
  // 一方のサイドのカードのみ発火する（相手ターン終了 = 自陣営カードが反応）。
  // sourceSide で指定された側のみスキャン対象にする。
  const isSideScopedTurnTrigger = ['on_opp_turn_end', 'on_own_turn_end', 'on_opp_turn_start', 'on_own_turn_start'].includes(triggerCode);

  if (isActivated) {
    // 起動効果: ソースカードだけキューに追加（レシピのみ）
    if (sourceCard) {
      const recipe = getRecipeForTrigger(sourceCard, triggerCode);
      if (recipe) {
        const dummyBlock = {
          raw: sourceCard.effect || '', trigger: { code: triggerCode },
          actions: [], conditions: [],
        };
        addToQueue(sourceCard, dummyBlock,
          sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
        );
      }
    }
  } else if (isSourceOnly) {
    // ソースカード限定イベント: ソースカード本体＋その進化元効果のみ処理（レシピのみ）
    // === NEW: 加えて、盤面の他カードで subject='other_own' / 'opp' 等の反応レシピがあればキューに追加 ===
    // 例: ダルクモン「他の自分のデジモンが登場した時に発動」
    if (sourceCard && (triggerCode === 'on_play' || triggerCode === 'on_evolve' || triggerCode === 'on_attack')) {
      _scanReactiveSubjectsForSourceOnly(triggerCode, sourceCard, sourceSide, ctx, turnPlayer);
    }
    if (sourceCard) {
      const mainRecipe = getRecipeForTrigger(sourceCard, triggerCode);
      if (mainRecipe) {
        const dummyBlock = {
          // security トリガー（セキュリティからチェックして発動）はセキュリティ効果テキストを、
          // それ以外（main = 手札から発動 等）はメイン効果テキストを効果説明に表示する
          raw: ((triggerCode === 'security' ? (sourceCard.securityEffect || sourceCard.effect) : sourceCard.effect) || ''),
          trigger: { code: triggerCode },
          actions: [], conditions: [],
        };
        addToQueue(sourceCard, dummyBlock,
          sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
        );
      }
      // 付与効果（grant_effect で付与されたレシピ）も triggerCode でスキャン
      // 例: ヘブンズリッパーで全デジモンが得る「【アタック時】DP-2000」
      if (Array.isArray(sourceCard._grantedRecipes)) {
        sourceCard._grantedRecipes.forEach(g => {
          const gSteps = g && g.recipe && g.recipe[triggerCode];
          if (gSteps && Array.isArray(gSteps)) {
            const gBlock = {
              raw: (g.granterText || ('付与効果（' + (g.granterName || '') + '）')),
              trigger: { code: triggerCode },
              actions: [], conditions: [], _grantedSteps: gSteps,
            };
            addToQueue(sourceCard, gBlock,
              sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
            );
          }
        });
      }
      // ソースカードの進化元効果もスキャン（レシピのみ）
      if (sourceCard.stack) {
        console.log('[scanTriggers/sourceOnly evo] trigger=' + triggerCode + ' source=' + sourceCard.name + ' stack数=' + sourceCard.stack.length);
        sourceCard.stack.forEach((evoCard, evoIdx) => {
          if (!evoCard) return;
          const evoRecipeSteps = getRecipeForTrigger(evoCard, triggerCode, true);
          console.log('  [evo' + evoIdx + ']', evoCard.name, 'recipe=' + (evoRecipeSteps ? '有' : '無'));
          if (!evoRecipeSteps) return;
          const dummyBlock = {
            raw: evoCard.evoSourceEffect || '', trigger: { code: triggerCode },
            actions: [], conditions: [], _recipeCard: evoCard,
          };
          addToQueue(sourceCard, dummyBlock,
            sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
          );
        });
        console.log('[scanTriggers/sourceOnly evo] done queue size=' + _effectQueue.length);
      }
    }
  } else {
    // 誘発効果: 盤面全体をスキャン（レシピのみ）
    // ターン境界トリガーは sourceSide のみスキャン
    const sidesToScan = isSideScopedTurnTrigger && sourceSide
      ? [sourceSide]
      : ['player', 'ai'];
    sidesToScan.forEach(side => {
      [...ctx.bs[side].battleArea, ...(ctx.bs[side].tamerArea || [])].forEach(card => {
        if (!card) return;
        const priority = triggerCode.startsWith('when_') ? 'interrupt' : 'normal';
        const cardRecipe = getRecipeForTrigger(card, triggerCode);
        if (!cardRecipe) return;
        const dummyBlock = {
          raw: card.effect || '', trigger: { code: triggerCode },
          actions: [], conditions: [],
        };
        addToQueue(card, dummyBlock, side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', priority, side);
      });

      // 進化元効果もスキャン（レシピのみ）
      ctx.bs[side].battleArea.forEach(card => {
        if (!card || !card.stack) return;
        card.stack.forEach(evoCard => {
          if (!evoCard) return;
          const evoRecipeSteps = getRecipeForTrigger(evoCard, triggerCode, true);
          if (!evoRecipeSteps) return;
          const dummyBlock = {
            raw: evoCard.evoSourceEffect || '', trigger: { code: triggerCode },
            actions: [], conditions: [], _recipeCard: evoCard,
          };
          addToQueue(card, dummyBlock,
            side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', side
          );
        });
      });
    });

    // ソースカード自身（盤面スキャンで見つからなかった場合のみ追加・レシピのみ）
    if (sourceCard) {
      const alreadyQueued = _effectQueue.some(e => e.card === sourceCard);
      if (!alreadyQueued) {
        const recipe = getRecipeForTrigger(sourceCard, triggerCode);
        if (recipe) {
          const dummyBlock = {
            raw: sourceCard.effect || '', trigger: { code: triggerCode },
            actions: [], conditions: [],
          };
          addToQueue(sourceCard, dummyBlock,
            sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
          );
        }
      }
    }
  }

  sortQueue();
}

// ===== レシピ実行エンジン =====

// カードから指定トリガーのレシピを直接取得（use_main_effect用）
function getRecipeForCard(card, triggerCode) {
  if (!card || !card.recipe) return null;
  try {
    const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
    const recipes = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return recipes[triggerCode] || null;
  } catch(e) { return null; }
}

// カードからトリガーに対応するレシピを取得
//
// 引数:
//   card:        対象カード
//   triggerCode: トリガーコード（on_attack 等）
//   inEvoSource: true → evo_source 階層のみ参照（このカードが他カードの進化元として
//                       見られている時）
//                false (default) → top-level のみ参照（このカードがメインとして
//                       見られている時）
//
// 注意: フォールバック検索（top-level → evo_source）は意図しない発動の原因になるため
// 廃止。呼び出し側は inEvoSource を明示する。
function getRecipeForTrigger(card, triggerCode, inEvoSource = false) {
  if (!card.recipe) return null;
  try {
    // 制御文字(改行等)＋直後の空白を除去（スプレッドシートのセル内改行対策）
    const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
    const recipes = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (inEvoSource) {
      // 進化元コンテキスト: evo_source.X のみ（top-level は見ない）
      if (recipes['evo_source'] && recipes['evo_source'][triggerCode]) return recipes['evo_source'][triggerCode];
      return null;
    }
    // メインコンテキスト: top-level のみ
    if (recipes[triggerCode]) return recipes[triggerCode];
    // セキュリティ効果でuse_main_effectの場合、mainレシピを返す
    if (triggerCode === 'security' && recipes['main']) {
      // セキュリティ効果テキストに「メイン効果を発揮」があるか確認
      const secText = card.securityEffect || '';
      if (secText.includes('メイン効果を発揮')) return recipes['main'];
    }
    return null;
  } catch(e) { return null; }
}

// ===== when_opp_rest グローバル発火 =====
// 相手のデジモンがレスト状態になった瞬間に呼ぶ。
// 反対側 (= レストしたデジモンの相手) のバトル/テイマーエリアの when_opp_rest レシピを発動。
//
// 引数:
//   restedSide: 'player' | 'ai' — レストしたデジモンがいる側
//   bs:         battle state
//   ctxBase:    元の context
//   done:       全リアクション完了時 callback
// ===== 自分のブロッカー or 自分のデジモン消滅 トリガー =====
// 共通汎用関数。reactSide のバトルエリア + テイマーエリアをスキャンして recipeKey の
// レシピを発動する。確認ダイアログ・任意効果・once_per_turn 制限なども共通処理。
// stepFilter(step, reactSide): 追加の発動可否判定（省略時は常に true）。
// 「発動主体(step.subject)」で自分/相手を判定するトリガー（when_evo_discard 等）に使う。
function _fireSidedReactionTriggers(reactSide, recipeKey, bs, ctxBase, done, stepFilter) {
  const finish = () => { try { done && done(); } catch(_) {} };
  if (!bs) { finish(); return; }
  const reactPlayer = bs[reactSide];
  if (!reactPlayer) { finish(); return; }
  const cards = [...(reactPlayer.battleArea || []), ...(reactPlayer.tamerArea || [])].filter(c => c);
  const reactions = [];
  cards.forEach(card => {
    if (!card.recipe) return;
    try {
      const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const recipe = r[recipeKey];
      if (recipe && Array.isArray(recipe)) {
        const willRun = recipe.some(step => {
          if (stepFilter && !stepFilter(step, reactSide)) return false;
          if (step.condition) {
            const conds = parseRecipeCondition(step.condition);
            if (!checkConditions(conds, card, bs, reactSide)) return false;
          }
          // gate: 発動可否のみを判定する条件。step.condition と違い対象選択の
          // フィルタには使われない（「自身がレスト中なら相手1体をレスト」等で、
          // 自身の状態判定が相手側の対象フィルタに漏れるのを防ぐ）。
          if (step.gate) {
            const gconds = parseRecipeCondition(step.gate);
            if (!checkConditions(gconds, card, bs, reactSide)) return false;
          }
          if (step.limit === 'once_per_turn' || step.limit === 'limit_once_per_turn') {
            const sourceId = card.cardNo || card.name || 'unknown';
            const limitKey = sourceId + '@' + sourceId + '_recipe_' + step.action;
            if (bs._usedLimits && bs._usedLimits[limitKey]) return false;
          }
          // コスト feasibility チェック: 「自身をレスト」コストがあるが既にレスト中ならスキップ
          // （八神太一(黒) 等が既にレスト状態で再発動できないように）
          if (Array.isArray(step.cost)) {
            for (const c of step.cost) {
              if (c && c.action === 'rest' && (c.target === 'self' || !c.target) && card.suspended) {
                return false;
              }
            }
          }
          return true;
        });
        if (willRun) reactions.push({ card, recipe });
      }
    } catch (_) {}
  });
  if (reactions.length === 0) { finish(); return; }
  let idx = 0;
  function nextReaction() {
    if (idx >= reactions.length) { finish(); return; }
    const { card, recipe } = reactions[idx++];
    const ctx = { ..._buildBaseCtx(ctxBase, bs), card, side: reactSide };
    const proceed = () => {
      ctx.addLog && ctx.addLog('⚡ 「' + card.name + '」の効果発動');
      showEffectAnnounce(card, card.effect || '', reactSide, () => {
        runRecipe(recipe, ctx, () => {
          ctx.renderAll && ctx.renderAll();
          if (window._isOnlineMode && window._isOnlineMode() && reactSide === 'player' && window._onlineSendCommand) {
            window._onlineSendCommand({ type: 'fx_effectClose' });
          }
          nextReaction();
        });
      });
    };
    const isOptional = recipe.some(s => s && (s.optional === true || (Array.isArray(s.cost) && s.cost.length > 0)));
    if (isOptional) {
      if (reactSide === 'player') {
        showConfirmDialog(card, card.effect || '', (yes) => {
          if (yes) proceed();
          else { ctx.addLog && ctx.addLog('☓ 「' + card.name + '」の効果は発動しなかった'); nextReaction(); }
        });
      } else {
        ctx.addLog && ctx.addLog('☓ AI: 「' + card.name + '」の効果は発動しなかった');
        nextReaction();
      }
      return;
    }
    proceed();
  }
  nextReaction();
}

// 自分のブロッカーがレストしたとき → blockOwnerSide のテイマー/デジモンが反応
// 八神太一(黒) 用
export function fireWhenOwnBlockTriggers(blockOwnerSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(blockOwnerSide, 'when_own_block', bs, ctxBase, done);
}

// 自分のデジモンが消滅したとき → 同 side のテイマー/デジモンが反応
// 石田ヤマト(紫) 用
export function fireWhenOwnDestroyedTriggers(destroyedSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(destroyedSide, 'when_own_destroyed', bs, ctxBase, done);
}

// 消滅するとき（消滅置換効果用） → 該当カードを持つ side が反応
export function fireWhenDestroyTriggers(destroyedSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(destroyedSide, 'when_destroy', bs, ctxBase, done);
}

// バトルで消滅するとき（消滅前・置換効果用） → 消滅直前に呼び出す（コスト払いで消滅キャンセル）
// TODO: battle-combat.js のバトル消滅処理前に呼び出し実装が必要
export function fireWhenBattleDestroyTriggers(destroyedSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(destroyedSide, 'when_battle_destroy', bs, ctxBase, done);
}

// バトルエリアを離れるとき → 離れる側の自分側が反応
export function fireWhenLeaveBattleTriggers(leavingSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(leavingSide, 'when_leave_battle', bs, ctxBase, done);
}

// セキュリティが減ったとき → 減った側の自分側が反応
export function fireWhenSecurityDecreaseTriggers(decreasedSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(decreasedSide, 'when_security_decrease', bs, ctxBase, done);
}

// 手札に戻ったとき → 戻った側が反応
export function fireWhenReturnToHandTriggers(returnedSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(returnedSide, 'when_return_to_hand', bs, ctxBase, done);
}

// アタック対象が変更されたとき → アタック側の自分側が反応
export function fireWhenTargetChangedTriggers(attackerSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(attackerSide, 'when_target_changed', bs, ctxBase, done);
}

// 相手のデジモンがプレイヤーにアタックしたとき → アタックされた側（防御側）が反応
// ロゼモン(BT1-082) 等「相手のデジモンがプレイヤーにアタックしたとき〜」用。
// attackerSide = アタックしたデジモンがいる側。反応するのはその反対側。
export function fireWhenOppAttackTriggers(attackerSide, bs, ctxBase, done) {
  const reactSide = attackerSide === 'player' ? 'ai' : 'player';
  return _fireSidedReactionTriggers(reactSide, 'when_opp_attack', bs, ctxBase, done);
}

// デジモンの進化元が破棄されたとき → 発動主体(step.subject: 'opp'='相手のデジモン' /
// 'own'='自分のデジモン')で判定し、両陣営をスキャンして反応させる。
// 城戸丈(BT2-085)「相手のデジモンの進化元を破棄したとき」用。subject 未指定時は不発火
// （このトリガーは「誰の進化元か」を明示しないと意味を成さないため）。
// discardedSide = 進化元を破棄されたデジモンがいる側。
export function fireWhenEvoDiscardTriggers(discardedSide, bs, ctxBase, done) {
  const finish = () => { try { done && done(); } catch(_) {} };
  const subjectMatches = (step, cardSide) => {
    if (step.subject === 'opp') return discardedSide !== cardSide;
    if (step.subject === 'own') return discardedSide === cardSide;
    return false;
  };
  _fireSidedReactionTriggers('player', 'when_evo_discard', bs, ctxBase, () => {
    _fireSidedReactionTriggers('ai', 'when_evo_discard', bs, ctxBase, finish, subjectMatches);
  }, subjectMatches);
}

// 自分のメインフェイズ開始時 → ターンプレイヤー側が反応
export function fireOnMainPhaseStartTriggers(turnSide, bs, ctxBase, done) {
  return _fireSidedReactionTriggers(turnSide, 'on_main_phase_start', bs, ctxBase, done);
}

// 相手のメインフェイズ開始時 → 非ターンプレイヤー側が反応
export function fireOnOppMainPhaseStartTriggers(turnSide, bs, ctxBase, done) {
  const oppSide = turnSide === 'player' ? 'ai' : 'player';
  return _fireSidedReactionTriggers(oppSide, 'on_opp_main_phase_start', bs, ctxBase, done);
}

// 【カウンター】効果 → 相手のアタック時、手札からカウンター可能なカードを使える
export function fireCounterTriggers(attackerSide, bs, ctxBase, done) {
  const finish = () => { try { done && done(); } catch(_) {} };
  if (!bs) { finish(); return; }
  const reactSide = attackerSide === 'player' ? 'ai' : 'player';
  const reactPlayer = bs[reactSide];
  if (!reactPlayer) { finish(); return; }
  // 手札からカウンター可能なカードを抽出
  const handCards = (reactPlayer.hand || []).filter(c => c && c.recipe);
  const counters = [];
  handCards.forEach(card => {
    try {
      const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (r.counter && Array.isArray(r.counter)) counters.push({ card, recipe: r.counter });
    } catch(_) {}
  });
  if (counters.length === 0) { finish(); return; }
  // 簡易: プレイヤーのみダイアログ提示（AIは未対応）
  if (reactSide !== 'player') { finish(); return; }
  // 既存の confirm UI で「カウンター効果を使う？」を出す形は省略し、手動操作にゆだねる
  finish();
}

export function fireWhenOppRestTriggers(restedSide, bs, ctxBase, done) {
  const finish = () => { try { done && done(); } catch(_) {} };
  console.log('[fireWhenOppRest] called restedSide=' + restedSide + ' isPlayerTurn=' + (bs && bs.isPlayerTurn));
  if (!bs) { finish(); return; }
  const reactSide = restedSide === 'player' ? 'ai' : 'player';
  const reactPlayer = bs[reactSide];
  if (!reactPlayer) { finish(); return; }
  // バトルエリア + テイマーエリアをスキャン
  const cards = [...(reactPlayer.battleArea || []), ...(reactPlayer.tamerArea || [])].filter(c => c);
  console.log('[fireWhenOppRest] reactSide=' + reactSide + ' scan対象=' + cards.map(c => c.name).join(','));
  const reactions = [];
  cards.forEach(card => {
    if (!card.recipe) {
      console.log('  [fireWhenOppRest] skip ' + card.name + ' (recipe無し)');
      return;
    }
    try {
      const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const recipe = r.when_opp_rest;
      if (recipe && Array.isArray(recipe)) {
        // 実行可能性事前チェック (条件 + once_per_turn)
        const willRun = recipe.some(step => {
          if (step.condition) {
            const conds = parseRecipeCondition(step.condition);
            const ok = checkConditions(conds, card, bs, reactSide);
            console.log('  [fireWhenOppRest] ' + card.name + ' condition=' + step.condition + ' result=' + ok);
            if (!ok) return false;
          }
          if (step.limit === 'once_per_turn' || step.limit === 'limit_once_per_turn') {
            const sourceId = card.cardNo || card.name || 'unknown';
            const limitKey = sourceId + '@' + sourceId + '_recipe_' + step.action;
            if (bs._usedLimits && bs._usedLimits[limitKey]) {
              console.log('  [fireWhenOppRest] ' + card.name + ' limit済');
              return false;
            }
          }
          return true;
        });
        console.log('  [fireWhenOppRest] ' + card.name + ' willRun=' + willRun);
        if (willRun) reactions.push({ card, recipe });
      } else {
        console.log('  [fireWhenOppRest] ' + card.name + ' when_opp_rest無し');
      }
    } catch (e) {
      console.log('  [fireWhenOppRest] ' + card.name + ' parse error', e.message);
    }
  });
  console.log('[fireWhenOppRest] reactions.length=' + reactions.length);
  if (reactions.length === 0) { finish(); return; }
  let idx = 0;
  function nextReaction() {
    if (idx >= reactions.length) { finish(); return; }
    const { card, recipe } = reactions[idx++];
    const ctx = { ..._buildBaseCtx(ctxBase, bs), card, side: reactSide };

    const proceed = () => {
      ctx.addLog && ctx.addLog('⚡ 「' + card.name + '」の効果発動');
      showEffectAnnounce(card, card.effect || '', reactSide, () => {
        runRecipe(recipe, ctx, () => {
          ctx.renderAll && ctx.renderAll();
          if (window._isOnlineMode && window._isOnlineMode() && reactSide === 'player' && window._onlineSendCommand) {
            window._onlineSendCommand({ type: 'fx_effectClose' });
          }
          nextReaction();
        });
      });
    };

    // 任意効果（コストを伴うレストや手札捨て等）→ プレイヤー側のみ確認ダイアログを出す
    // AI 側は自動でスキップ判定（AI ロジック未実装のため、現状は発動しない方を選ぶ）
    const isOptional = recipe.some(s => s && (s.optional === true || (Array.isArray(s.cost) && s.cost.length > 0)));
    if (isOptional) {
      if (reactSide === 'player') {
        showConfirmDialog(card, card.effect || '', (yes) => {
          if (yes) proceed();
          else {
            ctx.addLog && ctx.addLog('☓ 「' + card.name + '」の効果は発動しなかった');
            nextReaction();
          }
        });
      } else {
        // AI: 任意効果はスキップ（将来 AI 判断ロジックを実装する場所）
        ctx.addLog && ctx.addLog('☓ AI: 「' + card.name + '」の効果は発動しなかった');
        nextReaction();
      }
      return;
    }
    // 強制効果 → そのまま実行（旧パスとの互換のためここでは旧構造を踏襲）
    ctx.addLog && ctx.addLog('⚡ 「' + card.name + '」の効果発動');
    showEffectAnnounce(card, card.effect || '', reactSide, () => {
      runRecipe(recipe, ctx, () => {
        ctx.renderAll && ctx.renderAll();
        if (window._isOnlineMode && window._isOnlineMode() && reactSide === 'player' && window._onlineSendCommand) {
          window._onlineSendCommand({ type: 'fx_effectClose' });
        }
        nextReaction();
      });
    });
  }
  nextReaction();
}

// ===== on_destroy グローバル発火 =====
// デジモン消滅時に呼ぶ。消滅したデジモンの「相手側」のカード（バトルエリア + 進化元）を
// スキャンし、on_destroy レシピがあれば発動する。
// トコモン/パタモン等「相手のデジモンが消滅したとき」効果のためのフック。
//
// 効果は **逐次** 実行される。複数リアクションがあれば「どちらから発動？」UI を出して
// プレイヤー（リアクション側がターンプレイヤーなら）が順番を選択する。
// すべて完了したら done コールバックを呼ぶ。
//
// 引数:
//   destroyedSide: 'player' | 'ai' — 消滅したカードがあった側
//   bs:            battle state
//   ctxBase:       元の context（addLog/renderAll/updateMemGauge 等を引き継ぐ）
//   done:          全リアクション完了時に呼ぶコールバック（省略時は no-op）
// 共通: 消滅後のトリガーチェーン
// 順序: 自身のon_destroy → when_own_destroyed → when_opp_destroyed → when_other_destroyed
// destroyedCard: 消滅したカード（必須）
// destroyedSide: 'player'/'ai'
export function fireDestroyChain(destroyedCard, destroyedSide, bs, ctxBase, callback) {
  const finish = () => { try { callback && callback(); } catch(_) {} };
  if (!destroyedCard || !bs) { finish(); return; }
  const oppSide = destroyedSide === 'player' ? 'ai' : 'player';
  // 1) 消滅したカード自身＋その進化元の on_destroy
  fireOnDestroyTriggers(destroyedSide, bs, ctxBase, () => {
    // 2) 反対側のカード（本体＋進化元）の on_destroy 反応も発火する。
    //    例: ラブラモン進化元「相手デジモンがDP0で消滅したとき1ドロー」。
    //    効果によるDP0消滅でも、セキュリティチェック消滅と同じ反応経路
    //    （_fireDestroyTriggersImpl）に揃える。
    _fireDestroyTriggersImpl(destroyedSide, bs, ctxBase, () => {
      _fireSidedReactionTriggers(destroyedSide, 'when_own_destroyed', bs, ctxBase, () => {
        _fireSidedReactionTriggers(oppSide, 'when_opp_destroyed', bs, ctxBase, () => {
          _fireSidedReactionTriggers('player', 'when_other_destroyed', bs, ctxBase, () => {
            _fireSidedReactionTriggers('ai', 'when_other_destroyed', bs, ctxBase, finish);
          });
        });
      });
    }, 'on_destroy');
  }, destroyedCard);
}

export function fireOnDestroyTriggers(destroyedSide, bs, ctxBase, done, destroyedCard) {
  // 消滅したカード自身および進化元の自己効果を発動
  if (destroyedCard) {
    return _fireSelfDestroyEffects(destroyedCard, destroyedSide, bs, ctxBase, done, 'on_destroy');
  }
  return _fireDestroyTriggersImpl(destroyedSide, bs, ctxBase, done, 'on_destroy');
}

// ===== on_battle_destroy グローバル発火 =====
// バトル解決（DP比較）で消滅した場合のみ呼ぶ。効果による消滅では呼ばない。
// 道連れ等「このデジモンがバトルで消滅したとき」用のフック。
export function fireOnBattleDestroyTriggers(destroyedSide, bs, ctxBase, done, destroyedCard) {
  if (destroyedCard) {
    return _fireSelfDestroyEffects(destroyedCard, destroyedSide, bs, ctxBase, done, 'on_battle_destroy');
  }
  return _fireDestroyTriggersImpl(destroyedSide, bs, ctxBase, done, 'on_battle_destroy');
}

// 消滅したカード自身（および進化元）が持つ on_destroy / on_battle_destroy 効果を発動
// destroyedCard: 消滅したカード本体
// destroyedSide: そのカードが所属していた side ('player' or 'ai')
function _fireSelfDestroyEffects(destroyedCard, destroyedSide, bs, ctxBase, done, triggerKey) {
  const finish = () => { try { done && done(); } catch(_) {} };
  if (!destroyedCard || !bs) { finish(); return; }
  const reactions = [];
  const parseRecipe = (recipe) => {
    if (!recipe) return null;
    try {
      const raw = typeof recipe === 'string' ? recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : recipe;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch(_) { return null; }
  };
  // 1) 本体カードの on_destroy
  const ownR = parseRecipe(destroyedCard.recipe);
  if (ownR && Array.isArray(ownR[triggerKey])) {
    reactions.push({ sourceCard: destroyedCard, recipe: ownR[triggerKey], carrier: destroyedCard });
  }
  // 2) 進化元カードの evo_source.on_destroy
  if (Array.isArray(destroyedCard.stack)) {
    destroyedCard.stack.forEach(evoCard => {
      if (!evoCard) return;
      const r = parseRecipe(evoCard.recipe);
      if (r && r.evo_source && Array.isArray(r.evo_source[triggerKey])) {
        reactions.push({ sourceCard: evoCard, recipe: r.evo_source[triggerKey], carrier: destroyedCard });
      }
    });
  }
  if (reactions.length === 0) { finish(); return; }
  let i = 0;
  const runOne = () => {
    if (i >= reactions.length) { finish(); return; }
    const { sourceCard, recipe, carrier } = reactions[i++];
    const ctx = { ..._buildBaseCtx(ctxBase, bs), card: carrier, side: destroyedSide };
    const effText = (sourceCard !== carrier && sourceCard.evoSourceEffect && sourceCard.evoSourceEffect !== 'なし')
      ? sourceCard.evoSourceEffect : (sourceCard.effect || carrier.effect || '');
    ctx.addLog && ctx.addLog('⚡ 「' + (carrier.name||'?') + '」' + (sourceCard !== carrier ? 'の進化元【'+sourceCard.name+'】' : '') + 'の効果発動');
    showEffectAnnounce(carrier, effText, destroyedSide, () => {
      runRecipe(recipe, ctx, () => {
        ctx.renderAll && ctx.renderAll();
        // showEffectAnnounce で相手機に開いた効果ポップアップを閉じる（announce と対称）
        if (window._isOnlineMode && window._isOnlineMode() && destroyedSide === 'player' && window._onlineSendCommand) {
          window._onlineSendCommand({ type: 'fx_effectClose' });
        }
        runOne();
      });
    }, sourceCard !== carrier ? sourceCard : undefined);
  };
  runOne();
}

function _fireDestroyTriggersImpl(destroyedSide, bs, ctxBase, done, triggerKey) {
  const finish = () => { try { done && done(); } catch(_) {} };
  if (!bs) { finish(); return; }
  // 反対側 = リアクション側
  const reactSide = destroyedSide === 'player' ? 'ai' : 'player';
  const reactPlayer = bs[reactSide];
  if (!reactPlayer || !reactPlayer.battleArea) { finish(); return; }

  // 全 carrier × 全進化元（+ carrier 自身）から triggerKey レシピを収集
  // ★ この関数は常に「消滅したカードの反対側」を無条件にスキャンするため、
  //   明示的に subject:"opp"系 を持つステップだけを反応対象とする。
  //   on_destroy は本来「自身が消滅したとき」専用トリガー（自己効果は
  //   _fireSelfDestroyEffects が別途処理済）なので、subject 無しの
  //   on_destroy まで拾うと無関係な自己完結効果まで誤発火する
  //   （例: 攻撃側ピヨモンの消滅で防御側ウィザーモン/プロットモンが反応してしまう）。
  const isOppReactiveStep = (s) => !!s && (s.subject === 'opp' || s.subject === 'opp_any' || s.subject === 'opp_card');
  const reactions = [];
  reactPlayer.battleArea.forEach((carrier) => {
    if (!carrier) return;
    // 1) 進化元カードそれぞれの triggerKey をスキャン
    if (carrier.stack) {
      carrier.stack.forEach(evoCard => {
        if (!evoCard || !evoCard.recipe) return;
        try {
          const raw = typeof evoCard.recipe === 'string'
            ? evoCard.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : evoCard.recipe;
          const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
          // 進化元効果専用: evo_source[triggerKey] のみ拾う
          const recipe = r.evo_source && r.evo_source[triggerKey];
          if (Array.isArray(recipe) && recipe.some(isOppReactiveStep)) {
            reactions.push({ sourceCard: evoCard, recipe, carrier });
          }
        } catch (_) {}
      });
    }
    // 2) carrier 自身の triggerKey（メイン効果として）
    if (carrier.recipe) {
      try {
        const raw = typeof carrier.recipe === 'string'
          ? carrier.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : carrier.recipe;
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(r[triggerKey]) && r[triggerKey].some(isOppReactiveStep)) {
          reactions.push({ sourceCard: carrier, recipe: r[triggerKey], carrier });
        }
      } catch (_) {}
    }
  });

  // ★ 実行されないリアクションを事前に除外
  // - once_per_turn が既に消費済み
  // - 条件（cond_during_own_turn 等）を満たさない
  // → 実行されないリアクションは選択 UI に出さない
  const filtered = reactions.filter(({ sourceCard, recipe, carrier }) => {
    if (!Array.isArray(recipe) || recipe.length === 0) return false;
    return recipe.some(step => {
      // 条件チェック
      if (step.condition) {
        const conds = parseRecipeCondition(step.condition);
        if (!checkConditions(conds, carrier, bs, reactSide)) return false;
      }
      // ターンに1回制限チェック
      if (step.limit === 'once_per_turn' || step.limit === 'limit_once_per_turn') {
        const sourceId = (sourceCard && (sourceCard.cardNo || sourceCard.name)) || 'unknown';
        const carrierId = (carrier && (carrier.cardNo || carrier.name)) || 'unknown';
        const limitKey = sourceId + '@' + carrierId + '_recipe_' + step.action;
        if (bs._usedLimits && bs._usedLimits[limitKey]) return false;
      }
      return true;
    });
  });

  if (filtered.length === 0) { finish(); return; }
  reactions.length = 0;
  reactions.push(...filtered);

  // 残リアクション配列を消費していく
  const remaining = reactions.slice();

  function runOne(reaction, afterDone) {
    const { sourceCard, recipe, carrier } = reaction;
    const ctx = { ..._buildBaseCtx(ctxBase, bs), card: carrier, side: reactSide, _sourceCard: sourceCard };
    const effectText = sourceCard.evoSourceEffect && sourceCard.evoSourceEffect !== 'なし'
      ? sourceCard.evoSourceEffect
      : (sourceCard.effect || '');
    ctx.addLog && ctx.addLog('⚡ 「' + sourceCard.name + '」の効果発動');
    showEffectAnnounce(sourceCard, effectText, reactSide, () => {
      runRecipe(recipe, ctx, () => {
        ctx.renderAll && ctx.renderAll();
        if (window._isOnlineMode && window._isOnlineMode() && reactSide === 'player' && window._onlineSendCommand) {
          window._onlineSendCommand({ type: 'fx_effectClose' });
        }
        afterDone();
      });
    });
  }

  function nextReaction() {
    if (remaining.length === 0) { finish(); return; }
    if (remaining.length === 1) {
      // 1 つだけなら即実行
      const r = remaining.shift();
      runOne(r, nextReaction);
      return;
    }
    // 複数 → リアクション側がローカルプレイヤーの時だけ選択 UI を出す
    // （ai 側は自動で先頭から処理）
    if (reactSide !== 'player') {
      const r = remaining.shift();
      runOne(r, nextReaction);
      return;
    }
    // 自動発動できるリアクションを先に実行する
    const autoIdx = remaining.findIndex(r => !_reactionNeedsUserInput(r));
    if (autoIdx >= 0) {
      const [r] = remaining.splice(autoIdx, 1);
      runOne(r, nextReaction);
      return;
    }
    // 残りは全て手動入力必要 → 複数なら順序選択UI、1件ならそのまま実行
    if (remaining.length === 1) {
      const r = remaining.shift();
      runOne(r, nextReaction);
      return;
    }
    showReactionOrderSelect(remaining, (chosenIdx) => {
      const [r] = remaining.splice(chosenIdx, 1);
      runOne(r, nextReaction);
    });
  }
  nextReaction();
}

// リアクションがプレイヤー入力（対象選択・コスト等）を必要とするか
function _reactionNeedsUserInput(reaction) {
  if (!reaction || !reaction.recipe || !Array.isArray(reaction.recipe)) return true;
  return reaction.recipe.some(step => {
    if (Array.isArray(step.cost) && step.cost.length > 0) return true;
    if (step.optional === true) return true;
    if (step.action && MANUAL_INPUT_ACTIONS && MANUAL_INPUT_ACTIONS[step.action]) return true;
    if (step.target) {
      const t = String(step.target);
      if (t === 'self') return false;
      if (/^(own|opponent):all$/.test(t)) return false;
      if (/^target_(self|all_own|all_opponent|all_own_security|battle_opponent)/.test(t)) return false;
      if (/^(own|opponent):(\d+|up_to_\d+)$/.test(t)) return true;
      if (/^target_/.test(t)) return true;
    }
    return false;
  });
}

// ===== リアクション順番選択 UI =====
// 「どちらから発動しますか？」モーダル。カードと効果テキストを並べ、タップで選択。
function showReactionOrderSelect(reactions, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:20px;animation:fadeIn 0.2s ease;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;margin-bottom:14px;text-shadow:0 0 8px #00fbff;';
  title.innerText = '⚡ どちらから発動しますか？';
  overlay.appendChild(title);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:90%;';
  overlay.appendChild(row);

  reactions.forEach((reaction, idx) => {
    const { sourceCard } = reaction;
    const card = document.createElement('div');
    card.style.cssText = 'background:#0a0a0a;border:2px solid #00fbff;border-radius:10px;padding:10px;width:200px;cursor:pointer;text-align:center;transition:transform 0.15s ease, box-shadow 0.15s ease;';
    card.onmouseenter = () => { card.style.transform = 'translateY(-3px) scale(1.03)'; card.style.boxShadow = '0 0 18px #00fbff'; };
    card.onmouseleave = () => { card.style.transform = ''; card.style.boxShadow = ''; };
    const imgSrc = sourceCard.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(sourceCard) : '') || sourceCard.imageUrl || '';
    const effText = (sourceCard.evoSourceEffect && sourceCard.evoSourceEffect !== 'なし')
      ? sourceCard.evoSourceEffect
      : (sourceCard.effect || '');
    card.innerHTML =
      (imgSrc ? '<img src="'+imgSrc+'" style="width:120px;border-radius:6px;margin-bottom:8px;border:1px solid #00fbff;">' : '')
      + '<div style="color:#fff;font-size:12px;font-weight:bold;margin-bottom:6px;">'+sourceCard.name+'</div>'
      + '<div style="color:#aaf;font-size:10px;line-height:1.5;text-align:left;max-height:80px;overflow-y:auto;background:#111;padding:6px;border-radius:4px;">'+effText+'</div>';
    card.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      callback(idx);
    };
    row.appendChild(card);
  });

  document.body.appendChild(overlay);
}

// ctx の最小フィールドを構築（addLog/renderAll/updateMemGauge は ctxBase か window から拾う）
function _buildBaseCtx(ctxBase, bs) {
  const safeLog = (msg) => { try { (ctxBase && ctxBase.addLog) ? ctxBase.addLog(msg) : console.log(msg); } catch(_) {} };
  const safeRender = () => { try { (ctxBase && ctxBase.renderAll) ? ctxBase.renderAll() : (window.renderAll && window.renderAll()); } catch(_) {} };
  const safeMem = () => { try { (ctxBase && ctxBase.updateMemGauge) ? ctxBase.updateMemGauge() : (window.updateMemGauge && window.updateMemGauge()); } catch(_) {} };
  return { bs, addLog: safeLog, renderAll: safeRender, updateMemGauge: safeMem };
}

// step.trigger_conditions[] を評価（イベント発火元カードに対して AND）
// trigger_conditions: ["cond_color:黄", "cond_lv:3", "cond_type:デジモン"] のような string 配列
// eventCard: トリガー発火元カード（ctx.block._eventSourceCard or fallback ctx.card）
function checkStepTriggerConditions(step, ctx) {
  if (!step || !Array.isArray(step.trigger_conditions) || step.trigger_conditions.length === 0) return true;
  const eventCard = (ctx && ctx.block && ctx.block._eventSourceCard) || (ctx && ctx.card);
  if (!eventCard) {
    console.log('[trigger_conditions] no event source card → fail');
    return false;
  }
  for (const condStr of step.trigger_conditions) {
    const conds = parseRecipeCondition(String(condStr));
    if (!checkConditions(conds, eventCard, ctx.bs, ctx.side)) {
      console.log('[trigger_conditions] FAIL:', condStr, 'against', eventCard.name);
      return false;
    }
  }
  console.log('[trigger_conditions] all pass');
  return true;
}

// step.limit を最大使用回数に変換（once_per_turn=1 / per_turn:N=N / それ以外=0=無制限）
function getLimitMaxUses(step) {
  const l = String((step && step.limit) || '');
  if (l === 'once_per_turn' || l === 'limit_once_per_turn') return 1;
  const m = l.match(/^(?:limit_)?per_turn:(\d+)$/);
  if (m) return parseInt(m[1]) || 0;
  return 0;
}

// レシピが実行されるか事前判定（全ステップが条件で弾かれるか）
// 戻り値: true=少なくとも1ステップが実行される, false=全ステップが条件NGで何も起きない
// 不確定な場合（store依存・ターゲット選択型など）は安全側で true を返す
function recipeWillExecuteAnything(recipe, ctx) {
  if (!recipe || !Array.isArray(recipe) || recipe.length === 0) return true;
  for (const step of recipe) {
    // trigger_conditions: 発火元カードへのフィルタ（NG なら次の step）
    if (!checkStepTriggerConditions(step, ctx)) continue;
    // limit 到達済みの step はスキップ（2回目/3回目のアタック等で効果説明ポップアップを出さないため）
    const _lMax = getLimitMaxUses(step);
    if (_lMax > 0 && ctx.bs && ctx.bs._usedLimits) {
      const _lsc = ctx._sourceCard || ctx.card;
      const _lSourceId = (_lsc && (_lsc.cardNo || _lsc.name)) || 'unknown';
      const _lCarrierId = (ctx.card && (ctx.card.cardNo || ctx.card.name)) || 'unknown';
      if ((ctx.bs._usedLimits[_lSourceId + '@' + _lCarrierId + '_recipe_' + step.action] || 0) >= _lMax) continue;
    }
    // 条件なし → 必ず実行される
    if (!step.condition) {
      console.log('[recipeWillExecute] step has no condition → true', 'action=' + step.action);
      return true;
    }
    // 条件あり → 評価
    const conds = parseRecipeCondition(step.condition);
    // destroy / rest / bounce / cant_* で target が opponent/own → condition は
    // 「対象カードへのフィルタ」であり、効果発動そのものの可否を決めるゲートではない。
    // 例: メガログラウモン「進化時、赤の自分のテイマーがいるとき、DP3000以下の
    //     相手のデジモン1体を消滅させる」は、trigger_conditions（赤テイマー）が
    //     満たされていれば対象が0体でも効果は発動した扱いとし、演出ポップアップは出す
    //     （対象がいないだけで不発になるのは destroy 実行側の処理に任せる）。
    if (['destroy', 'rest', 'bounce', 'cant_attack', 'cant_block', 'cant_attack_block', 'cant_evolve'].includes(step.action)
        && /^(opponent|own)(?::|$)/.test(String(step.target || ''))) {
      return true;
    }
    const result = checkConditions(conds, ctx.card, ctx.bs, ctx.side);
    console.log('[recipeWillExecute]', 'action=' + step.action, 'condition=' + step.condition, 'parsed=' + JSON.stringify(conds), '→ ' + result);
    if (result) return true;
  }
  console.log('[recipeWillExecute] all steps blocked → false');
  return false;
}

// === post_actions: メインアクション完了後に実行する条件付き追加ステップ群 ===
// ルール内に文脈条件（cond_picked_color 等）が付いた場合、ruleTranslator により
// step.post_actions[] として直列化される。各要素は通常の effect step と同じ構造を
// 持ち、condition / when / extra_conditions で評価される。
// 用途: security_open / deck_open 等の選択完了後に「選んだカードが黄ならリカバリー」
// のような条件分岐を表現するため。
function runPostActions(postActions, ctx, done) {
  if (!Array.isArray(postActions) || postActions.length === 0) {
    done && done();
    return;
  }
  const store = {};
  let i = 0;
  function nextPost() {
    if (i >= postActions.length) { done && done(); return; }
    const pa = postActions[i++];
    // condition があれば checkConditions で評価し、NG なら skip
    if (pa.condition) {
      const conds = parseRecipeCondition(pa.condition);
      const ok = checkConditions(conds, ctx.card, ctx.bs, ctx.side);
      if (!ok) {
        console.log('[runPostActions] condition NG → skip', pa.condition);
        nextPost();
        return;
      }
    }
    executeRecipeStep(pa, ctx, store, () => nextPost());
  }
  nextPost();
}

// === 代替アクション処理: メインアクションと alt_actions[] を OR / AND で結合 ===
// OR  = プレイヤー選択UI（メインと各 alt から1つ選んで実行）
// AND = メイン → alt[0] → alt[1] を順次実行
function runWithAltActions(step, ctx, store, callback) {
  const op = step.alt_actions_op === 'and' ? 'and' : 'or';
  const alts = Array.isArray(step.alt_actions) ? step.alt_actions : [];
  // alt_actions を剥がしたメインステップ（再帰時の無限ループ防止）
  const mainOnly = Object.assign({}, step);
  delete mainOnly.alt_actions;
  delete mainOnly.alt_actions_op;

  if (op === 'and') {
    // メイン → alt 順次
    executeRecipeStep(mainOnly, ctx, store, () => {
      let i = 0;
      function nextAlt() {
        if (i >= alts.length) { callback && callback(); return; }
        const a = alts[i++];
        executeRecipeStep(a, ctx, store, () => nextAlt());
      }
      nextAlt();
    });
    return;
  }

  // OR: メインと alts のどれか1つを選択
  const choices = [mainOnly].concat(alts);
  const labels = choices.map((c) => actionLabelOf(c.action));

  // 盤面状況で実行可能な選択肢が1つだけなら、選択UIを出さず自動実行する。
  // （太刀川ミミ: 育成エリアが空→孵化 / Lv.3以上デジモンがいる→バトル移動。
  //   どちらか一方しか成立しないので「どちらを実行？」を出さない）
  //
  // 汎用ルール（ネガモン等「〜のとき、代わりに〜する」用）:
  // alt側に gate が付いていれば、その条件を満たす時だけ feasible。
  // ※ condition ではなく gate を使うのは、select等一部アクションが condition を
  //   独自形式(dp_le:5000等)の対象フィルタとして専有しているため、衝突を避けるため。
  // メイン側（無条件）は、gateが成立した alt が1つでもあれば「代わりに」置き換えられた
  // とみなし infeasible にする。これにより条件と無条件の1本ずつなら常に自動選択され、
  // プレイヤーへの「どちらを実行？」確認は出ない。
  // gate / gate_when / gate_extra_conditions (AND) を1本の条件配列に組み立てる
  // (発動条件の condition/when/extra_conditions と同じ3フィールド方式)
  const _gateConditionsOf = (step) => {
    if (!step) return [];
    const arr = [];
    if (step.gate) arr.push(...parseRecipeCondition(step.gate));
    if (step.gate_when) arr.push(...parseRecipeCondition(step.gate_when));
    if (Array.isArray(step.gate_extra_conditions)) {
      step.gate_extra_conditions.forEach((s) => arr.push(...parseRecipeCondition(s)));
    }
    return arr;
  };
  const _hasGatedAltMet = alts.some((a) => {
    const _cs = _gateConditionsOf(a);
    return _cs.length > 0 && checkConditions(_cs, ctx.card, ctx.bs, ctx.side);
  });
  const _altFeasible = (c, isMain) => {
    if (!c || !ctx.bs) return true;
    const sidePl = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
    if (c.action === 'hatch') {
      // 育成エリアが空 かつ デジタマデッキにカードがある
      return !sidePl.ikusei && Array.isArray(sidePl.tamaDeck) && sidePl.tamaDeck.length > 0;
    }
    if (c.action === 'battle_area_make') {
      // 育成エリアにデジモンがいる（condition があれば そのデジモンに対し評価）
      if (!sidePl.ikusei) return false;
      if (c.condition) {
        const _cs = parseRecipeCondition(c.condition);
        if (_cs.length > 0 && !checkConditions(_cs, sidePl.ikusei, ctx.bs, ctx.side)) return false;
      }
      return true;
    }
    const _gcs = _gateConditionsOf(c);
    if (_gcs.length > 0) {
      return checkConditions(_gcs, ctx.card, ctx.bs, ctx.side);
    }
    // gate無しのメイン: gateが成立した alt があれば「代わりに」置き換えられるため infeasible
    if (isMain && _hasGatedAltMet) return false;
    return true;
  };
  const _feasibleChoices = choices.filter((c, idx) => _altFeasible(c, idx === 0));
  if (_feasibleChoices.length === 1) {
    executeRecipeStep(_feasibleChoices[0], ctx, store, callback);
    return;
  }

  // AI / 自動選択: 最初の有効な選択肢
  if (ctx.side === 'ai' || ctx._forceAltChoice !== undefined) {
    const idx = (ctx._forceAltChoice !== undefined) ? ctx._forceAltChoice : 0;
    executeRecipeStep(choices[idx] || choices[0], ctx, store, callback);
    return;
  }

  // プレイヤー: 選択UI
  showAltActionChoice(labels, (idx) => {
    // オンライン相手にも選択を共有（fx_remoteAltChoice）
    if (ctx.side === 'player' && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
      try { window._onlineSendCommand({ type: 'fx_remoteAltChoice', choice: idx, label: labels[idx] }); } catch (_) {}
    }
    executeRecipeStep(choices[idx], ctx, store, callback);
  });
}

// アクションコードから表示ラベル取得（辞書未登録なら code そのまま）
function actionLabelOf(code) {
  if (!code) return '(なし)';
  if (typeof getActionLabel === 'function') {
    try { return getActionLabel(code) || code; } catch (_) {}
  }
  return code;
}

// 代替アクション選択UI（OR時）
function showAltActionChoice(labels, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:60000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;animation:fadeIn 0.2s ease;';
  const title = document.createElement('div');
  title.style.cssText = 'color:#e9d5ff;font-size:14px;font-weight:bold;text-shadow:0 0 8px #c084fc;';
  title.innerText = '🔀 どちらを実行しますか？';
  overlay.appendChild(title);
  const btnArea = document.createElement('div');
  btnArea.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-width:90%;';
  overlay.appendChild(btnArea);
  labels.forEach((lbl, i) => {
    const b = document.createElement('button');
    b.innerText = lbl;
    b.style.cssText = 'padding:10px 22px;font-size:13px;background:#9333ea;color:#fff;border:1px solid #c084fc;border-radius:8px;cursor:pointer;font-weight:bold;box-shadow:0 0 12px rgba(192,132,252,0.5);';
    b.onmouseenter = () => { b.style.background = '#a855f7'; };
    b.onmouseleave = () => { b.style.background = '#9333ea'; };
    b.onclick = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      callback(i);
    };
    btnArea.appendChild(b);
  });
  document.body.appendChild(overlay);
}

// レシピを順次実行
function runRecipe(steps, ctx, callback) {
  const store = {}; // ステップ間データ受け渡し用
  let idx = 0;
  console.log('[runRecipe]', 'card=' + (ctx.card && ctx.card.name), 'steps.length=' + (steps && steps.length), 'isArray=' + Array.isArray(steps), 'first=', steps && steps[0]);

  function nextStep(success) {
    // コスト不足等で効果不発: 次ステップに `continue_on_fail` 修飾子があれば継続
    // （「その後」連結のデジカ公式ルール対応）
    if (success === false) {
      const peekNext = steps[idx];
      const continueOnFail = peekNext
        && Array.isArray(peekNext.options)
        && peekNext.options.includes('continue_on_fail');
      if (!continueOnFail) {
        console.log('[runRecipe] aborted (success=false)');
        ctx.renderAll(); callback && callback(); return;
      }
      console.log('[runRecipe] step failed but next has continue_on_fail → continue');
    }
    if (idx >= steps.length) { console.log('[runRecipe] completed all steps'); ctx.renderAll(); callback && callback(); return; }
    const step = steps[idx++];
    console.log('[runRecipe] executing step', idx, 'action=' + step.action, 'target=' + step.target);
    executeRecipeStep(step, ctx, store, nextStep);
  }
  nextStep();
}

// レシピの1ステップを実行
function executeRecipeStep(step, ctx, store, callback) {
  // trigger_conditions ゲート: 発火元カードへのフィルタが NG ならステップスキップ
  if (!checkStepTriggerConditions(step, ctx)) {
    console.log('[executeRecipeStep] trigger_conditions blocked → skip step');
    callback && callback();
    return;
  }

  // ターン回数制限チェック（once_per_turn=1回 / per_turn:N=N回）
  // active 等の専用 case は default の limit-check を通らないため、ここで共通的に判定する
  {
    // コスト持ち step は cost 完了後の本体実行段階(_costsResolved)でのみ判定する。
    // cost 処理は本体を executeRecipeStep で再帰呼び出しするため、判定しないと
    // limit-check が1アタックで2回走り使用回数が二重カウントされる。
    const _hasCost = Array.isArray(step.cost) && step.cost.length > 0;
    const _limitMax = (!_hasCost || step._costsResolved) ? getLimitMaxUses(step) : 0;
    if (_limitMax > 0 && ctx.bs) {
      const _srcCard = ctx._sourceCard || ctx.card;
      const _srcId = (_srcCard && (_srcCard.cardNo || _srcCard.name)) || 'unknown';
      const _carId = (ctx.card && (ctx.card.cardNo || ctx.card.name)) || 'unknown';
      const _limitKey = _srcId + '@' + _carId + '_recipe_' + step.action;
      if (!ctx.bs._usedLimits) ctx.bs._usedLimits = {};
      const _used = ctx.bs._usedLimits[_limitKey] || 0;
      if (_used >= _limitMax) {
        ctx.addLog && ctx.addLog('⏸ ターンに' + _limitMax + '回の制限（' + (_srcCard ? _srcCard.name : '?') + '）');
        callback && callback();
        return;
      }
      ctx.bs._usedLimits[_limitKey] = _used + 1;
    }
  }

  // 代替アクション処理: 'or' = 選択UI / 'and' = 順次実行
  if (Array.isArray(step.alt_actions) && step.alt_actions.length > 0) {
    runWithAltActions(step, ctx, store, callback);
    return;
  }

  // per_count_mode === 'repeat': 値×NでなくアクションをN回繰り返す
  // 例：「黄テイマー1体ごとに相手デジモン1体のDP-4000」→ 2体なら -4000 を2回発動
  if (step.per_count_mode === 'repeat' && step.per_count) {
    const _rRef = step.ref || 'evo_source';
    const _rCount = getRefSourceCountDirect(_rRef, ctx.card, ctx.bs, ctx.side, step.ref_filter, step.ref_state);
    const _rN = Math.floor(_rCount / step.per_count);
    if (_rN <= 0) { callback && callback(); return; }
    const _rStep = Object.assign({}, step);
    delete _rStep.per_count_mode;
    delete _rStep.per_count;
    delete _rStep.ref;
    delete _rStep.ref_filter;
    delete _rStep.ref_state;
    const _rFire = (remaining, done) => {
      if (remaining <= 0) { done(); return; }
      executeRecipeStep(_rStep, ctx, store, () => _rFire(remaining - 1, done));
    };
    _rFire(_rN, callback);
    return;
  }

  // 'same_target' / 'picked' = 直前選択カード (bs._lastPickedCard) を対象に再利用
  // 「DPを+2000し、そのデジモンはSアタック+1を得る」のような同一対象連続適用で使用
  if (step.target === 'same_target' || step.target === 'picked') {
    const picked = ctx.bs && ctx.bs._lastPickedCard;
    if (!picked) {
      ctx.addLog && ctx.addLog('⚠ 直前選択カードがないため対象なし（same_target）');
      callback && callback();
      return;
    }
    const _ownArea = (ctx.side === 'player' ? ctx.bs.player.battleArea : ctx.bs.ai.battleArea) || [];
    const _oppArea = (ctx.side === 'player' ? ctx.bs.ai.battleArea : ctx.bs.player.battleArea) || [];
    const _ownIdx = _ownArea.indexOf(picked);
    const _oppIdx = _oppArea.indexOf(picked);
    if (_ownIdx >= 0) {
      // 自分のデジモン: 'own:1' に置き換え + _forceTargetIdx で UI スキップ
      step = Object.assign({}, step, { target: 'own:1' });
      ctx = Object.assign({}, ctx, { _forceTargetIdx: _ownIdx });
    } else if (_oppIdx >= 0) {
      step = Object.assign({}, step, { target: 'opponent:1' });
      ctx = Object.assign({}, ctx, { _forceTargetIdx: _oppIdx });
    } else if (picked === ctx.card) {
      step = Object.assign({}, step, { target: 'self' });
    } else {
      ctx.addLog && ctx.addLog('⚠ 直前選択カードが場にいません（same_target）');
      callback && callback();
      return;
    }
  }

  const player = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
  const opponent = ctx.side === 'player' ? ctx.bs.ai : ctx.bs.player;
  // _forceTargetIdx で対象が確定済みなら 'ai' 扱い（自動選択パス）
  const effectiveSide = (ctx._forceTargetIdx !== undefined) ? 'ai' : ctx.side;

  // separator ステップ（「その後、」区切り用のマーカー）は何も実行せず次へ
  if (step.separator !== undefined && !step.action) {
    callback && callback();
    return;
  }

  console.log('[executeRecipeStep] step:', JSON.stringify(step).substring(0, 200));
  // step.cost が指定されていれば、本体アクションの前にコストを順次実行する。
  // すべてのコストが成功した場合のみ本体アクションへ進む。
  // 失敗時は callback(false) を呼んで後続レシピごとアボートする。
  if (Array.isArray(step.cost) && step.cost.length > 0 && !step._costsResolved) {
    console.log('[cost] running', step.cost.length, 'cost step(s) before main action=' + step.action);
    let i = 0;
    function runCost() {
      if (i >= step.cost.length) {
        console.log('[cost] all cost steps succeeded, running main action=' + step.action);
        executeRecipeStep({ ...step, _costsResolved: true }, ctx, store, callback);
        return;
      }
      const costStep = step.cost[i++];
      console.log('[cost] executing cost step', i, 'action=' + costStep.action);
      executeRecipeStep(costStep, ctx, store, (success) => {
        if (success === false) {
          console.log('[cost] cost FAILED → aborting main');
          callback && callback(false);
          return;
        }
        runCost();
      });
    }
    runCost();
    return;
  }

  // 条件チェック（stepにconditionがあれば事前判定）
  if (step.require) {
    const req = step.require;
    if (req.evo_count && (!ctx.card.stack || ctx.card.stack.length < req.evo_count)) {
      callback();
      return;
    }
  }

  switch (step.action) {

    // === 対象選択（自分のデジモン） ===
    case 'select': {
      if (step.target === 'own' || step.target === 'own:1') {
        const valid = [];
        for (let i = 0; i < player.battleArea.length; i++) {
          if (player.battleArea[i]) valid.push(i);
        }
        if (valid.length === 0) { showEffectFailed(null, callback); return; }
        const rowId = ctx.side === 'player' ? 'pl' : 'ai';
        showTargetSelection(rowId, valid, null, '#00fbff', (selectedIdx) => {
          if (selectedIdx !== null) {
            const picked = player.battleArea[selectedIdx];
            if (step.store) store[step.store] = { idx: selectedIdx, card: picked };
            // cond_same_as_picked 用にグローバルにも保存
            ctx.bs._lastPickedCard = picked;
          }
          callback();
        });
      } else if (step.target === 'opponent' || step.target === 'opponent:1') {
        const valid = [];
        for (let i = 0; i < opponent.battleArea.length; i++) {
          const c = opponent.battleArea[i];
          if (!c) continue;
          // 条件フィルタ（レシピエディタは "cond_dp_le:5000" 形式で出力するため、
          // 先頭の "cond_" は有無どちらでも受け付ける）
          if (step.condition) {
            const [rawType, condVal] = step.condition.split(':');
            const condType = String(rawType || '').replace(/^cond_/, '');
            if (condType === 'dp_le' && c.dp > parseInt(condVal)) continue;
            if (condType === 'dp_ge' && c.dp < parseInt(condVal)) continue;
            if (condType === 'lv_le' && parseInt(c.level) > parseInt(condVal)) continue;
            if (condType === 'self_active' && c.suspended) continue;
            if (condType === 'self_rest' && !c.suspended) continue;
          }
          valid.push(i);
        }
        console.log('[select opponent]', 'ctxSide=' + ctx.side, 'opponent.battleArea.length=' + opponent.battleArea.length, 'valid=' + valid.length, 'cards=' + opponent.battleArea.filter(c => c).map(c => c.name).join(','));
        if (valid.length === 0) { console.log('[select opponent] FAILED: no valid targets'); showEffectFailed(null, callback); return; }
        const rowId = ctx.side === 'player' ? 'ai' : 'pl';
        showTargetSelection(rowId, valid, null, '#ff4444', (selectedIdx) => {
          if (selectedIdx !== null) {
            const picked = opponent.battleArea[selectedIdx];
            if (step.store) store[step.store] = { idx: selectedIdx, card: picked };
            // cond_same_as_picked 用にグローバルにも保存
            ctx.bs._lastPickedCard = picked;
          }
          callback();
        });
      } else {
        callback();
      }
      break;
    }

    // === 複数体選択（最大N体） ===
    case 'select_multi': {
      const maxCount = step.count || 1;
      // 「N体まで」は任意効果。0体選択も可能。
      const isOptional = maxCount > 1; // 複数選択は基本的に任意（〜まで）
      let selectedCount = 0;
      const selected = [];

      // 確認ダイアログ共通
      // 既存の confirm_dialog スポットライト/割り込みと互換にするため、
      // panel/yes/no に専用 ID を付与し、表示直後に checkInterrupt('confirm_dialog') を呼ぶ。
      // showTargetConfirm（「このカードでいいですか？」）と同じトリガーで連番カウントされる。
      const showConfirmDialog = (msgText, onYes, onNo) => {
        const overlay = document.createElement('div');
        overlay.id = '_select-multi-confirm-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;padding:20px;';
        const box = document.createElement('div');
        box.id = '_select-multi-confirm-panel';
        box.style.cssText = 'background:#0a0a0a;border:1px solid #ff4444;border-radius:12px;padding:24px;max-width:320px;width:100%;text-align:center;';
        box.innerHTML = '<div style="color:#ff4444;font-size:14px;font-weight:bold;margin-bottom:16px;">' + msgText + '</div>'
          + '<div style="display:flex;gap:10px;justify-content:center;">'
          + '<button id="_select-multi-yes" style="background:#ff4444;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">はい</button>'
          + '<button id="_select-multi-no" style="background:#333;color:#fff;border:1px solid #666;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;">いいえ</button>'
          + '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const _notifyClose = (yes) => {
          const r = (typeof window !== 'undefined') ? window._tutorialRunner : null;
          if (r && r.active) {
            try {
              r.notifyEvent('modal_closed', { modal: 'effect_confirm', result: yes });
              if (!yes) r.notifyEvent('action_cancelled', { context: 'effect_confirm' });
              // A案: 全ての確認ダイアログの「はい」で use_effect を発火（進行条件用）
              if (yes) r.notifyEvent('use_effect', { context: 'select_multi_confirm' });
            } catch (_) {}
          }
        };
        document.getElementById('_select-multi-yes').onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); _notifyClose(true); onYes(); };
        document.getElementById('_select-multi-no').onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); _notifyClose(false); onNo(); };
        // チュートリアル割り込み: 確認ダイアログとして発火（既存 confirm_dialog と統合）
        const _runner = (typeof window !== 'undefined') ? window._tutorialRunner : null;
        if (_runner && _runner.active && typeof _runner.checkInterrupt === 'function') {
          try { _runner.checkInterrupt('confirm_dialog'); } catch (_) {}
        }
      };

      function getValidTargets() {
        const valid = [];
        for (let i = 0; i < opponent.battleArea.length; i++) {
          const c = opponent.battleArea[i];
          if (!c || selected.includes(i)) continue;
          if (step.condition) {
            const [rawType, condVal] = step.condition.split(':');
            const condType = String(rawType || '').replace(/^cond_/, '');
            const cardDp = parseInt(c.dp) || 0;
            const limitDp = parseInt(condVal) || 0;
            if (condType === 'dp_le' && cardDp > limitDp) continue;
            if (condType === 'dp_ge' && cardDp < limitDp) continue;
            if (condType === 'lv_le' && (parseInt(c.level) || 0) > parseInt(condVal)) continue;
            if (condType === 'self_active' && c.suspended) continue;
            if (condType === 'self_rest' && !c.suspended) continue;
          }
          valid.push(i);
        }
        return valid;
      }

      // 全選択完了時に呼ぶ（フラグ解除 + オンラインに効果終了通知）
      const finishSelectMulti = () => {
        window._skipFxEffectClose = false;
        if (window._isOnlineMode && window._isOnlineMode()) {
          window._onlineSendCommand({ type: 'fx_effectClose' });
        }
        callback();
      };

      // 初回のみ相手画面に効果内容を送信（カード名+効果テキスト+対象選択中）
      let _annouceSent = false;
      function ensureRemoteAnnounce() {
        if (_annouceSent) return;
        _annouceSent = true;
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && ctx.card) {
          const effText = ctx.card.effect || ctx.card.securityEffect || '';
          window._onlineSendCommand({ type: 'fx_effectAnnounce', cardName: ctx.card.name, effectText: effText.substring(0,300) });
        }
      }

      function doSelect() {
        if (selectedCount >= maxCount) { finishSelectMulti(); return; }
        const valid = getValidTargets();
        if (valid.length === 0) { finishSelectMulti(); return; }
        const rowId = ctx.side === 'player' ? 'ai' : 'pl';
        ctx.addLog('🎯 対象を選んでください（' + (selectedCount + 1) + '体目 / 最大' + maxCount + '体）');
        ensureRemoteAnnounce();
        // 複数選択の途中では fx_effectClose を送信しない
        window._skipFxEffectClose = true;
        showTargetSelection(rowId, valid, null, '#ff4444', (selectedIdx) => {
          if (selectedIdx === null) { finishSelectMulti(); return; }
          selected.push(selectedIdx);
          if (step.store) {
            if (!store[step.store]) store[step.store] = [];
            store[step.store].push({ idx: selectedIdx, card: opponent.battleArea[selectedIdx] });
          }
          selectedCount++;
          // 上限到達 or 対象なし → 終了
          if (selectedCount >= maxCount) { finishSelectMulti(); return; }
          if (getValidTargets().length === 0) { finishSelectMulti(); return; }
          // 任意の場合は次の選択も確認
          if (isOptional) {
            askToSelect();
          } else {
            doSelect();
          }
        });
      }

      function askToSelect() {
        // 対象がなければスキップ
        if (getValidTargets().length === 0) { finishSelectMulti(); return; }
        // 確認ダイアログ表示時にも相手画面に効果内容ポップアップを表示
        ensureRemoteAnnounce();
        const msg = selectedCount === 0 ? '対象を選択しますか？' : 'もう1体選びますか？（残り' + (maxCount - selectedCount) + '体まで）';
        showConfirmDialog(msg, () => doSelect(), () => finishSelectMulti());
      }

      // N体まで効果: 1体目は確認なしで即対象選択へ。
      // 2体目以降は doSelect 内で isOptional 判定により askToSelect (「もう1体選びますか？」) が呼ばれる。
      doSelect();
      break;
    }

    // === 進化元カードを選択 ===
    case 'select_evo_source': {
      const fromData = store[step.from];
      if (!fromData || !fromData.card || !fromData.card.stack || fromData.card.stack.length === 0) {
        ctx.addLog('⚠ 進化元がありません');
        showEffectFailed(null, callback);
        return;
      }
      const parentCard = fromData.card;
      const evoCards = parentCard.stack.filter(s => {
        if (step.filter && step.filter === 'デジモン') return s.type === 'デジモン';
        return true;
      });
      if (evoCards.length === 0) {
        ctx.addLog('⚠ 条件を満たす進化元がありません');
        showEffectFailed(null, callback);
        return;
      }
      // 進化元カードを選択するUI
      showEvoSourceSelection(parentCard, evoCards, step.filter, (selectedEvoCard) => {
        if (selectedEvoCard && step.store) {
          store[step.store] = { card: selectedEvoCard, parentCard: parentCard };
        }
        callback();
      });
      break;
    }

    // === コスト無し登場 ===
    case 'summon': {
      // Security effect: summon self (tamer/digimon) to field at no cost
      // cost_free:true と options:['ignore_cost'] のどちらの表記も受け付ける
      const _summonSelfIgnoreCost = !!step.cost_free || (Array.isArray(step.options) && step.options.includes('ignore_cost'));
      if ((step.target === 'self' || step.target === 'self_card') && _summonSelfIgnoreCost) {
        const cardToSummon = ctx.card;
        if (!cardToSummon) { callback(); break; }
        const p = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
        // テイマー判定: type プロパティ揺らぎ(Firebase復元時に落ちる事例)に備え、
        // セキュリティ/効果テキストに【メイン】が無く Lv が無い等のヒントも併用
        const typeStr = String(cardToSummon.type || '');
        const isTamer = typeStr === 'テイマー' || typeStr.toLowerCase().includes('tamer')
          || (cardToSummon.cardType && String(cardToSummon.cardType).includes('テイマー'))
          // 補助: Lv なし & DP なし & 効果テキストにテイマー特有の記載
          || ((cardToSummon.level === '' || cardToSummon.level == null)
              && (cardToSummon.dp == null || cardToSummon.dp === 0 || cardToSummon.dp === '')
              && (typeof cardToSummon.effect === 'string' && /テイマー|【自分のターン】|【相手のターン】/.test(cardToSummon.effect)));
        if (isTamer) {
          // 既に tamerArea に存在する場合は二重登場させない
          if (!p.tamerArea.includes(cardToSummon)) p.tamerArea.push(cardToSummon);
          ctx.addLog('🌟 「' + cardToSummon.name + '」をテイマーエリアに登場');
        } else {
          // 既にバトルエリアにある場合は二重登場させない
          if (!p.battleArea.includes(cardToSummon)) {
            const empty = p.battleArea.indexOf(null);
            if (empty !== -1) p.battleArea[empty] = cardToSummon;
            else p.battleArea.push(cardToSummon);
          }
          ctx.addLog('🌟 「' + cardToSummon.name + '」をバトルエリアに登場');
        }
        ctx.renderAll();
        callback();
        break;
      }
      // 手札/トラッシュから filter 一致のカードを登場（ピーターモン「ティンカーモン」等）
      // step.from に hand/trash を含み、store 経由でないケース
      {
        const _fromZones = Array.isArray(step.from) ? step.from : (step.from ? [step.from] : []);
        if (!step.card && (_fromZones.includes('hand') || _fromZones.includes('trash'))) {
          const _filter = step.filter || {};
          const _handCands = _fromZones.includes('hand')
            ? (player.hand || []).filter(c => c && cardMatchesFilter(c, _filter)) : [];
          const _trashCands = _fromZones.includes('trash')
            ? (player.trash || []).filter(c => c && cardMatchesFilter(c, _filter)) : [];
          if (_handCands.length === 0 && _trashCands.length === 0) {
            ctx.addLog('💨 条件を満たすカードが手札・トラッシュにありません');
            showEffectFailed(null, () => callback());
            return;
          }
          const _doSummonHT = (c) => {
            if (!c) { callback(); return; }
            const hi = player.hand.indexOf(c); if (hi !== -1) player.hand.splice(hi, 1);
            const ti = player.trash.indexOf(c); if (ti !== -1) player.trash.splice(ti, 1);
            const empty = player.battleArea.indexOf(null);
            if (empty !== -1) player.battleArea[empty] = c; else player.battleArea.push(c);
            c.summonedThisTurn = true; c.suspended = false; c.buffs = []; c.stack = [];
            // skip_on_play 指定時は登場時効果を発動しない
            if (step.skip_on_play) {
              c._skipOnPlayEffect = true;
              ctx.addLog('🌟 「' + c.name + '」を登場（登場時効果は発揮しない）');
            } else {
              ctx.addLog('🌟 「' + c.name + '」を登場');
            }
            ctx.renderAll();
            const showFn = (ctx && ctx.showPlayEffect) || (typeof window !== 'undefined' && window.showPlayEffect);
            const afterAnim = () => {
              if (step.skip_on_play) { callback(); return; }
              try { scanTriggers('on_play', c, ctx.side, ctx); processQueue(ctx, () => callback()); }
              catch (_) { callback(); }
            };
            if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
              try { window._onlineSendCommand({ type: 'play', cardName: c.name, cardImg: c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || '', cardType: c.type, playCost: 0 }); } catch (_) {}
            }
            if (showFn) showFn({ name: c.name, imgSrc: c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || '', type: c.type || 'デジモン', playCost: 0 }, afterAnim);
            else setTimeout(afterAnim, 300);
          };
          // 指定ゾーンのカードから1枚選んで登場（1枚なら即時）
          const _pickFromZone = (zoneCands) => {
            if (!zoneCands || zoneCands.length === 0) { callback(); return; }
            if (zoneCands.length === 1) { _doSummonHT(zoneCands[0]); return; }
            showTrashCardPicker(zoneCands, 1, false, '🌟 登場させるカードを選んでください', (picked) => {
              _doSummonHT(picked && picked.length > 0 ? picked[0] : null);
            }, zoneCands);
          };
          if (effectiveSide === 'ai') {
            _doSummonHT(_handCands[0] || _trashCands[0]);
          } else if (_handCands.length > 0 && _trashCands.length > 0) {
            // 手札・トラッシュ両方に対象がある → どちらから登場するか選択
            showAltActionChoice(['手札から', 'トラッシュから'], (zi) => {
              _pickFromZone(zi === 0 ? _handCands : _trashCands);
            });
          } else {
            _pickFromZone(_handCands.length > 0 ? _handCands : _trashCands);
          }
          return;
        }
      }
      // ... existing summon logic for store-based summon ...
      const srcData = store[step.card];
      if (!srcData || !srcData.card) { callback(); return; }
      const cardToSummon = srcData.card;
      // 進化元から抜く
      if (srcData.parentCard && srcData.parentCard.stack) {
        const stackIdx = srcData.parentCard.stack.indexOf(cardToSummon);
        if (stackIdx !== -1) srcData.parentCard.stack.splice(stackIdx, 1);
      }
      // バトルエリアの空きスロットに登場
      const emptyIdx = player.battleArea.indexOf(null);
      if (emptyIdx !== -1) {
        player.battleArea[emptyIdx] = cardToSummon;
      } else {
        player.battleArea.push(cardToSummon);
      }
      cardToSummon.summonedThisTurn = true;
      cardToSummon.suspended = false;
      cardToSummon.buffs = [];
      cardToSummon.stack = [];
      cardToSummon.dpModifier = 0;
      cardToSummon.baseDp = parseInt(cardToSummon.dp) || 0;
      ctx.addLog('🌟 「' + cardToSummon.name + '」をコスト無しで登場！');
      ctx.renderAll();
      // 登場演出（ローカル＋相手に送信）
      if (ctx.showPlayEffect) {
        const dummyPlay = { name: cardToSummon.name, imgSrc: cardToSummon.imgSrc || getCardImageUrl(cardToSummon) || '', playCost: 0, type: cardToSummon.type || 'デジモン' };
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player') {
          window._onlineSendCommand({ type: 'play', cardName: cardToSummon.name, cardImg: dummyPlay.imgSrc, cardType: cardToSummon.type, playCost: 0 });
        }
        ctx.showPlayEffect(dummyPlay, callback);
      } else { callback(); }
      break;
    }

    // === 消滅（1体ずつ選択→演出） ===
    case 'destroy': {
      const targetData = step.card ? store[step.card] : null;
      if (targetData) {
        const targets = Array.isArray(targetData) ? targetData : [targetData];
        let di = 0;
        function destroyOneByOne() {
          if (di >= targets.length) { callback(); return; }
          const t = targets[di++];
          const c = opponent.battleArea[t.idx];
          if (!c) { destroyOneByOne(); return; }
          // 1体消滅
          opponent.battleArea[t.idx] = null;
          opponent.trash.push(c);
          if (c.stack) c.stack.forEach(s => opponent.trash.push(s));
          ctx.addLog('💥 「' + c.name + '」を消滅させた！');
          // オンライン同期
          if (window._isOnlineMode && window._isOnlineMode()) {
            window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: t.idx, reason: 'destroy' });
            if (window._markDestroyed) window._markDestroyed('ai', t.idx);
          }
          ctx.renderAll();
          // 消滅演出 → 完了後に次の1体
          if (ctx.showDestroyEffect) {
            ctx.showDestroyEffect(c, () => {
              setTimeout(destroyOneByOne, 300); // 少し間を空けて次へ
            });
          } else { destroyOneByOne(); }
        }
        destroyOneByOne();
        return;
      }
      // === target=opponent:all + step.condition: per-target フィルタとして条件を評価し、
      //     一致するカード全てを消滅 ===
      if ((step.target === 'opponent:all' || step.target === 'own:all') && step.condition) {
        const isOwnAll = step.target === 'own:all';
        const tgtPlayer = isOwnAll ? player : opponent;
        const tgtSideTag = isOwnAll ? (ctx.side === 'player' ? 'player' : 'ai') : (ctx.side === 'player' ? 'ai' : 'player');
        const conds = parseRecipeCondition(step.condition);
        const matchedIdxs = [];
        for (let i = 0; i < tgtPlayer.battleArea.length; i++) {
          const c = tgtPlayer.battleArea[i];
          if (!c) continue;
          if (checkConditions(conds, c, ctx.bs, tgtSideTag)) matchedIdxs.push(i);
        }
        if (matchedIdxs.length === 0) {
          ctx.addLog('⚠ 条件に一致するカードがありません');
          callback();
          return;
        }
        let di2 = 0;
        function destroyMatchingNext() {
          if (di2 >= matchedIdxs.length) { callback(); return; }
          const idx = matchedIdxs[di2++];
          const c = tgtPlayer.battleArea[idx];
          if (!c) { destroyMatchingNext(); return; }
          tgtPlayer.battleArea[idx] = null;
          tgtPlayer.trash.push(c);
          if (c.stack) c.stack.forEach(s => tgtPlayer.trash.push(s));
          ctx.addLog('💥 「' + c.name + '」を消滅させた！');
          if (window._isOnlineMode && window._isOnlineMode()) {
            window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: idx, reason: 'destroy' });
            if (window._markDestroyed) window._markDestroyed(isOwnAll ? 'player' : 'ai', idx);
          }
          ctx.renderAll();
          if (ctx.showDestroyEffect) {
            ctx.showDestroyEffect(c, () => setTimeout(destroyMatchingNext, 300));
          } else { destroyMatchingNext(); }
        }
        destroyMatchingNext();
        return;
      }
      // store 未指定 → target 指定の destroy として default ハンドラに委譲（runOneAction経由）
      const _actionObj = { code: 'destroy', value: step.value || null };
      if (step.condition) _actionObj.conditions = parseRecipeCondition(step.condition);
      let _targetObj = null;
      const _t = step.target || '';
      if (_t === 'self') _targetObj = { code: 'target_self' };
      else if (_t === 'own:all') _targetObj = { code: 'target_all_own' };
      else if (_t === 'opponent:all') _targetObj = { code: 'target_all_opponent' };
      else if (_t.startsWith('own:up_to_')) _targetObj = { code: 'target_own', count: parseInt(_t.split('own:up_to_')[1]) || 1, upTo: true };
      else if (_t.startsWith('opponent:up_to_')) _targetObj = { code: 'target_opponent', count: parseInt(_t.split('opponent:up_to_')[1]) || 1, upTo: true };
      else if (_t.startsWith('own:')) _targetObj = { code: 'target_own', count: parseInt(_t.split(':')[1]) || 1 };
      else if (_t.startsWith('opponent:')) _targetObj = { code: 'target_opponent', count: parseInt(_t.split(':')[1]) || 1 };
      else if (_t.startsWith('other_own:')) _targetObj = { code: 'target_other_own', count: parseInt(_t.split(':')[1]) || 1 };
      if (step.condition) {
        if (!ctx.block) ctx.block = {};
        ctx.block.conditions = parseRecipeCondition(step.condition);
      }
      runOneAction(_actionObj, _targetObj, ctx, callback);
      break;
    }

    // === 手札/トラッシュからカード選択 ===
    case 'select_from_hand_trash': {
      const count = step.count || 1;
      const filterName = step.filter_name || null; // カード名フィルタ（部分一致）
      const filterType = step.filter_type || null; // タイプフィルタ

      // 手札とトラッシュから条件に合うカードを収集
      const candidates = [];
      player.hand.forEach((c, i) => {
        if (!c) return;
        if (filterName && !c.name.includes(filterName)) return;
        if (filterType && c.type !== filterType) return;
        candidates.push({ card: c, source: 'hand', idx: i });
      });
      player.trash.forEach((c, i) => {
        if (!c) return;
        if (filterName && !c.name.includes(filterName)) return;
        if (filterType && c.type !== filterType) return;
        candidates.push({ card: c, source: 'trash', idx: i });
      });

      if (candidates.length < count) {
        ctx.addLog('⚠ 条件を満たすカードが足りません');
        showEffectFailed(null, callback);
        return;
      }

      // 選択UI
      const selected = [];
      function selectNextCard() {
        if (selected.length >= count) {
          if (step.store) store[step.store] = selected;
          callback();
          return;
        }
        const remaining = candidates.filter(c => !selected.includes(c));
        showHandTrashSelection(remaining, count - selected.length, filterName, (choice) => {
          if (choice) {
            selected.push(choice);
            selectNextCard();
          } else {
            // キャンセル → 効果不発（コスト）
            if (step.store) store[step.store] = null;
            callback(false);
          }
        });
      }
      selectNextCard();
      break;
    }

    // === 退化（dedigivolve） ===
    // 公式 18-12: ≪退化N≫ = 対象に重ねられているカード(進化元)を上から N 枚破棄
    // step: { action:'dedigivolve', target:'opponent:N'|'opponent:up_to_N', value:N }
    case 'dedigivolve': {
      const dedigN = step.value || 1; // 退化枚数
      const tStr = step.target || 'opponent:1';
      const upToMatch = tStr.match(/^(own|opponent):up_to_(\d+)$/);
      const exactMatch = tStr.match(/^(own|opponent):(\d+)$/);
      const isOwn = tStr.startsWith('own:');
      const wantCount = upToMatch ? parseInt(upToMatch[2]) : (exactMatch ? parseInt(exactMatch[2]) : 1);
      const isUpTo = !!upToMatch;
      const tgtPlayer = isOwn ? player : opponent;
      // executeRecipeStep では opponentRowSide が未定義のため、ここで構築する
      const tgtRowId = isOwn
        ? (ctx.side === 'player' ? 'pl' : 'ai')
        : (ctx.side === 'player' ? 'ai' : 'pl');
      const valid = [];
      for (let i = 0; i < tgtPlayer.battleArea.length; i++) {
        const c = tgtPlayer.battleArea[i];
        if (c && c.stack && c.stack.length > 0) valid.push(i);
      }
      if (valid.length === 0) {
        ctx.addLog && ctx.addLog('⚠ 進化元を持つ対象がいません');
        showEffectFailed('効果を発動できませんでした', callback);
        return;
      }
      const applyDedigi = (idxs) => {
        let i = 0;
        function dediNext() {
          if (i >= idxs.length) { ctx.renderAll(); callback(); return; }
          const idx = idxs[i++];
          const tgt = tgtPlayer.battleArea[idx];
          if (!tgt) { dediNext(); return; }
          // 退化 N: 一番上 (= キャリア) から N 枚破棄。
          // 規約: stack[0] = 直前の進化形 (top), stack[N-1] = デジタマ (bottom)
          // キャリア + stack の先頭 (top 側) (N-1) 枚を破棄し、残ったうち先頭が新キャリア。
          const totalRemovable = 1 + (tgt.stack ? tgt.stack.length : 0);
          const actualN = Math.min(dedigN, totalRemovable);
          const removed = [];
          // 1) キャリア自身を破棄（バフ等の transient 状態は失われる）
          removed.push(tgt);
          // 2) stack 先頭 (top 側) から N-1 枚破棄
          for (let k = 1; k < actualN; k++) {
            if (tgt.stack && tgt.stack.length > 0) removed.push(tgt.stack.shift());
          }
          // 3) 残った stack の先頭を新キャリアとして昇格
          let newCarrier = null;
          if (tgt.stack && tgt.stack.length > 0) {
            newCarrier = tgt.stack.shift();
            newCarrier.stack = (tgt.stack || []).slice();
            // 新キャリアの transient 状態を初期化（rest 状態は元キャリアから引き継ぎ）
            newCarrier.suspended = !!tgt.suspended;
            newCarrier.buffs = [];
            newCarrier._permEffects = {};
            newCarrier.summonedThisTurn = false;
            newCarrier._usedEffects = [];
            newCarrier.baseDp = parseInt(newCarrier.dp) || 0;
            newCarrier.dp = newCarrier.baseDp;
            newCarrier.dpModifier = 0;
          }
          tgtPlayer.battleArea[idx] = newCarrier;
          removed.forEach(r => tgtPlayer.trash.push(r));
          ctx.addLog && ctx.addLog('🔻 「' + tgt.name + '」を退化' + actualN + ' (上から' + actualN + '枚破棄' + (newCarrier ? ' / 新形態: ' + newCarrier.name : ' / 完全消滅') + ')');
          ctx.renderAll();
          // 永続効果を再評価（新キャリアの passive を適用）
          try { applyPermanentEffects(ctx.bs, isOwn ? ctx.side : (ctx.side === 'player' ? 'ai' : 'player'), ctx); } catch(_) {}
          // オンライン同期: 退化を相手画面にも通知 + 古い state_sync で
          // ローカルの新キャリアが上書きされないよう即座に markEvoModified + 即送信
          if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
            try {
              if (ctx.side === 'player') {
                window._onlineSendCommand({
                  type: 'fx_dedigivolve',
                  targetIdx: idx,
                  onSide: isOwn ? 'opp' : 'self', // 受信側視点: 'self'=自分側 / 'opp'=相手側
                  removeCount: actualN,
                });
                // 受信側の bs.player 上書き防止用 + 自側 (送信側) の bs.ai 上書き防止用
                // (markEvoModified は両方向で機能する flag)
                if (window._markEvoModified) window._markEvoModified(isOwn ? 'player' : 'ai', idx);
                if (window._onlineSendStateSync) window._onlineSendStateSync();
              }
            } catch (_) {}
          }
          // 自分側でカード移動演出
          let r = 0;
          function showRemovedAnim() {
            if (r >= removed.length) { dediNext(); return; }
            const card = removed[r++];
            if (window._fxCardMove) {
              window._fxCardMove(card, tgt.name + (card === tgt ? '' : 'の進化元'), 'トラッシュ', showRemovedAnim);
            } else { setTimeout(showRemovedAnim, 300); }
          }
          showRemovedAnim();
        }
        dediNext();
      };
      if (effectiveSide === 'ai') {
        // AI: 先頭から wantCount 件を自動選択
        applyDedigi(valid.slice(0, wantCount));
        break;
      }
      if (isUpTo) {
        pickUpToNTargets(tgtRowId, valid, wantCount, '#aa66ff', applyDedigi);
      } else if (wantCount === 1) {
        showTargetSelection(tgtRowId, valid, null, '#aa66ff', (selectedIdx) => {
          if (selectedIdx == null) { callback(); return; }
          applyDedigi([selectedIdx]);
        });
      } else {
        // exact N 体: ギガデストロイヤー方式は使わず、N 体まで連続選択
        const picked = [];
        (function pickEx() {
          if (picked.length >= wantCount) { applyDedigi(picked); return; }
          const remaining = valid.filter(i => !picked.includes(i));
          if (remaining.length === 0) { applyDedigi(picked); return; }
          showTargetSelection(tgtRowId, remaining, null, '#aa66ff', (selectedIdx) => {
            if (selectedIdx == null) { applyDedigi(picked); return; }
            picked.push(selectedIdx);
            pickEx();
          });
        })();
      }
      break;
    }

    // === トラッシュから手札に戻す ===
    // step: { action:'trash_to_hand', filter:{...}, count:N, optional:bool }
    case 'trash_to_hand': {
      const filter = step.filter || {};
      const wantCount = step.count || 1;
      const optional = !!step.optional;
      const candidates = (player.trash || []).filter(c => cardMatchesFilter(c, filter));
      if (candidates.length === 0) {
        ctx.addLog && ctx.addLog('💨 条件を満たすカードがトラッシュにありません');
        showEffectFailed(null, () => callback());
        return;
      }
      const onPicked = (chosen) => {
        if (!chosen || chosen.length === 0) {
          if (optional) { ctx.addLog && ctx.addLog('☓ 「使わない」を選択'); callback(); }
          else { showEffectFailed(null, () => callback()); }
          return;
        }
        let i = 0;
        function moveNext() {
          if (i >= chosen.length) { ctx.renderAll(); callback(); return; }
          const c = chosen[i++];
          const ti = player.trash.indexOf(c);
          if (ti !== -1) player.trash.splice(ti, 1);
          player.hand.push(c);
          ctx.addLog && ctx.addLog('🃏 「' + c.name + '」をトラッシュから手札に戻した');
          // オンライン: 相手画面にも同じカード移動演出を送信
          if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
            try {
              window._onlineSendCommand({
                type: 'fx_remoteCardMove',
                cardName: c.name, cardNo: c.cardNo,
                cardImg: c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || '',
                fromLabel: 'トラッシュ', toLabel: '手札',
              });
            } catch(_) {}
          }
          if (window._fxCardMove) window._fxCardMove(c, 'トラッシュ', '手札', moveNext);
          else setTimeout(moveNext, 300);
        }
        moveNext();
      };
      if (effectiveSide === 'ai') {
        // AI: 先頭から N 枚を自動選択
        onPicked(candidates.slice(0, wantCount));
      } else {
        showTrashCardPicker(candidates, wantCount, optional, '🃏 手札に戻すカードを選んでください', onPicked, player.trash);
      }
      break;
    }

    // === トラッシュから登場させる ===
    // step: { action:'summon_from_trash', filter:{...}, count:N, cost_free:true, skip_on_play:true }
    case 'summon_from_trash': {
      const filter = step.filter || {};
      const wantCount = step.count || 1;
      const optional = !!step.optional;
      console.log('[summon_from_trash] ctx.side=' + ctx.side + ' effectiveSide=' + effectiveSide + ' player.trash.length=' + (player.trash ? player.trash.length : 'null') + ' filter=' + JSON.stringify(filter));
      console.log('[summon_from_trash] trash contents:', (player.trash || []).map(c => (c && c.name ? c.name : '?') + '(' + (c && c.color || '?') + '/Lv' + (c && c.level || '?') + '/' + (c && c.type || '?') + ')').join(', '));
      const candidates = (player.trash || []).filter(c => cardMatchesFilter(c, filter));
      console.log('[summon_from_trash] candidates.length=' + candidates.length);
      if (candidates.length === 0) {
        ctx.addLog && ctx.addLog('💨 条件を満たすカードがトラッシュにありません');
        showEffectFailed(null, () => callback());
        return;
      }
      const onPicked = (chosen) => {
        if (!chosen || chosen.length === 0) {
          if (optional) { ctx.addLog && ctx.addLog('☓ 「登場させない」を選択'); callback(); }
          else { showEffectFailed(null, () => callback()); }
          return;
        }
        let i = 0;
        function summonNext() {
          if (i >= chosen.length) { ctx.renderAll(); callback(); return; }
          const c = chosen[i++];
          const ti = player.trash.indexOf(c);
          if (ti !== -1) player.trash.splice(ti, 1);
          // type別に配置先を決定
          const isTamer = String(c.type || '') === 'テイマー';
          if (isTamer) {
            player.tamerArea.push(c);
          } else {
            const empty = player.battleArea.indexOf(null);
            if (empty !== -1) player.battleArea[empty] = c;
            else player.battleArea.push(c);
          }
          c.summonedThisTurn = true;
          c.suspended = false;
          c.buffs = [];
          // skip_on_play 指定時は登場時効果を発動しない
          if (step.skip_on_play) {
            c._skipOnPlayEffect = true;
            ctx.addLog && ctx.addLog('🌟 「' + c.name + '」を登場（登場時効果は発揮しない）');
          } else {
            ctx.addLog && ctx.addLog('🌟 「' + c.name + '」を登場');
          }
          ctx.renderAll && ctx.renderAll();
          // 登場演出（通常のsummonと同じUX）
          const playSummon = (afterAnim) => {
            const showFn = (ctx && ctx.showPlayEffect) || (typeof window !== 'undefined' && window.showPlayEffect);
            if (showFn) {
              const dummy = {
                name: c.name,
                imgSrc: c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || c.imageUrl || '',
                type: c.type || 'デジモン',
                playCost: 0
              };
              if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
                window._onlineSendCommand({ type: 'play', cardName: c.name, cardImg: dummy.imgSrc, cardType: c.type, playCost: 0 });
              }
              showFn(dummy, afterAnim);
            } else {
              setTimeout(afterAnim, 300);
            }
          };
          // 登場演出 → skip_on_play 指定が無ければ登場時効果を発火
          playSummon(() => {
            if (step.skip_on_play) {
              summonNext();
              return;
            }
            // 登場時効果（on_play）を発火: scanTriggers でキューに積む → 直後に再帰的に処理
            try {
              scanTriggers('on_play', c, ctx.side, ctx);
              // キューに積まれた on_play エントリを処理してから summonNext
              processQueue(ctx, () => summonNext());
            } catch(_) {
              summonNext();
            }
          });
        }
        summonNext();
      };
      if (effectiveSide === 'ai') {
        onPicked(candidates.slice(0, wantCount));
      } else {
        showTrashCardPicker(candidates, wantCount, optional, '🌟 登場させるカードを選んでください', onPicked, player.trash);
      }
      break;
    }

    // === 進化元から登場させる ===
    // 例: メタルガルルモン「進化元のLv.4以下のデジモンカード1枚を、コストを支払わずに別のデジモンとして登場」
    // step は通常 target='self' / value=登場枚数 / options:['ignore_cost'] 等を持つ
    // 候補は cond_has_evo_digimon メタ条件が card._evoSourceCandidates にセット済（無ければ自身の stack デジモンカード全件）
    case 'summon_from_evo_source': {
      const self = ctx.card;
      if (!self || !Array.isArray(self.stack) || self.stack.length === 0) {
        ctx.addLog && ctx.addLog('⚠ 進化元がありません');
        showEffectFailed(null, () => callback());
        return;
      }
      // 候補: cond_has_evo_digimon が事前に絞ったものがあれば優先、無ければ stack の type='デジモン' 全件
      let candidates = Array.isArray(self._evoSourceCandidates) && self._evoSourceCandidates.length > 0
        ? self._evoSourceCandidates.slice()
        : self.stack.filter(s => s && s.type === 'デジモン');
      // step.when（cond_lv_le:4 等）を進化元候補に対する個別フィルタとして適用
      if (step.when) {
        const _whenConds = parseRecipeCondition(step.when);
        if (_whenConds.length > 0) candidates = candidates.filter(s => checkConditions(_whenConds, s, ctx.bs, ctx.side));
      }
      if (candidates.length === 0) {
        ctx.addLog && ctx.addLog('⚠ 条件を満たす進化元がありません');
        showEffectFailed(null, () => callback());
        return;
      }
      const wantCount = step.value || step.count || 1;
      const ignoreCost = Array.isArray(step.options) && step.options.includes('ignore_cost');

      const performSummon = (chosen) => {
        if (!chosen || chosen.length === 0) { callback(); return; }
        let i = 0;
        function summonNext() {
          if (i >= chosen.length) {
            // 一回限りキャッシュをクリア
            if (self._evoSourceCandidates) self._evoSourceCandidates = null;
            ctx.renderAll && ctx.renderAll();
            callback();
            return;
          }
          const c = chosen[i++];
          // self.stack から除去
          const si = self.stack.indexOf(c);
          if (si >= 0) self.stack.splice(si, 1);
          // battleArea 空きスロットへ配置（テイマーは tamerArea へ。ただし通常はデジモンのみ）
          const isTamer = String(c.type || '') === 'テイマー';
          if (isTamer) {
            player.tamerArea.push(c);
          } else {
            const empty = player.battleArea.indexOf(null);
            if (empty !== -1) player.battleArea[empty] = c;
            else player.battleArea.push(c);
          }
          c.summonedThisTurn = true;
          c.suspended = false;
          c.buffs = [];
          c.stack = []; // 進化元はリセット（別カードとして登場）
          ctx.addLog && ctx.addLog('🌟 「' + c.name + '」を進化元から登場' + (ignoreCost ? '（コスト無視）' : ''));
          ctx.renderAll && ctx.renderAll();
          // 登場演出 → on_play 効果発火
          const showFn = (ctx && ctx.showPlayEffect) || (typeof window !== 'undefined' && window.showPlayEffect);
          const playSummon = (afterAnim) => {
            if (showFn) {
              const dummy = {
                name: c.name,
                imgSrc: c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || c.imageUrl || '',
                type: c.type || 'デジモン',
                playCost: 0
              };
              if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
                window._onlineSendCommand({ type: 'play', cardName: c.name, cardImg: dummy.imgSrc, cardType: c.type, playCost: 0 });
              }
              showFn(dummy, afterAnim);
            } else {
              setTimeout(afterAnim, 300);
            }
          };
          playSummon(() => {
            try {
              scanTriggers('on_play', c, ctx.side, ctx);
              processQueue(ctx, () => summonNext());
            } catch(_) { summonNext(); }
          });
        }
        summonNext();
      };

      // 候補が wantCount 以下なら自動。それ以上ならプレイヤーが選択
      if (candidates.length <= wantCount || effectiveSide === 'ai') {
        performSummon(candidates.slice(0, wantCount));
      } else {
        // 進化元は通常そう枚数多くないので、トラッシュピッカーを流用（候補配列 + 選択数）
        showTrashCardPicker(candidates, wantCount, false, '🌟 進化元から登場させるカードを選んでください', performSummon, candidates);
      }
      break;
    }

    // === 進化元に追加 ===
    case 'add_to_evo_source': {
      const cards = store[step.card];
      if (!cards || !Array.isArray(cards) || cards.length === 0) { callback(); return; }
      const targetCard = (step.target === 'self') ? ctx.card : ctx.card;
      cards.forEach(entry => {
        // 元の場所（手札/トラッシュ）から除去
        if (entry.source === 'hand') {
          const hi = player.hand.indexOf(entry.card);
          if (hi !== -1) player.hand.splice(hi, 1);
        } else if (entry.source === 'trash') {
          const ti = player.trash.indexOf(entry.card);
          if (ti !== -1) player.trash.splice(ti, 1);
        }
        // 進化元に追加
        if (!targetCard.stack) targetCard.stack = [];
        targetCard.stack.push(entry.card);
        ctx.addLog('📥 「' + entry.card.name + '」を進化元に追加');
      });
      ctx.renderAll();
      callback();
      break;
    }

    // === デッキオープン (新仕様) ===
    // step: { value, selections, return_to, optional }
    case 'deck_open': {
      const openN = step.value || 1;
      const opened = [];
      for (let i = 0; i < openN && player.deck.length > 0; i++) {
        opened.push(player.deck.splice(0, 1)[0]);
      }
      if (opened.length === 0) {
        ctx.addLog && ctx.addLog('⚠ デッキにカードがありません');
        callback && callback();
        break;
      }
      ctx.addLog && ctx.addLog('📖 デッキの上から' + opened.length + '枚オープン');
      ctx.renderAll && ctx.renderAll();
      // 新 UI を呼ぶ
      const handBeforeDO = player.hand.slice();
      showDeckOpenUI(opened, step, ctx, () => {
        // 直前選択カードを保存（post_actions の cond_picked_* で参照可能に）
        const newPicked = player.hand.filter(c => !handBeforeDO.includes(c));
        if (newPicked.length > 0) ctx.bs._lastPickedCard = newPicked[newPicked.length - 1];
        ctx.renderAll && ctx.renderAll();
        runPostActions(step.post_actions, ctx, () => callback && callback());
      });
      break;
    }

    // === メモリーをNにする ===
    case 'memory': {
      const target = parseInt(String(step.value ?? 0), 10) || 0;
      // ctx.side='player' のとき: 自分側 +N、相手側 -N の体系
      //   bs.memory > 0 = プレイヤー側、bs.memory < 0 = AI 側 (左右反転)
      const want = (ctx.side === 'player') ? target : -target;
      bs.memory = want;
      ctx.addLog && ctx.addLog('💎 メモリーを ' + target + ' にする');
      if (ctx.updateMemGauge) ctx.updateMemGauge();
      if (window._sendMemoryUpdate) window._sendMemoryUpdate();
      callback();
      break;
    }
    // === デジタマカードを孵化する ===
    // 育成エリアに最上位のデジタマカードを移動（既存の breed フロー流用）
    case 'hatch': {
      // 既存の breed move とほぼ同じ。育成エリアにすでにカードがあれば skip
      if (player.ikusei) { ctx.addLog && ctx.addLog('⚠ 育成エリアに既にカードがあります'); callback(); break; }
      // デジタマデッキ（player.tamaDeck）の上から1枚を育成エリアへ
      if (!player.tamaDeck || player.tamaDeck.length === 0) {
        ctx.addLog && ctx.addLog('⚠ デジタマデッキが空です'); callback(); break;
      }
      const egg = player.tamaDeck.shift();
      player.ikusei = egg;
      ctx.addLog && ctx.addLog('🥚 「' + egg.name + '」を孵化');
      ctx.renderAll && ctx.renderAll();
      // オンライン: 育成エリアの変化を相手画面へ同期
      if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
        try { window._onlineSendStateSync(); } catch (_) {}
      }
      callback();
      break;
    }
    // === 育成エリアからバトルエリアに移動 (breed → battle, 進化なし) ===
    case 'battle_area_make': {
      if (!player.ikusei) { ctx.addLog && ctx.addLog('⚠ 育成エリアにカードがありません'); callback(); break; }
      // 空きスロットを探す
      let slot = -1;
      for (let i = 0; i < player.battleArea.length; i++) {
        if (!player.battleArea[i]) { slot = i; break; }
      }
      if (slot < 0) slot = player.battleArea.length;
      player.battleArea[slot] = player.ikusei;
      ctx.addLog && ctx.addLog('🐾 「' + player.ikusei.name + '」をバトルエリアへ');
      player.ikusei = null;
      ctx.renderAll && ctx.renderAll();
      // オンライン: 育成エリア／バトルエリアの変化を相手画面へ同期
      if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
        try { window._onlineSendStateSync(); } catch (_) {}
      }
      callback();
      break;
    }
    // === トークンを生成して登場（コスト不要） ===
    // step.tokenNo でカードDBのトークン行（タイプ=トークン）を指定。
    // ディアボロモン(BT2-082) のアタック時効果等。場ではデジモンとして扱い、
    // _isToken=true（場を離れると消滅＝トラッシュ等に残らない）。
    case 'summon_token': {
      // tokenNo / token / value のいずれかでトークンのカードNoを指定
      // （レシピエディタは「値」欄に入れるため step.value も受ける）
      const _tokNo = step.tokenNo || step.token || step.value || '';
      const _tokObj = (typeof window !== 'undefined' && Array.isArray(window.allCards))
        ? window.allCards.find(c => c && c['カードNo'] === _tokNo) : null;
      if (!_tokObj) {
        ctx.addLog && ctx.addLog('⚠ トークン「' + _tokNo + '」がカードDBに見つかりません');
        callback();
        break;
      }
      const _tokRecipe = _tokObj['レシピ'] || _tokObj['効果レシピ'] || null;
      const token = {
        name: _tokObj['名前'] || 'トークン',
        cardNo: _tokObj['カードNo'],
        type: 'デジモン',                              // 場ではデジモンとして扱う
        level: String(_tokObj['レベル'] ?? _tokObj['Lv'] ?? '?').trim(),
        color: _tokObj['色'] || '',
        feature: _tokObj['特徴'] || '',
        dp: parseInt(_tokObj['DP']) || 0,
        baseDp: parseInt(_tokObj['DP']) || 0,
        dpModifier: 0,
        playCost: null, evolveCost: null, cost: 0,
        evolveCond: _tokObj['進化条件'] || '',
        effect: _tokObj['効果テキスト'] || _tokObj['効果'] || '',
        evoSourceEffect: '', securityEffect: '',
        recipe: (_tokRecipe && _tokRecipe !== '""') ? _tokRecipe : null,
        imageUrl: _tokObj['ImageURL'] || '',
        imgSrc: getCardImageUrl(_tokObj) || '',
        stack: [], suspended: false, buffs: [],
        cantBeActive: false, cantAttack: false, cantBlock: false,
        summonedThisTurn: true, _pendingDestroy: false,
        _isToken: true,
      };
      // 空きスロットへ登場
      let _tokSlot = -1;
      for (let i = 0; i < player.battleArea.length; i++) {
        if (!player.battleArea[i]) { _tokSlot = i; break; }
      }
      if (_tokSlot < 0) _tokSlot = player.battleArea.length;
      player.battleArea[_tokSlot] = token;
      ctx.addLog && ctx.addLog('🌀 トークン「' + token.name + '」を登場（コスト無し）');
      ctx.renderAll && ctx.renderAll();
      // オンライン: バトルエリアの変化（トークン登場）を相手画面へ同期
      if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
        try { window._onlineSendStateSync(); } catch (_) {}
      }
      callback();
      break;
    }
    // === レストチェイン: 相手1体をレスト → そのDPが閾値以下なら任意でもう1体（閾値以下）===
    // ギガブラスター「相手1体か、DP5000以下の相手2体をレストさせる」用。
    // step.dp_threshold（既定5000）。1体目が閾値超なら終了、閾値以下なら2体目を任意選択。
    case 'rest_chain': {
      const rcTh = step.dp_threshold || 5000;
      const rcArea = opponent.battleArea;
      const rcRow = ctx.side === 'player' ? 'ai' : 'pl';
      const rcActive = () => { const a = []; for (let i = 0; i < rcArea.length; i++) { const c = rcArea[i]; if (c && !c.suspended) a.push(i); } return a; };
      const rcDoRest = (idx) => {
        const c = rcArea[idx];
        if (!c) return;
        c.suspended = true;
        ctx.addLog && ctx.addLog('💤 「' + c.name + '」をレスト');
        if (ctx.side === 'player' && window._isOnlineMode && window._isOnlineMode()) {
          if (window._markSuspendChanged) window._markSuspendChanged('ai', idx, true);
          if (window._onlineSendCommand) window._onlineSendCommand({ type: 'fx_remoteSuspend', targetIdx: idx, suspended: true, targetName: c.name });
        }
      };
      const rcFinish = () => {
        ctx.renderAll && ctx.renderAll();
        const restedSide = ctx.side === 'player' ? 'ai' : 'player';
        try { fireWhenOppRestTriggers(restedSide, ctx.bs, ctx, () => callback()); return; } catch (_) {}
        callback();
      };
      const rcV1 = rcActive();
      if (rcV1.length === 0) { ctx.addLog && ctx.addLog('⚠ レスト対象がいません'); callback(); break; }
      if (ctx.side === 'ai' || ctx._forceTargetIdx !== undefined) {
        const i1 = (ctx._forceTargetIdx !== undefined && rcV1.indexOf(ctx._forceTargetIdx) >= 0) ? ctx._forceTargetIdx : rcV1[0];
        rcDoRest(i1);
        rcFinish();
        break;
      }
      ctx.addLog && ctx.addLog('🎯 レストさせる対象を選んでください（1体目）');
      showTargetSelection(rcRow, rcV1, null, '#ff4444', (idx1) => {
        if (idx1 === null) { callback(); return; }
        const first = rcArea[idx1];
        const firstDp = first ? (parseInt(first.dp) || 0) : 0;
        rcDoRest(idx1);
        ctx.renderAll && ctx.renderAll();
        // 1体目が閾値超 → そこで終了（1体のみ）
        if (firstDp > rcTh) { rcFinish(); return; }
        // 1体目が閾値以下 → DP閾値以下をもう1体「強制」でレストする
        // （他に閾値以下のアクティブ相手デジモンがいない場合のみ1体で終了）
        const rcV2 = rcActive().filter(i => (parseInt(rcArea[i].dp) || 0) <= rcTh);
        if (rcV2.length === 0) {
          ctx.addLog && ctx.addLog('⚠ 他にDP' + rcTh + '以下の相手デジモンがいないため1体のみ');
          rcFinish();
          return;
        }
        ctx.addLog && ctx.addLog('🎯 レストさせる対象を選んでください（2体目・DP' + rcTh + '以下／必須）');
        showTargetSelection(rcRow, rcV2, null, '#ff4444', (idx2) => {
          if (idx2 !== null) rcDoRest(idx2);
          rcFinish();
        });
      });
      break;
    }
    // === セキュリティを破棄（汎用 alias: security_trash_top と同等） ===
    case 'security_discard': {
      // per_count/ref倍率を適用（例: デュークモン「相手のトラッシュ10枚ごとに」）
      let n = step.value != null ? step.value : 1;
      if (step.per_count) {
        const refSource = step.ref || 'opp_trash';
        const count = getRefSourceCountDirect(refSource, ctx.card, ctx.bs, ctx.side, step.ref_filter, step.ref_state);
        n = n * Math.floor(count / step.per_count);
      }
      const discarded = [];
      for (let i = 0; i < n; i++) {
        if (opponent.security.length > 0) discarded.push(opponent.security.shift());
      }
      if (discarded.length === 0) { ctx.renderAll && ctx.renderAll(); callback(); break; }
      discarded.forEach(c => opponent.trash.push(c));
      ctx.addLog && ctx.addLog('🛡 セキュリティ破棄 ×' + discarded.length);
      ctx.renderAll && ctx.renderAll();
      // カード移動演出（1枚ずつ順番に）
      let idx = 0;
      function showNextSecDiscard() {
        if (idx >= discarded.length) { callback(); return; }
        const card = discarded[idx++];
        if (window._fxCardMove) {
          window._fxCardMove(card, 'セキュリティ', 'トラッシュ', showNextSecDiscard);
        } else {
          setTimeout(showNextSecDiscard, 300);
        }
      }
      showNextSecDiscard();
      break;
    }
    // === セキュリティに置く（デッキ上から N 枚 or 指定カードをセキュリティへ） ===
    case 'place_security': {
      const n = step.value || 1;
      for (let i = 0; i < n; i++) {
        if (player.deck.length > 0) {
          player.security.push(player.deck.shift());
          ctx.addLog && ctx.addLog('🛡 セキュリティ+1');
        }
      }
      ctx.renderAll && ctx.renderAll();
      callback();
      break;
    }
    // === 「次の相手のアクティブフェイズではアクティブにならない」用 buff 付与 ===
    case 'not_active':
    case 'prevent_unsuspend': {
      const tStr = String(step.target || 'opponent:all');
      const _naIsOpp = tStr.startsWith('opp');
      const all = tStr.endsWith(':all') || tStr === 'opponent' || tStr === 'own';
      if (all) {
        // 「次のアクティブフェイズでアクティブにならない（全て）」は継続効果。
        // 効果適用後に登場/レストしたデジモンも対象にするため、対象 side の
        // 次のアクティブフェイズを丸ごとスキップするフラグを立てる
        // （個別 buff のスナップショットでは新規レスト分が漏れるため）。
        const targetSide = _naIsOpp
          ? (ctx.side === 'player' ? 'ai' : 'player')
          : ctx.side;
        if (!ctx.bs._skipUnsuspend) ctx.bs._skipUnsuspend = {};
        ctx.bs._skipUnsuspend[targetSide] = true;
        ctx.addLog && ctx.addLog('🔒 ' + (_naIsOpp ? '相手' : '自分') + 'のデジモンは次のアクティブフェイズでアクティブにならない');
        // オンライン: 相手機にも同期（受信側で side を反転）
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
          try { window._onlineSendCommand({ type: 'fx_preventUnsuspendAll', side: targetSide }); } catch (_) {}
        }
      }
      ctx.renderAll && ctx.renderAll();
      callback();
      break;
    }
    // === 一時的にトリガー効果を付与（granted_recipe を対象に attach） ===
    case 'grant_effect': {
      const dur = normalizeRecipeDuration(step.duration) || 'dur_this_turn';
      const granted = step.granted_recipe;
      if (!granted) { ctx.addLog && ctx.addLog('⚠ granted_recipe が未設定'); callback(); break; }
      const tStr = String(step.target || 'own:all');
      const tgtPlayer = tStr.startsWith('opp') ? opponent : player;
      const applyTo = (c) => {
        if (!c) return;
        if (!c._grantedRecipes) c._grantedRecipes = [];
        // 付与効果の説明文: 付与元カードの効果テキストの「」内（＝付与される効果本体）
        // のみを使う。無ければ全文。
        const _gFullText = ctx.card ? (ctx.card.effect || '') : '';
        const _gQuoted = /「([^」]+)」/.exec(_gFullText);
        c._grantedRecipes.push({
          recipe: granted, duration: dur, side: ctx.side,
          granterName: ctx.card ? ctx.card.name : '',
          granterText: _gQuoted ? _gQuoted[1] : _gFullText,
        });
        ctx.addLog && ctx.addLog('🎁 「' + c.name + '」に効果を付与');
      };
      if (tStr.endsWith(':all') || tStr === 'own' || tStr === 'opponent') {
        (tgtPlayer.battleArea || []).forEach(applyTo);
      } else if (tStr === 'self') {
        applyTo(ctx.card);
      } else {
        // own:1 等 → 既存の対象選択 UI に乗せる（簡易: applyDpBuff の target_own と同等）
        const validTargets = [];
        for (let i = 0; i < tgtPlayer.battleArea.length; i++) {
          if (tgtPlayer.battleArea[i]) validTargets.push(i);
        }
        if (validTargets.length === 0) { showEffectFailed(null, callback); return; }
        if (effectiveSide === 'ai' || ctx._forceTargetIdx !== undefined) {
          const fixedIdx = (ctx._forceTargetIdx !== undefined) ? ctx._forceTargetIdx : validTargets[0];
          applyTo(tgtPlayer.battleArea[fixedIdx]);
          ctx.renderAll && ctx.renderAll(); callback();
          return;
        }
        showTargetSelection(ctx.side === 'player' ? 'pl' : 'ai', validTargets, null, '#c084fc', (idx) => {
          if (idx !== null) applyTo(tgtPlayer.battleArea[idx]);
          ctx.renderAll && ctx.renderAll(); callback();
        });
        return;
      }
      ctx.renderAll && ctx.renderAll();
      callback();
      break;
    }
    // === セキュリティを全公開＋ルール選択＋自動シャッフル ===
    // step.value === 'all' で全公開、それ以外は数値で N 枚
    // selections[] でルールから決まった選択先（手札等）を反映
    // post_actions[] で「選んだカードが黄ならリカバリー」等の文脈条件付き追加処理を実行
    // 完了後はセキュリティ自動シャッフル（中身を見たため）
    // === セキュリティを非公開で確認 → 選んだカードのみ公開して手札へ ===
    // 高石タケル(BT1-087) 等。自分のセキュリティを全て（または N 枚）確認するが
    // 中身は相手に見せない（private）。選択したカードのみ相手に公開して手札に加える。
    // post_actions（黄ならリカバリー等）を処理してから、セキュリティを全てシャッフル。
    case 'security_open': {
      let openN;
      if (step.value === 'all' || step.value === undefined || step.value === null || step.value === '') {
        openN = player.security.length;
      } else {
        openN = parseInt(step.value, 10) || 1;
      }
      if (player.security.length === 0) {
        ctx.addLog && ctx.addLog('⚠ セキュリティが空です');
        callback && callback();
        break;
      }
      // セキュリティから N 枚（または全て）を opened へ
      const opened = [];
      for (let i = 0; i < openN && player.security.length > 0; i++) {
        opened.push(player.security.shift());
      }
      ctx.addLog && ctx.addLog('🛡 セキュリティ' + opened.length + '枚を確認（相手には非公開）');
      const _soOnline = ctx.side === 'player' && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand;
      const _soSerialize = (c) => ({
        name: c.name, cardNo: c.cardNo, type: c.type, color: c.color,
        level: c.level, dp: c.dp, baseDp: c.baseDp,
        playCost: c.playCost, evolveCost: c.evolveCost, cost: c.cost,
        effect: c.effect, evoSourceEffect: c.evoSourceEffect,
        securityEffect: c.securityEffect, recipe: c.recipe,
        evolveCond: c.evolveCond, imgSrc: c.imgSrc, imageUrl: c.imageUrl, feature: c.feature,
      });
      // 相手画面の「確認中」表示は効果発動ポップアップ（fxRemoteEffect）が兼ねる。
      // showDeckOpenUI を流用（private: true で中身を相手に送らない）。
      // 一時的に player.deck を空に退避し、戻ったカードを完了後にセキュリティへ戻す。
      const savedDeckSO = player.deck;
      player.deck = [];
      ctx.renderAll && ctx.renderAll();
      const handBeforeSO = player.hand.slice();
      const customStep = Object.assign({}, step, {
        return_to: step.return_to || 'deck_bottom',
        private: true,
        // カード選択完了の瞬間（戻しフェーズ前）に相手の効果発動ポップアップを閉じる
        _onSelectionDone: () => {
          if (_soOnline) { try { window._onlineSendCommand({ type: 'fx_effectClose' }); } catch (_) {} }
        },
      });
      showDeckOpenUI(opened, customStep, ctx, () => {
        // 選択完了 → 相手の効果発動ポップアップ（fxRemoteEffect）を閉じる。
        // 以降の公開カード／リカバリー／シャッフル演出が相手画面で見えるようにするため。
        if (_soOnline) {
          try { window._onlineSendCommand({ type: 'fx_effectClose' }); } catch (_) {}
        }
        // 戻ったカード（player.deck 上のもの）をセキュリティへ戻す（まだシャッフルしない）
        const remaining = player.deck.slice();
        player.deck = savedDeckSO;
        player.security = player.security.concat(remaining);
        // 選択して手札に加わったカード（cond_picked_color 等で参照）
        const newPickedSO = player.hand.filter(c => !handBeforeSO.includes(c));
        if (newPickedSO.length > 0) ctx.bs._lastPickedCard = newPickedSO[newPickedSO.length - 1];
        ctx.renderAll && ctx.renderAll();
        // オンライン: 選んだカードのみ相手に公開（残りは非公開のまま）
        if (_soOnline) {
          try {
            newPickedSO.forEach(pc => {
              window._onlineSendCommand({ type: 'fx_securityReveal', cardName: pc.name, cardNo: pc.cardNo || '', cardImg: pc.imgSrc || pc.imageUrl || '' });
            });
          } catch (_) {}
        }
        // リカバリー等（黄ならデッキ→セキュリティ）を先に処理 → その後シャッフル
        // _securityOpenActive: 内部 recover が個別 fx_recover を送らないようにする
        // （完了後に security_init でセキュリティ全体を再同期するため）
        ctx._securityOpenActive = true;
        runPostActions(step.post_actions, ctx, () => {
          ctx._securityOpenActive = false;
          // セキュリティを全てシャッフル（Fisher–Yates）
          const sec = player.security;
          for (let i = sec.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = sec[i]; sec[i] = sec[j]; sec[j] = tmp;
          }
          ctx.addLog && ctx.addLog('🔀 セキュリティをシャッフル');
          ctx.renderAll && ctx.renderAll();
          // オンライン: セキュリティ（実カード・新順序）を相手へ再同期
          // ＋ 相手画面にもシャッフル演出を送る
          if (_soOnline) {
            try {
              window._onlineSendCommand({ type: 'security_init', cards: player.security.map(_soSerialize) });
              window._onlineSendCommand({ type: 'fx_shuffle', label: 'セキュリティをシャッフル' });
            } catch (_) {}
          }
          // シャッフル演出（ローカル）→ 完了後に callback
          const _fxShuf = (typeof window !== 'undefined' && window._fxShuffle);
          if (_fxShuf) { try { _fxShuf('セキュリティをシャッフル', () => callback && callback()); return; } catch (_) {} }
          callback && callback();
        });
      });
      break;
    }

    // === デジバースト (進化元 N 枚をコスト消費) ===
    // 後続のステップを実行する前のコスト処理。N枚払えなければ後続を実行しない（success=false）
    case 'cost_digiburst': {
      const need = step.value || 1;
      const carrier = ctx.card;
      if (!carrier || !carrier.stack || carrier.stack.length < need) {
        ctx.addLog && ctx.addLog('⚠ デジバースト' + need + ': 進化元が足りません');
        // 視覚フィードバック: 「条件を満たさないため発動できません」
        showEffectFailed('進化元が' + need + '枚必要です（条件を満たさないため発動できません）', () => {
          callback && callback(false); // 失敗 → 後続スキップ
        });
        return;
      }
      // プレイヤーが N 枚タップ選択して破棄
      ctx.addLog('🔥 デジバースト' + need + ': 進化元から ' + need + ' 枚選んで破棄');
      const onSelectComplete = (selectedCards) => {
        if (!selectedCards || selectedCards.length < need) {
          ctx.addLog && ctx.addLog('⚠ デジバースト中断（選択キャンセル）');
          callback && callback(false);
          return;
        }
        // 進化元破棄を1枚ずつ「カード移動演出」付きで進める。
        // 自分側でも演出を見せ、オンライン時は相手画面にも fx_evoDiscard を送って
        // 同じカード移動演出を再生させる。
        const carrierIdx = (ctx.bs.player.battleArea || []).indexOf(carrier);
        const isOnlineSelf = () => ctx.side === 'player' && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand;
        let i = 0;
        function discardNext() {
          if (i >= selectedCards.length) {
            ctx.renderAll();
            // cost 解決完了 → 相手画面の効果発動ポップアップを閉じる
            // （後続の対象選択フェーズで「相手が対象選択中」専用ポップアップに切り替えるため）
            if (isOnlineSelf()) {
              try { window._onlineSendCommand({ type: 'fx_effectClose' }); } catch (_) {}
            }
            callback && callback(true);
            return;
          }
          const ec = selectedCards[i++];
          const idx = carrier.stack.indexOf(ec);
          if (idx !== -1) {
            carrier.stack.splice(idx, 1);
            player.trash.push(ec);
            ctx.addLog && ctx.addLog('🗑 「' + ec.name + '」を進化元から破棄');
          }
          ctx.renderAll();
          // オンライン: 相手画面にもカード移動演出を送る
          // fx_evoDiscard は「相手が自分のカードを操作」用なので使えない。
          // 自分が自分の進化元を破棄したことを相手に演出だけ知らせる専用コマンドを使う
          if (isOnlineSelf()) {
            try {
              window._onlineSendCommand({
                type: 'fx_remoteSelfEvoDiscard',
                targetName: carrier.name,
                targetCardNo: carrier.cardNo || '',
                discardedNames: [ec.name],
              });
              if (window._markEvoModified) window._markEvoModified('ai', carrierIdx);
            } catch (_) {}
          }
          // 自分側のカード移動演出
          if (window._fxCardMove) {
            window._fxCardMove(ec, carrier.name + 'の進化元', 'トラッシュ', discardNext);
          } else {
            setTimeout(discardNext, 300);
          }
        }
        discardNext();
      };
      // showEvoSourceSelection を使って evo card を N 枚選ばせる
      // フィルタなし（任意の進化元から選択可）
      showEvoSourceSelection(carrier, carrier.stack.slice(), null, (selectedCards) => {
        // showEvoSourceSelection は単数返却なので、N 回繰り返す簡易ループ
        if (need === 1) {
          onSelectComplete(selectedCards ? [selectedCards] : null);
        } else {
          // 複数枚選択のため自前ループ
          const picked = [];
          const remaining = carrier.stack.slice();
          let r = 0;
          function pickNext() {
            if (r >= need) { onSelectComplete(picked); return; }
            if (remaining.length === 0) { onSelectComplete(null); return; }
            r++;
            showEvoSourceSelection(carrier, remaining, null, (sel) => {
              if (!sel) { onSelectComplete(null); return; }
              picked.push(sel);
              const ri = remaining.indexOf(sel);
              if (ri !== -1) remaining.splice(ri, 1);
              pickNext();
            });
          }
          pickNext();
        }
      });
      break;
    }

    // === レストせずアタック可能にする（attack_without_restとマージ済み） ===
    // case 'enable_attack_without_rest' は削除（attack_without_rest にリネーム）

    // === storeの対象にバフ/状態を直接適用 ===
    case 'cant_attack_block':
    case 'cant_attack':
    case 'cant_block':
    case 'cant_evolve': {
      const dur = normalizeRecipeDuration(step.duration) || (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn');
      const storedData = step.card ? store[step.card] : null;
      const targets = storedData ? (Array.isArray(storedData) ? storedData : [storedData]) : null;
      // 1体に行動制限を付与（フラグ更新 + buff + ログ + 相手カードはオンライン同期）
      const _applyCantState = (c, isOppCard) => {
        if (step.action === 'cant_attack_block' || step.action === 'cant_attack') c.cantAttack = true;
        if (step.action === 'cant_attack_block' || step.action === 'cant_block') c.cantBlock = true;
        if (step.action === 'cant_evolve') c.cantEvolve = true;
        addBuffDirect(c, step.action, 0, dur, ctx);
        ctx.addLog('🔒 「' + c.name + '」' + (step.action === 'cant_attack_block' ? 'アタック・ブロック不可' : step.action === 'cant_attack' ? 'アタック不可' : step.action === 'cant_block' ? 'ブロック不可' : '進化不可'));
        // 相手カードへの付与は state_sync で同期されないため fx_cantAttackBlock を個別送信
        if (isOppCard && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
          const _ci = opponent.battleArea.indexOf(c);
          if (_ci >= 0) {
            const _turnSide = ctx.bs.isPlayerTurn ? 'player' : 'ai';
            window._onlineSendCommand({
              type: 'fx_cantAttackBlock', targetIdx: _ci, targetName: c.name,
              duration: dur, action: step.action, appliedFromSender: 'player',
              appliedDuringOwnTurn: (_turnSide === ctx.side),
            });
          }
        }
      };
      const _syncStateAfterCant = () => {
        if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
          try { window._onlineSendStateSync(); } catch (_) {}
        }
      };
      if (targets && targets.length > 0) {
        targets.forEach(t => {
          const c = opponent.battleArea[t.idx];
          if (c) _applyCantState(c, true);
        });
        ctx.renderAll();
        _syncStateAfterCant();
        callback();
        break;
      }
      // opponent:all / own:all → 条件フィルタを適用して全体に直接付与（対象選択を出さない）
      const _cantTgt = step.target || '';
      if (_cantTgt === 'opponent:all' || _cantTgt === 'own:all') {
        const _isOwnAll = _cantTgt === 'own:all';
        const _tgtPlayer = _isOwnAll ? player : opponent;
        const _tgtSideTag = _isOwnAll ? (ctx.side === 'player' ? 'player' : 'ai')
                                      : (ctx.side === 'player' ? 'ai' : 'player');
        const _conds = step.condition ? parseRecipeCondition(step.condition) : [];
        let _applied = 0;
        (_tgtPlayer.battleArea || []).forEach(c => {
          if (!c) return;
          if (_conds.length > 0 && !checkConditions(_conds, c, ctx.bs, _tgtSideTag)) return;
          _applyCantState(c, !_isOwnAll);
          _applied++;
        });
        if (_applied === 0) ctx.addLog('⚠ 対象がいません');
        ctx.renderAll();
        _syncStateAfterCant();
        callback();
        break;
      }
      // 単体選択など → 既存エンジンに委譲
      const action = { code: step.action, value: step.value || null };
      if (!ctx.block) ctx.block = {};
      if (step.duration) {
        ctx.block.duration = { code: normalizeRecipeDuration(step.duration) };
      }
      // 条件をctx.blockに伝搬（対象フィルタリング用）
      if (step.condition) {
        ctx.block.conditions = parseRecipeCondition(step.condition);
      }
      runOneAction(action, null, ctx, callback);
      break;
    }

    // === キーワード付与 ===
    // grant_keyword: 単体（step.flag等で指定）
    // grant_keyword_all: 全体（step.keyword="Sアタック+1"等のテキストで指定、step.target="own_all_digimon"等）
    case 'grant_keyword':
    case 'grant_keyword_to': {
      // step.flag(英語) または step.keyword(日本語/「Sアタック+1」等)から flag を抽出
      let flag = step.flag || '';
      let val = step.value || 1;
      const dur = normalizeRecipeDuration(step.duration) || 'dur_this_turn';

      // 日本語キーワードからエンジンフラグへの変換
      if (!flag && step.keyword) {
        const kw = String(step.keyword);
        const saMatch = kw.match(/Sアタック\+?(\d+)/) || kw.match(/セキュリティアタック\+?(\d+)/);
        if (saMatch) {
          flag = 'security_attack_plus';
          val = parseInt(saMatch[1]) || 1;
        } else {
          const flagMap = {
            'ブロッカー': 'blocker', '速攻': 'rush', '突進': 'piercing',
            '貫通': 'penetrate', 'ジャミング': 'jamming', '再起動': 'reboot',
            '道連れ': 'michizure',
          };
          flag = flagMap[kw] || kw;
        }
      }

      // own:N / own:up_to_N の場合は非同期に対象選択UIを出してから付与
      const tStr = step.target || '';
      const isOwnSelect = (tStr.startsWith('own:') && !['own:all'].includes(tStr));
      const isOpponentSelect = (tStr.startsWith('opponent:') && !['opponent:all'].includes(tStr));
      if ((isOwnSelect || isOpponentSelect) && !step.card) {
        const upToMatch = tStr.match(/^(own|opponent):up_to_(\d+)$/);
        const exactMatch = tStr.match(/^(own|opponent):(\d+)$/);
        const wantCount = upToMatch ? parseInt(upToMatch[2]) : (exactMatch ? parseInt(exactMatch[2]) : 1);
        const isUpTo = !!upToMatch;
        const tgtPlayer2 = isOwnSelect ? (ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai)
                                       : (ctx.side === 'player' ? ctx.bs.ai : ctx.bs.player);
        const validIdxs = [];
        for (let i = 0; i < tgtPlayer2.battleArea.length; i++) {
          if (tgtPlayer2.battleArea[i]) validIdxs.push(i);
        }
        if (validIdxs.length === 0) { showEffectFailed(null, callback); return; }
        const rowSide = isOwnSelect ? (ctx.side === 'player' ? 'pl' : 'ai')
                                    : (ctx.side === 'player' ? 'ai' : 'pl');
        const applyAll = (idxs) => {
          idxs.forEach(idx => {
            const tgt = tgtPlayer2.battleArea[idx]; if (!tgt) return;
            // 連続同一対象用 (same_target): 選んだカードを保存
            ctx.bs._lastPickedCard = tgt;
            if (flag === 'security_attack_plus') {
              addBuffDirect(tgt, 'security_attack_plus', val, dur, ctx);
              ctx.addLog('⚔ 「' + tgt.name + '」にSアタック+' + val);
              if (window._showKeywordGrantBanner) try { window._showKeywordGrantBanner(tgt, 'Sアタック+' + val); } catch(_) {}
              // オンライン: 相手画面にも buff を同期（カード左上「チェック+」表示のため）
              if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
                window._onlineSendCommand({
                  type: 'fx_remoteBuff', targetIdx: idx, targetName: tgt.name,
                  buffType: 'security_attack_plus', value: val, duration: dur,
                  senderOwn: isOwnSelect, appliedFromSender: 'player',
                  appliedDuringOwnTurn: ctx.bs && ctx.bs.isPlayerTurn,
                });
              }
            } else {
              addBuffDirect(tgt, 'keyword_' + flag, 0, dur, ctx);
              const _kwJp = _keywordJpName(flag);
              ctx.addLog('✨ 「' + tgt.name + '」に【' + _kwJp + '】付与');
              if (window._showKeywordGrantBanner) try { window._showKeywordGrantBanner(tgt, _kwJp); } catch(_) {}
            }
          });
          ctx.renderAll();
          callback();
        };
        // _forceTargetIdx で対象が事前確定済みなら UI スキップ（same_target など）
        if (ctx._forceTargetIdx !== undefined) {
          applyAll([ctx._forceTargetIdx]);
          return;
        }
        if (isUpTo) {
          // 「N体まで」: ギガデストロイヤーと同じ UX (1体目即選択、2体目以降は確認ダイアログ)
          pickUpToNTargets(rowSide, validIdxs, wantCount, '#00ff88', applyAll);
        } else {
          // 「N体」: wantCount 体まで連続選択（キャンセルで途中終了）
          const picked = [];
          (function pickEx() {
            if (picked.length >= wantCount) { applyAll(picked); return; }
            const remaining = validIdxs.filter(i => !picked.includes(i));
            if (remaining.length === 0) { applyAll(picked); return; }
            showTargetSelection(rowSide, remaining, null, '#00ff88', (selectedIdx) => {
              if (selectedIdx == null) { applyAll(picked); return; }
              picked.push(selectedIdx);
              pickEx();
            });
          })();
        }
        break;
      }

      // 対象解決（既存パス: self / own:all / store経由）
      // own:all / opponent:all は step.filter（色/タイプ/名前等）で絞り込み可能
      const resolveTargets = () => {
        const p = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
        const opp = ctx.side === 'player' ? ctx.bs.ai : ctx.bs.player;
        const t = step.target;
        const applyFilter = (arr) => (step.filter ? arr.filter(c => cardMatchesFilter(c, step.filter)) : arr);
        if (t === 'self') return ctx.card ? [ctx.card] : [];
        if (t === 'own:all' || t === 'own_all_digimon') return applyFilter(p.battleArea.filter(c => c));
        if (t === 'opponent:all' || t === 'opp_all_digimon') return applyFilter(opp.battleArea.filter(c => c));
        if (step.card && store[step.card]) {
          const sd = store[step.card];
          return (Array.isArray(sd) ? sd : [sd]).map(s => s.card || s).filter(c => c);
        }
        return ctx.card ? [ctx.card] : [];
      };

      const targets = resolveTargets();
      console.log('[grant_keyword_all]', 'action=' + step.action, 'flag=' + flag, 'val=' + val, 'dur=' + dur, 'targets=' + targets.map(t => t.name).join(','), 'ctxSide=' + ctx.side, 'isPlayerTurn=' + ctx.bs.isPlayerTurn);
      targets.forEach(tgt => {
        if (flag === 'security_attack_plus') {
          // addBuffDirect 経由で _appliedSide / _appliedDuringOwnTurn を正しく設定
          // → expireBuffs の dur_next_own_turn 等のサイド判定が正しく動く
          addBuffDirect(tgt, 'security_attack_plus', val, dur, ctx);
          console.log('[grant_keyword_all] applied buff to', tgt.name, 'buffs.length=' + tgt.buffs.length, 'last=', tgt.buffs[tgt.buffs.length - 1]);
          ctx.addLog('⚔ 「' + tgt.name + '」にSアタック+' + val);
          if (window._showKeywordGrantBanner) try { window._showKeywordGrantBanner(tgt, 'Sアタック+' + val); } catch(_) {}
        } else {
          // 一般キーワードバフ (blocker, piercing 等)
          addBuffDirect(tgt, 'keyword_' + flag, 0, dur, ctx);
          const _kwJp = _keywordJpName(flag);
          ctx.addLog('✨ 「' + tgt.name + '」に【' + _kwJp + '】付与');
          if (window._showKeywordGrantBanner) try { window._showKeywordGrantBanner(tgt, _kwJp); } catch(_) {}
        }
      });
      ctx.renderAll();
      callback();
      break;
    }

    // === レストせずアタック可能（attack_without_rest: enable_attack_without_rest のリネーム後継）===
    case 'attack_without_rest': {
      if (ctx.card) {
        ctx.card._attackWithoutRest = true;
        ctx.addLog('⚔ 「' + ctx.card.name + '」はレストせずにアタックできる！');
      }
      callback();
      break;
    }

    // === 進化元を全て破棄 ===
    case 'bounce': {
      // from:'evo_source' → 自分(ctx.card)の進化元から条件一致のデジモンカードを手札に戻す
      // 例: オメガモン【アタック時】「進化元のLv.6を手札に戻すことでアクティブ」のコスト
      const _bounceFromEvo = step.from === 'evo_source'
        || (Array.isArray(step.from) && step.from.indexOf('evo_source') >= 0);
      if (_bounceFromEvo) {
        const _self = ctx.card;
        if (!_self || !Array.isArray(_self.stack) || _self.stack.length === 0) {
          ctx.addLog('⚠ 進化元がありません');
          showEffectFailed('効果を発動できませんでした', () => callback(false));
          return;
        }
        const _bConds = step.condition ? parseRecipeCondition(step.condition) : [];
        const _bCands = _self.stack.filter((s) =>
          s && s.type === 'デジモン'
          && (_bConds.length === 0 || checkConditions(_bConds, s, ctx.bs, ctx.side))
        );
        if (_bCands.length === 0) {
          ctx.addLog('⚠ 条件を満たす進化元がありません');
          showEffectFailed('効果を発動できませんでした', () => callback(false));
          return;
        }
        const _bWant = step.value || step.count || 1;
        const _doBounceEvo = (chosen) => {
          if (!chosen || chosen.length === 0) { callback(false); return; }
          let _bi = 0;
          const _moveNextEvo = () => {
            if (_bi >= chosen.length) { ctx.renderAll(); callback(true); return; }
            const c = chosen[_bi++];
            const si = _self.stack.indexOf(c);
            if (si >= 0) _self.stack.splice(si, 1);
            player.hand.push(c);
            ctx.addLog('🃏 進化元の「' + c.name + '」を手札に戻した');
            ctx.renderAll();
            // オンライン: 相手画面にも「進化元 → 手札」の移動演出を送る
            if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
              try {
                window._onlineSendCommand({
                  type: 'fx_remoteCardMove',
                  cardName: c.name, cardNo: c.cardNo,
                  cardImg: c.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(c) : '') || '',
                  fromLabel: '進化元', toLabel: '手札',
                });
              } catch (_) {}
            }
            // 進化元 → 手札 の移動演出（はっきり表示）
            if (window._fxCardMove) window._fxCardMove(c, '進化元', '手札', _moveNextEvo);
            else setTimeout(_moveNextEvo, 300);
          };
          _moveNextEvo();
        };
        if (effectiveSide === 'ai' || _bCands.length <= _bWant) {
          _doBounceEvo(_bCands.slice(0, _bWant));
        } else {
          showTrashCardPicker(_bCands, _bWant, false, '🃏 手札に戻す進化元を選んでください', _doBounceEvo, _bCands);
        }
        return;
      }
      // 通常の bounce（相手デジモンを手札に戻す）→ 既存エンジンに委譲
      const _bAction = { code: 'bounce', value: step.value || null };
      if (step.condition) {
        _bAction.conditions = parseRecipeCondition(step.condition);
        if (!ctx.block) ctx.block = {};
        ctx.block.conditions = _bAction.conditions;
      }
      // step.target（opponent:N / opponent:up_to_N / opponent_suspended:N）を対象数として引き継ぐ
      // 例: アルティメットストリーム「Lv3の相手のデジモン3体まで」= opponent:up_to_3 + cond_lv:3
      let _bTarget = null;
      const _bt = step.target;
      if (_bt) {
        if (_bt.startsWith('opponent_suspended:')) _bTarget = { code: 'target_opponent_suspended', count: parseInt(_bt.split(':')[1]) || 1 };
        else if (_bt.startsWith('opponent:up_to_')) _bTarget = { code: 'target_opponent', count: parseInt(_bt.split('opponent:up_to_')[1]) || 1, upTo: true };
        else if (_bt.startsWith('opponent:')) _bTarget = { code: 'target_opponent', count: parseInt(_bt.split(':')[1]) || 1 };
      }
      runOneAction(_bAction, _bTarget, ctx, callback);
      break;
    }

    case 'evo_discard_all': {
      // 進化元を全て破棄する。target: self / own:all / own:1 / opponent:all / opponent:1 / step.card(store)
      const _edTgt = step.target || 'self';
      const _edIsOpp = _edTgt.startsWith('opponent');
      const _edOwner = _edIsOpp ? opponent : player; // 破棄した進化元は所有者のトラッシュへ
      const _discardEvoAll = (tgt) => {
        if (!tgt || !Array.isArray(tgt.stack) || tgt.stack.length === 0) return false;
        const _cnt = tgt.stack.length;
        const _names = tgt.stack.map(s => (s && s.name) || '???').join('、');
        while (tgt.stack.length > 0) _edOwner.trash.push(tgt.stack.shift());
        ctx.addLog('🗑 「' + tgt.name + '」の進化元を全て破棄（' + _names + '）');
        // 相手カードの進化元破棄は state_sync で同期されないため fx_evoDiscard を個別送信
        if (_edIsOpp && window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
          const _ti = opponent.battleArea.indexOf(tgt);
          if (_ti >= 0) {
            window._onlineSendCommand({ type: 'fx_evoDiscard', targetName: tgt.name, discardedNames: _names, targetIdx: _ti, count: _cnt, fromTop: true });
            if (window._markEvoModified) window._markEvoModified('ai', _ti);
          }
        }
        return true;
      };
      // self / store 指定
      if (_edTgt === 'self') {
        if (ctx.card) _discardEvoAll(ctx.card);
        ctx.renderAll(); callback(); break;
      }
      if (step.card && store[step.card]) {
        const sd = store[step.card];
        (Array.isArray(sd) ? sd : [sd]).map(s => s.card || s).filter(c => c).forEach(_discardEvoAll);
        ctx.renderAll(); callback(); break;
      }
      // 「進化元を破棄したとき」反応（城戸丈 BT2-085 等）。discardedSide は破棄された
      // 進化元の持ち主側（own指定なら effectiveSide 自身、opponent指定ならその反対側）
      const _fireEvoDiscardReactIfNeeded = (didHit, doneCb) => {
        if (didHit) {
          const _discardedSide = _edIsOpp ? (effectiveSide === 'player' ? 'ai' : 'player') : effectiveSide;
          try { fireWhenEvoDiscardTriggers(_discardedSide, ctx.bs, ctx, () => doneCb && doneCb()); return; } catch (_) {}
        }
        doneCb && doneCb();
      };
      // opponent:all / own:all → 進化元を持つ全デジモンに一括適用
      if (_edTgt === 'opponent:all' || _edTgt === 'own:all') {
        let _hit = false;
        (_edOwner.battleArea || []).forEach(c => { if (c && _discardEvoAll(c)) _hit = true; });
        if (!_hit) ctx.addLog('⚠ 進化元を持つデジモンがいません');
        ctx.renderAll();
        _fireEvoDiscardReactIfNeeded(_hit, callback);
        break;
      }
      // opponent:1 / own:1 → 進化元を持つデジモンから1体選択
      const _edCands = [];
      (_edOwner.battleArea || []).forEach((c, i) => { if (c && Array.isArray(c.stack) && c.stack.length > 0) _edCands.push(i); });
      if (_edCands.length === 0) {
        ctx.addLog('⚠ 進化元を持つデジモンがいません');
        showEffectFailed('効果を発動できませんでした', callback);
        break;
      }
      const _edRowId = _edIsOpp ? (ctx.side === 'player' ? 'ai' : 'pl') : (ctx.side === 'player' ? 'pl' : 'ai');
      if (effectiveSide === 'ai' || _edCands.length === 1) {
        const _edDid = _discardEvoAll(_edOwner.battleArea[ctx._forceTargetIdx != null ? ctx._forceTargetIdx : _edCands[0]]);
        ctx.renderAll();
        _fireEvoDiscardReactIfNeeded(_edDid, callback);
        break;
      }
      ctx.addLog('🎯 進化元を破棄する対象を選んでください');
      showTargetSelection(_edRowId, _edCands, null, '#ff5577', (selIdx) => {
        const _edDid = selIdx !== null ? _discardEvoAll(_edOwner.battleArea[selIdx]) : false;
        ctx.renderAll();
        _fireEvoDiscardReactIfNeeded(_edDid, callback);
      });
      break;
    }

    // === デッキの上からN枚破棄（自分側）1枚ずつ表示+カード移動演出 ===
    case 'deck_trash_top': {
      const n = step.value || 1;
      let i = 0;
      const trashOne = () => {
        if (i >= n || !player.deck || player.deck.length === 0) {
          ctx.renderAll && ctx.renderAll();
          callback();
          return;
        }
        i++;
        const top = player.deck.shift();
        player.trash.push(top);
        ctx.addLog && ctx.addLog('🗑 デッキ上から「' + (top.name || '?') + '」をトラッシュへ');
        ctx.renderAll && ctx.renderAll();
        // オンライン: 相手画面にも「デッキ → トラッシュ」のカード移動演出を送る
        if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player' && window._onlineSendCommand) {
          try {
            window._onlineSendCommand({
              type: 'fx_remoteCardMove',
              cardName: top.name, cardNo: top.cardNo,
              cardImg: top.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(top) : '') || '',
              fromLabel: 'デッキ', toLabel: 'トラッシュ',
            });
          } catch(_) {}
        }
        // 一瞬カード画像を中央表示してから移動（簡易演出）
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:62000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease;pointer-events:none;';
        const card = document.createElement('div');
        const src = top.imgSrc || (typeof getCardImageUrl === 'function' ? getCardImageUrl(top) : '') || top.imageUrl || '';
        card.style.cssText = 'background:#0a0a0a;border:2px solid #ff5577;border-radius:10px;padding:14px;max-width:240px;text-align:center;box-shadow:0 0 30px rgba(255,85,119,0.5);';
        card.innerHTML = (src ? '<img src="'+src+'" style="width:160px;border-radius:6px;margin-bottom:8px;">' : '')
          + '<div style="color:#fff;font-size:13px;font-weight:bold;">' + (top.name || '?') + '</div>'
          + '<div style="color:#ff5577;font-size:10px;margin-top:4px;">→ トラッシュへ</div>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          // カード移動演出（あれば）
          if (window._fxCardMove) {
            try { window._fxCardMove(top, 'デッキ', 'トラッシュ', () => setTimeout(trashOne, 200)); }
            catch(_) { setTimeout(trashOne, 200); }
          } else {
            setTimeout(trashOne, 200);
          }
        }, 700);
      };
      trashOne();
      break;
    }

    // === 一番上から1枚破棄（進化元の一番上） ===
    case 'trash_top_card': {
      const tgts = (step.card && store[step.card]) ? (Array.isArray(store[step.card]) ? store[step.card] : [store[step.card]]) : [];
      tgts.forEach(t => {
        const c = t.card || t;
        if (c && Array.isArray(c.stack) && c.stack.length > 0) {
          const top = c.stack.pop();
          (step.target && step.target.startsWith('own') ? player : opponent).trash.push(top);
          ctx.addLog('🗑 「' + c.name + '」の進化元1枚を破棄');
        }
      });
      ctx.renderAll();
      callback();
      break;
    }

    // === このカードを破棄（コスト用） ===
    case 'cost_trash_self': {
      if (ctx.card) {
        const idx = player.battleArea.indexOf(ctx.card);
        if (idx >= 0) {
          player.battleArea[idx] = null;
          player.trash.push(ctx.card);
          if (ctx.card.stack) ctx.card.stack.forEach(s => player.trash.push(s));
          ctx.addLog('🗑 「' + ctx.card.name + '」を破棄');
          ctx.renderAll();
        }
      }
      callback();
      break;
    }

    // === アタック終了時に自身消滅（フラグ付与） ===
    case 'self_destroy_after_attack': {
      if (ctx.card) {
        ctx.card._destroyAfterAttack = true;
        ctx.addLog('💀 「' + ctx.card.name + '」はアタック終了時に消滅');
      }
      callback();
      break;
    }

    // === 効果で消滅しない（バフ付与） ===
    case 'prevent_destroy': {
      const tgt = ctx.card;
      if (tgt) {
        const dur = normalizeRecipeDuration(step.duration) || 'dur_this_turn';
        addBuffDirect(tgt, 'keyword_prevent_destroy', 0, dur, ctx);
        ctx.addLog('🛡 「' + tgt.name + '」は効果で消滅しない');
      }
      callback();
      break;
    }

    // === バトルでも効果でも消滅しない（バフ2つ付与） ===
    case 'prevent_any_destroy': {
      const tgt = ctx.card;
      if (tgt) {
        const dur = normalizeRecipeDuration(step.duration) || 'dur_this_turn';
        addBuffDirect(tgt, 'keyword_prevent_destroy', 0, dur, ctx);
        addBuffDirect(tgt, 'keyword_prevent_battle_destroy', 0, dur, ctx);
        ctx.addLog('🛡 「' + tgt.name + '」はバトルでも効果でも消滅しない');
      }
      callback();
      break;
    }

    // === バトルで消滅しない（バフ付与） ===
    case 'prevent_battle_destroy': {
      const tgt = ctx.card;
      if (tgt) {
        const dur = normalizeRecipeDuration(step.duration) || 'dur_this_turn';
        addBuffDirect(tgt, 'keyword_prevent_battle_destroy', 0, dur, ctx);
        ctx.addLog('🛡 「' + tgt.name + '」はバトルで消滅しない');
      }
      callback();
      break;
    }

    // === テイマーの下に置く ===
    case 'place_under_tamer': {
      const sd = step.card ? store[step.card] : null;
      const cardToPlace = sd && (sd.card || sd);
      if (!cardToPlace) { callback(); break; }
      const tamerIdxs = [];
      player.tamerArea.forEach((t, i) => { if (t) tamerIdxs.push(i); });
      if (tamerIdxs.length === 0) { ctx.addLog('⚠ テイマーがいない'); callback(); break; }
      const rowId = ctx.side === 'player' ? 'pl' : 'ai';
      showTargetSelection(rowId + '-tamer', tamerIdxs, 'テイマーを選んで下に置く', '#00ff88', (selectedIdx) => {
        if (selectedIdx == null) { callback(); return; }
        const tamer = player.tamerArea[selectedIdx];
        if (!tamer.stack) tamer.stack = [];
        tamer.stack.unshift(cardToPlace);
        ctx.addLog('🃏 「' + tamer.name + '」の下に「' + cardToPlace.name + '」を置く');
        ctx.renderAll();
        callback();
      });
      break;
    }

    // === デジモンの進化元の下に置く ===
    case 'place_under_digimon': {
      const sd = step.card ? store[step.card] : null;
      const cardToPlace = sd && (sd.card || sd);
      if (!cardToPlace) { callback(); break; }
      const valid = [];
      player.battleArea.forEach((c, i) => { if (c) valid.push(i); });
      if (valid.length === 0) { callback(); break; }
      const rowId = ctx.side === 'player' ? 'pl' : 'ai';
      showTargetSelection(rowId, valid, 'デジモンを選んで進化元の下に置く', '#00ff88', (selectedIdx) => {
        if (selectedIdx == null) { callback(); return; }
        const digi = player.battleArea[selectedIdx];
        if (!digi.stack) digi.stack = [];
        digi.stack.unshift(cardToPlace);
        ctx.addLog('🃏 「' + digi.name + '」の進化元の下に置く');
        ctx.renderAll();
        callback();
      });
      break;
    }

    // === セキュリティの上に置く ===
    case 'place_on_security_top': {
      const sd = step.card ? store[step.card] : null;
      const cardToPlace = sd && (sd.card || sd);
      if (!cardToPlace) { callback(); break; }
      player.security.unshift(cardToPlace);
      ctx.addLog('🛡 「' + cardToPlace.name + '」をセキュリティの上に置く');
      ctx.renderAll();
      callback();
      break;
    }

    // === デッキの上から進化元の下に置く（裏向き） ===
    case 'deck_to_evo_bottom': {
      const n = step.value || 1;
      const sd = step.card ? store[step.card] : null;
      const target = sd ? (sd.card || sd) : ctx.card;
      if (!target) { callback(); break; }
      if (!target.stack) target.stack = [];
      for (let i = 0; i < n && player.deck.length > 0; i++) {
        const top = player.deck.shift();
        target.stack.unshift(top);
      }
      ctx.addLog('🃏 デッキの上' + n + '枚を「' + target.name + '」の進化元の下に置く');
      ctx.renderAll();
      callback();
      break;
    }

    // === デッキに戻す（上下選択） ===
    case 'return_deck': {
      // store経由（自分側カードを対象にした従来パス）: 自分のデッキに戻す
      if (step.card) {
        const sd = store[step.card];
        const cardToReturn = sd && (sd.card || sd);
        if (!cardToReturn) { callback(); break; }
        const top = step.position === 'top' || step.deck_top;
        if (top) player.deck.unshift(cardToReturn);
        else player.deck.push(cardToReturn);
        ctx.addLog('🔄 「' + cardToReturn.name + '」をデッキの' + (top ? '上' : '下') + 'に戻す');
        ctx.renderAll();
        callback();
        break;
      }
      // target:"opponent:1" 等の直接指定: 相手デジモンをバトルエリアから外し、
      // 相手自身のデッキ（所有者のデッキ）に戻す。例: テラーズクラスター
      // 「レスト状態の相手のデジモン1体をデッキの下に戻す」
      const _rdTStr = step.target || '';
      if (_rdTStr.startsWith('opponent')) {
        const _rdConds = step.condition ? parseRecipeCondition(step.condition) : [];
        const _rdCondSide = ctx.side === 'player' ? 'ai' : 'player';
        const _rdCands = [];
        for (let i = 0; i < opponent.battleArea.length; i++) {
          const c = opponent.battleArea[i];
          if (!c) continue;
          if (_rdConds.length > 0 && !checkConditions(_rdConds, c, ctx.bs, _rdCondSide)) continue;
          _rdCands.push(i);
        }
        if (_rdCands.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
        const _rdTop = step.position === 'top' || step.deck_top;
        const _doReturnDeck = (idx) => {
          const c = opponent.battleArea[idx];
          if (!c) return;
          opponent.battleArea[idx] = null;
          if (c.stack) c.stack.forEach(s => opponent.trash.push(s));
          if (_rdTop) opponent.deck.unshift(c); else opponent.deck.push(c);
          ctx.addLog('🔄 「' + c.name + '」を持ち主のデッキの' + (_rdTop ? '上' : '下') + 'に戻す');
          if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player') {
            window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: idx, reason: 'return_deck' });
          }
        };
        if (effectiveSide === 'ai') {
          _doReturnDeck(ctx._forceTargetIdx ?? _rdCands[0]);
          ctx.renderAll(); callback(); break;
        }
        showTargetSelection(opponentRowSide, _rdCands, null, uiColor, (selectedIdx) => {
          if (selectedIdx !== null) _doReturnDeck(selectedIdx);
          ctx.renderAll();
          callback();
        });
        break;
      }
      callback();
      break;
    }

    // === セキュリティを選んで破棄 ===
    case 'security_trash_select': {
      const owner = step.target && step.target.startsWith('own') ? player : opponent;
      if (owner.security.length === 0) { callback(); break; }
      const idxs = owner.security.map((_, i) => i);
      const rowId = (owner === player ? (ctx.side === 'player' ? 'pl' : 'ai') : (ctx.side === 'player' ? 'ai' : 'pl')) + '-sec';
      showTargetSelection(rowId, idxs, 'セキュリティから破棄するカードを選択', '#ff4444', (selectedIdx) => {
        if (selectedIdx == null) { callback(); return; }
        const c = owner.security.splice(selectedIdx, 1)[0];
        if (c) owner.trash.push(c);
        ctx.addLog('🗑 セキュリティから「' + (c ? c.name : '?') + '」を破棄');
        ctx.renderAll();
        callback();
      });
      break;
    }

    // === 相手にブロック強制（衝突キーワード用） ===
    case 'force_block': {
      if (ctx.card) {
        ctx.card._forceBlock = true;
        ctx.addLog('🛡 相手はブロック強制');
      }
      callback();
      break;
    }

    // === 効果を受けない（バフ付与） ===
    case 'immune_effects': {
      const tgt = ctx.card;
      if (tgt) {
        const dur = normalizeRecipeDuration(step.duration) || 'dur_this_turn';
        addBuffDirect(tgt, 'keyword_immune', 0, dur, ctx);
        ctx.addLog('🪄 「' + tgt.name + '」は相手の効果を受けない');
      }
      callback();
      break;
    }

    // === 進化元枚数でバトル（氷装キーワード） ===
    case 'battle_by_evo_count': {
      if (ctx.card) {
        ctx.card._battleByEvoCount = true;
        ctx.addLog('❄ 「' + ctx.card.name + '」は進化元枚数でバトル');
      }
      callback();
      break;
    }

    // === 登場ターンでもアタック（速攻キーワード） ===
    case 'mod_attack_first_turn': {
      if (ctx.card) {
        ctx.card._canAttackFirstTurn = true;
        ctx.addLog('⚡ 「' + ctx.card.name + '」は登場ターンでもアタック可');
      }
      callback();
      break;
    }

    // === アタックの対象を変更（突進キーワード） ===
    case 'change_attack_target': {
      // バトル中のみ意味を持つフラグ
      if (ctx.card) ctx.card._canChangeAttackTarget = true;
      ctx.addLog('🎯 アタック対象を変更');
      callback();
      break;
    }

    // === 進化コスト-N ===
    // 「次に〜が進化するときの進化コストを-N」= 次の対象進化に適用する保留割引として
    // bs._pendingEvoCostReductions に登録する（doEvolve / doEvolveIku が消費）。
    // step.condition(cond_color:X または cond_name:X) / step.when(cond_lv:N) / step.extra_conditions
    // (cond_evolve_to_lv:N / cond_name:X) で「どの進化に適用されるか」を記述する。
    case 'evo_cost_minus': {
      const ecmVal = step.value || 1;
      if (!ctx.bs._pendingEvoCostReductions) ctx.bs._pendingEvoCostReductions = [];
      const _parseLvCond = (cs) => { const m = /cond_(?:evolve_to_)?lv:(\d+)/.exec(String(cs || '')); return m ? parseInt(m[1], 10) : null; };
      const _parseNameCond = (cs) => { const m = /cond_name:(.+)/.exec(String(cs || '')); return m ? m[1].trim() : null; };
      const _colorM = /cond_color:([^@:]+)/.exec(String(step.condition || ''));
      const _extraArr = Array.isArray(step.extra_conditions) ? step.extra_conditions
        : (step.extra_conditions ? [step.extra_conditions] : []);
      let _evoLv = null;
      // step.condition に cond_name が指定される場合（エディタで条件1に設定したとき）も解釈する
      let _evoName = _parseNameCond(step.condition || '');
      for (const ec of _extraArr) {
        const v = _parseLvCond(ec); if (v != null) _evoLv = v;
        const n = _parseNameCond(ec); if (n != null) _evoName = n;
      }
      ctx.bs._pendingEvoCostReductions.push({
        value: ecmVal,
        color: _colorM ? _colorM[1].trim() : null,
        baseLv: _parseLvCond(step.when),
        evoLv: _evoLv,
        name: _evoName,
        duration: normalizeRecipeDuration(step.duration) || 'dur_this_turn',
        side: ctx.side,
        once: Array.isArray(step.options) && (step.options.includes('once_only') || step.options.includes('once')),
      });
      ctx.addLog && ctx.addLog('💠 進化コスト-' + ecmVal + '（次の対象進化に適用）');
      callback();
      break;
    }

    // === 登場コスト-N ===
    case 'summon_cost_minus': {
      if (ctx.card) {
        ctx.card._summonCostReduction = (ctx.card._summonCostReduction || 0) + (step.value || 1);
        ctx.addLog('💠 登場コスト-' + (step.value || 1));
      }
      callback();
      break;
    }

    // === リンクカード枚数上限+N ===
    case 'link_capacity': {
      if (ctx.card) {
        ctx.card._linkCapacityBonus = (ctx.card._linkCapacityBonus || 0) + (step.value || 1);
        ctx.addLog('🔗 リンク+' + (step.value || 1));
      }
      callback();
      break;
    }

    // === プレイヤーにアタック（強制アタック） ===
    case 'attack_player': {
      // 自身でアタック宣言を発火
      if (ctx.card && window._battleStartAttack) {
        window._battleStartAttack(ctx.card, 'player', ctx);
      }
      ctx.addLog('⚔ プレイヤーにアタック');
      callback();
      break;
    }

    // === 相手のデジモンにアタック ===
    case 'attack_digimon': {
      const sd = step.card ? store[step.card] : null;
      const tgt = sd ? (sd.card || sd) : null;
      if (ctx.card && tgt && window._battleStartAttack) {
        window._battleStartAttack(ctx.card, 'digimon', ctx, tgt);
      }
      ctx.addLog('⚔ デジモンにアタック');
      callback();
      break;
    }

    // === セキュリティチェックを実行（貫通キーワード） ===
    case 'do_security_check': {
      // 1回分のセキュリティチェックをキューイング
      if (ctx.bs) {
        ctx.bs._extraSecurityChecks = (ctx.bs._extraSecurityChecks || 0) + (step.value || 1);
      }
      ctx.addLog('🛡 セキュリティチェック+' + (step.value || 1));
      callback();
      break;
    }

    // === ジョグレス進化（UIトリガー） ===
    case 'jogress_evolve': {
      // ジョグレス進化UI起動（既存システムに委譲）
      if (window._startJogressEvolve) {
        window._startJogressEvolve(ctx, callback);
      } else {
        ctx.addLog('🌟 ジョグレス進化（手動操作）');
        callback();
      }
      break;
    }

    // === リンク（手札/Bエリアからリンク） ===
    case 'link': {
      const sd = step.card ? store[step.card] : null;
      const linkCard = sd && (sd.card || sd);
      if (!linkCard || !ctx.card) { callback(); break; }
      if (!ctx.card.linkedCards) ctx.card.linkedCards = [];
      ctx.card.linkedCards.push(linkCard);
      ctx.addLog('🔗 「' + ctx.card.name + '」に「' + linkCard.name + '」をリンク');
      ctx.renderAll();
      callback();
      break;
    }

    // === リンクを破棄 ===
    case 'unlink': {
      if (ctx.card && Array.isArray(ctx.card.linkedCards) && ctx.card.linkedCards.length > 0) {
        const n = step.value || 1;
        for (let i = 0; i < n && ctx.card.linkedCards.length > 0; i++) {
          const c = ctx.card.linkedCards.shift();
          player.trash.push(c);
          ctx.addLog('🔗 リンクカード「' + c.name + '」を破棄');
        }
        ctx.renderAll();
      }
      callback();
      break;
    }

    // === リンクコストを支払う ===
    case 'link_cost': {
      // メモリーをN支払う
      if (ctx.bs) {
        ctx.bs.memory -= (step.value || 1);
        ctx.addLog('💾 リンクコスト-' + (step.value || 1));
        ctx.updateMemGauge && ctx.updateMemGauge();
        if (window._sendMemoryUpdate) window._sendMemoryUpdate();
      }
      callback();
      break;
    }

    // === アプ合体で進化 ===
    case 'app_gattai_evolve': {
      // 専用UI起動（既存システムに委譲）
      if (window._startAppGattaiEvolve) {
        window._startAppGattaiEvolve(ctx, callback);
      } else {
        ctx.addLog('🌟 アプ合体進化（手動操作）');
        callback();
      }
      break;
    }

    // === トラッシュからカードの下に置く ===
    case 'place_from_trash_under': {
      const filter = step.filter || {};
      const candidates = player.trash.map((c, i) => ({card:c, idx:i}))
        .filter(({card}) => card && cardMatchesFilter(card, filter));
      if (candidates.length === 0) { ctx.addLog('⚠ 条件に合うトラッシュカードが無い'); callback(); break; }
      showTrashCardPicker && showTrashCardPicker(candidates.map(c => c.card), 1, (chosen) => {
        if (!chosen) { callback(); return; }
        const tIdx = player.trash.indexOf(chosen);
        if (tIdx >= 0) player.trash.splice(tIdx, 1);
        // 対象選択
        const valid = [];
        player.battleArea.forEach((c, i) => { if (c) valid.push(i); });
        if (valid.length === 0) { player.trash.push(chosen); callback(); return; }
        const rowId = ctx.side === 'player' ? 'pl' : 'ai';
        showTargetSelection(rowId, valid, '進化元の下に置く対象', '#00ff88', (selIdx) => {
          if (selIdx == null) { player.trash.push(chosen); callback(); return; }
          const tgt = player.battleArea[selIdx];
          if (!tgt.stack) tgt.stack = [];
          tgt.stack.unshift(chosen);
          ctx.addLog('🃏 トラッシュから「' + chosen.name + '」を「' + tgt.name + '」の進化元の下に');
          ctx.renderAll();
          callback();
        });
      });
      break;
    }

    // === 色条件を無視（オプションカード用フラグ） ===
    case 'ignore_color_condition': {
      if (ctx.card) ctx.card._ignoreColorCondition = true;
      ctx.addLog('🎨 色条件を無視');
      callback();
      break;
    }

    // === メモリーオーバーフロー時の処理 ===
    case 'overflow_memory_minus': {
      // バトルエリアを離れる際にメモリーをN減らす
      if (ctx.bs) {
        ctx.bs.memory -= (step.value || 1);
        ctx.addLog('💾 メモリー-' + (step.value || 1));
        ctx.updateMemGauge && ctx.updateMemGauge();
        if (window._sendMemoryUpdate) window._sendMemoryUpdate();
      }
      callback();
      break;
    }

    // === 手札またはバトルエリアからカードの下に置く ===
    case 'place_from_hand_battle_under': {
      // 簡易実装：手札からのみ対応
      const filter = step.filter || {};
      const handCands = player.hand.map((c,i)=>({card:c,idx:i})).filter(({card}) => card && cardMatchesFilter(card, filter));
      if (handCands.length === 0) { callback(); break; }
      showHandSelection && showHandSelection(handCands.map(c=>c.card), 1, (chosen) => {
        if (!chosen) { callback(); return; }
        const hIdx = player.hand.indexOf(chosen);
        if (hIdx >= 0) player.hand.splice(hIdx, 1);
        const valid = [];
        player.battleArea.forEach((c, i) => { if (c) valid.push(i); });
        if (valid.length === 0) { player.hand.push(chosen); callback(); return; }
        const rowId = ctx.side === 'player' ? 'pl' : 'ai';
        showTargetSelection(rowId, valid, '進化元の下に置く対象', '#00ff88', (selIdx) => {
          if (selIdx == null) { player.hand.push(chosen); callback(); return; }
          const tgt = player.battleArea[selIdx];
          if (!tgt.stack) tgt.stack = [];
          tgt.stack.unshift(chosen);
          ctx.addLog('🃏 「' + chosen.name + '」を「' + tgt.name + '」の進化元の下に');
          ctx.renderAll();
          callback();
        });
      });
      break;
    }

    // === その他のアクション（既存エンジンに委譲） ===
    default: {
      // rest で target が own_tamer:all → テイマーエリア全体をレスト（filter 適用可）
      // レストさせた枚数を bs._lastRestCount に保存（ref:'last_rest_count' で参照可能）
      if (step.action === 'rest' && step.target === 'own_tamer:all') {
        const _tFilter = step.filter || {};
        let _newlyRested = 0;
        (player.tamerArea || []).forEach((t) => {
          if (!t || t.suspended) return;
          if (_tFilter.color && t.color !== _tFilter.color) return;
          if (_tFilter.type && t.type !== _tFilter.type) return;
          t.suspended = true;
          _newlyRested++;
          ctx.addLog('💤 「' + t.name + '」をレスト');
        });
        if (ctx.bs) ctx.bs._lastRestCount = _newlyRested;
        ctx.renderAll();
        callback();
        break;
      }
      // rest で target が opponent:all / own:all → 条件フィルタを適用して全体をレスト
      // （対象選択UIを出さない。フラウカノン「ブロッカーを持たない相手デジモン全てをレスト」等）
      if (step.action === 'rest' && (step.target === 'opponent:all' || step.target === 'own:all')) {
        const _isOwnAll = step.target === 'own:all';
        const _restP = _isOwnAll ? player : opponent;
        const _restTag = _isOwnAll ? (ctx.side === 'player' ? 'player' : 'ai')
                                   : (ctx.side === 'player' ? 'ai' : 'player');
        const _restConds = step.condition ? parseRecipeCondition(step.condition) : [];
        let _restedAny = false;
        (_restP.battleArea || []).forEach((c, i) => {
          if (!c || c.suspended) return;
          if (_restConds.length > 0 && !checkConditions(_restConds, c, ctx.bs, _restTag)) return;
          c.suspended = true;
          _restedAny = true;
          ctx.addLog('💤 「' + c.name + '」をレスト');
          // 相手カードへのレストは state_sync で同期されないため fx_remoteSuspend を個別送信
          if (!_isOwnAll && ctx.side === 'player' && window._isOnlineMode && window._isOnlineMode()) {
            if (window._markSuspendChanged) window._markSuspendChanged('ai', i, true);
            if (window._onlineSendCommand) {
              window._onlineSendCommand({ type: 'fx_remoteSuspend', targetIdx: i, suspended: true, targetName: c.name });
            }
          }
        });
        if (!_restedAny) ctx.addLog('⚠ レスト対象がいません');
        ctx.renderAll();
        if (!_isOwnAll && _restedAny) {
          // 相手デジモンをレストさせた → when_opp_rest 反応を発火
          const _restedSide = ctx.side === 'player' ? 'ai' : 'player';
          try { fireWhenOppRestTriggers(_restedSide, ctx.bs, ctx, () => callback()); return; }
          catch (_) {}
        }
        callback();
        break;
      }
      // per_count倍率を適用
      let effectiveValue = step.value != null ? step.value : (step.per_count ? 1 : null);
      if (step.per_count && effectiveValue != null) {
        const refSource = step.ref || 'evo_source';
        const count = getRefSourceCountDirect(refSource, ctx.card, ctx.bs, ctx.side, step.ref_filter, step.ref_state);
        effectiveValue = effectiveValue * Math.floor(count / step.per_count);
      }
      // レシピのアクション名を既存エンジンのアクション名にマッピング
      let actionCode = step.action;
      if (actionCode === 'active_self') { actionCode = 'active'; }
      if (actionCode === 'trash_evo_bottom') { actionCode = 'evo_discard_bottom'; }
      // レシピのtarget形式 → runOneAction形式に変換
      const action = { code: actionCode, value: effectiveValue };
      // 条件もaction経由で渡す（destroy等のフィルタ用、ctx.block.conditionsだけだと失われるケースあり）
      if (step.condition) {
        action.conditions = parseRecipeCondition(step.condition);
      }
      // ターン終了時メモリー復元フラグを引き継ぐ（memory_plus の revert_at_turn_end）
      if (step.revert_at_turn_end) action.revert_at_turn_end = true;
      let target = null;
      if (step.target) {
        const t = step.target;
        if (t === 'self' || t === 'self_card') target = { code: 'target_self' };
        else if (t === 'own:all') target = { code: 'target_all_own' };
        else if (t === 'opponent:all') target = { code: 'target_all_opponent' };
        else if (t === 'own_security:all') target = { code: 'target_all_own_security' };
        else if (t.startsWith('opponent_suspended:')) target = { code: 'target_opponent_suspended', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('opponent_active:')) target = { code: 'target_opponent_active', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('own:up_to_')) target = { code: 'target_own', count: parseInt(t.split('own:up_to_')[1]) || 1, upTo: true };
        else if (t.startsWith('opponent:up_to_')) target = { code: 'target_opponent', count: parseInt(t.split('opponent:up_to_')[1]) || 1, upTo: true };
        else if (t.startsWith('own:')) target = { code: 'target_own', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('opponent:')) target = { code: 'target_opponent', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('other_own:')) target = { code: 'target_other_own', count: parseInt(t.split(':')[1]) || 1 };
        else target = { code: 'target_' + t };
      }
      // step.filter（色/タイプ/名前等）を target に引き継ぐ（target_all_own 等の絞り込みに使用）
      if (target && step.filter) target.filter = step.filter;
      // 持続期間をctx.blockに設定（runOneAction内のapplyDpBuff等で参照）
      // レシピのコード（this_turn等）→ エンジン内部コード（dur_this_turn等）に正規化
      if (step.duration) {
        if (!ctx.block) ctx.block = {};
        ctx.block.duration = { code: normalizeRecipeDuration(step.duration) };
      }
      // 条件
      if (step.condition) {
        const conds = parseRecipeCondition(step.condition);
        // For non-target-selection actions: check if condition is met, skip if not
        if (!step.target || step.target === 'self') {
          if (!checkConditions(conds, ctx.card, ctx.bs, ctx.side)) {
            callback && callback();
            break;
          }
        }
        // Pass conditions to ctx.block for target filtering in runOneAction
        if (!ctx.block) ctx.block = {};
        ctx.block.conditions = conds;
      }
      // storeから対象を引ける場合は対象選択をスキップして直接適用
      if (step.card && store[step.card]) {
        const storedData = store[step.card];
        const targets = Array.isArray(storedData) ? storedData : [storedData];
        let ti = 0;
        function nextStoredTarget() {
          if (ti >= targets.length) { callback(); return; }
          const t = targets[ti++];
          // _forceTargetIdxを設定して対象選択UIをスキップさせる
          runOneAction(action, null, { ...ctx, _forceTargetIdx: t.idx }, nextStoredTarget);
        }
        nextStoredTarget();
      } else {
        runOneAction(action, target, ctx, callback);
      }
      break;
    }
  }
}

// 進化元カード選択UI
function showEvoSourceSelection(parentCard, evoCards, filter, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:20px;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;margin-bottom:16px;';
  title.innerText = '🔍 「' + parentCard.name + '」の進化元から選択';
  overlay.appendChild(title);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';

  evoCards.forEach((evoCard, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;cursor:pointer;border:2px solid #333;border-radius:8px;padding:6px;transition:all 0.2s;';
    const imgSrc = evoCard.imgSrc || evoCard.imageUrl || '';
    wrap.innerHTML = (imgSrc ? '<img src="' + imgSrc + '" style="width:70px;height:98px;object-fit:cover;border-radius:4px;">' : '')
      + '<div style="color:#fff;font-size:10px;margin-top:4px;">' + evoCard.name + '</div>'
      + '<div style="color:#aaa;font-size:9px;">Lv.' + (evoCard.level || '?') + ' DP:' + (evoCard.dp || '?') + '</div>';
    wrap.onmouseenter = () => { wrap.style.borderColor = '#00fbff'; wrap.style.boxShadow = '0 0 12px #00fbff44'; };
    wrap.onmouseleave = () => { wrap.style.borderColor = '#333'; wrap.style.boxShadow = ''; };
    wrap.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      callback(evoCard);
    };
    row.appendChild(wrap);
  });

  overlay.appendChild(row);

  // キャンセルボタン
  const cancelBtn = document.createElement('button');
  cancelBtn.style.cssText = 'margin-top:16px;background:#333;color:#fff;border:1px solid #666;padding:8px 20px;border-radius:8px;font-size:12px;cursor:pointer;';
  cancelBtn.innerText = 'キャンセル';
  cancelBtn.onclick = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback(null);
  };
  overlay.appendChild(cancelBtn);

  document.body.appendChild(overlay);
}

// 手札/トラッシュからカード選択UI
function showHandTrashSelection(candidates, remaining, filterName, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:20px;overflow-y:auto;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ffaa00;font-size:14px;font-weight:bold;margin-bottom:12px;';
  title.innerText = '🔍 ' + (filterName ? '「' + filterName + '」を' : 'カードを') + '選択（残り' + remaining + '枚）';
  overlay.appendChild(title);

  // 手札セクション
  const handCards = candidates.filter(c => c.source === 'hand');
  const trashCards = candidates.filter(c => c.source === 'trash');

  function addSection(label, cards) {
    if (cards.length === 0) return;
    const secLabel = document.createElement('div');
    secLabel.style.cssText = 'color:#aaa;font-size:11px;margin:8px 0 4px;';
    secLabel.innerText = label + '（' + cards.length + '枚）';
    overlay.appendChild(secLabel);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:8px;';
    cards.forEach(entry => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'text-align:center;cursor:pointer;border:2px solid #333;border-radius:8px;padding:4px;transition:all 0.2s;';
      const imgSrc = entry.card.imgSrc || entry.card.imageUrl || '';
      wrap.innerHTML = (imgSrc ? '<img src="' + imgSrc + '" style="width:55px;height:77px;object-fit:cover;border-radius:4px;">' : '')
        + '<div style="color:#fff;font-size:9px;margin-top:2px;">' + entry.card.name + '</div>';
      wrap.onmouseenter = () => { wrap.style.borderColor = '#ffaa00'; };
      wrap.onmouseleave = () => { wrap.style.borderColor = '#333'; };
      wrap.onclick = () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        callback(entry);
      };
      row.appendChild(wrap);
    });
    overlay.appendChild(row);
  }

  addSection('📋 手札', handCards);
  addSection('🗑 トラッシュ', trashCards);

  const cancelBtn = document.createElement('button');
  cancelBtn.style.cssText = 'margin-top:12px;background:#333;color:#fff;border:1px solid #666;padding:8px 20px;border-radius:8px;font-size:12px;cursor:pointer;';
  cancelBtn.innerText = 'キャンセル';
  cancelBtn.onclick = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback(null);
  };
  overlay.appendChild(cancelBtn);
  document.body.appendChild(overlay);
}

// ===== 公開API =====

// トリガー発生時に呼ぶ
export function triggerEffect(triggerCode, sourceCard, sourceSide, context, callback) {
  clearQueue();
  scanTriggers(triggerCode, sourceCard, sourceSide, context);

  const waiting = _effectQueue.filter(e => e.status === 'waiting');

  if (waiting.length === 0) { callback && callback(); return; }
  processQueue(context, callback);
}

// カードがキーワード効果を持っているか（_permEffects のみ参照）
export function cardHasKeyword(card, keywordCode) {
  if (!card) return false;
  if (card._permEffects) {
    const flagMap = {
      'blocker': 'blocker', '【ブロッカー】': 'blocker',
      'rush': 'rush', '【速攻】': 'rush',
      'piercing': 'piercing', '【突進】': 'piercing',
      'penetrate': 'penetrate', '【貫通】': 'penetrate',
      'jamming': 'jamming', '【ジャミング】': 'jamming',
      'reboot': 'reboot', '【再起動】': 'reboot',
    };
    const flag = flagMap[keywordCode];
    if (flag && card._permEffects[flag]) return true;
  }
  return false;
}

// カードがそのトリガーのレシピを持っているか（top-level または evo_source）
// triggerCode: 'on_play' / 'on_evolve' / 'on_attack' / 'on_attack_end' / 'security' 等
export function hasRecipeTrigger(card, triggerCode) {
  if (!card || !card.recipe) return false;
  try {
    const r = typeof card.recipe === 'string'
      ? JSON.parse(card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, ''))
      : card.recipe;
    if (r[triggerCode]) return true;
    if (r.evo_source && r.evo_source[triggerCode]) return true;
    return false;
  } catch (_) { return false; }
}

// recipe を安全にパースして返す（失敗時 null）
function _parseCardRecipe(card) {
  if (!card || !card.recipe) return null;
  try {
    const raw = typeof card.recipe === 'string'
      ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) { return null; }
}

// recipe の summon_cost（条件付き登場コスト軽減）を反映した実効登場コスト。
// summon_cost: [{ condition?, value }] — condition 成立分の value を合算して減算。
// 例: ブラックウォーグレイモン「DP10000以上の相手がいる間、登場コスト-6」
export function getEffectivePlayCost(card, bs, side) {
  const base = (card && card.playCost != null) ? card.playCost : 0;
  if (base <= 0) return base;
  const recipe = _parseCardRecipe(card);
  const list = recipe && recipe.summon_cost;
  if (!Array.isArray(list) || list.length === 0) return base;
  let reduction = 0;
  for (const entry of list) {
    if (!entry) continue;
    if (entry.condition) {
      const conds = parseRecipeCondition(entry.condition);
      if (!checkConditions(conds, card, bs, side || 'player')) continue;
    }
    if (entry.per_count && entry.ref) {
      const count = getRefSourceCountDirect(entry.ref, card, bs, side || 'player', entry.ref_filter, entry.ref_state);
      const perUnit = parseInt(entry.value, 10) || 1;
      reduction += perUnit * Math.floor(count / entry.per_count);
    } else {
      reduction += parseInt(entry.value, 10) || 0;
    }
  }
  return Math.max(0, base - reduction);
}

// recipe の alt_evolve（進化条件を無視する代替進化）が baseCard に対して成立するか。
// alt_evolve: [{ condition?, base_filter?:{name?,color?,lv?}, ignore_cond?, cost? }]
// 成立すれば { cost } を返す（進化条件チェックを飛ばしてそのコストで進化可）。不成立は null。
// 例: ベルゼブモン「トラッシュ10枚以上の間、インプモンは進化条件無視・コスト4で進化」
export function getAltEvolve(evoCard, baseCard, bs, side) {
  if (!evoCard || !baseCard) return null;
  const recipe = _parseCardRecipe(evoCard);
  const list = recipe && recipe.alt_evolve;
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const entry of list) {
    if (!entry) continue;
    // 全体条件（自分のトラッシュN枚以上 等）
    if (entry.condition) {
      const conds = parseRecipeCondition(entry.condition);
      if (!checkConditions(conds, evoCard, bs, side || 'player')) continue;
    }
    // 進化元フィルタ（名前/色/Lv） — base_filter オブジェクト形式
    const bf = entry.base_filter || {};
    if (bf.name && !String(baseCard.name || '').includes(bf.name)) continue;
    if (bf.color && !String(baseCard.color || '').includes(bf.color)) continue;
    if (bf.lv != null && (parseInt(baseCard.level) || 0) !== bf.lv) continue;
    // 進化元フィルタ — エディタ形式（条件文字列を進化元カードに対し評価）
    //   when（条件2つ目）/ base_cond で「cond_name_contains:インプモン」等を指定
    const baseCond = entry.when || entry.base_cond;
    if (baseCond) {
      const bc = parseRecipeCondition(baseCond);
      if (!checkConditions(bc, baseCard, bs, side || 'player')) continue;
    }
    // 進化コスト: cost > value > 元カードの進化コスト の優先順
    const _c = (entry.cost != null) ? entry.cost
             : (entry.value != null) ? entry.value
             : (evoCard.evolveCost || 0);
    return { cost: parseInt(_c, 10) || 0 };
  }
  return null;
}

// 進化コスト確定前に「〜するとき、このテイマーをレストさせることでコストを-N」のような
// テイマー反応を確認する（before_evolve トリガー）。
// before_evolve: [{ trigger_conditions?, condition?, cost?, value }]
// trigger_conditions は進化先カード(evoCard=手札のカード)に対して評価する
// （タイガ BT2-088「手札の名称に『ティラノモン』を含むデジモンカードに進化するとき」等）。
// condition はテイマー自身の発動条件（during_own_turn 等）。
// callback(discountAmount) — 0 なら適用なし。プレイヤー確認はUIで行う（AIは自動承諾）。
export function checkBeforeEvolveDiscount(evoCard, bs, side, callback) {
  const finish = (amount) => { try { callback(amount || 0); } catch (_) {} };
  if (!bs || !evoCard) { finish(0); return; }
  const sidePl = bs[side];
  if (!sidePl) { finish(0); return; }
  const cards = [...(sidePl.battleArea || []), ...(sidePl.tamerArea || [])].filter(c => c);
  let found = null;
  for (const card of cards) {
    if (!card.recipe) continue;
    try {
      const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const list = r.before_evolve;
      if (!Array.isArray(list)) continue;
      for (const step of list) {
        if (!step) continue;
        if (Array.isArray(step.trigger_conditions) && step.trigger_conditions.length > 0) {
          const ok = step.trigger_conditions.every((cs) => {
            const conds = parseRecipeCondition(String(cs));
            return checkConditions(conds, evoCard, bs, side);
          });
          if (!ok) continue;
        }
        if (step.condition) {
          const conds = parseRecipeCondition(step.condition);
          if (!checkConditions(conds, card, bs, side)) continue;
        }
        // コストfeasibility: 自身をレストするコストなのに既にレスト中なら不可
        if (Array.isArray(step.cost)) {
          const infeasible = step.cost.some((c) => c && c.action === 'rest' && (c.target === 'self' || !c.target) && card.suspended);
          if (infeasible) continue;
        }
        found = { card, step };
        break;
      }
    } catch (_) {}
    if (found) break;
  }
  if (!found) { finish(0); return; }
  const { card, step } = found;
  const amount = parseInt(step.value, 10) || 0;
  const hasCost = Array.isArray(step.cost) && step.cost.length > 0;
  const applyDiscount = () => {
    if (hasCost) {
      step.cost.forEach((c) => { if (c && c.action === 'rest') card.suspended = true; });
    }
    finish(amount);
  };
  if (side !== 'player') {
    // AI: 自動的にコスト軽減を採用
    applyDiscount();
    return;
  }
  const msg = 'このテイマーをレストさせることで、進化コストを-' + amount + 'しますか？';
  if (typeof showConfirmDialog === 'function') {
    showConfirmDialog(card, msg, (yes) => { if (yes) applyDiscount(); else finish(0); });
  } else {
    applyDiscount();
  }
}

// stack 内の進化元カードに該当トリガーのレシピがあるか
export function hasEvoStackTrigger(card, triggerCode) {
  if (!card || !Array.isArray(card.stack)) return false;
  return card.stack.some(s => {
    if (!s || !s.recipe) return false;
    try {
      const r = typeof s.recipe === 'string'
        ? JSON.parse(s.recipe.replace(/[\x00-\x1F\x7F]\s*/g, ''))
        : s.recipe;
      return !!(r.evo_source && r.evo_source[triggerCode]);
    } catch (_) { return false; }
  });
}
