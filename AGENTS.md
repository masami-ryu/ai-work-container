# Codex Bridge

このリポジトリの運用ルール本体は [CLAUDE.md](./CLAUDE.md)。
Codex でも同一ルールを適用するため、まず `CLAUDE.md` を参照して従うこと。

## Skills

- Canonical path: `.claude/skills`
- Codex compatibility path: `.agents/skills`（`.claude/skills` への symlink）
- スキル編集は `.claude/skills` 側で行うこと

## Minimum Rules

- 日本語で記述する
- Node.js 系の依存関係管理・スクリプト実行は `pnpm` を使用する
- 成果物命名は `YYMMDD_HHmm_[概要].md`（JST）を使う
- `works*` は独立リポジトリとして `works*/CLAUDE.md` を参照する
