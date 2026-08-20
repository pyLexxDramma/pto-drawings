import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { fetchPipelineHealth, mergePipelineUsage } from "@/lib/pipeline";
import { listDocuments } from "@/lib/storage";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const [health, documents] = await Promise.all([
    fetchPipelineHealth(),
    listDocuments(undefined, { lite: true }),
  ]);
  const usage = mergePipelineUsage(
    ...documents.map((doc) => doc.pipelineUsage),
  );
  return NextResponse.json(
    { ...health, usage },
    {
      headers: { "Cache-Control": "private, max-age=5" },
    },
  );
}
