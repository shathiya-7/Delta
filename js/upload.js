import { CONFIG } from './config.js';

/**
 * Validates whether the chosen file is an eligible PDF.
 *
 * @param {File} file - Candidate file
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validatePdfFile(file) {
  if (!file) {
    return { valid: false, error: null };
  }
  const name = file.name || '';
  const type = (file.type || '').toLowerCase();
  if (!/\.pdf$/i.test(name) || (type && !['application/pdf', 'application/x-pdf'].includes(type))) {
    return { valid: false, error: CONFIG.MESSAGES.FILE_NOT_PDF };
  }
  if (file.size > CONFIG.LIMITS.MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: CONFIG.MESSAGES.FILE_TOO_LARGE };
  }
  if (!file.size) {
    return { valid: false, error: CONFIG.MESSAGES.FILE_EMPTY };
  }
  return { valid: true, error: null };
}

/**
 * Initializes upload and drag-and-drop interactions.
 *
 * @param {object} elements - DOM elements for the upload panel
 * @param {object} callbacks - Notification callbacks
 * @returns {{ getSelectedFile: () => File|null, clearSelection: () => void }}
 */
export function initUpload(elements, callbacks = {}) {
  const {
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
    fileCountEl,
    analyzeBtn,
    resultsEl,
  } = elements;

  let selectedFile = null;

  function clearSelection() {
    selectedFile = null;
    input.value = '';
    if (statusEl) statusEl.textContent = '';
    if (errorEl) errorEl.textContent = '';
    if (fileSelected) fileSelected.hidden = true;
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (fileCountEl) fileCountEl.textContent = '0';
    if (resultsEl) resultsEl.hidden = true;
    if (dropTitle) dropTitle.textContent = 'Drop your curriculum here';
    if (dropSubtitle) dropSubtitle.innerHTML = 'or <u>browse files</u> to get started';
    if (callbacks.onFileChange) callbacks.onFileChange(null);
  }

  function selectFile(file) {
    if (callbacks.isBusy && callbacks.isBusy()) return;
    if (errorEl) errorEl.textContent = '';
    if (!file) return;

    const validation = validatePdfFile(file);
    if (!validation.valid) {
      if (errorEl && validation.error) errorEl.textContent = validation.error;
      input.value = '';
      return;
    }

    selectedFile = file;
    if (statusEl) statusEl.textContent = '';
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB · Ready for analysis`;
    if (fileSelected) fileSelected.hidden = false;
    if (dropTitle) dropTitle.textContent = 'Want to use a different curriculum?';
    if (dropSubtitle) dropSubtitle.innerHTML = 'Drop another PDF or <u>browse files</u>';
    if (analyzeBtn) analyzeBtn.disabled = false;
    if (fileCountEl) fileCountEl.textContent = '1';
    if (resultsEl) resultsEl.hidden = true;

    if (callbacks.onFileChange) callbacks.onFileChange(selectedFile);
  }

  dropZone.addEventListener('click', () => {
    if (callbacks.isBusy && callbacks.isBusy()) return;
    input.click();
  });
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (callbacks.isBusy && callbacks.isBusy()) return;
      input.click();
    }
  });

  input.addEventListener('change', () => {
    if (input.files && input.files[0]) {
      selectFile(input.files[0]);
    }
  });

  ['dragenter', 'dragover'].forEach(event => {
    dropZone.addEventListener(event, e => {
      e.preventDefault();
      if (callbacks.isBusy && callbacks.isBusy()) return;
      dropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, e => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
    });
  });

  dropZone.addEventListener('drop', e => {
    if (callbacks.isBusy && callbacks.isBusy()) return;
    if (!e.dataTransfer || !e.dataTransfer.files) return;
    if (e.dataTransfer.files.length !== 1) {
      if (errorEl) errorEl.textContent = CONFIG.MESSAGES.SINGLE_FILE_ONLY;
      return;
    }
    selectFile(e.dataTransfer.files[0]);
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', clearSelection);
  }

  return {
    getSelectedFile: () => selectedFile,
    clearSelection,
  };
}
