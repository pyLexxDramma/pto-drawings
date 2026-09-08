import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { deleteReview, updateReview, type ReviewPatch } from "@/lib/reviews";
import type { ReviewSeverity, ReviewVerdict } from "@/types";

type RouteContext = { params: Promise<{ id: string; reviewId: string }> };

const severities: ReviewSeverity[] = ["high", "medium", "low", "skip"];
const verdicts: ReviewVerdict[] = [
  "pending",
  "confirmed",
  "partial",
  "discuss",
  "outdated",
];

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id, reviewId } = await context.params;

  const body = (await request.json()) as {
    severity?: ReviewSeverity;
    verdict?: ReviewVerdict;
    comment?: string;
    text?: string;
    section?: string;
  };

  if (body.severity && !severities.includes(body.severity)) {
    return NextResponse.json({ error: "Неизвестная важность" }, { status: 400 });
  }
  if (body.verdict && !verdicts.includes(body.verdict)) {
    return NextResponse.json({ error: "Неизвестный статус" }, { status: 400 });
  }

  const patch: ReviewPatch = {};
  if (body.severity) patch.severity = body.severity;
  if (body.verdict) patch.verdict = body.verdict;
  if (body.comment !== undefined) patch.comment = body.comment;
  if (body.text !== undefined) patch.text = body.text;
  if (body.section !== undefined) patch.section = body.section;

  const review = await updateReview(id, reviewId, patch);
  if (!review) {
    return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
  }
  return NextResponse.json({ review });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id, reviewId } = await context.params;
  const removed = await deleteReview(id, reviewId);
  if (!removed) {
    return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
