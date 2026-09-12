import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logEvent } from "@/lib/event-log";

/**
 * Ошибки и действия из браузера. Пишем даже без сессии: падение на форме входа
 * тоже нужно видеть, просто без имени пользователя.
 */

type Incoming = {
  action?: string;
  ok?: boolean;
  message?: string;
  status?: number;
  url?: string;
  page?: number;
  document?: string;
  project?: string;
  ms?: number;
};

const MAX_BATCH = 20;

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  const body = (await request.json().catch(() => null)) as
    | { events?: Incoming[] }
    | Incoming
    | null;
  if (!body) {
    return NextResponse.json({ error: "Ожидается JSON" }, { status: 400 });
  }

  const list = Array.isArray((body as { events?: Incoming[] }).events)
    ? (body as { events: Incoming[] }).events
    : [body as Incoming];

  for (const item of list.slice(0, MAX_BATCH)) {
    if (!item?.action) continue;
    await logEvent({
      layer: "front",
      action: item.action,
      ok: item.ok !== false,
      message: item.message,
      status: item.status,
      url: item.url,
      page: item.page,
      document: item.document,
      project: item.project,
      ms: item.ms,
      userName: user?.displayName ?? null,
    });
  }

  return new NextResponse(null, { status: 204 });
}
