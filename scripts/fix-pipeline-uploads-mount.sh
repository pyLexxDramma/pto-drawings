#!/usr/bin/env bash
set -euo pipefail

ln -sfn /var/lib/pto/uploads /var/www/pto/uploads
ln -sfn /var/lib/pto/data /var/www/pto/data

ENV_FILE=/opt/pto/backend/.env
if grep -q '^PTO_UPLOADS_HOST_DIR=' "$ENV_FILE"; then
  sed -i 's|^PTO_UPLOADS_HOST_DIR=.*|PTO_UPLOADS_HOST_DIR=/var/lib/pto/uploads|' "$ENV_FILE"
else
  echo 'PTO_UPLOADS_HOST_DIR=/var/lib/pto/uploads' >>"$ENV_FILE"
fi
grep '^PTO_UPLOADS_HOST_DIR=' "$ENV_FILE"

COMPOSE=/opt/pto/backend/docker-compose.yml
if ! grep -q '/var/lib/pto/uploads' "$COMPOSE"; then
  python3 - <<'PY'
from pathlib import Path
p = Path("/opt/pto/backend/docker-compose.yml")
text = p.read_text()
old = "${PTO_UPLOADS_HOST_DIR:-./service/state/uploads}:/data/uploads"
new = old + "\n      - ${PTO_UPLOADS_HOST_DIR:-./service/state/uploads}:/var/lib/pto/uploads"
if old not in text:
    raise SystemExit("compose mount pattern not found")
p.write_text(text.replace(old, new, 1))
print("compose patched")
PY
else
  echo "compose already mentions /var/lib/pto/uploads"
fi

cd /opt/pto/backend
docker compose up -d --force-recreate pto-backend
sleep 4
docker inspect pto-backend --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
curl -s -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:8000/health
docker exec pto-backend ls -la /var/lib/pto/uploads/6a51edba-53cf-4f4f-92f4-604aa9c51b3c.pdf /data/uploads/6a51edba-53cf-4f4f-92f4-604aa9c51b3c.pdf
