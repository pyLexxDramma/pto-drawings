import { NextResponse } from "next/server";
import { renameProject } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Укажите название" }, { status: 400 });
  }
  const project = await renameProject(id, name);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
