#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

RUN_DIR=".run"
SERVER_PID_FILE="$RUN_DIR/server.pid"
DEV_PID_FILE="$RUN_DIR/dev.pid"
SERVER_LOG="$RUN_DIR/server.log"
DEV_LOG="$RUN_DIR/dev.log"
DEV_PORT="${DEV_PORT:-3577}"
SERVER_PORT="${SERVER_PORT:-8787}"

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

do_start() {
  mkdir -p "$RUN_DIR"

  if is_running "$SERVER_PID_FILE"; then
    echo "server already running (pid $(cat "$SERVER_PID_FILE"))"
  else
    nohup npm run server >"$SERVER_LOG" 2>&1 &
    echo $! >"$SERVER_PID_FILE"
    echo "server started (pid $(cat "$SERVER_PID_FILE"), port $SERVER_PORT, log $SERVER_LOG)"
  fi

  if is_running "$DEV_PID_FILE"; then
    echo "dev already running (pid $(cat "$DEV_PID_FILE"))"
  else
    nohup npm run dev >"$DEV_LOG" 2>&1 &
    echo $! >"$DEV_PID_FILE"
    echo "dev started (pid $(cat "$DEV_PID_FILE"), port $DEV_PORT, log $DEV_LOG)"
  fi
}

do_stop() {
  local stopped_any=0
  for pid_file in "$SERVER_PID_FILE" "$DEV_PID_FILE"; do
    if is_running "$pid_file"; then
      local pid
      pid="$(cat "$pid_file")"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      echo "stopped $(basename "$pid_file" .pid) (pid $pid)"
      stopped_any=1
    fi
    rm -f "$pid_file"
  done
  [[ "$stopped_any" -eq 0 ]] && echo "nothing running"
  return 0
}

do_status() {
  local any_running=0
  for name_file in "server:$SERVER_PID_FILE" "dev:$DEV_PID_FILE"; do
    local name="${name_file%%:*}"
    local pid_file="${name_file#*:}"
    if is_running "$pid_file"; then
      echo "$name: running (pid $(cat "$pid_file"))"
      any_running=1
    else
      echo "$name: stopped"
    fi
  done
  [[ "$any_running" -eq 1 ]]
}

cmd="${1:-start}"
case "$cmd" in
  start) do_start ;;
  stop) do_stop ;;
  status) do_status ;;
  restart) do_stop; do_start ;;
  *)
    echo "usage: $0 {start|stop|status|restart}" >&2
    exit 1
    ;;
esac
