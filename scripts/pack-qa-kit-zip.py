"""ZIP: DWG (на будущее, когда VLM пойдёт по CAD) + PDF (модель сейчас)."""
from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
PACK = ROOT.parent / "пакет-проверки-ПТО"
ZIP_NAME = "qa-kit-model-dwg.zip"

README = """Комплект: PDF (модель сейчас) + один DWG

Как залить
- Этот ZIP целиком. Лимит 20 МБ.
- PDF + один DWG = один комплект. Не клади второй DWG в тот же архив.

Что внутри
- qa-vlm-force.pdf — 8 листов A2, растр, много мелких подписей. Модель обязана вызваться.
- qa-mixed-sheet.dwg — 8 листов: текст, цветная таблица с объединениями, чертежи,
  сетка мелких элементов. Сейчас модель на DWG не зовётся (чтение CAD).
- errors.txt — 16 заложенных расхождений. Одинаковые в PDF и DWG.

Сверка по каждому файлу: нашёл / не нашёл / нашёл не то.
"""

ERRORS = (SAMPLES / "qa-mixed-sheet-errors.txt").read_text(encoding="utf-8")


def main() -> None:
    pdf = SAMPLES / "qa-vlm-force.pdf"
    dwg = SAMPLES / "qa-mixed-sheet.dwg"
    if not pdf.exists():
        raise SystemExit(f"нет {pdf} — сначала node scripts/build-qa-vlm-force.mjs")
    if not dwg.exists():
        raise SystemExit(f"нет {dwg} — сначала python scripts/build-qa-mixed-sheet.py")
    dest = SAMPLES / ZIP_NAME
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(pdf, "qa-vlm-force.pdf")
        zf.write(dwg, "qa-mixed-sheet.dwg")
        zf.writestr("errors.txt", ERRORS)
        zf.writestr("README.txt", README)
    size = dest.stat().st_size
    if size >= 20 * 1024 * 1024:
        raise SystemExit(f"ZIP {size} >= 20 МБ")
    if PACK.is_dir():
        (PACK / ZIP_NAME).write_bytes(dest.read_bytes())
        (PACK / "qa-kit-README.txt").write_text(README, encoding="utf-8")
    print(f"ZIP {dest} {size / 1024 / 1024:.2f} МБ")


if __name__ == "__main__":
    main()
