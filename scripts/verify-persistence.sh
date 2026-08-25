#!/usr/bin/env bash
# DoD: файлы переживают restart сервиса (и путь DATA_ROOT вне APP_DIR).
set -euo pipefail

DATA_ROOT="${PTO_DATA_ROOT:-/var/lib/pto}"
APP_DIR="${PTO_APP_DIR:-/var/www/pto}"
MARKER="$DATA_ROOT/uploads/_persist_marker_$(date +%s).txt"

if [[ ! -f "$DATA_ROOT/data/db.json" ]]; then
  echo "FAIL: нет $DATA_ROOT/data/db.json" >&2
  exit 1
fi

before_docs=$(python3 - <<PY
import json
print(len(json.load(open("$DATA_ROOT/data/db.json")).get("documents", [])))
PY
)
before_uploads=$(find "$DATA_ROOT/uploads" -type f | wc -l | tr -d ' ')
echo "marker" >"$MARKER"
chown pto:pto "$MARKER" 2>/dev/null || true

systemctl restart pto
sleep 3
systemctl is-active --quiet pto

after_docs=$(python3 - <<PY
import json
print(len(json.load(open("$DATA_ROOT/data/db.json")).get("documents", [])))
PY
)
after_uploads=$(find "$DATA_ROOT/uploads" -type f | wc -l | tr -d ' ')

if [[ ! -f "$MARKER" ]]; then
  echo "FAIL: marker пропал после restart" >&2
  exit 1
fi
rm -f "$MARKER"

if [[ "$before_docs" != "$after_docs" ]]; then
  echo "FAIL: documents $before_docs → $after_docs" >&2
  exit 1
fi

echo "OK persistence"
echo "DATA_ROOT=$DATA_ROOT"
echo "documents=$after_docs uploads=$((after_uploads - 1))"
echo "APP_DIR_data_exists=$([[ -d $APP_DIR/data ]] && echo yes || echo no)"
unit_root=$(systemctl show pto -p Environment --value | tr ' ' '\n' | awk -F= '/^DATA_ROOT=/{print $2}')
echo "systemd_DATA_ROOT=${unit_root:-<empty>}"
