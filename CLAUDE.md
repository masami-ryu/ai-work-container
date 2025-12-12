# プロジェクト: ai-work-container

## 概要
AI開発作業用のDevContainer環境。Claude CodeとMCPを活用した効率的な開発ワークフローを提供。

## 技術スタック
- 言語: Markdown, Shell, JSON
- ツール: Claude Code, VS Code, MCP (context7, msdocs, github-mcp-server, serena)
- 環境: DevContainer (Ubuntu 24.04)

## ディレクトリ構造
- `ai/plans/` - 実行プラン
- `ai/templates/` - テンプレート
- `docs/` - ドキュメント
- `.claude/` - Claude Code設定
- `.vscode/mcp.json` - MCP設定
- `repo/` - マルチルートワークスペース用プロジェクト配置ディレクトリ
- `.node_modules_cache/` - node_modules実体（ボリュームマウント）

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

## マルチルートワークスペース
`repo/` 配下に複数のプロジェクトを配置して、共通設定を継承しながら開発できます。

### プロジェクトの追加
```bash
cd /workspaces/ai-work-container/repo
git clone https://github.com/your-org/your-project.git
cd ..
bash .devcontainer/setup-repo-project.sh your-project
```

### プロジェクトの削除
```bash
bash .devcontainer/remove-repo-project.sh your-project
```

### 設定の継承
- `.claude/` のコマンド・エージェント・hooksは自動的に継承されます
- カスタムコマンド: `/plan`, `/review`, `/doc`, `/suggest-claude-md`
- サブエージェント: `plan-creator`, `doc-writer`, `pr-reviewer`

詳細は @docs/multiroot-workspace-usage.md を参照。

## 重要なドキュメント
- @docs/claude-code-usage.md
- @docs/claude-code-mcp-setup.md
- @docs/multiroot-workspace-usage.md
- @ai/templates/plan-template.md
- @.github/copilot-instructions.md

## トラブルシューティング
MCPやCLI関連の問題は @docs/claude-code-mcp-setup.md#トラブルシューティング を参照。