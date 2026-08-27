"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UPLOAD_HELP_LINES } from "@/lib/drawing-files";
import type { Project } from "@/types";

export type UploadDialogResult = {
  /** Id проекта или `__new__:Имя` для создания */
  projectId: string;
  title: string;
  files: File[];
};

type UploadMode = "files" | "kit-zip" | "kit-pair";

type UploadDialogProps = {
  open: boolean;
  files: File[];
  uploadMode?: UploadMode;
  projects: Project[];
  defaultProjectId: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (result: UploadDialogResult) => void;
};

function defaultTitle(files: File[], mode: UploadMode) {
  if (mode === "kit-zip" && files[0]) {
    return files[0].name.replace(/\.zip$/i, "");
  }
  if (mode === "kit-pair" && files[0]) {
    return files[0].name.replace(/\.(pdf|dwg|dxf)$/i, "");
  }
  if (files.length !== 1) return "";
  return files[0].name.replace(/\.(pdf|dwg|dxf)$/i, "");
}

export function UploadDialog({
  open,
  files,
  uploadMode = "files",
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
    setTitle(defaultTitle(files, uploadMode));
    const initial =
      defaultProjectId ||
      (projects.length === 1 ? projects[0].id : "") ||
      "";
    setProjectId(initial);
    setMode(projects.length === 0 ? "create" : "existing");
    setNewProjectName("");
  }, [open, files, projects, defaultProjectId, uploadMode]);

  if (!open || files.length === 0) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const displayTitle = title.trim() || defaultTitle(files, uploadMode);
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
          <div className="text-sm font-semibold">
            {uploadMode === "files" ? "Загрузка файла" : "Загрузка комплекта PDF + DWG"}
          </div>
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
          {uploadMode === "kit-zip"
            ? `Архив: ${files[0]?.name ?? ""}`
            : uploadMode === "kit-pair"
              ? `Комплект: ${files.map((f) => f.name).join(" + ")}`
              : files.length === 1
                ? files[0].name
                : `${files.length} файла(ов): ${files.map((f) => f.name).join(", ")}`}
        </div>

        <div
          className={`mb-3 rounded-md border px-3 py-2 text-xs leading-relaxed ${
            uploadMode === "files"
              ? "border-border bg-bg text-muted"
              : "border-accent/20 bg-accent/5 text-text"
          }`}
        >
          {uploadMode === "kit-zip" ? (
            <>
              <div className="font-medium text-text">Комплект PDF + DWG из архива</div>
              <div className="mt-1">
                Оба файла будут обработаны и связаны. Текст расшифровки — из PDF; чертёж DWG
                откроется переключателем PDF / DWG при просмотре.
              </div>
            </>
          ) : uploadMode === "kit-pair" ? (
            <>
              <div className="font-medium text-text">Комплект PDF + DWG</div>
              <div className="mt-1">
                Файлы загрузятся вместе, а не по отдельности. Расшифровка — из PDF, DWG — для
                сверки чертежа (переключатель в просмотре).
              </div>
            </>
          ) : (
            <>
              <div className="font-medium text-text">Что будет после загрузки</div>
              <ul className="mt-1 space-y-1">
                {UPLOAD_HELP_LINES.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {uploadMode !== "files" || files.length === 1 ? (
            <label className="block text-xs text-muted">
              {uploadMode === "files" ? "Название файла" : "Название комплекта"}
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
                placeholder={
                  uploadMode === "files"
                    ? "Без расширения .pdf / .dwg / .dxf"
                    : "Имя комплекта в списке файлов"
                }
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
            {busy ? "Загрузка…" : uploadMode === "files" ? "Загрузить" : "Загрузить комплект"}
          </button>
        </form>
      </div>
    </div>
  );
}
