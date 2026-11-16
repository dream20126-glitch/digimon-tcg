import { useMemo, useState } from 'react';
import type { CardData } from '../types';
import { loadCardDetail } from '../api';
import { SearchSelect } from './SearchSelect';
import { applyReplacements, displayTextsNotInCard, suggestReplacements, type ReplacePair } from '../textDiff';

// 📄 他のカードのレシピをコピー: 色違い・名称違いなど、テキストが一部だけ違うカードのレシピを、違う所を置き換えて読み込む。
// 置き換えの組はテキストの違いから自動で作り、手で直せる。読み込むだけで保存はしない（中身を見てから保存する）
export function RecipeCopyPanel({
  card,
  cards,
  onApply,
}: {
  card: CardData;
  cards: CardData[];
  onApply: (recipe: unknown, sourceNo: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [srcNo, setSrcNo] = useState('');
  const [src, setSrc] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [pairs, setPairs] = useState<ReplacePair[]>([]);
  const [onlySrc, setOnlySrc] = useState<string[]>([]);
  const [onlyDst, setOnlyDst] = useState<string[]>([]);

  const options = useMemo(
    () => cards.filter((c) => c.cardNo !== card.cardNo && c.recipe && c.recipe !== '""')
      .map((c) => ({ value: c.cardNo, label: c.cardNo + ' ' + c.name })),
    [cards, card.cardNo],
  );
  const textsOf = (c: CardData): string[] => [c.name, c.effectText, c.evoText, c.securityText].map((t) => (t && t !== 'なし' ? String(t) : ''));

  async function pick(no: string) {
    const v = no.trim().toUpperCase();
    setSrcNo(v);
    setSrc(null); setErr(''); setPairs([]); setOnlySrc([]); setOnlyDst([]);
    if (!v) return;
    setLoading(true);
    try {
      // 一覧の情報は古いことがあるので、コピー元はスプシから取り直す（挙動OK済みで一覧に無いカードもカードNoで選べる）
      const d = await loadCardDetail(v);
      if (!d || !d.ok || !d.card) { setErr('カードが見つかりません: ' + v); return; }
      const c = d.card;
      const sc: CardData = {
        cardNo: String(c['カードNo'] || v), name: String(c['名前'] || ''), type: String(c['タイプ'] || ''),
        color: String(c['色'] || ''), lv: String(c['Lv'] || c['レベル'] || ''),
        effectText: String(c['効果テキスト'] || c['効果'] || ''), evoText: String(c['進化元テキスト'] || c['進化元効果'] || ''),
        securityText: String(c['セキュリティテキスト'] || c['セキュリティ効果'] || ''), recipe: String(c['レシピ'] || c['効果レシピ'] || ''),
      };
      if (!sc.recipe || sc.recipe === '""') { setErr('このカードにはレシピがありません'); return; }
      try { JSON.parse(sc.recipe); } catch (e) { setErr('コピー元のレシピが読めません: ' + (e as Error).message); return; }
      setSrc(sc);
      const s = suggestReplacements(textsOf(sc), textsOf(card));
      setPairs(s.pairs);
      setOnlySrc(s.onlyInSource);
      setOnlyDst(s.onlyInTarget);
    } catch (e) {
      setErr('取得に失敗しました: ' + ((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const preview = useMemo(() => {
    if (!src) return null;
    try {
      const r = applyReplacements(JSON.parse(src.recipe || "{}"), pairs);
      const missing = displayTextsNotInCard(r.recipe, textsOf(card));
      return { ...r, missing };
    } catch (_) { return null; }
  }, [src, pairs, card]);

  const setPair = (i: number, k: keyof ReplacePair, v: string) => setPairs((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div style={{ margin: '8px 0', padding: 8, border: '1px solid #90caf9', borderRadius: 4, background: '#f3f8fd', fontSize: 12 }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        <b>📄 他のカードのレシピをコピー</b>
        <span style={{ fontSize: 10, color: '#666' }}>（色違い・名称違いなど、テキストが一部だけ違うカード用。違う所を置き換えて読み込みます）</span>
      </label>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>コピー元:</span>
            <SearchSelect value={srcNo} onChange={pick} options={options} placeholder="カードNo か名前で検索（一覧に無いカードはカードNoを入力）" allowFreeText style={{ minWidth: 320 }} />
            {loading && <span>読込中...</span>}
          </div>
          {err && <div style={{ color: '#c62828', marginTop: 4 }}>{err}</div>}
          {src && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>置き換え（{src.cardNo} {src.name} → {card.cardNo} {card.name}）</div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
                テキストの違いから自動で作りました。足りない・おかしい組は直してください（レシピの文字列の値すべてに、同時に当てます）
              </div>
              <table style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  {pairs.map((p, i) => (
                    <tr key={i}>
                      <td><input value={p.from} onChange={(e) => setPair(i, 'from', e.target.value)} style={{ width: 160 }} /></td>
                      <td style={{ padding: '0 4px' }}>→</td>
                      <td><input value={p.to} onChange={(e) => setPair(i, 'to', e.target.value)} style={{ width: 160 }} /></td>
                      <td style={{ padding: '0 6px', color: preview && preview.counts[i] === 0 ? '#c62828' : '#555' }}>
                        {preview ? (preview.counts[i] === 0 ? 'レシピに無し' : preview.counts[i] + '箇所') : ''}
                      </td>
                      <td><button type="button" onClick={() => setPairs((x) => x.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" style={{ marginTop: 4 }} onClick={() => setPairs((x) => [...x, { from: '', to: '' }])}>＋ 置き換えを追加</button>
              {pairs.length === 0 && <div style={{ color: '#2e7d32', marginTop: 4 }}>テキストは同じです（置き換えなしでそのままコピーします）</div>}
              {(onlySrc.length > 0 || onlyDst.length > 0) && (
                <div style={{ marginTop: 6, padding: 6, background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 4 }}>
                  <b>⚠ 置き換えでは表せない違いがあります（コピー後に手で直してください）</b>
                  {onlySrc.map((s, i) => <div key={'s' + i}>コピー元だけ: 「{s}」</div>)}
                  {onlyDst.map((s, i) => <div key={'d' + i}>このカードだけ: 「{s}」</div>)}
                </div>
              )}
              {preview && preview.missing.length > 0 && (
                <div style={{ marginTop: 6, padding: 6, background: '#ffebee', border: '1px solid #e57373', borderRadius: 4 }}>
                  <b>⚠ 置き換え後の表示文が、このカードのテキストと一致しません</b>
                  {preview.missing.map((s, i) => <div key={i} style={{ whiteSpace: 'pre-wrap' }}>・{s}</div>)}
                </div>
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" disabled={!preview}
                  onClick={() => { if (preview && window.confirm('今の入力を、置き換えたコピー元のレシピで置き換えます（保存はまだしません）。よろしいですか？')) onApply(preview.recipe, src.cardNo); }}
                  style={{ background: '#1976d2', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>
                  ⬇ このカードに読み込む
                </button>
                <span style={{ fontSize: 10, color: '#666' }}>読み込んだ後、内容を確認してから「💾 スプシに保存」してください</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
