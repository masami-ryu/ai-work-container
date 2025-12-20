---
name: review
description: PRをレビューする（PR番号またはURLを指定）
allowed-tools: Read, Grep, Glob, Write, Bash
argument-hint: PR番号またはURL（例: "#123" または "https://github.com/owner/repo/pull/123"）
---

## タスク

`pr-reviewing` skillを使用してPRレビューを実施します。

詳細は `.claude/skills/pr-reviewing/SKILL.md` を参照してください。

### 基本ワークフロー

1. PR情報取得（`gh pr view`, `gh pr diff`）
2. 5段階レビュープロセス実行
   - Phase 1: 初期分析
   - Phase 2: 詳細分析
   - Phase 3: ベストプラクティス参照
   - Phase 4: 統合評価
   - Phase 5: 品質検証
3. レビュー結果を `ai/reviews/` に保存

### 参照

- プロジェクト: @CLAUDE.md
- エージェント: @.claude/agents/pr-reviewer.md
- **詳細手順**: @.claude/skills/pr-reviewing/SKILL.md
