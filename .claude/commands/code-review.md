---
name: review
description: コードレビューを実施する（PR番号/URL、git diffコマンド、Markdownレビュー結果に対応）
allowed-tools: []
argument-hint: PR番号/URL（例: "#123"）、git diffコマンド（例: "git diff --staged"）、Markdownファイルパス（例: "ai/reviews/251220_pr-123-review.md"）
---

## タスク

`code-reviewer` エージェントを使用してコードレビューを実施します。エージェントが入力形式の判定、情報取得、レビュー実施、結果保存を一貫して処理します。
