import { isPublicUser, requireUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { listReviews } from "@/lib/reviews";
import { buildReviewsXlsx, reviewsFileName } from "@/lib/reviews-export";
import { getProject } from "@/lib/storage";
import type { Review } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

function xlsxResponse(projectName: string, reviews: Review[]) {
  const file = buildReviewsXlsx({ projectName, reviews });
  const name = reviewsFileName(projectName);
  const encoded = encodeURIComponent(name);
  const ascii = name.replace(/[^\u0020-\u007E]/g, "_") || "reviews.xlsx";
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const reviews = await listReviews(id);
  return xlsxResponse(project.name, reviews);
}

/** Выгрузка уже отфильтрованных строк — те, что сейчас видны в таблице. */
export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    reviewIds?: unknown;
  };
  const ids = Array.isArray(body.reviewIds)
    ? body.reviewIds.filter((item): item is string => typeof item === "string")
    : [];
  const all = await listReviews(id);
  const keep = new Set(ids);
  const reviews = keep.size > 0 ? all.filter((item) => keep.has(item.id)) : all;
  return xlsxResponse(project.name, reviews);
}
