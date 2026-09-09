import { execFile } from "child_process";
import { access, readFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { DATA_PATHS } from "@/lib/persist";

const run = promisify(execFile);

/**
 * Журнал обновлений прода. Деплой — это `git reset --hard origin/main` в
 * рабочей копии на VPS, поэтому историю берём прямо из git.
 *
 * Репозиториев два: фронт (это приложение) и конвейер PTO-work, который правит
 * коллега по ИИ. Без второго в журнале видно только свои коммиты.
 */

export type RepoId = "front" | "pipeline";

export const REPO_LABEL: Record<RepoId, string> = {
  front: "Фронт",
  pipeline: "Конвейер",
};

export type ReleaseCommit = {
  repo: RepoId;
  sha: string;
  shortSha: string;
  author: string;
  at: string;
  subject: string;
  /** Слитая ветка: у merge-коммита больше одного родителя. */
  merge: boolean;
};

export type BranchTip = {
  repo: RepoId;
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

/**
 * Где искать копию конвейера: путь можно задать явно, иначе пробуем обычные
 * места на VPS и рядом с фронтом при локальной разработке.
 */
const PIPELINE_CANDIDATES = [
  process.env.PTO_PIPELINE_REPO,
  "/opt/pto/backend",
  "/opt/pto-work",
  "/var/www/pto-work",
  "/srv/pto-work",
  path.join(process.cwd(), "..", "PTO-work"),
].filter((item): item is string => Boolean(item));

let startRecorded = false;
let pipelineDir: string | null | undefined;

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function resolvePipelineDir(): Promise<string | null> {
  if (pipelineDir !== undefined) return pipelineDir;
  for (const candidate of PIPELINE_CANDIDATES) {
    if (await isGitRepo(candidate)) {
      pipelineDir = candidate;
      return pipelineDir;
    }
  }
  pipelineDir = null;
  return null;
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    // Копия конвейера на VPS принадлежит деплой-пользователю, а приложение
    // работает от своего: без safe.directory git отказывается её читать.
    const { stdout } = await run("git", ["-c", `safe.directory=${cwd}`, ...args], {
      cwd,
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

async function repoDirs(): Promise<{ repo: RepoId; dir: string }[]> {
  const dirs: { repo: RepoId; dir: string }[] = [
    { repo: "front", dir: process.cwd() },
  ];
  const pipeline = await resolvePipelineDir();
  if (pipeline) dirs.push({ repo: "pipeline", dir: pipeline });
  return dirs;
}

async function commitsFrom(
  repo: RepoId,
  dir: string,
  limit: number,
): Promise<ReleaseCommit[]> {
  const format = ["%H", "%an", "%aI", "%s", "%P"].join(FIELD) + ROW;
  const out = await git(dir, [
    "log",
    `-n${Math.min(limit, 200)}`,
    `--pretty=format:${format}`,
  ]);
  if (!out) return [];
  return out
    .split(ROW)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, author, at, subject, parents] = line.split(FIELD);
      return {
        repo,
        sha,
        shortSha: sha.slice(0, 7),
        author,
        at,
        subject,
        merge: (parents ?? "").trim().split(/\s+/).filter(Boolean).length > 1,
      };
    });
}

/** История обоих репозиториев в одном списке: свежее сверху. */
export async function listReleaseCommits(limit = 50): Promise<ReleaseCommit[]> {
  const dirs = await repoDirs();
  const lists = await Promise.all(
    dirs.map(({ repo, dir }) => commitsFrom(repo, dir, limit)),
  );
  return lists
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit * 2);
}

async function branchesFrom(
  repo: RepoId,
  dir: string,
  limit: number,
): Promise<BranchTip[]> {
  const format = [
    "%(refname:short)",
    "%(objectname)",
    "%(authorname)",
    "%(committerdate:iso-strict)",
    "%(contents:subject)",
  ].join(FIELD);
  const out = await git(dir, [
    "for-each-ref",
    "--sort=-committerdate",
    `--count=${Math.min(limit, 100)}`,
    `--format=${format}`,
    "refs/remotes",
    "refs/heads",
  ]);
  if (!out) return [];

  const merged = new Set(
    ((await git(dir, ["branch", "-a", "--merged", "HEAD", "--format=%(refname:short)"])) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const seen = new Set<string>();
  const tips: BranchTip[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [ref, sha, author, at, subject] = line.split(FIELD);
    // origin/HEAD git сокращает до «origin» — это не ветка, а указатель.
    if (!ref || ref.endsWith("/HEAD") || ref === "origin") continue;
    const branch = ref.replace(/^origin\//, "");
    if (branch === "main" || branch === "master") continue;
    if (seen.has(branch)) continue;
    seen.add(branch);
    tips.push({
      repo,
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

/**
 * Ветки: в main попадает только слитое, поэтому незакрытую работу показываем
 * отдельно. Список берётся из refs, которые притянул последний деплой
 * (`git fetch --all --prune`), — сами в сеть не ходим.
 */
export async function listBranchTips(limit = 40): Promise<BranchTip[]> {
  const dirs = await repoDirs();
  const lists = await Promise.all(
    dirs.map(({ repo, dir }) => branchesFrom(repo, dir, limit)),
  );
  return lists.flat().sort((a, b) => b.at.localeCompare(a.at));
}

/** Какие репозитории удалось прочитать — чтобы объяснить пустой список. */
export async function listReleaseSources(): Promise<
  { repo: RepoId; label: string; dir: string; readable: boolean }[]
> {
  const dirs = await repoDirs();
  return Promise.all(
    dirs.map(async ({ repo, dir }) => ({
      repo,
      label: REPO_LABEL[repo],
      dir,
      readable: Boolean(await git(dir, ["rev-parse", "HEAD"])),
    })),
  );
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
  const sha = (await git(process.cwd(), ["rev-parse", "HEAD"])) ?? "";
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
