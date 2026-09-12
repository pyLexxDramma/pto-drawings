import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { logEvent } from "@/lib/event-log";
import { parseEngineerRemarks } from "@/lib/reviews-import";
import { createReviews } from "@/lib/reviews";
import { getProject } from "@/lib/storage";
import { readCsvRows, readXlsxRows } from "@/lib/xlsx-read";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Приложите Excel или CSV (поле file)" },
      { status: 400 },
    );
  }

  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let rows: string[][];
  try {
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      rows = readCsvRows(new TextDecoder("utf-8").decode(bytes));
    } else {
      rows = readXlsxRows(bytes);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось прочитать файл";
    await logEvent({
      layer: "back",
      action: "импорт Excel инженера",
      ok: false,
      message,
      status: 400,
      document: file.name,
      userName: user.displayName,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const parsed = parseEngineerRemarks(rows);
  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error:
          "В файле нет замечаний. Нужна колонка «Замечание» или текст в первом столбце.",
      },
      { status: 400 },
    );
  }

  const result = await createReviews(id, parsed, {
    userId: user.id,
    userName: user.displayName,
  });
  await logEvent({
    layer: "back",
    action: "импорт Excel инженера",
    ok: true,
    message: `добавлено: ${result.added}, пропущено: ${result.skipped}`,
    document: file.name,
    userName: user.displayName,
  });
  return NextResponse.json(result, { status: 201 });
}
