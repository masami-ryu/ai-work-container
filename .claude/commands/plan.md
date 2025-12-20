---
name: plan
description: 実行可能なプランを作成する（タスク規模に応じてExpress/Standard/Comprehensiveワークフローを選択）
allowed-tools: Read, Grep, Glob, Write
argument-hint: タスクの概要または目的を入力してください（例: 「認証機能の追加」「パフォーマンス最適化」）
---

## タスク

`plan-creating` skillを使用してプランを作成します。

詳細は `.claude/skills/plan-creating/SKILL.md` を参照してください。

### 基本ワークフロー

1. タスク規模に応じてワークフローを選択（Express/Standard/Comprehensive）
2. プラン作成プロセスを実行
3. `ai/plans/YYMMDD_[概要].md` に保存

### 参照

- プロジェクト: @CLAUDE.md
- テンプレート: @ai/templates/plan-template.md
- 既存プラン: @ai/plans/
- エージェント: @.claude/agents/plan-creator.md
- **詳細手順**: @.claude/skills/plan-creating/SKILL.md
