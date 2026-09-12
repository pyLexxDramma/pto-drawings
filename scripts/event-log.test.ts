import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// DATA_ROOT читается при загрузке модуля, поэтому импорт только после подмены.
let log: typeof import("../src/lib/event-log.ts");
let root = "";

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pto-log-"));
  process.env.DATA_ROOT = root;
  process.env.PTO_LOG_KEEP_DAYS = "14";
  log = await import("../src/lib/event-log.ts");
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const logsDir = () => path.join(root, "data", "logs");

describe("logEvent", () => {
  it("пишет строку в файл суток и читает её обратно", async () => {
    await log.logEvent({
      layer: "back",
      action: "запуск обработки",
      ok: true,
      document: "Раздел ПБ.pdf",
    });
    const { rows } = await log.readEventLog();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].layer, "back");
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].document, "Раздел ПБ.pdf");
  });

  it("свежие записи идут первыми", async () => {
    await log.logEvent({ layer: "front", action: "первое", ok: true });
    await log.logEvent({ layer: "front", action: "второе", ok: true });
    const { rows } = await log.readEventLog({ layer: "front" });
    assert.equal(rows[0].action, "второе");
    assert.equal(rows[1].action, "первое");
  });

  it("фильтрует по слою и по ошибкам", async () => {
    await log.logFailure("agent", "обогащение", new Error("агент недоступен"));
    const errors = await log.readEventLog({ onlyErrors: true });
    assert.equal(errors.rows.length, 1);
    assert.equal(errors.rows[0].layer, "agent");
    assert.equal(errors.rows[0].message, "агент недоступен");

    const agent = await log.readEventLog({ layer: "agent" });
    assert.equal(agent.rows.length, 1);
    const front = await log.readEventLog({ layer: "front" });
    assert.ok(front.rows.every((row) => row.layer === "front"));
  });

  it("не падает на битой строке", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await writeFile(path.join(logsDir(), `${day}.ndjson`), "не json\n", {
      flag: "a",
    });
    const { rows } = await log.readEventLog();
    assert.ok(rows.length >= 3);
  });

  it("удаляет файлы старше срока хранения", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    await writeFile(
      path.join(logsDir(), `${old}.ndjson`),
      `${JSON.stringify({ at: `${old}T00:00:00.000Z`, layer: "back", action: "старое", ok: true })}\n`,
    );
    await log.pruneOldDays();
    const names = await readdir(logsDir());
    assert.ok(!names.includes(`${old}.ndjson`));
  });
});
