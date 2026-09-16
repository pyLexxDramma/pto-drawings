import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { ingestGuard } from "@/lib/ingest-auth";
import { deleteReview, getReview, updateReview, type ReviewPatch } from "@/lib/reviews";
import { deleteAnnotationForReview } from "@/lib/storage";
import { REVIEW_SEVERITY_ORDER, type ReviewSeverity, type ReviewVerdict } from "@/types";

type RouteContext = { params: Promise<{ id: string; reviewId: string }> };

const severities: ReviewSeverity[] = [...REVIEW_SEVERITY_ORDER];
const verdicts: ReviewVerdict[] = [
  "pending",
  "confirmed",
  "partial",
  "discuss",
  "outdated",
  "wrong",
];

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id, reviewId } = await context.params;

  const body = (await request.json()) as {
    severity?: ReviewSeverity;
    verdict?: ReviewVerdict;
    comment?: string;
    wrongReason?: string;
    text?: string;
    section?: string;
  };

  if (body.severity && !severities.includes(body.severity)) {
    return NextResponse.json({ error: "Неизвестная важность" }, { status: 400 });
  }
  if (body.verdict && !verdicts.includes(body.verdict)) {
    return NextResponse.json({ error: "Неизвестный статус" }, { status: 400 });
  }
  // «Неверно» без объяснения бесполезно: по нему конвейер и правят.
  if (body.verdict === "wrong" && !body.wrongReason?.trim()) {
    return NextResponse.json(
      { error: "Напишите, что именно неверно" },
      { status: 400 },
    );
  }

  const patch: ReviewPatch = {};
  if (body.severity) patch.severity = body.severity;
  if (body.verdict) patch.verdict = body.verdict;
  if (body.comment !== undefined) patch.comment = body.comment;
  if (body.wrongReason !== undefined) patch.wrongReason = body.wrongReason;
  if (body.text !== undefined) patch.text = body.text;
  if (body.section !== undefined) patch.section = body.section;

  const actor = { userId: user.id, userName: user.displayName };
  const review = await updateReview(id, reviewId, patch, actor);
  if (!review) {
    return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
  }
  return NextResponse.json({ review });
}

function wantsIngest(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return true;
  return Boolean(request.headers.get("x-ingest-token")?.trim());
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id, reviewId } = await context.params;
  let actor = { userId: null as string | null, userName: "конвейер" };
  let fromPipeline = false;

  if (wantsIngest(request)) {
    const denied = ingestGuard(request);
    if (denied) return denied;
    fromPipeline = true;
  } else {
    const user = await requireUser(request);
    if (!isPublicUser(user)) return user;
    actor = { userId: user.id, userName: user.displayName };
  }

  const review = await getReview(id, reviewId);
  if (!review) {
    return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
  }
  if (fromPipeline && review.origin !== "ai") {
    return NextResponse.json(
      { error: "Конвейер снимает только свои находки (origin: ai)" },
      { status: 403 },
    );
  }

  const removed = await deleteReview(id, reviewId, actor);
  if (!removed) {
    return NextResponse.json({ error: "Замечание не найдено" }, { status: 404 });
  }
  if (review) {
    const quote = review.locations[0]?.quote || review.text;
    for (const location of review.locations) {
      if (!location.documentId) continue;
      await deleteAnnotationForReview({
        documentId: location.documentId,
        reviewId: review.id,
        comment: location.quote || quote,
        pageNumber: location.pageNumber,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
