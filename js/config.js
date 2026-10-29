// Centralized frontend configuration for Delta
export const CONFIG = {
  // Configurable local development backend fallback URL
  DEFAULT_BACKEND_URL: (typeof window !== 'undefined' && window.DELTA_BACKEND_URL) || 'http://127.0.0.1:8000',

  LOOPBACK_HOSTS: ['localhost', '127.0.0.1', '[::1]'],

  ENDPOINTS: {
    HEALTH: '/api/health',
    ANALYZE: '/api/analyze',
    REPORT_PDF: reportId => `/api/reports/${encodeURIComponent(reportId)}.pdf`,
  },

  HEALTH_CHECK: {
    EXPECTED_STATUS: 'ok',
    EXPECTED_SERVICE: 'delta',
    ACCEPTED_SERVICES: ['delta', 'bridgelabs'],
  },

  LIMITS: {
    MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
    ANALYSIS_TIMEOUT_MS: 120000,           // 120 seconds
  },

  ROLES: [
    { value: 'backend', label: 'Backend developer' },
    { value: 'frontend', label: 'Frontend developer' },
    { value: 'fullstack', label: 'Full stack developer' },
    { value: 'data', label: 'Data analyst' },
    { value: 'ml', label: 'Machine learning engineer' },
    { value: 'devops', label: 'DevOps engineer' },
  ],

  MESSAGES: {
    OFFLINE_LOOPBACK: 'Cannot reach Delta analysis. From the project folder, run: .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000, then retry. You can also open http://127.0.0.1:8000.',
    OFFLINE_REMOTE: 'The analysis service is temporarily unavailable or starting up. Please retry in a moment.',
    ANALYSIS_RUNNING: 'Reading your PDF and collecting international job postings… This can take up to 90 seconds.',
    ANALYSIS_COMPLETE: 'Analysis complete. Review the evidence and data-quality notes below.',
    TIMEOUT: 'Analysis timed out. Retry shortly; a completed market search may now be cached.',
    NETWORK_INTERRUPTED: 'The connection to the analysis service was interrupted. Check your connection and retry.',
    UNEXPECTED_RESPONSE: status => `The analysis server returned an unexpected response (HTTP ${status}). Check the backend terminal and retry.`,
    DEFAULT_ERROR: 'Please check the PDF and selected search options.',
    FILE_NOT_PDF: 'Please choose a PDF file.',
    FILE_TOO_LARGE: 'This file is too large. Please choose a PDF under 10 MB.',
    FILE_EMPTY: 'This file is empty. Please choose another PDF.',
    SINGLE_FILE_ONLY: 'Please select one PDF at a time.',
  },
};
