import { renderRoadmapView } from './render.js';

/**
 * Initializes dialog modal interactions (opening, closing, backdrop clicks).
 *
 * @param {object} elements - Modal dialog and button elements
 */
export function initDialog(elements) {
  const { dialog, openButtons, closeButtons } = elements;
  if (!dialog) return;

  if (openButtons) {
    openButtons.forEach(btn => {
      if (btn) btn.onclick = () => dialog.showModal();
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
}

/**
 * Initializes workspace navigation behavior (Overview, Curricula, Roadmap, GitHub).
 *
 * @param {object} elements - Navigation and content elements
 * @param {object} options - State accessors
 */
export function initNavigation(elements, options = {}) {
  const { navButtons, curriculaSection, roadmapSection, dialog } = elements;
  if (!navButtons) return;

  function switchToHome() {
    navButtons.forEach(b => b.classList.toggle('active', b.dataset.view === 'home'));
    if (curriculaSection) curriculaSection.hidden = true;
    if (roadmapSection) roadmapSection.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navButtons.forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;

      if (view === 'github') {
        if (dialog) dialog.showModal();
        return;
      }

      navButtons.forEach(b => b.classList.toggle('active', b === button));

      if (view === 'home') {
        switchToHome();
        return;
      }

      if (view === 'curricula') {
        if (roadmapSection) roadmapSection.hidden = true;
        if (curriculaSection) {
          curriculaSection.innerHTML = `
            <span class="tag">MY CURRICULA</span>
            <h2>Your learning starts here.</h2>
            <p id="curricula-description"></p>
          `;
          const descEl = document.getElementById('curricula-description');
          const selectedFile = options.getSelectedFile ? options.getSelectedFile() : null;

          if (descEl) {
            descEl.textContent = selectedFile
              ? `${selectedFile.name} is selected in this session. Use the upload panel to analyze it or replace your file.`
              : 'No curriculum selected yet. Add your first PDF in the upload panel above.';
          }

          curriculaSection.hidden = false;
          curriculaSection.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      if (view === 'roadmap') {
        if (curriculaSection) curriculaSection.hidden = true;
        const currentReport = options.getReport ? options.getReport() : null;
        renderRoadmapView(currentReport, roadmapSection, switchToHome);
      }
    });
  });

  return {
    switchToHome,
  };
}
