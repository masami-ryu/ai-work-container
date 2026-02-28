#!/bin/bash
# Codex セッション用 session_id 生成ヘルパー
# $TMUX_PANE（%N形式）からURL-safe な session_id を生成する
# 出力形式: codex-pane-<number>（例: codex-pane-5）
set -euo pipefail

PANE="${TMUX_PANE:-}"
if [ -z "$PANE" ]; then
  # TMUX_PANE 未設定時は一意IDを生成してセッション衝突を防ぐ
  FALLBACK_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "$$-$(date +%s%N)")"
  echo "codex-${FALLBACK_ID}"
  exit 0
fi

# %N → N（%を除去）
PANE_NUM="${PANE#%}"
echo "codex-pane-${PANE_NUM}"
