// 他のカードのレシピをコピーするときの「置き換え」を、2枚のカードの効果テキストの違いから作る。
// 例: 「レッド・スクランブル」→「ブルー・スクランブル」なら 赤→青・レッド→ブルー、
//     名称だけ違うカードなら 名称A→名称B。

export interface ReplacePair {
  from: string;
  to: string;
}

export interface TextDiffResult {
  pairs: ReplacePair[];
  // 置き換えでは表せない違い（片方にだけある文）。コピー後に手で直す必要がある
  onlyInSource: string[];
  onlyInTarget: string[];
}

type Hunk = { a: string; b: string; same: boolean };

// カタカナ（名称）・英数字のまとまりは1つの単語として比べる（「レッド」→「ブラック」が「レッ」→「ブラッ」のように
// 細切れにならないように）。「・」は区切り（「レッド・メモリーブースト」は「レッド」「・」「メモリーブースト」）
const WORD_RE = /[ァ-ヶーｦ-ﾟA-Za-z0-9０-９Ａ-Ｚａ-ｚ]+|[\s\S]/g;
const tokens = (t: string): string[] => t.match(WORD_RE) || [];

// 単語単位の差分（LCS）。カードのテキストは長くても数百語なので O(n*m) で十分
function tokenHunks(a: string, b: string): Hunk[] {
  const A = tokens(a), B = tokens(b);
  const n = A.length, m = B.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0, j = 0, ca = '', cb = '';
  const flush = () => { if (ca || cb) hunks.push({ a: ca, b: cb, same: false }); ca = ''; cb = ''; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); hunks.push({ a: A[i], b: B[j], same: true }); i++; j++; }
    else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) { ca += A[i]; i++; }
    else { cb += B[j]; j++; }
  }
  flush();
  return hunks;
}

function textPairs(a: string, b: string): TextDiffResult {
  const out: TextDiffResult = { pairs: [], onlyInSource: [], onlyInTarget: [] };
  tokenHunks(a, b).forEach((h) => {
    if (h.same) return;
    if (h.a && h.b) out.pairs.push({ from: h.a, to: h.b });
    else if (h.a) out.onlyInSource.push(h.a);
    else if (h.b) out.onlyInTarget.push(h.b);
  });
  return out;
}

// コピー元とコピー先のテキスト（効果・進化元・セキュリティ）を比べて置き換えの組を作る
export function suggestReplacements(srcTexts: string[], dstTexts: string[]): TextDiffResult {
  const res: TextDiffResult = { pairs: [], onlyInSource: [], onlyInTarget: [] };
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(srcTexts.length, dstTexts.length); i++) {
    const a = srcTexts[i] || '', b = dstTexts[i] || '';
    if (!a && !b) continue;
    const r = textPairs(a, b);
    r.pairs.forEach((p) => {
      const key = p.from + '\u0000' + p.to;
      if (p.from === p.to || seen.has(key)) return;
      seen.add(key);
      res.pairs.push(p);
    });
    res.onlyInSource.push(...r.onlyInSource.filter((s) => s.trim()));
    res.onlyInTarget.push(...r.onlyInTarget.filter((s) => s.trim()));
  }
  // 同じ「元」に別々の「先」が出たら、多い方を残す（まれ。手で直してもらう）
  const byFrom = new Map<string, ReplacePair>();
  res.pairs.forEach((p) => { if (!byFrom.has(p.from)) byFrom.set(p.from, p); });
  res.pairs = [...byFrom.values()].sort((x, y) => y.from.length - x.from.length);
  return res;
}

// レシピ（JSON）の文字列の値すべてに、置き換えを同時に当てる（赤→青・青→赤の入れ替えも正しくできるように1回で置き換える）。
// キー名は変えない。戻り値の counts は組ごとの置き換えた回数
export function applyReplacements(recipe: unknown, pairs: ReplacePair[]): { recipe: unknown; counts: number[] } {
  const usable = pairs.map((p, i) => ({ ...p, i })).filter((p) => p.from);
  const counts = pairs.map(() => 0);
  if (usable.length === 0) return { recipe: JSON.parse(JSON.stringify(recipe)), counts };
  const sorted = usable.slice().sort((x, y) => y.from.length - x.from.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(sorted.map((p) => esc(p.from)).join('|'), 'g');
  const map = new Map(sorted.map((p) => [p.from, p]));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(re, (m) => { const p = map.get(m)!; counts[p.i]++; return p.to; });
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      Object.keys(v as Record<string, unknown>).forEach((k) => { o[k] = walk((v as Record<string, unknown>)[k]); });
      return o;
    }
    return v;
  };
  return { recipe: walk(recipe), counts };
}

// 置き換え後のレシピの表示文（display_text）が、コピー先のカードのテキストに無いものを返す（置き換え漏れの確認用）
export function displayTextsNotInCard(recipe: unknown, cardTexts: string[]): string[] {
  const norm = (s: string) => s.replace(/[\s。、・,，.．「」『』]/g, '');
  const hay = norm(cardTexts.join(''));
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.display_text === 'string' && o.display_text.trim()) {
        const dt = norm(o.display_text);
        if (dt && !hay.includes(dt)) out.push(o.display_text);
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(recipe);
  return out;
}
