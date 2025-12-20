---
name: skills-bestpractice-investigating
description: Agent Skills のベストプラクティスを調査する。プロジェクト内の references/ を使って設計思想・実装パターン・優良実装例を抽出し、4セクション形式（要点/根拠リンク/推奨アクション/注意点）で整理する。Use when: Skills の設計ガイドライン、progressive disclosure、allowed-tools、anthropics/skills の実装例を調べたいとき。
allowed-tools: [Read, Grep, Glob, Bash, WebFetch]
---

## 概要

このスキルは Agent Skills のベストプラクティスを体系的に調査するために使用します。公式ドキュメントと公式リポジトリから設計思想・実装パターン・具体例を抽出し、実務で使える形に整理します。

## 調査ワークフロー

このスキルを使う際は、以下のチェックリストに従って調査を進めてください:

- [ ] **Step 1: 問いの分類** - ユーザーの問いが「設計思想」「実装方法」「具体例」のどれに該当するか特定する
- [ ] **Step 2: 参照先の選択** - 下記の「参照ファイルの読み分け」に従って適切な情報源を選択する
- [ ] **Step 3: 情報抽出** - 選択した参照先から関連情報を抽出する
- [ ] **Step 4: 要点の統合** - 抽出した情報をチェックリスト形式の要点にまとめる
- [ ] **Step 5: 出力** - 下記の「出力テンプレート」に従って整形し、ユーザーに提示する

## 参照ファイルの読み分け

問いの内容に応じて、以下のように参照先を使い分けてください:

### 設計思想について問われたとき
- **参照先**: `references/best-practices.md`
- **対象トピック**: progressive disclosure（段階的開示）、記述の粒度、ワークフロー設計、簡潔さの原則
- **例**: 「SKILL.md を軽量に保つ方法は?」「段階的開示の実装方法は?」

### Claude Code 固有の実装について問われたとき
- **参照先**: `references/claude-code-skills.md`
- **対象トピック**: allowed-tools の使い方、Personal/Project Skills の配置、トラブルシュート
- **例**: 「allowed-tools の設定方法は?」「Personal Skills と Project Skills の違いは?」

### 具体的な実装例について問われたとき
- **参照先**: `references/reference-implementations.md`
- **対象トピック**: 公式リポジトリ（anthropics/skills）の優良実装、ディレクトリ構成パターン、プロンプトの書きぶり
- **例**: 「公式の SKILL.md はどう書かれている?」「ファイル構成の良い例は?」

### 複合的な問いの場合
複数の参照先を組み合わせて調査してください。例:
- 「allowed-tools を使った progressive disclosure の実装例は?」→ `claude-code-skills.md` + `reference-implementations.md`

## 出力テンプレート

調査結果は以下のフォーマットで提示してください:

### 要点
- [調査で得られた重要ポイントを箇条書き]
- [実務で適用する際の具体的なアクション]

### 根拠リンク
- [公式ドキュメントへのリンク]
- [公式リポジトリへのリンク]
- [参照した内部ファイルへのパス]

### 推奨アクション
- [ユーザーが次に取るべき具体的なステップ]
- [適用時のチェックポイント]

### 注意点
- [よくある落とし穴や誤解されやすいポイント]
- [適用する際の制約事項]

## 主要な情報源

このスキルは以下の公式ソースを参照します:

- **設計ガイドライン**: [Claude Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) - Skills 設計の思想と設計論
- **実装マニュアル**: [Agent Skills - Claude Code Docs](https://code.claude.com/docs/en/skills) - Claude Code 固有の実装仕様
- **リファレンス実装**: [Claude Skills 公式リポジトリ](https://github.com/anthropics/skills) - 実際のファイル構成とプロンプトの書きぶり
