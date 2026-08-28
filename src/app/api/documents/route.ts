import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import {
  DRAWING_ACCEPT_HINT,
  getDrawingExt,
  isDrawingFile,
  resolveDisplayName,
} from "@/lib/drawing-files";
import { processDocument, reconcileOrphanedJobs } from "@/lib/process-document";
import { listDocuments, saveDocument } from "@/lib/storage";

export const maxDuration = 60;

const MAX_BYTES = 80 * 1024 * 1024;

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const lite = searchParams.get("lite") !== "0";
  await reconcileOrphanedJobs();
  const documents = await listDocuments(projectId, { lite });
  return NextResponse.json(
    { documents },
    {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    },
  );
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const form = await request.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const titleRaw = String(form.get("title") ?? "").trim();

  if (!projectId) {
    return NextResponse.json({ error: "Не выбран проект" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }

  if (!isDrawingFile(file)) {
    return NextResponse.json(
      { error: `Можно загружать только ${DRAWING_ACCEPT_HINT}` },
      { status: 400 },
    );
  }

  if (!getDrawingExt(file.name)) {
    return NextResponse.json(
      { error: "У файла должно быть расширение .pdf, .dwg или .dxf" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Файл больше 80 МБ" }, { status: 400 });
  }

  const displayName = resolveDisplayName(titleRaw, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const document = await saveDocument({
      projectId,
      originalName: displayName,
      buffer,
    });
    runInBackground(processDocument(document.id));
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось сохранить файл";
    return NextResponse.json({ error: message }, { status });
  }
}
