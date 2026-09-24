"use client";

import { IconBack, IconSearch } from "@/components/tool-icons";

const BTN =
  "rounded border px-2 py-0.5 pto-t-sm font-semibold border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
const BTN_ACTIVE =
  "rounded border px-2 py-0.5 pto-t-sm font-semibold border-accent/50 bg-accent/10 text-accent";

/**
 * Кнопки над листом: поиск по файлу и метка режима просмотра. Вынесено из
 * review-pane — там это лежало посреди тела компонента на 2000 строк.
 */
export function SheetToolbar({
  searchOpen,
  readOnly,
  onOpenSearch,
  onCloseSearch,
  onBack,
  backLabel = "Назад",
  onUndo,
  undoBusy = false,
}: {
  searchOpen: boolean;
  readOnly: boolean;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onBack?: () => void;
  backLabel?: string;
  onUndo?: () => void;
  undoBusy?: boolean;
}) {
  return (
    <>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          title="Туда, откуда открыли этот экран"
          className={`inline-flex items-center gap-1 ${BTN}`}
        >
          <IconBack className="h-3 w-3" />
          {backLabel}
        </button>
      ) : null}
      <button
        type="button"
        title={searchOpen ? "Закрыть поиск (Esc)" : "Поиск по файлу (/ или Ctrl+F)"}
        aria-label={searchOpen ? "Закрыть поиск" : "Поиск по файлу"}
        onClick={() => (searchOpen ? onCloseSearch() : onOpenSearch())}
        className={`inline-flex items-center gap-1 ${searchOpen ? BTN_ACTIVE : BTN}`}
      >
        <IconSearch className="h-3 w-3" />
        {/* Подсказка клавиши на виду: иначе про «/» узнают только из инструкции. */}
        <kbd
          className={`rounded px-1 font-sans pto-t-xs font-semibold ${
            searchOpen ? "bg-accent/15 text-accent" : "bg-slate-100 text-slate-500"
          }`}
        >
          {searchOpen ? "Esc" : "/"}
        </kbd>
      </button>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={undoBusy}
          title="Отменить последнее добавление или удаление замечания"
          className={`${BTN} disabled:opacity-50`}
        >
          Отменить
        </button>
      ) : null}
      {readOnly ? (
        <span className="rounded border border-sem-attn-line bg-sem-attn-soft px-2 py-0.5 pto-t-sm font-semibold text-sem-attn-text">
          Просмотр
        </span>
      ) : null}
    </>
  );
}
