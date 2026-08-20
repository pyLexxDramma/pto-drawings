import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hasDefaultAdminPassword } from "@/lib/storage";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const defaultAdminPassword =
    user?.role === "admin" ? await hasDefaultAdminPassword() : false;
  return NextResponse.json({ user, defaultAdminPassword });
}
