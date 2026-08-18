# PTO — проверка чертежей

Черновик: загрузка PDF, чертёж слева, Markdown справа.

## Ссылки

- Репозиторий: https://github.com/pyLexxDramma/pto-drawings
- Команде: ссылка CloudPub после публикации (`clo ls`)

Репозиторий приватный: Settings → Collaborators → пригласите ребят.

## Локально

```bash
npm install
npm run dev
```

Тестовые чертежи: `samples/`.

## CloudPub + GitHub

Сайт крутится на этом ПК, CloudPub даёт публичный URL. Push в `main` запускает GitHub Actions на self-hosted runner и пересобирает приложение.

Один раз:

1. Установите [CloudPub CLI](https://cloudpub.ru/docs/)
2. `clo login ваш@email`
3. Self-hosted runner уже в `D:\PTO\actions-runner` (`run.cmd`)
4. `powershell -File scripts/deploy-cloudpub.ps1`

Порт продакшена: **8080**.
