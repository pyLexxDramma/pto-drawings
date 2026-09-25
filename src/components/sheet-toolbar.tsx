"use client";

import { IconBack, IconSearch } from "@/components/tool-icons";

const BTN =
  "pto-tool pto-tool--slim inline-flex items-center justify-center rounded border border-slate-400 bg-slate-100 text-slate-800 hover:bg-slate-200";
const BTN_ACTIVE =
  "pto-tool pto-tool--slim inline-flex items-center justify-center rounded border border-accent bg-accent/10 text-accent";

/**
 * Кнопки над листом: поиск по файлу и метка режима просмотра. Вынесено из
 * review-pane — там это лежало посреди тела компонента на 2000 строк.
 * Иконки компактные; подписи статусов («Просмотр») не трогаем.
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
          title={backLabel}
          aria-label={backLabel}
          className={`${BTN} w-6`}
        >
          <IconBack className="h-3 w-3" />
        </button>
      ) : null}
      <button
        type="button"
        title={searchOpen ? "Закрыть поиск (Esc)" : "Поиск по файлу (/ или Ctrl+F)"}
        aria-label={searchOpen ? "Закрыть поиск" : "Поиск по файлу"}
        onClick={() => (searchOpen ? onCloseSearch() : onOpenSearch())}
        className={`${searchOpen ? BTN_ACTIVE : BTN} w-6`}
      >
        <IconSearch className="h-3 w-3" />
      </button>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={undoBusy}
          title="Отменить последнее добавление или удаление замечания"
          aria-label="Отменить"
          className={`${BTN} px-1.5 pto-t-xs font-semibold disabled:opacity-50`}
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
