import { NextResponse } from "next/server";
import { isPublicUser, requireUser } from "@/lib/auth";
import {
  listBranchTips,
  listReleaseCommits,
  listReleaseStarts,
  recordAppStart,
} from "@/lib/releases";
import { listReviewEvents, listReviews } from "@/lib/reviews";
import {
  listDocuments,
  listProjectAnnotations,
  listProjectEdits,
  listProjects,
} from "@/lib/storage";
import type { ReviewEvent } from "@/types";

/**
 * Журналы правок для админа: кто и что менял. Отдаём по одному разделу за
 * запрос — иначе на большом проекте пришлось бы читать все тела документов
 * ради одной вкладки.
 */

export type AuditKind = "reviews" | "edits" | "marks" | "files" | "releases";

const KINDS: AuditKind[] = ["reviews", "edits", "marks", "files", "releases"];
const LIMIT = 300;

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!isPublicUser(user)) return user;
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Только для админа" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") as AuditKind | null;
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "Неизвестный раздел журнала" }, { status: 400 });
  }

  if (kind === "releases") {
    await recordAppStart();
    const [commits, starts, branches] = await Promise.all([
      listReleaseCommits(60),
      listReleaseStarts(),
      listBranchTips(40),
    ]);
    return NextResponse.json({ kind, commits, starts, branches });
  }

  const projects = await listProjects();
  const projectName = new Map(projects.map((item) => [item.id, item.name]));

  if (kind === "files") {
    const documents = await listDocuments(undefined, { lite: true });
    const rows = documents
      .map((doc) => ({
        at: doc.createdAt,
        project: projectName.get(doc.projectId) ?? "—",
        name: doc.originalName,
        sizeBytes: doc.sizeBytes,
        pages: doc.pageCount,
        status: doc.status,
        pipelineMode: doc.pipelineMode,
        pipelineModel: doc.pipelineModel,
        elapsedSec: doc.pipelineElapsedSec,
        userName: doc.authorName ?? null,
      }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, LIMIT);
    return NextResponse.json({ kind, rows });
  }

  if (kind === "reviews") {
    const rows: (ReviewEvent & {
      project: string;
      reviewNumber: number | null;
      section: string | null;
    })[] = [];
    for (const project of projects) {
      const [events, reviews] = await Promise.all([
        listReviewEvents(project.id),
        listReviews(project.id),
      ]);
      const byId = new Map(reviews.map((item) => [item.id, item]));
      for (const event of events) {
        const review = byId.get(event.reviewId);
        rows.push({
          ...event,
          project: project.name,
          reviewNumber: review?.number ?? null,
          section: review?.section ?? null,
        });
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({ kind, rows: rows.slice(0, LIMIT) });
  }

  if (kind === "edits") {
    const rows = [];
    for (const project of projects) {
      const edits = await listProjectEdits(project.id);
      for (const edit of edits) {
        rows.push({
          at: edit.createdAt,
          project: project.name,
          name: edit.originalName,
          pageNumber: edit.pageNumber,
          userName: edit.userName,
        });
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({ kind, rows: rows.slice(0, LIMIT) });
  }

  const rows = [];
  for (const project of projects) {
    const marks = await listProjectAnnotations(project.id);
    for (const mark of marks) {
      rows.push({
        at: mark.createdAt,
        project: project.name,
        name: mark.originalName,
        pageNumber: mark.pageNumber,
        status: mark.status,
        comment: mark.comment,
        expected: mark.expected,
        userName: mark.userName,
        resolvedAt: mark.resolvedAt,
      });
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return NextResponse.json({ kind, rows: rows.slice(0, LIMIT) });
}
