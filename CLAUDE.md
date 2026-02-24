# README

## 共通規約

- 日本語で記述
- Markdownは正しい構文で記述（見出しレベルの順守、リスト前後の空行）
- 成果物ファイルの命名: `YYMMDD_HHmm_[概要].md`（`HHmm` はJST / UTC+9）
  - 取得例: `TZ=Asia/Tokyo date +%y%m%d_%H%M`

## 作業ルール

1. **小さな差分**: 1タスク=1目的、レビュー可能なサイズで実装
2. **秘密情報禁止**: ログ・APIキー・SSH情報は貼らない

## 運用ルール

- Node.js 系の依存関係管理・スクリプト実行は **npm ではなく pnpm** を使う
  - 例: `pnpm install`, `pnpm build`, `pnpm test`
- `ai/reviews` は既存ディレクトリのため、`mkdir` は実行しない
  - レビュー結果はそのまま `ai/reviews/<ファイル名>.md` に保存する

## ユーザーへの質問

ユーザーに質問する際は、AskUserQuestion ツールの代わりに MCP ツール `ask_user` を使用すること。
`ask_user` はブラウザのダッシュボードに質問を表示し、ユーザーがブラウザから回答できる。

- `ask_user` がエラー（MCPサーバー未起動、タイムアウト等）の場合のみ `AskUserQuestion` にフォールバック
- `ask_user` の引数形式は `AskUserQuestion` と同様（questions 配列）
- `session_id`（optional）: セッションIDを指定すると正確な紐付けが可能。省略時は最新アクティブセッションを自動検出

## サブプロジェクト

`works*` は独立したリポジトリ。プロジェクト固有のルールは `works*/CLAUDE.md` を参照。
