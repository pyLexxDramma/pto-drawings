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

# server_name в nginx
if grep -q "server_name" /etc/nginx/sites-available/pto; then
  sed -i "s/server_name .*/server_name $DOMAIN;/" /etc/nginx/sites-available/pto
fi
nginx -t
systemctl reload nginx

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email

echo
echo "Готово: https://$DOMAIN"
echo "Проверка авто-продления: certbot renew --dry-run"
