"""
Standalone HTTP server for the parser pipeline.

Two uses:

  * Local development — `python -m _resume_parser.server` from `api/` gives
    you the parser endpoints without needing the Vercel CLI.
  * Container deployment — the Dockerfile runs this so the same pipeline can
    be hosted somewhere with a `tesseract` binary, which is what makes OCR of
    scanned resumes work. See the Dockerfile.

It serves exactly the routes the Vercel functions serve, so switching the
portal between them is a base-URL change and nothing else.
"""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _resume_parser import __version__, ocr, pipeline  # noqa: E402
from _resume_parser.http import (  # noqa: E402
    AuthError, authenticate, parse_multipart, read_body, read_json,
    send_error, send_json, send_preflight,
)
from _resume_parser.validator import MAX_BYTES, MAX_PAGES  # noqa: E402

# Local development convenience: when no JWT_SECRET is configured there is no
# session to verify, so requests are allowed through. This is only ever true
# on a developer machine — every real deployment sets the secret, and the
# server refuses to start without it unless ALLOW_ANONYMOUS is explicit.
ALLOW_ANONYMOUS = os.environ.get("PARSER_ALLOW_ANONYMOUS", "").lower() in {"1", "true", "yes"}


def _library_versions() -> dict:
    versions = {}
    for module, label in (
        ("pdfplumber", "pdfplumber"),
        ("pdfminer", "pdfminer.six"),
        ("pypdf", "pypdf"),
        ("docx", "python-docx"),
    ):
        try:
            versions[label] = getattr(__import__(module), "__version__", "installed")
        except ImportError:
            versions[label] = None
    return versions


class ParserHandler(BaseHTTPRequestHandler):
    server_version = f"resume-parser/{__version__}"

    def log_message(self, fmt, *args):  # noqa: A003 - quieter default logging
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ── Routing ──
    def do_OPTIONS(self):  # noqa: N802
        send_preflight(self)

    def do_GET(self):  # noqa: N802
        if urlparse(self.path).path.rstrip("/") in {"/api/parser/health", "/health"}:
            self._health()
        else:
            send_error(self, 404, "Not found", code="not_found")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        if path in {"/api/parser/upload", "/upload"}:
            self._upload()
        elif path in {"/api/parser/text", "/text"}:
            self._text()
        else:
            send_error(self, 404, "Not found", code="not_found")

    # ── Handlers ──
    def _health(self):
        send_json(self, 200, {
            "ok": True,
            "engine": "python-pipeline",
            "parser_version": __version__,
            "runtime": f"python {sys.version.split()[0]}",
            "accepts": ["pdf", "docx"],
            "maxFileSizeMb": MAX_BYTES // 1024 // 1024,
            "maxPages": MAX_PAGES,
            "stages": [
                "file_validator", "text_extractor", "data_cleaner",
                "section_segmenter", "ner_engine", "json_formatter",
            ],
            "libraries": _library_versions(),
            "ocr": ocr.status(),
        })

    def _authed(self) -> bool:
        if ALLOW_ANONYMOUS and not os.environ.get("JWT_SECRET"):
            return True
        try:
            authenticate(self)
            return True
        except AuthError as exc:
            send_error(self, 401, str(exc), code="unauthenticated")
            return False

    def _upload(self):
        if not self._authed():
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type.lower():
            send_error(self, 400, "Upload the resume as multipart/form-data.", code="bad_request")
            return

        try:
            fields = parse_multipart(read_body(self), content_type)
        except ValueError as exc:
            send_error(self, 400, str(exc), code="bad_request")
            return

        upload = fields.get("file")
        if not isinstance(upload, dict) or not upload.get("data"):
            send_error(self, 400, "Choose a PDF or DOCX resume to parse.", code="no_file")
            return

        query = parse_qs(urlparse(self.path).query)
        allow_ocr = (query.get("ocr", ["true"])[0] or "true").lower() != "false"

        try:
            result = pipeline.parse_document(
                upload["data"],
                filename=upload.get("filename", ""),
                content_type=upload.get("content_type", ""),
                allow_ocr=allow_ocr,
            )
        except pipeline.PipelineError as exc:
            send_error(self, exc.status, exc.message, exc.hint, exc.code)
            return
        except Exception as exc:  # noqa: BLE001
            send_error(self, 500, "The parser hit an unexpected error on this document.",
                       f"{exc.__class__.__name__}: {exc}", "internal_error")
            return

        result.update(ok=True, source="upload", filename=upload.get("filename", ""))
        send_json(self, 200, result)

    def _text(self):
        if not self._authed():
            return
        try:
            body = read_json(self)
        except ValueError as exc:
            send_error(self, 400, str(exc), code="bad_request")
            return

        text = str(body.get("text") or "").strip()
        if not text:
            send_error(self, 400, "Paste your resume text first.", code="empty_text")
            return

        try:
            result = pipeline.parse_text(text)
        except pipeline.PipelineError as exc:
            send_error(self, exc.status, exc.message, exc.hint, exc.code)
            return
        except Exception as exc:  # noqa: BLE001
            send_error(self, 500, "The parser hit an unexpected error on that text.",
                       f"{exc.__class__.__name__}: {exc}", "internal_error")
            return

        result.update(ok=True, source="text", filename="")
        send_json(self, 200, result)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    if not os.environ.get("JWT_SECRET") and not ALLOW_ANONYMOUS:
        sys.stderr.write(
            "JWT_SECRET is not set. Set it to the same value the Node API uses, "
            "or set PARSER_ALLOW_ANONYMOUS=true for local development.\n"
        )
        raise SystemExit(1)

    server = ThreadingHTTPServer(("0.0.0.0", port), ParserHandler)
    sys.stderr.write(f"resume parser listening on :{port} (ocr: {ocr.backend() or 'unavailable'})\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
