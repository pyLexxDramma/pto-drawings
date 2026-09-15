import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { matchEngineerReview } from "@/lib/review-annotation";
import { deleteReview, listReviews } from "@/lib/reviews";
import { deleteAnnotation, getDocument, updateAnnotation } from "@/lib/storage";
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
    const document = await getDocument(id);
    if (!document) {
      return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
    }
    const removed = await deleteAnnotation({
      documentId: id,
      annotationId,
      actor: { userId: user.id, isAdmin: user.role === "admin" },
    });
    if (!removed) {
      return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
    }
    const reviews = await listReviews(document.projectId);
    const linked = matchEngineerReview(reviews, id, removed);
    if (linked) {
      await deleteReview(document.projectId, linked.id, {
        userId: user.id,
        userName: user.displayName,
      });
    }
    return NextResponse.json({ ok: true, reviewId: linked?.id ?? null });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : "Не удалось удалить";
    return NextResponse.json({ error: message }, { status });
  }
}
