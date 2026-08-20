import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { ingestPage } from "@/lib/storage";
import type { PageKind, PageSource } from "@/types";

type RouteContext = { params: Promise<{ id: string; pageNumber: string }> };

const KINDS: PageKind[] = ["drawing", "text", "table", "mixed"];

function tokenFrom(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("x-ingest-token")?.trim() ?? "";
}

function authorized(request: Request) {
  const expected = process.env.PTO_INGEST_TOKEN ?? "";
  if (!expected) return null;
  const provided = tokenFrom(request);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function PUT(request: Request, context: RouteContext) {
  const check = authorized(request);
  if (check === null) {
    return NextResponse.json(
      { error: "Сервисный ингест выключен: не задан PTO_INGEST_TOKEN" },
      { status: 503 },
    );
  }
  if (!check) {
    return NextResponse.json({ error: "Нужен токен ингеста" }, { status: 401 });
  }

  const { id, pageNumber } = await context.params;
  const page = Number(pageNumber);
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "Некорректный номер листа" }, { status: 400 });
  }

  const body = (await request.json()) as {
    markdown?: string;
    kind?: string;
    source?: string;
    warnings?: string[];
  };

  if (typeof body.markdown !== "string" || body.markdown.trim().length === 0) {
    return NextResponse.json({ error: "Нужно поле markdown" }, { status: 400 });
  }

  const document = await ingestPage({
    documentId: id,
    pageNumber: page,
    markdown: body.markdown,
    kind: KINDS.includes(body.kind as PageKind) ? (body.kind as PageKind) : undefined,
    source: body.source === "heuristic" ? "heuristic" : ("model" as PageSource),
    warnings: Array.isArray(body.warnings)
      ? body.warnings.filter((item) => typeof item === "string")
      : [],
  });

  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    pageNumber: page,
    readyPages: document.readyPages,
    pageCount: document.pageCount,
  });
}
