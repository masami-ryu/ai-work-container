---
name: review-input-handler
description: レビュー入力の判定と情報取得を行う専門スキル。PR番号/URL、git diffコマンド、Markdownファイルパスの3形式に対応し、構造化データを返却。
allowed-tools: [Bash, Read]
---

# Review Input Handler

## Contents
- [概要](#概要)
- [主要機能](#主要機能)
- [ワークフロー](#ワークフロー)
- [入出力仕様](#入出力仕様)
- [Guidelines](#guidelines)
- [Limitations](#limitations)

## 概要

このスキルはレビュー対象の入力を受け取り、形式を判定して必要な情報を取得し、構造化データとして返却します。code-reviewコマンドから呼び出され、レビュー実施に必要な差分情報や変更ファイル一覧を準備します。

### 役割

- **入力形式の判定**: PR番号/URL、git diffコマンド、Markdownファイルパスを自動判別
- **情報取得**: 各形式に応じたコマンド実行（gh, git, Read）
- **データ構造化**: review_target_type と review_context を含む統一フォーマットで返却

## 主要機能

### 1. 入力形式判定（優先順位順）

| 優先順位 | 形式 | 判定パターン | 例 |
|---------|------|------------|-----|
| 1 | PR URL | `https://github.com/.*/pull/[0-9]+` | `https://github.com/owner/repo/pull/123` |
| 2 | PR番号（#付き） | `^#[0-9]+$` | `#123` |
| 3 | PR番号のみ | `^[0-9]+$` | `123` |
| 4 | git diffコマンド | `^git diff` | `git diff --staged` |
| 5 | Markdownファイル | `.md$` かつファイル存在 | `ai/reviews/251220_pr-123-review.md` |

### 2. 情報取得

#### PR形式の場合
```bash
# PRの基本情報取得
gh pr view <pr_number> --repo <owner/repo>

# PR差分取得
gh pr diff <pr_number> --repo <owner/repo>

# 変更ファイル一覧取得
gh pr view <pr_number> --repo <owner/repo> --json files --jq '.files[].path'
```

#### git diff形式の場合
```bash
# 差分取得
git diff <args>

# 変更ファイル一覧取得
git diff --name-status <args>
```

#### Markdown形式の場合
```bash
# Read tool でファイル読み込み
Read <filepath>
```

### 3. データ構造化

返却する構造化データ:

```
review_target_type: pr | diff | meta

review_context:
  repo: owner/repo (PR形式の場合)
  pr_number: 123 (PR形式の場合)
  diff_text: <差分テキスト>
  changed_files: [file1.ts, file2.ts, ...]
  original_input: <元の入力文字列>
```

## ワークフロー

```
入力受信
  ↓
1. 入力形式判定
  ↓
2. 情報取得（gh/git/Read）
  ↓
3. データ構造化
  ↓
構造化データ返却
```

### Phase 1: 入力形式判定

優先順位に従って入力をパターンマッチング。最初にマッチしたパターンを採用。

### Phase 2: 情報取得

判定された形式に応じて以下を実行:

- **PR**: `gh pr view`, `gh pr diff`, `gh pr view --json files`
- **git diff**: `git diff <args>`, `git diff --name-status <args>`
- **Markdown**: `Read <filepath>`

### Phase 3: データ構造化

取得した情報を統一フォーマットに変換してテキスト形式で返却。コマンドが読み取り可能な明確な構造で出力。

## 入出力仕様

### 入力

ユーザーから渡される文字列:
- PR番号/URL: `#123`, `https://github.com/owner/repo/pull/123`, `123`
- git diffコマンド: `git diff --staged`, `git diff main...feature`
- Markdownファイルパス: `ai/reviews/251220_pr-123-review.md`

### 出力

構造化されたテキスト形式のデータ:

```
review_target_type: pr
review_context:
  repo: anthropics/claude-code
  pr_number: 123
  diff_text: |
    diff --git a/src/file.ts b/src/file.ts
    ...
  changed_files:
    - src/file.ts
    - tests/file.test.ts
  original_input: #123
```

## Guidelines

### 入力形式の詳細

入力形式の判定ロジック、パターン詳細、エッジケース処理については [guidelines/input-formats.md](guidelines/input-formats.md) を参照。

### エラーハンドリング

- **不正な入力**: 形式が特定できない場合は分かりやすいエラーメッセージを返す
- **コマンド失敗**: gh/gitコマンドが失敗した場合はエラー内容を含めて返却
- **ファイル不存在**: Markdownファイルが存在しない場合は明確なエラーを返す

### 使用例

使用例については以下を参照:
- [examples/pr-input-example.md](examples/pr-input-example.md) - PR入力の例
- [examples/diff-input-example.md](examples/diff-input-example.md) - git diff入力の例
- [examples/markdown-input-example.md](examples/markdown-input-example.md) - Markdown入力の例

## Limitations

- GitHub CLI (`gh`) が認証済みである必要がある
- プライベートリポジトリへのアクセスには適切な権限が必要
- git差分はコマンド文字列のみ受理（差分テキストの直接貼り付けは非対応）
- 入力形式の判定は優先順位に従うため、意図しない形式と判定される可能性がある（例: 数字のみの入力は常にPR番号として扱われる）

## Version History

- **1.0.0** (2025-12-25): 初版リリース（code-reviewコマンドから入力判定・情報取得処理を分離）
