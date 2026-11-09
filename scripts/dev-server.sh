#!/usr/bin/env bash
# Start or stop the Vite dev server for the VS Code tasks (.vscode/tasks.json).
# Runs in WSL, GitHub Codespaces, Linux, and macOS. A Windows window on a WSL folder hands off
# here through scripts/dev-server.ps1. Usage: bash scripts/dev-server.sh start|stop
set -u
PORT="${DEV_SERVER_PORT:-5173}"
cd "$(dirname "$0")/.."

# Non-interactive shells skip ~/.bashrc, where nvm usually loads. Under WSL the inherited Windows
# PATH can also offer Windows npm (/mnt/c/...), which cannot run Linux Node. Load nvm unless a
# Linux node and npm are already on PATH.
linux_tool() { local p; p="$(command -v "$1" 2>/dev/null)" && [ "${p#/mnt/}" = "$p" ]; }
if ! linux_tool node || ! linux_tool npm; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

# PIDs listening on the port, with whichever tool the machine has.
listeners() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$PORT/tcp" 2>/dev/null
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  fi
}

case "${1:-}" in
  start)
    exec npm run dev -- --port "$PORT" --strictPort
    ;;
  stop)
    pids="$(listeners | tr -s ' \n' ' ' | sed 's/^ *//; s/ *$//')"
    if [ -z "$pids" ]; then
      echo "No dev server is running on port $PORT."
      exit 0
    fi
    # shellcheck disable=SC2086
    kill $pids && echo "Stopped dev server on port $PORT (pid $pids)."
    ;;
  *)
    echo "usage: bash scripts/dev-server.sh start|stop" >&2
    exit 2
    ;;
esac
