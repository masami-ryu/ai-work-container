#!/bin/bash
# backup-devcontainer.sh
BACKUP_DIR=".devcontainer/backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# devcontainer設定ファイルのバックアップ
cp .devcontainer/devcontainer.json "$BACKUP_DIR/devcontainer.json.${TIMESTAMP}.bak"
cp .devcontainer/docker-compose.yml "$BACKUP_DIR/docker-compose.yml.${TIMESTAMP}.bak" 2>/dev/null || echo "[INFO] docker-compose.yml not found (OK if not migrated yet)"

# スクリプト類のバックアップ
cp .devcontainer/post-create.sh "$BACKUP_DIR/post-create.sh.${TIMESTAMP}.bak" 2>/dev/null || true
cp .devcontainer/Dockerfile "$BACKUP_DIR/Dockerfile.${TIMESTAMP}.bak" 2>/dev/null || true

# 新規追加スクリプトのバックアップ（マルチプロジェクト環境に必須）
cp .devcontainer/init-project.sh "$BACKUP_DIR/init-project.sh.${TIMESTAMP}.bak" 2>/dev/null || echo "[INFO] init-project.sh not found (OK if not created yet)"
cp .devcontainer/setup-project-links.sh "$BACKUP_DIR/setup-project-links.sh.${TIMESTAMP}.bak" 2>/dev/null || echo "[INFO] setup-project-links.sh not found (OK if not created yet)"

# Dockerボリューム一覧の記録（全プロジェクト関連ボリュームを取得）
# ai-work-container プレフィックス、-node_modules サフィックス、claude- プレフィックスの全パターンを取得
docker volume ls --format '{{.Name}}' | grep -E "(^ai-work-container|-node_modules$|^claude-)" > "$BACKUP_DIR/volumes.${TIMESTAMP}.txt"

echo "Backup completed: $BACKUP_DIR"
echo "Files backed up:"
ls -lh "$BACKUP_DIR"/*${TIMESTAMP}*
