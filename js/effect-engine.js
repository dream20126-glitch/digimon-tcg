// 効果エンジン v2（効果辞書 + 効果アクション辞書 参照）
import { gasGet } from './firebase-config.js';
import { getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

// ===== 辞書データ =====
let _triggerDict = [];  // 効果辞書（トリガー定義）
let _actionDict = [];   // 効果アクション辞書（アクション・対象・条件・持続・判定）

// ===== 効果キュー =====
let _effectQueue = [];

// ===== 辞書読み込み =====
export async function loadAllDictionaries() {
  try {
    const [triggers, actions] = await Promise.all([
      gasGet('getEffectDictionary'),
      gasGet('getEffectActionDictionary')
    ]);
    _triggerDict = triggers || [];
    _actionDict = actions || [];
  } catch(e) {
    console.error('[EffectEngine] 辞書読み込みエラー:', e);
  }
}

// ===== 辞書検索ヘルパー =====

// 効果テキストからトリガーを検索
function findTrigger(effectText) {
  for (const entry of _triggerDict) {
    const keywords = String(entry['キーワード']).split(',');
    for (const kw of keywords) {
      if (effectText.includes(kw.trim())) {
        return { keyword: kw.trim(), code: (entry['処理コード']||'').trim(), duration: entry['持続時間'], entry };
      }
    }
  }
  // 辞書に無いトリガーのハードコード救済
  if (/【?ブロックされた(時|とき)】?/.test(effectText)) {
    return { keyword: 'ブロックされた時', code: 'when_blocked', duration: '即時', entry: {} };
  }
  if (/【?アタックされた(時|とき)】?/.test(effectText)) {
    return { keyword: 'アタックされた時', code: 'when_attacked', duration: '即時', entry: {} };
  }
  return null;
}

// 効果テキストからアクションを検索（複数ヒット可能）
// アクション実行対象外のプレフィックス（対象・条件・持続・判定・制限はアクションではない）
const NON_ACTION_PREFIXES = ['target_', 'cond_', 'dur_', 'judge_', 'limit_', 'per_count'];

// キーワードを効果テキストから部分一致で検索
// 戻り値: マッチ位置(idx) or -1
function fuzzyIndexOf(effectText, searchKey) {
  // 1. 完全部分一致（従来通り）
  const exact = effectText.indexOf(searchKey);
  if (exact !== -1) return exact;

  // 3文字以下は完全一致のみ
  if (searchKey.length <= 3) return -1;

  // 2. 活用対応: キーワード末尾を1文字だけ削って再検索（5文字以上のみ）
  //    「手札を捨てる」→「手札を捨て」でもヒット
  //    末尾が記号(+,-,/等)の場合は削らない（「メモリーを-」→「メモリーを」の誤マッチ防止）
  const lastChar = searchKey[searchKey.length - 1];
  if (searchKey.length >= 5 && /[ぁ-んァ-ヴー一-龥々a-zA-Z]/.test(lastChar)) {
    const shorter = searchKey.substring(0, searchKey.length - 1);
    const idx = effectText.indexOf(shorter);
    if (idx !== -1) return idx;
  }

  // 3. 区切り文字対応: 「/」で区切られたパーツが全て存在すればヒット
  //    「デッキ/オープン」→「デッキ」AND「オープン」
  if (searchKey.includes('/')) {
    const parts = searchKey.split('/').filter(p => p.length >= 2);
    if (parts.length >= 2 && parts.every(p => effectText.includes(p))) {
      return effectText.indexOf(parts[0]);
    }
  }

  // 4. 連続カタカナ語の自動分割: 全分割点を試して両側が存在すればヒット
  //    「デッキオープン」→「デッキ」+「オープン」
  if (/^[ァ-ヴー]+$/.test(searchKey) && searchKey.length >= 6) {
    for (let i = 3; i <= searchKey.length - 3; i++) {
      const left = searchKey.substring(0, i);
      const right = searchKey.substring(i);
      if (effectText.includes(left) && effectText.includes(right)) {
        return effectText.indexOf(left);
      }
    }
  }

  // 5. 助詞挿入許容: 「Xを[動詞]」パターンで間に他の語句が入っても両方が順序通りに出現すればヒット
  //    「進化元を破棄」→「相手の進化元を選んで破棄する」でもヒット
  //    「手札を捨てる」→「手札を1枚捨てる」等でもヒット
  const particleSplit = searchKey.match(/^(.{2,}?)(を|に|で|から|まで|へ)(.{2,})$/);
  if (particleSplit) {
    const before = particleSplit[1];
    const after = particleSplit[3];
    const beforeIdx = effectText.indexOf(before);
    if (beforeIdx !== -1) {
      const afterIdx = effectText.indexOf(after, beforeIdx + before.length);
      // 間に挟まる文字数が20文字以内なら同一効果と判断
      if (afterIdx !== -1 && (afterIdx - beforeIdx - before.length) <= 20) {
        return beforeIdx;
      }
    }
  }

  return -1;
}

function findActions(effectText) {
  const results = [];
  for (const entry of _actionDict) {
    const code = (entry['アクションコード']||'').trim();
    if (!code) continue;
    // アクション以外（対象・条件・持続・判定）はスキップ
    if (NON_ACTION_PREFIXES.some(p => code.startsWith(p))) continue;
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) {
      const trimmed = kw.trim();
      if (!trimmed) continue;
      // {N}プレースホルダを除去してマッチ（DPを+{N} → DPを+ で検索）
      const searchKey = trimmed.replace(/\{N\}/, '');
      const idx = fuzzyIndexOf(effectText, searchKey);
      if (idx !== -1) {
        // 数値抽出: キーワード直後 or 直前から探す
        let value = null;
        // 1. 直後の数字 (DPを+3000, メモリーを+1 等)
        const afterText = effectText.substring(idx + searchKey.length);
        const afterMatch = afterText.match(/^(\d+)/);
        if (afterMatch) {
          value = parseInt(afterMatch[1]);
        } else {
          // 2. 直前の数字 (3枚オープン, 2体消滅 等)
          const beforeText = effectText.substring(Math.max(0, idx - 8), idx);
          const beforeMatch = beforeText.match(/(\d+)\s*[枚体回]?\s*$/);
          if (beforeMatch) {
            value = parseInt(beforeMatch[1]);
          }
        }
        results.push({ keyword: trimmed, code, value, index: idx, entry });
        break; // 同じアクションの別キーワードは不要
      }
    }
  }
  // テキスト内の出現順にソート
  results.sort((a, b) => a.index - b.index);
  return results;
}

// 効果テキストから対象を検索
function findTarget(effectText) {
  // 長いキーワードを先にマッチさせる（「自分のデジモン全て」を「自分のデジモン」より先に）
  const targetEntries = _actionDict
    .filter(e => e['アクションコード'] && e['アクションコード'].startsWith('target_'))
    .sort((a, b) => String(b['アクション名']).length - String(a['アクション名']).length);

  for (const entry of targetEntries) {
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) {
      const trimmed = kw.trim();
      if (fuzzyIndexOf(effectText, trimmed) !== -1) {
        const m = effectText.match(new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d*)'));
        const count = m && m[1] ? parseInt(m[1]) : null;
        return { code: (entry['アクションコード']||'').trim(), count, entry };
      }
    }
  }
  return null;
}

// 効果テキストから条件を検索（効果アクション辞書 + 効果辞書の両方を検索）
function findConditions(effectText) {
  const results = [];

  // 効果アクション辞書から条件系を検索
  for (const entry of _actionDict) {
    const code = (entry['アクションコード']||'').trim();
    if (!code || !code.startsWith('cond_')) continue;
    const found = matchConditionEntry(effectText, code, String(entry['アクション名']), entry);
    if (found) results.push(found);
  }

  // 効果辞書から per_count を検索
  for (const entry of _triggerDict) {
    const code = entry['処理名'];
    if (code !== 'per_count') continue;
    const keyword = entry['キーワード'] || '';
    const found = matchConditionEntry(effectText, code, keyword, entry);
    if (found) {
      // per_count: 辞書の「備考」列から参照先マップを読む
      if (code === 'per_count') {
        found.refSource = detectPerCountSource(effectText, entry);
      }
      results.push(found);
    }
  }

  // 辞書の表記ゆれ救済（ひらがな/漢字・類義語）
  const hasCode = (c) => results.some(r => r.code === c);
  // 進化元を持たない / 進化元をもたない
  if (!hasCode('cond_no_evo') && /進化元を(持|も)たない/.test(effectText)) {
    results.push({ code: 'cond_no_evo', keyword: '進化元をもたない', value: null });
  }
  // 進化元を N 枚以上持つ / もつ
  if (!hasCode('cond_has_evo') && /進化元を(\d+)枚以上(持|も)つ/.test(effectText)) {
    const m = effectText.match(/進化元を(\d+)枚以上(持|も)つ/);
    results.push({ code: 'cond_has_evo', keyword: '進化元を持つ', value: m ? parseInt(m[1]) : 1 });
  }
  // 「～がいるとき / ～がいる間 / ～がいる場合」 → cond_exists
  if (!hasCode('cond_exists') && /(いるとき|いる間|がいる(?![ぁ-ん])|いる場合)/.test(effectText)) {
    results.push({ code: 'cond_exists', keyword: 'いる間', value: null });
  }

  return results;
}

// 条件エントリのマッチング共通処理
function matchConditionEntry(effectText, code, keywordsStr, entry) {
  const keywords = keywordsStr.split(',');
  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // {N}プレースホルダを数値キャプチャに置換
    let pattern = escaped.replace(/\\{N\\}/, '(\\d+)');
    // 「を」と「枚」の間、「DP」と「以」の間等に数値が入る
    pattern = pattern
      .replace(/(を)(枚)/, '$1(\\d+)$2')
      .replace(/(DP)(以)/, '$1(\\d+)$2')
      .replace(/(Lv\.)(以)/, '$1(\\d+)$2')
      .replace(/(コスト)(以)/, '$1(\\d+)$2');
    const regex = new RegExp(pattern);
    const m = effectText.match(regex);
    if (m) {
      const value = m[1] ? parseInt(m[1]) : null;
      return { code, value, entry };
    }
  }
  return null;
}

// 「～ごとに」の参照先をテキストから判定（効果辞書の「備考」列を参照）
function detectPerCountSource(effectText, entry) {
  // 効果辞書の「備考」列からマップを読む
  // 形式: "進化元=evo_source,手札=hand,トラッシュ=trash,セキュリティ=security"
  const mapStr = entry['備考'] || '';
  if (!mapStr) return 'evo_source';

  const pairs = mapStr.split(',');
  for (const pair of pairs) {
    const [jpKeyword, code] = pair.split('=').map(s => s.trim());
    if (jpKeyword && code && effectText.includes(jpKeyword)) {
      return code;
    }
  }
  return 'evo_source'; // デフォルト
}

// 効果テキストから持続を検索
function findDuration(effectText) {
  for (const entry of _actionDict) {
    if ((entry['アクションコード']||'').trim() && (entry['アクションコード']||'').trim().startsWith('dur_')) {
      const keywords = String(entry['アクション名']).split(',');
      for (const kw of keywords) {
        if (fuzzyIndexOf(effectText, kw.trim()) !== -1) {
          return { code: (entry['アクションコード']||'').trim(), entry };
        }
      }
    }
  }
  // 持続キーワードのハードコード救済（辞書の表記ゆれ対応）
  // スプレッドシート側の表記に依存せず、よくある言い回しを直接検出
  if (/次の自分(の)?ターン(終了時|終了|の終わり)まで/.test(effectText)) {
    return { code: 'dur_next_own_turn', entry: {} };
  }
  if (/次の相手(の)?ターン(終了時|終了|の終わり)まで/.test(effectText)) {
    return { code: 'dur_next_opp_turn', entry: {} };
  }
  if (/(このターンの間|ターン終了(時)?まで|ターンの終わりまで)/.test(effectText)) {
    return { code: 'dur_this_turn', entry: {} };
  }
  return null;
}

// 効果テキストから回数制限を検索
function findLimit(effectText) {
  for (const entry of _actionDict) {
    if ((entry['アクションコード']||'').trim() === 'limit_once_per_turn') {
      const keywords = String(entry['アクション名']).split(',');
      for (const kw of keywords) {
        if (effectText.includes(kw.trim())) return true;
      }
    }
  }
  return false;
}

// 任意効果かチェック
function isOptional(effectText) {
  for (const entry of _actionDict) {
    if ((entry['アクションコード']||'').trim() === 'judge_optional') {
      const keywords = String(entry['アクション名']).split(',');
      for (const kw of keywords) {
        if (effectText.includes(kw.trim())) return true;
      }
    }
  }
  return false;
}

// 「その後」で分割
function splitAfter(effectText) {
  for (const entry of _actionDict) {
    if ((entry['アクションコード']||'').trim() === 'judge_after') {
      const keywords = String(entry['アクション名']).split(',');
      for (const kw of keywords) {
        const idx = effectText.indexOf(kw.trim());
        if (idx !== -1) {
          return {
            main: effectText.substring(0, idx).trim(),
            after: effectText.substring(idx + kw.trim().length).trim()
          };
        }
      }
    }
  }
  return { main: effectText, after: null };
}

// アクションコードからUI情報を取得
function getActionUI(actionCode) {
  for (const entry of _actionDict) {
    if ((entry['アクションコード']||'').trim() === actionCode) return entry;
  }
  return null;
}

// ===== 効果テキスト解析 =====

// カードの効果テキスト全体を解析して効果ブロックに分解
export function parseCardEffect(card, effectField) {
  const text = effectField || card.effect;
  if (!text || text === 'なし') return [];

  const blocks = [];
  // 自己参照（「このカードの【メイン】効果」等）の【】は分割対象にしない
  // → 先に【】を外して通常の文字列化し、findActionsで「メイン効果を発揮」等とマッチさせる
  let preproc = text.replace(/このカードの【メイン】効果/g, 'このカードのメイン効果');
  // キーワード効果・制限修飾子の【】はトリガーではないので、分割前にエスケープ
  const keywordBrackets = /【(ターンに[1一]回|ブロッカー|速攻|突進|貫通|ジャミング|再起動|Sアタック\+\d+|セキュリティアタック\+\d+)】/g;
  const normalized = preproc.replace(keywordBrackets, (m, p1) => '〔' + p1 + '〕');
  // 【】で始まるブロックに分割
  const parts = normalized.split(/(?=【)/);
  for (const part of parts) {
    // エスケープを元に戻す
    const restored = part.replace(/〔([^〕]+)〕/g, '【$1】');
    const trimmed = restored.trim();
    if (!trimmed) continue;
    const block = analyzeBlock(trimmed);
    if (block) blocks.push(block);
  }
  return blocks;
}

// 1つの効果ブロックを解析
function analyzeBlock(text) {
  const trigger = findTrigger(text);
  if (!trigger) {
    // トリガーなし = キーワード効果の可能性
    const actions = findActions(text);
    if (actions.length > 0) {
      return { raw: text, trigger: null, actions, isKeyword: true };
    }
    return null;
  }

  // トリガー以降のテキスト
  const bodyStart = text.indexOf(trigger.keyword) + trigger.keyword.length;
  // 【】の閉じ括弧の後から
  const closeBracket = text.indexOf('】', bodyStart);
  const body = closeBracket !== -1 ? text.substring(closeBracket + 1).trim() : text.substring(bodyStart).trim();

  // 「その後」で分割
  const { main: mainText, after: afterText } = splitAfter(body);

  // コスト抽出（「ことで」の前）
  let costText = null;
  let actionText = mainText;
  const kotoDeIdx = mainText.indexOf('ことで');
  if (kotoDeIdx !== -1) {
    costText = mainText.substring(0, kotoDeIdx);
    actionText = mainText.substring(kotoDeIdx + 3).trim();
  }

  const costActions = costText ? findActions(costText) : null;
  const costTgt = costText ? findTarget(costText) : null;
  const mainActions = findActions(actionText);
  const mainTarget = findTarget(body);

  return {
    raw: text,
    trigger,
    isOptional: isOptional(mainText),
    cost: costActions,
    costTarget: costTgt,
    actions: mainActions,
    target: mainTarget,
    conditions: findConditions(body),
    duration: findDuration(body),
    limit: findLimit(text),
    afterActions: afterText ? findActions(afterText) : [],
    afterTarget: afterText ? findTarget(afterText) : null,
  };
}

// ===== 効果キュー管理 =====

// キューをクリア
function clearQueue() { _effectQueue = []; }

// キューにエントリを追加
function addToQueue(card, block, side, priority, actualSide) {
  const triggerCode = block.trigger?.code;
  // 同じカード+同じトリガーが既にキューにあればスキップ（参照 or カード名+番号で判定）
  const isDuplicate = _effectQueue.some(e =>
    e.block.trigger?.code === triggerCode &&
    (e.card === card || (e.card.name === card.name && e.card.cardNo === card.cardNo))
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
function processQueue(context, onComplete) {
  const next = _effectQueue.find(e => e.status === 'waiting');
  if (!next) {
    clearQueue();
    checkPendingDestroys(context);
    // メモリー超過チェック
    if (context._memoryOverflow) {
      context._memoryOverflow = false;
      if (context._parentContext) context._parentContext._memoryOverflow = false;
      // アタック中の場合はバトル完了後にターン終了する（フラグだけ立てる）
      context.bs._pendingTurnEnd = true;
      context.addLog('💾 メモリーが相手側へ（アタック終了後にターン終了）');
      context.updateMemGauge();
      // コールバックは実行する（バトル/セキュリティチェックを続行）
    }
    onComplete && onComplete();
    return;
  }

  next.status = 'processing';
  executeQueueEntry(next, context, () => {
    next.status = 'completed';
    sortQueue();
    processQueue(context, onComplete);
  });
}

// キューエントリを実行
function executeQueueEntry(entry, context, callback) {
  const { card, block, side } = entry;
  // sideを実際のplayer/aiに変換
  const actualSide = entry.actualSide || (side === 'turnPlayer' ? (context.bs.isPlayerTurn ? 'player' : 'ai') : (context.bs.isPlayerTurn ? 'ai' : 'player'));
  const ctx = { ...context, card, side: actualSide, block, _parentContext: context };

  // 効果発動 → カード&効果テキストを数秒表示してから実行
  function executeWithAnnounce() {
    ctx.addLog('⚡ 「' + card.name + '」の効果発動');
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
      const recipe = getRecipeForTrigger(card, block.trigger ? block.trigger.code : null);
      if (recipe) {
        runRecipe(recipe, ctx, wrappedCallback);
      } else {
        executeCostAndActions(block, ctx, () => executeAfterActions(block, ctx, wrappedCallback));
      }
    });
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

// deck_openがある場合、配置系サブ動作はドラッグUIで処理するのでスキップ
const DECK_OPEN_SUB_ACTIONS = ['add_to_hand', 'return_deck', 'return_deck_bottom', 'return_deck_top', 'add_to_evo_source'];

function runActionList(actions, defaultTarget, ctx, callback) {
  // deck_openがあればサブ動作を除外
  const hasDeckOpen = actions.some(a => a.code === 'deck_open');
  const filtered = hasDeckOpen ? actions.filter(a => !DECK_OPEN_SUB_ACTIONS.includes(a.code)) : actions;
  // per_count倍率を適用
  const appliedActions = applyPerCountMultiplier(filtered, ctx);
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
function getRefSourceCountDirect(refSource, card, bs, side) {
  const player = side === 'player' ? bs.player : bs.ai;
  switch (refSource) {
    case 'evo_source': return card && card.stack ? card.stack.length : 0;
    case 'hand': return player.hand.length;
    case 'trash': return player.trash.length;
    case 'security': return player.security.length;
    case 'battle_area': return player.battleArea.filter(c => c !== null).length;
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

const EFFECT_RUNNERS = {
  // 数値ポップアップ（DP増減など）: 画面中央に+N/-Nを表示
  "数値ポップアップ": function(opts, cb) {
    showDpPopup(opts.value || 0);
    cb();
  },

  // 消滅演出: シェイク→フラッシュ→パーティクル→DESTROYED
  "消滅演出": function(opts, cb) {
    if (opts.ctx && opts.ctx.showDestroyEffect && opts.card) {
      opts.ctx.showDestroyEffect(opts.card, cb);
    } else { cb(); }
  },

  // カード表示演出: ドローしたカードを表示（Lv6+は前兆演出付き）
  "カード表示演出": function(opts, cb) {
    if (opts.ctx && opts.ctx.showDrawEffect && opts.cards && opts.cards.length > 0) {
      let idx = 0;
      function showNext() {
        if (idx >= opts.cards.length) { cb(); return; }
        const c = opts.cards[idx++];
        const isLv6 = parseInt(c.level) >= 6;
        opts.ctx.showDrawEffect(c, isLv6, showNext);
      }
      showNext();
    } else { cb(); }
  },

  // 移動演出: カードが目的地に飛ぶ（簡易）
  "移動演出": function(opts, cb) { cb(); },

  // 回転演出: カードが回転（レスト/アクティブ）
  "回転演出": function(opts, cb) { cb(); },

  // シールド演出: ブロッカーのシールドエフェクト
  "シールド演出": function(opts, cb) { cb(); },

  // 状態付与演出: 🔒/❌マーク表示
  "状態付与演出": function(opts, cb) { cb(); },

  // ゲージ移動: メモリーゲージのアニメーション
  "ゲージ移動": function(opts, cb) {
    if (opts.ctx && opts.ctx.updateMemGauge) opts.ctx.updateMemGauge();
    cb();
  },

  // ダイアログ: 確認ダイアログ表示
  "ダイアログ": function(opts, cb) { cb(); },

  // セキュリティ追加演出: カードがセキュリティに飛ぶ
  "セキュリティ追加演出": function(opts, cb) { cb(); },

  // セキュリティ除去演出: セキュリティからトラッシュへ
  "セキュリティ除去演出": function(opts, cb) { cb(); },

  // テキスト表示: 画面中央にテキスト表示
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

  // バリア演出: ジャミングのバリア表示
  "バリア演出": function(opts, cb) { cb(); },

  // カードめくり演出: 裏面で配布→一斉にフリップ（deck_open用）
  "カードめくり演出": function(opts, cb) {
    // showDeckOpenUI内で使用される — deck_openのrunOneActionから直接呼ばれる
    cb();
  },

  // セキュリティチェック演出: VS表示
  "セキュリティチェック演出": function(opts, cb) { cb(); },

  // 登場演出: DIGITAL APPEAR
  "登場演出": function(opts, cb) { cb(); },
};

// アクションコードから辞書のUI情報を使って演出を実行
// 戻り値: true=演出実行した, false=演出なし
function playEffect(actionCode, options, callback) {
  const ui = getActionUI(actionCode);
  if (!ui) { callback(); return false; }
  const typeName = ui['演出タイプ'];
  if (!typeName || typeName === 'なし') { callback(); return false; }
  const runner = EFFECT_RUNNERS[typeName];
  if (!runner) { callback(); return false; }

  // 辞書から枠色を取得してoptionsに追加
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

// 後方互換: getEffectType（既存のbattle.jsからの参照用）
function getEffectType(actionCode) {
  const ui = getActionUI(actionCode);
  if (!ui) return null;
  const typeName = ui['演出タイプ'];
  return typeName && typeName !== 'なし' ? typeName : null;
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

  switch (action.code) {
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
      // 演出を辞書の演出タイプで実行
      if (drawn.length > 0) {
        playEffect(action.code, { cards: drawn, ctx }, () => { ctx.renderAll(true); callback(); });
      } else { ctx.renderAll(); callback(); }
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
      const dpTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) dpTargets.push(i); }
      if(dpTargets.length === 0) { callback(); break; }
      if(ctx.side === 'ai') {
        const tgt = opponent.battleArea[dpTargets[0]];
        addBuff(tgt, 'dp_minus', val, ctx);
        ctx.addLog('💥 ' + tgt.name + ' DP-' + val + ' → ' + tgt.dp);
        playEffect(action.code, { value: -val, ctx }, () => {});
        if(tgt.dp <= 0) tgt._pendingDestroy = true;
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 DP-' + val + 'の対象を選んでください');
      showTargetSelection('ai', dpTargets, null, uiColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          const tgt = opponent.battleArea[selectedIdx];
          sendEffectResult(tgt, 'dp_minus', ctx);
          addBuff(tgt, 'dp_minus', val, ctx);
          ctx.addLog('💥 ' + tgt.name + ' DP-' + val + ' → ' + tgt.dp);
          playEffect(action.code, { value: -val, ctx }, () => {});
          if(tgt.dp <= 0) tgt._pendingDestroy = true;
          ctx.renderAll();
        }
        callback();
      });
      break;
    }
    case 'memory_plus': {
      const val = action.value || 1;
      if (ctx.side === 'player') ctx.bs.memory += val; else ctx.bs.memory -= val;
      ctx.addLog('💎 ' + sideLabel + 'のメモリー+' + val);
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
      const destroyTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) destroyTargets.push(i); }
      if(destroyTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      // 枠色を辞書から取得
      const borderColor = uiColor;
      if(ctx.side === 'ai') {
        const card = opponent.battleArea[destroyTargets[0]];
        doDestroy(opponent, destroyTargets[0], ctx);
        playEffect(action.code, { card, ctx }, callback);
        break;
      }
      ctx.addLog('🎯 消滅させる対象を選んでください');
      showTargetSelection('ai', destroyTargets, null, borderColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          const card = opponent.battleArea[selectedIdx];
          doDestroy(opponent, selectedIdx, ctx);
          playEffect(action.code, { card, ctx }, callback); // → showDestroyEffect → fx_destroy送信
        } else { callback(); }
      });
      break;
    }
    case 'bounce': {
      const bounceTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) bounceTargets.push(i); }
      if(bounceTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      const bounceColor = uiColor;
      if(ctx.side === 'ai') {
        doBounce(opponent, bounceTargets[0], ctx);
        callback(); break;
      }
      ctx.addLog('🎯 手札に戻す対象を選んでください');
      showTargetSelection('ai', bounceTargets, null, bounceColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          sendEffectResult(opponent.battleArea[selectedIdx], 'bounce', ctx);
          doBounce(opponent, selectedIdx, ctx);
        }
        callback();
      });
      break;
    }
    case 'active': {
      if (ctx.card) { ctx.card.suspended = false; ctx.addLog('🔄 「' + ctx.card.name + '」アクティブ'); }
      ctx.renderAll();
      callback();
      break;
    }
    case 'recover': {
      const n = action.value || 1;
      for (let i = 0; i < n; i++) {
        if (player.deck.length > 0) { player.security.push(player.deck.splice(0, 1)[0]); ctx.addLog('🛡 セキュリティ+1'); }
      }
      ctx.renderAll();
      callback();
      break;
    }
    case 'security_trash_top': {
      const n = action.value || 1;
      for (let i = 0; i < n; i++) {
        if (opponent.security.length > 0) { opponent.trash.push(opponent.security.shift()); ctx.addLog('🛡 セキュリティ破棄'); }
      }
      ctx.renderAll();
      callback();
      break;
    }
    case 'evo_discard':
    case 'evo_discard_bottom': {
      // 進化元を持つ相手デジモンを列挙
      const evoTargets = [];
      for (let i = 0; i < opponent.battleArea.length; i++) {
        if (opponent.battleArea[i] && opponent.battleArea[i].stack && opponent.battleArea[i].stack.length > 0) evoTargets.push(i);
      }
      if (evoTargets.length === 0) {
        ctx.addLog('⚠ 進化元を持つ対象がいません');
        showEffectFailed('効果を発動できませんでした', callback);
        break;
      }
      const n = action.value || 1;
      const discardFromTarget = (tgt) => {
        for (let i = 0; i < n && tgt.stack.length > 0; i++) {
          const removed = action.code === 'evo_discard_bottom' ? tgt.stack.pop() : tgt.stack.shift();
          opponent.trash.push(removed);
          ctx.addLog('📤 「' + tgt.name + '」の進化元を破棄');
        }
      };
      // AIは自動選択、プレイヤーは対象選択UI
      if (ctx.side === 'ai') {
        discardFromTarget(opponent.battleArea[evoTargets[0]]);
        ctx.renderAll();
        callback();
        break;
      }
      ctx.addLog('🎯 進化元を破棄する対象を選んでください');
      showTargetSelection('ai', evoTargets, null, uiColor, (selectedIdx) => {
        if (selectedIdx !== null) {
          discardFromTarget(opponent.battleArea[selectedIdx]);
          ctx.renderAll();
        }
        callback();
      });
      break;
    }
    case 'cant_attack_block': {
      // 持続時間
      const cabDur = (block && block.duration && block.duration.code) || 'dur_this_turn';
      // 条件: 進化元を持たない 等
      const cabHasNoEvoCond = block && block.conditions && block.conditions.some(c => c.code === 'cond_no_evo');
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
      const applyCab = (tgt) => {
        tgt.cantAttack = true; tgt.cantBlock = true;
        addBuffDirect(tgt, 'cant_attack_block', 0, cabDur, ctx);
        ctx.addLog('🔒 「' + tgt.name + '」アタック・ブロック不可（' + cabDur + '）');
      };
      if (ctx.side === 'ai') {
        applyCab(opponent.battleArea[cabTargets[0]]);
        ctx.renderAll();
        callback();
        break;
      }
      ctx.addLog('🎯 アタック・ブロック不可にする対象を選んでください');
      showTargetSelection('ai', cabTargets, null, uiColor, (selectedIdx) => {
        if (selectedIdx !== null) {
          applyCab(opponent.battleArea[selectedIdx]);
        }
        ctx.renderAll();
        callback();
      });
      break;
    }
    case 'cost_discard': {
      const n = action.value || 1;
      if (player.hand.length < n) { callback(false); return; }
      // TODO: プレイヤーが手札選択
      for (let i = 0; i < n; i++) {
        if (player.hand.length > 0) {
          const d = player.hand.pop();
          player.trash.push(d);
          ctx.addLog('✦ 「' + d.name + '」を捨てた');
        }
      }
      ctx.renderAll();
      callback();
      break;
    }
    case 'use_main_effect': {
      // このカードの【メイン】効果を再パースして実行
      const mainBlocks = parseCardEffect(ctx.card);
      const mainBlock = mainBlocks.find(b => b.trigger && b.trigger.code === 'main');
      if (mainBlock && mainBlock.actions && mainBlock.actions.length > 0) {
        ctx.addLog('✦ 「' + ctx.card.name + '」の【メイン】効果を発揮！');
        runActionList(mainBlock.actions, mainBlock.target, ctx, callback);
      } else {
        ctx.addLog('⚠ メイン効果が見つかりません');
        callback();
      }
      break;
    }

    case 'security_attack_plus': {
      // 期間付きでSアタック+Nを付与（対象デジモンのbuffsに追加）
      const saVal = action.value || 1;
      const saDur = (block.duration && block.duration.code) || 'dur_this_turn';
      const saTarget = defaultTarget || { code: 'target_all_own' };
      const applySA = (tgt) => {
        if (!tgt) return;
        if (!tgt.buffs) tgt.buffs = [];
        tgt.buffs.push({ type: 'security_attack_plus', value: saVal, duration: saDur, source: ctx.card ? ctx.card.cardNo : '' });
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

    // === レストさせる ===
    case 'rest': {
      const restTarget = defaultTarget || { code: 'target_opponent' };
      // 対象が自分自身の場合
      if (restTarget.code === 'target_self') {
        if(ctx.card) { ctx.card.suspended = true; ctx.addLog('💤 「' + ctx.card.name + '」をレスト'); }
        ctx.renderAll(); callback(); break;
      }
      // 対象が相手デジモンの場合
      const restTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i] && !opponent.battleArea[i].suspended) restTargets.push(i); }
      if(restTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      const restColor = uiColor;
      if(ctx.side === 'ai') {
        opponent.battleArea[restTargets[0]].suspended = true;
        ctx.addLog('💤 「' + opponent.battleArea[restTargets[0]].name + '」をレスト');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 レストさせる対象を選んでください');
      showTargetSelection('ai', restTargets, null, restColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          sendEffectResult(opponent.battleArea[selectedIdx], 'rest', ctx);
          opponent.battleArea[selectedIdx].suspended = true;
          ctx.addLog('💤 「' + opponent.battleArea[selectedIdx].name + '」をレスト');
        }
        ctx.renderAll(); callback();
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
      if(ctx.side === 'ai') {
        opponent.battleArea[caTargets[0]].cantAttack = true;
        addBuffDirect(opponent.battleArea[caTargets[0]], 'cant_attack', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
        ctx.addLog('🔒 「' + opponent.battleArea[caTargets[0]].name + '」アタック不可');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 アタック不可の対象を選んでください');
      showTargetSelection('ai', caTargets, null, uiColor, (selectedIdx) => {
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
    case 'cant_block': {
      const cbTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i]) cbTargets.push(i); }
      if(cbTargets.length === 0) { callback(); break; }
      if(ctx.side === 'ai') {
        opponent.battleArea[cbTargets[0]].cantBlock = true;
        addBuffDirect(opponent.battleArea[cbTargets[0]], 'cant_block', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
        ctx.addLog('🔒 「' + opponent.battleArea[cbTargets[0]].name + '」ブロック不可');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 ブロック不可の対象を選んでください');
      showTargetSelection('ai', cbTargets, null, uiColor, (selectedIdx) => {
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
      if(ctx.side === 'ai') {
        opponent.battleArea[ceTargets[0]].cantEvolve = true;
        addBuffDirect(opponent.battleArea[ceTargets[0]], 'cant_evolve', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
        ctx.addLog('❌ 「' + opponent.battleArea[ceTargets[0]].name + '」進化不可');
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 進化不可の対象を選んでください');
      showTargetSelection('ai', ceTargets, null, uiColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          opponent.battleArea[selectedIdx].cantEvolve = true;
          addBuffDirect(opponent.battleArea[selectedIdx], 'cant_evolve', 0, (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn'), ctx);
          ctx.addLog('❌ 「' + opponent.battleArea[selectedIdx].name + '」進化不可');
        }
        ctx.renderAll(); callback();
      });
      break;
    }

    // === デッキオープン ===
    case 'deck_open': {
      const openN = action.value || 3;
      const opened = [];
      for(let i = 0; i < openN && player.deck.length > 0; i++) {
        opened.push(player.deck.splice(0, 1)[0]);
      }
      if(opened.length === 0) { ctx.addLog('⚠ デッキにカードがありません'); callback(); break; }
      ctx.addLog('📖 デッキの上から' + opened.length + '枚オープン');
      showDeckOpenUI(opened, ctx, callback);
      break;
    }

    // === 手札に加える（deck_open後の選択カードを手札に） ===
    case 'add_to_hand': {
      // deck_openで_openedCardsに残っている選択済みカードを手札に
      if(ctx._selectedOpenCards && ctx._selectedOpenCards.length > 0) {
        ctx._selectedOpenCards.forEach(c => {
          player.hand.push(c);
          ctx.addLog('🃏 「' + c.name + '」を手札に加えた');
        });
      }
      ctx.renderAll(); callback();
      break;
    }

    // === デッキに戻す（上/下はUIで選択） ===
    case 'return_deck':
    case 'return_deck_bottom':
    case 'return_deck_top': {
      if(ctx._remainingOpenCards && ctx._remainingOpenCards.length > 0) {
        const isTop = action.code === 'return_deck_top';
        ctx._remainingOpenCards.forEach(c => {
          if (isTop) player.deck.unshift(c);
          else player.deck.push(c);
          ctx.addLog('📥 「' + c.name + '」をデッキの' + (isTop ? '上' : '下') + 'に戻した');
        });
        ctx._remainingOpenCards = [];
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

    // === 手札捨て（コスト以外の効果としての手札捨て） ===
    case 'discard': {
      const discardN = action.value || 1;
      if(player.hand.length === 0) { callback(); break; }
      const discardMax = Math.min(discardN, player.hand.length);
      ctx.addLog('🎯 手札を' + discardMax + '枚捨ててください');
      let discarded = 0;
      function discardNext() {
        if(discarded >= discardMax) { ctx.renderAll(); callback(); return; }
        const validIdxs = player.hand.map((_, i) => i);
        showHandSelection(player.hand, validIdxs, '#ffaa00', (selectedIdx) => {
          if(selectedIdx !== null) {
            const card = player.hand.splice(selectedIdx, 1)[0];
            player.trash.push(card);
            ctx.addLog('✦ 「' + card.name + '」を捨てた');
            discarded++;
          } else { discarded = discardMax; } // キャンセル
          discardNext();
        });
      }
      discardNext();
      break;
    }

    default:
      // キーワード効果（blocker, rush等）はパッシブなので実行不要
      callback();
  }
}

// ===== ヘルパー関数 =====

function doDestroy(targetSide, slotIdx, ctx) {
  const destroyed = targetSide.battleArea[slotIdx];
  if (!destroyed) return;
  targetSide.battleArea[slotIdx] = null;
  targetSide.trash.push(destroyed);
  if (destroyed.stack) destroyed.stack.forEach(s => targetSide.trash.push(s));
  ctx.addLog('💀 「' + destroyed.name + '」を消滅');
  // オンライン: 相手のカードを消滅させた場合、直接通知
  if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player') {
    window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: slotIdx, reason: 'destroy' });
  }
  ctx.renderAll();
}

function doBounce(targetSide, slotIdx, ctx) {
  const bounced = targetSide.battleArea[slotIdx];
  if (!bounced) return;
  targetSide.battleArea[slotIdx] = null;
  targetSide.hand.push(bounced);
  if (bounced.stack) bounced.stack.forEach(s => targetSide.trash.push(s));
  ctx.addLog('↩ 「' + bounced.name + '」を手札に戻した');
  // オンライン: 相手のカードをバウンスした場合、直接通知
  if (window._isOnlineMode && window._isOnlineMode() && ctx.side === 'player') {
    window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: slotIdx, reason: 'bounce' });
  }
  ctx.renderAll();
}

// ===== 対象選択UI =====
let _targetSelecting = false; // 対象選択中フラグ（renderAll抑制用）
export function isTargetSelecting() { return _targetSelecting; }

function showTargetSelection(targetSide, validIndices, conditions, borderColor, callback) {
  const rowId = targetSide === 'ai' ? 'ai-battle-row' : 'pl-battle-row';
  const row = document.getElementById(rowId);
  if (!row) { callback(null); return; }

  _targetSelecting = true;
  const slots = row.querySelectorAll('.b-slot');
  const color = borderColor || '#ff4444';

  // メッセージを画面中央に表示
  const msgEl = document.createElement('div');
  msgEl.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:60000;background:rgba(0,0,0,0.9);border:1px solid '+color+';border-radius:10px;padding:12px 24px;color:'+color+';font-size:14px;font-weight:bold;text-align:center;box-shadow:0 0 20px '+color+'44;pointer-events:none;';
  msgEl.innerText = '🎯 対象を選んでください';
  document.body.appendChild(msgEl);

  // 対象を光らせる＋ホバー演出
  validIndices.forEach(idx => {
    const slot = slots[idx];
    if (!slot) return;
    slot.style.border = '2px solid ' + color;
    slot.style.boxShadow = '0 0 15px ' + color;
    slot.style.cursor = 'pointer';
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
      // 確認ダイアログ表示
      showTargetConfirm(card, selectedIdx, color, (confirmed) => {
        if (confirmed) {
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
    box.innerHTML = (imgSrc ? '<img src="'+imgSrc+'" style="width:160px;border-radius:8px;margin-bottom:12px;border:1px solid '+borderColor+';">' : '')
      + '<div style="color:#fff;font-weight:bold;font-size:14px;margin-bottom:8px;">'+(card.name||'不明')+' ('+(card.cardNo||'')+')</div>'
      + '<div style="font-size:12px;color:'+borderColor+';margin-bottom:10px;">Lv.'+(card.level||'?')+' ／ DP:'+(card.dp||'?')+' ／ コスト:'+(card.cost||card.playCost||'?')+'</div>';

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
    // 対象選択完了 → 相手の効果内容オーバーレイを閉じる
    if (window._isOnlineMode && window._isOnlineMode()) {
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
}

// ===== デッキオープンUI =====

function showDeckOpenUI(openedCards, ctx, callback) {
  const player = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
  let remaining = openedCards.length;

  // カード裏面URL（デッキ画像から取得）
  const cardBackSrc = document.getElementById('pl-deck-back')?.src || '';

  // カード画像取得ヘルパー（cards.jsのgetCardImageUrlを使用）
  function getImgSrc(card) {
    return card.imgSrc || getCardImageUrl(card) || card.imageUrl || card.ImageURL || '';
  }

  // ドロップ先の定義
  const DROP_ZONES = [
    { id: 'hand-wrap', name: '手札', icon: '🃏' },
    { id: 'pl-deck-img', name: 'デッキ', icon: '📚', askPosition: true, topLabel: '上に戻す', bottomLabel: '下に戻す' },
    { id: 'pl-sec-area', name: 'セキュリティ', icon: '🛡', askPosition: true, topLabel: '上に置く', bottomLabel: '下に置く' },
    { id: 'pl-trash-count', name: 'トラッシュ', icon: '🗑', parentLevels: 1 },
  ];
  const battleRow = document.getElementById('pl-battle-row');

  // === 半透明オーバーレイ（バトルフィールドが見える） ===
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:40000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';
  document.body.appendChild(overlay);

  // オンライン: オープンしたカード一覧を送信
  if (window._isOnlineMode && window._isOnlineMode()) {
    window._onlineSendCommand({ type: 'fx_deckOpen', cards: openedCards.map(c => ({ name: c.name, imgSrc: c.imgSrc || getCardImageUrl(c) || '' })) });
  }

  // タイトル
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:1.1rem;font-weight:bold;color:#fff;letter-spacing:2px;margin-bottom:4px;text-shadow:0 0 10px #00fbff;';
  titleEl.innerText = '📖 DECK OPEN';
  overlay.appendChild(titleEl);

  // サブタイトル
  const subEl = document.createElement('p');
  subEl.style.cssText = 'font-size:11px;color:#aaa;line-height:1.6;text-align:center;margin:0;';
  subEl.innerText = 'カードを確認しています...';
  overlay.appendChild(subEl);

  // カード並び（flex横並び、背景付き）
  const cardArea = document.createElement('div');
  cardArea.style.cssText = 'display:flex;gap:10px;justify-content:center;margin:10px 0;padding:16px 24px;background:rgba(0,15,25,0.85);border:1px solid #00fbff44;border-radius:12px;';
  overlay.appendChild(cardArea);

  // 残りカード数
  const countEl = document.createElement('div');
  countEl.style.cssText = 'color:#ffaa00;font-size:13px;font-weight:bold;';
  function updateCount() { countEl.innerText = '残り ' + remaining + '枚'; }
  updateCount();
  overlay.appendChild(countEl);

  // --- カード配置処理 ---

  function placeCard(card, zone, position, cardEl) {
    let msg = '';
    if (zone === 'hand') {
      player.hand.push(card);
      msg = '🃏 「' + card.name + '」→ 手札';
    } else if (zone === 'deck-top') {
      player.deck.unshift(card);
      msg = '📥 「' + card.name + '」→ デッキの上';
    } else if (zone === 'deck-bottom') {
      player.deck.push(card);
      msg = '📥 「' + card.name + '」→ デッキの下';
    } else if (zone === 'security-top') {
      player.security.push(card);
      msg = '🛡 「' + card.name + '」→ セキュリティの上';
    } else if (zone === 'security-bottom') {
      player.security.unshift(card);
      msg = '🛡 「' + card.name + '」→ セキュリティの下';
    } else if (zone === 'trash') {
      player.trash.push(card);
      msg = '🗑 「' + card.name + '」→ トラッシュ';
    } else if (zone.startsWith('evo-')) {
      const parts = zone.split('-'); // 'evo-0-top' or 'evo-0-bottom' or 'evo-0'
      const slotIdx = parseInt(parts[1]);
      const position = parts[2] || 'bottom'; // デフォルトは下
      const target = player.battleArea[slotIdx];
      if (target) {
        if (!target.stack) target.stack = [];
        // evoSourceEffect はカードが元々持っている進化元効果を使う（メイン効果で上書きしない）
        if (position === 'top') {
          target.stack.unshift(card);
          msg = '📥 「' + card.name + '」→「' + target.name + '」の進化元（上）';
        } else {
          target.stack.push(card);
          msg = '📥 「' + card.name + '」→「' + target.name + '」の進化元（下）';
        }
      }
    }
    ctx.addLog(msg);
    // オンライン: カード移動を送信
    if (window._isOnlineMode && window._isOnlineMode()) {
      window._onlineSendCommand({ type: 'fx_cardPlace', cardName: card.name, zone, msg });
    }
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    remaining--;
    updateCount();
    ctx.renderAll();

    // 確認トースト表示
    showPlaceToast(msg);

    if (remaining <= 0) { cleanup(); callback(); }
  }

  // 確認トースト
  function showPlaceToast(text) {
    const toast = document.createElement('div');
    toast.innerText = text;
    toast.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);z-index:95000;background:rgba(0,251,255,0.15);border:1px solid #00fbff;color:#fff;font-size:13px;font-weight:bold;padding:10px 20px;border-radius:10px;text-align:center;pointer-events:none;box-shadow:0 0 15px rgba(0,251,255,0.3);animation:dpChangePopup 1.5s ease forwards;';
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 1600);
  }

  // --- 上/下選択メニュー ---

  function showPositionMenu(card, zoneDef, cardEl, x, y) {
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:72000;background:rgba(0,15,25,0.98);border:2px solid #00fbff;border-radius:10px;padding:8px;box-shadow:0 0 20px rgba(0,251,255,0.5);display:flex;flex-direction:column;gap:6px;';
    menu.style.left = Math.max(4, Math.min(x - 60, window.innerWidth - 130)) + 'px';
    menu.style.top = Math.max(4, Math.min(y - 30, window.innerHeight - 80)) + 'px';
    const zoneBase = zoneDef.id === 'pl-deck-img' ? 'deck' : 'security';

    const topBtn = document.createElement('button');
    topBtn.innerText = '▲ ' + zoneDef.topLabel;
    topBtn.style.cssText = 'background:#00fbff;color:#000;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
    topBtn.onclick = () => { document.body.removeChild(menu); placeCard(card, zoneBase + '-top', null, cardEl); };
    menu.appendChild(topBtn);

    const bottomBtn = document.createElement('button');
    bottomBtn.innerText = '▼ ' + zoneDef.bottomLabel;
    bottomBtn.style.cssText = 'background:#005566;color:#fff;border:1px solid #00fbff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
    bottomBtn.onclick = () => { document.body.removeChild(menu); placeCard(card, zoneBase + '-bottom', null, cardEl); };
    menu.appendChild(bottomBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = '✕ キャンセル';
    cancelBtn.style.cssText = 'background:#333;color:#aaa;border:none;padding:6px 16px;border-radius:6px;font-size:11px;cursor:pointer;';
    cancelBtn.onclick = () => { document.body.removeChild(menu); resetCardPosition(cardEl); };
    menu.appendChild(cancelBtn);

    document.body.appendChild(menu);
  }

  function resetCardPosition(cardEl) {
    cardEl.style.position = ''; cardEl.style.left = ''; cardEl.style.top = '';
    cardEl.style.zIndex = ''; cardEl.style.transform = ''; cardEl.style.boxShadow = '';
    cardEl.style.cursor = 'grab';
    // bodyからcardAreaに戻す
    if (cardEl.parentNode !== cardArea) {
      cardArea.appendChild(cardEl);
    }
  }

  // --- 進化元の上/下選択メニュー ---

  function showEvoPositionMenu(card, zone, cardEl, x, y) {
    const slotIdx = parseInt(zone.id.split('-')[1]);
    const target = player.battleArea[slotIdx];
    if (!target) { resetCardPosition(cardEl); return; }

    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:72000;background:rgba(0,15,25,0.98);border:2px solid #00fbff;border-radius:10px;padding:8px;box-shadow:0 0 20px rgba(0,251,255,0.5);display:flex;flex-direction:column;gap:6px;';
    menu.style.left = Math.max(4, Math.min(x - 60, window.innerWidth - 130)) + 'px';
    menu.style.top = Math.max(4, Math.min(y - 30, window.innerHeight - 100)) + 'px';

    const label = document.createElement('div');
    label.style.cssText = 'color:#aaa;font-size:10px;text-align:center;margin-bottom:2px;';
    label.innerText = '「' + target.name + '」の進化元';
    menu.appendChild(label);

    const topBtn = document.createElement('button');
    topBtn.innerText = '▲ 上に置く';
    topBtn.style.cssText = 'background:#00fbff;color:#000;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
    topBtn.onclick = () => { document.body.removeChild(menu); placeCard(card, zone.id + '-top', null, cardEl); };
    menu.appendChild(topBtn);

    const bottomBtn = document.createElement('button');
    bottomBtn.innerText = '▼ 下に置く';
    bottomBtn.style.cssText = 'background:#005566;color:#fff;border:1px solid #00fbff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;';
    bottomBtn.onclick = () => { document.body.removeChild(menu); placeCard(card, zone.id + '-bottom', null, cardEl); };
    menu.appendChild(bottomBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = '✕ キャンセル';
    cancelBtn.style.cssText = 'background:#333;color:#aaa;border:none;padding:6px 16px;border-radius:6px;font-size:11px;cursor:pointer;';
    cancelBtn.onclick = () => { document.body.removeChild(menu); resetCardPosition(cardEl); };
    menu.appendChild(cancelBtn);

    document.body.appendChild(menu);
  }

  // --- ドロップ判定 ---

  function detectDropZone(x, y) {
    for (const zone of DROP_ZONES) {
      let el = document.getElementById(zone.id);
      if (zone.parentLevels) { for (let p = 0; p < zone.parentLevels; p++) el = el?.parentElement; }
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zone;
    }
    if (battleRow) {
      const slots = battleRow.querySelectorAll('.b-slot');
      for (let i = 0; i < slots.length; i++) {
        const r = slots[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          if (player.battleArea[i]) return { id: 'evo-' + i, name: '進化元（' + player.battleArea[i].name + '）', icon: '📥' };
        }
      }
    }
    return null;
  }

  // --- ハイライト ---

  let _highlightedEl = null;
  let _hintEls = []; // 常時ヒント表示用

  // ドロップ先ヒント（常時薄く光らせる）
  function showDropHints() {
    const allZones = [...DROP_ZONES];
    // バトルエリアのスロットも追加
    if (battleRow) {
      const slots = battleRow.querySelectorAll('.b-slot');
      for (let i = 0; i < slots.length; i++) {
        if (player.battleArea[i]) allZones.push({ id: 'evo-' + i, parentLevels: 0 });
      }
    }
    allZones.forEach(zone => {
      let el;
      if (zone.id.startsWith('evo-')) {
        const idx = parseInt(zone.id.split('-')[1]);
        el = battleRow?.querySelectorAll('.b-slot')[idx];
      } else {
        el = document.getElementById(zone.id);
        if (zone.parentLevels) { for (let p = 0; p < zone.parentLevels; p++) el = el?.parentElement; }
      }
      if (el) {
        el.style.outline = '2px dashed #00fbff66';
        el.style.outlineOffset = '2px';
        el.style.transition = 'all 0.2s';
        _hintEls.push(el);
      }
    });
  }

  function clearDropHints() {
    _hintEls.forEach(el => {
      el.style.outline = ''; el.style.outlineOffset = '';
      el.style.boxShadow = ''; el.style.transition = '';
    });
    _hintEls = [];
  }

  function highlightZone(zone) {
    // まずアクティブハイライトをクリア（ヒントは残す）
    if (_highlightedEl) {
      _highlightedEl.style.outline = '2px dashed #00fbff66';
      _highlightedEl.style.boxShadow = '';
      _highlightedEl = null;
    }
    if (!zone) return;
    let el;
    if (zone.id.startsWith('evo-')) {
      const idx = parseInt(zone.id.split('-')[1]);
      el = battleRow?.querySelectorAll('.b-slot')[idx];
    } else {
      el = document.getElementById(zone.id);
      if (zone.parentLevels) { for (let p = 0; p < zone.parentLevels; p++) el = el?.parentElement; }
    }
    if (el) {
      el.style.outline = '3px solid #00fbff';
      el.style.outlineOffset = '3px';
      el.style.boxShadow = '0 0 25px rgba(0,251,255,0.7)';
      _highlightedEl = el;
    }
  }
  function clearHighlight() {
    if (_highlightedEl) {
      _highlightedEl.style.outline = '2px dashed #00fbff66';
      _highlightedEl.style.outlineOffset = '2px';
      _highlightedEl.style.boxShadow = '';
      _highlightedEl = null;
    }
  }

  // --- ドラッグ設定（めくり後に有効化） ---

  function enableDrag(wrap, card) {
    let dragging = false, startX, startY, origRect;
    wrap.style.cursor = 'grab';

    function onDragStart(ex, ey) {
      dragging = true;
      origRect = wrap.getBoundingClientRect();
      startX = ex; startY = ey;
      // オーバーレイから外してbodyに移動（オーバーレイ外へドラッグ可能に）
      const r = wrap.getBoundingClientRect();
      wrap.style.position = 'fixed';
      wrap.style.left = r.left + 'px';
      wrap.style.top = r.top + 'px';
      wrap.style.zIndex = '90000';
      wrap.style.transform = 'scale(1.15)';
      wrap.style.cursor = 'grabbing';
      wrap.style.boxShadow = '0 0 30px rgba(0,251,255,0.7)';
      document.body.appendChild(wrap);
    }
    function onDragMove(ex, ey) {
      if (!dragging) return;
      wrap.style.left = (origRect.left + (ex - startX)) + 'px';
      wrap.style.top = (origRect.top + (ey - startY)) + 'px';
      highlightZone(detectDropZone(ex, ey));
    }
    function onDragEnd(ex, ey) {
      if (!dragging) return;
      dragging = false;
      clearHighlight();
      const zone = detectDropZone(ex, ey);
      if (!zone) {
        // 戻す: bodyからcardAreaに戻す
        wrap.style.position = ''; wrap.style.left = ''; wrap.style.top = '';
        wrap.style.zIndex = ''; wrap.style.transform = ''; wrap.style.boxShadow = '';
        wrap.style.cursor = 'grab';
        cardArea.appendChild(wrap);
        return;
      }
      const zoneDef = DROP_ZONES.find(z => z.id === zone.id);
      if (zoneDef && zoneDef.askPosition) { showPositionMenu(card, zoneDef, wrap, ex, ey); return; }
      if (zone.id === 'hand-wrap') placeCard(card, 'hand', null, wrap);
      else if (zone.id === 'pl-trash-count') placeCard(card, 'trash', null, wrap);
      else if (zone.id.startsWith('evo-')) {
        // 進化元: 上/下選択メニュー
        showEvoPositionMenu(card, zone, wrap, ex, ey);
        return;
      }
      else { wrap.style.position=''; wrap.style.left=''; wrap.style.top=''; wrap.style.zIndex=''; wrap.style.transform=''; wrap.style.boxShadow=''; wrap.style.cursor='grab'; cardArea.appendChild(wrap); }
    }

    wrap.addEventListener('mousedown', e => {
      e.preventDefault();
      onDragStart(e.clientX, e.clientY);
      const move = ev => onDragMove(ev.clientX, ev.clientY);
      const up = ev => { onDragEnd(ev.clientX, ev.clientY); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    wrap.addEventListener('touchstart', e => { onDragStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    wrap.addEventListener('touchmove', e => { e.preventDefault(); onDragMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    wrap.addEventListener('touchend', e => { onDragEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });
  }

  // === カード生成（最初から表面で全カード同時表示） ===

  const cardEls = [];

  openedCards.forEach((card, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'mulligan-card';
    wrap.style.userSelect = 'none';
    wrap.style.touchAction = 'none';
    wrap.style.border = '2px solid #00fbff';
    wrap.style.boxShadow = '0 4px 15px rgba(0,251,255,0.3)';

    const src = getImgSrc(card);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = function() {
        this.style.display = 'none';
        const fb = document.createElement('div');
        fb.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#aaa;padding:4px;word-break:break-all;background:#112;';
        fb.innerText = card.name;
        wrap.appendChild(fb);
      };
      wrap.appendChild(img);
    } else {
      const fb = document.createElement('div');
      fb.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#aaa;padding:4px;word-break:break-all;background:#112;';
      fb.innerText = card.name;
      wrap.appendChild(fb);
    }

    cardArea.appendChild(wrap);
    cardEls.push({ wrap, card });

    // 配布アニメーション（全カード同時）
    wrap.style.animation = 'mulliganDeal 0.4s ease forwards';
  });

  // 配布完了後 → 即ドラッグ有効化 + ドロップ先ヒント表示
  setTimeout(() => {
    subEl.innerText = 'カードをドラッグして配置してください';
    subEl.style.color = '#00fbff';
    showDropHints();
    cardEls.forEach(({ wrap, card }) => {
      enableDrag(wrap, card);
    });
  }, 500);

  // --- クリーンアップ ---

  function cleanup() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    clearHighlight();
    clearDropHints();
    // オンライン: デッキオープン終了を送信
    if (window._isOnlineMode && window._isOnlineMode()) {
      window._onlineSendCommand({ type: 'fx_deckOpenClose' });
    }
  }
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
    showDpPopup(isPlus ? val : -val);
  }

  if (target.code === 'target_self' && ctx.card) {
    applyAndLog(ctx.card);
    ctx.renderAll(); callback && callback();
  } else if (target.code === 'target_all_own') {
    player.battleArea.forEach(c => { if (c) addBuffDirect(c, type, val, dur, ctx); });
    ctx.addLog(label + '全デジモン DP' + sign + val);
    showDpPopup(isPlus ? val : -val);
    ctx.renderAll(); callback && callback();
  } else if (target.code === 'target_all_own_security') {
    // セキュリティバフを記録（セキュリティチェック時に参照）
    if (!ctx.bs._securityBuffs) ctx.bs._securityBuffs = [];
    ctx.bs._securityBuffs.push({ type, value: val, duration: dur, source: ctx.card ? ctx.card.cardNo : '', owner: ctx.side });
    ctx.addLog(label + 'セキュリティデジモン全体 DP' + sign + val + '（' + dur + '）');
    showDpPopup(isPlus ? val : -val);
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
    if(ctx.side === 'ai') { applyAndLog(player.battleArea[validTargets[0]]); ctx.renderAll(); callback && callback(); return; }
    ctx.addLog('🎯 DP' + sign + val + 'の対象を選んでください');
    showTargetSelection(ctx.side === 'player' ? 'pl' : 'ai', validTargets, null, isPlus ? '#00ff88' : '#ff4444', (idx) => {
      if(idx !== null) applyAndLog(player.battleArea[idx]);
      ctx.renderAll(); callback && callback();
    });
  } else {
    ctx.renderAll(); callback && callback();
  }
}

function addBuffDirect(card, type, value, duration, ctx) {
  if (!card.buffs) card.buffs = [];
  card.buffs.push({ type, value, duration, source: ctx.card ? ctx.card.cardNo : '' });
  recalcDp(card);
}

function recalcDp(card) {
  // baseDpは初回のみ設定。以降は変更しない
  if (card.baseDp === undefined || card.baseDp === null) {
    card.baseDp = parseInt(card.dp) || 0;
  }
  let mod = 0;
  if (card.buffs) {
    card.buffs.forEach(b => {
      if (b.type === 'dp_plus') mod += (parseInt(b.value) || 0);
      if (b.type === 'dp_minus') mod -= (parseInt(b.value) || 0);
    });
  }
  card.dpModifier = mod;
  card.dp = card.baseDp + mod;
}

// 持続切れバフを除去
// timing: 'dur_this_turn' / 'dur_next_opp_turn' / 'dur_next_own_turn'
// ownerSide: 'player'/'ai' — permanent バフの持ち主（ターン切替時に指定）
export function expireBuffs(bs, timing, ownerSide) {
  ['player', 'ai'].forEach(side => {
    [...bs[side].battleArea, ...(bs[side].tamerArea || [])].forEach(card => {
      if (!card || !card.buffs || card.buffs.length === 0) return;
      const before = card.buffs.length;
      if (timing === 'permanent') {
        // permanent バフを全消し（ownerSide指定時: そのsideのカードのバフのみ）
        if (ownerSide) {
          // ownerSideのカードに付いているpermanentバフのみ消す
          if (side === ownerSide) {
            card.buffs = card.buffs.filter(b => b.duration !== 'permanent');
          }
        } else {
          card.buffs = card.buffs.filter(b => b.duration !== 'permanent');
        }
      } else {
        card.buffs = card.buffs.filter(b => b.duration !== timing);
      }
      if (card.buffs.length !== before) recalcDp(card);
      if (!card.buffs.some(b => ['cant_attack_block', 'cant_attack'].includes(b.type))) card.cantAttack = false;
      if (!card.buffs.some(b => ['cant_attack_block', 'cant_block'].includes(b.type))) card.cantBlock = false;
      if (!card.buffs.some(b => b.type === 'cant_evolve')) card.cantEvolve = false;
    });
  });
  // セキュリティバフも同じtimingで期限切れ除去
  if (bs._securityBuffs && bs._securityBuffs.length > 0) {
    bs._securityBuffs = bs._securityBuffs.filter(b => b.duration !== timing);
  }
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

  // ② 永続効果を全て再適用
  const allCards = [...(bs[side].battleArea.filter(c => c)), ...(bs[side].tamerArea || [])];

  allCards.forEach(card => {
    // メイン効果
    const blocks = parseCardEffect(card);
    blocks.forEach(block => {
      if (!block.trigger || !['during_own_turn', 'during_opp_turn', 'during_any_turn'].includes(block.trigger.code)) return;
      if (block.trigger.code === 'during_own_turn' && side !== turnSide) return;
      if (block.trigger.code === 'during_opp_turn' && side === turnSide) return;
      // 「〜とき」を含む効果は誘発型（永続適用ではなくイベント発生時に適用）なのでスキップ
      const rawBody = block.raw || '';
      if (rawBody.includes('されたとき') || rawBody.includes('したとき') || rawBody.includes('なったとき')) return;
      if (!checkConditions(block.conditions, card, bs, side)) return;

      block.actions.forEach(action => {
        const target = block.target || { code: 'target_self' };
        if (action.code === 'dp_plus') {
          if (target.code === 'target_all_own') {
            bs[side].battleArea.forEach(tgt => {
              if (!tgt) return;
              if (!tgt.buffs) tgt.buffs = [];
              tgt.buffs.push({ type: 'dp_plus', value: action.value, duration: 'permanent', source: 'perm' });
              recalcDp(tgt);
            });
          } else if (target.code === 'target_self') {
            if (!card.buffs) card.buffs = [];
            card.buffs.push({ type: 'dp_plus', value: action.value, duration: 'permanent', source: 'perm' });
            recalcDp(card);
          }
        } else if (action.code === 'security_attack_plus') {
          // Sアタック+を永続フラグとして記録（getSecurityAttackCountで参照される）
          const tgt = (target.code === 'target_self') ? card : card;
          if (!tgt._permEffects) tgt._permEffects = {};
          tgt._permEffects.securityAttackPlus = (tgt._permEffects.securityAttackPlus || 0) + (action.value || 1);
        }
      });
    });

    // 進化元効果（スタック内のみ）
    if (card.stack) {
      card.stack.forEach((evoCard) => {
        if (!evoCard.evoSourceEffect || evoCard.evoSourceEffect === 'なし') return;
        const evoBlocks = parseCardEffect(evoCard, evoCard.evoSourceEffect);
        evoBlocks.forEach(block => {
          if (!block.trigger) return;
          if (block.trigger.code === 'during_own_turn' && side !== turnSide) return;
          if (block.trigger.code === 'during_opp_turn' && side === turnSide) return;
          if (!['during_own_turn', 'during_opp_turn', 'during_any_turn'].includes(block.trigger.code)) return;
          // 「〜とき」を含む効果は誘発型なのでスキップ
          const evoRaw = block.raw || '';
          if (evoRaw.includes('されたとき') || evoRaw.includes('したとき') || evoRaw.includes('なったとき')) return;
          if (!checkConditions(block.conditions, card, bs, side)) return;
          block.actions.forEach(action => {
            if (action.code === 'dp_plus') {
              if (!card.buffs) card.buffs = [];
              card.buffs.push({ type: 'dp_plus', value: action.value, duration: 'permanent', source: 'evo_perm' });
              recalcDp(card);
            } else if (action.code === 'security_attack_plus') {
              if (!card._permEffects) card._permEffects = {};
              card._permEffects.securityAttackPlus = (card._permEffects.securityAttackPlus || 0) + (action.value || 1);
            }
          });
        });
      });
    }
  });
}

// ===== 条件チェック =====

function checkConditions(conditions, card, bs, side) {
  if (!conditions || conditions.length === 0) return true;
  // cond_existsがある場合は先に評価（他の条件は相手カード側に適用される）
  const hasExists = conditions.some(c => c.code === 'cond_exists');
  const orderedConds = hasExists
    ? [conditions.find(c => c.code === 'cond_exists'), ...conditions.filter(c => c.code !== 'cond_exists')]
    : conditions;
  for (const cond of orderedConds) {
    switch (cond.code) {
      case 'cond_has_evo': if (!card.stack || card.stack.length < (cond.value || 0)) return false; break;
      case 'cond_no_evo': if (card.stack && card.stack.length > 0) return false; break;
      case 'cond_dp_le': if (card.dp > (cond.value || 0)) return false; break;
      case 'cond_dp_ge': if (card.dp < (cond.value || 0)) return false; break;
      case 'cond_lv_le': if (parseInt(card.level) > (cond.value || 0)) return false; break;
      case 'cond_lv_ge': if (parseInt(card.level) < (cond.value || 0)) return false; break;
      case 'cond_cost_le': if ((card.playCost || card.cost || 0) > (cond.value || 0)) return false; break;
      case 'cond_cost_ge': if ((card.playCost || card.cost || 0) < (cond.value || 0)) return false; break;
      case 'cond_exists': {
        // 「～がいるとき」「～がいる間」→ 相手バトルエリアに条件を満たすカードがいるか
        if (!bs) break; // bsがない場合はスキップ（後方互換）
        const oppSide = side === 'player' ? 'ai' : 'player';
        const oppArea = bs[oppSide].battleArea;
        // 同じconditions内の他の条件（cond_no_evo, cond_dp_le等）を相手カードに適用
        const otherConds = conditions.filter(c => c.code !== 'cond_exists' && c.code !== 'per_count');
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
        if (!hasMatch) return false;
        // cond_existsで使った他の条件はスキップ（二重チェック防止）
        return true;
      }
    }
  }
  return true;
}

// ===== 消滅チェック =====

function checkPendingDestroys(ctx) {
  let destroyed = false;
  ['player', 'ai'].forEach(side => {
    const area = ctx.bs[side].battleArea;
    for (let i = 0; i < area.length; i++) {
      if (area[i] && area[i]._pendingDestroy) {
        const card = area[i];
        area[i] = null;
        ctx.bs[side].trash.push(card);
        if (card.stack) card.stack.forEach(s => ctx.bs[side].trash.push(s));
        ctx.addLog('💀 「' + card.name + '」消滅');
        destroyed = true;
        // オンライン: DP0消滅を即時通知（state_sync遅延による復活を防止）
        if (window._isOnlineMode && window._isOnlineMode()) {
          if (side === 'ai') {
            window._onlineSendCommand({ type: 'card_removed', zone: 'battle', slotIdx: i, reason: 'destroy' });
          } else if (side === 'player') {
            window._onlineSendCommand({ type: 'own_card_removed', slotIdx: i, reason: 'destroy' });
          }
        }
      }
    }
  });
  ctx.renderAll();
  // 消滅があった場合は即時state_sync（デバウンスを待たず確実に同期）
  if (destroyed && window._isOnlineMode && window._isOnlineMode() && window._onlineSendStateSync) {
    window._onlineSendStateSync();
  }
}

// ===== 効果発動アナウンス（カード画像＋効果テキストを数秒表示） =====

function showEffectAnnounce(card, effectText, side, callback) {
  // effectTextが空の場合、カードの効果テキスト全文をフォールバック
  const displayText = effectText || card.effect || '';
  if (window._isOnlineMode && window._isOnlineMode() && side === 'player') {
    window._onlineSendCommand({ type: 'fx_effectAnnounce', cardName: card.name, effectText: displayText.substring(0,300) });
  }
  const sideColor = side === 'player' ? '#00fbff' : '#ff00fb';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:55000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

  const box = document.createElement('div');
  box.style.cssText = 'max-width:85%;padding:20px;background:rgba(0,10,20,0.95);border:2px solid ' + sideColor + ';border-radius:12px;box-shadow:0 0 30px ' + sideColor + '44;text-align:center;';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'color:' + sideColor + ';font-size:14px;font-weight:bold;margin-bottom:10px;text-shadow:0 0 8px ' + sideColor + ';';
  nameEl.innerText = '⚡ ' + card.name + ' — 効果発動';
  box.appendChild(nameEl);

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
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:45%;left:0;z-index:60000;font-size:clamp(0.85rem,3.5vw,1.1rem);font-weight:700;color:#aaa;background:rgba(30,30,40,0.85);padding:10px 28px;border-radius:20px;border:1px solid #555;box-shadow:0 2px 12px rgba(0,0,0,0.4);white-space:nowrap;cursor:pointer;animation:effectFizzleSlide 3.5s cubic-bezier(0.25,1,0.5,1) forwards;';
  el.innerText = '💨 対象がいないため、効果発動できませんでした';
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
  document.getElementById('effect-confirm-name').innerText = card.name;
  document.getElementById('effect-confirm-text').innerText = effectText;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
  window._effectConfirmCallback = callback;
  // オンライン: 確認ダイアログを相手にも表示
  if (window._isOnlineMode && window._isOnlineMode()) {
    window._onlineSendCommand({ type: 'fx_confirmShow', cardName: card.name, effectText: (effectText||'').substring(0,200) });
  }
}

window._effectEngineConfirm = function(yes) {
  document.getElementById('effect-confirm-overlay').style.display = 'none';
  // オンライン: 確認ダイアログを相手側で閉じる
  if (window._isOnlineMode && window._isOnlineMode()) {
    window._onlineSendCommand({ type: 'fx_confirmClose', accepted: yes });
  }
  if (window._effectConfirmCallback) {
    window._effectConfirmCallback(yes);
    window._effectConfirmCallback = null;
  }
};

// ===== DP変化ポップアップ =====

function showDpPopup(value) {
  const isPlus = value > 0;
  const popup = document.createElement('div');
  popup.innerText = (isPlus ? '+' : '') + value;
  popup.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:2rem;font-weight:bold;z-index:60000;pointer-events:none;color:${isPlus ? '#00ff88' : '#ff4444'};text-shadow:0 0 15px ${isPlus ? '#00ff88' : '#ff4444'};animation:dpChangePopup 1s ease forwards;`;
  document.body.appendChild(popup);
  setTimeout(() => { if (popup.parentNode) popup.parentNode.removeChild(popup); }, 1100);
}

// ===== 誘発スキャナー =====

function scanTriggers(triggerCode, sourceCard, sourceSide, ctx) {
  const turnPlayer = ctx.bs.isPlayerTurn ? 'player' : 'ai';

  // 起動効果（main等）はソースカードのみ処理。盤面スキャン不要
  const isActivated = ['main'].includes(triggerCode);

  if (isActivated) {
    // 起動効果: ソースカードだけキューに追加
    if (sourceCard) {
      const blocks = parseCardEffect(sourceCard);
      blocks.forEach(block => {
        if (block.trigger && block.trigger.code === triggerCode) {
          addToQueue(sourceCard, block,
            sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
          );
        }
      });
    }
  } else {
    // 誘発効果: 盤面全体をスキャン
    ['player', 'ai'].forEach(side => {
      [...ctx.bs[side].battleArea, ...(ctx.bs[side].tamerArea || [])].forEach(card => {
        if (!card) return;
        const blocks = parseCardEffect(card);
        blocks.forEach(block => {
          if (block.trigger && block.trigger.code === triggerCode) {
            addToQueue(card, block,
              side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer',
              triggerCode.startsWith('when_') ? 'interrupt' : 'normal',
              side
            );
          }
        });
      });

      // 進化元効果もスキャン
      ctx.bs[side].battleArea.forEach(card => {
        if (!card || !card.stack) return;
        card.stack.forEach(evoCard => {
          if (!evoCard.evoSourceEffect || evoCard.evoSourceEffect === 'なし') return;
          const blocks = parseCardEffect(evoCard, evoCard.evoSourceEffect);
          blocks.forEach(block => {
            if (block.trigger && block.trigger.code === triggerCode) {
              addToQueue(card, block,
                side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', side
              );
            }
          });
        });
      });
    });

    // ソースカード自身（盤面スキャンで見つからなかった場合のみ追加）
    if (sourceCard) {
      const alreadyQueued = _effectQueue.some(e => e.card === sourceCard);
      if (!alreadyQueued) {
        const blocks = parseCardEffect(sourceCard);
        blocks.forEach(block => {
          if (block.trigger && block.trigger.code === triggerCode) {
            addToQueue(sourceCard, block,
              sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
            );
          }
        });
      }
    }
  }

  sortQueue();
}

// ===== レシピ実行エンジン =====

// カードからトリガーに対応するレシピを取得
function getRecipeForTrigger(card, triggerCode) {
  if (!card.recipe) return null;
  try {
    const recipes = typeof card.recipe === 'string' ? JSON.parse(card.recipe) : card.recipe;
    // { "main": [...], "on_attack": [...] } 形式
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

// レシピを順次実行
function runRecipe(steps, ctx, callback) {
  const store = {}; // ステップ間データ受け渡し用
  let idx = 0;

  function nextStep(success) {
    // コスト不足等で効果不発
    if (success === false) { ctx.renderAll(); callback && callback(); return; }
    if (idx >= steps.length) { ctx.renderAll(); callback && callback(); return; }
    const step = steps[idx++];
    executeRecipeStep(step, ctx, store, nextStep);
  }
  nextStep();
}

// レシピの1ステップを実行
function executeRecipeStep(step, ctx, store, callback) {
  const player = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
  const opponent = ctx.side === 'player' ? ctx.bs.ai : ctx.bs.player;

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
      if (step.target === 'own') {
        const valid = [];
        for (let i = 0; i < player.battleArea.length; i++) {
          if (player.battleArea[i]) valid.push(i);
        }
        if (valid.length === 0) { showEffectFailed(null, callback); return; }
        const rowId = ctx.side === 'player' ? 'pl' : 'ai';
        showTargetSelection(rowId, valid, null, '#00fbff', (selectedIdx) => {
          if (selectedIdx !== null) {
            store[step.store] = { idx: selectedIdx, card: player.battleArea[selectedIdx] };
          }
          callback();
        });
      } else if (step.target === 'opponent') {
        const valid = [];
        for (let i = 0; i < opponent.battleArea.length; i++) {
          const c = opponent.battleArea[i];
          if (!c) continue;
          // 条件フィルタ
          if (step.condition) {
            const [condType, condVal] = step.condition.split(':');
            if (condType === 'dp_le' && c.dp > parseInt(condVal)) continue;
            if (condType === 'dp_ge' && c.dp < parseInt(condVal)) continue;
            if (condType === 'lv_le' && parseInt(c.level) > parseInt(condVal)) continue;
          }
          valid.push(i);
        }
        if (valid.length === 0) { showEffectFailed(null, callback); return; }
        const rowId = ctx.side === 'player' ? 'ai' : 'pl';
        showTargetSelection(rowId, valid, null, '#ff4444', (selectedIdx) => {
          if (selectedIdx !== null) {
            store[step.store] = { idx: selectedIdx, card: opponent.battleArea[selectedIdx] };
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
      let remaining = maxCount;
      const selected = [];

      function selectNext() {
        if (remaining <= 0) { callback(); return; }
        const valid = [];
        for (let i = 0; i < opponent.battleArea.length; i++) {
          const c = opponent.battleArea[i];
          if (!c || selected.includes(i)) continue;
          if (step.condition) {
            const [condType, condVal] = step.condition.split(':');
            if (condType === 'dp_le' && c.dp > parseInt(condVal)) continue;
          }
          valid.push(i);
        }
        if (valid.length === 0) { callback(); return; }
        const rowId = ctx.side === 'player' ? 'ai' : 'pl';
        ctx.addLog('🎯 対象を選んでください（残り' + remaining + '体）');
        showTargetSelection(rowId, valid, null, '#ff4444', (selectedIdx) => {
          if (selectedIdx !== null) {
            selected.push(selectedIdx);
            if (step.store) {
              if (!store[step.store]) store[step.store] = [];
              store[step.store].push({ idx: selectedIdx, card: opponent.battleArea[selectedIdx] });
            }
            remaining--;
            // 続けて選ぶか確認（残りがあり、対象もある場合）
            if (remaining > 0) {
              const moreValid = valid.filter(i => !selected.includes(i));
              if (moreValid.length > 0) {
                selectNext();
                return;
              }
            }
          }
          callback();
        });
      }
      selectNext();
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

    // === 消滅 ===
    case 'destroy': {
      const targetData = step.card ? store[step.card] : null;
      if (targetData) {
        const targets = Array.isArray(targetData) ? targetData : [targetData];
        const destroyedCards = [];
        targets.forEach(t => {
          const c = opponent.battleArea[t.idx];
          if (c) {
            destroyedCards.push(c);
            opponent.battleArea[t.idx] = null;
            opponent.trash.push(c);
            if (c.stack) c.stack.forEach(s => opponent.trash.push(s));
            ctx.addLog('💥 「' + c.name + '」を消滅させた！');
          }
        });
        ctx.renderAll();
        // 消滅演出を順番に再生（ローカル＋相手）
        if (ctx.showDestroyEffect && destroyedCards.length > 0) {
          let di = 0;
          function nextDestroy() {
            if (di >= destroyedCards.length) { callback(); return; }
            ctx.showDestroyEffect(destroyedCards[di++], nextDestroy);
          }
          nextDestroy();
          return;
        }
      }
      callback();
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

    // === 自分のDP以下の相手を消滅 ===
    case 'destroy_by_dp': {
      const myDp = ctx.card ? ctx.card.dp : 0;
      const valid = [];
      for (let i = 0; i < opponent.battleArea.length; i++) {
        const c = opponent.battleArea[i];
        if (c && c.dp <= myDp) valid.push(i);
      }
      if (valid.length === 0) { showEffectFailed(null, callback); return; }
      const rowId = ctx.side === 'player' ? 'ai' : 'pl';
      showTargetSelection(rowId, valid, null, '#ff4444', (selectedIdx) => {
        if (selectedIdx !== null) {
          const c = opponent.battleArea[selectedIdx];
          opponent.battleArea[selectedIdx] = null;
          opponent.trash.push(c);
          if (c.stack) c.stack.forEach(s => opponent.trash.push(s));
          ctx.addLog('💥 「' + c.name + '」(DP' + c.dp + ')を消滅させた！');
          ctx.renderAll();
        }
        callback();
      });
      break;
    }

    // === レストせずアタック可能にする ===
    case 'enable_attack_without_rest': {
      if (ctx.card) {
        ctx.card._attackWithoutRest = true;
        ctx.addLog('⚔ 「' + ctx.card.name + '」はレストせずにアタックできる！');
      }
      callback();
      break;
    }

    // === その他のアクション（既存エンジンに委譲） ===
    default: {
      // 既存のrunOneAction形式に変換して実行
      const action = { code: step.action, value: step.value || null };
      const target = step.target ? { code: 'target_' + step.target } : null;
      runOneAction(action, target, ctx, callback);
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

// 「～ごとに」パターンの倍率付き効果値を計算（battle.jsから利用）
// effectText: カード効果テキスト、card: カードオブジェクト、bs: バトルステート、side: 'player'/'ai'
// actionCode: 対象アクション（例: 'security_attack_plus', 'dp_plus'）
// 戻り値: 倍率適用済みの値（0なら該当なし）
export function calcPerCountValue(effectText, card, bs, side) {
  if (!effectText || effectText === 'なし') return 0;
  const conditions = findConditions(effectText);
  const perCond = conditions.find(c => c.code === 'per_count');
  if (!perCond || !perCond.value) return 0;

  const n = perCond.value;
  const refSource = perCond.refSource || 'evo_source';
  const count = getRefSourceCountDirect(refSource, card, bs, side);
  const multiplier = Math.floor(count / n);

  // 後続アクションの値を取得
  const actions = findActions(effectText);
  let totalValue = 0;
  for (const a of actions) {
    if (a.value != null && a.value > 0) {
      totalValue += a.value * multiplier;
    }
  }
  return totalValue;
}

// カードがキーワード効果を持っているか
export function cardHasKeyword(card, keywordCode) {
  if (!card) return false;
  const texts = [card.effect];
  if (card.stack) card.stack.forEach(s => { if (s.evoSourceEffect) texts.push(s.evoSourceEffect); });

  for (const text of texts) {
    if (!text || text === 'なし') continue;
    const actions = findActions(text);
    if (actions.some(a => a.code === keywordCode)) return true;
  }
  return false;
}
