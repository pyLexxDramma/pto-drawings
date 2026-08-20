"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABEL, type PublicUser, type UserRole } from "@/types";

type UsersPanelProps = {
  open: boolean;
  currentUserId: string;
  onClose: () => void;
};

export function UsersPanel({ open, currentUserId, onClose }: UsersPanelProps) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [login, setLogin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("engineer");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users");
    if (!response.ok) return;
    const payload = (await response.json()) as { users: PublicUser[] };
    setUsers(payload.users ?? []);
  }, []);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    void (async () => {
      if (ac.signal.aborted) return;
      await loadUsers();
    })();
    return () => ac.abort();
  }, [loadUsers, open]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, displayName, role, password }),
      });
      const payload = (await response.json()) as {
        user?: PublicUser;
        error?: string;
      };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || "Не удалось создать");
      }
      setLogin("");
      setDisplayName("");
      setPassword("");
      setRole("engineer");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled(user: PublicUser) {
    setError(null);
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !user.disabled }),
    });
    const payload = (await response.json()) as { user?: PublicUser; error?: string };
    if (!response.ok || !payload.user) {
      setError(payload.error || "Не удалось обновить аккаунт");
      return;
    }
    setUsers((prev) => prev.map((item) => (item.id === user.id ? payload.user! : item)));
  }

  async function submitReset(userId: string) {
    setError(null);
    const response = await fetch(`/api/users/${userId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPassword }),
    });
    const payload = (await response.json()) as { user?: PublicUser; error?: string };
    if (!response.ok || !payload.user) {
      setError(payload.error || "Не удалось сбросить пароль");
      return;
    }
    setResetFor(null);
    setResetPassword("");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90dvh] w-full max-w-md overflow-auto rounded-xl border border-border bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Пользователи</div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-text"
          >
            Закрыть
          </button>
        </div>

        <ul className="mb-4 space-y-1">
          {users.map((user) => (
            <li key={user.id} className="rounded-md bg-bg px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className={user.disabled ? "font-medium line-through" : "font-medium"}>
                    {user.displayName}
                  </span>
                  <span className="text-muted">
                    {" "}
                    · {user.login} · {ROLE_LABEL[user.role]}
                    {user.disabled ? " · отключён" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setResetFor(resetFor === user.id ? null : user.id);
                      setResetPassword("");
                    }}
                    className="text-accent hover:underline"
                  >
                    Пароль
                  </button>
                  {user.id === currentUserId ? null : (
                    <button
                      type="button"
                      onClick={() => void toggleDisabled(user)}
                      className={user.disabled ? "text-emerald-600 hover:underline" : "text-red-600 hover:underline"}
                    >
                      {user.disabled ? "Включить" : "Отключить"}
                    </button>
                  )}
                </span>
              </div>
              {resetFor === user.id ? (
                <div className="mt-1.5 flex gap-1">
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    placeholder="Новый пароль"
                    className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-xs outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void submitReset(user.id)}
                    className="rounded-md border border-border px-2 text-xs"
                  >
                    OK
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <form onSubmit={handleCreate} className="space-y-2 border-t border-border pt-3">
          <div className="text-xs font-medium text-muted">Новый аккаунт</div>
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="Логин"
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Имя"
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="engineer">Инженер</option>
            <option value="admin">Админ</option>
          </select>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Пароль (от 6 символов)"
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
            {busy ? "Создание…" : "Создать"}
          </button>
        </form>
      </div>
    </div>
  );
}
