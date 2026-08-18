import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { processDocument } from "@/lib/process-document";
import { getDocument, updateDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  await updateDocument(id, {
    status: "queued",
    processingStep: "queued",
    processingPage: null,
    errorMessage: null,
  });
  waitUntil(processDocument(id));
  const queued = await getDocument(id);
  return NextResponse.json({ document: queued });
}
