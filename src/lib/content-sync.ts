/** Сопоставление блоков markdown с зонами текста на чертеже для синхронного скролла. */

export type PageTextRegion = {
  id: string;
  text: string;
  /** Левый край, доля ширины листа 0..1 */
  x: number;
  /** Верх зоны, доля высоты листа 0..1 */
  y: number;
  /** Ширина зоны, доля 0..1 */
  w: number;
  /** Высота зоны, доля 0..1 */
  h: number;
};

export type MarkdownBlock = {
  id: string;
  text: string;
  source: string;
};

export type BlockRegionLinks = {
  /** blockId → зона на чертеже */
  byBlock: Map<string, PageTextRegion>;
  /** regionId → blockId */
  byRegion: Map<string, string>;
  /** blockId → Y центра зоны (для скролла) */
  anchors: Map<string, number>;
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

function labelProbe(blockText: string): string {
  // EN-метка до тире/перевода: "24 dia sump pit ... — сливной колодец"
  const before = blockText.split(/\s+[—–]\s+/)[0]?.trim() ?? blockText;
  const cut = before.split(/\s+-\s+(?=[а-яё])/i)[0]?.trim() ?? before;
  return cut.slice(0, 64);
}

/** Цифровой «отпечаток» — работает даже при битой кириллице в PDF. */
function digitFingerprint(text: string): string {
  return (text.match(/\d+/g) ?? []).join(" ");
}

function latinOnly(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSheetMapRow(text: string): boolean {
  return (
    /^(текст|таблица|заголовок|штамп|спецификация)(\s|$)/.test(text) &&
    /(север|юг|центр|восток|запад|северо|юго)/.test(text)
  );
}

function isMetaBlock(text: string): boolean {
  if (
    /^(файл|тип листа|карта листа|описание листа|описание|что это|якоря|извлечение)(\s|$)/.test(
      text,
    )
  ) {
    return true;
  }
  if (/^блок где на листе/.test(text)) return true;
  return isSheetMapRow(text);
}

function matchScore(blockText: string, regionText: string): number {
  if (!blockText || !regionText) return 0;
  const a = blockText;
  const b = regionText;
  if (a === b) return 1;
  if (a.length >= 8 && b.includes(a)) return 0.95;
  if (b.length >= 8 && a.includes(b)) return 0.9;

  // Цифры (даты, № СРО, размеры) переживают битую кодировку PDF.
  const da = digitFingerprint(a);
  const db = digitFingerprint(b);
  if (da.length >= 4 && db.length >= 4) {
    if (da === db) return 0.88;
    if (db.includes(da) || da.includes(db)) return 0.8;
    const aset = new Set(da.split(" ").filter((x) => x.length >= 2));
    const bset = new Set(db.split(" ").filter((x) => x.length >= 2));
    if (aset.size && bset.size) {
      let hit = 0;
      for (const x of aset) if (bset.has(x)) hit += 1;
      const ratio = hit / Math.min(aset.size, bset.size);
      if (ratio >= 0.7 && hit >= 2) return 0.55 + ratio * 0.25;
    }
  }

  const la = latinOnly(a);
  const lb = latinOnly(b);
  if (la.length >= 6 && lb.length >= 6) {
    if (lb.includes(la) || la.includes(lb)) return 0.86;
    const wordsA = la.split(" ").filter((w) => w.length > 2);
    const wordsB = new Set(lb.split(" ").filter((w) => w.length > 2));
    if (wordsA.length >= 2) {
      let hit = 0;
      for (const w of wordsA.slice(0, 10)) if (wordsB.has(w)) hit += 1;
      const ratio = hit / Math.min(wordsA.length, 10);
      if (ratio >= 0.6) return 0.5 + ratio * 0.35;
    }
  }

  const label = labelProbe(a);
  if (label.length >= 6) {
    if (b.includes(label)) return 0.92;
    const labelWords = label.split(" ").filter((w) => w.length > 2);
    if (labelWords.length >= 2) {
      const bSet = new Set(b.split(" ").filter((w) => w.length > 2));
      let hit = 0;
      for (const w of labelWords) if (bSet.has(w)) hit += 1;
      const ratio = hit / labelWords.length;
      if (ratio >= 0.7) return 0.7 + ratio * 0.2;
    }
  }

  const probe = a.slice(0, Math.min(48, a.length));
  if (probe.length >= 6 && b.includes(probe)) return 0.85;
  const wordsA = a.split(" ").filter((w) => w.length > 2);
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!wordsA.length) return 0;
  // Для двуязычных блоков сравниваем в основном «левую» (чертежную) половину слов.
  const focus = wordsA.slice(0, Math.min(12, Math.ceil(wordsA.length * 0.55)));
  let hit = 0;
  for (const w of focus) if (wordsB.has(w)) hit += 1;
  return hit / focus.length;
}

/** blockId ↔ зона на чертеже. */
export function linkBlocksToRegions(
  blocks: MarkdownBlock[],
  regions: PageTextRegion[],
): BlockRegionLinks {
  const byBlock = new Map<string, PageTextRegion>();
  const byRegion = new Map<string, string>();
  const anchors = new Map<string, number>();
  if (!blocks.length || !regions.length) {
    return { byBlock, byRegion, anchors };
  }

  const used = new Set<string>();
  // Сначала самые короткие/конкретные блоки — лучше цепляются к меткам на чертеже.
  const ordered = [...blocks].sort(
    (a, b) => labelProbe(a.text).length - labelProbe(b.text).length,
  );
  for (const block of ordered) {
    if (isMetaBlock(block.text)) continue;
    let best: { region: PageTextRegion; score: number } | null = null;
    for (const region of regions) {
      if (used.has(region.id)) continue;
      const score = matchScore(block.text, region.text);
      if (score < 0.35) continue;
      if (!best || score > best.score) best = { region, score };
    }
    if (best) {
      used.add(best.region.id);
      byBlock.set(block.id, best.region);
      byRegion.set(best.region.id, block.id);
      anchors.set(block.id, best.region.y + best.region.h * 0.5);
    }
  }

  // Fallback: битая кодировка PDF — сопоставляем оставшиеся блоки и зоны по порядку сверху вниз.
  const leftoverBlocks = blocks.filter(
    (b) => !byBlock.has(b.id) && !isMetaBlock(b.text) && b.text.length >= 8,
  );
  const leftoverRegions = [...regions]
    .filter((r) => !used.has(r.id))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const n = Math.min(leftoverBlocks.length, leftoverRegions.length);
  for (let i = 0; i < n; i += 1) {
    const block = leftoverBlocks[i];
    const region = leftoverRegions[i];
    byBlock.set(block.id, region);
    byRegion.set(region.id, block.id);
    anchors.set(block.id, region.y + region.h * 0.5);
    used.add(region.id);
  }

  return { byBlock, byRegion, anchors };
}

/** @deprecated — используйте linkBlocksToRegions().anchors */
export function matchBlocksToRegions(
  blocks: MarkdownBlock[],
  regions: PageTextRegion[],
): Map<string, number> {
  return linkBlocksToRegions(blocks, regions).anchors;
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

/** Зона под точкой на листе (нормализованные 0..1). */
export function regionAtPoint(
  regions: PageTextRegion[],
  x: number,
  y: number,
): PageTextRegion | null {
  let best: PageTextRegion | null = null;
  let bestArea = Infinity;
  for (const region of regions) {
    if (x < region.x || x > region.x + region.w) continue;
    if (y < region.y || y > region.y + region.h) continue;
    const area = region.w * region.h;
    if (area < bestArea) {
      best = region;
      bestArea = area;
    }
  }
  return best;
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
  const lines: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];

  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const t = item.transform;
    const a = vt[0] * t[0] + vt[2] * t[1];
    const b = vt[1] * t[0] + vt[3] * t[1];
    const c = vt[0] * t[2] + vt[2] * t[3];
    const d = vt[1] * t[2] + vt[3] * t[3];
    const e = vt[0] * t[4] + vt[2] * t[5] + vt[4];
    const f = vt[1] * t[4] + vt[3] * t[5] + vt[5];
    const fontHeight = Math.max(1, Math.hypot(c, d));
    const width = Math.max(1, (item.width ?? 0) * Math.hypot(a, b));
    lines.push({
      text: item.str.trim(),
      x: e / viewport.width,
      y: (f - fontHeight) / viewport.height,
      w: width / viewport.width,
      h: fontHeight / viewport.height,
    });
  }

  if (!lines.length) return [];
  lines.sort((a, b) => a.y - b.y || a.x - b.x);

  const merged: Array<{
    parts: string[];
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];
  for (const line of lines) {
    const last = merged[merged.length - 1];
    // Склеиваем только соседние куски одной строки / одного вызова (близко по Y и X).
    const sameLine =
      last &&
      Math.abs(last.y - line.y) < 0.01 &&
      line.x <= last.x + last.w + 0.04;
    if (sameLine && last) {
      last.parts.push(line.text);
      const right = Math.max(last.x + last.w, line.x + line.w);
      last.x = Math.min(last.x, line.x);
      last.w = right - last.x;
      last.h = Math.max(last.h, line.h);
    } else {
      merged.push({
        parts: [line.text],
        x: line.x,
        y: line.y,
        w: Math.max(0.02, line.w),
        h: line.h,
      });
    }
  }

  const regions: PageTextRegion[] = [];
  let cluster: typeof merged = [];

  function flushCluster() {
    if (!cluster.length) return;
    const text = normalizeForMatch(cluster.map((c) => c.parts.join(" ")).join(" "));
    if (text.length >= 3) {
      const x0 = Math.min(...cluster.map((c) => c.x));
      const y0 = cluster[0].y;
      const x1 = Math.max(...cluster.map((c) => c.x + c.w));
      const y1 = cluster[cluster.length - 1].y + cluster[cluster.length - 1].h;
      // Небольшой запас, чтобы зона кликабельно покрывала метку.
      const padX = 0.006;
      const padY = 0.004;
      regions.push({
        id: `r-${regions.length}`,
        text,
        x: Math.max(0, Math.min(1, x0 - padX)),
        y: Math.max(0, Math.min(1, y0 - padY)),
        w: Math.max(0.02, Math.min(1, x1 + padX) - Math.max(0, x0 - padX)),
        h: Math.max(0.01, y1 - y0 + padY * 2),
      });
    }
    cluster = [];
  }

  for (const row of merged) {
    const prev = cluster[cluster.length - 1];
    const gap = prev ? row.y - (prev.y + prev.h) : 0;
    const overlapX =
      prev &&
      row.x < prev.x + prev.w + 0.08 &&
      row.x + row.w > prev.x - 0.08;
    // Узкие кластеры: только продолжение одного выноса/подписи, не весь лист.
    if (cluster.length && (gap > 0.018 || !overlapX)) {
      flushCluster();
    }
    cluster.push(row);
  }
  flushCluster();
  // Also keep short standalone lines as their own regions (метки на чертеже).
  for (const row of merged) {
    const text = normalizeForMatch(row.parts.join(" "));
    if (text.length >= 6 && text.length <= 80) {
      const exists = regions.some(
        (r) => Math.abs(r.y - row.y) < 0.008 && Math.abs(r.x - row.x) < 0.02,
      );
      if (!exists) {
        regions.push({
          id: `r-${regions.length}`,
          text,
          x: Math.max(0, row.x - 0.004),
          y: Math.max(0, row.y - 0.003),
          w: Math.max(0.02, Math.min(1, row.w + 0.008)),
          h: Math.max(0.01, row.h + 0.006),
        });
      }
    }
  }
  regions.sort((a, b) => a.y - b.y || a.x - b.x);
  return regions;
}

/** Текстовые примитивы CAD → зоны на листе. */
export function regionsFromCadTexts(
  texts: Array<{
    text?: string;
    points: number[];
    size?: number;
    width?: number;
    anchor?: string;
  }>,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): PageTextRegion[] {
  const bw = Math.max(1e-6, bbox.x1 - bbox.x0);
  const bh = Math.max(1e-6, bbox.y1 - bbox.y0);
  const regions: PageTextRegion[] = [];
  for (const t of texts) {
    const raw = t.text?.trim();
    if (!raw || t.points.length < 2) continue;
    const text = normalizeForMatch(raw.replace(/\\P/g, " "));
    if (text.length < 4) continue;
    const th = Math.max(0.008, (t.size ?? 2.5) / bh);
    const tw = Math.max(
      0.02,
      (t.width ?? raw.length * (t.size ?? 2.5) * 0.55) / bw,
    );
    const ox = (t.points[0] - bbox.x0) / bw;
    const oy = (bbox.y1 - t.points[1]) / bh;
    const x =
      t.anchor === "center"
        ? ox - tw / 2
        : t.anchor === "right"
          ? ox - tw
          : ox;
    regions.push({
      id: `r-${regions.length}`,
      text,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, oy - th * 0.15)),
      w: Math.min(1, tw),
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
