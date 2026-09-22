"""Один CAD-лист для тестов ПТО: текст + сложная таблица + чертёж.

В файле заложены известные расхождения. Каталог — рядом:
samples/qa-mixed-sheet-errors.txt
Запуск: python scripts/build-qa-mixed-sheet.py
"""
from __future__ import annotations

from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

ROOT = Path(__file__).resolve().parents[1]
OUT_DXF = ROOT / "samples" / "qa-mixed-sheet.dxf"
OUT_ERR = ROOT / "samples" / "qa-mixed-sheet-errors.txt"
PACK = ROOT.parent / "пакет-проверки-ПТО"

# Дословные цитаты — те же, что в seed-qa-kit-mixed.mjs (подсветка «Где в ПД»).
Q = {
    "area": "площадь застройки принята 2450 м2",
    "area_calc": "по расчёту ПЗУ площадь равна 2180 м2",
    "scale": "масштаб чертежа 1:100",
    "scale_task": "в задании указан масштаб 1:200",
    "dim": "длина участка L=12.50 м",
    "dim_survey": "по обмеру длина участка L=11.80 м",
    "qty": "счетчик ВСХН-20 количество 7 шт",
    "qty_task": "по заданию требуется 4 шт ВСХН-20",
    "level": "отметка чистого пола +0.150",
    "level_cut": "в разрезе отметка чистого пола +0.250",
}

ERRORS = """Что должен найти ИИ-помощник (заложено намеренно)
DWG: восемь листов в одном файле (генплан+таблица, план, разрез, ПЗУ, парковка, ИТП, кровля, сводка).
PDF в комплекте — растр, на нём модель вызывается сейчас.
Сверять с выдачей: нашёл / не нашёл / нашёл не то.

№   Сложность   Где смотреть              Расхождение
01  легко       текст рядом               площадь застройки 2450 / 2180 м2
02  легко       чертёж рядом              отметка чистого пола +0.150 / +0.250
03  средне      таблица + примечание      ВСХН-20: 7 шт / 4 шт
04  средне      таблица колонки           машиноместа 86 / 72
05  средне      таблица колонки           лифт 1000 / 630 кг
06  средне      текст + штамп             масштаб 1:100 / 1:200
07  средне      текст + таблица           этажей 17 / 16
08  средне      красная ячейка + текст    озеленение 28 % / не менее 35 %
09  средне      текст + строка таблицы    мощность 250 / 180 кВт
10  средне      чертёж + таблица          высота здания 54.00 / 51.60 м
11  средне      объединённая ячейка       огнестойкость II / III
12  трудно      размер на чертеже + текст длина L=12.50 / 11.80 м
13  трудно      объединённая ячейка ИТП + чертёж  ввод Ду100 / Ду80
14  трудно      только текст              квартира 105: 38.4 / 42.1 м2
15  трудно      только чертёж             ширина марша 1.20 / 1.35 м
16  трудно      объединённый итог таблицы итого оборудования 18 шт, сумма строк 12

Если 01–05 пустые — конвейер/модель не видит даже явные пары.
Если 01–09 есть, а 12–16 нет — слабое место: сшивка зон, объединения, чертёж.
"""


def _rgb(entity, color: tuple[int, int, int]) -> None:
    entity.rgb = color


def line(msp, a, b, layer: str, color=None):
    e = msp.add_line(a, b, dxfattribs={"layer": layer})
    if color:
        _rgb(e, color)
    return e


def rect(msp, x, y, w, h, layer: str, color=None):
    line(msp, (x, y), (x + w, y), layer, color)
    line(msp, (x + w, y), (x + w, y + h), layer, color)
    line(msp, (x + w, y + h), (x, y + h), layer, color)
    line(msp, (x, y + h), (x, y), layer, color)


def frame(msp, x, y, w, h, layer="GRAPH"):
    msp.add_lwpolyline(
        [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
        close=True,
        dxfattribs={"layer": layer},
    )


def fill(msp, x, y, w, h, color: tuple[int, int, int], layer="TABLE_FILL"):
    hatch = msp.add_hatch(dxfattribs={"layer": layer})
    hatch.rgb = color
    hatch.paths.add_polyline_path(
        [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
        is_closed=True,
    )
    return hatch


def text(msp, x, y, height, value, layer="TEXT", color=None, align="LEFT"):
    e = msp.add_text(
        value,
        dxfattribs={"layer": layer, "height": height, "style": "Standard"},
    )
    placement = {
        "LEFT": TextEntityAlignment.LEFT,
        "CENTER": TextEntityAlignment.CENTER,
        "RIGHT": TextEntityAlignment.RIGHT,
        "MIDDLE": TextEntityAlignment.MIDDLE_CENTER,
    }[align]
    e.set_placement((x, y), align=placement)
    if color:
        _rgb(e, color)
    return e


FIX = ("ПСВ", "ОП-5", "АПС", "Ду15", "220В", "Св.", "ИПР", "Кран")
DECOY = (
    "бетон B25", "арматура A500", "утеплитель 150", "стяжка 60", "гидроизоляция",
    "окна 5К", "двери EI30", "перегородка 120", "кровля ПВХ", "парапет 600",
    "ливнёвка Ду150", "вент. шахта", "ВРУ-0.4", "АПС адресная", "СОУЭ 3 тип",
    "отмостка 1000", "кабель АВВГ", "заземление", "молниезащита", "ПК-1",
)
EQ = ("К1", "К2", "К3", "В1", "В2", "Т1", "Т2", "Г1", "Э1", "СС1", "П1", "П2")


def _clutter(msp, ox, oy, w, h, ink, muted):
    for i in range(20):
        text(msp, ox + 8, oy + h - 12 - i * 4.2, 1.55, f"{i + 1:02d} {DECOY[i % len(DECOY)]}", "TEXT", muted)
    for r in range(8):
        for c in range(10):
            text(
                msp,
                ox + 70 + c * 32,
                oy + 8 + r * 4.0,
                1.4,
                f"{EQ[(r + c) % len(EQ)]}-{r + 1}{c + 1:02d}",
                "TEXT",
                muted,
            )
    for i in range(32):
        x = ox + 80 + (i % 8) * 38
        y = oy + 48 + (i // 8) * 10
        rect(msp, x, y, 4, 4, "GRAPH", muted)
        text(msp, x + 5, y + 0.6, 1.35, FIX[i % len(FIX)], "TEXT", muted)


def _add_plan_sheet(msp, ox, ink, muted):
    """Второй лист в той же DWG: план этажа — запас на будущий VLM по CAD."""
    frame(msp, ox + 5, 5, 410, 287)
    rect(msp, ox + 10, 10, 400, 277, "GRAPH", ink)
    text(msp, ox + 16, 268, 4.2, "ПЛАН 1 ЭТАЖА. Секции 1–3", "TEXT", ink)
    text(msp, ox + 16, 258, 2.0, "отметка чистого пола +0.150, в разрезе +0.250", "DIM", (16, 120, 64))
    rooms = (
        ("101 Студия", "22.0"),
        ("102 1-комн.", "38.4"),
        ("103 2-комн.", "54.1"),
        ("104 ИТП", "12.0"),
        ("105 1-комн.", "38.4"),
        ("106 С/у", "4.2"),
        ("107 3-комн.", "68.0"),
        ("108 Кладовая", "6.1"),
        ("109 Кухня", "11.4"),
    )
    for i, (name, area) in enumerate(rooms):
        c, r = i % 3, i // 3
        x = ox + 24 + c * 120
        y = 168 - r * 48
        fill(msp, x, y, 112, 42, (230, 232, 236) if i != 4 else (255, 214, 214))
        rect(msp, x, y, 112, 42, "GRAPH", ink)
        text(msp, x + 4, y + 28, 2.3, name, "TEXT", ink)
        text(msp, x + 4, y + 18, 2.0, f"S={area} м2", "TEXT", muted)
        if i == 4:
            text(msp, x + 4, y + 8, 1.55, "площадь квартиры 105 равна 38.4 м2, по обмеру 42.1 м2", "TEXT", (176, 40, 40))
    rect(msp, ox + 24, 88, 36, 70, "GRAPH", ink)
    for s in range(8):
        line(msp, (ox + 28, 94 + s * 8), (ox + 56, 94 + s * 8), "GRAPH", ink)
    text(msp, ox + 26, 80, 1.7, "ширина лестничного марша принята 1.20 м, по нормам 1.35 м", "DIM", (176, 40, 40))
    rect(msp, ox + 68, 100, 28, 40, "GRAPH", ink)
    text(msp, ox + 70, 118, 1.7, "лифт 1000 кг, по заданию 630 кг", "TEXT", (176, 40, 40))
    text(msp, ox + 16, 48, 2.0, "надземных этажей 17, в задании 16", "TEXT", ink)
    text(msp, ox + 16, 40, 1.8, "счетчик ВСХН-20: принято 7 шт, по заданию 4 шт", "TABLE", (176, 40, 40))
    text(msp, ox + 254, 28, 1.8, "Лист 2/8", "TEXT", muted)


def _add_section_sheet(msp, ox, ink, muted):
    """Третий лист: разрез + сетка — больше геометрии на будущий прогон модели."""
    frame(msp, ox + 5, 5, 410, 287)
    rect(msp, ox + 10, 10, 400, 277, "GRAPH", ink)
    text(msp, ox + 16, 268, 4.2, "РАЗРЕЗ 1–1. Лестничная клетка Л1", "TEXT", ink)
    text(msp, ox + 16, 258, 2.0, "высота здания 54.00 м, по разрезу 51.60 м", "DIM", (176, 40, 40))
    base_x, base_y = ox + 40, 40
    for f in range(18):
        y = base_y + f * 12
        line(msp, (base_x, y), (base_x + 220, y), "GRAPH", ink)
        if f in (1, 17):
            line(msp, (base_x, y), (base_x + 220, y), "DIM", (16, 120, 64))
        if f == 1:
            text(msp, base_x + 224, y, 1.8, Q["level"], "DIM", (16, 120, 64))
        if f == 2:
            text(msp, base_x + 224, y, 1.7, Q["level_cut"], "DIM", (176, 40, 40))
        if 0 < f < 17:
            rect(msp, base_x + 80, y, 18, 12, "GRAPH", ink)
            line(msp, (base_x + 82, y + 3), (base_x + 96, y + 3), "GRAPH", ink)
            line(msp, (base_x + 82, y + 6), (base_x + 96, y + 6), "GRAPH", ink)
            line(msp, (base_x + 82, y + 9), (base_x + 96, y + 9), "GRAPH", ink)
    text(msp, ox + 16, 28, 1.9, "ввод водопровода принят Ду100, по ТУ Ду80", "TABLE", (176, 40, 40))
    text(msp, ox + 16, 20, 1.9, "Лист 3/8  Северный квартал", "TEXT", muted)
    for r in range(8):
        for c in range(6):
            x = ox + 250 + c * 26
            y = 56 + r * 24
            fill(msp, x, y, 22, 20, (210, 226, 248) if (r + c) % 2 == 0 else (230, 232, 236))
            rect(msp, x, y, 22, 20, "GRAPH", ink)


def _add_dense_sheet(msp, ox, title, sheet_no, ink, muted, kind):
    frame(msp, ox + 5, 5, 410, 287)
    rect(msp, ox + 10, 10, 400, 277, "GRAPH", ink)
    text(msp, ox + 16, 268, 4.0, title, "TEXT", ink)
    if kind == "site":
        for r in range(12):
            for c in range(14):
                x = ox + 20 + c * 27
                y = 40 + r * 18
                rect(msp, x, y, 24, 16, "GRAPH", muted)
                text(msp, x + 1, y + 6, 1.35, f"уч.{r + 1}{c + 1:02d}", "TEXT", muted)
        text(msp, ox + 16, 28, 1.8, "площадь застройки принята 2450 м2, по расчёту ПЗУ 2180 м2", "TEXT", (176, 40, 40))
    elif kind == "park":
        for r in range(10):
            for c in range(12):
                x = ox + 22 + c * 32
                y = 48 + r * 20
                rect(msp, x, y, 28, 16, "GRAPH", ink)
                text(msp, x + 2, y + 6, 1.4, f"M-{r + 1}{c + 1:02d}", "TEXT", muted)
        text(msp, ox + 16, 28, 1.8, "машиномест в стилобате 86, по расчёту требуется 72", "TEXT", (176, 40, 40))
    elif kind == "itp":
        for i in range(8):
            for j in range(10):
                x = ox + 20 + j * 38
                y = 44 + i * 26
                rect(msp, x, y, 34, 22, "GRAPH", ink)
                text(msp, x + 1.5, y + 12, 1.4, f"поз.{i * 10 + j + 1}", "TEXT", ink)
                text(msp, x + 1.5, y + 5, 1.25, FIX[(i + j) % len(FIX)], "TEXT", muted)
        text(msp, ox + 16, 28, 1.7, "счетчик ВСХН-20: принято 7 шт, по заданию 4 шт", "TABLE", (176, 40, 40))
        text(msp, ox + 16, 22, 1.7, "ввод водопровода принят Ду100, по ТУ Ду80", "TABLE", (176, 40, 40))
    elif kind == "roof":
        for s in range(3):
            rect(msp, ox + 40 + s * 120, 140, 90, 90, "GRAPH", ink)
            text(msp, ox + 68 + s * 120, 180, 3.0, f"Л{s + 1}", "TEXT", ink)
            for k in range(12):
                rect(msp, ox + 44 + s * 120 + (k % 4) * 20, 148 + (k // 4) * 16, 16, 12, "GRAPH", muted)
        text(msp, ox + 16, 36, 2.0, "высота здания 54.00 м, по разрезу 51.60 м", "DIM", (176, 40, 40))
    else:
        for i, row in enumerate((
            "Площадь участка 8640 м2",
            "Строительный объём 41200 м3",
            "Жилая площадь 9860 м2",
            "Общая площадь квартир 12440 м2",
            "Число квартир 216",
            "Детская площадка 180 м2",
            "Спортплощадка 240 м2",
            "Контейнерная 36 м2",
            "Нагрузка на покрытие 2.4 кПа",
            "Снеговой район III",
            "расчётная мощность 250 кВт, по ТУ 180 кВт",
            "озеленение участка 28 %, по ПЗЗ не менее 35 %",
        )):
            text(msp, ox + 20, 240 - i * 14, 2.2, f"{i + 1}. {row}", "TEXT", ink)
    text(msp, ox + 320, 16, 1.8, f"Лист {sheet_no}/8", "TEXT", muted)


def build():
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4
    doc.header["$DWGCODEPAGE"] = "ANSI_1251"
    font = Path(r"C:\Windows\Fonts\arial.ttf")
    if font.exists():
        doc.styles.get("Standard").dxf.font = "arial.ttf"

    for name, aci in (
        ("GRAPH", 7),
        ("DIM", 3),
        ("TEXT", 2),
        ("TABLE", 5),
        ("TABLE_FILL", 8),
    ):
        if name in doc.layers:
            doc.layers.get(name).dxf.color = aci
        else:
            doc.layers.add(name, color=aci)

    msp = doc.modelspace()
    ink = (20, 24, 32)
    muted = (90, 96, 104)
    blue = (36, 92, 168)
    blue_fill = (210, 226, 248)
    gray_fill = (230, 232, 236)
    red_fill = (255, 214, 214)
    yellow_fill = (255, 236, 179)
    green_fill = (214, 237, 214)
    header_fill = (36, 92, 168)

    rect(msp, 5, 5, 410, 287, "GRAPH", ink)
    rect(msp, 10, 10, 400, 277, "GRAPH", ink)

    # —— Чертёж: здание, оси, размеры, ввод, лестница ——
    rect(msp, 24, 118, 228, 160, "GRAPH", ink)
    text(msp, 28, 266, 5.0, "ГЕНПЛАН УЧАСТКА. ЗДАНИЕ А", "TEXT", ink)
    text(msp, 28, 256, 2.2, "отметка чистого пола +0.150, в разрезе +0.250", "DIM", (16, 120, 64))

    rect(msp, 54, 150, 150, 78, "GRAPH", ink)
    line(msp, (54, 189), (204, 189), "GRAPH", ink)
    text(msp, 129, 186, 4.0, "ЗДАНИЕ А", "TEXT", ink, "CENTER")
    text(msp, 129, 176, 2.0, "высота здания 54.00 м, по разрезу 51.60 м", "DIM", (176, 40, 40), "CENTER")
    text(msp, 28, 230, 2.2, "ось А", "DIM", muted)
    text(msp, 210, 230, 2.2, "ось Б", "DIM", muted)

    line(msp, (54, 138), (204, 138), "DIM", (16, 120, 64))
    line(msp, (54, 134), (54, 142), "DIM", (16, 120, 64))
    line(msp, (204, 134), (204, 142), "DIM", (16, 120, 64))
    text(msp, 129, 134, 2.1, "длина участка L=12.50 м, по обмеру L=11.80 м", "DIM", (16, 120, 64), "CENTER")

    # Ввод водопровода на чертеже — Ду80, в таблице Ду100
    line(msp, (24, 168), (54, 168), "GRAPH", (36, 92, 168))
    text(msp, 26, 170, 2.0, "ввод водопровода принят Ду100, по ТУ Ду80", "TEXT", (36, 92, 168))

    # Лестница: только на чертеже 1.20 vs 1.35
    rect(msp, 168, 150, 22, 28, "GRAPH", ink)
    line(msp, (168, 157), (190, 157), "GRAPH", ink)
    line(msp, (168, 164), (190, 164), "GRAPH", ink)
    line(msp, (168, 171), (190, 171), "GRAPH", ink)
    text(msp, 179, 144, 1.55, "ширина лестничного марша принята 1.20 м, по нормам 1.35 м", "DIM", (176, 40, 40), "CENTER")

    # —— Примечания (текст) ——
    text(msp, 24, 108, 3.4, "ПРИМЕЧАНИЯ", "TEXT", ink)
    notes = [
        "1. площадь застройки принята 2450 м2, по расчёту ПЗУ 2180 м2.",
        "2. масштаб чертежа 1:100, в задании указан масштаб 1:200.",
        "3. длина участка L=12.50 м, по обмеру L=11.80 м.",
        "4. счетчик ВСХН-20: принято 7 шт, по заданию 4 шт.",
        "5. отметка чистого пола +0.150, в разрезе +0.250.",
        "6. высота здания 54.00 м, по разрезу 51.60 м.",
        "7. машиномест в стилобате 86, по расчёту требуется 72.",
        "8. степень огнестойкости принята II, в задании III.",
        "9. лифт 1000 кг, по заданию 630 кг.",
        "10. ввод водопровода принят Ду100, по ТУ Ду80.",
        "11. надземных этажей 17, в задании 16.",
        "12. озеленение участка 28 %, по ПЗЗ не менее 35 %.",
        "13. площадь квартиры 105 равна 38.4 м2, по обмеру 42.1 м2.",
        "14. ширина лестничного марша принята 1.20 м, по нормам 1.35 м.",
        "15. расчётная мощность 250 кВт, по ТУ 180 кВт.",
        "16. итого единиц оборудования 18 шт, сумма строк 12.",
    ]
    y = 102
    for row in notes:
        text(msp, 24, y, 2.15, row, "TEXT", ink)
        y -= 5.6

    # —— Сложная таблица: объединения + разные заливки ——
    tx, ty = 258, 268
    row_h = 8.2
    cols = [14, 62, 26, 26, 18]
    table_w = sum(cols)
    xs = [tx]
    for w in cols:
        xs.append(xs[-1] + w)

    def cell_xy(c0, r0, c1=None, r1=None):
        c1 = c0 + 1 if c1 is None else c1
        r1 = r0 + 1 if r1 is None else r1
        x = xs[c0]
        w = xs[c1] - xs[c0]
        y0 = ty - r1 * row_h
        h = (r1 - r0) * row_h
        return x, y0, w, h

    def band(c0, r0, c1, r1, color):
        x, y0, w, h = cell_xy(c0, r0, c1, r1)
        fill(msp, x, y0, w, h, color)

    def grid_box(c0, r0, c1, r1, color=ink):
        x, y0, w, h = cell_xy(c0, r0, c1, r1)
        rect(msp, x, y0, w, h, "TABLE", color)

    def cell_label(c0, r0, value, height=2.05, color=ink, align="LEFT", c1=None, r1=None):
        x, y0, w, h = cell_xy(c0, r0, c1, r1)
        if align == "CENTER":
            text(msp, x + w / 2, y0 + 2.4, height, value, "TABLE", color, "CENTER")
        else:
            text(msp, x + 1.4, y0 + 2.4, height, value, "TABLE", color)

    # r0 заголовок на всю ширину
    band(0, 0, 5, 1, header_fill)
    grid_box(0, 0, 5, 1, blue)
    cell_label(0, 0, "ТЕХНИКО-ЭКОНОМИЧЕСКИЕ ПОКАЗАТЕЛИ И ВЕДОМОСТЬ", 2.2, (255, 255, 255), "CENTER", 5, 1)

    # r1 шапка колонок
    band(0, 1, 5, 2, blue_fill)
    headers = ["Поз", "Наименование", "По проекту", "По заданию", "Пом."]
    for i, title in enumerate(headers):
        grid_box(i, 1, i + 1, 2, blue)
        cell_label(i, 1, title, 2.0, blue, "CENTER")

    # r2 группа «Площади» — объединение всех колонок
    band(0, 2, 5, 3, gray_fill)
    grid_box(0, 2, 5, 3)
    cell_label(0, 2, "1. Площади и объёмы", 2.1, muted, "LEFT", 5, 3)

    # r3 площадь 2450 / 2180
    band(2, 3, 3, 4, yellow_fill)
    band(3, 3, 4, 4, green_fill)
    for c in range(5):
        grid_box(c, 3, c + 1, 4)
    cell_label(0, 3, "1", 2.0, ink, "CENTER")
    cell_label(1, 3, "площадь застройки принята 2450 м2, по расчёту 2180", 1.55)
    cell_label(2, 3, "2450", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 3, "2180", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 3, "ПЗУ", 1.9, muted, "CENTER")

    # r4 высота 54.00 / 51.60
    band(2, 4, 3, 5, yellow_fill)
    for c in range(5):
        grid_box(c, 4, c + 1, 5)
    cell_label(0, 4, "2", 2.0, ink, "CENTER")
    cell_label(1, 4, "высота здания 54.00 м, по разрезу 51.60 м", 1.55)
    cell_label(2, 4, "54.00", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 4, "51.60", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 4, "фасад", 1.9, muted, "CENTER")

    # r5 группа оборудование
    band(0, 5, 5, 6, gray_fill)
    grid_box(0, 5, 5, 6)
    cell_label(0, 5, "2. Инженерное оборудование", 2.1, muted, "LEFT", 5, 6)

    # r6 ВСХН-20 7 / 4 — красная строка
    band(0, 6, 5, 7, red_fill)
    for c in range(5):
        grid_box(c, 6, c + 1, 7, (176, 40, 40))
    cell_label(0, 6, "3", 2.0, (176, 40, 40), "CENTER")
    cell_label(1, 6, "счетчик ВСХН-20: принято 7 шт, по заданию 4 шт", 1.5, (176, 40, 40))
    cell_label(2, 6, "7", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 6, "4", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 6, "ошибка", 1.8, (176, 40, 40), "CENTER")

    # r7–r8 объединённые ячейки ИТП: Ду100 / Ду80 на две строки
    band(1, 7, 2, 9, yellow_fill)
    grid_box(0, 7, 1, 9)
    grid_box(1, 7, 2, 9)
    grid_box(2, 7, 3, 9)
    grid_box(3, 7, 4, 9)
    grid_box(4, 7, 5, 9)
    cell_label(0, 7, "4", 2.0, ink, "CENTER", 1, 9)
    cell_label(1, 7, "ввод водопровода принят Ду100, по ТУ Ду80", 1.7, (176, 40, 40), "LEFT", 2, 9)
    cell_label(2, 7, "Ду100", 2.1, (176, 40, 40), "CENTER", 3, 9)
    cell_label(3, 7, "Ду80", 2.1, (16, 120, 64), "CENTER", 4, 9)
    cell_label(4, 7, "ИТП", 1.9, muted, "CENTER", 5, 9)

    # r9 лифт 1000 / 630
    band(2, 9, 3, 10, yellow_fill)
    for c in range(5):
        grid_box(c, 9, c + 1, 10)
    cell_label(0, 9, "5", 2.0, ink, "CENTER")
    cell_label(1, 9, "лифт 1000 кг, по заданию 630 кг", 1.55)
    cell_label(2, 9, "1000", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 9, "630", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 9, "Л1", 1.9, muted, "CENTER")

    # r10 группа ТЭП
    band(0, 10, 5, 11, gray_fill)
    grid_box(0, 10, 5, 11)
    cell_label(0, 10, "3. Технико-экономические показатели", 2.1, muted, "LEFT", 5, 11)

    # r11 этажность 17 / 16
    for c in range(5):
        grid_box(c, 11, c + 1, 12)
    cell_label(0, 11, "6", 2.0, ink, "CENTER")
    cell_label(1, 11, "надземных этажей 17, в задании 16", 1.55)
    cell_label(2, 11, "17", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 11, "16", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 11, "ПЗ", 1.9, muted, "CENTER")

    # r12 озеленение 28 / 35 — красная ячейка проекта
    band(2, 12, 3, 13, red_fill)
    band(3, 12, 4, 13, green_fill)
    for c in range(5):
        grid_box(c, 12, c + 1, 13)
    cell_label(0, 12, "7", 2.0, ink, "CENTER")
    cell_label(1, 12, "озеленение участка 28 %, по ПЗЗ не менее 35 %", 1.5)
    cell_label(2, 12, "28", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 12, "35", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 12, "норма", 1.8, muted, "CENTER")

    # r13 мощность 250 / 180
    band(2, 13, 3, 14, yellow_fill)
    for c in range(5):
        grid_box(c, 13, c + 1, 14)
    cell_label(0, 13, "8", 2.0, ink, "CENTER")
    cell_label(1, 13, "расчётная мощность 250 кВт, по ТУ 180 кВт", 1.5)
    cell_label(2, 13, "250", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 13, "180", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 13, "ЭОМ", 1.9, muted, "CENTER")

    # r14 машиноместа 86 / 72
    band(2, 14, 3, 15, yellow_fill)
    for c in range(5):
        grid_box(c, 14, c + 1, 15)
    cell_label(0, 14, "9", 2.0, ink, "CENTER")
    cell_label(1, 14, "машиномест в стилобате 86, по расчёту требуется 72", 1.45)
    cell_label(2, 14, "86", 2.1, (176, 40, 40), "CENTER")
    cell_label(3, 14, "72", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 14, "ПЗУ", 1.9, muted, "CENTER")

    # r15 огнестойкость II / III — объединены колонки наименования
    band(1, 15, 3, 16, yellow_fill)
    grid_box(0, 15, 1, 16)
    grid_box(1, 15, 3, 16)
    grid_box(3, 15, 4, 16)
    grid_box(4, 15, 5, 16)
    cell_label(0, 15, "10", 2.0, ink, "CENTER")
    cell_label(1, 15, "степень огнестойкости принята II, в задании III", 1.55, (176, 40, 40), "LEFT", 3, 16)
    cell_label(3, 15, "III", 2.1, (16, 120, 64), "CENTER")
    cell_label(4, 15, "ПЗ", 1.9, muted, "CENTER")

    # r16 итог — объединение, сумма врёт (7+1+4 = 12, написано 18)
    band(0, 16, 5, 17, (255, 228, 196))
    grid_box(0, 16, 5, 17, (176, 40, 40))
    cell_label(
        0,
        16,
        "итого единиц оборудования 18 шт, сумма строк 12",
        2.0,
        (176, 40, 40),
        "LEFT",
        5,
        17,
    )

    # —— Штамп ——
    sx, sy, sw, sh = 258, 18, 146, 44
    rect(msp, sx, sy, sw, sh, "GRAPH", ink)
    line(msp, (sx, sy + 14), (sx + sw, sy + 14), "GRAPH", ink)
    line(msp, (sx, sy + 28), (sx + sw, sy + 28), "GRAPH", ink)
    line(msp, (sx + 52, sy), (sx + 52, sy + sh), "GRAPH", ink)
    text(msp, sx + 3, sy + 32, 2.3, "Объект", "TEXT", muted)
    text(msp, sx + 56, sy + 32, 2.2, "Жилой дом Северный квартал", "TEXT", ink)
    text(msp, sx + 3, sy + 18, 2.3, "Лист", "TEXT", muted)
    text(msp, sx + 56, sy + 18, 2.3, "1/8", "TEXT", ink)
    text(msp, sx + 3, sy + 5, 2.1, "Стадия", "TEXT", muted)
    text(msp, sx + 56, sy + 5, 2.1, "П", "TEXT", ink)

    frame(msp, 5, 5, 410, 287)
    _add_plan_sheet(msp, 430, ink, muted)
    _add_section_sheet(msp, 855, ink, muted)
    extras = (
        (1280, "ГЕНПЛАН. Детализация участка", "4", "site"),
        (1705, "ПЛАН СТИЛОБАТА. Парковка", "5", "park"),
        (2130, "УЗЕЛ УЧЁТА ВОДЫ. Обвязка ИТП", "6", "itp"),
        (2555, "ПЛАН КРОВЛИ. Выходы Л1–Л3", "7", "roof"),
        (2980, "СВОДКА. Справочные показатели", "8", "notes"),
    )
    for ox, title, no, kind in extras:
        _add_dense_sheet(msp, ox, title, no, ink, muted, kind)

    OUT_DXF.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT_DXF)
    OUT_ERR.write_text(ERRORS, encoding="utf-8")
    if PACK.is_dir():
        (PACK / OUT_DXF.name).write_bytes(OUT_DXF.read_bytes())
        (PACK / OUT_ERR.name).write_text(ERRORS, encoding="utf-8")
    return doc


def verify(doc) -> None:
    msp = doc.modelspace()
    texts = [
        e.dxf.text
        for e in msp
        if e.dxftype() == "TEXT"
    ]
    joined = " ; ".join(texts)
    need = [
        "площадь застройки принята 2450 м2, по расчёту ПЗУ 2180 м2",
        "масштаб чертежа 1:100, в задании указан масштаб 1:200",
        "длина участка L=12.50 м, по обмеру L=11.80 м",
        "счетчик ВСХН-20: принято 7 шт, по заданию 4 шт",
        "отметка чистого пола +0.150, в разрезе +0.250",
        "высота здания 54.00 м, по разрезу 51.60 м",
        "ввод водопровода принят Ду100, по ТУ Ду80",
        "ширина лестничного марша принята 1.20 м, по нормам 1.35 м",
        "площадь квартиры 105 равна 38.4 м2, по обмеру 42.1 м2",
        "итого единиц оборудования 18 шт, сумма строк 12",
        "машиномест в стилобате 86, по расчёту требуется 72",
        "надземных этажей 17, в задании 16",
    ]
    missing = [q for q in need if q not in joined]
    hatches = [e for e in msp if e.dxftype() == "HATCH"]
    lines = [e for e in msp if e.dxftype() == "LINE"]
    print("dxf", OUT_DXF, "bytes", OUT_DXF.stat().st_size)
    print("texts", len(texts), "lines", len(lines), "hatches", len(hatches))
    for q in need:
        print("OK  " if q not in missing else "MISS", q)
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    verify(build())
    from subprocess import run

    conv = Path(__file__).with_name("dxf-to-dwg.py")
    if conv.exists():
        run(["python", str(conv), str(OUT_DXF), str(OUT_DXF.with_suffix(".dwg"))], check=True)
