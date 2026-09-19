"use client";

import { IconWarn } from "@/components/tool-icons";
import {
  buildModelCheck,
  type ModelCheckInput,
} from "@/lib/model-check";

export function modelIssueCount(input: ModelCheckInput) {
  return buildModelCheck(input).count;
}

export function ModelCheckChip({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (count <= 0 && !open) return null;
  const label = open
    ? "Закрыть ошибки модели"
    : `Ошибки модели: ${count}`;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
        open
          ? "border-amber-800 bg-amber-800 text-white"
          : "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
      }`}
    >
      <IconWarn className="h-3 w-3" />
      <span>Ошибки модели</span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

export function ModelCheckPanel({
  input,
  onBack,
}: {
  input: ModelCheckInput;
  onBack: () => void;
}) {
  const check = buildModelCheck(input);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-amber-950">
            Ошибки модели · лист {input.pageNumber}
          </div>
          <div className="text-[10px] text-amber-900/80">
            Не замечания в таблице — разбор, откуда текст и где модель ошиблась
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-950 hover:bg-amber-100"
        >
          К тексту
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {check.sections.map((section) => (
          <section key={section.id}>
            <h3 className="mb-1 text-[11px] font-semibold text-text">
              {section.title}
            </h3>
            <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-800">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
