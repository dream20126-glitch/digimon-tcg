// サンプルデッキ（GAS API版）
// - ユーザー: デッキ作成の入口（deck-start-screen）でサンプルデッキを見て、そのまま／編集してマイデッキに登録する
// - 管理者: 管理画面でサンプルデッキを作成・編集・削除する（デッキビルダーを isSampleMode で使う）
// シート「サンプルデッキ」の「AI用」は AI対戦で AI に持たせられるデッキ（サンプルと兼用）
import { gasGet, gasPost } from './firebase-config.js';
import { loadCardAndKeywordData, getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

window.isSampleMode = false;
let sampleDecks = [];        // ユーザー向け（公開のみ）
let adminSampleDecks = [];   // 管理画面向け（非公開も）
let sdEditData = null;       // 管理画面で編集中のサンプルデッキ（新規は null）
let sdSaveCover = '';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function ensureCards() {
  if (allCards.length > 0) return;
  const ov = document.getElementById('loading-overlay');
  if (ov) ov.style.display = 'flex';
  try { await loadCardAndKeywordData(); } finally { if (ov) ov.style.display = 'none'; }
}

// "名前(No)xN,..." → [{ card, count }]（図鑑に無いカードは飛ばす）
function parseDeckList(list) {
  const out = [];
  String(list || '').split(',').forEach((line) => {
    const m = line.match(/(.+)\((.+)\)x(\d+)/);
    if (!m) return;
    const card = allCards.find((c) => c['カードNo'] === m[2]);
    if (card) out.push({ card, count: parseInt(m[3], 10) });
  });
  return out;
}
const isTama = (card) => String(card['レベル'] != null ? card['レベル'] : card['Lv']) === '2' || card['タイプ'] === 'デジタマ';
function countDeck(entries) {
  let main = 0, tama = 0;
  entries.forEach((e) => { if (isTama(e.card)) tama += e.count; else main += e.count; });
  return { main, tama };
}
function countFromList(list) {
  // 図鑑を読み込む前の一覧表示用（合計枚数だけ）
  return String(list || '').split(',').reduce((s, l) => { const m = l.match(/x(\d+)$/); return s + (m ? parseInt(m[1], 10) : 0); }, 0);
}

// ===== ユーザー: デッキ作成の入口 =====
window.showDeckStart = function() {
  window.isSampleMode = false;
  showScreen('deck-start-screen');
};

// ===== ユーザー: サンプルデッキ一覧 =====
window.showSampleList = async function() {
  window.isSampleMode = false;
  showScreen('sample-list-screen');
  const area = document.getElementById('sample-deck-container');
  if (!area) return;
  area.innerHTML = '<div style="color:var(--main-cyan); padding:20px; text-align:center;">サンプルデッキを読み込み中...</div>';
  try {
    const decks = await gasGet('getSampleDecks');
    if (decks && decks.error) throw new Error(decks.error);
    sampleDecks = Array.isArray(decks) ? decks : [];
    if (sampleDecks.length === 0) {
      area.innerHTML = '<div style="color:#555; padding:30px; text-align:center;">サンプルデッキはまだありません</div>';
      return;
    }
    area.innerHTML = sampleDecks.map((d, i) => `
      <div class="sample-deck-card" onclick="showSampleDetail(${i})">
        <img src="${esc(getGoogleDriveDirectLink(d.cover))}" onerror="this.style.visibility='hidden'">
        <div class="sample-deck-info">
          <div class="sample-deck-name">${esc(d.deckName)}</div>
          <div class="sample-deck-desc">${esc(d.description || '')}</div>
          <div class="sample-deck-count">${countFromList(d.list)}枚</div>
        </div>
      </div>`).join('');
  } catch (e) {
    area.innerHTML = `<div style="color:#ff4444; padding:20px; text-align:center;">読み込みエラー: ${esc(e.message)}</div>`;
  }
};

window.showSampleDetail = async function(idx) {
  const d = sampleDecks[idx];
  if (!d) return;
  window._sampleDetailIdx = idx;
  showScreen('sample-detail-screen');
  document.getElementById('sample-detail-name').innerText = d.deckName || '';
  document.getElementById('sample-detail-desc').innerText = d.description || '';
  const grid = document.getElementById('sample-detail-grid');
  grid.innerHTML = '<div style="color:var(--main-cyan); padding:20px;">読み込み中...</div>';
  await ensureCards();
  const entries = parseDeckList(d.list);
  const cnt = countDeck(entries);
  document.getElementById('sample-detail-count').innerText = `メイン ${cnt.main}枚 / デジタマ ${cnt.tama}枚`;
  grid.innerHTML = entries.map((e) => `
    <div style="text-align:center;">
      <img src="${esc(getCardImageUrl(e.card))}" style="width:100%; border-radius:4px;" onclick="showSampleCardZoom('${esc(getCardImageUrl(e.card))}')">
      <div style="font-size:10px; color:#aaa;">x${e.count}</div>
    </div>`).join('');
};

window.showSampleCardZoom = function(src) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML = `<img src="${src}" style="max-width:min(92vw,420px);max-height:90vh;border-radius:10px;">`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
};

// サンプルの中身をデッキビルダーに読み込む（新規のマイデッキとして。サンプル自体は書き換わらない）
async function loadSampleIntoBuilder(d) {
  await ensureCards();
  window.isTutorialMode = false;
  window.isSampleMode = false;
  window._editDeckName = '';
  window._editPassword = '';
  tempDeck = parseDeckList(d.list);
  const label = document.getElementById('back-btn-label');
  if (label) label.innerText = 'TOPへ戻る';
}

// そのまま登録: 保存画面へ（デッキ名とカバーはサンプルのものを最初から入れておく）
window.registerSampleAsIs = async function() {
  const d = sampleDecks[window._sampleDetailIdx];
  if (!d) return;
  await loadSampleIntoBuilder(d);
  updateDeckUI();
  showSaveScreen();
  document.getElementById('deck-name-input').value = d.deckName || '';
  selectedCoverUrl = '';
  const cells = document.querySelectorAll('#cover-select-area div');
  const coverIdx = tempDeck.findIndex((e) => (e.card['ImageURL'] || '') === d.cover);
  if (coverIdx >= 0 && cells[coverIdx]) selectCover(cells[coverIdx], d.cover);
};

// 編集して登録: デッキビルダーへ
window.editSampleBeforeRegister = async function() {
  const d = sampleDecks[window._sampleDetailIdx];
  if (!d) return;
  await loadSampleIntoBuilder(d);
  showScreen('deck-make-screen');
  updateDeckUI();
  filterCards();
};

// ===== 管理者: サンプルデッキ管理 =====
window.showSampleAdminList = async function() {
  showScreen('sample-admin-list-screen');
  const area = document.getElementById('sample-admin-list');
  area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">読み込み中...</p>';
  try {
    const decks = await gasGet('getSampleDecks', { pw: window._adminPassword || '' });
    if (decks && decks.error) throw new Error(decks.error);
    adminSampleDecks = Array.isArray(decks) ? decks : [];
    if (adminSampleDecks.length === 0) { area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">サンプルデッキが登録されていません</p>'; return; }
    area.innerHTML = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
      <th style="width:40px;">順</th><th>デッキ名</th><th style="width:60px;">枚数</th><th style="width:60px;">公開</th><th style="width:60px;">AI用</th><th style="width:130px;">操作</th>
    </tr></thead><tbody>${adminSampleDecks.map((d, i) => `<tr>
      <td style="color:#888;">${esc(d.order)}</td>
      <td style="color:#fff; font-weight:bold;">${esc(d.deckName)}<div style="font-size:10px; color:#888; font-weight:normal;">${esc(d.description || '')}</div></td>
      <td>${countFromList(d.list)}</td>
      <td>${d.published ? '<span style="color:#00ff88;">公開</span>' : '<span style="color:#666;">非公開</span>'}</td>
      <td>${d.forAi ? '<span style="color:#ffaa00;">AI用</span>' : '<span style="color:#666;">―</span>'}</td>
      <td>
        <button class="admin-btn-sm" style="padding:4px 10px; font-size:11px;" onclick="editSampleDeckAdmin(${i})">編集</button>
        <button class="admin-btn-danger" onclick="deleteSampleDeckAdmin(${i})">削除</button>
      </td>
    </tr>`).join('')}</tbody></table></div>`;
  } catch (e) { area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${esc(e.message)}</p>`; }
};

async function openSampleBuilder(d) {
  window.isTutorialMode = false;
  window.isSampleMode = true;
  sdEditData = d;
  window._editDeckName = ''; window._editPassword = '';
  const label = document.getElementById('back-btn-label');
  if (label) label.innerText = '管理画面へ戻る';
  showScreen('deck-make-screen');
  await ensureCards();
  tempDeck = d ? parseDeckList(d.list) : [];
  updateDeckUI();
  filterCards();
}
window.initSampleBuilder = function() { openSampleBuilder(null); };
window.editSampleDeckAdmin = function(i) { openSampleBuilder(adminSampleDecks[i] || null); };

window.deleteSampleDeckAdmin = async function(i) {
  const d = adminSampleDecks[i];
  if (!d || !confirm(`「${d.deckName}」を削除しますか？\nこの操作は取り消せません。`)) return;
  try {
    const r = await gasPost('deleteSampleDeck', { deckId: d.deckId, password: window._adminPassword || '' });
    if (r.status === 'SUCCESS') { alert('削除しました'); showSampleAdminList(); }
    else alert('エラー: ' + r.status);
  } catch (e) { alert('通信エラー: ' + e.message); }
};

// デッキビルダーの「戻る」（サンプル作成中）
window.leaveSampleBuilder = function() {
  if (!confirm('作成を中止してサンプルデッキ一覧へ戻りますか？')) return;
  window.isSampleMode = false;
  showSampleAdminList();
};

window.showSampleSaveScreen = function() {
  if (tempDeck.length === 0) return alert('カードが1枚もありません');
  const d = sdEditData;
  document.getElementById('ssave-title').innerText = d ? 'サンプルデッキ編集' : 'サンプルデッキ登録';
  document.getElementById('ssave-deck-name').value = d ? (d.deckName || '') : '';
  document.getElementById('ssave-desc').value = d ? (d.description || '') : '';
  document.getElementById('ssave-order').value = d ? (d.order || 0) : (adminSampleDecks.length + 1);
  document.getElementById('ssave-published').checked = d ? !!d.published : true;
  document.getElementById('ssave-for-ai').checked = d ? !!d.forAi : false;
  const cnt = countDeck(tempDeck);
  document.getElementById('ssave-count').innerText = `メイン ${cnt.main}/50枚・デジタマ ${cnt.tama}/5枚` + (cnt.main !== 50 ? '（メインが50枚ではありません）' : '');
  sdSaveCover = d ? (d.cover || '') : '';
  document.getElementById('ssave-cover-area').innerHTML = tempDeck.map((e) => {
    const imgUrl = e.card['ImageURL'] || '';
    return `<div onclick="ssaveSelectCover(this,'${esc(imgUrl)}')" style="border:2px solid ${sdSaveCover === imgUrl ? 'var(--main-cyan)' : 'transparent'}; cursor:pointer; border-radius:4px; overflow:hidden;"><img src="${esc(getCardImageUrl(e.card))}" style="width:100%; display:block;"></div>`;
  }).join('');
  showScreen('sample-save-screen');
};
window.ssaveSelectCover = function(el, url) {
  sdSaveCover = url;
  document.querySelectorAll('#ssave-cover-area div').forEach((x) => { x.style.borderColor = 'transparent'; });
  el.style.borderColor = 'var(--main-cyan)';
};

window.executeSampleSave = async function() {
  const deckName = document.getElementById('ssave-deck-name').value.trim();
  if (!deckName) return alert('デッキ名を入力してください');
  if (!sdSaveCover) return alert('代表画像を選択してください');
  const cnt = countDeck(tempDeck);
  if (cnt.main !== 50 && !confirm(`メインデッキが${cnt.main}枚です（50枚ではありません）。このまま保存しますか？`)) return;
  const deck = {
    deckId: sdEditData ? sdEditData.deckId : '',
    deckName,
    cover: sdSaveCover,
    list: tempDeck.map((e) => `${e.card['名前']}(${e.card['カードNo']})x${e.count}`).join(','),
    description: document.getElementById('ssave-desc').value.trim(),
    order: parseInt(document.getElementById('ssave-order').value, 10) || 0,
    published: document.getElementById('ssave-published').checked,
    forAi: document.getElementById('ssave-for-ai').checked,
  };
  const btn = document.getElementById('ssave-confirm-btn');
  btn.disabled = true; btn.innerText = '保存中...';
  try {
    const r = await gasPost('saveSampleDeck', { deck, password: window._adminPassword || '' });
    btn.disabled = false; btn.innerText = '保存を確定する';
    if (r.status === 'SUCCESS_NEW' || r.status === 'SUCCESS_UPDATE') {
      alert(`「${deckName}」を${r.status === 'SUCCESS_UPDATE' ? '上書き保存' : '新規登録'}しました`);
      window.isSampleMode = false; sdEditData = null;
      showSampleAdminList();
    } else alert('エラー: ' + r.status);
  } catch (e) { btn.disabled = false; btn.innerText = '保存を確定する'; alert('通信エラー: ' + e.message); }
};
