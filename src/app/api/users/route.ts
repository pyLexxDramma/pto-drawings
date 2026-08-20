import { NextResponse } from "next/server";
import { assertRole, isPublicUser, requireAdmin } from "@/lib/auth";
import { createUser, listUsers } from "@/lib/storage";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!isPublicUser(admin)) return admin;
  const users = await listUsers();
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!isPublicUser(admin)) return admin;

  const body = (await request.json()) as {
    login?: string;
    displayName?: string;
    role?: string;
    password?: string;
  };

  try {
    const user = await createUser({
      login: body.login ?? "",
      displayName: body.displayName ?? "",
      role: assertRole(body.role),
      password: body.password ?? "",
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось создать пользователя";
    return NextResponse.json({ error: message }, { status });
  }
}
