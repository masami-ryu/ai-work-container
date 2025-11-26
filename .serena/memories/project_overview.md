# ai-work-container プロジェクト概要

## プロジェクト目的

AIエージェント作業用のdevcontainer環境。以下を統合したワークスペース：
- **Node.js管理**: nodenv経由でバージョン管理
- **Claude Code**: AnthropicのAI支援開発ツール（CLI + VS Code拡張）
- **MCP (Model Context Protocol)**: 複数の外部サービスと連携

## 技術スタック

### 主要コンポーネント
- **言語**: bash（スクリプト）、設定ファイル
- **開発環境**: VS Code Dev Containers (Docker)
- **ベースOS**: Ubuntu 24.04.3 LTS
- **パッケージマネージャー**: npm (Node.js経由), uv (Python)

### 統合サービス（MCP）
1. **Microsoft Learn (msdocs)**: 公式ドキュメント検索
2. **Context7**: コード例・スニペット検索
3. **GitHub MCP Server**: リポジトリ情報アクセス
4. **Serena MCP**: セマンティックコード解析（最近導入予定）

### インストール済みツール
- Claude Code CLI（`.devcontainer/post-create.sh`で自動インストール）
- 各種開発ツール（curl, wget, git, build-essential, libssl-dev, ca-certificates）

## ディレクトリ構造

```
ai-work-container/
├── .devcontainer/          # Dev Container設定
│   ├── Dockerfile
│   ├── devcontainer.json
│   ├── post-create.sh      # 起動後スクリプト（Claude Code/uv インストール）
│   └── setup-claude-mcp.sh # MCP サーバー設定スクリプト
├── .github/                # GitHub設定
│   └── copilot-instructions.md  # Copilot指示
├── .vscode/
│   ├── settings.json
│   ├── extensions.json
│   └── mcp.json            # MCP サーバー設定
├── .serena/
│   └── project.yml         # Serena プロジェクト設定
├── ai/                     # AI関連情報
│   ├── issues/             # 課題・問題
│   │   └── 251126_serena導入.md
│   ├── plans/              # 実装プラン
│   │   ├── 251124_claudecode導入プラン_v2.md
│   │   ├── 251125_mcpscript_error解決プラン.md
│   │   ├── 251125_mcpscript改善プラン.md
│   │   └── 251126_serena導入プラン.md
│   └── reviews/            # コードレビュー
├── docs/                   # ドキュメント
│   ├── claude-code-mcp-setup.md
│   ├── claude-code-usage.md
│   ├── devcontainer-git-loading-issue.md
│   └── github-mcp.md
├── node_modules/           # npm パッケージ
├── .node-version           # Node.js バージョン指定
├── .gitignore
├── CODEOWNERS
└── README.md
```

## 現在の状況

### 導入済み機能
- Claude Code CLI（uvから実行）
- DevContainer環境（Docker）
- GitHub MCP の設定
- Microsoft Docs MCP の設定

### 導入進行中
- **Serena MCP**: 進行中
  - uv インストール処理を `.devcontainer/post-create.sh` に追加する予定
  - `.vscode/mcp.json` には既に Serena サーバー設定が存在
  - ブランチ: `feature/install-serena`

### 関連ドキュメント
- `ai/plans/251126_serena導入プラン.md`: Serena MCP 導入の詳細プラン
- `ai/issues/251126_serena導入.md`: 実装タスク
- `docs/claude-code-usage.md`: Claude Code の基本的な使い方
- `docs/claude-code-mcp-setup.md`: セットアップとトラブルシューティング

## 重要なコマンド

### Claude Code
- `claude` - 対話型セッション開始
- `claude -p "質問"` - ワンショット質問
- `claude mcp list` - 利用可能な MCP サーバー一覧表示

### uv（Python パッケージマネージャー）
- `uv --version` - バージョン確認
- `uvx --from git+https://github.com/oraios/serena serena --help` - Serena サーバー実行

### DevContainer
- VS Code コマンドパレット > "Dev Containers: Reopen in Container" - コンテナ再起動
- VS Code コマンドパレット > "Dev Containers: Rebuild Container" - コンテナ再ビルド

## 言語・エンコーディング

- **主要言語**: bash
- **設定ファイル言語**: YAML, JSON, Markdown
- **ファイルエンコーディング**: UTF-8
