#!/bin/bash
# Copilot CLI 決定待ち: preToolUse でブラウザ応答を待ち、permissionDecision 形式で出力
set -euo pipefail
BASE_URL="http://localhost:3456"
headers=(-H "Content-Type: application/json")
if [ -n "${CLAUDE_MONITOR_HOOK_TOKEN:-}" ]; then
  headers+=(-H "X-Hook-Token: $CLAUDE_MONITOR_HOOK_TOKEN")
fi
INPUT=$(cat)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_ID=$("$SCRIPT_DIR/copilot-session-id.sh")
CORRELATION_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)

# preToolUse の stdin JSON から DecisionRequest を構築
TOOL_NAME=$(printf '%s\n' "$INPUT" | jq -r '.toolName // ""')

# Bash 以外のツールは承認不要（安全なツールでの待機を回避）
TOOL_NAME_LC="$(printf '%s' "$TOOL_NAME" | tr '[:upper:]' '[:lower:]')"
if [ "$TOOL_NAME_LC" != "bash" ]; then
  exit 0
fi

# pending decision を登録
PAYLOAD=$(jq -n -c \
  --arg correlation_id "$CORRELATION_ID" \
  --arg session_id "$SESSION_ID" \
  --arg tool_name "$TOOL_NAME" \
  --argjson tool_input "$(printf '%s\n' "$INPUT" | jq -c 'if .toolArgs then (.toolArgs | fromjson? // {}) else {} end')" \
  '{
    correlation_id: $correlation_id,
    session_id: $session_id,
    decision_type: "permission",
    tool_name: $tool_name,
    tool_input: $tool_input,
    timestamp: now | todate
  }')

REGISTER_RESULT=$(curl -s -X POST "$BASE_URL/api/decisions" \
  "${headers[@]}" \
  -d "$PAYLOAD" -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")

# fail-safe: 登録失敗時は通常の Copilot 挙動へフォールバック（decide.sh と同様 fail-open）
if [ "$REGISTER_RESULT" = "000" ] || { [ "$REGISTER_RESULT" != "200" ] && [ "$REGISTER_RESULT" != "201" ]; }; then
  exit 0
fi

# long-poll でブラウザ応答を待機（最大 280 秒）
RESPONSE=$(curl -s --max-time 280 \
  "$BASE_URL/api/decisions/$CORRELATION_ID/wait" 2>/dev/null || echo "")

# タイムアウト時はフォールバック
if [ -z "$RESPONSE" ]; then
  exit 0
fi

# JSON パース検証
RESOLVED=$(echo "$RESPONSE" | jq -r '.resolved' 2>/dev/null || echo "")
if [ -z "$RESOLVED" ] || [ "$RESOLVED" != "true" ]; then
  exit 0
fi

# 決定結果を Copilot CLI 形式で出力
DECISION=$(echo "$RESPONSE" | jq -r '.decision' 2>/dev/null || echo "")
if [ -z "$DECISION" ]; then
  exit 0
fi

REASON=$([ "$DECISION" = "allow" ] && echo "Approved via dashboard" || echo "Denied via dashboard")
jq -n --arg decision "$DECISION" --arg reason "$REASON" \
  '{permissionDecision: $decision, permissionDecisionReason: $reason}'

exit 0
