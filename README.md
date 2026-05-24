# ai-work-container
AIエージェント作業コンテナ

## 概要
このプロジェクトは、AI支援開発のためのdevcontainer環境です。Node.js（nodenv経由）とClaude Codeが統合されており、MCP (Model Context Protocol)を通じて複数の外部サービスと連携します。

## 主要機能

### 開発環境
- **Node.js管理**: nodenv経由でプロジェクトごとのNode.jsバージョン管理
- **VS Code Dev Container**: 一貫性のある開発環境
- **Git統合**: GitLens、GitHub Pull Request、GitHub Actions拡張機能

### AI支援ツール
- **Claude Code CLI**: ターミナルからAnthropicのClaude AIを利用
- **Claude Code VS Code拡張**: IDE内でのAI支援コーディング
- **MCP統合**: 複数の外部サービスとの接続
  - Microsoft Learn (msdocs): 公式ドキュメント検索
  - Context7: コード例・スニペット検索
  - GitHub MCP Server: リポジトリ情報へのアクセス

## セットアップ

### 前提条件
- Docker Desktop
- Visual Studio Code
- Dev Containers拡張機能

### 起動手順

1. リポジトリをクローン:
```bash
git clone https://github.com/masami-ryu/ai-work-container.git
cd ai-work-container
```

2. VS Codeでフォルダを開く:
```bash
code .
```

3. Dev Containerで再起動:
- コマンドパレット（Ctrl+Shift+P / Cmd+Shift+P）を開く
- "Dev Containers: Reopen in Container" を選択
- コンテナのビルドと起動を待つ

4. Claude Codeの認証（初回のみ）:
```bash
claude whoami
```
ブラウザが開き、Anthropicアカウントでログインします。

### GitHub MCP設定（オプション）

GitHub関連の機能を使用する場合は、Personal Access Tokenが必要です。

1. [GitHub PAT取得](https://github.com/settings/tokens)（スコープ: `repo:status`, `public_repo`, `read:org`, `read:user`）
2. 環境変数に設定:
```bash
echo 'export GITHUB_MCP_PAT=ghp_your_token_here' >> ~/.bashrc
source ~/.bashrc
```
3. MCPサーバーを再設定:
```bash
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
```

## 使い方

### Claude Code CLI

```bash
# 対話型セッション
claude

# ワンショット質問
claude -p "このコードを説明してください" < src/app.js

# MCP機能の使用
claude
> /mcp
# 利用可能なMCPツールから選択
```

### VS Code拡張機能

1. サイドバーのClaude Codeアイコンをクリック
2. ファイルをドラッグ&ドロップしてコンテキストに追加
3. チャットで質問や編集依頼を入力

詳しくは [Claude Code使用方法ガイド](./docs/claude-code-usage.md) を参照してください。

### Playwright recorder

Windows 側に Node.js を入れずに Playwright の `codegen` を使いたい場合は、録画専用 sidecar コンテナを使います。Dev Container を再ビルドすると `playwright-recorder` サービスも起動し、`6080` 番ポートで noVNC を公開します。

1. Dev Container を再ビルドする
2. VS Code の Ports かブラウザで `http://localhost:6080` を開く
3. noVNC デスクトップで自動起動した `xterm` から録画コマンドを実行する

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder

# 初回ログイン用。認証状態を .auth/user.json に保存
pnpm codegen:auth https://example.com/login

# 認証済み状態で業務操作だけ録画
pnpm codegen:shift https://example.com/shifts
```

AI からブラウザを操作する場合は Playwright CLI を使います。`snapshot` で element ref を取得し、`click` / `fill` などの短いコマンドで操作します。

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder
pnpm cli:open https://example.com
pnpm cli:snapshot
pnpm cli -- click e1
pnpm cli:close
```

ユーザーが noVNC で操作したブラウザを AI が続きから操作する場合は、共有操作用の persistent profile を使います。

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder
pnpm shared:open https://example.com

# ユーザーが noVNC で操作した後、AI が現在状態を取得して続きから操作
pnpm shared:snapshot
pnpm cli -- click e1
pnpm shared:close
```

AI からの続き操作は noVNC へのキー入力ではなく、sidecar の command server を使います。
command server は Docker ネットワーク内の `http://playwright-recorder:6090` から利用します。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"snapshot","args":["--filename=snapshots/current.md"]}'
```

`@playwright/cli` は alpha 系の Playwright 依存を含むため、現時点では共有ブラウザ操作のための実験的な補助として扱います。

認証状態ファイル `tools/playwright-recorder/.auth/user.json` は `.gitignore` 済みです。録画後は生成コードを `tools/playwright-recorder/tests/` などに整理して保管してください。

## ドキュメント

- [Claude Code 使用方法ガイド](./docs/claude-code-usage.md) - 基本的な使い方とMCP活用方法
- [セットアップガイド](./docs/claude-code-mcp-setup.md) - 詳細なセットアップ手順とトラブルシューティング

## トラブルシューティング

### Claude CLIが見つからない

Claude Code CLIはnpmパッケージとしてインストールされています。

#### 原因1: nodenv rehashが必要

**最も一般的な原因**: `npm install -g` でグローバルパッケージをインストールした後、nodenvのshimを更新していない。

```bash
# nodenv rehash を実行
nodenv rehash

# 確認
claude --version
```

**重要**: `npm install -g`、`npm uninstall -g`、`npm update -g` などのグローバルパッケージ操作の後は、必ず `nodenv rehash` を実行してください。

#### 原因2: PATHが正しく設定されていない

```bash
# npm global bin ディレクトリをPATHに追加
NPM_BIN_DIR=$(npm bin -g 2>/dev/null || echo "$HOME/.npm-global/bin")
export PATH="$NPM_BIN_DIR:$PATH"
source ~/.bashrc

# インストール状況を確認
npm list -g @anthropic-ai/claude-code
```

### Node.jsのバージョンが古い

Claude Code CLI には Node.js 18+ が必要です。

```bash
# 現在のバージョンを確認
node -v

# Node.js 18+ をインストール（必要に応じて）
nodenv install 18.20.1
nodenv global 18.20.1
nodenv rehash
```

### npmのキャッシュをクリア

インストールに失敗する場合は、npmのキャッシュをクリアしてください。

```bash
npm cache clean --force
npm install -g @anthropic-ai/claude-code
```

### MCPサーバーの確認
```bash
claude mcp list
```

詳細は [トラブルシューティングガイド](./docs/claude-code-mcp-setup.md#トラブルシューティング) を参照してください。

## ライセンス

このプロジェクトは個人使用を目的としています。
