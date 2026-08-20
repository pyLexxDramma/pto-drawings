import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { activeDocumentIds, processDocument } from "@/lib/process-document";
import { listDocuments, resetStuckDocuments, savePdf } from "@/lib/storage";

export const maxDuration = 60;

const MAX_BYTES = 80 * 1024 * 1024;

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const lite = searchParams.get("lite") !== "0";
  await resetStuckDocuments(activeDocumentIds());
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

  if (!projectId) {
    return NextResponse.json({ error: "Не выбран проект" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const isPdf =
    file.type === "application/pdf" ||
    file.type === "application/x-pdf" ||
    name.endsWith(".pdf");

  if (!isPdf) {
    return NextResponse.json({ error: "Можно загружать только PDF" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Файл больше 80 МБ" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const document = await savePdf({
      projectId,
      originalName: file.name,
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
