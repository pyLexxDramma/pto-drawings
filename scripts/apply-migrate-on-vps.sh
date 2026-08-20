#!/usr/bin/env bash
set -euo pipefail
APP=/var/www/pto
PASS="${1:?password required}"
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/pto-backups
if [ -d "$APP/data" ]; then cp -a "$APP/data" "/root/pto-backups/data-$ts"; fi
if [ -d "$APP/uploads" ]; then cp -a "$APP/uploads" "/root/pto-backups/uploads-$ts"; fi
rm -rf "$APP/data" "$APP/uploads"
cp -a /tmp/pto-migrate/data "$APP/data"
cp -a /tmp/pto-migrate/uploads "$APP/uploads"
rm -f "$APP/data/.dev-session-secret" "$APP/data/.lock"
chown -R pto:pto "$APP/data" "$APP/uploads"
chmod +x "$APP/scripts/set-admin-password.mjs"
cd "$APP"
sudo -u pto env PTO_APP_DIR="$APP" node scripts/set-admin-password.mjs "$PASS" admin
systemctl start pto
sleep 2
systemctl is-active pto
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/auth/me
echo "uploads:"
ls "$APP/uploads"
echo "documents: $(ls "$APP/data/documents" | wc -l)"
