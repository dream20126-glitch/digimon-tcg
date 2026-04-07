/**
 * battle-render.js — バトル画面DOM描画
 *
 * renderAll() を呼べば全エリアが更新される
 * 各render関数は対応するHTML要素にカード/ゲージを描画
 */

import { bs, MEM_MIN, MEM_MAX } from './battle-state.js';
import { updateScrollArrows, addLog } from './battle-ui.js';
import { getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';

// ===== カード画像ヘルパー =====
const cardBackUrl = getGoogleDriveDirectLink('https://drive.google.com/file/d/1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9/view');
const tamaBackUrl = getGoogleDriveDirectLink('https://drive.google.com/file/d/1-Os-ZfmgLlQeYGkTU1uUXrt7iowy0FLD/view');

export function cardImg(card) {
  return card.imgSrc || getCardImageUrl(card) || '';
}

// ===== オンラインモード参照 =====
let _onlineMode = false;
let _onlineMyKey = null;

export function setOnlineInfo(online, myKey) {
  _onlineMode = online;
  _onlineMyKey = myKey;
}

// ===== メイン描画 =====
export function renderAll(force) {
  renderSecurity();
  renderBattleRows();
  renderTamerRows();
  renderIkusei();
  renderHand();
  updateCounts();
  updateMemGauge();
  updatePhaseBadge();
  applyBackImages();
  setTimeout(updateScrollArrows, 0);
}

// ===== セキュリティ描画 =====
function renderSecurity() {
  const backHtml = cardBackUrl
    ? `<img src="${cardBackUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:2px;">`
    : '🛡';

  ['ai', 'pl'].forEach(side => {
    const sec = side === 'ai' ? bs.ai.security : bs.player.security;
    const el = document.getElementById(side + '-sec-area');
    const cnt = document.getElementById(side + '-sec-count');
    if (!el) return;

    if (sec.length > 0) {
      el.innerHTML = `<div style="position:relative;width:36px;height:${28 + (sec.length - 1) * 10}px;">` +
        sec.map((_, i) =>
          `<div class="sec-card ${side === 'ai' ? 'ai-sec' : 'pl-sec'}" style="position:absolute;top:${i * 10}px;left:0;width:36px;height:28px;">${backHtml}</div>`
        ).join('') + '</div>';
    } else {
      el.innerHTML = '<div class="sec-card empty">0</div>';
    }
    if (cnt) cnt.innerText = sec.length;

    // セキュリティバフ表示
    const buffOwner = side === 'pl' ? 'player' : 'ai';
    const buffs = bs._securityBuffs;
    if (buffs && buffs.length > 0 && sec.length > 0) {
      let totalPlus = 0;
      buffs.forEach(b => {
        if (b.type === 'dp_plus' && b.owner === buffOwner) totalPlus += (parseInt(b.value) || 0);
      });
      if (totalPlus > 0) {
        const badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);background:rgba(0,255,136,0.9);color:#000;font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;white-space:nowrap;z-index:1;box-shadow:0 0 6px rgba(0,255,136,0.5);';
        badge.innerText = 'DP+' + totalPlus;
        el.style.position = 'relative';
        el.appendChild(badge);
      }
    }
  });
}

// ===== バトルエリア描画 =====
function renderBattleRows() {
  ['ai', 'pl'].forEach(side => {
    const isPlayer = side === 'pl';
    const area = isPlayer ? bs.player.battleArea : bs.ai.battleArea;
    const row = document.getElementById(side + '-battle-row');
    if (!row) return;
    row.innerHTML = '';

    const slotCount = Math.max(area.length, 1);
    const renderCount = isPlayer ? slotCount + 1 : slotCount;

    for (let i = 0; i < renderCount; i++) {
      const card = area[i];
      const sl = document.createElement('div');
      sl.className = 'b-slot' + (card ? (isPlayer ? ' pl-card' : ' ai-card') : '');
      if (card && card.suspended) sl.classList.add('suspended');

      if (card) {
        const src = cardImg(card);
        let html = src
          ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
          : `<div style="font-size:8px;color:#aaa;padding:4px;height:100%;display:flex;align-items:center;justify-content:center;">${card.name}</div>`;

        // DP表示
        html += `<div class="b-dp">${card.dp}</div>`;

        // バフ表示（状態異常マーク）
        if (card.cantAttack || card.cantBlock) {
          let mark = '';
          if (card.cantAttack && card.cantBlock) mark = '⚔🛡✖';
          else if (card.cantAttack) mark = '⚔✖';
          else if (card.cantBlock) mark = '🛡✖';
          html += `<div style="position:absolute;top:1px;right:1px;background:#9933ff;color:#fff;font-size:7px;padding:1px 3px;border-radius:3px;">${mark}</div>`;
        }
        if (card.cantEvolve) {
          html += `<div style="position:absolute;top:14px;right:1px;background:#ff4444;color:#fff;font-size:7px;padding:1px 3px;border-radius:3px;">進❌</div>`;
        }

        // 進化元枚数
        if (card.stack && card.stack.length > 0) {
          html += `<div style="position:absolute;bottom:14px;left:1px;background:rgba(0,0,0,0.8);color:#ffaa00;font-size:7px;padding:1px 3px;border-radius:2px;">×${card.stack.length}</div>`;
        }

        sl.innerHTML = html;

        // タップで詳細表示
        sl.onclick = (() => {
          const idx = i;
          return () => window.showBCD && window.showBCD(idx, isPlayer ? 'plBattle' : 'aiBattle');
        })();
      }

      row.appendChild(sl);
    }
  });
}

// ===== テイマーエリア描画 =====
function renderTamerRows() {
  ['ai', 'pl'].forEach(side => {
    const isPlayer = side === 'pl';
    const tamers = isPlayer ? bs.player.tamerArea : bs.ai.tamerArea;
    const row = document.getElementById(side + '-tamer-row');
    if (!row) return;
    row.innerHTML = '';

    tamers.forEach((card, i) => {
      if (!card) return;
      const sl = document.createElement('div');
      sl.className = 'b-slot' + (isPlayer ? ' pl-card' : ' ai-card');
      sl.style.cssText = 'width:40px;height:56px;';
      const src = cardImg(card);
      sl.innerHTML = src
        ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`
        : `<div style="font-size:7px;color:#ffaa00;padding:2px;">${card.name}</div>`;

      sl.onclick = () => window.showBCD && window.showBCD(card, isPlayer ? 'plTamer' : 'aiTamer');
      row.appendChild(sl);
    });
  });
}

// ===== 育成エリア描画 =====
// 育成操作コールバック（battle.jsから注入）
let _ikuCallbacks = {
  onHatch: null,        // (card) => {} 孵化時
  onBreedMove: null,    // (card) => {} バトルエリア移動時
};
export function setIkuCallbacks(callbacks) { Object.assign(_ikuCallbacks, callbacks); }

function renderIkusei() {
  ['pl', 'ai'].forEach(side => {
    const isPlayer = side === 'pl';
    const iku = document.getElementById(side + '-iku-slot');
    const info = document.getElementById(side + '-iku-info');
    if (!iku) return;
    const c = isPlayer ? bs.player.ikusei : bs.ai.ikusei;

    if (c) {
      const src = cardImg(c);
      iku.innerHTML = src
        ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`
        : `<div style="font-size:8px;color:${isPlayer ? '#00ff88' : '#ff00fb'};padding:2px;">${c.name}</div>`;
      iku.classList.add('occupied');
      if (info) info.innerText = c.name;

      // 育成フェーズ中 + プレイヤー + Lv3以上 → ドラッグ移動イベント
      if (isPlayer && bs.phase === 'breed' && c.level !== '2') {
        attachIkuDrag(iku);
      }
    } else {
      if (isPlayer) iku._ikuDragAttached = false;
      const hasTamaDeck = isPlayer
        ? (bs.player.tamaDeck && bs.player.tamaDeck.length > 0)
        : (bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0);
      if (hasTamaDeck) {
        iku.innerHTML = tamaBackUrl
          ? `<img src="${tamaBackUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`
          : '';
      } else {
        iku.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#333;">空</div>';
      }
      iku.classList.remove('occupied');
      if (info) info.innerText = '';

      // 育成フェーズ中 + プレイヤー + デジタマあり → タップで孵化
      if (isPlayer && bs.phase === 'breed' && bs.player.tamaDeck && bs.player.tamaDeck.length > 0) {
        iku.onclick = () => {
          const nc = bs.player.tamaDeck.splice(0, 1)[0];
          bs.player.ikusei = nc;
          addLog('🥚 「' + nc.name + '」を孵化！');
          if (_ikuCallbacks.onHatch) _ikuCallbacks.onHatch(nc);
        };
      }
    }
  });
}

// 育成エリアドラッグ移動
function attachIkuDrag(iku) {
  if (iku._ikuDragAttached) return;
  iku._ikuDragAttached = true;
  iku.style.border = '2px solid #00ff88';
  iku.style.boxShadow = '0 0 15px rgba(0,255,136,0.4)';
  iku.style.cursor = 'grab';

  function doIkuMove() {
    if (!bs.player.ikusei) return;
    let slot = bs.player.battleArea.findIndex(s => s === null);
    if (slot === -1) { slot = bs.player.battleArea.length; bs.player.battleArea.push(null); }
    const moved = bs.player.ikusei;
    bs.player.battleArea[slot] = moved;
    bs.player.ikusei = null;
    addLog('🐾 「' + moved.name + '」をバトルエリアへ移動！');
    iku._ikuDragAttached = false;
    if (_ikuCallbacks.onBreedMove) _ikuCallbacks.onBreedMove(moved);
  }

  let ghostEl = null, dragging = false;
  function startDrag(cx, cy) {
    dragging = true;
    const card = bs.player.ikusei; if (!card) return;
    ghostEl = document.createElement('div');
    ghostEl.style.cssText = 'position:fixed;width:48px;height:66px;border-radius:5px;overflow:hidden;z-index:99999;pointer-events:none;opacity:0.85;border:2px solid #00ff88;box-shadow:0 0 15px rgba(0,255,136,0.5);';
    const src = cardImg(card);
    ghostEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#00ff88;font-size:7px;padding:4px;">${card.name}</div>`;
    document.body.appendChild(ghostEl);
    ghostEl.style.left = (cx - 24) + 'px'; ghostEl.style.top = (cy - 33) + 'px';
  }
  function moveDrag(cx, cy) { if (ghostEl) { ghostEl.style.left = (cx - 24) + 'px'; ghostEl.style.top = (cy - 33) + 'px'; } }
  function endDrag(cx, cy) {
    if (!dragging) return;
    dragging = false;
    if (ghostEl && ghostEl.parentNode) document.body.removeChild(ghostEl);
    ghostEl = null;
    const plRow = document.getElementById('pl-battle-row');
    if (plRow) {
      let dropped = false;
      plRow.querySelectorAll('.b-slot').forEach((slot, i) => {
        if (dropped || bs.player.battleArea[i]) return;
        const r = slot.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) { dropped = true; doIkuMove(); }
      });
      if (!dropped) {
        const startRect = iku.getBoundingClientRect();
        const dist = Math.sqrt(Math.pow(cx - startRect.left - startRect.width / 2, 2) + Math.pow(cy - startRect.top - startRect.height / 2, 2));
        if (dist > 50) doIkuMove();
      }
    }
  }
  iku.addEventListener('touchstart', e => { startDrag(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  iku.addEventListener('touchmove', e => { if (dragging) { moveDrag(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  iku.addEventListener('touchend', e => { if (dragging) endDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });
  iku.addEventListener('mousedown', e => { if (e.button !== 0) return; startDrag(e.clientX, e.clientY); });
  document.addEventListener('mousemove', e => { if (dragging) moveDrag(e.clientX, e.clientY); });
  document.addEventListener('mouseup', e => { if (dragging) endDrag(e.clientX, e.clientY); });
}

// ===== 手札描画 =====
export function renderHand() {
  const hw = document.getElementById('hand-wrap');
  if (!hw) return;
  hw.innerHTML = '';

  bs.player.hand.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'h-card' + (bs.selHand === i ? ' h-selected' : '');
    el.style.zIndex = i;
    if (i > 0) el.style.marginLeft = '4px';

    // コスト表示
    let costLabel = '';
    if (c.playCost !== null && c.evolveCost !== null)
      costLabel = `<span style="color:#ffaa00;">${c.playCost}</span><span style="color:#555;font-size:6px;">/</span><span style="color:#00ff88;font-size:7px;">進${c.evolveCost}</span>`;
    else if (c.playCost !== null)
      costLabel = `<span style="color:#ffaa00;">${c.playCost}</span>`;
    else
      costLabel = `<span style="color:#00ff88;">進${c.evolveCost || '?'}</span>`;

    const src = cardImg(c);
    el.innerHTML = (src
      ? `<img src="${src}">`
      : `<div style="font-size:8px;color:#aaa;padding:4px;height:100%;display:flex;align-items:center;justify-content:center;">${c.name}</div>`)
      + `<div class="h-cost">${costLabel}</div>`;

    // タップ → 選択 + 詳細
    el.onclick = ((card, idx) => e => {
      e.stopPropagation();
      bs.selHand = (bs.selHand === idx) ? null : idx;
      renderHand();
      if (window.showBCD) window.showBCD(idx, 'hand');
    })(c, i);

    el.draggable = false;
    el.addEventListener('dragstart', e => e.preventDefault());

    hw.appendChild(el);
  });
}

// ===== メモリーゲージ描画 =====
export function updateMemGauge() {
  const row = document.getElementById('memory-gauge-row');
  if (!row) return;
  row.innerHTML = '';

  const isFirst = !_onlineMode || _onlineMyKey === 'player1';

  for (let i = MEM_MAX; i >= MEM_MIN; i--) {
    const el = document.createElement('div');
    el.className = 'm-cell';
    el.innerText = i === 0 ? '0' : Math.abs(i);
    if (i === 0) el.classList.add('m-zero');
    else if (i > 0) el.classList.add(isFirst ? 'm-pl' : 'm-ai');
    else el.classList.add(isFirst ? 'm-ai' : 'm-pl');
    if (i === bs.memory) el.classList.add('m-active');
    row.appendChild(el);
  }

  const lbl = document.getElementById('m-turn-lbl');
  if (lbl) {
    lbl.innerText = bs.isPlayerTurn ? 'あなたのターン' : (_onlineMode ? '相手のターン' : 'AIのターン');
    lbl.className = 'm-turn-label ' + (bs.isPlayerTurn ? 'pl' : 'ai');
  }
  const tCount = document.getElementById('t-count');
  if (tCount) tCount.innerText = bs.turn;
}

// ===== カウント更新 =====
function updateCounts() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('pl-deck-count', bs.player.deck.length);
  set('ai-deck-count', bs.ai.deck.length);
  set('pl-hand-count', bs.player.hand.length);
  set('pl-tama-count', bs.player.tamaDeck.length);
  set('pl-trash-count', bs.player.trash.length);
  set('pl-trash-count2', bs.player.trash.length);
  set('ai-trash-count', bs.ai.trash.length);
}

// ===== フェーズバッジ更新 =====
const PHASE_NAMES = {
  standby: '準備中',
  unsuspend: '🔄 アクティブ',
  draw: '🃏 ドロー',
  breed: '🥚 育成',
  main: '⚡ メイン',
};

export function updatePhaseBadge() {
  const badge = document.getElementById('phase-badge');
  if (badge) badge.innerText = PHASE_NAMES[bs.phase] || bs.phase;
}

// ===== カード裏面画像セット =====
function applyBackImages() {
  const plBack = document.getElementById('pl-deck-back');
  const aiBack = document.getElementById('ai-deck-back');
  const plTama = document.getElementById('pl-tama-back');
  const aiTama = document.getElementById('ai-tama-back');
  if (plBack && cardBackUrl) plBack.src = cardBackUrl;
  if (aiBack && cardBackUrl) aiBack.src = cardBackUrl;
  if (plTama && tamaBackUrl) plTama.src = tamaBackUrl;
  if (aiTama && tamaBackUrl) aiTama.src = tamaBackUrl;
}

// ===== カード詳細画面 =====
export function showBCD(idxOrCard, source) {
  let card;
  if (typeof idxOrCard === 'object') card = idxOrCard;
  else if (source === 'hand') card = bs.player.hand[idxOrCard];
  else if (source === 'plBattle') card = bs.player.battleArea[idxOrCard];
  else if (source === 'aiBattle') card = bs.ai.battleArea[idxOrCard];
  else card = idxOrCard;
  if (!card) return;

  const bcd = document.getElementById('b-card-detail');
  if (!bcd) return;

  document.getElementById('bcd-img').src = cardImg(card);
  document.getElementById('bcd-name').innerText = card.name + ' (' + (card.cardNo || '') + ')';
  document.getElementById('bcd-stats').innerText = 'Lv.' + card.level + ' ／ DP:' + card.dp + ' ／ コスト:' + (card.cost || card.playCost || '?');

  // 効果
  const effectEl = document.getElementById('bcd-effect');
  effectEl.innerHTML = card.effect && card.effect !== 'なし'
    ? '<div style="color:var(--main-cyan);font-size:10px;margin-bottom:4px;font-weight:bold;">効果</div>' + card.effect
    : '<span style="color:#555;">効果なし</span>';

  // 進化元効果
  const evoEl = document.getElementById('bcd-evo-source');
  let evoHtml = '';
  if (card.evoSourceEffect && card.evoSourceEffect.trim() && card.evoSourceEffect !== 'なし') {
    evoHtml += '<div style="color:#ffaa00;font-size:10px;margin-bottom:4px;font-weight:bold;">進化元効果</div>' + card.evoSourceEffect;
  }
  // スタック内の進化元効果
  if (card.stack) {
    card.stack.forEach((s, i) => {
      if (s.evoSourceEffect && s.evoSourceEffect.trim() && s.evoSourceEffect !== 'なし') {
        evoHtml += '<div style="margin-top:6px;border-top:1px solid #222;padding-top:4px;">'
          + '<div style="color:#ffaa00;font-size:9px;margin-bottom:2px;">進化元: ' + s.name + '</div>'
          + '<div style="font-size:10px;color:#ddd;">' + s.evoSourceEffect + '</div></div>';
      }
    });
  }
  evoEl.innerHTML = evoHtml;

  // セキュリティ効果
  let secEl = document.getElementById('bcd-security-effect');
  if (!secEl) {
    secEl = document.createElement('div');
    secEl.id = 'bcd-security-effect';
    secEl.style.cssText = 'margin-top:8px;';
    evoEl.parentNode.insertBefore(secEl, evoEl.nextSibling);
  }
  if (card.securityEffect && card.securityEffect.trim() && card.securityEffect !== 'なし') {
    secEl.innerHTML = '<div style="color:#ff6644;font-size:10px;margin-bottom:4px;font-weight:bold;">🛡 セキュリティ効果</div><div style="font-size:11px;color:#ddd;line-height:1.6;">' + card.securityEffect + '</div>';
  } else {
    secEl.innerHTML = '';
  }

  document.body.appendChild(bcd);
  bcd.style.display = 'flex';
}

export function closeBCD() {
  const bcd = document.getElementById('b-card-detail');
  if (bcd) bcd.style.display = 'none';
}

// ===== トラッシュ表示 =====
export function showTrash(side) {
  const trash = side === 'player' ? bs.player.trash : bs.ai.trash;
  const title = side === 'player' ? '自分のトラッシュ' : '相手のトラッシュ';
  const modal = document.getElementById('trash-modal');
  const titleEl = document.getElementById('trash-modal-title');
  const grid = document.getElementById('trash-modal-grid');
  if (!modal) return;
  titleEl.innerText = `🗑 ${title}（${trash.length}枚）`;
  if (trash.length === 0) {
    grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;">カードがありません</div>';
  } else {
    grid.innerHTML = trash.map((c, i) => {
      const src = cardImg(c);
      return `<div style="text-align:center;cursor:pointer;padding:3px;border:2px solid transparent;border-radius:6px;" onclick="showBCD(${i},'trash')">
        ${src ? `<img src="${src}" style="width:100%;border-radius:4px;">` : `<div style="height:60px;background:#111;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#aaa;">${c.name}</div>`}
        <div style="font-size:7px;color:#888;margin-top:2px;">${c.name}</div>
      </div>`;
    }).join('');
  }
  modal.style.display = 'block';
}
