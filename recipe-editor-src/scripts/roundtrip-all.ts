import { recipeToBlocks, blocksToRecipe, parseCardLevelSettings, applyCardLevelSettings } from '../src/recipe';
declare const require: any; declare const process: any;
const fs = require('fs');
const dict = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rowsAll: any[] = []; const w = (v: any) => { if (Array.isArray(v)) v.forEach(w); else if (v && typeof v === 'object') { if (v['種類'] === 'keyword') rowsAll.push(v); else Object.values(v).forEach(w); } }; w(dict);
const kd = rowsAll.map((k: any) => ({ code: k['コード'], kind: 'keyword', label: k['表示名'], hasNamedParam: !!k['対象'], recipeTemplate: k['キーワードレシピ'] }));
const list = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); const cards = list.cards || list;
const out = process.argv[4];

// 値の比較: キー順・数値文字列の差は無視
const norm = (v: any): any => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o: any, k) => { o[k] = norm(v[k]); return o; }, {});
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return v;
};
// 差分のパス一覧
const diffs: string[] = [];
const cmp = (a: any, b: any, p: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach((k) => cmp(a[k], b[k], p + (Array.isArray(a) ? '[' + k + ']' : '.' + k)));
    return;
  }
  diffs.push(p + ' : ' + JSON.stringify(a)?.slice(0, 160) + ' => ' + JSON.stringify(b)?.slice(0, 160));
};
const byKey: Record<string, string[]> = {};
let n = 0, bad = 0, err = 0;
const lines: string[] = [];
for (const c of cards) {
  const s = c['レシピ']; if (!s || !s.trim()) continue;
  let r; try { r = JSON.parse(s); } catch { continue; }
  n++;
  let b;
  try {
    const settings = parseCardLevelSettings(r);
    b = applyCardLevelSettings(blocksToRecipe(recipeToBlocks(r), kd as any), settings);
  } catch (e: any) { err++; lines.push(c['カードNo'] + ' ERROR ' + e.message); continue; }
  diffs.length = 0;
  cmp(norm(r), norm(b), '');
  if (diffs.length) {
    bad++;
    lines.push('### ' + c['カードNo'] + ' ' + c['名前']);
    diffs.forEach((d) => {
      lines.push('  ' + d);
      const key = d.split(' : ')[0].replace(/\[\d+\]/g, '[]').replace(/^\.[^.\[]+/, '.<trig>').replace(/\.evo_source\.[^.\[]+/, '.evo_source.<trig>');
      (byKey[key] = byKey[key] || []).push(c['カードNo']);
    });
  }
}
const summary = Object.entries(byKey).sort((x, y) => y[1].length - x[1].length).map(([k, v]) => v.length + '\t' + k + '\t' + v.slice(0, 6).join(','));
fs.writeFileSync(out, 'checked ' + n + ' diff ' + bad + ' error ' + err + '\n\n== SUMMARY ==\n' + summary.join('\n') + '\n\n== DETAIL ==\n' + lines.join('\n'));
console.log('checked', n, 'diff', bad, 'error', err);
console.log(summary.slice(0, 60).join('\n'));
