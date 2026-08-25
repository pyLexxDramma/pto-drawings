#!/usr/bin/env bash
# Выносит data/ и uploads/ из каталога приложения в /var/lib/pto,
# чтобы git reset / migrate / чистка APP_DIR не трогали пользовательские файлы.
set -euo pipefail

APP_DIR="${PTO_APP_DIR:-/var/www/pto}"
DATA_ROOT="${PTO_DATA_ROOT:-/var/lib/pto}"
APP_USER="${PTO_APP_USER:-pto}"
SERVICE="${PTO_SERVICE:-pto}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Нужен root" >&2
  exit 1
fi

mkdir -p "$DATA_ROOT"
if [[ -d "$APP_DIR/data" && ! -e "$DATA_ROOT/data" ]]; then
  echo "Перенос $APP_DIR/data → $DATA_ROOT/data"
  mv "$APP_DIR/data" "$DATA_ROOT/data"
elif [[ -d "$APP_DIR/data" && -d "$DATA_ROOT/data" ]]; then
  echo "Оставляю $DATA_ROOT/data (уже есть). Старое: $APP_DIR/data"
fi

if [[ -d "$APP_DIR/uploads" && ! -e "$DATA_ROOT/uploads" ]]; then
  echo "Перенос $APP_DIR/uploads → $DATA_ROOT/uploads"
  mv "$APP_DIR/uploads" "$DATA_ROOT/uploads"
elif [[ -d "$APP_DIR/uploads" && -d "$DATA_ROOT/uploads" ]]; then
  echo "Оставляю $DATA_ROOT/uploads (уже есть). Старое: $APP_DIR/uploads"
fi

mkdir -p "$DATA_ROOT/data/documents" "$DATA_ROOT/uploads"
# Не держим рабочие копии внутри APP_DIR — иначе снова сотрут migrate/clean.
if [[ -d "$APP_DIR/data" ]]; then
  ts=$(date +%Y%m%d-%H%M%S)
  mv "$APP_DIR/data" "$APP_DIR/data.bak-$ts"
  echo "Старый data убран в $APP_DIR/data.bak-$ts"
fi
if [[ -d "$APP_DIR/uploads" ]]; then
  ts=$(date +%Y%m%d-%H%M%S)
  mv "$APP_DIR/uploads" "$APP_DIR/uploads.bak-$ts"
  echo "Старый uploads убран в $APP_DIR/uploads.bak-$ts"
fi

chown -R "$APP_USER:$APP_USER" "$DATA_ROOT"
chmod 750 "$DATA_ROOT" "$DATA_ROOT/data" "$DATA_ROOT/uploads"

SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
if [[ ! -f "$SERVICE_FILE" ]]; then
  echo "Нет $SERVICE_FILE" >&2
  exit 1
fi

# Переписываем unit с явным DATA_ROOT вне APP_DIR.
cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=PTO drawings review
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=DATA_ROOT=$DATA_ROOT
EnvironmentFile=-$APP_DIR/.env.local
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

echo "DATA_ROOT=$DATA_ROOT"
echo "db: $(wc -c <"$DATA_ROOT/data/db.json") bytes"
echo "uploads: $(ls "$DATA_ROOT/uploads" | wc -l)"
echo "documents: $(ls "$DATA_ROOT/data/documents" | wc -l)"
