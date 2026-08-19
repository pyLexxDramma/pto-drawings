# PTO — проверка чертежей

Черновик для стадии **П**: проект → загрузка PDF → обработка → чертёж слева, Markdown справа. Инженер проходит листы глазами, правит текст, правки пишутся в лог.

Репозиторий: https://github.com/pyLexxDramma/pto-drawings (приватный).  
Команде: ссылка CloudPub после публикации (`clo ls`).

## Стек

| Слой | Что |
| --- | --- |
| Приложение | [Next.js](https://nextjs.org/) 16 (App Router) + [React](https://react.dev/) 19 |
| Язык | [TypeScript](https://www.typescriptlang.org/) 5 |
| Стили | [Tailwind CSS](https://tailwindcss.com/) 4 |
| PDF | [pdf-lib](https://pdf-lib.js.org/) (страницы), [unpdf](https://github.com/unjs/unpdf) (текст), [pdfjs-dist](https://mozilla.github.io/pdf.js/) (превью) |
| Текст | [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) (таблицы) |
| Хранение | локальные папки `data/` и `uploads/` (на Vercel — Blob) |

Нужны **Node.js 20+** и npm.

## Запуск у себя

В корне репозитория (это каталог `pto-app` на машине разработки):

```bash
npm install
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

- PDF кладутся в `uploads/`, состояние — в `data/db.json`. Эти папки в git не входят.
- Тестовые чертежи, если есть: `samples/`.
- Прод-сборка на этом ПК слушает порт **8080** (`npm run build`, затем `npm start`). Для разработки используйте `npm run dev`, не 8080.

Остановка: `Ctrl+C` в терминале.

## CloudPub + GitHub

Сайт крутится на этом ПК, CloudPub даёт публичный URL. Push в `main` запускает GitHub Actions на self-hosted runner и пересобирает приложение.

Один раз:

1. Установите [CloudPub CLI](https://cloudpub.ru/docs/)
2. `clo login ваш@email`
3. Self-hosted runner в `D:\PTO\actions-runner` (`run.cmd`)
4. Прод-копия: `D:\PTO\pto-prod` (не путать с `pto-app`, где идёт разработка)

После перезагрузки Windows при входе в учётку сами стартуют порт 8080 и CloudPub (задача «PTO CloudPub»).
