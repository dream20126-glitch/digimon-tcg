// バトル画面ロジック（battle-controls.md 準拠）
import { getCardImageUrl, getGoogleDriveDirectLink } from './cards.js';
import { loadAllDictionaries, triggerEffect, cardHasKeyword, expireBuffs, applyPermanentEffects, isTargetSelecting, calcPerCountValue } from './effect-engine.js';
import { rtdb, ref, set, update, onValue } from './firebase-config.js';

// ===== オンライン同期 =====
let _onlineMode = false;    // オンラインバトル中か
let _onlineRoomId = null;    // ルームID
let _onlineMyKey = null;     // 'player1' or 'player2'
let _onlineCmdListener = null; // Firebaseリスナー解除用
let _onlineCmdSeq = 0;       // コマンド連番
let _pendingBlockCallback = null; // ブロック応答待ちコールバック
let _pendingBlockResponse = null; // ブロック応答（コールバック前に届いた場合）

// 状態同期（効果解決後に自分のカード状態を相手に送信）
function sendStateSync() {
  if (!_onlineMode) return;
  // カードを軽量化（循環参照を避ける）
  const safeNum = (v) => (v === undefined || v === null || isNaN(v)) ? 0 : v;
  const serializeCard = (c) => {
    if (!c) return null;
    return {
      cardNo: c.cardNo || '', name: c.name || '', type: c.type || '', level: c.level || '',
      dp: safeNum(c.dp), baseDp: safeNum(c.baseDp), dpModifier: safeNum(c.dpModifier),
      cost: safeNum(c.cost), playCost: c.playCost !== null ? safeNum(c.playCost) : null,
      evolveCost: c.evolveCost !== null ? safeNum(c.evolveCost) : null,
      effect: c.effect || '', evoSourceEffect: c.evoSourceEffect || '', securityEffect: c.securityEffect || '',
      suspended: !!c.suspended, summonedThisTurn: !!c.summonedThisTurn,
      imgSrc: c.imgSrc || '', imageUrl: c.imageUrl || '', color: c.color || '', feature: c.feature || '',
      evolveCond: c.evolveCond || '', buffs: c.buffs || [],
      stack: (c.stack || []).map(serializeCard),
      _permEffects: c._permEffects || {},
      _usedEffects: c._usedEffects || []
    };
  };
  const state = {
    // 自分の状態（相手から見たbs.ai）
    battleArea: bs.player.battleArea.map(serializeCard),
    tamerArea: bs.player.tamerArea.map(serializeCard),
    ikusei: serializeCard(bs.player.ikusei),
    handCount: bs.player.hand.length,
    deckCount: bs.player.deck.length,
    trashCount: bs.player.trash.length,
    securityCount: bs.player.security.length,
    // 相手の状態（相手から見たbs.player）— セキュリティ等の変化を反映
    oppSecurityCount: bs.ai.security.length,
    oppDeckCount: bs.ai.deck.length,
    oppTrashCount: bs.ai.trash.length,
    oppBattleArea: bs.ai.battleArea.map(serializeCard),
    oppTamerArea: bs.ai.tamerArea.map(serializeCard),
    memory: bs.memory
  };
  sendCommand({ type: 'state_sync', state });
}

// オンライン状態を公開（effect-engine等から参照用）
window._isOnlineMode = () => _onlineMode;
window._onlineSendCommand = (cmd) => sendCommand(cmd);

// メモリー即時同期（コスト消費・効果発動時に即座に相手へ通知）
function sendMemoryUpdate() {
  if (!_onlineMode) return;
  sendCommand({ type: 'memory_update', memory: bs.memory });
}
window._sendMemoryUpdate = () => sendMemoryUpdate();

// コマンド送信（自分の操作を相手に伝える）
function sendCommand(cmd) {
  if (!_onlineMode || !_onlineRoomId) return;
  _onlineCmdSeq++;
  const path = `rooms/${_onlineRoomId}/commands/${_onlineCmdSeq}`;
  set(ref(rtdb, path), { ...cmd, from: _onlineMyKey, seq: _onlineCmdSeq, time: Date.now() });
}

// 相手の効果内容オーバーレイ（全効果共通デザイン）
// cardName: カード名, effectText: 効果テキスト, overlayId: DOM ID
function showRemoteEffectOverlay(cardName, effectText, overlayId) {
  const existing = document.getElementById(overlayId);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  const ov = document.createElement('div');
  ov.id = overlayId;
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
  const bx = document.createElement('div');
  bx.style.cssText = 'max-width:85%;padding:20px;background:rgba(0,10,20,0.95);border:2px solid #ff00fb;border-radius:12px;box-shadow:0 0 30px #ff00fb44;text-align:center;';
  bx.innerHTML = '<div style="color:#ff00fb;font-size:14px;font-weight:bold;margin-bottom:10px;text-shadow:0 0 8px #ff00fb;">⚡ 相手: ' + cardName + '</div>'
    + '<div style="color:#ddd;font-size:11px;line-height:1.6;text-align:left;margin-bottom:12px;max-height:100px;overflow-y:auto;">' + (effectText || '') + '</div>'
    + '<div style="color:#888;font-size:10px;">相手が効果を処理中...</div>';
  ov.appendChild(bx);
  document.body.appendChild(ov);
  // フォールバック: 15秒で自動消去
  setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 15000);
}

// コマンド受信（相手の操作を再現）
function onRemoteCommand(cmd) {
  if (!cmd || cmd.from === _onlineMyKey) return; // 自分のコマンドは無視
  console.log('[ONLINE] 受信:', cmd.type, cmd);

  switch (cmd.type) {
    case 'mulligan': break;
    case 'acceptHand': break;

    case 'waiting_close': {
      // 相手側の待機系オーバーレイをすべて閉じる（ブロック確認中、効果処理中など）
      ['_block-wait-overlay', '_remote-effect-announce', '_remote-confirm-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      break;
    }

    case 'memory_update': {
      // 相手のメモリー変更を即時反映（符号反転）
      if (cmd.memory !== undefined) { bs.memory = -cmd.memory; updateMemGauge(); }
      break;
    }

    case 'play': {
      const cardName = cmd.cardName || '???';
      const dummyCard = { name: cardName, imgSrc: cmd.cardImg || '', type: cmd.cardType || '', playCost: cmd.playCost || 0 };
      addLog('🎮 相手が「' + cardName + '」を' + (cmd.cardType === 'オプション' ? '使用！' : '登場！'));
      showPlayEffect(dummyCard, () => {});
      break;
    }

    case 'evolve': {
      const dummyEvolved = { name: cmd.cardName || '???', imgSrc: cmd.cardImg || '', level: '', dp: 0 };
      const dummyBase = { name: cmd.baseName || '???', imgSrc: '' };
      addLog('🎮 相手が「' + cmd.baseName + '」→「' + cmd.cardName + '」に進化！');
      showEvolveEffect(cmd.evolveCost || 0, cmd.baseName || '', dummyBase, dummyEvolved, () => {});
      break;
    }

    case 'attack_security': {
      const atkName = cmd.atkName || bs.ai.battleArea[cmd.atkIdx]?.name || '???';
      addLog('🎮 相手の「' + atkName + '」でセキュリティアタック！');
      showYourTurn('⚔ 相手アタック！', '「' + atkName + '」→ セキュリティ', '#ff4444', () => {
        checkOnlineBlock(cmd);
      });
      break;
    }
    case 'security_remove': {
      // 自分のセキュリティが相手の攻撃で減った
      if (bs.player.security.length > 0) {
        const removed = bs.player.security.splice(0,1)[0];
        bs.player.trash.push(removed);
        addLog('🛡 セキュリティが減少（残り' + bs.player.security.length + '枚）');
        renderAll();
      }
      break;
    }

    case 'attack_digimon': {
      const atkName2 = cmd.atkName || bs.ai.battleArea[cmd.atkIdx]?.name || '???';
      const defName2 = cmd.defName || bs.player.battleArea[cmd.defIdx]?.name || '???';
      addLog('🎮 相手の「' + atkName2 + '」が「' + defName2 + '」にアタック！');
      showYourTurn('⚔ 相手アタック！', '「' + atkName2 + '」→「' + defName2 + '」', '#ff4444', () => {
        checkOnlineBlock(cmd);
      });
      break;
    }

    case 'endTurn': {
      // 相手がターン終了 → 自分のターン開始
      // メモリーを反転（相手の-3は自分の+3）
      bs.memory = cmd.memory !== undefined ? -cmd.memory : 3;
      bs.isFirstTurn = false;
      updateMemGauge();
      expireBuffs(bs, 'dur_this_turn');
      renderAll();
      showYourTurn('相手のターン終了','','#555555', () => {
        bs.isPlayerTurn = true;
        showYourTurn('自分のターン開始','','#00fbff', () => {
          checkTurnStartEffects('player', () => {
            applyPermanentEffects(bs, 'player', makeEffectContext(null,'player'));
            applyPermanentEffects(bs, 'ai', makeEffectContext(null,'ai'));
            renderAll();
            setTimeout(() => startPhase('unsuspend'), 300);
          });
        });
      });
      break;
    }

    case 'effect_confirm': window.confirmEffect(cmd.yes); break;

    case 'block_response': {
      // 相手のブロック応答を受信（攻撃側で処理）
      if (cmd.blocked) {
        // ブロックされた → 攻撃側のカードを更新
        const atkIdx = cmd.atkIdx;
        const atk = bs.player.battleArea[atkIdx];
        if (atk && (cmd.atkResult === 'destroyed' || cmd.atkResult === 'both_destroyed')) {
          bs.player.battleArea[atkIdx] = null;
          bs.player.trash.push(atk);
          if (atk.stack) atk.stack.forEach(s => bs.player.trash.push(s));
          renderAll();
        }
      }
      if (_pendingBlockCallback) {
        const cb = _pendingBlockCallback;
        _pendingBlockCallback = null;
        cb(cmd);
      } else {
        _pendingBlockResponse = cmd;
      }
      break;
    }

    case 'effect_start': {
      addLog('🎮 相手が「' + cmd.cardName + '」の効果を発動！');
      if (cmd.effectText) showRemoteEffectOverlay(cmd.cardName, cmd.effectText, '_remote-effect-announce');
      break;
    }
    case 'fx_confirmShow': {
      showRemoteEffectOverlay(cmd.cardName, cmd.effectText || '', '_remote-confirm-overlay');
      break;
    }
    case 'fx_confirmClose': {
      const remOv = document.getElementById('_remote-confirm-overlay');
      if (remOv && remOv.parentNode) remOv.parentNode.removeChild(remOv);
      break;
    }
    case 'fx_effectDeclined': {
      // 相手が任意効果を「いいえ」→ 発動しなかった旨を表示
      const decOv = document.createElement('div');
      decOv.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);z-index:56000;background:rgba(30,30,40,0.9);border:1px solid #888;border-radius:10px;padding:12px 24px;color:#aaa;font-size:13px;font-weight:bold;text-align:center;pointer-events:none;animation:fadeIn 0.2s ease;';
      decOv.innerText = '💨 相手は「' + (cmd.cardName || '') + '」の効果を発動しませんでした';
      document.body.appendChild(decOv);
      setTimeout(() => { if (decOv.parentNode) { decOv.style.animation = 'fadeOut 0.5s ease forwards'; setTimeout(() => { if (decOv.parentNode) decOv.parentNode.removeChild(decOv); }, 500); } }, 2000);
      break;
    }
    case 'game_end': {
      if (cmd.result === 'defeat') {
        showGameEndOverlay('😢 敗北...', 'defeat', () => { cleanupBattle(); showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen'); _onlineMode=false; });
      } else {
        showGameEndOverlay('🎉 勝利！', 'victory', () => { cleanupBattle(); showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen'); _onlineMode=false; });
      }
      break;
    }
    case 'player_exit': {
      // 相手が途中退室
      const exitName = cmd.playerName || '相手';
      const exitOv = document.createElement('div');
      exitOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:60000;display:flex;align-items:center;justify-content:center;';
      const exitBox = document.createElement('div');
      exitBox.style.cssText = 'background:#0a0a1a;border:2px solid #ff4444;border-radius:12px;padding:24px;text-align:center;max-width:300px;width:90%;';
      exitBox.innerHTML = '<div style="color:#ff4444;font-size:16px;font-weight:bold;margin-bottom:12px;">⚠ 途中退室</div>'
        + '<div style="color:#ccc;font-size:13px;margin-bottom:20px;">「' + exitName + '」が途中退室しました。<br>バトルは続行できません。</div>'
        + '<button id="_exit-return-btn" style="background:#ff4444;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">ゲートを出る</button>';
      exitOv.appendChild(exitBox);
      document.body.appendChild(exitOv);
      document.getElementById('_exit-return-btn').onclick = () => {
        if (exitOv.parentNode) exitOv.parentNode.removeChild(exitOv);
        cleanupBattle();
        showScreen('room-entrance-screen');
        _onlineMode = false;
      };
      break;
    }

    case 'hatch': {
      // 育成エリアに即反映
      if (bs.ai.tamaDeck.length > 0) {
        bs.ai.ikusei = bs.ai.tamaDeck.splice(0,1)[0];
      }
      renderAll();
      const hatchCard = { name: cmd.cardName || '???', imgSrc: cmd.cardImg || '' };
      addLog('🎮 相手が「' + hatchCard.name + '」を孵化！');
      showHatchEffect(hatchCard, () => {});
      break;
    }

    case 'breed_evolve': {
      // 育成エリアで即反映
      const evoCard = bs.ai.hand[cmd.handIdx];
      if (evoCard && bs.ai.ikusei) {
        bs.ai.hand.splice(cmd.handIdx, 1);
        const old = bs.ai.ikusei;
        evoCard.stack = [...(old.stack||[]), old];
        evoCard.suspended = old.suspended;
        evoCard.baseDp = parseInt(evoCard.dp)||0;
        evoCard.dpModifier = 0; evoCard.buffs = [];
        bs.ai.ikusei = evoCard;
      }
      renderAll();
      const dummyEvo = { name: cmd.cardName || '???', imgSrc: cmd.cardImg || '', level: '', dp: 0 };
      const dummyOld = { name: cmd.baseName || '???', imgSrc: '' };
      addLog('🎮 相手が育成で「' + cmd.baseName + '」→「' + cmd.cardName + '」に進化！');
      showEvolveEffect(cmd.evolveCost || 0, cmd.baseName || '', dummyOld, dummyEvo, () => {});
      break;
    }

    case 'breed_move': {
      // 育成エリアをクリアしてバトルエリアに追加（state_sync前に即反映）
      if (bs.ai.ikusei) {
        let slot = bs.ai.battleArea.findIndex(s => s===null);
        if (slot===-1) { slot=bs.ai.battleArea.length; bs.ai.battleArea.push(null); }
        bs.ai.battleArea[slot] = bs.ai.ikusei;
        bs.ai.ikusei = null;
      }
      renderAll();
      addLog('🎮 相手が「' + (cmd.cardName||'???') + '」をバトルエリアへ移動！');
      showYourTurn('🐾 バトルエリアへ移動', cmd.cardName||'', '#00fbff', () => {});
      break;
    }

    case 'activate_effect': {
      const card = bs.ai.battleArea[cmd.slotIdx];
      if (card) addLog('🎮 相手が「' + card.name + '」の効果を発動！');
      // 効果処理は相手側で実行、結果はstate_syncで反映
      break;
    }
    case 'activate_tamer_effect': {
      const tamer = bs.ai.tamerArea[cmd.tamerIdx];
      if (tamer) addLog('🎮 相手がテイマー「' + tamer.name + '」の効果を発動！');
      break;
    }
    case 'state_sync': {
      // 相手の状態を bs.ai に反映
      const st = cmd.state;
      if (!st) break;
      const restoreCard = (data) => {
        if (!data) return null;
        return { ...data, buffs: data.buffs || [], stack: (data.stack || []).map(restoreCard) };
      };
      // 相手の状態を bs.ai に反映
      if (st.battleArea) bs.ai.battleArea = st.battleArea.map(restoreCard);
      if (st.tamerArea) bs.ai.tamerArea = st.tamerArea.map(restoreCard);
      bs.ai.ikusei = st.ikusei ? restoreCard(st.ikusei) : bs.ai.ikusei;
      const adjustArr = (arr, count) => { while(arr.length>count)arr.pop(); while(arr.length<count)arr.push({name:'?',type:'不明',dp:0}); };
      if (st.deckCount !== undefined) adjustArr(bs.ai.deck, st.deckCount);
      if (st.handCount !== undefined) adjustArr(bs.ai.hand, st.handCount);
      if (st.trashCount !== undefined) adjustArr(bs.ai.trash, st.trashCount);
      if (st.securityCount !== undefined) adjustArr(bs.ai.security, st.securityCount);
      // 自分の状態: セキュリティ等はstate_syncで上書きしない（ズレの原因になる）
      // 代わりにアタック等の個別コマンドで同期する
      if (st.memory !== undefined) { bs.memory = -st.memory; updateMemGauge(); }
      renderAll();
      break;
    }
    // ===== 演出コマンド（fx_） =====
    case 'fx_battleResult': {
      showBattleResult(cmd.text, cmd.color, cmd.sub, () => {});
      break;
    }
    case 'fx_destroy': {
      showDestroyEffect({ name: cmd.cardName, imgSrc: cmd.cardImg }, () => {});
      break;
    }
    case 'fx_securityCheck': {
      const secCard = { name: cmd.secName, imgSrc: cmd.secImg, dp: cmd.secDp, type: cmd.secType };
      const atkCard = { name: cmd.atkName, imgSrc: cmd.atkImg, dp: cmd.atkDp };
      // VS演出を表示しつつ、セキュリティカウントも更新
      showSecurityCheck(secCard, atkCard, () => { renderAll(); }, cmd.customLabel || null);
      break;
    }
    case 'fx_directAttack': {
      showDirectAttack({ name: cmd.atkName, imgSrc: cmd.atkImg }, cmd.side, () => {});
      break;
    }
    case 'fx_option': {
      showOptionEffect({ name: cmd.cardName, imgSrc: cmd.cardImg }, () => {});
      break;
    }
    case 'fx_sAttackPlus': {
      showSAttackPlusAnnounce(cmd.n, () => {});
      break;
    }
    case 'fx_effectAnnounce': {
      showRemoteEffectOverlay(cmd.cardName, cmd.effectText || '', '_remote-effect-announce');
      break;
    }
    case 'fx_effectClose': {
      const ea = document.getElementById('_remote-effect-announce');
      if (ea && ea.parentNode) ea.parentNode.removeChild(ea);
      break;
    }
    case 'fx_deckOpen': {
      // 相手のデッキオープン: めくれたカード一覧を表示
      if (!cmd.cards || cmd.cards.length === 0) break;
      const openOverlay = document.createElement('div');
      openOverlay.id = '_remote-deck-open';
      openOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:55000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;pointer-events:none;';
      const openTitle = document.createElement('div');
      openTitle.style.cssText = 'font-size:1rem;font-weight:bold;color:#ffaa00;letter-spacing:2px;text-shadow:0 0 10px #ffaa00;';
      openTitle.innerText = '📖 相手: DECK OPEN';
      openOverlay.appendChild(openTitle);
      const openRow = document.createElement('div');
      openRow.style.cssText = 'display:flex;gap:10px;justify-content:center;padding:12px 20px;background:rgba(0,15,25,0.9);border:1px solid #ffaa0044;border-radius:12px;';
      cmd.cards.forEach(c => {
        const wrap = document.createElement('div');
        wrap.dataset.cardname = c.name;
        wrap.style.cssText = 'text-align:center;transition:opacity 0.5s;';
        wrap.innerHTML = (c.imgSrc ? '<img src="'+c.imgSrc+'" style="width:55px;height:77px;object-fit:cover;border-radius:4px;border:1px solid #ffaa00;">' : '')
          + '<div style="color:#fff;font-size:9px;margin-top:2px;">'+c.name+'</div>';
        openRow.appendChild(wrap);
      });
      openOverlay.appendChild(openRow);
      document.body.appendChild(openOverlay);
      // fx_deckOpenClose が来るまで表示し続ける（フォールバック30秒で自動消去）
      window._remoteDeckOpenOverlay = openOverlay;
      setTimeout(() => { if(openOverlay.parentNode) openOverlay.parentNode.removeChild(openOverlay); }, 30000);
      break;
    }
    case 'fx_cardPlace': {
      // 相手がカードを配置: トースト + オープンUI上のカードをフェードアウト
      const placeMsg = cmd.msg || (cmd.cardName + ' → ' + cmd.zone);
      const toast = document.createElement('div');
      toast.innerText = '🎮 ' + placeMsg;
      toast.style.cssText = 'position:fixed;bottom:25%;left:50%;transform:translateX(-50%);z-index:95000;background:rgba(255,170,0,0.2);border:1px solid #ffaa00;color:#fff;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:10px;text-align:center;pointer-events:none;box-shadow:0 0 15px rgba(255,170,0,0.4);';
      document.body.appendChild(toast);
      setTimeout(() => { if(toast.parentNode) toast.parentNode.removeChild(toast); }, 2500);
      // オープンUI上の該当カードをフェードアウト
      if (window._remoteDeckOpenOverlay) {
        const cards = window._remoteDeckOpenOverlay.querySelectorAll('[data-cardname]');
        for (const el of cards) {
          if (el.dataset.cardname === cmd.cardName && el.style.opacity !== '0.2') {
            el.style.opacity = '0.2';
            break; // 1枚だけ消す
          }
        }
      }
      break;
    }
    case 'fx_deckOpenClose': {
      // 相手のデッキオープンUI終了
      if (window._remoteDeckOpenOverlay && window._remoteDeckOpenOverlay.parentNode) {
        window._remoteDeckOpenOverlay.parentNode.removeChild(window._remoteDeckOpenOverlay);
        window._remoteDeckOpenOverlay = null;
      }
      break;
    }
    case 'fx_effectResult': {
      // 相手の効果結果（選択カード画像＋アクション）を表示
      const erOv = document.createElement('div');
      erOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:55500;display:flex;align-items:center;justify-content:center;cursor:pointer;animation:fadeIn 0.2s ease;';
      const erBx = document.createElement('div');
      erBx.style.cssText = 'text-align:center;max-width:85%;';
      // カード画像
      if (cmd.cardImg) {
        erBx.innerHTML += '<div style="margin-bottom:12px;"><img src="' + cmd.cardImg + '" style="width:100px;height:140px;object-fit:cover;border-radius:8px;border:2px solid #ff00fb;box-shadow:0 0 20px #ff00fb44;"></div>';
      }
      // カード名＋アクション
      const actionColors = { '登場！':'#ffaa00', '消滅！':'#ff4444', '手札に戻す！':'#00fbff', 'レスト！':'#ff9900', 'アクティブ！':'#00ff88', '進化！':'#aa66ff', 'リカバリー！':'#00ff88', 'DP強化！':'#00ff88', 'DP弱体化！':'#ff4444' };
      const labelColor = actionColors[cmd.actionLabel] || '#ff00fb';
      erBx.innerHTML += '<div style="color:#fff;font-size:14px;font-weight:bold;margin-bottom:8px;">「' + (cmd.cardName||'') + '」</div>';
      erBx.innerHTML += '<div style="color:' + labelColor + ';font-size:18px;font-weight:bold;text-shadow:0 0 15px ' + labelColor + ';letter-spacing:3px;">' + (cmd.actionLabel||'') + '</div>';
      erOv.appendChild(erBx);
      document.body.appendChild(erOv);
      let erDone = false;
      function erFinish() { if (erDone) return; erDone = true; if (erOv.parentNode) erOv.parentNode.removeChild(erOv); }
      setTimeout(() => { erOv.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(erFinish, 300); }, 2500);
      erOv.onclick = erFinish;
      break;
    }

    case 'phase': {
      // 相手のフェイズ演出を表示
      const phaseInfo = PHASE_NAMES[cmd.phase];
      if (phaseInfo) {
        const colors = { unsuspend:'#00fbff', draw:'#00ff88', breed:'#ff9900', main:'#ff00fb' };
        showPhaseAnnounce(`${phaseInfo.icon} 相手: ${phaseInfo.name}`, colors[cmd.phase], () => {});
      }
      break;
    }
  }
}

// オンライン用: 相手がプレイヤーのセキュリティをチェック
function resolveSecurityCheckOnline(atk, atkIdx) {
  doAiSecurityCheck(atk, atkIdx, () => { renderAll(); });
}

// Firebaseコマンドリスナー開始
function startOnlineListener() {
  if (_onlineCmdListener) _onlineCmdListener();
  const startTime = Date.now(); // リスナー開始時刻
  _onlineCmdListener = onValue(ref(rtdb, `rooms/${_onlineRoomId}/commands`), (snap) => {
    const cmds = snap.val();
    if (!cmds) return;
    Object.values(cmds).sort((a,b) => a.seq - b.seq).forEach(cmd => {
      // 自分のコマンド、処理済みコマンド、古いコマンドは無視
      if (cmd.from === _onlineMyKey) return;
      if (cmd.seq <= _onlineCmdSeq) return;
      if (cmd.time && cmd.time < startTime) return; // リスナー開始前のコマンドは無視
      _onlineCmdSeq = cmd.seq;
      onRemoteCommand(cmd);
    });
  });
}

// オンラインバトル開始用
window.startOnlineBattle = async function(playerDeckData, oppDeckData, playerFirst, roomId, myKey, oppName) {
  _onlineMode = true;
  _onlineRoomId = roomId;
  _onlineMyKey = myKey;
  _onlineCmdSeq = 0;
  // 前回のコマンドをクリア
  await set(ref(rtdb, `rooms/${_onlineRoomId}/commands`), null);
  await startBattleGame(playerDeckData, oppDeckData, playerFirst);
  // 相手の名前を表示
  const oppLabel = document.getElementById('opponent-name-label');
  if (oppLabel) oppLabel.innerText = '🎮 ' + (oppName || '相手プレイヤー');
  startOnlineListener();
};

const MEM_MIN = -10, MEM_MAX = 10;
const PHASE_NAMES = {
  unsuspend: { icon:'🔄', name:'アクティブフェイズ' },
  draw:      { icon:'🃏', name:'ドローフェイズ' },
  breed:     { icon:'🥚', name:'育成フェイズ' },
  main:      { icon:'⚡', name:'メインフェイズ' }
};
const PHASE_DESC = {
  unsuspend: { icon:'🔄', title:'アクティブフェイズ', desc:'レスト状態のカードをすべてアクティブに戻します。' },
  draw:      { icon:'🃏', title:'ドローフェイズ',     desc:'デッキからカードを1枚引きます。\n※先攻1ターン目はドローしません。' },
  breed:     { icon:'🥚', title:'育成フェイズ',       desc:'デジタマ孵化・育成移動・パスのどれかを選びます。' },
  main:      { icon:'⚡', title:'メインフェイズ',     desc:'登場・進化・アタックなどを行います。' }
};

let bs = {
  turn:1, phase:'standby', isPlayerTurn:true, memory:0, isFirstTurn:true,
  player:{ deck:[], tamaDeck:[], hand:[], battleArea:[null,null,null,null,null], tamerArea:[], ikusei:null, security:[], trash:[] },
  ai:    { deck:[], tamaDeck:[], hand:[], battleArea:[null,null,null,null,null], tamerArea:[], ikusei:null, security:[], trash:[] },
  selHand:null, selSlot:null,
  attackingSlot:null // アタック中のスロット
};
let mulliganUsed = false;
let _pendingEffectCard = null;
let _pendingEffectCallback = null;

const cardBackUrl = getGoogleDriveDirectLink('https://drive.google.com/file/d/1NKWqHuWnKpBbfMY9OPPpuYDtJcsVy9i9/view');
const tamaBackUrl = getGoogleDriveDirectLink('https://drive.google.com/file/d/1-Os-ZfmgLlQeYGkTU1uUXrt7iowy0FLD/view');
const playerIconUrl = getGoogleDriveDirectLink('https://drive.google.com/file/d/1fVyZJvx4BnDZij_X22AljhAr3oUm8BcE/view');

function cardImg(card) { return card.imgSrc || getCardImageUrl(card) || ''; }

// ===== ゲーム開始 =====
window.startBattleGame = async function(playerDeckData, aiDeckData, playerFirst) {
  // ローディングオーバーレイ（「自分のターン」と同じ演出風）
  const loadingOverlay = document.createElement('div');
  loadingOverlay.style.cssText = 'position:fixed;inset:0;z-index:50000;background:#000;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;';

  const loadFlash = document.createElement('div');
  loadFlash.style.cssText = 'position:absolute;inset:0;opacity:0;background:#ffaa00;animation:turnFlash 2s ease infinite;';
  loadingOverlay.appendChild(loadFlash);

  const loadLineTop = document.createElement('div');
  loadLineTop.style.cssText = 'position:absolute;top:38%;left:0;right:0;height:2px;background:linear-gradient(90deg, transparent, #ffaa00, transparent);animation:turnLineExpand 2s ease infinite;';
  loadingOverlay.appendChild(loadLineTop);

  const loadLineBottom = document.createElement('div');
  loadLineBottom.style.cssText = 'position:absolute;top:62%;left:0;right:0;height:2px;background:linear-gradient(90deg, transparent, #ffaa00, transparent);animation:turnLineExpand 2s ease 0.1s infinite;';
  loadingOverlay.appendChild(loadLineBottom);

  const loadText = document.createElement('div');
  loadText.style.cssText = 'position:relative;z-index:1;font-size:1.5rem;font-weight:900;color:#ffaa00;letter-spacing:4px;text-shadow:0 0 30px #ffaa00, 0 0 60px #ffaa00, 0 0 100px #ffaa00;';
  loadText.innerText = 'Loading...';
  loadingOverlay.appendChild(loadText);

  const loadSub = document.createElement('div');
  loadSub.style.cssText = 'position:relative;z-index:1;font-size:0.8rem;color:#ffffff66;margin-top:8px;';
  loadSub.innerText = 'データを読み込み中';
  loadingOverlay.appendChild(loadSub);

  document.body.appendChild(loadingOverlay);

  // 辞書を読み込み
  await loadAllDictionaries();

  bs.turn=1; bs.memory=0; bs.isPlayerTurn=playerFirst; bs.isFirstTurn=true;
  bs.selHand=null; bs.selSlot=null; bs.attackingSlot=null;
  bs._battleAborted=false; bs._pendingTurnEnd=false; bs._usedLimits={}; bs._securityBuffs=[];
  const oppLabel = document.getElementById('opponent-name-label');
  if (oppLabel) oppLabel.innerText = _onlineMode ? '🎮 相手プレイヤー' : '🤖 デジモンマスター';
  const plCards=parseDeck(playerDeckData), aiCards=parseDeck(aiDeckData);
  if (_onlineMode) {
    // オンライン: デッキ所有者のキーでシードを生成（両クライアントで同じ順番に）
    const oppKey = _onlineMyKey === 'player1' ? 'player2' : 'player1';
    const mySeed = strToSeed(_onlineRoomId + '_' + _onlineMyKey);
    const oppSeed = strToSeed(_onlineRoomId + '_' + oppKey);
    bs.player.tamaDeck = seededShuffle(plCards.filter(c => c.level==='2'), mySeed);
    bs.player.deck = seededShuffle(plCards.filter(c => c.level!=='2'), mySeed + 1);
    bs.ai.tamaDeck = seededShuffle(aiCards.filter(c => c.level==='2'), oppSeed);
    bs.ai.deck = seededShuffle(aiCards.filter(c => c.level!=='2'), oppSeed + 1);
  } else {
    bs.player.tamaDeck = shuffle(plCards.filter(c => c.level==='2'));
    bs.player.deck = shuffle(plCards.filter(c => c.level!=='2'));
    bs.ai.tamaDeck = aiCards.filter(c => c.level==='2');
    bs.ai.deck = aiCards.filter(c => c.level!=='2');
  }
  bs.player.hand=bs.player.deck.splice(0,5);
  if (!_onlineMode) {
    // AI側デッキ: シャッフルせず理想的な順番に並べ直す
    bs.ai.deck = sortAiDeckWithSecurity(bs.ai.deck);
  }
  bs.ai.hand=bs.ai.deck.splice(0,5);
  bs.player.battleArea=[]; bs.ai.battleArea=[];
  bs.player.tamerArea=[]; bs.ai.tamerArea=[];
  bs.player.ikusei=null; bs.ai.ikusei=null;
  bs.player.trash=[]; bs.ai.trash=[]; bs.player.security=[]; bs.ai.security=[];

  // ローディング消去 → ゲートオープン演出（背景は黒のまま）
  if (loadingOverlay.parentNode) loadingOverlay.parentNode.removeChild(loadingOverlay);
  showGateOpen(() => {
    // 演出終了後にバトル画面 → マリガン
    showScreen('battle-screen');
    setTimeout(() => showMulliganOverlay(), 400);
  });
};

// ===== デジタルゲートオープン演出 =====
function showGateOpen(callback) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:45000;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.95);overflow:hidden;';

  // 背景エフェクト（放射状の光）
  const bgEffect = document.createElement('div');
  bgEffect.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at center, rgba(0,251,255,0.15) 0%, rgba(0,0,0,0) 70%);animation:gateGlow 2s ease-in-out;';
  overlay.appendChild(bgEffect);

  // 横ライン（上）
  const lineTop = document.createElement('div');
  lineTop.style.cssText = 'position:absolute;top:30%;left:0;right:0;height:2px;background:linear-gradient(90deg, transparent, #00fbff, transparent);animation:gateLineExpand 1.5s ease forwards;transform:scaleX(0);';
  overlay.appendChild(lineTop);

  // 横ライン（下）
  const lineBottom = document.createElement('div');
  lineBottom.style.cssText = 'position:absolute;top:70%;left:0;right:0;height:2px;background:linear-gradient(90deg, transparent, #00fbff, transparent);animation:gateLineExpand 1.5s ease 0.1s forwards;transform:scaleX(0);';
  overlay.appendChild(lineBottom);

  // メインテキスト
  const textEl = document.createElement('div');
  textEl.style.cssText = 'position:relative;z-index:1;font-size:clamp(1.8rem, 9vw, 3.5rem);font-weight:900;color:#00fbff;letter-spacing:clamp(3px, 2vw, 10px);text-shadow:0 0 30px #00fbff, 0 0 60px #00fbff, 0 0 100px #00fbff, 0 0 150px rgba(0,251,255,0.3);opacity:0;animation:gateTextAppear 1.8s ease 0.3s forwards;text-align:center;padding:0 12px;line-height:1.4;';
  textEl.innerHTML = 'デジタルゲート<br>オープン！';
  overlay.appendChild(textEl);

  // サブテキスト
  const subEl = document.createElement('div');
  subEl.style.cssText = 'position:relative;z-index:1;font-size:clamp(0.7rem, 3vw, 0.9rem);color:#ffffff88;letter-spacing:clamp(1px, 1vw, 3px);margin-top:12px;opacity:0;animation:gateTextAppear 1.5s ease 0.8s forwards;text-align:center;padding:0 16px;';
  subEl.innerText = '— デジタルワールドへようこそ —';
  overlay.appendChild(subEl);

  // パーティクル（光の粒）
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = 2 + Math.random() * 4;
    const delay = Math.random() * 1.5;
    particle.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:${size}px;height:${size}px;background:#00fbff;border-radius:50%;opacity:0;animation:gateParticle 2s ease ${delay}s forwards;box-shadow:0 0 ${size*3}px #00fbff;`;
    overlay.appendChild(particle);
  }

  document.body.appendChild(overlay);

  let called = false;
  function finish() {
    if (called) return;
    called = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback();
  }

  setTimeout(() => {
    overlay.style.transition = 'opacity 0.5s ease';
    overlay.style.opacity = '0';
    setTimeout(finish, 500);
  }, 5000);

  overlay.addEventListener('click', finish, { once: true });
}

function parseDeck(deckData) {
  if(!deckData||!deckData.list) return [];
  const out=[];
  deckData.list.split(',').forEach(line => {
    const m=line.match(/(.+)\((.+)\)x(\d+)/);
    if(!m) return;
    const cardNo=m[2], count=parseInt(m[3]);
    const obj=allCards.find(c => c["カードNo"]===cardNo)||{};
    const playCost=obj["登場コスト"], evolveCost=obj["進化コスト"];
    const hasPlay=playCost!==undefined&&playCost!==''&&playCost!==null;
    const hasEvolve=evolveCost!==undefined&&evolveCost!==''&&evolveCost!==null;
    for(let i=0;i<count;i++) out.push({
      name: obj["名前"]||m[1], cardNo, level: String(obj["レベル"]||'?'),
      dp: parseInt(obj["DP"]||0),
      baseDp: parseInt(obj["DP"]||0),
      dpModifier: 0,
      playCost: hasPlay ? parseInt(playCost) : null,
      evolveCost: hasEvolve ? parseInt(evolveCost) : null,
      evolveCond: obj["進化条件"]||'',
      cost: hasPlay ? parseInt(playCost) : hasEvolve ? parseInt(evolveCost) : 0,
      effect: obj["効果"]||'', evoSourceEffect: obj["進化元効果"]||'', securityEffect: obj["セキュリティ効果"]||'', recipe: obj["効果レシピ"]||null,
      imageUrl: obj["ImageURL"]||'', imgSrc: getCardImageUrl(obj)||'',
      type: obj["タイプ"]||'', color: obj["色"]||'',
      feature: obj["特徴"]||'',
      stack: [], suspended: false, buffs: [],
      cantBeActive: false, cantAttack: false, cantBlock: false,
      summonedThisTurn: false, _pendingDestroy: false
    });
  });
  // レシピ未設定カードにデフォルトレシピを注入（スプレッドシート対応前の暫定）
  const defaultRecipes = {
    'ST2-15': { "main": [
      {"action": "select", "target": "own", "store": "A"},
      {"action": "select_evo_source", "from": "A", "filter": "デジモン", "store": "B"},
      {"action": "summon", "card": "B"}
    ]},
    'ST1-15': { "main": [
      {"action": "select_multi", "target": "opponent", "condition": "dp_le:4000", "count": 2, "store": "T"},
      {"action": "destroy", "card": "T"}
    ]},
    'AD1-007': {
      "on_evolve": [
        {"action": "select_from_hand_trash", "filter_name": "ガンマモン", "filter_type": "デジモン", "count": 3, "store": "G"},
        {"action": "add_to_evo_source", "card": "G", "target": "self"},
        {"action": "destroy_by_dp"}
      ],
      "on_attack": [
        {"action": "select_from_hand_trash", "filter_name": "ガンマモン", "filter_type": "デジモン", "count": 3, "store": "G"},
        {"action": "add_to_evo_source", "card": "G", "target": "self"},
        {"action": "destroy_by_dp"}
      ],
      "on_own_turn_end": [
        {"action": "enable_attack_without_rest", "require": {"evo_count": 5}}
      ]
    }
  };
  out.forEach(card => {
    if (!card.recipe && defaultRecipes[card.cardNo]) {
      card.recipe = defaultRecipes[card.cardNo];
    }
  });
  return out;
}

function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

// シード付きシャッフル（オンライン用: 同じシードなら同じ結果）
function seededShuffle(a, seed) {
  let s = Math.abs(seed) || 1;
  function rand() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function strToSeed(str) { let h=0; for(let i=0;i<str.length;i++){h=((h<<5)-h)+str.charCodeAt(i); h|=0;} return h; }

// AIデッキの並び順を最適化（セキュリティ5枚→初手5枚→残りデッキ）
function sortAiDeckWithSecurity(cards) {
  // カードをタイプ別に分類
  const pool = [...cards];
  const grab = (filter, n) => {
    const result = [];
    for (let i = 0; i < n; i++) {
      const idx = pool.findIndex(filter);
      if (idx === -1) break;
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  };

  // ① セキュリティ5枚: ギガデストロイヤー1, ガイアフォース1, デジモンLv4x2, デジモンLv3x1
  const sec = [
    ...grab(c => c.cardNo === 'ST1-15', 1),  // ギガデストロイヤー
    ...grab(c => c.cardNo === 'ST1-16', 1),  // ガイアフォース
    ...grab(c => c.type==='デジモン' && parseInt(c.level)===4, 2),
    ...grab(c => c.type==='デジモン' && parseInt(c.level)===3, 1),
  ];
  // 足りなければ補充
  while (sec.length < 5 && pool.length > 0) sec.push(pool.shift());

  // ② 初手5枚: Lv3x2, Lv4x1, テイマーx1, Lv3x1
  const hand = [
    ...grab(c => c.type==='デジモン' && parseInt(c.level)===3, 2),
    ...grab(c => c.type==='デジモン' && parseInt(c.level)===4, 1),
    ...grab(c => c.type==='テイマー', 1),
    ...grab(c => c.type==='デジモン' && parseInt(c.level)===3, 1),
  ];
  while (hand.length < 5 && pool.length > 0) {
    const idx = pool.findIndex(c => c.type==='デジモン' && parseInt(c.level)===3)
      || pool.findIndex(c => c.type==='デジモン' && parseInt(c.level)===4);
    if (idx > 0) hand.push(pool.splice(idx, 1)[0]);
    else hand.push(pool.shift());
  }

  // ③ 残り: Lv4→Lv3→Lv5→テイマー→オプション→Lv6 の順
  pool.sort((a, b) => {
    const order = c => {
      if (c.type==='デジモン' && parseInt(c.level)===4) return 0;
      if (c.type==='デジモン' && parseInt(c.level)===3) return 1;
      if (c.type==='デジモン' && parseInt(c.level)===5) return 2;
      if (c.type==='テイマー') return 3;
      if (c.type==='オプション') return 4;
      if (c.type==='デジモン' && parseInt(c.level)>=6) return 5;
      return 6;
    };
    return order(a) - order(b);
  });

  return [...sec, ...hand, ...pool];
}

// ===== 効果判定ヘルパー =====
function hasKeyword(card, keyword) { return card && card.effect && card.effect.includes(keyword); }
function hasEvoKeyword(card, keyword) {
  if (hasKeyword(card, keyword)) return true;
  if (card.stack) return card.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes(keyword));
  return false;
}

// ===== マリガン =====
function showMulliganOverlay() {
  mulliganUsed=false;
  const btn=document.getElementById('mulligan-btn');
  if(btn){btn.disabled=false;btn.style.opacity='1';btn.innerText='引き直す';}
  document.getElementById('mulligan-overlay').style.display='flex';
  renderMulliganPreview(true); // アニメーション付き
}

function renderMulliganPreview(animate) {
  const area=document.getElementById('mulligan-hand-preview'); if(!area) return;
  area.innerHTML='';
  const cards=[];
  bs.player.hand.forEach((c,i) => {
    const src=cardImg(c);
    const div=document.createElement('div');
    div.className='mulligan-card';
    div.style.perspective='200px';
    // 最初は裏面
    const backSrc=cardBackUrl;
    div.innerHTML=`<div class="mulligan-card-inner" style="width:100%;height:100%;position:relative;transition:transform 0.5s;transform-style:preserve-3d;">
      <div style="position:absolute;inset:0;backface-visibility:hidden;">${backSrc?`<img src="${backSrc}" style="width:100%;height:100%;object-fit:cover;">`:'<div style="width:100%;height:100%;background:#1a1a3a;border-radius:4px;"></div>'}</div>
      <div style="position:absolute;inset:0;backface-visibility:hidden;transform:rotateY(180deg);">${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="font-size:7px;color:#aaa;padding:3px;">${c.name}</div>`}</div>
    </div>`;
    div.onclick = () => showBCD(i, 'mulliganHand');
    if(animate) {
      div.style.animation=`mulliganDeal 0.4s ease ${i*0.15}s forwards`;
    } else {
      div.style.opacity='1';
      // アニメなしなら最初から表面
      const inner=div.querySelector('.mulligan-card-inner');
      if(inner) inner.style.transform='rotateY(180deg)';
    }
    area.appendChild(div);
    cards.push(div);
  });

  if(animate) {
    // 5枚揃ったら一斉にめくる（最後のカード着地後）
    const flipDelay = 5*150 + 400 + 200; // 最後のカード配布完了+少し待つ
    setTimeout(() => {
      cards.forEach((div,i) => {
        const inner=div.querySelector('.mulligan-card-inner');
        if(inner) {
          inner.style.transition=`transform 0.5s ease ${i*0.08}s`;
          inner.style.transform='rotateY(180deg)';
        }
      });
    }, flipDelay);
  }
}

window.acceptHand = function() {
  document.getElementById('mulligan-overlay').style.display='none';
  bs.player.security=bs.player.deck.splice(0,5);
  bs.ai.security=bs.ai.deck.splice(0,5);
  addLog('🛡 セキュリティをセットしています...');
  // セキュリティ配置演出
  animateSecuritySet(() => {
    addLog('🛡 セキュリティセット完了！');
    if (_onlineMode && !bs.isPlayerTurn) {
      // オンライン後攻: 相手のターンを待つ
      showYourTurn('相手のターン', '🎮 相手の操作を待っています...', '#ff00fb', () => {
        addLog('⏳ 相手のターン（操作待ち）');
        renderAll();
      });
    } else {
      // 先攻 or AI対戦: 自分のターン開始
      showYourTurn('自分のターン開始', '【先攻プレイヤー】', '#00fbff', () => {
        checkTurnStartEffects('player', () => { applyPermanentEffects(bs, 'player', makeEffectContext(null,'player')); applyPermanentEffects(bs, 'ai', makeEffectContext(null,'ai')); renderAll(); setTimeout(() => startPhase('unsuspend'), 300); });
      });
    }
  });
};

// セキュリティ配置演出（1枚ずつ裏面カードが置かれる）
function animateSecuritySet(callback) {
  // 最初は空でレンダリング
  const tempPlSec = bs.player.security;
  const tempAiSec = bs.ai.security;
  bs.player.security = []; bs.ai.security = [];
  renderAll();

  let count = 0;
  const total = tempPlSec.length;

  function placeNext() {
    if(count >= total) {
      // 全部置き終わった
      setTimeout(callback, 400);
      return;
    }
    // 1枚ずつ追加
    bs.player.security.push(tempPlSec[count]);
    bs.ai.security.push(tempAiSec[count]);
    count++;
    renderAll();

    // セキュリティエリアにアニメーション
    animateLastSecCard('pl');
    animateLastSecCard('ai');

    setTimeout(placeNext, 250);
  }

  setTimeout(placeNext, 300);
}

function animateLastSecCard(side) {
  const area = document.getElementById(side + '-sec-area');
  if(!area) return;
  const cards = area.querySelectorAll('.sec-card');
  const last = cards[cards.length - 1];
  if(!last) return;
  // デッキ（右側）から飛んでくるアニメーション
  last.style.transition = 'none';
  last.style.opacity = '0';
  last.style.transform = 'translateX(60px) scale(0.5)';
  requestAnimationFrame(() => {
    last.style.transition = 'all 0.3s cubic-bezier(0.2,0.8,0.2,1)';
    last.style.opacity = '1';
    last.style.transform = 'translateX(0) scale(1)';
  });
}

window.doMulligan = function() {
  if(mulliganUsed) return;
  mulliganUsed=true;
  bs.player.deck=bs.player.deck.concat(bs.player.hand);
  bs.player.hand=[];
  if (_onlineMode) {
    bs.player.deck = seededShuffle(bs.player.deck, strToSeed(_onlineRoomId + '_mulligan_' + _onlineMyKey));
  } else {
    bs.player.deck = shuffle(bs.player.deck);
  }
  bs.player.hand=bs.player.deck.splice(0,5);
  const btn=document.getElementById('mulligan-btn');
  if(btn){btn.disabled=true;btn.style.opacity='0.3';btn.innerText='引き直し済み';}
  renderMulliganPreview(true); // アニメーション付き
  addLog('🔄 マリガン！手札を引き直しました');
};

// ===== 演出システム =====
window.showYourTurn = showYourTurn;
window.showPhaseAnnounce = showPhaseAnnounce;
window.showSkipAnnounce = showSkipAnnounce;

function showYourTurn(text, sub, color, callback) {
  const overlay=document.getElementById('your-turn-overlay');
  const textEl=document.getElementById('your-turn-text');
  const subEl=document.getElementById('your-turn-sub');
  const flashBg=document.getElementById('turn-flash-bg');
  const lineTop=document.getElementById('turn-line-top');
  const lineBottom=document.getElementById('turn-line-bottom');
  // オンライン: ターンテキストに応じて色を自動決定
  let c = color || 'var(--main-cyan)';
  if (_onlineMode) {
    if (text.includes('自分のターン開始')) c = getMyTurnColor();
    else if (text.includes('相手のターン') && !text.includes('終了')) c = getOppTurnColor();
  }
  textEl.innerText=text; textEl.style.color=c;
  textEl.style.textShadow=`0 0 30px ${c}, 0 0 60px ${c}, 0 0 100px ${c}`;
  if(sub){subEl.innerText=sub;subEl.style.opacity='1';}else{subEl.innerText='';subEl.style.opacity='0';}
  flashBg.style.background=c; flashBg.style.animation='none'; void flashBg.offsetWidth; flashBg.style.animation='turnFlash 1.5s ease forwards';
  lineTop.style.background=`linear-gradient(90deg, transparent, ${c}, transparent)`;
  lineTop.style.animation='none'; void lineTop.offsetWidth; lineTop.style.animation='turnLineExpand 1.5s ease forwards';
  lineBottom.style.background=`linear-gradient(90deg, transparent, ${c}, transparent)`;
  lineBottom.style.animation='none'; void lineBottom.offsetWidth; lineBottom.style.animation='turnLineExpand 1.5s ease 0.1s forwards';
  overlay.style.display='flex';
  setTimeout(() => {overlay.style.display='none';if(callback)callback();},1800);
}

function showPhaseAnnounce(text, color, callback) {
  const overlay=document.getElementById('phase-announce-overlay');
  const textEl=document.getElementById('phase-announce-text');
  const bar=document.getElementById('phase-highlight-bar');
  const c=color||'var(--main-cyan)';
  textEl.innerText=text; textEl.style.color='#fff'; textEl.style.textShadow=`0 0 20px ${c}`;
  bar.style.background=`linear-gradient(90deg, transparent, ${c}33, ${c}55, ${c}33, transparent)`;
  bar.style.animation='none'; void bar.offsetWidth; bar.style.animation='phaseHighlight 1.4s ease forwards';
  textEl.style.animation='none'; void textEl.offsetWidth; textEl.style.animation='phaseSlideIn 1.4s ease forwards';
  overlay.style.display='flex';
  setTimeout(() => {overlay.style.display='none';if(callback)callback();},1500);
}

function showSkipAnnounce(text, callback) {
  const overlay=document.getElementById('skip-announce-overlay');
  const textEl=document.getElementById('skip-announce-text');
  textEl.innerText=text; textEl.style.animation='none'; void textEl.offsetWidth;
  textEl.style.animation='skipFadeUp 1s ease forwards';
  overlay.style.display='flex';
  setTimeout(() => {overlay.style.display='none';if(callback)callback();},1100);
}

// ドローカード表示演出
// 共通ドロー（演出付き）
function doDraw(side, reason, callback) {
  const deck = side==='player' ? bs.player.deck : bs.ai.deck;
  const hand = side==='player' ? bs.player.hand : bs.ai.hand;
  if(deck.length===0){ callback&&callback(); return; }
  const c = deck.splice(0,1)[0]; hand.push(c);
  const isLv6 = parseInt(c.level)>=6;
  addLog('🃏 '+reason+'：「'+c.name+'」');
  showDrawEffect(c, isLv6, () => { renderAll(); callback&&callback(); });
}

function showDrawEffect(card, isLv6Plus, callback) {
  const overlay=document.getElementById('draw-overlay'); if(!overlay){callback&&callback();return;}
  const imgEl=document.getElementById('draw-card-img');
  const nameEl=document.getElementById('draw-card-name');
  const labelEl=document.getElementById('draw-label');
  imgEl.style.opacity='0'; imgEl.style.transform='translateY(40px)';
  nameEl.style.opacity='0'; labelEl.style.opacity='0';
  const src=cardImg(card);
  imgEl.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#fff;font-size:10px;padding:8px;">${card.name}</div>`;
  nameEl.innerText=card.name;
  if(isLv6Plus){
    imgEl.style.borderColor='#ff00fb'; imgEl.style.boxShadow='0 0 80px rgba(255,0,251,0.9), 0 0 150px rgba(255,0,251,0.5), 0 0 200px rgba(255,0,251,0.2)';
    imgEl.style.width='160px'; imgEl.style.height='224px'; imgEl.style.borderWidth='3px';
    labelEl.style.color='#ff00fb'; labelEl.innerText='★ MEGA DRAW! ★'; labelEl.style.fontSize='1.3rem';
    labelEl.style.textShadow='0 0 20px #ff00fb, 0 0 40px #ff00fb';
    nameEl.style.fontSize='1.2rem';
  } else {
    imgEl.style.borderColor='#00ff88'; imgEl.style.boxShadow='0 0 30px rgba(0,255,136,0.6)';
    imgEl.style.width='100px'; imgEl.style.height='140px'; imgEl.style.borderWidth='2px';
    labelEl.style.color='#00ff88'; labelEl.innerText='DRAW!'; labelEl.style.fontSize='0.8rem';
    labelEl.style.textShadow=''; nameEl.style.fontSize='1rem';
  }
  overlay.style.display='flex';
  if(isLv6Plus) {
    // 前兆演出（暗転→振動→光の筋→「...!?」→パルスリング）→ カード登場
    overlay.style.background='rgba(0,0,0,0.97)';
    const premon=document.getElementById('draw-premonition');
    const streak1=document.getElementById('draw-light-streak1');
    const streak2=document.getElementById('draw-light-streak2');
    const prText=document.getElementById('draw-premonition-text');
    const pulseRing=document.getElementById('draw-pulse-ring');
    const shakeLayer=document.getElementById('draw-shake-layer');
    if(premon) {
      premon.style.display='block';
      // Phase1: 画面振動（0～800ms）
      shakeLayer.style.animation='megaDrawShake 0.3s ease infinite';
      // Phase2: 光の筋が横切る（200ms, 500ms）
      setTimeout(() => { streak1.style.animation='megaDrawLightStreak 0.4s ease forwards'; },200);
      setTimeout(() => { streak2.style.animation='megaDrawLightStreak 0.35s ease forwards'; },500);
      // Phase3: 「...!?」テキスト（400ms）
      setTimeout(() => { prText.style.opacity='1'; },400);
      // Phase4: パルスリング（700ms）
      setTimeout(() => { pulseRing.style.animation='megaDrawPulseRing 0.5s ease-out forwards'; },700);
      // Phase5: 振動停止、前兆消去、カード登場へ（1200ms）
      setTimeout(() => {
        shakeLayer.style.animation='';
        prText.style.opacity='0';
        premon.style.display='none';
        streak1.style.animation=''; streak2.style.animation=''; pulseRing.style.animation='';
        // カード登場
        labelEl.style.opacity='1';
        setTimeout(() => {
          imgEl.style.opacity='1'; imgEl.style.transform='translateY(0) scale(1.2)';
          imgEl.style.transition='opacity 0.4s, transform 0.5s cubic-bezier(0.2,0.8,0.2,1)';
        },100);
        setTimeout(() => { imgEl.style.transform='translateY(0) scale(1)'; nameEl.style.opacity='1'; },500);
        setTimeout(() => {
          imgEl.style.boxShadow='0 0 100px rgba(255,0,251,1), 0 0 200px rgba(255,0,251,0.6)';
          setTimeout(() => { imgEl.style.boxShadow='0 0 80px rgba(255,0,251,0.9), 0 0 150px rgba(255,0,251,0.5)'; },200);
        },800);
      },1200);
    }
    setTimeout(() => {overlay.style.display='none'; overlay.style.background=''; imgEl.style.transition=''; callback&&callback();}, 4200);
  } else {
    overlay.style.background='rgba(0,0,0,0.85)';
    setTimeout(() => { imgEl.style.opacity='1'; imgEl.style.transform='translateY(0)'; labelEl.style.opacity='1';
      setTimeout(() => { nameEl.style.opacity='1'; },200);
    },100);
    setTimeout(() => {overlay.style.display='none'; overlay.style.background=''; callback&&callback();}, 1300);
  }
}

// 孵化演出
function showHatchEffect(card, callback) {
  const overlay=document.getElementById('hatch-overlay'); if(!overlay){callback&&callback();return;}
  const flash=document.getElementById('hatch-flash'), label=document.getElementById('hatch-label'),
        imgEl=document.getElementById('hatch-card-img'), nameEl=document.getElementById('hatch-card-name'),
        subEl=document.getElementById('hatch-sub-text');
  flash.style.opacity='0'; label.style.opacity='0';
  imgEl.style.opacity='0'; imgEl.style.transform='scale(0.5) rotate(-10deg)';
  nameEl.style.opacity='0'; subEl.style.opacity='0'; subEl.style.transform='scale(0.5)';
  const src=cardImg(card);
  imgEl.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#ff9900;font-size:10px;padding:8px;">${card.name}</div>`;
  nameEl.innerText=card.name;
  overlay.style.display='flex';
  setTimeout(() => {
    flash.style.transition='opacity 0.1s'; flash.style.opacity='0.8';
    setTimeout(() => {
      flash.style.transition='opacity 0.25s'; flash.style.opacity='0';
      label.style.opacity='1'; imgEl.style.opacity='1'; imgEl.style.transform='scale(1) rotate(0deg)';
      setTimeout(() => { nameEl.style.opacity='1'; subEl.style.opacity='1'; subEl.style.transform='scale(1)'; },200);
    },150);
  },100);
  clearTimeout(window._hatchTimer);
  window._hatchTimer=setTimeout(() => {overlay.style.display='none';callback&&callback();},2000);
}

// 進化演出（Lv6+は派手に）
function showEvolveEffect(cost, baseName, baseCard, evolvedCard, onDone) {
  const overlay=document.getElementById('evolve-overlay'); if(!overlay){onDone&&onDone();return;}
  const flash=document.getElementById('evo-flash'), label=document.getElementById('evo-label'),
        imgEl=document.getElementById('evo-card-img'), nameEl=document.getElementById('evo-card-name'),
        costEl=document.getElementById('evo-cost-text'), effectEl=document.getElementById('evo-effect-text');
  const isLv6=parseInt(evolvedCard.level)>=6;
  label.style.opacity='0'; nameEl.style.opacity='0'; costEl.style.opacity='0'; costEl.style.transform='scale(0.5)';
  effectEl.style.display='none'; flash.style.opacity='0';
  const evoColor=isLv6?'#ff00fb':'#00ff88';
  imgEl.style.borderColor=evoColor; imgEl.style.boxShadow=`0 0 ${isLv6?80:40}px ${evoColor}${isLv6?', 0 0 150px '+evoColor+'66':''}`;
  label.style.color=evoColor; label.innerText=isLv6?'★ MEGA EVOLUTION ★':'DIGITAL EVOLUTION';
  label.style.fontSize=isLv6?'1.1rem':'0.9rem';
  costEl.style.color=evoColor; costEl.style.textShadow=`0 0 20px ${evoColor}`;
  costEl.innerText=cost+' コスト進化！！';
  imgEl.style.transition='none'; imgEl.style.transform='scale(1) rotate(0deg)'; imgEl.style.opacity='1';
  const baseSrc=cardImg(baseCard);
  imgEl.innerHTML=baseSrc?`<img src="${baseSrc}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#aaa;font-size:10px;padding:8px;">${baseName}</div>`;
  overlay.style.display='flex';
  setTimeout(() => {
    imgEl.style.transition='opacity 0.4s, transform 0.4s'; imgEl.style.transform=`scale(0.3) rotate(${isLv6?720:360}deg)`; imgEl.style.opacity='0';
    setTimeout(() => {
      flash.style.transition='opacity 0.1s'; flash.style.opacity=isLv6?'1':'0.95';
      setTimeout(() => {
        flash.style.transition='opacity 0.2s'; flash.style.opacity='0';
        nameEl.innerText=evolvedCard.name;
        const evoSrc=cardImg(evolvedCard);
        imgEl.innerHTML=evoSrc?`<img src="${evoSrc}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:${evoColor};font-size:10px;padding:8px;">${evolvedCard.name}</div>`;
        imgEl.style.transition='none'; imgEl.style.transform=`scale(${isLv6?1.4:1.2}) rotate(-10deg)`; imgEl.style.opacity='1';
        setTimeout(() => { imgEl.style.transition='transform 0.25s'; imgEl.style.transform='scale(1) rotate(0deg)'; label.style.opacity='1'; nameEl.style.opacity='1';
          setTimeout(() => { costEl.style.opacity='1'; costEl.style.transform='scale(1)'; },150);
        },50);
      },120);
    },400);
  },300);
  clearTimeout(window._evoTimer);
  window._evoTimer=setTimeout(() => {overlay.style.display='none';onDone&&onDone();}, isLv6?2500:1800);
}

// 登場演出
// オプション使用演出（魔法エフェクト）
function showOptionEffect(card, onDone) {
  if (_onlineMode && bs.isPlayerTurn) sendCommand({ type: 'fx_option', cardName: card.name, cardImg: cardImg(card) });
  const overlay=document.getElementById('option-overlay'); if(!overlay){onDone&&onDone();return;}
  const flash=document.getElementById('option-flash');
  const particles=document.getElementById('option-particles');
  const label=document.getElementById('option-label');
  const imgEl=document.getElementById('option-card-img');
  const nameEl=document.getElementById('option-card-name');
  const costEl=document.getElementById('option-cost-text');

  flash.style.opacity='0'; label.style.opacity='0'; nameEl.style.opacity='0'; costEl.style.opacity='0';
  imgEl.style.opacity='0'; imgEl.style.transform='scale(0.7)'; particles.innerHTML='';

  const src=cardImg(card);
  imgEl.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#aa66ff;padding:8px;">${card.name}</div>`;
  imgEl.style.animation='optionGlow 1s ease-in-out infinite';
  nameEl.innerText=card.name;
  costEl.innerText=card.playCost+' コストで使用！';
  overlay.style.display='flex';

  // フラッシュ
  setTimeout(() => { flash.style.opacity='1'; },50);
  setTimeout(() => { flash.style.opacity='0'; label.style.opacity='1'; },200);
  // カード登場
  setTimeout(() => { imgEl.style.opacity='1'; imgEl.style.transform='scale(1)'; },400);
  // 名前＋コスト
  setTimeout(() => { nameEl.style.opacity='1'; costEl.style.opacity='1'; },700);
  // 魔法パーティクル（紫の光が上に昇る）
  setTimeout(() => {
    const colors=['#aa66ff','#cc88ff','#7733ff','#fff','#ddaaff'];
    for(let i=0;i<20;i++){
      const p=document.createElement('div');
      const px=-60+Math.random()*120, py=-(50+Math.random()*150);
      const size=3+Math.random()*6;
      const color=colors[Math.floor(Math.random()*colors.length)];
      const delay=Math.random()*0.3;
      p.style.cssText=`position:absolute;left:50%;top:55%;width:${size}px;height:${size}px;background:${color};border-radius:50%;box-shadow:0 0 ${size+2}px ${color};--px:${px}px;--py:${py}px;animation:optionParticle 1s ease-out ${delay}s forwards;opacity:0;`;
      setTimeout(() => { p.style.opacity='1'; }, delay*1000);
      particles.appendChild(p);
    }
    // リング
    const ring=document.createElement('div');
    ring.style.cssText='position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);border:2px solid #aa66ff;border-radius:50%;animation:optionRing 0.8s ease-out forwards;';
    particles.appendChild(ring);
  },500);

  setTimeout(() => { overlay.style.display='none'; imgEl.style.animation=''; onDone&&onDone(); },2500);
}

function showPlayEffect(card, onDone) {
  const overlay=document.getElementById('evolve-overlay'); if(!overlay){onDone&&onDone();return;}
  const flash=document.getElementById('evo-flash'), label=document.getElementById('evo-label'),
        imgEl=document.getElementById('evo-card-img'), nameEl=document.getElementById('evo-card-name'),
        costEl=document.getElementById('evo-cost-text'), effectEl=document.getElementById('evo-effect-text');
  label.style.opacity='0'; imgEl.style.opacity='0'; imgEl.style.transform='scale(0.7)';
  nameEl.style.opacity='0'; costEl.style.opacity='0'; costEl.style.transform='scale(0.5)';
  effectEl.style.opacity='0'; effectEl.style.display='none'; flash.style.opacity='0';
  const src=cardImg(card);
  imgEl.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#ffaa00;font-size:10px;padding:8px;">${card.name}</div>`;
  nameEl.innerText=card.name;
  const isOption = card.type==='オプション';
  costEl.innerText=card.playCost+' コストで'+(isOption?'使用！！':'登場！！');
  imgEl.style.borderColor='#ffaa00'; imgEl.style.boxShadow='0 0 40px rgba(255,170,0,0.8)';
  costEl.style.color='#ffaa00'; costEl.style.textShadow='0 0 20px rgba(255,170,0,0.8)';
  label.style.color=isOption?'#aa66ff':'#ffaa00'; label.innerText=isOption?'OPTION ACTIVATE':'DIGITAL APPEAR';
  overlay.style.display='flex';
  setTimeout(() => { flash.style.transition='opacity 0.1s'; flash.style.opacity='0.9';
    setTimeout(() => { flash.style.transition='opacity 0.3s'; flash.style.opacity='0'; label.style.opacity='1'; imgEl.style.opacity='1'; imgEl.style.transform='scale(1)'; nameEl.style.opacity='1';
      setTimeout(() => { costEl.style.opacity='1'; costEl.style.transform='scale(1)'; },300);
    },150);
  },50);
  clearTimeout(window._evoTimer);
  window._evoTimer=setTimeout(() => {overlay.style.display='none';onDone&&onDone();}, 2500);
}

// バトル結果演出 (Win/Lost)
function showBattleResult(text, color, sub, callback) {
  if (_onlineMode && bs.isPlayerTurn) sendCommand({ type: 'fx_battleResult', text, color, sub });
  const overlay=document.getElementById('battle-result-overlay'); if(!overlay){callback&&callback();return;}
  const textEl=document.getElementById('battle-result-text');
  const subEl=document.getElementById('battle-result-sub');
  textEl.innerText=text; textEl.style.color=color;
  textEl.style.textShadow=`0 0 30px ${color}, 0 0 60px ${color}`;
  textEl.style.opacity='0'; textEl.style.transform='scale(0.5)';
  subEl.innerText=sub||''; subEl.style.opacity='0';
  overlay.style.display='flex'; overlay.style.background=`rgba(0,0,0,0.7)`;
  setTimeout(() => { textEl.style.opacity='1'; textEl.style.transform='scale(1)';
    setTimeout(() => { subEl.style.opacity='1'; },200);
  },50);
  setTimeout(() => {overlay.style.display='none';callback&&callback();},1500);
}

// 消滅演出（白い光＋パーティクル＋カード割れ弾ける）
function showDestroyEffect(card, callback) {
  if (_onlineMode && bs.isPlayerTurn) sendCommand({ type: 'fx_destroy', cardName: card.name, cardImg: cardImg(card) });
  const overlay=document.getElementById('destroy-overlay'); if(!overlay){callback&&callback();return;}
  const imgEl=document.getElementById('destroy-card-img');
  const nameEl=document.getElementById('destroy-card-name');
  const labelEl=document.getElementById('destroy-label');
  const flashEl=document.getElementById('destroy-flash');
  const particlesEl=document.getElementById('destroy-particles');

  imgEl.style.opacity='0'; imgEl.style.animation='';
  nameEl.style.opacity='0'; labelEl.style.opacity='0';
  flashEl.style.opacity='0'; flashEl.style.animation='';
  particlesEl.innerHTML='';

  const src=cardImg(card);
  imgEl.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#ff4444;padding:8px;">${card.name}</div>`;
  nameEl.innerText=card.name;
  overlay.style.display='flex';

  // Step1: カード表示＋シェイク
  setTimeout(() => { imgEl.style.opacity='1'; imgEl.style.animation='destroyShake 0.6s ease'; },50);

  // Step2: 白フラッシュ＋大量パーティクル散乱＋カード爆発
  setTimeout(() => {
    flashEl.style.animation='destroyFlash 0.8s ease forwards';
    // パーティクル生成（白い破片＋赤い火花が大量に散らばる）
    const colors = ['#fff','#fff','#ff4444','#ff8800','#ffcc00','#fff','#ff6666'];
    for(let i=0;i<30;i++){
      const p=document.createElement('div');
      const angle=Math.random()*Math.PI*2;
      const dist=60+Math.random()*180;
      const px=Math.cos(angle)*dist, py=Math.sin(angle)*dist;
      const size=3+Math.random()*10;
      const color=colors[Math.floor(Math.random()*colors.length)];
      const delay=Math.random()*0.15;
      const dur=0.5+Math.random()*0.5;
      p.style.cssText=`position:absolute;left:50%;top:45%;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random()>0.5?'50%':'2px'};box-shadow:0 0 ${size}px ${color};--px:${px}px;--py:${py}px;animation:destroyParticle ${dur}s ease-out ${delay}s forwards;opacity:0;animation-fill-mode:forwards;`;
      // animationの最初にopacity設定
      setTimeout(() => { p.style.opacity='1'; }, delay*1000);
      particlesEl.appendChild(p);
    }
    // 衝撃波リング
    const ring=document.createElement('div');
    ring.style.cssText='position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);border:3px solid rgba(255,255,255,0.8);border-radius:50%;animation:destroyShockwave 0.6s ease-out forwards;pointer-events:none;';
    particlesEl.appendChild(ring);
    nameEl.style.opacity='1'; labelEl.style.opacity='1';
    imgEl.style.animation='destroyExplode 0.8s ease forwards';
  },700);

  setTimeout(() => { overlay.style.display='none'; imgEl.style.animation=''; flashEl.style.animation=''; callback&&callback(); },1900);
}

// セキュリティチェック演出
function showSecurityCheck(secCard, atkCard, callback, customLabel, onOpen) {
  if (_onlineMode && bs.isPlayerTurn) sendCommand({ type: 'fx_securityCheck', secName: secCard.name||'', secImg: cardImg(secCard), secDp: parseInt(secCard.dp)||0, secType: secCard.type||'', atkName: atkCard.name||'', atkImg: cardImg(atkCard), atkDp: parseInt(atkCard.dp)||0, customLabel: customLabel||'' });
  const overlay=document.getElementById('security-check-overlay'); if(!overlay){callback&&callback();return;}
  const label=document.getElementById('sec-check-label');
  const atkImgEl=document.getElementById('sec-atk-card-img');
  const atkNameEl=document.getElementById('sec-atk-name');
  const atkDpEl=document.getElementById('sec-atk-dp');
  const imgEl=document.getElementById('sec-check-card-img');
  const nameEl=document.getElementById('sec-check-card-name');
  const typeEl=document.getElementById('sec-check-type');
  const resultEl=document.getElementById('sec-check-result');

  // リセット
  label.style.opacity='0';
  atkImgEl.style.opacity='0'; atkNameEl.style.opacity='0'; atkDpEl.style.opacity='0';
  imgEl.style.opacity='0'; imgEl.style.transform='rotateY(180deg)';
  nameEl.style.opacity='0'; typeEl.style.opacity='0'; resultEl.style.opacity='0'; resultEl.style.transform='scale(0.5)';

  // アタック側カード表示
  const atkSrc=cardImg(atkCard);
  atkImgEl.innerHTML=atkSrc?`<img src="${atkSrc}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#00fbff;padding:8px;">${atkCard.name}</div>`;
  atkNameEl.innerText=atkCard.name;
  atkDpEl.innerText='DP: '+atkCard.dp;

  // セキュリティ側カード
  const src=cardImg(secCard);
  imgEl.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`:`<div style="color:#fff;padding:8px;">${secCard.name}</div>`;
  nameEl.innerText=secCard.name;
  const isDigimon=secCard.type==='デジモン';
  const isOption=secCard.type==='オプション';
  const isTamer=secCard.type==='テイマー';
  typeEl.innerText=isDigimon?'DP: '+secCard.dp:isOption?'セキュリティ効果':isTamer?'テイマー登場':'';

  label.innerText = customLabel || 'SECURITY CHECK!';
  overlay.style.display='flex';
  if (onOpen) onOpen();
  setTimeout(() => { label.style.opacity='1'; },100);
  setTimeout(() => { atkImgEl.style.opacity='1'; atkNameEl.style.opacity='1'; atkDpEl.style.opacity='1'; },300);
  setTimeout(() => { imgEl.style.opacity='1'; imgEl.style.transform='rotateY(0deg)'; },700);
  setTimeout(() => { nameEl.style.opacity='1'; typeEl.style.opacity='1'; },1100);

  let resultText='', resultColor='';
  if(isDigimon) {
    if(atkCard.dp===secCard.dp) { resultText='両者消滅...'; resultColor='#ff4444'; }
    else if(atkCard.dp>secCard.dp) { resultText='Win!!'; resultColor='#00ff88'; }
    else { resultText='Lost...'; resultColor='#ff4444'; }
  } else if(isOption) { resultText='セキュリティ効果発動'; resultColor='#ffaa00'; }
  else if(isTamer) { resultText='テイマー登場'; resultColor='#00fbff'; }
  else { resultText='トラッシュへ'; resultColor='#888'; }
  setTimeout(() => { resultEl.innerText=resultText; resultEl.style.color=resultColor; resultEl.style.textShadow=`0 0 20px ${resultColor}`;
    resultEl.style.opacity='1'; resultEl.style.transform='scale(1)'; },1500);
  setTimeout(() => {overlay.style.display='none';callback&&callback();},2800);
}

// ===== 効果発動確認 =====
// 効果コンテキスト生成
function makeEffectContext(card, side) {
  window._lastBattleState = bs; // 対象選択の確認ダイアログ用
  return {
    card, side, bs, addLog, renderAll, updateMemGauge, doDraw, showYourTurn, aiTurn,
    // 演出関数
    showPlayEffect, showEvolveEffect, showDestroyEffect, showDrawEffect,
    showDpPopup: null, // DPポップアップはeffect-engine内
    showSecurityCheck, showBattleResult
  };
}

// トリガーテキスト → 処理コード変換
const TRIGGER_CODE_MAP = {
  '【登場時】': 'on_play', '【進化時】': 'on_evolve', '【アタック時】': 'on_attack',
  '【アタック終了時】': 'on_attack_end', '【自分のターン開始時】': 'on_own_turn_start',
  '【自分のターン終了時】': 'on_own_turn_end', '【メイン】': 'main',
  '【相手のターン開始時】': 'on_opp_turn_start', '【相手のターン終了時】': 'on_opp_turn_end',
  '【消滅時】': 'on_destroy', '【セキュリティ】': 'security',
  '【レストしたとき】': 'when_rest', '【アタックされたとき】': 'when_attacked',
};

function checkAndTriggerEffect(card, triggerType, callback, side, alreadyConfirmed) {
  if (!card || !card.effect) { callback&&callback(); return; }
  const hasTrigger = card.effect.includes(triggerType);
  if (!hasTrigger) { callback&&callback(); return; }
  if (!side) {
    const inPlayer = bs.player.battleArea.includes(card) || bs.player.tamerArea.includes(card) || bs.player.hand.includes(card);
    side = inPlayer ? 'player' : 'ai';
  }
  const triggerCode = TRIGGER_CODE_MAP[triggerType] || triggerType;
  const context = makeEffectContext(card, side);
  if (alreadyConfirmed) context.alreadyConfirmed = true;
  triggerEffect(triggerCode, card, side, context, callback);
}

window.confirmEffect = function(yes) {
  // 効果エンジンのダイアログを使っている場合はそちらに委譲
  if (window._effectEngineConfirm && window._effectConfirmCallback) {
    window._effectEngineConfirm(yes);
    return;
  }
  document.getElementById('effect-confirm-overlay').style.display = 'none';
  if (_onlineMode) sendCommand({ type: 'fx_confirmClose', accepted: yes });
  if (yes && _pendingEffectCard) {
    addLog('⚡ 「' + _pendingEffectCard.name + '」の効果を発動！');
    if (_onlineMode) sendCommand({ type: 'effect_start', cardName: _pendingEffectCard.name, effectText: (_pendingEffectCard.effect||'').substring(0,150), cardImg: _pendingEffectCard.imgSrc||'' });
    const origCb = _pendingEffectCallback;
    _pendingEffectCard = null; _pendingEffectCallback = null;
    const wrappedCb = () => { if (origCb) origCb(); sendStateSync(); };
    if (wrappedCb) wrappedCb();
  } else {
    // 「いいえ」→ 効果発動せず、レスト解除してゲーム続行
    if (_pendingEffectCard) {
      _pendingEffectCard.suspended = false;
      addLog('💤 「' + _pendingEffectCard.name + '」の効果を発動しなかった');
    }
    _pendingEffectCard = null; _pendingEffectCallback = null;
    renderAll();
  }
};

// ターン開始時効果チェック
function checkTurnStartEffects(side, callback) {
  // ターンに1回制限をリセット
  bs._usedLimits = {};
  const p = side==='player' ? bs.player : bs.ai;
  const area = [...p.battleArea, ...(p.tamerArea || [])];
  const trigger = side==='player' ? '【自分のターン開始時】' : '【相手のターン開始時】';
  const cardsWithEffect = area.filter(c => c && hasKeyword(c, trigger));
  if (cardsWithEffect.length === 0) { callback(); return; }
  let idx = 0;
  function next() {
    if (idx >= cardsWithEffect.length) { callback(); return; }
    checkAndTriggerEffect(cardsWithEffect[idx++], trigger, next);
  }
  next();
}

// ターン終了時効果チェック
function checkTurnEndEffects(callback) {
  const allCards = [...bs.player.battleArea, ...(bs.player.tamerArea || [])];
  const cardsWithEffect = allCards.filter(c => c && hasKeyword(c, '【自分のターン終了時】'));
  if (cardsWithEffect.length === 0) { callback(); return; }
  let idx = 0;
  function next() {
    if (idx >= cardsWithEffect.length) { callback(); return; }
    checkAndTriggerEffect(cardsWithEffect[idx++], '【自分のターン終了時】', next);
  }
  next();
}

// ===== フェーズ進行 =====
function startPhase(phase) {
  bs.phase = phase;
  if (_onlineMode) { sendStateSync(); sendCommand({ type: 'phase', phase }); }
  const info = PHASE_NAMES[phase];
  if (!info) { execPhase(phase); return; }
  const colors = { unsuspend:'#00fbff', draw:'#00ff88', breed:'#ff9900', main:'#ff00fb' };
  showPhaseAnnounce(`${info.icon} ${info.name}`, colors[phase], () => execPhase(phase));
}

function execPhase(phase) {
  if (phase === 'unsuspend') {
    const hasRested = bs.player.battleArea.some(c => c && c.suspended && !c.cantBeActive) || bs.player.tamerArea.some(c => c && c.suspended);
    if (hasRested) {
      bs.player.battleArea.forEach(c => { if(c) { if(!c.cantBeActive) c.suspended=false; c.summonedThisTurn=false; c._usedEffects=[]; } });
      bs.player.tamerArea.forEach(c => { if(c) { c.suspended=false; c._usedEffects=[]; } });
      addLog('🔄 アクティブフェイズ完了');
      renderAll();
      setTimeout(() => startPhase('draw'), 500);
    } else {
      // レスト無しでもsummonedThisTurnはリセット、テイマーもアクティブ
      bs.player.battleArea.forEach(c => { if(c) { c.summonedThisTurn=false; c._usedEffects=[]; } });
      bs.player.tamerArea.forEach(c => { if(c) c.suspended=false; });
      showSkipAnnounce('🔄 アクティブフェイズ スキップ！', () => {
        addLog('🔄 アクティブフェイズ スキップ');
        setTimeout(() => startPhase('draw'), 300);
      });
    }
  } else if (phase === 'draw') {
    if (bs.isFirstTurn && bs.turn <= 1) {
      bs.isFirstTurn = false;
      showSkipAnnounce('🃏 ドローフェイズ スキップ！（先攻1ターン目）', () => {
        addLog('🃏 先攻1ターン目：ドローなし');
        setTimeout(() => startPhase('breed'), 300);
      });
    } else if (bs.player.deck.length > 0) {
      doDraw('player', 'ドロー', () => { setTimeout(() => startPhase('breed'), 300); });
    } else { addLog('⚠ デッキ切れ！'); battleDefeat(); return; }
  } else if (phase === 'breed') {
    // デジタマデッキなし＆育成エリアに移動可能カードなし → 自動スキップ
    const hasTama = bs.player.tamaDeck && bs.player.tamaDeck.length > 0;
    const canMove = bs.player.ikusei && bs.player.ikusei.level !== '2';
    if (!hasTama && !canMove) {
      addLog('🥚 育成フェイズ スキップ（デジタマなし）');
      setTimeout(() => startPhase('main'), 300);
      return;
    }
    addLog('🥚 育成フェイズ');
    const actionBar = document.getElementById('breed-action-bar');
    if (actionBar) actionBar.style.display = 'block';
    const ikuEl = document.getElementById('pl-iku-slot');
    if (ikuEl) ikuEl.classList.add('breed-hover-active');
    updateActionBtns(); renderAll();
  } else if (phase === 'main') {
    exitBreedPhase();
    addLog('⚡ メインフェイズ');
    updateActionBtns(); renderAll();
  }
}

// ===== 育成フェイズ =====
function exitBreedPhase() {
  const actionBar = document.getElementById('breed-action-bar');
  if (actionBar) actionBar.style.display = 'none';
  const ikuEl = document.getElementById('pl-iku-slot');
  if (ikuEl) { ikuEl.classList.remove('breed-hover-active'); ikuEl.style.border=''; ikuEl.style.boxShadow=''; ikuEl.onclick=null; ikuEl.ontouchstart=null; ikuEl.ontouchend=null; }
}

function breedActionDone() { renderAll(); exitBreedPhase(); setTimeout(() => startPhase('main'), 600); }

window.skipBreedPhase = function() {
  showSkipAnnounce('🥚 育成フェイズ スキップ！', () => { addLog('🥚 育成フェイズをスキップ'); breedActionDone(); });
};

// setupHatchClick / setupIkuSwipe は renderIkusei 内で処理

// ===== メインフェイズ：登場・進化 =====
function doPlay(card, handIdx, slotIdx) {
  if(bs.phase!=='main') return;
  if(card.level==='2'){addLog('🚨 デジタマはバトルエリアに出せません');return;}
  if (_onlineMode) { sendCommand({ type: 'play', handIdx, slotIdx, cardName: card.name, cardType: card.type, cardImg: card.imgSrc||'', playCost: card.playCost||0 }); }
  if(card.playCost===null){addLog('🚨 「'+card.name+'」は進化専用カードです');return;}

  // オプションカード → 使用（バトルエリアに残らない）→ 必ずトラッシュへ
  if(card.type==='オプション') {
    bs.player.hand.splice(handIdx,1); bs.selHand=null;
    addLog('✦ 「'+card.name+'」を使用！（コスト '+card.playCost+'）');
    renderAll();
    showOptionEffect(card, () => {
      // メモリー消費（ターン終了判定はしない）
      bs.memory -= card.playCost;
      updateMemGauge();
      sendMemoryUpdate(); // 相手に即時通知
      // メイン効果を発動
      checkAndTriggerEffect(card, '【メイン】', () => {
        bs.player.trash.push(card);
        addLog('✦ 「'+card.name+'」をトラッシュへ');
        renderAll();
        // 効果完了後にターン終了判定
        if(bs.memory < 0) {
          if (_onlineMode) {
            bs.isPlayerTurn = false;
            addLog('💾 メモリー'+Math.abs(bs.memory)+'で相手側へ');
            updateMemGauge(); renderAll(true);
            sendCommand({ type: 'endTurn', memory: bs.memory });
            showYourTurn('自分のターン終了','','#555555', () => {
              showYourTurn('相手のターン','🎮 相手の操作を待っています...','#ff00fb', () => {});
            });
          } else {
            const over = Math.abs(bs.memory);
            bs.memory = over; bs.isPlayerTurn = false;
            updateMemGauge();
            addLog('💾 メモリー'+over+'でAI側へ');
            showYourTurn('自分のターン終了','','#555555', () => { setTimeout(() => aiTurn(),500); });
          }
        }
      }, 'player');
    });
    return;
  }

  // テイマー → テイマーエリアに配置
  if(card.type==='テイマー') {
    bs.player.hand.splice(handIdx,1); bs.selHand=null;
    bs.player.tamerArea.push(card);
    addLog('▶ 「'+card.name+'」を登場！（コスト '+card.playCost+'）');
    renderAll();
    showPlayEffect(card, () => {
      const turnEnded = spendMemory(card.playCost);
      if (!turnEnded) {
        // テイマー登場時に永続効果を即適用
        applyPermanentEffects(bs, 'player', makeEffectContext(card, 'player'));
        renderAll();
        if (hasKeyword(card, '【登場時】')) {
          checkAndTriggerEffect(card, '【登場時】', () => renderAll());
        }
      }
    });
    return;
  }

  // デジモン → バトルエリアに配置
  card.summonedThisTurn=true;
  // 配列を必要な長さまで拡張
  while (bs.player.battleArea.length <= slotIdx) bs.player.battleArea.push(null);
  bs.player.battleArea[slotIdx]=card; bs.player.hand.splice(handIdx,1); bs.selHand=null;
  addLog('▶ 「'+card.name+'」を登場！（コスト '+card.playCost+'）');
  renderAll();
  showPlayEffect(card, () => {
    // 新規登場カードに永続効果を適用
    applyPermanentEffects(bs, 'player', makeEffectContext(card, 'player'));
    renderAll(true);
    // 登場時効果
    if (hasKeyword(card, '【登場時】')) {
      checkAndTriggerEffect(card, '【登場時】', () => {
        renderAll(true);
        spendMemory(card.playCost);
      });
    } else {
      spendMemory(card.playCost);
    }
  });
}

// 進化条件チェック: 「赤Lv.3」「赤Lv.5 / 「ガンマモン」の記述があるLv.5」等
function canEvolveOnto(evoCard, baseCard) {
  const cond = evoCard.evolveCond || '';
  if(!cond || cond==='なし' || cond==='') return false;
  // 「/」で分割（OR条件）
  const conditions = cond.split('/').map(s => s.trim());
  for(const c of conditions) {
    // 「色Lv.数字」を抽出
    const m = c.match(/([赤青黄緑黒紫白]+)?Lv\.(\d+)/);
    if(m) {
      const reqColor = m[1] || '';
      const reqLevel = m[2];
      const baseLevel = String(baseCard.level);
      const baseColor = baseCard.color || '';
      // レベル一致チェック
      if(baseLevel !== reqLevel) continue;
      // 色チェック（色指定あれば）
      if(reqColor && !baseColor.includes(reqColor)) continue;
      // 特殊条件（「○○」の記述がある等）はここでは名前チェック
      const nameMatch = c.match(/「(.+?)」/);
      if(nameMatch) {
        const reqName = nameMatch[1];
        // 進化元の名前・進化元スタックの名前に含まれるか
        const hasName = baseCard.name.includes(reqName) ||
          (baseCard.stack && baseCard.stack.some(s => s.name.includes(reqName)));
        if(!hasName) continue;
      }
      return true; // 条件を満たした
    }
  }
  return false;
}

function doEvolve(card, handIdx, slotIdx) {
  if(bs.phase!=='main') return;
  if (_onlineMode) { sendCommand({ type: 'evolve', handIdx, slotIdx, cardName: card.name, baseName: bs.player.battleArea[slotIdx]?.name||'', cardImg: card.imgSrc||'', evolveCost: card.evolveCost||0 }); }
  const base=bs.player.battleArea[slotIdx]; if(!base) return;
  if(card.evolveCost===null){addLog('🚨 「'+card.name+'」は進化できません‼');return;}
  // 進化条件チェック
  if(!canEvolveOnto(card, base)){addLog('🚨 進化条件を満たしていません‼（'+card.evolveCond+'）');return;}
  const cost=card.evolveCost;
  const evolved=Object.assign({},card,{suspended:base.suspended,summonedThisTurn:base.summonedThisTurn,buffs:base.buffs||[],dpModifier:base.dpModifier||0,stack:[base].concat(base.stack||[])});
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  bs.player.battleArea[slotIdx]=evolved; bs.player.hand.splice(handIdx,1); bs.selHand=null;
  addLog('⬆ 「'+base.name+'」→「'+evolved.name+'」進化！（コスト '+cost+'）');
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, () => {
    // 進化時1ドロー（演出付き）
    doDraw('player', '進化ドロー', () => {
      const turnEnded = spendMemory(cost);
      if(!turnEnded && hasKeyword(evolved, '【進化時】')) {
        checkAndTriggerEffect(evolved, '【進化時】', () => renderAll());
      }
    });
  });
}

function doEvolveIku(card, handIdx) {
  if(bs.phase!=='main') return;
  if (_onlineMode) { sendCommand({ type: 'breed_evolve', handIdx, cardName: card.name, baseName: bs.player.ikusei?.name||'', cardImg: card.imgSrc||'', evolveCost: card.evolveCost||0 }); }
  const base=bs.player.ikusei; if(!base) return;
  if(card.evolveCost===null){addLog('🚨 「'+card.name+'」は進化できません‼');return;}
  if(!canEvolveOnto(card, base)){addLog('🚨 進化条件を満たしていません‼（'+card.evolveCond+'）');return;}
  const cost=card.evolveCost;
  const evolved=Object.assign({},card,{suspended:base.suspended,summonedThisTurn:base.summonedThisTurn,buffs:base.buffs||[],dpModifier:base.dpModifier||0,stack:[base].concat(base.stack||[])});
  evolved.dp = evolved.baseDp + evolved.dpModifier;
  bs.player.ikusei=evolved; bs.player.hand.splice(handIdx,1); bs.selHand=null;
  addLog('⬆ 育成「'+base.name+'」→「'+evolved.name+'」進化！（コスト '+cost+'）');
  renderAll();
  showEvolveEffect(cost, base.name, base, evolved, () => {
    // 進化時1ドロー（演出付き）
    doDraw('player', '進化ドロー', () => {
      const turnEnded = spendMemory(cost);
      if(!turnEnded && evolved.effect && evolved.effect.includes('＜育成＞') && hasKeyword(evolved, '【進化時】')) {
        checkAndTriggerEffect(evolved, '【進化時】', () => renderAll());
      }
    });
  });
}

// ===== ドラッグ＆ドロップ =====
let _dragCard=null, _dragIdx=null, _isDragging=false, _dragStartX=0, _dragStartY=0, _dragDone=false, _dragSourceEl=null;

function cleanupDrag() {
  // カードを元の位置に戻す
  if(_dragSourceEl) {
    _dragSourceEl.style.position=''; _dragSourceEl.style.zIndex='';
    _dragSourceEl.style.left=''; _dragSourceEl.style.top='';
    _dragSourceEl.style.transform=''; _dragSourceEl.style.pointerEvents='';
    _dragSourceEl=null;
  }
  _dragCard=null; _dragIdx=null; _isDragging=false;
  highlightDropZones(false);
}

function onHandDragStart(e, idx, card, el) {
  _dragIdx=idx; _dragCard=card; _isDragging=false; _dragSourceEl=el;
  const cx=e.touches?e.touches[0].clientX:e.clientX;
  const cy=e.touches?e.touches[0].clientY:e.clientY;
  _dragStartX=cx; _dragStartY=cy;
}
function onHandDragMove(e) {
  if(!_dragCard) return;
  const cx=e.touches?e.touches[0].clientX:e.clientX;
  const cy=e.touches?e.touches[0].clientY:e.clientY;
  if(!_isDragging && (Math.abs(cx-_dragStartX)>10||Math.abs(cy-_dragStartY)>10)) {
    _isDragging=true;
    highlightDropZones(true);
    // カードをドラッグ中の見た目にする
    if(_dragSourceEl) {
      _dragSourceEl.style.position='fixed';
      _dragSourceEl.style.zIndex='99999';
      _dragSourceEl.style.pointerEvents='none';
      _dragSourceEl.style.transform='scale(1.1)';
      _dragSourceEl.style.transition='none';
    }
  }
  // カードを指に追従
  if(_isDragging && _dragSourceEl) {
    _dragSourceEl.style.left=(cx-26)+'px';
    _dragSourceEl.style.top=(cy-36)+'px';
  }
  if(e.preventDefault) e.preventDefault();
}
function onHandDragEnd(e) {
  if(!_dragCard) return;
  const wasDragging=_isDragging;
  const cx=e.changedTouches?e.changedTouches[0].clientX:e.clientX;
  const cy=e.changedTouches?e.changedTouches[0].clientY:e.clientY;
  const card=_dragCard, idx=_dragIdx;
  cleanupDrag();

  // ドラッグしていなかった（タップ）→ 何もしない（onclickで処理される）
  if(!wasDragging) return;
  // ドラッグ完了フラグ（直後のclickイベントをスキップするため）
  _dragDone=true;
  setTimeout(() => { _dragDone=false; }, 50);

  let dropped=false;
  // 育成エリアに進化
  const ikuEl=document.getElementById('pl-iku-slot');
  if(!dropped&&ikuEl&&bs.player.ikusei){
    const r=ikuEl.getBoundingClientRect(); const pad=20;
    if(cx>=(r.left-pad)&&cx<=(r.right+pad)&&cy>=(r.top-pad)&&cy<=(r.bottom+pad)){
      doEvolveIku(card,idx); dropped=true;
    }
  }
  // バトルエリアに登場 or 進化
  if(!dropped){
    const plRow=document.getElementById('pl-battle-row');
    if(plRow) plRow.querySelectorAll('.b-slot').forEach((slot,i) => {
      if(dropped) return;
      const r=slot.getBoundingClientRect();
      if(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom){
        if(bs.player.battleArea[i]){doEvolve(card,idx,i);dropped=true;}
        else{doPlay(card,idx,i);dropped=true;}
      }
    });
  }
  // ドロップ先なし → キャンセル（何もしない）
}
function highlightDropZones(on) { document.querySelectorAll('#pl-battle-row .b-slot').forEach(s => { s.style.borderColor=on?'#ffffff55':''; s.style.background=on?'#1a1a1a':''; }); }

// ===== 長押し＝レスト → メニュー表示（アタック/効果） =====
let _atkState = null;
let _longpressSlotIdx = null;
let _wasAlreadySuspended = false; // 長押し前にレスト済みだったか

function setupLongpressGesture(el, slotIdx) {
  let lpt=null, longPressed=false;

  function triggerMenu() {
    if(bs.phase!=='main') return;
    if(_onlineMode && !bs.isPlayerTurn) return; // オンライン: 相手ターン中は操作不可
    const card=bs.player.battleArea[slotIdx]; if(!card) return;
    _wasAlreadySuspended = card.suspended;
    if(!card.suspended) {
      const noRest = hasKeyword(card, 'レストせずアタックできる') || card._attackWithoutRest;
      if(!noRest) card.suspended = true;
      renderAll();
    }
    _longpressSlotIdx = slotIdx;
    requestAnimationFrame(() => {
      const updatedEl = document.getElementById('pl-battle-row').querySelectorAll('.b-slot')[slotIdx];
      showLongpressMenu(card, slotIdx, updatedEl || el);
    });
  }

  // タッチ（スマホ）: 左スワイプでメニュー表示
  let touchStartX = 0, touchStartY = 0, swiped = false;
  el.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchStartX = t.clientX; touchStartY = t.clientY;
    swiped = false;
  }, {passive:true});
  el.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const dx = touchStartX - t.clientX;
    const dy = Math.abs(t.clientY - touchStartY);
    if (dx > 20 && dx > dy && !swiped) {
      swiped = true;
      triggerMenu();
    }
  }, {passive:true});
  el.addEventListener('touchend', () => {});

  // マウス（PC）: 長押しでメニュー表示
  el.addEventListener('mousedown', e => {
    if(e.button!==0) return;
    longPressed=false;
    lpt=setTimeout(() => { longPressed=true; triggerMenu(); }, 400);
    const cancel = () => { clearTimeout(lpt); document.removeEventListener('mouseup', cancel); };
    document.addEventListener('mouseup', cancel);
  });
}

function showLongpressMenu(card, slotIdx, el) {
  const menu=document.getElementById('longpress-action-menu');
  const btns=document.getElementById('longpress-action-buttons');
  const backdrop=document.getElementById('longpress-backdrop');
  if(!menu||!btns) return;

  let html = '';
  // アタックボタン（デジモンで、召喚酔いでなければ）
  // 長押し/スワイプでレストした場合はアタック可能。既にレスト済みだった場合はグレーアウト
  const canAtk = card.type==='デジモン' || hasKeyword(card, 'アタックできる');
  const notSick = !card.summonedThisTurn || hasEvoKeyword(card, '【速攻】');
  if(canAtk && notSick) {
    if(_wasAlreadySuspended) {
      html += `<button class="lp-action-btn lp-atk-btn" disabled style="opacity:0.3;cursor:not-allowed;">⚔ アタック（レスト中）</button>`;
    } else {
      html += `<button class="lp-action-btn lp-atk-btn" onclick="startAttackMode(${slotIdx})">⚔ アタック</button>`;
    }
  }
  // 効果ボタン（【メイン】効果を持つカードのみ表示。進化元効果は詳細画面から発動）
  if (!card._usedEffects) card._usedEffects = [];
  const hasMainEffect = card.effect && card.effect.includes('【メイン】');
  if(hasMainEffect) {
    const used = card._usedEffects.includes('self');
    if(used) {
      html += `<button class="lp-action-btn lp-effect-btn" disabled style="opacity:0.3;cursor:not-allowed;">⚡ 効果（使用済み）</button>`;
    } else {
      html += `<button class="lp-action-btn lp-effect-btn" onclick="activateEffect(${slotIdx},'self')">⚡ 効果</button>`;
    }
  }
  // キャンセル
  html += `<button class="lp-action-btn lp-cancel-btn" onclick="cancelLongpress(${slotIdx})">✕ キャンセル</button>`;

  btns.innerHTML = html;
  // 一旦非表示で描画してサイズ取得
  menu.style.visibility='hidden'; menu.style.display='block';
  const menuH = menu.offsetHeight, menuW = menu.offsetWidth;
  menu.style.visibility=''; menu.style.display='none';

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top;
  menu.style.left = Math.max(4, Math.min(cx - menuW/2, window.innerWidth - menuW - 4)) + 'px';
  menu.style.top = Math.max(4, cy - menuH - 6) + 'px';
  backdrop.style.display = 'block';
  menu.style.display = 'block';
}

function showTamerMenu(card, tamerIdx, el) {
  // レスト
  if(!card.suspended) card.suspended=true;
  renderAll();
  // レスト後のDOM更新を待ってからメニュー表示
  const tamerRow = document.getElementById('pl-tamer-row');
  const updatedEl = tamerRow ? tamerRow.querySelectorAll('.tamer-slot')[tamerIdx] : el;
  el = updatedEl || el;

  const menu=document.getElementById('longpress-action-menu');
  const btns=document.getElementById('longpress-action-buttons');
  const backdrop=document.getElementById('longpress-backdrop');
  if(!menu||!btns) return;

  let html='';
  if(card.effect && card.effect.trim() && card.effect!=='なし') {
    html+=`<button class="lp-action-btn lp-effect-btn" onclick="activateTamerEffect(${tamerIdx})">⚡ 効果</button>`;
  }
  html+=`<button class="lp-action-btn lp-cancel-btn" onclick="cancelTamerLongpress(${tamerIdx})">✕ キャンセル</button>`;
  btns.innerHTML=html;

  menu.style.visibility='hidden'; menu.style.display='block';
  const menuH=menu.offsetHeight, menuW=menu.offsetWidth;
  menu.style.visibility=''; menu.style.display='none';

  const rect=el.getBoundingClientRect();
  menu.style.left=Math.max(4,Math.min(rect.left+rect.width/2-menuW/2, window.innerWidth-menuW-4))+'px';
  menu.style.top=Math.max(4,rect.top-menuH-6)+'px';
  backdrop.style.display='block'; menu.style.display='block';
}

window.activateTamerEffect = function(tamerIdx) {
  hideLongpressMenu();
  const card=bs.player.tamerArea[tamerIdx]; if(!card) return;
  // オンライン: 確認後に送信するので、ここでは送信しない
  _pendingEffectCard=card;
  _pendingEffectCallback=() => renderAll();
  document.getElementById('effect-confirm-name').innerText=card.name;
  document.getElementById('effect-confirm-text').innerText=card.effect;
  document.getElementById('effect-confirm-overlay').style.display='flex';
};

window.cancelTamerLongpress = function(tamerIdx) {
  hideLongpressMenu();
  const card=bs.player.tamerArea[tamerIdx];
  if(card) card.suspended=false;
  renderAll();
};

window.hideLongpressMenu = function() {
  const menu=document.getElementById('longpress-action-menu');
  const backdrop=document.getElementById('longpress-backdrop');
  if(menu) menu.style.display='none';
  if(backdrop) backdrop.style.display='none';
};

window.cancelLongpress = function(slotIdx) {
  hideLongpressMenu();
  const card=bs.player.battleArea[slotIdx];
  // 長押し前にレスト済みだった場合はアクティブに戻さない
  if(card && !_wasAlreadySuspended && !hasKeyword(card, 'レストせずアタックできる') && !card._attackWithoutRest) {
    card.suspended=false;
  }
  renderAll();
};

window.activateEffect = function(slotIdx, effectSource) {
  hideLongpressMenu();
  const card=bs.player.battleArea[slotIdx]; if(!card) return;
  // オンライン: 確認後に送信するので、ここでは送信しない
  if (!card._usedEffects) card._usedEffects = [];

  // 効果テキストとカード名を決定
  let effectText = card.effect;
  let effectName = card.name;
  if (effectSource && effectSource.startsWith('evo-')) {
    const evoIdx = parseInt(effectSource.split('-')[1]);
    const evoCard = card.stack && card.stack[evoIdx];
    if (evoCard && evoCard.evoSourceEffect) {
      effectText = evoCard.evoSourceEffect;
      effectName = evoCard.name + '（進化元効果）';
    }
  }

  // レスト状態を維持
  renderAll();
  _pendingEffectCard = card;
  _pendingEffectCallback = () => {
    // この効果ソースを使用済みに
    card._usedEffects.push(effectSource || 'self');
    // 効果エンジンで処理
    checkAndTriggerEffect(card, '【メイン】', () => renderAll(), null, true);
  };
  document.getElementById('effect-confirm-name').innerText = effectName;
  document.getElementById('effect-confirm-text').innerText = effectText;
  document.getElementById('effect-confirm-overlay').style.display = 'flex';
  // オンライン: 確認ダイアログ表示を相手に送信
  if (_onlineMode) sendCommand({ type: 'fx_confirmShow', cardName: effectName, effectText: (effectText||'').substring(0,200) });
};

// ===== アタックモード（ドラッグで対象選択） =====
window.startAttackMode = function(slotIdx) {
  hideLongpressMenu();
  const card=bs.player.battleArea[slotIdx]; if(!card) return;
  addLog('⚔ 「'+card.name+'」でアタック！ → 対象を選んでください');

  // 矢印用SVG
  let arrowSvg = document.getElementById('attack-arrow-svg');
  if(!arrowSvg) {
    arrowSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    arrowSvg.id='attack-arrow-svg';
    arrowSvg.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:99998;pointer-events:none;';
    document.body.appendChild(arrowSvg);
  }
  const slotEl = document.getElementById('pl-battle-row').querySelectorAll('.b-slot')[slotIdx];
  const slotRect = slotEl ? slotEl.getBoundingClientRect() : {left:0,top:0,width:0,height:0};
  const sx = slotRect.left+slotRect.width/2, sy = slotRect.top;
  arrowSvg.innerHTML = `<defs><marker id="atkArrowHead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#00fbff"/></marker></defs>
    <line id="atk-arrow-line" x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy}" stroke="#00fbff" stroke-width="3" stroke-dasharray="8,4" marker-end="url(#atkArrowHead)" opacity="0.9"/>`;
  arrowSvg.style.display='block';

  highlightAttackTargets(true, card);
  _atkState = { slotIdx, card, startX:sx, startY:sy };

  // マウス/タッチで矢印追従＋ドロップ判定
  function onMove(e) {
    const cx=e.touches?e.touches[0].clientX:e.clientX, cy=e.touches?e.touches[0].clientY:e.clientY;
    const line=document.getElementById('atk-arrow-line');
    if(line){line.setAttribute('x2',cx);line.setAttribute('y2',cy);}
    // ホバー効果
    document.querySelectorAll('.atk-target-hover').forEach(el => el.classList.remove('atk-target-hover'));
    if(!_atkState) return;
    const canHit = hasEvoKeyword(_atkState.card,'【突進】')||hasKeyword(_atkState.card,'アクティブ状態のデジモンにもアタックできる');
    // デジモンのホバー
    const aiRow=document.getElementById('ai-battle-row');
    if(aiRow) aiRow.querySelectorAll('.b-slot').forEach((slot,i) => {
      const def=bs.ai.battleArea[i]; if(!def) return;
      if(!def.suspended && !canHit) return;
      const r=slot.getBoundingClientRect();
      if(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom) slot.classList.add('atk-target-hover');
    });
    // セキュリティのホバー
    const secArea=document.getElementById('ai-sec-area');
    if(secArea && bs.ai.security.length>0) {
      const r=secArea.getBoundingClientRect();
      if(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom) secArea.classList.add('atk-target-hover');
      else secArea.classList.remove('atk-target-hover');
    }
  }
  function onEnd(e) {
    const cx=e.changedTouches?e.changedTouches[0].clientX:e.touches?e.touches[0].clientX:e.clientX;
    const cy=e.changedTouches?e.changedTouches[0].clientY:e.touches?e.touches[0].clientY:e.clientY;
    document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onEnd);
    document.removeEventListener('touchmove',onMove); document.removeEventListener('touchend',onEnd);
    document.querySelectorAll('.atk-target-hover').forEach(el => el.classList.remove('atk-target-hover'));
    const secAreaClear=document.getElementById('ai-sec-area'); if(secAreaClear) secAreaClear.classList.remove('atk-target-hover');
    arrowSvg.style.display='none';
    highlightAttackTargets(false);
    if(!_atkState) return;
    resolveAttackDrop(cx, cy);
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onEnd);
  document.addEventListener('touchmove',onMove,{passive:false});
  document.addEventListener('touchend',onEnd);
};

function resolveAttackDrop(cx, cy) {
  const atkCard=_atkState.card, atkSlotIdx=_atkState.slotIdx;
  let resolved=false;
  const canHitActive = hasEvoKeyword(atkCard,'【突進】')||hasKeyword(atkCard,'アクティブ状態のデジモンにもアタックできる');

  // 相手バトルエリア
  const aiRow=document.getElementById('ai-battle-row');
  if(aiRow) aiRow.querySelectorAll('.b-slot').forEach((slot,i) => {
    if(resolved) return;
    const def=bs.ai.battleArea[i]; if(!def) return;
    const r=slot.getBoundingClientRect();
    if(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom) {
      if(!def.suspended&&!canHitActive) { addLog('🚨 アクティブ状態のデジモンにはアタックできません'); cancelAttack(); resolved=true; return; }
      resolved=true; _atkState=null;
      if (_onlineMode) {
        sendCommand({ type: 'attack_digimon', atkIdx: atkSlotIdx, defIdx: i, atkName: atkCard.name, defName: def.name, atkDp: atkCard.dp, atkImg: cardImg(atkCard) });
        afterAtkEffect(atkCard, atkSlotIdx, () => {
          waitForBlockResponse((resp) => {
            if (!resp.blocked) {
              resolveBattle(atkCard, atkSlotIdx, def, i, 'ai');
            }
            // blocked → defender handles battle, state_sync will update
          });
        });
      } else {
        const blockerIdx=bs.ai.battleArea.findIndex(c=>c&&c!==def&&!c.suspended&&hasEvoKeyword(c,'【ブロッカー】'));
        if(blockerIdx!==-1) { const bl=bs.ai.battleArea[blockerIdx]; bl.suspended=true; addLog('🛡 「'+bl.name+'」がブロック！'); renderAll();
          afterAtkEffect(atkCard,atkSlotIdx,()=>resolveBattle(atkCard,atkSlotIdx,bl,blockerIdx,'ai'));
        } else { afterAtkEffect(atkCard,atkSlotIdx,()=>resolveBattle(atkCard,atkSlotIdx,def,i,'ai')); }
      }
    }
  });

  // セキュリティ
  if(!resolved) {
    const secArea=document.getElementById('ai-sec-area');
    if(secArea) { const r=secArea.getBoundingClientRect();
      if(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom) {
        resolved=true; _atkState=null;
        if(_onlineMode){
          sendCommand({type:'attack_security', atkIdx:atkSlotIdx, atkName:atkCard.name, atkDp:atkCard.dp, atkImg:cardImg(atkCard)});
          afterAtkEffect(atkCard,atkSlotIdx,()=>{
            waitForBlockResponse((resp) => {
              if (!resp.blocked) { resolveSecurityCheck(atkCard,atkSlotIdx); }
            });
          });
        } else {
          afterAtkEffect(atkCard,atkSlotIdx,()=>{resolveSecurityCheck(atkCard,atkSlotIdx);});
        }
      }
    }
  }

  // 上方向（相手エリア全体）
  if(!resolved) {
    const aiZone=document.querySelector('.ai-zone');
    if(aiZone) { const r=aiZone.getBoundingClientRect();
      if(cy>=r.top&&cy<=r.bottom) { resolved=true;
        if(!bs.ai.battleArea.some(c=>c!==null)) { _atkState=null;
          if(_onlineMode){
            sendCommand({type:'attack_security', atkIdx:atkSlotIdx, atkName:atkCard.name, atkDp:atkCard.dp, atkImg:cardImg(atkCard)});
            afterAtkEffect(atkCard,atkSlotIdx,()=>{
              waitForBlockResponse((resp) => {
                if (!resp.blocked) { resolveSecurityCheck(atkCard,atkSlotIdx); }
              });
            });
          } else {
            afterAtkEffect(atkCard,atkSlotIdx,()=>resolveSecurityCheck(atkCard,atkSlotIdx));
          }
        }
        else { cancelAttack(); }
      }
    }
  }

  if(!resolved) cancelAttack();
}

function cancelAttack() {
  if(_atkState) {
    const card=_atkState.card;
    if(card&&!hasKeyword(card,'レストせずアタックできる')&&!card._attackWithoutRest) card.suspended=false;
    _atkState=null; renderAll();
    addLog('⚠ アタックをキャンセルしました');
  }
}

function afterAtkEffect(atkCard, atkSlotIdx, callback) {
  // カード自身 or 進化元に【アタック時】があればトリガー
  const hasAtk = hasKeyword(atkCard, '【アタック時】') ||
    (atkCard.stack && atkCard.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes('【アタック時】')));
  if(hasAtk) { checkAndTriggerEffect(atkCard, '【アタック時】', callback); }
  else callback();
}

function highlightAttackTargets(on, atkCard) {
  const canHitActive = atkCard && (hasEvoKeyword(atkCard, '【突進】') || hasKeyword(atkCard, 'アクティブ状態のデジモンにもアタックできる'));
  // 相手バトルエリア（レスト状態 or 【突進】持ちならアクティブも）
  const aiRow=document.getElementById('ai-battle-row');
  if(aiRow) {
    aiRow.querySelectorAll('.b-slot').forEach((slot,i) => {
      const def = bs.ai.battleArea[i];
      if(def && (def.suspended || canHitActive)) {
        slot.style.border=on?'2px solid #ff4444':'';
        slot.style.boxShadow=on?'0 0 12px rgba(255,68,68,0.5)':'';
      } else if(def && on) {
        // アクティブ状態→対象外（灰色）
        slot.style.border='2px solid #333';
        slot.style.boxShadow='none';
      } else {
        slot.style.border=''; slot.style.boxShadow='';
      }
    });
  }
  // セキュリティ
  const secArea=document.getElementById('ai-sec-area');
  if(secArea && bs.ai.security.length>0) {
    secArea.style.border=on?'2px solid #ff4444':'';
    secArea.style.boxShadow=on?'0 0 12px rgba(255,68,68,0.5)':'';
    secArea.style.borderRadius=on?'6px':'';
  }
}

function exitAttackTargetMode() { highlightAttackTargets(false); _atkState=null; }

function resolveBattle(atk, atkIdx, def, defIdx, defSide) {
  addLog('⚔ 「'+atk.name+'」('+atk.dp+'DP) vs 「'+def.name+'」('+def.dp+'DP)');

  function destroyDef() {
    if(defSide==='ai') { bs.ai.battleArea[defIdx]=null; bs.ai.trash.push(def); if(def.stack) def.stack.forEach(s => bs.ai.trash.push(s)); }
  }
  function destroyAtk() {
    bs.player.battleArea[atkIdx]=null; bs.player.trash.push(atk); if(atk.stack) atk.stack.forEach(s => bs.player.trash.push(s));
  }

  // VS演出（2枚並べて大きく BATTLE! 表示）
  showSecurityCheck(def, atk, () => {
    if(atk.dp === def.dp) {
      destroyDef(); destroyAtk(); renderAll();
      showDestroyEffect(def, () => {
        showDestroyEffect(atk, () => {
          showBattleResult('Lost...', '#ff4444', '両者消滅！', () => { addLog('💥 両者消滅！'); checkPendingTurnEnd(); });
        });
      });
    } else if(atk.dp > def.dp) {
      destroyDef(); renderAll();
      showDestroyEffect(def, () => {
        showBattleResult('Win!!', '#00ff88', '「'+def.name+'」を撃破！', () => { addLog('💥 「'+def.name+'」を撃破！'); checkAttackEnd(atk, atkIdx); });
      });
    } else {
      destroyAtk(); renderAll();
      showDestroyEffect(atk, () => {
        showBattleResult('Lost...', '#ff4444', '「'+atk.name+'」が撃破された', () => { addLog('💥 「'+atk.name+'」が撃破された...'); checkPendingTurnEnd(); });
      });
    }
  }, 'BATTLE!');
}

// アタック時効果でのメモリー超過によるターン終了（バトル後に呼ぶ）
function checkPendingTurnEnd() {
  renderAll();
  if (bs._pendingTurnEnd) {
    bs._pendingTurnEnd = false;
    bs.isPlayerTurn = false;
    expireBuffs(bs, 'dur_this_turn');
    expireBuffs(bs, 'permanent', 'player');
    updateMemGauge();
    renderAll(true);
    addLog('💾 メモリーが相手側へ → ' + (_onlineMode ? '相手のターン' : 'AIのターン'));
    showYourTurn('自分のターン終了', '', '#555555', () => {
      if (_onlineMode) {
        sendCommand({ type: 'endTurn', memory: bs.memory });
        showYourTurn('相手のターン','🎮 相手の操作を待っています...','#ff00fb', () => {});
      } else {
        setTimeout(() => aiTurn(), 500);
      }
    });
  }
}

// セキュリティアタック+Nの値を取得
// セキュリティバフをカードに適用（チェック前に呼ぶ）
function applySecurityBuffs(sec, ownerSide) {
  const buffs = bs._securityBuffs;
  if (!buffs || buffs.length === 0 || sec.type !== 'デジモン') return;
  // 元のDPを保存
  if (sec._origDp === undefined) sec._origDp = parseInt(sec.dp) || 0;
  let bonus = 0;
  buffs.forEach(b => {
    // オーナーが一致するバフのみ適用
    if (b.owner && b.owner !== ownerSide) return;
    if (b.type === 'dp_plus') bonus += (parseInt(b.value) || 0);
    if (b.type === 'dp_minus') bonus -= (parseInt(b.value) || 0);
  });
  if (bonus !== 0) {
    sec.dp = sec._origDp + bonus;
    addLog('🛡 セキュリティバフ適用: 「' + sec.name + '」DP ' + sec._origDp + ' → ' + sec.dp);
  }
}

function getSecurityAttackCount(card) {
  let extra = 0;
  const side = bs.isPlayerTurn ? 'player' : 'ai';

  function calcFromText(text, source) {
    if (!text || text === 'なし') return;
    // 「～ごとに」パターン（進化元/手札/トラッシュ/セキュリティ N枚ごとに）
    if (text.includes('ごとに') && (text.includes('Sアタック') || text.includes('セキュリティアタック'))) {
      // Sアタック+NのNを取得（デフォルト1）
      const saMatch = text.match(/(?:Sアタック|セキュリティアタック)\+(\d+)/);
      const perValue = saMatch ? parseInt(saMatch[1]) : 1;
      // per_count条件を取得
      const val = calcPerCountValue(text, card, bs, side);
      if (val > 0) {
        extra += val;
      } else {
        // calcPerCountValueがアクション認識できなかった場合、手動計算
        const conditions = text.match(/(\d+)枚ごとに/);
        if (conditions) {
          const n = parseInt(conditions[1]);
          const count = card.stack ? card.stack.length : 0;
          const multiplier = Math.floor(count / n);
          extra += perValue * multiplier;
        }
      }
      return;
    }
    // 通常の「Sアタック+N」（固定値）
    const matches = text.matchAll(/(?:Sアタック|セキュリティアタック)\+(\d+)/g);
    for (const m of matches) extra += parseInt(m[1]);
  }

  // カードのメイン効果
  calcFromText(card.effect, 'メイン効果');
  // 進化元効果（スタック内のみ）
  if (card.stack) {
    card.stack.forEach((s, i) => {
      calcFromText(s.evoSourceEffect, '進化元[' + i + ']' + s.name);
      // メイン効果も進化元として参照（進化元効果がないがメイン効果にSアタック+がある場合）
      if (!s.evoSourceEffect && s.effect && s.effect !== 'なし') {
        calcFromText(s.effect, '進化元メイン[' + i + ']' + s.name);
      }
    });
  }
  // 永続効果から付与されたSアタック+（cond_exists条件付き等）
  if (card._permEffects && card._permEffects.securityAttackPlus) {
    extra += card._permEffects.securityAttackPlus;
  }
  return 1 + extra;
}

function showSAttackPlusAnnounce(n, callback) {
  if (_onlineMode && bs.isPlayerTurn) sendCommand({ type: 'fx_sAttackPlus', n });
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:61000;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;top:50%;left:50%;font-size:clamp(1.8rem,8vw,3rem);font-weight:900;color:#ff2255;text-shadow:0 0 10px #ff2255,0 0 30px #ff4466,0 0 60px #ff0044,0 0 100px #ff006688;letter-spacing:3px;white-space:nowrap;padding:16px 36px;border:3px solid #ff3366;border-radius:14px;background:linear-gradient(135deg,rgba(40,0,10,0.95),rgba(80,0,20,0.95));animation:sAttackPlusSlam 2s cubic-bezier(0.22,1,0.36,1) forwards, sAttackPlusGlow 0.6s ease-in-out 0.25s 2;';
  el.innerText = '⚔ セキュリティアタック+' + n + '！！';
  overlay.appendChild(el);
  document.body.appendChild(overlay);
  setTimeout(() => { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); callback && callback(); }, 2200);
}

function resolveSecurityCheck(atk, atkIdx) {
  const totalChecks = getSecurityAttackCount(atk);
  let checksRemaining = totalChecks;
  let checkNumber = 0;
  if (totalChecks > 1) addLog('⚔ セキュリティチェック x' + totalChecks + '！');

  // セキュリティチェック画面上にラベルを大きく表示
  function showCheckLabelOnOverlay(text) {
    // 既存のラベルがあれば削除
    const old = document.getElementById('_sec-check-count-label');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const el = document.createElement('div');
    el.id = '_sec-check-count-label';
    el.style.cssText = 'position:fixed;top:10%;left:50%;transform:translateX(-50%);z-index:60001;pointer-events:none;font-size:clamp(0.9rem,4vw,1.3rem);font-weight:700;color:#fff;background:rgba(0,0,0,0.7);padding:6px 18px;border-radius:8px;border:1px solid #aaa;text-align:center;animation:secCheckLabel 2.5s ease forwards;';
    el.innerText = text;
    document.body.appendChild(el);
    setTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 2800);
  }

  function startChecks() {
    if(bs.ai.security.length > 0) {
      doNextCheck();
    } else {
      showDirectAttack(atk, 'player', () => { battleVictory(); });
    }
  }

  // Sアタック+N の場合、VS画面前に大きく演出表示
  if (totalChecks > 1) {
    showSAttackPlusAnnounce(totalChecks - 1, () => { startChecks(); });
  } else {
    startChecks();
  }

  function doNextCheck() {
    checksRemaining--;
    checkNumber++;
    // アタッカーが消滅していたら終了
    if (!bs.player.battleArea[atkIdx]) { checkAttackEnd(atk, atkIdx); return; }
    // セキュリティが0なら → チェック終了（ダイレクトアタックにはならない。次のアタックが必要）
    if (bs.ai.security.length <= 0) {
      addLog('🛡 相手のセキュリティが0枚になった');
      checkAttackEnd(atk, atkIdx);
      return;
    }

    const sec = bs.ai.security.splice(0,1)[0];
    if (_onlineMode) sendCommand({ type: 'security_remove', secName: sec.name, secType: sec.type, remaining: bs.ai.security.length });
    applySecurityBuffs(sec, 'ai');
    // VS画面上にチェック数ラベルを表示（「1枚目」「2枚目」…）
    const afterOpen = () => {
      if (totalChecks <= 1) return;
      showCheckLabelOnOverlay(checkNumber + '枚目');
    };
    showSecurityCheck(sec, atk, () => {
      console.log('[SEC-REVEAL] name:', sec.name, 'type:', sec.type, 'securityEffect:', sec.securityEffect, 'effect:', sec.effect?.substring(0,40));
      if(sec.type==='デジモン') {
        if(atk.dp === sec.dp) {
          bs.ai.trash.push(sec);
          bs.player.battleArea[atkIdx]=null; bs.player.trash.push(atk);
          if(atk.stack) atk.stack.forEach(s => bs.player.trash.push(s));
          renderAll();
          showDestroyEffect(sec, () => { showDestroyEffect(atk, () => {
            showBattleResult('Lost...','#ff4444','両者消滅！', () => { addLog('💥 両者消滅！'); checkPendingTurnEnd(); });
          }); });
          return;
        } else if(atk.dp > sec.dp) {
          bs.ai.trash.push(sec); renderAll();
          showDestroyEffect(sec, () => {
            showBattleResult('Win!!','#00ff88','セキュリティ突破！', () => {
              addLog('✓ セキュリティ突破');
              // セキュリティが0になったらチェック終了（ダイレクトアタックは次のアタックで）
              if (bs.ai.security.length <= 0) {
                addLog('🛡 相手のセキュリティが0枚になった');
                checkAttackEnd(atk, atkIdx);
              } else if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
              else { checkAttackEnd(atk, atkIdx); }
            });
          });
          return;
        } else {
          bs.player.battleArea[atkIdx]=null; bs.player.trash.push(atk);
          if(atk.stack) atk.stack.forEach(s => bs.player.trash.push(s));
          bs.ai.trash.push(sec); renderAll();
          showDestroyEffect(atk, () => {
            showBattleResult('Lost...','#ff4444','「'+atk.name+'」が撃破された', () => { addLog('✗ セキュリティに敗北'); checkPendingTurnEnd(); });
          });
          return;
        }
      } else if(sec.type==='テイマー') {
        bs.ai.tamerArea.push(sec);
        addLog('👤 テイマー「'+sec.name+'」が相手に登場'); renderAll();
        if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
        else { checkAttackEnd(atk, atkIdx); }
        return;
      } else {
        // オプション等 → セキュリティ効果を発動
        addLog('✦ セキュリティ効果：「'+sec.name+'」');
        console.log('[SEC] card:', sec.name, 'type:', sec.type, 'securityEffect:', sec.securityEffect?.substring(0,30), 'effect:', sec.effect?.substring(0,30));
        // securityEffect列があればそれを使う、なければeffect列から【セキュリティ】を探す
        const hasSecField = sec.securityEffect && sec.securityEffect.trim() && sec.securityEffect !== 'なし';
        const hasSecInEffect = sec.effect && sec.effect.includes('【セキュリティ】');
        console.log('[SEC] hasSecField:', hasSecField, 'hasSecInEffect:', hasSecInEffect);
        if (hasSecField || hasSecInEffect) {
          // securityEffect列にプレフィックスがなければ追加してからエンジンに渡す
          const secText = hasSecField ? sec.securityEffect : sec.effect;
          const originalEffect = sec.effect;
          if (hasSecField && !secText.includes('【セキュリティ】')) {
            sec.effect = '【セキュリティ】' + secText;
          }
          checkAndTriggerEffect(sec, '【セキュリティ】', () => {
            sec.effect = originalEffect; // 元に戻す
            bs.ai.trash.push(sec); renderAll();
            if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
            else { checkAttackEnd(atk, atkIdx); }
          }, 'ai');
        } else {
          bs.ai.trash.push(sec); renderAll();
          if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
          else { checkAttackEnd(atk, atkIdx); }
        }
        return;
      }
      // まだチェック回数が残っていれば続ける
      if (checksRemaining > 0) { setTimeout(() => doNextCheck(), 500); }
      else { checkAttackEnd(atk, atkIdx); }
    }, null, afterOpen);
  }

  // ※startChecks() で開始済み（Sアタック+演出後に呼ばれる）
}

function checkAttackEnd(atk, atkIdx) {
  if(hasKeyword(atk, '【アタック終了時】') && bs.player.battleArea[atkIdx]) {
    checkAndTriggerEffect(atk, '【アタック終了時】', () => checkPendingTurnEnd());
  } else { checkPendingTurnEnd(); }
}

// ===== パス・ターン終了 =====
window.onEndTurn = function() {
  if(!bs.isPlayerTurn) return;
  exitBreedPhase();
  if (_onlineMode) {
    // オンライン: メモリーを相手側3に設定してからコマンド送信
    bs.memory = -3; // 相手側の3（負=相手側）
    sendCommand({ type: 'endTurn', memory: bs.memory });
    updateMemGauge();
    expireBuffs(bs, 'dur_this_turn');
    expireBuffs(bs, 'permanent', 'player');
    renderAll();
    showYourTurn('自分のターン終了','','#555555', () => {
      bs.isPlayerTurn = false;
      showYourTurn('相手のターン','🎮 相手の操作を待っています...','#ff00fb', () => {
        addLog('⏳ 相手のターン（操作待ち）');
      });
    });
    return;
  }
  checkTurnEndEffects(() => {
    // AI対戦: ターン終了 → AI側3にメモリ移動
    bs.memory = -3;
    updateMemGauge();
    expireBuffs(bs, 'dur_this_turn');
    expireBuffs(bs, 'permanent', 'player');
    renderAll();
    showYourTurn('自分のターン終了','','#555555', () => {
      bs.isPlayerTurn=false;
      setTimeout(() => aiTurn(),500);
    });
  });
};

// ===== メモリー =====
// bs.memory: 正(+)=自分側(左)、負(-)=相手側(右)、0=中立（全プレイヤー共通）
function updateMemGauge() {
  const row=document.getElementById('memory-gauge-row'); if(!row) return;
  row.innerHTML='';
  // 先攻=青(cyan/m-pl)、後攻=赤(magenta/m-ai)
  // 先攻画面: 左=青(自分), 右=赤(相手) → 左=m-pl, 右=m-ai
  // 後攻画面: 左=赤(自分), 右=青(相手) → 左=m-ai, 右=m-pl（クラス反転）
  const isFirst = !_onlineMode || _onlineMyKey === 'player1';
  for(let i=MEM_MAX;i>=MEM_MIN;i--){
    const el=document.createElement('div'); el.className='m-cell'; el.innerText=i===0?'0':Math.abs(i);
    if(i===0) el.classList.add('m-zero');
    else if(i>0) el.classList.add(isFirst ? 'm-pl' : 'm-ai'); // 自分側（左）
    else el.classList.add(isFirst ? 'm-ai' : 'm-pl'); // 相手側（右）
    if(i===bs.memory) el.classList.add('m-active');
    row.appendChild(el);
  }
  const lbl=document.getElementById('m-turn-lbl');
  if(lbl){
    lbl.innerText=bs.isPlayerTurn?'あなたのターン':(_onlineMode?'相手のターン':'AIのターン');
    if (_onlineMode) {
      lbl.style.color = bs.isPlayerTurn ? getMyTurnColor() : getOppTurnColor();
    }
    lbl.className='m-turn-label '+(bs.isPlayerTurn?'pl':'ai');
  }
  document.getElementById('t-count')&&(document.getElementById('t-count').innerText=bs.turn);
}

// オンライン: 自分/相手のターン色を取得
function getMyTurnColor() {
  if (!_onlineMode) return '#00fbff';
  return _onlineMyKey === 'player1' ? '#00fbff' : '#ff00fb'; // 先攻=青、後攻=ピンク
}
function getOppTurnColor() {
  if (!_onlineMode) return '#ff00fb';
  return _onlineMyKey === 'player1' ? '#ff00fb' : '#00fbff'; // 先攻の相手=ピンク、後攻の相手=青
}

// プレイヤーがコスト消費（メモリーが右=相手側へ動く）
function spendMemory(cost) {
  if(cost===0) { updateMemGauge(); return false; }
  bs.memory -= cost; // 常に負方向（相手側=右）へ動く
  updateMemGauge();
  sendMemoryUpdate(); // 相手に即時通知
  // メモリーが相手側（負）に入ったらターン終了
  const overflowed = bs.memory < 0;
  if(overflowed){
    addLog('💾 メモリー'+Math.abs(bs.memory)+'で相手側へ');
    bs.isPlayerTurn=false;
    expireBuffs(bs, 'dur_this_turn');
    expireBuffs(bs, 'permanent', 'player');
    renderAll(true);
    checkTurnEndEffects(() => {
      showYourTurn('自分のターン終了','','#555555', () => {
        if (_onlineMode) {
          sendCommand({ type: 'endTurn', memory: bs.memory });
          showYourTurn('相手のターン','🎮 相手の操作を待っています...','#ff00fb', () => {});
        } else {
          setTimeout(() => aiTurn(),500);
        }
      });
    });
    return true;
  }
  return false;
}

// AIがコスト消費（メモリーが右=プレイヤー側へ動く）
function aiSpendMemory(cost) {
  if(cost===0) return false;
  bs.memory += cost;
  updateMemGauge();
  return bs.memory > 0;
}

// ===== AI =====
function aiTurn() {
  if (bs._battleAborted) return;
  if (_onlineMode) return; // オンライン時はAI不使用（相手プレイヤーの操作を待つ）
  bs.turn++;
  showYourTurn('相手のターン開始','🤖 デジモンマスター','#ff00fb', () => {
    checkTurnStartEffects('ai', () => {
      // 両サイドの永続効果を再計算（ターン交代で「自分のターン」効果が切れる）
      applyPermanentEffects(bs, 'player', makeEffectContext(null, 'player'));
      applyPermanentEffects(bs, 'ai', makeEffectContext(null, 'ai'));
      renderAll();
      addLog('🤖 AIのターン');
      aiPhaseUnsuspend();
    });
  });
}

// AIアクティブフェイズ
function aiPhaseUnsuspend() {
  const hasRested = bs.ai.battleArea.some(c => c && c.suspended);
  if(hasRested) {
    showPhaseAnnounce('🔄 アクティブフェイズ', '#00fbff', () => {
      bs.ai.battleArea.forEach(c => { if(c) { c.suspended=false; c.summonedThisTurn=false; c._usedEffects=[]; } });
      addLog('🤖 アクティブフェイズ完了');
      renderAll();
      setTimeout(() => aiPhaseDraw(), 500);
    });
  } else {
    showSkipAnnounce('🔄 アクティブフェイズ スキップ！', () => {
      bs.ai.battleArea.forEach(c => { if(c) { c.summonedThisTurn=false; c._usedEffects=[]; } });
      setTimeout(() => aiPhaseDraw(), 300);
    });
  }
}

// AIドローフェイズ
function aiPhaseDraw() {
  if(bs.ai.deck.length > 0) {
    const c = bs.ai.deck.splice(0,1)[0];
    bs.ai.hand.push(c);
    showPhaseAnnounce('🃏 ドローフェイズ', '#00ff88', () => {
      addLog('🤖 AIがドロー');
      renderAll();
      setTimeout(() => aiPhaseBreed(), 500);
    });
  } else {
    // AIデッキ切れ → プレイヤーの勝利
    addLog('⚠ AIのデッキ切れ！');
    showBattleResult('DECK OUT!!', '#00ff88', '相手のデッキ切れで勝利！', () => { battleVictory(); });
    return;
  }
}

// AI育成フェイズ
function aiPhaseBreed() {
  // 育成エリアにLv3以上がいれば → バトルエリアへ移動
  if(bs.ai.ikusei && parseInt(bs.ai.ikusei.level) >= 3) {
    let slot = bs.ai.battleArea.findIndex(s => s===null);
    if(slot === -1) { slot = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }
    showPhaseAnnounce('🥚 育成フェイズ', '#ff9900', () => {
      const moved = bs.ai.ikusei;
      bs.ai.battleArea[slot] = moved; bs.ai.ikusei = null;
      addLog('🤖 AIが「' + moved.name + '」を育成エリアからバトルエリアへ移動');
      renderAll();
      // 登場時効果をトリガー
      checkAndTriggerEffect(moved, '【登場時】', () => {
        // 育成エリアが空になったので孵化も試みる
        if (!bs.ai.ikusei && bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0) {
          const c = bs.ai.tamaDeck.splice(0,1)[0];
          bs.ai.ikusei = c;
          addLog('🤖 AIがデジタマを孵化！');
          showHatchEffect(c, () => { renderAll(); setTimeout(() => aiPhaseMain(), 500); });
        } else {
          setTimeout(() => aiPhaseMain(), 500);
        }
      }, 'ai');
    });
  }
  // 育成エリアが空でデジタマがあれば孵化
  else if(!bs.ai.ikusei && bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0) {
    const c = bs.ai.tamaDeck.splice(0,1)[0];
    bs.ai.ikusei = c;
    showPhaseAnnounce('🥚 育成フェイズ', '#ff9900', () => {
      addLog('🤖 AIがデジタマを孵化！');
      showHatchEffect(c, () => { renderAll(); setTimeout(() => aiPhaseMain(), 500); });
    });
  }
  // 育成エリアにLv2がいる（進化はメインフェイズで処理）
  else {
    showSkipAnnounce('🥚 育成フェイズ スキップ！', () => { setTimeout(() => aiPhaseMain(), 300); });
  }
}

// AIメインフェイズ
function aiPhaseMain() {
  showPhaseAnnounce('⚡ メインフェイズ', '#ff00fb', () => {
    addLog('🤖 メインフェイズ');
    aiMainPhase(() => {
      // AIアタック（アクティブなデジモンがいれば）
      aiAttackPhase(() => {
        endAiTurn();
      });
    });
  });
}

// AIアタック（アクティブなカードで順番にアタック）
function aiAttackPhase(callback) {
  if (bs._battleAborted) return;
  if (_onlineMode) { callback && callback(); return; } // オンライン時はAI不使用
  // デジモンタイプのみアタック可能（テイマー・オプションはアタック不可）
  const atkIdx = bs.ai.battleArea.findIndex(c => c && c.type==='デジモン' && !c.suspended && !c.summonedThisTurn);
  if(atkIdx === -1) { callback(); return; }

  const atk = bs.ai.battleArea[atkIdx];
  atk.suspended = true;
  addLog('🤖 「'+atk.name+'」でアタック！');
  renderAll();

  showPhaseAnnounce('⚔ AIアタック！', '#ff4444', () => {
    // AIアタック時効果をトリガー
    const doAfterAtkEffect = (cb) => {
      if (hasKeyword(atk, '【アタック時】') || (atk.stack && atk.stack.some(s => s.evoSourceEffect && s.evoSourceEffect.includes('【アタック時】')))) {
        checkAndTriggerEffect(atk, '【アタック時】', cb, 'ai');
      } else { cb(); }
    };
    doAfterAtkEffect(() => {
    // ブロッカーチェック：プレイヤーのアクティブなブロッカー持ち全てを取得
    const blockerIndices = [];
    bs.player.battleArea.forEach((c, i) => {
      if (c && !c.suspended && (hasKeyword(c,'【ブロッカー】') || hasEvoKeyword(c,'【ブロッカー】'))) {
        blockerIndices.push(i);
      }
    });
    if(blockerIndices.length > 0) {
      // 「ブロックしますか？」と聞く
      showBlockConfirm(bs.player.battleArea[blockerIndices[0]], atk, (doBlock) => {
        if(doBlock) {
          if (blockerIndices.length === 1) {
            // ブロッカー1体 → そのままブロック
            const blockerIdx = blockerIndices[0];
            const blocker = bs.player.battleArea[blockerIdx];
            blocker.suspended = true;
            addLog('🛡 「'+blocker.name+'」でブロック！');
            renderAll();
            resolveBattleAI(atk, atkIdx, blocker, blockerIdx, () => {
              setTimeout(() => aiAttackPhase(callback), 800);
            });
          } else {
            // ブロッカー複数 → 選択UI
            showBlockerSelection(blockerIndices, atk, (selectedIdx) => {
              if (selectedIdx !== null) {
                const blocker = bs.player.battleArea[selectedIdx];
                blocker.suspended = true;
                addLog('🛡 「'+blocker.name+'」でブロック！');
                renderAll();
                resolveBattleAI(atk, atkIdx, blocker, selectedIdx, () => {
                  setTimeout(() => aiAttackPhase(callback), 800);
                });
              } else {
                // キャンセル → ブロックしない
                doAiSecurityCheck(atk, atkIdx, callback);
              }
            });
          }
        } else {
          doAiSecurityCheck(atk, atkIdx, callback);
        }
      });
      return;
    }

    // ブロッカーなし → セキュリティチェック
    doAiSecurityCheck(atk, atkIdx, callback);
    }); // doAfterAtkEffect
  });
}

// ===== オンラインブロッカー処理 =====

// 攻撃側: 相手のブロック応答を待つ
function waitForBlockResponse(callback) {
  const waitOv = document.createElement('div');
  waitOv.id = '_block-wait-overlay';
  waitOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:55000;display:flex;align-items:center;justify-content:center;';
  waitOv.innerHTML = '<div style="color:#ff00fb;font-size:14px;font-weight:bold;text-align:center;text-shadow:0 0 10px #ff00fb;">⏳ 相手のブロック確認中...</div>';
  document.body.appendChild(waitOv);

  function onResponse(resp) {
    if (waitOv.parentNode) waitOv.parentNode.removeChild(waitOv);
    callback(resp);
  }

  if (_pendingBlockResponse !== null) {
    const resp = _pendingBlockResponse;
    _pendingBlockResponse = null;
    onResponse(resp);
  } else {
    _pendingBlockCallback = onResponse;
  }

  // タイムアウト（30秒）
  setTimeout(() => {
    if (_pendingBlockCallback === onResponse) {
      _pendingBlockCallback = null;
      onResponse({ blocked: false });
    }
  }, 30000);
}

// 防御側: ブロッカーチェック（オンラインでアタックを受けた時）
function checkOnlineBlock(cmd) {
  if (!_onlineMode) return;
  const blockerIndices = [];
  bs.player.battleArea.forEach((c, i) => {
    if (c && !c.suspended && (hasKeyword(c,'【ブロッカー】') || hasEvoKeyword(c,'【ブロッカー】'))) {
      blockerIndices.push(i);
    }
  });

  if (blockerIndices.length === 0) {
    sendCommand({ type: 'block_response', blocked: false });
    return;
  }

  const attacker = { name: cmd.atkName || '???', dp: cmd.atkDp || 0, imgSrc: cmd.atkImg || '' };

  showBlockConfirm(bs.player.battleArea[blockerIndices[0]], attacker, (doBlock) => {
    if (!doBlock) {
      sendCommand({ type: 'block_response', blocked: false });
      return;
    }
    if (blockerIndices.length === 1) {
      resolveOnlineBlock(blockerIndices[0], cmd);
    } else {
      showBlockerSelection(blockerIndices, attacker, (selectedIdx) => {
        if (selectedIdx !== null) {
          resolveOnlineBlock(selectedIdx, cmd);
        } else {
          sendCommand({ type: 'block_response', blocked: false });
        }
      });
    }
  });
}

// 防御側: ブロックバトル解決
function resolveOnlineBlock(blockerIdx, cmd) {
  const blocker = bs.player.battleArea[blockerIdx];
  const atkIdx = cmd.atkIdx;
  const atk = bs.ai.battleArea[atkIdx];
  if (!blocker || !atk) {
    sendCommand({ type: 'block_response', blocked: false });
    return;
  }

  blocker.suspended = true;
  addLog('🛡 「' + blocker.name + '」でブロック！');
  renderAll();

  // 攻撃側の「ブロック確認中」表示を即座に消す
  sendCommand({ type: 'waiting_close' });

  // バトル解決
  addLog('⚔ 「' + atk.name + '」(' + atk.dp + 'DP) vs 「' + blocker.name + '」(' + blocker.dp + 'DP)');

  // 攻撃側にもVS演出を送信
  sendCommand({ type: 'fx_securityCheck', secName: blocker.name, secImg: cardImg(blocker), secDp: blocker.dp, secType: 'デジモン', atkName: atk.name, atkImg: cardImg(atk), atkDp: atk.dp, customLabel: 'BLOCK!' });

  showSecurityCheck(blocker, atk, () => {
    let atkResult = 'survived';
    if (atk.dp === blocker.dp) {
      // 両者消滅
      atkResult = 'both_destroyed';
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk); if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      bs.player.battleArea[blockerIdx] = null; bs.player.trash.push(blocker); if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s));
      renderAll();
      sendCommand({ type: 'fx_destroy', cardName: blocker.name, cardImg: cardImg(blocker) });
      sendCommand({ type: 'fx_destroy', cardName: atk.name, cardImg: cardImg(atk) });
      sendCommand({ type: 'fx_battleResult', text: 'Win!!', color: '#00ff88', sub: '両者消滅！' });
      showDestroyEffect(blocker, () => { showDestroyEffect(atk, () => {
        showBattleResult('Lost...', '#ff4444', '両者消滅！', () => {
          addLog('💥 両者消滅！');
          sendCommand({ type: 'block_response', blocked: true, atkIdx: atkIdx, atkResult: atkResult });
          sendStateSync();
        });
      }); });
    } else if (atk.dp > blocker.dp) {
      // ブロッカー撃破（攻撃者生存）
      atkResult = 'survived';
      bs.player.battleArea[blockerIdx] = null; bs.player.trash.push(blocker); if (blocker.stack) blocker.stack.forEach(s => bs.player.trash.push(s));
      renderAll();
      sendCommand({ type: 'fx_destroy', cardName: blocker.name, cardImg: cardImg(blocker) });
      sendCommand({ type: 'fx_battleResult', text: 'Win!!', color: '#00ff88', sub: '「' + blocker.name + '」が撃破された' });
      showDestroyEffect(blocker, () => {
        showBattleResult('Lost...', '#ff4444', '「' + blocker.name + '」が撃破された', () => {
          addLog('💥 「' + blocker.name + '」が撃破された');
          sendCommand({ type: 'block_response', blocked: true, atkIdx: atkIdx, atkResult: atkResult });
          sendStateSync();
        });
      });
    } else {
      // 攻撃者撃破
      atkResult = 'destroyed';
      bs.ai.battleArea[atkIdx] = null; bs.ai.trash.push(atk); if (atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
      renderAll();
      sendCommand({ type: 'fx_destroy', cardName: atk.name, cardImg: cardImg(atk) });
      sendCommand({ type: 'fx_battleResult', text: 'Lost...', color: '#ff4444', sub: '「' + atk.name + '」を撃破！' });
      showDestroyEffect(atk, () => {
        showBattleResult('Win!!', '#00ff88', '「' + atk.name + '」を撃破！', () => {
          addLog('💥 「' + atk.name + '」を撃破！');
          sendCommand({ type: 'block_response', blocked: true, atkIdx: atkIdx, atkResult: atkResult });
          sendStateSync();
        });
      });
    }
  }, 'BLOCK!');
}

// ブロック確認ダイアログ
function showBlockConfirm(blocker, attacker, callback) {
  const overlay = document.getElementById('effect-confirm-overlay');
  if(!overlay) { callback(false); return; }
  const nameEl = document.getElementById('effect-confirm-name');
  nameEl.innerText = '🚨💥 アタック中！！ 💥🚨';
  nameEl.style.color = '#ff2222';
  nameEl.style.textShadow = '0 0 10px #ff0000, 0 0 20px #ff000088';
  nameEl.style.fontSize = '1.2rem';
  document.getElementById('effect-confirm-text').innerText =
    '相手の「'+attacker.name+'」(DP:'+attacker.dp+')がアタックしてきました！';
  const questionEl = document.getElementById('effect-confirm-question');
  if (questionEl) questionEl.innerText = 'ブロックしますか？';
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
  window._effectConfirmCallback = function(result) {
    // スタイルを元に戻す
    nameEl.style.color = '#fff';
    nameEl.style.textShadow = '';
    nameEl.style.fontSize = '1rem';
    if (questionEl) questionEl.innerText = '効果を発動しますか？';
    callback(result);
  };
}

// ブロッカー選択UI（複数ブロッカーがいる場合）
function showBlockerSelection(blockerIndices, attacker, callback) {
  const row = document.getElementById('pl-battle-row');
  if (!row) { callback(null); return; }

  addLog('🛡 ブロックするデジモンを選んでください');

  // メッセージ
  const msgEl = document.createElement('div');
  msgEl.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:60000;background:rgba(0,0,0,0.9);border:1px solid #00fbff;border-radius:10px;padding:12px 24px;color:#00fbff;font-size:14px;font-weight:bold;text-align:center;box-shadow:0 0 20px #00fbff44;pointer-events:none;';
  msgEl.innerText = '🛡 ブロックするデジモンを選択';
  document.body.appendChild(msgEl);

  const slots = row.querySelectorAll('.b-slot');

  // ブロッカーを光らせる
  blockerIndices.forEach(idx => {
    const slot = slots[idx];
    if (!slot) return;
    slot.style.border = '2px solid #00fbff';
    slot.style.boxShadow = '0 0 15px #00fbff';
    slot.style.cursor = 'pointer';
  });

  function cleanup() {
    if (msgEl.parentNode) msgEl.parentNode.removeChild(msgEl);
    blockerIndices.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      slot.style.border = '';
      slot.style.boxShadow = '';
      slot.style.cursor = '';
    });
    document.removeEventListener('click', onSelect, true);
    document.removeEventListener('touchend', onSelect, true);
  }

  function onSelect(e) {
    const cx = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    const cy = e.clientY || (e.changedTouches && e.changedTouches[0].clientY);
    if (!cx || !cy) return;

    let selectedIdx = null;
    blockerIndices.forEach(idx => {
      const slot = slots[idx];
      if (!slot) return;
      const r = slot.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        selectedIdx = idx;
      }
    });

    if (selectedIdx !== null) {
      cleanup();
      callback(selectedIdx);
    }
  }

  setTimeout(() => {
    document.addEventListener('click', onSelect, true);
    document.addEventListener('touchend', onSelect, true);
  }, 100);
}

// AI側 vs プレイヤーブロッカーのバトル
function resolveBattleAI(atk, atkIdx, def, defIdx, callback) {
  addLog('⚔ 「'+atk.name+'」('+atk.dp+'DP) vs 「'+def.name+'」('+def.dp+'DP)');
  showSecurityCheck(def, atk, () => {
    if(atk.dp === def.dp) {
      bs.ai.battleArea[atkIdx]=null; bs.ai.trash.push(atk); if(atk.stack) atk.stack.forEach(s=>bs.ai.trash.push(s));
      bs.player.battleArea[defIdx]=null; bs.player.trash.push(def); if(def.stack) def.stack.forEach(s=>bs.player.trash.push(s));
      renderAll();
      showDestroyEffect(def, () => { showDestroyEffect(atk, () => {
        showBattleResult('Lost...','#ff4444','両者消滅！', () => { addLog('💥 両者消滅！'); renderAll(); callback(); });
      }); });
    } else if(atk.dp > def.dp) {
      bs.player.battleArea[defIdx]=null; bs.player.trash.push(def); if(def.stack) def.stack.forEach(s=>bs.player.trash.push(s));
      renderAll();
      showDestroyEffect(def, () => {
        showBattleResult('Lost...','#ff4444','「'+def.name+'」が撃破された', () => { addLog('💥 「'+def.name+'」が撃破された'); renderAll(); callback(); });
      });
    } else {
      bs.ai.battleArea[atkIdx]=null; bs.ai.trash.push(atk); if(atk.stack) atk.stack.forEach(s=>bs.ai.trash.push(s));
      renderAll();
      showDestroyEffect(atk, () => {
        showBattleResult('Win!!','#00ff88','「'+atk.name+'」を撃破！', () => { addLog('💥 「'+atk.name+'」を撃破！'); renderAll(); callback(); });
      });
    }
  }, 'BATTLE!');
}

// AI側セキュリティチェック処理
function doAiSecurityCheck(atk, atkIdx, callback) {
    if(bs.player.security.length > 0) {
      const sec = bs.player.security.splice(0,1)[0];
      applySecurityBuffs(sec, 'player');
      showSecurityCheck(sec, atk, () => {
        if(sec.type === 'デジモン') {
          if(atk.dp === sec.dp) {
            bs.ai.battleArea[atkIdx]=null; bs.ai.trash.push(atk);
            if(atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
            bs.player.trash.push(sec);
            showDestroyEffect(atk, () => { addLog('💥 両者消滅！'); renderAll(); setTimeout(() => aiAttackPhase(callback),800); });
          } else if(sec.dp > atk.dp) {
            bs.ai.battleArea[atkIdx]=null; bs.ai.trash.push(atk);
            if(atk.stack) atk.stack.forEach(s => bs.ai.trash.push(s));
            bs.player.trash.push(sec);
            showDestroyEffect(atk, () => { addLog('💥 「'+atk.name+'」が撃破された'); renderAll(); setTimeout(() => aiAttackPhase(callback),800); });
          } else {
            bs.player.trash.push(sec);
            addLog('✓ セキュリティ突破'); renderAll();
            // セキュリティ0になったらチェック終了（ダイレクトアタックは次のアタックで）
            if (bs.player.security.length <= 0) {
              addLog('🛡 自分のセキュリティが0枚になった');
            }
            setTimeout(() => aiAttackPhase(callback),800);
          }
        } else if(sec.type === 'テイマー') {
          const empty=bs.player.tamerArea;
          empty.push(sec);
          addLog('👤 テイマー「'+sec.name+'」がプレイヤーバトルエリアに登場');
          renderAll(); setTimeout(() => aiAttackPhase(callback),800);
        } else {
          addLog('✦ セキュリティ効果：「'+sec.name+'」');
          const hasSecField2 = sec.securityEffect && sec.securityEffect.trim() && sec.securityEffect !== 'なし';
          const hasSecInEffect2 = sec.effect && sec.effect.includes('【セキュリティ】');
          if (hasSecField2 || hasSecInEffect2) {
            const secText2 = hasSecField2 ? sec.securityEffect : sec.effect;
            const originalEffect2 = sec.effect;
            if (hasSecField2 && !secText2.includes('【セキュリティ】')) {
              sec.effect = '【セキュリティ】' + secText2;
            }
            checkAndTriggerEffect(sec, '【セキュリティ】', () => {
              sec.effect = originalEffect2;
              bs.player.trash.push(sec); renderAll();
              setTimeout(() => aiAttackPhase(callback),800);
            }, 'player');
          } else {
            bs.player.trash.push(sec);
            renderAll(); setTimeout(() => aiAttackPhase(callback),800);
          }
        }
      });
    } else {
      // セキュリティ0の状態で新たにアタック → ダイレクトアタック！
      const aiAtk = bs.ai.battleArea.find(c => c !== null) || { name: 'AI', dp: 0 };
      showDirectAttack(aiAtk, 'ai', () => { battleDefeat(); });
    }
}

// AI行動スクリプト（ターンごとに指定可能）
// play: カード名の配列で登場順を指定
// 追加例: 2: { play: ['アグモン'] }
const AI_SCRIPTS = {
  1: { play: ['ベムモン', 'ベムモン'] },
};

// AIメインフェイズ
// AIターン中: bs.memory は負の値（AI側）。AIがコスト使うとプラス方向へ動く。
// bs.memory > 0 になったらプレイヤー側に移った = AIターン終了
function aiCanAct() { return bs.memory <= 0; } // メモリーが0以下（AI側or中立）なら行動可能
function aiAvailableMemory() { return Math.abs(bs.memory); } // AIが使えるメモリー量（0なら0コストのみ）

function aiMainPhase(callback) {
  if(!aiCanAct()) { callback(); return; }

  const script = AI_SCRIPTS[bs.turn];
  if(script && script.play && script.play.length > 0) {
    aiPlayScript([...script.play], callback);
  } else {
    aiPlayAuto(callback);
  }
}

// AI共通：カード1枚プレイ（プレイヤーと同じルール適用）
// AI版：演出付きカードプレイ（非同期コールバック）
function aiPlayCard(c, handIdx, onDone) {
  let empty = bs.ai.battleArea.findIndex(s => s === null);
  if(empty === -1) { empty = bs.ai.battleArea.length; bs.ai.battleArea.push(null); }

  if(c.type === 'オプション') {
    bs.ai.hand.splice(handIdx, 1);
    addLog('🤖 AIが「'+c.name+'」を使用！（コスト'+c.playCost+'）');
    renderAll();
    showOptionEffect(c, () => {
      // メモリー消費 → メイン効果を発動
      const turnEnded = aiSpendMemory(c.playCost);
      checkAndTriggerEffect(c, '【メイン】', () => {
        bs.ai.trash.push(c);
        renderAll(true);
        onDone(turnEnded);
      }, 'ai');
    });
    return;
  }

  if(c.type === 'テイマー') {
    bs.ai.hand.splice(handIdx, 1);
    bs.ai.tamerArea.push(c);
    addLog('🤖 AIが「'+c.name+'」を登場！（コスト'+c.playCost+'）');
    renderAll();
    showPlayEffect(c, () => {
      const turnEnded = aiSpendMemory(c.playCost);
      applyPermanentEffects(bs, 'ai', makeEffectContext(c, 'ai'));
      renderAll();
      onDone(turnEnded);
    });
    return;
  }

  c.summonedThisTurn = true;
  bs.ai.battleArea[empty] = c;
  bs.ai.hand.splice(handIdx, 1);
  addLog('🤖 AIが「'+c.name+'」を登場！（コスト'+c.playCost+'）');
  renderAll();
  showPlayEffect(c, () => {
    const turnEnded = aiSpendMemory(c.playCost); renderAll();
    onDone(turnEnded);
  });
}

// スクリプト行動
function aiPlayScript(cardNames, callback) {
  if(cardNames.length === 0 || !aiCanAct()) { callback(); return; }

  const targetName = cardNames.shift();
  const handIdx = bs.ai.hand.findIndex(c => c.name === targetName && c.level !== '2' && c.playCost !== null);

  if(handIdx !== -1) {
    const c = bs.ai.hand[handIdx];
    aiPlayCard(c, handIdx, (turnEnded) => {
      if(turnEnded) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayScript(cardNames, callback), 500);
    });
  } else {
    setTimeout(() => aiPlayScript(cardNames, callback), 100);
  }
}

// 自動行動（進化 → オプション/テイマー → 登場 の優先順で行動）
function aiPlayAuto(callback) {
  if(!aiCanAct()) { callback(); return; }

  // ① 育成エリアで進化を試みる
  if (bs.ai.ikusei && bs.ai.ikusei.type === 'デジモン') {
    const ikuseiLv = parseInt(bs.ai.ikusei.level) || 0;
    const evoCandidate = bs.ai.hand.find(c =>
      c.type === 'デジモン' && parseInt(c.level) === ikuseiLv + 1 &&
      c.evolveCost !== null && c.evolveCost <= aiAvailableMemory()
    );
    if (evoCandidate) {
      const handIdx = bs.ai.hand.indexOf(evoCandidate);
      bs.ai.hand.splice(handIdx, 1);
      const oldCard = bs.ai.ikusei;
      evoCandidate.stack = [...(oldCard.stack || []), oldCard];
      evoCandidate.summonedThisTurn = false;
      evoCandidate.suspended = oldCard.suspended;
      evoCandidate.baseDp = parseInt(evoCandidate.dp) || 0;
      evoCandidate.dpModifier = 0;
      evoCandidate.buffs = [];
      bs.ai.ikusei = evoCandidate;
      addLog('🤖 AIが育成エリアで「' + oldCard.name + '」→「' + evoCandidate.name + '」に進化！');
      const turnEnded = aiSpendMemory(evoCandidate.evolveCost);
      renderAll();
      showEvolveEffect(evoCandidate.evolveCost, oldCard.name, oldCard, evoCandidate, () => {
        if (turnEnded) { setTimeout(() => callback(), 500); return; }
        setTimeout(() => aiPlayAuto(callback), 600);
      });
      return;
    }
  }

  // ② バトルエリアで進化を試みる
  for (let i = 0; i < bs.ai.battleArea.length; i++) {
    const base = bs.ai.battleArea[i];
    if (!base || base.type !== 'デジモン') continue;
    const baseLv = parseInt(base.level) || 0;
    const evoCandidate = bs.ai.hand.find(c =>
      c.type === 'デジモン' && parseInt(c.level) === baseLv + 1 &&
      c.evolveCost !== null && c.evolveCost <= aiAvailableMemory()
    );
    if (evoCandidate) {
      const handIdx = bs.ai.hand.indexOf(evoCandidate);
      bs.ai.hand.splice(handIdx, 1);
      evoCandidate.stack = [...(base.stack || []), base];
      evoCandidate.summonedThisTurn = false;
      evoCandidate.suspended = base.suspended;
      evoCandidate.baseDp = parseInt(evoCandidate.dp) || 0;
      evoCandidate.dpModifier = 0;
      evoCandidate.buffs = [];
      bs.ai.battleArea[i] = evoCandidate;
      addLog('🤖 AIが「' + base.name + '」→「' + evoCandidate.name + '」に進化！');
      const turnEnded = aiSpendMemory(evoCandidate.evolveCost);
      renderAll();
      showEvolveEffect(evoCandidate.evolveCost, base.name, base, evoCandidate, () => {
        // 進化時効果をトリガー
        checkAndTriggerEffect(evoCandidate, '【進化時】', () => {
          applyPermanentEffects(bs, 'ai', makeEffectContext(evoCandidate, 'ai'));
          renderAll();
          if (turnEnded) { setTimeout(() => callback(), 500); return; }
          setTimeout(() => aiPlayAuto(callback), 600);
        }, 'ai');
      });
      return;
    }
  }

  const available = aiAvailableMemory();

  // ③ オプション/テイマーを使用
  const optionOrTamer = bs.ai.hand.find(c =>
    (c.type === 'オプション' || c.type === 'テイマー') &&
    c.playCost !== null && c.playCost <= available
  );
  if (optionOrTamer) {
    const handIdx = bs.ai.hand.indexOf(optionOrTamer);
    aiPlayCard(optionOrTamer, handIdx, (turnEnded) => {
      if (turnEnded) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 500);
    });
    return;
  }

  // ④ デジモンを登場（コスト内で一番レベルの高いものを優先）
  const playable = bs.ai.hand.filter(c =>
    c.type === 'デジモン' && c.level !== '2' && c.playCost !== null && c.playCost <= available
  );

  if(playable.length > 0) {
    playable.sort((a,b) => a.playCost - b.playCost);
    const c = playable[0];
    const handIdx = bs.ai.hand.indexOf(c);
    aiPlayCard(c, handIdx, (turnEnded) => {
      if(turnEnded) { setTimeout(() => callback(), 500); return; }
      setTimeout(() => aiPlayAuto(callback), 500);
    });
  } else {
    callback();
  }
}

function endAiTurn() {
  // AIターン終了時バフリセット
  expireBuffs(bs, 'dur_this_turn');
  expireBuffs(bs, 'dur_next_opp_turn'); // 「次の相手ターン終了時まで」のバフを除去
  expireBuffs(bs, 'permanent', 'ai'); // AIの永続効果リセット
  renderAll();
  // プレイヤー側3にメモリ移動
  bs.memory = 3;
  updateMemGauge();

  showYourTurn('相手のターン終了','','#555555', () => {
    bs.isPlayerTurn=true;
    showYourTurn('自分のターン開始','','#00fbff', () => {
      checkTurnStartEffects('player', () => { applyPermanentEffects(bs, 'player', makeEffectContext(null,'player')); applyPermanentEffects(bs, 'ai', makeEffectContext(null,'ai')); renderAll(); setTimeout(() => startPhase('unsuspend'),300); });
    });
  });
}

// ===== ゲートを出る =====
window.confirmExitGate = function() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:50000;display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#0a0a1a;border:2px solid #ff4444;border-radius:12px;padding:24px;text-align:center;max-width:300px;width:90%;';

  box.innerHTML = '<div style="color:#ff4444;font-size:16px;font-weight:bold;margin-bottom:12px;">⚠ 退室確認</div>'
    + '<div style="color:#ccc;font-size:13px;margin-bottom:20px;">ゲートを出ますか？<br>バトルの進行状況は失われます。</div>'
    + '<div style="display:flex;gap:10px;justify-content:center;">'
    + '<button id="exit-yes-btn" style="background:#ff4444;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;">はい</button>'
    + '<button id="exit-no-btn" style="background:#333;color:#fff;border:1px solid #666;padding:10px 24px;border-radius:8px;font-size:14px;cursor:pointer;">いいえ</button>'
    + '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('exit-yes-btn').onclick = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    // オンライン: 退室通知を送信
    if (_onlineMode) sendCommand({ type: 'player_exit', playerName: currentPlayerName || '相手' });
    cleanupBattle();
    showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen');
    _onlineMode = false;
  };
  document.getElementById('exit-no-btn').onclick = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  };
};

// バトル中のオーバーレイ・タイマーを全てクリーンアップ
function cleanupBattle() {
  // AI処理を停止（フラグで制御）
  bs._battleAborted = true;
  // バトル画面内の全オーバーレイを非表示
  const overlayIds = [
    'your-turn-overlay', 'phase-announce-overlay', 'skip-announce-overlay',
    'security-check-overlay', 'battle-result-overlay', 'draw-overlay',
    'effect-confirm-overlay', 'b-card-detail', 'card-action-menu',
    'card-action-backdrop', 'longpress-action-menu', 'longpress-backdrop'
  ];
  overlayIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // body直下に動的追加されたオーバーレイを全て除去（position:fixedのもの）
  document.querySelectorAll('body > div[style*="position:fixed"], body > div[style*="position: fixed"]').forEach(el => {
    // battle-screenやscreen要素は除外
    if (el.classList.contains('screen') || el.id === 'battle-screen') return;
    if (el.parentNode) el.parentNode.removeChild(el);
  });
  // バトル画面自体を強制非表示
  const battleScreen = document.getElementById('battle-screen');
  if (battleScreen) battleScreen.classList.remove('active');
  // オンライン: Firebaseリスナー解除 + ルームデータクリア
  if (_onlineCmdListener) { _onlineCmdListener(); _onlineCmdListener = null; }
  if (_onlineMode && _onlineRoomId) {
    import('./firebase-config.js').then(({ rtdb, ref, remove }) => {
      remove(ref(rtdb, `rooms/${_onlineRoomId}`));
    }).catch(() => {});
  }
}

function battleVictory() {
  if (_onlineMode) sendCommand({ type: 'game_end', result: 'defeat' }); // 相手は敗北
  showGameEndOverlay('🎉 勝利！', 'victory', () => { cleanupBattle(); showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen'); });
}
function battleDefeat() {
  if (_onlineMode) sendCommand({ type: 'game_end', result: 'victory' }); // 相手は勝利
  showGameEndOverlay('😢 敗北...', 'defeat', () => { cleanupBattle(); showScreen(_onlineMode ? 'room-entrance-screen' : 'tutorial-screen'); });
}

// ===== ダイレクトアタック演出（セキュリティチェックと同じレイアウト） =====
function showDirectAttack(atkCard, side, callback) {
  if (_onlineMode && bs.isPlayerTurn) sendCommand({ type: 'fx_directAttack', atkName: atkCard.name, atkImg: cardImg(atkCard), side });
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:35000;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  // ラベル
  const label = document.createElement('div');
  label.style.cssText = 'font-size:clamp(1.2rem,5vw,1.8rem);font-weight:900;color:#ff0000;letter-spacing:4px;text-shadow:0 0 30px #ff0000,0 0 60px #ff0000;margin-bottom:20px;opacity:0;transition:opacity 0.3s;';
  label.innerText = 'DIRECT ATTACK!!';
  overlay.appendChild(label);

  // カード並び
  const cardRow = document.createElement('div');
  cardRow.style.cssText = 'display:flex;gap:24px;align-items:center;';
  overlay.appendChild(cardRow);

  // アタック側カード
  const atkWrap = document.createElement('div');
  atkWrap.style.cssText = 'text-align:center;opacity:0;transition:opacity 0.3s;';
  const atkImgDiv = document.createElement('div');
  atkImgDiv.style.cssText = 'width:100px;height:140px;border:3px solid #ff4444;border-radius:8px;overflow:hidden;box-shadow:0 0 20px rgba(255,68,68,0.5);';
  const atkSrc = cardImg(atkCard);
  atkImgDiv.innerHTML = atkSrc ? '<img src="'+atkSrc+'" style="width:100%;height:100%;object-fit:cover;">' : '<div style="color:#ff4444;padding:8px;">'+atkCard.name+'</div>';
  atkWrap.appendChild(atkImgDiv);
  const atkName = document.createElement('div');
  atkName.style.cssText = 'color:#fff;font-size:11px;margin-top:6px;font-weight:bold;';
  atkName.innerText = atkCard.name;
  atkWrap.appendChild(atkName);
  cardRow.appendChild(atkWrap);

  // VS
  const vs = document.createElement('div');
  vs.style.cssText = 'font-size:1.5rem;font-weight:900;color:#ff4444;text-shadow:0 0 20px #ff0000;opacity:0;transition:opacity 0.3s;';
  vs.innerText = '⚔';
  cardRow.appendChild(vs);

  // プレイヤーアイコン
  const defWrap = document.createElement('div');
  defWrap.style.cssText = 'text-align:center;opacity:0;transition:opacity 0.3s;';
  const defImgDiv = document.createElement('div');
  defImgDiv.style.cssText = 'width:100px;height:140px;border:3px solid #ffaa00;border-radius:8px;overflow:hidden;box-shadow:0 0 20px rgba(255,170,0,0.5);display:flex;align-items:center;justify-content:center;background:#111;';
  const iconSrc = side === 'player' ? playerIconUrl : playerIconUrl;
  defImgDiv.innerHTML = iconSrc ? '<img src="'+iconSrc+'" style="width:80%;height:80%;object-fit:contain;">' : '<div style="font-size:3rem;">👤</div>';
  defWrap.appendChild(defImgDiv);
  const defName = document.createElement('div');
  defName.style.cssText = 'color:#ffaa00;font-size:11px;margin-top:6px;font-weight:bold;';
  defName.innerText = side === 'player' ? '相手プレイヤー' : '自分';
  defWrap.appendChild(defName);
  cardRow.appendChild(defWrap);

  document.body.appendChild(overlay);

  // アニメーション
  setTimeout(() => { label.style.opacity='1'; }, 100);
  setTimeout(() => { atkWrap.style.opacity='1'; }, 300);
  setTimeout(() => { vs.style.opacity='1'; }, 600);
  setTimeout(() => { defWrap.style.opacity='1'; }, 900);
  let called = false;
  function finish() {
    if (called) return;
    called = true;
    if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback();
  }

  setTimeout(finish, 2500);
  overlay.addEventListener('click', finish, { once: true });
}

// ===== 勝利/敗北演出 =====
function showGameEndOverlay(text, type, callback) {
  const isVictory = type === 'victory';
  const color = isVictory ? '#00ff88' : '#ff4444';
  const bgColor = isVictory ? 'rgba(0,40,20,0.95)' : 'rgba(40,0,0,0.95)';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:'+bgColor+';z-index:50000;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;';

  // 背景エフェクト
  if (isVictory) {
    // 勝利：金色パーティクルが舞う
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      const x = Math.random() * 100, delay = Math.random() * 2, dur = 2 + Math.random() * 2;
      const size = 3 + Math.random() * 6;
      const colors = ['#ffdd00','#ffaa00','#00ff88','#fff','#00fbff'];
      const c = colors[Math.floor(Math.random()*colors.length)];
      p.style.cssText = 'position:absolute;left:'+x+'%;bottom:-10px;width:'+size+'px;height:'+size+'px;background:'+c+';border-radius:50%;box-shadow:0 0 '+size*2+'px '+c+';animation:victoryParticle '+dur+'s ease '+delay+'s infinite;';
      overlay.appendChild(p);
    }
  } else {
    // 敗北：赤い霧
    const fog = document.createElement('div');
    fog.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at center, rgba(255,0,0,0.15) 0%, transparent 70%);animation:defeatPulse 2s ease-in-out infinite;';
    overlay.appendChild(fog);
  }

  // 横ライン
  const lineTop = document.createElement('div');
  lineTop.style.cssText = 'position:absolute;top:28%;left:0;right:0;height:3px;background:linear-gradient(90deg, transparent, '+color+', transparent);transform:scaleX(0);animation:gateLineExpand 1s ease 0.3s forwards;';
  overlay.appendChild(lineTop);
  const lineBottom = document.createElement('div');
  lineBottom.style.cssText = 'position:absolute;top:72%;left:0;right:0;height:3px;background:linear-gradient(90deg, transparent, '+color+', transparent);transform:scaleX(0);animation:gateLineExpand 1s ease 0.4s forwards;';
  overlay.appendChild(lineBottom);

  // メインテキスト
  const mainText = document.createElement('div');
  mainText.style.cssText = 'position:relative;z-index:1;font-size:clamp(2.5rem,12vw,5rem);font-weight:900;color:'+color+';text-shadow:0 0 30px '+color+',0 0 60px '+color+',0 0 100px '+color+';opacity:0;animation:gateTextAppear 1.5s ease 0.5s forwards;text-align:center;';
  mainText.innerText = text;
  overlay.appendChild(mainText);

  // サブテキスト
  const subText = document.createElement('div');
  subText.style.cssText = 'position:relative;z-index:1;font-size:clamp(0.8rem,3vw,1.1rem);color:#ffffff88;margin-top:16px;opacity:0;animation:gateTextAppear 1s ease 1s forwards;';
  subText.innerText = isVictory ? 'Congratulations!' : 'Game Over';
  overlay.appendChild(subText);

  // 戻るボタン
  const btn = document.createElement('button');
  btn.style.cssText = 'position:relative;z-index:1;margin-top:30px;background:'+color+'22;color:'+color+';border:2px solid '+color+';padding:12px 32px;border-radius:10px;font-size:1rem;font-weight:bold;cursor:pointer;opacity:0;animation:gateTextAppear 1s ease 1.5s forwards;';
  btn.innerText = '戻る';
  btn.onclick = () => {
    if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
    callback();
  };
  overlay.appendChild(btn);

  document.body.appendChild(overlay);
}

// ===== カード詳細 =====
window.showBCD = function(idxOrCard, source) {
  // 対象選択中はカード詳細を開かない（選択タップと干渉するため）
  if (isTargetSelecting()) return;
  let card;
  if(typeof idxOrCard==='object') card=idxOrCard;
  else if(source==='hand') card=bs.player.hand[idxOrCard];
  else if(source==='mulliganHand') card=bs.player.hand[idxOrCard];
  else if(source==='plBattle') card=bs.player.battleArea[idxOrCard];
  else if(source==='aiBattle') card=bs.ai.battleArea[idxOrCard];
  else card=idxOrCard;
  if(!card) return;

  document.getElementById('bcd-img').src = cardImg(card);
  document.getElementById('bcd-name').innerText = card.name + ' (' + card.cardNo + ')';
  document.getElementById('bcd-stats').innerText = 'Lv.' + card.level + ' ／ DP:' + card.dp + ' ／ コスト:' + card.cost;

  const effectEl = document.getElementById('bcd-effect');
  effectEl.innerHTML = card.effect && card.effect !== 'なし'
    ? '<div style="color:var(--main-cyan); font-size:10px; margin-bottom:4px; font-weight:bold;">効果</div>' + card.effect
    : '<span style="color:#555;">効果なし</span>';

  const evoEl = document.getElementById('bcd-evo-source');
  let evoHtml = '';
  if (!card._usedEffects) card._usedEffects = [];
  const isMyCard = (source === 'plBattle');
  const isMainPhase = bs.phase === 'main';

  // カード自身の進化元効果
  if (card.evoSourceEffect && card.evoSourceEffect.trim()) {
    evoHtml += '<div style="color:#ffaa00; font-size:10px; margin-bottom:4px; font-weight:bold;">進化元効果</div>' + card.evoSourceEffect;
  }
  // スタック内の進化元効果（【メイン】があれば発動ボタン付き）
  if (card.stack && card.stack.length > 0) {
    card.stack.forEach((s, evoIdx) => {
      if (s.evoSourceEffect && s.evoSourceEffect.trim()) {
        evoHtml += '<div style="margin-top:8px; color:#ffaa00; font-size:10px; font-weight:bold;">▸ ' + s.name + '（進化元効果）</div>' + s.evoSourceEffect;
        // 【メイン】効果があれば発動ボタンを追加
        if (isMyCard && isMainPhase && s.evoSourceEffect.includes('【メイン】')) {
          const evoKey = 'evo-' + evoIdx;
          const used = card._usedEffects.includes(evoKey);
          const slotIdx = bs.player.battleArea.indexOf(card);
          if (used) {
            evoHtml += '<div style="margin-top:6px;"><button disabled style="opacity:0.3;cursor:not-allowed;background:#333;color:#aaa;border:1px solid #555;padding:6px 14px;border-radius:6px;font-size:11px;">⚡ 効果発動（使用済み）</button></div>';
          } else if (slotIdx !== -1) {
            evoHtml += '<div style="margin-top:6px;"><button onclick="activateEvoEffect(' + slotIdx + ',' + evoIdx + ')" style="background:#ffaa00;color:#000;border:none;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;">⚡ 進化元効果を発動</button></div>';
          }
        }
      }
    });
  }
  if (evoHtml) { evoEl.innerHTML = evoHtml; evoEl.style.display = 'block'; } else { evoEl.style.display = 'none'; }

  // セキュリティ効果
  let secEl = document.getElementById('bcd-security-effect');
  if (!secEl) {
    // 要素がなければ動的に作成（evoElの後に挿入）
    secEl = document.createElement('div');
    secEl.id = 'bcd-security-effect';
    secEl.style.cssText = 'font-size:11px; color:#aaa; line-height:1.7; margin-bottom:10px; text-align:left; background:#0a0a0a; padding:10px; border-radius:6px; border:1px solid #222;';
    evoEl.parentNode.insertBefore(secEl, evoEl.nextSibling);
  }
  if (card.securityEffect && card.securityEffect.trim() && card.securityEffect !== 'なし') {
    secEl.innerHTML = '<div style="color:#ff6644; font-size:10px; margin-bottom:4px; font-weight:bold;">🛡 セキュリティ効果</div>' + card.securityEffect;
    secEl.style.display = 'block';
  } else {
    secEl.style.display = 'none';
  }

  // メイン効果発動ボタン：詳細画面からは廃止（長押しメニューから発動する）
  const effectBtn = document.getElementById('bcd-effect-btn');
  if (effectBtn) {
    effectBtn.style.display = 'none';
    window._bcdEffectCard = null;
  }

  const bcd=document.getElementById('b-card-detail');
  // bodyの末尾に移動して最前面に表示（stacking context問題回避）
  document.body.appendChild(bcd);
  bcd.style.display = 'flex';
};

window.onBCDEffectActivate = function() {
  closeBCD();
  const card = window._bcdEffectCard;
  if (!card) return;
  _pendingEffectCard = card;
  _pendingEffectCallback = () => renderAll();
  document.getElementById('effect-confirm-name').innerText = card.name;
  document.getElementById('effect-confirm-text').innerText = card.effect;
  document.getElementById('effect-confirm-overlay').style.display = 'flex';
};

window.closeBCD = function() { document.getElementById('b-card-detail').style.display = 'none'; };

// 進化元効果を詳細画面から発動
window.activateEvoEffect = function(slotIdx, evoIdx) {
  closeBCD();
  const card = bs.player.battleArea[slotIdx]; if(!card) return;
  const evoCard = card.stack && card.stack[evoIdx]; if(!evoCard) return;
  if (!card._usedEffects) card._usedEffects = [];
  const evoKey = 'evo-' + evoIdx;

  _pendingEffectCard = card;
  _pendingEffectCallback = () => {
    card._usedEffects.push(evoKey);
    // 進化元効果のテキストで【メイン】トリガーを処理
    checkAndTriggerEffect(card, '【メイン】', () => renderAll(), null, true);
  };
  document.getElementById('effect-confirm-name').innerText = evoCard.name + '（進化元効果）';
  document.getElementById('effect-confirm-text').innerText = evoCard.evoSourceEffect;
  document.getElementById('effect-confirm-overlay').style.display = 'flex';
};

// トラッシュ確認
window.showTrash = function(side) {
  const trash = side==='player' ? bs.player.trash : bs.ai.trash;
  const title = side==='player' ? '自分のトラッシュ' : '相手のトラッシュ';
  const modal = document.getElementById('trash-modal');
  const titleEl = document.getElementById('trash-modal-title');
  const grid = document.getElementById('trash-modal-grid');
  if(!modal) return;
  titleEl.innerText = `🗑 ${title}（${trash.length}枚）`;
  window._trashSide = side;
  if(trash.length === 0) {
    grid.innerHTML = '<div style="color:#555; text-align:center; padding:20px;">カードがありません</div>';
  } else {
    grid.innerHTML = trash.map((c,i) => {
      const src = cardImg(c);
      return `<div id="trash-card-${i}" style="text-align:center; cursor:pointer; padding:3px; border:2px solid transparent; border-radius:6px; transition:all 0.2s;" onclick="selectTrashCard('${side}',${i})" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 4px 12px rgba(0,251,255,0.3)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
        ${src ? `<img src="${src}" style="width:100%; border-radius:4px;">` : `<div style="height:60px; background:#111; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:7px; color:#aaa;">${c.name}</div>`}
        <div style="font-size:7px; color:#888; margin-top:2px;">${c.name}</div>
      </div>`;
    }).join('');
  }
  modal.style.display = 'block';
};

window.selectTrashCard = function(side, idx) {
  // 全カードの選択枠をリセット
  const trash = side==='player' ? bs.player.trash : bs.ai.trash;
  for(let i=0;i<trash.length;i++){
    const el=document.getElementById('trash-card-'+i);
    if(el) el.style.borderColor = (i===idx) ? 'var(--main-cyan)' : 'transparent';
  }
  // 選択状態を少し見せてから詳細画面へ
  setTimeout(() => {
    const card = trash[idx];
    if(card) showBCD(card, 'trash');
  }, 200);
};

// ===== レンダリング =====
function applyBackImages() {
  const s=(id,url) => {const e=document.getElementById(id);if(e)e.src=url;};
  s('ai-deck-back',cardBackUrl); s('pl-deck-back',cardBackUrl);
  if(!bs.ai.ikusei) s('ai-tama-back',tamaBackUrl);
  if(!bs.player.ikusei) s('pl-tama-back',tamaBackUrl);
}

let _syncTimer = null;
function renderAll(force) {
  // 対象選択中は再描画を抑制（枠が消えるのを防ぐ）。forceで強制可能
  if (!force && isTargetSelecting()) return;
  renderSecurity(); renderBattleRows(); renderTamerRows(); renderIkusei(); renderHand(); updateCounts(); updateActionBtns(); updateMemGauge(); updatePhaseBadge(); applyBackImages();
  // オンライン: 自分のターン中は定期的に状態同期（デバウンス）
  if (_onlineMode && bs.isPlayerTurn) {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(sendStateSync, 500);
  }
}

function renderSecurity() {
  const backHtml=cardBackUrl?`<img src="${cardBackUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:2px;">`:'🛡';
  ['ai','pl'].forEach(side => {
    const sec=side==='ai'?bs.ai.security:bs.player.security;
    const el=document.getElementById(side+'-sec-area'), cnt=document.getElementById(side+'-sec-count');
    if(!el) return;
    if(sec.length>0) el.innerHTML=`<div style="position:relative; width:36px; height:${28+(sec.length-1)*10}px;">`+sec.map((_,i) => `<div class="sec-card ${side==='ai'?'ai-sec':'pl-sec'}" style="position:absolute; top:${i*10}px; left:0; width:36px; height:28px;">${backHtml}</div>`).join('')+'</div>';
    else el.innerHTML='<div class="sec-card empty">0</div>';
    if(cnt) cnt.innerText=sec.length;
    // セキュリティバフ表示（そのsideのオーナーのバフのみ）
    const buffOwner = side === 'pl' ? 'player' : 'ai';
    const buffs = bs._securityBuffs;
    if (buffs && buffs.length > 0 && sec.length > 0) {
      let totalPlus = 0;
      buffs.forEach(b => { if (b.type === 'dp_plus' && b.owner === buffOwner) totalPlus += (parseInt(b.value) || 0); });
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

function renderBattleRows() {
  ['ai','pl'].forEach(side => {
    const isPlayer=side==='pl';
    const area=isPlayer?bs.player.battleArea:bs.ai.battleArea;
    const row=document.getElementById(side+'-battle-row'); if(!row) return;
    row.innerHTML='';

    // 既存カード分 + 空きスロット1つ（登場用）をレンダリング
    const slotCount = Math.max(area.length, 1);
    const renderCount = isPlayer ? slotCount + 1 : slotCount; // プレイヤー側は空きスロット1つ追加

    for(let i=0;i<renderCount;i++){
      const card=area[i];
      const sl=document.createElement('div');
      sl.className='b-slot'+(card?(isPlayer?' pl-card':' ai-card'):'');
      if(card&&card.suspended) sl.classList.add('suspended');
      if(isPlayer&&bs.selSlot===i&&card) sl.classList.add('selected-slot');
      if(card){
        const src=cardImg(card);
        let stackInfo='';
        if(isPlayer&&card.stack&&card.stack.length>0) stackInfo=`<div style="position:absolute; top:1px; right:2px; background:rgba(0,0,0,0.8); color:#ffaa00; font-size:6px; padding:1px 2px; border-radius:2px;">${card.stack.length}枚</div>`;
        // Sアタック+表示
        const saCount = getSecurityAttackCount(card);
        const saInfo = saCount > 1 ? `<div style="position:absolute; top:1px; left:2px; background:rgba(255,0,0,0.8); color:#fff; font-size:6px; padding:1px 3px; border-radius:2px;">チェック+${saCount-1}</div>` : '';
        sl.innerHTML=(src?`<img src="${src}">`:`<div style="font-size:8px;color:${isPlayer?'#00fbff':'#ff00fb'};padding:3px;">${card.name}</div>`)
          +`<div class="s-name">${card.name}</div>`
          +`<div class="s-dp">${card.baseDp||card.dp}${card.dpModifier>0?`<span style="color:#00ff88;font-size:6px;"> +${card.dpModifier}</span>`:card.dpModifier<0?`<span style="color:#ff4444;font-size:6px;"> ${card.dpModifier}</span>`:''}</div>`
          +stackInfo+saInfo;

        if(isPlayer) {
          sl.onclick=((idx) => e => {
            e.stopPropagation();
            bs.selSlot=(bs.selSlot===idx)?null:idx; renderAll();
            showBCD(idx, 'plBattle');
          })(i);
          setupLongpressGesture(sl, i);
        } else {
          sl.onclick=((idx) => () => { showBCD(idx,'aiBattle'); })(i);
        }
      } else {
        sl.innerHTML='<span style="font-size:14px;color:#1a1a1a;">＋</span>';
        if(isPlayer) sl.onclick=(idx => () => { if(bs.phase==='main'&&bs.selHand!==null){ const c=bs.player.hand[bs.selHand]; if(c&&c.level!=='2') doPlay(c,bs.selHand,idx); } })(i);
      }
      row.appendChild(sl);
    }
  });
}

function renderTamerRows() {
  ['ai','pl'].forEach(side => {
    const isPlayer = side==='pl';
    const tamerArea = isPlayer ? bs.player.tamerArea : bs.ai.tamerArea;
    const row = document.getElementById(side+'-tamer-row'); if(!row) return;
    row.innerHTML='';
    tamerArea.forEach((card, i) => {
      if(!card) return;
      const sl = document.createElement('div');
      sl.className = 'tamer-slot';
      if(card.suspended) sl.style.transform='rotate(90deg)';
      const src = cardImg(card);
      sl.innerHTML = (src ? `<img src="${src}">` : `<div style="font-size:7px;color:#ffaa00;padding:2px;">${card.name}</div>`)
        + `<div class="s-name">${card.name}</div>`;
      // タップ→詳細
      sl.onclick = () => showBCD(card, isPlayer ? 'plTamer' : 'aiTamer');
      // プレイヤーのテイマー：長押しでレスト→効果メニュー
      if(isPlayer && bs.phase==='main') {
        let lpt=null;
        sl.addEventListener('touchstart', () => { lpt=setTimeout(() => showTamerMenu(card,i,sl),400); }, {passive:true});
        sl.addEventListener('touchend', () => clearTimeout(lpt));
        sl.addEventListener('touchmove', () => clearTimeout(lpt));
        sl.addEventListener('mousedown', e => { if(e.button!==0) return; lpt=setTimeout(() => showTamerMenu(card,i,sl),400);
          const up=() => { clearTimeout(lpt); document.removeEventListener('mouseup',up); };
          document.addEventListener('mouseup',up);
        });
      }
      row.appendChild(sl);
    });
  });
}

function renderIkusei() {
  ['pl','ai'].forEach(side => {
    const isPlayer=side==='pl';
    const iku=document.getElementById(side+'-iku-slot'), info=document.getElementById(side+'-iku-info');
    if(!iku) return;
    const c=isPlayer?bs.player.ikusei:bs.ai.ikusei;
    if(c){
      const src=cardImg(c);
      iku.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`:`<div style="font-size:8px;color:${isPlayer?'#00ff88':'#ff00fb'};padding:2px;">${c.name}</div>`;
      iku.classList.add('occupied');
      if(info) info.innerText=c.name;
      // 育成フェーズ中＋プレイヤー＋Lv3以上 → ドラッグで移動イベントを設定
      if(isPlayer && bs.phase==='breed' && c.level!=='2') {
        attachIkuDrag(iku);
      }
    } else {
      const hasTamaDeck = isPlayer ? (bs.player.tamaDeck && bs.player.tamaDeck.length > 0) : (bs.ai.tamaDeck && bs.ai.tamaDeck.length > 0);
      // デジタマデッキがあれば裏面表示、なければ空表示
      if (hasTamaDeck) {
        iku.innerHTML=tamaBackUrl?`<img src="${tamaBackUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`:'';
      } else {
        iku.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#333;">空</div>';
      }
      iku.classList.remove('occupied');
      if(info) info.innerText='';
      // 育成フェーズ中＋プレイヤー＋孵化可能 → タップイベント
      if(isPlayer && bs.phase==='breed' && bs.player.tamaDeck && bs.player.tamaDeck.length>0) {
        iku.onclick = () => {
          const nc=bs.player.tamaDeck.splice(0,1)[0];
          bs.player.ikusei=nc;
          addLog('🥚 「'+nc.name+'」を孵化！');
          if (_onlineMode) { sendCommand({ type: 'hatch', cardName: nc.name, cardImg: nc.imgSrc||'' }); }
          renderAll();
          showHatchEffect(nc, () => breedActionDone());
        };
      }
    }
  });
}

// 育成エリアドラッグ移動（renderIkuseiから呼ばれる）— ゴースト＋ドロップ方式
function attachIkuDrag(iku) {
  iku.style.border='2px solid #00ff88'; iku.style.boxShadow='0 0 15px rgba(0,255,136,0.4)';
  iku.style.cursor='grab';

  function doIkuMove() {
    if(!bs.player.ikusei) return;
    let slot=bs.player.battleArea.findIndex(s=>s===null);
    if(slot===-1) { slot=bs.player.battleArea.length; bs.player.battleArea.push(null); }
    bs.player.battleArea[slot]=bs.player.ikusei; bs.player.ikusei=null;
    addLog('🐾 「'+bs.player.battleArea[slot].name+'」をバトルエリアへ移動！');
    if (_onlineMode) { sendCommand({ type: 'breed_move', cardName: bs.player.battleArea[slot]?.name||'', cardImg: bs.player.battleArea[slot]?.imgSrc||'' }); }
    applyPermanentEffects(bs, 'player', makeEffectContext(null, 'player'));
    breedActionDone();
  }

  let ghostEl=null, dragging=false;

  function startIkuDrag(cx, cy) {
    dragging=true;
    const card=bs.player.ikusei; if(!card) return;
    // ゴースト要素
    ghostEl=document.createElement('div');
    ghostEl.style.cssText='position:fixed;width:48px;height:66px;border-radius:5px;overflow:hidden;z-index:99999;pointer-events:none;opacity:0.85;border:2px solid #00ff88;box-shadow:0 0 15px rgba(0,255,136,0.5);';
    const src=cardImg(card);
    if(src) ghostEl.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`;
    else ghostEl.innerHTML=`<div style="color:#00ff88;font-size:7px;padding:4px;">${card.name}</div>`;
    document.body.appendChild(ghostEl);
    ghostEl.style.left=(cx-24)+'px'; ghostEl.style.top=(cy-33)+'px';
    // バトルエリアスロットをハイライト
    highlightDropZones(true);
  }

  function moveIkuDrag(cx, cy) {
    if(!ghostEl) return;
    ghostEl.style.left=(cx-24)+'px'; ghostEl.style.top=(cy-33)+'px';
  }

  function endIkuDrag(cx, cy) {
    if(!dragging) return;
    dragging=false;
    if(ghostEl&&ghostEl.parentNode) document.body.removeChild(ghostEl);
    ghostEl=null;
    highlightDropZones(false);
    // バトルエリアにドロップ判定
    const plRow=document.getElementById('pl-battle-row');
    if(plRow) {
      let dropped=false;
      plRow.querySelectorAll('.b-slot').forEach((slot,i) => {
        if(dropped) return;
        if(bs.player.battleArea[i]) return; // 埋まっているスロットはスキップ
        const r=slot.getBoundingClientRect();
        if(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom) { dropped=true; doIkuMove(); }
      });
      // どのスロットにも入らなくてもドラッグ距離があれば移動（空きスロット自動選択）
      if(!dropped) {
        const startRect=iku.getBoundingClientRect();
        const dist=Math.sqrt(Math.pow(cx-startRect.left-startRect.width/2,2)+Math.pow(cy-startRect.top-startRect.height/2,2));
        if(dist>50) doIkuMove();
      }
    }
  }

  // タッチ
  iku.addEventListener('touchstart', e => { startIkuDrag(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
  iku.addEventListener('touchmove', e => { if(dragging){moveIkuDrag(e.touches[0].clientX,e.touches[0].clientY);e.preventDefault();} }, {passive:false});
  iku.addEventListener('touchend', e => { if(dragging) endIkuDrag(e.changedTouches[0].clientX,e.changedTouches[0].clientY); });

  // マウス
  iku.addEventListener('mousedown', e => {
    if(e.button!==0) return;
    startIkuDrag(e.clientX, e.clientY);
    const onMove=e2=>moveIkuDrag(e2.clientX,e2.clientY);
    const onUp=e2=>{ endIkuDrag(e2.clientX,e2.clientY); document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); };
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}

function renderHand() {
  const hw=document.getElementById('hand-wrap'); if(!hw) return;
  hw.innerHTML='';
  const handCount = bs.player.hand.length;
  const containerWidth = hw.offsetWidth - 16; // padding分引く
  const cardWidth = 52;
  // 重なり計算: カードが多いほど重なる（最小マージン: -30px）
  let marginLeft = 4; // 通常のgap
  if (handCount > 0) {
    const totalNeeded = handCount * cardWidth + (handCount - 1) * 4;
    if (totalNeeded > containerWidth && handCount > 1) {
      marginLeft = Math.max(-30, (containerWidth - cardWidth) / (handCount - 1) - cardWidth);
    }
  }

  bs.player.hand.forEach((c,i) => {
    const el=document.createElement('div');
    el.className='h-card'+(bs.selHand===i?' h-selected':'');
    el.style.zIndex = i; // 後ろのカードが上に重なる
    if (i > 0) el.style.marginLeft = marginLeft + 'px';
    let costLabel='';
    if(c.playCost!==null&&c.evolveCost!==null) costLabel=`<span style="color:#ffaa00;">${c.playCost}</span><span style="color:#555;font-size:6px;">/</span><span style="color:#00ff88;font-size:7px;">進${c.evolveCost}</span>`;
    else if(c.playCost!==null) costLabel=`<span style="color:#ffaa00;">${c.playCost}</span>`;
    else costLabel=`<span style="color:#00ff88;">進${c.evolveCost||'?'}</span>`;
    const src=cardImg(c);
    el.innerHTML=(src?`<img src="${src}">`:`<div style="font-size:8px;color:#aaa;padding:4px;height:100%;display:flex;align-items:center;justify-content:center;">${c.name}</div>`)
      +`<div class="h-cost">${costLabel}</div>`;

    // タップ→選択＋詳細画面（ドラッグ直後はスキップ）
    el.onclick=((card, idx) => e => {
      if(_dragDone) return;
      e.stopPropagation();
      bs.selHand=(bs.selHand===idx)?null:idx;
      renderHand(); updateActionBtns();
      showBCD(idx, 'hand');
    })(c,i);

    el.draggable=false;
    // 画像のデフォルトドラッグ防止
    el.addEventListener('dragstart', e => e.preventDefault());

    el.onmousedown=((card,idx,cardEl) => e => {
      if(bs.phase!=='main') return;
      e.preventDefault();
      onHandDragStart(e,idx,card,cardEl);
      const moveH = e2 => onHandDragMove(e2);
      const upH = e2 => { onHandDragEnd(e2); document.removeEventListener('mousemove',moveH); document.removeEventListener('mouseup',upH); };
      document.addEventListener('mousemove',moveH);
      document.addEventListener('mouseup',upH);
    })(c,i,el);
    el.ontouchstart=((card,idx,cardEl) => e => {
      if(bs.phase!=='main') return;
      onHandDragStart(e,idx,card,cardEl);
      const moveH = e2 => onHandDragMove(e2);
      const upH = e2 => { onHandDragEnd(e2); document.removeEventListener('touchmove',moveH); document.removeEventListener('touchend',upH); };
      document.addEventListener('touchmove',moveH,{passive:false});
      document.addEventListener('touchend',upH);
    })(c,i,el);

    hw.appendChild(el);
  });
}

function updateCounts() {
  const s=(id,v) => {const e=document.getElementById(id);if(e)e.innerText=v;};
  s('pl-deck-count',bs.player.deck.length); s('pl-trash-count',bs.player.trash.length);
  s('pl-trash-count2',bs.player.trash.length); s('ai-deck-count',bs.ai.deck.length);
  s('ai-trash-count',bs.ai.trash.length);
  s('pl-hand-count',bs.player.hand.length); s('pl-tama-count',bs.player.tamaDeck?bs.player.tamaDeck.length:0);
}

function updatePhaseBadge() {
  const names={unsuspend:'🔄 アクティブ',draw:'🃏 ドロー',breed:'🥚 育成',main:'⚡ メイン'};
  const el=document.getElementById('phase-badge'); if(el) el.innerText=names[bs.phase]||bs.phase;
}

function updateActionBtns() {
  // アクションバーは「ターン終了」のみ。他の操作はカード直接操作で行う
}

function addLog(msg) {
  const el=document.getElementById('battle-log'); if(!el) return;
  el.style.display='block'; el.innerText=msg;
  clearTimeout(window._blogTimer);
  window._blogTimer=setTimeout(() => {if(el)el.style.display='none';},3000);
}
