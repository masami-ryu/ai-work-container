#!/bin/bash
# 通知専用: stdin から Hook データを読み取り、ダッシュボードサーバーに POST（非同期）
set -euo pipefail
INPUT=$(cat)

PAYLOAD=$(echo "$INPUT" | jq -c '{
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
  reason: (.reason // ""),
  timestamp: now | todate
}')

curl -s -X POST http://localhost:3456/api/events \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" -o /dev/null || true

exit 0
