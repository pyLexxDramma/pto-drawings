"use client";

import { useEffect, useRef, useState } from "react";
import { ROLE_LABEL, type PublicUser } from "@/types";

type UserMenuProps = {
  user: PublicUser;
  defaultPasswordWarning?: boolean;
  /** Режим конвейера и профиль модели — техника, инженеру в шапке не нужна. */
  statusNote?: string | null;
  /** Только аватар без имени и роли — для узкой шапки ревью. */
  compact?: boolean;
  onUsers?: () => void;
  onPassword: () => void;
  onLogout: () => void;
};

export function UserMenu({
  user,
  defaultPasswordWarning = false,
  statusNote = null,
  compact = false,
  onUsers,
  onPassword,
  onLogout,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        title={compact ? `${user.displayName} · роль: ${ROLE_LABEL[user.role]}` : undefined}
        className={`flex items-center gap-2 rounded-md border text-left hover:bg-bg ${
          compact ? "px-1.5 py-1" : "px-2.5 py-1.5"
        } ${
          defaultPasswordWarning
            ? "border-amber-400 bg-amber-50"
            : "border-border bg-white"
        }`}
      >
        {compact ? null : (
          <span className="hidden text-right text-[11px] leading-tight sm:block">
            <span className="block font-medium text-text">{user.displayName}</span>
            <span className="block text-muted">роль: {ROLE_LABEL[user.role]}</span>
          </span>
        )}
        <span
          className={`flex items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text ${
            compact ? "h-6 w-6" : "h-7 w-7 sm:hidden"
          }`}
        >
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-[10px] text-muted" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-border bg-white py-1 shadow-md"
        >
          {compact ? (
            <div className="border-b border-border px-3 pb-1.5 pt-1 text-[11px] leading-tight">
              <div className="font-medium text-text">{user.displayName}</div>
              <div className="text-muted">роль: {ROLE_LABEL[user.role]}</div>
            </div>
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
    </div>
  );
}
