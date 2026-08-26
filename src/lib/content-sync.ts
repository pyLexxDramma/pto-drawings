/** Сопоставление блоков markdown с зонами текста на чертеже для синхронного скролла. */

export type PageTextRegion = {
  id: string;
  text: string;
  /** Верх зоны, доля высоты листа 0..1 */
  y: number;
  /** Высота зоны, доля 0..1 */
  h: number;
};

export type MarkdownBlock = {
  id: string;
  text: string;
  source: string;
};

const BOILERPLATE =
  /^(страница|лист|штамп|цветовая разметка|\*{2}цветовая разметка|\-\-\-)/i;

export function normalizeForMatch(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\*\*/g, "")
    .replace(/[_*`#>|]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoilerplate(text: string): boolean {
  if (text.length < 4) return true;
  if (BOILERPLATE.test(text)) return true;
  if (/^страница\s+\d+$/i.test(text)) return true;
  return false;
}

/** Разбивает markdown на блоки, совпадающие с тем, что рендерит MarkdownView. */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  let buf: string[] = [];

  function push(source: string) {
    const text = normalizeForMatch(source);
    if (text.length < 4 || isBoilerplate(text)) return;
    blocks.push({ id: `b-${blocks.length}`, text, source });
  }

  function flushParagraph() {
    if (!buf.length) return;
    push(buf.join("\n"));
    buf = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.includes("|")) {
      flushParagraph();
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        if (!/^\|[\s\-:|]+\|$/.test(row)) push(row);
        i += 1;
      }
      continue;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      flushParagraph();
      push(trimmed);
      i += 1;
      continue;
    }

    if (!trimmed || trimmed === "---") {
      flushParagraph();
      i += 1;
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      flushParagraph();
      push(trimmed);
      i += 1;
      continue;
    }

    buf.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks;
}

function matchScore(blockText: string, regionText: string): number {
  if (!blockText || !regionText) return 0;
  const a = blockText;
  const b = regionText;
  if (a === b) return 1;
  if (a.length >= 8 && b.includes(a)) return 0.95;
  if (b.length >= 8 && a.includes(b)) return 0.9;
  const probe = a.slice(0, Math.min(48, a.length));
  if (probe.length >= 6 && b.includes(probe)) return 0.85;
  const wordsA = a.split(" ").filter((w) => w.length > 2);
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!wordsA.length) return 0;
  let hit = 0;
  for (const w of wordsA) if (wordsB.has(w)) hit += 1;
  return hit / wordsA.length;
}

/** blockId → y (центр зоны на листе, 0..1). */
export function matchBlocksToRegions(
  blocks: MarkdownBlock[],
  regions: PageTextRegion[],
): Map<string, number> {
  const map = new Map<string, number>();
  if (!blocks.length || !regions.length) return map;

  const used = new Set<string>();
  for (const block of blocks) {
    let best: { id: string; score: number; y: number } | null = null;
    for (const region of regions) {
      if (used.has(region.id)) continue;
      const score = matchScore(block.text, region.text);
      if (score < 0.45) continue;
      const y = region.y + region.h * 0.5;
      if (!best || score > best.score) {
        best = { id: region.id, score, y };
      }
    }
    if (best) {
      used.add(best.id);
      map.set(block.id, best.y);
    }
  }
  return map;
}

export function nearestBlockForAnchorY(
  y: number,
  anchors: Map<string, number>,
): string | null {
  let best: { id: string; dist: number } | null = null;
  for (const [id, ay] of anchors) {
    const dist = Math.abs(ay - y);
    if (!best || dist < best.dist) best = { id, dist };
  }
  return best && best.dist < 0.2 ? best.id : null;
}

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

/** Кластеризация текстовых фрагментов PDF.js в строки и абзацы. */
export function regionsFromPdfTextContent(
  items: PdfTextItem[],
  viewport: { width: number; height: number; transform: number[] },
): PageTextRegion[] {
  const vt = viewport.transform;
  const lines: Array<{ text: string; y: number; h: number }> = [];

  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const t = item.transform;
    const a = vt[0] * t[0] + vt[2] * t[1];
    const c = vt[0] * t[2] + vt[2] * t[3];
    const d = vt[1] * t[2] + vt[3] * t[3];
    const e = vt[0] * t[4] + vt[2] * t[5] + vt[4];
    const f = vt[1] * t[4] + vt[3] * t[5] + vt[5];
    const fontHeight = Math.max(1, Math.hypot(c, d));
    const y = (f - fontHeight) / viewport.height;
    const h = fontHeight / viewport.height;
    lines.push({ text: item.str.trim(), y, h });
  }

  if (!lines.length) return [];
  lines.sort((a, b) => a.y - b.y || a.text.localeCompare(b.text));

  const merged: Array<{ parts: string[]; y: number; h: number }> = [];
  for (const line of lines) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y + last.h - line.y) < 0.012) {
      last.parts.push(line.text);
      last.h = Math.max(last.h, line.y + line.h - last.y);
    } else {
      merged.push({ parts: [line.text], y: line.y, h: line.h });
    }
  }

  const regions: PageTextRegion[] = [];
  let cluster: typeof merged = [];

  function flushCluster() {
    if (!cluster.length) return;
    const text = normalizeForMatch(cluster.map((c) => c.parts.join(" ")).join(" "));
    if (text.length >= 4) {
      const y = cluster[0].y;
      const bottom = cluster[cluster.length - 1].y + cluster[cluster.length - 1].h;
      regions.push({
        id: `r-${regions.length}`,
        text,
        y: Math.max(0, y),
        h: Math.max(0.008, bottom - y),
      });
    }
    cluster = [];
  }

  for (const row of merged) {
    if (cluster.length && row.y - (cluster[cluster.length - 1].y + cluster[cluster.length - 1].h) > 0.025) {
      flushCluster();
    }
    cluster.push(row);
  }
  flushCluster();
  return regions;
}

/** Текстовые примитивы CAD → зоны на листе. */
export function regionsFromCadTexts(
  texts: Array<{ text?: string; points: number[]; size?: number }>,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): PageTextRegion[] {
  const h = Math.max(1e-6, bbox.y1 - bbox.y0);
  const regions: PageTextRegion[] = [];
  for (const t of texts) {
    const raw = t.text?.trim();
    if (!raw || t.points.length < 2) continue;
    const text = normalizeForMatch(raw.replace(/\\P/g, " "));
    if (text.length < 4) continue;
    const yNorm = (bbox.y1 - t.points[1]) / h;
    const th = Math.max(0.008, (t.size ?? 2.5) / h);
    regions.push({
      id: `r-${regions.length}`,
      text,
      y: Math.max(0, Math.min(1, yNorm - th * 0.15)),
      h: th * Math.max(1, raw.split(/\\P|\n/).length),
    });
  }
  regions.sort((a, b) => a.y - b.y);
  return regions;
}

/** Нормализованная Y-координата «линии чтения» в видимой области чертежа. */
export function visibleAnchorY(
  panY: number,
  scale: number,
  naturalH: number,
  viewH: number,
  pad = 8,
  readLine = 0.28,
): number {
  const contentY = (viewH * readLine - panY) / scale;
  return Math.min(1, Math.max(0, contentY / Math.max(1, naturalH)));
}

/** pan.y для показа anchorY на readLine viewport. */
export function panYForAnchor(
  anchorY: number,
  scale: number,
  naturalH: number,
  viewH: number,
  pad = 8,
  readLine = 0.28,
): number {
  const targetY = anchorY * naturalH * scale;
  return pad - targetY + viewH * readLine;
}
