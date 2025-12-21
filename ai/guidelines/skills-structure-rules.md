# Agent Skills 構造設計規約

## 概要

本規約は `.claude/skills` 配下の Agent Skills の構造設計ルールを定義します。すべての新規スキル作成・既存スキル修正時に準拠してください。

## 目的

- **一貫性**: すべてのスキルが統一された設計原則に従う
- **保守性**: 新規メンバーがスキル構造を理解しやすい
- **品質保証**: 評価シナリオによる継続的検証が可能
- **過度な細分化の回避**: 参照構造をシンプルに保つ

---

## 1. Progressive Disclosure のリンク規約

### 1.1 リンク可能なディレクトリ（これ以外は禁止）

```
.claude/skills/<skill-name>/
├── SKILL.md                # メインファイル
├── guidelines/             # ガイドライン・ベストプラクティス
├── examples/               # 良い例・悪い例
├── templates/              # テンプレート
├── workflows/              # ワークフロー定義（複雑なスキルのみ）
└── evaluations/            # 評価シナリオ
```

### 1.2 参照ファイルのルール

- **参照階層**: 1階層のみ（SKILL.md → reference.md のみ、reference.md → details.md は禁止）
- **参照ファイルの上限**: 150行（超える場合は同ファイル内TOCで対処、分割しない）
- **相対リンク**: Skills配下の相対パスで統一（例: `guidelines/style-guide.md`）
- **TOC**: 100行以上のファイルには必ず TOC を追加

### 1.3 ナビゲーション

SKILL.md の冒頭または末尾に「どこに何があるか（1段の目次）」を配置:

```markdown
## 参照ガイド

- [Issue作成ベストプラクティス](guidelines/issue-best-practices.md)
- [良い例・悪い例](examples/good-bad-examples.md)
- [評価シナリオ](evaluations/)
```

---

## 2. 評価シナリオのファイル形式（2層構造）

### 2.1 ファイル配置

```
.claude/skills/<skill>/evaluations/scenario-N.json  # 入力仕様
ai/review-validations/<skill>-scenario-N-baseline.md # ベースライン結果（改善前）
ai/review-validations/<skill>-scenario-N-improved.md # 改善後の評価（実装後に追加）
```

### 2.2 scenario-N.json の必須フィールド

```json
{
  "skills": ["<skill-name>"],
  "query": "ユーザーからの入力プロンプト",
  "expected_behavior": [
    "期待挙動1",
    "期待挙動2",
    "..."
  ],
  "success_criteria": [
    "合格基準1",
    "合格基準2",
    "..."
  ],
  "negative_example": "NG例（1つ）"
}
```

**必須フィールド説明**:
- `skills`: 対象スキル名（配列）
- `query`: ユーザーからの入力プロンプト（実際のユースケースに即したもの）
- `expected_behavior`: 期待される挙動のリスト（3〜5項目）
- `success_criteria`: 合格基準のリスト（明確な判定可能な基準）
- `negative_example`: やってはいけない例（1つ、具体的に記述）

### 2.3 baseline.md の必須セクション

```markdown
# [スキル名] 評価シナリオ N: [シナリオ名]

## 評価シナリオ概要

[シナリオの目的と想定ユースケース]

## ベースライン結果（改善前）

### 現在の強み

- [強み1]
- [強み2]

### 改善が必要な点

- [改善点1]
- [改善点2]

### 想定される問題点

- [問題点1]
- [問題点2]

## 次回評価での確認事項

- [ ] 確認項目1
- [ ] 確認項目2
```

### 2.4 評価シナリオの数

- **最低3つ**: 各スキルに代表的なユースケースを3つ以上カバー
- **代表性**: 基本操作、応用操作、エッジケースをバランス良く

---

## 3. SKILL.md 分割の条件付きトリガー

### 3.1 分割すべき条件（いずれか該当）

- ✅ SKILL.md が **150行を超える**
- ✅ Guidelines/Examples が肥大化して**目的別検索が困難**
- ✅ ワークフローが複雑で**段階的提示が必要**（plan-creating, pr-reviewing など）

### 3.2 分割後の目標（参考値、厳密な上限ではない）

- **SKILL.md**: 120〜160行程度
- **優先順位**: "短くする" < "目的別に探しやすくする"

### 3.3 分割不要の条件

- ❌ 100行未満のシンプルなスキル（gh-pr-viewing, skills-bestpractice-investigating など）
- ❌ CLIコマンド中心でガイドラインが少ないスキル

---

## 4. ワークフロー設計規約

### 4.1 チェックリスト形式の適用基準

**適用対象（複雑系スキルのみ）**:
- plan-creating: 複数のワークフローパターン
- pr-reviewing: 5段階レビュープロセス
- doc-writing: 5ステップワークフロー
- claude-md-suggesting: 5ステップワークフロー

**適用除外（シンプル系スキル）**:
- gh-pr-viewing: CLIコマンド中心
- gh-issue-managing: CLIコマンド中心
- skills-bestpractice-investigating: 調査型でワークフロー不要

### 4.2 標準テンプレート

```markdown
## [タスク名] ワークフロー

このチェックリストをコピーして進捗を追跡してください:

\```
[タスク名] 進捗:
- [ ] Step 1: [アクション]
- [ ] Step 2: [アクション]
- [ ] Step 3: [アクション]
- [ ] Step 4: [アクション]
- [ ] Step 5: [検証]
\```

**Step 1: [アクション]**
[具体的な指示とチェックポイント]

**Step 2: [アクション]**
[具体的な指示とチェックポイント]

...

**Step 5: [検証]**
[検証項目と合格基準]
```

---

## 5. examples/ 配下のファイル規約

### 5.1 Good/Bad 例には判定基準をセット化

**NG例**（判定基準なし）:
```markdown
### 良い例
Issue タイトル: "Bug: ログイン画面でエラーメッセージが表示されない"

### 悪い例
Issue タイトル: "バグ"
```

**OK例**（判定基準を併記）:
```markdown
### 良い例
Issue タイトル: "Bug: ログイン画面でエラーメッセージが表示されない"

**チェック観点**:
- [ ] 種別（Bug/Feature/...）が明記されている
- [ ] 再現手順が具体的
- [ ] 期待動作と実際の動作が明確

### 悪い例
Issue タイトル: "バグ"

**問題点**:
- [ ] 種別が不明瞭
- [ ] 再現手順がない
- [ ] 期待動作が不明
```

### 5.2 チェック観点の配置

- Good 例の直後に「チェック観点」を箇条書き
- Bad 例の直後に「問題点」を箇条書き
- チェック観点はチェックボックス形式で記載（実行時にコピーして使える）

---

## 6. allowed-tools の整合性確認

### 6.1 提案系スキルの制約

**claude-md-suggesting など提案のみを行うスキル**:
- ❌ Write/Edit は**含めない**（提案のみ、実行しない）
- ✅ Read/Grep/Glob は OK（調査用）

### 6.2 実行系スキルの権限

**doc-writing, pr-reviewing など実行を伴うスキル**:
- ✅ Write/Edit を含める（実際にファイル操作を行う）

### 6.3 分割後の確認

Progressive Disclosure 実装後、allowed-tools が分割後の運用に合っているか確認:
- ガイドラインファイルへの参照を追加したが、allowed-tools は変更不要（SKILL.md の権限を継承）

---

## 7. 検証チェックリスト

### 7.1 新規スキル作成時

- [ ] SKILL.md が150行以内（または分割条件を満たしている）
- [ ] description が三人称、トリガーワードを含む
- [ ] allowed-tools がスキルのスコープに適合
- [ ] evaluations/ に3つ以上のシナリオ（`.json` + `.md`）
- [ ] 各シナリオに `negative_example` が含まれる
- [ ] 100行超のファイルに TOC が存在

### 7.2 既存スキル修正時

- [ ] 参照構造が1階層のみ
- [ ] 参照ファイルが150行以内
- [ ] ナビゲーションが SKILL.md に存在
- [ ] allowed-tools が分割後の運用に適合
- [ ] 評価シナリオが2層構造（`.json` + `.md`）

---

## 8. 適用例

### 8.1 適合例: pr-reviewing

```
pr-reviewing/
├── SKILL.md (145行, ワークフローとナビゲーション)
├── guidelines/
│   ├── security-checklist.md (100行)
│   └── performance-checklist.md (80行)
├── workflows/
│   └── 5-phase-review.md (120行, TOC付き)
├── examples/
│   └── good-bad-examples.md (90行, 判定基準セット)
└── evaluations/
    ├── scenario-1.json
    ├── scenario-2.json
    └── scenario-3.json
```

### 8.2 不適合例（修正が必要）

```
bad-skill/
├── SKILL.md (200行, 分割必須)
├── guidelines/
│   ├── details.md (180行, 150行超過)
│   └── sub/            # ❌ 2階層目は禁止
│       └── extra.md
└── evaluations/
    └── scenario-1.md   # ❌ .json がない（2層構造不適合）
```

---

## 9. 参考資料

- [Agent Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Progressive Disclosure](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#progressive-disclosure)
- [Evaluation-driven development](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#evaluation-driven-development)

---

## 改訂履歴

- 2024-12-20: 初版作成（251220_skills-bestpractice-optimization.md に基づく）
