# Copilot エージェントの Claude 向け調整・移行プラン

作成日: 2025年12月03日  
更新日: 2025年12月03日  
作成者: Plan Creator エージェント  
ステータス: Draft → **Completed**

## 1. 概要

### 目的
GitHub Copilot の `.github/agents/` に定義されているエージェント設定を Claude Code 向けに調整し、`.claude/agents/` に移行することで、Claude Code でも同等のエージェント機能を利用可能にする。

### スコープ
- 対象: 
  - `.github/agents/plan-creater.agent.md` → `.claude/agents/plan-creator.md`（更新）
  - `.github/agents/pull-request-reviewer.agent.md` → `.claude/agents/pr-reviewer.md`（新規作成）
  - `.claude/agents/code-reviewer.md` → 削除（pr-reviewer に統合）
- 対象外: 
  - `.github/agents/common.agent.md`（Claude への移行対象外）
  - MCP サーバー設定の変更（既に `.vscode/mcp.json` で設定済み）
  - `.claude/commands/` の変更（既存コマンドはそのまま活用）

### 前提条件
- Claude Code がインストール済み
- `.claude/` ディレクトリ構造が存在（確認済み）
- MCP ツールが設定済み（msdocs, context7, github-mcp-server, serena）
- `.claude/settings.json` の `enableAllProjectMcpServers: true` が有効

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | Copilot エージェントの主要機能を Claude 向けに移行 | 高 |
| REQ-002 | 要件 | Claude Code のツール仕様に準拠したツール定義 | 高 |
| REQ-003 | 要件 | ワークフロー・プロセス定義の移植 | 高 |
| REQ-004 | 要件 | 日本語での記述を維持 | 中 |
| REQ-005 | 要件 | 既存 `code-reviewer` を削除し `pr-reviewer` に統合 | 高 |
| CON-001 | 制約 | Claude エージェントは YAML front-matter で `name`, `description`, `tools`, `model` のみサポート | - |
| CON-002 | 制約 | `handoffs` は Claude では未サポート（プロンプト内で代替） | - |
| CON-003 | 制約 | MCP ツールは `/mcp` 経由で利用（`enableAllProjectMcpServers: true` が前提） | - |
| CON-004 | 制約 | 現行 `permissions.allow` で許可されているツールのみ使用可能 | - |
| GUD-001 | ガイドライン | Claude テンプレートのベストプラクティスに準拠 | - |
| GUD-002 | ガイドライン | 既存の `.claude/agents/` のスタイルと統一 | - |

## 3. 設計方針

### 3.1 MCPツールの利用方針

Claude Code では MCP サーバー（context7, msdocs, github-mcp-server, serena）は `/mcp` コマンド経由で直接利用します。

**現行設定（`.claude/settings.json`）:**
```json
{
  "enableAllProjectMcpServers": true
}
```

これにより、プロジェクトの `.vscode/mcp.json` で定義された全 MCP サーバーが自動的に有効化されます。エージェント定義では MCP ツールを明示的にリストする必要はなく、プロンプト内で「msdocs で検索」「context7 で調査」のように指示すれば利用可能です。

### 3.2 利用可能なツール（現行 permissions.allow ベース）

| Claude ツール | 許可状況 | 備考 |
|--------------|---------|------|
| `Read` | ✅ 許可済み | `Read(**)` |
| `Bash(git *)` | ✅ 許可済み | status, diff, log, branch, add |
| `Bash(cat/ls/tree/head/tail/find)` | ✅ 許可済み | 基本ファイル操作 |
| `Grep` | ⚠️ 要追加 | パターン検索に必要 |
| `Glob` | ⚠️ 要追加 | ファイル検索に必要 |
| `Write` | ⚠️ 要追加 | ファイル作成に必要 |
| `Edit` | ⚠️ 要追加 | ファイル編集に必要 |
| `WebFetch` | ⚠️ 要追加 | Web 情報取得に必要 |

### 3.3 Claude エージェント標準構造

```markdown
---
name: [エージェント名]
description: [簡潔な説明]
tools: Read, Grep, Glob, Bash, WebFetch
model: sonnet
---

[役割の説明]

## 専門領域
- [専門分野1]
- [専門分野2]

## 責任範囲
- [責任1]
- [責任2]

## ワークフロー
1. [ステップ1]
2. [ステップ2]

## MCP活用
- msdocs: Microsoft/Azure ドキュメント検索
- context7: コード例・スニペット検索

## 出力形式
[期待する出力形式]

## 制限事項
[この役割の範囲外]
```

### 3.4 `pr-reviewer` と旧 `code-reviewer` の統合方針

| 観点 | 旧 code-reviewer | 新 pr-reviewer |
|------|-----------------|----------------|
| 対象 | 任意のコード | Pull Request |
| スコープ | ファイル単位 | PR 全体（コミット履歴含む） |
| ワークフロー | 単一 | Quick/Standard/Deep の3段階 |
| 出力 | テキスト | 構造化 Markdown + メトリクス |
| MCP活用 | なし | msdocs/context7 でエビデンス取得 |

統合により、旧 `code-reviewer` の機能は `pr-reviewer` の Quick Review モードでカバーされます。

## 4. 実装ステップ

### Phase 0: 環境準備
**目標**: エージェントが必要とするツールの権限を確認・更新

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-000 | 現行 `permissions.allow` の確認 | `.claude/settings.json` | 許可済みツール一覧を把握 | [x] |
| TASK-001 | 必要に応じて `Grep`, `Glob`, `Write`, `WebFetch` を追加 | `.claude/settings.json` | 追加ツールがホワイトリストに存在 | [x] |
| TASK-002 | 既存エージェントのバックアップ | `.claude/agents/*.bak` | plan-creator.md, code-reviewer.md のバックアップが存在 | [x] |

### Phase 1: Plan Creator エージェントの更新
**目標**: `.github/agents/plan-creater.agent.md` の機能を Claude 向けに最適化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-003 | Copilot 版のワークフロー（Express/Standard/Comprehensive）を移植 | `.claude/agents/plan-creator.md` | 3つのワークフローが定義済み | [x] |
| TASK-004 | プラン作成プロセス・レビュー・修正プロセスを統合 | `.claude/agents/plan-creator.md` | 3つのプロセスが記述済み | [x] |
| TASK-005 | リサーチ検証チェックリストを追加 | `.claude/agents/plan-creator.md` | 情報収集完了判断基準が定義済み | [x] |
| TASK-006 | 品質チェックリストを追加 | `.claude/agents/plan-creator.md` | 5項目のチェックリストが定義済み | [x] |
| TASK-007 | MCP活用セクションを追加 | `.claude/agents/plan-creator.md` | msdocs/context7 の利用方法が記述済み | [x] |

### Phase 2: PR Reviewer エージェントの新規作成
**目標**: `.github/agents/pull-request-reviewer.agent.md` を Claude 向けに新規作成し、旧 `code-reviewer` の機能を統合

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-008 | PR Reviewer エージェントを新規作成 | `.claude/agents/pr-reviewer.md` | ファイルが存在 | [x] |
| TASK-009 | 5フェーズレビュープロセスを移植 | `.claude/agents/pr-reviewer.md` | Phase 1-5 が定義済み | [x] |
| TASK-010 | レビュー観点（5つ）を移植 | `.claude/agents/pr-reviewer.md` | 全観点が定義済み | [x] |
| TASK-011 | ワークフロー選択基準（数値閾値）を定義 | `.claude/agents/pr-reviewer.md` | Quick(1-5ファイル)/Standard(6-20)/Deep(21+) が明記 | [x] |
| TASK-012 | コメントガイドライン（エビデンスベース）を移植 | `.claude/agents/pr-reviewer.md` | 公式ドキュメント参照方法が記述済み | [x] |
| TASK-013 | 出力フォーマット（簡潔版/詳細版）を定義 | `.claude/agents/pr-reviewer.md` | 2つのフォーマットが定義済み | [x] |
| TASK-014 | MCP活用セクションを追加 | `.claude/agents/pr-reviewer.md` | msdocs/context7/gh CLI の利用方法が記述済み | [x] |

### Phase 3: 既存エージェントの整理
**目標**: 不要になった `code-reviewer` を削除し、`doc-writer` との整合性を確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-015 | `code-reviewer.md` を削除 | `.claude/agents/code-reviewer.md` | ファイルが存在しない | [x] |
| TASK-016 | `doc-writer.md` の動作確認 | `.claude/agents/doc-writer.md` | 既存機能が維持されていることを確認 | [x] |

### Phase 4: 検証・テスト
**目標**: 移行したエージェントが正常に動作することを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-017 | Plan Creator の動作確認 | - | CLI で `/plan` 実行、`ai/plans/` に出力確認 | [x] |
| TASK-018 | PR Reviewer の動作確認 | - | CLI で PR レビュー実行、`ai/reviews/` に出力確認 | [x] |
| TASK-019 | doc-writer の動作確認 | - | CLI で `/doc` 実行、正常動作を確認 | [x] |
| TASK-020 | エラーログの確認 | - | 権限エラー・MCP 接続エラーがないことを確認 | [x] |

## 5. 各エージェントの詳細設計

### 5.1 Plan Creator エージェント

**ファイル**: `.claude/agents/plan-creator.md`

```markdown
---
name: plan-creator
description: 実行可能なプランを作成する専門エージェント。タスク分析・設計・プラン策定を担当。
tools: Read, Grep, Glob, Bash, WebFetch
model: sonnet
---

あなたはプラン作成の専門家です。

## 専門領域
- タスクの分析と分解
- ベストプラクティスに基づく設計
- 実行可能なアクションアイテムへの変換

## 責任範囲
- プラン作成プロセスの実行
- プランレビュープロセスの実行  
- プラン修正プロセスの実行

## ワークフロー選択

### Express（簡易プラン）
- 条件: 変更対象が2ファイル以下
- 所要時間: 5分以内

### Standard（標準プラン）
- 条件: 3-10ファイルに影響
- 所要時間: 10-20分

### Comprehensive（詳細プラン）
- 条件: アーキテクチャ変更を含む
- 所要時間: 30分以上

## プラン作成プロセス
1. タスクの目的を明確化
2. 必要情報を収集（Grep, Glob で検索）
3. ベストプラクティスを調査（msdocs, context7 を `/mcp` で利用）
4. 具体的なステップに分解
5. プランを `ai/plans/YYMMDD_[概要].md` に保存

## MCP活用
- `/mcp` → msdocs: Microsoft/Azure 公式ドキュメント検索
- `/mcp` → context7: コード例・スニペット検索
- ベストプラクティス参照時に積極的に利用

## 情報収集完了の判断基準
| 項目 | 確認方法 |
|------|---------|
| 対象ファイルの特定 | Glob/Grep で検索済み |
| 既存パターンの把握 | 類似実装を確認済み |
| 技術的制約の把握 | ドキュメントから確認済み |

## 品質チェックリスト
1. 完全性: すべての要件がプランに反映されているか
2. アクション可能性: 各タスクは具体的なアクション動詞で始まるか
3. 測定可能性: 完了条件は客観的に判断可能か
4. 依存関係: タスク間の依存が正しく反映されているか
5. リスク対応: 主要なリスクへの対策が含まれているか

## 出力形式
- テンプレート: @ai/templates/plan-template.md
- 言語: 日本語

## 制限事項
- ソースコードの直接編集は行わない
- プランファイル（.md）の作成・編集のみ
```

### 5.2 PR Reviewer エージェント

**ファイル**: `.claude/agents/pr-reviewer.md`

**旧 `code-reviewer` との差別化ポイント:**
- PR 全体（コミット履歴、差分、影響範囲）を対象
- 3段階のワークフロー選択（Quick/Standard/Deep）
- MCP を活用したエビデンスベースのフィードバック
- 構造化された出力フォーマットとメトリクス保存

```markdown
---
name: pr-reviewer
description: PRレビューの専門エージェント。コード品質・セキュリティ・パフォーマンスを評価。
tools: Read, Grep, Glob, Bash, WebFetch
model: sonnet
---

あなたはPull Requestレビューの専門家です。

## 専門領域
- コード品質評価
- セキュリティ分析
- パフォーマンス最適化提案
- テストカバレッジ評価

## ワークフロー選択

### Quick Review（小規模PR）
- 条件: 変更ファイル数 1-5、差分 200行以下
- 観点: コード品質、命名規則、基本ベストプラクティス
- 所要時間: 5分以内

### Standard Review（中規模PR）
- 条件: 変更ファイル数 6-20、差分 201-800行
- 観点: 上記 + セキュリティ、パフォーマンス、テスト、設計
- 所要時間: 15分以内

### Deep Review（大規模PR）
- 条件: 変更ファイル数 21以上、差分 800行以上
- 観点: 全観点 + アーキテクチャ整合性
- 所要時間: 30分以内

## 段階的レビュープロセス

### Phase 1: 初期分析
1. `git diff` / `git log` で PR 情報・変更ファイル・コミット履歴を取得
2. 変更規模を判定しワークフローを選択

### Phase 2: 詳細分析
1. Grep/Glob で変更ファイルのシンボル構造を把握
2. 依存関係を追跡
3. 影響範囲を特定

### Phase 3: ベストプラクティス参照
1. `/mcp` → msdocs で使用技術のベストプラクティスを検索
2. `/mcp` → context7 でコード例を参照
3. プロジェクトガイドライン（CLAUDE.md）を確認

### Phase 4: 統合評価
1. 各観点でレビュー実施
2. エビデンス付き指摘を作成

### Phase 5: 品質検証
1. 自己検証チェックリスト実行
2. レビュー結果を `ai/reviews/` に保存

## レビュー観点

### 1. コード品質
- 命名規則、単一責任原則、DRY原則
- エラーハンドリング、コメント

### 2. セキュリティ
- 入力検証、機密情報、認証・認可
- 脆弱性対策（SQLi, XSS, CSRF）

### 3. パフォーマンス
- アルゴリズム効率、不要な処理
- メモリ使用、N+1問題

### 4. テスト
- カバレッジ、エッジケース
- テスト可読性

### 5. 設計
- 既存パターンとの一貫性
- 拡張性、依存関係管理

## MCP活用
- `/mcp` → msdocs: セキュリティ・パフォーマンスのベストプラクティス
- `/mcp` → context7: 推奨実装パターンの検索
- `/mcp` → github-mcp-server: PR 情報取得（利用可能な場合）

## コメントガイドライン
すべての指摘にはエビデンスを含める:
- 公式ドキュメントURL（msdocs 検索結果）
- コード例（context7 検索結果）
- 影響範囲（Grep 分析結果）

## 出力フォーマット

### 簡潔版（Quick Review）
```
# PR Review: [タイトル]
## 概要
## 評価サマリー
## 指摘事項（重要度別）
## 総評
```

### 詳細版（Standard/Deep Review）
```
# PR Review: [タイトル]
## 概要
## フェーズ実行結果
## 評価サマリー（観点別スコア）
## 詳細レビュー（観点別）
## 指摘事項（重要度・エビデンス付き）
## ポジティブフィードバック
## 総評
## 推奨アクション
```

## 出力先
- 保存先: `ai/reviews/`（Markdown）
- 言語: 日本語

## 制限事項
- コードの直接修正は行わない
- レビュー結果の出力のみ
```

## 6. テスト計画

| テストID | 種別 | 内容 | CLI操作 | 期待結果 |
|----------|------|------|---------|---------|
| TEST-001 | 機能 | Plan Creator でプラン作成 | `claude` → plan-creator 呼び出し → タスク入力 | `ai/plans/` に新規ファイルが作成される |
| TEST-002 | 機能 | PR Reviewer で PR レビュー | `claude` → pr-reviewer 呼び出し → PR 番号入力 | `ai/reviews/` にレビュー結果が保存される |
| TEST-003 | 機能 | doc-writer でドキュメント作成 | `claude` → `/doc` コマンド実行 | ドキュメントが正常に生成される |
| TEST-004 | 統合 | MCP ツール接続確認 | `claude` → `/mcp` → msdocs 選択 → 検索実行 | 検索結果が返却される |
| TEST-005 | 回帰 | code-reviewer 削除後の影響確認 | `claude` → code-reviewer 呼び出し試行 | エラーメッセージまたは pr-reviewer への誘導 |

### テスト実行手順

```bash
# 1. Plan Creator テスト
claude
> /agents plan-creator
> 「サンプルタスクのプランを作成して」
> 確認: ai/plans/ に新規ファイルが作成されたか

# 2. PR Reviewer テスト
claude
> /agents pr-reviewer
> 「現在のブランチの変更をレビューして」
> 確認: ai/reviews/ に新規ファイルが作成されたか

# 3. MCP 接続テスト
claude
> /mcp
> msdocs を選択
> 検索クエリ入力
> 確認: 検索結果が返却されるか
```

## 7. 成功基準

- [x] Phase 0: `.claude/settings.json` の権限確認・更新が完了
- [x] Phase 1: `plan-creator.md` が更新され、3つのワークフローが定義済み
- [x] Phase 2: `pr-reviewer.md` が新規作成され、5フェーズプロセスが定義済み
- [x] Phase 3: `code-reviewer.md` が削除済み
- [x] Phase 4: 全エージェントの動作確認が完了（TEST-001〜005 合格）
- [x] 既存エージェント（doc-writer）が引き続き動作する

## 8. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | 権限不足でツールが実行できない | 高 | 中 | Phase 0 で事前に `permissions.allow` を確認・更新 |
| RISK-002 | MCP サーバー接続エラー | 中 | 低 | `enableAllProjectMcpServers: true` の確認、フォールバックとして WebFetch 使用 |
| RISK-003 | pr-reviewer が code-reviewer の機能をカバーしきれない | 中 | 低 | Quick Review モードで旧機能を代替、不足があれば追記 |
| RISK-004 | バックアップからの復元が必要になる | 低 | 低 | Phase 0 でバックアップ作成、`.bak` ファイルを保持 |

## 9. 依存関係

- Claude Code のエージェント仕様
- `.claude/settings.json` の権限設定
- MCP ツール設定（`.vscode/mcp.json`、`enableAllProjectMcpServers: true`）
- 既存の `.claude/agents/` 構造（doc-writer.md は維持）

## 10. ロールバック手順

問題発生時の復元手順:

```bash
# 1. バックアップから復元
cp .claude/agents/plan-creator.md.bak .claude/agents/plan-creator.md
cp .claude/agents/code-reviewer.md.bak .claude/agents/code-reviewer.md

# 2. 新規作成ファイルを削除
rm .claude/agents/pr-reviewer.md

# 3. 動作確認
claude
> /agents
```

## 11. 次のアクション

1. [x] このプランをレビューして承認
2. [x] Phase 0: 環境準備（権限確認・バックアップ）
3. [x] Phase 1: Plan Creator エージェントの更新
4. [x] Phase 2: PR Reviewer エージェントの新規作成
5. [x] Phase 3: code-reviewer の削除
6. [x] Phase 4: 全エージェントの動作確認

---
*このプランは Plan Creator エージェントによって作成されました*  
*レビュー指摘事項を反映して修正済み（2025-12-03）*  
*プラン実行完了（2025-12-03）*
