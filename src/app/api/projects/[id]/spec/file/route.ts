import { NextResponse } from "next/server";
import { getProject, readStoredPdf } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project?.specStoredName || !project.specOriginalName) {
    return NextResponse.json({ error: "ТЗ не загружено" }, { status: 404 });
  }

  try {
    const bytes = await readStoredPdf(project.specStoredName);
    const encoded = encodeURIComponent(project.specOriginalName);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл ТЗ отсутствует" }, { status: 404 });
  }
}
