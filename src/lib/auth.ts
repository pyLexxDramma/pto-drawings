import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getUserById } from "@/lib/storage";
import type { PublicUser, UserRole } from "@/types";

export const SESSION_COOKIE = "pto_session";
const SESSION_DAYS = 14;
const MIN_SECRET_LENGTH = 16;

let devSecret: string | null = null;

/**
 * В dev секрет держим в файле рядом с данными: маршруты Next собираются
 * отдельными бандлами, поэтому значение в памяти модуля у них не общее.
 */
function localDevSecret() {
  if (devSecret) return devSecret;
  const file = path.join(
    process.env.DATA_ROOT || process.cwd(),
    "data",
    ".dev-session-secret",
  );
  try {
    devSecret = readFileSync(file, "utf8").trim();
    if (devSecret.length >= MIN_SECRET_LENGTH) return devSecret;
  } catch {
    // файла ещё нет
  }
  devSecret = randomBytes(32).toString("hex");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, devSecret, { encoding: "utf8", flag: "wx" });
  } catch {
    try {
      devSecret = readFileSync(file, "utf8").trim();
    } catch {
      // остаёмся со значением в памяти
    }
  }
  console.warn("PTO_SESSION_SECRET не задан — использую локальный dev-секрет");
  return devSecret;
}

function sessionSecret() {
  const configured = process.env.PTO_SESSION_SECRET || process.env.AUTH_SECRET;
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Задайте PTO_SESSION_SECRET (не короче ${MIN_SECRET_LENGTH} символов) перед запуском в production`,
    );
  }

  return localDevSecret();
}

function b64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64").toString("utf8");
}

export function createSessionToken(userId: string): string {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ uid: userId, exp }));
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function parseSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest();
  const got = Buffer.from(
    sig.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (sig.length % 4)) % 4),
    "base64",
  );
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return null;
  }
  try {
    const data = JSON.parse(fromB64url(payload)) as { uid?: string; exp?: number };
    if (!data.uid || typeof data.exp !== "number" || data.exp < Date.now()) {
      return null;
    }
    return data.uid;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  // Secure-cookie только по явному флагу: пока сайт на http://IP, иначе браузер
  // выкидывает сессию и возвращает на форму входа.
  const secure =
    process.env.PTO_COOKIE_SECURE === "1" ||
    process.env.PTO_COOKIE_SECURE === "true";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getSessionUser(request: Request): Promise<PublicUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  const userId = parseSessionToken(token);
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user || user.disabled) return null;
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

export async function requireUser(request: Request): Promise<PublicUser | NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  return user;
}

export async function requireAdmin(request: Request): Promise<PublicUser | NextResponse> {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Только для админа" }, { status: 403 });
  }
  return user;
}

export function isPublicUser(
  value: PublicUser | NextResponse,
): value is PublicUser {
  return !(value instanceof NextResponse);
}

export function assertRole(role: string | undefined): UserRole {
  return role === "admin" ? "admin" : "engineer";
}
