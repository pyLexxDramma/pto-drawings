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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, #dbeafe 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 100% 100%, #e2e8f0 0%, transparent 45%), #f4f6f8",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 40%, black 20%, transparent 75%)",
        }}
      />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-border/80 bg-white/95 p-7 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] backdrop-blur-sm"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <PtoLogo className="h-14 w-14" title="PTO — проверка чертежей" />
          <div className="mt-3 text-2xl font-semibold tracking-tight text-text">
            PTO
          </div>
          <div className="pto-loading-text mt-1 text-sm leading-snug text-muted">
            In development...
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
          className="w-full rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-60"
        >
          {busy ? "Вход…" : "Войти"}
        </button>

        {showBootstrapHint ? (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
            Первый запуск: логин{" "}
            <span className="font-medium text-text">admin</span>, пароль{" "}
            <span className="font-medium text-text">admin123</span>. Админ
            создаёт аккаунты инженеров в приложении.
          </p>
        ) : null}
      </form>
    </div>
  );
}
