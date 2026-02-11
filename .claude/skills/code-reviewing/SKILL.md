---
name: code-reviewing
description: コードレビューの専門スキル。5段階レビュープロセス（初期分析→詳細分析→ベストプラクティス参照→統合評価→品質検証）でコード品質・セキュリティ・パフォーマンスを評価。  (1) PR番号やURLを指定したPRレビュー、(2) git差分（staged, main...feature等）のレビュー、(3) 既存レビューファイルのメタレビュー、(4) plan-creatingで作成したプラン（ai/plans/*.md）のレビュー、のいずれかが必要な場合に使用。コード調査のみの場合、単一ファイルの簡単な質問、lintチェックのみの場合には使用しない。
---

# Code Reviewing

コード品質・セキュリティ・パフォーマンス・テスト・設計を5段階プロセスで体系的に評価し、エビデンス付きフィードバックを提供する。

## 5段階レビュープロセス

### Phase 1: 初期分析

入力種別に応じてレビュー対象を取得する。

- **PR番号/URL**: `gh pr view <number>` でPR情報取得、`gh pr diff <number>` で変更内容を確認
- **git差分**: 指定コマンド（例: `git diff --staged`, `git diff main...feature`）で差分取得。範囲未指定の場合: staged変更あり→`--staged`、なし→デフォルトブランチとの差分（`git symbolic-ref refs/remotes/origin/HEAD` でブランチ名を検出し `<branch>...HEAD` を使用）
- **メタレビュー**: 指定レビューファイルを `Read` で読み込み
- **プランレビュー**: 指定プランファイル（`ai/plans/*.md`）を `Read` で読み込み。評価観点は [references/plan-review-guidelines.md](references/plan-review-guidelines.md) を参照

### Phase 2: 詳細分析

`Read`/`Grep` で変更ファイルを分析し、依存関係・影響範囲を追跡する。

種別ごとの読み替え:
- **メタレビュー**: 元のレビューが対象としたコードを `Read`/`Grep` で確認し、指摘の正確性（ファイル存在・行番号一致・コード引用の正確さ）を検証する
- **プランレビュー**: プランが参照する対象ファイルを確認し、前提（ファイル構造・既存実装・依存関係）が実態と一致するか検証する（詳細は [references/plan-review-guidelines.md](references/plan-review-guidelines.md)）

### Phase 3: ベストプラクティス参照

Claudeの既存知識で十分な場合はスキップ可。特定のフレームワーク・ライブラリの最新仕様確認が必要な場合、以下の優先順位でドキュメントを取得する:

1. **context7 MCPツール**（推奨）: `resolve-library-id` でライブラリIDを解決後、`query-docs` でドキュメント・コード例を取得。ライブラリ固有のベストプラクティス確認に最適
2. **WebFetch**: context7で対応できないドキュメント（OWASP等のセキュリティガイドライン、RFC仕様等）の取得に使用
3. **Claude知識**: 上記いずれも利用不可の場合のフォールバック

注意:
- context7ツールはdeferred toolのため、使用前に `ToolSearch` で読み込むこと
- Phase 2完了時点で指摘を一度仮分類し、🔴高/🟡中のうち「仕様・ベストプラクティス確認が必要」なものだけをPhase 3対象に絞る
- context7は1質問あたり各ツール3回までの制限あり（コンテキストウィンドウ節約のための運用ルール。ツール仕様上の制限ではない）。制限に達した/超過した場合は **WebFetchにフォールバック**（それでも取得できない場合のみClaude知識で補完）

### Phase 4: 統合評価

Phase 1-3の情報を統合し、観点別に評価する。エビデンス付与率の基準は [references/feedback-format.md](references/feedback-format.md) を参照。

### Phase 5: 品質検証

[references/checklist.md](references/checklist.md) に基づきレビュー結果を自己検証する。

## 出力規約

- レビュー結果は `ai/reviews/` に保存する
- ファイル命名: `YYMMDD_HHmm_[概要]_レビュー.md`（`HHmm` はJST/UTC+9）
- テンプレート:
  - **PR / git差分 / メタレビュー**: [assets/review-template.md](assets/review-template.md)
  - **プランレビュー**: [assets/plan-review-template.md](assets/plan-review-template.md)

## リファレンス

- **コードレビュー観点・評価基準**: [references/review-guidelines.md](references/review-guidelines.md) - 品質/セキュリティ/パフォーマンス/テスト/設計の評価基準と星評価の基準
- **プランレビュー観点・評価基準**: [references/plan-review-guidelines.md](references/plan-review-guidelines.md) - 完全性/実現可能性/タスク設計/測定可能性/リスク対応の評価基準
- **フィードバック形式**: [references/feedback-format.md](references/feedback-format.md) - エビデンスベースの指摘形式とエビデンス付与率の基準
- **出力テンプレート（コードレビュー）**: [assets/review-template.md](assets/review-template.md) - レビュー結果の構造化テンプレート
- **出力テンプレート（プランレビュー）**: [assets/plan-review-template.md](assets/plan-review-template.md) - プランレビュー結果の構造化テンプレート
- **自己検証チェックリスト**: [references/checklist.md](references/checklist.md) - レビュー完了前の確認項目
