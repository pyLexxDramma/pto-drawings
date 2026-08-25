"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "@/types";

export type UploadDialogResult = {
  /** Id проекта или `__new__:Имя` для создания */
  projectId: string;
  title: string;
  files: File[];
};

type UploadDialogProps = {
  open: boolean;
  files: File[];
  projects: Project[];
  defaultProjectId: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (result: UploadDialogResult) => void;
};

function defaultTitle(files: File[]) {
  if (files.length !== 1) return "";
  return files[0].name.replace(/\.(pdf|dwg|dxf)$/i, "");
}

export function UploadDialog({
  open,
  files,
  projects,
  defaultProjectId,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}: UploadDialogProps) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle(files));
    const initial =
      defaultProjectId ||
      (projects.length === 1 ? projects[0].id : "") ||
      "";
    setProjectId(initial);
    setMode(projects.length === 0 ? "create" : "existing");
    setNewProjectName("");
  }, [open, files, projects, defaultProjectId]);

  if (!open || files.length === 0) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const displayTitle = title.trim() || defaultTitle(files);
    if (mode === "create") {
      const name = newProjectName.trim();
      if (!name) return;
      onConfirm({
        projectId: `__new__:${name}`,
        title: displayTitle,
        files,
      });
      return;
    }
    if (!projectId) return;
    onConfirm({
      projectId,
      title: displayTitle,
      files,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Загрузка файла</div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs text-muted hover:text-text disabled:opacity-50"
          >
            Отмена
          </button>
        </div>

        <div className="mb-3 rounded-md border border-border bg-bg px-3 py-2 text-xs text-muted">
          {files.length === 1
            ? files[0].name
            : `${files.length} файла(ов): ${files.map((f) => f.name).join(", ")}`}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {files.length === 1 ? (
            <label className="block text-xs text-muted">
              Название файла
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
                placeholder="Без расширения .pdf / .dwg / .dxf"
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
          ) : (
            <div className="text-xs text-muted">
              Для нескольких файлов имена остаются как у исходных файлов. Выберите
              или создайте проект.
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs text-muted">Проект</div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                disabled={busy || projects.length === 0}
                onClick={() => setMode("existing")}
                className={`rounded-md border px-2.5 py-1 ${
                  mode === "existing"
                    ? "border-accent bg-accent/10 font-medium text-accent"
                    : "border-border text-muted hover:text-text"
                } disabled:opacity-40`}
              >
                Выбрать
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("create")}
                className={`rounded-md border px-2.5 py-1 ${
                  mode === "create"
                    ? "border-accent bg-accent/10 font-medium text-accent"
                    : "border-border text-muted hover:text-text"
                }`}
              >
                Создать новый
              </button>
            </div>

            {mode === "existing" ? (
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={busy || projects.length === 0}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
              >
                <option value="">Выберите проект…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                disabled={busy}
                placeholder="Название нового проекта"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            )}
          </div>

          {error ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={
              busy ||
              (mode === "existing" ? !projectId : !newProjectName.trim())
            }
            className="w-full rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-60"
          >
            {busy ? "Загрузка…" : "Загрузить"}
          </button>
        </form>
      </div>
    </div>
  );
}
