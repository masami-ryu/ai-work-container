#!/usr/bin/env bash
set -euo pipefail

# ======================================
# 設定値
# ======================================
# プロジェクトに .node-version や package.json の engines.node が
# 指定されていない場合に使用されるデフォルトの Node.js バージョン
DEFAULT_NODE_VERSION="22.21.1"

# ======================================
# 環境変数
# ======================================
HOME_DIR="/home/vscode"
ANYENV_DIR="$HOME_DIR/.anyenv"
NODENV_DIR="$HOME_DIR/.nodenv"
LOGFILE="$HOME_DIR/.anyenv_setup.log"

# ログファイルへの出力設定(詳細ログはファイルに記録、ターミナルには重要情報のみ)
exec > >(tee -a "$LOGFILE") 2>&1

echo "==== anyenv/nodenv セットアップ開始: $(date -u +"%Y-%m-%dT%H:%M:%SZ") ===="

# エラー時の処理
on_error() {
  echo "[エラー] セットアップが失敗しました: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "詳細は $LOGFILE を確認してください。"
  exit 1
}
trap on_error ERR

# ホームディレクトリ配下の全権限を設定(以降の個別 chown は不要)
echo "権限を設定中..."
chown -R vscode:vscode "$HOME_DIR" || true

# anyenv のインストール
echo "anyenv をセットアップ中..."
if [ ! -d "$ANYENV_DIR" ]; then
  git clone https://github.com/anyenv/anyenv.git "$ANYENV_DIR"
  mkdir -p "$ANYENV_DIR/.anyenv.d" || true
fi

# anyenv を PATH に追加して初期化
export PATH="$ANYENV_DIR/bin:$PATH"
if command -v anyenv >/dev/null 2>&1; then
  eval "$(anyenv init -)" || true
else
  echo "[エラー] anyenv のインストール後に利用できません。"
  exit 1
fi

# anyenv-install 定義リポジトリの準備
ANYENV_DEFINITION_ROOT="${XDG_CONFIG_HOME:-$HOME_DIR/.config}/anyenv/anyenv-install"
DEF_PARENT_DIR="$(dirname "$ANYENV_DEFINITION_ROOT")"
if [ ! -d "$ANYENV_DEFINITION_ROOT/.git" ]; then
  mkdir -p "$DEF_PARENT_DIR"
  if git clone --depth 1 https://github.com/anyenv/anyenv-install.git "$ANYENV_DEFINITION_ROOT"; then
    echo "anyenv 定義リポジトリをクローンしました。"
  else
    echo "[警告] anyenv-install のクローンに失敗しました。nodenv のインストールが失敗する可能性があります。"
    echo "手動インストール: git clone https://github.com/anyenv/anyenv-install.git $ANYENV_DEFINITION_ROOT"
  fi
else
  (cd "$ANYENV_DEFINITION_ROOT" && git fetch --depth 1 origin && git reset --hard origin/HEAD || echo "[警告] 定義の更新に失敗しました")
fi

# anyenv-update プラグインのインストール
ANYENV_UPDATE_DIR="$ANYENV_DIR/plugins/anyenv-update"
if [ ! -d "$ANYENV_UPDATE_DIR" ]; then
  mkdir -p "$ANYENV_DIR/plugins"
  if git clone https://github.com/znz/anyenv-update.git "$ANYENV_UPDATE_DIR"; then
    echo "anyenv-update プラグインをインストールしました。"
  else
    echo "[警告] anyenv-update プラグインのクローンに失敗しました。"
  fi
else
  echo "anyenv-update プラグインは既にインストールされています。"
  # 既存の場合は最新に更新
  (cd "$ANYENV_UPDATE_DIR" && git fetch --depth 1 origin && git reset --hard origin/HEAD || echo "[警告] anyenv-update の更新に失敗しました")
fi

# nodenv のインストール
echo "nodenv をセットアップ中..."
if ! command -v nodenv >/dev/null 2>&1; then
  if ! anyenv versions | grep -q nodenv; then
    if anyenv install nodenv; then
      echo "nodenv をインストールしました。"
    else
      echo "[エラー] nodenv のインストールに失敗しました。"
      echo "手動インストール例:"
      echo "  anyenv install nodenv"
      echo "または:"
      echo "  git clone https://github.com/nodenv/nodenv.git $NODENV_DIR"
      exit 1
    fi
  fi
fi

# nodenv のルートディレクトリを検出
detect_nodenv_root() {
  if [ -n "${NODENV_ROOT:-}" ] && [ -d "$NODENV_ROOT" ]; then
    echo "$NODENV_ROOT"; return 0; fi
  if [ -d "$ANYENV_DIR/envs/nodenv" ]; then
    echo "$ANYENV_DIR/envs/nodenv"; return 0; fi
  if [ -d "$HOME_DIR/.nodenv" ]; then
    echo "$HOME_DIR/.nodenv"; return 0; fi
  return 1
}

REAL_NODENV_ROOT="$(detect_nodenv_root || true)"
if [ -n "$REAL_NODENV_ROOT" ]; then
  # シンボリックリンク ~/.nodenv を作成
  if [ "$REAL_NODENV_ROOT" != "$NODENV_DIR" ] && [ ! -e "$NODENV_DIR" ]; then
    ln -s "$REAL_NODENV_ROOT" "$NODENV_DIR" || echo "[警告] シンボリックリンクの作成に失敗: $REAL_NODENV_ROOT -> $NODENV_DIR"
  fi
  export NODENV_ROOT="$REAL_NODENV_ROOT"
  export PATH="$NODENV_ROOT/bin:$PATH"
  if command -v nodenv >/dev/null 2>&1; then
    eval "$(nodenv init -)" || true
    echo "nodenv を初期化しました (root=$NODENV_ROOT)"
  else
    echo "[警告] nodenv バイナリが見つかりません (root=$NODENV_ROOT)"
  fi
else
  echo "nodenv が検出されませんでした。"
fi

# node-build プラグインのインストール
if [ -n "$REAL_NODENV_ROOT" ] && [ -d "$REAL_NODENV_ROOT" ]; then
  if [ ! -d "$REAL_NODENV_ROOT/plugins/node-build" ]; then
    mkdir -p "$REAL_NODENV_ROOT/plugins"
    if git clone https://github.com/nodenv/node-build.git "$REAL_NODENV_ROOT/plugins/node-build"; then
      echo "node-build プラグインをインストールしました。"
    else
      echo "[警告] node-build プラグインのクローンに失敗しました。"
    fi
  fi
else
  echo "nodenv がインストールされていないため、node-build プラグインのインストールをスキップします。"
fi

echo "セットアップが完了しました: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "ログ: $LOGFILE"
echo ""
echo "新しいシェルで nodenv を使用するには、以下をシェル設定ファイルに追加してください:"
echo "  export PATH=\"$ANYENV_DIR/bin:\$PATH\"" 
echo "  eval \"\$(anyenv init -)\"" 
echo "  [ -d $NODENV_DIR ] && export NODENV_ROOT=\"$NODENV_DIR\" && export PATH=\"$NODENV_DIR/bin:\$PATH\" && command -v nodenv >/dev/null 2>&1 && eval \"\$(nodenv init -)\""
echo ""
echo "使用例: nodenv install 18.20.1 && nodenv global 18.20.1 && nodenv rehash"
echo ""

# Node.js バージョンの自動検出とインストール
detect_node_version() {
  # ワークスペースルートディレクトリを取得（post-create.shの実行ディレクトリの親）
  # 通常 post-create.sh は /workspaces/<project>/.devcontainer で実行されるため
  local SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  
  # 1) .workspace_node_version ファイルの確認（優先度最高）
  if [ -f "$HOME_DIR/.workspace_node_version" ]; then
    cat "$HOME_DIR/.workspace_node_version"
    return 0
  fi

  # 2) プロジェクトルートの .node-version ファイルの確認
  if [ -f "$WORKSPACE_ROOT/.node-version" ]; then
    cat "$WORKSPACE_ROOT/.node-version"
    return 0
  fi
  
  # カレントディレクトリにも.node-versionがある場合は検出
  if [ -f ".node-version" ]; then
    cat ".node-version"
    return 0
  fi

  # 3) package.json の engines.node フィールドの確認
  local PKG_JSON="$WORKSPACE_ROOT/package.json"
  if [ -f "$PKG_JSON" ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$PKG_JSON'));console.log((p.engines&&p.engines.node)||'')" 2>/dev/null || true
      return 0
    else
      NODE_ENGINE=$(grep -oP '"engines"\s*:\s*\{[^}]*"node"\s*:\s*"\K[^"]+' "$PKG_JSON" 2>/dev/null || true)
      if [ -n "$NODE_ENGINE" ]; then
        echo "$NODE_ENGINE"
        return 0
      fi
    fi
  fi

  return 1
}

# nodenv が利用可能な場合のみ、Node.js のセットアップを実行
if command -v nodenv >/dev/null 2>&1; then
  # バージョン検出
  NODE_VER_RAW=$(detect_node_version || true)
  NODE_VER=$(echo "$NODE_VER_RAW" | tr -d ' \n\r' || true)

  # 検出できなかった場合はデフォルトバージョンを使用
  if [ -z "$NODE_VER" ]; then
    NODE_VER="$DEFAULT_NODE_VERSION"
    echo "明示的な Node.js バージョンが見つかりません。デフォルト $DEFAULT_NODE_VERSION を使用します。"
  else
    echo "Node.js バージョンを検出: $NODE_VER"
  fi

  # バージョンが設定されている場合（常にtrueになるはず）
  if [ -n "$NODE_VER" ]; then
    # インストール処理
    if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
      echo "Node.js $NODE_VER をインストール中..."
      nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || {
        echo "[警告] Node.js $NODE_VER のインストールに失敗しました。"
      }
    else
      echo "Node.js $NODE_VER は既にインストールされています。"
    fi

    # グローバル設定（.node-versionがあってもglobalは設定する）
    echo "グローバルの Node.js バージョンを $NODE_VER に設定します。"
    nodenv global "$NODE_VER" || echo "[警告] nodenv global の設定に失敗しました。"

    # プロジェクトに.node-versionがある場合はローカル設定も行う
    if [ -f ".node-version" ]; then
      echo "ローカルの Node.js バージョンも $NODE_VER に設定します。"
      nodenv local "$NODE_VER" || echo "[警告] nodenv local の設定に失敗しました。"
    fi

    # rehash
    nodenv rehash || echo "[警告] nodenv rehash に失敗しました。"

    # 設定確認
    CURRENT_GLOBAL=$(nodenv global 2>/dev/null || echo "未設定")
    echo "現在のグローバルバージョン: $CURRENT_GLOBAL"
    
    # npm/nodeのshimパス確認
    NPM_PATH=$(nodenv which npm 2>/dev/null || echo "未設定")
    NODE_PATH=$(nodenv which node 2>/dev/null || echo "未設定")
    echo "npm shimパス: $NPM_PATH"
    echo "node shimパス: $NODE_PATH"
    
    # /workspaces での動作確認（serenaの実行環境）
    if (cd /workspaces && node -v >/dev/null 2>&1); then
      WORKSPACES_NODE_VER=$(cd /workspaces && node -v)
      echo "✓ /workspaces で node コマンドが正常に動作します: $WORKSPACES_NODE_VER"
    else
      echo "[警告] /workspaces で node コマンドが失敗しました。"
      echo "リカバリ手順: eval \"\$(nodenv init -)\" を実行してください。"
    fi
  fi
else
  echo "[警告] nodenv がインストールされていません。Node.js のセットアップをスキップします。"
fi

# Claude Code CLI のネイティブインストール
echo "Claude Code CLI をインストール中..."

# インストール済みチェック(冪等性確保)
if command -v claude >/dev/null 2>&1; then
  INSTALLED_VERSION=$(claude --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
  echo "Claude Code CLI は既にインストールされています: v${INSTALLED_VERSION}"
  echo "再インストールをスキップします。"
else
  # ログファイルの設定(日付ローテーション)
  LOG_DIR="${HOME}/.cache/claude-install-logs"
  mkdir -p "$LOG_DIR"
  LOGFILE_CLAUDE="${LOG_DIR}/install-$(date '+%Y%m%d').log"
  touch "$LOGFILE_CLAUDE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Claude Code CLI インストール開始" | tee -a "$LOGFILE_CLAUDE"

  # 古いログファイルのクリーンアップ(7日以上前のログを削除)
  find "$LOG_DIR" -name "install-*.log" -mtime +7 -delete 2>/dev/null || true

  # アーキテクチャとOSの検出
  ARCH=$(uname -m)
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')

  # アーキテクチャの正規化
  case "$ARCH" in
    x86_64|amd64)
      ARCH="x64"
      ;;
    aarch64|arm64)
      ARCH="arm64"
      ;;
    *)
      echo "[エラー] サポートされていないアーキテクチャ: $ARCH" | tee -a "$LOGFILE_CLAUDE"
      ;;
  esac

  # インストールスクリプトのダウンロードと実行
  INSTALL_URL="https://claude.ai/install.sh"
  MAX_RETRIES=3
  RETRY_COUNT=0

  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -fsSL "$INSTALL_URL" 2>&1 | tee -a "$LOGFILE_CLAUDE" | bash; then
      echo "Claude Code CLI のインストールに成功しました。" | tee -a "$LOGFILE_CLAUDE"
      break
    else
      RETRY_COUNT=$((RETRY_COUNT + 1))
      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo "[警告] インストール失敗。リトライ中... ($RETRY_COUNT/$MAX_RETRIES)" | tee -a "$LOGFILE_CLAUDE"
        sleep 2
      else
        echo "[エラー] Claude Code CLI のインストールに失敗しました。ログを確認してください: $LOGFILE_CLAUDE" | tee -a "$LOGFILE_CLAUDE"
      fi
    fi
  done

  # インストール先の確認とPATH設定
  CLAUDE_INSTALL_DIR="$HOME/.local/bin"
  if [ ! -d "$CLAUDE_INSTALL_DIR" ]; then
    CLAUDE_INSTALL_DIR="/usr/local/bin"
  fi

  # PATH への追加(存在しない場合のみ)
  if [ -d "$CLAUDE_INSTALL_DIR" ]; then
    export PATH="$CLAUDE_INSTALL_DIR:$PATH"
    
    # 各シェル設定ファイルへの PATH 追加(bash / zsh 対応)
    for SHELL_RC in "$HOME/.bashrc" "$HOME/.zshrc"; do
      if [ -f "$SHELL_RC" ]; then
        if ! grep -q "# Claude Code CLI" "$SHELL_RC"; then
          echo "" >> "$SHELL_RC"
          echo "# Claude Code CLI" >> "$SHELL_RC"
          echo "export PATH=\"$CLAUDE_INSTALL_DIR:\$PATH\"" >> "$SHELL_RC"
          echo "$(basename $SHELL_RC) に Claude Code CLI の PATH を追加しました" | tee -a "$LOGFILE_CLAUDE"
        fi
      fi
    done
  fi

  # インストール確認
  if command -v claude >/dev/null 2>&1; then
    FINAL_VERSION=$(claude --version 2>/dev/null || echo "version check failed")
    echo "Claude Code CLI が正常にインストールされました: ${FINAL_VERSION}" | tee -a "$LOGFILE_CLAUDE"
  else
    echo "[警告] Claude Code CLI が見つかりません。手動でインストールしてください。" | tee -a "$LOGFILE_CLAUDE"
  fi
fi

# ======================================
# uv (Astral Python Package Manager) のインストール
# ======================================
echo "uv をインストール中..."

# インストール済みチェック（冪等性確保）
if command -v uv >/dev/null 2>&1; then
  INSTALLED_UV_VERSION=$(uv --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
  echo "uv は既にインストールされています: v${INSTALLED_UV_VERSION}"
  echo "再インストールをスキップします。"
else
  # ログファイルの設定（日付ローテーション）
  UV_LOG_DIR="${HOME}/.cache/uv-install-logs"
  mkdir -p "$UV_LOG_DIR"
  UV_LOGFILE="${UV_LOG_DIR}/install-$(date '+%Y%m%d').log"
  touch "$UV_LOGFILE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] uv インストール開始" | tee -a "$UV_LOGFILE"

  # 古いログファイルのクリーンアップ（7日以上前のログを削除）
  find "$UV_LOG_DIR" -name "install-*.log" -mtime +7 -delete 2>/dev/null || true

  # uvインストールスクリプトのダウンロードと実行
  UV_INSTALL_URL="https://astral.sh/uv/install.sh"
  UV_MAX_RETRIES=3
  UV_RETRY_COUNT=0

  while [ $UV_RETRY_COUNT -lt $UV_MAX_RETRIES ]; do
    if curl -fsSL "$UV_INSTALL_URL" 2>&1 | tee -a "$UV_LOGFILE" | sh; then
      echo "uv のインストールに成功しました。" | tee -a "$UV_LOGFILE"
      break
    else
      UV_RETRY_COUNT=$((UV_RETRY_COUNT + 1))
      if [ $UV_RETRY_COUNT -lt $UV_MAX_RETRIES ]; then
        echo "[警告] インストール失敗。リトライ中... ($UV_RETRY_COUNT/$UV_MAX_RETRIES)" | tee -a "$UV_LOGFILE"
        sleep 2
      else
        echo "[エラー] uv のインストールに失敗しました。ログを確認してください: $UV_LOGFILE" | tee -a "$UV_LOGFILE"
      fi
    fi
  done

  # インストール先の確認とPATH設定
  UV_INSTALL_DIR="$HOME/.local/bin"
  if [ ! -d "$UV_INSTALL_DIR" ]; then
    UV_INSTALL_DIR="$HOME/.cargo/bin"
  fi

  # PATH への追加（存在しない場合のみ）
  if [ -d "$UV_INSTALL_DIR" ]; then
    export PATH="$UV_INSTALL_DIR:$PATH"
    
    # 各シェル設定ファイルへの PATH 追加（bash / zsh 対応）
    for SHELL_RC in "$HOME/.bashrc" "$HOME/.zshrc"; do
      # シェル設定ファイルが存在しない場合は作成
      if [ ! -f "$SHELL_RC" ]; then
        touch "$SHELL_RC"
        echo "$(basename $SHELL_RC) を新規作成しました" | tee -a "$UV_LOGFILE"
      fi
      
      # マーカーコメントの有無に関わらず、ディレクトリパスの重複チェックを実施
      # これにより手動追加された設定との競合も回避
      if ! grep -qF "$UV_INSTALL_DIR" "$SHELL_RC"; then
        echo "" >> "$SHELL_RC"
        echo "# uv - Astral Python Package Manager" >> "$SHELL_RC"
        echo "# PATH重複回避のためcase文を使用" >> "$SHELL_RC"
        echo "case \":\$PATH:\" in" >> "$SHELL_RC"
        echo "  *:\"$UV_INSTALL_DIR\":*) ;;" >> "$SHELL_RC"
        echo "  *) export PATH=\"$UV_INSTALL_DIR:\$PATH\" ;;" >> "$SHELL_RC"
        echo "esac" >> "$SHELL_RC"
        echo "$(basename $SHELL_RC) に uv の PATH を追加しました" | tee -a "$UV_LOGFILE"
      else
        echo "$(basename $SHELL_RC) には既に $UV_INSTALL_DIR が含まれています（スキップ）" | tee -a "$UV_LOGFILE"
      fi
    done
  fi

  # インストール確認
  if command -v uv >/dev/null 2>&1; then
    FINAL_UV_VERSION=$(uv --version 2>/dev/null || echo "version check failed")
    echo "uv が正常にインストールされました: ${FINAL_UV_VERSION}" | tee -a "$UV_LOGFILE"
    
    # uvx の確認
    if command -v uvx >/dev/null 2>&1; then
      echo "uvx コマンドも利用可能です。" | tee -a "$UV_LOGFILE"
    else
      echo "[警告] uvx コマンドが見つかりません。" | tee -a "$UV_LOGFILE"
    fi
  else
    echo "[警告] uv が見つかりません。手動でインストールしてください。" | tee -a "$UV_LOGFILE"
  fi
fi

# Claude Code 環境変数(オプション)
if ! grep -q "# Claude Code 環境変数" ~/.bashrc; then
  echo "" >> ~/.bashrc
  echo "# Claude Code 環境変数" >> ~/.bashrc
  echo "export CLAUDE_CODE_EXIT_AFTER_STOP_DELAY=5000" >> ~/.bashrc
  echo "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0" >> ~/.bashrc
  echo "export DISABLE_AUTOUPDATER=0" >> ~/.bashrc
  echo "Claude Code 環境変数を .bashrc に追加しました"
fi
