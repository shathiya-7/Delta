/**
 * DELTA UI Effects — Vanilla implementations inspired by ReactBits
 * 1. ShapeGrid: Canvas-based animated drifting diagonal grid with interactive hover & ripple
 * 2. SplitText: Accessible character-level viewport reveal typography
 * 3. BorderGlow: Pointer-driven dynamic glowing border on selected high-value cards
 */

/**
 * Checks if the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 1. ShapeGrid — Canvas Animated Grid Background
 *
 * @param {HTMLElement|string} containerOrSelector
 * @param {object} options
 */
export function initShapeGrid(containerOrSelector, options = {}) {
  if (typeof document === 'undefined') return { destroy: () => {} };

  const container = typeof containerOrSelector === 'string'
    ? document.querySelector(containerOrSelector)
    : containerOrSelector;

  if (!container) return { destroy: () => {} };

  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'shape-grid-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy: () => {} };

  const cfg = {
    cellSize: options.cellSize || 40,
    speed: options.speed !== undefined ? options.speed : 0.25,
    lineColor: options.lineColor || '#151724',
    hoverColor: options.hoverColor || '#9201CB',
    hoverFillColor: options.hoverFillColor || '#F715AB',
    fillOpacity: options.fillOpacity !== undefined ? options.fillOpacity : 0.10,
    glow: options.glow !== undefined ? options.glow : true,
    fade: options.fade !== undefined ? options.fade : true,
    clickCascade: options.clickCascade !== undefined ? options.clickCascade : true,
    ...options,
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let animId = null;
  let isRunning = false;
  let offsetX = 0;
  let offsetY = 0;

  // Active hover cells map: "col,row" -> { col, row, intensity }
  const activeCells = new Map();
  // Active ripple cascades: array of { x, y, radius, maxRadius, alpha }
  const ripples = [];

  let mouseX = -1000;
  let mouseY = -1000;

  function resize() {
    if (!container || !canvas) return;
    const rect = container.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderFrame() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const cs = cfg.cellSize;
    const cols = Math.ceil(width / cs) + 2;
    const rows = Math.ceil(height / cs) + 2;

    const startX = (offsetX % cs) - cs;
    const startY = (offsetY % cs) - cs;

    const isLight = typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'light';

    // 1. Draw static grid lines
    ctx.beginPath();
    ctx.strokeStyle = isLight ? '#E3E6EE' : cfg.lineColor;
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = startX; x <= width + cs; x += cs) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    // Horizontal lines
    for (let y = startY; y <= height + cs; y += cs) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // 2. Process Ripples
    for (let rIdx = ripples.length - 1; rIdx >= 0; rIdx--) {
      const rip = ripples[rIdx];
      rip.radius += 3.5;
      rip.alpha -= 0.015;

      if (rip.alpha <= 0 || rip.radius >= rip.maxRadius) {
        ripples.splice(rIdx, 1);
        continue;
      }

      // Light up cells touched by ripple front
      const rCol = Math.floor((rip.x - offsetX) / cs);
      const rRow = Math.floor((rip.y - offsetY) / cs);
      const radiusInCells = Math.ceil(rip.radius / cs);

      for (let c = rCol - radiusInCells; c <= rCol + radiusInCells; c++) {
        for (let r = rRow - radiusInCells; r <= rRow + radiusInCells; r++) {
          const cx = c * cs + offsetX + cs / 2;
          const cy = r * cs + offsetY + cs / 2;
          const dist = Math.hypot(cx - rip.x, cy - rip.y);
          if (Math.abs(dist - rip.radius) < cs * 0.8) {
            const key = `${c},${r}`;
            const existing = activeCells.get(key);
            const intensity = Math.min(1, rip.alpha * 0.8);
            if (!existing || existing.intensity < intensity) {
              activeCells.set(key, { col: c, row: r, intensity });
            }
          }
        }
      }
    }

    // 3. Draw Active Highlighted Cells
    for (const [key, cell] of activeCells.entries()) {
      cell.intensity -= 0.025; // Smooth fade decay
      if (cell.intensity <= 0) {
        activeCells.delete(key);
        continue;
      }

      const cellX = cell.col * cs + offsetX;
      const cellY = cell.row * cs + offsetY;

      if (cellX + cs < 0 || cellX > width || cellY + cs < 0 || cellY > height) {
        continue;
      }

      const alpha = Math.max(0, Math.min(1, cell.intensity));

      // Cell Fill
      ctx.fillStyle = isLight
        ? `rgba(230, 42, 154, ${(alpha * cfg.fillOpacity * 1.2).toFixed(3)})`
        : `rgba(247, 21, 171, ${(alpha * cfg.fillOpacity).toFixed(3)})`;
      ctx.fillRect(cellX, cellY, cs, cs);

      // Glowing Cell Border
      ctx.strokeStyle = isLight
        ? `rgba(157, 59, 209, ${(alpha * 0.6).toFixed(3)})`
        : `rgba(146, 1, 203, ${(alpha * 0.75).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX + 0.5, cellY + 0.5, cs - 1, cs - 1);
    }
  }

  function loop() {
    if (!isRunning) return;

    if (!prefersReducedMotion()) {
      offsetX = (offsetX + cfg.speed * 0.35) % cfg.cellSize;
      offsetY = (offsetY + cfg.speed * 0.35) % cfg.cellSize;
    }

    renderFrame();

    if (!prefersReducedMotion()) {
      animId = requestAnimationFrame(loop);
    }
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    if (prefersReducedMotion()) {
      renderFrame();
    } else {
      animId = requestAnimationFrame(loop);
    }
  }

  function stop() {
    isRunning = false;
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  // Pointer event listeners
  function onPointerMove(e) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;

    if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;

    const cs = cfg.cellSize;
    const col = Math.floor((mouseX - offsetX) / cs);
    const row = Math.floor((mouseY - offsetY) / cs);

    // Primary hover cell
    activeCells.set(`${col},${row}`, { col, row, intensity: 1.0 });

    // Subtle glow on neighbors
    if (cfg.glow) {
      const neighbors = [
        [col + 1, row],
        [col - 1, row],
        [col, row + 1],
        [col, row - 1],
      ];
      for (const [nc, nr] of neighbors) {
        const k = `${nc},${nr}`;
        const existing = activeCells.get(k);
        if (!existing || existing.intensity < 0.35) {
          activeCells.set(k, { col: nc, row: nr, intensity: 0.35 });
        }
      }
    }

    if (prefersReducedMotion()) {
      renderFrame();
    }
  }

  function onPointerLeave() {
    mouseX = -1000;
    mouseY = -1000;
  }

  function onPointerDown(e) {
    if (!cfg.clickCascade || !container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x >= 0 && x <= width && y >= 0 && y <= height) {
      ripples.push({
        x,
        y,
        radius: 4,
        maxRadius: Math.min(width, height, 220),
        alpha: 0.7,
      });
      if (prefersReducedMotion()) renderFrame();
    }
  }

  // Visibility and Intersection observers
  let observer = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          start();
        } else {
          stop();
        }
      }
    }, { threshold: 0.05 });
    observer.observe(container);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  resize();
  start();

  return {
    destroy: () => {
      stop();
      if (observer) observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      activeCells.clear();
      ripples.length = 0;
    },
    refresh: () => {
      resize();
      renderFrame();
    },
  };
}

/**
 * 2. SplitText — Accessible Viewport Reveal Typography
 *
 * @param {string|HTMLElement|NodeList} target
 * @param {object} options
 */
export function initSplitText(target = '[data-split-text]', options = {}) {
  if (typeof document === 'undefined') return { refresh: () => {}, destroy: () => {} };

  const cfg = {
    staggerDelay: options.staggerDelay || 28, // ms per char
    threshold: options.threshold || 0.15,
    ...options,
  };

  const elements = typeof target === 'string'
    ? document.querySelectorAll(target)
    : ((typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) || (target && target.nodeType === 1))
    ? [target]
    : target;

  if (!elements || elements.length === 0) return { refresh: () => {}, destroy: () => {} };

  const processedElements = [];

  elements.forEach((el) => {
    if (!el || el.dataset.splitInitialized === 'true') return;

    // Capture clean accessible sentence before altering DOM
    const rawText = el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '';
    if (!rawText) return;

    el.setAttribute('aria-label', rawText);

    // Build accessible markup preserving child nodes / breaks
    // We convert text nodes to word & character spans, while keeping <br> and child elements
    const childNodes = Array.from(el.childNodes);
    const fragment = document.createDocumentFragment();

    let globalCharIndex = 0;

    function processNode(node) {
      if (node.nodeType === 3) { // Text Node
        const text = node.textContent;
        // Split text into words and spaces
        const wordsAndSpaces = text.split(/(\s+)/);

        wordsAndSpaces.forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            // Keep actual space between words
            fragment.appendChild(document.createTextNode(' '));
            return;
          }

          const wordSpan = document.createElement('span');
          wordSpan.className = 'split-word';
          wordSpan.setAttribute('aria-hidden', 'true');

          // Split word into chars
          for (let i = 0; i < part.length; i++) {
            const char = part[i];
            const charSpan = document.createElement('span');
            charSpan.className = 'split-char';
            charSpan.setAttribute('aria-hidden', 'true');
            charSpan.textContent = char;
            charSpan.style.transitionDelay = `${globalCharIndex * cfg.staggerDelay}ms`;
            globalCharIndex++;
            wordSpan.appendChild(charSpan);
          }

          fragment.appendChild(wordSpan);
        });
      } else if (node.nodeName === 'BR') {
        fragment.appendChild(document.createElement('br'));
      } else if (node.nodeType === 1) {
        // Elements with gradient clipping or explicit no-split must remain intact
        // to prevent child inline-block compositing layers from breaking background-clip: text
        const isGradientOrUnsplit = (
          (node.classList && (node.classList.contains('hero-gradient') || node.classList.contains('gradient-text'))) ||
          (node.hasAttribute && node.hasAttribute('data-no-split')) ||
          (node.getAttribute && node.getAttribute('data-no-split'))
        );

        if (isGradientOrUnsplit) {
          const wrapper = node.cloneNode(true);
          wrapper.setAttribute('aria-hidden', 'true');
          fragment.appendChild(wrapper);
          return;
        }

        // Nested element (e.g. <span class="hero-line hero-line-main">)
        const wrapper = node.cloneNode(false);
        const subNodes = Array.from(node.childNodes);
        subNodes.forEach((sub) => {
          if (sub.nodeType === 3) {
            const words = sub.textContent.split(/(\s+)/);
            words.forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) {
                wrapper.appendChild(document.createTextNode(' '));
                return;
              }
              const wordSpan = document.createElement('span');
              wordSpan.className = 'split-word';
              wordSpan.setAttribute('aria-hidden', 'true');
              for (let i = 0; i < part.length; i++) {
                const char = part[i];
                const charSpan = document.createElement('span');
                charSpan.className = 'split-char';
                charSpan.setAttribute('aria-hidden', 'true');
                charSpan.textContent = char;
                charSpan.style.transitionDelay = `${globalCharIndex * cfg.staggerDelay}ms`;
                globalCharIndex++;
                wordSpan.appendChild(charSpan);
              }
              wrapper.appendChild(wordSpan);
            });
          } else {
            wrapper.appendChild(sub.cloneNode(true));
          }
        });
        fragment.appendChild(wrapper);
      }
    }

    childNodes.forEach(processNode);

    el.innerHTML = '';
    el.appendChild(fragment);
    el.dataset.splitInitialized = 'true';
    el.classList.add('split-ready');
    processedElements.push(el);
  });

  // Reveal triggers
  if (prefersReducedMotion()) {
    processedElements.forEach((el) => el.classList.add('split-revealed'));
    return { refresh: () => {}, destroy: () => {} };
  }

  // Fast viewport check for top elements (like hero) to animate immediately
  processedElements.forEach((el) => {
    if (typeof window !== 'undefined' && el.getBoundingClientRect) {
      const rect = el.getBoundingClientRect();
      const inView = rect.top < (window.innerHeight || 800) && rect.bottom > 0;
      if (inView) {
        requestAnimationFrame(() => el.classList.add('split-revealed'));
      }
    }
  });

  let observer = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('split-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: cfg.threshold });

    processedElements.forEach((el) => observer.observe(el));
  } else {
    processedElements.forEach((el) => el.classList.add('split-revealed'));
  }

  // Fallback safety timeout so heading is NEVER stuck in hidden state
  setTimeout(() => {
    processedElements.forEach((el) => el.classList.add('split-revealed'));
  }, 120);

  return {
    destroy: () => {
      if (observer) observer.disconnect();
    },
    refresh: () => {
      processedElements.forEach((el) => el.classList.add('split-revealed'));
    },
  };
}

/**
 * 3. BorderGlow — Pointer-Driven Glowing Card Borders
 *
 * @param {string|HTMLElement|NodeList} target
 * @param {object} options
 */
export function initBorderGlow(target = '.border-glow', options = {}) {
  if (typeof document === 'undefined') return { destroy: () => {} };

  const cfg = {
    glowRadius: options.glowRadius || 240,
    intensity: options.intensity !== undefined ? options.intensity : 0.7,
    ...options,
  };

  // Skip on touch-only devices without hover capability
  const isTouchDevice = typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(hover: none)').matches;

  const elements = typeof target === 'string'
    ? document.querySelectorAll(target)
    : ((typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) || (target && target.nodeType === 1))
    ? [target]
    : target;

  if (!elements || elements.length === 0) return { destroy: () => {} };

  const handlers = [];

  elements.forEach((card) => {
    if (!card || card.dataset.borderGlowInit === 'true') return;

    card.classList.add('border-glow');
    card.style.setProperty('--glow-radius', `${cfg.glowRadius}px`);
    card.dataset.borderGlowInit = 'true';

    if (isTouchDevice) return; // Touch fallback keeps card styled without mouse tracking

    function onPointerMove(e) {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      card.style.setProperty('--glow-x', `${x}px`);
      card.style.setProperty('--glow-y', `${y}px`);
      card.style.setProperty('--glow-opacity', `${cfg.intensity}`);
    }

    function onPointerLeave() {
      card.style.setProperty('--glow-opacity', '0');
    }

    card.addEventListener('pointermove', onPointerMove, { passive: true });
    card.addEventListener('pointerleave', onPointerLeave, { passive: true });

    handlers.push({ card, onPointerMove, onPointerLeave });
  });

  return {
    destroy: () => {
      handlers.forEach(({ card, onPointerMove, onPointerLeave }) => {
        card.removeEventListener('pointermove', onPointerMove);
        card.removeEventListener('pointerleave', onPointerLeave);
        delete card.dataset.borderGlowInit;
      });
      handlers.length = 0;
    },
  };
}
