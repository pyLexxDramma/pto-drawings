import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { ingestReviews, listReviews } from "@/lib/reviews";
import { PIPELINE_URL } from "@/lib/pipeline";
import { getProject } from "@/lib/storage";
import type { ReviewIngestItem } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 120;

/**
 * Контракт для агента: POST {PTO_BACKEND_URL}/reviews/enrich
 *
 * Вход:
 *   { projectId, reviews: [{ id, text, section }] }
 * Выход:
 *   { reviews: [{
 *       reviewId,          // тот же id
 *       section,           // короткий шифр раздела
 *       text?,             // не затирать исходник инженера
 *       aiFinding?,        // подчищенная формулировка / обоснование
 *       locations: [{ documentId?, documentName, pageNumber, quote }],
 *       needsRecheck,      // true если цитату не нашли или не уверены
 *       origin?: "ai"
 *     }] }
 *
 * quote — подстрока текстового слоя листа. Идемпотентно по reviewId.
 * Вызывать только когда расшифровка проекта done.
 */
export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const reviews = await listReviews(id);
  const pending = reviews.filter(
    (item) =>
      item.origin !== "ai" &&
      item.text &&
      (item.locations.length === 0 || item.needsRecheck),
  );
  if (pending.length === 0) {
    return NextResponse.json({
      ok: true,
      added: 0,
      updated: 0,
      enriched: 0,
      total: reviews.length,
      message: "Нет строк инженера без места в ПД",
    });
  }

  let response: Response;
  try {
    response = await fetch(`${PIPELINE_URL}/reviews/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        projectId: id,
        reviews: pending.map((item) => ({
          id: item.id,
          text: item.text,
          section: item.section,
        })),
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Конвейер недоступен: ${error.message}`
            : "Конвейер недоступен",
      },
      { status: 503 },
    );
  }

  if (response.status === 404) {
    return NextResponse.json(
      {
        error:
          "Агент обогащения ещё не подключён (нет POST /reviews/enrich). Импорт и выгрузка уже работают.",
      },
      { status: 501 },
    );
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return NextResponse.json(
      { error: payload.error ?? `Агент ответил ${response.status}` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as { reviews?: ReviewIngestItem[] };
  if (!Array.isArray(payload.reviews)) {
    return NextResponse.json(
      { error: "Агент должен вернуть { reviews: [...] }" },
      { status: 502 },
    );
  }

  const result = await ingestReviews(id, payload.reviews);
  return NextResponse.json({ ok: true, ...result });
}
