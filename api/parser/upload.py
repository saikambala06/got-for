"""POST /api/parser/upload — parse an uploaded PDF or DOCX resume."""

import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _resume_parser import pipeline  # noqa: E402
from _resume_parser.http import (  # noqa: E402
    AuthError, authenticate, parse_multipart, read_body, send_error, send_json, send_preflight,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):  # noqa: N802
        send_preflight(self)

    def do_POST(self):  # noqa: N802
        try:
            authenticate(self)
        except AuthError as exc:
            send_error(self, 401, str(exc), code="unauthenticated")
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
        except Exception as exc:  # noqa: BLE001 - never leak a stack trace
            send_error(
                self, 500,
                "The parser hit an unexpected error on this document.",
                f"{exc.__class__.__name__}: {exc}",
                "internal_error",
            )
            return

        result["ok"] = True
        result["source"] = "upload"
        result["filename"] = upload.get("filename", "")
        send_json(self, 200, result)
