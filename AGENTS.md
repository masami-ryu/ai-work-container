# Codex Instructions

## 共通規約

- 日本語で記述
- Markdown は正しい構文で記述（見出しレベルの順守、リスト前後の空行）
- 成果物の命名: `YYMMDD_HHmm_[概要]`（`HHmm` は JST / UTC+9）
  - 単一ファイル: `YYMMDD_HHmm_[概要].md`（レビュー、Express プラン）
  - ディレクトリ: `YYMMDD_HHmm_[概要]/plan.md`（Standard / Comprehensive プラン）
  - 取得例: `TZ=Asia/Tokyo date +%y%m%d_%H%M`

## 作業ルール

1. **小さな差分**: 1タスク=1目的、レビュー可能なサイズで実装
2. **秘密情報禁止**: ログ・API キー・SSH 情報は貼らない

## 運用ルール

- Node.js 系の依存関係管理・スクリプト実行は **npm ではなく pnpm** を使う
  - 例: `pnpm install`, `pnpm build`, `pnpm test`
- `ai/reviews`、`ai/plans` は既存ディレクトリのため、`mkdir` は実行しない
  - レビュー結果: `ai/reviews/<ファイル名>.md` に保存
  - プラン: `ai/plans/<ファイル名>.md` または `ai/plans/<ディレクトリ名>/plan.md` に保存
- **保存先の基準ディレクトリ**: `ai/` はこの `AGENTS.md` が配置されたディレクトリ直下を指す。作業対象のサブディレクトリ内には作成しない

## Skills

- Canonical path: `.codex/skills`
- Codex compatibility path: `.agents/skills`（`.codex/skills` への symlink）
- スキル編集は `.codex/skills` 側で行うこと

## サブプロジェクト

`works*` は独立したリポジトリ。プロジェクト固有のルールは `works*/AGENTS.md` を参照。
