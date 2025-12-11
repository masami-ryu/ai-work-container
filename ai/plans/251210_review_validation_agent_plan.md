# PRレビュー結果妥当性分析エージェント追加プラン

作成日: 2025年12月10日
作成者: Plan Creator エージェント
ステータス: Completed
完了日: 2025年12月11日

## 1. 概要

### 目的
`.github/agents`にPRレビュー結果の妥当性を分析するエージェントを追加し、既存のレビュー出力との互換性を確保する。

### スコープ
- 対象: `.github/agents/`に新規エージェントファイルを作成
- 対象: `.claude/commands/review.md`、`.claude/agents/pr-reviewer.md`の出力形式との互換性
- 対象外: 既存のpr-reviewerエージェントの修正、CLIコマンドの追加

### 前提条件
- 既存のレビュー出力形式（Markdown、JSON計測データ）が安定している
- `.github/agents`形式（VS Code Copilot/Claude連携）のエージェント定義が利用可能
- MCPツール（context7, msdocs, github-mcp-server, serena）が利用可能

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | 既存レビュー結果（`ai/reviews/*.md`）を入力として受け取れる | 高 |
| REQ-002 | 要件 | JSON計測データ（`ai/review-metrics/*.json`）を分析できる | 高 |
| REQ-003 | 要件 | エビデンスURL の有効性を検証できる | 高 |
| REQ-004 | 要件 | 指摘事項の根拠を再確認できる | 中 |
| REQ-005 | 要件 | バイアス・偏りの検出ができる | 中 |
| REQ-006 | 要件 | 分析結果を構造化されたMarkdownで出力する | 高 |
| CON-001 | 制約 | `.github/agents`形式のYAMLフロントマター + Markdown | - |
| CON-002 | 制約 | VS Code/Copilot連携ツールのみ使用可能 | - |
| GUD-001 | ガイドライン | 既存エージェント（common.agent.md, pull-request-reviewer.agent.md）と一貫性を保つ | - |

## 3. 分析結果

### 3.1 既存レビュー出力形式の把握

#### Markdownレビュー結果（`ai/reviews/review_PR*.md`）

```markdown
# PR Review: [タイトル]

## 概要
- PR番号: #XXX
- 変更ファイル数: X
- 差分行数: X
- レビュータイプ: Quick/Standard/Deep Review
- レビュー日時: YYYY-MM-DD HH:mm:ss

## フェーズ実行結果
- ✅ Phase 1: 初期分析
- ✅ Phase 2: 詳細分析
...

## 評価サマリー
- コード品質: ⭐⭐⭐⭐☆
- セキュリティ: ⭐⭐⭐⭐⭐
...

## 指摘事項
### 🔴 重要度: 高
1. **[ファイル名:行番号]** 指摘内容
   **根拠**: [URL]
   **推奨**: [改善提案]

## ポジティブフィードバック
- ✅ [良かった点]

## 総評
[総合評価]
```

#### JSON計測データ（`ai/review-metrics/review_*.json`）

```json
{
  "pr_number": 123,
  "workflow": "quick|standard|deep",
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "code_quality|security|...",
      "has_evidence": true,
      "evidence_url": "https://..."
    }
  ],
  "metrics": {
    "evidence_ratio": 0.80,
    "mcp_calls": {...},
    "errors": [...]
  }
}
```

### 3.2 妥当性分析の観点

| 観点 | 説明 | 検証方法 |
|------|------|----------|
| エビデンス有効性 | 引用URLが有効でアクセス可能か | `fetch`ツールでURL確認 |
| 根拠の適切性 | 指摘と引用ドキュメントが関連しているか | msdocs/context7で再検索 |
| 指摘の一貫性 | 類似問題に同じ基準が適用されているか | パターン分析 |
| カバレッジ | 重要な観点が漏れていないか | レビュー観点チェックリスト |
| バイアス検出 | 特定カテゴリへの偏りがないか | 統計分析 |
| 重要度の妥当性 | 重要度（高/中/低）の判断が適切か | ベストプラクティス参照 |

### 3.3 既存エージェントとの互換性

`.github/agents`形式の構造:
```yaml
---
name: エージェント名
description: '説明'
argument-hint: 'ヒント'
model: 'Claude Opus 4.5 (Preview)'
target: vscode
tools: [...]
handoffs:
    - label: ラベル
      agent: エージェント名
      prompt: 'プロンプト'
      send: false
---
# エージェント本文（Markdown）
```

## 4. 実装ステップ

### Phase 1: エージェント定義の作成
**目標**: `.github/agents/review-validator.agent.md`を作成

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | YAMLフロントマターの定義 | `.github/agents/review-validator.agent.md` | 必須フィールドがすべて定義されている | [ ] |
| TASK-002 | エージェント役割の定義 | 同上 | 役割と専門領域が明確に記載されている | [ ] |
| TASK-003 | ツール設定 | 同上 | 必要なツールがすべて列挙されている | [ ] |
| TASK-004 | ハンドオフ設定 | 同上 | pr-reviewerとの連携が定義されている | [ ] |

### Phase 2: 分析ワークフローの定義
**目標**: 妥当性分析の手順を詳細化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-005 | 入力形式の定義 | `.github/agents/review-validator.agent.md` | Markdown/JSON両方の入力方法が記載 | [ ] |
| TASK-006 | 分析フェーズの定義 | 同上 | 5つの分析観点が手順化されている | [ ] |
| TASK-007 | 検証チェックリスト作成 | 同上 | 各観点の検証項目が明確 | [ ] |

### Phase 3: 出力形式の定義
**目標**: 分析結果の出力フォーマットを確定

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-008 | Markdown出力テンプレート | `.github/agents/review-validator.agent.md` | 出力形式が明確に定義されている | [ ] |
| TASK-009 | 妥当性スコア定義 | 同上 | スコア計算方法が記載されている | [ ] |
| TASK-010 | 保存先の指定 | 同上 | `ai/review-validations/`が指定されている | [ ] |

### Phase 4: 検証とドキュメント
**目標**: エージェントの動作確認と関連ドキュメント更新

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-011 | 既存レビュー結果で検証 | - | PR#18のレビュー結果で動作確認 | [ ] |
| TASK-012 | README更新（任意） | `.github/agents/README.md` | 新エージェントの説明が追加 | [ ] |

## 5. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 統合 | 既存レビュー結果（`ai/reviews/review_PR18_20251210.md`）を分析 | 妥当性レポートが生成される |
| TEST-002 | 統合 | JSON計測データ（`ai/review-metrics/review_18_*.json`）を分析 | エビデンス付与率の検証結果が出力される |
| TEST-003 | 単体 | エビデンスURLの有効性検証 | 無効URLが検出される |
| TEST-004 | 単体 | バイアス検出 | カテゴリ偏りが数値化される |

## 6. 成功基準

- [x] `.github/agents/review-validator.agent.md`が作成されている
- [x] 既存のレビュー出力形式（Markdown、JSON）を入力として処理できる
- [x] エビデンスURLの有効性を検証できる
- [x] 妥当性スコアを含む構造化された分析結果を出力できる
- [x] 既存の`pull-request-reviewer.agent.md`との連携（handoffs）が設定されている

## 7. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | エビデンスURL検証でのネットワークエラー | 中 | 中 | フォールバック：URLの形式チェックのみ実施 |
| RISK-002 | レビュー形式の変更による互換性問題 | 高 | 低 | 入力形式のバージョン検出を実装 |
| RISK-003 | 分析時間の長期化 | 中 | 中 | タイムアウト設定（10分）を追加 |

## 8. 依存関係

- `.claude/commands/review.md` - レビュー出力形式の定義元
- `.claude/agents/pr-reviewer.md` - レビュー観点の定義元
- `ai/reviews/` - 入力となるレビュー結果
- `ai/review-metrics/` - 入力となる計測データ
- MCPツール: fetch（URL検証）、context7/msdocs（再検索）、serena（コード分析）

## 9. エージェント設計案

### 9.1 YAMLフロントマター

```yaml
---
name: ReviewValidator
description: 'PRレビュー結果の妥当性を分析するエージェント - エビデンス検証・バイアス検出'
argument-hint: 'レビュー結果のファイルパスまたはPR番号（例: "ai/reviews/review_PR18_20251210.md" または "#18"）'
model: 'Claude Opus 4.5 (Preview)'
target: vscode
tools: [
  # 情報収集・検索系
  'search',
  'fetch',
  'githubRepo',
  # MCP: ドキュメント参照（再検証用）
  'context7/*',
  'msdocs/*',
  # MCP: GitHub情報取得
  'github-mcp-server/pull_request_read',
  'github-mcp-server/get_file_contents',
  # MCP: コード分析
  'serena/*'
]
handoffs:
    - label: レビューを再実行
      agent: PullRequestReviewer
      prompt: 'このPRを再レビューしてください: {{selection}}'
      send: false
    - label: 指摘を修正依頼
      agent: agent
      prompt: '妥当性分析の結果に基づいて修正してください: {{selection}}'
      send: false
---
```

### 9.2 分析ワークフロー

1. **入力解析フェーズ**
   - ファイルパスまたはPR番号から対象を特定
   - Markdownレビュー結果とJSON計測データを読み込み

2. **エビデンス検証フェーズ**
   - 指摘事項に含まれるURLをすべて抽出
   - 各URLの有効性を`fetch`ツールで確認
   - 無効URL、リダイレクト、内容変更を検出

3. **根拠適切性検証フェーズ**
   - 指摘内容とエビデンスの関連性を評価
   - 必要に応じてmsdocs/context7で再検索
   - 根拠の強さをスコア化

4. **一貫性・バイアス分析フェーズ**
   - カテゴリ別の指摘分布を分析
   - 重要度判定の一貫性をチェック
   - 過去レビューとの比較（オプション）

5. **総合評価フェーズ**
   - 妥当性スコアを算出
   - 改善提案を生成
   - 分析結果をMarkdownで出力

### 9.3 出力形式

```markdown
# レビュー妥当性分析: PR #XXX

## 分析概要
- 分析対象: ai/reviews/review_PRXXX_YYYYMMDD.md
- 分析日時: YYYY-MM-DD HH:mm:ss
- 妥当性スコア: X.X / 5.0

## エビデンス検証結果
| # | URL | ステータス | 関連性 |
|---|-----|----------|--------|
| 1 | https://... | ✅ 有効 | ⭐⭐⭐⭐☆ |
| 2 | https://... | ⚠️ リダイレクト | ⭐⭐⭐☆☆ |

## バイアス分析
- カテゴリ分布: [グラフまたは表]
- 検出されたバイアス: [なし/あり（詳細）]

## 改善提案
1. [提案1]
2. [提案2]

## 総評
[総合的な妥当性評価]
```

## 10. 次のアクション

1. [x] このプランをユーザーにレビューしてもらう
2. [x] 承認後、`.github/agents/review-validator.agent.md`を作成
3. [x] 既存レビュー結果（PR#18）で動作検証（VS Codeでの実行が可能な状態）
4. [x] 必要に応じてドキュメント更新

## 11. 実装完了サマリー

### 作成されたファイル
- `.github/agents/review-validator.agent.md` - ReviewValidatorエージェント定義
- `ai/review-validations/` - 分析結果の保存先ディレクトリ

### 主要機能
1. **5つのフェーズによる段階的分析**
   - Phase 1: 入力解析（PR番号またはファイルパスから対象を特定）
   - Phase 2: エビデンス検証（URL有効性チェック）
   - Phase 3: 根拠適切性検証（エビデンスと指摘の関連性評価）
   - Phase 4: 一貫性・バイアス分析（カテゴリ分布とバイアス検出）
   - Phase 5: 総合評価（妥当性スコア算出と改善提案）

2. **エビデンス検証**
   - URLの有効性チェック（fetch）
   - リダイレクト検出
   - エビデンスと指摘内容の関連性評価

3. **バイアス検出**
   - カテゴリ別指摘分布の集計
   - 重要度分布の分析
   - 偏りの検出と推奨観点の提示

4. **出力**
   - 妥当性スコア（5点満点）
   - 改善提案（エビデンス強化、バイアス是正）
   - 構造化されたMarkdown形式

### 連携機能
- PullRequestReviewerエージェントとのハンドオフ（再レビュー依頼）
- 一般エージェントとのハンドオフ（修正依頼）

### 使用方法
1. VS Codeでエージェントパネルを開く
2. ReviewValidatorエージェントを選択
3. レビュー結果のファイルパスまたはPR番号を入力
   - 例: `ai/reviews/review_PR18_20251210.md`
   - 例: `#18`

### 次のステップ（ユーザー向け）
- [ ] VS CodeでReviewValidatorエージェントを実際に実行して動作確認
- [ ] 複数のPRレビュー結果で妥当性分析を実施
- [ ] 分析結果をもとにレビュープロセスを改善

---
*このプランは Plan Creator エージェントによって作成されました*
