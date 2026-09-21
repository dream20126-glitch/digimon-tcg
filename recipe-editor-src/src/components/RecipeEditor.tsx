import { useEffect, useMemo, useState } from 'react';
import type { CardData, EffectBlock } from '../types';
import { BlockEditor } from './BlockEditor';
import { blocksToRecipe, recipeToBlocks } from '../recipe';
import { saveRecipe } from '../api';
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
}: {
  card: CardData;
  password: string;
  dict: DictAPI;
  onSaved: (cardNo: string, recipe: string) => void;
}) {
  const [blocks, setBlocks] = useState<EffectBlock[]>([]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus('');
    if (card.recipe && card.recipe !== '""') {
      try {
        const parsed = JSON.parse(card.recipe);
        setBlocks(recipeToBlocks(parsed));
      } catch (e) {
        setBlocks([]);
        setStatus('既存レシピのパースに失敗: ' + (e as Error).message);
      }
    } else {
      setBlocks([]);
    }
  }, [card.cardNo]);

  const recipeJson = useMemo(() => {
    const recipe = blocksToRecipe(blocks, dict.keywords);
    return Object.keys(recipe).length > 0 ? JSON.stringify(recipe) : '';
  }, [blocks, dict.keywords]);

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
        setStatus('✅ 保存完了 (行 ' + r.row + ')');
        onSaved(card.cardNo, recipeJson);
      } else {
        setStatus('❌ ' + (r.error || '保存失敗'));
      }
    } catch (e: any) {
      setStatus('❌ 通信エラー: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

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
                setBlocks(recipeToBlocks(JSON.parse(card.recipe)));
                setStatus('元のレシピに戻しました');
              } catch (_) {}
            } else {
              setBlocks([]);
              setStatus('クリアしました');
            }
          }}
        >
          ↩ リセット
        </button>
        <span className="status">{status}</span>
      </div>
    </div>
  );
}
