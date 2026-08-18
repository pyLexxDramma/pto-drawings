import { PDFDocument } from "pdf-lib";
import {
  blobConfigured,
  deletePdfBytes,
  readDbText,
  readPdfBytes,
  writeDbText,
  writePdfBytes,
} from "@/lib/persist";
import type {
  Database,
  DocumentPage,
  DocumentRecord,
  EditLogEntry,
  ProcessingStep,
  Project,
} from "@/types";

const DEFAULT_PROJECT_ID = "11111111-1111-4111-8111-111111111111";

let writeChain = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const emptyDb = (): Database => ({
  projects: [
    {
      id: DEFAULT_PROJECT_ID,
      name: "Объект 1",
      createdAt: new Date().toISOString(),
    },
  ],
  documents: [],
});

function normalizeDocument(raw: Partial<DocumentRecord> & { id: string }): DocumentRecord {
  return {
    id: raw.id,
    projectId: raw.projectId ?? "",
    originalName: raw.originalName ?? "document.pdf",
    storedName: raw.storedName ?? `${raw.id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: raw.sizeBytes ?? 0,
    pageCount: raw.pageCount ?? 0,
    status: (["queued", "processing", "done", "error"] as const).includes(
      raw.status as DocumentRecord["status"],
    )
      ? (raw.status as DocumentRecord["status"])
      : "queued",
    processingStep: raw.processingStep ?? null,
    processingPage: raw.processingPage ?? null,
    errorMessage: raw.errorMessage ?? null,
    pages: Array.isArray(raw.pages) ? raw.pages : [],
    editLog: Array.isArray(raw.editLog) ? raw.editLog : [],
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

async function readDb(): Promise<Database> {
  try {
    const raw = await readDbText();
    if (!raw) {
      const db = emptyDb();
      await writeDb(db);
      return db;
    }
    const parsed = JSON.parse(raw) as Database;
    if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.documents)) {
      return emptyDb();
    }
    parsed.documents = parsed.documents.map((doc) => normalizeDocument(doc));
    if (parsed.projects.length === 0) {
      const seed = emptyDb();
      parsed.projects = seed.projects;
      await writeDb(parsed);
    }
    return parsed;
  } catch {
    const db = emptyDb();
    await writeDb(db);
    return db;
  }
}

async function writeDb(db: Database) {
  await writeDbText(JSON.stringify(db, null, 2));
}

export async function listProjects(): Promise<Project[]> {
  return withLock(async () => {
    const db = await readDb();
    return db.projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function createProject(name: string): Promise<Project> {
  return withLock(async () => {
    const db = await readDb();
    const project: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    db.projects.push(project);
    await writeDb(db);
    return project;
  });
}

export async function renameProject(id: string, name: string): Promise<Project | null> {
  return withLock(async () => {
    const db = await readDb();
    const project = db.projects.find((item) => item.id === id);
    if (!project) return null;
    project.name = name.trim();
    await writeDb(db);
    return project;
  });
}

export async function listDocuments(
  projectId?: string,
): Promise<DocumentRecord[]> {
  return withLock(async () => {
    const db = await readDb();
    if (!process.env.VERCEL) {
      let changed = false;
      for (const record of db.documents) {
        if (record.status !== "done") continue;
        if (record.editLog.length > 0 || record.pages.length === 0) continue;
        const needsRebuild = record.pages.some(
          (page) => page.extractedText && !page.markdown.includes("**Файл:**"),
        );
        if (!needsRebuild) continue;
        const { pageToMarkdown } = await import("@/lib/extract");
        record.pages = record.pages.map((page) => {
          if (!page.extractedText) return page;
          return pageToMarkdown(
            page.pageNumber,
            record.originalName,
            page.extractedText,
          );
        });
        changed = true;
      }
      if (changed) await writeDb(db);
    }
    const items = projectId
      ? db.documents.filter((doc) => doc.projectId === projectId)
      : db.documents;
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  return withLock(async () => {
    const db = await readDb();
    const found = db.documents.find((doc) => doc.id === id);
    return found ? normalizeDocument(found) : null;
  });
}

export function assertStoredName(storedName: string) {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(storedName)) {
    throw new Error("Invalid path");
  }
}

export async function readStoredPdf(storedName: string) {
  assertStoredName(storedName);
  return readPdfBytes(storedName);
}

export async function savePdf(input: {
  projectId: string;
  originalName: string;
  buffer: Buffer;
}): Promise<DocumentRecord> {
  if (process.env.VERCEL && !blobConfigured()) {
    throw Object.assign(
      new Error(
        "На Vercel нет хранилища файлов. В проекте откройте Storage → Blob и создайте store.",
      ),
      { status: 503 },
    );
  }

  let pageCount = 0;
  try {
    const pdf = await PDFDocument.load(input.buffer, { ignoreEncryption: true });
    pageCount = pdf.getPageCount();
  } catch {
    throw Object.assign(new Error("Не удалось прочитать PDF"), { status: 400 });
  }

  return withLock(async () => {
    const db = await readDb();
    const project = db.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw Object.assign(new Error("Проект не найден"), { status: 404 });
    }

    const id = crypto.randomUUID();
    const storedName = `${id}.pdf`;
    await writePdfBytes(storedName, input.buffer);

    const record: DocumentRecord = {
      id,
      projectId: input.projectId,
      originalName: input.originalName,
      storedName,
      mimeType: "application/pdf",
      sizeBytes: input.buffer.byteLength,
      pageCount,
      status: "queued",
      processingStep: "queued",
      processingPage: null,
      errorMessage: null,
      pages: [],
      editLog: [],
      createdAt: new Date().toISOString(),
    };

    db.documents.push(record);
    await writeDb(db);
    return record;
  });
}

export type DocumentPatch = {
  status?: DocumentRecord["status"];
  processingStep?: ProcessingStep | null;
  processingPage?: number | null;
  errorMessage?: string | null;
  pageCount?: number;
  pages?: DocumentPage[];
};

export async function updateDocument(
  id: string,
  patch: DocumentPatch,
): Promise<DocumentRecord | null> {
  return withLock(async () => {
    const db = await readDb();
    const record = db.documents.find((doc) => doc.id === id);
    if (!record) return null;
    if (patch.status !== undefined) record.status = patch.status;
    if (patch.processingStep !== undefined) {
      record.processingStep = patch.processingStep;
    }
    if (patch.processingPage !== undefined) {
      record.processingPage = patch.processingPage;
    }
    if (patch.errorMessage !== undefined) record.errorMessage = patch.errorMessage;
    if (patch.pageCount !== undefined) record.pageCount = patch.pageCount;
    if (patch.pages !== undefined) record.pages = patch.pages;
    await writeDb(db);
    return record;
  });
}

export async function savePageMarkdown(
  id: string,
  pageNumber: number,
  markdown: string,
): Promise<DocumentRecord | null> {
  return withLock(async () => {
    const db = await readDb();
    const record = db.documents.find((doc) => doc.id === id);
    if (!record) return null;
    const page = record.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) return null;
    if (page.markdown === markdown) return record;

    const entry: EditLogEntry = {
      id: crypto.randomUUID(),
      pageNumber,
      before: page.markdown,
      after: markdown,
      createdAt: new Date().toISOString(),
    };
    page.markdown = markdown;
    record.editLog.unshift(entry);
    await writeDb(db);
    return record;
  });
}

export async function deleteDocument(id: string): Promise<boolean> {
  return withLock(async () => {
    const db = await readDb();
    const record = db.documents.find((doc) => doc.id === id);
    if (!record) return false;
    db.documents = db.documents.filter((doc) => doc.id !== id);
    await writeDb(db);
    await deletePdfBytes(record.storedName);
    return true;
  });
}
