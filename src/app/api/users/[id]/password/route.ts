import { NextResponse } from "next/server";
import { isPublicUser, requireAdmin } from "@/lib/auth";
import { resetUserPassword } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!isPublicUser(admin)) return admin;
  const { id } = await context.params;
  const body = (await request.json()) as { password?: string };

  try {
    const user = await resetUserPassword(id, body.password ?? "");
    return NextResponse.json({ user });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось сбросить пароль";
    return NextResponse.json({ error: message }, { status });
  }
}
