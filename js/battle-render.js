/**
 * battle-render.js — バトル画面DOM描画
 *
 * renderAll() を呼べば全エリアが更新される
 * 各render関数は対応するHTML要素にカード/ゲージを描画
 */

import { bs, MEM_MIN, MEM_MAX } from './battle-state.js';
import { updateScrollArrows, addLog } from './battle-ui.js';
import { getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';
import { isTargetSelecting } from './effect-engine.js';

// 戦闘演出中フラグ（battle-combat.jsから参照）
function isCombatAnimating() { return window._isCombatAnimating ? window._isCombatAnimating() : false; }

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
let _syncTimer = null;
export function renderAll(force) {
  // 対象選択中は再描画しない（UIが壊れるため）
  if (!force && isTargetSelecting()) return;
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
  // オンライン: 自分のターン中は定期的に状態同期（デバウンス500ms）
  // 戦闘演出中は同期しない（バチバチ防止）
  if (_onlineMode && bs.isPlayerTurn && window._onlineSendStateSync && !isCombatAnimating()) {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => window._onlineSendStateSync(), 500);
  }
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
          : `<div style="font-size:8px;color:${isPlayer ? '#00fbff' : '#ff00fb'};padding:3px;">${card.name}</div>`;

        // DP表示（baseDp + dpModifier内訳）
        const dpMod = card.dpModifier || 0;
        let dpHtml = `${card.baseDp || card.dp}`;
        if (dpMod > 0) dpHtml += `<span style="color:#00ff88;font-size:6px;"> +${dpMod}</span>`;
        else if (dpMod < 0) dpHtml += `<span style="color:#ff4444;font-size:6px;"> ${dpMod}</span>`;
        html += `<div class="s-dp">${dpHtml}</div>`;

        // 進化元枚数（右上）
        if (card.stack && card.stack.length > 0) {
          html += `<div style="position:absolute;top:1px;right:2px;background:rgba(0,0,0,0.8);color:#ffaa00;font-size:6px;padding:1px 2px;border-radius:2px;">${card.stack.length}枚</div>`;
        }

        // Sアタック+表示（左上）— 自分のターンのみ表示（永続効果は自分のターンのみ有効）
        const isMySide = (side === 'pl');
        const isMyTurn = bs.isPlayerTurn;
        const showSA = isMySide ? isMyTurn : !isMyTurn; // 自分のターンのみSA+有効
        let saExtra = 0;
        if (showSA) {
        const hasRecipeSA = card._permEffects && card._permEffects.securityAttackPlus;
        if (!hasRecipeSA) {
          if (card.effect) { const m = card.effect.matchAll(/(?:Sアタック|セキュリティアタック)\+(\d+)/g); for (const r of m) saExtra += parseInt(r[1]); }
          if (card.stack) card.stack.forEach(s => { if (s.evoSourceEffect) { const m = s.evoSourceEffect.matchAll(/(?:Sアタック|セキュリティアタック)\+(\d+)/g); for (const r of m) saExtra += parseInt(r[1]); } });
        }
        if (card._permEffects && card._permEffects.securityAttackPlus) saExtra += card._permEffects.securityAttackPlus;
        if (card.buffs) card.buffs.forEach(b => { if (b.type === 'security_attack_plus') saExtra += (parseInt(b.value) || 0); });
        if (saExtra > 0) {
          html += `<div style="position:absolute;top:1px;left:2px;background:rgba(255,0,0,0.8);color:#fff;font-size:6px;padding:1px 3px;border-radius:2px;">チェック+${saExtra}</div>`;
        }
        } // end if (showSA)

        // バフ表示（状態異常マーク）
        if (card.cantAttack || card.cantBlock) {
          let mark = '';
          if (card.cantAttack && card.cantBlock) mark = '⚔🛡✖';
          else if (card.cantAttack) mark = '⚔✖';
          else if (card.cantBlock) mark = '🛡✖';
          html += `<div style="position:absolute;bottom:14px;right:1px;background:#9933ff;color:#fff;font-size:7px;padding:1px 3px;border-radius:3px;">${mark}</div>`;
        }
        if (card.cantEvolve) {
          html += `<div style="position:absolute;bottom:1px;right:1px;background:#ff4444;color:#fff;font-size:7px;padding:1px 3px;border-radius:3px;">進❌</div>`;
        }

        // カード名
        html += `<div class="s-name">${card.name}</div>`;

        sl.innerHTML = html;

        // タップで詳細表示
        sl.onclick = (() => {
          const idx = i;
          return () => window.showBCD && window.showBCD(idx, isPlayer ? 'plBattle' : 'aiBattle');
        })();

        // プレイヤーのデジモン → 長押し/スワイプでアクションメニュー
        if (isPlayer && card.type === 'デジモン') {
          setupLongpress(sl, i, card);
        }
      }

      row.appendChild(sl);
    }
  });
}

// ===== 長押し/スワイプメニュー（バトルエリアカード） =====
let _longpressSlotIdx = null;
let _wasAlreadySuspended = false;

function setupLongpress(el, slotIdx, card) {
  let lpt = null, touchStartX = 0, touchStartY = 0, swiped = false;

  function triggerMenu() {
    if (bs.phase !== 'main' || !bs.isPlayerTurn) return;
    const c = bs.player.battleArea[slotIdx]; if (!c) return;
    _wasAlreadySuspended = c.suspended;
    if (!c.suspended) {
      const noRest = (c.effect && c.effect.includes('レストせずアタックできる')) || c._attackWithoutRest;
      if (!noRest) c.suspended = true;
      renderAll();
    }
    _longpressSlotIdx = slotIdx;
    requestAnimationFrame(() => {
      const updatedEl = document.getElementById('pl-battle-row')?.querySelectorAll('.b-slot')[slotIdx];
      showLongpressMenu(c, slotIdx, updatedEl || el);
    });
  }
  // タッチ: 左スワイプ
  el.addEventListener('touchstart', e => { const t = e.touches[0]; touchStartX = t.clientX; touchStartY = t.clientY; swiped = false; }, { passive: true });
  el.addEventListener('touchmove', e => { const t = e.touches[0]; const dx = touchStartX - t.clientX; if (dx > 20 && dx > Math.abs(t.clientY - touchStartY) && !swiped) { swiped = true; triggerMenu(); } }, { passive: true });
  // マウス: 長押し(400ms)
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    lpt = setTimeout(() => triggerMenu(), 400);
    const cancel = () => { clearTimeout(lpt); document.removeEventListener('mouseup', cancel); };
    document.addEventListener('mouseup', cancel);
  });
}

function showLongpressMenu(card, slotIdx, el) {
  const menu = document.getElementById('longpress-action-menu');
  const btns = document.getElementById('longpress-action-buttons');
  const backdrop = document.getElementById('longpress-backdrop');
  if (!menu || !btns) return;

  let html = '';
  const canAtk = card.type === 'デジモン';
  const hasEvoSpeed = card.stack && card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes('【速攻】'));
  const notSick = !card.summonedThisTurn || hasEvoSpeed;
  if (canAtk && notSick) {
    if (_wasAlreadySuspended) {
      html += '<button class="lp-action-btn lp-atk-btn" disabled style="opacity:0.3;cursor:not-allowed;">⚔ アタック（レスト中）</button>';
    } else {
      html += `<button class="lp-action-btn lp-atk-btn" onclick="startAttackMode(${slotIdx})">⚔ アタック</button>`;
    }
  }
  if (!card._usedEffects) card._usedEffects = [];
  if (card.effect && card.effect.includes('【メイン】')) {
    const used = card._usedEffects.includes('self');
    html += used
      ? '<button class="lp-action-btn lp-effect-btn" disabled style="opacity:0.3;">⚡ 効果（使用済み）</button>'
      : `<button class="lp-action-btn lp-effect-btn" onclick="activateEffect(${slotIdx},'self')">⚡ 効果</button>`;
  }
  html += `<button class="lp-action-btn lp-cancel-btn" onclick="cancelLongpress(${slotIdx})">✕ キャンセル</button>`;
  btns.innerHTML = html;

  menu.style.visibility = 'hidden'; menu.style.display = 'block';
  const menuH = menu.offsetHeight, menuW = menu.offsetWidth;
  menu.style.visibility = ''; menu.style.display = 'none';
  const rect = el.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(rect.left + rect.width / 2 - menuW / 2, window.innerWidth - menuW - 4)) + 'px';
  menu.style.top = Math.max(4, rect.top - menuH - 6) + 'px';
  backdrop.style.display = 'block'; menu.style.display = 'block';
}

function hideLongpressMenu() {
  const menu = document.getElementById('longpress-action-menu');
  const backdrop = document.getElementById('longpress-backdrop');
  if (menu) menu.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
}

// ===== アタック矢印UI =====
function startAttackModeUI(slotIdx) {
  hideLongpressMenu();
  const card = bs.player.battleArea[slotIdx]; if (!card) return;
  addLog('⚔ 「' + card.name + '」でアタック！ → 対象を選んでください');

  let arrowSvg = document.getElementById('attack-arrow-svg');
  if (!arrowSvg) {
    arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.id = 'attack-arrow-svg';
    arrowSvg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:99998;pointer-events:none;';
    document.body.appendChild(arrowSvg);
  }
  const slotEl = document.getElementById('pl-battle-row')?.querySelectorAll('.b-slot')[slotIdx];
  const slotRect = slotEl ? slotEl.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const sx = slotRect.left + slotRect.width / 2, sy = slotRect.top;
  arrowSvg.innerHTML = `<defs><marker id="atkArrowHead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#00fbff"/></marker></defs><line id="atk-arrow-line" x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy}" stroke="#00fbff" stroke-width="3" stroke-dasharray="8,4" marker-end="url(#atkArrowHead)" opacity="0.9"/>`;
  arrowSvg.style.display = 'block';

  // アタック対象ハイライト
  const canHitActive = (card.effect && card.effect.includes('アクティブ状態のデジモンにもアタックできる')) || (card.stack && card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes('【突進】')));
  const aiRow = document.getElementById('ai-battle-row');
  if (aiRow) aiRow.querySelectorAll('.b-slot').forEach((s, i) => {
    const def = bs.ai.battleArea[i]; if (!def) return;
    if (def.suspended || canHitActive) {
      s.style.boxShadow = '0 0 10px #ff444488'; s.style.cursor = 'pointer';
    } else {
      // アクティブ状態＝アタック不可 → 🚫マーク表示
      const ban = document.createElement('div');
      ban.className = '_atk-ban-mark';
      ban.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:24px;z-index:2;pointer-events:none;opacity:0.8;text-shadow:0 0 6px rgba(0,0,0,0.8);';
      ban.innerText = '🚫';
      s.style.position = 'relative';
      s.appendChild(ban);
      s.style.opacity = '0.5';
    }
  });
  const secArea = document.getElementById('ai-sec-area');
  if (secArea && bs.ai.security.length > 0) { secArea.style.boxShadow = '0 0 10px #ff444488'; secArea.style.cursor = 'pointer'; }

  // 透明な操作レイヤー（クリック/タッチ/ドラッグを全て受け取る）
  const inputLayer = document.createElement('div');
  inputLayer.style.cssText = 'position:fixed;inset:0;z-index:99997;cursor:crosshair;';
  document.body.appendChild(inputLayer);

  function onMove(e) {
    const t = e.touches ? e.touches[0] : e;
    const line = document.getElementById('atk-arrow-line');
    if (line) { line.setAttribute('x2', t.clientX); line.setAttribute('y2', t.clientY); }
    // ホバー効果（アタック可能な対象のみ浮かせる）
    if (aiRow) aiRow.querySelectorAll('.b-slot').forEach((s, i) => {
      const def = bs.ai.battleArea[i]; if (!def) return;
      const canTarget = def.suspended || canHitActive;
      if (!canTarget) return; // アタック不可は浮かせない
      const r = s.getBoundingClientRect();
      const hit = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
      s.style.transform = hit ? 'translateY(-4px) scale(1.05)' : '';
    });
    if (secArea) {
      const r = secArea.getBoundingClientRect();
      const hit = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
      secArea.style.transform = hit ? 'translateY(-2px) scale(1.02)' : '';
    }
    if (e.preventDefault) e.preventDefault();
  }

  function cleanup() {
    if (inputLayer.parentNode) inputLayer.parentNode.removeChild(inputLayer);
    inputLayer.removeEventListener('mousemove', onMove);
    inputLayer.removeEventListener('touchmove', onMove);
    inputLayer.removeEventListener('mouseup', onEnd);
    inputLayer.removeEventListener('touchend', onEnd);
    inputLayer.removeEventListener('click', onClick);
    arrowSvg.style.display = 'none';
    if (aiRow) aiRow.querySelectorAll('.b-slot').forEach(s => { s.style.boxShadow = ''; s.style.cursor = ''; s.style.transform = ''; s.style.opacity = ''; s.querySelectorAll('._atk-ban-mark').forEach(m => m.remove()); });
    if (secArea) { secArea.style.boxShadow = ''; secArea.style.cursor = ''; secArea.style.transform = ''; }
  }

  function resolveTarget(cx, cy) {
    let resolved = false;
    // 相手デジモン
    if (aiRow) aiRow.querySelectorAll('.b-slot').forEach((s, di) => {
      if (resolved) return;
      const def = bs.ai.battleArea[di]; if (!def) return;
      const r = s.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        resolved = true;
        if (window.startAttack && window.startAttack(card, slotIdx)) window.resolveAttackTarget('digimon', di);
      }
    });
    // セキュリティ
    if (!resolved && secArea) {
      const r = secArea.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        resolved = true;
        if (window.startAttack && window.startAttack(card, slotIdx)) window.resolveAttackTarget('security');
      }
    }
    // 上方向全体 → セキュリティ
    if (!resolved) {
      const aiZone = document.querySelector('.ai-zone');
      if (aiZone) {
        const r = aiZone.getBoundingClientRect();
        if (cy >= r.top && cy <= r.bottom) {
          resolved = true;
          if (window.startAttack && window.startAttack(card, slotIdx)) window.resolveAttackTarget('security');
        }
      }
    }
    if (!resolved) {
      if (!_wasAlreadySuspended) card.suspended = false;
      renderAll();
    }
  }

  function onEnd(e) {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    cleanup();
    resolveTarget(t.clientX, t.clientY);
  }

  function onClick(e) {
    cleanup();
    resolveTarget(e.clientX, e.clientY);
  }

  inputLayer.addEventListener('mousemove', onMove);
  inputLayer.addEventListener('touchmove', onMove, { passive: false });
  inputLayer.addEventListener('mouseup', onEnd);
  inputLayer.addEventListener('touchend', onEnd);
  // クリックでも発動可能（メニューから遷移した直後のクリック対応）
  inputLayer.addEventListener('click', onClick);
}

// window公開（HTMLのonclickから呼ばれる）
window.startAttackMode = startAttackModeUI;
window.hideLongpressMenu = hideLongpressMenu;
window.cancelLongpress = function(slotIdx) {
  hideLongpressMenu();
  const card = bs.player.battleArea[slotIdx];
  if (card && !_wasAlreadySuspended) card.suspended = false;
  renderAll();
};
window.activateEffect = function(slotIdx, effectSource) {
  hideLongpressMenu();
  const card = bs.player.battleArea[slotIdx]; if (!card) return;
  if (!card._usedEffects) card._usedEffects = [];
  let effectText = card.effect, effectName = card.name;
  if (effectSource && effectSource.startsWith('evo-')) {
    const evoIdx = parseInt(effectSource.split('-')[1]);
    const evoCard = card.stack && card.stack[evoIdx];
    if (evoCard && evoCard.evoSourceEffect) { effectText = evoCard.evoSourceEffect; effectName = evoCard.name + '（進化元効果）'; }
  }
  renderAll();
  document.getElementById('effect-confirm-name').innerText = effectName;
  document.getElementById('effect-confirm-text').innerText = effectText;
  document.getElementById('effect-confirm-overlay').style.display = 'flex';
  // confirmEffect のコールバックで効果エンジンを呼ぶ
  window._effectConfirmCallback = function(yes) {
    document.getElementById('effect-confirm-overlay').style.display = 'none';
    if (!yes) {
      if (!_wasAlreadySuspended) card.suspended = false;
      renderAll();
      return;
    }
    card._usedEffects.push(effectSource || 'self');
    // effect-engine の checkAndTriggerEffect を window 経由で呼ぶ
    if (window._triggerMainEffect) window._triggerMainEffect(card, () => renderAll());
    else renderAll();
  };
};

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
      sl.className = 'tamer-slot';
      if (card.suspended) sl.style.transform = 'rotate(90deg)';
      const src = cardImg(card);
      sl.innerHTML = (src
        ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`
        : `<div style="font-size:7px;color:#ffaa00;padding:2px;">${card.name}</div>`)
        + `<div class="s-name">${card.name}</div>`;

      sl.onclick = () => window.showBCD && window.showBCD(card, isPlayer ? 'plTamer' : 'aiTamer');

      // プレイヤーテイマー → 長押し/スワイプで効果発動メニュー
      if (isPlayer && card.effect && card.effect.trim() && card.effect !== 'なし') {
        let touchSX = 0, swiped = false;
        sl.addEventListener('touchstart', e => { touchSX = e.touches[0].clientX; swiped = false; }, { passive: true });
        sl.addEventListener('touchmove', e => {
          if (touchSX - e.touches[0].clientX > 20 && !swiped) { swiped = true; showTamerMenu(card, i, sl); }
        }, { passive: true });
        sl.addEventListener('mousedown', e => {
          if (e.button !== 0) return;
          const t = setTimeout(() => showTamerMenu(card, i, sl), 400);
          const cancel = () => { clearTimeout(t); document.removeEventListener('mouseup', cancel); };
          document.addEventListener('mouseup', cancel);
        });
      }

      row.appendChild(sl);
    });
  });
}

// テイマー効果メニュー
function showTamerMenu(card, tamerIdx, el) {
  if (bs.phase !== 'main' || !bs.isPlayerTurn) return;
  if (!card.suspended) card.suspended = true;
  renderAll();
  const tamerRow = document.getElementById('pl-tamer-row');
  const updatedEl = tamerRow ? tamerRow.querySelectorAll('.b-slot')[tamerIdx] : el;
  el = updatedEl || el;

  const menu = document.getElementById('longpress-action-menu');
  const btns = document.getElementById('longpress-action-buttons');
  const backdrop = document.getElementById('longpress-backdrop');
  if (!menu || !btns) return;

  let html = `<button class="lp-action-btn lp-effect-btn" onclick="activateTamerEffect(${tamerIdx})">⚡ 効果</button>`;
  html += `<button class="lp-action-btn lp-cancel-btn" onclick="cancelTamerLongpress(${tamerIdx})">✕ キャンセル</button>`;
  btns.innerHTML = html;

  menu.style.visibility = 'hidden'; menu.style.display = 'block';
  const menuH = menu.offsetHeight, menuW = menu.offsetWidth;
  menu.style.visibility = ''; menu.style.display = 'none';
  const rect = el.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(rect.left + rect.width / 2 - menuW / 2, window.innerWidth - menuW - 4)) + 'px';
  menu.style.top = Math.max(4, rect.top - menuH - 6) + 'px';
  backdrop.style.display = 'block'; menu.style.display = 'block';
}

window.activateTamerEffect = function(tamerIdx) {
  hideLongpressMenu();
  const card = bs.player.tamerArea[tamerIdx]; if (!card) return;
  document.getElementById('effect-confirm-name').innerText = card.name;
  document.getElementById('effect-confirm-text').innerText = card.effect;
  document.getElementById('effect-confirm-overlay').style.display = 'flex';
  window._effectConfirmCallback = function(yes) {
    document.getElementById('effect-confirm-overlay').style.display = 'none';
    if (!yes) { card.suspended = false; renderAll(); return; }
    if (window._triggerMainEffect) window._triggerMainEffect(card, () => renderAll());
    else renderAll();
  };
};
window.cancelTamerLongpress = function(tamerIdx) {
  hideLongpressMenu();
  const card = bs.player.tamerArea[tamerIdx];
  if (card) card.suspended = false;
  renderAll();
};

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

      if (isPlayer) {
        // プレイヤー側: ドラッグで移動（移動可否はdoIkuMove内判定）+ 長押しでカード詳細
        attachIkuDrag(iku);
      } else {
        // AI側: タップでカード詳細
        iku.onclick = () => { if (window.showBCD) window.showBCD(null, 'aiIkusei'); };
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

// 育成エリアドラッグ移動 + 長押しでカード詳細
function attachIkuDrag(iku) {
  if (iku._ikuDragAttached) return;
  iku._ikuDragAttached = true;

  let ghostEl = null, dragging = false, dragMoved = false;
  let startCx = 0, startCy = 0, longPressTimer = null;

  function startDrag(cx, cy) {
    dragging = true; dragMoved = false;
    startCx = cx; startCy = cy;
    // 長押し(500ms)でカード詳細
    longPressTimer = setTimeout(() => {
      dragging = false; // ドラッグをキャンセル
      if (window.showBCD && bs.player.ikusei) window.showBCD(null, 'plIkusei');
    }, 500);
  }
  function createGhost(cx, cy) {
    if (ghostEl) return;
    const card = bs.player.ikusei; if (!card) return;
    ghostEl = document.createElement('div');
    ghostEl.style.cssText = 'position:fixed;width:48px;height:66px;border-radius:5px;overflow:hidden;z-index:99999;pointer-events:none;opacity:0.85;border:2px solid #00ff88;box-shadow:0 0 15px rgba(0,255,136,0.5);';
    const src = cardImg(card);
    ghostEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#00ff88;font-size:7px;padding:4px;">${card.name}</div>`;
    document.body.appendChild(ghostEl);
    ghostEl.style.left = (cx - 24) + 'px'; ghostEl.style.top = (cy - 33) + 'px';
  }
  function moveDrag(cx, cy) {
    if (!dragging) return;
    if (!dragMoved) {
      const dist = Math.abs(cx - startCx) + Math.abs(cy - startCy);
      if (dist < 8) return;
      dragMoved = true;
      clearTimeout(longPressTimer); // ドラッグ開始 → 長押しキャンセル
      createGhost(cx, cy);
    }
    if (ghostEl) { ghostEl.style.left = (cx - 24) + 'px'; ghostEl.style.top = (cy - 33) + 'px'; }
  }
  function endDrag(cx, cy) {
    clearTimeout(longPressTimer);
    if (!dragging) return;
    dragging = false;
    if (ghostEl && ghostEl.parentNode) document.body.removeChild(ghostEl);
    ghostEl = null;
    if (!dragMoved) return; // タップ → 何もしない（長押しならshowBCD済み）
    // ドラッグ先判定
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
  iku.addEventListener('touchend', e => { endDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });
  iku.addEventListener('mousedown', e => { if (e.button !== 0) return; startDrag(e.clientX, e.clientY); });
  document.addEventListener('mousemove', e => { if (dragging) moveDrag(e.clientX, e.clientY); });
  document.addEventListener('mouseup', e => { if (dragging) endDrag(e.clientX, e.clientY); });
}

// 育成エリア → バトルエリア移動
export function doIkuMove() {
  if (!bs.player.ikusei) return;
  if (bs.phase !== 'breed') return;
  if (parseInt(bs.player.ikusei.level) < 3) {
    addLog('🚨 レベル3以上に進化してからバトルエリアへ移動できます');
    return;
  }
  let slot = bs.player.battleArea.findIndex(s => s === null);
  if (slot === -1) { slot = bs.player.battleArea.length; bs.player.battleArea.push(null); }
  const moved = bs.player.ikusei;
  bs.player.battleArea[slot] = moved;
  bs.player.ikusei = null;
  addLog('🐾 「' + moved.name + '」をバトルエリアへ移動！');
  if (_ikuCallbacks.onBreedMove) _ikuCallbacks.onBreedMove(moved);
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

    // ドラッグ＆ドロップ + タップ
    let _dragDone = false;
    el.onclick = ((card, idx) => e => {
      if (_dragDone) return;
      e.stopPropagation();
      bs.selHand = (bs.selHand === idx) ? null : idx;
      renderHand();
      if (window.showBCD) window.showBCD(idx, 'hand');
    })(c, i);

    el.draggable = false;
    el.addEventListener('dragstart', e => e.preventDefault());

    // 手札ドラッグ開始
    const attachDrag = ((card, idx, cardEl) => {
      let isDragging = false, startX = 0, startY = 0;

      function onStart(e) {
        if (bs.phase !== 'main' || !bs.isPlayerTurn) return;
        if (e.type === 'mousedown') e.preventDefault();
        const t = e.touches ? e.touches[0] : e;
        startX = t.clientX; startY = t.clientY; isDragging = false;
        const moveH = ev => onMove(ev);
        const upH = ev => { onEnd(ev); document.removeEventListener('mousemove', moveH); document.removeEventListener('mouseup', upH); document.removeEventListener('touchmove', moveH); document.removeEventListener('touchend', upH); };
        document.addEventListener(e.touches ? 'touchmove' : 'mousemove', moveH, { passive: false });
        document.addEventListener(e.touches ? 'touchend' : 'mouseup', upH);
      }
      function onMove(ev) {
        const t = ev.touches ? ev.touches[0] : ev;
        if (!isDragging && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
          isDragging = true;
          highlightDropZones(true);
          cardEl.style.position = 'fixed'; cardEl.style.zIndex = '99999';
          cardEl.style.pointerEvents = 'none'; cardEl.style.transform = 'scale(1.1)'; cardEl.style.transition = 'none';
        }
        if (isDragging) { cardEl.style.left = (t.clientX - 26) + 'px'; cardEl.style.top = (t.clientY - 36) + 'px'; }
        if (ev.preventDefault) ev.preventDefault();
      }
      function onEnd(ev) {
        const wasDrag = isDragging;
        const t = ev.changedTouches ? ev.changedTouches[0] : ev;
        cardEl.style.position = ''; cardEl.style.zIndex = ''; cardEl.style.left = ''; cardEl.style.top = '';
        cardEl.style.transform = ''; cardEl.style.pointerEvents = ''; cardEl.style.transition = '';
        highlightDropZones(false);
        if (!wasDrag) return;
        _dragDone = true; setTimeout(() => { _dragDone = false; }, 50);
        const cx = t.clientX, cy = t.clientY;
        let dropped = false;
        // 育成エリアに進化
        const ikuEl = document.getElementById('pl-iku-slot');
        if (!dropped && ikuEl && bs.player.ikusei) {
          const r = ikuEl.getBoundingClientRect(), pad = 20;
          if (cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad) {
            if (window.doEvolveIku) window.doEvolveIku(card, idx); dropped = true;
          }
        }
        // バトルエリアに登場 or 進化
        if (!dropped) {
          const plRow = document.getElementById('pl-battle-row');
          if (plRow) plRow.querySelectorAll('.b-slot').forEach((slot, si) => {
            if (dropped) return;
            const r = slot.getBoundingClientRect();
            if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
              if (bs.player.battleArea[si]) { if (window.doEvolve) window.doEvolve(card, idx, si); }
              else { if (window.doPlay) window.doPlay(card, idx, si); }
              dropped = true;
            }
          });
        }
      }
      cardEl.addEventListener('mousedown', onStart);
      cardEl.addEventListener('touchstart', onStart, { passive: true });
    })(c, i, el);

    hw.appendChild(el);
  });
}

// ドロップゾーンハイライト
function highlightDropZones(on) {
  document.querySelectorAll('#pl-battle-row .b-slot').forEach(s => {
    s.style.borderColor = on ? '#ffffff55' : '';
    s.style.background = on ? '#1a1a1a' : '';
  });
}

// ===== メモリーゲージ描画 =====
export function updateMemGauge() {
  const row = document.getElementById('memory-gauge-row');
  if (!row) return;
  row.innerHTML = '';

  const isFirst = !_onlineMode || !!window._isFirstPlayer;

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
    // 先攻=シアン、後攻=ピンク（bs.isPlayerTurnとisFirstで判定）
    const isFirst = !_onlineMode || bs.isPlayerTurn === (bs.turn <= 1 || _onlineMyKey === null);
    const myColor = (!_onlineMode || window._isFirstPlayer) ? '#00fbff' : '#ff00fb';
    const oppColor = (!_onlineMode || window._isFirstPlayer) ? '#ff00fb' : '#00fbff';
    lbl.style.color = bs.isPlayerTurn ? myColor : oppColor;
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
  // 対象選択中はカード詳細を開かない（タップ干渉防止）
  if (isTargetSelecting()) return;
  let card;
  if (typeof idxOrCard === 'object') card = idxOrCard;
  else if (source === 'hand') card = bs.player.hand[idxOrCard];
  else if (source === 'mulliganHand') card = bs.player.hand[idxOrCard];
  else if (source === 'plBattle') card = bs.player.battleArea[idxOrCard];
  else if (source === 'aiBattle') card = bs.ai.battleArea[idxOrCard];
  else if (source === 'plIkusei') card = bs.player.ikusei;
  else if (source === 'aiIkusei') card = bs.ai.ikusei;
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
  // スタック内の全進化元カードを表示（効果なしでもカード名+なしと表示）
  if (card.stack) {
    card.stack.forEach((s, i) => {
      const hasEvo = s.evoSourceEffect && s.evoSourceEffect.trim() && s.evoSourceEffect !== 'なし';
      evoHtml += '<div style="margin-top:6px;border-top:1px solid #222;padding-top:4px;">'
        + '<div style="color:#ffaa00;font-size:9px;margin-bottom:2px;">進化元: ' + s.name + ' (Lv.' + (s.level || '?') + ')</div>'
        + '<div style="font-size:10px;color:' + (hasEvo ? '#ddd' : '#555') + ';">' + (hasEvo ? s.evoSourceEffect : 'なし') + '</div></div>';
    });
  }
  if (!evoHtml) evoHtml = '<div style="color:#555;font-size:10px;">進化元効果なし</div>';
  evoEl.innerHTML = evoHtml;
  evoEl.style.display = 'block';

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
  // 'ai' も 'player' 以外もAI側として扱う
  const isPlayer = (side === 'player' || side === 'pl');
  const trash = isPlayer ? bs.player.trash : bs.ai.trash;
  const title = isPlayer ? '自分のトラッシュ' : '相手のトラッシュ';
  const modal = document.getElementById('trash-modal');
  const titleEl = document.getElementById('trash-modal-title');
  const grid = document.getElementById('trash-modal-grid');
  if (!modal) return;
  window._trashSide = side;
  titleEl.innerText = `🗑 ${title}（${trash.length}枚）`;
  if (trash.length === 0) {
    grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;">カードがありません</div>';
  } else {
    grid.innerHTML = trash.map((c, i) => {
      const src = cardImg(c);
      return `<div id="trash-card-${i}" style="text-align:center;cursor:pointer;padding:3px;border:2px solid transparent;border-radius:6px;transition:all 0.2s;" onclick="selectTrashCard('${side}',${i})" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 4px 12px rgba(0,251,255,0.3)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
        ${src ? `<img src="${src}" style="width:100%;border-radius:4px;">` : `<div style="height:60px;background:#111;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#aaa;">${c.name}</div>`}
        <div style="font-size:7px;color:#888;margin-top:2px;">${c.name}</div>
      </div>`;
    }).join('');
  }
  modal.style.display = 'block';
}

// トラッシュカード選択
window.selectTrashCard = function(side, idx) {
  const isPlayer = (side === 'player' || side === 'pl');
  const trash = isPlayer ? bs.player.trash : bs.ai.trash;
  for (let i = 0; i < trash.length; i++) {
    const el = document.getElementById('trash-card-' + i);
    if (el) el.style.borderColor = (i === idx) ? 'var(--main-cyan)' : 'transparent';
  }
  setTimeout(() => {
    const card = trash[idx];
    if (card && window.showBCD) window.showBCD(card, 'trash');
  }, 200);
};
