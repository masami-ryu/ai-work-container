# 開発ツール設定の永続化と Codex 認証情報のバックアップ

devcontainer rebuild 後に Codex 認証や tmux 設定を再設定しないため、Docker volume `dev-home-data` を `/home/vscode/.dev-home-data` にマウントする。

主な配置:

- `/home/vscode/.dev-home-data/codex` → `/home/vscode/.codex`
- `/home/vscode/.dev-home-data/tmux/tmux.conf` → `/home/vscode/.tmux.conf`

`/home/vscode/.codex` と `/home/vscode/.tmux.conf` は `.devcontainer/post-create.sh` で symlink として作成する。

## 初回バックアップ

`dev-home-data` volume を使えない環境へ退避する場合のみ、Codex を終了してから実行する。

`codex-data` volume から `dev-home-data` volume へ切り替える初回 rebuild 前にも実行する。Docker は volume 名変更時に既存 volume の中身を自動移行しない。

```bash
mkdir -p /workspaces/ai-work-container/backup
rsync -a --delete \
  --exclude 'cache/' \
  --exclude 'tmp/' \
  --exclude '.tmp/' \
  /home/vscode/.dev-home-data/codex/ \
  /workspaces/ai-work-container/backup/.codex/
chmod -R go-rwx /workspaces/ai-work-container/backup/.codex
```

主な保存対象:

- `auth.json`
- `config.toml`
- `sessions/`
- `history.jsonl`
- `state_*.sqlite`, `goals_*.sqlite`, `logs_*.sqlite`

## rebuild 後の復元経路

通常は `dev-home-data` volume から自動的に復元される。

`backup/.codex` が存在し、かつ `/home/vscode/.dev-home-data/codex` が空の場合は、`.devcontainer/post-create.sh` がバックアップから復元する。

```bash
CODEX_BACKUP="/workspaces/ai-work-container/backup/.codex"
CODEX_DATA_DIR="/home/vscode/.dev-home-data/codex"

if [ -z "$(find "$CODEX_DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] && [ -d "$CODEX_BACKUP" ]; then
  echo "Codex 設定をバックアップから復元します..."
  rsync -a "$CODEX_BACKUP/" "$CODEX_DATA_DIR/"
  chown -R vscode:vscode "$CODEX_DATA_DIR"
  chmod -R go-rwx "$CODEX_DATA_DIR"
fi
```

`backup/` は `.gitignore` 済み。ただし `backup/.codex/auth.json` は秘密情報なので、共有・圧縮・外部保存しない。
