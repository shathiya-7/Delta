import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from backend.contracts import (
    APIErrorResponse,
    AnalysisReport,
    AnalysisStatusResponse,
    HealthResponse,
)
from backend.main import API_VERSION, app


def test_health_contract_requires_delta_service_and_version():
    response = HealthResponse(status='ok', service='delta', version='1.0.0')

    assert response.status == 'ok'
    assert response.service == 'delta'
    assert response.version == '1.0.0'

    with pytest.raises(ValidationError):
        HealthResponse(status='ok', service='bridgelabs', version='1.0.0')


def test_analysis_status_contract_accepts_declared_state_and_valid_progress():
    response = AnalysisStatusResponse(
        status='collecting_jobs',
        progress_percent=40,
        stage_message='Collecting job postings',
        warnings=[],
        error=None,
    )

    assert response.status == 'collecting_jobs'
    assert response.progress_percent == 40

    with pytest.raises(ValidationError):
        AnalysisStatusResponse(
            status='working',
            progress_percent=120,
            stage_message='Collecting job postings',
            warnings=[],
            error=None,
        )


def test_error_contract_uses_shared_envelope():
    response = APIErrorResponse(
        error={
            'code': 'analysis_busy',
            'message': 'Please retry shortly.',
            'retryable': True,
        }
    )

    assert response.error.code == 'analysis_busy'
    assert response.error.message == 'Please retry shortly.'
    assert response.error.retryable is True


def test_report_contract_keeps_unavailable_ai_explicit_and_scores_nullable():
    response = AnalysisReport(
        role='Backend developer',
        generated_at='2026-10-28T00:00:00Z',
        filename='course.pdf',
        market={
            'sample_size': 0,
            'collected_at': '2026-10-28T00:00:00Z',
            'cached': False,
            'sources': [],
            'excluded': {},
            'warnings': ['No usable job postings were returned.'],
        },
        summary={
            'analyzed_jobs': 0,
            'mention_coverage_percent': None,
            'detected_curriculum_skills': 0,
            'demanded_skills': 0,
            'missing_skills': 0,
        },
        skills=[],
        gaps=[],
        lab_suggestions=[],
        jobs=[],
        methodology='Coverage is based on available evidence.',
        limitations=[],
        ai={'available': False, 'explanations': [], 'roadmap': []},
    )

    assert response.summary.mention_coverage_percent is None
    assert response.ai.available is False
    assert response.ai.roadmap == []


def test_health_and_roles_endpoints_match_shared_contract():
    client = TestClient(app)

    health = client.get('/api/health')
    assert health.status_code == 200
    assert health.json() == {
        'status': 'ok',
        'service': 'delta',
        'version': API_VERSION,
    }

    roles = client.get('/api/roles')
    assert roles.status_code == 200
    assert roles.json() == [
        {'id': 'backend', 'label': 'Backend developer'},
        {'id': 'frontend', 'label': 'Frontend developer'},
        {'id': 'fullstack', 'label': 'Full stack developer'},
        {'id': 'data', 'label': 'Data analyst'},
        {'id': 'ml', 'label': 'Machine learning engineer'},
        {'id': 'devops', 'label': 'DevOps engineer'},
    ]


def test_http_errors_use_shared_envelope_without_exposing_internal_details():
    client = TestClient(app)

    missing = client.get('/api/does-not-exist')
    assert missing.status_code == 404
    assert missing.json() == {
        'error': {
            'code': 'not_found',
            'message': 'Not Found',
            'retryable': False,
        }
    }

    invalid_role = client.post(
        '/api/analyze',
        files={'file': ('course.pdf', b'not a pdf', 'application/pdf')},
        data={'role': 'unsupported'},
    )
    assert invalid_role.status_code == 422
    assert invalid_role.json() == {
        'error': {
            'code': 'invalid_request',
            'message': 'Choose a supported role.',
            'retryable': False,
        }
    }


def test_request_validation_error_uses_shared_envelope():
    response = TestClient(app).post('/api/analyze')

    assert response.status_code == 422
    assert response.json() == {
        'error': {
            'code': 'invalid_request',
            'message': 'Request data is invalid.',
            'retryable': False,
        }
    }
