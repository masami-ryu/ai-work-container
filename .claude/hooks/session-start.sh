#!/bin/bash
# SessionStart Hook - プロジェクト環境の初期化

# エラーが発生しても続行（フックはセッション開始を妨げない）
set +e

# プロジェクトルートを環境変数に設定
export PROJECT_ROOT="/workspaces/ai-work-container"

# セッション開始メッセージ
echo "🚀 Claude Code セッション開始"
echo "📁 プロジェクト: $PROJECT_ROOT"
echo ""

# MCPサーバーの状態確認
if command -v claude &> /dev/null; then
    echo "📡 MCPサーバー状態:"
    claude mcp list 2>/dev/null | head -10 || echo "   (確認をスキップ)"
    echo ""
fi

# 必ず成功で終了（セッション開始を妨げない）
exit 0
