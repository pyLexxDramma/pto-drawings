"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginForm } from "@/components/login-form";
import { Workspace } from "@/components/workspace";
import type { PublicUser } from "@/types";

export function AppShell() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState(false);

  const handleLogout = useCallback(() => setUser(null), []);
  const handlePasswordChanged = useCallback(() => setDefaultPassword(false), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/me");
        const payload = (await response.json()) as {
          user: PublicUser | null;
          defaultAdminPassword?: boolean;
        };
        if (!cancelled) {
          setUser(payload.user);
          setDefaultPassword(Boolean(payload.defaultAdminPassword));
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
        Загрузка…
      </div>
    );
  }

  if (!user) {
    return (
      <LoginForm
        showBootstrapHint={defaultPassword}
        onSuccess={(next) => {
          setUser(next);
          void (async () => {
            const response = await fetch("/api/auth/me");
            const payload = (await response.json()) as {
              defaultAdminPassword?: boolean;
            };
            setDefaultPassword(Boolean(payload.defaultAdminPassword));
          })();
        }}
      />
    );
  }

  return (
    <Workspace
      user={user}
      defaultPasswordWarning={defaultPassword}
      onPasswordChanged={handlePasswordChanged}
      onLogout={handleLogout}
    />
  );
}
