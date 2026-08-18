import { NextResponse } from "next/server";
import { processDocument } from "@/lib/process-document";
import { listDocuments, savePdf } from "@/lib/storage";

const MAX_BYTES = 80 * 1024 * 1024;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const documents = await listDocuments(projectId);
  for (const document of documents) {
    if (document.status === "queued") {
      void processDocument(document.id);
    }
  }
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
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
    void processDocument(document.id);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось сохранить файл";
    return NextResponse.json({ error: message }, { status });
  }
}
