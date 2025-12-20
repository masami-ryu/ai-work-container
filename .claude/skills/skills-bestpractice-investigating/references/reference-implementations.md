# 公式リポジトリ (anthropics/skills) 参考パターン

このファイルは [anthropics/skills](https://github.com/anthropics/skills) の優良実装から観察されたパターンと、自スキルへの適用観点を整理したものです。

## リポジトリ概要

- **URL**: https://github.com/anthropics/skills
- **スター数**: 22.7k
- **目的**: Agent Skills の参照実装とテンプレート集

## 標準的なスキル構造

### 基本構造パターン

公式リポジトリでは、各スキルは自己完結型のフォルダとして実装されています。

```
skill-name/
└── SKILL.md                # 必須: YAML frontmatter + 指示
```

### より複雑なスキルの構造例

```
skill-name/
├── SKILL.md                # メイン指示ファイル
├── reference/              # 参照ドキュメント（段階的開示）
│   ├── api-reference.md
│   └── examples.md
└── scripts/                # ユーティリティスクリプト
    └── helper.py
```

## SKILL.md の構成パターン

### 1. Frontmatter（必須）

```yaml
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---
```

**観察されたパターン:**
- `name`: 小文字とハイフンのみ（例: `docx`, `pdf`, `pptx`, `xlsx`）
- `description`: 簡潔で明確な説明（何をするか + いつ使うか）

**自スキルでの適用:**
- [ ] `name` は小文字とハイフンのみ、短く（1-3単語程度）
- [ ] `description` は「何をするか」と「いつ使うか」の両方を含む
- [ ] 予約語（anthropic, claude）を避ける

### 2. Markdown コンテンツの構成パターン

公式スキルで観察される典型的な構成:

```markdown
# [Skill Name]

[概要: このスキルが何をするかの簡単な説明]

## Examples
- Example usage 1
- Example usage 2

## Guidelines
- Guideline 1: [具体的な制約や推奨事項]
- Guideline 2: [具体的な制約や推奨事項]

## [ドメイン固有のセクション]
[必要に応じて、スキル固有の詳細情報]
```

**自スキルでの適用:**
- [ ] 概要セクション: スキルの目的を1-2段落で説明
- [ ] Examples セクション: 具体的な使用例を箇条書き
- [ ] Guidelines セクション: 制約やベストプラクティスを明確に
- [ ] ドメイン固有セクション: 必要に応じて追加（Progressive Disclosure で分離も検討）

## カテゴリ別のパターン

公式リポジトリでは、スキルを以下のカテゴリに分類しています:

### 1. Document Skills（ドキュメント処理）
- **例**: `docx`, `pdf`, `pptx`, `xlsx`
- **特徴**: 実行スクリプトを含む、複雑なファイル操作

**パターン:**
- ユーティリティスクリプトを `scripts/` に配置
- API リファレンスを別ファイルに分離
- 具体的なコード例を多用

**自スキルでの適用:**
- [ ] スクリプトが必要な場合は `scripts/` ディレクトリを作成
- [ ] 長い API リファレンスは別ファイルに分離（Progressive Disclosure）

### 2. Creative & Design（創作・デザイン）
- **例**: art, music, design applications
- **特徴**: 主にテキストベースの指示

**パターン:**
- ワークフロー重視（ステップバイステップ）
- 例示パターン（入力/出力ペア）

**自スキルでの適用:**
- [ ] 複雑なワークフローはチェックリスト形式で提供
- [ ] 良い例/悪い例のペアで期待される出力を示す

### 3. Development & Technical（開発・技術）
- **例**: testing web apps, MCP server generation
- **特徴**: コード生成、テスト自動化

**パターン:**
- テンプレートパターン（コード生成の雛形）
- 検証ループ（generate → validate → fix）

**自スキルでの適用:**
- [ ] テンプレートやコードスニペットを提供
- [ ] フィードバックループを実装（生成→検証→修正）

### 4. Enterprise & Communication（企業・コミュニケーション）
- **例**: branded documents, workflow automation
- **特徴**: 組織固有の規約やスタイルガイド

**パターン:**
- スタイルガイドを別ファイルに分離
- チーム固有の用語集やテンプレート

**自スキルでの適用:**
- [ ] 組織固有の情報は参照ファイルに分離
- [ ] 複数チームで使う場合は、チーム別に参照ファイルを用意

## 命名規則パターン

### スキル名（name フィールド）

**観察されたパターン:**
- **単一単語**: `docx`, `pdf`, `pptx`, `xlsx`
- **ハイフン区切り**: `mcp-server-generation`, `web-app-testing`
- **動名詞形式**: `processing-pdfs`, `analyzing-data`

**推奨:**
- 短く（1-3単語）、明確
- 小文字とハイフンのみ
- 動名詞形式（-ing）が推奨されている

**自スキルでの適用:**
- [ ] スキル名は動名詞形式を検討（例: `analyzing-logs` より `log-analysis`）
- [ ] 曖昧な名前（`helper`, `utils`）を避ける

### ディレクトリ名

**観察されたパターン:**
- `skills/` ディレクトリ配下に各スキル
- `skill-name/` がそのままスキルのルート
- `reference/`, `scripts/`, `templates/` などのサブディレクトリ

**自スキルでの適用:**
- [ ] `.claude/skills/skill-name/` に配置
- [ ] サブディレクトリは用途別に分ける（`reference/`, `scripts/`, `templates/`）

## ファイル構成パターン

### パターン 1: シンプルなスキル（SKILL.md のみ）

```
simple-skill/
└── SKILL.md
```

**適用タイミング:**
- 指示が短い（500行未満）
- 追加のスクリプトや参照が不要

### パターン 2: 参照ファイルを持つスキル

```
medium-skill/
├── SKILL.md
└── reference/
    ├── api-reference.md
    └── examples.md
```

**適用タイミング:**
- SKILL.md が500行を超える
- API リファレンスや詳細例が必要

### パターン 3: スクリプトを含むスキル

```
complex-skill/
├── SKILL.md
├── reference/
│   └── api-reference.md
└── scripts/
    ├── analyze.py
    └── validate.py
```

**適用タイミング:**
- 実行可能なスクリプトが必要
- 検証やフィードバックループが必要

**自スキルでの適用:**
- [ ] まず SKILL.md のみでスタート
- [ ] 500行を超えたら参照ファイルに分割
- [ ] スクリプトが必要になったら `scripts/` を追加

## ベストプラクティスの実践例

### 1. Progressive Disclosure（段階的開示）

**観察例:**
```markdown
# PDF Processing

## Quick start
[基本的な使い方]

## Advanced features
**Form filling**: See [FORMS.md](FORMS.md)
**API reference**: See [REFERENCE.md](REFERENCE.md)
```

**自スキルでの適用:**
- [ ] SKILL.md は概要とナビゲーション
- [ ] 詳細は参照ファイルへリンク
- [ ] 参照は1階層に限定

### 2. 例示パターン（Examples）

**観察例:**
```markdown
## Examples

**Example 1: Extract text**
Input: PDF with text content
Output: Extracted plain text

**Example 2: Fill forms**
Input: PDF form + data
Output: Filled PDF
```

**自スキルでの適用:**
- [ ] 入力/出力のペアで例を示す
- [ ] 複数のユースケースをカバー
- [ ] 具体的で現実的な例を使用

### 3. ガイドライン（Guidelines）

**観察例:**
```markdown
## Guidelines

- Always validate PDF structure before processing
- Use pdfplumber for text extraction
- Use PyPDF2 for form filling
- Handle encrypted PDFs separately
```

**自スキルでの適用:**
- [ ] 制約や推奨事項を箇条書き
- [ ] 「常に〜する」「〜を避ける」など明確に
- [ ] ツールやライブラリの選択基準を示す

## ディレクトリ構造の比較

### 公式リポジトリの構造

```
anthropics/skills/
├── .claude-plugin/          # プラグイン設定
├── skills/                  # スキル本体
│   ├── docx/
│   ├── pdf/
│   ├── pptx/
│   └── xlsx/
├── spec/                    # 仕様書
├── template/                # テンプレート
└── README.md
```

### 自プロジェクトでの適用

```
.claude/
└── skills/
    ├── skill-1/
    │   ├── SKILL.md
    │   └── reference/
    ├── skill-2/
    │   ├── SKILL.md
    │   ├── reference/
    │   └── scripts/
    └── [other skills]/
```

**チェックポイント:**
- [ ] `.claude/skills/` 配下に各スキルを配置
- [ ] 各スキルは自己完結型のフォルダ
- [ ] 共通のテンプレートやツールは別途管理

## 利用プラットフォーム別の注意点

### Claude Code
```bash
# プラグインとしてインストール可能
/plugin marketplace add anthropics/skills
/plugin install document-skills@anthropic-agent-skills
```

**自スキルでの適用:**
- [ ] `.claude/skills/` に配置すれば自動的に利用可能
- [ ] プラグイン化は不要（プロジェクト内で直接使用）

### Claude.ai
- 有料プランでスキルが利用可能

**自スキルでの適用:**
- [ ] Claude Code とは別環境（互換性を意識）

### Claude API
- Skills API を経由してプログラマティックに利用

**自スキルでの適用:**
- [ ] API経由での利用を想定する場合は、API リファレンスを確認

## 重要な免責事項

公式リポジトリより:

> **これらのスキルはデモンストレーションおよび教育目的でのみ提供されています。** 実装は Claude の実際の動作と異なる場合があります。本番環境で使用する前に、必ず自身の環境で徹底的にテストしてください。

**自スキルでの適用:**
- [ ] 公式スキルはあくまで参考実装
- [ ] 自環境でテストし、必要に応じてカスタマイズ
- [ ] ベストプラクティスは参考にしつつ、プロジェクトのニーズに合わせる

## 参考リンク

- [anthropics/skills リポジトリ](https://github.com/anthropics/skills)
- [Skills API Quickstart](https://docs.claude.com/en/api/skills-guide)
- [Notion Skills for Claude](https://www.notion.so/notiondevs/Notion-Skills-for-Claude-28da4445d27180c7af1df7d8615723d0)

## チェックリスト: 公式パターンの適用

自スキルを作成・改善する際に、以下のチェックリストを参照してください:

### ファイル構造
- [ ] `SKILL.md` がスキルのルートに存在
- [ ] 参照ファイルは `reference/` に配置
- [ ] スクリプトは `scripts/` に配置
- [ ] テンプレートは `templates/` に配置（必要に応じて）

### SKILL.md の構成
- [ ] YAML frontmatter が正しい（`name` と `description`）
- [ ] 概要セクションが存在
- [ ] Examples セクションで具体例を提示
- [ ] Guidelines セクションで制約を明示

### Progressive Disclosure
- [ ] SKILL.md は500行以内
- [ ] 詳細は参照ファイルに分離
- [ ] 参照は1階層に限定
- [ ] 長い参照ファイルには TOC

### 命名規則
- [ ] スキル名は小文字とハイフンのみ
- [ ] 動名詞形式を検討
- [ ] 曖昧な名前を避ける

### カテゴリ別パターン
- [ ] Document Skills: スクリプトとAPI参照を分離
- [ ] Creative & Design: ワークフローと例示を重視
- [ ] Development & Technical: テンプレートとフィードバックループ
- [ ] Enterprise: 組織固有情報を参照ファイルに分離
