# カードデータ同期の仕組み

## 概要

スプレッドシートで編集 → スクリプトで `data/cards.json` に書き出し → GitHub Pages から静的配信。
クライアントは静的 JSON 優先で読み込み、無ければ GAS にフォールバック。

```
[スプシ編集] ──> [npm run sync-cards] ──> [data/cards.json コミット & push]
                                                     │
                                          GitHub Pages 配信
                                                     │
                                                     ▼
                                       [ブラウザ] fetch('data/cards.json')
                                                     │
                                                     ▼
                                       (失敗時) GAS API にフォールバック
```

## 編集フロー

1. **スプシでカードを追加 / 編集**
2. ローカルで `npm run sync-cards` を実行
   ```bash
   cd digimon-tcg
   npm run sync-cards
   ```
   → `data/cards.json` と `data/cards-version.json` が更新される
3. git で commit & push
   ```bash
   git add data/cards.json data/cards-version.json
   git commit -m "data: カードデータ更新 (XXX枚)"
   git push origin main
   ```
4. GitHub Pages にデプロイ完了 → 全ユーザーが新カードを読み込める

## 仕組みの詳細

### `scripts/sync-cards.js`

- GAS REST API (`getCards`) を Node.js から叩く
- レスポンスをフィールド正規化して `data/cards.json` に書き出し
- `data/cards-version.json` には version (UNIX timestamp) のみ記録 → クライアントの cache buster に使う

### `js/cards.js` `loadCardAndKeywordData()`

- 本番 (GitHub Pages 上): `data/cards.json?v=<version>` を fetch
- 開発 (`localhost`): GAS API を直接叩く（スプシ即反映）
- 静的 JSON が無ければ GAS にフォールバック

### バージョン管理

`data/cards-version.json` の中身:
```json
{ "version": "1777461846731", "exportedAt": "2026-04-30T03:24:06.731Z", "cardCount": 96 }
```

クライアントは起動時に `cards-version.json` を `cache: 'no-store'` で取得し、`cards.json?v=<version>` でリクエスト。これによりブラウザキャッシュが効きつつ、新バージョンは確実に最新が読まれる。

## パフォーマンス

| カード数 | GAS 読み込み | 静的 JSON 読み込み | JSON サイズ |
|---|---|---|---|
| 100 | ~3-7s | ~100ms | ~110 KB |
| 500 | ~5-10s | ~150ms | ~550 KB |
| 1000 | ~10-15s | ~300ms | ~1.1 MB |
| 3000 | タイムアウトの可能性 | ~600ms | ~3.3 MB (gzip後 ~700KB) |

GitHub Pages は自動 gzip するので、実際の転送量はさらに圧縮されます。

## トラブルシュート

### `npm run sync-cards` が失敗する

- GAS の URL が変わった: `scripts/sync-cards.js` の `GAS_URL` を更新
- スプシの `getCards` action が動いていない: GAS スクリプトを確認
- ネットワーク: `--timeout` を増やす

### ローカルで開発中にスプシ即反映したい

`localhost` で開いていれば自動で GAS 直叩きになります。`http://localhost:8765` 等で起動してください。

### 全ユーザーに即反映したい（緊急時）

通常は `data/cards.json` をコミットすれば反映されますが、何らかの理由で旧版が読み込まれる場合：

1. ブラウザのハードリロード (Ctrl+Shift+R) → cards-version.json が `no-store` なので必ず最新を取得
2. それでも問題が出るなら、`index.html` 等の `?v=` cache buster を更新

## 将来の拡張

カード数が 2000 を超えてきたら検討：

- **ブースター単位で分割**: `data/cards-bt1.json` 等に分けて、必要な分だけ load
- **インデックス事前計算**: 名前 / 色 / Lv / 効果検索のインデックスを sync 時に作って同梱
- **Service Worker でオフライン対応**
