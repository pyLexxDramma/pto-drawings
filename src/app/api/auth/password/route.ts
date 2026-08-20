import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { changeOwnPassword } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;

  const body = (await request.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };

  try {
    const updated = await changeOwnPassword(
      user.id,
      body.currentPassword ?? "",
      body.newPassword ?? "",
    );
    return NextResponse.json({ user: updated });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось сменить пароль";
    return NextResponse.json({ error: message }, { status });
  }
}
