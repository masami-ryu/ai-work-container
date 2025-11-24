---
description: '汎用エージェント'
model: 'Claude Sonnet 4.5'
tools: ['runCommands', 'runTasks', 'edit', 'runNotebooks', 'search', 'new', 'context7/*', 'msdocs/*', 'usages', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'todos', 'runSubagent', 'github-mcp-server/add_comment_to_pending_review', 'github-mcp-server/get_commit', 'github-mcp-server/get_file_contents', 'github-mcp-server/get_label', 'github-mcp-server/get_latest_release', 'github-mcp-server/get_release_by_tag', 'github-mcp-server/get_tag', 'github-mcp-server/list_branches', 'github-mcp-server/list_commits', 'github-mcp-server/list_pull_requests', 'github-mcp-server/list_releases', 'github-mcp-server/list_tags', 'github-mcp-server/pull_request_read', 'github-mcp-server/pull_request_review_write', 'github-mcp-server/search_code', 'github-mcp-server/search_pull_requests', 'github-mcp-server/search_repositories', 'github-mcp-server/update_pull_request']
---
# Common Agent

## 概要
このエージェントは、さまざまなタスクを遂行するための汎用エージェントです。
複数のツールを組み合わせて使用し、柔軟に対応します。