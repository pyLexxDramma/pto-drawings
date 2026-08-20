import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { updateProject } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string; description?: string };
  const name = body.name?.trim();
  if (body.name !== undefined && !name) {
    return NextResponse.json({ error: "Укажите название" }, { status: 400 });
  }
  const project = await updateProject(id, {
    name,
    description: body.description !== undefined ? body.description : undefined,
  });
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
