import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hasDefaultAdminPassword } from "@/lib/storage";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  // На экране входа нужно знать, светить ли стартовый пароль.
  const defaultAdminPassword = await hasDefaultAdminPassword();
  return NextResponse.json({
    user,
    defaultAdminPassword:
      user?.role === "admin" || !user ? defaultAdminPassword : false,
  });
}
