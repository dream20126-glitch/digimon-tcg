// ===================================================
// デジモンTCG カード管理メニュー
// スプシの「拡張機能 → Apps Script」に貼り付けて保存
//
// 【初回設定】
// プロジェクトの設定 → スクリプトプロパティに以下を設定:
//   SHEET_CARDS    : カード情報一覧（カードデータのシート名）
//   SHEET_TRIGGER  : 効果辞書（トリガー辞書のシート名）
//   SHEET_ACTION   : 効果アクション辞書（アクション辞書のシート名）
// ===================================================

// --- 設定 ---
function getSheetName(key, fallback) {
  return PropertiesService.getScriptProperties().getProperty(key) || fallback;
}
function getSheet(key, fallback) {
  const name = getSheetName(key, fallback);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('「' + name + '」シートが見つかりません。スクリプトプロパティ ' + key + ' を確認してください。');
  return sheet;
}
function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// --- メニュー ---
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎮 デジモンTCG')
    .addItem('⚡ レシピ自動生成（選択行）', 'autoGenerateSelectedRow')
    .addItem('⚡ レシピ一括生成（全カード）', 'autoGenerateAll')
    .addSeparator()
    .addItem('🔧 レシピビルダー（手動）', 'openRecipeBuilder')
    .addItem('📋 新しいカードを追加', 'addNewCard')
    .addSeparator()
    .addItem('⚙ シート名設定', 'configureSheetNames')
    .addSeparator()
    .addItem('⚠ 辞書に列追加（初回のみ）', 'addDictionaryColumns')
    .addToUi();
}

// ===================================================
// シート名設定
// ===================================================
function configureSheetNames() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const keys = [
    { key: 'SHEET_CARDS', label: 'カード情報シート', fallback: 'カード情報一覧' },
    { key: 'SHEET_TRIGGER', label: '効果辞書シート', fallback: '効果辞書' },
    { key: 'SHEET_ACTION', label: '効果アクション辞書シート', fallback: '効果アクション辞書' }
  ];
  for (const k of keys) {
    const current = props.getProperty(k.key) || k.fallback;
    const result = ui.prompt(k.label, '現在: 「' + current + '」\n新しいシート名（空欄=変更なし）:', ui.ButtonSet.OK_CANCEL);
    if (result.getSelectedButton() === ui.Button.OK && result.getResponseText().trim()) {
      props.setProperty(k.key, result.getResponseText().trim());
    }
  }
  ui.alert('設定完了');
}

// ===================================================
// 辞書読み込み
// ===================================================
function loadTriggerDict() {
  return sheetToObjects(getSheet('SHEET_TRIGGER', '効果辞書'));
}
function loadActionDict() {
  return sheetToObjects(getSheet('SHEET_ACTION', '効果アクション辞書'));
}

// ===================================================
// レシピ自動生成（コア）
// ===================================================

// キーワード能力の一覧
const KEYWORD_PATTERNS = [
  { regex: /【ブロッカー】/, kw: 'ブロッカー' },
  { regex: /【速攻】/, kw: '速攻' },
  { regex: /【突進】/, kw: '突進' },
  { regex: /【貫通】/, kw: '貫通' },
  { regex: /【ジャミング】/, kw: 'ジャミング' },
  { regex: /【再起動】/, kw: '再起動' },
  { regex: /【回避】/, kw: '回避' },
  { regex: /【進撃】/, kw: '進撃' },
  { regex: /【デコイ】/, kw: 'デコイ' },
  { regex: /【アーマーパージ】/, kw: 'アーマーパージ' },
  { regex: /【アライアンス】/, kw: 'アライアンス' },
  { regex: /【バリア】/, kw: 'バリア' },
  { regex: /【マテリアルセーブ】/, kw: 'マテリアルセーブ' },
  { regex: /【Sアタック\+(\d+)】/, kw: 'Sアタック+$1' },
  { regex: /【セキュリティアタック\+(\d+)】/, kw: 'Sアタック+$1' }
];

function extractKeywords(text) {
  if (!text) return [];
  const found = [];
  KEYWORD_PATTERNS.forEach(p => {
    const m = text.match(p.regex);
    if (m) {
      const kw = p.kw.includes('$1') ? p.kw.replace('$1', m[1]) : p.kw;
      if (!found.includes(kw)) found.push(kw);
    }
  });
  return found;
}

function stripKeywords(text) {
  if (!text) return '';
  return text.replace(/【(ターンに[1一]回|ブロッカー|速攻|突進|貫通|ジャミング|再起動|回避|進撃|デコイ|アーマーパージ|アライアンス|バリア|マテリアルセーブ|Sアタック\+\d+|セキュリティアタック\+\d+)】/g, '').trim();
}

function findTriggerInText(text, triggerDict) {
  for (const entry of triggerDict) {
    const keywords = String(entry['キーワード'] || '').split(',');
    for (const kw of keywords) {
      const trimmed = kw.trim();
      if (trimmed && text.includes(trimmed)) {
        return { keyword: trimmed, code: String(entry['処理コード'] || '').trim(), duration: entry['持続時間'], entry };
      }
    }
  }
  return null;
}

function findActionsInText(text, actionDict) {
  const NON_ACTION = ['target_', 'cond_', 'dur_', 'judge_', 'limit_', 'per_count'];
  const results = [];
  for (const entry of actionDict) {
    const code = String(entry['アクションコード'] || '').trim();
    if (!code || NON_ACTION.some(p => code.startsWith(p))) continue;
    const keywords = String(entry['アクション名'] || '').split(',');
    for (const kw of keywords) {
      const searchKey = kw.trim().replace(/\{N\}/, '');
      if (!searchKey || searchKey.length < 2) continue;
      const idx = text.indexOf(searchKey);
      if (idx !== -1) {
        let value = null;
        const after = text.substring(idx + searchKey.length);
        const mAfter = after.match(/^(\d+)/);
        if (mAfter) { value = parseInt(mAfter[1]); }
        else {
          const before = text.substring(Math.max(0, idx - 8), idx);
          const mBefore = before.match(/(\d+)\s*[枚体回]?\s*$/);
          if (mBefore) value = parseInt(mBefore[1]);
        }
        results.push({ keyword: kw.trim(), code, value, index: idx, entry });
        break;
      }
    }
  }
  results.sort((a, b) => a.index - b.index);
  return results;
}

function findTargetInText(text, actionDict) {
  const targetEntries = actionDict
    .filter(e => e['アクションコード'] && String(e['アクションコード']).startsWith('target_'))
    .sort((a, b) => String(b['アクション名']).length - String(a['アクション名']).length);
  for (const entry of targetEntries) {
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) {
      if (kw.trim() && text.includes(kw.trim())) {
        return { code: String(entry['アクションコード']).trim(), entry };
      }
    }
  }
  return null;
}

function findConditionsInText(text, actionDict) {
  const results = [];
  for (const entry of actionDict) {
    const code = String(entry['アクションコード'] || '').trim();
    if (!code.startsWith('cond_')) continue;
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) {
      if (kw.trim() && text.includes(kw.trim())) { results.push({ code, entry }); break; }
    }
  }
  return results;
}

function findDurationInText(text, actionDict) {
  for (const entry of actionDict) {
    const code = String(entry['アクションコード'] || '').trim();
    if (!code.startsWith('dur_')) continue;
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) {
      if (kw.trim() && text.includes(kw.trim())) return code;
    }
  }
  return null;
}

function isOptionalText(text, actionDict) {
  for (const entry of actionDict) {
    if (String(entry['アクションコード'] || '').trim() !== 'judge_optional') continue;
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) { if (kw.trim() && text.includes(kw.trim())) return true; }
  }
  return false;
}

function isOncePerTurn(text, actionDict) {
  for (const entry of actionDict) {
    if (String(entry['アクションコード'] || '').trim() !== 'limit_once_per_turn') continue;
    const keywords = String(entry['アクション名']).split(',');
    for (const kw of keywords) { if (kw.trim() && text.includes(kw.trim())) return true; }
  }
  return false;
}

function actionsToSteps(actions, target, conditions, duration, oncePerTurn) {
  const steps = [];
  let storeCounter = 'A';
  const needsTarget = ['destroy', 'bounce', 'dp_plus', 'dp_minus', 'rest', 'active',
    'cant_attack', 'cant_block', 'cant_attack_block', 'cant_evolve',
    'trash_evo_top', 'trash_evo_bottom', 'redirect_attack'];

  for (const act of actions) {
    const step = { action: act.code };

    if (needsTarget.includes(act.code) && target) {
      const selectStep = { action: 'select', store: storeCounter };
      if (target.code.includes('opponent')) selectStep.target = 'opponent';
      else if (target.code.includes('own')) selectStep.target = 'own';
      conditions.forEach(c => {
        if (c.code === 'cond_no_evo_source') selectStep.condition = 'no_evo';
      });
      steps.push(selectStep);
      step.card = storeCounter;
      storeCounter = String.fromCharCode(storeCounter.charCodeAt(0) + 1);
    }

    if (act.value !== null && act.value !== undefined) step.value = act.value;
    if (duration) step.duration = duration;
    if (oncePerTurn) step.limit = 'once_per_turn';

    if (act.code === 'destroy' && act.value && act.value > 1) {
      const lastSelect = steps[steps.length - 1];
      if (lastSelect && lastSelect.action === 'select') {
        lastSelect.action = 'select_multi';
        lastSelect.count = act.value;
        delete step.value;
      }
    }

    steps.push(step);
  }
  return steps;
}

function parseOneBlock(text, triggerDict, actionDict) {
  const stripped = stripKeywords(text);
  if (!stripped) return null;

  const trigger = findTriggerInText(stripped, triggerDict);
  if (!trigger) return null;

  const triggerIdx = stripped.indexOf(trigger.keyword);
  const effectBody = stripped.substring(triggerIdx + trigger.keyword.length).trim();
  if (!effectBody) return null;

  const actions = findActionsInText(effectBody, actionDict);
  const target = findTargetInText(effectBody, actionDict);
  const conditions = findConditionsInText(effectBody, actionDict);
  const duration = findDurationInText(effectBody, actionDict);
  const oncePerTurn = isOncePerTurn(stripped, actionDict);

  if (actions.length === 0) return null;

  const steps = actionsToSteps(actions, target, conditions, duration, oncePerTurn);
  if (steps.length === 0) return null;

  return { triggerCode: trigger.code, steps };
}

function parseEffectToRecipe(effectText, evoSourceText, securityText, triggerDict, actionDict) {
  const recipe = {};
  const warnings = [];

  if (effectText && effectText !== 'なし') {
    const parts = stripKeywords(effectText).split(/(?=【)/).filter(p => p.trim());
    for (const part of parts) {
      const block = parseOneBlock(part, triggerDict, actionDict);
      if (block) {
        if (recipe[block.triggerCode]) recipe[block.triggerCode] = recipe[block.triggerCode].concat(block.steps);
        else recipe[block.triggerCode] = block.steps;
      } else if (part.includes('【')) {
        warnings.push('解析不能: ' + part.substring(0, 40));
      }
    }
  }

  if (evoSourceText && evoSourceText !== 'なし' && evoSourceText.trim()) {
    const evoSource = {};
    const evoKws = extractKeywords(evoSourceText);
    if (evoKws.length > 0) evoSource.keywords = evoKws;

    const parts = stripKeywords(evoSourceText).split(/(?=【)/).filter(p => p.trim());
    for (const part of parts) {
      const block = parseOneBlock(part, triggerDict, actionDict);
      if (block) {
        evoSource[block.triggerCode] = block.steps;
      } else if (part.includes('【')) {
        const trigger = findTriggerInText(part, triggerDict);
        const actions = findActionsInText(part, actionDict);
        if (trigger && actions.length > 0) {
          const perm = {};
          if (trigger.code) perm.condition = trigger.code === 'permanent' ? 'always' : 'own_turn';
          actions.forEach(a => { if (a.code === 'dp_plus' && a.value) perm.dp_plus = a.value; });
          const conds = findConditionsInText(part, actionDict);
          conds.forEach(c => { if (c.code === 'cond_no_evo_source') perm.condition += '_opp_no_evo'; });
          if (Object.keys(perm).length > 0) evoSource.permanent = perm;
        } else if (evoKws.length === 0) {
          warnings.push('進化元解析不能: ' + part.substring(0, 40));
        }
      }
    }
    if (Object.keys(evoSource).length > 0) recipe.evo_source = evoSource;
  }

  if (securityText && securityText !== 'なし' && securityText.trim()) {
    const cleaned = securityText.replace(/【セキュリティ】/g, '').trim();
    if (cleaned.includes('メイン効果を発揮') || cleaned.includes('メイン効果を発動')) {
      recipe.security = [{ action: 'use_main_effect' }];
    } else if (cleaned.includes('コストを支払わずに登場')) {
      recipe.security = [{ action: 'play_self' }];
    } else {
      const actions = findActionsInText(cleaned, actionDict);
      if (actions.length > 0) {
        const target = findTargetInText(cleaned, actionDict);
        const conditions = findConditionsInText(cleaned, actionDict);
        const duration = findDurationInText(cleaned, actionDict);
        const steps = actionsToSteps(actions, target, conditions, duration, false);
        if (steps.length > 0) recipe.security = steps;
      }
    }
  }

  return { recipe, warnings };
}

// ===================================================
// レシピ自動生成（UI）
// ===================================================

function autoGenerateSelectedRow() {
  const sheet = getSheet('SHEET_CARDS', 'カード情報一覧');
  const row = SpreadsheetApp.getActiveRange().getRow();
  if (row < 2) { SpreadsheetApp.getUi().alert('カードの行を選択してください'); return; }
  const result = generateRecipeForRow(sheet, row);
  SpreadsheetApp.getUi().alert(result);
}

function autoGenerateAll() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert('確認', '全カードのキーワード＋レシピを自動生成します。\n既存のレシピは上書きされます。\n\n実行しますか？', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const sheet = getSheet('SHEET_CARDS', 'カード情報一覧');
  const lastRow = sheet.getLastRow();
  const results = [];
  let success = 0, fail = 0, skip = 0;

  for (let r = 2; r <= lastRow; r++) {
    const result = generateRecipeForRow(sheet, r);
    if (result.includes('✅')) success++;
    else if (result.includes('⚠')) { fail++; results.push(result); }
    else skip++;
  }

  let msg = '一括生成完了\n\n✅ 成功: ' + success + '枚\n⚠ 警告: ' + fail + '枚\n⏭ スキップ: ' + skip + '枚';
  if (results.length > 0) msg += '\n\n--- 警告詳細 ---\n' + results.join('\n');
  ui.alert(msg);
}

function generateRecipeForRow(sheet, row) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

  const col = {};
  headers.forEach((h, i) => col[h] = i);

  const cardNo = rowData[col['カードNo']];
  const name = rowData[col['名前']];
  if (!cardNo) return '⏭ 行' + row + ': カードNoなし';

  const effectText = rowData[col['効果テキスト']] || rowData[col['効果']] || '';
  const evoText = rowData[col['進化元テキスト']] || rowData[col['進化元効果']] || '';
  const secText = rowData[col['セキュリティテキスト']] || rowData[col['セキュリティ効果']] || '';

  const triggerDict = loadTriggerDict();
  const actionDict = loadActionDict();

  const keywords = extractKeywords(effectText);
  const { recipe, warnings } = parseEffectToRecipe(effectText, evoText, secText, triggerDict, actionDict);
  const recipeJson = Object.keys(recipe).length > 0 ? JSON.stringify(recipe) : '';

  const kwIdx = col['キーワード'];
  const recipeIdx = col['レシピ'];
  if (kwIdx !== undefined) sheet.getRange(row, kwIdx + 1).setValue(keywords.join(','));
  if (recipeIdx !== undefined) sheet.getRange(row, recipeIdx + 1).setValue(recipeJson);

  let msg = '✅ ' + cardNo + ' ' + name;
  if (keywords.length > 0) msg += ' [KW: ' + keywords.join(',') + ']';
  if (recipeJson) msg += ' [レシピ生成]';
  if (warnings.length > 0) msg += '\n⚠ ' + warnings.join(', ');
  return msg;
}

// ===================================================
// レシピビルダー（手動フォールバック）
// ===================================================
function openRecipeBuilder() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: sans-serif; padding: 10px; font-size: 13px; }
      h3 { margin: 0 0 8px; } h4 { margin: 10px 0 4px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      select, input { padding: 4px; margin: 2px 0; }
      .kw-group { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
      .kw-group label { font-weight: normal; font-size: 12px; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
      .trigger-block { background: #fafafa; border: 1px solid #ccc; border-radius: 6px; padding: 8px; margin: 6px 0; }
      .step { background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px; margin: 4px 0; }
      button { padding: 4px 10px; border: none; border-radius: 4px; cursor: pointer; margin: 2px; font-size: 12px; }
      .b-blue { background: #4285f4; color: #fff; } .b-red { background: #ea4335; color: #fff; }
      .b-orange { background: #ff9800; color: #fff; }
      .param { margin-left: 10px; font-size: 11px; }
      .param label { font-weight: normal; color: #555; }
      #output { background: #1a1a2e; color: #0f0; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 11px; word-break: break-all; margin-top: 8px; min-height: 40px; }
      .write-box { background: #fff3e0; border: 1px solid #ff9800; border-radius: 6px; padding: 10px; margin-top: 10px; }
    </style>
    <h3>🔧 手動レシピビルダー</h3>
    <div style="color:#888;font-size:11px;margin-bottom:8px;">自動生成できなかった効果を手動で組み立て</div>

    <h4>キーワード</h4>
    <div class="kw-group" id="kw-area"></div>
    <div>Sアタック+<input id="kw-sa" type="number" min="0" max="9" style="width:35px;" value="0"></div>

    <h4>トリガー＋アクション</h4>
    <div id="triggers"></div>
    <button class="b-blue" onclick="addTrigger()">+ トリガー</button>

    <hr>
    <button class="b-blue" onclick="generate()" style="padding:6px 16px;">生成</button>
    <div id="output"></div>

    <div class="write-box">
      <b>📝 書き込み</b>
      <input id="w-cardno" placeholder="カードNo" style="width:100px;">
      <button class="b-orange" onclick="writeRow()">書き込み</button>
    </div>

    <script>
      const KWS = ['ブロッカー','速攻','突進','貫通','ジャミング','再起動','回避','進撃','デコイ','アーマーパージ','アライアンス','バリア'];
      const kwArea = document.getElementById('kw-area');
      KWS.forEach(k => { kwArea.innerHTML += '<label><input type="checkbox" class="kw" value="'+k+'"> '+k+'</label>'; });

      function getKW() {
        const r = []; document.querySelectorAll('.kw:checked').forEach(c => r.push(c.value));
        const sa = parseInt(document.getElementById('kw-sa').value);
        if (sa > 0) r.push('Sアタック+'+sa);
        return r.join(',');
      }

      const ACTS = { select:{l:'対象選択',p:['target','condition','store']}, select_multi:{l:'複数選択',p:['target','count','condition','store']}, select_evo_source:{l:'進化元選択',p:['from','filter','store']}, select_from_hand_trash:{l:'手札/トラッシュ選択',p:['count','filter_name','filter_type','store']}, destroy:{l:'消滅',p:['card']}, destroy_by_dp:{l:'DP以下消滅',p:[]}, bounce:{l:'手札に戻す',p:['card']}, summon:{l:'コスト無し登場',p:['card']}, dp_plus:{l:'DP+',p:['value','card','duration']}, dp_minus:{l:'DP-',p:['value','card','duration']}, memory_plus:{l:'メモリー+',p:['value','condition']}, memory_minus:{l:'メモリー-',p:['value']}, draw:{l:'ドロー',p:['count']}, active_self:{l:'自身アクティブ',p:['limit']}, rest_self:{l:'自身レスト',p:[]}, trash_evo_bottom:{l:'進化元下破棄',p:['card','count']}, trash_evo_all:{l:'進化元全破棄',p:['card']}, add_to_evo_source:{l:'進化元に追加',p:['card','target']}, cant_attack_block:{l:'攻撃/ブロック不可',p:['card','duration']}, security_dp_buff:{l:'セキュリティDPバフ',p:['value','duration']}, play_self:{l:'自身登場',p:[]}, use_main_effect:{l:'メイン効果発揮',p:[]}, grant_keyword_all:{l:'全体KW付与',p:['keyword','target','duration']}, deck_open:{l:'デッキオープン',p:['count']}, pick_to_hand:{l:'手札へ',p:['filter_name','count']}, pick_to_evo_source:{l:'進化元へ',p:['filter_name','count']}, return_deck_bottom:{l:'デッキ下へ',p:[]}, recover:{l:'セキュリティ追加',p:['count']}, dp_plus_self:{l:'自身DP+',p:['value','duration']} };
      const TRIGS = [{v:'main',l:'【メイン】'},{v:'on_play',l:'【登場時】'},{v:'on_evolve',l:'【進化時】'},{v:'on_attack',l:'【アタック時】'},{v:'on_blocked',l:'ブロックされた時'},{v:'on_own_turn_start',l:'【自分のターン開始時】'},{v:'security',l:'【セキュリティ】'}];
      const POPTS = { target:['own','opponent'], duration:['this_turn','next_own_turn_end','next_opp_turn_end'], limit:['','once_per_turn'], filter:['','デジモン','テイマー'], filter_type:['','デジモン','テイマー'], condition:['','no_evo','opp_has_no_evo','dp_le:4000','lv_le:5'] };
      let tc=0, sc={};

      function addTrigger() {
        tc++; sc[tc]=0;
        const d=document.createElement('div'); d.className='trigger-block'; d.id='t-'+tc;
        d.innerHTML='<select id="ts-'+tc+'">'+TRIGS.map(t=>'<option value="'+t.v+'">'+t.l+'</option>').join('')+'</select> <button class="b-red" onclick="this.parentElement.remove()">×</button><div id="ss-'+tc+'"></div><button class="b-blue" onclick="addStep('+tc+')">+ ステップ</button>';
        document.getElementById('triggers').appendChild(d);
      }
      function addStep(t) {
        sc[t]=(sc[t]||0)+1; const u=t+'-'+sc[t];
        const d=document.createElement('div'); d.className='step'; d.id='s-'+u;
        d.innerHTML='<select id="a-'+u+'" onchange="updP(\\''+u+'\\')">'+Object.entries(ACTS).map(([k,v])=>'<option value="'+k+'">'+v.l+'</option>').join('')+'</select> <button class="b-red" onclick="this.parentElement.remove()">×</button><div id="p-'+u+'" class="param"></div>';
        document.getElementById('ss-'+t).appendChild(d); updP(u);
      }
      function updP(u) {
        const a=document.getElementById('a-'+u).value, info=ACTS[a], c=document.getElementById('p-'+u); c.innerHTML='';
        info.p.forEach(p => { const o=POPTS[p]; c.innerHTML+='<label>'+p+':</label>'+(o?'<select id="v-'+u+'-'+p+'"><option value="">-</option>'+o.map(x=>'<option>'+x+'</option>').join('')+'</select>':'<input id="v-'+u+'-'+p+'" size="8" placeholder="'+p+'">')+' '; });
      }

      function generate() {
        const recipe = {};
        document.querySelectorAll('.trigger-block').forEach(bl => {
          const t=bl.id.split('-')[1], tr=document.getElementById('ts-'+t).value, steps=[];
          bl.querySelectorAll('.step').forEach(st => {
            const u=st.id.replace('s-',''), a=document.getElementById('a-'+u).value, info=ACTS[a], s={action:a};
            info.p.forEach(p => { const el=document.getElementById('v-'+u+'-'+p); if(el&&el.value) s[p]=isNaN(el.value)?el.value:Number(el.value); });
            steps.push(s);
          });
          if(recipe[tr]) recipe[tr]=recipe[tr].concat(steps); else recipe[tr]=steps;
        });
        document.getElementById('output').textContent = Object.keys(recipe).length ? JSON.stringify(recipe) : '（なし）';
      }

      function writeRow() {
        const no=document.getElementById('w-cardno').value.trim();
        if(!no){alert('カードNo入力');return;}
        generate();
        const kw=getKW(), rcp=document.getElementById('output').textContent;
        google.script.run.withSuccessHandler(m=>alert(m)).withFailureHandler(e=>alert('エラー:'+e)).writeRecipeToCardRow(no, kw, rcp==='（なし）'?'':rcp);
      }
    </script>
  `).setWidth(480).setHeight(700);
  SpreadsheetApp.getUi().showSidebar(html);
}

function writeRecipeToCardRow(cardNo, keywords, recipe) {
  const sheet = getSheet('SHEET_CARDS', 'カード情報一覧');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const noIdx = headers.indexOf('カードNo');
  const kwIdx = headers.indexOf('キーワード');
  const rcpIdx = headers.indexOf('レシピ');
  if (kwIdx === -1 || rcpIdx === -1) throw new Error('「キーワード」or「レシピ」列がありません');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][noIdx]).trim() === cardNo) {
      sheet.getRange(r + 1, kwIdx + 1).setValue(keywords);
      sheet.getRange(r + 1, rcpIdx + 1).setValue(recipe);
      return '✅ ' + cardNo + ' 更新完了';
    }
  }
  throw new Error(cardNo + ' が見つかりません');
}

// ===================================================
// 新しいカードを追加
// ===================================================
function addNewCard() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: sans-serif; padding: 16px; }
      label { display: block; font-weight: bold; margin-top: 10px; font-size: 13px; }
      input, select, textarea { width: 100%; padding: 6px; margin-top: 4px; box-sizing: border-box; }
      textarea { height: 60px; }
      .row { display: flex; gap: 8px; }
      .row > div { flex: 1; }
      button { margin-top: 16px; padding: 10px 24px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
      button:hover { background: #3367d6; }
      .note { color: #888; font-size: 11px; margin-top: 2px; }
    </style>
    <h3>新しいカードを追加</h3>
    <div class="row">
      <div><label>カードNo</label><input id="cardNo" placeholder="例: BT1-001"></div>
      <div><label>名前</label><input id="name" placeholder="例: アグモン"></div>
    </div>
    <div class="row">
      <div><label>タイプ</label><select id="type"><option>デジモン</option><option>テイマー</option><option>オプション</option><option>デジタマ</option></select></div>
      <div><label>色</label><select id="color"><option>赤</option><option>青</option><option>黒</option><option>黄</option><option>緑</option><option>紫</option><option>白</option></select></div>
      <div><label>レベル</label><input id="level" type="number" placeholder="3"></div>
    </div>
    <div class="row">
      <div><label>登場コスト</label><input id="playCost" type="number" placeholder="5"></div>
      <div><label>進化コスト</label><input id="evoCost" type="number" placeholder="2"></div>
      <div><label>DP</label><input id="dp" type="number" placeholder="5000"></div>
    </div>
    <label>進化条件</label><input id="evoCond" placeholder="例: 赤Lv.3">
    <label>特徴</label><input id="feature" placeholder="例: 竜型">
    <label>効果テキスト</label><textarea id="effectText" placeholder="【メイン】相手のデジモン1体を消滅させる。"></textarea>
    <label>進化元テキスト</label><textarea id="evoText" placeholder="（なければ空）"></textarea>
    <label>セキュリティテキスト</label><textarea id="secText" placeholder="（なければ空）"></textarea>
    <label>ImageURL</label><input id="imageUrl" placeholder="https://drive.google.com/...">
    <div class="note">キーワードとレシピは「レシピ自動生成」で自動入力されます</div>
    <button onclick="submit()">追加</button>
    <script>
      function submit() {
        const data = {
          cardNo: document.getElementById('cardNo').value,
          name: document.getElementById('name').value,
          type: document.getElementById('type').value,
          color: document.getElementById('color').value,
          level: document.getElementById('level').value,
          playCost: document.getElementById('playCost').value,
          evoCond: document.getElementById('evoCond').value,
          evoCost: document.getElementById('evoCost').value,
          dp: document.getElementById('dp').value,
          feature: document.getElementById('feature').value,
          effectText: document.getElementById('effectText').value,
          evoText: document.getElementById('evoText').value,
          secText: document.getElementById('secText').value,
          imageUrl: document.getElementById('imageUrl').value
        };
        google.script.run.withSuccessHandler(() => {
          alert('カードを追加しました！\\n次に「レシピ自動生成（選択行）」を実行してください。');
          google.script.host.close();
        }).withFailureHandler(e => alert('エラー: ' + e)).insertCardRow(data);
      }
    </script>
  `).setWidth(500).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, '新しいカードを追加');
}

function insertCardRow(data) {
  const sheet = getSheet('SHEET_CARDS', 'カード情報一覧');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => {
    switch(h) {
      case 'カードNo': return data.cardNo;
      case '名前': return data.name;
      case 'タイプ': return data.type;
      case '色': return data.color;
      case 'レベル': return data.level ? Number(data.level) : '';
      case '登場コスト': return data.playCost ? Number(data.playCost) : '';
      case '進化条件': return data.evoCond;
      case '進化コスト': return data.evoCost ? Number(data.evoCost) : '';
      case 'DP': return data.dp ? Number(data.dp) : '';
      case '特徴': return data.feature;
      case '効果テキスト': return data.effectText;
      case '進化元テキスト': return data.evoText;
      case 'セキュリティテキスト': return data.secText;
      case 'ImageURL': return data.imageUrl;
      default: return '';
    }
  });
  sheet.appendRow(row);
}

// ===================================================
// 辞書に列追加（初回のみ）
// ===================================================
function addDictionaryColumns() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert('確認', '効果辞書に「進化元対応」列、\n効果アクション辞書に「Bの画面演出」列を追加します。\n\n実行しますか？', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;
  const results = [];
  try {
    const triggerSheet = getSheet('SHEET_TRIGGER', '効果辞書');
    const th = triggerSheet.getRange(1, 1, 1, triggerSheet.getLastColumn()).getValues()[0];
    if (th.includes('進化元対応')) { results.push('効果辞書: 「進化元対応」列は既にあります'); }
    else { triggerSheet.getRange(1, th.length + 1).setValue('進化元対応'); results.push('✅ 効果辞書: 「進化元対応」列を追加'); }
  } catch(e) { results.push('❌ 効果辞書エラー: ' + e.message); }
  try {
    const actionSheet = getSheet('SHEET_ACTION', '効果アクション辞書');
    const ah = actionSheet.getRange(1, 1, 1, actionSheet.getLastColumn()).getValues()[0];
    if (!ah.includes('Bの画面演出')) { actionSheet.getRange(1, ah.length + 1).setValue('Bの画面演出'); results.push('✅「Bの画面演出」列を追加'); }
    else { results.push('効果アクション辞書: 「Bの画面演出」列は既にあります'); }
  } catch(e) { results.push('❌ 効果アクション辞書エラー: ' + e.message); }
  ui.alert(results.join('\n'));
}
