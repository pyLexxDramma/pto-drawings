import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { isPublicUser, requireUser } from "@/lib/auth";
import { savePdf, updateDocument } from "@/lib/storage";

export const maxDuration = 60;

const DEMO_MARKDOWN = `# Демо-лист · План этажа (пример)

> Это готовый разбор без вызова модели. Можно листать, править текст и ставить замечания.

## Основные данные

| Параметр | Значение |
| --- | --- |
| Объект | Демо-комплект ПТО |
| Марка | АР |
| Лист | 1 |
| Масштаб | 1:100 |

## Состав

1. Оси 1–5, А–Г
2. Помещения: холл, коридор, кабинеты
3. Примечание: размеры условные

## Текст штампа

Организация: ПТО Demo  
Стадия: РД  
Инв. №: DEMO-001
`;

async function buildDemoPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 36,
    y: 36,
    width: 523,
    height: 770,
    borderColor: rgb(0.15, 0.2, 0.3),
    borderWidth: 1.2,
  });

  page.drawText("PTO DEMO", {
    x: 56,
    y: 760,
    size: 22,
    font: bold,
    color: rgb(0.12, 0.25, 0.55),
  });
  page.drawText("Plan / Demo sheet (no AI)", {
    x: 56,
    y: 732,
    size: 12,
    font,
    color: rgb(0.3, 0.35, 0.4),
  });

  // условная сетка «чертежа»
  for (let i = 0; i < 5; i++) {
    const x = 80 + i * 90;
    page.drawLine({
      start: { x, y: 160 },
      end: { x, y: 680 },
      thickness: 0.6,
      color: rgb(0.55, 0.62, 0.72),
    });
  }
  for (let j = 0; j < 4; j++) {
    const y = 200 + j * 120;
    page.drawLine({
      start: { x: 70, y },
      end: { x: 520, y },
      thickness: 0.6,
      color: rgb(0.55, 0.62, 0.72),
    });
  }

  page.drawRectangle({
    x: 120,
    y: 320,
    width: 280,
    height: 160,
    borderColor: rgb(0.2, 0.35, 0.6),
    borderWidth: 1.5,
  });
  page.drawText("Room A", {
    x: 210,
    y: 390,
    size: 14,
    font,
    color: rgb(0.15, 0.2, 0.3),
  });

  page.drawText("Stamp: DEMO-001  |  Scale 1:100  |  Sheet 1", {
    x: 56,
    y: 70,
    size: 10,
    font,
    color: rgb(0.25, 0.3, 0.35),
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/** Создаёт демо-PDF с уже готовым markdown — без вызова модели. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
  };
  const projectId = body.projectId?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "Не выбран проект" }, { status: 400 });
  }

  try {
    const buffer = await buildDemoPdf();
    const created = await savePdf({
      projectId,
      originalName: "demo-лист-pto.pdf",
      buffer,
    });

    const document = await updateDocument(created.id, {
      status: "done",
      processingStep: "done",
      processingPage: null,
      errorMessage: null,
      pageCount: 1,
      pipelineMode: "mock",
      pipelineElapsedSec: 0,
      pipelineUsage: {},
      pages: [
        {
          pageNumber: 1,
          kind: "drawing",
          markdown: DEMO_MARKDOWN,
          extractedText: "PTO DEMO Plan Room A DEMO-001",
          source: "heuristic",
          warnings: ["Демо-разбор без модели"],
        },
      ],
    });

    if (!document) {
      return NextResponse.json(
        { error: "Не удалось подготовить демо" },
        { status: 500 },
      );
    }

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось создать демо";
    return NextResponse.json({ error: message }, { status });
  }
}
