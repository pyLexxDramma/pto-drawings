import {
  readReviewsText,
  withDataLock,
  writeReviewsText,
} from "@/lib/persist";
import {
  CROSS_RANK,
  UNKNOWN_RANK,
  isCrossSection,
  knownSectionRank,
} from "@/lib/sections";
import {
  REVIEW_SEVERITY_ORDER,
  type Review,
  type ReviewEvent,
  type ReviewEventField,
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
  "wrong",
];
const origins: ReviewOrigin[] = ["ai", "engineer", "both"];

/** Кто правит замечание — попадает в журнал разбора. */
export type ReviewActor = { userId: string | null; userName: string | null };

/**
 * Журнал не растёт бесконечно: на разборе важны последние решения, а файл
 * проекта читается целиком на каждый запрос таблицы.
 */
const EVENT_LIMIT = 3000;

/**
 * Ранг раздела. Известные — по составу комплекта, незнакомые (шифры РД вроде
 * 250910-ВА-Р-ОВ1) — по порядку первого появления, чтобы не сваливались в конец
 * одной кучей. «Межраздел» всегда последний.
 */
function sectionRanker(items: Review[]): (section: string) => number {
  const firstSeen = new Map<string, string>();
  for (const item of items) {
    const key = item.section.trim().toLowerCase();
    if (knownSectionRank(key) !== null || isCrossSection(key)) continue;
    const seen = firstSeen.get(key);
    if (!seen || item.createdAt < seen) firstSeen.set(key, item.createdAt);
  }
  const order = new Map(
    [...firstSeen.entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([section], index) => [section, UNKNOWN_RANK + index]),
  );

  return (section: string) => {
    const key = section.trim().toLowerCase();
    if (isCrossSection(key)) return CROSS_RANK;
    const known = knownSectionRank(key);
    if (known !== null) return known;
    return order.get(key) ?? UNKNOWN_RANK;
  };
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
    wrongReason: text(raw.wrongReason),
    createdAt: text(raw.createdAt, now) || now,
    updatedAt: text(raw.updatedAt, now) || now,
    authorId: text(raw.authorId) || null,
    authorName: text(raw.authorName) || null,
    needsRecheck: Boolean(raw.needsRecheck),
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

/**
 * Значимые слова формулировки: по ним ищем, к чему прицепить находку ИИ.
 * Слова режем до основы, иначе падежи не совпадут: инженер пишет
 * «с аксонометрией», агент — «аксонометрия даёт».
 */
const STEM_LENGTH = 5;

/**
 * Числа и шифры («310», «К1», «ОВ1», «42.5») короче четырёх букв, но именно
 * они точнее всего указывают, что речь об одном и том же: их оставляем целиком.
 */
function isCode(word: string): boolean {
  return word.length >= 2 && /\d/.test(word);
}

function meaningfulWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}.,\s]/gu, " ")
      .split(/\s+/)
      .map((word) => word.replace(/^[.,]+|[.,]+$/g, ""))
      .filter((word) => word.length > 3 || isCode(word))
      .map((word) => (isCode(word) ? word : word.slice(0, STEM_LENGTH))),
  );
}

const MERGE_MIN_WORDS = 3;
const MERGE_MIN_SHARED = 3;
const MERGE_THRESHOLD = 0.7;

/**
 * Похожесть формулировок. Делим на меньший набор, потому что инженер пишет
 * коротко («площадь КПП не сходится»), а агент — подробно; при делении на
 * объединение такая пара никогда бы не совпала.
 */
function wordOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size < MERGE_MIN_WORDS || right.size < MERGE_MIN_WORDS) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  if (shared < MERGE_MIN_SHARED) return 0;
  return shared / Math.min(left.size, right.size);
}

/** Группировка по разделу, внутри — важное сверху, затем стабильно по дате. */
export function sortReviews(items: Review[]): Review[] {
  const sectionRank = sectionRanker(items);
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

type Store = { reviews: Review[]; events: ReviewEvent[] };

function normalizeEvent(
  raw: Partial<ReviewEvent> & { id: string },
): ReviewEvent {
  return {
    id: raw.id,
    reviewId: text(raw.reviewId),
    field: (raw.field ?? "comment") as ReviewEventField,
    from: text(raw.from),
    to: text(raw.to),
    at: text(raw.at) || new Date().toISOString(),
    userId: text(raw.userId) || null,
    userName: text(raw.userName) || null,
  };
}

async function readStore(projectId: string): Promise<Store> {
  const raw = await readReviewsText(projectId);
  if (!raw) return { reviews: [], events: [] };
  try {
    const parsed = JSON.parse(raw) as { reviews?: unknown; events?: unknown };
    const list = Array.isArray(parsed.reviews) ? parsed.reviews : [];
    const log = Array.isArray(parsed.events) ? parsed.events : [];
    return {
      reviews: list
        .filter(
          (item): item is Partial<Review> & { id: string } =>
            Boolean(item) && typeof (item as { id?: unknown }).id === "string",
        )
        .map((item) => normalizeReview({ ...item, projectId })),
      events: log
        .filter(
          (item): item is Partial<ReviewEvent> & { id: string } =>
            Boolean(item) && typeof (item as { id?: unknown }).id === "string",
        )
        .map((item) => normalizeEvent(item)),
    };
  } catch {
    // Не перезаписываем битый файл молча — иначе потеряем разбор с заказчиком.
    throw new Error(`data/reviews/${projectId}.json повреждён`);
  }
}

async function readAll(projectId: string): Promise<Review[]> {
  return (await readStore(projectId)).reviews;
}

async function writeStore(
  projectId: string,
  items: Review[],
  events: ReviewEvent[],
) {
  const reviews = renumber(items);
  const log = events.slice(0, EVENT_LIMIT);
  await writeReviewsText(
    projectId,
    JSON.stringify({ reviews, events: log }, null, 2),
  );
  return reviews;
}

async function writeAll(projectId: string, items: Review[]) {
  const { events } = await readStore(projectId);
  return writeStore(projectId, items, events);
}

/** Новые записи журнала — сверху: читают всегда последние решения. */
function logEvents(
  events: ReviewEvent[],
  reviewId: string,
  actor: ReviewActor | undefined,
  changes: { field: ReviewEventField; from: string; to: string }[],
): ReviewEvent[] {
  if (changes.length === 0) return events;
  const at = new Date().toISOString();
  const fresh = changes.map((change) => ({
    id: crypto.randomUUID(),
    reviewId,
    field: change.field,
    from: change.from,
    to: change.to,
    at,
    userId: actor?.userId ?? null,
    userName: actor?.userName ?? null,
  }));
  return [...fresh, ...events];
}

export async function listReviews(projectId: string): Promise<Review[]> {
  return withDataLock(async () => renumber(await readAll(projectId)));
}

/** Журнал разбора проекта: кто менял важность, разбор и комментарии. */
export async function listReviewEvents(
  projectId: string,
): Promise<ReviewEvent[]> {
  return withDataLock(async () => (await readStore(projectId)).events);
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
    const { reviews: items, events } = await readStore(projectId);
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
    const saved = await writeStore(
      projectId,
      [...items, review],
      logEvents(
        events,
        review.id,
        { userId: review.authorId, userName: review.authorName },
        [{ field: "created", from: "", to: review.text }],
      ),
    );
    return saved.find((item) => item.id === review.id) ?? review;
  });
}

export async function createReviews(
  projectId: string,
  incoming: Array<{
    section: string;
    text: string;
    severity?: ReviewSeverity;
  }>,
  actor: ReviewActor,
): Promise<{ added: number; skipped: number; reviews: Review[] }> {
  return withDataLock(async () => {
    const { reviews: items, events } = await readStore(projectId);
    const now = new Date().toISOString();
    const seen = new Set(
      items
        .filter((item) => item.origin !== "ai")
        .map((item) => item.text.toLowerCase().replace(/\s+/g, " ").trim()),
    );
    const next = [...items];
    let log = events;
    let added = 0;
    let skipped = 0;
    const created: Review[] = [];
    for (const input of incoming) {
      const textValue = input.text.trim();
      if (!textValue) {
        skipped += 1;
        continue;
      }
      const key = textValue.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      const review = normalizeReview({
        id: crypto.randomUUID(),
        projectId,
        section: input.section,
        origin: "engineer",
        text: textValue,
        severity: input.severity ?? "medium",
        verdict: "pending",
        createdAt: now,
        updatedAt: now,
        authorId: actor.userId,
        authorName: actor.userName,
      });
      next.push(review);
      created.push(review);
      log = logEvents(log, review.id, actor, [
        { field: "created", from: "", to: review.text },
      ]);
      added += 1;
    }
    const saved = await writeStore(projectId, next, log);
    const ids = new Set(created.map((item) => item.id));
    return {
      added,
      skipped,
      reviews: saved.filter((item) => ids.has(item.id)),
    };
  });
}

export type ReviewPatch = {
  severity?: ReviewSeverity;
  verdict?: ReviewVerdict;
  comment?: string;
  wrongReason?: string;
  text?: string;
  section?: string;
};

export async function updateReview(
  projectId: string,
  reviewId: string,
  patch: ReviewPatch,
  actor?: ReviewActor,
): Promise<Review | null> {
  return withDataLock(async () => {
    const { reviews: items, events } = await readStore(projectId);
    const current = items.find((item) => item.id === reviewId);
    if (!current) return null;

    const next: Review = normalizeReview({
      ...current,
      severity: patch.severity ?? current.severity,
      verdict: patch.verdict ?? current.verdict,
      comment: patch.comment ?? current.comment,
      // Причина брака живёт только при вердикте «Неверно»: иначе в таблице
      // остаётся висеть объяснение к статусу, который уже сняли.
      wrongReason:
        (patch.verdict ?? current.verdict) === "wrong"
          ? (patch.wrongReason ?? current.wrongReason)
          : "",
      text: patch.text ?? current.text,
      section: patch.section ?? current.section,
      updatedAt: new Date().toISOString(),
    });

    const changes: { field: ReviewEventField; from: string; to: string }[] = [];
    if (next.severity !== current.severity) {
      changes.push({
        field: "severity",
        from: current.severity,
        to: next.severity,
      });
    }
    if (next.verdict !== current.verdict) {
      changes.push({
        field: "verdict",
        from: current.verdict,
        // Причину брака пишем в тот же переход: без неё запись бесполезна.
        to: next.wrongReason ? `${next.verdict}: ${next.wrongReason}` : next.verdict,
      });
    }
    if (next.comment !== current.comment) {
      changes.push({ field: "comment", from: current.comment, to: next.comment });
    }
    if (next.text !== current.text) {
      changes.push({ field: "text", from: current.text, to: next.text });
    }
    if (next.section !== current.section) {
      changes.push({ field: "section", from: current.section, to: next.section });
    }

    const saved = await writeStore(
      projectId,
      items.map((item) => (item.id === reviewId ? next : item)),
      logEvents(events, reviewId, actor, changes),
    );
    return saved.find((item) => item.id === reviewId) ?? next;
  });
}

export async function deleteReview(
  projectId: string,
  reviewId: string,
  actor?: ReviewActor,
): Promise<boolean> {
  return withDataLock(async () => {
    const { reviews: items, events } = await readStore(projectId);
    const current = items.find((item) => item.id === reviewId);
    if (!current) return false;
    await writeStore(
      projectId,
      items.filter((item) => item.id !== reviewId),
      logEvents(events, reviewId, actor, [
        { field: "deleted", from: current.text || current.aiFinding, to: "" },
      ]),
    );
    return true;
  });
}

export type IngestResult = {
  added: number;
  updated: number;
  /** Сколько находок прицепилось к замечаниям, заведённым руками. */
  enriched: number;
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
    const byId = new Map(items.map((item) => [item.id, item]));
    const idByKey = new Map(items.map((item) => [ingestKey(item), item.id]));

    /**
     * Замечания инженеров без пути в ПД: агент дописывает им файл и страницу,
     * а не создаёт рядом дубль. Точное совпадение строк тут не работает —
     * человек и агент формулируют по-разному.
     */
    const manual = items
      .filter((item) => item.origin !== "ai" && item.text)
      .map((item) => ({
        id: item.id,
        section: item.section.toLowerCase().trim(),
        words: meaningfulWords(item.text),
      }));

    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;
    let enriched = 0;

    function rememberKey(review: Review) {
      idByKey.set(ingestKey(review), review.id);
    }

    for (const raw of incoming) {
      const candidate = {
        section: text(raw.section, "прочее") || "прочее",
        aiFinding: text(raw.aiFinding) || text(raw.text),
        locations: Array.isArray(raw.locations)
          ? raw.locations.map((item) => normalizeLocation(item ?? {}))
          : [],
      };
      if (!candidate.aiFinding && !raw.reviewId) continue;

      const exactId = idByKey.get(ingestKey(candidate));
      let existing = raw.reviewId ? byId.get(raw.reviewId) : undefined;
      if (!existing && exactId) existing = byId.get(exactId);
      let isEnrichment = Boolean(raw.reviewId && existing);

      if (!existing) {
        // Ищем формулировку инженера про то же самое в том же разделе.
        const words = meaningfulWords(
          `${candidate.aiFinding} ${text(raw.text)}`,
        );
        const section = candidate.section.toLowerCase().trim();
        let best: { id: string; score: number } | null = null;
        for (const item of manual) {
          if (item.section !== section) continue;
          const score = wordOverlap(item.words, words);
          if (score < MERGE_THRESHOLD) continue;
          if (!best || score > best.score) best = { id: item.id, score };
        }
        if (best) {
          existing = byId.get(best.id);
          isEnrichment = true;
          // Одна находка на одно ручное замечание.
          const index = manual.findIndex((item) => item.id === best.id);
          if (index >= 0) manual.splice(index, 1);
        }
      }

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
          needsRecheck: Boolean(raw.needsRecheck),
          verdict: "pending",
          createdAt: now,
          updatedAt: now,
        });
        byId.set(review.id, review);
        rememberKey(review);
        added += 1;
        continue;
      }

      // Текст инженера и цитаты можно уточнять, вердикт и комментарий — нет.
      const merged: Review = normalizeReview({
        ...existing,
        // Обогащение: агент проставляет раздел. Пустой section не затирает уже стоящий.
        section:
          isEnrichment && text(raw.section)
            ? candidate.section
            : existing.section,
        // Формулировку инженера агент не перебивает, свою — уточняет.
        text:
          existing.origin === "ai"
            ? text(raw.text) || existing.text
            : existing.text || text(raw.text),
        aiFinding: candidate.aiFinding,
        locations: candidate.locations.length
          ? candidate.locations
          : existing.locations,
        needsRecheck:
          raw.needsRecheck ??
          (candidate.locations.length ? false : existing.needsRecheck),
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
      byId.set(merged.id, merged);
      rememberKey(merged);
      if (isEnrichment) enriched += 1;
      else updated += 1;
    }

    const saved = await writeAll(projectId, [...byId.values()]);
    return { added, updated, enriched, total: saved.length };
  });
}
