"""Растрирует векторный PDF: нет текстового слоя — конвейер обязан звать VLM.

Цель по размеру: 8–18 МБ (жёсткий лимит загрузки 20 МБ).
"""
from __future__ import annotations

import sys
from pathlib import Path

import fitz

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("samples/qa-vlm-force-vector.pdf")
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("samples/qa-vlm-force.pdf")
MAX_BYTES = 18 * 1024 * 1024
MIN_BYTES = 12 * 1024 * 1024
HARD = 20 * 1024 * 1024

TEXT_ONLY_MAX_VECTORS = 200
TEXT_ONLY_MAX_IMAGE_COVER = 0.06
TEXT_ONLY_BIG_BLOCK_SHARE = 0.05
TEXT_ONLY_MIN_CHARS = 600


def would_skip_vlm(page) -> tuple[bool, str]:
    area = page.rect.width * page.rect.height
    drawings = page.get_drawings()
    big = [
        d
        for d in drawings
        if d["rect"].width * d["rect"].height > area * TEXT_ONLY_BIG_BLOCK_SHARE
    ]
    if big:
        return False, f"крупных блоков {len(big)}"
    if len(drawings) > TEXT_ONLY_MAX_VECTORS:
        return False, f"векторов {len(drawings)}"
    covered = 0.0
    for img in page.get_images(full=True):
        for rect in page.get_image_rects(img[0]):
            covered += rect.width * rect.height
    if covered > area * TEXT_ONLY_MAX_IMAGE_COVER:
        return False, f"картинки {100 * covered / area:.0f}%"
    text = page.get_text("text").strip()
    if len(text) < TEXT_ONLY_MIN_CHARS:
        return False, f"текста мало {len(text)}"
    return True, f"только текст {len(text)} симв."


def rasterize(src: Path, scale: float, quality: int) -> bytes:
    doc = fitz.open(src)
    out = fitz.open()
    for page in doc:
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        img = pix.tobytes("jpeg")
        # pymupdf jpeg quality is fixed in tobytes; scale is the size knob
        _ = quality
        npage = out.new_page(width=page.rect.width, height=page.rect.height)
        npage.insert_image(page.rect, stream=img)
    data = out.tobytes(deflate=True, garbage=4)
    out.close()
    doc.close()
    return data


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"нет {SRC}")
    chosen = None
    for scale in (1.6, 2.0, 2.3, 2.6, 3.0):
        data = rasterize(SRC, scale, 72)
        print(f"scale {scale:.1f}: {len(data) / 1024 / 1024:.2f} МБ")
        if len(data) >= HARD:
            print("  слишком большой, стоп")
            break
        chosen = data
        if len(data) >= MIN_BYTES and len(data) <= MAX_BYTES:
            break
    if chosen is None:
        raise SystemExit("не удалось уложить размер")
    if len(chosen) >= HARD:
        raise SystemExit("файл >= 20 МБ")
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_bytes(chosen)
    pack = SRC.parent.parent.parent / "пакет-проверки-ПТО"
    if pack.is_dir():
        (pack / DST.name).write_bytes(chosen)
        err = SRC.with_name("qa-vlm-force-errors.txt")
        if err.exists():
            (pack / err.name).write_bytes(err.read_bytes())

    check = fitz.open(stream=chosen, filetype="pdf")
    print("OUT", DST, f"{len(chosen) / 1024 / 1024:.2f} МБ", "листов", check.page_count)
    for i, page in enumerate(check, 1):
        skip, why = would_skip_vlm(page)
        text_len = len(page.get_text("text").strip())
        imgs = page.get_images()
        print(
            f"  лист {i}: skip_vlm={skip} ({why}); текст={text_len}; картинок={len(imgs)}"
        )
        if skip:
            raise SystemExit(f"лист {i} всё ещё можно пропустить — модель не вызовут")
    check.close()


if __name__ == "__main__":
    main()
