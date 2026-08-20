"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { PasswordPanel } from "@/components/password-panel";
import { ReviewPane } from "@/components/review-pane";
import { PtoLogo } from "@/components/pto-logo";
import { UsersPanel } from "@/components/users-panel";
import { formatBytes, formatDate, formatPages } from "@/lib/format";
import {
  KIND_LABEL,
  ROLE_LABEL,
  STEP_LABEL,
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
  queued: "bg-amber-50 text-amber-700",
  processing: "bg-sky-50 text-sky-700",
  done: "bg-emerald-50 text-emerald-700",
  error: "bg-red-50 text-red-700",
};

function statusLine(doc: DocumentRecord) {
  if (doc.status === "queued" || doc.status === "processing") {
    const ready = `${doc.readyPages}/${Math.max(doc.pageCount, 1)}`;
    if (doc.status === "processing" && doc.processingStep) {
      const step = STEP_LABEL[doc.processingStep];
      if (doc.processingPage) {
        return `${ready} · лист ${doc.processingPage}: ${step.toLowerCase()}`;
      }
      return `${ready} · ${step.toLowerCase()}`;
    }
    return `${ready} · в очереди`;
  }
  if (doc.status === "error") return doc.errorMessage || "Ошибка";
  return STATUS_LABEL[doc.status];
}

function pageProgress(doc: DocumentRecord) {
  return Math.round((doc.readyPages / Math.max(doc.pageCount, 1)) * 100);
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

function uploadPdf(
  file: File,
  projectId: string,
  onProgress: (value: number) => void,
) {
  return new Promise<DocumentRecord>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);
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
  const [filesCollapsed, setFilesCollapsed] = useState(false);
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
  const [showNotes, setShowNotes] = useState(false);
  const [openPage, setOpenPage] = useState<{
    nonce: number;
    page: number;
    documentId: string;
  } | null>(null);
  const specInputRef = useRef<HTMLInputElement>(null);

  const selected = documents.find((doc) => doc.id === selectedId) ?? null;
  const currentProject = projects.find((item) => item.id === projectId);
  const busy = documents.some(
    (doc) => doc.status === "queued" || doc.status === "processing",
  );

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

  const loadDocuments = useCallback(async (id: string, signal?: AbortSignal) => {
    const response = await fetch(
      `/api/documents?projectId=${encodeURIComponent(id)}&lite=1`,
      { signal },
    );
    const payload = (await response.json()) as { documents: DocumentRecord[] };
    const list = payload.documents ?? [];
    setDocuments((prev) => {
      const prevById = new Map(prev.map((doc) => [doc.id, doc]));
      return list.map((lite) => {
        const existing = prevById.get(lite.id);
        if (
          existing &&
          existing.status === lite.status &&
          existing.pages.some((page) => page.markdown.length > 0)
        ) {
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

  const openDocument = useCallback(async (id: string) => {
    setSelectedId(id);
    setOpenPage(null);
    setFilesCollapsed(true);
    try {
      const response = await fetch(`/api/documents/${id}`);
      if (!response.ok) return;
      const payload = (await response.json()) as { document?: DocumentRecord };
      if (!payload.document) return;
      setDocuments((prev) => {
        const exists = prev.some((doc) => doc.id === payload.document!.id);
        if (!exists) return [payload.document!, ...prev];
        return prev.map((doc) =>
          doc.id === payload.document!.id ? payload.document! : doc,
        );
      });
    } catch {
      // список уже есть; полный текст подтянется при повторе
    }
  }, []);

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
    if (!projectId || !busy) return;
    const timer = setInterval(() => {
      void loadDocuments(projectId);
    }, 900);
    return () => clearInterval(timer);
  }, [busy, loadDocuments, projectId]);

  async function selectProject(id: string) {
    setProjectId(id);
    setSelectedId(null);
    setFilesCollapsed(false);
    setFocusMode(false);
    setError(null);
    const project = projects.find((item) => item.id === id);
    setDescriptionDraft(project?.description ?? "");
    setShowEdits(false);
    setShowNotes(false);
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

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      let targetProject = projectId;
      if (!targetProject && projects.length === 1) {
        targetProject = projects[0].id;
        setProjectId(targetProject);
      }
      if (!targetProject) {
        setError(
          projects.length > 0
            ? "Выберите проект слева, затем загрузите PDF"
            : "Сначала создайте проект",
        );
        return;
      }
      const files = Array.from(fileList).filter(
        (file) =>
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf"),
      );
      if (files.length === 0) {
        setError("Можно загружать только PDF");
        return;
      }
      setError(null);
      const items: UploadItem[] = files.map((file) => ({
        tempId: crypto.randomUUID(),
        name: file.name,
        progress: 0,
      }));
      setUploads((prev) => [...items, ...prev]);

      await Promise.all(
        files.map(async (file, index) => {
          const tempId = items[index].tempId;
          try {
            const document = await uploadPdf(file, targetProject, (progress) => {
              setUploads((prev) =>
                prev.map((item) =>
                  item.tempId === tempId ? { ...item, progress } : item,
                ),
              );
            });
            setUploads((prev) => prev.filter((item) => item.tempId !== tempId));
            setDocuments((prev) => [
              document,
              ...prev.filter((doc) => doc.id !== document.id),
            ]);
            void openDocument(document.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Ошибка загрузки";
            setUploads((prev) =>
              prev.map((item) =>
                item.tempId === tempId ? { ...item, error: message } : item,
              ),
            );
          }
        }),
      );
    },
    [openDocument, projectId, projects],
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
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Не удалось удалить файл");
      return;
    }
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (projectId) void loadEdits(projectId);
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

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files);
  }

  const gridClass = focusMode
    ? "grid min-h-0 flex-1 grid-cols-1"
    : filesCollapsed
      ? "grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_44px_minmax(0,1fr)]"
      : "grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_280px_minmax(0,1fr)]";

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
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setFocusMode(false);
            setFilesCollapsed(false);
            setOpenPage(null);
          }}
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
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden text-right text-[11px] sm:block">
            <div className="font-medium text-text">{user.displayName}</div>
            <div className="text-muted">{ROLE_LABEL[user.role]}</div>
          </div>
          {user.role === "admin" ? (
            <button
              type="button"
              onClick={() => setShowUsers(true)}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-bg"
            >
              Пользователи
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            className={`rounded-md border px-2.5 py-1.5 text-xs hover:bg-bg ${
              defaultPasswordWarning ? "border-amber-400 bg-amber-50 text-amber-800" : "border-border"
            }`}
          >
            Пароль
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                onLogout();
              })();
            }}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-bg"
          >
            Выйти
          </button>
          <label
            htmlFor="pto-drawing-upload"
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8]"
          >
            Загрузить PDF
          </label>
        </div>
        <input
          id="pto-drawing-upload"
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="absolute h-px w-px overflow-hidden opacity-0"
          onChange={(event) => {
            const list = event.target.files;
            if (list && list.length > 0) void handleFiles(list);
            event.target.value = "";
          }}
        />
      </header>

      {defaultPasswordWarning ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          У аккаунта <span className="font-medium">admin</span> всё ещё стандартный
          пароль. Смените его кнопкой «Пароль» до выдачи доступов команде.
        </div>
      ) : null}

      <div className={gridClass}>
        {focusMode ? null : (
          <aside className="flex min-h-0 flex-col border-b border-border bg-surface md:border-r md:border-b-0">
            <div className="border-b border-border px-3 py-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted">
                Проекты
                <button
                  type="button"
                  onClick={() => setShowNewProject((value) => !value)}
                  className="rounded border border-border px-1.5 text-[11px] font-normal normal-case text-muted hover:text-text"
                >
                  +
                </button>
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
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
                    className="mb-1 w-full rounded-md border border-accent bg-white px-2.5 py-2 text-sm outline-none"
                  />
                ) : (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      if (project.id === projectId) {
                        setRenameId(project.id);
                        setRenameValue(project.name);
                        return;
                      }
                      void selectProject(project.id);
                    }}
                    className={`mb-1 w-full rounded-md px-2.5 py-2 text-left text-sm ${
                      project.id === projectId
                        ? "bg-blue-50 text-text"
                        : "text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                    title="Ещё раз нажмите, чтобы переименовать"
                  >
                    <span className="block truncate">{project.name}</span>
                    {project.description ? (
                      <span className="mt-0.5 block truncate text-[11px] font-normal text-muted">
                        {project.description}
                      </span>
                    ) : null}
                  </button>
                ),
              )}
            </div>
          </aside>
        )}

        {focusMode ? null : filesCollapsed ? (
          <button
            type="button"
            onClick={() => setFilesCollapsed(false)}
            className="border-b border-border bg-white text-xs text-muted hover:bg-bg md:border-r md:border-b-0"
            title="Показать файлы"
          >
            <span className="inline-block px-1 py-3 [writing-mode:vertical-rl]">Файлы</span>
          </button>
        ) : (
          <section className="flex min-h-0 flex-col border-b border-border bg-white md:border-r md:border-b-0">
            <div className="flex items-start justify-between border-b border-border px-3 py-3">
              <div>
                <div className="text-sm font-medium">
                  {currentProject?.name ?? "Проект"}
                </div>
                <div className="text-[11px] text-muted">
                  {formatPages(documents.reduce((sum, doc) => sum + doc.pageCount, 0))} в{" "}
                  {documents.length} файл(ах)
                </div>
              </div>
              {selected ? (
                <button
                  type="button"
                  onClick={() => setFilesCollapsed(true)}
                  className="text-[11px] text-muted hover:text-text"
                >
                  Скрыть
                </button>
              ) : null}
            </div>

            {currentProject ? (
              <div className="space-y-2 border-b border-border px-3 py-3">
                <textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  onBlur={() => void commitDescription()}
                  rows={2}
                  placeholder="Описание комплекта"
                  className="w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none placeholder:text-muted focus:border-accent"
                />
                <div className="rounded-md border border-border bg-bg px-2 py-2">
                  <div className="text-[11px] font-medium text-muted">ТЗ (PDF)</div>
                  {currentProject.specOriginalName ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <a
                        href={`/api/projects/${currentProject.id}/spec/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs text-accent hover:underline"
                      >
                        {currentProject.specOriginalName}
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleClearSpec()}
                        className="shrink-0 text-[11px] text-red-600 hover:underline"
                      >
                        Убрать
                      </button>
                    </div>
                  ) : (
                    <label
                      htmlFor="pto-spec-upload"
                      className="mt-1 inline-block cursor-pointer text-xs text-accent hover:underline"
                    >
                      Прикрепить ТЗ
                    </label>
                  )}
                  <input
                    id="pto-spec-upload"
                    ref={specInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="absolute h-px w-px overflow-hidden opacity-0"
                    onChange={(event) => {
                      void handleSpecFile(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>
                <div>
                  <input
                    value={projectQuery}
                    onChange={(event) => {
                      const value = event.target.value;
                      setProjectQuery(value);
                      setHits([]);
                      setSearching(value.trim().length >= 2);
                    }}
                    placeholder="Поиск по всем листам проекта"
                    className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none placeholder:text-muted focus:border-accent"
                  />
                  {projectQuery.trim().length >= 2 ? (
                    <div className="mt-1 max-h-44 space-y-1 overflow-auto">
                      {searching ? (
                        <div className="text-[11px] text-muted">Ищем…</div>
                      ) : hits.length === 0 ? (
                        <div className="text-[11px] text-muted">Ничего не нашли.</div>
                      ) : (
                        hits.map((hit) => (
                          <button
                            key={`${hit.documentId}-${hit.pageNumber}`}
                            type="button"
                            onClick={() => jumpToPage(hit.documentId, hit.pageNumber)}
                            className="block w-full rounded bg-white px-2 py-1 text-left text-[11px] hover:bg-blue-50"
                          >
                            <span className="font-medium">{hit.originalName}</span>
                            <span className="text-muted">
                              {" "}
                              · лист {hit.pageNumber} · {KIND_LABEL[hit.kind].toLowerCase()}
                            </span>
                            <span className="mt-0.5 block truncate text-muted">
                              {hit.snippet}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowEdits((value) => {
                      const next = !value;
                      if (next && projectId) void loadEdits(projectId);
                      return next;
                    });
                  }}
                  className="text-[11px] text-muted hover:text-text"
                >
                  Правки по объекту: {edits.length}
                </button>
                {showEdits ? (
                  <div className="max-h-36 space-y-1 overflow-auto">
                    {edits.length === 0 ? (
                      <div className="text-[11px] text-muted">Пока никто не правил текст.</div>
                    ) : (
                      edits.slice(0, 40).map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => jumpToPage(entry.documentId, entry.pageNumber)}
                          className="block w-full rounded bg-white px-2 py-1 text-left text-[11px] hover:bg-blue-50"
                        >
                          <span className="font-medium">{entry.originalName}</span>
                          <span className="text-muted">
                            {" "}
                            · лист {entry.pageNumber}
                            {entry.userName ? ` · ${entry.userName}` : ""}
                            {" · "}
                            {formatDate(entry.createdAt)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setShowNotes((value) => {
                      const next = !value;
                      if (next && projectId) void loadNotes(projectId);
                      return next;
                    });
                  }}
                  className="text-[11px] text-muted hover:text-text"
                >
                  Замечания: {notes.filter((item) => item.status === "open").length} открытых
                  {notes.length ? ` из ${notes.length}` : ""}
                </button>
                {showNotes ? (
                  <div className="max-h-36 space-y-1 overflow-auto">
                    {notes.length === 0 ? (
                      <div className="text-[11px] text-muted">
                        Замечаний нет. Отметьте ошибку прямо на чертеже.
                      </div>
                    ) : (
                      notes.slice(0, 40).map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          onClick={() => jumpToPage(note.documentId, note.pageNumber)}
                          className="block w-full rounded bg-white px-2 py-1 text-left text-[11px] hover:bg-blue-50"
                        >
                          <span
                            className={
                              note.status === "open" ? "text-red-600" : "text-emerald-600"
                            }
                          >
                            {note.status === "open" ? "открыто" : "исправлено"}
                          </span>
                          <span className="text-muted">
                            {" · "}
                            {note.originalName} · лист {note.pageNumber}
                            {note.userName ? ` · ${note.userName}` : ""}
                          </span>
                          <span className="mt-0.5 block truncate">{note.comment}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <label
              htmlFor="pto-drawing-upload"
              className={`mx-3 mt-3 block cursor-pointer rounded-lg border border-dashed px-3 py-4 text-center ${
                dragOver ? "border-accent bg-blue-50" : "border-border bg-bg"
              }`}
            >
              <div className="text-sm font-medium">Перетащите PDF сюда или нажмите</div>
              <div className="mt-1 text-[11px] text-muted">Чертежи проекта · обработка начнётся сразу</div>
            </label>

            {error ? (
              <div className="mx-3 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading ? <div className="text-sm text-muted">Загрузка…</div> : null}

              {uploads.map((item) => (
                <div
                  key={item.tempId}
                  className="mb-2 rounded-md border border-border bg-bg px-3 py-2"
                >
                  <div className="flex justify-between text-sm">
                    <span className="truncate pr-2">{item.name}</span>
                    <span className="text-xs text-muted">
                      {item.error ?? `${item.progress}%`}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full ${item.error ? "bg-red-500" : "bg-accent"}`}
                      style={{ width: `${item.error ? 100 : item.progress}%` }}
                    />
                  </div>
                </div>
              ))}

              {!loading && documents.length === 0 && uploads.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">
                  Перетащите PDF в проект
                </div>
              ) : null}

              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className={`mb-2 rounded-md border ${
                    selectedId === doc.id
                      ? "border-accent bg-blue-50"
                      : "border-transparent bg-bg hover:border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void openDocument(doc.id);
                    }}
                    className="w-full px-3 py-2.5 text-left"
                  >
                    <div className="truncate text-sm">{doc.originalName}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted">
                        {kindSummary(doc)} · {formatBytes(doc.sizeBytes)}
                        {doc.viewedCounts[user.id]
                          ? ` · просмотрено ${doc.viewedCounts[user.id]}/${Math.max(doc.pageCount, 1)}`
                          : ""}
                        {doc.openAnnotations
                          ? ` · ${doc.openAnnotations} замечаний`
                          : ""}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASS[doc.status]}`}
                      >
                        {statusLine(doc)}
                      </span>
                    </div>
                    {doc.status === "processing" || doc.status === "queued" ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${pageProgress(doc)}%` }}
                        />
                      </div>
                    ) : null}
                  </button>
                  <div className="flex justify-between px-3 pb-2 text-[11px] text-muted">
                    <span>{formatDate(doc.createdAt)}</span>
                    <span className="flex gap-2">
                      {doc.status === "error" ? (
                        <button
                          type="button"
                          onClick={() => void handleRetry(doc.id)}
                          className="text-accent hover:underline"
                        >
                          Повтор
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDelete(doc.id)}
                        className="text-red-600 hover:underline"
                      >
                        Удалить
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {selected ? (
          <ReviewPane
            key={selected.id}
            document={selected}
            focusMode={focusMode}
            openPage={openPage}
            onToggleFocus={() => setFocusMode((value) => !value)}
            onBackToProjects={() => {
              setSelectedId(null);
              setFocusMode(false);
              setFilesCollapsed(false);
              setOpenPage(null);
            }}
            onSavePage={handleSavePage}
            onAnnotationsChanged={() => {
              if (projectId) {
                void loadNotes(projectId);
                void loadDocuments(projectId);
              }
            }}
          />
        ) : (
          <div className="flex min-h-0 items-center justify-center bg-[#f7f8fa] p-8 text-center text-sm text-muted">
            Загрузите PDF — слева появится чертёж, справа текст этого листа.
          </div>
        )}
      </div>

      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30">
          <div className="rounded-xl bg-white px-8 py-6 text-center shadow-xl">
            <div className="text-base font-medium">Отпустите PDF для загрузки</div>
            <div className="mt-1 text-sm text-muted">
              {projects.length === 1
                ? `В проект «${projects[0].name}»`
                : "Обработка начнётся сразу"}
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

      <PasswordPanel
        open={showPassword}
        onClose={() => setShowPassword(false)}
        onChanged={() => onPasswordChanged?.()}
      />
    </div>
  );
}
