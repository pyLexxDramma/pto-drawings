"use client";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 py-0.5 font-mono text-[10px] text-text">
      {children}
    </kbd>
  );
}

/** Инструкция по управлению — живёт в меню пользователя рядом с логином. */
export function ControlsHelpContent() {
  return (
    <div className="space-y-3 text-[11px] leading-relaxed text-muted">
      <section>
        <div className="mb-1 font-medium text-text">Управление чертежом</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <strong>Колёсико вверх/вниз</strong> — прокрутка листа.
          </li>
          <li>
            <Kbd>Shift</Kbd> + <strong>колёсико</strong> — сдвиг листа влево/вправо.
          </li>
          <li>
            <Kbd>Ctrl</Kbd> + <strong>колёсико</strong> — приближение и отдаление
            (зум в точку под курсором).
          </li>
          <li>
            <strong>Перетаскивание</strong> левой кнопкой по чертежу — сдвиг вида
            влево/вправо/вверх/вниз.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-medium text-text">Листы и поиск</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Пока идёт обработка, «К обработке» рядом с «На главную» возвращает к
            текущему файлу или листу.
          </li>
          <li>
            <Kbd>J</Kbd> / <Kbd>→</Kbd> / пробел — следующий лист.
          </li>
          <li>
            <Kbd>K</Kbd> / <Kbd>←</Kbd> — предыдущий лист.
          </li>
          <li>
            <Kbd>V</Kbd> — отметить лист просмотренным / снять.
          </li>
          <li>
            <Kbd>/</Kbd> или <Kbd>Ctrl+F</Kbd> — поиск по файлу.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-medium text-text">Замечания и правки</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <Kbd>E</Kbd> или кнопка «Ошибка» — обведите место на чертеже.
          </li>
          <li>
            <Kbd>Esc</Kbd> — отмена разметки, поиска, solo-режима, выход на главную.
          </li>
          <li>
            Текст расшифровки не правится вручную: отметьте «Ошибка» — место
            уйдёт в правку конвейера и останется в истории листа.
          </li>
          <li>
            В таблице замечаний «Неверно» — для придуманных ИИ замечаний, причину
            указать обязательно.
          </li>
        </ul>
      </section>

      <section>
        <div className="mb-1 font-medium text-text">Вид</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <Kbd>F</Kbd> — сплит → только чертёж → только текст.
          </li>
          <li>Разделитель между панелями — изменить ширину чертежа и текста.</li>
          <li>Нижний угол чертежа — «Страница» / «По ширине» и масштаб.</li>
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
      aria-label="Как управлять"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-text">Как управлять</div>
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
