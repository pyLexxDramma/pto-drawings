#!/usr/bin/env bash
# Let's Encrypt для уже поднятого VPS (nginx + certbot).
# Запуск на сервере от root:
#   bash /var/www/pto/scripts/enable-ssl.sh pto.example.ru
#
# Домен должен A-записью смотреть на IP сервера. Голый IP сертификат не получить.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Использование: bash enable-ssl.sh your-domain.ru"
  exit 1
fi

if [[ "$DOMAIN" =~ ^[0-9.]+$ ]]; then
  echo "Let's Encrypt не выписывает сертификат на голый IP. Нужен домен."
  exit 1
fi

apt-get update -y
apt-get install -y certbot python3-certbot-nginx

# server_name в nginx — перед certbot откатываем редирект на self-signed, если был
cat >/etc/nginx/sites-available/pto <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name $DOMAIN _;

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

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email

echo
echo "Готово: https://$DOMAIN"
echo "Проверка авто-продления: certbot renew --dry-run"
