# Copilot CLI permissions 設定手順

Copilot CLI では Claude の `permissions` を `config.json` にそのまま保存できないため、`copilot` 起動ラッパーで揃える。

| Claude 側 | Copilot CLI 側 |
| --- | --- |
| `allow` の `Bash(...)` | `--allow-tool "shell(...)"` |
| `allow` の `Write` / `Edit` | `--allow-tool "write"` |
| `deny` の `Bash(...)` | `--deny-tool "shell(...)"` |
| `ask` | 指定しない |
| `Read(...)` | `trusted_folders` で管理 |

## 手順

1. `.claude/settings.local.json` の `permissions` を確認する。
2. `~/.bash_aliases` に `copilot()` を定義し、`allow` / `deny` を起動フラグへ移す。
3. `~/.bashrc` から `~/.bash_aliases` を読み込ませる。
4. `source ~/.bashrc` か新しいシェルで反映する。

```bash
copilot() {
  command copilot \
    --allow-tool "shell(git status)" \
    --allow-tool "shell(git diff)" \
    --allow-tool "write" \
    --deny-tool "shell(rm -rf)" \
    "$@"
}
```

`ask` にしたいコマンドはフラグを付けなければ毎回確認される。
