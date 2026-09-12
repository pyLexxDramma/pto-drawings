"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ControlsHelpDialog } from "@/components/review-pane-help";
import { ROLE_LABEL, type PublicUser } from "@/types";

type UserMenuProps = {
  user: PublicUser;
  defaultPasswordWarning?: boolean;
  /** Режим конвейера и профиль модели — техника, инженеру в шапке не нужна. */
  statusNote?: string | null;
  /** Только аватар без имени и роли — для узкой шапки ревью. */
  compact?: boolean;
  /** Цветная вкладка роли (вместо «Загрузить» в шапке). */
  accent?: boolean;
  /** Действия по открытому листу: над чертежом оставлена только «Ошибка». */
  sheetMenu?: ReactNode;
  onUsers?: () => void;
  /** Журналы правок — только админу. */
  onAudit?: () => void;
  onPassword: () => void;
  onLogout: () => void;
};

export function UserMenu({
  user,
  defaultPasswordWarning = false,
  statusNote = null,
  compact = false,
  accent: _accent = false,
  sheetMenu = null,
  onUsers,
  onAudit,
  onPassword,
  onLogout,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  /** Инструкция по управлению переехала сюда из меню «⋯» над листом. */
  const [helpOpen, setHelpOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const role = ROLE_LABEL[user.role];
  const letter = user.displayName.slice(0, 1).toUpperCase() || "A";

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${role}: ${user.displayName}`}
        onClick={() => setOpen((value) => !value)}
        title={`${user.displayName} · ${role}`}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border text-left ${
          compact ? "px-1.5 py-1" : "px-2 py-1"
        } ${
          defaultPasswordWarning
            ? "border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100"
            : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
        }`}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
            compact ? "h-6 w-6" : "h-7 w-7"
          } ${
            defaultPasswordWarning
              ? "bg-amber-200 text-amber-950"
              : user.role === "admin"
                ? "bg-slate-700 text-white"
                : "bg-slate-200 text-slate-800"
          }`}
        >
          {letter}
        </span>
        {compact ? null : (
          <span className="text-[11px] leading-tight">
            <span className="block font-semibold text-slate-900">{role}</span>
            <span className="block text-slate-500">{user.displayName}</span>
          </span>
        )}
        <span className="text-[10px] text-slate-500" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute right-0 z-40 mt-1 max-h-[80vh] overflow-y-auto rounded-md border border-border bg-white py-1 shadow-md ${
            sheetMenu ? "w-[min(22rem,calc(100vw-2rem))]" : "w-56"
          }`}
          onClick={() => setOpen(false)}
        >
          {compact ? (
            <div className="border-b border-border px-3 pb-1.5 pt-1 text-[11px] leading-tight">
              <div className="font-medium text-text">{user.displayName}</div>
              <div className="text-muted">роль: {role}</div>
            </div>
          ) : null}
          {sheetMenu ? (
            <>
              <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Лист
              </div>
              {sheetMenu}
              <div className="my-1 border-t border-border" />
            </>
          ) : null}
          {user.role === "admin" && onUsers ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-bg"
              onClick={() => {
                setOpen(false);
                onUsers();
              }}
            >
              Пользователи
            </button>
          ) : null}
          {onAudit ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-bg"
              onClick={() => {
                setOpen(false);
                onAudit();
              }}
            >
              Журналы правок
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-bg ${
              defaultPasswordWarning ? "text-amber-800" : ""
            }`}
            onClick={() => {
              setOpen(false);
              onPassword();
            }}
          >
            Пароль
            {defaultPasswordWarning ? " · сменить" : ""}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-bg"
            onClick={() => {
              setOpen(false);
              setHelpOpen(true);
            }}
          >
            Инструкция
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-bg"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Выйти
          </button>
          {statusNote ? (
            <div className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-[10px] leading-snug text-muted">
              {statusNote}
            </div>
          ) : null}
        </div>
      ) : null}
      {helpOpen ? <ControlsHelpDialog onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}
