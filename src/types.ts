export type DocumentStatus = "queued" | "processing" | "done" | "error";

export type ProcessingStep = "queued" | "text" | "drawings" | "done";

export type PageKind = "drawing" | "text" | "table" | "mixed";

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
};

export type DocumentPage = {
  pageNumber: number;
  kind: PageKind;
  markdown: string;
  extractedText: string;
};

export type EditLogEntry = {
  id: string;
  pageNumber: number;
  before: string;
  after: string;
  createdAt: string;
};

export type DocumentRecord = {
  id: string;
  projectId: string;
  originalName: string;
  storedName: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  pageCount: number;
  status: DocumentStatus;
  processingStep: ProcessingStep | null;
  processingPage: number | null;
  errorMessage: string | null;
  pages: DocumentPage[];
  editLog: EditLogEntry[];
  createdAt: string;
};

export type Database = {
  projects: Project[];
  documents: DocumentRecord[];
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
