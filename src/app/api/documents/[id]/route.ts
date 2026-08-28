import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { purgeDocumentPipeline } from "@/lib/process-document";
import {
  deleteDocument,
  getDocument,
  savePageMarkdown,
} from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json(
    { document },
    {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const body = (await request.json()) as {
    pageNumber?: number;
    markdown?: string;
  };

  if (typeof body.pageNumber !== "number" || typeof body.markdown !== "string") {
    return NextResponse.json(
      { error: "Нужны pageNumber и markdown" },
      { status: 400 },
    );
  }

  const document = await savePageMarkdown(id, body.pageNumber, body.markdown, {
    userId: user.id,
    userName: user.displayName,
  });
  if (!document) {
    return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
  }
  return NextResponse.json({ document });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;

  // Сначала снять job с конвейера, потом локальные файлы — иначе очередь дорабатывает «призрак».
  try {
    await purgeDocumentPipeline(id);
  } catch (error) {
    console.warn(
      `[pto] purge pipeline for ${id}:`,
      error instanceof Error ? error.message : error,
    );
  }

  const removed = await deleteDocument(id);
  if (!removed) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
