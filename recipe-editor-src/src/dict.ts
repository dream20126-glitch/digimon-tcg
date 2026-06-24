// 内蔵辞書（プロトタイプ用ハードコード版）
// 将来的にはスプシ「効果辞書」 or アプリ内 JSON ファイルから動的取得
import type { DictEntry } from './types';

export const SECTIONS = [
  { code: 'main', label: 'メイン' },
  { code: 'evo_source', label: '進化元' },
  { code: 'security', label: 'セキュリティ' },
];

export const ZONES = [
  { code: '', label: '（バトルエリア）' },
  { code: 'security', label: 'セキュリティ' },
  { code: 'trash', label: 'トラッシュ' },
  { code: 'hand', label: '手札' },
  { code: 'breed', label: '育成エリア' },
];

// アクションの取得元エリア（「📥 取得元エリア」フィールド用）
// 主に summon 系・add_to_hand 系で使われる。エディタで複数選択 + OR/AND 切替で組合せ可能
export const FROM_ZONES = [
  { code: 'hand',       label: '手札' },
  { code: 'trash',      label: 'トラッシュ' },
  { code: 'deck',       label: 'デッキ' },
  { code: 'security',   label: 'セキュリティ' },
  { code: 'evo_source', label: '進化元' },
];

// 「～ごとに（倍率設定）」のカウント対象 (subject) と 状態 (state)
// エディタでは2つのプルダウンに分離。エンジン側 getRefSourceCountDirect が解釈する組合せ ref を生成
export const REF_SUBJECTS = [
  { code: '',                label: '（選択）' },
  { code: 'evo_source',      label: 'このカードの進化元' },
  // 自分側
  { code: 'own_digimon',     label: '自分のデジモン' },
  { code: 'own_tamer',       label: '自分のテイマー' },
  { code: 'own_hand',        label: '自分の手札' },
  { code: 'own_trash',       label: '自分のトラッシュ' },
  { code: 'own_security',    label: '自分のセキュリティ' },
  { code: 'own_battle_area', label: '自分のバトルエリア（全カード）' },
  // 相手側
  { code: 'opp_digimon',         label: '相手のデジモン' },
  { code: 'opp_no_evo_digimon', label: '相手の進化元なしデジモン' },
  { code: 'opp_tamer',          label: '相手のテイマー' },
  // 特殊カウンタ
  { code: 'last_rest_count',    label: 'この効果でレストさせた枚数' },
  { code: 'opp_hand',        label: '相手の手札' },
  { code: 'opp_trash',       label: '相手のトラッシュ' },
  { code: 'opp_security',    label: '相手のセキュリティ' },
  { code: 'opp_battle_area', label: '相手のバトルエリア（全カード）' },
];

// 状態 pulldown の旧データ。新仕様では dict.conditions を直接利用するためエディタ側で参照していない。
// 既存レシピ（own_rest_digimon 等）読み込み時の互換変換のみで使う想定。残置。
export const REF_STATES = [
  { code: '',       label: '状態問わず' },
  { code: 'rest',   label: 'レスト状態' },
  { code: 'active', label: 'アクティブ状態' },
];

// 限定タイプ。回数は別フィールド（限定値）で指定。
// JSON 出力時: per_turn + 1 → 'once_per_turn' (互換) / per_turn + N>=2 → 'per_turn:N'
export const LIMITS = [
  { code: '', label: '' },
  { code: 'per_turn', label: 'ターンにN回' },
];

export const DURATIONS = [
  { code: '', label: '' },
  { code: 'dur_this_turn', label: 'このターン中' },
  { code: 'dur_next_opp_turn', label: '次の相手ターン終了まで' },
  { code: 'dur_next_own_turn', label: '次の自分ターン終了まで' },
  { code: 'dur_next_opp_unsuspend', label: '次の相手のアクティブフェイズまで' },
  { code: 'dur_next_own_unsuspend', label: '次の自分のアクティブフェイズまで' },
  { code: 'dur_while', label: '〜の間（汎用）' },
];

export const TARGETS = [
  { code: '', label: '' },
  { code: 'self', label: 'このデジモン' },
  { code: 'self_card', label: 'このカード' },
  { code: 'own', label: '自分のデジモン' },
  { code: 'own_card', label: '自分のカード' },
  { code: 'own_any', label: '自分の' },
  { code: 'target_other_own', label: '他の自分のデジモン' },
  { code: 'opponent', label: '相手のデジモン' },
  { code: 'opponent_card', label: '相手のカード' },
  { code: 'opp_any', label: '相手の' },
  { code: 'opponent_active', label: 'アクティブ状態の相手のデジモン' },
  { code: 'opponent_suspended', label: 'レスト状態の相手のデジモン' },
  { code: 'target_highest_dp', label: '最もDPの高い相手のデジモン' },
  { code: 'target_battle_opponent', label: 'バトルした相手のデジモン' },
  { code: 'own_tamer', label: '自分のテイマー' },
  { code: 'own_security', label: '自分のセキュリティデジモン' },
  { code: 'player', label: 'プレイヤー' },
  { code: 'own_player', label: '自分のプレイヤー' },
  { code: 'opp_player', label: '相手のプレイヤー' },
  // 「そのデジモン」=直前にメインアクションで選択／対象になったデジモンを再利用
  { code: 'same_target', label: 'そのデジモン（直前選択）' },
];

// トリガー発動主体（誰がイベントの主役か）
// 'self' = このデジモン（デフォルト）。トリガー = 純粋にイベント、誰のかは独立指定。
export const TRIGGER_SUBJECTS = [
  { code: 'self', label: 'このデジモン' },
  { code: 'own', label: '自分のデジモン' },
  { code: 'other_own', label: '他の自分のデジモン' },
  { code: 'opp', label: '相手のデジモン' },
  { code: 'own_tamer', label: '自分のテイマー' },
  { code: 'opp_tamer', label: '相手のテイマー' },
  { code: 'own_player', label: '自分のプレイヤー' },
  { code: 'opp_player', label: '相手のプレイヤー' },
];

// 条件対象（条件を「誰に対して」判定するか）
// 既定の空 = アクション対象 / コンテキスト依存
export const CONDITION_SUBJECTS = [
  { code: '', label: '（既定 / アクション対象）' },
  { code: 'self', label: 'このデジモン' },
  { code: 'self_card', label: 'このカード' },
  { code: 'own', label: '自分のデジモン' },
  { code: 'own_card', label: '自分のカード' },
  { code: 'own_any', label: '自分の' },
  { code: 'other_own', label: '他の自分のデジモン' },
  { code: 'opp', label: '相手のデジモン' },
  { code: 'opp_card', label: '相手のカード' },
  { code: 'opp_any', label: '相手の' },
  { code: 'opp_blocker', label: 'ブロックする相手のデジモン' },
  { code: 'own_tamer', label: '自分のテイマー' },
  { code: 'opp_tamer', label: '相手のテイマー' },
  { code: 'own_player', label: '自分のプレイヤー' },
  { code: 'opp_player', label: '相手のプレイヤー' },
];

export const TARGET_COUNTS = [
  { code: '', label: '' },
  { code: ':1', label: '1' },
  { code: ':2', label: '2' },
  { code: ':3', label: '3' },
  { code: ':all', label: '全て' },
  { code: ':up_to_1', label: '1体まで' },
  { code: ':up_to_2', label: '2体まで' },
  { code: ':up_to_3', label: '3体まで' },
];

// トリガー（種類: trigger / continuous）
export const TRIGGERS: DictEntry[] = [
  // 即時系
  { code: 'on_play', kind: 'trigger', label: '登場時' },
  { code: 'on_evolve', kind: 'trigger', label: '進化時' },
  { code: 'on_attack', kind: 'trigger', label: 'アタック時' },
  { code: 'on_attack_end', kind: 'trigger', label: 'アタック終了時' },
  { code: 'on_destroy', kind: 'trigger', label: '消滅時' },
  { code: 'on_battle_destroy', kind: 'trigger', label: 'バトルで消滅したとき' },
  { code: 'on_battle_win', kind: 'trigger', label: 'バトル勝利時' },
  { code: 'when_destroy', kind: 'trigger', label: '消滅するとき' },
  { code: 'when_blocked', kind: 'trigger', label: 'ブロックされたとき' },
  { code: 'when_attacked', kind: 'trigger', label: 'アタックされたとき' },
  { code: 'when_rest', kind: 'trigger', label: 'レストしたとき' },
  { code: 'when_leave_battle', kind: 'trigger', label: 'バトルエリアを離れるとき' },
  { code: 'when_security_decrease', kind: 'trigger', label: 'セキュリティが減ったとき' },
  { code: 'when_return_to_hand', kind: 'trigger', label: '手札に戻ったとき' },
  { code: 'when_target_changed', kind: 'trigger', label: 'アタック対象が変更されたとき' },
  { code: 'when_own_destroyed', kind: 'trigger', label: '自分のデジモンが消滅したとき' },
  { code: 'when_other_destroyed', kind: 'trigger', label: '他のデジモンが消滅したとき' },
  { code: 'when_opp_destroyed', kind: 'trigger', label: '相手のデジモンが消滅したとき' },
  { code: 'when_own_block', kind: 'trigger', label: '自分のブロッカーがレストしたとき' },
  { code: 'when_opp_rest', kind: 'trigger', label: '相手のデジモンがレストしたとき' },
  // ターン境界
  { code: 'on_own_turn_start', kind: 'trigger', label: '自分のターン開始時' },
  { code: 'on_own_turn_end', kind: 'trigger', label: '自分のターン終了時' },
  { code: 'on_opp_turn_start', kind: 'trigger', label: '相手のターン開始時' },
  { code: 'on_opp_turn_end', kind: 'trigger', label: '相手のターン終了時' },
  { code: 'on_main_phase_start', kind: 'trigger', label: 'メインフェイズ開始時' },
  { code: 'on_opp_main_phase_start', kind: 'trigger', label: '相手のメインフェイズ開始時' },
  // 持続
  { code: 'during_own_turn', kind: 'continuous', label: '自分のターン' },
  { code: 'during_opp_turn', kind: 'continuous', label: '相手のターン' },
  { code: 'during_any_turn', kind: 'continuous', label: 'お互いのターン' },
  // 特殊
  { code: 'main', kind: 'trigger', label: 'メインフェイズ中' },
  { code: 'passive', kind: 'trigger', label: 'パッシブ' },
  // 常時メカニクス（アクション不要・条件と値だけ設定する）
  { code: 'summon_cost', kind: 'trigger', label: '［常時］登場コスト軽減（条件＝発動条件／値＝軽減量）' },
  { code: 'alt_evolve', kind: 'trigger', label: '［常時］代替進化・進化条件無視（条件1＝発動条件／条件2＝進化元の絞り込み／値＝進化コスト）' },
];

// 条件（種類: condition）
export const CONDITIONS: DictEntry[] = [
  { code: 'cond_dp', kind: 'condition', label: 'DP（完全一致）' },
  { code: 'cond_dp_le', kind: 'condition', label: 'DP以下' },
  { code: 'cond_dp_ge', kind: 'condition', label: 'DP以上' },
  { code: 'cond_opp_dp_ge', kind: 'condition', label: '相手にDP N以上のデジモンがいる' },
  { code: 'cond_lv', kind: 'condition', label: 'Lv.（完全一致）' },
  { code: 'cond_lv_le', kind: 'condition', label: 'Lv.以下' },
  { code: 'cond_lv_ge', kind: 'condition', label: 'Lv.以上' },
  { code: 'cond_cost', kind: 'condition', label: 'コスト（完全一致）' },
  { code: 'cond_cost_le', kind: 'condition', label: 'コスト以下' },
  { code: 'cond_cost_ge', kind: 'condition', label: 'コスト以上' },
  { code: 'cond_no_evo', kind: 'condition', label: '進化元を持たない' },
  { code: 'cond_has_evo', kind: 'condition', label: '進化元をN枚以上持つ' },
  { code: 'cond_exists', kind: 'condition', label: 'いるとき' },
  { code: 'cond_opp_exists', kind: 'condition', label: '相手のデジモンがいるとき' },
  { code: 'cond_own_exists', kind: 'condition', label: '自分のデジモンがいるとき' },
  { code: 'cond_exists_count_ge', kind: 'condition', label: 'がN体以上いる間' },
  { code: 'cond_jogress', kind: 'condition', label: 'ジョグレス進化していたなら' },
  { code: 'cond_in_battle', kind: 'condition', label: 'バトルしている間' },
  { code: 'cond_color', kind: 'condition', label: '指定色' },
  { code: 'cond_type', kind: 'condition', label: '指定タイプ' },
  { code: 'cond_feature', kind: 'condition', label: '指定特徴' },
  { code: 'cond_memory_opponent', kind: 'condition', label: 'メモリーが相手側' },
  { code: 'cond_memory_ge', kind: 'condition', label: 'メモリーがN以上の間' },
  { code: 'cond_memory_le', kind: 'condition', label: 'メモリーがN以下の間' },
  { code: 'cond_no_tamer_evo', kind: 'condition', label: '進化元にテイマーカードが無い' },
  { code: 'cond_not_own_effect', kind: 'condition', label: '自分の効果以外' },
  { code: 'cond_name', kind: 'condition', label: '名前（完全一致）' },
  { code: 'cond_name_contains', kind: 'condition', label: '名称に含む' },
  { code: 'cond_feature_contains', kind: 'condition', label: '特徴に含む' },
  { code: 'cond_link_state', kind: 'condition', label: 'リンク状態' },
  { code: 'cond_link_eligible', kind: 'condition', label: 'リンク条件を満たす' },
  { code: 'cond_assembly_eligible', kind: 'condition', label: 'アセンブリ条件を満たす' },
  { code: 'cond_digicross', kind: 'condition', label: 'デジクロスしていたなら' },
  { code: 'cond_own_security_le', kind: 'condition', label: '自分のセキュリティN以下' },
  { code: 'cond_own_security_ge', kind: 'condition', label: '自分のセキュリティN以上' },
  { code: 'cond_attack_target_digimon', kind: 'condition', label: '相手のデジモンにアタックしたとき' },
  { code: 'cond_attack_target_player', kind: 'condition', label: 'プレイヤーにアタックしたとき' },
  { code: 'cond_same_as_picked', kind: 'condition', label: '選んだデジモンと同じ（属性指定）' },
  { code: 'cond_during_own_turn', kind: 'condition', label: '自分のターン中' },
  { code: 'cond_during_opp_turn', kind: 'condition', label: '相手のターン中' },
  { code: 'cond_during_any_turn', kind: 'condition', label: 'お互いのターン中' },
  { code: 'cond_self_active', kind: 'condition', label: 'このデジモンがアクティブの間' },
  { code: 'cond_self_rest', kind: 'condition', label: 'このデジモンがレスト状態' },
  { code: 'cond_opp_no_attack_this_turn', kind: 'condition', label: '相手がアタックしていない' },
  { code: 'cond_own_trash_ge', kind: 'condition', label: '自分のトラッシュN枚以上' },
  { code: 'cond_self_keyword', kind: 'condition', label: '指定キーワードを持つ間' },
  { code: 'cond_evolved_this_turn', kind: 'condition', label: 'このターンに進化させているなら' },
  { code: 'cond_rest_count_ge', kind: 'condition', label: 'レスト状態のデジモンがN体以上' },
  { code: 'cond_has_evo_digimon', kind: 'condition', label: '進化元にデジモンカードを持つ' },
  // ゾーン枚数（subject 駆動: 主体に '自分の' / '相手の' を指定）
  { code: 'cond_hand_le', kind: 'condition', label: '手札がN枚以下' },
  { code: 'cond_hand_ge', kind: 'condition', label: '手札がN枚以上' },
  { code: 'cond_security_le', kind: 'condition', label: 'セキュリティがN枚以下' },
  { code: 'cond_security_ge', kind: 'condition', label: 'セキュリティがN枚以上' },
  { code: 'cond_trash_le', kind: 'condition', label: 'トラッシュがN枚以下' },
  { code: 'cond_trash_ge', kind: 'condition', label: 'トラッシュがN枚以上' },
  { code: 'cond_deck_le', kind: 'condition', label: 'デッキがN枚以下' },
  { code: 'cond_deck_ge', kind: 'condition', label: 'デッキがN枚以上' },
];

// アクション（種類: action）
export const ACTIONS: DictEntry[] = [
  { code: 'draw', kind: 'action', label: 'ドロー' },
  { code: 'dp_plus', kind: 'action', label: 'DPを+' },
  { code: 'dp_minus', kind: 'action', label: 'DPを-' },
  { code: 'memory_plus', kind: 'action', label: 'メモリーを+' },
  { code: 'memory_minus', kind: 'action', label: 'メモリーを-' },
  { code: 'destroy', kind: 'action', label: '消滅させる' },
  { code: 'bounce', kind: 'action', label: '手札に戻す' },
  { code: 'active', kind: 'action', label: 'アクティブにする' },
  { code: 'rest', kind: 'action', label: 'レストさせる' },
  { code: 'recover', kind: 'action', label: 'リカバリー' },
  { code: 'security_trash_top', kind: 'action', label: 'セキュリティの上から破棄' },
  { code: 'security_trash_bottom', kind: 'action', label: 'セキュリティの下から破棄' },
  { code: 'security_trash_select', kind: 'action', label: 'セキュリティを選んで破棄' },
  { code: 'evo_discard', kind: 'action', label: '進化元を破棄' },
  { code: 'evo_discard_bottom', kind: 'action', label: '進化元の下から破棄' },
  { code: 'summon', kind: 'action', label: '登場させる' },
  { code: 'summon_from_trash', kind: 'action', label: 'トラッシュから登場' },
  { code: 'summon_token', kind: 'action', label: 'トークンを登場させる（値=トークンのカードNo）' },
  { code: 'deck_open', kind: 'action', label: 'デッキの上からオープン' },
  { code: 'deck_trash_top', kind: 'action', label: 'デッキの上から破棄' },
  { code: 'add_to_hand', kind: 'action', label: '手札に加える' },
  { code: 'return_deck', kind: 'action', label: 'デッキに戻す' },
  { code: 'add_to_evo_source', kind: 'action', label: '進化元に置く' },
  { code: 'cant_attack', kind: 'action', label: 'アタックできない' },
  { code: 'cant_block', kind: 'action', label: 'ブロックできない' },
  { code: 'cant_attack_block', kind: 'action', label: 'アタックとブロックができない' },
  { code: 'cant_evolve', kind: 'action', label: '進化できない' },
  { code: 'security_attack_plus', kind: 'action', label: 'Sアタックを+' },
  { code: 'security_attack_minus', kind: 'action', label: 'Sアタックを-' },
  { code: 'attack_without_rest', kind: 'action', label: 'レストせずにアタック' },
  { code: 'cost_discard', kind: 'action', label: '手札を捨てる（コスト）' },
  { code: 'cost_destroy_other', kind: 'action', label: '他の自分のデジモンを消滅させる（コスト）' },
  { code: 'evo_cost_minus', kind: 'action', label: '進化コストを-' },
  { code: 'use_main_effect', kind: 'action', label: 'メイン効果を発揮' },
  { code: 'select', kind: 'action', label: '1体選ぶ' },
  { code: 'select_multi', kind: 'action', label: 'N体まで選ぶ' },
  { code: 'select_evo_source', kind: 'action', label: '進化元のカードを選ぶ' },
  { code: 'grant_keyword', kind: 'action', label: 'キーワードを得る' },
  { code: 'grant_keyword_to', kind: 'action', label: 'キーワードを与える' },
  { code: 'prevent_destroy', kind: 'action', label: '効果で消滅しない' },
  { code: 'prevent_battle_destroy', kind: 'action', label: 'バトルで消滅しない' },
  { code: 'prevent_any_destroy', kind: 'action', label: 'バトルでも効果でも消滅しない' },
  { code: 'place_under_tamer', kind: 'action', label: 'テイマーの下に置く' },
  { code: 'place_under_digimon', kind: 'action', label: '進化元の下に置く' },
  { code: 'jogress_evolve', kind: 'action', label: 'ジョグレス進化' },
  { code: 'force_block', kind: 'action', label: 'ブロックさせる' },
  { code: 'immune_effects', kind: 'action', label: '効果を受けない' },
  { code: 'do_security_check', kind: 'action', label: 'セキュリティチェックをする' },
  { code: 'attack_player', kind: 'action', label: 'プレイヤーにアタック' },
  { code: 'attack_digimon', kind: 'action', label: 'デジモンにアタック' },
  { code: 'change_attack_target', kind: 'action', label: 'アタック対象を変更' },
  { code: 'dedigivolve', kind: 'action', label: '退化' },
  { code: 'cost_digiburst', kind: 'action', label: 'デジバースト' },
  { code: 'trash_to_hand', kind: 'action', label: 'トラッシュから手札に戻す' },
  { code: 'summon_from_evo_source', kind: 'action', label: '進化元から登場' },
];

// 修飾子（種類: option）— アクションの実行方法を変える
// 「コストを支払わず」「効果を発揮せず」「裏向きで」等、汎用的に重ねる
export const OPTIONS: DictEntry[] = [
  { code: 'ignore_cost',         kind: 'option', label: 'コストを支払わず' },
  { code: 'without_effect',      kind: 'option', label: '効果を発揮せず' },
  { code: 'face_down',           kind: 'option', label: '裏向きで' },
  { code: 'reveal',              kind: 'option', label: '相手に見せて' },
  { code: 'show_to_opponent',    kind: 'option', label: '相手に見せて（公開）' },
  { code: 'as_original',         kind: 'option', label: '元の名称・色・特徴・Lv.として' },
  { code: 'without_digicross',   kind: 'option', label: 'デジクロスせず' },
  { code: 'optional',            kind: 'option', label: '任意（してもよい）' },
  // 「次の1回限定」: バフ系効果を1回だけ消費するためのフラグ
  // 例: 「次に〜進化するときコスト-4」→ once_only で次の進化時に消費して失効
  { code: 'once_only',           kind: 'option', label: '次の1回限定（消費型）' },
  // 「その後」: 前ステップが失敗（対象なし等）でも後続を実行
  { code: 'continue_on_fail',    kind: 'option', label: 'その後（前失敗でも実行）' },
];

// キーワード（passive flag / grant_keyword 用）
export const KEYWORDS: DictEntry[] = [
  { code: 'blocker', kind: 'keyword', label: 'ブロッカー' },
  { code: 'penetrate', kind: 'keyword', label: '貫通' },
  { code: 'piercing', kind: 'keyword', label: '突進' },
  { code: 'rush', kind: 'keyword', label: '速攻' },
  { code: 'jamming', kind: 'keyword', label: 'ジャミング' },
  { code: 'reboot', kind: 'keyword', label: '再起動' },
  { code: 'michizure', kind: 'keyword', label: '道連れ' },
  { code: 'armor_break', kind: 'keyword', label: 'アーマー解除' },
  { code: 'evade', kind: 'keyword', label: '回避' },
  { code: 'barrier', kind: 'keyword', label: '防壁' },
  { code: 'indomitable', kind: 'keyword', label: '不屈' },
  { code: 'combo', kind: 'keyword', label: '連携' },
  { code: 'collision', kind: 'keyword', label: '衝突' },
  { code: 'security_attack_plus', kind: 'keyword', label: 'Sアタック+' },
  { code: 'security_attack_minus', kind: 'keyword', label: 'Sアタック-' },
];

// ラベル⇄コード変換ヘルパー
export function labelToCode(label: string, list: { code: string; label: string }[]): string {
  if (!label) return '';
  const e = list.find((x) => x.label === label);
  return e ? e.code : label;
}

export function codeToLabel(code: string, list: { code: string; label: string }[]): string {
  if (!code) return '';
  const e = list.find((x) => x.code === code);
  return e ? e.label : code;
}
