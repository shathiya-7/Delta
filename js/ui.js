import { renderRoadmapView } from './render.js';

/**
 * Initializes dialog modal interactions (opening, closing, backdrop clicks).
 *
 * @param {object} elements - Modal dialog and button elements
 */
export function initDialog(elements) {
  const { dialog, openButtons, closeButtons } = elements;
  if (!dialog) return;

  function resetDialogContent() {
    const eyebrow = document.getElementById('dialog-eyebrow');
    const title = document.getElementById('dialog-title');
    const body = document.getElementById('dialog-body');

    if (eyebrow) eyebrow.textContent = 'WELCOME TO DELTA';
    if (title) title.textContent = 'A bridge to your next chapter.';
    if (body) {
      body.innerHTML = `
        <p>Upload a searchable curriculum PDF, choose a target role, and compare its skill mentions against an international sample of job postings. Your PDF is processed in server memory; syllabus text is not sent to job boards or an AI service.</p>
        <p>Reports include evidence, source availability, skill gaps, and optional 40-minute lab outlines. Faculty must review suggestions. GitHub verification and accounts are planned; they are not implemented.</p>
      `;
    }
  }

  if (openButtons) {
    openButtons.forEach(btn => {
      if (btn) {
        btn.onclick = () => {
          resetDialogContent();
          dialog.showModal();
        };
      }
    });
  }

  if (closeButtons) {
    closeButtons.forEach(btn => {
      if (btn) btn.onclick = () => dialog.close();
    });
  }

  dialog.addEventListener('click', e => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      ) {
        dialog.close();
      }
    }
  });

  return {
    showDialog: () => {
      resetDialogContent();
      dialog.showModal();
    },
    showGitHubDialog: () => {
      const eyebrow = document.getElementById('dialog-eyebrow');
      const title = document.getElementById('dialog-title');
      const body = document.getElementById('dialog-body');

      if (eyebrow) eyebrow.textContent = 'UPCOMING CAPABILITY';
      if (title) title.textContent = 'GitHub Portfolio Integration (SOON)';
      if (body) {
        body.innerHTML = `
          <p>Automated GitHub portfolio scaffolding, repository verification, and grading harnesses are planned for a future Delta release.</p>
          <p>The current version provides layout-preserving PDF curriculum analysis, live entry-level job market alignment, and structured 40-minute lab outline patches for your coursework.</p>
        `;
      }
      dialog.showModal();
    },
  };
}

/**
 * Initializes workspace navigation behavior (Overview, Curricula, Roadmap, GitHub).
 *
 * @param {object} elements - Navigation and content elements
 * @param {object} options - State accessors
 */
export function initNavigation(elements, options = {}) {
  const { navButtons, curriculaSection, roadmapSection, githubSection, resultsSection, dialogHelper } = elements;
  if (!navButtons) return;

  const breadcrumbEl = document.getElementById('breadcrumb-current');

  function updateBreadcrumb(label) {
    if (breadcrumbEl) {
      breadcrumbEl.textContent = label;
    }
  }

  function switchToHome() {
    navButtons.forEach(b => b.classList.toggle('active', b.dataset.view === 'home'));
    if (curriculaSection) curriculaSection.hidden = true;
    if (roadmapSection) roadmapSection.hidden = true;
    if (githubSection) githubSection.hidden = true;
    const currentReport = options.getReport ? options.getReport() : null;
    if (resultsSection && currentReport) {
      resultsSection.hidden = false;
    }
    updateBreadcrumb('Overview');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navButtons.forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;

      navButtons.forEach(b => b.classList.toggle('active', b === button));

      if (view === 'home') {
        switchToHome();
        return;
      }

      if (view === 'curricula') {
        if (roadmapSection) roadmapSection.hidden = true;
        if (githubSection) githubSection.hidden = true;
        if (resultsSection) resultsSection.hidden = true;
        updateBreadcrumb('My curricula');
        if (curriculaSection) {
          const selectedFile = options.getSelectedFile ? options.getSelectedFile() : null;
          const currentReport = options.getReport ? options.getReport() : null;

          if (selectedFile) {
            curriculaSection.innerHTML = `
              <span class="tag">MY CURRICULA · ACTIVE SESSION</span>
              <h2>Your learning starts here.</h2>
              <div class="curricula-card">
                <div class="file-icon" style="margin-bottom: 0;">▤<span>PDF</span></div>
                <div>
                  <strong style="font-size: 13px;">${selectedFile.name}</strong>
                  <p style="margin: 4px 0 0; color: var(--text-muted); font-size: 11px;">
                    ${(selectedFile.size / 1024).toFixed(1)} KB · ${currentReport ? 'Analyzed' : 'Ready for analysis'}
                  </p>
                </div>
              </div>
              <div style="margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="primary-button" id="curricula-analyze-btn" style="width: auto; margin-top: 0; padding: 11px 18px;">
                  ${currentReport ? 'View Analysis in Overview' : 'Go to Overview & Analyze'} <span>↗</span>
                </button>
              </div>
            `;
            const actBtn = curriculaSection.querySelector('#curricula-analyze-btn');
            if (actBtn) actBtn.onclick = switchToHome;
          } else {
            curriculaSection.innerHTML = `
              <span class="tag">MY CURRICULA</span>
              <h2>Your learning starts here.</h2>
              <div class="empty-state-box">
                <p style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">No curriculum uploaded yet</p>
                <p>Upload your course outline or syllabus PDF on the Overview tab to inspect market skill demand, identify potential gaps, and generate learning roadmaps.</p>
                <button class="primary-button" id="curricula-go-upload" style="max-width: 240px; margin: 16px auto 0;">Go to Upload <span>↗</span></button>
              </div>
            `;
            const goBtn = curriculaSection.querySelector('#curricula-go-upload');
            if (goBtn) goBtn.onclick = switchToHome;
          }

          curriculaSection.hidden = false;
          curriculaSection.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      if (view === 'roadmap') {
        if (curriculaSection) curriculaSection.hidden = true;
        if (githubSection) githubSection.hidden = true;
        if (resultsSection) resultsSection.hidden = true;
        updateBreadcrumb('Learning roadmap');
        const currentReport = options.getReport ? options.getReport() : null;
        renderRoadmapView(currentReport, roadmapSection, switchToHome);
        return;
      }

      if (view === 'github') {
        if (curriculaSection) curriculaSection.hidden = true;
        if (roadmapSection) roadmapSection.hidden = true;
        if (resultsSection) resultsSection.hidden = true;
        updateBreadcrumb('GitHub portfolio');
        if (options.onRenderGitHub && githubSection) {
          options.onRenderGitHub(githubSection, switchToHome);
        }
      }
    });
  });

  return {
    switchToHome,
  };
}
