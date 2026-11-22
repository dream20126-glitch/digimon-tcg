// AI対戦（ベテランテイマー／デジモンマスター）の「頭」
// ・デッキの設計図: 持たせたデッキの中身を対戦開始時に読んで、勝ち筋（一番上のレベルのデジモン）・進化の流れ・
//   メモリーを増やすカード・守りのカード・デッキの型（速攻／コントロール／バランス）をまとめる
// ・相手のデッキの読み: 相手が見せたカード（場・進化元・テイマー・育成・トラッシュ）から、同じやり方で型を推測する
// ここはカードを分類するだけ。盤面を見た判断は battle-combat.js（_aiPlan / _aiOverflowAllowance 等）

const _lv = (c) => parseInt(c && c.level, 10) || 0;
const _isDigi = (c) => c && (c.type === 'デジモン' || c.type === 'デュアル');

function _recipeOf(c) {
  let r = c && c.recipe;
  if (typeof r === 'string') { try { r = r ? JSON.parse(r) : null; } catch (_) { r = null; } }
  return r && typeof r === 'object' ? r : null;
}
// レシピの中の手順（action を持つもの）・常在フラグ（flag を持つもの）と、そのトリガー名を全部たどる
function _walk(node, trig, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((x) => _walk(x, trig, out)); return; }
  if (node.action || node.flag) out.push({ trig, st: node });
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object') _walk(v, /^(display_text|filter|selections|designated)$/.test(k) ? trig : (trig ? trig + ',' + k : k), out);
  }
}

const _tagCache = new Map();
// カード1枚の役割。{ rush, blocker, piercing, saPlus, removal, evoDiscard, memGain, memReset, search, cheat, onMove, assembly, pump }
export function classifyCard(c) {
  if (!c) return {};
  const key = c.cardNo || c.name;
  if (key && _tagCache.has(key)) return _tagCache.get(key);
  const t = String(c.effect || '') + '\n' + String(c.evoSourceEffect || '');
  const main = String(c.effect || '');
  const items = [];
  _walk(_recipeOf(c), '', items);
  const flags = new Set(items.filter((x) => x.st.flag).map((x) => String(x.st.flag)));
  const acts = items.filter((x) => x.st.action);
  const oppAct = (re) => acts.some((x) => re.test(String(x.st.action)) && /^opp/.test(String(x.st.target || '')));
  const tags = {
    rush: flags.has('rush') || /【速攻】/.test(main),
    blocker: flags.has('blocker') || /【ブロッカー】/.test(main),
    piercing: flags.has('penetrate') || flags.has('piercing') || /【貫通】/.test(main),
    saPlus: /Sアタック\+/.test(main),
    removal: oppAct(/^(destroy|bounce|return_deck|return_hand|dedigivolve)$/) || /相手の[^。]*?(消滅させる|手札に戻す|デッキの(下|上)に戻す)/.test(main),
    evoDiscard: oppAct(/^(discard|evo_discard)/) || /相手の[^。]*?進化元[^。]*?破棄/.test(main),
    memGain: acts.some((x) => /^memory(_plus)?$/.test(String(x.st.action))) || /メモリー(を)?\s*[+＋]\s*\d/.test(t),
    memReset: /メモリーが\d以下なら、?\d(に|へ)する/.test(main),
    search: acts.some((x) => /^(deck_open|draw|search)/.test(String(x.st.action))) || /ドロー|オープンする/.test(main),
    cheat: acts.some((x) => (x.st.action === 'summon_appear' && x.st.cost_free) || (x.st.action === 'evolve' && (parseInt(x.st.value, 10) || 0) < 0))
      || /コストを支払わず|進化コスト-\d/.test(main),
    onMove: items.some((x) => /(^|,)on_move(,|$)/.test(x.trig)) || /【移動時】/.test(main),
    assembly: flags.has('assembly') || /【アセンブリ/.test(main),
    pump: acts.some((x) => x.st.action === 'dp_plus' && /^own|^self/.test(String(x.st.target || ''))),
    // 相手のセキュリティを効果で減らす（破棄・トラッシュ・手札に加える等）
    secTrash: acts.some((x) => /^opp(onent)?_security/.test(String(x.st.target || '')) && !/^(dp_plus|dp_minus|grant_keyword|place|add)/.test(String(x.st.action)))
      || /相手のセキュリティ[^。]*?(破棄|トラッシュ)/.test(main),
    // 【アタック時】・【消滅時】を持つ（アタックする／消滅することに意味がある）。進化元の効果も含む
    // 一番上のカードとしての効果（main）と、進化元にあるときの効果（evo）を分ける
    onAttack: items.some((x) => !/^evo_source/.test(x.trig) && /(^|,)on_attack(,|$)/.test(x.trig)) || /【アタック時】/.test(main),
    onDestroy: items.some((x) => !/^evo_source/.test(x.trig) && /(^|,)on_destroy(,|$)/.test(x.trig)) || /【消滅時】/.test(main),
    onAttackEvo: items.some((x) => /^evo_source/.test(x.trig) && /(^|,)on_attack(,|$)/.test(x.trig)) || /【アタック時】/.test(String(c.evoSourceEffect || '')),
    onDestroyEvo: items.some((x) => /^evo_source/.test(x.trig) && /(^|,)on_destroy(,|$)/.test(x.trig)) || /【消滅時】/.test(String(c.evoSourceEffect || '')),
  };
  // セキュリティからめくれたとき、アタックしてきたデジモンを弱らせる・取り除くオプション
  // （【セキュリティ】の効果か、「このカードの【メイン】効果を発揮する」で【メイン】が相手のデジモンに効くもの）
  const sec = String(c.securityEffect || '');
  const harm = /相手の(デジモン)?[^。]*?(消滅|DP\s*[-－−]|手札に戻|デッキの(下|上)に戻|レスト)/;
  tags.secHarm = c.type === 'オプション' && (harm.test(sec) || (/【メイン】/.test(sec) && (harm.test(main) || tags.removal)));
  if (key) _tagCache.set(key, tags);
  return tags;
}

const _STYLE_JA = { aggro: '速攻型（アタックで押し切る）', control: 'コントロール型（相手を止めて戦う）', midrange: 'バランス型' };

// デッキ（カードの配列。同じカードは枚数ぶん並ぶ）から設計図を作る。相手の読みでは見えたカードを1枚ずつ渡す
export function buildDeckProfile(cards) {
  const list = (cards || []).filter((c) => c && _lv(c) !== 2 && c.type !== 'デジタマ');
  const digis = list.filter((c) => _isDigi(c) && _lv(c) >= 3);
  const count = (arr, f) => { const m = new Map(); arr.forEach((c) => f(c).forEach((k) => { if (k) m.set(k, (m.get(k) || 0) + 1); })); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const colors = count(list, (c) => String(c.color || '').split(/[\/／・,、]/).map((s) => s.trim()));
  const feats = count(list, (c) => String(c.feature || '').split(/[\/／]/).map((s) => s.trim()).filter((s) => s && s !== 'なし'));
  const maxLv = digis.reduce((m, c) => Math.max(m, _lv(c)), 0);
  const finCards = digis.filter((c) => _lv(c) === maxLv);
  const finNames = [...new Set(finCards.map((c) => c.name))];
  // デッキの軸の特徴: 勝ち筋のカードが持つ特徴のうち、デッキで一番多いもの（無ければ一番多い特徴）
  const finFeats = new Set(finCards.flatMap((c) => String(c.feature || '').split(/[\/／]/).map((s) => s.trim())));
  const axis = (feats.find(([f, n]) => finFeats.has(f) && n >= list.length * 0.3) || feats.find(([, n]) => n >= list.length * 0.4) || [null])[0];
  const levels = {};
  digis.forEach((c) => { const l = _lv(c); (levels[l] = levels[l] || new Set()).add(c.name); });
  Object.keys(levels).forEach((l) => { levels[l] = [...levels[l]]; });
  const n = { rush: 0, blocker: 0, piercing: 0, saPlus: 0, removal: 0, evoDiscard: 0, memGain: 0, memReset: 0, search: 0, cheat: 0, onMove: 0, assembly: 0, pump: 0 };
  list.forEach((c) => { const t = classifyCard(c); Object.keys(n).forEach((k) => { if (t[k]) n[k]++; }); });
  const aggro = n.rush * 1.5 + n.piercing + n.saPlus * 1.5 + n.pump * 0.5;
  const control = n.removal * 1.5 + n.evoDiscard * 1.5 + n.blocker;
  const style = aggro >= control * 1.3 ? 'aggro' : control >= aggro * 1.3 ? 'control' : 'midrange';
  const memResetNames = [...new Set(list.filter((c) => classifyCard(c).memReset).map((c) => c.name))];
  const label = (axis || (colors[0] && colors[0][0] + '') || '不明') + (finNames.length ? '（' + finNames[0] + '）' : '') + '・' + _STYLE_JA[style];
  return {
    label, style, axis, colors: colors.map(([c]) => c), maxLv, finisherNames: finNames,
    levels, counts: n, memResetNames, size: list.length,
  };
}

// 設計図の説明（ログ用の1行）
export function describeProfile(p) {
  if (!p) return '';
  const line = Object.keys(p.levels).map(Number).sort((a, b) => a - b).map((l) => 'Lv.' + l).join('→');
  const parts = ['型: ' + p.label];
  if (p.finisherNames.length) parts.push('勝ち筋: Lv.' + p.maxLv + '「' + p.finisherNames.join('」「') + '」（' + line + 'で育てる）');
  if (p.memResetNames.length) parts.push('メモリー回復:「' + p.memResetNames.join('」「') + '」');
  const def = [];
  if (p.counts.blocker) def.push('ブロッカー' + p.counts.blocker);
  if (p.counts.removal) def.push('除去' + p.counts.removal);
  if (p.counts.evoDiscard) def.push('進化元破棄' + p.counts.evoDiscard);
  if (def.length) parts.push('守り: ' + def.join('・'));
  return parts.join(' ／ ');
}

if (typeof window !== 'undefined') window._aiBrain = { classifyCard, buildDeckProfile, describeProfile };
