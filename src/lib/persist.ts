import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.env.DATA_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const DOCS_DIR = path.join(DATA_DIR, "documents");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const LOCK_DIR = path.join(DATA_DIR, ".lock");

// Замок держится каталогом: mkdir атомарен и на Windows, и на Linux.
const LOCK_STALE_MS = 20_000;
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DATA_PATHS = { DATA_DIR, DOCS_DIR, UPLOAD_DIR, DB_PATH };

function assertDocumentId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid document id");
  }
}

function documentPath(id: string) {
  assertDocumentId(id);
  return path.join(DOCS_DIR, `${id}.json`);
}

async function writeTextAtomic(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, text, "utf8");
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function acquireLock() {
  await mkdir(DATA_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let forced = false;

  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      await writeFile(path.join(LOCK_DIR, "owner"), String(process.pid), "utf8");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      const age = await stat(LOCK_DIR)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => Number.POSITIVE_INFINITY);

      if (age > LOCK_STALE_MS || (!forced && Date.now() > deadline)) {
        forced = true;
        await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }

      await sleep(LOCK_POLL_MS);
    }
  }
}

async function releaseLock() {
  await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => undefined);
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Сериализует доступ к данным внутри процесса и между процессами:
 * dev на 3000 и prod на 8080 могут смотреть в одну папку данных.
 */
export function withDataLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(
    () => guarded(fn),
    () => guarded(fn),
  );
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock();
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
}

export async function readDbText(): Promise<string | null> {
  return readText(DB_PATH);
}

export async function writeDbText(json: string) {
  await writeTextAtomic(DB_PATH, json);
}

export async function readDocumentText(id: string): Promise<string | null> {
  return readText(documentPath(id));
}

export async function writeDocumentText(id: string, json: string) {
  await writeTextAtomic(documentPath(id), json);
}

export async function deleteDocumentFile(id: string) {
  await unlink(documentPath(id)).catch(() => undefined);
}

export async function writePdfBytes(storedName: string, buffer: Buffer) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedName), buffer);
}

export async function readPdfBytes(storedName: string): Promise<Buffer> {
  return readFile(path.join(UPLOAD_DIR, storedName));
}

export async function deletePdfBytes(storedName: string) {
  await unlink(path.join(UPLOAD_DIR, storedName)).catch(() => undefined);
}
