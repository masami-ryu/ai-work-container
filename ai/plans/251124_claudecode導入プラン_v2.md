# Claude Code 導入プラン (v3)

## 概要
devcontainer環境にClaude Codeを導入し、VS Code拡張機能とCLIツールの両方を利用可能にする。既存のMCP設定(GitHub, Microsoft Learn, Context7)をClaude Codeと統合する。

## 前提条件の確認
- ✅ Node.js環境: nodenv経由で管理されている
- ✅ VS Code Dev Container: 稼働中
- ✅ MCP設定: `.vscode/mcp.json`で既存のMCPサーバー設定済み

## プランの構成
このプランは以下の3つのセクションで構成されています:
1. **実装タスク**: devcontainer環境へのClaude Code導入に必要な技術的実装
2. **運用手順**: Claude Code CLI初期セットアップ後にユーザーが実行する手順
3. **ドキュメント整備**: トラブルシューティングやリファレンス用のドキュメント作成

## セクション1: 実装タスク

このセクションでは、devcontainer環境にClaude Codeを組み込むための技術的実装を行います。

### 1. Claude Code CLI のネイティブインストール (post-create.sh)

#### 1.1 ネイティブバイナリのインストールスクリプト
**ファイル**: `.devcontainer/post-create.sh`

**目的**: コンテナ作成時にClaude Code CLIを自動インストールし、PATH設定を行う

**冪等性要件**:
- 既にインストール済みの場合はスキップ
- 再ビルド時に同じバージョンが存在する場合は再インストールしない
- ログファイルは日付ローテーションで肥大化を防ぐ

**実装内容**:
```bash
# Claude Code CLI のネイティブインストール
echo "Claude Code CLI をインストール中..."

# インストール済みチェック(冪等性確保)
if command -v claude >/dev/null 2>&1; then
  INSTALLED_VERSION=$(claude --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
  echo "Claude Code CLI は既にインストールされています: v${INSTALLED_VERSION}"
  echo "再インストールをスキップします。"
  exit 0
fi

# ログファイルの設定(日付ローテーション)
LOG_DIR="${HOME}/.cache/claude-install-logs"
mkdir -p "$LOG_DIR"
LOGFILE="${LOG_DIR}/install-$(date '+%Y%m%d').log"
touch "$LOGFILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Claude Code CLI インストール開始" | tee -a "$LOGFILE"

# 古いログファイルのクリーンアップ(7日以上前のログを削除)
find "$LOG_DIR" -name "install-*.log" -mtime +7 -delete 2>/dev/null || true

# アーキテクチャとOSの検出
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

# アーキテクチャの正規化
case "$ARCH" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo "[エラー] サポートされていないアーキテクチャ: $ARCH" | tee -a "$LOGFILE"
    exit 1
    ;;
esac

# インストールスクリプトのダウンロードと実行
INSTALL_URL="https://claude.ai/install.sh"
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -fsSL "$INSTALL_URL" 2>&1 | tee -a "$LOGFILE" | bash; then
    echo "Claude Code CLI のインストールに成功しました。" | tee -a "$LOGFILE"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      echo "[警告] インストール失敗。リトライ中... ($RETRY_COUNT/$MAX_RETRIES)" | tee -a "$LOGFILE"
      sleep 2
    else
      echo "[エラー] Claude Code CLI のインストールに失敗しました。ログを確認してください: $LOGFILE" | tee -a "$LOGFILE"
      exit 1
    fi
  fi
done

# インストール先の確認とPATH設定
# Claude Code は通常 ~/.local/bin または /usr/local/bin にインストールされる
CLAUDE_INSTALL_DIR="$HOME/.local/bin"
if [ ! -d "$CLAUDE_INSTALL_DIR" ]; then
  CLAUDE_INSTALL_DIR="/usr/local/bin"
fi

# PATH への追加(存在しない場合のみ)
if [ -d "$CLAUDE_INSTALL_DIR" ]; then
  export PATH="$CLAUDE_INSTALL_DIR:$PATH"
  
  # 各シェル設定ファイルへの PATH 追加(bash / zsh 対応)
  for SHELL_RC in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$SHELL_RC" ]; then
      if ! grep -q "# Claude Code CLI" "$SHELL_RC"; then
        echo "" >> "$SHELL_RC"
        echo "# Claude Code CLI" >> "$SHELL_RC"
        echo "export PATH=\"$CLAUDE_INSTALL_DIR:\$PATH\"" >> "$SHELL_RC"
        echo "$(basename $SHELL_RC) に Claude Code CLI の PATH を追加しました" | tee -a "$LOGFILE"
      fi
    fi
  done
fi

# インストール確認
if command -v claude >/dev/null 2>&1; then
  FINAL_VERSION=$(claude --version 2>/dev/null || echo "version check failed")
  echo "Claude Code CLI が正常にインストールされました: ${FINAL_VERSION}" | tee -a "$LOGFILE"
else
  echo "[警告] Claude Code CLI が見つかりません。手動でインストールしてください。" | tee -a "$LOGFILE"
fi
```

**実装時の注意**:
- 公式インストールスクリプト(`https://claude.ai/install.sh`)を使用
- x64/arm64 アーキテクチャに対応
- 既存インストールの検出により冪等性を確保
- ログファイルは `~/.cache/claude-install-logs/` に日付別保存
- 7日以上前のログは自動削除
- bash と zsh の両方に対応
- インストール失敗時は最大3回リトライ
- すべての重要な出力を `tee -a` でログファイルに記録

**検証方法**:
```bash
claude --version
which claude
ls -lh ~/.cache/claude-install-logs/
```

#### 1.2 環境変数の設定
**ファイル**: `.devcontainer/post-create.sh` または `.bashrc`

**実装内容**:
```bash
# Claude Code 環境変数(オプション)
export CLAUDE_CODE_EXIT_AFTER_STOP_DELAY=5000
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0
export DISABLE_AUTOUPDATER=0
```

### 2. VS Code 拡張機能の追加

#### 2.1 devcontainer.json の更新
**ファイル**: `.devcontainer/devcontainer.json`

**実装内容**:

既存の `extensions` 配列に `"anthropic.claude-code"` を追加します。

```json
"extensions": [
  "eamodio.gitlens",
  "github.vscode-pull-request-github",
  "github.vscode-github-actions",
  "anthropic.claude-code"
]
```

**⚠️ 実装時の注意**:
- JSONファイルには **コメントを記述できません**(`// ← 追加` などは削除)
- 配列の最後の要素の後にカンマを付けないこと
- 既存の設定構造を崩さないよう、拡張機能リストのみを更新

**検証方法**:
- コンテナ再起動後、VS Code拡張機能リストで`Anthropic Claude Code`が表示されることを確認

### 3. MCP 設定の Claude Code への統合

#### 3.1 現在の MCP 設定の確認
**現状**: `.vscode/mcp.json`に以下が設定済み
- `msdocs`: Microsoft Learn ドキュメント
- `context7`: コード例検索
- `github-mcp-server`: GitHub API統合

#### 3.2 Claude Code CLI の `mcp add` コマンドを使用した統合

**jq依存の振る舞い定義**:
- `jq`がインストールされている場合: 自動でMCP設定を解析して追加
- `jq`がインストールされていない場合: 警告を表示し、手動設定ドキュメントへ誘導(処理は継続、エラー終了しない)

**オプションA: 自動統合スクリプト作成(推奨)**

**ファイル**: `.devcontainer/setup-claude-mcp.sh`

**目的**: VS Codeの既存MCP設定をClaude Code CLIに自動的に移行する

**実装内容**:
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Claude Code に MCP サーバーを追加中..."

# Claude コマンドの存在確認
if ! command -v claude >/dev/null 2>&1; then
  echo "[エラー] Claude Code CLI がインストールされていません"
  echo "先に 'claude' コマンドをインストールし、ログインを完了してください。"
  exit 1
fi

# VS Code の MCP 設定を読み込んで Claude Code に追加
VSCODE_MCP_FILE="/workspaces/ai-work-container/.vscode/mcp.json"

if [ ! -f "$VSCODE_MCP_FILE" ]; then
  echo "[警告] VS Code の MCP 設定ファイルが見つかりません: $VSCODE_MCP_FILE"
  echo "手動でMCPサーバーを追加してください。"
  exit 1
fi

# jq の存在確認と分岐処理
if ! command -v jq >/dev/null 2>&1; then
  echo "[警告] jq がインストールされていません。"
  echo "MCP設定の自動読み込みをスキップします。"
  echo ""
  echo "以下のいずれかを選択してください:"
  echo "  1. jq をインストールして再実行: sudo apt-get install -y jq"
  echo "  2. 手動でMCPサーバーを追加: docs/claude-code-mcp-setup.md を参照"
  exit 0
fi

echo "VS Code の MCP 設定を読み込んでいます..."

# mcpServers オブジェクトから各サーバーを抽出してループ処理
jq -r '.mcpServers | to_entries[] | @json' "$VSCODE_MCP_FILE" | while IFS= read -r server; do
  SERVER_NAME=$(echo "$server" | jq -r '.key')
  TRANSPORT=$(echo "$server" | jq -r '.value.transport // "stdio"')
  
  echo "${SERVER_NAME} MCP サーバーを追加中..."
  
  if [ "$TRANSPORT" = "http" ] || [ "$TRANSPORT" = "https" ]; then
    # HTTP/HTTPS トランスポート
    URL=$(echo "$server" | jq -r '.value.url // .value.command')
    if [ -n "$URL" ] && [ "$URL" != "null" ]; then
      claude mcp add --transport http "$SERVER_NAME" "$URL" || \
        echo "[警告] ${SERVER_NAME} の追加に失敗しました"
    fi
  else
    # STDIO トランスポート
    COMMAND=$(echo "$server" | jq -r '.value.command')
    
    if [ -n "$COMMAND" ] && [ "$COMMAND" != "null" ]; then
      # args を配列として取得してクォート処理
      mapfile -t ARGS_ARRAY < <(echo "$server" | jq -r '.value.args[]? // empty')
      
      if [ ${#ARGS_ARRAY[@]} -gt 0 ]; then
        claude mcp add --transport stdio "$SERVER_NAME" "$COMMAND" "${ARGS_ARRAY[@]}" || \
          echo "[警告] ${SERVER_NAME} の追加に失敗しました"
      else
        claude mcp add --transport stdio "$SERVER_NAME" "$COMMAND" || \
          echo "[警告] ${SERVER_NAME} の追加に失敗しました"
      fi
    fi
  fi
done

# GitHub MCP サーバーの認証ヘッダー自動設定
echo ""
echo "GitHub MCP サーバーの認証設定を適用中..."
if [ -n "${GITHUB_MCP_PAT:-}" ]; then
  CLAUDE_SETTINGS="$HOME/.config/claude-code/settings.json"
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  
  # 既存設定の読み込みまたは空オブジェクト作成
  if [ -f "$CLAUDE_SETTINGS" ]; then
    CURRENT_SETTINGS=$(cat "$CLAUDE_SETTINGS")
  else
    CURRENT_SETTINGS='{}'
  fi
  
  # jq で GitHub MCP 認証ヘッダーを追加
  echo "$CURRENT_SETTINGS" | jq \
    --arg token "$GITHUB_MCP_PAT" \
    '.mcpServers["github-mcp-server"].headers.Authorization = "Bearer \($token)"' \
    > "$CLAUDE_SETTINGS"
  
  echo "[成功] GitHub MCP の認証設定を自動適用しました"
else
  echo "[警告] GITHUB_MCP_PAT 環境変数が設定されていません"
  echo "GitHub MCP サーバーを使用するには、以下を実行してください:"
  echo "  1. export GITHUB_MCP_PAT=your_token_here"
  echo "  2. このスクリプトを再実行"
fi

# 追加されたMCPサーバーの一覧表示
echo ""
echo "追加された MCP サーバー:"
claude mcp list || echo "[警告] MCP サーバー一覧の取得に失敗しました"
```

**MCPコマンド解説**:
```bash
# HTTP MCP サーバーの追加
claude mcp add --transport http <server-name> <url>

# STDIO MCP サーバーの追加
claude mcp add --transport stdio <server-name> <command> [args...]

# MCP サーバー一覧表示
claude mcp list

# MCP サーバー削除
claude mcp remove <server-name>
```

**依存関係のフォールバック戦略**:
| 状態 | 動作 |
|------|------|
| `jq`あり + `GITHUB_MCP_PAT`あり | 完全自動化(MCP追加+認証設定) |
| `jq`あり + `GITHUB_MCP_PAT`なし | MCP追加のみ実行、認証は警告表示 |
| `jq`なし | 警告表示して手動設定案内(exit 0) |
| `claude`コマンドなし | エラー表示して終了(exit 1) |

**注意**: 
- このスクリプトは運用手順で手動実行します(post-create.shには含めない)
- Claude Code CLI の初期セットアップ(ログイン)完了後に実行してください
- 理由: 初回ビルド時に認証トークンがないと `claude mcp add` が失敗するため

**検証方法**:
```bash
# MCP サーバー一覧確認
claude mcp list

# 設定ファイル確認
cat ~/.config/claude-code/settings.json
```

**オプションB: 手動設定ドキュメント作成**

**ファイル**: `docs/claude-code-mcp-setup.md`

**目的**: jqが利用できない環境や、自動化スクリプトが失敗した場合の手動設定ガイド

**実装内容**:
```markdown
# Claude Code MCP 設定手順

## 概要
VS Code の `.vscode/mcp.json` で設定された MCP サーバーを Claude Code CLI の `mcp add` コマンドで追加します。

## 前提条件
- Claude Code CLI がインストール済み (`claude --version` で確認)
- GitHub Personal Access Token (PAT) を取得済み

## 手動設定方法

### 1. GitHub Personal Access Token の取得

#### 必要最小スコープ(ユースケース別)

**読み取り専用の利用(推奨)**:
- `repo:status` - コミットステータスへのアクセス
- `public_repo` - パブリックリポジトリへのアクセス
- `read:org` - 組織情報の読み取り
- `read:user` - ユーザー情報の読み取り

**フルアクセスが必要な場合**(Issue作成、PR作成等を行う場合):
- `repo` - リポジトリへのフルアクセス(private含む)
- `read:org` - 組織情報の読み取り
- `read:user` - ユーザー情報の読み取り

**取得手順**:
1. GitHub にログイン → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" をクリック
3. 上記のスコープを選択(用途に応じて最小権限を選択)
4. トークンをコピー(再表示できないため注意)

**セキュリティ注意事項**:
- トークンは安全な場所に保管
- 環境変数で管理し、コードにハードコードしない
- 不要になったトークンは速やかに削除
- 定期的にトークンをローテーション

### 2. 環境変数の設定

```bash
# bash の場合
echo "export GITHUB_MCP_PAT=ghp_your_token_here" >> ~/.bashrc
source ~/.bashrc

# zsh の場合
echo "export GITHUB_MCP_PAT=ghp_your_token_here" >> ~/.zshrc
source ~/.zshrc
```

### 3. Claude Code CLI で MCP サーバーを追加

```bash
# msdocs (HTTP MCP サーバー)
claude mcp add --transport http msdocs https://learn.microsoft.com/api/mcp

# context7 (STDIO MCP サーバー)
claude mcp add --transport stdio context7 npx -y @upstash/context7-mcp@latest

# github-mcp-server (HTTP MCP サーバー - 認証付き)
claude mcp add --transport http github-mcp-server https://api.githubcopilot.com/mcp/
```

### 4. GitHub MCP サーバーの認証設定

`~/.config/claude-code/settings.json` を編集して、Authorization ヘッダーを追加:

```json
{
  "mcpServers": {
    "github-mcp-server": {
      "headers": {
        "Authorization": "Bearer ${GITHUB_MCP_PAT}"
      }
    }
  }
}
```

または、手動で編集:

```bash
code ~/.config/claude-code/settings.json
```

### 5. 検証

```bash
# MCP サーバー一覧確認
claude mcp list

# Claude Code を起動して MCP ツールが利用可能か確認
claude

# Claude Code 内で /mcp コマンドを実行して確認
```

## MCP コマンド一覧

```bash
# MCP サーバー追加 (HTTP)
claude mcp add --transport http <server-name> <url>

# MCP サーバー追加 (STDIO)
claude mcp add --transport stdio <server-name> <command> [args...]

# MCP サーバー一覧表示
claude mcp list

# MCP サーバー削除
claude mcp remove <server-name>

# MCP サーバー詳細表示
claude mcp show <server-name>
```

## トラブルシューティング

### MCP サーバーに接続できない
- `claude mcp list` で追加されているか確認
- `GITHUB_MCP_PAT` が正しく設定されているか確認: `echo $GITHUB_MCP_PAT`
- トークンの権限スコープが適切か確認
- ネットワーク接続を確認

### STDIO MCP サーバーが起動しない
- `npx` コマンドが利用可能か確認: `which npx`
- Node.js がインストールされているか確認: `node --version`
- npm がインストールされているか確認: `npm --version`

### 設定ファイルの場所
- Linux/macOS: `~/.config/claude-code/settings.json`
- Windows: `%APPDATA%\claude-code\settings.json`

### GitHub PATの権限エラー
- トークンのスコープが不足している可能性があります
- 必要最小スコープを確認し、トークンを再生成してください
- プライベートリポジトリにアクセスする場合は `repo` スコープが必要です
```

### 4. 依存パッケージの追加

#### 4.1 Dockerfile の更新
**ファイル**: `.devcontainer/Dockerfile`

**追加パッケージ**:
- `curl`: Claude Code インストールスクリプトのダウンロードに使用
- `jq`: JSON処理用(オプション - MCP設定の解析に使用)

**実装内容**:

```dockerfile
# curl: Claude Code インストールに必要
# jq: JSON処理ツール(MCP設定解析に使用 - オプション)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    git \
    build-essential \
    libssl-dev \
    libreadline-dev \
    zlib1g-dev \
    ca-certificates \
    wget \
    locales \
    jq \
  && locale-gen en_US.UTF-8 \
  && rm -rf /var/lib/apt/lists/*
```

**注意**: 
- `curl` は Claude Code のネイティブインストールに必須
- `jq` は MCP サーバー追加の自動化スクリプトで使用(なくても手動設定可能)
- コメントは別行に記述して、パッケージ削除時の判断材料とする

### 5. 設定ファイルの作成

#### 5.1 Claude Code 初期設定テンプレートファイル
**ファイル**: `.devcontainer/claude-code-settings.json`(テンプレート)

**用途**: Claude Code の基本設定テンプレート(MCP サーバーは `claude mcp add` コマンドで追加)

#### 5.2 プロジェクト固有ファイル拡張子の棚卸し

このプロジェクトで使用している/今後使用予定のファイル拡張子:
- **必須**: `.md`, `.json`, `.sh`, `.yml`, `.yaml`
- **開発言語**(必要に応じて): `.js`, `.ts`, `.py`, `.go`, `.rs`
- **設定ファイル**: `.toml`, `.ini`, `.conf`
- **ドキュメント**: `.txt`, `.adoc`

#### 5.3 セキュリティレベル別設定テンプレート

**実装内容(レベル1: 安全重視 - デフォルト推奨)**:
```json
{
  "permissions": {
    "allowedTools": [
      "Read(**/*.{md,json,sh,yml,yaml,js,ts,py,go,rs,toml,txt})",
      "Edit(**/*.{md,json,sh,yml,yaml})",
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log:*)",
      "Bash(git branch:*)"
    ],
    "deniedTools": [
      "Edit(/.env*)",
      "Edit(/**/*secret*)",
      "Edit(/**/*password*)",
      "Edit(/**/*.key)",
      "Edit(/**/*.pem)",
      "Edit(/**/*.crt)",
      "Edit(/.*)",
      "Bash(rm:*)",
      "Bash(chmod:*)",
      "Bash(chown:*)",
      "Bash(sudo:*)"
    ]
  },
  "permissionMode": "prompt",
  "spinnerTipsEnabled": true,
  "statusLine": {
    "enabled": true,
    "format": "{{model}} | {{tokens}}"
  },
  "sandbox": {
    "allowUnsandboxedCommands": false
  }
}
```

**レベル2: バランス型**:
```json
{
  "permissions": {
    "allowedTools": [
      "Read(**/*)",
      "Edit(**/*.{md,json,sh,yml,yaml,js,ts,py,go,rs,toml,ini,conf})",
      "Bash(git:*)",
      "Bash(npm:install)",
      "Bash(npm:run:*)",
      "Bash(node:*)",
      "Bash(docker:ps)",
      "Bash(docker:logs:*)"
    ],
    "deniedTools": [
      "Edit(/.env*)",
      "Edit(/**/*secret*)",
      "Edit(/**/*password*)",
      "Edit(/**/*.key)",
      "Edit(/**/*.pem)",
      "Bash(rm -rf:*)",
      "Bash(sudo:*)"
    ]
  },
  "permissionMode": "prompt",
  "spinnerTipsEnabled": true,
  "statusLine": {
    "enabled": true,
    "format": "{{model}} | {{tokens}}"
  },
  "sandbox": {
    "allowUnsandboxedCommands": false
  }
}
```

**レベル3: 開発効率優先(リスク理解必須)**:
```json
{
  "permissions": {
    "allowedTools": [
      "Read(**/*)",
      "Edit(**/*.{md,json,sh,yml,yaml,js,ts,py,go,rs,toml,ini,conf,txt})",
      "Bash(git:*)",
      "Bash(npm:*)",
      "Bash(node:*)",
      "Bash(docker:*)",
      "Bash(make:*)"
    ],
    "deniedTools": [
      "Edit(/.env*)",
      "Edit(/**/*secret*)",
      "Edit(/**/*password*)",
      "Edit(/**/*.key)",
      "Edit(/**/*.pem)",
      "Edit(/**/*.crt)",
      "Bash(rm -rf /:*)",
      "Bash(rm -rf /home:*)",
      "Bash(rm -rf /usr:*)"
    ]
  },
  "permissionMode": "acceptEdits",
  "spinnerTipsEnabled": false,
  "statusLine": {
    "enabled": true,
    "format": "{{model}} | {{tokens}}"
  },
  "sandbox": {
    "allowUnsandboxedCommands": true
  }
}
```

#### 5.4 設定レベル比較表

| 項目 | レベル1(安全重視) | レベル2(バランス) | レベル3(効率優先) |
|------|------------------|------------------|------------------|
| **読み取り** | 特定拡張子のみ | すべてのファイル | すべてのファイル |
| **編集** | ドキュメント・設定のみ | ソースコード含む | ソースコード含む |
| **Bash実行** | git読み取りのみ | npm/docker一部許可 | 広範囲許可 |
| **permissionMode** | prompt(都度確認) | prompt(都度確認) | acceptEdits(自動承認) |
| **サンドボックス** | 有効 | 有効 | 無効 |
| **適用推奨** | 初回導入・評価中 | 通常開発 | 高速開発・信頼環境 |

#### 5.5 適用方法

**自動適用**(post-create.shに追加):
```bash
# Claude Code 設定テンプレートの適用
CLAUDE_CONFIG_DIR="$HOME/.config/claude-code"
TEMPLATE_FILE="/workspaces/ai-work-container/.devcontainer/claude-code-settings.json"

if [ -f "$TEMPLATE_FILE" ] && [ ! -f "$CLAUDE_CONFIG_DIR/settings.json" ]; then
  mkdir -p "$CLAUDE_CONFIG_DIR"
  cp "$TEMPLATE_FILE" "$CLAUDE_CONFIG_DIR/settings.json"
  echo "Claude Code 設定テンプレート(レベル1:安全重視)を適用しました"
  echo "設定変更: code ~/.config/claude-code/settings.json"
fi
```

**手動適用**:
```bash
# デフォルト(レベル1)を適用
mkdir -p ~/.config/claude-code
cp .devcontainer/claude-code-settings.json ~/.config/claude-code/settings.json

# 既存設定の確認
cat ~/.config/claude-code/settings.json
```

**カスタマイズガイド**:
- プロジェクトで新しい言語を使う場合は `allowedTools` の拡張子リストに追加
- 機密ファイル命名規則がある場合は `deniedTools` にパターン追加
- CI/CD環境では `permissionMode: "acceptEdits"` を検討(ただしリスク理解必須)

**注意**: MCP サーバー設定は `claude mcp add` コマンドで追加するため、このテンプレートには含めない

## 実装順序

### Phase 1: 環境構築(実装タスク)
**目的**: devcontainer環境にClaude Codeの基盤を構築する

- [ ] Dockerfile に `curl` パッケージ確認(既存の場合はスキップ)
- [ ] Dockerfile に `jq` パッケージ追加
- [ ] `.devcontainer/claude-code-settings.json` テンプレート作成(レベル1:安全重視)
- [ ] `post-create.sh` に Claude Code ネイティブインストール処理追加(冪等性確保)
- [ ] `post-create.sh` に設定テンプレート適用処理追加
- [ ] `devcontainer.json` に VS Code 拡張機能追加(`anthropic.claude-code`)
- [ ] コンテナ再ビルド
- [ ] 動作確認(`claude --version`, 拡張機能表示確認)

**合格基準**:
- `claude --version` でバージョンが表示される
- VS Code拡張機能リストに "Anthropic Claude Code" が表示される
- コンテナ再ビルドで再インストールされない(冪等性)

### Phase 2: MCP統合スクリプト作成(実装タスク)
**目的**: 自動化スクリプトとマニュアルドキュメントを準備する

- [ ] `.devcontainer/setup-claude-mcp.sh` 作成
  - jq依存のフォールバック処理実装
  - GitHub PAT未設定時の警告メッセージ追加
  - エラーハンドリング強化
- [ ] `docs/claude-code-mcp-setup.md` 作成
  - GitHub PAT最小権限スコープの記載
  - トラブルシューティングセクション追加
  - セキュリティ注意事項の明記
- [ ] スクリプトに実行権限付与
  ```bash
  chmod +x /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
  ```

**合格基準**:
- `setup-claude-mcp.sh` が構文エラーなく実行できる
- jqがない環境で警告が表示され、処理が継続する
- ドキュメントにトラブルシューティングが網羅されている

## セクション2: 運用手順

このセクションでは、実装完了後にユーザーが行う初期セットアップ手順を示します。

### Phase 3: Claude Code初期セットアップ(運用手順)
**目的**: Claude Code CLIにログインし、基本動作を確認する

**前提条件**: Phase 1が完了し、コンテナが再ビルドされていること

- [ ] Claude Code CLIにログイン
  ```bash
  claude login
  ```
  ブラウザで認証フローを完了

- [ ] ログイン確認
  ```bash
  claude whoami
  ```

- [ ] 基本動作テスト
  ```bash
  claude --help
  echo "Hello from Claude Code" | claude
  ```

**合格基準**:
- `claude whoami` でユーザー情報が表示される
- 簡単なプロンプトに対してClaude Codeが応答する

### Phase 4: GitHub PAT設定(運用手順)
**目的**: GitHub MCP サーバー用の認証情報を設定する

- [ ] GitHub Personal Access Token (PAT) を取得
  - Settings → Developer settings → Personal access tokens → Tokens (classic)
  - スコープ選択(読み取り専用の場合):
    - `repo:status`
    - `public_repo`
    - `read:org`
    - `read:user`

- [ ] 環境変数に設定
  ```bash
  echo 'export GITHUB_MCP_PAT=ghp_your_token_here' >> ~/.bashrc
  source ~/.bashrc
  ```

- [ ] 設定確認
  ```bash
  echo $GITHUB_MCP_PAT
  ```

**合格基準**:
- `echo $GITHUB_MCP_PAT` でトークンが表示される
- トークンが `.bashrc` または `.zshrc` に永続化されている

### Phase 5: MCP サーバー追加(運用手順)
**目的**: VS Codeの既存MCP設定をClaude Code CLIに統合する

- [ ] MCP自動追加スクリプト実行
  ```bash
  bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
  ```

- [ ] MCP サーバー一覧確認
  ```bash
  claude mcp list
  ```
  期待される出力: `msdocs`, `context7`, `github-mcp-server` が表示される

- [ ] Claude Code設定ファイル確認
  ```bash
  cat ~/.config/claude-code/settings.json
  ```
  GitHub MCPの認証ヘッダーが含まれていることを確認

**合格基準**:
- `claude mcp list` で3つのMCPサーバーが表示される
- `settings.json` に GitHub認証ヘッダーが含まれている

### Phase 6: 統合動作確認(運用手順)
**目的**: Claude CodeとMCPサーバーの統合が正しく動作することを確認する

**CLI動作確認**:
- [ ] Claude Code起動
  ```bash
  claude
  ```

- [ ] MCP ツール確認
  ```
  /mcp
  ```
  期待される出力: 利用可能なMCPツール一覧

- [ ] GitHub MCP テスト
  ```
  /mcp github-mcp-server list_issues owner:masami-ryu repo:ai-work-container
  ```

- [ ] Microsoft Learn MCP テスト
  ```
  /mcp msdocs search query:"Azure Functions"
  ```

**VS Code拡張機能確認**:
- [ ] Claude Code パネルが表示される
- [ ] ファイルのドラッグ&ドロップが動作する
- [ ] MCPツールが拡張機能から呼び出せる(試験的にクエリを送信)

**合格基準**:
- CLIで `/mcp` コマンドが3つのサーバーを表示する
- GitHub MCPでissue一覧が取得できる
- VS Code拡張機能でClaude Codeパネルが正常に動作する
- 拡張機能からMCPツールの呼び出しテストが成功する

## セクション3: ドキュメント整備

このセクションでは、保守性向上とナレッジ共有のためのドキュメント作成を行います。

### Phase 7: ドキュメント作成(ドキュメント整備)
**目的**: チームメンバーがClaude Codeを活用できるようドキュメントを整備する

- [ ] 使用方法ドキュメント作成: `docs/claude-code-usage.md`
  - 基本的な使い方
  - VS Code拡張機能の活用方法
  - CLIとの使い分け
  - MCPツールの実践例

- [ ] トラブルシューティング拡充: `docs/claude-code-mcp-setup.md`
  - よくある問題と解決方法
  - エラーメッセージ対処法
  - ログファイルの確認方法

- [ ] `claude mcp` コマンドリファレンス作成
  - 各コマンドの詳細説明
  - 実用例
  - オプション一覧

- [ ] README.md に Claude Code セクション追加
  - プロジェクトでのClaude Code活用方法
  - セットアップ手順へのリンク
  - 推奨設定レベルの説明

**合格基準**:
- ドキュメントを見れば、新規メンバーが独力でセットアップできる
- トラブルシューティングで一般的な問題が網羅されている
- コマンドリファレンスが実践的な例を含んでいる

## 検証項目(統合テスト)

このセクションでは、全Phase完了後に実施する統合テストの項目を定義します。

### CLI 動作確認
```bash
# バージョン確認
claude --version

# ヘルプ表示
claude --help

# MCP サーバー一覧確認
claude mcp list

# Claude Code 起動
claude
```

**期待される結果**:
- バージョン情報が表示される
- ヘルプに主要コマンドが列挙される
- `msdocs`, `context7`, `github-mcp-server` の3サーバーが表示される

### VS Code 拡張機能確認
- [ ] 拡張機能がインストールされている
- [ ] Claude Code パネルが表示される
- [ ] ファイルのドラッグ&ドロップが動作する
- [ ] **新規追加**: Claude Codeパネルから簡単なプロンプトを送信し、応答を確認
- [ ] **新規追加**: Claude Codeパネルの設定メニューからMCP設定が確認できる

### MCP 統合確認
- [ ] `claude mcp list` でMCPサーバーが表示される
- [ ] Claude Code 起動時に `/mcp` コマンドでMCPツールが確認できる
- [ ] **新規追加**: 各MCPサーバーの実利用テスト:
  - `msdocs`: Microsoft Learnドキュメント検索が動作する
  - `context7`: コード例検索が結果を返す
  - `github-mcp-server`: Issue一覧取得が成功する(認証必須)
- [ ] **新規追加**: VS Code拡張機能からMCPツールを呼び出し、応答を確認する

### 冪等性確認(再ビルドテスト)
- [ ] コンテナを再ビルドし、Claude Code CLIが再インストールされないことを確認
- [ ] ログファイルが肥大化していないことを確認(`ls -lh ~/.cache/claude-install-logs/`)
- [ ] 既存のMCP設定が保持されていることを確認(`claude mcp list`)

**期待される結果**:
- 再ビルド時に "既にインストールされています" メッセージが表示される
- ログファイルが日付別に保存され、7日以上前のファイルが削除されている

## 追加推奨事項

### セキュリティ設定
- APIキーは環境変数で管理(`.env`ファイルは`.gitignore`に追加済みか確認)
- `permissions.deniedTools` で機密ファイルへのアクセスを制限

### パフォーマンス最適化
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` で不要な通信を削減(本番環境)
- `spinnerTipsEnabled: false` でターミナル出力を簡素化(オプション)

### 開発効率向上
- プロジェクト固有の `CLAUDE.md` ファイル作成
- カスタムプロンプトやスキルの追加

## 参考資料
- [Claude Code 公式ドキュメント](https://docs.anthropic.com/claude-code)
- [MCP (Model Context Protocol) 仕様](https://modelcontextprotocol.io/)
- [VS Code Dev Container ドキュメント](https://code.visualstudio.com/docs/devcontainers/containers)
