"""
Stage 1 — FileValidator.

Decides whether a byte blob is something we are willing to open, before any
parsing library touches it. Every rejection carries a message a person can act
on, because "invalid file" tells the user nothing.

Validation is done on the *bytes*, not the filename: an attacker (or an
ordinary user who renamed a .doc to .docx) cannot get past this by changing an
extension.
"""

from __future__ import annotations

import logging
import re
import zipfile
from dataclasses import dataclass, field
from io import BytesIO

# pypdf writes structural complaints ("EOF marker not found", "Ignoring wrong
# pointing object") straight to the log for documents it can still read, and
# for ones it cannot. Neither is useful here: every outcome of this module is
# either a successful parse or a typed error carrying a message written for
# the user. Left at default level it fills serverless logs with noise that
# looks like a failure but is not one.
logging.getLogger("pypdf").setLevel(logging.ERROR)

MAX_BYTES = 15 * 1024 * 1024          # 15 MB
MIN_BYTES = 100                        # nothing meaningful is smaller
MAX_PAGES = 15

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
# Legacy .doc / .xls OLE2 compound-file header.
OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
RTF_MAGIC = b"{\\rtf"


class ValidationError(Exception):
    """A file we will not attempt to parse, with a user-facing explanation."""

    def __init__(self, message: str, hint: str = "", code: str = "invalid_file"):
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.code = code


@dataclass
class FileInfo:
    """What the validator learned about the file."""

    kind: str                      # 'pdf' | 'docx'
    size_bytes: int
    filename: str
    page_count: int | None = None
    encrypted: bool = False
    has_text_layer: bool | None = None
    warnings: list[str] = field(default_factory=list)


def _sniff(data: bytes) -> str:
    """Identify the container from its magic bytes."""
    if data.startswith(PDF_MAGIC):
        return "pdf"
    if data.startswith(ZIP_MAGIC):
        return "zip"
    if data.startswith(OLE2_MAGIC):
        return "ole2"
    if data.startswith(RTF_MAGIC):
        return "rtf"
    # Some PDFs carry a BOM or junk before the header; the spec allows the
    # header within the first 1024 bytes.
    if PDF_MAGIC in data[:1024]:
        return "pdf"
    return "unknown"


def _validate_pdf(data: bytes, info: FileInfo) -> FileInfo:
    """Open the PDF far enough to know it is structurally sound."""
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError:  # pragma: no cover - dependency is declared
        info.warnings.append("pypdf unavailable; skipped structural checks.")
        return info

    try:
        reader = PdfReader(BytesIO(data), strict=False)
    except Exception as exc:  # noqa: BLE001 - any failure here means unreadable
        raise ValidationError(
            "This PDF could not be opened — the file looks damaged or incomplete.",
            "Try re-exporting it from the program that created it, or upload the DOCX instead.",
            code="corrupt_pdf",
        ) from exc

    if getattr(reader, "is_encrypted", False):
        # An empty user password is common on "protected" PDFs and can be
        # opened transparently; only a real password is a hard stop.
        try:
            if reader.decrypt("") == 0:
                raise ValidationError(
                    "This PDF is password protected.",
                    "Remove the password (open it, then Save As without encryption) and upload it again.",
                    code="encrypted_pdf",
                )
            info.encrypted = True
            info.warnings.append("PDF was encrypted with an empty password and was opened.")
        except ValidationError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ValidationError(
                "This PDF is password protected and could not be opened.",
                "Remove the password and upload it again.",
                code="encrypted_pdf",
            ) from exc

    try:
        info.page_count = len(reader.pages)
    except Exception:  # noqa: BLE001
        info.page_count = None

    if info.page_count == 0:
        raise ValidationError(
            "This PDF has no pages.",
            "The file may have been truncated during upload or export.",
            code="empty_pdf",
        )

    if info.page_count and info.page_count > MAX_PAGES:
        info.warnings.append(
            f"Only the first {MAX_PAGES} of {info.page_count} pages were read."
        )

    return info


def _validate_docx(data: bytes, info: FileInfo) -> FileInfo:
    """A .docx is a ZIP holding word/document.xml — verify that, not the name."""
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValidationError(
            "This DOCX could not be opened — the file appears to be damaged.",
            "Open it in Word and use Save As to write a fresh .docx.",
            code="corrupt_docx",
        ) from exc

    names = set(archive.namelist())
    if "word/document.xml" not in names:
        # A renamed .pptx/.xlsx/.odt is a ZIP too, so say what it actually is.
        if any(n.startswith("ppt/") for n in names):
            actual = "a PowerPoint presentation"
        elif any(n.startswith("xl/") for n in names):
            actual = "an Excel workbook"
        elif "mimetype" in names:
            actual = "an OpenDocument file"
        else:
            actual = "not a Word document"
        raise ValidationError(
            f"This file is {actual}, not a Word document.",
            "Upload a .docx resume, or export it as a PDF.",
            code="wrong_ooxml",
        )

    bad = archive.testzip()
    if bad is not None:
        raise ValidationError(
            "This DOCX is damaged and could not be read.",
            "Open it in Word and use Save As to write a fresh .docx.",
            code="corrupt_docx",
        )

    return info


def validate(data: bytes, filename: str = "", content_type: str = "") -> FileInfo:
    """
    Validate an uploaded file.

    Args:
        data: raw bytes as uploaded.
        filename: original name, used only for the extension hint.
        content_type: reported MIME type, treated as a hint and never trusted.

    Returns:
        FileInfo describing the accepted file.

    Raises:
        ValidationError: with a message and hint suitable for showing a user.
    """
    if not data:
        raise ValidationError(
            "The uploaded file is empty.",
            "Pick the file again — it may not have finished uploading.",
            code="empty_file",
        )

    size = len(data)
    if size < MIN_BYTES:
        raise ValidationError(
            "That file is too small to be a resume.",
            f"It contains only {size} bytes.",
            code="too_small",
        )
    if size > MAX_BYTES:
        raise ValidationError(
            f"That file is {size / 1024 / 1024:.1f} MB — larger than the {MAX_BYTES // 1024 // 1024} MB limit.",
            "Export a lighter PDF, or upload the DOCX version instead.",
            code="too_large",
        )

    name = (filename or "").strip()
    ext = ""
    match = re.search(r"\.([A-Za-z0-9]{1,5})$", name)
    if match:
        ext = match.group(1).lower()

    sniffed = _sniff(data)

    if sniffed == "ole2" or ext == "doc":
        raise ValidationError(
            "Legacy .doc files are not supported.",
            "Open it in Word and choose Save As → .docx, or export it as a PDF.",
            code="legacy_doc",
        )
    if sniffed == "rtf" or ext == "rtf":
        raise ValidationError(
            "RTF files are not supported.",
            "Open it in Word and save it as .docx or export a PDF.",
            code="rtf",
        )

    if sniffed == "pdf":
        info = FileInfo(kind="pdf", size_bytes=size, filename=name)
        if ext and ext != "pdf":
            info.warnings.append(
                f"The file is named .{ext} but its contents are a PDF; it was read as a PDF."
            )
        return _validate_pdf(data, info)

    if sniffed == "zip":
        info = FileInfo(kind="docx", size_bytes=size, filename=name)
        if ext and ext != "docx":
            info.warnings.append(
                f"The file is named .{ext} but its contents are a Word document; it was read as DOCX."
            )
        return _validate_docx(data, info)

    raise ValidationError(
        "Only PDF (.pdf) and Word (.docx) resumes are supported.",
        f"This file does not look like either (detected: {sniffed}).",
        code="unsupported_type",
    )
