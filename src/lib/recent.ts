/** Недавние проекты и «продолжить с листа» в localStorage. */

export type RecentProject = {
  id: string;
  name: string;
  at: string;
  documentId?: string;
  page?: number;
  documentName?: string;
};

const RECENT_KEY = "pto:recent-projects";
const MAX_RECENT = 8;

export function loadRecentProjects(): RecentProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentProject[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string");
  } catch {
    return [];
  }
}

export function touchRecentProject(entry: RecentProject) {
  if (typeof window === "undefined") return;
  try {
    const prev = loadRecentProjects().filter((item) => item.id !== entry.id);
    const next = [{ ...entry, at: new Date().toISOString() }, ...prev].slice(
      0,
      MAX_RECENT,
    );
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function rememberContinue(
  projectId: string,
  projectName: string,
  documentId: string,
  documentName: string,
  page: number,
) {
  touchRecentProject({
    id: projectId,
    name: projectName,
    at: new Date().toISOString(),
    documentId,
    documentName,
    page,
  });
}

export function printNotesReport(input: {
  projectName: string;
  notes: Array<{
    originalName: string;
    pageNumber: number;
    status: string;
    comment: string;
    expected: string;
    userName: string | null;
    createdAt: string;
  }>;
}) {
  const rows = input.notes
    .map(
      (note) => `
      <tr>
        <td>${escapeHtml(note.originalName)}</td>
        <td>${note.pageNumber}</td>
        <td>${note.status === "open" ? "открыто" : "исправлено"}</td>
        <td>${escapeHtml(note.comment)}</td>
        <td>${escapeHtml(note.expected || "—")}</td>
        <td>${escapeHtml(note.userName || "—")}</td>
        <td>${escapeHtml(note.createdAt)}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Замечания — ${escapeHtml(input.projectName)}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #1c2330; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: #6b7380; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #e2e7ee; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #eef1f5; }
    @media print {
      body { margin: 12mm; }
    }
  </style>
</head>
<body>
  <h1>Замечания по объекту «${escapeHtml(input.projectName)}»</h1>
  <div class="meta">Сформировано: ${new Date().toLocaleString("ru-RU")} · всего ${input.notes.length}</div>
  <table>
    <thead>
      <tr>
        <th>Файл</th><th>Лист</th><th>Статус</th><th>Комментарий</th>
        <th>Ожидалось</th><th>Автор</th><th>Создано</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="7">Замечаний нет</td></tr>`}</tbody>
  </table>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;

  const win = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
