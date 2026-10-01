/** Единственный источник горячих клавиш — UI и «?» читают отсюда. */

export type KeymapItem = {
  keys: string;
  action: string;
  group: "view" | "sheets" | "remarks" | "search";
};

export const KEYMAP: KeymapItem[] = [
  { group: "view", keys: "Колёсико", action: "Сдвиг листа" },
  { group: "view", keys: "Ctrl + колёсико / ⌘ + колёсико", action: "Зум в точку" },
  { group: "view", keys: "Shift + протяжка", action: "Зум рамкой" },
  { group: "view", keys: "Двойной клик", action: "Вписать страницу" },
  { group: "view", keys: "Shift + двойной клик", action: "100%" },
  { group: "view", keys: "Пробел + тянуть / средняя кнопка", action: "Сдвинуть вид" },
  { group: "view", keys: "← → ↑ ↓", action: "Сдвинуть вид" },
  { group: "view", keys: "F", action: "Только лист" },
  { group: "sheets", keys: "J / PageDown", action: "Следующий лист" },
  { group: "sheets", keys: "K / PageUp", action: "Предыдущий лист" },
  { group: "search", keys: "/ · Ctrl+F", action: "Поиск в файле" },
  { group: "search", keys: "Шапка", action: "Поиск по расшифровкам проекта, пока файл не открыт" },
  { group: "remarks", keys: "E", action: "Отметить ошибку" },
  { group: "remarks", keys: "↑ ↓", action: "Замечания листа или находки разбора ИИ" },
  { group: "remarks", keys: "1 / 2 / 3", action: "Важность низ / сред / выс" },
  { group: "remarks", keys: "Enter", action: "Принять → следующее" },
  { group: "search", keys: "Esc", action: "Закрыть поиск / разбор ИИ / только лист" },
  { group: "view", keys: "?", action: "Клавиши" },
];

export const KEYMAP_GROUPS: { id: KeymapItem["group"]; label: string }[] = [
  { id: "view", label: "Чертёж" },
  { id: "sheets", label: "Листы" },
  { id: "search", label: "Поиск" },
  { id: "remarks", label: "Замечания" },
];
