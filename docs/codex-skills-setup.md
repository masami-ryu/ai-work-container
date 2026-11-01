# Codex Skills セットアップ

## スキル配置

スキルの実体はリポジトリルートの `.codex/skills` に置く。編集もこのディレクトリで行う。

互換用の `.agents/skills` は `../.codex/skills` を指す相対 symlink として Git 管理している。通常の clone 後に作成し直す必要はない。

Dev Container 内のリポジトリルートで確認する。

```bash
readlink .agents/skills
# 期待値: ../.codex/skills
test -d .agents/skills
```

symlink が欠けている場合だけ、次で再作成する。既存のディレクトリやファイルがある場合は、その内容を確認してから復旧する。

```bash
ln -s ../.codex/skills .agents/skills
```
