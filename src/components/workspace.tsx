"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { ReviewPane } from "@/components/review-pane";
import { formatBytes, formatDate, formatPages } from "@/lib/format";
import {
  STEP_LABEL,
  type DocumentRecord,
  type DocumentStatus,
  type Project,
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
  if (doc.status === "processing" && doc.processingStep) {
    const step = STEP_LABEL[doc.processingStep];
    if (doc.processingPage) {
      return `${step} · ${doc.processingPage}/${doc.pageCount}`;
    }
    return step;
  }
  if (doc.status === "error") return doc.errorMessage || "Ошибка";
  return STATUS_LABEL[doc.status];
}

function kindSummary(doc: DocumentRecord) {
  if (doc.pages.length === 0) return formatPages(doc.pageCount);
  const drawings = doc.pages.filter(
    (page) => page.kind === "drawing" || page.kind === "mixed",
  ).length;
  const tables = doc.pages.filter((page) => page.kind === "table").length;
  const texts = doc.pages.filter((page) => page.kind === "text").length;
  const parts = [
    formatPages(doc.pageCount),
    drawings ? `${drawings} чертеж.` : null,
    tables ? `${tables} табл.` : null,
    texts ? `${texts} текст` : null,
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
    xhr.ontimeout = () => reject(new Error("Сервер не ответил. На Vercel включите Blob Storage."));
    xhr.send(form);
  });
}

export function Workspace() {
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
  const [creatingProject, setCreatingProject] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const selected = documents.find((doc) => doc.id === selectedId) ?? null;
  const currentProject = projects.find((item) => item.id === projectId);
  const busy = documents.some(
    (doc) => doc.status === "queued" || doc.status === "processing",
  );

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error("Не удалось загрузить проекты");
    const payload = (await response.json()) as { projects: Project[] };
    const list = payload.projects ?? [];
    setProjects(list);
    return list;
  }, []);

  const loadDocuments = useCallback(async (id: string) => {
    const response = await fetch(`/api/documents?projectId=${encodeURIComponent(id)}`);
    const payload = (await response.json()) as { documents: DocumentRecord[] };
    setDocuments(payload.documents);
    return payload.documents;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadProjects();
        if (cancelled || list.length === 0) return;
        setProjectId(list[0].id);
        await loadDocuments(list[0].id);
      } catch {
        if (!cancelled) setError("Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments, loadProjects]);

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
    await loadDocuments(id);
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
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!payload.project) throw new Error(payload.error || "Ошибка");
      setNewProjectName("");
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

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      let targetProject = projectId;
      if (!targetProject && projects.length === 1) {
        targetProject = projects[0].id;
        setProjectId(targetProject);
      }
      if (!targetProject) {
        setError("Сначала создайте проект");
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
            setSelectedId(document.id);
            setFilesCollapsed(true);
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
    [projectId, projects],
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
  }

  async function handleRetry(id: string) {
    const response = await fetch(`/api/documents/${id}/process`, { method: "POST" });
    const payload = (await response.json()) as { document?: DocumentRecord };
    if (payload.document) {
      setDocuments((prev) =>
        prev.map((doc) => (doc.id === payload.document!.id ? payload.document! : doc)),
      );
      setSelectedId(id);
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
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-sm font-semibold text-white">
            П
          </div>
          <div>
            <div className="text-sm font-semibold">PTO</div>
            <div className="text-[11px] text-muted">
              PDF → чертёж и текст. Инженер проверяет глазами.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          Загрузить PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </header>

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
                <form onSubmit={handleCreateProject} className="flex gap-1">
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

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={`mx-3 mt-3 rounded-lg border border-dashed px-3 py-4 text-center ${
                dragOver ? "border-accent bg-blue-50" : "border-border bg-bg"
              }`}
            >
              <div className="text-sm font-medium">Перетащите PDF сюда</div>
              <div className="mt-1 text-[11px] text-muted">Обработка начнётся сразу</div>
            </button>

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
                      setSelectedId(doc.id);
                      setFilesCollapsed(true);
                    }}
                    className="w-full px-3 py-2.5 text-left"
                  >
                    <div className="truncate text-sm">{doc.originalName}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted">
                        {kindSummary(doc)} · {formatBytes(doc.sizeBytes)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASS[doc.status]}`}
                      >
                        {statusLine(doc)}
                      </span>
                    </div>
                    {doc.status === "processing" ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{
                            width: `${Math.round(
                              ((doc.processingPage ?? 0) /
                                Math.max(doc.pageCount, 1)) *
                                100,
                            )}%`,
                          }}
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
            document={selected}
            focusMode={focusMode}
            onToggleFocus={() => setFocusMode((value) => !value)}
            onSavePage={handleSavePage}
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
    </div>
  );
}
