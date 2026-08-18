# PTO — проверка чертежей

Черновик: загрузка PDF, чертёж слева, Markdown справа.

## Ссылки

- Репозиторий: https://github.com/pyLexxDramma/pto-drawings
- Подключить автодеплой (один раз): [Import в Vercel](https://vercel.com/new/import?s=https://github.com/pyLexxDramma/pto-drawings)

Откройте [https://pto-drawings.vercel.app](https://pto-drawings.vercel.app)

Чтобы загрузка PDF работала на Vercel: проект → **Storage** → **Create Database** → **Blob**. Токен подхватится сам, следующий деплой начнёт сохранять файлы.

На Hobby файл не больше 4 МБ.

Репозиторий приватный: Settings → Collaborators → пригласите ребят.

## Локально

```bash
npm install
npm run dev
```

Тестовые чертежи: `samples/`.
