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

## パフォーマンス最適化

このプロジェクトは以下の最適化設定を使用：

### 環境変数
- `MAX_THINKING_TOKENS: 16000` - 複雑な問題に対応
- `BASH_DEFAULT_TIMEOUT_MS: 60000` - 長時間実行に対応
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS: 16000` - 長い応答を可能に

### サブエージェント
すべてのエージェント（plan-creator, doc-writer, pr-reviewer）は `model: haiku` を使用してコストとレイテンシを最適化。

### パーミッション
- 開発コマンド（npm run, node, python）は確認なしで実行可能
- パッケージインストール（npm install, pip install）は確認が必要
- 危険な操作（rm -rf, chmod 777）は禁止

詳細は @docs/claude-code-usage.md#パフォーマンス最適化ガイド を参照。

## IMPORTANT
- プランは必ず `ai/plans/` に保存
- レビュー結果は `ai/reviews/` に保存
- MCPツールを活用してベストプラクティスを参照すること
- 設定変更前に必ずバックアップを作成

## 重要なドキュメント
- @docs/claude-code-usage.md
- @docs/claude-code-mcp-setup.md
- @ai/templates/plan-template.md
- @.github/copilot-instructions.md

## トラブルシューティング
MCPやCLI関連の問題は @docs/claude-code-mcp-setup.md#トラブルシューティング を参照。
