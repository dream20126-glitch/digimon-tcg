// EffectBlock[] ⇄ recipe JSON 変換
import type { ConditionPair, DictEntry, EffectBlock } from './types';
import { applyRulesToStep } from './ruleTranslator';

// 条件pairを「base:value@subject」形式の文字列に変換
// subjectが空なら省略（互換性維持）
function pairToString(p: ConditionPair): string {
  if (!p.base) return '';
  let s = p.value ? p.base + ':' + p.value : p.base;
  if (p.subject) s += '@' + p.subject;
  return s;
}

// keywordDict を渡すと、trigger='passive' のキーワードに recipeTemplate が登録されていれば
// カード自身のレシピにそのテンプレートの中身を展開・合流させる（キーワード効果登録機能）。
// テンプレートが無いキーワード（エンジン側が名前で直接認識する既存キーワード）は
// 今まで通り passive:[{flag}] のみで出力する（既存カードへの影響なし）
export function blocksToRecipe(blocks: EffectBlock[], keywordDict?: DictEntry[]): Record<string, any> {
  const recipe: Record<string, any> = {};
  blocks.forEach((b) => {
    // セキュリティ効果はトリガー入力不要（常に 'security' キーに出力される）。
    // トリガー未入力を理由に他セクションと同様スキップされてしまわないよう先に処理する。
    if (b.section === 'security') {
      appendStep(recipe, { ...b, trigger: 'security' }, keywordDict);
      return;
    }
    // トリガー複数選択: 「登場時/進化時どちらでも同じ効果」のように、選択された
    // 各トリガーコードへ同一内容のstepをそれぞれ出力する
    const triggerList = (b.triggers && b.triggers.length > 0) ? b.triggers : (b.trigger ? [b.trigger] : []);
    triggerList.forEach((trig) => {
      if (b.section === 'evo_source') {
        recipe.evo_source = recipe.evo_source || {};
        appendStep(recipe.evo_source, { ...b, trigger: trig }, keywordDict);
      } else if (b.section === 'link') {
        // リンク効果は進化元効果と同じ構造（during_own_turn等のトリガーでネスト）。
        // 「リンクしている間」という状態はcard.linkedCardsで表現されるため、
        // トリガー自体は進化元と同様に発動タイミングの指定として使う
        recipe.link = recipe.link || {};
        appendStep(recipe.link, { ...b, trigger: trig }, keywordDict);
      } else {
        appendStep(recipe, { ...b, trigger: trig }, keywordDict);
      }
    });
  });
  return recipe;
}

// テンプレートrecipeの各トリガーキーの配列を、containerの同じキーへ追記合流する。
// テンプレート側で値を空にしておいたstep（例:「DP+」までで数値未設定）には、
// カード側でキーワード効果に入力した数値(cardValue)をそのまま差し込む
// （＝「Nはカードごとに違う」ケースをテンプレート側で固定せずに済む）
function mergeTemplateRecipe(container: Record<string, any>, template: Record<string, any>, cardValue?: number | string) {
  Object.keys(template).forEach((key) => {
    const steps = template[key];
    if (!Array.isArray(steps) || steps.length === 0) return;
    if (key === 'evo_source' || key === 'passive') return; // 未対応の入れ子は無視（v1では単純なトリガーキーのみ）
    const filled = cardValue === undefined || cardValue === ''
      ? steps
      : steps.map((s: any) => (s && s.value === undefined ? { ...s, value: cardValue } : s));
    container[key] = Array.isArray(container[key]) ? [...container[key], ...filled] : filled.slice();
  });
}

function appendStep(container: Record<string, any>, b: EffectBlock, keywordDict?: DictEntry[]) {
  if (b.trigger === 'passive') {
    const kwEntry = keywordDict && b.keyword ? keywordDict.find((k) => k.code === b.keyword) : undefined;
    if (kwEntry && kwEntry.recipeTemplate) {
      try {
        const template = JSON.parse(kwEntry.recipeTemplate);
        if (template && typeof template === 'object') {
          const cv = b.value !== undefined && b.value !== '' && b.value !== null
            ? (isNaN(Number(b.value)) ? b.value : Number(b.value))
            : undefined;
          mergeTemplateRecipe(container, template, cv);
          return;
        }
      } catch (_) { /* パース失敗時は下のpassive出力にフォールバック */ }
    }
    container.passive = container.passive || [];
    const p: any = { flag: b.keyword };
    // 値 (例: 【Sアタック+2】 の "2"): 数値化できれば number、そうでなければそのまま
    if (b.value !== undefined && b.value !== '' && b.value !== null) {
      const n = Number(b.value);
      p.value = isNaN(n) ? b.value : n;
    }
    if (b.zone) p.in_zone = b.zone;
    if (b.extras) {
      try {
        const ex = JSON.parse(b.extras);
        Object.keys(ex).forEach((k) => (p[k] = ex[k]));
      } catch (_) {}
    }
    container.passive.push(p);
    return;
  }
  const step: any = {};

  // 「デジモン/オプションどちらの効果か」の編集時メモ書き。エンジンは参照しない
  if (b.asType) step.as_type = b.asType;

  // 条件: 1つ目→condition, 2つ目→when, 3つ目以降→extra_conditions[]
  const validConds = (b.conditions || []).filter((p) => p.base);
  if (validConds.length >= 1) step.condition = pairToString(validConds[0]);
  if (validConds.length >= 2) step.when = pairToString(validConds[1]);
  if (validConds.length >= 3) step.extra_conditions = validConds.slice(2).map(pairToString);

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
      return cs;
    });
  }

  if (b.duration) step.duration = b.duration;
  if (b.action) step.action = b.action;
  if (b.value !== undefined && b.value !== '' && b.value !== null) {
    const v = Number(b.value);
    step.value = isNaN(v) ? b.value : v;
  }
  if (b.target) step.target = b.target;
  if (b.keyword) step.keyword = b.keyword;
  // memory_plus の「このターン終了時メモリー-N」フラグ
  if (b.revertAtTurnEnd) step.revert_at_turn_end = true;
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
  // 「〇〇するか〇〇する」「〇〇する＆〇〇する」を表現するための同ステップ内代替アクション群
  if (Array.isArray(b.altActions) && b.altActions.length > 0) {
    step.alt_actions = b.altActions
      .filter((a) => a && a.action)
      .map((a) => {
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
        if (Array.isArray(a.fromZones) && a.fromZones.length > 0) {
          const az = a.fromZones.filter((z) => !!z);
          if (az.length === 1) out.from = az[0];
          else if (az.length > 1) {
            out.from = az;
            if (a.fromZonesOp && a.fromZonesOp !== 'or') out.from_op = a.fromZonesOp;
          }
        }
        if (Array.isArray(a.options) && a.options.length > 0) out.options = a.options.slice();
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
      });
    if (step.alt_actions.length > 0) {
      step.alt_actions_op = b.altActionsOp || 'or';
    }
  }
  // === targetFilter → step.filter ===
  if (Array.isArray(b.targetFilter) && b.targetFilter.length > 0) {
    const f: Record<string, any> = {};
    b.targetFilter.forEach((c) => {
      if (!c || !c.base || !c.value) return;
      const num = (v: any) => { const n = parseInt(String(v), 10); return isNaN(n) ? undefined : n; };
      switch (c.base) {
        case 'cond_color':            f.color = c.value; break;
        // カンマ区切り(複数チェック)なら type_in 配列(OR)、単一値ならこれまで通り type
        case 'cond_type': {
          const types = String(c.value).split(',').map((s) => s.trim()).filter(Boolean);
          if (types.length > 1) f.type_in = types; else f.type = types[0];
          break;
        }
        case 'cond_lv':       { const n = num(c.value); if (n !== undefined) { f.lv_le = n; f.lv_ge = n; } break; }
        case 'cond_lv_le':    { const n = num(c.value); if (n !== undefined) f.lv_le = n; break; }
        case 'cond_lv_ge':    { const n = num(c.value); if (n !== undefined) f.lv_ge = n; break; }
        // カンマ区切り(複数チェック)なら feature_includes 配列(OR・特徴を "/" で分割して部分一致)、
        // 単一値でも feature_includes を使う（cardMatchesFilter は feature_contains を見ないため）
        case 'cond_feature_contains': {
          const feats = String(c.value).split(',').map((s) => s.trim()).filter(Boolean);
          if (feats.length > 0) f.feature_includes = feats;
          break;
        }
        case 'cond_name':             f.name = c.value; break;
        case 'cond_name_contains':    f.name_contains = c.value; break;
      }
    });
    if (Object.keys(f).length > 0) step.filter = f;
  }
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
  container[b.trigger] = container[b.trigger] || [];
  container[b.trigger].push(step);
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
      arr.forEach((step: any) => blocks.push(stepToBlock('security', 'security', step)));
    } else {
      arr.forEach((step: any) => blocks.push(stepToBlock('main', k, step)));
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
      arr.forEach((step: any) => blocks.push(stepToBlock('evo_source', k, step)));
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
      arr.forEach((step: any) => blocks.push(stepToBlock('link', k, step)));
    });
  }
  return blocks;
}

function passiveToBlock(section: 'main' | 'evo_source' | 'link', p: any): EffectBlock {
  const extras: any = {};
  Object.keys(p || {}).forEach((k) => {
    if (k !== 'flag' && k !== 'in_zone' && k !== 'value') extras[k] = p[k];
  });
  return {
    section,
    zone: p?.in_zone || '',
    trigger: 'passive',
    keyword: (p && p.flag) || '',
    value: p?.value,
    extras: Object.keys(extras).length > 0 ? JSON.stringify(extras) : '',
  };
}

function stepToBlock(section: 'main' | 'evo_source' | 'security' | 'link', trigger: string, step: any): EffectBlock {
  const KNOWN: Record<string, boolean> = {
    as_type: true,
    action: true,
    condition: true,
    when: true,
    extra_conditions: true,
    trigger_conditions: true,
    duration: true,
    target: true,
    value: true,
    keyword: true,
    revert_at_turn_end: true,
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
  };
  const extras: any = {};
  Object.keys(step || {}).forEach((k) => {
    if (!KNOWN[k]) extras[k] = step[k];
  });
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
          fromZones,
          fromZonesOp,
          deckPosition,
        };
      })
    : [];
  return {
    section,
    asType: step?.as_type === 'digimon' || step?.as_type === 'tamer' || step?.as_type === 'option' ? step.as_type : undefined,
    zone: step?.in_zone || '',
    trigger,
    // JSON に subject 無ければ 'self' (このデジモン) としてロード
    triggerSubject: step?.subject || 'self',
    limit: step?.limit || '',
    triggerConditions,
    conditions,
    costs,
    duration: step?.duration || '',
    action: step?.action || '',
    value: step?.value,
    target: step?.target || '',
    keyword: step?.keyword || '',
    revertAtTurnEnd: !!step?.revert_at_turn_end,
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
            options: Array.isArray(a?.options) ? a.options.slice() : [],
            fromZones: fromZ,
            fromZonesOp: a?.from_op === 'and' ? 'and' as const : 'or' as const,
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
    targetFilter: (() => {
      const f = step?.filter;
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
      if (f.name_contains)    out.push({ base: 'cond_name_contains',    value: String(f.name_contains) });
      if (f.lv_le !== undefined && f.lv_ge !== undefined && f.lv_le === f.lv_ge) {
        out.push({ base: 'cond_lv', value: String(f.lv_le) });
      } else {
        if (f.lv_le !== undefined) out.push({ base: 'cond_lv_le', value: String(f.lv_le) });
        if (f.lv_ge !== undefined) out.push({ base: 'cond_lv_ge', value: String(f.lv_ge) });
      }
      return out;
    })(),
    extras: Object.keys(extras).length > 0 ? JSON.stringify(extras) : '',
  };
}
