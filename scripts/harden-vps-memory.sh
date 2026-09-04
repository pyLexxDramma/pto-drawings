#!/usr/bin/env bash
# Защита маленького VPS от зависания при пике конвейера (swap + лимиты памяти).
# Идемпотентно. Запуск: root, из deploy-remote.sh или вручную.
set -euo pipefail

SWAPFILE="${PTO_SWAPFILE:-/swapfile}"
SWAP_SIZE_GB="${PTO_SWAP_SIZE_GB:-2}"
# Next (pto.service): потолок RAM, чтобы не съел весь хост.
PTO_MEM_MAX="${PTO_SERVICE_MEMORY_MAX:-1536M}"
# Конвейер python, если найден как systemd unit.
PIPELINE_MEM_MAX="${PTO_PIPELINE_MEMORY_MAX:-2560M}"

ensure_swap() {
  if swapon --show | grep -q .; then
    echo "[harden] swap already on"
    return
  fi
  if [[ -f "$SWAPFILE" ]]; then
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE" >/dev/null
    swapon "$SWAPFILE"
  else
    echo "[harden] creating ${SWAP_SIZE_GB}G swap at $SWAPFILE"
    fallocate -l "${SWAP_SIZE_GB}G" "$SWAPFILE" 2>/dev/null \
      || dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((SWAP_SIZE_GB * 1024)) status=none
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE" >/dev/null
    swapon "$SWAPFILE"
  fi
  if ! grep -qE "^$SWAPFILE\s" /etc/fstab 2>/dev/null; then
    echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  fi
  # Чуть меньше агрессии swappiness на 4 ГБ RAM.
  sysctl -w vm.swappiness=20 >/dev/null || true
  if ! grep -q '^vm.swappiness=' /etc/sysctl.conf 2>/dev/null; then
    echo 'vm.swappiness=20' >> /etc/sysctl.conf
  fi
  echo "[harden] swap ready: $(swapon --show --noheadings | tr -s ' ')"
}

drop_in_memory() {
  local unit="$1"
  local mem="$2"
  local dir="/etc/systemd/system/${unit}.d"
  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    echo "[harden] skip $unit (not installed)"
    return
  fi
  mkdir -p "$dir"
  cat >"$dir/memory.conf" <<EOF
[Service]
MemoryMax=$mem
OOMPolicy=stop
EOF
  systemctl daemon-reload
  echo "[harden] $unit MemoryMax=$mem"
}

ensure_swap

drop_in_memory pto.service "$PTO_MEM_MAX"

# Возможные имена юнита конвейера на проде.
for unit in pto-pipeline.service pto-backend.service pto-work.service; do
  drop_in_memory "$unit" "$PIPELINE_MEM_MAX"
done

# Если конвейер в docker compose — лимит через update (best-effort).
if command -v docker >/dev/null 2>&1; then
  for name in $(docker ps --format '{{.Names}}' 2>/dev/null || true); do
    case "$name" in
      *backend*|*pipeline*|*pto-work*|*pto_work*)
        echo "[harden] docker update --memory=$PIPELINE_MEM_MAX $name"
        docker update --memory="$PIPELINE_MEM_MAX" --memory-swap="$PIPELINE_MEM_MAX" "$name" >/dev/null \
          || echo "[harden] docker update failed for $name"
        ;;
    esac
  done
fi

echo "[harden] done. free:"; free -h
