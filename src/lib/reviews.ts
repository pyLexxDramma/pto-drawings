import {
  readReviewsText,
  withDataLock,
  writeReviewsText,
} from "@/lib/persist";
import {
  REVIEW_SEVERITY_ORDER,
  type Review,
  type ReviewIngestItem,
  type ReviewLocation,
  type ReviewOrigin,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/types";

const severities: ReviewSeverity[] = ["high", "medium", "low", "skip"];
const verdicts: ReviewVerdict[] = [
  "pending",
  "confirmed",
  "partial",
  "discuss",
  "outdated",
];
const origins: ReviewOrigin[] = ["ai", "engineer", "both"];

/** Порядок разделов ПД: в таблице и выгрузке идём как в комплекте. */
const SECTION_ORDER = [
  "ПЗ",
  "ПЗУ",
  "АР1",
  "АР2",
  "АР3",
  "АР4",
  "АР5",
  "КР1",
  "КР2",
  "КР3",
  "КР4",
  "ИОС1",
  "ИОС2",
  "ИОС3",
  "ИОС4",
  "ИОС5",
  "ПОС",
  "ПБ",
  "ТБЭ",
  "ОДИ",
  "межраздел",
];

function sectionRank(section: string): number {
  const index = SECTION_ORDER.indexOf(section);
  return index < 0 ? SECTION_ORDER.length : index;
}

function severityRank(severity: ReviewSeverity): number {
  return REVIEW_SEVERITY_ORDER.indexOf(severity);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeLocation(raw: Partial<ReviewLocation>): ReviewLocation {
  const page =
    typeof raw.pageNumber === "number" && Number.isFinite(raw.pageNumber)
      ? Math.max(1, Math.trunc(raw.pageNumber))
      : null;
  return {
    documentId: text(raw.documentId) || null,
    documentName: text(raw.documentName),
    pageNumber: page,
    quote: text(raw.quote),
  };
}

function normalizeReview(raw: Partial<Review> & { id: string }): Review {
  const now = new Date().toISOString();
  return {
    id: raw.id,
    projectId: text(raw.projectId),
    number: typeof raw.number === "number" ? raw.number : 0,
    section: text(raw.section, "прочее") || "прочее",
    origin: origins.includes(raw.origin as ReviewOrigin)
      ? (raw.origin as ReviewOrigin)
      : "ai",
    text: text(raw.text),
    aiFinding: text(raw.aiFinding),
    locations: Array.isArray(raw.locations)
      ? raw.locations.map((item) => normalizeLocation(item ?? {}))
      : [],
    severity: severities.includes(raw.severity as ReviewSeverity)
      ? (raw.severity as ReviewSeverity)
      : "medium",
    verdict: verdicts.includes(raw.verdict as ReviewVerdict)
      ? (raw.verdict as ReviewVerdict)
      : "pending",
    comment: text(raw.comment),
    createdAt: text(raw.createdAt, now) || now,
    updatedAt: text(raw.updatedAt, now) || now,
    authorId: text(raw.authorId) || null,
    authorName: text(raw.authorName) || null,
  };
}

/**
 * Ключ дедупликации: раздел + находка ИИ + места в ПД. Повторный прогон агента
 * обновляет найденное, а не плодит дубли и не сбрасывает разбор с заказчиком.
 */
function ingestKey(item: {
  section: string;
  aiFinding: string;
  locations: ReviewLocation[];
}): string {
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const places = item.locations
    .map((loc) => `${flat(loc.documentName)}#${loc.pageNumber ?? "-"}`)
    .sort()
    .join("|");
  return `${flat(item.section)}::${flat(item.aiFinding)}::${places}`;
}

/** Группировка по разделу, внутри — важное сверху, затем стабильно по дате. */
export function sortReviews(items: Review[]): Review[] {
  return [...items].sort((a, b) => {
    const bySection = sectionRank(a.section) - sectionRank(b.section);
    if (bySection !== 0) return bySection;
    if (a.section !== b.section) return a.section.localeCompare(b.section, "ru");
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function renumber(items: Review[]): Review[] {
  return sortReviews(items).map((item, index) => ({
    ...item,
    number: index + 1,
  }));
}

async function readAll(projectId: string): Promise<Review[]> {
  const raw = await readReviewsText(projectId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { reviews?: unknown };
    const list = Array.isArray(parsed.reviews) ? parsed.reviews : [];
    return list
      .filter(
        (item): item is Partial<Review> & { id: string } =>
          Boolean(item) && typeof (item as { id?: unknown }).id === "string",
      )
      .map((item) => normalizeReview({ ...item, projectId }));
  } catch {
    // Не перезаписываем битый файл молча — иначе потеряем разбор с заказчиком.
    throw new Error(`data/reviews/${projectId}.json повреждён`);
  }
}

async function writeAll(projectId: string, items: Review[]) {
  const reviews = renumber(items);
  await writeReviewsText(projectId, JSON.stringify({ reviews }, null, 2));
  return reviews;
}

export async function listReviews(projectId: string): Promise<Review[]> {
  return withDataLock(async () => renumber(await readAll(projectId)));
}

export async function createReview(
  projectId: string,
  input: {
    section: string;
    text: string;
    aiFinding?: string;
    severity?: ReviewSeverity;
    locations?: ReviewLocation[];
    origin?: ReviewOrigin;
    authorId?: string | null;
    authorName?: string | null;
  },
): Promise<Review> {
  return withDataLock(async () => {
    const items = await readAll(projectId);
    const now = new Date().toISOString();
    const review = normalizeReview({
      id: crypto.randomUUID(),
      projectId,
      section: input.section,
      origin: input.origin ?? "engineer",
      text: input.text,
      aiFinding: input.aiFinding ?? "",
      severity: input.severity ?? "medium",
      locations: input.locations ?? [],
      verdict: "pending",
      createdAt: now,
      updatedAt: now,
      authorId: input.authorId ?? null,
      authorName: input.authorName ?? null,
    });
    const saved = await writeAll(projectId, [...items, review]);
    return saved.find((item) => item.id === review.id) ?? review;
  });
}

export type ReviewPatch = {
  severity?: ReviewSeverity;
  verdict?: ReviewVerdict;
  comment?: string;
  text?: string;
  section?: string;
};

export async function updateReview(
  projectId: string,
  reviewId: string,
  patch: ReviewPatch,
): Promise<Review | null> {
  return withDataLock(async () => {
    const items = await readAll(projectId);
    const current = items.find((item) => item.id === reviewId);
    if (!current) return null;

    const next: Review = normalizeReview({
      ...current,
      severity: patch.severity ?? current.severity,
      verdict: patch.verdict ?? current.verdict,
      comment: patch.comment ?? current.comment,
      text: patch.text ?? current.text,
      section: patch.section ?? current.section,
      updatedAt: new Date().toISOString(),
    });

    const saved = await writeAll(
      projectId,
      items.map((item) => (item.id === reviewId ? next : item)),
    );
    return saved.find((item) => item.id === reviewId) ?? next;
  });
}

export async function deleteReview(
  projectId: string,
  reviewId: string,
): Promise<boolean> {
  return withDataLock(async () => {
    const items = await readAll(projectId);
    if (!items.some((item) => item.id === reviewId)) return false;
    await writeAll(
      projectId,
      items.filter((item) => item.id !== reviewId),
    );
    return true;
  });
}

export type IngestResult = {
  added: number;
  updated: number;
  total: number;
};

/**
 * Пакетный приём от агента конвейера. Разбор человека (verdict, comment,
 * правленая важность) сохраняется — агент обновляет только свою часть.
 */
export async function ingestReviews(
  projectId: string,
  incoming: ReviewIngestItem[],
): Promise<IngestResult> {
  return withDataLock(async () => {
    const items = await readAll(projectId);
    const byKey = new Map(items.map((item) => [ingestKey(item), item]));
    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;

    for (const raw of incoming) {
      const candidate = {
        section: text(raw.section, "прочее") || "прочее",
        aiFinding: text(raw.aiFinding),
        locations: Array.isArray(raw.locations)
          ? raw.locations.map((item) => normalizeLocation(item ?? {}))
          : [],
      };
      if (!candidate.aiFinding) continue;

      const key = ingestKey(candidate);
      const existing = byKey.get(key);

      if (!existing) {
        const review = normalizeReview({
          id: crypto.randomUUID(),
          projectId,
          section: candidate.section,
          origin: raw.origin ?? "ai",
          text: text(raw.text),
          aiFinding: candidate.aiFinding,
          severity: raw.severity ?? "medium",
          locations: candidate.locations,
          verdict: "pending",
          createdAt: now,
          updatedAt: now,
        });
        byKey.set(key, review);
        added += 1;
        continue;
      }

      // Текст инженера и цитаты можно уточнять, вердикт и комментарий — нет.
      const merged: Review = normalizeReview({
        ...existing,
        text: text(raw.text) || existing.text,
        locations: candidate.locations.length
          ? candidate.locations
          : existing.locations,
        origin:
          existing.origin === "engineer" && (raw.origin ?? "ai") === "ai"
            ? "both"
            : (raw.origin ?? existing.origin),
        // Важность агента применяем только пока замечание не разобрали.
        severity:
          existing.verdict === "pending" && raw.severity
            ? raw.severity
            : existing.severity,
        updatedAt: now,
      });
      byKey.set(key, merged);
      updated += 1;
    }

    const saved = await writeAll(projectId, [...byKey.values()]);
    return { added, updated, total: saved.length };
  });
}
