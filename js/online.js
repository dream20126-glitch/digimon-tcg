// オンライン対戦ロジック（Firebase Realtime DB + GAS API）
import { rtdb, ref, set, update, remove, onValue, onDisconnect, gasGet } from './firebase-config.js';

// サイコロ定数
const DICE_FACE_ROTATION = {
  1: { x: 0, y: 0 }, 2: { x: -90, y: 0 }, 3: { x: 0, y: -90 },
  4: { x: 0, y: 90 }, 5: { x: 90, y: 0 }, 6: { x: 0, y: 180 }
};
const DOT_POSITIONS = {
  1: [[2,2]], 2: [[1,3],[3,1]], 3: [[1,3],[2,2],[3,1]],
  4: [[1,1],[1,3],[3,1],[3,3]], 5: [[1,1],[1,3],[2,2],[3,1],[3,3]],
  6: [[1,1],[1,3],[2,1],[2,3],[3,1],[3,3]]
};

let diceRolling = false;
let diceJudged = false;
let _battleStarted = false;

function initDiceFaces() {
  for (let n = 1; n <= 6; n++) {
    const face = document.getElementById('face-' + n);
    if (!face) continue;
    face.innerHTML = '';
    face.style.display = 'grid';
    face.style.gridTemplateColumns = 'repeat(3, 1fr)';
    face.style.gridTemplateRows = 'repeat(3, 1fr)';
    face.style.padding = '10px';
    face.style.boxSizing = 'border-box';
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 3; c++) {
        const cell = document.createElement('div');
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        if (DOT_POSITIONS[n].some(([dr,dc]) => dr===r && dc===c)) {
          const dot = document.createElement('div');
          dot.style.cssText = 'width:10px;height:10px;background:#111;border-radius:50%';
          cell.appendChild(dot);
        }
        face.appendChild(cell);
      }
    }
  }
}

function renderDice(el, num) {
  if (!el) return;
  el.innerHTML = '';
  el.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:8px;box-sizing:border-box;background:#fff;border-radius:10px;width:70px;height:70px;margin:0 auto;';
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 3; c++) {
      const cell = document.createElement('div');
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      if (DOT_POSITIONS[num].some(([dr,dc]) => dr===r && dc===c)) {
        const dot = document.createElement('div');
        dot.style.cssText = 'width:9px;height:9px;background:#111;border-radius:50%';
        cell.appendChild(dot);
      }
      el.appendChild(cell);
    }
  }
}

window.rollDiceShared = function(callback) {
  if (diceRolling) return;
  diceRolling = true;
  const val = Math.ceil(Math.random() * 6);
  const overlay = document.getElementById('dice-overlay');
  const label = document.getElementById('dice-result-label');
  const diceEl = document.getElementById('dice');
  label.innerText = '';
  initDiceFaces();
  overlay.classList.add('show');
  diceEl.style.transition = 'none';
  diceEl.style.transform = 'rotateX(0deg) rotateY(0deg)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const spins = Math.floor(Math.random() * 3) + 3;
    const finalRot = DICE_FACE_ROTATION[val];
    diceEl.style.transition = 'transform 1.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
    diceEl.style.transform = `rotateX(${spins * 360 + finalRot.x}deg) rotateY(${spins * 360 + finalRot.y}deg)`;
  }));
  setTimeout(() => {
    label.innerText = `🎲 ${val}`;
    diceEl.style.filter = 'drop-shadow(0 0 20px #00fbff)';
    setTimeout(() => diceEl.style.filter = '', 700);
    setTimeout(() => { overlay.classList.remove('show'); diceRolling = false; if (callback) callback(val); }, 1800);
  }, 1500);
};

window.rollDice = function() {
  rollDiceShared(val => {
    showResultBig(val);
    update(ref(rtdb, `rooms/${currentRoomId}/${myPlayerKey}`), { dice: val });
    const btn = document.getElementById('roll-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.35'; }
  });
};

function showResultBig(num) {
  const el = document.getElementById('d-num-' + myPlayerKey);
  if (!el) return;
  el.style.transition = 'transform 0.2s';
  setTimeout(() => { renderDice(el, num); el.style.transform = 'scale(1.8)'; el.style.boxShadow = '0 0 20px #00ffcc'; }, 100);
  setTimeout(() => { el.style.transform = 'scale(1)'; el.style.boxShadow = ''; }, 500);
}

function dResetAll() {
  diceRolling = false; diceJudged = false; initDiceFaces();
  ['p1','p2'].forEach(id => {
    const num = document.getElementById('d-num-' + id), lbl = document.getElementById('d-lbl-' + id), box = document.getElementById('d-box-' + id);
    if (num) num.innerText = '?'; if (lbl) { lbl.innerText = '待機中'; lbl.style.color = '#555'; }
    if (box) { box.style.borderColor = '#00fbff44'; box.style.opacity = '1'; }
  });
  const btn = document.getElementById('roll-btn'); if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  const msg = document.getElementById('dice-msg'); if (msg) { msg.innerText = '先攻後攻を決めます。サイコロを振ってください'; msg.style.color = 'var(--main-cyan)'; }
}

function playDiceAnimation(d1, d2, data) {
  const num1 = document.getElementById('d-num-p1'), num2 = document.getElementById('d-num-p2');
  let count = 0;
  const interval = setInterval(() => {
    if (num1) renderDice(num1, Math.ceil(Math.random() * 6));
    if (num2) renderDice(num2, Math.ceil(Math.random() * 6));
    if (++count > 15) { clearInterval(interval); if (num1) renderDice(num1, d1); if (num2) renderDice(num2, d2); judgeDiceWinner(d1, d2, data); }
  }, 80);
}

function judgeDiceWinner(d1, d2, data) {
  const roomRef = ref(rtdb, `rooms/${currentRoomId}`);
  if (d1 === d2) {
    const msg = document.getElementById('dice-msg'); if (msg) msg.innerText = '引き分け！もう一度';
    setTimeout(() => { update(roomRef, { 'player1/dice': 0, 'player2/dice': 0 }); dResetAll(); diceJudged = false; }, 1500);
    return;
  }
  update(roomRef, { diceResult: { p1: d1, p2: d2, winner: d1 > d2 ? 'player1' : 'player2' }, phase: 'result' });
}

function showBattleStartButton() {
  document.getElementById('action-area').innerHTML = `<button class="menu-btn primary" onclick="enterBattle()">ゲートへ入る</button>`;
}

window.enterBattle = function() {
  // Firebaseに「ゲートへ入る」フラグを立てる（両方揃ったらupdateLobbyUIでバトル開始）
  update(ref(rtdb, `rooms/${currentRoomId}/${myPlayerKey}`), { enterBattle: true });
  document.getElementById('action-area').innerHTML = '<p style="color:#ffaa00;font-size:13px;">相手を待っています...</p>';
};

window.joinRoom = function() {
  const roomId = document.getElementById('room-id-input').value.trim();
  const playerName = currentPlayerName || '名無しさん';
  if (!roomId) return alert('ルームIDを入力してください');
  // 前回バトルのフラグをリセット（連戦対応）
  _battleStarted = false;
  diceJudged = false;
  diceRolling = false;
  onValue(ref(rtdb, 'rooms/' + roomId), (snapshot) => {
    const data = snapshot.val();
    let assignedKey = null;
    if (!data || !data.player1) assignedKey = 'player1';
    else if (!data.player2) assignedKey = 'player2';
    else { alert('このルームは満員です'); return; }
    myPlayerKey = assignedKey; currentRoomId = roomId;
    const myRef = ref(rtdb, `rooms/${roomId}/${myPlayerKey}`);
    onDisconnect(myRef).remove();
    set(myRef, { name: playerName, active: true, dice: 0, ready: false, deckName: '', enterBattle: false });
    update(ref(rtdb, `rooms/${roomId}`), { phase: 'dice', gameStarted: false, diceResult: null }).then(() => {
      showScreen('battle-lobby-screen'); dResetAll();
      document.getElementById('deck-select-area').innerHTML = `
        <p style="color:#fff; font-size:14px; margin-bottom:10px;">対戦に使用するデッキを選択</p>
        <select id="battle-deck-select" style="width:100%; padding:12px; margin-bottom:15px; background:#222; color:#fff; border:1px solid var(--main-cyan); border-radius:5px;">
          <option value="">デッキを読み込み中...</option>
        </select>
        <button id="ready-btn" class="menu-btn primary" onclick="setPlayerReady()" style="width:100%;">デッキを確定して準備完了</button>`;
      document.getElementById('dice-area').style.display = 'none';
      loadDeckList(); startRoomListening(roomId);
    });
  }, { onlyOnce: true });
};

function startRoomListening(roomId) {
  if (roomListenerUnsubscribe) { roomListenerUnsubscribe(); roomListenerUnsubscribe = null; }
  roomListenerUnsubscribe = onValue(ref(rtdb, 'rooms/' + roomId), (snapshot) => {
    const data = snapshot.val(); if (data) updateLobbyUI(data);
  });
}

function updateLobbyUI(data) {
  if (!data) return;
  const statusEl = document.getElementById('lobby-status'), actionArea = document.getElementById('action-area'),
        diceArea = document.getElementById('dice-area'), namesDisplay = document.getElementById('player-names-display'),
        countMsg = document.getElementById('player-count-msg');
  const p1 = data.player1, p2 = data.player2;
  namesDisplay.innerHTML = `<div style="color:${p1?'var(--main-cyan)':'#555'}">P1: ${p1?p1.name:'待機中...'}</div><div style="color:${p2?'var(--main-cyan)':'#555'}">P2: ${p2?p2.name:'待機中...'}</div>`;
  if (!p1 || !p2) { countMsg.innerText = '1/2名 接続中... 相手の入室を待っています'; statusEl.innerText = 'WAITING...'; return; }
  countMsg.innerText = '2/2名 接続済み';
  namesDisplay.innerHTML = `<div style="color:var(--main-cyan)">P1: ${p1.name} ${p1.ready?'<span style="color:#00ff88; font-size:10px;"> ✓ 準備完了</span>':'<span style="color:#ff6600; font-size:10px;"> 準備中...</span>'}</div><div style="color:var(--main-cyan)">P2: ${p2.name} ${p2.ready?'<span style="color:#00ff88; font-size:10px;"> ✓ 準備完了</span>':'<span style="color:#ff6600; font-size:10px;"> 準備中...</span>'}</div>`;
  if (!(p1.ready && p2.ready)) { statusEl.innerText = 'WAITING FOR READY...'; actionArea.innerHTML = ''; diceArea.style.display = 'none'; return; }
  if (!data.gameStarted) { statusEl.innerText = 'READY'; actionArea.innerHTML = `<button class="menu-btn primary" onclick="startGame()" style="width:100%;">デジタルゲートオープン（対戦開始）</button>`; diceArea.style.display = 'none'; return; }
  statusEl.innerText = 'GATE OPEN!';
  if (diceArea.style.display !== 'block') {
    diceArea.style.display = 'block';
    const n1 = document.getElementById('d-name-p1'), n2 = document.getElementById('d-name-p2');
    if (n1) n1.innerText = p1.name || 'P1'; if (n2) n2.innerText = p2.name || 'P2';
    diceRolling = false;
    const btn = document.getElementById('roll-btn'); if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    const msg = document.getElementById('dice-msg'); if (msg) msg.innerText = '先攻後攻を決めます。サイコロを振ってください';
  }
  ['p1','p2'].forEach(key => {
    const val = data[key] ? (data[key].dice || 0) : 0;
    if (key !== myPlayerKey && val > 0) {
      const num = document.getElementById('d-num-' + key);
      if (!num || num.dataset.rendered === String(val)) return;
      num.dataset.rendered = String(val); renderDice(num, val);
      const lbl = document.getElementById('d-lbl-' + key); if (lbl) { lbl.innerText = '確定！'; lbl.style.color = '#00ff88'; }
    }
  });
  const myData = data[myPlayerKey];
  if (myData && myData.dice > 0 && !diceRolling) { const btn = document.getElementById('roll-btn'); if (btn) { btn.disabled = true; btn.style.opacity = '0.35'; } }
  const d1 = p1.dice || 0, d2 = p2.dice || 0;
  if (d1 > 0 && d2 > 0 && !diceJudged) { diceJudged = true; playDiceAnimation(d1, d2, data); }
  if ((data.phase === 'result' || data.phase === 'battle') && data.diceResult) {
    const msg = document.getElementById('dice-msg');
    if (msg) { msg.style.color = '#00ff88'; msg.innerText = data.diceResult.winner === myPlayerKey ? '🎉 あなたが先攻です！' : '相手が先攻です'; }
    const myEntered = data[myPlayerKey]?.enterBattle;
    const oppKey2 = myPlayerKey === 'player1' ? 'player2' : 'player1';
    const oppEntered = data[oppKey2]?.enterBattle;
    // 両方揃ったらバトル開始
    if (myEntered && oppEntered && !_battleStarted) {
      const playerFirst = data.diceResult?.winner === myPlayerKey;
      const myList = data[myPlayerKey]?.deckList;
      const oppList = data[oppKey2]?.deckList;
      // デッキリストが両方揃っている場合のみバトル開始（早期に_battleStartedを立てて止まるのを防ぐ）
      if (myList && oppList) {
        _battleStarted = true;
        showScreen('battle-screen');
        if (typeof startOnlineBattle === 'function') {
          const oppName = data[oppKey2]?.name || '相手プレイヤー';
          startOnlineBattle({ list: myList }, { list: oppList }, playerFirst, currentRoomId, myPlayerKey, oppName);
        }
      }
    } else if (myEntered && !oppEntered) {
      actionArea.innerHTML = '<p style="color:#ffaa00;font-size:13px;">相手を待っています...</p>';
    } else if (!myEntered) {
      showBattleStartButton();
    }
  }
}

window.startGame = function() { update(ref(rtdb, `rooms/${currentRoomId}`), { gameStarted: true }); };

let _loadedDecks = []; // デッキ一覧をキャッシュ

async function loadDeckList() {
  const select = document.getElementById('battle-deck-select'); if (!select) return;
  select.innerHTML = '<option value="">読み込み中...</option>';
  try {
    _loadedDecks = await gasGet('getDecks', { pw: currentSessionPassword });
    select.innerHTML = '<option value="">デッキを選択してください</option>';
    if (_loadedDecks && _loadedDecks.length > 0) {
      const battleDecks = _loadedDecks.filter(d => String(d.status || '').trim() === '登録済み');
      (battleDecks.length > 0 ? battleDecks : _loadedDecks).forEach(d => {
        const opt = document.createElement('option'); opt.value = d.name;
        opt.textContent = d.name + (String(d.status || '').trim() === '登録済み' ? ' ✓' : '');
        select.appendChild(opt);
      });
    } else { select.innerHTML = '<option value="">デッキが見つかりません</option>'; }
  } catch (e) { select.innerHTML = '<option value="">デッキ読み込み失敗</option>'; console.error(e); }
}

window.setPlayerReady = function() {
  const deckName = document.getElementById('battle-deck-select').value;
  if (!deckName) return alert('デッキを選択してください');
  // キャッシュ済みデッキからカードリストを取得（GAS再呼び出し不要）
  const deck = _loadedDecks.find(d => d.name === deckName);
  if (!deck || !deck.list) { alert('デッキデータが見つかりません。ページを再読み込みしてください。'); return; }
  update(ref(rtdb, `rooms/${currentRoomId}/${myPlayerKey}`), { ready: true, deckName, deckList: deck.list });
  document.getElementById('deck-select-area').innerHTML = `<p style="color:var(--main-cyan); font-weight:bold; margin:0;">デッキ確定: ${deckName}</p><p style="color:#aaa; font-size:12px; margin-top:8px;">相手の準備を待っています...</p>`;
};

window.leaveRoom = function() {
  if (roomListenerUnsubscribe) { roomListenerUnsubscribe(); roomListenerUnsubscribe = null; }
  const roomId = currentRoomId, playerKey = myPlayerKey;
  currentRoomId = null; myPlayerKey = null;
  if (roomId && playerKey) {
    remove(ref(rtdb, `rooms/${roomId}/${playerKey}`)).then(() => {
      update(ref(rtdb, `rooms/${roomId}`), { gameStarted: false });
      onValue(ref(rtdb, `rooms/${roomId}`), snap => {
        const d = snap.val(); if (!d) return;
        const otherKey = playerKey === 'player1' ? 'player2' : 'player1';
        if (d[otherKey]) update(ref(rtdb, `rooms/${roomId}/${otherKey}`), { ready: false, dice: 0 });
      }, { onlyOnce: true });
    }).catch(() => {}).finally(() => { dResetAll(); showScreen('top-menu-screen'); });
  } else { dResetAll(); showScreen('top-menu-screen'); }
};
