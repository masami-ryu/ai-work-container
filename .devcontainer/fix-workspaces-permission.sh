#!/bin/bash
set -e

LOG_FILE="/tmp/worktree-permission.log"
TARGET_DIR="/workspaces/ai-work-container"
WORKSPACES_DIR="/workspaces"

echo "[$(date)] ================================================" | tee -a "$LOG_FILE"
echo "[$(date)] Checking permissions for git worktree support" | tee -a "$LOG_FILE"
echo "[$(date)] ================================================" | tee -a "$LOG_FILE"

# Phase 0: 前提確認（レビュー指摘対応）
echo "[$(date)] Phase 0: Environment check" | tee -a "$LOG_FILE"
echo "[$(date)] Current /workspaces/ status:" | tee -a "$LOG_FILE"
stat "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"
echo "[$(date)] Current user groups:" | tee -a "$LOG_FILE"
groups vscode 2>&1 | tee -a "$LOG_FILE"

# sudo が使用可能かチェック
if sudo -n true 2>/dev/null; then
    echo "[$(date)] sudo is available, changing permissions..." | tee -a "$LOG_FILE"

    # /workspaces/ai-work-container の所有者を変更
    echo "[$(date)] Phase 1: Changing ownership of $TARGET_DIR" | tee -a "$LOG_FILE"
    if sudo chown -R vscode:vscode "$TARGET_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$(date)] ✓ Successfully changed ownership of $TARGET_DIR to vscode:vscode" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] ✗ ERROR: Failed to change ownership of $TARGET_DIR" | tee -a "$LOG_FILE"
        exit 1
    fi

    # /workspaces/ のグループを vscode に変更
    echo "[$(date)] Phase 2: Changing group of $WORKSPACES_DIR to vscode" | tee -a "$LOG_FILE"
    if sudo chown root:vscode "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$(date)] ✓ Successfully changed group of $WORKSPACES_DIR to vscode" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] ✗ ERROR: Failed to change group of $WORKSPACES_DIR" | tee -a "$LOG_FILE"
        exit 1
    fi

    # /workspaces/ のパーミッションを 2775 に変更（setgid ビットを含む）
    echo "[$(date)] Phase 3: Setting permissions of $WORKSPACES_DIR to 2775 (with setgid)" | tee -a "$LOG_FILE"
    if sudo chmod 2775 "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$(date)] ✓ Successfully set permissions of $WORKSPACES_DIR to 2775" | tee -a "$LOG_FILE"
    else
        echo "[$(date)] ✗ ERROR: Failed to set permissions of $WORKSPACES_DIR" | tee -a "$LOG_FILE"
        exit 1
    fi

    # 変更後のパーミッション確認
    echo "[$(date)] ================================================" | tee -a "$LOG_FILE"
    echo "[$(date)] Verification: Current permissions after changes" | tee -a "$LOG_FILE"
    echo "[$(date)] ================================================" | tee -a "$LOG_FILE"
    ls -ld "$WORKSPACES_DIR" 2>&1 | tee -a "$LOG_FILE"
    ls -ld "$TARGET_DIR" 2>&1 | tee -a "$LOG_FILE"

    echo "[$(date)] ✓ All permission changes completed successfully" | tee -a "$LOG_FILE"
else
    echo "[$(date)] ⚠ WARNING: sudo not available, skipping permission change" | tee -a "$LOG_FILE"
    echo "[$(date)] Worktree operations may fail without proper permissions" | tee -a "$LOG_FILE"
fi

echo "[$(date)] ================================================" | tee -a "$LOG_FILE"
