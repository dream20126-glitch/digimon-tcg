// チュートリアルロジック（GAS API版）
import { gasGet } from './firebase-config.js';
import { getGoogleDriveDirectLink } from './cards.js';

let _allTutorialDecks = [];
let _playerTutorialDeck = null;
let _aiTutorialDeck = null;

window.loadTutorialScreen = function() { initTutorial(); };

async function initTutorial() {
  const area = document.getElementById('tutorial-deck-select-area');
  area.innerHTML = '<p style="color:#555;">デッキデータを取得中...</p>';

  try {
    const decks = await gasGet('getTutorialDecks');

    if (decks.error) { area.innerHTML = `<p style="color:#ff4444;">エラー: ${decks.error}</p>`; return; }

    _allTutorialDecks = decks;
    if (!decks || decks.length === 0) { area.innerHTML = '<p style="color:#ff4444;">デッキが見つかりません</p>'; return; }
    area.innerHTML = '';

    decks.forEach(d => {
      const targetStr = String(d.target || d.対象 || '');
      if (targetStr.includes('【AI用】')) return;

      const div = document.createElement('div');
      div.style = 'display:flex; align-items:center; background:#0a1a1a; border:1px solid #222; border-radius:8px; padding:10px; margin-bottom:10px; cursor:pointer;';
      div.onclick = () => selectTutorialDeck(d);

      const imgUrl = getGoogleDriveDirectLink(d.cover || d.代表画像URL || d.imageUrl || '');
      const name = d.deckName || d.デッキ名 || '無題のデッキ';

      div.innerHTML = `
        <img src="${imgUrl}" style="width:40px; height:56px; border-radius:3px; object-fit:cover; margin-right:12px; background:#000;" onerror="this.style.display='none'">
        <div style="text-align:left; flex:1;">
          <div style="font-size:14px; font-weight:bold; color:#fff;">${name}</div>
          <div style="font-size:11px; color:#aaa;">${d.difficulty || d.難易度 || ''}</div>
        </div>`;
      area.appendChild(div);
    });
  } catch (e) { area.innerHTML = `<p style="color:#ff4444;">エラー: ${e.message}</p>`; }

  showScreen('tutorial-screen');
}

function selectTutorialDeck(playerDeck) {
  _playerTutorialDeck = playerDeck;
  _aiTutorialDeck = _allTutorialDecks.find(d => String(d.target || d.対象 || d.deckName || d.デッキ名).includes('【AI用】')) || playerDeck;
  const getUrl = d => getGoogleDriveDirectLink(d.cover || d.代表画像URL || d.imageUrl || '');
  document.getElementById('tl-p-img').innerHTML = `<img src="${getUrl(playerDeck)}" style="width:100%; height:100%; object-fit:cover;">`;
  document.getElementById('tl-ai-img').innerHTML = `<img src="${getUrl(_aiTutorialDeck)}" style="width:100%; height:100%; object-fit:cover;">`;
  const youLabel = document.getElementById('tl-you-label');
  if (youLabel && currentPlayerName) youLabel.innerText = currentPlayerName;
  document.getElementById('tutorial-status-msg').innerText = 'READY...';
  document.getElementById('tutorial-status-msg').style.color = '#00ff88';
  document.getElementById('tutorial-action-area').innerHTML = `<button class="menu-btn primary" onclick="enterTutorialBattle()" style="width:100%; margin-top:10px; box-shadow: 0 0 15px var(--main-cyan);">ゲートへ入る (先攻: あなた)</button>`;
  showScreen('tutorial-lobby-screen');
}

window.enterTutorialBattle = function() {
  if (!_playerTutorialDeck || !_aiTutorialDeck) return;
  const pDeckList = _playerTutorialDeck.list || _playerTutorialDeck.カードリスト;
  const aiDeckList = _aiTutorialDeck.list || _aiTutorialDeck.カードリスト;
  if (typeof startBattleGame === 'function') { showScreen('battle-screen'); startBattleGame({ list: pDeckList }, { list: aiDeckList }, true); }
  else alert('バトルシステムの読み込みに失敗しました');
};
