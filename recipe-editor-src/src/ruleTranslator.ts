// メインアクション + ルール群 (MiniStep[]) → 既存形式 JSON への翻訳 (B方式)
//
// 編集UI はシンプルなミニ effect step 形式でルールを保持し、保存時にこの翻訳器が
// メインアクション毎の規則に従って既存 JSON 形状 (selections[] / return_to / options[] 等)
// に展開する。エンジンは無改修で既存通り動作。
//
// 翻訳ルールはメインアクションごとに 1 つの関数で表現。新しいメインアクションが
// rules 対応する場合はこの translate map に1関数追加するだけ。

import type { MiniStep, ConditionPair } from './types';

// 条件 (cond_xxx:value) の配列を filter オブジェクトへ変換
// recipe-editor-src 側のフィルタ仕様: { color, type, lv_le, lv_ge, dp_le, dp_ge, feature_contains, name_contains }
function condsToFilter(conds?: ConditionPair[]): Record<string, any> {
  const f: Record<string, any> = {};
  if (!Array.isArray(conds)) return f;
  for (const c of conds) {
    if (!c || !c.base) continue;
    const base = c.base.startsWith('cond_') ? c.base : 'cond_' + c.base;
    const v = c.value;
    const num = (x: any) => { const n = parseInt(String(x ?? ''), 10); return isNaN(n) ? undefined : n; };
    switch (base) {
      case 'cond_color':            if (v) f.color = String(v); break;
      case 'cond_type':             if (v) f.type = String(v); break;
      // 完全一致は le + ge の両方を同時にセットして AND 評価
      case 'cond_lv':               { const n = num(v); if (n !== undefined) { f.lv_le = n; f.lv_ge = n; } break; }
      case 'cond_lv_le':            { const n = num(v); if (n !== undefined) f.lv_le = n; break; }
      case 'cond_lv_ge':            { const n = num(v); if (n !== undefined) f.lv_ge = n; break; }
      case 'cond_dp':               { const n = num(v); if (n !== undefined) { f.dp_le = n; f.dp_ge = n; } break; }
      case 'cond_dp_le':            { const n = num(v); if (n !== undefined) f.dp_le = n; break; }
      case 'cond_dp_ge':            { const n = num(v); if (n !== undefined) f.dp_ge = n; break; }
      case 'cond_cost':             { const n = num(v); if (n !== undefined) { f.cost_le = n; f.cost_ge = n; } break; }
      case 'cond_cost_le':          { const n = num(v); if (n !== undefined) f.cost_le = n; break; }
      case 'cond_cost_ge':          { const n = num(v); if (n !== undefined) f.cost_ge = n; break; }
      case 'cond_feature_contains': if (v) f.feature_contains = String(v); break;
      case 'cond_name_contains':    if (v) f.name_contains = String(v); break;
      case 'cond_feature':          if (v) f.feature = String(v); break;
      // 知らない条件は無視（filter に出さない）
    }
  }
  return f;
}

// 値を整数 or そのまま返す
function asNumberOrPass(v: any): any {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const n = parseInt(String(v), 10);
  if (!isNaN(n) && String(n) === String(v).trim()) return n;
  return v;
}

// === 条件分類 ===
// FILTER 系: selections[].filter に畳めるカード属性条件（色/Lv/DP/タイプ/特徴/名前等）
// CONTEXT 系: 直前選択カード参照や自身状態など、selections に畳めず post_actions で評価する条件
const FILTER_COND_CODES = new Set([
  'cond_color', 'cond_type', 'cond_feature', 'cond_feature_contains',
  'cond_lv', 'cond_lv_le', 'cond_lv_ge',
  'cond_dp', 'cond_dp_le', 'cond_dp_ge',
  'cond_cost', 'cond_cost_le', 'cond_cost_ge',
  'cond_name', 'cond_name_contains',
]);

// ConditionPair[] を「filter畳み可能 / 文脈条件」に分割
function splitConds(conds?: ConditionPair[]): { filterConds: ConditionPair[]; contextConds: ConditionPair[] } {
  const filterConds: ConditionPair[] = [];
  const contextConds: ConditionPair[] = [];
  (conds || []).forEach((c) => {
    if (!c || !c.base) return;
    if (FILTER_COND_CODES.has(c.base)) filterConds.push(c);
    else contextConds.push(c);
  });
  return { filterConds, contextConds };
}

// ConditionPair を "base:value@subject" 文字列へ
function pairToString(p: ConditionPair): string {
  let s = p.base;
  if (p.value !== undefined && p.value !== '') s += ':' + p.value;
  if (p.subject) s += '@' + p.subject;
  return s;
}

// === メインアクション毎の翻訳 ===
// 各翻訳器は (step, rule) を受け取り、step を直接 mutate する

// deck_open / deck_search 系: ルールは「オープンしたカードに対する処理」
//   action='add_to_hand' / 'bounce' → selections.push({...destination:'hand'})
//   action='destroy'                → selections.push({...destination:'trash'})
//   action='add_to_evo_source'      → selections.push({...destination:'evo_source'})
//   action='place_on_security_top'  → selections.push({...destination:'security_top'})
//   action='return_deck'            → return_to を value から決定
//   action='use_main_effect'        → use_main_effect: true (option 系)
function applyDeckOpenRule(step: any, rule: MiniStep): void {
  // 条件を「フィルタ系」「文脈系」に分割
  const { filterConds, contextConds } = splitConds(rule.conditions);

  // 文脈条件あり → このルールは post_actions として展開（選択完了後の条件付き追加処理）
  if (contextConds.length > 0) {
    const post: any = { action: rule.action };
    if (rule.target) post.target = rule.target;
    if (rule.value !== undefined && rule.value !== '') post.value = asNumberOrPass(rule.value);
    if (Array.isArray(rule.options) && rule.options.length > 0) post.options = rule.options.slice();
    // 条件は condition / when / extra_conditions 形式で直列化（メイン step と同じ）
    if (contextConds.length >= 1) post.condition = pairToString(contextConds[0]);
    if (contextConds.length >= 2) post.when = pairToString(contextConds[1]);
    if (contextConds.length >= 3) post.extra_conditions = contextConds.slice(2).map(pairToString);
    // フィルタ条件も拾えば filter に乗せる（post 側で対象を絞り込む用途）
    const pf = condsToFilter(filterConds);
    if (Object.keys(pf).length > 0) post.filter = pf;
    if (!Array.isArray(step.post_actions)) step.post_actions = [];
    step.post_actions.push(post);
    return;
  }

  const filter = condsToFilter(filterConds);
  // rule.type が指定されていれば filter.type にマージ（条件側との重複は条件側が勝つ）
  if (rule.type && !filter.type) filter.type = rule.type;

  // === 「残ったカード」フラグが立っている場合: return_to の指定として解釈 ===
  // フィルタや count は無視し、rule.action と rule.value から戻し先を決定
  if (rule.isRemaining) {
    switch (rule.action) {
      case 'destroy':
      case 'return_trash':
        step.return_to = 'trash'; return;
      case 'return_deck':
      case 'add_to_hand': // 「残りを手札へ」は珍しいが許可
      default: {
        // value で variant 指定。空なら 'deck_choice' 既定
        const variant = String(rule.value ?? 'choice');
        step.return_to = (variant.startsWith('deck_') || variant === 'trash')
          ? variant
          : 'deck_' + variant;
        return;
      }
    }
  }

  const count = asNumberOrPass(rule.value) ?? 1;
  const pushSelection = (destination: string) => {
    if (!Array.isArray(step.selections)) step.selections = [];
    const sel: Record<string, any> = { count, destination };
    if (Object.keys(filter).length > 0) sel.filter = filter;
    // ルール内修飾子をこの選択に限定して適用（メインアクション直下の options とは別系統）
    if (Array.isArray(rule.options) && rule.options.length > 0) sel.options = rule.options.slice();
    step.selections.push(sel);
  };
  switch (rule.action) {
    case 'add_to_hand':
    case 'bounce':
      pushSelection('hand'); return;
    case 'destroy':
      pushSelection('trash'); return;
    case 'add_to_evo_source':
      pushSelection('evo_source'); return;
    case 'place_on_security_top':
      pushSelection('security_top'); return;
    case 'place_on_security_bottom':
      pushSelection('security_bottom'); return;
    case 'return_deck': {
      // value で variant 指定。空なら 'deck_choice' 既定
      const variant = String(rule.value ?? 'choice');
      step.return_to = variant.startsWith('deck_') || variant === 'trash' ? variant : 'deck_' + variant;
      return;
    }
    case 'return_trash':
      step.return_to = 'trash'; return;
  }
  // 未知アクション: ad-hoc 形式でそのまま selections に投入（後段で人間が見て判断）
  if (!Array.isArray(step.selections)) step.selections = [];
  step.selections.push({ action: rule.action, count, ...(Object.keys(filter).length > 0 ? { filter } : {}) });
}

// 翻訳器マップ。ここに 1 関数追加するだけで他のメインアクションも rules 対応可能。
const TRANSLATORS: Record<string, (step: any, rule: MiniStep) => void> = {
  deck_open: applyDeckOpenRule,
  deck_search: applyDeckOpenRule, // 同型
};

export function hasRuleTranslator(mainAction: string | undefined): boolean {
  return !!mainAction && !!TRANSLATORS[mainAction];
}

// 1つの step に対し、rules を翻訳して step フィールドへマージ
export function applyRulesToStep(mainAction: string, rules: MiniStep[] | undefined, step: any): void {
  if (!Array.isArray(rules) || rules.length === 0) return;
  const translator = TRANSLATORS[mainAction];
  if (!translator) {
    // 翻訳器無しのメインアクション: rules を rules フィールドにそのまま残す（汎用処理）
    // 編集情報のみ保持し、エンジンは無視。後で対応するアクション用の翻訳を足したらここを通らなくなる。
    step.rules = rules.map((r) => {
      const out: any = { action: r.action };
      if (r.target) out.target = r.target;
      if (r.value !== undefined && r.value !== '') out.value = asNumberOrPass(r.value);
      if (Array.isArray(r.options) && r.options.length > 0) out.options = r.options.slice();
      if (r.isRemaining) out.is_remaining = true;
      const f = condsToFilter(r.conditions);
      if (r.type && !f.type) f.type = r.type;
      if (Object.keys(f).length > 0) out.filter = f;
      return out;
    });
    return;
  }
  rules.forEach((rule) => translator(step, rule));
}
