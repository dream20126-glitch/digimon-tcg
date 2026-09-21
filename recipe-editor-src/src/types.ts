// 効果ブロックで使う条件1個のペア
export interface ConditionPair {
  base: string; // condition code (cond_xxx)
  value?: string; // 数値 or サブ条件コード
  subject?: string; // 条件対象: '' = アクション対象 / 'self' / 'own' / 'other_own' / 'opp' / 'opp_blocker' 等
}

// 「対象」の絞り込み条件＋枚数を1組にしたもの。アセンブリのように「TBかつLv3を1枚、
// TBかつLv4を1枚、TBかつLv5を1枚」のように条件が異なる複数組を要求するキーワードに
// 対応するため、KeywordEntry.designatedGroups は複数保持できる
export interface DesignatedGroup {
  // 「名前/Lv/記述/色」カテゴリで「異なる」バリアントを選ぶと、通常の値付き条件の代わりに
  // cond_name_distinct 等のプレースホルダーがここに混ざる（値は不要）。ビルド時に
  // これらだけ抜き出して distinct_by（下記の説明）に変換し、通常のcondition/when/
  // extra_conditionsには含めない
  conditions: ConditionPair[];
  conditionsOp?: 'and' | 'or';
  count?: number | string;
}

// パッシブ/キーワード付与で複数キーワードを1ブロックにまとめる際の1件分
export interface KeywordEntry {
  keyword: string;
  value?: number | string;
  // 「対象」の絞り込み条件＋枚数の組。複数指定可（例: アセンブリでLv違いの条件を
  // 複数並べる場合）。1組だけの場合は後方互換のため keywordParamConditions/count
  // （下記）と同じJSON出力になる
  designatedGroups?: DesignatedGroup[];
  // 全グループに共通する絞り込み条件（例:「特徴TB」を各グループで繰り返し書かなくて済むように）。
  // 保存時に各グループの条件へAND結合で合成してから出力する（JSON上は各グループの
  // condition/when/extra_conditionsに展開済みの形で出るだけで、共通条件という概念自体は
  // JSONには残らない＝エディタ入力の利便性のためだけの機能）
  commonConditions?: ConditionPair[];
  commonConditionsOp?: 'and' | 'or';
  // 後方互換用（designatedGroupsが無い/1組のときの単純ケース）
  keywordParamConditions?: ConditionPair[];
  keywordParamConditionsOp?: 'and' | 'or';
  // アセンブリ等、絞り込んだカードを何枚使うか（省略時は1枚として扱う想定）。
  // JSONへは p.count / step.count として出力する
  count?: number | string;
}

// 効果ブロック1ステップの構造（コードブロックシートと同等）
export interface EffectBlock {
  section: 'main' | 'evo_source' | 'security' | 'link';
  // この効果ステップが「デジモンとしての効果」か「オプションとしての効果」かのメモ書き。
  // デュアルカードのように1枚のカードにオプション使用時の効果とデジモン側の効果が
  // 混在する場合、trigger='main'だけでは（オプション使用時のmainとデジモンの起動効果の
  // main、両方に使われるコードのため）どちらの意味かが分かりにくいので、
  // 編集時の目印として記録する。エンジンは参照しない（保存はするが動作に影響しない）
  asType?: 'digimon' | 'tamer' | 'option';
  zone?: string; // '' | 'security' | 'trash' | 'hand' | 'breed'
  trigger: string; // code (e.g., 'on_play', 'during_own_turn', 'passive', 'main')。複数選択時はtriggers[0]と一致させる
  // トリガーの複数選択（例: 登場時/進化時どちらでも同じ効果）。2件以上のときのみ意味を持つ。
  // blocksToRecipeで各コードごとに同じstepを複製して出力する。1件以下ならtriggerのみを見る
  triggers?: string[];
  // '' = このデジモン / 'own' / 'other_own' / 'opp' / 'own_tamer' / 'both'（自分/相手どちらでも。
  // 「デッキが増えたとき」のようにデジモン/カード/テイマー等に分解できないゾーン系トリガー用）
  triggerSubject?: string;
  limit?: string; // '' | 'once_per_turn'
  // トリガー条件: トリガー発火元のカード（登場/消滅したカード等）に対するフィルタ
  // 「黄のLv.3デジモンが登場したとき」等の "このトリガーが発火する条件" を表現。
  // 複数トリガー選択時は原則この1つを全トリガーで共有する（従来通り）
  triggerConditions?: ConditionPair[];
  // トリガーごとに発動ターン（自分/相手/お互い）を個別設定したい場合に使う
  // （例:「登場時」は無条件、「相手のメインフェイズ開始時」だけ相手ターン限定、
  // のように同じブロック内で異なる発動ターンを混在させたいケース）。
  // キーはtriggers[]内のイベント系トリガーコード（on_play等。timing系ファミリーの
  // バリアントコードは対象外＝発動ターンは元々コード自体に自分/相手/お互いが
  // エンコードされているため不要）。値: 'self'=自分のターンのみ / 'opp'=相手のターンのみ /
  // 'any'=どちらでも（無条件）。エントリが無いトリガーは triggerConditions（共有）に従う
  triggerTimingByCode?: Record<string, 'self' | 'opp' | 'any'>;
  conditions?: ConditionPair[]; // 0〜N個の条件（self や全体状況に対するゲート）
  // 複数条件の結合方法。既定'and'=全部満たす／'or'=いずれか1つ満たす。
  // JSON では conditions.length>=2 のときだけ step.condition_op:'or' として出力する
  conditionsOp?: 'and' | 'or';
  costs?: CostStep[]; // 0〜N個のコスト（〜することで）
  duration?: string;
  action?: string;
  value?: number | string;
  target?: string; // 'self' | 'own:1' | 'opponent:all' 等
  keyword?: string;
  // 選んだキーワードの辞書側hasNamedParam=trueのときのみ出現する「対象」の絞り込み条件。
  // 発動条件と同じボタン配列(特徴/名称/記述/Lv等)+AND/ORで組み立てる。JSON自体には
  // 出力せず、保存時にrecipeTemplate内のcond_designated_nameが現れるstepの
  // condition/when/extra_conditions/condition_opを、これで丸ごと置き換えるためだけに使う
  // （エディタ内限定の値）
  keywordParamConditions?: ConditionPair[];
  keywordParamConditionsOp?: 'and' | 'or';
  // アセンブリ等、絞り込んだカードを何枚使うか（keywordEntries[0].count のミラー。
  // 省略時は1枚として扱う想定）。JSONへは p.count / step.count として出力する
  keywordCount?: number | string;
  // 「対象」の絞り込み条件＋枚数を複数組指定する場合（keywordEntries[0].designatedGroups
  // のミラー）。2組以上あればこちらを優先し、上の keywordParamConditions*/keywordCount は
  // 無視される
  keywordDesignatedGroups?: DesignatedGroup[];
  // 全グループ共通の絞り込み条件（keywordEntries[0].commonConditions のミラー）
  keywordCommonConditions?: ConditionPair[];
  keywordCommonConditionsOp?: 'and' | 'or';
  // 複数キーワード選択（パッシブ/キーワード付与 共通）。1件のブロックで複数のキーワードを
  // 同時に持たせたい場合（例: 進化元効果で【貫通】【分離】を両方常に持つ）に使う。
  // これが1件以上あればこちらを優先し、上の keyword/value/keywordParamConditions*は
  // 無視される（後方互換のためkeyword単体のブロックも引き続き動作する）。
  // 保存時、passiveは配列の各要素をそのまま1件ずつ container.passive に積む。
  // grant_keyword(_to)は1件目を通常のstepに、2件目以降は「同じ対象に付与」するため
  // target:'same_target'（single-target選択時のみ）の独立stepとして同じtrigger配列に積む
  keywordEntries?: KeywordEntry[];
  // memory_plus 専用:「メモリー+Nする。このターン終了時、メモリーを-Nする。」
  // true のとき JSON へ step.revert_at_turn_end:true を出力する
  revertAtTurnEnd?: boolean;
  // immune_effects 専用（action==='immune_effects'の時のみ意味を持つ）:「相手の効果を
  // 受けない」の対象範囲。省略/'' = 相手の効果全て（デジモン/テイマー/オプション問わず）。
  // 'digimon' = 相手の「デジモン」の効果のみ（テイマー/オプションの効果は防がない）。
  // JSONへはtrueのときのみ step.source_type:'digimon' として出力する
  immuneCardType?: 'digimon' | '';
  // summon 専用:「このカードをコストを支払わずに登場させる」（テイマーのセキュリティ効果等）
  // true のとき JSON へ step.cost_free:true を出力する。対象は 'self' / 'self_card' のとき有効
  costFree?: boolean;
  // summon_from_trash 専用:「この効果で登場したデジモンの【登場時】効果は発揮しない」
  // true のとき JSON へ step.skip_on_play:true を出力する
  skipOnPlay?: boolean;
  // 「〜できる」= 任意効果。true のとき JSON へ step.optional:true を出力する。
  // エンジンは発動前に「発動しますか？」の確認ダイアログを挟む（未指定/falseは強制効果）
  optional?: boolean;
  // 効果発動ポップアップ（確認ダイアログ/アナウンス演出）に表示するテキストの明示指定。
  // 空欄なら効果テキストから自動抽出（該当トリガー部分を推測）にフォールバックする。
  // JSON では step.display_text を出力する
  displayText?: string;
  // true のとき、このステップの効果発動ポップアップ自体を表示しない
  // （任意効果の確認ダイアログには影響しない。強制効果のアナウンス演出のみ省略）
  // JSON では step.no_announce:true を出力する
  noAnnounce?: boolean;
  // 演出の枠色・演出タイプの明示指定。空欄ならアクションコードの命名パターンから
  // 自動推測される（例: dp_plus→緑、destroy→赤 等）。特定のカードだけ演出を変えたい
  // 場合の上書き用オプション。JSON では step.frame_color / step.visual_type を出力する
  frameColor?: string;
  visualType?: string;
  fromZones?: string[]; // アクションの取得元エリア（'hand' / 'trash' / 'deck' 等）。複数指定可。JSON では step.from
  fromZonesOp?: 'or' | 'and'; // 複数取得元の結合演算子（既定は 'or'）
  // 取得元エリア（fromZones）がどちらのプレイヤーのものか（未指定=自分/相手どちらでも）。
  // JSON では step.from_owner ('self'/'opponent') に serialize
  fromZoneOwner?: 'self' | 'opponent';
  // 【〇〇が増えたとき】(trigger:'when_deck_increase') 専用: どのゾーンが増えたときに
  // 発火するか。fromZones/fromZonesOpと全く同じ形・同じUIを使い回す（複数選択可）。
  // JSON では step.zone_increase（1件→string / 2件以上→array + zone_increase_op）
  zoneIncrease?: string[];
  zoneIncreaseOp?: 'or' | 'and';
  // 取得元エリアに「進化元」(evo_source) を含む場合のみ有効: どのデジモンの進化元から探すか。
  // 'self'=このデジモン / 'other'=他のデジモン / 未指定=指定なし（絞り込まない）
  // JSON では step.evo_source_owner に serialize
  evoSourceOwner?: 'self' | 'other';
  // 取得元エリアに「セキュリティ」/「進化元」を含む場合のみ有効: それぞれ積み重ね順の
  // 上/下どちらから見るか（未指定=絞り込まない）。JSON では
  // step.security_position / step.evo_source_position に serialize
  securityPosition?: 'top' | 'bottom';
  evoSourcePosition?: 'top' | 'bottom';
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
  altActionsOp?: 'or' | 'and' | 'then';
  // 付与効果: grant_effect 等で「対象に一時的にトリガー効果を付与する」ためのネスト効果
  // 例: 「自分のデジモン全ては『【アタック時】相手DP-2000』を得る」
  grantedStep?: GrantedStep;
  extras?: string; // フリー入力 JSON 文字列
  targetFilter?: ConditionPair[]; // アクション対象自身の絞り込み（例:レスト状態のこのデジモン）→ step.filter に serialize
  // 進化/登場アクション専用。対象＝このカード自身であっても、取得元エリア（手札等）から
  // 選ぶカードの絞り込みは別物（例:「手札の『クロノモン』の記述があるデジモンカード」）
  // なので targetFilter とは別データとして持つ → step.from_filter に serialize
  fromFilter?: ConditionPair[];
  // アクション辞書の hasDeckPosition=true のアクション専用（例: return_deck）。
  // JSON では step.position ('top'/'bottom') に serialize。'both' はエンジン未対応
  // （'top' 以外は全て下扱いになるため、選ぶと実際は「下」と同じ動作になる）
  deckPosition?: 'top' | 'bottom' | 'both';
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
  conditionsOp?: 'and' | 'or';
  options?: string[];
  fromZones?: string[];
  fromZonesOp?: 'or' | 'and';
  // 取得元エリア（fromZones）がどちらのプレイヤーのものか（未指定=自分/相手どちらでも）。
  // JSON では from_owner ('self'/'opponent') に serialize
  fromZoneOwner?: 'self' | 'opponent';
  // 辞書の hasDeckPosition=true のアクション専用（例: return_deck）。JSON では
  // 対応するstep（alt_actions[]の要素、または'then'モード時は独立した後続step）の
  // position ('top'/'bottom') に serialize
  deckPosition?: 'top' | 'bottom' | 'both';
  // 取得元エリアに「セキュリティ」/「進化元」を含む場合のみ有効: それぞれ積み重ね順の
  // 上/下どちらから見るか（未指定=絞り込まない）。JSON では
  // security_position / evo_source_position に serialize
  securityPosition?: 'top' | 'bottom';
  evoSourcePosition?: 'top' | 'bottom';
  // 期間・倍率（AND実行時の追加設定）
  duration?: string;
  perCount?: number;
  perRef?: string;
  perCountMode?: 'repeat';
  perRefFilter?: ConditionPair[];
  // summon/summon_from_trash/evolve/summon_from_evo_source/link 専用（効果1と同じ）。
  // true のとき JSON へ cost_free:true / skip_on_play:true を出力する
  costFree?: boolean;
  skipOnPlay?: boolean;
  // 対象自身の絞り込み（→ step.filter）・取得元エリアから選ぶカードの絞り込み
  // （→ step.from_filter）。効果1のtargetFilter/fromFilterと同じ意味・同じ変換ルール
  targetFilter?: ConditionPair[];
  fromFilter?: ConditionPair[];
  // コスト（「〇〇することで」発動）。効果1のcostsと同じ意味・同じ変換ルール
  costs?: CostStep[];
  // 「その後」で繋いだこの効果だけを独立して任意にする（例:「DP+3000し、その後
  // そのデジモンでアタックできる」で、DP+3000は強制・アタックだけ任意にしたい場合）。
  // 効果1のoptionalと同じ意味でJSONへstep.optional:trueを出力するが、確認ダイアログを
  // 「ブロック全体でまとめて1回」ではなくこの効果だけ独立させて出すには、エンジン側の
  // 対応（このAltAction由来のstepを実行する箇所を、ブロック全体のisOptional判定から
  // 切り離して個別に確認する）が別途必要（未実装）。JSON上は正しく区別して保存できる
  optional?: boolean;
}

// MiniStep.designatedGroups 専用: 通常のDesignatedGroup（条件+枚数）に加えて、
// グループごとに異なる置き先（action）を持たせられる。例:「1枚を手札に加え、
// 1枚をセキュリティの上に置く」を1ルール行の中の2グループとして表現する。
// action/deckPosition/optionsを省略した場合はルール本体（MiniStep側）の値を使う
export interface RuleGroup extends DesignatedGroup {
  action?: string;
  deckPosition?: 'top' | 'bottom' | 'both';
  options?: string[];
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
  options?: string[];               // 修飾子コード配列（'face_down' 等）
  // 「残ったカード全てに対して」フラグ。例: deck_open 時は return_to の指定として解釈される
  isRemaining?: boolean;
  // 「〇〇に置く」(PLACE_ZONE_MAP。action が place_on_security_top/place_under_tamer/
  // place_under_digimon 等のとき) 専用: 上/下/下か上。ruleTranslator が
  // selections[].position（無指定時は従来通りアクションコード自体で決定）に反映する
  deckPosition?: 'top' | 'bottom' | 'both';
  // 1つのルールの中に「条件＋枚数」の組を複数持たせたい場合（例:「特徴TBを持つカード1枚と、
  // 緑のカード1枚」、さらにグループごとに置き先を変えて「1枚を手札に加え、1枚を
  // セキュリティの上に置く」）に使う。指定時は conditions/value の代わりにこちらを使い、
  // グループの数だけ selections[] を積む（grant_keyword等のdesignatedGroupsと同じ仕組み）。
  // 空/未指定時は従来通り conditions + value の単一条件として扱う
  designatedGroups?: RuleGroup[];
  // 全グループ共通の絞り込み条件（designatedGroupsが2件以上のときのみ意味を持つ）
  commonConditions?: ConditionPair[];
  commonConditionsOp?: 'and' | 'or';
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
  // アクション辞書専用: このアクションを選んだとき、レシピエディタで「場所」(取得元エリア =
  // 手札/トラッシュ/デッキ/セキュリティ/進化元) ボタンを表示する。例: summon / bounce
  hasFromZones?: boolean;
  // アクション辞書専用: このアクションを選んだとき、レシピエディタで「上/下」ボタン
  // (デッキに戻す位置等) を表示する。hasPositionVariant とは別物:
  // アクションコード自体は変えず、block.deckPosition ('top'/'bottom'/'both') → step.position
  // というフィールドで表現する（例: return_deck）。'both'（両方選択=どちらか選んで）は
  // エンジンが step.position の値を 'top' 以外は全て「下」として扱うため未対応
  hasDeckPosition?: boolean;
  // アクション辞書専用（コストのみ）: このアクションを選んだとき、コストエディタで
  // 「裏向き/表向き」ボタンを表示する。既存の options コード 'face_down' を
  // CostStep.options に書き込む（例: place_under_tamer「テイマーの下に置く」）
  hasFaceOption?: boolean;
  // アクション辞書専用: このアクションを選んだとき、レシピエディタで「する/できない」トグルを
  // 表示する。「できない」を選んだ場合、実際に保存されるアクションコードはこのコードに切り替わる
  // （例: code='rest' + cantActionCode='cant_rest'）。空欄なら「する/できない」表示なし
  cantActionCode?: string;
  // キーワード辞書専用: このキーワードの実体となるレシピ（EffectBlock[]をJSON文字列化したもの）。
  // カード側はこのレシピをベタ展開せず、常にキーワードの「コード」参照のみを保存する
  // （passive:[{flag}] / grant_keyword+keyword）。実際の展開はゲームエンジン側が、
  // 対戦中にキーワード辞書（このrecipeTemplate。data/cards.json同梱のkeywords経由で取得）を
  // 見に行って行う。エンジンが未対応の出来事（アクティブフェイズ開始時等）しか表現できない
  // キーワードは、これを空欄のままにする
  recipeTemplate?: string;
  // キーワード辞書専用: このキーワードを選ぶと、カード側に「対象」の絞り込み条件欄が出現する。
  // 組み立てた条件一式はカード側のstepに designated として保存され（recipeTemplateの中身は
  // 置き換えない）、recipeTemplate内のcond_designated_name（プレースホルダー条件）を持つstepの
  // 条件一式への置き換えは、ゲームエンジンが実行時に行う（例:「分離」の「指定のリンクカード」等、
  // キーワードごとにカードで対象が異なる場合に使う）
  hasNamedParam?: boolean;
}

// コスト1ステップ（〇〇することで...の "〇〇する" 部分）
export interface CostStep {
  action: string;
  value?: number | string;
  target?: string;
  // コスト対象の絞り込み条件（例: 進化元のLv.6のデジモンを手札に戻す → cond_lv:6）
  conditions?: ConditionPair[];
  conditionsOp?: 'and' | 'or';
  // コスト対象の取得元エリア（'evo_source' / 'hand' / 'trash' 等）。複数指定可
  fromZones?: string[];
  fromZonesOp?: 'or' | 'and';
  // 取得元エリア（fromZones）がどちらのプレイヤーのものか（未指定=自分/相手どちらでも）。
  // JSON では step.cost[].from_owner ('self'/'opponent') に serialize
  fromZoneOwner?: 'self' | 'opponent';
  // 上/下（デッキに戻す/セキュリティに置く 用）。JSON では step.cost[].position に serialize。
  // 'both' はエンジン未対応（'top' 以外は全て「下」/常に「上」扱いになる）
  deckPosition?: 'top' | 'bottom' | 'both';
  // 取得元エリア（fromZones）に「セキュリティ」/「進化元」を含む場合のみ有効: それぞれ
  // 積み重ね順の上/下どちらから見るか（未指定=絞り込まない）。JSON では
  // step.cost[].security_position / evo_source_position に serialize
  securityPosition?: 'top' | 'bottom';
  evoSourcePosition?: 'top' | 'bottom';
  // 修飾子コード配列（'face_down' 等）。辞書側 hasFaceOption=true のアクション選択時のみ
  // 「裏向き/表向き」ボタンとして編集可能になる（例:「テイマーの下に裏向きで置く」コスト）
  options?: string[];
  // 代替コスト:「〇〇するか、〇〇することで」のように、このコストの代わりに使える
  // 別のコストを複数登録できる。JSON では step.cost[].alt_actions として出力する
  // （効果の代替アクション(altActions)と全く同じ機構・同じエンジン処理を流用しており、
  // 対戦中はプレイヤーがどちらのコストを払うか選択UIで選ぶ。現状は「いずれか1つ」の
  // 意味しかないため、効果側と異なりop（and/or/then）は持たない）
  altCosts?: CostStep[];
}

// 演出タイプ自体の定義（小辞書）
export interface VisualTypeEntry {
  code: string;             // 'popup_plus' / 'card_destroy' 等
  label: string;            // '数値ポップアップ' / '消滅演出' 等
  description?: string;     // どういう動きか（実装ガイド）
  defaultColor?: string;    // デフォルト枠色
}
