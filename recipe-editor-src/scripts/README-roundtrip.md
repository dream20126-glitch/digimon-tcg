# レシピ往復検査（保存で設定が消えないかの確認）

レシピの項目を追加・変更したら、コミット前に次の2つを実行して差分を確認する。

## 1. 全レシピの往復（roundtrip-all.ts）
スプシの全カードのレシピを「読込→保存」し、元と比べる。

```sh
# 辞書とカード一覧を取得（読み取りのみ）
GAS=https://script.google.com/macros/s/AKfycbxB3kIy-fSGrGfJm65RWaNxGGvpCeF0GqrqGitXT7yBRLZE9LtW-SbpOqydxTLgDKf8/exec
curl -sL "$GAS?action=listDict" -o /tmp/dict.json
curl -sL "$GAS?action=getCardList" -o /tmp/cardlist.json
npx esbuild scripts/roundtrip-all.ts --bundle --platform=node --outfile=/tmp/rtall.js
node /tmp/rtall.js /tmp/dict.json /tmp/cardlist.json /tmp/rtall.txt
```

既知の「意味は同じ」差分は以下で、これ以外が出たら調べる。
- flag/keyword の大文字小文字
- cond_exists の展開
- lv → lv_le/lv_ge
- from 配列 → 文字列
- selections.optional:false の省略
- app_gattai の materials 追加

## 2. 項目ごとの往復（roundtrip-fields.ts）
types.ts の各項目（EffectBlock / AltAction / CostStep / KeywordEntry / DesignatedGroup）に値を入れて「保存→読込→保存」する。
- `LOST`：読込で消える項目
- `NOSAVE`：保存されない項目（前提条件が揃っていないだけのものも含む）

```sh
npx esbuild scripts/roundtrip-fields.ts --bundle --platform=node --outfile=/tmp/fuzz.js --external:typescript
NODE_PATH=$(pwd)/node_modules node /tmp/fuzz.js /tmp/fuzz.txt
```

`LOST` が0件であること。
