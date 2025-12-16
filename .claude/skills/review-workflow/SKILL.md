---
name: review-workflow
description: Perform comprehensive pull request reviews including code quality, security, and performance analysis. Use when user asks to review a PR, mentions pull request review, code review, or provides PR number/URL.
---

# Review Workflow

## Overview

Conduct thorough pull request reviews focusing on code quality, security, performance, and best practices.

## Quick Start

When user requests a PR review, follow these steps:

1. **Extract PR Information**: Parse PR number or URL
2. **Fetch PR Details**: Get PR info, diff, and files using GitHub MCP
3. **Staged Review**: Perform multi-stage analysis
4. **Generate Report**: Create comprehensive review document
5. **Save Results**: Store in `ai/reviews/`

## PR Number Extraction

### Supported Formats
- `#123`: PR number only (requires known owner/repo)
- `https://github.com/owner/repo/pull/123`: Full URL
- `123`: Numeric PR number

### GitHub MCP Call
```
mcp__github-mcp-server__pull_request_read
  method: "get"
  owner: "extracted-owner"
  repo: "extracted-repo"
  pullNumber: 123
```

## Staged Review Process

### Stage 1: Overview Analysis
- PR title and description
- Changed files summary
- Overall scope and impact

### Stage 2: Code Quality
- Code structure and organization
- Naming conventions
- Code duplication
- Complexity analysis

### Stage 3: Security & Best Practices
- Security vulnerabilities
- Input validation
- Error handling
- Authentication/authorization

### Stage 4: Performance
- Algorithm efficiency
- Resource usage
- Database queries
- Caching opportunities

### Stage 5: Testing & Documentation
- Test coverage
- Test quality
- Documentation updates
- API documentation

## MCP Tools for Review

### Get PR Information
```
# Get PR details
mcp__github-mcp-server__pull_request_read
  method: "get"
  owner: "owner"
  repo: "repo"
  pullNumber: 123

# Get diff
mcp__github-mcp-server__pull_request_read
  method: "get_diff"
  owner: "owner"
  repo: "repo"
  pullNumber: 123

# Get changed files
mcp__github-mcp-server__pull_request_read
  method: "get_files"
  owner: "owner"
  repo: "repo"
  pullNumber: 123
```

### Code Analysis
```
# Analyze symbols
mcp__serena__find_symbol
  name_path_pattern: "ChangedClass"
  include_body: true

# Find references
mcp__serena__find_referencing_symbols
  name_path: "ChangedMethod"
  relative_path: "src/file.ts"
```

### Research Best Practices
```
# Microsoft best practices
mcp__msdocs__microsoft_docs_search
  query: "technology best practices security"

# Code examples
mcp__context7__resolve-library-id
  libraryName: "framework-name"
```

## Review Severity Levels

- **Critical**: Security vulnerabilities, data loss risks
- **Major**: Performance issues, incorrect logic
- **Minor**: Code style, readability improvements
- **Suggestion**: Optimization opportunities, alternative approaches

## Output Format

Save review to `ai/reviews/YYMMDD_PR[number]_review.md`:

```markdown
# PR Review: [PR Title]

## Summary
- PR: #[number]
- Author: [name]
- Files changed: [count]
- Overall assessment: [Approve/Request Changes/Comment]

## Findings

### Critical Issues
- [Issue with line references]

### Major Issues
- [Issue with line references]

### Suggestions
- [Improvement suggestions]

## Recommendations
[Overall recommendations for approval or changes]
```

## Quality Checklist

- [ ] All changed files reviewed
- [ ] Security implications assessed
- [ ] Performance impact evaluated
- [ ] Test coverage verified
- [ ] Documentation checked
- [ ] Line-specific comments provided
- [ ] Overall recommendation clear
