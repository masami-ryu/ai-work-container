---
name: review
description: コードレビューを実施する（PR番号/URL、git diffコマンド、Markdownレビュー結果に対応）
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, WebFetch
argument-hint: PR番号/URL（例: "#123"）、git diffコマンド（例: "git diff --staged"）、Markdownファイルパス（例: "ai/reviews/251220_pr-123-review.md"）
---

## タスク

`code-reviewing` skillを使用してコードレビューを実施します。
