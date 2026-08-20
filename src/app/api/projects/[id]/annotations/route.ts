import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { getProject, listProjectAnnotations } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  const annotations = await listProjectAnnotations(id);
  return NextResponse.json({ annotations });
}
