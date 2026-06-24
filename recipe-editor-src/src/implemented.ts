// エンジン (js/effect-engine.js) で実装済のアクションコード一覧
// 新規追加するアクションが既存ロジック流用なら ロジックコード を既存コードに設定すればOK
// 完全新規ロジックは Claude に実装依頼が必要
//
// 更新方法: js/effect-engine.js の switch case を grep して反映:
// grep -E "^\s*case '[a-z_]+'" effect-engine.js | grep -v "cond_"
export const IMPLEMENTED_ACTIONS = new Set<string>([
  'active', 'add_to_evo_source', 'add_to_hand', 'app_gattai_evolve',
  'attack_digimon', 'attack_player', 'attack_without_rest',
  'bounce', 'cant_attack', 'cant_attack_block', 'cant_block', 'cant_evolve',
  'change_attack_target', 'cost_digiburst', 'cost_discard', 'cost_trash_self',
  'deck_open', 'deck_to_evo_bottom', 'deck_trash_top', 'dedigivolve', 'destroy',
  'do_security_check', 'dp_minus', 'dp_plus', 'draw',
  'evo_cost_minus', 'evo_discard', 'evo_discard_all', 'evo_discard_bottom', 'evo_discard_top',
  'force_block', 'goal_reached', 'grant_keyword', 'grant_keyword_to',
  'ignore_color_condition', 'immune_effects', 'jogress_evolve',
  'link', 'link_capacity', 'link_cost',
  'memory_minus', 'memory_plus', 'mod_attack_first_turn',
  'overflow_memory_minus',
  'place_from_hand_battle_under', 'place_from_trash_under', 'place_on_security_top',
  'place_under_digimon', 'place_under_tamer',
  'prevent_battle_destroy', 'prevent_destroy', 'prevent_any_destroy',
  'recover', 'rest', 'rest_self', 'return_deck',
  'security_attack_minus', 'security_attack_plus',
  'security_trash_bottom', 'security_trash_select', 'security_trash_top',
  'select', 'select_evo_source', 'select_from_hand_trash', 'select_multi',
  'self_destroy_after_attack',
  'summon', 'summon_cost_minus', 'summon_from_trash',
  'trash_to_hand', 'trash_top_card', 'unlink', 'use_main_effect',
  // Stage 2 追加
  'deck_trash_top', 'cant_be_blocked', 'cost_destroy_other',
  // Stage 3 追加
  'battle_by_evo_count', 'suppress_opt_security_effect',
  // 旧コード alias (cant_be_blocked / suppress_opt_security_effect と同等)
  'custom', 'security_effect',
  // Stage 4 追加（進化元からの召喚）
  'summon_from_evo_source',
  // Stage 5 追加（セキュリティ全公開＋ルール選択+自動シャッフル）
  'security_open',
  // Stage 6 追加（汎用アクション・状態操作）
  'memory', 'dp', 'hatch', 'battle_area_make',
  'security_discard', 'place_security',
  'not_active', 'prevent_unsuspend',
  'grant_effect',
  // Stage 7 追加（トークン生成）
  'summon_token',
]);

// エンジンで実装済の passive flag (キーワード)
// 新キーワードを passive として追加 → 既存と同じ動作なら flag 名を一致させる
// 完全新規キーワード = Claude に実装依頼
export const IMPLEMENTED_KEYWORDS = new Set<string>([
  'blocker', 'penetrate', 'piercing', 'rush', 'jamming', 'reboot',
  'michizure', 'armor_break', 'evade', 'barrier', 'indomitable',
  'combo', 'collision', 'charge', 'security_attack_plus',
  // Stage 1 で追加（passive flag のみ・状態保持型）
  'progress', 'link_plus', 'ice_armor', 'advance', 'security_attack_minus',
  // Stage 2 追加
  'cant_be_blocked',
  // Stage 4 追加（destroy chain 統合済）
  'fragment', 'decoy', 'scapegoat',
  // 旧コード alias
  'custom', 'security_effect',
]);

// エンジンで実装済の条件コード
// 更新方法: grep -E "case 'cond_[a-z_]+'" effect-engine.js
export const IMPLEMENTED_CONDITIONS = new Set<string>([
  'cond_assembly_eligible', 'cond_attack_target_digimon', 'cond_battle_win',
  'cond_color', 'cond_cost_ge', 'cond_cost_le',
  'cond_digicross', 'cond_dp_ge', 'cond_dp_le',
  'cond_during_opp_turn', 'cond_during_own_turn', 'cond_exists',
  'cond_feature', 'cond_feature_contains', 'cond_has_evo',
  'cond_in_battle', 'cond_jogress', 'cond_link_eligible', 'cond_link_state',
  'cond_lv_ge', 'cond_lv_le', 'cond_memory_opponent',
  'cond_name_contains', 'cond_no_evo', 'cond_no_tamer_evo',
  'cond_not_own_effect', 'cond_opp_no_attack_this_turn',
  'cond_own_security_ge', 'cond_own_security_le', 'cond_own_trash_ge',
  'cond_self_active', 'cond_self_keyword', 'cond_when_opp_rest',
  // Stage 1 追加
  'cond_evolved_this_turn', 'cond_rest_count_ge', 'cond_memory_ge', 'cond_exists_count_ge',
  // 旧名 / 別名条件 alias 実装
  'cond_opp_digimon', 'cond_own', 'cond_digimon', 'cond_keyword', 'cond_custom',
  'deck_trash_top', // 条件タブに誤登録された action コードを「デッキに1枚以上ある」マーカーとして実装
  // ゾーン枚数（subject 駆動）
  'cond_hand_le', 'cond_hand_ge',
  'cond_security_le', 'cond_security_ge',
  'cond_trash_le', 'cond_trash_ge',
  'cond_deck_le', 'cond_deck_ge',
  // 進化元メタ条件（cond_exists の進化元版）
  'cond_has_evo_digimon',
  // 完全一致系
  'cond_lv', 'cond_dp', 'cond_cost',
  // お互いのターン中（常時true・ゲートとして実質no-op）
  'cond_during_any_turn',
  // タイプ完全一致 / 自身レスト判定
  'cond_type', 'cond_self_rest', 'cond_self_suspended',
  // メモリー以下
  'cond_memory_le',
  // 名前（完全一致）
  'cond_name',
  // アタック先（プレイヤー）判定
  'cond_attack_target_player',
  // 選んだデジモンと同じ
  'cond_same_as_picked',
  // 直前に選択したカード (bs._lastPickedCard) の属性参照（post_actions 用）
  'cond_picked_color', 'cond_picked_type', 'cond_picked_lv', 'cond_picked_dp', 'cond_picked_cost',
  'cond_picked_name', 'cond_picked_feature_contains',
  // Stage 6 追加（汎用カード状態 / 進化文脈）
  'cond_rest', 'cond_blocker', 'cond_tamer', 'cond_security', 'cond_evolve_to_lv',
  // Stage 8 追加（代替進化 / 条件付き登場コスト軽減）
  'cond_opp_dp_ge',
]);

// エンジンで実装済の修飾子コード（アクションの実行方法を変える）
// 'ignore_cost' / 'face_down' 等。実装したコードだけ追加していく
export const IMPLEMENTED_OPTIONS = new Set<string>([
  // summon_from_evo_source の case 内で step.options.includes('ignore_cost') を見て分岐済
  'ignore_cost',
  // 「相手に見せて」: deck_open / security_open の selections[].options で参照され、
  // 選択完了したカードを公開（fx_remoteDeckOpenAct で相手画面にも見せる）
  'show_to_opponent',
  // 「その後」: 前ステップが success=false でも次ステップを実行（runRecipe.nextStep で実装）
  'continue_on_fail',
  // 「相手に見せて」（汎用）: deck_open / security_open 系の broadcast 経路で実質公開済
  'reveal',
  // 「任意（してもよい）」: 効果実行前に確認ダイアログを出す（recipe 解釈側で対応）
  'optional',
]);

// エンジン側に実装が必要かを判定（ロジック alias 考慮）
// dictEntry: 辞書エントリ。logicCode 列があればそれを優先
export function isActionImplemented(code: string, logicCode?: string): boolean {
  const target = (logicCode && logicCode.trim()) || code;
  return IMPLEMENTED_ACTIONS.has(target);
}

export function isKeywordImplemented(code: string): boolean {
  return IMPLEMENTED_KEYWORDS.has(code);
}

export function isOptionImplemented(code: string, logicCode?: string): boolean {
  const target = (logicCode && logicCode.trim()) || code;
  return IMPLEMENTED_OPTIONS.has(target);
}

// 条件コードが実装済か判定（base コードのみ抽出して判定）
export function isConditionImplemented(code: string): boolean {
  if (!code) return true; // 空は問題なし
  const base = code.split(':')[0];
  return IMPLEMENTED_CONDITIONS.has(base);
}
