# Codex sandbox 運用メモ

## 方針

Windows 11 + WSL2 + devcontainer 環境では、Codex の Linux sandbox が `bubblewrap`、user namespace、seccomp などの制約で失敗することがある。

このリポジトリでは、devcontainer を外側の隔離境界として扱い、container 内で動く Codex は内側 sandbox を無効化する。

## Codex 設定

`~/.codex/config.toml` に以下を設定する。

```toml
sandbox_mode = "danger-full-access"
approval_policy = "on-request"
```

`danger-full-access` は Codex の filesystem / network sandbox を無効化する。

`on-request` は承認フローを残すため、必要に応じてユーザー確認が発生する。

## 運用上の前提

- Codex は devcontainer 内の通常ユーザーで実行する
- ホストの `$HOME` 全体や Docker socket を不用意に mount しない
- secret、API key、SSH key は必要最小限だけ container に渡す
- 作業対象は workspace 配下に限定する

## 補足

`default_permissions = ":danger-full-access"` は新しい permission profiles 系の設定だが、現時点では beta 扱いのため、このリポジトリでは旧来の `sandbox_mode` を使う。

`default_permissions` と `sandbox_mode` は混在させない。
