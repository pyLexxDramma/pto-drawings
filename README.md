# PTO — проверка чертежей

Черновик для стадии **П**: проект → загрузка PDF → обработка → чертёж слева, Markdown справа. Инженер проходит листы глазами, правит текст, ставит замечания прямо на чертеже; правки и замечания пишутся в журнал.

Репозиторий: https://github.com/pyLexxDramma/pto-drawings (приватный).  
Публичный URL: CloudPub (`clo ls`) — без Vercel.

## Стек

| Слой | Что |
| --- | --- |
| Приложение | [Next.js](https://nextjs.org/) 16 (App Router) + [React](https://react.dev/) 19 |
| Язык | [TypeScript](https://www.typescriptlang.org/) 5 |
| Стили | [Tailwind CSS](https://tailwindcss.com/) 4 |
| PDF | [pdf-lib](https://pdf-lib.js.org/), [unpdf](https://github.com/unjs/unpdf), [pdfjs-dist](https://mozilla.github.io/pdf.js/) |
| Текст | [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [rehype-raw](https://github.com/rehypejs/rehype-raw) + [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) |
| Хранение | `data/db.json` (индекс), `data/documents/<id>.json` (листы), `uploads/` (PDF) |
| Публикация | CloudPub → **production** на порту **8080** |

Нужны **Node.js 20+** и npm.

## Запуск локально

```bash
npm install
npm run init:env     # создаст .env.local с секретом сессии и токеном ингеста
npm run dev          # разработка: http://localhost:3000
npm run live         # пересобрать и поднять production :8080 + CloudPub
```

| | URL | Режим |
| --- | --- | --- |
| Разработка | [http://localhost:3000](http://localhost:3000) | `npm run dev` (быстрый HMR) |
| Команда / CloudPub | порт **8080** + туннель | `npm run live` → `next build` + `next start` |

- Вход: первый пользователь **admin** / **admin123** (роли `admin` | `engineer`). Пока пароль стандартный, в шапке висит предупреждение. Смена — кнопка «Пароль», аккаунты — «Пользователи».
- После правок для CloudPub: снова `npm run live` (или push в `main` → GitHub Actions).

## Переменные окружения

Файл `.env.local` (в git не входит), образец — [.env.example](.env.example).

| Переменная | Когда нужна | Что делает |
| --- | --- | --- |
| `PTO_SESSION_SECRET` | **обязательна в production** | подписывает сессионные cookie; без неё `next start` отвечает 500 на вход |
| `PTO_INGEST_TOKEN` | для сервисного ингеста | доступ внешнего пайплайна к `PUT /api/documents/<id>/pages/<n>` |
| `DATA_ROOT` | необязательно | куда складывать `data/` и `uploads/` |

В режиме `npm run dev` секрет не обязателен: используется локальный из `data/.dev-session-secret`.

## Данные и бэкап

- Индекс `data/db.json`: пользователи, проекты, шапки документов. Листы, журнал правок, замечания и прогресс просмотра — в `data/documents/<id>.json`. PDF — в `uploads/`. Всё это в git не входит.
- Запись атомарная (временный файл + `rename`), одновременный доступ двух процессов разведён lock-каталогом `data/.lock`.
- База старого формата (страницы внутри `db.json`) переносится в новую раскладку сама при первом чтении.
- Бэкап: `npm run backup` → `backups/pto-<дата>.zip` с `data/` и `uploads/`.

## Интеграция с пайплайном распознавания

Готовый лист приходит от внешнего сервиса: `PUT /api/documents/<id>/pages/<n>` с токеном из `PTO_INGEST_TOKEN`. Формат и примеры — [docs/page-contract.md](docs/page-contract.md). Экран `/reference` показывает эталонный markdown и наш результат рядом, одним и тем же рендером.

## Хостинг (Россия / Казахстан)

Рекомендация: **Timeweb Cloud VPS** (постоянный диск; регионы Москва / СПб / Алматы). App Platform и другие PaaS с эфемерным диском не подходят — пропадут PDF и база.

Пошагово: [docs/hosting.md](docs/hosting.md). Автодеплой: `.github/workflows/deploy-vps.yml` (нужны секреты `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`).

Пока VPS не заказан, локальный прод остаётся через CloudPub: `npm run live` → порт 8080.

## CloudPub + GitHub

Каталог: **`D:\PTO\pto-app`**. Push в `main` → self-hosted runner: pull, build, `next start` на 8080.

1. [CloudPub CLI](https://cloudpub.ru/docs/) → `clo login`
2. Runner: `D:\PTO\actions-runner`
3. Задача Windows «PTO CloudPub» поднимает 8080 + туннель после входа

Проверка: `clo ls`.
