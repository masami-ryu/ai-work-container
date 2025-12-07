# DevContainer Git Worktree パーミッションエラー解決プラン v2

作成日: 2025年12月07日
作成者: Claude (Plan Creator Agent)
ステータス: Rejected - レビューで問題点を指摘されv3に改訂
最終更新: 2025年12月07日

**注意:** このプランはレビューで `chmod 775` の問題点が指摘され、v3に改訂されました。
- **v3: `ai/plans/251207_devcontainer_worktree_permission_fix_v3.md` （承認済み・実装済み）**

## 1. 概要

### 目的
既存のプラン（251207_devcontainer_worktree_permission_fix.md）を実行後も発生する `git worktree add ../work01` のパーミッションエラーを解決し、親ディレクトリへのworktree追加を可能にする。

### スコープ
- 対象: `/workspaces/` ディレクトリのパーミッション設定
- 対象: `.devcontainer/fix-workspaces-permission.sh` スクリプトの修正
- 対象外: Git worktree以外のGit操作に関する問題

### 前提条件
- DevContainer環境が正常に起動していること
- `vscode` ユーザーとしてコンテナ内で作業していること
- Git リポジトリが `/workspaces/ai-work-container` に存在すること
- 既存のプラン（v1）が実行済みであること

### 問題の詳細

**v1プラン実行後の状況:**
```
/workspaces/ ディレクトリ:
  所有者: root:root
  パーミッション: 755 (rwxr-xr-x)

/workspaces/ai-work-container/ ディレクトリ:
  所有者: vscode:vscode （スクリプトで変更済み）
  パーミッション: 755

現在のユーザー:
  vscode (uid=1000, gid=1000)
```

**エラーの詳細:**
```bash
$ git worktree add ../work01
Preparing worktree (checking out 'work01')
fatal: could not create leading directories of '../work01/.git': Permission denied
```

**根本原因:**
現在のスクリプト（`.devcontainer/fix-workspaces-permission.sh`）は `/workspaces/ai-work-container` の所有者のみを変更しています。しかし、`git worktree add ../work01` は `/workspaces/work01` を作成しようとするため、親ディレクトリ `/workspaces/` への書き込み権限が必要です。`/workspaces/` が `root` 所有のままでは、`vscode` ユーザーには書き込み権限がありません。

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | vscodeユーザーが `/workspaces/` に書き込み可能であること | 高 |
| REQ-002 | 要件 | コンテナ再起動後も設定が維持されること | 高 |
| REQ-003 | 要件 | 既存のワークフローに影響を与えないこと | 高 |
| REQ-004 | 要件 | 他のDevContainerプロジェクトに影響を与えないこと | 高 |
| CON-001 | 制約 | セキュリティリスクを最小限に抑えること | - |
| CON-002 | 制約 | DevContainer標準の構造を可能な限り維持すること | - |
| GUD-001 | ガイドライン | 変更は最小限にとどめること | - |

## 3. 解決策の選択肢

### 解決策A: `/workspaces/` ディレクトリのパーミッション変更（推奨）

**概要:** `/workspaces/` ディレクトリのパーミッションを `775` に変更し、`vscode` グループに書き込み権限を付与。

**メリット:**
- `/workspaces/` の所有者は `root` のまま維持
- `vscode` グループのユーザーのみが書き込み可能
- セキュリティリスクが最小限
- 既存のプロジェクトに影響を与えない

**デメリット:**
- グループ権限の管理が必要

**実装方法:**
```bash
sudo chmod 775 /workspaces/
```

### 解決策B: `/workspaces/` ディレクトリの所有者変更

**概要:** `/workspaces/` ディレクトリの所有者を `vscode:vscode` に変更。

**メリット:**
- シンプルな実装
- 確実に書き込み可能になる

**デメリット:**
- 他のDevContainerプロジェクトが存在する場合に影響が出る可能性
- セキュリティリスクが高い（rootが所有すべきディレクトリを一般ユーザーが所有）

**実装方法:**
```bash
sudo chown vscode:vscode /workspaces/
```

### 解決策C: プロジェクト内にworktreeを作成（代替案）

**概要:** `/workspaces/` ではなく、`/workspaces/ai-work-container/worktrees/` などプロジェクト内にworktreeを作成。

**メリット:**
- パーミッション変更不要
- セキュリティリスクなし

**デメリット:**
- ユーザーの意図した使い方（`../work01`）ができない
- プロジェクトディレクトリが肥大化

**実装方法:**
```bash
git worktree add worktrees/work01
```

## 4. 実装ステップ

### Phase 1: スクリプトの修正（解決策A採用）
**目標**: `/workspaces/` ディレクトリに書き込み権限を付与するようスクリプトを修正

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | `fix-workspaces-permission.sh` に `/workspaces/` のパーミッション変更を追加 | `.devcontainer/fix-workspaces-permission.sh` | スクリプトに `chmod 775 /workspaces/` コマンドが追加されている | [ ] |
| TASK-002 | ログ出力を追加してトラブルシューティングを容易化 | `.devcontainer/fix-workspaces-permission.sh` | パーミッション変更のログが `/tmp/worktree-permission.log` に記録される | [ ] |

### Phase 2: テストと検証
**目標**: 修正が正しく機能することを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-003 | スクリプトを手動実行してテスト | - | `/workspaces/` のパーミッションが `775` になる | [ ] |
| TASK-004 | `git worktree add ../test01` を実行してテスト | - | エラーなくworktreeが作成される | [ ] |
| TASK-005 | worktreeの削除とクリーンアップをテスト | - | `git worktree remove test01` が成功する | [ ] |
| TASK-006 | DevContainerを再起動してテスト | - | 再起動後もパーミッションが維持される | [ ] |

### Phase 3: ドキュメント更新
**目標**: 設定変更をドキュメントに記録

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-007 | CLAUDE.md に worktree の使用方法を追加 | `CLAUDE.md` | worktree使用方法が記述されている | [ ] |
| TASK-008 | 既存プラン（v1）のステータスを更新 | `ai/plans/251207_devcontainer_worktree_permission_fix.md` | v2プランへの参照が追加されている | [ ] |

## 5. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 統合 | スクリプト実行後のパーミッション確認 | `/workspaces/` が `775` パーミッションになっている |
| TEST-002 | 機能 | `git worktree add ../test01` を実行 | エラーなくworktreeが作成される |
| TEST-003 | 機能 | 作成したworktreeでgit操作を実行 | 通常のgit操作（commit, branch等）が正常に動作する |
| TEST-004 | 機能 | `git worktree remove test01` を実行 | worktreeが正常に削除される |
| TEST-005 | 回帰 | 既存のgit操作が正常に動作するか確認 | メインリポジトリでのgit操作に影響がない |
| TEST-006 | 永続性 | DevContainer再起動後のパーミッション確認 | `/workspaces/` のパーミッションが維持されている |
| TEST-007 | ログ | 権限変更ログの確認: `cat /tmp/worktree-permission.log` | ログに `/workspaces/` のパーミッション変更が記録されている |
| TEST-008 | セキュリティ | `/workspaces/` の所有者確認 | 所有者が `root:root` のまま維持されている |

## 6. 成功基準

- [ ] `git worktree add ../work01` がエラーなく実行できる
- [ ] コンテナ再起動後も設定が維持される
- [ ] 既存のGit操作に影響を与えていない
- [ ] `/workspaces/` ディレクトリのパーミッションが `775` になっている
- [ ] `/workspaces/` ディレクトリの所有者が `root:root` のまま維持されている
- [ ] 権限変更の実行ログが `/tmp/worktree-permission.log` に記録されている
- [ ] セキュリティリスクが増加していない

## 7. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | `/workspaces/` のパーミッション変更により他のユーザーに影響 | 中 | 低 | グループ権限のみ変更し、otherには書き込み権限を付与しない（775） |
| RISK-002 | sudo が利用できない環境での失敗 | 高 | 低 | v1プランで既に対策済み（sudo可用性チェック） |
| RISK-003 | DevContainer再起動時にパーミッションが戻る | 高 | 低 | `updateContentCommand` で毎回実行される設定を維持 |
| RISK-004 | パーミッション変更が他のプロジェクトに影響 | 中 | 低 | `/workspaces/` 配下の他のディレクトリのパーミッションは変更しない |

## 8. 依存関係

- DevContainer環境が起動していること
- `vscode` ユーザーがコンテナ内に存在すること
- `updateContentCommand` が実行可能であること
- v1プラン（251207_devcontainer_worktree_permission_fix.md）が実行済みであること

## 9. 実装の詳細

### 修正後のスクリプト（解決策A）

`.devcontainer/fix-workspaces-permission.sh`:
```bash
#!/bin/bash
set -e

LOG_FILE="/tmp/worktree-permission.log"
TARGET_DIR="/workspaces/ai-work-container"
WORKSPACES_DIR="/workspaces"

echo "[$(date)] Checking permissions for git worktree support" | tee -a "$LOG_FILE"

# sudo が使用可能かチェック
if sudo -n true 2>/dev/null; then
    echo "[$(date)] sudo is available, changing permissions..." | tee -a "$LOG_FILE"

    # /workspaces/ai-work-container の所有者を変更
    if sudo chown -R vscode:vscode "$TARGET_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$(date)] Successfully changed ownership of $TARGET_DIR to vscode:vscode" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] ERROR: Failed to change ownership of $TARGET_DIR" | tee -a "$LOG_FILE"
        exit 1
    fi

    # /workspaces/ のパーミッションを変更（グループに書き込み権限を付与）
    if sudo chmod 775 "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$(date)] Successfully changed permissions of $WORKSPACES_DIR to 775" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] ERROR: Failed to change permissions of $WORKSPACES_DIR" | tee -a "$LOG_FILE"
        exit 1
    fi

    # 変更後のパーミッション確認
    echo "[$(date)] Current permissions:" | tee -a "$LOG_FILE"
    ls -ld "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"
    ls -ld "$TARGET_DIR" 2>&1 | tee -a "$LOG_FILE"
else
    echo "[$(date)] WARNING: sudo not available, skipping permission change" | tee -a "$LOG_FILE"
    echo "[$(date)] Worktree operations may fail without proper permissions" | tee -a "$LOG_FILE"
fi
```

### 代替案: 解決策B（所有者変更）

より積極的なアプローチが必要な場合、以下のように修正できます：

```bash
# /workspaces/ の所有者を変更（リスク高）
if sudo chown vscode:vscode "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"; then
    echo "[$(date)] Successfully changed ownership of $WORKSPACES_DIR to vscode:vscode" | tee -a "$LOG_FILE"
else
    echo "[$(date)] ERROR: Failed to change ownership of $WORKSPACES_DIR" | tee -a "$LOG_FILE"
    exit 1
fi
```

**注意:** 解決策Bは他のプロジェクトへの影響が大きいため、推奨しません。

## 10. 次のアクション

**実装前の確認:**
1. [ ] ユーザーに解決策A（パーミッション変更）と解決策B（所有者変更）のどちらを選択するか確認
   - 推奨: 解決策A（セキュリティリスクが低い）

**実装ステップ:**
2. [ ] `.devcontainer/fix-workspaces-permission.sh` を修正
3. [ ] スクリプトを手動実行してテスト: `bash .devcontainer/fix-workspaces-permission.sh`
4. [ ] ログを確認: `cat /tmp/worktree-permission.log`
5. [ ] パーミッションを確認: `ls -ld /workspaces/`

**検証ステップ:**
6. [ ] `git worktree add ../test01` で動作確認（TEST-002）
7. [ ] worktree内でのgit操作テスト（TEST-003）
8. [ ] worktreeの削除テスト（TEST-004）
9. [ ] DevContainerを再起動してパーミッション維持を確認（TEST-006）
10. [ ] 既存のgit操作に影響がないか確認（TEST-005）

**ドキュメント更新:**
11. [ ] `CLAUDE.md` に worktree の使用方法を追加
12. [ ] v1プランのステータスを更新し、v2プランへの参照を追加

---

## 11. v1プランからの変更点

### 問題の再定義
- v1: `/workspaces/ai-work-container` の所有者を変更
- v2: `/workspaces/` ディレクトリへの書き込み権限も必要と判明

### 解決策の追加
- v2では `/workspaces/` ディレクトリのパーミッション/所有者変更を含む

### セキュリティ考慮
- パーミッション変更（775）を優先し、所有者変更（vscode:vscode）は代替案として提示

---
*このプランは Plan Creator エージェントによって作成されました*
