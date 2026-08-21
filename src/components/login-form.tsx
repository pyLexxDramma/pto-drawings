"use client";

import { useState, type FormEvent } from "react";
import { PtoLogo } from "@/components/pto-logo";
import type { PublicUser } from "@/types";

type LoginFormProps = {
  onSuccess: (user: PublicUser) => void;
  /** true — на сервере ещё заводской пароль admin123 */
  showBootstrapHint?: boolean;
};

export function LoginForm({
  onSuccess,
  showBootstrapHint = false,
}: LoginFormProps) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const payload = (await response.json()) as {
        user?: PublicUser;
        error?: string;
      };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || "Не удалось войти");
      }
      onSuccess(payload.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-3">
          <PtoLogo className="h-10 w-10" />
          <div>
            <div className="text-base font-semibold">PTO</div>
            <div className="text-xs text-muted">Вход в проверку чертежей</div>
          </div>
        </div>

        <label className="mb-3 block text-xs text-muted">
          Логин
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="mb-4 block text-xs text-muted">
          Пароль
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        {error ? (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-60"
        >
          {busy ? "Вход…" : "Войти"}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          {showBootstrapHint ? (
            <>
              Первый запуск: логин{" "}
              <span className="font-medium text-text">admin</span>, пароль{" "}
              <span className="font-medium text-text">admin123</span>. Админ
              создаёт аккаунты инженеров в приложении.
            </>
          ) : (
            <>
              Доступ выдаёт администратор. Пароль не публикуется на экране входа.
            </>
          )}
        </p>
      </form>
    </div>
  );
}
