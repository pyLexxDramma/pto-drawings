import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { cancelDocument } from "@/lib/process-document";
import { getDocument } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status !== "queued" && document.status !== "processing") {
    return NextResponse.json(
      { error: "Документ сейчас не обрабатывается", document },
      { status: 409 },
    );
  }

  try {
    const updated = await cancelDocument(id);
    return NextResponse.json({ document: updated ?? (await getDocument(id)) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось отменить обработку";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
