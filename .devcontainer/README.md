# DevContainer 設定ガイド

このディレクトリには、ai-work-container プロジェクトの DevContainer 設定とスクリプトが含まれています。

## 概要

このプロジェクトでは、以下の機能を提供します：

1. **一時ディレクトリの集約**: `works/` 配下の一時ディレクトリ（`node_modules`, `.next`, `.pnpm-store` 等）を `/workspaces/tmp` に集約し、シンボリックリンクで接続
2. **予防的シンボリックリンク作成**: プロジェクトタイプを自動検出し、まだディレクトリが存在しない場合でも予防的にシンボリックリンクを作成
3. **Git worktree サポート**: `/workspaces/` のパーミッション調整により、Git worktree 作成をサポート

## Docker Compose 移行による変更点

### 旧構成（devcontainer.json のみ）

以前は `devcontainer.json` で `node_modules` の volume mount を直接定義していました：

```json
"mounts": [
  "source=${localWorkspaceFolderBasename}-node_modules,target=${containerWorkspaceFolder}/node_modules,type=volume"
]
```

### 新構成（Docker Compose 統合）

Docker Compose に移行し、`node_modules` の volume mount を **撤去** しました。代わりに、以下のスクリプトベースのアプローチを採用：

- `init-tmp-volume.sh`: `/workspaces/tmp` ボリュームの初期化
- `setup-tmp-symlinks.sh`: 一時ディレクトリのシンボリックリンク作成
- `fix-workspaces-permission.sh`: パーミッション調整とスクリプト実行のオーケストレーション

### 副作用と影響

#### パフォーマンス

- **旧構成**: `node_modules` は専用ボリュームに保存され、I/O パフォーマンスが最適化されていた
- **新構成**: `/workspaces/tmp` ボリュームに統合され、複数の一時ディレクトリを一元管理
  - `.next`, `.pnpm-store`, `dist`, `out` 等も同様に管理
  - パフォーマンスへの影響は軽微（ボリューム自体は同じ Docker ボリュームストレージを使用）

#### 運用への影響

- **旧構成**: プロジェクトごとに `node_modules` ボリュームが作成され、管理が煩雑
- **新構成**: `/workspaces/tmp` ボリュームに集約され、管理が簡素化
  - ボリュームの削除・再作成が容易
  - 複数のプロジェクトで共通の一時ディレクトリを共有可能（`works/` 配下）

#### 互換性

- **後方互換性**: 既存のプロジェクトは `node_modules` が実ディレクトリとして存在する場合、自動的に `.bak-<timestamp>` に退避され、シンボリックリンクに置き換えられます（`--delete-existing` オプションで削除も可能）
- **マイグレーション**: 初回起動時に自動的に移行が実行されます

## スクリプト一覧

### init-tmp-volume.sh

`/workspaces/tmp` ボリュームを初期化し、適切な所有者とパーミッションを設定します。

**主な機能:**
- `/workspaces/tmp` ディレクトリの作成（初回のみ）
- 所有者を実行ユーザー（remoteUser: vscode）の UID/GID に設定
- パーミッション 0755 を設定

**実行タイミング:** DevContainer 起動時（`postStartCommand` 経由で `fix-workspaces-permission.sh` から呼び出し）

### setup-tmp-symlinks.sh

`works/` 配下の一時ディレクトリを検出し、`/workspaces/tmp` にシンボリックリンクを作成します。

**主な機能:**
- **既存ディレクトリ検出モード（デフォルト）**: 既に存在する一時ディレクトリを検出してシンボリックリンク化
- **予防的作成モード（`--preventive` オプション）**: `.git` ディレクトリからプロジェクトを検出し、プロジェクトタイプに応じてまだディレクトリが存在しない場合でも予防的にシンボリックリンクを作成

**オプション:**
- `--preventive`: 予防的シンボリックリンク作成モードを有効化
- `--dry-run`: 実際の変更を行わず、実行内容のみ表示
- `--verbose`: 詳細なログを出力
- `--delete-existing`: 既存の実ディレクトリを削除（デフォルトは `.bak-<timestamp>` へ退避）
- `--all`: 優先度低のパターン（`.cache`, `build`, `.turbo`）も含める

**検出されるプロジェクトタイプ:**
- **pnpm** (pnpm-lock.yaml): `node_modules`, `.pnpm-store`（最優先）
- **Yarn** (yarn.lock): `node_modules`（pnpm がない場合）
- **npm** (package-lock.json): `node_modules`（pnpm/yarn がない場合）
- **TypeScript** (tsconfig.json): `dist`, `out`
- **Next.js** (next.config.js): `.next`, `out`
- **Vite** (vite.config.js): `dist`

**実行タイミング:** DevContainer 起動時（`postStartCommand` 経由で `fix-workspaces-permission.sh` から呼び出し）

**使用例:**
```bash
# 既存ディレクトリのみを対象（デフォルト）
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh

# 予防的作成モードを有効化
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh --preventive

# ドライラン（実際の変更なし）
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh --preventive --dry-run

# 全パターン + 予防的作成
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh --all --preventive
```

### fix-workspaces-permission.sh

`/workspaces/` のパーミッションを調整し、Git worktree 作成をサポートします。また、`setup-tmp-symlinks.sh` を呼び出して一時ディレクトリのシンボリックリンクを作成します。

**主な機能:**
- `/workspaces/ai-work-container` の所有者を `vscode:vscode` に変更
- `/workspaces/` のグループを `vscode` に変更
- `/workspaces/` のパーミッションを `2775` に設定（setgid ビット）
- `setup-tmp-symlinks.sh` を呼び出し

**実行タイミング:** DevContainer 起動時（`postStartCommand`）

## 手動検証手順

DevContainer の Rebuild/Update Content で動作確認を行う場合、以下の手順で検証してください。

### 1. DevContainer のリビルド

```
VS Code コマンドパレット (Ctrl+Shift+P)
→ Dev Containers: Rebuild Container
```

### 2. 動作確認

#### 2.1. `/workspaces/tmp` の作成確認

```bash
ls -ld /workspaces/tmp
# 期待結果: drwxr-xr-x 3 vscode vscode 4096 <date> /workspaces/tmp
```

#### 2.2. シンボリックリンクの確認

```bash
# works/ 配下のシンボリックリンクを確認
find /workspaces/ai-work-container/works -type l -ls

# 例: works/sample-project/node_modules が /workspaces/tmp/works/sample-project/node_modules にリンク
```

#### 2.3. パーミッションの確認

```bash
# /workspaces/ のパーミッションを確認
ls -ld /workspaces/
# 期待結果: drwxrwsr-x 3 root vscode 4096 <date> /workspaces/
#           ^^^^^^^^
#           setgid ビット (s) が設定されていることを確認
```

#### 2.4. Git worktree の動作確認

```bash
# Git worktree を作成
cd /workspaces/ai-work-container
git worktree add /workspaces/test-worktree HEAD

# パーミッションエラーが発生しないことを確認
ls -ld /workspaces/test-worktree

# クリーンアップ
git worktree remove /workspaces/test-worktree
```

### 3. 予防的シンボリックリンク作成の確認

新しいプロジェクトを `works/` 配下に作成し、予防的シンボリックリンクが作成されることを確認します。

```bash
# 新規プロジェクトを作成
mkdir -p /workspaces/ai-work-container/works/test-project
cd /workspaces/ai-work-container/works/test-project
git init
echo '{"name": "test"}' > package.json
echo 'dependencies:' > pnpm-lock.yaml

# 予防的シンボリックリンク作成を実行
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh --preventive --verbose

# node_modules と .pnpm-store のシンボリックリンクが作成されていることを確認
ls -l node_modules .pnpm-store
# 期待結果: lrwxrwxrwx 1 vscode vscode <size> <date> node_modules -> /workspaces/tmp/works/test-project/node_modules
#          lrwxrwxrwx 1 vscode vscode <size> <date> .pnpm-store -> /workspaces/tmp/works/test-project/.pnpm-store

# クリーンアップ
cd /workspaces/ai-work-container
rm -rf works/test-project
```

## トラブルシューティング

### シンボリックリンクが作成されない

**原因:** 既に実ディレクトリが存在する

**対処方法:**
```bash
# 既存ディレクトリを退避してシンボリックリンクを作成
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh

# または、既存ディレクトリを削除してシンボリックリンクを作成
bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh --delete-existing
```

### Git worktree 作成時にパーミッションエラー

**原因:** `/workspaces/` のパーミッションが正しく設定されていない

**対処方法:**
```bash
# パーミッション修正スクリプトを再実行
bash /workspaces/ai-work-container/.devcontainer/fix-workspaces-permission.sh

# DevContainer を再起動
```

### `/workspaces/tmp` の所有者が正しくない

**原因:** `init-tmp-volume.sh` が正しく実行されていない、または UID/GID が想定と異なる

**対処方法:**
```bash
# 現在の UID/GID を確認
id -u
id -g

# スクリプトを再実行
bash /workspaces/ai-work-container/.devcontainer/init-tmp-volume.sh

# 手動で所有者を変更（必要に応じて）
sudo chown $(id -u):$(id -g) /workspaces/tmp
```

## 参考資料

- [Docker Compose と DevContainer の統合](https://code.visualstudio.com/docs/remote/create-dev-container#_use-docker-compose)
- [Git worktree](https://git-scm.com/docs/git-worktree)
- [Linux パーミッションと setgid](https://linuxize.com/post/what-is-umask/)

---

*このドキュメントは PR #25 レビュー指摘事項対応の一環として作成されました（TASK-010, 011）*
