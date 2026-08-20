#!/usr/bin/env bash
# Первичная настройка Ubuntu VPS под PTO (Timeweb / Beget / Selectel).
# Запуск: bash setup-vps.sh example.ru
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="${PTO_APP_DIR:-/var/www/pto}"
REPO_URL="${PTO_REPO_URL:-https://github.com/pyLexxDramma/pto-drawings.git}"
APP_USER="${PTO_APP_USER:-pto}"
NODE_MAJOR=20

if [[ -z "$DOMAIN" ]]; then
  echo "Использование: bash setup-vps.sh your-domain.ru"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx certbot python3-certbot-nginx git ufw

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --prune
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard origin/main
fi

cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev
sudo -u "$APP_USER" npm run init:env
sudo -u "$APP_USER" npm run build

cat >/etc/systemd/system/pto.service <<EOF
[Unit]
Description=PTO drawings review
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=8080
EnvironmentFile=-$APP_DIR/.env.local
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pto

cat >/etc/nginx/sites-available/pto <<EOF
server {
  listen 80;
  server_name $DOMAIN;

  client_max_body_size 80m;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 120s;
  }
}
EOF

ln -sfn /etc/nginx/sites-available/pto /etc/nginx/sites-enabled/pto
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || {
  echo "SSL пока не выписан (DNS ещё не указывает на сервер?). Позже: certbot --nginx -d $DOMAIN"
}

echo
echo "Готово: http://$DOMAIN (или https, если SSL прошёл)"
echo "Сервис: systemctl status pto"
echo "Секреты: $APP_DIR/.env.local"
echo "Смените пароль admin после первого входа."
