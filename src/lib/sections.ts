/**
 * Разделы, по которым группируются замечания. Проектная документация идёт
 * составом комплекта, за ней марки рабочей документации, потом всё незнакомое
 * (шифры вида 250910-ВА-Р-ОВ1) — по порядку появления, и «межраздел» последним.
 */

/** Проектная документация: порядок как в составе ПД. */
export const PD_SECTIONS = [
  "ПЗ",
  "ПЗУ",
  "АР1",
  "АР2",
  "АР3",
  "АР4",
  "АР5",
  "КР1",
  "КР2",
  "КР3",
  "КР4",
  "ИОС1",
  "ИОС2",
  "ИОС3",
  "ИОС4",
  "ИОС5",
  "ПОС",
  "ПБ",
  "ТБЭ",
  "ОДИ",
];

/** Рабочая документация: марка тома. */
export const RD_SECTIONS = [
  "АР",
  "КЖ",
  "КМ",
  "ТХ",
  "ОВ",
  "ВК",
  "ТС",
  "ЭО",
  "ВН",
  "НВ",
  "НК",
  "НЭС",
  "НСС",
  "АПС",
  "АПТ",
  "СОУЭ",
  "ДУ",
  "АСДУ",
  "СКУД",
  "СС",
  "СОТС",
];

/** Замечание между разделами: всегда в конце таблицы и выгрузки. */
export const CROSS_SECTION = "межраздел";

export const KNOWN_SECTIONS = [...PD_SECTIONS, ...RD_SECTIONS];

const RANK = new Map(
  KNOWN_SECTIONS.map((section, index) => [section.toLowerCase(), index]),
);

/** Незнакомые разделы и «межраздел» уходят за известные. */
export const UNKNOWN_RANK = KNOWN_SECTIONS.length;
export const CROSS_RANK = Number.MAX_SAFE_INTEGER;

export function knownSectionRank(section: string): number | null {
  return RANK.get(section.trim().toLowerCase()) ?? null;
}

export function isCrossSection(section: string): boolean {
  return section.trim().toLowerCase() === CROSS_SECTION;
}
