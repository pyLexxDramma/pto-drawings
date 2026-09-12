"use client";

import { KEYMAP, KEYMAP_GROUPS } from "@/lib/keymap";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 py-0.5 font-mono text-[10px] text-text">
      {children}
    </kbd>
  );
}

/** Инструкция = текущий интерфейс + та же карта, что и «?». */
export function ControlsHelpContent() {
  return (
    <div className="space-y-3 text-[11px] leading-relaxed text-muted">
      <section>
        <div className="mb-1 font-medium text-text">Окна и панели</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Справа вверху «Админ» (или «Инженер») и имя — меню профиля:
            пользователи, журналы, пароль, эта инструкция, выход.
          </li>
          <li>
            Кнопка <Kbd>‹</Kbd> / <Kbd>›</Kbd> на панели сворачивает её в узкую
            полоску. Повторный клик по полоске разворачивает. Так работают
            список файлов, замечания, миниатюры листов и текст справа.
          </li>
          <li>
            «Новый проект» и этапы «Расшифровка» / «Таблица замечаний» — в
            верхней строке.
          </li>
          <li>
            Справа всегда расшифровка текущего листа. Отдельной вкладки «Текст
            листа» нет.
          </li>
          <li>
            «Отметить ошибку» — обвести место на чертеже. Если передумали:
            ещё раз нажать кнопку (станет «Отменить») или <Kbd>Esc</Kbd>.
          </li>
        </ul>
      </section>
      <section>
        <div className="mb-1 font-medium text-text">Масштаб PDF и DWG</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Колёсико на PDF и на DWG только сдвигает лист, не приближает.
          </li>
          <li>
            Зум — <Kbd>Ctrl</Kbd> + колёсико (на Mac <Kbd>⌘</Kbd> + колёсико),
            кнопки <Kbd>+</Kbd> / <Kbd>−</Kbd> или меню процентов над чертежом.
            Рамка: <Kbd>Shift</Kbd> + протяжка.
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
            Где на Windows <Kbd>Ctrl</Kbd>, на Mac — <Kbd>⌘</Kbd>: зум колёсиком,
            поиск <Kbd>⌘F</Kbd>, «где в ПД» в новой вкладке — <Kbd>⌘</Kbd>+клик.
          </li>
          <li>
            <Kbd>Control</Kbd>+клик на Mac — это контекстное меню, не новая
            вкладка.
          </li>
          <li>
            Средней кнопки на трекпаде нет: сдвиг листа — колёсико / два пальца
            или <Kbd>Пробел</Kbd> + тянуть.
          </li>
          <li>
            <Kbd>PageDown</Kbd> / <Kbd>PageUp</Kbd> на клавиатуре ноутбука —
            <Kbd>Fn</Kbd>+<Kbd>↓</Kbd> / <Kbd>Fn</Kbd>+<Kbd>↑</Kbd>. Листы также
            листаются <Kbd>J</Kbd> / <Kbd>K</Kbd>.
          </li>
        </ul>
      </section>
      <section>
        <div className="mb-1 font-medium text-text">Таблица замечаний</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Обычный клик по «где в ПД» открывает лист здесь. Ctrl+клик (на Mac
            ⌘+клик) или средняя кнопка — новая вкладка.
          </li>
          <li>
            «Неверно» — только для придуманных ИИ замечаний, причину указать
            обязательно.
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
