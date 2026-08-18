import { NextResponse } from "next/server";
import { createProject, listProjects, renameProject } from "@/lib/storage";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Укажите название проекта" }, { status: 400 });
  }
  const project = await createProject(name);
  return NextResponse.json({ project }, { status: 201 });
}
