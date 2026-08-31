import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { getDrawingExt, isOfficeExt } from "@/lib/drawing-files";
import { processDocument } from "@/lib/process-document";
import { getDocument, updateDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (isOfficeExt(getDrawingExt(document.originalName))) {
    return NextResponse.json(
      { error: "Word-документ уже разобран при загрузке — повтор не нужен" },
      { status: 400 },
    );
  }

  await updateDocument(id, {
    status: "queued",
    processingStep: "queued",
    processingPage: null,
    errorMessage: null,
    pipelineFinishedAt: null,
    pipelineElapsedSec: null,
  });
  runInBackground(processDocument(id));
  const queued = await getDocument(id);
  return NextResponse.json({ document: queued });
}
