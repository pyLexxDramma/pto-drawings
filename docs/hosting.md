# Хостинг PTO (Россия / Казахстан)

## Выбор

Приложение хранит PDF и JSON на диске (`data/`, `uploads/`). Поэтому **нельзя**
ставить его на PaaS с эфемерным контейнером (Timeweb App Platform, Render free,
Railway free): после каждого деплоя файлы пропадут.

| Вариант | Постоянный диск | Регион | Автодеплой | Вердикт |
| --- | --- | --- | --- | --- |
| **Timeweb Cloud VPS** | да | Москва, СПб, Новосибирск, **Алматы** | GitHub Actions по SSH | **рекомендуем** |
| Beget VPS | да | Россия | GitHub Actions по SSH | запасной |
| Selectel VPS | да | Россия | GitHub Actions по SSH | запасной |
| Timeweb App Platform | нет (нужен S3) | РФ | из коробки | не подходит без переписывания хранения |

**Рекомендация:** Timeweb Cloud VPS, тариф от ~900–1080 ₽/мес (2 vCPU, 2–4 ГБ
RAM, 30–40 ГБ NVMe). Регион: Москва — если команда в РФ; Алматы — если основная
аудитория в Казахстане.

## Что уже лежит в репозитории

- `scripts/setup-vps.sh` — первичная настройка сервера (Node 20, nginx, systemd, SSL).
- `scripts/deploy-remote.sh` — обновление кода на сервере (pull → build → restart).
- `.github/workflows/deploy-vps.yml` — автодеплой при push в `main`.

## Один раз руками

1. Закажите VPS в [Timeweb Cloud](https://timeweb.cloud/services/vps-linux), Ubuntu 22.04 или 24.04.
2. Привяжите домен (латиница `.ru` / `.kz`) к IP сервера A-записью.
3. С локальной машины:

```bash
scp scripts/setup-vps.sh root@ВАШ_IP:/root/
ssh root@ВАШ_IP 'bash /root/setup-vps.sh ВАШ_ДОМЕН'
```

Скрипт спросит / примет переменные окружения и поднимет приложение как
`systemd`-сервис `pto` за nginx с Let's Encrypt.

4. В GitHub → Settings → Secrets and variables → Actions добавьте:

| Secret | Значение |
| --- | --- |
| `VPS_HOST` | IP или домен сервера |
| `VPS_USER` | обычно `root` |
| `VPS_SSH_KEY` | приватный SSH-ключ без пароля (целиком, включая `BEGIN`/`END`) |
| `VPS_APP_DIR` | необязательно, по умолчанию `/var/www/pto` |

5. Следующий push в `main` сам задеплоит. Ручной запуск: Actions → Deploy VPS → Run workflow.

Пока секреты не заданы, workflow пропускает деплой (не падает).

CloudPub и автозапуск на Windows больше не используются: прод только на этом VPS.

## Переменные на сервере

Файл `/var/www/pto/.env.local` (создаёт `setup-vps.sh`):

```
PTO_SESSION_SECRET=...
PTO_INGEST_TOKEN=...
NODE_ENV=production
PORT=8080
```

## Бэкап

На сервере по cron или вручную из каталога приложения:

```bash
npm run backup
```

Архивы появятся в `backups/`.
