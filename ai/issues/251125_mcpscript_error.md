mcp setup スクリプトでエラーが出たので、原因を調査して、解決のためのプランを作成する。

$ bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
==== Claude Code MCP セットアップ開始 ====
既存のMCP設定を読み込み中: /workspaces/ai-work-container/.vscode/mcp.json
GitHub PAT が設定されています。

=== MCP サーバーを Claude Code に追加 ===

[1/3] msdocs サーバーを追加中...
Added HTTP MCP server msdocs with URL: https://learn.microsoft.com/api/mcp to local config
File modified: /home/vscode/.claude.json [project: /workspaces/ai-work-container]
✓ msdocs サーバーを追加しました (URL: https://learn.microsoft.com/api/mcp)

[2/3] context7 サーバーを追加中...
Added stdio MCP server context7 with command: npx -y @upstash/context7-mcp@latest to local config
File modified: /home/vscode/.claude.json [project: /workspaces/ai-work-container]
✓ context7 サーバーを追加しました

[3/3] github-mcp-server を追加中...
error: missing required argument 'name'
✗ github-mcp-server の追加に失敗しました

=== セットアップ完了 ===

MCP サーバー一覧確認:
  claude mcp list

==== Claude Code MCP セットアップ完了 ====