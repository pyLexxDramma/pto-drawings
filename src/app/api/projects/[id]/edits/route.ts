import { NextResponse } from "next/server";
import { getProject, listProjectEdits } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  const edits = await listProjectEdits(id);
  return NextResponse.json({ edits });
}
