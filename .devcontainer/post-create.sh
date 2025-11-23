#!/usr/bin/env bash
set -euo pipefail

# Internal fallback Node.js version used only if the project does not define
# a version via `.node-version` or `package.json engines.node`.
# Change this value to update the default (or set to empty to disable fallback).
DEFAULT_NODE_VERSION="22.21.1"

HOME_DIR="/home/vscode"
ANYENV_DIR="$HOME_DIR/.anyenv"
NODENV_DIR="$HOME_DIR/.nodenv"  # canonical path we expose; may symlink to anyenv-managed install
LOGFILE="$HOME_DIR/.anyenv_setup.log"

exec > >(tee -a "$LOGFILE") 2>&1

echo "==== anyenv/nodenv setup started at $(date -u +"%Y-%m-%dT%H:%M:%SZ") ===="

on_error() {
  echo "[ERROR] Setup failed at $(date -u +"%Y-%m-%dT%H:%M:%SZ"). See $LOGFILE for details."
  exit 1
}
trap on_error ERR

echo "Ensuring home dir ownership and required tools..."
chown -R vscode:vscode "$HOME_DIR" || true

apt_check_and_warn() {
  if ! command -v git >/dev/null 2>&1; then
    echo "[WARN] 'git' not found in PATH. Some installs may fail."
  fi
}
apt_check_and_warn

echo "Installing anyenv if missing..."
if [ ! -d "$ANYENV_DIR" ]; then
  git clone https://github.com/anyenv/anyenv.git "$ANYENV_DIR"
  mkdir -p "$ANYENV_DIR/.anyenv.d" || true
fi
chown -R vscode:vscode "$ANYENV_DIR" || true

# Ensure anyenv is on PATH for this script
export PATH="$ANYENV_DIR/bin:$PATH"
if command -v anyenv >/dev/null 2>&1; then
  eval "$(anyenv init -)" || true
else
  echo "[ERROR] anyenv not available after install."
  exit 1
fi

echo "Preparing anyenv definitions (non-interactive)..."
ANYENV_DEFINITION_ROOT="${XDG_CONFIG_HOME:-$HOME_DIR/.config}/anyenv/anyenv-install"
DEF_PARENT_DIR="$(dirname "$ANYENV_DEFINITION_ROOT")"
if [ ! -d "$ANYENV_DEFINITION_ROOT/.git" ]; then
  mkdir -p "$DEF_PARENT_DIR"
  echo "[INFO] Cloning anyenv-install definitions repository..."
  if git clone --depth 1 https://github.com/anyenv/anyenv-install.git "$ANYENV_DEFINITION_ROOT"; then
    echo "[INFO] anyenv definitions cloned."
  else
    echo "[WARN] Clone of anyenv-install failed; nodenv installation may fail."
  fi
else
  echo "[INFO] Updating existing anyenv definitions..."
  (cd "$ANYENV_DEFINITION_ROOT" && git fetch --depth 1 origin && git reset --hard origin/HEAD || echo "[WARN] Failed to update definitions")
fi

echo "Ensuring nodenv is installed via anyenv..."
if ! command -v nodenv >/dev/null 2>&1; then
  if ! anyenv versions | grep -q nodenv; then
    if anyenv install nodenv; then
      echo "nodenv installed"
    else
      echo "[WARN] nodenv installation failed; retrying once after refreshing definitions..."
      # Attempt one more time: refresh definitions if repo present but stale
      if [ -d "$ANYENV_DEFINITION_ROOT" ]; then
        (cd "$ANYENV_DEFINITION_ROOT" && git pull --ff-only || echo "[WARN] anyenv-install git pull failed")
      fi
      if anyenv install nodenv; then
        echo "nodenv installed on retry"
      else
        echo "[WARN] nodenv installation failed after retry; continuing without nodenv."
        echo "       Manual install example: git clone https://github.com/nodenv/nodenv.git $NODENV_DIR && export PATH=\"$NODENV_DIR/bin:$PATH\" && eval \"$(nodenv init -)\"" 
      fi
    fi
  fi
fi

detect_nodenv_root() {
  # Priority: existing NODENV_ROOT, anyenv managed, legacy ~/.nodenv
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
  # Create symlink ~/.nodenv if different
  if [ "$REAL_NODENV_ROOT" != "$NODENV_DIR" ] && [ ! -e "$NODENV_DIR" ]; then
    ln -s "$REAL_NODENV_ROOT" "$NODENV_DIR" || echo "[WARN] Failed to symlink $REAL_NODENV_ROOT to $NODENV_DIR"
  fi
  export NODENV_ROOT="$REAL_NODENV_ROOT"
  export PATH="$NODENV_ROOT/bin:$PATH"
  if command -v nodenv >/dev/null 2>&1; then
    eval "$(nodenv init -)" || true
    echo "[INFO] nodenv initialized (root=$NODENV_ROOT)"
  else
    echo "[WARN] nodenv binary not found even after setting PATH (root=$NODENV_ROOT)"
  fi
else
  echo "[INFO] nodenv not detected yet (will skip init)"
fi

if [ -n "$REAL_NODENV_ROOT" ] && [ -d "$REAL_NODENV_ROOT" ]; then
  echo "Installing node-build plugin if missing..."
  if [ ! -d "$REAL_NODENV_ROOT/plugins/node-build" ]; then
    mkdir -p "$REAL_NODENV_ROOT/plugins"
    if git clone https://github.com/nodenv/node-build.git "$REAL_NODENV_ROOT/plugins/node-build"; then
      chown -R vscode:vscode "$REAL_NODENV_ROOT/plugins/node-build" || true
    else
      echo "[WARN] Failed to clone node-build plugin"
    fi
  fi
else
  echo "[INFO] Skipping node-build plugin install (nodenv not installed)"
fi

echo "Setup completed successfully at $(date -u +"%Y-%m-%dT%H:%M:%SZ"). Log: $LOGFILE"
echo "To use nodenv in a new shell (if installed), add to your shell RC:"
echo "  export PATH=\"$ANYENV_DIR/bin:\$PATH\"" 
echo "  eval \"$(anyenv init -)\"" 
echo "  [ -d $NODENV_DIR ] && export NODENV_ROOT=\"$NODENV_DIR\" && export PATH=\"$NODENV_DIR/bin:\$PATH\" && command -v nodenv >/dev/null 2>&1 && eval \"$(nodenv init -)\""

echo "Example: nodenv install 18.20.1 && nodenv global 18.20.1 && nodenv rehash"

# Auto-install Node version logic
detect_node_version() {
  # 1) .node-version in workspace root
  if [ -f "$HOME_DIR/.workspace_node_version" ]; then
    # support a helper file if workspace copies value here
    cat "$HOME_DIR/.workspace_node_version"
    return 0
  fi

  # If repository root has .node-version, try to read it (works if mounted)
  if [ -f "/workspaces" ]; then
    : # noop, keep portable
  fi

  # Try common locations relative to home or current workspace
  if [ -f ".node-version" ]; then
    cat ".node-version"
    return 0
  fi

  if [ -f "package.json" ]; then
    # Extract engines.node using node (if available) or jq if installed
    if command -v node >/dev/null 2>&1; then
      node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));console.log((p.engines&&p.engines.node)||'')" || true
      return 0
    else
      # Try grep + sed fallback
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
  echo "Detected node version specifier: '$NODE_VER'"
  # If version contains semver range or npm tag, node-build may not accept it; try to use exact numbers
  # We will try to install as-is; nodenv will fail if not available.
  if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
    echo "Installing Node $NODE_VER via nodenv..."
  nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || true
  else
    echo "Node $NODE_VER already installed in nodenv"
  fi

  # If project has .node-version in workspace root, set local; else set global
  if [ -f ".node-version" ]; then
    echo "Setting local node version to $NODE_VER"
  nodenv local "$NODE_VER" || true
  else
    echo "Setting global node version to $NODE_VER"
  nodenv global "$NODE_VER" || true
  fi

  nodenv rehash || true
elif [ -n "$NODE_VER" ]; then
  echo "[INFO] Detected Node version '$NODE_VER' but nodenv is not installed; skipping Node installation."
else
  if [ -n "$DEFAULT_NODE_VERSION" ] && command -v nodenv >/dev/null 2>&1; then
    echo "No explicit Node version found; using fallback default $DEFAULT_NODE_VERSION"
    NODE_VER="$DEFAULT_NODE_VERSION"
    if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
      echo "Installing fallback Node $NODE_VER via nodenv..."
      nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || true
    fi
    nodenv global "$NODE_VER" || true
    nodenv rehash || true
  else
    echo "No Node version detected (.node-version / package.json engines.node) and no fallback applied."
  fi
fi
