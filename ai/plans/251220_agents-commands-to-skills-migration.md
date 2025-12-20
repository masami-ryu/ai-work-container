# Agents/Commands → Skills 移行プラン

作成日: 2025年12月20日
作成者: Plan Creator エージェント
ステータス: Review → Updated
最終更新: 2025年12月20日（レビュー反映）

## 1. 概要

### 目的
`.claude/agents` と `.claude/commands` のトークン消費を削減するため、機能を `.claude/skills` に移行し、最適な構造を構築する。

### スコープ
- **対象**:
  - `.claude/commands/` 配下の全ファイル（4ファイル）
  - `.claude/agents/` 配下の全ファイル（3ファイル）
- **対象外**:
  - `.claude/hooks/`（PreCompact.md、SessionEnd.md）
  - `.claude/skills/` の既存ファイル（gh-pr-viewing、gh-issue-managing）

### 前提条件
- 既存のagents/commandsの動作を理解している
- skillsの構造を把握している（既存の2つのskillから学習）
- トークン消費の仕組みを理解している（agents/commandsは常時ロード、skillsは必要時のみロード）

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | トークン消費を最低60%削減（ストレッチ目標80%） | 高 |
| REQ-002 | 要件 | 既存機能をすべて維持する | 高 |
| REQ-003 | 要件 | Skillsディレクトリ構造を統一する（`[skill-name]/SKILL.md`） | 中 |
| REQ-004 | 要件 | ユーザーエクスペリエンスを維持する（commandsは薄いラッパー化） | 高 |
| REQ-005 | 要件 | MCPツール参照を完全削除する | 中 |
| CON-001 | 制約 | agentsの基本方針は残す（完全削除しない） | - |
| CON-002 | 制約 | 移行中も既存機能が動作すること | - |
| CON-003 | 制約 | commandsは削除せず薄いラッパーとして残す | - |
| GUD-001 | ガイドライン | 既存の2つのskillsの形式に準拠する | - |
| GUD-002 | ガイドライン | トークン削減は `wc -l .claude/agents/*.md .claude/commands/*.md` で計測 | - |

## 3. 実装ステップ

### Phase 0: 現行仕様の棚卸し
**目標**: commands/agentsの現行仕様を正確に把握し、移行要件を明確化する

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | commands配下の全ファイルの入出力仕様を整理 | `.claude/commands/*.md` | 各commandの期待入力・出力・保存先が一覧化されている | [ ] |
| TASK-002 | agents配下の全ファイルの責任範囲を整理 | `.claude/agents/*.md` | 各agentの「残す方針」と「skillsへ移す詳細」が分類されている | [ ] |
| TASK-003 | MCPツール使用箇所をリストアップ | `.claude/agents/*.md` | mcp__*の使用箇所が特定され、削除方針が確定している | [ ] |
| TASK-004 | 移行前のトークン消費量を計測 | - | `wc -l .claude/agents/*.md .claude/commands/*.md` の結果を記録 | [ ] |

### Phase 1: Commands → Skills 移行 + Commands 薄いラッパー化
**目標**: commandsの詳細ロジックをskillsに移し、commandsは最小限のエントリポイントとして残す

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-101 | suggest-claude-md skillを作成（MCPツール参照削除） | `.claude/skills/claude-md-suggesting/SKILL.md` | ファイルが作成され、基本構造が含まれ、MCPツール参照がない | [ ] |
| TASK-102 | pr-reviewing skillを作成（MCPツール参照削除） | `.claude/skills/pr-reviewing/SKILL.md` | ファイルが作成され、PR番号/URL解析ロジックが含まれ、MCPツール参照がない | [ ] |
| TASK-103 | plan-creating skillを作成 | `.claude/skills/plan-creating/SKILL.md` | ファイルが作成され、ワークフロー選択ロジックが含まれる | [ ] |
| TASK-104 | doc-writing skillを作成 | `.claude/skills/doc-writing/SKILL.md` | ファイルが作成され、ドキュメント作成ワークフローが含まれる | [ ] |
| TASK-105 | commandsを薄いラッパー化（10-30行以内） | `.claude/commands/*.md` | 各commandが10-30行以内になり、詳細ロジックはskillsへの参照のみ | [ ] |

### Phase 2: Agents 簡略化 + MCPツール削除
**目標**: agentsから詳細手順とMCPツール参照を削除し、基本方針のみ残す（詳細はskillsに移行済み）

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-201 | pr-reviewer agentを簡略化（MCPツール削除） | `.claude/agents/pr-reviewer.md` | 行数を50-100行以内に削減、基本方針とskillへの参照のみ、mcp__*参照が削除されている | [ ] |
| TASK-202 | plan-creator agentを簡略化（MCPツール削除） | `.claude/agents/plan-creator.md` | 行数を50-100行以内に削減、基本方針とskillへの参照のみ、mcp__*参照が削除されている | [ ] |
| TASK-203 | doc-writer agentを簡略化（MCPツール削除） | `.claude/agents/doc-writer.md` | 行数を30-50行以内に削減、基本方針とskillへの参照のみ、mcp__*参照が削除されている | [ ] |

### Phase 3: 検証とドキュメント更新
**目標**: 移行後の動作を検証し、ドキュメントを更新する

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-301 | 各skillの動作確認 | 新規作成した4つのskills | すべてのskillsが期待通り動作する | [ ] |
| TASK-302 | トークン消費量の測定（`wc -l .claude/agents/*.md .claude/commands/*.md`） | - | 移行前後のトークン消費量を比較し、最低60%削減（目標80%）を確認 | [ ] |
| TASK-303 | CLAUDE.mdを更新 | `/workspaces/ai-work-container/CLAUDE.md` | 新しいskills構造を反映 | [ ] |
| TASK-304 | 移行完了ドキュメントを作成 | `/workspaces/ai-work-container/ai/reviews/251220_migration-report.md` | 移行結果、トークン削減量、今後の推奨事項を記載 | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 機能 | claude-md-suggesting skillを実行 | CLAUDE.md更新提案が生成される |
| TEST-002 | 機能 | pr-reviewing skillを実行（PR番号指定） | PRレビューが段階的に実行される |
| TEST-003 | 機能 | plan-creating skillを実行（Expressワークフロー） | プランが`ai/plans/`に保存される |
| TEST-004 | 機能 | doc-writing skillを実行 | ドキュメントが作成される |
| TEST-005 | 性能 | トークン消費量を測定 | 移行前から60%以上削減されている |
| TEST-006 | 統合 | 簡略化されたagentsからskillsへの参照 | agentsがskillsを正しく呼び出せる |

## 5. 成功基準

- [ ] 4つの新しいskillsが作成され、すべて正常に動作する（MCPツール参照なし）
- [ ] トークン消費量が最低60%削減される（`wc -l`で測定、ストレッチ目標80%）
- [ ] 既存の機能がすべて維持される（レビュー、プラン作成、ドキュメント作成、CLAUDE.md提案）
- [ ] agentsが100行以内に簡略化される（MCPツール参照が完全削除されている）
- [ ] commandsが薄いラッパー化される（10-30行以内、詳細ロジックはskillsへ委譲）
- [ ] ユーザーエクスペリエンスが維持される（同じコマンドで同じ結果が得られる）
- [ ] ドキュメントが最新の構造を反映している

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | skillsが正しく呼び出されない | 高 | 中 | 段階的に移行し、各Phase完了後に動作確認を実施 |
| RISK-002 | トークン削減効果が期待より小さい | 中 | 低 | agentsをさらに簡略化、または完全削除を検討 |
| RISK-003 | 既存機能の一部が失われる | 高 | 低 | Phase 0で現行仕様を完全に棚卸しし、チェックリストで確認 |
| RISK-004 | MCPツール削除により機能が不足する | 中 | 低 | 代替手段（標準ツール）で同等機能を実現、Phase 0で影響を確認 |
| RISK-005 | commandsの薄いラッパー化でUXが変わる | 中 | 中 | commandsのエントリポイントは維持、内部動作のみ変更 |
| RISK-006 | 現行仕様が不完全で移行時に欠落が発覚 | 高 | 中 | Phase 0で徹底的に棚卸し、不明点は実際に動作確認 |

## 7. 依存関係

- `.claude/skills/gh-pr-viewing/SKILL.md`（参考として既存skillsの構造を参照）
- `.claude/skills/gh-issue-managing/SKILL.md`（参考として既存skillsの構造を参照）
- `ai/templates/plan-template.md`（plan-creating skillで使用）

## 8. 次のアクション

1. [ ] **Phase 0-1**: commands配下の入出力仕様を整理（TASK-001）
2. [ ] **Phase 0-2**: agents配下の責任範囲を整理（TASK-002）
3. [ ] **Phase 0-3**: MCPツール使用箇所をリストアップ（TASK-003）
4. [ ] **Phase 0-4**: 移行前のトークン消費量を計測（TASK-004）
5. [ ] **Phase 0完了確認**: 現行仕様の棚卸しが完了し、移行要件が明確
6. [ ] **Phase 1開始**: skillsの作成とcommandsの薄いラッパー化に着手

## 9. 詳細設計

### 9.1 Skills構造設計

各skillは以下の構造に準拠:

```markdown
---
name: [skill-name]
description: [1行の説明]
allowed-tools: [tool1, tool2, ...]
---

# [Skill Title]

## 概要
[簡潔な説明]

## 主要機能
- 機能1
- 機能2

## 使用方法
[具体的な使用方法]

## Examples
[実例]

## Guidelines
[ガイドライン]

## Limitations
[制限事項]

## Version History
- **1.0.0** (YYYY-MM-DD): 初版リリース
```

### 9.2 Agents簡略化方針

各agentは以下のセクションのみ保持:
- **役割**: エージェントの基本的な役割（1-2文）
- **専門領域**: 簡潔なリスト
- **ワークフロー**: 基本ステップのみ（詳細はskillに委譲）
- **Skillsへの参照**: 関連するskillsへのリンク

削除するセクション:
- 詳細な手順（skillsに移行）
- 長いコード例（skillsに移行）
- **MCPツールの参照（完全削除）**
- 長いチェックリスト（skillsに移行）

### 9.2.5 Commands 薄いラッパー化方針

各commandは以下の構造に変更:
- **概要**: コマンドの目的（1-2文）
- **使用方法**: 基本的な使用例
- **詳細**: 関連するskillへの参照のみ
- **行数制限**: 10-30行以内

### 9.3 トークン削減見込み

| ファイル | 移行前行数 | 移行後行数 | 削減率 |
|---------|----------|----------|--------|
| agents/pr-reviewer.md | 579 | 80 | 86% |
| agents/plan-creator.md | 177 | 70 | 60% |
| agents/doc-writer.md | 51 | 40 | 22% |
| commands/*.md（4ファイル） | 174 | 80（各20行×4） | 54% |
| **合計** | **981** | **270** | **72%** |

**期待効果**: トークン消費を約72%削減（常時ロードされる内容が981行→270行）

**計測方法**:
```bash
# 移行前
wc -l .claude/agents/*.md .claude/commands/*.md

# 移行後（同じコマンド）
wc -l .claude/agents/*.md .claude/commands/*.md
```

**目標達成判定**:
- 最低目標60%削減 → **達成見込み（72%）**
- ストレッチ目標80%削減 → 未達（さらにagentsを簡略化すれば可能）

## 10. 移行後の構造

```
.claude/
├── agents/
│   ├── pr-reviewer.md          # 簡略化（80行程度、MCPツール削除）
│   ├── plan-creator.md         # 簡略化（70行程度、MCPツール削除）
│   └── doc-writer.md           # 簡略化（40行程度、MCPツール削除）
├── commands/                   # 薄いラッパー化（各20行程度）
│   ├── plan.md                 # 薄いラッパー（plan-creating skillへ参照）
│   ├── doc.md                  # 薄いラッパー（doc-writing skillへ参照）
│   ├── review.md               # 薄いラッパー（pr-reviewing skillへ参照）
│   └── suggest-claude-md.md    # 薄いラッパー（claude-md-suggesting skillへ参照）
├── skills/
│   ├── claude-md-suggesting/   # 新規（MCPツール参照なし）
│   │   └── SKILL.md
│   ├── pr-reviewing/           # 新規（MCPツール参照なし）
│   │   └── SKILL.md
│   ├── plan-creating/          # 新規
│   │   └── SKILL.md
│   ├── doc-writing/            # 新規
│   │   └── SKILL.md
│   ├── gh-pr-viewing/          # 既存
│   │   └── SKILL.md
│   └── gh-issue-managing/      # 既存
│       └── SKILL.md
└── hooks/
    ├── PreCompact.md
    └── SessionEnd.md
```

---

## 11. 変更履歴

### v2.0 (2025年12月20日) - レビュー反映
レビュー結果（`ai/reviews/251220_agents-commands-to-skills-migration_review.md`）を反映:

**主要な変更点**:
1. **Phase 0（棚卸し）を追加** - 現行仕様の正確な把握を最優先に
2. **commandsの扱いを変更** - 削除ではなく「薄いラッパー化」（10-30行以内）
3. **トークン削減目標を明確化** - 最低60%、ストレッチ80%（計測方法を明記）
4. **MCPツール削除方針を明記** - mcp__* 参照を完全削除（REQ-005、TASK-003）
5. **リスクを更新** - RISK-004をMCP削除リスクに変更、RISK-006を追加

**レビュー質問への回答を反映**:
- skillsは必要時のみロード → 確認済み（/contextで計測）
- commandsは薄いラッパー化でOK → 採用（CON-003）
- MCPツールは完全削除 → 反映（REQ-005）

**削減率の再計算**:
- 移行前: 981行
- 移行後: 270行（agents: 190行、commands: 80行）
- 削減率: 72%（最低目標60%を達成）

### v1.0 (2025年12月20日) - 初版
初版プラン作成（Standardワークフロー）

---

*このプランは Plan Creator エージェント（Standardワークフロー）によって作成されました*
