"""POST /api/parser/text — parse pasted resume text."""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _resume_parser import pipeline  # noqa: E402
from _resume_parser.http import (  # noqa: E402
    AuthError, authenticate, read_json, send_error, send_json, send_preflight,
)

MAX_CHARS = 400_000


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):  # noqa: N802
        send_preflight(self)

    def do_POST(self):  # noqa: N802
        try:
            authenticate(self)
        except AuthError as exc:
            send_error(self, 401, str(exc), code="unauthenticated")
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
        if len(text) > MAX_CHARS:
            send_error(self, 413, "That text is too long to parse.", code="too_large")
            return

        try:
            result = pipeline.parse_text(text)
        except pipeline.PipelineError as exc:
            send_error(self, exc.status, exc.message, exc.hint, exc.code)
            return
        except Exception as exc:  # noqa: BLE001
            send_error(
                self, 500,
                "The parser hit an unexpected error on that text.",
                f"{exc.__class__.__name__}: {exc}",
                "internal_error",
            )
            return

        result["ok"] = True
        result["source"] = "text"
        result["filename"] = ""
        send_json(self, 200, result)
