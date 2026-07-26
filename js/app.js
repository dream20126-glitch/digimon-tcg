// アプリ共通：画面遷移、ログイン/ログアウト
import { getGoogleDriveDirectLink } from './cards.js';

// グローバル状態
window.currentSessionPassword = '';
window.currentPlayerName = '';
window.currentRoomId = null;
window.myPlayerKey = null;
window.roomListenerUnsubscribe = null;
window.isTutorialMode = false;
window.tempDeck = [];
window.editDeckName = null;
window.currentSortMode = 'name';
window.selectedCoverUrl = '';
window.zoomScale = 1;

// 画面切り替え
window.showScreen = function(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);

  if (id === 'room-entrance-screen') {
    const label = document.getElementById('room-player-label');
    if (label) label.innerText = currentPlayerName || '（未設定）';
  }
};

window.backToTop = function() {
  showScreen('top-menu-screen');
};

// ログイン
window.doLogin = function() {
  const name = document.getElementById('login-name-input').value.trim();
  const pw = document.getElementById('login-password-input').value.trim();

  if (!name) return alert('プレイヤー名を入力してください');
  if (!pw) return alert('パスワードを入力してください');

  currentPlayerName = name;
  currentSessionPassword = pw;

  const el = document.getElementById('display-player-name');
  if (el) el.innerText = name + ' さん';

  showScreen('top-menu-screen');
};

// ログアウト
window.doLogout = function() {
  if (!confirm('ログアウトしますか？')) return;
  currentPlayerName = '';
  currentSessionPassword = '';
  document.getElementById('login-name-input').value = '';
  document.getElementById('login-password-input').value = '';
  showScreen('login-screen');
};

// アプリ初期化
// カード図鑑の全件読み込みはここでは行わない（カード数が数千〜1万件規模になっても
// ログイン画面自体は重くならないよう、各画面が実際に必要になった時点で読み込む）。
// デッキ構築・管理画面は画面表示時に、バトル・効果テストは開始時にデッキ/設定分のみ読み込む。
window.addEventListener('DOMContentLoaded', async () => {
  console.log('App initialized (カード読み込みは各画面で実施)');

  // カード裏面画像を設定
  const cardBackUrl = getGoogleDriveDirectLink('https://drive.google.com/file/d/1dB8HeZHD0TbKAnNpZSCBnWgyD7YDeseD/view');
  const loginImg = document.getElementById('card-back-img-login');
  const topImg = document.getElementById('card-back-img-top');
  if (loginImg) loginImg.src = cardBackUrl;
  if (topImg) topImg.src = cardBackUrl;
});
