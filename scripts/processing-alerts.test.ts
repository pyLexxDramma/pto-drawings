import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectProcessingAlerts,
  processingFailed,
} from "../src/lib/processing-alerts.ts";

describe("collectProcessingAlerts", () => {
  it("берёт упавший лист даже если файл помечен done", () => {
    const alerts = collectProcessingAlerts([
      {
        id: "d1",
        originalName: "Большой.pdf",
        status: "done",
        errorMessage: "Не удалось обработать листов: 1",
        pageErrors: { "8": "OOM killed" },
        pipelineFinishedAt: "2026-09-14T17:00:00.000Z",
        createdAt: "2026-09-14T16:00:00.000Z",
      },
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].page, 8);
    assert.equal(alerts[0].message, "OOM killed");
  });

  it("не орёт на пользовательский Стоп", () => {
    const alerts = collectProcessingAlerts([
      {
        id: "d2",
        originalName: "Стоп.pdf",
        status: "error",
        errorMessage: "Отмена… останавливаем после текущего листа.",
        pageErrors: {},
        pipelineFinishedAt: "2026-09-14T17:00:00.000Z",
        createdAt: "2026-09-14T16:00:00.000Z",
      },
    ]);
    assert.equal(alerts.length, 0);
    assert.equal(
      processingFailed({
        id: "d2",
        originalName: "Стоп.pdf",
        status: "error",
        errorMessage: "Отмена… останавливаем после текущего листа.",
        pageErrors: {},
        pipelineFinishedAt: null,
        createdAt: "2026-09-14T16:00:00.000Z",
      }),
      false,
    );
  });

  it("пишет ошибку файла, если листов в pageErrors нет", () => {
    const alerts = collectProcessingAlerts([
      {
        id: "d3",
        originalName: "Падение.pdf",
        status: "error",
        errorMessage: "Конвейер недоступен",
        pageErrors: {},
        pipelineFinishedAt: "2026-09-14T18:00:00.000Z",
        createdAt: "2026-09-14T16:00:00.000Z",
      },
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].page, null);
    assert.equal(alerts[0].message, "Конвейер недоступен");
  });
});
