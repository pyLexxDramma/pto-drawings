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
  { group: "view", keys: "F", action: "Только лист — свернуть проекты и расшифровку" },
  { group: "sheets", keys: "J / PageDown / Fn+↓", action: "Следующий лист" },
  { group: "sheets", keys: "K / PageUp / Fn+↑", action: "Предыдущий лист" },
  { group: "search", keys: "/ или Ctrl+F / ⌘F", action: "Поиск по файлу" },
  { group: "remarks", keys: "E", action: "Отметить ошибку / отменить разметку" },
  { group: "remarks", keys: "↑ ↓", action: "Предыдущее / следующее неразобранное" },
  { group: "remarks", keys: "1 / 2 / 3", action: "Важность: низкая / средняя / высокая" },
  { group: "remarks", keys: "Enter", action: "Разобрано → следующее неразобранное" },
  { group: "search", keys: "Esc", action: "Закрыть поиск, разметку, режим «только лист»" },
  { group: "view", keys: "?", action: "Карта клавиш" },
];

export const KEYMAP_GROUPS: { id: KeymapItem["group"]; label: string }[] = [
  { id: "view", label: "Чертёж" },
  { id: "sheets", label: "Листы" },
  { id: "search", label: "Поиск" },
  { id: "remarks", label: "Замечания" },
];
