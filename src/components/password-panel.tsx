"use client";

import { useState, type FormEvent } from "react";

type PasswordPanelProps = {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export function PasswordPanel({ open, onClose, onChanged }: PasswordPanelProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== repeat) {
      setError("Новые пароли не совпадают");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось сменить пароль");
      setCurrentPassword("");
      setNewPassword("");
      setRepeat("");
      setDone(true);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Смена пароля</div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-text"
          >
            Закрыть
          </button>
        </div>

        {done ? (
          <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
            Пароль обновлён.
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-2 space-y-2">
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Текущий пароль"
            autoComplete="current-password"
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Новый пароль (от 6 символов)"
            autoComplete="new-password"
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            placeholder="Новый пароль ещё раз"
            autoComplete="new-password"
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          {error ? (
            <div className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-60"
          >
            {busy ? "Сохраняем…" : "Сменить пароль"}
          </button>
        </form>
      </div>
    </div>
  );
}
