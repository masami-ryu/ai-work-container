#!/bin/bash
# 決定待ち: ダッシュボードサーバーに pending decision を登録し、ブラウザ応答を待つ
set -euo pipefail
BASE_URL="http://localhost:3456"
HOOK_TOKEN_HEADER=""
if [ -n "${CLAUDE_MONITOR_HOOK_TOKEN:-}" ]; then
  HOOK_TOKEN_HEADER="-H X-Hook-Token: $CLAUDE_MONITOR_HOOK_TOKEN"
fi
INPUT=$(cat)

EVENT_TYPE=$(echo "$INPUT" | jq -r '.hook_event_name')
CORRELATION_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)

# PermissionRequest 以外は対象外
if [ "$EVENT_TYPE" != "PermissionRequest" ]; then
  exit 0
fi

# AskUserQuestion はターミナル操作専用のため承認パネル不要
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
if [ "$TOOL_NAME" = "AskUserQuestion" ]; then
  exit 0
fi

# pending decision を登録
PAYLOAD=$(echo "$INPUT" | jq -c \
  --arg correlation_id "$CORRELATION_ID" \
  '{
    correlation_id: $correlation_id,
    session_id: .session_id,
    decision_type: "permission",
    tool_name: (.tool_name // ""),
    tool_input: (.tool_input // {}),
    timestamp: now | todate
  }')

REGISTER_RESULT=$(curl -s -X POST "$BASE_URL/api/decisions" \
  -H "Content-Type: application/json" \
  $HOOK_TOKEN_HEADER \
  -d "$PAYLOAD" -w "%{http_code}" -o /dev/null || echo "000")

# サーバー未起動時はフォールバック（通常の権限ダイアログに任せる）
if [ "$REGISTER_RESULT" = "000" ] || { [ "$REGISTER_RESULT" != "200" ] && [ "$REGISTER_RESULT" != "201" ]; }; then
  exit 0
fi

# long-poll でブラウザ応答を待機（最大 280 秒、hook timeout 300 秒より短く）
RESPONSE=$(curl -s --max-time 280 \
  "$BASE_URL/api/decisions/$CORRELATION_ID/wait" || true)

# 応答がない場合（タイムアウト）はフォールバック
if [ -z "$RESPONSE" ] || [ "$(echo "$RESPONSE" | jq -r '.resolved')" != "true" ]; then
  exit 0
fi

# PermissionRequest: 決定 JSON を出力
BEHAVIOR=$(echo "$RESPONSE" | jq -r '.decision')
jq -n --arg behavior "$BEHAVIOR" '{
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: { behavior: $behavior }
  }
}'

exit 0
