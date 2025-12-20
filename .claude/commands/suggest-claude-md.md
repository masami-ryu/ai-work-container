---
name: suggest-claude-md
description: CLAUDE.mdの更新提案を生成する
allowed-tools: Read, Grep
---

## タスク

`claude-md-suggesting` skillを使用してCLAUDE.mdの更新提案を生成します。

詳細は `.claude/skills/claude-md-suggesting/SKILL.md` を参照してください。

### 基本ワークフロー

1. 現在のCLAUDE.mdを読み込む
2. セッションコンテキストを分析
3. 更新提案を生成（追加/修正/削除すべき項目）

### 参照

- 現在のメモリ: @CLAUDE.md
- **詳細手順**: @.claude/skills/claude-md-suggesting/SKILL.md
