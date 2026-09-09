import { execFile } from "child_process";
import { readFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { DATA_PATHS } from "@/lib/persist";

const run = promisify(execFile);

/**
 * Журнал обновлений прода. Деплой — это `git reset --hard origin/main` в
 * рабочей копии на VPS, поэтому историю берём прямо из git: там видно и свои
 * коммиты, и слитые ветки коллег. Отдельно храним отметки запуска приложения:
 * коммит может быть в истории, но выкатили его позже.
 */

export type ReleaseCommit = {
  sha: string;
  shortSha: string;
  author: string;
  at: string;
  subject: string;
  /** Слитая ветка: у merge-коммита больше одного родителя. */
  merge: boolean;
};

export type BranchTip = {
  /** Без префикса origin/: в списке важна ветка, а не откуда её принесли. */
  branch: string;
  shortSha: string;
  author: string;
  at: string;
  subject: string;
  /** Уже в main — значит на проде; иначе ждёт слияния. */
  merged: boolean;
};

export type ReleaseStart = {
  sha: string;
  shortSha: string;
  at: string;
  /** Версия из package.json — на случай сборки без git. */
  version: string | null;
};

const RELEASES_PATH = path.join(DATA_PATHS.DATA_DIR, "releases.json");
const START_LIMIT = 200;
const FIELD = "\u001f";
const ROW = "\u001e";

let startRecorded = false;

async function git(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 2_000_000,
    });
    return stdout.trim();
  } catch {
    // Сборка без .git (например, docker-образ) — журнал остаётся по отметкам запуска.
    return null;
  }
}

export async function listReleaseCommits(limit = 50): Promise<ReleaseCommit[]> {
  const format = ["%H", "%an", "%aI", "%s", "%P"].join(FIELD) + ROW;
  const out = await git(["log", `-n${Math.min(limit, 200)}`, `--pretty=format:${format}`]);
  if (!out) return [];
  return out
    .split(ROW)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, author, at, subject, parents] = line.split(FIELD);
      return {
        sha,
        shortSha: sha.slice(0, 7),
        author,
        at,
        subject,
        merge: (parents ?? "").trim().split(/\s+/).filter(Boolean).length > 1,
      };
    });
}

/**
 * Ветки коллег: в main попадает только слитое, поэтому чужую работу показываем
 * отдельно. Список берётся из refs, которые притянул последний деплой
 * (`git fetch --all --prune`), — сами в сеть не ходим.
 */
export async function listBranchTips(limit = 40): Promise<BranchTip[]> {
  const format = [
    "%(refname:short)",
    "%(objectname)",
    "%(authorname)",
    "%(committerdate:iso-strict)",
    "%(contents:subject)",
  ].join(FIELD);
  const out = await git([
    "for-each-ref",
    "--sort=-committerdate",
    `--count=${Math.min(limit, 100)}`,
    `--format=${format}`,
    "refs/remotes",
    "refs/heads",
  ]);
  if (!out) return [];

  const merged = new Set(
    ((await git(["branch", "-a", "--merged", "HEAD", "--format=%(refname:short)"])) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const seen = new Set<string>();
  const tips: BranchTip[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [ref, sha, author, at, subject] = line.split(FIELD);
    if (!ref || ref.endsWith("/HEAD")) continue;
    const branch = ref.replace(/^origin\//, "");
    if (branch === "main" || branch === "master") continue;
    if (seen.has(branch)) continue;
    seen.add(branch);
    tips.push({
      branch,
      shortSha: (sha ?? "").slice(0, 7),
      author: author ?? "—",
      at: at ?? "",
      subject: subject ?? "",
      merged: merged.has(ref),
    });
  }
  return tips;
}

async function readStarts(): Promise<ReleaseStart[]> {
  try {
    const raw = await readFile(RELEASES_PATH, "utf8");
    const parsed = JSON.parse(raw) as { starts?: ReleaseStart[] };
    return Array.isArray(parsed.starts) ? parsed.starts : [];
  } catch {
    return [];
  }
}

async function writeStarts(starts: ReleaseStart[]) {
  await mkdir(path.dirname(RELEASES_PATH), { recursive: true });
  await writeFile(RELEASES_PATH, JSON.stringify({ starts }, null, 2), "utf8");
}

/**
 * Отметить запуск приложения. Пишем только при смене коммита: перезапуск без
 * обновления кода журнал не засоряет.
 */
export async function recordAppStart(): Promise<void> {
  if (startRecorded) return;
  startRecorded = true;
  const sha = (await git(["rev-parse", "HEAD"])) ?? "";
  const version = process.env.npm_package_version ?? null;
  const starts = await readStarts();
  const last = starts[0];
  if (last && last.sha === sha) return;
  const next: ReleaseStart = {
    sha,
    shortSha: sha ? sha.slice(0, 7) : "—",
    at: new Date().toISOString(),
    version,
  };
  await writeStarts([next, ...starts].slice(0, START_LIMIT));
}

export async function listReleaseStarts(): Promise<ReleaseStart[]> {
  return readStarts();
}
