import { Suspense } from "react";
import { ResolvedReviewsPage } from "@/components/resolved-reviews-page";

export const metadata = { title: "Разобранные замечания" };

export default function ReviewsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
          Загрузка…
        </main>
      }
    >
      <ResolvedReviewsPage />
    </Suspense>
  );
}
