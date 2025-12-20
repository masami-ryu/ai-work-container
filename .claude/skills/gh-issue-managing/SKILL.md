---
name: gh-issue-managing
description: GitHub Issuesを管理する。gh CLIでIssue一覧、詳細、作成、更新を実行する。Issue確認、作成、更新、またはissueやIssue番号が言及された際に使用する。
allowed-tools: [Bash, Read]
---

# GitHub Issue Managing

## Contents
- [概要](#概要)
- [主要機能](#主要機能)
- [使用方法](#使用方法)
- [Examples](#examples)
- [Guidelines](#guidelines)
- [Limitations](#limitations)

## 概要

このスキルはGitHub CLIを使用してIssuesの管理を支援する。Issue一覧の表示、詳細情報の取得、新規Issue作成、既存Issueの更新が可能。

## 主要機能

- Issue一覧の表示（オープン、クローズ、全て）
- Issue詳細情報の取得（タイトル、説明、ラベル、アサイン）
- 新規Issueの作成（タイトル、本文、ラベル、アサイン指定）
- 既存Issueの更新（ラベル追加、アサイン変更）
- Issue番号またはURL形式での指定サポート

## 使用方法

### Issue一覧の表示
```bash
# デフォルト（現在のリポジトリのオープンIssue）
gh issue list

# 特定のリポジトリ
gh issue list --repo owner/repo

# 全てのIssue（オープン + クローズ）
gh issue list --state all

# ラベルでフィルタ
gh issue list --label bug,enhancement
```

### Issue詳細の表示
```bash
# Issue番号で指定
gh issue view <Issue番号>

# 特定のリポジトリのIssue
gh issue view <Issue番号> --repo owner/repo

# URLで指定
gh issue view https://github.com/owner/repo/issues/123
```

### Issueの作成

**作成前の検証**:
1. タイトルが明確で具体的か確認
2. 本文に必要な情報（再現手順、期待動作、実際の動作）が含まれているか確認
3. 適切なラベルが選択されているか確認

**検証に問題がある場合**: 内容を修正してから作成

**検証通過後**:
```bash
# 基本的な作成
gh issue create --title "タイトル" --body "本文"

# ラベルとアサインを指定
gh issue create --title "タイトル" --body "本文" --label bug --assignee username

# 特定のリポジトリに作成
gh issue create --title "タイトル" --body "本文" --repo owner/repo
```

### Issueの更新
```bash
# ラベル追加
gh issue edit <Issue番号> --add-label "priority:high"

# アサイン変更
gh issue edit <Issue番号> --add-assignee username

# クローズ
gh issue close <Issue番号>
```

## Examples

**例1: Issue一覧の表示**

入力:
```
"オープンしているIssueを教えて"
```

実行:
```bash
gh issue list
```

出力:
```
#15  Login page not responsive  bug           Open
#14  Add dark mode feature      enhancement   Open
```

**例2: Issue詳細の確認**

入力:
```
"Issue #15の内容を教えて"
```

実行:
```bash
gh issue view 15
```

出力:
```
Login page not responsive #15
Open • user123 opened 3 days ago • 2 comments

  ログインページがモバイルで正しく表示されません。

  Labels: bug
  Assignees: developer1
```

**例3: 新規Issue作成**

入力:
```
"ログイン機能のバグを報告するIssueを作成して"
```

実行:
```bash
gh issue create --title "ログイン機能のバグ" --body "詳細な説明" --label bug
```

出力:
```
Creating issue in owner/repo

https://github.com/owner/repo/issues/16
```

**例4: Issueラベル追加**

入力:
```
"Issue #15に高優先度ラベルを追加して"
```

実行:
```bash
gh issue edit 15 --add-label "priority:high"
```

出力:
```
✓ Edited issue #15
```

## Guidelines

- **デフォルトリポジトリ**: 引数なしの場合は現在のリポジトリを使用
- **Issue番号とURL**: 両方の形式をサポート（柔軟性のため）
- **状態フィルタ**: `--state` オプションでオープン、クローズ、全てを切り替え可能
- **ラベルとアサイン**: 複数のラベル・アサインをカンマ区切りで指定可能
- **確認**: Issueの作成・更新前にユーザーに確認を取る

## Limitations

- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）
- プライベートリポジトリにアクセスするには適切な権限が必要
- Issue作成・更新には書き込み権限が必要
- 大量のIssueを一度に操作すると時間がかかる場合がある

## Version History

- **1.0.0** (2025-12-19): 初版リリース
