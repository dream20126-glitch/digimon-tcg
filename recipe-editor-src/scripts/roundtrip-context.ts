// 前提をそろえた状態で、エディタの各設定が「保存 → 開き直し」で元の形に戻るかを確かめる検査。
// roundtrip-fields.ts は項目を1つずつ汎用の土台に入れるため、アクション専用の項目などが NOSAVE（前提不足）に
// なる。ここでは項目ごとに必要な前提（アクション・トリガー等）を入れて、開き直したブロックの該当項目を比べる。
//   npx esbuild scripts/roundtrip-context.ts --bundle --platform=node --outfile=/tmp/ctx.js
//   node /tmp/ctx.js [dict.json]
import { recipeToBlocks, blocksToRecipe } from '../src/recipe';
import * as fs from 'fs';

const kd: any[] = (() => {
  try {
    const dict = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const rows: any[] = []; const w = (v: any) => { if (Array.isArray(v)) v.forEach(w); else if (v && typeof v === 'object') { if (v['種類'] === 'keyword') rows.push(v); else Object.values(v).forEach(w); } }; w(dict);
    return rows.map((k: any) => ({ code: k['コード'], kind: 'keyword', label: k['表示名'], hasNamedParam: !!k['対象'], recipeTemplate: k['キーワードレシピ'] }));
  } catch { return []; }
})();
['assembly', 'decode', 'digixros', 'blast'].forEach((c) => { if (!kd.some((k) => k.code === c)) kd.push({ code: c, kind: 'keyword', label: c, hasNamedParam: true }); });

const base = (o: any = {}): any => ({ section: 'main', trigger: 'on_play', triggers: ['on_play'], conditions: [], action: 'draw', value: 1, ...o });
const alt = (o: any = {}): any => ({ action: 'draw', value: 1, target: '', conditions: [], options: [], fromZones: [], ...o });
const J = (v: any) => JSON.stringify(v);
const get = (o: any, path: string) => path.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);

type Case = { name: string; blocks: any[]; check: string[] };
const cases: Case[] = [
  { name: '効果を発揮（登場時・発揮しない）', blocks: [base({ action: 'negate', target: 'opponent:1', negateTargetTrigger: 'on_evolve', negateDeny: true })], check: ['0.negateTargetTrigger', '0.negateDeny'] },
  { name: '効果2の効果を発揮', blocks: [base({ altActionsOp: 'and', altActions: [alt({ action: 'negate', target: 'opponent:1', negateTargetTrigger: 'on_play', negateDeny: true })] })], check: ['0.altActions.0.negateTargetTrigger', '0.altActions.0.negateDeny'] },
  { name: '効果を受けない（デジモン）', blocks: [base({ action: 'immune_effects', target: 'own:1', immuneCardType: 'digimon' })], check: ['0.immuneCardType'] },
  { name: 'リンク（リンクされる側）', blocks: [base({ section: 'link', trigger: 'on_link', triggers: ['on_link'], action: 'draw', linkRole: 'target' })], check: ['0.linkRole'] },
  { name: '効果2のキーワード付与（複数）', blocks: [base({ altActionsOp: 'and', altActions: [alt({ action: 'grant_keyword', target: 'own:1', keyword: 'blocker', keywordEntries: [{ keyword: 'blocker' }, { keyword: 'rush' }] })] })], check: ['0.altActions.0.keywordEntries'] },
  { name: '効果2のコスト上限+（直前に適用）', blocks: [base({ action: 'summon', target: 'own_card:1', fromZones: ['hand'], fromFilter: [{ base: 'cond_cost_le', value: '3' }], altActionsOp: 'and', altActions: [alt({ action: 'cost_limit_plus', value: 1, applyCostModToPrev: true })] })], check: ['0.altActions.0.applyCostModToPrev'] },
  { name: 'ORの選択肢の続き（その後）', blocks: [base({ altActionsOp: 'or', altActions: [alt({ action: 'memory_plus' }), alt({ action: 'recover', chainPrev: true })] })], check: ['0.altActions.1.chainPrev'] },
  { name: 'その後区間（OR）', blocks: [base({ altActionsOp: 'and', altActions: [alt({ action: 'memory_plus', thenBreak: true, thenBreakOp: 'or' }), alt({ action: 'recover' })] })], check: ['0.altActions.0.thenBreak', '0.altActions.0.thenBreakOp'] },
  { name: 'トリガーごとの発動ターン', blocks: [base({ trigger: 'on_play', triggers: ['on_play', 'on_evolve'], triggerTimingByCode: { on_play: 'self' } })], check: ['0.triggerTimingByCode'] },
  { name: 'トリガーごとの発動主体', blocks: [base({ trigger: 'on_play', triggers: ['on_play', 'on_evolve'], triggerSubjectByCode: { on_play: 'own', on_evolve: 'self' } })], check: ['0.triggerSubjectByCode'] },
  { name: 'トリガーごとの原因', blocks: [base({ trigger: 'on_destroy', triggers: ['on_destroy', 'when_evo_discard'], triggerCauseByCode: { on_destroy: 'battle', when_evo_discard: 'effect' }, triggerCauseSubjectByCode: { on_destroy: 'opp', when_evo_discard: 'own' } })], check: ['0.triggerCauseByCode', '0.triggerCauseSubjectByCode'] },
  { name: '原因（できない）', blocks: [base({ action: 'cant_discard', target: 'self_card', byCause: 'effect', byCauseSubject: 'opp' })], check: ['0.byCause', '0.byCauseSubject'] },
  { name: '区分 メイン＋セキュリティ', blocks: [base({ sections: ['main', 'security'] })], check: [] },
  { name: 'パッシブ キーワード数値', blocks: [base({ trigger: 'passive', triggers: ['passive'], action: '', value: undefined, keyword: 'security_attack_plus', keywordEntries: [{ keyword: 'security_attack_plus', value: 2 }] })], check: [] },
  { name: 'アセンブリ（グループ2つ・共通条件）', blocks: [base({ trigger: 'passive', triggers: ['passive'], action: '', value: undefined, keyword: 'assembly', keywordEntries: [{ keyword: 'assembly', value: 6, designatedGroups: [{ conditions: [{ base: 'cond_lv', value: '5' }], count: 1 }, { conditions: [{ base: 'cond_lv', value: '4' }], count: 1 }], commonConditions: [{ base: 'cond_feature', value: 'VB' }] }] })], check: [] },
  { name: 'ブラスト（ジョグレス・対象）', blocks: [base({ trigger: 'passive', triggers: ['passive'], action: '', value: undefined, keyword: 'blast', keywordMode: 'jogress', keywordEntries: [{ keyword: 'blast', mode: 'jogress', designatedGroups: [{ conditions: [{ base: 'cond_name', value: 'A' }], count: 1 }, { conditions: [{ base: 'cond_name', value: 'B' }], count: 1 }] }] })], check: [] },
  { name: 'アプ合体素材', blocks: [base({ trigger: 'app_gattai_evolve', triggers: ['app_gattai_evolve'], action: '', value: undefined, fusionMaterials: [{ names: ['A'] }, { names: ['B'] }, { names: ['C'] }], fusionPickCount: 2 })], check: [] },
  { name: 'ジョグレス素材', blocks: [base({ trigger: 'jogress_evolve', triggers: ['jogress_evolve'], action: '', value: undefined, fusionMaterials: [{ colors: ['青', '黄'], lv: 6 }, { colors: ['赤', '黒'], lv: 6 }] })], check: [] },
  { name: 'ルール 条件ごとに枚数', blocks: [base({ action: 'deck_open', value: 3, rules: [{ action: 'add_to_hand', designatedGroups: [{ conditions: [{ base: 'cond_description_contains', value: 'X' }], count: 1 }, { conditions: [{ base: 'cond_feature', value: 'NSp' }], count: 1 }] }, { action: 'return_deck', isRemaining: true, deckPosition: 'bottom' }] })], check: ['0.rules.length'] },
  { name: '効果を発揮＞選択', blocks: [base({ altActionsOp: 'and', altActions: [alt({ action: 'choose_effect', value: 1, thenBreak: true }), alt({ action: 'dp_minus', value: 1000, target: 'opponent:1' }), alt({ action: 'memory_plus' }), alt({ action: 'recover', chainPrev: true })] })], check: ['0.altActions.0.action', '0.altActions.3.chainPrev'] },
  { name: 'トークン体数', blocks: [base({ action: 'summon_token', value: 'TK_017', tokenCount: 2 })], check: ['0.tokenCount'] },
  { name: '進化先このカード', blocks: [base({ action: 'evolve', target: 'own:1', evolveInto: 'self_card' })], check: ['0.evolveInto'] },
  { name: 'コスト 登場/参照', blocks: [base({ action: 'destroy', target: 'opponent:1', targetFilter: [{ base: 'cond_cost_le', value: 'self_evo_count', costKind: 'play' }] })], check: ['0.targetFilter'] },
  { name: '取得元カードの条件（手札に戻す）', blocks: [base({ action: 'return_hand', target: 'own_card:1', fromZones: ['trash'], fromFilter: [{ base: 'cond_feature', value: 'ME' }] })], check: ['0.fromFilter'] },
  { name: 'カウンター（両方）', blocks: [base({ trigger: 'on_attack', triggers: ['on_attack'], counter: 'also' })], check: ['0.counter'] },
  // 2026-10-27 LM弾の対応で追加した設定
  { name: '対象の種類 デジモン/テイマー/オプション', blocks: [base({ action: 'destroy', target: 'opponent_card:1', targetFilter: [{ base: 'cond_type', value: 'デジモン,テイマー,オプション' }] })], check: ['0.target', '0.targetFilter'] },
  { name: 'デッキに戻す（対象=自分のトラッシュ）', blocks: [base({ action: 'return_deck', target: 'own_trash:1', deckPosition: 'top', fromFilter: [{ base: 'cond_color', value: '赤' }] })], check: ['0.target', '0.fromFilter'] },
  { name: 'セキュリティに置く（対象=自分の手札）', blocks: [base({ action: 'place_on_security_top', target: 'own_hand:1', fromFilter: [{ base: 'cond_color_count', value: '1' }] })], check: ['0.target', '0.fromFilter'] },
  { name: 'キーワードを持つ（対象の条件）', blocks: [base({ action: 'destroy', target: 'opponent:1', targetFilter: [{ base: 'cond_has_keyword', value: 'blocker,rush' }] })], check: ['0.targetFilter'] },
  { name: 'DP合計このデジモンのDPまで', blocks: [base({ action: 'destroy', target: 'opponent:all', targetFilter: [{ base: 'cond_dp_sum_le', value: 'self' }] })], check: ['0.targetFilter'] },
  { name: '〇色でも色条件を満たせる', blocks: [base({ trigger: 'passive', triggers: ['passive'], action: '', value: undefined, keyword: 'alt_use_color', keywordColors: ['黒', '紫'], keywordEntries: [{ keyword: 'alt_use_color', colors: ['黒', '紫'] }] })], check: ['0.keywordColors'] },
  { name: '登場/進化（するとき・コスト-2）', blocks: [base({ trigger: 'when_play', triggers: ['when_play', 'before_evolve'], action: 'appear_or_evolve', value: -2 })], check: ['0.action', '0.triggers', '0.value'] },
  { name: '効果の上限を修正', blocks: [base({ section: 'evo_source', trigger: 'during_any_turn', triggers: ['during_any_turn'], action: 'effect_cap_modify', value: 5000, actionParams: { cap_action: 'destroy', cap_attr: 'dp', cap_scope: 'self' } })], check: ['0.actionParams'] },
  { name: '登場コストをコストのカード分マイナス', blocks: [base({ trigger: 'main', triggers: ['main'], zone: 'trash', action: 'summon_appear', target: 'self_card', actionParams: { value_from: { ref: 'cost_card', attr: 'cost', sign: 'minus' } } })], check: ['0.actionParams'] },
  { name: '効果2のデッキオープンにルール', blocks: [base({ action: 'declare_category', value: undefined, altActionsOp: 'and', altActions: [alt({ action: 'deck_open', value: 1, actionParams: { deck_owner: 'opp' }, rules: [{ action: 'return_deck', isRemaining: true, deckPosition: 'both' }] })] })], check: ['0.altActions.0.rules', '0.altActions.0.actionParams'] },
  { name: '進化元の下に置く（置くカード=このカード）', blocks: [base({ action: 'place_under_digimon', target: 'same_target', fromZones: ['self_card'] })], check: ['0.fromZones', '0.target'] },
  { name: '〜な相手のデジモンがいないなら（進化元このデジモン以上）', blocks: [base({ trigger: 'on_attack', triggers: ['on_attack'], action: 'active', target: 'self', conditions: [{ base: 'cond_battle_area_eq', value: '0', subject: 'opp' }, { base: 'cond_has_evo', value: 'self', subject: '__ref_exists_filter__' }] })], check: ['0.conditions'] },
  { name: '相手のセキュリティデジモン全てDP-', blocks: [base({ action: 'dp_minus', value: 6000, target: 'opp_security:all', duration: 'dur_this_turn' })], check: ['0.target'] },
  { name: 'コスト以下（直前の効果のカード）', blocks: [base({ action: 'summon_appear', target: 'own_card:1', fromZones: ['hand'], fromFilter: [{ base: 'cond_cost_le', value: 'last_action_cost' }, { base: 'cond_dp_le', value: 'last_action' }] })], check: ['0.fromFilter'] },
  { name: '効果2: 相手のデッキをオープン・宣言・効果を受けない', blocks: [base({ action: 'declare_category', value: undefined, altActionsOp: 'and', altActions: [alt({ action: 'deck_open', value: 1, actionParams: { deck_owner: 'opp' }, thenBreak: true }), alt({ action: 'immune_effects', target: 'self', value: undefined, actionParams: { source_type: 'declared' }, conditions: [{ base: 'cond_picked_type', value: 'declared' }] })] })], check: ['0.altActions.0.actionParams', '0.altActions.1.actionParams'] },
  { name: 'セキュリティをオープン（相手・選んだ1枚を相手デッキの上）', blocks: [base({ action: 'security_open', value: undefined, actionParams: { security_owner: 'opp', pick_to: 'opp_deck_top', rest_to: 'shuffle_security' } })], check: ['0.actionParams'] },
];

let ng = 0;
for (const c of cases) {
  try {
    const r1 = blocksToRecipe(c.blocks, kd as any);
    const b2 = recipeToBlocks(r1);
    const r2 = blocksToRecipe(b2, kd as any);
    const stable = J(r1) === J(r2);
    const bad = c.check.filter((p) => J(get(c.blocks, p)) !== J(get(b2, p)));
    const ok = stable && bad.length === 0;
    if (!ok) ng++;
    console.log((ok ? 'OK  ' : 'NG  ') + c.name + (stable ? '' : ' [保存し直すと変わる]') + (bad.length ? ' [戻らない: ' + bad.map((p) => p + ' ' + J(get(c.blocks, p)) + '→' + J(get(b2, p))).join(', ') + ']' : ''));
    if (!ok) console.log('      ' + J(r1).slice(0, 400));
  } catch (e) { ng++; console.log('ERR ' + c.name + ' ' + e); }
}
console.log('NG ' + ng + ' / ' + cases.length);
