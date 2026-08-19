"""
HTTP helpers shared by the Vercel Python functions.

Kept dependency-light on purpose: the only third-party import is PyJWT, so the
serverless bundle stays small and cold starts stay short. Multipart parsing is
done here rather than through `cgi`, which was removed in Python 3.13.
"""

from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler

MAX_BODY = 16 * 1024 * 1024   # a little above the 15 MB file limit


# ─── Responses ───────────────────────────────────────────────────────────────

def _cors_headers(handler: BaseHTTPRequestHandler) -> dict:
    """
    Allow the browser extension to call these endpoints directly.

    The extension runs on `chrome-extension://…`, which is an opaque origin, so
    it cannot use the cookie session and sends a bearer token instead. Because
    authentication is by token rather than by cookie, echoing the origin here
    does not expose anything to a third-party site — a page without the token
    gets a 401 regardless.
    """
    origin = handler.headers.get("Origin", "")
    return {
        "Access-Control-Allow-Origin": origin or "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    for key, value in _cors_headers(handler).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


def send_error(handler: BaseHTTPRequestHandler, status: int, message: str, hint: str = "", code: str = "") -> None:
    send_json(handler, status, {"ok": False, "error": message, "hint": hint, "code": code})


def send_preflight(handler: BaseHTTPRequestHandler) -> None:
    handler.send_response(204)
    for key, value in _cors_headers(handler).items():
        handler.send_header(key, value)
    handler.send_header("Access-Control-Max-Age", "86400")
    handler.end_headers()


# ─── Auth ────────────────────────────────────────────────────────────────────

class AuthError(Exception):
    pass


def authenticate(handler: BaseHTTPRequestHandler) -> str:
    """
    Verify the session and return the user id.

    Accepts the same two credentials the Node API does: the httpOnly `jt_token`
    cookie used by the web dashboard, and an `Authorization: Bearer` header
    used by the extension, which cannot read httpOnly cookies.
    """
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise AuthError("Authentication is not configured on this server.")

    token = ""
    header = handler.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        token = header[7:].strip()

    if not token:
        cookie_header = handler.headers.get("Cookie", "") or ""
        match = re.search(r"(?:^|;\s*)jt_token=([^;]+)", cookie_header)
        if match:
            token = match.group(1).strip()

    if not token:
        raise AuthError("Not authenticated")

    try:
        import jwt
    except ImportError as exc:  # pragma: no cover - declared in requirements
        raise AuthError("Authentication library is unavailable.") from exc

    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"])
    except Exception as exc:  # noqa: BLE001 - PyJWT raises several types
        raise AuthError("Invalid or expired session") from exc

    user_id = claims.get("id") or claims.get("userId") or claims.get("sub")
    if not user_id:
        raise AuthError("Invalid session")
    return str(user_id)


# ─── Request bodies ──────────────────────────────────────────────────────────

def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        length = 0
    if length <= 0:
        return b""
    if length > MAX_BODY:
        raise ValueError("Request body is too large.")
    return handler.rfile.read(length)


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    raw = read_body(handler)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise ValueError("Request body is not valid JSON.") from exc
    return parsed if isinstance(parsed, dict) else {}


_DISPOSITION_NAME = re.compile(rb'name="([^"]*)"')
_DISPOSITION_FILENAME = re.compile(rb'filename="([^"]*)"')


def parse_multipart(body: bytes, content_type: str) -> dict:
    """
    Minimal multipart/form-data parser.

    Returns a mapping of field name to either a string (regular field) or a
    dict with `filename`, `content_type` and `data` (file field).

    Written by hand because `cgi.FieldStorage` was removed in Python 3.13 and
    pulling in a parsing library for one endpoint is not worth the bundle size.
    """
    match = re.search(r'boundary="?([^";]+)"?', content_type or "", re.I)
    if not match:
        raise ValueError("Malformed multipart request: no boundary.")

    boundary = b"--" + match.group(1).encode("utf-8")
    fields: dict = {}

    for chunk in body.split(boundary):
        if chunk in (b"", b"--", b"--\r\n", b"\r\n"):
            continue
        chunk = chunk.lstrip(b"\r\n")
        if chunk.startswith(b"--"):
            continue

        head, sep, data = chunk.partition(b"\r\n\r\n")
        if not sep:
            continue
        # The trailing CRLF belongs to the delimiter, not to the content.
        if data.endswith(b"\r\n"):
            data = data[:-2]

        name_match = _DISPOSITION_NAME.search(head)
        if not name_match:
            continue
        name = name_match.group(1).decode("utf-8", errors="replace")

        file_match = _DISPOSITION_FILENAME.search(head)
        if file_match:
            part_type = ""
            type_match = re.search(rb"Content-Type:\s*([^\r\n]+)", head, re.I)
            if type_match:
                part_type = type_match.group(1).decode("utf-8", errors="replace").strip()
            fields[name] = {
                "filename": file_match.group(1).decode("utf-8", errors="replace"),
                "content_type": part_type,
                "data": data,
            }
        else:
            fields[name] = data.decode("utf-8", errors="replace")

    return fields


def bootstrap_path() -> None:
    """
    Make `_resume_parser` importable from a function in `api/parser/`.

    Vercel bundles each function separately with its own working directory, so
    the package directory has to be added explicitly rather than relying on the
    repository layout.
    """
    import sys

    here = os.path.dirname(os.path.abspath(__file__))
    api_dir = os.path.dirname(here)
    for path in (api_dir, os.path.dirname(api_dir)):
        if path not in sys.path:
            sys.path.insert(0, path)
