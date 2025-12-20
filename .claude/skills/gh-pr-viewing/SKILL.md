---
name: gh-pr-viewing
description: GitHub Pull Requestsを参照・レビューする。gh CLIでPR一覧、詳細、差分を表示する。PRレビュー、コード変更確認、またはpull requestやPR番号が言及された際に使用する。
allowed-tools: [Bash, Read]
---

# GitHub PR Viewing

## Contents
- [概要](#概要)
- [主要機能](#主要機能)
- [使用方法](#使用方法)
- [Examples](#examples)
- [Guidelines](#guidelines)
- [Limitations](#limitations)

## 概要

このスキルはGitHub CLIを使用してPull Requestsの情報を参照し、レビューを支援する。PR一覧の表示、詳細情報の取得、コード差分の確認が可能。

## 主要機能

- PR一覧の表示（オープン、クローズ、全て）
- PR詳細情報の取得（タイトル、説明、レビューステータス）
- PRの差分表示（ファイル別、行別）
- PR番号またはURL形式での指定サポート

## 使用方法

### PR一覧の表示
```bash
# デフォルト（現在のリポジトリのオープンPR）
gh pr list

# 特定のリポジトリ
gh pr list --repo owner/repo

# 全てのPR（オープン + クローズ）
gh pr list --state all
```

### PR詳細の表示
```bash
# PR番号で指定
gh pr view <PR番号>

# 特定のリポジトリのPR
gh pr view <PR番号> --repo owner/repo

# URLで指定
gh pr view https://github.com/owner/repo/pull/123
```

### PRの差分表示
```bash
# PR番号で差分表示
gh pr diff <PR番号>

# 特定のリポジトリのPR差分
gh pr diff <PR番号> --repo owner/repo
```

## Examples

**例1: PR一覧の表示**

入力:
```
"Show me all open pull requests"
```

実行:
```bash
gh pr list
```

出力:
```
#42  Fix authentication bug  feature-auth  2 days ago
#41  Update README          docs-update   1 week ago
```

**例2: PR詳細の確認**

入力:
```
"PR #42の内容を教えて"
```

実行:
```bash
gh pr view 42
```

出力:
```
Fix authentication bug #42
Open • feature-auth wants to merge 3 commits into main

  認証処理のバグを修正しました。

  +-----------------+
  | 3 files changed |
  | +45 -12         |
  +-----------------+
```

**例3: PR差分の確認**

入力:
```
"PR #42のコード変更を見せて"
```

実行:
```bash
gh pr diff 42
```

出力:
```diff
diff --git a/src/auth.js b/src/auth.js
@@ -10,7 +10,7 @@
-  if (user == null) {
+  if (!user) {
     throw new Error("Unauthorized");
   }
```

## Guidelines

- **デフォルトリポジトリ**: 引数なしの場合は現在のリポジトリを使用
- **PR番号とURL**: 両方の形式をサポート（柔軟性のため）
- **状態フィルタ**: `--state` オプションでオープン、クローズ、全てを切り替え可能
- **読み取り専用**: このスキルはPRの参照のみを行い、作成や更新は行わない

## Limitations

- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）
- プライベートリポジトリにアクセスするには適切な権限が必要
- 大きなPRの差分表示は時間がかかる場合がある

## Version History

- **1.0.0** (2025-12-19): 初版リリース
