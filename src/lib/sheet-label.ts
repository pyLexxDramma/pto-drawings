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
