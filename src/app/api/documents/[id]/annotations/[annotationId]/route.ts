import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { deleteAnnotation, updateAnnotation } from "@/lib/storage";
import type { AnnotationStatus } from "@/types";

type RouteContext = { params: Promise<{ id: string; annotationId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id, annotationId } = await context.params;
  const body = (await request.json()) as {
    comment?: string;
    expected?: string;
    status?: AnnotationStatus;
  };

  try {
    const annotation = await updateAnnotation({
      documentId: id,
      annotationId,
      comment: body.comment,
      expected: body.expected,
      status: body.status === "fixed" || body.status === "open" ? body.status : undefined,
      actor: { userId: user.id, isAdmin: user.role === "admin" },
    });
    if (!annotation) {
      return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
    }
    return NextResponse.json({ annotation });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : "Не удалось обновить";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id, annotationId } = await context.params;

  try {
    const removed = await deleteAnnotation({
      documentId: id,
      annotationId,
      actor: { userId: user.id, isAdmin: user.role === "admin" },
    });
    if (!removed) {
      return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : "Не удалось удалить";
    return NextResponse.json({ error: message }, { status });
  }
}
