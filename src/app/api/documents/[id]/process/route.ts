import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { getDrawingExt } from "@/lib/drawing-files";
import { logEvent } from "@/lib/event-log";
import { processDocument } from "@/lib/process-document";
import { getDocument, updateDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (getDrawingExt(document.originalName) === "doc") {
    return NextResponse.json(
      { error: ".doc разобран при загрузке — повтор не нужен" },
      { status: 400 },
    );
  }

  // По умолчанию полный пересчёт: иначе UI «Обработать заново» цепляет
  // готовый job и не гоняет модель. ?reset=0 — только добрать дыры.
  const url = new URL(request.url);
  let reset = url.searchParams.get("reset") !== "0";
  try {
    const body = (await request.json()) as { reset?: boolean };
    if (typeof body.reset === "boolean") reset = body.reset;
  } catch {
    // тело необязательно
  }

  await updateDocument(id, {
    status: "queued",
    processingStep: "queued",
    processingPage: null,
    errorMessage: null,
    pipelineFinishedAt: null,
    pipelineElapsedSec: null,
  });
  runInBackground(processDocument(id, { reset }));
  await logEvent({
    layer: "back",
    action: reset ? "запуск обработки заново" : "добор листов",
    ok: true,
    document: document.originalName,
    userName: user.displayName,
  });
  const queued = await getDocument(id);
  return NextResponse.json({ document: queued, reset });
}
