#!/usr/bin/env bash
# Обновление уже настроенного VPS. Вызывается из GitHub Actions по SSH.
set -euo pipefail

APP_DIR="${PTO_APP_DIR:-/var/www/pto}"
BRANCH="${PTO_BRANCH:-main}"
APP_USER="${PTO_APP_USER:-pto}"

export CI=true
export NEXT_TELEMETRY_DISABLED=1
# На слабом VPS Next иногда «молчит» минутами без OOM-kill — ограничиваем heap.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

cd "$APP_DIR"

run_as_app() {
  if [[ "$(id -un)" == "$APP_USER" ]]; then
    "$@"
  elif id -u "$APP_USER" >/dev/null 2>&1; then
    sudo -u "$APP_USER" -- "$@"
  else
    "$@"
  fi
}

step() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

step "git fetch $BRANCH"
run_as_app git fetch --all --prune
step "git reset --hard origin/$BRANCH"
run_as_app git reset --hard "origin/$BRANCH"
step "HEAD=$(run_as_app git rev-parse --short HEAD)"

step "npm ci"
run_as_app npm ci --no-audit --no-fund
step "npm run build"
run_as_app npm run build
step "build ok"

if command -v systemctl >/dev/null 2>&1; then
  step "systemctl restart pto"
  systemctl restart pto
  systemctl is-active --quiet pto
  step "pto active"
fi

step "deployed $(run_as_app git rev-parse --short HEAD)"
