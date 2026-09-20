// EffectBlock[] ⇄ recipe JSON 変換
import type { AltAction, ConditionPair, DictEntry, EffectBlock, KeywordEntry, DesignatedGroup } from './types';
import { applyRulesToStep } from './ruleTranslator';

// 条件pairを「base:value@subject」形式の文字列に変換
// subjectが空なら省略（互換性維持）
function pairToString(p: ConditionPair): string {
  if (!p.base) return '';
  let s = p.value ? p.base + ':' + p.value : p.base;
  if (p.subject) s += '@' + p.subject;
  return s;
}

// AltAction 1件を JSON のステップオブジェクトに変換する（alt_actions[] の各要素、
// および 'then'（その後）モードで独立した後続stepとして出力する場合の両方で共用）
function altActionToStepObject(a: AltAction): any {
  const out: any = { action: a.action };
  if (a.value !== undefined && a.value !== '' && a.value !== null) {
    const n = Number(a.value);
    out.value = isNaN(n) ? a.value : n;
  }
  if (a.target) out.target = a.target;
  const validGate = (a.gateConditions || []).filter((p) => p.base);
  if (validGate.length >= 1) out.gate = pairToString(validGate[0]);
  if (validGate.length >= 2) out.gate_when = pairToString(validGate[1]);
  if (validGate.length >= 3) out.gate_extra_conditions = validGate.slice(2).map(pairToString);
  const validC = (a.conditions || []).filter((p) => p.base);
  if (validC.length >= 1) out.condition = pairToString(validC[0]);
  if (validC.length >= 2) out.when = pairToString(validC[1]);
  if (validC.length >= 3) out.extra_conditions = validC.slice(2).map(pairToString);
  if (validC.length >= 2 && a.conditionsOp === 'or') out.condition_op = 'or';
  if (Array.isArray(a.fromZones) && a.fromZones.length > 0) {
    const az = a.fromZones.filter((z) => !!z);
    if (az.length === 1) out.from = az[0];
    else if (az.length > 1) {
      out.from = az;
      if (a.fromZonesOp && a.fromZonesOp !== 'or') out.from_op = a.fromZonesOp;
    }
  }
  if (Array.isArray(a.options) && a.options.length > 0) out.options = a.options.slice();
  // 上/下（デッキに戻す位置等・hasDeckPosition用）。'both'（どちらか選んで）はエンジン未対応の
  // ため 'select' として出力する（メイン側の serialize と同じ変換規則）
  if (a.deckPosition === 'top') out.position = 'top';
  else if (a.deckPosition === 'bottom') out.position = 'bottom';
  else if (a.deckPosition === 'both') out.position = 'select';
  // per_count / duration / ref / ref_filter
  if (a.perCount && a.perCount > 0 && a.perRef) {
    out.per_count = a.perCount;
    out.ref = a.perRef;
    if (a.perCountMode === 'repeat') out.per_count_mode = 'repeat';
    if (Array.isArray(a.perRefFilter) && a.perRefFilter.length > 0) {
      const af: Record<string, any> = {};
      a.perRefFilter.forEach((c) => {
        if (!c || !c.base || !c.value) return;
        const num2 = (v: any) => { const n = parseInt(String(v), 10); return isNaN(n) ? undefined : n; };
        switch (c.base) {
          case 'cond_color': af.color = c.value; break;
          case 'cond_type':  af.type = c.value; break;
          case 'cond_lv': { const n = num2(c.value); if (n !== undefined) { af.lv_le = n; af.lv_ge = n; } break; }
          case 'cond_lv_le': { const n = num2(c.value); if (n !== undefined) af.lv_le = n; break; }
          case 'cond_lv_ge': { const n = num2(c.value); if (n !== undefined) af.lv_ge = n; break; }
        }
      });
      if (Object.keys(af).length > 0) out.ref_filter = af;
    }
  }
  if (a.duration) out.duration = a.duration;
  return out;
}

// ConditionPair[] → カード絞り込み用フィルタオブジェクト（step.filter / step.from_filter 共通）。
// targetFilter（アクション対象自身の絞り込み）・fromFilter（進化/登場アクションの取得元
// エリアから選ぶカードの絞り込み）の両方で同じ形を使うため共通化している
// 値を持たない（チェックのみの）条件コード。buildFilterObject の value 必須ガードを迂回する
const NO_VALUE_FILTER_CONDS = new Set(['cond_dp_highest', 'cond_dp_lowest']);

function buildFilterObject(pairs: ConditionPair[] | undefined): Record<string, any> | null {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const f: Record<string, any> = {};
  pairs.forEach((c) => {
    if (!c || !c.base) return;
    if (!c.value && !NO_VALUE_FILTER_CONDS.has(c.base)) return;
    const num = (v: any) => { const n = parseInt(String(v), 10); return isNaN(n) ? undefined : n; };
    switch (c.base) {
      case 'cond_color':            f.color = c.value; break;
      case 'cond_dp':       { const n = num(c.value); if (n !== undefined) { f.dp_le = n; f.dp_ge = n; } break; }
      case 'cond_dp_le':    { const n = num(c.value); if (n !== undefined) f.dp_le = n; break; }
      case 'cond_dp_ge':    { const n = num(c.value); if (n !== undefined) f.dp_ge = n; break; }
      // 対象候補プール全体との比較が必要なため cardMatchesFilter（カード単体評価）では
      // 判定できず、対象選択処理側で別途「候補一覧の中から絞り込む」実装が必要
      // （エンジン未対応・保存のみ可。現状のところ値は不要なので c.value は見ない）
      case 'cond_dp_highest': f.dp_extreme = 'highest'; break;
      case 'cond_dp_lowest':  f.dp_extreme = 'lowest'; break;
      // カンマ区切り(複数チェック)なら type_in 配列(OR)、単一値ならこれまで通り type
      case 'cond_type': {
        const types = String(c.value).split(',').map((s) => s.trim()).filter(Boolean);
        if (types.length > 1) f.type_in = types; else f.type = types[0];
        break;
      }
      case 'cond_lv':       { const n = num(c.value); if (n !== undefined) { f.lv_le = n; f.lv_ge = n; } break; }
      case 'cond_lv_le':    { const n = num(c.value); if (n !== undefined) f.lv_le = n; break; }
      case 'cond_lv_ge':    { const n = num(c.value); if (n !== undefined) f.lv_ge = n; break; }
      // 登場/使用コスト（cardMatchesFilterがfilter.cost/cost_le/cost_geを読む）
      case 'cond_cost':     { const n = num(c.value); if (n !== undefined) { f.cost_le = n; f.cost_ge = n; } break; }
      case 'cond_cost_le':  { const n = num(c.value); if (n !== undefined) f.cost_le = n; break; }
      case 'cond_cost_ge':  { const n = num(c.value); if (n !== undefined) f.cost_ge = n; break; }
      // カンマ区切り(複数チェック)なら feature_includes 配列(OR・特徴を "/" で分割して部分一致)、
      // 単一値でも feature_includes を使う（cardMatchesFilter は feature_contains を見ないため）
      case 'cond_feature_contains': {
        const feats = String(c.value).split(',').map((s) => s.trim()).filter(Boolean);
        if (feats.length > 0) f.feature_includes = feats;
        break;
      }
      case 'cond_name':             f.name = c.value; break;
      case 'cond_name_contains':    f.name_contains = c.value; break;
      case 'cond_description':          f.description = c.value; break;
      case 'cond_description_contains': f.description_contains = c.value; break;
      case 'cond_zone':                  f.zone = c.value; break;
    }
  });
  return Object.keys(f).length > 0 ? f : null;
}

// フィルタオブジェクト（step.filter / step.from_filter）→ ConditionPair[]（buildFilterObject の逆変換）
function parseFilterObject(f: any): ConditionPair[] {
  if (!f || typeof f !== 'object') return [];
  const out: ConditionPair[] = [];
  if (f.color)            out.push({ base: 'cond_color',            value: String(f.color) });
  if (Array.isArray(f.type_in) && f.type_in.length > 0) {
    out.push({ base: 'cond_type', value: f.type_in.join(',') });
  } else if (f.type) {
    out.push({ base: 'cond_type', value: String(f.type) });
  }
  if (Array.isArray(f.feature_includes) && f.feature_includes.length > 0) {
    out.push({ base: 'cond_feature_contains', value: f.feature_includes.join(',') });
  } else if (f.feature_contains) {
    out.push({ base: 'cond_feature_contains', value: String(f.feature_contains) });
  }
  if (f.name)             out.push({ base: 'cond_name',             value: String(f.name) });
  if (f.name_contains)    out.push({ base: 'cond_name_contains',    value: String(f.name_contains) });
  if (f.description)          out.push({ base: 'cond_description',          value: String(f.description) });
  if (f.description_contains) out.push({ base: 'cond_description_contains', value: String(f.description_contains) });
  if (f.zone)                 out.push({ base: 'cond_zone',                 value: String(f.zone) });
  if (f.lv_le !== undefined && f.lv_ge !== undefined && f.lv_le === f.lv_ge) {
    out.push({ base: 'cond_lv', value: String(f.lv_le) });
  } else {
    if (f.lv_le !== undefined) out.push({ base: 'cond_lv_le', value: String(f.lv_le) });
    if (f.lv_ge !== undefined) out.push({ base: 'cond_lv_ge', value: String(f.lv_ge) });
  }
  if (f.cost_le !== undefined && f.cost_ge !== undefined && f.cost_le === f.cost_ge) {
    out.push({ base: 'cond_cost', value: String(f.cost_le) });
  } else {
    if (f.cost_le !== undefined) out.push({ base: 'cond_cost_le', value: String(f.cost_le) });
    if (f.cost_ge !== undefined) out.push({ base: 'cond_cost_ge', value: String(f.cost_ge) });
  }
  if (f.dp_le !== undefined && f.dp_ge !== undefined && f.dp_le === f.dp_ge) {
    out.push({ base: 'cond_dp', value: String(f.dp_le) });
  } else {
    if (f.dp_le !== undefined) out.push({ base: 'cond_dp_le', value: String(f.dp_le) });
    if (f.dp_ge !== undefined) out.push({ base: 'cond_dp_ge', value: String(f.dp_ge) });
  }
  if (f.dp_extreme === 'highest') out.push({ base: 'cond_dp_highest' });
  else if (f.dp_extreme === 'lowest') out.push({ base: 'cond_dp_lowest' });
  return out;
}

// keywordDict は「対象」(hasNamedParam) 付きキーワードの絞り込み条件(designated)を
// 組み立てるために使う（passive:[{flag,value,designated}] / grant_keyword等のstep.designated）。
// レシピテンプレートの中身自体はカードのJSONにはベタ展開しない＝常にコード参照のみを
// 保存する。実際の展開はゲームエンジン側がキーワード辞書を実行時に見に行って行う
export function blocksToRecipe(blocks: EffectBlock[], keywordDict?: DictEntry[]): Record<string, any> {
  const recipe: Record<string, any> = {};
  blocks.forEach((b) => {
    // セキュリティ効果はトリガー入力不要（常に 'security' キーに出力される）。
    // トリガー未入力を理由に他セクションと同様スキップされてしまわないよう先に処理する。
    if (b.section === 'security') {
      appendStep(recipe, { ...b, trigger: 'security' }, keywordDict);
      return;
    }
    // トリガー複数選択: 「登場時/進化時どちらでも同じ効果」のように、複数トリガーで
    // 同一内容のstepを発動する場合。冗長な重複出力を避けるため、"on_move,on_play"の
    // ようにカンマ区切りの1キーへまとめて出力する（エンジン側は_lookupTriggerStepsで
    // カンマ区切りキーも解決できる。1件のみなら従来通り単一トリガーコードのまま）。
    // 'passive'（キーワードのパッシブ宣言）は常に単一選択のため、まとめ対象にはならない
    const triggerList = (b.triggers && b.triggers.length > 0) ? b.triggers : (b.trigger ? [b.trigger] : []);
    if (triggerList.length > 0) {
      const combinedTrig = triggerList.join(',');
      if (b.section === 'evo_source') {
        recipe.evo_source = recipe.evo_source || {};
        appendStep(recipe.evo_source, { ...b, trigger: combinedTrig }, keywordDict);
      } else if (b.section === 'link') {
        // リンク効果は進化元効果と同じ構造（during_own_turn等のトリガーでネスト）。
        // 「リンクしている間」という状態はcard.linkedCardsで表現されるため、
        // トリガー自体は進化元と同様に発動タイミングの指定として使う
        recipe.link = recipe.link || {};
        appendStep(recipe.link, { ...b, trigger: combinedTrig }, keywordDict);
      } else {
        appendStep(recipe, { ...b, trigger: combinedTrig }, keywordDict);
      }
    }
  });
  return recipe;
}

// ConditionPair[]（+AND/OR）から、条件一式のJSONフィールド（condition/when/
// extra_conditions/condition_op）を組み立てる（appendStepの発動条件serializeと同じ規則）
function buildDesignatedConditionFields(conds: ConditionPair[], op: 'and' | 'or'): {
  condition?: string; when?: string; extra_conditions?: string[]; condition_op?: 'or';
} {
  const valid = (conds || []).filter((p) => p.base);
  const out: { condition?: string; when?: string; extra_conditions?: string[]; condition_op?: 'or' } = {};
  if (valid.length >= 1) out.condition = pairToString(valid[0]);
  if (valid.length >= 2) out.when = pairToString(valid[1]);
  if (valid.length >= 3) out.extra_conditions = valid.slice(2).map(pairToString);
  if (valid.length >= 2 && op === 'or') out.condition_op = 'or';
  return out;
}

// designated（{condition, when, extra_conditions, condition_op}）→ ConditionPair[]+AND/OR
// buildDesignatedConditionFields の逆変換（パッシブキーワードの「対象」欄をカード編集画面で
// 再度開いた時に、保存済みの絞り込み条件をUIへ復元するために使う）
function parseDesignatedFields(d: any): { conds: ConditionPair[]; op: 'and' | 'or' } {
  const conds: ConditionPair[] = [];
  if (d?.condition) conds.push(stringToPair(String(d.condition)));
  if (d?.when) conds.push(stringToPair(String(d.when)));
  if (Array.isArray(d?.extra_conditions)) {
    d.extra_conditions.forEach((s: string) => conds.push(stringToPair(String(s))));
  }
  return { conds, op: d?.condition_op === 'or' ? 'or' : 'and' };
}

// ブロックが持つキーワードの一覧を返す（パッシブ/キーワード付与 共通）。
// keywordEntries（複数選択UI）があればそちらを優先し、無ければ従来の単一
// keyword/value/keywordParamConditions* から1件だけのリストを合成する（後方互換）
export function getKeywordEntries(b: {
  keyword?: string;
  value?: number | string;
  keywordParamConditions?: ConditionPair[];
  keywordParamConditionsOp?: 'and' | 'or';
  keywordCount?: number | string;
  keywordDesignatedGroups?: DesignatedGroup[];
  keywordEntries?: KeywordEntry[];
}): KeywordEntry[] {
  if (Array.isArray(b.keywordEntries) && b.keywordEntries.length > 0) return b.keywordEntries;
  if (b.keyword) {
    return [{
      keyword: b.keyword,
      value: b.value,
      keywordParamConditions: b.keywordParamConditions,
      keywordParamConditionsOp: b.keywordParamConditionsOp,
      count: b.keywordCount,
      designatedGroups: b.keywordDesignatedGroups,
    }];
  }
  return [];
}

// entry の「対象」絞り込み条件＋枚数を、常に1組以上のグループ配列として返す。
// designatedGroups があればそのまま、無ければ従来の単一 keywordParamConditions/count
// から1組だけのグループを合成する（後方互換）
export function getDesignatedGroups(entry: KeywordEntry): DesignatedGroup[] {
  if (Array.isArray(entry.designatedGroups) && entry.designatedGroups.length > 0) return entry.designatedGroups;
  if (Array.isArray(entry.keywordParamConditions) && entry.keywordParamConditions.length > 0) {
    return [{
      conditions: entry.keywordParamConditions,
      conditionsOp: entry.keywordParamConditionsOp || 'and',
      count: entry.count,
    }];
  }
  return [];
}

// DesignatedGroup[] → JSON出力用の配列（各要素が {condition?,when?,extra_conditions?,
// condition_op?,count?}）。1組だけなら呼び出し側で従来のdesignated/countとして
// 単純出力し、2組以上のときだけこの配列(p.designated_groups)を使う
function buildDesignatedGroupsFields(groups: DesignatedGroup[]): Array<{
  condition?: string; when?: string; extra_conditions?: string[]; condition_op?: 'or'; count?: number | string; distinct_names?: true;
}> {
  return groups.map((g) => {
    const fields = buildDesignatedConditionFields(g.conditions, g.conditionsOp || 'and');
    const out: any = { ...fields };
    if (g.count !== undefined && g.count !== '' && g.count !== null) {
      const n = Number(g.count);
      out.count = isNaN(n) ? g.count : n;
    }
    if (g.distinctNames) out.distinct_names = true;
    return out;
  });
}

// entry の「対象」絞り込み条件＋枚数を target（passiveのp、またはgrant_keywordのstep）へ
// 書き込む。1組なら designated/count、2組以上なら designated_groups として出力する
function applyDesignatedGroupsTo(target: any, entry: KeywordEntry, kwEntry?: DictEntry): void {
  if (!kwEntry?.hasNamedParam) return;
  const groups = getDesignatedGroups(entry);
  if (groups.length === 1) {
    const fields = buildDesignatedGroupsFields(groups)[0];
    const { count: gCount, ...designated } = fields;
    if (Object.keys(designated).length > 0) target.designated = designated;
    if (gCount !== undefined) target.count = gCount;
  } else if (groups.length > 1) {
    target.designated_groups = buildDesignatedGroupsFields(groups);
  }
}

function appendStep(container: Record<string, any>, b: EffectBlock, keywordDict?: DictEntry[]) {
  if (b.trigger === 'passive') {
    // キーワードのレシピテンプレートはカードのJSONにはベタ展開しない（コード参照のみ保存）。
    // 実際の展開（value/対象の差し込み含む）はゲームエンジン側が、キーワード辞書
    // （スプシ「効果辞書」→cards.json同梱のkeywords）を実行時に見に行って行う。
    // こうすることでキーワードのレシピを後から直しても、そのキーワードを使う全カードに
    // 再保存なしで反映される（カード側は常に flag 参照のみを持つ）
    // 複数キーワード選択時（進化元効果で【貫通】【分離】を両方常に持つ等）は、
    // 1ブロックから複数のpassiveエントリを出力する（エンジン側は元々配列を
    // 独立にスキャンするので、1ブロック由来かN個のブロック由来かは区別しない）
    container.passive = container.passive || [];
    getKeywordEntries(b).filter((entry) => entry.keyword).forEach((entry) => {
      const kwEntry = keywordDict && entry.keyword ? keywordDict.find((k) => k.code === entry.keyword) : undefined;
      const p: any = { flag: entry.keyword };
      // 値 (例: 【Sアタック+2】 の "2"): 数値化できれば number、そうでなければそのまま
      if (entry.value !== undefined && entry.value !== '' && entry.value !== null) {
        const n = Number(entry.value);
        p.value = isNaN(n) ? entry.value : n;
      }
      // 「対象」絞り込み条件（＋枚数）: テンプレート内の cond_designated_name
      // プレースホルダーをエンジン側が実行時に置き換えるための材料。ここでは組み立てた
      // 条件一式を designated（1組）/designated_groups（2組以上）として保存するだけで、
      // 置き換え自体は行わない
      applyDesignatedGroupsTo(p, entry, kwEntry);
      if (b.zone) p.in_zone = b.zone;
      if (b.extras) {
        try {
          const ex = JSON.parse(b.extras);
          Object.keys(ex).forEach((k) => (p[k] = ex[k]));
        } catch (_) {}
      }
      container.passive.push(p);
    });
    return;
  }
  const step: any = {};

  // 「デジモン/テイマー/オプションどちらの効果か」は編集時（このエディタ内）だけのメモ書きで、
  // エンジンは参照しないため意図的にJSON出力しない（block.asTypeとしてエディタ内では保持され続ける）

  // 条件: 1つ目→condition, 2つ目→when, 3つ目以降→extra_conditions[]
  const validConds = (b.conditions || []).filter((p) => p.base);
  if (validConds.length >= 1) step.condition = pairToString(validConds[0]);
  if (validConds.length >= 2) step.when = pairToString(validConds[1]);
  if (validConds.length >= 3) step.extra_conditions = validConds.slice(2).map(pairToString);
  if (validConds.length >= 2 && b.conditionsOp === 'or') step.condition_op = 'or';

  // トリガー条件: 配列で出力 (step.trigger_conditions[])
  // エンジンは「トリガー発火元のカード」に対してこれらの条件を AND 評価する想定
  const validTriggerConds = (b.triggerConditions || []).filter((p) => p.base);
  if (validTriggerConds.length > 0) step.trigger_conditions = validTriggerConds.map(pairToString);

  // コスト
  const validCosts = (b.costs || []).filter((c) => c.action);
  if (validCosts.length > 0) {
    step.cost = validCosts.map((c) => {
      const cs: any = { action: c.action };
      if (c.value !== undefined && c.value !== '' && c.value !== null) {
        const n = Number(c.value);
        cs.value = isNaN(n) ? c.value : n;
      }
      if (c.target) cs.target = c.target;
      // 上/下（デッキに戻す/セキュリティに置く用）。'both'（どちらか選んで）はエンジン未対応の
      // ため 'select' として出力する（return_deck は 'top' 以外を全て「下」、
      // place_on_security_top は現状常に「上」として扱うので注意）
      if (c.deckPosition === 'top') cs.position = 'top';
      else if (c.deckPosition === 'bottom') cs.position = 'bottom';
      else if (c.deckPosition === 'both') cs.position = 'select';
      // 修飾子（'face_down' 等）
      if (Array.isArray(c.options) && c.options.length > 0) cs.options = c.options.slice();
      // コスト対象の取得元エリア (1件→string / 2件以上→array + from_op)
      if (Array.isArray(c.fromZones) && c.fromZones.length > 0) {
        const cz = c.fromZones.filter((z) => !!z);
        if (cz.length === 1) {
          cs.from = cz[0];
        } else if (cz.length > 1) {
          cs.from = cz;
          if (c.fromZonesOp && c.fromZonesOp !== 'or') cs.from_op = c.fromZonesOp;
        }
      }
      // コスト対象への絞り込み条件: condition / when / extra_conditions として直列化
      const validCondPairs = (c.conditions || []).filter((p) => p.base);
      if (validCondPairs.length >= 1) cs.condition = pairToString(validCondPairs[0]);
      if (validCondPairs.length >= 2) cs.when = pairToString(validCondPairs[1]);
      if (validCondPairs.length >= 3) cs.extra_conditions = validCondPairs.slice(2).map(pairToString);
      if (validCondPairs.length >= 2 && c.conditionsOp === 'or') cs.condition_op = 'or';
      return cs;
    });
  }

  if (b.duration) step.duration = b.duration;
  if (b.action) step.action = b.action;
  // '-'/'+' は💰コスト増減UIの「符号だけ決めて数値は空欄」プレースホルダー
  // （キーワードのレシピテンプレート登録時用）。実際の数値ではないため出力しない
  if (b.value !== undefined && b.value !== '' && b.value !== null && b.value !== '-' && b.value !== '+') {
    const v = Number(b.value);
    step.value = isNaN(v) ? b.value : v;
  }
  if (b.target) step.target = b.target;
  if (b.keyword) step.keyword = b.keyword;
  // memory_plus の「このターン終了時メモリー-N」フラグ
  if (b.revertAtTurnEnd) step.revert_at_turn_end = true;
  // immune_effects 専用:「相手の効果を受けない」の対象範囲。
  // 省略(既定) = 相手の効果全て（デジモン/テイマー/オプション問わず）
  // 'digimon' = 相手の「デジモン」の効果のみ（テイマー/オプションは対象外）
  if (b.action === 'immune_effects' && b.immuneCardType === 'digimon') step.source_type = 'digimon';
  // summon の「コストを支払わずに登場」フラグ
  if (b.costFree) step.cost_free = true;
  // summon_from_trash の「登場したデジモンの【登場時】効果は発揮しない」フラグ
  if (b.skipOnPlay) step.skip_on_play = true;
  // 上/下（デッキに戻す位置等・hasDeckPosition用）。'both'（どちらか選んで）はエンジン未対応の
  // ため 'select' として出力する（エンジンは 'top' 以外を全て「下」として扱うので注意）
  if (b.deckPosition === 'top') step.position = 'top';
  else if (b.deckPosition === 'bottom') step.position = 'bottom';
  else if (b.deckPosition === 'both') step.position = 'select';
  // 「〜できる」任意効果フラグ
  if (b.optional) step.optional = true;
  // 効果発動ポップアップの表示テキスト明示指定 / 非表示フラグ
  if (b.displayText && b.displayText.trim()) step.display_text = b.displayText.trim();
  if (b.noAnnounce) step.no_announce = true;
  // 演出の枠色・演出タイプの明示指定（空欄ならエンジン側の自動推測にフォールバック）
  if (b.frameColor && b.frameColor.trim()) step.frame_color = b.frameColor.trim();
  if (b.visualType && b.visualType.trim()) step.visual_type = b.visualType.trim();
  // 取得元エリア (fromZones[]) の serialize:
  //   1件のみ → 'hand' のような文字列
  //   2件以上 → 配列 + (op が 'and' の時のみ) step.from_op
  if (Array.isArray(b.fromZones) && b.fromZones.length > 0) {
    const zones = b.fromZones.filter((z) => !!z);
    if (zones.length === 1) {
      step.from = zones[0];
    } else if (zones.length > 1) {
      step.from = zones;
      if (b.fromZonesOp && b.fromZonesOp !== 'or') step.from_op = b.fromZonesOp;
    }
    // 場所に「進化元」を含む場合のみ: どのデジモンの進化元から探すか
    // ('self'=このデジモン / 'other'=他のデジモン。未指定='指定なし'=絞り込まない)
    if (zones.includes('evo_source') && (b.evoSourceOwner === 'self' || b.evoSourceOwner === 'other')) {
      step.evo_source_owner = b.evoSourceOwner;
    }
  }
  if (b.options && b.options.length > 0) step.options = b.options.slice();
  // 「～ごとに」倍率設定の serialize
  if (b.perCount !== undefined && b.perCount !== null && Number(b.perCount) > 0 && b.perRef) {
    step.per_count = Number(b.perCount);
    if (b.perCountMode === 'repeat') step.per_count_mode = 'repeat';
    step.ref = b.perRef;
    // 状態 cond を ref_state に変換
    if (b.perRefStateCond && b.perRefStateCond.base) {
      step.ref_state = b.perRefStateCond.value
        ? b.perRefStateCond.base + ':' + b.perRefStateCond.value
        : b.perRefStateCond.base;
    }
    // perRefFilter (ConditionPair[]) を filter オブジェクトに変換
    if (Array.isArray(b.perRefFilter) && b.perRefFilter.length > 0) {
      const filter: Record<string, any> = {};
      b.perRefFilter.forEach((c) => {
        if (!c || !c.base || !c.value) return;
        const num = (v: any) => { const n = parseInt(String(v), 10); return isNaN(n) ? undefined : n; };
        switch (c.base) {
          case 'cond_color':            filter.color = c.value; break;
          case 'cond_type':             filter.type = c.value; break;
          case 'cond_feature_contains': filter.feature_contains = c.value; break;
          case 'cond_name':             filter.name = c.value; break;
          case 'cond_name_contains':    filter.name_contains = c.value; break;
          case 'cond_lv':       { const n = num(c.value); if (n !== undefined) { filter.lv_le = n; filter.lv_ge = n; } break; }
          case 'cond_lv_le':    { const n = num(c.value); if (n !== undefined) filter.lv_le = n; break; }
          case 'cond_lv_ge':    { const n = num(c.value); if (n !== undefined) filter.lv_ge = n; break; }
          case 'cond_dp':       { const n = num(c.value); if (n !== undefined) { filter.dp_le = n; filter.dp_ge = n; } break; }
          case 'cond_dp_le':    { const n = num(c.value); if (n !== undefined) filter.dp_le = n; break; }
          case 'cond_dp_ge':    { const n = num(c.value); if (n !== undefined) filter.dp_ge = n; break; }
          case 'cond_cost':     { const n = num(c.value); if (n !== undefined) { filter.cost_le = n; filter.cost_ge = n; } break; }
          case 'cond_cost_le':  { const n = num(c.value); if (n !== undefined) filter.cost_le = n; break; }
          case 'cond_cost_ge':  { const n = num(c.value); if (n !== undefined) filter.cost_ge = n; break; }
          // メモリーは ref_filter 文脈では意味を成さないので無視
        }
      });
      if (Object.keys(filter).length > 0) step.ref_filter = filter;
    }
  }
  // === 代替アクション (alt_actions[]) ===
  // 'or'/'and' = 「〇〇するか〇〇する」「〇〇する＆〇〇する」を表現する同ステップ内代替アクション群。
  // 'then' = 「その後」連結。同じstep内には入れず、同じトリガー配列内の独立した後続stepとして
  // 出力する（公式ルールの「その後」はcontinue_on_fail修飾子を持つ次stepとして実装されているため）
  if (Array.isArray(b.altActions) && b.altActions.length > 0 && b.altActionsOp !== 'then') {
    step.alt_actions = b.altActions.filter((a) => a && a.action).map(altActionToStepObject);
    if (step.alt_actions.length > 0) {
      step.alt_actions_op = b.altActionsOp || 'or';
    }
  }
  // === targetFilter → step.filter（対象自身の絞り込み。例:レスト状態のこのデジモン） ===
  const targetFilterObj = buildFilterObject(b.targetFilter);
  if (targetFilterObj) step.filter = targetFilterObj;
  // === fromFilter → step.from_filter（進化/登場アクション専用。取得元エリアから選ぶ
  // カードの絞り込み。対象＝このカード自身の条件(filter)とは別データ） ===
  const fromFilterObj = buildFilterObject(b.fromFilter);
  if (fromFilterObj) step.from_filter = fromFilterObj;
  // === 付与効果 (granted_recipe) ===
  // 対象に一時的にトリガー効果を付与（grant_effect 等で使用）
  if (b.grantedStep && b.grantedStep.trigger && b.grantedStep.action) {
    const gs = b.grantedStep;
    const inner: any = { action: gs.action };
    if (gs.value !== undefined && gs.value !== '' && gs.value !== null) {
      const n = Number(gs.value);
      inner.value = isNaN(n) ? gs.value : n;
    }
    if (gs.target) inner.target = gs.target;
    if (gs.duration) inner.duration = gs.duration;
    const validG = (gs.conditions || []).filter((p) => p.base);
    if (validG.length >= 1) inner.condition = pairToString(validG[0]);
    if (validG.length >= 2) inner.when = pairToString(validG[1]);
    if (validG.length >= 3) inner.extra_conditions = validG.slice(2).map(pairToString);
    if (Array.isArray(gs.options) && gs.options.length > 0) inner.options = gs.options.slice();
    step.granted_recipe = { [gs.trigger]: [inner] };
  }
  // === ルール (MiniStep[]) を翻訳して step に展開 ===
  // メインアクション毎の翻訳器が selections[] / return_to / options[] 等の既存フィールドへ展開
  if (b.action) applyRulesToStep(b.action, b.rules, step);
  if (b.zone) step.in_zone = b.zone;
  if (b.limit) step.limit = b.limit;
  // subject='self' はデフォルトなのでJSONに含めない（既存レシピと互換）
  if (b.triggerSubject && b.triggerSubject !== 'self') step.subject = b.triggerSubject;
  if (b.extras) {
    try {
      const ex = JSON.parse(b.extras);
      Object.keys(ex).forEach((k) => (step[k] = ex[k]));
    } catch (_) {}
  }
  // === grant_keyword(_to) で「対象」絞り込み条件を持つキーワードを選んでいれば、
  // その条件一式を designated として添える（置き換え自体はエンジン側が実行時に、
  // キーワード辞書のレシピテンプレートを見に行った時点で行う。カードのJSONには
  // キーワードのコード参照のみを保存し、レシピ本体はベタ展開しない） ===
  const isGrantKeyword = step.action === 'grant_keyword' || step.action === 'grant_keyword_to';
  if (isGrantKeyword && b.keyword) {
    const kwEntry = keywordDict && keywordDict.find((k) => k.code === b.keyword);
    applyDesignatedGroupsTo(step, {
      keyword: b.keyword,
      keywordParamConditions: b.keywordParamConditions,
      keywordParamConditionsOp: b.keywordParamConditionsOp,
      count: b.keywordCount,
      designatedGroups: b.keywordDesignatedGroups,
    }, kwEntry);
  }
  container[b.trigger] = container[b.trigger] || [];
  container[b.trigger].push(step);

  // 複数キーワード選択時（1ブロックで複数キーワードを同時付与）: 2件目以降は
  // 同じ効果ステップの内容を引き継いだ独立stepとして同じtrigger配列に追加する。
  // 元のtargetが「N体選択」系（own:N / opponent:N / up_to）なら、2件目以降は
  // target:'same_target' にして1件目で選んだのと同じ対象へ自動適用する（対象選択
  // UIが人数分出てしまうのを防ぐ。エンジンの同一対象連続適用の仕組みを流用）
  if (isGrantKeyword) {
    const entries = getKeywordEntries(b).filter((entry) => entry.keyword);
    if (entries.length > 1) {
      // 「N体まで/2体等」の複数対象選択は _lastPickedCard が最後の1体しか
      // 覚えていないため same_target 化の対象外（安全側に倒し、2件目以降も独立して
      // 対象選択させる）。ちょうど1体選択（own:1/opponent:1）の時だけ同一対象化する
      const isSinglePickTarget = /^(own|opponent):1$/.test(String(b.target || ''));
      entries.slice(1).forEach((entry) => {
        const extraStep: any = { ...step, keyword: entry.keyword };
        delete extraStep.designated;
        delete extraStep.designated_groups;
        delete extraStep.count;
        if (entry.value !== undefined && entry.value !== '' && entry.value !== null) {
          const n = Number(entry.value);
          extraStep.value = isNaN(n) ? entry.value : n;
        } else {
          delete extraStep.value;
        }
        const kwEntry2 = keywordDict && keywordDict.find((k) => k.code === entry.keyword);
        applyDesignatedGroupsTo(extraStep, entry, kwEntry2);
        if (isSinglePickTarget) extraStep.target = 'same_target';
        container[b.trigger].push(extraStep);
      });
    }
  }

  // 'then'（その後）モードのalt_actionsは、同じトリガー配列内の独立した後続stepとして
  // 続けて出力する。各stepにはcontinue_on_fail修飾子を自動付与し（前段が不発でも継続する
  // ＝「その後」の公式ルール表現）、limitを個別指定していなければ本体stepのlimitを
  // 引き継ぐ（「ターンに1回」等がこの一連の効果全体に掛かるようにするため）
  if (b.altActionsOp === 'then' && Array.isArray(b.altActions) && b.altActions.length > 0) {
    b.altActions.filter((a) => a && a.action).forEach((a) => {
      const thenStep = altActionToStepObject(a);
      const opts: string[] = Array.isArray(thenStep.options) ? thenStep.options.slice() : [];
      if (!opts.includes('continue_on_fail')) opts.push('continue_on_fail');
      thenStep.options = opts;
      if (thenStep.limit === undefined && b.limit) thenStep.limit = b.limit;
      container[b.trigger].push(thenStep);
    });
  }
}

// 「base:value@subject」形式を ConditionPair に分解
function stringToPair(s: string): ConditionPair {
  // @subject 部分を分離
  const atIdx = s.lastIndexOf('@');
  let main = s;
  let subject: string | undefined;
  if (atIdx >= 0) {
    subject = s.substring(atIdx + 1);
    main = s.substring(0, atIdx);
  }
  const i = main.indexOf(':');
  const pair: ConditionPair = i < 0
    ? { base: main }
    : { base: main.substring(0, i), value: main.substring(i + 1) };
  if (subject) pair.subject = subject;
  return pair;
}

// 既存レシピ JSON から EffectBlock[] へ復元
export function recipeToBlocks(recipe: any): EffectBlock[] {
  if (!recipe || typeof recipe !== 'object') return [];
  const blocks: EffectBlock[] = [];

  if (Array.isArray(recipe.passive)) {
    recipe.passive.forEach((p: any) => {
      blocks.push(passiveToBlock('main', p));
    });
  }
  Object.keys(recipe).forEach((k) => {
    if (k === 'evo_source' || k === 'link' || k === 'passive') return;
    const arr = recipe[k];
    if (!Array.isArray(arr)) return;
    if (k === 'security') {
      blocks.push(...stepsArrayToBlocks('security', 'security', arr));
    } else {
      blocks.push(...stepsArrayToBlocks('main', k, arr));
    }
  });
  if (recipe.evo_source && typeof recipe.evo_source === 'object') {
    if (Array.isArray(recipe.evo_source.passive)) {
      recipe.evo_source.passive.forEach((p: any) => {
        blocks.push(passiveToBlock('evo_source', p));
      });
    }
    Object.keys(recipe.evo_source).forEach((k) => {
      if (k === 'passive') return;
      const arr = recipe.evo_source[k];
      if (!Array.isArray(arr)) return;
      blocks.push(...stepsArrayToBlocks('evo_source', k, arr));
    });
  }
  // リンク効果（進化元効果と同じ、トリガーでネストされた構造）
  if (recipe.link && typeof recipe.link === 'object' && !Array.isArray(recipe.link)) {
    if (Array.isArray(recipe.link.passive)) {
      recipe.link.passive.forEach((p: any) => {
        blocks.push(passiveToBlock('link', p));
      });
    }
    Object.keys(recipe.link).forEach((k) => {
      if (k === 'passive') return;
      const arr = recipe.link[k];
      if (!Array.isArray(arr)) return;
      blocks.push(...stepsArrayToBlocks('link', k, arr));
    });
  }
  return blocks;
}

// 1つのトリガー配列を EffectBlock[] に変換する。配列内で continue_on_fail 修飾子を
// 持つstepは「その後」連結として直前のブロックへ altActions(op:'then') で吸収し、
// 独立したブロックにはしない（blocksToRecipeの'then'出力の逆変換）
function stepsArrayToBlocks(section: 'main' | 'evo_source' | 'security' | 'link', triggerKey: string, arr: any[]): EffectBlock[] {
  const blocks: EffectBlock[] = [];
  arr.forEach((step: any) => {
    const isChainStep = Array.isArray(step?.options) && step.options.includes('continue_on_fail');
    if (isChainStep && blocks.length > 0) {
      const prev = blocks[blocks.length - 1];
      prev.altActions = [...(prev.altActions || []), stepObjectToAltAction(step)];
      prev.altActionsOp = 'then';
      return;
    }
    blocks.push(stepToBlock(section, triggerKey, step));
  });
  return blocks;
}

// レシピJSONのstepオブジェクト（'then'連結の後続要素）を AltAction に変換する
// （altActionToStepObjectの逆変換。continue_on_failは'then'モードで暗黙付与されるため、
// UI上のoptions一覧には出さないよう除去する）
function stepObjectToAltAction(step: any): AltAction {
  const conditions: ConditionPair[] = [];
  if (step?.condition) conditions.push(stringToPair(String(step.condition)));
  if (step?.when) conditions.push(stringToPair(String(step.when)));
  if (Array.isArray(step?.extra_conditions)) {
    step.extra_conditions.forEach((s: string) => conditions.push(stringToPair(String(s))));
  }
  const gateConditions: ConditionPair[] = [];
  if (step?.gate) gateConditions.push(stringToPair(String(step.gate)));
  if (step?.gate_when) gateConditions.push(stringToPair(String(step.gate_when)));
  if (Array.isArray(step?.gate_extra_conditions)) {
    step.gate_extra_conditions.forEach((s: string) => gateConditions.push(stringToPair(String(s))));
  }
  const fromZones: string[] = (() => {
    const f = step?.from;
    if (!f) return [];
    if (Array.isArray(f)) return f.slice();
    const s = String(f);
    if (s.includes('_or_')) return s.split('_or_');
    return [s];
  })();
  const options = Array.isArray(step?.options)
    ? step.options.filter((o: string) => o !== 'continue_on_fail')
    : [];
  return {
    action: step?.action || '',
    value: step?.value,
    target: step?.target || '',
    gateConditions,
    conditions,
    conditionsOp: step?.condition_op === 'or' ? 'or' : 'and',
    options,
    fromZones,
    fromZonesOp: step?.from_op === 'and' ? 'and' : 'or',
    deckPosition: step?.position === 'top' ? 'top'
      : step?.position === 'bottom' ? 'bottom'
      : step?.position === 'select' ? 'both'
      : undefined,
    duration: step?.duration || '',
    perCount: step?.per_count != null ? Number(step.per_count) : undefined,
    perRef: step?.ref || '',
    perCountMode: step?.per_count_mode === 'repeat' ? 'repeat' : undefined,
    perRefFilter: [],
  };
}

// designated（1組）/designated_groups（2組以上）のどちらで保存されていても、
// 常に DesignatedGroup[] として読み出す（passiveToBlock/stepToBlock共通の復元ロジック）
function parseDesignatedGroupsField(raw: any): DesignatedGroup[] {
  if (Array.isArray(raw?.designated_groups) && raw.designated_groups.length > 0) {
    return raw.designated_groups.map((g: any) => {
      const { conds, op } = parseDesignatedFields(g);
      return { conditions: conds, conditionsOp: op, count: g?.count, distinctNames: g?.distinct_names === true };
    });
  }
  if (raw?.designated || raw?.count !== undefined) {
    const { conds, op } = raw?.designated ? parseDesignatedFields(raw.designated) : { conds: [], op: 'and' as const };
    if (conds.length === 0 && raw?.count === undefined) return [];
    return [{ conditions: conds, conditionsOp: op, count: raw?.count, distinctNames: raw?.designated?.distinct_names === true }];
  }
  return [];
}

function passiveToBlock(section: 'main' | 'evo_source' | 'link', p: any): EffectBlock {
  const extras: any = {};
  Object.keys(p || {}).forEach((k) => {
    if (k !== 'flag' && k !== 'in_zone' && k !== 'value' && k !== 'designated' && k !== 'designated_groups' && k !== 'count') extras[k] = p[k];
  });
  const groups = parseDesignatedGroupsField(p);
  const single = groups.length === 1 ? groups[0] : undefined;
  return {
    section,
    zone: p?.in_zone || '',
    trigger: 'passive',
    keyword: (p && p.flag) || '',
    value: p?.value,
    keywordParamConditions: single && single.conditions.length > 0 ? single.conditions : undefined,
    keywordParamConditionsOp: single && single.conditions.length > 0 ? single.conditionsOp : undefined,
    keywordCount: single ? single.count : undefined,
    keywordDesignatedGroups: groups.length > 1 ? groups : undefined,
    extras: Object.keys(extras).length > 0 ? JSON.stringify(extras) : '',
  };
}

function stepToBlock(section: 'main' | 'evo_source' | 'security' | 'link', trigger: string, step: any): EffectBlock {
  // "on_move,on_play" のようなカンマ区切りの複数トリガーまとめキーを、
  // トリガー複数選択(triggers[])として復元する（blocksToRecipeの出力の逆変換）
  const triggerParts = trigger.split(',').map((t) => t.trim()).filter(Boolean);
  const primaryTrigger = triggerParts[0] || trigger;
  const KNOWN: Record<string, boolean> = {
    as_type: true,
    action: true,
    condition: true,
    condition_op: true,
    when: true,
    extra_conditions: true,
    trigger_conditions: true,
    duration: true,
    target: true,
    value: true,
    keyword: true,
    revert_at_turn_end: true,
    source_type: true,
    cost_free: true,
    skip_on_play: true,
    optional: true,
    display_text: true,
    no_announce: true,
    frame_color: true,
    visual_type: true,
    options: true,
    limit: true,
    in_zone: true,
    subject: true,
    cost: true,
    from: true,
    from_op: true,
    per_count: true,
    ref: true,
    ref_state: true,
    ref_filter: true,
    alt_actions: true,
    alt_actions_op: true,
    granted_recipe: true,
    filter: true,
    designated: true,
    designated_groups: true,
  };
  const extras: any = {};
  Object.keys(step || {}).forEach((k) => {
    if (!KNOWN[k]) extras[k] = step[k];
  });
  // grant_keyword(_to) の count（アセンブリ等の枚数）だけ専用フィールドへ復元する。
  // count は他の複数アクション（N枚引く/選ぶ等）でも使われる汎用フィールドのため、
  // grant_keyword以外はそのままextrasに残す（値を消さない）
  const _isGrantKeywordStep = step?.action === 'grant_keyword' || step?.action === 'grant_keyword_to';
  const _stepCount = _isGrantKeywordStep && extras.count !== undefined ? extras.count : undefined;
  if (_isGrantKeywordStep && extras.count !== undefined) delete extras.count;
  const _stepDesignatedGroups = _isGrantKeywordStep ? parseDesignatedGroupsField(step) : [];
  const _stepSingleGroup = _stepDesignatedGroups.length === 1 ? _stepDesignatedGroups[0] : undefined;
  // 条件復元
  const conditions: ConditionPair[] = [];
  if (step?.condition) conditions.push(stringToPair(String(step.condition)));
  if (step?.when) conditions.push(stringToPair(String(step.when)));
  if (Array.isArray(step?.extra_conditions)) {
    step.extra_conditions.forEach((s: string) => conditions.push(stringToPair(String(s))));
  }
  // トリガー条件復元
  const triggerConditions: ConditionPair[] = [];
  if (Array.isArray(step?.trigger_conditions)) {
    step.trigger_conditions.forEach((s: string) => triggerConditions.push(stringToPair(String(s))));
  }
  // コスト復元 (condition / when / extra_conditions を ConditionPair[] へ統合)
  const costs = Array.isArray(step?.cost)
    ? step.cost.map((c: any) => {
        const condArr: ConditionPair[] = [];
        if (c?.condition) condArr.push(stringToPair(String(c.condition)));
        if (c?.when) condArr.push(stringToPair(String(c.when)));
        if (Array.isArray(c?.extra_conditions)) {
          c.extra_conditions.forEach((s: string) => condArr.push(stringToPair(String(s))));
        }
        // 取得元エリアの deserialize: string / array / 旧 'hand_or_trash' 互換
        const fromZones: string[] = (() => {
          const f = c?.from;
          if (!f) return [];
          if (Array.isArray(f)) return f.slice();
          const s = String(f);
          if (s.includes('_or_')) return s.split('_or_');
          return [s];
        })();
        const fromZonesOp: 'or' | 'and' = c?.from_op === 'and' ? 'and' : 'or';
        const deckPosition: 'top' | 'bottom' | 'both' | undefined = c?.position === 'top' ? 'top'
          : c?.position === 'bottom' ? 'bottom'
          : c?.position === 'select' ? 'both'
          : undefined;
        return {
          action: c?.action || '',
          value: c?.value,
          target: c?.target || '',
          conditions: condArr,
          conditionsOp: c?.condition_op === 'or' ? 'or' as const : 'and' as const,
          fromZones,
          fromZonesOp,
          deckPosition,
          options: Array.isArray(c?.options) ? c.options.slice() : undefined,
        };
      })
    : [];
  return {
    section,
    asType: step?.as_type === 'digimon' || step?.as_type === 'tamer' || step?.as_type === 'option' ? step.as_type : undefined,
    zone: step?.in_zone || '',
    trigger: primaryTrigger,
    triggers: triggerParts.length > 1 ? triggerParts : undefined,
    // JSON に subject 無ければ 'self' (このデジモン) としてロード
    triggerSubject: step?.subject || 'self',
    limit: step?.limit || '',
    triggerConditions,
    conditions,
    conditionsOp: step?.condition_op === 'or' ? 'or' : 'and',
    costs,
    duration: step?.duration || '',
    action: step?.action || '',
    value: step?.value,
    target: step?.target || '',
    keyword: step?.keyword || '',
    keywordCount: _stepSingleGroup ? _stepSingleGroup.count : _stepCount,
    keywordParamConditions: _stepSingleGroup && _stepSingleGroup.conditions.length > 0 ? _stepSingleGroup.conditions : undefined,
    keywordParamConditionsOp: _stepSingleGroup && _stepSingleGroup.conditions.length > 0 ? _stepSingleGroup.conditionsOp : undefined,
    keywordDesignatedGroups: _stepDesignatedGroups.length > 1 ? _stepDesignatedGroups : undefined,
    revertAtTurnEnd: !!step?.revert_at_turn_end,
    immuneCardType: step?.source_type === 'digimon' ? 'digimon' : undefined,
    costFree: !!step?.cost_free,
    skipOnPlay: !!step?.skip_on_play,
    deckPosition: step?.position === 'top' ? 'top'
      : step?.position === 'bottom' ? 'bottom'
      : step?.position === 'select' ? 'both'
      : undefined,
    optional: !!step?.optional,
    displayText: step?.display_text || '',
    noAnnounce: !!step?.no_announce,
    frameColor: step?.frame_color || '',
    visualType: step?.visual_type || '',
    // 取得元エリアの deserialize: 文字列・配列・旧 'hand_or_trash' 形式すべてサポート
    fromZones: (() => {
      const f = step?.from;
      if (!f) return [];
      if (Array.isArray(f)) return f.slice();
      const s = String(f);
      // 旧形式の互換: 'hand_or_trash' → ['hand', 'trash'] 等
      if (s.includes('_or_')) return s.split('_or_');
      return [s];
    })(),
    fromZonesOp: (() => {
      const op = step?.from_op;
      if (op === 'and') return 'and' as const;
      // 旧 'hand_or_trash' 形式から or 推定
      const f = step?.from;
      if (typeof f === 'string' && f.includes('_or_')) return 'or' as const;
      return 'or' as const;
    })(),
    evoSourceOwner: step?.evo_source_owner === 'self' || step?.evo_source_owner === 'other' ? step.evo_source_owner : undefined,
    options: Array.isArray(step?.options) ? step.options.slice() : [],
    perCount: step?.per_count !== undefined && step?.per_count !== null ? Number(step.per_count) : undefined,
    perCountMode: step?.per_count_mode === 'repeat' ? 'repeat' : undefined,
    perRef: step?.ref || '',
    perRefStateCond: (() => {
      const s = step?.ref_state;
      if (!s || typeof s !== 'string') return undefined;
      const i = s.indexOf(':');
      return i >= 0 ? { base: s.substring(0, i), value: s.substring(i + 1) } : { base: s };
    })(),
    perRefFilter: (() => {
      const f = step?.ref_filter;
      if (!f || typeof f !== 'object') return [];
      const out: ConditionPair[] = [];
      if (f.color)            out.push({ base: 'cond_color',            value: String(f.color) });
      if (f.type)             out.push({ base: 'cond_type',             value: String(f.type) });
      if (f.feature_contains) out.push({ base: 'cond_feature_contains', value: String(f.feature_contains) });
      if (f.name_contains)    out.push({ base: 'cond_name_contains',    value: String(f.name_contains) });
      if (f.lv_le !== undefined && f.lv_ge !== undefined && f.lv_le === f.lv_ge) {
        out.push({ base: 'cond_lv', value: String(f.lv_le) });
      } else {
        if (f.lv_le !== undefined) out.push({ base: 'cond_lv_le', value: String(f.lv_le) });
        if (f.lv_ge !== undefined) out.push({ base: 'cond_lv_ge', value: String(f.lv_ge) });
      }
      if (f.dp_le !== undefined) out.push({ base: 'cond_dp_le', value: String(f.dp_le) });
      if (f.dp_ge !== undefined) out.push({ base: 'cond_dp_ge', value: String(f.dp_ge) });
      return out;
    })(),
    rules: [], // 既存レシピ load 時はルール情報が無いので空。エディタで再構築する場合は手動再追加
    // 代替アクション復元
    altActions: Array.isArray(step?.alt_actions)
      ? step.alt_actions.map((a: any) => {
          const condArr: ConditionPair[] = [];
          if (a?.condition) condArr.push(stringToPair(String(a.condition)));
          if (a?.when) condArr.push(stringToPair(String(a.when)));
          if (Array.isArray(a?.extra_conditions)) {
            a.extra_conditions.forEach((s: string) => condArr.push(stringToPair(String(s))));
          }
          const gateArr: ConditionPair[] = [];
          if (a?.gate) gateArr.push(stringToPair(String(a.gate)));
          if (a?.gate_when) gateArr.push(stringToPair(String(a.gate_when)));
          if (Array.isArray(a?.gate_extra_conditions)) {
            a.gate_extra_conditions.forEach((s: string) => gateArr.push(stringToPair(String(s))));
          }
          const fromZ: string[] = (() => {
            const f = a?.from;
            if (!f) return [];
            if (Array.isArray(f)) return f.slice();
            const s = String(f);
            if (s.includes('_or_')) return s.split('_or_');
            return [s];
          })();
          return {
            action: a?.action || '',
            value: a?.value,
            target: a?.target || '',
            gateConditions: gateArr,
            conditions: condArr,
            conditionsOp: a?.condition_op === 'or' ? 'or' as const : 'and' as const,
            options: Array.isArray(a?.options) ? a.options.slice() : [],
            fromZones: fromZ,
            fromZonesOp: a?.from_op === 'and' ? 'and' as const : 'or' as const,
            deckPosition: a?.position === 'top' ? 'top' as const
              : a?.position === 'bottom' ? 'bottom' as const
              : a?.position === 'select' ? 'both' as const
              : undefined,
            duration: a?.duration || '',
            perCount: a?.per_count != null ? Number(a.per_count) : undefined,
            perRef: a?.ref || '',
            perCountMode: a?.per_count_mode === 'repeat' ? 'repeat' as const : undefined,
            perRefFilter: (() => {
              const f = a?.ref_filter;
              if (!f || typeof f !== 'object') return [];
              const out2: ConditionPair[] = [];
              if (f.color) out2.push({ base: 'cond_color', value: String(f.color) });
              if (f.type)  out2.push({ base: 'cond_type',  value: String(f.type)  });
              if (f.lv_le !== undefined && f.lv_ge !== undefined && f.lv_le === f.lv_ge) {
                out2.push({ base: 'cond_lv', value: String(f.lv_le) });
              } else {
                if (f.lv_le !== undefined) out2.push({ base: 'cond_lv_le', value: String(f.lv_le) });
                if (f.lv_ge !== undefined) out2.push({ base: 'cond_lv_ge', value: String(f.lv_ge) });
              }
              return out2;
            })(),
          };
        })
      : [],
    altActionsOp: (step?.alt_actions_op === 'and' ? 'and' : 'or') as 'or' | 'and',
    // 付与効果復元: granted_recipe から先頭トリガー＋先頭ステップを GrantedStep に
    grantedStep: (() => {
      const gr = step?.granted_recipe;
      if (!gr || typeof gr !== 'object') return undefined;
      const triggers = Object.keys(gr);
      if (triggers.length === 0) return undefined;
      const trig = triggers[0];
      const arr = gr[trig];
      if (!Array.isArray(arr) || arr.length === 0) return undefined;
      const inner = arr[0];
      const condArr: ConditionPair[] = [];
      if (inner?.condition) condArr.push(stringToPair(String(inner.condition)));
      if (inner?.when) condArr.push(stringToPair(String(inner.when)));
      if (Array.isArray(inner?.extra_conditions)) {
        inner.extra_conditions.forEach((s: string) => condArr.push(stringToPair(String(s))));
      }
      return {
        trigger: trig,
        action: inner?.action || '',
        value: inner?.value,
        target: inner?.target || '',
        duration: inner?.duration || '',
        conditions: condArr,
        options: Array.isArray(inner?.options) ? inner.options.slice() : [],
      };
    })(),
    targetFilter: parseFilterObject(step?.filter),
    fromFilter: parseFilterObject(step?.from_filter),
    extras: Object.keys(extras).length > 0 ? JSON.stringify(extras) : '',
  };
}
