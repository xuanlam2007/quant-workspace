import hmac
import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError

MAX_BODY_BYTES = 32 * 1024 * 1024


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EmptyRequest(StrictRequest):
    pass


async def empty_body(request: Request):
    body = await request.body()
    if not body:
        return
    try:
        EmptyRequest.model_validate_json(body)
    except ValidationError:
        raise HTTPException(422, "This route accepts only an empty object") from None


def workspace_origin(origin):
    try:
        url = urlsplit(origin or "")
        return url.scheme in ("http", "https") and url.hostname in ("localhost", "127.0.0.1", "::1") and not url.username and not url.password and url.path in ("", "/") and not url.query and not url.fragment
    except ValueError:
        return False


def install_request_security(app):
    token = os.getenv("QUANT_ENGINE_TOKEN", "")
    if not token:
        path = Path(__file__).resolve().parents[3] / ".agents" / "engine-token"
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("x", encoding="utf-8") as file:
                file.write(secrets.token_hex(32))
            path.chmod(0o600)
        except FileExistsError:
            pass
        token = path.read_text(encoding="utf-8").strip()
    if len(token) < 32 or len(token) > 256 or not token.isascii() or any(ord(char) < 33 for char in token):
        raise ValueError("Invalid engine authentication configuration")
    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, error):
        # Không phản chiếu input, audio, chiến lược hoặc credentials trong lỗi schema.
        return JSONResponse({"detail": "Invalid request", "errors": [{"loc": item["loc"], "type": item["type"]} for item in error.errors()]}, status_code=422)

    @app.middleware("http")
    async def boundary(request, call_next):
        host = request.url.hostname
        if host not in ("localhost", "127.0.0.1", "::1", "testserver"):
            return JSONResponse({"detail": "Invalid engine host"}, status_code=403)
        if request.method != "OPTIONS" and request.url.path.startswith("/api/") and not hmac.compare_digest(request.headers.get("x-quant-engine-token", "").encode("utf-8"), token.encode("ascii")):
            return JSONResponse({"detail": "Engine authentication required"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and not workspace_origin(origin):
            return JSONResponse({"detail": "Invalid workspace origin"}, status_code=403)
        if request.method == "OPTIONS":
            return await call_next(request)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY_BYTES:
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        if body:
            if request.method not in ("POST", "PUT", "PATCH"):
                return JSONResponse({"detail": "This route does not accept a body"}, status_code=422)
            if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
                return JSONResponse({"detail": "JSON content type required"}, status_code=415)
            try:
                if not isinstance(json.loads(body), dict):
                    raise ValueError("Expected object")
            except ValueError:
                return JSONResponse({"detail": "JSON object required"}, status_code=422)
        request._body = bytes(body)
        return await call_next(request)
