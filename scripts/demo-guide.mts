/**
 * Собирает PDF-инструкцию для показа демо: что открыть, что нажать, что сказать.
 *
 *   npx --yes tsx scripts/demo-guide.mts [путь.pdf]
 *
 * Шрифт берём системный (в PDF нет кириллицы у встроенных Helvetica и Times).
 */
import { readFile, writeFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const OUT =
  process.argv[2] || "d:/PTO/Демо ПТО — инструкция показа.pdf";

const FONTS = {
  regular: "C:/Windows/Fonts/segoeui.ttf",
  bold: "C:/Windows/Fonts/seguisb.ttf",
  mono: "C:/Windows/Fonts/consola.ttf",
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 56, bottom: 54, left: 52, right: 52 };
const WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.46, 0.53);
const ACCENT = rgb(0.14, 0.35, 0.75);
const RULE = rgb(0.85, 0.87, 0.9);
const BOX = rgb(0.96, 0.97, 0.985);
const WARN = rgb(0.99, 0.96, 0.89);

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string; step?: number }
  | { kind: "p"; text: string }
  | { kind: "say"; text: string }
  | { kind: "do"; text: string }
  | { kind: "code"; text: string }
  | { kind: "note"; text: string }
  | { kind: "space"; size: number };

/** Текст инструкции. Порядок блоков = порядок показа. */
const BLOCKS: Block[] = [
  { kind: "h1", text: "Демонстрация ПТО: замечания от загрузки файла до выгрузки" },
  {
    kind: "p",
    text: "Показ идёт на локальном стенде: там поднят конвейер, поэтому виден весь цикл — загрузка файла, расшифровка листов, появление замечаний, разбор с заказчиком и выгрузка в Excel. На проде показываем только то, что уже работает у всех.",
  },

  { kind: "h2", text: "Перед показом: проверить стенд" },
  {
    kind: "p",
    text: "Нужны два запущенных процесса. Проверить можно просто открыв интерфейс: если в шапке жёлтая плашка «Конвейер: MOCK», значит оба на месте.",
  },
  {
    kind: "code",
    text: "Интерфейс   http://localhost:8080     admin / admin123\nКонвейер    http://127.0.0.1:8001   в браузере не нужен",
  },
  { kind: "p", text: "Если что-то не отвечает, поднять заново в двух терминалах:" },
  {
    kind: "code",
    text: "cd d:\\PTO\\PTO-work   →  python -m service\ncd d:\\PTO\\pto-app    →  npm run start",
  },
  {
    kind: "note",
    text: "Порт 3000 не использовать: это режим разработки, интерфейс подтормаживает на первом клике. Показывать только 8080.",
  },
  {
    kind: "p",
    text: "Проект для показа — «Жуковский 1 — демо (ПТО)». Если данные испорчены прошлым прогоном, пересобрать за 10 секунд: npm run demo:seed из d:\\PTO\\pto-app.",
  },
  {
    kind: "p",
    text: "Файл, который будем загружать, уже подготовлен: d:\\PTO\\demo-shots\\Раздел ПД №5 Подраздел №2 (ИОС2) — новый комплект.pdf — шесть настоящих листов ИОС2 по Жуковскому, 1,5 МБ.",
  },

  { kind: "h2", text: "С чего начать разговор", step: 0 },
  {
    kind: "say",
    text: "«Показываю цепочку целиком: загружаем раздел ПД, конвейер его расшифровывает, агент присылает замечания, мы разбираем их с заказчиком построчно и отдаём проектировщикам таблицей. Раньше это была ручная таблица в Google Sheets — теперь это рабочее место.»",
  },
  {
    kind: "do",
    text: "Открыть http://localhost:8080, войти, выбрать проект «Жуковский 1 — демо (ПТО)» в левой панели.",
  },

  { kind: "h2", text: "Полоса этапов: где стоит проект", step: 1 },
  {
    kind: "p",
    text: "Сверху появится строка «Обработка → Расшифровка → Замечания» с цифрами по открытому проекту. Это ответ на вопрос «в каком состоянии проект» без открытия каждого файла.",
  },
  {
    kind: "do",
    text: "Показать цифры: файлы приняты полностью, расшифровка неполная (часть листов ещё без текста), замечания разобраны частично.",
  },
  {
    kind: "do",
    text: "Нажать на этап «Расшифровка» — откроется первый лист, у которого ещё нет текста. Справа будет надпись «Для этого листа ещё нет текста».",
  },
  {
    kind: "say",
    text: "«Каждый этап не просто индикатор, а переход к работе: обработка ведёт к файлам, расшифровка — к первому необработанному листу, замечания — к таблице.»",
  },
  { kind: "do", text: "Кнопкой «Скрыть» справа свернуть полосу и развернуть обратно." },

  { kind: "h2", text: "Загрузка файла и расшифровка", step: 2 },
  {
    kind: "do",
    text: "Перетащить подготовленный PDF в окно (или кнопка «Загрузить для расшифровки» справа сверху), проект — «Жуковский 1 — демо (ПТО)».",
  },
  {
    kind: "p",
    text: "Файл появится в левой панели со статусом «В очереди», затем «Текст и таблицы». Полоса «Обработка» сразу учтёт новый файл, «Расшифровка» поедет по листам примерно по листу за полторы секунды — шесть листов уходит за 15–20 секунд.",
  },
  {
    kind: "say",
    text: "«Лист уходит в конвейер, возвращается размеченным текстом и попадает во фронт через ту же ручку, которой пользуется команда Данила. Порядок листов сохраняется, потому что таблица может переходить со листа на лист.»",
  },
  {
    kind: "do",
    text: "Когда файл дойдёт до «Готово», открыть его и пролистать пару листов: слева чертёж, справа расшифровка того же листа, номер листа и переходы — сверху.",
  },
  {
    kind: "note",
    text: "В расшифровке будет пометка «[MOCK] Это не работа модели»: локально конвейер работает без вызова модели, чтобы лист считался секунды, а не минуты. Текстовый слой листа при этом настоящий. Сказать об этом самому, до вопроса.",
  },

  { kind: "h2", text: "Замечания от агента", step: 3 },
  {
    kind: "p",
    text: "Замечания присылает агент конвейера. Пока он в разработке, его роль играет скрипт: он читает расшифровку только что загруженного файла, формирует замечания с настоящими цитатами и ссылками на листы и отправляет их той же ручкой приёма, что описана в контракте.",
  },
  { kind: "code", text: "cd d:\\PTO\\pto-app  →  npm run demo:agent" },
  {
    kind: "p",
    text: "В ответ печатается результат приёма, например: {\"added\":3,\"updated\":0,\"enriched\":0,\"total\":16}.",
  },
  {
    kind: "say",
    text: "«Это ровно тот запрос, который будет делать конвейер: раздел, обоснование, важность и места в документации со страницей и цитатой. Повторная отправка ничего не дублирует и не сбрасывает разбор — проверено тестами.»",
  },

  { kind: "h2", text: "Таблица замечаний", step: 4 },
  {
    kind: "do",
    text: "Нажать этап «Замечания» в полосе сверху. Таблица откроется на всю ширину, панель проектов уберётся сама.",
  },
  {
    kind: "p",
    text: "В подзаголовке сводка: сколько всего, сколько не разобрано, сколько высокой важности, сколько уйдёт в выгрузку. Ниже — разбивка по потокам.",
  },
  {
    kind: "do",
    text: "Показать строку с меткой «Совпало» (раздел АР5, площадь КПП). Сверху формулировка инженера, под ней серым — что нашёл ИИ, справа две ссылки на листы с цитатами.",
  },
  {
    kind: "say",
    text: "«Это главная строка. Инженер заметил проблему словами и без ссылки на документацию. Агент нашёл то же самое с цифрами и листами. Система не создала дубль, а склеила одну строку и пометила её «Совпало» — такие замечания самые надёжные, их видел и человек, и машина.»",
  },
  {
    kind: "do",
    text: "Кликнуть по ссылке на лист в графе «Где в ПД» — откроется этот лист, цитата будет в расшифровке справа. Вернуться кнопкой «← К чертежам» и снова открыть таблицу.",
  },

  { kind: "h2", text: "Фильтры, потоки и группировка", step: 5 },
  {
    kind: "do",
    text: "Переключить «Поток» на «нашла ИИ» — останутся только находки конвейера, которые инженер ещё не смотрел. Затем на «совпало» — самые надёжные строки. Вернуть на «оба».",
  },
  {
    kind: "do",
    text: "Переключить группировку на «По файлам»: замечания разложатся по разделам ПД, а те, что ссылаются на два файла сразу, соберутся в отдельную группу «Межраздел · несколько файлов» в конце.",
  },
  {
    kind: "do",
    text: "Показать фильтры «Важность» и «Разбор»: можно оставить только высокие или только неразобранные. Кнопка «Сбросить» возвращает всё.",
  },
  {
    kind: "do",
    text: "Набрать в поиске «КПП»: останутся только нужные строки, а само слово подсветится жёлтым в формулировке, в находке ИИ и в цитатах — искать глазами по длинному тексту не надо.",
  },
  {
    kind: "do",
    text: "Кликнуть по строке — она обведётся рамкой: на разборе построчно видно, где остановились. Разобранные строки залиты цветом итога: «Верно» зелёная, «Частично» жёлтая, «Обсудить» синяя, «Неактуально» серая.",
  },
  {
    kind: "say",
    text: "«Разделы не зашиты списком: кроме проектной документации принимаются марки рабочей — ОВ, ВК, ЭО — и полные шифры томов. Это просил конвейер, у них уже идут комплекты РД.»",
  },

  { kind: "h2", text: "Разбор с заказчиком", step: 6 },
  {
    kind: "p",
    text: "Это то, что мы делали построчно с Владимиром Михайловичем по Жуковскому, только теперь не в Google Sheets.",
  },
  {
    kind: "do",
    text: "Показать уже разобранные строки: у той самой строки про площадь КПП стоит «Частично верно» и комментарий про обмеры, у пожаротушения — «Верно» и решение менять насос, у редакции ГОСТ — «Неактуально»: строка серая и в выгрузку не идёт.",
  },
  {
    kind: "do",
    text: "Сменить важность и итог разбора в любой строке прямо при них, вписать комментарий. Изменения сохраняются сразу.",
  },
  {
    kind: "do",
    text: "Добавить замечание руками через строку внизу таблицы: раздел, текст, важность — и «Добавить».",
  },
  {
    kind: "say",
    text: "«Вердикт и комментарий человека конвейер не перебивает никогда. Важность он может уточнить, только пока строка не разобрана.»",
  },

  { kind: "h2", text: "Выгрузка проектировщикам", step: 7 },
  {
    kind: "do",
    text: "Кнопка «XLSX» справа сверху. Открыть файл в Excel на месте.",
  },
  {
    kind: "p",
    text: "Формат официальной отправки: № · Раздел · Замечание · Где в ПД. Строки покрашены по важности, помеченное «не нужно» в файл не попадает. В колонку «Замечание» идёт формулировка инженера, а если её нет — обоснование ИИ.",
  },
  {
    kind: "say",
    text: "«Это тот же вид, который мы отправляли проектировщикам по Жуковскому, только собирается он сам и всегда согласован с тем, что видно на экране.»",
  },

  { kind: "h2", text: "Чем закончить", step: 8 },
  {
    kind: "say",
    text: "«На проде уже работает всё, кроме одного: замечания от конвейера. Ручка приёма открыта и проверена, контракт согласован с Данилом, он ждёт токен и отправит первую пачку на test3. До этого таблица наполняется руками — и это уже полезно, инженер ведёт разбор в ней, а не в таблице на диске.»",
  },
  {
    kind: "do",
    text: "Если попросят «а на проде?» — открыть pto.tw1.su, проект test3: 27 файлов, все 126 листов расшифрованы, полоса этапов и таблица те же, замечаний пока ноль.",
  },

  { kind: "h2", text: "Если что-то пойдёт не так" },
  {
    kind: "p",
    text: "Файл повис в «В очереди» — упал конвейер, поднять python -m service и нажать повтор в меню файла. Полоса этапов не появилась — не выбран проект, кликнуть по его названию в левой панели. Таблица пустая — проверить, что открыт демо-проект, а не test3 или LexxDramma_test. Всё разъехалось — npm run demo:seed пересоберёт демо с нуля, npm run demo:agent добавит замечания заново.",
  },
  {
    kind: "note",
    text: "Жёлтое предупреждение про стандартный пароль admin пропадает, как только открыт любой файл. Синяя кнопка «Ошибка» в шапке листа — это инструмент обводки места на чертеже, а не статус.",
  },
];

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const regular = await doc.embedFont(await readFile(FONTS.regular), { subset: true });
const bold = await doc.embedFont(await readFile(FONTS.bold), { subset: true });
const mono = await doc.embedFont(await readFile(FONTS.mono), { subset: true });

doc.setTitle("Демонстрация ПТО: замечания");
doc.setAuthor("ПТО");
doc.setSubject("Инструкция показа демо-стенда");

let page = doc.addPage([PAGE.width, PAGE.height]);
let y = PAGE.height - MARGIN.top;
let pageNumber = 1;

function newPage() {
  page = doc.addPage([PAGE.width, PAGE.height]);
  y = PAGE.height - MARGIN.top;
  pageNumber += 1;
}

function room(height: number) {
  if (y - height < MARGIN.bottom) newPage();
}

/** Перенос по словам: pdf-lib сам не умеет. */
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  keepSpacing = false,
): string[] {
  if (keepSpacing) return text.split("\n");
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

function drawLines(
  lines: string[],
  options: {
    font: PDFFont;
    size: number;
    leading: number;
    x: number;
    color?: ReturnType<typeof rgb>;
  },
) {
  for (const line of lines) {
    room(options.leading);
    page.drawText(line, {
      x: options.x,
      y: y - options.size,
      size: options.size,
      font: options.font,
      color: options.color ?? INK,
    });
    y -= options.leading;
  }
}

function paragraph(
  text: string,
  options: {
    font?: PDFFont;
    size?: number;
    leading?: number;
    indent?: number;
    color?: ReturnType<typeof rgb>;
  } = {},
) {
  const font = options.font ?? regular;
  const size = options.size ?? 10.5;
  const indent = options.indent ?? 0;
  const lines = wrap(text, font, size, WIDTH - indent);
  drawLines(lines, {
    font,
    size,
    leading: options.leading ?? size * 1.42,
    x: MARGIN.left + indent,
    color: options.color,
  });
}

/** Плашка с заливкой: реплика, команда, предупреждение. */
function panel(
  text: string,
  options: {
    fill: ReturnType<typeof rgb>;
    font: PDFFont;
    size: number;
    bar?: ReturnType<typeof rgb>;
    color?: ReturnType<typeof rgb>;
    keepSpacing?: boolean;
  },
) {
  const padding = 8;
  const lines = wrap(
    text,
    options.font,
    options.size,
    WIDTH - padding * 2 - 6,
    options.keepSpacing,
  );
  const leading = options.size * 1.45;
  const height = lines.length * leading + padding * 2 - (leading - options.size);
  room(height + 6);

  page.drawRectangle({
    x: MARGIN.left,
    y: y - height,
    width: WIDTH,
    height,
    color: options.fill,
  });
  if (options.bar) {
    page.drawRectangle({
      x: MARGIN.left,
      y: y - height,
      width: 3,
      height,
      color: options.bar,
    });
  }

  y -= padding;
  drawLines(lines, {
    font: options.font,
    size: options.size,
    leading,
    x: MARGIN.left + padding + 6,
    color: options.color,
  });
  y -= padding - (leading - options.size);
  y -= 8;
}

for (const block of BLOCKS) {
  switch (block.kind) {
    case "h1": {
      const lines = wrap(block.text, bold, 19, WIDTH);
      room(lines.length * 25 + 24);
      drawLines(lines, { font: bold, size: 19, leading: 25, x: MARGIN.left });
      y -= 6;
      page.drawLine({
        start: { x: MARGIN.left, y },
        end: { x: PAGE.width - MARGIN.right, y },
        thickness: 1,
        color: ACCENT,
      });
      y -= 16;
      break;
    }
    case "h2": {
      y -= 10;
      const label =
        block.step !== undefined && block.step > 0
          ? `${block.step}. ${block.text}`
          : block.text;
      const lines = wrap(label, bold, 13, WIDTH);
      // Заголовок не оставляем висеть внизу страницы без первых строк текста.
      room(lines.length * 18 + 12 + 56);
      drawLines(lines, { font: bold, size: 13, leading: 18, x: MARGIN.left, color: ACCENT });
      y -= 5;
      break;
    }
    case "p":
      paragraph(block.text);
      y -= 5;
      break;
    case "do":
      paragraph(`•  ${block.text}`, { indent: 4 });
      y -= 4;
      break;
    case "say":
      panel(block.text, { fill: BOX, bar: ACCENT, font: regular, size: 10 });
      break;
    case "code":
      panel(block.text, { fill: BOX, font: mono, size: 9.5, keepSpacing: true });
      break;
    case "note":
      panel(`Важно.  ${block.text}`, { fill: WARN, font: regular, size: 10 });
      break;
    case "space":
      y -= block.size;
      break;
  }
}

// Колонтитулы: подпись и номер страницы на каждой странице.
const pages = doc.getPages();
pages.forEach((item, index) => {
  item.drawLine({
    start: { x: MARGIN.left, y: MARGIN.bottom - 14 },
    end: { x: PAGE.width - MARGIN.right, y: MARGIN.bottom - 14 },
    thickness: 0.7,
    color: RULE,
  });
  item.drawText("ПТО · инструкция показа демо-стенда", {
    x: MARGIN.left,
    y: MARGIN.bottom - 28,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  const label = `${index + 1} / ${pages.length}`;
  item.drawText(label, {
    x: PAGE.width - MARGIN.right - regular.widthOfTextAtSize(label, 8.5),
    y: MARGIN.bottom - 28,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
});

const bytes = await doc.save();
await writeFile(OUT, bytes);
console.log(`готово: ${OUT} (${pages.length} стр., ${Math.round(bytes.length / 1024)} КБ)`);
