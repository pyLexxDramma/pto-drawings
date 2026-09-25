"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewsTable } from "@/components/reviews-table";
import {
  placeDeepLink,
  showPlaceInOpener,
  type PlacePayload,
} from "@/lib/place-bridge";
import { REVIEW_VERDICT_LABEL, type Project, type ReviewVerdict } from "@/types";

/**
 * Отдельная вкладка «Разобранные». Таблица та же, что на рабочем экране и в
 * выгрузке Excel: колонки, сетка, фильтры, важность. Прыжок по месту уходит
 * в рабочую вкладку, если она ещё открыта.
 */
export function ResolvedReviewsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawProject = searchParams.get("project")?.trim();
  const projectId = rawProject ? rawProject : null;
  const rawVerdict = searchParams.get("verdict")?.trim();
  const initialVerdict =
    rawVerdict && rawVerdict in REVIEW_VERDICT_LABEL
      ? (rawVerdict as ReviewVerdict)
      : null;
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState<PlacePayload | null>(null);

  /**
   * Возврат в рабочую вкладку: сообщение уходит всегда, а вот фокус браузер по
   * `focus()` переводит не всегда. Если фокус остался здесь — закрываем эту
   * вкладку, тогда браузер сам вернёт на рабочую. Не дали закрыть — показываем
   * подсказку с переходом на место здесь.
   */
  const showPlace = useCallback(
    (payload: PlacePayload) => {
      if (!showPlaceInOpener(payload)) {
        router.push(placeDeepLink(payload));
        return;
      }
      window.setTimeout(() => {
        if (!document.hasFocus()) return;
        window.close();
        window.setTimeout(() => setStuck(payload), 300);
      }, 250);
    },
    [router],
  );

  const backToWork = useCallback(() => {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed) {
      router.push(`/?project=${encodeURIComponent(projectId ?? "")}`);
      return;
    }
    opener.focus();
    window.setTimeout(() => {
      if (document.hasFocus()) window.close();
    }, 250);
  }, [projectId, router]);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    fetch("/api/projects", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          throw new Error("Войдите в приложение в рабочей вкладке и обновите страницу");
        }
        if (!response.ok) throw new Error("Не удалось загрузить проект");
        const payload = (await response.json()) as { projects?: Project[] };
        setProjectName(payload.projects?.find((item) => item.id === projectId)?.name ?? "");
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      });
    return () => controller.abort();
  }, [projectId]);

  if (!projectId) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-4 text-sm text-muted">
        Не указан проект. Откройте разобранные замечания из рабочей вкладки.
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-white text-text">
      {stuck ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 pto-t-lg text-amber-900">
          <span>
            Место открыто в рабочей вкладке — браузер не переключил её сам.
          </span>
          <button
            type="button"
            onClick={() => {
              setStuck(null);
              router.push(placeDeepLink(stuck));
            }}
            className="rounded-md border border-amber-400 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
          >
            Открыть место здесь
          </button>
          <button
            type="button"
            onClick={() => setStuck(null)}
            className="text-amber-800 underline decoration-dotted"
          >
            скрыть
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 pto-t-lg text-red-900">
          {error}
        </div>
      ) : null}

      <ReviewsTable
        key={`${projectId}:${initialVerdict ?? "all"}`}
        projectId={projectId}
        projectName={projectName || "проект"}
        standalone
        initialColFilters={
          initialVerdict
            ? { verdict: [REVIEW_VERDICT_LABEL[initialVerdict]] }
            : undefined
        }
        onBack={backToWork}
        onJumpToPage={(documentId, pageNumber, options) =>
          showPlace({
            projectId,
            documentId,
            page: pageNumber,
            reviewId: options?.reviewId,
            quote: options?.quote,
          })
        }
      />
    </main>
  );
}
