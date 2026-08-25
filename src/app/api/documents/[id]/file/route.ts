import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { getDocument, readStoredPdf } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
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
        "Content-Type": document.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл отсутствует в хранилище" }, { status: 404 });
  }
}
