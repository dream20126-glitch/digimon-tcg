// ===================================================
// 演出テスト用スクリプト
// バトル画面でF12→コンソールに貼り付けて実行
// ===================================================

// テスト用ダミーカード
const _testCard = {
  name: 'テストデジモン',
  cardNo: 'TEST-001',
  type: 'デジモン',
  level: 5,
  dp: 7000,
  cost: 7,
  playCost: 7,
  effect: '【進化時】相手のデジモン1体を消滅させる。',
  imgSrc: ''
};

// テストメニューを画面に表示
(function createTestMenu() {
  const existing = document.getElementById('_effect-test-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = '_effect-test-menu';
  menu.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#111;border:2px solid #00fbff;border-radius:10px;padding:12px;max-height:90vh;overflow-y:auto;width:220px;';
  menu.innerHTML = '<div style="color:#00fbff;font-weight:bold;font-size:13px;margin-bottom:10px;text-align:center;">🎬 演出テスト</div>';

  const tests = [
    { label: '消滅演出', fn: testDestroy },
    { label: '登場演出', fn: testPlay },
    { label: '進化演出', fn: testEvolve },
    { label: '数値ポップアップ (+3000)', fn: () => testDpPopup(3000) },
    { label: '数値ポップアップ (-3000)', fn: () => testDpPopup(-3000) },
    { label: 'カード表示演出 (ドロー)', fn: testDraw },
    { label: 'ゲージ移動 (メモリー+2)', fn: () => testMemory(2) },
    { label: 'ゲージ移動 (メモリー-2)', fn: () => testMemory(-2) },
    { label: 'デッキオープン (3枚)', fn: testDeckOpen },
    { label: 'セキュリティチェック (VS)', fn: testSecurityCheck },
    { label: 'バトル結果 (Win)', fn: () => testBattleResult('Win!!', '#00ff88', '撃破！') },
    { label: 'バトル結果 (Lost)', fn: () => testBattleResult('Lost...', '#ff4444', '撃破された...') },
    { label: '効果内容オーバーレイ', fn: testEffectOverlay },
    { label: '効果不発動通知', fn: testEffectDeclined },
    { label: 'テキスト表示', fn: testTextDisplay },
    { label: '--- 相手画面演出 ---', fn: null },
    { label: 'B: カード名+結果表示', fn: testEffectResult },
    { label: '閉じる', fn: () => menu.remove() }
  ];

  tests.forEach(t => {
    if (t.fn === null) {
      menu.innerHTML += '<div style="color:#888;font-size:10px;margin:8px 0 4px;border-top:1px solid #333;padding-top:6px;">' + t.label + '</div>';
      return;
    }
    const btn = document.createElement('button');
    btn.innerText = t.label;
    btn.style.cssText = 'display:block;width:100%;padding:6px 8px;margin:3px 0;background:#222;color:#fff;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:11px;text-align:left;';
    btn.onmouseenter = () => btn.style.background = '#333';
    btn.onmouseleave = () => btn.style.background = '#222';
    btn.onclick = () => { console.log('🎬 テスト:', t.label); t.fn(); };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  console.log('🎬 演出テストメニューを表示しました');
})();

// ===== 各演出テスト =====

function testDestroy() {
  const card = { ..._testCard, name: 'グレイモン' };
  // showDestroyEffect is global from battle.js
  if (typeof showDestroyEffect === 'function') {
    showDestroyEffect(card, () => console.log('✅ 消滅演出完了'));
  } else {
    console.log('❌ showDestroyEffect not found');
  }
}

function testPlay() {
  const card = { ..._testCard, name: 'アグモン', playCost: 3 };
  if (typeof showPlayEffect === 'function') {
    showPlayEffect(card, () => console.log('✅ 登場演出完了'));
  } else {
    console.log('❌ showPlayEffect not found');
  }
}

function testEvolve() {
  const base = { ..._testCard, name: 'アグモン' };
  const evolved = { ..._testCard, name: 'グレイモン', level: 4 };
  if (typeof showEvolveEffect === 'function') {
    showEvolveEffect(2, 'アグモン', base, evolved, () => console.log('✅ 進化演出完了'));
  } else {
    console.log('❌ showEvolveEffect not found');
  }
}

function testDpPopup(value) {
  const el = document.createElement('div');
  const isPlus = value > 0;
  el.innerText = (isPlus ? '+' : '') + value;
  el.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:2rem;font-weight:bold;z-index:60000;pointer-events:none;color:' + (isPlus ? '#00ff88' : '#ff4444') + ';text-shadow:0 0 15px ' + (isPlus ? '#00ff88' : '#ff4444') + ';animation:dpChangePopup 1s ease forwards;';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1100);
  console.log('✅ 数値ポップアップ: ' + value);
}

function testDraw() {
  const card = { ..._testCard, name: 'ガルダモン', level: 5 };
  if (typeof showDrawEffect === 'function') {
    showDrawEffect(card, true, () => console.log('✅ カード表示演出完了'));
  } else {
    // フォールバック: 簡易表示
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:55000;display:flex;align-items:center;justify-content:center;';
    el.innerHTML = '<div style="text-align:center;color:#fff;"><div style="font-size:16px;font-weight:bold;margin-bottom:8px;">📥 ドロー</div><div style="font-size:14px;">ガルダモン</div></div>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
    console.log('✅ カード表示演出（簡易）完了');
  }
}

function testMemory(change) {
  console.log('✅ ゲージ移動: メモリー' + (change > 0 ? '+' : '') + change);
  // 実際のゲージを動かす（元に戻す）
  const el = document.createElement('div');
  const color = change > 0 ? '#00ff88' : '#ff4444';
  el.innerText = 'メモリー ' + (change > 0 ? '+' : '') + change;
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.5rem;font-weight:bold;z-index:60000;pointer-events:none;color:' + color + ';text-shadow:0 0 15px ' + color + ';animation:dpChangePopup 1.2s ease forwards;';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1300);
}

function testDeckOpen() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
  overlay.innerHTML = '<div style="font-size:1rem;font-weight:bold;color:#ffaa00;letter-spacing:2px;text-shadow:0 0 10px #ffaa00;">📖 DECK OPEN</div>'
    + '<div style="display:flex;gap:10px;padding:12px 20px;background:rgba(0,15,25,0.9);border:1px solid #ffaa0044;border-radius:12px;">'
    + '<div style="width:55px;height:77px;background:#333;border-radius:4px;border:1px solid #ffaa00;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">カード1</div>'
    + '<div style="width:55px;height:77px;background:#333;border-radius:4px;border:1px solid #ffaa00;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">カード2</div>'
    + '<div style="width:55px;height:77px;background:#333;border-radius:4px;border:1px solid #ffaa00;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">カード3</div>'
    + '</div>';
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 5000);
  console.log('✅ デッキオープン演出');
}

function testSecurityCheck() {
  const sec = { ..._testCard, name: 'セキュリティデジモン', dp: 5000 };
  const atk = { ..._testCard, name: 'アタッカー', dp: 7000 };
  if (typeof showSecurityCheck === 'function') {
    showSecurityCheck(sec, atk, () => console.log('✅ セキュリティチェック演出完了'), 'BATTLE!');
  } else {
    console.log('❌ showSecurityCheck not found');
  }
}

function testBattleResult(text, color, sub) {
  if (typeof showBattleResult === 'function') {
    showBattleResult(text, color, sub, () => console.log('✅ バトル結果演出完了'));
  } else {
    console.log('❌ showBattleResult not found');
  }
}

function testEffectOverlay() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
  const bx = document.createElement('div');
  bx.style.cssText = 'max-width:85%;padding:20px;background:rgba(0,10,20,0.95);border:2px solid #ff00fb;border-radius:12px;box-shadow:0 0 30px #ff00fb44;text-align:center;';
  bx.innerHTML = '<div style="color:#ff00fb;font-size:14px;font-weight:bold;margin-bottom:10px;text-shadow:0 0 8px #ff00fb;">⚡ 相手: グレイモン</div>'
    + '<div style="color:#ddd;font-size:11px;line-height:1.6;text-align:left;margin-bottom:12px;">【進化時】相手のデジモン1体を消滅させる。</div>'
    + '<div style="color:#888;font-size:10px;">相手が効果を処理中...</div>';
  ov.appendChild(bx);
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
  setTimeout(() => { if (ov.parentNode) ov.remove(); }, 5000);
  console.log('✅ 効果内容オーバーレイ（タップで閉じる）');
}

function testEffectDeclined() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);z-index:56000;background:rgba(30,30,40,0.9);border:1px solid #888;border-radius:10px;padding:12px 24px;color:#aaa;font-size:13px;font-weight:bold;text-align:center;pointer-events:none;animation:fadeIn 0.2s ease;';
  el.innerText = '💨 相手は「グレイモン」の効果を発動しませんでした';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 2500);
  console.log('✅ 効果不発動通知');
}

function testTextDisplay() {
  const el = document.createElement('div');
  el.innerText = '⚡ テスト表示';
  el.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:1.5rem;font-weight:bold;z-index:60000;pointer-events:none;color:#00fbff;text-shadow:0 0 15px #00fbff;animation:dpChangePopup 1.2s ease forwards;';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1300);
  console.log('✅ テキスト表示');
}

function testEffectResult() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:55500;display:flex;align-items:center;justify-content:center;cursor:pointer;animation:fadeIn 0.2s ease;';
  ov.innerHTML = '<div style="text-align:center;">'
    + '<div style="color:#fff;font-size:14px;font-weight:bold;margin-bottom:8px;">「グレイモン」</div>'
    + '<div style="color:#ff4444;font-size:18px;font-weight:bold;text-shadow:0 0 15px #ff4444;letter-spacing:3px;">消滅！</div>'
    + '</div>';
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
  setTimeout(() => { if (ov.parentNode) ov.remove(); }, 2500);
  console.log('✅ カード名+結果表示');
}
