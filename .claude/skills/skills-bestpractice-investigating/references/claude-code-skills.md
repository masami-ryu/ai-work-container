# Claude Code Skills 固有仕様

このファイルは Claude Code 固有の Skills 実装仕様をまとめたものです。

## 1. allowed-tools の設定

### 概要
`allowed-tools` フィールドを使用すると、スキルがアクティブな間に Claude が使用できるツールを制限できます。

### 設定例

```yaml
---
name: safe-file-reader
description: Read files without making changes. Use when you need read-only file access.
allowed-tools: [Read, Grep, Glob]
---
```

### 使用できるツール一覧
- `Read`: ファイル読み取り
- `Write`: ファイル書き込み
- `Edit`: ファイル編集
- `Grep`: コンテンツ検索
- `Glob`: ファイルパターンマッチング
- `Bash`: シェルコマンド実行
- `WebFetch`: Web コンテンツ取得
- `WebSearch`: Web 検索
- `Task`: サブエージェント起動
- など（詳細は Claude Code ドキュメントを参照）

### ユースケース

| ユースケース | allowed-tools 設定 | 理由 |
|------------|-------------------|------|
| 読み取り専用調査 | `[Read, Grep, Glob]` | ファイル変更を防ぐ |
| データ分析のみ | `[Read, Bash]` | ファイル書き込みを防ぎ、分析コマンドのみ許可 |
| ドキュメント作成 | `[Read, Write, Grep, Glob]` | 読み取りと書き込みのみ、危険なコマンドは不可 |

### チェックポイント
- [ ] `allowed-tools` が未指定の場合、Claude は通常通りツールの許可を求める
- [ ] `allowed-tools` は Claude Code でのみサポートされる（Web版では無効）
- [ ] 制限が厳しすぎると、スキルが機能しない可能性がある

## 2. Personal Skills vs Project Skills

### 配置場所と用途

| 種別 | 配置場所 | スコープ | ユースケース | git 管理 |
|------|---------|---------|-------------|---------|
| **Personal Skills** | `~/.claude/skills/` | 個人のワークフロー | 個人的な好み、実験的なスキル、生産性ツール | 不要 |
| **Project Skills** | `.claude/skills/` | チーム共有 | チームワークフロー、プロジェクト固有の専門知識、共有ユーティリティ | 推奨 |

### 使い分けの指針

#### Personal Skills を使うべき場合
- 個人的なコーディングスタイルの好み
- 実験的なスキル（まだチームに共有したくない）
- 個人的な生産性向上ツール
- 複数のプロジェクトで再利用するスキル

#### Project Skills を使うべき場合
- チーム全体で使用するワークフロー
- プロジェクト固有のドメイン知識（API仕様、データベーススキーマなど）
- チームの規約やスタイルガイド
- プロジェクト固有のツールやスクリプト

### チェックポイント
- [ ] **チーム共有が必要か?** → Yes なら Project Skills
- [ ] **プロジェクト固有の知識か?** → Yes なら Project Skills
- [ ] **個人的な実験か?** → Yes なら Personal Skills
- [ ] **複数のプロジェクトで使うか?** → Yes なら Personal Skills

### git での管理

**Project Skills の場合:**
```bash
# .gitignore に含めない（チームで共有する）
# .claude/skills/ は git に commit する
git add .claude/skills/my-skill/
git commit -m "Add: my-skill for team workflow"
git push
```

**Personal Skills の場合:**
```bash
# git 管理不要（個人のホームディレクトリに配置）
# ~/.claude/skills/ は自動的に各個人の環境で利用可能
```

## 3. SKILL.md ファイル構造

### 最小限の構造

```yaml
---
name: your-skill-name
description: Brief description of what this Skill does and when to use it
---

# Your Skill Name

## Instructions
Provide clear, step-by-step guidance for Claude.

## Examples
Show concrete examples of using this Skill.
```

### フィールド要件

#### name フィールド
- **最大64文字**
- **小文字、数字、ハイフンのみ**（大文字不可、アンダースコア不可）
- **XMLタグを含まない**
- **予約語を使わない**: "anthropic", "claude"

**良い例:**
- `processing-pdfs`
- `analyzing-spreadsheets`
- `managing-databases`

**悪い例:**
- `Processing_PDFs` (大文字とアンダースコア)
- `helper` (曖昧)
- `claude-helper` (予約語)

#### description フィールド
- **最大1024文字**
- **空でない**
- **XMLタグを含まない**
- **三人称で記述** (例: "Processes Excel files", NOT "I can help you...")
- **何をするか + いつ使うか** の両方を含める

### ディレクトリ構造例

```
my-skill/
├── SKILL.md (必須)
├── reference.md (オプション: 詳細ドキュメント)
├── examples.md (オプション: 使用例)
├── scripts/
│   └── helper.py (オプション: ユーティリティスクリプト)
└── templates/
    └── template.txt (オプション: テンプレート)
```

### 参照ファイルのリンク方法

SKILL.md から相対リンクで参照:
```markdown
**API Reference**: See [reference.md](reference.md)
**Usage Examples**: See [examples.md](examples.md)
**Form Filling Guide**: See [forms/FORMS.md](forms/FORMS.md)
```

### チェックポイント
- [ ] YAML frontmatter が正しい（`---` で開始・終了）
- [ ] `name` と `description` が必須フィールドとして存在
- [ ] `name` が命名規則に準拠（小文字、数字、ハイフンのみ）
- [ ] `description` が「何をするか + いつ使うか」を含む
- [ ] 参照ファイルは相対パスでリンク

## 4. トラブルシューティング

### 問題 1: Claude がスキルを使わない

#### 原因: description が曖昧
```yaml
# ❌ 曖昧な例
description: Helps with documents
```

#### 解決策: 具体的なトリガーワードを含める
```yaml
# ✅ 具体的な例
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

#### チェックリスト
- [ ] description に「いつ使うか」が含まれている
- [ ] 具体的なトリガーワード（PDF, Excel, .xlsx など）が含まれている
- [ ] 三人称で記述されている

### 問題 2: ファイルパスが見つからない

#### 確認方法
```bash
# Personal Skills
ls ~/.claude/skills/my-skill/SKILL.md

# Project Skills
ls .claude/skills/my-skill/SKILL.md
```

#### チェックリスト
- [ ] ファイル名が `SKILL.md` (大文字) である
- [ ] ディレクトリ名が `name` フィールドと一致している
- [ ] パスが正しい場所に配置されている

### 問題 3: YAML 構文エラー

#### 確認方法
```bash
cat SKILL.md | head -n 10
```

#### チェックリスト
- [ ] 1行目が `---` で始まっている
- [ ] frontmatter が `---` で閉じられている
- [ ] タブではなくスペースでインデント
- [ ] `name:` と `description:` が正しく記述されている

### 問題 4: 複数のスキルが競合

#### 原因: トリガーワードが重複している

#### 解決策: 明確に区別する
```yaml
# Skill 1
description: Analyze sales data in Excel files and CRM exports. Use for sales reports, pipeline analysis, and revenue tracking.

# Skill 2
description: Analyze log files and system metrics data. Use for performance monitoring, debugging, and system diagnostics.
```

#### チェックリスト
- [ ] 各スキルのトリガーワードが明確に異なる
- [ ] description が具体的なユースケースを含む

### 問題 5: 利用可能なスキルを確認したい

#### 確認方法

**Claude に直接質問:**
```
What Skills are available?
```

**ファイルシステムで確認:**
```bash
# Personal Skills
ls ~/.claude/skills/

# Project Skills
ls .claude/skills/
```

## 5. ランタイム環境

### ファイルシステムアクセス
- Claude は bash ツールを使用して SKILL.md や参照ファイルにアクセスする
- スクリプトはコンテキストにロードせずに実行可能（トークン消費を節約）
- 大きなファイルは実際に読み取られるまでトークンを消費しない

### パスの扱い
- **前方スラッシュを使用**: `scripts/helper.py` (OK)
- **バックスラッシュは避ける**: `scripts\helper.py` (NG, Windows でも前方スラッシュを使う)

### パッケージ依存関係
- **claude.ai**: npm と PyPI からパッケージをインストール可能、GitHub リポジトリも取得可能
- **Anthropic API**: ネットワークアクセスなし、ランタイムパッケージインストール不可

#### チェックリスト
- [ ] 必要なパッケージを SKILL.md にリストアップ
- [ ] Code Execution Tool ドキュメントで利用可能性を確認
- [ ] パスはすべて前方スラッシュを使用

## 6. モデル起動 vs ユーザー起動

### 重要な違い

**Skills はモデル起動（自動発火）:**
- Claude が description を見て自動的に判断
- ユーザーは明示的に起動しない
- description の品質が発火の鍵

**Slash Commands はユーザー起動:**
- ユーザーが `/command` で明示的に起動
- 説明は補助的

### チェックポイント
- [ ] スキルは「いつ使うか」が description に明確に記述されている
- [ ] ユーザーに「このスキルを使って」と指示させる必要がない
- [ ] トリガーワードが自然な会話で出現する

## 参考リンク

- [Agent Skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Code Execution Tool Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
