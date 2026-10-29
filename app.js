import { CONFIG } from './js/config.js';
import { resolveAnalysisServer, analyzeCurriculum } from './js/api.js';
import { renderReport, esc } from './js/render.js';
import { initUpload } from './js/upload.js';
import { initDialog, initNavigation } from './js/ui.js';
import {
  parseGitHubTarget,
  fetchGitHubTarget,
  analyzeGitHubTarget,
  renderGitHubView,
} from './js/github.js';
import {
  initShapeGrid,
  initSplitText,
  initBorderGlow,
  prefersReducedMotion,
} from './js/effects.js';

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
  const githubView = $('github-view');

  // GitHub Portfolio State
  const gitHubState = {
    inputUrl: '',
    data: null,
    loading: false,
    error: null,
  };

  async function handleGitHubSearch(inputUrl) {
    if (!githubView) return;
    gitHubState.inputUrl = inputUrl;
    gitHubState.error = null;

    if (!inputUrl) {
      gitHubState.data = null;
      gitHubState.loading = false;
      renderGitHubView(
        githubView,
        { ...gitHubState, curriculumReport: currentReport },
        {
          onSearch: handleGitHubSearch,
          onGoToOverview: () => navManager.switchToHome(),
          onReset: () => handleGitHubSearch(''),
        }
      );
      return;
    }

    const parsed = parseGitHubTarget(inputUrl);
    if (!parsed.valid) {
      gitHubState.error = parsed.error;
      gitHubState.loading = false;
      renderGitHubView(
        githubView,
        { ...gitHubState, curriculumReport: currentReport },
        {
          onSearch: handleGitHubSearch,
          onGoToOverview: () => navManager.switchToHome(),
          onReset: () => handleGitHubSearch(''),
        }
      );
      return;
    }

    gitHubState.loading = true;
    renderGitHubView(
      githubView,
      { ...gitHubState, curriculumReport: currentReport },
      {
        onSearch: handleGitHubSearch,
        onGoToOverview: () => navManager.switchToHome(),
        onReset: () => handleGitHubSearch(''),
      }
    );

    try {
      const rawData = await fetchGitHubTarget(parsed);
      const analysis = analyzeGitHubTarget(rawData, currentReport);
      gitHubState.data = analysis;
      gitHubState.loading = false;
      gitHubState.error = null;
    } catch (err) {
      gitHubState.loading = false;
      gitHubState.error = err.message || 'Failed to analyze GitHub portfolio.';
      gitHubState.data = null;
    }

    renderGitHubView(
      githubView,
      { ...gitHubState, curriculumReport: currentReport },
      {
        onSearch: handleGitHubSearch,
        onGoToOverview: () => navManager.switchToHome(),
        onReset: () => handleGitHubSearch(''),
      }
    );
    initBorderGlow(githubView.querySelectorAll('.github-search-card, .github-profile-card'));
  }

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

    // Loading button state
    analyzeBtn.innerHTML = `
      <span class="btn-spinner" aria-hidden="true"></span>
      <span>Analyzing curriculum...</span>
    `;

    // Multi-stage animated loading status
    const loadingStages = [
      { main: 'Parsing curriculum & extracting skills', sub: 'In-memory PDF text extraction and course outcome mapping' },
      { main: 'Scanning live international job demand', sub: 'Benchmarking real market postings for junior roles' },
      { main: 'Consulting Gemini AI curriculum intelligence', sub: 'Evaluating modernity index and tailoring project proof' }
    ];
    let stageIdx = 0;

    const renderLoadingStage = (idx) => {
      const stage = loadingStages[idx % loadingStages.length];
      statusEl.innerHTML = `
        <div class="analysis-loader" role="status" aria-live="polite">
          <div class="loader-spinner" aria-hidden="true"></div>
          <div class="loader-text-group">
            <span class="loader-primary-msg">
              <span>${esc(stage.main)}</span>
              <span class="loading-dots" aria-hidden="true"></span>
            </span>
            <span class="loader-secondary-msg">${esc(stage.sub)}</span>
          </div>
        </div>
      `;
    };

    renderLoadingStage(stageIdx);
    const stageTimer = setInterval(() => {
      stageIdx++;
      renderLoadingStage(stageIdx);
    }, 2500);

    // Render prominent animated loading card directly in results section
    resultsEl.hidden = false;
    resultsEl.innerHTML = `
      <div class="results-loading-card border-glow" aria-label="Analyzing curriculum">
        <div class="loading-orb-container">
          <div class="loading-orb-glow"></div>
          <div class="loading-orb-spinner"></div>
          <span class="loading-orb-icon">✳</span>
        </div>
        <h3 class="loading-title">Analyzing Curriculum Intelligence...</h3>
        <p class="loading-subtitle">Cross-referencing your syllabus with live hiring demand and Gemini AI</p>

        <div class="loading-steps-list">
          <div class="loading-step active" id="step-pdf">
            <span class="step-dot"></span>
            <span>Parsing syllabus text & extracting course outcomes</span>
          </div>
          <div class="loading-step" id="step-market">
            <span class="step-dot"></span>
            <span>Benchmarking live job market postings</span>
          </div>
          <div class="loading-step" id="step-ai">
            <span class="step-dot"></span>
            <span>Consulting Gemini AI for industry modernity critique</span>
          </div>
        </div>

        <div class="loading-shimmer-bar">
          <div class="loading-shimmer-wave"></div>
        </div>
      </div>
    `;

    const stepMarketTimer = setTimeout(() => {
      const el = document.getElementById('step-market');
      if (el) el.classList.add('active');
    }, 1200);

    const stepAiTimer = setTimeout(() => {
      const el = document.getElementById('step-ai');
      if (el) el.classList.add('active');
    }, 2400);

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
      initBorderGlow(resultsEl.querySelectorAll('.chart-card, .result-card, .ai-insights-card'));
      statusEl.innerHTML = '';
    } catch (error) {
      clearInterval(stageTimer);
      clearTimeout(stepMarketTimer);
      clearTimeout(stepAiTimer);
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
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

      statusEl.innerHTML = '';
    } finally {
      clearInterval(stageTimer);
      clearTimeout(stepMarketTimer);
      clearTimeout(stepAiTimer);
      clearTimeout(timeout);
      busy = false;
      analyzeBtn.innerHTML = `Analyze curriculum <span>↗</span>`;
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

  const navManager = initNavigation(
    {
      navButtons: document.querySelectorAll('[data-view]'),
      curriculaSection: curriculaView,
      roadmapSection: roadmapView,
      githubSection: githubView,
      resultsSection: resultsEl,
      dialogHelper,
    },
    {
      getSelectedFile: () => uploadManager.getSelectedFile(),
      getReport: () => currentReport,
      onRenderGitHub: (container, switchToHome) => {
        renderGitHubView(
          container,
          { ...gitHubState, curriculumReport: currentReport },
          {
            onSearch: handleGitHubSearch,
            onGoToOverview: switchToHome,
            onReset: () => handleGitHubSearch(''),
          }
        );
        initBorderGlow(container.querySelectorAll('.github-search-card, .github-profile-card'));
      },
    }
  );

  // Initialize ReactBits visual effects
  initShapeGrid('#shape-grid-bg');
  initSplitText('[data-split-text]');
  initBorderGlow('.border-glow');

  // Theme Toggle (Dark pitch-black default, Light pastel)
  const themeToggle = $('theme-toggle');
  const themeIcon = $('theme-icon');
  const themeLabel = $('theme-label');

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      if (themeIcon) themeIcon.textContent = '☾';
      if (themeLabel) themeLabel.textContent = 'Dark';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeIcon) themeIcon.textContent = '☀';
      if (themeLabel) themeLabel.textContent = 'Light';
    }
  }

  function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem('delta_theme', next);
    } catch (_) {}
  }

  try {
    const savedTheme = localStorage.getItem('delta_theme');
    if (savedTheme === 'light') {
      applyTheme('light');
    }
  } catch (_) {}

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Zen Mode Toggle
  const zenToggle = $('zen-toggle');
  function toggleZenMode() {
    const isZen = document.body.classList.toggle('zen-mode');
    try {
      localStorage.setItem('delta_zen_mode', isZen ? 'true' : 'false');
    } catch (_) {}
    if (zenToggle) {
      zenToggle.classList.toggle('active', isZen);
      const label = zenToggle.querySelector('.zen-label');
      if (label) label.textContent = isZen ? 'Exit Zen' : 'Zen Mode';
    }
  }

  try {
    if (localStorage.getItem('delta_zen_mode') === 'true') {
      toggleZenMode();
    }
  } catch (_) {}

  if (zenToggle) {
    zenToggle.addEventListener('click', toggleZenMode);
  }

  window.addEventListener('keydown', (e) => {
    if (
      (e.key === 'z' || e.key === 'Z') &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) &&
      !document.activeElement?.isContentEditable
    ) {
      toggleZenMode();
    }
  });
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
export {
  parseGitHubTarget,
  fetchGitHubTarget,
  analyzeGitHubTarget,
  fetchGitHubPortfolio,
  analyzePortfolio,
  renderGitHubView,
  validateGitHubUsername,
  normalizeGitHubUsername,
  decodeBase64Utf8,
  clearPortfolioCache,
} from './js/github.js';
export {
  initShapeGrid,
  initSplitText,
  initBorderGlow,
  prefersReducedMotion,
} from './js/effects.js';
