#!/usr/bin/env bash
# HTTPS на голый IP (self-signed). Let's Encrypt на IP не выдаёт — для прода с доменом
# лучше enable-ssl.sh. Self-signed нужен, чтобы getUserMedia работал в Chrome:
# после первого «Продолжить» микрофон включается.
set -euo pipefail

APP_DIR="${PTO_APP_DIR:-/var/www/pto}"
SSL_DIR="/etc/nginx/ssl"
CRT="$SSL_DIR/pto-selfsigned.crt"
KEY="$SSL_DIR/pto-selfsigned.key"
CN="${PTO_SSL_CN:-201.24.50.177}"

if [[ -d /etc/letsencrypt/live ]] && ls /etc/letsencrypt/live/*/fullchain.pem >/dev/null 2>&1; then
  echo "Let's Encrypt уже настроен — self-signed не трогаем."
  exit 0
fi

apt-get update -y
apt-get install -y openssl nginx

mkdir -p "$SSL_DIR"
if [[ ! -f "$CRT" ]]; then
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "$KEY" \
    -out "$CRT" \
    -subj "/CN=$CN/O=PTO/C=RU"
  chmod 640 "$KEY"
fi

cat >/etc/nginx/sites-available/pto <<EOF
server {
  listen 443 ssl default_server;
  listen [::]:443 ssl default_server;
  server_name $CN _;

  ssl_certificate $CRT;
  ssl_certificate_key $KEY;

  client_max_body_size 80m;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 120s;
  }
}

server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name $CN _;
  return 301 https://\$host\$request_uri;
}
EOF

ln -sfn /etc/nginx/sites-available/pto /etc/nginx/sites-enabled/pto
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "HTTPS (self-signed) на https://$CN — в браузере один раз принять предупреждение."
