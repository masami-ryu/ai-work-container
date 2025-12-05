#!/bin/bash
# SessionStart Hook - 軽量な環境初期化
# パフォーマンス最適化: 不要な処理を削減

set +e

# プロジェクトルート設定（環境変数が未設定の場合のみ）
: ${PROJECT_ROOT:="/workspaces/ai-work-container"}

# 最小限のステータス出力（高速化のため簡潔に）
echo "Claude Code ready - $(basename "$PROJECT_ROOT")"

exit 0
