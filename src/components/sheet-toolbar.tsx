"use client";

import { IconBack, IconMark, IconSearch } from "@/components/tool-icons";

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
  showBack = true,
  markMode = false,
  onToggleMark,
  markCount = 0,
}: {
  searchOpen: boolean;
  readOnly: boolean;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onBack?: () => void;
  backLabel?: string;
  onUndo?: () => void;
  undoBusy?: boolean;
  /** false — кнопку рисует панель чертежа слева, не шапка расшифровки. */
  showBack?: boolean;
  markMode?: boolean;
  onToggleMark?: () => void;
  markCount?: number;
}) {
  return (
    <>
      {showBack && onBack ? (
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
        className={`${searchOpen ? BTN_ACTIVE : BTN} gap-1 px-1.5`}
      >
        <IconSearch className="h-3 w-3" />
        <span className="pto-t-sm font-semibold">Найти</span>
      </button>
      {onToggleMark ? (
        <button
          type="button"
          title={
            markMode
              ? "Отменить разметку (Esc / E)"
              : markCount > 0
                ? `Отметить ошибку — обвести место на чертеже (E), пометок: ${markCount}`
                : "Отметить ошибку — обвести место на чертеже (E)"
          }
          aria-label={
            markMode
              ? "Отменить разметку"
              : markCount > 0
                ? `Отметить ошибку, пометок: ${markCount}`
                : "Отметить ошибку"
          }
          aria-pressed={markMode}
          onClick={() => onToggleMark()}
          className={`pto-tool pto-tool--slim relative inline-flex items-center justify-center gap-1 rounded border px-1.5 ${
            markMode
              ? "border-rose-700 bg-rose-100 text-rose-950"
              : "border-rose-500 bg-rose-50 text-rose-800 hover:bg-rose-100"
          }`}
        >
          <IconMark className="h-3 w-3" />
          <span className="pto-t-sm font-semibold">Ошибка</span>
          {markCount > 0 && !markMode ? (
            <span className="absolute -right-1 -top-1 min-w-3 rounded-full bg-rose-700 px-0.5 text-center text-[8px] font-bold leading-3 text-white">
              {markCount}
            </span>
          ) : null}
        </button>
      ) : null}
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
