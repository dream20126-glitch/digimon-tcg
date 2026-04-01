# 効果スクリプト仕様

## 構文
セミコロン区切りのキー:値ペア。複数効果は `|` で区切る。

```
trigger:登場時;type:auto;action:draw,2
trigger:登場時;type:optional;cost:discard,1;action:draw,2
```

## フィールド

| フィールド | 値 | 説明 |
|---|---|---|
| trigger | 登場時/進化時/アタック時/ブロック時/消滅時/自分のターン/自分のターン開始時/自分のターン終了時/相手のターン/相手のターン開始時/メイン/セキュリティ/お互いのターン | 発動タイミング |
| type | auto/optional | auto=強制, optional=任意（「～ことで」「～できる」） |
| cost | discard,N / rest,self / memory,N / none | 発動コスト |
| action | draw,N / memory_plus,N / memory_minus,N / dp_plus,N / dp_minus,N / destroy,N / bounce,N / recover,N / security_attack_plus,N / rest,target / active,self / block / rush / piercing | 効果内容 |
| target | self/opponent/opponent_select,N/all_own/all_opponent | 対象 |
| condition | has_evo_source,N / no_evo_source / level_le,N / dp_le,N | 条件 |
| duration | this_turn / next_opponent_turn / permanent | 持続 |
| limit | turn,1 | 回数制限 |

## キーワード効果
キーワード効果は action のみで表現:
- 【ブロッカー】→ `trigger:passive;action:blocker`
- 【速攻】→ `trigger:passive;action:rush`
- 【突進】→ `trigger:passive;action:piercing`
- 【Sアタック+1】→ `trigger:passive;action:security_attack_plus,1`

## 例

| 効果テキスト | スクリプト |
|---|---|
| 【登場時】2枚ドローする | trigger:登場時;type:auto;action:draw,2 |
| 【ブロッカー】 | trigger:passive;action:blocker |
| 【進化時】相手デジモン1体のDPを-3000する | trigger:進化時;type:auto;action:dp_minus,3000;target:opponent_select,1 |
| 【アタック時】メモリーを-2する | trigger:アタック時;type:auto;action:memory_minus,2 |
| 【メイン】メモリーを+1する | trigger:メイン;type:auto;action:memory_plus,1 |
| 【メイン】DP4000以下の相手デジモン2体を消滅させる | trigger:メイン;type:auto;action:destroy,2;target:opponent_select,2;condition:dp_le,4000 |
| 【自分のターン】DPを+1000する | trigger:自分のターン;type:auto;action:dp_plus,1000;target:self |
