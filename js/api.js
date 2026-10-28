import { CONFIG } from './config.js';

/**
 * Resolves the backend server base URL by probing health endpoints.
 * Supports same-origin deployment and local fallback (e.g. static preview on port 5500).
 *
 * @param {AbortSignal} signal - AbortSignal for the request timeout/cancellation
 * @param {object} [options] - Optional overrides for testing or custom configuration
 * @returns {Promise<string>} Base URL of the verified backend server
 */
export async function resolveAnalysisServer(signal, options = {}) {
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  const defaultBackend = options.defaultBackendUrl || (win?.DELTA_BACKEND_URL || CONFIG.DEFAULT_BACKEND_URL);

  if (!win || !win.location) {
    throw new Error('Window context is required to resolve backend server.');
  }

  const hostname = win.location.hostname || '';
  const origin = win.location.origin || '';
  const protocol = win.location.protocol || '';

  const loopback = CONFIG.LOOPBACK_HOSTS.includes(hostname);
  const candidates = protocol === 'file:' ? [] : [origin];

  if (loopback && origin !== defaultBackend) {
    candidates.push(defaultBackend);
  }

  for (const base of candidates) {
    try {
      const response = await fetchFn(`${base}${CONFIG.ENDPOINTS.HEALTH}`, { signal, cache: 'no-store' });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) continue;

      const health = await response.json();
      if (
        health.status === CONFIG.HEALTH_CHECK.EXPECTED_STATUS &&
        health.service === CONFIG.HEALTH_CHECK.EXPECTED_SERVICE
      ) {
        return base;
      }
    } catch (error) {
      if (signal && signal.aborted) throw error;
    }
  }

  throw new Error(
    loopback || protocol === 'file:'
      ? CONFIG.MESSAGES.OFFLINE_LOOPBACK
      : CONFIG.MESSAGES.OFFLINE_REMOTE
  );
}

/**
 * Submits curriculum PDF and target role for synchronous analysis.
 *
 * @param {File} file - PDF file to analyze
 * @param {string} role - Target role identifier (e.g. 'backend')
 * @param {AbortSignal} signal - AbortSignal for request timeout
 * @param {string} apiBase - Resolved backend server base URL
 * @param {object} [options] - Optional custom fetch override
 * @returns {Promise<object>} Analysis report data
 */
export async function analyzeCurriculum(file, role, signal, apiBase, options = {}) {
  const fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  const body = new FormData();
  body.append('file', file);
  body.append('role', role);

  const response = await fetchFn(`${apiBase}${CONFIG.ENDPOINTS.ANALYZE}`, {
    method: 'POST',
    body,
    signal,
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(CONFIG.MESSAGES.UNEXPECTED_RESPONSE(response.status));
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : CONFIG.MESSAGES.DEFAULT_ERROR);
  }

  return data;
}

/**
 * Constructs the download URL for a generated PDF report.
 *
 * @param {string} apiBase - Backend server base URL
 * @param {string} reportId - Identifier of the generated report
 * @param {'full'|'summary'} [version='full'] - Report version
 * @returns {string} Download URL
 */
export function getReportDownloadUrl(apiBase, reportId, version = 'full') {
  return `${apiBase}${CONFIG.ENDPOINTS.REPORT_PDF(reportId)}?version=${encodeURIComponent(version)}`;
}
