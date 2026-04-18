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
  // 先に特殊パターンを検出（辞書の単純マッチでは取れない語順・表記ゆれ対応）
  // 「進化元を下からN枚破棄」→ evo_discard_bottom N
  // 「進化元を上からN枚破棄」/「進化元をN枚破棄」→ evo_discard N
  const evoBottomMatch = effectText.match(/進化元[をの]?(?:の)?下から(\d+)?枚?破棄/);
  const evoTopMatch = effectText.match(/進化元[をの]?(?:の)?上から(\d+)?枚?破棄/);
  const evoAnyMatch = effectText.match(/進化元を(\d+)?枚?破棄/);
  if (evoBottomMatch) {
    results.push({ keyword: '進化元の下から破棄', code: 'evo_discard_bottom', value: parseInt(evoBottomMatch[1] || '1'), index: effectText.indexOf('進化元') });
  } else if (evoTopMatch) {
    results.push({ keyword: '進化元を上から破棄', code: 'evo_discard_top', value: parseInt(evoTopMatch[1] || '1'), index: effectText.indexOf('進化元') });
  } else if (evoAnyMatch && !effectText.includes('進化元を持たない') && !effectText.includes('進化元をもたない')) {
    // 方向指定なし = デフォルトで下から（公式ルール準拠）
    results.push({ keyword: '進化元を破棄', code: 'evo_discard', value: parseInt(evoAnyMatch[1] || '1'), index: effectText.indexOf('進化元') });
  }
  for (const entry of _actionDict) {
    const code = (entry['アクションコード']||'').trim();
    if (!code) continue;
    // アクション以外（対象・条件・持続・判定）はスキップ
    if (NON_ACTION_PREFIXES.some(p => code.startsWith(p))) continue;
    // evo_discard系は既に上でハードコード検出済みならスキップ（重複防止）
    if ((code === 'evo_discard' || code === 'evo_discard_bottom' || code === 'evo_discard_top') &&
        results.some(r => r.code === 'evo_discard' || r.code === 'evo_discard_bottom' || r.code === 'evo_discard_top')) continue;
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
// レシピ内の duration コード → エンジン内部の timing コードへ正規化
// レシピは "this_turn" / "next_opp_turn_end" / "next_own_turn_end" を使うが、
// expireBuffs は "dur_this_turn" / "dur_next_opp_turn" / "dur_next_own_turn" を期待する。
// このマップで両者を繋ぐ。既に dur_ プレフィックス付きならそのまま返す。
function normalizeRecipeDuration(code) {
  if (!code) return code;
  if (typeof code !== 'string') return code;
  if (code.startsWith('dur_')) return code;
  const map = {
    'this_turn': 'dur_this_turn',
    'next_opp_turn_end': 'dur_next_opp_turn',
    'next_own_turn_end': 'dur_next_own_turn',
    'permanent': 'permanent',
  };
  return map[code] || code;
}

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
  // 同じカード+同じトリガー+同じ効果テキストが既にキューにあればスキップ
  // 注意: 進化元効果は異なるカード由来でも同じ親カードで登録されるため、
  //        blockのraw(効果テキスト)も比較して区別する
  const blockRaw = block.raw || '';
  const isDuplicate = _effectQueue.some(e =>
    e.block.trigger?.code === triggerCode &&
    (e.card === card || (e.card.name === card.name && e.card.cardNo === card.cardNo)) &&
    (e.block.raw || '') === blockRaw
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

  next.status = 'processing';
  executeQueueEntry(next, context, () => {
    next.status = 'completed';
    sortQueue();
    // ★ 各効果の完了直後に消滅判定 → on_destroy リアクションを処理
    // これで複数の on_attack 効果が連続する場合、効果1の destroy/on_destroy が
    // 完全に終わってから効果2の対象選択に進む
    checkPendingDestroys(context, () => {
      processQueue(context, onComplete);
    });
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
      // 進化元効果のレシピは _recipeCard に格納されている → inEvoSource=true で参照
      const recipeCard = block._recipeCard || card;
      const isEvoSourceLookup = !!block._recipeCard;
      const trigCode = block.trigger ? block.trigger.code : null;
      const recipe = getRecipeForTrigger(recipeCard, trigCode, isEvoSourceLookup);
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

  // ★ 事前条件チェック: レシピの全ステップが条件で弾かれるなら効果発動ポップアップを出さない
  // 例: 石田ヤマトの「進化元を持たない相手デジモンがいるとき、メモリー+1」で
  //     条件を満たす相手デジモンがいない場合、ポップアップ自体を出さない
  {
    const recipeCardForCheck = block._recipeCard || card;
    const isEvoSourceCheck = !!block._recipeCard;
    const trigCodeForCheck = block.trigger ? block.trigger.code : null;
    const recipeForCheck = trigCodeForCheck ? getRecipeForTrigger(recipeCardForCheck, trigCodeForCheck, isEvoSourceCheck) : null;
    if (recipeForCheck && Array.isArray(recipeForCheck)) {
      const willExecute = recipeWillExecuteAnything(recipeForCheck, { card, bs: context.bs, side: actualSide });
      if (!willExecute) {
        callback();
        return;
      }
    }
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
      if(effectiveSide === 'ai') {
        const di = ctx._forceTargetIdx ?? dpTargets[0];
        const tgt = opponent.battleArea[di];
        addBuff(tgt, 'dp_minus', val, ctx);
        ctx.addLog('💥 ' + tgt.name + ' DP-' + val + ' → ' + tgt.dp);
        playEffect(action.code, { value: -val, ctx, label: tgt.name }, () => {});
        if(tgt.dp <= 0) tgt._pendingDestroy = true;
        sendDpRemoteBuff(di, tgt);
        ctx.renderAll(); callback(); break;
      }
      ctx.addLog('🎯 DP-' + val + 'の対象を選んでください');
      showTargetSelection(opponentRowSide, dpTargets, null, uiColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          const tgt = opponent.battleArea[selectedIdx];
          sendEffectResult(tgt, 'dp_minus', ctx);
          addBuff(tgt, 'dp_minus', val, ctx);
          ctx.addLog('💥 ' + tgt.name + ' DP-' + val + ' → ' + tgt.dp);
          playEffect(action.code, { value: -val, ctx, label: tgt.name }, () => {});
          if(tgt.dp <= 0) tgt._pendingDestroy = true;
          sendDpRemoteBuff(selectedIdx, tgt);
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
      if(effectiveSide === 'ai') {
        const di = ctx._forceTargetIdx ?? destroyTargets[0];
        const card = opponent.battleArea[di];
        // 消滅演出 → doDestroy（on_destroy リアクション完了まで待つ）→ callback
        playEffect(action.code, { card, ctx }, () => {
          doDestroy(opponent, di, ctx, callback);
        });
        break;
      }
      ctx.addLog('🎯 消滅させる対象を選んでください');
      showTargetSelection(opponentRowSide, destroyTargets, null, borderColor, (selectedIdx) => {
        if(selectedIdx !== null) {
          const card = opponent.battleArea[selectedIdx];
          // 消滅演出 → doDestroy（on_destroy リアクション完了まで待つ）→ callback
          playEffect(action.code, { card, ctx }, () => {
            doDestroy(opponent, selectedIdx, ctx, callback);
          });
        } else { callback(); }
      });
      break;
    }
    case 'bounce': {
      // target_opponent_suspended が指定されていればレスト状態のみフィルタ
      const onlySuspended = defaultTarget && defaultTarget.code === 'target_opponent_suspended';
      const bounceTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) {
        const c = opponent.battleArea[i];
        if (!c) continue;
        if (onlySuspended && !c.suspended) continue;
        bounceTargets.push(i);
      }
      if(bounceTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      const bounceColor = uiColor;
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
      if (ctx.card) { ctx.card.suspended = false; ctx.addLog('🔄 「' + ctx.card.name + '」アクティブ'); }
      ctx.renderAll();
      callback();
      break;
    }
    case 'recover': {
      const n = action.value || 1;
      const recoverCard = player.deck.length > 0 ? player.deck[0] : null;
      for (let i = 0; i < n; i++) {
        if (player.deck.length > 0) { player.security.push(player.deck.splice(0, 1)[0]); ctx.addLog('🛡 セキュリティ+1'); }
      }
      ctx.renderAll();
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
    case 'evo_discard_top': {
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
      const discardFromTarget = (tgt, onDone) => {
        const discarded = [];
        for (let i = 0; i < n && tgt.stack.length > 0; i++) {
          const fromTop = action.code === 'evo_discard_top';
          const removed = fromTop ? tgt.stack.shift() : tgt.stack.pop();
          opponent.trash.push(removed);
          discarded.push(removed);
        }
        if (discarded.length === 0) { onDone && onDone(); return; }
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
          if (idx >= discarded.length) { onDone && onDone(); return; }
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
      // 破棄後の後処理（永続効果再計算 + 描画 + 同期）
      const afterDiscard = () => {
        // 進化元が変わったので永続効果を再計算（SA+/DP+等）
        const oppSide = effectiveSide === 'player' ? 'ai' : 'player';
        try { applyPermanentEffects(ctx.bs, oppSide, ctx); } catch(_) {}
        ctx.renderAll();
        if (window._isOnlineMode && window._isOnlineMode()) { try { window._onlineSendStateSync(); } catch(_) {} }
      };
      // AIは自動選択、プレイヤーは対象選択UI
      if (effectiveSide === 'ai') {
        discardFromTarget(opponent.battleArea[ctx._forceTargetIdx ?? evoTargets[0]], () => {
          afterDiscard();
          callback();
        });
        break;
      }
      ctx.addLog('🎯 進化元を破棄する対象を選んでください');
      showTargetSelection(opponentRowSide, evoTargets, null, uiColor, (selectedIdx) => {
        if (selectedIdx !== null) {
          discardFromTarget(opponent.battleArea[selectedIdx], () => {
            afterDiscard();
            callback();
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
      // mainレシピがあればレシピ優先（テキスト解析よりも正確）
      const mainRecipe = getRecipeForCard(ctx.card, 'main');
      console.log('[use_main_effect]', 'card=' + (ctx.card && ctx.card.name), 'recipe type=' + typeof (ctx.card && ctx.card.recipe), 'recipe value=', ctx.card && ctx.card.recipe, 'mainRecipe=', mainRecipe, 'isArray=' + Array.isArray(mainRecipe), 'length=' + (mainRecipe && mainRecipe.length));
      if (mainRecipe) {
        ctx.addLog('✦ 「' + ctx.card.name + '」の【メイン】効果を発揮！');
        runRecipe(mainRecipe, ctx, callback);
      } else {
        // レシピなし → テキスト解析で実行
        const mainBlocks = parseCardEffect(ctx.card);
        const mainBlock = mainBlocks.find(b => b.trigger && b.trigger.code === 'main');
        if (mainBlock && mainBlock.actions && mainBlock.actions.length > 0) {
          ctx.addLog('✦ 「' + ctx.card.name + '」の【メイン】効果を発揮！');
          runActionList(mainBlock.actions, mainBlock.target, ctx, callback);
        } else {
          ctx.addLog('⚠ メイン効果が見つかりません');
          callback();
        }
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
      // 対象が相手デジモンの場合
      const restTargets = [];
      for(let i=0;i<opponent.battleArea.length;i++) { if(opponent.battleArea[i] && !opponent.battleArea[i].suspended) restTargets.push(i); }
      if(restTargets.length === 0) { ctx.addLog('⚠ 対象がいません'); showEffectFailed('効果を発動できませんでした', callback); break; }
      const restColor = uiColor;
      // 相手デジモンがレスト → when_opp_rest 発火（restedSide = 相手側）
      const restedSide = ctx.side === 'player' ? 'ai' : 'player';
      const finishWithTrigger = () => {
        fireWhenOppRestTriggers(restedSide, ctx.bs, ctx, callback);
      };
      if(effectiveSide === 'ai') {
        const ri = ctx._forceTargetIdx ?? restTargets[0];
        opponent.battleArea[ri].suspended = true;
        ctx.addLog('💤 「' + opponent.battleArea[ri].name + '」をレスト');
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
        ctx.addLog('🃏 「' + ctx.card.name + '」を手札に加える（セキュリティ効果終了時）');
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
  fireOnDestroyTriggers(destroyedSideName, ctx.bs, ctx, () => {
    callback && callback();
  });
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
  if (typeof window !== 'undefined' && window._tutorialAiSelectTarget) {
    const bs = window._lastBattleState || window.bs;
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
    // ただし、_skipFxEffectCloseフラグが立っている場合（複数選択途中等）は閉じない
    if (window._isOnlineMode && window._isOnlineMode() && !window._skipFxEffectClose) {
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
  }; // end _showUI

  // チュートリアル: 対象選択画面の前に割り込み
  const runner = window._tutorialRunner;
  if (runner && runner.active && typeof runner.checkInterrupt === 'function') {
    runner.checkInterrupt('target_selection').then(_showUI);
  } else {
    _showUI();
  }
}

// ===== デッキオープンUI（新仕様: filter/selections/return_to対応） =====
// レシピ仕様: { value, optional, selections:[{filter,count,destination}], return_to }
// セミ自動: フィルタにマッチするカードのみタップ可能、残りはタップ順にデッキへ戻す

// カードがフィルタにマッチするか判定
function cardMatchesFilter(card, filter) {
  if (!filter) return true;
  if (filter.type && card.type !== filter.type) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.cardno && card.cardNo !== filter.cardno) return false;
  if (filter.cardno_includes && !(card.cardNo || '').includes(filter.cardno_includes)) return false;
  if (filter.name && card.name !== filter.name) return false;
  if (filter.name_includes && !(card.name || '').includes(filter.name_includes)) return false;
  if (filter.lv_ge != null && (parseInt(card.level) || 0) < filter.lv_ge) return false;
  if (filter.lv_le != null && (parseInt(card.level) || 0) > filter.lv_le) return false;
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

  // === オーバーレイ ===
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:60000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.2s ease;';
  document.body.appendChild(overlay);

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;margin-bottom:8px;text-shadow:0 0 8px #00fbff;';
  titleEl.innerText = '📖 デッキオープン (' + opened.length + '枚)';
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

  // カード要素を作成
  const cardEls = opened.map(card => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:90px;height:126px;border:2px solid #444;border-radius:6px;overflow:hidden;cursor:default;transition:all 0.2s;background:#111;';
    const src = getImg(card);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      wrap.appendChild(img);
    } else {
      const fb = document.createElement('div');
      fb.style.cssText = 'padding:6px;font-size:9px;color:#aaa;';
      fb.innerText = card.name;
      wrap.appendChild(fb);
    }
    cardArea.appendChild(wrap);
    return { wrap, card, removed: false };
  });

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
  function runSelectionPhase() {
    if (selIdx >= selections.length) { runReturnPhase(); return; }
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
  function runReturnPhase() {
    const remaining = cardEls.filter(e => !e.removed);
    if (remaining.length === 0) { cleanup(); callback(); return; }
    if (returnTo === 'trash') {
      remaining.forEach(e => {
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
    };

    function refreshReturnUI() {
      const left = cardEls.filter(e => !e.removed);
      if (left.length === 0) { cleanup(); callback(); return; }
      let labelText = '残りカードをデッキに戻す';
      if (returnTo === 'deck_top') labelText += '（タップ順に上から積まれます）';
      else if (returnTo === 'deck_bottom') labelText += '（最後にタップしたカードが一番下）';
      else if (returnTo === 'deck_choice') labelText += '（タップして上/下を選択）';
      stepEl.innerText = labelText;
      clearButtons();
      cardEls.forEach(entry => {
        if (entry.removed) return;
        setCardReturnable(entry);
        entry.wrap.onclick = () => {
          if (entry.removed) return;
          if (returnTo === 'deck_choice') {
            showTopBottomChoice(entry.card, (pos) => {
              placeFn(entry.card, pos);
              removeEntry(entry);
              ctx.renderAll && ctx.renderAll();
              refreshReturnUI();
            });
          } else {
            const pos = returnTo === 'deck_top' ? 'top' : 'bottom';
            placeFn(entry.card, pos);
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
  }

  // 開始
  if (selections.length === 0) {
    runReturnPhase();
  } else {
    runSelectionPhase();
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
    showDpPopup(isPlus ? val : -val, card.name);
  }

  if (target.code === 'target_self' && ctx.card) {
    applyAndLog(ctx.card);
    ctx.renderAll(); callback && callback();
  } else if (target.code === 'target_all_own') {
    player.battleArea.forEach(c => { if (c) addBuffDirect(c, type, val, dur, ctx); });
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
          // 条件チェック
          if (step.condition) {
            const conds = parseRecipeCondition(step.condition);
            if (!checkConditions(conds, card, bs, side)) return;
          }
          // per_count倍率（valueが未指定なら1をデフォルトに）
          let value = step.value != null ? step.value : (step.per_count ? 1 : null);
          if (step.per_count && value != null) {
            const refSource = step.ref || 'evo_source';
            const count = getRefSourceCountDirect(refSource, card, bs, side);
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
      // カードのメイン効果テキストにキーワードが含まれる場合のみ適用
      const hasEvoSourcePassive = card.recipe.evo_source && card.recipe.evo_source.passive;
      if (card.recipe.passive && !hasEvoSourcePassive) {
        const mainEffect = card.effect || '';
        const passives = Array.isArray(card.recipe.passive) ? card.recipe.passive : [card.recipe.passive];
        passives.forEach(p => {
          const flag = typeof p === 'string' ? p : (p.flag || p.action || '');
          // 進化元効果のキーワードはバトルエリアでは適用しない
          const keywordMap = { 'security_attack_plus': 'Sアタック', 'blocker': 'ブロッカー', 'piercing': '突進', 'rush': '速攻', 'penetrate': '貫通', 'jamming': 'ジャミング', 'reboot': '再起動' };
          const kwText = keywordMap[flag];
          if (kwText && !mainEffect.includes(kwText) && card.evoSourceEffect && card.evoSourceEffect.includes(kwText)) return;
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
        });
      }
    }

    // ④ 進化元カードのレシピ永続効果
    if (card.stack) {
      card.stack.forEach(evoCard => {
        if (!evoCard.recipe) return;
        if (typeof evoCard.recipe === 'string') {
          try { evoCard.recipe = JSON.parse(evoCard.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '')); } catch (_) { evoCard.recipe = null; }
        }
        if (!evoCard.recipe) return;
        const evoRecipe = evoCard.recipe.evo_source || evoCard.recipe;
        const turnKeys = ['during_own_turn', 'during_opp_turn', 'during_any_turn'];
        turnKeys.forEach(tk => {
          if (!evoRecipe[tk]) return;
          if (tk === 'during_own_turn' && side !== turnSide) return;
          if (tk === 'during_opp_turn' && side === turnSide) return;
          const steps = Array.isArray(evoRecipe[tk]) ? evoRecipe[tk] : [evoRecipe[tk]];
          steps.forEach(step => {
            if (step.condition) {
              const conds = parseRecipeCondition(step.condition);
              if (!checkConditions(conds, card, bs, side)) return;
            }
            let value = step.value != null ? step.value : (step.per_count ? 1 : null);
            if (step.per_count && value != null) {
              const refSource = step.ref || 'evo_source';
              const count = getRefSourceCountDirect(refSource, card, bs, side);
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
  const parts = condStr.split(':');
  if (parts[0] === 'cond_exists') {
    // "cond_exists:cond_no_evo" → [{code:'cond_exists'}, {code:'cond_no_evo'}]
    // "cond_exists:cond_has_evo:4" → [{code:'cond_exists'}, {code:'cond_has_evo', value:4}]
    const result = [{code: 'cond_exists'}];
    if (parts.length >= 2) {
      const nested = parts.slice(1).join(':');
      const nestedParts = nested.split(':');
      result.push({code: nestedParts[0], value: nestedParts[1] ? parseInt(nestedParts[1]) : undefined});
    }
    return result;
  }
  // "cond_lv_le:5" → [{code:'cond_lv_le', value:5}]
  // "cond_no_evo" → [{code:'cond_no_evo'}]
  // "dp_le:4000" → [{code:'cond_dp_le', value:4000}]  (auto-prefix cond_)
  let code = parts[0];
  if (!code.startsWith('cond_')) code = 'cond_' + code;
  return [{code: code, value: parts[1] ? parseInt(parts[1]) : undefined}];
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
      case 'cond_own_security_le': if (bs && bs[side] && bs[side].security && bs[side].security.length > (cond.value || 0)) return false; break;
      case 'cond_own_security_ge': if (bs && bs[side] && bs[side].security && bs[side].security.length < (cond.value || 0)) return false; break;
      case 'cond_during_own_turn': {
        // 「自分のターン」中のみ true。bs.isPlayerTurn の判定を side と照合
        if (!bs) break;
        const myTurn = (side === 'player' && bs.isPlayerTurn) || (side === 'ai' && !bs.isPlayerTurn);
        if (!myTurn) return false;
        break;
      }
      case 'cond_attack_target_digimon': {
        // 「相手のデジモンにアタックしたとき」: bs._lastAttackTarget が 'digimon' なら true
        if (!bs || bs._lastAttackTarget !== 'digimon') return false;
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
      case 'cond_self_active': {
        // 自身がアクティブ状態（レストしていない）の時 true
        if (card && card.suspended) return false;
        break;
      }
      case 'cond_during_opp_turn': {
        if (!bs) break;
        const myTurn = (side === 'player' && bs.isPlayerTurn) || (side === 'ai' && !bs.isPlayerTurn);
        if (myTurn) return false;
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
      // on_destroy リアクション → 完了 → 次の消滅へ
      fireOnDestroyTriggers(side, ctx.bs, ctx, processNext);
    });
  }
  processNext();
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
        runner.checkInterrupt('effect_confirm').then(() => {});
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
  if (window._effectConfirmCallback) {
    window._effectConfirmCallback(yes);
    window._effectConfirmCallback = null;
  }
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

function scanTriggers(triggerCode, sourceCard, sourceSide, ctx) {
  const turnPlayer = ctx.bs.isPlayerTurn ? 'player' : 'ai';

  // 起動効果（main等）はソースカードのみ処理。盤面スキャン不要
  const isActivated = ['main'].includes(triggerCode);
  // ソースカード限定のイベント系トリガー（そのカード固有のイベント）
  // これらは盤面全体をスキャンすると関係ない他カードの効果まで誘発してしまう
  const isSourceOnly = ['on_play', 'on_evolve', 'on_attack', 'on_attack_end', 'security', 'when_blocked', 'on_battle_win'].includes(triggerCode);

  if (isActivated) {
    // 起動効果: ソースカードだけキューに追加（レシピ優先）
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
      } else {
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
  } else if (isSourceOnly) {
    // ソースカード限定イベント: ソースカード本体＋その進化元効果のみ処理
    if (sourceCard) {
      // レシピ優先：レシピがあればテキスト解析をスキップ
      const mainRecipe = getRecipeForTrigger(sourceCard, triggerCode);
      if (mainRecipe) {
        const dummyBlock = {
          raw: sourceCard.effect || '', trigger: { code: triggerCode },
          actions: [], conditions: [],
        };
        addToQueue(sourceCard, dummyBlock,
          sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
        );
      } else {
        const blocks = parseCardEffect(sourceCard);
        blocks.forEach(block => {
          if (block.trigger && block.trigger.code === triggerCode) {
            addToQueue(sourceCard, block,
              sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
            );
          }
        });
      }
      // ソースカードの進化元効果もスキャン（テキスト解析 + レシピ）
      if (sourceCard.stack) {
        sourceCard.stack.forEach(evoCard => {
          if (!evoCard.evoSourceEffect || evoCard.evoSourceEffect === 'なし') return;
          // レシピがある場合はレシピを優先（進化元コンテキストなので inEvoSource=true）
          const evoRecipeSteps = getRecipeForTrigger(evoCard, triggerCode, true);
          if (evoRecipeSteps) {
            // レシピを実行するためのダミーブロックをキューに追加
            const dummyBlock = {
              raw: evoCard.evoSourceEffect, trigger: { code: triggerCode },
              actions: [], conditions: [], _recipeCard: evoCard,
            };
            addToQueue(sourceCard, dummyBlock,
              sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
            );
            return;
          }
          // テキスト解析フォールバック
          const evoBlocks = parseCardEffect(evoCard, evoCard.evoSourceEffect);
          evoBlocks.forEach(block => {
            if (block.trigger && block.trigger.code === triggerCode) {
              addToQueue(sourceCard, block,
                sourceSide === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', 'normal', sourceSide
              );
            }
          });
        });
      }
    }
  } else {
    // 誘発効果: 盤面全体をスキャン（レシピ優先）
    ['player', 'ai'].forEach(side => {
      [...ctx.bs[side].battleArea, ...(ctx.bs[side].tamerArea || [])].forEach(card => {
        if (!card) return;
        const priority = triggerCode.startsWith('when_') ? 'interrupt' : 'normal';
        // レシピ優先
        const cardRecipe = getRecipeForTrigger(card, triggerCode);
        if (cardRecipe) {
          const dummyBlock = {
            raw: card.effect || '', trigger: { code: triggerCode },
            actions: [], conditions: [],
          };
          addToQueue(card, dummyBlock, side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', priority, side);
        } else {
          const blocks = parseCardEffect(card);
          blocks.forEach(block => {
            if (block.trigger && block.trigger.code === triggerCode) {
              addToQueue(card, block, side === turnPlayer ? 'turnPlayer' : 'nonTurnPlayer', priority, side);
            }
          });
        }
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
export function fireWhenOppRestTriggers(restedSide, bs, ctxBase, done) {
  const finish = () => { try { done && done(); } catch(_) {} };
  if (!bs) { finish(); return; }
  const reactSide = restedSide === 'player' ? 'ai' : 'player';
  const reactPlayer = bs[reactSide];
  if (!reactPlayer) { finish(); return; }
  // バトルエリア + テイマーエリアをスキャン
  const cards = [...(reactPlayer.battleArea || []), ...(reactPlayer.tamerArea || [])].filter(c => c);
  const reactions = [];
  cards.forEach(card => {
    if (!card.recipe) return;
    try {
      const raw = typeof card.recipe === 'string' ? card.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : card.recipe;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const recipe = r.when_opp_rest;
      if (recipe && Array.isArray(recipe)) {
        // 実行可能性事前チェック (条件 + once_per_turn)
        const willRun = recipe.some(step => {
          if (step.condition) {
            const conds = parseRecipeCondition(step.condition);
            if (!checkConditions(conds, card, bs, reactSide)) return false;
          }
          if (step.limit === 'once_per_turn' || step.limit === 'limit_once_per_turn') {
            const sourceId = card.cardNo || card.name || 'unknown';
            const limitKey = sourceId + '@' + sourceId + '_recipe_' + step.action;
            if (bs._usedLimits && bs._usedLimits[limitKey]) return false;
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
export function fireOnDestroyTriggers(destroyedSide, bs, ctxBase, done) {
  const finish = () => { try { done && done(); } catch(_) {} };
  if (!bs) { finish(); return; }
  // 反対側 = リアクション側
  const reactSide = destroyedSide === 'player' ? 'ai' : 'player';
  const reactPlayer = bs[reactSide];
  if (!reactPlayer || !reactPlayer.battleArea) { finish(); return; }

  // 全 carrier × 全進化元（+ carrier 自身）から on_destroy レシピを収集
  const reactions = [];
  reactPlayer.battleArea.forEach((carrier) => {
    if (!carrier) return;
    // 1) 進化元カードそれぞれの on_destroy をスキャン
    if (carrier.stack) {
      carrier.stack.forEach(evoCard => {
        if (!evoCard || !evoCard.recipe) return;
        try {
          const raw = typeof evoCard.recipe === 'string'
            ? evoCard.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : evoCard.recipe;
          const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
          // 進化元効果専用: evo_source.on_destroy のみ拾う
          const recipe = r.evo_source && r.evo_source.on_destroy;
          if (recipe) {
            reactions.push({ sourceCard: evoCard, recipe, carrier });
          }
        } catch (_) {}
      });
    }
    // 2) carrier 自身の on_destroy（メイン効果として）
    if (carrier.recipe) {
      try {
        const raw = typeof carrier.recipe === 'string'
          ? carrier.recipe.replace(/[\x00-\x1F\x7F]\s*/g, '') : carrier.recipe;
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (r.on_destroy) {
          reactions.push({ sourceCard: carrier, recipe: r.on_destroy, carrier });
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
    showReactionOrderSelect(remaining, (chosenIdx) => {
      const [r] = remaining.splice(chosenIdx, 1);
      runOne(r, nextReaction);
    });
  }
  nextReaction();
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

// レシピが実行されるか事前判定（全ステップが条件で弾かれるか）
// 戻り値: true=少なくとも1ステップが実行される, false=全ステップが条件NGで何も起きない
// 不確定な場合（store依存・ターゲット選択型など）は安全側で true を返す
function recipeWillExecuteAnything(recipe, ctx) {
  if (!recipe || !Array.isArray(recipe) || recipe.length === 0) return true;
  for (const step of recipe) {
    // 条件なし → 必ず実行される
    if (!step.condition) {
      console.log('[recipeWillExecute] step has no condition → true', 'action=' + step.action);
      return true;
    }
    // 条件あり → 評価
    const conds = parseRecipeCondition(step.condition);
    const result = checkConditions(conds, ctx.card, ctx.bs, ctx.side);
    console.log('[recipeWillExecute]', 'action=' + step.action, 'condition=' + step.condition, 'parsed=' + JSON.stringify(conds), '→ ' + result);
    if (result) return true;
  }
  console.log('[recipeWillExecute] all steps blocked → false');
  return false;
}

// レシピを順次実行
function runRecipe(steps, ctx, callback) {
  const store = {}; // ステップ間データ受け渡し用
  let idx = 0;
  console.log('[runRecipe]', 'card=' + (ctx.card && ctx.card.name), 'steps.length=' + (steps && steps.length), 'isArray=' + Array.isArray(steps), 'first=', steps && steps[0]);

  function nextStep(success) {
    // コスト不足等で効果不発
    if (success === false) { console.log('[runRecipe] aborted (success=false)'); ctx.renderAll(); callback && callback(); return; }
    if (idx >= steps.length) { console.log('[runRecipe] completed all steps'); ctx.renderAll(); callback && callback(); return; }
    const step = steps[idx++];
    console.log('[runRecipe] executing step', idx, 'action=' + step.action, 'target=' + step.target);
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
        console.log('[select opponent]', 'ctxSide=' + ctx.side, 'opponent.battleArea.length=' + opponent.battleArea.length, 'valid=' + valid.length, 'cards=' + opponent.battleArea.filter(c => c).map(c => c.name).join(','));
        if (valid.length === 0) { console.log('[select opponent] FAILED: no valid targets'); showEffectFailed(null, callback); return; }
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
      // 「N体まで」は任意効果。0体選択も可能。
      const isOptional = maxCount > 1; // 複数選択は基本的に任意（〜まで）
      let selectedCount = 0;
      const selected = [];

      // 確認ダイアログ共通
      const showConfirmDialog = (msgText, onYes, onNo) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:65000;display:flex;align-items:center;justify-content:center;padding:20px;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#0a0a0a;border:1px solid #ff4444;border-radius:12px;padding:24px;max-width:320px;width:100%;text-align:center;';
        box.innerHTML = '<div style="color:#ff4444;font-size:14px;font-weight:bold;margin-bottom:16px;">' + msgText + '</div>'
          + '<div style="display:flex;gap:10px;justify-content:center;">'
          + '<button id="_conf-yes" style="background:#ff4444;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">はい</button>'
          + '<button id="_conf-no" style="background:#333;color:#fff;border:1px solid #666;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;">いいえ</button>'
          + '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        document.getElementById('_conf-yes').onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); onYes(); };
        document.getElementById('_conf-no').onclick = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); onNo(); };
      };

      function getValidTargets() {
        const valid = [];
        for (let i = 0; i < opponent.battleArea.length; i++) {
          const c = opponent.battleArea[i];
          if (!c || selected.includes(i)) continue;
          if (step.condition) {
            const [condType, condVal] = step.condition.split(':');
            const cardDp = parseInt(c.dp) || 0;
            const limitDp = parseInt(condVal) || 0;
            if (condType === 'dp_le' && cardDp > limitDp) continue;
            if (condType === 'dp_ge' && cardDp < limitDp) continue;
            if (condType === 'lv_le' && (parseInt(c.level) || 0) > parseInt(condVal)) continue;
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

      // 任意の場合は最初の選択前にも確認、強制の場合は即選択
      if (isOptional) {
        askToSelect();
      } else {
        doSelect();
      }
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
      if (step.target === 'self' && step.cost_free) {
        const cardToSummon = ctx.card;
        if (!cardToSummon) { callback(); break; }
        const p = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
        if (cardToSummon.type === 'テイマー') {
          p.tamerArea.push(cardToSummon);
          ctx.addLog('🌟 「' + cardToSummon.name + '」をコストを支払わずに登場');
        } else {
          p.battleArea.push(cardToSummon);
          ctx.addLog('🌟 「' + cardToSummon.name + '」をコストを支払わずに登場');
        }
        ctx.renderAll();
        callback();
        break;
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
      showDeckOpenUI(opened, step, ctx, () => {
        ctx.renderAll && ctx.renderAll();
        callback && callback();
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
        callback && callback(false); // 失敗 → 後続スキップ
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
        // 選択された evo card を carrier.stack から取り除いて trash へ
        selectedCards.forEach(ec => {
          const idx = carrier.stack.indexOf(ec);
          if (idx !== -1) {
            carrier.stack.splice(idx, 1);
            player.trash.push(ec);
            ctx.addLog && ctx.addLog('🗑 「' + ec.name + '」を進化元から破棄');
          }
        });
        ctx.renderAll();
        callback && callback(true);
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

    // === storeの対象にバフ/状態を直接適用 ===
    case 'cant_attack_block':
    case 'cant_attack':
    case 'cant_block':
    case 'cant_evolve': {
      const dur = normalizeRecipeDuration(step.duration) || (ctx.block && ctx.block.duration ? ctx.block.duration.code : 'dur_this_turn');
      const storedData = step.card ? store[step.card] : null;
      const targets = storedData ? (Array.isArray(storedData) ? storedData : [storedData]) : null;
      if (targets && targets.length > 0) {
        targets.forEach(t => {
          const c = opponent.battleArea[t.idx];
          if (!c) return;
          if (step.action === 'cant_attack_block' || step.action === 'cant_attack') c.cantAttack = true;
          if (step.action === 'cant_attack_block' || step.action === 'cant_block') c.cantBlock = true;
          if (step.action === 'cant_evolve') c.cantEvolve = true;
          addBuffDirect(c, step.action, 0, dur, ctx);
          ctx.addLog('🔒 「' + c.name + '」' + (step.action === 'cant_attack_block' ? 'アタック・ブロック不可' : step.action === 'cant_attack' ? 'アタック不可' : step.action === 'cant_block' ? 'ブロック不可' : '進化不可'));
        });
        ctx.renderAll();
        callback();
      } else {
        // storeが無い場合は既存エンジンに委譲
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
      }
      break;
    }

    // === キーワード付与 ===
    // grant_keyword: 単体（step.flag等で指定）
    // grant_keyword_all: 全体（step.keyword="Sアタック+1"等のテキストで指定、step.target="own_all_digimon"等）
    case 'grant_keyword':
    case 'grant_keyword_all': {
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
          };
          flag = flagMap[kw] || kw;
        }
      }

      // 対象解決
      const resolveTargets = () => {
        const p = ctx.side === 'player' ? ctx.bs.player : ctx.bs.ai;
        const opp = ctx.side === 'player' ? ctx.bs.ai : ctx.bs.player;
        const t = step.target;
        if (t === 'self') return ctx.card ? [ctx.card] : [];
        if (t === 'own:all' || t === 'own_all_digimon') return p.battleArea.filter(c => c);
        if (t === 'opponent:all' || t === 'opp_all_digimon') return opp.battleArea.filter(c => c);
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
        } else {
          // 一般キーワードバフ (blocker, piercing 等)
          addBuffDirect(tgt, 'keyword_' + flag, 0, dur, ctx);
          ctx.addLog('✨ 「' + tgt.name + '」に【' + flag + '】付与');
        }
      });
      ctx.renderAll();
      callback();
      break;
    }

    // === その他のアクション（既存エンジンに委譲） ===
    default: {
      // once_per_turn制限チェック（レシピ形式）
      // 制限キーには **source card**（=evo card 等の本来の効果元）を含める。
      // ctx._sourceCard があればそれを優先（fireOnDestroyTriggers から呼ばれた場合）
      if ((step.limit === 'once_per_turn' || step.limit === 'limit_once_per_turn') && ctx.bs) {
        const sourceCard = ctx._sourceCard || ctx.card;
        const sourceId = (sourceCard && (sourceCard.cardNo || sourceCard.name)) || 'unknown';
        const carrierId = (ctx.card && (ctx.card.cardNo || ctx.card.name)) || 'unknown';
        const limitKey = sourceId + '@' + carrierId + '_recipe_' + step.action;
        if (!ctx.bs._usedLimits) ctx.bs._usedLimits = {};
        console.log('[limit-check]', 'key=' + limitKey, 'used=' + !!ctx.bs._usedLimits[limitKey], 'allKeys=' + JSON.stringify(Object.keys(ctx.bs._usedLimits)));
        if (ctx.bs._usedLimits[limitKey]) {
          ctx.addLog && ctx.addLog('⏸ ターンに1回の制限（' + (sourceCard ? sourceCard.name : '?') + '）');
          callback && callback();
          break;
        }
        ctx.bs._usedLimits[limitKey] = true;
      }
      // per_count倍率を適用
      let effectiveValue = step.value != null ? step.value : (step.per_count ? 1 : null);
      if (step.per_count && effectiveValue != null) {
        const refSource = step.ref || 'evo_source';
        const count = getRefSourceCountDirect(refSource, ctx.card, ctx.bs, ctx.side);
        effectiveValue = effectiveValue * Math.floor(count / step.per_count);
      }
      // レシピのアクション名を既存エンジンのアクション名にマッピング
      let actionCode = step.action;
      if (actionCode === 'active_self') { actionCode = 'active'; }
      if (actionCode === 'trash_evo_bottom') { actionCode = 'evo_discard_bottom'; }
      // レシピのtarget形式 → runOneAction形式に変換
      const action = { code: actionCode, value: effectiveValue };
      let target = null;
      if (step.target) {
        const t = step.target;
        if (t === 'self') target = { code: 'target_self' };
        else if (t === 'own:all') target = { code: 'target_all_own' };
        else if (t === 'opponent:all') target = { code: 'target_all_opponent' };
        else if (t === 'own_security:all') target = { code: 'target_all_own_security' };
        else if (t.startsWith('opponent_suspended:')) target = { code: 'target_opponent_suspended', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('own:')) target = { code: 'target_own', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('opponent:')) target = { code: 'target_opponent', count: parseInt(t.split(':')[1]) || 1 };
        else if (t.startsWith('other_own:')) target = { code: 'target_other_own', count: parseInt(t.split(':')[1]) || 1 };
        else target = { code: 'target_' + t };
      }
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

  // Check _permEffects (set by applyPermanentEffects)
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
