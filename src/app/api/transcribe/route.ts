import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { PIPELINE_URL } from "@/lib/pipeline";

export const maxDuration = 60;

/**
 * Голос для замечаний.
 * Фронт пишет webm и шлёт сюда. Мы проксируем на бэкенд Данила:
 *   POST {PTO_BACKEND_URL}/transcribe  multipart field "audio"
 * Пока эндпоинта нет — 501, клиент падает в браузерный SpeechRecognition.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;

  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "Нет аудио" }, { status: 400 });
  }

  const outbound = new FormData();
  outbound.set("audio", audio, "note.webm");

  try {
    const response = await fetch(`${PIPELINE_URL}/transcribe`, {
      method: "POST",
      body: outbound,
      cache: "no-store",
    });
    if (response.status === 404) {
      return NextResponse.json(
        { error: "Whisper на бэке ещё не подключён" },
        { status: 501 },
      );
    }
    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: detail || `Бэкенд ${response.status}` },
        { status: 502 },
      );
    }
    const payload = (await response.json()) as { text?: string; transcript?: string };
    const text = (payload.text ?? payload.transcript ?? "").trim();
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json(
      { error: "Whisper на бэке ещё не подключён" },
      { status: 501 },
    );
  }
}
