---
name: pr-reviewing
description: PRレビューの専門スキル。5段階レビュープロセス（初期分析→詳細分析→ベストプラクティス参照→統合評価→品質検証）でコード品質・セキュリティ・パフォーマンスを評価。
allowed-tools: [Read, Grep, Glob, Bash, WebFetch]
---

# PR Reviewing

## Contents
- [概要](#概要)
- [主要機能](#主要機能)
- [使用方法](#使用方法)
  - [PR情報の取得](#pr情報の取得)
  - [5段階レビュープロセス](#5段階レビュープロセス)
- [Examples](#examples)
- [Guidelines](#guidelines)
  - [レビュー観点](#レビュー観点)
  - [エビデンスベースのフィードバック](#エビデンスベースのフィードバック)
  - [出力フォーマット](#出力フォーマット)
  - [自己検証チェックリスト](#自己検証チェックリスト)
- [Limitations](#limitations)

## 概要

このスキルは Pull Request の詳細なレビューを実施する。5段階のレビュープロセスで、コード品質、セキュリティ、パフォーマンス、テスト、設計を総合的に評価し、エビデンスベースのフィードバックを提供する。

## 主要機能

- 5段階レビュープロセスの実行
- レビュー観点別評価（品質/セキュリティ/パフォーマンス/テスト/設計）
- エビデンスベースのフィードバック（目標80%以上）
- 構造化されたレビュー結果の出力（`ai/reviews/`）

## 使用方法

### PR情報の取得

**PR番号の抽出ロジック**:
- `#123` 形式の場合: 123を抽出
- `https://github.com/owner/repo/pull/123` 形式の場合: owner, repo, 123を抽出
- 数字のみの場合: そのまま使用

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

### 自己検証チェックリスト

レビュー出力前に必ず [guidelines/checklist.md](guidelines/checklist.md) のチェックリストを実行（目標: 全項目クリア）。

## Limitations

- コードの直接修正は行わない（レビュー結果の出力のみ）
- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）
- プライベートリポジトリにアクセスするには適切な権限が必要
- WebFetchの利用可能性に依存（外部ドキュメント検索）

## Version History

- **1.1.0** (2025-12-20): Progressive Disclosure適用（ガイドライン・テンプレートを分離、SKILL.md簡略化）
- **1.0.0** (2025-12-20): 初版リリース（MCPツール参照を削除、gh CLIに移行）
