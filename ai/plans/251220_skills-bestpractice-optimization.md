# Agent Skills 精度向上・最適化プラン

## エグゼクティブサマリー

本プランは、Agent Skills Best Practices に基づいた `.claude/skills` の精度向上と最適化を目的としています。全7スキルの包括的調査を実施し、優先度付けされた改善項目を特定しました。

**現状評価**: すべてのスキルが基本要件（行数制限、description品質、allowed-tools）を満たしているが、Progressive Disclosure と評価駆動開発の観点で改善余地があります。

**期待効果**:
- スキル実行精度の向上（特に gh-issue-managing と claude-md-suggesting）
- 保守性の向上（参照構造の明確化）
- 品質保証の強化（評価シナリオによる継続的検証）

---

## 調査結果サマリー

### スキル構成現状

| スキル | 行数 | Progressive Disclosure | 評価 | 優先改善度 |
|--------|------|----------------------|------|----------|
| **gh-issue-managing** | 187行 | ✗ なし | なし | **高** |
| **claude-md-suggesting** | 165行 | ✗ なし | なし | **高** |
| **plan-creating** | 135行 | △ templates空 | 1シナリオ | **中** |
| **doc-writing** | 154行 | △ 限定的 | なし | **中** |
| **pr-reviewing** | 159行 | ✓ 優良 | 1シナリオ | 低 |
| gh-pr-viewing | 145行 | - (シンプル) | なし | 低 |
| skills-bestpractice-investigating | 72行 | ✓ | なし | 低 |

### ベストプラクティス適合度

| 項目 | 適合スキル数 | 詳細 |
|------|-----------|------|
| 行数制限 (500行以内) | 7/7 ✓ | すべて適合 |
| Description品質 | 7/7 ✓ | 三人称、トリガーワード完備 |
| allowed-tools適切性 | 7/7 ✓ | スコープに応じた設定 |
| Progressive Disclosure | 2/7 ✗ | pr-reviewing, plan-creating のみ |
| 評価シナリオ (3つ以上) | 0/7 ✗ | 最大でも1シナリオのみ |
| ワークフロー設計 | 4/7 △ | 形式が統一されていない |

---

## 改善プラン: 優先度別

## 優先度: 最高（実装前の基盤整備）

### 0. Progressive Disclosure とシナリオ評価の設計規約確定

**目的**: Phase 1 実装時の判断基準を統一し、実装のブレを防ぐ

**確定すべき規約**:

#### 0-1. Progressive Disclosure のリンク規約
```markdown
# SKILL.md からリンク可能なディレクトリ（これ以外は禁止）
- guidelines/   # ガイドライン・ベストプラクティス
- examples/     # 良い例・悪い例
- templates/    # テンプレート
- workflows/    # ワークフロー定義（複雑なスキルのみ）
- evaluations/  # 評価シナリオ

# 参照ファイルのルール
- 参照は1階層のみ（SKILL.md → reference.md のみ、reference.md → details.md は禁止）
- 参照ファイルの上限: 150行（超える場合は同ファイル内TOCで対処、分割しない）
- 相対リンクは Skills配下の相対パスで統一（例: `guidelines/style-guide.md`）
- 100行以上のファイルには必ず TOC を追加
```

#### 0-2. 評価シナリオのファイル形式（既存資産に適合）
```markdown
# 評価シナリオは2層構造で管理
.claude/skills/<skill>/evaluations/scenario-N.json  # 入力仕様（query, expected_behavior, success_criteria）
ai/review-validations/<skill>-scenario-N-baseline.md # ベースライン結果（改善前の評価）
ai/review-validations/<skill>-scenario-N-improved.md # 改善後の評価（実装後に追加）

# scenario-N.json の必須フィールド
{
  "skills": ["<skill-name>"],
  "query": "ユーザーからの入力プロンプト",
  "expected_behavior": ["期待挙動1", "期待挙動2", ...],
  "success_criteria": ["合格基準1", "合格基準2", ...],
  "negative_example": "NG例（1つ）"  # 新規追加
}

# baseline.md の必須セクション
- 評価シナリオ概要
- ベースライン結果（改善前）
  - 現在の強み
  - 改善が必要な点
  - 想定される問題点
- 次回評価での確認事項
```

#### 0-3. SKILL.md 分割の条件付きトリガー（絶対値目標から変更）
```markdown
# 分割すべき条件（いずれか該当）
- SKILL.md が 150行を超える
- Guidelines/Examples が肥大化して目的別検索が困難
- ワークフローが複雑で段階的提示が必要（plan-creating, pr-reviewing など）

# 分割後の目標（参考値、厳密な上限ではない）
- SKILL.md: 120〜160行程度
- 優先順位: "短くする" < "目的別に探しやすくする"
```

**作業内容**:
1. 上記規約を `ai/guidelines/skills-structure-rules.md` として文書化
2. 既存スキル（plan-creating, pr-reviewing）が規約に適合しているか検証
3. 不適合箇所があれば Phase 1 で修正

**期待効果**: 実装時の迷いを排除、一貫性のある構造、保守性の向上

**根拠**: レビュー指摘 3.1, 3.2, 3.3 - "既存資産との整合"、"条件付きトリガー"、"リンク規約の事前固定"

---

## 優先度: 高

### 1. gh-issue-managing の Progressive Disclosure 実装

**現状**: 187行で最も長いが、参照ファイル構造なし

**分割トリガー判定**: ✅ 150行超 + CLIコマンド中心でシンプル → 適度な分割のみ

**改善内容**:
```
gh-issue-managing/
├── SKILL.md (概要とナビゲーション、目標: 120-140行程度）
├── guidelines/
│   ├── issue-best-practices.md  # Issue作成・更新のベストプラクティス（判定基準付き）
│   └── label-management.md      # ラベル運用ガイドライン
└── examples/
    ├── good-bad-examples.md     # 良い例・悪い例（チェック観点セット）
```

**作業内容**:
1. SKILL.md から詳細ガイドラインを guidelines/ に分離
2. 良い例・悪い例を examples/ に集約し、チェック観点を同ファイル内に記載
3. SKILL.md を概要とナビゲーションに簡素化
4. 各参照ファイルに TOC を追加（100行超える場合）

**期待効果**: 実行精度の向上、Issue作成品質の標準化

**根拠**: BP - "SKILL.md本文は500行以内、超える場合は参照ファイルに分割"、"ドメイン別に整理" / レビュー 4.3 - "例示に判定基準をセット"

---

### 2. claude-md-suggesting の Progressive Disclosure 実装

**現状**: 165行で参照ファイルなし、内容が密集

**分割トリガー判定**: ✅ 150行超 + 提案基準が詳細 → 分割が有効

**改善内容**:
```
claude-md-suggesting/
├── SKILL.md (概要とワークフロー、目標: 100-120行程度）
├── guidelines/
│   ├── suggestion-criteria.md  # 提案基準の詳細（チェックポイント形式）
│   └── quality-checklist.md    # 品質チェックリスト
└── examples/
    ├── good-bad-examples.md    # 良い提案例・悪い提案例（判定基準付き）
```

**作業内容**:
1. SKILL.md から提案基準の詳細を guidelines/ に分離
2. 良い提案例・悪い提案例を examples/ に集約し、判定チェックリストを併記
3. SKILL.md を5ステップワークフローとナビゲーションに簡素化
4. 各ガイドラインに「チェックポイント」形式を導入

**期待効果**: 提案品質の向上、一貫性の確保

**根拠**: BP - "100行以上のファイルには段階的開示を検討"、"例示パターン" / レビュー 4.3

---

### 3. 全スキルへの評価シナリオ追加（最低3つ、2層構造）

**現状**: pr-reviewing と plan-creating に1シナリオのみ（`.json` + `.md`）、他は評価なし

**改善内容**: 各スキルに `evaluations/scenario-N.json` + `ai/review-validations/<skill>-scenario-N-baseline.md` を追加

**スキル別シナリオ例**:

**gh-issue-managing**:
1. バグ報告 Issue の作成と検証
2. 既存 Issue の状態更新とラベル付け
3. Issue 一覧の検索とフィルタリング

**claude-md-suggesting**:
1. 新機能追加後のセクション提案
2. 技術スタック変更時の更新提案
3. ワークフロー改善後のドキュメント整合性チェック

**doc-writing**:
1. 技術ドキュメントの新規作成
2. 既存 README の構造化リファクタリング
3. API ドキュメントの段階的詳細化

**gh-pr-viewing**:
1. PR の差分確認とサマリー生成
2. 複数 PR の比較と優先度判断
3. PR コメントの確認と次アクション特定

**plan-creating**:
1. Express プラン（シンプルなタスク）（既存 scenario-1 を拡充）
2. Standard プラン（中規模の機能追加）
3. Comprehensive プラン（アーキテクチャ変更）

**pr-reviewing**:
1. セキュリティ重視レビュー（既存 scenario-1 を拡充）
2. パフォーマンス重視レビュー
3. コード品質重視レビュー

**作業内容**:
1. 各スキルの `evaluations/` に `scenario-N.json` を追加（N=1,2,3）
2. 各 `.json` に `negative_example` フィールドを追加（NG例1つ）
3. `ai/review-validations/<skill>-scenario-N-baseline.md` を追加
4. 既存の scenario-1 に `negative_example` を追加

**期待効果**: 継続的な品質保証、リグレッション検出、改善効果の測定可能化

**根拠**: BP - "評価駆動開発: 最低3つの評価シナリオ、代表的なユースケースをカバー" / レビュー 3.1, 5 - "2層構造"、"NG例必須化"

---

## 優先度: 中

### 4. plan-creating の templates 整合性修正（重複回避）

**現状**: `templates/` ディレクトリが空、SKILL.md 内で `ai/templates/plan-template.md` を参照

**問題**: `ai/templates/plan-template.md` がすでに存在し、スキル内に別テンプレートを作ると重複・不整合リスク

**改善方針（オプション B 採用）**:
- `templates/` ディレクトリを削除
- SKILL.md 内で「プロジェクトの `ai/templates/plan-template.md` を参照」と明記
- 各ワークフロー（Express/Standard/Comprehensive）の差分のみを workflows/*.md 内に記載

**理由**:
- テンプレートの二重管理を回避
- `ai/templates/plan-template.md` が Single Source of Truth として機能
- ワークフロー差分は workflows/ 内で十分対応可能

**作業内容**:
1. `templates/` ディレクトリを削除
2. SKILL.md の参照を明確化（"`ai/templates/plan-template.md` を基本テンプレートとして使用"）
3. workflows/*.md に各ワークフローの特有要素を記載（テンプレート全体ではなく差分のみ）

**期待効果**: 参照整合性の向上、テンプレート二重管理の回避、保守性向上

**根拠**: BP - "SKILL.md から直接参照、参照の参照を作らない" / レビュー 4.2 - "重複回避、一本化"

---

### 5. doc-writing の Progressive Disclosure 拡充

**現状**: `templates/structure.md` のみで、ガイドライン不足

**改善内容**:
```
doc-writing/
├── SKILL.md (概要とワークフロー、目標: 80-100行)
├── guidelines/
│   ├── style-guide.md        # 文体・トーンのガイドライン
│   ├── structure-patterns.md # ドキュメント種別の構造パターン
│   └── examples.md           # 良い例・悪い例
└── templates/
    ├── structure.md (既存)
    ├── readme-template.md
    ├── api-doc-template.md
    └── tutorial-template.md
```

**作業内容**:
1. SKILL.md からスタイルガイドを guidelines/ に分離
2. ドキュメント種別のテンプレートを追加（README, API, Tutorial）
3. 良い例・悪い例を guidelines/examples.md に集約
4. SKILL.md を5ステップワークフローとナビゲーションに簡素化

**期待効果**: ドキュメント品質の標準化、一貫性の向上

**根拠**: BP - "ドメイン別に整理"、"例示パターン"

---

### 6. ワークフロー設計の標準化（複雑系スキル優先）

**現状**: 各スキルで記述形式が異なる（テキスト説明、テーブル、別ファイルなど）

**改善内容**: 複雑なワークフローを持つスキルのみチェックリスト形式に統一

**標準テンプレート**:
```markdown
## [タスク名] ワークフロー

このチェックリストをコピーして進捗を追跡してください:

```
[タスク名] 進捗:
- [ ] Step 1: [アクション]
- [ ] Step 2: [アクション]
- [ ] Step 3: [アクション]
- [ ] Step 4: [アクション]
- [ ] Step 5: [検証]
```

**Step 1: [アクション]**
[具体的な指示とチェックポイント]

**Step 2: [アクション]**
[具体的な指示とチェックポイント]

...

**Step 5: [検証]**
[検証項目と合格基準]
```

**優先対象スキル（複雑系のみ）**:
- plan-creating: 各ワークフローをチェックリスト化
- pr-reviewing: 5段階レビューをチェックリスト化
- doc-writing: 既存ワークフローをチェックリスト化
- claude-md-suggesting: 5ステップワークフローをチェックリスト化

**対象外（シンプルで現状十分）**:
- gh-pr-viewing: CLIコマンド中心でシンプル
- gh-issue-managing: CLIコマンド中心でシンプル
- skills-bestpractice-investigating: 調査型でワークフロー不要

**期待効果**: Claude が進捗を追跡しやすくなり、ステップの抜け漏れを防止（過度なテンプレ化は回避）

**根拠**: BP - "複雑なタスクには、Claude がコピーしてチェックできるワークフローを提供" / レビュー 4.1 - "複雑系スキル優先、gh-*は必要なら程度"

---

## 優先度: 低

### 7. フィードバックループの追加

**現状**: doc-writing に自己レビューステップがあるが、他のスキルには明示的なループなし

**改善対象スキル**: pr-reviewing, plan-creating

**pr-reviewing への追加**:
```markdown
## レビュープロセス

1. レビューコメントを作成
2. **自己検証**: guidelines/feedback-format.md に従って形式チェック
3. 形式エラーがある場合:
   - エラー内容を確認
   - コメントを修正
   - 再度検証
4. **検証パス後のみ出力**
5. レビューサマリーを生成
```

**plan-creating への追加**:
```markdown
## プラン作成プロセス

1. 調査とプラン作成
2. **整合性検証**: テンプレートとの適合性チェック
3. 検証失敗時:
   - 不足セクションを特定
   - プランを補完
   - 再度検証
4. **検証パス後のみユーザーに提示**
```

**期待効果**: 品質の事前保証、エラー率の低減

**根拠**: BP - "フィードバックループパターン: 検証→修正→再検証のループを実装"

---

## 実装ロードマップ

### フェーズ 0: 基盤整備（優先度: 最高）

**対象**: Progressive Disclosure とシナリオ評価の設計規約確定

**成果物**:
- `ai/guidelines/skills-structure-rules.md` の作成
- 既存スキル（plan-creating, pr-reviewing）の規約適合性検証
- 不適合箇所の修正

**検証基準**:
- [ ] `ai/guidelines/skills-structure-rules.md` が存在し、3つの規約（リンク規約、評価シナリオ形式、分割トリガー）が明記されている
- [ ] 既存の scenario-1.json に `negative_example` フィールドが追加されている
- [ ] 既存の baseline.md が規約の必須セクションを満たしている
- [ ] plan-creating と pr-reviewing が規約に適合している（または適合するよう修正済み）

---

### フェーズ 1: 緊急対応（優先度: 高）

**対象**: gh-issue-managing, claude-md-suggesting, 評価シナリオ

**成果物**:
- gh-issue-managing の Progressive Disclosure 実装完了
- claude-md-suggesting の Progressive Disclosure 実装完了
- 全7スキルに3つ以上の評価シナリオ追加（2層構造）

**検証基準**:
- [ ] gh-issue-managing の SKILL.md が 120-140行程度
- [ ] claude-md-suggesting の SKILL.md が 100-120行程度
- [ ] 各スキルの evaluations/ に3つの `.json` ファイル存在
- [ ] 各スキルに3つの `ai/review-validations/<skill>-scenario-N-baseline.md` 存在
- [ ] 各 `.json` に `negative_example` フィールドが含まれている
- [ ] 各 baseline.md が規約の必須セクション（評価シナリオ概要、ベースライン結果、次回評価での確認事項）を満たしている
- [ ] 分割後の参照ファイルが100行超の場合、TOC が追加されている
- [ ] 良い例・悪い例に判定基準が併記されている

---

### フェーズ 2: 構造改善（優先度: 中）

**対象**: plan-creating, doc-writing, ワークフロー標準化（複雑系スキルのみ）

**成果物**:
- plan-creating の templates 整合性修正完了（重複回避）
- doc-writing の Progressive Disclosure 拡充完了
- 複雑系スキルのワークフローをチェックリスト形式に統一

**検証基準**:
- [ ] plan-creating/templates/ ディレクトリが削除されている
- [ ] plan-creating/SKILL.md が `ai/templates/plan-template.md` への参照を明記している
- [ ] workflows/*.md に各ワークフローの差分のみが記載されている（テンプレート全体ではない）
- [ ] doc-writing/guidelines/ に3つのガイドラインファイル存在
- [ ] 複雑系スキル（plan-creating, pr-reviewing, doc-writing, claude-md-suggesting）のワークフローがチェックリスト形式で記述されている
- [ ] シンプル系スキル（gh-*, skills-bestpractice-investigating）は現状維持
- [ ] 各ワークフローに検証ステップが含まれている

---

### フェーズ 3: 品質強化（優先度: 低）

**対象**: フィードバックループ追加

**成果物**:
- pr-reviewing と plan-creating にフィードバックループ実装

**検証基準**:
- [ ] pr-reviewing のワークフローに自己検証ステップ追加
- [ ] plan-creating のワークフロー整合性検証ステップ追加
- [ ] 各ループに明確な検証基準と修正手順が記載されている

---

## 成功指標

### 定量指標

| 指標 | 現状 | 目標 | 備考 |
|------|------|------|------|
| **基盤整備** ||||
| 設計規約文書化率 | 0% | 100% | `ai/guidelines/skills-structure-rules.md` 存在 |
| 既存スキルの規約適合率 | 不明 | 100% | plan-creating, pr-reviewing が適合 |
| **Progressive Disclosure** ||||
| 実装率（要分割スキルのみ） | 29% (2/7) | 100% (5/5) | gh-issue-managing, claude-md-suggesting, doc-writing, plan-creating, pr-reviewing |
| SKILL.md 平均行数 | 152行 | 120-150行 | 条件付きトリガー適用、絶対値目標ではない |
| 参照ファイルへのTOC追加率 | 不明 | 100% | 100行超のファイルすべて |
| **評価シナリオ** ||||
| 評価シナリオ保有率（3つ以上） | 0% (0/7) | 100% (7/7) | 各スキル3シナリオ |
| 2層構造適合率（.json + .md） | 100% (2/2) | 100% (7/7) | 既存資産に適合 |
| NG例含有率 | 0% (0/2) | 100% (21/21) | すべてのシナリオに `negative_example` |
| **ワークフロー標準化** ||||
| チェックリスト形式率（複雑系） | 0% (0/4) | 100% (4/4) | plan-creating, pr-reviewing, doc-writing, claude-md-suggesting |
| シンプル系スキルの現状維持率 | 100% (3/3) | 100% (3/3) | gh-*, skills-bestpractice-investigating |
| **フィードバックループ** ||||
| 実装率（該当スキルのみ） | 14% (1/7) | 43% (3/7) | doc-writing, pr-reviewing, plan-creating |

### 定性指標

- [ ] **実行精度の向上**: 特に gh-issue-managing と claude-md-suggesting での抜け漏れ減少
- [ ] **保守性の向上**: 新規メンバーがスキル構造を理解しやすい（規約文書が存在）
- [ ] **品質の安定化**: 評価シナリオによる継続的検証が可能（2層構造で運用しやすい）
- [ ] **一貫性の確保**: すべてのスキルが同じ設計原則に従う（規約適合率100%）
- [ ] **過度な細分化の回避**: 参照は1階層のみ、テンプレート重複なし

### 完了条件（追加）

各スキル実装完了時に以下を確認:
- [ ] **ナビゲーション**: 分割後の SKILL.md に「どこに何があるか（1段の目次）」が存在
- [ ] **整合性**: `allowed-tools` が分割後の運用に合っている（例: claude-md-suggesting は提案のみなので Write/Edit 不要）
- [ ] **評価シナリオ**: 各シナリオに「入力（query）」「期待アウトカム（expected_behavior）」「合格基準（success_criteria）」「NG例（negative_example）」が必須化されている

---

## リスクと対策

### リスク 1: 過度な細分化による複雑化

**リスク**: Progressive Disclosure を実装しすぎて、逆に参照構造が複雑になる

**対策**:
- 参照は1階層に限定（SKILL.md → reference.md のみ、reference.md → details.md は禁止）
- 各参照ファイルに TOC を付け、全体構造を把握可能にする
- 100行未満のスキルは無理に分割しない

### リスク 2: 評価シナリオのメンテナンスコスト

**リスク**: 21シナリオ（7スキル × 3）の継続的更新が負担になる

**対策**:
- 最初は「代表的な3シナリオ」のみに絞る
- スキル変更時に該当シナリオのみ更新（全シナリオの一斉更新は不要）
- 評価は CI/CD に組み込まず、手動レビュー時に活用

### リスク 3: 既存ユーザーへの影響

**リスク**: 構造変更により、既存のワークフローが一時的に混乱する

**対策**:
- SKILL.md の description は変更しない（トリガー条件を維持）
- 段階的なロールアウト（フェーズ1→2→3）
- 各フェーズ後に動作確認を実施

---

## 参考資料

### Agent Skills Best Practices

**設計原則**:
- [Concise is key](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#concise-is-key): SKILL.md は簡潔に、500行以内
- [Progressive Disclosure](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#progressive-disclosure): 概要→詳細の段階的開示
- [Evaluation-driven development](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#evaluation-driven-development): 最低3つの評価シナリオ

**実装パターン**:
- [Workflow design](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#workflow-design): チェックリスト形式
- [Feedback loops](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#feedback-loops): 検証→修正→再検証

### 内部参照

- [best-practices.md](.claude/skills/skills-bestpractice-investigating/references/best-practices.md): ベストプラクティス全文
- [claude-code-skills.md](.claude/skills/skills-bestpractice-investigating/references/claude-code-skills.md): Claude Code 固有実装
- [reference-implementations.md](.claude/skills/skills-bestpractice-investigating/references/reference-implementations.md): 公式リポジトリの実装例

---

## 次のアクション

### フェーズ 0: 即座に開始すべき（基盤整備）

1. **設計規約の文書化**
   - 優先度: 最高
   - 理由: すべての実装判断の基準となる
   - 成果物: `ai/guidelines/skills-structure-rules.md`
   - 内容: リンク規約、評価シナリオ形式、分割トリガー

2. **既存シナリオへの `negative_example` 追加**
   - 優先度: 最高
   - 理由: 新規シナリオ作成のテンプレートとなる
   - 対象: plan-creating/evaluations/scenario-1.json, pr-reviewing/evaluations/scenario-1.json

3. **既存スキルの規約適合性検証**
   - 優先度: 高
   - 対象: plan-creating, pr-reviewing
   - 確認項目: リンク規約、評価シナリオ形式、SKILL.md行数

### フェーズ 1: 高優先度（Progressive Disclosure と評価シナリオ）

4. **gh-issue-managing の Progressive Disclosure 実装**
   - 優先度: 高
   - 理由: 最も行数が多く（187行）、改善効果が大きい
   - 目標: 120-140行程度、guidelines/ と examples/ に分離

5. **claude-md-suggesting の Progressive Disclosure 実装**
   - 優先度: 高
   - 理由: 165行で密集、提案品質の標準化に有効
   - 目標: 100-120行程度、guidelines/ と examples/ に分離

6. **全7スキルへの評価シナリオ追加（各3つ、2層構造）**
   - 優先度: 高
   - 理由: 品質保証の基盤構築、リグレッション検出
   - 成果物: 21シナリオ（7スキル × 3）、`.json` + `.md` の2層

### フェーズ 2以降: 検討完了、実装準備OK

7. **plan-creating の templates 整合性修正**
   - 決定事項: オプション B（外部参照、重複回避）を採用
   - 理由: `ai/templates/plan-template.md` との重複を回避

8. **ワークフロー標準化の範囲**
   - 決定事項: 複雑系スキル（plan-creating, pr-reviewing, doc-writing, claude-md-suggesting）のみ
   - 理由: シンプル系スキル（gh-*, skills-bestpractice-investigating）は過度なテンプレ化を回避

---

## レビュー反映サマリー

本プランは [ai/reviews/251220_skills-bestpractice-optimization_review.md](ai/reviews/251220_skills-bestpractice-optimization_review.md) のレビューを反映し、以下を修正しました:

### 主要な変更点

1. **評価シナリオの形式を既存資産に適合**（レビュー 3.1）
   - `.md` のみ → `.json`（入力仕様）+ `.md`（結果）の2層構造
   - `negative_example` フィールドを必須化

2. **SKILL.md 行数目標を条件付きトリガーに変更**（レビュー 3.2）
   - 絶対値（80行/100行）→ 条件付き（150行超、検索困難など）
   - 目標を「120-150行程度」に緩和

3. **Progressive Disclosure のリンク規約を事前確定**（レビュー 3.3）
   - フェーズ 0 として基盤整備を追加
   - 規約文書化（`ai/guidelines/skills-structure-rules.md`）

4. **ワークフロー標準化のスコープを絞る**（レビュー 4.1）
   - 全スキル → 複雑系スキル（4つ）のみ
   - シンプル系スキル（gh-*）は現状維持

5. **plan-creating templates の重複回避**（レビュー 4.2）
   - オプション A（スキル内追加）→ オプション B（外部参照）
   - `ai/templates/plan-template.md` を Single Source of Truth に

6. **examples に判定基準をセット化**（レビュー 4.3）
   - Good/Bad 例のみ → チェック観点を同ファイル内に併記

7. **完了条件を具体化**（レビュー 5）
   - ナビゲーション、整合性、評価シナリオの必須要素を明記

### ステータス

- レビュー承認度: **Approve寄り（軽微修正で実行可能）**
- 次のステップ: **フェーズ 0（基盤整備）から開始**
