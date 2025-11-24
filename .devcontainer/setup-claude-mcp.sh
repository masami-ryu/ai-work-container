#!/usr/bin/env bash
set -euo pipefail

# ======================================
# Claude Code MCP 自動設定スクリプト
# ======================================
# 目的: VS Codeの.vscode/mcp.jsonに定義されたMCPサーバーを
#       Claude Code CLIの設定に自動的に統合する
# ======================================

echo "==== Claude Code MCP セットアップ開始 ===="

# 設定ファイルパス
MCP_JSON="/workspaces/ai-work-container/.vscode/mcp.json"
CLAUDE_CONFIG_DIR="$HOME/.config/claude-code"
CLAUDE_SETTINGS="$CLAUDE_CONFIG_DIR/settings.json"

# jq の存在確認
if ! command -v jq >/dev/null 2>&1; then
  echo "[警告] jq がインストールされていません。JSON操作には jq が必要です。"
  echo "インストール方法: sudo apt-get update && sudo apt-get install -y jq"
  echo ""
  echo "jq なしで手動設定を続行します..."
  USE_JQ=false
else
  USE_JQ=true
fi

# Claude Code がインストールされているか確認
if ! command -v claude >/dev/null 2>&1; then
  echo "[エラー] Claude Code CLI が見つかりません。"
  echo "先に Claude Code CLI をインストールしてください。"
  exit 1
fi

# .vscode/mcp.json の存在確認
if [ ! -f "$MCP_JSON" ]; then
  echo "[エラー] $MCP_JSON が見つかりません。"
  exit 1
fi

echo "既存のMCP設定を読み込み中: $MCP_JSON"

# Claude Code 設定ディレクトリの作成
mkdir -p "$CLAUDE_CONFIG_DIR"

# GitHub PAT 環境変数の確認
if [ -z "${GITHUB_MCP_PAT:-}" ]; then
  echo "[警告] GITHUB_MCP_PAT 環境変数が設定されていません。"
  echo "GitHub MCP サーバーの認証には PAT が必要です。"
  echo "設定方法: echo 'export GITHUB_MCP_PAT=ghp_your_token_here' >> ~/.bashrc && source ~/.bashrc"
  GITHUB_AUTH_AVAILABLE=false
else
  echo "GitHub PAT が設定されています。"
  GITHUB_AUTH_AVAILABLE=true
fi

echo ""
echo "=== MCP サーバーを Claude Code に追加 ==="

# 既存のMCPサーバーを確認
EXISTING_SERVERS=$(claude mcp list 2>/dev/null | grep -oP '^\s*\K\S+' || echo "")

# msdocs サーバーの追加
echo ""
echo "[1/3] msdocs サーバーを追加中..."
if echo "$EXISTING_SERVERS" | grep -q "^msdocs$"; then
  echo "✓ msdocs は既に追加されています"
else
  if $USE_JQ; then
    MSDOCS_URL=$(jq -r '.servers.msdocs.url' "$MCP_JSON")
    if claude mcp add --transport http msdocs "$MSDOCS_URL"; then
      echo "✓ msdocs サーバーを追加しました (URL: $MSDOCS_URL)"
    else
      echo "✗ msdocs サーバーの追加に失敗しました"
    fi
  else
    echo "手動設定が必要: claude mcp add --transport http msdocs https://learn.microsoft.com/api/mcp"
  fi
fi

# context7 サーバーの追加
echo ""
echo "[2/3] context7 サーバーを追加中..."
if echo "$EXISTING_SERVERS" | grep -q "^context7$"; then
  echo "✓ context7 は既に追加されています"
else
  if $USE_JQ; then
    if claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp@latest; then
      echo "✓ context7 サーバーを追加しました"
    else
      echo "✗ context7 サーバーの追加に失敗しました"
    fi
  else
    echo "手動設定が必要: claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp@latest"
  fi
fi

# github-mcp-server の追加
echo ""
echo "[3/3] github-mcp-server を追加中..."
if echo "$EXISTING_SERVERS" | grep -q "^github-mcp-server$"; then
  echo "✓ github-mcp-server は既に追加されています"
else
  if $USE_JQ; then
    GITHUB_URL=$(jq -r '.servers["github-mcp-server"].url' "$MCP_JSON")
    
    if $GITHUB_AUTH_AVAILABLE; then
      # GitHub PAT を使用して認証ヘッダーを追加
      if claude mcp add --transport http github-mcp-server "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT"; then
        echo "✓ github-mcp-server を追加しました (URL: $GITHUB_URL, 認証: あり)"
      else
        echo "✗ github-mcp-server の追加に失敗しました"
      fi
    else
      # 認証なしで追加（後で手動設定が必要）
      if claude mcp add --transport http github-mcp-server "$GITHUB_URL"; then
        echo "⚠ github-mcp-server を追加しましたが、認証情報がありません"
        echo "  手動で設定が必要: GITHUB_MCP_PAT 環境変数を設定後、再度このスクリプトを実行してください"
      else
        echo "✗ github-mcp-server の追加に失敗しました"
      fi
    fi
  else
    echo "手動設定が必要:"
    if $GITHUB_AUTH_AVAILABLE; then
      echo "  claude mcp add --transport http -H 'Authorization: Bearer \$GITHUB_MCP_PAT' github-mcp-server https://api.githubcopilot.com/mcp/"
    else
      echo "  1. GITHUB_MCP_PAT 環境変数を設定"
      echo "  2. claude mcp add --transport http -H 'Authorization: Bearer \$GITHUB_MCP_PAT' github-mcp-server https://api.githubcopilot.com/mcp/"
    fi
  fi
fi

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "MCP サーバー一覧確認:"
echo "  claude mcp list"
echo ""

if ! $GITHUB_AUTH_AVAILABLE; then
  echo "⚠ 次のステップ:"
  echo "  1. GitHub Personal Access Token を取得"
  echo "  2. export GITHUB_MCP_PAT=ghp_your_token_here"
  echo "  3. このスクリプトを再実行して認証情報を追加"
  echo ""
fi

echo "==== Claude Code MCP セットアップ完了 ===="
