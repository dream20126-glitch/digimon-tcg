// 効果ブロックで使う条件1個のペア
export interface ConditionPair {
  base: string; // condition code (cond_xxx)
  value?: string; // 数値 or サブ条件コード
  subject?: string; // 条件対象: '' = アクション対象 / 'self' / 'own' / 'other_own' / 'opp' / 'opp_blocker' 等
}

// 効果ブロック1ステップの構造（コードブロックシートと同等）
export interface EffectBlock {
  section: 'main' | 'evo_source' | 'security';
  zone?: string; // '' | 'security' | 'trash' | 'hand' | 'breed'
  trigger: string; // code (e.g., 'on_play', 'during_own_turn', 'passive', 'main')
  triggerSubject?: string; // '' = このデジモン / 'own' / 'other_own' / 'opp' / 'own_tamer'
  limit?: string; // '' | 'once_per_turn'
  // トリガー条件: トリガー発火元のカード（登場/消滅したカード等）に対するフィルタ
  // 「黄のLv.3デジモンが登場したとき」等の "このトリガーが発火する条件" を表現
  triggerConditions?: ConditionPair[];
  conditions?: ConditionPair[]; // 0〜N個のAND条件（self や全体状況に対するゲート）
  costs?: CostStep[]; // 0〜N個のコスト（〜することで）
  duration?: string;
  action?: string;
  value?: number | string;
  target?: string; // 'self' | 'own:1' | 'opponent:all' 等
  keyword?: string;
  // memory_plus 専用:「メモリー+Nする。このターン終了時、メモリーを-Nする。」
  // true のとき JSON へ step.revert_at_turn_end:true を出力する
  revertAtTurnEnd?: boolean;
  // summon 専用:「このカードをコストを支払わずに登場させる」（テイマーのセキュリティ効果等）
  // true のとき JSON へ step.cost_free:true を出力する。対象は 'self' / 'self_card' のとき有効
  costFree?: boolean;
  fromZones?: string[]; // アクションの取得元エリア（'hand' / 'trash' / 'deck' 等）。複数指定可。JSON では step.from
  fromZonesOp?: 'or' | 'and'; // 複数取得元の結合演算子（既定は 'or'）
  // 「～ごとに」倍率設定。perRef を数えて value × floor(count / perCount) を計算
  perCount?: number;  // N体ごとの N（'1体ごと' なら 1）
  perRef?: string;    // カウント対象 subject ('own_digimon' / 'opp_digimon' / 'own_hand' 等)
  perRefStateCond?: ConditionPair; // 状態を表す単一条件（cond_self_rest / cond_no_evo 等）
  perRefFilter?: ConditionPair[]; // カウント時の追加フィルタ（色/タイプ/特徴/Lv 等）
  perCountMode?: 'repeat'; // 'repeat' = N回発動（1枚ごとに1回効果）, undefined = 値×N（既存動作）
  options?: string[]; // 修飾子コード配列（'ignore_cost' / 'face_down' 等、複数可）
  rules?: MiniStep[]; // ルール = ミニ effect step の配列。serialize 時に main action 毎に翻訳されて step に展開
  // 代替アクション: 「〇〇するか〇〇する」のように複数アクションを OR / AND で結ぶ
  // OR: プレイヤーがメインと alt から1つ選んで実行
  // AND: メイン → alt[0] → alt[1] と順次実行
  altActions?: AltAction[];
  altActionsOp?: 'or' | 'and';
  // 付与効果: grant_effect 等で「対象に一時的にトリガー効果を付与する」ためのネスト効果
  // 例: 「自分のデジモン全ては『【アタック時】相手DP-2000』を得る」
  grantedStep?: GrantedStep;
  extras?: string; // フリー入力 JSON 文字列
  targetFilter?: ConditionPair[]; // アクション対象の絞り込み → step.filter に serialize
}

// 付与される効果（grant_effect 用のネスト 1ステップ）
// 単純な単一トリガー＋単一アクションの組合せ。複雑な多段付与は extras で対応
export interface GrantedStep {
  trigger: string;                  // 'on_attack' / 'on_play' / 'main' 等
  action: string;
  value?: number | string;
  target?: string;
  duration?: string;
  conditions?: ConditionPair[];
  options?: string[];
}

// 代替アクション（メインアクションと OR / AND で結合される簡易 step）
export interface AltAction {
  action: string;
  value?: number | string;
  target?: string;
  // 発動可否のみを判定する条件（対象選択のフィルタには使わない・複数指定でAND）。
  // 「〜のとき、代わりに〜する」のように、この代替アクションが自動選択される
  // 条件を表す。メイン側にgateが無く、alt側にgateがあって条件成立していれば、
  // メインの代わりにこちらが自動実行される（ネガモン等）
  gateConditions?: ConditionPair[];
  conditions?: ConditionPair[];
  options?: string[];
  fromZones?: string[];
  fromZonesOp?: 'or' | 'and';
  // 期間・倍率（AND実行時の追加設定）
  duration?: string;
  perCount?: number;
  perRef?: string;
  perCountMode?: 'repeat';
  perRefFilter?: ConditionPair[];
}

// ルール = メインアクションに紐づく「ミニ effect step」
// 構造はメインの effect step と同じだが、編集 UI ではコンパクト表示
// recipe.ts で メインアクション毎の翻訳ルール (B方式) に従って既存 JSON 形式へ変換される
export interface MiniStep {
  action: string;                   // アクション (dict.actions から)
  target?: string;                  // 対象 (TARGETS から、任意)
  type?: string;                    // タイプ（デジモン / テイマー / オプション / 全カード = ''）
  value?: number | string;          // 値（枚数 / variant コード / 'all' / 任意の文字列）
  conditions?: ConditionPair[];     // フィルタ条件（複数 AND）
  options?: string[];               // 修飾子コード配列
  // 「残ったカード全てに対して」フラグ。例: deck_open 時は return_to の指定として解釈される
  isRemaining?: boolean;
}

export interface CardData {
  cardNo: string;
  name: string;
  type?: string;
  color?: string;
  lv?: string;
  effectText?: string;
  evoText?: string;
  securityText?: string;
  recipe?: string; // 既存レシピ JSON 文字列
}

export interface DictEntry {
  code: string;
  kind: string; // 'trigger' | 'condition' | 'action' | 'keyword' | 'option' | 'duration' | 'target' | 'section' | 'limit'
  label: string;
  // アクション/キーワード のときのみ使う仕様欄
  visualType?: string;      // 演出タイプ（'数値ポップアップ' 等）
  visualCode?: string;      // 演出コード（'popup_plus' 等）
  autoManual?: string;      // '自動' | '手動' | '自動（対象選択は手動）' 等
  manualDesc?: string;      // 手動操作の説明
  frameColor?: string;      // 枠色
  valueLabel?: string;      // 数値の意味
  description?: string;     // ルール説明（キーワード公式テキスト等）
  isPassive?: boolean;      // キーワードが passive flag として動作するか
  logicCode?: string;       // ロジック alias: 既存実装済アクションのコード
  // アクション辞書専用: このアクションが選ばれたとき、レシピエディタで「+ ルール」ボタンを表示する
  // ルール = アクションに紐づく追加 effect step（selections/return_to 等を組み立てる）
  allowsRules?: boolean;
  // アクション辞書専用: 「位置」(上から/下から/選んで) のサブプルダウンを表示する
  // 例: code='security_trash' + hasPositionVariant=true → 位置pulldownで _top/_bottom/_select を選ぶ
  // 保存時のJSON action コード = base + '_top' / '_bottom' / '_select' に自動結合
  hasPositionVariant?: boolean;
}

// コスト1ステップ（〇〇することで...の "〇〇する" 部分）
export interface CostStep {
  action: string;
  value?: number | string;
  target?: string;
  // コスト対象の絞り込み条件（例: 進化元のLv.6のデジモンを手札に戻す → cond_lv:6）
  conditions?: ConditionPair[];
  // コスト対象の取得元エリア（'evo_source' / 'hand' / 'trash' 等）。複数指定可
  fromZones?: string[];
  fromZonesOp?: 'or' | 'and';
}

// 演出タイプ自体の定義（小辞書）
export interface VisualTypeEntry {
  code: string;             // 'popup_plus' / 'card_destroy' 等
  label: string;            // '数値ポップアップ' / '消滅演出' 等
  description?: string;     // どういう動きか（実装ガイド）
  defaultColor?: string;    // デフォルト枠色
}
