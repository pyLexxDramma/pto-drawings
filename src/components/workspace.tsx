"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { PasswordPanel } from "@/components/password-panel";
import { ColumnResizer, clamp } from "@/components/column-resizer";
import { ReviewPane } from "@/components/review-pane";
import { PtoLogo } from "@/components/pto-logo";
import {
  ToastHost,
  notifyIfHidden,
  useToasts,
} from "@/components/toast";
import {
  ActionMenu,
  SegmentedTabs,
  Spinner,
  menuItemClass,
} from "@/components/ui-chrome";
import { UserMenu } from "@/components/user-menu";
import { UsersPanel } from "@/components/users-panel";
import {
  formatBytes,
  formatDate,
  formatDateOnly,
  formatPages,
  formatTimeOnly,
} from "@/lib/format";
import { LiveProgressDock } from "@/components/processing-progress-panel";
import {
  formatElapsed,
  formatPipelineUsage,
  mergePipelineUsage,
  type PipelineHealth,
} from "@/lib/pipeline";
import { UploadDialog, type UploadDialogResult } from "@/components/upload-dialog";
import {
  DRAWING_ACCEPT,
  DRAWING_ACCEPT_HINT,
  UPLOAD_BUTTON_LABEL,
  UPLOAD_HELP_LINES,
  isDrawingFile,
} from "@/lib/drawing-files";
import {
  detectDrawingKitUpload,
  isZipFile,
} from "@/lib/drawing-kit";
import { loadCachedProgress } from "@/lib/review-state";
import {
  KIND_LABEL,
  type DocumentRecord,
  type DocumentStatus,
  type Project,
  type ProjectAnnotation,
  type ProjectEdit,
  type PublicUser,
  type SearchHit,
} from "@/types";

type UploadItem = {
  tempId: string;
  name: string;
  progress: number;
  error?: string;
};

const STATUS_LABEL: Record<DocumentStatus, string> = {
  queued: "В очереди",
  processing: "Обработка",
  done: "Готово",
  error: "Ошибка",
};

const STATUS_CLASS: Record<DocumentStatus, string> = {
  queued: "bg-amber-50 text-amber-800",
  processing: "bg-sky-50 text-sky-800",
  done: "bg-emerald-50 text-emerald-800",
  error: "bg-red-50 text-red-800",
};

const STATUS_DOT: Record<DocumentStatus, string> = {
  queued: "bg-amber-500",
  processing: "bg-sky-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

function pickLiveJob(
  documents: DocumentRecord[],
  selectedId: string | null,
): DocumentRecord | null {
  const active = documents.filter(
    (doc) =>
      doc.status === "queued" ||
      doc.status === "processing" ||
      Boolean(doc.errorMessage?.startsWith("Отмена")),
  );
  if (active.length === 0) return null;
  return (
    active.find((doc) => doc.id === selectedId) ??
    active.find((doc) => doc.status === "processing") ??
    active[0]
  );
}

function liveJobPage(doc: DocumentRecord) {
  const total = Math.max(doc.pageCount, 1);
  const ready = Math.min(Math.max(doc.readyPages, 0), total);
  if (doc.processingPage && doc.processingPage > 0) return doc.processingPage;
  return ready < total ? ready + 1 : 1;
}

function kindSummary(doc: DocumentRecord) {
  if (doc.readyPages === 0) return formatPages(doc.pageCount);
  const drawings = doc.kindCounts.drawing + doc.kindCounts.mixed;
  const parts = [
    `${doc.readyPages}/${doc.pageCount} листов`,
    drawings ? `${drawings} чертеж.` : null,
    doc.kindCounts.table ? `${doc.kindCounts.table} табл.` : null,
    doc.kindCounts.text ? `${doc.kindCounts.text} текст` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function projectSummaryLine(
  documents: DocumentRecord[],
  notes: ProjectAnnotation[],
  showUsage = false,
) {
  const pages = documents.reduce((sum, doc) => sum + doc.pageCount, 0);
  const openNotes = notes.filter((item) => item.status === "open").length;
  const usageLabel = showUsage
    ? formatPipelineUsage(
        mergePipelineUsage(...documents.map((doc) => doc.pipelineUsage)),
      )
    : null;
  let maxElapsed: number | null = null;
  for (const doc of documents) {
    if (
      typeof doc.pipelineElapsedSec === "number" &&
      Number.isFinite(doc.pipelineElapsedSec)
    ) {
      maxElapsed =
        maxElapsed == null
          ? doc.pipelineElapsedSec
          : Math.max(maxElapsed, doc.pipelineElapsedSec);
    }
  }
  const elapsedLabel = formatElapsed(maxElapsed);
  const parts = [
    `${documents.length} файл(ов)`,
    formatPages(pages),
    `${openNotes} откр. замечаний`,
    usageLabel,
    elapsedLabel ? `прогон ${elapsedLabel}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

type UploadMode = "files" | "kit-zip" | "kit-pair";

function newClientId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // HTTP на IP: Secure Context нет, randomUUID недоступен
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function uploadPdf(
  file: File,
  projectId: string,
  onProgress: (value: number) => void,
  title?: string,
) {
  return new Promise<DocumentRecord>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);
    if (title?.trim()) form.append("title", title.trim());
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText) as {
          document?: DocumentRecord;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && payload.document) {
          resolve(payload.document);
          return;
        }
        reject(new Error(payload.error || "Ошибка загрузки"));
      } catch {
        reject(new Error("Ошибка загрузки"));
      }
    };
    xhr.onerror = () => reject(new Error("Нет соединения с сервером"));
    xhr.timeout = 120000;
    xhr.ontimeout = () => reject(new Error("Сервер не ответил"));
    xhr.send(form);
  });
}

type KitUploadResult = {
  kitId: string;
  kitLabel: string;
  documents: DocumentRecord[];
  primaryDocumentId: string;
};

function uploadKit(
  input: { mode: "kit-zip"; archive: File } | { mode: "kit-pair"; pdf: File; cad: File },
  projectId: string,
  onProgress: (value: number) => void,
  title?: string,
) {
  return new Promise<KitUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("projectId", projectId);
    if (title?.trim()) form.append("title", title.trim());
    if (input.mode === "kit-zip") {
      form.append("archive", input.archive);
    } else {
      form.append("pdf", input.pdf);
      form.append("cad", input.cad);
    }
    xhr.open("POST", "/api/documents/kit");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText) as KitUploadResult & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && payload.documents?.length) {
          resolve(payload);
          return;
        }
        reject(new Error(payload.error || "Ошибка загрузки комплекта"));
      } catch {
        reject(new Error("Ошибка загрузки комплекта"));
      }
    };
    xhr.onerror = () => reject(new Error("Нет соединения с сервером"));
    xhr.timeout = 180000;
    xhr.ontimeout = () => reject(new Error("Сервер не ответил"));
    xhr.send(form);
  });
}

export function Workspace({
  user,
  defaultPasswordWarning = false,
  onPasswordChanged,
  onLogout,
}: {
  user: PublicUser;
  defaultPasswordWarning?: boolean;
  onPasswordChanged?: () => void;
  onLogout: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [edits, setEdits] = useState<ProjectEdit[]>([]);
  const [showEdits, setShowEdits] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [notes, setNotes] = useState<ProjectAnnotation[]>([]);
  const [showNotes, setShowNotes] = useState(true);
  const [notesFilter, setNotesFilter] = useState<"all" | "open" | string>("open");
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealth | null>(
    null,
  );
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [pendingUploadMode, setPendingUploadMode] = useState<UploadMode>("files");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [projectsWidth, setProjectsWidth] = useState(280);
  /** Job обработки, переживает смену проекта. */
  const [liveJobDoc, setLiveJobDoc] = useState<DocumentRecord | null>(null);
  const [fullProgressVisible, setFullProgressVisible] = useState(false);
  const [liveDockCollapsed, setLiveDockCollapsed] = useState(false);
  const [openPage, setOpenPage] = useState<{
    nonce: number;
    page: number;
    documentId: string;
  } | null>(null);
  const autoReadyJumpRef = useRef<string | null>(null);
  const statusPrevRef = useRef<Map<string, DocumentStatus>>(new Map());
  const specInputRef = useRef<HTMLInputElement>(null);
  const { items: toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const selected = documents.find((doc) => doc.id === selectedId) ?? null;
  const kitSibling = useMemo(() => {
    if (!selected?.kitId) return null;
    return (
      documents.find(
        (doc) => doc.kitId === selected.kitId && doc.id !== selected.id,
      ) ?? null
    );
  }, [documents, selected]);
  const currentProject = projects.find((item) => item.id === projectId);
  const busy =
    documents.some(
      (doc) => doc.status === "queued" || doc.status === "processing",
    ) ||
    Boolean(
      liveJobDoc &&
        (liveJobDoc.status === "queued" || liveJobDoc.status === "processing"),
    );
  const liveJob = liveJobDoc
    ? {
        documentId: liveJobDoc.id,
        projectId: liveJobDoc.projectId,
        page: liveJobPage(liveJobDoc),
        label: `${liveJobDoc.originalName} · лист ${liveJobPage(liveJobDoc)}`,
      }
    : null;

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/projects", { signal });
    if (response.status === 401) {
      onLogout();
      throw new Error("Нужен вход");
    }
    if (!response.ok) throw new Error("Не удалось загрузить проекты");
    const payload = (await response.json()) as { projects: Project[] };
    const list = payload.projects ?? [];
    setProjects(list);
    return list;
  }, [onLogout]);

  const applyFullDocument = useCallback((document: DocumentRecord) => {
    setDocuments((prev) => {
      const exists = prev.some((doc) => doc.id === document.id);
      if (!exists) return [document, ...prev];
      return prev.map((doc) => (doc.id === document.id ? document : doc));
    });
  }, []);

  const refreshDocument = useCallback(
    async (id: string, signal?: AbortSignal) => {
      try {
        const response = await fetch(`/api/documents/${id}`, { signal });
        if (!response.ok) return;
        const payload = (await response.json()) as { document?: DocumentRecord };
        if (!payload.document) return;
        applyFullDocument(payload.document);
      } catch {
        // список уже есть; полный текст подтянется при повторе
      }
    },
    [applyFullDocument],
  );

  const loadDocuments = useCallback(async (id: string, signal?: AbortSignal) => {
    const response = await fetch(
      `/api/documents?projectId=${encodeURIComponent(id)}&lite=1`,
      { signal },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { documents: DocumentRecord[] };
    const list = payload.documents ?? [];
    setDocuments((prev) => {
      const prevById = new Map(prev.map((doc) => [doc.id, doc]));
      return list.map((lite) => {
        const existing = prevById.get(lite.id);
        // lite без страниц — не затираем уже подтянутый markdown при смене статуса
        if (existing?.pages.some((page) => page.markdown.length > 0)) {
          return {
            ...lite,
            pages: existing.pages,
            editLog: existing.editLog,
            annotations: existing.annotations,
            progress: existing.progress,
          };
        }
        return lite;
      });
    });
    return list;
  }, []);

  const openDocument = useCallback(
    async (id: string, page?: number) => {
      setSelectedId(id);
      setOpenPage(
        page && page > 0
          ? { nonce: Date.now(), page, documentId: id }
          : null,
      );
      autoReadyJumpRef.current = page && page > 0 ? id : null;
      await refreshDocument(id);
    },
    [refreshDocument],
  );

  const loadEdits = useCallback(async (id: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/projects/${id}/edits`, { signal });
    if (!response.ok) {
      setEdits([]);
      return;
    }
    const payload = (await response.json()) as { edits: ProjectEdit[] };
    setEdits(payload.edits ?? []);
  }, []);

  const loadNotes = useCallback(async (id: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/projects/${id}/annotations`, { signal });
    if (!response.ok) {
      setNotes([]);
      return;
    }
    const payload = (await response.json()) as { annotations: ProjectAnnotation[] };
    setNotes(payload.annotations ?? []);
  }, []);

  const jumpToPage = useCallback(
    (documentId: string, page: number) => {
      setOpenPage({ nonce: Date.now(), page, documentId });
      void openDocument(documentId);
    },
    [openDocument],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pto-column-widths");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { projects?: number; files?: number };
      if (typeof parsed.projects === "number") {
        setProjectsWidth(clamp(parsed.projects, 200, 420));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "pto-column-widths",
        JSON.stringify({ projects: projectsWidth }),
      );
    } catch {
      // ignore
    }
  }, [projectsWidth]);

  useEffect(() => {
    const query = projectQuery.trim();
    if (!projectId || query.length < 2) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`,
            { signal: ac.signal },
          );
          if (!response.ok) return;
          const payload = (await response.json()) as { hits?: SearchHit[] };
          setHits(payload.hits ?? []);
        } catch {
          // запрос отменён при новом вводе
        } finally {
          setSearching(false);
        }
      })();
    }, 350);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [projectId, projectQuery]);

  useEffect(() => {
    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 20000);
    (async () => {
      try {
        const list = await loadProjects(ac.signal);
        if (ac.signal.aborted) return;
        if (list.length === 0) return;
        setProjectId(list[0].id);
        setDescriptionDraft(list[0].description ?? "");
        await Promise.all([
          loadDocuments(list[0].id, ac.signal),
          loadEdits(list[0].id, ac.signal),
          loadNotes(list[0].id, ac.signal),
        ]);
      } catch {
        if (ac.signal.aborted) return;
        setError("Не удалось загрузить данные");
      } finally {
        window.clearTimeout(timeout);
        setLoading(false);
      }
    })();
    return () => {
      window.clearTimeout(timeout);
      ac.abort();
    };
    // Только первый заход в workspace — иначе сброс projectId / remount input ломает выбор файла.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fromList = pickLiveJob(documents, selectedId);
    if (fromList) {
      setLiveJobDoc(fromList);
      return;
    }
    setLiveJobDoc((prev) => prev ?? null);
  }, [documents, selectedId, projectId]);

  useEffect(() => {
    setLiveDockCollapsed(false);
  }, [liveJobDoc?.id]);

  useEffect(() => {
    if (
      liveJobDoc &&
      (liveJobDoc.status === "done" || liveJobDoc.status === "error")
    ) {
      setLiveDockCollapsed(false);
    }
  }, [liveJobDoc?.id, liveJobDoc?.status]);

  // Поллинг live job даже после смены проекта.
  useEffect(() => {
    if (!liveJobDoc) return;
    const id = liveJobDoc.id;
    const active =
      liveJobDoc.status === "queued" ||
      liveJobDoc.status === "processing" ||
      Boolean(liveJobDoc.errorMessage?.startsWith("Отмена"));
    if (!active && liveJobDoc.status !== "done" && liveJobDoc.status !== "error") {
      return;
    }
    if (liveJobDoc.status === "done" || liveJobDoc.status === "error") {
      // финальный кадр уже есть — dock сам скроется
      return;
    }
    const tick = async () => {
      try {
        const response = await fetch(`/api/documents/${id}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { document?: DocumentRecord };
        if (!payload.document) return;
        setLiveJobDoc(payload.document);
        applyFullDocument(payload.document);
      } catch {
        // сеть — следующий тик
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1500);
    return () => window.clearInterval(timer);
  }, [
    liveJobDoc?.id,
    liveJobDoc?.status,
    liveJobDoc?.errorMessage,
    applyFullDocument,
  ]);

  useEffect(() => {
    if (!projectId || !busy) return;
    const timer = setInterval(() => {
      void loadDocuments(projectId);
    }, 900);
    return () => clearInterval(timer);
  }, [busy, loadDocuments, projectId]);

  // lite-опрос не несёт страницы — пока идёт обработка, тянем полный документ
  useEffect(() => {
    if (!selectedId || !busy) return;
    void refreshDocument(selectedId);
    const timer = setInterval(() => {
      void refreshDocument(selectedId);
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, refreshDocument, selectedId]);

  // после done lite мог оставить пустые pages — один раз догружаем текст
  useEffect(() => {
    if (!selectedId) return;
    const doc = documents.find((item) => item.id === selectedId);
    if (!doc) return;
    if (doc.status === "queued" || doc.status === "processing") return;
    if (doc.pageCount <= 0) return;
    if (doc.pages.some((page) => page.markdown.length > 0)) return;
    void refreshDocument(selectedId);
  }, [documents, refreshDocument, selectedId]);

  // первый готовый лист — открыть автоматически (один раз на документ)
  useEffect(() => {
    if (!selectedId) return;
    if (autoReadyJumpRef.current === selectedId) return;
    const doc = documents.find((item) => item.id === selectedId);
    if (!doc || doc.readyPages < 1) return;
    const firstReady =
      doc.pages.find((page) => page.markdown.length > 0)?.pageNumber ?? 1;
    autoReadyJumpRef.current = selectedId;
    setOpenPage({
      nonce: Date.now(),
      page: firstReady,
      documentId: selectedId,
    });
  }, [documents, selectedId]);

  // тост при завершении / ошибке обработки
  useEffect(() => {
    const prev = statusPrevRef.current;
    const next = new Map<string, DocumentStatus>();
    for (const doc of documents) {
      next.set(doc.id, doc.status);
      const was = prev.get(doc.id);
      if (!was) continue;
      if (
        (was === "queued" || was === "processing") &&
        (doc.status === "done" || doc.status === "error")
      ) {
        const ok = doc.status === "done";
        const message = ok
          ? `Готово: ${doc.originalName}`
          : `Ошибка: ${doc.originalName}${doc.errorMessage ? ` — ${doc.errorMessage}` : ""}`;
        pushToast(message, ok ? "ok" : "error");
        notifyIfHidden(
          ok ? "PTO: разбор готов" : "PTO: ошибка разбора",
          doc.originalName,
        );
      }
    }
    statusPrevRef.current = next;
  }, [documents, pushToast]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/pipeline/health");
        if (!response.ok) return;
        const payload = (await response.json()) as PipelineHealth;
        if (!cancelled) setPipelineHealth(payload);
      } catch {
        if (!cancelled) {
          setPipelineHealth({
            ok: false,
            mode: "unknown",
            profile: {},
            reachable: false,
            error: "unreachable",
          });
        }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function openProjectsList() {
    setProjectsCollapsed(false);
    setProjectId("");
    setSelectedId(null);
    setFocusMode(false);
    setDocuments([]);
    setEdits([]);
    setNotes([]);
    setDescriptionDraft("");
    setShowEdits(false);
    setProjectQuery("");
    setHits([]);
    setError(null);
  }

  async function selectProject(id: string) {
    if (projectId === id) {
      setProjectId("");
      setSelectedId(null);
      setDocuments([]);
      setEdits([]);
      setNotes([]);
      setDescriptionDraft("");
      setShowEdits(false);
      setProjectQuery("");
      setHits([]);
      return;
    }
    setProjectId(id);
    setSelectedId(null);
    setFocusMode(false);
    setProjectsCollapsed(false);
    setError(null);
    const project = projects.find((item) => item.id === id);
    setDescriptionDraft(project?.description ?? "");
    setShowEdits(false);
    setShowNotes(true);
    setNotesFilter("open");
    setProjectQuery("");
    setHits([]);
    await Promise.all([loadDocuments(id), loadEdits(id), loadNotes(id)]);
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: newProjectDescription.trim(),
        }),
      });
      const payload = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!payload.project) throw new Error(payload.error || "Ошибка");
      setNewProjectName("");
      setNewProjectDescription("");
      setShowNewProject(false);
      await loadProjects();
      await selectProject(payload.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать проект");
    } finally {
      setCreatingProject(false);
    }
  }

  async function commitRename() {
    if (!renameId) return;
    const name = renameValue.trim();
    setRenameId(null);
    if (!name) return;
    const response = await fetch(`/api/projects/${renameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (response.ok) await loadProjects();
  }

  async function commitDescription() {
    if (!projectId) return;
    const description = descriptionDraft;
    if ((currentProject?.description ?? "") === description) return;
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    if (response.ok) await loadProjects();
  }

  async function handleSpecFile(fileList: FileList | null) {
    if (!projectId || !fileList?.[0]) return;
    try {
      const form = new FormData();
      form.append("file", fileList[0]);
      const response = await fetch(`/api/projects/${projectId}/spec`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as { project?: Project; error?: string };
      if (!payload.project) {
        setError(payload.error || "Не удалось загрузить ТЗ");
        return;
      }
      setError(null);
      setProjects((prev) =>
        prev.map((item) => (item.id === payload.project!.id ? payload.project! : item)),
      );
    } catch {
      setError("Не удалось загрузить ТЗ");
    }
  }

  async function handleClearSpec() {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}/spec`, { method: "DELETE" });
    const payload = (await response.json()) as { project?: Project; error?: string };
    if (!payload.project) {
      setError(payload.error || "Не удалось удалить ТЗ");
      return;
    }
    setProjects((prev) =>
      prev.map((item) => (item.id === payload.project!.id ? payload.project! : item)),
    );
  }

  const queueUpload = useCallback((fileList: FileList | File[]) => {
    const raw = Array.from(fileList);
    const zipFiles = raw.filter((file) => isZipFile(file));
    const drawingFiles = raw.filter((file) => !isZipFile(file) && isDrawingFile(file));

    if (zipFiles.length > 0) {
      if (zipFiles.length > 1 || drawingFiles.length > 0) {
        setError("Загружайте один ZIP-архив (PDF + DWG) без других файлов");
        return;
      }
      setError(null);
      setUploadError(null);
      setPendingUploadMode("kit-zip");
      setPendingUploadFiles([zipFiles[0]]);
      return;
    }

    const kitPair = detectDrawingKitUpload(drawingFiles);
    if (kitPair && drawingFiles.length === raw.length) {
      setError(null);
      setUploadError(null);
      setPendingUploadMode("kit-pair");
      setPendingUploadFiles(kitPair);
      return;
    }

    if (drawingFiles.length === 0) {
      setError(`Можно загружать только ${DRAWING_ACCEPT_HINT}`);
      return;
    }
    setError(null);
    setUploadError(null);
    setPendingUploadMode("files");
    setPendingUploadFiles(drawingFiles);
  }, []);

  const confirmUpload = useCallback(
    async (result: UploadDialogResult) => {
      setUploadBusy(true);
      setUploadError(null);
      try {
        let targetProject = result.projectId;
        if (targetProject.startsWith("__new__:")) {
          const name = targetProject.slice("__new__:".length).trim();
          if (!name) throw new Error("Укажите название проекта");
          const response = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description: "" }),
          });
          const payload = (await response.json()) as {
            project?: Project;
            error?: string;
          };
          if (!payload.project) {
            throw new Error(payload.error || "Не удалось создать проект");
          }
          targetProject = payload.project.id;
          setProjects((prev) => [
            payload.project!,
            ...prev.filter((p) => p.id !== payload.project!.id),
          ]);
          setProjectId(targetProject);
          setDocuments([]);
          setNotes([]);
          setEdits([]);
        } else if (targetProject !== projectId) {
          setProjectId(targetProject);
          await Promise.all([
            loadDocuments(targetProject),
            loadEdits(targetProject),
            loadNotes(targetProject),
          ]);
        }

        const files = result.files;
        const uploadMode = pendingUploadMode;
        const isKit = uploadMode === "kit-zip" || uploadMode === "kit-pair";

        if (isKit) {
          const tempId = newClientId();
          const label =
            uploadMode === "kit-zip"
              ? files[0].name
              : `${files[0].name} + ${files[1].name}`;
          setUploads([{ tempId, name: label, progress: 0 }]);
          setPendingUploadFiles(null);
          setPendingUploadMode("files");

          try {
            const kit = await uploadKit(
              uploadMode === "kit-zip"
                ? { mode: "kit-zip", archive: files[0] }
                : { mode: "kit-pair", pdf: files[0], cad: files[1] },
              targetProject,
              (progress) => {
                setUploads((prev) =>
                  prev.map((item) =>
                    item.tempId === tempId ? { ...item, progress } : item,
                  ),
                );
              },
              result.title.trim() || undefined,
            );
            setUploads((prev) => prev.filter((item) => item.tempId !== tempId));
            setDocuments((prev) => [
              ...kit.documents,
              ...prev.filter(
                (doc) => !kit.documents.some((item) => item.id === doc.id),
              ),
            ]);
            void openDocument(kit.primaryDocumentId);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Ошибка загрузки комплекта";
            setUploads((prev) =>
              prev.map((item) =>
                item.tempId === tempId ? { ...item, error: message } : item,
              ),
            );
          }
          return;
        }

        const items: UploadItem[] = files.map((file) => ({
          tempId: newClientId(),
          name: file.name,
          progress: 0,
        }));
        setUploads((prev) => [...items, ...prev]);
        setPendingUploadFiles(null);
        setPendingUploadMode("files");

        await Promise.all(
          files.map(async (file, index) => {
            const tempId = items[index].tempId;
            const title =
              files.length === 1 && result.title.trim()
                ? result.title.trim()
                : undefined;
            try {
              const document = await uploadPdf(
                file,
                targetProject,
                (progress) => {
                  setUploads((prev) =>
                    prev.map((item) =>
                      item.tempId === tempId ? { ...item, progress } : item,
                    ),
                  );
                },
                title,
              );
              setUploads((prev) =>
                prev.filter((item) => item.tempId !== tempId),
              );
              setDocuments((prev) => [
                document,
                ...prev.filter((doc) => doc.id !== document.id),
              ]);
              void openDocument(document.id);
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Ошибка загрузки";
              setUploads((prev) =>
                prev.map((item) =>
                  item.tempId === tempId ? { ...item, error: message } : item,
                ),
              );
            }
          }),
        );
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Ошибка загрузки");
      } finally {
        setUploadBusy(false);
      }
    },
    [loadDocuments, loadEdits, loadNotes, openDocument, pendingUploadMode, projectId],
  );

  async function handleSavePage(pageNumber: number, markdown: string) {
    if (!selectedId) return;
    const response = await fetch(`/api/documents/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageNumber, markdown }),
    });
    const payload = (await response.json()) as { document?: DocumentRecord };
    if (payload.document) {
      setDocuments((prev) =>
        prev.map((doc) => (doc.id === payload.document!.id ? payload.document! : doc)),
      );
      if (projectId) void loadEdits(projectId);
    }
  }

  async function handleDelete(id: string) {
    const doc = documents.find((item) => item.id === id);
    const label = doc?.originalName ?? "файл";
    if (!window.confirm(`Удалить файл «${label}»?`)) return;
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Не удалось удалить файл");
      return;
    }
    setDocuments((prev) => prev.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (projectId) {
      void loadEdits(projectId);
      void loadNotes(projectId);
    }
  }

  async function handleDeleteProject(id: string) {
    const project = projects.find((item) => item.id === id);
    const label = project?.name ?? "проект";
    const fileCount =
      id === projectId ? documents.length : undefined;
    const filesHint =
      fileCount === undefined
        ? "всеми файлами"
        : fileCount === 0
          ? "без файлов"
          : `всеми файлами (${fileCount})`;
    if (
      !window.confirm(
        `Удалить проект «${label}» вместе с ${filesHint}, правками и замечаниями? Это нельзя отменить.`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error || "Не удалось удалить проект");
      return;
    }
    setError(null);
    const list = await loadProjects();
    setSelectedId(null);
    setDocuments([]);
    setEdits([]);
    setNotes([]);
    if (list.length === 0) {
      setProjectId("");
      setDescriptionDraft("");
      return;
    }
    const next = list.find((item) => item.id !== id) ?? list[0];
    await selectProject(next.id);
  }

  async function handleRetry(id: string) {
    const response = await fetch(`/api/documents/${id}/process`, { method: "POST" });
    const payload = (await response.json()) as { document?: DocumentRecord };
    if (payload.document) {
      setDocuments((prev) =>
        prev.map((doc) => (doc.id === payload.document!.id ? payload.document! : doc)),
      );
      void openDocument(id);
    }
  }

  const openLiveJob = useCallback(async () => {
    if (!liveJobDoc) return;
    const targetProject = liveJobDoc.projectId;
    const docId = liveJobDoc.id;
    const page = liveJobPage(liveJobDoc);
    if (targetProject && targetProject !== projectId) {
      setProjectId(targetProject);
      setProjectsCollapsed(false);
      setSelectedId(null);
      const project = projects.find((item) => item.id === targetProject);
      setDescriptionDraft(project?.description ?? "");
      await Promise.all([
        loadDocuments(targetProject),
        loadEdits(targetProject),
        loadNotes(targetProject),
      ]);
    }
    await openDocument(docId, page);
  }, [
    liveJobDoc,
    projectId,
    projects,
    loadDocuments,
    loadEdits,
    loadNotes,
    openDocument,
  ]);

  async function handleCancel(id: string) {
    setCancelingId(id);
    setError(null);
    // Сразу в UI — не ждём ответ API, иначе кажется, что кнопка мёртвая.
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              processingStep: null,
              errorMessage: "Отмена… останавливаем после текущего листа.",
            }
          : doc,
      ),
    );
    try {
      const response = await fetch(`/api/documents/${id}/cancel`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        document?: DocumentRecord;
        error?: string;
      };
      if (!response.ok || !payload.document) {
        setError(payload.error || "Не удалось отменить обработку");
        return;
      }
      applyFullDocument(payload.document);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить обработку");
    } finally {
      setCancelingId(null);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length) void queueUpload(event.dataTransfer.files);
  }

  const gridClass = "flex min-h-0 flex-1 flex-col md:flex-row";
  const showPipelineTech = user.role === "admin";
  const pipelineUsageLabel = formatPipelineUsage(pipelineHealth?.usage);
  const summaryLine = projectSummaryLine(
    documents,
    notes,
    showPipelineTech,
  );
  const showLiveDock = Boolean(
    liveJobDoc &&
      !fullProgressVisible &&
      (liveJobDoc.status === "queued" ||
        liveJobDoc.status === "processing" ||
        liveJobDoc.status === "done" ||
        liveJobDoc.status === "error" ||
        liveJobDoc.errorMessage?.startsWith("Отмена")),
  );
  const filteredNotes = notes.filter((note) => {
    if (notesFilter === "all") return true;
    if (notesFilter === "open") return note.status === "open";
    return note.documentId === notesFilter;
  });
  const noteFileOptions = Array.from(
    new Map(notes.map((note) => [note.documentId, note.originalName])).entries(),
  );
  const pipelineChip = (() => {
    if (!pipelineHealth) return null;
    if (!pipelineHealth.reachable) {
      return {
        className: "border-slate-200 bg-slate-100 text-slate-800",
        text: `Конвейер недоступен${pipelineHealth.error ? ` · ${pipelineHealth.error}` : ""}`,
      };
    }
    if (pipelineHealth.mode === "mock") {
      const source =
        pipelineHealth.modeSource ?? pipelineHealth.profile.modeSource;
      return {
        className: "border-amber-200 bg-amber-50 text-amber-950",
        text: source
          ? `Конвейер: MOCK · модель не вызывается · ${source}`
          : "Конвейер: MOCK · модель не вызывается",
      };
    }
    // Модель и токены — только для админа.
    if (pipelineHealth.mode === "real") {
      const parts = [
        "Конвейер: real",
        pipelineHealth.profile.provider,
        pipelineHealth.profile.model
          ? `модель ${pipelineHealth.profile.model}`
          : null,
        pipelineUsageLabel,
      ].filter(Boolean);
      return {
        className: "border-slate-200 bg-slate-50 text-slate-800",
        text: parts.join(" · "),
      };
    }
    return null;
  })();
  const visiblePipelineChip = showPipelineTech ? pipelineChip : null;

  const backToProjects = () => {
    setSelectedId(null);
    setFocusMode(false);
    setProjectsCollapsed(true);
    setOpenPage(null);
  };

  return (
    <div
      className="flex h-dvh flex-col bg-bg"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {/* Живёт вне шапки: на неё ссылаются label'ы в списке файлов и в пустом состоянии,
          а сама шапка при открытом чертеже не рендерится. */}
      <input
        id="pto-drawing-upload"
        ref={inputRef}
        type="file"
        accept={DRAWING_ACCEPT}
        multiple
        className="absolute h-px w-px overflow-hidden opacity-0"
        onChange={(event) => {
          const list = event.target.files;
          if (list && list.length > 0) void queueUpload(list);
          event.target.value = "";
        }}
      />

      {selected ? null : (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
          <button
            type="button"
            onClick={backToProjects}
            className="flex min-w-0 items-center gap-3 text-left"
            title="К списку проектов"
          >
            <PtoLogo className="h-8 w-8 shrink-0" title="PTO — проверка чертежей" />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-none tracking-tight">PTO</div>
              <div className="mt-0.5 text-[10px] leading-none text-muted">
                проверка чертежей
              </div>
            </div>
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {visiblePipelineChip ? (
              <div
                className={`hidden min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] md:flex ${visiblePipelineChip.className}`}
                title={visiblePipelineChip.text}
              >
                {busy ? <Spinner className="h-3 w-3 opacity-80" /> : null}
                <span>{visiblePipelineChip.text}</span>
              </div>
            ) : null}
            <UserMenu
              user={user}
              defaultPasswordWarning={defaultPasswordWarning}
              onUsers={user.role === "admin" ? () => setShowUsers(true) : undefined}
              onPassword={() => setShowPassword(true)}
              onLogout={() => {
                void (async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  onLogout();
                })();
              }}
            />
            <label
              htmlFor="pto-drawing-upload"
              className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              {UPLOAD_BUTTON_LABEL}
            </label>
          </div>
        </header>
      )}

      {showLiveDock && liveJobDoc ? (
        <LiveProgressDock
          document={liveJobDoc}
          errorCount={Object.keys(liveJobDoc.pageErrors ?? {}).length}
          canceling={cancelingId === liveJobDoc.id}
          collapsed={liveDockCollapsed}
          onExpand={() => setLiveDockCollapsed(false)}
          onHide={() => setLiveDockCollapsed(true)}
          onCancel={() => void handleCancel(liveJobDoc.id)}
          onOpen={() => void openLiveJob()}
          onDismiss={() => {
            if (
              liveJobDoc.status === "done" ||
              liveJobDoc.status === "error"
            ) {
              setLiveJobDoc(null);
              setLiveDockCollapsed(false);
            }
          }}
        />
      ) : null}

      {defaultPasswordWarning && !selected ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          У аккаунта <span className="font-medium">admin</span> всё ещё стандартный
          пароль. Смените его в меню профиля («Пароль») до выдачи доступов команде.
        </div>
      ) : null}

      <div className={gridClass}>
        {focusMode ? null : projectsCollapsed ? (
          selected ? (
            <div className="flex w-11 shrink-0 flex-col border-b border-border bg-surface md:border-b-0">
              <button
                type="button"
                role="tab"
                aria-selected={false}
                onClick={() => openProjectsList()}
                className="flex-1 text-xs text-muted hover:bg-bg"
                title="Показать проекты"
                aria-expanded={false}
              >
                <span className="inline-block px-1 py-3 [writing-mode:vertical-rl]">
                  Проекты
                </span>
              </button>
            </div>
          ) : null
        ) : (
          <aside
            className="flex min-h-0 shrink-0 flex-col border-b border-border bg-surface md:border-b-0"
            style={{ width: projectsWidth, maxWidth: "100%" }}
          >
            <div className="border-b border-border px-3 py-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted">
                Проекты
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowNewProject((value) => !value)}
                    className="rounded border border-border px-1.5 text-[11px] font-normal normal-case text-muted hover:text-text"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectsCollapsed(true)}
                    className="rounded border border-border px-1.5 text-[11px] font-normal normal-case text-muted hover:text-text"
                    title="Свернуть проекты"
                  >
                    Скрыть
                  </button>
                </span>
              </div>
              {showNewProject || projects.length === 0 ? (
                <form onSubmit={handleCreateProject} className="space-y-1">
                  <div className="flex gap-1">
                    <input
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      placeholder="Новый объект"
                      className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm outline-none placeholder:text-muted focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={creatingProject}
                      className="rounded-md border border-border px-2 text-sm text-muted hover:text-text"
                    >
                      OK
                    </button>
                  </div>
                  <input
                    value={newProjectDescription}
                    onChange={(event) => setNewProjectDescription(event.target.value)}
                    placeholder="Описание (необязательно)"
                    className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm outline-none placeholder:text-muted focus:border-accent"
                  />
                </form>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-projects-tree>
              {projects.map((project) =>
                renameId === project.id ? (
                  <input
                    key={project.id}
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commitRename();
                      if (event.key === "Escape") setRenameId(null);
                    }}
                    className="mb-1 w-full rounded-md border border-accent bg-white px-2 py-1.5 text-sm outline-none"
                  />
                ) : (
                  <div
                    key={project.id}
                    className={`mb-1 rounded-md ${
                      project.id === projectId
                        ? "bg-blue-50/80 ring-1 ring-accent/20"
                        : "hover:bg-surface-2"
                    }`}
                    data-project-row={project.id}
                  >
                    <div className="flex items-stretch gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          void selectProject(project.id);
                        }}
                        className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm ${
                          project.id === projectId ? "text-text" : "text-muted hover:text-text"
                        }`}
                        title={`Открыть файлы проекта · создан ${formatDate(project.createdAt)}`}
                        aria-expanded={project.id === projectId}
                      >
                        <span className="flex items-center gap-1">
                          <span className="text-[10px] text-muted">
                            {project.id === projectId ? "▾" : "▸"}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                        </span>
                        <span className="mt-0.5 block truncate pl-4 text-[10px] font-normal tabular-nums text-muted">
                          {formatDate(project.createdAt)}
                        </span>
                      </button>
                      <div className="flex items-start pt-1 pr-0.5">
                        <ActionMenu label="Действия проекта" align="right">
                          <button
                            type="button"
                            role="menuitem"
                            className={menuItemClass()}
                            onClick={() => {
                              setRenameId(project.id);
                              setRenameValue(project.name);
                            }}
                          >
                            Переименовать
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={menuItemClass(true)}
                            onClick={() => void handleDeleteProject(project.id)}
                          >
                            Удалить проект
                          </button>
                        </ActionMenu>
                      </div>
                    </div>
                    {project.id === projectId ? (
                      <div className="border-t border-border/70 px-1.5 pb-2 pt-1" data-project-files>
                        <label
                          htmlFor="pto-drawing-upload"
                          className={`mb-1.5 block cursor-pointer rounded-lg border border-dashed px-2 py-2 text-center transition-colors ${
                            dragOver
                              ? "border-accent bg-blue-50"
                              : "border-slate-300 bg-white/70 hover:border-accent/60"
                          }`}
                        >
                          <div className="text-[11px] font-semibold text-text">
                            {documents.length === 0 ? UPLOAD_BUTTON_LABEL : "+ файл"}
                          </div>
                        </label>
                        {error ? (
                          <div className="mb-1 rounded bg-red-50 px-2 py-1 text-[10px] text-red-700">
                            {error}
                          </div>
                        ) : null}
                        {uploads.map((item) => (
                          <div
                            key={item.tempId}
                            className="mb-1 rounded border border-border bg-white px-2 py-1"
                          >
                            <div className="flex justify-between gap-1 text-[11px]">
                              <span className="truncate">{item.name}</span>
                              <span className="shrink-0 text-muted">
                                {item.error ?? `${item.progress}%`}
                              </span>
                            </div>
                          </div>
                        ))}
                        {documents.map((doc) => {
                          const elapsedLabel = formatElapsed(doc.pipelineElapsedSec);
                          const uploadedLabel = formatDate(doc.createdAt);
                          return (
                          <div
                            key={doc.id}
                            className={`mb-0.5 flex items-stretch gap-0.5 rounded ${
                              selectedId === doc.id
                                ? "bg-accent/10 ring-1 ring-accent/30"
                                : "hover:bg-white"
                            }`}
                            data-document-row={doc.id}
                          >
                            <button
                              type="button"
                              onClick={() => void openDocument(doc.id)}
                              className={`min-w-0 flex-1 rounded px-1.5 py-1 text-left text-[12px] ${
                                selectedId === doc.id
                                  ? "font-medium text-text"
                                  : "text-muted hover:text-text"
                              }`}
                              title={[
                                doc.originalName,
                                `загружен ${uploadedLabel}`,
                                elapsedLabel ? `обработка ${elapsedLabel}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            >
                              <span className="flex items-center gap-1.5">
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[doc.status]}`}
                                  title={STATUS_LABEL[doc.status]}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1 truncate">{doc.originalName}</span>
                                {doc.kitId ? (
                                  <span
                                    className="shrink-0 rounded border border-accent/30 bg-accent/5 px-1 text-[9px] font-medium text-accent"
                                    title={doc.kitLabel ?? "PDF + DWG"}
                                  >
                                    PDF+DWG
                                  </span>
                                ) : null}
                                {doc.status === "processing" || doc.status === "queued" ? (
                                  <Spinner className="h-2.5 w-2.5 shrink-0 text-sky-700" />
                                ) : null}
                              </span>
                              <span className="mt-0.5 block truncate pl-3 text-[10px] font-normal tabular-nums text-muted">
                                {[
                                  uploadedLabel,
                                  elapsedLabel
                                    ? `обр. ${elapsedLabel}`
                                    : doc.status === "processing" || doc.status === "queued"
                                      ? "обработка…"
                                      : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                            <div className="flex items-start pt-0.5 pr-0.5">
                              <ActionMenu
                                label="Действия файла"
                                align="right"
                                triggerClassName="rounded px-1 py-0.5 text-[11px] leading-none text-muted hover:bg-bg hover:text-text"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={menuItemClass(true)}
                                  onClick={() => void handleDelete(doc.id)}
                                >
                                  Удалить файл
                                </button>
                              </ActionMenu>
                            </div>
                          </div>
                          );
                        })}
                        {!loading && documents.length === 0 && uploads.length === 0 ? (
                          <div className="px-1 py-2 text-center text-[11px] text-muted">
                            Нет файлов — загрузите PDF/DWG
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          </aside>
        )}

        {focusMode || projectsCollapsed ? null : (
          <ColumnResizer
            className="hidden md:block"
            onDelta={(dx) => setProjectsWidth((w) => clamp(w + dx, 200, 420))}
          />
        )}

        {selected ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ReviewPane
            key={selected.id}
            document={selected}
            kitSibling={kitSibling}
            focusMode={focusMode}
            openPage={openPage}
            canceling={cancelingId === selected.id}
            readOnly={false}
            showTech={user.role === "admin"}
            specHref={
              currentProject?.specStoredName
                ? `/api/projects/${currentProject.id}/spec/file`
                : null
            }
            specName={currentProject?.specOriginalName ?? null}
            onGoToLiveJob={
              liveJob && liveJob.documentId !== selected.id
                ? () => {
                    void openLiveJob();
                  }
                : null
            }
            liveJobLabel={
              liveJob && liveJob.documentId !== selected.id
                ? liveJob.label
                : null
            }
            activeJobDocument={
              liveJobDoc &&
              (liveJobDoc.status === "queued" ||
                liveJobDoc.status === "processing" ||
                Boolean(liveJobDoc.errorMessage?.startsWith("Отмена")))
                ? liveJobDoc
                : null
            }
            onFullProgressVisible={setFullProgressVisible}
            headerRight={
              <>
                {visiblePipelineChip ? (
                  <span
                    className={`hidden whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] sm:inline-block ${visiblePipelineChip.className}`}
                    title={visiblePipelineChip.text}
                  >
                    {visiblePipelineChip.text}
                  </span>
                ) : null}
                <UserMenu
                  compact
                  user={user}
                  defaultPasswordWarning={defaultPasswordWarning}
                  onUsers={user.role === "admin" ? () => setShowUsers(true) : undefined}
                  onPassword={() => setShowPassword(true)}
                  onLogout={() => {
                    void (async () => {
                      await fetch("/api/auth/logout", { method: "POST" });
                      onLogout();
                    })();
                  }}
                />
              </>
            }
            onCancel={() => void handleCancel(selected.id)}
            onToggleFocus={() => setFocusMode((value) => !value)}
            onBackToProjects={backToProjects}
            onSavePage={handleSavePage}
            onAnnotationsChanged={() => {
              if (projectId) {
                void loadNotes(projectId);
                void loadDocuments(projectId);
              }
            }}
          />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-[#f4f6f9] p-10 text-center">
            {liveJob ? (
              <button
                type="button"
                onClick={() => void openLiveJob()}
                className="rounded-md border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-100"
              >
                К обработке · {liveJob.label}
              </button>
            ) : null}
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white px-8 py-12 shadow-sm">
              <div className="text-xl font-semibold tracking-tight text-text">
                Проверка чертежей
              </div>
              <div className="mt-2 text-sm leading-relaxed text-muted">
                Загрузите чертежи для расшифровки или откройте ранее созданный проект.
              </div>
              <ul className="mt-4 space-y-1.5 text-left text-xs leading-relaxed text-muted">
                {UPLOAD_HELP_LINES.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="shrink-0 text-accent">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <label
                  htmlFor="pto-drawing-upload"
                  className="inline-flex cursor-pointer items-center justify-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8]"
                >
                  {UPLOAD_BUTTON_LABEL}
                </label>
                <button
                  type="button"
                  onClick={() => openProjectsList()}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-text hover:border-accent hover:text-accent"
                >
                  Открыть проект
                </button>
              </div>
              {projects.length > 0 ? (
                <div className="mt-4 text-xs text-muted">
                  Проектов: {projects.length}
                  {projectsCollapsed ? "" : " · список слева"}
                </div>
              ) : (
                <div className="mt-4 text-xs text-muted">
                  Пока нет проектов — загрузите первый чертёж.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30">
          <div className="rounded-xl bg-white px-8 py-6 text-center shadow-xl">
            <div className="text-base font-medium">Отпустите файлы для расшифровки</div>
            <div className="mt-1 text-sm text-muted">{DRAWING_ACCEPT_HINT}</div>
            <div className="mt-2 text-xs text-muted">
              PDF + DWG — положите оба файла или один ZIP-архив
            </div>
          </div>
        </div>
      ) : null}

      {user.role === "admin" ? (
        <UsersPanel
          open={showUsers}
          currentUserId={user.id}
          onClose={() => setShowUsers(false)}
        />
      ) : null}

      
      <UploadDialog
        open={Boolean(pendingUploadFiles?.length)}
        files={pendingUploadFiles ?? []}
        uploadMode={pendingUploadMode}
        projects={projects}
        defaultProjectId={projectId}
        busy={uploadBusy}
        error={uploadError}
        onClose={() => {
          if (uploadBusy) return;
          setPendingUploadFiles(null);
          setPendingUploadMode("files");
          setUploadError(null);
        }}
        onConfirm={(result) => void confirmUpload(result)}
      />

      <PasswordPanel
        open={showPassword}
        onClose={() => setShowPassword(false)}
        onChanged={() => onPasswordChanged?.()}
      />

      <ToastHost items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
