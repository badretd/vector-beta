#!/usr/bin/env bash
# Vector launcher. Creates a local virtualenv on first run, then starts the app.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  PY=""
  for candidate in python3.12 python3.13 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
  done
  if [ -z "$PY" ]; then
    echo "Python 3.11+ is required." >&2
    exit 1
  fi
  echo "Creating virtual environment with $PY…"
  "$PY" -m venv .venv
fi

if [ ! -f ".venv/.vector-installed" ]; then
  echo "Installing dependencies (first run only)…"
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt
  touch .venv/.vector-installed
fi

exec .venv/bin/python -m vector "$@"
