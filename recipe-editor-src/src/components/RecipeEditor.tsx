import { useEffect, useMemo, useState } from 'react';
import type { CardData, CardLevelSettings, EffectBlock } from '../types';
import { BlockEditor, MultiTextTags } from './BlockEditor';
import { applyCardLevelSettings, blocksToRecipe, parseCardLevelSettings, recipeToBlocks } from '../recipe';
import { saveRecipe, loadCardDetail } from '../api';
import type { DictAPI } from '../useDict';

function isMeaningfulText(s?: string): boolean {
  if (!s) return false;
  const t = s.trim();
  return t !== '' && t !== 'なし' && t !== '－' && t !== '-';
}

export function RecipeEditor({
  card,
  password,
  dict,
  onSaved,
  onDirtyChange,
}: {
  card: CardData;
  password: string;
  dict: DictAPI;
  onSaved: (cardNo: string, recipe: string) => void;
  // 保存していない変更があるか（カードの切り替え時に確認を出すため App に伝える）
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [blocks, setBlocks] = useState<EffectBlock[]>([]);
  // カード全体のルール（＜ルール：名称「〇〇」としても扱う＞ 等）。効果ステップとは別に保持し、
  // 保存時に recipe のトップレベルへ書き足す
  const [cardLevel, setCardLevel] = useState<CardLevelSettings>({});
  const [showCardLevel, setShowCardLevel] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  // 開いた時点（または最後に保存できた時点）のレシピ。これと違えば「未保存の変更あり」
  const [initial, setInitial] = useState<{ blocks: EffectBlock[]; cl: CardLevelSettings } | null>(null);

  useEffect(() => {
    setStatus('');
    if (card.recipe && card.recipe !== '""') {
      try {
        const parsed = JSON.parse(card.recipe);
        const bl = recipeToBlocks(parsed);
        setBlocks(bl);
        const cl = parseCardLevelSettings(parsed);
        setCardLevel(cl);
        setInitial({ blocks: bl, cl });
        setShowCardLevel(!!(cl.aliasNames && cl.aliasNames.length > 0));
      } catch (e) {
        setBlocks([]);
        setCardLevel({});
        setShowCardLevel(false);
        setInitial({ blocks: [], cl: {} });
        setStatus('既存レシピのパースに失敗: ' + (e as Error).message);
      }
    } else {
      setBlocks([]);
      setCardLevel({});
      setShowCardLevel(false);
      setInitial({ blocks: [], cl: {} });
    }
  }, [card.cardNo]);

  const recipeJson = useMemo(() => {
    const recipe = applyCardLevelSettings(blocksToRecipe(blocks, dict.keywords), cardLevel);
    return Object.keys(recipe).length > 0 ? JSON.stringify(recipe) : '';
  }, [blocks, dict.keywords, cardLevel]);

  // 開いた時点（または最後に保存できた時点）の内容を、今と同じ辞書で JSON にしたもの
  const baseline = useMemo(() => {
    if (!initial) return null;
    const r0 = applyCardLevelSettings(blocksToRecipe(initial.blocks, dict.keywords), initial.cl);
    return Object.keys(r0).length > 0 ? JSON.stringify(r0) : '';
  }, [initial, dict.keywords]);
  const dirty = baseline !== null && recipeJson !== baseline;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);
  // ページを閉じる・再読み込みするときも、未保存の変更があれば確認を出す
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  function addBlock() {
    setBlocks([...blocks, { section: 'main', trigger: '', triggerSubject: 'self', conditions: [] }]);
  }
  // 関数形の更新（setBlocks(prev => ...)）を使う: 同一レンダーサイクル内で
  // onChangeが連続して呼ばれるケース（例: 「アクション」ボタンを続けてクリックして
  // 複数選択を組み立てる操作）で、古いblocksを参照して直前の更新を打ち消してしまう
  // stale closureバグを防ぐため
  function updateBlock(i: number, b: EffectBlock) {
    setBlocks((prev) => {
      const next = prev.slice();
      next[i] = b;
      return next;
    });
  }
  function removeBlock(i: number) {
    setBlocks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveBlock(i: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setStatus('保存中...');
    try {
      const r = await saveRecipe(card.cardNo, recipeJson, password);
      if (r.ok) {
        onSaved(card.cardNo, recipeJson);
        // 保存したレシピがスプシに入ったかを読み直して確かめる（保存したのに反映されていない、を見逃さないため）
        setStatus('保存しました。スプシを確認中...');
        try {
          const d = await loadCardDetail(card.cardNo);
          const got = String((d && d.card && (d.card['レシピ'] || d.card['効果レシピ'])) || '');
          if (got === recipeJson) {
            setInitial({ blocks, cl: cardLevel });
            setStatus('✅ 保存完了（スプシで確認済み・行 ' + r.row + '）');
          } else {
            setStatus('⚠ 保存の応答はありましたが、スプシのレシピが今の内容と一致しません。もう一度保存してください');
          }
        } catch (_) {
          setInitial({ blocks, cl: cardLevel });
          setStatus('✅ 保存完了 (行 ' + r.row + ')（スプシの確認はできませんでした）');
        }
      } else {
        setStatus('❌ ' + (r.error || '保存失敗'));
      }
    } catch (e: any) {
      setStatus('❌ 通信エラー: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  // カードテキストに「としても扱う」ルールがあれば、カード全体のルール欄を最初から目立たせる
  const textMentionsAlias = [card.effectText, card.evoText, card.securityText].some((t) => /としても扱う/.test(t || ''));
  const aliasNames = cardLevel.aliasNames || [];

  const hasText =
    isMeaningfulText(card.effectText) ||
    isMeaningfulText(card.evoText) ||
    isMeaningfulText(card.securityText);

  return (
    <div className="editor">
      <h2>{card.cardNo} {card.name}</h2>
      <div className="meta">
        {card.type} / {card.color} / Lv.{card.lv}
      </div>

      {hasText && (
        <div className="text-block">
          {isMeaningfulText(card.effectText) && (
            <>
              <span className="label">📝 効果テキスト</span>
              {card.effectText}
            </>
          )}
          {isMeaningfulText(card.evoText) && (
            <>
              <span className="label">🌱 進化元テキスト</span>
              {card.evoText}
            </>
          )}
          {isMeaningfulText(card.securityText) && (
            <>
              <span className="label">🔒 セキュリティテキスト</span>
              {card.securityText}
            </>
          )}
        </div>
      )}

      {/* 📛 カード全体のルール: 効果ステップ（トリガー＋アクション）では表せない、カード自体の性質。
          ＜ルール：名称「マメモン」としても扱う＞（EX12-041 サンダーボールモン）→ alias_names。
          ［ジョグレス進化］は効果ステップのトリガー「🧬 ジョグレス進化」(jogress_evolve) で入力する */}
      <div style={{ margin: '8px 0', padding: 8, border: '1px solid #ce93d8', borderRadius: 4, background: '#faf5fc', fontSize: 12 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showCardLevel || aliasNames.length > 0}
            onChange={(e) => {
              setShowCardLevel(e.target.checked);
              // ✅を外したら入力も消す（出力JSONを元の形に戻す）
              if (!e.target.checked) setCardLevel({ ...cardLevel, aliasNames: undefined });
            }}
          />
          <b>📛 カード全体のルール</b>
          <span style={{ fontSize: 10, color: '#666' }}>（＜ルール：名称「〇〇」としても扱う＞ など）</span>
          {textMentionsAlias && aliasNames.length === 0 && (
            <span style={{ fontSize: 10, color: '#8e24aa', fontWeight: 'bold' }}>← このカードのテキストに「としても扱う」があります</span>
          )}
        </label>
        {(showCardLevel || aliasNames.length > 0) && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, color: '#6a1b9a', marginBottom: 4 }}>
              名称「〇〇」としても扱う（追加の名称・複数可）
            </div>
            <MultiTextTags
              values={aliasNames}
              onChange={(v) => setCardLevel({ ...cardLevel, aliasNames: v.length > 0 ? v : undefined })}
              placeholder="例: マメモン"
              accentColor="#8e24aa"
            />
            <div style={{ fontSize: 10, color: '#c62828', marginTop: 4 }}>
              ⚠ エンジン未実装です（保存はできますが、名称参照の判定にはまだ使われません）
            </div>
          </div>
        )}
      </div>

      <div className="blocks">
        {blocks.map((b, i) => (
          <BlockEditor
            key={i}
            block={b}
            index={i}
            dict={dict}
            onChange={(nb) => updateBlock(i, nb)}
            onRemove={() => removeBlock(i)}
            onMoveUp={i > 0 ? () => moveBlock(i, -1) : undefined}
            onMoveDown={i < blocks.length - 1 ? () => moveBlock(i, 1) : undefined}
            hasNoEvoText={!isMeaningfulText(card.evoText)}
          />
        ))}
        <div className="add-block" onClick={addBlock}>＋ 効果ステップを追加</div>
      </div>

      <h3 style={{ fontSize: 13, marginTop: 16 }}>📋 JSON プレビュー（リアルタイム）</h3>
      <div className="json-preview">{recipeJson || '(空 — ステップを追加してください)'}</div>

      <div className="save-bar save-bar-bottom">
        <button onClick={save} disabled={saving}>💾 スプシに保存</button>
        <button
          className="secondary"
          onClick={() => {
            if (card.recipe && card.recipe !== '""') {
              try {
                const parsed = JSON.parse(card.recipe);
                setBlocks(recipeToBlocks(parsed));
                const cl = parseCardLevelSettings(parsed);
                setCardLevel(cl);
                setShowCardLevel(!!(cl.aliasNames && cl.aliasNames.length > 0));
                setStatus('元のレシピに戻しました');
              } catch (_) {}
            } else {
              setBlocks([]);
              setCardLevel({});
              setShowCardLevel(false);
              setStatus('クリアしました');
            }
          }}
        >
          ↩ リセット
        </button>
        {dirty && <span className="status" style={{ color: '#c62828', fontWeight: 'bold' }}>● 未保存の変更があります</span>}
        <span className="status">{status}</span>
      </div>
    </div>
  );
}
