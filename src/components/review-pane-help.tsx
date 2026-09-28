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
            Своя ошибка — карандаш <Btn>Отметить ошибку</Btn> справа от поиска
            над расшифровкой, затем обвести место.
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
            Колёсико — сдвиг, зум — <Kbd>Ctrl</Kbd>+колёсико. В файле —{" "}
            <Kbd>/</Kbd>.
          </li>
          <li>
            Поиск по проекту — поле в шапке, пока файл не открыт. Клик по строке
            открывает файл, лист и подсветку.
          </li>
          <li>
            Разделы справа сначала свёрнуты; открытый запоминается на этом листе.
          </li>
          <li>
            Две стрелки справа от разбора — свернуть текст: чертёж на всю
            ширину. <Kbd>Esc</Kbd> возвращает текст. <Kbd>F</Kbd> — то же.
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
            Клик по пину или строке «Этот лист» — рамка на чертеже и жёлтая
            цитата в тексте.
          </li>
          <li>
            <Btn>та же на</Btn> <Btn>л.1</Btn> <Btn>л.2</Btn> — листы, где эта
            фраза ещё раз. Это не номера замечаний.
          </li>
          <li>
            Стрелки у «Этот лист» листают замечания листа. В разборе ИИ их нет.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Разбор ИИ</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <Btn>Разбор ИИ · N</Btn> — неразобранные находки. Открывается с
            первой, клик по строке на ней остаётся.
          </li>
          <li>
            Треугольник — предыдущая находка, стрелка — следующая.{" "}
            <Kbd>Esc</Kbd> закрывает разбор.
          </li>
          <li>
            <Btn>Принять</Btn> / <Btn>Ложное</Btn> (с причиной) → сразу
            следующая. <Btn>В таблице</Btn> — открыть строку и выйти.{" "}
            <Kbd>Enter</Kbd> — принять.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-semibold text-text">Таблица</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Фильтры в шапке колонок — как в Excel.</li>
          <li>
            «Где в ПД» — прыжок на лист и цитату. Срез: этот файл / весь проект.
          </li>
          <li>
            <Btn>Неверно</Btn> — без причины не сохранится. Excel — только
            разобранные с важностью.
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
