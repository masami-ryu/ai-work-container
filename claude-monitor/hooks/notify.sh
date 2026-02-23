#!/bin/bash
# 通知専用: stdin から Hook データを読み取り、ダッシュボードサーバーに POST（非同期）
set -euo pipefail
INPUT=$(cat)

# tmux pane情報: $TMUX_PANE はtmuxがペイン内プロセスに自動設定する環境変数（%N形式、例: %0, %5）
# ペインのライフサイクルを通じて一意かつ不変なため、そのまま使用する
TMUX_PANE_INFO="${TMUX_PANE:-}"

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
  transcript_path: (.transcript_path // ""),
  progress_text: "",
  timestamp: now | todate
}')

HOOK_TOKEN_HEADER=""
if [ -n "${CLAUDE_MONITOR_HOOK_TOKEN:-}" ]; then
  HOOK_TOKEN_HEADER="-H X-Hook-Token: $CLAUDE_MONITOR_HOOK_TOKEN"
fi

curl -s -X POST http://localhost:3456/api/events \
  -H "Content-Type: application/json" \
  $HOOK_TOKEN_HEADER \
  -d "$PAYLOAD" -o /dev/null || true

exit 0
