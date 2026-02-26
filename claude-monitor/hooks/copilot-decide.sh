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

# fail-closed/open モード（デフォルト: closed）
FAIL_MODE="${COPILOT_DECISION_FAIL_MODE:-closed}"
# 値を正規化・検証（未知値は fail-closed にフォールバック）
mode_lc="$(printf '%s' "$FAIL_MODE" | tr '[:upper:]' '[:lower:]')"
case "$mode_lc" in
  closed|open) FAIL_MODE="$mode_lc" ;;
  *)
    echo "Invalid COPILOT_DECISION_FAIL_MODE='$FAIL_MODE', fallback to closed" >&2
    FAIL_MODE="closed"
    ;;
esac

# 通信失敗時のフォールバック関数
fail_fallback() {
  local reason="${1:-Server communication failed}"
  if [ "$FAIL_MODE" = "closed" ]; then
    jq -n --arg reason "${reason} (fail-closed mode)" \
      '{permissionDecision:"deny", permissionDecisionReason:$reason}'
    exit 0
  else
    # fail-open: 出力なし = Copilot デフォルト動作
    exit 0
  fi
}

# preToolUse の stdin JSON から DecisionRequest を構築
TOOL_NAME=$(printf '%s\n' "$INPUT" | jq -r '.toolName // ""')

# 承認対象ツールリスト（環境変数で上書き可能、デフォルト: bash）
APPROVAL_TOOLS="${COPILOT_APPROVAL_TOOLS:-bash}"
TOOL_NAME_LC="$(printf '%s' "$TOOL_NAME" | tr '[:upper:]' '[:lower:]')"

# 承認対象でないツールはスキップ（安全なツールでの待機を回避）
MATCH=0
IFS=',' read -ra TOOLS <<< "$APPROVAL_TOOLS"
for t in "${TOOLS[@]}"; do
  t_lc="$(printf '%s' "$t" | tr '[:upper:]' '[:lower:]' | xargs)"
  if [ "$TOOL_NAME_LC" = "$t_lc" ]; then
    MATCH=1
    break
  fi
done
if [ "$MATCH" = "0" ]; then
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

# 登録失敗時はフォールバック
if [ "$REGISTER_RESULT" = "000" ] || { [ "$REGISTER_RESULT" != "200" ] && [ "$REGISTER_RESULT" != "201" ]; }; then
  echo "Decision registration failed (HTTP $REGISTER_RESULT)" >&2
  fail_fallback "Decision registration failed"
fi

# long-poll でブラウザ応答を待機（最大 280 秒）
RESPONSE=$(curl -s --max-time 280 \
  "$BASE_URL/api/decisions/$CORRELATION_ID/wait" 2>/dev/null || echo "")

# タイムアウト時はフォールバック
if [ -z "$RESPONSE" ]; then
  echo "Decision wait timed out" >&2
  fail_fallback "Decision wait timed out"
fi

# JSON パース検証
RESOLVED=$(echo "$RESPONSE" | jq -r '.resolved' 2>/dev/null || echo "")
if [ -z "$RESOLVED" ] || [ "$RESOLVED" != "true" ]; then
  echo "Decision not resolved (resolved=$RESOLVED)" >&2
  fail_fallback "Decision not resolved"
fi

# 決定結果を Copilot CLI 形式で出力
DECISION=$(echo "$RESPONSE" | jq -r '.decision' 2>/dev/null || echo "")
if [ -z "$DECISION" ]; then
  echo "Decision response missing decision field" >&2
  fail_fallback "Invalid decision response"
fi

REASON=$([ "$DECISION" = "allow" ] && echo "Approved via dashboard" || echo "Denied via dashboard")
jq -n --arg decision "$DECISION" --arg reason "$REASON" \
  '{permissionDecision: $decision, permissionDecisionReason: $reason}'

exit 0
