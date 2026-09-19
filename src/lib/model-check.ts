import type { DocumentPage } from "@/types";

export type ModelCheckInput = {
  pageNumber: number;
  source?: DocumentPage["source"] | null;
  warnings: string[];
  pageWarning?: string | null;
  pageError?: string | null;
  numbers?: DocumentPage["numbers"];
  reviewCount: number;
};

export type ModelCheckSection = {
  id: "source" | "compare" | "missed" | "process" | "fix";
  title: string;
  items: string[];
};

export type ModelCheck = {
  count: number;
  sections: ModelCheckSection[];
};

function warningKind(text: string): "source" | "compare" | "process" {
  const t = text.toLowerCase();
  if (
    /слоя нет|текстового слоя|скан|изображен|картинк|по модели|по изображен/.test(
      t,
    )
  ) {
    return "source";
  }
  if (/марки|отлича|сверк|в слое|против|vs\b/.test(t)) return "compare";
  return "process";
}

function unique(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Собирает вкладку сверки модели из того, что уже есть на листе. */
export function buildModelCheck(input: ModelCheckInput): ModelCheck {
  const sourceItems: string[] = [];
  const compareItems: string[] = [];
  const missedItems: string[] = [];
  const processItems: string[] = [];

  if (input.source === "model") {
    sourceItems.push(
      "Текст листа прочитан по картинке. Текстового слоя нет — подсветки на чертеже не будет.",
    );
  } else if (input.source === "heuristic") {
    sourceItems.push("Текст взят из CAD / слоя PDF, модель не вызывалась.");
  }

  const extras = unique([
    ...input.warnings,
    input.pageWarning ?? "",
  ]);
  for (const warning of extras) {
    const kind = warningKind(warning);
    if (kind === "source") sourceItems.push(warning);
    else if (kind === "compare") compareItems.push(warning);
    else processItems.push(warning);
  }

  const numbers = input.numbers;
  if (numbers?.checked) {
    const found = numbers.found ?? 0;
    const total = numbers.total ?? 0;
    compareItems.push(
      `Сверка чисел с оригиналом: модель назвала ${found} из ${total}${
        numbers.precision != null
          ? `, точность ${(numbers.precision * 100).toFixed(0)}%`
          : ""
      }.`,
    );
    const suspects = (numbers.suspect ?? []).filter((item) => item.trim());
    if (suspects.length) {
      compareItems.push(
        `Сверьте на чертеже слева: ${suspects.join(" · ")}. Если число не то — «Отметить ошибку».`,
      );
    }
    if (total > found) {
      missedItems.push(
        `В слое / на листе модель не подтвердила ${total - found} из ${total} чисел.`,
      );
    }
  } else if ((numbers?.suspect ?? []).some((item) => item.trim())) {
    const suspects = numbers!.suspect.filter((item) => item.trim());
    compareItems.push(
      `Числа из описания модели — сверьте с чертежом: ${suspects.join(" · ")}.`,
    );
  }

  if (input.reviewCount === 0 && input.source === "model") {
    missedItems.push(
      "В таблицу замечаний с этого листа ничего не попало. Если в тексте ниже есть расхождения — их должен отправить конвейер после модели.",
    );
  } else if (input.reviewCount > 0) {
    compareItems.push(
      `В таблице уже ${input.reviewCount} замечаний по этому листу.`,
    );
  }

  if (input.pageError) {
    processItems.push(`Ошибка листа: ${input.pageError}`);
  }

  const fixItems = [
    "Неверное число или марка на чертеже — «Отметить ошибку» и обвести место. Появится строка в таблице.",
    "Текст расшифровки руками не правят: конвейеру нужна отметка, чему учиться.",
    "Лист упал или пустой — на карточке файла «Запустить заново».",
    "Пары в тексте есть, а в таблице нет — это конвейер, не файл: после VLM должна работать та же искалка, что на DWG.",
  ];

  const sections: ModelCheckSection[] = [
    { id: "source", title: "Откуда текст", items: unique(sourceItems) },
    { id: "compare", title: "Что с чем сверять", items: unique(compareItems) },
    { id: "missed", title: "Что модель не нашла", items: unique(missedItems) },
    { id: "process", title: "Ошибки обработки", items: unique(processItems) },
    { id: "fix", title: "Как исправить", items: fixItems },
  ].filter((section) => section.items.length > 0);

  const count =
    extras.length +
    (input.pageError ? 1 : 0) +
    ((numbers?.suspect ?? []).filter((item) => item.trim()).length > 0 ? 1 : 0) +
    (input.reviewCount === 0 && input.source === "model" ? 1 : 0);

  return { count, sections };
}
