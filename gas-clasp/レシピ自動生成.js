/**
 * デジモンカードゲーム - 効果レシピ自動生成 GAS
 *
 * メニュー:
 *   🃏 カード管理 > 🔄 辞書を自動補完
 *   🃏 カード管理 > 📝 レシピ一括生成
 *   🃏 カード管理 > 📋 レシピ生成ログ確認
 */

// ===== シート名・列定数 =====
const SHEET_CARDS = 'カード情報一覧（新）';
const SHEET_TRIGGER_DICT = '効果辞書';
const SHEET_ACTION_DICT = '効果アクション辞書';
const SHEET_LOG = 'レシピ生成ログ';

// ===== メニュー登録 =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🃏 カード管理')
    .addItem('🔄 辞書を自動補完（効果辞書＋アクション辞書）', 'autoCompleteAll')
    .addItem('📝 レシピ一括生成', 'generateAllRecipes')
    .addItem('📋 レシピ生成ログをクリア', 'clearLog')
    .addToUi();
}

// 両辞書をまとめて補完
function autoCompleteAll() {
  const r1 = autoCompleteDict();
  const r2 = autoCompleteActionDict();
  SpreadsheetApp.getUi().alert(
    '辞書補完完了!\n\n' +
    '📘 効果辞書: ' + (r1 || 0) + '件更新\n' +
    '📗 アクション辞書: ' + (r2 || 0) + '件更新\n\n' +
    '黄色背景のセルは自動生成されたものです。確認してください。'
  );
}

// ===== 辞書読み込みヘルパー =====
function loadTriggerDict() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TRIGGER_DICT);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r['処理コード'] && r['キーワード']);
}

function loadActionDict() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ACTION_DICT);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r['アクションコード']);
}

// ===== ログ出力 =====
function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LOG);
    sheet.appendRow(['カードNo', 'カード名', '出現元', '該当テキスト', 'マッチしなかった文言', '生成日時']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4a86c8').setFontColor('white');
  }
  return sheet;
}

function addLog(cardNo, cardName, source, text, unmatched) {
  getLogSheet().appendRow([cardNo, cardName, source, text, unmatched, new Date()]);
}

function clearLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOG);
  if (sheet) {
    sheet.clear();
    sheet.appendRow(['カードNo', 'カード名', '出現元', '該当テキスト', 'マッチしなかった文言', '生成日時']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4a86c8').setFontColor('white');
  }
  SpreadsheetApp.getUi().alert('ログをクリアしました。');
}

// ===== 辞書自動補完 =====
function autoCompleteDict() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TRIGGER_DICT);
  if (!sheet) { SpreadsheetApp.getUi().alert('効果辞書シートが見つかりません'); return; }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colCode = headers.indexOf('処理コード');
  const colType = headers.indexOf('種類');
  const colKeyword = headers.indexOf('キーワード');
  const colDesc = headers.indexOf('効果説明');
  const colNote = headers.indexOf('備考');

  if (colCode < 0 || colKeyword < 0) {
    SpreadsheetApp.getUi().alert('効果辞書に「処理コード」「キーワード」列が必要です');
    return;
  }

  const actionDict = loadActionDict();
  let updated = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const keyword = String(row[colKeyword] || '').trim();
    if (!keyword) continue;

    // 処理コード自動生成（空欄のみ）
    if (colCode >= 0 && !row[colCode]) {
      const code = generateProcessCode(keyword);
      sheet.getRange(i + 1, colCode + 1).setValue(code);
      updated++;
    }

    // 種類自動推定（空欄のみ）
    if (colType >= 0 && !row[colType]) {
      const type = guessType(keyword);
      sheet.getRange(i + 1, colType + 1).setValue(type);
      updated++;
    }

    // 効果説明の自動生成（空欄＆備考あり）
    if (colDesc >= 0 && !row[colDesc] && colNote >= 0 && row[colNote]) {
      const desc = normalizeDescription(String(row[colNote]), actionDict);
      if (desc) {
        sheet.getRange(i + 1, colDesc + 1).setValue(desc).setBackground('#ffffcc');
        updated++;
      }
    }
  }

  return updated;
}

// ===== 効果アクション辞書の自動補完（演出コード） =====
function autoCompleteActionDict() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ACTION_DICT);
  if (!sheet) return 0;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colEffectType = headers.indexOf('演出タイプ');
  const colEffectCode = headers.indexOf('演出コード');

  if (colEffectType < 0 || colEffectCode < 0) return 0;

  // 日本語の演出タイプ → 演出コードのマッピング
  const TYPE_TO_CODE = {
    '数値ポップアップ+': 'popup_plus',
    '数値ポップアップ-': 'popup_minus',
    '数値ポップアップ': 'popup_plus',  // +/-なしはデフォルト+
    '消滅演出': 'card_destroy',
    'カード登場': 'card_appear',
    'カード登場演出': 'card_appear',
    'カード表示演出': 'draw_card',
    'カード進化': 'card_evolve',
    'カード進化演出': 'card_evolve',
    'カード移動': 'card_move',
    'カード移動演出': 'card_move',
    '移動演出': 'card_move',
    'VS画面': 'vs_battle',
    '対象選択': 'target_select',
    '対象選択UI': 'target_select',
    '効果確認ダイアログ': 'confirm_dialog',
    'ダイアログ': 'confirm_dialog',
    '状態付与': 'buff_status',
    '状態付与演出': 'buff_status',
    'ドロー': 'draw_card',
    'ドロー演出': 'draw_card',
    'オープン': 'deck_open',
    'オープン演出': 'deck_open',
    'カードめくり演出': 'deck_open',
    'アプ合体': 'app_gattai',
    'アプ合体演出': 'app_gattai',
    'リンク': 'link_effect',
    'リンク演出': 'link_effect',
    '文字ポップアップ': 'text_popup',
    'ブロック': 'block_dialog',
    'ブロックダイアログ': 'block_dialog',
    'Sアタック': 'sattack_plus',
    'Sアタック+': 'sattack_plus',
    'セキュリティチェック演出': 'sattack_plus',
    'ジョグレス': 'jogress_evolve',
    'ジョグレス進化': 'jogress_evolve',
    'ジョグレス演出': 'jogress_evolve',
    'なし': 'none',
    '': 'none',
    'ゲージ移動': 'popup_plus',
    'ゲージ移動演出': 'popup_plus',
    'ゲージアニメーション': 'popup_plus',
    'セキュリティ追加演出': 'card_move',
    'セキュリティ除去演出': 'card_move',
    '回転演出': 'none',
    'バリア演出': 'text_popup',
  };

  let updated = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const typeText = String(row[colEffectType] || '').trim();
    const existingCode = String(row[colEffectCode] || '').trim();

    // 演出コードが空欄＆演出タイプが記入済みの場合のみ自動入力
    if (!existingCode && typeText) {
      const code = TYPE_TO_CODE[typeText] || guessEffectCode(typeText);
      if (code) {
        sheet.getRange(i + 1, colEffectCode + 1).setValue(code).setBackground('#ffffcc');
        updated++;
      }
    }
  }

  return updated;
}

// 演出タイプの日本語からコードを推定（マップに無い場合のフォールバック）
function guessEffectCode(typeText) {
  if (!typeText) return 'none';
  if (typeText.includes('ポップアップ') && typeText.includes('-')) return 'popup_minus';
  if (typeText.includes('ポップアップ') && typeText.includes('+')) return 'popup_plus';
  if (typeText.includes('ポップアップ')) return 'text_popup';
  if (typeText.includes('消滅')) return 'card_destroy';
  if (typeText.includes('登場')) return 'card_appear';
  if (typeText.includes('進化')) return 'card_evolve';
  if (typeText.includes('移動') || typeText.includes('飛ぶ')) return 'card_move';
  if (typeText.includes('VS') || typeText.includes('バトル')) return 'vs_battle';
  if (typeText.includes('選択')) return 'target_select';
  if (typeText.includes('ダイアログ') || typeText.includes('確認')) return 'confirm_dialog';
  if (typeText.includes('状態') || typeText.includes('付与')) return 'buff_status';
  if (typeText.includes('ドロー') || typeText.includes('カード表示')) return 'draw_card';
  if (typeText.includes('オープン') || typeText.includes('めくり')) return 'deck_open';
  if (typeText.includes('アプ合体')) return 'app_gattai';
  if (typeText.includes('リンク')) return 'link_effect';
  if (typeText.includes('ブロック')) return 'block_dialog';
  if (typeText.includes('セキュリティチェック') || typeText.includes('Sアタック')) return 'sattack_plus';
  if (typeText.includes('ジョグレス')) return 'jogress_evolve';
  if (typeText.includes('なし')) return 'none';
  return 'none';
}

// キーワードから処理コードを生成
function generateProcessCode(keyword) {
  // 【】を除去
  let clean = keyword.replace(/[【】≪≫〔〕《》〈〉]/g, '').trim();
  // {N}等のパラメータを除去
  clean = clean.replace(/\{[^}]+\}/g, '').replace(/[+\-]\d+/g, '').trim();
  // 日本語→英語の簡易変換マップ
  const map = {
    'ブロッカー': 'blocker', '速攻': 'rush', '突進': 'piercing', '貫通': 'penetrate',
    'ジャミング': 'jamming', '再起動': 'reboot', '進撃': 'assault',
    '退化': 'dedigivolve', '道連れ': 'tomodure', 'デジバースト': 'digiburst',
    'ディレイ': 'delay', 'デコイ': 'decoy', 'アーマー解除': 'armor_purge',
    'セーブ': 'save', '回避': 'evade', '連携': 'cooperation', '防壁': 'barrier',
    'ブラスト進化': 'blast_evolve', '不屈': 'fortitude', 'マインドリンク': 'mind_link',
    'パーティション': 'partition', '衝突': 'collision', 'ブラストジョグレス': 'blast_jogress',
    'スケープゴート': 'scapegoat', 'ヴォルテクス': 'vortex', 'オーバークロック': 'overclock',
    '氷装': 'ice_clad', 'デコード': 'decode', 'フラグメント': 'fragment',
    'エグゼキュート': 'execute', 'プログレス': 'progress', 'トレーニング': 'training',
    'リカバリー': 'recovery', '吸収進化': 'absorb_evolve', 'マテリアルセーブ': 'material_save',
    'Sアタック': 'security_attack_plus', 'ドロー': 'keyword_draw',
    'リンク': 'link_plus', '天昇': 'ascension', 'オーバーフロー': 'overflow',
    '使用条件': 'use_condition', 'デジクロス': 'digicross', 'アプ合体': 'app_gattai',
    'アセンブリ': 'assembly', 'アーマー体': 'armor',
    '登場時': 'on_play', '進化時': 'on_evolve', 'アタック時': 'on_attack',
    'アタック終了時': 'on_attack_end', '消滅時': 'on_destroy',
    '自分のターン開始時': 'on_own_turn_start', '自分のターン終了時': 'on_own_turn_end',
    '相手のターン開始時': 'on_opp_turn_start', '相手のターン終了時': 'on_opp_turn_end',
    '自分のターン': 'during_own_turn', '相手のターン': 'during_opp_turn',
    'お互いのターン': 'during_any_turn', 'メイン': 'main', 'セキュリティ': 'security',
    'カウンター': 'counter', '手札': 'from_hand', 'トラッシュ': 'from_trash',
    'ターンに1回': 'limit_once_per_turn', 'リンク時': 'on_link',
  };
  for (const [jp, en] of Object.entries(map)) {
    if (clean.includes(jp)) return en;
  }
  // マップにない場合はローマ字風に
  return clean.toLowerCase().replace(/\s+/g, '_');
}

// キーワードから種類を推定
function guessType(keyword) {
  const clean = keyword.replace(/[【】≪≫〔〕]/g, '');
  if (/時$|時】$/.test(clean)) return 'trigger';
  if (/ターン】?$/.test(clean)) return 'continuous';
  if (/1回|一回/.test(clean)) return 'limit';
  // パッシブ系キーワード
  const passives = ['ブロッカー','速攻','突進','貫通','ジャミング','再起動','Sアタック','衝突','プログレス','リンク+','氷装','トレーニング','アーマー体','使用条件'];
  if (passives.some(p => clean.includes(p))) return 'passive';
  return 'trigger';
}

// 備考を効果説明に標準化
function normalizeDescription(note, actionDict) {
  if (!note) return '';
  let result = note;
  // アクション辞書のキーワードで置換を試みる
  for (const entry of actionDict) {
    const code = String(entry['アクションコード'] || '').trim();
    if (!code) continue;
    const keywords = String(entry['アクション名'] || '').split(',');
    for (const kw of keywords) {
      const trimmed = kw.trim();
      if (!trimmed || trimmed.length < 2) continue;
      // 備考内にキーワードが含まれていれば、辞書のキーワードに統一
      if (result.includes(trimmed)) return result; // 既にマッチ → そのまま返す
    }
  }
  return result; // マッチしなくても備考テキストをそのまま返す
}

// ===== レシピ一括生成 =====
function generateAllRecipes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = ss.getSheetByName(SHEET_CARDS);
  if (!cardSheet) { SpreadsheetApp.getUi().alert('カード情報一覧（新）シートが見つかりません'); return; }

  const triggerDict = loadTriggerDict();
  const actionDict = loadActionDict();

  const data = cardSheet.getDataRange().getValues();
  const headers = data[0];

  // 列インデックス取得（ヘッダー名で探す）
  const colNo = headers.indexOf('カードNo');
  const colName = headers.indexOf('名前');
  const colEffect = headers.indexOf('効果テキスト');
  const colEvo = headers.indexOf('進化元テキスト');
  const colSec = headers.indexOf('セキュリティテキスト');
  const colRecipe = headers.indexOf('レシピ');

  if (colEffect < 0 || colRecipe < 0) {
    SpreadsheetApp.getUi().alert('必要な列が見つかりません（効果テキスト、レシピ）');
    return;
  }

  // ログシートをクリア
  clearLogSilent();

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cardNo = String(row[colNo] || '').trim();
    const cardName = String(row[colName] || '').trim();
    if (!cardNo) continue;

    const effectText = String(row[colEffect] || '').trim();
    const evoText = String(row[colEvo] || '').trim();
    const secText = String(row[colSec] || '').trim();

    if (!effectText && !evoText && !secText) {
      skipped++;
      continue;
    }

    try {
      const recipe = {};
      const allUnmatched = [];

      // 効果テキスト解析
      if (effectText) {
        const result = parseEffectText(effectText, triggerDict, actionDict);
        mergeRecipe(recipe, result.recipe);
        result.unmatched.forEach(u => allUnmatched.push({ text: u, source: '効果' }));
      }

      // 進化元効果解析
      if (evoText) {
        const result = parseEffectText(evoText, triggerDict, actionDict);
        mergeRecipe(recipe, result.recipe);
        result.unmatched.forEach(u => allUnmatched.push({ text: u, source: '進化元' }));
      }

      // セキュリティ効果解析
      if (secText) {
        const result = parseEffectText(secText, triggerDict, actionDict);
        mergeRecipe(recipe, result.recipe);
        result.unmatched.forEach(u => allUnmatched.push({ text: u, source: 'セキュリティ' }));
      }

      // レシピ列に書き込み
      if (Object.keys(recipe).length > 0) {
        cardSheet.getRange(i + 1, colRecipe + 1).setValue(JSON.stringify(recipe));
        generated++;
      } else {
        skipped++;
      }

      // マッチしなかった文言をログ
      allUnmatched.forEach(u => {
        addLog(cardNo, cardName, u.source, u.text, u.text);
      });

    } catch (e) {
      errors++;
      addLog(cardNo, cardName, 'エラー', e.message, '解析エラー');
    }
  }

  SpreadsheetApp.getUi().alert(
    'レシピ生成完了!\n' +
    '✅ 生成: ' + generated + '件\n' +
    '⏭ スキップ（効果なし）: ' + skipped + '件\n' +
    '❌ エラー: ' + errors + '件\n\n' +
    '⚠ マッチしなかった文言は「' + SHEET_LOG + '」シートを確認してください。'
  );
}

function clearLogSilent() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOG);
  if (sheet) {
    sheet.clear();
    sheet.appendRow(['カードNo', 'カード名', '出現元', '該当テキスト', 'マッチしなかった文言', '生成日時']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4a86c8').setFontColor('white');
  }
}

// ===== テキスト解析エンジン =====

function parseEffectText(text, triggerDict, actionDict) {
  const recipe = {};
  const unmatched = [];

  if (!text) return { recipe, unmatched };

  // パッシブキーワード（【ブロッカー】等）のエスケープ
  const passiveKeywords = /【(ターンに[1一]回|ブロッカー|速攻|突進|貫通|ジャミング|再起動|Sアタック\+\d+|セキュリティアタック\+\d+|衝突|プログレス|氷装|リンク\+\d+|トレーニング|防壁)】/g;
  const escaped = text.replace(passiveKeywords, (m, p1) => '〔' + p1 + '〕');

  // 「このカードの【メイン】効果」パターンをエスケープ
  const selfRef = escaped.replace(/このカードの【メイン】効果/g, 'このカードのメイン効果');

  // 【】でブロック分割
  const parts = selfRef.split(/(?=【)/);

  for (const part of parts) {
    const restored = part.replace(/〔([^〕]+)〕/g, '【$1】').trim();
    if (!restored) continue;

    const blockResult = analyzeBlock(restored, triggerDict, actionDict);
    if (blockResult) {
      mergeRecipe(recipe, blockResult.recipe);
      blockResult.unmatched.forEach(u => unmatched.push(u));
    }
  }

  return { recipe, unmatched };
}

function analyzeBlock(text, triggerDict, actionDict) {
  const recipe = {};
  const unmatched = [];

  // トリガー検出
  const trigger = findTrigger(text, triggerDict);

  if (!trigger) {
    // トリガーなし → パッシブキーワードチェック
    const passiveFlags = extractPassiveFlags(text);
    if (passiveFlags.length > 0) {
      recipe['passive'] = passiveFlags;
    } else if (text.length > 5 && !/^[。、\s]+$/.test(text)) {
      // 意味のあるテキストなのに解析できない
      unmatched.push(text);
    }
    return { recipe, unmatched };
  }

  // トリガーの種類を判定
  const triggerEntry = triggerDict.find(d => {
    const keywords = String(d['キーワード']).split(',');
    return keywords.some(k => text.includes(k.trim()));
  });

  const triggerCode = trigger.code;
  const triggerType = String(triggerEntry && triggerEntry['種類'] || 'trigger');

  // パッシブキーワードの場合
  if (triggerType === 'passive') {
    const flags = extractPassiveFlags(text);
    if (flags.length > 0) {
      if (!recipe['passive']) recipe['passive'] = [];
      recipe['passive'] = recipe['passive'].concat(flags);
    }
    return { recipe, unmatched };
  }

  // 制限キーワードの場合（ターンに1回）→ 独立ブロックではない
  if (triggerType === 'limit') {
    return { recipe, unmatched }; // 次のブロックで処理される
  }

  // トリガー後のボディテキスト抽出
  const body = extractBody(text, trigger.keyword);
  if (!body) {
    recipe[triggerCode] = [];
    return { recipe, unmatched };
  }

  // ボディからアクション解析
  const steps = analyzeBody(body, triggerDict, actionDict, unmatched);

  // 制限チェック（【ターンに1回】がテキストに含まれるか）
  if (text.includes('ターンに1回') || text.includes('ターンに一回')) {
    steps.forEach(s => { if (!s.separator) s.limit = 'limit_once_per_turn'; });
  }

  if (steps.length > 0) {
    recipe[triggerCode] = steps;
  }

  return { recipe, unmatched };
}

// ===== fuzzyMatch: 助詞挿入・表記ゆれ対応のマッチング =====
function fuzzyMatch(text, keyword) {
  if (!text || !keyword || keyword.length < 2) return false;
  // 1. 完全一致
  if (text.includes(keyword)) return true;
  // 2. 末尾1文字削り（活用対応:「破棄する」→「破棄」）
  if (keyword.length >= 5) {
    const shorter = keyword.substring(0, keyword.length - 1);
    if (text.includes(shorter)) return true;
  }
  // 3. 助詞挿入許容（「進化元を破棄」→「進化元を、下から1枚破棄」でもヒット）
  const particleSplit = keyword.match(/^(.{2,}?)(を|に|で|から|まで|へ)(.{2,})$/);
  if (particleSplit) {
    const before = particleSplit[1];
    const after = particleSplit[3];
    const beforeIdx = text.indexOf(before);
    if (beforeIdx !== -1) {
      const afterIdx = text.indexOf(after, beforeIdx + before.length);
      if (afterIdx !== -1 && (afterIdx - beforeIdx - before.length) <= 20) return true;
    }
  }
  // 4. 「の」と「を」の交換許容（「進化元の下から」↔「進化元を、下から」）
  const swapped = keyword.replace(/の/g, 'を').replace(/を/g, 'の');
  if (swapped !== keyword && text.includes(swapped)) return true;
  // 5. 句読点を無視した一致（「進化元を、下から」→「進化元を下から」）
  const noPunct = text.replace(/[、。,.\s]/g, '');
  const kwNoPunct = keyword.replace(/[、。,.\s]/g, '');
  if (noPunct.includes(kwNoPunct)) return true;
  return false;
}

// トリガー検出
function findTrigger(text, triggerDict) {
  for (const entry of triggerDict) {
    const code = String(entry['処理コード'] || '').trim();
    const type = String(entry['種類'] || '').trim();
    if (!code) continue;
    const keywords = String(entry['キーワード']).split(',');
    for (const kw of keywords) {
      const trimmed = kw.trim();
      if (trimmed && text.includes(trimmed)) {
        return { keyword: trimmed, code, type };
      }
    }
  }
  return null;
}

// ボディテキスト抽出（トリガーキーワード後）
function extractBody(text, triggerKeyword) {
  const idx = text.indexOf(triggerKeyword);
  if (idx < 0) return text;
  let body = text.substring(idx + triggerKeyword.length);
  // 【】の閉じ括弧後から
  const closeIdx = body.indexOf('】');
  if (closeIdx >= 0) body = body.substring(closeIdx + 1);
  return body.trim();
}

// パッシブフラグ抽出
function extractPassiveFlags(text) {
  const flags = [];
  const patterns = [
    { regex: /【ブロッカー】/, flag: 'blocker' },
    { regex: /【速攻】/, flag: 'rush' },
    { regex: /【突進】/, flag: 'piercing' },
    { regex: /【貫通】/, flag: 'penetrate' },
    { regex: /【ジャミング】/, flag: 'jamming' },
    { regex: /【再起動】/, flag: 'reboot' },
    { regex: /【衝突】/, flag: 'collision' },
    { regex: /【プログレス】/, flag: 'progress' },
    { regex: /【氷装】/, flag: 'ice_clad' },
    { regex: /【トレーニング】/, flag: 'training' },
    { regex: /【防壁】/, flag: 'barrier' },
    { regex: /【Sアタック\+(\d+)】/, flag: 'security_attack_plus', hasValue: true },
    { regex: /【リンク\+(\d+)】/, flag: 'link_plus', hasValue: true },
  ];
  for (const p of patterns) {
    const m = text.match(p.regex);
    if (m) {
      const entry = { flag: p.flag };
      if (p.hasValue && m[1]) entry.value = parseInt(m[1]);
      flags.push(entry);
    }
  }
  return flags;
}

// ボディテキストからアクション群を解析
function analyzeBody(body, triggerDict, actionDict, unmatched) {
  const steps = [];

  // 「その後」で分割
  const afterParts = body.split(/その後[、,]?\s*/);

  for (let partIdx = 0; partIdx < afterParts.length; partIdx++) {
    const part = afterParts[partIdx].trim();
    if (!part) continue;

    // 区切り挿入（2つ目以降）
    if (partIdx > 0) {
      steps.push({ separator: 'after' });
    }

    // 「ことで」で分割（コスト）
    const kotodeParts = part.split(/ことで[、,]?\s*/);

    if (kotodeParts.length > 1) {
      // コスト部分
      const costStep = analyzePhrase(kotodeParts[0].trim(), actionDict, unmatched);
      const actionStep = analyzePhrase(kotodeParts[1].trim(), actionDict, unmatched);
      if (costStep && actionStep) {
        actionStep.cost = [costStep];
        actionStep.optional = true;
        steps.push(actionStep);
      } else if (actionStep) {
        steps.push(actionStep);
      }
    } else {
      // 通常のフレーズ
      const step = analyzePhrase(part, actionDict, unmatched);
      if (step) steps.push(step);
    }
  }

  return steps;
}

// 1フレーズからステップを生成
function analyzePhrase(phrase, actionDict, unmatched) {
  if (!phrase) return null;

  const step = {};
  let matched = false;

  // 「このカードのメイン効果を発揮」特殊パターン
  if (/メイン効果を発揮/.test(phrase)) {
    return { action: 'use_main_effect' };
  }

  // 「進化元を下からN枚破棄」特殊パターン
  const evoBottomMatch = phrase.match(/進化元を?[、,]?\s*下から(\d+)?枚?破棄/);
  if (evoBottomMatch) {
    const val = parseInt(evoBottomMatch[1] || '1');
    // 対象（相手デジモンN体）を抽出
    const tgtMatch = phrase.match(/相手.*?デジモン(\d+)?体/);
    const condMatch = phrase.match(/Lv\.?(\d+)以下/);
    const result = { target: 'opponent:' + (tgtMatch ? (tgtMatch[1]||'1') : '1'), action: 'evo_discard_bottom', value: val };
    if (condMatch) result.condition = 'cond_lv_le:' + condMatch[1];
    return result;
  }

  // 「進化元をN枚破棄」（上から）
  const evoTopMatch = phrase.match(/進化元を?[、,]?\s*(?:上から)?(\d+)?枚?破棄/);
  if (evoTopMatch && !phrase.includes('下から') && !phrase.includes('持たない')) {
    const val = parseInt(evoTopMatch[1] || '1');
    const tgtMatch = phrase.match(/相手.*?デジモン(\d+)?体/);
    const result = { target: 'opponent:' + (tgtMatch ? (tgtMatch[1]||'1') : '1'), action: 'evo_discard', value: val };
    return result;
  }

  // 「このカードをコストを支払わずに登場させる」特殊パターン
  if (/このカードを.*登場させる/.test(phrase)) {
    return { target: 'self', action: 'summon', cost_free: true };
  }

  // アクション辞書からマッチ
  const actions = findFromDict(phrase, actionDict, 'action');
  const targets = findFromDict(phrase, actionDict, 'target');
  const conditions = findFromDict(phrase, actionDict, 'cond');
  const durations = findFromDict(phrase, actionDict, 'dur');
  const costs = findFromDict(phrase, actionDict, 'cost');
  const judges = findFromDict(phrase, actionDict, 'judge');

  // サブトリガー（「ブロックされたとき」等）
  const whenMatch = phrase.match(/(ブロックされた(?:時|とき)|アタックされた(?:時|とき)|アタック対象が変更された(?:時|とき)|バトルしている間)/);
  if (whenMatch) {
    const whenMap = {
      'ブロックされた時': 'when_blocked', 'ブロックされたとき': 'when_blocked',
      'アタックされた時': 'when_attacked', 'アタックされたとき': 'when_attacked',
      'アタック対象が変更されたとき': 'when_target_changed',
      'バトルしている間': 'cond_in_battle',
    };
    step.when = whenMap[whenMatch[1]] || whenMatch[1];
    matched = true;
  }

  // 「N枚ごとに」パターン
  const perMatch = phrase.match(/(\d+)枚ごとに/);
  if (perMatch) {
    step.per_count = parseInt(perMatch[1]);
    // 参照元
    if (phrase.includes('進化元')) step.ref = 'evo_source';
    else if (phrase.includes('手札')) step.ref = 'hand';
    else if (phrase.includes('トラッシュ')) step.ref = 'trash';
    else if (phrase.includes('セキュリティ')) step.ref = 'security';
    matched = true;
  }

  // 条件
  if (conditions.length > 0) {
    const cond = conditions[0];
    const condValue = extractNumberNear(phrase, cond.keyword);
    step.condition = cond.code + (condValue ? ':' + condValue : '');
    // cond_existsの場合、他の条件を入れ子にする
    if (cond.code === 'cond_exists' && conditions.length > 1) {
      step.condition = 'cond_exists:' + conditions[1].code;
    }
    matched = true;
  }

  // 持続
  if (durations.length > 0) {
    step.duration = durations[0].code;
    matched = true;
  }

  // 対象
  if (targets.length > 0) {
    const target = targets[0];
    const count = extractNumberNear(phrase, target.keyword);
    if (target.code === 'target_self') step.target = 'self';
    else if (target.code === 'target_all_own') step.target = 'own:all';
    else if (target.code === 'target_all_opponent') step.target = 'opponent:all';
    else if (target.code === 'target_all_own_security') step.target = 'own_security:all';
    else if (target.code === 'target_own') step.target = 'own:' + (count || 1);
    else if (target.code === 'target_opponent') step.target = 'opponent:' + (count || 1);
    else if (target.code === 'target_other_own') step.target = 'other_own:' + (count || 1);
    else step.target = target.code;
    matched = true;
  }

  // アクション
  if (actions.length > 0) {
    const action = actions[0];
    step.action = action.code;
    // 数値抽出
    const val = extractNumberNear(phrase, action.keyword);
    if (val) step.value = val;
    matched = true;

    // 「Sアタック+Nを得る」パターン
    if (action.code === 'grant_keyword') {
      const saMatch = phrase.match(/【Sアタック\+(\d+)】/);
      if (saMatch) { step.flag = 'security_attack_plus'; step.value = parseInt(saMatch[1]); }
      const blockerMatch = /【ブロッカー】/.test(phrase);
      if (blockerMatch) { step.flag = 'blocker'; }
    }
  }

  // 任意判定
  if (judges.some(j => j.code === 'judge_optional') || /できる|してもよい/.test(phrase)) {
    step.optional = true;
    matched = true;
  }

  // マッチしなかった場合
  if (!matched && phrase.length > 3) {
    // 句読点・助詞だけでないか確認
    const cleaned = phrase.replace(/[。、\s「」を・は が の に で と も へ て い る し た く な ら]+/g, '');
    if (cleaned.length > 2) {
      unmatched.push(phrase);
    }
  }

  return Object.keys(step).length > 0 ? step : null;
}

// 辞書からキーワード検索（カテゴリフィルタ付き）
function findFromDict(text, actionDict, codePrefix) {
  const results = [];
  for (const entry of actionDict) {
    const code = String(entry['アクションコード'] || '').trim();
    if (!code) continue;

    // カテゴリフィルタ
    if (codePrefix === 'action') {
      if (code.startsWith('target_') || code.startsWith('cond_') || code.startsWith('dur_') ||
          code.startsWith('judge_') || code.startsWith('limit_') || code.startsWith('per_') ||
          code.startsWith('cost_') || code.startsWith('mod_')) continue;
    } else if (codePrefix === 'target') {
      if (!code.startsWith('target_')) continue;
    } else if (codePrefix === 'cond') {
      if (!code.startsWith('cond_')) continue;
    } else if (codePrefix === 'dur') {
      if (!code.startsWith('dur_')) continue;
    } else if (codePrefix === 'cost') {
      if (!code.startsWith('cost_')) continue;
    } else if (codePrefix === 'judge') {
      if (!code.startsWith('judge_')) continue;
    }

    const keywords = String(entry['アクション名'] || '').split(',');
    for (const kw of keywords) {
      const trimmed = kw.trim();
      if (!trimmed || trimmed.length < 2) continue;
      if (fuzzyMatch(text, trimmed)) {
        results.push({ keyword: trimmed, code, entry });
        break;
      }
    }
  }
  return results;
}

// キーワード周辺の数値抽出
function extractNumberNear(text, keyword) {
  if (!keyword) return null;
  const idx = text.indexOf(keyword);
  if (idx < 0) return null;

  // キーワード直後
  const after = text.substring(idx + keyword.length, idx + keyword.length + 10);
  const afterMatch = after.match(/^(\d+)/);
  if (afterMatch) return parseInt(afterMatch[1]);

  // キーワード直前
  const before = text.substring(Math.max(0, idx - 8), idx);
  const beforeMatch = before.match(/(\d+)\s*[枚体回]?\s*$/);
  if (beforeMatch) return parseInt(beforeMatch[1]);

  return null;
}

// レシピのマージ（同じトリガーは配列を結合）
function mergeRecipe(target, source) {
  for (const [key, steps] of Object.entries(source)) {
    if (target[key]) {
      target[key] = target[key].concat(steps);
    } else {
      target[key] = steps;
    }
  }
}
