import { NextResponse } from "next/server";
import { getDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  const pages = [...document.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const body =
    pages.length === 0
      ? `# ${document.originalName}\n\nТекст ещё не готов.\n`
      : pages.map((page) => page.markdown).join("\n\n---\n\n");
  const filename = document.originalName.replace(/\.pdf$/i, "") + ".md";
  const encoded = encodeURIComponent(filename);
  const ascii = filename.replace(/[^\u0020-\u007E]/g, "_") || "document.md";

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    },
  });
}
