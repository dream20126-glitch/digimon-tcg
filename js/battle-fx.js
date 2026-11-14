/**
 * battle-fx.js — 18種類の演出モジュール
 *
 * effect-engine.js の EFFECT_RUNNERS に登録される演出関数群
 * 各関数は (options, callback) の形式で、演出完了後に callback() を呼ぶ
 */

import { bs } from './battle-state.js';
import { addLog } from './battle-ui.js';
import { renderAll, updateMemGauge, cardImg, cardBackUrl } from './battle-render.js';

// ===== 効果確認ダイアログのwindow公開 =====
window.confirmEffect = function(yes) {
  // 相手画面の効果オーバーレイも閉じる
  fxRemoteEffectClose();

  // チュートリアル通知
  if (window._tutorialRunner && window._tutorialRunner.active) {
    try {
      window._tutorialRunner.notifyEvent('modal_closed', { modal: 'effect_confirm', result: yes });
      if (!yes) window._tutorialRunner.notifyEvent('action_cancelled', { context: 'effect_confirm' });
      // A案: 全ての確認ダイアログの「はい」で use_effect を発火（進行条件用）
      if (yes) window._tutorialRunner.notifyEvent('use_effect', { context: 'effect_confirm' });
    } catch (e) {}
  }

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

// 移動先/移動元のラベルから、ゾーンの種類（アイコン・色）を決める
function _moveZoneStyle(label) {
  const t = String(label || '');
  if (/セキュリティ/.test(t)) return { icon: '🛡', color: '#b47cff' };
  if (/の下|進化元/.test(t)) return { icon: '🃏', color: '#ff9933' };
  if (/リンク/.test(t)) return { icon: '🔗', color: '#ffaa00' };
  if (/トラッシュ/.test(t)) return { icon: '🗑', color: '#ff5566' };
  if (/手札/.test(t)) return { icon: '✋', color: '#44dd88' };
  if (/デッキ/.test(t)) return { icon: '📚', color: '#4aa8ff' };
  if (/育成/.test(t)) return { icon: '🥚', color: '#ffd84a' };
  if (/バトルエリア|場|テイマー/.test(t)) return { icon: '⚔', color: '#ffd84a' };
  if (/オープン/.test(t)) return { icon: '📖', color: '#00fbff' };
  return { icon: '📍', color: '#00fbff' };
}
// 見出し（何をしたか）: 「トラッシュに送る」「デッキの下に戻す」「手札に加える」等
function _moveHeadline(toLabel) {
  const t = String(toLabel || '');
  const where = t.replace(/\(上\)/, 'の上').replace(/\(下\)/, 'の下');
  if (/トラッシュ/.test(t)) return where + 'に送る';
  if (/手札/.test(t)) return where + 'に加える';
  if (/セキュリティ/.test(t)) return where + 'に置く';
  if (/デッキ/.test(t)) return where + 'に戻す';
  if (/の下|進化元/.test(t)) return where + 'に置く';
  if (/バトルエリア|場/.test(t)) return where + 'に出す';
  return where + 'へ移動';
}

// カードの移動演出（1枚）。見出しで「何をしたか」を出し、移動元と移動先のゾーンを並べて、カードが弧を描いて
// 移動先へ飛び込み、移動先が光って「+1」が出る（以前は右へ流れて消えるだけで、どこへ移ったか分かりにくかった）
export function fxCardMove(card, fromLabel, toLabel, callback, faceDown) {
  // 移動先がセキュリティの場合は秘匿情報なので強制的に裏向き（カード名も隠す）
  // faceDown === false（明示的に表向き）なら、セキュリティへの移動でも表向きで見せる（ダーク・フィールド BT26-100 等の
  // 「セキュリティの下に表向きで置く」）
  const _fd = faceDown === false ? false : (!!faceDown || /セキュリティ/.test(String(toLabel || '')));
  const fromSt = _moveZoneStyle(fromLabel);
  const toSt = _moveZoneStyle(toLabel);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  if (!document.getElementById('fx-move2-style')) {
    const st = document.createElement('style');
    st.id = 'fx-move2-style';
    st.textContent = '@keyframes mv2Pulse{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}'
      + '@keyframes mv2Plus{0%{opacity:0;transform:translate(-50%,0)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-26px)}}'
      + '@keyframes mv2Trail{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(.3)}}';
    document.head.appendChild(st);
  }

  // z-index は deck_open UI(60000) / 観戦オーバーレイ(65000) の上に重ねる必要がある
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:66000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none;opacity:0;transition:opacity 0.2s;';

  // 見出し
  const head = document.createElement('div');
  head.style.cssText = 'font-size:16px;font-weight:900;letter-spacing:1px;color:#fff;text-shadow:0 0 10px ' + toSt.color + ',0 0 20px ' + toSt.color + ';text-align:center;padding:0 12px;';
  const cname = _fd ? '' : ((card && card.name) ? '「' + esc(card.name) + '」を' : '');
  head.innerHTML = '<span style="font-size:20px;">' + toSt.icon + '</span> ' + cname + esc(_moveHeadline(toLabel));
  overlay.appendChild(head);

  // ステージ: 左に移動元、右に移動先のゾーン
  const SW = Math.min(320, window.innerWidth - 32), SH = 170;
  const ZW = 92, ZH = 128, CW = 78, CH = 109;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:' + SW + 'px;height:' + SH + 'px;';
  const zone = (st, label, left) => {
    const z = document.createElement('div');
    z.style.cssText = 'position:absolute;top:0;left:' + left + 'px;width:' + ZW + 'px;height:' + ZH + 'px;border-radius:10px;'
      + 'border:2px solid ' + st.color + '88;background:' + st.color + '14;box-shadow:inset 0 0 18px ' + st.color + '22;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;';
    z.innerHTML = '<div style="font-size:30px;opacity:0.85;">' + st.icon + '</div>';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:absolute;top:' + (ZH + 6) + 'px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:bold;color:' + st.color + ';';
    lbl.innerText = label || '';
    z.appendChild(lbl);
    stage.appendChild(z);
    return z;
  };
  const fromLeft = 0, toLeft = SW - ZW;
  zone(fromSt, fromLabel || '移動元', fromLeft);
  const destZone = zone(toSt, toLabel || '移動先', toLeft);

  // 矢印
  const arrow = document.createElement('div');
  arrow.style.cssText = 'position:absolute;top:' + (ZH / 2 - 14) + 'px;left:' + (ZW + 6) + 'px;width:' + (SW - ZW * 2 - 12) + 'px;text-align:center;font-size:22px;font-weight:900;color:' + toSt.color + ';opacity:0;transition:opacity 0.3s;letter-spacing:-4px;';
  arrow.innerText = '›››';
  stage.appendChild(arrow);

  // カード（移動元のゾーンの上に置く）
  const cardDiv = document.createElement('div');
  const startX = fromLeft + (ZW - CW) / 2, startY = (ZH - CH) / 2;
  const endX = toLeft + (ZW - CW) / 2, endY = startY;
  cardDiv.style.cssText = 'position:absolute;left:0;top:0;width:' + CW + 'px;height:' + CH + 'px;border-radius:6px;overflow:hidden;'
    + 'border:2px solid ' + toSt.color + ';box-shadow:0 0 16px ' + toSt.color + '88;background:#111;z-index:5;'
    + 'transform:translate(' + startX + 'px,' + startY + 'px) scale(0.6);opacity:0;transition:transform 0.25s ease-out, opacity 0.25s;';
  // _fd=true: カード内容を見せず裏向き（セキュリティへ加える等、秘匿が必要な移動）
  const src = (card && !_fd) ? cardImg(card) : '';
  cardDiv.innerHTML = (_fd && cardBackUrl)
    ? `<img src="${cardBackUrl}" style="width:100%;height:100%;object-fit:cover;">`
    : _fd
    ? `<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a3a6a,#0a1530);display:flex;align-items:center;justify-content:center;font-size:20px;color:#3a5a9a;">🛡</div>`
    : (src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#00fbff;padding:8px;font-size:10px;">${esc((card && card.name) || '?')}</div>`);
  stage.appendChild(cardDiv);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);

  const dropTrail = (x, y) => {
    const t = document.createElement('div');
    t.style.cssText = 'position:absolute;left:' + (x + CW / 2 - 5) + 'px;top:' + (y + CH / 2 - 5) + 'px;width:10px;height:10px;border-radius:50%;background:' + toSt.color + ';box-shadow:0 0 10px ' + toSt.color + ';animation:mv2Trail 0.5s ease-out forwards;';
    stage.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 600);
  };

  // 1) 表示して移動元にカードが出る
  setTimeout(() => { overlay.style.opacity = '1'; }, 10);
  setTimeout(() => {
    cardDiv.style.opacity = '1';
    cardDiv.style.transform = 'translate(' + startX + 'px,' + startY + 'px) scale(1)';
    arrow.style.opacity = '1';
  }, 120);
  // 2) 弧を描いて移動先へ（requestAnimationFrame で放物線）
  const FLY_START = 650, FLY_MS = 700;
  setTimeout(() => {
    cardDiv.style.transition = 'none';
    const t0 = performance.now();
    let lastTrail = 0;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / FLY_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
      const x = startX + (endX - startX) * e;
      const y = startY - Math.sin(Math.PI * e) * 46;
      const sc = 1 - 0.18 * Math.sin(Math.PI * e);
      const rot = (endX >= startX ? 1 : -1) * 14 * Math.sin(Math.PI * e);
      cardDiv.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + sc + ') rotate(' + rot + 'deg)';
      if (now - lastTrail > 45) { dropTrail(x, y); lastTrail = now; }
      if (t < 1) requestAnimationFrame(step);
      else land();
    };
    requestAnimationFrame(step);
  }, FLY_START);
  // 3) 移動先に吸い込まれて、移動先が光り「+1」
  const land = () => {
    cardDiv.style.transition = 'transform 0.3s ease-in, opacity 0.3s ease-in';
    cardDiv.style.transform = 'translate(' + endX + 'px,' + (endY + 6) + 'px) scale(0.55)';
    cardDiv.style.opacity = '0';
    destZone.style.transition = 'box-shadow 0.2s, border-color 0.2s, background 0.2s';
    destZone.style.borderColor = toSt.color;
    destZone.style.background = toSt.color + '33';
    destZone.style.boxShadow = '0 0 26px ' + toSt.color + ', inset 0 0 22px ' + toSt.color + '55';
    destZone.style.animation = 'mv2Pulse 0.45s ease-out';
    const plus = document.createElement('div');
    plus.style.cssText = 'position:absolute;left:' + (toLeft + ZW / 2) + 'px;top:' + (ZH / 2 - 30) + 'px;font-size:18px;font-weight:900;color:#fff;text-shadow:0 0 8px ' + toSt.color + ';animation:mv2Plus 0.9s ease-out forwards;z-index:6;';
    plus.innerText = '+1';
    stage.appendChild(plus);
  };
  setTimeout(() => { overlay.style.opacity = '0'; }, 2250);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2450);
}

// 3枚以上がまとめて動くときの移動演出。
// ① 動かすカードを一覧で並べ「以下のN枚を〇〇に送ります（戻します／加えます）」と出す
// ② 一覧のカードが移動元の枠に集まって1つの束になる
// ③ 1枚のときと同じ「移動元 → 移動先」の画面で、束から短い間隔で次々に弧を描いて移動先へ入る（「+N」が増える）
// OK ボタンは無く、全部入ったら閉じる
export function fxCardMoveMulti(cards, fromLabel, toLabel, callback, faceDown) {
  const list = (cards || []).filter(Boolean);
  if (list.length === 0) { callback && callback(); return; }
  const _fd = faceDown === false ? false : (!!faceDown || /セキュリティ/.test(String(toLabel || '')));
  const fromSt = _moveZoneStyle(fromLabel);
  const toSt = _moveZoneStyle(toLabel);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  if (!document.getElementById('fx-move2-style')) {
    const st = document.createElement('style');
    st.id = 'fx-move2-style';
    st.textContent = '@keyframes mv2Pulse{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}'
      + '@keyframes mv2Plus{0%{opacity:0;transform:translate(-50%,0)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-26px)}}'
      + '@keyframes mv2Trail{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(.3)}}';
    document.head.appendChild(st);
  }
  const to = String(toLabel || '');
  const where = to.replace(/\(上\)/, 'の上').replace(/\(下\)/, 'の下');
  const verb = /トラッシュ/.test(to) ? 'に送ります' : /デッキ|セキュリティ/.test(to) ? 'に戻します' : /手札/.test(to) ? 'に加えます' : 'に移動します';
  const cardFace = (card) => {
    const src = (card && !_fd) ? cardImg(card) : '';
    return (_fd && cardBackUrl)
      ? '<img src="' + cardBackUrl + '" style="width:100%;height:100%;object-fit:cover;">'
      : _fd
      ? '<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a3a6a,#0a1530);display:flex;align-items:center;justify-content:center;font-size:20px;color:#3a5a9a;">🛡</div>'
      : (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#00fbff;padding:8px;font-size:10px;">' + esc((card && card.name) || '?') + '</div>');
  };

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:66000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none;opacity:0;transition:opacity 0.2s;';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:16px;font-weight:900;letter-spacing:1px;color:#fff;text-shadow:0 0 10px ' + toSt.color + ',0 0 20px ' + toSt.color + ';text-align:center;padding:0 12px;line-height:1.6;';
  head.innerHTML = (fromLabel ? '<span style="color:#aaa;font-size:12px;">' + esc(fromLabel) + 'から</span><br>' : '')
    + '<span style="font-size:20px;">' + toSt.icon + '</span> 以下の' + list.length + '枚を' + esc(where) + verb;
  overlay.appendChild(head);

  // ① 一覧
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:min(92vw,620px);';
  const gw = list.length > 12 ? 52 : 70;
  const gridItems = list.map((c, i) => {
    const d = document.createElement('div');
    d.style.cssText = 'width:' + gw + 'px;height:' + Math.round(gw * 1.4) + 'px;border-radius:5px;overflow:hidden;border:2px solid ' + toSt.color + ';box-shadow:0 0 8px ' + toSt.color + '66;background:#111;'
      + 'opacity:0;transform:translateY(10px);transition:opacity 0.3s,transform 0.3s;';
    d.innerHTML = cardFace(c);
    grid.appendChild(d);
    setTimeout(() => { d.style.opacity = '1'; d.style.transform = 'translateY(0)'; }, 150 + i * 60);
    return d;
  });
  overlay.appendChild(grid);

  // ③ の画面（最初は隠しておく）
  const SW = Math.min(320, window.innerWidth - 32), SH = 170;
  const ZW = 92, ZH = 128, CW = 78, CH = 109;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:' + SW + 'px;height:' + SH + 'px;display:none;';
  const zone = (st, label, left) => {
    const z = document.createElement('div');
    z.style.cssText = 'position:absolute;top:0;left:' + left + 'px;width:' + ZW + 'px;height:' + ZH + 'px;border-radius:10px;'
      + 'border:2px solid ' + st.color + '88;background:' + st.color + '14;box-shadow:inset 0 0 18px ' + st.color + '22;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;';
    z.innerHTML = '<div style="font-size:30px;opacity:0.85;">' + st.icon + '</div>';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:absolute;top:' + (ZH + 6) + 'px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:bold;color:' + st.color + ';';
    lbl.innerText = label || '';
    z.appendChild(lbl);
    stage.appendChild(z);
    return z;
  };
  const fromLeft = 0, toLeft = SW - ZW;
  zone(fromSt, fromLabel || '移動元', fromLeft);
  const destZone = zone(toSt, toLabel || '移動先', toLeft);
  const arrow = document.createElement('div');
  arrow.style.cssText = 'position:absolute;top:' + (ZH / 2 - 14) + 'px;left:' + (ZW + 6) + 'px;width:' + (SW - ZW * 2 - 12) + 'px;text-align:center;font-size:22px;font-weight:900;color:' + toSt.color + ';opacity:0;transition:opacity 0.3s;letter-spacing:-4px;';
  arrow.innerText = '›››';
  stage.appendChild(arrow);
  const plus = document.createElement('div');
  plus.style.cssText = 'position:absolute;left:' + (toLeft + ZW / 2) + 'px;top:' + (ZH / 2 - 30) + 'px;transform:translate(-50%,0);font-size:18px;font-weight:900;color:#fff;text-shadow:0 0 8px ' + toSt.color + ';z-index:60;opacity:0;';
  stage.appendChild(plus);
  const startX = fromLeft + (ZW - CW) / 2, startY = (ZH - CH) / 2;
  const endX = toLeft + (ZW - CW) / 2, endY = startY;
  // 束（移動元に少しずつずらして重ねる。最初に飛ぶカードが一番上）
  const cardDivs = list.map((card, i) => {
    const d = document.createElement('div');
    const off = Math.min(i, 6) * 2;
    d.style.cssText = 'position:absolute;left:0;top:0;width:' + CW + 'px;height:' + CH + 'px;border-radius:6px;overflow:hidden;'
      + 'border:2px solid ' + toSt.color + ';box-shadow:0 0 12px ' + toSt.color + '88;background:#111;z-index:' + (5 + list.length - i) + ';'
      + 'transform:translate(' + (startX + off) + 'px,' + (startY - off) + 'px);opacity:0;';
    d.innerHTML = cardFace(card);
    d._off = off;
    stage.appendChild(d);
    return d;
  });
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  setTimeout(() => { overlay.style.opacity = '1'; }, 10);

  // ② 一覧のカードが移動元の枠に集まって束になる
  const LIST_MS = 1400 + list.length * 60, GATHER_MS = 450;
  setTimeout(() => {
    // 束の位置を測るため、ステージを（見えない状態で）出す
    stage.style.display = 'block';
    stage.style.visibility = 'hidden';
    const sr = stage.getBoundingClientRect();
    const targetX = sr.left + startX + CW / 2, targetY = sr.top + startY + CH / 2;
    const clones = gridItems.map((g, i) => {
      const r = g.getBoundingClientRect();
      const c = g.cloneNode(true);
      c.style.cssText += ';position:fixed;margin:0;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;'
        + 'z-index:66020;opacity:1;transform:none;transition:transform ' + GATHER_MS + 'ms ease-in-out;';
      document.body.appendChild(c);
      const sc = CW / r.width;
      const off = Math.min(i, 6) * 2;
      requestAnimationFrame(() => {
        c.style.transform = 'translate(' + (targetX + off - (r.left + r.width / 2)) + 'px,' + (targetY - off - (r.top + r.height / 2)) + 'px) scale(' + sc + ')';
      });
      return c;
    });
    grid.style.visibility = 'hidden';
    setTimeout(() => {
      clones.forEach(c => { if (c.parentNode) c.parentNode.removeChild(c); });
      grid.style.display = 'none';
      stage.style.visibility = 'visible';
      cardDivs.forEach(d => { d.style.opacity = '1'; });
      arrow.style.opacity = '1';
      startFly();
    }, GATHER_MS + 40);
  }, LIST_MS);

  // ③ 束から1枚ずつ次々に飛ばす（前のカードが着く前に次が飛び立つ）
  const FLY_MS = 480, STAGGER = 170;
  let landed = 0;
  const flyOne = (d) => {
    d.style.transition = 'none';
    d.style.zIndex = '50';
    const sx = startX + d._off, sy = startY - d._off;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / FLY_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = sx + (endX - sx) * e;
      const y = sy + (endY - sy) * e - Math.sin(Math.PI * e) * 40;
      const sc = 1 - 0.18 * Math.sin(Math.PI * e);
      d.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + sc + ') rotate(' + (14 * Math.sin(Math.PI * e)) + 'deg)';
      if (t < 1) { requestAnimationFrame(step); return; }
      d.style.transition = 'transform 0.2s ease-in, opacity 0.2s ease-in';
      d.style.transform = 'translate(' + endX + 'px,' + (endY + 6) + 'px) scale(0.55)';
      d.style.opacity = '0';
      landed++;
      destZone.style.transition = 'box-shadow 0.15s, border-color 0.15s, background 0.15s';
      destZone.style.borderColor = toSt.color;
      destZone.style.background = toSt.color + '33';
      destZone.style.boxShadow = '0 0 26px ' + toSt.color + ', inset 0 0 22px ' + toSt.color + '55';
      destZone.style.animation = 'none'; void destZone.offsetWidth; destZone.style.animation = 'mv2Pulse 0.3s ease-out';
      plus.innerText = '+' + landed;
      plus.style.opacity = '1';
      if (landed >= cardDivs.length) {
        setTimeout(() => { overlay.style.opacity = '0'; }, 500);
        setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 700);
      }
    };
    requestAnimationFrame(step);
  };
  const startFly = () => { cardDivs.forEach((d, i) => setTimeout(() => flyOne(d), 350 + i * STAGGER)); };
}

// まとめて動くカードを、並んでいる位置から移動先（画面下の移動先の枠）へ「ポンポンポン」と順番に飛ばす演出。
// overlay: 演出を出しているオーバーレイ（この上に移動先の枠を出す）/ els: 飛ばすカードの要素（並び順に飛ぶ）。
// 全部が移動先に入ったら done
export function fxFlyCardsTo(overlay, els, toLabel, done) {
  const finish = () => { try { done && done(); } catch (e) { console.error('[fxFlyCardsTo]', e); } };
  const list = (els || []).filter(Boolean);
  if (!overlay || list.length === 0 || typeof document === 'undefined') { finish(); return; }
  const st = _moveZoneStyle(toLabel);
  // 移動先の枠（画面下中央）
  const dest = document.createElement('div');
  dest.style.cssText = 'position:fixed;left:50%;bottom:9vh;transform:translateX(-50%);min-width:96px;padding:10px 16px;border-radius:12px;'
    + 'border:2px solid ' + st.color + ';background:' + st.color + '22;box-shadow:0 0 18px ' + st.color + '66;text-align:center;z-index:66010;'
    + 'color:#fff;font-weight:bold;font-size:12px;pointer-events:none;transition:box-shadow 0.15s,transform 0.15s;';
  const cnt = document.createElement('div');
  cnt.style.cssText = 'font-size:18px;font-weight:900;color:' + st.color + ';text-shadow:0 0 8px ' + st.color + ';';
  let n = 0;
  cnt.innerText = st.icon + ' 0';
  const lbl = document.createElement('div');
  lbl.innerText = String(toLabel || '').replace(/\(上\)/, 'の上').replace(/\(下\)/, 'の下');
  dest.appendChild(cnt); dest.appendChild(lbl);
  overlay.appendChild(dest);
  const STAGGER = 110, FLY = 420;
  requestAnimationFrame(() => {
    const dr = dest.getBoundingClientRect();
    const dx = dr.left + dr.width / 2, dy = dr.top + dr.height / 2;
    list.forEach((el, i) => {
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        const clone = el.cloneNode(true);
        clone.style.cssText = (clone.style.cssText || '') + ';position:fixed;margin:0;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;'
          + 'z-index:66020;transition:transform ' + FLY + 'ms cubic-bezier(.45,-0.25,.6,1),opacity ' + FLY + 'ms ease-in;opacity:1;transform:none;pointer-events:none;';
        el.style.visibility = 'hidden';
        document.body.appendChild(clone);
        requestAnimationFrame(() => {
          const tx = dx - (r.left + r.width / 2), ty = dy - (r.top + r.height / 2);
          clone.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.25) rotate(' + (i % 2 ? 12 : -12) + 'deg)';
          clone.style.opacity = '0.2';
        });
        setTimeout(() => {
          if (clone.parentNode) clone.parentNode.removeChild(clone);
          n++;
          cnt.innerText = st.icon + ' ' + n;
          dest.style.transform = 'translateX(-50%) scale(1.12)';
          dest.style.boxShadow = '0 0 30px ' + st.color;
          setTimeout(() => { dest.style.transform = 'translateX(-50%) scale(1)'; dest.style.boxShadow = '0 0 18px ' + st.color + '66'; }, 120);
          if (n >= list.length) setTimeout(finish, 350);
        }, FLY);
      }, i * STAGGER);
    });
  });
}
if (typeof window !== 'undefined') window._fxFlyCardsTo = fxFlyCardsTo;

// 3枚以上のカードがまとめて動くとき（破棄・デッキに戻す等）に、1枚ずつの移動演出の代わりに出す一覧の演出。
// 「以下のN枚をデッキの下に戻します」のように、動くカードを並べて1回だけ見せる。
// cards: カード（{name, imgSrc} 等）の配列。faceDown: 裏向き（非公開）のカードとして見せる
function _circled(n) { return (n >= 1 && n <= 20) ? String.fromCharCode(0x2460 + n - 1) : String(n); }
export function fxCardMoveBatch(cards, fromLabel, toLabel, callback, faceDown) {
  const list = (cards || []).filter(Boolean);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const to = String(toLabel || '');
  const where = to.replace(/\(上\)/, 'の上').replace(/\(下\)/, 'の下');
  const verb = /トラッシュ/.test(to) ? 'に送ります' : /デッキ|セキュリティ/.test(to) ? 'に戻します' : /手札/.test(to) ? 'に加えます' : 'に移動します';
  const _fd = !!faceDown || /セキュリティ/.test(to);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:66000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;pointer-events:none;opacity:0;transition:opacity 0.25s;';
  const head = document.createElement('div');
  head.style.cssText = 'color:#00fbff;font-size:15px;font-weight:bold;text-align:center;text-shadow:0 0 10px #00fbff;line-height:1.6;';
  head.innerHTML = (fromLabel ? '<span style="color:#aaa;font-size:12px;">' + esc(fromLabel) + 'から</span><br>' : '') + '以下の' + list.length + '枚を<span style="color:#fff;">' + esc(where) + '</span>' + verb;
  overlay.appendChild(head);
  // デッキに戻すときは置く順番が意味を持つので、番号と「どれが一番下（上）になるか」を出す
  // （cards の並び＝置いた順。デッキの下なら最後に置いたカードが一番下、デッキの上なら一番上）
  const toDeck = /デッキ/.test(to);
  const deckTop = /\(上\)/.test(to);
  if (toDeck && list.length > 1) {
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#ffcc66;font-size:12px;font-weight:bold;text-align:center;';
    sub.innerText = '①から順に' + (deckTop ? 'デッキの上' : 'デッキの下') + 'に置きます（' + _circled(list.length) + 'が一番' + (deckTop ? '上' : '下') + '）';
    overlay.appendChild(sub);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:min(92vw,620px);max-height:60vh;overflow:hidden;';
  const w = list.length > 12 ? 52 : 72;
  const _flyEls = [];
  list.forEach((c, i) => {
    const d = document.createElement('div');
    _flyEls.push(d);
    d.style.cssText = 'width:' + w + 'px;text-align:center;opacity:0;transform:translateY(10px);transition:opacity 0.3s,transform 0.3s;';
    const src = (!_fd && c) ? cardImg(c) : '';
    d.style.position = 'relative';
    d.innerHTML = (toDeck && list.length > 1 ? '<div style="position:absolute;top:-6px;left:-6px;z-index:1;min-width:20px;height:20px;padding:0 3px;border-radius:10px;background:#ffcc00;color:#000;font-size:11px;font-weight:bold;line-height:20px;text-align:center;box-shadow:0 0 6px #ffcc00;">' + (i + 1) + '</div>' : '')
      + '<div style="width:' + w + 'px;height:' + Math.round(w * 1.4) + 'px;border-radius:5px;border:1px solid #00fbff;overflow:hidden;box-shadow:0 0 8px #00fbff44;">'
      + (_fd ? (cardBackUrl ? '<img src="' + cardBackUrl + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a3a6a,#0a1530);"></div>')
        : (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#00fbff;font-size:9px;padding:4px;">' + esc(c && c.name || '?') + '</div>'))
      + '</div>' + (_fd ? '' : '<div style="color:#ddd;font-size:8px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c && c.name || '') + '</div>');
    row.appendChild(d);
    setTimeout(() => { d.style.opacity = '1'; d.style.transform = 'translateY(0)'; }, 150 + i * 60);
  });
  overlay.appendChild(row);
  // 「OK」を押したら閉じて先へ進む（自分と相手の両方が押してから進む。待ち合わせは呼び出し元）
  overlay.style.pointerEvents = 'auto';
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.innerText = 'OK';
  okBtn.style.cssText = 'margin-top:6px;background:#00fbff;color:#000;border:none;padding:10px 40px;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;box-shadow:0 0 12px #00fbff88;';
  let _closed = false;
  okBtn.onclick = (e) => {
    if (e) e.stopPropagation();
    if (_closed) return;
    _closed = true;
    // OK のあと、並んだカードが移動先へ順番に飛んでいく
    okBtn.style.visibility = 'hidden';
    overlay.style.pointerEvents = 'none';
    fxFlyCardsTo(overlay, _flyEls, toLabel, () => {
      overlay.style.opacity = '0';
      setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 200);
    });
  };
  overlay.appendChild(okBtn);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
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
    if (e.target && e.target.closest && e.target.closest('#_pending-hud-own, #_pending-hud-opp, [data-hud-list]')) return; // 発揮待ちの効果の表示は対象外
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
// status: 下段の状態表示（省略時「⏳ 相手が効果を確認中...」）
export function fxRemoteEffect(cardName, effectText, status) {
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
    + '<div style="color:#888;font-size:10px;">' + (status || '⏳ 相手が効果を確認中...') + '</div>';
  ov.appendChild(bx);
  document.body.appendChild(ov);
  // タイムアウトなし — fx_effectClose受信時に消える
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

// baseCard: 合体元のバトルエリアカード（本体）, partnerCards: 消費するリンクカードの配列
// （1枚以上）, resultCard: 合体後のカード, cost: アプ合体コスト（表示のみ、省略可）
export function fxAppGattai(baseCard, partnerCards, resultCard, cost, callback) {
  if (typeof cost === 'function') { callback = cost; cost = undefined; }
  const partners = (partnerCards || []).filter(Boolean);
  const allCards = [baseCard, ...partners];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:1rem;font-weight:900;color:#ff00fb;letter-spacing:3px;text-shadow:0 0 20px #ff00fb;margin-bottom:16px;';
  label.innerText = 'APP GATTAI';
  overlay.appendChild(label);

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap;max-width:90vw;';

  function makeCard(card, id) {
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'width:100px;height:140px;border-radius:8px;border:2px solid #ff00fb;overflow:hidden;box-shadow:0 0 15px #ff00fb44;opacity:0;transition:all 0.6s ease;';
    const src = card ? cardImg(card) : '';
    div.innerHTML = src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="color:#ff00fb;padding:8px;font-size:10px;">${card?.name || '?'}</div>`;
    return div;
  }
  function makePlus() {
    const plus = document.createElement('div');
    plus.style.cssText = 'font-size:16px;color:#ff00fb;font-weight:bold;opacity:0;transition:opacity 0.3s;';
    plus.innerText = '＋';
    return plus;
  }

  const cardEls = allCards.map((c, i) => {
    const el = makeCard(c, '_ap' + i);
    el.style.transform = 'translateX(' + ((i - (allCards.length - 1) / 2) * 40) + 'px)';
    return el;
  });
  const plusEls = [];
  cardEls.forEach((el, i) => {
    container.appendChild(el);
    if (i < cardEls.length - 1) {
      const plus = makePlus();
      plusEls.push(plus);
      container.appendChild(plus);
    }
  });

  overlay.appendChild(container);
  document.body.appendChild(overlay);

  cardEls.forEach((el, i) => {
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; }, 300 + i * 300);
  });
  plusEls.forEach((plus, i) => {
    setTimeout(() => { plus.style.opacity = '1'; }, 900 + i * 300);
  });
  const convergeDelay = 900 + plusEls.length * 300 + 1000;
  setTimeout(() => {
    cardEls.forEach((el, i) => {
      el.style.transition = 'all 1s ease';
      const dir = i % 2 === 0 ? 1 : -1;
      el.style.transform = 'translate(' + (dir * 60) + 'px,0) rotate(' + (dir * 360) + 'deg) scale(0)';
      el.style.opacity = '0';
    });
    plusEls.forEach(plus => { plus.style.opacity = '0'; });
  }, convergeDelay);
  const resultDelay = convergeDelay + 1400;
  setTimeout(() => {
    container.innerHTML = '';
    container.style.flexDirection = 'column';
    const result = makeCard(resultCard, '_apResult');
    result.style.cssText += 'opacity:1;box-shadow:0 0 40px #ff00fb;animation:fxJogressAppear 1.5s ease forwards;';
    container.appendChild(result);
    const rl = document.createElement('div');
    rl.style.cssText = 'margin-top:8px;font-size:11px;color:#ff00fb;font-weight:bold;';
    rl.innerText = 'アプ合体完了！' + (cost != null ? '（コスト' + cost + '）' : '');
    container.appendChild(rl);
  }, resultDelay);
  const totalTime = resultDelay + 1900;
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, totalTime);
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

// 複数枚をまとめてリンクする特別演出（ダンテモン BT26-086 の【登場時】【進化時】「7枚までをリンク」等、3枚以上）。
// リンクするカードが並ぶ → クルクル混ざりながら回転（キラキラ） → 1枚ずつリンク先に吸い込まれ、横向きに差し込まれる
export function fxMultiLinkEffect(baseCard, linkCards, callback) {
  const list = (linkCards || []).filter(Boolean);
  if (list.length === 0) { callback && callback(); return; }
  if (!document.getElementById('fx-multilink-style')) {
    const st = document.createElement('style');
    st.id = 'fx-multilink-style';
    st.textContent = '@keyframes mlSpark{0%{transform:translate(0,0) scale(0);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1.2);opacity:0}}'
      + '@keyframes mlGlow{0%,100%{box-shadow:0 0 18px #ffd84a88,0 0 40px #ffaa0044}50%{box-shadow:0 0 34px #fff3b0,0 0 70px #ffaa0088}}';
    document.head.appendChild(st);
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle at 50% 55%, rgba(60,40,0,0.85), rgba(0,0,0,0.92));z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:1.15rem;font-weight:900;color:#ffd84a;letter-spacing:4px;text-shadow:0 0 18px #ffaa00,0 0 30px #fff3b0;margin-bottom:6px;';
  title.innerText = '⚡ LINK ×' + list.length;
  overlay.appendChild(title);
  const W = 70, H = 98;           // リンクするカードの大きさ
  const BW = 110, BH = 154;       // リンク先（本体）の大きさ
  const SW = Math.min(360, window.innerWidth - 24), SH = 400;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:' + SW + 'px;height:' + SH + 'px;';
  overlay.appendChild(stage);
  const img = (c) => { const src = c ? cardImg(c) : ''; return src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;display:block;">' : '<div style="color:#ffaa00;padding:4px;font-size:9px;">' + ((c && c.name) || '?') + '</div>'; };
  // 本体（下側中央）
  const baseLeft = SW / 2 - BW / 2 - 30, baseTop = SH - BH - 20;
  const base = document.createElement('div');
  base.style.cssText = 'position:absolute;left:' + baseLeft + 'px;top:' + baseTop + 'px;width:' + BW + 'px;height:' + BH + 'px;border-radius:9px;border:2px solid #00fbff;overflow:hidden;z-index:50;background:#111;animation:mlGlow 1.2s ease-in-out infinite;';
  base.innerHTML = img(baseCard);
  stage.appendChild(base);
  // リンクするカード（上側に1列に並べる）
  const cx = SW / 2 - W / 2, cy = 110;
  const els = list.map((c, i) => {
    const d = document.createElement('div');
    const x0 = (SW - W) * (list.length === 1 ? 0.5 : i / (list.length - 1));
    d.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;border-radius:6px;border:2px solid #ffaa00;overflow:hidden;background:#111;box-shadow:0 0 14px #ffaa0088;z-index:' + (60 + i) + ';opacity:0;transition:opacity 0.3s;';
    d.style.transform = 'translate(' + x0 + 'px,10px)';
    d.innerHTML = img(c);
    stage.appendChild(d);
    return { d, x0 };
  });
  document.body.appendChild(overlay);
  // キラキラ
  let sparkTimer = null;
  const spark = () => {
    for (let k = 0; k < 6; k++) {
      const s = document.createElement('div');
      const size = 3 + Math.random() * 6;
      const ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 140;
      s.style.cssText = 'position:absolute;left:' + (SW / 2 + (Math.random() - 0.5) * SW * 0.8) + 'px;top:' + (cy + (Math.random() - 0.5) * 200) + 'px;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + (Math.random() > 0.5 ? '#fff3b0' : '#ffd84a') + ';box-shadow:0 0 8px #fff;z-index:90;pointer-events:none;'
        + '--dx:' + (Math.cos(ang) * dist) + 'px;--dy:' + (Math.sin(ang) * dist) + 'px;animation:mlSpark ' + (0.7 + Math.random() * 0.6) + 's ease-out forwards;';
      stage.appendChild(s);
      setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 1400);
    }
  };
  sparkTimer = setInterval(spark, 120);
  setTimeout(() => els.forEach((e) => { e.d.style.opacity = '1'; }), 50);
  // クルクル混ざりながら回転（楕円の軌道を回る）
  const SWIRL_START = 600, SWIRL_MS = 1800;
  let raf = null, t0 = 0;
  const swirl = (ts) => {
    if (!t0) t0 = ts;
    const t = Math.min(1, (ts - t0) / SWIRL_MS);
    const ease = t < 0.15 ? t / 0.15 : 1;     // 並びから軌道へ移る
    els.forEach((e, i) => {
      const ph = (i / els.length) * Math.PI * 2 + t * Math.PI * 4.5 * (i % 2 ? 1 : -1) * 0.6 + t * Math.PI * 3;
      const ox = cx + Math.cos(ph) * (SW * 0.34), oy = cy + Math.sin(ph) * 70;
      const x = e.x0 + (ox - e.x0) * ease, y = 10 + (oy - 10) * ease;
      const rot = t * 720 * (i % 2 ? -1 : 1);
      e.d.style.zIndex = String(60 + Math.round(Math.sin(ph) * 10) + 10);
      e.d.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg)';
    });
    if (t < 1) raf = requestAnimationFrame(swirl);
    else suck();
  };
  setTimeout(() => { raf = requestAnimationFrame(swirl); }, SWIRL_START);
  // 1枚ずつ吸い込まれて、本体の下に横向きで差し込まれる（少しずつずらして重ねる）
  const suck = () => {
    const STEP = 330;
    els.forEach((e, i) => {
      setTimeout(() => {
        const fx = baseLeft + BW / 2 + 6 + Math.min(i, 6) * 5;
        const fy = baseTop + BH / 2 - H / 2 - 40 + i * (80 / Math.max(1, els.length - 1));
        e.d.style.transition = 'transform 0.45s cubic-bezier(0.5,0,0.3,1)';
        e.d.style.zIndex = String(40 - i);
        e.d.style.transform = 'translate(' + fx + 'px,' + fy + 'px) rotate(' + (450 + (i % 2 ? 0 : 360)) + 'deg) scale(0.92)';
        setTimeout(() => {
          base.style.boxShadow = '0 0 50px #fff3b0, 0 0 90px #ffaa00';
          setTimeout(() => { base.style.boxShadow = ''; }, 180);
          spark();
        }, 430);
      }, i * STEP);
    });
    setTimeout(() => {
      clearInterval(sparkTimer);
      if (raf) cancelAnimationFrame(raf);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      callback && callback();
    }, els.length * STEP + 1100);
  };
}

// 効果によるバトル（「このデジモンと相手のデジモン1体でバトルする」。アタックではないので VS 演出とは別）。
// 両方のカードを左右に並べ、ぶつかり合ってから勝敗（DPの高い方が勝ち）を出す。
// result: 'win'（左が勝ち）/ 'lose'（右が勝ち）/ 'draw'（両者消滅）。opts.leftLabel / opts.rightLabel: カードの下の見出し
export function fxEffectBattle(leftCard, rightCard, leftDp, rightDp, result, callback, opts) {
  opts = opts || {};
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:1.05rem;font-weight:900;color:#ff9900;letter-spacing:3px;text-shadow:0 0 15px #ff9900;margin-bottom:14px;';
  title.innerText = '⚔ 効果でバトル';
  overlay.appendChild(title);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:26px;';
  const mk = (c, dp, color, label) => {
    const w = document.createElement('div');
    w.style.cssText = 'text-align:center;transition:transform 0.25s ease, opacity 0.5s, filter 0.5s;';
    const src = c ? cardImg(c) : '';
    w.innerHTML = '<div style="width:100px;height:140px;border-radius:8px;border:2px solid ' + color + ';overflow:hidden;box-shadow:0 0 15px ' + color + '66;background:#111;">'
      + (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:' + color + ';padding:6px;font-size:10px;">' + ((c && c.name) || '?') + '</div>') + '</div>'
      + '<div style="color:#fff;font-size:11px;font-weight:bold;margin-top:4px;">' + ((c && c.name) || '?') + '</div>'
      + '<div style="color:' + color + ';font-size:13px;font-weight:900;">DP ' + dp + '</div>'
      + (label ? '<div style="color:#888;font-size:9px;">' + label + '</div>' : '');
    return w;
  };
  const L = mk(leftCard, leftDp, '#00fbff', opts.leftLabel);
  const vs = document.createElement('div');
  vs.style.cssText = 'font-size:1.6rem;font-weight:900;color:#ff9900;text-shadow:0 0 12px #ff9900;';
  vs.innerText = '⚔';
  const Rt = mk(rightCard, rightDp, '#ff00fb', opts.rightLabel);
  row.appendChild(L); row.appendChild(vs); row.appendChild(Rt);
  overlay.appendChild(row);
  const res = document.createElement('div');
  res.style.cssText = 'margin-top:14px;font-size:1.2rem;font-weight:900;letter-spacing:2px;opacity:0;transition:opacity 0.3s;min-height:1.4em;';
  overlay.appendChild(res);
  document.body.appendChild(overlay);
  // ぶつかり合う
  setTimeout(() => { L.style.transform = 'translateX(18px)'; Rt.style.transform = 'translateX(-18px)'; }, 400);
  setTimeout(() => { L.style.transform = ''; Rt.style.transform = ''; }, 700);
  setTimeout(() => {
    const lName = (leftCard && leftCard.name) || '?', rName = (rightCard && rightCard.name) || '?';
    if (result === 'draw') { res.style.color = '#ff4444'; res.innerText = '両者消滅！'; L.style.opacity = '0.4'; Rt.style.opacity = '0.4'; }
    else if (result === 'win') { res.style.color = '#00ff88'; res.innerText = '「' + lName + '」の勝ち！'; Rt.style.opacity = '0.35'; Rt.style.filter = 'grayscale(1)'; }
    else { res.style.color = '#ff4444'; res.innerText = '「' + rName + '」の勝ち！'; L.style.opacity = '0.35'; L.style.filter = 'grayscale(1)'; }
    res.style.opacity = '1';
  }, 1000);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2300);
}

// cost: 支払ったリンクコスト（数値なら「〇コストでリンク！」を表示。省略時は表示しない）
// replacedCard: リンク上限で差し替えて外すカード
// 演出:
//   通常   … リンク先のカードとリンクするカードを並べて表示 → リンクするカードを回転させながら、リンク先のカードの下に
//            横向きで差し込む（カード全体を横向きにして、半分ほどはみ出して見える）
//   差し替え… リンク先（リンクされた状態）とリンクするカードを並べて表示 → リンクされているカードが抜かれる →
//            リンクするカードを回転させながら差し込む → 抜かれたカードは回転しながらトラッシュへ
export function fxLinkEffect(baseCard, linkCard, callback, cost, replacedCard) {
  if (cost === undefined && linkCard && typeof linkCard._lastLinkCost === 'number') cost = linkCard._lastLinkCost;
  if (replacedCard === undefined && linkCard && linkCard._linkReplaced) replacedCard = linkCard._linkReplaced;
  if (linkCard && linkCard._linkReplaced) delete linkCard._linkReplaced;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:1rem;font-weight:bold;color:#ffaa00;letter-spacing:3px;text-shadow:0 0 15px #ffaa00;margin-bottom:6px;';
  labelEl.innerText = replacedCard ? '⚡ LINK（差し替え）' : '⚡ LINK';
  overlay.appendChild(labelEl);
  const costEl = document.createElement('div');
  costEl.style.cssText = 'font-size:0.95rem;font-weight:bold;color:#fff;margin-bottom:14px;text-shadow:0 0 10px #ffaa00;min-height:1.2em;';
  costEl.innerText = typeof cost === 'number' ? (cost > 0 ? cost + 'コストでリンク！' : 'コストを支払わずリンク！') : '';
  overlay.appendChild(costEl);

  const W = 100, H = 140;
  const baseLeft = 20;
  const insertLeft = baseLeft + W / 2;          // 横向きのリンクカードの中心が本体の右端に来る位置
  const standLeft = baseLeft + W + 70;          // 最初にリンクするカードを並べて置く位置（縦）
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:' + (standLeft + W + 20) + 'px;max-width:94vw;height:' + (H + 60) + 'px;';
  const imgHtml = (c, color) => {
    const src = c ? cardImg(c) : '';
    return src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;">` : `<div style="color:${color};padding:6px;font-size:10px;">${(c && c.name) || '?'}</div>`;
  };
  const mkCard = (c, color, left, z) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:' + left + 'px;top:10px;width:' + W + 'px;height:' + H + 'px;border-radius:7px;border:2px solid ' + color + ';overflow:hidden;box-shadow:0 0 15px ' + color + '66;z-index:' + z + ';background:#111;';
    d.innerHTML = imgHtml(c, color);
    return d;
  };
  const baseDiv = mkCard(baseCard, '#00fbff', baseLeft, 2);
  // リンクするカード: 最初は右に縦向きで並べる（位置は insertLeft 基準の translateX で表す）
  const linkDiv = mkCard(linkCard, '#ffaa00', insertLeft, 3);
  linkDiv.style.transform = 'translateX(' + (standLeft - insertLeft) + 'px) rotate(0deg)';
  let oldDiv = null;
  if (replacedCard) {
    oldDiv = mkCard(replacedCard, '#999', insertLeft, 1);
    oldDiv.style.transform = 'translateX(0) rotate(90deg)';
    stage.appendChild(oldDiv);
  }
  stage.appendChild(baseDiv);
  stage.appendChild(linkDiv);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);

  const insert = (at) => {
    // 回転させながらリンク先の下に横向きで差し込む（差し込み終わったら本体の下へ回り込む）
    setTimeout(() => {
      linkDiv.style.transition = 'transform 0.8s cubic-bezier(0.3,0.7,0.3,1)';
      linkDiv.style.transform = 'translateX(0) rotate(450deg)';
    }, at);
    setTimeout(() => { linkDiv.style.zIndex = '1'; }, at + 600);
    setTimeout(() => {
      baseDiv.style.transition = 'box-shadow 0.15s';
      baseDiv.style.boxShadow = '0 0 40px #ffaa00, 0 0 80px #ffaa0066';
      setTimeout(() => { baseDiv.style.boxShadow = '0 0 15px #00fbff44'; }, 300);
    }, at + 800);
  };
  const end = (at) => setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, at);

  if (!oldDiv) {
    insert(500);
    end(2400);
    return;
  }
  // 差し替え: ①リンクされているカードを抜く → ②新しいカードを回転させながら差し込む → ③抜いたカードは回転しながらトラッシュへ
  setTimeout(() => {
    oldDiv.style.transition = 'transform 0.5s ease-out';
    oldDiv.style.transform = 'translate(' + (W * 0.2) + 'px,' + (H * 0.55) + 'px) rotate(90deg)';
    oldDiv.style.zIndex = '4';
  }, 500);
  insert(1100);
  const trashLbl = document.createElement('div');
  trashLbl.style.cssText = 'position:absolute;right:0;bottom:0;color:#aaa;font-size:11px;font-weight:bold;opacity:0;transition:opacity 0.3s;';
  trashLbl.innerText = '🗑 トラッシュへ';
  stage.appendChild(trashLbl);
  setTimeout(() => {
    trashLbl.style.opacity = '1';
    oldDiv.style.transition = 'transform 0.8s ease-in, opacity 0.8s ease-in';
    oldDiv.style.transform = 'translate(' + (standLeft - insertLeft + W * 0.3) + 'px,' + (H * 0.9) + 'px) rotate(450deg) scale(0.45)';
    oldDiv.style.opacity = '0';
  }, 2000);
  end(3300);
}

// =====================================================
//  12. セキュリティ追加演出（デッキ→セキュリティ移動）
// =====================================================

export function fxSecurityAdd(card, callback) {
  // セキュリティへ加えるカードは秘匿情報なので裏向きで移動演出する
  fxCardMove(card || { name: 'カード' }, 'デッキ', 'セキュリティ', callback, true);
}

// =====================================================
//  13. セキュリティ除去演出（セキュリティ→トラッシュ移動）
// =====================================================

export function fxSecurityRemove(card, callback) {
  fxCardMove(card || { name: 'カード' }, 'セキュリティ', 'トラッシュ', callback);
}

// =====================================================
//  13b. シャッフル演出（カード束が混ざるアニメーション）
// =====================================================

export function fxShuffle(label, callback) {
  const overlay = document.createElement('div');
  // z-index は fxCardMove(66000) より上に置く（他の移動演出に隠れないように）
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:67000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;animation:fadeIn 0.15s ease;';
  const title = document.createElement('div');
  title.style.cssText = 'color:#00fbff;font-size:14px;font-weight:bold;text-shadow:0 0 8px #00fbff;';
  title.innerText = '🔀 ' + (label || 'シャッフル');
  overlay.appendChild(title);
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:170px;height:130px;';
  overlay.appendChild(stage);
  if (!document.getElementById('_fx-shuffle-style')) {
    const st = document.createElement('style');
    st.id = '_fx-shuffle-style';
    st.textContent =
      '@keyframes fxShuffleA{0%{transform:translate(-42px,0) rotate(-7deg);}25%{transform:translate(32px,-32px) rotate(11deg);}50%{transform:translate(42px,0) rotate(8deg);}75%{transform:translate(-32px,32px) rotate(-11deg);}100%{transform:translate(-42px,0) rotate(-7deg);}}'
      + '@keyframes fxShuffleB{0%{transform:translate(42px,0) rotate(7deg);}25%{transform:translate(-32px,32px) rotate(-11deg);}50%{transform:translate(-42px,0) rotate(-8deg);}75%{transform:translate(32px,-32px) rotate(11deg);}100%{transform:translate(42px,0) rotate(7deg);}}';
    document.head.appendChild(st);
  }
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('div');
    const anim = i % 2 === 0 ? 'fxShuffleA' : 'fxShuffleB';
    c.style.cssText = 'position:absolute;left:50%;top:50%;width:56px;height:80px;margin:-40px 0 0 -28px;'
      + 'border-radius:6px;border:1px solid #00fbff;background:linear-gradient(135deg,#0a1f2e,#142838);'
      + 'box-shadow:0 0 8px rgba(0,251,255,0.4);display:flex;align-items:center;justify-content:center;'
      + 'color:#00fbff66;font-size:22px;'
      + 'animation:' + anim + ' 0.52s ease-in-out ' + (i * 0.07) + 's infinite;';
    c.innerText = '◆';
    stage.appendChild(c);
  }
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.animation = 'fadeOut 0.25s ease forwards';
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 250);
  }, 1100);
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
  el.innerText = '💨 ' + (message || '対象がいませんでした');
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
  const _kwRule = !!(window._appendKeywordRuleLine && window._appendKeywordRuleLine(overlay, 'security_attack_plus'));
  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, _kwRule ? 3000 : 2200);
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
      // セキュリティへ移動するカードは秘匿情報なので裏向きで演出（リカバリー等）
      const faceDown = !!(to && String(to).indexOf('セキュリティ') >= 0);
      fxCardMove(opts.card, from, to, cb, faceDown);
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
      fxAppGattai(opts.baseCard, opts.partnerCards, opts.resultCard, opts.cost, cb);
    },
    "ジョグレス進化": (opts, cb) => {
      fxJogressEvolve(opts.card1, opts.card2, opts.resultCard, cb);
    },
    "リンク演出": (opts, cb) => {
      fxLinkEffect(opts.baseCard, opts.linkCard, cb);
    },
  };
}


// =====================================================
//  ジョグレス進化（融合）演出 — オプションの使用より特別に見えるよう、段階を重ねた大演出
//  ① 映画風の黒帯＋渦巻くエネルギー（集中線）の中、2体が左右から飛び込む
//  ② 2体が螺旋（DNA）を描きながら近づき、間に稲妻が走る
//  ③ 衝突: 閃光・衝撃波・強い揺れ・光線の放射・大量の火花
//  ④ 魔法陣と光の柱から進化後のカードが現れ、ホログラムの光が走る。金色のタイトル
// =====================================================
// left / right: 進化元の2体（左＝上に重なる方） / result: 進化後のカード / cost: 進化コスト（null なら表示しない）
export function fxJogressFusion(left, right, result, cost, callback) {
  let _cbDone = false;
  const done = () => { if (_cbDone) return; _cbDone = true; try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body) { done(); return; }
  if (!document.getElementById('fx-jogress-fusion-style2')) {
    const st = document.createElement('style');
    st.id = 'fx-jogress-fusion-style2';
    st.textContent = [
      '@keyframes jfShake{0%,100%{transform:translate(0,0)}10%{transform:translate(-14px,8px)}20%{transform:translate(12px,-10px)}30%{transform:translate(-10px,-6px)}40%{transform:translate(9px,9px)}55%{transform:translate(-6px,4px)}70%{transform:translate(5px,-4px)}85%{transform:translate(-3px,2px)}}',
      '@keyframes jfRing{0%{transform:translate(-50%,-50%) scale(0.1);opacity:1}100%{transform:translate(-50%,-50%) scale(7);opacity:0}}',
      '@keyframes jfFlash{0%{opacity:0}10%{opacity:1}100%{opacity:0}}',
      '@keyframes jfOrb{0%{transform:translate(-50%,-50%) scale(0.2);opacity:0}25%{opacity:1}70%{transform:translate(-50%,-50%) scale(1.5)}100%{transform:translate(-50%,-50%) scale(1.1);opacity:0}}',
      '@keyframes jfPillar{0%{transform:translateX(-50%) scaleX(0.1) scaleY(0);opacity:0}20%{opacity:1;transform:translateX(-50%) scaleX(1) scaleY(1)}100%{transform:translateX(-50%) scaleX(0.3) scaleY(1);opacity:0}}',
      '@keyframes jfRise{0%{transform:translate(-50%,-30%) scale(0.3) rotateY(540deg);opacity:0;filter:brightness(4)}55%{transform:translate(-50%,-56%) scale(1.15) rotateY(0deg);opacity:1;filter:brightness(1.8)}100%{transform:translate(-50%,-50%) scale(1) rotateY(0deg);opacity:1;filter:brightness(1)}}',
      '@keyframes jfTitle{0%{letter-spacing:30px;opacity:0;transform:translateX(-50%) scale(1.8)}55%{opacity:1}75%{transform:translateX(-50%) scale(0.95)}100%{letter-spacing:6px;opacity:1;transform:translateX(-50%) scale(1)}}',
      '@keyframes jfGlow{0%,100%{box-shadow:0 0 30px #ffdd00,0 0 70px #ff8800,0 0 110px #ff4400}50%{box-shadow:0 0 50px #ffffff,0 0 100px #ffdd00,0 0 150px #ff8800}}',
      '@keyframes jfRays{0%{transform:translate(-50%,-50%) rotate(0deg) scale(0.3);opacity:0}15%{opacity:0.9}100%{transform:translate(-50%,-50%) rotate(90deg) scale(1.3);opacity:0}}',
      '@keyframes jfRaysSlow{0%{transform:translate(-50%,-50%) rotate(0deg)}100%{transform:translate(-50%,-50%) rotate(360deg)}}',
      '@keyframes jfCircle{0%{transform:translate(-50%,-50%) rotateX(68deg) rotateZ(0deg) scale(0.2);opacity:0}25%{opacity:1}100%{transform:translate(-50%,-50%) rotateX(68deg) rotateZ(240deg) scale(1);opacity:0.85}}',
      '@keyframes jfSheen{0%{transform:translateX(-160%) skewX(-20deg)}100%{transform:translateX(260%) skewX(-20deg)}}',
      '@keyframes jfBarIn{0%{transform:scaleY(0)}100%{transform:scaleY(1)}}',
      '@keyframes jfSub{0%{opacity:0;transform:translateX(-50%) translateY(10px)}100%{opacity:1;transform:translateX(-50%) translateY(0)}}',
      '@keyframes jfAura{0%,100%{box-shadow:0 0 22px var(--c),0 0 48px var(--c)}50%{box-shadow:0 0 34px #fff,0 0 80px var(--c)}}',
    ].join('');
    document.head.appendChild(st);
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:56000;pointer-events:none;overflow:hidden;background:radial-gradient(ellipse at center,rgba(50,22,0,0.94) 0%,rgba(0,0,0,0.97) 70%);opacity:0;transition:opacity 0.35s;perspective:900px;';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;';
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H / 2;
  const CW = Math.min(110, W * 0.26), CH = CW * 1.4;
  const R = Math.max(W, H);

  // 映画風の黒帯（上下）
  const bar = (top) => {
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;left:0;right:0;' + (top ? 'top:0' : 'bottom:0') + ';height:' + Math.round(H * 0.09) + 'px;background:#000;transform-origin:' + (top ? 'top' : 'bottom') + ';animation:jfBarIn 0.4s ease-out forwards;z-index:5;';
    overlay.appendChild(b);
  };
  bar(true); bar(false);

  // キャンバス: 渦巻く集中線・稲妻・螺旋の光・火花・舞い上がる光の粒
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  stage.appendChild(cv);
  const g = cv.getContext('2d');
  if (g) g.scale(dpr, dpr);
  const parts = []; // { x,y,vx,vy,life,max,size,color,grav,drag }
  const addPart = (p) => { if (parts.length < 900) parts.push(p); };
  let phase = 'enter'; // enter → spin → burst → reveal
  let aPos = null, bPos = null; // 2体の今の中心（稲妻用）
  let alive = true;

  const face = (card, color) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid ' + color + ';--c:' + color + ';animation:jfAura 0.6s ease-in-out infinite;background:#111;z-index:2;';
    const src = card ? (card.imgSrc || cardImg(card)) : '';
    d.innerHTML = (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:11px;">' + ((card && card.name) || '?') + '</div>')
      + '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.8);padding:2px;font-size:9px;text-align:center;color:#fff;">' + ((card && card.name) || '') + '</div>';
    return d;
  };
  const a = face(left, '#00e5ff'), b = face(right, '#ff8a00');
  stage.appendChild(a); stage.appendChild(b);
  const place = (el, x, y, rot, sc, op) => {
    el.style.left = (x - CW / 2) + 'px'; el.style.top = (y - CH / 2) + 'px';
    el.style.transform = 'rotate(' + rot + 'deg) scale(' + sc + ')'; el.style.opacity = op;
  };

  // 稲妻（2点の間をギザギザに）
  const bolt = (x1, y1, x2, y2, color, width) => {
    const segs = 10;
    g.beginPath(); g.moveTo(x1, y1);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs, off = (Math.random() - 0.5) * Math.min(60, len * 0.25);
      g.lineTo(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
    }
    g.lineTo(x2, y2);
    g.strokeStyle = color; g.lineWidth = width; g.shadowColor = color; g.shadowBlur = 18; g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, width * 0.4); g.stroke();
  };

  const t0 = performance.now();
  const ENTER = 800, SPIN = 1900;
  let lastFrame = t0;
  const loop = (now) => {
    if (!alive) return;
    const t = now - t0, dt = Math.min(50, now - lastFrame) / 16.67; lastFrame = now;
    if (!g) { requestAnimationFrame(loop); return; }
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    // 渦巻く集中線（中心へ吸い込まれる）。衝突までだんだん速く・多く
    if (phase === 'enter' || phase === 'spin') {
      const k = Math.min(1, t / (ENTER + SPIN));
      const n = 3 + Math.floor(k * 9);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, r0 = R * (0.55 + Math.random() * 0.3), r1 = r0 * (0.55 + Math.random() * 0.2);
        const sw = 0.25 + k * 0.5;
        addPart({ type: 'line', ang, r: r0, r1, spin: sw * (Math.random() < 0.5 ? 1 : 1), life: 0, max: 22, color: Math.random() < 0.5 ? '#ffd24a' : (Math.random() < 0.5 ? '#00e5ff' : '#ff8a00') });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      const f = 1 - p.life / p.max;
      if (p.type === 'line') {
        p.r *= 1 - 0.06 * dt; p.r1 *= 1 - 0.06 * dt; p.ang += 0.02 * p.spin * dt;
        g.strokeStyle = p.color; g.globalAlpha = f * 0.7; g.lineWidth = 1.6; g.shadowBlur = 0;
        g.beginPath(); g.moveTo(cx + Math.cos(p.ang) * p.r, cy + Math.sin(p.ang) * p.r); g.lineTo(cx + Math.cos(p.ang + 0.05) * p.r1, cy + Math.sin(p.ang + 0.05) * p.r1); g.stroke();
      } else {
        p.vx *= p.drag || 0.97; p.vy = p.vy * (p.drag || 0.97) + (p.grav || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        g.globalAlpha = Math.max(0, f);
        g.fillStyle = p.color; g.shadowColor = p.color; g.shadowBlur = p.size * 3;
        g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, p.size * (0.4 + 0.6 * f)), 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    // 螺旋中: 2体の間に稲妻
    if (phase === 'spin' && aPos && bPos && Math.random() < 0.55) {
      bolt(aPos[0], aPos[1], bPos[0], bPos[1], Math.random() < 0.5 ? '#7ff6ff' : '#ffc070', 2 + Math.random() * 2.5);
    }
    // 光が現れた後: 舞い上がる光の粒
    if (phase === 'reveal' && Math.random() < 0.9) {
      for (let i = 0; i < 3; i++) addPart({ x: cx + (Math.random() - 0.5) * W * 0.8, y: H + 10, vx: (Math.random() - 0.5) * 0.6, vy: -(2 + Math.random() * 3.5), life: 0, max: 70 + Math.random() * 50, size: 1.5 + Math.random() * 2.5, color: Math.random() < 0.6 ? '#ffe27a' : '#ffffff', drag: 0.995 });
    }
    g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;

    // カードの動き: ① 左右から飛び込み → ② 螺旋（DNA）を描きながら中心へ
    if (phase === 'enter' || phase === 'spin') {
      if (t < ENTER) {
        const e = 1 - Math.pow(1 - t / ENTER, 3);
        const ax = -CW + (cx - W * 0.24 + CW) * e, bx = W + CW - (W + CW - (cx + W * 0.24)) * e;
        place(a, ax, cy, -25 * (1 - e), 1, e); place(b, bx, cy, 25 * (1 - e), 1, e);
        aPos = [ax, cy]; bPos = [bx, cy];
      } else if (t < ENTER + SPIN) {
        phase = 'spin';
        const u = (t - ENTER) / SPIN, e = u * u;
        const r = W * 0.24 * (1 - e), ang = Math.PI * 6 * e;
        const ax = cx - Math.cos(ang) * r, ay = cy - Math.sin(ang) * r * 0.45;
        const bx = cx + Math.cos(ang) * r, by = cy + Math.sin(ang) * r * 0.45;
        place(a, ax, ay, ang * 57.3 * 0.5, 1 - 0.55 * e, 1);
        place(b, bx, by, -ang * 57.3 * 0.5, 1 - 0.55 * e, 1);
        aPos = [ax, ay]; bPos = [bx, by];
        // 螺旋の光の尾
        addPart({ x: ax, y: ay, vx: 0, vy: 0, life: 0, max: 26, size: 4, color: '#00e5ff', drag: 0.9 });
        addPart({ x: bx, y: by, vx: 0, vy: 0, life: 0, max: 26, size: 4, color: '#ff8a00', drag: 0.9 });
      } else { phase = 'burst'; collide(); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ③ 衝突
  const collide = () => {
    a.remove(); b.remove();
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;animation:jfFlash 0.8s ease-out forwards;z-index:4;';
    stage.appendChild(flash);
    stage.style.animation = 'jfShake 0.7s linear';
    ['#ffffff', '#ffdd00', '#00e5ff', '#ff8a00'].forEach((c, i) => {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:90px;height:90px;border-radius:50%;border:5px solid ' + c + ';box-shadow:0 0 26px ' + c + ',inset 0 0 18px ' + c + ';animation:jfRing 1.1s ease-out ' + (i * 0.1) + 's forwards;opacity:0;';
      stage.appendChild(ring);
    });
    // 放射する光線
    const rays = document.createElement('div');
    rays.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + (R * 1.6) + 'px;height:' + (R * 1.6) + 'px;border-radius:50%;background:repeating-conic-gradient(rgba(255,240,170,0.85) 0deg 4deg,rgba(255,240,170,0) 4deg 15deg);-webkit-mask:radial-gradient(circle,#000 0%,#000 25%,transparent 70%);mask:radial-gradient(circle,#000 0%,#000 25%,transparent 70%);animation:jfRays 1.4s ease-out forwards;';
    stage.appendChild(rays);
    // 火花（キャンバス）
    const colors = ['#ffdd00', '#ffffff', '#00e5ff', '#ff8a00', '#ff4fd8', '#9dff6a'];
    for (let i = 0; i < 220; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 14;
      addPart({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 40 + Math.random() * 40, size: 1.5 + Math.random() * 4, color: colors[i % colors.length], drag: 0.94, grav: 0.08 });
    }
    // 融合の光の球
    const orb = document.createElement('div');
    orb.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,#ffffff 0%,#fff3b0 30%,#ffb000 60%,rgba(255,120,0,0) 72%);animation:jfOrb 1.2s ease-in-out forwards;z-index:3;';
    stage.appendChild(orb);
    setTimeout(reveal, 1000);
  };

  // ④ 魔法陣と光の柱 → 進化後のカード・タイトル
  const reveal = () => {
    phase = 'reveal';
    // 足元の魔法陣（傾けて回す）
    const circ = document.createElement('div');
    const CR = CW * 3.2;
    circ.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + (cy + CH * 0.62) + 'px;width:' + CR + 'px;height:' + CR + 'px;border-radius:50%;border:3px solid #ffd24a;box-shadow:0 0 24px #ffb000,inset 0 0 24px #ffb000;animation:jfCircle 2.2s ease-out forwards;'
      + 'background:repeating-conic-gradient(rgba(255,210,74,0.55) 0deg 2deg,transparent 2deg 30deg),radial-gradient(circle,transparent 0 52%,rgba(255,210,74,0.9) 53% 54.5%,transparent 55.5% 68%,rgba(255,210,74,0.8) 69% 70%,transparent 71%);';
    stage.appendChild(circ);
    // 後ろでゆっくり回る光線
    const rays2 = document.createElement('div');
    rays2.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + (R * 1.4) + 'px;height:' + (R * 1.4) + 'px;border-radius:50%;opacity:0.45;background:repeating-conic-gradient(rgba(255,220,120,0.6) 0deg 6deg,rgba(255,220,120,0) 6deg 20deg);-webkit-mask:radial-gradient(circle,#000 0%,transparent 60%);mask:radial-gradient(circle,#000 0%,transparent 60%);animation:jfRaysSlow 9s linear infinite;';
    stage.appendChild(rays2);
    const pillar = document.createElement('div');
    pillar.style.cssText = 'position:absolute;left:' + cx + 'px;top:0;bottom:0;width:' + (CW * 2) + 'px;transform-origin:center bottom;background:linear-gradient(to right,rgba(255,220,0,0) 0%,rgba(255,240,170,0.9) 35%,rgba(255,255,255,1) 50%,rgba(255,240,170,0.9) 65%,rgba(255,220,0,0) 100%);animation:jfPillar 1.4s ease-out forwards;z-index:2;';
    stage.appendChild(pillar);
    const res = face(result, '#ffdd00');
    res.style.width = (CW * 1.45) + 'px'; res.style.height = (CH * 1.45) + 'px';
    res.style.left = cx + 'px'; res.style.top = cy + 'px';
    res.style.animation = 'jfRise 1s cubic-bezier(.2,.9,.3,1.2) forwards, jfGlow 1.2s ease-in-out 1s infinite';
    res.style.zIndex = '3';
    // ホログラムの光（斜めに走る）
    const sheen = document.createElement('div');
    sheen.style.cssText = 'position:absolute;top:-10%;bottom:-10%;width:45%;left:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.75),rgba(150,230,255,0.5),rgba(255,160,250,0.45),transparent);mix-blend-mode:screen;animation:jfSheen 0.9s ease-in-out 1s 2;';
    res.appendChild(sheen);
    stage.appendChild(res);
    const title = document.createElement('div');
    title.style.cssText = 'position:absolute;left:50%;top:' + Math.max(H * 0.1, cy - CH * 1.45 / 2 - 70) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:' + Math.min(36, W * 0.075) + 'px;font-weight:900;font-style:italic;'
      + 'background:linear-gradient(180deg,#ffffff 0%,#fff2a8 35%,#ffb300 60%,#ff7a00 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:1px rgba(255,255,255,0.6);'
      + 'filter:drop-shadow(0 0 10px #ffb000) drop-shadow(0 0 26px #ff5a00);animation:jfTitle 1s ease-out forwards;z-index:6;';
    title.innerText = 'JOGRESS EVOLUTION';
    stage.appendChild(title);
    const jp = document.createElement('div');
    jp.style.cssText = 'position:absolute;left:50%;top:' + (Math.max(H * 0.1, cy - CH * 1.45 / 2 - 70) + Math.min(36, W * 0.075) + 8) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:13px;font-weight:900;letter-spacing:8px;color:#fff;text-shadow:0 0 8px #ff8a00,0 0 16px #ff4400;opacity:0;animation:jfSub 0.5s ease-out 0.6s forwards;z-index:6;';
    jp.innerText = 'ジョグレス進化';
    stage.appendChild(jp);
    const sub = document.createElement('div');
    sub.style.cssText = 'position:absolute;left:50%;top:' + Math.min(H * 0.86, cy + CH * 1.45 / 2 + 22) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:13px;font-weight:bold;color:#ffe9a0;text-shadow:0 0 8px #ff8a00;opacity:0;animation:jfSub 0.5s ease-out 0.9s forwards;z-index:6;';
    sub.innerText = '「' + ((left && left.name) || '?') + '」＋「' + ((right && right.name) || '?') + '」→「' + ((result && result.name) || '?') + '」' + (cost != null ? '（コスト' + cost + '）' : '');
    stage.appendChild(sub);
    setTimeout(() => { overlay.style.opacity = '0'; }, 3000);
    setTimeout(() => { alive = false; overlay.remove(); done(); }, 3400);
  };
  // 万一止まっても進行が止まらないように
  setTimeout(() => { if (!_cbDone) { alive = false; try { overlay.remove(); } catch (_) {} done(); } }, 12000);
}


// =====================================================
//  デジクロス演出 — 素材のカードが並び、X字に交差しながら中心へ集まって1体のデジモンになる
// =====================================================
// mats: 素材（[{name, imgSrc}]。上に重なる順） / result: 登場するデジモン / cost: 支払う登場コスト（null なら表示しない）
export function fxDigixrossFusion(mats, result, cost, callback) {
  const done = () => { try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body) { done(); return; }
  if (!document.getElementById('fx-digixross-style')) {
    const st = document.createElement('style');
    st.id = 'fx-digixross-style';
    st.textContent = [
      '@keyframes dxFlash{0%{opacity:0}12%{opacity:1}100%{opacity:0}}',
      '@keyframes dxRing{0%{transform:translate(-50%,-50%) scale(0.1) rotate(0deg);opacity:1}100%{transform:translate(-50%,-50%) scale(4.5) rotate(90deg);opacity:0}}',
      '@keyframes dxX{0%{transform:translate(-50%,-50%) scale(0.2) rotate(-30deg);opacity:0}25%{opacity:1}70%{transform:translate(-50%,-50%) scale(1.25) rotate(0deg);opacity:1}100%{transform:translate(-50%,-50%) scale(1.5) rotate(8deg);opacity:0}}',
      '@keyframes dxRise{0%{transform:translate(-50%,-50%) scale(0.3) rotate(-12deg);opacity:0;filter:brightness(3)}60%{transform:translate(-50%,-50%) scale(1.12) rotate(2deg);opacity:1;filter:brightness(1.5)}100%{transform:translate(-50%,-50%) scale(1) rotate(0deg);opacity:1;filter:brightness(1)}}',
      '@keyframes dxTitle{0%{transform:translateX(-50%) scale(2.2) skewX(-14deg);opacity:0}50%{opacity:1}100%{transform:translateX(-50%) scale(1) skewX(-14deg);opacity:1}}',
      '@keyframes dxGlow{0%,100%{box-shadow:0 0 26px #ff3b3b,0 0 54px #ffb000}50%{box-shadow:0 0 44px #ffffff,0 0 80px #ff3b3b}}',
      '@keyframes dxShake{0%,100%{transform:translate(0,0)}25%{transform:translate(-7px,3px)}50%{transform:translate(6px,-4px)}75%{transform:translate(-4px,4px)}}',
    ].join('');
    document.head.appendChild(st);
  }
  const list = (mats || []).filter(Boolean);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:56000;pointer-events:none;overflow:hidden;background:radial-gradient(ellipse at center,rgba(50,0,0,0.9) 0%,rgba(0,0,0,0.95) 70%);opacity:0;transition:opacity 0.3s;';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;';
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H / 2;
  const n = Math.max(1, list.length);
  const CW = Math.min(92, (W * 0.8) / Math.max(3, n + 1)), CH = CW * 1.4;
  const face = (card, color, w, h) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;width:' + w + 'px;height:' + h + 'px;border-radius:7px;overflow:hidden;border:2px solid ' + color + ';box-shadow:0 0 16px ' + color + ';background:#111;';
    const src = card ? (card.imgSrc || cardImg(card)) : '';
    d.innerHTML = (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:6px;font-size:10px;">' + ((card && card.name) || '?') + '</div>')
      + '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.8);padding:2px;font-size:8px;text-align:center;color:#fff;">' + ((card && card.name) || '') + '</div>';
    return d;
  };
  const colors = ['#ff3b3b', '#ffb000', '#3bd1ff', '#7dff5a', '#ff5ad8', '#ffffff'];
  // ① 素材が扇状に並ぶ
  const els = list.map((c, i) => {
    const col = colors[i % colors.length];
    const el = face(c, col, CW, CH);
    const x = cx + (i - (n - 1) / 2) * (CW * 1.15), y = cy + Math.abs(i - (n - 1) / 2) * 10;
    el.style.left = (x - CW / 2) + 'px'; el.style.top = (y - CH / 2) + 'px';
    el.style.opacity = '0'; el.style.transform = 'translateY(30px) rotate(' + ((i - (n - 1) / 2) * 8) + 'deg)';
    el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    el._x = x; el._y = y; el._col = col;
    stage.appendChild(el);
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0) rotate(' + ((i - (n - 1) / 2) * 8) + 'deg)'; }, 120 + i * 140);
    return el;
  });
  // ② X字に交差しながら中心へ（左右の素材が反対側をかすめてから中心に集まる）
  const t0 = performance.now() + 450 + n * 140;
  const DUR = 1100;
  const step = (now) => {
    const t = now - t0;
    if (t < 0) { requestAnimationFrame(step); return; }
    const u = Math.min(1, t / DUR);
    els.forEach((el, i) => {
      const dir = (i - (n - 1) / 2) === 0 ? (i % 2 ? 1 : -1) : Math.sign(i - (n - 1) / 2);
      // 曲線: 反対側へ少し振ってから中心へ（X字の交差）
      const e = u < 0.55 ? u / 0.55 : 1;
      const sweepX = el._x + (cx - el._x) * e - dir * Math.sin(Math.PI * e) * W * 0.12;
      const sweepY = el._y + (cy - el._y) * e - Math.sin(Math.PI * e) * 70 * (i % 2 ? 1 : -1);
      const fin = u < 0.55 ? 0 : (u - 0.55) / 0.45;
      const x = sweepX + (cx - sweepX) * fin, y = sweepY + (cy - sweepY) * fin;
      el.style.transition = 'none';
      el.style.left = (x - CW / 2) + 'px'; el.style.top = (y - CH / 2) + 'px';
      el.style.transform = 'rotate(' + (dir * 540 * u) + 'deg) scale(' + (1 - 0.6 * u) + ')';
      el.style.opacity = String(1 - Math.max(0, u - 0.8) * 5);
      if (Math.random() < 0.6) {
        const tr = document.createElement('div');
        tr.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + (6 + Math.random() * 6) + 'px;height:' + (6 + Math.random() * 6) + 'px;margin:-4px;border-radius:2px;background:' + el._col + ';box-shadow:0 0 12px ' + el._col + ';transform:rotate(45deg);transition:all 0.45s ease-out;';
        stage.appendChild(tr);
        requestAnimationFrame(() => { tr.style.opacity = '0'; tr.style.transform = 'rotate(45deg) scale(0.1)'; });
        setTimeout(() => tr.remove(), 480);
      }
    });
    if (u < 1) { requestAnimationFrame(step); return; }
    burst();
  };
  requestAnimationFrame(step);
  // ③ 合体: X の光・閃光・衝撃波・揺れ
  const burst = () => {
    els.forEach(el => el.remove());
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;animation:dxFlash 0.55s ease-out forwards;';
    stage.appendChild(flash);
    stage.style.animation = 'dxShake 0.4s linear';
    const X = document.createElement('div');
    X.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;font-size:' + Math.min(220, W * 0.45) + 'px;font-weight:900;color:#fff;text-shadow:0 0 20px #ff3b3b,0 0 50px #ffb000,0 0 90px #ff3b3b;animation:dxX 1s ease-out forwards;line-height:1;';
    X.innerText = '✖';
    stage.appendChild(X);
    ['#ffffff', '#ff3b3b', '#ffb000'].forEach((c, i) => {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:100px;height:100px;border:4px solid ' + c + ';box-shadow:0 0 22px ' + c + ';transform:translate(-50%,-50%) rotate(45deg);animation:dxRing 0.9s ease-out ' + (i * 0.1) + 's forwards;opacity:0;';
      stage.appendChild(ring);
    });
    setTimeout(reveal, 650);
  };
  // ④ 1体のデジモンが現れる
  const reveal = () => {
    const RW = Math.min(140, W * 0.32), RH = RW * 1.4;
    const res = face(result, '#ffb000', RW, RH);
    res.style.left = cx + 'px'; res.style.top = cy + 'px';
    res.style.animation = 'dxRise 0.8s cubic-bezier(.2,.9,.3,1.2) forwards, dxGlow 1.1s ease-in-out 0.8s infinite';
    stage.appendChild(res);
    const title = document.createElement('div');
    title.style.cssText = 'position:absolute;left:50%;top:' + Math.max(14, cy - RH / 2 - 66) + 'px;white-space:nowrap;font-size:' + Math.min(40, W * 0.09) + 'px;font-weight:900;font-style:italic;color:#fff;text-shadow:0 0 10px #ff3b3b,0 0 26px #ffb000,0 0 46px #ff3b3b;animation:dxTitle 0.7s ease-out forwards;';
    title.innerText = 'DIGIXROS!';
    stage.appendChild(title);
    const sub = document.createElement('div');
    sub.style.cssText = 'position:absolute;left:50%;top:' + (cy + RH / 2 + 16) + 'px;transform:translateX(-50%);max-width:92vw;text-align:center;font-size:12px;font-weight:bold;color:#ffd9a0;text-shadow:0 0 8px #ff3b3b;opacity:0;transition:opacity 0.4s 0.4s;';
    sub.innerText = list.map(c => '「' + (c.name || '?') + '」').join('×') + ' →「' + ((result && result.name) || '?') + '」' + (cost != null ? '（コスト' + cost + '）' : '');
    stage.appendChild(sub);
    requestAnimationFrame(() => { sub.style.opacity = '1'; });
    setTimeout(() => { overlay.style.opacity = '0'; }, 2100);
    setTimeout(() => { overlay.remove(); done(); }, 2450);
  };
}


// =====================================================
//  バトルのぶつかり合い演出（VS画面の中で再生）。2段階で動かす:
//  fxBattleClashBegin … ① 2回ぶつかってはね返る ② 3回目はぶつかったまま押し合う（火花が出続ける）。
//    押し合いに入ったら onHold() を呼ぶ（呼び出し元はここで消滅回避の判定・確認のポップアップを行う）。押し合いは finish まで続く
//  ctrl.finish(outcomes, cb) … 決着。outcomes = { atk: kind, def: kind }。kind:
//    'win'（勝って残る）/ 'stay'（負けていない・何もしない）/ 'trash'（吹き飛ばされてトラッシュ）/ 'evade'（【回避】よける）/
//    'barrier'（【防壁】セキュリティが盾になって砕ける）/ 'armor_break'・'fragment'（進化元が代わりに弾き飛ぶ）/
//    'separate'（【分離】リンクカードが代わりに弾き飛ぶ）/ 'shield'（効果で消滅しない：光のバリア）/
//    'scapegoat'（【スケープゴート】身代わりが吹き飛ぶ）/ 'indomitable'（【不屈】トラッシュへ飛んで戻ってくる）/
//    'to_hand'・'to_deck'・'to_security'（その場所へ飛んでいく）/ 'recoil'（【道連れ】勝った側にも衝撃が返って吹き飛ぶ）
//  勝った側の画面に「WIN」、負けた側の画面に「LOSE」（相打ちは両方 LOSE）
// =====================================================
export function registerClashLoser(card) {
  if (typeof window === 'undefined' || !card) return;
  const list = Array.isArray(window._clashLosers) ? window._clashLosers : [];
  list.push({ name: card.name || '', at: Date.now() });
  window._clashLosers = list.filter(x => Date.now() - x.at < 10000);
}
// 直前のぶつかり合い演出でトラッシュへ送ったカードか（1回だけ消費する）
export function consumeClashLoser(card) {
  if (typeof window === 'undefined' || !card || !Array.isArray(window._clashLosers)) return false;
  const now = Date.now();
  window._clashLosers = window._clashLosers.filter(x => now - x.at < 10000);
  const i = window._clashLosers.findIndex(x => x.name === (card.name || ''));
  if (i === -1) return false;
  window._clashLosers.splice(i, 1);
  return true;
}
const _CLASH_KW_LABEL = { evade: '【回避】', barrier: '【防壁】', armor_break: '【アーマー解除】', fragment: '【フラグメント】', separate: '【分離】', shield: '消滅しない！', scapegoat: '【スケープゴート】', indomitable: '【不屈】', recoil: '【道連れ】', to_hand: '手札へ', to_deck: 'デッキへ', to_security: 'セキュリティへ' };
export function fxBattleClashBegin(stageEl, atkEl, defEl, vsEl, winner, myIsAtk, onHold) {
  const noop = { finish: (o, cb) => { cb && cb(); }, close: () => {} };
  if (typeof document === 'undefined' || !stageEl || !atkEl || !defEl) { setTimeout(() => onHold && onHold(), 0); return noop; }
  if (!document.getElementById('fx-clash-style3')) {
    const st = document.createElement('style');
    st.id = 'fx-clash-style3';
    st.textContent = [
      '@keyframes fcShake{0%,100%{transform:translate(0,0)}15%{transform:translate(-12px,6px)}30%{transform:translate(10px,-8px)}45%{transform:translate(-8px,-4px)}60%{transform:translate(6px,6px)}80%{transform:translate(-3px,2px)}}',
      '@keyframes fcShakeS{0%,100%{transform:translate(0,0)}25%{transform:translate(-5px,3px)}50%{transform:translate(5px,-3px)}75%{transform:translate(-3px,-2px)}}',
      '@keyframes fcRing{0%{transform:translate(-50%,-50%) scale(0.1);opacity:1}100%{transform:translate(-50%,-50%) scale(6);opacity:0}}',
      '@keyframes fcFlash{0%{opacity:0}12%{opacity:0.95}100%{opacity:0}}',
      '@keyframes fcBin{0%{transform:translate(-50%,-50%) scale(0);opacity:0}60%{transform:translate(-50%,-50%) scale(1.15);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}',
      '@keyframes fcBinHit{0%,100%{transform:translate(-50%,-50%) scale(1) rotate(0)}30%{transform:translate(-50%,-50%) scale(1.3) rotate(-10deg)}60%{transform:translate(-50%,-50%) scale(0.95) rotate(6deg)}}',
      '@keyframes fcBig{0%{transform:translate(-50%,-50%) scale(3.4);opacity:0;filter:blur(8px)}55%{transform:translate(-50%,-50%) scale(0.9);opacity:1;filter:blur(0)}75%{transform:translate(-50%,-50%) scale(1.07)}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}',
      '@keyframes fcBigLose{0%{transform:translate(-50%,-80%) scale(1.2);opacity:0}50%{transform:translate(-50%,-50%) scale(1);opacity:1}62%{transform:translate(-53%,-50%)}74%{transform:translate(-47%,-50%)}86%{transform:translate(-51%,-50%)}100%{transform:translate(-50%,-50%);opacity:1}}',
      '@keyframes fcRays{0%{transform:translate(-50%,-50%) rotate(0deg) scale(0.4);opacity:0}20%{opacity:0.9}100%{transform:translate(-50%,-50%) rotate(70deg) scale(1.15);opacity:0.5}}',
      '@keyframes fcPiece{0%{transform:translate(0,0) rotate(0deg);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}',
      '@keyframes fcGlow{0%,100%{opacity:0.55;transform:translate(-50%,-50%) scale(0.9)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.25)}}',
      '@keyframes fcLabel{0%{transform:translate(-50%,-50%) scale(2);opacity:0}40%{transform:translate(-50%,-50%) scale(0.95);opacity:1}100%{transform:translate(-50%,-60%) scale(1);opacity:1}}',
      '@keyframes fcDome{0%{transform:translate(-50%,-50%) scale(0.3);opacity:0}40%{transform:translate(-50%,-50%) scale(1.08);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0.9}}',
      '@keyframes fcDomeHit{0%,100%{filter:brightness(1)}30%{filter:brightness(2.6)}}',
      '@keyframes fcVortex{0%{transform:translate(-50%,-50%) rotate(0deg) scale(1)}100%{transform:translate(-50%,-50%) rotate(360deg) scale(1)}}',
      '@keyframes fcRevive{0%{transform:translate(-50%,0) scaleY(0);opacity:0}30%{opacity:1}100%{transform:translate(-50%,0) scaleY(1);opacity:0}}',
    ].join('');
    document.head.appendChild(st);
  }
  const W = window.innerWidth, H = window.innerHeight, R = Math.max(W, H);
  const ra = atkEl.getBoundingClientRect(), rd = defEl.getBoundingClientRect();
  const gap = Math.max(0, rd.left - ra.right);
  const push = gap / 2 + Math.min(ra.width, rd.width) * 0.16;
  const ix = (ra.right + rd.left) / 2, iy = (ra.top + ra.bottom) / 2 - 20;
  if (vsEl) { vsEl.style.transition = 'opacity 0.15s, transform 0.15s'; vsEl.style.opacity = '0'; vsEl.style.transform = 'scale(2.5)'; }
  const fx = document.createElement('div');
  fx.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:47600;overflow:hidden;';
  document.body.appendChild(fx);
  const cv = document.createElement('canvas');
  const dpr = 1; // 演出の粒は等倍で十分（高解像度の端末で重くなっていた）
  cv.width = W * dpr; cv.height = H * dpr; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  fx.appendChild(cv);
  const g = cv.getContext('2d');
  const ps = [];
  const cols = ['#fff6c8', '#ffd84a', '#ff9a00', '#ff5a1f', '#ffffff', '#7ff6ff'];
  const sparksAt = (x, y, n, power, palette) => {
    const pal = palette || cols;
    for (let i = 0; i < n; i++) {
      const ang = (Math.random() < 0.75 ? (Math.random() < 0.5 ? -Math.PI / 2 : Math.PI / 2) + (Math.random() - 0.5) * 2.4 : Math.random() * Math.PI * 2);
      const sp = (2 + Math.random() * 11) * power;
      if (ps.length < 420) ps.push({ x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 30, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 20 + Math.random() * 28, len: 1.5 + Math.random() * 3.5, c: pal[(Math.random() * pal.length) | 0] });
    }
  };
  const sparks = (n, power) => sparksAt(ix, iy, n, power);
  let alive = true, last = performance.now(), holdSpark = false;
  const tick = (now) => {
    if (!alive) return;
    const dt = Math.min(50, now - last) / 16.67; last = now;
    if (holdSpark) sparks(4, 0.8);
    if (g && (ps.length > 0 || g._dirty)) {
      g._dirty = ps.length > 0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life += dt;
        if (p.life >= p.max) { ps.splice(i, 1); continue; }
        p.vx *= 0.94; p.vy = p.vy * 0.94 + 0.25 * dt;
        const ox = p.x, oy = p.y; p.x += p.vx * dt; p.y += p.vy * dt;
        const f = 1 - p.life / p.max;
        // ぼかし（shadowBlur）は重いので使わず、太い半透明の線で光って見せる
        g.strokeStyle = p.c; g.beginPath(); g.moveTo(ox - p.vx * 1.5, oy - p.vy * 1.5); g.lineTo(p.x, p.y);
        g.globalAlpha = Math.max(0, f) * 0.35; g.lineWidth = (p.len * f + 0.5) * 3; g.stroke();
        g.globalAlpha = Math.max(0, f); g.lineWidth = p.len * f + 0.5; g.stroke();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const el = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; fx.appendChild(d); return d; };
  const flashAt = (x, y, strength, tint) => {
    const f = el('position:absolute;inset:0;background:radial-gradient(circle at ' + x + 'px ' + y + 'px,rgba(255,255,255,' + strength + ') 0%,' + (tint || 'rgba(255,240,180,' + (strength * 0.8) + ')') + ' 16%,rgba(255,255,255,0) 55%);animation:fcFlash 0.45s ease-out forwards;');
    setTimeout(() => f.remove(), 500);
  };
  const ringsAt = (x, y, colors, size) => colors.forEach((c, i) => {
    const r = el('position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px;border-radius:50%;border:4px solid ' + c + ';box-shadow:0 0 18px ' + c + ';animation:fcRing 0.7s ease-out ' + (i * 0.08) + 's forwards;opacity:0;');
    setTimeout(() => r.remove(), 1000);
  });
  const shake = (name, ms) => { stageEl.style.animation = name + ' ' + ms + 'ms linear'; setTimeout(() => { stageEl.style.animation = ''; }, ms + 20); };
  [atkEl, defEl].forEach((e) => { e.style.willChange = 'transform'; });
  const setT = (e, tr, t) => { e.style.transition = 'transform ' + t; e.style.transform = tr; };
  const AT = (x, rot, sc) => 'translateX(' + x + 'px) rotate(' + rot + 'deg)' + (sc ? ' scale(' + sc + ')' : '');
  const label = (x, y, text, color) => el('position:absolute;left:' + x + 'px;top:' + y + 'px;white-space:nowrap;font-size:' + Math.min(30, W * 0.07) + 'px;font-weight:900;color:#fff;text-shadow:0 0 10px ' + color + ',0 0 22px ' + color + ',0 0 3px #000;animation:fcLabel 0.5s ease-out forwards;z-index:3;', text);

  const clashOnce = (at, power) => {
    setTimeout(() => { setT(atkEl, AT(-16, -5), '0.16s ease-out'); setT(defEl, AT(16, 5), '0.16s ease-out'); }, at);
    setTimeout(() => { setT(atkEl, AT(push, 7), '0.17s cubic-bezier(.55,0,.9,.35)'); setT(defEl, AT(-push, -7), '0.17s cubic-bezier(.55,0,.9,.35)'); }, at + 170);
    setTimeout(() => {
      flashAt(ix, iy, 0.6 + power * 0.25); sparks(55 + power * 35, 0.8 + power * 0.3); ringsAt(ix, iy, ['#ffffff', '#ffd84a'], 50 + power * 20); shake('fcShakeS', 260);
      setT(atkEl, AT(-10, -2), '0.28s cubic-bezier(.2,.9,.3,1.3)'); setT(defEl, AT(10, 2), '0.28s cubic-bezier(.2,.9,.3,1.3)');
    }, at + 340);
  };
  clashOnce(0, 0);
  clashOnce(620, 1);
  const T3 = 1300, MIN_HOLD = 1100;
  setTimeout(() => { setT(atkEl, AT(-22, -7), '0.2s ease-out'); setT(defEl, AT(22, 7), '0.2s ease-out'); }, T3);
  setTimeout(() => { setT(atkEl, AT(push, 5), '0.18s cubic-bezier(.55,0,.9,.35)'); setT(defEl, AT(-push, -5), '0.18s cubic-bezier(.55,0,.9,.35)'); }, T3 + 210);
  let glow = null, jitterTimer = null, holdStart = 0, pendingFinish = null, finished = false;
  setTimeout(() => {
    flashAt(ix, iy, 0.9); sparks(60, 1.3); ringsAt(ix, iy, ['#ffffff', '#ffd84a', '#ff6a00'], 70); shake('fcShake', 380);
    holdSpark = true; holdStart = performance.now();
    glow = el('position:absolute;left:' + ix + 'px;top:' + iy + 'px;width:120px;height:180px;border-radius:50%;background:radial-gradient(ellipse,rgba(255,255,255,0.95) 0%,rgba(255,216,74,0.7) 35%,rgba(255,106,0,0) 70%);animation:fcGlow 0.22s ease-in-out infinite;');
    jitterTimer = setInterval(() => {
      const u = Math.min(1, (performance.now() - holdStart) / MIN_HOLD);
      const lean = winner === 'atk' ? 1 : winner === 'def' ? -1 : 0;
      const shift = lean * 14 * u;
      const j = () => (Math.random() - 0.5) * 6;
      atkEl.style.transition = 'transform 0.05s linear'; defEl.style.transition = 'transform 0.05s linear';
      atkEl.style.transform = AT(push + shift + j(), 5 + j() * 0.5);
      defEl.style.transform = AT(-push + shift + j(), -5 + j() * 0.5);
    }, 50);
    try { onHold && onHold(); } catch (e) { console.error('[clash onHold]', e); }
    if (pendingFinish) { const pf = pendingFinish; pendingFinish = null; runFinish(pf.o, pf.cb); }
  }, T3 + 390);

  // ---- 決着 ----
  const centerOf = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const binAt = (dir, icon, text, color) => {
    const bx = dir < 0 ? Math.max(56, W * 0.13) : Math.min(W - 56, W * 0.87), by = H - Math.max(80, H * 0.14);
    // 渦を巻いて口を開ける（トラッシュの入口）
    const vortex = el('position:absolute;left:' + bx + 'px;top:' + by + 'px;width:130px;height:130px;border-radius:50%;border:5px dashed ' + color + ';box-sizing:border-box;will-change:transform;animation:fcBin 0.3s ease-out, fcVortex 0.9s linear 0.3s infinite;opacity:0.85;');
    const b = el('position:absolute;left:' + bx + 'px;top:' + by + 'px;width:84px;height:84px;border-radius:50%;background:radial-gradient(circle,' + color + '77 0%,#0a0a0a 72%);border:3px solid ' + color + ';box-shadow:0 0 30px ' + color + ',0 0 60px ' + color + '88,inset 0 0 20px ' + color + ';display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:30px;animation:fcBin 0.3s ease-out forwards;z-index:2;',
      icon + '<div style="font-size:10px;font-weight:bold;margin-top:-2px;">' + text + '</div>');
    return { b, bx, by, vortex };
  };
  // 吹き飛ばして、隅のアイコン（トラッシュ等）に吸い込ませる。発射の爆発 → 燃える尾を引いて回転しながら飛ぶ
  // → 渦に吸い込まれて爆発・衝撃波・揺れ・「TRASH!」
  const blowTo = (area, dir, dest, after) => {
    const [cx0, cy0] = centerOf(area);
    const info = dest === 'to_hand' ? ['🖐', '手札', '#4ad8ff', 'HAND!'] : dest === 'to_deck' ? ['🂠', 'デッキ', '#a8ff4a', 'DECK!'] : dest === 'to_security' ? ['🛡', 'セキュリティ', '#ffd84a', 'SECURITY!'] : ['🗑', 'トラッシュ', '#ff4d4d', 'TRASH!'];
    const { b, bx, by, vortex } = binAt(dir, info[0], info[1], info[2]);
    const fire = dest === 'trash' ? ['#ffffff', '#ffe27a', '#ff9a00', '#ff4d1f', '#ff2a2a'] : ['#ffffff', info[2], info[2], '#ffffff'];
    // 発射の爆発
    flashAt(cx0, cy0, 0.85, 'rgba(255,120,60,0.7)');
    ringsAt(cx0, cy0, ['#ffffff', fire[2]], 60);
    sparksAt(cx0, cy0, 45, 1.4, fire);
    shake('fcShake', 300);
    // 飛んでいる間、カードの位置から燃える尾を出す
    let trailOn = true;
    const trail = () => {
      if (!trailOn) return;
      const r = area.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (let i = 0; i < 2; i++) {
        if (ps.length < 420) ps.push({ x: x + (Math.random() - 0.5) * 24, y: y + (Math.random() - 0.5) * 24, vx: (Math.random() - 0.5) * 2 - dir * 1.5, vy: (Math.random() - 0.5) * 2 - 1, life: 0, max: 18 + Math.random() * 16, len: 3 + Math.random() * 4, c: fire[(Math.random() * fire.length) | 0] });
      }
      requestAnimationFrame(trail);
    };
    requestAnimationFrame(trail);
    const im = area.querySelector('[id$="card-img"]');
    if (im) { im.style.transition = 'box-shadow 0.2s, filter 0.2s'; im.style.boxShadow = '0 0 30px ' + fire[3] + ',0 0 60px ' + fire[2]; im.style.filter = 'brightness(1.3) saturate(1.3)'; }
    // ① 大きくはね上がりながら高速回転
    area.style.transition = 'transform 0.65s cubic-bezier(.12,.85,.3,1), opacity 0.65s';
    area.style.transform = 'translate(' + (dir * W * 0.26) + 'px,' + (-H * 0.2) + 'px) rotate(' + (dir * 540) + 'deg) scale(0.85)';
    // ② 渦へ急降下して吸い込まれる
    setTimeout(() => {
      area.style.transition = 'transform 0.7s cubic-bezier(.65,0,.95,.55), opacity 0.7s';
      area.style.transform = 'translate(' + (bx - cx0) + 'px,' + (by - cy0) + 'px) rotate(' + (dir * 1260) + 'deg) scale(0.1)';
      area.style.opacity = '0.3';
    }, 700);
    // ③ 着弾: 爆発・衝撃波・揺れ・「TRASH!」
    setTimeout(() => {
      trailOn = false;
      area.style.opacity = '0';
      b.style.animation = 'fcBinHit 0.45s ease-out';
      flashAt(bx, by, 1, 'rgba(255,90,60,0.8)');
      ringsAt(bx, by, ['#ffffff', fire[2], fire[4] || fire[1]], 70);
      sparksAt(bx, by, 70, 1.5, fire);
      shake('fcShake', 420);
      for (let i = 0; i < 16; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, d = 50 + Math.random() * 90;
        const sz = 8 + Math.random() * 14;
        const sm = el('position:absolute;left:' + bx + 'px;top:' + by + 'px;width:' + sz + 'px;height:' + sz + 'px;margin:-' + sz / 2 + 'px;border-radius:50%;background:radial-gradient(circle,rgba(255,190,120,0.85),rgba(80,30,20,0));--dx:' + Math.cos(ang) * d + 'px;--dy:' + Math.sin(ang) * d + 'px;--r:0deg;animation:fcPiece ' + (0.5 + Math.random() * 0.5) + 's ease-out forwards;');
        setTimeout(() => sm.remove(), 1100);
      }
      const tl = el('position:absolute;left:' + bx + 'px;top:' + (by - 70) + 'px;white-space:nowrap;font-size:' + Math.min(30, W * 0.07) + 'px;font-weight:900;font-style:italic;color:#fff;text-shadow:0 0 10px ' + info[2] + ',0 0 24px ' + info[2] + ',0 0 3px #000;animation:fcLabel 0.45s ease-out forwards;z-index:3;', info[3]);
      setTimeout(() => { vortex.style.transition = 'opacity 0.4s'; vortex.style.opacity = '0'; }, 500);
      void tl;
      after && after({ b, bx, by, cx0, cy0 });
    }, 1400);
  };
  // 小さなカード（裏向き or 画像）を飛ばす（身代わり・進化元・リンク・セキュリティ）
  const miniCard = (x, y, img, border) => el('position:absolute;left:' + (x - 30) + 'px;top:' + (y - 42) + 'px;width:60px;height:84px;border-radius:5px;border:2px solid ' + border + ';box-shadow:0 0 14px ' + border + ';background:' + (img ? 'url(' + img + ') center/cover' : 'linear-gradient(135deg,#1b2a4a,#0b1020)') + ';z-index:2;transition:transform 0.5s cubic-bezier(.15,.8,.35,1),opacity 0.5s;',
    img ? '' : '<div style="position:absolute;inset:6px;border:1px solid ' + border + '88;border-radius:3px;"></div>');
  const imgOf = (area) => { const i = area.querySelector('img'); return i ? i.src : ''; };

  let curSubs = {}, curSwap = {};
  const playOne = (side, kind, area, dir) => {
    const subs = curSubs[side] || [];
    // 【アーマー解除】: VS画面のカードを、下から出てくるカード（残るデジモン）の画像に差し替える（庇うカード＝破棄した一番上のカード）
    if (curSwap[side]) { const _ci = area.querySelector('[id$="card-img"] img'); if (_ci) _ci.src = curSwap[side]; }
    const [cx, cy] = centerOf(area);
    const hitX = cx - dir * 30; // 衝撃が来る側
    const lbl = (t, c) => label(cx, cy - 110, t, c);
    switch (kind) {
      case 'trash': blowTo(area, dir, 'trash'); return 2000;
      case 'to_hand': case 'to_deck': case 'to_security': lbl(_CLASH_KW_LABEL[kind], '#4ad8ff'); blowTo(area, dir, kind); return 2000;
      case 'indomitable': {
        lbl(_CLASH_KW_LABEL.indomitable, '#ff9a00');
        blowTo(area, dir, 'trash', ({ b, bx, by, cx0, cy0 }) => {
          setTimeout(() => {
            // トラッシュから光の柱と一緒に戻ってくる
            const pillar = el('position:absolute;left:' + cx0 + 'px;top:0;height:' + H + 'px;width:140px;transform-origin:center bottom;background:linear-gradient(to right,rgba(255,200,80,0) 0%,rgba(255,240,170,0.9) 45%,#fff 50%,rgba(255,240,170,0.9) 55%,rgba(255,200,80,0) 100%);animation:fcRevive 0.9s ease-out forwards;');
            setTimeout(() => pillar.remove(), 1000);
            b.style.animation = 'fcBinHit 0.4s ease-out';
            area.style.transition = 'none';
            area.style.transform = 'translate(' + (bx - cx0) + 'px,' + (by - cy0) + 'px) scale(0.1)';
            area.style.opacity = '0';
            requestAnimationFrame(() => requestAnimationFrame(() => {
              area.style.transition = 'transform 0.6s cubic-bezier(.2,.9,.3,1.3), opacity 0.4s';
              area.style.transform = 'translate(0,0) scale(1.05)';
              area.style.opacity = '1';
              const im = area.querySelector('[id$="card-img"]');
              if (im) { im.style.filter = ''; im.style.boxShadow = '0 0 40px #ffb000,0 0 80px #ff6a00'; }
            }));
            sparksAt(cx0, cy0, 80, 1, ['#ffd84a', '#ffffff', '#ff9a00']);
            label(cx0, cy0 - 110, '復活！', '#ff9a00');
          }, 250);
        });
        return 3000;
      }
      case 'evade': {
        lbl(_CLASH_KW_LABEL.evade, '#00fbff');
        // 残像を残して横に避ける
        for (let i = 1; i <= 3; i++) {
          const ghost = area.cloneNode(true);
          const r = area.getBoundingClientRect();
          ghost.style.cssText += ';position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;margin:0;opacity:' + (0.5 - i * 0.12) + ';transition:transform 0.3s ease-out,opacity 0.5s;pointer-events:none;';
          fx.appendChild(ghost);
          requestAnimationFrame(() => { ghost.style.transform = 'translate(' + (-dir * 22 * i) + 'px,' + (-30 * i) + 'px)'; ghost.style.opacity = '0'; });
          setTimeout(() => ghost.remove(), 700);
        }
        area.style.transition = 'transform 0.25s cubic-bezier(.2,.9,.3,1)';
        area.style.transform = 'translate(' + (dir * 70) + 'px,-60px) rotate(' + (dir * 12) + 'deg)';
        sparksAt(hitX, cy, 30, 0.8, ['#7ff6ff', '#ffffff']);
        setTimeout(() => { area.style.transition = 'transform 0.4s ease-in-out'; area.style.transform = 'translate(0,0)'; }, 700);
        return 1300;
      }
      case 'armor_break': {
        lbl(_CLASH_KW_LABEL.armor_break, '#a8ff4a');
        // 一番上のカード（このカード自身）がはがれ、下のカード（残るデジモン。VS画面の画像は差し替え済み）が見えた状態で、
        // はがれたカードがトラッシュへ飛ぶ
        const im0 = area.querySelector('[id$="card-img"]');
        const rr = (im0 || area).getBoundingClientRect();
        const topImg = (subs && subs[0]) || '';
        const nameOnly = topImg.indexOf('name:') === 0 ? topImg.slice(5) : null;
        const peel = el('position:absolute;left:' + rr.left + 'px;top:' + rr.top + 'px;width:' + rr.width + 'px;height:' + rr.height + 'px;border-radius:10px;overflow:hidden;border:2px solid #a8ff4a;box-shadow:0 0 18px #a8ff4a;background:' + (topImg && nameOnly == null ? 'url(' + topImg + ') center/cover' : 'linear-gradient(160deg,#3a3a48,#16161e)') + ';z-index:3;will-change:transform;transform-origin:' + (dir < 0 ? 'right' : 'left') + ' bottom;transition:transform 0.45s cubic-bezier(.3,.7,.3,1);',
          nameOnly != null ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:6px;text-align:center;font-size:12px;font-weight:bold;color:#fff;">' + nameOnly + '</div>' : '');
        // ① 衝撃を受けて、めくれるように持ち上がる（下のカードが見える）
        setTimeout(() => {
          flashAt(hitX, cy, 0.7); sparksAt(hitX, cy, 40, 1.1, ['#a8ff4a', '#ffffff', '#ff9a00']);
          peel.style.transform = 'translate(' + (dir * 26) + 'px,-46px) rotate(' + (dir * 18) + 'deg)';
          area.style.transition = 'transform 0.3s cubic-bezier(.2,.9,.3,1.3)';
          area.style.transform = 'translateX(' + (dir * 8) + 'px)';
        }, 350);
        // ② はがれたカードが吹き飛ばされてトラッシュへ
        setTimeout(() => { peel.style.transition = ''; blowTo(peel, dir, 'trash'); }, 950);
        return 950 + 2000;
      }
      case 'barrier': case 'fragment': case 'separate': case 'scapegoat': {
        const colorOf = { barrier: '#ffd84a', scapegoat: '#ff8adf' };
        const bc = colorOf[kind] || '#a8ff4a';
        lbl(_CLASH_KW_LABEL[kind], bc);
        // 庇うカード（破棄したセキュリティ・進化元・リンクカード・身代わりのデジモン）を、守られるカードと同じ大きさで
        // 前に割り込ませ、一撃を受けて吹き飛ばされトラッシュへ。画像が分からなければ裏向きのカード
        const im0 = area.querySelector('[id$="card-img"]');
        const rr = (im0 || area).getBoundingClientRect();
        const GW = rr.width || 110, GH = rr.height || 154;
        const imgs = (subs && subs.length) ? subs.slice(0, 3) : [''];
        const backUrl = (typeof window !== 'undefined' && window._cardBackUrl) || '';
        const guards = imgs.map((im, i) => {
          const gx = rr.left + rr.width / 2 - dir * (34 + i * 10), gy = rr.top + rr.height / 2 + i * 8;
          // 'name:〇〇' は画像の無いカード（テスト画面のダミーカード等）: 名前を書いた表向きのカードにする
          const nameOnly = typeof im === 'string' && im.indexOf('name:') === 0 ? im.slice(5) : null;
          const src = nameOnly != null ? '' : (im || backUrl);
          const inner = nameOnly != null ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:6px;text-align:center;font-size:12px;font-weight:bold;color:#fff;background:linear-gradient(160deg,#3a3a48,#16161e);">' + nameOnly + '</div>'
            : (!im && kind === 'scapegoat') ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;color:#ffd0f0;text-shadow:0 0 4px #000;">身代わり</div>' : '';
          const gEl = el('position:absolute;left:' + (gx - GW / 2) + 'px;top:' + (gy - GH / 2) + 'px;width:' + GW + 'px;height:' + GH + 'px;border-radius:10px;overflow:hidden;border:2px solid ' + bc + ';box-shadow:0 0 22px ' + bc + ',0 0 44px ' + bc + '66;background:' + (src ? 'url(' + src + ') center/cover' : 'linear-gradient(135deg,#1b2a4a,#0b1020)') + ';z-index:3;will-change:transform,opacity;opacity:0;transform:translate(' + (dir * 40) + 'px,60px) scale(0.5);transition:transform 0.35s cubic-bezier(.2,.9,.3,1.2),opacity 0.25s;',
            inner);
          setTimeout(() => { gEl.style.opacity = '1'; gEl.style.transform = 'translate(0,0) scale(1.04)'; }, 40 + i * 120);
          return gEl;
        });
        const hitAt = 520 + imgs.length * 120;
        setTimeout(() => {
          flashAt(hitX, cy, 0.8); sparksAt(hitX, cy, 50, 1.2, [bc, '#ffffff', '#ff9a00']); ringsAt(hitX, cy, ['#ffffff', bc], 60);
          // 守られたカードは少し押されて踏みとどまる
          area.style.transition = 'transform 0.3s cubic-bezier(.2,.9,.3,1.3)';
          area.style.transform = 'translateX(' + (dir * 10) + 'px)';
          guards.forEach((gEl, i) => setTimeout(() => { gEl.style.transition = ''; blowTo(gEl, dir, 'trash'); }, i * 220));
        }, hitAt);
        return hitAt + 2000 + (imgs.length - 1) * 220;
      }
      case 'shield': {
        lbl(_CLASH_KW_LABEL.shield, '#4ad8ff');
        // バリア: 守られるカード全体を、六角形の模様が光るバリアが包む。相手の一撃がバリアの表面に当たって波紋が広がり、
        // はじき返す。守られたカードは残る
        const im0 = area.querySelector('[id$="card-img"]');
        const r = (im0 || area).getBoundingClientRect();
        const bW = r.width * 1.5, bH = r.height * 1.32;
        const bcx = r.left + r.width / 2, bcy = r.top + r.height / 2;
        const hex = "url(\"data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="48" viewBox="0 0 28 48"><path d="M14 0 L28 8 L28 24 L14 32 L0 24 L0 8 Z M14 32 L14 48" fill="none" stroke="rgba(200,245,255,0.55)" stroke-width="1.4"/></svg>') + "\")";
        const bubble = el('position:absolute;left:' + (bcx - bW / 2) + 'px;top:' + (bcy - bH / 2) + 'px;width:' + bW + 'px;height:' + bH + 'px;border-radius:50% / 46%;'
          + 'background:' + hex + ',radial-gradient(ellipse at 50% 45%,rgba(160,240,255,0.06) 0%,rgba(120,225,255,0.18) 55%,rgba(74,216,255,0.55) 100%);'
          + 'border:3px solid rgba(190,245,255,0.95);box-shadow:0 0 26px #4ad8ff,0 0 60px rgba(74,216,255,0.6),inset 0 0 36px rgba(120,230,255,0.75);'
          + 'transform:scale(0.2);opacity:0;transition:transform 0.38s cubic-bezier(.2,.9,.3,1.35),opacity 0.25s;z-index:4;will-change:transform,opacity;');
        requestAnimationFrame(() => { bubble.style.transform = 'scale(1)'; bubble.style.opacity = '1'; });
        sparksAt(bcx, bcy, 26, 0.8, ['#9ff2ff', '#ffffff']);
        // 一撃がバリアの表面（相手の側）に当たる
        const hx = bcx - dir * bW / 2, hy = bcy;
        setTimeout(() => {
          bubble.style.transition = 'filter 0.12s, transform 0.18s ease-out';
          bubble.style.filter = 'brightness(2.3)';
          bubble.style.transform = 'scale(0.94,1.04)';
          setTimeout(() => { bubble.style.filter = ''; bubble.style.transform = 'scale(1)'; }, 170);
          flashAt(hx, hy, 0.75, 'rgba(120,230,255,0.6)');
          ringsAt(hx, hy, ['#ffffff', '#9ff2ff', '#4ad8ff'], 46);
          sparksAt(hx, hy, 70, 1.2, ['#9ff2ff', '#ffffff', '#4ad8ff']);
          shake('fcShakeS', 260);
          // 攻撃してきた側（反対側のカード）はバリアにはじき返される
          const other = area === atkEl ? defEl : atkEl;
          other.style.transition = 'transform 0.3s cubic-bezier(.2,.9,.3,1.3)';
          other.style.transform = 'translateX(' + (-dir * 30) + 'px)';
        }, 450);
        // バリアの表面を光が走る（守り切った）
        setTimeout(() => { bubble.style.transition = 'filter 0.2s'; bubble.style.filter = 'brightness(1.7)'; setTimeout(() => { bubble.style.filter = ''; }, 200); }, 800);
        setTimeout(() => { bubble.style.transition = 'opacity 0.45s, transform 0.45s'; bubble.style.opacity = '0'; bubble.style.transform = 'scale(1.12)'; }, 1350);
        return 1800;
      }
      case 'recoil': {
        // 【道連れ】: ① 負けた側がトラッシュに入った直後に「【道連れ】」② トラッシュから黒いもやが伸びる
        // ③ もやが勝った側のカードの周りを渦巻いて包み込み、カードが黒く染まって震える ④ もやごとゆっくりトラッシュへ引きずり込む
        if (!document.getElementById('fx-michi-style')) {
          const st = document.createElement('style');
          st.id = 'fx-michi-style';
          st.textContent = '@keyframes mzSpin{0%{transform:translate(-50%,-50%) rotate(0deg)}100%{transform:translate(-50%,-50%) rotate(360deg)}}'
            + '@keyframes mzPulse{0%,100%{opacity:0.85}50%{opacity:1}}'
            + '@keyframes mzLbl{0%{transform:translate(-50%,-50%) scale(1.8);opacity:0;filter:blur(6px)}50%{transform:translate(-50%,-50%) scale(0.95);opacity:1;filter:blur(0)}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}';
          document.head.appendChild(st);
        }
        const loserDir = -dir;
        const bxL = loserDir < 0 ? Math.max(56, W * 0.13) : Math.min(W - 56, W * 0.87), by = H - Math.max(80, H * 0.14);
        const T0 = 1450; // 負けた側がトラッシュに着くまで（blowTo の着弾）
        let aura = null, dim = null, big = null;
        // ①「【道連れ】」（画面中央に大きく）
        setTimeout(() => {
          dim = el('position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(25,0,40,0.35) 0%,rgba(8,0,16,0.8) 100%);opacity:0;transition:opacity 0.6s;z-index:1;');
          requestAnimationFrame(() => { dim.style.opacity = '1'; });
          big = el('position:absolute;left:50%;top:20%;white-space:nowrap;font-size:' + Math.min(48, W * 0.11) + 'px;font-weight:900;color:#e9c8ff;text-shadow:0 0 14px #9b3dff,0 0 34px #5a0099,0 0 3px #000;animation:mzLbl 0.6s ease-out forwards;z-index:7;', '💀【道連れ】');
        }, T0);
        // ② トラッシュから黒いもやが伸びて、カードへ向かう
        const [wx, wy] = centerOf(area);
        const r0 = (area.querySelector('[id$="card-img"]') || area).getBoundingClientRect();
        setTimeout(() => {
          for (let i = 0; i < 12; i++) {
            const t = i / 11, sz = 40 + Math.random() * 30;
            const px = bxL + (wx - bxL) * t + (Math.random() - 0.5) * 24, py = by + (wy - by) * t + (Math.random() - 0.5) * 24;
            const pf = el('position:absolute;left:' + (px - sz / 2) + 'px;top:' + (py - sz / 2) + 'px;width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;background:radial-gradient(circle,rgba(20,0,32,0.95) 0%,rgba(70,10,100,0.55) 50%,rgba(20,0,30,0) 72%);opacity:0;transform:scale(0.3);transition:opacity 0.35s ' + (i * 0.06) + 's,transform 0.5s ' + (i * 0.06) + 's;z-index:4;');
            requestAnimationFrame(() => { pf.style.opacity = '1'; pf.style.transform = 'scale(1)'; });
            setTimeout(() => { pf.style.transition = 'opacity 0.6s'; pf.style.opacity = '0'; setTimeout(() => pf.remove(), 650); }, 1700 + i * 40);
          }
        }, T0 + 500);
        // ③ カードの周りを渦巻いて包み込む（カードより一回り大きいもやの輪が回る）
        setTimeout(() => {
          const AW = r0.width * 2.1, AH = r0.height * 1.7;
          aura = el('position:absolute;left:' + wx + 'px;top:' + wy + 'px;width:0;height:0;z-index:5;');
          for (let i = 0; i < 2; i++) {
            const ring = document.createElement('div');
            ring.style.cssText = 'position:absolute;left:0;top:0;width:' + (AW * (1 - i * 0.18)) + 'px;height:' + (AH * (1 - i * 0.18)) + 'px;border-radius:50%;'
              + 'background:conic-gradient(from ' + (i * 90) + 'deg,rgba(15,0,25,0.95),rgba(80,15,120,0.55),rgba(15,0,25,0.95),rgba(60,0,90,0.4),rgba(15,0,25,0.95));'
              + '-webkit-mask:radial-gradient(ellipse,transparent 0 46%,#000 52% 66%,transparent 74%);mask:radial-gradient(ellipse,transparent 0 46%,#000 52% 66%,transparent 74%);'
              + 'animation:mzSpin ' + (1.4 - i * 0.4) + 's linear infinite' + (i ? ' reverse' : '') + ';opacity:0;transition:opacity 0.5s;';
            aura.appendChild(ring);
            requestAnimationFrame(() => { ring.style.opacity = '1'; });
          }
          // カードにかぶさる暗い膜
          const veil = document.createElement('div');
          veil.style.cssText = 'position:absolute;left:' + (-r0.width / 2) + 'px;top:' + (-r0.height / 2) + 'px;width:' + r0.width + 'px;height:' + r0.height + 'px;border-radius:10px;background:radial-gradient(ellipse,rgba(40,0,60,0.25) 0%,rgba(15,0,25,0.85) 100%);opacity:0;transition:opacity 0.8s;animation:mzPulse 0.8s ease-in-out infinite;';
          aura.appendChild(veil);
          requestAnimationFrame(() => { veil.style.opacity = '1'; });
          const im = area.querySelector('[id$="card-img"]');
          if (im) { im.style.transition = 'filter 0.8s, box-shadow 0.8s'; im.style.filter = 'brightness(0.5) saturate(0.4) hue-rotate(230deg)'; im.style.boxShadow = '0 0 36px #6a00a8'; }
          // 震える
          let n = 0;
          const sh = setInterval(() => { n++; area.style.transition = 'transform 0.07s'; area.style.transform = 'translate(' + ((Math.random() - 0.5) * 8) + 'px,' + ((Math.random() - 0.5) * 6) + 'px)'; if (n > 16) clearInterval(sh); }, 75);
        }, T0 + 1100);
        // ④ もやごとゆっくりトラッシュへ引きずり込む
        setTimeout(() => {
          const [cx1, cy1] = centerOf(area);
          const dx = bxL - cx1, dy = by - cy1;
          area.style.transition = 'transform 1.4s cubic-bezier(.55,0,.8,.45), opacity 1.4s';
          area.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (loserDir * 30) + 'deg) scale(0.1)';
          area.style.opacity = '0.15';
          if (aura) { aura.style.transition = 'transform 1.4s cubic-bezier(.55,0,.8,.45), opacity 1.4s'; aura.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.12)'; }
        }, T0 + 2700);
        // 吸い込まれて消える
        setTimeout(() => {
          area.style.opacity = '0';
          if (aura) aura.style.opacity = '0';
          flashAt(bxL, by, 0.55, 'rgba(120,40,160,0.6)');
          ringsAt(bxL, by, ['#b05cff', '#3a0050', '#ffffff'], 60);
          shake('fcShakeS', 280);
          if (big) { big.style.transition = 'opacity 0.5s'; big.style.opacity = '0'; }
          if (dim) dim.style.opacity = '0';
        }, T0 + 4150);
        return T0 + 4700;
      }
      default: return 0;
    }
  };

  const runFinish = (outcomes, cb) => {
    if (finished) { cb && cb(); return; }
    curSubs = (outcomes && outcomes._subs) || {};
    curSwap = (outcomes && outcomes._swap) || {};
    finished = true;
    const doFinish = () => {
      clearInterval(jitterTimer); holdSpark = false;
      if (glow) glow.remove();
      flashAt(ix, iy, 1); sparks(90, 1.6); ringsAt(ix, iy, ['#ffffff', '#ffd84a', '#ff6a00', '#ff3b3b'], 80); shake('fcShake', 450);
      const o = outcomes || {};
      let dur = 0;
      [['atk', atkEl, -1], ['def', defEl, 1]].forEach(([side, area, dir]) => {
        const kind = o[side] || 'stay';
        if (kind === 'win' || kind === 'stay' || kind === 'recoil') {
          // 勝った側（または負けていない側）は光って前へ
          setT(area, AT((side === 'atk' ? 1 : -1) * push * (kind === 'stay' ? 0.2 : 0.6), 0, kind === 'stay' ? 1 : 1.15), '0.35s cubic-bezier(.2,.9,.3,1.4)');
          const im = area.querySelector('[id$="card-img"]');
          if (im && kind !== 'stay') { im.style.transition = 'box-shadow 0.3s, border-color 0.3s'; im.style.borderColor = '#ffd84a'; im.style.boxShadow = '0 0 40px #ffd84a,0 0 90px #ff9a00'; }
          if (kind === 'recoil') dur = Math.max(dur, playOne(side, 'recoil', area, dir));
          return;
        }
        // 負けた側: 一旦もとの位置へはね返されてから、それぞれの演出
        setT(area, AT(dir * 18, dir * 6), '0.18s ease-out');
        dur = Math.max(dur, playOne(side, kind, area, dir));
      });
      // この画面の持ち主のバトルの勝ち負け
      const myResult = winner === 'tie' ? 'lose' : ((winner === 'atk') === !!myIsAtk ? 'win' : 'lose');
      setTimeout(() => {
        const big = document.createElement('div');
        const fs = Math.min(110, W * 0.24);
        if (myResult === 'win') {
          el('position:absolute;left:50%;top:42%;width:' + Math.min(R, 700) + 'px;height:' + Math.min(R, 700) + 'px;border-radius:50%;background:radial-gradient(circle,rgba(255,240,170,0.75) 0%,rgba(255,180,40,0.35) 35%,rgba(255,140,0,0) 65%);will-change:transform,opacity;animation:fcRays 1.4s ease-out forwards;');
          const cc = ['#ffd84a', '#ffffff', '#00ff88', '#7ff6ff', '#ff8adf'];
          for (let i = 0; i < 26; i++) {
            const ang = Math.random() * Math.PI * 2, d = 120 + Math.random() * R * 0.4;
            el('position:absolute;left:50%;top:42%;width:' + (5 + Math.random() * 6) + 'px;height:' + (8 + Math.random() * 8) + 'px;background:' + cc[i % cc.length] + ';border-radius:2px;--dx:' + Math.cos(ang) * d + 'px;--dy:' + (Math.sin(ang) * d + 90) + 'px;--r:' + (Math.random() * 720 - 360) + 'deg;animation:fcPiece ' + (1 + Math.random() * 0.6) + 's cubic-bezier(.1,.7,.3,1) forwards;');
          }
          big.style.cssText = 'position:absolute;left:50%;top:42%;white-space:nowrap;font-size:' + fs + 'px;font-weight:900;font-style:italic;letter-spacing:4px;background:linear-gradient(180deg,#ffffff 0%,#fff2a8 35%,#ffc300 60%,#ff8a00 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:2px rgba(255,190,60,0.9);animation:fcBig 0.55s cubic-bezier(.2,.9,.3,1) forwards;z-index:4;';
          big.innerText = 'WIN';
        } else {
          el('position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(120,0,0,0.15) 0%,rgba(80,0,0,0.75) 100%);animation:fcFlash 1.6s ease-out forwards;');
          for (let i = 0; i < 16; i++) {
            const ang = Math.random() * Math.PI * 2, d = 80 + Math.random() * 200, sz = 8 + Math.random() * 16;
            el('position:absolute;left:50%;top:42%;width:' + sz + 'px;height:' + sz + 'px;background:linear-gradient(135deg,rgba(255,120,120,0.9),rgba(120,0,0,0.6));clip-path:polygon(50% 0,100% 70%,20% 100%);--dx:' + Math.cos(ang) * d + 'px;--dy:' + (Math.sin(ang) * d + 140) + 'px;--r:' + (Math.random() * 540 - 270) + 'deg;animation:fcPiece 1.1s cubic-bezier(.3,.1,.7,1) 0.2s forwards;');
          }
          big.style.cssText = 'position:absolute;left:50%;top:42%;white-space:nowrap;font-size:' + fs + 'px;font-weight:900;font-style:italic;letter-spacing:4px;color:#ff4040;-webkit-text-stroke:2px rgba(60,0,0,0.8);text-shadow:0 0 18px #ff2020,0 0 40px #aa0000;animation:fcBigLose 0.7s ease-out forwards;z-index:4;';
          big.innerText = 'LOSE';
        }
        fx.appendChild(big);
      }, Math.min(950, dur));
      const total = Math.max(dur, 950) + 1300;
      setTimeout(() => { alive = false; fx.style.transition = 'opacity 0.25s'; fx.style.opacity = '0'; }, total);
      setTimeout(() => { fx.remove(); cb && cb(); }, total + 250);
    };
    // 押し合いは最低 MIN_HOLD は見せる
    const waited = performance.now() - holdStart;
    if (waited < MIN_HOLD) setTimeout(doFinish, MIN_HOLD - waited); else doFinish();
  };
  return {
    finish: (outcomes, cb) => { if (!holdStart) { pendingFinish = { o: outcomes, cb }; return; } runFinish(outcomes, cb); },
    // 演出の途中で強制的に終える（アタックが終わった等）
    close: () => { finished = true; alive = false; clearInterval(jitterTimer); try { fx.remove(); } catch (_) {} },
  };
}

// VS画面のカード枠を元に戻す（次の表示のため）
export function fxBattleClashReset(atkEl, defEl, vsEl) {
  [atkEl, defEl].forEach(el => {
    if (!el) return;
    el.style.transition = 'none'; el.style.transform = ''; el.style.opacity = '';
    el.querySelectorAll('[data-clash-fx]').forEach(d => d.remove());
    const img = el.querySelector('[id$="card-img"]');
    if (img) { img.style.filter = ''; img.style.animation = ''; img.style.borderColor = ''; img.style.boxShadow = ''; img.style.transition = 'opacity 0.3s'; }
  });
  if (vsEl) { vsEl.style.transition = 'none'; vsEl.style.opacity = ''; vsEl.style.transform = ''; }
}

// =====================================================
//  バトル結果（WIN / LOST）を大きく見せる。win: true=勝ち（金色の光線・紙吹雪）/ false=負け（赤い破片・揺れ）
//  戻り値: 後片付けの関数（表示を閉じるときに呼ぶ）
// =====================================================
export function fxBattleResultBurst(overlay, textEl, win) {
  if (typeof document === 'undefined' || !overlay || !textEl) return () => {};
  if (!document.getElementById('fx-bres-style')) {
    const st = document.createElement('style');
    st.id = 'fx-bres-style';
    st.textContent = [
      '@keyframes brSlam{0%{transform:scale(3.2);opacity:0;filter:blur(6px)}55%{transform:scale(0.92);opacity:1;filter:blur(0)}75%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}',
      '@keyframes brRays{0%{transform:translate(-50%,-50%) rotate(0deg) scale(0.4);opacity:0}20%{opacity:0.9}100%{transform:translate(-50%,-50%) rotate(60deg) scale(1.15);opacity:0.55}}',
      '@keyframes brLoseShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-6px,0)}40%{transform:translate(6px,0)}60%{transform:translate(-4px,0)}80%{transform:translate(3px,0)}}',
      '@keyframes brShard{0%{transform:translate(0,0) rotate(0deg);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}',
    ].join('');
    document.head.appendChild(st);
  }
  const extras = [];
  const add = (el) => { el.setAttribute('data-bres-fx', '1'); overlay.insertBefore(el, overlay.firstChild); extras.push(el); };
  const R = Math.max(window.innerWidth, window.innerHeight);
  if (win) {
    const rays = document.createElement('div');
    rays.style.cssText = 'position:absolute;left:50%;top:50%;width:' + R * 1.5 + 'px;height:' + R * 1.5 + 'px;border-radius:50%;pointer-events:none;background:repeating-conic-gradient(rgba(255,226,122,0.75) 0deg 5deg,rgba(255,226,122,0) 5deg 16deg);-webkit-mask:radial-gradient(circle,#000 0%,transparent 55%);mask:radial-gradient(circle,#000 0%,transparent 55%);animation:brRays 1.6s ease-out forwards;';
    add(rays);
    const cols = ['#ffd84a', '#ffffff', '#00ff88', '#7ff6ff', '#ff8adf'];
    for (let i = 0; i < 46; i++) {
      const p = document.createElement('div');
      const ang = Math.random() * Math.PI * 2, d = 120 + Math.random() * R * 0.4;
      p.style.cssText = 'position:absolute;left:50%;top:50%;width:' + (5 + Math.random() * 6) + 'px;height:' + (8 + Math.random() * 8) + 'px;background:' + cols[i % cols.length] + ';border-radius:2px;pointer-events:none;--dx:' + Math.cos(ang) * d + 'px;--dy:' + (Math.sin(ang) * d + 80) + 'px;--r:' + (Math.random() * 720 - 360) + 'deg;animation:brShard ' + (1 + Math.random() * 0.6) + 's cubic-bezier(.1,.7,.3,1) forwards;';
      add(p);
    }
    textEl.style.fontSize = 'clamp(3rem,16vw,5.5rem)';
    textEl.style.background = 'linear-gradient(180deg,#ffffff 0%,#fff2a8 35%,#ffc300 60%,#ff8a00 100%)';
    textEl.style.webkitBackgroundClip = 'text'; textEl.style.backgroundClip = 'text'; textEl.style.color = 'transparent';
    textEl.style.textShadow = 'none'; textEl.style.filter = 'drop-shadow(0 0 12px #ffb000) drop-shadow(0 0 30px #ff6a00)';
  } else {
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('div');
      const ang = Math.random() * Math.PI * 2, d = 80 + Math.random() * 220, sz = 8 + Math.random() * 18;
      s.style.cssText = 'position:absolute;left:50%;top:50%;width:' + sz + 'px;height:' + sz + 'px;background:linear-gradient(135deg,rgba(255,120,120,0.9),rgba(120,0,0,0.6));clip-path:polygon(50% 0,100% 70%,20% 100%);pointer-events:none;--dx:' + Math.cos(ang) * d + 'px;--dy:' + (Math.sin(ang) * d + 140) + 'px;--r:' + (Math.random() * 540 - 270) + 'deg;animation:brShard 1.1s cubic-bezier(.3,.1,.7,1) 0.15s forwards;';
      add(s);
    }
    textEl.style.fontSize = 'clamp(2.8rem,14vw,4.8rem)';
  }
  textEl.style.fontStyle = 'italic';
  textEl.style.transition = 'none';
  textEl.style.opacity = '1';
  textEl.style.animation = win ? 'brSlam 0.55s cubic-bezier(.2,.9,.3,1) forwards' : 'brSlam 0.5s ease-out forwards, brLoseShake 0.4s linear 0.5s';
  return () => {
    extras.forEach(e => e.remove());
    ['fontStyle', 'fontSize', 'background', 'webkitBackgroundClip', 'backgroundClip', 'filter', 'animation'].forEach(k => { textEl.style[k] = ''; });
    textEl.style.transition = 'opacity 0.3s, transform 0.3s'; // battle.html の元の指定に戻す
  };
}


// =====================================================
//  セキュリティへ置く／セキュリティからトラッシュへ送る専用の演出（通常の移動演出より丁寧に見せる）
//  mode 'in' : 場（バトルエリア/テイマーエリア）のカードが表向きで持ち上がり、弧を描いてセキュリティの束へ。途中で裏返り
//              （表向きで置くときはそのまま）、束の上（または下）に入って枚数が +1 になる
//  mode 'out': セキュリティの束の一番上（または下）のカードが抜け出し、めくれて表になって名前を見せ、トラッシュへ飛び込む
//  opts: { opp: 相手のカードか, bottom: 下か, faceUp: 表向きで置くか, fromZone: 'バトルエリア'|'テイマーエリア', secCount: 置く前/送る前の枚数 }
// =====================================================
export function fxSecurityMove(card, mode, opts, callback) {
  opts = opts || {};
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  if (!document.getElementById('fx-secmove-style')) {
    const st = document.createElement('style');
    st.id = 'fx-secmove-style';
    st.textContent = [
      '@keyframes smGlow{0%,100%{box-shadow:0 0 14px var(--c),0 0 28px var(--c)}50%{box-shadow:0 0 26px #fff,0 0 50px var(--c)}}',
      '@keyframes smPlus{0%{opacity:0;transform:translate(-50%,6px) scale(0.6)}25%{opacity:1;transform:translate(-50%,0) scale(1.15)}100%{opacity:0;transform:translate(-50%,-30px) scale(1)}}',
      '@keyframes smRing{0%{transform:translate(-50%,-50%) scale(0.3);opacity:1}100%{transform:translate(-50%,-50%) scale(2.6);opacity:0}}',
      '@keyframes smEmber{0%{transform:translate(0,0);opacity:1}100%{transform:translate(var(--dx),var(--dy));opacity:0}}',
      '@keyframes smIn{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}',
    ].join('');
    document.head.appendChild(st);
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const pre = opts.opp ? '相手の' : '';
  const SEC = '#b47cff', TRASH = '#ff5566', FIELD = '#ffd84a';
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:66000;background:rgba(0,0,0,0.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none;opacity:0;transition:opacity 0.25s;';
  const nm = card && card.name ? '「' + esc(card.name) + '」を' : '';
  const where = mode === 'in' ? (pre + 'セキュリティの' + (opts.bottom ? '下' : '上') + 'に置く') : (pre + 'セキュリティから' + pre + 'トラッシュに送る');
  const showName = mode === 'out' || opts.faceUp || mode === 'in'; // 場のカードは公開情報なので置く前は名前を出す
  ov.innerHTML = '<div style="font-size:16px;font-weight:900;color:#fff;text-align:center;padding:0 14px;text-shadow:0 0 10px ' + (mode === 'in' ? SEC : TRASH) + ',0 0 22px ' + (mode === 'in' ? SEC : TRASH) + ';animation:smIn 0.3s ease-out;">'
    + (mode === 'in' ? '🛡 ' : '🗑 ') + (showName ? nm : '') + esc(where) + '</div>';
  const SW = Math.min(330, window.innerWidth - 32), SH = 200;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:' + SW + 'px;height:' + SH + 'px;';
  ov.appendChild(stage);
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  const CW = 80, CH = 112;
  const leftX = 8, rightX = SW - CW - 18, topY = 30;
  const back = (window._cardBackUrl || '');
  const img = card ? (card.imgSrc || cardImg(card)) : '';
  const faceHtml = (img ? '<img src="' + img + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;font-size:10px;padding:6px;">' + esc(card && card.name) + '</div>');
  const backHtml = back ? '<img src="' + back + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#2a3c66,#0b1020);"></div>';
  const zoneLabel = (x, text, color) => {
    const l = document.createElement('div');
    l.style.cssText = 'position:absolute;left:' + (x + CW / 2) + 'px;top:' + (topY + CH + 34) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:bold;color:' + color + ';';
    l.innerText = text; stage.appendChild(l); return l;
  };
  const zoneBox = (x, color, icon) => {
    const z = document.createElement('div');
    z.style.cssText = 'position:absolute;left:' + (x - 6) + 'px;top:' + (topY - 6) + 'px;width:' + (CW + 12) + 'px;height:' + (CH + 30) + 'px;border-radius:10px;border:2px solid ' + color + '88;background:' + color + '12;box-shadow:inset 0 0 18px ' + color + '22;';
    z.innerHTML = '<div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:14px;opacity:0.8;">' + icon + '</div>';
    stage.appendChild(z); return z;
  };
  // セキュリティの束（裏向きのカードを少しずらして重ねる）
  const secX = mode === 'in' ? rightX : leftX;
  const n0 = Math.max(0, parseInt(opts.secCount, 10) || 0);
  const secBox = zoneBox(secX, SEC, '🛡');
  const shown = Math.min(5, Math.max(1, mode === 'out' ? n0 : n0));
  const stack = [];
  const stackPos = (i, total) => ({ x: secX + (total - 1 - i) * 3, y: topY + (total - 1 - i) * 3 }); // i=0 が一番上
  if (n0 > 0 || mode === 'out') {
    const total = mode === 'out' ? Math.max(1, Math.min(5, n0)) : Math.min(5, n0);
    for (let i = total - 1; i >= 0; i--) {
      const c = document.createElement('div');
      const p = stackPos(i, total);
      c.style.cssText = 'position:absolute;left:' + p.x + 'px;top:' + p.y + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:6px;overflow:hidden;border:1px solid ' + SEC + '88;box-shadow:0 2px 6px #000;transition:transform 0.3s, left 0.3s, top 0.3s;';
      c.innerHTML = backHtml;
      stage.appendChild(c); stack.unshift(c);
    }
  }
  void shown;
  const secLbl = zoneLabel(secX, pre + 'セキュリティ（' + n0 + '枚）', SEC);
  const plus = (x, text, color) => {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;left:' + (x + CW / 2) + 'px;top:' + (topY - 26) + 'px;font-size:18px;font-weight:900;color:' + color + ';text-shadow:0 0 10px ' + color + ';animation:smPlus 1s ease-out forwards;';
    p.innerText = text; stage.appendChild(p);
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;left:' + (x + CW / 2) + 'px;top:' + (topY + CH / 2) + 'px;width:80px;height:80px;border-radius:50%;border:3px solid ' + color + ';box-shadow:0 0 18px ' + color + ';animation:smRing 0.6s ease-out forwards;';
    stage.appendChild(r);
  };
  // 動かすカード（表と裏の2面。rotateY で裏返す）
  const mover = document.createElement('div');
  mover.style.cssText = 'position:absolute;left:0;top:0;width:' + CW + 'px;height:' + CH + 'px;z-index:5;transform-style:preserve-3d;transition:transform 0.5s cubic-bezier(.3,.7,.3,1);';
  const faceF = document.createElement('div'), faceB = document.createElement('div');
  const faceCss = 'position:absolute;inset:0;border-radius:6px;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
  faceF.style.cssText = faceCss + 'border:2px solid var(--c);--c:' + FIELD + ';animation:smGlow 0.9s ease-in-out infinite;';
  faceB.style.cssText = faceCss + 'transform:rotateY(180deg);border:2px solid ' + SEC + ';box-shadow:0 0 16px ' + SEC + ';';
  faceF.innerHTML = faceHtml; faceB.innerHTML = backHtml;
  mover.appendChild(faceF); mover.appendChild(faceB);
  const nameTag = document.createElement('div');
  nameTag.style.cssText = 'position:absolute;left:50%;top:' + (CH + 4) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:bold;color:#fff;text-shadow:0 0 4px #000;transition:opacity 0.3s;';
  nameTag.innerText = (card && card.name) || '';
  const pos = (x, y, rotY, sc, rotZ) => 'translate(' + x + 'px,' + y + 'px) rotateY(' + (rotY || 0) + 'deg) rotateZ(' + (rotZ || 0) + 'deg) scale(' + (sc || 1) + ')';

  if (mode === 'in') {
    zoneBox(leftX, FIELD, '⚔');
    zoneLabel(leftX, pre + (opts.fromZone || 'バトルエリア'), FIELD);
    mover.style.transition = 'none';
    mover.style.transform = pos(leftX, topY, 0, 1);
    mover.appendChild(nameTag);
    stage.appendChild(mover);
    const flipTo = opts.faceUp ? 0 : 180;
    // ① 持ち上がる
    setTimeout(() => { mover.style.transition = 'transform 0.35s ease-out'; mover.style.transform = pos(leftX, topY - 22, 0, 1.12, -4); }, 250);
    // ② 弧を描いて束の上へ（途中で裏返る）
    setTimeout(() => {
      nameTag.style.opacity = opts.faceUp ? '1' : '0';
      mover.style.transition = 'transform 0.75s cubic-bezier(.4,.1,.3,1)';
      mover.style.transform = pos((leftX + secX) / 2, topY - 46, flipTo / 2, 1.05, 4);
      setTimeout(() => { mover.style.transform = pos(secX, topY - 14, flipTo, 1.02, 0); }, 360);
    }, 650);
    // ③ 束に入る（上なら一番上に重なる・下なら束の下へ潜り込む）
    setTimeout(() => {
      if (opts.bottom) {
        stack.forEach((c) => { c.style.transform = 'translateY(-10px)'; });
        mover.style.transition = 'transform 0.4s ease-in-out';
        mover.style.zIndex = '0';
        mover.style.transform = pos(secX + Math.min(5, n0 + 1) * 3, topY + Math.min(5, n0 + 1) * 3, flipTo, 1, 0);
        setTimeout(() => stack.forEach((c) => { c.style.transform = ''; }), 380);
      } else {
        mover.style.transition = 'transform 0.3s cubic-bezier(.5,0,.8,.4)';
        mover.style.transform = pos(secX - 3, topY - 3, flipTo, 1, 0);
      }
      faceF.style.animation = '';
      secBox.style.boxShadow = '0 0 26px ' + SEC + ',inset 0 0 26px ' + SEC + '66';
      setTimeout(() => { plus(secX, '+1', SEC); secLbl.innerText = pre + 'セキュリティ（' + (n0 + 1) + '枚）'; }, 280);
    }, 1550);
    setTimeout(() => { ov.style.opacity = '0'; }, 2600);
    setTimeout(() => { ov.remove(); done(); }, 2850);
  } else {
    const trashBox = zoneBox(rightX, TRASH, '🗑');
    zoneLabel(rightX, pre + 'トラッシュ', TRASH);
    // 束の一番上（下）を動かすカードに置き換える
    const takeIdx = opts.bottom ? stack.length - 1 : 0;
    const startP = stack.length ? stackPos(takeIdx, stack.length) : { x: secX, y: topY };
    if (stack[takeIdx]) stack[takeIdx].remove();
    mover.style.transition = 'none';
    mover.style.transform = pos(startP.x, startP.y, 180, 1);
    stage.appendChild(mover);
    // ① 束から抜け出す
    setTimeout(() => { mover.style.transition = 'transform 0.35s ease-out'; mover.style.transform = pos(startP.x + 14, startP.y - 30, 180, 1.1); secLbl.innerText = pre + 'セキュリティ（' + Math.max(0, n0 - 1) + '枚）'; }, 250);
    // ② めくれて表になり、名前を見せる
    setTimeout(() => {
      mover.style.transition = 'transform 0.45s ease-in-out';
      mover.style.transform = pos((secX + rightX) / 2 - 10, topY - 40, 0, 1.25);
      mover.appendChild(nameTag); nameTag.style.opacity = '1';
    }, 650);
    // ③ トラッシュへ飛び込む
    setTimeout(() => {
      faceF.style.setProperty('--c', TRASH);
      mover.style.transition = 'transform 0.45s cubic-bezier(.6,0,.9,.5)';
      mover.style.transform = pos(rightX, topY, 0, 0.95, 8);
    }, 1450);
    setTimeout(() => {
      trashBox.style.boxShadow = '0 0 26px ' + TRASH + ',inset 0 0 26px ' + TRASH + '66';
      plus(rightX, '+1', TRASH);
      for (let i = 0; i < 12; i++) {
        const e = document.createElement('div');
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 30 + Math.random() * 50;
        e.style.cssText = 'position:absolute;left:' + (rightX + CW / 2) + 'px;top:' + (topY + CH / 2) + 'px;width:5px;height:5px;border-radius:50%;background:#ff8a5a;box-shadow:0 0 8px ' + TRASH + ';--dx:' + Math.cos(ang) * d + 'px;--dy:' + Math.sin(ang) * d + 'px;animation:smEmber 0.6s ease-out forwards;';
        stage.appendChild(e);
      }
    }, 1900);
    setTimeout(() => { ov.style.opacity = '0'; }, 2700);
    setTimeout(() => { ov.remove(); done(); }, 2950);
  }
  // 万一止まっても進むように
  setTimeout(done, 6000);
}
if (typeof window !== 'undefined') window._fxSecurityMove = fxSecurityMove;


// =====================================================
//  効果で消滅させられるときに回避した演出（全カード共通）
//  青い稲妻がそのカードに落ちる → カードが残像を残してよける。身代わり（【スケープゴート】【デコイ】等）なら、
//  身代わりのカードが割り込んで稲妻を受け、砕けてトラッシュへ
//  card: 消滅を回避したカード / opts: { label: '【回避】' 等, sub: '消滅しない' 等, substitute: 身代わりのカード, remote: 相手のカードか }
// =====================================================
export function fxEffectDodge(card, opts, callback) {
  opts = opts || {};
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  if (!document.getElementById('fx-dodge-style')) {
    const st = document.createElement('style');
    st.id = 'fx-dodge-style';
    st.textContent = [
      '@keyframes fdFlash{0%{opacity:0}10%{opacity:0.9}100%{opacity:0}}',
      '@keyframes fdBolt{0%{opacity:0}8%{opacity:1}20%{opacity:0.3}30%{opacity:1}55%{opacity:1}100%{opacity:0}}',
      '@keyframes fdLbl{0%{transform:translateX(-50%) scale(1.8);opacity:0}50%{transform:translateX(-50%) scale(0.95);opacity:1}100%{transform:translateX(-50%) scale(1);opacity:1}}',
      '@keyframes fdRing{0%{transform:translate(-50%,-50%) scale(0.2);opacity:1}100%{transform:translate(-50%,-50%) scale(3);opacity:0}}',
      '@keyframes fdShard{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}',
    ].join('');
    document.head.appendChild(st);
  }
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H * 0.55;
  const CW = Math.min(120, W * 0.3), CH = CW * 1.4;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:70500;background:rgba(0,4,20,0.78);pointer-events:none;overflow:hidden;opacity:0;transition:opacity 0.15s;';
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  const imgOf = (c) => c ? (c.imgSrc || cardImg(c) || '') : '';
  const mkCard = (c, x, color) => {
    const d = document.createElement('div');
    const src = imgOf(c);
    d.style.cssText = 'position:absolute;left:' + (x - CW / 2) + 'px;top:' + (cy - CH / 2) + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid ' + color + ';box-shadow:0 0 18px ' + color + ';background:#111;will-change:transform,opacity;transition:transform 0.28s cubic-bezier(.2,.9,.3,1),opacity 0.4s;';
    d.innerHTML = src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:12px;">' + ((c && c.name) || '') + '</div>';
    ov.appendChild(d); return d;
  };
  const subs = (Array.isArray(opts.substitute) ? opts.substitute : (opts.substitute ? [opts.substitute] : [])).slice(0, 3);
  const sub = subs.length ? subs[0] : null;
  const main = mkCard(card, sub ? cx + CW * 0.55 : cx, '#7fd8ff');
  // 代わりのカード（身代わりのデジモン・破棄する進化元等）。複数枚なら少しずつずらして重ねる
  const subEls = subs.map((sc, i) => {
    const e = mkCard(sc, cx - CW * 0.75 - i * 14, opts.subColor || '#ff8adf');
    e.style.opacity = '0'; e.style.transform = 'translate(-40px,30px) scale(0.7)'; e.style.zIndex = String(5 - i);
    return e;
  });
  const subEl = subEls[0] || null;
  // 稲妻（ギザギザの線を上から対象まで）
  // 攻撃（斬撃）が来る（効果での消滅と同じ攻撃）
  const bolt = (tx, ty) => { attackStrikeFx(ov, tx, ty, CW); };
  const label = () => {
    const t = document.createElement('div');
    t.style.cssText = 'position:absolute;left:50%;top:' + Math.max(16, cy - CH / 2 - 92) + 'px;transform:translateX(-50%);text-align:center;white-space:nowrap;animation:fdLbl 0.4s ease-out forwards;';
    t.innerHTML = '<div style="font-size:clamp(1.7rem,7.5vw,2.8rem);font-weight:900;color:#7fd8ff;text-shadow:0 0 16px #4aa8ff,0 0 3px #fff;">' + (opts.label || '回避！') + '</div>'
      + '<div style="font-size:clamp(0.85rem,3.4vw,1.1rem);color:#fff;text-shadow:0 0 6px #000;margin-top:4px;">' + (opts.remote ? '相手の' : '') + '「' + ((card && card.name) || '') + '」は' + (opts.sub || '消滅しない') + '</div>';
    ov.appendChild(t);
  };
  if (sub && opts.peel) {
    // 【アーマー解除】: 一番上のカード（sub）が下のカード（card）に重なっている。稲妻が落ちると一番上がはがれてトラッシュへ飛び、
    // 下のカードが残る
    main.style.left = (cx - CW / 2) + 'px';
    subEl.style.left = (cx - CW / 2) + 'px'; subEl.style.top = (cy - CH / 2) + 'px';
    subEl.style.transition = 'none'; subEl.style.opacity = '1'; subEl.style.transform = 'none'; subEl.style.zIndex = '6';
    subEl.style.borderColor = '#a8ff4a'; subEl.style.boxShadow = '0 0 18px #a8ff4a';
    setTimeout(() => {
      bolt(cx, cy);
      subEl.style.transformOrigin = 'right bottom';
      subEl.style.transition = 'transform 0.45s cubic-bezier(.3,.7,.3,1)';
      subEl.style.transform = 'translate(-30px,-50px) rotate(-18deg)';
    }, 450);
    setTimeout(() => {
      // トラッシュのアイコンへ回転しながら飛ぶ
      const bin = document.createElement('div');
      const bx = Math.max(56, W * 0.14), by = H - Math.max(80, H * 0.14);
      bin.style.cssText = 'position:absolute;left:' + bx + 'px;top:' + by + 'px;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:radial-gradient(circle,#ff4d4d55 0%,#0a0a0a 72%);border:3px solid #ff4d4d;box-shadow:0 0 24px #ff4d4d;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:28px;';
      bin.innerHTML = '🗑<div style="font-size:9px;font-weight:bold;">トラッシュ</div>';
      ov.appendChild(bin);
      const r = subEl.getBoundingClientRect();
      subEl.style.transition = 'transform 0.7s cubic-bezier(.6,0,.9,.6), opacity 0.7s';
      subEl.style.transform = 'translate(' + (bx - (r.left + r.width / 2)) + 'px,' + (by - (r.top + r.height / 2)) + 'px) rotate(-900deg) scale(0.12)';
      subEl.style.opacity = '0.3';
      setTimeout(() => { subEl.style.opacity = '0'; bin.style.transform = 'scale(1.25)'; bin.style.transition = 'transform 0.2s'; setTimeout(() => { bin.style.transform = ''; }, 200); }, 700);
      label();
    }, 1000);
  } else if (sub) {
    // 身代わりが割り込み、稲妻を受けて砕ける
    subEls.forEach((e, i) => setTimeout(() => { e.style.opacity = '1'; e.style.transform = 'translate(' + (CW * 0.45 + i * 14) + 'px,' + (i * 8) + 'px) scale(1.05)'; }, 200 + i * 110));
    setTimeout(() => {
      bolt(cx - CW * 0.3, cy);
      subEls.forEach((e) => { e.style.transition = 'filter 0.2s'; e.style.filter = 'brightness(2.2) saturate(0.4)'; });
    }, 600 + (subEls.length - 1) * 110);
    setTimeout(() => {
      const r = subEl.getBoundingClientRect();
      subEls.forEach((e) => e.remove());
      for (let i = 0; i < 12; i++) {
        const sh = document.createElement('div');
        const ang = Math.random() * Math.PI * 2, d = 60 + Math.random() * 140;
        sh.style.cssText = 'position:absolute;left:' + (r.left + r.width / 2) + 'px;top:' + (r.top + r.height / 2) + 'px;width:18px;height:24px;background:linear-gradient(135deg,#9fe0ff,#2a3c66);clip-path:polygon(50% 0,100% 70%,20% 100%);--dx:' + Math.cos(ang) * d + 'px;--dy:' + (Math.sin(ang) * d + 80) + 'px;--r:' + (Math.random() * 540) + 'deg;animation:fdShard 0.8s ease-out forwards;';
        ov.appendChild(sh);
      }
      label();
    }, 950 + (subEls.length - 1) * 110);
  } else {
    // 稲妻が落ちる直前に、残像を残して横によける
    setTimeout(() => {
      bolt(cx, cy);
      for (let i = 1; i <= 3; i++) {
        const g = main.cloneNode(true);
        g.style.opacity = String(0.5 - i * 0.13);
        ov.appendChild(g);
        requestAnimationFrame(() => { g.style.transition = 'transform ' + (0.18 + i * 0.05) + 's ease-out,opacity 0.45s'; g.style.transform = 'translateX(' + (CW * 0.3 * i) + 'px)'; g.style.opacity = '0'; });
        setTimeout(() => g.remove(), 600);
      }
      main.style.transform = 'translateX(' + (CW * 1.2) + 'px)';
    }, 350);
    setTimeout(() => { main.style.transition = 'transform 0.4s cubic-bezier(.3,.8,.3,1.2)'; main.style.transform = 'translateX(0)'; label(); }, 900);
  }
  setTimeout(() => { ov.style.opacity = '0'; }, 2300);
  setTimeout(() => { ov.remove(); done(); }, 2500);
  setTimeout(done, 5000);
}
if (typeof window !== 'undefined') window._fxEffectDodge = fxEffectDodge;


// =====================================================
//  【不屈】でトラッシュから戻ってくる演出:「【不屈】」→ トラッシュから光の柱が立ち、カードが昇ってくる →「復活！」
// =====================================================
export function fxIndomitableRevive(card, remote, callback) {
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  if (!document.getElementById('fx-revive-style')) {
    const st = document.createElement('style');
    st.id = 'fx-revive-style';
    st.textContent = [
      '@keyframes rvPillar{0%{transform:translateX(-50%) scaleY(0);opacity:0}25%{opacity:1}70%{transform:translateX(-50%) scaleY(1);opacity:1}100%{transform:translateX(-50%) scaleY(1);opacity:0}}',
      '@keyframes rvTitle{0%{transform:translate(-50%,0) scale(2);opacity:0}45%{transform:translate(-50%,0) scale(0.95);opacity:1}100%{transform:translate(-50%,0) scale(1);opacity:1}}',
      '@keyframes rvGlow{0%,100%{box-shadow:0 0 30px #ffb000,0 0 60px #ff6a00}50%{box-shadow:0 0 50px #fff,0 0 100px #ffb000}}',
      '@keyframes rvEmber{0%{transform:translate(0,0);opacity:1}100%{transform:translate(var(--dx),var(--dy));opacity:0}}',
    ].join('');
    document.head.appendChild(st);
  }
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H * 0.5;
  const CW = Math.min(120, W * 0.3), CH = CW * 1.4;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:66000;background:radial-gradient(ellipse at center,rgba(40,18,0,0.9) 0%,rgba(0,0,0,0.92) 70%);pointer-events:none;overflow:hidden;opacity:0;transition:opacity 0.25s;';
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  const add = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; ov.appendChild(d); return d; };
  // ①「【不屈】」
  const title = add('position:absolute;left:50%;top:' + Math.max(16, cy - CH / 2 - 110) + 'px;white-space:nowrap;font-size:clamp(2rem,9vw,3.2rem);font-weight:900;font-style:italic;color:#fff2c0;text-shadow:0 0 14px #ffb000,0 0 30px #ff6a00,0 0 3px #000;animation:rvTitle 0.45s ease-out forwards;',
    '【不屈】');
  // 下にトラッシュ
  const by = H - Math.max(80, H * 0.15);
  const bin = add('position:absolute;left:' + cx + 'px;top:' + by + 'px;width:80px;height:80px;margin:-40px 0 0 -40px;border-radius:50%;background:radial-gradient(circle,#ff4d4d55 0%,#0a0a0a 72%);border:3px solid #ff4d4d;box-shadow:0 0 24px #ff4d4d;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:28px;',
    '🗑<div style="font-size:9px;font-weight:bold;">トラッシュ</div>');
  // ② トラッシュから光の柱
  setTimeout(() => {
    add('position:absolute;left:' + cx + 'px;top:0;height:' + H + 'px;width:' + (CW * 1.8) + 'px;transform-origin:center bottom;background:linear-gradient(to right,rgba(255,200,80,0) 0%,rgba(255,240,170,0.85) 40%,#fff 50%,rgba(255,240,170,0.85) 60%,rgba(255,200,80,0) 100%);animation:rvPillar 1.4s ease-out forwards;');
    bin.style.transition = 'transform 0.25s'; bin.style.transform = 'scale(1.25)';
    for (let i = 0; i < 18; i++) {
      add('position:absolute;left:' + cx + 'px;top:' + by + 'px;width:6px;height:6px;border-radius:50%;background:#ffd84a;box-shadow:0 0 8px #ffb000;--dx:' + ((Math.random() - 0.5) * 160) + 'px;--dy:' + (-80 - Math.random() * H * 0.5) + 'px;animation:rvEmber ' + (0.8 + Math.random() * 0.7) + 's ease-out forwards;');
    }
  }, 500);
  // ③ カードが昇ってくる
  const src = card ? (card.imgSrc || cardImg(card) || '') : '';
  const c = add('position:absolute;left:' + (cx - CW / 2) + 'px;top:' + (cy - CH / 2) + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid #ffd84a;background:#111;opacity:0;transform:translateY(' + (by - cy) + 'px) scale(0.2);transition:transform 0.8s cubic-bezier(.2,.9,.3,1.15),opacity 0.4s;',
    src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:12px;">' + ((card && card.name) || '') + '</div>');
  setTimeout(() => { c.style.opacity = '1'; c.style.transform = 'translateY(0) scale(1.05)'; c.style.animation = 'rvGlow 0.9s ease-in-out 0.8s infinite'; bin.style.transform = ''; }, 800);
  // ④「復活！」
  setTimeout(() => {
    title.innerHTML = '復活！';
    title.style.animation = 'none'; void title.offsetWidth; title.style.animation = 'rvTitle 0.45s ease-out forwards';
    add('position:absolute;left:50%;top:' + (cy + CH / 2 + 16) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:13px;font-weight:bold;color:#ffe9a0;text-shadow:0 0 6px #000;',
      (remote ? '相手の' : '') + '「' + ((card && card.name) || '') + '」がトラッシュから登場');
  }, 1650);
  setTimeout(() => { ov.style.opacity = '0'; }, 2700);
  setTimeout(() => { ov.remove(); done(); }, 2950);
  setTimeout(done, 6000);
}
if (typeof window !== 'undefined') window._fxIndomitableRevive = fxIndomitableRevive;


// =====================================================
//  効果で消滅させる演出（全カード共通）: 青い稲妻が消滅するカードに落ち、カードが砕けてトラッシュへ行く。
//  複数体（「〜全てを消滅させる」等）はまとめて並べ、全員に稲妻が落ちる。
//  items: [{ card, remote }]（remote: 相手のカードか＝「相手のトラッシュ」）
// =====================================================
function _boltSvg(W, H, tx, ty) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.style.cssText = 'position:absolute;left:0;top:0;animation:fdBolt 0.6s ease-out forwards;pointer-events:none;';
  const mk = (w, color) => {
    const p = document.createElementNS(svgNS, 'polyline');
    let x = tx + (Math.random() - 0.5) * 60, y = -10; const pts = [x + ',' + y];
    const steps = 9;
    for (let i = 1; i <= steps; i++) { y = -10 + (ty + 10) * i / steps; x = (i === steps ? tx : tx + (Math.random() - 0.5) * 70 * (1 - i / steps)); pts.push(x + ',' + y); }
    p.setAttribute('points', pts.join(' ')); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linejoin', 'round');
    return p;
  };
  svg.appendChild(mk(12, 'rgba(80,170,255,0.45)'));
  svg.appendChild(mk(5, '#7fd8ff'));
  svg.appendChild(mk(2, '#ffffff'));
  return svg;
}
function _ensureBoltStyle() {
  if (document.getElementById('fx-bolt-style')) return;
  const st = document.createElement('style');
  st.id = 'fx-bolt-style';
  st.textContent = [
    '@keyframes fdFlash{0%{opacity:0}10%{opacity:0.9}100%{opacity:0}}',
    '@keyframes fdBolt{0%{opacity:0}8%{opacity:1}20%{opacity:0.3}30%{opacity:1}55%{opacity:1}100%{opacity:0}}',
    '@keyframes fdRing{0%{transform:translate(-50%,-50%) scale(0.2);opacity:1}100%{transform:translate(-50%,-50%) scale(3);opacity:0}}',
    '@keyframes fdShard{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}',
    '@keyframes fbLbl{0%{transform:translateX(-50%) scale(1.6);opacity:0}50%{transform:translateX(-50%) scale(0.96);opacity:1}100%{transform:translateX(-50%) scale(1);opacity:1}}',
    '@keyframes fbDome{0%{transform:translate(-50%,-50%) scale(0.3);opacity:0}40%{transform:translate(-50%,-50%) scale(1.08);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0.95}}',
  ].join('');
  document.head.appendChild(st);
}
export function fxBoltDestroy(items, callback) {
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  const list = (items || []).filter(it => it && it.card).slice(0, 8);
  if (typeof document === 'undefined' || !document.body || list.length === 0) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  _ensureBoltStyle();
  const W = window.innerWidth, H = window.innerHeight, cy = H * 0.45;
  const n = list.length;
  const CW = Math.min(110, (W - 40) / Math.max(1, n) - 10, W * 0.3), CH = CW * 1.4;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:66000;background:rgba(0,4,20,0.8);pointer-events:none;overflow:hidden;opacity:0;transition:opacity 0.15s;';
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  const add = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; ov.appendChild(d); return d; };
  const remoteAll = list.every(it => it.remote), ownAll = list.every(it => !it.remote);
  add('position:absolute;left:50%;top:' + Math.max(14, cy - CH / 2 - 70) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:clamp(1.3rem,6vw,2rem);font-weight:900;color:#cfeeff;text-shadow:0 0 14px #4aa8ff,0 0 3px #000;animation:fbLbl 0.4s ease-out forwards;',
    '⚡ ' + (n >= 2 ? n + '体を消滅！' : '消滅！'));
  // トラッシュ（下の中央）
  const by = H - Math.max(78, H * 0.13);
  const bin = add('position:absolute;left:50%;top:' + by + 'px;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;background:radial-gradient(circle,#ff4d4d55 0%,#0a0a0a 72%);border:3px solid #ff4d4d;box-shadow:0 0 22px #ff4d4d;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:28px;opacity:0;transition:opacity 0.3s, transform 0.2s;',
    '🗑<div style="font-size:9px;font-weight:bold;">' + (remoteAll ? '相手の' : ownAll ? '' : '') + 'トラッシュ</div>');
  const totalW = n * CW + (n - 1) * 12;
  const els = list.map((it, i) => {
    const x = W / 2 - totalW / 2 + i * (CW + 12) + CW / 2;
    const src = it.card.imgSrc || cardImg(it.card) || '';
    const d = add('position:absolute;left:' + (x - CW / 2) + 'px;top:' + (cy - CH / 2) + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid #7fd8ff;box-shadow:0 0 16px #4aa8ff;background:#111;will-change:transform,opacity,filter;transition:transform 0.3s, opacity 0.3s, filter 0.2s;',
      (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:11px;">' + (it.card.name || '') + '</div>')
      + '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);font-size:9px;color:' + (it.remote ? '#ff9a9a' : '#9fe0ff') + ';text-align:center;padding:1px;">' + (it.remote ? '相手の' : '') + (it.card.name || '') + '</div>');
    return { d, x };
  });
  // ① 稲妻が落ちる（少しずつずらして）
  els.forEach(({ d, x }, i) => setTimeout(() => {
    ov.appendChild(_boltSvg(W, H, x, cy));
    add('position:absolute;inset:0;background:radial-gradient(circle at ' + x + 'px ' + cy + 'px,rgba(200,235,255,0.9) 0%,rgba(80,170,255,0.45) 16%,rgba(0,0,0,0) 50%);animation:fdFlash 0.5s ease-out forwards;');
    add('position:absolute;left:' + x + 'px;top:' + cy + 'px;width:90px;height:90px;border-radius:50%;border:3px solid #7fd8ff;box-shadow:0 0 16px #4aa8ff;animation:fdRing 0.6s ease-out forwards;');
    d.style.filter = 'brightness(2.4) saturate(0.3)';
    d.style.transform = 'translate(' + ((Math.random() - 0.5) * 10) + 'px,4px)';
    setTimeout(() => { d.style.filter = 'grayscale(0.8) brightness(0.6)'; }, 220);
  }, 300 + i * 140));
  // ② 砕けてトラッシュへ
  const t2 = 300 + n * 140 + 450;
  setTimeout(() => {
    bin.style.opacity = '1';
    els.forEach(({ d, x }, i) => setTimeout(() => {
      for (let k = 0; k < 8; k++) {
        const ang = Math.random() * Math.PI * 2, dd = 30 + Math.random() * 70;
        add('position:absolute;left:' + x + 'px;top:' + cy + 'px;width:12px;height:16px;background:linear-gradient(135deg,#9fe0ff,#2a3c66);clip-path:polygon(50% 0,100% 70%,20% 100%);--dx:' + Math.cos(ang) * dd + 'px;--dy:' + (Math.sin(ang) * dd + 50) + 'px;--r:' + (Math.random() * 540) + 'deg;animation:fdShard 0.7s ease-out forwards;');
      }
      d.style.transition = 'transform 0.6s cubic-bezier(.6,0,.9,.6), opacity 0.6s';
      d.style.transform = 'translate(' + (W / 2 - x) + 'px,' + (by - cy) + 'px) rotate(' + ((i % 2 ? 1 : -1) * 540) + 'deg) scale(0.12)';
      d.style.opacity = '0.2';
      setTimeout(() => { d.style.opacity = '0'; bin.style.transform = 'scale(1.25)'; setTimeout(() => { bin.style.transform = ''; }, 180); }, 600);
    }, i * 120));
  }, t2);
  const tEnd = t2 + n * 120 + 900;
  setTimeout(() => { ov.style.opacity = '0'; }, tEnd);
  setTimeout(() => { ov.remove(); done(); }, tEnd + 250);
  setTimeout(done, tEnd + 4000);
}
if (typeof window !== 'undefined') window._fxBoltDestroy = fxBoltDestroy;

// 効果を受けない・「消滅しない」: 青い稲妻がバリアにはじかれる
export function fxBoltShield(card, opts, callback) {
  opts = opts || {};
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body || !card) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  _ensureBoltStyle();
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H * 0.55;
  const CW = Math.min(120, W * 0.3), CH = CW * 1.4;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:70500;background:rgba(0,4,20,0.78);pointer-events:none;overflow:hidden;opacity:0;transition:opacity 0.15s;';
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  const add = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; ov.appendChild(d); return d; };
  const src = card.imgSrc || cardImg(card) || '';
  add('position:absolute;left:' + (cx - CW / 2) + 'px;top:' + (cy - CH / 2) + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid #7fd8ff;box-shadow:0 0 18px #4aa8ff;background:#111;',
    src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:12px;">' + (card.name || '') + '</div>');
  // カード全体を包むバリア（六角形の模様）
  const bW = CW * 1.55, bH = CH * 1.32;
  const hex = "url(\"data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="48" viewBox="0 0 28 48"><path d="M14 0 L28 8 L28 24 L14 32 L0 24 L0 8 Z M14 32 L14 48" fill="none" stroke="rgba(200,245,255,0.55)" stroke-width="1.4"/></svg>') + "\")";
  const dome = add('position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + bW + 'px;height:' + bH + 'px;border-radius:50% / 46%;background:' + hex + ',radial-gradient(ellipse at 50% 45%,rgba(160,240,255,0.06) 0%,rgba(120,225,255,0.18) 55%,rgba(74,216,255,0.55) 100%);border:3px solid rgba(190,245,255,0.95);box-shadow:0 0 26px #4ad8ff,0 0 60px rgba(74,216,255,0.6),inset 0 0 36px rgba(120,230,255,0.75);opacity:0;transform:translate(-50%,-50%) scale(0.3);transition:filter 0.12s;');
  setTimeout(() => { dome.style.animation = 'fbDome 0.35s ease-out forwards'; }, 150);
  // 稲妻がバリアの上に落ちて、はじかれる
  const topY = cy - bH / 2;
  setTimeout(() => {
    attackStrikeFx(ov, cx, topY, CW); // 斬撃がバリアに当たってはじかれる
    dome.style.filter = 'brightness(2.2)';
    setTimeout(() => { dome.style.filter = ''; }, 160);
    // はじかれた火花（左右へ）
    for (let k = 0; k < 14; k++) {
      const ang = -Math.PI / 2 + (k % 2 ? 1 : -1) * (0.6 + Math.random() * 0.9), dd = 60 + Math.random() * 90;
      add('position:absolute;left:' + cx + 'px;top:' + topY + 'px;width:5px;height:5px;border-radius:50%;background:#bfeaff;box-shadow:0 0 8px #4aa8ff;--dx:' + Math.cos(ang) * dd + 'px;--dy:' + Math.sin(ang) * dd + 'px;--r:0deg;animation:fdShard 0.6s ease-out forwards;');
    }
  }, 550);
  setTimeout(() => {
    add('position:absolute;left:50%;top:' + Math.max(16, cy - bH / 2 - 92) + 'px;transform:translateX(-50%);text-align:center;white-space:nowrap;animation:fbLbl 0.4s ease-out forwards;',
      '<div style="font-size:clamp(1.6rem,7vw,2.6rem);font-weight:900;color:#7fd8ff;text-shadow:0 0 16px #4aa8ff,0 0 3px #fff;">' + (opts.label || '消滅しない！') + '</div>'
      + '<div style="font-size:clamp(0.85rem,3.4vw,1.1rem);color:#fff;text-shadow:0 0 6px #000;margin-top:4px;">' + (opts.remote ? '相手の' : '') + '「' + (card.name || '') + '」は' + (opts.sub || '消滅しない') + '</div>');
  }, 800);
  setTimeout(() => { ov.style.opacity = '0'; }, 2200);
  setTimeout(() => { ov.remove(); done(); }, 2450);
  setTimeout(done, 5000);
}
if (typeof window !== 'undefined') window._fxBoltShield = fxBoltShield;


// =====================================================
//  効果を受ける演出（全カード共通）
//  重い演出（画面中央）: destroy（斬撃を受けて砕け散る）/ hand（緑の渦に吸い込まれて手札へ）/ deck（光の鎖でデッキへ）/
//                       security（盾の紋章に包まれてセキュリティへ）/ dedigivolve（上から欠片になって剥がれ、下のカードが現れる）/
//                       evo_discard（進化元が下から引き抜かれてトラッシュへ）
//  軽い演出（盤面のカードの上）: rest / active / dp_minus / dp_plus / seal
// =====================================================
function _ensureHitStyle() {
  if (document.getElementById('fx-hit-style')) return;
  const st = document.createElement('style');
  st.id = 'fx-hit-style';
  st.textContent = [
    '@keyframes hxSlash{0%{transform:translate(-50%,-50%) rotate(var(--a)) scaleX(0);opacity:0}25%{opacity:1}55%{transform:translate(-50%,-50%) rotate(var(--a)) scaleX(1);opacity:1}100%{transform:translate(-50%,-50%) rotate(var(--a)) scaleX(1.05);opacity:0}}',
    '@keyframes hxFlash{0%{opacity:0}10%{opacity:0.95}100%{opacity:0}}',
    '@keyframes hxRing{0%{transform:translate(-50%,-50%) scale(0.2);opacity:1}100%{transform:translate(-50%,-50%) scale(3.2);opacity:0}}',
    '@keyframes hxShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-9px,5px)}40%{transform:translate(8px,-6px)}60%{transform:translate(-6px,-3px)}80%{transform:translate(4px,4px)}}',
    '@keyframes hxShard{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}',
    '@keyframes hxLbl{0%{transform:translateX(-50%) scale(1.6);opacity:0}50%{transform:translateX(-50%) scale(0.96);opacity:1}100%{transform:translateX(-50%) scale(1);opacity:1}}',
    '@keyframes hxSpin{0%{transform:translate(-50%,-50%) rotate(0deg)}100%{transform:translate(-50%,-50%) rotate(360deg)}}',
    '@keyframes hxRise{0%{transform:translate(-50%,0);opacity:0}20%{opacity:1}100%{transform:translate(-50%,-46px);opacity:0}}',
    '@keyframes hxFall{0%{transform:translate(-50%,0);opacity:0}20%{opacity:1}100%{transform:translate(-50%,40px);opacity:0}}',
    '@keyframes hxWave{0%{transform:translate(-50%,-50%) scale(0.4,0.15);opacity:0.9}100%{transform:translate(-50%,-50%) scale(1.6,0.5);opacity:0}}',
    '@keyframes hxBeam{0%{transform:translateX(-50%) scaleY(0);opacity:0}30%{opacity:0.9}100%{transform:translateX(-50%) scaleY(1);opacity:0}}',
    '@keyframes hxChain{0%{stroke-dashoffset:300}100%{stroke-dashoffset:0}}',
  ].join('');
  document.head.appendChild(st);
}
// 魔法攻撃（魔法陣が浮かび、光が集まり、魔力が炸裂する）。演出の「攻撃が来る」部分の共通部品（回避・バリアでも使う）。
// 当たる瞬間は呼んでから約0.2秒後（呼ぶ側はその時刻に合わせて揺れ・よける等を出す）
function _ensureMagicStyle() {
  if (document.getElementById('fx-magic-style')) return;
  const st = document.createElement('style');
  st.id = 'fx-magic-style';
  st.textContent = [
    '@keyframes mgCircle{0%{transform:translate(-50%,-50%) scale(0.2) rotate(0deg);opacity:0}35%{opacity:1}70%{transform:translate(-50%,-50%) scale(1) rotate(160deg);opacity:1}100%{transform:translate(-50%,-50%) scale(0.15) rotate(260deg);opacity:0}}',
    '@keyframes mgCircle2{0%{transform:translate(-50%,-50%) scale(0.2) rotate(0deg);opacity:0}35%{opacity:0.9}70%{transform:translate(-50%,-50%) scale(1) rotate(-200deg);opacity:0.9}100%{transform:translate(-50%,-50%) scale(0.1) rotate(-300deg);opacity:0}}',
    '@keyframes mgGather{0%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}30%{opacity:1}100%{transform:translate(0,0) scale(0.3);opacity:0.9}}',
    '@keyframes mgBurst{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(0.2);opacity:0}}',
    '@keyframes mgPillar{0%{transform:translateX(-50%) scaleX(0.1);opacity:0}25%{transform:translateX(-50%) scaleX(1);opacity:1}100%{transform:translateX(-50%) scaleX(0.05);opacity:0}}',
    '@keyframes mgSigil{0%{opacity:0;transform:scale(1.4) rotate(-30deg)}40%{opacity:1;transform:scale(1) rotate(0deg)}100%{opacity:0.85;transform:scale(1) rotate(25deg)}}',
  ].join('');
  document.head.appendChild(st);
}
const _MAGIC_SVG = (c1, c2) => '<svg viewBox="0 0 200 200" style="width:100%;height:100%;overflow:visible">'
  + '<circle cx="100" cy="100" r="94" fill="none" stroke="' + c1 + '" stroke-width="4"/>'
  + '<circle cx="100" cy="100" r="80" fill="none" stroke="' + c2 + '" stroke-width="2" stroke-dasharray="6 5"/>'
  + '<polygon points="100,20 169,140 31,140" fill="none" stroke="' + c1 + '" stroke-width="3"/>'
  + '<polygon points="100,180 31,60 169,60" fill="none" stroke="' + c1 + '" stroke-width="3"/>'
  + '<circle cx="100" cy="100" r="34" fill="none" stroke="' + c2 + '" stroke-width="3"/>'
  + [0, 45, 90, 135, 180, 225, 270, 315].map(a => '<rect x="96" y="2" width="8" height="12" fill="' + c2 + '" transform="rotate(' + a + ' 100 100)"/>').join('')
  + '</svg>';
// 攻撃の稲妻（ギザギザの線）を svg に描く
function _magicBoltLines(svg, x1, y1, x2, y2, amp, scale) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const pts = [];
  const steps = 10, nx = -(y2 - y1), ny = x2 - x1, len = Math.hypot(nx, ny) || 1;
  for (let q = 0; q <= steps; q++) {
    const t = q / steps, off = (q === 0 || q === steps) ? 0 : (Math.random() - 0.5) * amp * 2;
    pts.push((x1 + (x2 - x1) * t + nx / len * off).toFixed(1) + ',' + (y1 + (y2 - y1) * t + ny / len * off).toFixed(1));
  }
  [[13 * scale, 'rgba(150,90,255,0.4)'], [5 * scale, '#d9b8ff'], [2 * scale, '#ffffff']].forEach(([w, c]) => {
    const l = document.createElementNS(svgNS, 'polyline');
    l.setAttribute('points', pts.join(' ')); l.setAttribute('fill', 'none'); l.setAttribute('stroke', c); l.setAttribute('stroke-width', w);
    l.setAttribute('stroke-linejoin', 'round'); l.setAttribute('stroke-linecap', 'round');
    svg.appendChild(l);
  });
}
// 攻撃（全演出で共通）: 対象の上に紫の魔法陣が広がって魔力が集まり、魔法陣から稲妻が対象へ落ちる。
// 当たる時刻(ms)を返す（通常0.2秒・slow 1.55秒）。呼ぶ側はその時刻に合わせて揺れ・よける等を出す
export function attackStrikeFx(ov, x, y, size, slow) {
  _ensureHitStyle(); _ensureMagicStyle();
  const S = (size || 120) * 1.3;
  const D = slow ? 2.2 : 0.62;      // 魔法陣の表示時間(s)
  const GD = slow ? 0.9 : 0.24;     // 光が集まる時間(s)
  const GS = slow ? 0.55 : 0;       // 光が集まり始める時刻(s)
  const T = slow ? 1550 : 200;      // 稲妻が当たる時刻(ms)
  const B = slow ? 1.7 : 1;         // 当たったあとの演出の長さの倍率
  const W = window.innerWidth, H = window.innerHeight;
  // 魔法陣は対象の上（画面の上にはみ出さない）
  const mx = x, my = Math.max(S * 0.42 + 6, y - (size || 120) * 1.45);
  const add = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; ov.appendChild(d); return d; };
  // ① 魔法陣が2重に回りながら広がる
  add('position:absolute;left:' + mx + 'px;top:' + my + 'px;width:' + S + 'px;height:' + S + 'px;filter:drop-shadow(0 0 8px #b06cff) drop-shadow(0 0 18px #7a3dff);animation:mgCircle ' + D + 's ease-out forwards;z-index:9;', _MAGIC_SVG('#e3c8ff', '#8ff3ff'));
  add('position:absolute;left:' + mx + 'px;top:' + my + 'px;width:' + S * 0.62 + 'px;height:' + S * 0.62 + 'px;filter:drop-shadow(0 0 6px #6ff3ff);animation:mgCircle2 ' + D + 's ease-out forwards;z-index:9;', _MAGIC_SVG('#9ff6ff', '#e3c8ff'));
  // ② 光の粒が魔法陣の中心へ集まる
  for (let k = 0; k < 14; k++) {
    const ang = Math.random() * Math.PI * 2, dd = S * 0.6 + Math.random() * S * 0.5;
    add('position:absolute;left:' + mx + 'px;top:' + my + 'px;width:7px;height:7px;margin:-3px;border-radius:50%;background:#fff;box-shadow:0 0 8px #b06cff,0 0 14px #6ff3ff;--dx:' + Math.cos(ang) * dd + 'px;--dy:' + Math.sin(ang) * dd + 'px;animation:mgGather ' + GD + 's ease-in ' + (GS + Math.random() * (slow ? 0.25 : 0.06)) + 's forwards;opacity:0;z-index:9;');
  }
  // ③ 魔法陣から稲妻が放たれ、対象に落ちる（数回ちらつく）
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:10;';
  ov.appendChild(svg);
  const pre = slow ? 260 : 90; // 稲妻が伸びる時間
  setTimeout(() => {
    add('position:absolute;inset:0;background:radial-gradient(circle at ' + mx + 'px ' + my + 'px,rgba(255,255,255,0.8) 0%,rgba(190,130,255,0.45) 10%,rgba(0,0,0,0) 28%);animation:hxFlash ' + 0.4 * B + 's ease-out forwards;z-index:8;');
    const t0 = Date.now(), dur = pre + 380 * B;
    const tick = setInterval(() => {
      const el = Date.now() - t0;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (el >= dur) { clearInterval(tick); svg.remove(); return; }
      const k = Math.min(1, el / pre);
      const fade = el > pre ? Math.max(0.3, 1 - (el - pre) / (dur - pre)) : 1;
      [-0.3, 0, 0.3].forEach((o) => {
        const sx = mx + o * S * 0.35, ex = x + o * (size || 120) * 0.15;
        _magicBoltLines(svg, sx, my, sx + (ex - sx) * k, my + (y - my) * k, 16, fade);
      });
    }, 50);
  }, Math.max(0, T - pre));
  // ④ 当たった瞬間: 閃光・衝撃波・魔力の欠片が飛び散る
  setTimeout(() => {
    add('position:absolute;inset:0;background:radial-gradient(circle at ' + x + 'px ' + y + 'px,rgba(255,255,255,0.95) 0%,rgba(190,130,255,0.6) 14%,rgba(80,200,255,0.25) 28%,rgba(0,0,0,0) 48%);animation:hxFlash ' + 0.5 * B + 's ease-out forwards;z-index:8;');
    add('position:absolute;left:' + x + 'px;top:' + y + 'px;width:90px;height:90px;border-radius:50%;border:4px solid #e3c8ff;box-shadow:0 0 18px #b06cff,inset 0 0 12px #6ff3ff;animation:hxRing ' + 0.55 * B + 's ease-out forwards;z-index:8;');
    add('position:absolute;left:' + x + 'px;top:' + y + 'px;width:70px;height:70px;border-radius:50%;border:3px solid #8ff3ff;animation:hxRing ' + 0.7 * B + 's ease-out ' + 0.08 * B + 's forwards;opacity:0;z-index:8;');
    for (let k = 0; k < 16; k++) {
      const ang = Math.random() * Math.PI * 2, dd = 50 + Math.random() * 110;
      add('position:absolute;left:' + x + 'px;top:' + y + 'px;width:9px;height:9px;margin:-4px;transform-origin:center;clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);background:' + (k % 2 ? '#e3c8ff' : '#8ff3ff') + ';--dx:' + Math.cos(ang) * dd + 'px;--dy:' + Math.sin(ang) * dd + 'px;animation:mgBurst ' + 0.6 * B + 's ease-out forwards;z-index:9;');
    }
  }, T);
  return T;
}
if (typeof window !== 'undefined') window._attackStrikeFx = attackStrikeFx;

function _hitOverlay(z) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:' + (z || 66000) + ';background:rgba(4,4,16,0.8);pointer-events:none;overflow:hidden;opacity:0;transition:opacity 0.15s;';
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; });
  return ov;
}
function _hitCard(ov, card, x, y, CW, CH, border, label) {
  const src = card ? (card.imgSrc || cardImg(card) || '') : '';
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:' + (x - CW / 2) + 'px;top:' + (y - CH / 2) + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid ' + border + ';box-shadow:0 0 16px ' + border + ';background:#111;will-change:transform,opacity,filter;';
  d.innerHTML = (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:11px;">' + ((card && card.name) || '') + '</div>')
    + (label ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);font-size:9px;color:#fff;text-align:center;padding:1px;">' + label + '</div>' : '');
  ov.appendChild(d);
  return d;
}
function _hitTitle(ov, y, text, color) {
  const t = document.createElement('div');
  t.style.cssText = 'position:absolute;left:50%;top:' + y + 'px;transform:translateX(-50%);white-space:nowrap;font-size:clamp(1.3rem,6vw,2rem);font-weight:900;color:#fff;text-shadow:0 0 14px ' + color + ',0 0 3px #000;animation:hxLbl 0.4s ease-out forwards;';
  t.innerHTML = text;
  ov.appendChild(t);
  return t;
}
function _zoneIcon(ov, x, y, icon, text, color) {
  const b = document.createElement('div');
  b.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;background:radial-gradient(circle,' + color + '55 0%,#0a0a0a 72%);border:3px solid ' + color + ';box-shadow:0 0 22px ' + color + ';display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:28px;transition:transform 0.2s,opacity 0.3s;';
  b.innerHTML = icon + '<div style="font-size:9px;font-weight:bold;">' + text + '</div>';
  ov.appendChild(b);
  return b;
}
const _pulse = (b) => { b.style.transform = 'scale(1.25)'; setTimeout(() => { b.style.transform = ''; }, 180); };

// ---- 消滅: 魔法攻撃を受け、呪印が刻まれ、魔力の光を帯びて砕け散りトラッシュへ ----
export function fxImpactDestroy(items, callback) {
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  const list = (items || []).filter(it => it && it.card).slice(0, 8);
  if (typeof document === 'undefined' || !document.body || list.length === 0) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  _ensureHitStyle();
  const W = window.innerWidth, H = window.innerHeight, cy = H * 0.45, n = list.length;
  const CW = Math.min(110, (W - 40) / n - 10, W * 0.3), CH = CW * 1.4;
  const ov = _hitOverlay(66000);
  const remoteAll = list.every(it => it.remote);
  _hitTitle(ov, Math.max(14, cy - CH / 2 - 70), '🔮 ' + (n >= 2 ? n + '体を消滅！' : '消滅！'), '#b06cff');
  const by = H - Math.max(78, H * 0.13);
  const bin = _zoneIcon(ov, W / 2, by, '🗑', (remoteAll ? '相手の' : '') + 'トラッシュ', '#ff4d4d');
  bin.style.opacity = '0';
  const totalW = n * CW + (n - 1) * 12;
  const els = list.map((it, i) => {
    const x = W / 2 - totalW / 2 + i * (CW + 12) + CW / 2;
    return { d: _hitCard(ov, it.card, x, cy, CW, CH, '#c9a4ff', (it.remote ? '相手の' : '') + (it.card.name || '')), x, card: it.card };
  });
  // ① 斬撃を受ける（ヒットストップ・揺れ・ひび）
  const T = 1550; // 魔法攻撃が当たる時刻（attackStrikeFx の slow）
  const STEP = 450; // 複数体のときの1体ごとのずれ
  els.forEach(({ d, x }, i) => setTimeout(() => {
    attackStrikeFx(ov, x, cy, CW, true);
    setTimeout(() => {
      d.style.animation = 'hxShake 0.5s linear';
      d.style.filter = 'brightness(2.4) saturate(0.3)';
      d.style.boxShadow = '0 0 26px #b06cff,0 0 50px #7a3dff';
      setTimeout(() => {
        // 魔力に侵される: 紫に染まり、カードの上に呪印が刻まれて脈打つ
        d.style.transition = 'filter 0.7s';
        d.style.filter = 'brightness(0.8) saturate(0.7) hue-rotate(-40deg)';
        const sigil = document.createElement('div');
        sigil.style.cssText = 'position:absolute;left:10%;top:18%;width:80%;height:57%;pointer-events:none;filter:drop-shadow(0 0 4px #b06cff) drop-shadow(0 0 10px #b06cff);animation:mgSigil 1.1s ease-out forwards;';
        sigil.innerHTML = _MAGIC_SVG('#f0e0ff', '#8ff3ff');
        d.appendChild(sigil);
        const veil = document.createElement('div');
        veil.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle,rgba(176,108,255,0.15),rgba(122,61,255,0.55));mix-blend-mode:screen;';
        d.appendChild(veil);
      }, 300);
    }, T);
  }, 350 + i * STEP));
  // ② 呪印が刻まれた姿を少し見せてから、砕け散ってトラッシュへ（カードの絵の破片）
  const t2 = 350 + (n - 1) * STEP + T + 1500;
  setTimeout(() => {
    bin.style.opacity = '1';
    els.forEach(({ d, x, card }, i) => setTimeout(() => {
      const src = card.imgSrc || cardImg(card) || '';
      const r = d.getBoundingClientRect();
      d.style.opacity = '0';
      for (let k = 0; k < 12; k++) {
        const sx = (k % 3) / 3, sy = Math.floor(k / 3) / 4;
        const sh = document.createElement('div');
        const px = r.left + sx * r.width, py = r.top + sy * r.height;
        const toX = W / 2 - (px + r.width / 6), toY = by - (py + r.height / 8);
        sh.style.cssText = 'position:absolute;left:' + px + 'px;top:' + py + 'px;width:' + (r.width / 3) + 'px;height:' + (r.height / 4) + 'px;'
          + (src ? 'background:url(' + src + ') ' + (-sx * r.width) + 'px ' + (-sy * r.height) + 'px/' + r.width + 'px ' + r.height + 'px;' : 'background:#555;')
          + 'clip-path:polygon(' + (Math.random() * 30) + '% 0,100% ' + (Math.random() * 30) + '%,' + (70 + Math.random() * 30) + '% 100%,0 ' + (70 + Math.random() * 30) + '%);'
          + 'box-shadow:0 0 6px #b06cff;filter:drop-shadow(0 0 4px #b06cff);transition:transform 0.6s ease-out,opacity 0.4s;';
        ov.appendChild(sh);
        const ang = Math.random() * Math.PI * 2, dd = 40 + Math.random() * 70;
        requestAnimationFrame(() => { sh.style.transform = 'translate(' + Math.cos(ang) * dd + 'px,' + Math.sin(ang) * dd + 'px) rotate(' + (Math.random() * 180 - 90) + 'deg)'; });
        setTimeout(() => {
          sh.style.transition = 'transform 0.9s cubic-bezier(.6,0,.9,.6),opacity 0.9s';
          sh.style.transform = 'translate(' + toX + 'px,' + toY + 'px) rotate(' + (Math.random() * 720) + 'deg) scale(0.2)';
          sh.style.opacity = '0';
        }, 800 + k * 30);
      }
      setTimeout(() => _pulse(bin), 1900);
    }, i * 250));
  }, t2);
  const tEnd = t2 + (n - 1) * 250 + 2500;
  setTimeout(() => { ov.style.opacity = '0'; }, tEnd);
  setTimeout(() => { ov.remove(); done(); }, tEnd + 250);
  setTimeout(done, tEnd + 4000);
}
if (typeof window !== 'undefined') window._fxBoltDestroy = fxImpactDestroy; // 効果での消滅の演出をこちらに置き換え

// ---- 重い演出（1枚ずつ）: hand / deck / security / dedigivolve / evo_discard ----
// p: { card, remote, top(デッキの上か), after(退化後のカード), removed([退化・破棄したカード]), holder(進化元の持ち主) }
export function fxEffectHit(kind, p, callback) {
  p = p || {};
  // このカードの「いつもの移動演出」は出さない（効果を受ける演出で見せたので。window._fxCardMove / fx_remoteCardMove が見る）
  try {
    const now = Date.now();
    window._fxHitRecent = (window._fxHitRecent || []).filter(e => now - e.at < 8000);
    [p.card, p.after, p.holder].concat(p.removed || [], (p.cards || []).map(it => it && it.card)).filter(Boolean)
      .forEach(c => window._fxHitRecent.push({ card: c, name: c.name || '', at: now }));
  } catch (_) {}
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body || !p.card) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  _ensureHitStyle();
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H * 0.45;
  const CW = Math.min(120, W * 0.3), CH = CW * 1.4;
  const ov = _hitOverlay(66000);
  const pre = p.remote ? '相手の' : '';
  const nm = (p.card && p.card.name) || '';
  let total = 2200;
  if (kind === 'hand') {
    // 手札に戻す: 下に「手札」を表示し、カードが緑の渦に巻かれながら1枚ずつ手札へ吸い込まれる（複数でも1回の演出で順に）
    ov.innerHTML = '';
    const list = (Array.isArray(p.cards) && p.cards.length ? p.cards : [{ card: p.card, remote: p.remote }]).filter(it => it && it.card).slice(0, 6);
    const n = list.length;
    const HW = Math.min(110, (W - 40) / n - 10, W * 0.3), HH = HW * 1.4;
    const allRemote = list.every(it => it.remote);
    _hitTitle(ov, Math.max(14, cy - HH / 2 - 80), '🌀 ' + (n >= 2 ? n + '体を' : '') + '手札に戻す', '#44dd88');
    const hy = H - Math.max(78, H * 0.13);
    const hand = _zoneIcon(ov, cx, hy, '✋', (allRemote ? '相手の' : '') + '手札', '#44dd88');
    const totalW = n * HW + (n - 1) * 12;
    const els = list.map((it, k) => {
      const x = cx - totalW / 2 + k * (HW + 12) + HW / 2;
      return { d: _hitCard(ov, it.card, x, cy, HW, HH, '#44dd88', (it.remote ? '相手の' : '') + (it.card.name || '')), x };
    });
    // 緑の渦が並んだカード全部を包み込む（1つの大きな渦が回り続ける）
    const VW = totalW + HW * 1.1, VH = HH * 1.55;
    const vortex = document.createElement('div');
    vortex.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + VW + 'px;height:' + VH + 'px;opacity:0;transform:translate(-50%,-50%) scale(0.3);transition:opacity 0.35s,transform 0.4s;';
    const ring = (sc, dash, wdt, op) => '<div style="position:absolute;left:' + (50 - sc * 50) + '%;top:' + (50 - sc * 50) + '%;width:' + sc * 100 + '%;height:' + sc * 100 + '%;border-radius:50%;border:' + wdt + 'px dashed rgba(68,221,136,' + op + ');box-shadow:0 0 18px rgba(68,221,136,0.6),inset 0 0 22px rgba(68,221,136,0.45);animation:abSpin ' + (1.2 + sc) + 's linear infinite;"></div>';
    vortex.innerHTML = '<div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse,rgba(68,221,136,0.08) 0%,rgba(68,221,136,0.22) 60%,rgba(68,221,136,0) 72%);"></div>'
      + ring(1, '', 5, 0.95) + ring(0.8, '', 3, 0.7) + ring(0.6, '', 2, 0.5);
    ov.insertBefore(vortex, ov.firstChild);
    if (!document.getElementById('fx-absorb-style')) {
      const st2 = document.createElement('style'); st2.id = 'fx-absorb-style';
      st2.textContent = '@keyframes abSpin{to{transform:rotate(-360deg)}}@keyframes abSpinR{to{transform:rotate(360deg)}}@keyframes abSwirl{0%{transform:rotate(0deg) translateX(var(--r)) scale(1);opacity:0}20%{opacity:1}100%{transform:rotate(540deg) translateX(0) scale(0.2);opacity:0}}';
      document.head.appendChild(st2);
    }
    setTimeout(() => { vortex.style.opacity = '1'; vortex.style.transform = 'translate(-50%,-50%) scale(1)'; }, 250);
    // 渦の中でカードが揺れる
    els.forEach(({ d }, k) => setTimeout(() => { d.style.transition = 'transform 0.4s ease-in-out'; d.style.transform = 'rotate(' + (k % 2 ? 7 : -7) + 'deg) scale(0.95)'; }, 500));
    // 時間差で1枚ずつ、回りながら下の「手札」へ吸い込まれる
    const STEP = n >= 2 ? 520 : 0;
    els.forEach(({ d, x }, k) => {
      const t0 = 1100 + k * STEP;
      setTimeout(() => {
        d.style.transition = 'transform 0.75s cubic-bezier(.6,0,.9,.6),opacity 0.75s';
        d.style.transform = 'translate(' + (cx - x) + 'px,' + (hy - cy) + 'px) scale(0.12) rotate(540deg)';
        d.style.opacity = '0.3';
        for (let q = 0; q < 8; q++) {
          const pt = document.createElement('div');
          const px = x + (Math.random() - 0.5) * HW, py = cy + (Math.random() - 0.5) * HH;
          pt.style.cssText = 'position:absolute;left:' + px + 'px;top:' + py + 'px;width:7px;height:7px;margin:-3px;border-radius:50%;background:#bfffd8;box-shadow:0 0 8px #44dd88;transition:transform 0.7s cubic-bezier(.6,0,.9,.6) ' + (q * 0.03) + 's,opacity 0.7s;';
          ov.appendChild(pt);
          requestAnimationFrame(() => { pt.style.transform = 'translate(' + (cx - px) + 'px,' + (hy - py) + 'px) scale(0.3)'; pt.style.opacity = '0'; });
        }
        setTimeout(() => { d.style.opacity = '0'; _pulse(hand); }, 760);
      }, t0);
    });
    const tLast = 1100 + (n - 1) * STEP + 800;
    setTimeout(() => { vortex.style.transition = 'opacity 0.4s,transform 0.4s'; vortex.style.opacity = '0'; vortex.style.transform = 'translate(-50%,-50%) scale(0.2) rotate(-180deg)'; }, tLast);
    total = tLast + 700;
  } else if (kind === 'deck') {
    const top = !!p.top;
    _hitTitle(ov, Math.max(14, cy - CH / 2 - 80), '⛓ デッキの' + (top ? '上' : '下') + 'に戻す', '#ffd84a');
    const c = _hitCard(ov, p.card, cx, cy, CW, CH, '#ffd84a', pre + nm);
    // 上から光の鎖が降りてきて巻き付く
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.style.cssText = 'position:absolute;left:0;top:0;';
    [[-1, 0.2], [1, 0.45], [-1, 0.7]].forEach(([dir, fy], i) => {
      const path = document.createElementNS(svgNS, 'path');
      const yy = cy - CH / 2 + CH * fy;
      path.setAttribute('d', 'M ' + (cx + dir * W * 0.4) + ' -10 Q ' + (cx + dir * 30) + ' ' + (yy - 80) + ' ' + (cx - dir * CW * 0.6) + ' ' + yy + ' L ' + (cx + dir * CW * 0.6) + ' ' + (yy + 10));
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#ffe27a'); path.setAttribute('stroke-width', '5'); path.setAttribute('stroke-dasharray', '12 6');
      path.style.cssText = 'filter:drop-shadow(0 0 6px #ffb000);stroke-dashoffset:300;animation:hxChain 0.6s ease-out ' + (i * 0.12) + 's forwards;';
      svg.appendChild(path);
    });
    ov.appendChild(svg);
    const deckX = p.remote ? W * 0.85 : W * 0.15, deckY = p.remote ? H * 0.16 : H * 0.84;
    const dk = _zoneIcon(ov, deckX, deckY, '📚', pre + 'デッキ' + (top ? '（上）' : '（下）'), '#ffd84a');
    setTimeout(() => {
      c.style.transition = 'transform 0.75s cubic-bezier(.6,0,.9,.6),opacity 0.75s';
      c.style.transform = 'translate(' + (deckX - cx) + 'px,' + (deckY - cy) + 'px) scale(0.15)';
      c.style.opacity = '0.2';
      svg.style.transition = 'opacity 0.5s'; svg.style.opacity = '0';
    }, 1050);
    setTimeout(() => _pulse(dk), 1800);
  } else if (kind === 'security') {
    _hitTitle(ov, Math.max(14, cy - CH / 2 - 80), '🛡 セキュリティの' + (p.bottom ? '下' : '上') + 'に置く', '#b47cff');
    const c = _hitCard(ov, p.card, cx, cy, CW, CH, '#b47cff', pre + nm);
    // 盾の紋章がカードを包む
    const em = document.createElement('div');
    em.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + CW * 1.9 + 'px;height:' + CW * 1.9 + 'px;border-radius:50%;border:4px solid #d6b4ff;box-shadow:0 0 30px #b47cff,inset 0 0 30px #b47cff;'
      + 'background:radial-gradient(circle,rgba(180,124,255,0.15) 0%,rgba(180,124,255,0.4) 70%,transparent 72%);display:flex;align-items:center;justify-content:center;font-size:' + CW * 0.9 + 'px;opacity:0;transform:translate(-50%,-50%) scale(0.3);transition:opacity 0.3s,transform 0.35s cubic-bezier(.2,.9,.3,1.3);';
    em.innerHTML = '<span style="opacity:0.35;">🛡</span>';
    ov.appendChild(em);
    setTimeout(() => { em.style.opacity = '1'; em.style.transform = 'translate(-50%,-50%) scale(1)'; }, 150);
    const sx = p.remote ? W * 0.85 : W * 0.15, sy = p.remote ? H * 0.2 : H * 0.8;
    const si = _zoneIcon(ov, sx, sy, '🛡', pre + 'セキュリティ', '#b47cff');
    // 裏返りながらセキュリティへ
    setTimeout(() => {
      c.style.transition = 'transform 0.35s ease-in';
      if (!p.faceUp) c.style.transform = 'rotateY(90deg)';
      setTimeout(() => {
        const back = (window._cardBackUrl || '');
        if (!p.faceUp) c.innerHTML = back ? '<img src="' + back + '" style="width:100%;height:100%;object-fit:cover;">' : '';
        c.style.transform = 'rotateY(0deg)';
        setTimeout(() => {
          c.style.transition = 'transform 0.7s cubic-bezier(.6,0,.9,.6),opacity 0.7s';
          c.style.transform = 'translate(' + (sx - cx) + 'px,' + (sy - cy) + 'px) scale(0.15)';
          c.style.opacity = '0.3';
          em.style.opacity = '0';
        }, 300);
      }, 350);
    }, 800);
    setTimeout(() => _pulse(si), 2100);
    total = 2500;
  } else if (kind === 'dedigivolve') {
    _hitTitle(ov, Math.max(14, cy - CH / 2 - 80), '🔻 退化', '#aa66ff');
    // 下のカード（退化後）を先に置き、上に今のカードを重ねる。上のカードが欠片になって剥がれる
    const after = p.after ? _hitCard(ov, p.after, cx, cy, CW, CH, '#aa66ff', pre + (p.after.name || '')) : null;
    const top = _hitCard(ov, p.card, cx, cy, CW, CH, '#aa66ff', pre + nm);
    setTimeout(() => {
      attackStrikeFx(ov, cx, cy, CW);
      const src = p.card.imgSrc || cardImg(p.card) || '';
      setTimeout(() => {
        const r = top.getBoundingClientRect();
        top.style.opacity = '0';
        for (let k = 0; k < 15; k++) {
          const sx2 = (k % 3) / 3, sy2 = Math.floor(k / 3) / 5;
          const sh = document.createElement('div');
          sh.style.cssText = 'position:absolute;left:' + (r.left + sx2 * r.width) + 'px;top:' + (r.top + sy2 * r.height) + 'px;width:' + (r.width / 3) + 'px;height:' + (r.height / 5) + 'px;'
            + (src ? 'background:url(' + src + ') ' + (-sx2 * r.width) + 'px ' + (-sy2 * r.height) + 'px/' + r.width + 'px ' + r.height + 'px;' : 'background:#555;')
            + '--dx:' + ((Math.random() - 0.5) * 200) + 'px;--dy:' + (-60 - Math.random() * 160) + 'px;--r:' + (Math.random() * 360 - 180) + 'deg;animation:hxShard 0.9s ease-out ' + (k * 0.025) + 's forwards;box-shadow:0 0 8px #aa66ff;';
          ov.appendChild(sh);
        }
        if (after) { after.style.transition = 'box-shadow 0.4s'; after.style.boxShadow = '0 0 30px #aa66ff,0 0 60px #aa66ff'; }
        const n2 = (p.removed || []).length;
        _hitTitle(ov, Math.min(H - 60, cy + CH / 2 + 30), '<span style="font-size:0.7em;">' + pre + '「' + nm + '」' + (p.after ? '→「' + (p.after.name || '') + '」' : '') + (n2 > 1 ? '（' + n2 + '枚破棄）' : '') + '</span>', '#aa66ff');
      }, 260);
    }, 400);
  } else if (kind === 'evo_discard') {
    const holder = p.holder || p.card;
    _hitTitle(ov, Math.max(14, cy - CH / 2 - 80), '📤 進化元を破棄', '#ff9933');
    const removed = (p.removed || [p.card]).slice(0, 4);
    const evos = removed.map((rc, i) => { const e = _hitCard(ov, rc, cx + (i - (removed.length - 1) / 2) * 14, cy + 20 + i * 6, CW * 0.85, CH * 0.85, '#ff9933', ''); e.style.zIndex = '1'; return e; });
    const h = _hitCard(ov, holder, cx, cy, CW, CH, '#ff9933', pre + ((holder && holder.name) || ''));
    h.style.zIndex = '2';
    const by = H - Math.max(78, H * 0.13);
    const bin = _zoneIcon(ov, cx, by, '🗑', pre + 'トラッシュ', '#ff4d4d');
    // 下から引き抜かれる → トラッシュへ
    evos.forEach((e, i) => {
      setTimeout(() => { e.style.transition = 'transform 0.35s ease-out'; e.style.transform = 'translate(' + ((i % 2 ? 1 : -1) * (CW * 0.9 + i * 10)) + 'px,' + (CH * 0.35) + 'px) rotate(' + ((i % 2 ? 1 : -1) * 15) + 'deg)'; }, 450 + i * 160);
      setTimeout(() => {
        const r = e.getBoundingClientRect();
        e.style.transition = 'transform 0.6s cubic-bezier(.6,0,.9,.6),opacity 0.6s';
        e.style.transform = 'translate(' + (cx - (r.left + r.width / 2) + (r.left + r.width / 2 - cx)) * 0 + 'px,0) translate(' + (cx - (r.left + r.width / 2)) + 'px,' + (by - (r.top + r.height / 2)) + 'px) scale(0.12) rotate(540deg)';
        e.style.opacity = '0.2';
        setTimeout(() => _pulse(bin), 600);
      }, 1050 + i * 160);
    });
    total = 2100 + removed.length * 160;
  }
  setTimeout(() => { ov.style.opacity = '0'; }, total);
  setTimeout(() => { ov.remove(); done(); }, total + 250);
  setTimeout(done, total + 4000);
}
if (typeof window !== 'undefined') window._fxEffectHit = fxEffectHit;

// ---- 軽い演出（盤面のカードの上に重ねる・待たない）: rest / active / dp_minus / dp_plus / seal ----
export function fxBoardHit(kind, side, idx, value) {
  if (typeof document === 'undefined' || !document.body) return;
  _ensureHitStyle();
  if (!document.getElementById('fx-board2-style')) {
    const st = document.createElement('style');
    st.id = 'fx-board2-style';
    st.textContent = '@keyframes bhShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-5px,3px)}40%{transform:translate(5px,-3px)}60%{transform:translate(-4px,-2px)}80%{transform:translate(3px,2px)}}'
      + '@keyframes bhBadge{0%{transform:translate(-50%,-50%) scale(1.8);opacity:0}25%{transform:translate(-50%,-50%) scale(0.95);opacity:1}35%{transform:translate(-50%,-50%) scale(1.05)}45%{transform:translate(-50%,-50%) scale(1)}85%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}'
      + '@keyframes bhChain{0%{stroke-dashoffset:var(--len)}100%{stroke-dashoffset:0}}'
      + '@keyframes bhLock{0%{transform:translate(-50%,-50%) scale(0) rotate(-30deg);opacity:0}60%{transform:translate(-50%,-50%) scale(1.25) rotate(8deg);opacity:1}100%{transform:translate(-50%,-50%) scale(1) rotate(0deg);opacity:1}}'
      + '@keyframes bhPress{0%{transform:translate(-50%,-140%) scaleY(0.6);opacity:0}40%{opacity:1}100%{transform:translate(-50%,-50%) scaleY(1);opacity:0}}';
    document.head.appendChild(st);
  }
  const row = document.getElementById(side === 'player' ? 'pl-battle-row' : 'ai-battle-row');
  const slot = row ? row.querySelectorAll('.b-slot')[idx] : null;
  if (!slot) return;
  const r = slot.getBoundingClientRect();
  if (!r.width) return;
  const bs = window._lastBattleState;
  const card = bs && bs[side] && bs[side].battleArea ? bs[side].battleArea[idx] : null;
  const src = card ? (card.imgSrc || cardImg(card) || '') : '';
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  // 盤面のカードは、レストなら横向き。演出用の写しは縦向きの大きさで作る
  const susp = slot.classList.contains('suspended');
  const cw = susp ? r.height : r.width, ch = susp ? r.width : r.height;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:46500;overflow:visible;';
  document.body.appendChild(layer);
  // 演出が途中で失敗しても、重ねた層（カードの写し）が盤面に残って本物のカードの表示を隠さないよう、必ず消す
  setTimeout(() => { try { layer.remove(); } catch (_) {} try { slot.style.visibility = ''; } catch (_) {} }, 6000);
  try { _fxBoardHitBody(); } catch (e) { console.error('[fxBoardHit]', kind, e); try { layer.remove(); } catch (_) {} try { slot.style.visibility = ''; } catch (_) {} }
  function _fxBoardHitBody() {
  const add = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; layer.appendChild(d); return d; };
  // 大きな表示（バッジ）。カードの中央に出て、少し残ってから消える
  const badge = (html, color, dur) => add('position:absolute;left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%);white-space:nowrap;padding:4px 10px;border-radius:8px;background:rgba(0,0,0,0.82);border:2px solid ' + color + ';box-shadow:0 0 14px ' + color + ';color:#fff;font-weight:900;font-size:15px;text-align:center;line-height:1.25;text-shadow:0 0 6px ' + color + ';animation:bhBadge ' + (dur || 1.6) + 's ease-out forwards;z-index:3;', html);
  // カードの写し（盤面のカードの上に重ねる）
  const copy = (rot) => {
    const d = add('position:absolute;left:' + (x - cw / 2) + 'px;top:' + (y - ch / 2) + 'px;width:' + cw + 'px;height:' + ch + 'px;border-radius:5px;overflow:hidden;background:#111;transform:rotate(' + rot + 'deg);transform-origin:center center;',
      src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '');
    return d;
  };
  let life = 1800;
  if (kind === 'rest' || kind === 'active') {
    const toRest = kind === 'rest';
    const col = toRest ? '#b47cff' : '#44dd88';
    // 盤面のカードを隠して、写しが回る様子を見せる
    const prevVis = slot.style.visibility; slot.style.visibility = 'hidden';
    const c = copy(toRest ? 0 : 90);
    c.style.boxShadow = '0 0 14px ' + col;
    if (toRest) {
      // 上から紫の重力が押しつぶす → ドンと横に倒れる
      for (let i = 0; i < 3; i++) add('position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + cw * 1.5 + 'px;height:' + ch * 0.5 + 'px;border-radius:50%;border:3px solid #d6b4ff;box-shadow:0 0 14px #8a3dff;transform-origin:center;animation:bhPress 0.45s ease-in ' + (i * 0.12) + 's both;');
      add('position:absolute;left:' + (x - cw) + 'px;top:' + (y - ch * 1.1) + 'px;width:' + cw * 2 + 'px;height:' + ch * 1.1 + 'px;background:linear-gradient(to bottom,rgba(138,61,255,0),rgba(138,61,255,0.55));opacity:0;transition:opacity 0.3s;');
      const veil = layer.lastChild; requestAnimationFrame(() => { veil.style.opacity = '1'; }); setTimeout(() => { veil.style.opacity = '0'; }, 650);
      setTimeout(() => { c.style.transition = 'transform 0.35s cubic-bezier(.6,0,.4,1.4)'; c.style.transform = 'rotate(90deg)'; }, 450);
      setTimeout(() => { c.style.animation = 'bhShake 0.3s linear'; add('position:absolute;left:' + x + 'px;top:' + (y + cw / 2) + 'px;width:' + ch * 1.4 + 'px;height:14px;margin-left:' + (-ch * 0.7) + 'px;border-radius:50%;background:radial-gradient(ellipse,rgba(200,160,255,0.9),rgba(138,61,255,0));animation:hxFlash 0.5s ease-out forwards;'); }, 800);
      setTimeout(() => badge('💤 レスト', col), 750);
    } else {
      // 下から緑の光が立ち上り、カードが起き上がる
      add('position:absolute;left:' + x + 'px;top:' + (y - ch * 0.9) + 'px;width:' + cw * 1.2 + 'px;height:' + ch * 1.6 + 'px;transform-origin:center bottom;background:linear-gradient(to top,rgba(68,221,136,0.85),rgba(68,221,136,0));animation:hxBeam 0.9s ease-out forwards;');
      setTimeout(() => { c.style.transition = 'transform 0.4s cubic-bezier(.3,1.4,.5,1)'; c.style.transform = 'rotate(0deg) translateY(-6px)'; }, 300);
      setTimeout(() => { c.style.transition = 'transform 0.2s'; c.style.transform = 'rotate(0deg)'; }, 750);
      setTimeout(() => badge('⤴ アクティブ', col), 550);
    }
    setTimeout(() => { c.style.transition = 'opacity 0.25s'; c.style.opacity = '0'; slot.style.visibility = prevVis; }, 1650);
    life = 2300;
  } else if (kind === 'dp_minus' || kind === 'dp_plus') {
    const minus = kind === 'dp_minus';
    const col = minus ? '#ff4d3d' : '#ffd84a';
    const v = (value && typeof value === 'object') ? value : { diff: value };
    const diff = Math.abs(v.diff != null ? v.diff : ((v.to || 0) - (v.from || 0)));
    const from = v.from, to = v.to;
    if (minus) {
      // 赤い楔が上から打ち込まれ、カードが揺れて赤く染まる
      const wedge = add('position:absolute;left:' + x + 'px;top:' + (r.top - 50) + 'px;width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-top:46px solid #ff3b2f;filter:drop-shadow(0 0 10px #ff3b2f);transform:translateX(-50%);transition:transform 0.22s ease-in;');
      requestAnimationFrame(() => requestAnimationFrame(() => { wedge.style.transform = 'translate(-50%,' + (r.height * 0.45) + 'px)'; }));
      setTimeout(() => {
        wedge.style.opacity = '0';
        add('position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;background:rgba(255,40,30,0.45);border-radius:5px;animation:hxFlash 0.9s ease-out forwards;');
        add('position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;', '<svg viewBox="0 0 100 140" preserveAspectRatio="none" style="width:100%;height:100%"><path d="M50 30 L42 58 L60 74 L44 104 L56 130 M42 58 L18 68 M60 74 L84 86" stroke="#ffd0c8" stroke-width="3" fill="none" style="filter:drop-shadow(0 0 4px #ff3b2f)"/></svg>');
        add('position:absolute;left:' + x + 'px;top:' + y + 'px;width:70px;height:70px;border-radius:50%;border:3px solid #ff3b2f;animation:hxRing 0.6s ease-out forwards;');
        slot.style.animation = 'bhShake 0.35s linear'; setTimeout(() => { slot.style.animation = ''; }, 400);
      }, 260);
    } else {
      // 金色のオーラが立ち上る
      add('position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;border-radius:6px;box-shadow:0 0 22px #ffd84a,0 0 44px #ffb000,inset 0 0 20px #ffd84a;animation:hxFlash 1.3s ease-out forwards;');
      for (let i = 0; i < 12; i++) add('position:absolute;left:' + (r.left + Math.random() * r.width) + 'px;top:' + (r.top + r.height * 0.85) + 'px;width:6px;height:6px;border-radius:50%;background:#ffe27a;box-shadow:0 0 8px #ffb000;--dx:' + ((Math.random() - 0.5) * 24) + 'px;--dy:' + (-50 - Math.random() * 60) + 'px;--r:0deg;animation:hxShard 1s ease-out ' + (Math.random() * 0.3) + 's both;');
    }
    // DP の数字: 「DP 15000 → 8000」と変化を見せ、差分を大きく
    const b = badge('<div style="font-size:22px;color:' + col + ';">' + (minus ? '−' : '+') + diff + '</div>'
      + ((from != null && to != null) ? '<div style="font-size:12px;">DP <span class="bh-dp">' + from + '</span></div>' : ''), col, 2.0);
    if (from != null && to != null) {
      const sp = b.querySelector('.bh-dp');
      const t0 = Date.now() + 350, D = 600;
      const tick = setInterval(() => {
        const k = Math.min(1, Math.max(0, (Date.now() - t0) / D));
        if (sp) sp.textContent = String(Math.round(from + (to - from) * k));
        if (k >= 1) { clearInterval(tick); if (sp) { sp.style.color = col; sp.textContent = String(to); } }
      }, 40);
    }
    life = 2200;
  } else if (kind === 'seal') {
    // 鎖がカードにぐるぐる巻き付き（らせん状。カードの裏を回る部分は隠れ、端で回り込む）、錠がかかって封印される（盤面）
    const w = r.width, h = r.height, ox = r.left, oy = r.top;
    const svgNS = 'http://www.w3.org/2000/svg';
    const mkSvg = (z) => {
      const sv = document.createElementNS(svgNS, 'svg');
      sv.setAttribute('width', w + 60); sv.setAttribute('height', h + 60);
      sv.style.cssText = 'position:absolute;left:' + (ox - 30) + 'px;top:' + (oy - 30) + 'px;overflow:visible;z-index:' + z + ';';
      layer.appendChild(sv);
      return sv;
    };
    const back = mkSvg(1);   // カードの裏側を回る鎖（カードの写しに隠れる）
    const cc = copy(susp ? 90 : 0); // カードの写し（裏の鎖を隠す）
    cc.style.zIndex = '2';
    const front = mkSvg(3);  // カードの表側を通る鎖
    front.style.filter = 'drop-shadow(0 2px 2px rgba(0,0,0,0.7))';
    const L = Math.max(8, Math.min(13, w * 0.15)); // 輪1つの長さ
    // 鎖の輪1つ（k が偶数: 正面の輪 / 奇数: 横向きの輪）。dark: カードの裏を回る部分
    const link = (sv, k, px, py, ang, dark) => {
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', 'translate(' + (px + 30).toFixed(1) + ',' + (py + 30).toFixed(1) + ') rotate(' + ang.toFixed(1) + ')');
      const C = dark ? ['#1c1c22', '#5c5c68', '#8a8a96'] : ['#3a3a44', '#d0d0dc', '#ffffff'];
      if (k % 2 === 0) {
        [[C[0], 5], [C[1], 2.8], [C[2], 0.8]].forEach(([col, sw]) => {
          const e = document.createElementNS(svgNS, 'ellipse');
          e.setAttribute('rx', L * 0.58); e.setAttribute('ry', L * 0.34); e.setAttribute('fill', 'none'); e.setAttribute('stroke', col); e.setAttribute('stroke-width', sw);
          g.appendChild(e);
        });
      } else {
        [[C[0], L * 0.42, L * 1.25], [C[1], L * 0.24, L * 1.12], [C[2], L * 0.06, L * 0.9]].forEach(([col, hh, ww]) => {
          const rc = document.createElementNS(svgNS, 'rect');
          rc.setAttribute('x', -ww / 2); rc.setAttribute('y', -hh / 2); rc.setAttribute('width', ww); rc.setAttribute('height', hh); rc.setAttribute('rx', hh / 2); rc.setAttribute('fill', col);
          g.appendChild(rc);
        });
      }
      g.style.opacity = '0';
      sv.appendChild(g);
      return g;
    };
    // バツ印（×）に巻き付ける: 対角線の向きに、カードの表→裏→表…と2周ずつ巻く。裏を通る部分はカードに隠れ、
    // 角の外で回り込むところだけ暗く見える。1本目（左上→右下）を巻いてから、2本目（右上→左下）を巻く
    const half = Math.hypot(w, h) / 2;
    const Ru = half + L * 0.7;              // 対角線の向きの巻き付く半径（角より少し外）
    const TURNS = 2;
    const spread = L * 1.15;                // 1周ごとに横へずれる幅（2本の鎖が並ぶ）
    const dTh = (L * 0.8) / Ru;
    const perTurn = Math.ceil(2 * Math.PI / dTh);
    const nPer = Math.ceil(TURNS * 2 * Math.PI / dTh);
    const STEP_MS = Math.max(6, Math.min(12, 520 / nPer));
    const a1 = Math.atan2(h, w);
    const diags = [a1, -a1];                // 左上→右下 / 左下→右上
    let tEnd = 0;
    diags.forEach((al, di) => {
      const dx = Math.cos(al), dy = Math.sin(al);   // 鎖の向き
      const nx = -dy, ny = dx;                       // 巻くごとにずれる向き
      const base = 120 + di * (nPer * STEP_MS + 180);
      for (let k = 0; k <= nPer; k++) {
        const th = -Math.PI / 2 + k * dTh;           // 外側の端から表へ
        const u = Ru * Math.sin(th);
        const off = -spread / 2 + spread * (k / Math.max(1, nPer));
        const px = w / 2 + dx * u + nx * off, py = h / 2 + dy * u + ny * off;
        const frontSide = Math.cos(th) > 0;
        // 輪の向き: 表と裏では鎖の進む向きに沿う。端で回り込むところは少し縦に
        const ang = al * 180 / Math.PI + (Math.cos(th) < 0.25 && Math.cos(th) > -0.25 ? 90 * Math.sign(Math.sin(th)) * 0.35 : 0);
        const g = link(frontSide ? front : back, k + di, px, py, ang, !frontSide);
        setTimeout(() => { g.style.transition = 'opacity 0.06s'; g.style.opacity = '1'; }, base + k * STEP_MS);
      }
      tEnd = base + nPer * STEP_MS;
    });
    void perTurn;
    const tWrap = tEnd;
    // 巻き付くあいだカードがきしむ
    setTimeout(() => { cc.style.animation = 'bhShake 0.25s linear'; }, tWrap * 0.5);
    // 巻き終わり: ギュッと締まる → カードが暗く沈み、錠がかかる
    setTimeout(() => {
      front.style.transition = back.style.transition = 'transform 0.15s ease-in';
      front.style.transformOrigin = back.style.transformOrigin = (w / 2 + 30) + 'px ' + (h / 2 + 30) + 'px';
      front.style.transform = back.style.transform = 'scaleX(0.94)';
      setTimeout(() => { front.style.transform = back.style.transform = 'scaleX(0.97)'; }, 160);
      cc.style.transition = 'filter 0.4s';
      cc.style.filter = 'brightness(0.55) saturate(0.6)';
    }, tWrap);
    const tLock = tWrap + 300;
    setTimeout(() => {
      add('position:absolute;left:' + (ox + w / 2) + 'px;top:' + (oy + h / 2) + 'px;font-size:' + Math.max(22, w * 0.5) + 'px;filter:drop-shadow(0 0 8px #ff3b2f);animation:bhLock 0.35s ease-out forwards;z-index:4;', '🔒');
      add('position:absolute;left:' + (ox + w / 2) + 'px;top:' + (oy + h / 2) + 'px;width:60px;height:60px;border-radius:50%;border:3px solid #ff8a7a;animation:hxRing 0.5s ease-out forwards;z-index:4;');
      cc.style.animation = 'bhShake 0.25s linear';
    }, tLock);
    setTimeout(() => { const t = add('position:absolute;left:' + (ox + w / 2) + 'px;top:' + (oy + h + 14) + 'px;transform:translateX(-50%);white-space:nowrap;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,0.85);border:2px solid #ff6a5a;color:#fff;font-weight:900;font-size:13px;opacity:0;transition:opacity 0.2s;z-index:5;', '封印：' + (value || 'アタック・ブロック不可')); requestAnimationFrame(() => { t.style.opacity = '1'; }); }, tLock + 150);
    life = tLock + 1800;
    setTimeout(() => { layer.style.transition = 'opacity 0.35s'; layer.style.opacity = '0'; }, life - 400);
  }
  setTimeout(() => layer.remove(), life);
  }
}
if (typeof window !== 'undefined') window._fxBoardHit = fxBoardHit;

// ---- 盤面の状態の変化（DP・レスト・封印）を見て、効果の処理中に変わったものに軽い演出を出す ----
// renderAll の最後に呼ぶ。相手の画面には fx_boardHit で送る（相手の画面ではこちらの変化として出す）
const _boardSnap = new WeakMap();
const _boardRecentMap = {};
function _boardMark(sd, idx, k) { _boardRecentMap[sd + ':' + idx + ':' + k] = Date.now(); }
function _boardRecent(sd, idx, k) { const t = _boardRecentMap[sd + ':' + idx + ':' + k]; return !!t && Date.now() - t < 2500; }
// 相手の端末から届いた盤面の演出（fx_boardHit）
export function remoteBoardHit(kind, sd, idx, value) {
  if (_boardRecent(sd, idx, kind)) return;
  _boardMark(sd, idx, kind);
  setTimeout(() => fxBoardHit(kind, sd, idx, value), 30);
}
if (typeof window !== 'undefined') window._fxRemoteBoardHit = remoteBoardHit;
export function boardStateDiff() {
  try {
    const bs = window._lastBattleState;
    if (!bs) return;
    const active = typeof window._isEffectProcessing === 'function' && window._isEffectProcessing();
    const sealOf = (c) => {
      const b = Array.isArray(c.buffs) ? c.buffs : [];
      const a = !!c.cantAttack || b.some(x => x && (x.type === 'cant_attack' || x.type === 'cant_attack_block'));
      const k = !!c.cantBlock || b.some(x => x && (x.type === 'cant_block' || x.type === 'cant_attack_block'));
      return (a ? 'A' : '') + (k ? 'B' : '');
    };
    ['player', 'ai'].forEach((sd) => {
      (bs[sd].battleArea || []).forEach((c, idx) => {
        if (!c) return;
        const now = { s: !!c.suspended, dp: parseInt(c.dp, 10) || 0, seal: sealOf(c), no: c.cardNo || '' };
        const prev = _boardSnap.get(c);
        _boardSnap.set(c, now);
        // 効果の処理中の変化だけ（進化等でカードが変わったときは出さない）
        if (!prev || prev.no !== now.no || !active || window._fxMoveHold > 0) return;
        const hits = [];
        if (prev.s !== now.s) hits.push([now.s ? 'rest' : 'active', null]);
        if (prev.dp !== now.dp) hits.push([now.dp < prev.dp ? 'dp_minus' : 'dp_plus', { from: prev.dp, to: now.dp, diff: Math.abs(now.dp - prev.dp) }]);
        if (prev.seal !== now.seal && now.seal.length > prev.seal.length) {
          hits.push(['seal', now.seal === 'AB' ? 'アタック・ブロック不可' : now.seal === 'A' ? 'アタック不可' : 'ブロック不可']);
        }
        hits.forEach(([k, v], i) => {
          // 相手の端末から同じ演出が届いた直後なら重ねない（両方の端末で処理中のとき）
          if (_boardRecent(sd, idx, k)) return;
          _boardMark(sd, idx, k);
          setTimeout(() => fxBoardHit(k, sd, idx, v), i * 900);
          if (typeof window._onlineSendCommand === 'function' && typeof window._isOnlineMode === 'function' && window._isOnlineMode() && !window._suppressFxSend) {
            try { window._onlineSendCommand({ type: 'fx_boardHit', kind: k, side: sd === 'player' ? 'ai' : 'player', idx, value: v }); } catch (_) {}
          }
        });
      });
    });
  } catch (e) { console.error('[boardStateDiff]', e); }
}
if (typeof window !== 'undefined') window._fxBoardStateDiff = boardStateDiff;


// =====================================================
//  効果を受けない・〜することで離れない: 守りの魔法陣（金色・逆回転）が魔法攻撃を吸い込んで消す
//  opts: { label, sub, remote, cost: { name, imgSrc, faceDown } }（cost: 離れないために使ったカード。魔法陣に飛び込む）
// =====================================================
export function fxMagicAbsorb(card, opts, callback) {
  opts = opts || {};
  let fin = false;
  const done = () => { if (fin) return; fin = true; window._fxAnimActive = Math.max(0, (window._fxAnimActive || 1) - 1); try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body || !card) { callback && callback(); return; }
  window._fxAnimActive = (window._fxAnimActive || 0) + 1;
  _ensureHitStyle(); _ensureMagicStyle();
  if (!document.getElementById('fx-absorb-style')) {
    const st = document.createElement('style');
    st.id = 'fx-absorb-style';
    st.textContent = '@keyframes abSpin{to{transform:rotate(-360deg)}}@keyframes abSpinR{to{transform:rotate(360deg)}}'
      + '@keyframes abSwirl{0%{transform:rotate(0deg) translateX(var(--r)) scale(1);opacity:0}20%{opacity:1}100%{transform:rotate(540deg) translateX(0) scale(0.2);opacity:0}}';
    document.head.appendChild(st);
  }
  const W = window.innerWidth, H = window.innerHeight;
  const CW = Math.min(110, W * 0.28), CH = CW * 1.4;
  const cx = W / 2, cy = Math.min(H * 0.6, H - CH / 2 - 90);
  const ax = cx, ay = Math.max(70, cy - CH / 2 - CW * 1.25); // 攻撃の魔法陣（上）
  const ov = _hitOverlay(70500);
  const add = (css, html) => { const d = document.createElement('div'); d.style.cssText = css; if (html) d.innerHTML = html; ov.appendChild(d); return d; };
  const pre = opts.remote ? '相手の' : '';
  _hitCard(ov, card, cx, cy, CW, CH, '#ffd86a', pre + (card.name || ''));
  // ① 攻撃の魔法陣（紫）が上に広がり、魔力が集まる（離れないために使ったカードがあるときは、その分遅らせる）
  const AS = CW * 1.5;
  const AD = opts.cost ? 0.8 : 0;
  add('position:absolute;left:' + ax + 'px;top:' + ay + 'px;width:' + AS + 'px;height:' + AS + 'px;filter:drop-shadow(0 0 8px #b06cff) drop-shadow(0 0 18px #7a3dff);animation:mgCircle 2.2s ease-out ' + AD + 's both;', _MAGIC_SVG('#e3c8ff', '#8ff3ff'));
  for (let k = 0; k < 14; k++) {
    const ang = Math.random() * Math.PI * 2, dd = AS * 0.5 + Math.random() * AS * 0.4;
    add('position:absolute;left:' + ax + 'px;top:' + ay + 'px;width:7px;height:7px;margin:-3px;border-radius:50%;background:#fff;box-shadow:0 0 8px #b06cff;--dx:' + Math.cos(ang) * dd + 'px;--dy:' + Math.sin(ang) * dd + 'px;animation:mgGather 0.9s ease-in ' + (AD + 0.4 + Math.random() * 0.3) + 's forwards;opacity:0;');
  }
  // ② 守りの魔法陣（金色・逆回転）がカードの前に現れる
  const GS = CW * 1.7;
  const guard = add('position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + GS + 'px;height:' + GS + 'px;margin:' + (-GS / 2) + 'px 0 0 ' + (-GS / 2) + 'px;opacity:0;transform:scale(0.2);transition:opacity 0.4s,transform 0.5s cubic-bezier(.2,.9,.3,1.3),filter 0.2s;filter:drop-shadow(0 0 8px #ffc83a) drop-shadow(0 0 20px #ffb000);');
  const gIn = document.createElement('div');
  gIn.style.cssText = 'width:100%;height:100%;animation:abSpin 2.4s linear infinite;';
  gIn.innerHTML = _MAGIC_SVG('#ffe9a0', '#fff6d0');
  guard.appendChild(gIn);
  const gIn2 = document.createElement('div');
  gIn2.style.cssText = 'position:absolute;left:22%;top:22%;width:56%;height:56%;animation:abSpinR 1.8s linear infinite;';
  gIn2.innerHTML = _MAGIC_SVG('#ffd86a', '#ffffff');
  guard.appendChild(gIn2);
  setTimeout(() => { guard.style.opacity = '0.95'; guard.style.transform = 'scale(1)'; }, 700);
  const flare = () => { guard.style.filter = 'drop-shadow(0 0 14px #fff) drop-shadow(0 0 34px #ffc83a) brightness(1.6)'; setTimeout(() => { guard.style.filter = 'drop-shadow(0 0 8px #ffc83a) drop-shadow(0 0 20px #ffb000)'; }, 260); };
  // ③ （離れないために使ったカードがあれば）そのカードが下から魔法陣へ飛び込み、力に変わる
  let tOrb = 1600;
  if (opts.cost) {
    const back = window._cardBackUrl || '';
    const cs = opts.cost.faceDown ? (back ? '<img src="' + back + '" style="width:100%;height:100%;object-fit:cover;">' : '') : (opts.cost.imgSrc ? '<img src="' + opts.cost.imgSrc + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;font-size:10px;padding:4px;">' + (opts.cost.name || '') + '</div>');
    const sy = opts.remote ? -CH : H + CH * 0.3;
    const cc = add('position:absolute;left:' + (cx - CW * 0.35) + 'px;top:' + (sy - CH * 0.35) + 'px;width:' + CW * 0.7 + 'px;height:' + CH * 0.7 + 'px;border-radius:6px;overflow:hidden;border:2px solid #ffd86a;box-shadow:0 0 16px #ffc83a;background:#111;transition:transform 0.8s cubic-bezier(.3,.7,.3,1),opacity 0.4s;', cs);
    setTimeout(() => { cc.style.transform = 'translateY(' + (cy - sy) + 'px)'; }, 1000);
    setTimeout(() => { cc.style.transition = 'transform 0.4s ease-in,opacity 0.4s'; cc.style.transform = 'translateY(' + (cy - sy) + 'px) scale(0.1) rotate(270deg)'; cc.style.opacity = '0'; flare(); }, 1850);
    add('position:absolute;left:50%;top:' + Math.min(H - 40, cy + GS / 2 + 4) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:12px;color:#ffe9a0;text-shadow:0 0 6px #000;opacity:0;transition:opacity 0.3s;', '「' + (opts.cost.faceDown ? 'セキュリティのカード' : (opts.cost.name || '')) + '」を使って離れない');
    const note = ov.lastChild; setTimeout(() => { note.style.opacity = '1'; }, 1300);
    tOrb = 2400;
  }
  // ④ 攻撃の魔法陣から稲妻が放たれる → 守りの魔法陣に捕まり、ねじれながら中心へ吸い込まれていく
  const svgNS = 'http://www.w3.org/2000/svg';
  const boltLayer = document.createElementNS(svgNS, 'svg');
  boltLayer.setAttribute('width', W); boltLayer.setAttribute('height', H);
  boltLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
  ov.appendChild(boltLayer);
  const jag = (x1, y1, x2, y2, amp, steps) => {
    const pts = [];
    for (let q = 0; q <= steps; q++) {
      const t = q / steps;
      const nx = -(y2 - y1), ny = x2 - x1, len = Math.hypot(nx, ny) || 1;
      const off = (q === 0 || q === steps) ? 0 : (Math.random() - 0.5) * amp * 2;
      pts.push((x1 + (x2 - x1) * t + nx / len * off).toFixed(1) + ',' + (y1 + (y2 - y1) * t + ny / len * off).toFixed(1));
    }
    return pts.join(' ');
  };
  const line = (pts, w, color) => { const l = document.createElementNS(svgNS, 'polyline'); l.setAttribute('points', pts); l.setAttribute('fill', 'none'); l.setAttribute('stroke', color); l.setAttribute('stroke-width', w); l.setAttribute('stroke-linejoin', 'round'); l.setAttribute('stroke-linecap', 'round'); boltLayer.appendChild(l); };
  const drawBolt = (x1, y1, x2, y2, amp, scale) => {
    const pts = jag(x1, y1, x2, y2, amp, 10);
    line(pts, 13 * scale, 'rgba(150,90,255,0.4)');
    line(pts, 5 * scale, '#d9b8ff');
    line(pts, 2 * scale, '#ffffff');
  };
  setTimeout(() => {
    add('position:absolute;inset:0;background:radial-gradient(circle at ' + ax + 'px ' + ay + 'px,rgba(255,255,255,0.85) 0%,rgba(190,130,255,0.5) 12%,rgba(0,0,0,0) 32%);animation:hxFlash 0.6s ease-out forwards;');
    const R = GS * 0.46;
    const t0 = Date.now(), DUR = 1500, HIT = 420; // HIT: 稲妻が魔法陣に届くまで
    let flick = 0;
    const tick = setInterval(() => {
      const el = Date.now() - t0;
      while (boltLayer.firstChild) boltLayer.removeChild(boltLayer.firstChild);
      if (el >= DUR) { clearInterval(tick); return; }
      if (el < HIT) {
        // 稲妻が魔法陣へ向かって伸びる（3本）
        const k = el / HIT;
        [-0.35, 0, 0.35].forEach((o) => drawBolt(ax + o * AS * 0.3, ay, ax + o * AS * 0.3 + (cx - ax - o * AS * 0.3) * k, ay + (cy - R - ay) * k, 16, 1));
      } else {
        const k = (el - HIT) / (DUR - HIT); // 0→1 吸い込まれていく
        if (!flick) { flick = 1; flare(); add('position:absolute;left:' + cx + 'px;top:' + (cy - R) + 'px;width:80px;height:80px;border-radius:50%;border:3px solid #fff3c0;box-shadow:0 0 18px #ffc83a;animation:hxRing 0.6s ease-out forwards;'); }
        // 稲妻の根元が魔法陣に引き寄せられ（上から縮んでいく）、先は魔法陣の中心へねじれながら吸い込まれる
        const sy = ay + (cy - R - ay) * Math.min(1, k * 1.15);
        const sc = Math.max(0.25, 1 - k * 0.75);
        if (sy < cy - R - 4) [-0.35, 0, 0.35].forEach((o) => drawBolt(ax + o * AS * 0.3 * (1 - k), sy, cx + o * R * 0.5, cy - R, 14 * sc, sc));
        // 魔法陣の縁から中心へ、回りながら吸い込まれる稲妻
        const n2 = 4;
        for (let q = 0; q < n2; q++) {
          const ang = (q / n2) * Math.PI * 2 + el / 140;
          const rr = R * (1 - k * 0.5);
          drawBolt(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, cx, cy, 10 * sc, sc * 0.8);
        }
        if (Math.random() < 0.25) flare();
      }
    }, 55);
    // 紫の魔力の粒が渦を巻いて中心へ
    setTimeout(() => {
      for (let k = 0; k < 22; k++) {
        const r = GS * (0.25 + Math.random() * 0.35);
        const pp = add('position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:0;height:0;transform:rotate(' + (k * 16) + 'deg);');
        const dot = document.createElement('div');
        dot.style.cssText = 'position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px;border-radius:50%;background:' + (k % 2 ? '#d9b8ff' : '#b06cff') + ';box-shadow:0 0 8px #8a3dff;--r:' + r + 'px;animation:abSwirl 0.9s ease-in ' + (k * 0.02) + 's forwards;opacity:0;';
        pp.appendChild(dot);
      }
    }, HIT + 200);
    // 吸い込み終わりに、魔法陣の中心が白く光る
    setTimeout(() => {
      add('position:absolute;inset:0;background:radial-gradient(circle at ' + cx + 'px ' + cy + 'px,rgba(255,250,220,0.9) 0%,rgba(255,200,60,0.45) 10%,rgba(0,0,0,0) 30%);animation:hxFlash 0.6s ease-out forwards;');
      flare();
    }, DUR);
  }, tOrb);
  // ⑤ 吸い込み終わると、守りの魔法陣が強く光って閉じる。カードは無傷
  const tClose = tOrb + 2200;
  setTimeout(() => {
    add('position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:90px;height:90px;border-radius:50%;border:4px solid #fff3c0;box-shadow:0 0 22px #ffc83a;animation:hxRing 0.8s ease-out forwards;');
    guard.style.transition = 'transform 0.6s ease-in,opacity 0.6s';
    guard.style.transform = 'scale(0.1) rotate(-180deg)';
    guard.style.opacity = '0';
    add('position:absolute;left:50%;top:' + Math.max(10, ay - AS / 2 - 10) + 'px;transform:translateX(-50%);text-align:center;white-space:nowrap;animation:hxLbl 0.4s ease-out forwards;',
      '<div style="font-size:clamp(1.5rem,6.5vw,2.4rem);font-weight:900;color:#ffe27a;text-shadow:0 0 16px #ffb000,0 0 3px #000;">' + (opts.label || '効果を受けない！') + '</div>'
      + '<div style="font-size:clamp(0.85rem,3.4vw,1.05rem);color:#fff;text-shadow:0 0 6px #000;margin-top:4px;">' + pre + '「' + (card.name || '') + '」は' + (opts.sub || '効果を受けない') + '</div>');
  }, tClose);
  const tEnd = tClose + 1700;
  setTimeout(() => { ov.style.opacity = '0'; }, tEnd);
  setTimeout(() => { ov.remove(); done(); }, tEnd + 250);
  setTimeout(done, tEnd + 4000);
}
if (typeof window !== 'undefined') window._fxMagicAbsorb = fxMagicAbsorb;
