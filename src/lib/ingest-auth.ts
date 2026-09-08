import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/** Сервисный доступ конвейера: тот же токен, что в docs/page-contract.md. */
function tokenFrom(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("x-ingest-token")?.trim() ?? "";
}

/** null — ингест выключен (нет PTO_INGEST_TOKEN). */
export function ingestAuthorized(request: Request): boolean | null {
  const expected = process.env.PTO_INGEST_TOKEN ?? "";
  if (!expected) return null;
  const a = Buffer.from(tokenFrom(request));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Готовый ответ, если токен не подошёл; null — можно продолжать. */
export function ingestGuard(request: Request): NextResponse | null {
  const check = ingestAuthorized(request);
  if (check === null) {
    return NextResponse.json(
      { error: "Сервисный ингест выключен: не задан PTO_INGEST_TOKEN" },
      { status: 503 },
    );
  }
  if (!check) {
    return NextResponse.json({ error: "Нужен токен ингеста" }, { status: 401 });
  }
  return null;
}
