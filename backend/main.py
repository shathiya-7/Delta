from pathlib import Path
from typing import Literal
import logging
import threading
import secrets
import time
from collections import OrderedDict
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from .contracts import HealthResponse, RoleOption
from .engine import parse_pdf, build_report
from .ai import generate_ai_analysis
from .market import ROLES, collect_market
from .pdf_report import generate_pdf, generate_summary_pdf

app = FastAPI(title='Delta curriculum analysis')
API_VERSION = '1.0.0'
# Allow local development previews and Vercel deployments to use the API
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r'https?://(?:localhost|127\.0\.0\.1|\[::1\]|.*\.vercel\.app)(?::\d+)?',
    allow_methods=['*'],
    allow_headers=['*'],
)


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            'error': {
                'code': code,
                'message': message,
                'retryable': status_code == 429 or status_code >= 500,
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(_request: Request, exc: StarletteHTTPException):
    codes = {
        404: 'not_found',
        413: 'file_too_large',
        422: 'invalid_request',
        429: 'analysis_busy',
    }
    message = exc.detail if isinstance(exc.detail, str) else 'The request could not be completed.'
    return error_response(exc.status_code, codes.get(exc.status_code, 'http_error'), message)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, _exc: RequestValidationError):
    return error_response(422, 'invalid_request', 'Request data is invalid.')


@app.exception_handler(Exception)
async def handle_unexpected_error(_request: Request, exc: Exception):
    logging.error(
        'Unhandled request error',
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return error_response(500, 'internal_error', 'The server could not complete the request.')

ROOT = Path(__file__).resolve().parent.parent
ACTIVE = threading.BoundedSemaphore(2)
REPORTS = OrderedDict()
REPORT_LOCK = threading.Lock()
REPORT_TTL = 1800

@app.get('/api/health', response_model=HealthResponse)
def health():
    return {'status': 'ok', 'service': 'delta', 'version': API_VERSION}

@app.get('/api/roles', response_model=list[RoleOption])
def list_roles():
    return [{'id': role_id, 'label': details[0]} for role_id, details in ROLES.items()]

@app.post('/api/analyze')
async def analyze(file: UploadFile = File(...), role: str = Form('backend')):
    if role not in ROLES:
        raise HTTPException(422, 'Choose a supported role.')
    if not (file.filename or '').lower().endswith('.pdf'):
        raise HTTPException(422, 'Upload a PDF file.')
    if not ACTIVE.acquire(blocking=False):
        raise HTTPException(429, 'Analysis is busy. Please retry shortly.')
    try:
        data = await file.read(10*1024*1024+1)
        if len(data) > 10*1024*1024:
            raise HTTPException(413, 'PDF must be at most 10 MB.')
        curriculum = await run_in_threadpool(parse_pdf, data)
        market = await run_in_threadpool(collect_market, role)
        report = build_report(curriculum, market, ROLES[role][0])
        ai_insights = await run_in_threadpool(generate_ai_analysis, curriculum, ROLES[role][0])
        report['ai_insights'] = ai_insights
        report['ai'] = {
            'available': ai_insights.get('status') == 'ready',
            'explanations': [ai_insights.get('data', {}).get('executive_critique', '')] if ai_insights.get('status') == 'ready' else [],
            'roadmap': [ai_insights.get('data', {}).get('recommended_project', '')] if ai_insights.get('status') == 'ready' else [],
        }
        report['jobs'] = [{k:v for k,v in j.items() if k != 'analysis_text'} for j in market['jobs']]
        report['filename'] = file.filename
        pdf = await run_in_threadpool(generate_pdf, report)
        summary_pdf = await run_in_threadpool(generate_summary_pdf, report)
        report_id = secrets.token_urlsafe(24)
        with REPORT_LOCK:
            for stale in [key for key,(created, _) in REPORTS.items() if time.monotonic()-created >= REPORT_TTL]:
                REPORTS.pop(stale)
            while len(REPORTS) >= 20:
                REPORTS.popitem(last=False)
            REPORTS[report_id] = (time.monotonic(), {'full': pdf, 'summary': summary_pdf})
        report['report_id'] = report_id
        return report
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logging.exception('Analysis failed')
        raise HTTPException(500, 'Analysis could not complete. Check server logs and retry.') from exc
    finally:
        await file.close()
        ACTIVE.release()

@app.get('/api/reports/{report_id}.pdf')
def download_pdf(report_id: str, version: Literal['full', 'summary'] = 'full'):
    with REPORT_LOCK:
        saved = REPORTS.get(report_id)
        if not saved or time.monotonic()-saved[0] >= REPORT_TTL:
            REPORTS.pop(report_id, None)
            raise HTTPException(404, 'Report expired or unavailable. Run the analysis again to download a fresh PDF.')
        pdf = saved[1][version]
    filename = 'delta-executive-summary.pdf' if version == 'summary' else 'delta-analysis.pdf'
    return Response(pdf, media_type='application/pdf', headers={
        'Content-Disposition': f'attachment; filename="{filename}"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    })

@app.get('/')
def index():
    return FileResponse(ROOT / 'index.html')

@app.get('/js/{file_path:path}')
def serve_js(file_path: str):
    target = ROOT / 'js' / file_path
    if target.exists() and target.is_file():
        return FileResponse(target, media_type='application/javascript')
    raise HTTPException(404)

@app.get('/{asset}')
def asset(asset: str):
    if asset not in {'app.js', 'styles.css'}:
        raise HTTPException(404)
    media_type = 'application/javascript' if asset.endswith('.js') else 'text/css'
    return FileResponse(ROOT / asset, media_type=media_type)
