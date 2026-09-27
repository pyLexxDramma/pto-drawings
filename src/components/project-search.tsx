"use client";

import { useEffect, useId, useRef } from "react";
import { IconClose } from "@/components/tool-icons";
import type { SearchHit } from "@/types";

/**
 * Поиск по всему проекту (расшифровки всех файлов). Файл-локальный «/» остаётся
 * в правой колонке листа.
 */
export function ProjectSearch({
  query,
  onQueryChange,
  hits,
  searching,
  open,
  onOpenChange,
  onPick,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  hits: SearchHit[];
  searching: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (hit: SearchHit) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const needle = query.trim();
  const showPanel = open && needle.length >= 2;

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [onOpenChange, open]);

  return (
    <div ref={wrapRef} className="relative min-w-0 max-w-[14rem] flex-1 sm:max-w-[18rem]">
      <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5">
        <input
          ref={inputRef}
          type="search"
          value={query}
          data-project-search=""
          placeholder="Поиск по проекту…"
          aria-label="Поиск по проекту"
          aria-expanded={showPanel}
          aria-controls={listId}
          autoComplete="off"
          onFocus={() => onOpenChange(true)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            onOpenChange(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              if (query) onQueryChange("");
              else {
                onOpenChange(false);
                inputRef.current?.blur();
              }
            }
            if (event.key === "Enter" && hits[0]) {
              event.preventDefault();
              onPick(hits[0]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent pto-t-sm text-text outline-none placeholder:text-muted"
        />
        {query ? (
          <button
            type="button"
            title="Очистить"
            aria-label="Очистить поиск"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-slate-100 hover:text-text"
          >
            <IconClose className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute right-0 z-40 mt-1 max-h-72 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-border bg-white py-1 shadow-md"
        >
          {searching && hits.length === 0 ? (
            <div className="px-2 py-2 pto-t-sm text-muted">Ищем…</div>
          ) : hits.length === 0 ? (
            <div className="px-2 py-2 pto-t-sm text-muted">
              Ничего не нашлось в расшифровках проекта.
            </div>
          ) : (
            hits.map((hit, index) => (
              <button
                key={`${hit.documentId}-${hit.pageNumber}-${index}`}
                type="button"
                role="option"
                onClick={() => onPick(hit)}
                className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left hover:bg-sky-50"
              >
                <span className="truncate pto-t-sm font-semibold text-text">
                  {hit.originalName}
                  <span className="font-normal text-muted">
                    {" "}
                    · лист {hit.pageNumber}
                  </span>
                </span>
                <span className="line-clamp-2 pto-t-xs leading-snug text-muted">
                  {hit.snippet}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
