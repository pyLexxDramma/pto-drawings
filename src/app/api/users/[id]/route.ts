import { NextResponse } from "next/server";
import { isPublicUser, requireAdmin } from "@/lib/auth";
import { setUserDisabled } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!isPublicUser(admin)) return admin;
  const { id } = await context.params;
  const body = (await request.json()) as { disabled?: boolean };

  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "Нужно поле disabled" }, { status: 400 });
  }
  if (body.disabled && id === admin.id) {
    return NextResponse.json({ error: "Нельзя отключить себя" }, { status: 400 });
  }

  try {
    const user = await setUserDisabled(id, body.disabled);
    return NextResponse.json({ user });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : "Не удалось обновить";
    return NextResponse.json({ error: message }, { status });
  }
}
