---
name: code-reviewing
description: コードレビューの専門スキル。PR・git差分・Markdownレビュー結果に対応。5段階レビュープロセス（初期分析→詳細分析→ベストプラクティス参照→統合評価→品質検証）でコード品質・セキュリティ・パフォーマンスを評価。
allowed-tools: [Read, Grep, Glob, Bash, WebFetch, Write, Edit]
---

# Code Reviewing

## Contents
- [概要](#概要)
- [主要機能](#主要機能)
- [使用方法](#使用方法)
  - [入力形式の自動判定](#入力形式の自動判定)
  - [1. PR情報の取得](#1-pr情報の取得)
  - [2. git差分レビュー](#2-git差分レビュー)
  - [3. Markdownレビュー結果のレビュー（メタレビュー）](#3-markdownレビュー結果のレビューメタレビュー)
  - [5段階レビュープロセス](#5段階レビュープロセス)
- [Examples](#examples)
- [Guidelines](#guidelines)
  - [レビュー観点](#レビュー観点)
  - [エビデンスベースのフィードバック](#エビデンスベースのフィードバック)
  - [出力フォーマット](#出力フォーマット)
  - [自己検証チェックリスト](#自己検証チェックリスト)
- [Limitations](#limitations)

## 概要

このスキルはコードの詳細なレビューを実施する。Pull Request、git差分、既存のMarkdownレビュー結果の3つの入力形式に対応し、5段階のレビュープロセスで、コード品質、セキュリティ、パフォーマンス、テスト、設計を総合的に評価し、エビデンスベースのフィードバックを提供する。

## 主要機能

- 5段階レビュープロセスの実行
- レビュー観点別評価（品質/セキュリティ/パフォーマンス/テスト/設計）
- エビデンスベースのフィードバック（目標80%以上）
- 構造化されたレビュー結果の出力（`ai/reviews/`）

## 使用方法

### 入力形式の自動判定

このスキルは3つの入力形式を自動判定します（優先順位順）:

**1. PR番号またはURL（最優先）**
- `#123` 形式: PR番号123を抽出
- `https://github.com/owner/repo/pull/123` 形式: owner, repo, 123を抽出
- 数字のみ: PR番号としてそのまま使用

**2. git差分コマンド**
- `git diff --staged`: ステージング済み変更のレビュー
- `git diff main...feature`: ブランチ間差分のレビュー
- `git diff HEAD~3..HEAD`: コミット範囲のレビュー
- **注意**: `diff --git a/...` 形式の差分テキストの直接貼り付けはサポート対象外

**3. Markdownファイルパス**
- `.md` 拡張子を持つファイルパス（例: `ai/reviews/251220_pr-123-review.md`）
- 既存のレビュー結果のメタレビューを実施

**判定不能時の処理**:
入力が上記のいずれにも該当しない場合、エラーメッセージで受け付ける形式の例を提示します。
```
受け付ける形式:
- PR URL: https://github.com/owner/repo/pull/123
- PR番号: #123
- git diffコマンド: git diff --staged
- Markdownパス: ai/reviews/251220_pr-123-review.md
```

### 1. PR情報の取得

**gh CLI呼び出し例**:
```bash
# PR詳細取得
gh pr view <PR番号>

# PR差分取得
gh pr diff <PR番号>

# PRファイル一覧取得
gh pr view <PR番号> --json files

# 特定のリポジトリのPR
gh pr view <PR番号> --repo owner/repo
```

### 2. git差分レビュー

**使用するgit diffコマンド例**:
```bash
# ステージング済み変更
git diff --staged

# 変更ファイル一覧
git diff --name-status

# ブランチ間差分
git diff main...feature

# コミット範囲指定
git diff HEAD~3..HEAD
```

**レビュー対象の抽出方法**:
1. `git diff --name-status` で変更ファイル一覧を取得
2. 各ファイルに対して `Read` で内容を確認
3. 変更箇所を特定してレビュー

### 3. Markdownレビュー結果のレビュー（メタレビュー）

**対象**: `ai/reviews/` ディレクトリ内の既存レビュー結果

**メタレビューの観点**:
- **レビューの網羅性**: 全レビュー観点（品質/セキュリティ/パフォーマンス/テスト/設計）がカバーされているか
- **指摘の具体性**: ファイル名:行番号、コード例が含まれているか
- **エビデンス付与率**: 80%以上の指摘にエビデンス（公式ドキュメントURL、影響範囲分析）が付与されているか
- **重複/矛盾の有無**: 同じ問題が複数回指摘されていないか、矛盾する指摘がないか
- **建設性**: 批判だけでなく、改善提案が含まれているか

### 5段階レビュープロセス

| Phase | 目的 | 主要アクション |
|-------|------|---------------|
| **1. 初期分析** | PR情報と変更内容を把握 | `gh pr view`、`gh pr diff`でPR情報・差分取得 |
| **2. 詳細分析** | 影響範囲と依存関係を理解 | `Read`/`Grep`で変更ファイル分析、依存関係追跡 |
| **3. ベストプラクティス参照** | 外部知識を収集 | `WebFetch`で公式ドキュメント・ベストプラクティス取得 |
| **4. 統合評価** | レビュー観点別に評価 | Phase 1-3の情報を統合、エビデンス付与（80%以上） |
| **5. 品質検証** | レビュー結果を検証 | チェックリスト実行、`ai/reviews/`に保存 |

## Examples

**例1: PR番号指定レビュー**

入力:
```
"PR #123をレビューして"
```

実行:
```
Phase 1: gh pr view 123 && gh pr diff 123
Phase 2: Read/Grep で変更ファイル分析、影響範囲特定
Phase 3: WebFetch でベストプラクティス（例: React公式ドキュメント）取得
Phase 4: レビュー観点別に評価、エビデンス付与
Phase 5: 自己検証チェックリスト実行、ai/reviews/ に保存
```

出力:
```
ai/reviews/251220_pr-123-review.md に保存しました。

レビュー結果サマリー:
- セキュリティ: 高1件（XSS脆弱性 src/auth.js:42）
- コード品質: 中3件、低2件
- パフォーマンス: 中1件
- エビデンス付与率: 85% (6/7件)
```

**例2: PR URL指定レビュー**

入力:
```
"https://github.com/owner/repo/pull/456をレビューして"
```

実行:
```
1. URLから owner/repo/456 を抽出
2. gh pr view 456 --repo owner/repo
3. gh pr diff 456 --repo owner/repo
4. 5段階レビュープロセスを実行
```

出力:
```
ai/reviews/251220_owner-repo-pr-456-review.md に保存しました。

レビュー結果サマリー:
- セキュリティ: 問題なし
- コード品質: 中2件
- テスト: 低1件（テストカバレッジ不足）
- エビデンス付与率: 100% (3/3件)
```

**例3: git差分レビュー（ステージング済み変更）**

入力:
```
"git diff --staged をレビューして"
```

実行:
```
Phase 1: git diff --staged で差分取得、git diff --name-status で変更ファイル一覧取得
Phase 2: Read で各変更ファイルの内容確認、Grep で影響範囲分析
Phase 3: WebFetch でベストプラクティス取得
Phase 4: レビュー観点別に評価、エビデンス付与
Phase 5: 自己検証チェックリスト実行、ai/reviews/ に保存
```

出力:
```
ai/reviews/251220_diff-staged-review.md に保存しました。

レビュー結果サマリー:
- コード品質: 中1件、低2件
- パフォーマンス: 中1件（ループ最適化 src/utils.js:28）
- エビデンス付与率: 100% (4/4件)
```

**例4: git差分レビュー（ブランチ間）**

入力:
```
"git diff main...feature/auth をレビューして"
```

実行:
```
Phase 1: git diff main...feature/auth で差分取得
Phase 2: Read/Grep で変更ファイル分析、依存関係確認
Phase 3: WebFetch で認証関連のベストプラクティス取得
Phase 4: セキュリティを重点的に評価
Phase 5: チェックリスト実行、ai/reviews/ に保存
```

出力:
```
ai/reviews/251220_diff-main...feature-auth-review.md に保存しました。

レビュー結果サマリー:
- セキュリティ: 高1件（パスワードハッシュ化 src/auth/password.js:15）
- コード品質: 中2件
- エビデンス付与率: 100% (3/3件)
```

**例5: git差分レビュー（コミット範囲）**

入力:
```
"git diff HEAD~3..HEAD をレビューして"
```

実行:
```
Phase 1: git diff HEAD~3..HEAD で直近3コミットの差分取得
Phase 2: Read/Grep で変更内容分析
Phase 3: WebFetch でベストプラクティス取得
Phase 4: レビュー観点別に評価
Phase 5: チェックリスト実行、ai/reviews/ に保存
```

出力:
```
ai/reviews/251220_diff-head~3..head-review.md に保存しました。

レビュー結果サマリー:
- コード品質: 低3件（コメント不足）
- テスト: 中1件（テストケース追加推奨）
- エビデンス付与率: 75% (3/4件)
```

**例6: Markdownレビュー結果のメタレビュー**

入力:
```
"ai/reviews/251220_pr-123-review.md をレビューして"
```

実行:
```
Phase 1: Read で既存レビュー結果を読み込み
Phase 2: レビューの網羅性、具体性、エビデンス付与率を分析
Phase 3: WebFetch でレビューベストプラクティス取得
Phase 4: メタレビュー観点別に評価（網羅性/具体性/エビデンス/重複・矛盾/建設性）
Phase 5: チェックリスト実行、ai/reviews/ に保存
```

出力:
```
ai/reviews/251220_meta-pr-123-review-review.md に保存しました。

メタレビュー結果サマリー:
- レビュー観点の網羅性: ⭐⭐⭐⭐☆（テスト観点が弱い）
- 指摘の具体性: ⭐⭐⭐⭐⭐（全指摘にファイル名:行番号あり）
- エビデンス付与率: 85% (6/7件) - 目標達成
- 重複/矛盾: なし
- 建設性: ⭐⭐⭐⭐☆（改善提案が充実）

改善提案:
- テスト観点の指摘を追加（カバレッジ、エッジケース）
- エビデンス付与率を90%以上に向上
```

## Guidelines

### レビュー観点

各観点の詳細ガイドラインは以下を参照:

- **コード品質**: [guidelines/code-quality.md](guidelines/code-quality.md)
- **セキュリティ**: [guidelines/security.md](guidelines/security.md)
- **パフォーマンス**: [guidelines/performance.md](guidelines/performance.md)
- **テスト**: [guidelines/testing.md](guidelines/testing.md)
- **設計**: [guidelines/design.md](guidelines/design.md)

### エビデンスベースのフィードバック

全指摘の80%以上にエビデンス（公式ドキュメント、コード例、影響範囲）を付与。

詳細なフィードバック形式は [guidelines/feedback-format.md](guidelines/feedback-format.md) を参照。

### 出力フォーマット

レビュー結果のテンプレートは [templates/review-template.md](templates/review-template.md) を参照。

**レビュー結果の命名規則**:

レビュー結果は種別ごとに以下の命名規則に従って `ai/reviews/` に保存します:

1. **PRレビュー**:
   - 同一リポジトリ: `YYMMDD_pr-<num>-review.md`
     - 例: `251220_pr-123-review.md`
   - 外部リポジトリ: `YYMMDD_<owner>-<repo>-pr-<num>-review.md`
     - 例: `251220_facebook-react-pr-456-review.md`

2. **git差分レビュー**: `YYMMDD_diff-<range>-review.md`
   - ステージング: `251220_diff-staged-review.md`
   - ブランチ間: `251220_diff-main...feature-review.md`
   - コミット範囲: `251220_diff-head~3..head-review.md`
   - **ファイル名サニタイズ規則**:
     - 小文字化
     - 空白を `-` に変換
     - `/` を `-` に変換
     - 連続する記号を単一の `-` に圧縮
     - 例: `feature/foo` → `feature-foo`

3. **Markdownメタレビュー**: `YYMMDD_meta-<basename>-review.md`
   - 例: `ai/reviews/251220_pr-123-review.md` のメタレビュー → `251220_meta-pr-123-review-review.md`

### 自己検証チェックリスト

レビュー出力前に必ず [guidelines/checklist.md](guidelines/checklist.md) のチェックリストを実行（目標: 全項目クリア）。

## Limitations

- コードの直接修正は行わない（レビュー結果の出力のみ）
- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）- PRレビュー機能で使用
- プライベートリポジトリにアクセスするには適切な権限が必要
- WebFetchの利用可能性に依存（外部ドキュメント検索）
- git差分レビューはコマンド文字列のみ受理（差分テキストの直接貼り付けは非対応）

## 参照ガイド

スキルの詳細情報は以下のディレクトリを参照してください:

### guidelines/
レビュー観点別のガイドライン:
- [code-quality.md](guidelines/code-quality.md) - コード品質チェック項目
- [security.md](guidelines/security.md) - セキュリティチェック項目
- [performance.md](guidelines/performance.md) - パフォーマンスチェック項目
- [testing.md](guidelines/testing.md) - テストチェック項目
- [design.md](guidelines/design.md) - 設計チェック項目
- [feedback-format.md](guidelines/feedback-format.md) - フィードバック形式
- [checklist.md](guidelines/checklist.md) - 自己検証チェックリスト

### templates/
レビュー結果のテンプレート:
- [review-template.md](templates/review-template.md) - レビュー結果の標準フォーマット

### evaluations/
評価シナリオ（スキル品質検証用）:
- [scenario-1.json](evaluations/scenario-1.json) - PRレビューシナリオ
- その他のシナリオは `ai/review-validations/` を参照

## Version History

- **2.0.0** (2025-12-22): 汎用化対応（PR/git差分/Markdownレビュー結果の3入力形式に対応、スキル名を code-reviewing に変更）
- **1.1.0** (2025-12-20): Progressive Disclosure適用（ガイドライン・テンプレートを分離、SKILL.md簡略化）
- **1.0.0** (2025-12-20): 初版リリース（MCPツール参照を削除、gh CLIに移行）
