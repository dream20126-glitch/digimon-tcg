// 管理画面ロジック（GAS API版）
import { gasGet, gasPost } from './firebase-config.js';
import { loadCardAndKeywordData, getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

let adminLoggedIn = false;
let tdEditData = null;
let tsaveSelectedCover = '';
let tsaveSelectedDiff = 0;

// 管理者ログイン
window.tryAdminLogin = async function() {
  const passInput = document.getElementById('admin-pass-input');
  const btn = document.getElementById('admin-login-btn');
  const pass = passInput.value;
  if (!pass) return alert('パスワードを入力してください');
  btn.innerText = '照合中...'; btn.disabled = true;

  try {
    const result = await gasGet('checkAdmin', { pw: pass });
    btn.innerText = 'ログイン'; btn.disabled = false;
    if (result.valid) {
      adminLoggedIn = true;
      document.getElementById('admin-login-area').style.display = 'none';
      document.getElementById('admin-content-area').style.display = 'block';
    } else {
      alert('パスワードが違います');
      passInput.value = '';
    }
  } catch (e) {
    btn.innerText = 'ログイン'; btn.disabled = false;
    alert('通信エラー: ' + e.message);
  }
};

window.adminLogout = function() {
  adminLoggedIn = false;
  document.getElementById('admin-pass-input').value = '';
  document.getElementById('admin-login-area').style.display = 'block';
  document.getElementById('admin-content-area').style.display = 'none';
  showScreen('login-screen');
};

window.showAdminDeckList = function() { showScreen('admin-deck-list-screen'); loadAdminDeckData(); };
window.showAdminRestrict = function() { alert('禁止・制限カード管理は現在準備中です'); };

window.loadAdminDeckData = async function() {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#555; padding:30px;">取得中...</td></tr>';

  try {
    const decks = await gasGet('getAllDecks');
    if (decks.error) { tbody.innerHTML = `<tr><td colspan="5" style="color:#ff4444; text-align:center; padding:30px;">エラー: ${decks.error}</td></tr>`; return; }

    document.getElementById('admin-deck-count').innerText = decks.length;
    document.getElementById('admin-registered-count').innerText = decks.filter(d => d.status === '登録済み').length;

    if (!decks.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#555; padding:30px;">データがありません</td></tr>'; return; }
    tbody.innerHTML = decks.map(d => {
      const cardCount = (d.list || '').split(',').reduce((s, l) => { const m = l.match(/x(\d+)$/); return s + (m ? parseInt(m[1]) : 0); }, 0);
      const statusHtml = d.status === '登録済み' ? '<span class="status-badge status-registered">登録済み</span>' : '<span class="status-badge status-none">未登録</span>';
      return `<tr><td>${d.date}</td><td style="color:#fff; font-weight:bold;">${d.name}</td><td style="font-family:monospace;">${d.password || '---'}</td><td style="font-size:11px; color:#888;">${d.list} (${cardCount}枚)</td><td>${statusHtml}</td></tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#ff4444; text-align:center; padding:30px;">エラー: ${e.message}</td></tr>`;
  }
};

// チュートリアルデッキ一覧
window.loadTutorialList = async function() {
  const area = document.getElementById('tutorial-deck-list');
  area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">読み込み中...</p>';

  try {
    const decks = await gasGet('getTutorialDecks');
    if (decks.error) { area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${decks.error}</p>`; return; }
    if (!decks.length) { area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">チュートリアルデッキが登録されていません</p>'; return; }

    area.innerHTML = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
      <th style="width:30px;">No</th><th>チュートリアル名</th><th>デッキ名</th>
      <th style="width:90px;">難易度</th><th style="width:80px;">対象</th><th style="width:130px;">操作</th>
    </tr></thead><tbody>${decks.map((d, i) => `<tr>
      <td style="color:#555;">${i + 1}</td>
      <td style="color:#fff; font-weight:bold;">${d.tutorialName || ''}</td>
      <td style="color:#ccc;">${d.deckName || ''}</td>
      <td>${d.difficulty || '---'}</td>
      <td style="font-size:11px; color:#aaa;">${d.target || '---'}</td>
      <td>
        <button class="admin-btn-sm" style="padding:4px 10px; font-size:11px;" onclick='editTutorialDeck(${JSON.stringify(d).replace(/'/g, "\\'")})'>編集</button>
        <button class="admin-btn-danger" onclick="deleteTutorialConfirm(${d.index}, '${(d.tutorialName || '').replace(/'/g, "\\'")}')">削除</button>
      </td>
    </tr>`).join('')}</tbody></table></div>`;
  } catch (e) { area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${e.message}</p>`; }
};

window.deleteTutorialConfirm = async function(rowIndex, name) {
  if (!confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)) return;
  try {
    const result = await gasPost('deleteTutorialDeck', { rowIndex });
    if (result.status === 'SUCCESS') { alert('削除しました'); loadTutorialList(); }
    else alert('エラー: ' + result.status);
  } catch (e) { alert('通信エラー: ' + e.message); }
};

// チュートリアル用デッキビルダー
window.initTutorialBuilder = async function() {
  isTutorialMode = true; tdEditData = null;
  window._editDeckName = ''; window._editPassword = '';
  tempDeck = []; updateDeckUI();
  const label = document.getElementById('back-btn-label');
  if (label) label.innerText = '管理画面へ戻る';
  showScreen('deck-make-screen');
  if (allCards.length === 0) {
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadCardAndKeywordData();
    document.getElementById('loading-overlay').style.display = 'none';
  }
  filterCards();
};

window.editTutorialDeck = async function(d) {
  isTutorialMode = true; tdEditData = d; tempDeck = [];
  showScreen('deck-make-screen');
  if (allCards.length === 0) {
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadCardAndKeywordData();
    document.getElementById('loading-overlay').style.display = 'none';
  }
  if (d.list) {
    d.list.split(',').forEach(line => {
      const m = line.match(/(.+)\((.+)\)x(\d+)/);
      if (m) { const card = allCards.find(c => c["カードNo"] === m[2]); if (card) tempDeck.push({ card, count: parseInt(m[3]) }); }
    });
  }
  updateDeckUI(); filterCards();
};

window.showTutorialSaveScreen = function() {
  if (tempDeck.length === 0) return alert('カードが1枚もありません');
  tsaveSelectedCover = ''; tsaveSelectedDiff = 0;
  document.getElementById('tsave-tutorial-name').value = tdEditData ? (tdEditData.tutorialName || '') : '';
  document.getElementById('tsave-deck-name').value = tdEditData ? (tdEditData.deckName || '') : '';
  document.getElementById('tsave-message').value = tdEditData ? (tdEditData.message || '') : '';
  document.getElementById('tsave-target').value = tdEditData ? (tdEditData.target || '初心者向け') : '初心者向け';
  document.querySelectorAll('.tdiff-btn').forEach(b => b.classList.remove('selected'));
  if (tdEditData) {
    const diffMap = {'⭐':1,'⭐⭐':2,'⭐⭐⭐':3};
    if (tdEditData.difficulty && diffMap[tdEditData.difficulty]) tsaveSelectDiff(diffMap[tdEditData.difficulty]);
    tsaveSelectedCover = tdEditData.cover || '';
    document.getElementById('tsave-title').innerText = 'チュートリアルデッキ編集';
  } else { document.getElementById('tsave-title').innerText = 'チュートリアルデッキ登録'; }
  document.getElementById('tsave-cover-area').innerHTML = tempDeck.map(i => {
    const src = getCardImageUrl(i.card), imgUrl = i.card["ImageURL"] || '';
    return `<div onclick="tsaveSelectCover(this,'${imgUrl}')" style="border:2px solid ${tsaveSelectedCover===imgUrl?'var(--main-cyan)':'transparent'}; cursor:pointer; border-radius:4px; overflow:hidden;"><img src="${src}" style="width:100%; display:block;"></div>`;
  }).join('');
  showScreen('tutorial-save-screen');
};

window.tsaveSelectDiff = function(num) { tsaveSelectedDiff = num; document.querySelectorAll('.tdiff-btn').forEach((b, i) => b.classList.toggle('selected', i + 1 === num)); };
window.tsaveSelectCover = function(el, url) { tsaveSelectedCover = url; document.querySelectorAll('#tsave-cover-area div').forEach(d => d.style.borderColor = 'transparent'); el.style.borderColor = 'var(--main-cyan)'; };

window.executeTutorialSave = async function() {
  const tutorialName = document.getElementById('tsave-tutorial-name').value.trim();
  const deckName = document.getElementById('tsave-deck-name').value.trim();
  const message = document.getElementById('tsave-message').value.trim();
  const target = document.getElementById('tsave-target').value;
  const difficulty = ['','⭐','⭐⭐','⭐⭐⭐'][tsaveSelectedDiff] || '';
  const list = tempDeck.map(i => `${i.card["名前"]}(${i.card["カードNo"]})x${i.count}`).join(',');

  if (!tutorialName) return alert('チュートリアル名を入力してください');
  if (!deckName) return alert('デッキ名を入力してください');
  if (!tsaveSelectedCover) return alert('代表画像を選択してください');

  const btn = document.getElementById('tsave-confirm-btn');
  btn.disabled = true; btn.innerText = '保存中...';

  try {
    const action = tdEditData && tdEditData.index ? 'updateTutorialDeck' : 'saveTutorialDeck';
    const body = { tutorialName, deckName, cover: tsaveSelectedCover, list, target, message, difficulty };
    if (tdEditData && tdEditData.index) body.rowIndex = tdEditData.index;

    const result = await gasPost(action, body);
    btn.disabled = false; btn.innerText = '保存を確定する';
    if (result.status === 'SUCCESS_NEW' || result.status === 'SUCCESS_UPDATE' || result.status === 'SUCCESS') {
      alert(`「${tutorialName}」を${result.status === 'SUCCESS_UPDATE' ? '上書き保存' : '新規登録'}しました！`);
      isTutorialMode = false; showScreen('tutorial-list-screen'); loadTutorialList();
    } else { alert('エラー: ' + result.status); }
  } catch (e) { btn.disabled = false; btn.innerText = '保存を確定する'; alert('通信エラー: ' + e.message); }
};
