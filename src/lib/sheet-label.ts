/**
 * Единый адрес листа для таблицы, подсветки и выгрузки (баг 0097).
 *
 * Главный номер — порядковый лист тома, то есть страница PDF: Алексей и
 * Бородин в томе ИОС4 называют его «лист 28». Номер из штампа — другое число
 * (в графе «Лист» того же листа стоит 6), поэтому он идёт справкой в скобках и
 * только если конвейер его прислал: `stampSheet` в месте замечания.
 *
 * Формат один на все поверхности: «лист 28» или «лист 28 (в штампе 6)».
 */
import type { ReviewLocation } from "@/types";

/**
 * Цитату со скана конвейер берёт прямо из markdown расшифровки, а числа там
 * выделены разметкой модели: «принята **250 кВт**». Инженеру эти знаки видеть
 * незачем, и сравнивать цитату с текстом листа тоже надо без них (0094).
 */
export function stripMarkdownMarks(text: string): string {
  return text.replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim();
}

/** Адрес листа без имени файла: «лист 28 (в штампе 6)». */
export function sheetLabel(location: {
  pageNumber: number | null;
  stampSheet?: string | null;
}): string | null {
  if (!location.pageNumber) return null;
  const stamp = (location.stampSheet ?? "").trim();
  const base = `лист ${location.pageNumber}`;
  // Номер штампа показываем только когда он расходится с номером тома:
  // совпадение показывать незачем, это шум в узкой колонке.
  if (!stamp || stamp === String(location.pageNumber)) return base;
  return `${base} (в штампе ${stamp})`;
}

/** Подсказка места: «Место 1 этой фразы», без «из 2». */
export function placeOrdinal(index: number): string {
  return `Место ${index + 1} этой фразы`;
}

/**
 * Чип места в строке замечания. Номер «№1» читался как другое замечание
 * («№ 5» стоит в той же строке), поэтому на кнопке — лист, где эта фраза.
 * Повтор на том же листе: «л.2 · 2». Два файла с одним номером листа — короткое имя файла.
 */
export function placeChipLabel(
  location: { documentId: string | null; documentName: string; pageNumber: number | null },
  index: number,
  places: ReadonlyArray<{
    documentId: string | null;
    documentName: string;
    pageNumber: number | null;
  }>,
): string {
  const page = location.pageNumber;
  const sheet = page ? `л.${page}` : "—";
  const sameSheet = places.filter(
    (item) => item.documentId === location.documentId && item.pageNumber === page,
  );
  if (sameSheet.length > 1) {
    const n = places
      .slice(0, index + 1)
      .filter(
        (item) => item.documentId === location.documentId && item.pageNumber === page,
      ).length;
    return `${sheet} · ${n}`;
  }
  const samePageOtherFile = places.some(
    (item) => item.pageNumber === page && item.documentId !== location.documentId,
  );
  if (!samePageOtherFile) return sheet;
  const name = location.documentName.replace(/\.[^.]+$/, "");
  const short = name.length > 12 ? `${name.slice(0, 11)}…` : name;
  return short ? `${short} ${sheet}` : sheet;
}

/**
 * Порядковый номер места в таблице, рядом с адресом листа: «№1».
 * В строке замечания на чертеже номер не пишем — там чип «л.N», см. placeChipLabel.
 */
export function placeShort(index: number): string {
  return `№${index + 1}`;
}

/** Полный адрес: «том.pdf · лист 28 (в штампе 6)». */
export function locationLabel(location: ReviewLocation): string {
  return [location.documentName, sheetLabel(location)].filter(Boolean).join(" · ");
}

/**
 * Конвейер начинает формулировку адресом («ИОС4.pdf, стр. 1: …», «лист 6,
 * стр. 1») — в таблице и выгрузке это дубль колонки места, а числа из штампа и
 * тома рядом читаются как ошибка. Срезаем адрес из начала и убираем номер
 * штампа из хвоста формулировки.
 */
export function stripAddressPrefix(text: string): string {
  // Адрес в начале: имя файла и/или «лист N», «стр. N» через запятую, до двоеточия.
  const address = /^\s*(?:[^\n:]{1,120}?\.(?:pdf|dwg|dxf|docx?)\s*,\s*)?(?:(?:стр\.?|лист)\s*\d+\s*,?\s*){1,2}:\s*/iu;
  return text.replace(address, "");
}

/**
 * Адреса внутри формулировки приводим к тому же формату. Конвейер пишет
 * «(лист 6, стр. 1)» — два числа про один лист, и проектировщики в выгрузке
 * читают это как ошибку. Порядок в томе — то, что конвейер называет «стр.»,
 * номер из штампа уходит в пояснение.
 */
export function normalizeInlineAddresses(text: string): string {
  return (
    text
      // «лист 6, стр. 1» → «лист 1, в штампе 6»
      .replace(
        /лист\s*(\d+)\s*,\s*стр\.?\s*(\d+)/giu,
        (_full, stamp: string, page: string) =>
          stamp === page ? `лист ${page}` : `лист ${page}, в штампе ${stamp}`,
      )
      // одиночная «стр. 2» — тот же лист тома, только под другим словом
      .replace(/стр\.\s*(\d+)/giu, "лист $1")
      .replace(/\bстр\s+(\d+)/giu, "лист $1")
  );
}

/** Формулировка для таблицы и выгрузки: без адреса в начале, адреса внутри — в одном формате. */
export function remarkWording(text: string): string {
  const cut = stripAddressPrefix(text);
  return normalizeInlineAddresses(cut.trim() ? cut : text);
}
