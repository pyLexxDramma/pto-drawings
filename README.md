# PTO — проверка чертежей

Черновик для стадии **П**: проект → загрузка PDF → обработка → чертёж слева, Markdown справа. Инженер проходит листы глазами, правит текст, правки пишутся в лог.

Репозиторий: https://github.com/pyLexxDramma/pto-drawings (приватный).  
Команде: публичный URL CloudPub (`clo ls`) — только CloudPub, без Vercel.

## Стек

| Слой | Что |
| --- | --- |
| Приложение | [Next.js](https://nextjs.org/) 16 (App Router) + [React](https://react.dev/) 19 |
| Язык | [TypeScript](https://www.typescriptlang.org/) 5 |
| Стили | [Tailwind CSS](https://tailwindcss.com/) 4 |
| PDF | [pdf-lib](https://pdf-lib.js.org/) (страницы), [unpdf](https://github.com/unjs/unpdf) (текст), [pdfjs-dist](https://mozilla.github.io/pdf.js/) (превью) |
| Текст | [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) (таблицы) |
| Хранение | локальные папки `data/` и `uploads/` |
| Публикация | CloudPub → этот ПК, порт **8080** |

Нужны **Node.js 20+** и npm.

## Запуск (local = CloudPub)

Один процесс: правки в коде сразу видны на [http://localhost:8080](http://localhost:8080) и на CloudPub.

```bash
npm install
npm run live
```

или `npm run dev` (тот же порт 8080).

- PDF: `uploads/`, состояние: `data/db.json` (в git не входят).
- Тестовые чертежи: `samples/`.

Остановка: `Ctrl+C` / убить процесс на 8080.

## CloudPub + GitHub

Каталог разработки и прод: **`D:\PTO\pto-app`**. Push в `main` на self-hosted runner только подтягивает репозиторий и перезапускает live-сервер (Vercel отключён).

Один раз:

1. [CloudPub CLI](https://cloudpub.ru/docs/) → `clo login`
2. Self-hosted runner: `D:\PTO\actions-runner` (`run.cmd`)
3. После входа в Windows задача «PTO CloudPub» поднимает 8080 + туннель

Проверка туннеля: `clo ls`.
