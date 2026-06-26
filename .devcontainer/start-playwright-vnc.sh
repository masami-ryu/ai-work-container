#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-pwuser}"
export PW_BATCH_ENABLED="${PW_BATCH_ENABLED:-0}"
export PW_BATCH_DIR="${PW_BATCH_DIR:-/workspaces/ai-work-container/works_pw_batch/pw_batch}"
export PW_BATCH_CONSUMER_LOG="${PW_BATCH_CONSUMER_LOG:-/tmp/pw-batch-consumer.log}"

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

start_pw_batch_consumer() {
  local consumer_log_dir
  consumer_log_dir="${PW_BATCH_CONSUMER_LOG%/*}"

  if [ "$consumer_log_dir" != "$PW_BATCH_CONSUMER_LOG" ]; then
    mkdir -p "$consumer_log_dir"
  fi

  : >"$PW_BATCH_CONSUMER_LOG"

  if ! is_truthy "$PW_BATCH_ENABLED"; then
    printf "pw_batch consumer disabled. Set PW_BATCH_ENABLED=1 to start it.\\n" >"$PW_BATCH_CONSUMER_LOG"
    return
  fi

  (
    set -euo pipefail
    cd "$PW_BATCH_DIR"
    printf "Starting pw_batch consumer in %s\\n" "$PW_BATCH_DIR"
    pnpm --version

    if [ ! -d node_modules ]; then
      pnpm install --frozen-lockfile || pnpm install
    fi

    exec pnpm consumer
  ) >>"$PW_BATCH_CONSUMER_LOG" 2>&1 &
}

mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

Xvfb "$DISPLAY" -screen 0 1440x960x24 >/tmp/xvfb.log 2>&1 &
fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "$DISPLAY" -nopw -forever -shared -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 0.0.0.0:6080 localhost:5900 >/tmp/websockify.log 2>&1 &

cd /workspaces/ai-work-container/tools/playwright-recorder

pnpm --version >/tmp/pnpm-version.log 2>&1

if [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile || pnpm install
fi

PLAYWRIGHT_COMMAND_HOST=0.0.0.0 PLAYWRIGHT_COMMAND_PORT=6090 node command-server.js >/tmp/playwright-command-server.log 2>&1 &

start_pw_batch_consumer

xterm -fa Monospace -fs 11 -geometry 140x40+20+20 -e bash -lc 'cd /workspaces/ai-work-container/tools/playwright-recorder; printf "Playwright recorder ready.\\nUse pnpm codegen:auth <URL> or pnpm codegen:shift <URL>.\\n"; exec bash' >/tmp/xterm.log 2>&1 &

tail -f /tmp/xvfb.log /tmp/fluxbox.log /tmp/x11vnc.log /tmp/websockify.log /tmp/pnpm-version.log /tmp/playwright-command-server.log "$PW_BATCH_CONSUMER_LOG" /tmp/xterm.log
