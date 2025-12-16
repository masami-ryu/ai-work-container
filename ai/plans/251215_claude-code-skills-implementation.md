# Claude Code Skills導入によるトークン消費削減プラン

作成日: 2025年12月15日
作成者: Plan Creator エージェント
ステータス: Review（レビュー最終反映版v2.2）
最終更新: 2025年12月15日
レビュー反映: ai/reviews/251215_claude-code-skills-implementation_review2.md（全項目対応完了）

## 1. 概要

### 目的
Claude Code Skillsを導入し、MCPツールの段階的読み込みによってセッション開始時のトークン消費を約60%削減する。

### スコープ
- 対象: `.claude/skills/` の新規作成、既存MCPサーバーのSkills化
- 対象外: 既存の `.claude/commands/` と `.claude/agents/` の削除（共存可能）

### 前提条件
- Claude Code CLI v2.0以降がインストール済み
- MCP サーバー（msdocs, context7, github-mcp-server, serena）が正常動作中
- プロジェクトルートに `.claude/` ディレクトリが存在

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | MCPツールをSkillsでラップしてトークン消費を削減 | 高 |
| REQ-002 | 要件 | 既存のslash commandsとagentsは維持（共存） | 高 |
| REQ-003 | 要件 | Skillsの段階的読み込み（メタデータ → 詳細 → リソース）を実装 | 高 |
| REQ-004 | 要件 | プロジェクト固有のワークフロー（プラン作成、レビュー、ドキュメント作成）をSkills化 | 中 |
| REQ-005 | 要件 | チーム共有可能な構成（gitでバージョン管理） | 中 |
| CON-001 | 制約 | SKILL.mdは500行以下に保つ | - |
| CON-002 | 制約 | 説明（description）は1024文字以内 | - |
| CON-003 | 制約 | Skill名は小文字、数字、ハイフンのみ、64文字以内 | - |
| GUD-001 | ガイドライン | 段階的情報開示パターンを適用（SKILL.md → REFERENCE.md） | - |
| GUD-002 | ガイドライン | MCPツール参照は完全修飾名を使用（例: `mcp__msdocs__microsoft_docs_search`） | - |

## 3. 実装ステップ

### Phase 0: 事前検証（Must Fix対応）
**目標**: Skills機能の仕様を確認し、実装前提条件を整える

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-000 | Claude Code CLIバージョン確認 | - | `claude --version` でv2.0以降であることを確認 | [ ] |
| TASK-001 | Skills機能の仕様確認 | - | Skills配置パス（`.claude/skills/`）、ファイル規約（`SKILL.md`）、自動起動条件を公式ドキュメントまたはCLIヘルプで確認 | [ ] |
| TASK-001A | Skills仕様の確認手段を確定 | - | 公式ドキュメントが閲覧不可の場合（例: 取得ブロック/404）に備え、`claude --help` / `claude -h` / `claude config` 等のCLIヘルプ・ローカルドキュメントで代替確認できることを確認 | [ ] |
| TASK-001B | Skills非対応時のフォールバック方針決定 | - | Skillsが利用できない場合の代替案（例: `.claude/commands/`運用を継続し、`enableAllProjectMcpServers`の見直しで初期コンテキストを抑制）を決め、以降フェーズのGo/No-Go基準を明記 | [ ] |
| TASK-002 | permissions設定の確認と更新 | `.claude/settings.json` | `mcp__github-mcp-server` と `mcp__serena` の権限設定を確認し、必要に応じて `allow` に追加 | [ ] |
| TASK-003 | .gitignore確認 | `.gitignore` | `.claude/skills/` がgit管理対象であることを確認（除外されていないこと） | [ ] |
| TASK-004 | 既存ツール参照記法の確認 | `.claude/commands/review.md` | MCPツール呼び出しの既存記法を確認し、SKILL.md内の例と統一（v2.1で完了） | [x] |

### Phase 1: 基盤構築
**目標**: Skillsディレクトリを作成し、最初のSkillを実装してトークン削減を検証

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-005 | `.claude/skills/` ディレクトリを作成 | `.claude/skills/` | ディレクトリが存在する | [ ] |
| TASK-006 | microsoft-docs-search Skillを作成 | `.claude/skills/microsoft-docs-search/SKILL.md` | SKILL.mdが存在し、YAML構文が正しい | [ ] |
| TASK-007 | microsoft-docs-search Skillに詳細リファレンスを追加 | `.claude/skills/microsoft-docs-search/REFERENCE.md` | REFERENCE.mdが存在し、msdocsの全3ツールの詳細が記載されている | [ ] |
| TASK-008 | 動作確認（Skill自動検出テスト） | - | `claude -p "Azure Functionsのベストプラクティスを教えて"` 実行時、CLIログまたは応答にmicrosoft-docs-search Skillの使用が確認できる | [ ] |

### Phase 2: MCPサーバーのSkills化
**目標**: 残り3つのMCPサーバーをSkills化し、トークン削減効果を最大化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-009 | code-examples-search Skillを作成（context7ラッパー） | `.claude/skills/code-examples-search/SKILL.md` | SKILL.mdが存在し、context7の2ツールを参照 | [ ] |
| TASK-010 | github-operations Skillを作成（github-mcp-serverラッパー） | `.claude/skills/github-operations/SKILL.md` | SKILL.mdが存在し、主要なGitHub操作を記載（頻出操作はSKILL.md、全ツールはREFERENCE.md） | [ ] |
| TASK-011 | github-operations Skillに詳細リファレンスを追加 | `.claude/skills/github-operations/REFERENCE.md` | REFERENCE.mdに40+ツールの分類と説明 | [ ] |
| TASK-012 | semantic-code-analysis Skillを作成（serenaラッパー） | `.claude/skills/semantic-code-analysis/SKILL.md` | SKILL.mdが存在し、serenaの主要機能を記載（頻出操作はSKILL.md、全ツールはREFERENCE.md） | [ ] |
| TASK-013 | semantic-code-analysis Skillに詳細リファレンスを追加 | `.claude/skills/semantic-code-analysis/REFERENCE.md` | REFERENCE.mdにserenaツールの詳細が記載 | [ ] |

### Phase 3: ワークフローのSkills化
**目標**: 既存のslash commandsをベースにSkillsを作成し、自動起動を実現

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-014 | planning-workflow Skillを作成 | `.claude/skills/planning-workflow/SKILL.md` | SKILL.mdが存在し、キーワード（「プラン」「計画」）を含む質問でSkillが呼び出される | [ ] |
| TASK-015 | planning-workflow Skillにテンプレート参照を追加 | `.claude/skills/planning-workflow/TEMPLATE.md` | plan-template.mdの内容をコピー | [ ] |
| TASK-016 | document-workflow Skillを作成 | `.claude/skills/document-workflow/SKILL.md` | SKILL.mdが存在し、キーワード（「ドキュメント」「README」）を含む質問でSkillが呼び出される | [ ] |
| TASK-017 | review-workflow Skillを作成 | `.claude/skills/review-workflow/SKILL.md` | SKILL.mdが存在し、キーワード（「レビュー」「PR」）を含む質問でSkillが呼び出される | [ ] |

### Phase 4: 検証と最適化
**目標**: トークン削減効果を測定し、Skillsを最適化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-018 | トークン消費の測定（Skills導入前） | `ai/test-results/token-baseline-251215.md` | セッション開始時のトークン消費を3回測定し、平均値を記録（測定方法は「12. トークン測定方法」参照） | [ ] |
| TASK-019 | トークン消費の測定（Skills導入後） | `ai/test-results/token-after-skills-251215.md` | セッション開始時のトークン消費を3回測定し、平均値と削減率を記録 | [ ] |
| TASK-020 | Skillsの説明（description）を最適化 | 全SKILL.md | 各Skillに必須キーワード（例: github-operations→GitHub/PR/Issue/commit）が含まれ、意図しない自動起動が発生しないことを確認 | [ ] |
| TASK-021 | ドキュメント更新 | `docs/claude-code-usage.md` | Skillsの使用方法、自動検出の仕組み、トークン削減効果を追記 | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 事前検証 | Skills機能の存在確認 | `claude --help` または公式ドキュメントでSkills機能の説明が確認できる |
| TEST-002 | 事前検証 | permissions設定の有効性 | GitHub/Serena MCPツールが確認なしで使用できる |
| TEST-003 | 単体 | microsoft-docs-search Skillの自動検出 | `claude -p "Azure Functionsのベストプラクティス"` でSkillが使用される |
| TEST-004 | 単体 | code-examples-search Skillの自動検出 | "React hooksの例を見せて"でSkillが使用される |
| TEST-005 | 単体 | github-operations Skillの自動検出 | "PRを作成して"でSkillが使用される |
| TEST-006 | 単体 | semantic-code-analysis Skillの自動検出 | "このファイルのシンボルを確認"でSkillが使用される |
| TEST-007 | 統合 | planning-workflow Skillの自動検出 | "プランを作成して"でSkillが使用される（/planなしで） |
| TEST-008 | 統合 | トークン消費の削減効果 | セッション開始時のトークン消費が約1,000トークン削減（約60%削減） |
| TEST-009 | 回帰 | 既存slash commandsの動作確認 | /plan, /review, /docが引き続き動作 |
| TEST-010 | 回帰 | 既存agentsの動作確認 | plan-creator, pr-reviewer, doc-writerが引き続き動作 |
| TEST-011 | 回帰 | 意図しない自動起動の防止 | "GitHub Actions"などの言及でgithub-operations Skillが誤って起動しない |
| TEST-012 | 静的 | Skillsリンク整合性チェック | `.claude/skills/**/SKILL.md` 内の `REFERENCE.md` リンクが全て有効（同ディレクトリにファイルが存在） |
| TEST-013 | 静的 | Skills frontmatter検証 | 全 `SKILL.md` に有効な frontmatter（name, description）が存在する |

## 5. 成功基準

**注**: 以下の数値（約60%削減、約1,000トークン削減）は目標値であり、実測結果に応じて更新されます。

- [ ] **Phase 0（事前検証）**: Skills機能の仕様が確認され、実装前提条件が整っている
- [ ] **Phase 0（事前検証）**: permissions設定が完了し、GitHub/Serena MCPツールが確認なしで使用できる
- [ ] **Phase 1-3（実装）**: `.claude/skills/` ディレクトリが作成され、7つのSkillsが実装されている
- [ ] **Phase 4（測定）**: セッション開始時のトークン消費が目標約1,000トークン削減される（目標約60%削減）
- [ ] **Phase 4（測定）**: トークン測定が3回実施され、削減率が客観的に検証されている
- [ ] **Phase 4（最適化）**: Skillsが適切なキーワードで自動検出される（テスト合格率100%）
- [ ] **Phase 4（回帰）**: 既存のslash commandsとagentsが引き続き正常に動作する
- [ ] **共有**: チーム全員がgit pullでSkillsを取得できる（.claude/skills/がgit管理下）
- [ ] **ドキュメント**: docs/claude-code-usage.mdにSkillsの使用方法が記載されている

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | Skills機能の仕様が未確認（Phase 0で対応） | 高 | 高 | Phase 0で事前検証を実施、公式ドキュメント確認、CLIヘルプ確認。Skillsが利用不可の場合は`.claude/settings.json`の`enableAllProjectMcpServers`見直しで初期コンテキストを抑制（代替案） |
| RISK-002 | トークン測定方法が不明確（Phase 0で対応） | 高 | 中 | セクション「12. トークン測定方法」で測定手順を明確化、3回試行で平均値を取得 |
| RISK-003 | permissions設定不足（Phase 0で対応） | 中 | 中 | Phase 0でGitHub/Serenaの権限設定を確認・更新 |
| RISK-004 | Skillsが自動検出されない | 高 | 中 | 説明（description）に具体的なキーワードを含める、テストケースで検証 |
| RISK-005 | トークン削減効果が期待より低い | 中 | 低 | SKILL.mdを500行以下に保つ、詳細はREFERENCE.mdに分離 |
| RISK-006 | 既存のslash commandsとの競合 | 中 | 低 | Skillsの説明を調整して意図しない自動起動を防ぐ、TEST-011で検証 |
| RISK-007 | チームメンバーがSkillsの使い方を理解しない | 低 | 中 | ドキュメントを充実させる、使用例を提供 |
| RISK-008 | MCPツールのAPI変更 | 中 | 低 | REFERENCE.mdを定期的に更新、バージョン管理 |

## 7. 依存関係

- Claude Code CLI v2.0以降（Skills機能サポート）
- MCPサーバー（msdocs, context7, github-mcp-server, serena）の正常動作
- `.vscode/mcp.json` の設定維持
- git管理（.claude/skills/をチーム共有）

## 8. 次のアクション

1. [ ] **Phase 0（事前検証）の実施** - Skills機能の仕様確認、CLIバージョン確認、permissions設定更新
2. [ ] **Phase 4-TASK-018の先行実施** - Skills導入前のトークン消費測定（ベースライン取得）
3. [ ] **Phase 1の実装開始** - `.claude/skills/` 作成、microsoft-docs-search Skill実装
4. [ ] **Phase 1の検証** - 最初のSkillのテストと検証
5. [ ] **Phase 2-3の実装** - 全Skills作成（MCP Skills化、ワークフロー Skills化）
6. [ ] **Phase 4の完了** - トークン消費の再測定、削減効果確認、最適化
7. [ ] **ドキュメント更新とチーム共有**

## 9. トークン削減の詳細分析

### 現状（Skills導入前）

**セッション開始時に常に読み込まれるMCPツール定義:**

| MCPサーバー | ツール数 | 推定トークン消費 |
|-----------|---------|---------------|
| msdocs | 3 | ~200トークン |
| context7 | 2 | ~100トークン |
| github-mcp-server | 40+ | ~800トークン |
| serena | 20+ | ~600トークン |
| **合計** | **65+** | **~1,700トークン** |

### 改善後（Skills導入後）

**セッション開始時に読み込まれるSkillメタデータ:**

| Skill | メタデータサイズ | 推定トークン消費 |
|-------|---------------|---------------|
| microsoft-docs-search | YAML frontmatter | ~100トークン |
| code-examples-search | YAML frontmatter | ~100トークン |
| github-operations | YAML frontmatter | ~100トークン |
| semantic-code-analysis | YAML frontmatter | ~100トークン |
| planning-workflow | YAML frontmatter | ~100トークン |
| document-workflow | YAML frontmatter | ~100トークン |
| review-workflow | YAML frontmatter | ~100トークン |
| **合計** | **メタデータのみ** | **~700トークン** |

**詳細な指示（必要な時のみ読み込み）:**
- SKILL.md本文: ~200-500トークン/Skill（使用時のみ）
- REFERENCE.md: ~1,000-2,000トークン/Skill（必要時のみ）

### 削減効果

- **セッション開始時**: 1,700トークン → 700トークン = **約1,000トークン削減（約60%削減）**
- **詳細読み込み時**: 必要なSkillの詳細のみ読み込み（使用しないSkillは0トークン）

**例: "Azure Functionsのベストプラクティスを教えて"の場合**

| 段階 | 読み込み内容 | トークン消費 |
|------|------------|------------|
| セッション開始 | 全Skillメタデータ | 700トークン |
| Skill起動 | microsoft-docs-search/SKILL.md | +200トークン |
| 詳細参照 | microsoft-docs-search/REFERENCE.md（必要な場合） | +500トークン |
| **合計** | - | **1,400トークン** |

**従来の方法（全MCPツール定義読み込み）:**
- セッション開始: 1,700トークン
- 使用しないツール（context7, github, serena）も読み込み済み
- **合計: 1,700トークン**

**削減効果（この例）:** 1,700 - 1,400 = 300トークン削減（約18%削減）

**注**: より複雑なタスク（複数MCPサーバーを使用しない場合）では、削減効果がさらに大きくなります。

## 10. Skills一覧

### MCPサーバーラッパーSkills

1. **microsoft-docs-search**
   - 目的: Microsoft公式ドキュメントの検索
   - ラップ対象: msdocs（3ツール）
   - キーワード: "Microsoft", "Azure", "公式ドキュメント", "ベストプラクティス"

2. **code-examples-search**
   - 目的: コード例とスニペットの検索
   - ラップ対象: context7（2ツール）
   - キーワード: "コード例", "スニペット", "サンプルコード", "実装例"

3. **github-operations**
   - 目的: GitHub操作（Issue、PR、コミット、ブランチなど）
   - ラップ対象: github-mcp-server（40+ツール）
   - キーワード: "GitHub", "Issue", "PR", "Pull Request", "コミット", "ブランチ"

4. **semantic-code-analysis**
   - 目的: セマンティックコード分析（シンボル検索、参照検索など）
   - ラップ対象: serena（20+ツール）
   - キーワード: "シンボル", "参照", "コード分析", "リファクタリング", "rename"

### ワークフローSkills

5. **planning-workflow**
   - 目的: プラン作成の自動起動
   - ベース: `.claude/commands/plan.md`
   - キーワード: "プラン", "計画", "実行計画", "タスク分解"

6. **document-workflow**
   - 目的: ドキュメント作成の自動起動
   - ベース: `.claude/commands/doc.md`
   - キーワード: "ドキュメント", "README", "説明書", "マニュアル"

7. **review-workflow**
   - 目的: PRレビューの自動起動
   - ベース: `.claude/commands/review.md`
   - キーワード: "レビュー", "Pull Request", "コードレビュー", "PR"

## 11. 実装例テンプレート

### microsoft-docs-search/SKILL.md

```yaml
---
name: microsoft-docs-search
description: Search official Microsoft and Azure documentation for best practices, tutorials, and API references. Use when user mentions Microsoft, Azure, .NET, or asks for official documentation and best practices.
---

# Microsoft Documentation Search

## Quick Start

Search for Azure Functions best practices:
```
mcp__msdocs__microsoft_docs_search
  query: "Azure Functions best practices"
```

Search for code samples:
```
mcp__msdocs__microsoft_code_sample_search
  query: "Azure Functions C#"
  language: "csharp"
```

Fetch complete documentation:
```
mcp__msdocs__microsoft_docs_fetch
  url: "https://learn.microsoft.com/azure/azure-functions/"
```

## Common Use Cases

- Best practices for Azure services
- Official API references
- Code samples and examples
- Troubleshooting guides

For detailed API reference, see [REFERENCE.md](REFERENCE.md).
```

### microsoft-docs-search/REFERENCE.md

```markdown
# Microsoft Documentation Search - API Reference

## Available Tools

### 1. microsoft_docs_search
Search official Microsoft documentation and return up to 10 content chunks.

**Parameters:**
- `query` (required): Search query or topic about Microsoft/Azure products

**Example:**
```
mcp__msdocs__microsoft_docs_search
  query: "ASP.NET Core authentication"
```

### 2. microsoft_code_sample_search
Search for code snippets in official Microsoft Learn documentation.

**Parameters:**
- `query` (required): Descriptive query or SDK/method name
- `language` (optional): Programming language (csharp, javascript, python, etc.)

**Example:**
```
mcp__msdocs__microsoft_code_sample_search
  query: "Entity Framework Core"
  language: "csharp"
```

### 3. microsoft_docs_fetch
Fetch and convert a Microsoft Learn documentation page to markdown.

**Parameters:**
- `url` (required): URL of the Microsoft documentation page

**Example:**
```
mcp__msdocs__microsoft_docs_fetch
  url: "https://learn.microsoft.com/azure/azure-functions/functions-reference"
```

## Search Tips

1. Use specific keywords
2. Include product names (Azure, .NET, etc.)
3. Specify version if needed (e.g., ".NET 8")
4. Use `language` parameter for code samples
```

## 12. トークン測定方法

### 測定目的
Claude Code Skills導入前後のトークン消費を客観的に比較し、削減効果を検証する。

### 測定対象
- **セッション開始時の初期プロンプト**: Claude Code CLIセッション開始直後に読み込まれるすべてのコンテキスト
- **含まれるもの**: システムプロンプト、MCPツール定義（またはSkillsメタデータ）、プロジェクト設定
- **含まれないもの**: ユーザーの最初の質問、応答生成に使用されるトークン

### 測定方法

#### 前提条件
- Claude Code CLI v2.0以降がインストール済み
- 測定環境は同一（同じdevcontainer、同じMCP設定）

#### 測定手順

0. **トークン数の取得手段を確定（先に確認）**
   - `claude -p --output-format json "..."` の出力に usage/token が含まれるか確認
   - 含まれない場合は、CLIのデバッグログ、またはAnthropic側の使用状況ダッシュボード等で代替（ただし“セッション開始時のみ”の切り分けが難しい点を備考に明記）

1. **ログ有効化（必要に応じて）**
   ```bash
   # デバッグモードでClaude Codeを起動し、トークン消費をログ出力
   # （実際の方法はClaude Code CLIの仕様に依存）
   ```

2. **セッション開始**
   ```bash
   # 新規セッションを開始
   claude
   ```

3. **初期プロンプトのトークン数を記録**
   - Claude Code CLIのログまたはAPI応答からトークン数を取得
   - または、Claude APIの使用状況ダッシュボードから確認
   - **記録項目**: 日時、トークン数、設定状態（Skills有無）

4. **3回繰り返し**
   - 環境を同一条件に保ち、3回測定を実施
   - 各回の測定後、セッションを終了して再起動

5. **平均値を計算**
   - 3回の測定結果の平均値を算出
   - 標準偏差も記録（ばらつきの評価）

#### 測定タイミング

- **ベースライン測定（TASK-018）**: Phase 0完了後、Phase 1開始前
- **Skills導入後測定（TASK-019）**: Phase 3完了後（全Skills実装後）

#### 記録フォーマット

測定結果は以下の形式で `ai/test-results/` に保存：

**ファイル名**: `token-baseline-YYMMDD.md` / `token-after-skills-YYMMDD.md`

**内容例**:
```markdown
# トークン消費測定結果 - [ベースライン/Skills導入後]

測定日: 2025年12月15日
測定者: [名前]
環境: devcontainer (ai-work-container)

## 設定状態
- Claude Code CLI: v2.0.5
- MCPサーバー: msdocs, context7, github-mcp-server, serena
- Skills: [有効/無効]

## 測定結果

| 試行 | トークン数 | 備考 |
|------|----------|------|
| 1回目 | 1,720 | - |
| 2回目 | 1,695 | - |
| 3回目 | 1,710 | - |
| **平均** | **1,708** | 標準偏差: 10.4 |

## 内訳（推定）
- システムプロンプト: ~500トークン
- MCPツール定義: ~1,200トークン
  - msdocs: ~200
  - context7: ~100
  - github-mcp-server: ~800
  - serena: ~600

## 備考
- [特記事項]
```

### 削減率の計算

```
削減率 = (ベースライン - Skills導入後) / ベースライン × 100
```

**目標**: 約60%削減（約1,000トークン削減）

### 注意事項
- 測定は必ず同一環境で実施（MCPサーバーの設定、プロジェクトファイルを変更しない）
- セッション間でキャッシュの影響を受けないよう、各測定前にキャッシュをクリア（必要に応じて）
- トークン数の取得方法がCLIで提供されていない場合は、公式ドキュメントまたはサポートに問い合わせ

## 13. 変更履歴

### v2.2（レビュー最終反映版）- 2025年12月15日

**レビュー**: ai/reviews/251215_claude-code-skills-implementation_review2.md

**修正内容**:
1. **成功基準の数値を「目標」として明確化**
   - セクション5の冒頭に注記を追加: 「数値は目標値であり、実測結果に応じて更新される」
   - Phase 4の成功基準に「目標」の文言を追加
2. **enableAllProjectMcpServersの見直しをフォールバック案として明記**
   - RISK-001の対策にSkillsが利用不可の場合の代替案を追加

**レビュー分析結果**:
- Must/Should対応項目は既にv2で対応済み（Phase 0、トークン測定手順）
- 追加提案の2項目を本バージョンで反映完了

### v2.1（ツール呼び出し記法統一版）- 2025年12月15日

**レビュー再評価**: レビュー結果の妥当性を再分析し、最後の未対応項目を修正

**修正内容**:
1. **ツール呼び出し表現の統一（Must Fix 3.1対応）**
   - セクション「11. 実装例テンプレート」のツール呼び出し記法を統一
   - コマンド風表記（`query:"..."`）からYAMLブロック形式（`query: "..."`）に変更
   - `.claude/commands/review.md` の既存記法と整合

### v2（レビュー反映版）- 2025年12月15日

**レビュー**: ai/reviews/251215_claude-code-skills-implementation_review.md

**Must Fix対応**:
1. **Phase 0（事前検証）を追加**
   - TASK-000: Claude Code CLIバージョン確認
   - TASK-001: Skills機能の仕様確認
   - TASK-002: permissions設定の確認と更新
   - TASK-003: .gitignore確認
   - TASK-004: 既存ツール参照記法の確認

2. **トークン測定方法を詳細化**
   - セクション「12. トークン測定方法」を追加
   - 測定手順、試行回数（3回）、記録フォーマットを明記
   - TASK-018/019の完了条件を具体化

3. **完了条件を観測可能に修正**
   - TASK-008（旧004）: CLIログまたは応答での確認を明記
   - TASK-014-017: キーワードによる自動起動を明記
   - TASK-020: 必須キーワードと誤起動防止を明記

4. **permissions整合性の確保**
   - TASK-002でGitHub/Serenaの権限設定を確認・更新
   - RISK-003として明記

**Should Fix対応**:
1. **タスクの完了条件を具体化**
   - 全タスクの完了条件を観測可能な形式に変更

2. **Skill発見性のチューニング具体化**
   - TASK-020で必須キーワードセットを定義
   - TEST-011でネガティブケースを追加

3. **作成物の責務境界を明確化**
   - Phase 2のタスク説明に「頻出操作はSKILL.md、全ツールはREFERENCE.md」を追記

**Nice to Have対応**:
1. **gitignore確認タスク追加**
   - TASK-003として追加

2. **SKILL.mdの行数目安**
   - CON-001で500行以下の制約を維持（既存）

**その他の変更**:
- テスト計画を拡充（TEST-001〜011）
- 成功基準をPhase別に整理
- リスクと対策を8項目に拡充
- 次のアクションをPhase 0起点に更新
- 変更履歴セクション（本セクション）を追加

### v1（初版）- 2025年12月15日

**作成**: Plan Creator エージェント

**内容**:
- Claude Code Skills導入によるトークン消費削減プランの初版作成
- 4フェーズ（基盤構築、MCP Skills化、ワークフロー Skills化、検証と最適化）で構成
- 7つのSkills実装を計画（microsoft-docs-search, code-examples-search, github-operations, semantic-code-analysis, planning-workflow, document-workflow, review-workflow）

---
*このプランは Plan Creator エージェントによって作成されました*
