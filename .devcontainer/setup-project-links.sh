#!/bin/bash
# setup-project-links.sh
# 使用方法: ./setup-project-links.sh <project-name>
# 冪等性: 既存のシンボリックリンクがある場合はスキップ

set -e

PROJECT_NAME=$1
PROJECT_DIR="/workspaces/ai-work-container/repo/${PROJECT_NAME}"
COMMON_CLAUDE="/workspaces/ai-work-container/.claude"
COMMON_GITHUB="/workspaces/ai-work-container/.github"

if [ -z "$PROJECT_NAME" ]; then
    echo "Usage: $0 <project-name>"
    exit 1
fi

# .claudeへのシンボリックリンク（冪等性チェック）
if [ -L "${PROJECT_DIR}/.claude" ]; then
    echo "[SKIP] .claude symlink already exists"
elif [ -d "${PROJECT_DIR}/.claude" ]; then
    echo "[WARN] .claude directory exists (not a symlink). Skipping."
else
    echo "[CREATE] Creating .claude symlink"
    ln -s "$COMMON_CLAUDE" "${PROJECT_DIR}/.claude"
fi

# .githubへのシンボリックリンク（冪等性チェック）
if [ -L "${PROJECT_DIR}/.github" ]; then
    echo "[SKIP] .github symlink already exists"
elif [ -d "${PROJECT_DIR}/.github" ]; then
    echo "[WARN] .github directory exists (not a symlink). Skipping."
else
    echo "[CREATE] Creating .github symlink"
    ln -s "$COMMON_GITHUB" "${PROJECT_DIR}/.github"
fi

echo "[DONE] Symbolic links setup completed for $PROJECT_NAME"
