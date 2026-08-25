/** Разбор CSV-геометрии листа DWG/DXF с конвейера. */

export type CadPrimitive = {
  type: "line" | "polyline" | "text";
  layer: string;
  color: string;
  lw: number;
  points: number[];
  text?: string;
  size?: number;
  rot?: number;
  anchor?: string;
  valign?: string;
  width?: number;
};

export type CadBBox = { x0: number; y0: number; x1: number; y1: number };

export type CadGeometry = {
  primitives: CadPrimitive[];
  bbox: CadBBox;
  units: string;
  scale: string;
};

/** RFC 4180: кавычки, удвоенные кавычки, запятые внутри поля. */
export function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(value);
      value = "";
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

export function parseGeometry(csv: string): CadGeometry {
  const lines = csv.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let start = 0;
  if (lines[0]?.startsWith("#")) {
    for (const pair of lines[0].slice(1).split(";")) {
      const [key, value] = pair.split("=");
      if (key && value != null) meta[key.trim()] = value.trim();
    }
    start = 1;
  }
  start += 1; // заголовок колонок
  const primitives: CadPrimitive[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const row = splitCsvRow(raw);
    if (row.length < 5 || !row[0]) continue;
    const type = row[0] as CadPrimitive["type"];
    if (type !== "line" && type !== "polyline" && type !== "text") continue;
    primitives.push({
      type,
      layer: row[1] ?? "",
      color: row[2] || "#000000",
      lw: Number(row[3]) || 0.25,
      points: row[4] ? row[4].trim().split(/\s+/).map(Number) : [],
      text: row[5] || undefined,
      size: row[6] ? Number(row[6]) : undefined,
      rot: row[7] ? Number(row[7]) : 0,
      anchor: row[8] || "left",
      valign: row[9] || "baseline",
      width: row[10] ? Number(row[10]) : undefined,
    });
  }
  const [x0, y0, x1, y1] = (meta.bbox ?? "0,0,1,1").split(",").map(Number);
  return {
    primitives,
    bbox: {
      x0: Number.isFinite(x0) ? x0 : 0,
      y0: Number.isFinite(y0) ? y0 : 0,
      x1: Number.isFinite(x1) ? x1 : 1,
      y1: Number.isFinite(y1) ? y1 : 1,
    },
    units: meta.units ?? "mm",
    scale: meta.scale ?? "",
  };
}

/** Группировка линий/полилиний в path по (цвет, толщина). */
export function groupStrokePaths(primitives: CadPrimitive[]) {
  const groups = new Map<string, string[]>();
  for (const p of primitives) {
    if (p.type === "text") continue;
    if (p.points.length < 4) continue;
    const key = `${p.color}|${p.lw}`;
    const d: string[] = [];
    for (let i = 0; i < p.points.length; i += 2) {
      const x = p.points[i];
      const y = p.points[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      d.push(`${i ? "L" : "M"}${x} ${y}`);
    }
    if (d.length === 0) continue;
    const list = groups.get(key);
    if (list) list.push(d.join(""));
    else groups.set(key, [d.join("")]);
  }
  return groups;
}

/** Переносы в CSV приходят литералом \\n (два символа). */
export function cadTextLines(value: string): string[] {
  return value.split("\\n");
}

export function bboxSize(bbox: CadBBox) {
  return {
    w: Math.max(1e-6, bbox.x1 - bbox.x0),
    h: Math.max(1e-6, bbox.y1 - bbox.y0),
  };
}

/** Доля 0…1 от листа (как у PDF-отметок): Y вверх в чертеже → вниз на экране. */
export function sheetToNorm(
  x: number,
  y: number,
  bbox: CadBBox,
): { x: number; y: number } {
  const { w, h } = bboxSize(bbox);
  return {
    x: (x - bbox.x0) / w,
    y: (bbox.y1 - y) / h,
  };
}
