import { useState } from 'react';
import type { EffectBlock, ConditionPair, CostStep, MiniStep, DictEntry, AltAction, GrantedStep, KeywordEntry, DesignatedGroup, RuleGroup, FusionMaterialSlot, ExtraTarget } from '../types';
import {
  SECTIONS,
  DURATIONS,
  TARGETS,
  TARGET_COUNTS,
  FROM_ZONES,
  REF_SUBJECTS,
} from '../dict';
import type { DictAPI } from '../useDict';
import { isActionImplemented, isKeywordImplemented, isConditionImplemented, isOptionImplemented } from '../implemented';
import { SearchSelect, type SelectOption } from './SearchSelect';
import { hasRuleTranslator } from '../ruleTranslator';
import { suggestCode, suggestVisualType, kindToSingular, type DictKind } from './DictManager';
import { blocksToRecipe, getKeywordEntries, getDesignatedGroups } from '../recipe';

interface Props {
  block: EffectBlock;
  index: number;
  dict: DictAPI;
  onChange: (b: EffectBlock) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  // true のとき、キーワード効果のレシピ作成専用トリガー（アクティブフェイズ開始時 等）も
  // よく使うトリガーに追加表示する（通常のカードレシピ編集画面では出さない）
  isKeywordMode?: boolean;
  // true のとき、このカードの「進化元テキスト」欄が空/なし（＝実際には進化元由来の効果を
  // 持たないカード）であることを示す。区分=進化元 が選ばれているのに true な場合、
  // 「効果テキスト（メイン）由来の効果を誤って進化元区分にしていないか」の注意書きを出す
  hasNoEvoText?: boolean;
}

// 共通ヘルパ: code/label の配列 → SelectOption[]
function toOpts(arr: { code: string; label: string }[]): SelectOption[] {
  return arr.map((e) => ({ value: e.code, label: e.label }));
}

// ボタン式の単一選択グループ（区分・発動領域など、選択肢が少なく視覚的に選ばせたい項目用）
function ButtonGroup({ options, value, onChange, accentColor }: { options: { code: string; label: string }[]; value: string; onChange: (v: string) => void; accentColor?: string }) {
  const accent = accentColor || '#d81b60';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = value === o.code;
        return (
          <button
            key={o.code || '(empty)'}
            type="button"
            onClick={() => onChange(o.code)}
            style={{
              padding: '3px 9px',
              borderRadius: 5,
              border: active ? `2px solid ${accent}` : '1px solid #bbb',
              background: active ? accent : '#f5f5f5',
              color: active ? '#fff' : '#333',
              fontWeight: active ? 'bold' : 'normal',
              cursor: 'pointer',
              fontSize: 11,
              boxShadow: active ? `0 0 6px ${accent}99` : 'none',
              transition: 'all 0.12s ease',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ボタン式の複数選択グループ（色・タイプなど、複数トグルしてOR条件を作る項目用）
function MultiButtonGroup({ options, values, onToggle, accentColor }: { options: { code: string; label: string }[]; values: string[]; onToggle: (code: string, on: boolean) => void; accentColor?: string }) {
  const accent = accentColor || '#d81b60';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = values.includes(o.code);
        return (
          <button
            key={o.code || '(empty)'}
            type="button"
            onClick={() => onToggle(o.code, !active)}
            style={{
              padding: '3px 9px',
              borderRadius: 5,
              border: active ? `2px solid ${accent}` : '1px solid #bbb',
              background: active ? accent : '#f5f5f5',
              color: active ? '#fff' : '#333',
              fontWeight: active ? 'bold' : 'normal',
              cursor: 'pointer',
              fontSize: 11,
              boxShadow: active ? `0 0 6px ${accent}99` : 'none',
              transition: 'all 0.12s ease',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// 自由記述の複数タグ入力（特徴など、固定選択肢が無い項目のOR複数指定用）
function MultiTextTags({ values, onChange, placeholder, accentColor }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; accentColor?: string }) {
  const [draft, setDraft] = useState('');
  const accent = accentColor || '#d81b60';
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {values.map((v) => (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, border: `2px solid ${accent}`, background: accent, color: '#fff', fontSize: 11, fontWeight: 'bold' }}>
              {v}
              <button type="button" onClick={() => remove(v)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder || '例: サイボーグ型'}
          style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
        />
        <button type="button" onClick={add} style={{ padding: '3px 10px', borderRadius: 5, border: `1px solid ${accent}`, background: '#fff', color: accent, cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>+ 追加</button>
      </div>
    </div>
  );
}

const FUSION_COLOR_OPTS = [
  { code: '赤', label: '赤' }, { code: '青', label: '青' }, { code: '黄', label: '黄' },
  { code: '緑', label: '緑' }, { code: '黒', label: '黒' }, { code: '紫', label: '紫' }, { code: '白', label: '白' },
];

// app_gattai_evolve / jogress_evolve（アプ合体/ジョグレス進化）専用: 素材候補スロットのリスト編集。
// 1スロット=名称OR、または色OR+Lvのどちらか。候補数>使う体数なら「いずれかN体」判定になる
function FusionMaterialsEditor({
  slots,
  pickCount,
  onSlotsChange,
  onPickCountChange,
}: {
  slots: FusionMaterialSlot[];
  pickCount: number;
  onSlotsChange: (v: FusionMaterialSlot[]) => void;
  onPickCountChange: (v: number) => void;
}) {
  const updateSlot = (i: number, next: FusionMaterialSlot) => {
    const copy = slots.slice();
    copy[i] = next;
    onSlotsChange(copy);
  };
  const removeSlot = (i: number) => onSlotsChange(slots.filter((_, idx) => idx !== i));
  const addSlot = () => onSlotsChange([...slots, { names: [] }]);
  return (
    <div>
      {slots.map((s, i) => {
        const mode: 'name' | 'color' = s.colors && s.colors.length > 0 ? 'color' : 'name';
        return (
          <div key={i} style={{ border: '1px solid #ffb74d', borderRadius: 4, padding: 8, marginBottom: 6, background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 'bold', color: '#b76e00' }}>素材候補 {i + 1}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <ButtonGroup
                  options={[{ code: 'name', label: '名称' }, { code: 'color', label: '色+Lv' }]}
                  value={mode}
                  onChange={(v) => updateSlot(i, v === 'color' ? { colors: [], lv: s.lv } : { names: s.names || [] })}
                  accentColor="#b76e00"
                />
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: '#e53935', color: '#fff', cursor: 'pointer', fontSize: 11 }}
                >
                  ✕ 削除
                </button>
              </div>
            </div>
            {mode === 'name' ? (
              <MultiTextTags
                values={s.names || []}
                onChange={(v) => updateSlot(i, { names: v })}
                placeholder="例: エイドモン"
                accentColor="#b76e00"
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <MultiButtonGroup
                  options={FUSION_COLOR_OPTS}
                  values={s.colors || []}
                  onToggle={(code, on) => {
                    const cur = s.colors || [];
                    updateSlot(i, { ...s, colors: on ? [...cur, code] : cur.filter((c) => c !== code) });
                  }}
                  accentColor="#b76e00"
                />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11 }}>Lv.</span>
                  <input
                    type="number"
                    value={s.lv === undefined ? '' : String(s.lv)}
                    onChange={(e) => updateSlot(i, { ...s, lv: e.target.value === '' ? undefined : Number(e.target.value) })}
                    style={{ padding: '3px 5px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 55 }}
                  />
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
        <button
          type="button"
          onClick={addSlot}
          style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #b76e00', background: '#fff', color: '#b76e00', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}
        >
          + 素材候補を追加
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11 }}>同時に使う体数:</span>
          <input
            type="number"
            min={1}
            value={pickCount}
            onChange={(e) => onPickCountChange(Math.max(1, Number(e.target.value) || 1))}
            style={{ padding: '3px 5px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 50 }}
          />
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#8a5300', marginTop: 4 }}>
        素材候補の数 ＝ 使う体数 なら全候補が必須（ジョグレス型）。候補数 ＞ 使う体数 なら「いずれかN体」の組合せ判定になります（アプ合体型）。
      </div>
    </div>
  );
}

const DICT_KIND_LABELS: Record<DictKind, string> = {
  triggers: 'トリガー', conditions: '条件', actions: 'アクション', keywords: 'キーワード', options: '修飾子',
};

// レシピ編集中に「この項目が辞書にない」となったとき、その場で効果辞書（スプシ）に
// 新規登録できるミニフォーム。登録成功時は onRegistered(code) で呼び出し元のプルダウンに反映する
function InlineDictAdd({ kind, dict, onRegistered }: { kind: DictKind; dict: DictAPI; onRegistered: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  // キーワード専用: このキーワードの実体となるレシピ（エンジンが対応する出来事の組み合わせで
  // 表現できる場合のみ）。空のままなら今まで通り passive:[{flag}] のみで出力される
  const [templateBlocks, setTemplateBlocks] = useState<EffectBlock[]>([]);
  // キーワード専用:「対象」。true のとき、カード側でこのキーワードを選んだ際に
  // 「対象」絞り込み条件欄が出現し、templateBlocks内のcond_designated_nameがその内容で置き換わる
  const [hasNamedParam, setHasNamedParam] = useState(false);

  function autoSuggest() {
    if (!label.trim()) { setMsg('❌ 先に日本語名を入力してください'); return; }
    const suggested = suggestCode(label, kind, dict);
    if (!suggested) {
      setMsg('❌ 自動変換できませんでした。コードを手入力してください（英数字推奨）');
      return;
    }
    setCode(suggested);
    setMsg('');
  }

  function addTemplateBlock() {
    setTemplateBlocks([...templateBlocks, { section: 'main', trigger: '', triggerSubject: 'self', conditions: [] }]);
  }
  function updateTemplateBlock(i: number, b: EffectBlock) {
    const next = templateBlocks.slice();
    next[i] = b;
    setTemplateBlocks(next);
  }
  function removeTemplateBlock(i: number) {
    setTemplateBlocks(templateBlocks.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (!label.trim() || !code.trim()) { setMsg('❌ 日本語名とコードは必須'); return; }
    setSubmitting(true);
    setMsg('💾 スプシに書き込み中...');
    try {
      const extra: Record<string, any> = kind === 'actions' ? suggestVisualType(code.trim()) : {};
      if (kind === 'keywords' && templateBlocks.length > 0) {
        const recipe = blocksToRecipe(templateBlocks);
        if (Object.keys(recipe).length > 0) extra.recipeTemplate = JSON.stringify(recipe);
      }
      if (kind === 'keywords' && hasNamedParam) extra.hasNamedParam = true;
      const r = await dict.addEntry(kind, { code: code.trim(), label: label.trim(), kind: kindToSingular(kind), ...extra });
      if (r.ok) {
        setMsg('✅ 登録しました: ' + code.trim());
        onRegistered(code.trim());
        setOpen(false);
        setLabel('');
        setCode('');
        setTemplateBlocks([]);
        setHasNamedParam(false);
      } else {
        setMsg('❌ ' + (r.msg || '登録失敗'));
      }
    } catch (e: any) {
      setMsg('❌ 通信エラー: ' + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setMsg(''); }}
        style={{ marginTop: 4, padding: '2px 8px', fontSize: 11, border: '1px dashed #1976d2', background: 'white', color: '#1976d2', borderRadius: 4, cursor: 'pointer' }}
      >
        ＋ 辞書に新規登録
      </button>
    );
  }

  return (
    <div style={{ marginTop: 6, padding: 8, background: '#fffde7', border: '1px solid #e0c847', borderRadius: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#8a6d00', marginBottom: 4 }}>
        ＋ 効果辞書に新規登録（{DICT_KIND_LABELS[kind]}）
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="日本語名（例: 相手のデジモンがアタックしたとき）"
          style={{ flex: 1, minWidth: 160, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
        />
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="コード"
          style={{ width: 140, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
        />
        <button type="button" onClick={autoSuggest} style={{ padding: '3px 8px', fontSize: 11, border: '1px solid #1976d2', background: 'white', color: '#1976d2', borderRadius: 4, cursor: 'pointer' }}>
          🔄推測
        </button>
        <button type="button" onClick={handleSubmit} disabled={submitting} style={{ padding: '3px 10px', fontSize: 11, border: 'none', background: '#2e7d32', color: 'white', borderRadius: 4, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
          登録
        </button>
        <button type="button" onClick={() => { setOpen(false); setMsg(''); }} style={{ padding: '3px 8px', fontSize: 11, border: '1px solid #999', background: 'white', color: '#555', borderRadius: 4, cursor: 'pointer' }}>
          キャンセル
        </button>
      </div>
      {kind === 'keywords' && (
        <div style={{ marginTop: 8, padding: 8, background: 'white', border: '1px solid #e0c847', borderRadius: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 'bold', color: '#8a6d00', marginBottom: 4 }}>
            🔑 このキーワードの実際の効果（レシピ・任意）
          </div>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
            登場時/継続効果 等、既存のトリガー/アクションの組み合わせで表現できる場合のみ作成してください。
            空のままなら今まで通り「フラグとしてキーワード名を持つだけ」で登録されます（エンジン側の対応が別途必要）。
            ここで組んだ効果は、そのカード自身が「パッシブ」でこのキーワードを持つ場合だけでなく、
            他のカードが「キーワード付与」アクションでこのキーワードを対象に付与する場合にも、
            自動でその通りに発動するようになります（保存時に付与効果として変換されます）。
            <br />※【セキュリティアタック+2】のように数値がカードごとに変わる場合、ここでは値欄を空欄のままにしてください。
            カード側の「キーワード効果」バナーで入力した数値が、保存時にこの空欄部分へ自動で差し込まれます。
            <br />※「キーワード付与」での利用時は、効果ステップは1つ・トリガーも1種類にとどめてください
            （2つ目以降のステップは、そのカードを後で開き直して保存し直した際に失われるおそれがあります）。
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#8a6d00', marginBottom: 6 }}>
            <input type="checkbox" checked={hasNamedParam} onChange={(e) => setHasNamedParam(e.target.checked)} />
            対象（カード側でこのキーワードを選ぶと「対象」の絞り込み条件欄が出現し、下の発動条件/コスト
            対象の絞り込みで「指定」ボタンを使った箇所がその内容で置き換わります）
          </label>
          {templateBlocks.map((b, i) => (
            <BlockEditor
              key={i}
              block={b}
              index={i}
              dict={dict}
              onChange={(nb) => updateTemplateBlock(i, nb)}
              onRemove={() => removeTemplateBlock(i)}
              isKeywordMode
            />
          ))}
          <button
            type="button"
            onClick={addTemplateBlock}
            style={{ padding: '4px 8px', border: '1px dashed #8a6d00', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11, color: '#8a6d00' }}
          >
            ＋ 効果ステップを追加
          </button>
        </div>
      )}
      {msg && (
        <div style={{ fontSize: 11, marginTop: 4, color: msg.startsWith('✅') ? '#2e7d32' : '#c62828' }}>{msg}</div>
      )}
    </div>
  );
}

// キーワード選択欄（パッシブ/キーワード付与 共通）。1ブロックで複数キーワードを同時に
// 持たせたい場合（例: 進化元効果で【貫通】【分離】を両方常に持つ）に、行を追加して複数選択
// できるようにする。書き込みは keywordEntries[] を正とし、1件目は後方互換のため既存の
// keyword/value/keywordParamConditions* フィールドにも同期して書く（appendStepの通常の
// grant_keyword step構築ロジックが、今まで通りそれらのフィールドを読むだけで済むように
// するため。2件目以降は appendStep 側で getKeywordEntries().slice(1) から個別に処理する）
function KeywordEntriesEditor({
  block, onChange, dict, accentBorder, primaryValueElsewhere,
}: {
  block: EffectBlock;
  onChange: (b: EffectBlock) => void;
  dict: DictAPI;
  accentBorder: string;
  // true の場合、1件目（インデックス0）の数値欄はこのコンポーネント内では出さない
  // （grant_keyword: 通常のアクション「値」欄が既に block.value を管理しているため、
  // 二重の入力欄になってしまうのを避ける。2件目以降は他に置き場が無いのでここで出す）
  primaryValueElsewhere?: boolean;
}) {
  const entries = getKeywordEntries(block);
  const list: KeywordEntry[] = entries.length > 0 ? entries : [{ keyword: '' }];

  function commit(next: KeywordEntry[]) {
    onChange({
      ...block,
      keywordEntries: next,
      keyword: next[0]?.keyword || '',
      value: next[0]?.value,
      keywordParamConditions: next[0]?.keywordParamConditions,
      keywordParamConditionsOp: next[0]?.keywordParamConditionsOp,
      keywordCount: next[0]?.count,
      keywordDesignatedGroups: next[0]?.designatedGroups,
      keywordCommonConditions: next[0]?.commonConditions,
      keywordCommonConditionsOp: next[0]?.commonConditionsOp,
    });
  }
  function updateEntry(i: number, patch: Partial<KeywordEntry>) {
    const next = list.slice();
    next[i] = { ...next[i], ...patch };
    commit(next);
  }
  function removeEntry(i: number) {
    commit(list.length <= 1 ? [{ keyword: '' }] : list.filter((_, idx) => idx !== i));
  }
  function addEntry(keyword?: string) {
    commit([...list, { keyword: keyword || '' }]);
  }

  return (
    <>
      {list.map((entry, i) => (
        <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < list.length - 1 ? `1px dashed ${accentBorder}` : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <label style={{ fontWeight: 'bold' }}>
              🔑 キーワード{list.length > 1 ? `（${i + 1}）` : ''}
              {entry.keyword && (
                isKeywordImplemented(entry.keyword, !!dict.keywords.find((k) => k.code === entry.keyword)?.recipeTemplate)
                  ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 6 }}>✅実装済</span>
                  : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 6 }} title="エンジン未実装">⚠未実装</span>
              )}
            </label>
            {list.length > 1 && (
              <button
                type="button"
                onClick={() => removeEntry(i)}
                style={{ marginLeft: 'auto', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontSize: 11 }}
              >
                ✕
              </button>
            )}
          </div>
          <SearchSelect
            value={entry.keyword || ''}
            onChange={(v) => updateEntry(i, { keyword: v })}
            options={toOpts(dict.keywords)}
            allowFreeText
          />
          {!!dict.keywords.find((k) => k.code === entry.keyword)?.hasNamedParam && (() => {
            const groups = getDesignatedGroups(entry);
            const groupList: DesignatedGroup[] = groups.length > 0 ? groups : [{ conditions: [], conditionsOp: 'and' }];
            const setGroups = (next: DesignatedGroup[]) => updateEntry(i, { designatedGroups: next });
            const updateGroup = (gi: number, patch: Partial<DesignatedGroup>) => {
              const next = groupList.slice();
              next[gi] = { ...next[gi], ...patch };
              setGroups(next);
            };
            const removeGroup = (gi: number) => {
              setGroups(groupList.length <= 1 ? [{ conditions: [], conditionsOp: 'and' }] : groupList.filter((_, idx) => idx !== gi));
            };
            const addGroup = () => setGroups([...groupList, { conditions: [], conditionsOp: 'and' }]);
            return (
              <div style={{ marginTop: 6, padding: 6, background: '#fff', border: `1px solid ${accentBorder}`, borderRadius: 4 }}>
                {groupList.length > 1 && (
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px dashed ${accentBorder}` }}>
                    <div style={{ fontSize: 11, fontWeight: 'bold', color: '#666', marginBottom: 2 }}>
                      共通の絞り込み条件（全グループに自動でAND合成される）
                    </div>
                    <ConditionsHybridEditor
                      conditions={entry.commonConditions || []}
                      onChange={(next) => updateEntry(i, { commonConditions: next })}
                      dict={dict}
                      title="共通条件"
                      hint="（例:「特徴TB」を各グループで繰り返し書かなくて済むように、ここに1回だけ設定する）"
                      theme="action"
                      defaultSubject=""
                      showSubjectSelector={false}
                      conditionsOp={entry.commonConditionsOp || 'and'}
                      onConditionsOpChange={(op) => updateEntry(i, { commonConditionsOp: op })}
                    />
                  </div>
                )}
                {groupList.map((g, gi) => (
                  <div key={gi} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: gi < groupList.length - 1 ? `1px dashed ${accentBorder}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 'bold', color: '#666' }}>
                        対象{groupList.length > 1 ? `（${gi + 1}）` : ''}
                      </span>
                      {groupList.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeGroup(gi)}
                          style={{ marginLeft: 'auto', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontSize: 11 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <ConditionsHybridEditor
                      conditions={g.conditions || []}
                      onChange={(next) => updateGroup(gi, { conditions: next })}
                      dict={dict}
                      title="対象"
                      hint="（このキーワードが参照する対象の絞り込み・カードごとに指定。名前/Lv/記述/色は「異なる」も選べます）"
                      theme="action"
                      defaultSubject=""
                      showSubjectSelector={false}
                      conditionsOp={g.conditionsOp || 'and'}
                      onConditionsOpChange={(op) => updateGroup(gi, { conditionsOp: op })}
                      allowDistinctVariants
                    />
                    <div style={{ marginTop: 6 }}>
                      <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>
                        枚数（アセンブリ等、絞り込んだカードを何枚使うか・省略時は1枚）
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={g.count === undefined ? '' : String(g.count)}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateGroup(gi, { count: v === '' ? undefined : Number(v) });
                        }}
                        placeholder="例: 1"
                        style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 80 }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addGroup}
                  style={{ padding: '3px 9px', border: `1px dashed ${accentBorder}`, background: 'white', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                >
                  ＋ 条件グループを追加（別の絞り込み＋枚数を追加）
                </button>
              </div>
            );
          })()}
          {!(primaryValueElsewhere && i === 0) && (
            <div style={{ marginTop: 6 }}>
              <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>
                数値（【セキュリティアタック+2】等の数値がある場合のみ）
              </label>
              <input
                type="number"
                value={entry.value === undefined ? '' : String(entry.value)}
                onChange={(e) => {
                  const v = e.target.value;
                  updateEntry(i, { value: v === '' ? undefined : Number(v) });
                }}
                placeholder="例: 2"
                style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 120 }}
              />
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => addEntry()}
          style={{ padding: '3px 9px', border: `1px dashed ${accentBorder}`, background: 'white', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          ＋ キーワードを追加（複数同時に持たせる）
        </button>
        <InlineDictAdd kind="keywords" dict={dict} onRegistered={(v) => addEntry(v)} />
      </div>
    </>
  );
}

// コスト（「〇〇することで」発動）欄。通常のカードレシピ編集（発動条件の下）と
// コスト軽減トリガー（アセンブリ等）の両方から同じ見た目・同じ機能で使えるよう共通化した。
// action/target/fromZones/conditions等の意味はどちらの文脈でも同じ（block.costs → step.cost[]）
function CostListEditor({
  dict, costs, updateCost, addCost, removeCost, noCostLabel,
}: {
  dict: DictAPI;
  costs: CostStep[];
  updateCost: (i: number, c: CostStep) => void;
  addCost: () => void;
  removeCost: (i: number) => void;
  noCostLabel?: string;
}) {
  const [costOtherOpen, setCostOtherOpen] = useState<Record<number, boolean>>({});
  return (
    <>
      {costs.length === 0 && (
        <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>{noCostLabel || 'コストなし'}</div>
      )}
      {costs.map((c, i) => {
        // 位置サフィックス違い（evo_discard_top/_bottom/_select/_all 等）も同じ場所として
        // 扱えるよう、比較は常にベースコード（サフィックスを剥がしたもの）で行う。
        // ※ getActionVariant は POSITION_VARIANTS（このファイル下部でconst定義）を参照するため、
        //   モジュール読み込み時（top-level）には呼べない（TDZエラーで画面が真っ白になる）。
        //   ここ（コンポーネントのレンダー時＝モジュール読み込み完了後）で計算する
        const discardZoneBases = new Set(DISCARD_ZONE_MAP.map((z) => getActionVariant(z.action)?.base || z.action));
        const cActionBase = getActionVariant(c.action || '')?.base || (c.action || '');
        const isCommonCostAction = COMMON_COST_ACTIONS.some((a) => a.code === (c.action || ''))
          || discardZoneBases.has(cActionBase)
          || c.action === 'discard'
          || DECKPOS_COST_ACTIONS.some((a) => a.code === (c.action || ''))
          || PLACE_ACTION_CODES.has(c.action || '');
        // 「その他アクション」で辞書の discard（破棄する。エンジン未実装のプレースホルダー）
        // を選んだ直後（まだ場所未選択）も、この📥場所パネルを表示する入り口として扱う
        const isDiscardActive = discardZoneBases.has(cActionBase) || c.action === 'discard';
        // 「進化元」と「テイマー」はどちらも evo_discard 系を流用していてアクションの
        // ベースコードだけでは区別できないため、target も一致条件に加えて逆引きする
        // （target が無い場所=手札/デッキはアクションのみで一意に決まる）
        // 対象セクション側で「下/一番下」(_stack/_stack_bottom サフィックス)を付けても
        // 場所の判定が巻き戻らないよう、target 比較はサフィックスを剥がしたベースで行う
        const activeDiscardZone = DISCARD_ZONE_MAP.find((z) => {
          if ((getActionVariant(z.action)?.base || z.action) !== cActionBase) return false;
          if (z.target !== undefined && splitStackSuffix((c.target || '').split(':')[0]).base !== z.target) return false;
          return true;
        })?.code || '';
        // 「〇〇に置く」: PLACE_ZONE_MAP は各ゾーンのアクションコードが全て異なる
        // （place_on_security_top/place_under_tamer/place_under_digimon）ため、
        // 破棄のようなtarget逆引きは不要でアクションコードだけで一意に決まる
        const isPlaceActive = PLACE_ACTION_CODES.has(c.action || '');
        const activePlaceZone = PLACE_ZONE_MAP.find((z) => z.action === c.action)?.code || '';
        const isDeckPosAction = c.action === 'return_deck';
        // 位置バリアント対応（フラグ駆動+自動グループ化）は「その他」経由選択時のみ引き続き使う
        const { options: costActionOptions, flaggedBases: costFlaggedBases, autoGroupBases: costAutoGroupBases } = buildActionDisplay(dict.actions);
        const costCurVariant = getActionVariant(c.action || '');
        // 📥場所 フラグ判定用（hasFromZones。テイマーの下に置く等、辞書登録された新規
        // アクション向け）: まずアクションコード完全一致で辞書を引き、無ければ
        // 位置バリアントのベースコードでも引く（両対応）。
        // ※ 'place_on_security_top' のように、位置バリアントの一種ではないのに
        //   たまたま "_top" で終わるアクション名だと costCurVariant.base が
        //   実在しない 'place_on_security' になってしまうため、完全一致を優先する
        const costActionHasFlag = (flag: 'hasFromZones' | 'hasFaceOption'): boolean => {
          const exact = dict.actions.find((a) => a.code === (c.action || ''));
          if (exact?.[flag]) return true;
          const base = costCurVariant ? dict.actions.find((a) => a.code === costCurVariant!.base) : undefined;
          return !!base?.[flag];
        };
        const costIsFlaggedBaseDirect = costFlaggedBases.has(c.action || '');
        const costIsVariantOfFlagged = !!(costCurVariant && (costFlaggedBases.has(costCurVariant.base) || costAutoGroupBases.has(costCurVariant.base)));
        const costIsPositional = costIsFlaggedBaseDirect || costIsVariantOfFlagged;

        const costNormalizedActionValue = (() => {
          if (costIsFlaggedBaseDirect) return c.action || '';
          if (costCurVariant && costFlaggedBases.has(costCurVariant.base)) return costCurVariant.base;
          if (costCurVariant && costAutoGroupBases.has(costCurVariant.base)) return costCurVariant.base + '_top';
          return c.action || '';
        })();

        const costVariantOptions: SelectOption[] = (() => {
          if (!costIsPositional) return [];
          if (costIsFlaggedBaseDirect || (costCurVariant && costFlaggedBases.has(costCurVariant.base))) {
            return POSITION_VARIANTS.map((v) => ({ value: v.suffix, label: v.label }));
          }
          if (costCurVariant && costAutoGroupBases.has(costCurVariant.base)) {
            return POSITION_VARIANTS
              .filter((v) => dict.actions.some((a) => a.code === costCurVariant.base + v.suffix))
              .map((v) => ({ value: v.suffix, label: v.label }));
          }
          return [];
        })();
        const costCurrentSuffix = costCurVariant ? costCurVariant.suffix : '';

        function onCostActionChange(newCode: string) {
          const newIsFlaggedBase = costFlaggedBases.has(newCode);
          const newV = getActionVariant(newCode);
          const cur = c.action || '';
          const curV = getActionVariant(cur);
          const newBase = newIsFlaggedBase ? newCode : (newV ? newV.base : null);
          const curBase = curV ? curV.base : (costFlaggedBases.has(cur) ? cur : null);
          if (newBase && curBase && newBase === curBase) return;
          if (newIsFlaggedBase) {
            updateCost(i, { ...c, action: newCode + '_top' });
            return;
          }
          updateCost(i, { ...c, action: newCode });
        }
        function onCostVariantChange(newSuffix: string) {
          if (!newSuffix) return;
          const base = costIsFlaggedBaseDirect ? (c.action || '') : (costCurVariant ? costCurVariant.base : '');
          if (!base) return;
          updateCost(i, { ...c, action: base + newSuffix });
        }

        // 対象（TARGET_SELのL1/L2ボタン方式。アクションの対象と同じ体系）
        // 位置（本体/下/一番下）はカウント接尾辞(:1等)より前のbase側に付くので、
        // カウント分離の前にまずstackサフィックスを剥がす
        const cTgtRaw = (c.target || '').split(':')[0];
        const cTgtSuffix = (c.target || '').substring(cTgtRaw.length);
        const { base: cTgtBase, pos: cTgtStackPos } = splitStackSuffix(cTgtRaw);
        const cCurTgt = TARGET_SEL_CODE_TO_L1L2[cTgtBase] || { l1: '', l2: '' };
        // コストの対象では「オプション/プレイヤー/セキュリティ」を選択肢から除外。
        // 「最も多いプレイヤー」は専用の「何が多いか」選択肢(MOST_PLAYER_METRICS)を使う
        const cTgtL2Options = cCurTgt.l1 === 'most'
          ? MOST_PLAYER_METRICS
          : (TARGET_SEL_L2[cCurTgt.l1] || []).filter((o) => !['option', 'player', 'security'].includes(o.code));
        const cHideCount = cTgtBase === 'self' || cTgtBase === 'self_card' || cTgtBase === 'same_target';
        // デジモン/テイマー本体のときだけ「本体/下/一番下」を選べる（進化元／テイマーの
        // 下の"既存の"カードを指す。self=このカード自身の下も含む）。
        // 「〇〇に置く」系アクション（place_under_tamer 等）は新しいカードを追加する側で
        // 既存スタック内カードを指す概念が無い（位置は📍位置/deckPositionで別途指定する）
        // ため、対象がテイマー等でもこの欄自体を出さない。
        // evo_discard系（破棄→進化元/テイマー）も同様の理由で出さない: エンジン側が
        // targetの_stack(_bottom)?サフィックスを無条件に剥がして無視するため
        // （実際の上から/下から/選んで/全てはaction.code側のサフィックスでのみ判定される。
        // js/effect-engine.js の evo_discard*ケース _edBaseCode 参照）
        const costActionIsEvoDiscardFamily = /^evo_discard/.test(getActionVariant(c.action || '')?.base || c.action || '');
        const showCostStackPos = !PLACE_ACTION_CODES.has(c.action || '') && !costActionIsEvoDiscardFamily
          && (cCurTgt.l1 === 'self' || cCurTgt.l2 === 'digimon' || cCurTgt.l2 === 'tamer');
        const setCostStackPos = (pos: StackPos) => updateCost(i, { ...c, target: joinStackSuffix(cTgtBase, pos) + cTgtSuffix });
        const setCostTgt = (l1: string, l2?: string) => {
          // OR選択中に他のL1/L2へ切り替えたら、自動設定していたtype絞り込みは持ち越さない
          const cCleared = cIsOrMode ? { conditions: (c.conditions || []).filter((cc) => cc.base !== 'cond_type') } : {};
          if (!l1) { updateCost(i, { ...c, ...cCleared, target: '' }); return; }
          if (l1 === 'self') { updateCost(i, { ...c, ...cCleared, target: joinStackSuffix('self_card', cTgtStackPos) + cTgtSuffix }); return; }
          if (l1 === 'same_target') { updateCost(i, { ...c, ...cCleared, target: 'same_target' + cTgtSuffix }); return; }
          const useL2 = l2 || (cCurTgt.l1 === l1 && cCurTgt.l2 ? cCurTgt.l2 : (l1 === 'most' ? 'security' : 'digimon'));
          const newBase = TARGET_SEL_L1L2_TO_CODE[l1 + ':' + useL2] || '';
          // 位置は「デジモン/テイマー」を維持したときだけ引き継ぐ（カード/オプション等に
          // 切り替えたら位置指定自体が無意味になるため破棄する）
          const keepPos = useL2 === 'digimon' || useL2 === 'tamer';
          updateCost(i, { ...c, ...cCleared, target: joinStackSuffix(newBase, keepPos ? cTgtStackPos : '') + cTgtSuffix });
        };
        // デジモン/テイマーは複数選択可（対象・対象の条件と同じ操作感。両方選ぶと対象コードを
        // card+cond_typeフィルタに切り替える。「最も多いプレイヤー」等L2にdigimon/tamerが
        // 無いカテゴリでは常にfalseになるだけで無害）
        const cHasDigimonTamer = (cCurTgt.l1 === 'own' || cCurTgt.l1 === 'opp' || cCurTgt.l1 === 'other_own' || cCurTgt.l1 === 'both');
        const cDigimonCode = TARGET_SEL_L1L2_TO_CODE[cCurTgt.l1 + ':digimon'];
        const cTamerCode = TARGET_SEL_L1L2_TO_CODE[cCurTgt.l1 + ':tamer'];
        const cCardCode = TARGET_SEL_L1L2_TO_CODE[cCurTgt.l1 + ':card'];
        const cIsOrMode = cCurTgt.l2 === 'card' && (c.conditions || []).some((cc) => cc.base === 'cond_type' && /デジモン/.test(cc.value || '') && /テイマー/.test(cc.value || ''));
        const cDigimonChecked = cHasDigimonTamer && (cCurTgt.l2 === 'digimon' || cIsOrMode);
        const cTamerChecked = cHasDigimonTamer && (cCurTgt.l2 === 'tamer' || cIsOrMode);
        const cExclusiveL2Options = cTgtL2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer');
        const applyCostDigiTamerSelection = (nextDigimon: boolean, nextTamer: boolean) => {
          const restConds = (c.conditions || []).filter((cc) => cc.base !== 'cond_type');
          if (nextDigimon && nextTamer) {
            updateCost(i, { ...c, target: cCardCode + cTgtSuffix, conditions: [...restConds, { base: 'cond_type', value: 'デジモン,テイマー' }] });
          } else if (nextDigimon) {
            updateCost(i, { ...c, target: cDigimonCode + cTgtSuffix, conditions: restConds });
          } else if (nextTamer) {
            updateCost(i, { ...c, target: cTamerCode + cTgtSuffix, conditions: restConds });
          } else {
            updateCost(i, { ...c, target: '', conditions: restConds });
          }
        };
        // 「下/一番下」を選んだときだけ、積まれているカードの裏表・種別で絞り込める
        // （例:「テイマーの下にある裏向きのカードを破棄する」コスト）。
        // 実体は c.conditions への cond_face_down/cond_face_up + cond_type の追加。
        // 裏表・種別はそれぞれ単独項目（同時に2種類を選ぶ意味は無い）なので、
        // 見た目は横並びの複数選択ボタンだが内部では各グループ排他で1件ずつ管理する
        const costFaceType = (c.conditions || []).reduce((acc: { face: string; type: string }, p) => {
          if (p.base === 'cond_face_down') acc.face = 'face_down';
          else if (p.base === 'cond_face_up') acc.face = 'face_up';
          else if (p.base === 'cond_type') acc.type = COST_STACK_TYPE_VALUE_TO_CODE[p.value || ''] || '';
          return acc;
        }, { face: '', type: '' });
        const costFaceTypeActive = [costFaceType.face, costFaceType.type].filter(Boolean);
        const toggleCostFaceType = (code: string, on: boolean) => {
          const opt = COST_STACK_FACE_TYPE_OPTS.find((o) => o.code === code);
          if (!opt) return;
          let next = (c.conditions || []).filter((p) =>
            opt.group === 'face' ? (p.base !== 'cond_face_down' && p.base !== 'cond_face_up') : p.base !== 'cond_type'
          );
          if (on) {
            next = opt.group === 'face'
              ? [...next, { base: code === 'face_down' ? 'cond_face_down' : 'cond_face_up' }]
              : [...next, { base: 'cond_type', value: COST_STACK_TYPE_CODE_TO_VALUE[code] }];
          }
          updateCost(i, { ...c, conditions: next });
        };

        return (
          <div key={i} style={{ marginBottom: 6, padding: 6, border: '1px solid #ffe0b2', borderRadius: 4, background: '#fffbe6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: '#b76e00', fontWeight: 'bold' }}>コスト{i + 1}</div>
              <button
                onClick={() => removeCost(i)}
                style={{ padding: '0 8px', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11, height: 22 }}
              >
                ✕
              </button>
            </div>
            {/* アクション（よく使うコストアクション + 破棄(場所) + デッキに戻す/セキュリティに置く(位置) + その他） */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>アクション</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {COMMON_COST_ACTIONS.map((a) => {
                  const active = c.action === a.code;
                  return (
                    <button
                      key={a.code}
                      type="button"
                      onClick={() => updateCost(i, { ...c, action: a.code })}
                      style={{
                        padding: '3px 9px', borderRadius: 5,
                        border: active ? '2px solid #b76e00' : '1px solid #bbb',
                        background: active ? '#b76e00' : '#f5f5f5',
                        color: active ? '#fff' : '#333',
                        fontWeight: active ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: 11,
                      }}
                    >
                      {a.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    if (isDiscardActive) return;
                    const z = DISCARD_ZONE_MAP.find((zz) => zz.code === 'hand')!;
                    // fromZones は設定しない（📍位置ボタンで既に場所+位置を action コードへ
                    // エンコード済みのため、汎用の「セキュリティ/進化元の位置」パネルと二重表示になるのを防ぐ）
                    updateCost(i, { ...c, action: z.action, target: z.target || c.target, fromZones: undefined });
                  }}
                  style={{
                    padding: '3px 9px', borderRadius: 5,
                    border: isDiscardActive ? '2px solid #b76e00' : '1px solid #bbb',
                    background: isDiscardActive ? '#b76e00' : '#f5f5f5',
                    color: isDiscardActive ? '#fff' : '#333',
                    fontWeight: isDiscardActive ? 'bold' : 'normal',
                    cursor: 'pointer', fontSize: 11,
                  }}
                >
                  破棄
                </button>
                {DECKPOS_COST_ACTIONS.map((a) => {
                  const active = c.action === a.code;
                  return (
                    <button
                      key={a.code}
                      type="button"
                      onClick={() => updateCost(i, { ...c, action: a.code })}
                      style={{
                        padding: '3px 9px', borderRadius: 5,
                        border: active ? '2px solid #b76e00' : '1px solid #bbb',
                        background: active ? '#b76e00' : '#f5f5f5',
                        color: active ? '#fff' : '#333',
                        fontWeight: active ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: 11,
                      }}
                    >
                      {a.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    if (isPlaceActive) return;
                    const z = PLACE_ZONE_MAP.find((zz) => zz.code === 'security')!;
                    updateCost(i, { ...c, action: z.action, target: z.target || '' });
                  }}
                  style={{
                    padding: '3px 9px', borderRadius: 5,
                    border: isPlaceActive ? '2px solid #b76e00' : '1px solid #bbb',
                    background: isPlaceActive ? '#b76e00' : '#f5f5f5',
                    color: isPlaceActive ? '#fff' : '#333',
                    fontWeight: isPlaceActive ? 'bold' : 'normal',
                    cursor: 'pointer', fontSize: 11,
                  }}
                >
                  〇〇に置く
                </button>
              </div>
              {/* 〇〇に置く: 場所ボタン（セキュリティ/テイマー/バトルエリア。
                  選んだ場所に応じて実アクションコード・対象を切り替える） */}
              {isPlaceActive && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🎯 置き場所（どこに置くか）</div>
                  <ButtonGroup
                    options={PLACE_ZONE_MAP.map((z) => ({ code: z.code, label: z.label }))}
                    value={activePlaceZone}
                    onChange={(zoneCode) => {
                      if (zoneCode === activePlaceZone) return; // 選び直し済みの位置/裏表/場所を巻き戻さない
                      const z = PLACE_ZONE_MAP.find((zz) => zz.code === zoneCode);
                      if (!z) return;
                      updateCost(i, { ...c, action: z.action, target: z.target || '', deckPosition: undefined, options: [], fromZones: [] });
                    }}
                    accentColor="#b76e00"
                  />
                  {(() => {
                    const z = PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone);
                    return z?.warn ? (
                      <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{z.warn}</div>
                    ) : null;
                  })()}
                  {/* セキュリティ/テイマー/進化元のときだけ、置くカードの取得元（手札等）を選べる。
                      辞書のhasFromZonesフラグには頼らずPLACE_ZONE_MAP側で直接持たせている
                      （このボタン自体が辞書未登録のハードコードのため） */}
                  {PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone)?.hasFromZones && (() => {
                    const zones = c.fromZones || [];
                    const op = c.fromZonesOp || 'or';
                    const toggleZone = (code: string) => {
                      const next = zones.includes(code) ? zones.filter((z) => z !== code) : [...zones, code];
                      updateCost(i, { ...c, fromZones: next });
                    };
                    return (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📥 場所（どこから置くか）</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {FROM_ZONES.map((z) => {
                            const active = zones.includes(z.code);
                            return (
                              <button
                                key={z.code}
                                type="button"
                                onClick={() => toggleZone(z.code)}
                                style={{
                                  padding: '3px 9px', borderRadius: 5,
                                  border: active ? '2px solid #b76e00' : '1px solid #bbb',
                                  background: active ? '#b76e00' : '#f5f5f5',
                                  color: active ? '#fff' : '#333',
                                  fontWeight: active ? 'bold' : 'normal',
                                  cursor: 'pointer', fontSize: 11,
                                }}
                              >
                                {z.label}
                              </button>
                            );
                          })}
                        </div>
                        {zones.length >= 2 && (
                          <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ color: '#666' }}>結合:</span>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input type="radio" name={`placeFromZonesOp_${i}`} checked={op === 'or'} onChange={() => updateCost(i, { ...c, fromZonesOp: 'or' })} style={{ margin: 0 }} />
                              OR（いずれか）
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input type="radio" name={`placeFromZonesOp_${i}`} checked={op === 'and'} onChange={() => updateCost(i, { ...c, fromZonesOp: 'and' })} style={{ margin: 0 }} />
                              AND（全て）
                            </label>
                          </div>
                        )}
                        {/* 進化元/重ねられているカード/リンクカード以外の場所を含む場合のみ表示。
                            それらは専用の「〜の対象」欄（下記）で「誰の場所か」を表せるため省略する */}
                        {zones.some((z) => z !== 'evo_source' && z !== 'stacked_cards' && z !== 'linked') && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 誰の場所か</div>
                            <ButtonGroup
                              options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                              value={c.fromZoneOwner || ''}
                              onChange={(v) => updateCost(i, { ...c, fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                              accentColor="#b76e00"
                            />
                          </div>
                        )}
                        {(zones.includes('evo_source') || zones.includes('stacked_cards')) && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{zones.includes('stacked_cards') && !zones.includes('evo_source') ? '重ねられているカードの対象' : '進化元の対象'}</div>
                            <ButtonGroup
                              options={[{ code: '', label: '指定なし' }, { code: 'self', label: 'このデジモン' }, { code: 'other', label: '他のデジモン' }]}
                              value={c.evoSourceOwner || ''}
                              onChange={(v) => updateCost(i, { ...c, evoSourceOwner: (v || undefined) as 'self' | 'other' | undefined })}
                              accentColor="#b76e00"
                            />
                            {c.evoSourceOwner === 'other' && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                                <ButtonGroup
                                  options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                                  value={c.fromZoneOwner || ''}
                                  onChange={(v) => updateCost(i, { ...c, fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                                  accentColor="#b76e00"
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {zones.includes('linked') && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>リンクカードの対象</div>
                            <ButtonGroup
                              options={[{ code: '', label: '指定なし' }, { code: 'self', label: 'このデジモン' }, { code: 'other', label: '他のデジモン' }]}
                              value={c.linkedOwner || ''}
                              onChange={(v) => updateCost(i, { ...c, linkedOwner: (v || undefined) as 'self' | 'other' | undefined })}
                              accentColor="#b76e00"
                            />
                            {c.linkedOwner === 'other' && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                                <ButtonGroup
                                  options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                                  value={c.fromZoneOwner || ''}
                                  onChange={(v) => updateCost(i, { ...c, fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                                  accentColor="#b76e00"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* 場所に「セキュリティ」/「進化元」/「重ねられているカード」を含む場合のみ:
                      積み重ね順の上/下どちらから見るか（重ねられているカードもevo_sourceと同じ
                      evoSourcePosition/evoSourceOwnerを共用する） */}
                  {((c.fromZones || []).includes('security') || (c.fromZones || []).includes('evo_source') || (c.fromZones || []).includes('stacked_cards')) && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {(c.fromZones || []).includes('security') && (
                        <div>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 セキュリティの位置</div>
                          <ButtonGroup
                            options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }]}
                            value={c.securityPosition || ''}
                            onChange={(v) => updateCost(i, { ...c, securityPosition: (v || undefined) as 'top' | 'bottom' | undefined })}
                            accentColor="#b76e00"
                          />
                        </div>
                      )}
                      {((c.fromZones || []).includes('evo_source') || (c.fromZones || []).includes('stacked_cards')) && (
                        <div>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 {(c.fromZones || []).includes('stacked_cards') ? '重ねられているカードの位置' : '進化元の位置'}</div>
                          <ButtonGroup
                            options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'select', label: '選んで' }]}
                            value={c.evoSourcePosition || ''}
                            onChange={(v) => updateCost(i, { ...c, evoSourcePosition: (v || undefined) as 'top' | 'bottom' | 'select' | undefined })}
                            accentColor="#b76e00"
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {/* セキュリティ/テイマーのときだけ「上/下/下か上」を選べる */}
                  {PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone)?.hasPosition && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 位置</div>
                      <ButtonGroup
                        options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '下か上' }]}
                        value={c.deckPosition || ''}
                        onChange={(v) => updateCost(i, { ...c, deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                        accentColor="#b76e00"
                      />
                    </div>
                  )}
                  {/* セキュリティ/テイマーのときだけ「裏向き/表向き」を選べる */}
                  {PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone)?.hasFace && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🂠 裏表</div>
                      <ButtonGroup
                        options={[{ code: '', label: '表向き' }, { code: 'face_down', label: '裏向き' }]}
                        value={(c.options || []).includes('face_down') ? 'face_down' : ''}
                        onChange={(v) => updateCost(i, { ...c, options: v ? [v] : [] })}
                        accentColor="#b76e00"
                      />
                    </div>
                  )}
                </div>
              )}
              {/* デッキに戻す: 位置ボタン（下/上/下か上） */}
              {isDeckPosAction && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 位置</div>
                  <ButtonGroup
                    options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '下か上' }]}
                    value={c.deckPosition || ''}
                    onChange={(v) => updateCost(i, { ...c, deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                    accentColor="#b76e00"
                  />
                  {c.deckPosition === 'both' && (
                    <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>⚠ エンジン未対応です（保存はできますが「下」として動作します）</div>
                  )}
                </div>
              )}
              {/* 📥場所: 辞書の hasFromZones=true なアクション（例:「テイマーの下に置く」）
                  選択時のみ表示。破棄ボタン(DISCARD_ZONE_MAP)とは独立した汎用機構。
                  「〇〇に置く」(isPlaceActive)専用の📥場所パネルと辞書側hasFromZonesが
                  両方満たされるアクション（place_on_security_top等）では二重表示になって
                  しまうため、isPlaceActive中はこちらを出さない */}
              {(() => {
                if (isPlaceActive || !costActionHasFlag('hasFromZones')) return null;
                const zones = c.fromZones || [];
                const op = c.fromZonesOp || 'or';
                const toggleZone = (code: string) => {
                  const next = zones.includes(code) ? zones.filter((z) => z !== code) : [...zones, code];
                  updateCost(i, { ...c, fromZones: next });
                };
                return (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📥 場所</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {FROM_ZONES.map((z) => {
                        const active = zones.includes(z.code);
                        return (
                          <button
                            key={z.code}
                            type="button"
                            onClick={() => toggleZone(z.code)}
                            style={{
                              padding: '3px 9px', borderRadius: 5,
                              border: active ? '2px solid #1a4f8a' : '1px solid #bbb',
                              background: active ? '#1a4f8a' : '#f5f5f5',
                              color: active ? '#fff' : '#333',
                              fontWeight: active ? 'bold' : 'normal',
                              cursor: 'pointer', fontSize: 11,
                            }}
                          >
                            {z.label}
                          </button>
                        );
                      })}
                    </div>
                    {zones.length >= 2 && (
                      <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                        <span style={{ color: '#666' }}>結合:</span>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                          <input type="radio" name={`costFromZonesOp_${i}`} checked={op === 'or'} onChange={() => updateCost(i, { ...c, fromZonesOp: 'or' })} style={{ margin: 0 }} />
                          OR（いずれか）
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                          <input type="radio" name={`costFromZonesOp_${i}`} checked={op === 'and'} onChange={() => updateCost(i, { ...c, fromZonesOp: 'and' })} style={{ margin: 0 }} />
                          AND（全て）
                        </label>
                      </div>
                    )}
                    {zones.some((z) => z !== 'evo_source' && z !== 'stacked_cards' && z !== 'linked') && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 誰の場所か</div>
                        <ButtonGroup
                          options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                          value={c.fromZoneOwner || ''}
                          onChange={(v) => updateCost(i, { ...c, fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                          accentColor="#1a4f8a"
                        />
                      </div>
                    )}
                    {(zones.includes('evo_source') || zones.includes('stacked_cards')) && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{zones.includes('stacked_cards') && !zones.includes('evo_source') ? '重ねられているカードの対象' : '進化元の対象'}</div>
                        <ButtonGroup
                          options={[{ code: '', label: '指定なし' }, { code: 'self', label: 'このデジモン' }, { code: 'other', label: '他のデジモン' }]}
                          value={c.evoSourceOwner || ''}
                          onChange={(v) => updateCost(i, { ...c, evoSourceOwner: (v || undefined) as 'self' | 'other' | undefined })}
                          accentColor="#1a4f8a"
                        />
                        {c.evoSourceOwner === 'other' && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                            <ButtonGroup
                              options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                              value={c.fromZoneOwner || ''}
                              onChange={(v) => updateCost(i, { ...c, fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                              accentColor="#1a4f8a"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {zones.includes('linked') && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>リンクカードの対象</div>
                        <ButtonGroup
                          options={[{ code: '', label: '指定なし' }, { code: 'self', label: 'このデジモン' }, { code: 'other', label: '他のデジモン' }]}
                          value={c.linkedOwner || ''}
                          onChange={(v) => updateCost(i, { ...c, linkedOwner: (v || undefined) as 'self' | 'other' | undefined })}
                          accentColor="#1a4f8a"
                        />
                        {c.linkedOwner === 'other' && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                            <ButtonGroup
                              options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                              value={c.fromZoneOwner || ''}
                              onChange={(v) => updateCost(i, { ...c, fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                              accentColor="#1a4f8a"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* 場所に「セキュリティ」/「進化元」/「重ねられているカード」を含む場合のみ:
                  積み重ね順の上/下どちらから見るか（isPlaceActive中は901行目付近の専用パネルと
                  二重表示になるためこちらは出さない） */}
              {!isPlaceActive && ((c.fromZones || []).includes('security') || (c.fromZones || []).includes('evo_source') || (c.fromZones || []).includes('stacked_cards')) && (
                <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {(c.fromZones || []).includes('security') && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 セキュリティの位置</div>
                      <ButtonGroup
                        options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }]}
                        value={c.securityPosition || ''}
                        onChange={(v) => updateCost(i, { ...c, securityPosition: (v || undefined) as 'top' | 'bottom' | undefined })}
                        accentColor="#1a4f8a"
                      />
                    </div>
                  )}
                  {((c.fromZones || []).includes('evo_source') || (c.fromZones || []).includes('stacked_cards')) && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 {(c.fromZones || []).includes('stacked_cards') ? '重ねられているカードの位置' : '進化元の位置'}</div>
                      <ButtonGroup
                        options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'select', label: '選んで' }]}
                        value={c.evoSourcePosition || ''}
                        onChange={(v) => updateCost(i, { ...c, evoSourcePosition: (v || undefined) as 'top' | 'bottom' | 'select' | undefined })}
                        accentColor="#1a4f8a"
                      />
                    </div>
                  )}
                </div>
              )}
              {/* 🂠裏表: 辞書の hasFaceOption=true なアクション選択時のみ表示。
                  既存の修飾子コード face_down を c.options に書き込む
                  （「表向き」は指定なし＝デフォルトなので、options を空にするだけ） */}
              {(() => {
                if (!costActionHasFlag('hasFaceOption') || isDiscardActive) return null;
                const isFaceDown = (c.options || []).includes('face_down');
                return (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🂠 裏表</div>
                    <ButtonGroup
                      options={[{ code: '', label: '表向き' }, { code: 'face_down', label: '裏向き' }]}
                      value={isFaceDown ? 'face_down' : ''}
                      onChange={(v) => updateCost(i, { ...c, options: v ? [v] : [] })}
                      accentColor="#b76e00"
                    />
                  </div>
                );
              })()}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, marginTop: 4, color: '#666' }}>
                <input
                  type="checkbox"
                  checked={!!costOtherOpen[i] || (!!c.action && !isCommonCostAction)}
                  onChange={(e) => setCostOtherOpen((prev) => ({ ...prev, [i]: e.target.checked }))}
                />
                その他のアクション
              </label>
              {(!!costOtherOpen[i] || (!!c.action && !isCommonCostAction)) && (
                <div style={{ marginTop: 2 }}>
                  <SearchSelect
                    value={costNormalizedActionValue}
                    onChange={onCostActionChange}
                    options={costActionOptions}
                    allowFreeText
                    placeholder="--コストアクション--"
                  />
                  {costIsPositional && costVariantOptions.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <SearchSelect
                        value={costCurrentSuffix}
                        onChange={onCostVariantChange}
                        options={costVariantOptions}
                        placeholder="📍 位置"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* 値 */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
              <input
                type="text"
                value={c.value === undefined ? '' : String(c.value)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') updateCost(i, { ...c, value: undefined });
                  else if (/^\d+$/.test(v)) updateCost(i, { ...c, value: Number(v) });
                  else updateCost(i, { ...c, value: v });
                }}
                placeholder="値（枚数等）"
                style={{ width: 160, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>
            {/* 対象（ボタン方式） */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <MultiButtonGroup
                  options={TARGET_SEL_OWN_OPP}
                  values={[...(cCurTgt.l1 === 'own' || cCurTgt.l1 === 'both' ? ['own'] : []), ...(cCurTgt.l1 === 'opp' || cCurTgt.l1 === 'both' ? ['opp'] : [])]}
                  onToggle={(code, on) => {
                    const ownOn = cCurTgt.l1 === 'own' || cCurTgt.l1 === 'both';
                    const oppOn = cCurTgt.l1 === 'opp' || cCurTgt.l1 === 'both';
                    const nextOwn = code === 'own' ? on : ownOn;
                    const nextOpp = code === 'opp' ? on : oppOn;
                    setCostTgt(nextOwn && nextOpp ? 'both' : nextOwn ? 'own' : nextOpp ? 'opp' : '');
                  }}
                  accentColor="#b76e00"
                />
                <ButtonGroup
                  options={TARGET_SEL_L1_REST}
                  value={(cCurTgt.l1 === 'own' || cCurTgt.l1 === 'opp' || cCurTgt.l1 === 'both') ? TARGET_SEL_NONE_ACTIVE : cCurTgt.l1}
                  onChange={(l1) => setCostTgt(l1)}
                  accentColor="#b76e00"
                />
              </div>
              {cHasDigimonTamer && (
                <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <MultiButtonGroup
                    options={[{ code: 'digimon', label: 'デジモン' }, { code: 'tamer', label: 'テイマー' }]}
                    values={[...(cDigimonChecked ? ['digimon'] : []), ...(cTamerChecked ? ['tamer'] : [])]}
                    onToggle={(code, on) => applyCostDigiTamerSelection(
                      code === 'digimon' ? on : cDigimonChecked,
                      code === 'tamer' ? on : cTamerChecked
                    )}
                    accentColor="#b76e00"
                  />
                  {cExclusiveL2Options.length > 0 && (
                    <ButtonGroup
                      options={cExclusiveL2Options}
                      value={!cDigimonChecked && !cTamerChecked ? cCurTgt.l2 : ''}
                      onChange={(l2) => setCostTgt(cCurTgt.l1, l2)}
                      accentColor="#b76e00"
                    />
                  )}
                </div>
              )}
              {!cHasDigimonTamer && cTgtL2Options.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <ButtonGroup options={cTgtL2Options} value={cCurTgt.l2} onChange={(l2) => setCostTgt(cCurTgt.l1, l2)} accentColor="#b76e00" />
                </div>
              )}
              {/* 破棄: 場所/位置/裏表（対象欄に統合。以前はアクション欄側にあったが、
                  「対象」で全て設定できるようにするため、対象の絞り込み系コントロールと
                  ここへまとめた。選んだ場所に応じて実アクションコードを切り替える */}
              {isDiscardActive && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📥 場所（どこから破棄するか）</div>
                  <ButtonGroup
                    options={DISCARD_ZONE_MAP.map((z) => ({ code: z.code, label: z.label }))}
                    value={activeDiscardZone}
                    onChange={(zoneCode) => {
                      if (zoneCode === activeDiscardZone) return; // 選び直し済みの位置指定を巻き戻さない
                      const z = DISCARD_ZONE_MAP.find((zz) => zz.code === zoneCode);
                      if (!z) return;
                      // z.targetが無い場所（進化元/テイマー/手札/デッキ/リンクカード）では既存のtargetを
                      // そのまま維持する（「対象」欄で選んだ自分/相手を場所切替で巻き戻さないため）。
                      // fromZones は設定しない（📍位置ボタンで既に場所+位置を action コードへ
                      // エンコード済みのため、汎用の「セキュリティ/進化元の位置」パネルと二重表示になるのを防ぐ）
                      updateCost(i, { ...c, action: z.action, target: z.target || c.target, fromZones: undefined });
                    }}
                    accentColor="#b76e00"
                  />
                  {(() => {
                    const z = DISCARD_ZONE_MAP.find((zz) => zz.code === activeDiscardZone);
                    return z?.warn ? (
                      <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{z.warn}</div>
                    ) : null;
                  })()}
                  {/* 進化元/テイマー/セキュリティのときだけ、積まれたカードのどこから破棄するか選べる。
                      ※ 辞書側の hasPositionVariant フラグ（costIsPositional等）には依存しない。
                      DISCARD_ZONE_MAP はこのエディタ内で完結したハードコード機構であり、
                      辞書の設定状態に関わらず常に POSITION_VARIANTS 4種を出す。
                      これがevo_discard系の「上から/下から/選んで/全て」を決める唯一の実体
                      （エンジンはaction.codeのサフィックスだけを見る） */}
                  {(() => {
                    const zone = DISCARD_ZONE_MAP.find((zz) => zz.code === activeDiscardZone);
                    if (!zone?.hasPosition) return null;
                    const zoneBase = getActionVariant(zone.action)?.base || zone.action;
                    const curSuffix = getActionVariant(c.action || '')?.suffix || '';
                    return (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 位置</div>
                        <ButtonGroup
                          options={POSITION_VARIANTS.map((v) => ({ code: v.suffix, label: v.label }))}
                          value={curSuffix}
                          onChange={(suffix) => { if (!suffix) return; updateCost(i, { ...c, action: zoneBase + suffix }); }}
                          accentColor="#b76e00"
                        />
                      </div>
                    );
                  })()}
                  {/* 進化元/テイマー: 積まれたカードのうち裏向き/表向きのものだけを対象にするか
                      （place_under_tamer/place_under_digimon/deck_to_evo_bottomで裏向きに置かれた
                      カードを区別して破棄したい場合。cond_face_down/cond_face_up を conditions に
                      反映する */}
                  {(() => {
                    const zone = DISCARD_ZONE_MAP.find((zz) => zz.code === activeDiscardZone);
                    if (!zone?.hasFace) return null;
                    const faceConds = c.conditions || [];
                    const faceIdx = faceConds.findIndex((p) => p.base === 'cond_face_down' || p.base === 'cond_face_up');
                    const faceVal = faceIdx !== -1 ? (faceConds[faceIdx].base === 'cond_face_down' ? 'down' : 'up') : '';
                    return (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🂠 裏表</div>
                        <ButtonGroup
                          options={[{ code: '', label: '指定なし' }, { code: 'down', label: '裏向きのみ' }, { code: 'up', label: '表向きのみ' }]}
                          value={faceVal}
                          onChange={(v) => {
                            const next = faceConds.filter((p) => p.base !== 'cond_face_down' && p.base !== 'cond_face_up');
                            if (v === 'down') next.push({ base: 'cond_face_down' });
                            else if (v === 'up') next.push({ base: 'cond_face_up' });
                            updateCost(i, { ...c, conditions: next });
                          }}
                          accentColor="#b76e00"
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* デジモン/テイマー本体のときだけ「本体/下/一番下」を選べる（進化元／テイマーの下のカードを指す） */}
              {showCostStackPos && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>位置:</span>
                  <ButtonGroup options={STACK_POS_OPTIONS} value={cTgtStackPos} onChange={(v) => setCostStackPos(v as StackPos)} accentColor="#b76e00" />
                </div>
              )}
              {/* 「下/一番下」のときだけ、積まれているカードの裏表・種別で絞り込める */}
              {showCostStackPos && cTgtStackPos !== '' && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>裏表/種別:</span>
                  <MultiButtonGroup options={COST_STACK_FACE_TYPE_OPTS} values={costFaceTypeActive} onToggle={toggleCostFaceType} accentColor="#b76e00" />
                </div>
              )}
              {!cHideCount && cCurTgt.l1 && (
                <div style={{ marginTop: 4 }}>
                  <ButtonGroup
                    options={TARGET_COUNTS.map((o) => ({ code: o.code, label: o.label || '指定なし' }))}
                    value={cTgtSuffix}
                    onChange={(v) => updateCost(i, { ...c, target: joinStackSuffix(cTgtBase, cTgtStackPos) + v })}
                    accentColor="#b76e00"
                  />
                </div>
              )}
            </div>


            {/* === コスト対象の絞り込み条件（発動条件と同じConditionsHybridEditorを再利用） ===
                裏向き/表向き(cond_face_down/up)は上の「対象」欄の🂠裏表クイックトグルで管理する
                ため、ここには表示しない（同じconditions配列に書き込まれるが、このパネルの
                表示・編集対象からは除外し、他の条件を編集してもそのまま保持する） */}
            <div style={{ marginTop: 6 }}>
              <ConditionsHybridEditor
                conditions={(c.conditions || []).filter((cc) => !isRefFaceCond(cc.base))}
                onChange={(next) => updateCost(i, {
                  ...c,
                  conditions: [...(c.conditions || []).filter((cc) => isRefFaceCond(cc.base)), ...next],
                })}
                dict={dict}
                title="コスト対象の絞り込み"
                hint="（複数指定可）"
                theme="action"
                defaultSubject=""
                showSubjectSelector={false}
                conditionsOp={c.conditionsOp || 'and'}
                onConditionsOpChange={(op) => updateCost(i, { ...c, conditionsOp: op })}
              />
            </div>

            {/* === 代替コスト:「〇〇するか、〇〇することで」。効果1の代替アクション(altActions)
                と全く同じ仕組み（executeRecipeStep→runWithAltActions選択UI）をコストにも
                流用する。CostListEditor自身を再帰的に使い回し、2つ以上の代替も追加できる === */}
            <div style={{ marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#e65100' }}>
                <input
                  type="checkbox"
                  checked={Array.isArray(c.altCosts) && c.altCosts.length > 0}
                  onChange={(e) => {
                    updateCost(i, { ...c, altCosts: e.target.checked ? [{ action: '' }] : [] });
                  }}
                />
                🔀 代わりに別のコストでも支払える（「〇〇するか、〇〇することで」）
              </label>
              {Array.isArray(c.altCosts) && c.altCosts.length > 0 && (
                <div style={{ marginTop: 4, marginLeft: 16, padding: 8, background: '#fff8ec', border: '1px dashed #f9a825', borderRadius: 4 }}>
                  <CostListEditor
                    dict={dict}
                    costs={c.altCosts}
                    updateCost={(j, ac) => {
                      const next = (c.altCosts || []).slice();
                      next[j] = ac;
                      updateCost(i, { ...c, altCosts: next });
                    }}
                    addCost={() => updateCost(i, { ...c, altCosts: [...(c.altCosts || []), { action: '' }] })}
                    removeCost={(j) => updateCost(i, { ...c, altCosts: (c.altCosts || []).filter((_, idx) => idx !== j) })}
                    noCostLabel="代替コストなし"
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
      <button
        onClick={addCost}
        style={{
          padding: '4px 8px',
          border: '1px dashed #f9a825',
          background: 'white',
          borderRadius: 3,
          cursor: 'pointer',
          fontSize: 11,
          marginTop: 2,
          color: '#e65100',
        }}
      >
        ＋ コストを追加
      </button>
    </>
  );
}

// 発動領域ボタンの表示順・ラベル（ZONESの code:'' はバトルエリアを指す）
const ZONE_BUTTONS = [
  { code: 'hand', label: '手札' },
  { code: 'trash', label: 'トラッシュ' },
  { code: 'security', label: 'セキュリティ' },
  { code: 'breed', label: '育成エリア' },
  { code: '', label: 'バトルエリア' },
];

// 発動主体の2段階ボタン選択:
// 1段目「このカード/自分/相手/他/両方」→ 2段目「デジモン/カード/テイマー/プレイヤー」
// own_card/opp_card/other_own_card/other_own_tamer はエディタ側でのみ選べる新コード
// （エンジン側は未実装。実際にこの範囲を使うカードが出てきたら実装する）
// 「両方」は「デッキが増えたとき」のように、対象がデジモン/カード/テイマー等に
// 分解できないゾーン系トリガーで「自分/相手どちらでも」を表すための単独選択（L2無し）
const SUBJECT_L1 = [
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'other_own', label: '他' },
  { code: 'both', label: '両方' },
];
// 「自分」「相手」は複数選択できるトグルボタンにする（両方押すと'both'系に自動で切り替わる。
// アクションの対象/コストの対象と同じ操作感）。それ以外は従来通り単一選択のまま
const SUBJECT_OWN_OPP = SUBJECT_L1.filter((o) => o.code === 'own' || o.code === 'opp');
const SUBJECT_L1_REST = SUBJECT_L1.filter((o) => o.code !== 'own' && o.code !== 'opp' && o.code !== 'both');
const SUBJECT_L2 = [
  { code: 'digimon', label: 'デジモン' },
  { code: 'card', label: 'カード' },
  { code: 'tamer', label: 'テイマー' },
  { code: 'player', label: 'プレイヤー' },
];
const SUBJECT_L1L2_TO_CODE: Record<string, string> = {
  'own:digimon': 'own', 'own:card': 'own_card', 'own:tamer': 'own_tamer', 'own:player': 'own_player',
  'opp:digimon': 'opp', 'opp:card': 'opp_card', 'opp:tamer': 'opp_tamer', 'opp:player': 'opp_player',
  'other_own:digimon': 'other_own', 'other_own:card': 'other_own_card', 'other_own:tamer': 'other_own_tamer',
  // 「両方」+デジモン/カード/テイマー/プレイヤー: 自分/相手どちらでも該当する全てが対象
  // （例:「デジモンが登場したとき」を自分/相手どちらでも）。エンジン未実装のプレースホルダー
  'both:digimon': 'both_digimon', 'both:card': 'both_card', 'both:tamer': 'both_tamer', 'both:player': 'both_player',
};
const SUBJECT_CODE_TO_L1L2: Record<string, { l1: string; l2: string }> = {
  '': { l1: 'self', l2: '' },
  self: { l1: 'self', l2: '' },
  own: { l1: 'own', l2: 'digimon' },
  own_card: { l1: 'own', l2: 'card' },
  own_tamer: { l1: 'own', l2: 'tamer' },
  own_player: { l1: 'own', l2: 'player' },
  opp: { l1: 'opp', l2: 'digimon' },
  opp_card: { l1: 'opp', l2: 'card' },
  opp_tamer: { l1: 'opp', l2: 'tamer' },
  opp_player: { l1: 'opp', l2: 'player' },
  other_own: { l1: 'other_own', l2: 'digimon' },
  other_own_card: { l1: 'other_own', l2: 'card' },
  other_own_tamer: { l1: 'other_own', l2: 'tamer' },
  both: { l1: 'both', l2: '' },
  both_digimon: { l1: 'both', l2: 'digimon' },
  both_card: { l1: 'both', l2: 'card' },
  both_tamer: { l1: 'both', l2: 'tamer' },
  both_player: { l1: 'both', l2: 'player' },
};

// 条件の「対象」用の2段階ボタン選択（発動主体と同じ見た目のパターンだが、
// CONDITION_SUBJECTS のコード体系が発動主体と異なる＝別テーブルで持つ）
// - '既定'（空文字）= 対象を指定しない（アクション対象そのものを見る）
// - このカード配下は self（このデジモン）/ self_card（このカード全般）の2択のみ
// - 「他の自分のデジモン」は独立したL1ボタンではなく、自分+デジモン選択時の
//   「このカードを含める/含めない」トグルとして表現する（旧 other_own コード）
// 「両方」は「自分の効果で」のように自分/相手どちらでも成立しうる条件で使う単独選択（L2無し）
const COND_SUBJECT_L1 = [
  { code: '', label: 'なし' },
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'both', label: '両方' },
];
const COND_SUBJECT_L2: Record<string, { code: string; label: string }[]> = {
  self: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
  ],
  own: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
    { code: 'tamer', label: 'テイマー' },
    { code: 'any', label: '指定なし' },
  ],
  opp: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
    { code: 'tamer', label: 'テイマー' },
    { code: 'any', label: '指定なし' },
    { code: 'blocker', label: 'ブロッカー' },
  ],
};
const COND_SUBJECT_L1L2_TO_CODE: Record<string, string> = {
  'self:digimon': 'self', 'self:card': 'self_card',
  'own:digimon': 'own', 'own:card': 'own_card', 'own:tamer': 'own_tamer', 'own:any': 'own_any',
  'opp:digimon': 'opp', 'opp:card': 'opp_card', 'opp:tamer': 'opp_tamer', 'opp:any': 'opp_any', 'opp:blocker': 'opp_blocker',
};
// other_own: 旧「他」L1ボタンの単独コード。現在は 自分+デジモン 選択時の
// 「このカードを含めない」トグルとして残す（表示上は own+digimon と同じ扱い）
const COND_SUBJECT_CODE_TO_L1L2: Record<string, { l1: string; l2: string }> = {
  '': { l1: '', l2: '' },
  self: { l1: 'self', l2: 'digimon' },
  self_card: { l1: 'self', l2: 'card' },
  own: { l1: 'own', l2: 'digimon' },
  own_card: { l1: 'own', l2: 'card' },
  own_tamer: { l1: 'own', l2: 'tamer' },
  own_any: { l1: 'own', l2: 'any' },
  opp: { l1: 'opp', l2: 'digimon' },
  opp_card: { l1: 'opp', l2: 'card' },
  opp_tamer: { l1: 'opp', l2: 'tamer' },
  opp_any: { l1: 'opp', l2: 'any' },
  opp_blocker: { l1: 'opp', l2: 'blocker' },
  other_own: { l1: 'own', l2: 'digimon' },
  both: { l1: 'both', l2: '' },
};

// 「アクションの対象」用の2段階ボタン選択（TARGETS辞書のコード体系専用テーブル）。
// - 発動主体/条件対象とはコード名が異なる（相手のデジモン=opponent 等）
// - このカード(self)/他(other_own)/直前選択(same_target) はL2を持たない単独コード
//   （このカードは「デジモンでもテイマーでも同じ」ため self_card 固定でL2自体を出さない）
// - レスト/アクティブ状態は「対象の条件（ターゲットフィルタ）」側のチェックボックスで指定する
//   （対象コード自体に持たせる opponent_suspended 等の専用コードは使わない）
// - opp_security/target_other_own_card/target_other_own_tamer/opponent_tamer は
//   エンジン未実装のプレースホルダー（選べるが⚠警告を出す。既存の実装パターンと同様）
// === スタック位置（進化元／テイマーの下のカード）===
// 発動主体・対象で「デジモン」「テイマー」を指しているとき、それ自身ではなく
// 「その下に積まれているカード（進化元／テイマーの下のカード）」を指したい場合に使う。
// L1/L2の組合せコード表を位置ごとに増やす（combinatorial explosion）代わりに、
// 既存のコード文字列にサフィックス(_stack / _stack_bottom)を後付けする方式にしている。
// 「下」=進化元/テイマー下のスタック全体（任意の1枚）、「一番下」=スタックの一番下（末尾）の1枚。
// 例:「自分のテイマーの下のカードが破棄されたとき」→ subject: 'own_tamer_stack'
type StackPos = '' | 'stack' | 'stack_bottom';
const STACK_POS_OPTIONS: { code: StackPos; label: string }[] = [
  { code: '', label: '本体' },
  { code: 'stack', label: '下' },
  { code: 'stack_bottom', label: '一番下' },
];

// 「下」「一番下」を選んだときだけ出す、そのスタック内カードの種別絞り込み。
// 例:「自分のテイマーの下の“デジモンカード”が破棄されたとき」のように、進化元/テイマー
// 下のカードの中身をデジモン/テイマー/オプションで限定したいケース向け。
// 実体は trigger_conditions（発火元カードへのフィルタ）に cond_type として追加するだけ
// （RULE_TYPE_OPTS と同じ値セットを使い回す）。位置が「本体」のときは種別がL2選択
// （デジモン/テイマー）で既に確定しているため表示しない。
// ★エンジン未実装: when_evo_discard 系（_fireSidedReactionTriggers）は現状
//   trigger_conditions 自体を評価しないため、保存はできても動作しない（要エンジン対応）。
const STACK_CARD_TYPE_OPTS: { code: string; label: string }[] = [
  { code: '', label: 'カード' },
  { code: 'デジモン', label: 'デジモン' },
  { code: 'テイマー', label: 'テイマー' },
  { code: 'オプション', label: 'オプション' },
];

// コスト対象の「下/一番下」選択時に出す、積まれているカードの裏表・種別の
// 絞り込みボタン（複数選択見た目だが、内部は face/type 各グループ排他の1件ずつ）。
// 例:「テイマーの下にある裏向きのカードを1枚破棄することで」→ 裏向き + カード
// cond_face_down/cond_face_up はエンジン実装済み（card._faceDownを見る。
// place_under_tamer/place_under_digimon/deck_to_evo_bottomの裏向き配置と対応）
const COST_STACK_FACE_TYPE_OPTS: { code: string; label: string; group: 'face' | 'type' }[] = [
  { code: 'face_down', label: '裏向き', group: 'face' },
  { code: 'face_up', label: '表向き', group: 'face' },
  { code: 'card', label: 'カード', group: 'type' },
  { code: 'digimon', label: 'デジモン', group: 'type' },
  { code: 'tamer', label: 'テイマー', group: 'type' },
  { code: 'option', label: 'オプション', group: 'type' },
];
// COST_STACK_FACE_TYPE_OPTS の type 系ボタンコード ⇄ cond_type の実値（RULE_TYPE_OPTSと同じ表記）
const COST_STACK_TYPE_CODE_TO_VALUE: Record<string, string> = {
  card: 'カード', digimon: 'デジモン', tamer: 'テイマー', option: 'オプション',
};
const COST_STACK_TYPE_VALUE_TO_CODE: Record<string, string> = {
  'カード': 'card', 'デジモン': 'digimon', 'テイマー': 'tamer', 'オプション': 'option',
};

function splitStackSuffix(code: string): { base: string; pos: StackPos } {
  if (code.endsWith('_stack_bottom')) return { base: code.slice(0, -('_stack_bottom'.length)), pos: 'stack_bottom' };
  if (code.endsWith('_stack')) return { base: code.slice(0, -('_stack'.length)), pos: 'stack' };
  return { base: code, pos: '' };
}
function joinStackSuffix(base: string, pos: StackPos): string {
  return pos ? base + '_' + pos : base;
}

// 最も多いプレイヤー = 自分/相手のうち、指定ゾーン（セキュリティ/トラッシュ/手札/進化元）の
// 枚数が最も多い方のプレイヤー1人を対象にする。エンジン未実装（比較ロジックが無い）
const MOST_PLAYER_METRICS = [
  { code: 'security', label: 'セキュリティ' },
  { code: 'trash', label: 'トラッシュ' },
  { code: 'hand', label: '手札' },
  { code: 'evo_source', label: '進化元' },
];
const TARGET_SEL_UNIMPLEMENTED = new Set([
  'opp_security', 'target_other_own_card', 'target_other_own_tamer', 'opponent_tamer',
  'own_option', 'opponent_option',
  'most_security_player', 'most_trash_player', 'most_hand_player', 'most_evo_source_player',
  // 「両方（自分/相手）」＝側を問わず該当する全てが対象。「他」(other_own)と違い
  // このカード自身も対象に含む。エンジン未実装のプレースホルダー
  'both', 'both_card', 'both_tamer',
]);
const TARGET_SEL_L1 = [
  // target:''（空文字）はrecipe.ts保存時にfalsy判定でtargetフィールドごと省かれるため、
  // 実質的に「対象なし」と同じ結果になる（対象を持たないアクション用）
  { code: '', label: 'なし' },
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'other_own', label: '他' },
  // 自分/相手どちらでも該当する全てが対象（このカードを含む）。例:「デジモン1体をレストできる」
  // ボタン自体は単独では出さず、下の「自分」「相手」を両方トグルすると自動でこのコードになる
  // （登場/使用ボタンと同じ操作感）。describeTarget等のラベル逆引き用にリストには残す
  { code: 'both', label: '両方（自分/相手）' },
  { code: 'same_target', label: 'そのデジモン' },
  { code: 'most', label: '最も多いプレイヤー' },
];
// 「アクションの対象」L1のうち「自分」「相手」は複数選択できるトグルボタンにする
// （両方押すと'both'に自動で切り替わる。登場/使用ボタンと同じ操作感）。
// それ以外（既定/このカード/他/そのデジモン/最も多いプレイヤー）は従来通り単一選択のまま
const TARGET_SEL_OWN_OPP = TARGET_SEL_L1.filter((o) => o.code === 'own' || o.code === 'opp');
const TARGET_SEL_L1_REST = TARGET_SEL_L1.filter((o) => o.code !== 'own' && o.code !== 'opp' && o.code !== 'both');
// TARGET_SEL_L1_RESTには code:'' の「なし」が含まれるため、自分/相手/両方選択中に
// 「REST側は何も選ばれていない」ことを表すのに空文字は使えない（「なし」と誤って
// 一致してハイライトされてしまう）。どの実コードとも一致しない番兵値を使う
const TARGET_SEL_NONE_ACTIVE = ' none';
const TARGET_SEL_L2: Record<string, { code: string; label: string }[]> = {
  own: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
    { code: 'tamer', label: 'テイマー' },
    { code: 'option', label: 'オプション' },
    { code: 'security', label: 'セキュリティ' },
  ],
  opp: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
    { code: 'tamer', label: 'テイマー' },
    { code: 'option', label: 'オプション' },
    { code: 'player', label: 'プレイヤー' },
    { code: 'security', label: 'セキュリティ' },
  ],
  other_own: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
    { code: 'tamer', label: 'テイマー' },
  ],
  both: [
    { code: 'digimon', label: 'デジモン' },
    { code: 'card', label: 'カード' },
    { code: 'tamer', label: 'テイマー' },
  ],
};
const TARGET_SEL_L1L2_TO_CODE: Record<string, string> = {
  'own:digimon': 'own', 'own:card': 'own_card', 'own:tamer': 'own_tamer', 'own:option': 'own_option', 'own:security': 'own_security',
  'opp:digimon': 'opponent', 'opp:card': 'opponent_card', 'opp:tamer': 'opponent_tamer', 'opp:option': 'opponent_option', 'opp:player': 'opp_player', 'opp:security': 'opp_security',
  'other_own:digimon': 'target_other_own', 'other_own:card': 'target_other_own_card', 'other_own:tamer': 'target_other_own_tamer',
  'both:digimon': 'both', 'both:card': 'both_card', 'both:tamer': 'both_tamer',
  'most:security': 'most_security_player', 'most:trash': 'most_trash_player', 'most:hand': 'most_hand_player', 'most:evo_source': 'most_evo_source_player',
};
const TARGET_SEL_CODE_TO_L1L2: Record<string, { l1: string; l2: string }> = {
  '': { l1: '', l2: '' },
  self: { l1: 'self', l2: '' },
  self_card: { l1: 'self', l2: '' },
  own: { l1: 'own', l2: 'digimon' },
  own_card: { l1: 'own', l2: 'card' },
  own_tamer: { l1: 'own', l2: 'tamer' },
  own_option: { l1: 'own', l2: 'option' },
  own_security: { l1: 'own', l2: 'security' },
  opponent: { l1: 'opp', l2: 'digimon' },
  opponent_card: { l1: 'opp', l2: 'card' },
  opponent_tamer: { l1: 'opp', l2: 'tamer' },
  opponent_option: { l1: 'opp', l2: 'option' },
  opp_player: { l1: 'opp', l2: 'player' },
  opp_security: { l1: 'opp', l2: 'security' },
  target_other_own: { l1: 'other_own', l2: 'digimon' },
  target_other_own_card: { l1: 'other_own', l2: 'card' },
  target_other_own_tamer: { l1: 'other_own', l2: 'tamer' },
  both: { l1: 'both', l2: 'digimon' },
  both_card: { l1: 'both', l2: 'card' },
  both_tamer: { l1: 'both', l2: 'tamer' },
  same_target: { l1: 'same_target', l2: '' },
  most_security_player: { l1: 'most', l2: 'security' },
  most_trash_player: { l1: 'most', l2: 'trash' },
  most_hand_player: { l1: 'most', l2: 'hand' },
  most_evo_source_player: { l1: 'most', l2: 'evo_source' },
};

// アクションの対象コード（例:"opponent:1"）→ 対応する発動条件/トリガー条件の「対象」コードに
// 変換する（「対象と同じ」チェックボックス用）。対象側にしか無い種別（オプション/セキュリティ/
// プレイヤー/そのデジモン/最も多いプレイヤー等）は条件の対象に対応が無いためundefinedを返す
function targetBaseToCondSubject(targetStr: string | undefined): string | undefined {
  if (!targetStr) return undefined;
  const base = targetStr.split(':')[0];
  if (base === 'self_card') return 'self_card';
  if (base === 'self') return 'self';
  const l1l2 = TARGET_SEL_CODE_TO_L1L2[base];
  if (!l1l2 || !l1l2.l1 || l1l2.l1 === 'same_target' || l1l2.l1 === 'most') return undefined;
  return COND_SUBJECT_L1L2_TO_CODE[l1l2.l1 + ':' + l1l2.l2];
}

// よく使うトリガー:
// - 'event' 種別（登場時/進化時/アタック時/アタック終了時/消滅時）は実際に起きる出来事。
//   発動ターン(自分/相手/お互い)を選ぶと、トリガーコード自体は変えず
//   cond_during_own_turn/cond_during_opp_turnを条件として追加する（お互い=条件なし）。
//   「誰がアタックしたか」等の主体は発動ターンではなく発動主体(subject)で表現する
//   （on_attack 等の source-only トリガーは、他カードの subject 付き反応レシピも
//    _scanReactiveSubjectsForSourceOnly が拾うため、when_opp_attack 等の専用トリガー
//    コードに切り替える必要が無い。かつ trigger_conditions も使えるためこちらが高機能）。
// - 'timing' 種別（メイン/ターン開始時/ターン終了時/継続効果/メインフェイズ開始時）は
//   発動ターンによってトリガーコード自体が切り替わる。
//   engine未実装の組み合わせ（例: メイン+相手）も選べるようにするため、実在しない
//   プレースホルダーコードを用意している（isImplemented:falseの箇所）。
type TimingKey = 'self' | 'opp' | 'any';
interface TriggerFamily {
  code: string; // ボタンのkey
  label: string;
  kind: 'event' | 'timing';
  variants?: Record<TimingKey, string>; // kind='timing'のときのみ
  implemented?: Partial<Record<TimingKey, boolean>>; // 未指定=true扱い
}
const COMMON_TRIGGER_FAMILIES: TriggerFamily[] = [
  { code: 'on_play', label: '登場時', kind: 'event' },
  { code: 'on_evolve', label: '進化時', kind: 'event' },
  { code: 'on_move', label: '移動時', kind: 'event' },
  { code: 'on_link', label: 'リンク時', kind: 'event' },
  // アタック時/アタック終了時は event 種別（トリガーコード自体は on_attack/on_attack_end 固定）。
  // 「誰がアタックしたか」は発動主体（subject: self/own/other_own/opp）で表現する
  // （on_attack は source-only トリガーだが、subject 付きの他カードの反応レシピも
  //   _scanReactiveSubjectsForSourceOnly が拾ってくれるため、when_opp_attack 等の
  //   専用トリガーコードに切り替える必要が無い。かつ trigger_conditions もそちらでは
  //   使えないため、subject 方式の方が高機能）。「誰のターンか」は発動ターンが
  //   別途 cond_during_own_turn/opp_turn を付与する。
  // ※ on_attack_end は現状 _scanReactiveSubjectsForSourceOnly の対象外のため、
  //   subject:'opp' 等の他カード反応は拾えない（要エンジン対応）
  { code: 'on_attack', label: 'アタック時', kind: 'event' },
  { code: 'on_attack_end', label: 'アタック終了時', kind: 'event' },
  { code: 'on_destroy', label: '消滅時', kind: 'event' },
  {
    code: 'main', label: 'メイン', kind: 'timing',
    variants: { self: 'main', opp: 'opp_main', any: 'any_main' },
    implemented: { self: true, opp: false, any: false },
  },
  {
    code: 'turn_start', label: 'ターン開始時', kind: 'timing',
    variants: { self: 'on_own_turn_start', opp: 'on_opp_turn_start', any: 'on_any_turn_start' },
    implemented: { self: true, opp: true, any: false },
  },
  {
    code: 'turn_end', label: 'ターン終了時', kind: 'timing',
    variants: { self: 'on_own_turn_end', opp: 'on_opp_turn_end', any: 'on_any_turn_end' },
    implemented: { self: true, opp: true, any: false },
  },
  {
    code: 'during_turn', label: '継続効果', kind: 'timing',
    variants: { self: 'during_own_turn', opp: 'during_opp_turn', any: 'during_any_turn' },
    implemented: { self: true, opp: true, any: true },
  },
  {
    code: 'main_phase_start', label: 'メインフェイズ開始時', kind: 'timing',
    variants: { self: 'on_main_phase_start', opp: 'on_opp_main_phase_start', any: 'on_any_main_phase_start' },
    implemented: { self: true, opp: true, any: false },
  },
];
// キーワード効果のレシピ作成画面でのみ選べるトリガー。通常のカードレシピでは
// 「相手のアクティブフェイズ開始時」のような出来事を使うことがまず無いため、
// 選択肢を汚さないようにこちらに分離している（isKeywordMode時のみ結合して使う）
const KEYWORD_ONLY_TRIGGER_FAMILIES: TriggerFamily[] = [
  {
    code: 'active_phase_start', label: 'アクティブフェイズ開始時', kind: 'timing',
    variants: { self: 'on_own_active_phase_start', opp: 'on_opp_active_phase_start', any: 'on_any_active_phase_start' },
    implemented: { self: false, opp: false, any: false },
  },
];
// 【アタック時】【アタック終了時】ファミリーの全バリアントコード。
// アタック対象(cond_attack_target_*)関連のUIをこのトリガーのときだけ出す判定に使う
const ATTACK_TRIGGER_CODES = ['on_attack', 'when_opp_attack', 'on_any_attack', 'on_attack_end', 'when_opp_attack_end', 'on_any_attack_end'];
const TIMING_OPTIONS: { code: TimingKey; label: string }[] = [
  { code: 'self', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'any', label: 'お互い' },
];

// 【コスト軽減】は自分/相手/お互いの軸ではなく「何のコストを軽減するか」の軸を持つ特殊トリガー。
// 登場コスト・使用コスト(オプション/テイマー)は実装上どちらも summon_cost 一本（getEffectivePlayCost
// が playCost に対して一律に適用するため区別がない）。ボタンを分けると同一コードで選択状態が
// 一致してしまい押しても反映されないため、「登場/使用」1ボタンにまとめる。
// 進化コストは常時軽減の専用recipeキーが未実装（evo_cost_minusは単発アクションのみ）なので、
// エンジン未対応のプレースホルダーコードとして用意する。
const COST_REDUCTION_VARIANTS: { code: string; label: string; trigger: string; implemented: boolean }[] = [
  { code: 'summon', label: '登場/使用', trigger: 'summon_cost', implemented: true },
  { code: 'evolve', label: '進化', trigger: 'evo_cost', implemented: false },
];
const COST_REDUCTION_TRIGGERS = new Set(COST_REDUCTION_VARIANTS.map((v) => v.trigger));

// アプ合体/ジョグレス進化: 複数体の素材を同時使用する特殊進化トリガー。
// 演出が異なるため2つの独立したトリガーコードに分けているが、素材候補UI（FusionMaterialsEditor）は共通
const FUSION_EVOLVE_TRIGGERS = new Set(['app_gattai_evolve', 'jogress_evolve']);

// 【〇〇が増えたとき】: 元々「デッキが増えたとき」(when_deck_increase) 専用だったトリガーを、
// どのゾーンが増えたときかを選べるように一般化したもの。トリガーキー自体は常に
// when_deck_increase のまま1つで、どのゾーンを見るかは block.zoneIncrease[]（既存の
// fromZones/fromZonesOpと全く同じ「複数選択+OR/AND」の作り）で表現する。
// COST_REDUCTION_VARIANTS と違い、こちらは通常の「〇〇したとき」系トリガーと同じく
// アクション/対象/条件を普通に編集する（常時判定される特殊トリガーではないため、
// 専用パネルには置き換えない）
const ZONE_INCREASE_TRIGGER = 'when_deck_increase';
const ZONE_INCREASE_OPTIONS: { code: string; label: string; implemented: boolean }[] = [
  { code: 'deck', label: 'デッキ', implemented: true },
  { code: 'hand', label: '手札', implemented: false },
  { code: 'security', label: 'セキュリティ', implemented: false },
  { code: 'trash', label: 'トラッシュ', implemented: false },
  { code: 'evo_source', label: '進化元', implemented: false },
];

// よく使うアクション: カードDB(data/cards.json)のレシピ内action出現数を集計し、
// 上位のものをボタン化（トリガー家族ボタンと同じ操作感にするため）。
// 出現数目安: DP+84 / メモリー+48 / レスト40 / 登場36 / ドロー35 / キーワード付与33 /
// 消滅31 / アクティブ27 / デッキオープン24 / DP-21 / メモリー-20 / 回復16
const COMMON_ACTIONS: { code: string; label: string }[] = [
  { code: 'dp_plus', label: 'DP+' },
  { code: 'dp_minus', label: 'DP-' },
  { code: 'memory_plus', label: 'メモリー+' },
  { code: 'memory_minus', label: 'メモリー-' },
  { code: 'rest', label: 'レスト' },
  { code: 'active', label: 'アクティブ' },
  // 「登場/使用」は独立した2ボタン（SUMMON_KIND_OPTIONS）に置き換えたため、ここには含めない
  // （トリガーの複数選択と同じ操作感で、両方押すとsummon/片方だけだとsummon_appear/
  // summon_useになる。COMMON_ACTIONS.mapの直前で個別にレンダリングする）
  { code: 'draw', label: 'ドロー' },
  { code: 'grant_keyword', label: 'キーワード付与' },
  { code: 'destroy', label: '消滅' },
  { code: 'deck_open', label: 'デッキオープン' },
  { code: 'recover', label: 'リカバリー' },
  { code: 'evolve', label: '進化' },
  { code: 'dedigivolve', label: '退化' },
  { code: 'link', label: 'リンク' },
  { code: 'attack', label: 'アタック' },
  { code: 'block', label: 'ブロック' },
];
// 「登場」「使用」の2ボタン（SUMMON_KIND_OPTIONS）: トリガーの複数選択と同じ操作感で、
// 両方押すと action:'summon'（従来通りどちらも対象）、片方だけだと summon_appear
// （デジモン/テイマー限定）／summon_use（オプション限定）になる。3つとも
// summon/evolve/linkと同じ辞書未登録のビルトインアクション（BUILTIN_FROM_ZONE_ACTIONS）
const SUMMON_KIND_CODES = new Set(['summon', 'summon_appear', 'summon_use']);
const SUMMON_KIND_OPTIONS: { code: 'appear' | 'use'; label: string }[] = [
  { code: 'appear', label: '登場' },
  { code: 'use', label: '使用' },
];
// 「レスト」「アクティブ」「進化」「アタック」「ブロック」「消滅」ボタン専用: 「する」
// （通常の状態変化アクション）と「できない」（それを封じるアクション）を切り替えられるようにする。
// アクションコード自体が別物（例: rest⇔cant_rest）なため、単純な位置バリアント
// （POSITION_VARIANTS的なsuffix切替）ではなく専用の対応表で管理する。
// これはあくまでフォールバック既定値。実際に使われるのはコンポーネント内で構築する
// DOABLE_TO_CANT_LIVE（このデフォルト値 ＋ 辞書側 dict.actions[].cantActionCode で
// 上書き/追加したもの）。「する/できない」表示を出したい新規アクションは、今後は
// ここに直書きせず「効果辞書管理」画面のアクション編集フォームで
// 「できないコード」を登録すれば自動で反映される
// cant_rest / block / cant_destroy / cant_redirect_attack は辞書未登録・エンジンも
// 未実装（該当カードが来たら追加実装）。
// ※ cant_destroy は「選んだ対象は消滅しない」の意味。既存のprevent_destroy系アクションは
// 対象選択ではなくctx.card（効果を持つカード自身）を保護する別物のため流用しない
const DOABLE_TO_CANT: Record<string, string> = {
  rest: 'cant_rest',
  active: 'not_active',
  evolve: 'cant_evolve',
  attack: 'cant_attack',
  block: 'cant_block',
  destroy: 'cant_destroy',
  dp_minus: 'cant_dp_minus',
};
const CANT_TO_DOABLE: Record<string, string> = Object.fromEntries(
  Object.entries(DOABLE_TO_CANT).map(([doable, cant]) => [cant, doable])
);
// よく使うコストアクション（「〇〇することで」の〇〇部分）
// 「破棄」と「デッキに戻す/セキュリティに置く」は下の DISCARD_ZONE_MAP / DECKPOS_COST_ACTIONS で
// 第二ボタン（場所・位置）付きで個別にレンダリングするため、ここには含めない
const COMMON_COST_ACTIONS: { code: string; label: string }[] = [
  { code: 'rest', label: 'レストさせる' },
  { code: 'cost_destroy_other', label: '消滅させる' },
];
// 「破棄」ボタン: 押すと「どこから破棄するか」の第二ボタン（場所）が現れ、選んだ場所に応じて
// 実際のアクションコードに切り替える（エンジンには「破棄+場所」の汎用実装が無く、手札/進化元/
// セキュリティ/デッキそれぞれ別のアクションコードで実装されているため）。
// target は「対象」欄（自分/相手デジモン等）と共有のフィールドなので、ここでは基本的に
// 触らない（場所を選んでも対象欄の値を上書きしない・対象欄を変えても場所の選択状態が
// 崩れないようにするため）。
//   - hand/deck (cost_discard/deck_trash_top) はもともとtarget不要
//   - security (security_trash_select) は、かつてtarget:'own_security'を初期値として
//     設定していたが、「対象」欄（自分/相手→セキュリティ）と書き込みが競合し、位置選択後に
//     場所/位置の選択表示が消える不具合があったため撤廃。誰のセキュリティから破棄するかは
//     「対象」欄で選ぶ（位置ボタンも「対象」欄のセキュリティ選択時に表示する。下記の
//     「セキュリティ/テイマーのときだけ「上/下/下か上」を選べる」パネルとは別に、
//     🎯対象パネル内の「セキュリティ選択時の位置」を参照）
//   - evo_source (evo_discard系) はtargetのown/own_tamer/opponent_tamerを見て自分の
//     デジモン/自分のテイマー/相手のテイマーの下を正しく判定できる（js/effect-engine.js
//     の evo_discard* ケース参照。実カードBT26-003/005/021で target:"own_tamer"実績あり）。
//     かつて別コード（evo_discard_tamer_*）でテイマー専用の場所ボタンを分けていたが、
//     自分固定でtargetの自分/相手選択も効かない下位互換だったため撤廃し、evo_sourceに統合。
//     「対象」欄でデジモン/テイマーどちらを選んでも、この1つの場所ボタンで完結する
// hasPosition:true の場所は「進化元/テイマー/セキュリティ」のように積まれたカードから
// 1枚選ぶ概念があるため、下に「上から/下から/選んで/全て」ボタンを追加表示する
// （実体は POSITION_VARIANTS と同じ仕組みでアクションコードのsuffixを切り替える。
// costIsPositional/costVariantOptions/onCostVariantChange を流用）。
// 手札/デッキには順序の概念が無い（デッキは上からのみ固定）ため出さない。
const DISCARD_ZONE_MAP: { code: string; label: string; action: string; target?: string; warn?: string; hasPosition?: boolean; hasFace?: boolean }[] = [
  { code: 'evo_source', label: '進化元／テイマーの下', action: 'evo_discard_top', hasPosition: true, hasFace: true },
  { code: 'hand', label: '手札', action: 'cost_discard' },
  // 位置（上/下/選んで）と「誰の」セキュリティかは、このパネルではなく🎯対象パネル側
  // （対象＝自分/相手→セキュリティを選んだときに表示される位置ボタン）で設定する
  { code: 'security', label: 'セキュリティ', action: 'security_trash_select' },
  { code: 'deck', label: 'デッキ', action: 'deck_trash_top' },
  // リンクカード: このカード自身がリンクしているカードを破棄する（unlinkアクションを流用）
  { code: 'linked', label: 'リンクカード', action: 'unlink', warn: '⚠ エンジン未対応: 現状は対象を選べず、リンクしている先頭のカードから自動で破棄されます（指定/絞り込みは未反映）' },
];
const DISCARD_ACTION_CODES = new Set(DISCARD_ZONE_MAP.map((z) => z.action));
// 「デッキに戻す」: 押すと「下/上/下か上」の位置ボタンが現れる（CostStep.deckPosition）。
const DECKPOS_COST_ACTIONS: { code: string; label: string }[] = [
  { code: 'return_deck', label: 'デッキに戻す' },
];
// 「〇〇に置く」ボタン: 押すと「どこに置くか」の場所ボタン（セキュリティ/テイマー/バトルエリア）
// が現れ、選んだ場所に応じて実際のアクションコード・対象を切り替える（破棄のDISCARD_ZONE_MAPと
// 同じパターン）。位置(上/下/下か上・CostStep.deckPosition)と裏表(裏向き/表向き・
// CostStep.options=['face_down'])は、場所ごとに hasPosition/hasFace で出し分ける
// （セキュリティ/テイマーの下は位置も裏表も意味を持つが、バトルエリア＝進化元の下は
// 常に表向き・スタック先頭固定という想定のためどちらも出さない）
// 「バトルエリア」＝進化元/テイマーの下のような「下に積む」置き方ではなく、このカード自身が
// テイマーエリアに永続カードとして留まる置き方（BT24-089「ユニークエンブレム：烈火の指揮者」/
// BT24-093「はじまりの神殿」等のオプション「その後、このカードをバトルエリアに置く」）。
// 対応する既存アクションが無いため place_in_battle_area を新規コードとして想定（要辞書登録）。
// 対象は「このカード自身」が置かれるので target:'self_card'（位置/裏表の概念は無い）
const PLACE_ZONE_MAP: { code: string; label: string; action: string; target?: string; hasPosition?: boolean; hasFace?: boolean; hasFromZones?: boolean; warn?: string }[] = [
  {
    code: 'security', label: 'セキュリティ', action: 'place_on_security_top', target: 'own_security',
    hasPosition: true, hasFace: true, hasFromZones: true,
    warn: '⚠ エンジン未対応: 現状「上」固定・常に表向きで動作します（position/options未反映）',
  },
  {
    code: 'tamer', label: 'テイマー', action: 'place_under_tamer', target: 'own_tamer',
    hasPosition: true, hasFace: true, hasFromZones: true,
    warn: '⚠ エンジン未対応: target/位置/裏表/場所のいずれも反映されません（該当カードが来たら追加実装）',
  },
  {
    code: 'evo_source', label: '進化元', action: 'place_under_digimon', target: 'own',
    hasPosition: true, hasFace: true, hasFromZones: true,
    warn: '⚠ エンジン未対応: target/位置/裏表/場所のいずれも反映されません（該当カードが来たら追加実装）',
  },
  {
    code: 'battle_area', label: 'バトルエリア', action: 'place_in_battle_area', target: 'self_card',
    // 「このカード自身」が置かれる（BT24-089等）ため、取得元(場所)の概念は無い
    warn: '⚠ このボタン自体は今すぐ使えます（保存はできます）が、place_in_battle_area は辞書未登録・エンジンも未実装の新規アクションです。辞書に登録すると実装状況バッジ等でも認識されます（このカード自身をテイマーエリアに永続カードとして残す想定）',
  },
];
const PLACE_ACTION_CODES = new Set(PLACE_ZONE_MAP.map((z) => z.action));
// COMMON_ACTIONS の一部（登場/使用・進化）は辞書に登録せず常時使えるビルトインのため、
// 辞書のhasFromZonesフラグに頼らず「場所」ボタンを常に表示する
const BUILTIN_FROM_ZONE_ACTIONS = new Set(['summon', 'summon_appear', 'summon_use', 'evolve', 'link']);
// よく使う期間（対象と同じ2段ボタン式）
const DURATION_L1 = [
  { code: 'dur_this_turn', label: 'このターン中' },
  { code: 'turn_end', label: 'ターン終了まで' },
  { code: 'active_phase', label: 'アクティブフェイズ開始まで' },
  { code: 'dur_until_battle_end', label: 'バトル終了まで' },
  { code: 'dur_while', label: '〜の間（汎用）' },
];
const DURATION_L2: Record<string, { code: string; label: string }[]> = {
  turn_end: [
    { code: 'dur_next_own_turn', label: '自分' },
    { code: 'dur_next_opp_turn', label: '相手' },
  ],
  active_phase: [
    { code: 'dur_next_own_unsuspend', label: '自分' },
    { code: 'dur_next_opp_unsuspend', label: '相手' },
  ],
};
// duration コード → L1 の逆引き
function durationToL1(dur?: string): string {
  if (dur === 'dur_this_turn') return 'dur_this_turn';
  if (dur === 'dur_next_own_turn' || dur === 'dur_next_opp_turn') return 'turn_end';
  if (dur === 'dur_next_own_unsuspend' || dur === 'dur_next_opp_unsuspend') return 'active_phase';
  if (dur === 'dur_until_battle_end') return 'dur_until_battle_end';
  if (dur === 'dur_while') return 'dur_while';
  return '';
}
// 「～ごとに」の対象（REF_SUBJECTS）も2段ボタン式に統一。L2のコードはそのままREF_SUBJECTSの
// コードを使う（TARGET_SELのようなL1+L2合成は不要）。opp_no_evo_digimon/last_rest_count は
// このL1/L2に収まらない特殊枠のため「その他の対象」プルダウン側に残す。
// デジモン/テイマーは「デジモン/テイマー」という効果表現があるため複数選択可（両方チェック
// → own_digimon_tamer / opp_digimon_tamer という組合せコードになる）。
// 「全カード」は自分/相手を問わず両方のカード全てを数える第一ボタン（all_cards、L2無し）。
// いずれもエンジン未対応のため⚠未実装扱い（保存はできるが動作しない）
const PERREF_L1 = [
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'all_cards', label: '全カード' },
];
const PERREF_L2: Record<string, { code: string; label: string }[]> = {
  self: [
    { code: 'evo_source', label: '進化元' },
  ],
  own: [
    { code: 'own_digimon', label: 'デジモン' },
    { code: 'own_tamer', label: 'テイマー' },
    { code: 'own_digimon_tamer', label: 'デジモン+テイマー' },
    { code: 'own_hand', label: '手札' },
    { code: 'own_trash', label: 'トラッシュ' },
    { code: 'own_security', label: 'セキュリティ' },
    { code: 'own_battle_area', label: 'バトルエリア' },
  ],
  opp: [
    { code: 'opp_digimon', label: 'デジモン' },
    { code: 'opp_tamer', label: 'テイマー' },
    { code: 'opp_digimon_tamer', label: 'デジモン+テイマー' },
    { code: 'opp_hand', label: '手札' },
    { code: 'opp_trash', label: 'トラッシュ' },
    { code: 'opp_security', label: 'セキュリティ' },
    { code: 'opp_battle_area', label: 'バトルエリア' },
  ],
};
// デジモン+テイマー複数選択の結合コード、および「全カード」は、いずれもエンジン未対応・⚠表示用
const PERREF_COMBO_CODES = new Set(['own_digimon_tamer', 'opp_digimon_tamer', 'all_cards']);
const PERREF_L2_CODES = new Set(
  Object.values(PERREF_L2).flatMap((opts) => opts.map((o) => o.code))
);
// REF_SUBJECTSコード → PERREF_L1 の逆引き
function perRefToL1(code: string): string {
  if (code === 'evo_source') return 'self';
  if (code === 'all_cards') return 'all_cards';
  if (code.startsWith('own_') && PERREF_L2_CODES.has(code)) return 'own';
  if (code.startsWith('opp_') && PERREF_L2_CODES.has(code)) return 'opp';
  return '';
}
// 現在選択中のtriggers/triggerConditionsから、共有の発動ターンを逆算する
function inferTiming(currentTriggers: string[], triggerConditions: ConditionPair[], families: TriggerFamily[] = COMMON_TRIGGER_FAMILIES): TimingKey {
  for (const fam of families) {
    if (fam.kind !== 'timing' || !fam.variants) continue;
    if (currentTriggers.includes(fam.variants.opp)) return 'opp';
    if (currentTriggers.includes(fam.variants.any)) return 'any';
    if (currentTriggers.includes(fam.variants.self)) return 'self';
  }
  // どのファミリーのバリアントにも該当しない（=単発の通常トリガー）場合は、
  // トリガー条件の cond_during_own_turn / cond_during_opp_turn の有無だけで判定する。
  // どちらも無ければ「お互い」（未設定・ターンを問わない）が正しい既定値
  // （以前はここで一律 'self' を返しており、単発トリガーで「お互い」を選んでも
  // 再描画時に「自分」表示へ巻き戻ってしまう不具合があった）
  if (triggerConditions.some((c) => c.base === 'cond_during_own_turn')) return 'self';
  if (triggerConditions.some((c) => c.base === 'cond_during_opp_turn')) return 'opp';
  return 'any';
}
// 辞書に存在しない可能性がある新規プレースホルダーコード（メイン+相手 等）の表示名フォールバック
const FAMILY_VARIANT_FALLBACK_LABELS: Record<string, string> = {};
[...COMMON_TRIGGER_FAMILIES, ...KEYWORD_ONLY_TRIGGER_FAMILIES].forEach((fam) => {
  if (fam.kind !== 'timing' || !fam.variants) return;
  (Object.keys(fam.variants) as TimingKey[]).forEach((k) => {
    const timingLabel = TIMING_OPTIONS.find((t) => t.code === k)!.label;
    FAMILY_VARIANT_FALLBACK_LABELS[fam.variants![k]] = fam.label + '（' + timingLabel + '）';
  });
});

// 限定文字列の split/combine
// 'once_per_turn' → { type:'per_turn', count:1 }
// 'per_turn:2' → { type:'per_turn', count:2 }
// '' → { type:'', count:1 }
function splitLimit(s: string | undefined): { type: string; count: number } {
  if (!s) return { type: '', count: 1 };
  if (s === 'once_per_turn') return { type: 'per_turn', count: 1 };
  const m = s.match(/^per_turn:(\d+)$/);
  if (m) return { type: 'per_turn', count: parseInt(m[1], 10) };
  return { type: s.split(':')[0], count: 1 };
}
function combineLimit(type: string, count: number): string {
  if (!type) return '';
  if (type === 'per_turn') {
    return count === 1 ? 'once_per_turn' : 'per_turn:' + count;
  }
  return type;
}

export function BlockEditor({ block, index, dict, onChange, onRemove, onMoveUp, onMoveDown, isKeywordMode, hasNoEvoText }: Props) {
  const effectiveTriggerFamilies = isKeywordMode ? [...COMMON_TRIGGER_FAMILIES, ...KEYWORD_ONLY_TRIGGER_FAMILIES] : COMMON_TRIGGER_FAMILIES;
  // 「する/できない」トグルのペア表を辞書（dict.actions[].cantActionCode）駆動で構築。
  // 辞書に未登録のコードはモジュール直書きの DOABLE_TO_CANT をフォールバックとして使う
  const DOABLE_TO_CANT_LIVE: Record<string, string> = { ...DOABLE_TO_CANT };
  dict.actions.forEach((a) => {
    if (a.cantActionCode && a.cantActionCode.trim()) DOABLE_TO_CANT_LIVE[a.code] = a.cantActionCode.trim();
  });
  const CANT_TO_DOABLE_LIVE: Record<string, string> = Object.fromEntries(
    Object.entries(DOABLE_TO_CANT_LIVE).map(([doable, cant]) => [cant, doable])
  );
  function update(key: keyof EffectBlock, value: any) {
    onChange({ ...block, [key]: value });
  }

  // アクションコード → 辞書エントリ（位置バリアント suffix を剥がしてベース code でも引ける）
  function findActionEntry(code: string) {
    if (!code) return undefined;
    const direct = dict.actions.find((a) => a.code === code);
    if (direct) return direct;
    const v = getActionVariant(code);
    if (v) return dict.actions.find((a) => a.code === v.base);
    return undefined;
  }

  // アクション変更時、新アクションが rules 非対応なら既存 rules をクリア
  function changeAction(newAction: string) {
    const next = { ...block, action: newAction };
    const dictEntry = findActionEntry(newAction);
    const allowsRules = !!(dictEntry && dictEntry.allowsRules) || hasRuleTranslator(newAction);
    if (!allowsRules && Array.isArray(block.rules) && block.rules.length > 0) {
      next.rules = [];
    }
    onChange(next);
  }

  // target は base + count の合成
  const tgtBase = (block.target || '').split(':')[0];
  const tgtSuffix = (block.target || '').substring(tgtBase.length);
  // 対象のL1/L2（「対象の条件」を表示すべきかの判定にも使うため、コンポーネント直下で保持）
  const curTgt = TARGET_SEL_CODE_TO_L1L2[tgtBase] || { l1: '', l2: '' };
  // 「対象の条件」は対象が下記の場合のみ表示する（＝アクションが実際に処理する対象自身に
  // 掛かる条件。例:「レスト状態のこのデジモン」「クロノモンの記述があるこのデジモン」）:
  // このカード自身・自分→デジモン/カード/テイマー・相手→デジモン/テイマー・他→デジモン・
  // そのデジモン（直前選択。「重ねられているカード」等を選べるようにするため）
  const showTargetFilter =
    curTgt.l1 === 'self' ||
    curTgt.l1 === 'same_target' ||
    (curTgt.l1 === 'own' && ['digimon', 'card', 'tamer'].includes(curTgt.l2)) ||
    (curTgt.l1 === 'opp' && ['digimon', 'tamer'].includes(curTgt.l2)) ||
    (curTgt.l1 === 'other_own' && curTgt.l2 === 'digimon');
  // 「取得元カードの条件」は進化/登場(BUILTIN_FROM_ZONE_ACTIONS)専用。対象＝このカード自身
  // （進化する側）であっても、実際に絞り込みたいのは取得元エリア（手札等）から選ぶカードの方
  // なので、「対象の条件」とは別枠・別データ（block.fromFilter → step.from_filter）として扱う
  // （例:「このデジモンを手札の『クロノモン』の記述があるカードに進化できる」）
  // 実際の表示判定は effectAction 定義後（下部）で行う（そちらは編集中の効果を見る）
  const showRetrievalFilter = !!block.action && BUILTIN_FROM_ZONE_ACTIONS.has(block.action);

  function setTarget(base: string, suffix: string) {
    if (!base) return update('target', '');
    update('target', base + (suffix || ''));
  }


  // 条件操作（発動条件）
  const conditions = block.conditions || [];
  function updateCondition(i: number, p: ConditionPair) {
    const next = conditions.slice();
    next[i] = p;
    update('conditions', next);
  }
  function addCondition() {
    update('conditions', [...conditions, { base: '', value: '' }]);
  }
  function removeCondition(i: number) {
    update('conditions', conditions.filter((_, idx) => idx !== i));
  }

  // 取得元カードの条件（進化/登場アクション専用。対象＝このカード自身の条件とは別物。
  // step.from_filter に serialize）
  const fromFilter = block.fromFilter || [];
  // ターゲットフィルタ操作（step.filter に serialize）
  const targetFilter = block.targetFilter || [];
  function updateTargetFilter(i: number, p: ConditionPair) {
    const next = targetFilter.slice();
    next[i] = p;
    update('targetFilter', next);
  }
  function addTargetFilter() {
    update('targetFilter', [...targetFilter, { base: '', value: '' }]);
  }
  function removeTargetFilter(i: number) {
    update('targetFilter', targetFilter.filter((_, idx) => idx !== i));
  }

  // このブロックのトリガーが【アタック時】【アタック終了時】系か（アタック対象専用の
  // 条件UIをこのときだけ出すために使う）
  const isAttackTrigger = ((block.triggers && block.triggers.length > 0) ? block.triggers : (block.trigger ? [block.trigger] : []))
    .some((t) => ATTACK_TRIGGER_CODES.includes(t));

  // トリガー条件操作（トリガー発火元カードへのフィルタ）
  const triggerConditions = block.triggerConditions || [];
  function updateTriggerCondition(i: number, p: ConditionPair) {
    const next = triggerConditions.slice();
    next[i] = p;
    update('triggerConditions', next);
  }
  function addTriggerCondition() {
    update('triggerConditions', [...triggerConditions, { base: '', value: '' }]);
  }
  function removeTriggerCondition(i: number) {
    update('triggerConditions', triggerConditions.filter((_, idx) => idx !== i));
  }

  // ルール操作 (MiniStep[])
  const ruleSteps: MiniStep[] = block.rules || [];
  // メインアクションが rules 対応か判定（dict 由来の allowsRules または翻訳器あり）
  // 位置バリアント suffix が付いていてもベース code で辞書を引く
  const dictAction = findActionEntry(block.action || '');
  const actionAllowsRules = !!(dictAction && dictAction.allowsRules) || hasRuleTranslator(block.action);
  function setRuleSteps(next: MiniStep[]) { update('rules', next); }
  function addRuleStep() { setRuleSteps([...ruleSteps, { action: '' }]); }
  function updateRuleStep(i: number, patch: Partial<MiniStep>) {
    const next = ruleSteps.slice();
    next[i] = { ...next[i], ...patch };
    setRuleSteps(next);
  }
  function removeRuleStep(i: number) { setRuleSteps(ruleSteps.filter((_, j) => j !== i)); }
  function moveRuleStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ruleSteps.length) return;
    const next = ruleSteps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRuleSteps(next);
  }

  // 代替アクション操作（OR / AND 結合）
  const altActions = block.altActions || [];
  const altOp = block.altActionsOp || 'or';
  function updateAltAction(i: number, patch: Partial<AltAction>) {
    const next = altActions.slice();
    next[i] = { ...next[i], ...patch };
    update('altActions', next);
  }
  function addAltAction() {
    update('altActions', [...altActions, { action: '', value: '', target: '', conditions: [], options: [], fromZones: [] }]);
  }
  function removeAltAction(i: number) {
    update('altActions', altActions.filter((_, idx) => idx !== i));
    if (editingEffect > i + 1) setEditingEffect(editingEffect - 1);
    else if (editingEffect === i + 1) setEditingEffect(0);
  }

  // 「編集中」の効果スロット: 0=このステップ自体（効果1）/ 1..N=altActions[i-1]（効果2以降）。
  // OR/AND有効時、共通のアクション/対象/発動条件ボタン群がこのスロットに対して読み書きする
  const [editingEffect, setEditingEffect] = useState(0);
  const isEditingAlt = editingEffect > 0 && !!altActions[editingEffect - 1];
  const editingAlt = isEditingAlt ? altActions[editingEffect - 1] : undefined;
  const effectAction = isEditingAlt ? (editingAlt!.action || '') : (block.action || '');
  const effectValue = isEditingAlt ? editingAlt!.value : block.value;
  const effectFromCount = isEditingAlt ? editingAlt!.fromCount : block.fromCount;
  const effectTarget = isEditingAlt ? (editingAlt!.target || '') : (block.target || '');
  const effectExtraTargets = isEditingAlt ? (editingAlt!.extraTargets || []) : (block.extraTargets || []);
  // 「追加」チェックボックス: ONで対象2以降の枠を出す（OFFにすると追加分は全て削除）
  const hasExtraTargets = effectExtraTargets.length > 0;
  const setHasExtraTargets = (on: boolean) => {
    if (on) { if (effectExtraTargets.length === 0) updateEffect({ extraTargets: [{ target: '' }] }); }
    else { updateEffect({ extraTargets: [] }); }
  };
  const effectConditions = isEditingAlt ? (editingAlt!.conditions || []) : conditions;
  const effectConditionsOp: 'and' | 'or' = isEditingAlt ? (editingAlt!.conditionsOp || 'and') : (block.conditionsOp || 'and');
  const effectFromZones = isEditingAlt ? (editingAlt!.fromZones || []) : (block.fromZones || []);
  const effectFromZonesOp = isEditingAlt ? (editingAlt!.fromZonesOp || 'or') : (block.fromZonesOp || 'or');
  const effectFromZoneOwner = isEditingAlt ? editingAlt!.fromZoneOwner : block.fromZoneOwner;
  const effectSecurityPosition = isEditingAlt ? editingAlt!.securityPosition : block.securityPosition;
  const effectEvoSourcePosition = isEditingAlt ? editingAlt!.evoSourcePosition : block.evoSourcePosition;
  const effectEvoSourceOwner = isEditingAlt ? editingAlt!.evoSourceOwner : block.evoSourceOwner;
  const effectLinkedOwner = isEditingAlt ? editingAlt!.linkedOwner : block.linkedOwner;
  const effectDuration = isEditingAlt ? editingAlt!.duration : block.duration;
  const effectPerCount = isEditingAlt ? editingAlt!.perCount : block.perCount;
  const effectPerRef = isEditingAlt ? editingAlt!.perRef : block.perRef;
  const effectPerCountMode = isEditingAlt ? editingAlt!.perCountMode : block.perCountMode;
  const effectPerRefFilter = isEditingAlt ? (editingAlt!.perRefFilter || []) : (block.perRefFilter || []);
  const effectCostFree = isEditingAlt ? !!editingAlt!.costFree : !!block.costFree;
  const effectSkipOnPlay = isEditingAlt ? !!editingAlt!.skipOnPlay : !!block.skipOnPlay;
  const effectNegateTargetTrigger = isEditingAlt ? editingAlt!.negateTargetTrigger : block.negateTargetTrigger;
  const effectNegateDeny = isEditingAlt ? !!editingAlt!.negateDeny : !!block.negateDeny;
  const effectOptions = isEditingAlt ? (editingAlt!.options || []) : (block.options || []);
  const effectOptional = isEditingAlt ? !!editingAlt!.optional : !!block.optional;
  const effectFromFilter = isEditingAlt ? (editingAlt!.fromFilter || []) : (block.fromFilter || []);
  const effectTargetFilter = isEditingAlt ? (editingAlt!.targetFilter || []) : targetFilter;
  const showRetrievalFilterEffective = !!effectAction && BUILTIN_FROM_ZONE_ACTIONS.has(effectAction);
  function updateEffect(patch: Record<string, any>) {
    if (isEditingAlt) updateAltAction(editingEffect - 1, patch);
    else onChange({ ...block, ...patch });
  }
  // アクション変更（ルールクリア判定は効果1=block自身のときのみ。代替アクションにルールは無い）
  function changeEffectAction(newAction: string) {
    if (isEditingAlt) { updateEffect({ action: newAction }); return; }
    changeAction(newAction);
  }

  // 🔀 代替アクション（OR/AND）: OR=プレイヤーがどちらかを選ぶ / AND=両方行う（同じ対象に
  // 重ねて適用）。チェックボックス自体は「その他のアクション」の隣に表示し、
  // 「編集中」選択・設定内容の一覧はアクション欄の近くに別途表示する。
  // 「その後」は各効果の thenBreak フラグで個別に指定する（効果タブの「アクション」欄の
  // 隣にチェックボックスがある）。AND/OR区間の途中からでも「その後」に区切れる
  // （例:「AとBはAND、その後C（Aが不発でもCは必ず発動）」）
  const isOrChecked = altOp === 'or' && altActions.length > 0;
  const isAndChecked = altOp === 'and' && altActions.length > 0;
  const setAltMode = (mode: 'or' | 'and' | null) => {
    if (!mode) {
      onChange({ ...block, altActions: [], altActionsOp: undefined });
      setEditingEffect(0);
      return;
    }
    if (altActions.length === 0) {
      onChange({ ...block, altActions: [{ action: '', value: '', target: '', conditions: [], fromZones: [] }], altActionsOp: mode });
      setEditingEffect(1);
    } else {
      update('altActionsOp', mode);
    }
  };
  const summarizeAction = (act?: string, val?: number | string) => {
    if (!act) return '(未設定)';
    const label = dict.actions.find((d) => d.code === act)?.label || act;
    const valPart = (val !== undefined && val !== '') ? ` ${val}` : '';
    return `${label}${valPart}`;
  };
  // 対象コード（例: "own_tamer:1"）→「自分のテイマー 1体」のような表記に復元
  const describeTarget = (targetStr?: string) => {
    if (!targetStr) return '';
    const base = targetStr.split(':')[0];
    const suffix = targetStr.substring(base.length);
    const l1l2 = TARGET_SEL_CODE_TO_L1L2[base];
    let label = base;
    if (l1l2) {
      const l1Label = TARGET_SEL_L1.find((o) => o.code === l1l2.l1)?.label || '';
      const l2Label = l1l2.l2 ? (TARGET_SEL_L2[l1l2.l1] || []).find((o) => o.code === l1l2.l2)?.label || '' : '';
      label = [l1Label, l2Label].filter(Boolean).join('の');
    }
    const countLabel = suffix ? (TARGET_COUNTS.find((o) => o.code === suffix)?.label || '') : '';
    return [label, countLabel].filter(Boolean).join(' ');
  };
  // 条件配列 → ボタン表記をそのまま連結した文字列に復元（例:「テイマーの色:黄」）
  const describeConditions = (conds?: ConditionPair[]) => {
    if (!conds || conds.length === 0) return '';
    return conds.map((c) => {
      if (!c.base) return '';
      const def = COMMON_CONDS.find((cc) => cc.code === c.base);
      const label = def?.label || dict.conditions.find((d) => d.code === c.base)?.label || c.base;
      const valuePart = (c.value && !NO_VALUE_CONDS.has(c.base)) ? String(c.value) : '';
      const sl = c.subject ? COND_SUBJECT_CODE_TO_L1L2[c.subject] : undefined;
      const subjLabel = sl
        ? [
            COND_SUBJECT_L1.find((o) => o.code === sl.l1)?.label || '',
            sl.l2 ? (COND_SUBJECT_L2[sl.l1] || []).find((o) => o.code === sl.l2)?.label || '' : '',
          ].filter(Boolean).join('の')
        : '';
      return [subjLabel, label, valuePart].filter(Boolean).join(' ');
    }).filter(Boolean).join('・');
  };
  const describeEffect = (act?: string, val?: number | string, tgt?: string, conds?: ConditionPair[]) => {
    return [summarizeAction(act, val), describeTarget(tgt), describeConditions(conds)].filter(Boolean).join('　');
  };
  const altBtnStyle = (active: boolean) => ({
    padding: '4px 10px', borderRadius: 5,
    border: active ? '2px solid #9333ea' : '1px solid #bbb',
    background: active ? '#9333ea' : '#f5f5f5',
    color: active ? '#fff' : '#333',
    fontWeight: active ? 'bold' : 'normal',
    cursor: 'pointer', fontSize: 12,
  });

  // 付与効果操作（grantedStep）
  const grantedStep: GrantedStep = block.grantedStep || { trigger: '', action: '', conditions: [], options: [] };
  function updateGrantedStep(patch: Partial<GrantedStep>) {
    onChange({ ...block, grantedStep: { ...grantedStep, ...patch } });
  }

  // コスト操作（効果1・代替アクションとも同じ場所を使い回す）
  const costs = isEditingAlt ? (editingAlt!.costs || []) : (block.costs || []);
  function updateCost(i: number, c: CostStep) {
    const next = costs.slice();
    next[i] = c;
    updateEffect({ costs: next });
  }
  function addCost() {
    updateEffect({ costs: [...costs, { action: '', value: '', target: '' }] });
  }
  function removeCost(i: number) {
    updateEffect({ costs: costs.filter((_, idx) => idx !== i) });
  }

  // === 折りたたみ state ===
  const [triggerCondsOpen, setTriggerCondsOpen] = useState<boolean>((block.triggerConditions || []).length > 0);
  // 発動ターンをトリガーごとに個別設定するモード（既にtriggerTimingByCodeが
  // 入っているデータを開いた場合は最初から展開しておく）
  const [perTriggerTimingOpen, setPerTriggerTimingOpen] = useState<boolean>(
    Object.keys(block.triggerTimingByCode || {}).length > 0
  );
  // 発動主体をトリガーごとに個別設定するモード（既にtriggerSubjectByCodeが
  // 入っているデータを開いた場合は最初から展開しておく）
  const [perTriggerSubjectOpen, setPerTriggerSubjectOpen] = useState<boolean>(
    Object.keys(block.triggerSubjectByCode || {}).length > 0
  );
  const [otherTriggerOpen, setOtherTriggerOpen] = useState<boolean>(false);
  const [otherActionOpen, setOtherActionOpen] = useState<boolean>(false);
  // ～ごとにの「状態（条件）」その他プルダウン開閉状態
  const [perStateOtherOpen, setPerStateOtherOpen] = useState<boolean>(false);
  // 「対象の条件」をアクションの対象/対象数の2箇所に分けて描画するため、
  // その他チェックボックスの開閉状態をここで共有する
  const [targetFilterOtherOpen, setTargetFilterOtherOpen] = useState<boolean>(false);
  // ⏳ 期間（クイックボタン）: ✅を入れるとボタンが現れる。データがあれば初期表示ONにする
  const [showDurationPanel, setShowDurationPanel] = useState<boolean>(!!block.duration);

  // ✖ ～ごとに（倍率設定）: 値 × floor(count / N) でスケーリング。
  // 通常は⚙追加オプション内に表示するが、コスト軽減トリガーでは💰バナー内（発動条件の隣）
  // に直接埋め込むため、関数として切り出して2箇所から呼べるようにしている
  function renderPerCountEditor(forEffect: boolean = false) {
    // forEffect=true のとき、効果1(block)ではなく「編集中」の効果（effect*/updateEffect）に対して
    // 読み書きする。AltActionにはperRefStateCondが無いため、その場合は状態(条件)UIを出さない
    const curPerRef = forEffect ? (effectPerRef || '') : (block.perRef || '');
    const curPerCount = forEffect ? effectPerCount : block.perCount;
    const curPerCountMode = forEffect ? effectPerCountMode : block.perCountMode;
    const curPerRefFilter = forEffect ? effectPerRefFilter : (block.perRefFilter || []);
    const setFields = (patch: Record<string, any>) => {
      if (forEffect) updateEffect(patch);
      else onChange({ ...block, ...patch });
    };
    // 旧形式 (own_rest_digimon 等) を subject + 状態cond に分解（読み込み時の互換）
    const decomposeRef = (ref: string): { subject: string; legacyState: string } => {
      switch (ref) {
        case 'own_rest_digimon':   return { subject: 'own_digimon', legacyState: 'cond_self_rest' };
        case 'own_active_digimon': return { subject: 'own_digimon', legacyState: 'cond_self_active' };
        case 'opp_rest_digimon':   return { subject: 'opp_digimon', legacyState: 'cond_self_rest' };
        case 'opp_active_digimon': return { subject: 'opp_digimon', legacyState: 'cond_self_active' };
        default: return { subject: ref || '', legacyState: '' };
      }
    };
    const { subject: legacySubject, legacyState } = decomposeRef(curPerRef);
    const refSubject = legacySubject;
    // 効果2以降(AltAction)はperRefStateCondを持てないため、状態(条件)UIは効果1限定
    const isDigimonSubject = !forEffect && (refSubject === 'own_digimon' || refSubject === 'opp_digimon');
    const isEnabled = !!(curPerCount && curPerRef);
    // 現在の状態 cond（perRefStateCond > legacyState の優先順）
    const currentStateCond: ConditionPair = (!forEffect && block.perRefStateCond)
      || (legacyState ? { base: legacyState, value: '' } : { base: '', value: '' });

    // 状態 pulldown 候補: dict.conditions のうちカード単体に適用できるものをフィルタ
    // 除外: cond_during_*_turn / cond_memory_* / cond_own_security_* / cond_opp_no_attack_* / cond_exists* 等
    const stateCondOptions: SelectOption[] = [
      { value: '', label: '状態問わず' },
      ...dict.conditions
        .filter((c) => {
          const code = c.code || '';
          if (/^cond_during_/.test(code)) return false;
          if (/^cond_memory_/.test(code)) return false;
          if (/^cond_own_security_/.test(code)) return false;
          if (/^cond_opp_no_attack/.test(code)) return false;
          if (code === 'cond_exists' || code === 'cond_opp_exists' || code === 'cond_own_exists' || code === 'cond_exists_count_ge') return false;
          if (code === 'cond_evolved_this_turn' || code === 'cond_rest_count_ge' || code === 'cond_battle_win') return false;
          return true;
        })
        .map((c) => ({ value: c.code, label: c.label || c.code })),
    ];

    function setSubject(newSubject: string) {
      if (forEffect) { setFields({ perRef: newSubject }); return; }
      // 2フィールド同時更新: update を2回呼ぶと古い block 参照で2回目が1回目を上書きするため
      // onChange でまとめて反映する
      const isDigimonRef = (newSubject === 'own_digimon' || newSubject === 'opp_digimon');
      onChange({
        ...block,
        perRef: newSubject,
        // 非デジモン系: 状態をクリア（card-state は意味薄）
        perRefStateCond: isDigimonRef ? block.perRefStateCond : undefined,
      });
    }
    function setStateBase(newBase: string) {
      // 同じく 2フィールド (perRefStateCond + perRef のlegacy正規化) を1回でまとめて更新
      const newStateCond = newBase
        ? { base: newBase, value: currentStateCond.value || '' }
        : undefined;
      let nextPerRef = block.perRef;
      if (block.perRef === 'own_rest_digimon' || block.perRef === 'own_active_digimon') {
        nextPerRef = 'own_digimon';
      } else if (block.perRef === 'opp_rest_digimon' || block.perRef === 'opp_active_digimon') {
        nextPerRef = 'opp_digimon';
      }
      onChange({ ...block, perRefStateCond: newStateCond, perRef: nextPerRef });
    }
    function setStateValue(newValue: string) {
      if (!currentStateCond.base) return;
      update('perRefStateCond', { base: currentStateCond.base, value: newValue });
    }

    return (
      <div className="field" style={{ gridColumn: '1 / span 2' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => {
              // 2フィールドを同時更新する必要があるため、update を2回呼ばず setFields でまとめる
              if (e.target.checked) {
                setFields({ perCount: curPerCount || 1, perRef: curPerRef || 'opp_digimon' });
              } else {
                setFields({ perCount: undefined, perRef: '' });
              }
            }}
          />
          <b>✖ ～ごとに（倍率設定）</b>
          <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666' }}>
            （指定対象を数えて 値 × その数 を掛ける、または N 回発動）
          </span>
        </label>
        {isEnabled && (
          <div style={{ marginTop: 6, padding: 8, background: '#f3f6fc', borderRadius: 4, border: '1px solid #c5d4ea' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min={1}
                  value={curPerCount || 1}
                  onChange={(e) => setFields({ perCount: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  style={{ width: 50, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                />
                <span style={{ fontSize: 11, color: '#555' }}>枚ごと、</span>
              </div>
              {/* 対象（2段ボタン方式: このカード/自分/相手 → 進化元/デジモン/テイマー/手札/トラッシュ/セキュリティ/バトルエリア） */}
              <div>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                {(() => {
                  const curL1 = perRefToL1(refSubject);
                  const l2Options = PERREF_L2[curL1] || [];
                  const handleL1 = (l1: string) => {
                    if (!l1) { setSubject(''); return; }
                    if (l1 === 'all_cards') { setSubject('all_cards'); return; }
                    const opts = PERREF_L2[l1] || [];
                    if (opts.length === 0) return;
                    const keepCurrent = opts.some((o) => o.code === refSubject);
                    setSubject(keepCurrent ? refSubject : opts[0].code);
                  };
                  // デジモン/テイマーは「デジモン/テイマー」表現があるため複数選択可
                  const digimonCode = curL1 === 'own' ? 'own_digimon' : curL1 === 'opp' ? 'opp_digimon' : '';
                  const tamerCode = curL1 === 'own' ? 'own_tamer' : curL1 === 'opp' ? 'opp_tamer' : '';
                  const comboCode = curL1 === 'own' ? 'own_digimon_tamer' : curL1 === 'opp' ? 'opp_digimon_tamer' : '';
                  const hasDigiTamer = curL1 === 'own' || curL1 === 'opp';
                  const digimonChecked = refSubject === digimonCode || refSubject === comboCode;
                  const tamerChecked = refSubject === tamerCode || refSubject === comboCode;
                  const applyDigiTamer = (nextDigimon: boolean, nextTamer: boolean) => {
                    if (nextDigimon && nextTamer) setSubject(comboCode);
                    else if (nextDigimon) setSubject(digimonCode);
                    else if (nextTamer) setSubject(tamerCode);
                    else setSubject('');
                  };
                  const exclusiveL2Options = l2Options.filter((o) => o.code !== digimonCode && o.code !== tamerCode && o.code !== comboCode);
                  const toggleBtnStyle = (active: boolean) => ({
                    padding: '3px 9px', borderRadius: 5,
                    border: active ? '2px solid #1a4f8a' : '1px solid #bbb',
                    background: active ? '#1a4f8a' : '#f5f5f5',
                    color: active ? '#fff' : '#333',
                    fontWeight: active ? 'bold' : 'normal',
                    cursor: 'pointer', fontSize: 11,
                  });
                  return (
                    <>
                      <ButtonGroup options={PERREF_L1} value={curL1} onChange={handleL1} accentColor="#1a4f8a" />
                      {hasDigiTamer && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button type="button" onClick={() => applyDigiTamer(!digimonChecked, tamerChecked)} style={toggleBtnStyle(digimonChecked)}>デジモン</button>
                          <button type="button" onClick={() => applyDigiTamer(digimonChecked, !tamerChecked)} style={toggleBtnStyle(tamerChecked)}>テイマー</button>
                          {exclusiveL2Options.length > 0 && (
                            <ButtonGroup options={exclusiveL2Options} value={!digimonChecked && !tamerChecked ? refSubject : ''} onChange={setSubject} accentColor="#1a4f8a" />
                          )}
                        </div>
                      )}
                      {!hasDigiTamer && l2Options.length > 1 && (
                        <div style={{ marginTop: 4 }}>
                          <ButtonGroup options={l2Options} value={refSubject} onChange={setSubject} accentColor="#1a4f8a" />
                        </div>
                      )}
                      {PERREF_COMBO_CODES.has(refSubject) && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '3px 6px' }}>
                          ⚠ 「全カード」（デジモン+テイマー）はエンジン未実装です（保存はできますが動作しません）
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              {/* 状態: デジモン系のみ表示。よく使う2状態はボタン、他は辞書からその他選択 */}
              {isDigimonSubject && (
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    状態（条件）
                    {currentStateCond.base && (
                      isConditionImplemented(currentStateCond.base)
                        ? <span style={{ color: '#2e7d32', fontSize: 9 }}>✅</span>
                        : <span style={{ color: '#e65100', fontSize: 9 }} title="エンジン未実装">⚠</span>
                    )}
                  </div>
                  <ButtonGroup
                    options={[
                      { code: '', label: '状態問わず' },
                      { code: 'cond_self_rest', label: 'レスト状態' },
                      { code: 'cond_self_active', label: 'アクティブ状態' },
                    ]}
                    value={['cond_self_rest', 'cond_self_active'].includes(currentStateCond.base) ? currentStateCond.base : ''}
                    onChange={setStateBase}
                    accentColor="#1a4f8a"
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, marginTop: 4, color: '#666' }}>
                    <input
                      type="checkbox"
                      checked={perStateOtherOpen || (!!currentStateCond.base && !['cond_self_rest', 'cond_self_active'].includes(currentStateCond.base))}
                      onChange={(e) => {
                        setPerStateOtherOpen(e.target.checked);
                        // ✅を入れたら上のボタン(レスト/アクティブ)は未選択状態にする
                        if (e.target.checked && ['cond_self_rest', 'cond_self_active'].includes(currentStateCond.base)) {
                          setStateBase('');
                        }
                      }}
                    />
                    その他の状態（辞書の条件を流用）
                  </label>
                  {(perStateOtherOpen || (!!currentStateCond.base && !['cond_self_rest', 'cond_self_active'].includes(currentStateCond.base))) && (
                    <div style={{ marginTop: 2 }}>
                      <SearchSelect
                        value={currentStateCond.base}
                        onChange={setStateBase}
                        options={stateCondOptions}
                        allowFreeText
                      />
                      <InlineDictAdd kind="conditions" dict={dict} onRegistered={setStateBase} />
                    </div>
                  )}
                  {/* 値が必要な条件（cond_lv_le など）の値入力 */}
                  {currentStateCond.base && (
                    <input
                      type="text"
                      value={currentStateCond.value || ''}
                      onChange={(e) => setStateValue(e.target.value)}
                      placeholder="値（必要な場合・例: 5）"
                      style={{ marginTop: 4, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                    />
                  )}
                </div>
              )}
              <span style={{ fontSize: 10, color: '#666', alignSelf: 'flex-end', paddingBottom: 4 }}>
                を数える
              </span>
            </div>
            {/* 発動モード: 値×N か N回発動か */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8, padding: '6px 8px', background: '#eaf0fb', borderRadius: 4, border: '1px solid #b3c8ff', fontSize: 11 }}>
              <span style={{ color: '#1a4f8a', fontWeight: 'bold', whiteSpace: 'nowrap' }}>発動モード:</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`perCountMode_${index}_${forEffect ? 'alt' : 'main'}`}
                  checked={curPerCountMode !== 'repeat'}
                  onChange={() => setFields({ perCountMode: undefined })}
                  style={{ margin: 0 }}
                />
                <span>値 × N（合計）</span>
                <span style={{ color: '#888', fontSize: 10 }}>例: DP-4000×2体=-8000</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`perCountMode_${index}_${forEffect ? 'alt' : 'main'}`}
                  checked={curPerCountMode === 'repeat'}
                  onChange={() => setFields({ perCountMode: 'repeat' })}
                  style={{ margin: 0 }}
                />
                <span style={{ fontWeight: curPerCountMode === 'repeat' ? 'bold' : 'normal', color: curPerCountMode === 'repeat' ? '#1a4f8a' : 'inherit' }}>N 回発動</span>
                <span style={{ color: '#888', fontSize: 10 }}>例: DP-4000 を2回（対象を毎回選べる）</span>
              </label>
            </div>
            {/* フィルタ: カウント時に追加で絞り込み（発動条件と同じボタン式のConditionsHybridEditorを再利用） */}
            <div style={{ marginTop: 8 }}>
              <ConditionsHybridEditor
                conditions={curPerRefFilter}
                onChange={(next) => setFields({ perRefFilter: next })}
                dict={dict}
                title="さらに絞り込み"
                hint="（カウント対象の絞り込み・複数 AND）"
                theme="action"
                defaultSubject=""
                showSubjectSelector={false}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="block">
      <div className="block-header">
        <span className="order">効果ステップ {index + 1}</span>
        <span className="actions">
          {onMoveUp && <button onClick={onMoveUp}>↑</button>}
          {onMoveDown && <button onClick={onMoveDown}>↓</button>}
          <button className="danger" onClick={onRemove}>削除</button>
        </span>
      </div>

      <div className="block-grid">
        {/* === 発動領域 ===
            「セキュリティにある間、常に発動」のようにキーワード自体の定義（テンプレート）に
            発動領域の指定が必要になるケースがあるため、isKeywordModeでも常に表示する
            （区分/タイプ/限定はカード固有の概念のため、そちらは従来通り非表示のまま） */}
        <div style={{
          gridColumn: '1 / span 2', padding: 10, background: '#fdeef2',
          border: '1px solid #f3b8ce', borderRadius: 6, marginBottom: isKeywordMode ? 8 : 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 'bold', minWidth: 56 }}>発動領域</label>
            <ButtonGroup options={ZONE_BUTTONS} value={block.zone || ''} onChange={(v) => update('zone', v)} accentColor="#d6336c" />
          </div>
        </div>

        {/* === ＜前提＞ブロック: 区分 / タイプ / 限定 をボタン式で選択 ===
            キーワード効果のテンプレート編集(isKeywordMode)では、カード固有の概念（区分/
            ターン制限）は不要なため非表示にする */}
        {!isKeywordMode && (
        <div style={{
          gridColumn: '1 / span 2', padding: 10, background: '#fdeef2',
          border: '1px solid #f3b8ce', borderRadius: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <label style={{ fontSize: 12, fontWeight: 'bold', minWidth: 56 }}>区分 *</label>
            <ButtonGroup options={SECTIONS} value={block.section} onChange={(v) => update('section', v)} accentColor="#d6336c" />
          </div>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 6, marginLeft: 64 }}>
            {block.section === 'evo_source'
              ? '「進化元」＝このカードが他のカードの進化元（下敷き）になったときに発揮する効果（カード情報一覧の「進化元テキスト」欄の内容）専用です。'
              : block.section === 'security'
              ? '「セキュリティ」＝このカードがセキュリティとして表向きになったときの効果（セキュリティテキスト欄）専用です。'
              : block.section === 'link'
              ? '「リンク」＝このカードがリンクしている間に発揮する効果専用です。'
              : '「メイン」＝このカード自身の効果テキストです（進化元になったときの効果ではありません）。'}
          </div>
          {block.section === 'evo_source' && hasNoEvoText && (
            <div style={{ fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px', marginBottom: 6 }}>
              ⚠ このカードの「進化元テキスト」欄は空/なしです。効果テキスト（メイン）由来の効果を誤って「進化元」区分にしていませんか？
            </div>
          )}

          {/* タイプ: この効果ステップが「デジモンの効果」か「オプションの効果」かのメモ書き。
              trigger='main'はオプション使用時の効果とデジモンの起動効果の両方に使われる
              コードのため、デュアルカードのように1枚に両方の効果が混在する場合に
              区別しやすくする目的の編集時の目印（エンジンには影響しない・保存のみ） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 'bold', minWidth: 56 }}>
              タイプ
              <span style={{ fontSize: 10, fontWeight: 'normal', color: '#888', marginLeft: 2 }} title="デュアルカード等、1枚に両方の効果が混在する場合の目印（保存のみ・エンジンには影響しません）">ℹ</span>
            </label>
            <ButtonGroup
              options={[{ code: 'digimon', label: 'デジモン' }, { code: 'tamer', label: 'テイマー' }, { code: 'option', label: 'オプション' }]}
              value={block.asType || ''}
              onChange={(v) => update('asType', v || undefined)}
              accentColor="#d6336c"
            />
          </div>

          <div>
            {(() => {
              const { type: limType, count: limCount } = splitLimit(block.limit);
              const limitOn = limType === 'per_turn';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}>
                    <input
                      type="checkbox"
                      checked={limitOn}
                      onChange={(e) => update('limit', e.target.checked ? combineLimit('per_turn', 1) : '')}
                    />
                    ターンにN回
                  </label>
                  {limitOn && (
                    <ButtonGroup
                      options={[1, 2, 3].map((n) => ({ code: String(n), label: n + '回' }))}
                      value={String(limCount)}
                      onChange={(v) => update('limit', combineLimit('per_turn', parseInt(v, 10)))}
                      accentColor="#d6336c"
                    />
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        )}

        {/* === 🎬 トリガーグループ === */}
        {/* セキュリティ効果(区分=セキュリティ)は常に「セキュリティチェック時」に発動するため、
            トリガー/発動主体/タイミング等の入力は不要（内部的に trigger:'security' が自動設定される） */}
        {block.section === 'security' ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#f0f9f0',
            border: '2px solid #93c693', borderRadius: 6,
            fontSize: 12, color: '#1a5a1a',
          }}>
            🔒 セキュリティ効果は「セキュリティでめくれたとき」に自動で発動します。トリガーの指定は不要です。
          </div>
        ) : block.trigger === 'alt_evolve' ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#f0f9f0',
            border: '2px solid #93c693', borderRadius: 6,
            fontSize: 12, color: '#1a5a1a', lineHeight: 1.6,
          }}>
            🔄 <b>代替進化（進化条件を無視して進化できる）</b>は常時判定される特殊トリガーです。アクション/対象は不要（空のままでOK）。下の「🎯 発動条件」欄をこの意味で使います:
            <br />・<b>条件1</b> = この効果が有効になる条件（例:「自分のトラッシュがN枚以上」）
            <br />・<b>条件2</b> = 進化元（進化させたい元のデジモン）の絞り込み（例:「名前を含む: インプモン」）
            <div style={{ marginTop: 8, padding: 8, background: 'white', borderRadius: 4, border: '2px solid #ffb74d' }}>
              <label style={{ display: 'block', fontWeight: 'bold', color: '#b76e00', marginBottom: 4 }}>
                💰 進化コスト（無視して支払うコスト。下のアクション欄ではなく、ここに入力してください）
              </label>
              <input
                type="number"
                value={block.value === undefined ? '' : String(block.value)}
                onChange={(e) => {
                  const v = e.target.value;
                  update('value', v === '' ? undefined : Number(v));
                }}
                placeholder="例: 4"
                style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 120 }}
              />
            </div>
          </div>
        ) : FUSION_EVOLVE_TRIGGERS.has(block.trigger) ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#fff3e0',
            border: '2px solid #ffb74d', borderRadius: 6,
            fontSize: 12, color: '#8a5300', lineHeight: 1.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <ButtonGroup
                options={[{ code: 'app_gattai_evolve', label: '🧬 アプ合体' }, { code: 'jogress_evolve', label: '🧬 ジョグレス進化' }]}
                value={block.trigger}
                onChange={(v) => onChange({ ...block, trigger: v, triggers: [v] })}
                accentColor="#b76e00"
              />
              <button
                type="button"
                onClick={() => onChange({ ...block, trigger: '', triggers: [] })}
                style={{ padding: '3px 9px', borderRadius: 5, border: 'none', background: '#757575', color: '#fff', cursor: 'pointer', fontSize: 11 }}
              >
                戻る
              </button>
            </div>
            <div style={{ marginBottom: 6, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
              ⚠ {block.trigger === 'app_gattai_evolve' ? 'アプ合体' : 'ジョグレス進化'}はエンジン未実装です（保存はできますが動作しません）
            </div>
            🧬 <b>{block.trigger === 'app_gattai_evolve' ? 'アプ合体' : 'ジョグレス進化'}（複数体の素材を同時に使って進化）</b>は常時判定される特殊トリガーです。アクション/対象は不要（空のままでOK）。演出が異なるため、アプ合体とジョグレス進化は別々のトリガーとして保存されます。
            <br />・素材候補が2つで使う体数も2 → 2つとも必須（ジョグレス型。例:「紫/青Lv5」＋「赤/黄Lv5」）
            <br />・素材候補が3つで使う体数が2 → いずれか2つを満たせばOK（アプ合体型。例:「エイドモン/サブリモン/スバモン」のいずれか2体）
            <div style={{ marginTop: 8, padding: 8, background: 'white', borderRadius: 4, border: '2px solid #ffb74d' }}>
              <label style={{ display: 'block', fontWeight: 'bold', color: '#b76e00', marginBottom: 6 }}>
                🧩 素材候補
              </label>
              <FusionMaterialsEditor
                slots={block.fusionMaterials || []}
                pickCount={block.fusionPickCount || 2}
                onSlotsChange={(v) => update('fusionMaterials', v)}
                onPickCountChange={(v) => update('fusionPickCount', v)}
              />
            </div>
            <div style={{ marginTop: 8, padding: 8, background: 'white', borderRadius: 4, border: '2px solid #ffb74d' }}>
              <label style={{ display: 'block', fontWeight: 'bold', color: '#b76e00', marginBottom: 4 }}>
                💰 進化コスト（下のアクション欄ではなく、ここに入力してください）
              </label>
              <input
                type="number"
                value={block.value === undefined ? '' : String(block.value)}
                onChange={(e) => {
                  const v = e.target.value;
                  update('value', v === '' ? undefined : Number(v));
                }}
                placeholder="例: 4"
                style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 120 }}
              />
            </div>
          </div>
        ) : COST_REDUCTION_TRIGGERS.has(block.trigger) ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#fff8e1',
            border: '2px solid #ffcc80', borderRadius: 6,
            fontSize: 12, color: '#8a5300', lineHeight: 1.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <b>💰 コスト軽減</b>
              <ButtonGroup
                options={COST_REDUCTION_VARIANTS.map((v) => ({ code: v.code, label: v.label }))}
                value={COST_REDUCTION_VARIANTS.find((v) => v.trigger === block.trigger)?.code || 'summon'}
                onChange={(code) => {
                  const v = COST_REDUCTION_VARIANTS.find((x) => x.code === code)!;
                  onChange({ ...block, trigger: v.trigger, triggers: [v.trigger], zone: block.zone || 'hand' });
                }}
                accentColor="#ef6c00"
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11 }}>軽減量:</span>
                <input
                  type="number"
                  value={block.value === undefined ? '' : String(block.value)}
                  onChange={(e) => {
                    const v = e.target.value;
                    update('value', v === '' ? undefined : Number(v));
                  }}
                  placeholder="例: 1"
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 70 }}
                />
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...block, trigger: '', triggers: [] })}
                style={{ padding: '3px 9px', borderRadius: 5, border: 'none', background: '#757575', color: '#fff', cursor: 'pointer', fontSize: 11 }}
              >
                戻る
              </button>
            </div>
            {!COST_REDUCTION_VARIANTS.find((v) => v.trigger === block.trigger)?.implemented && (
              <div style={{ marginBottom: 6, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
                ⚠ 進化コスト軽減はエンジン未実装です（保存はできますが動作しません）
              </div>
            )}
            常時判定される特殊トリガーです。アクション/対象は不要（空のままでOK）。
            下の「コスト」を設定すると、アセンブリ等の「〇〇することで軽減」という任意効果になります。
            <div style={{ marginTop: 8 }}>
              <label style={{ fontWeight: 'bold', fontSize: 12 }}>コスト（「〇〇することで軽減」の場合のみ・任意）</label>
              <CostListEditor
                dict={dict}
                costs={costs}
                updateCost={updateCost}
                addCost={addCost}
                removeCost={removeCost}
                noCostLabel="コストなし（常に軽減）"
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <ConditionsHybridEditor
                conditions={conditions}
                onChange={(next) => update('conditions', next)}
                dict={dict}
                title="発動条件"
                hint="（この軽減が有効になる条件・複数指定可・AND結合）"
                theme="trigger"
                defaultSubject=""
                attackContextActive={isAttackTrigger}
              />
            </div>
            {renderPerCountEditor()}
          </div>
        ) : block.trigger === 'passive' ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#f3e8fd',
            border: '2px solid #c39bf0', borderRadius: 6,
            fontSize: 12, color: '#5e2a8a', lineHeight: 1.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <b>🔑 キーワード効果</b>
              <button
                type="button"
                onClick={() => onChange({ ...block, trigger: '', triggers: [] })}
                style={{ padding: '3px 9px', borderRadius: 5, border: 'none', background: '#757575', color: '#fff', cursor: 'pointer', fontSize: 11 }}
              >
                戻る
              </button>
            </div>
            【再起動】【セキュリティアタック+】のような、それ自体で1つの効果を表すキーワードです。
            常時判定される特殊トリガーです。アクション/対象/発動条件は不要（空のままでOK）。
            <div style={{ marginTop: 8, padding: 8, background: 'white', borderRadius: 4, border: '2px solid #d8b4fe' }}>
              <KeywordEntriesEditor block={block} onChange={onChange} dict={dict} accentBorder="#d8b4fe" />
            </div>
          </div>
        ) : (
        <div style={{
          gridColumn: '1 / span 2',
          padding: 10,
          background: '#f0f9f0',
          border: '2px solid #93c693',
          borderRadius: 6,
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 13, color: '#1a5a1a', marginBottom: 8 }}>
            🎬 トリガー（いつ発動するか）
          </div>

          {(() => {
            const currentTriggers = (block.triggers && block.triggers.length > 0) ? block.triggers : (block.trigger ? [block.trigger] : []);
            const addTrigger = (code: string) => {
              if (!code || currentTriggers.includes(code)) return;
              const next = [...currentTriggers, code];
              onChange({ ...block, trigger: next[0], triggers: next });
            };
            const removeTrigger = (code: string) => {
              const next = currentTriggers.filter((t) => t !== code);
              onChange({ ...block, trigger: next[0] || '', triggers: next });
            };

            const timing = inferTiming(currentTriggers, triggerConditions, effectiveTriggerFamilies);
            const isFamilyActive = (fam: TriggerFamily): boolean =>
              fam.kind === 'event' ? currentTriggers.includes(fam.code)
                : Object.values(fam.variants!).some((v) => currentTriggers.includes(v));

            const toggleFamily = (fam: TriggerFamily) => {
              if (fam.kind === 'event') {
                if (currentTriggers.includes(fam.code)) removeTrigger(fam.code); else addTrigger(fam.code);
                return;
              }
              const variant = fam.variants![timing];
              if (currentTriggers.includes(variant)) { removeTrigger(variant); return; }
              const others = Object.values(fam.variants!).filter((v) => v !== variant);
              const next = [...currentTriggers.filter((t) => !others.includes(t)), variant];
              onChange({ ...block, trigger: next[0], triggers: next });
            };

            const setTiming = (newTiming: TimingKey) => {
              let next = [...currentTriggers];
              let matchedTimingFamily = false;
              effectiveTriggerFamilies.forEach((fam) => {
                if (fam.kind !== 'timing' || !fam.variants) return;
                const oldVariant = Object.values(fam.variants).find((v) => next.includes(v));
                if (!oldVariant) return;
                matchedTimingFamily = true;
                const newVariant = fam.variants[newTiming];
                next = next.filter((t) => t !== oldVariant);
                if (!next.includes(newVariant)) next.push(newVariant);
              });
              // 「継続効果」「メイン」等のタイミング系ファミリーは、バリアントのコード自体に
              // 自分/相手/お互いが直接エンコードされている（during_own_turn 等）ため、
              // cond_during_own_turn等を重ねて追加すると完全な重複になる。
              // 単発トリガー（on_play 等、自分/相手の区別を持たないイベント系）のときだけ、
              // このトリガー条件で自分/相手ターンを絞り込む
              let nextConds = triggerConditions.filter((c) => c.base !== 'cond_during_own_turn' && c.base !== 'cond_during_opp_turn');
              if (!matchedTimingFamily) {
                if (newTiming === 'self') nextConds = [...nextConds, { base: 'cond_during_own_turn' }];
                else if (newTiming === 'opp') nextConds = [...nextConds, { base: 'cond_during_opp_turn' }];
              }
              onChange({ ...block, trigger: next[0] || '', triggers: next, triggerConditions: nextConds });
            };

            const allFamilyCodes = new Set<string>();
            effectiveTriggerFamilies.forEach((fam) => {
              if (fam.kind === 'event') allFamilyCodes.add(fam.code);
              else Object.values(fam.variants!).forEach((v) => allFamilyCodes.add(v));
            });
            // パッシブ(passive)は専用のよく使うボタンから選ぶため、
            // 「その他のトリガー」には重複して出さない
            allFamilyCodes.add('passive');
            const hasOtherSelected = currentTriggers.some((t) => !allFamilyCodes.has(t));

            const unimplementedActive = effectiveTriggerFamilies
              .map((fam) => {
                if (fam.kind !== 'timing' || !fam.variants) return null;
                const axisVal = timing;
                const variant = fam.variants[axisVal];
                if (!currentTriggers.includes(variant) || fam.implemented?.[axisVal] !== false) return null;
                return { fam, axisLabel: TIMING_OPTIONS.find((t) => t.code === axisVal)?.label || axisVal };
              })
              .filter((x): x is { fam: TriggerFamily; axisLabel: string } => x !== null);

            const rawTriggerSubject = splitStackSuffix(block.triggerSubject || '');
            const cur = SUBJECT_CODE_TO_L1L2[rawTriggerSubject.base] || { l1: 'self', l2: '' };
            const triggerStackPos = rawTriggerSubject.pos;
            const showTriggerStackPos = cur.l1 === 'self' || cur.l2 === 'digimon' || cur.l2 === 'tamer';
            const setTriggerStackPos = (pos: StackPos) => update('triggerSubject', joinStackSuffix(rawTriggerSubject.base, pos));
            const handleL1 = (l1: string) => {
              if (l1 === 'self') { update('triggerSubject', l1); return; }
              const l2 = cur.l1 === l1 && cur.l2 ? cur.l2 : 'digimon';
              update('triggerSubject', SUBJECT_L1L2_TO_CODE[l1 + ':' + l2] || SUBJECT_L1L2_TO_CODE[l1 + ':digimon'] || l1);
            };
            const handleL2 = (l2: string) => {
              update('triggerSubject', SUBJECT_L1L2_TO_CODE[cur.l1 + ':' + l2]);
            };
            const l2Options = cur.l1 === 'other_own' ? SUBJECT_L2.filter((o) => o.code !== 'player') : SUBJECT_L2;
            // デジモン/テイマーは複数選択可（両方選ぶとcard=「カード」扱いに集約。カード単体の
            // ボタンは冗長になるためexclusiveL2Optionsから外す。対象/対象の条件と同じ操作感）
            // 選択中の全トリガーが「種別なし」（デッキが増えたとき等、カード種別を問わない
            // ゾーン系イベント）なら、デジモン/テイマー種別ボタン自体を出さない
            const allTriggersTypeless = currentTriggers.length > 0
              && currentTriggers.every((t) => dict.triggers.find((d) => d.code === t)?.noSubjectType);
            const hasDigimonTamer = (cur.l1 === 'own' || cur.l1 === 'opp' || cur.l1 === 'other_own' || cur.l1 === 'both') && !allTriggersTypeless;
            const subjDigimonCode = SUBJECT_L1L2_TO_CODE[cur.l1 + ':digimon'];
            const subjTamerCode = SUBJECT_L1L2_TO_CODE[cur.l1 + ':tamer'];
            const subjCardCode = SUBJECT_L1L2_TO_CODE[cur.l1 + ':card'];
            const subjDigimonChecked = hasDigimonTamer && (cur.l2 === 'digimon' || cur.l2 === 'card');
            const subjTamerChecked = hasDigimonTamer && (cur.l2 === 'tamer' || cur.l2 === 'card');
            const subjExclusiveL2Options = l2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer' && o.code !== 'card');
            const applySubjDigiTamer = (nextDigimon: boolean, nextTamer: boolean) => {
              if (nextDigimon && nextTamer) update('triggerSubject', subjCardCode);
              else if (nextDigimon) update('triggerSubject', subjDigimonCode);
              else if (nextTamer) update('triggerSubject', subjTamerCode);
              else update('triggerSubject', cur.l1);
            };
            // レスト/アクティブ状態フィルタは「このカード/デジモン/テイマー」のときだけ意味を持つ
            // （「カード」全般やプレイヤーにはレスト/アクティブの概念が無い）
            const showRestActive = cur.l1 === 'self' || cur.l2 === 'digimon' || cur.l2 === 'tamer';
            const isRest = triggerConditions.some((c) => c.base === 'cond_rest');
            const isActive = triggerConditions.some((c) => c.base === 'cond_self_active');
            const setRestActiveState = (mode: 'rest' | 'active' | null) => {
              const rest = triggerConditions.filter((c) => c.base !== 'cond_rest' && c.base !== 'cond_self_active');
              const next = mode === 'rest' ? [...rest, { base: 'cond_rest' }]
                : mode === 'active' ? [...rest, { base: 'cond_self_active' }]
                : rest;
              update('triggerConditions', next);
            };

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
                <div className="field">
                  <label>トリガー（複数選択可）</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {effectiveTriggerFamilies.map((fam) => {
                      const active = isFamilyActive(fam);
                      return (
                        <button
                          key={fam.code}
                          type="button"
                          onClick={() => toggleFamily(fam)}
                          style={{
                            padding: '3px 9px', borderRadius: 5,
                            border: active ? '2px solid #2e7d32' : '1px solid #bbb',
                            background: active ? '#2e7d32' : '#f5f5f5',
                            color: active ? '#fff' : '#333',
                            fontWeight: active ? 'bold' : 'normal',
                            cursor: 'pointer', fontSize: 11,
                            boxShadow: active ? '0 0 6px #2e7d3299' : 'none',
                          }}
                        >
                          {fam.label}
                        </button>
                      );
                    })}
                    {/* コスト軽減: アセンブリ等、キーワード自体が「登場/使用コストを軽減する」効果
                        （＋それに伴うコスト）を持つことがあるため、キーワードのテンプレート
                        編集(isKeywordMode)でも出す */}
                    <button
                      type="button"
                      onClick={() => onChange({ ...block, trigger: 'summon_cost', triggers: ['summon_cost'], zone: block.zone || 'hand' })}
                      style={{
                        padding: '3px 9px', borderRadius: 5,
                        border: '1px solid #bbb', background: '#f5f5f5', color: '#333',
                        fontWeight: 'normal', cursor: 'pointer', fontSize: 11,
                      }}
                    >
                      コスト軽減
                    </button>
                    {/* キーワード効果(passive)は、キーワード内でさらにキーワードを使うことは
                        想定しないため、テンプレート編集(isKeywordMode)では出さない */}
                    {!isKeywordMode && (
                      <button
                        type="button"
                        onClick={() => onChange({ ...block, trigger: 'passive', triggers: ['passive'] })}
                        style={{
                          padding: '3px 9px', borderRadius: 5,
                          border: '1px solid #bbb', background: '#f5f5f5', color: '#333',
                          fontWeight: 'normal', cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        キーワード効果
                      </button>
                    )}
                    {/* アプ合体/ジョグレス進化: 複数体の素材を同時使用する特殊進化トリガー。
                        キーワードのテンプレート編集(isKeywordMode)では意味を成さないため出さない */}
                    {!isKeywordMode && (
                      <>
                        <button
                          type="button"
                          onClick={() => onChange({ ...block, trigger: 'app_gattai_evolve', triggers: ['app_gattai_evolve'] })}
                          style={{
                            padding: '3px 9px', borderRadius: 5,
                            border: '1px solid #bbb', background: '#f5f5f5', color: '#333',
                            fontWeight: 'normal', cursor: 'pointer', fontSize: 11,
                          }}
                        >
                          アプ合体
                        </button>
                        <button
                          type="button"
                          onClick={() => onChange({ ...block, trigger: 'jogress_evolve', triggers: ['jogress_evolve'] })}
                          style={{
                            padding: '3px 9px', borderRadius: 5,
                            border: '1px solid #bbb', background: '#f5f5f5', color: '#333',
                            fontWeight: 'normal', cursor: 'pointer', fontSize: 11,
                          }}
                        >
                          ジョグレス進化
                        </button>
                      </>
                    )}
                  </div>

                  {!perTriggerTimingOpen && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: '#666' }}>発動ターン:</span>
                      <ButtonGroup options={TIMING_OPTIONS.map((t) => ({ code: t.code, label: t.label }))} value={timing} onChange={(v) => setTiming(v as TimingKey)} accentColor="#2e7d32" />
                    </div>
                  )}
                  {/* トリガーごとに発動ターン/発動主体を分ける（スペース節約のため2つのチェック
                      ボックスを横並びにする）。
                      発動ターン: 例:「登場時」は無条件、「メインフェイズ開始時」だけ相手ターン
                      限定、を同じブロックで混在させたい場合。OFFなら上の共有「発動ターン」を
                      使う従来通りの挙動。
                      発動主体: 例:「相手のデジモン/テイマーがレストしたとき」(発動主体=相手) か
                      「自分のテイマーの下のカードが破棄されたとき」(発動主体=自分のテイマー+
                      位置=下) を1ブロックでORしたい場合など、トリガーごとに必要な発動主体が
                      異なるケース向け。ONにすると上の共有「発動主体」パネルは選べなくなる
                      （簡易版のため、デジモン/テイマー同時選択やレスト/アクティブ状態の
                      絞り込みはこのパネルでは選べない。L1/L2＋位置(本体/下/一番下)のみ） */}
                  {currentTriggers.length >= 2 && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#1a5a1a' }}>
                        <input
                          type="checkbox"
                          checked={perTriggerTimingOpen}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setPerTriggerTimingOpen(on);
                            if (on) {
                              // 現在の共有発動ターンを、各トリガーの個別値として引き継ぐ
                              // （event系のみ。timing系はコード自体に既に反映済み）
                              const nextMap: Record<string, TimingKey> = { ...(block.triggerTimingByCode || {}) };
                              currentTriggers.forEach((code) => {
                                const isTimingFam = effectiveTriggerFamilies.some((f) => f.kind === 'timing' && f.variants && Object.values(f.variants).includes(code));
                                if (!isTimingFam && nextMap[code] === undefined) nextMap[code] = timing;
                              });
                              onChange({ ...block, triggerTimingByCode: nextMap });
                            } else {
                              onChange({ ...block, triggerTimingByCode: {} });
                            }
                          }}
                        />
                        🔀 トリガーごとに発動ターンを分ける
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#1a5a1a' }}>
                        <input
                          type="checkbox"
                          checked={perTriggerSubjectOpen}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setPerTriggerSubjectOpen(on);
                            if (on) {
                              const nextMap: Record<string, string> = { ...(block.triggerSubjectByCode || {}) };
                              currentTriggers.forEach((code) => {
                                if (nextMap[code] === undefined) nextMap[code] = block.triggerSubject || 'self';
                              });
                              onChange({ ...block, triggerSubjectByCode: nextMap });
                            } else {
                              onChange({ ...block, triggerSubjectByCode: {} });
                            }
                          }}
                        />
                        🔀 トリガーごとに発動主体を分ける
                      </label>
                    </div>
                  )}
                  {perTriggerTimingOpen && (
                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {currentTriggers.map((code) => {
                        const fam = effectiveTriggerFamilies.find((f) => f.kind === 'timing' && f.variants && Object.values(f.variants).includes(code));
                        const label = fam ? fam.label : (effectiveTriggerFamilies.find((f) => f.code === code)?.label || FAMILY_VARIANT_FALLBACK_LABELS[code] || code);
                        const curTiming: TimingKey = fam && fam.variants
                          ? ((Object.entries(fam.variants) as [TimingKey, string][]).find(([, v]) => v === code)?.[0] || 'any')
                          : ((block.triggerTimingByCode || {})[code] || 'any');
                        const setThisTiming = (v: TimingKey) => {
                          if (fam && fam.variants) {
                            const newVariant = fam.variants[v];
                            const next = currentTriggers.map((t) => (t === code ? newVariant : t));
                            onChange({ ...block, trigger: next[0] || '', triggers: next });
                            return;
                          }
                          const nextMap = { ...(block.triggerTimingByCode || {}), [code]: v };
                          onChange({ ...block, triggerTimingByCode: nextMap });
                        };
                        return (
                          <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <span style={{ color: '#333', minWidth: 90 }}>{label}:</span>
                            <ButtonGroup options={TIMING_OPTIONS.map((t) => ({ code: t.code, label: t.label }))} value={curTiming} onChange={(v) => setThisTiming(v as TimingKey)} accentColor="#2e7d32" />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {perTriggerSubjectOpen && (
                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {currentTriggers.map((code) => {
                        const label = effectiveTriggerFamilies.find((f) => f.code === code)?.label
                          || FAMILY_VARIANT_FALLBACK_LABELS[code]
                          || dict.triggers.find((d) => d.code === code)?.label
                          || code;
                        const curSubjRaw = (block.triggerSubjectByCode || {})[code] || block.triggerSubject || 'self';
                        const rawSub = splitStackSuffix(curSubjRaw);
                        const subL1L2 = SUBJECT_CODE_TO_L1L2[rawSub.base] || { l1: 'self', l2: '' };
                        const setThisSubjectCode = (newCode: string) => {
                          const nextMap = { ...(block.triggerSubjectByCode || {}), [code]: newCode };
                          onChange({ ...block, triggerSubjectByCode: nextMap });
                        };
                        // 共有の発動主体パネル（handleL1/handleL2/applySubjDigiTamer）と全く同じ
                        // 挙動（自分/相手の複数選択＝両方への集約、デジモン+テイマー同時選択＝
                        // カード扱いへの集約）をトリガーごとに再現する
                        const handleThisL1 = (l1: string) => {
                          if (l1 === 'self') { setThisSubjectCode('self'); return; }
                          const l2 = subL1L2.l1 === l1 && subL1L2.l2 ? subL1L2.l2 : 'digimon';
                          setThisSubjectCode(SUBJECT_L1L2_TO_CODE[l1 + ':' + l2] || SUBJECT_L1L2_TO_CODE[l1 + ':digimon'] || l1);
                        };
                        const handleThisL2 = (l2: string) => {
                          setThisSubjectCode(SUBJECT_L1L2_TO_CODE[subL1L2.l1 + ':' + l2]);
                        };
                        const setThisStackPos = (pos: StackPos) => setThisSubjectCode(joinStackSuffix(rawSub.base, pos));
                        const l2Opts = subL1L2.l1 === 'other_own' ? SUBJECT_L2.filter((o) => o.code !== 'player') : SUBJECT_L2;
                        const thisHasDigimonTamer = subL1L2.l1 === 'own' || subL1L2.l1 === 'opp' || subL1L2.l1 === 'other_own' || subL1L2.l1 === 'both';
                        const thisDigimonCode = SUBJECT_L1L2_TO_CODE[subL1L2.l1 + ':digimon'];
                        const thisTamerCode = SUBJECT_L1L2_TO_CODE[subL1L2.l1 + ':tamer'];
                        const thisCardCode = SUBJECT_L1L2_TO_CODE[subL1L2.l1 + ':card'];
                        const thisDigimonChecked = thisHasDigimonTamer && (subL1L2.l2 === 'digimon' || subL1L2.l2 === 'card');
                        const thisTamerChecked = thisHasDigimonTamer && (subL1L2.l2 === 'tamer' || subL1L2.l2 === 'card');
                        const thisExclusiveL2Options = l2Opts.filter((o) => o.code !== 'digimon' && o.code !== 'tamer' && o.code !== 'card');
                        const applyThisDigiTamer = (nextDigimon: boolean, nextTamer: boolean) => {
                          if (nextDigimon && nextTamer) setThisSubjectCode(thisCardCode);
                          else if (nextDigimon) setThisSubjectCode(thisDigimonCode);
                          else if (nextTamer) setThisSubjectCode(thisTamerCode);
                          else setThisSubjectCode(subL1L2.l1);
                        };
                        const showStackPos = subL1L2.l1 === 'self' || subL1L2.l2 === 'digimon' || subL1L2.l2 === 'tamer';
                        return (
                          <div key={code} style={{ fontSize: 11, border: '1px solid #c5e0c5', borderRadius: 4, padding: 6 }}>
                            <div style={{ color: '#333', fontWeight: 'bold', marginBottom: 3 }}>{label}:</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              <MultiButtonGroup
                                options={SUBJECT_OWN_OPP}
                                values={[...(subL1L2.l1 === 'own' || subL1L2.l1 === 'both' ? ['own'] : []), ...(subL1L2.l1 === 'opp' || subL1L2.l1 === 'both' ? ['opp'] : [])]}
                                onToggle={(toggleCode, on) => {
                                  const ownOn = subL1L2.l1 === 'own' || subL1L2.l1 === 'both';
                                  const oppOn = subL1L2.l1 === 'opp' || subL1L2.l1 === 'both';
                                  const nextOwn = toggleCode === 'own' ? on : ownOn;
                                  const nextOpp = toggleCode === 'opp' ? on : oppOn;
                                  handleThisL1(nextOwn && nextOpp ? 'both' : nextOwn ? 'own' : nextOpp ? 'opp' : 'self');
                                }}
                                accentColor="#2e7d32"
                              />
                              <ButtonGroup
                                options={SUBJECT_L1_REST}
                                value={(subL1L2.l1 === 'own' || subL1L2.l1 === 'opp' || subL1L2.l1 === 'both') ? '' : subL1L2.l1}
                                onChange={handleThisL1}
                                accentColor="#2e7d32"
                              />
                            </div>
                            {thisHasDigimonTamer && (
                              <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <MultiButtonGroup
                                  options={[{ code: 'digimon', label: 'デジモン' }, { code: 'tamer', label: 'テイマー' }]}
                                  values={[...(thisDigimonChecked ? ['digimon'] : []), ...(thisTamerChecked ? ['tamer'] : [])]}
                                  onToggle={(toggleCode, on) => applyThisDigiTamer(
                                    toggleCode === 'digimon' ? on : thisDigimonChecked,
                                    toggleCode === 'tamer' ? on : thisTamerChecked
                                  )}
                                  accentColor="#2e7d32"
                                />
                                {thisExclusiveL2Options.length > 0 && (
                                  <ButtonGroup
                                    options={thisExclusiveL2Options}
                                    value={!thisDigimonChecked && !thisTamerChecked ? subL1L2.l2 : ''}
                                    onChange={handleThisL2}
                                    accentColor="#2e7d32"
                                  />
                                )}
                              </div>
                            )}
                            {!thisHasDigimonTamer && subL1L2.l1 !== 'self' && subL1L2.l1 !== 'both' && (
                              <div style={{ marginTop: 3 }}>
                                <ButtonGroup options={l2Opts} value={subL1L2.l2} onChange={handleThisL2} accentColor="#2e7d32" />
                              </div>
                            )}
                            {showStackPos && (
                              <div style={{ marginTop: 3 }}>
                                <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>位置:</span>
                                <ButtonGroup options={STACK_POS_OPTIONS} value={rawSub.pos} onChange={(v) => setThisStackPos(v as StackPos)} accentColor="#2e7d32" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 【〇〇が増えたとき】選択時のみ: 既存の「📍 場所」（取得元エリア）欄と
                      全く同じ作り（複数選択+2件以上ならOR/AND切替）でどのゾーンが
                      増えたときかを選ぶ */}
                  {block.trigger === ZONE_INCREASE_TRIGGER && (() => {
                    const zones = block.zoneIncrease || [];
                    const op = block.zoneIncreaseOp || 'or';
                    const toggleZone = (code: string) => {
                      const next = zones.includes(code) ? zones.filter((z) => z !== code) : [...zones, code];
                      update('zoneIncrease', next);
                    };
                    return (
                      <div style={{ marginTop: 6 }}>
                        <label style={{ fontSize: 11, color: '#666' }}>📍 場所</label>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                          {ZONE_INCREASE_OPTIONS.map((v) => {
                            const active = zones.includes(v.code);
                            return (
                              <button
                                key={v.code}
                                type="button"
                                onClick={() => toggleZone(v.code)}
                                style={{
                                  padding: '3px 9px', borderRadius: 5,
                                  border: active ? '2px solid #1a4f8a' : '1px solid #bbb',
                                  background: active ? '#1a4f8a' : '#f5f5f5',
                                  color: active ? '#fff' : '#333',
                                  fontWeight: active ? 'bold' : 'normal',
                                  cursor: 'pointer', fontSize: 11,
                                }}
                              >
                                {v.label}
                              </button>
                            );
                          })}
                        </div>
                        {zones.length >= 2 && (
                          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ color: '#666' }}>結合:</span>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`zoneIncreaseOp_${index}`}
                                checked={op === 'or'}
                                onChange={() => update('zoneIncreaseOp', 'or')}
                                style={{ margin: 0 }}
                              />
                              OR（いずれか）
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`zoneIncreaseOp_${index}`}
                                checked={op === 'and'}
                                onChange={() => update('zoneIncreaseOp', 'and')}
                                style={{ margin: 0 }}
                              />
                              AND（全て）
                            </label>
                          </div>
                        )}
                        {zones.some((z) => !ZONE_INCREASE_OPTIONS.find((v) => v.code === z)?.implemented) && (
                          <div style={{ marginTop: 4, fontSize: 11, color: '#c62828' }}>⚠ デッキ以外はエンジン未実装です（保存はできますが動作しません）</div>
                        )}
                      </div>
                    );
                  })()}

                  {unimplementedActive.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
                      {unimplementedActive.map(({ fam, axisLabel }) => (
                        <div key={fam.code}>⚠ 「{fam.label}」×「{axisLabel}」はエンジン未実装です（保存はできますが動作しません）</div>
                      ))}
                    </div>
                  )}

                  {/* 【アタック時】【アタック終了時】のときだけ、アタックの対象（プレイヤー/デジモン）を選べる。
                      実体はtriggerConditionsのcond_attack_target_player/digimonをこのUIから操作するだけ
                      （「対象」なので発動主体でも発動条件でもなく、トリガー自体の付帯情報として並べる） */}
                  {currentTriggers.some((t) => ATTACK_TRIGGER_CODES.includes(t)) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: '#666' }}>アタック対象:</span>
                      <ButtonGroup
                        options={[{ code: '', label: '指定なし' }, { code: 'player', label: 'プレイヤー' }, { code: 'digimon', label: 'デジモン' }]}
                        value={
                          triggerConditions.some((c) => c.base === 'cond_attack_target_player') ? 'player'
                            : triggerConditions.some((c) => c.base === 'cond_attack_target_digimon') ? 'digimon' : ''
                        }
                        onChange={(v) => {
                          const rest = triggerConditions.filter((c) => c.base !== 'cond_attack_target_player' && c.base !== 'cond_attack_target_digimon');
                          const withNew = v === 'player' ? [...rest, { base: 'cond_attack_target_player' }]
                            : v === 'digimon' ? [...rest, { base: 'cond_attack_target_digimon' }]
                            : rest;
                          update('triggerConditions', withNew);
                        }}
                        accentColor="#2e7d32"
                      />
                    </div>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, marginTop: 6, color: '#666' }}>
                    <input
                      type="checkbox"
                      checked={otherTriggerOpen || hasOtherSelected}
                      onChange={(e) => setOtherTriggerOpen(e.target.checked)}
                    />
                    その他のトリガー
                  </label>
                  {(otherTriggerOpen || hasOtherSelected) && (
                    <div style={{ marginTop: 4 }}>
                      <SearchSelect
                        value=""
                        onChange={addTrigger}
                        options={toOpts(dict.triggers).filter((o) => !allFamilyCodes.has(o.value) && !currentTriggers.includes(o.value))}
                        allowFreeText
                      />
                      <InlineDictAdd kind="triggers" dict={dict} onRegistered={addTrigger} />
                    </div>
                  )}

                  {/* チップ表示は「その他のトリガー」で追加した分だけ（よく使うトリガーはボタン自体の
                      ハイライトで選択状態が分かるため、重複表示しない） */}
                  {currentTriggers.some((t) => !allFamilyCodes.has(t)) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {currentTriggers.filter((t) => !allFamilyCodes.has(t)).map((t) => {
                        const label = dict.triggers.find((d) => d.code === t)?.label || t;
                        return (
                          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#e0f7f1', border: '1px solid #93c693', borderRadius: 12, fontSize: 11 }}>
                            {label}
                            <button type="button" onClick={() => removeTrigger(t)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c62828', fontWeight: 'bold', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {!perTriggerSubjectOpen && (
                <div className="field">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <label>発動主体</label>
                    {showRestActive && (
                      <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, fontWeight: 'normal' }}>
                          <input type="checkbox" checked={isRest} onChange={(e) => setRestActiveState(e.target.checked ? 'rest' : null)} />
                          レスト状態
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, fontWeight: 'normal' }}>
                          <input type="checkbox" checked={isActive} onChange={(e) => setRestActiveState(e.target.checked ? 'active' : null)} />
                          アクティブ状態
                        </label>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <MultiButtonGroup
                      options={SUBJECT_OWN_OPP}
                      values={[...(cur.l1 === 'own' || cur.l1 === 'both' ? ['own'] : []), ...(cur.l1 === 'opp' || cur.l1 === 'both' ? ['opp'] : [])]}
                      onToggle={(code, on) => {
                        const ownOn = cur.l1 === 'own' || cur.l1 === 'both';
                        const oppOn = cur.l1 === 'opp' || cur.l1 === 'both';
                        const nextOwn = code === 'own' ? on : ownOn;
                        const nextOpp = code === 'opp' ? on : oppOn;
                        handleL1(nextOwn && nextOpp ? 'both' : nextOwn ? 'own' : nextOpp ? 'opp' : 'self');
                      }}
                      accentColor="#2e7d32"
                    />
                    <ButtonGroup
                      options={SUBJECT_L1_REST}
                      value={(cur.l1 === 'own' || cur.l1 === 'opp' || cur.l1 === 'both') ? '' : cur.l1}
                      onChange={handleL1}
                      accentColor="#2e7d32"
                    />
                  </div>
                  {hasDigimonTamer && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <MultiButtonGroup
                        options={[{ code: 'digimon', label: 'デジモン' }, { code: 'tamer', label: 'テイマー' }]}
                        values={[...(subjDigimonChecked ? ['digimon'] : []), ...(subjTamerChecked ? ['tamer'] : [])]}
                        onToggle={(code, on) => applySubjDigiTamer(
                          code === 'digimon' ? on : subjDigimonChecked,
                          code === 'tamer' ? on : subjTamerChecked
                        )}
                        accentColor="#2e7d32"
                      />
                      {subjExclusiveL2Options.length > 0 && (
                        <ButtonGroup
                          options={subjExclusiveL2Options}
                          value={!subjDigimonChecked && !subjTamerChecked ? cur.l2 : ''}
                          onChange={handleL2}
                          accentColor="#2e7d32"
                        />
                      )}
                    </div>
                  )}
                  {!hasDigimonTamer && cur.l1 !== 'self' && cur.l1 !== 'both' && (
                    <div style={{ marginTop: 4 }}>
                      <ButtonGroup options={l2Options} value={cur.l2} onChange={handleL2} accentColor="#2e7d32" />
                    </div>
                  )}
                  {/* デジモン/テイマーのときだけ「本体/下/一番下」を選べる（進化元・テイマーの
                      下のカードを指す）。例:「自分のテイマーの下のカードが破棄されたとき」 */}
                  {showTriggerStackPos && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>位置:</span>
                      <ButtonGroup options={STACK_POS_OPTIONS} value={triggerStackPos} onChange={(v) => setTriggerStackPos(v as StackPos)} accentColor="#2e7d32" />
                    </div>
                  )}
                  {/* 「下」「一番下」のときだけ、積まれているカードの種別で絞り込める
                      （例:「自分のテイマーの下のデジモンカードが破棄されたとき」）。
                      本体を指しているとき（位置未選択）はL2選択自体が種別を兼ねるため出さない。 */}
                  {showTriggerStackPos && triggerStackPos !== '' && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>下のカード種別:</span>
                      <ButtonGroup
                        options={STACK_CARD_TYPE_OPTS}
                        value={triggerConditions.find((c) => c.base === 'cond_type')?.value || ''}
                        onChange={(v) => {
                          const rest = triggerConditions.filter((c) => c.base !== 'cond_type');
                          update('triggerConditions', v ? [...rest, { base: 'cond_type', value: v }] : rest);
                        }}
                        accentColor="#2e7d32"
                      />
                    </div>
                  )}
                </div>
                )}
              </div>
            );
          })()}

          {/* ☑ 原因選択: どのトリガーでも使える汎用の「原因」（バトルで/効果で + 原因の対象）。
              「誰が（消滅/破棄等）したか」は発動主体(triggerSubject/triggerSubjectByCode)で
              表現するので、こちらは「何が原因で（誰によって）発生したか」を表す。
              例:「このデジモンがバトルで相手のデジモンを消滅させたとき」
                → 発動主体=相手、原因=バトルで、原因の対象=このデジモン
              現状 on_destroy（消滅）/ when_evo_discard（進化元・テイマーの下の破棄）で
              動作する。それ以外のトリガーでは原因情報が無いため「原因なし」扱いになる */}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            marginTop: 10, fontWeight: 'bold', fontSize: 12, color: '#1a5a1a',
          }}>
            <input
              type="checkbox"
              checked={!!block.destroyCause}
              onChange={(e) => {
                if (e.target.checked) update('destroyCause', 'effect');
                else onChange({ ...block, destroyCause: undefined, destroyCauseSubject: undefined });
              }}
            />
            ☑ 原因選択（バトルで/効果で・トリガーが発生した原因を絞り込む）
          </label>
          {block.destroyCause && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>原因</div>
              <ButtonGroup
                options={[{ code: 'battle', label: 'バトルで' }, { code: 'effect', label: '効果で' }]}
                value={block.destroyCause}
                onChange={(v) => update('destroyCause', v as 'battle' | 'effect')}
                accentColor="#1a5a1a"
              />
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>
                  原因の対象
                  <span title="バトルで消滅した場合、通常の勝敗（相打ち/道連れ含む）なら「このデジモン」は実際に勝ったカードまで正確に判定されます。ただし【衝突】の自滅やセキュリティデジモンとのバトルなど一部の特殊ケースでは「自分」と同じ扱いになります">ℹ️</span>
                </div>
                <ButtonGroup
                  options={[{ code: 'self', label: 'このデジモン' }, { code: 'own', label: '自分' }, { code: 'opp', label: '相手' }, { code: 'both', label: '両方' }]}
                  value={block.destroyCauseSubject || 'self'}
                  onChange={(v) => update('destroyCauseSubject', v)}
                  accentColor="#1a5a1a"
                />
              </div>
            </div>
          )}

          {/* ☑ 条件を設定する（トリガー条件） */}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            marginTop: 10, fontWeight: 'bold', fontSize: 12, color: '#1a5a1a',
          }}>
            <input
              type="checkbox"
              checked={triggerCondsOpen}
              onChange={(e) => {
                setTriggerCondsOpen(e.target.checked);
                if (!e.target.checked && triggerConditions.length > 0) {
                  update('triggerConditions', []);
                }
              }}
            />
            ☑ 条件を設定する（トリガー条件・発火元カードへのフィルタ）
          </label>
          {triggerCondsOpen && (
            <div style={{ marginTop: 6 }}>
              <ConditionsHybridEditor
                conditions={triggerConditions}
                onChange={(next) => update('triggerConditions', next)}
                dict={dict}
                title="トリガー条件"
                hint="（このトリガーが発火する条件・トリガー発火元カードへのフィルタ）"
                theme="trigger"
                defaultSubject=""
                sameAsTargetSubject={targetBaseToCondSubject(block.target)}
                attackContextActive={isAttackTrigger}
                conditionsOp={block.triggerConditionsOp || 'and'}
                onConditionsOpChange={(op) => update('triggerConditionsOp', op)}
              />
            </div>
          )}
        </div>
        )}

        {/* === 💰 コスト（トリガー/アクションの間に独立配置。コストを伴う効果が多いため
            折りたたみトグルで表示/非表示できるようにする。効果1・代替アクション（その後/
            OR/AND）とも同じCostListEditorを使い回す） === */}
        {!COST_REDUCTION_TRIGGERS.has(block.trigger) && block.trigger !== 'passive' && (
        <details className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }} open={costs.length > 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0', color: '#b76e00' }}>
            💰 コスト（「〇〇することで」発動）{costs.length > 0 ? ` (${costs.length})` : ''}
          </summary>
          <CostListEditor
            dict={dict}
            costs={costs}
            updateCost={updateCost}
            addCost={addCost}
            removeCost={removeCost}
          />
        </details>
        )}

        {/* === ⚡ アクショングループ ===（コスト軽減・キーワード効果トリガーはアクション不要のため
            丸ごと非表示。条件・～ごとに は💰バナー側に埋め込み済み・キーワードは対象/条件が無い） */}
        {!COST_REDUCTION_TRIGGERS.has(block.trigger) && block.trigger !== 'passive' && (
        <div style={{
          gridColumn: '1 / span 2',
          padding: 10,
          background: '#eff5fd',
          border: '2px solid #b9c8e0',
          borderRadius: 6,
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 13, color: '#1976d2', marginBottom: 8 }}>
            ⚡ アクション（何をするか）
          </div>

          {/* 強制 / 任意 + 演出タイプ: 「〜できる」効果は optional をONにする。ONの間、発動前に
              「発動しますか？」の確認ダイアログが入る。アクション選択前から常に表示する
              （枠色は削除。演出タイプはこの行に統合）。
              強制/任意は効果1・代替アクションとも編集中の効果に対して個別に設定できる
              （例:「DP+3000し、その後そのデジモンでアタックできる」で、DP+3000（効果1）は
              強制のまま、その後のアタック（効果2）だけ任意にする、という使い方）。
              ただし現状、確認ダイアログはブロック全体でまとめて1回しか出せないため、
              代替アクション側だけ任意にしても実際の挙動には反映されない
              （JSON上は正しく区別して保存されるが、エンジン側の対応が別途必要）。
              演出タイプは効果1専用のまま（代替アクションには無い概念） */}
          {block.trigger !== 'alt_evolve' && !FUSION_EVOLVE_TRIGGERS.has(block.trigger) && (
            <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <ButtonGroup
                  options={[{ code: 'forced', label: '強制' }, { code: 'optional', label: '任意' }]}
                  value={effectOptional ? 'optional' : 'forced'}
                  onChange={(v) => updateEffect({ optional: v === 'optional' })}
                  accentColor="#2e7d32"
                />
                {isEditingAlt && (
                  <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>
                    ⚠この効果だけ独立して確認ダイアログを出す対応はエンジン未実装です（保存はできますが動作しません）
                  </div>
                )}
              </div>
              {!isEditingAlt && (
                <div>
                  <label style={{ fontSize: 11, color: '#666' }}>✨ 演出タイプ（空欄ならアクションコードから自動推測）</label>
                  <select value={block.visualType || ''} onChange={(e) => update('visualType', e.target.value)}>
                    <option value="">（自動推測）</option>
                    <option value="数値ポップアップ">数値ポップアップ</option>
                    <option value="消滅演出">消滅演出</option>
                    <option value="ドロー演出">ドロー演出</option>
                    <option value="カード登場">カード登場</option>
                    <option value="カード移動">カード移動</option>
                    <option value="状態付与演出">状態付与演出</option>
                    <option value="Sアタック+">Sアタック+</option>
                    <option value="ジョグレス進化">ジョグレス進化</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* 効果発動ポップアップの表示テキスト: 空欄なら効果テキストから自動抽出にフォールバック。
              強制効果のみ「表示しない」を選べる（任意効果は確認ダイアログが必須のため対象外）。
              強制/任意ボタンと同様、アクション選択前から常に表示する */}
          {block.trigger !== 'alt_evolve' && !FUSION_EVOLVE_TRIGGERS.has(block.trigger) && (
            <div className="field" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label>💬 効果発動ポップアップの表示テキスト（空欄なら効果テキストから自動抽出）</label>
                {!block.optional && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: '#666' }}>
                    <input
                      type="checkbox"
                      checked={!!block.noAnnounce}
                      onChange={(e) => update('noAnnounce', e.target.checked)}
                    />
                    表示しない
                  </label>
                )}
              </div>
              {!block.noAnnounce && (
                <textarea
                  value={block.displayText || ''}
                  onChange={(e) => update('displayText', e.target.value)}
                  rows={2}
                  placeholder="例: このデジモンは、進化元を持たない相手のデジモンにはブロックされない。"
                />
              )}
            </div>
          )}

          {block.trigger === 'alt_evolve' ? (
            <div style={{ fontSize: 11, color: '#888' }}>
              🔄 代替進化トリガーはアクション不要です（進化コストは上の🔄バナー内に入力済み）。
            </div>
          ) : FUSION_EVOLVE_TRIGGERS.has(block.trigger) ? (
            <div style={{ fontSize: 11, color: '#888' }}>
              🧬 アプ合体/ジョグレス進化トリガーはアクション不要です（素材候補・進化コストは上の🧬バナー内に入力済み）。
            </div>
          ) : COST_REDUCTION_TRIGGERS.has(block.trigger) ? (
            <div style={{ fontSize: 11, color: '#888' }}>
              💰 コスト軽減トリガーはアクション不要です（軽減量は上の💰バナー内に入力済み）。
            </div>
          ) : (() => {
          // アクションのグループ表示処理（_top/_bottom/_select 系を1エントリに）
          // ※ effectAction/effectValue = 編集中の効果（効果1=block自身 / 効果2以降=altActions[i]）
          const { options: rawActionDisplayOptions, flaggedBases, autoGroupBases } = buildActionDisplay(dict.actions);
          // よく使うボタン（COMMON_ACTIONS／レスト等のできない形／破棄／〇〇に置く）で
          // 既に選べるアクションは「その他のアクション」の候補から除外する（二重掲載を避ける）。
          // ※ DOABLE_TO_CANT_LIVE には redirect_attack のように COMMON_ACTIONS ボタンを持たない
          // （その他のアクションのみから選ぶ）コードも辞書経由で登録されうるため、実際に
          // ボタンとして存在するコードのできない形だけを除外対象にする
          const _cantButtonDoableCodes = COMMON_ACTIONS.map((a) => a.code).filter((c) => !!DOABLE_TO_CANT_LIVE[c]);
          const _cantButtonCantCodes = new Set(_cantButtonDoableCodes.map((c) => DOABLE_TO_CANT_LIVE[c]));
          const _buttonReachableCodes = new Set<string>([
            ...COMMON_ACTIONS.map((a) => a.code),
            ..._cantButtonDoableCodes,
            ..._cantButtonDoableCodes.map((c) => DOABLE_TO_CANT_LIVE[c]),
            'cant_attack_block',
            ...DISCARD_ACTION_CODES,
            ...PLACE_ACTION_CODES,
            ...SUMMON_KIND_CODES,
          ]);
          const actionDisplayOptions = rawActionDisplayOptions.filter((o) => !_buttonReachableCodes.has(o.value));
          const curVariant = getActionVariant(effectAction);
          // 🂠裏表フラグ判定: コスト側(costActionHasFlag)と同じロジック。完全一致を優先し、
          // 無ければ位置バリアントのベースコードでも引く（'place_on_security_top' のように
          // 位置バリアントではないのに語尾が "_top" と一致するケースの誤爆防止のため）
          const effectActionHasFaceOption = (() => {
            const exact = dict.actions.find((a) => a.code === effectAction);
            if (exact?.hasFaceOption) return true;
            const base = curVariant ? dict.actions.find((a) => a.code === curVariant!.base) : undefined;
            return !!base?.hasFaceOption;
          })();
          // 現在 effectAction が「位置バリアント表示」の対象か判定
          // ケースA: effectAction がフラグ付き base そのもの（例: "security_trash"）
          const isFlaggedBaseDirect = flaggedBases.has(effectAction);
          // ケースB: effectAction が <base>_<suffix> で base がフラグ付き or 自動グループ化対象
          const isVariantOfFlagged = !!(curVariant && (flaggedBases.has(curVariant.base) || autoGroupBases.has(curVariant.base)));
          const isPositional = isFlaggedBaseDirect || isVariantOfFlagged;

          // 表示用 value 正規化
          // - フラグ付き base 直: そのまま
          // - suffix 付き: 自動グループ化なら代表 code（autoGroupBases）、フラグ付き base なら base コード
          const normalizedActionValue = (() => {
            if (isFlaggedBaseDirect) return effectAction;
            if (curVariant && flaggedBases.has(curVariant.base)) return curVariant.base;
            if (curVariant && autoGroupBases.has(curVariant.base)) return curVariant.base + '_top'; // 代表
            return effectAction;
          })();

          // hasFromZones も持つアクション（例:「破棄する」+ 場所=進化元/デッキ/手札/セキュリティ）では、
          // 順序が意味を持つ場所（進化元/セキュリティ）を選んだとき、または対象がテイマー
          // （テイマーの下＝進化元と同じ仕組みのスタック）のときだけ位置pulldownを出す。
          // デッキ/手札には「上から/下から/選んで」の概念が無いため。
          // hasFromZones が無いアクション（evo_discard等の既存zone専用アクション）は従来通り常時表示
          const positionalBase = isFlaggedBaseDirect ? effectAction : (curVariant ? curVariant.base : effectAction);
          const positionalActionEntry = dict.actions.find((a) => a.code === positionalBase);
          const effectiveTargetForPosition = isEditingAlt ? (editingAlt!.target || '') : (block.target || '');
          const effectiveTargetL2ForPosition = TARGET_SEL_CODE_TO_L1L2[effectiveTargetForPosition.split(':')[0]]?.l2 || '';
          const zoneGatesPosition = !positionalActionEntry?.hasFromZones
            || effectFromZones.some((z) => z === 'evo_source' || z === 'security')
            || effectiveTargetL2ForPosition === 'tamer';
          // 位置 pulldown の選択肢（フラグ付き base は3種固定、autoGroup は dict にあるバリアントのみ）
          const variantOptions: SelectOption[] = (() => {
            if (!isPositional || !zoneGatesPosition) return [];
            if (isFlaggedBaseDirect || (curVariant && flaggedBases.has(curVariant.base))) {
              // フラグ付き base: 3種固定
              return POSITION_VARIANTS.map((v) => ({ value: v.suffix, label: v.label }));
            }
            if (curVariant && autoGroupBases.has(curVariant.base)) {
              return POSITION_VARIANTS
                .filter((v) => dict.actions.some((a) => a.code === curVariant.base + v.suffix))
                .map((v) => ({ value: v.suffix, label: v.label }));
            }
            return [];
          })();
          // 現在の suffix 値
          const currentSuffix = (() => {
            if (curVariant) return curVariant.suffix;
            if (isFlaggedBaseDirect) return ''; // 未選択
            return '';
          })();

          function onActionPulldownChange(newCode: string) {
            const newIsFlaggedBase = flaggedBases.has(newCode);
            const newV = getActionVariant(newCode);
            const cur = effectAction;
            const curV = getActionVariant(cur);

            // 同じ base なら何もしない（バリアント保持）
            const newBase = newIsFlaggedBase ? newCode : (newV ? newV.base : null);
            const curBase = curV ? curV.base : (flaggedBases.has(cur) ? cur : null);
            if (newBase && curBase && newBase === curBase) return;

            // フラグ付き base を新規選択 → デフォルト _top を付与
            if (newIsFlaggedBase) {
              changeEffectAction(newCode + '_top');
              return;
            }
            // 自動グループ化の代表 code (newCode = base + '_top')
            changeEffectAction(newCode);
          }
          function onVariantChange(newSuffix: string) {
            if (!newSuffix) return;
            // 現在の base を特定
            const base = isFlaggedBaseDirect ? effectAction : (curVariant ? curVariant.base : '');
            if (!base) return;
            changeEffectAction(base + newSuffix);
          }

          // 破棄（DISCARD_ZONE_MAP）: コスト側(CostListEditor)と全く同じ「場所ごとに実アクション
          // コードを切り替える」仕組みを効果1/代替アクションでも使えるようにする。
          // 辞書のhasPositionVariantフラグには頼らず、コスト側と同じくこのエディタ内で
          // 完結したハードコード機構として扱う（📍位置の二重表示を避けるため、下の
          // 汎用位置バリアントpulldownとisPositionalの判定からは除外する）。
          // 「その他アクション」で辞書の discard（破棄する。エンジン未実装のプレースホルダー）
          // を選んだ直後（まだ場所未選択）も、この📥場所パネルを表示する入り口として扱う
          const discardZoneBases = new Set(DISCARD_ZONE_MAP.map((z) => getActionVariant(z.action)?.base || z.action));
          const effectActionBase = getActionVariant(effectAction || '')?.base || (effectAction || '');
          const isDiscardActive = discardZoneBases.has(effectActionBase) || effectAction === 'discard';
          const activeDiscardZone = DISCARD_ZONE_MAP.find((z) => {
            if ((getActionVariant(z.action)?.base || z.action) !== effectActionBase) return false;
            if (z.target !== undefined && splitStackSuffix((effectTarget || '').split(':')[0]).base !== z.target) return false;
            return true;
          })?.code || '';

          // 〇〇に置く（PLACE_ZONE_MAP）: コスト側(CostListEditor)と全く同じ「置き場所ごとに
          // 実アクションコード・対象を切り替える」仕組みを効果1/代替アクションでも使えるようにする
          const isPlaceActive = PLACE_ACTION_CODES.has(effectAction || '');
          const activePlaceZone = PLACE_ZONE_MAP.find((z) => z.action === effectAction)?.code || '';

          // レスト/アクティブ/進化/アタック/ブロックの5ボタンは複数選択できる（例:
          // アタック＋ブロックを両方押す）。1つだけ選んでいるときは「する/できない」を
          // 選べるが、2つ以上選んでいるときは「する」（=複数の行動を同時に強制する、の意味に
          // なってしまい成立しない）が無く「できない」だけになる。
          // selectedSet=現在選ばれている項目一覧、mode=する/できないのどちらか
          // （effectActionが単一cant_X、またはcant_attack_block、またはAND altActionsで
          // 複数のcant_Xが積まれている状態から復元する。altActionsはブロック単位の概念のため、
          // 代替アクション編集中は自分の1件のみを見る）
          const { selectedSet, mode } = (() => {
            if (isEditingAlt) {
              if (DOABLE_TO_CANT_LIVE[effectAction]) return { selectedSet: [effectAction], mode: 'do' as const };
              if (effectAction === 'cant_attack_block') return { selectedSet: ['attack', 'block'], mode: 'cant' as const };
              const d = CANT_TO_DOABLE_LIVE[effectAction];
              return d ? { selectedSet: [d], mode: 'cant' as const } : { selectedSet: [] as string[], mode: 'do' as const };
            }
            if (DOABLE_TO_CANT_LIVE[effectAction]) return { selectedSet: [effectAction], mode: 'do' as const };
            if (effectAction === 'cant_attack_block') return { selectedSet: ['attack', 'block'], mode: 'cant' as const };
            const primary = CANT_TO_DOABLE_LIVE[effectAction];
            if (primary) {
              const set = [primary];
              if ((block.altActionsOp || 'or') === 'and') {
                (block.altActions || []).forEach((a) => {
                  const d = CANT_TO_DOABLE_LIVE[a.action || ''];
                  if (d && !set.includes(d)) set.push(d);
                });
              }
              return { selectedSet: set, mode: 'cant' as const };
            }
            return { selectedSet: [] as string[], mode: 'do' as const };
          })();
          // selectedSet/modeをblockへ書き戻す（1件なら単一アクション（する/できない）、
          // attack+blockの2件だけなら既存のcant_attack_blockに集約、それ以外の2件以上は
          // 常に「できない」として AND altActions（same_target）で表現）
          function applyCantSelection(nextSet: string[], nextMode: 'do' | 'cant') {
            if (isEditingAlt) {
              if (nextSet.length === 0) return;
              // 代替アクション（効果2以降）はaltActionsを持たないため、複数選択は
              // {アタック,ブロック}の2件のみ既存のcant_attack_blockで表現できる。
              // それ以外の2件以上は表現できないため、最後にクリックした1件のみ反映する
              if (nextSet.length === 2 && nextSet.includes('attack') && nextSet.includes('block')) {
                updateEffect({ action: 'cant_attack_block' });
                return;
              }
              const last = nextSet[nextSet.length - 1];
              // 「できない」に切り替える際は数値入力欄自体が不要になるため value を破棄する
              updateEffect({ action: nextMode === 'cant' ? DOABLE_TO_CANT_LIVE[last] : last, value: nextMode === 'cant' ? undefined : editingAlt!.value });
              return;
            }
            if (nextSet.length === 0) {
              onChange({ ...block, action: '', altActions: [], altActionsOp: undefined });
              return;
            }
            if (nextSet.length === 1) {
              const code = nextMode === 'cant' ? DOABLE_TO_CANT_LIVE[nextSet[0]] : nextSet[0];
              onChange({ ...block, action: code, value: nextMode === 'cant' ? undefined : block.value, altActions: [], altActionsOp: undefined });
              return;
            }
            // 2件以上は常に「できない」
            if (nextSet.length === 2 && nextSet.includes('attack') && nextSet.includes('block')) {
              onChange({ ...block, action: 'cant_attack_block', value: undefined, altActions: [], altActionsOp: undefined });
              return;
            }
            const [first, ...rest] = nextSet;
            onChange({
              ...block,
              action: DOABLE_TO_CANT_LIVE[first],
              value: undefined,
              altActions: rest.map((k) => ({ action: DOABLE_TO_CANT_LIVE[k], target: 'same_target' } as AltAction)),
              altActionsOp: 'and',
            });
          }
          function toggleCantAction(code: string) {
            const isSelected = selectedSet.includes(code);
            const nextSet = isSelected ? selectedSet.filter((x) => x !== code) : [...selectedSet, code];
            const nextMode = nextSet.length >= 2 ? 'cant' : mode;
            applyCantSelection(nextSet, nextMode);
          }

          // よく使うアクション（トリガー家族ボタンと同じ操作感）: 該当すればボタン1つで即選択、
          // 無ければ「その他のアクション」を開いて既存のプルダウン(+位置バリアント)から選ぶ
          const isCommonAction = COMMON_ACTIONS.some((a) => a.code === effectAction) || isDiscardActive || isPlaceActive || _cantButtonCantCodes.has(effectAction) || effectAction === 'cant_attack_block' || SUMMON_KIND_CODES.has(effectAction);
          function selectCommonAction(code: string) {
            if (isEditingAlt) { updateEffect({ action: code, value: '' }); return; }
            const dictEntry = findActionEntry(code);
            const allowsRules = !!(dictEntry && dictEntry.allowsRules) || hasRuleTranslator(code);
            const next: EffectBlock = { ...block, action: code, value: '' };
            if (!allowsRules && Array.isArray(block.rules) && block.rules.length > 0) next.rules = [];
            onChange(next);
          }

          // コストを支払わず/登場時効果は発揮しない は効果1・代替アクション（その後/OR/AND）とも
          // 対応。裏向きで、は効果1（メインアクション）専用のまま
          const showCostCheckboxes = effectAction === 'summon' || effectAction === 'summon_appear' || effectAction === 'summon_use' || effectAction === 'summon_from_trash' || effectAction === 'evolve' || effectAction === 'summon_from_evo_source' || effectAction === 'link';
          const showSkipOnPlay = effectAction === 'summon' || effectAction === 'summon_appear' || effectAction === 'summon_use' || effectAction === 'summon_from_trash';

          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: !isDiscardActive && !isPlaceActive && isPositional && variantOptions.length > 0 ? '2fr 1fr 1fr' : '2fr 1fr',
              gap: 8,
            }}>
              <div className="field">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <label>
                    アクション
                    {effectAction && (
                      isActionImplemented(effectAction, dict.actions.find((a) => a.code === effectAction)?.logicCode)
                        ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 6 }}>✅実装済</span>
                        : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 6 }} title="エンジン未実装">⚠未実装</span>
                    )}
                  </label>
                  {/* 「その後」: 効果2以降（代替アクション）のみ表示。この効果からAND/OR区間を
                      切り離し、独立した後続step（前段が不発でも必ず発動する）にする */}
                  {isEditingAlt && (
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', color: editingAlt?.thenBreak ? '#9333ea' : '#666', fontWeight: editingAlt?.thenBreak ? 'bold' : 'normal' }}
                      title="この効果から「その後」として独立させる（前の効果群が不発でもこの効果以降は必ず発動する）"
                    >
                      <input
                        type="checkbox"
                        checked={!!editingAlt?.thenBreak}
                        onChange={(e) => updateEffect({ thenBreak: e.target.checked || undefined })}
                      />
                      その後
                    </label>
                  )}
                  {/* summon / summon_from_trash / evolve / summon_from_evo_source 専用:
                      コストを支払わず / 登場時効果は発揮しない
                      裏向きで: place_on_security_top（辞書未登録のハードコード）に加え、
                      辞書側 hasFaceOption=true なアクション（例:「テイマーの下に置く」）でも表示。
                      いずれも効果1・代替アクション（その後/OR/AND）とも同じ作りにする */}
                  {(showCostCheckboxes || effectAction === 'place_on_security_top' || (effectActionHasFaceOption && !isDiscardActive)) && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {showCostCheckboxes && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={effectCostFree}
                            onChange={(e) => updateEffect({ costFree: e.target.checked })}
                          />
                          コストを支払わず
                        </label>
                      )}
                      {showSkipOnPlay && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={effectSkipOnPlay}
                            onChange={(e) => updateEffect({ skipOnPlay: e.target.checked })}
                          />
                          登場時効果は発揮しない
                        </label>
                      )}
                      {(effectAction === 'place_on_security_top' || (effectActionHasFaceOption && !isDiscardActive)) && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={effectOptions.includes('face_down')}
                            onChange={(e) => {
                              updateEffect({ options: e.target.checked ? [...effectOptions, 'face_down'] : effectOptions.filter((o) => o !== 'face_down') });
                            }}
                          />
                          裏向きで
                        </label>
                      )}
                    </div>
                  )}
                  {/* negate（「効果を発揮」）専用: どのトリガー効果を対象にするか + する/しない
                      （例:「登場時」＋「発揮しない」＝対象の登場時効果を発揮しない） */}
                  {effectAction === 'negate' && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#666' }}>対象のタイミング:</span>
                      <ButtonGroup
                        options={[{ code: 'on_play', label: '登場時' }, { code: 'on_evolve', label: '進化時' }]}
                        value={effectNegateTargetTrigger || ''}
                        onChange={(v) => updateEffect({ negateTargetTrigger: (v || undefined) as 'on_play' | 'on_evolve' | undefined })}
                        accentColor="#1976d2"
                      />
                      <ButtonGroup
                        options={[{ code: 'enable', label: '発揮する' }, { code: 'deny', label: '発揮しない' }]}
                        value={effectNegateDeny ? 'deny' : 'enable'}
                        onChange={(v) => updateEffect({ negateDeny: v === 'deny' })}
                        accentColor="#1976d2"
                      />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {/* 登場/使用: トリガーの複数選択と同じ操作感の独立2ボタン。両方押すと
                      action:'summon'（従来通りどちらも対象）、片方だけだとsummon_appear/
                      summon_use（デジモン/テイマー限定・オプション限定）になる */}
                  {(() => {
                    const appearOn = effectAction === 'summon' || effectAction === 'summon_appear';
                    const useOn = effectAction === 'summon' || effectAction === 'summon_use';
                    const toggleSummonKind = (kind: 'appear' | 'use', on: boolean) => {
                      const nextAppear = kind === 'appear' ? on : appearOn;
                      const nextUse = kind === 'use' ? on : useOn;
                      const nextAction = nextAppear && nextUse ? 'summon' : nextAppear ? 'summon_appear' : nextUse ? 'summon_use' : '';
                      selectCommonAction(nextAction);
                    };
                    return (
                      <MultiButtonGroup
                        options={SUMMON_KIND_OPTIONS}
                        values={[...(appearOn ? ['appear'] : []), ...(useOn ? ['use'] : [])]}
                        onToggle={(code, on) => toggleSummonKind(code as 'appear' | 'use', on)}
                        accentColor="#1976d2"
                      />
                    );
                  })()}
                  {COMMON_ACTIONS.map((a) => {
                    const isCantToggleGroup = !!DOABLE_TO_CANT_LIVE[a.code];
                    // レスト/アクティブ/進化/アタック/ブロックは複数選択できるトグル式ボタン
                    // （選んでいても「できない」形（cant_X等）になっていることがあるため、
                    // selectedSetでの判定にする。それ以外のボタンは従来通り単一選択）
                    const active = isCantToggleGroup ? selectedSet.includes(a.code) : effectAction === a.code;
                    return (
                      <button
                        key={a.code}
                        type="button"
                        onClick={() => (isCantToggleGroup ? toggleCantAction(a.code) : selectCommonAction(a.code))}
                        style={{
                          padding: '3px 9px', borderRadius: 5,
                          border: active ? '2px solid #1976d2' : '1px solid #bbb',
                          background: active ? '#1976d2' : '#f5f5f5',
                          color: active ? '#fff' : '#333',
                          fontWeight: active ? 'bold' : 'normal',
                          cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                  {/* 〇〇に置く: コスト側(CostListEditor)と同じ「置き場所ごとに実アクション
                      コード・対象を切り替える」ボタン */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isPlaceActive) return;
                      const z = PLACE_ZONE_MAP.find((zz) => zz.code === 'security')!;
                      updateEffect({ action: z.action, target: z.target || '', value: '' });
                    }}
                    style={{
                      padding: '3px 9px', borderRadius: 5,
                      border: isPlaceActive ? '2px solid #1976d2' : '1px solid #bbb',
                      background: isPlaceActive ? '#1976d2' : '#f5f5f5',
                      color: isPlaceActive ? '#fff' : '#333',
                      fontWeight: isPlaceActive ? 'bold' : 'normal',
                      cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    〇〇に置く
                  </button>
                </div>
                {isPlaceActive && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🎯 置き場所（どこに置くか）</div>
                    <ButtonGroup
                      options={PLACE_ZONE_MAP.map((z) => ({ code: z.code, label: z.label }))}
                      value={activePlaceZone}
                      onChange={(zoneCode) => {
                        if (zoneCode === activePlaceZone) return;
                        const z = PLACE_ZONE_MAP.find((zz) => zz.code === zoneCode);
                        if (!z) return;
                        updateEffect({ action: z.action, target: z.target || '', deckPosition: undefined, options: [], fromZones: [] });
                      }}
                      accentColor="#1976d2"
                    />
                    {(() => {
                      const z = PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone);
                      return z?.warn ? (
                        <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{z.warn}</div>
                      ) : null;
                    })()}
                    {/* セキュリティ/テイマー/進化元のときだけ、置くカードの取得元（手札等）を選べる */}
                    {PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone)?.hasFromZones && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📥 場所（どこから置くか）</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {FROM_ZONES.map((z) => {
                            const active = effectFromZones.includes(z.code);
                            return (
                              <button
                                key={z.code}
                                type="button"
                                onClick={() => {
                                  const next = active ? effectFromZones.filter((x) => x !== z.code) : [...effectFromZones, z.code];
                                  updateEffect({ fromZones: next });
                                }}
                                style={{
                                  padding: '3px 9px', borderRadius: 5,
                                  border: active ? '2px solid #1976d2' : '1px solid #bbb',
                                  background: active ? '#1976d2' : '#f5f5f5',
                                  color: active ? '#fff' : '#333',
                                  fontWeight: active ? 'bold' : 'normal',
                                  cursor: 'pointer', fontSize: 11,
                                }}
                              >
                                {z.label}
                              </button>
                            );
                          })}
                        </div>
                        {effectFromZones.length >= 2 && (
                          <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ color: '#666' }}>結合:</span>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input type="radio" name={`placeFromZonesOp_${index}_${editingEffect}`} checked={effectFromZonesOp === 'or'} onChange={() => updateEffect({ fromZonesOp: 'or' })} style={{ margin: 0 }} />
                              OR（いずれか）
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input type="radio" name={`placeFromZonesOp_${index}_${editingEffect}`} checked={effectFromZonesOp === 'and'} onChange={() => updateEffect({ fromZonesOp: 'and' })} style={{ margin: 0 }} />
                              AND（全て）
                            </label>
                          </div>
                        )}
                        {effectFromZones.some((z) => z !== 'evo_source' && z !== 'stacked_cards' && z !== 'linked') && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 誰の場所か</div>
                            <ButtonGroup
                              options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                              value={effectFromZoneOwner || ''}
                              onChange={(v) => updateEffect({ fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                              accentColor="#1976d2"
                            />
                          </div>
                        )}
                        {(effectFromZones.includes('evo_source') || effectFromZones.includes('stacked_cards')) && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{effectFromZones.includes('stacked_cards') && !effectFromZones.includes('evo_source') ? '重ねられているカードの対象' : '進化元の対象'}</div>
                            <ButtonGroup
                              options={[{ code: '', label: '指定なし' }, { code: 'self', label: 'このデジモン' }, { code: 'other', label: '他のデジモン' }]}
                              value={effectEvoSourceOwner || ''}
                              onChange={(v) => updateEffect({ evoSourceOwner: (v || undefined) as 'self' | 'other' | undefined })}
                              accentColor="#1976d2"
                            />
                            {effectEvoSourceOwner === 'other' && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                                <ButtonGroup
                                  options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                                  value={effectFromZoneOwner || ''}
                                  onChange={(v) => updateEffect({ fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                                  accentColor="#1976d2"
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {effectFromZones.includes('linked') && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>リンクカードの対象</div>
                            <ButtonGroup
                              options={[{ code: '', label: '指定なし' }, { code: 'self', label: 'このデジモン' }, { code: 'other', label: '他のデジモン' }]}
                              value={effectLinkedOwner || ''}
                              onChange={(v) => updateEffect({ linkedOwner: (v || undefined) as 'self' | 'other' | undefined })}
                              accentColor="#1976d2"
                            />
                            {effectLinkedOwner === 'other' && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                                <ButtonGroup
                                  options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                                  value={effectFromZoneOwner || ''}
                                  onChange={(v) => updateEffect({ fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                                  accentColor="#1976d2"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* 場所に「セキュリティ」/「進化元」を含む場合のみ: 積み重ね順の上/下どちらから見るか */}
                    {(effectFromZones.includes('security') || effectFromZones.includes('evo_source') || effectFromZones.includes('stacked_cards')) && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {effectFromZones.includes('security') && (
                          <div>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 セキュリティの位置</div>
                            <ButtonGroup
                              options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }]}
                              value={effectSecurityPosition || ''}
                              onChange={(v) => updateEffect({ securityPosition: (v || undefined) as 'top' | 'bottom' | undefined })}
                              accentColor="#1976d2"
                            />
                          </div>
                        )}
                        {(effectFromZones.includes('evo_source') || effectFromZones.includes('stacked_cards')) && (
                          <div>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 {effectFromZones.includes('stacked_cards') ? '重ねられているカードの位置' : '進化元の位置'}</div>
                            <ButtonGroup
                              options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'select', label: '選んで' }]}
                              value={effectEvoSourcePosition || ''}
                              onChange={(v) => updateEffect({ evoSourcePosition: (v || undefined) as 'top' | 'bottom' | 'select' | undefined })}
                              accentColor="#1976d2"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {/* セキュリティ/テイマーのときだけ「上/下/下か上」を選べる */}
                    {PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone)?.hasPosition && (() => {
                      const effectDeckPositionForPlace = isEditingAlt ? editingAlt!.deckPosition : block.deckPosition;
                      return (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 位置</div>
                          <ButtonGroup
                            options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '下か上' }]}
                            value={effectDeckPositionForPlace || ''}
                            onChange={(v) => updateEffect({ deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                            accentColor="#1976d2"
                          />
                        </div>
                      );
                    })()}
                    {/* セキュリティ/テイマーのときだけ「裏向き/表向き」を選べる */}
                    {PLACE_ZONE_MAP.find((zz) => zz.code === activePlaceZone)?.hasFace && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🂠 裏表</div>
                        <ButtonGroup
                          options={[{ code: '', label: '表向き' }, { code: 'face_down', label: '裏向き' }]}
                          value={effectOptions.includes('face_down') ? 'face_down' : ''}
                          onChange={(v) => updateEffect({ options: v ? [v] : [] })}
                          accentColor="#1976d2"
                        />
                      </div>
                    )}
                  </div>
                )}
                {isDiscardActive && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📥 場所（どこから破棄するか）</div>
                    <ButtonGroup
                      options={DISCARD_ZONE_MAP.map((z) => ({ code: z.code, label: z.label }))}
                      value={activeDiscardZone}
                      onChange={(zoneCode) => {
                        if (zoneCode === activeDiscardZone) return;
                        const z = DISCARD_ZONE_MAP.find((zz) => zz.code === zoneCode);
                        if (!z) return;
                        // z.targetが無い場所（進化元/テイマー/手札/デッキ/リンクカード）では既存のtargetを
                        // そのまま維持する（「対象」欄で選んだ自分/相手を場所切替で巻き戻さないため）。
                        // fromZones は設定しない（📍位置ボタンで既に場所+位置を action コードへ
                        // エンコード済みのため、汎用の「セキュリティ/進化元の位置」パネルと二重表示になるのを防ぐ）
                        updateEffect({ action: z.action, target: z.target || effectTarget, fromZones: undefined });
                      }}
                      accentColor="#1976d2"
                    />
                    {(() => {
                      const z = DISCARD_ZONE_MAP.find((zz) => zz.code === activeDiscardZone);
                      return z?.warn ? (
                        <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{z.warn}</div>
                      ) : null;
                    })()}
                    {(() => {
                      const zone = DISCARD_ZONE_MAP.find((zz) => zz.code === activeDiscardZone);
                      if (!zone?.hasPosition) return null;
                      const zoneBase = getActionVariant(zone.action)?.base || zone.action;
                      const curSuffix = getActionVariant(effectAction || '')?.suffix || '';
                      return (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 位置</div>
                          <ButtonGroup
                            options={POSITION_VARIANTS.map((v) => ({ code: v.suffix, label: v.label }))}
                            value={curSuffix}
                            onChange={(suffix) => { if (!suffix) return; changeEffectAction(zoneBase + suffix); }}
                            accentColor="#1976d2"
                          />
                        </div>
                      );
                    })()}
                    {/* 進化元/テイマー: 裏向き/表向きのカードだけを対象にするか。
                        evo_discard系は対象コンテナの絞り込みに block/altAction 側の
                        conditions（発動条件と同じ配列。EVO_DISCARD_ACTION_CODESは
                        ホワイトリスト無しで転送されるためtargetFilterではなくこちらを使う） */}
                    {(() => {
                      const zone = DISCARD_ZONE_MAP.find((zz) => zz.code === activeDiscardZone);
                      if (!zone?.hasFace) return null;
                      const faceIdx = effectConditions.findIndex((p) => p.base === 'cond_face_down' || p.base === 'cond_face_up');
                      const faceVal = faceIdx !== -1 ? (effectConditions[faceIdx].base === 'cond_face_down' ? 'down' : 'up') : '';
                      return (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🂠 裏表</div>
                          <ButtonGroup
                            options={[{ code: '', label: '指定なし' }, { code: 'down', label: '裏向きのみ' }, { code: 'up', label: '表向きのみ' }]}
                            value={faceVal}
                            onChange={(v) => {
                              const next = effectConditions.filter((p) => p.base !== 'cond_face_down' && p.base !== 'cond_face_up');
                              if (v === 'down') next.push({ base: 'cond_face_down' });
                              else if (v === 'up') next.push({ base: 'cond_face_up' });
                              updateEffect({ conditions: next });
                            }}
                            accentColor="#1976d2"
                          />
                        </div>
                      );
                    })()}
                  </div>
                )}
                {/* レスト/アクティブ/進化/アタック/ブロック: 「する」（通常）/「できない」（封じる）の
                    切り替え。上のボタンで2つ以上選んでいる場合は複数の行動を同時に強制する
                    「する」が成立しないため、「できない」固定（選択不要）になる */}
                {selectedSet.length === 1 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>する/できない</div>
                    <ButtonGroup
                      options={[{ code: 'do', label: 'する' }, { code: 'cant', label: 'できない' }]}
                      value={mode === 'cant' ? 'cant' : 'do'}
                      onChange={(v) => applyCantSelection(selectedSet, v === 'cant' ? 'cant' : 'do')}
                      accentColor="#1976d2"
                    />
                  </div>
                )}
                {selectedSet.length >= 2 && (
                  <div style={{ marginTop: 4, fontSize: 10, color: '#946200' }}>
                    ⚠ 複数選択中のため「できない」になります（同時に「する」ことはできないため）
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#666' }}>
                    <input
                      type="checkbox"
                      checked={otherActionOpen || (!!effectAction && !isCommonAction)}
                      onChange={(e) => setOtherActionOpen(e.target.checked)}
                    />
                    その他のアクション
                  </label>
                </div>
                {(otherActionOpen || (!!effectAction && !isCommonAction)) && (
                  <div style={{ marginTop: 4 }}>
                    <SearchSelect
                      value={normalizedActionValue}
                      onChange={onActionPulldownChange}
                      options={actionDisplayOptions}
                      allowFreeText
                    />
                    <InlineDictAdd kind="actions" dict={dict} onRegistered={onActionPulldownChange} />
                  </div>
                )}
              </div>
              {/* 位置バリアント pulldown: フラグ駆動 or 自動グループ化時のみ。
                  破棄（isDiscardActive）は専用の📍位置ボタンを別途表示するため、ここでは除外 */}
              {!isDiscardActive && !isPlaceActive && isPositional && variantOptions.length > 0 && (
                <div className="field">
                  <label>📍 位置</label>
                  <SearchSelect
                    value={currentSuffix}
                    onChange={onVariantChange}
                    options={variantOptions}
                  />
                </div>
              )}
              {/* 登場/使用・進化・リンクのときだけ「💰 コスト増減」を出し、通常の「値」入力は隠す
                  （同じ block.value を使うが、符号付き数値を直接入力させるより
                  増/減ボタン+絶対値入力の方が分かりやすいため）。
                  ※ エンジン側は現状 evolve の value を未参照（要実装）。link は対応済み。
                  増=+N（コスト+N）/ 減=-N（コスト-N）として value に符号付きで保存する。
                  キーワード付与(grant_keyword)のときは、下の「🎁 付与する効果」内の
                  キーワードごとの数値欄で block.value を管理するため、ここでは二重表示を避けて隠す */}
              {(effectAction === 'grant_keyword' || effectAction === 'grant_keyword_to') ? null
              : (effectAction === 'summon' || effectAction === 'summon_appear' || effectAction === 'summon_use' || effectAction === 'evolve' || effectAction === 'link') ? (
                <div className="field">
                  <label>💰 コスト増減</label>
                  {(() => {
                    const raw = effectValue;
                    // '-'/'+' は「符号だけ決まっていて数値は未定」のプレースホルダー
                    // （キーワードのレシピテンプレート登録時、実際の数値はカードごとに保存された
                    // 値が保存時に差し込まれるため、テンプレート側では数値を空にしておきたい場合に使う。
                    // 保存時（appendStep）はこの2文字をstep.valueへは出力せず、素通りさせる）
                    const isPlaceholder = raw === '-' || raw === '+';
                    const num = raw === undefined || raw === '' || isPlaceholder ? undefined : Number(raw);
                    const sign: 'plus' | 'minus' | '' = isPlaceholder
                      ? (raw === '-' ? 'minus' : 'plus')
                      : (num === undefined || isNaN(num) || num === 0 ? '' : (num > 0 ? 'plus' : 'minus'));
                    const magnitude = num === undefined || isNaN(num) ? '' : String(Math.abs(num));
                    const applyValue = (nextSign: 'plus' | 'minus', nextMagnitudeStr: string) => {
                      const m = nextMagnitudeStr === '' ? undefined : Number(nextMagnitudeStr);
                      if (m === undefined || isNaN(m) || m === 0) {
                        // 数値未入力でも符号の選択だけは保持する（テンプレート用プレースホルダー）
                        updateEffect({ value: nextSign === 'minus' ? '-' : '+' });
                        return;
                      }
                      updateEffect({ value: nextSign === 'minus' ? -m : m });
                    };
                    return (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <ButtonGroup
                          options={[{ code: 'minus', label: '減' }, { code: 'plus', label: '増' }]}
                          value={sign}
                          onChange={(v) => applyValue((v || 'minus') as 'plus' | 'minus', magnitude)}
                          accentColor="#1976d2"
                        />
                        <input
                          type="text"
                          value={magnitude}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v !== '' && !/^\d+$/.test(v)) return;
                            applyValue(sign === 'plus' ? 'plus' : 'minus', v);
                          }}
                          placeholder="空欄可（キーワード登録時等）"
                          style={{ width: 150 }}
                        />
                      </div>
                    );
                  })()}
                  {/* 対象が「このカード」のときは「アクションの対象数」欄が非表示になるため、
                      取得元エリア（手札/進化元等）から何枚選ぶかをここで別途指定できるようにする。
                      例:「進化元から特徴セイバーズを持つデジモンカード1枚を、このカードにリンクできる」
                      ⚠ エンジン側は現状1枚固定でハードコードしており、この値を未参照（要実装） */}
                  {(() => {
                    const _fcBase = (effectTarget || '').split(':')[0];
                    if (_fcBase !== 'self' && _fcBase !== 'self_card') return null;
                    return (
                      <div style={{ marginTop: 8 }}>
                        <label>枚数（取得元エリアから何枚選ぶか・省略時は1枚）</label>
                        <input
                          type="text"
                          value={effectFromCount === undefined ? '' : String(effectFromCount)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') { updateEffect({ fromCount: undefined }); return; }
                            if (!/^\d+$/.test(v)) return;
                            updateEffect({ fromCount: Number(v) });
                          }}
                          placeholder="例: 1"
                          style={{ width: 150 }}
                        />
                        <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>⚠ エンジン未実装（保存はできますが動作しません）</div>
                      </div>
                    );
                  })()}
                </div>
              ) : CANT_TO_DOABLE_LIVE[effectAction] ? null /* 「できない」(cant_X)系は値入力自体が不要なため非表示 */ : (
                <div className="field">
                  <label>値</label>
                  <input
                    type="text"
                    value={effectValue === undefined ? '' : String(effectValue)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') updateEffect({ value: undefined });
                      else if (/^\d+$/.test(v)) updateEffect({ value: Number(v) });
                      else updateEffect({ value: v });
                    }}
                    placeholder={effectAction === 'summon_token' ? 'トークンのカードNo (例: TK-01)' : '数値 (例: 1000)'}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* === 📐 ルール（アクション欄＝「その他のアクション」欄のすぐ下に配置。
            メインアクションが対応している場合のみ。block.action（効果1）に紐づく設定のため、
            効果2以降を編集中は非表示にする（効果1を選び直せば再表示される） === */}
        {actionAllowsRules && !isEditingAlt && (
          <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }}>
            <label>📐 ルール（メインアクションに紐づく追加処理）</label>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
              💡 各ルール = メインアクションと同じ「アクション + 対象 + 値 + 条件」の構造。
              例（デッキオープン）: ルール「アクション=手札に加える / 値=1 / 条件: 色=緑, タイプ=デジモン」
            </div>
            <div style={{ border: '1px solid #d8e0f0', borderRadius: 4, padding: 8, background: '#f3f6fc' }}>
              {ruleSteps.length === 0 && (
                <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>（ルール未追加）</div>
              )}
              {ruleSteps.map((rs, i) => (
                <RuleStepEditor
                  key={i}
                  index={i}
                  step={rs}
                  dict={dict}
                  onChange={(patch) => updateRuleStep(i, patch)}
                  onRemove={() => removeRuleStep(i)}
                  onUp={i > 0 ? () => moveRuleStep(i, -1) : undefined}
                  onDown={i < ruleSteps.length - 1 ? () => moveRuleStep(i, 1) : undefined}
                  isAttackTrigger={isAttackTrigger}
                />
              ))}
              <button
                onClick={addRuleStep}
                style={{
                  padding: '4px 10px', border: '1px dashed #88a', background: 'white',
                  borderRadius: 3, cursor: 'pointer', fontSize: 12, color: '#3b6cd1', marginTop: 4,
                }}
              >
                ＋ ルールを追加
              </button>
            </div>
          </div>
        )}

        {/* OR/AND（複数アクションの組合せ方）: 📐ルールより下に配置
            （その他のアクションとは別の設定なので、混同しないよう枠と背景色で視覚的に分ける）。
            「その後」は各効果タブの「アクション」欄の隣にあるチェックボックスで個別に指定する */}
        <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '4px 10px', background: '#f5eefc', border: '1px solid #d8b4fe', borderRadius: 14,
          }}>
            <span style={{ fontSize: 10, color: '#9333ea', fontWeight: 'bold' }}>🔀 複数アクション</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#666' }}>
              <input
                type="checkbox"
                checked={isOrChecked}
                onChange={(e) => setAltMode(e.target.checked ? 'or' : (isAndChecked ? 'and' : null))}
              />
              OR（どちらかを選ぶ）
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#666' }}>
              <input
                type="checkbox"
                checked={isAndChecked}
                onChange={(e) => setAltMode(e.target.checked ? 'and' : (isOrChecked ? 'or' : null))}
              />
              AND（両方行う）
            </label>
          </div>
        </div>

        {/* 「編集中」の効果切替 + 設定内容一覧 */}
        {(isOrChecked || isAndChecked) && (
          <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
              💡 編集中の効果を選んでください。上のアクション/対象/対象数/発動条件/場所/期間は選んだ効果に反映されます。
              効果ごとに「アクション」欄の隣の「その後」にチェックを入れると、そこだけAND/ORから切り離して独立した「その後」に区切れます（例:「AとBはAND、その後C」）。
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => setEditingEffect(0)} style={altBtnStyle(editingEffect === 0)}>
                効果1
              </button>
              {altActions.map((a, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <button type="button" onClick={() => setEditingEffect(i + 1)} style={altBtnStyle(editingEffect === i + 1)}>
                    効果{i + 2}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAltAction(i)}
                    title="この効果を削除"
                    style={{ padding: '2px 6px', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => { addAltAction(); setEditingEffect(altActions.length + 1); }}
                style={{ padding: '4px 10px', border: '1px dashed #9333ea', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11, color: '#9333ea' }}
              >
                ＋ 効果を追加
              </button>
            </div>
            {/* 選択内容の一覧表示: 押したボタンの表記をそのまま連結して書き出す。
                thenBreakが立っている効果には「（その後）」を付けて見分けられるようにする */}
            <div style={{ marginTop: 8, padding: 8, background: 'white', border: '1px solid #d4b8f0', borderRadius: 4 }}>
              <div style={{ fontSize: 11, color: '#9333ea', fontWeight: 'bold', marginBottom: 4 }}>📋 設定内容</div>
              <div style={{ fontSize: 12, color: '#333', lineHeight: 1.8 }}>
                <div>効果1：{describeEffect(block.action, block.value, block.target, block.conditions) || '(未設定)'}</div>
                {altActions.map((a, i) => (
                  <div key={i}>
                    効果{i + 2}{a.thenBreak ? '（その後）' : ''}：{describeEffect(a.action, a.value, a.target, a.conditions) || '(未設定)'}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}



        {/* 📍 場所（取得元エリア）: 登場/使用・進化はビルトインのため常時対象、
            それ以外は辞書の hasFromZones=true のアクションのみ表示。編集中の効果に対して読み書き。
            「〇〇に置く」(isPlaceActive)専用の📥場所パネルと辞書側hasFromZonesが両方満たされる
            アクション（place_on_security_top等）では二重表示になってしまうため、
            isPlaceActive中はこちらを出さない */}
        {!PLACE_ACTION_CODES.has(effectAction || '') && (BUILTIN_FROM_ZONE_ACTIONS.has(effectAction) || !!dict.actions.find((a) => a.code === effectAction)?.hasFromZones) && (() => {
          const zones = effectFromZones;
          const op = effectFromZonesOp;
          const toggleZone = (code: string) => {
            const next = zones.includes(code) ? zones.filter((z) => z !== code) : [...zones, code];
            updateEffect({ fromZones: next });
          };
          return (
            <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }}>
              <label>📍 場所</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {FROM_ZONES.map((z) => {
                  const active = zones.includes(z.code);
                  return (
                    <button
                      key={z.code}
                      type="button"
                      onClick={() => toggleZone(z.code)}
                      style={{
                        padding: '3px 9px', borderRadius: 5,
                        border: active ? '2px solid #1a4f8a' : '1px solid #bbb',
                        background: active ? '#1a4f8a' : '#f5f5f5',
                        color: active ? '#fff' : '#333',
                        fontWeight: active ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: 11,
                      }}
                    >
                      {z.label}
                    </button>
                  );
                })}
              </div>
              {zones.length >= 2 && (
                <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ color: '#666' }}>結合:</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`fromZonesOp_${index}_${editingEffect}`}
                      checked={op === 'or'}
                      onChange={() => updateEffect({ fromZonesOp: 'or' })}
                      style={{ margin: 0 }}
                    />
                    OR（いずれか）
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`fromZonesOp_${index}_${editingEffect}`}
                      checked={op === 'and'}
                      onChange={() => updateEffect({ fromZonesOp: 'and' })}
                      style={{ margin: 0 }}
                    />
                    AND（全て）
                  </label>
                </div>
              )}
              {zones.some((z) => z !== 'evo_source' && z !== 'stacked_cards' && z !== 'linked') && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 誰の場所か</div>
                  <ButtonGroup
                    options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                    value={effectFromZoneOwner || ''}
                    onChange={(v) => updateEffect({ fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                    accentColor="#1a4f8a"
                  />
                </div>
              )}
              {/* 場所に「進化元」/「重ねられているカード」を含む場合のみ: どのデジモンの
                  進化元から探すか ('self'=このデジモン / 'other'=他のデジモン / 未指定='指定なし')。
                  「他のデジモン」のときだけ「自分/相手」を追加表示する */}
              {(zones.includes('evo_source') || zones.includes('stacked_cards')) && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{zones.includes('stacked_cards') && !zones.includes('evo_source') ? '重ねられているカードの対象' : '進化元の対象'}</div>
                  <ButtonGroup
                    options={[
                      { code: '', label: '指定なし' },
                      { code: 'self', label: 'このデジモン' },
                      { code: 'other', label: '他のデジモン' },
                    ]}
                    value={effectEvoSourceOwner || ''}
                    onChange={(v) => updateEffect({ evoSourceOwner: (v || undefined) as 'self' | 'other' | undefined })}
                    accentColor="#1a4f8a"
                  />
                  {effectEvoSourceOwner === 'other' && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                      <ButtonGroup
                        options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                        value={effectFromZoneOwner || ''}
                        onChange={(v) => updateEffect({ fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                        accentColor="#1a4f8a"
                      />
                    </div>
                  )}
                </div>
              )}
              {/* 場所に「リンクカード」を含む場合のみ: どのデジモンのリンクカードから探すか */}
              {zones.includes('linked') && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>リンクカードの対象</div>
                  <ButtonGroup
                    options={[
                      { code: '', label: '指定なし' },
                      { code: 'self', label: 'このデジモン' },
                      { code: 'other', label: '他のデジモン' },
                    ]}
                    value={effectLinkedOwner || ''}
                    onChange={(v) => updateEffect({ linkedOwner: (v || undefined) as 'self' | 'other' | undefined })}
                    accentColor="#1a4f8a"
                  />
                  {effectLinkedOwner === 'other' && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>👤 自分/相手</div>
                      <ButtonGroup
                        options={[{ code: '', label: 'どちらでも' }, { code: 'self', label: '自分' }, { code: 'opponent', label: '相手' }]}
                        value={effectFromZoneOwner || ''}
                        onChange={(v) => updateEffect({ fromZoneOwner: (v || undefined) as 'self' | 'opponent' | undefined })}
                        accentColor="#1a4f8a"
                      />
                    </div>
                  )}
                </div>
              )}
              {/* 場所に「セキュリティ」/「進化元」/「重ねられているカード」を含む場合のみ:
                  積み重ね順の上/下どちらから見るか */}
              {(zones.includes('security') || zones.includes('evo_source') || zones.includes('stacked_cards')) && (
                <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {zones.includes('security') && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 セキュリティの位置</div>
                      <ButtonGroup
                        options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }]}
                        value={effectSecurityPosition || ''}
                        onChange={(v) => updateEffect({ securityPosition: (v || undefined) as 'top' | 'bottom' | undefined })}
                        accentColor="#1a4f8a"
                      />
                    </div>
                  )}
                  {(zones.includes('evo_source') || zones.includes('stacked_cards')) && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 {zones.includes('stacked_cards') && !zones.includes('evo_source') ? '重ねられているカードの位置' : '進化元の位置'}</div>
                      <ButtonGroup
                        options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'select', label: '選んで' }]}
                        value={effectEvoSourcePosition || ''}
                        onChange={(v) => updateEffect({ evoSourcePosition: (v || undefined) as 'top' | 'bottom' | 'select' | undefined })}
                        accentColor="#1a4f8a"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* 🎯 追加の対象: 「対象」ボックスの「追加」チェックボックスONで表示。対象1に加えて
            2体目以降の当事者を自由に追加できる汎用機能。全アクション共通（このカード自身を
            暗黙の当事者にする設計は廃止し、必要なら対象1/対象2...のどちらでも「このカード」を
            明示的に選べるようにする）。対象1と同じコード体系（TARGET_SEL_L1/L2）＋
            各枠ごとに独立した「対象の条件」を持てる ⚠ エンジン未実装（保存はできますが動作しません） */}
        {hasExtraTargets && (() => {
          const setExtraTargets = (next: ExtraTarget[]) => updateEffect({ extraTargets: next });
          const addExtraTarget = () => setExtraTargets([...effectExtraTargets, { target: '' }]);
          const removeExtraTarget = (idx: number) => setExtraTargets(effectExtraTargets.filter((_: ExtraTarget, i: number) => i !== idx));
          const updateExtraTarget = (idx: number, patch: Partial<ExtraTarget>) => {
            const next = effectExtraTargets.slice();
            next[idx] = { ...next[idx], ...patch };
            setExtraTargets(next);
          };
          return (
            <div className="field" style={{ marginTop: 8, background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
              <label style={{ fontWeight: 'bold', color: '#b76e00' }}>
                🎯 追加の対象
                <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                  （対象1に加えてもう1体以上の当事者。例:「バトルする」で
                  「自分の他のデジモン1体と相手のデジモン1体を戦わせる」）
                </span>
              </label>
              {effectExtraTargets.map((et: ExtraTarget, idx: number) => {
                const etBase = (et.target || '').split(':')[0];
                const etSuffix = (et.target || '').substring(etBase.length);
                const etCurL1L2 = TARGET_SEL_CODE_TO_L1L2[etBase] || { l1: '', l2: '' };
                const setEtTarget = (l1: string, l2?: string) => {
                  if (!l1) { updateExtraTarget(idx, { target: '' }); return; }
                  if (l1 === 'self') { updateExtraTarget(idx, { target: 'self_card' }); return; }
                  const useL2 = l2 || (etCurL1L2.l1 === l1 && etCurL1L2.l2 ? etCurL1L2.l2 : 'digimon');
                  updateExtraTarget(idx, { target: (TARGET_SEL_L1L2_TO_CODE[l1 + ':' + useL2] || '') + etSuffix });
                };
                const etL2Options = TARGET_SEL_L2[etCurL1L2.l1] || [];
                const etHideCount = etBase === 'self' || etBase === 'self_card' || etBase === 'same_target' || !etBase;
                return (
                  <div key={idx} style={{ marginTop: idx === 0 ? 4 : 8, paddingTop: idx === 0 ? 0 : 8, borderTop: idx === 0 ? 'none' : '1px dashed #ffd591' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#b76e00' }}>対象{idx + 2}</div>
                      <button
                        type="button"
                        onClick={() => removeExtraTarget(idx)}
                        style={{ fontSize: 10, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                      >
                        ✕ 削除
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                      <MultiButtonGroup
                        options={TARGET_SEL_OWN_OPP}
                        values={[...(etCurL1L2.l1 === 'own' || etCurL1L2.l1 === 'both' ? ['own'] : []), ...(etCurL1L2.l1 === 'opp' || etCurL1L2.l1 === 'both' ? ['opp'] : [])]}
                        onToggle={(code, on) => {
                          const ownOn = etCurL1L2.l1 === 'own' || etCurL1L2.l1 === 'both';
                          const oppOn = etCurL1L2.l1 === 'opp' || etCurL1L2.l1 === 'both';
                          const nextOwn = code === 'own' ? on : ownOn;
                          const nextOpp = code === 'opp' ? on : oppOn;
                          setEtTarget(nextOwn && nextOpp ? 'both' : nextOwn ? 'own' : nextOpp ? 'opp' : '');
                        }}
                        accentColor="#b76e00"
                      />
                      <ButtonGroup
                        options={TARGET_SEL_L1_REST}
                        value={(etCurL1L2.l1 === 'own' || etCurL1L2.l1 === 'opp' || etCurL1L2.l1 === 'both') ? TARGET_SEL_NONE_ACTIVE : etCurL1L2.l1}
                        onChange={(l1) => setEtTarget(l1)}
                        accentColor="#b76e00"
                      />
                    </div>
                    {etL2Options.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <ButtonGroup
                          options={etL2Options}
                          value={etCurL1L2.l2}
                          onChange={(l2) => setEtTarget(etCurL1L2.l1, l2)}
                          accentColor="#b76e00"
                        />
                      </div>
                    )}
                    {!etHideCount && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>🎯 対象数</div>
                        <ButtonGroup
                          options={TARGET_COUNTS.map((o) => ({ code: o.code, label: o.label || '指定なし' }))}
                          value={etSuffix}
                          onChange={(v) => updateExtraTarget(idx, { target: etBase + v })}
                          accentColor="#b76e00"
                        />
                      </div>
                    )}
                    <div style={{ marginTop: 6 }}>
                      <ConditionsHybridEditor
                        conditions={et.targetFilter || []}
                        onChange={(next) => updateExtraTarget(idx, { targetFilter: next })}
                        dict={dict}
                        title="対象の条件"
                        hint="（この対象の絞り込み条件・複数 AND）"
                        theme="action"
                        defaultSubject=""
                        showSubjectSelector={false}
                        supportsMultiValue={true}
                        part="full"
                      />
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addExtraTarget}
                style={{ marginTop: 8, fontSize: 11, padding: '3px 8px', background: '#fff', border: '1px solid #ffd591', borderRadius: 4, cursor: 'pointer', color: '#b76e00' }}
              >
                + 対象を追加
              </button>
              <div style={{ marginTop: 6, fontSize: 10, color: '#c62828' }}>
                ⚠ エンジン未実装（保存はできますが、追加した対象は動作に反映されません）
              </div>
            </div>
          );
        })()}

        {/* 上/下（デッキに戻す位置など）: 辞書の hasDeckPosition=true なアクションのみ表示。
            両方チェック＝「どちらか選んで」はエンジン未対応（'top'以外は全て下として扱われる）。
            OR/AND/その後で「効果2」以降を編集中のときは、そちらのアクション/位置を見る
            （常にblock=効果1側を見てしまうと、効果2で「デッキに戻す」を選んでも出てこない） */}
        {!!dict.actions.find((a) => a.code === effectAction)?.hasDeckPosition && (() => {
          const effectDeckPosition = isEditingAlt ? editingAlt!.deckPosition : block.deckPosition;
          const top = effectDeckPosition === 'top' || effectDeckPosition === 'both';
          const bottom = effectDeckPosition === 'bottom' || effectDeckPosition === 'both';
          const setPos = (nextTop: boolean, nextBottom: boolean) => {
            const v = nextTop && nextBottom ? 'both' : nextTop ? 'top' : nextBottom ? 'bottom' : undefined;
            updateEffect({ deckPosition: v });
          };
          return (
            <div className="field" style={{ marginTop: 8 }}>
              <label>📍 上/下</label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={top} onChange={(e) => setPos(e.target.checked, bottom)} />
                  上
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={bottom} onChange={(e) => setPos(top, e.target.checked)} />
                  下
                </label>
                {top && bottom && (
                  <span style={{ fontSize: 11, color: '#c62828' }}>
                    ⚠ 両方選択（どちらか選んで）はエンジン未対応です（保存はできますが「下」と同じ動作になります）
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* immune_effects 専用:「相手の効果を受けない」の対象範囲
            （デジモン/テイマー/オプション全て なのか、デジモンの効果のみ なのか） */}
        {block.action === 'immune_effects' && (
          <div className="field" style={{ marginTop: 8, background: '#fdf2f8', padding: 8, borderRadius: 4, border: '1px solid #f5b8d8' }}>
            <div style={{ fontWeight: 'bold', color: '#9d174d', marginBottom: 4, fontSize: 12 }}>
              🛡 相手のどの効果を受けないか
            </div>
            <ButtonGroup
              options={[
                { code: '', label: 'カード（デジモン/テイマー/オプション問わず）' },
                { code: 'digimon', label: 'デジモンの効果のみ' },
              ]}
              value={block.immuneCardType || ''}
              onChange={(v) => update('immuneCardType', (v || '') as 'digimon' | '')}
              accentColor="#9d174d"
            />
          </div>
        )}

        {/* memory_plus 専用: このターン終了時メモリー-N */}
        {block.action === 'memory_plus' && (
          <div className="field" style={{ marginTop: 8, background: '#eef4ff', padding: 8, borderRadius: 4, border: '1px solid #b3c8ff' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 'bold', color: '#1a5fb4' }}>
              <input
                type="checkbox"
                checked={!!block.revertAtTurnEnd}
                onChange={(e) => update('revertAtTurnEnd', e.target.checked)}
              />
              このターン終了時にメモリーを-N（revert_at_turn_end）
            </label>
            <span style={{ fontSize: 10, color: '#666' }}>
              「メモリーを+Nする。このターン終了時、メモリーを-Nする。」のカード用（グラビティブレス / メタルグレイモン等）
            </span>
          </div>
        )}

        {/* 対象 / 対象数 (アクションのターゲット) */}
        {(() => {
          // 効果2以降（代替アクション）を編集中は「デジモン+テイマー同時選択(AND)」だけ省略する
          // （AND側は altActions を入れ子で使う実装のため、代替アクション自身には適用できない）。
          // OR側（対象コード=card+cond_typeフィルタ）はaltActionsのネストが不要なので効果1と同様に対応する。
          // 「対象の条件」（targetFilter）は効果1と同じ ConditionsHybridEditor を使い回す
          if (isEditingAlt) {
            const eBase = (effectTarget || '').split(':')[0];
            const eSuffix = (effectTarget || '').substring(eBase.length);
            const eCurTgt = TARGET_SEL_CODE_TO_L1L2[eBase] || { l1: '', l2: '' };
            const eL2Options = eCurTgt.l1 === 'most' ? MOST_PLAYER_METRICS : (TARGET_SEL_L2[eCurTgt.l1] || []);
            const eHasDigimonTamer = (eCurTgt.l1 === 'own' || eCurTgt.l1 === 'opp' || eCurTgt.l1 === 'other_own' || eCurTgt.l1 === 'both');
            const eDigimonCode = TARGET_SEL_L1L2_TO_CODE[eCurTgt.l1 + ':digimon'];
            const eTamerCode = TARGET_SEL_L1L2_TO_CODE[eCurTgt.l1 + ':tamer'];
            const eCardCode = TARGET_SEL_L1L2_TO_CODE[eCurTgt.l1 + ':card'];
            const eIsOrMode = eCurTgt.l2 === 'card' && effectTargetFilter.some((c) => c.base === 'cond_type' && /デジモン/.test(c.value || '') && /テイマー/.test(c.value || ''));
            const eDigimonChecked = eHasDigimonTamer && (eCurTgt.l2 === 'digimon' || eIsOrMode);
            const eTamerChecked = eHasDigimonTamer && (eCurTgt.l2 === 'tamer' || eIsOrMode);
            const eExclusiveL2Options = eL2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer');
            const eHideCount = eBase === 'self' || eBase === 'self_card' || eBase === 'same_target';
            const eIsUnimplemented = TARGET_SEL_UNIMPLEMENTED.has(eBase) || eIsOrMode;
            const eShowTargetFilter =
              eCurTgt.l1 === 'self' ||
              eCurTgt.l1 === 'same_target' ||
              (eCurTgt.l1 === 'own' && ['digimon', 'card', 'tamer'].includes(eCurTgt.l2)) ||
              (eCurTgt.l1 === 'opp' && ['digimon', 'tamer'].includes(eCurTgt.l2)) ||
              (eCurTgt.l1 === 'other_own' && eCurTgt.l2 === 'digimon');
            const setEffTgt = (l1: string, l2?: string) => {
              // OR選択中に他のL1/L2へ切り替えたら、自動設定していたtype絞り込みは持ち越さない
              const cleared = eIsOrMode ? { targetFilter: effectTargetFilter.filter((c) => c.base !== 'cond_type') } : {};
              if (!l1) { updateEffect({ ...cleared, target: '' }); return; }
              // self/self_card・same_target は「対象数」UIを表示しない（eHideCount）ため、
              // 直前の対象で付いていた数指定を持ち越さないようここで破棄する
              if (l1 === 'self') { updateEffect({ ...cleared, target: 'self_card' }); return; }
              if (l1 === 'same_target') { updateEffect({ ...cleared, target: 'same_target' }); return; }
              const useL2 = l2 || (eCurTgt.l1 === l1 && eCurTgt.l2 ? eCurTgt.l2 : (l1 === 'most' ? 'security' : 'digimon'));
              updateEffect({ ...cleared, target: (TARGET_SEL_L1L2_TO_CODE[l1 + ':' + useL2] || '') + eSuffix });
            };
            // デジモン/テイマーのOR複数選択（対象コード=card + cond_typeフィルタ）を反映
            const applyEffDigiTamerSelection = (nextDigimon: boolean, nextTamer: boolean) => {
              if (nextDigimon && nextTamer) {
                updateEffect({ target: eCardCode + eSuffix,
                  targetFilter: [...effectTargetFilter.filter((c) => c.base !== 'cond_type'), { base: 'cond_type', value: 'デジモン,テイマー' }] });
              } else if (nextDigimon) {
                updateEffect({ target: eDigimonCode + eSuffix, targetFilter: effectTargetFilter.filter((c) => c.base !== 'cond_type') });
              } else if (nextTamer) {
                updateEffect({ target: eTamerCode + eSuffix, targetFilter: effectTargetFilter.filter((c) => c.base !== 'cond_type') });
              } else {
                updateEffect({ target: '', targetFilter: effectTargetFilter.filter((c) => c.base !== 'cond_type') });
              }
            };
            return (
              <div style={{ display: 'grid', gridTemplateColumns: eHideCount ? '1fr' : '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
                  <label style={{ fontWeight: 'bold', color: '#b76e00', display: 'flex', alignItems: 'center' }}>
                    🎯 対象{hasExtraTargets ? '1' : ''}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 'normal', color: '#666', cursor: 'pointer' }}>
                      <input type="checkbox" checked={hasExtraTargets} onChange={(e) => setHasExtraTargets(e.target.checked)} style={{ margin: 0 }} />
                      追加
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <MultiButtonGroup
                      options={TARGET_SEL_OWN_OPP}
                      values={[...(eCurTgt.l1 === 'own' || eCurTgt.l1 === 'both' ? ['own'] : []), ...(eCurTgt.l1 === 'opp' || eCurTgt.l1 === 'both' ? ['opp'] : [])]}
                      onToggle={(code, on) => {
                        const ownOn = eCurTgt.l1 === 'own' || eCurTgt.l1 === 'both';
                        const oppOn = eCurTgt.l1 === 'opp' || eCurTgt.l1 === 'both';
                        const nextOwn = code === 'own' ? on : ownOn;
                        const nextOpp = code === 'opp' ? on : oppOn;
                        setEffTgt(nextOwn && nextOpp ? 'both' : nextOwn ? 'own' : nextOpp ? 'opp' : '');
                      }}
                      accentColor="#b76e00"
                    />
                    <ButtonGroup
                      options={TARGET_SEL_L1_REST}
                      value={(eCurTgt.l1 === 'own' || eCurTgt.l1 === 'opp' || eCurTgt.l1 === 'both') ? TARGET_SEL_NONE_ACTIVE : eCurTgt.l1}
                      onChange={(l1) => setEffTgt(l1)}
                      accentColor="#b76e00"
                    />
                  </div>
                  {eHasDigimonTamer && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => applyEffDigiTamerSelection(!eDigimonChecked, eTamerChecked)}
                        style={{
                          padding: '3px 9px', borderRadius: 5,
                          border: eDigimonChecked ? '2px solid #b76e00' : '1px solid #bbb',
                          background: eDigimonChecked ? '#b76e00' : '#f5f5f5',
                          color: eDigimonChecked ? '#fff' : '#333',
                          fontWeight: eDigimonChecked ? 'bold' : 'normal',
                          cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        デジモン
                      </button>
                      <button
                        type="button"
                        onClick={() => applyEffDigiTamerSelection(eDigimonChecked, !eTamerChecked)}
                        style={{
                          padding: '3px 9px', borderRadius: 5,
                          border: eTamerChecked ? '2px solid #b76e00' : '1px solid #bbb',
                          background: eTamerChecked ? '#b76e00' : '#f5f5f5',
                          color: eTamerChecked ? '#fff' : '#333',
                          fontWeight: eTamerChecked ? 'bold' : 'normal',
                          cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        テイマー
                      </button>
                      {eExclusiveL2Options.length > 0 && (
                        <ButtonGroup
                          options={eExclusiveL2Options}
                          value={!eDigimonChecked && !eTamerChecked ? eCurTgt.l2 : ''}
                          onChange={(l2) => setEffTgt(eCurTgt.l1, l2)}
                          accentColor="#b76e00"
                        />
                      )}
                    </div>
                  )}
                  {!eHasDigimonTamer && eL2Options.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <ButtonGroup options={eL2Options} value={eCurTgt.l2} onChange={(l2) => setEffTgt(eCurTgt.l1, l2)} accentColor="#b76e00" />
                    </div>
                  )}
                  {eIsUnimplemented && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
                      ⚠ {eIsOrMode ? '複数対象（OR）は' : 'この対象は'}エンジン未実装です（保存はできますが動作しません）
                    </div>
                  )}
                  {eShowTargetFilter && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 6, padding: '4px 6px', background: 'white', borderRadius: 3, border: '1px solid #b2dfdb' }}>
                        {[
                          { code: 'cond_self_rest',   label: 'レスト状態' },
                          { code: 'cond_self_active', label: 'アクティブ状態' },
                        ].map((f) => {
                          const checked = effectTargetFilter.some((c) => c.base === f.code);
                          return (
                            <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) { if (!checked) updateEffect({ targetFilter: [...effectTargetFilter, { base: f.code, value: '' }] }); }
                                  else updateEffect({ targetFilter: effectTargetFilter.filter((c) => c.base !== f.code) });
                                }}
                                style={{ margin: 0 }}
                              />
                              {f.label}
                            </label>
                          );
                        })}
                      </div>
                      <ConditionsHybridEditor
                        conditions={effectTargetFilter}
                        onChange={(next) => updateEffect({ targetFilter: next })}
                        dict={dict}
                        title="対象の条件"
                        hint="（対象カードの絞り込み条件・複数 AND）"
                        theme="action"
                        defaultSubject=""
                        showSubjectSelector={false}
                        supportsMultiValue={true}
                        part="full"
                      />
                    </div>
                  )}
                </div>
                {!eHideCount && (
                  <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
                    <label style={{ fontWeight: 'bold', color: '#b76e00' }}>🎯 対象数</label>
                    <ButtonGroup
                      options={TARGET_COUNTS.map((o) => ({ code: o.code, label: o.label || '指定なし' }))}
                      value={eSuffix}
                      onChange={(v) => updateEffect({ target: eBase + v })}
                      accentColor="#b76e00"
                    />
                  </div>
                )}
              </div>
            );
          }
          const tgtL2Options = curTgt.l1 === 'most' ? MOST_PLAYER_METRICS : (TARGET_SEL_L2[curTgt.l1] || []);
          // デジモン/テイマーだけは複数選択可（例:「相手のデジモン/テイマーを1体消滅させる」）。
          // カード/セキュリティ/プレイヤーは従来通り単一選択（デジモン/テイマーの複数選択とは排他）
          const exclusiveL2Options = tgtL2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer');
          const hasDigimonTamer = (curTgt.l1 === 'own' || curTgt.l1 === 'opp' || curTgt.l1 === 'other_own' || curTgt.l1 === 'both');
          const digimonCode = TARGET_SEL_L1L2_TO_CODE[curTgt.l1 + ':digimon'];
          const tamerCode = TARGET_SEL_L1L2_TO_CODE[curTgt.l1 + ':tamer'];
          const cardCode = TARGET_SEL_L1L2_TO_CODE[curTgt.l1 + ':card'];
          // 現在の複数選択状態を、target(+targetFilter/altActions)から逆算する
          const isOrMode = curTgt.l2 === 'card' && targetFilter.some((c) => c.base === 'cond_type' && /デジモン/.test(c.value || '') && /テイマー/.test(c.value || ''));
          const isAndMode = curTgt.l2 === 'digimon' && block.altActionsOp === 'and'
            && (block.altActions || []).length === 1 && block.altActions![0].target === tamerCode;
          const digimonChecked = hasDigimonTamer && (curTgt.l2 === 'digimon' || isOrMode || isAndMode);
          const tamerChecked = hasDigimonTamer && (curTgt.l2 === 'tamer' || isOrMode || isAndMode);
          const combineMode: 'or' | 'and' = isAndMode ? 'and' : 'or';
          const hideCount = tgtBase === 'self' || tgtBase === 'self_card' || tgtBase === 'same_target';
          const isUnimplemented = TARGET_SEL_UNIMPLEMENTED.has(tgtBase) || isOrMode || isAndMode;

          const handleTgtL1 = (l1: string) => {
            // OR/ANDで自動設定していたフィルタ/代替アクションはL1切替時に一旦クリアする
            const cleared = (isOrMode || isAndMode)
              ? { altActions: [], altActionsOp: undefined, targetFilter: targetFilter.filter((c) => c.base !== 'cond_type') }
              : {};
            if (!l1) { onChange({ ...block, ...cleared, target: '' }); return; }
            // self/self_card・same_target は「対象数」UI自体を表示しない（hideCount）ため、
            // 直前に他の対象で付いていた数指定(例: ":1")を持ち越さないようここで破棄する
            if (l1 === 'self') { onChange({ ...block, ...cleared, target: 'self_card' }); return; }
            if (l1 === 'same_target') { onChange({ ...block, ...cleared, target: 'same_target' }); return; }
            const l2 = curTgt.l1 === l1 && curTgt.l2 ? curTgt.l2 : (l1 === 'most' ? 'security' : 'digimon');
            onChange({ ...block, ...cleared, target: (TARGET_SEL_L1L2_TO_CODE[l1 + ':' + l2] || '') + tgtSuffix });
          };
          const handleTgtL2 = (l2: string) => {
            const next = TARGET_SEL_L1L2_TO_CODE[curTgt.l1 + ':' + l2] || '';
            if (isAndMode) {
              // デジモン+テイマー(AND)で自動設定した代替アクションを解除してから切り替える
              onChange({ ...block, target: next + tgtSuffix, altActions: [], altActionsOp: undefined });
            } else {
              setTarget(next, tgtSuffix);
            }
          };
          // デジモン/テイマーの複数選択（OR=同一対象コード+タイプフィルタ／AND=代替アクションで2体別々に指定）を反映
          const applyDigiTamerSelection = (nextDigimon: boolean, nextTamer: boolean, mode: 'or' | 'and') => {
            if (nextDigimon && nextTamer) {
              if (mode === 'or') {
                onChange({ ...block, target: cardCode + tgtSuffix, altActions: [], altActionsOp: undefined,
                  targetFilter: [...targetFilter.filter((c) => c.base !== 'cond_type'), { base: 'cond_type', value: 'デジモン,テイマー' }] });
              } else {
                onChange({ ...block, target: digimonCode + tgtSuffix,
                  targetFilter: targetFilter.filter((c) => c.base !== 'cond_type'),
                  altActions: [{ action: block.action || '', value: block.value, target: tamerCode }], altActionsOp: 'and' });
              }
            } else if (nextDigimon) {
              onChange({ ...block, target: digimonCode + tgtSuffix, altActions: [], altActionsOp: undefined,
                targetFilter: targetFilter.filter((c) => c.base !== 'cond_type') });
            } else if (nextTamer) {
              onChange({ ...block, target: tamerCode + tgtSuffix, altActions: [], altActionsOp: undefined,
                targetFilter: targetFilter.filter((c) => c.base !== 'cond_type') });
            } else {
              onChange({ ...block, target: '', altActions: [], altActionsOp: undefined,
                targetFilter: targetFilter.filter((c) => c.base !== 'cond_type') });
            }
          };

          // 対象数ボックス（右列）自体は hideCount のとき非表示だが、対象の条件（詳細パネル側）
          // は「このカード」等でも表示したいため、条件パネルがある場合は列を維持する
          const showSecondColumn = !hideCount || showTargetFilter;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: showSecondColumn ? '1fr 1fr' : '1fr', gap: 8, marginTop: 8 }}>
              <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
                <label style={{ fontWeight: 'bold', color: '#b76e00', display: 'flex', alignItems: 'center' }}>
                  🎯 アクションの対象{hasExtraTargets ? '1' : ''}
                  <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                    （このアクションが効果を与えるカード／デジモン）
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 'normal', color: '#666', cursor: 'pointer' }}>
                    <input type="checkbox" checked={hasExtraTargets} onChange={(e) => setHasExtraTargets(e.target.checked)} style={{ margin: 0 }} />
                    追加
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <MultiButtonGroup
                    options={TARGET_SEL_OWN_OPP}
                    values={[...(curTgt.l1 === 'own' || curTgt.l1 === 'both' ? ['own'] : []), ...(curTgt.l1 === 'opp' || curTgt.l1 === 'both' ? ['opp'] : [])]}
                    onToggle={(code, on) => {
                      const ownOn = curTgt.l1 === 'own' || curTgt.l1 === 'both';
                      const oppOn = curTgt.l1 === 'opp' || curTgt.l1 === 'both';
                      const nextOwn = code === 'own' ? on : ownOn;
                      const nextOpp = code === 'opp' ? on : oppOn;
                      handleTgtL1(nextOwn && nextOpp ? 'both' : nextOwn ? 'own' : nextOpp ? 'opp' : '');
                    }}
                    accentColor="#b76e00"
                  />
                  <ButtonGroup
                    options={TARGET_SEL_L1_REST}
                    value={(curTgt.l1 === 'own' || curTgt.l1 === 'opp' || curTgt.l1 === 'both') ? TARGET_SEL_NONE_ACTIVE : curTgt.l1}
                    onChange={handleTgtL1}
                    accentColor="#b76e00"
                  />
                </div>
                {hasDigimonTamer && (
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => applyDigiTamerSelection(!digimonChecked, tamerChecked, combineMode)}
                      style={{
                        padding: '3px 9px', borderRadius: 5,
                        border: digimonChecked ? '2px solid #b76e00' : '1px solid #bbb',
                        background: digimonChecked ? '#b76e00' : '#f5f5f5',
                        color: digimonChecked ? '#fff' : '#333',
                        fontWeight: digimonChecked ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: 11,
                      }}
                    >
                      デジモン
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDigiTamerSelection(digimonChecked, !tamerChecked, combineMode)}
                      style={{
                        padding: '3px 9px', borderRadius: 5,
                        border: tamerChecked ? '2px solid #b76e00' : '1px solid #bbb',
                        background: tamerChecked ? '#b76e00' : '#f5f5f5',
                        color: tamerChecked ? '#fff' : '#333',
                        fontWeight: tamerChecked ? 'bold' : 'normal',
                        cursor: 'pointer', fontSize: 11,
                      }}
                    >
                      テイマー
                    </button>
                    {exclusiveL2Options.length > 0 && (
                      <ButtonGroup
                        options={exclusiveL2Options}
                        value={!digimonChecked && !tamerChecked ? curTgt.l2 : ''}
                        onChange={handleTgtL2}
                        accentColor="#b76e00"
                      />
                    )}
                  </div>
                )}
                {!hasDigimonTamer && tgtL2Options.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <ButtonGroup options={tgtL2Options} value={curTgt.l2} onChange={handleTgtL2} accentColor="#b76e00" />
                  </div>
                )}
                {/* 対象＝自分/相手→セキュリティ、かつアクションが「セキュリティを破棄」の
                    ときだけ「上/下/選んで/全て」の位置ボタンを出す。以前は📥場所パネル側で
                    target:'own_security'を初期値にしていたが、この対象欄と書き込みが競合し
                    位置選択後に場所/位置の表示が消える不具合があったため、位置はこちらの
                    対象欄に一本化した（誰の・どの位置のセキュリティかをここで完結できる） */}
                {curTgt.l2 === 'security' && (getActionVariant(block.action || '')?.base || block.action) === 'security_trash' && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>📍 位置</div>
                    <ButtonGroup
                      options={POSITION_VARIANTS.map((v) => ({ code: v.suffix, label: v.label }))}
                      value={getActionVariant(block.action || '')?.suffix || ''}
                      onChange={(suffix) => { if (!suffix) return; changeAction('security_trash' + suffix); }}
                      accentColor="#b76e00"
                    />
                  </div>
                )}
                {digimonChecked && tamerChecked && (
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#666' }}>対象の結合:</span>
                    <ButtonGroup
                      options={[{ code: 'or', label: 'OR' }, { code: 'and', label: 'AND' }]}
                      value={combineMode}
                      onChange={(v) => applyDigiTamerSelection(true, true, v as 'or' | 'and')}
                      accentColor="#b76e00"
                    />
                  </div>
                )}
                {isUnimplemented && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
                    ⚠ {(isOrMode || isAndMode) ? '複数対象（OR/AND）は' : 'この対象は'}エンジン未実装です（保存はできますが動作しません）
                  </div>
                )}
                {/* === 🔍 対象の条件: ボタン列はここ（対象ボックス側）、詳細パネルは
                    右の対象数ボックス側に表示する（対象条件を開いたときの縦の余白を防ぐため）。
                    対象が 自分→デジモン/カード/テイマー・相手→デジモン/テイマー・他→デジモン のときのみ表示 */}
                {showTargetFilter && (
                  <div style={{ marginTop: 8 }}>
                    {/* よく使う状態（クイックチェックボックス） */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 6, padding: '4px 6px', background: 'white', borderRadius: 3, border: '1px solid #b2dfdb' }}>
                      {[
                        { code: 'cond_self_rest',   label: 'レスト状態' },
                        { code: 'cond_self_active', label: 'アクティブ状態' },
                      ].map((f) => {
                        const checked = targetFilter.some((c) => c.base === f.code);
                        return (
                          <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) { if (!checked) update('targetFilter', [...targetFilter, { base: f.code, value: '' }]); }
                                else update('targetFilter', targetFilter.filter((c) => c.base !== f.code));
                              }}
                              style={{ margin: 0 }}
                            />
                            {f.label}
                          </label>
                        );
                      })}
                    </div>
                    <ConditionsHybridEditor
                      conditions={targetFilter}
                      onChange={(next) => update('targetFilter', next)}
                      dict={dict}
                      title="対象の条件"
                      hint="（対象カードの絞り込み条件・複数 AND）"
                      theme="action"
                      defaultSubject=""
                      showSubjectSelector={false}
                      supportsMultiValue={true}
                      part="buttons"
                      otherOpen={targetFilterOtherOpen}
                      onOtherOpenChange={setTargetFilterOtherOpen}
                    />
                  </div>
                )}
              </div>
              {showSecondColumn && (
                <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
                  {!hideCount && (
                    <>
                      <label style={{ fontWeight: 'bold', color: '#b76e00' }}>
                        🎯 アクションの対象数
                        <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                          （何体に適用するか）
                        </span>
                      </label>
                      <ButtonGroup
                        options={TARGET_COUNTS.map((o) => ({ code: o.code, label: o.label || '指定なし' }))}
                        value={tgtSuffix}
                        onChange={(v) => setTarget(tgtBase, v)}
                        accentColor="#b76e00"
                      />
                    </>
                  )}
                  {showTargetFilter && (
                    <div style={{ marginTop: hideCount ? 0 : 8, border: '1px solid #b2dfdb', borderRadius: 4, background: '#e0f7f5', padding: 8 }}>
                      <ConditionsHybridEditor
                        conditions={targetFilter}
                        onChange={(next) => update('targetFilter', next)}
                        dict={dict}
                        title="対象の条件"
                        hint=""
                        theme="action"
                        defaultSubject=""
                        showSubjectSelector={false}
                        supportsMultiValue={true}
                        part="panels"
                        otherOpen={targetFilterOtherOpen}
                        onOtherOpenChange={setTargetFilterOtherOpen}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* 📥 取得元カードの条件: 進化/登場アクション専用。対象＝このカード自身であっても、
            実際に絞り込みたいのは取得元エリア（手札等）から選ぶカードの方（例:「このデジモンを
            手札の『クロノモン』の記述があるデジモンカードに進化できる」）。「対象の条件」
            （このカード自身に掛かる条件）とは別データ（block.fromFilter/AltAction.fromFilter）
            で持つ。効果1・代替アクション（その後/OR/AND）とも同じ場所を使い回す */}
        {showRetrievalFilterEffective && (
          <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8, background: '#e0f7f5', border: '1px solid #b2dfdb', borderRadius: 4, padding: 8 }}>
            <ConditionsHybridEditor
              conditions={effectFromFilter}
              onChange={(next) => updateEffect({ fromFilter: next })}
              dict={dict}
              title="取得元カードの条件"
              hint="（進化先/登場先として取得元エリアから選ぶカードの絞り込み。対象＝このカード自身の条件とは別物）"
              theme="action"
              defaultSubject=""
              showSubjectSelector={false}
              supportsMultiValue={true}
              showTypeInTargetFilter={true}
              part="full"
            />
          </div>
        )}

        {/* ⏳ 期間（クイックボタン）: ✅を入れるとボタンが現れる。編集中の効果（効果1/効果2以降）
            に対して読み書きする。「〜の間（汎用）」等もL1に含む */}
        <div className="field" style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showDurationPanel || !!effectDuration}
              onChange={(e) => {
                setShowDurationPanel(e.target.checked);
                if (!e.target.checked) updateEffect({ duration: undefined });
              }}
            />
            ⏳ 期間
          </label>
          {(showDurationPanel || !!effectDuration) && (() => {
            const durL1 = durationToL1(effectDuration);
            const durL2Options = DURATION_L2[durL1] || [];
            const durL2Value = durL2Options.some((o) => o.code === effectDuration) ? (effectDuration || '') : '';
            return (
              <div style={{ marginTop: 4 }}>
                <ButtonGroup
                  options={DURATION_L1}
                  value={durL1}
                  onChange={(l1) => {
                    if (!DURATION_L2[l1]) { updateEffect({ duration: l1 }); return; }
                    // 既に同じグループ内なら自分/相手の選択を保持、そうでなければ「自分」を既定に
                    updateEffect({ duration: durL1 === l1 ? (effectDuration || DURATION_L2[l1][0].code) : DURATION_L2[l1][0].code });
                  }}
                  accentColor="#1a4f8a"
                />
                {durL2Options.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <ButtonGroup
                      options={durL2Options}
                      value={durL2Value}
                      onChange={(v) => updateEffect({ duration: v })}
                      accentColor="#1a4f8a"
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* === 🎯 発動条件（常時表示・デフォルト折りたたみ・データあれば展開） ===
            コスト軽減トリガーは同内容の編集欄を上の💰バナー内に直接表示しているため、
            ここでの二重表示は避ける */}
        {!COST_REDUCTION_TRIGGERS.has(block.trigger) && (
        <details className="field" style={{ marginTop: 8 }} open={conditions.length > 0 || !!block.perCount}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0', color: '#1a4f8a' }}>
            🎯 発動条件{conditions.length > 0 ? ` (${conditions.length})` : ''}
          </summary>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
            このカード自身やゲーム状況を確認する条件。対象カードを色/タイプで絞る場合は「ターゲットフィルタ」を使用
          </div>
          <ConditionsHybridEditor
            conditions={effectConditions}
            onChange={(next) => updateEffect({ conditions: next })}
            dict={dict}
            title={isEditingAlt ? `発動条件（効果${editingEffect + 1}）` : '発動条件'}
            hint={
              isEditingAlt
                ? '（この効果を発動するための条件・複数指定可）'
                : block.trigger === 'alt_evolve'
                ? '（代替進化専用の意味: 条件1=発動条件 / 条件2=進化元の絞り込み・複数追加時は3個目以降は無視されます）'
                : FUSION_EVOLVE_TRIGGERS.has(block.trigger)
                ? '（この効果が有効になる条件。素材候補の指定は上の🧬バナー内で行います）'
                : '（このアクションを発動するために満たすべき条件・複数指定可）'
            }
            theme="action"
            defaultSubject=""
            sameAsTargetSubject={targetBaseToCondSubject(effectTarget)}
            attackContextActive={isAttackTrigger}
            showCostMod={effectAction === 'summon' || effectAction === 'evolve' || effectAction === 'destroy'}
            conditionsOp={effectConditionsOp}
            onConditionsOpChange={(op) => updateEffect({ conditionsOp: op })}
          />

        {renderPerCountEditor(isEditingAlt)}
        </details>
        )}

        {/* === 🎁 付与する効果（キーワード付与 / 独自の効果付与） ===
            アクションが grant_keyword(_to) / grant_effect のときだけ自動表示。
            パターン切替でどちらの action コードを使うか（block.action）を直接切り替える。
            block（効果1）専用の設定（AltActionにはkeyword/grantedStepの保存先が無い）のため、
            効果2以降を編集中は非表示にする */}
        {!isEditingAlt && (block.action === 'grant_effect' || block.action === 'grant_keyword' || block.action === 'grant_keyword_to') && (
          <div style={{ padding: 8, border: '1px solid #5eead4', borderRadius: 4, background: '#f0fdfa', marginTop: 8 }}>
            <div style={{ fontWeight: 'bold', fontSize: 12, color: '#0d9488', marginBottom: 6 }}>
              🎁 付与する効果
            </div>
            <div style={{ marginBottom: 8 }}>
              <ButtonGroup
                options={[
                  { code: 'keyword', label: 'キーワードを付与' },
                  { code: 'custom', label: '独自の効果を付与' },
                ]}
                value={block.action === 'grant_effect' ? 'custom' : 'keyword'}
                onChange={(v) => {
                  if (v === 'keyword') {
                    onChange({ ...block, action: 'grant_keyword', grantedStep: undefined });
                  } else {
                    onChange({
                      ...block,
                      action: 'grant_effect',
                      keyword: undefined,
                      grantedStep: block.grantedStep || { trigger: 'on_attack', action: '', conditions: [], options: [] },
                    });
                  }
                }}
                accentColor="#0d9488"
              />
            </div>

            {block.action === 'grant_keyword' || block.action === 'grant_keyword_to' ? (
              <>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                  💡 対象にキーワードを付与する。値・対象・対象数・期間は上の通常のアクション欄で設定してください。
                  選んだキーワードに辞書側でレシピ（効果ステップ）が登録済みの場合、保存時に自動で
                  grant_effect（付与効果）へ変換され、そのレシピ通りに実際に発動します。
                  レシピが空のキーワード（貫通等、エンジンに直接実装済みのもの）は従来通りフラグのみ付与します。
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4 }}>付与するキーワード（複数選択可）</label>
                  <KeywordEntriesEditor block={block} onChange={onChange} dict={dict} accentBorder="#99f6e4" />
                  {getKeywordEntries(block).length > 1 && (
                    <div style={{ fontSize: 10, color: '#0d9488', marginTop: 2 }}>
                      💡 2つ目以降のキーワードは、1つ目で選んだ「対象」欄の指定に応じて、1体選択系の対象なら
                      同じ対象へ自動で付与されます（対象選択は1回だけ）
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                  💡 対象に一時的なトリガー効果を付与する。例: 「【アタック時】相手DP-2000」
                </div>
                {/* 内側トリガー / アクション / 値 / 対象 / 期間 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>付与効果のトリガー</div>
                    <SearchSelect
                      value={grantedStep.trigger}
                      onChange={(v) => updateGrantedStep({ trigger: v })}
                      options={toOpts(dict.triggers)}
                      allowFreeText
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>付与効果のアクション</div>
                    <SearchSelect
                      value={grantedStep.action}
                      onChange={(v) => updateGrantedStep({ action: v })}
                      options={toOpts(dict.actions)}
                      allowFreeText
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
                    <input
                      type="text"
                      value={grantedStep.value === undefined ? '' : String(grantedStep.value)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') updateGrantedStep({ value: undefined });
                        else if (/^\d+$/.test(v)) updateGrantedStep({ value: Number(v) });
                        else updateGrantedStep({ value: v });
                      }}
                      placeholder="例: 2000"
                      style={{ width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                    <SearchSelect
                      value={(grantedStep.target || '').split(':')[0]}
                      onChange={(v) => {
                        const suffix = (grantedStep.target || '').substring((grantedStep.target || '').split(':')[0].length);
                        updateGrantedStep({ target: v + (suffix || '') });
                      }}
                      options={toOpts(TARGETS)}
                      allowFreeText
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象数</div>
                    <SearchSelect
                      value={(grantedStep.target || '').substring((grantedStep.target || '').split(':')[0].length)}
                      onChange={(v) => {
                        const base = (grantedStep.target || '').split(':')[0];
                        updateGrantedStep({ target: base + v });
                      }}
                      options={toOpts(TARGET_COUNTS)}
                      allowFreeText
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>付与効果の期間</div>
                  <SearchSelect
                    value={grantedStep.duration || ''}
                    onChange={(v) => updateGrantedStep({ duration: v })}
                    options={toOpts(DURATIONS)}
                  />
                </div>
                {/* 修飾子（簡易） */}
                {dict.options.length > 0 && (
                  <details style={{ marginBottom: 6 }} open={(grantedStep.options || []).length > 0}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#0d9488', padding: '2px 0' }}>
                      🛡 修飾子{(grantedStep.options || []).length > 0 ? ` (${(grantedStep.options || []).length})` : ''}
                    </summary>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, marginTop: 2, background: '#f0fdfa', borderRadius: 3, border: '1px solid #99f6e4' }}>
                      {dict.options.map((o) => {
                        const arr = grantedStep.options || [];
                        const checked = arr.includes(o.code);
                        return (
                          <label key={o.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '1px 4px', border: checked ? '1px solid #0d9488' : '1px solid #99f6e4', borderRadius: 8, background: checked ? '#ccfbf1' : 'white', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              const next = checked ? arr.filter((x) => x !== o.code) : [...arr, o.code];
                              updateGrantedStep({ options: next });
                            }} style={{ margin: 0 }} />
                            {o.label}
                          </label>
                        );
                      })}
                    </div>
                  </details>
                )}
                {/* 内側条件 */}
                <ConditionsHybridEditor
                  conditions={grantedStep.conditions || []}
                  onChange={(next) => updateGrantedStep({ conditions: next })}
                  dict={dict}
                  title="付与効果の発動条件"
                  hint="（付与された効果が発動するための条件）"
                  theme="action"
                  defaultSubject=""
                  showSubjectSelector={false}
                  attackContextActive={ATTACK_TRIGGER_CODES.includes(grantedStep.trigger)}
                />
              </>
            )}
          </div>
        )}

        </div>
        )}
        {/* === アクショングループここまで === */}
      </div>
    </div>
  );
}

// === ルール step エディタ ===
// ルール = ミニ effect step（action / target / value / conditions）。
// メインの effect step UI を縮小したもの。
interface RuleStepEditorProps {
  index: number;
  step: MiniStep;
  dict: DictAPI;
  onChange: (patch: Partial<MiniStep>) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
  // 親ブロックのトリガーが【アタック時】系か（アタック対象専用のDP条件を出すかの判定に使う）
  isAttackTrigger?: boolean;
}
const RULE_COLOR_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: '赤', label: '赤' }, { value: '青', label: '青' }, { value: '黄', label: '黄' },
  { value: '緑', label: '緑' }, { value: '黒', label: '黒' }, { value: '紫', label: '紫' }, { value: '白', label: '白' },
];
const RULE_TYPE_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: 'デジモン', label: 'デジモン' },
  { value: 'テイマー', label: 'テイマー' },
  { value: 'オプション', label: 'オプション' },
  { value: 'カード', label: '全カード' },
];
// 「対象の条件」の「場所」カテゴリ用: 対象カードがどのエリアにあるかの絞り込み
// （例:「手札の『クロノモン』の記述があるデジモンカード」の「手札」部分）
const RULE_ZONE_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: 'hand', label: '手札' },
  { value: 'trash', label: 'トラッシュ' },
  { value: 'deck', label: 'デッキ' },
  { value: 'security', label: 'セキュリティ' },
  { value: 'battle_area', label: 'バトルエリア' },
  { value: 'breed', label: '育成エリア' },
  { value: 'evo_source', label: '進化元' },
];

// === アクション「位置バリアント」グループ化 ===
// アクションコード末尾が _top / _bottom / _select で、
// 同じ base に2件以上バリアントが存在する場合、エディタ上でグループ化する。
// 例: security_trash_top / security_trash_bottom / security_trash_select
//   → アクションプルダウンには "セキュリティを破棄" 1件のみ表示
//   → 別途「📍 位置」サブプルダウンで上から/下から/選んで を選択
const POSITION_VARIANTS: { suffix: string; label: string }[] = [
  { suffix: '_top',    label: '上' },
  { suffix: '_bottom', label: '下' },
  { suffix: '_select', label: '選んで' },
  // 「全て」も位置・量バリアントの一種として扱う（例: evo_discard_all = 進化元全破棄）
  // value="all" を入れる代わりにこの位置を選べば action コード自体に "_all" が付く
  { suffix: '_all',    label: '全て' },
];
// base コード → 「グループの代表ラベル」のマッピング（自動推測がうまく行かない時の手動指定用）
const POSITION_BASE_LABELS: Record<string, string> = {
  security_trash: 'セキュリティを破棄',
  evo_discard: '進化元を破棄',
  deck_trash: 'デッキを破棄',
};

function getActionVariant(code: string): { base: string; suffix: string } | null {
  if (!code) return null;
  for (const v of POSITION_VARIANTS) {
    if (code.endsWith(v.suffix)) return { base: code.slice(0, -v.suffix.length), suffix: v.suffix };
  }
  return null;
}

// dict.actions を「位置バリアント対応の表示用」に再構成
// ルール:
//   1. dict entry に hasPositionVariant=true フラグがあれば、その entry を base として扱う
//      pulldown には base ラベルだけ表示。代表 value = base コード（保存時に _top suffix が付く）
//      同じ base で suffix 付きの entry (security_trash_top 等) が dict にあれば pulldown から隠す
//   2. フラグなしでも 2件以上の suffix variants が存在する場合は自動グループ化（後方互換）
function buildActionDisplay(actions: DictEntry[]): {
  options: SelectOption[];
  flaggedBases: Set<string>;        // hasPositionVariant=true な base コード集合
  autoGroupBases: Set<string>;      // 自動グループ化された base コード集合
} {
  const allCodes = new Set(actions.map((a) => a.code));
  const flaggedBases = new Set<string>();
  actions.forEach((a) => {
    if (a.hasPositionVariant && !getActionVariant(a.code)) {
      // base コード（suffix無し）+ フラグ
      flaggedBases.add(a.code);
    }
  });

  const autoGroupBases = new Set<string>();
  const variantEntriesByBase = new Map<string, DictEntry[]>();
  actions.forEach((a) => {
    const v = getActionVariant(a.code);
    if (!v) return;
    if (flaggedBases.has(v.base)) return; // base がフラグ付きなら自動グループ化対象外（base 側で表示）
    const otherCount = POSITION_VARIANTS.filter(
      (p) => p.suffix !== v.suffix && allCodes.has(v.base + p.suffix)
    ).length;
    if (otherCount >= 1) {
      autoGroupBases.add(v.base);
      if (!variantEntriesByBase.has(v.base)) variantEntriesByBase.set(v.base, []);
      variantEntriesByBase.get(v.base)!.push(a);
    }
  });

  const options: SelectOption[] = [];
  // フラグ付き base の表示
  flaggedBases.forEach((base) => {
    const entry = actions.find((a) => a.code === base);
    if (!entry) return;
    options.push({ value: base, label: entry.label });
  });
  // 自動グループ化された base の表示
  variantEntriesByBase.forEach((entries, base) => {
    entries.sort((a, b) => {
      const ai = POSITION_VARIANTS.findIndex((v) => a.code.endsWith(v.suffix));
      const bi = POSITION_VARIANTS.findIndex((v) => b.code.endsWith(v.suffix));
      return ai - bi;
    });
    const baseLabel = POSITION_BASE_LABELS[base] || (() => {
      let lbl = entries[0].label;
      ['の上から', 'の下から', 'を選んで', '上から', '下から', '選んで', 'の上', 'の下'].forEach((w) => {
        lbl = lbl.replace(new RegExp(w, 'g'), '');
      });
      return lbl.trim() || entries[0].label;
    })();
    options.push({ value: entries[0].code, label: baseLabel });
  });

  // 残り: 個別表示する entry (フラグ付き base の variant entries は除外)
  actions.forEach((a) => {
    const v = getActionVariant(a.code);
    if (v && flaggedBases.has(v.base)) return;          // フラグ付き base の suffix entry → 隠す
    if (v && autoGroupBases.has(v.base)) return;         // 自動グループ済 → 隠す
    if (flaggedBases.has(a.code)) return;                // 既に追加済
    options.push({ value: a.code, label: a.label });
  });
  return { options, flaggedBases, autoGroupBases };
}

// === 「選んだデジモンと同じ」用の属性選択 ===
// cond_same_as_picked の値はカンマ区切り属性リスト ('name,color' 等)。
// この属性チェックボックス UI で値を編集する。
const SAME_AS_PICKED_FIELDS: { code: string; label: string }[] = [
  { code: 'name',     label: '名前' },
  { code: 'color',    label: '色' },
  { code: 'type',     label: 'タイプ' },
  { code: 'level',    label: 'Lv' },
  { code: 'dp',       label: 'DP' },
  { code: 'playCost', label: 'コスト' },
  { code: 'feature',  label: '特徴' },
  { code: 'cardNo',   label: 'カードNo' },
];

// === 条件のチェックボックス用「よく使う条件」定義 ===
// ConditionsHybridEditor で使用。
// プルダウン側からも cond_xxx で選べるが、こちらはチェックボックス1クリックで追加できる時短UI。
type CommonCondInput = 'select' | 'text' | 'number';
interface CommonCondDef {
  code: string;
  label: string;
  input: CommonCondInput;
  options?: SelectOption[];
}
const COMMON_CONDS: CommonCondDef[] = [
  { code: 'cond_color',            label: '色',           input: 'select', options: RULE_COLOR_OPTS },
  { code: 'cond_type',             label: 'タイプ',       input: 'select', options: RULE_TYPE_OPTS },
  { code: 'cond_lv',               label: 'Lv完全一致',   input: 'number' },
  { code: 'cond_lv_le',            label: 'Lv以下',       input: 'number' },
  { code: 'cond_lv_ge',            label: 'Lv以上',       input: 'number' },
  { code: 'cond_dp',               label: 'DP完全一致',   input: 'number' },
  { code: 'cond_dp_le',            label: 'DP以下',       input: 'number' },
  { code: 'cond_dp_ge',            label: 'DP以上',       input: 'number' },
  { code: 'cond_cost',             label: 'コスト完全一致', input: 'number' },
  { code: 'cond_cost_le',          label: 'コスト以下',   input: 'number' },
  { code: 'cond_cost_ge',          label: 'コスト以上',   input: 'number' },
  { code: 'cond_memory_le',        label: 'メモリー以下', input: 'number' },
  { code: 'cond_memory_ge',        label: 'メモリー以上', input: 'number' },
  { code: 'cond_feature_contains', label: '特徴を含む',   input: 'text' },
  { code: 'cond_name',             label: '名前（完全一致）', input: 'text' },
  { code: 'cond_name_contains',    label: '名前を含む',   input: 'text' },
  // 「記述」= カード上のどこか（名前/特徴/効果テキスト/進化元テキスト/セキュリティテキスト）に
  // 指定文字列があるか（公式ルールの「「XXX」の記述がある」表記に対応。名前限定の
  // cond_name(_contains) とは別物）
  { code: 'cond_description',          label: '記述（完全一致）', input: 'text' },
  { code: 'cond_description_contains', label: '記述に含む',   input: 'text' },
  // 対象カードの所在エリア（例:「手札の」「デッキの」）。対象の条件（対象フィルタ）専用。
  // 発動条件/トリガー条件の文脈ではエンジンが評価対象を特定できないため意味を持たない
  { code: 'cond_zone',                 label: '場所',         input: 'select', options: RULE_ZONE_OPTS },
];
function RuleStepEditor({ index, step, dict, onChange, onRemove, onUp, onDown, isAttackTrigger }: RuleStepEditorProps) {
  // 「条件ごとに枚数を分ける」がONか（1つのルール内に条件+枚数の組を複数持つモード）
  const hasDesignatedGroups = Array.isArray(step.designatedGroups) && step.designatedGroups.length > 0;

  // 値フィールドの記述モード state（ボタンで1/2/3/全てを選ぶ or 記述で自由入力）
  const valueRaw = step.value;
  const valueStr = valueRaw === undefined || valueRaw === null ? '' : String(valueRaw);
  const isPresetValue = ['', '1', '2', '3', 'all'].includes(valueStr);
  const [customMode, setCustomMode] = useState<boolean>(!isPresetValue && valueRaw !== undefined);
  // 「その他のアクション」開閉状態（手札に加える/破棄/〇〇に置く 以外を選んでいるときは自動で開く）
  const [ruleOtherOpen, setRuleOtherOpen] = useState(false);
  // 「条件ごとに枚数を分ける」の「共通の絞り込み条件」欄を非表示にするか
  // （使わないケースの方が多いため、チェックを入れると欄自体を隠せる。表示状態のみの
  // ローカルUI設定で、保存データには影響しない＝空のcommonConditionsのままでOK）
  const [commonCondHidden, setCommonCondHidden] = useState(false);

  return (
    <div style={{ marginBottom: 6, padding: 8, background: 'white', border: '1px solid #c5d4ea', borderRadius: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 'bold', fontSize: 12, color: '#1976d2' }}>ルール {index + 1}</span>
        <span style={{ display: 'flex', gap: 2 }}>
          {onUp && <button onClick={onUp} style={miniBtn()}>↑</button>}
          {onDown && <button onClick={onDown} style={miniBtn()}>↓</button>}
          <button onClick={onRemove} style={{ ...miniBtn(), borderColor: '#d33', color: '#d33' }}>✕ 削除</button>
        </span>
      </div>

      {/* アクションは常に表示・必須。位置指定フラグ付きアクション選択時は 📍 位置 pulldown も出現 */}
      {(() => {
        const { options: ruleActionOptions, flaggedBases: ruleFlaggedBases, autoGroupBases: ruleAutoGroupBases } = buildActionDisplay(dict.actions);
        const ruleCurVariant = getActionVariant(step.action || '');
        const ruleIsFlaggedBaseDirect = ruleFlaggedBases.has(step.action || '');
        const ruleIsVariantOfFlagged = !!(ruleCurVariant && (ruleFlaggedBases.has(ruleCurVariant.base) || ruleAutoGroupBases.has(ruleCurVariant.base)));
        const ruleIsPositional = ruleIsFlaggedBaseDirect || ruleIsVariantOfFlagged;

        const ruleNormalizedActionValue = (() => {
          if (ruleIsFlaggedBaseDirect) return step.action || '';
          if (ruleCurVariant && ruleFlaggedBases.has(ruleCurVariant.base)) return ruleCurVariant.base;
          if (ruleCurVariant && ruleAutoGroupBases.has(ruleCurVariant.base)) return ruleCurVariant.base + '_top';
          return step.action || '';
        })();

        const ruleVariantOptions: SelectOption[] = (() => {
          if (!ruleIsPositional) return [];
          if (ruleIsFlaggedBaseDirect || (ruleCurVariant && ruleFlaggedBases.has(ruleCurVariant.base))) {
            return POSITION_VARIANTS.map((v) => ({ value: v.suffix, label: v.label }));
          }
          if (ruleCurVariant && ruleAutoGroupBases.has(ruleCurVariant.base)) {
            return POSITION_VARIANTS
              .filter((v) => dict.actions.some((a) => a.code === ruleCurVariant.base + v.suffix))
              .map((v) => ({ value: v.suffix, label: v.label }));
          }
          return [];
        })();
        const ruleCurrentSuffix = ruleCurVariant ? ruleCurVariant.suffix : '';

        function onRuleActionChange(newCode: string) {
          const newIsFlaggedBase = ruleFlaggedBases.has(newCode);
          const newV = getActionVariant(newCode);
          const cur = step.action || '';
          const curV = getActionVariant(cur);
          const newBase = newIsFlaggedBase ? newCode : (newV ? newV.base : null);
          const curBase = curV ? curV.base : (ruleFlaggedBases.has(cur) ? cur : null);
          if (newBase && curBase && newBase === curBase) return;
          if (newIsFlaggedBase) {
            onChange({ action: newCode + '_top' });
            return;
          }
          onChange({ action: newCode });
        }
        function onRuleVariantChange(newSuffix: string) {
          if (!newSuffix) return;
          const base = ruleIsFlaggedBaseDirect ? (step.action || '') : (ruleCurVariant ? ruleCurVariant.base : '');
          if (!base) return;
          onChange({ action: base + newSuffix });
        }

        // よく使うアクション: 手札に加える / 破棄 / 〇〇に置く（PLACE_ZONE_MAP、コスト側
        // 「〇〇に置く」と全く同じセキュリティ/テイマー/進化元/バトルエリアの4択）。
        // これら以外は「その他のアクション」から選ぶ
        const isRulePlaceActive = PLACE_ACTION_CODES.has(step.action || '');
        const activeRulePlaceZone = PLACE_ZONE_MAP.find((z) => z.action === step.action)?.code || '';
        const isRuleCommonAction = step.action === 'add_to_hand' || step.action === 'discard' || step.action === 'return_deck' || isRulePlaceActive;

        return (
          <>
          {hasDesignatedGroups && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#666', marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={step.groupsShareAction !== true}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({ groupsShareAction: undefined });
                  } else {
                    // 共通化: 各グループの個別アクション指定は不要になるため破棄する
                    const clearedGroups = (step.designatedGroups || []).map((g) => ({ ...g, action: undefined, deckPosition: undefined, options: undefined }));
                    onChange({ groupsShareAction: true, designatedGroups: clearedGroups });
                  }
                }}
              />
              グループごとに異なる（このアクション欄を隠し、下の各グループのアクション欄を使う）
            </label>
          )}
          {(!hasDesignatedGroups || step.groupsShareAction === true) && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 2 }}>
              <div style={miniLbl()}>アクション *</div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none', color: '#666' }}>
                <input
                  type="checkbox"
                  checked={!!step.isRemaining}
                  onChange={(e) => onChange({ isRemaining: e.target.checked || undefined })}
                  style={{ margin: 0 }}
                />
                残ったカード
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{ code: 'add_to_hand', label: '手札に加える' }, { code: 'discard', label: '破棄' }].map((a) => {
                const active = step.action === a.code;
                return (
                  <button
                    key={a.code}
                    type="button"
                    onClick={() => onChange({ action: a.code })}
                    style={{
                      padding: '3px 9px', borderRadius: 5,
                      border: active ? '2px solid #1976d2' : '1px solid #bbb',
                      background: active ? '#1976d2' : '#f5f5f5',
                      color: active ? '#fff' : '#333',
                      fontWeight: active ? 'bold' : 'normal',
                      cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    {a.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  if (isRulePlaceActive) return;
                  const z = PLACE_ZONE_MAP.find((zz) => zz.code === 'security')!;
                  onChange({ action: z.action, target: z.target || step.target });
                }}
                style={{
                  padding: '3px 9px', borderRadius: 5,
                  border: isRulePlaceActive ? '2px solid #1976d2' : '1px solid #bbb',
                  background: isRulePlaceActive ? '#1976d2' : '#f5f5f5',
                  color: isRulePlaceActive ? '#fff' : '#333',
                  fontWeight: isRulePlaceActive ? 'bold' : 'normal',
                  cursor: 'pointer', fontSize: 11,
                }}
              >
                〇〇に置く
              </button>
              <button
                type="button"
                onClick={() => onChange({ action: 'return_deck' })}
                style={{
                  padding: '3px 9px', borderRadius: 5,
                  border: step.action === 'return_deck' ? '2px solid #1976d2' : '1px solid #bbb',
                  background: step.action === 'return_deck' ? '#1976d2' : '#f5f5f5',
                  color: step.action === 'return_deck' ? '#fff' : '#333',
                  fontWeight: step.action === 'return_deck' ? 'bold' : 'normal',
                  cursor: 'pointer', fontSize: 11,
                }}
              >
                デッキに戻す
              </button>
            </div>
            {step.action === 'return_deck' && (
              <div style={{ marginTop: 4 }}>
                <div style={miniLbl()}>📍 位置</div>
                <ButtonGroup
                  options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '上か下' }]}
                  value={step.deckPosition || ''}
                  onChange={(v) => onChange({ deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                  accentColor="#1976d2"
                />
              </div>
            )}
            {isRulePlaceActive && (
              <div style={{ marginTop: 4 }}>
                <div style={miniLbl()}>📥 場所（どこに置くか）</div>
                <ButtonGroup
                  options={PLACE_ZONE_MAP.map((z) => ({ code: z.code, label: z.label }))}
                  value={activeRulePlaceZone}
                  onChange={(zoneCode) => {
                    if (zoneCode === activeRulePlaceZone) return;
                    const z = PLACE_ZONE_MAP.find((zz) => zz.code === zoneCode);
                    if (!z) return;
                    onChange({ action: z.action, target: z.target || '' });
                  }}
                  accentColor="#1976d2"
                />
                {(() => {
                  const z = PLACE_ZONE_MAP.find((zz) => zz.code === activeRulePlaceZone);
                  return z?.warn ? <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{z.warn}</div> : null;
                })()}
                {(() => {
                  const z = PLACE_ZONE_MAP.find((zz) => zz.code === activeRulePlaceZone);
                  if (!z?.hasPosition) return null;
                  return (
                    <div style={{ marginTop: 4 }}>
                      <div style={miniLbl()}>📍 位置</div>
                      <ButtonGroup
                        options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '下か上' }]}
                        value={step.deckPosition || ''}
                        onChange={(v) => onChange({ deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                        accentColor="#1976d2"
                      />
                    </div>
                  );
                })()}
                {(() => {
                  const z = PLACE_ZONE_MAP.find((zz) => zz.code === activeRulePlaceZone);
                  if (!z?.hasFace) return null;
                  return (
                    <div style={{ marginTop: 4 }}>
                      <div style={miniLbl()}>🂠 裏表</div>
                      <ButtonGroup
                        options={[{ code: '', label: '表向き' }, { code: 'face_down', label: '裏向き' }]}
                        value={(step.options || []).includes('face_down') ? 'face_down' : ''}
                        onChange={(v) => onChange({ options: v ? [v] : [] })}
                        accentColor="#1976d2"
                      />
                    </div>
                  );
                })()}
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#666', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={ruleOtherOpen || (!!step.action && !isRuleCommonAction)}
                onChange={(e) => setRuleOtherOpen(e.target.checked)}
              />
              その他のアクション
            </label>
            {(ruleOtherOpen || (!!step.action && !isRuleCommonAction)) && (
              <div style={{ marginTop: 4 }}>
                <SearchSelect
                  value={ruleNormalizedActionValue}
                  onChange={onRuleActionChange}
                  options={ruleActionOptions}
                  allowFreeText
                  placeholder="例: 手札に加える"
                />
                {ruleIsPositional && ruleVariantOptions.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={miniLbl()}>📍 位置</div>
                    <SearchSelect
                      value={ruleCurrentSuffix}
                      onChange={onRuleVariantChange}
                      options={ruleVariantOptions}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          )}
          </>
        );
      })()}

      {/* 値（枚数）: ボタンで1/2/3/全てを選択。「条件ごとに枚数を分ける」ON時は
          グループごとの枚数で代替されるため非表示 */}
      {!hasDesignatedGroups && (
        <div style={{ marginBottom: 8 }}>
          <div style={miniLbl()}>値（枚数）</div>
          {!customMode ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <ButtonGroup
                options={[{ code: '', label: '（未指定）' }, { code: '1', label: '1' }, { code: '2', label: '2' }, { code: '3', label: '3' }, { code: 'all', label: '全て' }]}
                value={isPresetValue ? valueStr : ''}
                onChange={(v) => {
                  if (!v) onChange({ value: '' });
                  else if (v === 'all') onChange({ value: 'all' });
                  else onChange({ value: Number(v) });
                }}
                accentColor="#1976d2"
              />
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                style={{ padding: '3px 9px', border: '1px dashed #1976d2', color: '#1976d2', background: 'white', borderRadius: 5, cursor: 'pointer', fontSize: 11 }}
              >
                記述で入力
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 2 }}>
              <input
                type="text"
                value={valueStr}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') onChange({ value: '' });
                  else if (/^\d+$/.test(v)) onChange({ value: Number(v) });
                  else onChange({ value: v });
                }}
                placeholder="例: deck_choice / 1000"
                autoFocus
                style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, minWidth: 0, maxWidth: 220 }}
              />
              <button
                onClick={() => { setCustomMode(false); onChange({ value: '' }); }}
                title="ボタン選択に戻す（値はクリア）"
                style={{ padding: '0 6px', border: '1px solid #888', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}
              >
                ↺
              </button>
            </div>
          )}
        </div>
      )}

      {/* === ルール条件: トリガー条件 / 発動条件と同じハイブリッドUI ===
          「条件ごとに枚数を分ける」がOFFのときだけ表示（ONのときは下の対象グループ内で
          グループごとに条件を持つため、こちらは使わない） */}
      {!hasDesignatedGroups && (
        <div style={{ marginTop: 8 }}>
          <ConditionsHybridEditor
            conditions={step.conditions || []}
            onChange={(next) => onChange({ conditions: next })}
            dict={dict}
            title="ルール条件"
            hint="（このルールが発動する条件・cond_picked_color 等で直前選択を参照可・複数 AND）"
            theme="action"
            defaultSubject=""
            showSubjectSelector={false}
            attackContextActive={!!isAttackTrigger}
          />
        </div>
      )}

      {/* === 条件ごとに枚数を分ける（designatedGroups）===
          例:「特徴TBを持つカード1枚と、緑のカード1枚」のように、1つのルールの中で
          複数の(条件+枚数)を指定したい場合に使う。ONにすると上の「ルール条件」/「値」の
          代わりにこちらのグループ一覧を使う（grant_keyword等の対象グループと同じ仕組み） */}
      <div style={{ marginTop: 8, padding: 6, background: '#fdf6ec', border: '1px solid #f0d9a8', borderRadius: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, fontWeight: 'bold', color: '#946200' }}>
          <input
            type="checkbox"
            checked={hasDesignatedGroups}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({
                  designatedGroups: [
                    { conditions: step.conditions || [], conditionsOp: 'and', count: step.value },
                    { conditions: [], conditionsOp: 'and' },
                  ],
                });
              } else {
                onChange({ designatedGroups: undefined, commonConditions: undefined, commonConditionsOp: undefined });
              }
            }}
          />
          条件ごとに枚数を分ける（例:「特徴TBを持つカード1枚と、緑のカード1枚」）
        </label>
        {hasDesignatedGroups && (() => {
          const groupList: RuleGroup[] = (step.designatedGroups && step.designatedGroups.length > 0)
            ? step.designatedGroups
            : [{ conditions: [], conditionsOp: 'and' }];
          const setGroups = (next: RuleGroup[]) => onChange({ designatedGroups: next });
          const updateGroup = (gi: number, patch: Partial<RuleGroup>) => {
            const next = groupList.slice();
            next[gi] = { ...next[gi], ...patch };
            setGroups(next);
          };
          const removeGroup = (gi: number) => {
            setGroups(groupList.length <= 1 ? [{ conditions: [], conditionsOp: 'and' }] : groupList.filter((_, idx) => idx !== gi));
          };
          const addGroup = () => setGroups([...groupList, { conditions: [], conditionsOp: 'and' }]);
          const groupsOp = step.groupsOp || 'and';
          const isOrGroups = groupsOp === 'or' && groupList.length > 1;
          const groupsShareAction = step.groupsShareAction;
          return (
            <div style={{ marginTop: 6 }}>
              {groupList.length > 1 && (
                <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #f0d9a8' }}>
                  <div style={{ fontSize: 11, fontWeight: 'bold', color: '#666', marginBottom: 4 }}>グループの結合方法</div>
                  <ButtonGroup
                    options={[
                      { code: 'and', label: 'それぞれ別に（AND・加算）' },
                      { code: 'or', label: 'どちらかを満たす（OR）' },
                    ]}
                    value={groupsOp}
                    onChange={(v) => onChange({ groupsOp: (v || 'and') as 'and' | 'or' })}
                    accentColor="#946200"
                  />
                  {isOrGroups && (
                    <div style={{ fontSize: 10, color: '#946200', marginTop: 4 }}>
                      OR時は下の「枚数」は先頭グループの入力欄のみ使われます。
                      <span style={{ color: '#c62828' }}>⚠ エンジン未実装（保存はできますが動作しません）</span>
                    </div>
                  )}
                </div>
              )}
              {groupList.length > 1 && (
                <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #f0d9a8' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#666' }}>
                    <input
                      type="checkbox"
                      checked={commonCondHidden}
                      onChange={(e) => {
                        setCommonCondHidden(e.target.checked);
                        // 隠すときは古い共通条件が見えないまま残って効いてしまわないよう破棄する
                        if (e.target.checked) onChange({ commonConditions: undefined, commonConditionsOp: undefined });
                      }}
                    />
                    共通条件なし（各グループの条件が全て異なる場合はチェックして欄を隠せます）
                  </label>
                  {!commonCondHidden && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#666', marginBottom: 2 }}>
                        共通の絞り込み条件（全グループに自動でAND合成される）
                      </div>
                      <ConditionsHybridEditor
                        conditions={step.commonConditions || []}
                        onChange={(next) => onChange({ commonConditions: next })}
                        dict={dict}
                        title="共通条件"
                        hint="（例:「特徴TB」を各グループで繰り返し書かなくて済むように、ここに1回だけ設定する）"
                        theme="action"
                        defaultSubject=""
                        showSubjectSelector={false}
                        conditionsOp={step.commonConditionsOp || 'and'}
                        onConditionsOpChange={(op) => onChange({ commonConditionsOp: op })}
                      />
                    </div>
                  )}
                </div>
              )}
              {groupList.map((g, gi) => (
                <div key={gi} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: gi < groupList.length - 1 ? '1px dashed #f0d9a8' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: '#666' }}>
                      グループ{groupList.length > 1 ? `（${gi + 1}）` : ''}
                    </span>
                    {groupList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeGroup(gi)}
                        style={{ marginLeft: 'auto', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontSize: 11 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {/* グループごとのアクション（省略時はルール本体のアクションを使う）。
                      例:「1枚を手札に加え、1枚をセキュリティの上に置く」を2グループで表現。
                      「共通」（groupsShareAction===true）のときは全グループとも上の
                      ルール本体のアクションを使うため、個別のアクション欄は隠す */}
                  {groupsShareAction !== true && (() => {
                    const gAction = g.action || step.action;
                    const gIsPlaceActive = PLACE_ACTION_CODES.has(gAction || '');
                    const gActivePlaceZone = PLACE_ZONE_MAP.find((z) => z.action === gAction)?.code || '';
                    const gIsCommon = gAction === 'add_to_hand' || gAction === 'discard' || gAction === 'return_deck' || gIsPlaceActive;
                    return (
                      <div style={{ marginBottom: 6 }}>
                        <div style={miniLbl()}>アクション（省略時はルール本体と同じ）</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {[{ code: 'add_to_hand', label: '手札に加える' }, { code: 'discard', label: '破棄' }].map((a) => {
                            const active = (g.action || step.action) === a.code;
                            return (
                              <button
                                key={a.code}
                                type="button"
                                onClick={() => updateGroup(gi, { action: a.code })}
                                style={{
                                  padding: '2px 8px', borderRadius: 5,
                                  border: active ? '2px solid #946200' : '1px solid #bbb',
                                  background: active ? '#946200' : '#f5f5f5',
                                  color: active ? '#fff' : '#333',
                                  fontWeight: active ? 'bold' : 'normal',
                                  cursor: 'pointer', fontSize: 11,
                                }}
                              >
                                {a.label}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => {
                              if (gIsPlaceActive) return;
                              const z = PLACE_ZONE_MAP.find((zz) => zz.code === 'security')!;
                              updateGroup(gi, { action: z.action });
                            }}
                            style={{
                              padding: '2px 8px', borderRadius: 5,
                              border: gIsPlaceActive ? '2px solid #946200' : '1px solid #bbb',
                              background: gIsPlaceActive ? '#946200' : '#f5f5f5',
                              color: gIsPlaceActive ? '#fff' : '#333',
                              fontWeight: gIsPlaceActive ? 'bold' : 'normal',
                              cursor: 'pointer', fontSize: 11,
                            }}
                          >
                            〇〇に置く
                          </button>
                          <button
                            type="button"
                            onClick={() => updateGroup(gi, { action: 'return_deck' })}
                            style={{
                              padding: '2px 8px', borderRadius: 5,
                              border: gAction === 'return_deck' ? '2px solid #946200' : '1px solid #bbb',
                              background: gAction === 'return_deck' ? '#946200' : '#f5f5f5',
                              color: gAction === 'return_deck' ? '#fff' : '#333',
                              fontWeight: gAction === 'return_deck' ? 'bold' : 'normal',
                              cursor: 'pointer', fontSize: 11,
                            }}
                          >
                            デッキに戻す
                          </button>
                        </div>
                        {gAction === 'return_deck' && (
                          <div style={{ marginTop: 4 }}>
                            <div style={miniLbl()}>📍 位置</div>
                            <ButtonGroup
                              options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '上か下' }]}
                              value={g.deckPosition || ''}
                              onChange={(v) => updateGroup(gi, { deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                              accentColor="#946200"
                            />
                          </div>
                        )}
                        {gIsPlaceActive && (
                          <div style={{ marginTop: 4 }}>
                            <ButtonGroup
                              options={PLACE_ZONE_MAP.map((z) => ({ code: z.code, label: z.label }))}
                              value={gActivePlaceZone}
                              onChange={(zoneCode) => {
                                if (zoneCode === gActivePlaceZone) return;
                                const z = PLACE_ZONE_MAP.find((zz) => zz.code === zoneCode);
                                if (!z) return;
                                updateGroup(gi, { action: z.action });
                              }}
                              accentColor="#946200"
                            />
                            {(() => {
                              const z = PLACE_ZONE_MAP.find((zz) => zz.code === gActivePlaceZone);
                              return z?.warn ? <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{z.warn}</div> : null;
                            })()}
                            {(() => {
                              const z = PLACE_ZONE_MAP.find((zz) => zz.code === gActivePlaceZone);
                              if (!z?.hasPosition) return null;
                              return (
                                <div style={{ marginTop: 4 }}>
                                  <div style={miniLbl()}>📍 位置</div>
                                  <ButtonGroup
                                    options={[{ code: 'top', label: '上' }, { code: 'bottom', label: '下' }, { code: 'both', label: '下か上' }]}
                                    value={g.deckPosition || ''}
                                    onChange={(v) => updateGroup(gi, { deckPosition: (v || undefined) as 'top' | 'bottom' | 'both' | undefined })}
                                    accentColor="#946200"
                                  />
                                </div>
                              );
                            })()}
                            {(() => {
                              const z = PLACE_ZONE_MAP.find((zz) => zz.code === gActivePlaceZone);
                              if (!z?.hasFace) return null;
                              return (
                                <div style={{ marginTop: 4 }}>
                                  <div style={miniLbl()}>🂠 裏表</div>
                                  <ButtonGroup
                                    options={[{ code: '', label: '表向き' }, { code: 'face_down', label: '裏向き' }]}
                                    value={(g.options || []).includes('face_down') ? 'face_down' : ''}
                                    onChange={(v) => updateGroup(gi, { options: v ? [v] : [] })}
                                    accentColor="#946200"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {!gIsCommon && (
                          <div style={{ marginTop: 4 }}>
                            <SearchSelect
                              value={gAction}
                              onChange={(v) => updateGroup(gi, { action: v })}
                              options={toOpts(dict.actions)}
                              allowFreeText
                              placeholder="その他のアクション"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <ConditionsHybridEditor
                    conditions={g.conditions || []}
                    onChange={(next) => updateGroup(gi, { conditions: next })}
                    dict={dict}
                    title="条件"
                    hint="（このグループの絞り込み条件・複数指定可）"
                    theme="action"
                    defaultSubject=""
                    showSubjectSelector={false}
                    conditionsOp={g.conditionsOp || 'and'}
                    onConditionsOpChange={(op) => updateGroup(gi, { conditionsOp: op })}
                    allowDistinctVariants
                  />
                  {/* AND時: 各グループが自分の枚数を持つ（加算されるので各グループ末尾に表示） */}
                  {!isOrGroups && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>枚数（省略時は1枚）</label>
                    <input
                      type="number"
                      min={1}
                      value={g.count === undefined ? '' : String(g.count)}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateGroup(gi, { count: v === '' ? undefined : Number(v) });
                      }}
                      placeholder="例: 1"
                      style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 80 }}
                    />
                  </div>
                  )}
                </div>
              ))}
              {/* OR時: 全グループ共有の枚数欄を1つだけ、グループ一覧の一番最後（「＋グループを追加」の直前）に表示する。
                  データはグループ1のcountに保存する（ruleTranslator.tsのfirst?.countと対応） */}
              {isOrGroups && (
                <div style={{ marginTop: 6, marginBottom: 6 }}>
                  <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>枚数（OR全体の合計・省略時は1枚）</label>
                  <input
                    type="number"
                    min={1}
                    value={groupList[0]?.count === undefined ? '' : String(groupList[0].count)}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateGroup(0, { count: v === '' ? undefined : Number(v) });
                    }}
                    placeholder="例: 1"
                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 80 }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={addGroup}
                style={{ padding: '3px 9px', border: '1px dashed #f0d9a8', background: 'white', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
              >
                ＋ グループを追加（別の条件＋枚数を追加）
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// === ハイブリッド条件エディタ ===
// チェックボックス（よく使う条件・hardcoded）+ プルダウン（その他の条件・dict 由来）の併用。
// トリガー条件 / 発動条件 の両方で使う。
interface ConditionsHybridEditorProps {
  conditions: ConditionPair[];
  onChange: (next: ConditionPair[]) => void;
  dict: DictAPI;
  title: string;
  hint: string;
  theme: 'trigger' | 'action';
  defaultSubject?: string;  // チェックボックス追加時の既定 subject（'' or 'self' 等）
  showSubjectSelector?: boolean; // 主体プルダウンを各行に出すか
  // 「対象と同じ」チェックボックス用: アクションの対象から変換した条件対象コード（targetBaseToCondSubject）。
  // 指定時のみチェックボックスを表示し、ONにすると各行のsubjectをこの値に固定してプルダウンをグレーアウトする
  sameAsTargetSubject?: string;
  // true のとき cond_type 等を複数選択(カンマ区切り値)で入力可能にする。
  // step.filter (ターゲットフィルタ) は type_in 配列を受け付けるためOK判定できるが、
  // trigger_conditions/発動条件側の cond_type は単一値exact-matchのみ対応のため、
  // それらの用途では誤動作を避けるため false のままにすること。
  supportsMultiValue?: boolean;
  // true のとき、DPの「最も高い/最も低い（アタック対象専用）」バリアントを選べるようにする。
  // これはbs._lastAttackTargetを見る条件で、【アタック時】【アタック終了時】以外では意味を成さない
  attackContextActive?: boolean;
  // 'full'(既定) = よく使う条件ボタン+詳細パネルを1つの枠にまとめて表示（従来通り）。
  // 'buttons' / 'panels' = ボタン列と詳細パネルを別々の場所（例: 対象ボックスと対象数ボックス）
  // に分けて配置したいときに使う。この場合、otherOpen状態を呼び出し側で共有する必要がある
  part?: 'full' | 'buttons' | 'panels';
  otherOpen?: boolean;
  onOtherOpenChange?: (v: boolean) => void;
  // true のときのみ「コスト増減」カテゴリを表示する。アクションが登場/進化/消滅のときだけ
  // 意味を持つ（コストしきい値そのものを+/-する機能のため）。既定は非表示
  showCostMod?: boolean;
  // true のとき「タイプ」カテゴリを対象の条件（supportsMultiValue）でも表示する。
  // 通常は対象ボタン側（自分→デジモン/テイマー等）で種別が既に決まるため重複を避けて隠すが、
  // 進化/登場アクション（対象=このカード）のように対象ボタンが取得元カードの種別を
  // 決めていないケースでは、「クロノモンの記述がある【何の】カードか」を明示するために必要
  showTypeInTargetFilter?: boolean;
  // 複数条件の結合方法をAND/ORで選べるようにする（未指定時は常にAND・従来通りの固定表記）。
  // 呼び出し元が保持するデータ（block.conditionsOp / cost.conditionsOp 等）と結び付けるため
  // 両方セットで渡す。現状は発動条件・コスト対象の絞り込みでのみ有効化している
  conditionsOp?: 'and' | 'or';
  onConditionsOpChange?: (op: 'and' | 'or') => void;
  // true のとき、名前/Lv/記述/色カテゴリのバリアントボタンに「異なる」を追加する。
  // 「異なる」は単体カードの判定ではなく、複数枚選ぶ際に選んだカード同士がその属性で
  // 異なる必要があるという集合レベルの制約（例:「名称の異なるカードN枚」）を表す
  // プレースホルダーのため、意味を持つ「対象」（DesignatedGroup）欄でのみ有効にすること
  allowDistinctVariants?: boolean;
}
// 「異なる」バリアント（名前/Lv/記述/色）。値は不要で、あくまで複数枚選択時の
// 「互いにこの属性が異なる」という制約を表すプレースホルダー
const DISTINCT_VARIANT_BY_CATEGORY: Partial<Record<CondCategory, { value: string; label: string }>> = {
  name: { value: 'cond_name_distinct', label: '異なる' },
  lv: { value: 'cond_lv_distinct', label: '異なる' },
  description: { value: 'cond_description_distinct', label: '異なる' },
  color: { value: 'cond_color_distinct', label: '異なる' },
};
// DP以下/以上（cond_dp_le/cond_dp_ge）の「参照」機能: 固定値の代わりに、
// このデジモン/自分/相手/他のデジモンの"現在のDP"と動的に比較したい場合に使う
// （例:「このデジモンのDP以下の相手のデジモン」）。値は 'self'/'own'/'opp'/'other' の
// マーカー文字列として保存する（数値と混同しない特別な値。エンジン側の動的参照評価は
// 未実装のため、保存はできるが現状は動作しない）
const DP_REF_SUBJECTS: { code: string; label: string }[] = [
  { code: 'self', label: 'このデジモン' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'other', label: '他' },
];
const DP_REF_CODES = new Set(DP_REF_SUBJECTS.map((s) => s.code));

// 値入力が不要な条件（チェック的な意味だけを持つ cond_xxx）。UIでプレースホルダを変える程度に使用
const NO_VALUE_CONDS = new Set([
  'cond_attack_target_player', 'cond_attack_target_digimon', 'cond_no_evo',
  'cond_jogress', 'cond_in_battle', 'cond_during_own_turn', 'cond_during_opp_turn',
  'cond_during_any_turn', 'cond_self_active', 'cond_self_rest', 'cond_opp_no_attack_this_turn',
  'cond_evolved_this_turn', 'cond_no_tamer_evo', 'cond_not_own_effect', 'cond_has_evo_digimon',
  'cond_attack_target_highest_dp', 'cond_attack_target_lowest_dp',
  'cond_dp_highest', 'cond_dp_lowest',
  'cond_face_down', 'cond_face_up', 'cond_designated_name',
  'cond_name_distinct', 'cond_lv_distinct', 'cond_description_distinct', 'cond_color_distinct',
  'cond_target_stack',
]);

// === 条件の「種別」を大分類(カテゴリ)+詳細(バリアント)の2段構成にする ===
// 色/タイプ/特徴/場所は 1カテゴリ=1コードの直接対応。
// Lv/DP/名前は複数コードがあるため、カテゴリ選択後に「以上/以下」等の
// バリアントプルダウンが追加で現れる。その他はカテゴリに無い全条件を選べる逃し弁。
type CondCategory = 'color' | 'type' | 'feature' | 'lv' | 'dp' | 'cost' | 'cost_mod' | 'memory' | 'name' | 'description' | 'zone' | 'ref' | 'designated' | 'stacked' | 'other' | '';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'color', label: '色' },
  { value: 'type', label: 'タイプ' },
  { value: 'feature', label: '特徴' },
  { value: 'lv', label: 'Lv' },
  { value: 'dp', label: 'DP' },
  { value: 'cost', label: 'コスト' },
  { value: 'cost_mod', label: 'コスト増減' },
  { value: 'memory', label: 'メモリー' },
  { value: 'name', label: '名前' },
  { value: 'description', label: '記述' },
  { value: 'zone', label: '場所' },
  { value: 'ref', label: '参照' },
  { value: 'designated', label: '指定' },
  // 重ねられているカード = 対象デジモンの進化元＋一番上のカード（本体）全てを対象に含める
  // という「対象の条件」。値不要のマーカー条件（cond_target_stack）。エンジン未実装
  { value: 'stacked', label: '重ねられているカード' },
  { value: 'other', label: 'その他' },
];
// 「指定」: キーワードの「対象」欄で組み立てた絞り込み条件一式を参照するプレースホルダー
// (cond_designated_name)。キーワードのレシピテンプレート内でのみ意味を持ち、そのキーワードを
// 実際のカードで選んだ際に、この条件を含むstepの条件一式が「対象」欄の内容で丸ごと
// 置き換えられる（保存時にblocksToRecipe側で実施）
const DESIGNATED_NAME_COND = 'cond_designated_name';

// 「効果で」(cond_effect、辞書の「その他条件」で選択): 「以外」はvalue:'not'、
// 自分/相手/互いはsubjectで表現する（別コードを増やさない）。専用のカテゴリボタンは
// 設けず、「その他条件」でこの条件を選んだ行にだけ専用UIを重ねて表示する。
// 旧cond_own_effect/cond_not_own_effect（自分固定・別コード）も同様に扱い、
// 操作すると cond_effect + value/subject の形に正規化される
function isByEffectCond(base: string): boolean {
  return base === 'cond_effect' || base === 'cond_own_effect' || base === 'cond_not_own_effect';
}
const BY_EFFECT_SUBJECT_OPTIONS: { code: string; label: string }[] = [
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'both', label: '互い' },
];
function byEffectIsNot(c: ConditionPair): boolean {
  return c.base === 'cond_not_own_effect' || (c.base === 'cond_effect' && c.value === 'not');
}
function byEffectSubject(c: ConditionPair): string {
  if (c.base === 'cond_own_effect' || c.base === 'cond_not_own_effect') return 'own';
  return c.subject || 'own';
}

// 「参照」: 手札/トラッシュ/セキュリティ/進化元(テイマーの下含む)/バトルエリアの枚数・
// 裏表状態を条件にする（例:「手札が6枚以上」「進化元が裏向き」）。
// ゾーン×以上/以下/完全一致の3軸をコードの組合せで表現するため、専用の相互変換テーブルを持つ
const REF_ZONE_OPTIONS: { code: string; label: string }[] = [
  { code: 'hand', label: '手札' },
  { code: 'trash', label: 'トラッシュ' },
  { code: 'security', label: 'セキュリティ' },
  { code: 'evo_source', label: '進化元／テイマーの下' },
  { code: 'battle_area', label: 'バトルエリア' },
];
const REF_ZONE_QUANT_TO_CODE: Record<string, string> = {
  'hand:ge': 'cond_hand_ge', 'hand:le': 'cond_hand_le', 'hand:eq': 'cond_hand_eq', 'hand:gt': 'cond_hand_gt', 'hand:lt': 'cond_hand_lt',
  'trash:ge': 'cond_trash_ge', 'trash:le': 'cond_trash_le', 'trash:eq': 'cond_trash_eq', 'trash:gt': 'cond_trash_gt', 'trash:lt': 'cond_trash_lt',
  'security:ge': 'cond_security_ge', 'security:le': 'cond_security_le', 'security:eq': 'cond_security_eq', 'security:gt': 'cond_security_gt', 'security:lt': 'cond_security_lt',
  'evo_source:ge': 'cond_has_evo', 'evo_source:le': 'cond_has_evo_le', 'evo_source:eq': 'cond_has_evo_eq', 'evo_source:gt': 'cond_has_evo_gt', 'evo_source:lt': 'cond_has_evo_lt',
  'battle_area:ge': 'cond_battle_area_ge', 'battle_area:le': 'cond_battle_area_le', 'battle_area:eq': 'cond_battle_area_eq', 'battle_area:gt': 'cond_battle_area_gt', 'battle_area:lt': 'cond_battle_area_lt',
};
type RefQuant = 'ge' | 'le' | 'eq' | 'gt' | 'lt' | 'face_down' | 'face_up';
const REF_QUANT_NO_VALUE = new Set<RefQuant>(['face_down', 'face_up']);
// 裏向き/表向き（cond_face_down/cond_face_up）はカード自体の裏表状態を見るだけでゾーンを
// 問わない判定だが、「どのゾーンについて聞いているか」の表示が消えると分かりにくいため、
// ゾーンは c.value 側に保持する（進化元／セキュリティで選択可。値としては使わない・表示専用）
const REF_FACE_ZONES = new Set(['evo_source', 'security']);
const REF_CODE_TO_ZONE_QUANT: Record<string, { zone: string; quant: RefQuant }> = {
  cond_hand_ge: { zone: 'hand', quant: 'ge' }, cond_hand_le: { zone: 'hand', quant: 'le' }, cond_hand_eq: { zone: 'hand', quant: 'eq' }, cond_hand_gt: { zone: 'hand', quant: 'gt' }, cond_hand_lt: { zone: 'hand', quant: 'lt' },
  cond_trash_ge: { zone: 'trash', quant: 'ge' }, cond_trash_le: { zone: 'trash', quant: 'le' }, cond_trash_eq: { zone: 'trash', quant: 'eq' }, cond_trash_gt: { zone: 'trash', quant: 'gt' }, cond_trash_lt: { zone: 'trash', quant: 'lt' },
  cond_security_ge: { zone: 'security', quant: 'ge' }, cond_security_le: { zone: 'security', quant: 'le' }, cond_security_eq: { zone: 'security', quant: 'eq' }, cond_security_gt: { zone: 'security', quant: 'gt' }, cond_security_lt: { zone: 'security', quant: 'lt' },
  cond_has_evo: { zone: 'evo_source', quant: 'ge' }, cond_has_evo_le: { zone: 'evo_source', quant: 'le' }, cond_has_evo_eq: { zone: 'evo_source', quant: 'eq' }, cond_has_evo_gt: { zone: 'evo_source', quant: 'gt' }, cond_has_evo_lt: { zone: 'evo_source', quant: 'lt' },
  cond_battle_area_ge: { zone: 'battle_area', quant: 'ge' }, cond_battle_area_le: { zone: 'battle_area', quant: 'le' }, cond_battle_area_eq: { zone: 'battle_area', quant: 'eq' }, cond_battle_area_gt: { zone: 'battle_area', quant: 'gt' }, cond_battle_area_lt: { zone: 'battle_area', quant: 'lt' },
};
function isRefFaceCond(base: string): boolean {
  return base === 'cond_face_down' || base === 'cond_face_up';
}
// 現在の行が指すゾーン（裏向き/表向きのときは c.value に保持したゾーンを見る）
function refZoneOf(c: ConditionPair): string {
  if (isRefFaceCond(c.base)) return (c.value && REF_FACE_ZONES.has(c.value)) ? c.value : 'evo_source';
  return REF_CODE_TO_ZONE_QUANT[c.base]?.zone || 'hand';
}
// 現在の行の「値」バリアント（以上/以下/完全一致/裏向き/表向き）
function refQuantOf(c: ConditionPair): RefQuant {
  if (c.base === 'cond_face_down') return 'face_down';
  if (c.base === 'cond_face_up') return 'face_up';
  return REF_CODE_TO_ZONE_QUANT[c.base]?.quant || 'ge';
}
// ゾーンを変更する（値バリアントは可能な限り維持。裏向き/表向きは対応ゾーンでのみ維持できる）
function refApplyZone(zone: string, quant: RefQuant, value: string | undefined): { base: string; value?: string } {
  if (quant === 'face_down' || quant === 'face_up') {
    if (REF_FACE_ZONES.has(zone)) return { base: quant === 'face_down' ? 'cond_face_down' : 'cond_face_up', value: zone };
    return { base: REF_ZONE_QUANT_TO_CODE[zone + ':ge'], value: undefined };
  }
  return { base: REF_ZONE_QUANT_TO_CODE[zone + ':' + quant] };
}
// 値バリアントを変更する（裏向き/表向きは現在のゾーンをそのまま value として保持する。
// 以上/以下/完全一致の切替では、入力済みの枚数や「参照」(value:'opp')はそのまま維持する
// ―― 以上/以下ボタンの切替のたびに「参照」選択が数値入力に巻き戻る不具合があったため）
function refApplyQuant(zone: string, quant: RefQuant, currentValue?: string): { base: string; value?: string } {
  if (quant === 'face_down' || quant === 'face_up') {
    return { base: quant === 'face_down' ? 'cond_face_down' : 'cond_face_up', value: zone };
  }
  return { base: REF_ZONE_QUANT_TO_CODE[zone + ':' + quant], value: currentValue };
}
const REF_QUANT_OPTIONS_BY_ZONE: Record<string, { code: RefQuant; label: string }[]> = {
  evo_source: [
    { code: 'ge', label: '以上' }, { code: 'le', label: '以下' }, { code: 'eq', label: '完全一致' },
    { code: 'gt', label: 'より多い' }, { code: 'lt', label: 'より少ない' },
    { code: 'face_down', label: '裏向き' }, { code: 'face_up', label: '表向き' },
  ],
  security: [
    { code: 'ge', label: '以上' }, { code: 'le', label: '以下' }, { code: 'eq', label: '完全一致' },
    { code: 'gt', label: 'より多い' }, { code: 'lt', label: 'より少ない' },
    { code: 'face_down', label: '裏向き' }, { code: 'face_up', label: '表向き' },
  ],
};
const REF_QUANT_OPTIONS_DEFAULT: { code: RefQuant; label: string }[] = [
  { code: 'ge', label: '以上' }, { code: 'le', label: '以下' }, { code: 'eq', label: '完全一致' },
  { code: 'gt', label: 'より多い' }, { code: 'lt', label: 'より少ない' },
];
// 種別ボタン用（「その他」はトリガー同様、別枠のチェックボックスで扱うため除外）
const CATEGORY_BUTTON_OPTIONS = CATEGORY_OPTIONS.filter((c) => c.value !== 'other')
  .map((c) => ({ code: c.value, label: c.label }));

// カテゴリ選択直後に自動セットされる既定コード（バリアント無しは1つだけ・バリアント有りは先頭）
const CATEGORY_DEFAULT_BASE: Record<string, string> = {
  color: 'cond_color',
  type: 'cond_type',
  feature: 'cond_feature_contains',
  lv: 'cond_lv_ge',
  dp: 'cond_dp_ge',
  cost: 'cond_cost_ge',
  memory: 'cond_memory_ge',
  cost_mod: 'cond_cost_mod',
  name: 'cond_name',
  description: 'cond_description',
  zone: 'cond_zone',
  ref: 'cond_hand_ge',
  designated: DESIGNATED_NAME_COND,
  stacked: 'cond_target_stack',
};

// バリアント選択が必要なカテゴリのプルダウン候補
const CATEGORY_VARIANTS: Partial<Record<CondCategory, { value: string; label: string }[]>> = {
  lv: [
    { value: 'cond_lv_ge', label: '以上' },
    { value: 'cond_lv_le', label: '以下' },
    { value: 'cond_lv', label: '完全一致' },
  ],
  dp: [
    { value: 'cond_dp_ge', label: '以上' },
    { value: 'cond_dp_le', label: '以下' },
    { value: 'cond_dp', label: '完全一致' },
    { value: 'cond_dp_highest', label: '最も高い' },
    { value: 'cond_dp_lowest', label: '最も低い' },
    { value: 'cond_attack_target_highest_dp', label: '最も高い（アタック対象専用）' },
    { value: 'cond_attack_target_lowest_dp', label: '最も低い（アタック対象専用）' },
  ],
  cost: [
    { value: 'cond_cost_ge', label: '以上' },
    { value: 'cond_cost_le', label: '以下' },
    { value: 'cond_cost', label: '完全一致' },
  ],
  memory: [
    { value: 'cond_memory_ge', label: '以上' },
    { value: 'cond_memory_le', label: '以下' },
  ],
  name: [
    { value: 'cond_name', label: '完全一致' },
    { value: 'cond_name_contains', label: '含む' },
  ],
  description: [
    { value: 'cond_description', label: '完全一致' },
    { value: 'cond_description_contains', label: '含む' },
  ],
};

// 条件コード → カテゴリ の逆引き（既存レシピ読込時・行の見た目復元用）
function baseToCategory(base: string): CondCategory {
  if (!base) return '';
  if (base === 'cond_color' || base === 'cond_color_distinct') return 'color';
  if (base === 'cond_type') return 'type';
  if (base === 'cond_feature_contains' || base === 'cond_feature') return 'feature';
  if (base === 'cond_lv_ge' || base === 'cond_lv_le' || base === 'cond_lv' || base === 'cond_lv_distinct') return 'lv';
  if (base === 'cond_dp_ge' || base === 'cond_dp_le' || base === 'cond_dp'
    || base === 'cond_dp_highest' || base === 'cond_dp_lowest'
    || base === 'cond_attack_target_highest_dp' || base === 'cond_attack_target_lowest_dp') return 'dp';
  if (base === 'cond_cost_ge' || base === 'cond_cost_le' || base === 'cond_cost') return 'cost';
  if (base === 'cond_memory_ge' || base === 'cond_memory_le') return 'memory';
  if (base === 'cond_cost_mod') return 'cost_mod';
  if (base === 'cond_name' || base === 'cond_name_contains' || base === 'cond_name_distinct') return 'name';
  if (base === 'cond_description' || base === 'cond_description_contains' || base === 'cond_description_distinct') return 'description';
  if (base === 'cond_zone') return 'zone';
  if (REF_CODE_TO_ZONE_QUANT[base] || isRefFaceCond(base)) return 'ref';
  if (base === DESIGNATED_NAME_COND) return 'designated';
  if (base === 'cond_target_stack') return 'stacked';
  return 'other';
}

// 「コスト増減」用: value を "符号+数値|N|参照対象" 形式でエンコードして保存する
// （+1 のみ／+1を自分のトラッシュ5枚ごとに、のような「～ごとに」倍率も1行で表現するため）
// ※エンジン未対応のためこの形式はエディタ内でのみ解釈する（保存はできるが動作しない）
function parseCostMod(value: string | undefined): { sign: '+' | '-'; amount: string; perCount: string; perRef: string } {
  const [head, perCount, perRef] = String(value || '').split('|');
  const sign: '+' | '-' = head.trim().startsWith('-') ? '-' : '+';
  const amount = head.replace(/^[+-]/, '').trim();
  return { sign, amount, perCount: perCount || '', perRef: perRef || '' };
}
function formatCostMod(sign: '+' | '-', amount: string, perCount: string, perRef: string): string {
  return `${sign}${amount}|${perCount}|${perRef}`;
}

function ConditionsHybridEditor({
  conditions, onChange, dict, title, hint, theme, defaultSubject = '', showSubjectSelector = true,
  sameAsTargetSubject,
  supportsMultiValue = false, attackContextActive = false,
  part = 'full', otherOpen: otherOpenProp, onOtherOpenChange, showCostMod = false,
  showTypeInTargetFilter = false, conditionsOp, onConditionsOpChange, allowDistinctVariants = false,
}: ConditionsHybridEditorProps) {
  const colors = theme === 'trigger'
    ? { bg: '#e8f7e8', border: '#93c693', accent: '#1a5a1a', icon: '🔔' }
    : { bg: '#e8f0fe', border: '#93b5e5', accent: '#1a4f8a', icon: '🎯' };
  // DPの「最も高い/最も低い（アタック対象専用）」は、【アタック時】系のブロックでのみ意味を成すため
  // それ以外のときは選択肢から除外する
  const dpVariantOptions = (CATEGORY_VARIANTS.dp || []).filter((v) =>
    attackContextActive || (v.value !== 'cond_attack_target_highest_dp' && v.value !== 'cond_attack_target_lowest_dp')
  );
  // カテゴリごとのバリアント選択肢（以上/以下/完全一致 等）。allowDistinctVariants時のみ、
  // 名前/Lv/記述/色に「異なる」（複数枚選択時の集合レベルの制約）を追加する
  const variantOptionsFor = (catCode: CondCategory): { value: string; label: string }[] | undefined => {
    const base = catCode === 'dp' ? dpVariantOptions : CATEGORY_VARIANTS[catCode];
    const distinct = allowDistinctVariants ? DISTINCT_VARIANT_BY_CATEGORY[catCode] : undefined;
    if (!base && !distinct) return undefined;
    return distinct ? [...(base || []), distinct] : base;
  };
  // 対象の条件（supportsMultiValue）では「対象」ボタン側にデジモン/カード/テイマー等を
  // 既に選べるため、同じ役割の「タイプ」カテゴリはよく使う条件から除外して重複を避ける。
  // 「コスト増減」は登場/進化/消滅アクション選択時の発動条件でのみ意味を持つため、
  // showCostMod=true のとき以外は非表示にする
  const visibleCategoryOptions = CATEGORY_BUTTON_OPTIONS.filter((c) => {
    if (c.code === 'type' && supportsMultiValue && !showTypeInTargetFilter) return false;
    if (c.code === 'cost_mod' && !showCostMod) return false;
    // 「場所」は対象の条件（対象フィルタ・supportsMultiValue）専用。トリガー条件/発動条件
    // ではエンジンが「どのカードの場所を見るか」を特定できないため意味を持たない
    if (c.code === 'zone' && !supportsMultiValue) return false;
    return true;
  });

  // 「その他」用: 色/タイプ/特徴/Lv/DP/名前として直接選べるコード群を除いた残り
  const CATEGORIZED_CODES = new Set<string>([
    'cond_color', 'cond_type', 'cond_feature_contains', 'cond_feature',
    'cond_lv_ge', 'cond_lv_le', 'cond_lv', 'cond_dp_ge', 'cond_dp_le', 'cond_dp',
    'cond_dp_highest', 'cond_dp_lowest',
    'cond_attack_target_highest_dp', 'cond_attack_target_lowest_dp',
    'cond_cost_ge', 'cond_cost_le', 'cond_cost', 'cond_cost_mod',
    'cond_memory_ge', 'cond_memory_le',
    'cond_name', 'cond_name_contains', 'cond_description', 'cond_description_contains', 'cond_zone',
    'cond_name_distinct', 'cond_lv_distinct', 'cond_description_distinct', 'cond_color_distinct',
    // トリガーボックス側の専用「アタック対象」ボタンで管理するため、その他の追加候補にも出さない
    'cond_attack_target_player', 'cond_attack_target_digimon',
    // 「参照」カテゴリで扱う手札/トラッシュ/セキュリティ/進化元の枚数条件
    'cond_hand_ge', 'cond_hand_le', 'cond_trash_ge', 'cond_trash_le',
    'cond_security_ge', 'cond_security_le', 'cond_has_evo', 'cond_has_evo_le',
    // 「効果で」(cond_effect等)は専用カテゴリボタンを設けず「その他条件」内に留める
    // ため、ここでは除外しない（isByEffectCondでその行だけ専用UIを重ねて表示する）
    // 「指定」カテゴリで扱うプレースホルダー
    'cond_designated_name',
  ]);
  const otherCondOptions = toOpts(dict.conditions.filter((c) => !CATEGORIZED_CODES.has(c.code)));

  const [localOtherOpen, setLocalOtherOpen] = useState(false);
  const otherOpen = otherOpenProp !== undefined ? otherOpenProp : localOtherOpen;
  const setOtherOpen = onOtherOpenChange || setLocalOtherOpen;

  // 「コスト」カテゴリ専用: 登場/使用/両方でカード種別を絞り込む（対象の条件=supportsMultiValue時のみ）。
  // 登場=デジモン/テイマー（場に出す）・使用=オプション（使用して手放す）・両方=絞り込みなし
  function getCostTypeScope(): 'summon' | 'use' | 'both' {
    const t = conditions.find((c) => c.base === 'cond_type');
    if (!t) return 'both';
    const vals = String(t.value || '').split(',').map((s) => s.trim());
    if (vals.length === 1 && vals[0] === 'オプション') return 'use';
    if (vals.includes('デジモン')) return 'summon';
    return 'both';
  }
  function setCostTypeScope(mode: 'summon' | 'use' | 'both') {
    const withoutType = conditions.filter((c) => c.base !== 'cond_type');
    if (mode === 'both') { onChange(withoutType); return; }
    const value = mode === 'summon' ? 'デジモン,テイマー' : 'オプション';
    onChange([...withoutType, { base: 'cond_type', value }]);
  }

  function updateAt(i: number, patch: Partial<ConditionPair>) {
    const next = conditions.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeAt(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }
  function addRow(base = '') {
    onChange([...conditions, { base, value: '', subject: defaultSubject || undefined }]);
  }
  // よく使う条件（色/タイプ/特徴/Lv/DP/名前/場所）ボタンのトグル。
  // オフ→オン: そのカテゴリの既定コードで1行追加。オン→オフ: そのカテゴリの行を全て削除
  function toggleCategory(cat: string) {
    if (conditions.some((c) => baseToCategory(c.base) === cat)) {
      onChange(conditions.filter((c) => baseToCategory(c.base) !== cat));
    } else {
      addRow(CATEGORY_DEFAULT_BASE[cat] || '');
    }
  }
  // アタック対象(cond_attack_target_player/digimon)はトリガーボックス側の専用「アタック対象」
  // ボタンで管理するため、その他の条件リストには二重表示しない
  const otherRows = conditions
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => baseToCategory(c.base) === 'other'
      && c.base !== 'cond_attack_target_player' && c.base !== 'cond_attack_target_digimon');

  // buttonsNode/panelsNode に分けているのは、対象の条件（対象ボックスにボタン列・
  // 対象数ボックスに詳細パネル）のように別々の場所へ配置したい呼び出し元がいるため。
  // part='full'（既定）のときは両方まとめて1つの枠に描画する（従来通り）
  const buttonsNode = (
    <>
      <label style={{ fontWeight: 'bold', color: colors.accent }}>
        {colors.icon} {title}
        <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>{hint}</span>
      </label>
      {onConditionsOpChange ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 6px' }}>
          <span style={{ fontSize: 10, color: '#666' }}>複数指定した場合の結合方法:</span>
          <ButtonGroup
            options={[{ code: 'and', label: 'AND（全部満たす）' }, { code: 'or', label: 'OR（いずれか満たす）' }]}
            value={conditionsOp || 'and'}
            onChange={(v) => onConditionsOpChange((v || 'and') as 'and' | 'or')}
            accentColor={colors.accent}
          />
        </div>
      ) : (
        <div style={{ fontSize: 10, color: '#666', margin: '2px 0 6px' }}>
          複数指定した場合はすべて AND（全部を満たしたときだけ発動）。
        </div>
      )}

      {/* よく使う条件: ボタンを押すとその場に詳細設定が展開する（よく使うトリガーと同じ操作感） */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {visibleCategoryOptions.map((cat) => {
          const active = conditions.some((c) => baseToCategory(c.base) === cat.code);
          return (
            <button
              key={cat.code}
              type="button"
              onClick={() => toggleCategory(cat.code)}
              style={{
                padding: '3px 9px', borderRadius: 5,
                border: active ? `2px solid ${colors.accent}` : '1px solid #bbb',
                background: active ? colors.accent : '#f5f5f5',
                color: active ? '#fff' : '#333',
                fontWeight: active ? 'bold' : 'normal',
                cursor: 'pointer', fontSize: 11,
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, marginTop: 8, color: '#666' }}>
        <input
          type="checkbox"
          checked={otherOpen || otherRows.length > 0}
          onChange={(e) => setOtherOpen(e.target.checked)}
        />
        その他の条件
      </label>
    </>
  );

  const panelsNode = (
    <>
      {/* アクティブなカテゴリごとの詳細設定（値・対象） */}
      {visibleCategoryOptions.map((cat) => {
        const rows = conditions.map((c, i) => ({ c, i })).filter(({ c }) => baseToCategory(c.base) === cat.code);
        if (rows.length === 0) return null;
        return (
          <div key={cat.code} style={{ marginTop: 6 }}>
            {rows.map(({ c, i }) => {
              const def = COMMON_CONDS.find((cc) => cc.code === c.base);
              // 「タイプ」カテゴリのみ: 対象(subject)側で既にデジモン/テイマーと確定している場合、
              // このタイプ判定は常に自明(true)になり無意味なため、値ピッカーを出さず注記のみ表示する。
              // 対象=カード(種別問わず)/未設定のときは、オプション等の絞り込みに実用性があるため通常表示する
              const rowSub = COND_SUBJECT_CODE_TO_L1L2[c.subject || ''] || { l1: '', l2: '' };
              const typeRedundant = cat.code === 'type' && (rowSub.l2 === 'digimon' || rowSub.l2 === 'tamer');
              return (
                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', marginBottom: 6, padding: 6, border: `1px solid ${colors.border}`, borderRadius: 4, background: 'white' }}>
                  <div style={{ fontSize: 11, fontWeight: 'bold', color: colors.accent, paddingTop: 6, whiteSpace: 'nowrap' }}>
                    {cat.label}
                    {c.base && (
                      isConditionImplemented(c.base)
                        ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 4 }}>✅</span>
                        : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 4 }} title="エンジン未実装">⚠</span>
                    )}
                  </div>
                  {/* 参照: 手札/トラッシュ/セキュリティ/進化元(テイマーの下含む)/バトルエリアの
                      どれを見るか（ゾーン選択）。裏向き/表向き選択中もゾーン表示は消さない
                      （c.value にゾーンを保持しているためそのまま表示を維持できる） */}
                  {cat.code === 'ref' && (
                    <ButtonGroup
                      options={REF_ZONE_OPTIONS}
                      value={refZoneOf(c)}
                      onChange={(zone) => updateAt(i, refApplyZone(zone, refQuantOf(c), c.value))}
                      accentColor={colors.accent}
                    />
                  )}
                  {/* Lv/DP/名前: 「以上/以下/完全一致」等のバリアントボタン（コンテンツ幅のみ使用・空なら詰める） */}
                  {variantOptionsFor(cat.code as CondCategory) && (
                    <ButtonGroup
                      options={variantOptionsFor(cat.code as CondCategory)!.map((v) => ({ code: v.value, label: v.label }))}
                      value={c.base}
                      onChange={(v) => updateAt(i, { base: v })}
                      accentColor={colors.accent}
                    />
                  )}
                  {/* コストのみ: 登場(デジモン/テイマー)/使用(オプション)/両方でカード種別を絞り込む。
                      対象の条件（supportsMultiValue）でのみ有効（cond_typeの複数値がtype_inとして
                      解釈されるのはこの文脈だけのため） */}
                  {cat.code === 'cost' && supportsMultiValue && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>カード種別</div>
                      <ButtonGroup
                        options={[{ code: 'summon', label: '登場' }, { code: 'use', label: '使用' }, { code: 'both', label: '両方' }]}
                        value={getCostTypeScope()}
                        onChange={(v) => setCostTypeScope(v as 'summon' | 'use' | 'both')}
                        accentColor={colors.accent}
                      />
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
                    {cat.code === 'ref' ? (
                      /* 参照: 以上/以下/完全一致ボタン + 枚数入力。進化元/セキュリティのみ
                         裏向き/表向きも選べ、その場合は値不要のため枚数欄を隠す */
                      (() => {
                        const refZone = refZoneOf(c);
                        const refQuant = refQuantOf(c);
                        const refQuantOptions = REF_QUANT_OPTIONS_BY_ZONE[refZone] || REF_QUANT_OPTIONS_DEFAULT;
                        const refNoValue = REF_QUANT_NO_VALUE.has(refQuant);
                        return (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <ButtonGroup
                              options={refQuantOptions}
                              value={refQuant}
                              onChange={(quant) => updateAt(i, refApplyQuant(
                                refZone,
                                quant as RefQuant,
                                (refQuant === 'face_down' || refQuant === 'face_up') ? undefined : c.value,
                              ))}
                              accentColor={colors.accent}
                            />
                            {refNoValue ? (
                              <span style={{ fontSize: 10, color: '#666' }}>（値なし・カードの裏表で判定）</span>
                            ) : c.value === 'opp' ? (
                              <>
                                <span style={{ fontSize: 11, color: colors.accent }}>相手のこのゾーンの枚数</span>
                                <button
                                  type="button"
                                  onClick={() => updateAt(i, { value: '' })}
                                  style={{ padding: '2px 8px', border: '1px solid #bbb', background: '#f5f5f5', color: '#333', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}
                                >
                                  数値入力に戻す
                                </button>
                              </>
                            ) : (
                              <>
                                <input
                                  type="number"
                                  min={0}
                                  value={c.value || ''}
                                  onChange={(e) => updateAt(i, { value: e.target.value })}
                                  placeholder="枚数"
                                  style={{ width: 70, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                                />
                                <span style={{ fontSize: 10, color: '#555' }}>枚</span>
                                <button
                                  type="button"
                                  onClick={() => updateAt(i, { value: 'opp' })}
                                  style={{ padding: '4px 8px', border: '1px solid #bbb', background: '#f5f5f5', color: '#333', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                                  title="相手側の同じゾーンの枚数と動的に比較する（例:自分の手札が相手の手札以上）"
                                >
                                  参照
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })()
                    ) : cat.code === 'cost_mod' ? (
                      /* コスト増減: 「登場コストX以下」等のしきい値そのものを+/-する。
                         ⚠エンジン未対応（コスト条件のしきい値に per_count 相当の倍率を
                         掛ける処理が無い）。エディタで保存はできるが動作しないプレースホルダー */
                      (() => {
                        const cm = parseCostMod(c.value);
                        const setCm = (patch: Partial<typeof cm>) => {
                          const next = { ...cm, ...patch };
                          updateAt(i, { value: formatCostMod(next.sign, next.amount, next.perCount, next.perRef) });
                        };
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <ButtonGroup
                                options={[{ code: '+', label: '+' }, { code: '-', label: '-' }]}
                                value={cm.sign}
                                onChange={(v) => setCm({ sign: v as '+' | '-' })}
                                accentColor={colors.accent}
                              />
                              <input
                                type="number"
                                value={cm.amount}
                                onChange={(e) => setCm({ amount: e.target.value })}
                                placeholder="コスト"
                                style={{ width: 80, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, color: '#555' }}>（任意）</span>
                              <input
                                type="number"
                                min={1}
                                value={cm.perCount}
                                onChange={(e) => setCm({ perCount: e.target.value })}
                                placeholder="枚数"
                                style={{ width: 60, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                              />
                              <span style={{ fontSize: 10, color: '#555' }}>枚ごとに</span>
                              <div style={{ minWidth: 160 }}>
                                <SearchSelect
                                  value={cm.perRef}
                                  onChange={(v) => setCm({ perRef: v })}
                                  options={toOpts(REF_SUBJECTS)}
                                  placeholder="--対象--"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : typeRedundant ? (
                      <div style={{ fontSize: 11, color: '#888', padding: '4px 6px' }}>
                        （対象で種別を指定済みのため不要）
                      </div>
                    ) : c.base === 'cond_same_as_picked'
                      || (supportsMultiValue && c.base === 'cond_type')
                      || c.base === 'cond_color'
                      || c.base === 'cond_feature_contains' ? (
                      /* 「選んだデジモンと同じ」「タイプ(複数可・ターゲットフィルタ限定)」
                         「色(複数可・全箇所共通)」「特徴を含む(複数可・全箇所共通)」:
                         複数選択（カンマ区切りで保存）。
                         カードは同時に複数タイプを持てないため、複数選択=常にOR判定でよい
                         （「紫のデジモンかオプション」はタイプで デジモン,オプション を両方トグルするだけで表現可能）
                         ※ cond_type の複数値は step.filter (type_in配列) でのみ解釈される。
                           トリガー条件/発動条件側は単一値exact-match想定なのでそちらでは使わないこと。
                         ※ cond_feature_contains の複数値（カンマ区切り）は、対象の絞り込み文脈では
                           step.filter (feature_includes配列) として、トリガー条件/発動条件/コスト対象の
                           絞り込み文脈(checkConditions)ではカンマ区切りのOR判定として、どちらも
                           「いずれか1つを含む」の意味で解釈される（全箇所対応済み）
                         ※ cond_color の複数値（2色以上選択）は現状どの箇所でもエンジン未対応
                           （多色カードは1枚で複数の色を持てるため、type_inと単純に同じ扱いにはできない） */
                      c.base === 'cond_feature_contains' ? (() => {
                        const feats = (c.value || '').split(',').map((s) => s.trim()).filter(Boolean);
                        const setFeats = (next: string[]) => updateAt(i, { value: next.join(',') });
                        return (
                          <MultiTextTags values={feats} onChange={setFeats} placeholder="例: サイボーグ型" accentColor={colors.accent} />
                        );
                      })() : (() => {
                        const optList = c.base === 'cond_type' ? RULE_TYPE_OPTS.filter((o) => o.value).map((o) => ({ code: o.value, label: o.label }))
                          : c.base === 'cond_color' ? RULE_COLOR_OPTS.filter((o) => o.value).map((o) => ({ code: o.value, label: o.label }))
                          : SAME_AS_PICKED_FIELDS;
                        const sel = (c.value || '').split(',').map((s) => s.trim()).filter(Boolean);
                        const toggleAttr = (code: string, on: boolean) => {
                          const next = on
                            ? Array.from(new Set([...sel, code]))
                            : sel.filter((s) => s !== code);
                          updateAt(i, { value: next.join(',') });
                        };
                        return (
                          <>
                            <MultiButtonGroup options={optList} values={sel} onToggle={toggleAttr} accentColor={colors.accent} />
                            {c.base === 'cond_color' && sel.length > 1 && (
                              <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>
                                ⚠ 2色以上の選択はエンジン未対応です（保存はできますが動作しません）
                              </div>
                            )}
                          </>
                        );
                      })()
                    ) : (c.base === 'cond_dp_le' || c.base === 'cond_dp_ge') ? (
                      DP_REF_CODES.has(c.value || '') ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <ButtonGroup
                            options={DP_REF_SUBJECTS}
                            value={c.value || ''}
                            onChange={(v) => updateAt(i, { value: v })}
                            accentColor={colors.accent}
                          />
                          <button
                            type="button"
                            onClick={() => updateAt(i, { value: '' })}
                            style={{ alignSelf: 'flex-start', padding: '2px 8px', border: '1px solid #bbb', background: '#f5f5f5', color: '#333', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}
                          >
                            数値入力に戻す
                          </button>
                          <div style={{ fontSize: 10, color: '#c62828' }}>⚠ 他のデジモンのDPを動的に参照する条件はエンジン未実装です（保存はできますが動作しません）</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            value={c.value || ''}
                            onChange={(e) => updateAt(i, { value: e.target.value })}
                            style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 100, boxSizing: 'border-box' }}
                          />
                          <button
                            type="button"
                            onClick={() => updateAt(i, { value: 'self' })}
                            style={{ padding: '4px 8px', border: '1px solid #bbb', background: '#f5f5f5', color: '#333', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                          >
                            参照
                          </button>
                        </div>
                      )
                    ) : def && def.input === 'select' ? (
                      <ButtonGroup
                        options={(def.options || []).filter((o) => o.value).map((o) => ({ code: o.value, label: o.label }))}
                        value={c.value || ''}
                        onChange={(v) => updateAt(i, { value: v })}
                        accentColor={colors.accent}
                      />
                    ) : def && def.input === 'number' ? (
                      <input
                        type="number"
                        value={c.value || ''}
                        onChange={(e) => updateAt(i, { value: e.target.value })}
                        style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 100, boxSizing: 'border-box' }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={c.value || ''}
                        onChange={(e) => updateAt(i, { value: e.target.value })}
                        placeholder={NO_VALUE_CONDS.has(c.base) ? '（値不要）' : '（必要なら）'}
                        disabled={NO_VALUE_CONDS.has(c.base)}
                        style={{ width: 160, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                      />
                    )}
                  </div>
                  {showSubjectSelector && cat.code !== 'memory' && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                      {sameAsTargetSubject && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#555', marginBottom: 4 }}>
                          <input
                            type="checkbox"
                            checked={c.subject === sameAsTargetSubject}
                            onChange={(e) => updateAt(i, { subject: e.target.checked ? sameAsTargetSubject : undefined })}
                          />
                          対象と同じ
                        </label>
                      )}
                      <div style={(sameAsTargetSubject && c.subject === sameAsTargetSubject) ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                      {(() => {
                        const rawSub = splitStackSuffix(c.subject || '');
                        const curSub = COND_SUBJECT_CODE_TO_L1L2[rawSub.base] || { l1: '', l2: '' };
                        const stackPos = rawSub.pos;
                        const showStackPos = curSub.l1 === 'self' || curSub.l2 === 'digimon' || curSub.l2 === 'tamer';
                        // 「コスト」カテゴリは登場/使用コストを持つカードのみが対象になるため、
                        // 「このカード(self)」（参照コストなので自分自身を指すことは通常ない）と、
                        // L2の「ブロッカー」（コストを持たない/対象外）は選択肢から外す
                        const subjectL1Options = cat.code === 'cost'
                          ? COND_SUBJECT_L1.filter((o) => o.code !== 'self')
                          : COND_SUBJECT_L1;
                        const l2Options = (COND_SUBJECT_L2[curSub.l1] || []).filter((o) =>
                          !(cat.code === 'cost' && o.code === 'blocker')
                        );
                        // タイプカテゴリの行で対象がデジモン/テイマーに確定した場合、値ピッカーを隠す
                        // (typeRedundant)のに合わせて値も破棄する。古い値が残っていると
                        // 「対象=デジモンなのに値=テイマー」のような矛盾で常にfalseになってしまうため
                        const clearIfRedundant = (l2: string) => (cat.code === 'type' && (l2 === 'digimon' || l2 === 'tamer')) ? { value: '' } : {};
                        const handleSubL1 = (l1: string) => {
                          if (!l1 || l1 === 'both') { updateAt(i, { subject: l1 || undefined }); return; }
                          const l2 = curSub.l1 === l1 && curSub.l2 ? curSub.l2 : 'digimon';
                          updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[l1 + ':' + l2], ...clearIfRedundant(l2) });
                        };
                        const handleSubL2 = (l2: string) => {
                          updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':' + l2], ...clearIfRedundant(l2) });
                        };
                        const setStackPos = (pos: StackPos) => updateAt(i, { subject: joinStackSuffix(rawSub.base, pos) });
                        // 自分+デジモンのときのみ「このカードを含めない」を選べる
                        // （含めない＝他の自分のデジモン。旧 other_own コードをそのまま使う）
                        const showIncludeSelfToggle = curSub.l1 === 'own' && curSub.l2 === 'digimon';
                        const excludeSelf = rawSub.base === 'other_own';
                        // デジモン/テイマーは複数選択可（両方選ぶとcard=「カード」扱いに集約。対象/
                        // 対象の条件と同じ操作感。カード単体ボタンは冗長になるため除外する）
                        const hasDigimonTamerSub = (curSub.l1 === 'own' || curSub.l1 === 'opp' || curSub.l1 === 'other_own');
                        const subDigimonCode = COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':digimon'];
                        const subTamerCode = COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':tamer'];
                        const subCardCode = COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':card'];
                        const subDigimonChecked = hasDigimonTamerSub && (curSub.l2 === 'digimon' || curSub.l2 === 'card');
                        const subTamerChecked = hasDigimonTamerSub && (curSub.l2 === 'tamer' || curSub.l2 === 'card');
                        const subExclusiveL2Options = l2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer' && o.code !== 'card');
                        const applySubDigiTamer = (nextDigimon: boolean, nextTamer: boolean) => {
                          if (nextDigimon && nextTamer) updateAt(i, { subject: subCardCode, ...clearIfRedundant('card') });
                          else if (nextDigimon) updateAt(i, { subject: subDigimonCode, ...clearIfRedundant('digimon') });
                          else if (nextTamer) updateAt(i, { subject: subTamerCode, ...clearIfRedundant('tamer') });
                          else updateAt(i, { subject: curSub.l1 || undefined });
                        };
                        return (
                          <>
                            <ButtonGroup options={subjectL1Options} value={curSub.l1} onChange={handleSubL1} accentColor={colors.accent} />
                            {hasDigimonTamerSub && (
                              <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <MultiButtonGroup
                                  options={[{ code: 'digimon', label: 'デジモン' }, { code: 'tamer', label: 'テイマー' }]}
                                  values={[...(subDigimonChecked ? ['digimon'] : []), ...(subTamerChecked ? ['tamer'] : [])]}
                                  onToggle={(code, on) => applySubDigiTamer(
                                    code === 'digimon' ? on : subDigimonChecked,
                                    code === 'tamer' ? on : subTamerChecked
                                  )}
                                  accentColor={colors.accent}
                                />
                                {subExclusiveL2Options.length > 0 && (
                                  <ButtonGroup
                                    options={subExclusiveL2Options}
                                    value={!subDigimonChecked && !subTamerChecked ? curSub.l2 : ''}
                                    onChange={handleSubL2}
                                    accentColor={colors.accent}
                                  />
                                )}
                              </div>
                            )}
                            {!hasDigimonTamerSub && l2Options.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <ButtonGroup options={l2Options} value={curSub.l2} onChange={handleSubL2} accentColor={colors.accent} />
                              </div>
                            )}
                            {showStackPos && (
                              <div style={{ marginTop: 4 }}>
                                <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>位置:</span>
                                <ButtonGroup options={STACK_POS_OPTIONS} value={stackPos} onChange={(v) => setStackPos(v as StackPos)} accentColor={colors.accent} />
                              </div>
                            )}
                            {showIncludeSelfToggle && (
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, marginTop: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={excludeSelf}
                                  onChange={(e) => updateAt(i, { subject: e.target.checked ? 'other_own' : 'own' })}
                                />
                                このカードを含めない
                              </label>
                            )}
                          </>
                        );
                      })()}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => removeAt(i)}
                    style={{ padding: '0 8px', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 3, cursor: 'pointer', height: 26, alignSelf: 'flex-end' }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {/* Lv/DP/コスト/名前/記述: 同じカテゴリで複数条件を組み合わせたい場合
                （例:「Lv5以下」+「Lvの異なる」、DPの範囲指定「1000以上」+「5000以下」等）
                に、もう1行追加できるようにする。色/タイプ/特徴/場所等はカンマ区切りの
                複数値入力で足りるため対象外（variantOptionsForが無いカテゴリには出さない） */}
            {variantOptionsFor(cat.code as CondCategory) && (
              <button
                type="button"
                onClick={() => addRow(CATEGORY_DEFAULT_BASE[cat.code] || '')}
                style={{
                  fontSize: 11, padding: '2px 8px', marginTop: 2,
                  border: `1px dashed ${colors.accent}`, color: colors.accent,
                  background: 'white', borderRadius: 4, cursor: 'pointer',
                }}
              >
                + {cat.label}の条件をもう1つ追加
              </button>
            )}
          </div>
        );
      })}

      {/* その他の条件（トリガー発火元カードへのフィルタ）: チェックボックス自体はbuttonsNode側にあり、
          ここでは実際のピッカー/行のみを表示する */}
      {(otherOpen || otherRows.length > 0) && (
        <div style={{ marginTop: 4 }}>
          {otherRows.map(({ c, i }) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', marginBottom: 6, padding: 6, border: `1px solid ${colors.border}`, borderRadius: 4, background: 'white' }}>
              <div style={{ width: 220 }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>条件</div>
                <SearchSelect
                  value={c.base}
                  onChange={(v) => updateAt(i, { base: v })}
                  options={otherCondOptions}
                  allowFreeText
                  placeholder="--条件を選択--"
                />
                {c.base && (
                  isConditionImplemented(c.base)
                    ? <span style={{ color: '#2e7d32', fontSize: 10 }}>✅実装済</span>
                    : <span style={{ color: '#e65100', fontSize: 10 }} title="エンジン未実装">⚠未実装</span>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
                {isByEffectCond(c.base) ? (
                  /* 「効果で」: 「以外」チェックのみ（数値等は不要） */
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, height: 26 }}>
                    <input
                      type="checkbox"
                      checked={byEffectIsNot(c)}
                      onChange={(e) => updateAt(i, {
                        base: 'cond_effect',
                        value: e.target.checked ? 'not' : undefined,
                        subject: byEffectSubject(c),
                      })}
                    />
                    以外
                  </label>
                ) : (
                  <input
                    type="text"
                    value={c.value || ''}
                    onChange={(e) => updateAt(i, { value: e.target.value })}
                    placeholder={NO_VALUE_CONDS.has(c.base) ? '（値不要）' : '（必要なら）'}
                    disabled={NO_VALUE_CONDS.has(c.base)}
                    style={{ width: 160, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                  />
                )}
              </div>
              {isByEffectCond(c.base) ? (
                /* 「効果で」: 自分/相手/互い（subjectで指定）。汎用の「対象」セレクタとは
                    別のコード体系のため、こちらのボタンのみ表示する */
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>自分/相手/互い</div>
                  <ButtonGroup
                    options={BY_EFFECT_SUBJECT_OPTIONS}
                    value={byEffectSubject(c)}
                    onChange={(subject) => updateAt(i, {
                      base: 'cond_effect',
                      value: byEffectIsNot(c) ? 'not' : undefined,
                      subject,
                    })}
                    accentColor={colors.accent}
                  />
                </div>
              ) : showSubjectSelector && c.base !== 'cond_memory_ge' && c.base !== 'cond_memory_le' && (
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                  {(() => {
                    const rawSub = splitStackSuffix(c.subject || '');
                    const curSub = COND_SUBJECT_CODE_TO_L1L2[rawSub.base] || { l1: '', l2: '' };
                    const stackPos = rawSub.pos;
                    const showStackPos = curSub.l1 === 'self' || curSub.l2 === 'digimon' || curSub.l2 === 'tamer';
                    const l2Options = COND_SUBJECT_L2[curSub.l1] || [];
                    const handleSubL1 = (l1: string) => {
                      if (!l1 || l1 === 'both') { updateAt(i, { subject: l1 || undefined }); return; }
                      const l2 = curSub.l1 === l1 && curSub.l2 ? curSub.l2 : 'digimon';
                      updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[l1 + ':' + l2] });
                    };
                    const handleSubL2 = (l2: string) => {
                      updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':' + l2] });
                    };
                    const setStackPos = (pos: StackPos) => updateAt(i, { subject: joinStackSuffix(rawSub.base, pos) });
                    const showIncludeSelfToggle = curSub.l1 === 'own' && curSub.l2 === 'digimon';
                    const excludeSelf = rawSub.base === 'other_own';
                    // デジモン/テイマーは複数選択可（両方選ぶとcard=「カード」扱いに集約）
                    const hasDigimonTamerSub2 = (curSub.l1 === 'own' || curSub.l1 === 'opp' || curSub.l1 === 'other_own');
                    const sub2DigimonCode = COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':digimon'];
                    const sub2TamerCode = COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':tamer'];
                    const sub2CardCode = COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':card'];
                    const sub2DigimonChecked = hasDigimonTamerSub2 && (curSub.l2 === 'digimon' || curSub.l2 === 'card');
                    const sub2TamerChecked = hasDigimonTamerSub2 && (curSub.l2 === 'tamer' || curSub.l2 === 'card');
                    const sub2ExclusiveL2Options = l2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer' && o.code !== 'card');
                    const applySub2DigiTamer = (nextDigimon: boolean, nextTamer: boolean) => {
                      if (nextDigimon && nextTamer) updateAt(i, { subject: sub2CardCode });
                      else if (nextDigimon) updateAt(i, { subject: sub2DigimonCode });
                      else if (nextTamer) updateAt(i, { subject: sub2TamerCode });
                      else updateAt(i, { subject: curSub.l1 || undefined });
                    };
                    return (
                      <>
                        <ButtonGroup options={COND_SUBJECT_L1} value={curSub.l1} onChange={handleSubL1} accentColor={colors.accent} />
                        {hasDigimonTamerSub2 && (
                          <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <MultiButtonGroup
                              options={[{ code: 'digimon', label: 'デジモン' }, { code: 'tamer', label: 'テイマー' }]}
                              values={[...(sub2DigimonChecked ? ['digimon'] : []), ...(sub2TamerChecked ? ['tamer'] : [])]}
                              onToggle={(code, on) => applySub2DigiTamer(
                                code === 'digimon' ? on : sub2DigimonChecked,
                                code === 'tamer' ? on : sub2TamerChecked
                              )}
                              accentColor={colors.accent}
                            />
                            {sub2ExclusiveL2Options.length > 0 && (
                              <ButtonGroup
                                options={sub2ExclusiveL2Options}
                                value={!sub2DigimonChecked && !sub2TamerChecked ? curSub.l2 : ''}
                                onChange={handleSubL2}
                                accentColor={colors.accent}
                              />
                            )}
                          </div>
                        )}
                        {!hasDigimonTamerSub2 && l2Options.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <ButtonGroup options={l2Options} value={curSub.l2} onChange={handleSubL2} accentColor={colors.accent} />
                          </div>
                        )}
                        {showStackPos && (
                          <div style={{ marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>位置:</span>
                            <ButtonGroup options={STACK_POS_OPTIONS} value={stackPos} onChange={(v) => setStackPos(v as StackPos)} accentColor={colors.accent} />
                          </div>
                        )}
                        {showIncludeSelfToggle && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, marginTop: 4 }}>
                            <input
                              type="checkbox"
                              checked={excludeSelf}
                              onChange={(e) => updateAt(i, { subject: e.target.checked ? 'other_own' : 'own' })}
                            />
                            このカードを含めない
                          </label>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
              <button
                onClick={() => removeAt(i)}
                style={{ padding: '0 8px', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 3, cursor: 'pointer', height: 26, alignSelf: 'flex-end' }}
              >
                ✕
              </button>
            </div>
          ))}
          <SearchSelect
            value=""
            onChange={(v) => addRow(v)}
            options={otherCondOptions}
            allowFreeText
            placeholder="＋ 条件を選択して追加"
          />
          <InlineDictAdd kind="conditions" dict={dict} onRegistered={(v) => addRow(v)} />
        </div>
      )}
    </>
  );

  if (part === 'buttons') {
    return <div className="field" style={{ marginBottom: 4 }}>{buttonsNode}</div>;
  }
  if (part === 'panels') {
    return <div className="field">{panelsNode}</div>;
  }
  return (
    <div className="field" style={{ gridColumn: '1 / span 2', background: colors.bg, padding: 8, borderRadius: 4, border: `1px solid ${colors.border}` }}>
      {buttonsNode}
      {panelsNode}
    </div>
  );
}

function miniBtn(): React.CSSProperties {
  return { padding: '2px 6px', border: '1px solid #888', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 10 };
}
function miniLbl(): React.CSSProperties {
  return { fontSize: 10, color: '#555', marginBottom: 2, fontWeight: 'bold' };
}

// （旧 RulePanel/RuleParamInput は MiniStep 方式への移行で削除済）
