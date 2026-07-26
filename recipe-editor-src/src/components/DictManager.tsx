import { useState } from 'react';
import type { DictAPI } from '../useDict';
import type { DictEntry, VisualTypeEntry } from '../types';
import { isActionImplemented, isKeywordImplemented, isConditionImplemented, isOptionImplemented } from '../implemented';
import { SearchSelect } from './SearchSelect';

export type DictKind = 'triggers' | 'conditions' | 'actions' | 'keywords' | 'options';
export type Tab = DictKind | 'visualTypes';

const KIND_LABELS: Record<DictKind, string> = {
  triggers: 'トリガー',
  conditions: '条件',
  actions: 'アクション',
  keywords: 'キーワード',
  options: '修飾子',
};

// 日本語名から英語コードを推測
// 注意: 長いフレーズが先に match されるよう、suggestCode 内で sort されている
const TOKEN_MAP: Record<string, string> = {
  // === 修飾子フレーズ（option） ===
  'コストを支払わず': 'ignore_cost',
  '効果を発揮せず': 'without_effect',
  '発揮せず': 'without_effect',
  '元の名称': 'as_original',
  '元の': 'as_original',
  '裏向き': 'face_down',
  '表向き': 'face_up',
  '相手に見せ': 'reveal',
  'デジクロスせず': 'without_digicross',
  '任意': 'optional',
  'してもよい': 'optional',
  '支払わず': 'no_cost',
  // 「次の1回」「次に〜するとき」を once_only に集約
  '次の1回限定': 'once_only',
  '次の1回': 'once_only',
  '次に1回': 'once_only',
  '1回限定': 'once_only',
  '1回のみ': 'once_only',
  // 「その後」= 前ステップ失敗でも次を実行
  'その後': 'continue_on_fail',
  '前失敗でも実行': 'continue_on_fail',

  // === 条件フレーズ（cond_ プレフィックス自動付与なので "cond_" を含めない） ===
  '進化元にデジモンカードを持つ': 'has_evo_digimon',
  '進化元を持たない': 'no_evo',
  '進化元を持つ': 'has_evo',
  // 進化先（進化後）の Lv / 色 / タイプ を判定する条件群
  '進化先のLv': 'evolve_to_lv',
  '進化先Lv': 'evolve_to_lv',
  '進化後のLv': 'evolve_to_lv',
  '進化後Lv': 'evolve_to_lv',
  '進化先の色': 'evolve_to_color',
  '進化後の色': 'evolve_to_color',
  '進化先のタイプ': 'evolve_to_type',
  '進化後のタイプ': 'evolve_to_type',
  'ジョグレス進化していたなら': 'jogress',
  'デジクロスしていたなら': 'digicross',
  'このターンに進化させて': 'evolved_this_turn',
  'このターンに進化': 'evolved_this_turn',
  'レスト状態のデジモンが': 'rest_count',
  '相手のデジモンがいる': 'opp_exists',
  '自分のデジモンがいる': 'own_exists',
  '他のデジモンがいる': 'other_exists',
  'メモリーが相手側': 'memory_opponent',
  '相手のターン中': 'during_opp_turn',
  '自分のターン中': 'during_own_turn',
  'バトルしている間': 'in_battle',
  'リンク状態': 'link_state',
  'リンク条件を満たす': 'link_eligible',
  'アセンブリ条件を満たす': 'assembly_eligible',
  '進化元にテイマーカードが無い': 'no_tamer_evo',
  '自分の効果以外': 'not_own_effect',
  '名称に含む': 'name_contains',
  '特徴に含む': 'feature_contains',
  '指定キーワード': 'self_keyword',
  '指定特徴': 'feature',
  '指定色': 'color',
  '相手がアタックしていない': 'opp_no_attack_this_turn',
  'アクティブの間': 'self_active',

  // === トリガー / 持続 フレーズ ===
  'アタック時': 'on_attack',
  'アタック終了時': 'on_attack_end',
  '登場時': 'on_play',
  '進化時': 'on_evolve',
  '消滅時': 'on_destroy',
  'バトル勝利時': 'on_battle_win',
  'バトルで消滅したとき': 'on_battle_destroy',
  '消滅するとき': 'when_destroy',
  'ブロックされたとき': 'when_blocked',
  'アタックされたとき': 'when_attacked',
  'レストしたとき': 'when_rest',
  'バトルエリアを離れるとき': 'when_leave_battle',
  'セキュリティが減ったとき': 'when_security_decrease',
  '手札に戻ったとき': 'when_return_to_hand',
  'アタック対象が変更されたとき': 'when_target_changed',
  '自分のデジモンが消滅したとき': 'when_own_destroyed',
  '他のデジモンが消滅したとき': 'when_other_destroyed',
  '相手のデジモンが消滅したとき': 'when_opp_destroyed',
  '自分のブロッカーがレストしたとき': 'when_own_block',
  '相手のデジモンがレストしたとき': 'when_opp_rest',
  '自分のターン開始時': 'on_own_turn_start',
  '自分のターン終了時': 'on_own_turn_end',
  '相手のターン開始時': 'on_opp_turn_start',
  '相手のターン終了時': 'on_opp_turn_end',
  'メインフェイズ開始時': 'on_main_phase_start',
  '相手のメインフェイズ開始時': 'on_opp_main_phase_start',
  'メインフェイズ中': 'main',
  'お互いのターン': 'during_any_turn',
  '自分のターン': 'during_own_turn',
  '相手のターン': 'during_opp_turn',

  // === アクション フレーズ（フレーズ優先・長い順に並べる） ===
  'セキュリティの中身を確認': 'security_open',
  'セキュリティの内容を確認': 'security_open',
  'セキュリティを全て確認': 'security_open',
  'セキュリティを確認': 'security_open',
  'セキュリティをシャッフル': 'security_shuffle',
  'セキュリティを公開': 'security_open',
  'セキュリティをオープン': 'security_open',
  'デッキをシャッフル': 'deck_shuffle',
  'デッキを公開': 'deck_open',
  'リカバリー+': 'recover',
  'リカバリー': 'recover',
  '回復する': 'recover',
  '相手に見せて手札に加える': 'add_to_hand_reveal',
  // 育成・デジタマ系
  'デジタマカードを孵化': 'hatch',
  'デジタマを孵化': 'hatch',
  '孵化させる': 'hatch',
  '孵化する': 'hatch',
  '孵化': 'hatch',
  'デジタマカード': 'digi_egg',
  'デジタマ': 'digi_egg',
  '育成エリア': 'breeding_area',
  '進化元から登場': 'summon_from_evo_source',
  '進化元のカードを選ぶ': 'select_evo_source',
  '進化元を破棄': 'evo_discard',
  '進化元の下から破棄': 'evo_discard_bottom',
  '進化元に置く': 'add_to_evo_source',
  'セキュリティの上から破棄': 'security_trash_top',
  'セキュリティの下から破棄': 'security_trash_bottom',
  'セキュリティを選んで破棄': 'security_trash_select',
  'デッキの上からオープン': 'deck_open',
  'デッキの上から破棄': 'deck_trash_top',
  'デッキに戻す': 'return_deck',
  '手札に戻す': 'bounce',
  '手札に加える': 'add_to_hand',
  '手札を捨てる': 'cost_discard',
  'トラッシュから登場': 'summon_from_trash',
  'トラッシュから手札': 'trash_to_hand',
  'プレイヤーにアタック': 'attack_player',
  'デジモンにアタック': 'attack_digimon',
  'アタック対象を変更': 'change_attack_target',
  'キーワードを得る': 'grant_keyword',
  'キーワードを与える': 'grant_keyword_to',
  '効果で消滅しない': 'prevent_destroy',
  'バトルで消滅しない': 'prevent_battle_destroy',
  'テイマーの下に置く': 'place_under_tamer',
  '進化元の下に置く': 'place_under_digimon',
  'ジョグレス進化': 'jogress_evolve',
  'ブロックさせる': 'force_block',
  '効果を受けない': 'immune_effects',
  'セキュリティチェックをする': 'do_security_check',
  '1体選ぶ': 'select',
  'N体まで選ぶ': 'select_multi',
  'メイン効果を発揮': 'use_main_effect',
  'レストせずにアタック': 'attack_without_rest',
  'アタックとブロックができない': 'cant_attack_block',
  'デジバースト': 'cost_digiburst',
  'ブロックできない': 'cant_block',
  'アタックできない': 'cant_attack',
  '進化できない': 'cant_evolve',
  'Sアタックを+': 'security_attack_plus',
  'Sアタックを-': 'security_attack_minus',
  'メモリーを+': 'memory_plus',
  'メモリーを-': 'memory_minus',
  'DPを+': 'dp_plus',
  'DPを-': 'dp_minus',

  // === キーワード フレーズ ===
  'ブロッカー': 'blocker',
  '貫通': 'penetrate',
  '突進': 'piercing',
  '速攻': 'rush',
  'ジャミング': 'jamming',
  '再起動': 'reboot',
  '道連れ': 'michizure',
  'アーマー解除': 'armor_break',
  '回避': 'evade',
  '防壁': 'barrier',
  '不屈': 'indomitable',
  '連携': 'combo',
  '衝突': 'collision',

  // === 残りの構成要素（短い汎用トークン） ===
  '消滅': 'destroy', '破棄': 'discard', '破壊': 'destroy', '登場': 'summon',
  '進化': 'evolve', '退化': 'dedigivolve', 'レスト': 'rest', 'アクティブ': 'active',
  '回復': 'recover', 'ドロー': 'draw', '手札': 'hand', 'トラッシュ': 'trash',
  'デッキ': 'deck', 'セキュリティ': 'security', 'バトルエリア': 'battle_area',
  '進化元': 'evo', 'テイマー': 'tamer', 'DP': 'dp', 'メモリー': 'memory',
  'コスト': 'cost', 'Lv': 'lv', 'レベル': 'lv', '上から': 'top', '下から': 'bottom',
  '効果': 'effect', '相手': 'opp', '自分': 'own', 'プレイヤー': 'player',
  'デジモン': 'digimon',
  'ターン': 'turn',
  'ジョグレス': 'jogress',
  'デジクロス': 'digicross',
  '他': 'other', '全': 'all',
  '+': '_plus', '＋': '_plus', '-': '_minus', '−': '_minus',
  '以上': '_ge', '以下': '_le',
  '与え': 'grant', '得': 'gain',
  'ブロック': 'block', 'アタック': 'attack', '選': 'select', '戻': 'bounce',
  'カード': '', // skip
  // === Phase 2 追加トークン（汎用語・カードテキスト頻出） ===
  'シャッフル': 'shuffle',
  'オープン': 'open',
  '公開': 'reveal',
  '確認': 'reveal',     // 「内容を確認する」= privately check, reveal フレーズ流用
  '見せ': 'reveal',
  '加える': 'add',
  '加え': 'add',
  '置く': 'place',
  '置': 'place',
  '入れる': 'put',
  '名称': 'name',
  '名前': 'name',
  '色': 'color',
  '特徴': 'feature',
  'タイプ': 'type',
  'キーワード': 'keyword',
  '修飾子': 'option',
  '条件': 'cond',
  '選んだ': 'picked',
  '選択した': 'picked',
  '直前': 'prev',
  '可能': 'eligible',
  'できない': 'cant',
  'できる': 'can',
  'させる': 'make',
  '無効': 'disable',
  '有効': 'enable',
  '同じ': 'same',
  'ごと': 'per',
  '体': '',  // 「N体」の体はノイズなので skip
  '枚': '',  // 「N枚」の枚は skip
  '回': '',  // 「1回」の回は skip
  // '持つ' は文脈次第で誤訳が多いため削除（持つ単体ではトークンを生成しない）
};

// 全 dict ラベルから、入力 label と完全一致するエントリのコードを返す
// 既存エントリの再入力時に最高精度で suggest するためのショートカット
export function findExactDictMatch(label: string, dict?: DictAPI): string | null {
  if (!dict) return null;
  const all: { code: string; label: string }[] = [
    ...dict.triggers, ...dict.conditions, ...dict.actions, ...dict.keywords, ...dict.options,
  ];
  const norm = label.trim();
  const hit = all.find((e) => e.label === norm);
  return hit ? hit.code : null;
}

export function suggestCode(label: string, kind: Tab, dict?: DictAPI): string {
  // 1) 既存 dict ラベル完全一致 → そのコードを返す（最高精度）
  const exact = findExactDictMatch(label, dict);
  if (exact) return exact;

  const prefix = kind === 'conditions' ? 'cond_' : '';
  // 数字は保持（Lv.4 / N体 等の文字列はトークン化対象外なので段階的に消費される）
  const clean = label.trim();
  const keys = Object.keys(TOKEN_MAP).sort((a, b) => b.length - a.length);
  const tokens: string[] = [];
  let working = clean;
  let safety = 0;
  // safety を文字数連動に拡張（旧 60 だと長い表示名で枯渇）
  const limit = clean.length * 2 + 20;
  while (working.length > 0 && safety++ < limit) {
    let matched = false;
    for (const k of keys) {
      if (working.indexOf(k) === 0) {
        if (TOKEN_MAP[k]) tokens.push(TOKEN_MAP[k]);
        working = working.substring(k.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // サロゲートペア配慮: 先頭1コードポイントだけ skip
      // 数字も skip（既にトークン化されないため）
      const cp = working.codePointAt(0);
      const skipLen = cp && cp > 0xFFFF ? 2 : 1;
      working = working.substring(skipLen);
    }
  }
  const dedup: string[] = [];
  tokens.forEach((t) => {
    if (dedup[dedup.length - 1] !== t) dedup.push(t);
  });
  let stem = dedup.join('_').replace(/^_+|_+$/g, '').replace(/_+/g, '_') || 'custom';
  return prefix + stem;
}

export function suggestVisualType(code: string): { visualType: string; visualCode: string; frameColor: string; valueLabel: string } {
  const lc = code.toLowerCase();
  if (/(_plus)$/.test(lc)) return { visualType: '数値ポップアップ+', visualCode: 'popup_plus', frameColor: '緑', valueLabel: '増減値' };
  if (/(_minus)$/.test(lc)) return { visualType: '数値ポップアップ-', visualCode: 'popup_minus', frameColor: '赤', valueLabel: '増減値' };
  if (/destroy/.test(lc)) return { visualType: '消滅演出', visualCode: 'card_destroy', frameColor: '赤', valueLabel: '体数' };
  if (/draw/.test(lc)) return { visualType: 'ドロー演出', visualCode: 'draw_card', frameColor: 'シアン', valueLabel: '枚数' };
  if (/summon/.test(lc)) return { visualType: 'カード登場', visualCode: 'card_appear', frameColor: '緑', valueLabel: '' };
  if (/(bounce|return|add_to_hand|trash_to_hand|move|recover|deck_open|deck_trash|evo_discard)/.test(lc))
    return { visualType: 'カード移動', visualCode: 'card_move', frameColor: 'シアン', valueLabel: '枚数' };
  if (/(grant|cant_|immune|prevent_)/.test(lc)) return { visualType: '状態付与演出', visualCode: 'buff_status', frameColor: '紫', valueLabel: '' };
  if (/dedigivolve/.test(lc)) return { visualType: '退化演出', visualCode: 'dedigivolve', frameColor: '黄', valueLabel: '枚数' };
  if (/security_attack/.test(lc)) {
    const minus = /_minus/.test(lc);
    return { visualType: minus ? 'Sアタック-' : 'Sアタック+', visualCode: minus ? 'sattack_minus' : 'sattack_plus', frameColor: minus ? '赤' : '緑', valueLabel: '枚数' };
  }
  if (/^rest$/.test(lc)) return { visualType: 'レスト演出', visualCode: 'rest_card', frameColor: 'オレンジ', valueLabel: '' };
  if (/^active$/.test(lc)) return { visualType: 'アクティブ演出', visualCode: 'active_card', frameColor: '緑', valueLabel: '' };
  if (/jogress/.test(lc)) return { visualType: 'ジョグレス進化', visualCode: 'jogress_evolve', frameColor: '黄', valueLabel: '' };
  return { visualType: 'なし', visualCode: 'none', frameColor: 'なし', valueLabel: '' };
}

export function suggestAutoManual(code: string): string {
  const lc = code.toLowerCase();
  if (/^(select|select_multi|pick|place_|jogress|app_gattai|link|unlink)/.test(lc)) return '手動';
  if (/(cost_discard|cost_trash|cost_digiburst|cost_destroy_other|return_deck|add_to_hand|security_trash_select)/.test(lc)) return '手動';
  if (/^(destroy|bounce|rest|cant_|evo_discard$)/.test(lc)) return '手動';
  if (/dedigivolve/.test(lc)) return '自動（対象選択は手動）';
  if (/(dp_|memory_)/.test(lc) && /(plus|minus)/.test(lc)) return '自動（対象選択は手動）';
  return '自動';
}

export function DictManager({ dict, onClose }: { dict: DictAPI; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('actions');
  const [msg, setMsg] = useState('');

  function tabBtnStyle(tab: Tab): React.CSSProperties {
    return {
      ...btn(),
      background: activeTab === tab ? '#1976d2' : 'white',
      color: activeTab === tab ? 'white' : '#222',
    };
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>📚 辞書管理 {dict.loading && <span style={{ fontSize: 12, color: '#888' }}>（読込中...）</span>}</h2>
        <span>
          <button
            onClick={() => {
              const text = buildUnimplementedReport(dict);
              navigator.clipboard.writeText(text);
              setMsg('✅ 未実装一覧をクリップボードにコピーしました（Claudeに貼り付けてください）');
            }}
            style={{ ...btn(), background: '#fff3e0', borderColor: '#e65100', color: '#e65100' }}
          >
            ⚠ 未実装一覧をClaude用にコピー
          </button>
          <button onClick={() => dict.refresh()} disabled={dict.loading} style={btn()}>🔄 スプシから再取得</button>
          <button onClick={onClose} style={btn()}>← エディタに戻る</button>
        </span>
      </div>
      {dict.error && <div style={{ padding: 6, background: '#ffebee', borderRadius: 4, marginBottom: 8, fontSize: 12, color: '#c62828' }}>⚠ {dict.error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #ddd', paddingBottom: 8, flexWrap: 'wrap' }}>
        {(Object.keys(KIND_LABELS) as DictKind[]).map((k) => (
          <button key={k} onClick={() => setActiveTab(k)} style={tabBtnStyle(k)}>
            {KIND_LABELS[k]}（{dict[k].length}）
          </button>
        ))}
        <button onClick={() => setActiveTab('visualTypes')} style={tabBtnStyle('visualTypes')}>
          🎬 演出タイプ（{dict.visualTypes.length}）
        </button>
      </div>

      {msg && <div style={{ padding: 6, background: '#e8f5e9', borderRadius: 4, marginBottom: 8, fontSize: 12 }}>{msg}</div>}

      {activeTab === 'visualTypes' ? (
        <VisualTypePanel dict={dict} setMsg={setMsg} />
      ) : (
        <KindPanel dict={dict} kind={activeTab} setMsg={setMsg} />
      )}
    </div>
  );
}

function KindPanel({ dict, kind, setMsg }: { dict: DictAPI; kind: DictKind; setMsg: (s: string) => void }) {
  const isActionOrKeyword = kind === 'actions' || kind === 'keywords';
  const hasImplBadge = isActionOrKeyword || kind === 'conditions' || kind === 'options';
  const [form, setForm] = useState<DictEntry>({ code: '', kind: kindToSingular(kind), label: '' });
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<'all' | 'implemented' | 'unimplemented'>('all');
  const [searchQ, setSearchQ] = useState('');

  function checkImpl(e: DictEntry): boolean {
    if (kind === 'actions') return isActionImplemented(e.code, e.logicCode);
    if (kind === 'keywords') return isKeywordImplemented(e.code);
    if (kind === 'options') return isOptionImplemented(e.code, e.logicCode);
    if (kind === 'conditions') return isConditionImplemented(e.code);
    return true;
  }

  const fullList = dict[kind];
  const list = fullList.filter((e) => {
    // 検索フィルタ
    if (searchQ) {
      const q = searchQ.toLowerCase();
      const hay = (e.code + ' ' + e.label + ' ' + (e.description || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // 実装ステータス フィルタ
    if (filter !== 'all' && hasImplBadge) {
      const impl = checkImpl(e);
      if (filter === 'implemented' && !impl) return false;
      if (filter === 'unimplemented' && impl) return false;
    }
    return true;
  });

  // 実装ステータスサマリー（全件ベース）
  const implCount = hasImplBadge ? fullList.filter(checkImpl).length : 0;
  const unimplCount = hasImplBadge ? fullList.length - implCount : 0;

  function update(patch: Partial<DictEntry>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  // 日本語名は IME 確定の有無を問わず単に label を更新するだけ。
  // コード自動推測は明示的にボタンを押した時だけ実行（IME composition で毎打鍵書き換わるのを回避）
  function onLabelChange(label: string) {
    update({ label });
  }

  function onCodeChange(code: string) {
    let auto: Partial<DictEntry> = { code };
    if (isActionOrKeyword) {
      const v = suggestVisualType(code);
      auto = { ...auto, ...v, autoManual: suggestAutoManual(code) };
    }
    update(auto);
  }

  // 「🔄 推測」ボタンで明示的に日本語名→コード変換 + 演出メタデータ自動入力
  function autoSuggestCode() {
    if (!form.label) {
      setMsg('❌ 先に日本語名を入力してください');
      return;
    }
    const code = suggestCode(form.label, kind, dict);
    let auto: Partial<DictEntry> = { code };
    if (isActionOrKeyword) {
      const v = suggestVisualType(code);
      auto = { ...auto, ...v, autoManual: suggestAutoManual(code) };
    }
    update(auto);
  }

  async function handleAdd() {
    if (!form.label || !form.code) {
      setMsg('❌ 日本語名とコードは必須');
      return;
    }
    setSubmitting(true);
    setMsg('💾 スプシに書き込み中...');
    try {
      const r = await dict.addEntry(kind, { ...form, kind: kindToSingular(kind) });
      if (r.ok) {
        setMsg('✅ スプシに保存: ' + form.code);
        setForm({ code: '', kind: kindToSingular(kind), label: '' });
      } else {
        setMsg('❌ ' + (r.msg || '追加失敗'));
      }
    } catch (e: any) {
      setMsg('❌ 通信エラー: ' + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(code: string) {
    if (!confirm('「' + code + '」をスプシから削除します。よろしいですか？')) return;
    setMsg('💾 削除中...');
    try {
      const r = await dict.removeEntry(kind, code);
      if (r.ok) setMsg('✅ 削除: ' + code);
      else setMsg('❌ ' + (r.msg || '削除失敗'));
    } catch (e: any) {
      setMsg('❌ 通信エラー: ' + (e?.message || e));
    }
  }

  async function handleEditLabel(entry: DictEntry) {
    const newLabel = prompt('新しい表示名（コード「' + entry.code + '」）:', entry.label);
    if (newLabel === null) return; // cancel
    if (!newLabel.trim()) {
      setMsg('❌ 表示名を空にできません');
      return;
    }
    if (newLabel.trim() === entry.label) return; // 変更なし
    setMsg('💾 更新中...');
    try {
      const r = await dict.updateEntry(kind, entry.code, { label: newLabel.trim() });
      if (r.ok) setMsg('✅ 表示名を更新: ' + entry.code + ' → 「' + newLabel.trim() + '」');
      else setMsg('❌ ' + (r.msg || '更新失敗'));
    } catch (e: any) {
      setMsg('❌ 通信エラー: ' + (e?.message || e));
    }
  }

  return (
    <>
      <div style={panel()}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>＋ 新規追加（{KIND_LABELS[kind]}）</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field">
            <label>日本語名 *</label>
            <input
              type="text"
              value={form.label || ''}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="例: メモリーがN以上の間"
            />
          </div>
          <div className="field">
            <label>コード *</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={form.code || ''}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="cond_xxx"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={autoSuggestCode}
                disabled={!form.label}
                title="日本語名から推測してコードを埋める（既存コードは上書き）"
                style={{
                  ...btn(),
                  whiteSpace: 'nowrap',
                  background: form.label ? '#e3f2fd' : '#f0f0f0',
                  borderColor: form.label ? '#1976d2' : '#aaa',
                  color: form.label ? '#1976d2' : '#888',
                  cursor: form.label ? 'pointer' : 'not-allowed',
                }}
              >
                🔄 推測
              </button>
            </div>
          </div>
          <div className="field" style={{ gridColumn: '1 / span 2' }}>
            <label>説明</label>
            <input type="text" value={form.description || ''} onChange={(e) => update({ description: e.target.value })} placeholder="任意" />
          </div>

          {isActionOrKeyword && (
            <>
              <div className="field">
                <label>演出タイプ *</label>
                <SearchSelect
                  value={form.visualType || ''}
                  onChange={(v) => {
                    // 演出タイプ選択時、対応する演出コード・デフォルト枠色を自動入力
                    const vt = dict.visualTypes.find((x) => x.label === v);
                    const patch: Partial<DictEntry> = { visualType: v };
                    if (vt) {
                      patch.visualCode = vt.code;
                      // 枠色は未入力時のみ自動入力（既に入力済なら上書きしない）
                      if (!form.frameColor && vt.defaultColor) patch.frameColor = vt.defaultColor;
                    }
                    update(patch);
                  }}
                  options={dict.visualTypes.map((vt) => ({ value: vt.label, label: vt.label }))}
                  allowFreeText
                />
              </div>
              <div className="field">
                <label>演出コード</label>
                <input type="text" value={form.visualCode || ''} onChange={(e) => update({ visualCode: e.target.value })} placeholder="popup_plus" />
              </div>
              <div className="field">
                <label>自動/手動 *</label>
                <select value={form.autoManual || '自動'} onChange={(e) => update({ autoManual: e.target.value })}>
                  <option value="自動">自動</option>
                  <option value="手動">手動</option>
                  <option value="自動（対象選択は手動）">自動（対象選択は手動）</option>
                </select>
              </div>
              <div className="field">
                <label>枠色</label>
                <input type="text" value={form.frameColor || ''} onChange={(e) => update({ frameColor: e.target.value })} placeholder="緑/赤/シアン..." />
              </div>
              <div className="field">
                <label>数値の意味</label>
                <input type="text" value={form.valueLabel || ''} onChange={(e) => update({ valueLabel: e.target.value })} placeholder="増減値/枚数/体数" />
              </div>
              <div className="field">
                <label>手動操作の説明</label>
                <input type="text" value={form.manualDesc || ''} onChange={(e) => update({ manualDesc: e.target.value })} placeholder="対象をタップ選択 等" />
              </div>
              {kind === 'actions' && (
                <>
                  <div className="field" style={{ gridColumn: '1 / span 2' }}>
                    <label>ロジックコード（既存実装を流用する場合）</label>
                    <input
                      type="text"
                      value={form.logicCode || ''}
                      onChange={(e) => update({ logicCode: e.target.value })}
                      placeholder="例: dp_plus（このアクションを既存 dp_plus ロジックで動かす）"
                    />
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      💡 空欄なら自身のコードでロジック実行。既存実装のバリエーションなら既存コードを指定。
                    </div>
                  </div>
                  <div className="field" style={{ gridColumn: '1 / span 2' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!form.allowsRules}
                        onChange={(e) => update({ allowsRules: e.target.checked })}
                      />
                      <b>☑ ルール追加する（このアクションを選ぶとレシピエディタで「+ ルール」が表示される）</b>
                    </label>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                      💡 「デッキオープン」のように、メインアクションの実行結果に対して追加処理をぶら下げる必要があるアクションだけ ☑ してください。
                      ルール本体（アクション+対象+値+条件）はレシピ作成時にカード毎に入れます。
                    </div>
                  </div>
                  <div className="field" style={{ gridColumn: '1 / span 2' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!form.hasPositionVariant}
                        onChange={(e) => update({ hasPositionVariant: e.target.checked })}
                      />
                      <b>📍 位置を指定する（上から/下から/選んで）</b>
                    </label>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                      💡 「セキュリティを破棄」「進化元を破棄」など、対象の位置（上/下/選んで）を選ぶ必要があるアクションだけ ☑ してください。
                      レシピエディタで本アクション選択時に「📍 位置」プルダウンが出現し、保存時のJSONコードに <code>_top</code> / <code>_bottom</code> / <code>_select</code> が自動付与されます。
                    </div>
                  </div>
                </>
              )}
              {kind === 'keywords' && (
                <div className="field" style={{ gridColumn: '1 / span 2' }}>
                  <label>
                    <input type="checkbox" checked={!!form.isPassive} onChange={(e) => update({ isPassive: e.target.checked })} />
                    {' '}passive flag として動作する（常時持続キーワード）
                  </label>
                </div>
              )}

              {/* 実装ステータス表示 */}
              {form.code && (
                <div className="field" style={{ gridColumn: '1 / span 2' }}>
                  <ImplStatusBadge kind={kind} code={form.code} logicCode={form.logicCode} />
                </div>
              )}
            </>
          )}

          {/* 修飾子: ロジックコード + 実装ステータス（演出系は不要） */}
          {kind === 'options' && (
            <>
              <div className="field" style={{ gridColumn: '1 / span 2' }}>
                <label>ロジックコード（既存実装を流用する場合）</label>
                <input
                  type="text"
                  value={form.logicCode || ''}
                  onChange={(e) => update({ logicCode: e.target.value })}
                  placeholder="例: ignore_cost（このコードを既存修飾子として動かす）"
                />
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  💡 空欄なら自身のコードでロジック実行。「このカードでは」等の言い換えなら既存コードを指定。
                </div>
              </div>
              {form.code && (
                <div className="field" style={{ gridColumn: '1 / span 2' }}>
                  <ImplStatusBadge kind={kind} code={form.code} logicCode={form.logicCode} />
                </div>
              )}
            </>
          )}

          <div style={{ gridColumn: '1 / span 2', textAlign: 'right' }}>
            <button onClick={handleAdd} disabled={submitting} style={{ ...btn(), background: '#1976d2', color: 'white' }}>
              {submitting ? '保存中...' : '➕ スプシに追加'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
          💡 日本語名を入力後、「🔄 推測」ボタンでコードを自動生成します。
          {isActionOrKeyword && '演出タイプ・自動/手動・枠色・数値の意味もコードから推測されます。'}
          推測後の手動調整も可能です。
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>
            {KIND_LABELS[kind]} 一覧（{list.length}{list.length !== fullList.length ? ` / 全${fullList.length}` : ''}件）
          </h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="🔍 コード・名前で検索"
              style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: 180 }}
            />
            {hasImplBadge && (
              <>
                <button
                  onClick={() => setFilter('all')}
                  style={{ ...btn(), background: filter === 'all' ? '#1976d2' : 'white', color: filter === 'all' ? 'white' : '#222' }}
                >
                  全件（{fullList.length}）
                </button>
                <button
                  onClick={() => setFilter('implemented')}
                  style={{ ...btn(), background: filter === 'implemented' ? '#2e7d32' : 'white', color: filter === 'implemented' ? 'white' : '#222' }}
                >
                  ✅実装済（{implCount}）
                </button>
                <button
                  onClick={() => setFilter('unimplemented')}
                  style={{ ...btn(), background: filter === 'unimplemented' ? '#e65100' : 'white', color: filter === 'unimplemented' ? 'white' : '#222' }}
                >
                  ⚠未実装（{unimplCount}）
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f0f4f8', position: 'sticky', top: 0 }}>
                <th style={th()}>コード</th>
                <th style={th()}>日本語名</th>
                {kind === 'actions' && <th style={th()}>フラグ</th>}
                {isActionOrKeyword && <th style={th()}>演出タイプ</th>}
                {isActionOrKeyword && <th style={th()}>自動/手動</th>}
                {hasImplBadge && <th style={th()}>エンジン</th>}
                <th style={th()}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.code} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td('mono')}>{e.code}</td>
                  <td style={td()}>{e.label}</td>
                  {kind === 'actions' && (
                    <td style={td()}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {e.allowsRules && (
                          <span
                            style={{ display: 'inline-block', padding: '2px 6px', background: '#e3f2fd', color: '#1976d2', border: '1px solid #93b5e5', borderRadius: 10, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' }}
                            title="このアクション選択時に「+ ルール」を表示"
                          >
                            📐 ルール
                          </span>
                        )}
                        {e.hasPositionVariant && (
                          <span
                            style={{ display: 'inline-block', padding: '2px 6px', background: '#fff3e0', color: '#b76e00', border: '1px solid #ffd591', borderRadius: 10, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' }}
                            title="このアクション選択時に「📍 位置」プルダウンを表示"
                          >
                            📍 位置
                          </span>
                        )}
                        {!e.allowsRules && !e.hasPositionVariant && (
                          <span style={{ color: '#bbb', fontSize: 11 }}>-</span>
                        )}
                      </span>
                    </td>
                  )}
                  {isActionOrKeyword && <td style={td()}>{e.visualType || '-'}</td>}
                  {isActionOrKeyword && <td style={td()}>{e.autoManual || '-'}</td>}
                  {hasImplBadge && <td style={td()}><ImplBadgeSmall kind={kind} code={e.code} logicCode={e.logicCode} /></td>}
                  <td style={td()}>
                    <button onClick={() => handleEditLabel(e)} style={{ ...btn(), fontSize: 11, marginRight: 4 }}>✏ 編集</button>
                    <button onClick={() => handleRemove(e.code)} style={{ ...btn(), borderColor: '#d33', color: '#d33', fontSize: 11 }}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function VisualTypePanel({ dict, setMsg }: { dict: DictAPI; setMsg: (s: string) => void }) {
  const [form, setForm] = useState<VisualTypeEntry>({ code: '', label: '' });
  const customCodes = new Set(dict.customVisualTypes.map((v) => v.code));

  function handleAdd() {
    if (!form.label || !form.code) {
      setMsg('❌ コードと表示名は必須');
      return;
    }
    if (dict.addVisualType(form)) {
      setMsg('✅ 追加: ' + form.code);
      setForm({ code: '', label: '' });
    } else {
      setMsg('❌ 重複の可能性');
    }
  }

  return (
    <>
      <div style={panel()}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>＋ 新規 演出タイプ追加</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field">
            <label>表示名 *</label>
            <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="例: 凍結演出" />
          </div>
          <div className="field">
            <label>コード *</label>
            <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例: freeze_card" />
          </div>
          <div className="field" style={{ gridColumn: '1 / span 2' }}>
            <label>演出内容（実装ガイド）</label>
            <textarea
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="例: カードに氷のオーバーレイを乗せて、3秒後にフェードアウト"
            />
          </div>
          <div className="field">
            <label>デフォルト枠色</label>
            <input type="text" value={form.defaultColor || ''} onChange={(e) => setForm({ ...form, defaultColor: e.target.value })} placeholder="水色/緑/赤..." />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={handleAdd} style={{ ...btn(), background: '#1976d2', color: 'white' }}>追加</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>演出タイプ 一覧（{dict.visualTypes.length}件）</h3>
        <div style={{ maxHeight: 400, overflowY: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f0f4f8', position: 'sticky', top: 0 }}>
                <th style={th()}>コード</th>
                <th style={th()}>表示名</th>
                <th style={th()}>演出内容</th>
                <th style={th()}>枠色</th>
                <th style={th()}>区分</th>
                <th style={th()}>操作</th>
              </tr>
            </thead>
            <tbody>
              {dict.visualTypes.map((v) => (
                <tr key={v.code} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td('mono')}>{v.code}</td>
                  <td style={td()}>{v.label}</td>
                  <td style={td()}>{v.description || '-'}</td>
                  <td style={td()}>{v.defaultColor || '-'}</td>
                  <td style={td()}>
                    {customCodes.has(v.code) ? <span style={{ color: '#1976d2' }}>カスタム</span> : <span style={{ color: '#888' }}>標準</span>}
                  </td>
                  <td style={td()}>
                    {customCodes.has(v.code) ? (
                      <button onClick={() => dict.removeVisualType(v.code)} style={{ ...btn(), borderColor: '#d33', color: '#d33', fontSize: 11 }}>削除</button>
                    ) : <span style={{ color: '#aaa', fontSize: 11 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// 実装ステータス バッジ（フォーム内・大型）
function ImplStatusBadge({ kind, code, logicCode }: { kind: DictKind; code: string; logicCode?: string }) {
  if (kind !== 'actions' && kind !== 'keywords' && kind !== 'options') return null;
  const implemented = kind === 'actions' ? isActionImplemented(code, logicCode)
                    : kind === 'keywords' ? isKeywordImplemented(code)
                    : isOptionImplemented(code, logicCode);
  if (implemented) {
    return (
      <div style={{ padding: 8, background: '#e8f5e9', borderRadius: 4, color: '#2e7d32', fontSize: 12 }}>
        ✅ <b>エンジン実装済</b>{logicCode ? `（既存ロジック「${logicCode}」を流用）` : ''}<br/>
        <span style={{ fontSize: 11 }}>このまま追加 → 次回バトル起動時に自動認識されます</span>
      </div>
    );
  }
  return (
    <div style={{ padding: 8, background: '#fff3e0', borderRadius: 4, color: '#e65100', fontSize: 12 }}>
      ⚠ <b>エンジン未実装</b><br/>
      <span style={{ fontSize: 11 }}>
        辞書追加は可能ですが、ゲーム中は動作しません。Claude にエンジン実装を依頼してください。
        {(kind === 'actions' || kind === 'options') && '既存ロジックの流用なら「ロジックコード」欄に既存コードを指定してください。'}
      </span>
    </div>
  );
}

// （旧 RulesPanel / SchemaBuilder / SchemaValidator はルール方式への移行で全削除）

// 一覧テーブル内・小型バッジ
function ImplBadgeSmall({ kind, code, logicCode }: { kind: DictKind; code: string; logicCode?: string }) {
  const implemented = kind === 'actions' ? isActionImplemented(code, logicCode)
                    : kind === 'keywords' ? isKeywordImplemented(code)
                    : kind === 'options' ? isOptionImplemented(code, logicCode)
                    : isConditionImplemented(code);
  return implemented
    ? <span style={{ color: '#2e7d32', fontSize: 11 }} title={logicCode ? '実装済（' + logicCode + ' 流用）' : '実装済'}>✅実装済</span>
    : <span style={{ color: '#e65100', fontSize: 11 }} title="エンジン未実装">⚠未実装</span>;
}

// 未実装エントリを Markdown 形式の報告書としてまとめる
function buildUnimplementedReport(dict: DictAPI): string {
  const unimplActions = dict.actions.filter((a) => !isActionImplemented(a.code, a.logicCode));
  const unimplConditions = dict.conditions.filter((c) => !isConditionImplemented(c.code));
  const unimplKeywords = dict.keywords.filter((k) => !isKeywordImplemented(k.code));
  const unimplOptions = dict.options.filter((o) => !isOptionImplemented(o.code, o.logicCode));

  const lines: string[] = [];
  lines.push('# 未実装エントリ一覧（' + new Date().toLocaleString('ja-JP') + '）');
  lines.push('');
  lines.push('以下の辞書エントリはエンジン未実装です。実装をお願いします。');
  lines.push('');

  if (unimplActions.length > 0) {
    lines.push('## ⚠ アクション（' + unimplActions.length + '件）');
    lines.push('');
    unimplActions.forEach((a) => {
      lines.push('- **`' + a.code + '`** — ' + a.label);
      if (a.description) lines.push('  - 説明: ' + a.description);
      if (a.visualType) lines.push('  - 演出: ' + a.visualType + (a.visualCode ? ' (`' + a.visualCode + '`)' : ''));
      if (a.frameColor) lines.push('  - 枠色: ' + a.frameColor);
      if (a.autoManual) lines.push('  - 自動/手動: ' + a.autoManual);
      if (a.valueLabel) lines.push('  - 数値の意味: ' + a.valueLabel);
      if (a.manualDesc) lines.push('  - 手動操作: ' + a.manualDesc);
      if (a.logicCode) lines.push('  - ロジック alias: `' + a.logicCode + '`（既存実装流用）');
    });
    lines.push('');
  }

  if (unimplConditions.length > 0) {
    lines.push('## ⚠ 条件（' + unimplConditions.length + '件）');
    lines.push('');
    unimplConditions.forEach((c) => {
      lines.push('- **`' + c.code + '`** — ' + c.label);
      if (c.description) lines.push('  - 説明: ' + c.description);
    });
    lines.push('');
  }

  if (unimplKeywords.length > 0) {
    lines.push('## ⚠ キーワード（' + unimplKeywords.length + '件）');
    lines.push('');
    unimplKeywords.forEach((k) => {
      lines.push('- **`' + k.code + '`** — ' + k.label);
      if (k.description) lines.push('  - 説明: ' + k.description);
      if (k.isPassive) lines.push('  - passive flag として動作');
      if (k.visualType) lines.push('  - 演出: ' + k.visualType);
    });
    lines.push('');
  }

  if (unimplOptions.length > 0) {
    lines.push('## ⚠ 修飾子（' + unimplOptions.length + '件）');
    lines.push('');
    unimplOptions.forEach((o) => {
      lines.push('- **`' + o.code + '`** — ' + o.label);
      if (o.description) lines.push('  - 説明: ' + o.description);
      if (o.logicCode) lines.push('  - ロジック alias: `' + o.logicCode + '`（既存実装流用）');
    });
    lines.push('');
  }

  if (unimplActions.length === 0 && unimplConditions.length === 0 && unimplKeywords.length === 0 && unimplOptions.length === 0) {
    lines.push('🎉 未実装エントリはありません！全部実装済です。');
  } else {
    lines.push('---');
    lines.push('## 実装依頼');
    lines.push('');
    lines.push('上記をエンジンに実装してください:');
    lines.push('1. `js/effect-engine.js` — ロジック（switch case 追加 / 修飾子は各アクションでフラグ参照）');
    lines.push('2. `js/battle-fx.js` または `js/battle-combat.js` — 演出関数');
    lines.push('3. `recipe-editor-src/src/implemented.ts` — `IMPLEMENTED_ACTIONS / CONDITIONS / KEYWORDS / OPTIONS` に追加');
    lines.push('');
    lines.push('既存ロジック流用可能な場合は、辞書の「ロジックコード」列を埋めるだけで OK です。');
  }

  return lines.join('\n');
}

export function kindToSingular(k: DictKind): string {
  return k === 'triggers' ? 'trigger'
    : k === 'conditions' ? 'condition'
    : k === 'actions' ? 'action'
    : k === 'options' ? 'option'
    : 'keyword';
}

function btn(): React.CSSProperties {
  return { padding: '4px 10px', border: '1px solid #888', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 12 };
}
function panel(): React.CSSProperties {
  return { padding: 12, background: '#fafafa', border: '1px solid #ddd', borderRadius: 6 };
}
function th(): React.CSSProperties {
  return { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc', fontWeight: 'bold' };
}
function td(variant?: string): React.CSSProperties {
  return {
    padding: '4px 8px',
    fontFamily: variant === 'mono' ? 'Consolas, monospace' : undefined,
    fontSize: 12,
  };
}

