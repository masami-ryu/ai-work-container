# Agent Skills ベストプラクティス要点

このファイルは[Claude Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)の要点をチェックリスト形式で整理したものです。

## 1. 簡潔さの原則 (Concise is key)

### チェックポイント
- [ ] **Claude は賢い前提**: 一般的な知識の説明を省く（例: PDF とは何か、ライブラリとは何か）
- [ ] **トークンコストを意識**: 各段落が本当に必要か問い直す
- [ ] **SKILL.md 本文は 500 行以内**: この制限を超える場合は参照ファイルに分割する
- [ ] **具体例を優先**: 冗長な説明よりも、コード例や具体的な使用例を提示する

### 良い例 vs 悪い例

**良い例（簡潔）:**
```markdown
## Extract PDF text

Use pdfplumber for text extraction:

\`\`\`python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
\`\`\`
```

**悪い例（冗長）:**
```markdown
## Extract PDF text

PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library. There are many libraries available...
```

## 2. 自由度の設定 (Set appropriate degrees of freedom)

### 自由度の選択基準

| 自由度 | 使用するとき | 形式 | 例 |
|--------|-------------|------|-----|
| **High** | 複数のアプローチが有効、文脈依存の判断が必要 | テキストベースの指示 | コードレビュー、調査タスク |
| **Medium** | 推奨パターンがあるが柔軟性も必要 | スクリプト + パラメータ | レポート生成、データ変換 |
| **Low** | 脆弱な操作、一貫性が重要、特定の手順が必要 | 具体的なスクリプト、少ないパラメータ | データベースマイグレーション、本番環境への展開 |

### チェックポイント
- [ ] **タスクの脆弱性を評価**: エラーが起きやすい操作は Low freedom
- [ ] **複数の有効な解決策があるか**: ある場合は High freedom
- [ ] **一貫性の重要度**: 重要な場合は Low freedom

## 3. Progressive Disclosure（段階的開示）

### 構造設計の原則
- [ ] **SKILL.md は概要とナビゲーション**: 詳細は別ファイルに分離
- [ ] **参照は 1 階層に限定**: SKILL.md → reference.md は OK、SKILL.md → advanced.md → details.md は NG
- [ ] **長い参照ファイル（100行以上）には TOC を付ける**: Claude が部分読みしても全体が把握できるように
- [ ] **ドメイン別に整理**: 無関係な情報をまとめて読み込まないように分離

### パターン 1: 概要 + 参照リンク

```markdown
# SKILL.md

## Quick start
[基本的な使い方をここに記述]

## Advanced features
**Form filling**: See [FORMS.md](FORMS.md) for complete guide
**API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
**Examples**: See [EXAMPLES.md](EXAMPLES.md) for common patterns
```

### パターン 2: ドメイン別整理

```
skill/
├── SKILL.md (概要とナビゲーション)
└── reference/
    ├── finance.md (財務関連メトリクス)
    ├── sales.md (営業データ)
    └── product.md (プロダクト分析)
```

### パターン 3: 条件付き詳細

```markdown
# SKILL.md

## Creating documents
[基本的な方法]

## Editing documents
[シンプルな編集方法]

**For tracked changes**: See [REDLINING.md](REDLINING.md)
**For OOXML details**: See [OOXML.md](OOXML.md)
```

### チェックポイント
- [ ] **SKILL.md から直接参照**: 参照の参照を作らない
- [ ] **ドメインが異なる情報は分離**: sales.md と finance.md を分ける
- [ ] **100行以上のファイルには TOC**: 目次で全体構造を把握可能に

## 4. ワークフロー設計

### チェックリストパターン
複雑なタスクには、Claude がコピーしてチェックできるワークフローを提供する。

```markdown
## Research synthesis workflow

Copy this checklist and track your progress:

\`\`\`
Research Progress:
- [ ] Step 1: Read all source documents
- [ ] Step 2: Identify key themes
- [ ] Step 3: Cross-reference claims
- [ ] Step 4: Create structured summary
- [ ] Step 5: Verify citations
\`\`\`

**Step 1: Read all source documents**
[具体的な指示]

**Step 2: Identify key themes**
[具体的な指示]
...
```

### フィードバックループパターン
品質を保証するため、検証→修正→再検証のループを実装する。

```markdown
## Document editing process

1. Make your edits to `word/document.xml`
2. **Validate immediately**: `python ooxml/scripts/validate.py unpacked_dir/`
3. If validation fails:
   - Review the error message carefully
   - Fix the issues in the XML
   - Run validation again
4. **Only proceed when validation passes**
5. Rebuild: `python ooxml/scripts/pack.py unpacked_dir/ output.json`
```

### チェックポイント
- [ ] **複雑なタスクにはワークフロー**: 3ステップ以上のタスクにはチェックリスト
- [ ] **重要なタスクには検証**: フィードバックループで品質を保証
- [ ] **明確な失敗時の対応**: 失敗した場合の具体的な対処法を記載

## 5. コンテンツガイドライン

### 時系列情報の扱い
- [ ] **時系列情報を避ける**: 「2025年8月以前は...」のような記述は古くなる
- [ ] **"Old patterns" セクションを使う**: 非推奨の情報は折りたたみ可能に

```markdown
## Current method
[現在の方法]

## Old patterns
<details>
<summary>Legacy v1 API (deprecated 2025-08)</summary>

The v1 API used: `api.example.com/v1/messages`

This endpoint is no longer supported.
</details>
```

### 用語の統一
- [ ] **1つのトピックに1つの用語**: 「API endpoint」と「URL」と「API route」を混在させない
- [ ] **プロジェクト全体で統一**: 複数のスキルで同じ用語を使用

## 6. Description の書き方

### 必須要素
- [ ] **三人称で記述**: "Processes Excel files" (OK), "I can help you..." (NG)
- [ ] **何をするか + いつ使うか**: 両方を含める
- [ ] **具体的なトリガーワードを含む**: PDF, Excel, .xlsx など

### 良い例

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

```yaml
description: Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.
```

### 悪い例

```yaml
description: Helps with documents  # 曖昧すぎる
```

## 7. 評価駆動開発 (Evaluation-driven development)

### プロセス
1. **評価を先に作成**: ドキュメントを書く前に、3つの代表的なシナリオを定義
2. **ベースラインを測定**: スキルなしでの Claude の性能を記録
3. **最小限の指示を作成**: 評価をパスするために必要な最小限の内容
4. **反復改善**: 評価を実行し、結果に基づいて改善

### チェックポイント
- [ ] **最低3つの評価シナリオ**: 代表的なユースケースをカバー
- [ ] **ベースラインとの比較**: スキルの効果を測定可能に
- [ ] **実際の問題を解決**: 想像上の要件ではなく、実際のギャップに対処

## 8. その他のベストプラクティス

### アンチパターン
- [ ] **Windows スタイルのパスを避ける**: `scripts\helper.py` (NG) → `scripts/helper.py` (OK)
- [ ] **選択肢を増やしすぎない**: デフォルトを提供し、必要時のみ代替案を示す
- [ ] **深いネスト参照を避ける**: 参照は1階層に限定

### テンプレートパターン
厳格な要件には明確なテンプレートを提供する。

```markdown
## Report structure

ALWAYS use this exact template structure:

\`\`\`markdown
# [Analysis Title]

## Executive summary
[One-paragraph overview]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data
\`\`\`
```

### 例示パターン
入力/出力のペアを提供して、期待される形式を明確にする。

```markdown
## Commit message format

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
\`\`\`
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
\`\`\`
```

## 参考リンク

- [Claude Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
