#!/bin/bash
# Copilot CLI 通知: stdin から Copilot Hook データを読み取り、claude-monitor API 形式に変換して POST
set -euo pipefail
INPUT=$(cat)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_ID=$("$SCRIPT_DIR/copilot-session-id.sh")
TMUX_PANE_INFO="${TMUX_PANE:-}"

# Copilot CLI hook イベント種別の検出と claude-monitor EventType への変換
# Copilot stdin JSON は { toolName, toolArgs, ... } のような camelCase 構造
# イベント種別はフック設定の event name から決まるが、stdin JSON の構造から推定も可能
# ここでは COPILOT_HOOK_EVENT 環境変数（hooks.json の bash コマンドで設定）を使用
EVENT="${COPILOT_HOOK_EVENT:-}"

case "$EVENT" in
  sessionStart)
    PAYLOAD=$(printf '%s\n' "$INPUT" | jq -c \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE_INFO" \
      '{
        event_type: "SessionStart",
        session_id: $session_id,
        cwd: (.cwd // ""),
        model: (.selectedModel // ""),
        title: "",
        notification_type: "",
        message: "",
        tool_name: "",
        file_path: "",
        prompt: (.initialPrompt // ""),
        questions: [],
        last_message: "",
        tmux_pane: $tmux_pane,
        reason: "",
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: now | todate
      }')
    ;;
  sessionEnd)
    PAYLOAD=$(printf '%s\n' "$INPUT" | jq -c \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE_INFO" \
      '{
        event_type: "SessionEnd",
        session_id: $session_id,
        cwd: (.cwd // ""),
        model: "",
        title: "",
        notification_type: "",
        message: "",
        tool_name: "",
        file_path: "",
        prompt: "",
        questions: [],
        last_message: "",
        tmux_pane: $tmux_pane,
        reason: (.reason // ""),
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: now | todate
      }')
    ;;
  userPromptSubmitted)
    PAYLOAD=$(printf '%s\n' "$INPUT" | jq -c \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE_INFO" \
      '{
        event_type: "UserPromptSubmit",
        session_id: $session_id,
        cwd: (.cwd // ""),
        model: "",
        title: "",
        notification_type: "",
        message: "",
        tool_name: "",
        file_path: "",
        prompt: (.prompt // ""),
        questions: [],
        last_message: "",
        tmux_pane: $tmux_pane,
        reason: "",
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: now | todate
      }')
    ;;
  preToolUse)
    PAYLOAD=$(printf '%s\n' "$INPUT" | jq -c \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE_INFO" \
      '{
        event_type: "PreToolUse",
        session_id: $session_id,
        cwd: (.cwd // ""),
        model: "",
        title: "",
        notification_type: "",
        message: "",
        tool_name: (.toolName // ""),
        file_path: "",
        prompt: "",
        questions: [],
        last_message: "",
        tmux_pane: $tmux_pane,
        reason: "",
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: now | todate
      }')
    ;;
  postToolUse)
    PAYLOAD=$(printf '%s\n' "$INPUT" | jq -c \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE_INFO" \
      '{
        event_type: "PostToolUse",
        session_id: $session_id,
        cwd: (.cwd // ""),
        model: "",
        title: "",
        notification_type: "",
        message: "",
        tool_name: (.toolName // ""),
        file_path: (if .toolArgs then (.toolArgs | fromjson? // {} | .file_path // .path // "") else "" end),
        prompt: "",
        questions: [],
        last_message: "",
        tmux_pane: $tmux_pane,
        reason: "",
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: now | todate
      }')
    ;;
  errorOccurred)
    # error.message を優先抽出、存在しない場合は error オブジェクトを文字列化
    PAYLOAD=$(printf '%s\n' "$INPUT" | jq -c \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE_INFO" \
      '{
        event_type: "Notification",
        session_id: $session_id,
        cwd: (.cwd // ""),
        model: "",
        title: "",
        notification_type: "error",
        message: (if .error.message then .error.message elif .error then (.error | tostring) else "Unknown error" end),
        tool_name: "",
        file_path: "",
        prompt: "",
        questions: [],
        last_message: "",
        tmux_pane: $tmux_pane,
        reason: "",
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: now | todate
      }')
    ;;
  *)
    # 未知のイベント: 無視
    exit 0
    ;;
esac

headers=(-H "Content-Type: application/json")
if [ -n "${CLAUDE_MONITOR_HOOK_TOKEN:-}" ]; then
  headers+=(-H "X-Hook-Token: $CLAUDE_MONITOR_HOOK_TOKEN")
fi

curl -s -X POST http://localhost:3456/api/events \
  "${headers[@]}" \
  -d "$PAYLOAD" -o /dev/null || true

exit 0
