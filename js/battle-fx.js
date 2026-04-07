/**
 * battle-fx.js — 18種類の演出モジュール
 *
 * effect-engine.js の EFFECT_RUNNERS に登録される演出関数群
 * 各関数は (options, callback) の形式で、演出完了後に callback() を呼ぶ
 */

import { bs } from './battle-state.js';
import { addLog } from './battle-ui.js';
import { renderAll, updateMemGauge, cardImg } from './battle-render.js';

// ===== 効果確認ダイアログのwindow公開 =====
window.confirmEffect = function(yes) {
  // 相手画面の効果オーバーレイも閉じる
  fxRemoteEffectClose();

  if (window._effectEngineConfirm) {
    window._effectEngineConfirm(yes);
    return;
  }
  if (window._effectConfirmCallback) {
    const cb = window._effectConfirmCallback;
    window._effectConfirmCallback = null;
    document.getElementById('effect-confirm-overlay').style.display = 'none';
    cb(yes);
  }
};

// =====================================================
//  1. 数値ポップアップ（DP+/-）— 旧コード準拠
// =====================================================

export function fxDpPopup(value, label) {
  const isPlus = value > 0;
  const color = isPlus ? '#00ff88' : '#ff4444';
  const sign = isPlus ? '+' : '';
  const popup = document.createElement('div');
  if (label) {
    popup.innerHTML = `<div style="font-size:1rem;color:#fff;text-shadow:0 0 10px ${color};margin-bottom:4px;">${label}</div><div>DP${sign}${value}</div>`;
  } else {
    popup.innerText = 'DP' + sign + value;
  }
  popup.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:2rem;font-weight:bold;z-index:60000;pointer-events:none;color:${color};text-shadow:0 0 15px ${color};animation:dpChangePopup 1s ease forwards;text-align:center;white-space:nowrap;`;
  document.body.appendChild(popup);
  setTimeout(() => { if (popup.parentNode) popup.parentNode.removeChild(popup); }, 1200);
}

// =====================================================
//  2. テキスト表示 — 旧コード準拠（dpChangePopup）
// =====================================================

/**
 * テキスト表示 — 旧コード showConfirmDialog 準拠
 * effect-confirm-overlay でカード名+効果テキストを表示
 * callback なしなら自動で閉じる。callback ありなら「はい/いいえ」で閉じる。
 */
export function fxTextPopup(cardOrText, effectTextOrColor, durationOrCallback) {
  // 引数が card オブジェクトの場合: fxTextPopup(card, effectText, callback)
  if (cardOrText && typeof cardOrText === 'object' && cardOrText.name) {
    const card = cardOrText;
    const effectText = effectTextOrColor || card.effect || '';
    const cb = typeof durationOrCallback === 'function' ? durationOrCallback : null;
    fxConfirmDialog(card, effectText, '効果を発動しますか？', cb || ((r) => {}));
    return;
  }
  // 引数が文字列の場合: fxTextPopup(text, color, duration) — 簡易ポップアップ
  const text = cardOrText;
  if (!text) return;
  const c = (typeof effectTextOrColor === 'string') ? effectTextOrColor : '#00fbff';
  const dur = (typeof durationOrCallback === 'number') ? durationOrCallback : 1200;
  const el = document.createElement('div');
  el.innerText = text;
  el.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:1.5rem;font-weight:bold;z-index:60000;pointer-events:none;color:${c};text-shadow:0 0 15px ${c};animation:dpChangePopup ${dur / 1000}s ease forwards;`;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, dur + 200);
}

// =====================================================
//  3. バフ/状態付与演出 — カード画像+「〇〇付与」テキスト
// =====================================================

export function fxBuffStatus(card, icon, label, color, callback) {
  const c = color || '#9933ff';
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;pointer-events:none;`;

  // カード画像
  if (card) {
    const imgDiv = document.createElement('div');
    imgDiv.style.cssText = `width:100px;height:140px;border-radius:8px;border:2px solid ${c};overflow:hidden;box-shadow:0 0 20px ${c}44;position:relative;`;
    const src = card ? cardImg(card) : '';
    imgDiv.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:${c};padding:8px;">${card.name || '?'}</div>`;
    // アイコンバッジ
    if (icon) {
      const badge = document.createElement('div');
      badge.style.cssText = `position:absolute;top:-8px;right:-8px;background:${c};color:#fff;font-size:16px;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${c};animation:fxBuffApply 0.5s ease;`;
      badge.innerText = icon;
      imgDiv.appendChild(badge);
    }
    overlay.appendChild(imgDiv);
    // カード名
    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size:12px;color:#fff;font-weight:bold;`;
    nameEl.innerText = card.name || '';
    overlay.appendChild(nameEl);
  }

  // ラベル（「〇〇付与」）
  if (label) {
    const labelEl = document.createElement('div');
    labelEl.style.cssText = `font-size:1.2rem;font-weight:bold;color:${c};text-shadow:0 0 15px ${c};animation:dpChangePopup 2s ease forwards;`;
    labelEl.innerText = label;
    overlay.appendChild(labelEl);
  }

  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2200);
}

// =====================================================
//  4. 文字ポップアップ（カード画像+効果名）
// =====================================================

export function fxLabelPopup(card, effectName, color, callback) {
  const c = color || '#00ff88';
  fxBuffStatus(card, null, effectName, c, callback);
}

// =====================================================
//  5. カード移動演出（移動元→移動先にカードが飛ぶ）
// =====================================================

export function fxCardMove(card, fromLabel, toLabel, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:55000;display:flex;align-items:center;justify-content:center;pointer-events:none;';

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;gap:16px;';

  // 移動元
  const fromDiv = document.createElement('div');
  fromDiv.style.cssText = 'text-align:center;';
  const cardDiv = document.createElement('div');
  cardDiv.style.cssText = 'width:80px;height:112px;border-radius:6px;border:2px solid #00fbff;overflow:hidden;box-shadow:0 0 15px #00fbff44;';
  const src = card ? cardImg(card) : '';
  cardDiv.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#00fbff;padding:8px;font-size:10px;">${(card && card.name) || '?'}</div>`;
  fromDiv.appendChild(cardDiv);
  const fromLbl = document.createElement('div');
  fromLbl.style.cssText = 'font-size:9px;color:#00fbff;margin-top:4px;';
  fromLbl.innerText = fromLabel || '移動元';
  fromDiv.appendChild(fromLbl);

  const arrow = document.createElement('div');
  arrow.style.cssText = 'font-size:18px;color:#00fbff;opacity:0;transition:opacity 0.3s;';
  arrow.innerText = '→';

  // 移動先
  const destDiv = document.createElement('div');
  destDiv.style.cssText = 'text-align:center;';
  const destBox = document.createElement('div');
  destBox.style.cssText = 'width:80px;height:112px;border:2px dashed #00fbff44;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#00fbff44;';
  destBox.innerText = toLabel || '移動先';
  destDiv.appendChild(destBox);

  container.appendChild(fromDiv);
  container.appendChild(arrow);
  container.appendChild(destDiv);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  setTimeout(() => { arrow.style.opacity = '1'; }, 300);
  setTimeout(() => {
    cardDiv.style.transition = 'all 0.8s cubic-bezier(0.2,0.8,0.3,1)';
    cardDiv.style.transform = 'translateX(130px) scale(0.5)';
    cardDiv.style.opacity = '0';
  }, 800);
  setTimeout(() => {
    destBox.style.transition = 'all 0.3s ease';
    destBox.style.borderColor = '#00fbff';
    destBox.style.boxShadow = '0 0 15px #00fbff44';
    destBox.style.color = '#00fbff';
    destBox.innerText = card ? card.name : '✓';
  }, 1500);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2500);
}

// =====================================================
//  6. 対象選択UI — effect-engine.jsの実装を使用
//     ※battle-fx.jsのfxTargetSelectはテスト用の簡易版
//     実際のゲームではeffect-engine.jsのshowTargetSelectionが使われる
// =====================================================

export function fxTargetSelect(side, validIndices, color, message, callback) {
  const c = color || '#ff4444';
  const rowId = side === 'ai' ? 'ai-battle-row' : 'pl-battle-row';
  const row = document.getElementById(rowId);
  if (!row || validIndices.length === 0) { callback && callback(null); return; }

  const slots = row.querySelectorAll('.b-slot');
  const msgEl = document.createElement('div');
  msgEl.style.cssText = `position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:60000;background:rgba(0,0,0,0.9);border:1px solid ${c};border-radius:10px;padding:12px 24px;color:${c};font-size:14px;font-weight:bold;text-align:center;box-shadow:0 0 20px ${c}44;pointer-events:none;`;
  msgEl.innerText = message || '🎯 対象を選んでください';
  document.body.appendChild(msgEl);

  validIndices.forEach(idx => {
    const slot = slots[idx]; if (!slot) return;
    slot.style.border = `2px solid ${c}`;
    slot.style.boxShadow = `0 0 15px ${c}`;
    slot.style.cursor = 'pointer';
    slot.onmouseenter = () => { slot.style.transform = 'translateY(-4px) scale(1.05)'; };
    slot.onmouseleave = () => { slot.style.transform = ''; };
  });

  function cleanup() {
    if (msgEl.parentNode) msgEl.parentNode.removeChild(msgEl);
    validIndices.forEach(idx => {
      const slot = slots[idx]; if (!slot) return;
      slot.style.border = ''; slot.style.boxShadow = '';
      slot.style.cursor = ''; slot.style.transform = '';
      slot.onmouseenter = null; slot.onmouseleave = null;
    });
    document.removeEventListener('click', onSelect, true);
    document.removeEventListener('touchend', onSelect, true);
  }

  function onSelect(e) {
    e.preventDefault();
    const cx = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    const cy = e.clientY || (e.changedTouches && e.changedTouches[0].clientY);
    if (!cx || !cy) return;
    let selectedIdx = null;
    validIndices.forEach(idx => {
      const slot = slots[idx]; if (!slot) return;
      const r = slot.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) selectedIdx = idx;
    });
    if (selectedIdx !== null) { cleanup(); callback(selectedIdx); }
  }

  // 少し遅延してからリスナー登録（クリック伝播防止）
  setTimeout(() => {
    document.addEventListener('click', onSelect, true);
    document.addEventListener('touchend', onSelect, true);
  }, 200);
}

// =====================================================
//  7. 効果確認ダイアログ
// =====================================================

/**
 * 効果確認ダイアログ（発動者用）— カード画像+名前+効果テキスト+はい/いいえ
 * オンライン時は相手画面にも fxRemoteEffect を自動表示（confirmで自動クローズ）
 */
export function fxConfirmDialog(card, effectText, question, callback) {
  const overlay = document.getElementById('effect-confirm-overlay');
  if (!overlay) { callback && callback(true); return; }
  const imgEl = document.getElementById('effect-confirm-img');
  const nameEl = document.getElementById('effect-confirm-name');
  const textEl = document.getElementById('effect-confirm-text');
  const questionEl = document.getElementById('effect-confirm-question');
  // カード画像
  if (imgEl) {
    if (card) {
      const src = cardImg(card);
      imgEl.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : '';
      imgEl.style.display = src ? '' : 'none';
    } else {
      imgEl.style.display = 'none';
    }
  }
  if (nameEl) nameEl.innerText = card ? card.name : '';
  if (textEl) textEl.innerText = effectText || '';
  if (questionEl) questionEl.innerText = question || '効果を発動しますか？';
  overlay.style.display = 'flex';

  // オンライン: 相手画面にも効果内容を表示（confirmEffect で自動クローズ）
  if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
    window._onlineSendCommand({ type: 'fx_confirmShow', cardName: card ? card.name : '', effectText: (effectText || '').substring(0, 200) });
  }

  window._effectConfirmCallback = function(result) {
    overlay.style.display = 'none';
    // オンライン: 相手画面を閉じる
    if (window._isOnlineMode && window._isOnlineMode() && window._onlineSendCommand) {
      window._onlineSendCommand({ type: 'fx_confirmClose', accepted: result });
    }
    callback && callback(result);
  };
}

/**
 * 相手画面用: 効果発動中オーバーレイ
 * 「カード名 + 効果内容 + 相手が効果を処理中...」を表示
 * — 旧コード showRemoteEffectOverlay 準拠
 */
export function fxRemoteEffect(cardName, effectText) {
  const id = '_remote-effect-announce';
  const existing = document.getElementById(id);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const ov = document.createElement('div');
  ov.id = id;
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
  const bx = document.createElement('div');
  bx.style.cssText = 'max-width:85%;padding:20px;background:rgba(0,10,20,0.95);border:2px solid #ff00fb;border-radius:12px;box-shadow:0 0 30px #ff00fb44;text-align:center;';
  bx.innerHTML = '<div style="color:#ff00fb;font-size:14px;font-weight:bold;margin-bottom:10px;text-shadow:0 0 8px #ff00fb;">⚡ 相手: ' + (cardName || '') + '</div>'
    + '<div style="color:#ddd;font-size:11px;line-height:1.6;text-align:left;margin-bottom:12px;max-height:100px;overflow-y:auto;">' + (effectText || '') + '</div>'
    + '<div style="color:#888;font-size:10px;">相手が効果を処理中...</div>';
  ov.appendChild(bx);
  document.body.appendChild(ov);
  // フォールバック: 15秒で自動消去
  setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 15000);
  return ov;
}

/**
 * 相手画面用: 効果オーバーレイを閉じる
 */
export function fxRemoteEffectClose() {
  const el = document.getElementById('_remote-effect-announce');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// =====================================================
//  8. オープン演出（裏面→フリップ）
// =====================================================

export function fxDeckOpen(cards, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:1rem;font-weight:bold;color:#ffaa00;letter-spacing:3px;text-shadow:0 0 15px #ffaa00;';
  label.innerText = '📖 DECK OPEN';
  overlay.appendChild(label);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;perspective:800px;';
  const backUrl = 'https://drive.google.com/thumbnail?id=1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9&sz=w200';

  cards.forEach((card, i) => {
    const slot = document.createElement('div');
    slot.style.cssText = 'text-align:center;';
    const flipper = document.createElement('div');
    flipper.style.cssText = `width:80px;height:112px;position:relative;transform-style:preserve-3d;transform:rotateY(180deg);transition:transform 0.7s ease ${0.8 + i * 0.5}s;`;
    const front = document.createElement('div');
    front.style.cssText = 'position:absolute;inset:0;border-radius:6px;border:2px solid #ffaa00;overflow:hidden;backface-visibility:hidden;background:#1a0a00;';
    const src = card ? cardImg(card) : '';
    front.innerHTML = (src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ffaa00;padding:8px;font-size:9px;">${card.name || '?'}</div>`)
      + `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.85);padding:2px;font-size:7px;text-align:center;color:#fff;">${card.name || '?'}</div>`;
    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;inset:0;border-radius:6px;border:2px solid #666;overflow:hidden;backface-visibility:hidden;transform:rotateY(180deg);background:#1a1a2e;';
    back.innerHTML = `<img src="${backUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.innerHTML='<div style=\\'color:#666;font-size:20px;display:flex;align-items:center;justify-content:center;height:100%\\'>🂠</div>'">`;
    flipper.appendChild(front);
    flipper.appendChild(back);
    slot.appendChild(flipper);
    const numLabel = document.createElement('div');
    numLabel.style.cssText = 'font-size:9px;color:#ffaa00;margin-top:4px;';
    numLabel.innerText = (i + 1) + '枚目';
    slot.appendChild(numLabel);
    row.appendChild(slot);
    setTimeout(() => { flipper.style.transform = 'rotateY(0)'; }, 800 + i * 500);
  });

  overlay.appendChild(row);
  document.body.appendChild(overlay);
  const totalTime = 800 + cards.length * 500 + 2000;
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, totalTime);
}

// =====================================================
//  9. アプ合体演出
// =====================================================

export function fxAppGattai(card1, card2, resultCard, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:1rem;font-weight:900;color:#ff00fb;letter-spacing:3px;text-shadow:0 0 20px #ff00fb;margin-bottom:16px;';
  label.innerText = 'APP GATTAI';
  overlay.appendChild(label);

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;gap:20px;align-items:center;justify-content:center;';

  function makeCard(card, id) {
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'width:100px;height:140px;border-radius:8px;border:2px solid #ff00fb;overflow:hidden;box-shadow:0 0 15px #ff00fb44;opacity:0;transition:all 0.6s ease;';
    const src = card ? cardImg(card) : '';
    div.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ff00fb;padding:8px;font-size:10px;">${card?.name || '?'}</div>`;
    return div;
  }

  const c1 = makeCard(card1, '_ap1'); c1.style.transform = 'translateX(-40px)';
  const plus = document.createElement('div');
  plus.style.cssText = 'font-size:16px;color:#ff00fb;font-weight:bold;opacity:0;transition:opacity 0.3s;';
  plus.innerText = '＋';
  const c2 = makeCard(card2, '_ap2'); c2.style.transform = 'translateX(40px)';

  container.appendChild(c1); container.appendChild(plus); container.appendChild(c2);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  setTimeout(() => { c1.style.opacity = '1'; c1.style.transform = 'translateX(0)'; }, 300);
  setTimeout(() => { plus.style.opacity = '1'; }, 900);
  setTimeout(() => { c2.style.opacity = '1'; c2.style.transform = 'translateX(0)'; }, 1200);
  setTimeout(() => {
    c1.style.transition = 'all 1s ease'; c2.style.transition = 'all 1s ease'; plus.style.opacity = '0';
    c1.style.transform = 'translate(60px,0) rotate(360deg) scale(0)'; c1.style.opacity = '0';
    c2.style.transform = 'translate(-60px,0) rotate(-360deg) scale(0)'; c2.style.opacity = '0';
  }, 2200);
  setTimeout(() => {
    container.innerHTML = '';
    container.style.flexDirection = 'column';
    const result = makeCard(resultCard, '_apResult');
    result.style.cssText += 'opacity:1;box-shadow:0 0 40px #ff00fb;animation:fxJogressAppear 1.5s ease forwards;';
    container.appendChild(result);
    const rl = document.createElement('div');
    rl.style.cssText = 'margin-top:8px;font-size:11px;color:#ff00fb;font-weight:bold;';
    rl.innerText = 'アプ合体完了！';
    container.appendChild(rl);
  }, 3600);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 5500);
}

// =====================================================
//  10. ジョグレス進化演出（キラキラ大量）
// =====================================================

export function fxJogressEvolve(card1, card2, resultCard, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:1.2rem;font-weight:900;color:#ffdd00;letter-spacing:4px;text-shadow:0 0 20px #ffdd00,0 0 40px #ffaa00;margin-bottom:20px;';
  label.innerText = '⭐ JOGRESS EVOLUTION';
  overlay.appendChild(label);

  const container = document.createElement('div');
  container.style.cssText = 'position:relative;width:260px;height:200px;';

  function makeJCard(card, style) {
    const div = document.createElement('div');
    div.style.cssText = 'width:100px;height:140px;border-radius:8px;border:2px solid;overflow:hidden;position:absolute;' + style;
    const src = card ? cardImg(card) : '';
    div.innerHTML = (src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="padding:8px;font-size:10px;">${card?.name || '?'}</div>`)
      + `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.85);padding:2px;font-size:8px;text-align:center;color:#fff;">${card?.name || '?'}</div>`;
    return div;
  }

  const j1 = makeJCard(card1, 'left:0;top:30px;border-color:#00fbff;box-shadow:0 0 15px #00fbff44;opacity:0;transform:translateX(-40px);transition:all 0.7s ease;');
  const j2 = makeJCard(card2, 'right:0;top:30px;border-color:#ff9900;box-shadow:0 0 15px #ff990044;opacity:0;transform:translateX(40px);transition:all 0.7s ease;');
  const jp = document.createElement('div');
  jp.style.cssText = 'position:absolute;left:50%;top:75px;transform:translateX(-50%);font-size:18px;color:#ffdd00;font-weight:bold;opacity:0;transition:opacity 0.3s;z-index:3;';
  jp.innerText = '＋';

  container.appendChild(j1); container.appendChild(j2); container.appendChild(jp);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  setTimeout(() => { j1.style.opacity = '1'; j1.style.transform = 'translateX(0)'; }, 400);
  setTimeout(() => { jp.style.opacity = '1'; }, 1100);
  setTimeout(() => { j2.style.opacity = '1'; j2.style.transform = 'translateX(0)'; }, 1400);
  setTimeout(() => { jp.style.opacity = '0'; }, 2400);

  // 楕円軌道回転
  setTimeout(() => {
    const dur = 1500, startTime = performance.now();
    function animate(now) {
      const t = Math.min((now - startTime) / dur, 1);
      const angle = t * Math.PI * 2;
      const rx = 50 * (1 - t), ry = 25 * (1 - t);
      const sc = 1 - t * 0.8, op = 1 - t;
      j1.style.transition = 'none';
      j1.style.transform = `translate(${70 + Math.cos(angle) * rx - 50}px,${Math.sin(angle) * ry}px) rotate(${t * 720}deg) scale(${sc})`;
      j1.style.opacity = op;
      j2.style.transition = 'none';
      j2.style.transform = `translate(${-70 + Math.cos(angle + Math.PI) * rx + 50}px,${Math.sin(angle + Math.PI) * ry}px) rotate(${-t * 720}deg) scale(${sc})`;
      j2.style.opacity = op;
      if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, 2500);

  // キラキラ放射（大量・多色・多段）
  function spawnSparkles(delay, count, distMin, distMax) {
    setTimeout(() => {
      const colors = ['#ffdd00', '#fff', '#00fbff', '#ff9900', '#ff00fb', '#ffee88', '#aaffff'];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = distMin + Math.random() * (distMax - distMin);
        const sz = 2 + Math.random() * 12;
        const del = Math.random() * 0.8;
        const p = document.createElement('div');
        const c = colors[Math.floor(Math.random() * colors.length)];
        p.style.cssText = `position:absolute;left:50%;top:50%;width:${sz}px;height:${sz}px;margin-left:-${sz / 2}px;margin-top:-${sz / 2}px;background:${c};border-radius:50%;box-shadow:0 0 ${sz * 3}px ${c};z-index:8;opacity:0;transition:all ${0.8 + Math.random() * 0.6}s ease ${del}s;pointer-events:none;`;
        container.appendChild(p);
        setTimeout(() => {
          p.style.opacity = '1';
          p.style.transform = `translate(${Math.cos(angle) * dist}px,${Math.sin(angle) * dist}px) rotate(${Math.random() * 360}deg)`;
          setTimeout(() => { p.style.opacity = '0'; }, 500 + del * 1000);
        }, 50);
      }
    }, delay);
  }
  // 3段階キラキラ: 交差中 → 消失直後 → 新カード登場時
  spawnSparkles(3500, 20, 20, 80);
  spawnSparkles(4200, 40, 30, 130);
  spawnSparkles(5500, 25, 40, 100);

  // 中央フラッシュ
  setTimeout(() => {
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;background:#ffdd00;border-radius:50%;box-shadow:0 0 60px 30px #ffdd00,0 0 120px 60px #ffaa0066;z-index:7;transition:all 0.4s ease;pointer-events:none;';
    container.appendChild(flash);
    setTimeout(() => { flash.style.width = '200px'; flash.style.height = '200px'; flash.style.opacity = '0'; }, 50);
    setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 600);
  }, 4100);

  // 新カード登場
  setTimeout(() => {
    // 古い子要素をクリア（キラキラの残りは残す）
    [j1, j2, jp].forEach(el => { if (el.parentNode) el.parentNode.removeChild(el); });
    const result = document.createElement('div');
    result.style.cssText = 'animation:fxJogressAppear 1.8s ease forwards;text-align:center;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);';
    const rCard = document.createElement('div');
    rCard.style.cssText = 'width:120px;height:168px;border-radius:8px;border:3px solid #ffdd00;overflow:hidden;box-shadow:0 0 50px #ffdd00,0 0 100px #ffaa0044;margin:0 auto;';
    const src = resultCard ? cardImg(resultCard) : '';
    rCard.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ffdd00;padding:12px;">${resultCard?.name || '?'}</div>`;
    result.appendChild(rCard);
    const rl = document.createElement('div');
    rl.style.cssText = 'margin-top:10px;font-size:13px;color:#ffdd00;font-weight:bold;text-shadow:0 0 10px #ffdd00;';
    rl.innerText = 'ジョグレス進化！';
    result.appendChild(rl);
    container.appendChild(result);
  }, 5400);

  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 7800);
}

// =====================================================
//  11. リンク演出（回転しながら横向きに刺さる）
// =====================================================

export function fxLinkEffect(baseCard, linkCard, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:1rem;font-weight:bold;color:#ffaa00;letter-spacing:3px;text-shadow:0 0 15px #ffaa00;margin-bottom:16px;';
  labelEl.innerText = '⚡ LINK';
  overlay.appendChild(labelEl);

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;gap:4px;';

  const baseDiv = document.createElement('div');
  baseDiv.style.cssText = 'width:100px;height:140px;border-radius:8px;border:2px solid #00fbff;overflow:hidden;box-shadow:0 0 15px #00fbff44;';
  const baseSrc = baseCard ? cardImg(baseCard) : '';
  baseDiv.innerHTML = baseSrc ? `<img src="${baseSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#00fbff;padding:8px;">${baseCard?.name || '?'}</div>`;

  const linkDiv = document.createElement('div');
  linkDiv.style.cssText = 'width:100px;height:70px;border-radius:4px;border:2px solid #ffaa00;overflow:hidden;box-shadow:0 0 15px #ffaa0044;transform:rotate(0deg) translate(120px,0) scale(0.8);opacity:0;';
  const linkSrc = linkCard ? cardImg(linkCard) : '';
  linkDiv.innerHTML = linkSrc ? `<img src="${linkSrc}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ffaa00;padding:4px;font-size:8px;">${linkCard?.name || '?'}</div>`;

  container.appendChild(baseDiv);
  container.appendChild(linkDiv);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  // 回転しながら飛んできて横向きに刺さる
  setTimeout(() => {
    linkDiv.style.transition = 'all 0.6s cubic-bezier(0.2,0.8,0.3,1)';
    linkDiv.style.transform = 'rotate(-90deg) translate(40px,0) scale(0.9)';
    linkDiv.style.opacity = '1';
  }, 500);
  setTimeout(() => {
    linkDiv.style.transition = 'all 0.4s ease';
    linkDiv.style.transform = 'rotate(-90deg) translate(0,0) scale(1)';
  }, 1100);
  // 刺さった瞬間にフラッシュ
  setTimeout(() => {
    baseDiv.style.transition = 'box-shadow 0.15s';
    baseDiv.style.boxShadow = '0 0 40px #ffaa00, 0 0 80px #ffaa0066';
    setTimeout(() => { baseDiv.style.boxShadow = '0 0 15px #00fbff44'; }, 300);
  }, 1500);

  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 3000);
}

// =====================================================
//  12. セキュリティ追加演出（デッキ→セキュリティ移動）
// =====================================================

export function fxSecurityAdd(card, callback) {
  fxCardMove(card || { name: 'カード' }, 'デッキ', 'セキュリティ', callback);
}

// =====================================================
//  13. セキュリティ除去演出（セキュリティ→トラッシュ移動）
// =====================================================

export function fxSecurityRemove(card, callback) {
  fxCardMove(card || { name: 'カード' }, 'セキュリティ', 'トラッシュ', callback);
}

// =====================================================
//  14. バリア演出（ジャミング: VS画面に「ジャミング！」表示）
// =====================================================

/**
 * ジャミング演出 — VS画面上に「ジャミング！」を重ねて表示
 * secCard: セキュリティカード, atkCard: アタッカー
 */
export function fxBarrier(atkCard, secCard, callback) {
  fxVsBattle(atkCard, secCard, {
    label: 'SECURITY CHECK!',
    badge: '🛡 ジャミング！',
    badgeColor: '#00fbff',
    resultText: 'ジャミングで消滅回避！',
    resultColor: '#00fbff',
  }, callback);
}

/**
 * 汎用VS画面（DP比較/進化元枚数/ジャミング等に対応）
 * opts: { label, badge, badgeColor, statLabel, stat1, stat2, resultText, resultColor }
 *   statLabel: 'DP' or '進化元' etc.  stat1/stat2: 表示する数値
 */
export function fxVsBattle(card1, card2, opts, callback) {
  opts = opts || {};
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:56000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;';

  // ラベル（SECURITY CHECK! / BATTLE! 等）
  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:clamp(0.9rem,4vw,1.4rem);font-weight:bold;color:#fff;letter-spacing:3px;text-shadow:0 0 15px #ff4444;opacity:0;transition:opacity 0.3s;';
  labelEl.innerText = opts.label || 'BATTLE!';
  overlay.appendChild(labelEl);

  // カード並び
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:16px;align-items:center;';

  function makeCardSide(card, borderColor, statLabel, statValue) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;opacity:0;transition:opacity 0.3s;';
    const imgDiv = document.createElement('div');
    imgDiv.style.cssText = `width:100px;height:140px;border:3px solid ${borderColor};border-radius:8px;overflow:hidden;box-shadow:0 0 20px ${borderColor}44;`;
    const src = card ? cardImg(card) : '';
    imgDiv.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:${borderColor};padding:8px;">${card?.name || '?'}</div>`;
    wrap.appendChild(imgDiv);
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'color:#fff;font-size:11px;margin-top:4px;font-weight:bold;';
    nameEl.innerText = card?.name || '?';
    wrap.appendChild(nameEl);
    const statEl = document.createElement('div');
    statEl.style.cssText = `color:${borderColor};font-size:11px;font-weight:bold;`;
    statEl.innerText = (statLabel || 'DP') + ': ' + (statValue ?? (card?.dp || '?'));
    wrap.appendChild(statEl);
    return wrap;
  }

  const statLabel = opts.statLabel || 'DP';
  const side1 = makeCardSide(card1, '#00fbff', statLabel, opts.stat1 ?? card1?.dp);
  const vs = document.createElement('div');
  vs.style.cssText = 'font-size:1.5rem;font-weight:900;color:#ff4444;text-shadow:0 0 20px #ff0000;opacity:0;transition:opacity 0.3s;';
  vs.innerText = 'VS';
  const side2 = makeCardSide(card2, '#ff4444', statLabel, opts.stat2 ?? card2?.dp);

  row.appendChild(side1); row.appendChild(vs); row.appendChild(side2);
  overlay.appendChild(row);

  // バッジ（ジャミング！等）
  if (opts.badge) {
    const badge = document.createElement('div');
    const bc = opts.badgeColor || '#00fbff';
    badge.style.cssText = `font-size:1.3rem;font-weight:900;color:${bc};text-shadow:0 0 20px ${bc},0 0 40px ${bc}66;letter-spacing:3px;opacity:0;transition:opacity 0.3s;`;
    badge.innerText = opts.badge;
    overlay.appendChild(badge);
    setTimeout(() => { badge.style.opacity = '1'; }, 1200);
  }

  // 結果テキスト
  const resultEl = document.createElement('div');
  resultEl.style.cssText = 'font-size:0.9rem;color:#aaa;opacity:0;transition:opacity 0.3s;';
  if (opts.resultText) { resultEl.innerText = opts.resultText; resultEl.style.color = opts.resultColor || '#aaa'; }
  overlay.appendChild(resultEl);

  document.body.appendChild(overlay);

  // アニメーション
  setTimeout(() => { labelEl.style.opacity = '1'; }, 100);
  setTimeout(() => { side1.style.opacity = '1'; }, 300);
  setTimeout(() => { vs.style.opacity = '1'; }, 600);
  setTimeout(() => { side2.style.opacity = '1'; }, 900);
  setTimeout(() => { resultEl.style.opacity = '1'; }, 1500);

  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 3000);
}

// =====================================================
//  15. シールド演出（ブロッカー）— 旧コード準拠
// =====================================================

// =====================================================
//  孵化演出 — 旧コード showHatchEffect 準拠
// =====================================================

export function fxHatchEffect(card, callback) {
  const overlay = document.getElementById('hatch-overlay');
  if (!overlay) { callback && callback(); return; }
  const flash = document.getElementById('hatch-flash');
  const label = document.getElementById('hatch-label');
  const imgEl = document.getElementById('hatch-card-img');
  const nameEl = document.getElementById('hatch-card-name');
  const subEl = document.getElementById('hatch-sub-text');

  flash.style.opacity = '0'; label.style.opacity = '0';
  imgEl.style.opacity = '0'; imgEl.style.transform = 'scale(0.5) rotate(-10deg)';
  nameEl.style.opacity = '0'; subEl.style.opacity = '0'; subEl.style.transform = 'scale(0.5)';

  const src = card ? cardImg(card) : '';
  imgEl.innerHTML = src
    ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="color:#ff9900;font-size:10px;padding:8px;">${card?.name || '?'}</div>`;
  nameEl.innerText = card?.name || '?';
  overlay.style.display = 'flex';

  setTimeout(() => {
    flash.style.transition = 'opacity 0.1s'; flash.style.opacity = '0.8';
    setTimeout(() => {
      flash.style.transition = 'opacity 0.25s'; flash.style.opacity = '0';
      label.style.opacity = '1'; imgEl.style.opacity = '1'; imgEl.style.transform = 'scale(1) rotate(0deg)';
      setTimeout(() => { nameEl.style.opacity = '1'; subEl.style.opacity = '1'; subEl.style.transform = 'scale(1)'; }, 200);
    }, 150);
  }, 100);

  clearTimeout(window._hatchTimer);
  window._hatchTimer = setTimeout(() => { overlay.style.display = 'none'; callback && callback(); }, 2000);
}

/**
 * ブロッカー演出 — 旧コード showBlockConfirm 準拠
 * effect-confirm-overlay を使用した確認ダイアログ
 */
export function fxShield(blocker, attacker, callback) {
  const overlay = document.getElementById('effect-confirm-overlay');
  if (!overlay) { callback && callback(false); return; }
  const nameEl = document.getElementById('effect-confirm-name');
  nameEl.innerText = '🚨💥 アタック中！！ 💥🚨';
  nameEl.style.color = '#ff2222';
  nameEl.style.textShadow = '0 0 10px #ff0000, 0 0 20px #ff000088';
  nameEl.style.fontSize = '1.2rem';
  document.getElementById('effect-confirm-text').innerText =
    '相手の「' + (attacker ? attacker.name : '???') + '」(DP:' + (attacker ? attacker.dp : '?') + ')がアタックしてきました！';
  const questionEl = document.getElementById('effect-confirm-question');
  if (questionEl) questionEl.innerText = 'ブロックしますか？';
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
  window._effectConfirmCallback = function(result) {
    nameEl.style.color = '#fff';
    nameEl.style.textShadow = '';
    nameEl.style.fontSize = '1rem';
    if (questionEl) questionEl.innerText = '効果を発動しますか？';
    overlay.style.display = 'none';
    callback && callback(result);
  };
}

// =====================================================
//  16. 回転演出（レスト/アクティブ）
// =====================================================

export function fxRotate(slotEl, toSuspended, callback) {
  if (!slotEl) { callback && callback(); return; }
  slotEl.style.transition = 'transform 0.4s ease';
  slotEl.style.transform = toSuspended ? 'rotate(90deg)' : 'rotate(0deg)';
  setTimeout(() => { slotEl.style.transition = ''; callback && callback(); }, 500);
}

// =====================================================
//  17. 効果不発メッセージ — 旧コード準拠
// =====================================================

export function fxEffectFailed(message, callback) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:45%;left:0;z-index:60000;font-size:clamp(0.85rem,3.5vw,1.1rem);font-weight:700;color:#aaa;background:rgba(30,30,40,0.85);padding:10px 28px;border-radius:20px;border:1px solid #555;box-shadow:0 2px 12px rgba(0,0,0,0.4);white-space:nowrap;cursor:pointer;animation:effectFizzleSlide 3.5s cubic-bezier(0.25,1,0.5,1) forwards;';
  el.innerText = '💨 ' + (message || '対象がいないため、効果発動できませんでした');
  document.body.appendChild(el);
  let done = false;
  function finish() {
    if (done) return; done = true;
    if (el.parentNode) el.parentNode.removeChild(el);
    callback && callback();
  }
  el.addEventListener('click', finish);
  el.addEventListener('touchend', finish);
  setTimeout(finish, 3500);
}

// =====================================================
//  18. Sアタック+演出（画面中央に表示）
// =====================================================

/** Sアタック+演出 — 旧コード showSAttackPlusAnnounce 完全準拠 */
export function fxSAttackPlus(n, callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:61000;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;top:50%;left:50%;font-size:clamp(1.8rem,8vw,3rem);font-weight:900;color:#ff2255;text-shadow:0 0 10px #ff2255,0 0 30px #ff4466,0 0 60px #ff0044,0 0 100px #ff006688;letter-spacing:3px;white-space:nowrap;padding:16px 36px;border:3px solid #ff3366;border-radius:14px;background:linear-gradient(135deg,rgba(40,0,10,0.95),rgba(80,0,20,0.95));animation:sAttackPlusSlam 2s cubic-bezier(0.22,1,0.36,1) forwards, sAttackPlusGlow 0.6s ease-in-out 0.25s 2;';
  el.innerText = '⚔ セキュリティアタック+' + n + '！！';
  overlay.appendChild(el);
  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2200);
}

// =====================================================
//  EFFECT_RUNNERS 登録用マップ
// =====================================================

// ===== 演出パラメータの自動判定 =====
// 辞書列は不要。ゲーム状態・アクションコードから全て自動で決定する

// ===== カードの現在ゾーン自動判定 =====

function getCardZone(card, ctx) {
  if (!card || !ctx || !ctx.bs) return null;
  const side = ctx.side || 'player';
  // 両サイドを検索（自分→相手の順）
  for (const s of [side, side === 'player' ? 'ai' : 'player']) {
    const area = ctx.bs[s];
    if (!area) continue;
    if (area.hand && area.hand.includes(card)) return '手札';
    if (area.trash && area.trash.includes(card)) return 'トラッシュ';
    if (area.battleArea && area.battleArea.includes(card)) return 'バトルエリア';
    if (area.tamerArea && area.tamerArea.includes(card)) return 'テイマーエリア';
    if (area.security && area.security.includes(card)) return 'セキュリティ';
    if (area.deck && area.deck.includes(card)) return 'デッキ';
    if (area.ikusei === card) return '育成エリア';
    if (area.tamaDeck && area.tamaDeck.includes(card)) return 'デジタマデッキ';
  }
  // デッキオープン中のカード
  if (ctx._remainingOpenCards && ctx._remainingOpenCards.includes(card)) return '公開カード';
  return null;
}

/**
 * EFFECT_RUNNERS 登録マップ
 * キー名 = スプシ「効果アクション辞書」の「演出タイプ」列と完全一致
 * 全パラメータはゲーム状態・アクションコードから自動判定（辞書列追加不要）
 */
export function getFxRunners() {
  return {
    // --- 基本演出 ---
    "数値ポップアップ": (opts, cb) => {
      fxDpPopup(opts.value || 0, opts.label || (opts.card && opts.card.name) || null);
      cb();
    },
    "消滅演出": (opts, cb) => {
      if (opts.ctx && opts.ctx.showDestroyEffect && opts.card) {
        opts.ctx.showDestroyEffect(opts.card, cb);
      } else { cb(); }
    },
    "テキスト表示": (opts, cb) => {
      if (opts.text) fxTextPopup(opts.text, opts.color);
      cb();
    },
    "ゲージ移動": (opts, cb) => {
      if (opts.ctx && opts.ctx.updateMemGauge) opts.ctx.updateMemGauge();
      cb();
    },

    // --- カード操作演出 ---
    "ドロー演出": (opts, cb) => {
      if (opts.ctx && opts.ctx.showDrawEffect && opts.cards && opts.cards.length > 0) {
        let idx = 0;
        function showNext() {
          if (idx >= opts.cards.length) { cb(); return; }
          const c = opts.cards[idx++];
          opts.ctx.showDrawEffect(c, parseInt(c.level) >= 6, showNext);
        }
        showNext();
      } else { cb(); }
    },
    "カード移動": (opts, cb) => {
      // 移動元: コード明示指定 → カード位置から自動判定
      const from = opts.fromLabel || getCardZone(opts.card, opts.ctx) || '?';
      // 移動先: コード明示指定 → 移動後のカード位置から自動判定
      const to = opts.toLabel || getCardZone(opts.card, opts.ctx) || '?';
      fxCardMove(opts.card, from, to, cb);
    },
    "カード登場": (opts, cb) => {
      if (opts.ctx && opts.ctx.showPlayEffect) {
        // summon_cost_minus アクション → 「-Nで登場！」表示
        if (opts.actionCode === 'summon_cost_minus' && opts.value) {
          opts.card._costReduction = opts.value;
        }
        opts.ctx.showPlayEffect(opts.card, cb);
      } else { cb(); }
    },
    "カード進化": (opts, cb) => {
      if (opts.ctx && opts.ctx.showEvolveEffect) {
        // evo_cost_minus アクション → 「-Nで進化！」表示
        if (opts.actionCode === 'evo_cost_minus' && opts.value) {
          opts.evolvedCard._costReduction = opts.value;
        }
        opts.ctx.showEvolveEffect(opts.cost, opts.baseName, opts.baseCard, opts.evolvedCard, cb);
      } else { cb(); }
    },
    "オープン演出": (opts, cb) => {
      if (opts.cards && opts.cards.length > 0) { fxDeckOpen(opts.cards, cb); }
      else { cb(); }
    },

    // --- バトル演出 ---
    "VS画面": (opts, cb) => {
      // アクションコードで自動分岐
      if (opts.actionCode === 'prevent_battle_destroy') {
        opts.badge = '🛡 ジャミング！';
        opts.badgeColor = '#00fbff';
        opts.resultText = opts.resultText || 'ジャミングで消滅回避！';
        opts.resultColor = opts.resultColor || '#00fbff';
      } else if (opts.actionCode === 'battle_by_evo_count') {
        opts.statLabel = '進化元';
        opts.resultColor = opts.resultColor || '#ffaa00';
        if (opts.card1 && opts.stat1 === undefined) opts.stat1 = (opts.card1.stack ? opts.card1.stack.length : 0) + '枚';
        if (opts.card2 && opts.stat2 === undefined) opts.stat2 = (opts.card2.stack ? opts.card2.stack.length : 0) + '枚';
      }
      fxVsBattle(opts.card1, opts.card2, opts, cb);
    },
    "ブロックダイアログ": (opts, cb) => {
      fxShield(opts.blocker, opts.attacker, cb);
    },
    "Sアタック+": (opts, cb) => {
      fxSAttackPlus(opts.value || 1, cb);
    },

    // --- 効果演出 ---
    "状態付与演出": (opts, cb) => {
      // カードの状態フラグからアイコンを自動判定
      const card = opts.card;
      let icon = opts.icon || '';
      let label = opts.label || '';
      if (!icon && card) {
        if (card.cantAttack && card.cantBlock)   { icon = '⚔🛡✖'; label = label || 'アタック・ブロック不可'; }
        else if (card.cantAttack)                { icon = '⚔✖';   label = label || 'アタック不可'; }
        else if (card.cantBlock)                 { icon = '🛡✖';   label = label || 'ブロック不可'; }
        else if (card.cantEvolve)                { icon = '進❌';   label = label || '進化不可'; }
        else if (card.cantPlay)                  { icon = '登❌';   label = label || '登場不可'; }
        else if (card.cantUseEffect)             { icon = '🪄✖';   label = label || '効果不可'; }
        else                                     { icon = '🔒';    label = label || '状態付与'; }
      }
      fxBuffStatus(card, icon, label, opts.color, cb);
    },
    "文字ポップアップ": (opts, cb) => {
      fxLabelPopup(opts.card, opts.label, opts.color, cb);
    },
    "効果確認ダイアログ": (opts, cb) => {
      fxConfirmDialog(opts.card, opts.effectText, opts.question, cb);
    },
    "対象選択UI": (opts, cb) => {
      fxTargetSelect(opts.side, opts.validIndices, opts.color, opts.message, cb);
    },

    // --- 特殊演出 ---
    "アプ合体": (opts, cb) => {
      fxAppGattai(opts.card1, opts.card2, opts.resultCard, cb);
    },
    "ジョグレス進化": (opts, cb) => {
      fxJogressEvolve(opts.card1, opts.card2, opts.resultCard, cb);
    },
    "リンク演出": (opts, cb) => {
      fxLinkEffect(opts.baseCard, opts.linkCard, cb);
    },
  };
}
