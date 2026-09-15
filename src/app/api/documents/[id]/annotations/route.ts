import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { createReview, deleteReview } from "@/lib/reviews";
import { createAnnotation, getDocument, listAnnotations } from "@/lib/storage";
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

  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  const expected = (body.expected ?? "").trim();
  const text = expected ? `${comment}. Должно быть: ${expected}` : comment;
  const review = await createReview(document.projectId, {
    section: "",
    text,
    origin: "engineer",
    locations: [
      {
        documentId: id,
        documentName: document.originalName,
        pageNumber: body.pageNumber,
        quote: comment,
      },
    ],
    authorId: user.id,
    authorName: user.displayName,
  });

  const annotation = await createAnnotation({
    documentId: id,
    pageNumber: body.pageNumber,
    rect: body.rect,
    comment,
    expected,
    author: { userId: user.id, userName: user.displayName },
    reviewId: review.id,
  });
  if (!annotation) {
    await deleteReview(document.projectId, review.id, {
      userId: user.id,
      userName: user.displayName,
    });
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  return NextResponse.json({ annotation, review }, { status: 201 });
}
