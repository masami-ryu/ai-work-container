---
name: code-reviewing
description: コードレビューの専門スキル。PR・git差分・Markdownレビュー結果に対応。5段階レビュープロセス（初期分析→詳細分析→ベストプラクティス参照→統合評価→品質検証）でコード品質・セキュリティ・パフォーマンスを評価。
allowed-tools: [Read, Grep, Glob, WebFetch]
---

# Code Reviewing

## Contents
- [概要](#概要)
- [主要機能](#主要機能)
- [5段階レビュープロセス](#5段階レビュープロセス)
- [Guidelines](#guidelines)
- [Limitations](#limitations)

## 概要

このスキルはコード品質、セキュリティ、パフォーマンス、テスト、設計を総合的に評価し、エビデンスベースのフィードバックを提供します。入力形式の判定や情報取得は code-reviewer エージェントが担当し、このスキルは純粋なレビューロジックに集中します。

## 主要機能

- 5段階レビュープロセスによる体系的な評価
- レビュー観点別評価（品質/セキュリティ/パフォーマンス/テスト/設計）
- エビデンスベースのフィードバック（目標80%以上）
- Markdownレビュー結果のメタレビュー対応

## 5段階レビュープロセス

| Phase | 目的 | 主要アクション |
|-------|------|---------------|
| **1. 初期分析** | 変更内容を把握 | エージェントから受け取った差分情報を分析 |
| **2. 詳細分析** | 影響範囲と依存関係を理解 | `Read`/`Grep`で変更ファイル分析、依存関係追跡 |
| **3. ベストプラクティス参照** | 外部知識を収集 | `WebFetch`で公式ドキュメント・ベストプラクティス取得 |
| **4. 統合評価** | レビュー観点別に評価 | Phase 1-3の情報を統合、エビデンス付与（80%以上） |
| **5. 品質検証** | レビュー結果を検証 | チェックリスト実行、評価結果をエージェントに返却 |

## Guidelines

### レビュー観点

各観点の詳細ガイドラインは以下を参照:

- **コード品質**: [guidelines/code-quality.md](guidelines/code-quality.md)
- **セキュリティ**: [guidelines/security.md](guidelines/security.md)
- **パフォーマンス**: [guidelines/performance.md](guidelines/performance.md)
- **テスト**: [guidelines/testing.md](guidelines/testing.md)
- **設計**: [guidelines/design.md](guidelines/design.md)

### エビデンスベースのフィードバック

全指摘の80%以上にエビデンス（公式ドキュメント、コード例、影響範囲）を付与。詳細は [guidelines/feedback-format.md](guidelines/feedback-format.md) を参照。

### 出力フォーマット

レビュー結果のテンプレートは [templates/review-template.md](templates/review-template.md) を参照。レビュー結果は構造化されたMarkdown形式でエージェントに返却します。

### 自己検証チェックリスト

レビュー完了前に [guidelines/checklist.md](guidelines/checklist.md) のチェックリストを実行（目標: 全項目クリア）。

## Limitations

- コードの直接修正は行わない（レビュー結果の返却のみ）
- WebFetchの利用可能性に依存（外部ドキュメント検索）
- 入力形式の判定や情報取得、結果の保存は code-reviewer エージェントが担当

## 参照ガイド

### guidelines/
レビュー観点別の詳細ガイドライン:
- [code-quality.md](guidelines/code-quality.md) - コード品質チェック項目
- [security.md](guidelines/security.md) - セキュリティチェック項目
- [performance.md](guidelines/performance.md) - パフォーマンスチェック項目
- [testing.md](guidelines/testing.md) - テストチェック項目
- [design.md](guidelines/design.md) - 設計チェック項目
- [feedback-format.md](guidelines/feedback-format.md) - フィードバック形式
- [checklist.md](guidelines/checklist.md) - 自己検証チェックリスト

### templates/
レビュー結果のテンプレート:
- [review-template.md](templates/review-template.md) - レビュー結果の標準フォーマット

## Version History

- **3.0.0** (2025-12-24): 責務分離対応（情報取得・保存をエージェントに移管、レビューロジックに集中）
- **2.0.0** (2025-12-22): 汎用化対応（PR/git差分/Markdownレビュー結果の3入力形式に対応）
- **1.1.0** (2025-12-20): Progressive Disclosure適用（ガイドライン・テンプレートを分離）
- **1.0.0** (2025-12-20): 初版リリース
