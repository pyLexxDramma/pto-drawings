import { isPublicUser, requireUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { listReviews } from "@/lib/reviews";
import { buildReviewsXlsx, reviewsFileName } from "@/lib/reviews-export";
import { getProject } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const reviews = await listReviews(id);
  const file = buildReviewsXlsx({ projectName: project.name, reviews });
  const name = reviewsFileName(project.name);
  const encoded = encodeURIComponent(name);
  const ascii = name.replace(/[^\u0020-\u007E]/g, "_") || "reviews.xlsx";

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
