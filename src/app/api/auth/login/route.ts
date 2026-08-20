import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";
import { checkRateLimit, clientKey, resetRateLimit } from "@/lib/rate-limit";
import { verifyLogin } from "@/lib/storage";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const body = (await request.json()) as { login?: string; password?: string };
  const login = body.login?.trim() ?? "";
  const password = body.password ?? "";
  if (!login || !password) {
    return NextResponse.json({ error: "Укажите логин и пароль" }, { status: 400 });
  }

  const key = clientKey(request, login.toLowerCase());
  const limit = checkRateLimit(key, MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return NextResponse.json(
      { error: `Слишком много попыток. Повторите через ${minutes} мин.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const user = await verifyLogin(login, password);
  if (!user) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  resetRateLimit(key);
  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions());
  return response;
}
