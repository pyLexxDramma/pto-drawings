"use client";

import type { ReactNode } from "react";
import { KEYMAP, KEYMAP_GROUPS } from "@/lib/keymap";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 py-0.5 font-mono pto-t-sm text-text">
      {children}
    </kbd>
  );
}

/** Название кнопки ровно как на экране — чтобы находить глазом, а не вчитываться. */
function Btn({ children }: { children: string }) {
  return (
    <span className="whitespace-nowrap rounded border border-slate-300 bg-slate-100 px-1 font-semibold text-text">
      {children}
    </span>
  );
}

/** Цвет показываем цветом, а не словом «зелёная». */
function Box({ className }: { className: string }) {
  return (
    <span
      className={`mr-1 inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] align-[-1px] outline outline-1 ${className}`}
    />
  );
}

function Dot({ className }: { className: string }) {
  return (
    <span
      className={`mr-1 inline-block h-2 w-2 shrink-0 rounded-full align-[-1px] ${className}`}
    />
  );
}

function Step({ children }: { children: ReactNode }) {
  return <li className="marker:font-semibold marker:text-accent">{children}</li>;
}

/** Инструкция в меню Админ / Инженер — как пользоваться, без внутренней кухни. */
export function ControlsHelpContent() {
  return (
    <div className="space-y-3.5 pto-t-md leading-relaxed text-muted">
      <section>
        <div className="mb-1 font-semibold text-text">Порядок работы</div>
        <ol className="list-decimal space-y-1 pl-4">
          <Step>
            Загрузить PDF и чертёж (DWG/DXF) или один ZIP из них. До 20 МБ.
          </Step>
          <Step>
            Открыть лист: слева чертёж, справа его расшифровка.
          </Step>
          <Step>
            Нашли ошибку — <Btn>Отметить ошибку</Btn> и обвести место. Строка
            сразу появится в таблице, важность поставьте сами.
          </Step>
          <Step>
            В таблице поставить каждому замечанию статус и выгрузить Excel.
          </Step>
        </ol>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Работа с листом</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Клик по замечанию приближает его место. Удалили рамку — строка уйдёт
            из таблицы, и наоборот.
          </li>
          <li>
            Поиск по листу — <Kbd>/</Kbd>; стрелки у «найдено: N» листают
            совпадения, текущее обведено жирнее.
          </li>
          <li>
            Колёсико сдвигает лист, зум — только с <Kbd>Ctrl</Kbd>. Остальные
            клавиши — в конце инструкции.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Что значат цвета</div>
        <ul className="space-y-1">
          <li>
            <Box className="bg-emerald-400/60 outline-emerald-300" />
            рамка — где замечание
          </li>
          <li>
            <Box className="bg-orange-400/60 outline-orange-300" />
            внутри неё — само расходящееся значение
          </li>
          <li>
            <Box className="bg-sky-400/60 outline-sky-300" />
            то же замечание в другом месте листа
          </li>
        </ul>
        <div className="mt-1.5">Кружки у листов в левом списке:</div>
        <ul className="mt-1 space-y-1">
          <li>
            <Dot className="bg-emerald-500" />
            текст готов
          </li>
          <li>
            <Dot className="bg-sky-500" />
            обрабатывается сейчас
          </li>
          <li>
            <Dot className="bg-slate-400" />
            ещё в очереди
          </li>
          <li>
            <Dot className="border-2 border-amber-500 bg-amber-100" />
            готов, но вы его не открывали
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Таблица замечаний</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Фильтры в шапке — как в Excel: стрелка на колонке фильтрует, статусы
            не меняет.
          </li>
          <li>
            <Btn>Мои замечания из Excel</Btn> — занести свой список. Нужна
            колонка «Замечание»; дубли по тексту пропускаются.
          </li>
          <li>
            <Btn>Скачать таблицу Excel</Btn> — только то, что видно и разобрано.
            Серая{" "}
            <Btn>ещё N</Btn> рядом — прыжок к неразобранной строке.
          </li>
          <li>
            <Btn>Неверно</Btn> — если ИИ придумал лишнее. Без причины не
            сохранится.
          </li>
          <li>
            Клик по «Где в ПД» открывает лист. Одно расхождение в нескольких
            местах — строки 1/3, 2/3; на листе их листает «Место N из M».
          </li>
          <li>
            Окошко <Btn>Разобрано N из M</Btn> открывает вкладку со всеми
            разобранными: фильтр по статусу и своя выгрузка.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Переходы</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <Btn>← На предыдущую страницу</Btn> в шапке листа — предыдущий лист.
            Второй кнопки «Назад» над расшифровкой нет.
          </li>
          <li>
            Синяя <Btn>К проектам</Btn> — сразу главная. Это не «назад».
          </li>
          <li>
            Полоса <Btn>Расшифровка</Btn> · <Btn>Таблица замечаний</Btn> в шапке
            — не индикатор, а переход к работе.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Если что-то не так</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Обработка упала — причина на карточке файла, там же{" "}
            <Btn>Запустить заново</Btn>.
          </li>
          <li>
            Красная полоса «сервер не отвечает» — перезагрузить VPS и повторить.
          </li>
          <li>
            Модель ошиблась или читала картинку вместо текста — Админ →{" "}
            <Btn>Журналы правок</Btn> → <Btn>Агент ИИ (ошибки)</Btn>. Число на
            вкладке — сколько нашлось по листу.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Горячие клавиши</div>
        <div className="space-y-2">
          {KEYMAP_GROUPS.map((group) => (
            <div key={group.id}>
              <div className="font-medium text-text">{group.label}</div>
              <ul className="space-y-1">
                {KEYMAP.filter((item) => item.group === group.id).map((item) => (
                  <li key={item.keys}>
                    <Kbd>{item.keys}</Kbd>
                    {" — "}
                    {item.action}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">macOS</div>
        <div>
          Везде вместо <Kbd>Ctrl</Kbd> — <Kbd>⌘</Kbd>. <Kbd>Control</Kbd>+клик
          открывает меню, а не новую вкладку.
        </div>
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
