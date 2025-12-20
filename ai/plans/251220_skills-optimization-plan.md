# Skills 最適化・精度向上プラン

作成日: 2025年12月20日
ステータス: Draft
バージョン: 1.0

## 1. 概要

### 目的

公式ドキュメントのベストプラクティスに基づいて、`.claude/skills` を評価し、精度向上と最適化を実現する。

### スコープ

- **対象**: `.claude/skills` 配下の全スキル（6スキル）
- **参照ドキュメント**:
  - [Claude Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  - [Claude Skills公式リポジトリ](https://github.com/anthropics/skills)
  - [Agent Skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
  - [Creating custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)

### 前提条件

- 既存のスキルが正常に動作していること
- 公式ドキュメントの理解

## 2. 現状評価

### 全体的な評価

| 評価項目 | 現状 | スコア |
|---------|------|--------|
| **Description 品質** | 全スキルで具体的なトリガーワード付き | ⭐⭐⭐⭐⭐ |
| **Progressive Disclosure** | 2/6スキルで実装済み | ⭐⭐⭐ |
| **allowed-tools 活用** | 全スキルで適切に使用 | ⭐⭐⭐⭐⭐ |
| **Naming 規約** | gerund形式を概ね遵守 | ⭐⭐⭐⭐ |
| **Conciseness** | 一部スキルで改善余地あり | ⭐⭐⭐⭐ |
| **Examples パターン** | 統一感が不足 | ⭐⭐⭐ |

### スキル別評価

#### 1. gh-pr-viewing (91行)

**強み**:
- ✅ 簡潔で明確なDescription
- ✅ allowed-toolsで読み取り専用を実現
- ✅ シンプルで理解しやすい

**改善余地**:
- 🔶 Examplesが会話形式（入出力形式への変更推奨）
- 🔶 フィードバックループの欠如

#### 2. gh-issue-managing (118行)

**強み**:
- ✅ gerund形式のnaming
- ✅ 具体的なDescription
- ✅ allowed-toolsで適切な権限管理

**改善余地**:
- 🔶 Examplesパターンの改善
- 🔶 バリデーションステップの追加

#### 3. doc-writing (154行)

**強み**:
- ✅ 明確な5ステップワークフロー
- ✅ allowed-toolsで適切な権限管理
- ✅ 構造化された説明

**改善余地**:
- 🔶 Progressive Disclosure適用の検討
- 🔶 Examplesパターンの改善

#### 4. pr-reviewing (218行)

**強み**:
- ✅ Progressive Disclosure実装済み
- ✅ 5段階ワークフロー
- ✅ 自己検証チェックリスト
- ✅ allowed-toolsで適切な権限管理

**改善余地**:
- 🔶 SKILL.mdをさらに簡潔化（現在218行 → 目標150行以下）
- 🔶 ガイドラインファイルにTable of Contentsを追加

#### 5. plan-creating (246行)

**強み**:
- ✅ Progressive Disclosure実装済み
- ✅ 品質チェックリスト
- ✅ 時間推定を削除済み
- ✅ gerund形式のnaming

**改善余地**:
- 🔶 SKILL.mdをさらに簡潔化（現在246行 → 目標150行以下）
- 🔶 ワークフローファイルにTable of Contentsを追加

#### 6. claude-md-suggesting (113行)

**強み**:
- ✅ シンプルで簡潔
- ✅ 具体的なDescription
- ✅ gerund形式のnaming

**改善余地**:
- 🔶 Examplesパターンの改善

## 3. 公式ベストプラクティスとのギャップ

### ギャップ分析

| ベストプラクティス | 現状 | ギャップ |
|------------------|------|---------|
| **Concise is key** | 一部スキルで冗長性あり | 中 |
| **Third-person Description** | 全スキルで遵守 | なし |
| **Progressive Disclosure** | 2/6で実装 | 大 |
| **Workflows with checklists** | 実装済み | なし |
| **Gerund naming** | 概ね遵守 | 小 |
| **One-level references** | 遵守 | なし |
| **Examples pattern** | 統一感不足 | 中 |
| **Feedback loops** | 一部スキルのみ | 中 |
| **No time estimates** | 遵守 | なし |
| **Table of Contents** | 長いファイルに未適用 | 中 |

## 4. 改善プラン

### Phase 0: 評価の先行整備（ベースライン作成）

公式推奨（Evaluation-driven / Build evaluations first）に合わせ、ドキュメント/分割/簡潔化の前に最小限の評価シナリオを作成してベースラインを確立する。

#### 0.1 評価シナリオの作成（最小）

**対象（優先順）**:
- `pr-reviewing`
- `plan-creating`

**内容**:
- 各スキルにつきまず1シナリオを作成（最小セット）
- 期待挙動（expected_behavior）と成功条件（success_criteria）を明文化
- 改善前のベースライン結果を記録（何が不足し、どこで迷うか）

**出力先**:
- `.claude/skills/<skill>/evaluations/scenario-1.json`
- ベースラインメモ: `ai/review-validations/` 配下（1シナリオ1ファイルで簡潔に）

#### 0.2 改善ごとの再評価（回帰検知）

- Phase 1〜2 の各変更後に、該当スキルのシナリオを再実行し、ベースラインとの差分を確認
- 劣化があれば、変更を戻す/指示を補強する（Feedback loopとして運用）

### Phase 1: 緊急度高（即座に実施）

#### 1.1 Examplesパターンの統一

**対象**: 全スキル

**変更内容**:
```markdown
<!-- 現在（会話形式） -->
**例1: 現在のリポジトリのオープンPRを一覧表示**
```
User: "オープンしているPRを教えて"
Assistant: gh pr list を実行してPR一覧を表示
```

<!-- 推奨（入出力形式） -->
**例1: PR一覧の表示**

入力:
```
"Show me all open pull requests"
```

実行:
```bash
gh pr list
```

出力:
```
#42  Fix authentication bug  feature-auth  2 days ago
#41  Update README          docs-update   1 week ago
```
```

**効果**:
- 具体的な入出力が明確になる
- 実際の使用方法がイメージしやすい
- 公式ベストプラクティスに準拠

#### 1.2 Table of Contentsの追加

**対象**:
- **100行以上の参照ファイル（実測）**

※ 公式推奨は「100行を超える参照ファイルにToC」。本リポジトリでは、まず対象ファイルを実測で棚卸ししてから適用する。

**手順**:
1. `.claude/skills/` 配下で 100行以上の `.md` を特定
2. 対象ファイル冒頭に ToC を追加

**変更内容**:
各ファイルの冒頭に目次を追加

```markdown
# Code Quality Guidelines

## Contents
- Readability and maintainability
- Code organization
- Error handling patterns
- Documentation standards
- Common anti-patterns

## Readability and maintainability
...
```

**効果**:
- Claudeがファイル全体の構造を把握しやすくなる
- 部分的な読み取り（head -100）でも全体像を理解できる

### Phase 2: 重要度高（1週間以内に実施）

#### 2.1 SKILL.mdの簡潔化

**対象**: `pr-reviewing`, `plan-creating`

**目標**:
- pr-reviewing: 218行 → 150行以下
- plan-creating: 246行 → 150行以下

**アプローチ**:
1. **冗長な説明を削除**: Claudeが既に知っている情報を削除
2. **詳細を別ファイルに移動**: 具体的な実装例やTips
3. **表形式を活用**: 繰り返しの説明を表にまとめる

**分割の型（推奨）**:
- `SKILL.md`: 概要、ワークフローの骨子、参照リンク（ナビゲーション）
- `EXAMPLES.md`: 入出力例（Examples pattern）
- `REFERENCE.md`: コマンド例、判断基準、補助情報（例: PR番号抽出ロジック）

**参照ルール**:
- 参照は **SKILL.md から1階層のみ（one-level deep）** に限定（入れ子参照を避ける）

**例（pr-reviewing）**:
```markdown
<!-- Before: 詳細な説明（30行） -->
### エビデンスベースのフィードバック

すべての指摘にはエビデンスを含める（目標: 80%以上）:
- **公式ドキュメントURL**: WebFetch検索結果
- **コード例**: 推奨される実装パターン
- **影響範囲**: Grep分析結果

**フィードバック形式**:
```markdown
**[ファイル名:行番号]** 指摘内容
...（詳細な説明が続く）
```

<!-- After: 簡潔な説明 + 参照（5行） -->
### エビデンスベースのフィードバック

全指摘の80%以上にエビデンス（公式ドキュメント、コード例、影響範囲）を付与。

詳細なフィードバック形式は [templates/review-template.md](templates/review-template.md) を参照。
```

#### 2.2 Progressive Disclosureの適用拡大

**対象**: `doc-writing`（現在154行）

**判断基準**:
- 150行を超えるスキル
- 複数の独立したワークフローを持つスキル
- 詳細なガイドラインを含むスキル

**doc-writing への適用**:

```
doc-writing/
├── SKILL.md (メインファイル: 80行目標)
├── workflows/
│   ├── tutorial.md (チュートリアル作成ワークフロー)
│   ├── reference.md (リファレンス作成ワークフロー)
│   └── guide.md (ガイド作成ワークフロー)
└── templates/
    └── document-template.md
```

**効果**:
- SKILL.mdが簡潔になる
- ワークフロー別に情報が整理される
- Claudeが必要な情報のみをロードできる

#### 2.3 Feedback Loopsの追加

**対象**: `gh-issue-managing`, `doc-writing`

**変更内容**:

**gh-issue-managing への追加**:
```markdown
## Issue作成ワークフロー

1. Issue内容を作成
2. **検証**: タイトル、本文、ラベルが適切か確認
3. 問題がある場合:
   - タイトルが不明確 → 修正
   - 本文が不足 → 追加
   - ラベルが不適切 → 変更
4. **検証が通過したら実行**: `gh issue create`
5. 作成されたIssueのURLを確認
```

**doc-writing への追加**:
```markdown
## ドキュメント作成ワークフロー

...（既存のステップ）

5. 執筆・レビュー
   - ドラフトを作成（`Write`または`Edit`）
   - **自己レビュー**:
     - 技術的正確性を確認
     - 読みやすさを確認
     - コード例が実行可能か確認
   - 問題がある場合: Step 3（情報収集）に戻る
   - **レビュー通過後**: ドキュメントを保存
```

**効果**:
- エラーの早期発見
- 出力品質の向上
- 公式ベストプラクティスに準拠

### Phase 3: 改善提案（中長期的に実施）

#### 3.1 評価の拡充（最小→標準へ）

**目的**: スキルの効果を測定し、継続的な改善を実現

**対象**: 全スキル

**実装内容**:

Phase 0 の最小セット（各スキル1シナリオ）を出発点に、標準セット（各スキル3シナリオ）へ拡充する。

各スキルディレクトリに `evaluations/` フォルダを追加:

```
pr-reviewing/
├── SKILL.md
├── guidelines/
├── templates/
└── evaluations/
    ├── scenario-1.json
    ├── scenario-2.json
    └── scenario-3.json
```

**評価ファイル形式**:
```json
{
  "skills": ["pr-reviewing"],
  "query": "Review PR #123 focusing on security and code quality",
  "files": ["test-files/sample-pr.diff"],
  "expected_behavior": [
    "Reads PR details using gh pr view",
    "Analyzes code changes using gh pr diff",
    "Identifies security vulnerabilities with evidence from official docs",
    "Provides code quality feedback with specific file:line references",
    "Saves review result to ai/reviews/ directory"
  ],
  "success_criteria": [
    "All 5 phases completed",
    "Evidence provided for 80%+ of findings",
    "Security issues marked as high priority"
  ]
}
```

**評価方法**:
1. 定期的に評価シナリオを実行（週次/月次）
2. success_criteriaの達成率を測定
3. 未達成の項目を特定し、スキルを改善

**効果**:
- データドリブンな改善
- スキルの品質保証
- 継続的な最適化

#### 3.2 Description の最適化

**対象**: 全スキル

**現状の良好な例**:
```yaml
description: PRレビューの専門スキル。5段階レビュープロセス（初期分析→詳細分析→ベストプラクティス参照→統合評価→品質検証）でコード品質・セキュリティ・パフォーマンスを評価。
```

**さらなる改善案**:

トリガーワードをより具体的に追加:

```yaml
# gh-pr-viewing の改善案
description: GitHub Pull Requestsを参照・レビューする。gh CLIでPR一覧、詳細、差分を表示する。PRレビュー、コード変更確認、pull request、PR番号、コードレビュー、変更内容の確認が必要な際に使用する。

# doc-writing の改善案
description: ドキュメント作成・更新の専門スキル。技術文書、README、ガイド、チュートリアル、APIリファレンスの執筆を担当。目的確認→既存確認→情報収集→執筆→レビューの5ステップワークフロー。ドキュメント作成、README更新、マニュアル作成が必要な際に使用する。
```

**効果**:
- スキル発見率の向上
- より多様なクエリに対応
- ユーザー体験の改善

#### 3.3 クロスリファレンスの強化

**目的**: 関連スキル間の連携を明確化

**実装内容**:

各SKILL.mdに関連スキルのセクションを追加:

```markdown
## Related Skills

- **gh-pr-viewing**: PR情報の参照に使用（レビュー前のPR確認）
- **doc-writing**: レビュー結果のドキュメント化に使用
- **plan-creating**: レビューで発見した改善のプラン作成に使用

## Workflow Integration（参考）

1. `gh-pr-viewing` でPR情報を取得
2. `pr-reviewing` でレビューを実施
3. `doc-writing` でレビュー結果を整形（必要に応じて）
```

**注意**:
- Skillsは相互参照を“実行上の前提”にはできないため、ここはあくまで人間向けの運用メモとして簡潔に保つ

**効果**:
- スキル間の連携が明確になる
- ワークフロー全体の理解が容易になる
- Claudeが適切なスキルの組み合わせを選択しやすくなる

## 5. 実装スケジュール

### Week 1: Phase 1（緊急度高）

| タスク | 工数 | 担当 | 完了条件 |
|--------|------|------|----------|
| 評価シナリオ（最小）作成 | 2時間 | Dev | `pr-reviewing`/`plan-creating`に各1シナリオ＋ベースライン記録 |
| Examples パターン統一（全スキル） | 4時間 | Dev | 全スキルで入出力形式を採用 |
| Table of Contents 追加 | 2時間 | Dev | 100行以上のファイル（実測）に目次追加 |

### Week 2: Phase 2（重要度高）

| タスク | 工数 | 担当 | 完了条件 |
|--------|------|------|----------|
| pr-reviewing 簡潔化 | 3時間 | Dev | 150行以下に削減 |
| plan-creating 簡潔化 | 3時間 | Dev | 150行以下に削減 |
| doc-writing Progressive Disclosure 適用 | 4時間 | Dev | ワークフロー分離完了 |
| Feedback Loops 追加 | 2時間 | Dev | 2スキルに追加 |

### Week 3-4: Phase 3（改善提案）

| タスク | 工数 | 担当 | 完了条件 |
|--------|------|------|----------|
| 評価拡充 | 6時間 | Dev | 各スキルに3シナリオ作成 |
| Description 最適化 | 2時間 | Dev | 全スキルのDescription更新 |
| クロスリファレンス強化 | 3時間 | Dev | 関連スキルセクション追加 |

## 6. 成功基準

### 定量的指標

| 指標 | 現状 | 目標 | 測定方法 |
|------|------|------|----------|
| **SKILL.md平均行数** | 157行 | 120行以下 | ファイル行数カウント |
| **Progressive Disclosure適用率** | 33% (2/6) | 適用対象に対して100% | 適用対象スキルの実装状況確認 |
| **Examples統一率** | 0% | 100% | パターン確認 |
| **Feedback Loops適用率** | 50% (3/6) | 100% (6/6) | ワークフロー確認 |
| **Table of Contents適用率** | 0% | 100% | 100行以上ファイル（実測）確認 |
| **評価シナリオ数** | 0 | 段階目標（最小→標準） | evaluations/カウント |

**適用対象の定義（Progressive Disclosure）**:
- 150行超、または複数ドメイン/複数ワークフローを持ち、SKILL.mdが肥大化しやすいスキル
- 小規模スキルは「SKILL.mdを簡潔に維持し、必要になってから分割」を優先

**評価シナリオ数の段階目標**:
- 最小: 2（`pr-reviewing`/`plan-creating` 各1）
- 標準: 18（全6スキル × 3）

### 定性的指標

- [ ] すべてのスキルが公式ベストプラクティスに準拠
- [ ] スキル発見率の向上（ユーザーフィードバック）
- [ ] スキル実行精度の向上（エラー率低下）
- [ ] ドキュメントの一貫性と読みやすさの向上

## 7. リスクと対策

| リスク | 影響度 | 確率 | 対策 |
|--------|--------|------|------|
| **Progressive Disclosure適用による複雑化** | 中 | 中 | 小規模スキルには適用しない |
| **SKILL.md簡潔化による情報不足** | 高 | 低 | 段階的に削減し、テストを実施 |
| **改善による意図しない劣化（回帰）** | 中 | 中 | Phase 0で評価ベースラインを作成し、変更後に再評価 |
| **評価システムの維持コスト** | 中 | 高 | 自動化ツールの検討 |
| **クロスリファレンスの冗長性** | 低 | 中 | 関連性の高いスキルのみ記載 |

## 8. 次のアクション

### 即座に実施

0. **評価シナリオ（最小）を先に作成**
   - `pr-reviewing` と `plan-creating` に各1シナリオ
   - ベースライン結果を `ai/review-validations/` に記録

1. **Examples パターン統一の開始**
   - gh-pr-viewing から着手
   - 入出力形式のテンプレートを作成
   - 他のスキルに展開

2. **Table of Contents 追加**
   - 100行以上のファイルを特定（実測）
   - 目次フォーマットを統一
   - 全ファイルに適用

### 1週間以内に実施

3. **pr-reviewing の簡潔化**
   - 冗長な説明を特定
   - 詳細を別ファイルに移動
   - 150行以下に削減

4. **plan-creating の簡潔化**
   - 同様のアプローチ
   - 150行以下に削減

5. **doc-writing への Progressive Disclosure 適用**
   - ワークフロー別にファイルを分離
   - SKILL.mdを80行目標に簡潔化

### 2週間以内に実施

6. **Feedback Loops の追加**
   - gh-issue-managing に追加
   - doc-writing に追加

7. **評価システムの設計**
   - 評価ファイル形式の確定
   - 最初のシナリオ作成（各スキル1つ）

## 9. 参考資料

### 公式ドキュメント

- [Claude Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Skills公式リポジトリ](https://github.com/anthropics/skills)
- [Agent Skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Creating custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)

### 主要な学び

1. **Concise is key**: トークンは公共財。Claudeが既に知っていることは説明しない
2. **Progressive Disclosure**: SKILL.mdは概要、詳細は別ファイルに
3. **Feedback Loops**: バリデーションループで品質を向上
4. **Examples Pattern**: 具体的な入出力例を示す
5. **Evaluation-Driven**: 評価ファイルを作成してから実装する

### 運用ポリシー（補足）

- `description` は「何をするか（what）＋いつ使うか（when）」を必ず含める
- 文字数制約は環境差があり得るため、**移植性を重視する場合は短め（例: 200文字程度）**を推奨し、詳細はSKILL.md本文へ寄せる

### ベストプラクティスチェックリスト

#### Core Quality
- [ ] Description は具体的でトリガーワード付き
- [ ] Description は "what" と "when" を含む
- [ ] SKILL.md本体は500行以下（理想は150行以下）
- [ ] 詳細は別ファイルに分離
- [ ] 時間推定を含まない
- [ ] 一貫した用語を使用
- [ ] 具体的な例を含む
- [ ] ファイル参照は1階層のみ
- [ ] Progressive Disclosure を適用
- [ ] 明確なワークフローを持つ

#### Code and Scripts
- [ ] スクリプトは問題を解決（Claudeに丸投げしない）
- [ ] 明確なエラーハンドリング
- [ ] マジックナンバーなし（すべての値に根拠）
- [ ] 必要なパッケージをリスト
- [ ] スクリプトに明確なドキュメント
- [ ] Windows形式のパスを使わない（常にスラッシュ）
- [ ] 重要な操作にバリデーション/検証ステップ
- [ ] 品質重視タスクにフィードバックループ

#### Testing
- [ ] 最低3つの評価シナリオを作成
- [ ] Haiku、Sonnet、Opusでテスト
- [ ] 実際の使用シナリオでテスト
- [ ] チームフィードバックを反映（該当する場合）

## 10. まとめ

本プランは `.claude/skills` の精度向上と最適化を目指し、公式ベストプラクティスに基づいた具体的な改善策を提示しています。

**主要な改善ポイント**:
1. Examples パターンの統一（入出力形式）
2. Progressive Disclosure の全体適用
3. SKILL.md の簡潔化（150行目標）
4. Feedback Loops の強化
5. 評価システムの導入

**期待される効果**:
- スキル発見率の向上
- 実行精度の向上
- トークン効率の改善
- ドキュメント品質の向上
- 継続的な改善の実現

実装は3つのPhaseに分けて段階的に進め、各Phaseで効果を測定しながら次のステップに進むことを推奨します。
