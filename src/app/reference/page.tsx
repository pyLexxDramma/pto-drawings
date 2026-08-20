"use client";

import { useState } from "react";
import Link from "next/link";
import { MarkdownView } from "@/components/markdown-view";
import type { DocumentRecord } from "@/types";

const CHECKS: { id: string; label: string; test: (text: string) => boolean }[] = [
  { id: "title", label: "Заголовок страницы", test: (text) => /^#\s+\S/m.test(text) },
  {
    id: "sheet",
    label: "Заголовок листа",
    test: (text) => /^#{2,3}\s+\S/m.test(text),
  },
  {
    id: "table",
    label: "GFM-таблица",
    test: (text) => /^\|.+\|\s*$/m.test(text) && /^\|[\s:|-]+\|\s*$/m.test(text),
  },
  {
    id: "stamp",
    label: "Раздел «Штамп»",
    test: (text) => /Штамп/i.test(text),
  },
  {
    id: "ocr",
    label: "Плашка про OCR",
    test: (text) => /OCR|распозна/i.test(text),
  },
];

export default function ReferencePage() {
  const [reference, setReference] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const [ours, setOurs] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadOurs() {
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId.trim()}`);
      if (!response.ok) throw new Error("Документ не найден или нужен вход");
      const payload = (await response.json()) as { document?: DocumentRecord };
      const page = payload.document?.pages.find(
        (item) => item.pageNumber === Number(pageNumber),
      );
      if (!page) throw new Error("Такого листа в документе нет");
      setOurs(page.markdown);
    } catch (err) {
      setOurs("");
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  return (
    <div className="min-h-dvh bg-bg p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/" className="rounded-md border border-border px-2.5 py-1.5 text-xs">
          В приложение
        </Link>
        <div className="text-sm font-semibold">Сверка с эталоном</div>
        <span className="text-xs text-muted">
          Слева — эталонный markdown, справа — наш лист. Рендер один и тот же.
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        <input
          value={documentId}
          onChange={(event) => setDocumentId(event.target.value)}
          placeholder="id документа"
          className="w-80 rounded-md border border-border px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <input
          value={pageNumber}
          onChange={(event) => setPageNumber(event.target.value)}
          placeholder="лист"
          className="w-20 rounded-md border border-border px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void loadOurs()}
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white"
        >
          Загрузить наш лист
        </button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-white">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
            Эталон — вставьте содержимое *.ref.md
          </div>
          <textarea
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full resize-y border-b border-border bg-[#f7f8fa] p-3 font-mono text-[12px] outline-none"
          />
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
            {CHECKS.map((check) => {
              const ok = reference.trim().length > 0 && check.test(reference);
              return (
                <span
                  key={check.id}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"
                  }`}
                >
                  {check.label}
                </span>
              );
            })}
          </div>
          <div className="markdown-body markdown-body--table p-4">
            <MarkdownView>{reference}</MarkdownView>
          </div>
        </section>

        <section className="rounded-md border border-border bg-white">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
            Наш результат
          </div>
          <textarea
            value={ours}
            onChange={(event) => setOurs(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full resize-y border-b border-border bg-[#f7f8fa] p-3 font-mono text-[12px] outline-none"
          />
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
            {CHECKS.map((check) => {
              const ok = ours.trim().length > 0 && check.test(ours);
              return (
                <span
                  key={check.id}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"
                  }`}
                >
                  {check.label}
                </span>
              );
            })}
          </div>
          <div className="markdown-body markdown-body--table p-4">
            <MarkdownView>{ours}</MarkdownView>
          </div>
        </section>
      </div>
    </div>
  );
}
