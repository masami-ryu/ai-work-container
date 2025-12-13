# プロジェクト: ai-work-container

## 概要
AI開発作業用のDevContainer環境。Claude CodeとMCPを活用した効率的な開発ワークフローを提供。

## 技術スタック
- 言語: Markdown, Shell, JSON
- ツール: Claude Code, VS Code, MCP (context7, msdocs, github-mcp-server, serena)
- 環境: DevContainer (Ubuntu 24.04)

## ディレクトリ構造
- `ai/plans/` - 実行プラン
- `ai/templates/` - テンプレート（プロジェクト用devcontainer.json、CLAUDE.md等）
- `docs/` - ドキュメント
- `.claude/` - Claude Code設定（共通設定、子プロジェクトからシンボリックリンク）
- `.github/` - GitHub設定（共通設定、子プロジェクトからシンボリックリンク）
- `.vscode/mcp.json` - MCP設定
- `repo/` - マルチプロジェクト格納ディレクトリ
  - `project-a/` - 子プロジェクト（別ウィンドウで開ける）
  - `project-b/` - 子プロジェクト（別ウィンドウで開ける）

## 頻繁に使用するコマンド
```bash
# MCPサーバー確認
claude mcp list

# セッション開始
claude

# ワンショット実行
claude -p "質問内容"

# メモリ確認
/memory
```

## コーディング規約
- Markdownはプレビュー可能な形式で
- 日本語で記述
- ファイル命名: `YYMMDD_[概要].md`

## パーミッション
- 開発コマンド（yarn run, node, python）は確認なしで実行可能
- パッケージインストール（yarn install, pip install）は確認が必要
- 危険な操作（rm -rf, chmod 777）は禁止

## IMPORTANT
- プランは必ず `ai/plans/` に保存
- レビュー結果は `ai/reviews/` に保存
- MCPツールを活用してベストプラクティスを参照すること
- 設定変更前に必ずバックアップを作成

## マルチプロジェクト環境

このプロジェクトは**単一コンテナ・マルチプロジェクト環境**をサポートしています。

### 新規プロジェクトの追加
```bash
# 空のプロジェクトを作成
.devcontainer/init-project.sh my-new-project

# Git リポジトリをクローン
.devcontainer/init-project.sh my-new-project https://github.com/user/repo.git
```

**重要**: プロジェクト追加後は、コンテナを再ビルドしてください：
```
VS Code: Ctrl+Shift+P → 'Dev Containers: Rebuild Container'
```

### 子プロジェクトを別ウィンドウで開く
```
1. F1 → 'Dev Containers: Open Folder in Container...'
2. /workspaces/ai-work-container/repo/my-project を選択
3. 既存コンテナにattachして新しいウィンドウが開く
```

### 共通設定の利用
- **Claude Code認証**: コンテナ内で初回のみ認証（`claude login`）、同一コンテナ内の全プロジェクトで共有
- **MCP設定**: `~/.claude.json` で全プロジェクト共有（コンテナ内ファイル）
- **GitHub設定**: `.github/` へのシンボリックリンクで継承
- **Claude設定**: `.claude/` へのシンボリックリンクで継承

**注意**: コンテナ再作成時にはClaude Code CLIの再認証が必要です。

詳細は @docs/multi-project-setup.md を参照。

## 重要なドキュメント
- @docs/claude-code-usage.md
- @docs/claude-code-mcp-setup.md
- @docs/multi-project-setup.md
- @ai/templates/plan-template.md
- @.github/copilot-instructions.md

## トラブルシューティング
MCPやCLI関連の問題は @docs/claude-code-mcp-setup.md#トラブルシューティング を参照。
マルチプロジェクト環境の問題は @docs/multi-project-setup.md#トラブルシューティング を参照。