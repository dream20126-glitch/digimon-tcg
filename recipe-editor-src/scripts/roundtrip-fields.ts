// エディタの各項目に値を入れて 保存→読込→保存 し、(1)保存に反映されない項目 (2)読込で失われる項目 を洗い出す
import { recipeToBlocks, blocksToRecipe } from '../src/recipe';
declare const require: any; declare const process: any;
const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync('./src/types.ts', 'utf8') /* recipe-editor-src で実行 */;
const sf = ts.createSourceFile('types.ts', src, ts.ScriptTarget.Latest, true);
const ifaces: Record<string, { name: string; type: any; optional: boolean }[]> = {};
const aliases: Record<string, any> = {};
sf.forEachChild((n: any) => {
  if (ts.isInterfaceDeclaration(n)) ifaces[n.name.text] = n.members.filter((m: any) => ts.isPropertySignature(m) && m.type).map((m: any) => ({ name: m.name.getText(sf), type: m.type, optional: !!m.questionToken }));
  if (ts.isTypeAliasDeclaration(n)) aliases[n.name.text] = n.type;
});
const kd: any = [{ code: 'assembly', kind: 'keyword', label: 'アセンブリ', hasNamedParam: true }, { code: 'blocker', kind: 'keyword', label: 'ブロッカー' }];
const PAIR = (b = 'cond_lv_le', v = '3') => ({ base: b, value: v });
// 型から代表値を作る（複数候補を返す：リテラル union は先頭以外も試す）
function samples(t: any, field: string, depth = 0): any[] {
  if (!t) return [];
  const k = t.kind;
  if (k === ts.SyntaxKind.StringKeyword) return [field.toLowerCase().includes('zone') ? 'hand' : 'x1'];
  if (k === ts.SyntaxKind.NumberKeyword) return [2];
  if (k === ts.SyntaxKind.BooleanKeyword) return [true];
  if (ts.isLiteralTypeNode(t)) { const l = t.literal; return [l.kind === ts.SyntaxKind.StringLiteral ? l.text : l.kind === ts.SyntaxKind.TrueKeyword ? true : Number(l.getText(sf))]; }
  if (ts.isUnionTypeNode(t)) { const out: any[] = []; t.types.forEach((x: any) => out.push(...samples(x, field, depth))); return out.filter((v) => v !== undefined); }
  if (ts.isArrayTypeNode(t)) {
    const el = t.elementType;
    const name = el.typeName ? el.typeName.getText(sf) : '';
    if (name === 'ConditionPair') return [[PAIR()]];
    if (name === 'ConditionChainEntry') return [[{ conditions: [PAIR()] }], [{ conditions: [PAIR()] }, { conditions: [PAIR('cond_feature', 'VB')], op: 'or' }]];
    if (el.kind === ts.SyntaxKind.StringKeyword) return [field === 'fromZones' || field === 'triggerFromZones' ? ['hand', 'trash'] : ['x1']];
    if (depth > 1) return [];
    const inner = name ? objSample(name, depth + 1) : null;
    return inner ? [[inner]] : [];
  }
  if (ts.isTypeReferenceNode(t)) {
    const name = t.typeName.getText(sf);
    if (name === 'Record') return [{ on_play: 'own' }];
    if (aliases[name]) return samples(aliases[name], field, depth);
    if (depth > 1) return [];
    const o = objSample(name, depth + 1);
    return o ? [o] : [];
  }
  return [];
}
function objSample(name: string, depth: number): any {
  const ms = ifaces[name]; if (!ms) return null;
  const o: any = {};
  ms.filter((m) => !m.optional).forEach((m) => { const s = samples(m.type, m.name, depth); if (s.length) o[m.name] = s[0]; });
  if (name === 'AltAction' || name === 'CostStep') { o.action = 'draw'; o.value = 1; }
  if (name === 'KeywordEntry') o.keyword = 'assembly';
  return o;
}
const norm = (v: any): any => Array.isArray(v) ? v.map(norm) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o: any, k) => { if (v[k] !== undefined) o[k] = norm(v[k]); return o; }, {}) : v;
const J = (x: any) => JSON.stringify(norm(x));
// 基本ブロック
const baseBlock = (): any => ({ section: 'main', zone: '', trigger: 'on_play', triggers: ['on_play'], action: 'destroy', target: 'opponent:1', conditions: [] });
const report: string[] = [];
// 項目ごとの前提（その項目がUIに出る・意味を持つ状態）
const CTX: Record<string, any> = {
  fromZoneOwner: { fromZones: ['hand', 'trash'] }, fromZonesOp: { fromZones: ['hand', 'trash'] },
  evoSourceOwner: { fromZones: ['evo_source'] }, evoSourcePosition: { fromZones: ['evo_source'] },
  linkedOwner: { fromZones: ['linked'] }, securityPosition: { fromZones: ['security'] }, deckSourcePosition: { fromZones: ['deck'] },
  perCount: { perRef: 'own_digimon' }, perRef: { perCount: 1 }, perRefStateCond: { perCount: 1, perRef: 'own_digimon' }, perCountMode: { perCount: 1, perRef: 'own_digimon' },
  valueStep: { perCount: 1, perRef: 'own_digimon', perCountMode: 'step' }, refCount: { perCount: 1, perRef: 'last_action_cards' },
  perRefFilter: { perCount: 1, perRef: 'own_digimon' }, perRefFilterChain: { perCount: 1, perRef: 'own_digimon' },
  conditionsOp: { conditions: [{ base: 'cond_lv_le', value: '3' }, { base: 'cond_feature', value: 'VB' }] },
  triggerConditionsOp: { triggerConditions: [{ base: 'cond_lv_le', value: '3' }, { base: 'cond_feature', value: 'VB' }] },
  fromFilterOp: { fromFilter: [{ base: 'cond_lv_le', value: '3' }, { base: 'cond_feature', value: 'VB' }] },
  destroyCauseSubject: { destroyCause: 'battle' }, fromCountQuant: { fromCount: 2, fromZones: ['hand'] },
  triggerFromZonesOp: { triggerFromZones: ['hand', 'trash'] }, zoneIncreaseOp: { zoneIncrease: ['hand', 'trash'] },
};
const KW_FIELDS = /^(keyword|passiveGate)/;
const ALT_KW = /^keyword/;

function test(label: string, mk: (v: any) => any[], fieldName: string, t: any, ctxBase: () => any[]) {
  const base = J(blocksToRecipe(ctxBase(), kd));
  for (const v of samples(t, fieldName)) {
    let blocks: any[];
    try { blocks = mk(v); } catch { continue; }
    let o1: any, o2: any;
    try { o1 = blocksToRecipe(blocks, kd); o2 = blocksToRecipe(recipeToBlocks(o1), kd); } catch (e: any) { report.push(`ERR  ${label}=${JSON.stringify(v)} : ${e.message}`); continue; }
    if (J(o1) === base) report.push(`NOSAVE ${label}=${JSON.stringify(v).slice(0, 80)}`);
    else if (J(o1) !== J(o2)) report.push(`LOST   ${label}=${JSON.stringify(v).slice(0, 80)}\n        save1 ${JSON.stringify(o1).slice(0, 260)}\n        save2 ${JSON.stringify(o2).slice(0, 260)}`);
  }
}
// EffectBlock 各フィールド
for (const m of ifaces.EffectBlock) {
  if (['section', 'trigger', 'triggers', 'altActions', 'keywordEntries'].includes(m.name)) continue;
  { const kw = KW_FIELDS.test(m.name) ? { trigger: 'passive', triggers: ['passive'], keyword: m.name.startsWith('passiveGate') ? 'blocker' : 'assembly', action: undefined, target: undefined, ...(m.name.startsWith('keywordCommon') ? { keywordDesignatedGroups: [{ conditions: [PAIR('cond_lv', '5')], count: 1 }, { conditions: [PAIR('cond_lv', '4')], count: 1, op: 'and' }] } : {}) } : {};
  const ctx = { ...kw, ...(CTX[m.name] || {}) };
  test('EffectBlock.' + m.name, (v) => [{ ...baseBlock(), ...ctx, [m.name]: v }], m.name, m.type, () => [{ ...baseBlock(), ...ctx }]); }
}
// 効果2（AND の alt）
const altBase = () => ({ action: 'draw', value: 1 });
for (const m of ifaces.AltAction) {
  if (['action'].includes(m.name)) continue;
  test('AltAction(and).' + m.name, (v) => [{ ...baseBlock(), altActionsOp: 'and', altActions: [{ ...altBase(), ...(ALT_KW.test(m.name) ? { action: 'grant_keyword', target: 'own:1', keyword: 'assembly' } : {}), ...(CTX[m.name] || {}), [m.name]: v }] }], m.name, m.type, () => [{ ...baseBlock(), altActionsOp: 'and', altActions: [{ ...altBase(), ...(ALT_KW.test(m.name) ? { action: 'grant_keyword', target: 'own:1', keyword: 'assembly' } : {}), ...(CTX[m.name] || {}) }] }]);
  test('AltAction(その後).' + m.name, (v) => [{ ...baseBlock(), altActions: [{ ...altBase(), thenBreak: true, ...(ALT_KW.test(m.name) ? { action: 'grant_keyword', target: 'own:1', keyword: 'assembly' } : {}), ...(CTX[m.name] || {}), [m.name]: v }] }], m.name, m.type, () => [{ ...baseBlock(), altActions: [{ ...altBase(), thenBreak: true, ...(ALT_KW.test(m.name) ? { action: 'grant_keyword', target: 'own:1', keyword: 'assembly' } : {}), ...(CTX[m.name] || {}) }] }]);
}
// コスト
const costBase = () => ({ action: 'cost_discard', value: 1, target: 'own_card' });
for (const m of (ifaces.CostStep || [])) {
  if (['action'].includes(m.name)) continue;
  test('CostStep.' + m.name, (v) => [{ ...baseBlock(), costs: [{ ...costBase(), ...(CTX[m.name] || {}), [m.name]: v }] }], m.name, m.type, () => [{ ...baseBlock(), costs: [{ ...costBase(), ...(CTX[m.name] || {}) }] }]);
}
// キーワード（passive）
const kwBlock = (e: any) => ({ section: 'main', zone: '', trigger: 'passive', triggers: ['passive'], conditions: [], keywordEntries: [{ keyword: 'assembly', value: 2, ...e }] });
for (const m of (ifaces.KeywordEntry || [])) {
  if (['keyword'].includes(m.name)) continue;
  test('KeywordEntry.' + m.name, (v) => [kwBlock({ [m.name]: v, ...(m.name.startsWith('common') ? { designatedGroups: [{ conditions: [PAIR('cond_lv', '5')], count: 1 }, { conditions: [PAIR('cond_lv', '4')], count: 1, op: 'and' }] } : {}) })], m.name, m.type,
    () => [kwBlock(m.name.startsWith('common') ? { designatedGroups: [{ conditions: [PAIR('cond_lv', '5')], count: 1 }, { conditions: [PAIR('cond_lv', '4')], count: 1, op: 'and' }] } : {})]);
}
for (const m of (ifaces.DesignatedGroup || [])) {
  test('DesignatedGroup.' + m.name, (v) => [kwBlock({ designatedGroups: [{ conditions: [PAIR('cond_lv', '5')], count: 1, [m.name]: v }, { conditions: [PAIR('cond_lv', '4')], count: 1, op: 'and' }] })], m.name, m.type,
    () => [kwBlock({ designatedGroups: [{ conditions: [PAIR('cond_lv', '5')], count: 1 }, { conditions: [PAIR('cond_lv', '4')], count: 1, op: 'and' }] })]);
}
fs.writeFileSync(process.argv[2], report.join('\n'));
console.log('issues', report.length);
