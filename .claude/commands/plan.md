---
name: plan
description: 実行可能なプランを作成する（タスク規模に応じてExpress/Standard/Comprehensiveワークフローを選択）
allowed-tools: Read, Grep, Glob, Write, mcp__context7, mcp__msdocs, mcp__serena
model: sonnet
argument-hint: タスクの概要または目的を入力してください（例: 「認証機能の追加」「パフォーマンス最適化」）
---

## コンテキスト
- プロジェクト: @CLAUDE.md
- テンプレート: @ai/templates/plan-template.md
- 既存プラン: @ai/plans/
- エージェント定義: @.claude/agents/plan-creator.md

## タスク
以下のステップでプランを作成してください:

1. **ワークフロー選択**: タスク規模を評価し、適切なワークフローを選択
   - Express: 2ファイル以下の変更、影響範囲が限定的
   - Standard: 3-10ファイルに影響、中程度の複雑さ
   - Comprehensive: アーキテクチャ変更、多数ファイルに影響

2. **目的の明確化**: ユーザーの要求を確認し、達成すべき目標を定義

3. **情報収集**: 必要に応じてコードベース、ドキュメント、外部リソースを調査
   - 対象ファイルの特定（Glob/Grep）
   - 既存パターンの把握
   - 依存関係の理解

4. **MCPツール活用**: 最新情報が必要な場合はMCPツールを使用
   - msdocs: Microsoft/Azure公式ドキュメント
   - context7: コード例・スニペット
   - serena: セマンティックコード分析

5. **プラン策定**: 具体的なステップに分解し、実行可能なプランを作成

6. **品質検証**: 出力前に以下を確認
   - 完全性: すべての要件が反映されているか
   - アクション可能性: 具体的なアクション動詞で始まっているか
   - 測定可能性: 完了条件は客観的に判断可能か

7. **保存**: `ai/plans/YYMMDD_[タスク概要].md` に保存

## 出力形式
- テンプレート: @ai/templates/plan-template.md に準拠
- 日本語で記述
- 具体的なタスクとチェックリストを含める
