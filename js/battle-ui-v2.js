/**
 * battle-ui.js — 共通UIヘルパー
 *
 * オーバーレイ、ダイアログ、トースト等の汎用UI生成
 * 重複コードの削減が目的
 */

// ===== オーバーレイ生成 =====

/**
 * フルスクリーンオーバーレイを表示
 * @param {Object} opts - { background, zIndex, content(HTML), onClick, duration(ms) }
 * @returns {HTMLElement}
 */
export function showOverlay(opts = {}) {
  const el = document.createElement('div');
  el.className = 'fx-overlay';
  el.style.cssText = `position:fixed;inset:0;z-index:${opts.zIndex || 50000};display:flex;align-items:center;justify-content:center;flex-direction:column;background:${opts.background || 'rgba(0,0,0,0.85)'};`;
  if (opts.content) el.innerHTML = opts.content;
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  document.body.appendChild(el);
  if (opts.duration) {
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, opts.duration);
  }
  return el;
}

/**
 * オーバーレイを閉じる
 */
export function removeOverlay(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// ===== 確認ダイアログ =====

/**
 * はい/いいえの確認ダイアログを表示
 * @param {Object} opts - { title, message, cardHtml, yesText, noText, color }
 * @returns {Promise<boolean>}
 */
export function showConfirm(opts = {}) {
  return new Promise((resolve) => {
    const color = opts.color || '#00fbff';
    const overlay = showOverlay({ zIndex: 55000, background: 'rgba(0,0,0,0.92)' });

    const box = document.createElement('div');
    box.style.cssText = `background:#0a0a1a;border:2px solid ${color};border-radius:12px;padding:20px;text-align:center;max-width:300px;width:90%;animation:confirmSlide 0.3s ease;`;

    let html = '';
    if (opts.cardHtml) html += `<div style="margin-bottom:12px;">${opts.cardHtml}</div>`;
    if (opts.title) html += `<div style="color:${color};font-size:14px;font-weight:bold;margin-bottom:8px;">${opts.title}</div>`;
    if (opts.message) html += `<div style="color:#ccc;font-size:12px;margin-bottom:16px;line-height:1.6;">${opts.message}</div>`;
    html += `<div style="display:flex;gap:10px;justify-content:center;">
      <button id="_confirm-yes" style="background:${color};color:#000;border:none;padding:8px 24px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">${opts.yesText || 'はい'}</button>
      <button id="_confirm-no" style="background:#333;color:#fff;border:1px solid #666;padding:8px 24px;border-radius:8px;font-size:13px;cursor:pointer;">${opts.noText || 'いいえ'}</button>
    </div>`;

    box.innerHTML = html;
    overlay.appendChild(box);

    document.getElementById('_confirm-yes').onclick = () => { removeOverlay(overlay); resolve(true); };
    document.getElementById('_confirm-no').onclick = () => { removeOverlay(overlay); resolve(false); };
  });
}

// ===== トースト（一時メッセージ） =====

/**
 * 画面下部にトーストメッセージを表示
 * @param {string} text
 * @param {Object} opts - { color, duration }
 */
export function showToast(text, opts = {}) {
  const color = opts.color || '#00fbff';
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:15%;left:50%;transform:translateX(-50%);z-index:60000;background:rgba(0,15,25,0.9);border:1px solid ${color};color:#fff;font-size:13px;font-weight:bold;padding:10px 24px;border-radius:10px;text-align:center;pointer-events:none;box-shadow:0 0 15px ${color}44;white-space:nowrap;opacity:0;transition:opacity 0.3s;`;
  el.innerText = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.style.opacity = '1');
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }, opts.duration || 2000);
}

// ===== ログ =====

const LOG_MAX = 200;
let logEntries = [];

/**
 * バトルログに追加
 */
export function addLog(text) {
  logEntries.push({ text, time: Date.now() });
  if (logEntries.length > LOG_MAX) logEntries.shift();
  console.log('[BATTLE]', text);
}

/**
 * ログ取得
 */
export function getLogs() {
  return logEntries;
}

/**
 * ログクリア
 */
export function clearLogs() {
  logEntries = [];
}

// ===== 画面切り替え =====

/**
 * 画面を切り替える
 */
export function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

// ===== スクロール矢印 =====

/**
 * スクロール矢印の表示状態を更新
 */
export function updateScrollArrows() {
  document.querySelectorAll('.scroll-wrap').forEach(wrap => {
    const targetId = wrap.dataset.scrollTarget;
    const target = document.getElementById(targetId);
    if (!target) return;
    const hasOverflow = target.scrollWidth > target.clientWidth + 1;
    const canLeft = hasOverflow && target.scrollLeft > 0;
    const canRight = hasOverflow && target.scrollLeft + target.clientWidth < target.scrollWidth - 1;
    wrap.classList.toggle('can-scroll-left', canLeft);
    wrap.classList.toggle('can-scroll-right', canRight);
  });
}
