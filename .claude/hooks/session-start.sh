#!/bin/bash
# SessionStart Hook - プロジェクト環境の初期化

# エラーが発生しても続行（フックはセッション開始を妨げない）
set +e

# プロジェクトルートを環境変数に設定
export PROJECT_ROOT="/workspaces/ai-work-container"

# MCPサーバーの状態確認（デバッグ用）
# echo "🚀 Claude Code セッション開始"
# echo "📁 プロジェクトルート: $PROJECT_ROOT"

# 必ず成功で終了（セッション開始を妨げない）
exit 0
