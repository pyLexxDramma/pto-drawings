"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Автофильтр как в Excel: стрелка на колонке, сортировка, галочки по уникальным
 * значениям, поиск по списку.
 */
export function ExcelColFilter({
  label,
  values,
  selected,
  sortDir = null,
  onSort,
  onApply,
}: {
  label: string;
  values: string[];
  /** null — колонка не фильтруется, видны все значения. */
  selected: string[] | null;
  sortDir?: 1 | -1 | null;
  onSort: (dir: 1 | -1) => void;
  onApply: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const active = selected !== null;

  function openMenu() {
    setDraft(selected ?? [...values]);
    setQuery("");
    setOpen(true);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return values;
    return values.filter((item) => item.toLowerCase().includes(needle));
  }, [query, values]);

  const allVisibleOn =
    visible.length > 0 && visible.every((item) => draft.includes(item));

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = rootRef.current?.querySelector("button");
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const pad = 8;
    let left = rect.left;
    if (left + mw > window.innerWidth - pad) {
      left = Math.max(pad, rect.right - mw);
    }
    let top = rect.bottom + 4;
    if (top + mh > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - mh - 4);
    }
    setPos({ top, left });
  }, [open, visible.length, draft.length]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const node = event.target as Node;
      if (rootRef.current?.contains(node)) return;
      if (menuRef.current?.contains(node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(value: string) {
    setDraft((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  }

  function toggleAllVisible() {
    if (allVisibleOn) {
      const hide = new Set(visible);
      setDraft((prev) => prev.filter((item) => !hide.has(item)));
      return;
    }
    setDraft((prev) => [...new Set([...prev, ...visible])]);
  }

  function apply() {
    const allOn = values.length > 0 && values.every((item) => draft.includes(item));
    onApply(allOn || draft.length === 0 ? null : draft);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="flex min-w-0 items-center gap-0.5">
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Фильтр ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={active ? `Фильтр: ${selected?.length} из ${values.length}` : `Фильтр ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${
          active
            ? "bg-accent text-white"
            : "text-slate-500 hover:bg-white hover:text-text"
        }`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
          {sortDir === 1 ? (
            <path d="M6 2.5 2.5 8h7L6 2.5Z" />
          ) : sortDir === -1 ? (
            <path d="M6 9.5 9.5 4h-7L6 9.5Z" />
          ) : (
            <path d="M2.5 4.2 6 8.2l3.5-4H2.5Z" />
          )}
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="dialog"
              aria-label={`Фильтр ${label}`}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-[80] w-56 rounded-md border border-slate-300 bg-white p-2 pto-t-md text-text shadow-md"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="mb-1.5 flex flex-col gap-0.5">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-left hover:bg-slate-100"
                  onClick={() => {
                    onSort(1);
                    setOpen(false);
                  }}
                >
                  Сортировка от А до Я
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-left hover:bg-slate-100"
                  onClick={() => {
                    onSort(-1);
                    setOpen(false);
                  }}
                >
                  Сортировка от Я до А
                </button>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск"
                className="mb-1.5 w-full rounded border border-border bg-white px-2 py-1 outline-none focus:border-accent"
              />
              <label className="flex items-center gap-1.5 border-b border-border px-1 py-1 font-medium">
                <input
                  type="checkbox"
                  checked={allVisibleOn}
                  onChange={toggleAllVisible}
                />
                (Выделить все)
              </label>
              <ul className="mt-1 max-h-48 overflow-auto">
                {visible.length === 0 ? (
                  <li className="px-1 py-2 text-muted">Нет значений</li>
                ) : (
                  visible.map((value) => (
                    <li key={value}>
                      <label className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={draft.includes(value)}
                          onChange={() => toggle(value)}
                        />
                        <span className="min-w-0 break-words">{value}</span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded border border-border bg-white px-2 py-1 hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="rounded bg-accent px-2 py-1 font-semibold text-white hover:bg-[#1d4ed8]"
                  onClick={apply}
                >
                  ОК
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
