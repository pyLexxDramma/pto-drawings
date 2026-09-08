import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { ingestGuard } from "@/lib/ingest-auth";
import { createReview, ingestReviews, listReviews } from "@/lib/reviews";
import { getProject } from "@/lib/storage";
import type {
  ReviewIngestItem,
  ReviewLocation,
  ReviewSeverity,
} from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

const severities: ReviewSeverity[] = ["high", "medium", "low", "skip"];

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  const reviews = await listReviews(id);
  return NextResponse.json(
    { reviews },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
  );
}

/** Замечание руками: инженер или клиент на разборе. */
export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const body = (await request.json()) as {
    section?: string;
    text?: string;
    severity?: ReviewSeverity;
    locations?: ReviewLocation[];
  };

  const section = (body.section ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!section) {
    return NextResponse.json({ error: "Укажите раздел" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Опишите замечание" }, { status: 400 });
  }
  if (body.severity && !severities.includes(body.severity)) {
    return NextResponse.json({ error: "Неизвестная важность" }, { status: 400 });
  }

  const review = await createReview(id, {
    section,
    text,
    severity: body.severity,
    locations: Array.isArray(body.locations) ? body.locations : [],
    origin: "engineer",
    authorId: user.id,
    authorName: user.displayName,
  });
  return NextResponse.json({ review }, { status: 201 });
}

/**
 * Пакетный приём от агента конвейера. Идемпотентно: повторный прогон обновляет
 * найденное и не сбрасывает разбор с заказчиком.
 */
export async function PUT(request: Request, context: RouteContext) {
  const denied = ingestGuard(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const body = (await request.json()) as { reviews?: ReviewIngestItem[] };
  if (!Array.isArray(body.reviews)) {
    return NextResponse.json(
      { error: "Ожидается { reviews: [...] }" },
      { status: 400 },
    );
  }

  const bad = body.reviews.find(
    (item) => item?.severity && !severities.includes(item.severity),
  );
  if (bad) {
    return NextResponse.json(
      { error: `Неизвестная важность: ${bad.severity}` },
      { status: 400 },
    );
  }

  const result = await ingestReviews(id, body.reviews);
  return NextResponse.json(result);
}
