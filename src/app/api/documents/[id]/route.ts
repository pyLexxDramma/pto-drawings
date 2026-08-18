import { NextResponse } from "next/server";
import {
  deleteDocument,
  getDocument,
  savePageMarkdown,
} from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ document });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    pageNumber?: number;
    markdown?: string;
  };

  if (typeof body.pageNumber !== "number" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "Нужны pageNumber и markdown" }, { status: 400 });
  }

  const document = await savePageMarkdown(id, body.pageNumber, body.markdown);
  if (!document) {
    return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
  }
  return NextResponse.json({ document });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const removed = await deleteDocument(id);
  if (!removed) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
