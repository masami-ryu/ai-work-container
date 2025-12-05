#!/bin/bash
# ドキュメントファイルの読み取りを自動承認するフック

# 標準入力からツール入力を読み取り
input=$(cat)

# file_path を抽出（jq がない場合は grep で対応）
if command -v jq &> /dev/null; then
  file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  file_path=$(echo "$input" | grep -oP '"file_path"\s*:\s*"\K[^"]+' 2>/dev/null)
fi

# Markdown, テキスト, JSON ファイルは自動承認
if [[ "$file_path" =~ \.(md|mdx|txt|json)$ ]]; then
  echo '{"decision": "approve", "reason": "Documentation file auto-approved", "suppressOutput": true}'
  exit 0
fi

# その他のファイルはデフォルト動作（承認を求める）
exit 0
