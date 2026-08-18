import { NextResponse } from "next/server";
import { getDocument, readStoredPdf } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  try {
    const bytes = await readStoredPdf(document.storedName);
    const encoded = encodeURIComponent(document.originalName);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл отсутствует в хранилище" }, { status: 404 });
  }
}
