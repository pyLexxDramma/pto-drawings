# PTO — проверка чертежей

Черновик: загрузка PDF, чертёж слева, Markdown справа.

## Ссылки

- Репозиторий: https://github.com/pyLexxDramma/pto-drawings
- Старый стенд (Vercel, лимит 4 МБ): https://pto-drawings.vercel.app

Репозиторий приватный: Settings → Collaborators → пригласите ребят.

## Локально

```bash
npm install
npm run dev
```

Тестовые чертежи: `samples/`.

## Cloud.ru

Хостинг: **Evolution → Container Apps**. PDF пишутся на диск, лимита 4 МБ нет.

1. Заведите аккаунт на [cloud.ru](https://cloud.ru) и откройте **Evolution**.
2. **Artifact Registry** → создайте реестр, скопируйте URI вида `имя.cr.cloud.ru`.
3. Создайте персональный ключ (Key ID / Key Secret).
4. **Object Storage** → бакет для PDF (в том же проекте).
5. В GitHub: **Settings → Secrets and variables → Actions**
   - Secrets: `EVO_CR_LOGIN` (Key ID), `EVO_CR_PWD` (Key Secret)
   - Variables: `CR_URI` = `имя.cr.cloud.ru`
6. Push в `main` соберёт образ `pto-drawings:latest`.
7. В реестре у образа **Создать Container App**:
   - порт **8080**
   - публичный адрес
   - минимум экземпляров **1** (не 0 — иначе обработка PDF оборвётся)
   - авторазвёртывание
   - том: бакет Object Storage → путь `/data`, запись включена
8. Ссылку `https://….containerapps.ru` скиньте команде.
