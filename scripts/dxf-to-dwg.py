"""DXF → DWG через LibreDWG dxf2dwg (R2000)."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import ezdxf

ROOT = Path(__file__).resolve().parents[1]
DXF2DWG = ROOT / "tools" / "libredwg" / "dxf2dwg.exe"
DWG2DXF = ROOT / "tools" / "libredwg" / "dwg2dxf.exe"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "samples" / "qa-mixed-sheet.dxf"
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "samples" / "qa-mixed-sheet.dwg"
PACK = ROOT.parent / "пакет-проверки-ПТО"

NEED = [
    "площадь застройки принята 2450 м2, по расчёту ПЗУ 2180 м2",
    "масштаб чертежа 1:100, в задании указан масштаб 1:200",
    "ввод водопровода принят Ду100, по ТУ Ду80",
    "итого единиц оборудования 18 шт, сумма строк 12",
]


def to_r2000(src: Path) -> Path:
    doc = ezdxf.readfile(src)
    tmp = src.with_name(src.stem + "-r2000.dxf")
    r2000 = ezdxf.new("R2000", setup=True)
    r2000.encoding = "cp1251"
    r2000.header["$DWGCODEPAGE"] = "ANSI_1251"
    r2000.header["$INSUNITS"] = 4
    font = Path(r"C:\Windows\Fonts\arial.ttf")
    if font.exists() and "Standard" in r2000.styles:
        r2000.styles.get("Standard").dxf.font = "arial.ttf"
    for layer in doc.layers:
        name = layer.dxf.name
        if name not in r2000.layers:
            r2000.layers.add(name, color=layer.dxf.color)
    src_msp = doc.modelspace()
    dst_msp = r2000.modelspace()
    for e in src_msp:
        kind = e.dxftype()
        attribs = {"layer": e.dxf.layer}
        if hasattr(e.dxf, "color"):
            attribs["color"] = e.dxf.color
        try:
            if getattr(e, "rgb", None):
                attribs["true_color"] = e.dxf.true_color
        except Exception:
            pass
        if kind == "LINE":
            dst_msp.add_line(e.dxf.start, e.dxf.end, dxfattribs=attribs)
        elif kind == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            dst_msp.add_lwpolyline(pts, close=bool(e.closed), dxfattribs=attribs)
        elif kind == "TEXT":
            t = dst_msp.add_text(
                e.dxf.text,
                dxfattribs={**attribs, "height": e.dxf.height, "style": "Standard"},
            )
            t.set_placement((e.dxf.insert.x, e.dxf.insert.y))
        elif kind == "HATCH":
            try:
                h = dst_msp.add_hatch(dxfattribs=attribs)
                if getattr(e, "rgb", None):
                    h.rgb = e.rgb
                for path in e.paths:
                    pts = [(p[0], p[1]) for p in path.vertices]
                    if pts:
                        h.paths.add_polyline_path(pts, is_closed=True)
            except Exception:
                continue
    r2000.saveas(tmp, encoding="cp1251")
    raw = tmp.read_bytes()
    raw = raw.replace(b"ANSI_1252", b"ANSI_1251")
    tmp.write_bytes(raw)
    return tmp


def convert(dxf: Path, dwg: Path) -> None:
    if dwg.exists():
        dwg.unlink()
    cmd = [str(DXF2DWG), "-y", "--as", "r2000", "-o", str(dwg), str(dxf)]
    print("RUN", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(proc.stdout)
    print(proc.stderr)
    if proc.returncode != 0 or not dwg.exists():
        raise SystemExit(f"dxf2dwg failed: {proc.returncode}")


def verify(dwg: Path) -> None:
    head = dwg.read_bytes()[:16]
    print("magic", head[:6])
    if not head.startswith(b"AC"):
        raise SystemExit(f"не DWG: {head!r}")
    tmp = dwg.with_name(dwg.stem + "-roundtrip.dxf")
    proc = subprocess.run(
        [str(DWG2DXF), "-y", "-o", str(tmp), str(dwg)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(proc.stdout)
    print(proc.stderr)
    if not tmp.exists():
        raise SystemExit("dwg2dxf не создал DXF")
    doc = ezdxf.readfile(tmp, encoding="cp1251")
    texts = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
    joined = " ; ".join(texts)
    print("texts", len(texts))
    missing = [q for q in NEED if q not in joined]
    for q in NEED:
        print("OK  " if q not in missing else "MISS", q)
    if missing:
        raise SystemExit("кириллица/цитаты потерялись в DWG")
    tmp.unlink(missing_ok=True)


def main() -> None:
    if not DXF2DWG.exists():
        raise SystemExit(f"нет {DXF2DWG}")
    mid = to_r2000(SRC)
    convert(mid, DST)
    verify(DST)
    if PACK.is_dir():
        shutil.copy2(DST, PACK / DST.name)
    print("DWG", DST, DST.stat().st_size, "байт")


if __name__ == "__main__":
    main()
