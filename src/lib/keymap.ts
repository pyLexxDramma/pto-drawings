/** Единственный источник горячих клавиш — UI и «?» читают отсюда. */

export type KeymapItem = {
  keys: string;
  action: string;
  group: "view" | "sheets" | "remarks" | "search";
};

export const KEYMAP: KeymapItem[] = [
  { group: "view", keys: "Колёсико", action: "Сдвиг листа (в DWG — зум)" },
  { group: "view", keys: "Ctrl + колёсико", action: "Зум в точку (в DWG — сдвиг)" },
  { group: "view", keys: "Shift + протяжка", action: "Зум рамкой" },
  { group: "view", keys: "Двойной клик", action: "Вписать страницу" },
  { group: "view", keys: "Shift + двойной клик", action: "100%" },
  { group: "view", keys: "Пробел + тянуть / средняя кнопка", action: "Сдвинуть вид" },
  { group: "view", keys: "← → ↑ ↓", action: "Сдвинуть вид" },
  { group: "view", keys: "F", action: "Чертёж на весь экран" },
  { group: "sheets", keys: "J / PageDown", action: "Следующий лист" },
  { group: "sheets", keys: "K / PageUp", action: "Предыдущий лист" },
  { group: "sheets", keys: "V", action: "Отметить лист просмотренным" },
  { group: "search", keys: "/ или Ctrl+F", action: "Поиск по файлу" },
  { group: "remarks", keys: "E", action: "Отметить ошибку на чертеже" },
  { group: "remarks", keys: "↑ ↓", action: "Предыдущее / следующее замечание" },
  { group: "remarks", keys: "1 / 2 / 3", action: "Важность низкая / средняя / высокая" },
  { group: "remarks", keys: "Enter", action: "Разобрано" },
  { group: "search", keys: "Esc", action: "Закрыть поиск, разметку, весь экран" },
  { group: "view", keys: "?", action: "Карта клавиш" },
];

export const KEYMAP_GROUPS: { id: KeymapItem["group"]; label: string }[] = [
  { id: "view", label: "Чертёж" },
  { id: "sheets", label: "Листы" },
  { id: "search", label: "Поиск" },
  { id: "remarks", label: "Замечания" },
];
