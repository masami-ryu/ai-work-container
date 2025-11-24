## ✅ GitHub MCP ツール一覧（全39件）

| ツール名 | 説明 |
| --- | --- |
| add_comment_to_pending_review | 保留中の Pull Request レビューにコメントを追加します（既に保留レビューが存在する必要あり）。 |
| add_issue_comment         | 指定した Issue にコメントを追加します。 |
| assign_copilot_to_issue   | Copilot を Issue に割り当てます。 |
| create_branch             | 新しいブランチを作成します。 |
| create_or_update_file     | ファイルを作成または更新します（更新時は SHA 必須）。 |
| create_pull_request       | 新しい Pull Request を作成します。 |
| create_repository         | 新しいリポジトリを作成します。 |
| delete_file               | ファイルを削除します。 |
| fork_repository           | リポジトリをフォークします。 |
| get_commit                | 特定のコミット情報を取得します。 |
| get_file_contents         | ファイルやディレクトリの内容を取得します。 |
| get_label                 | 特定のラベル情報を取得します。 |
| get_latest_release        | 最新のリリース情報を取得します。 |
| get_me                    | 認証済みユーザー情報を取得します。 |
| get_release_by_tag        | タグ名で特定のリリース情報を取得します。 |
| get_tag                   | 特定のタグ情報を取得します。 |
| get_team_members          | チームメンバー一覧を取得します。 |
| get_teams                 | ユーザーが所属するチーム一覧を取得します。 |
| issue_read                | Issue の情報を読み取ります。 |
| issue_write               | Issue を作成または更新します。 |
| list_branches             | リポジトリのブランチ一覧を取得します。 |
| list_commits              | コミット一覧を取得します。 |
| list_issue_types          | リポジトリで利用可能な Issue タイプ一覧を取得します。 |
| list_issues               | Issue 一覧を取得します。 |
| list_pull_requests        | Pull Request 一覧を取得します。 |
| list_releases             | リリース一覧を取得します。 |
| list_tags                 | タグ一覧を取得します。 |
| merge_pull_request        | Pull Request をマージします。 |
| pull_request_read         | Pull Request の情報を読み取ります。 |
| pull_request_review_write | Pull Request のレビューを作成・提出・削除します。 |
| push_files                | 複数のファイルを一度にプッシュします。 |
| request_copilot_review    | GitHub Copilot にコードレビューをリクエストします。 |
| search_code               | コード検索を実行します。 |
| search_issues             | Issue 検索を実行します。 |
| search_pull_requests      | Pull Request 検索を実行します。 |
| search_repositories       | リポジトリ検索を実行します。 |
| search_users              | ユーザー検索を実行します。 |
| sub_issue_write           | サブ Issue を追加・削除・並べ替えます。 |
| update_pull_request       | Pull Request を更新します（タイトル・本文など）。 |
| update_pull_request_branch | Pull Request のブランチを最新の状態に更新します。 |

***

### ✅ カスタムチャットモード設定例（レビュー専用）

### レビュー用

```markdown
tools: ['runCommands', 'runTasks', 'edit', 'runNotebooks', 'search', 'new', 'context7/*', 'msdocs/*', 'usages', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'todos', 'runSubagent', 'github-mcp-server/add_comment_to_pending_review', 'github-mcp-server/get_commit', 'github-mcp-server/get_file_contents', 'github-mcp-server/get_label', 'github-mcp-server/get_latest_release', 'github-mcp-server/get_release_by_tag', 'github-mcp-server/get_tag', 'github-mcp-server/list_branches', 'github-mcp-server/list_commits', 'github-mcp-server/list_pull_requests', 'github-mcp-server/list_releases', 'github-mcp-server/list_tags', 'github-mcp-server/pull_request_read', 'github-mcp-server/pull_request_review_write', 'github-mcp-server/search_code', 'github-mcp-server/search_pull_requests', 'github-mcp-server/search_repositories', 'github-mcp-server/update_pull_request']
```

### 調査用

```markdown
tools: ['github-mcp-server/get_commit','github-mcp-server/get_file_contents','github-mcp-server/get_label','github-mcp-server/get_latest_release','github-mcp-server/get_release_by_tag','github-mcp-server/get_tag','github-mcp-server/issue_read','github-mcp-server/list_branches','github-mcp-server/list_commits','github-mcp-server/list_issue_types','github-mcp-server/list_issues','github-mcp-server/list_pull_requests','github-mcp-server/list_releases','github-mcp-server/list_tags','github-mcp-server/pull_request_read','github-mcp-server/search_code','github-mcp-server/search_issues','github-mcp-server/search_pull_requests','github-mcp-server/search_repositories']
```