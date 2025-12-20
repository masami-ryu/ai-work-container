# Claude Skills 精度向上改善プラン

作成日: 2025年12月20日
作成者: Plan Creator (plan-creating skill)
更新日: 2025年12月20日
バージョン: 1.1.0
ステータス: Ready for Implementation

## 1. 概要

### 目的

公式ベストプラクティスに基づいて既存の `.claude/skills/**/*` を評価し、精度向上を目指した改善を実施する。

### スコープ

- **対象**: `.claude/skills/` 配下の全6スキル
- **評価基準**: Claude Skills公式ベストプラクティス
- **改善観点**: 構造、簡潔性、発見性、progressive disclosure
- **対象外**: スキルの機能変更（既存機能は維持）

### 前提条件

- 公式ドキュメント分析済み
- 各スキルファイルの詳細分析済み
- ベストプラクティス理解済み

---

## 2. 評価サマリー

### 評価対象スキル（6件）

| スキル名 | 行数 | 評価 | 改善優先度 |
|---------|------|------|-----------|
| gh-pr-viewing | 91行 | ✅ 良好 | 低 |
| gh-issue-managing | 118行 | ✅ 良好 | 低 |
| claude-md-suggesting | 112行 | ⚠️ 改善推奨 | 中 |
| pr-reviewing | 300行 | ⚠️ 改善推奨 | 高 |
| plan-creating | 248行 | ⚠️ 改善推奨 | 高 |
| doc-writing | 154行 | ✅ 良好 | 低 |

### 共通の強み

✅ **命名規則**: 全てgerund形（-ing形）で統一
✅ **YAML Frontmatter**: 全て適切に設定
✅ **Examples**: 全てのスキルに具体的な例が含まれる
✅ **Version History**: 全てのスキルにバージョン履歴あり
✅ **allowed-tools**: 全て適切に制限

### 共通の改善点

⚠️ **Progressive Disclosure未適用**: 長いスキルで詳細を分離すべき
⚠️ **時間推定の記載**: ベストプラクティス違反（plan-creating）
⚠️ **Description改善**: 一部のスキルでトリガー不明確

---

## 3. スキル別詳細評価

### 3.1 gh-pr-viewing

#### 現状評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| Name | ✅ | 適切（64文字以内、小文字・ハイフン） |
| Description | ✅ | 具体的、トリガー用語含む |
| 構造 | ✅ | 明確で簡潔（91行） |
| allowed-tools | ✅ | [Bash, Read] 適切に制限 |
| Examples | ✅ | 3例、具体的 |
| 簡潔性 | ✅ | 冗長な説明なし |

#### 改善提案

**優先度: 低**

- 現状で問題なし
- 維持のみ

---

### 3.2 gh-issue-managing

#### 現状評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| Name | ✅ | 適切 |
| Description | ✅ | 具体的、トリガー用語含む |
| 構造 | ✅ | 明確で簡潔（118行） |
| allowed-tools | ✅ | [Bash, Read] 適切に制限 |
| Examples | ✅ | 4例、具体的 |
| 簡潔性 | ✅ | 冗長な説明なし |

#### 改善提案

**優先度: 低**

- 現状で問題なし
- 維持のみ

---

### 3.3 claude-md-suggesting

#### 現状評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| Name | ✅ | 適切 |
| Description | ⚠️ | やや曖昧、トリガー不明確 |
| 構造 | ✅ | 明確（112行） |
| allowed-tools | ✅ | [Read, Grep] 適切に制限 |
| Examples | ✅ | 2例、具体的 |
| 簡潔性 | ✅ | 適切 |

#### 改善提案

**優先度: 中**

**問題点**:
- **Description**: 「新しい知見に基づいて」という表現が曖昧
- **トリガー不明確**: いつ使うべきかが明示されていない

**改善案**:

**現在の description**:
```yaml
description: CLAUDE.mdの更新提案を生成する。セッションで得られた新しい知見に基づいてCLAUDE.mdを更新すべき点を提案する。
```

**改善後の description**:
```yaml
description: CLAUDE.mdの更新提案を生成する。セッション終了時やプロジェクト変更後、CLAUDE.mdやプロジェクトドキュメントの更新提案が必要な際に使用する。
```

**変更理由**:
- 具体的なトリガー（「セッション終了時」「プロジェクト変更後」）を追加
- 「いつ使うか」を明確化

---

### 3.4 pr-reviewing

#### 現状評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| Name | ✅ | 適切 |
| Description | ✅ | 具体的、詳細 |
| 構造 | ⚠️ | 300行と長い |
| allowed-tools | ✅ | [Read, Grep, Glob, Bash, WebFetch] 適切 |
| Examples | ✅ | 2例、具体的 |
| 簡潔性 | ⚠️ | 詳細すぎる |
| Progressive Disclosure | ❌ | 未適用 |

#### 改善提案

**優先度: 高**

**問題点**:
- **300行と長い**: ベストプラクティスでは500行以内推奨だが、可能な限り簡潔に
- **Progressive Disclosure未適用**: 詳細なガイドラインを別ファイルに分離すべき

**改善案**:

**ディレクトリ構造**（改善後）:
```
pr-reviewing/
├── SKILL.md (メイン: 概要とワークフロー、150-200行目標)
├── guidelines/
│   ├── code-quality.md (コード品質ガイドライン)
│   ├── security.md (セキュリティガイドライン)
│   ├── performance.md (パフォーマンスガイドライン)
│   ├── testing.md (テストガイドライン)
│   └── design.md (設計ガイドライン)
└── templates/
    └── review-template.md (レビュー結果テンプレート)
```

**SKILL.md の改善方針**:
1. **概要とワークフロー**: SKILL.mdに残す
2. **詳細ガイドライン**: 各観点別にファイル分離
   - `guidelines/code-quality.md`: コード品質の詳細基準
   - `guidelines/security.md`: セキュリティチェック項目
   - `guidelines/performance.md`: パフォーマンス評価基準
   - `guidelines/testing.md`: テストカバレッジ基準
   - `guidelines/design.md`: 設計評価基準
3. **テンプレート**: `templates/review-template.md`に移動

**SKILL.md でのリンク例**:
```markdown
### レビュー観点

各観点の詳細ガイドラインは以下を参照:

- **コード品質**: [guidelines/code-quality.md](guidelines/code-quality.md)
- **セキュリティ**: [guidelines/security.md](guidelines/security.md)
- **パフォーマンス**: [guidelines/performance.md](guidelines/performance.md)
- **テスト**: [guidelines/testing.md](guidelines/testing.md)
- **設計**: [guidelines/design.md](guidelines/design.md)

レビュー結果のテンプレートは [templates/review-template.md](templates/review-template.md) を参照。
```

**期待される効果**:
- SKILL.md が150-200行に削減（現在300行）
- Claude が必要な観点のみ読み込み可能
- メンテナンス性向上

---

### 3.5 plan-creating

#### 現状評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| Name | ✅ | 適切 |
| Description | ✅ | 具体的、詳細 |
| 構造 | ⚠️ | 248行と長め |
| allowed-tools | ✅ | [Read, Grep, Glob, WebFetch, Write, Edit] 適切 |
| Examples | ✅ | 5例、具体的 |
| 簡潔性 | ⚠️ | やや冗長 |
| Progressive Disclosure | ❌ | 未適用 |
| 時間推定 | ❌ | ベストプラクティス違反 |

#### 改善提案

**優先度: 高**

**問題点1: 時間推定の記載**

**現在の記述**（ベストプラクティス違反）:
```markdown
#### Express（簡易プラン）
- **条件**: 変更対象が2ファイル以下、影響範囲が限定的
- **プロセス**: 情報収集 → プラン作成 → 出力
- **所要時間目安**: 5分以内  ❌ ベストプラクティス違反

#### Standard（標準プラン）
- **所要時間目安**: 10-20分  ❌ ベストプラクティス違反

#### Comprehensive（詳細プラン）
- **所要時間目安**: 30分以上  ❌ ベストプラクティス違反
```

**改善後**:
```markdown
#### Express（簡易プラン）
- **条件**: 変更対象が2ファイル以下、影響範囲が限定的
- **プロセス**: 情報収集 → プラン作成 → 出力
- **適用例**: READMEの更新、1-2ファイルの変更

#### Standard（標準プラン）
- **条件**: 中程度の複雑さ、3-10ファイルに影響
- **プロセス**: 目的理解 → 情報収集 → 設計検討 → プラン作成 → 検証 → 出力
- **適用例**: 新機能追加、複数ファイルのリファクタリング

#### Comprehensive（詳細プラン）
- **条件**: アーキテクチャ変更、多数のファイルに影響
- **プロセス**: 目的理解 → 詳細調査 → 設計検討 → リスク分析 → プラン作成 → 複数回検証 → 出力
- **適用例**: マイクロサービス化、大規模リアーキテクチャ
```

**変更理由**:
- 公式ベストプラクティス「Avoid time-sensitive information」に準拠
- 時間推定ではなく適用例を追加

**問題点2: Progressive Disclosure未適用**

**ディレクトリ構造**（改善後）:
```
plan-creating/
├── SKILL.md (メイン: 概要とワークフロー選択、150行目標)
├── workflows/
│   ├── express.md (Expressワークフロー詳細)
│   ├── standard.md (Standardワークフロー詳細)
│   └── comprehensive.md (Comprehensiveワークフロー詳細)
└── templates/
    └── plan-template.md (プランテンプレート)
```

**SKILL.md の改善方針**:
1. **ワークフロー選択**: SKILL.mdに残す
2. **詳細プロセス**: 各ワークフロー別にファイル分離
   - `workflows/express.md`: Expressワークフローの詳細ステップ
   - `workflows/standard.md`: Standardワークフローの詳細ステップ
   - `workflows/comprehensive.md`: Comprehensiveワークフローの詳細ステップ
3. **品質チェックリスト**: SKILL.mdに残す（重要度が高いため）

**SKILL.md でのリンク例**:
```markdown
### ワークフロー詳細

選択したワークフローに応じて以下を参照:

- **Expressワークフロー**: [workflows/express.md](workflows/express.md)
- **Standardワークフロー**: [workflows/standard.md](workflows/standard.md)
- **Comprehensiveワークフロー**: [workflows/comprehensive.md](workflows/comprehensive.md)
```

**期待される効果**:
- SKILL.md が150行程度に削減（現在248行）
- Claude が選択したワークフローのみ読み込み
- メンテナンス性向上

---

### 3.6 doc-writing

#### 現状評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| Name | ✅ | 適切 |
| Description | ✅ | 具体的 |
| 構造 | ✅ | 明確で簡潔（154行） |
| allowed-tools | ✅ | [Read, Grep, Glob, Bash, Write, Edit] 適切 |
| Examples | ✅ | 3例、具体的 |
| 簡潔性 | ✅ | 適切 |

#### 改善提案

**優先度: 低**

- 現状で問題なし
- 維持のみ

---

## 4. 要件と制約

### 要件

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 必須 | pr-reviewing にProgressive Disclosureを適用 | 高 |
| REQ-002 | 必須 | plan-creating から時間推定を削除 | 高 |
| REQ-003 | 必須 | plan-creating にProgressive Disclosureを適用 | 高 |
| REQ-004 | 推奨 | claude-md-suggesting のdescriptionを改善 | 中 |
| REQ-005 | 推奨 | 改善前後の比較テストを実施 | 中 |

### 制約

| ID | 種別 | 内容 |
|----|------|------|
| CON-001 | 技術 | 既存機能を維持（機能変更なし） |
| CON-002 | 技術 | YAML Frontmatterの互換性維持 |
| CON-003 | 運用 | 段階的な移行（一度にすべて変更しない） |
| CON-004 | 品質 | 改善後も500行以内を維持 |

### Progressive Disclosure 設計ルール

| ID | ルール | 理由 |
|----|-------|------|
| GUD-001 | SKILL.mdから参照ファイルへのリンクは1段のみ | 公式ベストプラクティス: 深い参照はClaudeの部分読みを引き起こし、情報到達性が低下 |
| GUD-002 | 参照ファイル同士でさらにリンクしない（必要ならSKILL.mdから直接リンク） | 同上 |
| GUD-003 | 100行を超える参照ファイルは先頭に目次を配置 | 長いファイルでの情報発見性向上 |
| GUD-004 | SKILL.mdは概要とワークフロー選択に集中、詳細は参照ファイルへ | Progressive Disclosureの原則: 必要な情報のみを段階的に提供 |

---

## 4.5. テスト計画

### テスト観点

改善後のスキルについて、以下の3観点でテストを実施します。

#### 4.5.1 発火テスト（Discovery Test）

**目的**: descriptionに含めたトリガー語を使ったプロンプトで、狙ったSkillが選ばれるか検証

| スキル | テストプロンプト | 期待結果 |
|--------|----------------|----------|
| pr-reviewing | 「このPRをレビューして」 | pr-reviewing スキルが発火 |
| pr-reviewing | 「pull request #123の品質チェックをお願い」 | pr-reviewing スキルが発火 |
| plan-creating | 「新機能追加のプランを作成して」 | plan-creating スキルが発火 |
| plan-creating | 「この実装の計画を立てて」 | plan-creating スキルが発火 |
| claude-md-suggesting | 「CLAUDE.mdの更新提案を出して」 | claude-md-suggesting スキルが発火 |
| claude-md-suggesting | 「セッション終了時にプロジェクトドキュメントの更新提案」 | claude-md-suggesting スキルが発火 |

#### 4.5.2 ナビゲーションテスト（Navigation Test）

**目的**: SKILL.mdからリンクしたファイルが1段で参照でき、必要な情報が見つかるか検証

| スキル | テスト項目 | 期待結果 |
|--------|----------|----------|
| pr-reviewing | SKILL.md → guidelines/code-quality.md | リンクが有効、内容が参照可能 |
| pr-reviewing | SKILL.md → guidelines/security.md | リンクが有効、内容が参照可能 |
| pr-reviewing | SKILL.md → templates/review-template.md | リンクが有効、内容が参照可能 |
| plan-creating | SKILL.md → workflows/express.md | リンクが有効、内容が参照可能 |
| plan-creating | SKILL.md → workflows/standard.md | リンクが有効、内容が参照可能 |
| plan-creating | SKILL.md → workflows/comprehensive.md | リンクが有効、内容が参照可能 |

#### 4.5.3 互換性テスト（Compatibility Test）

**目的**: YAML frontmatterが壊れていないか、必須フィールドが維持されているか検証

| スキル | テスト項目 | 期待結果 |
|--------|----------|----------|
| 全スキル | name フィールド | 存在、小文字・ハイフン、64文字以内 |
| 全スキル | description フィールド | 存在、具体的なトリガー語を含む |
| 全スキル | allowed-tools フィールド | 存在、適切なツールリスト |
| 全スキル | version フィールド | 存在、適切にバージョンアップ |

---

## 5. 実装ステップ

### Phase 1: 高優先度改善（pr-reviewing, plan-creating）

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 | 状態 |
|----------|------|------------|---------|--------|------|
| TASK-001 | pr-reviewingディレクトリ構造作成 | `.claude/skills/pr-reviewing/guidelines/`<br>`.claude/skills/pr-reviewing/templates/` | guidelines/, templates/ 作成 | 高 | [ ] |
| TASK-002 | pr-reviewing詳細ガイドラインを分離 | `.claude/skills/pr-reviewing/guidelines/code-quality.md`<br>`.claude/skills/pr-reviewing/guidelines/security.md`<br>`.claude/skills/pr-reviewing/guidelines/performance.md`<br>`.claude/skills/pr-reviewing/guidelines/testing.md`<br>`.claude/skills/pr-reviewing/guidelines/design.md` | 5つのガイドラインファイル作成、各ファイル100行以内、100行超の場合は目次追加 | 高 | [ ] |
| TASK-003 | pr-reviewing SKILL.md簡略化 | `.claude/skills/pr-reviewing/SKILL.md` | 150-200行に削減、リンクがSKILL.mdから1段で揃っている | 高 | [ ] |
| TASK-004 | plan-creatingから時間推定削除 | `.claude/skills/plan-creating/SKILL.md` | 「所要時間目安」表現が完全に無い | 高 | [ ] |
| TASK-005 | plan-creatingディレクトリ構造作成 | `.claude/skills/plan-creating/workflows/`<br>`.claude/skills/plan-creating/templates/` | workflows/, templates/ 作成 | 高 | [ ] |
| TASK-006 | plan-creatingワークフロー詳細を分離 | `.claude/skills/plan-creating/workflows/express.md`<br>`.claude/skills/plan-creating/workflows/standard.md`<br>`.claude/skills/plan-creating/workflows/comprehensive.md` | 3つのワークフローファイル作成、各ファイル100行以内、100行超の場合は目次追加 | 高 | [ ] |
| TASK-007 | plan-creating SKILL.md簡略化 | `.claude/skills/plan-creating/SKILL.md` | 150行程度に削減、リンクがSKILL.mdから1段で揃っている | 高 | [ ] |

### Phase 2: 中優先度改善（claude-md-suggesting）

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 | 状態 |
|----------|------|------------|---------|--------|------|
| TASK-008 | claude-md-suggesting description改善 | `.claude/skills/claude-md-suggesting/SKILL.md` | 具体的なトリガー（「セッション終了時」「プロジェクト変更後」）を追加 | 中 | [ ] |

### Phase 3: 検証とドキュメント更新

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 | 状態 |
|----------|------|------------|---------|--------|------|
| TASK-009 | 改善前後の比較テスト | 全スキル | 発火テスト・ナビゲーションテスト・互換性テストが全て合格（詳細は「4. テスト計画」参照） | 中 | [ ] |
| TASK-010 | Version History更新 | `.claude/skills/pr-reviewing/SKILL.md`<br>`.claude/skills/plan-creating/SKILL.md`<br>`.claude/skills/claude-md-suggesting/SKILL.md` | pr-reviewing: 1.1.0（構造改善）<br>plan-creating: 1.1.0（構造改善、時間推定削除）<br>claude-md-suggesting: 1.0.1（description改善） | 中 | [ ] |
| TASK-011 | プロジェクトCLAUDE.md更新 | `/workspaces/ai-work-container/CLAUDE.md` | スキル構造変更を反映 | 低 | [ ] |

---

## 6. 成功基準

### 品質基準

- [ ] **行数削減**: pr-reviewing が200行以内、plan-creating が150行以内
- [ ] **Progressive Disclosure適用**: 詳細が別ファイルに分離、GUD-001〜GUD-004に準拠
- [ ] **時間推定削除**: plan-creating に時間推定が存在しない
- [ ] **Description改善**: claude-md-suggesting に具体的トリガーあり
- [ ] **機能維持**: 既存機能がすべて正常動作
- [ ] **互換性**: YAML Frontmatter互換性維持
- [ ] **Version更新**: 変更量に応じた適切なバージョニング（pr-reviewing/plan-creating: 1.1.0、claude-md-suggesting: 1.0.1）

### パフォーマンス基準

- [ ] **Discovery精度**: スキルの発見性が向上（主観評価）
- [ ] **Token効率**: Claude が必要な情報のみ読み込み
- [ ] **メンテナンス性**: 構造が明確で修正しやすい

---

## 7. リスク分析

### リスク一覧

| リスクID | リスク内容 | 影響 | 対策 |
|---------|----------|------|------|
| RISK-001 | ファイル分離によりリンク切れ | 中 | 相対パスを正確に記述、テスト実施 |
| RISK-002 | Progressive Disclosure未対応環境 | 低 | Claude は自動的にファイル読み込み可能 |
| RISK-003 | Description変更で発見性低下 | 中 | 改善前後でテストし、検証 |
| RISK-004 | 既存ワークフローの破壊 | 高 | 段階的移行、バックアップ保持 |

---

## 8. 次のアクション

### 即座に実行可能

1. **TASK-004実施**: plan-creatingから時間推定削除（最も簡単）
2. **TASK-008実施**: claude-md-suggesting description改善

### 計画が必要

1. **Phase 1詳細設計**: pr-reviewing, plan-creating のファイル分離詳細設計
2. **テスト計画**: 改善前後の比較テスト方法を策定

### ユーザー確認が必要

- [ ] この改善プランを承認するか確認
- [ ] 優先順位の調整が必要か確認
- [ ] 段階的移行のタイミング確認

---

## 9. 参考資料

### 公式ドキュメント

- [Claude Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Skills公式リポジトリ](https://github.com/anthropics/skills)
- [Agent Skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Creating custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)

### ベストプラクティスのキーポイント

1. **Concise is key**: コンテキストは公共財、簡潔に
2. **Progressive Disclosure**: SKILL.mdは目次、詳細は別ファイル
3. **Avoid time-sensitive information**: 時間推定を含めない
4. **Set appropriate degrees of freedom**: タスクに応じた自由度設定
5. **Test with all models**: 全モデルでテスト

---

## 10. 変更履歴

| 日付 | バージョン | 変更内容 | 作成者 |
|-----|----------|---------|--------|
| 2025-12-20 | 1.0.0 | 初版作成 | Plan Creator |
| 2025-12-20 | 1.1.0 | レビュー結果反映: タスク表に対象ファイル列追加、テスト計画セクション追加（4.5節）、Progressive Disclosure設計ルール追加（GUD-001〜004）、Version History更新方針見直し | Claude Code |

---

**END OF PLAN**
