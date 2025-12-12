#!/bin/bash
set -euo pipefail

# ======================================
# remove-repo-project.sh
# ======================================
# repo/ 配下のプロジェクトをマルチルートワークスペースから削除し、
# node_modules キャッシュを削除するスクリプト
#
# 使用方法:
#   bash .devcontainer/remove-repo-project.sh <project-name>
#
# 例:
#   bash .devcontainer/remove-repo-project.sh my-project
#
# 注意:
#   - repo/<project-name>/ ディレクトリ自体は削除されません
#   - プロジェクトディレクトリを削除したい場合は、手動で実行してください:
#     rm -rf /workspaces/ai-work-container/repo/<project-name>
#
# バックアップ復旧手順:
#   万が一 .code-workspace が破損した場合:
#   cp ai-work-container.code-workspace.backup ai-work-container.code-workspace
# ======================================

# 引数チェック
if [ $# -ne 1 ]; then
  cat << 'EOF'
使用方法: remove-repo-project.sh <project-name>

プロジェクトをマルチルートワークスペースから削除し、
node_modules キャッシュを削除します。

例:
  bash .devcontainer/remove-repo-project.sh my-project

注意:
  - repo/<project-name>/ ディレクトリ自体は削除されません
  - プロジェクトディレクトリを削除したい場合は、手動で実行してください:
    rm -rf /workspaces/ai-work-container/repo/<project-name>

バックアップ復旧手順:
  万が一 .code-workspace が破損した場合:
  cp ai-work-container.code-workspace.backup ai-work-container.code-workspace

EOF
  exit 1
fi

PROJECT_NAME="$1"
WORKSPACE_ROOT="/workspaces/ai-work-container"
PROJECT_DIR="$WORKSPACE_ROOT/repo/$PROJECT_NAME"
NODE_MODULES_CACHE="$WORKSPACE_ROOT/.node_modules_cache/$PROJECT_NAME"
WORKSPACE_FILE="$WORKSPACE_ROOT/ai-work-container.code-workspace"
BACKUP_FILE="$WORKSPACE_FILE.backup"

# ワークスペースファイルの存在確認
if [ ! -f "$WORKSPACE_FILE" ]; then
  echo "[エラー] ワークスペースファイルが見つかりません: $WORKSPACE_FILE"
  exit 1
fi

# 1. .code-workspace の事前バックアップを作成
echo "→ .code-workspace をバックアップ中..."
cp "$WORKSPACE_FILE" "$BACKUP_FILE"
echo "  バックアップ作成: $BACKUP_FILE"

# 2. ワークスペースファイルから指定プロジェクトのフォルダ定義を削除
echo "→ ワークスペースファイルからプロジェクトを削除中..."

# JSON整形ツールの選択
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL="python"
else
  echo "[エラー] jq または python3 が見つかりません。JSON整形ができません。"
  exit 1
fi

RELATIVE_PATH="repo/$PROJECT_NAME"

# JSON からフォルダを削除
if [ "$JSON_TOOL" = "jq" ]; then
  TMP_FILE=$(mktemp)
  jq --arg path "$RELATIVE_PATH" \
    '.folders = [.folders[] | select(.path != $path)]' \
    "$WORKSPACE_FILE" > "$TMP_FILE"
  mv "$TMP_FILE" "$WORKSPACE_FILE"
else
  # python を使用
  python3 << EOF
import json
import sys

workspace_file = "$WORKSPACE_FILE"
relative_path = "$RELATIVE_PATH"

try:
    with open(workspace_file, 'r') as f:
        data = json.load(f)

    original_count = len(data['folders'])
    data['folders'] = [f for f in data['folders'] if f.get('path') != relative_path]
    removed_count = original_count - len(data['folders'])

    with open(workspace_file, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    if removed_count > 0:
        print(f"  削除完了: {removed_count} 件のフォルダ定義を削除しました")
    else:
        print(f"  [警告] プロジェクト '{relative_path}' はワークスペースに見つかりませんでした")

except Exception as e:
    print(f"[エラー] JSON更新に失敗しました: {e}", file=sys.stderr)
    sys.exit(1)
EOF
fi

# 3. node_modules キャッシュを削除
if [ -d "$NODE_MODULES_CACHE" ]; then
  echo "→ node_modules キャッシュを削除中..."
  rm -rf "$NODE_MODULES_CACHE"
  echo "  削除完了: $NODE_MODULES_CACHE"
else
  echo "  [情報] node_modules キャッシュが見つかりませんでした: $NODE_MODULES_CACHE"
fi

cat << EOF

========================================
プロジェクト '$PROJECT_NAME' の削除が完了しました！

注意:
  プロジェクトディレクトリ自体は削除されていません: $PROJECT_DIR

プロジェクトディレクトリも削除したい場合:
  rm -rf $PROJECT_DIR

バックアップ:
  $BACKUP_FILE
========================================

EOF
