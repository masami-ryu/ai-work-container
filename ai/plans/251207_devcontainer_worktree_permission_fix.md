# DevContainer Git Worktree パーミッションエラー解決プラン

作成日: 2025年12月07日
作成者: Claude (Plan Creator Agent)
ステータス: Superseded - v3プランに置き換えられました
最終更新: 2025年12月07日

**注意:** このプランは v2 および v3 に改訂されました。最新版は以下を参照してください：
- v2: `ai/plans/251207_devcontainer_worktree_permission_fix_v2.md` （レビューで問題点を指摘）
- **v3: `ai/plans/251207_devcontainer_worktree_permission_fix_v3.md` （承認済み・実装済み）**

## 1. 概要

### 目的
VSCodeのDevContainer環境で `git worktree add ../work01` を実行した際に発生するパーミッションエラーを解決し、親ディレクトリへのworktree追加を可能にする。

### スコープ
- 対象: `/workspaces/` ディレクトリのパーミッション設定
- 対象: DevContainer起動時の権限設定スクリプト
- 対象外: Git worktree以外のGit操作に関する問題

### 前提条件
- DevContainer環境が正常に起動していること
- `vscode` ユーザーとしてコンテナ内で作業していること
- Git リポジトリが `/workspaces/ai-work-container` に存在すること

### 問題の詳細

**現在の状況:**
```
/workspaces/ ディレクトリ:
  所有者: root:root
  パーミッション: 755 (rwxr-xr-x)

現在のユーザー:
  vscode (uid=1000, gid=1000)
```

**エラーの原因:**
`git worktree add ../work01` を実行すると、`/workspaces/work01` ディレクトリを作成しようとするが、`/workspaces/` は `root` が所有しているため、`vscode` ユーザーには書き込み権限がない。

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | vscodeユーザーが `/workspaces/` に書き込み可能であること | 高 |
| REQ-002 | 要件 | コンテナ再起動後も設定が維持されること | 高 |
| REQ-003 | 要件 | 既存のワークフローに影響を与えないこと | 高 |
| CON-001 | 制約 | セキュリティリスクを最小限に抑えること | - |
| CON-002 | 制約 | DevContainer標準の構造を可能な限り維持すること | - |
| GUD-001 | ガイドライン | 変更は最小限にとどめること | - |

## 3. 実装ステップ

### Phase 1: 権限設定スクリプトの作成
**目標**: `/workspaces/` ディレクトリの権限を調整するスクリプトを作成

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | 権限調整スクリプトを作成 | `.devcontainer/fix-workspaces-permission.sh` | スクリプトが作成され、実行権限が付与されている | [ ] |
| TASK-002 | スクリプトで `/workspaces` の所有者を `vscode:vscode` に変更 | `.devcontainer/fix-workspaces-permission.sh` | スクリプト内に `chown` コマンドが記述されている | [ ] |

### Phase 2: DevContainer設定の更新
**目標**: コンテナ起動時に権限設定スクリプトを自動実行

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-003 | `postCreateCommand` を更新して権限設定スクリプトを実行 | `.devcontainer/devcontainer.json` | `postCreateCommand` に権限設定スクリプトが追加されている | [ ] |
| TASK-004 | または `updateContentCommand` を追加（推奨） | `.devcontainer/devcontainer.json` | `updateContentCommand` が設定され、コンテナ更新時に実行される | [ ] |

### Phase 3: テストと検証
**目標**: 設定が正しく機能することを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-005 | DevContainerを再ビルド | - | コンテナが正常に起動する | [ ] |
| TASK-006 | `/workspaces/` の権限を確認 | - | `vscode:vscode` が所有者になっている | [ ] |
| TASK-007 | `git worktree add ../work01` を実行してテスト | - | エラーなくworktreeが作成される | [ ] |
| TASK-008 | worktreeの削除とクリーンアップをテスト | - | `git worktree remove work01` が成功する | [ ] |

### Phase 4: ドキュメント更新
**目標**: 設定変更をドキュメントに記録

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-009 | CLAUDE.md に worktree の使用方法を追加 | `CLAUDE.md` | worktree使用方法が記述されている | [ ] |
| TASK-010 | トラブルシューティングセクションを更新 | `docs/claude-code-usage.md` または新規ドキュメント | パーミッション問題の解決方法が記載されている | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 統合 | DevContainer再ビルド後のパーミッション確認 | `/workspaces/ai-work-container` が `vscode:vscode` 所有になっている（`/workspaces` 全体ではない） |
| TEST-002 | 機能 | `git worktree add ../test01` を実行 | エラーなくworktreeが作成される |
| TEST-003 | 機能 | 作成したworktreeでgit操作を実行 | 通常のgit操作（commit, branch等）が正常に動作する |
| TEST-004 | 機能 | `git worktree remove test01` を実行 | worktreeが正常に削除される |
| TEST-005 | 回帰 | 既存のgit操作が正常に動作するか確認 | メインリポジトリでのgit操作に影響がない |
| TEST-006 | エラー処理（**レビュー指摘対応**） | 権限変更ログの確認: `cat /tmp/worktree-permission.log` | ログに実行履歴と結果が記録されている |
| TEST-007 | エラー処理（**レビュー指摘対応**） | sudo が利用できない環境をシミュレート（sudoersから一時的に削除） | 警告ログが出力され、スクリプトがスキップされる |
| TEST-008 | セキュリティ | `/workspaces` 配下の他のディレクトリの権限確認 | `ai-work-container` 以外のディレクトリの所有者が変更されていない |

## 5. 成功基準

- [ ] `git worktree add ../work01` がエラーなく実行できる
- [ ] コンテナ再起動後も設定が維持される
- [ ] 既存のGit操作に影響を与えていない
- [ ] `/workspaces/ai-work-container` ディレクトリが `vscode:vscode` 所有になっている（`/workspaces` 全体ではない）
- [ ] sudo が利用できない環境でもスクリプトが適切に動作する（警告ログ出力）
- [ ] 権限変更の実行ログが `/tmp/worktree-permission.log` に記録されている
- [ ] セキュリティリスクが増加していない（最小権限の原則を遵守）

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | `/workspaces/` 全体の所有者変更により他のプロジェクトに影響（**レビュー指摘**） | 高 | 中 | **対策済**: 対象を `/workspaces/ai-work-container` に限定。必要に応じて他のworktreeディレクトリのみ個別に権限変更する。 |
| RISK-002 | `sudo` が利用できない環境での失敗（**レビュー指摘**） | 高 | 中 | **対策済**: sudo 可用性チェックを追加し、利用できない場合は警告ログを出力してスキップ。ログファイル `/tmp/worktree-permission.log` で確認可能。 |
| RISK-003 | DevContainer再ビルド時に設定が失われる | 高 | 低 | `updateContentCommand` を使用してコンテナ更新時に実行（解決策A推奨） |
| RISK-004 | 権限変更スクリプトの実行失敗が気づかれない | 中 | 中 | スクリプトにログ出力を追加し、テスト計画に失敗ケースの確認を含める |
| RISK-005 | セキュリティリスクの増加 | 中 | 低 | 必要最小限の権限のみ変更（`ai-work-container` のみ対象）し、ドキュメント化 |
| RISK-006 | 他のVS Code拡張機能との競合 | 低 | 低 | テスト時に既存機能の動作確認を実施 |

**レビュー指摘への対応状況:**
- ✅ **高優先度**: `/workspaces` 全体への `chown -R` を `/workspaces/ai-work-container` に限定
- ✅ **中優先度**: sudo 可用性チェックとフォールバック処理を実装
- ✅ ログ出力を追加し、トラブルシューティングを容易化

## 7. 依存関係

- DevContainer環境が起動していること
- `vscode` ユーザーがコンテナ内に存在すること
- `postCreateCommand` または `updateContentCommand` が実行可能であること

## 8. 実装の詳細

### 解決策A: updateContentCommand を使用（推奨・改善版）

**理由:**
- コンテナ起動のたびに実行される
- 再ビルド不要で設定が適用される
- DevContainerの標準的なアプローチ

**改善点（レビュー指摘を反映）:**
- 対象範囲を `/workspaces` 全体から `/workspaces/ai-work-container` に限定（他のプロジェクトへの影響を回避）
- sudo 可用性チェックを追加
- フォールバック処理を実装

**実装内容:**

`.devcontainer/devcontainer.json`:
```json
{
  "postCreateCommand": "/usr/local/bin/devcontainer-post-create.sh",
  "updateContentCommand": "bash -c 'if sudo -n true 2>/dev/null; then sudo chown -R vscode:vscode /workspaces/ai-work-container 2>&1 | tee -a /tmp/worktree-permission.log || echo \"Warning: Failed to change ownership\" | tee -a /tmp/worktree-permission.log; else echo \"Warning: sudo not available, skipping permission change\" | tee -a /tmp/worktree-permission.log; fi'"
}
```

**代替案（より読みやすい形式）:**
別ファイルにスクリプトを作成する場合：

`.devcontainer/fix-workspaces-permission.sh`:
```bash
#!/bin/bash
set -e

LOG_FILE="/tmp/worktree-permission.log"
TARGET_DIR="/workspaces/ai-work-container"

echo "[$(date)] Checking permissions for $TARGET_DIR" | tee -a "$LOG_FILE"

# sudo が使用可能かチェック
if sudo -n true 2>/dev/null; then
    echo "[$(date)] sudo is available, changing ownership..." | tee -a "$LOG_FILE"
    if sudo chown -R vscode:vscode "$TARGET_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$(date)] Successfully changed ownership to vscode:vscode" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] ERROR: Failed to change ownership" | tee -a "$LOG_FILE"
        exit 1
    fi
else
    echo "[$(date)] WARNING: sudo not available, skipping permission change" | tee -a "$LOG_FILE"
    echo "[$(date)] Worktree operations may fail without proper permissions" | tee -a "$LOG_FILE"
fi
```

`.devcontainer/devcontainer.json`:
```json
{
  "postCreateCommand": "/usr/local/bin/devcontainer-post-create.sh",
  "updateContentCommand": "bash /workspaces/ai-work-container/.devcontainer/fix-workspaces-permission.sh"
}
```

### 解決策B: postCreateCommandスクリプト内で実行（改善版）

**理由:**
- 既存のスクリプトを再利用
- 一元管理が可能
- 初回セットアップ時のみ実行（コンテナ起動時には実行されない）

**改善点（レビュー指摘を反映）:**
- 対象を `/workspaces/ai-work-container` に限定
- sudo 可用性チェックとログ出力を追加

**実装内容:**

`.devcontainer/post-create.sh` に以下を追加:
```bash
#!/bin/bash

LOG_FILE="/tmp/worktree-permission.log"
TARGET_DIR="/workspaces/ai-work-container"

# /workspaces/ai-work-container ディレクトリの権限を調整（git worktree用）
if [ -d "$TARGET_DIR" ]; then
  echo "[$(date)] Adjusting permissions for git worktree support..." | tee -a "$LOG_FILE"

  # sudo が使用可能かチェック
  if sudo -n true 2>/dev/null; then
    if sudo chown -R vscode:vscode "$TARGET_DIR" 2>&1 | tee -a "$LOG_FILE"; then
      echo "[$(date)] Successfully changed ownership of $TARGET_DIR" | tee -a "$LOG_FILE"
    else
      echo "[$(date)] Warning: Could not change ownership of $TARGET_DIR" | tee -a "$LOG_FILE"
    fi
  else
    echo "[$(date)] Warning: sudo not available, skipping permission change" | tee -a "$LOG_FILE"
  fi
else
  echo "[$(date)] Warning: $TARGET_DIR does not exist" | tee -a "$LOG_FILE"
fi
```

**注意:**
- この方法は初回コンテナ作成時のみ実行されるため、コンテナ再起動後に権限が変更された場合には対応できません
- 継続的な権限維持には解決策A（updateContentCommand）を推奨

### 解決策C: Dockerfile で設定（非推奨）

**理由:**
- Dockerfileでは `/workspaces` がまだマウントされていない
- 効果がない可能性が高い

## 9. 次のアクション

**レビュー指摘対応済み項目:**
- ✅ 対象範囲を `/workspaces/ai-work-container` に限定
- ✅ sudo 可用性チェックとフォールバック処理を追加
- ✅ ログ出力機能を実装
- ✅ テスト計画に失敗ケースを追加

**実装前の確認:**
1. [ ] ユーザーに解決策A（updateContentCommand・推奨）と解決策B（postCreateCommandスクリプト）のどちらを選択するか確認
   - 推奨: 解決策A（コンテナ起動時に毎回実行され、権限が維持される）

**実装ステップ:**
2. [ ] 選択した解決策に基づいて以下を実装:
   - 解決策A: `.devcontainer/fix-workspaces-permission.sh` スクリプトを作成
   - 解決策A: `devcontainer.json` の `updateContentCommand` を更新
   - または解決策B: 既存の `post-create.sh` に権限調整処理を追加

**検証ステップ:**
3. [ ] DevContainerを再ビルドしてテスト（TEST-001）
4. [ ] 権限変更ログを確認（TEST-006）: `cat /tmp/worktree-permission.log`
5. [ ] `/workspaces/ai-work-container` の所有者確認: `ls -la /workspaces/`
6. [ ] `git worktree add ../test01` で動作確認（TEST-002）
7. [ ] worktree内でのgit操作テスト（TEST-003）
8. [ ] worktreeの削除テスト（TEST-004）
9. [ ] 既存のgit操作に影響がないか確認（TEST-005）
10. [ ] セキュリティテスト: 他のディレクトリの権限が変更されていないか確認（TEST-008）

**ドキュメント更新:**
11. [ ] `CLAUDE.md` に worktree の使用方法を追加
12. [ ] トラブルシューティングドキュメントにパーミッション問題の解決方法を記載

---

## 10. レビュー履歴

### 初回レビュー（2025年12月07日）
**レビュアー:** PR Reviewer Agent
**レビュー結果:** `ai/reviews/251207_devcontainer_worktree_permission_fix_review.md`

**主要な指摘事項:**
1. **高優先度**: `/workspaces` 全体への `chown -R` によるリスク
   - 他のプロジェクトや一時ファイルへの影響
   - パフォーマンス面での無駄な処理

2. **中優先度**: sudo 可用性の前提と失敗時の対応不足
   - フォールバック処理の欠如
   - エラーログの不足

**対応内容:**
- ✅ 対象範囲を `/workspaces/ai-work-container` に限定
- ✅ sudo 可用性チェックを追加（`sudo -n true`）
- ✅ フォールバック処理を実装（警告ログ出力してスキップ）
- ✅ 詳細なログ出力機能を追加（`/tmp/worktree-permission.log`）
- ✅ テスト計画にエラー処理とセキュリティテストを追加（TEST-006, TEST-007, TEST-008）
- ✅ リスクセクションを更新し、対応状況を明記

**修正後の推奨事項:**
- 解決策A（updateContentCommand + 専用スクリプト）を推奨
- ログファイルで実行結果を確認可能
- 最小権限の原則を遵守

---
*このプランは Plan Creator エージェントによって作成されました*
