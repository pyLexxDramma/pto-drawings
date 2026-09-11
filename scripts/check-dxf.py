"""Проверка сгенерированного DXF так же, как его читает конвейер (ezdxf)."""
import sys

import ezdxf

path = sys.argv[1] if len(sys.argv) > 1 else "samples/qa-kit-mixed.dxf"
doc = ezdxf.readfile(path)
msp = doc.modelspace()
lines = [e for e in msp if e.dxftype() == "LINE"]
texts = [e for e in msp if e.dxftype() == "TEXT"]

print("dxfversion", doc.dxfversion, "encoding", doc.encoding)
print("lines", len(lines), "texts", len(texts))
for t in texts[:6]:
    print(
        round(t.dxf.insert.x, 1),
        round(t.dxf.insert.y, 1),
        round(t.dxf.height, 2),
        repr(t.dxf.text),
    )

need = [
    "площадь застройки принята 2450 м2",
    "по расчёту ПЗУ площадь равна 2180 м2",
    "масштаб чертежа 1:100",
    "в задании указан масштаб 1:200",
    "длина участка L=12.50 м",
    "счетчик ВСХН-20 количество 7 шт",
    "по заданию требуется 4 шт ВСХН-20",
    "отметка чистого пола +0.150",
]
joined = " ; ".join(t.dxf.text for t in texts)
missing = [q for q in need if q not in joined]
for q in need:
    print("OK  " if q not in missing else "MISS", q)
sys.exit(1 if missing else 0)
