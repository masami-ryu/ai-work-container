#!/bin/bash
# rollback-devcontainer.sh
# 使用方法: ./rollback-devcontainer.sh <TIMESTAMP>
# 例: ./rollback-devcontainer.sh 20251212_120000

TIMESTAMP="$1"
BACKUP_DIR=".devcontainer/backup"

if [ -z "$TIMESTAMP" ]; then
    echo "Usage: $0 <TIMESTAMP>"
    echo "Available backups:"
    ls -1 "$BACKUP_DIR"/*.bak 2>/dev/null | sed 's/.*\.\\([0-9_]*\\)\.bak/\1/' | sort -u
    exit 1
fi

echo "Rolling back to backup: $TIMESTAMP"

# devcontainer.json の復元
if [ -f "$BACKUP_DIR/devcontainer.json.${TIMESTAMP}.bak" ]; then
    cp "$BACKUP_DIR/devcontainer.json.${TIMESTAMP}.bak" .devcontainer/devcontainer.json
    echo "[OK] devcontainer.json restored"
else
    echo "[WARN] devcontainer.json.${TIMESTAMP}.bak not found"
fi

# docker-compose.yml の復元
if [ -f "$BACKUP_DIR/docker-compose.yml.${TIMESTAMP}.bak" ]; then
    cp "$BACKUP_DIR/docker-compose.yml.${TIMESTAMP}.bak" .devcontainer/docker-compose.yml
    echo "[OK] docker-compose.yml restored"
else
    echo "[WARN] docker-compose.yml.${TIMESTAMP}.bak not found (may not have existed yet)"
fi

# post-create.sh の復元（オプション）
if [ -f "$BACKUP_DIR/post-create.sh.${TIMESTAMP}.bak" ]; then
    cp "$BACKUP_DIR/post-create.sh.${TIMESTAMP}.bak" .devcontainer/post-create.sh
    echo "[OK] post-create.sh restored"
fi

# Dockerfile の復元（オプション）
if [ -f "$BACKUP_DIR/Dockerfile.${TIMESTAMP}.bak" ]; then
    cp "$BACKUP_DIR/Dockerfile.${TIMESTAMP}.bak" .devcontainer/Dockerfile
    echo "[OK] Dockerfile restored"
fi

# 新規追加スクリプトの復元（マルチプロジェクト環境に必須）
if [ -f "$BACKUP_DIR/init-project.sh.${TIMESTAMP}.bak" ]; then
    cp "$BACKUP_DIR/init-project.sh.${TIMESTAMP}.bak" .devcontainer/init-project.sh
    echo "[OK] init-project.sh restored"
else
    echo "[WARN] init-project.sh.${TIMESTAMP}.bak not found (may not have existed yet)"
fi

if [ -f "$BACKUP_DIR/setup-project-links.sh.${TIMESTAMP}.bak" ]; then
    cp "$BACKUP_DIR/setup-project-links.sh.${TIMESTAMP}.bak" .devcontainer/setup-project-links.sh
    echo "[OK] setup-project-links.sh restored"
else
    echo "[WARN] setup-project-links.sh.${TIMESTAMP}.bak not found (may not have existed yet)"
fi

echo ""
echo "Rollback completed. You must rebuild the container to apply changes:"
echo "  VS Code: Ctrl+Shift+P → 'Dev Containers: Rebuild Container'"
echo "  CLI: docker compose -f .devcontainer/docker-compose.yml down && docker compose -f .devcontainer/docker-compose.yml up -d --build"
