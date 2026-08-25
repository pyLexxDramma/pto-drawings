import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { fetchPipelinePageAsset } from "@/lib/pipeline";
import { getDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string; pageNumber: string }> };

/** Первый разбор DWG на бэке может занять до ~35 с. */
export const maxDuration = 60;

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;

  const { id, pageNumber } = await context.params;
  const page = Number(pageNumber);
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "Некорректный номер листа" }, { status: 400 });
  }

  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  try {
    const upstream = await fetchPipelinePageAsset(id, page, "geometry");
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            detail.trim().slice(0, 400) ||
            "Геометрия листа недоступна (внешние ссылки или служебный лист)",
        },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }
    const csv = await upstream.text();
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Конвейер недоступен",
      },
      { status: 502 },
    );
  }
}
