export type DocumentStatus = "queued" | "processing" | "done" | "error";

export type ProcessingStep = "queued" | "text" | "drawings" | "done";

export type PageKind = "drawing" | "text" | "table" | "mixed";

export type PageSource = "heuristic" | "model";

export type UserRole = "admin" | "engineer";

export type User = {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  disabled: boolean;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  specStoredName: string | null;
  specOriginalName: string | null;
  createdAt: string;
};

export type ProjectEdit = {
  id: string;
  documentId: string;
  originalName: string;
  pageNumber: number;
  createdAt: string;
  userId: string | null;
  userName: string | null;
};

export type DocumentPage = {
  pageNumber: number;
  kind: PageKind;
  markdown: string;
  extractedText: string;
  source: PageSource;
  warnings: string[];
};

export type EditLogEntry = {
  id: string;
  pageNumber: number;
  before: string;
  after: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
};

export type AnnotationStatus = "open" | "fixed";

export type AnnotationRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PageAnnotation = {
  id: string;
  pageNumber: number;
  rect: AnnotationRect;
  comment: string;
  expected: string;
  status: AnnotationStatus;
  userId: string | null;
  userName: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type ProjectAnnotation = PageAnnotation & {
  documentId: string;
  originalName: string;
};

export type PageProgress = {
  viewed: number[];
  lastPage: number;
  updatedAt: string;
};

export type KindCounts = Record<PageKind, number>;

export type PipelineMode = "mock" | "real";

export type KitRole = "pdf" | "dwg" | "dxf";

/** Шапка документа: лежит в индексе data/db.json. */
export type DocumentMeta = {
  id: string;
  projectId: string;
  /** Связка PDF + DWG из одного архива или пары файлов. */
  kitId: string | null;
  kitRole: KitRole | null;
  kitLabel: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  status: DocumentStatus;
  processingStep: ProcessingStep | null;
  processingPage: number | null;
  errorMessage: string | null;
  readyPages: number;
  kindCounts: KindCounts;
  openAnnotations: number;
  /** Сколько листов просмотрел каждый пользователь: нужно для списка файлов без чтения тела. */
  viewedCounts: Record<string, number>;
  /** Режим конвейера на момент прогона (mock / real). */
  pipelineMode: PipelineMode | null;
  /** Модель из профиля конвейера (для контроля расходов на проде). */
  pipelineModel: string | null;
  pipelineElapsedSec: number | null;
  /** Когда прогон завершился (done / отмена / ошибка конвейера). */
  pipelineFinishedAt: string | null;
  pipelineUsage: Record<string, number>;
  pageErrors: Record<string, string>;
  createdAt: string;
};

/** Тело документа: лежит в data/documents/<id>.json. */
export type DocumentBody = {
  pages: DocumentPage[];
  editLog: EditLogEntry[];
  annotations: PageAnnotation[];
  progress: Record<string, PageProgress>;
};

export type DocumentRecord = DocumentMeta & DocumentBody;

export type SearchHit = {
  documentId: string;
  originalName: string;
  pageNumber: number;
  kind: PageKind;
  snippet: string;
};

export type Database = {
  users: User[];
  projects: Project[];
  documents: DocumentMeta[];
};

export const STEP_LABEL: Record<ProcessingStep, string> = {
  queued: "В очереди",
  text: "Текст и таблицы",
  drawings: "Описание чертежа",
  done: "Готово",
};

export const KIND_LABEL: Record<PageKind, string> = {
  drawing: "Чертёж",
  text: "Текст",
  table: "Таблица",
  mixed: "Смешанный",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Админ",
  engineer: "Инженер",
};

export const SOURCE_LABEL: Record<PageSource, string> = {
  heuristic: "Авторазбор",
  model: "Модель",
};

export const emptyKindCounts = (): KindCounts => ({
  drawing: 0,
  text: 0,
  table: 0,
  mixed: 0,
});
