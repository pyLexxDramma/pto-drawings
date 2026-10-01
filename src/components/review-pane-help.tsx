"use client";

import type { ReactNode } from "react";
import { KEYMAP } from "@/lib/keymap";

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

/** Инструкция в меню Админ / Инженер — коротко, по делу. */
export function ControlsHelpContent() {
  return (
    <div className="space-y-3 pto-t-md leading-snug text-muted">
      <section>
        <div className="mb-1 font-semibold text-text">Порядок</div>
        <ol className="list-decimal space-y-0.5 pl-4">
          <Step>Загрузить PDF / DWG / ZIP (до 20 МБ).</Step>
          <Step>Открыть лист: слева чертёж, справа расшифровка.</Step>
          <Step>
            Своя ошибка — <Btn>Добавить ошибку</Btn> в списке пометок или{" "}
            <Btn>Ошибка</Btn> справа от <Btn>Найти</Btn>, затем обвести место
            левой кнопкой. Правая двигает лист. Рамка остаётся, пока не
            сохраните или не отмените. Ещё одну — снова{" "}
            <Btn>Добавить ошибку</Btn>.
          </Step>
          <Step>
            В таблице — статусы и <Btn>Скачать Excel</Btn>.
          </Step>
        </ol>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Лист</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Правая кнопка двигает лист, в том числе пока обводите ошибку.
            Колёсико — сдвиг, зум — <Kbd>Ctrl</Kbd>+колёсико. В файле —{" "}
            <Kbd>/</Kbd>.
          </li>
          <li>
            Поиск по расшифровкам проекта — поле в шапке, пока файл не открыт.
            <Btn>Найти</Btn> на листе — только по этому файлу. В таблице — «По
            замечаниям»: формулировка, комментарий, автор и цитата, не текст
            листа. Дефис и пробел для них одно и то же. Клик по строке шапки
            открывает файл, лист и подсветку.
          </li>
          <li>
            <Btn>Назад</Btn> слева от <Btn>Найти</Btn>. Из списка файлов
            возвращает к списку, из «Где в ПД» — к таблице. Обновление страницы
            оставляет тот же лист.
          </li>
          <li>
            У листа справа статус проверки: «проверен», а если замечания есть —
            «1 замечание», «2 замечания». Ещё «не проверен» или «ошибка».
            Причина ошибки — подсказка при наведении.
          </li>
          <li>
            Разделы справа сначала свёрнуты; шифр, стадия и лист штампа видны
            сразу, если номер листа в штампе совпадает с текстом листа. Строки
            «нашли N из N чисел» на листе нет. Готовый лист без проверки —
            зелёная точка, не слова «текст готов».
          </li>
          <li>
            Две стрелки справа от разбора — свернуть текст: чертёж на всю
            ширину. На листе кнопка «К расшифровке» или <Kbd>Esc</Kbd>{" "}
            возвращает текст и замечания. <Kbd>F</Kbd> — то же.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Замечания на чертеже</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Пин = номер. Цвет = важность (
            <Box className="bg-rose-500/25 outline-rose-500" />
            выс.{" "}
            <Box className="bg-amber-500/25 outline-amber-600" />
            сред.{" "}
            <Box className="bg-sky-500/20 outline-sky-600" />
            низ.).
          </li>
          <li>
            Клик по пину на развёрнутом чертеже возвращает расшифровку и эту
            ошибку. Клик по пину или строке «Лист N · ошибок» — рамка на
            чертеже и жёлтый текст замечания.
          </li>
          <li>
            <Btn>л.1</Btn> — лист этой фразы, даже если он один.{" "}
            <Btn>та же на</Btn> <Btn>л.1</Btn> <Btn>л.2</Btn> — другие листы.
            Это не номера замечаний. Стрелка вправо открывает место на текущем
            листе, затем остальные по номеру штампа. Одна находка на нескольких
            листах — одна строка в таблице и в разборе. На каждом таком листе
            слева число замечаний. Близкие пины не накрывают друг друга.
          </li>
          <li>
            Стрелки у «Лист N · ошибок» листают замечания листа. В разборе ИИ
            их нет. Полоса «Листы» по умолчанию как в файле; «По штампу»
            сортирует по номеру из штампа.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Разбор ИИ</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <Btn>Разбор ИИ · N</Btn> — неразобранные находки. Кнопки нет, если
            находок нет или все уже разобраны. Открывается с первой, клик по
            строке на ней остаётся. Строка разбора в одну линию.
          </li>
          <li>
            Одинаковые стрелки — предыдущая и следующая находка.{" "}
            <Kbd>Esc</Kbd> закрывает разбор. <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd>{" "}
            отменяет последнее добавление или удаление своей пометки. Значок
            изогнутой стрелки рядом с <Btn>Найти</Btn> делает то же.
          </li>
          <li>
            <Btn>Принять</Btn> и <Btn>Отклонить</Btn> только здесь, не на
            строке листа: там остаётся текст. В очереди они сразу открывают
            следующую. В таблице статус меняется в колонке. <Btn>В таблице</Btn>{" "}
            — открыть строку и выйти. <Kbd>Enter</Kbd> — принять.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Таблица</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Фильтры в шапке колонок — как в Excel.</li>
          <li>
            «разобрано N из M», «не разобрано» и «N от инженера» в шапке —
            кнопки. Первые две оставляют только эти строки. «От инженера»
            открывает замечание на чертеже. Повторный клик снимает срез.
          </li>
          <li>
            «Где в ПД» — прыжок на лист и цитату. Срез — наведите на проект в
            списке: справа его файлы. Клик по проекту берёт все файлы, клик по
            файлу — только его. Имя файла рядом с проектом — подпись, не кнопка.
          </li>
          <li>
            <Btn>Неверно</Btn> — без причины не сохранится. В Excel колонка
            «Разбор»: разобрано или не разобрано. «Неверно» и «Не нужно» в файл
            не попадают.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Листы слева</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            <Dot className="bg-emerald-500" />
            готов
          </span>
          <span>
            <Dot className="bg-accent" />
            сейчас
          </span>
          <span>
            <Dot className="bg-slate-400" />
            в очереди
          </span>
          <span>
            <Dot className="border-2 border-amber-500 bg-amber-100" />
            не открывали
          </span>
        </div>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Если сбой</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Ошибка на карточке файла → <Btn>Запустить заново</Btn>. Сбои
            расшифровки — Админ → <Btn>Журналы правок</Btn> →{" "}
            <Btn>Ошибки обработки</Btn>.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Клавиши</div>
        <ul className="space-y-0.5">
          {KEYMAP.map((item) => (
            <li key={item.keys} className="flex gap-2">
              <Kbd>{item.keys}</Kbd>
              <span>{item.action}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5">
          На macOS вместо <Kbd>Ctrl</Kbd> — <Kbd>⌘</Kbd>.
        </p>
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
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-white p-4 shadow-xl"
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
