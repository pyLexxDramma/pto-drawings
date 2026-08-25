import { PDFDocument } from "pdf-lib";
import {
  getDrawingExt,
  mimeForExt,
} from "@/lib/drawing-files";
import {
  deleteDocumentFile,
  deletePdfBytes,
  listStoredDocumentIds,
  readDbText,
  readDocumentText,
  readPdfBytes,
  storedPdfExists,
  withDataLock,
  writeDbText,
  writeDocumentText,
  writePdfBytes,
} from "@/lib/persist";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import {
  emptyKindCounts,
  type AnnotationRect,
  type Database,
  type DocumentBody,
  type DocumentMeta,
  type DocumentPage,
  type DocumentRecord,
  type EditLogEntry,
  type KindCounts,
  type PageAnnotation,
  type PageKind,
  type PageProgress,
  type PageSource,
  type ProcessingStep,
  type Project,
  type ProjectAnnotation,
  type ProjectEdit,
  type PublicUser,
  type SearchHit,
  type User,
  type UserRole,
} from "@/types";

const DEFAULT_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const DEFAULT_ADMIN_LOGIN = "admin";
export const DEFAULT_ADMIN_PASSWORD = "admin123";

const STUCK_AFTER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- нормализация

function seedAdminUser(): User {
  return {
    id: DEFAULT_ADMIN_ID,
    login: DEFAULT_ADMIN_LOGIN,
    displayName: "Админ",
    role: "admin",
    passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
    disabled: false,
    createdAt: new Date().toISOString(),
  };
}

const emptyDb = (): Database => ({
  users: [seedAdminUser()],
  projects: [
    {
      id: DEFAULT_PROJECT_ID,
      name: "Объект 1",
      description: "",
      specStoredName: null,
      specOriginalName: null,
      createdAt: new Date().toISOString(),
    },
  ],
  documents: [],
});

const emptyBody = (): DocumentBody => ({
  pages: [],
  editLog: [],
  annotations: [],
  progress: {},
});

function normalizeUser(raw: Partial<User> & { id: string }): User | null {
  if (!raw.login || !raw.passwordHash) return null;
  return {
    id: raw.id,
    login: raw.login,
    displayName: raw.displayName ?? raw.login,
    role: raw.role === "admin" ? "admin" : "engineer",
    passwordHash: raw.passwordHash,
    disabled: raw.disabled === true,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

function normalizeProject(raw: Partial<Project> & { id: string }): Project {
  return {
    id: raw.id,
    name: raw.name ?? "Проект",
    description: raw.description ?? "",
    specStoredName: raw.specStoredName ?? null,
    specOriginalName: raw.specOriginalName ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

function normalizeEditLog(raw: Partial<EditLogEntry> & { id: string }): EditLogEntry {
  return {
    id: raw.id,
    pageNumber: raw.pageNumber ?? 1,
    before: raw.before ?? "",
    after: raw.after ?? "",
    createdAt: raw.createdAt ?? new Date().toISOString(),
    userId: raw.userId ?? null,
    userName: raw.userName ?? null,
  };
}

function normalizePage(raw: Partial<DocumentPage> & { pageNumber: number }): DocumentPage {
  const kinds: PageKind[] = ["drawing", "text", "table", "mixed"];
  return {
    pageNumber: raw.pageNumber,
    kind: kinds.includes(raw.kind as PageKind) ? (raw.kind as PageKind) : "text",
    markdown: raw.markdown ?? "",
    extractedText: raw.extractedText ?? "",
    source: raw.source === "model" ? "model" : "heuristic",
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((item) => Boolean(item)) : [],
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeRect(raw: Partial<AnnotationRect> | undefined): AnnotationRect {
  const x = clamp01(Number(raw?.x ?? 0));
  const y = clamp01(Number(raw?.y ?? 0));
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0.004, Number(raw?.w ?? 0.05) || 0.05)),
    h: Math.min(1 - y, Math.max(0.004, Number(raw?.h ?? 0.05) || 0.05)),
  };
}

function normalizeAnnotation(
  raw: Partial<PageAnnotation> & { id: string },
): PageAnnotation {
  return {
    id: raw.id,
    pageNumber: raw.pageNumber ?? 1,
    rect: normalizeRect(raw.rect),
    comment: raw.comment ?? "",
    expected: raw.expected ?? "",
    status: raw.status === "fixed" ? "fixed" : "open",
    userId: raw.userId ?? null,
    userName: raw.userName ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    resolvedAt: raw.resolvedAt ?? null,
  };
}

function normalizeProgress(raw: unknown): Record<string, PageProgress> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, PageProgress> = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<PageProgress>;
    const viewed = Array.isArray(entry?.viewed)
      ? entry.viewed.filter((page) => Number.isInteger(page) && page > 0)
      : [];
    result[userId] = {
      viewed: [...new Set(viewed)].sort((a, b) => a - b),
      lastPage:
        Number.isInteger(entry?.lastPage) && (entry?.lastPage ?? 0) > 0
          ? (entry!.lastPage as number)
          : 1,
      updatedAt: entry?.updatedAt ?? new Date().toISOString(),
    };
  }
  return result;
}

function countKinds(pages: DocumentPage[]): KindCounts {
  const counts = emptyKindCounts();
  for (const page of pages) counts[page.kind] += 1;
  return counts;
}

function normalizeBody(raw: Partial<DocumentBody> | null): DocumentBody {
  if (!raw) return emptyBody();
  return {
    pages: Array.isArray(raw.pages)
      ? raw.pages.map((page) =>
          normalizePage(page as Partial<DocumentPage> & { pageNumber: number }),
        )
      : [],
    editLog: Array.isArray(raw.editLog)
      ? raw.editLog.map((entry) =>
          normalizeEditLog(entry as Partial<EditLogEntry> & { id: string }),
        )
      : [],
    annotations: Array.isArray(raw.annotations)
      ? raw.annotations.map((entry) =>
          normalizeAnnotation(entry as Partial<PageAnnotation> & { id: string }),
        )
      : [],
    progress: normalizeProgress(raw.progress),
  };
}

function normalizeMeta(raw: Partial<DocumentMeta> & { id: string }): DocumentMeta {
  const statuses = ["queued", "processing", "done", "error"] as const;
  return {
    id: raw.id,
    projectId: raw.projectId ?? "",
    originalName: raw.originalName ?? "document.pdf",
    storedName: raw.storedName ?? `${raw.id}.pdf`,
    mimeType: raw.mimeType ?? "application/pdf",
    sizeBytes: raw.sizeBytes ?? 0,
    pageCount: raw.pageCount ?? 0,
    status: statuses.includes(raw.status as DocumentMeta["status"])
      ? (raw.status as DocumentMeta["status"])
      : "queued",
    processingStep: raw.processingStep ?? null,
    processingPage: raw.processingPage ?? null,
    errorMessage: raw.errorMessage ?? null,
    readyPages: raw.readyPages ?? 0,
    kindCounts: { ...emptyKindCounts(), ...(raw.kindCounts ?? {}) },
    openAnnotations: raw.openAnnotations ?? 0,
    viewedCounts: raw.viewedCounts ?? {},
    pipelineMode:
      raw.pipelineMode === "mock" || raw.pipelineMode === "real"
        ? raw.pipelineMode
        : null,
    pipelineElapsedSec:
      typeof raw.pipelineElapsedSec === "number" ? raw.pipelineElapsedSec : null,
    pipelineFinishedAt:
      typeof raw.pipelineFinishedAt === "string" && raw.pipelineFinishedAt
        ? raw.pipelineFinishedAt
        : null,
    pipelineUsage:
      raw.pipelineUsage && typeof raw.pipelineUsage === "object"
        ? Object.fromEntries(
            Object.entries(raw.pipelineUsage).filter(
              ([, value]) => typeof value === "number",
            ),
          )
        : {},
    pageErrors:
      raw.pageErrors && typeof raw.pageErrors === "object"
        ? Object.fromEntries(
            Object.entries(raw.pageErrors).filter(
              ([, value]) => typeof value === "string",
            ),
          )
        : {},
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

function applyBodyToMeta(meta: DocumentMeta, body: DocumentBody) {
  meta.readyPages = body.pages.length;
  meta.kindCounts = countKinds(body.pages);
  meta.openAnnotations = body.annotations.filter((item) => item.status === "open").length;
  meta.viewedCounts = Object.fromEntries(
    Object.entries(body.progress).map(([userId, progress]) => [
      userId,
      progress.viewed.length,
    ]),
  );
}

function merge(meta: DocumentMeta, body: DocumentBody): DocumentRecord {
  return { ...meta, ...body };
}

function liteRecord(meta: DocumentMeta): DocumentRecord {
  return merge(meta, emptyBody());
}

// ------------------------------------------------------------------- инвентарь

type LegacyDocument = Partial<DocumentMeta> & Partial<DocumentBody> & { id: string };

async function readBody(id: string): Promise<DocumentBody> {
  const raw = await readDocumentText(id);
  if (!raw) return emptyBody();
  try {
    return normalizeBody(JSON.parse(raw) as Partial<DocumentBody>);
  } catch {
    return emptyBody();
  }
}

async function writeBody(id: string, body: DocumentBody) {
  await writeDocumentText(id, JSON.stringify(body));
}

async function writeIndex(db: Database) {
  await writeDbText(JSON.stringify(db, null, 2));
}

async function readIndex(): Promise<Database> {
  const raw = await readDbText();
  if (!raw) {
    const db = emptyDb();
    await writeIndex(db);
    return db;
  }

  let parsed: Partial<Database> & { documents?: LegacyDocument[] };
  try {
    parsed = JSON.parse(raw) as Partial<Database> & { documents?: LegacyDocument[] };
  } catch {
    // Раньше здесь писали пустую базу — из-за этого пропадали все файлы.
    throw new Error("data/db.json повреждён, индекс не перезаписываю");
  }

  let changed = false;
  const documents: DocumentMeta[] = [];

  for (const item of Array.isArray(parsed.documents) ? parsed.documents : []) {
    if (!item?.id) continue;
    const meta = normalizeMeta(item);
    // Старый формат держал страницы и журнал внутри индекса — раскладываем по файлам.
    const inlineBody = Array.isArray(item.pages) || Array.isArray(item.editLog);
    if (inlineBody) {
      const body = normalizeBody(item);
      await writeBody(meta.id, body);
      applyBodyToMeta(meta, body);
      changed = true;
    }
    documents.push(meta);
  }

  const users = (Array.isArray(parsed.users) ? parsed.users : [])
    .map((user) => normalizeUser(user as Partial<User> & { id: string }))
    .filter((user): user is User => Boolean(user));
  if (users.length === 0) {
    users.push(seedAdminUser());
    changed = true;
  }

  let projects: Project[];
  if (!Array.isArray(parsed.projects)) {
    // Старые базы без поля projects — один раз засеем дефолт.
    projects = emptyDb().projects;
    changed = true;
  } else {
    // Пустой список валиден: пользователь удалил все проекты.
    projects = parsed.projects.map((project) =>
      normalizeProject(project as Partial<Project> & { id: string }),
    );
  }

  const known = new Set(documents.map((item) => item.id));
  const fallbackProject = projects[0]?.id ?? DEFAULT_PROJECT_ID;
  for (const id of await listStoredDocumentIds()) {
    if (known.has(id)) continue;
    const body = await readBody(id);
    const storedName = `${id}.pdf`;
    const hasPdf = await storedPdfExists(storedName);
    if (!hasPdf && body.pages.length === 0) continue;
    const fromMarkdown = body.pages[0]?.markdown.match(/`([^`]+\.pdf)`/i)?.[1];
    const meta = normalizeMeta({
      id,
      projectId: fallbackProject,
      originalName: fromMarkdown ?? storedName,
      storedName,
      pageCount: body.pages.length,
      status: body.pages.length > 0 ? "done" : "queued",
      processingStep: body.pages.length > 0 ? "done" : "queued",
    });
    applyBodyToMeta(meta, body);
    documents.push(meta);
    changed = true;
  }

  const db: Database = { users, projects, documents };
  if (changed) await writeIndex(db);
  return db;
}

function findMeta(db: Database, id: string) {
  return db.documents.find((doc) => doc.id === id) ?? null;
}

// -------------------------------------------------------------------- проекты

export async function listProjects(): Promise<Project[]> {
  return withDataLock(async () => {
    const db = await readIndex();
    return [...db.projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function createProject(name: string, description = ""): Promise<Project> {
  return withDataLock(async () => {
    const db = await readIndex();
    const project: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      specStoredName: null,
      specOriginalName: null,
      createdAt: new Date().toISOString(),
    };
    db.projects.push(project);
    await writeIndex(db);
    return project;
  });
}

export async function updateProject(
  id: string,
  patch: { name?: string; description?: string },
): Promise<Project | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const project = db.projects.find((item) => item.id === id);
    if (!project) return null;
    if (patch.name !== undefined) project.name = patch.name.trim();
    if (patch.description !== undefined) project.description = patch.description;
    await writeIndex(db);
    return project;
  });
}

export async function renameProject(id: string, name: string): Promise<Project | null> {
  return updateProject(id, { name });
}

export async function getProject(id: string): Promise<Project | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    return db.projects.find((item) => item.id === id) ?? null;
  });
}

export async function saveProjectSpec(input: {
  projectId: string;
  originalName: string;
  buffer: Buffer;
}): Promise<Project | null> {
  try {
    await PDFDocument.load(input.buffer, { ignoreEncryption: true });
  } catch {
    throw Object.assign(new Error("Не удалось прочитать PDF"), { status: 400 });
  }

  return withDataLock(async () => {
    const db = await readIndex();
    const project = db.projects.find((item) => item.id === input.projectId);
    if (!project) return null;
    const storedName = `spec-${project.id}.pdf`;
    if (project.specStoredName && project.specStoredName !== storedName) {
      await deletePdfBytes(project.specStoredName);
    }
    await writePdfBytes(storedName, input.buffer);
    project.specStoredName = storedName;
    project.specOriginalName = input.originalName;
    await writeIndex(db);
    return project;
  });
}

export async function clearProjectSpec(id: string): Promise<Project | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const project = db.projects.find((item) => item.id === id);
    if (!project) return null;
    if (project.specStoredName) await deletePdfBytes(project.specStoredName);
    project.specStoredName = null;
    project.specOriginalName = null;
    await writeIndex(db);
    return project;
  });
}

export async function deleteProject(id: string): Promise<boolean> {
  return withDataLock(async () => {
    const db = await readIndex();
    const project = db.projects.find((item) => item.id === id);
    if (!project) return false;

    const docs = db.documents.filter((doc) => doc.projectId === id);
    for (const meta of docs) {
      await deleteDocumentFile(meta.id);
      await deletePdfBytes(meta.storedName);
    }
    if (project.specStoredName) await deletePdfBytes(project.specStoredName);

    db.documents = db.documents.filter((doc) => doc.projectId !== id);
    db.projects = db.projects.filter((item) => item.id !== id);
    await writeIndex(db);
    return true;
  });
}

export async function listProjectEdits(projectId: string): Promise<ProjectEdit[]> {
  return withDataLock(async () => {
    const db = await readIndex();
    const edits: ProjectEdit[] = [];
    for (const meta of db.documents) {
      if (meta.projectId !== projectId) continue;
      const body = await readBody(meta.id);
      for (const entry of body.editLog) {
        edits.push({
          id: entry.id,
          documentId: meta.id,
          originalName: meta.originalName,
          pageNumber: entry.pageNumber,
          createdAt: entry.createdAt,
          userId: entry.userId,
          userName: entry.userName,
        });
      }
    }
    return edits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function listProjectAnnotations(
  projectId: string,
): Promise<ProjectAnnotation[]> {
  return withDataLock(async () => {
    const db = await readIndex();
    const items: ProjectAnnotation[] = [];
    for (const meta of db.documents) {
      if (meta.projectId !== projectId) continue;
      const body = await readBody(meta.id);
      for (const entry of body.annotations) {
        items.push({ ...entry, documentId: meta.id, originalName: meta.originalName });
      }
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

function snippetAround(text: string, needle: string) {
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return "";
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + needle.length + 60);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

export async function searchProject(
  projectId: string,
  query: string,
  limit = 60,
): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  return withDataLock(async () => {
    const db = await readIndex();
    const hits: SearchHit[] = [];
    for (const meta of db.documents) {
      if (meta.projectId !== projectId) continue;
      const body = await readBody(meta.id);
      for (const page of body.pages) {
        if (hits.length >= limit) return hits;
        const haystack = `${page.markdown}\n${page.extractedText}`;
        if (!haystack.toLowerCase().includes(needle)) continue;
        hits.push({
          documentId: meta.id,
          originalName: meta.originalName,
          pageNumber: page.pageNumber,
          kind: page.kind,
          snippet: snippetAround(haystack, needle),
        });
      }
    }
    return hits;
  });
}

// ---------------------------------------------------------------- пользователи

export async function listUsers(): Promise<PublicUser[]> {
  return withDataLock(async () => {
    const db = await readIndex();
    return db.users
      .map(toPublicUser)
      .sort((a, b) => a.login.localeCompare(b.login, "ru"));
  });
}

export async function getUserById(id: string): Promise<User | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    return db.users.find((user) => user.id === id) ?? null;
  });
}

export async function getUserByLogin(login: string): Promise<User | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const needle = login.trim().toLowerCase();
    return db.users.find((user) => user.login.toLowerCase() === needle) ?? null;
  });
}

export async function verifyLogin(
  login: string,
  password: string,
): Promise<PublicUser | null> {
  const user = await getUserByLogin(login);
  if (!user || user.disabled) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return toPublicUser(user);
}

function assertPassword(password: string) {
  if (password.length < 6) {
    throw Object.assign(new Error("Пароль не короче 6 символов"), { status: 400 });
  }
}

export async function createUser(input: {
  login: string;
  displayName: string;
  role: UserRole;
  password: string;
}): Promise<PublicUser> {
  const login = input.login.trim().toLowerCase();
  const displayName = input.displayName.trim() || login;
  if (!login || !input.password) {
    throw Object.assign(new Error("Укажите логин и пароль"), { status: 400 });
  }
  if (!/^[a-z0-9._-]{2,32}$/i.test(login)) {
    throw Object.assign(new Error("Логин: 2–32 символа, латиница, цифры, ._-"), {
      status: 400,
    });
  }
  assertPassword(input.password);

  return withDataLock(async () => {
    const db = await readIndex();
    if (db.users.some((user) => user.login.toLowerCase() === login)) {
      throw Object.assign(new Error("Такой логин уже есть"), { status: 409 });
    }
    const user: User = {
      id: crypto.randomUUID(),
      login,
      displayName,
      role: input.role === "admin" ? "admin" : "engineer",
      passwordHash: hashPassword(input.password),
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    await writeIndex(db);
    return toPublicUser(user);
  });
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<PublicUser> {
  assertPassword(nextPassword);
  return withDataLock(async () => {
    const db = await readIndex();
    const user = db.users.find((item) => item.id === userId);
    if (!user) throw Object.assign(new Error("Пользователь не найден"), { status: 404 });
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw Object.assign(new Error("Текущий пароль неверный"), { status: 400 });
    }
    user.passwordHash = hashPassword(nextPassword);
    await writeIndex(db);
    return toPublicUser(user);
  });
}

export async function resetUserPassword(
  userId: string,
  nextPassword: string,
): Promise<PublicUser> {
  assertPassword(nextPassword);
  return withDataLock(async () => {
    const db = await readIndex();
    const user = db.users.find((item) => item.id === userId);
    if (!user) throw Object.assign(new Error("Пользователь не найден"), { status: 404 });
    user.passwordHash = hashPassword(nextPassword);
    await writeIndex(db);
    return toPublicUser(user);
  });
}

export async function setUserDisabled(
  userId: string,
  disabled: boolean,
): Promise<PublicUser> {
  return withDataLock(async () => {
    const db = await readIndex();
    const user = db.users.find((item) => item.id === userId);
    if (!user) throw Object.assign(new Error("Пользователь не найден"), { status: 404 });
    if (disabled && user.role === "admin") {
      const activeAdmins = db.users.filter(
        (item) => item.role === "admin" && !item.disabled && item.id !== userId,
      );
      if (activeAdmins.length === 0) {
        throw Object.assign(new Error("Нужен хотя бы один активный админ"), {
          status: 400,
        });
      }
    }
    user.disabled = disabled;
    await writeIndex(db);
    return toPublicUser(user);
  });
}

/** Подсказка для баннера: дефолтный пароль админа всё ещё не сменили. */
export async function hasDefaultAdminPassword(): Promise<boolean> {
  const admin = await getUserByLogin(DEFAULT_ADMIN_LOGIN);
  if (!admin) return false;
  return verifyPassword(DEFAULT_ADMIN_PASSWORD, admin.passwordHash);
}

// ---------------------------------------------------------------- документы

export function assertStoredName(storedName: string) {
  if (!/^((spec-)?[0-9a-f-]{36})\.(pdf|dwg|dxf)$/i.test(storedName)) {
    throw new Error("Invalid path");
  }
}

export async function readStoredPdf(storedName: string) {
  assertStoredName(storedName);
  return readPdfBytes(storedName);
}

/** Сохранить чертёж: PDF (с pageCount) или CAD DWG/DXF (без pdf-lib). */
export async function saveDocument(input: {
  projectId: string;
  originalName: string;
  buffer: Buffer;
}): Promise<DocumentRecord> {
  const ext = getDrawingExt(input.originalName);
  if (!ext) {
    throw Object.assign(new Error("Нужен файл .pdf, .dwg или .dxf"), {
      status: 400,
    });
  }

  let pageCount = 0;
  if (ext === "pdf") {
    try {
      const pdf = await PDFDocument.load(input.buffer, {
        ignoreEncryption: true,
      });
      pageCount = pdf.getPageCount();
    } catch {
      throw Object.assign(new Error("Не удалось прочитать PDF"), { status: 400 });
    }
  }

  return withDataLock(async () => {
    const db = await readIndex();
    const project = db.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw Object.assign(new Error("Проект не найден"), { status: 404 });
    }

    const id = crypto.randomUUID();
    const storedName = `${id}.${ext}`;
    await writePdfBytes(storedName, input.buffer);

    const meta: DocumentMeta = {
      id,
      projectId: input.projectId,
      originalName: input.originalName,
      storedName,
      mimeType: mimeForExt(ext),
      sizeBytes: input.buffer.byteLength,
      pageCount,
      status: "queued",
      processingStep: "queued",
      processingPage: null,
      errorMessage: null,
      readyPages: 0,
      kindCounts: emptyKindCounts(),
      openAnnotations: 0,
      viewedCounts: {},
      pipelineMode: null,
      pipelineElapsedSec: null,
      pipelineFinishedAt: null,
      pipelineUsage: {},
      pageErrors: {},
      createdAt: new Date().toISOString(),
    };

    db.documents.push(meta);
    await writeIndex(db);
    await writeBody(id, emptyBody());
    return liteRecord(meta);
  });
}

/** @deprecated используйте saveDocument */
export async function savePdf(input: {
  projectId: string;
  originalName: string;
  buffer: Buffer;
}): Promise<DocumentRecord> {
  return saveDocument(input);
}

export async function listDocuments(
  projectId?: string,
  options?: { lite?: boolean },
): Promise<DocumentRecord[]> {
  return withDataLock(async () => {
    const db = await readIndex();
    const items = projectId
      ? db.documents.filter((doc) => doc.projectId === projectId)
      : db.documents;
    const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (options?.lite !== false) return sorted.map(liteRecord);
    const full: DocumentRecord[] = [];
    for (const meta of sorted) full.push(merge(meta, await readBody(meta.id)));
    return full;
  });
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, id);
    if (!meta) return null;
    return merge(meta, await readBody(id));
  });
}

export type DocumentPatch = {
  status?: DocumentMeta["status"];
  processingStep?: ProcessingStep | null;
  processingPage?: number | null;
  errorMessage?: string | null;
  pageCount?: number;
  pages?: DocumentPage[];
  pipelineMode?: DocumentMeta["pipelineMode"];
  pipelineElapsedSec?: number | null;
  pipelineFinishedAt?: string | null;
  pipelineUsage?: Record<string, number>;
  pageErrors?: Record<string, string>;
};

export async function updateDocument(
  id: string,
  patch: DocumentPatch,
): Promise<DocumentRecord | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, id);
    if (!meta) return null;

    if (patch.status !== undefined) meta.status = patch.status;
    if (patch.processingStep !== undefined) meta.processingStep = patch.processingStep;
    if (patch.processingPage !== undefined) meta.processingPage = patch.processingPage;
    if (patch.errorMessage !== undefined) meta.errorMessage = patch.errorMessage;
    if (patch.pageCount !== undefined) meta.pageCount = patch.pageCount;
    if (patch.pipelineMode !== undefined) meta.pipelineMode = patch.pipelineMode;
    if (patch.pipelineElapsedSec !== undefined) {
      meta.pipelineElapsedSec = patch.pipelineElapsedSec;
    }
    if (patch.pipelineFinishedAt !== undefined) {
      meta.pipelineFinishedAt = patch.pipelineFinishedAt;
    }
    if (patch.pipelineUsage !== undefined) meta.pipelineUsage = patch.pipelineUsage;
    if (patch.pageErrors !== undefined) meta.pageErrors = patch.pageErrors;

    let body: DocumentBody | null = null;
    if (patch.pages !== undefined) {
      body = await readBody(id);
      body.pages = patch.pages.map((page) => normalizePage(page));
      applyBodyToMeta(meta, body);
      await writeBody(id, body);
    }

    await writeIndex(db);
    return merge(meta, body ?? (await readBody(id)));
  });
}

export async function savePageMarkdown(
  id: string,
  pageNumber: number,
  markdown: string,
  author?: { userId: string; userName: string } | null,
): Promise<DocumentRecord | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, id);
    if (!meta) return null;
    const body = await readBody(id);
    const page = body.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) return null;
    if (page.markdown === markdown) return merge(meta, body);

    body.editLog.unshift({
      id: crypto.randomUUID(),
      pageNumber,
      before: page.markdown,
      after: markdown,
      createdAt: new Date().toISOString(),
      userId: author?.userId ?? null,
      userName: author?.userName ?? null,
    });
    page.markdown = markdown;
    await writeBody(id, body);
    return merge(meta, body);
  });
}

/** Приём готового листа от внешнего пайплайна. */
export async function ingestPage(input: {
  documentId: string;
  pageNumber: number;
  markdown: string;
  kind?: PageKind;
  source?: PageSource;
  warnings?: string[];
}): Promise<DocumentRecord | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, input.documentId);
    if (!meta) return null;
    const body = await readBody(input.documentId);
    const existing = body.pages.find((item) => item.pageNumber === input.pageNumber);

    // Правку инженера не затираем молча: сохраняем её в журнал как предыдущую версию.
    const editedByEngineer = body.editLog.some(
      (entry) => entry.pageNumber === input.pageNumber,
    );
    if (existing && editedByEngineer && existing.markdown !== input.markdown) {
      body.editLog.unshift({
        id: crypto.randomUUID(),
        pageNumber: input.pageNumber,
        before: existing.markdown,
        after: input.markdown,
        createdAt: new Date().toISOString(),
        userId: null,
        userName: "Пайплайн",
      });
    }

    const next = normalizePage({
      pageNumber: input.pageNumber,
      kind: input.kind ?? existing?.kind ?? "text",
      markdown: input.markdown,
      extractedText: existing?.extractedText ?? "",
      source: input.source ?? "model",
      warnings: input.warnings ?? [],
    });

    if (existing) {
      body.pages = body.pages.map((item) =>
        item.pageNumber === input.pageNumber ? next : item,
      );
    } else {
      body.pages = [...body.pages, next].sort((a, b) => a.pageNumber - b.pageNumber);
    }

    applyBodyToMeta(meta, body);
    if (meta.pageCount < input.pageNumber) meta.pageCount = input.pageNumber;
    await writeBody(input.documentId, body);
    await writeIndex(db);
    return merge(meta, body);
  });
}

export async function deleteDocument(id: string): Promise<boolean> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, id);
    if (!meta) return false;
    db.documents = db.documents.filter((doc) => doc.id !== id);
    await writeIndex(db);
    await deleteDocumentFile(id);
    await deletePdfBytes(meta.storedName);
    return true;
  });
}

/**
 * Обработка живёт в памяти процесса: после перезапуска документ навсегда
 * остался бы «в обработке». Возвращаем такие документы в состояние ошибки.
 */
export async function resetStuckDocuments(activeIds: Set<string>): Promise<string[]> {
  return withDataLock(async () => {
    const db = await readIndex();
    const now = Date.now();
    const reset: string[] = [];
    for (const meta of db.documents) {
      if (meta.status !== "processing" && meta.status !== "queued") continue;
      if (activeIds.has(meta.id)) continue;
      if (now - new Date(meta.createdAt).getTime() < STUCK_AFTER_MS) continue;
      meta.status = "error";
      meta.processingStep = null;
      meta.processingPage = null;
      meta.errorMessage = "Обработка прервалась. Нажмите «Повтор».";
      reset.push(meta.id);
    }
    if (reset.length > 0) await writeIndex(db);
    return reset;
  });
}

// ---------------------------------------------------------------- аннотации

export async function listAnnotations(id: string): Promise<PageAnnotation[] | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    if (!findMeta(db, id)) return null;
    const body = await readBody(id);
    return body.annotations;
  });
}

export async function createAnnotation(input: {
  documentId: string;
  pageNumber: number;
  rect: AnnotationRect;
  comment: string;
  expected: string;
  author: { userId: string; userName: string };
}): Promise<PageAnnotation | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, input.documentId);
    if (!meta) return null;
    const body = await readBody(input.documentId);
    const annotation = normalizeAnnotation({
      id: crypto.randomUUID(),
      pageNumber: input.pageNumber,
      rect: input.rect,
      comment: input.comment,
      expected: input.expected,
      status: "open",
      userId: input.author.userId,
      userName: input.author.userName,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    });
    body.annotations.unshift(annotation);
    applyBodyToMeta(meta, body);
    await writeBody(input.documentId, body);
    await writeIndex(db);
    return annotation;
  });
}

export async function updateAnnotation(input: {
  documentId: string;
  annotationId: string;
  comment?: string;
  expected?: string;
  status?: PageAnnotation["status"];
  actor: { userId: string; isAdmin: boolean };
}): Promise<PageAnnotation | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, input.documentId);
    if (!meta) return null;
    const body = await readBody(input.documentId);
    const annotation = body.annotations.find((item) => item.id === input.annotationId);
    if (!annotation) return null;
    if (!input.actor.isAdmin && annotation.userId && annotation.userId !== input.actor.userId) {
      throw Object.assign(new Error("Замечание создал другой пользователь"), {
        status: 403,
      });
    }
    if (input.comment !== undefined) annotation.comment = input.comment;
    if (input.expected !== undefined) annotation.expected = input.expected;
    if (input.status !== undefined) {
      annotation.status = input.status;
      annotation.resolvedAt =
        input.status === "fixed" ? new Date().toISOString() : null;
    }
    applyBodyToMeta(meta, body);
    await writeBody(input.documentId, body);
    await writeIndex(db);
    return annotation;
  });
}

export async function deleteAnnotation(input: {
  documentId: string;
  annotationId: string;
  actor: { userId: string; isAdmin: boolean };
}): Promise<boolean> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, input.documentId);
    if (!meta) return false;
    const body = await readBody(input.documentId);
    const annotation = body.annotations.find((item) => item.id === input.annotationId);
    if (!annotation) return false;
    if (!input.actor.isAdmin && annotation.userId && annotation.userId !== input.actor.userId) {
      throw Object.assign(new Error("Замечание создал другой пользователь"), {
        status: 403,
      });
    }
    body.annotations = body.annotations.filter((item) => item.id !== input.annotationId);
    applyBodyToMeta(meta, body);
    await writeBody(input.documentId, body);
    await writeIndex(db);
    return true;
  });
}

// ----------------------------------------------------------------- прогресс

const emptyProgress = (): PageProgress => ({
  viewed: [],
  lastPage: 1,
  updatedAt: new Date().toISOString(),
});

export async function getPageProgress(
  documentId: string,
  userId: string,
): Promise<PageProgress | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    if (!findMeta(db, documentId)) return null;
    const body = await readBody(documentId);
    return body.progress[userId] ?? emptyProgress();
  });
}

export async function savePageProgress(
  documentId: string,
  userId: string,
  patch: { viewed?: number[]; lastPage?: number },
): Promise<PageProgress | null> {
  return withDataLock(async () => {
    const db = await readIndex();
    const meta = findMeta(db, documentId);
    if (!meta) return null;
    const body = await readBody(documentId);
    const current = body.progress[userId] ?? emptyProgress();
    const next: PageProgress = {
      viewed:
        patch.viewed === undefined
          ? current.viewed
          : [
              ...new Set(
                patch.viewed.filter((page) => Number.isInteger(page) && page > 0),
              ),
            ].sort((a, b) => a - b),
      lastPage:
        patch.lastPage !== undefined && patch.lastPage > 0
          ? Math.floor(patch.lastPage)
          : current.lastPage,
      updatedAt: new Date().toISOString(),
    };
    body.progress[userId] = next;
    applyBodyToMeta(meta, body);
    await writeBody(documentId, body);
    await writeIndex(db);
    return next;
  });
}
