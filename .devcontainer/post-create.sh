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
  # 1) .node-version ファイルの確認
  if [ -f "$HOME_DIR/.workspace_node_version" ]; then
    cat "$HOME_DIR/.workspace_node_version"
    return 0
  fi

  if [ -f ".node-version" ]; then
    cat ".node-version"
    return 0
  fi

  # 2) package.json の engines.node フィールドの確認
  if [ -f "package.json" ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));console.log((p.engines&&p.engines.node)||'')" || true
      return 0
    else
      NODE_ENGINE=$(grep -oP '"engines"\s*:\s*\{[^}]*"node"\s*:\s*"\K[^"]+' package.json || true)
      if [ -n "$NODE_ENGINE" ]; then
        echo "$NODE_ENGINE"
        return 0
      fi
    fi
  fi

  return 1
}

NODE_VER_RAW=$(detect_node_version || true)
NODE_VER=$(echo "$NODE_VER_RAW" | tr -d ' \n\r' || true)

if [ -n "$NODE_VER" ] && command -v nodenv >/dev/null 2>&1; then
  echo "Node.js バージョンを検出: $NODE_VER"
  if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
    echo "Node.js $NODE_VER をインストール中..."
    nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || true
  else
    echo "Node.js $NODE_VER は既にインストールされています。"
  fi

  # プロジェクトに .node-version がある場合はローカル設定、なければグローバル設定
  if [ -f ".node-version" ]; then
    echo "ローカルの Node.js バージョンを $NODE_VER に設定します。"
    nodenv local "$NODE_VER" || true
  else
    echo "グローバルの Node.js バージョンを $NODE_VER に設定します。"
    nodenv global "$NODE_VER" || true
  fi

  nodenv rehash || true
elif [ -n "$NODE_VER" ]; then
  echo "Node.js バージョン '$NODE_VER' が検出されましたが、nodenv がインストールされていません。"
else
  if [ -n "$DEFAULT_NODE_VERSION" ] && command -v nodenv >/dev/null 2>&1; then
    echo "明示的な Node.js バージョンが見つかりません。デフォルト $DEFAULT_NODE_VERSION を使用します。"
    NODE_VER="$DEFAULT_NODE_VERSION"
    if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
      echo "デフォルトの Node.js $NODE_VER をインストール中..."
      nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || true
    fi
    nodenv global "$NODE_VER" || true
    nodenv rehash || true
  else
    echo "Node.js バージョンが検出されず(.node-version / package.json engines.node)、デフォルトも適用されませんでした。"
  fi
fi

# GitHub Copilot CLI のインストール
echo "GitHub Copilot CLI をインストール中..."
if command -v node >/dev/null 2>&1; then
  npm install -g @github/copilot || echo "[警告] GitHub Copilot CLI のインストールに失敗しました。"
  
  # npm グローバル bin ディレクトリを PATH に追加（現在のセッション用）
  NPM_BIN_DIR="$(npm bin -g 2>/dev/null || true)"
  if [ -n "$NPM_BIN_DIR" ]; then
    export PATH="$NPM_BIN_DIR:$PATH"
    echo "GitHub Copilot CLI をインストールしました。"
    echo "PATH に npm グローバル bin を追加: $NPM_BIN_DIR"
    
    # .bashrc への PATH 設定追加（永続化・重複チェック付き）
    # 複数回実行されても既存の設定はスキップされる
    if ! grep -q "# GitHub Copilot CLI" ~/.bashrc; then
      echo "" >> ~/.bashrc
      echo "# GitHub Copilot CLI" >> ~/.bashrc
      echo "export PATH=\"$NPM_BIN_DIR:\$PATH\"" >> ~/.bashrc
      echo ".bashrc に npm グローバル bin の PATH を追加しました: $NPM_BIN_DIR"
      
      # 即座に設定を反映（現在のセッションで利用可能にする）
      source ~/.bashrc || true
    else
      echo ".bashrc には既に GitHub Copilot CLI の設定が存在します。"
      echo "※ PATH が変更されている場合は、手動で .bashrc の該当行を更新してください。"
    fi
  fi
  
  # nodenv の shim を更新
  if command -v nodenv >/dev/null 2>&1; then
    nodenv rehash || true
  fi
else
  echo "[警告] Node.js がインストールされていないため、GitHub Copilot CLI のインストールをスキップします。"
fi
