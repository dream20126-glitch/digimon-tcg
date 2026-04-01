// デッキビルダーロジック（GAS API版）
import { gasPost } from './firebase-config.js';
import { loadCardAndKeywordData, getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

let searchMode = 'name';
let selectedColors = [];
let selectedLevels = [];
let selectedTypes = [];

// デッキビルダー初期化
window.initBuilder = async function() {
  isTutorialMode = false;
  searchMode = 'name';
  selectedColors = [];
  selectedLevels = [];
  selectedTypes = [];
  window._editDeckName = '';
  window._editPassword = '';
  tempDeck = [];
  updateDeckUI();
  const label = document.getElementById('back-btn-label');
  if (label) label.innerText = 'TOPへ戻る';
  showScreen('deck-make-screen');

  if (allCards.length === 0) {
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadCardAndKeywordData();
    document.getElementById('loading-overlay').style.display = 'none';
  }
  filterCards();
};

window.editDeckByIndex = async function(idx) {
  isTutorialMode = false;
  const d = window.latestDecks[idx];
  window._editDeckName = d.name;
  window._editPassword = currentSessionPassword;
  tempDeck = [];
  showScreen('deck-make-screen');

  if (allCards.length === 0) {
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadCardAndKeywordData();
    document.getElementById('loading-overlay').style.display = 'none';
  }

  tempDeck = [];
  d.list.split(',').forEach(line => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (m) {
      const card = allCards.find(c => c["カードNo"] === m[2]);
      if (card) tempDeck.push({ card, count: parseInt(m[3]) });
    }
  });
  updateDeckUI();
  filterCards();
};

window.toggleZoom = function(img) {
  zoomScale = (zoomScale === 1) ? 2.5 : 1;
  img.style.transform = `scale(${zoomScale})`;
  img.style.cursor = (zoomScale === 1) ? 'zoom-out' : 'zoom-in';
};

window.setSearchMode = function(mode) {
  searchMode = mode;
  document.getElementById('mode-name').classList.toggle('active', mode === 'name');
  document.getElementById('mode-effect').classList.toggle('active', mode === 'effect');
  filterCards();
};

window.toggleFilter = function(btn, type, val) {
  btn.classList.toggle('selected');
  const arr = (type === 'colors') ? selectedColors : (type === 'levels' ? selectedLevels : selectedTypes);
  const idx = arr.indexOf(val);
  if (idx > -1) arr.splice(idx, 1); else arr.push(val);
  filterCards();
};

window.filterCards = function() {
  const input = document.getElementById('s-input').value.toLowerCase();
  const feature = document.getElementById('s-feature').value.toLowerCase();
  const filtered = allCards.filter(c => {
    const targetText = (searchMode === 'name')
      ? (String(c["名前"]) + String(c["カードNo"])).toLowerCase()
      : String(c["効果"]).toLowerCase();
    const matchText = targetText.includes(input);
    const matchFeature = String(c["特徴"]).toLowerCase().includes(feature);
    const matchColor = selectedColors.length === 0 || selectedColors.some(col => String(c["色"]).includes(col));
    const matchLevel = selectedLevels.length === 0 || selectedLevels.some(lv => String(c["レベル"]) === lv);
    const matchType = selectedTypes.length === 0 || selectedTypes.some(t => String(c["タイプ"]) === t);
    return matchText && matchFeature && matchColor && matchLevel && matchType;
  });
  renderResults(filtered);
};

function renderResults(list) {
  const res = document.getElementById('search-results');
  res.innerHTML = list.map(c => {
    const safeId = c["カードNo"].replace(/[^a-z0-9]/gi, '');
    const imgUrl = getCardImageUrl(c);
    return `<div class="card-thumb" onclick="showPreview('${c["カードNo"]}')">
      <div id="img-box-${safeId}">${imgUrl ? `<img src="${imgUrl}" style="width:100%">` : '<div style="height:100px; background:#111;"></div>'}</div>
      <div style="font-size:9px; color:#555; margin-top:3px;">${c["カードNo"]}</div>
    </div>`;
  }).join('');
}

window.showPreview = function(id) {
  const card = allCards.find(c => c["カードNo"] === id);
  if (!card) return;
  zoomScale = 1;
  document.getElementById('preview-img').style.transform = 'scale(1)';
  document.getElementById('preview-img').src = getCardImageUrl(card) || '';
  document.getElementById('preview-title').innerText = `${card["名前"]} (${card["カードNo"]})`;
  const matched = masterKeywords.filter(kw => (card["効果"] || '').includes(kw.name));
  document.getElementById('keyword-preview-area').innerHTML = matched.map(kw =>
    `<div class="keyword-item"><span class="keyword-name">【${kw.name}】</span><div class="keyword-desc">${kw.effect}</div></div>`
  ).join('');
  const limit = (card["効果"] || '').includes('50枚まで') ? 50 : 4;
  document.getElementById('qty-area').innerHTML = [1, 2, 3, 4].map(n =>
    `<button class="ctrl-btn" style="width:100%;" onclick="addToDeck('${id}', ${n}, ${limit})">+${n}</button>`
  ).join('');
  updateQtyMsg(id);
  document.getElementById('card-preview-window').style.display = 'block';
};

window.hidePreview = function() {
  document.getElementById('card-preview-window').style.display = 'none';
};

window.addToDeck = function(id, num, limit) {
  const card = allCards.find(c => c["カードNo"] === id);
  if (!card) return;
  const isTama = (String(card["レベル"]) === '2');
  let item = tempDeck.find(i => i.card["カードNo"] === id);
  let current = item ? item.count : 0;
  if (current + num > limit) return alert(`最大 ${limit} 枚までです`);
  if (isTama) {
    const tamaTotal = tempDeck.filter(i => String(i.card["レベル"]) === '2').reduce((s, i) => s + i.count, 0);
    if (tamaTotal + num > 5) return alert('デジタマデッキは最大5枚までです');
  }
  if (item) item.count += num; else tempDeck.push({ card, count: num });
  updateDeckUI();
  updateQtyMsg(id);
};

function updateQtyMsg(id) {
  const item = tempDeck.find(i => i.card["カードNo"] === id);
  const msgEl = document.getElementById('current-qty-msg');
  if (msgEl) msgEl.innerText = `現在投入数: ${item ? item.count : 0} 枚`;
}

window.changeQty = function(id, diff) {
  let item = tempDeck.find(i => i.card["カードNo"] === id);
  if (!item) return;
  const isTama = (String(item.card["レベル"]) === '2');
  const limit = (item.card["効果"] || '').includes('50枚まで') ? 50 : 4;
  if (item.count + diff > limit) return;
  if (isTama && diff > 0) {
    const tamaTotal = tempDeck.filter(i => String(i.card["レベル"]) === '2').reduce((s, i) => s + i.count, 0);
    if (tamaTotal >= 5) return alert('デジタマデッキは最大5枚までです');
  }
  item.count += diff;
  if (item.count <= 0) tempDeck = tempDeck.filter(i => i.card["カードNo"] !== id);
  updateDeckUI();
};

window.updateDeckUI = function() {
  let mainTotal = 0, tamaTotal = 0;
  const listArea = document.getElementById('deck-list-area');
  if (!listArea) return;
  listArea.innerHTML = tempDeck.map(i => {
    const isTama = (String(i.card["レベル"]) === '2');
    if (isTama) tamaTotal += i.count; else mainTotal += i.count;
    return `<div class="deck-item">
      <div class="deck-item-info">
        <span class="deck-item-name">${i.card["名前"]}</span>
        <span class="deck-item-qty">x${i.count}</span>
      </div>
      <div class="deck-controls">
        <button class="ctrl-btn" onclick="changeQty('${i.card["カードNo"]}', 1)">+</button>
        <button class="ctrl-btn" onclick="changeQty('${i.card["カードNo"]}', -1)">-</button>
        <button class="ctrl-btn del" onclick="tempDeck=tempDeck.filter(x=>x.card['カードNo']!=='${i.card["カードNo"]}');updateDeckUI();">全削</button>
      </div>
    </div>`;
  }).join('');
  const mainEl = document.getElementById('main-count');
  const tamaEl = document.getElementById('tama-count');
  if (mainEl) mainEl.innerText = mainTotal;
  if (tamaEl) tamaEl.innerText = tamaTotal;
};

// ===== 保存処理（GAS API） =====
window.showSaveScreen = function() {
  if (tempDeck.length === 0) return alert('空です');
  showScreen('save-settings-screen');
  if (window._editDeckName) document.getElementById('deck-name-input').value = window._editDeckName;
  document.getElementById('cover-select-area').innerHTML = tempDeck.map(i => {
    const imgUrl = i.card["ImageURL"] || '';
    const src = getCardImageUrl(i.card);
    return `<div onclick="selectCover(this, '${imgUrl}')" style="border:2px solid transparent; cursor:pointer;"><img src="${src}" style="width:100%"></div>`;
  }).join('');
};

window.selectCover = function(el, url) {
  document.querySelectorAll('#cover-select-area div').forEach(d => d.style.borderColor = 'transparent');
  el.style.borderColor = 'var(--main-cyan)';
  selectedCoverUrl = url;
};

window.handleSaveRequest = async function() {
  const name = document.getElementById('deck-name-input').value;
  const pw = currentSessionPassword;
  if (!name || !selectedCoverUrl) return alert('デッキ名とカバー画像を選択してください');
  if (!pw) return alert('合言葉が設定されていません。一度ログアウトして再ログインしてください');

  const btn = document.getElementById('save-confirm-btn');
  btn.disabled = true; btn.innerText = 'SAVING...';

  try {
    // 既存デッキチェック
    const checkResult = await gasPost('checkExistingDeck', { name, password: pw });
    const exists = checkResult.exists;

    if (exists) {
      if (!confirm('同じデッキ名と合言葉のデータが存在します。上書き保存しますか？')) {
        btn.disabled = false; btn.innerText = '保存を確定する';
        return;
      }
    }

    const list = tempDeck.map(i => `${i.card["名前"]}(${i.card["カードNo"]})x${i.count}`).join(',');

    const saveResult = await gasPost('saveDeck', {
      name, cover: selectedCoverUrl, list, password: pw, isUpdate: exists
    });

    const isUpdate = saveResult.status === 'SUCCESS_UPDATE';
    document.getElementById('finish-status-title').innerText =
      isUpdate ? 'デッキの編集が完了しました' : 'デッキの保存が完了しました';
    document.getElementById('finish-deck-name').innerText = name;

    const coverCard = tempDeck.find(i => i.card["ImageURL"] === selectedCoverUrl);
    if (coverCard) {
      document.getElementById('finish-cover-img').src = getCardImageUrl(coverCard.card);
    } else {
      document.getElementById('finish-cover-img').src = getGoogleDriveDirectLink(selectedCoverUrl);
    }

    btn.disabled = false; btn.innerText = '保存を確定する';
    window._editDeckName = '';
    window._editPassword = '';
    showScreen('save-finish-screen');
  } catch (e) {
    alert('保存エラー: ' + e.message);
    btn.disabled = false; btn.innerText = '保存を確定する';
  }
};
