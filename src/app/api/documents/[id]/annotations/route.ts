import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { createAnnotation, listAnnotations } from "@/lib/storage";
import type { AnnotationRect } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const annotations = await listAnnotations(id);
  if (!annotations) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ annotations });
}

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const body = (await request.json()) as {
    pageNumber?: number;
    rect?: AnnotationRect;
    comment?: string;
    expected?: string;
  };

  if (typeof body.pageNumber !== "number" || !body.rect) {
    return NextResponse.json({ error: "Нужны pageNumber и rect" }, { status: 400 });
  }
  const comment = (body.comment ?? "").trim();
  if (!comment) {
    return NextResponse.json({ error: "Опишите, что неверно" }, { status: 400 });
  }

  const annotation = await createAnnotation({
    documentId: id,
    pageNumber: body.pageNumber,
    rect: body.rect,
    comment,
    expected: (body.expected ?? "").trim(),
    author: { userId: user.id, userName: user.displayName },
  });
  if (!annotation) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ annotation }, { status: 201 });
}
