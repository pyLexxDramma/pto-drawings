import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { fetchPipelineHealth } from "@/lib/pipeline";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const health = await fetchPipelineHealth();
  return NextResponse.json(health, {
    headers: { "Cache-Control": "private, max-age=5" },
  });
}
