"""GET /api/parser/health — capability probe. No authentication required."""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _resume_parser import __version__, ocr  # noqa: E402
from _resume_parser.http import send_json, send_preflight  # noqa: E402
from _resume_parser.validator import MAX_BYTES, MAX_PAGES  # noqa: E402


def _library_versions() -> dict:
    """Report what the extraction stack actually resolved to at runtime."""
    versions = {}
    for module, label in (
        ("pdfplumber", "pdfplumber"),
        ("pdfminer", "pdfminer.six"),
        ("pypdf", "pypdf"),
        ("docx", "python-docx"),
    ):
        try:
            imported = __import__(module)
            versions[label] = getattr(imported, "__version__", "installed")
        except ImportError:
            versions[label] = None
    return versions


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        send_preflight(self)

    def do_GET(self):  # noqa: N802
        send_json(self, 200, {
            "ok": True,
            "engine": "python-pipeline",
            "parser_version": __version__,
            "runtime": f"python {sys.version.split()[0]}",
            "accepts": ["pdf", "docx"],
            "maxFileSizeMb": MAX_BYTES // 1024 // 1024,
            "maxPages": MAX_PAGES,
            "stages": [
                "file_validator",
                "text_extractor",
                "data_cleaner",
                "section_segmenter",
                "ner_engine",
                "json_formatter",
            ],
            "libraries": _library_versions(),
            "ocr": ocr.status(),
        })
