import fs from "fs";

const path = "src/components/workspace.tsx";
let s = fs.readFileSync(path, "utf8");

const startMarker = '            <div className="min-h-0 flex-1 overflow-y-auto p-2">';
const afterProjectsAside = `        {focusMode || projectsCollapsed ? null : (
          <ColumnResizer
            className="hidden md:block"
            onDelta={(dx) => setProjectsWidth((w) => clamp(w + dx, 160, 420))}
          />
        )}`;

const start = s.indexOf(startMarker);
const asideEnd = s.indexOf(afterProjectsAside);
if (start < 0 || asideEnd < 0) {
  console.error("projects markers", start, asideEnd);
  process.exit(1);
}

const nested = `            <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-projects-tree>
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
                    className={\`mb-1 rounded-md \${
                      project.id === projectId
                        ? "bg-blue-50/80 ring-1 ring-accent/20"
                        : "hover:bg-surface-2"
                    }\`}
                    data-project-row={project.id}
                  >
                    <div className="flex items-stretch gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          void selectProject(project.id);
                        }}
                        className={\`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm \${
                          project.id === projectId ? "text-text" : "text-muted hover:text-text"
                        }\`}
                        title="Открыть файлы проекта"
                        aria-expanded={project.id === projectId}
                      >
                        <span className="flex items-center gap-1">
                          <span className="text-[10px] text-muted">
                            {project.id === projectId ? "▾" : "▸"}
                          </span>
                          <span className="truncate font-medium">{project.name}</span>
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
                          className={\`mb-1.5 block cursor-pointer rounded-lg border border-dashed px-2 py-2 text-center transition-colors \${
                            dragOver
                              ? "border-accent bg-blue-50"
                              : "border-slate-300 bg-white/70 hover:border-accent/60"
                          }\`}
                        >
                          <div className="text-[11px] font-semibold text-text">
                            {documents.length === 0 ? "Загрузить файл" : "+ файл"}
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
                                {item.error ?? \`\${item.progress}%\`}
                              </span>
                            </div>
                          </div>
                        ))}
                        {documents.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => void openDocument(doc.id)}
                            className={\`mb-0.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] \${
                              selectedId === doc.id
                                ? "bg-accent/10 font-medium text-text ring-1 ring-accent/30"
                                : "text-muted hover:bg-white hover:text-text"
                            }\`}
                            title={doc.originalName}
                          >
                            <span
                              className={\`h-1.5 w-1.5 shrink-0 rounded-full \${STATUS_DOT[doc.status]}\`}
                              title={STATUS_LABEL[doc.status]}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate">{doc.originalName}</span>
                            {doc.status === "processing" || doc.status === "queued" ? (
                              <Spinner className="h-2.5 w-2.5 shrink-0 text-sky-700" />
                            ) : null}
                          </button>
                        ))}
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

`;

s = s.slice(0, start) + nested + s.slice(asideEnd);

// Remove files panel: from filesCollapsed rail through files ColumnResizer
const filesStart = s.indexOf(
  "        {focusMode ? null : filesCollapsed ? (",
);
const filesEndMarker = `        {focusMode || filesCollapsed ? null : (
          <ColumnResizer
            className="hidden md:block"
            onDelta={(dx) => setFilesWidth((w) => clamp(w + dx, 200, 520))}
          />
        )}

`;
const filesEnd = s.indexOf(filesEndMarker);
if (filesStart < 0 || filesEnd < 0) {
  console.error("files markers", filesStart, filesEnd);
  process.exit(1);
}
s =
  s.slice(0, filesStart) +
  s.slice(filesEnd + filesEndMarker.length);

// Widen projects resizer clamp
s = s.replace(
  "onDelta={(dx) => setProjectsWidth((w) => clamp(w + dx, 160, 420))}",
  "onDelta={(dx) => setProjectsWidth((w) => clamp(w + dx, 200, 420))}",
);

// Empty state copy
s = s.replace(
  'Файлы выбранного проекта в колонке слева. Можно загрузить ещё PDF, DWG или DXF.',
  "Раскройте проект слева и выберите файл — или загрузите новый PDF, DWG или DXF.",
);
s = s.replace(
  "Перетащите PDF, DWG или DXF сюда или выберите файл — список появится в колонке проекта слева.",
  "Выберите проект слева или загрузите PDF, DWG или DXF — файлы появятся в дереве проекта.",
);
s = s.replace(
  '{documents.length > 0 ? "Откройте файл слева" : "Загрузить чертёж"}',
  '{documents.length > 0 ? "Откройте файл в проекте слева" : "Загрузить чертёж"}',
);

// Remove obsolete filesCollapsed toggles in empty state
s = s.replace(
  /\s*\{filesCollapsed \? \([\s\S]*?\) : \([\s\S]*?Скрыть файлы[\s\S]*?\)\}/g,
  "",
);

fs.writeFileSync(path, s);
console.log("workspace rewritten", s.length);
