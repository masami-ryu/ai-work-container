---
name: review
description: PRをレビューする（PR番号またはURLを指定）
allowed-tools: Read, Grep, Glob, Write, Bash, mcp__context7, mcp__msdocs, mcp__github-mcp-server, mcp__serena
model: sonnet
argument-hint: PR番号またはURL（例: "#123" または "https://github.com/owner/repo/pull/123"）
---

## コンテキスト
- プロジェクト: @CLAUDE.md
- エージェント定義: @.claude/agents/pr-reviewer.md
- 出力先: ai/reviews/

## タスク
以下のステップでPRレビューを実施:

### 1. PR情報取得
引数から PR番号/URLを抽出し、GitHub MCP で PR 情報を取得します。

**PR番号の抽出ロジック**:
- `#123` 形式の場合: 123を抽出
- `https://github.com/owner/repo/pull/123` 形式の場合: owner, repo, 123を抽出
- 数字のみの場合: そのまま使用

**GitHub MCP呼び出し**:
```
mcp__github-mcp-server__pull_request_read
  method: "get"
  owner: [抽出したowner]
  repo: [抽出したrepo]
  pullNumber: [抽出したPR番号]
```

### 2. 段階的レビュー
pr-reviewer エージェントの段階的レビュープロセスを実行
