#!/usr/bin/env bash
# .devcontainer/init-tmp-volume.sh
set -euo pipefail

TMP_DIR="/workspaces/tmp"
TARGET_UID=1000
TARGET_GID=1000

# sudo -n の事前チェック（REQ-011）
if ! sudo -n true 2>/dev/null; then
  echo "[$(date)] ✗ ERROR: パスワード不要のsudoが必要です" >&2
  echo "  必要な対応:" >&2
  echo "  - devcontainer.jsonで 'remoteUser': 'vscode' が設定されていることを確認" >&2
  echo "  - または、sudoersにNOPASSWD設定を追加" >&2
  exit 1
fi

echo "[$(date)] Initializing $TMP_DIR permissions..."

# ディレクトリが存在しない場合は作成（初回のみ）
# mode 0755: 所有者は rwx、グループとその他は rx（セキュリティと利便性のバランス）
if [ ! -d "$TMP_DIR" ]; then
  sudo -n install -d -o ${TARGET_UID} -g ${TARGET_GID} -m 0755 "$TMP_DIR"
  echo "[$(date)] ✓ Created $TMP_DIR with ownership ${TARGET_UID}:${TARGET_GID}"
else
  # 既存の場合は、トップレベルの権限のみ確認・修正（chown -R は使用しない）
  CURRENT_OWNER=$(stat -c "%u:%g" "$TMP_DIR")
  if [ "$CURRENT_OWNER" != "${TARGET_UID}:${TARGET_GID}" ]; then
    sudo -n chown ${TARGET_UID}:${TARGET_GID} "$TMP_DIR"
    echo "[$(date)] ✓ Updated $TMP_DIR ownership to ${TARGET_UID}:${TARGET_GID}"
  else
    echo "[$(date)] ✓ $TMP_DIR ownership already correct (${TARGET_UID}:${TARGET_GID})"
  fi
fi
