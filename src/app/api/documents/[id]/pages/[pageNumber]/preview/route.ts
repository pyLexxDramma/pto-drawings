import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { fetchPipelinePageAsset } from "@/lib/pipeline";
import { getDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string; pageNumber: string }> };

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

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";

  try {
    const upstream = await fetchPipelinePageAsset(id, page, "preview", format);
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error: detail.trim().slice(0, 400) || "Превью листа недоступно",
        },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(bytes, {
      headers: {
        "Content-Type":
          format === "svg" ? "image/svg+xml" : "image/png",
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
