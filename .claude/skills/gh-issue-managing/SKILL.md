---
name: gh-issue-managing
description: GitHub Issuesを管理する。gh CLIでIssue一覧、詳細、作成、更新を実行する。Issue確認、作成、更新、またはissueやIssue番号が言及された際に使用する。
allowed-tools: [Bash, Read]
---

# GitHub Issue Managing

## 参照ガイド

このスキルには以下の詳細ガイドラインが用意されています。必要に応じて参照してください:

- [Issue作成・更新のベストプラクティス](guidelines/issue-best-practices.md): Issue作成・更新の詳細ガイド、チェックリスト、トラブルシューティング
- [良い例・悪い例](examples/good-bad-examples.md): 具体的な実装例と判定基準

---

## 概要

このスキルはGitHub CLIを使用してIssuesの管理を支援します。Issue一覧の表示、詳細情報の取得、新規Issue作成、既存Issueの更新が可能です。

## 主要機能

- Issue一覧の表示（オープン、クローズ、全て）
- Issue詳細情報の取得（タイトル、説明、ラベル、アサイン）
- 新規Issueの作成（タイトル、本文、ラベル、アサイン指定）
- 既存Issueの更新（ラベル追加、アサイン変更）
- Issue番号またはURL形式での指定サポート

---

## 基本的な使用方法

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

**作成前の検証（必須）**:
```
Issue作成前チェックリスト:
- [ ] タイトルが明確で具体的（50文字以内が推奨）
- [ ] 種別が明記されている（Bug/Feature/Enhancement など）
- [ ] 本文に必要な情報が含まれている
- [ ] 適切なラベルが選択されている
- [ ] 重複するIssueが存在しないことを確認済み
```

**検証通過後**:
```bash
# 基本的な作成
gh issue create --title "タイトル" --body "本文"

# ラベルとアサインを指定
gh issue create --title "タイトル" --body "本文" --label bug --assignee username

# HEREDOCで長い本文を指定
gh issue create --title "タイトル" --body "$(cat <<'EOF'
本文の内容
複数行可能
EOF
)"
```

詳細なベストプラクティスは [guidelines/issue-best-practices.md](guidelines/issue-best-practices.md) を参照してください。

### Issueの更新

```bash
# ラベル追加
gh issue edit <Issue番号> --add-label "priority:high"

# ラベル削除
gh issue edit <Issue番号> --remove-label "status:investigating"

# アサイン変更
gh issue edit <Issue番号> --add-assignee username

# クローズ（コメント推奨）
gh issue comment <Issue番号> --body "クローズ理由"
gh issue close <Issue番号>
```

---

## クイックリファレンス

### 推奨ラベル体系

**種別ラベル**: `bug`, `feature`, `enhancement`, `documentation`, `question`

**優先度ラベル**: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`

**ステータスラベル**: `status:investigating`, `status:in-progress`, `status:blocked`, `status:needs-review`

詳細なラベル運用ガイドラインは [guidelines/issue-best-practices.md#ラベル運用ガイドライン](guidelines/issue-best-practices.md#ラベル運用ガイドライン) を参照してください。

---

## 重要なガイドライン

1. **検証優先**: Issue作成・更新前に必ずチェックリストで検証
2. **具体性**: タイトル、本文、ラベルはすべて具体的に記述
3. **コミュニケーション**: 更新時は必ずコメントで理由を記録
4. **デフォルトリポジトリ**: 引数なしの場合は現在のリポジトリを使用
5. **確認**: Issue作成・更新前にユーザーに確認を取る

---

## 制限事項

- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）
- プライベートリポジトリにアクセスするには適切な権限が必要
- Issue作成・更新には書き込み権限が必要
- 大量のIssueを一度に操作すると時間がかかる場合がある

---

## トラブルシューティング

一般的な問題と解決方法については [guidelines/issue-best-practices.md#トラブルシューティング](guidelines/issue-best-practices.md#トラブルシューティング) を参照してください。

---

## Version History

- **1.1.0** (2025-12-20): Progressive Disclosure適用、ベストプラクティスと例示を分離
- **1.0.0** (2025-12-19): 初版リリース
