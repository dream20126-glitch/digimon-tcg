# デジモンカードゲーム - プロジェクト設定

## 概要
デジモンカードゲームのデッキビルダー＋オンライン対戦アプリ。
GitHub Pages + Firebase Realtime DB + GAS(スプレッドシート) で構成。

## 技術スタック
- フロントエンド: HTML/CSS/JS（バニラ、フレームワークなし）
- データ: GAS REST API → スプレッドシート
- リアルタイム通信: Firebase Realtime Database
- 画像: Google Drive thumbnail直リンク
- ホスティング: GitHub Pages（予定）

## ファイル構成
- `index.html` - エントリポイント（ログイン・トップメニュー）
- `pages/` - 各画面のHTML
- `css/` - 画面ごとのCSS
- `js/` - 画面ごとのロジック（ESモジュール）
- `js/firebase-config.js` - Firebase初期化 + GAS APIヘルパー
- `js/cards.js` - カードデータ取得・画像URL変換

## 重要ルール
- バトル画面の実装時は必ず `docs/battle-spec.md` を参照すること
- `google.script.run` は使わない（GAS REST API `gasGet()` / `gasPost()` を使う）
- 画像は Drive 直リンク（`drive.google.com/thumbnail?id=`）を使う。Base64変換しない
- CSSは画面ごとに分離（`css/battle.css` 等）

## GAS API
- GET: `gasGet('action名', { パラメータ })` → JSONレスポンス
- POST: `gasPost('action名', { ボディ })` → JSONレスポンス
- デプロイURL は `js/firebase-config.js` 内の `GAS_URL` で管理
