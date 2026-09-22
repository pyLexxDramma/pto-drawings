# UI инженера — задачи

## Task 0: Общий движок вьюпорта

**Description:** Вынести pan/zoom/fit/кэш/колесо/ResizeObserver из `pdf-page.tsx` и `cad-page.tsx` в `src/hooks/use-page-viewport.ts`. Поведение не менять.

**Acceptance criteria:**
- [ ] Оба вьюера вызывают один хук
- [ ] Fit при открытии, кэш между листами, Ctrl+колесо, подсветка без автозума — как сейчас

**Verification:** tsc, lint, test:content-sync, открытие PDF и DXF локально

**Dependencies:** None

**Files:** `src/hooks/use-page-viewport.ts`, `src/components/pdf-page.tsx`, `src/components/cad-page.tsx`

**Estimated scope:** M

## Task 1: Управление масштабом

**Description:** Процент — меню fit/50/100/200/400. Двойной клик = по странице, Shift+двойной = 100%. Shift+протяжка = зум рамкой. Потолок = fit×40. Средняя кнопка и Space+drag = пан. Курсор grab только если лист больше кадра.

**Acceptance criteria:**
- [ ] Из 400% возврат одним кликом «По странице»
- [ ] Рамка вписывает участок
- [ ] Курсор обычный, когда лист целиком в кадре

**Verification:** ручной проход на localhost + highlight 8/8

**Dependencies:** Task 0

**Files:** хук, `viewer-toolbar.tsx`, pdf/cad

**Estimated scope:** M

## Task 2: Мини-карта

**Description:** Врезка справа снизу при scale > fit×1.2. CAD — упрощённый SVG, PDF — thumb. Клик/протяжка = переход. Можно скрыть (prefs).

**Acceptance criteria:**
- [ ] На 300% видно положение на листе
- [ ] Клик перескакивает в угол
- [ ] Скрытие запоминается

**Dependencies:** Task 0–1

**Files:** `src/components/viewer-minimap.tsx`, `src/lib/pdf-thumb.ts`, pdf/cad, page-strip

**Estimated scope:** M

## Task 3: Читаемость DWG

**Description:** «Крупные подписи» (min 10 px экрана), «Толщина: файл / тонкие», линейка в мм, фильтр «Скрыть текст / Только текст». Prefs.

**Acceptance criteria:**
- [ ] На вписанном виде подписи читаются
- [ ] Тонкие линии не сливаются
- [ ] Линейка согласована с bbox QA-DXF

**Dependencies:** Task 1

**Files:** `cad-page.tsx`, `cad-geometry.ts`, toolbar

**Estimated scope:** S

## Task 4: Рейка замечаний без новых вкладок

**Description:** `RemarkRail` слева от чертежа. ↑/↓ листает замечания на месте. 1/2/3 — важность, Enter — разобрано. `jumpToPage` — та же вкладка; Ctrl/средняя — новая. Баннер «не найдена» — кнопка «Показать в тексте».

**Acceptance criteria:**
- [ ] 9 замечаний QA без новых вкладок
- [ ] Ctrl+клик открывает вкладку
- [ ] Подсветка каждый раз в цель

**Dependencies:** Task 1

**Files:** `remark-rail.tsx`, `workspace.tsx`, `review-pane.tsx`, `reviews-table.tsx`, `remark-jump.ts`

**Estimated scope:** L → держать в одном срезе, но не трогать цвет/таблицы

## Task 5: Цвет и плотность

**Description:** Токены состояний в CSS. Убрать двойную голубую рамку зума, янтарную «На главную». База 12 px / 28 px. Переключатель плотности в меню пользователя.

**Acceptance criteria:**
- [ ] Один синий акцент одновременно
- [ ] Кнопки одной высоты
- [ ] «Компактно» возвращает старую плотность

**Dependencies:** Task 1 (toolbar уже общий)

**Files:** `globals.css`, `ui-chrome.tsx`, review-pane, reviews-table, project-stages, toolbar, user-menu

**Estimated scope:** M

## Task 6: Таблицы

**Description:** Сортировка №/раздел/важность/статус. Фокус строки ↑/↓/Enter. Чекбоксы + групповой разбор. Sticky группа. В расшифровке sticky первая колонка + подсветка колонки.

**Acceptance criteria:**
- [ ] Сортировка кликом по шапке
- [ ] Клавиатура размечает строки
- [ ] При скролле спецификации видно наименование

**Dependencies:** Task 4 (не конфликтовать с клавишами рейки)

**Files:** `reviews-table.tsx`, `globals.css`, `markdown-view.tsx`

**Estimated scope:** M

## Task 7: Обнаружаемость и словарь

**Description:** Подсказка 3 сессии, гаснет после первого зума. `?` = карта из `keymap.ts`. Переименовать Поток→Источник, Разбор→Статус разбора, «Не просмотрено»→чекбокс «Просмотрен», панель «Текст листа». Стрелки = пан. tabIndex на вьюпорт.

**Acceptance criteria:**
- [ ] `?` совпадает с живыми клавишами
- [ ] help.tsx больше не врёт про «низ чертежа»

**Dependencies:** Tasks 1, 4

**Files:** `keymap.ts`, review-pane, review-pane-help, viewers, reviews-table

**Estimated scope:** M

## Task 8: Миниатюры

**Description:** Кнопка «Миниатюры» открывает сетку 2 колонки (не постоянную полосу). Бейджи готово/просмотрено/замечание. Prefs.

**Acceptance criteria:**
- [ ] Лист находится глазами, не только через ▾
- [ ] Выключено по умолчанию

**Dependencies:** Task 2 (pdf-thumb)

**Files:** `review-pane.tsx`, `page-strip.tsx`

**Estimated scope:** S
