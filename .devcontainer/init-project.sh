#!/bin/bash
# init-project.sh
# 使用方法: ./init-project.sh <project-name> [git-url]
# 冪等性: 既存のディレクトリ/設定がある場合はスキップ

set -e

PROJECT_NAME=$1
GIT_URL=$2
PROJECT_DIR="/workspaces/ai-work-container/repo/${PROJECT_NAME}"
DEVCONTAINER_DIR="${PROJECT_DIR}/.devcontainer"
TEMPLATE="/workspaces/ai-work-container/ai/templates/project-devcontainer.json"

# 引数チェック
if [ -z "$PROJECT_NAME" ]; then
    echo "Usage: $0 <project-name> [git-url]"
    exit 1
fi

# 1. ディレクトリ作成またはgit clone（冪等性: 既存ならスキップ）
if [ -d "$PROJECT_DIR" ]; then
    echo "[SKIP] Directory already exists: $PROJECT_DIR"
else
    if [ -n "$GIT_URL" ]; then
        echo "[CREATE] Cloning $GIT_URL to $PROJECT_DIR"
        git clone "$GIT_URL" "$PROJECT_DIR"
    else
        echo "[CREATE] Creating directory: $PROJECT_DIR"
        mkdir -p "$PROJECT_DIR"
    fi
fi

# 2. .devcontainer/devcontainer.json を生成（冪等性: 既存ならスキップ）
if [ -f "${DEVCONTAINER_DIR}/devcontainer.json" ]; then
    echo "[SKIP] devcontainer.json already exists"
else
    echo "[CREATE] Generating devcontainer.json"
    mkdir -p "$DEVCONTAINER_DIR"
    sed "s/\${PROJECT_NAME}/${PROJECT_NAME}/g" "$TEMPLATE" > "${DEVCONTAINER_DIR}/devcontainer.json"
fi

# 3. 共通設定へのシンボリックリンク作成
echo "[SETUP] Creating symbolic links for common settings"
/workspaces/ai-work-container/.devcontainer/setup-project-links.sh "$PROJECT_NAME"

# 4. node_modules用ボリューム設定をdocker-compose.ymlに追加（冪等性: 既存ならスキップ）
VOLUME_NAME="${PROJECT_NAME}-node_modules"
COMPOSE_FILE="/workspaces/ai-work-container/.devcontainer/docker-compose.yml"

if grep -q "$VOLUME_NAME" "$COMPOSE_FILE"; then
    echo "[SKIP] Volume $VOLUME_NAME already defined"
else
    echo "[CREATE] Adding volume $VOLUME_NAME to docker-compose.yml"

    # 方法1: sed（順序依存だが簡潔）
    # トップレベルvolumesセクションに追加
    sed -i "/^volumes:/a\\  ${VOLUME_NAME}:" "$COMPOSE_FILE"
    # servicesのvolumesに追加（メインプロジェクトのnode_modules行の後に挿入）
    MOUNT_LINE="      - ${VOLUME_NAME}:/workspaces/ai-work-container/repo/${PROJECT_NAME}/node_modules"
    sed -i "/ai-work-container-node_modules:.*\\/node_modules/a\\${MOUNT_LINE}" "$COMPOSE_FILE"

    # 方法2（より安定）: yqツールを使用（要インストール: apt-get install yq）
    # yq -i ".volumes.${VOLUME_NAME} = {}" "$COMPOSE_FILE"
    # yq -i ".services.devcontainer.volumes += [\"${VOLUME_NAME}:/workspaces/ai-work-container/repo/${PROJECT_NAME}/node_modules\"]" "$COMPOSE_FILE"

    # 注意: 方法1が失敗する場合は、手動でdocker-compose.ymlを編集するか、方法2のyqツールを使用してください
fi

echo ""
echo "=== Project initialized successfully ==="
echo ""
echo "IMPORTANT: docker-compose.yml has been updated with new volume."
echo "You must recreate the container for the volume to take effect:"
echo ""
echo "  1. Exit all VS Code windows attached to this container"
echo "  2. Rebuild the container:"
echo "     - VS Code: Ctrl+Shift+P → 'Dev Containers: Rebuild Container'"
echo "     - CLI: docker compose -f .devcontainer/docker-compose.yml up -d --build"
echo ""
echo "After rebuild, open the new project:"
echo "  1. Open VS Code Command Palette (Ctrl+Shift+P)"
echo "  2. Run: Dev Containers: Open Folder in Container..."
echo "  3. Select: /workspaces/ai-work-container/repo/${PROJECT_NAME}"
echo ""
