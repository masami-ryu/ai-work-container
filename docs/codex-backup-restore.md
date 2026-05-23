# Codex 認証情報のバックアップと復元

devcontainer rebuild 後に Codex 認証を再設定しないため、`/home/vscode/.codex` を `backup/.codex` に退避する。

## 初回バックアップ

Codex を終了してから実行する。

```bash
mkdir -p /workspaces/ai-work-container/backup
rsync -a --delete \
  --exclude 'cache/' \
  --exclude 'tmp/' \
  --exclude '.tmp/' \
  /home/vscode/.codex/ \
  /workspaces/ai-work-container/backup/.codex/
chmod -R go-rwx /workspaces/ai-work-container/backup/.codex
```

主な保存対象:

- `auth.json`
- `config.toml`
- `sessions/`
- `history.jsonl`
- `state_*.sqlite`, `goals_*.sqlite`, `logs_*.sqlite`

## rebuild 後の復元

`.devcontainer/post-create.sh` の早い段階に追加する。

```bash
CODEX_BACKUP="/workspaces/ai-work-container/backup/.codex"
CODEX_HOME="/home/vscode/.codex"

if [ ! -d "$CODEX_HOME" ] && [ -d "$CODEX_BACKUP" ]; then
  echo "Codex 設定をバックアップから復元します..."
  mkdir -p "$CODEX_HOME"
  rsync -a "$CODEX_BACKUP/" "$CODEX_HOME/"
  chown -R vscode:vscode "$CODEX_HOME"
  chmod -R go-rwx "$CODEX_HOME"
fi
```

`backup/` は `.gitignore` 済み。ただし `backup/.codex/auth.json` は秘密情報なので、共有・圧縮・外部保存しない。
