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
//  ジョグレス進化（融合）演出 — 2体が左右から飛び込み、回転しながら衝突して融合 → 光の柱から進化後のカード
// =====================================================
// left / right: 進化元の2体（左＝上に重なる方） / result: 進化後のカード / cost: 進化コスト（null なら表示しない）
export function fxJogressFusion(left, right, result, cost, callback) {
  const done = () => { try { callback && callback(); } catch (_) {} };
  if (typeof document === 'undefined' || !document.body) { done(); return; }
  if (!document.getElementById('fx-jogress-fusion-style')) {
    const st = document.createElement('style');
    st.id = 'fx-jogress-fusion-style';
    st.textContent = [
      '@keyframes jfShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-8px,4px)}40%{transform:translate(7px,-5px)}60%{transform:translate(-5px,-3px)}80%{transform:translate(4px,5px)}}',
      '@keyframes jfRing{0%{transform:translate(-50%,-50%) scale(0.1);opacity:1}100%{transform:translate(-50%,-50%) scale(5);opacity:0}}',
      '@keyframes jfFlash{0%{opacity:0}15%{opacity:1}100%{opacity:0}}',
      '@keyframes jfOrb{0%{transform:translate(-50%,-50%) scale(0.2);opacity:0}30%{opacity:1}70%{transform:translate(-50%,-50%) scale(1.25)}100%{transform:translate(-50%,-50%) scale(0.9);opacity:0}}',
      '@keyframes jfPillar{0%{transform:translateX(-50%) scaleY(0);opacity:0}25%{opacity:0.95}100%{transform:translateX(-50%) scaleY(1);opacity:0}}',
      '@keyframes jfRise{0%{transform:translate(-50%,-30%) scale(0.4);opacity:0;filter:brightness(3)}60%{transform:translate(-50%,-55%) scale(1.12);opacity:1;filter:brightness(1.6)}100%{transform:translate(-50%,-50%) scale(1);opacity:1;filter:brightness(1)}}',
      '@keyframes jfTitle{0%{letter-spacing:22px;opacity:0;transform:translateX(-50%) scale(1.4)}60%{opacity:1}100%{letter-spacing:6px;opacity:1;transform:translateX(-50%) scale(1)}}',
      '@keyframes jfGlow{0%,100%{box-shadow:0 0 30px #ffdd00,0 0 60px #ff8800}50%{box-shadow:0 0 50px #ffffff,0 0 90px #ffdd00}}',
    ].join('');
    document.head.appendChild(st);
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:56000;pointer-events:none;overflow:hidden;background:radial-gradient(ellipse at center,rgba(40,20,0,0.92) 0%,rgba(0,0,0,0.95) 70%);opacity:0;transition:opacity 0.3s;';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;';
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H / 2;
  const CW = Math.min(110, W * 0.26), CH = CW * 1.4;
  const face = (card, color) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;overflow:hidden;border:2px solid ' + color + ';box-shadow:0 0 18px ' + color + ',0 0 36px ' + color + '66;background:#111;';
    const src = card ? (card.imgSrc || cardImg(card)) : '';
    d.innerHTML = (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#fff;padding:8px;font-size:11px;">' + ((card && card.name) || '?') + '</div>')
      + '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.8);padding:2px;font-size:9px;text-align:center;color:#fff;">' + ((card && card.name) || '') + '</div>';
    return d;
  };
  const a = face(left, '#00e5ff'), b = face(right, '#ff8a00');
  stage.appendChild(a); stage.appendChild(b);
  // 光の尾
  const trail = (x, y, color) => {
    const t = document.createElement('div');
    t.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:' + color + ';box-shadow:0 0 14px ' + color + ';opacity:0.8;transition:all 0.5s ease-out;';
    stage.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '0'; t.style.transform = 'scale(0.2)'; });
    setTimeout(() => t.remove(), 550);
  };
  const place = (el, x, y, rot, sc, op) => {
    el.style.left = (x - CW / 2) + 'px'; el.style.top = (y - CH / 2) + 'px';
    el.style.transform = 'rotate(' + rot + 'deg) scale(' + sc + ')'; el.style.opacity = op;
  };
  // ① 左右から飛び込み（0〜0.7s）→ ② 中心を回りながら近づく（0.7〜2.2s）
  const t0 = performance.now();
  const ENTER = 700, SPIN = 1500;
  let lastTrail = 0;
  const step = (now) => {
    const t = now - t0;
    if (t < ENTER) {
      const e = 1 - Math.pow(1 - t / ENTER, 3);
      place(a, -CW + (cx - W * 0.22 + CW) * e, cy, -20 * (1 - e), 1, e);
      place(b, W + CW - (W + CW - (cx + W * 0.22)) * e, cy, 20 * (1 - e), 1, e);
    } else if (t < ENTER + SPIN) {
      const u = (t - ENTER) / SPIN, e = u * u;
      const r = W * 0.22 * (1 - e), ang = Math.PI * 4 * e;
      place(a, cx - Math.cos(ang) * r, cy - Math.sin(ang) * r * 0.45, ang * 57.3 * 0.5, 1 - 0.5 * e, 1);
      place(b, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.45, -ang * 57.3 * 0.5, 1 - 0.5 * e, 1);
      if (now - lastTrail > 35) {
        lastTrail = now;
        trail(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r * 0.45, '#00e5ff');
        trail(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.45, '#ff8a00');
      }
    } else { collide(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // ③ 衝突: 閃光・衝撃波・揺れ・火花（2.2s〜）
  let collided = false;
  const collide = () => {
    if (collided) return; collided = true;
    a.remove(); b.remove();
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;animation:jfFlash 0.6s ease-out forwards;';
    stage.appendChild(flash);
    stage.style.animation = 'jfShake 0.45s linear';
    ['#ffffff', '#ffdd00', '#ff8a00'].forEach((c, i) => {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:90px;height:90px;border-radius:50%;border:4px solid ' + c + ';box-shadow:0 0 20px ' + c + ';animation:jfRing 0.9s ease-out ' + (i * 0.12) + 's forwards;opacity:0;';
      stage.appendChild(ring);
    });
    const colors = ['#ffdd00', '#ffffff', '#00e5ff', '#ff8a00', '#ff4fd8'];
    for (let i = 0; i < 46; i++) {
      const sp = document.createElement('div');
      const ang = Math.random() * Math.PI * 2, dist = 80 + Math.random() * Math.min(W, H) * 0.42, sz = 3 + Math.random() * 9;
      const c = colors[i % colors.length];
      sp.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:' + sz + 'px;height:' + sz + 'px;margin:-' + (sz / 2) + 'px;border-radius:50%;background:' + c + ';box-shadow:0 0 ' + (sz * 2) + 'px ' + c + ';transition:transform ' + (0.7 + Math.random() * 0.6) + 's cubic-bezier(.1,.8,.3,1),opacity 1.1s ease-out;';
      stage.appendChild(sp);
      requestAnimationFrame(() => { sp.style.transform = 'translate(' + (Math.cos(ang) * dist) + 'px,' + (Math.sin(ang) * dist) + 'px)'; sp.style.opacity = '0'; });
    }
    // 融合の光の球
    const orb = document.createElement('div');
    orb.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,#ffffff 0%,#ffe680 35%,#ff9a00 65%,rgba(255,120,0,0) 72%);animation:jfOrb 1.1s ease-in-out forwards;';
    stage.appendChild(orb);
    setTimeout(reveal, 900);
  };
  // ④ 光の柱 → 進化後のカード、タイトル
  const reveal = () => {
    const pillar = document.createElement('div');
    pillar.style.cssText = 'position:absolute;left:' + cx + 'px;top:0;bottom:0;width:' + (CW * 1.6) + 'px;transform-origin:center bottom;background:linear-gradient(to top,rgba(255,220,0,0) 0%,rgba(255,240,170,0.9) 45%,rgba(255,255,255,0.95) 55%,rgba(255,220,0,0) 100%);animation:jfPillar 1.2s ease-out forwards;';
    stage.appendChild(pillar);
    const res = face(result, '#ffdd00');
    res.style.width = (CW * 1.35) + 'px'; res.style.height = (CH * 1.35) + 'px';
    res.style.left = cx + 'px'; res.style.top = cy + 'px';
    res.style.animation = 'jfRise 0.9s cubic-bezier(.2,.9,.3,1.2) forwards, jfGlow 1.2s ease-in-out 0.9s infinite';
    stage.appendChild(res);
    const title = document.createElement('div');
    title.style.cssText = 'position:absolute;left:50%;top:' + Math.max(16, cy - CH * 1.35 / 2 - 64) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:' + Math.min(30, W * 0.065) + 'px;font-weight:900;color:#fff4b0;text-shadow:0 0 12px #ffdd00,0 0 28px #ff8a00,0 0 50px #ff4400;animation:jfTitle 0.9s ease-out forwards;';
    title.innerText = 'JOGRESS EVOLUTION';
    stage.appendChild(title);
    const sub = document.createElement('div');
    sub.style.cssText = 'position:absolute;left:50%;top:' + (cy + CH * 1.35 / 2 + 18) + 'px;transform:translateX(-50%);white-space:nowrap;font-size:13px;font-weight:bold;color:#ffe9a0;text-shadow:0 0 8px #ff8a00;opacity:0;transition:opacity 0.4s 0.5s;';
    sub.innerText = '「' + ((left && left.name) || '?') + '」＋「' + ((right && right.name) || '?') + '」→「' + ((result && result.name) || '?') + '」' + (cost != null ? '（コスト' + cost + '）' : '');
    stage.appendChild(sub);
    requestAnimationFrame(() => { sub.style.opacity = '1'; });
    setTimeout(() => { overlay.style.opacity = '0'; }, 2300);
    setTimeout(() => { overlay.remove(); done(); }, 2650);
  };
}
