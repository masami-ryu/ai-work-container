#!/bin/bash
# Codex CLI 通知: notify イベント（agent-turn-complete）を claude-monitor API 形式に変換して POST
# Codex の notify は agent-turn-complete 時にスクリプトを実行する。
# 現時点では stdin/env/args から受け取れる情報は限定的（RES-005）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_ID=$("$SCRIPT_DIR/codex-session-id.sh")
TMUX_PANE_INFO="${TMUX_PANE:-}"

# stdin があれば読み取り（Codex notify が JSON を渡す場合に備える）
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(cat 2>/dev/null || true)
fi

# agent-turn-complete: Codex が1ターン完了 → Stop 相当（idle 復帰）
PAYLOAD=$(jq -n -c \
  --arg session_id "$SESSION_ID" \
  --arg tmux_pane "$TMUX_PANE_INFO" \
  --arg input "$INPUT" \
  '{
    event_type: "Stop",
    session_id: $session_id,
    cwd: "",
    model: "",
    title: "",
    notification_type: "",
    message: (if ($input | length) > 0 then ($input | fromjson? // {} | .message // "") else "" end),
    tool_name: "",
    file_path: "",
    prompt: "",
    questions: [],
    last_message: (if ($input | length) > 0 then ($input | fromjson? // {} | .last_message // .message // "") else "" end),
    tmux_pane: $tmux_pane,
    reason: "",
    transcript_path: "",
    progress_text: "",
    cli_tool: "codex",
    timestamp: now | todate
  }')

headers=(-H "Content-Type: application/json")
if [ -n "${CLAUDE_MONITOR_HOOK_TOKEN:-}" ]; then
  headers+=(-H "X-Hook-Token: $CLAUDE_MONITOR_HOOK_TOKEN")
fi

curl -s -X POST http://localhost:3456/api/events \
  "${headers[@]}" \
  -d "$PAYLOAD" -o /dev/null || true

exit 0
