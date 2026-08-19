"""
Stage 2b — OCREngine.

Runs only when a PDF has no text layer, i.e. someone scanned or photographed
their resume. OCR output has no reliable font metadata, so the line model it
produces carries geometry and confidence but not bold/italic.

Backends are probed in order and the first working one is used:

    1. pytesseract + the tesseract binary   (best quality, needs a system binary)
    2. rapidocr-onnxruntime                 (pure pip, no system binary)

Neither is importable on Vercel's Python runtime by default — tesseract is a
system package that runtime does not ship. `available()` reports that honestly
rather than failing at parse time, and `unavailable_reason()` returns a message
that tells the user what to do instead. The same code runs OCR unchanged on any
container host where tesseract is installed.
"""

from __future__ import annotations

import io
import re
from functools import lru_cache

from .extractor import Document, Line, normalise, _classify_bullet, _is_all_caps

# Rendering resolution. 300 DPI is the usual floor for reliable OCR of body
# text; below ~200 accuracy falls off sharply on 10pt type.
RENDER_DPI = 300
MAX_OCR_PAGES = 5           # OCR is slow; a resume that long is unusual
MIN_WORD_CONFIDENCE = 30    # tesseract reports 0-100; below 30 is noise


@lru_cache(maxsize=1)
def _tesseract_ready() -> tuple[bool, str]:
    """Is pytesseract importable and is the tesseract binary actually present?"""
    try:
        import pytesseract
    except ImportError:
        return False, "pytesseract is not installed"
    try:
        version = pytesseract.get_tesseract_version()
    except Exception:  # noqa: BLE001 - pytesseract raises several types here
        return False, "the tesseract binary is not installed on this server"
    return True, f"tesseract {version}"


@lru_cache(maxsize=1)
def _rapidocr_ready() -> tuple[bool, str]:
    try:
        from rapidocr_onnxruntime import RapidOCR  # noqa: F401
    except ImportError:
        return False, "rapidocr-onnxruntime is not installed"
    return True, "rapidocr-onnxruntime"


@lru_cache(maxsize=1)
def _renderer_ready() -> tuple[bool, str]:
    """Something has to turn PDF pages into images before OCR can run."""
    try:
        import pypdfium2  # noqa: F401
        return True, "pypdfium2"
    except ImportError:
        pass
    try:
        from pdf2image import convert_from_bytes  # noqa: F401
        return True, "pdf2image"
    except ImportError:
        pass
    return False, "no PDF rasteriser (install pypdfium2 or pdf2image)"


def backend() -> str | None:
    """Name of the OCR backend that will be used, or None."""
    render_ok, _ = _renderer_ready()
    if not render_ok:
        return None
    if _tesseract_ready()[0]:
        return "pytesseract"
    if _rapidocr_ready()[0]:
        return "rapidocr"
    return None


def available() -> bool:
    return backend() is not None


def unavailable_reason() -> str:
    """A message explaining, in the user's terms, why OCR did not run."""
    render_ok, render_msg = _renderer_ready()
    tess_ok, tess_msg = _tesseract_ready()
    if not render_ok and not tess_ok:
        return (
            "OCR for scanned resumes is not enabled on this server. "
            "Upload a PDF with selectable text, or the DOCX version instead."
        )
    if not tess_ok:
        return (
            f"OCR is not enabled here ({tess_msg}). "
            "Upload a PDF with selectable text, or the DOCX version instead."
        )
    return (
        f"OCR could not start ({render_msg}). "
        "Upload a PDF with selectable text, or the DOCX version instead."
    )


def status() -> dict:
    """Structured capability report for the health endpoint."""
    render_ok, render_msg = _renderer_ready()
    tess_ok, tess_msg = _tesseract_ready()
    rapid_ok, rapid_msg = _rapidocr_ready()
    return {
        "available": available(),
        "backend": backend(),
        "renderer": render_msg if render_ok else None,
        "tesseract": tess_msg if tess_ok else None,
        "rapidocr": rapid_msg if rapid_ok else None,
    }


# ─── Rasterising ─────────────────────────────────────────────────────────────

def _render_pages(data: bytes, dpi: int = RENDER_DPI, limit: int = MAX_OCR_PAGES):
    """Yield PIL images, one per page."""
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
        try:
            for index in range(min(len(pdf), limit)):
                page = pdf[index]
                # pypdfium2's scale is relative to 72 DPI.
                yield page.render(scale=dpi / 72).to_pil()
        finally:
            pdf.close()
        return
    except ImportError:
        pass

    from pdf2image import convert_from_bytes

    for image in convert_from_bytes(data, dpi=dpi, first_page=1, last_page=limit):
        yield image


def _preprocess(image):
    """
    Greyscale, upscale small pages, and binarise.

    Tesseract is markedly more accurate on a high-contrast bitonal image than
    on an anti-aliased colour scan, and small scans benefit from upscaling
    before thresholding rather than after.
    """
    from PIL import Image, ImageOps, ImageFilter

    grey = ImageOps.grayscale(image)

    if grey.width < 1600:
        scale = 1600 / grey.width
        grey = grey.resize((int(grey.width * scale), int(grey.height * scale)), Image.LANCZOS)

    grey = grey.filter(ImageFilter.MedianFilter(size=3))
    grey = ImageOps.autocontrast(grey, cutoff=1)

    # Otsu-style threshold from the histogram, rather than a fixed cut that
    # blows out dark scans.
    histogram = grey.histogram()
    total = sum(histogram)
    sum_all = sum(i * histogram[i] for i in range(256))
    sum_b = 0.0
    weight_b = 0.0
    best_var = -1.0
    threshold = 160
    for i in range(256):
        weight_b += histogram[i]
        if weight_b == 0:
            continue
        weight_f = total - weight_b
        if weight_f == 0:
            break
        sum_b += i * histogram[i]
        mean_b = sum_b / weight_b
        mean_f = (sum_all - sum_b) / weight_f
        variance = weight_b * weight_f * (mean_b - mean_f) ** 2
        if variance > best_var:
            best_var = variance
            threshold = i

    return grey.point(lambda p: 255 if p > threshold else 0, mode="1")


# ─── Backends ────────────────────────────────────────────────────────────────

def _ocr_page_tesseract(image, page_number: int) -> list[Line]:
    """
    Use tesseract's word-level output so real geometry survives.

    image_to_string throws away position; image_to_data keeps the bounding box
    and confidence per word, which is what the segmenter needs downstream.
    """
    import pytesseract
    from pytesseract import Output

    data = pytesseract.image_to_data(
        image,
        output_type=Output.DICT,
        config="--psm 4 --oem 3",   # psm 4: a single column of variable-size text
    )

    rows: dict[tuple[int, int, int], list[dict]] = {}
    count = len(data["text"])
    for i in range(count):
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        try:
            confidence = float(data["conf"][i])
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence < MIN_WORD_CONFIDENCE:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        rows.setdefault(key, []).append({
            "text": text,
            "x0": float(data["left"][i]),
            "x1": float(data["left"][i] + data["width"][i]),
            "top": float(data["top"][i]),
            "height": float(data["height"][i]),
            "conf": confidence,
        })

    lines: list[Line] = []
    for key in sorted(rows, key=lambda k: (rows[k][0]["top"], rows[k][0]["x0"])):
        words = sorted(rows[key], key=lambda w: w["x0"])
        parts = []
        prev = None
        for w in words:
            if prev is not None:
                gap = w["x0"] - prev["x1"]
                if gap > w["height"] * 1.6:
                    parts.append("\t")
                elif gap > 0:
                    parts.append(" ")
            parts.append(w["text"])
            prev = w

        raw = normalise("".join(parts))
        if not raw:
            continue
        text, level = _classify_bullet(raw)
        if not text:
            continue

        heights = [w["height"] for w in words]
        lines.append(Line(
            text=text,
            page=page_number,
            column=0,
            x0=round(words[0]["x0"], 1),
            x1=round(words[-1]["x1"], 1),
            top=round(words[0]["top"], 1),
            size=round(sum(heights) / len(heights), 1),
            bullet=level > 0,
            bullet_level=level,
            all_caps=_is_all_caps(text),
        ))

    return lines


def _ocr_page_rapidocr(image, page_number: int) -> list[Line]:
    from rapidocr_onnxruntime import RapidOCR
    import numpy as np

    engine = _rapid_engine()
    result, _ = engine(np.array(image.convert("RGB")))
    if not result:
        return []

    lines: list[Line] = []
    for box, text, score in result:
        clean = normalise(text)
        if not clean or float(score) < 0.4:
            continue
        stripped, level = _classify_bullet(clean)
        if not stripped:
            continue
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        lines.append(Line(
            text=stripped,
            page=page_number,
            x0=round(min(xs), 1),
            x1=round(max(xs), 1),
            top=round(min(ys), 1),
            size=round(max(ys) - min(ys), 1),
            bullet=level > 0,
            bullet_level=level,
            all_caps=_is_all_caps(stripped),
        ))

    lines.sort(key=lambda l: (l.top, l.x0))
    return lines


@lru_cache(maxsize=1)
def _rapid_engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR()


# ─── Public API ──────────────────────────────────────────────────────────────

def extract_pdf(data: bytes) -> Document:
    """
    OCR every page of a scanned PDF into the standard line model.

    Raises:
        OCRError: when no backend is available or nothing legible was found.
    """
    name = backend()
    if name is None:
        raise OCRError("OCR is not available on this server.", unavailable_reason())

    doc = Document(kind="pdf", method=f"ocr:{name}", ocr_used=True)
    page_number = 0

    for image in _render_pages(data):
        page_number += 1
        try:
            prepared = _preprocess(image)
        except Exception:  # noqa: BLE001 - fall back to the raw render
            prepared = image

        try:
            if name == "pytesseract":
                page_lines = _ocr_page_tesseract(prepared, page_number)
            else:
                page_lines = _ocr_page_rapidocr(prepared, page_number)
        except Exception as exc:  # noqa: BLE001 - one page must not kill the run
            doc.warnings.append(f"OCR failed on page {page_number} ({exc.__class__.__name__}).")
            continue

        doc.lines.extend(page_lines)

    doc.page_count = page_number
    if not doc.lines:
        raise OCRError(
            "OCR did not find any readable text in this document.",
            "Try a clearer or higher-resolution scan, or upload the original file.",
        )

    doc.warnings.append(
        "Text was recovered with OCR, so some characters may be misread. Review the fields before saving."
    )
    return doc


class OCRError(Exception):
    def __init__(self, message: str, hint: str = ""):
        super().__init__(message)
        self.message = message
        self.hint = hint
