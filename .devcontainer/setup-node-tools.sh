#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=node-tools.env
source "$SCRIPT_DIR/node-tools.env"

NODE_PREFIX="${1:?Node.js のインストール先を指定してください}"
if [ ! -x "$NODE_PREFIX/bin/node" ] || [ ! -x "$NODE_PREFIX/bin/corepack" ]; then
  echo "[エラー] 指定された Node.js または Corepack が見つかりません。" >&2
  exit 1
fi

export PATH="$NODE_PREFIX/bin:$PATH"
# 構築処理はプロジェクト側の旧 packageManager 指定に影響されないようにする。
export COREPACK_ENABLE_PROJECT_SPEC=0
export COREPACK_DEFAULT_TO_LATEST=0

# pnpm 自体のバージョン管理や .npmrc も、呼び出し元の設定を読み込ませない。
TOOL_WORK_DIR="$(mktemp -d)"
trap 'rmdir "$TOOL_WORK_DIR" 2>/dev/null || true' EXIT
cd "$TOOL_WORK_DIR"

"$NODE_PREFIX/bin/corepack" enable --install-directory "$NODE_PREFIX/bin" pnpm
"$NODE_PREFIX/bin/corepack" install --global "pnpm@$PNPM_VERSION"

# 通常の pnpm add -g や Codex の更新でも、初回導入と同じ配置先を使う。
"$NODE_PREFIX/bin/pnpm" config set --global global-dir "$NODE_PREFIX/lib/pnpm-global"
"$NODE_PREFIX/bin/pnpm" config set --global global-bin-dir "$NODE_PREFIX/bin"

# npm も pnpm で更新する。依存のライフサイクルスクリプトは実行しない。
"$NODE_PREFIX/bin/pnpm" add --global \
  --global-dir "$NODE_PREFIX/lib/pnpm-global" \
  --global-bin-dir "$NODE_PREFIX/bin" \
  --ignore-scripts \
  --registry=https://registry.npmjs.org/ \
  "npm@$NPM_VERSION" \
  "@openai/codex@$CODEX_VERSION"

echo "Node.js: $("$NODE_PREFIX/bin/node" --version)"
echo "pnpm: $("$NODE_PREFIX/bin/pnpm" --version)"
echo "Codex: $("$NODE_PREFIX/bin/codex" --version)"
