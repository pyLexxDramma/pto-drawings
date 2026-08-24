# PTO — проверка чертежей

Черновик для стадии **П**: проект → загрузка PDF → обработка → чертёж слева, Markdown справа. Инженер проходит листы глазами, правит текст, ставит замечания прямо на чертеже; правки и замечания пишутся в журнал.

Репозиторий: https://github.com/pyLexxDramma/pto-drawings (приватный).  
Прод для команды: https://201.24.50.177 (Timeweb VPS, self-signed SSL — один раз принять предупреждение в браузере, иначе микрофон не работает).

## Стек

| Слой | Что |
| --- | --- |
| Приложение | [Next.js](https://nextjs.org/) 16 (App Router) + [React](https://react.dev/) 19 |
| Язык | [TypeScript](https://www.typescriptlang.org/) 5 |
| Стили | [Tailwind CSS](https://tailwindcss.com/) 4 |
| PDF | [pdf-lib](https://pdf-lib.js.org/), [unpdf](https://github.com/unjs/unpdf), [pdfjs-dist](https://mozilla.github.io/pdf.js/) |
| Текст | [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [rehype-raw](https://github.com/rehypejs/rehype-raw) + [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) |
| Хранение | `data/db.json` (индекс), `data/documents/<id>.json` (листы), `uploads/` (PDF) |
| Публикация | Timeweb Cloud VPS + GitHub Actions |

Нужны **Node.js 20+** и npm.

## Запуск локально

```bash
npm install
npm run init:env     # создаст .env.local с секретом сессии и токеном ингеста
npm run dev          # разработка: http://localhost:3000
npm run live         # необязательно: локальный production на :8080
```

| | URL | Режим |
| --- | --- | --- |
| Разработка | [http://localhost:3000](http://localhost:3000) | `npm run dev` |
| Локальный prod | [http://localhost:8080](http://localhost:8080) | `npm run live` (только у тебя на ПК) |
| Команда | [https://201.24.50.177](https://201.24.50.177) | VPS, self-signed HTTPS |

- Вход: аккаунт, который создал админ. Смена пароля — кнопка «Пароль».
- Данные на ПК (`data/`, `uploads/`) и на VPS — **разные**. Локальные правки в файлах не попадут на прод сами.

## Как работает деплой с GitHub

1. Правишь код локально в `D:\PTO\pto-app`.
2. Коммит + `git push origin main`.
3. GitHub Actions запускает workflow **Deploy VPS** (`.github/workflows/deploy-vps.yml`).
4. По SSH заходит на сервер (`VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` в Secrets) и выполняет `scripts/deploy-remote.sh`:
   - `git pull` в `/var/www/pto`
   - `npm ci` + `npm run build`
   - `systemctl restart pto`
5. Сайт на http://201.24.50.177 обновляется. Папка `data/` и `uploads/` на сервере **не трогаются**.

Ручной запуск: Actions → Deploy VPS → Run workflow.

## Переменные окружения

Файл `.env.local` (в git не входит), образец — [.env.example](.env.example).

| Переменная | Когда нужна | Что делает |
| --- | --- | --- |
| `PTO_SESSION_SECRET` | **обязательна в production** | подписывает сессионные cookie |
| `PTO_INGEST_TOKEN` | для сервисного ингеста | доступ пайплайна к `PUT /api/documents/<id>/pages/<n>` |
| `PTO_COOKIE_SECURE` | после HTTPS | `1` — cookie только по HTTPS |
| `DATA_ROOT` | необязательно | куда складывать `data/` и `uploads/` |

## Данные и бэкап

- Индекс `data/db.json`, листы в `data/documents/<id>.json`, PDF в `uploads/`.
- Бэкап: `npm run backup` → `backups/pto-<дата>.zip`.

## Интеграция с пайплайном

`docs/page-contract.md`, экран `/reference`.

## Хостинг

Подробности: [docs/hosting.md](docs/hosting.md).
