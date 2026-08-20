#!/usr/bin/env bash
# Обновление уже настроенного VPS. Вызывается из GitHub Actions по SSH.
set -euo pipefail

APP_DIR="${PTO_APP_DIR:-/var/www/pto}"
BRANCH="${PTO_BRANCH:-main}"
APP_USER="${PTO_APP_USER:-pto}"

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

run_as_app git fetch --all --prune
run_as_app git reset --hard "origin/$BRANCH"
run_as_app npm ci
run_as_app npm run build

if command -v systemctl >/dev/null 2>&1; then
  systemctl restart pto
  systemctl is-active --quiet pto
fi

echo "deployed $(run_as_app git rev-parse --short HEAD) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
