#!/usr/bin/env bash
# .devcontainer/init-tmp-volume.sh
set -euo pipefail

TMP_DIR="/workspaces/tmp"
# 実行ユーザー（remoteUser: vscode）のUID/GIDを導出（TASK-006）
TARGET_UID=$(id -u)
TARGET_GID=$(id -g)

# sudo -n の事前チェック（REQ-011）
if ! sudo -n true 2>/dev/null; then
  echo "[$(date)] ✗ ERROR: パスワード不要のsudoが必要です" >&2
  echo "  必要な対応:" >&2
  echo "  - devcontainer.jsonで 'remoteUser': 'vscode' が設定されていることを確認" >&2
  echo "  - または、sudoersにNOPASSWD設定を追加" >&2
  exit 1
fi

echo "[$(date)] Initializing $TMP_DIR permissions..."

# ディレクトリが存在しない場合は作成（初回のみ - TASK-008: エラーハンドリング強化）
# mode 0755: 所有者は rwx、グループとその他は rx（セキュリティと利便性のバランス）
if [ ! -d "$TMP_DIR" ]; then
  if ! sudo -n install -d -o ${TARGET_UID} -g ${TARGET_GID} -m 0755 "$TMP_DIR"; then
    echo "[$(date)] ✗ ERROR: $TMP_DIR の作成に失敗しました" >&2
    echo "  実行コマンド: sudo -n install -d -o ${TARGET_UID} -g ${TARGET_GID} -m 0755 \"$TMP_DIR\"" >&2
    echo "  必要な対応:" >&2
    echo "  - sudo権限を確認してください" >&2
    echo "  - ディスク容量を確認してください" >&2
    exit 1
  fi
  echo "[$(date)] ✓ Created $TMP_DIR with ownership ${TARGET_UID}:${TARGET_GID}"
else
  # 既存の場合は、トップレベルの権限のみ確認・修正（chown -R は使用しない - TASK-008: エラーハンドリング強化）
  CURRENT_OWNER=$(stat -c "%u:%g" "$TMP_DIR")
  if [ "$CURRENT_OWNER" != "${TARGET_UID}:${TARGET_GID}" ]; then
    if ! sudo -n chown ${TARGET_UID}:${TARGET_GID} "$TMP_DIR"; then
      echo "[$(date)] ✗ ERROR: $TMP_DIR の所有者変更に失敗しました" >&2
      echo "  実行コマンド: sudo -n chown ${TARGET_UID}:${TARGET_GID} \"$TMP_DIR\"" >&2
      echo "  現在の所有者: $CURRENT_OWNER" >&2
      echo "  必要な対応:" >&2
      echo "  - sudo権限を確認してください" >&2
      exit 1
    fi
    echo "[$(date)] ✓ Updated $TMP_DIR ownership to ${TARGET_UID}:${TARGET_GID}"
  else
    echo "[$(date)] ✓ $TMP_DIR ownership already correct (${TARGET_UID}:${TARGET_GID})"
  fi
fi
