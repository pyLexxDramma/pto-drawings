"""Плотный DWG по поручению Дархана: текст + сложная таблица + чертежи.

8 листов A1 в одном файле, много мелких подписей. Потолок загрузки 20 МБ.
Запуск: python scripts/build-qa-dwg-max.py
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

ROOT = Path(__file__).resolve().parents[1]
DXF = ROOT / "samples" / "qa-dwg-max.dxf"
DWG = ROOT / "samples" / "qa-dwg-max.dwg"
DXF2DWG = ROOT / "tools" / "libredwg" / "dxf2dwg.exe"
DWG2DXF = ROOT / "tools" / "libredwg" / "dwg2dxf.exe"
PACK = ROOT.parent / "пакет-проверки-ПТО"

E = [
    ("площадь застройки принята 2450 м2", "по расчёту ПЗУ площадь равна 2180 м2"),
    ("масштаб чертежа 1:100", "в задании указан масштаб 1:200"),
    ("длина участка L=12.50 м", "по обмеру длина участка L=11.80 м"),
    ("счетчик ВСХН-20 количество 7 шт", "по заданию требуется 4 шт ВСХН-20"),
    ("отметка чистого пола +0.150", "в разрезе отметка чистого пола +0.250"),
    ("высота здания 54.00 м", "по разрезу высота здания 51.60 м"),
    ("машиномест в стилобате 86", "по расчёту требуется 72 машиноместа"),
    ("степень огнестойкости II", "в задании степень огнестойкости III"),
    ("грузоподъёмность лифта 1000 кг", "по заданию лифт 630 кг"),
    ("ввод водопровода Ду100", "по ТУ ввод водопровода Ду80"),
    ("надземных этажей 17", "в задании надземных этажей 16"),
    ("озеленение участка 28 %", "по ПЗЗ озеленение не менее 35 %"),
    ("площадь квартиры 105 равна 38.4 м2", "по обмеру квартира 105 равна 42.1 м2"),
    ("ширина лестничного марша 1.20 м", "по нормам ширина марша 1.35 м"),
    ("расчётная мощность 250 кВт", "по ТУ электроснабжения 180 кВт"),
]
FIX = ("ПСВ", "ОП-5", "АПС", "Ду15", "220В", "Св.", "ИПР", "Кран")
ROOM = (
    "Тамбур", "Вестибюль", "Охрана", "Колясочная", "Кухня-ниша", "С/у",
    "Кладовая", "ИТП", "Эл.щит.", "Венткамера", "Насосная", "Узел учёта",
)
APT = ("Студия", "1-комн.", "2-комн.", "3-комн.", "Евродвушка")

W, H = 841.0, 594.0
GAP = 40.0
SHEETS = 8
INK = (20, 24, 32)
MUTED = (90, 96, 104)
RED = (176, 40, 40)
GREEN = (16, 120, 64)
BLUE = (36, 92, 168)


def rgb(e, color):
    e.rgb = color


def line(msp, a, b, layer="GRAPH", color=None):
    ent = msp.add_line(a, b, dxfattribs={"layer": layer})
    if color:
        rgb(ent, color)


def rect(msp, x, y, w, h, layer="GRAPH", color=None):
    line(msp, (x, y), (x + w, y), layer, color)
    line(msp, (x + w, y), (x + w, y + h), layer, color)
    line(msp, (x + w, y + h), (x, y + h), layer, color)
    line(msp, (x, y + h), (x, y), layer, color)


def frame(msp, x, y):
    msp.add_lwpolyline(
        [(x, y), (x + W, y), (x + W, y + H), (x, y + H)],
        close=True,
        dxfattribs={"layer": "GRAPH"},
    )
    rect(msp, x + 6, y + 6, W - 12, H - 12, "GRAPH", INK)


def fill(msp, x, y, w, h, color, layer="TABLE_FILL"):
    hatch = msp.add_hatch(dxfattribs={"layer": layer})
    hatch.rgb = color
    hatch.paths.add_polyline_path(
        [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
        is_closed=True,
    )


def text(msp, x, y, h, value, layer="TEXT", color=None, align="LEFT"):
    e = msp.add_text(value, dxfattribs={"layer": layer, "height": h, "style": "Standard"})
    place = {
        "LEFT": TextEntityAlignment.LEFT,
        "CENTER": TextEntityAlignment.CENTER,
        "RIGHT": TextEntityAlignment.RIGHT,
    }[align]
    e.set_placement((x, y), align=place)
    if color:
        rgb(e, color)


def stamp(msp, ox, oy, title, no):
    sx, sy = ox + W - 220, oy + 14
    rect(msp, sx, sy, 200, 70, "GRAPH", INK)
    line(msp, (sx, sy + 22), (sx + 200, sy + 22), "GRAPH", INK)
    line(msp, (sx, sy + 44), (sx + 200, sy + 44), "GRAPH", INK)
    line(msp, (sx + 90, sy), (sx + 90, sy + 70), "GRAPH", INK)
    text(msp, sx + 4, sy + 52, 2.4, "Северный квартал", "TEXT", INK)
    text(msp, sx + 94, sy + 52, 2.6, f"Лист {no}/{SHEETS}", "TEXT", INK)
    text(msp, sx + 4, sy + 30, 2.2, title[:28], "TEXT", INK)
    text(msp, sx + 94, sy + 30, 2.1, E[1][0], "TEXT", RED)
    text(msp, sx + 4, sy + 10, 2.0, E[1][1], "TEXT", GREEN)


def notes(msp, ox, oy):
    text(msp, ox + 14, oy + 88, 2.8, "ПРИМЕЧАНИЯ. Намеренные расхождения:", "TEXT", INK)
    for i, (a, b) in enumerate(E):
        text(msp, ox + 14, oy + 80 - i * 4.4, 2.05, f"{i + 1}. {a}. {b}.", "TEXT", INK)


def sheet_origin(i):
    return i * (W + GAP), 0.0


def draw_floor(msp, ox, oy, variant):
    titles = (
        "ПЛАН 1 ЭТАЖА. Блок-секции 1–3",
        "ПЛАН ТИПОВОГО ЭТАЖА (2–16)",
        "ПЛАН ПОДВАЛА. ИТП / ВК / ЭОМ",
    )
    frame(msp, ox, oy)
    text(msp, ox + 16, oy + H - 22, 5.5, titles[variant], "TEXT", INK)
    text(msp, ox + 16, oy + H - 32, 2.3, f"{E[4][0]}. {E[4][1]}. {E[10][0]}. {E[10][1]}.", "TEXT", MUTED)
    ox0, oy0 = ox + 30, oy + 110
    for s in range(3):
        sx = ox0 + s * 260
        for i in range(7):
            line(msp, (sx + i * 36, oy0), (sx + i * 36, oy0 + 360), "GRAPH", MUTED)
            line(msp, (sx, oy0 + i * 60), (sx + 216, oy0 + i * 60), "GRAPH", MUTED)
        rect(msp, sx, oy0, 216, 360, "GRAPH", INK)
        text(msp, sx + 80, oy0 + 188, 3.2, f"КОРИДОР К{s + 1}", "TEXT", INK)
        rect(msp, sx + 90, oy0 + 150, 28, 70, "GRAPH", INK)
        for st in range(8):
            line(msp, (sx + 94, oy0 + 156 + st * 8), (sx + 114, oy0 + 156 + st * 8), "GRAPH", INK)
        text(msp, sx + 92, oy0 + 148, 1.8, E[13][0], "DIM", RED)
        rect(msp, sx + 122, oy0 + 168, 18, 28, "GRAPH", INK)
        text(msp, sx + 123, oy0 + 178, 1.7, "1000кг" if variant == 0 else "630кг", "TEXT", RED)
        n = 0
        for band_y, rh in ((oy0 + 226, 128), (oy0 + 8, 136)):
            for i in range(5):
                rx = sx + 6 + i * 42
                name = APT[(n + s + variant) % len(APT)] if variant < 2 else ROOM[(n + s) % len(ROOM)]
                num = f"{s + 1}{100 + variant * 20 + n}"
                wet = n % 4 == 2 or "ИТП" in name or "С/у" in name
                if wet:
                    fill(msp, rx, band_y, 38, rh, (230, 232, 236))
                rect(msp, rx, band_y, 38, rh, "GRAPH", INK)
                text(msp, rx + 1.5, band_y + rh - 6, 2.0, num, "TEXT", INK)
                text(msp, rx + 1.5, band_y + rh - 12, 1.7, name, "TEXT", MUTED)
                area = "38.4" if n == 4 and s == 0 and variant == 0 else f"{22 + (n * 7 + s) % 40}.{(n + s) % 10}"
                text(msp, rx + 1.5, band_y + rh - 18, 1.6, f"S={area}", "TEXT", MUTED)
                if n == 4 and s == 0 and variant == 0:
                    text(msp, rx + 1.5, band_y + 8, 1.5, E[12][0], "TEXT", RED)
                    text(msp, rx + 1.5, band_y + 4, 1.4, E[12][1], "TEXT", GREEN)
                for k in range(8):
                    cx = rx + 4 + (k % 4) * 8
                    cy = band_y + 10 + (k // 4) * 10
                    msp.add_circle((cx, cy), 1.1, dxfattribs={"layer": "GRAPH"})
                    text(msp, cx + 1.4, cy - 0.6, 1.15, FIX[k], "TEXT", MUTED)
                n += 1
        text(msp, sx + 4, oy0 - 8, 2.0, f"{46 + s}.{s}00", "DIM", INK)
    text(msp, ox0, oy0 - 20, 2.4, E[2][0], "DIM", RED)
    text(msp, ox0 + 220, oy0 - 20, 2.2, E[2][1], "DIM", GREEN)
    notes(msp, ox, oy)
    stamp(msp, ox, oy, titles[variant][:28], str(variant + 1))


def draw_site(msp, ox, oy):
    frame(msp, ox, oy)
    text(msp, ox + 16, oy + H - 22, 5.5, "ГЕНПЛАН. Схема планировочной организации", "TEXT", INK)
    text(msp, ox + 16, oy + H - 32, 2.3, f"{E[0][0]}. {E[11][0]}. {E[6][0]}.", "TEXT", MUTED)
    bx, by = ox + 40, oy + 120
    rect(msp, bx, by, 760, 400, "GRAPH", INK)
    for i in range(16):
        line(msp, (bx + i * 47.5, by), (bx + i * 47.5, by + 400), "GRAPH", MUTED)
    for i in range(10):
        line(msp, (bx, by + i * 44), (bx + 760, by + i * 44), "GRAPH", MUTED)
    fill(msp, bx + 160, by + 120, 420, 180, (210, 226, 248))
    rect(msp, bx + 160, by + 120, 420, 180, "GRAPH", INK)
    text(msp, bx + 300, by + 210, 6.0, "ЗДАНИЕ А", "TEXT", INK, "CENTER")
    text(msp, bx + 180, by + 190, 2.4, E[0][0], "TEXT", RED)
    text(msp, bx + 180, by + 182, 2.2, E[0][1], "TEXT", GREEN)
    fill(msp, bx + 16, by + 16, 120, 80, (214, 237, 214))
    text(msp, bx + 20, by + 80, 2.2, E[11][0], "TEXT", RED)
    text(msp, bx + 20, by + 72, 2.0, E[11][1], "TEXT", GREEN)
    for r in range(8):
        for c in range(10):
            rect(msp, bx + 600 + (c % 5) * 14, by + 16 + r * 12, 12, 8, "GRAPH", MUTED)
    text(msp, bx + 600, by + 120, 2.1, E[6][0], "TEXT", RED)
    text(msp, bx + 600, by + 112, 2.0, E[6][1], "TEXT", GREEN)
    text(msp, bx + 20, by + 108, 2.2, E[2][0], "DIM", RED)
    text(msp, bx + 20, by + 100, 2.0, E[2][1], "DIM", GREEN)
    notes(msp, ox, oy)
    stamp(msp, ox, oy, "Генплан ПЗУ", "4")


def draw_section(msp, ox, oy):
    frame(msp, ox, oy)
    text(msp, ox + 16, oy + H - 22, 5.5, "РАЗРЕЗ 1–1. По лестничной клетке Л1", "TEXT", INK)
    text(msp, ox + 16, oy + H - 32, 2.3, f"{E[5][0]}. {E[5][1]}. {E[10][0]}.", "TEXT", MUTED)
    base_x, base_y = ox + 80, oy + 110
    for f in range(18):
        y = base_y + f * 22
        line(msp, (base_x, y), (base_x + 360, y), "GRAPH", INK)
        mark = "-3.000" if f == 0 else ("+0.150" if f == 1 else f"+{(f - 1) * 3:.3f}")
        text(msp, base_x - 42, y - 1, 1.8, mark, "DIM", MUTED)
        if 0 < f < 18:
            rect(msp, base_x + 120, y, 36, 22, "GRAPH", INK)
            for s in range(3):
                line(msp, (base_x + 124, y + 5 + s * 5), (base_x + 152, y + 5 + s * 5), "GRAPH", INK)
            rect(msp, base_x + 164, y + 3, 14, 16, "GRAPH", INK)
            for w in range(5):
                rect(msp, base_x + 200 + w * 22, y + 6, 14, 10, "GRAPH", MUTED)
    text(msp, base_x + 380, base_y + 20, 2.2, E[4][0], "DIM", GREEN)
    text(msp, base_x + 380, base_y + 40, 2.1, E[4][1], "DIM", RED)
    text(msp, base_x + 380, base_y + 360, 2.3, E[5][0], "DIM", RED)
    text(msp, base_x + 380, base_y + 348, 2.1, E[5][1], "DIM", GREEN)
    notes(msp, ox, oy)
    stamp(msp, ox, oy, "Разрез 1-1", "5")


def draw_facade(msp, ox, oy):
    frame(msp, ox, oy)
    text(msp, ox + 16, oy + H - 22, 5.5, "ФАСАД 1–3. Внутриквартальный проезд", "TEXT", INK)
    text(msp, ox + 16, oy + H - 32, 2.3, f"{E[5][0]}. {E[7][0]}. {E[7][1]}.", "TEXT", MUTED)
    bx, by = ox + 30, oy + 110
    rect(msp, bx, by, 720, 400, "GRAPH", INK)
    for s in range(3):
        sx = bx + s * 240
        line(msp, (sx, by), (sx, by + 400), "GRAPH", INK)
        for f in range(17):
            for w in range(7):
                rect(msp, sx + 12 + w * 32, by + 12 + f * 22, 22, 14, "GRAPH", MUTED)
        rect(msp, sx + 100, by + 12, 28, 40, "GRAPH", INK)
        text(msp, sx + 104, by + 28, 2.2, f"Л{s + 1}", "TEXT", INK)
    text(msp, bx + 730, by + 380, 2.4, "54.00", "DIM", RED)
    text(msp, bx + 730, by + 360, 2.2, "51.60", "DIM", GREEN)
    notes(msp, ox, oy)
    stamp(msp, ox, oy, "Фасад 1-3", "6")


def draw_table(msp, ox, oy):
    frame(msp, ox, oy)
    text(msp, ox + 16, oy + H - 22, 5.5, "ТЕХНИКО-ЭКОНОМИЧЕСКИЕ ПОКАЗАТЕЛИ И ВЕДОМОСТЬ", "TEXT", INK)
    tx, ty, rh = ox + 20, oy + 520, 16
    cols = (28, 280, 90, 90, 70)
    tw = sum(cols)
    rows = [
        (True, (36, 92, 168), (255, 255, 255), ["ТЕХНИКО-ЭКОНОМИЧЕСКИЕ ПОКАЗАТЕЛИ И ВЕДОМОСТЬ"]),
        (False, (210, 226, 248), INK, ["Поз", "Наименование", "По проекту", "По заданию", "Пом."]),
        (True, (230, 232, 236), MUTED, ["1. Площади и объёмы"]),
        (False, (255, 236, 179), INK, ["1", "Площадь застройки, м2", "2450", "2180", "ПЗУ"]),
        (False, None, INK, ["2", "Высота здания, м", "54.00", "51.60", "фасад"]),
        (True, (230, 232, 236), MUTED, ["2. Инженерное оборудование"]),
        (False, (255, 214, 214), RED, ["3", E[3][0], "7", "4", "ошибка"]),
        (True, (255, 236, 179), RED, ["4  ИТП, ввод водопровода Ду100 / по ТУ Ду80"]),
        (False, None, INK, ["5", "Лифт грузопассажирский, кг", "1000", "630", "Л1"]),
        (True, (230, 232, 236), MUTED, ["3. Технико-экономические показатели"]),
        (False, None, INK, ["6", "Этажность", "17", "16", "ПЗ"]),
        (False, (255, 214, 214), RED, ["7", "Озеленение участка, %", "28", "35", "норма"]),
        (False, None, INK, ["8", "Установленная мощность, кВт", "250", "180", "ЭОМ"]),
        (False, None, INK, ["9", "Машиноместа", "86", "72", "ПЗУ"]),
        (False, (255, 236, 179), RED, ["10", "Степень огнестойкости II", "II", "III", "ПЗ"]),
        (True, (255, 228, 196), RED, ["Итого единиц оборудования (поз. 3–5): 18 шт"]),
    ]
    for r, (span, bg, fg, cells) in enumerate(rows):
        y = ty - (r + 1) * rh
        if bg:
            fill(msp, tx, y, tw, rh, bg)
        rect(msp, tx, y, tw, rh, "TABLE", INK)
        if span:
            text(msp, tx + 4, y + 4.5, 2.3, cells[0], "TABLE", fg)
        else:
            x = tx
            for c, w in enumerate(cols):
                line(msp, (x, y), (x, y + rh), "TABLE", INK)
                text(msp, x + 3, y + 4.5, 2.1, cells[c], "TABLE", fg)
                x += w
    fill(msp, ox + 600, oy + 160, 200, 260, (210, 226, 248))
    rect(msp, ox + 640, oy + 240, 120, 80, "GRAPH", INK)
    text(msp, ox + 668, oy + 276, 3.2, "ЗДАНИЕ А", "TEXT", INK)
    text(msp, ox + 604, oy + 150, 2.2, "ввод водопровода Ду80", "TEXT", BLUE)
    text(msp, ox + 604, oy + 142, 2.0, E[9][0], "TEXT", RED)
    notes(msp, ox, oy)
    stamp(msp, ox, oy, "ТЭП и ведомость", "7")


def draw_node(msp, ox, oy):
    frame(msp, ox, oy)
    text(msp, ox + 16, oy + H - 22, 5.5, "УЗЕЛ УЧЁТА. Обвязка ИТП и ведомость", "TEXT", INK)
    for i in range(8):
        for j in range(12):
            x = ox + 20 + j * 66
            y = oy + 160 + i * 42
            rect(msp, x, y, 60, 36, "GRAPH", MUTED)
            msp.add_circle((x + 10, y + 18), 3.2, dxfattribs={"layer": "GRAPH"})
            text(msp, x + 16, y + 16, 1.8, f"{FIX[j % 8]}-{i + 1}", "TEXT", INK)
            text(msp, x + 4, y + 6, 1.6, f"поз.{i * 12 + j + 1}", "TEXT", MUTED)
            if i == 2 and j == 1:
                text(msp, x + 4, y + 26, 1.5, E[3][0], "TEXT", RED)
            if i == 3 and j == 1:
                text(msp, x + 4, y + 26, 1.5, E[3][1], "TEXT", GREEN)
            if i == 4 and j == 2:
                text(msp, x + 4, y + 26, 1.5, E[9][0], "TEXT", RED)
            if i == 5 and j == 2:
                text(msp, x + 4, y + 26, 1.5, E[9][1], "TEXT", GREEN)
            if i == 1 and j == 3:
                text(msp, x + 4, y + 26, 1.5, E[14][0], "TEXT", RED)
            if i == 2 and j == 3:
                text(msp, x + 4, y + 26, 1.5, E[14][1], "TEXT", GREEN)
    notes(msp, ox, oy)
    stamp(msp, ox, oy, "Узел учёта ИТП", "8")


def build():
    doc = ezdxf.new("R2000", setup=True)
    doc.encoding = "cp1251"
    doc.header["$DWGCODEPAGE"] = "ANSI_1251"
    doc.header["$INSUNITS"] = 4
    font = Path(r"C:\Windows\Fonts\arial.ttf")
    if font.exists():
        doc.styles.get("Standard").dxf.font = "arial.ttf"
    for name, aci in (("GRAPH", 7), ("DIM", 3), ("TEXT", 2), ("TABLE", 5), ("TABLE_FILL", 8)):
        if name in doc.layers:
            doc.layers.get(name).dxf.color = aci
        else:
            doc.layers.add(name, color=aci)
    msp = doc.modelspace()
    origins = [sheet_origin(i) for i in range(SHEETS)]
    draw_floor(msp, *origins[0], 0)
    draw_floor(msp, *origins[1], 1)
    draw_floor(msp, *origins[2], 2)
    draw_site(msp, *origins[3])
    draw_section(msp, *origins[4])
    draw_facade(msp, *origins[5])
    draw_table(msp, *origins[6])
    draw_node(msp, *origins[7])
    DXF.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(DXF, encoding="cp1251")
    raw = DXF.read_bytes().replace(b"ANSI_1252", b"ANSI_1251")
    DXF.write_bytes(raw)
    return doc


def convert_and_check():
    if DWG.exists():
        DWG.unlink()
    proc = subprocess.run(
        [str(DXF2DWG), "-y", "--as", "r2000", "-o", str(DWG), str(DXF)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout, proc.stderr)
    if not DWG.exists():
        raise SystemExit("dxf2dwg не создал DWG")
    if DWG.stat().st_size >= 20 * 1024 * 1024:
        raise SystemExit("DWG >= 20 МБ")
    head = DWG.read_bytes()[:6]
    if not head.startswith(b"AC"):
        raise SystemExit(f"не DWG: {head!r}")
    tmp = DWG.with_name("qa-dwg-max-roundtrip.dxf")
    subprocess.run(
        [str(DWG2DXF), "-y", "-o", str(tmp), str(DWG)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    doc = ezdxf.readfile(tmp, encoding="cp1251")
    texts = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
    joined = " ; ".join(texts)
    need = [E[0][0], E[3][0], E[9][0], "Итого единиц оборудования (поз. 3–5): 18 шт", E[12][0]]
    missing = [q for q in need if q not in joined]
    print("DWG", DWG, DWG.stat().st_size, "байт", "texts", len(texts))
    for q in need:
        print("OK  " if q not in missing else "MISS", q)
    tmp.unlink(missing_ok=True)
    if missing:
        raise SystemExit(1)
    if PACK.is_dir():
        (PACK / DWG.name).write_bytes(DWG.read_bytes())


if __name__ == "__main__":
    build()
    convert_and_check()
