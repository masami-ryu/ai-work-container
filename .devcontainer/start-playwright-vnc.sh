#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-pwuser}"

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

xterm -fa Monospace -fs 11 -geometry 140x40+20+20 -e bash -lc 'cd /workspaces/ai-work-container/tools/playwright-recorder; printf "Playwright recorder ready.\\nUse pnpm codegen:auth <URL> or pnpm codegen:shift <URL>.\\n"; exec bash' >/tmp/xterm.log 2>&1 &

tail -f /tmp/xvfb.log /tmp/fluxbox.log /tmp/x11vnc.log /tmp/websockify.log /tmp/pnpm-version.log /tmp/playwright-command-server.log /tmp/xterm.log
