"use client";

import { KEYMAP, KEYMAP_GROUPS } from "@/lib/keymap";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 py-0.5 font-mono text-[10px] text-text">
      {children}
    </kbd>
  );
}

/** Инструкция в меню Админ / Инженер — как пользоваться, без внутренней кухни. */
export function ControlsHelpContent() {
  return (
    <div className="space-y-3 text-[11px] leading-relaxed text-muted">
      <section>
        <div className="mb-1 font-medium text-text">Загрузка и обработка</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            В проект — PDF и чертёж (DWG/DXF) или один ZIP из них. Больше 20 МБ
            сайт не возьмёт: сервер не тянет.
          </li>
          <li>
            «Стоп» сразу снимает задание. Текущий лист конвейер может досчитать.
          </li>
          <li>
            Если обработка упала — причина на плашке и «Запустить заново».
            Красная полоса «сервер не отвечает» — перезагрузить VPS, потом
            повтор.
          </li>
        </ul>
      </section>
      <section>
        <div className="mb-1 font-medium text-text">Чертёж</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            «Отметить ошибку» — обвести место. Появится строка в таблице.
            Важность будет «Не задана» — поставьте сами. Отмена: ещё раз кнопка
            или <Kbd>Esc</Kbd>.
          </li>
          <li>
            Клик по замечанию приближает место на листе. Дальше зум —{" "}
            <Kbd>+</Kbd> / <Kbd>−</Kbd> или <Kbd>Ctrl</Kbd> + колёсико (Mac{" "}
            <Kbd>⌘</Kbd>). Колёсико без Ctrl только сдвигает.
          </li>
          <li>
            Рамка зума: <Kbd>Shift</Kbd> + протяжка. Удалили пометку с листа —
            строка уйдёт из таблицы, и наоборот. Рамку можно тянуть за край
            листа: она прижмётся к краю и не сбросится, пока не отпустите
            кнопку.
          </li>
          <li>
            На миниатюрах листов — счётчик замечаний; цвет по разбору (серый —
            не разобрано, зелёный — верно, красный — неверно). Важность у
            замечаний листа бывает разная, поэтому одной точки важности нет.
          </li>
          <li>
            Справа всегда текст текущего листа. Широкую таблицу сдвигайте
            вправо — все колонки едут вместе. «‹» / «›» сворачивают панели.
          </li>
        </ul>
      </section>
      <section>
        <div className="mb-1 font-medium text-text">Таблица замечаний</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Фильтры в шапке — как в Excel. Стрелка на колонке — только фильтр,
            статусы она не меняет. «Сбросить разбор» вернёт всем «Не разобрано».
          </li>
          <li>
            «Мои замечания из Excel» — занести свой список в эту таблицу (не
            сравнение с ИИ). Нужна колонка «Замечание» или текст в первом
            столбце. Строки появятся с меткой «Инженер». Дубли по тексту
            пропускаются. «Где в ПД» пустое, пока нет листа и цитаты.
          </li>
          <li>
            «Скачать таблицу Excel» — готовый файл того, что видно и разобрано.
            Без важности и разбора у всех строк не скачается. Серая кнопка
            «ещё N» — прыжок к строке без разбора, не выгрузка.
          </li>
          <li>
            Клик по «Где в ПД» открывает лист здесь. Жёлтая «На предыдущую
            страницу» — только шаг назад: лист → таблица → чертёж → файлы
            проекта. Проект не закрывает. Esc на листе — то же. Синяя
            «К проектам» — сразу главная со всеми проектами, это не «назад».
            Если одно расхождение в нескольких местах — все строки видны
            (1/3, 2/3). На листе «Место N из M» листает их; те же места —
            номерами-кнопками в строке блока «Замечаний по листу». Зелёная
            рамка — текущее место, синие — остальные на этой странице,
            оранжевая внутри зелёной — спорное значение из цитаты. Легенда
            цветов видна на листе рядом с «найдено: N». В расшифровке жёлтым
            сначала все места листа, а после клика по замечанию — только его
            цитата. Блок «Замечаний по листу» свёрнут: нажмите строку, чтобы
            раскрыть список. Разбор строки
            относится ко всем её местам. Плашка «Цитата не найдена на
            чертеже» только если поиск по листу ничего не дал; при
            «найдено: N» её нет. Поиск по листу (<Kbd>/</Kbd> или{" "}
            <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd>) сам подводит к совпадению; стрелки
            у «найдено: N» листают совпадения, текущее обведено жирнее.{" "}
            <Kbd>Ctrl</Kbd>+клик (Mac <Kbd>⌘</Kbd>) или средняя кнопка — новая
            вкладка.
          </li>
          <li>
            «Неверно» — только если ИИ придумал лишнее. Без причины не
            сохранится.
          </li>
        </ul>
      </section>
      <section>
        <div className="mb-1 font-medium text-text">Окна</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Справа вверху «Админ» или «Инженер» — пользователи, журналы, пароль,
            эта инструкция, выход. «Обновления прода» — ветки и правки в main,
            без списка каждого запуска. «На весь экран» только на чертеже, в
            этом меню её нет.
          </li>
          <li>
            Шапка есть на каждой странице. Синяя «К проектам» (шапка и таблица)
            — сразу все проекты слева, не шаг назад. Жёлтая «На предыдущую
            страницу» — только предыдущий экран, проект остаётся. Из поиска
            сначала закрывает поиск. Проект создаётся загрузкой чертежа или
            формой слева, если проектов ещё нет. После входа список уже слева;
            на заставке только «Загрузить для
            расшифровки». Этапы «Расшифровка» / «Таблица замечаний» — в той
            же строке.
          </li>
        </ul>
      </section>
      {KEYMAP_GROUPS.map((group) => (
        <section key={group.id}>
          <div className="mb-1 font-medium text-text">{group.label}</div>
          <ul className="list-disc space-y-1 pl-4">
            {KEYMAP.filter((item) => item.group === group.id).map((item) => (
              <li key={item.keys}>
                <Kbd>{item.keys}</Kbd>
                {" — "}
                {item.action}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <div className="mb-1 font-medium text-text">macOS</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Вместо <Kbd>Ctrl</Kbd> — <Kbd>⌘</Kbd>: зум, поиск, «Где в ПД» в
            новой вкладке.
          </li>
          <li>
            <Kbd>Control</Kbd>+клик — меню, не вкладка. Листы: <Kbd>J</Kbd> /{" "}
            <Kbd>K</Kbd> или <Kbd>Fn</Kbd>+стрелки.
          </li>
        </ul>
      </section>
    </div>
  );
}

export function ControlsHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Инструкция"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-text">Инструкция</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
          >
            Закрыть
          </button>
        </div>
        <ControlsHelpContent />
      </div>
    </div>
  );
}
