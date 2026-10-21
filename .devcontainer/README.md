# DevContainer 設定ガイド

このディレクトリには、ai-work-container プロジェクトの DevContainer 設定とスクリプトが含まれています。

## 概要

このプロジェクトでは、以下の機能を提供します。

1. **Node.js ツールチェーンのセットアップ**: `anyenv` / `nodenv` / `node-build` を準備し、プロジェクト設定に応じた Node.js を導入
2. **Python ツールチェーンのセットアップ**: `uv` をインストールし、シェル起動時に参照できるよう `PATH` を調整
3. **Git worktree サポート**: `/workspaces/` のパーミッション調整により、Git worktree 作成をサポート
4. **開発ツール設定の永続化**: Docker volume `dev-home-data` を `/home/vscode/.dev-home-data` にマウントし、Codex と tmux の設定を保持

## Node.js のセキュリティ更新

- 共通環境は `.node-version` と `post-create.sh` の既定値で `22.23.4` を指定する。
- `node-build/22.23.4` に公式チェックサム付きの定義を同梱する。既存の node-build に新バージョンが登録されていなくても導入できる。
- 導入失敗や実バージョンの不一致がある場合はセットアップを停止する。セットアップ中は選択したバージョンを `NODENV_VERSION` に設定する。
- Playwright sidecar はベースイメージの Node.js 24 系を維持し、`Dockerfile.playwright` で修正版 `24.22.1` を指定する。変更後はホスト側で sidecar を再ビルド・再作成する。
- 既存プロセスは旧 Node.js で動き続けるため、作業が終わった時点で再起動する。VS Code Server 内蔵の Node.js は別管理のため、VS Code 側の更新も確認する。

既存シェルの `NODENV_VERSION` が旧版を固定している場合は、修正版の導入後にワークスペースルートで次を実行する。

```bash
unset NODENV_VERSION NODENV_DIR
eval "$(nodenv init -)"
node --version
```

## スクリプト一覧

### post-create.sh

DevContainer 作成後の初期セットアップを担当します。

**主な機能:**
- `anyenv` / `nodenv` / `node-build` の導入
- `~/.workspace_node_version`、`.node-version`、`package.json#engines.node` を使った Node.js バージョン自動判定
- `uv` の導入と `PATH` 設定
- `.devcontainer/shell-aliases.sh` に定義したワークスペース移動 alias の読み込み設定
- `~/.codex` と `~/.tmux.conf` を `/home/vscode/.dev-home-data` 配下への symlink として作成

**実行タイミング:** `postCreateCommand`

### fix-workspaces-permission.sh

`/workspaces/` のパーミッションを調整し、Git worktree 作成をサポートします。

**主な機能:**
- `/workspaces/ai-work-container` の所有者を `vscode:vscode` に変更
- `/workspaces/` のグループを `vscode` に変更
- `/workspaces/` のパーミッションを `2775` に設定（setgid ビット）

**実行タイミング:** `updateContentCommand`

## 手動検証手順

DevContainer の Rebuild/Update Content で動作確認を行う場合、以下の手順で検証してください。

### 1. DevContainer のリビルド

```
VS Code コマンドパレット (Ctrl+Shift+P)
→ Dev Containers: Rebuild Container
```

### 2. 動作確認

#### 2.1. パーミッションの確認

```bash
ls -ld /workspaces/
# 期待結果: drwxrwsr-x 3 root vscode 4096 <date> /workspaces/
```

#### 2.2. Git worktree の動作確認

```bash
cd /workspaces/ai-work-container
git worktree add /workspaces/test-worktree HEAD
ls -ld /workspaces/test-worktree
git worktree remove /workspaces/test-worktree
```

#### 2.3. Node.js の確認

```bash
node -v
pnpm -v
```

#### 2.4. uv の確認

```bash
uv --version
uvx --version
```

## トラブルシューティング

### Git worktree 作成時にパーミッションエラー

**原因:** `/workspaces/` のパーミッションが正しく設定されていない

**対処方法:**
```bash
bash /workspaces/ai-work-container/.devcontainer/fix-workspaces-permission.sh
```

## 参考資料

- [Docker Compose と DevContainer の統合](https://code.visualstudio.com/docs/remote/create-dev-container#_use-docker-compose)
- [Git worktree](https://git-scm.com/docs/git-worktree)
- [Linux パーミッションと setgid](https://linuxize.com/post/what-is-umask/)
