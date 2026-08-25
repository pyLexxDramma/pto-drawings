#!/usr/bin/env bash
# Осторожная миграция данных на VPS. НЕ удаляет текущие data/uploads,
# пока источник не проверен и не сделан бэкап.
set -euo pipefail

APP="${PTO_APP_DIR:-/var/www/pto}"
DATA_ROOT="${PTO_DATA_ROOT:-/var/lib/pto}"
SRC="${1:-/tmp/pto-migrate}"
PASS="${2:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Нужен root" >&2
  exit 1
fi

if [[ ! -d "$SRC/data" || ! -f "$SRC/data/db.json" ]]; then
  echo "Источник неполный: нужен $SRC/data/db.json" >&2
  exit 1
fi

src_uploads=$(find "$SRC/uploads" -type f 2>/dev/null | wc -l | tr -d ' ')
src_docs=$(find "$SRC/data/documents" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$src_uploads" -lt 1 && "$src_docs" -lt 1 ]]; then
  echo "Отказ: источник пустой (uploads=$src_uploads docs=$src_docs). Текущие данные не трогаю." >&2
  exit 1
fi

ts=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/pto-backups

# Актуальные пути: сначала DATA_ROOT, иначе legacy внутри APP.
LIVE_DATA=""
LIVE_UPLOADS=""
if [[ -d "$DATA_ROOT/data" ]]; then LIVE_DATA="$DATA_ROOT/data"; fi
if [[ -d "$DATA_ROOT/uploads" ]]; then LIVE_UPLOADS="$DATA_ROOT/uploads"; fi
if [[ -z "$LIVE_DATA" && -d "$APP/data" ]]; then LIVE_DATA="$APP/data"; fi
if [[ -z "$LIVE_UPLOADS" && -d "$APP/uploads" ]]; then LIVE_UPLOADS="$APP/uploads"; fi

if [[ -n "$LIVE_DATA" ]]; then
  cp -a "$LIVE_DATA" "/root/pto-backups/data-$ts"
  echo "backup data → /root/pto-backups/data-$ts"
fi
if [[ -n "$LIVE_UPLOADS" ]]; then
  cp -a "$LIVE_UPLOADS" "/root/pto-backups/uploads-$ts"
  echo "backup uploads → /root/pto-backups/uploads-$ts"
fi

TARGET_DATA="${DATA_ROOT}/data"
TARGET_UPLOADS="${DATA_ROOT}/uploads"
mkdir -p "$DATA_ROOT"

# Атомарная замена: копируем во временные каталоги, затем rename.
rm -rf "$DATA_ROOT/data.next" "$DATA_ROOT/uploads.next"
cp -a "$SRC/data" "$DATA_ROOT/data.next"
mkdir -p "$SRC/uploads"
cp -a "$SRC/uploads" "$DATA_ROOT/uploads.next"

if [[ -d "$TARGET_DATA" ]]; then mv "$TARGET_DATA" "$DATA_ROOT/data.prev-$ts"; fi
if [[ -d "$TARGET_UPLOADS" ]]; then mv "$TARGET_UPLOADS" "$DATA_ROOT/uploads.prev-$ts"; fi
mv "$DATA_ROOT/data.next" "$TARGET_DATA"
mv "$DATA_ROOT/uploads.next" "$TARGET_UPLOADS"

rm -f "$TARGET_DATA/.dev-session-secret" "$TARGET_DATA/.lock"
chown -R pto:pto "$DATA_ROOT"

# Legacy-копии внутри APP больше не используем.
if [[ -d "$APP/data" ]]; then mv "$APP/data" "$APP/data.legacy-$ts"; fi
if [[ -d "$APP/uploads" ]]; then mv "$APP/uploads" "$APP/uploads.legacy-$ts"; fi

if [[ -n "$PASS" ]]; then
  chmod +x "$APP/scripts/set-admin-password.mjs"
  cd "$APP"
  sudo -u pto env DATA_ROOT="$DATA_ROOT" PTO_APP_DIR="$DATA_ROOT" node scripts/set-admin-password.mjs "$PASS" admin
fi

systemctl restart pto
sleep 2
systemctl is-active pto
echo "uploads: $(ls "$TARGET_UPLOADS" | wc -l)"
echo "documents: $(ls "$TARGET_DATA/documents" | wc -l)"
