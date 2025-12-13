# マルチプロジェクト環境セットアップガイド

## 概要
このガイドでは、単一のDevContainerで複数のプロジェクトを管理する環境の使用方法を説明します。

## アーキテクチャ

### ディレクトリ構造
```
ai-work-container/
├── .devcontainer/
│   ├── devcontainer.json           # メイン設定
│   ├── docker-compose.yml          # 単一サービス定義
│   ├── Dockerfile
│   ├── init-project.sh             # プロジェクト初期化スクリプト
│   ├── setup-project-links.sh      # 共通設定リンク作成
│   ├── backup-devcontainer.sh      # バックアップスクリプト
│   ├── rollback-devcontainer.sh    # ロールバックスクリプト
│   └── backup/                     # バックアップ保存先
├── .claude/                         # 共通Claude設定
├── .github/                         # 共通GitHub設定
├── repo/                            # プロジェクト格納ディレクトリ
│   ├── project-a/
│   │   ├── .devcontainer/
│   │   │   └── devcontainer.json   # 親コンテナにattach
│   │   ├── .claude -> ../../.claude # シンボリックリンク
│   │   └── .github -> ../../.github # シンボリックリンク
│   └── project-b/
│       └── ...
└── ai/
    └── templates/
        ├── project-devcontainer.json
        └── project-CLAUDE.md
```

### コンテナ共有モデル
```
┌─────────────────────────────────────────────────────────┐
│                  Docker Container                        │
│  (ai-work-container)                                    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  VS Code     │  │  VS Code     │  │  VS Code     │  │
│  │  Window 1    │  │  Window 2    │  │  Window 3    │  │
│  │  (main)      │  │  (project-a) │  │  (project-b) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  /workspaces/ai-work-container/                         │
│    ├── repo/project-a/  ← workspaceFolder               │
│    ├── repo/project-b/  ← workspaceFolder               │
│    └── ...                                              │
│                                                          │
│  ~/.config/claude-code/  ← 認証・設定（共有）            │
│  ~/.claude.json          ← MCP設定（共有）               │
└─────────────────────────────────────────────────────────┘
```

## 新規プロジェクトの追加

### 方法1: init-project.shスクリプトを使用（推奨）

#### 空のプロジェクトを作成
```bash
cd /workspaces/ai-work-container
.devcontainer/init-project.sh my-new-project
```

#### Git リポジトリをクローン
```bash
cd /workspaces/ai-work-container
.devcontainer/init-project.sh my-new-project https://github.com/user/repo.git
```

#### スクリプトの実行内容
1. `repo/my-new-project/` ディレクトリ作成または git clone
2. `.devcontainer/devcontainer.json` の自動生成
3. 共通設定（`.claude/`, `.github/`）へのシンボリックリンク作成
4. `docker-compose.yml` に node_modules 用ボリューム追加

**重要**: スクリプト実行後、コンテナを再作成する必要があります：
```
VS Code: Ctrl+Shift+P → 'Dev Containers: Rebuild Container'
```

### 方法2: 手動でプロジェクトを追加

#### 1. プロジェクトディレクトリを作成
```bash
cd /workspaces/ai-work-container/repo
git clone https://github.com/user/repo.git my-project
# または
mkdir my-project
```

#### 2. devcontainer.json を作成
```bash
mkdir -p my-project/.devcontainer
cat > my-project/.devcontainer/devcontainer.json <<'EOF'
{
  "name": "Project: my-project",
  "dockerComposeFile": [
    "../../../.devcontainer/docker-compose.yml"
  ],
  "service": "devcontainer",
  "workspaceFolder": "/workspaces/ai-work-container/repo/my-project",
  "shutdownAction": "none",
  "customizations": {
    "vscode": {
      "settings": {
        "git.autofetch": true
      }
    }
  }
}
EOF
```

#### 3. 共通設定へのシンボリックリンク作成
```bash
cd /workspaces/ai-work-container/repo/my-project
ln -s ../../.claude .claude
ln -s ../../.github .github
```

#### 4. docker-compose.yml にボリューム追加
`.devcontainer/docker-compose.yml` を編集：

```yaml
services:
  devcontainer:
    volumes:
      # 既存のボリューム設定...
      - my-project-node_modules:/workspaces/ai-work-container/repo/my-project/node_modules

volumes:
  # 既存のボリューム定義...
  my-project-node_modules:
```

#### 5. コンテナを再作成
```
VS Code: Ctrl+Shift+P → 'Dev Containers: Rebuild Container'
```

## 子プロジェクトを別ウィンドウで開く

### 方法1: VS Code UI経由（推奨）
1. `F1` または `Ctrl+Shift+P` でコマンドパレットを開く
2. `Dev Containers: Open Folder in Container...` を実行
3. `/workspaces/ai-work-container/repo/my-project` を選択
4. 新しいウィンドウが開き、既存コンテナにattachされる

### 方法2: Remote Explorer経由
1. VS Code の Remote Explorer パネルを開く
2. 「Dev Containers」セクションで実行中コンテナを右クリック
3. 「Attach to Container」を選択
4. 新しいウィンドウで `/workspaces/ai-work-container/repo/my-project` を開く

### 方法3: devcontainer CLI経由
```bash
# コンテナ内から実行
devcontainer open /workspaces/ai-work-container/repo/my-project
```

## 共通設定の利用

### Claude Code設定
- 認証情報: `~/.config/claude-code/` （全プロジェクトで共有）
- MCP設定: `~/.claude.json` （全プロジェクトで共有）
- プロジェクト固有設定: `repo/my-project/.claude/` （シンボリックリンク経由）

一度認証すれば、すべてのプロジェクトで Claude Code CLI が使用可能です。

### GitHub設定
- Workflows: `repo/my-project/.github/workflows/` （シンボリックリンク経由）
- PR/Issue テンプレート: `repo/my-project/.github/` （シンボリックリンク経由）

### Node.js バージョン管理
各プロジェクトで異なる Node.js バージョンを使用する場合：

1. プロジェクトルートに `.node-version` ファイルを配置
```bash
echo "20.11.0" > repo/my-project/.node-version
```

2. または `package.json` に指定
```json
{
  "engines": {
    "node": "20.11.0"
  }
}
```

3. `post-create.sh` が自動的に適切なバージョンをインストール

## ボリューム管理

### ボリューム命名規則
| 種別 | 命名パターン | 例 |
|------|-------------|-----|
| メインプロジェクト | `ai-work-container-node_modules` | - |
| 子プロジェクト | `${project-name}-node_modules` | `my-app-node_modules` |
| Claude認証 | `claude-config` | - |
| Claude MCP設定 | `claude-json` | - |

### ボリューム一覧の確認
```bash
# ホストマシンで実行
docker volume ls | grep -E "(ai-work-container|-node_modules|claude-)"
```

### 不要なボリュームの削除
```bash
# プロジェクトを削除した後、対応するボリュームも削除
docker volume rm my-old-project-node_modules

# 使用されていないボリュームをすべて削除
docker volume prune
```

## バックアップとロールバック

### バックアップの作成
```bash
# 設定ファイルのバックアップ
cd /workspaces/ai-work-container
bash .devcontainer/backup-devcontainer.sh
```

バックアップ内容:
- `devcontainer.json`
- `docker-compose.yml`
- `post-create.sh`
- `Dockerfile`
- `init-project.sh`
- `setup-project-links.sh`

### ロールバック
```bash
# 利用可能なバックアップを確認
bash .devcontainer/rollback-devcontainer.sh

# 特定のタイムスタンプでロールバック
bash .devcontainer/rollback-devcontainer.sh 20251213_023148
```

ロールバック後、コンテナを再ビルド：
```
VS Code: Ctrl+Shift+P → 'Dev Containers: Rebuild Container'
```

### ボリュームデータのバックアップ（オプション）
重要なデータがある場合のみ実行：
```bash
# 特定のボリュームをバックアップ
docker run --rm \
  -v my-project-node_modules:/source:ro \
  -v $(pwd)/.devcontainer/backup/volumes:/backup \
  ubuntu:24.04 \
  tar czf /backup/my-project-node_modules.tar.gz -C /source .
```

## トラブルシューティング

### 子プロジェクトが別ウィンドウで開けない
**原因**: devcontainer.json が正しく設定されていない

**解決方法**:
1. `repo/my-project/.devcontainer/devcontainer.json` が存在するか確認
2. `dockerComposeFile` パスが正しいか確認（相対パス）
3. `workspaceFolder` が正しいか確認

### node_modules ボリュームが効いていない
**原因**: docker-compose.yml にボリューム定義が追加されていない、またはコンテナが再作成されていない

**解決方法**:
1. `docker-compose.yml` にボリューム定義があるか確認
2. コンテナを再作成: `Dev Containers: Rebuild Container`
3. ボリュームがマウントされているか確認:
```bash
docker inspect <container-id> | grep -A 10 "Mounts"
```

### シンボリックリンクが機能しない
**原因**: リンク先が存在しない、またはパスが間違っている

**解決方法**:
```bash
# リンクを確認
ls -la repo/my-project/.claude

# リンクを再作成
cd repo/my-project
rm .claude .github
ln -s ../../.claude .claude
ln -s ../../.github .github
```

### コンテナ再ビルド時にエラーが発生
**原因**: docker-compose.yml の構文エラー

**解決方法**:
1. YAML の構文を確認（インデント、コロン、ハイフンなど）
2. バックアップから復元:
```bash
bash .devcontainer/rollback-devcontainer.sh <timestamp>
```

### 複数ウィンドウを閉じるとコンテナが停止する
**原因**: `shutdownAction` が `stopContainer` になっている

**解決方法**:
すべての devcontainer.json で `"shutdownAction": "none"` を設定

## 運用のベストプラクティス

### プロジェクト追加時
1. `init-project.sh` スクリプトを使用（冪等性あり）
2. コミット前にバックアップを作成
3. コンテナ再作成前に開いているウィンドウをすべて閉じる
4. 再作成後、すべてのプロジェクトが正常に開けるか確認

### 定期的なメンテナンス
1. 不要なプロジェクトディレクトリを削除
2. 対応するボリュームを削除
3. 古いバックアップファイルを削除（7日以上経過）
4. docker-compose.yml から不要なボリューム定義を削除

### セキュリティ
1. プロジェクト固有の秘密情報は各プロジェクトの `.env` ファイルに保存
2. `.env` ファイルは `.gitignore` に追加
3. 共通設定（`.claude/`, `.github/`）には秘密情報を含めない

## FAQ

### Q: メインプロジェクトと子プロジェクトの違いは？
**A**: メインプロジェクト（`ai-work-container`）がコンテナの初回ビルドを担当します。子プロジェクトは既存のコンテナにattachするだけで、ビルドは行いません。

### Q: プロジェクトごとに異なる VS Code 拡張機能をインストールできる？
**A**: はい。各プロジェクトの `devcontainer.json` の `customizations.vscode.extensions` に追加してください。

### Q: Claude Code の認証はプロジェクトごとに必要？
**A**: いいえ。認証情報はユーザーホームディレクトリ（`~/.config/claude-code/`）に保存されるため、一度認証すればすべてのプロジェクトで使用できます。

### Q: プロジェクトを削除するには？
**A**:
1. プロジェクトディレクトリを削除: `rm -rf repo/my-project`
2. docker-compose.yml からボリューム定義を削除
3. ボリュームを削除: `docker volume rm my-project-node_modules`
4. コンテナを再作成

### Q: docker-compose.yml を変更せずにプロジェクトを追加できる？
**A**: いいえ。node_modules 用のボリュームを利用するには、docker-compose.yml にボリューム定義を追加し、コンテナを再作成する必要があります。ただし、ボリュームを使用しない場合（小規模プロジェクト）は、docker-compose.yml の変更は不要です。

## 参考資料
- [VS Code: Connect to multiple containers](https://code.visualstudio.com/remote/advancedcontainers/connect-multiple-containers)
- [VS Code: Attach to a running container](https://code.visualstudio.com/docs/devcontainers/attach-container)
- [Docker Compose documentation](https://docs.docker.com/compose/)
- [プランドキュメント](../ai/plans/251212_単一コンテナ・マルチプロジェクト導入プラン.md)
