#!/bin/bash
set -euo pipefail

# ======================================
# setup-repo-project.sh
# ======================================
# repo/ 配下のプロジェクトをマルチルートワークスペースに追加し、
# node_modules をシンボリックリンク化するスクリプト
#
# 使用方法:
#   bash .devcontainer/setup-repo-project.sh <project-name>
#
# 例:
#   cd /workspaces/ai-work-container/repo
#   git clone https://github.com/your-org/your-project.git
#   cd ..
#   bash .devcontainer/setup-repo-project.sh your-project
#
# バックアップ復旧手順:
#   万が一 .code-workspace が破損した場合:
#   cp ai-work-container.code-workspace.backup ai-work-container.code-workspace
# ======================================

# 引数チェック
if [ $# -ne 1 ]; then
  cat << 'EOF'
使用方法: setup-repo-project.sh <project-name>

プロジェクトをマルチルートワークスペースに追加し、
node_modules をシンボリックリンク化します。

例:
  bash .devcontainer/setup-repo-project.sh my-project

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

# プロジェクトディレクトリの存在確認
if [ ! -d "$PROJECT_DIR" ]; then
  echo "[エラー] プロジェクトディレクトリが見つかりません: $PROJECT_DIR"
  echo "先に git clone などでプロジェクトを配置してください。"
  exit 1
fi

# ワークスペースファイルの存在確認
if [ ! -f "$WORKSPACE_FILE" ]; then
  echo "[エラー] ワークスペースファイルが見つかりません: $WORKSPACE_FILE"
  exit 1
fi

# 1. .code-workspace の事前バックアップを作成
echo "→ .code-workspace をバックアップ中..."
cp "$WORKSPACE_FILE" "$BACKUP_FILE"
echo "  バックアップ作成: $BACKUP_FILE"

# 2. 既存の node_modules を削除（存在する場合）
if [ -d "$PROJECT_DIR/node_modules" ] || [ -L "$PROJECT_DIR/node_modules" ]; then
  echo "→ 既存の node_modules を削除中..."
  rm -rf "$PROJECT_DIR/node_modules"
  echo "  削除完了: $PROJECT_DIR/node_modules"
fi

# 3. キャッシュディレクトリを作成
echo "→ node_modules キャッシュディレクトリを作成中..."
mkdir -p "$NODE_MODULES_CACHE"
echo "  作成完了: $NODE_MODULES_CACHE"

# 4. シンボリックリンクを作成
echo "→ シンボリックリンクを作成中..."
ln -s "$NODE_MODULES_CACHE" "$PROJECT_DIR/node_modules"
echo "  作成完了: $PROJECT_DIR/node_modules -> $NODE_MODULES_CACHE"

# 5. ワークスペースファイルに新プロジェクトを追加（重複チェック実施）
echo "→ ワークスペースファイルを更新中..."

# JSON整形ツールの選択
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL="python"
else
  echo "[エラー] jq または python3 が見つかりません。JSON整形ができません。"
  exit 1
fi

# 重複チェック
RELATIVE_PATH="repo/$PROJECT_NAME"
if grep -q "\"path\": \"$RELATIVE_PATH\"" "$WORKSPACE_FILE"; then
  echo "[警告] プロジェクト '$PROJECT_NAME' はすでにワークスペースに追加されています。"
  echo "  スキップします。"
else
  # JSON にフォルダを追加
  if [ "$JSON_TOOL" = "jq" ]; then
    TMP_FILE=$(mktemp)
    jq --arg name "$PROJECT_NAME" --arg path "$RELATIVE_PATH" \
      '.folders += [{"name": $name, "path": $path}]' \
      "$WORKSPACE_FILE" > "$TMP_FILE"
    mv "$TMP_FILE" "$WORKSPACE_FILE"
  else
    # python を使用
    python3 << EOF
import json
import sys

workspace_file = "$WORKSPACE_FILE"
project_name = "$PROJECT_NAME"
relative_path = "$RELATIVE_PATH"

try:
    with open(workspace_file, 'r') as f:
        data = json.load(f)

    data['folders'].append({"name": project_name, "path": relative_path})

    with open(workspace_file, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    print(f"  追加完了: {project_name}")
except Exception as e:
    print(f"[エラー] JSON更新に失敗しました: {e}", file=sys.stderr)
    sys.exit(1)
EOF
  fi
  echo "  ワークスペース更新完了"
fi

cat << EOF

========================================
プロジェクト '$PROJECT_NAME' のセットアップが完了しました！

次のステップ:
  1. VS Code でマルチルートワークスペースを再読み込み
  2. プロジェクトディレクトリで npm install を実行
     cd $PROJECT_DIR
     npm install

バックアップ:
  $BACKUP_FILE
========================================

EOF
