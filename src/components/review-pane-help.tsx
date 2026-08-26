"use client";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 py-0.5 font-mono text-[10px] text-text">
      {children}
    </kbd>
  );
}

/** Справка по экрану проверки листа — показывается в меню «⋯». */
export function ReviewPaneHelp() {
  return (
    <div
      className="border-t border-border px-3 py-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Справка
      </div>
      <div className="max-h-56 space-y-3 overflow-y-auto pr-1 text-[11px] leading-relaxed text-muted">
        <section>
          <div className="mb-1 font-medium text-text">Синхронный скролл</div>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Абзац расшифровки привязан к зоне на чертеже — активный блок и полоса
              подсвечиваются.
            </li>
            <li>Колёсико на чертеже — прокрутка обеих панелей.</li>
            <li>
              <Kbd>Ctrl</Kbd> + колёсико — зум в точку курсора.
            </li>
            <li>Перетаскивание чертежа мышью — сдвиг вида.</li>
            <li>
              Включение/выключение — пункт «Синхронный скролл» выше или{" "}
              <Kbd>?</Kbd>.
            </li>
          </ul>
        </section>

        <section>
          <div className="mb-1 font-medium text-text">Листы и поиск</div>
          <ul className="list-disc space-y-1 pl-4">
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
              <Kbd>Ctrl+S</Kbd> — сохранить правки текста расшифровки.
            </li>
            <li>Клик по заголовку в расшифровке — сброс вида чертежа на лист.</li>
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
    </div>
  );
}
