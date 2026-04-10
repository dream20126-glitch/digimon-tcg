# 効果レシピ JSON 書式仕様

## 基本構造

```json
{
  "トリガー処理コード": [ ステップ1, ステップ2, ... ],
  "トリガー処理コード": [ ステップ1, ステップ2, ... ]
}
```

1カード = 1つのJSONオブジェクト。トリガーごとに配列を持つ。

---

## ステップの構造

```json
{
  "action": "アクションコード",       // 必須: 何をするか
  "value": 数値,                      // 任意: 数値引数（DP値、枚数等）
  "target": "対象コード",             // 任意: 対象（省略時はアクションのデフォルト）
  "condition": "条件コード:値",        // 任意: 実行条件
  "duration": "持続コード",            // 任意: 持続時間
  "when": "サブトリガーコード",        // 任意: 複合トリガーの内側（例:自分のターン中＋ブロックされた時）
  "optional": true,                    // 任意: 任意発動（「できる」「してもよい」）
  "limit": "limit_once_per_turn",      // 任意: 回数制限
  "flag": "フラグ名",                  // パッシブキーワード用（action不要）
  "separator": "after"                 // 「その後」区切り用
}
```

---

## パッシブキーワード用

パッシブキーワード（【ブロッカー】【速攻】等）はflagで表現：

```json
{ "passive": [{ "flag": "blocker" }] }
{ "passive": [{ "flag": "rush" }] }
{ "passive": [{ "flag": "security_attack_plus", "value": 1 }] }
```

複数キーワードは1つの配列に並べる：
```json
{ "passive": [
  { "flag": "piercing" },
  { "flag": "security_attack_plus", "value": 1 },
  { "flag": "blocker" }
]}
```

---

## 対象(target)の書式

| 書式 | 意味 |
|---|---|
| `"self"` | このデジモン |
| `"own:1"` | 自分のデジモン1体（選択） |
| `"own:all"` | 自分のデジモン全て |
| `"own_security:all"` | 自分のセキュリティデジモン全て |
| `"opponent:1"` | 相手のデジモン1体（選択） |
| `"opponent:2"` | 相手のデジモン2体まで（選択） |
| `"opponent:all"` | 相手のデジモン全て |
| `"other_own:1"` | 自分の他のデジモン1体 |
| `"battle_opponent"` | バトルした相手のデジモン |

---

## 条件(condition)の書式

| 書式 | 意味 |
|---|---|
| `"cond_no_evo"` | 進化元を持たない |
| `"cond_has_evo:4"` | 進化元を4枚以上持つ |
| `"cond_dp_le:4000"` | DP4000以下 |
| `"cond_lv_le:5"` | Lv.5以下 |
| `"cond_exists:cond_no_evo"` | 条件を満たす相手デジモンがいる |
| `"cond_jogress"` | ジョグレス進化していたなら |
| `"cond_battle_destroy"` | バトルで消滅した |
| `"cond_in_battle"` | バトルしている間 |
| `"cond_memory_opponent"` | メモリーが相手側 |

---

## 持続(duration)の書式

| 書式 | 意味 |
|---|---|
| `"dur_this_turn"` | このターンの間 |
| `"dur_next_opp_turn"` | 次の相手ターン終了時まで |
| `"dur_next_own_turn"` | 次の自分ターン終了時まで |
| `"dur_while"` | ～の間（条件が満たされている間） |

---

## 「その後」と「ことで」

### その後（separator: after）
前後を分離。後半は独立で実行可能。

```json
{ "main": [
  { "action": "memory_plus", "value": 1 },
  { "separator": "after" },
  { "action": "draw", "value": 1, "optional": true }
]}
```

### ことで（cost配列）
コスト未払い → 以降全部スキップ。

```json
{ "main": [
  { "cost": [{ "action": "cost_discard", "count": 1 }],
    "action": "destroy", "target": "opponent:1" }
]}
```

---

## 複合トリガー（when）

【自分のターン】+ブロックされた時 のような組み合わせ：

```json
{ "during_own_turn": [
  { "when": "when_blocked", "action": "memory_plus", "value": 3 }
]}
```

---

## 全カードのレシピ例

### パッシブのみ
コアドラモン: 【ブロッカー】
```json
{"passive":[{"flag":"blocker"}]}
```

シリウスモン: 【突進】【Sアタック+1】【ブロッカー】
```json
{"passive":[{"flag":"piercing"},{"flag":"security_attack_plus","value":1},{"flag":"blocker"}]}
```

### 単純トリガー
ガルダモン: 【進化時】このターンの間、自分のデジモン1体のDPを+3000する。
```json
{"on_evolve":[{"duration":"dur_this_turn","target":"own:1","action":"dp_plus","value":3000}]}
```

ハンマースパーク: 【メイン】メモリーを+1する。
```json
{"main":[{"action":"memory_plus","value":1}]}
```

### 条件付き
ガイアフォース: 【メイン】相手のデジモン1体を消滅させる。
```json
{"main":[{"target":"opponent:1","action":"destroy"}]}
```

ギガデストロイヤー: 【メイン】DP4000以下の相手デジモン2体までを消滅させる。
```json
{"main":[{"condition":"cond_dp_le:4000","target":"opponent:2","action":"destroy"}]}
```

### 持続付き
ソローブルー: 【メイン】進化元を持たない相手のデジモン1体を選ぶ。そのデジモンは次の相手ターン終了時までアタックとブロックができない。
```json
{"main":[{"condition":"cond_no_evo","target":"opponent:1","duration":"dur_next_opp_turn","action":"cant_attack_block"}]}
```

### 永続効果
八神太一: 【自分のターン】自分のデジモン全てのDPを+1000する。
```json
{"during_own_turn":[{"target":"own:all","action":"dp_plus","value":1000}]}
```

### 永続+条件+サブトリガー
メタルグレイモン進化元: 【自分のターン】このデジモンがブロックされたとき、メモリーを+3する。
```json
{"during_own_turn":[{"when":"when_blocked","action":"memory_plus","value":3}]}
```

ワーガルルモン進化元: 【自分のターン】進化元を持たない相手のデジモンがいる間、このデジモンは【Sアタック+1】を得る。
```json
{"during_own_turn":[{"condition":"cond_exists:cond_no_evo","duration":"dur_while","target":"self","action":"grant_keyword","flag":"security_attack_plus","value":1}]}
```

### 制限付き
メタルガルルモン: 【アタック時】【ターンに1回】このデジモンをアクティブにする。
```json
{"on_attack":[{"limit":"limit_once_per_turn","target":"self","action":"active"}]}
```

### セキュリティ効果
ハンマースパーク: 【セキュリティ】メモリーを+2する。
```json
{"security":[{"action":"memory_plus","value":2}]}
```

八神太一: 【セキュリティ】このカードをコストを支払わずに登場させる。
```json
{"security":[{"target":"self","action":"summon","cost_free":true}]}
```

シャドーウィング: 【セキュリティ】次の自分のターン終了時まで自分のデジモン全ては、【Sアタック+1】を得る。
```json
{"security":[{"duration":"dur_next_own_turn","target":"own:all","action":"grant_keyword","flag":"security_attack_plus","value":1}]}
```

ギガデストロイヤー: 【セキュリティ】このカードの【メイン】効果を発揮する。
```json
{"security":[{"action":"use_main_effect"}]}
```

### 進化元破棄
ズドモン: 【進化時】相手デジモン1体の進化元を、下から2枚破棄する。
```json
{"on_evolve":[{"target":"opponent:1","action":"evo_discard_bottom","value":2}]}
```

### 「その後」付き
コキュートスブレス: 【メイン】相手のデジモン1体を手札に戻す。そのデジモンの持つ進化元は破棄する。
```json
{"main":[{"target":"opponent:1","action":"bounce"},{"separator":"after"},{"action":"evo_discard_all"}]}
```

### 「ことで」付き（コスト）
カイザーネイル: 【メイン】自分のデジモン1体の進化元のデジモンカードを選び、そのカードをコストを支払わずに別のデジモンとして登場させる。
```json
{"main":[{"target":"own:1","action":"select_evo_source","filter":"デジモン"},{"action":"summon","cost_free":true}]}
```

### 条件付き永続（per_count）
ウォーグレイモン: 【自分のターン】このデジモンが持つ進化元2枚ごとに、このデジモンは【Sアタック+1】を得る。
```json
{"during_own_turn":[{"per_count":2,"ref":"evo_source","target":"self","action":"grant_keyword","flag":"security_attack_plus","value":1}]}
```

### 複数効果欄
効果+進化元+セキュリティの全てにレシピがある場合は、1つのJSONにマージ：
```json
{
  "main": [...],
  "during_own_turn": [...],
  "security": [...]
}
```
