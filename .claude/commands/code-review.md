---
name: review
description: コードレビューを実施する（PR番号/URL、git diffコマンド、Markdownレビュー結果に対応）
allowed-tools: []
argument-hint: PR番号/URL（例: "#123"）、git diffコマンド（例: "git diff --staged"）、Markdownファイルパス（例: "ai/reviews/251220_pr-123-review.md"）
---

## タスク

`code-reviewer` エージェントを使用してコードレビューを実施します。エージェントが入力形式の判定、情報取得、レビュー実施、結果保存を一貫して処理します。

## 入力形式

このコマンドは以下の3つの入力形式に対応しています（優先順位順）:

### 1. PR番号またはURL（最優先）

PRのレビューを実施します。GitHub CLIを使用してPR情報を取得します。

**形式**:
- `#123` - PR番号のみ
- `123` - 数字のみ（PR番号として解釈）
- `https://github.com/owner/repo/pull/123` - 完全なPR URL

**使用例**:
```
/code-review #123
/code-review https://github.com/facebook/react/pull/456
```

### 2. git差分コマンド

git diffコマンドで指定された変更のレビューを実施します。

**形式**:
- `git diff --staged` - ステージング済み変更
- `git diff main...feature` - ブランチ間差分
- `git diff HEAD~3..HEAD` - コミット範囲

**注意**: `diff --git a/...` 形式の差分テキストの直接貼り付けはサポート対象外です。必ずコマンド文字列を指定してください。

**使用例**:
```
/code-review git diff --staged
/code-review git diff main...feature/auth
/code-review git diff HEAD~3..HEAD
```

### 3. Markdownファイルパス

既存のレビュー結果（`ai/reviews/`内のMarkdownファイル）のメタレビューを実施します。

**形式**:
- `.md` 拡張子を持つファイルパス

**使用例**:
```
/code-review ai/reviews/251220_pr-123-review.md
/code-review ai/reviews/251220_1430_diff-staged_review.md
```

## レビュー結果

レビュー結果は `ai/reviews/` ディレクトリに `YYMMDD_HHmm_[概要].md` 形式で保存されます。

**保存ファイル名の例**:
- PRレビュー: `251224_1430_pr-123_review.md`
- git差分: `251224_1430_diff-staged_review.md`
- メタレビュー: `251224_1430_meta_251220_pr-123-review_review.md`
