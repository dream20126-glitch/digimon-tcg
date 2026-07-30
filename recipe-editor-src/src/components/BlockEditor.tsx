import { useState } from 'react';
import type { EffectBlock, ConditionPair, CostStep, MiniStep, DictEntry, AltAction, GrantedStep } from '../types';
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
import { blocksToRecipe } from '../recipe';

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

  function autoSuggest() {
    if (!label.trim()) { setMsg('❌ 先に日本語名を入力してください'); return; }
    setCode(suggestCode(label, kind, dict));
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
      const r = await dict.addEntry(kind, { code: code.trim(), label: label.trim(), kind: kindToSingular(kind), ...extra });
      if (r.ok) {
        setMsg('✅ 登録しました: ' + code.trim());
        onRegistered(code.trim());
        setOpen(false);
        setLabel('');
        setCode('');
        setTemplateBlocks([]);
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
            <br />※【セキュリティアタック+2】のように数値がカードごとに変わる場合、ここでは値欄を空欄のままにしてください。
            カード側の「キーワード効果」バナーで入力した数値が、保存時にこの空欄部分へ自動で差し込まれます。
          </div>
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

// 発動領域ボタンの表示順・ラベル（ZONESの code:'' はバトルエリアを指す）
const ZONE_BUTTONS = [
  { code: 'hand', label: '手札' },
  { code: 'trash', label: 'トラッシュ' },
  { code: 'security', label: 'セキュリティ' },
  { code: 'breed', label: '育成エリア' },
  { code: '', label: 'バトルエリア' },
];

// 発動主体の2段階ボタン選択:
// 1段目「このカード/自分/相手/他」→ 2段目「デジモン/カード/テイマー/プレイヤー」
// own_card/opp_card/other_own_card/other_own_tamer はエディタ側でのみ選べる新コード
// （エンジン側は未実装。実際にこの範囲を使うカードが出てきたら実装する）
const SUBJECT_L1 = [
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'other_own', label: '他' },
];
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
};

// 条件の「対象」用の2段階ボタン選択（発動主体と同じ見た目のパターンだが、
// CONDITION_SUBJECTS のコード体系が発動主体と異なる＝別テーブルで持つ）
// - '既定'（空文字）= 対象を指定しない（アクション対象そのものを見る）
// - このカード配下は self（このデジモン）/ self_card（このカード全般）の2択のみ
// - 「他の自分のデジモン」は独立したL1ボタンではなく、自分+デジモン選択時の
//   「このカードを含める/含めない」トグルとして表現する（旧 other_own コード）
const COND_SUBJECT_L1 = [
  { code: '', label: '既定' },
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
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
};

// 「アクションの対象」用の2段階ボタン選択（TARGETS辞書のコード体系専用テーブル）。
// - 発動主体/条件対象とはコード名が異なる（相手のデジモン=opponent 等）
// - このカード(self)/他(other_own)/直前選択(same_target) はL2を持たない単独コード
//   （このカードは「デジモンでもテイマーでも同じ」ため self_card 固定でL2自体を出さない）
// - レスト/アクティブ状態は「対象の条件（ターゲットフィルタ）」側のチェックボックスで指定する
//   （対象コード自体に持たせる opponent_suspended 等の専用コードは使わない）
// - opp_security/target_other_own_card/target_other_own_tamer/opponent_tamer は
//   エンジン未実装のプレースホルダー（選べるが⚠警告を出す。既存の実装パターンと同様）
const TARGET_SEL_UNIMPLEMENTED = new Set([
  'opp_security', 'target_other_own_card', 'target_other_own_tamer', 'opponent_tamer',
  'own_option', 'opponent_option',
]);
const TARGET_SEL_L1 = [
  { code: '', label: '既定' },
  { code: 'self', label: 'このカード' },
  { code: 'own', label: '自分' },
  { code: 'opp', label: '相手' },
  { code: 'other_own', label: '他' },
  { code: 'same_target', label: 'そのデジモン' },
];
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
};
const TARGET_SEL_L1L2_TO_CODE: Record<string, string> = {
  'own:digimon': 'own', 'own:card': 'own_card', 'own:tamer': 'own_tamer', 'own:option': 'own_option', 'own:security': 'own_security',
  'opp:digimon': 'opponent', 'opp:card': 'opponent_card', 'opp:tamer': 'opponent_tamer', 'opp:option': 'opponent_option', 'opp:player': 'opp_player', 'opp:security': 'opp_security',
  'other_own:digimon': 'target_other_own', 'other_own:card': 'target_other_own_card', 'other_own:tamer': 'target_other_own_tamer',
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
  same_target: { l1: 'same_target', l2: '' },
};

// よく使うトリガー:
// - 'event' 種別（登場時/進化時/アタック時/アタック終了時/消滅時）は実際に起きる出来事。
//   発動タイミング(自分/相手/お互い)を選ぶと、トリガーコード自体は変えず
//   cond_during_own_turn/cond_during_opp_turnを条件として追加する（お互い=条件なし）。
// - 'timing' 種別（メイン/ターン開始時/ターン終了時/継続効果/メインフェイズ開始時）は
//   発動タイミングによってトリガーコード自体が切り替わる。
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
  {
    code: 'on_attack', label: 'アタック時', kind: 'timing',
    // 自分=このカードがアタックしたとき(on_attack) / 相手=相手のデジモンがアタックしたとき(when_opp_attack、ロゼモン等)
    variants: { self: 'on_attack', opp: 'when_opp_attack', any: 'on_any_attack' },
    implemented: { self: true, opp: true, any: false },
  },
  {
    code: 'on_attack_end', label: 'アタック終了時', kind: 'timing',
    variants: { self: 'on_attack_end', opp: 'when_opp_attack_end', any: 'on_any_attack_end' },
    implemented: { self: true, opp: false, any: false },
  },
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
  { code: 'summon', label: '登場/使用' },
  { code: 'draw', label: 'ドロー' },
  { code: 'grant_keyword', label: 'キーワード付与' },
  { code: 'destroy', label: '消滅' },
  { code: 'deck_open', label: 'デッキオープン' },
  { code: 'recover', label: 'リカバリー' },
  { code: 'evolve', label: '進化' },
];
// COMMON_ACTIONS の一部（登場/使用・進化）は辞書に登録せず常時使えるビルトインのため、
// 辞書のhasFromZonesフラグに頼らず「場所」ボタンを常に表示する
const BUILTIN_FROM_ZONE_ACTIONS = new Set(['summon', 'evolve']);
// よく使う期間（対象と同じ2段ボタン式）
const DURATION_L1 = [
  { code: 'dur_this_turn', label: 'このターン中' },
  { code: 'turn_end', label: 'ターン終了まで' },
  { code: 'active_phase', label: 'アクティブフェイズ開始まで' },
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
  if (dur === 'dur_while') return 'dur_while';
  return '';
}
// 現在選択中のtriggers/triggerConditionsから、共有の発動タイミングを逆算する
function inferTiming(currentTriggers: string[], triggerConditions: ConditionPair[], families: TriggerFamily[] = COMMON_TRIGGER_FAMILIES): TimingKey {
  for (const fam of families) {
    if (fam.kind !== 'timing' || !fam.variants) continue;
    if (currentTriggers.includes(fam.variants.opp)) return 'opp';
    if (currentTriggers.includes(fam.variants.any)) return 'any';
  }
  if (triggerConditions.some((c) => c.base === 'cond_during_opp_turn')) return 'opp';
  return 'self';
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

export function BlockEditor({ block, index, dict, onChange, onRemove, onMoveUp, onMoveDown, isKeywordMode }: Props) {
  const effectiveTriggerFamilies = isKeywordMode ? [...COMMON_TRIGGER_FAMILIES, ...KEYWORD_ONLY_TRIGGER_FAMILIES] : COMMON_TRIGGER_FAMILIES;
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
  // 「対象の条件」は対象が下記の場合のみ表示する:
  // 自分→デジモン/カード/テイマー・相手→デジモン/テイマー・他→デジモン
  const showTargetFilter =
    (curTgt.l1 === 'own' && ['digimon', 'card', 'tamer'].includes(curTgt.l2)) ||
    (curTgt.l1 === 'opp' && ['digimon', 'tamer'].includes(curTgt.l2)) ||
    (curTgt.l1 === 'other_own' && curTgt.l2 === 'digimon');

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

  // 修飾子操作（複数選択可）
  const opts = block.options || [];
  function toggleOption(code: string) {
    const next = opts.includes(code) ? opts.filter((o) => o !== code) : [...opts, code];
    update('options', next);
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
  const effectTarget = isEditingAlt ? (editingAlt!.target || '') : (block.target || '');
  const effectConditions = isEditingAlt ? (editingAlt!.conditions || []) : conditions;
  const effectFromZones = isEditingAlt ? (editingAlt!.fromZones || []) : (block.fromZones || []);
  const effectFromZonesOp = isEditingAlt ? (editingAlt!.fromZonesOp || 'or') : (block.fromZonesOp || 'or');
  const effectDuration = isEditingAlt ? editingAlt!.duration : block.duration;
  const effectPerCount = isEditingAlt ? editingAlt!.perCount : block.perCount;
  const effectPerRef = isEditingAlt ? editingAlt!.perRef : block.perRef;
  const effectPerCountMode = isEditingAlt ? editingAlt!.perCountMode : block.perCountMode;
  const effectPerRefFilter = isEditingAlt ? (editingAlt!.perRefFilter || []) : (block.perRefFilter || []);
  function updateEffect(patch: Record<string, any>) {
    if (isEditingAlt) updateAltAction(editingEffect - 1, patch);
    else onChange({ ...block, ...patch });
  }
  // アクション変更（ルールクリア判定は効果1=block自身のときのみ。代替アクションにルールは無い）
  function changeEffectAction(newAction: string) {
    if (isEditingAlt) { updateEffect({ action: newAction }); return; }
    changeAction(newAction);
  }

  // 付与効果操作（grantedStep）
  const grantedStep: GrantedStep = block.grantedStep || { trigger: '', action: '', conditions: [], options: [] };
  function updateGrantedStep(patch: Partial<GrantedStep>) {
    onChange({ ...block, grantedStep: { ...grantedStep, ...patch } });
  }

  // コスト操作
  const costs = block.costs || [];
  function updateCost(i: number, c: CostStep) {
    const next = costs.slice();
    next[i] = c;
    update('costs', next);
  }
  function addCost() {
    update('costs', [...costs, { action: '', value: '', target: '' }]);
  }
  function removeCost(i: number) {
    update('costs', costs.filter((_, idx) => idx !== i));
  }

  // === 折りたたみ state ===
  const [triggerCondsOpen, setTriggerCondsOpen] = useState<boolean>((block.triggerConditions || []).length > 0);
  const [otherTriggerOpen, setOtherTriggerOpen] = useState<boolean>(false);
  const [otherActionOpen, setOtherActionOpen] = useState<boolean>(false);
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
              {/* 対象プルダウン */}
              <div style={{ minWidth: 200 }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                <SearchSelect
                  value={refSubject}
                  onChange={setSubject}
                  options={toOpts(REF_SUBJECTS)}
                />
              </div>
              {/* 状態プルダウン: デジモン系のみ表示。dict.conditions から動的に選択肢生成 */}
              {isDigimonSubject && (
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    状態（条件）
                    {currentStateCond.base && (
                      isConditionImplemented(currentStateCond.base)
                        ? <span style={{ color: '#2e7d32', fontSize: 9 }}>✅</span>
                        : <span style={{ color: '#e65100', fontSize: 9 }} title="エンジン未実装">⚠</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#888' }}>辞書の条件を流用</span>
                  </div>
                  <SearchSelect
                    value={currentStateCond.base}
                    onChange={setStateBase}
                    options={stateCondOptions}
                    allowFreeText
                  />
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
            {/* フィルタ: カウント時に追加で絞り込み（COMMON_CONDS と項目共通） */}
            {(() => {
              // 発動条件と同じ COMMON_CONDS を共有（項目統一）
              const FILTER_FIELDS: CommonCondDef[] = COMMON_CONDS;
              const filterArr = curPerRefFilter;
              const isFilterChecked = (code: string) => filterArr.some((c) => c.base === code);
              const getFilterValue = (code: string) => {
                const c = filterArr.find((cc) => cc.base === code);
                return c ? (c.value || '') : '';
              };
              const setFilterChecked = (code: string, enabled: boolean) => {
                if (enabled) {
                  if (!isFilterChecked(code)) {
                    setFields({ perRefFilter: [...filterArr, { base: code, value: '' }] });
                  }
                } else {
                  setFields({ perRefFilter: filterArr.filter((c) => c.base !== code) });
                }
              };
              const setFilterValue = (code: string, val: string) => {
                const i = filterArr.findIndex((c) => c.base === code);
                if (i >= 0) {
                  const next = filterArr.slice();
                  next[i] = { ...next[i], value: val };
                  setFields({ perRefFilter: next });
                } else {
                  setFields({ perRefFilter: [...filterArr, { base: code, value: val }] });
                }
              };
              return (
                <div style={{ marginTop: 8, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #c5d4ea' }}>
                  <div style={{ fontSize: 11, fontWeight: 'bold', color: '#1976d2', marginBottom: 4 }}>
                    🔍 さらに絞り込み（チェックで有効化・複数で AND）
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {FILTER_FIELDS.map((f) => (
                      <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isFilterChecked(f.code)}
                          onChange={(e) => setFilterChecked(f.code, e.target.checked)}
                          style={{ margin: 0 }}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                  {FILTER_FIELDS.some((f) => isFilterChecked(f.code)) && (
                    <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                      {FILTER_FIELDS.filter((f) => isFilterChecked(f.code)).map((f) => (
                        <div key={f.code}>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{f.label}</div>
                          {f.input === 'select' ? (
                            <select
                              value={getFilterValue(f.code)}
                              onChange={(e) => setFilterValue(f.code, e.target.value)}
                              style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                            >
                              {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : f.input === 'number' ? (
                            <input
                              type="number"
                              value={getFilterValue(f.code)}
                              onChange={(e) => setFilterValue(f.code, e.target.value)}
                              style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={getFilterValue(f.code)}
                              onChange={(e) => setFilterValue(f.code, e.target.value)}
                              style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
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
        {/* === ＜前提＞ブロック: 区分 / 発動領域 / 限定 をボタン式で選択 ===
            キーワード効果のテンプレート編集(isKeywordMode)では、カード固有の概念（区分/
            発動領域/ターン制限）は不要なため非表示にする */}
        {!isKeywordMode && (
        <div style={{
          gridColumn: '1 / span 2', padding: 10, background: '#fdeef2',
          border: '1px solid #f3b8ce', borderRadius: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 'bold', minWidth: 56 }}>区分 *</label>
            <ButtonGroup options={SECTIONS} value={block.section} onChange={(v) => update('section', v)} accentColor="#d6336c" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 'bold', minWidth: 56 }}>発動領域</label>
            <ButtonGroup options={ZONE_BUTTONS} value={block.zone || ''} onChange={(v) => update('zone', v)} accentColor="#d6336c" />
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
              <label style={{ display: 'block', fontWeight: 'bold', color: '#6b21a8', marginBottom: 4 }}>
                🔑 キーワード
                {block.keyword && (
                  isKeywordImplemented(block.keyword)
                    ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 6 }}>✅実装済</span>
                    : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 6 }} title="エンジン未実装">⚠未実装</span>
                )}
              </label>
              <SearchSelect
                value={block.keyword || ''}
                onChange={(v) => update('keyword', v)}
                options={toOpts(dict.keywords)}
                allowFreeText
              />
              <InlineDictAdd kind="keywords" dict={dict} onRegistered={(v) => update('keyword', v)} />
              <div style={{ marginTop: 8 }}>
                <label style={{ display: 'block', fontWeight: 'bold', color: '#6b21a8', marginBottom: 4 }}>
                  数値（【セキュリティアタック+2】等の数値がある場合のみ）
                </label>
                <input
                  type="number"
                  value={block.value === undefined ? '' : String(block.value)}
                  onChange={(e) => {
                    const v = e.target.value;
                    update('value', v === '' ? undefined : Number(v));
                  }}
                  placeholder="例: 2"
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 120 }}
                />
              </div>
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
              effectiveTriggerFamilies.forEach((fam) => {
                if (fam.kind !== 'timing' || !fam.variants) return;
                const oldVariant = Object.values(fam.variants).find((v) => next.includes(v));
                if (!oldVariant) return;
                const newVariant = fam.variants[newTiming];
                next = next.filter((t) => t !== oldVariant);
                if (!next.includes(newVariant)) next.push(newVariant);
              });
              let nextConds = triggerConditions.filter((c) => c.base !== 'cond_during_own_turn' && c.base !== 'cond_during_opp_turn');
              if (newTiming === 'self') nextConds = [...nextConds, { base: 'cond_during_own_turn' }];
              else if (newTiming === 'opp') nextConds = [...nextConds, { base: 'cond_during_opp_turn' }];
              onChange({ ...block, trigger: next[0] || '', triggers: next, triggerConditions: nextConds });
            };

            const allFamilyCodes = new Set<string>();
            effectiveTriggerFamilies.forEach((fam) => {
              if (fam.kind === 'event') allFamilyCodes.add(fam.code);
              else Object.values(fam.variants!).forEach((v) => allFamilyCodes.add(v));
            });
            const hasOtherSelected = currentTriggers.some((t) => !allFamilyCodes.has(t));

            const unimplementedActive = effectiveTriggerFamilies.filter((fam) => {
              if (fam.kind !== 'timing' || !fam.variants) return false;
              const variant = fam.variants[timing];
              return currentTriggers.includes(variant) && fam.implemented?.[timing] === false;
            });

            const cur = SUBJECT_CODE_TO_L1L2[block.triggerSubject || ''] || { l1: 'self', l2: '' };
            const handleL1 = (l1: string) => {
              if (l1 === 'self') { update('triggerSubject', 'self'); return; }
              const l2 = cur.l1 === l1 && cur.l2 ? cur.l2 : 'digimon';
              update('triggerSubject', SUBJECT_L1L2_TO_CODE[l1 + ':' + l2] || SUBJECT_L1L2_TO_CODE[l1 + ':digimon']);
            };
            const handleL2 = (l2: string) => {
              update('triggerSubject', SUBJECT_L1L2_TO_CODE[cur.l1 + ':' + l2]);
            };
            const l2Options = cur.l1 === 'other_own' ? SUBJECT_L2.filter((o) => o.code !== 'player') : SUBJECT_L2;
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
                    {/* コスト軽減/キーワード効果はカード自身の特殊トリガーのため、
                        キーワードのテンプレート編集(isKeywordMode)では出さない
                        （キーワード内でさらにキーワードやコスト軽減を使うことは想定しない） */}
                    {!isKeywordMode && (
                      <>
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
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: '#666' }}>発動タイミング:</span>
                    <ButtonGroup options={TIMING_OPTIONS.map((t) => ({ code: t.code, label: t.label }))} value={timing} onChange={(v) => setTiming(v as TimingKey)} accentColor="#2e7d32" />
                  </div>
                  {unimplementedActive.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
                      ⚠ 「{unimplementedActive.map((f) => f.label).join('」「')}」×「{TIMING_OPTIONS.find((t) => t.code === timing)?.label}」はエンジン未実装です（保存はできますが動作しません）
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
                  <ButtonGroup options={SUBJECT_L1} value={cur.l1} onChange={handleL1} accentColor="#2e7d32" />
                  {cur.l1 !== 'self' && (
                    <div style={{ marginTop: 4 }}>
                      <ButtonGroup options={l2Options} value={cur.l2} onChange={handleL2} accentColor="#2e7d32" />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
                attackContextActive={isAttackTrigger}
              />
            </div>
          )}
        </div>
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
              （枠色は削除。演出タイプはこの行に統合） */}
          {block.trigger !== 'alt_evolve' && (
            <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <ButtonGroup
                  options={[{ code: 'forced', label: '強制' }, { code: 'optional', label: '任意' }]}
                  value={block.optional ? 'optional' : 'forced'}
                  onChange={(v) => update('optional', v === 'optional')}
                  accentColor="#2e7d32"
                />
              </div>
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
            </div>
          )}

          {/* 効果発動ポップアップの表示テキスト: 空欄なら効果テキストから自動抽出にフォールバック。
              強制効果のみ「表示しない」を選べる（任意効果は確認ダイアログが必須のため対象外）。
              強制/任意ボタンと同様、アクション選択前から常に表示する */}
          {block.trigger !== 'alt_evolve' && (
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
          ) : COST_REDUCTION_TRIGGERS.has(block.trigger) ? (
            <div style={{ fontSize: 11, color: '#888' }}>
              💰 コスト軽減トリガーはアクション不要です（軽減量は上の💰バナー内に入力済み）。
            </div>
          ) : (() => {
          // アクションのグループ表示処理（_top/_bottom/_select 系を1エントリに）
          // ※ effectAction/effectValue = 編集中の効果（効果1=block自身 / 効果2以降=altActions[i]）
          const { options: actionDisplayOptions, flaggedBases, autoGroupBases } = buildActionDisplay(dict.actions);
          const curVariant = getActionVariant(effectAction);
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

          // 位置 pulldown の選択肢（フラグ付き base は3種固定、autoGroup は dict にあるバリアントのみ）
          const variantOptions: SelectOption[] = (() => {
            if (!isPositional) return [];
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

          // よく使うアクション（トリガー家族ボタンと同じ操作感）: 該当すればボタン1つで即選択、
          // 無ければ「その他のアクション」を開いて既存のプルダウン(+位置バリアント)から選ぶ
          const isCommonAction = COMMON_ACTIONS.some((a) => a.code === effectAction);
          function selectCommonAction(code: string) {
            if (isEditingAlt) { updateEffect({ action: code, value: '' }); return; }
            const dictEntry = findActionEntry(code);
            const allowsRules = !!(dictEntry && dictEntry.allowsRules) || hasRuleTranslator(code);
            const next: EffectBlock = { ...block, action: code, value: '' };
            if (!allowsRules && Array.isArray(block.rules) && block.rules.length > 0) next.rules = [];
            onChange(next);
          }

          // コストを支払わず/登場時効果は発揮しない/裏向きで は効果1（メインアクション）専用。
          // 代替アクション（効果2以降）にはまだ対応していない
          const showCostCheckboxes = !isEditingAlt && (effectAction === 'summon' || effectAction === 'summon_from_trash' || effectAction === 'evolve' || effectAction === 'summon_from_evo_source');
          const showSkipOnPlay = !isEditingAlt && (effectAction === 'summon' || effectAction === 'summon_from_trash');

          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isPositional && variantOptions.length > 0 ? '2fr 1fr 1fr' : '2fr 1fr',
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
                  {/* summon / summon_from_trash / evolve / summon_from_evo_source 専用（効果1のみ）:
                      コストを支払わず / 登場時効果は発揮しない / 裏向きで(place_on_security_top) */}
                  {(showCostCheckboxes || (!isEditingAlt && effectAction === 'place_on_security_top')) && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {showCostCheckboxes && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={!!block.costFree}
                            onChange={(e) => update('costFree', e.target.checked)}
                          />
                          コストを支払わず
                        </label>
                      )}
                      {showSkipOnPlay && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={!!block.skipOnPlay}
                            onChange={(e) => update('skipOnPlay', e.target.checked)}
                          />
                          登場時効果は発揮しない
                        </label>
                      )}
                      {!isEditingAlt && effectAction === 'place_on_security_top' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={(block.options || []).includes('face_down')}
                            onChange={(e) => {
                              const opts = block.options || [];
                              update('options', e.target.checked ? [...opts, 'face_down'] : opts.filter((o) => o !== 'face_down'));
                            }}
                          />
                          裏向きで
                        </label>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {COMMON_ACTIONS.map((a) => {
                    const active = effectAction === a.code;
                    return (
                      <button
                        key={a.code}
                        type="button"
                        onClick={() => selectCommonAction(a.code)}
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
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, marginTop: 6, color: '#666' }}>
                  <input
                    type="checkbox"
                    checked={otherActionOpen || (!!effectAction && !isCommonAction)}
                    onChange={(e) => setOtherActionOpen(e.target.checked)}
                  />
                  その他のアクション
                </label>
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
              {/* 位置バリアント pulldown: フラグ駆動 or 自動グループ化時のみ */}
              {isPositional && variantOptions.length > 0 && (
                <div className="field">
                  <label>📍 位置</label>
                  <SearchSelect
                    value={currentSuffix}
                    onChange={onVariantChange}
                    options={variantOptions}
                  />
                </div>
              )}
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
            </div>
          );
        })()}

        {/* 🔀 代替アクション（OR/AND）: OR=プレイヤーがどちらかを選ぶ / AND=両方行う。
            「編集中」ボタンで効果1（このアクション自体）〜効果Nを切り替えると、上の
            アクション/対象/対象数/発動条件/場所/期間の各ボタン群がその効果に対して
            読み書きされる（ボタン群は1箇所のみで、編集対象を切り替えて使う） */}
        {(() => {
          const isOrChecked = altOp === 'or' && altActions.length > 0;
          const isAndChecked = altOp === 'and' && altActions.length > 0;
          const setMode = (mode: 'or' | 'and' | null) => {
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
          const btnStyle = (active: boolean) => ({
            padding: '4px 10px', borderRadius: 5,
            border: active ? '2px solid #9333ea' : '1px solid #bbb',
            background: active ? '#9333ea' : '#f5f5f5',
            color: active ? '#fff' : '#333',
            fontWeight: active ? 'bold' : 'normal',
            cursor: 'pointer', fontSize: 12,
          });
          return (
            <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={isOrChecked}
                    onChange={(e) => setMode(e.target.checked ? 'or' : (isAndChecked ? 'and' : null))}
                  />
                  OR（どちらかを選ぶ）
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={isAndChecked}
                    onChange={(e) => setMode(e.target.checked ? 'and' : (isOrChecked ? 'or' : null))}
                  />
                  AND（両方行う）
                </label>
              </div>
              {(isOrChecked || isAndChecked) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                    💡 編集中の効果を選んでください。上のアクション/対象/対象数/発動条件/場所/期間は選んだ効果に反映されます。
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" onClick={() => setEditingEffect(0)} style={btnStyle(editingEffect === 0)}>
                      効果1
                    </button>
                    {altActions.map((a, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <button type="button" onClick={() => setEditingEffect(i + 1)} style={btnStyle(editingEffect === i + 1)}>
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
                  {/* 選択内容の一覧表示: 押したボタンの表記をそのまま連結して書き出す */}
                  <div style={{ marginTop: 8, padding: 8, background: 'white', border: '1px solid #d4b8f0', borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: '#9333ea', fontWeight: 'bold', marginBottom: 4 }}>📋 設定内容</div>
                    <div style={{ fontSize: 12, color: '#333', lineHeight: 1.8 }}>
                      <div>効果1：{describeEffect(block.action, block.value, block.target, block.conditions) || '(未設定)'}</div>
                      {altActions.map((a, i) => (
                        <div key={i}>効果{i + 2}：{describeEffect(a.action, a.value, a.target, a.conditions) || '(未設定)'}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}


        {/* 📍 場所（取得元エリア）: 登場/使用・進化はビルトインのため常時対象、
            それ以外は辞書の hasFromZones=true のアクションのみ表示。編集中の効果に対して読み書き */}
        {(BUILTIN_FROM_ZONE_ACTIONS.has(effectAction) || !!dict.actions.find((a) => a.code === effectAction)?.hasFromZones) && (() => {
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
            </div>
          );
        })()}

        {/* 上/下（デッキに戻す位置など）: 辞書の hasDeckPosition=true なアクションのみ表示。
            両方チェック＝「どちらか選んで」はエンジン未対応（'top'以外は全て下として扱われる） */}
        {!!dict.actions.find((a) => a.code === block.action)?.hasDeckPosition && (() => {
          const top = block.deckPosition === 'top' || block.deckPosition === 'both';
          const bottom = block.deckPosition === 'bottom' || block.deckPosition === 'both';
          const setPos = (nextTop: boolean, nextBottom: boolean) => {
            const v = nextTop && nextBottom ? 'both' : nextTop ? 'top' : nextBottom ? 'bottom' : undefined;
            update('deckPosition', v);
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
          // 効果2以降（代替アクション）を編集中は簡易版のみ（デジモン+テイマー複数選択・
          // 対象の条件は効果1専用のため、混線を避けてここでは提供しない）
          if (isEditingAlt) {
            const eBase = (effectTarget || '').split(':')[0];
            const eSuffix = (effectTarget || '').substring(eBase.length);
            const eCurTgt = TARGET_SEL_CODE_TO_L1L2[eBase] || { l1: '', l2: '' };
            const eL2Options = TARGET_SEL_L2[eCurTgt.l1] || [];
            const eHideCount = eBase === 'self' || eBase === 'self_card';
            const eIsUnimplemented = TARGET_SEL_UNIMPLEMENTED.has(eBase);
            const setEffTgt = (l1: string, l2?: string) => {
              if (!l1) { updateEffect({ target: '' }); return; }
              if (l1 === 'self') { updateEffect({ target: 'self_card' + eSuffix }); return; }
              if (l1 === 'same_target') { updateEffect({ target: 'same_target' + eSuffix }); return; }
              const useL2 = l2 || (eCurTgt.l1 === l1 && eCurTgt.l2 ? eCurTgt.l2 : 'digimon');
              updateEffect({ target: (TARGET_SEL_L1L2_TO_CODE[l1 + ':' + useL2] || '') + eSuffix });
            };
            return (
              <div style={{ display: 'grid', gridTemplateColumns: eHideCount ? '1fr' : '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
                  <label style={{ fontWeight: 'bold', color: '#b76e00' }}>🎯 対象</label>
                  <ButtonGroup options={TARGET_SEL_L1} value={eCurTgt.l1} onChange={(l1) => setEffTgt(l1)} accentColor="#b76e00" />
                  {eL2Options.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <ButtonGroup options={eL2Options} value={eCurTgt.l2} onChange={(l2) => setEffTgt(eCurTgt.l1, l2)} accentColor="#b76e00" />
                    </div>
                  )}
                  {eIsUnimplemented && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#c62828', background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, padding: '4px 8px' }}>
                      ⚠ この対象はエンジン未実装です（保存はできますが動作しません）
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
          const tgtL2Options = TARGET_SEL_L2[curTgt.l1] || [];
          // デジモン/テイマーだけは複数選択可（例:「相手のデジモン/テイマーを1体消滅させる」）。
          // カード/セキュリティ/プレイヤーは従来通り単一選択（デジモン/テイマーの複数選択とは排他）
          const exclusiveL2Options = tgtL2Options.filter((o) => o.code !== 'digimon' && o.code !== 'tamer');
          const hasDigimonTamer = (curTgt.l1 === 'own' || curTgt.l1 === 'opp' || curTgt.l1 === 'other_own');
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
          const hideCount = tgtBase === 'self' || tgtBase === 'self_card';
          const isUnimplemented = TARGET_SEL_UNIMPLEMENTED.has(tgtBase) || isOrMode || isAndMode;

          const handleTgtL1 = (l1: string) => {
            // OR/ANDで自動設定していたフィルタ/代替アクションはL1切替時に一旦クリアする
            const cleared = (isOrMode || isAndMode)
              ? { altActions: [], altActionsOp: undefined, targetFilter: targetFilter.filter((c) => c.base !== 'cond_type') }
              : {};
            if (!l1) { onChange({ ...block, ...cleared, target: '' }); return; }
            if (l1 === 'self') { onChange({ ...block, ...cleared, target: 'self_card' + tgtSuffix }); return; }
            if (l1 === 'same_target') { onChange({ ...block, ...cleared, target: 'same_target' + tgtSuffix }); return; }
            const l2 = curTgt.l1 === l1 && curTgt.l2 ? curTgt.l2 : 'digimon';
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

          return (
            <div style={{ display: 'grid', gridTemplateColumns: hideCount ? '1fr' : '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
                <label style={{ fontWeight: 'bold', color: '#b76e00' }}>
                  🎯 アクションの対象
                  <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                    （このアクションが効果を与えるカード／デジモン）
                  </span>
                </label>
                <ButtonGroup options={TARGET_SEL_L1} value={curTgt.l1} onChange={handleTgtL1} accentColor="#b76e00" />
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
              {!hideCount && (
                <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
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
                  {showTargetFilter && (
                    <div style={{ marginTop: 8, border: '1px solid #b2dfdb', borderRadius: 4, background: '#e0f7f5', padding: 8 }}>
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
        <details className="field" style={{ marginTop: 8 }} open={conditions.length > 0 || (block.costs || []).length > 0 || !!block.perCount}>
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
                ? '（この効果を発動するための条件・複数指定可・AND結合）'
                : block.trigger === 'alt_evolve'
                ? '（代替進化専用の意味: 条件1=発動条件 / 条件2=進化元の絞り込み・複数追加時は3個目以降は無視されます）'
                : '（このアクションを発動するために満たすべき条件・複数指定可・AND結合）'
            }
            theme="action"
            defaultSubject=""
            attackContextActive={isAttackTrigger}
            showCostMod={effectAction === 'summon' || effectAction === 'evolve' || effectAction === 'destroy'}
          />

        {renderPerCountEditor(isEditingAlt)}

        {/* コスト: 「〇〇することで」を表現（効果1専用。AltActionにcostsフィールドは無い） */}
        {!isEditingAlt && (
        <div className="field" style={{ gridColumn: '1 / span 2' }}>
          <label>コスト（「〇〇することで」発動）</label>
          {costs.length === 0 && (
            <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>コストなし</div>
          )}
          {costs.map((c, i) => {
            // コストアクションにも位置指定対応（フラグ駆動 + 自動グループ化）
            const { options: costActionOptions, flaggedBases: costFlaggedBases, autoGroupBases: costAutoGroupBases } = buildActionDisplay(dict.actions);
            const costCurVariant = getActionVariant(c.action || '');
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

            return (
              <div key={i} style={{ marginBottom: 6, padding: 6, border: '1px solid #ffe0b2', borderRadius: 4, background: '#fffbe6' }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                  <div style={{ flex: 2 }}>
                    <SearchSelect
                      value={costNormalizedActionValue}
                      onChange={onCostActionChange}
                      options={costActionOptions}
                      allowFreeText
                      placeholder="--コストアクション--"
                    />
                    {/* 📍 位置 pulldown: フラグ付き or 自動グループ時のみ */}
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
                    style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                  />
                  <div style={{ flex: 1.5 }}>
                    <SearchSelect
                      value={(c.target || '').split(':')[0]}
                      onChange={(v) => updateCost(i, { ...c, target: v })}
                      options={toOpts(TARGETS)}
                      allowFreeText
                      placeholder="--対象--"
                    />
                  </div>
                  <button
                    onClick={() => removeCost(i)}
                    style={{
                      padding: '0 8px',
                      border: '1px solid #d33',
                      color: '#d33',
                      background: 'white',
                      borderRadius: 3,
                      cursor: 'pointer',
                      height: 26,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* === コスト対象の取得元エリア === */}
                {(() => {
                  const czones = c.fromZones || [];
                  const cop = c.fromZonesOp || 'or';
                  const cAvailable = FROM_ZONES.filter((z) => !czones.includes(z.code));
                  return (
                    <div style={{ marginTop: 6, padding: 6, background: '#f3f6fc', borderRadius: 4, border: '1px solid #d8e0f0' }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#1976d2', marginBottom: 4 }}>
                        📥 取得元エリア{czones.length > 0 ? ` (${czones.length})` : ''}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 }}>
                        {czones.length === 0 && (
                          <span style={{ color: '#888', fontSize: 11 }}>（指定なし）</span>
                        )}
                        {czones.map((zCode, zi) => {
                          const z = FROM_ZONES.find((x) => x.code === zCode);
                          const label = z ? z.label : zCode;
                          return (
                            <span key={zCode} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', background: 'white', border: '1px solid #88a', borderRadius: 12, fontSize: 11 }}>
                                {label}
                                <button
                                  onClick={() => updateCost(i, { ...c, fromZones: czones.filter((x) => x !== zCode) })}
                                  style={{ padding: '0 4px', border: 'none', background: 'transparent', color: '#d33', cursor: 'pointer', fontSize: 11 }}
                                  title="削除"
                                >
                                  ✕
                                </button>
                              </span>
                              {zi < czones.length - 1 && (
                                <span style={{ fontSize: 10, color: '#666', fontWeight: 'bold' }}>{cop === 'and' ? 'AND' : 'OR'}</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                        {cAvailable.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) updateCost(i, { ...c, fromZones: [...czones, e.target.value] });
                              e.target.value = '';
                            }}
                            style={{ padding: '3px 6px', border: '1px dashed #88a', borderRadius: 3, fontSize: 11, background: 'white', cursor: 'pointer' }}
                          >
                            <option value="">＋ エリア追加...</option>
                            {cAvailable.map((z) => (
                              <option key={z.code} value={z.code}>{z.label}</option>
                            ))}
                          </select>
                        )}
                        {czones.length >= 2 && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <span style={{ color: '#666' }}>結合:</span>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`costFromOp_${index}_${i}`}
                                checked={cop === 'or'}
                                onChange={() => updateCost(i, { ...c, fromZonesOp: 'or' })}
                                style={{ margin: 0 }}
                              />
                              OR
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`costFromOp_${index}_${i}`}
                                checked={cop === 'and'}
                                onChange={() => updateCost(i, { ...c, fromZonesOp: 'and' })}
                                style={{ margin: 0 }}
                              />
                              AND
                            </label>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* === コスト対象の絞り込み条件 (チェックボックス・複数AND) === */}
                {(() => {
                  const condArr = c.conditions || [];
                  const isCondChecked = (code: string) => condArr.some((cc) => cc.base === code);
                  const getCondValue = (code: string) => {
                    const cc = condArr.find((x) => x.base === code);
                    return cc ? (cc.value || '') : '';
                  };
                  const setCondChecked = (code: string, enabled: boolean) => {
                    if (enabled) {
                      if (!isCondChecked(code)) {
                        updateCost(i, { ...c, conditions: [...condArr, { base: code, value: '' }] });
                      }
                    } else {
                      updateCost(i, { ...c, conditions: condArr.filter((x) => x.base !== code) });
                    }
                  };
                  const setCondValue = (code: string, val: string) => {
                    const idx = condArr.findIndex((x) => x.base === code);
                    if (idx >= 0) {
                      const next = condArr.slice();
                      next[idx] = { ...next[idx], value: val };
                      updateCost(i, { ...c, conditions: next });
                    } else {
                      updateCost(i, { ...c, conditions: [...condArr, { base: code, value: val }] });
                    }
                  };
                  return (
                    <div style={{ marginTop: 6, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #ffe0b2' }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#b76e00', marginBottom: 4 }}>
                        🔍 コスト対象の絞り込み（チェックで有効化・複数で AND）
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                        {COMMON_CONDS.map((f) => (
                          <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={isCondChecked(f.code)}
                              onChange={(e) => setCondChecked(f.code, e.target.checked)}
                              style={{ margin: 0 }}
                            />
                            {f.label}
                          </label>
                        ))}
                      </div>
                      {COMMON_CONDS.some((f) => isCondChecked(f.code)) && (
                        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                          {COMMON_CONDS.filter((f) => isCondChecked(f.code)).map((f) => (
                            <div key={f.code}>
                              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{f.label}</div>
                              {f.input === 'select' ? (
                                <select
                                  value={getCondValue(f.code)}
                                  onChange={(e) => setCondValue(f.code, e.target.value)}
                                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                                >
                                  {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              ) : f.input === 'number' ? (
                                <input
                                  type="number"
                                  value={getCondValue(f.code)}
                                  onChange={(e) => setCondValue(f.code, e.target.value)}
                                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={getCondValue(f.code)}
                                  onChange={(e) => setCondValue(f.code, e.target.value)}
                                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
        </div>
        )}

        </details>
        )}

        {/* === 📐 ルール（アクション直下に配置・メインアクションが対応している場合のみ） === */}
        {actionAllowsRules && (
          <div className="field" style={{ marginTop: 8 }}>
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

        {/* === 🎁 付与する効果（キーワード付与 / 独自の効果付与） ===
            アクションが grant_keyword(_to) / grant_effect のときだけ自動表示。
            パターン切替でどちらの action コードを使うか（block.action）を直接切り替える */}
        {(block.action === 'grant_effect' || block.action === 'grant_keyword' || block.action === 'grant_keyword_to') && (
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
                  💡 対象にキーワード（既存キーワードまたは辞書登録済みのキーワード効果）を付与する。
                  値・対象・対象数・期間は上の通常のアクション欄で設定してください。
                </div>
                <div>
                  <label>
                    付与するキーワード
                    {block.keyword && (
                      isKeywordImplemented(block.keyword)
                        ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 6 }}>✅実装済</span>
                        : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 6 }} title="エンジン未実装">⚠未実装</span>
                    )}
                  </label>
                  <SearchSelect
                    value={block.keyword || ''}
                    onChange={(v) => update('keyword', v)}
                    options={toOpts(dict.keywords)}
                    allowFreeText
                  />
                  <InlineDictAdd kind="keywords" dict={dict} onRegistered={(v) => update('keyword', v)} />
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

        {/* その他の修飾子（実カードで使用実績あり・他に設定手段がないもののみ）:
            continue_on_fail=前段が失敗しても実行 / once_only=次の1回限定（消費型） */}
        <div className="field" style={{ gridColumn: '1 / span 2', marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={opts.includes('continue_on_fail')} onChange={() => toggleOption('continue_on_fail')} />
              その後（前段が失敗しても実行）
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={opts.includes('once_only')} onChange={() => toggleOption('once_only')} />
              次の1回限定（消費型）
              {!isOptionImplemented('once_only') && <span style={{ color: '#e65100', fontSize: 10 }} title="エンジン未実装">⚠</span>}
            </label>
          </div>
        </div>
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
// === ルールフィールド定義 ===
// 各フィールドはチェックボックスで有効/無効を切替できる。
// kind:'top' = step 直下のフィールド (target/type/value)
// kind:'condition' = step.conditions 配列に cond_xxx として格納
//
// input:
//   'select' = プルダウン (options 必須)
//   'text'   = テキスト入力
//   'number' = 数値入力
//   'value'  = 専用 値プルダウン (1/2/3/全て/記述)
type RuleFieldKind = 'top' | 'condition';
type RuleFieldInput = 'select' | 'text' | 'number' | 'value' | 'flag';
interface RuleFieldDef {
  key: string;
  label: string;
  kind: RuleFieldKind;
  topKey?: 'target' | 'type' | 'value' | 'isRemaining';   // kind:'top' のとき step のどのキー
  condCode?: string;                        // kind:'condition' のとき cond_xxx
  input: RuleFieldInput;                    // 'flag' は値入力なし（チェックボックス自体が値）
  options?: SelectOption[];                 // input='select' 用
  placeholder?: string;
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
const RULE_VALUE_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
  { value: 'all', label: '全て' },
  { value: '__custom__', label: '記述（自由入力）' },
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
];
// ルール上部フィールド (step 直下) のみ。条件は ConditionsHybridEditor に統一。
const RULE_FIELDS: RuleFieldDef[] = [
  { key: 'is_remaining', label: '残ったカード', kind: 'top', topKey: 'isRemaining', input: 'flag' },
  { key: 'target', label: '対象',       kind: 'top', topKey: 'target', input: 'select', options: [] /* TARGETS で動的設定 */ },
  { key: 'type',   label: 'タイプ',     kind: 'top', topKey: 'type',   input: 'select', options: RULE_TYPE_OPTS },
  { key: 'value',  label: '値（枚数）', kind: 'top', topKey: 'value',  input: 'value' },
];

function RuleStepEditor({ index, step, dict, onChange, onRemove, onUp, onDown, isAttackTrigger }: RuleStepEditorProps) {
  // === フィールドの「有効化」判定 ===
  // top: step[topKey] が undefined でなければ有効
  // condition: step.conditions に condCode がある entry があれば有効
  function isFieldEnabled(f: RuleFieldDef): boolean {
    if (f.kind === 'top' && f.topKey) {
      const v = (step as any)[f.topKey];
      // flag 型: 真偽値で判定
      if (f.input === 'flag') return v === true;
      return v !== undefined;
    }
    if (f.kind === 'condition' && f.condCode) {
      return !!(step.conditions || []).find((c) => c.base === f.condCode);
    }
    return false;
  }

  // === フィールドの現在値取得 ===
  function getFieldValue(f: RuleFieldDef): any {
    if (f.kind === 'top' && f.topKey) {
      return (step as any)[f.topKey];
    }
    if (f.kind === 'condition' && f.condCode) {
      const c = (step.conditions || []).find((cc) => cc.base === f.condCode);
      return c ? c.value : undefined;
    }
    return undefined;
  }

  // === フィールドの値を更新 ===
  function setFieldValue(f: RuleFieldDef, v: any) {
    if (f.kind === 'top' && f.topKey) {
      onChange({ [f.topKey]: v });
      return;
    }
    if (f.kind === 'condition' && f.condCode) {
      const conds = (step.conditions || []).slice();
      const i = conds.findIndex((c) => c.base === f.condCode);
      const valStr = v === undefined || v === null ? '' : String(v);
      if (i >= 0) conds[i] = { ...conds[i], value: valStr };
      else conds.push({ base: f.condCode, value: valStr });
      onChange({ conditions: conds });
    }
  }

  // === フィールド有効化トグル ===
  function setFieldEnabled(f: RuleFieldDef, enabled: boolean) {
    if (f.kind === 'top' && f.topKey) {
      // flag型: チェック自体が値 (true/undefined)
      if (f.input === 'flag') {
        onChange({ [f.topKey]: enabled ? true : undefined });
        return;
      }
      // 通常 top フィールド: 有効化=空文字、無効化=undefined
      onChange({ [f.topKey]: enabled ? '' : undefined });
      return;
    }
    if (f.kind === 'condition' && f.condCode) {
      const conds = step.conditions || [];
      if (enabled) {
        if (!conds.find((c) => c.base === f.condCode)) {
          onChange({ conditions: [...conds, { base: f.condCode!, value: '' }] });
        }
      } else {
        onChange({ conditions: conds.filter((c) => c.base !== f.condCode) });
      }
    }
  }

  // 値フィールド (input='value') の記述モード state
  const valueRaw = step.value;
  const valueStr = valueRaw === undefined || valueRaw === null ? '' : String(valueRaw);
  const isPresetValue = ['', '1', '2', '3', 'all'].includes(valueStr);
  const [customMode, setCustomMode] = useState<boolean>(!isPresetValue && valueRaw !== undefined);

  // 「対象」のオプションは TARGETS から動的に取得（コンパイル時の動的依存避け）
  const targetOptions = toOpts(TARGETS);

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

        return (
          <div style={{ marginBottom: 8 }}>
            <div style={miniLbl()}>アクション *</div>
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
        );
      })()}

      {/* チェックボックス: 必要なフィールドだけ ☑ */}
      <div style={{ marginBottom: 6, padding: 6, background: '#f3f6fc', borderRadius: 4, border: '1px solid #d8e0f0' }}>
        <div style={{ ...miniLbl(), marginBottom: 4 }}>有効化する項目（必要なものに ☑）</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
          {RULE_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={isFieldEnabled(f)}
                onChange={(e) => setFieldEnabled(f, e.target.checked)}
                style={{ margin: 0 }}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      {/* 有効化されたフィールドの入力欄（flag型は値入力不要なので除外） */}
      {RULE_FIELDS.filter((f) => f.input !== 'flag').some(isFieldEnabled) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
          {RULE_FIELDS.filter((f) => f.input !== 'flag' && isFieldEnabled(f)).map((f) => (
            <div key={f.key}>
              <div style={miniLbl()}>{f.label}</div>
              {/* input: select */}
              {f.input === 'select' && (
                <SearchSelect
                  value={String(getFieldValue(f) ?? '')}
                  onChange={(v) => setFieldValue(f, v)}
                  options={f.key === 'target' ? targetOptions : (f.options || [])}
                  allowFreeText={f.key === 'target'}
                  placeholder={f.placeholder}
                />
              )}
              {/* input: text */}
              {f.input === 'text' && (
                <input
                  type="text"
                  value={String(getFieldValue(f) ?? '')}
                  onChange={(e) => setFieldValue(f, e.target.value)}
                  placeholder={f.placeholder}
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                />
              )}
              {/* input: number */}
              {f.input === 'number' && (
                <input
                  type="number"
                  value={String(getFieldValue(f) ?? '')}
                  onChange={(e) => setFieldValue(f, e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={f.placeholder}
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                />
              )}
              {/* input: value（プルダウン or 記述） */}
              {f.input === 'value' && (
                !customMode ? (
                  <select
                    value={isPresetValue ? valueStr : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') setCustomMode(true);
                      else if (v === '') onChange({ value: '' });
                      else if (v === 'all') onChange({ value: 'all' });
                      else onChange({ value: Number(v) });
                    }}
                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                  >
                    {RULE_VALUE_OPTS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
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
                      style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, minWidth: 0 }}
                    />
                    <button
                      onClick={() => { setCustomMode(false); onChange({ value: '' }); }}
                      title="プルダウンに戻す（値はクリア）"
                      style={{ padding: '0 6px', border: '1px solid #888', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}
                    >
                      ↺
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* === ルール条件: トリガー条件 / 発動条件と同じハイブリッドUI === */}
      {/* チェックボックス (色 / Lv / DP 等) + プルダウン (cond_picked_color 等の高度条件) */}
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

      {/* === ルール内 修飾子: このルール限定で適用される options === */}
      {/* 例: 「相手に見せて」をルール「手札に加える」に付与 → selections[].options に展開 */}
      {dict.options.length > 0 && (
        <details style={{ marginTop: 8 }} open={Array.isArray(step.options) && step.options.length > 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 12, color: '#1976d2', padding: '2px 0' }}>
            🛡 修飾子（このルールに限定）
            {Array.isArray(step.options) && step.options.length > 0 ? ` (${step.options.length})` : ''}
          </summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, border: '1px solid #d8e0f0', borderRadius: 4, background: '#f3f6fc', marginTop: 4 }}>
            {dict.options.map((o) => {
              const optsArr = step.options || [];
              const checked = optsArr.includes(o.code);
              const implemented = isOptionImplemented(o.code, o.logicCode);
              return (
                <label
                  key={o.code}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px',
                    border: checked ? '1px solid #3b6cd1' : '1px solid #c5cfe0',
                    borderRadius: 12,
                    background: checked ? '#dde7fb' : 'white',
                    cursor: 'pointer', fontSize: 11,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked ? optsArr.filter((x) => x !== o.code) : [...optsArr, o.code];
                      onChange({ options: next });
                    }}
                    style={{ margin: 0 }}
                  />
                  <span>{o.label}</span>
                  {implemented
                    ? <span style={{ color: '#2e7d32', fontSize: 9 }}>✅</span>
                    : <span style={{ color: '#e65100', fontSize: 9 }} title="エンジン未実装">⚠</span>}
                </label>
              );
            })}
          </div>
        </details>
      )}
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
}
// 値入力が不要な条件（チェック的な意味だけを持つ cond_xxx）。UIでプレースホルダを変える程度に使用
const NO_VALUE_CONDS = new Set([
  'cond_attack_target_player', 'cond_attack_target_digimon', 'cond_no_evo',
  'cond_jogress', 'cond_in_battle', 'cond_during_own_turn', 'cond_during_opp_turn',
  'cond_during_any_turn', 'cond_self_active', 'cond_self_rest', 'cond_opp_no_attack_this_turn',
  'cond_evolved_this_turn', 'cond_no_tamer_evo', 'cond_not_own_effect', 'cond_has_evo_digimon',
  'cond_attack_target_highest_dp', 'cond_attack_target_lowest_dp',
]);

// === 条件の「種別」を大分類(カテゴリ)+詳細(バリアント)の2段構成にする ===
// 色/タイプ/特徴/場所は 1カテゴリ=1コードの直接対応。
// Lv/DP/名前は複数コードがあるため、カテゴリ選択後に「以上/以下」等の
// バリアントプルダウンが追加で現れる。その他はカテゴリに無い全条件を選べる逃し弁。
type CondCategory = 'color' | 'type' | 'feature' | 'lv' | 'dp' | 'cost' | 'cost_mod' | 'name' | 'other' | '';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'color', label: '色' },
  { value: 'type', label: 'タイプ' },
  { value: 'feature', label: '特徴' },
  { value: 'lv', label: 'Lv' },
  { value: 'dp', label: 'DP' },
  { value: 'cost', label: 'コスト' },
  { value: 'cost_mod', label: 'コスト増減' },
  { value: 'name', label: '名前' },
  { value: 'other', label: 'その他' },
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
  cost_mod: 'cond_cost_mod',
  name: 'cond_name',
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
    { value: 'cond_attack_target_highest_dp', label: '最も高い（アタック対象専用）' },
    { value: 'cond_attack_target_lowest_dp', label: '最も低い（アタック対象専用）' },
  ],
  cost: [
    { value: 'cond_cost_ge', label: '以上' },
    { value: 'cond_cost_le', label: '以下' },
    { value: 'cond_cost', label: '完全一致' },
  ],
  name: [
    { value: 'cond_name', label: '完全一致' },
    { value: 'cond_name_contains', label: '含む' },
  ],
};

// 条件コード → カテゴリ の逆引き（既存レシピ読込時・行の見た目復元用）
function baseToCategory(base: string): CondCategory {
  if (!base) return '';
  if (base === 'cond_color') return 'color';
  if (base === 'cond_type') return 'type';
  if (base === 'cond_feature_contains' || base === 'cond_feature') return 'feature';
  if (base === 'cond_lv_ge' || base === 'cond_lv_le' || base === 'cond_lv') return 'lv';
  if (base === 'cond_dp_ge' || base === 'cond_dp_le' || base === 'cond_dp'
    || base === 'cond_attack_target_highest_dp' || base === 'cond_attack_target_lowest_dp') return 'dp';
  if (base === 'cond_cost_ge' || base === 'cond_cost_le' || base === 'cond_cost') return 'cost';
  if (base === 'cond_cost_mod') return 'cost_mod';
  if (base === 'cond_name' || base === 'cond_name_contains') return 'name';
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
  supportsMultiValue = false, attackContextActive = false,
  part = 'full', otherOpen: otherOpenProp, onOtherOpenChange, showCostMod = false,
}: ConditionsHybridEditorProps) {
  const colors = theme === 'trigger'
    ? { bg: '#e8f7e8', border: '#93c693', accent: '#1a5a1a', icon: '🔔' }
    : { bg: '#e8f0fe', border: '#93b5e5', accent: '#1a4f8a', icon: '🎯' };
  // DPの「最も高い/最も低い（アタック対象専用）」は、【アタック時】系のブロックでのみ意味を成すため
  // それ以外のときは選択肢から除外する
  const dpVariantOptions = (CATEGORY_VARIANTS.dp || []).filter((v) =>
    attackContextActive || (v.value !== 'cond_attack_target_highest_dp' && v.value !== 'cond_attack_target_lowest_dp')
  );
  // 対象の条件（supportsMultiValue）では「対象」ボタン側にデジモン/カード/テイマー等を
  // 既に選べるため、同じ役割の「タイプ」カテゴリはよく使う条件から除外して重複を避ける。
  // 「コスト増減」は登場/進化/消滅アクション選択時の発動条件でのみ意味を持つため、
  // showCostMod=true のとき以外は非表示にする
  const visibleCategoryOptions = CATEGORY_BUTTON_OPTIONS.filter((c) => {
    if (c.code === 'type' && supportsMultiValue) return false;
    if (c.code === 'cost_mod' && !showCostMod) return false;
    return true;
  });

  // 「その他」用: 色/タイプ/特徴/Lv/DP/名前として直接選べるコード群を除いた残り
  const CATEGORIZED_CODES = new Set<string>([
    'cond_color', 'cond_type', 'cond_feature_contains', 'cond_feature',
    'cond_lv_ge', 'cond_lv_le', 'cond_lv', 'cond_dp_ge', 'cond_dp_le', 'cond_dp',
    'cond_attack_target_highest_dp', 'cond_attack_target_lowest_dp',
    'cond_cost_ge', 'cond_cost_le', 'cond_cost', 'cond_cost_mod',
    'cond_name', 'cond_name_contains',
    // トリガーボックス側の専用「アタック対象」ボタンで管理するため、その他の追加候補にも出さない
    'cond_attack_target_player', 'cond_attack_target_digimon',
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
      <div style={{ fontSize: 10, color: '#666', margin: '2px 0 6px' }}>
        複数指定した場合はすべて AND（全部を満たしたときだけ発動）。
      </div>

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
                  {/* Lv/DP/名前: 「以上/以下/完全一致」等のバリアントボタン（コンテンツ幅のみ使用・空なら詰める） */}
                  {(cat.code === 'dp' ? dpVariantOptions : CATEGORY_VARIANTS[cat.code as CondCategory]) && (
                    <ButtonGroup
                      options={(cat.code === 'dp' ? dpVariantOptions : CATEGORY_VARIANTS[cat.code as CondCategory]!).map((v) => ({ code: v.value, label: v.label }))}
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
                    {cat.code === 'cost_mod' ? (
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
                      || (supportsMultiValue && c.base === 'cond_type') ? (
                      /* 「選んだデジモンと同じ」「タイプ(複数可・ターゲットフィルタ限定)」:
                         複数選択チェックボックス群（カンマ区切りで保存）。
                         カードは同時に複数タイプを持てないため、複数選択=常にOR判定でよい
                         （「紫のデジモンかオプション」はタイプで デジモン,オプション を両方チェックするだけで表現可能）
                         ※ cond_type の複数値は step.filter (type_in配列) でのみ解釈される。
                           トリガー条件/発動条件側は単一値exact-match想定なのでそちらでは使わないこと */
                      (() => {
                        const optList = c.base === 'cond_type' ? RULE_TYPE_OPTS.filter((o) => o.value).map((o) => ({ code: o.value, label: o.label }))
                          : SAME_AS_PICKED_FIELDS;
                        const sel = (c.value || '').split(',').map((s) => s.trim()).filter(Boolean);
                        const isCheckedAttr = (code: string) => sel.includes(code);
                        const toggleAttr = (code: string, on: boolean) => {
                          const next = on
                            ? Array.from(new Set([...sel, code]))
                            : sel.filter((s) => s !== code);
                          updateAt(i, { value: next.join(',') });
                        };
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, background: 'white' }}>
                            {optList.map((f) => (
                              <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={isCheckedAttr(f.code)}
                                  onChange={(e) => toggleAttr(f.code, e.target.checked)}
                                  style={{ margin: 0 }}
                                />
                                {f.label}
                              </label>
                            ))}
                          </div>
                        );
                      })()
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
                  {showSubjectSelector && (
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                      {(() => {
                        const curSub = COND_SUBJECT_CODE_TO_L1L2[c.subject || ''] || { l1: '', l2: '' };
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
                          if (!l1) { updateAt(i, { subject: undefined }); return; }
                          const l2 = curSub.l1 === l1 && curSub.l2 ? curSub.l2 : 'digimon';
                          updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[l1 + ':' + l2], ...clearIfRedundant(l2) });
                        };
                        const handleSubL2 = (l2: string) => {
                          updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':' + l2], ...clearIfRedundant(l2) });
                        };
                        // 自分+デジモンのときのみ「このカードを含めない」を選べる
                        // （含めない＝他の自分のデジモン。旧 other_own コードをそのまま使う）
                        const showIncludeSelfToggle = curSub.l1 === 'own' && curSub.l2 === 'digimon';
                        const excludeSelf = c.subject === 'other_own';
                        return (
                          <>
                            <ButtonGroup options={subjectL1Options} value={curSub.l1} onChange={handleSubL1} accentColor={colors.accent} />
                            {l2Options.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <ButtonGroup options={l2Options} value={curSub.l2} onChange={handleSubL2} accentColor={colors.accent} />
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
              );
            })}
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
                <input
                  type="text"
                  value={c.value || ''}
                  onChange={(e) => updateAt(i, { value: e.target.value })}
                  placeholder={NO_VALUE_CONDS.has(c.base) ? '（値不要）' : '（必要なら）'}
                  disabled={NO_VALUE_CONDS.has(c.base)}
                  style={{ width: 160, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>
              {showSubjectSelector && (
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                  {(() => {
                    const curSub = COND_SUBJECT_CODE_TO_L1L2[c.subject || ''] || { l1: '', l2: '' };
                    const l2Options = COND_SUBJECT_L2[curSub.l1] || [];
                    const handleSubL1 = (l1: string) => {
                      if (!l1) { updateAt(i, { subject: undefined }); return; }
                      const l2 = curSub.l1 === l1 && curSub.l2 ? curSub.l2 : 'digimon';
                      updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[l1 + ':' + l2] });
                    };
                    const handleSubL2 = (l2: string) => {
                      updateAt(i, { subject: COND_SUBJECT_L1L2_TO_CODE[curSub.l1 + ':' + l2] });
                    };
                    const showIncludeSelfToggle = curSub.l1 === 'own' && curSub.l2 === 'digimon';
                    const excludeSelf = c.subject === 'other_own';
                    return (
                      <>
                        <ButtonGroup options={COND_SUBJECT_L1} value={curSub.l1} onChange={handleSubL1} accentColor={colors.accent} />
                        {l2Options.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <ButtonGroup options={l2Options} value={curSub.l2} onChange={handleSubL2} accentColor={colors.accent} />
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
