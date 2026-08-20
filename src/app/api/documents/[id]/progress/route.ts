import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { getPageProgress, savePageProgress } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const progress = await getPageProgress(id, user.id);
  if (!progress) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ progress });
}

export async function PUT(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const body = (await request.json()) as { viewed?: number[]; lastPage?: number };

  const progress = await savePageProgress(id, user.id, {
    viewed: Array.isArray(body.viewed) ? body.viewed : undefined,
    lastPage: typeof body.lastPage === "number" ? body.lastPage : undefined,
  });
  if (!progress) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  return NextResponse.json({ progress });
}
