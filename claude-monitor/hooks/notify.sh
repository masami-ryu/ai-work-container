#!/bin/bash
# 通知専用: stdin から Hook データを読み取り、ダッシュボードサーバーに POST（非同期）
set -euo pipefail
INPUT=$(cat)

# tmux pane情報を取得（tmux外ではスキップ）
TMUX_PANE_INFO=""
if [ -n "${TMUX:-}" ]; then
  TMUX_PANE_INFO=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
fi

PAYLOAD=$(echo "$INPUT" | jq -c --arg tmux_pane "$TMUX_PANE_INFO" '{
  event_type: .hook_event_name,
  session_id: .session_id,
  cwd: .cwd,
  model: (.model // ""),
  title: (.title // ""),
  notification_type: (.notification_type // ""),
  message: (.message // ""),
  tool_name: (.tool_name // ""),
  file_path: (.tool_input.file_path // ""),
  prompt: (.prompt // ""),
  questions: (.tool_input.questions // []),
  last_message: (.last_assistant_message // ""),
  tmux_pane: $tmux_pane,
  reason: (.reason // ""),
  timestamp: now | todate
}')

curl -s -X POST http://localhost:3456/api/events \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" -o /dev/null || true

exit 0
