// ===================================================================
// チュートリアルシナリオ管理画面ロジック
// admin.html から派生した管理機能。シナリオCRUD + 編集フォーム。
// ===================================================================
import { gasGet, gasPost } from './firebase-config.js';
import { loadCardAndKeywordData, getCardImageUrl } from './cards.js';

// 進行条件・クリア条件の種別定義（プルダウン用）
// ここに追加/削除すれば管理画面のプルダウンに自動反映される
// 新しい条件タイプを追加するときは tutorial-runner.js の CONDITION_EVALUATORS にも追加すること
// clearable: false → クリア条件のプルダウンには出さない（次に進む条件のみ）
// params: [{key, label, type, min, max, default, suffix}] → 選択時にラベル横に入力欄
const CONDITION_TYPES = [
  // フェイズ関連
  { value: 'breed_end',          label: '育成フェイズ終了（孵化/移動/何もしない）', needsCardNo: false, group: '🥚 フェイズ', clearable: false },
  { value: 'turn_start',         label: 'ターン開始した',                              needsCardNo: false, group: '🥚 フェイズ',
    params: [{ key: 'turn', label: '何ターン目', type: 'number', min: 1, max: 99, default: 1, suffix: 'ターン目' }] },
  { value: 'turn_end',           label: 'ターン終了した',                              needsCardNo: false, group: '🥚 フェイズ',
    params: [{ key: 'turn', label: '何ターン目', type: 'number', min: 1, max: 99, default: 1, suffix: 'ターン目' }] },
  // 進化
  { value: 'evolve_any',         label: 'デジモンを進化させた',                       needsCardNo: false, group: '⬆ 進化' },
  { value: 'evolve_lv',          label: 'レベルNに進化させた',                         needsCardNo: false, group: '⬆ 進化',
    params: [{ key: 'level', label: 'レベル', type: 'number', min: 2, max: 7, default: 3, suffix: '' }] },
  // 登場・カード使用
  { value: 'play_digimon',       label: 'デジモンを登場させた',                       needsCardNo: false, group: '📥 登場・カード使用' },
  { value: 'play_option',        label: 'オプションカードを使った',                   needsCardNo: false, group: '📥 登場・カード使用' },
  { value: 'play_tamer',         label: 'テイマーカードを使った',                     needsCardNo: false, group: '📥 登場・カード使用' },
  { value: 'play_lv',            label: 'レベルNを登場させた',                         needsCardNo: false, group: '📥 登場・カード使用',
    params: [{ key: 'level', label: 'レベル', type: 'number', min: 2, max: 7, default: 3, suffix: '' }] },
  // アタック
  { value: 'attack_declared',         label: 'アタック宣言した（アタックボタン押下）',     needsCardNo: false, group: '⚔ アタック' },
  { value: 'attack_target_selected', label: '対象選択した（セキュリティ/デジモン）',     needsCardNo: false, group: '⚔ アタック' },
  { value: 'attack_resolved',        label: 'バトルを解決した（デジモン/セキュリティ）', needsCardNo: false, group: '⚔ アタック' },
  { value: 'direct_attack',      label: 'ダイレクトアタックした',                     needsCardNo: false, group: '⚔ アタック' },
  { value: 'block',              label: 'ブロックした',                                needsCardNo: false, group: '⚔ アタック' },
  // セキュリティ
  { value: 'security_check_n',   label: '相手セキュリティをN枚チェックした',           needsCardNo: false, group: '🛡 セキュリティ',
    params: [{ key: 'count', label: '枚数', type: 'number', min: 1, max: 5, default: 1, suffix: '枚' }] },
  // 効果
  { value: 'effect_target_selected', label: '対象選択後（確認画面表示前）',           needsCardNo: false, group: '✨ 効果' },
  { value: 'use_effect',         label: '効果を使った（対象確認「はい」押下後）',     needsCardNo: false, group: '✨ 効果' },
  { value: 'effect_triggered',   label: '効果を誘発させた',                           needsCardNo: false, group: '✨ 効果' },
  { value: 'security_effect',    label: 'セキュリティ効果を発動させた',               needsCardNo: false, group: '✨ 効果' },
  // UI操作（クリア条件には出さない）
  { value: 'card_detail_opened', label: 'カード詳細を見た（開いた）',                 needsCardNo: false, group: '🖱 UI操作', clearable: false },
  { value: 'card_detail_closed', label: 'カード詳細を閉じた',                         needsCardNo: false, group: '🖱 UI操作', clearable: false },
  { value: 'modal_closed',       label: '閉じるボタンを押した（全モーダル共通）',     needsCardNo: false, group: '🖱 UI操作', clearable: false },
  { value: 'action_cancelled',  label: 'キャンセルした（アタック/効果いいえ 共通）', needsCardNo: false, group: '🖱 UI操作', clearable: false },
  { value: 'mulligan_accepted',  label: 'ゲーム開始ボタンを押した（マリガン）',       needsCardNo: false, group: '🖱 UI操作', clearable: false },
  // 達成系
  { value: 'security_zero',      label: '相手セキュリティを0枚にした',                needsCardNo: false, group: '🏆 達成' },
];

// CONDITION_TYPES からアコーディオン式のピッカー HTML を組み立てる
function _renderConditionPicker(slotKey, timing, sIdx, currentValue, occ) {
  const uid = `cp_cond_${slotKey}_${timing}_${sIdx}_${occ || 1}`;
  const cur = CONDITION_TYPES.find(t => t.value === (currentValue || '')) || { label: '（未設定）' };
  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;

  const groups = {};
  const order = [];
  CONDITION_TYPES.forEach(t => {
    const g = t.group || '🔧 その他';
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(t);
  });

  const item = (t) => {
    const v = `'${t.value}'`;
    const sel = t.value === (currentValue || '') ? ' selected' : '';
    return `<div class="ap-item${sel}" onclick="conditionPickerSelect('${uid}',${sk},${tg},${sIdx},${v},${occ || 1})">${_escHtml(t.label)}</div>`;
  };

  let panel = '';
  order.forEach(g => {
    const gid = `${uid}_g_${order.indexOf(g)}`;
    const opened = groups[g].some(t => t.value === (currentValue || ''));
    panel += `<div class="ap-group">
      <div class="ap-group-header${opened ? ' open' : ''}" onclick="areaPickerToggleGroup('${gid}', this)">
        <span class="ap-arrow">▶</span>${_escHtml(g)}
      </div>
      <div class="ap-group-body" id="${gid}_body" style="display:${opened ? 'block' : 'none'};">
        ${groups[g].map(item).join('')}
      </div>
    </div>`;
  });

  return `<div class="area-picker" id="${uid}" onclick="event.stopPropagation()">
    <button type="button" class="ap-button" onclick="areaPickerToggle('${uid}')">
      <span>${_escHtml(cur.label)}</span>
      <span class="ap-caret">▼</span>
    </button>
    <div class="ap-panel" id="${uid}_panel" style="display:none;">${panel}</div>
  </div>`;
}

window.conditionPickerSelect = function(uid, slotKey, timing, sIdx, value, occ) {
  flowUpdateStep(slotKey, timing, sIdx, 'conditionType', value, occ);
  // _renderFlowEditor が呼ばれて全体再描画されるので、ボタン更新は不要
};

// フロー編集: 進行条件のパラメータ値を更新
window.flowUpdateStepParam = function(slotKey, timing, sIdx, key, value, occ) {
  const ref = _getStepByTiming(slotKey, timing, sIdx, occ);
  if (!ref) return;
  const step = ref.step;
  if (!step.advanceCondition) return;
  if (!step.advanceCondition.params) step.advanceCondition.params = {};
  // 数値はNumber化
  const def = CONDITION_TYPES.find(t => t.value === step.advanceCondition.type);
  const pdef = def && def.params && def.params.find(p => p.key === key);
  step.advanceCondition.params[key] = (pdef && pdef.type === 'number') ? Number(value) : value;
};

// クリア条件のパラメータ保持用 (key→value)
let _clearConditionParams = {};

// 条件のパラメータ入力欄 HTML を生成（共通）
//   condValue: 選択中の条件タイプ
//   currentParams: 現在保存されているパラメータ {key: value}
//   onChangeAttr: input の onchange 属性文字列（__KEY__ がパラメータキーに置換される）
function _renderConditionParams(condValue, currentParams, onChangeAttr) {
  const def = CONDITION_TYPES.find(t => t.value === condValue);
  if (!def || !Array.isArray(def.params) || def.params.length === 0) return '';
  const cur = currentParams || {};
  return def.params.map(p => {
    const val = (cur[p.key] != null) ? cur[p.key] : (p.default != null ? p.default : '');
    const minAttr = (p.min != null) ? `min="${p.min}"` : '';
    const maxAttr = (p.max != null) ? `max="${p.max}"` : '';
    return `<span style="display:inline-flex; align-items:center; gap:4px; margin-left:6px; font-size:11px; color:#aaa;">
      <span>${_escHtml(p.label || p.key)}:</span>
      <input type="${p.type || 'number'}" value="${_escHtml(String(val))}" ${minAttr} ${maxAttr} data-pkey="${p.key}"
        onchange="${onChangeAttr.replace(/__KEY__/g, p.key)}"
        style="width:60px; padding:3px 6px; background:#111; border:1px solid var(--border-col); color:#fff; border-radius:3px; font-size:11px;">
      ${p.suffix ? `<span>${_escHtml(p.suffix)}</span>` : ''}
    </span>`;
  }).join('');
}

// クリア条件用のアコーディオン式ピッカー
// (CONDITION_TYPES のうち clearable !== false のものだけ表示)
function _renderClearConditionPicker(currentValue) {
  const uid = 'cp_clear';
  const list = CONDITION_TYPES.filter(t => t.clearable !== false);
  const cur = list.find(t => t.value === (currentValue || '')) || { label: '（条件を選択）' };

  const groups = {};
  const order = [];
  list.forEach(t => {
    const g = t.group || '🔧 その他';
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(t);
  });

  const item = (t) => {
    const v = `'${t.value}'`;
    const sel = t.value === (currentValue || '') ? ' selected' : '';
    return `<div class="ap-item${sel}" onclick="clearConditionPickerSelect(${v})">${_escHtml(t.label)}</div>`;
  };

  let panel = '';
  order.forEach(g => {
    const gid = `${uid}_g_${order.indexOf(g)}`;
    const opened = groups[g].some(t => t.value === (currentValue || ''));
    panel += `<div class="ap-group">
      <div class="ap-group-header${opened ? ' open' : ''}" onclick="areaPickerToggleGroup('${gid}', this)">
        <span class="ap-arrow">▶</span>${_escHtml(g)}
      </div>
      <div class="ap-group-body" id="${gid}_body" style="display:${opened ? 'block' : 'none'};">
        ${groups[g].map(item).join('')}
      </div>
    </div>`;
  });

  return `<div class="area-picker" id="${uid}" onclick="event.stopPropagation()">
    <button type="button" class="ap-button" onclick="areaPickerToggle('${uid}')">
      <span id="cp_clear_label">${_escHtml(cur.label)}</span>
      <span class="ap-caret">▼</span>
    </button>
    <div class="ap-panel" id="${uid}_panel" style="display:none;">${panel}</div>
  </div>`;
}

// クリア条件選択時の処理
window.clearConditionPickerSelect = function(value) {
  const hiddenInput = document.getElementById('ts-clear-type');
  if (hiddenInput) hiddenInput.value = value;
  const def = CONDITION_TYPES.find(t => t.value === value);
  const labelEl = document.getElementById('cp_clear_label');
  if (labelEl) labelEl.innerText = def ? def.label : value;
  const panel = document.getElementById('cp_clear_panel');
  if (panel) panel.style.display = 'none';
  const picker = document.getElementById('cp_clear');
  if (picker) {
    picker.querySelectorAll('.ap-item').forEach(it => it.classList.remove('selected'));
    picker.querySelectorAll('.ap-item').forEach(it => {
      if (it.getAttribute('onclick') && it.getAttribute('onclick').includes(`'${value}'`)) {
        it.classList.add('selected');
      }
    });
  }
  // パラメータ入力欄を更新（条件種類が変わったらデフォルト値で初期化）
  _clearConditionParams = {};
  if (def && Array.isArray(def.params)) {
    def.params.forEach(p => { _clearConditionParams[p.key] = p.default != null ? p.default : ''; });
  }
  _refreshClearConditionParamUI(value);
  if (typeof updateClearConditionUI === 'function') updateClearConditionUI();
};

// クリア条件のパラメータ入力欄を再描画
function _refreshClearConditionParamUI(condValue) {
  const wrap = document.getElementById('ts-clear-params');
  if (!wrap) return;
  wrap.innerHTML = _renderConditionParams(condValue, _clearConditionParams, "clearConditionParamChange(this,'__KEY__')");
}

// パラメータ入力変更時
window.clearConditionParamChange = function(input, key) {
  const v = input.type === 'number' ? Number(input.value) : input.value;
  _clearConditionParams[key] = v;
};

// 指差しマーカーの対象エリア定義（全シナリオ共通で使用）
// group: optgroup ラベル（未指定なら先頭にそのまま並ぶ）
const TARGET_AREAS = [
  { value: '', label: 'なし（指差しなし）' },
  // --- 自分エリア ---
  { value: 'raising',      label: '育成エリア',                          group: '🟢 自分のエリア' },
  { value: 'hand',         label: '手札（マリガン時は最初の5枚）',     group: '🟢 自分のエリア' },
  { value: 'drawn_card',   label: 'ドローしたカード（演出中の中央カード）', group: '🟢 自分のエリア' },
  { value: 'hand_last',    label: '手札の最後尾のカード',                 group: '🟢 自分のエリア' },
  { value: 'battle',       label: 'バトルエリア',                        group: '🟢 自分のエリア' },
  { value: 'own_security', label: 'セキュリティ',                        group: '🟢 自分のエリア' },
  { value: 'own_trash',    label: 'トラッシュ',                          group: '🟢 自分のエリア' },
  { value: 'own_deck',     label: 'デッキ',                              group: '🟢 自分のエリア' },
  // --- 相手エリア ---
  { value: 'opp_battle',   label: 'バトルエリア',                        group: '🔴 相手のエリア' },
  { value: 'opp_security', label: 'セキュリティ',                        group: '🔴 相手のエリア' },
  { value: 'opp_trash',    label: 'トラッシュ',                          group: '🔴 相手のエリア' },
  { value: 'opp_deck',     label: 'デッキ',                              group: '🔴 相手のエリア' },
  // --- ボタン ---
  { value: 'mulligan_btn_start', label: 'ゲーム開始ボタン（マリガン）', group: '🔘 ボタン' },
  { value: 'mulligan_btn_redo',  label: '引き直しボタン（マリガン）',   group: '🔘 ボタン' },
  { value: 'end_turn_btn',       label: 'ターン終了ボタン',               group: '🔘 ボタン' },
  // --- メモリーゲージ ---
  { value: 'memory_gauge',        label: '全体',                          group: '⚙ メモリーゲージ' },
  { value: 'memory_gauge_player', label: '自分側',                        group: '⚙ メモリーゲージ' },
  { value: 'memory_gauge_opp',    label: '相手側',                        group: '⚙ メモリーゲージ' },
  { value: 'memory_gauge_current',label: '現在のメモリー（点灯セル）',    group: '⚙ メモリーゲージ' },
  // --- カード詳細モーダル ---
  { value: 'card_detail',            label: 'モーダル全体',               group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_name',       label: 'カード名',                    group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_stats',      label: 'Lv/DP/登場コスト',            group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_cost',   label: '進化コスト',                  group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_effect',     label: '効果欄',                      group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source', label: '進化元効果（上カード＋スタック全体）', group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source_stack',   label: '進化元カードの進化元効果（全体）', group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source_stack_0', label: '└ 1枚目（一番下）',          group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source_stack_1', label: '└ 2枚目',                    group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source_stack_2', label: '└ 3枚目',                    group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source_stack_3', label: '└ 4枚目',                    group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_evo_source_stack_4', label: '└ 5枚目',                    group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_sec_effect', label: 'セキュリティ効果',            group: '🔍 カード詳細モーダル' },
  { value: 'card_detail_close',      label: '閉じるボタン',                group: '🔍 カード詳細モーダル' },
  // --- 効果確認ダイアログ ---
  { value: 'effect_confirm',         label: 'ダイアログパネル',         group: '⚡ 効果確認ダイアログ' },
  { value: 'effect_confirm_yes',     label: '「はい」ボタン',           group: '⚡ 効果確認ダイアログ' },
  { value: 'effect_confirm_no',      label: '「いいえ」ボタン',         group: '⚡ 効果確認ダイアログ' },
  // --- トラッシュモーダル ---
  { value: 'trash_modal',          label: 'トラッシュ画面全体',           group: '🗑 トラッシュ' },
  { value: 'trash_close_btn',      label: '閉じるボタン',                group: '🗑 トラッシュ' },
  // --- VS画面（セキュリティチェック/バトル演出） ---
  { value: 'vs_screen',    label: '画面全体',                            group: '⚔ VS画面' },
  { value: 'vs_cards',     label: 'カード2枚（左右まとめて）',          group: '⚔ VS画面' },
  { value: 'vs_atk_area',  label: '左: 自分のカード（全体）',           group: '⚔ VS画面' },
  { value: 'vs_atk_card',  label: '左: 自分のカード画像',               group: '⚔ VS画面' },
  { value: 'vs_atk_name',  label: '左: 自分のカード名',                 group: '⚔ VS画面' },
  { value: 'vs_atk_dp',    label: '左: 自分のDP',                       group: '⚔ VS画面' },
  { value: 'vs_def_area',  label: '右: 相手のカード（全体）',           group: '⚔ VS画面' },
  { value: 'vs_def_card',  label: '右: 相手のカード画像',               group: '⚔ VS画面' },
  { value: 'vs_def_name',  label: '右: 相手のカード名',                 group: '⚔ VS画面' },
  { value: 'vs_def_dp',    label: '右: 相手のDP',                       group: '⚔ VS画面' },
  { value: 'vs_label',     label: '「VS」テキスト',                     group: '⚔ VS画面' },
  { value: 'vs_title',     label: 'タイトル（SECURITY CHECK!等）',      group: '⚔ VS画面' },
  { value: 'vs_result',    label: '結果テキスト（Win/Lost等）',         group: '⚔ VS画面' },
];

// アコーディオン型エリアピッカー
//   uid : DOM一意ID
//   slotKey/timing/sIdx/field : flowUpdateStep に渡す引数
//   currentValue : 現在選択中の value
function _renderAreaPicker(slotKey, timing, sIdx, field, currentValue, occ) {
  const uid = `ap_${slotKey}_${timing}_${sIdx}_${field}_${occ || 1}`;
  const cur = TARGET_AREAS.find(a => a.value === (currentValue || '')) || TARGET_AREAS[0];
  // HTML属性内の onclick で渡すため、シングルクォートでラップした文字列を組む
  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;
  const fd = `'${field}'`;

  // グルーピング
  const groups = {};
  const order = [];
  const noGroup = [];
  TARGET_AREAS.forEach(a => {
    if (!a.group) { noGroup.push(a); return; }
    if (!groups[a.group]) { groups[a.group] = []; order.push(a.group); }
    groups[a.group].push(a);
  });

  const item = (a) => {
    const v = `'${a.value}'`;
    const sel = a.value === (currentValue || '') ? ' selected' : '';
    return `<div class="ap-item${sel}" onclick="areaPickerSelect('${uid}',${sk},${tg},${sIdx},${fd},${v},${occ || 1})">${_escHtml(a.label)}</div>`;
  };

  let panel = '';
  noGroup.forEach(a => { panel += item(a); });
  order.forEach(g => {
    const gid = `${uid}_g_${order.indexOf(g)}`;
    // 現在選択中の value がこのグループに含まれていたら開いた状態にする
    const opened = groups[g].some(a => a.value === (currentValue || ''));
    panel += `<div class="ap-group">
      <div class="ap-group-header${opened ? ' open' : ''}" onclick="areaPickerToggleGroup('${gid}', this)">
        <span class="ap-arrow">▶</span>${_escHtml(g)}
      </div>
      <div class="ap-group-body" id="${gid}_body" style="display:${opened ? 'block' : 'none'};">
        ${groups[g].map(item).join('')}
      </div>
    </div>`;
  });

  return `<div class="area-picker" id="${uid}" onclick="event.stopPropagation()">
    <button type="button" class="ap-button" onclick="areaPickerToggle('${uid}')">
      <span>${_escHtml(cur.label)}</span>
      <span class="ap-caret">▼</span>
    </button>
    <div class="ap-panel" id="${uid}_panel" style="display:none;">${panel}</div>
  </div>`;
}

// パネル開閉
window.areaPickerToggle = function(uid) {
  // 他のピッカーは閉じる
  document.querySelectorAll('.ap-panel').forEach(p => {
    if (p.id !== uid + '_panel') p.style.display = 'none';
  });
  const panel = document.getElementById(uid + '_panel');
  if (!panel) return;
  panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
};

// グループ開閉
window.areaPickerToggleGroup = function(gid, el) {
  const body = document.getElementById(gid + '_body');
  if (!body) return;
  const open = body.style.display === 'none' || !body.style.display;
  body.style.display = open ? 'block' : 'none';
  if (el) el.classList.toggle('open', open);
};

// 項目選択
window.areaPickerSelect = function(uid, slotKey, timing, sIdx, field, value, occ) {
  flowUpdateStep(slotKey, timing, sIdx, field, value, occ);
  // ボタンラベルを更新
  const picker = document.getElementById(uid);
  if (picker) {
    const def = TARGET_AREAS.find(a => a.value === value) || TARGET_AREAS[0];
    const label = picker.querySelector('.ap-button > span:first-child');
    if (label) label.innerText = def.label;
    // 選択中アイテムのハイライト更新
    picker.querySelectorAll('.ap-item').forEach(it => it.classList.remove('selected'));
    // クリックされた要素を選択状態に
    const items = picker.querySelectorAll('.ap-item');
    items.forEach(it => {
      if (it.getAttribute('onclick') && it.getAttribute('onclick').includes(`'${value}')`)) {
        it.classList.add('selected');
      }
    });
  }
  const panel = document.getElementById(uid + '_panel');
  if (panel) panel.style.display = 'none';
};

// 外側クリックでパネル閉じる
if (typeof document !== 'undefined' && !window._areaPickerOutsideHandler) {
  window._areaPickerOutsideHandler = true;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.area-picker')) {
      document.querySelectorAll('.ap-panel').forEach(p => p.style.display = 'none');
    }
  });
}

// ステップタイプ定義
const STEP_TYPES = [
  { value: 'action',    label: '操作誘導（ユーザーが操作→次へ）' },
  { value: 'message',   label: '説明ポップアップ（「次へ」ボタンで進行）' },
  { value: 'spotlight', label: 'スポットライト説明（焦点+暗転+「次へ」ボタン）' },
];

// 操作タイプ定義（ステップごとに選択可能）
const OPERATION_TYPES = [
  { value: '',             label: 'なし（指差しのみ）' },
  { value: 'tap',          label: 'タップ 👆' },
  { value: 'drag',         label: 'ドラッグ ➡️' },
  { value: 'long_press',   label: '長押し ✋' },
  { value: 'swipe_left',   label: '左スワイプ ⬅️' },
  { value: 'rest_action',  label: 'レスト操作（PC:長押し / SP:左スワイプ 自動判定）' },
];

// 成功演出（次に進む条件達成時に表示）プリセット
const SUCCESS_POPUP_PRESETS = [
  { value: 'auto',        label: '自動（OK→GREAT→NICE→PERFECTの順）' },
  { value: 'none',        label: '表示しない' },
  { value: 'OK!',         label: '👍 OK!' },
  { value: 'GREAT!',      label: '✨ GREAT!' },
  { value: 'NICE!',       label: '💫 NICE!' },
  { value: 'PERFECT!',    label: '🌟 PERFECT!' },
  { value: 'GOOD JOB!',   label: '🎉 GOOD JOB!' },
  { value: 'AMAZING!',    label: '🔥 AMAZING!' },
  { value: 'やったね！',  label: '💪 やったね！' },
  { value: 'ばっちり！',  label: '🙌 ばっちり！' },
];

// ボタン制御対象の定義
const BUTTON_TARGETS = [
  { value: 'mulligan_redo',    label: '引き直しボタン' },
  { value: 'game_start',       label: 'ゲーム開始ボタン' },
  { value: 'end_turn',         label: 'ターン終了ボタン' },
  { value: 'breed_skip',       label: '何もしないボタン（育成）' },
  { value: 'exit_gate',        label: 'ゲートを出るボタン' },
  { value: 'confirm_yes',      label: '「はい」ボタン（効果確認/ブロック）' },
  { value: 'confirm_no',       label: '「いいえ」ボタン（効果確認/ブロック）' },
];

// 割り込みトリガー定義（詳細プレビュー/サマリー用、ALL_FLOW_SLOTSからラベル引き）
const TRIGGER_TYPES = [
  // ターン境界
  { value: 'turn_start_self',       label: '自分のターン開始' },
  { value: 'before_end_turn',      label: '自分のターン終了直前' },
  { value: 'memory_crossed',       label: 'メモリー相手側到達時' },
  { value: 'before_opponent_turn', label: '相手ターン開始前' },
  { value: 'turn_end_opp',         label: '相手ターン終了後' },
  // アクション中間点（コスト支払い後、効果発動前）
  { value: 'after_play_cost',      label: '登場コスト支払い後（効果前）' },
  { value: 'after_evolve_cost',    label: '進化コスト支払い+ドロー後（効果前）' },
  // アクション完了後（効果処理完了後）
  { value: 'after_hatch',          label: '孵化完了後' },
  { value: 'after_play',           label: '登場時効果完了後' },
  { value: 'after_evolve',         label: '進化時効果完了後' },
  { value: 'after_attack',         label: 'アタック解決後（自分のアタック）' },
  { value: 'after_use_effect',     label: '効果使用完了後' },
  // バトル演出（自分のターン）
  { value: 'battle_vs',            label: 'VS画面表示中（自分のアタック）' },
  // バトル演出（相手のターン）
  { value: 'opp_battle_vs',        label: 'VS画面表示中（相手のアタック）' },
  { value: 'opp_after_attack',     label: 'アタック解決後（相手のアタック）' },
  { value: 'block_confirm',        label: 'ブロック確認画面' },
  // 共通（どちらのターンでも発生）
  { value: 'effect_confirm',       label: '効果確認ダイアログ' },
  { value: 'target_selection',     label: '対象選択画面の前' },
  // UI系
  { value: 'on_card_detail_open',  label: 'カード詳細表示中' },
];

// フェーズ定義（表示用）
const PHASE_DEFS = [
  { value: 'mulligan',  label: '🎴 マリガン',         color: '#ff88ff' },
  { value: 'unsuspend', label: '🔄 アクティブフェーズ', color: '#88ccff' },
  { value: 'draw',      label: '🃏 ドローフェーズ',     color: '#88ffcc' },
  { value: 'breed',     label: '🥚 育成フェーズ',       color: '#ffcc44' },
  { value: 'main',      label: '⚔️ メインフェーズ',     color: '#ff6666' },
];

// モジュール状態
let _scenarioEditData = null; // 編集中のシナリオ (null = 新規)
let _scenarioFlow = [];       // 編集中フロー配列 [{phase, turn, trigger?, steps:[]}]
let _tutorialDecksCache = [];
let _scenariosCache = [];     // 前提シナリオプルダウン用
let _initialBoardState = null; // 初期盤面の編集中状態
let _opponentScript = [];      // 相手AIスクリプトの編集中状態

// 相手AIアクション種別定義（新しいアクションを追加したい場合はここに1行）
// fields: 入力欄として表示するフィールド名
// fieldDefs: アクションごとに [{ key, label, type, options? }] で個別ラベル/型を定義
const OPPONENT_ACTION_TYPES = [
  { value: 'hatch',          label: '孵化',                                          fieldDefs: [] },
  { value: 'play_card',      label: 'デジモン/オプション/テイマーを登場',           fieldDefs: [
    { key: 'cardNo', label: '登場させるカード (No or 名前)' }
  ] },
  { value: 'evolve_battle',  label: 'バトルエリアで進化',                            fieldDefs: [
    { key: 'sourceCardNo', label: '進化元 (バトルエリア)' },
    { key: 'targetCardNo', label: '進化先 (手札)' }
  ] },
  { value: 'evolve_breed',   label: '育成エリアで進化',                              fieldDefs: [
    { key: 'targetCardNo', label: '進化先 (手札)' }
  ] },
  { value: 'move_to_battle', label: '育成エリア→バトルエリアへ移動',                fieldDefs: [] },
  { value: 'attack',         label: '相手にアタック',                                fieldDefs: [
    { key: 'cardNo',       label: 'どのデジモンでアタック (バトルエリア)' },
    { key: 'targetMode',   label: 'アタック対象', type: 'select', options: [
      { value: 'security', label: 'セキュリティを攻撃' },
      { value: 'digimon',  label: '相手デジモンを攻撃' }
    ] },
    { key: 'targetCardNo', label: '攻撃する相手デジモン (digimon選択時のみ)' }
  ] },
  { value: 'block',          label: 'ブロックする (プレイヤーの次の攻撃)',           fieldDefs: [
    { key: 'cardNo', label: 'ブロッカー (バトルエリア)' }
  ] },
  { value: 'select_target',  label: '対象選択 (AIの効果対象に選ぶカード)',           fieldDefs: [
    { key: 'cardNo', label: '対象として選ぶカード (No or 名前)' }
  ] },
  { value: 'pass',           label: '何もしない',                                    fieldDefs: [] },
  { value: 'end_turn',       label: 'ターン終了',                                    fieldDefs: [] },
];
// 旧 fields キーとの互換 (詳細プレビュー等で参照されているため)
OPPONENT_ACTION_TYPES.forEach(t => { t.fields = (t.fieldDefs || []).map(f => f.key); });

// 初期盤面の空状態を作成
function _emptyBoardState() {
  return {
    playerHand: [],        // [{cardNo}, ...]
    playerBattleArea: [],  // [{cardNo}, ...]
    playerRaisingArea: null,  // {cardNo} or null
    playerSecurity: [],    // [{cardNo}, ...] 上から順 (先頭=最初にチェックされる)
    playerDeckTop: [],     // [{cardNo}, ...] デッキ上から順 (先頭=次に引く)
    playerTrash: [],       // [{cardNo}, ...]
    opponentHand: [],
    opponentBattleArea: [],
    opponentRaisingArea: null,
    opponentSecurity: [],
    opponentDeckTop: [],
    opponentTrash: [],
  };
}

// ===================================================================
// シナリオ一覧
// ===================================================================
window.loadTutorialScenarioList = async function() {
  const area = document.getElementById('tutorial-scenario-list');
  if (!area) return;
  area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">読み込み中...</p>';

  try {
    const scenarios = await gasGet('getTutorialScenarios');
    if (scenarios && scenarios.error) {
      area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${scenarios.error}</p>`;
      return;
    }
    if (!scenarios || !scenarios.length) {
      area.innerHTML = '<p style="color:#555; text-align:center; padding:40px;">チュートリアルシナリオが登録されていません</p>';
      return;
    }

    // 詳細表示用にシナリオをキャッシュ
    _scenariosCache = scenarios;
    // デッキ名解決用にデッキキャッシュも用意（未取得なら取得）
    if (!_tutorialDecksCache.length) {
      try {
        const decks = await gasGet('getTutorialDecks');
        if (Array.isArray(decks)) _tutorialDecksCache = decks;
      } catch (e) {}
    }

    area.innerHTML = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
      <th style="width:40px;">順</th>
      <th>チュートリアル名</th>
      <th style="width:90px;">難易度</th>
      <th style="width:90px;">モード</th>
      <th style="width:150px;">クリア条件</th>
      <th style="width:170px;">操作</th>
    </tr></thead><tbody>${scenarios.map(s => {
      const condLabel = _conditionLabel(s.clearCondition);
      const esc = JSON.stringify(s).replace(/'/g, "\\'");
      return `<tr>
        <td style="color:#888; text-align:center;">${s.order || ''}</td>
        <td style="color:#fff; font-weight:bold;">${_escHtml(s.tutorialName || '')}</td>
        <td>${s.difficulty || '---'}</td>
        <td style="font-size:11px;">${_modeLabel(s.mode)}</td>
        <td style="font-size:11px; color:#aaa;">${_escHtml(condLabel)}</td>
        <td>
          <button class="admin-btn-sm" style="padding:4px 8px; font-size:10px;" onclick="showTutorialScenarioDetail('${s.id}')">詳細</button>
          <button class="admin-btn-sm" style="padding:4px 8px; font-size:10px;" onclick='editTutorialScenario(${esc})'>編集</button>
          <button class="admin-btn-danger" style="padding:4px 8px; font-size:10px;" onclick="deleteTutorialScenarioConfirm('${s.id}', '${_escJs(s.tutorialName || '')}')">削除</button>
        </td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  } catch (e) {
    area.innerHTML = `<p style="color:#ff4444; text-align:center;">エラー: ${e.message}</p>`;
  }
};

function _conditionLabel(cond) {
  if (!cond || !cond.type) return '---';
  const found = CONDITION_TYPES.find(t => t.value === cond.type);
  let label = found ? found.label : cond.type;
  if (cond.params && cond.params.cardNo) {
    const name = _findCardName(cond.params.cardNo);
    label += ' (' + name + '/' + cond.params.cardNo + ')';
  }
  return label;
}

function _modeLabel(mode) {
  if (mode === 'strict') return '強制操作';
  if (mode === 'free') return '自由操作';
  return mode || '---';
}

function _deckNameById(deckId) {
  if (!deckId) return '未指定';
  const d = _tutorialDecksCache.find(x => (x.deckId || x.tutorialName) === deckId);
  if (!d) return deckId;
  return (d.tutorialName || '') + ' / ' + (d.deckName || '');
}

function _scenarioNameById(scenarioId) {
  if (!scenarioId) return '';
  const s = _scenariosCache.find(x => x.id === scenarioId);
  return s ? s.tutorialName : scenarioId;
}

// ===================================================================
// シナリオ詳細プレビューモーダル
// ===================================================================
window.showTutorialScenarioDetail = async function(scenarioId) {
  const scenario = _scenariosCache.find(s => s.id === scenarioId);
  if (!scenario) { alert('シナリオが見つかりません'); return; }

  // カードデータがあると配置表示が名前付きになる
  try {
    if (!window.allCards || !window.allCards.length) {
      await loadCardAndKeywordData();
    }
  } catch (e) {}

  document.getElementById('ts-detail-title').innerText = scenario.tutorialName || 'シナリオ詳細';
  document.getElementById('ts-detail-body').innerHTML = _renderScenarioDetail(scenario);
  document.getElementById('ts-detail-modal').style.display = 'block';
};

window.closeTutorialScenarioDetail = function() {
  document.getElementById('ts-detail-modal').style.display = 'none';
};

function _renderScenarioDetail(s) {
  const ib = s.initialBoard || {};
  const section = (title, body) =>
    `<div style="margin-bottom:14px;">
      <div style="color:var(--main-cyan); font-size:11px; font-weight:bold; margin-bottom:4px; border-bottom:1px solid #1a3030; padding-bottom:3px;">${title}</div>
      <div style="padding-left:8px;">${body}</div>
    </div>`;

  const kv = (label, value) =>
    `<div><span style="color:#888;">${label}:</span> <span style="color:#fff;">${value || '---'}</span></div>`;

  // 基本情報
  const basic =
    kv('難易度', _escHtml(s.difficulty || '')) +
    kv('モード', _modeLabel(s.mode)) +
    kv('表示順', s.order || '---') +
    kv('使用デッキ', _escHtml(_deckNameById(s.deckId))) +
    kv('前提シナリオ', _escHtml(_scenarioNameById(s.prerequisiteId)) || '（なし・最初から解放）') +
    kv('説明', _escHtml(s.description || ''));

  // クリア条件
  const clear = `<span style="color:#00ff88;">${_escHtml(_conditionLabel(s.clearCondition))}</span>`;

  // 初期盤面
  const boardItems = [];
  boardItems.push(`<div>先攻: ${ib.playerFirst === false ? '相手' : 'プレイヤー'}</div>`);
  boardItems.push(`<div>開始メモリー: ${ib.playerMemory ?? 0}</div>`);
  boardItems.push(`<div>セキュリティ: 自分 ${ib.playerSecurityCount ?? 5} / 相手 ${ib.opponentSecurityCount ?? 5}</div>`);
  if (ib.skipMulligan) boardItems.push(`<div>マリガン: スキップ</div>`);
  if (ib.initialPhase) {
    const phaseLabel = { unsuspend:'アクティブ', draw:'ドロー', breed:'育成', main:'メイン' }[ib.initialPhase] || ib.initialPhase;
    boardItems.push(`<div>開始フェーズ: ${phaseLabel}フェイズから</div>`);
  }
  const areaLine = (label, arr) => {
    if (!Array.isArray(arr) || !arr.length) return '';
    const names = arr.map(c => {
      const no = typeof c === 'string' ? c : (c && c.cardNo);
      return no ? _findCardName(no) + '(' + no + ')' : '';
    }).filter(Boolean).join(', ');
    return `<div>${label}: <span style="color:#fff;">${_escHtml(names)}</span></div>`;
  };
  const oneLine = (label, one) => {
    if (!one) return '';
    const no = typeof one === 'string' ? one : one.cardNo;
    if (!no) return '';
    return `<div>${label}: <span style="color:#fff;">${_escHtml(_findCardName(no) + '(' + no + ')')}</span></div>`;
  };
  boardItems.push(areaLine('自分 手札', ib.playerHand));
  boardItems.push(areaLine('自分 バトルエリア', ib.playerBattleArea));
  boardItems.push(oneLine('自分 育成エリア', ib.playerRaisingArea));
  boardItems.push(areaLine('自分 セキュリティ', ib.playerSecurity));
  boardItems.push(areaLine('自分 デッキ上', ib.playerDeckTop));
  boardItems.push(areaLine('自分 トラッシュ', ib.playerTrash));
  boardItems.push(areaLine('相手 手札', ib.opponentHand));
  boardItems.push(areaLine('相手 バトルエリア', ib.opponentBattleArea));
  boardItems.push(oneLine('相手 育成エリア', ib.opponentRaisingArea));
  boardItems.push(areaLine('相手 セキュリティ', ib.opponentSecurity));
  boardItems.push(areaLine('相手 デッキ上', ib.opponentDeckTop));
  boardItems.push(areaLine('相手 トラッシュ', ib.opponentTrash));
  const board = boardItems.filter(Boolean).join('');

  // フロー
  const flowBlocks = Array.isArray(s.flow) && s.flow.length
    ? s.flow.map(block => {
        const isTrigger = block.phase === '_trigger';
        const pDef = PHASE_DEFS.find(p => p.value === block.phase);
        const tDef = TRIGGER_TYPES.find(t => t.value === block.trigger);
        const bLabel = isTrigger
          ? `⚡ ${tDef ? tDef.label : block.trigger}`
          : (pDef ? pDef.label : block.phase);
        const color = isTrigger ? '#ffaa00' : (pDef ? pDef.color : '#888');
        const stepsHtml = (block.steps || []).map((step, i) => {
          const condText = _conditionLabel(step.advanceCondition);
          const typeLabel = step.stepType === 'spotlight' ? '🔦' : step.stepType === 'message' ? '💬' : '👆';
          return `<div style="margin-bottom:4px; padding-left:16px;">
            <span style="color:#aaa;">${typeLabel} STEP ${i + 1}:</span>
            「${_escHtml(step.instructionText || '')}」
            ${step.stepType === 'action' ? `<div style="color:#888; font-size:10px; padding-left:16px;">→ 進行条件: ${_escHtml(condText)}</div>` : ''}
          </div>`;
        }).join('');
        return `<div style="margin-bottom:8px;">
          <span style="color:${color}; font-weight:bold;">${bLabel}</span>
          <span style="color:#666; font-size:10px;"> (T${block.turn || 1})</span>
          ${stepsHtml || '<div style="padding-left:16px; color:#666;">ステップなし</div>'}
        </div>`;
      }).join('')
    : '<span style="color:#666;">フロー未設定</span>';

  // クリア後メッセージ
  const clearMsg = s.clearMessage
    ? `<div style="color:#00ff88;">${_escHtml(s.clearMessage)}</div>`
    : '<span style="color:#666;">なし</span>';

  // 相手AIスクリプト
  const oppScript = Array.isArray(s.opponentScript) && s.opponentScript.length
    ? s.opponentScript.map(t => {
        const acts = (t.actions || []).map((a, i) => {
          const def = OPPONENT_ACTION_TYPES.find(x => x.value === a.type);
          let line = (def ? def.label : a.type);
          const extras = [];
          if (a.cardNo) extras.push(_findCardName(a.cardNo));
          if (a.sourceCardNo) extras.push('元:' + _findCardName(a.sourceCardNo));
          if (a.targetCardNo) extras.push('先:' + _findCardName(a.targetCardNo));
          if (extras.length) line += ' (' + extras.join(', ') + ')';
          return `<div style="padding-left:16px; color:#ccc;">${i + 1}. ${_escHtml(line)}</div>`;
        }).join('');
        return `<div style="margin-bottom:8px;">
          <span style="color:#ff00fb; font-weight:bold;">ターン ${t.turn}</span>
          ${acts || '<div style="padding-left:16px; color:#666;">（アクションなし）</div>'}
        </div>`;
      }).join('')
    : '<span style="color:#666;">スクリプトなし</span>';

  return (
    section('📌 基本情報', basic) +
    section('🎯 クリア条件', clear) +
    section('📝 クリア後メッセージ', clearMsg) +
    section('🎲 初期盤面', board) +
    section('🎬 フロー', flowBlocks) +
    section('🤖 相手AIスクリプト', oppScript)
  );
}

function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escJs(s) {
  return String(s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ===================================================================
// シナリオ削除
// ===================================================================
window.deleteTutorialScenarioConfirm = async function(scenarioId, name) {
  if (!confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)) return;
  try {
    const result = await gasPost('deleteTutorialScenario', { scenarioId });
    if (result.status === 'SUCCESS') {
      alert('削除しました');
      loadTutorialScenarioList();
    } else {
      alert('エラー: ' + (result.message || result.status));
    }
  } catch (e) {
    alert('通信エラー: ' + e.message);
  }
};

// ===================================================================
// 新規作成・編集開始
// ===================================================================
window.initTutorialScenarioBuilder = async function() {
  _scenarioEditData = null;
  _scenarioFlow = [];
  await _prepareEditForm();
  document.getElementById('ts-edit-title').innerText = 'チュートリアルシナリオ登録';
  showScreen('tutorial-scenario-edit-screen');
};

window.editTutorialScenario = async function(scenario) {
  _scenarioEditData = scenario;
  // フロー復元（ディープコピー + マルチステップブロックを1ステップ単位に分割）
  // 編集UIでは「ステップ = 1ブロック」の扱いにすることで、↑↓で任意位置に並び替え可能に
  const cloneStep = (s) => Object.assign({}, s, {
    advanceCondition: s.advanceCondition ? Object.assign({}, s.advanceCondition, {
      params: s.advanceCondition.params ? Object.assign({}, s.advanceCondition.params) : undefined,
    }) : { type: 'hatch' },
  });
  // 古いデータのマイグレーション:
  //  - parentSlot 未設定のトリガーブロックを availableIn 先頭スロットに割り当て
  //  - 旧トリガー名 (effect_confirm / target_confirm) → 統一した confirm_dialog
  const _migrateTrigger = (trigger) => {
    if (trigger === 'effect_confirm' || trigger === 'target_confirm') return 'confirm_dialog';
    return trigger;
  };
  const _inferParentSlot = (block) => {
    if (block.parentSlot) return block.parentSlot;
    if (block.phase !== '_trigger' || !block.trigger) return undefined;
    const trig = _migrateTrigger(block.trigger);
    const timingDef = STEP_TIMINGS.find(t => t.trigger === trig);
    if (!timingDef || !Array.isArray(timingDef.availableIn) || timingDef.availableIn.length === 0) return undefined;
    return timingDef.availableIn[0];
  };
  _scenarioFlow = [];
  (Array.isArray(scenario.flow) ? scenario.flow : []).forEach(block => {
    const inferredParentSlot = _inferParentSlot(block);
    const steps = Array.isArray(block.steps) ? block.steps : [];
    if (steps.length === 0) {
      _scenarioFlow.push({
        phase: block.phase,
        turn: block.turn || 1,
        trigger: _migrateTrigger(block.trigger) || undefined,
        occurrence: block.occurrence || undefined,
        parentSlot: inferredParentSlot,
        steps: [],
      });
      return;
    }
    steps.forEach(s => {
      _scenarioFlow.push({
        phase: block.phase,
        turn: block.turn || 1,
        trigger: _migrateTrigger(block.trigger) || undefined,
        occurrence: block.occurrence || undefined,
        parentSlot: inferredParentSlot,
        steps: [cloneStep(s)],
      });
    });
  });
  await _prepareEditForm();

  // 値を入れる
  document.getElementById('ts-tutorial-name').value = scenario.tutorialName || '';
  document.getElementById('ts-description').value = scenario.description || '';
  document.getElementById('ts-difficulty').value = scenario.difficulty || '⭐';
  document.getElementById('ts-order').value = scenario.order || 1;
  document.getElementById('ts-prerequisite').value = scenario.prerequisiteId || '';
  document.getElementById('ts-mode').value = scenario.mode || 'strict';
  document.getElementById('ts-deck-id').value = scenario.deckId || '';
  // クリア後メッセージ復元
  document.getElementById('ts-clear-message').value = scenario.clearMessage || '';

  // クリア条件 (アコーディオンピッカーを再マウントして現在値を反映)
  const cc = scenario.clearCondition || null;
  const ccType = cc ? (cc.type || '') : '';
  const clearMount = document.getElementById('ts-clear-picker-mount');
  if (clearMount) clearMount.innerHTML = _renderClearConditionPicker(ccType);
  document.getElementById('ts-clear-type').value = ccType;
  if (cc && cc.params && cc.params.cardNo) document.getElementById('ts-clear-param').value = cc.params.cardNo;
  // 数値パラメータを復元
  _clearConditionParams = {};
  const ccDef = CONDITION_TYPES.find(t => t.value === ccType);
  if (ccDef && Array.isArray(ccDef.params)) {
    ccDef.params.forEach(p => {
      const v = (cc && cc.params && cc.params[p.key] != null) ? cc.params[p.key] : (p.default != null ? p.default : '');
      _clearConditionParams[p.key] = v;
    });
  }
  _refreshClearConditionParamUI(ccType);
  if (typeof updateClearConditionUI === 'function') updateClearConditionUI();

  // 初期盤面
  const ib = scenario.initialBoard || {};
  document.getElementById('ts-player-first').value = ib.playerFirst === false ? 'false' : 'true';
  document.getElementById('ts-player-memory').value = ib.playerMemory ?? 0;
  document.getElementById('ts-player-sec').value = ib.playerSecurityCount ?? 5;
  document.getElementById('ts-opponent-sec').value = ib.opponentSecurityCount ?? 5;
  document.getElementById('ts-skip-mulligan').value = ib.skipMulligan ? 'true' : 'false';
  document.getElementById('ts-initial-phase').value = ib.initialPhase || '';

  // 配置済みカードを復元（CardRef配列を {cardNo} 形式に統一）
  const normArr = (arr) => (Array.isArray(arr) ? arr : []).map(c => {
    if (typeof c === 'string') return { cardNo: c };
    return Object.assign({}, c);
  });
  const normOne = (c) => {
    if (!c) return null;
    if (typeof c === 'string') return { cardNo: c };
    return Object.assign({}, c);
  };
  _initialBoardState = {
    playerHand: normArr(ib.playerHand),
    playerBattleArea: normArr(ib.playerBattleArea),
    playerRaisingArea: normOne(ib.playerRaisingArea),
    playerSecurity: normArr(ib.playerSecurity),
    playerDeckTop: normArr(ib.playerDeckTop),
    playerTrash: normArr(ib.playerTrash),
    opponentHand: normArr(ib.opponentHand),
    opponentBattleArea: normArr(ib.opponentBattleArea),
    opponentRaisingArea: normOne(ib.opponentRaisingArea),
    opponentSecurity: normArr(ib.opponentSecurity),
    opponentDeckTop: normArr(ib.opponentDeckTop),
    opponentTrash: normArr(ib.opponentTrash),
  };
  _renderPlacedCards();

  // 相手AIスクリプト復元（ディープコピー）
  _opponentScript = Array.isArray(scenario.opponentScript)
    ? scenario.opponentScript.map(t => ({
        turn: Number(t.turn || 0),
        actions: Array.isArray(t.actions) ? t.actions.map(a => Object.assign({}, a)) : [],
      }))
    : [];
  _renderOpponentScript();

  _renderFlowSummary();
  document.getElementById('ts-edit-title').innerText = 'チュートリアルシナリオ編集';
  showScreen('tutorial-scenario-edit-screen');
};

async function _prepareEditForm() {
  // クリア条件アコーディオンピッカーをマウント（初期値空）
  const clearMount = document.getElementById('ts-clear-picker-mount');
  if (clearMount) clearMount.innerHTML = _renderClearConditionPicker('');
  const clearHidden = document.getElementById('ts-clear-type');
  if (clearHidden) clearHidden.value = '';
  document.getElementById('ts-clear-param').value = '';
  _clearConditionParams = {};
  _refreshClearConditionParamUI('');

  // フォームリセット
  document.getElementById('ts-tutorial-name').value = '';
  document.getElementById('ts-description').value = '';
  document.getElementById('ts-difficulty').value = '⭐';
  document.getElementById('ts-order').value = 1;
  document.getElementById('ts-mode').value = 'strict';
  document.getElementById('ts-player-first').value = 'true';
  document.getElementById('ts-player-memory').value = 0;
  document.getElementById('ts-player-sec').value = 5;
  document.getElementById('ts-opponent-sec').value = 5;
  document.getElementById('ts-skip-mulligan').value = 'false';
  document.getElementById('ts-initial-phase').value = '';

  // 相手AIスクリプトリセット
  _opponentScript = [];

  // 初期盤面リセット + 検索欄クリア
  _initialBoardState = _emptyBoardState();
  const searchInput = document.getElementById('ts-card-search');
  if (searchInput) searchInput.value = '';
  const searchResults = document.getElementById('ts-card-search-results');
  if (searchResults) searchResults.innerHTML = '';

  // カードデータをロード（管理画面では初回読み込みが必要）
  try {
    if (!window.allCards || window.allCards.length === 0) {
      await loadCardAndKeywordData();
    }
  } catch (e) { console.error('[admin-scenario] card load failed:', e); }

  // デッキプルダウン + 前提シナリオプルダウン
  await Promise.all([_loadDeckOptions(), _loadPrerequisiteOptions()]);

  // 前提シナリオ初期値リセット
  const preSel = document.getElementById('ts-prerequisite');
  if (preSel) preSel.value = '';

  // クリア後メッセージリセット
  const clearMsgEl = document.getElementById('ts-clear-message');
  if (clearMsgEl) clearMsgEl.value = '';

  // フロー + 配置済みカード + 相手AIスクリプト表示初期化
  _renderFlowSummary();
  _renderPlacedCards();
  _renderOpponentScript();
  updateClearConditionUI();
}

async function _loadPrerequisiteOptions() {
  const sel = document.getElementById('ts-prerequisite');
  if (!sel) return;
  try {
    const list = await gasGet('getTutorialScenarios');
    _scenariosCache = Array.isArray(list) ? list : [];
    // 編集中シナリオ自身は除外
    const currentId = _scenarioEditData ? _scenarioEditData.id : null;
    const opts = ['<option value="">（なし・最初から解放）</option>'];
    _scenariosCache.forEach(s => {
      if (currentId && s.id === currentId) return;
      const label = (s.tutorialName || '(無題)');
      opts.push(`<option value="${_escHtml(s.id)}">${_escHtml(label)}</option>`);
    });
    sel.innerHTML = opts.join('');
  } catch (e) {
    sel.innerHTML = '<option value="">（読込失敗）</option>';
  }
}

async function _loadDeckOptions() {
  const sel = document.getElementById('ts-deck-id');
  if (!sel) return;
  try {
    const decks = await gasGet('getTutorialDecks');
    _tutorialDecksCache = Array.isArray(decks) ? decks : [];
    const opts = ['<option value="">（デッキを選択）</option>'];
    _tutorialDecksCache.forEach(d => {
      const id = d.deckId || d.tutorialName || '';
      const label = (d.tutorialName || '(無題)') + ' / ' + (d.deckName || '');
      opts.push(`<option value="${_escHtml(id)}">${_escHtml(label)}</option>`);
    });
    sel.innerHTML = opts.join('');
  } catch (e) {
    sel.innerHTML = '<option value="">読込失敗</option>';
  }
}

// ===================================================================
// クリア条件のUI切替（パラメータ欄の表示制御）
// ===================================================================
window.updateClearConditionUI = function() {
  const hidden = document.getElementById('ts-clear-type');
  const type = hidden ? hidden.value : '';
  const def = CONDITION_TYPES.find(t => t.value === type);
  const wrap = document.getElementById('ts-clear-param-wrap');
  if (!wrap) return;
  if (def && def.needsCardNo) wrap.style.display = '';
  else wrap.style.display = 'none';
};

// ===================================================================
// フロー編集（トグル式フェーズ一覧）
// ===================================================================

// 全フェーズ＋割り込みの定義（表示順）
// 9大項目（フラット）
const ALL_FLOW_SLOTS = [
  { key: 'mulligan',  phase: 'mulligan',  label: '🎴 マリガン画面',        color: '#ff88ff',
    hint: '手札の引き直し画面。引き直しボタンやゲーム開始ボタンの制御を設定。' },
  { key: 'trg_turn_start_self', phase: '_trigger', trigger: 'turn_start_self',
    label: '▶ 自分のターン開始',  color: '#ffbb44',
    hint: 'ターン開始アニメーションの直後、アクティブフェイズ進入前。' },
  { key: 'unsuspend', phase: 'unsuspend', label: '🔄 アクティブフェイズ',  color: '#88ccff',
    hint: 'レスト状態のカードを縦に戻す自動フェイズ。' },
  { key: 'draw',      phase: 'draw',      label: '🃏 ドローフェイズ',      color: '#88ffcc',
    hint: 'デッキから1枚ドローする自動フェイズ。' },
  { key: 'breed',     phase: 'breed',     label: '🥚 育成フェイズ',        color: '#ffcc44',
    hint: '孵化・育成エリアからの移動など。' },
  { key: 'main',      phase: 'main',      label: '⚔️ メインフェイズ',      color: '#ff6666',
    hint: 'プレイ・進化・アタック・効果など、各アクション中の説明も設定可能。' },
  { key: 'trg_before_end_turn', phase: '_trigger', trigger: 'before_end_turn',
    label: '🏁 自分のターン終了', color: '#ffaa00',
    hint: 'ターン終了アニメーションの前。手動終了/メモリー相手側での自動終了どちらでも発火。' },
  { key: 'trg_before_opponent_turn', phase: '_trigger', trigger: 'before_opponent_turn',
    label: '⏸ 相手ターン開始', color: '#aa88ff',
    hint: '相手ターン開始アニメーションの前。' },
  { key: 'opp_breed', phase: 'opp_breed', label: '🥚 相手の育成フェイズ', color: '#cc88ff',
    hint: '相手の育成フェイズ中（移動/孵化の前）。育成の説明を入れるのに最適。' },
  { key: 'opp_main',  phase: 'opp_main',  label: '⚔️ 相手のメインフェイズ', color: '#ff44aa',
    hint: '相手のメインフェイズ中（アタック/登場の前）。アタックやブロックの説明に最適。' },
  { key: 'trg_turn_end_opp', phase: '_trigger', trigger: 'turn_end_opp',
    label: '⏭ 相手ターン終了', color: '#8899ff',
    hint: '相手ターン終了後、自分のターン開始前。' },
];

// ステップ表示タイミング定義
// 各タイミング → 内部のトリガーブロックキー（または親フェーズそのまま）
// availableIn: このタイミングを表示できる大項目キー（複数）
const STEP_TIMINGS = [
  // バトルフィールド画面（通常時、何の効果も発動していない状態）
  { value: 'phase_start',       label: '🎴 バトルフィールド画面（通常時）', trigger: null,
    availableIn: ['mulligan','trg_turn_start_self','unsuspend','draw','breed','main','trg_before_end_turn','trg_before_opponent_turn','opp_breed','opp_main','trg_turn_end_opp'] },
  // 育成
  { value: 'after_hatch',       label: '🥚 孵化完了直後',                 trigger: 'after_hatch',
    availableIn: ['breed'] },
  // メインフェーズ内のアクション
  { value: 'after_play_cost',   label: '📥 登場コスト支払い直後（効果前）', trigger: 'after_play_cost',
    availableIn: ['main'] },
  { value: 'after_play',        label: '📥 登場時効果完了後',              trigger: 'after_play',
    availableIn: ['main'] },
  { value: 'after_evolve_cost', label: '⬆ 進化コスト+ドロー直後（効果前）', trigger: 'after_evolve_cost',
    availableIn: ['main','breed'] },
  { value: 'after_evolve',      label: '⬆ 進化時効果完了後',               trigger: 'after_evolve',
    availableIn: ['main','breed'] },
  { value: 'battle_vs',          label: '⚔ VS画面表示中（自分のアタック）', trigger: 'battle_vs',
    availableIn: ['main'] },
  { value: 'opp_battle_vs',     label: '⚔ VS画面表示中（相手のアタック）', trigger: 'opp_battle_vs',
    availableIn: ['opp_main'] },
  { value: 'opp_after_attack',  label: '⚔ アタック解決後（相手のアタック）', trigger: 'opp_after_attack',
    availableIn: ['opp_main'] },
  { value: 'block_confirm',     label: '🛡 ブロック確認画面',              trigger: 'block_confirm',
    availableIn: ['opp_main'] },
  { value: 'confirm_dialog',    label: '⚡ 確認ダイアログ（はい/いいえ）', trigger: 'confirm_dialog',
    availableIn: ['main','opp_main'] },
  { value: 'target_selection',  label: '🎯 対象選択画面の前',              trigger: 'target_selection',
    availableIn: ['main','opp_main'] },
  { value: 'after_attack',      label: '⚔ アタック解決後',                trigger: 'after_attack',
    availableIn: ['main'] },
  { value: 'after_use_effect',  label: '✨ 効果使用完了後',                 trigger: 'after_use_effect',
    availableIn: ['main'] },
  { value: 'on_card_detail_open', label: '🔍 カード詳細表示中',            trigger: 'on_card_detail_open',
    availableIn: ['main','opp_main'] },
  { value: 'on_draw',             label: '🃏 ドロー演出中',                  trigger: 'on_draw',
    availableIn: ['draw'] },
  // 自分のターン終了配下
  { value: 'memory_crossed',    label: '💾 メモリー相手側到達時',           trigger: 'memory_crossed',
    availableIn: ['trg_before_end_turn'] },
];

// カード詳細ハイライト箇所（card_detail_closed 条件のサブ設定）
const CARD_DETAIL_AREAS = [
  { value: 'whole',      label: 'モーダル全体',        area: 'card_detail' },
  { value: 'name',       label: 'カード名',            area: 'card_detail_name' },
  { value: 'stats',      label: 'Lv/DP/登場コスト',    area: 'card_detail_stats' },
  { value: 'evo_cost',   label: '進化コスト',          area: 'card_detail_evo_cost' },
  { value: 'effect',     label: '効果欄',              area: 'card_detail_effect' },
  { value: 'evo_source',         label: '進化元効果（全体）',             area: 'card_detail_evo_source' },
  { value: 'evo_source_stack',   label: '進化元カードの進化元（全体）',   area: 'card_detail_evo_source_stack' },
  { value: 'evo_source_stack_0', label: '└ 1枚目（一番下）',              area: 'card_detail_evo_source_stack_0' },
  { value: 'evo_source_stack_1', label: '└ 2枚目',                         area: 'card_detail_evo_source_stack_1' },
  { value: 'evo_source_stack_2', label: '└ 3枚目',                         area: 'card_detail_evo_source_stack_2' },
  { value: 'evo_source_stack_3', label: '└ 4枚目',                         area: 'card_detail_evo_source_stack_3' },
  { value: 'evo_source_stack_4', label: '└ 5枚目',                         area: 'card_detail_evo_source_stack_4' },
  { value: 'sec_effect', label: 'セキュリティ効果',    area: 'card_detail_sec_effect' },
  { value: 'close',      label: '閉じるボタン',        area: 'card_detail_close' },
];

let _flowEditTurn = 1;  // 現在編集中のターン番号
let _flowMaxTurn = 1;   // 最大ターン番号

function _conditionNeedsCard(type) {
  const def = CONDITION_TYPES.find(t => t.value === type);
  return !!(def && def.needsCardNo);
}

// フロー設定画面を開く
window.openFlowEditor = function() {
  // 最大ターン番号を算出
  _flowMaxTurn = Math.max(1, ...(_scenarioFlow.map(b => b.turn || 1)));
  _flowEditTurn = 1;
  showScreen('tutorial-flow-edit-screen');
  _renderTurnTabs();
  _renderFlowEditor();
};

// フロー設定画面から戻る
window.closeFlowEditor = function() {
  // ONだけどステップが0のブロックを除去（ク���ーンアップ）
  // → 残す。ONの意図がある可能性があるので、ステップ空でも残す
  showScreen('tutorial-scenario-edit-screen');
  _renderFlowSummary();
};

// ターンタブ
window.flowAddTurnTab = function() {
  _flowMaxTurn++;
  _flowEditTurn = _flowMaxTurn;
  _renderTurnTabs();
  _renderFlowEditor();
};

window.flowSelectTurn = function(turn) {
  _flowEditTurn = turn;
  _renderTurnTabs();
  _renderFlowEditor();
};

function _renderTurnTabs() {
  const wrap = document.getElementById('flow-turn-tabs');
  if (!wrap) return;
  let html = '';
  for (let t = 1; t <= _flowMaxTurn; t++) {
    // このターンにブロックがあるか
    const hasBlocks = _scenarioFlow.some(b => (b.turn || 1) === t);
    const isActive = t === _flowEditTurn;
    const bg = isActive ? 'var(--main-cyan)' : (hasBlocks ? '#1a3030' : '#111');
    const color = isActive ? '#000' : (hasBlocks ? 'var(--main-cyan)' : '#555');
    const border = hasBlocks ? 'var(--main-cyan)' : '#333';
    html += `<button onclick="flowSelectTurn(${t})" style="padding:4px 12px; font-size:11px; font-weight:bold; border-radius:4px; border:1px solid ${border}; background:${bg}; color:${color}; cursor:pointer;">T${t}</button>`;
  }
  wrap.innerHTML = html;
}

// スロットのON/OFF切替
window.flowToggleSlot = function(slotKey) {
  const turn = _flowEditTurn;
  const related = _getRelatedBlocks(slotKey, turn);
  if (related.length > 0) {
    // OFF: 関連ブロックを全て削除
    related.forEach(r => {
      const idx = _scenarioFlow.indexOf(r.block);
      if (idx >= 0) _scenarioFlow.splice(idx, 1);
    });
  } else {
    // ON: phase_start のプライマリブロックを作成
    const slot = ALL_FLOW_SLOTS.find(s => s.key === slotKey);
    if (slot) {
      _findOrCreateBlock(slot.phase, slot.trigger, turn);
    }
  }
  _renderTurnTabs();
  _renderFlowEditor();
};

// ステップ追加（スロット内に新しいタイミングでステップ追加）
window.flowAddStepInSlot = function(slotKey) {
  const slot = ALL_FLOW_SLOTS.find(s => s.key === slotKey);
  if (!slot) return;
  // デフォルトタイミング = phase_start
  const timing = 'phase_start';
  const info = _getTargetBlockInfo(slotKey, timing);
  if (!info) return;
  // 編集UIは 1ブロック=1ステップ。新規ブロックをスロット内末尾に挿入する。
  // (スロット内最後のブロックの次に配置することで、同じスロット内で末尾追加の体験)
  let lastFlatBlock = null;
  const related = _getRelatedBlocks(slotKey, _flowEditTurn);
  if (related.length > 0) lastFlatBlock = related[related.length - 1].block;
  // デフォルト occurrence: スロット末尾ブロックの値を継承 (フェーズブロックは 1、連続性を壊さないため)
  const defaultOcc = lastFlatBlock && info.phase === lastFlatBlock.phase
                     && (info.trigger || undefined) === (lastFlatBlock.trigger || undefined)
    ? (lastFlatBlock.occurrence || 1)
    : 1;
  const newBlock = {
    phase: info.phase,
    turn: _flowEditTurn,
    steps: [{
      stepType: 'action', instructionText: '', advanceCondition: { type: 'hatch' },
      targetArea: '', secondTargetArea: '', operationType: '',
    }],
  };
  if (info.trigger) newBlock.trigger = info.trigger;
  if (info.parentSlot) newBlock.parentSlot = info.parentSlot;
  if (defaultOcc > 1) newBlock.occurrence = defaultOcc;
  // _scenarioFlow への挿入: 最後の同スロットブロックの直後 (なければ末尾)
  if (lastFlatBlock) {
    const idx = _scenarioFlow.indexOf(lastFlatBlock);
    _scenarioFlow.splice(idx + 1, 0, newBlock);
  } else {
    _scenarioFlow.push(newBlock);
  }
  _renderFlowEditor();
};

// ステップのタイミング変更（= ブロックの phase/trigger を書き換え）
// 編集UIでは 1ブロック=1ステップ なので、stepIdx はスロット内のフラットインデックス
window.flowChangeStepTiming = function(slotKey, currentTiming, stepIdx, newTiming) {
  if (currentTiming === newTiming) return;
  const toInfo = _getTargetBlockInfo(slotKey, newTiming);
  if (!toInfo) return;
  const block = _getBlockByFlatIdx(slotKey, stepIdx);
  if (!block) return;
  block.phase = toInfo.phase;
  if (toInfo.trigger) block.trigger = toInfo.trigger; else delete block.trigger;
  if (toInfo.parentSlot) block.parentSlot = toInfo.parentSlot; else delete block.parentSlot;
  _renderFlowEditor();
};

// スロット内フラットインデックスからブロックを取得
function _getBlockByFlatIdx(slotKey, flatIdx) {
  const related = _getRelatedBlocks(slotKey, _flowEditTurn);
  const entry = related[flatIdx];
  return entry ? entry.block : null;
}

// 旧: (slotKey, timing, stepIdx, occ) → { block, step } 取得
// 新: stepIdx をフラットインデックスとして解釈 (timing/occ は無視)
function _getStepByTiming(slotKey, timing, stepIdx, occ) {
  const block = _getBlockByFlatIdx(slotKey, stepIdx);
  if (!block || !block.steps[0]) return null;
  return { block, step: block.steps[0] };
}

// ステップ削除 = ブロック削除
window.flowRemoveStep = function(slotKey, timing, stepIdx, occ) {
  const block = _getBlockByFlatIdx(slotKey, stepIdx);
  if (!block) return;
  const idx = _scenarioFlow.indexOf(block);
  if (idx >= 0) _scenarioFlow.splice(idx, 1);
  _renderFlowEditor();
};

// ステップ移動 = スロット内で隣接ブロックと swap
window.flowMoveStep = function(slotKey, timing, stepIdx, delta, occ) {
  const related = _getRelatedBlocks(slotKey, _flowEditTurn);
  const j = stepIdx + delta;
  if (!related[stepIdx] || !related[j]) return;
  const a = related[stepIdx].block;
  const b = related[j].block;
  const ai = _scenarioFlow.indexOf(a);
  const bi = _scenarioFlow.indexOf(b);
  if (ai < 0 || bi < 0) return;
  _scenarioFlow[ai] = b;
  _scenarioFlow[bi] = a;
  _renderFlowEditor();
};

// ステップの occurrence を変更 (ブロックの occurrence を書き換え)
window.flowChangeStepOccurrence = function(slotKey, timing, stepIdx, currentOcc, newOcc) {
  if (currentOcc === newOcc) return;
  const block = _getBlockByFlatIdx(slotKey, stepIdx);
  if (!block) return;
  if (newOcc > 1) block.occurrence = newOcc;
  else delete block.occurrence;
  _renderFlowEditor();
};

// グループヘッダーの occurrence 変更 (= そのグループ内の全ブロックの occurrence を一括変更)
let _occChangeGuard = false;
window.flowChangeOccurrence = function(slotKey, timing, currentOcc, newOcc) {
  if (_occChangeGuard) return;
  if (currentOcc === newOcc) return;
  const info = _getTargetBlockInfo(slotKey, timing);
  if (!info) return;
  _scenarioFlow.forEach(b => {
    if (b.phase !== info.phase) return;
    if ((b.trigger || undefined) !== (info.trigger || undefined)) return;
    if ((b.turn || 1) !== _flowEditTurn) return;
    if (info.parentSlot && (b.parentSlot || undefined) !== info.parentSlot) return;
    if ((b.occurrence || 1) !== currentOcc) return;
    if (newOcc > 1) b.occurrence = newOcc;
    else delete b.occurrence;
  });
  _occChangeGuard = true;
  _renderFlowEditor();
  setTimeout(() => { _occChangeGuard = false; }, 100);
};

// ステップフィールド更新
window.flowUpdateStep = function(slotKey, timing, stepIdx, field, value, occ) {
  const ref = _getStepByTiming(slotKey, timing, stepIdx, occ);
  if (!ref) return;
  const step = ref.step;
  if (field === 'instructionText') {
    step.instructionText = value;
  } else if (field === 'conditionType') {
    step.advanceCondition = { type: value };
    if (_conditionNeedsCard(value)) step.advanceCondition.params = { cardNo: '' };
    // 数値パラメータがあるならデフォルト値で初期化
    const cdef = CONDITION_TYPES.find(t => t.value === value);
    if (cdef && Array.isArray(cdef.params)) {
      step.advanceCondition.params = step.advanceCondition.params || {};
      cdef.params.forEach(p => {
        if (step.advanceCondition.params[p.key] == null && p.default != null) {
          step.advanceCondition.params[p.key] = p.default;
        }
      });
    }
    _renderFlowEditor();
  } else if (field === 'conditionCardNo') {
    if (!step.advanceCondition.params) step.advanceCondition.params = {};
    step.advanceCondition.params.cardNo = value;
  } else if (field === 'targetArea') {
    step.targetArea = value || '';
  } else if (field === 'secondTargetArea') {
    step.secondTargetArea = value || '';
  } else if (field === 'operationType') {
    step.operationType = value || '';
  } else if (field === 'successPopup') {
    step.successPopup = value || 'auto';
  } else if (field === 'stepType') {
    step.stepType = value || 'action';
    _renderFlowEditor();
  } else if (field === 'targetCardNo') {
    step.targetCardNo = value || '';
    _renderFlowEditor();
  } else if (field === 'secondTargetCardNo') {
    step.secondTargetCardNo = value || '';
    _renderFlowEditor();
  } else if (field === 'uiControl') {
    step.uiControl = !!value;
    _renderFlowEditor();
  } else if (field.startsWith('greyOut_')) {
    const key = field.replace('greyOut_', '');
    if (!Array.isArray(step.greyOut)) step.greyOut = [];
    if (value) { if (!step.greyOut.includes(key)) step.greyOut.push(key); }
    else { step.greyOut = step.greyOut.filter(g => g !== key); }
  } else if (field.startsWith('hlBtn_')) {
    const key = field.replace('hlBtn_', '');
    if (!Array.isArray(step.highlightButtons)) step.highlightButtons = [];
    if (value) { if (!step.highlightButtons.includes(key)) step.highlightButtons.push(key); }
    else { step.highlightButtons = step.highlightButtons.filter(b => b !== key); }
  }
};

// ================================================================
// ステップのタイミング→ブロックルーティング
// 各ステップは phaseKey(UI上の所属) + timing(タイミング) を持ち、
// timing に応じた内部ブロック（phase/_trigger）に格納される。
// ================================================================

// phaseKey + timing → 実際に格納するブロック情報
function _getTargetBlockInfo(phaseKey, timing) {
  const slot = ALL_FLOW_SLOTS.find(s => s.key === phaseKey);
  if (!slot) return null;
  const timingDef = STEP_TIMINGS.find(t => t.value === timing);
  if (!timingDef || !timingDef.trigger) {
    // phase_start等はスロットのphase/triggerをそのまま使う
    return { phase: slot.phase, trigger: slot.trigger || undefined };
  }
  // trigger指定あり: parentSlot で親フェーズを記録し、フェーズごとに別ブロックにする
  return { phase: '_trigger', trigger: timingDef.trigger, parentSlot: phaseKey };
}

// ブロックを見つける or 作成
function _findOrCreateBlock(phase, trigger, turn, occurrence, parentSlot) {
  const occ = occurrence || 1;
  let b = _scenarioFlow.find(x =>
    x.phase === phase &&
    (x.trigger || undefined) === (trigger || undefined) &&
    (x.turn || 1) === turn &&
    (x.occurrence || 1) === occ &&
    (!parentSlot || (x.parentSlot || undefined) === parentSlot)
  );
  if (!b) {
    b = { phase, turn, steps: [] };
    if (trigger) b.trigger = trigger;
    if (occ > 1) b.occurrence = occ;
    if (parentSlot) b.parentSlot = parentSlot;
    _scenarioFlow.push(b);
  }
  return b;
}

// 指定スロット(大項目)に関連する全ブロックを取得
// phase block (occurrence 1,2,...複数対応) + 紐づく trigger block 全て
// 返却順は _scenarioFlow の出現順をそのまま使う (↑↓ による並び替え反映用)
function _getRelatedBlocks(slotKey, turn) {
  const slot = ALL_FLOW_SLOTS.find(s => s.key === slotKey);
  if (!slot) return [];
  const availableTriggers = new Set(
    STEP_TIMINGS.filter(t => t.trigger && t.availableIn.includes(slotKey)).map(t => t.trigger)
  );
  const triggerToTiming = {};
  STEP_TIMINGS.forEach(t => { if (t.trigger) triggerToTiming[t.trigger] = t.value; });

  const blocks = [];
  _scenarioFlow.forEach(b => {
    if ((b.turn || 1) !== turn) return;
    // フェーズブロック
    if (b.phase === slot.phase && (b.trigger || undefined) === (slot.trigger || undefined)) {
      blocks.push({ block: b, timing: 'phase_start', occurrence: b.occurrence || 1 });
      return;
    }
    // 紐づくトリガーブロック
    if (b.phase === '_trigger' && b.trigger && availableTriggers.has(b.trigger)
        && (!b.parentSlot || b.parentSlot === slotKey)) {
      const t = triggerToTiming[b.trigger];
      if (t) blocks.push({ block: b, timing: t, occurrence: b.occurrence || 1 });
    }
  });
  return blocks;
}

// スロットの現ON/OFF判定（関連ブロックが1つでもあれば ON）
function _slotIsOn(slotKey, turn) {
  return _getRelatedBlocks(slotKey, turn).length > 0;
}

// --- メインレンダリング ---
function _renderFlowEditor() {
  const container = document.getElementById('flow-phases-container');
  if (!container) return;
  try {
    container.innerHTML = ALL_FLOW_SLOTS.map(slot => _renderSlotBlock(slot)).join('');
  } catch (e) {
    console.error('[FlowEditor] render error:', e);
    container.innerHTML = `<p style="color:#ff4444;">フロー描画エラー: ${e.message}</p>`;
  }
}

function _renderSlotBlock(slot) {
  const turn = _flowEditTurn;
  const related = _getRelatedBlocks(slot.key, turn);
  const isOn = related.length > 0;
  const totalSteps = related.reduce((n, r) => n + (r.block.steps || []).length, 0);

  const headerBg = isOn ? `${slot.color}22` : '#0a0a0a';
  const headerBorder = isOn ? slot.color : '#222';
  const toggleChecked = isOn ? 'checked' : '';
  const badge = totalSteps > 0
    ? `<span style="background:${slot.color}44; color:${slot.color}; font-size:9px; padding:1px 6px; border-radius:3px; margin-left:6px;">${totalSteps}ステップ</span>`
    : '';

  // overflow:hidden を外す（中の絶対配置プルダウンがクリップされるため）
  // 代わりに header / body の角を個別に丸める
  const headerRadius = isOn ? '7px 7px 0 0' : '7px';
  let html = `
    <div style="border:1px solid ${headerBorder}; border-radius:8px; margin-bottom:6px;">
      <div style="background:${headerBg}; padding:8px 12px; display:flex; align-items:center; gap:10px; cursor:pointer; border-radius:${headerRadius};" onclick="flowToggleSlot('${slot.key}')">
        <input type="checkbox" ${toggleChecked} style="accent-color:${slot.color}; pointer-events:none; width:16px; height:16px;">
        <div style="flex:1;">
          <span style="color:${isOn ? slot.color : '#666'}; font-weight:bold; font-size:12px;">${slot.label}</span>${badge}
          <div style="color:#666; font-size:10px; margin-top:1px;">${slot.hint}</div>
        </div>
      </div>`;

  if (isOn) {
    // フラット表示: 連続する同じ timing はヘッダーを1つにまとめる
    // 各ブロックは 1 ステップ (=1 ブロック=1 ステップ)
    let stepsHtml = '';
    let flatIdx = 0;
    let prevTiming = null;
    related.forEach(r => {
      const tDef = STEP_TIMINGS.find(t => t.value === r.timing);
      const tLabel = tDef ? tDef.label : r.timing;
      if (r.timing !== prevTiming) {
        stepsHtml += `<div style="color:${slot.color}; font-size:10px; font-weight:bold; margin:8px 0 4px; padding-left:2px;">${tLabel}</div>`;
        prevTiming = r.timing;
      }
      const step = r.block.steps[0];
      if (!step) return;
      stepsHtml += _renderFlowStep(slot.key, r.timing, flatIdx, step, r.occurrence || 1);
      flatIdx++;
    });

    html += `
      <div style="padding:10px 12px; border-top:1px solid ${slot.color}33; border-radius:0 0 7px 7px;">
        ${stepsHtml || '<p style="color:#555; font-size:10px; margin:0 0 6px;">ステップが未登録です。下のボタンから追加してください。</p>'}
        <button class="admin-btn-sm" onclick="event.stopPropagation(); flowAddStepInSlot('${slot.key}')" style="width:100%; margin-top:4px; font-size:10px;">＋ ステップを追加</button>
      </div>`;
  }

  html += '</div>';
  return html;
}

// 個別ステップの描画
function _renderFlowStep(slotKey, timing, sIdx, step, occ) {
  const sType = step.stepType || 'action';
  const isAction = sType === 'action';
  const isSpotlight = sType === 'spotlight';
  const isMessage = sType === 'message';
  const cond = step.advanceCondition || { type: 'hatch' };
  const needsCard = _conditionNeedsCard(cond.type);
  const cardNo = (cond.params && cond.params.cardNo) || '';
  const occVal = occ || 1;

  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;
  const stepTypeOpts = STEP_TYPES.map(s =>
    `<option value="${s.value}"${s.value === sType ? ' selected' : ''}>${s.label}</option>`
  ).join('');
  const condOpts = CONDITION_TYPES.map(t =>
    `<option value="${t.value}"${t.value === cond.type ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  const areaPicker1 = _renderAreaPicker(slotKey, timing, sIdx, 'targetArea',       step.targetArea || '',       occVal);
  const areaPicker2 = _renderAreaPicker(slotKey, timing, sIdx, 'secondTargetArea', step.secondTargetArea || '', occVal);
  const opOpts = OPERATION_TYPES.map(o =>
    `<option value="${o.value}"${o.value === (step.operationType || '') ? ' selected' : ''}>${o.label}</option>`
  ).join('');

  // このステップが属せるタイミング（現在のスロット内）
  const availableTimings = STEP_TIMINGS.filter(t => t.availableIn.includes(slotKey));
  const timingOpts = availableTimings.map(t =>
    `<option value="${t.value}"${t.value === timing ? ' selected' : ''}>${t.label}</option>`
  ).join('');

  const borderColor = isAction ? '#333' : isSpotlight ? '#ffaa0066' : '#00fbff66';
  const textLabel = isAction ? '指示テキスト' : isSpotlight ? '吹き出しテキスト' : '説明テキスト';
  const textPlaceholder = isAction ? '例: 育成エリアをタップして孵化しよう!'
                        : isSpotlight ? '例: ここがあなたの手札！長押しで詳細が見られるよ'
                        : '例: マリガン画面では、5枚配られた手札を確認できるよ...';
  const target1Label = isSpotlight ? 'スポットライト対象 + 赤枠'
                     : isAction ? '赤枠ハイライト1（指差し対象）'
                     : '';
  const target2Label = isSpotlight ? 'スポットライト対象2（任意）'
                     : isAction ? '赤枠ハイライト2（任意）'
                     : '';

  // ステップタイプ別の表示項目:
  //   message  : 説明テキストのみ（フルスクリーン説明ポップアップ）
  //   spotlight: 説明テキスト + スポットライト対象1/2
  //   action   : 指示テキスト + 進行条件 + 操作タイプ + 赤枠1/2 + UI制御
  const showTargets   = isSpotlight || isAction;
  const showCondOp    = isAction;
  const showUiControl = isAction;

  return `
    <div style="background:#0a0a0a; border:1px solid ${borderColor}; border-radius:6px; padding:10px; margin-bottom:6px;" onclick="event.stopPropagation()">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="color:#aaa; font-size:10px; font-weight:bold;">STEP ${sIdx + 1}</span>
        <div>
          <button class="admin-btn-sm" style="padding:2px 6px; font-size:9px;" onclick="flowMoveStep(${sk},${tg},${sIdx},-1,${occVal})">↑</button>
          <button class="admin-btn-sm" style="padding:2px 6px; font-size:9px;" onclick="flowMoveStep(${sk},${tg},${sIdx},1,${occVal})">↓</button>
          <button class="admin-btn-danger" style="padding:2px 6px; font-size:9px;" onclick="flowRemoveStep(${sk},${tg},${sIdx},${occVal})">×</button>
        </div>
      </div>
      ${availableTimings.length > 1 ? `
      <div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">表示タイミング</label>
        <select onchange="flowChangeStepTiming(${sk},${tg},${sIdx},this.value)">${timingOpts}</select>
      </div>` : ''}
      ${(() => {
        // トリガー系タイミングなら「発火 N 回目」のセレクタを表示 (同一トリガーでの複数回発火を区別)
        const _tDef = STEP_TIMINGS.find(t => t.value === timing);
        const isTriggerTiming = !!(_tDef && _tDef.trigger);
        if (!isTriggerTiming) return '';
        return `<div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">このトリガー発火の何回目?
          <span style="color:#888;">※ 同じトリガーの複数回発火を区別。デフォルト1回目（同じ発火で連続表示）。</span>
        </label>
          <select onchange="flowChangeStepOccurrence(${sk},${tg},${sIdx},${occVal},Number(this.value))">` +
            [1,2,3,4,5].map(n => `<option value="${n}" ${n === occVal ? 'selected' : ''}>${n}回目</option>`).join('') +
          `</select>
        </div>`;
      })()}
      <div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">ステップタイプ</label>
        <select onchange="flowUpdateStep(${sk},${tg},${sIdx},'stepType',this.value,${occVal})">${stepTypeOpts}</select>
      </div>
      <div class="tsave-field" style="margin-bottom:6px;">
        <label style="font-size:10px;">${textLabel}
          <span style="color:#888;">※ {{pc:XX|sp:YY}} でデバイス切替可${isAction ? '' : ' / 空行で区切ると複数の吹き出しに分割'}</span>
        </label>
        <textarea rows="${isAction ? 1 : 3}" oninput="flowUpdateStep(${sk},${tg},${sIdx},'instructionText',this.value,${occVal})"
          placeholder="${textPlaceholder}"
          style="resize:vertical;">${_escHtml(step.instructionText || '')}</textarea>
      </div>
      ${showCondOp ? `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
        <div class="tsave-field" style="margin-bottom:0;"><label style="font-size:10px;">次に進む条件</label>
          ${_renderConditionPicker(slotKey, timing, sIdx, cond.type, occVal)}
          <div style="margin-top:4px;">
            ${_renderConditionParams(cond.type, cond.params || {}, `flowUpdateStepParam(${sk},${tg},${sIdx},'__KEY__',this.value,${occVal})`)}
          </div>
        </div>
        <div class="tsave-field" style="margin-bottom:0;"><label style="font-size:10px;">操作タイプ</label>
          <select onchange="flowUpdateStep(${sk},${tg},${sIdx},'operationType',this.value,${occVal})">${opOpts}</select>
        </div>
      </div>
      <div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">成功演出（条件達成時）</label>
        <select onchange="flowUpdateStep(${sk},${tg},${sIdx},'successPopup',this.value,${occVal})">
          ${SUCCESS_POPUP_PRESETS.map(p => `<option value="${p.value}"${(step.successPopup || 'auto') === p.value ? ' selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </div>` : ''}
      ${showCondOp ? _renderConditionSubSettings(slotKey, timing, sIdx, step, cond, occVal) : ''}
      ${showTargets ? `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
        <div class="tsave-field" style="margin-bottom:0;">
          <label style="font-size:10px;">${target1Label}</label>
          ${areaPicker1}
          ${_renderCardPicker(slotKey, timing, sIdx, 'targetCardNo', step.targetCardNo, occVal)}
        </div>
        <div class="tsave-field" style="margin-bottom:0;">
          <label style="font-size:10px;">${target2Label}</label>
          ${areaPicker2}
          ${_renderCardPicker(slotKey, timing, sIdx, 'secondTargetCardNo', step.secondTargetCardNo, occVal)}
        </div>
      </div>` : ''}
      ${isAction && needsCard ? `
      <div class="tsave-field" style="margin-bottom:6px;"><label style="font-size:10px;">カードNo（進行条件用）</label>
        <input type="text" value="${_escHtml(cardNo)}"
          oninput="flowUpdateStep(${sk},${tg},${sIdx},'conditionCardNo',this.value,${occVal})"
          placeholder="例: BT1-010">
      </div>` : ''}
      ${showUiControl ? _renderStepUiControl(slotKey, timing, sIdx, step, occVal) : ''}
    </div>
  `;
}

// 条件ごとのサブ設定（card_detail_closed のハイライト箇所など）
function _renderConditionSubSettings(slotKey, timing, sIdx, step, cond, occVal) {
  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;
  // card_detail_closed の場合: ハイライト箇所プルダウン（targetArea を自動設定）
  if (cond.type === 'card_detail_closed') {
    const currentArea = step.targetArea || 'card_detail';
    const opts = CARD_DETAIL_AREAS.map(a =>
      `<option value="${a.area}"${a.area === currentArea ? ' selected' : ''}>${a.label}</option>`
    ).join('');
    return `
      <div class="tsave-field" style="margin-bottom:6px; background:#050505; border:1px dashed #00ff8844; border-radius:4px; padding:8px;">
        <label style="font-size:10px; color:#00ff88;">カード詳細ハイライト箇所</label>
        <select onchange="flowUpdateStep(${sk},${tg},${sIdx},'targetArea',this.value,${occVal})">${opts}</select>
        <p style="color:#666; font-size:9px; margin:3px 0 0;">※ 下の「赤枠ハイライト1」と連動。別の箇所を指定したい時は下で上書きできます。</p>
      </div>`;
  }
  return '';
}

// カード検索ピッカー（赤枠ハイライト用）
function _renderCardPicker(slotKey, timing, sIdx, field, currentCardNo, occVal) {
  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;
  const uid = `cp_${slotKey}_${timing}_${sIdx}_${field}_${occVal || 1}`;
  if (currentCardNo) {
    const name = _findCardName(currentCardNo);
    return `
      <div style="display:flex; align-items:center; gap:4px; margin-top:2px;">
        <span style="background:#111; border:1px solid #00ff88; border-radius:3px; padding:2px 6px; font-size:10px; color:#fff; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${_escHtml(name)} <span style="color:#888;">(${_escHtml(currentCardNo)})</span>
        </span>
        <button class="admin-btn-danger" style="padding:1px 6px; font-size:9px;" onclick="flowUpdateStep(${sk},${tg},${sIdx},'${field}','',${occVal}); event.stopPropagation();">×</button>
      </div>`;
  }
  return `
    <div style="position:relative; margin-top:2px;">
      <input type="text" id="${uid}" placeholder="カード名で検索（空＝エリア全体）"
        oninput="flowCardSearch('${uid}',${sk},${tg},${sIdx},'${field}',${occVal})"
        style="font-size:10px; padding:3px; width:100%;">
      <div id="${uid}_results" style="display:none; position:absolute; left:0; right:0; top:100%; z-index:100; max-height:180px; overflow-y:auto; background:#111; border:1px solid #333; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5);"></div>
    </div>`;
}

// カード検索結果を表示
window.flowCardSearch = function(uid, slotKey, timing, sIdx, field, occVal) {
  const input = document.getElementById(uid);
  const results = document.getElementById(uid + '_results');
  if (!input || !results) return;
  const kw = (input.value || '').trim().toLowerCase();
  if (!kw || kw.length < 1) { results.style.display = 'none'; return; }
  if (!window.allCards || !window.allCards.length) {
    results.innerHTML = '<p style="color:#888; font-size:10px; padding:6px;">カードデータ読込中...</p>';
    results.style.display = 'block';
    return;
  }
  const matched = window.allCards.filter(c => {
    const name = String(c['名前'] || '').toLowerCase();
    const no   = String(c['カードNo'] || '').toLowerCase();
    return name.includes(kw) || no.includes(kw);
  }).slice(0, 20);

  if (!matched.length) {
    results.innerHTML = '<p style="color:#888; font-size:10px; padding:6px;">見つかりません</p>';
    results.style.display = 'block';
    return;
  }

  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;
  results.innerHTML = matched.map(c => {
    const no = _escHtml(c['カードNo'] || '');
    const name = _escHtml(c['名前'] || '');
    const lv = _escHtml(c['Lv'] || c['レベル'] || '');
    return `<div onclick="flowUpdateStep(${sk},${tg},${sIdx},'${field}','${no}',${occVal}); event.stopPropagation();"
      style="padding:4px 8px; cursor:pointer; font-size:10px; color:#fff; border-bottom:1px solid #1a1a1a; display:flex; align-items:center; gap:6px;"
      onmouseenter="this.style.background='#1a3030'" onmouseleave="this.style.background=''">
      <span style="color:#aaa; min-width:70px;">${no}</span>
      <span style="flex:1;">${name}</span>
      <span style="color:#666;">Lv.${lv}</span>
    </div>`;
  }).join('');
  results.style.display = 'block';
};

// ステップ内の UI制御セクション（トグル展開式）
function _renderStepUiControl(slotKey, timing, sIdx, step, occVal) {
  const sk = `'${slotKey}'`;
  const tg = `'${timing}'`;
  const hasUi = step.uiControl;
  const checked = hasUi ? 'checked' : '';
  const greyOut = Array.isArray(step.greyOut) ? step.greyOut : [];
  const hlButtons = Array.isArray(step.highlightButtons) ? step.highlightButtons : [];

  const GREYOUT_OPTIONS = [
    { value: 'other_cards',   label: 'カード（ハイライト以外、未指定なら全カード）' },
    { value: 'raising_area',  label: '育成エリア' },
    { value: 'mulligan_redo', label: '引き直しボタン' },
    { value: 'game_start',    label: 'ゲーム開始ボタン' },
    { value: 'end_turn',      label: 'ターン終了ボタン' },
    { value: 'breed_skip',    label: '何もしないボタン（育成フェイズ）' },
    { value: 'exit_gate',     label: 'ゲートを出るボタン' },
    { value: 'confirm_yes',   label: '「はい」ボタン（効果確認/ブロック）' },
    { value: 'confirm_no',    label: '「いいえ」ボタン（効果確認/ブロック）' },
  ];

  const greyOutChecks = GREYOUT_OPTIONS.map(opt => `
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:10px; color:#aaa; margin-bottom:2px;">
      <input type="checkbox" ${greyOut.includes(opt.value) ? 'checked' : ''}
        onchange="flowUpdateStep(${sk},${tg},${sIdx},'greyOut_${opt.value}',this.checked,${occVal})">
      ${opt.label}
    </label>`).join('');

  const hlBtnChecks = BUTTON_TARGETS.map(btn => `
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:10px; color:#aaa; margin-bottom:2px;">
      <input type="checkbox" ${hlButtons.includes(btn.value) ? 'checked' : ''}
        onchange="flowUpdateStep(${sk},${tg},${sIdx},'hlBtn_${btn.value}',this.checked,${occVal})">
      ${btn.label}
    </label>`).join('');

  return `
    <div style="border-top:1px solid #1a1a1a; margin-top:8px; padding-top:6px;">
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:10px; color:#888; font-weight:bold;">
        <input type="checkbox" ${checked} onchange="flowUpdateStep(${sk},${tg},${sIdx},'uiControl',this.checked,${occVal})">
        UI制御を設定する
      </label>
      ${hasUi ? `
      <div style="margin-top:8px; padding:8px; background:#050505; border:1px solid #1a1a1a; border-radius:4px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <div style="color:#ff6666; font-size:9px; font-weight:bold; margin-bottom:4px;">グレーアウト（無効化）</div>
            ${greyOutChecks}
          </div>
          <div>
            <div style="color:#00ff88; font-size:9px; font-weight:bold; margin-bottom:4px;">ボタンハイライト（緑発光）</div>
            ${hlBtnChecks}
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

// 編集フォームにフローサマリーを表示
function _renderFlowSummary() {
  const wrap = document.getElementById('ts-flow-summary');
  if (!wrap) return;
  if (!_scenarioFlow.length) {
    wrap.innerHTML = '<p style="color:#666; font-size:11px; text-align:center;">フロー未設定</p>';
    return;
  }
  // ターンごとにグループ化
  const turns = [...new Set(_scenarioFlow.map(b => b.turn || 1))].sort((a, b) => a - b);
  wrap.innerHTML = turns.map(t => {
    const blocks = _scenarioFlow.filter(b => (b.turn || 1) === t);
    const tags = blocks.map(block => {
      const isTrigger = block.phase === '_trigger';
      const slot = ALL_FLOW_SLOTS.find(s =>
        isTrigger ? s.trigger === block.trigger : s.phase === block.phase && !s.trigger
      );
      const label = slot ? slot.label : (block.phase || '?');
      const color = slot ? slot.color : '#888';
      const count = (block.steps || []).length;
      return `<span style="display:inline-block; background:${color}22; border:1px solid ${color}44; color:${color}; border-radius:4px; padding:2px 8px; margin:2px; font-size:10px;">
        ${label} (${count})
      </span>`;
    }).join('');
    const turnLabel = turns.length > 1 ? `<span style="color:#888; font-size:10px; margin-right:4px;">T${t}:</span>` : '';
    return `<div style="margin-bottom:2px;">${turnLabel}${tags}</div>`;
  }).join('');
}

// ※ phaseGuideTexts 機能は廃止。フェーズ説明はフロー設定の message ステップで作る方針。

// ===================================================================
// カード検索 / 配置 / 配置済み表示
// ===================================================================
const AREA_LABELS = {
  playerHand:          '自分の手札',
  playerBattleArea:    '自分のバトルエリア',
  playerRaisingArea:   '自分の育成エリア',
  playerSecurity:      '自分のセキュリティ(上から順)',
  playerDeckTop:       '自分のデッキ上(次に引く順)',
  playerTrash:         '自分のトラッシュ',
  opponentHand:        '相手の手札',
  opponentBattleArea:  '相手のバトルエリア',
  opponentRaisingArea: '相手の育成エリア',
  opponentSecurity:    '相手のセキュリティ(上から順)',
  opponentDeckTop:     '相手のデッキ上(次に引く順)',
  opponentTrash:       '相手のトラッシュ',
};

window.tsFilterCardsForBoard = function() {
  const input = document.getElementById('ts-card-search');
  const results = document.getElementById('ts-card-search-results');
  if (!input || !results) return;
  const kw = (input.value || '').trim().toLowerCase();
  if (!kw) { results.innerHTML = ''; return; }
  if (!window.allCards || !window.allCards.length) {
    results.innerHTML = '<p style="color:#888; font-size:11px; text-align:center; padding:10px;">カードデータを読み込み中...</p>';
    return;
  }
  const matched = window.allCards.filter(c => {
    const name = String(c['名前'] || '').toLowerCase();
    const no   = String(c['カードNo'] || '').toLowerCase();
    return name.includes(kw) || no.includes(kw);
  }).slice(0, 30);

  if (!matched.length) {
    results.innerHTML = '<p style="color:#888; font-size:11px; text-align:center; padding:10px;">一致するカードがありません</p>';
    return;
  }

  results.innerHTML = matched.map(c => {
    const img  = getCardImageUrl(c) || '';
    const name = _escHtml(c['名前'] || '');
    const no   = _escHtml(c['カードNo'] || '');
    const lv   = _escHtml(c['Lv'] || c['レベル'] || '');
    const opts = Object.keys(AREA_LABELS).map(k => `<option value="${k}">${AREA_LABELS[k]}</option>`).join('');
    return `
      <div style="display:flex; align-items:center; padding:4px; border-bottom:1px solid #1a1a1a;">
        <img src="${img}" style="width:30px; height:42px; object-fit:cover; border-radius:2px; margin-right:8px; background:#000;" onerror="this.style.display='none'">
        <div style="flex:1; min-width:0;">
          <div style="color:#fff; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
          <div style="color:#888; font-size:10px;">${no} / Lv.${lv}</div>
        </div>
        <select onchange="tsPlaceCardFromSearch('${no}', this)" style="font-size:10px; padding:3px; max-width:130px;">
          <option value="">＋配置</option>
          ${opts}
        </select>
      </div>
    `;
  }).join('');
};

window.tsPlaceCardFromSearch = function(cardNo, selectEl) {
  const area = selectEl.value;
  if (!area || !_initialBoardState) { selectEl.value = ''; return; }
  const card = { cardNo };
  if (area === 'playerRaisingArea' || area === 'opponentRaisingArea') {
    _initialBoardState[area] = card;
  } else {
    _initialBoardState[area].push(card);
  }
  selectEl.value = '';
  _renderPlacedCards();
};

window.tsRemovePlacedCard = function(area, idx) {
  if (!_initialBoardState || !_initialBoardState[area]) return;
  _initialBoardState[area].splice(idx, 1);
  _renderPlacedCards();
};

window.tsRemovePlacedRaising = function(area) {
  if (!_initialBoardState) return;
  _initialBoardState[area] = null;
  _renderPlacedCards();
};

function _findCardName(cardNo) {
  if (!window.allCards) return cardNo;
  const c = window.allCards.find(c => String(c['カードNo']) === String(cardNo));
  return c ? (c['名前'] || cardNo) : cardNo;
}

function _placedCardChip(card, area, idx) {
  const cardNo = typeof card === 'string' ? card : (card && card.cardNo);
  if (!cardNo) return '';
  const name = _escHtml(_findCardName(cardNo));
  const removeFn = (idx === null) ? `tsRemovePlacedRaising('${area}')` : `tsRemovePlacedCard('${area}',${idx})`;
  // バトルエリア & 育成エリアで進化元編集ボタンを出す
  const isBattle  = area === 'playerBattleArea'  || area === 'opponentBattleArea';
  const isRaising = area === 'playerRaisingArea' || area === 'opponentRaisingArea';
  const supportEvo = isBattle || isRaising;
  const evoSources = (typeof card === 'object' && Array.isArray(card.evolutionSources)) ? card.evolutionSources : [];
  // 育成エリアは idx=null。tsAddEvoSrcPrompt 等の引数では 'null' リテラルとして渡す
  const idxArg = (idx === null) ? 'null' : String(idx);
  let evoChips = '';
  if (supportEvo) {
    if (evoSources.length) {
      evoChips = '<div style="margin-top:3px; padding-left:8px; border-left:2px solid #ffaa0066;">'
        + '<div style="color:#ffaa00; font-size:9px; margin-bottom:2px;">進化元 (下が一番下のカード):</div>'
        + evoSources.map((src, sIdx) => {
            const sNo = typeof src === 'string' ? src : (src && src.cardNo);
            if (!sNo) return '';
            const sName = _escHtml(_findCardName(sNo));
            return `<span style="display:inline-block; background:#1a1100; border:1px solid #553; border-radius:3px; padding:1px 5px; margin:1px 2px 0 0; font-size:9px; color:#ffcc66;">
              ${sName} <span style="color:#888;">(${_escHtml(sNo)})</span>
              <span onclick="tsRemoveEvoSrc('${area}',${idxArg},${sIdx})" style="color:#ff4444; cursor:pointer; margin-left:3px; font-weight:bold;">×</span>
            </span>`;
          }).join('')
        + '</div>';
    }
    evoChips += `<div style="margin-top:3px;">
      <button onclick="tsAddEvoSrcPrompt('${area}',${idxArg})" style="font-size:9px; padding:1px 6px; background:#332200; color:#ffaa00; border:1px solid #ffaa0066; border-radius:3px; cursor:pointer;">+進化元</button>
    </div>`;
  }
  return `<div style="display:inline-block; background:#111; border:1px solid #333; border-radius:3px; padding:3px 6px; margin:2px 2px 0 0; font-size:10px; color:#fff; vertical-align:top;">
    ${name} <span style="color:#888;">(${_escHtml(cardNo)})</span>
    <span onclick="${removeFn}" style="color:#ff4444; cursor:pointer; margin-left:4px; font-weight:bold;">×</span>
    ${evoChips}
  </div>`;
}

// バトルエリア / 育成エリアのカードに進化元を追加（カード名/番号 検索モーダル）
//   idx=null → 育成エリア（単一カード）, それ以外 → バトルエリアの配列インデックス
window.tsAddEvoSrcPrompt = function(area, idx) {
  if (!_initialBoardState) return;
  const card = (idx === null) ? _initialBoardState[area] : (_initialBoardState[area] || [])[idx];
  if (!card) return;
  _evoPickerCtx = { area, idx };
  _showEvoPickerModal();
};

let _evoPickerCtx = null;

function _showEvoPickerModal() {
  let modal = document.getElementById('ts-evo-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ts-evo-picker-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:11000; background:rgba(0,0,0,0.85); padding:20px; overflow-y:auto; display:flex; align-items:flex-start; justify-content:center;';
    modal.onclick = (e) => { if (e.target === modal) _closeEvoPicker(); };
    modal.innerHTML = `
      <div style="background:#0a0a0a; border:1px solid var(--main-cyan); border-radius:10px; padding:16px; max-width:480px; width:100%; margin-top:40px;" onclick="event.stopPropagation()">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <div style="color:var(--main-cyan); font-size:13px; font-weight:bold;">進化元として積むカードを選択</div>
          <button onclick="_closeEvoPicker()" style="background:none; border:1px solid #555; color:#aaa; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:11px;">閉じる</button>
        </div>
        <input id="ts-evo-search" type="text" placeholder="カード名 または カードNo で検索"
          oninput="_filterEvoPicker()" autocomplete="off"
          style="width:100%; padding:6px 10px; background:#111; border:1px solid var(--border-col); color:#fff; border-radius:4px; font-size:12px; margin-bottom:8px; box-sizing:border-box;">
        <div id="ts-evo-results" style="max-height:50vh; overflow-y:auto; background:#050505; border:1px solid #222; border-radius:4px; padding:4px;"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  const input = document.getElementById('ts-evo-search');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
  _filterEvoPicker();
}

window._closeEvoPicker = function() {
  const modal = document.getElementById('ts-evo-picker-modal');
  if (modal) modal.style.display = 'none';
  _evoPickerCtx = null;
};

window._filterEvoPicker = function() {
  const input = document.getElementById('ts-evo-search');
  const results = document.getElementById('ts-evo-results');
  if (!input || !results) return;
  const kw = (input.value || '').trim().toLowerCase();
  if (!window.allCards || !window.allCards.length) {
    results.innerHTML = '<p style="color:#888; font-size:11px; text-align:center; padding:10px;">カードデータを読み込み中...</p>';
    return;
  }
  let list = window.allCards;
  if (kw) {
    list = list.filter(c => {
      const name = String(c['名前'] || '').toLowerCase();
      const no   = String(c['カードNo'] || '').toLowerCase();
      return name.includes(kw) || no.includes(kw);
    });
  }
  list = list.slice(0, 50);
  if (!list.length) {
    results.innerHTML = '<p style="color:#888; font-size:11px; text-align:center; padding:10px;">一致するカードがありません</p>';
    return;
  }
  results.innerHTML = list.map(c => {
    const img  = getCardImageUrl(c) || '';
    const name = _escHtml(c['名前'] || '');
    const no   = _escHtml(c['カードNo'] || '');
    const lv   = _escHtml(c['Lv'] || c['レベル'] || '');
    return `
      <div style="display:flex; align-items:center; padding:4px; border-bottom:1px solid #1a1a1a;">
        <img src="${img}" style="width:30px; height:42px; object-fit:cover; border-radius:2px; margin-right:8px; background:#000;" onerror="this.style.display='none'">
        <div style="flex:1; min-width:0;">
          <div style="color:#fff; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
          <div style="color:#888; font-size:10px;">${no} / Lv.${lv}</div>
        </div>
        <button onclick="_pickEvoSrc('${no}')" style="font-size:10px; padding:3px 10px; background:#332200; color:#ffaa00; border:1px solid #ffaa0066; border-radius:3px; cursor:pointer;">+ 追加</button>
      </div>
    `;
  }).join('');
};

window._pickEvoSrc = function(cardNo) {
  if (!_evoPickerCtx) return;
  const { area, idx } = _evoPickerCtx;
  if (!_initialBoardState) return;
  // 育成エリア (単一) / バトルエリア (配列) を区別
  if (idx === null) {
    const card = _initialBoardState[area];
    if (!card) return;
    if (typeof card === 'string') {
      _initialBoardState[area] = { cardNo: card, evolutionSources: [cardNo] };
    } else {
      if (!Array.isArray(card.evolutionSources)) card.evolutionSources = [];
      card.evolutionSources.push(cardNo);
    }
  } else {
    if (!Array.isArray(_initialBoardState[area])) return;
    const card = _initialBoardState[area][idx];
    if (!card) return;
    if (typeof card === 'string') {
      _initialBoardState[area][idx] = { cardNo: card, evolutionSources: [cardNo] };
    } else {
      if (!Array.isArray(card.evolutionSources)) card.evolutionSources = [];
      card.evolutionSources.push(cardNo);
    }
  }
  _renderPlacedCards();
  // モーダルは閉じない（連続追加できるように）
};

// 進化元を削除（育成エリア = cardIdx=null, バトルエリア = 配列インデックス）
window.tsRemoveEvoSrc = function(area, cardIdx, srcIdx) {
  if (!_initialBoardState) return;
  let card;
  if (cardIdx === null) {
    card = _initialBoardState[area];
  } else {
    if (!Array.isArray(_initialBoardState[area])) return;
    card = _initialBoardState[area][cardIdx];
  }
  if (!card || !Array.isArray(card.evolutionSources)) return;
  card.evolutionSources.splice(srcIdx, 1);
  _renderPlacedCards();
};

function _renderAreaSection(title, area) {
  if (!_initialBoardState) return '';
  const val = _initialBoardState[area];
  const isRaising = area.endsWith('RaisingArea');
  let body;
  if (isRaising) {
    body = val ? _placedCardChip(val, area, null) : '<span style="color:#555; font-size:10px;">なし</span>';
  } else {
    const arr = Array.isArray(val) ? val : [];
    body = arr.length ? arr.map((c, i) => _placedCardChip(c, area, i)).join('') : '<span style="color:#555; font-size:10px;">なし</span>';
  }
  return `<div style="margin-bottom:6px;">
    <div style="color:#aaa; font-size:10px; margin-bottom:2px;">${title}</div>
    <div>${body}</div>
  </div>`;
}

function _renderPlacedCards() {
  const own = document.getElementById('ts-own-areas');
  const opp = document.getElementById('ts-opp-areas');
  if (!own || !opp) return;
  own.innerHTML =
    _renderAreaSection('手札', 'playerHand') +
    _renderAreaSection('バトルエリア', 'playerBattleArea') +
    _renderAreaSection('育成エリア', 'playerRaisingArea') +
    _renderAreaSection('セキュリティ(上から順)', 'playerSecurity') +
    _renderAreaSection('デッキ上(次に引く順)', 'playerDeckTop') +
    _renderAreaSection('トラッシュ', 'playerTrash');
  opp.innerHTML =
    _renderAreaSection('手札', 'opponentHand') +
    _renderAreaSection('バトルエリア', 'opponentBattleArea') +
    _renderAreaSection('育成エリア', 'opponentRaisingArea') +
    _renderAreaSection('セキュリティ(上から順)', 'opponentSecurity') +
    _renderAreaSection('デッキ上(次に引く順)', 'opponentDeckTop') +
    _renderAreaSection('トラッシュ', 'opponentTrash');
}

// ===================================================================
// 相手AIスクリプト エディタ
// ===================================================================
window.tsAddOpponentTurn = function() {
  const nextTurn = _opponentScript.length
    ? Math.max(..._opponentScript.map(t => Number(t.turn || 0))) + 1
    : 1;
  _opponentScript.push({ turn: nextTurn, actions: [] });
  _renderOpponentScript();
};

window.tsRemoveOpponentTurn = function(idx) {
  _opponentScript.splice(idx, 1);
  _renderOpponentScript();
};

window.tsUpdateOpponentTurnNumber = function(idx, value) {
  if (!_opponentScript[idx]) return;
  _opponentScript[idx].turn = Number(value || 0);
};

window.tsAddOpponentAction = function(turnIdx) {
  if (!_opponentScript[turnIdx]) return;
  _opponentScript[turnIdx].actions.push({ type: 'hatch' });
  _renderOpponentScript();
};

window.tsRemoveOpponentAction = function(turnIdx, actionIdx) {
  if (!_opponentScript[turnIdx]) return;
  _opponentScript[turnIdx].actions.splice(actionIdx, 1);
  _renderOpponentScript();
};

window.tsUpdateOpponentActionType = function(turnIdx, actionIdx, newType) {
  if (!_opponentScript[turnIdx] || !_opponentScript[turnIdx].actions[actionIdx]) return;
  // 既存のパラメータはリセットして type だけ差し替え
  _opponentScript[turnIdx].actions[actionIdx] = { type: newType };
  _renderOpponentScript();
};

window.tsUpdateOpponentActionField = function(turnIdx, actionIdx, field, value) {
  const a = _opponentScript[turnIdx] && _opponentScript[turnIdx].actions[actionIdx];
  if (!a) return;
  a[field] = value;
};

function _renderOpponentScript() {
  const container = document.getElementById('ts-opponent-script-container');
  if (!container) return;
  if (!_opponentScript.length) {
    container.innerHTML = '<p style="color:#666; font-size:11px; text-align:center; padding:10px;">ターンが未登録です（「ターンを追加」でN手目の行動を追加）</p>';
    return;
  }
  container.innerHTML = _opponentScript.map((turnEntry, turnIdx) => {
    const actionsHtml = (turnEntry.actions || []).map((act, actIdx) => {
      return _renderOpponentActionRow(turnIdx, actIdx, act);
    }).join('');
    return `
      <div style="background:#0a0a0a; border:1px solid #333; border-radius:6px; padding:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#ff00fb; font-size:11px; font-weight:bold;">ターン</span>
            <input type="number" min="1" value="${turnEntry.turn}" style="width:50px; padding:3px; font-size:11px;" onchange="tsUpdateOpponentTurnNumber(${turnIdx}, this.value)">
          </div>
          <button class="admin-btn-danger" style="padding:2px 8px; font-size:10px;" onclick="tsRemoveOpponentTurn(${turnIdx})">×ターン削除</button>
        </div>
        <div>${actionsHtml || '<p style="color:#666; font-size:10px; padding:4px;">アクションなし</p>'}</div>
        <button class="admin-btn-sm" style="margin-top:6px; font-size:10px; padding:3px 10px;" onclick="tsAddOpponentAction(${turnIdx})">＋ アクションを追加</button>
      </div>
    `;
  }).join('');
}

function _renderOpponentActionRow(turnIdx, actIdx, action) {
  const typeOpts = OPPONENT_ACTION_TYPES.map(t =>
    `<option value="${t.value}"${t.value === action.type ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  const def = OPPONENT_ACTION_TYPES.find(t => t.value === action.type);
  const defs = (def && def.fieldDefs) || [];
  const fieldsHtml = defs.map(fd => {
    const val = action[fd.key] || '';
    if (fd.type === 'select') {
      const opts = (fd.options || []).map(o =>
        `<option value="${o.value}"${o.value === val ? ' selected' : ''}>${o.label}</option>`
      ).join('');
      return `<label style="display:inline-flex; align-items:center; gap:3px; font-size:10px; color:#888; margin-left:6px;">
        <span>${_escHtml(fd.label)}:</span>
        <select onchange="tsUpdateOpponentActionField(${turnIdx},${actIdx},'${fd.key}',this.value)"
          style="font-size:10px; padding:3px;">
          <option value="">（選択）</option>
          ${opts}
        </select>
      </label>`;
    }
    return `<label style="display:inline-flex; align-items:center; gap:3px; font-size:10px; color:#888; margin-left:6px;">
      <span>${_escHtml(fd.label)}:</span>
      <input type="text" value="${_escHtml(val)}"
        placeholder="No or 名前"
        oninput="tsUpdateOpponentActionField(${turnIdx},${actIdx},'${fd.key}',this.value)"
        style="font-size:10px; padding:3px; width:140px;">
    </label>`;
  }).join('');
  return `
    <div style="display:block; padding:6px; background:#0f0f0f; border-radius:3px; margin-bottom:4px;">
      <div style="display:flex; align-items:center; gap:4px;">
        <span style="color:#888; font-size:10px; min-width:30px;">${actIdx + 1}.</span>
        <select onchange="tsUpdateOpponentActionType(${turnIdx},${actIdx},this.value)" style="font-size:10px; padding:3px; flex:1;">
          ${typeOpts}
        </select>
        <button class="admin-btn-danger" style="padding:2px 6px; font-size:10px;" onclick="tsRemoveOpponentAction(${turnIdx},${actIdx})">×</button>
      </div>
      ${fieldsHtml ? `<div style="margin-top:4px; padding-left:34px;">${fieldsHtml}</div>` : ''}
    </div>
  `;
}

// ===================================================================
// 保存
// ===================================================================
window.executeTutorialScenarioSave = async function() {
  const tutorialName = document.getElementById('ts-tutorial-name').value.trim();
  if (!tutorialName) return alert('チュートリアル名を入力してください');
  const deckId = document.getElementById('ts-deck-id').value;
  if (!deckId) return alert('使用デッキを選択してください');

  // クリア条件
  const type = document.getElementById('ts-clear-type').value;
  if (!type) return alert('クリア条件を選択してください');
  let clearCondition = { type };
  const def = CONDITION_TYPES.find(t => t.value === type);
  if (def && def.needsCardNo) {
    const cardNo = document.getElementById('ts-clear-param').value.trim();
    if (!cardNo) return alert('クリア条件のカードNoを入力してください');
    clearCondition.params = Object.assign({}, clearCondition.params || {}, { cardNo });
  }
  // 数値等のパラメータ入力を取り込む（_clearConditionParams から）
  if (def && Array.isArray(def.params) && def.params.length > 0) {
    const ps = {};
    def.params.forEach(p => {
      const v = _clearConditionParams[p.key];
      if (v != null && v !== '') ps[p.key] = v;
      else if (p.default != null) ps[p.key] = p.default;
    });
    clearCondition.params = Object.assign({}, clearCondition.params || {}, ps);
  }

  // 初期盤面（視覚UI経由の _initialBoardState から構築）
  const ibState = _initialBoardState || _emptyBoardState();
  const initialBoard = {
    playerFirst: document.getElementById('ts-player-first').value === 'true',
    playerMemory: Number(document.getElementById('ts-player-memory').value || 0),
    playerSecurityCount: Number(document.getElementById('ts-player-sec').value || 5),
    opponentSecurityCount: Number(document.getElementById('ts-opponent-sec').value || 5),
    skipMulligan: document.getElementById('ts-skip-mulligan').value === 'true',
    initialPhase: document.getElementById('ts-initial-phase').value || '',
    playerHand:          ibState.playerHand         || [],
    playerBattleArea:    ibState.playerBattleArea   || [],
    playerRaisingArea:   ibState.playerRaisingArea  || null,
    playerSecurity:      ibState.playerSecurity     || [],
    playerDeckTop:       ibState.playerDeckTop      || [],
    playerTrash:         ibState.playerTrash        || [],
    opponentHand:        ibState.opponentHand       || [],
    opponentBattleArea:  ibState.opponentBattleArea || [],
    opponentRaisingArea: ibState.opponentRaisingArea|| null,
    opponentSecurity:    ibState.opponentSecurity   || [],
    opponentDeckTop:     ibState.opponentDeckTop    || [],
    opponentTrash:       ibState.opponentTrash      || [],
  };

  // 相手AIスクリプト（選択式UIから構築済み）
  const opponentScript = _opponentScript.map(t => ({
    turn: Number(t.turn || 0),
    actions: (t.actions || []).map(a => Object.assign({}, a)),
  })).filter(t => t.actions.length > 0);

  // フロー検証 + 保存用に連続する同一グループのブロックを結合（編集UIは1ステップ1ブロック扱いのため）
  const cleanedFlow = [];
  _scenarioFlow.forEach(block => {
    const validSteps = (block.steps || []).filter(s => s && (s.instructionText || s.advanceCondition));
    if (validSteps.length === 0 && (block.steps || []).length > 0) return; // 空ステップのみのブロックは除外
    const prev = cleanedFlow[cleanedFlow.length - 1];
    const sameGroup = prev
      && prev.phase === block.phase
      && (prev.trigger || undefined) === (block.trigger || undefined)
      && (prev.turn || 1) === (block.turn || 1)
      && (prev.occurrence || undefined) === (block.occurrence || undefined)
      && (prev.parentSlot || undefined) === (block.parentSlot || undefined);
    if (sameGroup) {
      prev.steps.push(...validSteps);
    } else {
      cleanedFlow.push({
        phase: block.phase,
        turn: block.turn || 1,
        trigger: block.trigger || undefined,
        occurrence: block.occurrence || undefined,
        parentSlot: block.parentSlot || undefined,
        steps: validSteps,
      });
    }
  });

  // クリア後メッセージ
  const clearMessage = (document.getElementById('ts-clear-message').value || '').trim() || undefined;

  const scenario = {
    id: _scenarioEditData ? _scenarioEditData.id : '',
    tutorialName,
    description: document.getElementById('ts-description').value.trim(),
    difficulty: document.getElementById('ts-difficulty').value,
    order: Number(document.getElementById('ts-order').value || 0),
    prerequisiteId: document.getElementById('ts-prerequisite').value.trim() || null,
    mode: document.getElementById('ts-mode').value,
    deckId,
    clearCondition,
    clearMessage,
    initialBoard,
    opponentScript,
    flow: cleanedFlow,
  };

  const btn = document.getElementById('ts-save-btn');
  btn.disabled = true; btn.innerText = '保存中...';

  try {
    const isUpdate = !!(_scenarioEditData && _scenarioEditData.id);
    const action = isUpdate ? 'updateTutorialScenario' : 'saveTutorialScenario';
    const result = await gasPost(action, { scenario });
    btn.disabled = false; btn.innerText = '保存する';
    if (result && (result.status === 'SUCCESS_NEW' || result.status === 'SUCCESS_UPDATE')) {
      alert(`「${tutorialName}」を${result.status === 'SUCCESS_UPDATE' ? '上書き保存' : '新規登録'}しました`);
      showScreen('tutorial-scenario-list-screen');
      loadTutorialScenarioList();
    } else {
      const detail = result
        ? (result.message || result.error || result.status || JSON.stringify(result))
        : '(レスポンスなし)';
      alert('保存エラー: ' + detail + '\n\nGAS API のデプロイが最新か、スプシの「チュートリアルシナリオ」シートが存在するか確認してください。');
      console.error('[saveTutorialScenario] result:', result);
    }
  } catch (e) {
    btn.disabled = false; btn.innerText = '保存する';
    alert('通信エラー: ' + e.message);
  }
};
