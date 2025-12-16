# GitHub Operations - API Reference

## Tool Categories

### Issues Management

#### list_issues
List issues in a repository with filtering and pagination.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `state`: Filter by state (OPEN, CLOSED)
- `labels`: Filter by labels (array)
- `since`: Filter by date (ISO 8601)
- `orderBy`: Sort field (CREATED_AT, UPDATED_AT, COMMENTS)
- `direction`: Sort direction (ASC, DESC)
- `perPage`: Results per page (1-100)
- `after`: Cursor for pagination

#### issue_read
Get issue details, comments, sub-issues, or labels.

**Parameters:**
- `method` (required): Operation type (get, get_comments, get_sub_issues, get_labels)
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `issue_number` (required): Issue number

#### issue_write
Create or update an issue.

**Parameters:**
- `method` (required): Operation type (create, update)
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `title`: Issue title (required for create)
- `body`: Issue body
- `state`: State (open, closed)
- `state_reason`: Reason (completed, not_planned, duplicate)
- `labels`: Labels array
- `assignees`: Assignees array

### Pull Requests

#### list_pull_requests
List pull requests in a repository.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `state`: Filter by state (open, closed, all)
- `head`: Filter by head branch
- `base`: Filter by base branch
- `sort`: Sort by (created, updated, popularity, long-running)
- `direction`: Sort direction (asc, desc)

#### pull_request_read
Get PR details, diff, status, files, comments, or reviews.

**Parameters:**
- `method` (required): Operation type (get, get_diff, get_status, get_files, get_review_comments, get_reviews, get_comments)
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `pullNumber` (required): PR number

#### create_pull_request
Create a new pull request.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `title` (required): PR title
- `head` (required): Source branch
- `base` (required): Target branch
- `body`: PR description
- `draft`: Create as draft (boolean)

#### update_pull_request
Update an existing pull request.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `pullNumber` (required): PR number
- `title`: New title
- `body`: New description
- `state`: State (open, closed)
- `base`: New base branch
- `reviewers`: Reviewers array

#### merge_pull_request
Merge a pull request.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `pullNumber` (required): PR number
- `merge_method`: Method (merge, squash, rebase)
- `commit_title`: Commit title
- `commit_message`: Commit message

### Branches & Commits

#### list_branches
List branches in a repository.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `page`: Page number
- `perPage`: Results per page

#### create_branch
Create a new branch.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `branch` (required): New branch name
- `from_branch`: Source branch (defaults to repo default)

#### list_commits
List commits in a branch.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `sha`: Branch/commit SHA
- `author`: Filter by author
- `page`: Page number
- `perPage`: Results per page

#### get_commit
Get commit details including diff.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `sha` (required): Commit SHA
- `include_diff`: Include file diffs (default: true)

### Files

#### get_file_contents
Get file or directory contents.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `path`: File/directory path (default: "/")
- `ref`: Git ref (branch/tag)
- `sha`: Commit SHA

#### create_or_update_file
Create or update a file.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `path` (required): File path
- `content` (required): File content
- `message` (required): Commit message
- `branch` (required): Branch name
- `sha`: File SHA (required for updates)

#### delete_file
Delete a file.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `path` (required): File path
- `message` (required): Commit message
- `branch` (required): Branch name

#### push_files
Push multiple files in a single commit.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `branch` (required): Branch name
- `files` (required): Array of {path, content}
- `message` (required): Commit message

### Search

#### search_repositories
Search for repositories.

**Parameters:**
- `query` (required): Search query
- `sort`: Sort by (stars, forks, help-wanted-issues, updated)
- `order`: Sort order (asc, desc)

#### search_code
Search for code across all repositories.

**Parameters:**
- `query` (required): Search query
- `sort`: Sort by (indexed)
- `order`: Sort order (asc, desc)

#### search_issues
Search for issues.

**Parameters:**
- `query` (required): Search query
- `owner`: Repository owner (optional)
- `repo`: Repository name (optional)
- `sort`: Sort by (comments, reactions, created, updated)
- `order`: Sort order (asc, desc)

#### search_pull_requests
Search for pull requests.

**Parameters:**
- `query` (required): Search query
- `owner`: Repository owner (optional)
- `repo`: Repository name (optional)
- `sort`: Sort by (comments, reactions, created, updated)
- `order`: Sort order (asc, desc)

### Reviews

#### pull_request_review_write
Create, submit, or delete a PR review.

**Parameters:**
- `method` (required): Operation (create, submit_pending, delete_pending)
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `pullNumber` (required): PR number
- `body`: Review comment
- `event`: Review action (APPROVE, REQUEST_CHANGES, COMMENT)

#### add_comment_to_pending_review
Add a comment to a pending review.

**Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `pullNumber` (required): PR number
- `path` (required): File path
- `body` (required): Comment text
- `line`: Line number
- `side`: Diff side (LEFT, RIGHT)

### Other Operations

#### get_me
Get authenticated user details.

#### fork_repository
Fork a repository to your account or organization.

#### create_repository
Create a new repository.

#### list_releases
List releases in a repository.

#### get_latest_release
Get the latest release.

#### list_tags
List git tags in a repository.

## Usage Tips

1. **Authentication**: GitHub PAT must be set in environment variable `GITHUB_MCP_PAT`
2. **Pagination**: Use `page` and `perPage` parameters for large result sets
3. **Search syntax**: Use GitHub's search syntax for queries (e.g., "is:open label:bug")
4. **Error handling**: Check for rate limits and authentication errors
