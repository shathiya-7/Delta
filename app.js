import { CONFIG } from './js/config.js';
import { resolveAnalysisServer, analyzeCurriculum } from './js/api.js';
import { renderReport, esc } from './js/render.js';
import { initUpload } from './js/upload.js';
import { initDialog, initNavigation } from './js/ui.js';

// DOM helper
const $ = id => document.getElementById(id);

let busy = false;
let currentReport = null;

export function initApp() {
  const input = $('file-input');
  const dropZone = $('drop-zone');
  const analyzeBtn = $('analyze-button');
  const removeBtn = $('remove-file');
  const errorEl = $('error');
  const statusEl = $('analysis-status');
  const fileSelected = $('file-selected');
  const fileName = $('file-name');
  const fileSize = $('file-size');
  const fileCount = $('file-count');
  const roadmapCount = $('roadmap-count');
  const dropTitle = $('drop-title');
  const dropSubtitle = $('drop-subtitle');
  const resultsEl = $('results');
  const roleSelect = $('target-role');
  const infoDialog = $('info-dialog');
  const curriculaView = $('curricula-view');
  const roadmapView = $('roadmap-view');

  const uploadManager = initUpload(
    {
      input,
      dropZone,
      dropTitle,
      dropSubtitle,
      fileSelected,
      fileName,
      fileSize,
      removeBtn,
      errorEl,
      statusEl,
      fileCountEl: fileCount,
      analyzeBtn,
      resultsEl,
    },
    {
      isBusy: () => busy,
      onFileChange: (file) => {
        // Clear error and retry controls if a file is chosen or removed
        if (errorEl) errorEl.innerHTML = '';
        currentReport = null;
        if (resultsEl) {
          resultsEl.hidden = true;
          resultsEl.innerHTML = '';
        }
        if (roadmapCount) {
          roadmapCount.hidden = true;
          roadmapCount.textContent = '0';
        }
      },
    }
  );

  async function performAnalysis() {
    const selectedFile = uploadManager.getSelectedFile();
    if (!selectedFile || busy) return;

    busy = true;
    analyzeBtn.disabled = true;
    removeBtn.disabled = true;
    input.disabled = true;
    dropZone.setAttribute('aria-disabled', 'true');
    errorEl.innerHTML = '';
    resultsEl.hidden = true;
    statusEl.textContent = CONFIG.MESSAGES.ANALYSIS_RUNNING;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.LIMITS.ANALYSIS_TIMEOUT_MS);

    try {
      const base = await resolveAnalysisServer(controller.signal);
      const role = roleSelect.value;
      const data = await analyzeCurriculum(selectedFile, role, controller.signal, base);

      currentReport = data;

      // Update roadmap badge with count of lab patches
      if (roadmapCount && data.lab_patches) {
        roadmapCount.textContent = data.lab_patches.length;
        roadmapCount.hidden = false;
      }

      renderReport(data, base, resultsEl);
      statusEl.textContent = CONFIG.MESSAGES.ANALYSIS_COMPLETE;
    } catch (error) {
      const isTimeout = error.name === 'AbortError';
      const isNetwork = error.message === 'Failed to fetch';
      const msg = isTimeout
        ? CONFIG.MESSAGES.TIMEOUT
        : isNetwork
        ? CONFIG.MESSAGES.NETWORK_INTERRUPTED
        : error.message;

      // Render actionable error with retry button
      errorEl.innerHTML = `
        <span>${esc(msg)}</span>
        <div class="retry-action">
          <button id="retry-analysis-btn" class="retry-btn">Retry analysis</button>
        </div>
      `;

      const retryBtn = document.getElementById('retry-analysis-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', performAnalysis);
      }

      statusEl.textContent = '';
    } finally {
      clearTimeout(timeout);
      busy = false;
      analyzeBtn.disabled = !uploadManager.getSelectedFile();
      removeBtn.disabled = false;
      input.disabled = false;
      dropZone.removeAttribute('aria-disabled');
    }
  }

  // Synchronous analysis button listener
  analyzeBtn.addEventListener('click', performAnalysis);

  // Dialog and Navigation
  const dialogHelper = initDialog({
    dialog: infoDialog,
    openButtons: [$('help-button'), $('profile-button')],
    closeButtons: [$('close-dialog'), $('dialog-done')],
  });

  initNavigation(
    {
      navButtons: document.querySelectorAll('[data-view]'),
      curriculaSection: curriculaView,
      roadmapSection: roadmapView,
      resultsSection: resultsEl,
      dialogHelper,
    },
    {
      getSelectedFile: () => uploadManager.getSelectedFile(),
      getReport: () => currentReport,
    }
  );
}

// Auto-initialize when running in browser
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}

// Re-export core modules for testing and programmatic consumption
export { CONFIG } from './js/config.js';
export { resolveAnalysisServer, analyzeCurriculum, getReportDownloadUrl } from './js/api.js';
export { renderReport, renderRoadmapView, filterSkillDemand, esc, bullets, jobLink } from './js/render.js';
export { initUpload, validatePdfFile } from './js/upload.js';
export { initDialog, initNavigation } from './js/ui.js';
