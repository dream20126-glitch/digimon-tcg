// デッキ一覧・登録ロジック（GAS API版）
import { gasGet, gasPost } from './firebase-config.js';
import { getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

window.loadSavedDecks = async function() {
  const container = document.getElementById('saved-decks-container');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--main-cyan); padding:20px;">デッキを読み込み中...</div>';

  try {
    const decks = await gasGet('getDecks', { pw: currentSessionPassword });

    if (decks.error) {
      container.innerHTML = `<div style="color:#ff4444; padding:20px;">エラー: ${decks.error}</div>`;
      return;
    }

    window.latestDecks = decks;

    if (!decks || decks.length === 0) {
      container.innerHTML = `
        <div style="padding:40px 20px; color:#555; text-align:center;">
          <div style="font-size:2rem; margin-bottom:10px;">🃏</div>
          <p>登録されたデッキはありません</p>
          <p style="font-size:12px;">「新しく作成する」からデッキを作りましょう！</p>
        </div>`;
      return;
    }

    container.innerHTML = decks.map((d, i) => {
      const isRegistered = String(d.status).trim() === '登録済み';
      const coverUrl = getGoogleDriveDirectLink(d.cover);
      return `
      <div class="deck-row">
        ${isRegistered ? '<div class="reg-badge">✓</div>' : ''}
        <img src="${coverUrl}" style="width:60px; height:85px; border-radius:8px; margin-right:15px; object-fit:cover; background:#333;" onerror="this.style.display='none'">
        <div style="flex:1; text-align:left; min-width:0;">
          <div style="color:#fff; font-weight:bold; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.name}</div>
          <div style="font-size:10px; color:${isRegistered ? '#00ff88' : '#666'}; margin-bottom:10px;">
            ${isRegistered ? '【対戦使用可能】' : d.date}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="deck-action-btn deck-action-btn-check" onclick="viewDeckDetail(${i})">確認</button>
            <button class="deck-action-btn deck-action-btn-edit" onclick="editDeckByIndex(${i})">編集</button>
            <button class="deck-action-btn" style="background:linear-gradient(135deg,#1a0000,#0d0000); border-color:#ff4444; color:#ff4444;" onclick="deleteDeckByIndex(${i})">削除</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:#ff4444; padding:20px;">エラー: ${e.message}</div>`;
  }
};

window.goToDeckListDirect = function() {
  showScreen('deck-list-screen');
  loadSavedDecks();
};

window.viewDeckDetail = function(idx) {
  const d = window.latestDecks[idx];
  const grid = document.getElementById('view-grid');
  grid.innerHTML = '';
  document.getElementById('view-title').innerText = d.name;
  document.getElementById('deck-view-modal').style.display = 'block';

  let mainDeckCount = 0;
  d.list.split(',').forEach(line => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (m) {
      const cardNo = m[2], count = parseInt(m[3]);
      const cardObj = allCards.find(c => c["カードNo"] === cardNo);
      if (cardObj && String(cardObj["レベル"]) !== '2') mainDeckCount += count;
      const imgUrl = cardObj ? getCardImageUrl(cardObj) : '';
      const cellId = `view-cell-${cardNo.replace(/[^a-z0-9]/gi, '')}`;
      grid.innerHTML += `<div id="${cellId}" style="text-align:center;">
        ${imgUrl ? `<img src="${imgUrl}" style="width:100%; border-radius:4px;">` : '<div style="height:80px; background:#111; border-radius:4px;"></div>'}
        <div style="font-size:10px; color:#aaa;">x${count}</div>
      </div>`;
    }
  });

  const actionArea = document.getElementById('modal-action-area');
  if (String(d.status).trim() === '登録済み') {
    actionArea.innerHTML = `<button class="menu-btn" style="border-color:#ff4444; color:#ff4444; background:#1a0000;" onclick="toggleRegistration('${d.name}', false)">対戦デッキの登録解除</button>`;
  } else {
    actionArea.innerHTML = `<button class="menu-btn primary" onclick="toggleRegistration('${d.name}', true, ${mainDeckCount})">対戦デッキに登録する</button>`;
  }
};

window.toggleRegistration = async function(name, isRegister, mainCount = 50) {
  if (isRegister && mainCount !== 50) {
    return alert(`メインデッキが50枚ではありません(現在:${mainCount}枚)。`);
  }

  try {
    await gasPost('updateDeckRegistration', {
      name, password: currentSessionPassword, isRegister
    });

    document.getElementById('deck-view-modal').style.display = 'none';
    if (isRegister) {
      showScreen('battle-register-screen');
    } else {
      alert('登録を解除しました。');
      goToDeckListDirect();
    }
  } catch (e) {
    alert('エラー: ' + e.message);
  }
};

window.deleteDeckByIndex = async function(idx) {
  const d = window.latestDecks[idx];
  if (!confirm(`「${d.name}」を削除しますか？\nこの操作は取り消せません。`)) return;

  try {
    const result = await gasPost('deleteDeck', {
      name: d.name, password: currentSessionPassword
    });
    if (result.success) {
      alert('削除しました。');
      loadSavedDecks();
    } else {
      alert('削除に失敗しました。');
    }
  } catch (e) {
    alert('エラー: ' + e.message);
  }
};
