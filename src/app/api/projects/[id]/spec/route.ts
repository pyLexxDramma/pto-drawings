import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { clearProjectSpec, getProject, saveProjectSpec } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

const MAX_BYTES = 80 * 1024 * 1024;

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  const name = file.name.toLowerCase();
  const isPdf =
    file.type === "application/pdf" ||
    file.type === "application/x-pdf" ||
    name.endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ error: "ТЗ можно загрузить только PDF" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Файл больше 80 МБ" }, { status: 400 });
  }

  try {
    const project = await saveProjectSpec({
      projectId: id,
      originalName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    if (!project) {
      return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : "Не удалось сохранить ТЗ";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const project = await clearProjectSpec(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
