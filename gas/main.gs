// ===== GAS メインスクリプト（ローカルコピー） =====
// 注意: このファイルはGASスクリプトエディタのコピーです。
// 実際のデプロイはGAS側で行ってください。

function getProps() {
  return PropertiesService.getScriptProperties().getProperties();
}

// ===== REST API =====
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'page';

  if (action !== 'page') {
    var result;
    try {
      switch (action) {
        case 'getCards':
          result = getCardAndKeywordData();
          break;
        case 'getDecks':
          result = getSavedDecks(e.parameter.pw || '');
          break;
        case 'getAllDecks':
          result = getAllDecksForAdmin();
          break;
        case 'checkAdmin':
          result = { valid: checkAdminPassword(e.parameter.pw || '') };
          break;
        case 'getTutorialDecks':
          result = getTutorialDecks();
          break;
        case 'getEffectDictionary':
          result = getEffectDictionary();
          break;
        case 'getEffectActionDictionary':
          result = getEffectActionDictionary();
          break;
        case 'updatePerCountRefMap':
          result = updatePerCountRefMap();
          break;
        default:
          result = { error: 'Unknown action: ' + action };
      }
    } catch (err) {
      result = { error: err.message };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createTemplateFromFile('メイン').evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes')
    .setTitle('デジカ デッキビルダー');
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'Invalid JSON' });
  }

  var action = body.action;
  var result;
  try {
    switch (action) {
      case 'saveDeck':
        result = { status: saveDeck(body.name, body.cover, body.list, body.password, body.isUpdate) };
        break;
      case 'checkExistingDeck':
        result = { exists: checkExistingDeck(body.name, body.password) };
        break;
      case 'updateDeckRegistration':
        result = { success: updateDeckRegistration(body.name, body.password, body.isRegister) };
        break;
      case 'deleteDeck':
        result = { success: deleteDeck(body.name, body.password) };
        break;
      case 'saveTutorialDeck':
        result = { status: saveTutorialDeck(body.tutorialName, body.deckName, body.cover, body.list, body.target, body.message, body.difficulty) };
        break;
      case 'updateTutorialDeck':
        result = { status: updateTutorialDeck(body.rowIndex, body.tutorialName, body.deckName, body.cover, body.list, body.target, body.message, body.difficulty) };
        break;
      case 'deleteTutorialDeck':
        result = { status: deleteTutorialDeck(body.rowIndex) };
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonResponse(result);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function checkAdminPassword(inputPass) {
  var p = getProps();
  var adminPass = p.ADMIN_PASSWORD;
  return inputPass === adminPass;
}

function getCardAndKeywordData() {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var cardSheet = ss.getSheetByName(p.SHEET_CARD_DATA);
  var cardValues = cardSheet.getDataRange().getValues();
  var cardHeaders = cardValues.shift();
  var cards = cardValues.map(function(row) {
    var obj = {};
    cardHeaders.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
  var kwSheet = ss.getSheetByName(p.SHEET_KEYWORD);
  var kwValues = kwSheet.getDataRange().getValues();
  kwValues.shift();
  var keywords = kwValues.map(function(row) { return { name: row[0], effect: row[1] }; });
  return { cards: cards, keywords: keywords };
}

function checkExistingDeck(name, password) {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(p.SHEET_MY_DECK);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(name).trim() &&
        String(data[i][4]).trim() === String(password).trim()) {
      return true;
    }
  }
  return false;
}

function saveDeck(name, cover, list, password, isUpdate) {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(p.SHEET_MY_DECK);
  var now = new Date();
  if (isUpdate) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(name).trim() &&
          String(data[i][4]).trim() === String(password).trim()) {
        sheet.getRange(i + 1, 1, 1, 4).setValues([[now, name, cover, list]]);
        return "SUCCESS_UPDATE";
      }
    }
  }
  sheet.appendRow([now, name, cover, list, password, ""]);
  return "SUCCESS_NEW";
}

function updateDeckRegistration(name, password, isRegister) {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(p.SHEET_MY_DECK);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(name).trim() &&
        String(data[i][4]).trim() === String(password).trim()) {
      sheet.getRange(i + 1, 6).setValue(isRegister ? "登録済み" : "");
      return true;
    }
  }
  return false;
}

function deleteDeck(name, password) {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(p.SHEET_MY_DECK);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]).trim() === String(name).trim() &&
        String(data[i][4]).trim() === String(password).trim()) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function getSavedDecks(password) {
  try {
    if (!password) return [];
    var p = getProps();
    var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(p.SHEET_MY_DECK);
    if (!sheet || sheet.getLastRow() < 2) return [];
    var data = sheet.getDataRange().getValues();
    data.shift();
    var filtered = data.filter(function(row) { return String(row[4]).trim() === String(password).trim(); });
    return filtered.map(function(row) {
      return {
        date: Utilities.formatDate(new Date(row[0]), "JST", "yyyy/MM/dd HH:mm"),
        name: row[1],
        cover: row[2],
        list: row[3],
        status: String(row[5] || "").trim()
      };
    }).reverse();
  } catch (e) { return []; }
}

function getAllDecksForAdmin() {
  try {
    var p = getProps();
    var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(p.SHEET_MY_DECK);
    if (!sheet || sheet.getLastRow() < 2) return [];
    var data = sheet.getDataRange().getValues();
    data.shift();
    return data.map(function(row) {
      return {
        date: Utilities.formatDate(new Date(row[0]), "JST", "yyyy/MM/dd HH:mm"),
        name: row[1],
        password: row[4],
        list: row[3],
        status: String(row[5] || "").trim()
      };
    }).reverse();
  } catch (e) { return []; }
}

// ===== チュートリアルデッキ関連 =====

function getTutorialDecks() {
  try {
    var p = getProps();
    var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
    var sheet = ss.getSheetByName("チュートリアルデッキ（固定）");
    if (!sheet) return [];
    var values = sheet.getDataRange().getValues();
    var headers = values.shift();
    return values.map(function(row, idx) {
      var obj = { index: idx + 1 };
      headers.forEach(function(h, i) {
        var key = h;
        if (h === "代表画像URL") key = "cover";
        if (h === "デッキ名") key = "deckName";
        if (h === "対象") key = "target";
        if (h === "導入メッセージ") key = "message";
        if (h === "難易度") key = "difficulty";
        if (h === "カードリスト") key = "list";
        if (h === "チュートリアル名") key = "tutorialName";
        obj[key] = row[i];
      });
      return obj;
    });
  } catch (e) {
    console.error("getTutorialDecks Error: " + e.message);
    return [];
  }
}

function saveTutorialDeck(tutorialName, deckName, cover, list, target, message, difficulty) {
  try {
    var p = getProps();
    var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
    var sheet = ss.getSheetByName("チュートリアルデッキ（固定）");
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(tutorialName).trim() &&
          String(data[i][1]).trim() === String(deckName).trim()) {
        sheet.getRange(i + 1, 1, 1, 7).setValues([[tutorialName, deckName, cover, list, target, message, difficulty]]);
        return "SUCCESS_UPDATE";
      }
    }
    sheet.appendRow([tutorialName, deckName, cover, list, target, message, difficulty]);
    return "SUCCESS_NEW";
  } catch(e) { return "ERROR: " + e.message; }
}

function updateTutorialDeck(rowIndex, tutorialName, deckName, cover, list, target, message, difficulty) {
  try {
    var p = getProps();
    var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
    var sheet = ss.getSheetByName("チュートリアルデッキ（固定）");
    sheet.getRange(rowIndex + 1, 1, 1, 7).setValues([[tutorialName, deckName, cover, list, target, message, difficulty]]);
    return "SUCCESS";
  } catch(e) { return "ERROR: " + e.message; }
}

function deleteTutorialDeck(rowIndex) {
  try {
    var p = getProps();
    var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
    var sheet = ss.getSheetByName("チュートリアルデッキ（固定）");
    sheet.deleteRow(rowIndex + 1);
    return "SUCCESS";
  } catch(e) { return "ERROR: " + e.message; }
}

// ===== 効果辞書 =====

function getEffectDictionary() {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName("効果辞書");
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function getEffectActionDictionary() {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName("効果アクション辞書");
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function updatePerCountRefMap() {
  var p = getProps();
  var ss = SpreadsheetApp.openById(p.SPREADSHEET_ID);
  var sheet = ss.getSheetByName("効果辞書");
  if (!sheet) return "エラー: 効果辞書シートが見つかりません";
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var kwCol = headers.indexOf("キーワード");
  var noteCol = headers.indexOf("備考");
  if (kwCol === -1 || noteCol === -1) return "エラー: 列が見つかりません";
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][kwCol]).includes("ごとに")) {
      var refMap = "進化元=evo_source,手札=hand,トラッシュ=trash,セキュリティ=security";
      sheet.getRange(i + 1, noteCol + 1).setValue(refMap);
      return "更新完了: " + (i + 1) + "行目の備考を更新しました → " + refMap;
    }
  }
  return "「～ごとに」の行が見つかりませんでした";
}
