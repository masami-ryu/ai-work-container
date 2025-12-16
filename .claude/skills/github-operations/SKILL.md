---
name: github-operations
description: Perform GitHub operations including managing issues, pull requests, commits, branches, and repositories. Use when user mentions GitHub, issues, PRs, pull requests, commits, branches, or repository management.
---

# GitHub Operations

## Quick Start

### Issues
```
# List issues
mcp__github-mcp-server__list_issues
  owner: "owner-name"
  repo: "repo-name"
  state: "OPEN"

# Create issue
mcp__github-mcp-server__issue_write
  method: "create"
  owner: "owner-name"
  repo: "repo-name"
  title: "Issue title"
  body: "Issue description"
```

### Pull Requests
```
# List PRs
mcp__github-mcp-server__list_pull_requests
  owner: "owner-name"
  repo: "repo-name"
  state: "open"

# Create PR
mcp__github-mcp-server__create_pull_request
  owner: "owner-name"
  repo: "repo-name"
  title: "PR title"
  head: "feature-branch"
  base: "main"
  body: "PR description"

# Get PR details
mcp__github-mcp-server__pull_request_read
  method: "get"
  owner: "owner-name"
  repo: "repo-name"
  pullNumber: 123
```

### Branches & Commits
```
# List branches
mcp__github-mcp-server__list_branches
  owner: "owner-name"
  repo: "repo-name"

# List commits
mcp__github-mcp-server__list_commits
  owner: "owner-name"
  repo: "repo-name"
  sha: "branch-name"
```

### Files
```
# Get file contents
mcp__github-mcp-server__get_file_contents
  owner: "owner-name"
  repo: "repo-name"
  path: "path/to/file"

# Create or update file
mcp__github-mcp-server__create_or_update_file
  owner: "owner-name"
  repo: "repo-name"
  path: "path/to/file"
  content: "file content"
  message: "commit message"
  branch: "branch-name"
```

## Common Use Cases

- Managing issues and pull requests
- Reviewing code changes
- Creating and merging branches
- Searching repositories and code
- Managing releases and tags

For complete API reference with all 40+ tools, see [REFERENCE.md](REFERENCE.md).
