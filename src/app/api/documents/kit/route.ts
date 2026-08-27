import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { resolveDisplayName } from "@/lib/drawing-files";
import {
  extractDrawingKitFromZip,
  isZipFile,
  kitLabelFromName,
} from "@/lib/drawing-kit";
import { activeDocumentIds, processDocument } from "@/lib/process-document";
import { listDocuments, resetStuckDocuments, saveDocumentKit } from "@/lib/storage";

export const maxDuration = 120;

const MAX_BYTES = 80 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const titleRaw = String(form.get("title") ?? "").trim();

  if (!projectId) {
    return NextResponse.json({ error: "Не выбран проект" }, { status: 400 });
  }

  const zip = form.get("archive");
  const pdfFile = form.get("pdf");
  const cadFile = form.get("cad");

  let kitLabel = titleRaw;
  let pdf: { originalName: string; buffer: Buffer };
  let cad: { originalName: string; buffer: Buffer; ext: "dwg" | "dxf" };

  try {
    if (zip instanceof File && isZipFile(zip)) {
      if (zip.size > MAX_BYTES) {
        return NextResponse.json({ error: "Архив больше 80 МБ" }, { status: 400 });
      }
      if (!kitLabel) kitLabel = kitLabelFromName(zip.name);
      const extracted = extractDrawingKitFromZip(Buffer.from(await zip.arrayBuffer()));
      pdf = {
        originalName: resolveDisplayName(kitLabel, extracted.pdf.name),
        buffer: extracted.pdf.buffer,
      };
      cad = {
        originalName: extracted.cad.name,
        buffer: extracted.cad.buffer,
        ext: extracted.cad.ext,
      };
    } else if (pdfFile instanceof File && cadFile instanceof File) {
      const pdfExt = pdfFile.name.toLowerCase().endsWith(".pdf");
      const cadName = cadFile.name.toLowerCase();
      const cadExt = cadName.endsWith(".dwg")
        ? "dwg"
        : cadName.endsWith(".dxf")
          ? "dxf"
          : null;
      if (!pdfExt || !cadExt) {
        return NextResponse.json(
          { error: "Нужны PDF и DWG/DXF" },
          { status: 400 },
        );
      }
      if (pdfFile.size + cadFile.size > MAX_BYTES) {
        return NextResponse.json(
          { error: "Суммарный размер больше 80 МБ" },
          { status: 400 },
        );
      }
      if (!kitLabel) kitLabel = kitLabelFromName(pdfFile.name);
      pdf = {
        originalName: resolveDisplayName(kitLabel, pdfFile.name),
        buffer: Buffer.from(await pdfFile.arrayBuffer()),
      };
      cad = {
        originalName: cadFile.name,
        buffer: Buffer.from(await cadFile.arrayBuffer()),
        ext: cadExt,
      };
    } else {
      return NextResponse.json(
        {
          error:
            "Передайте ZIP-архив (поле archive) или пару PDF + DWG (поля pdf и cad)",
        },
        { status: 400 },
      );
    }

    const result = await saveDocumentKit({
      projectId,
      kitLabel,
      pdf,
      cad,
    });

    runInBackground(processDocument(result.pdf.id));
    runInBackground(processDocument(result.cad.id));

    return NextResponse.json(
      {
        kitId: result.kitId,
        kitLabel,
        documents: [result.pdf, result.cad],
        primaryDocumentId: result.pdf.id,
      },
      { status: 201 },
    );
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message =
      error instanceof Error ? error.message : "Не удалось сохранить комплект";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  await resetStuckDocuments(activeDocumentIds());
  const documents = await listDocuments(projectId, { lite: true });
  const kits = new Map<
    string,
    { kitId: string; kitLabel: string; pdfId: string | null; cadId: string | null }
  >();
  for (const doc of documents) {
    if (!doc.kitId) continue;
    let entry = kits.get(doc.kitId);
    if (!entry) {
      entry = {
        kitId: doc.kitId,
        kitLabel: doc.kitLabel ?? doc.originalName,
        pdfId: null,
        cadId: null,
      };
      kits.set(doc.kitId, entry);
    }
    if (doc.kitRole === "pdf") entry.pdfId = doc.id;
    else if (doc.kitRole === "dwg" || doc.kitRole === "dxf") entry.cadId = doc.id;
  }
  return NextResponse.json({ kits: [...kits.values()] });
}
