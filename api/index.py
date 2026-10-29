import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode

# Add project root directory to Python path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from backend.main import app as fastapi_app

async def app(scope, receive, send):
    """
    ASGI middleware wrapper for Vercel Serverless.
    Restores the client's intended route path when Vercel rewrites to /api/index.py.
    """
    if scope["type"] == "http":
        target_path = None

        # 1. Check if Vercel passed the path via rewrite query parameter
        qs_bytes = scope.get("query_string", b"")
        if b"__vercel_path=" in qs_bytes:
            try:
                params = parse_qs(qs_bytes.decode("utf-8", errors="ignore"))
                target_path = params.pop("__vercel_path", [None])[0]
                cleaned_qs = urlencode({k: v[0] if len(v) == 1 else v for k, v in params.items()})
                scope["query_string"] = cleaned_qs.encode("utf-8")
            except Exception:
                pass

        # 2. Fallback to Vercel internal routing headers
        if not target_path:
            headers = dict(scope.get("headers", []))
            raw_header = (
                headers.get(b"x-forwarded-uri")
                or headers.get(b"x-matched-path")
                or headers.get(b"x-rewrite-url")
            )
            if raw_header:
                try:
                    header_path = raw_header.decode("utf-8").split("?")[0]
                    if header_path and header_path != "/api/index.py":
                        target_path = header_path
                except Exception:
                    pass

        # 3. Apply the intended route path to ASGI scope
        if target_path:
            scope["path"] = target_path

    await fastapi_app(scope, receive, send)
