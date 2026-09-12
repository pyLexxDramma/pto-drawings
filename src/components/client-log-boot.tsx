"use client";

import { useEffect } from "react";
import { installClientLog } from "@/lib/client-log";

/** Ловушки ошибок браузера ставим один раз на всё приложение, включая вход. */
export function ClientLogBoot() {
  useEffect(() => {
    installClientLog();
  }, []);
  return null;
}
