import { getReportDownloadUrl } from './api.js';

/**
 * Escapes unsafe characters for HTML rendering.
 * @param {*} value - The input value to escape
 * @returns {string} Escaped HTML string
 */
export const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/**
 * Formats an ISO date string into a localized readable date.
 * @param {string|number|null} iso - ISO date or timestamp
 * @returns {string} Localized date string or fallback
 */
export const formatDate = iso => {
  if (!iso) return 'recently';
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? 'recently' : d.toLocaleString();
  } catch {
    return 'recently';
  }
};

/**
 * Renders an array of items as an unordered HTML list with escaped text.
 * @param {Array<string>} items - Items to render
 * @returns {string} HTML `<ul>` markup
 */
export const bullets = items =>
  Array.isArray(items) && items.length
    ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';

/**
 * Safely generates an anchor tag for external job links, ensuring safe protocol.
 * @param {string} url - Link URL
 * @param {string} text - Link anchor text
 * @returns {string} HTML anchor tag or escaped text fallback
 */
export const jobLink = (url, text) => {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return esc(text);
  } catch {
    return esc(text);
  }
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
};

/**
 * Filter state for the skill demand table and chart.
 */
let tableFilterState = {
  searchQuery: '',
  statusFilter: 'all', // 'all' | 'gap' | 'mentioned'
};

/**
 * Filters and sorts skill demand data based on current filter state.
 *
 * @param {Array} skills - Full list of skill demand items
 * @param {string} query - Text search query
 * @param {'all'|'gap'|'mentioned'} statusFilter - Status filter
 * @returns {Array} Filtered skills
 */
export function filterSkillDemand(skills, query = '', statusFilter = 'all') {
  const q = (query || '').trim().toLowerCase();
  return (Array.isArray(skills) ? skills : []).filter(item => {
    const skillName = (item?.skill || '').toLowerCase();
    const matchesQuery = !q || skillName.includes(q);
    const isGap = item?.curriculum_status === 'not found';
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'gap' && isGap) ||
      (statusFilter === 'mentioned' && !isGap);

    return matchesQuery && matchesStatus;
  });
}

/**
 * Renders the interactive skill demand chart.
 *
 * @param {Array} skillDemand - List of skill demand items
 * @param {number} totalJobs - Denominator usable jobs count
 * @param {string} currentFilter - 'all' | 'gap' | 'mentioned'
 * @returns {string} HTML markup for the chart
 */
export function renderSkillDemandChart(skillDemand, totalJobs, currentFilter = 'all') {
  const filtered = filterSkillDemand(skillDemand, '', currentFilter);
  const displayItems = filtered.slice(0, 12); // Display top 12 items

  if (!displayItems.length) {
    return `
      <div class="empty-state-box">
        <p>No skills to display in this chart view.</p>
      </div>
    `;
  }

  const maxShare = Math.max(...displayItems.map(d => Number(d?.share_percent) || 0), 10);

  return `
    <div class="chart-bars" role="region" aria-label="Skill demand comparison chart">
      ${displayItems
        .map(d => {
          const isCovered = d.curriculum_status === 'mentioned';
          const fillClass = isCovered ? 'fill-covered' : 'fill-gap';
          const share = Number(d.share_percent) || 0;
          const widthPct = share > 0 ? Math.min(100, Math.max(4, (share / maxShare) * 100)) : 0;
          const jobCount = Number(d.job_count) || 0;

          return `
          <div class="chart-bar-item" data-skill="${esc(d.skill)}" tabindex="0" role="button" aria-label="${esc(d.skill)}: ${share}% demand, ${isCovered ? 'mentioned in syllabus' : 'possible gap'}">
            <div class="chart-bar-label" title="${esc(d.skill)}">
              <span>${esc(d.skill)}</span>
            </div>
            <div class="chart-track">
              <div class="chart-fill ${fillClass}" style="width: ${widthPct}%;" role="progressbar" aria-valuenow="${share}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(d.skill)}: ${share}%">
                ${share >= 12 ? `${share}%` : ''}
              </div>
            </div>
            <div class="chart-value">
              <strong>${share}%</strong> <small>(${jobCount} ${jobCount === 1 ? 'job' : 'jobs'})</small>
            </div>
          </div>
          `;
        })
        .join('')}
    </div>
    ${
      filtered.length > 12
        ? `<div class="chart-footer-note">Showing top 12 of ${filtered.length} in-demand skills in chart. Use the table below for the complete searchable list.</div>`
        : ''
    }
  `;
}

/**
 * Renders the skill demand table rows based on current filtered items.
 *
 * @param {Array} items - Filtered skill demand items
 * @param {number} totalJobs - Total analyzed jobs count
 * @returns {string} Table body HTML
 */
function renderSkillTableRows(items, totalJobs) {
  if (!items.length) {
    return `
      <tr>
        <td colspan="4" style="text-align: center; padding: 28px 12px;">
          <div class="empty-state-box" style="margin: 0; border: 0;">
            <p>No skills match your current search and filter criteria.</p>
            <button id="clear-skill-search" class="primary-button secondary-button" style="display: inline-flex; width: auto; margin-top: 8px;">Reset filters</button>
          </div>
        </td>
      </tr>
    `;
  }

  return items
    .map(d => {
      const isCovered = d.curriculum_status === 'mentioned';
      const statusBadge = isCovered
        ? `<span class="status-badge badge-covered">✓ Mentioned in syllabus</span>`
        : `<span class="status-badge badge-gap">⚠ Possible gap (not in text)</span>`;

      const evidenceCount = d.evidence?.length || 0;
      const evidenceHtml = evidenceCount
        ? `
          <details style="padding: 2px 0; border: 0;">
            <summary class="evidence-toggle">${evidenceCount} posting ${evidenceCount === 1 ? 'quote' : 'quotes'} ▾</summary>
            ${d.evidence
              .map(
                e => `
              <div class="evidence-row-content">
                <blockquote>${esc(e.excerpt)}</blockquote>
                ${jobLink(e.url, 'View job posting')}
              </div>
            `
              )
              .join('')}
          </details>
        `
        : `<small style="color: #929c87;">No excerpt</small>`;

      const jobCount = Number(d.job_count) || 0;
      const share = Number(d.share_percent) || 0;

      return `
        <tr data-skill-name="${esc(d.skill)}">
          <td style="word-break: break-word;">
            <strong>${esc(d.skill)}</strong>
          </td>
          <td>
            <strong>${jobCount} / ${totalJobs}</strong>
            <small style="color: #798570; display: inline-block; margin-left: 6px;">(${share}%)</small>
          </td>
          <td>${statusBadge}</td>
          <td>${evidenceHtml}</td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Renders the analysis report into the target container element and wires PDF download handlers.
 *
 * @param {object} r - Full analysis report data returned from backend
 * @param {string} apiBase - Resolved backend server base URL
 * @param {HTMLElement} section - Container element (e.g. `#results`)
 */
export function renderReport(r, apiBase, section) {
  if (!section || !r) return;

  const stats = r.summary || {};
  const totalJobs = Number(stats.analyzed_jobs) || 0;
  const detectedSkills = Number(stats.detected_curriculum_skills) || 0;
  const missingSkills = Number(stats.missing_skills) || 0;
  const mentionAlignment =
    stats.mention_alignment_percent !== null && stats.mention_alignment_percent !== undefined
      ? Number(stats.mention_alignment_percent)
      : null;

  const market = r.market || {};
  const curriculum = r.curriculum || {};
  const gaps = Array.isArray(r.gaps) ? r.gaps : [];
  const skillDemand = Array.isArray(r.skill_demand) ? r.skill_demand : [];
  const labPatches = Array.isArray(r.lab_patches) ? r.lab_patches : [];
  const jobs = Array.isArray(r.jobs) ? r.jobs : [];
  const warnings = Array.isArray(r.warnings) ? r.warnings : [];
  const limitations = Array.isArray(r.limitations) ? r.limitations : [];

  // Reset filter state for new report
  tableFilterState = { searchQuery: '', statusFilter: 'all' };

  const gapsCount = gaps.length;
  const mentionedCount = skillDemand.filter(s => s.curriculum_status === 'mentioned').length;
  const totalSkills = skillDemand.length;

  const formattedCollectedAt = formatDate(market.collected_at || r.generated_at);

  section.innerHTML = `
  <span class="tag">INTERNATIONAL · LIVE JOB SAMPLE${market.cached ? ' · CACHED' : ''}</span>
  <h2>Your curriculum, compared with hiring demand.</h2>
  <p>${esc(r.filename || 'Curriculum')} · ${esc(r.role || 'Role')} · ${esc(market.location_query || 'International sample')}<br>
  Collected ${esc(formattedCollectedAt)} · ${curriculum.page_count || 1} PDF pages</p>

  <div class="report-downloads" aria-label="Download analysis reports">
    <button id="download-report" class="primary-button" ${!r.report_id ? 'disabled' : ''}>Download full report (PDF) <span>↓</span></button>
    <button id="download-summary" class="primary-button secondary-button" ${!r.report_id ? 'disabled' : ''}>Download Executive Summary (PDF) <span>↓</span></button>
  </div>
  <p class="download-note">Full report: all evidence and lab details. Executive Summary: a two-page overview of findings and next steps.</p>
  <p class="download-note">Downloads are available for 30 minutes, until the server restarts, or until newer reports replace them.</p>

  <div class="result-grid">
    <article class="result-card">
      <h3>${totalJobs} usable jobs</h3>
      <p>${market.fetched_count || 0} fetched before relevance, seniority, date and duplicate filtering.</p>
    </article>
    <article class="result-card">
      <h3>${mentionAlignment === null ? 'Insufficient evidence' : mentionAlignment + '% mention coverage'}</h3>
      <p>Demand-weighted syllabus mentions. This is not a student readiness score.</p>
    </article>
    <article class="result-card">
      <h3>${missingSkills} possible gaps</h3>
      <p>${detectedSkills} catalog skills mentioned in the PDF. Missing mentions need faculty confirmation.</p>
    </article>
  </div>

  ${!totalJobs ? '<p class="report-warning">No usable live postings were returned. No demand score or market-backed recommendations can be produced. Retry later to collect a fresh sample.</p>' : ''}
  ${totalJobs > 0 && totalJobs < 15 ? '<p class="report-warning" style="background:#fffbe6; border-left: 4px solid #e2b93b;">⚠ Fewer than 15 usable postings were collected: interpret percentages and gap priorities cautiously.</p>' : ''}

  <!-- Coverage & Status Nuance Explainer -->
  <div class="coverage-explainer">
    <strong>Understanding curriculum coverage and skill statuses:</strong><br>
    • <strong>Mention coverage (${mentionAlignment !== null ? mentionAlignment + '%' : 'N/A'})</strong> measures the demand-weighted proportion of in-demand catalog skills explicitly identified in your syllabus PDF text.<br>
    • <span class="status-badge badge-covered" style="font-size:9px;">Mentioned in syllabus</span>: Explicitly matched in the extracted PDF text.<br>
    • <span class="status-badge badge-gap" style="font-size:9px;">Possible gap (not in text)</span>: High-demand industry skill not detected in the searchable text. This highlights topics for faculty review—it is <em>never</em> proof that a topic is not taught or that theoretical foundations are absent.
  </div>

  <!-- Interactive Skill Demand Visualization -->
  <div class="chart-card">
    <div class="chart-header">
      <h4>Market skill demand in this sample (${totalSkills} detected skills)</h4>
      <div class="chart-filters" id="chart-filter-controls">
        <button class="chart-filter-btn active" data-chart-filter="all">All in-demand skills</button>
        <button class="chart-filter-btn" data-chart-filter="gap">Possible gaps (${gapsCount})</button>
        <button class="chart-filter-btn" data-chart-filter="mentioned">Covered in syllabus (${mentionedCount})</button>
      </div>
    </div>
    <div id="chart-content">
      ${renderSkillDemandChart(skillDemand, totalJobs, 'all')}
    </div>
  </div>

  <!-- Searchable & Filterable Skill Demand Table -->
  <h3>Search and filter in-demand skills</h3>
  <div class="table-toolbar">
    <div class="search-box">
      <input type="search" id="skill-search-input" placeholder="Search skills (e.g. Docker, SQL, Python)..." aria-label="Search skills by name">
    </div>
    <div class="chart-filters" id="table-filter-controls">
      <button class="filter-btn active" data-table-filter="all">All (${totalSkills})</button>
      <button class="filter-btn" data-table-filter="gap">Gaps only (${gapsCount})</button>
      <button class="filter-btn" data-table-filter="mentioned">Mentioned (${mentionedCount})</button>
    </div>
    <div class="table-meta">
      <span class="table-count-badge" id="skill-table-count">Showing ${totalSkills} of ${totalSkills} skills</span>
    </div>
  </div>

  <div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Skill</th>
          <th>Market demand (Jobs & share)</th>
          <th>Syllabus mention status</th>
          <th>Job-posting evidence</th>
        </tr>
      </thead>
      <tbody id="skill-table-body">
        ${renderSkillTableRows(skillDemand, totalJobs)}
      </tbody>
    </table>
  </div>

  <h3>Prioritized gaps (${gapsCount})</h3>
  ${
    gaps.length
      ? gaps
          .map(
            g => `
    <details>
      <summary>
        <strong>${esc(g.skill)}</strong> · 
        <span class="badge-priority priority-${esc(g.priority)}">${esc(g.priority || 'Exploratory')} priority</span> · 
        ${esc(g.category || 'General')} · 
        <strong>${g.share_percent || 0}%</strong> of sample
      </summary>
      <p>${esc(g.interpretation || 'Not found in extracted text; this does not prove the skill is not taught.')}</p>
      <p>${
        g.syllabus_anchor
          ? `Related foundation on p.${g.syllabus_anchor.page}: <em>${esc(g.syllabus_anchor.excerpt)}</em>`
          : 'No related foundation detected in syllabus. Assess prerequisites before introducing this topic.'
      }</p>
      ${
        g.course_outcome
          ? `<p>Possible Course Outcome link (faculty review required): <strong>${esc(g.course_outcome.id)}</strong> — ${esc(g.course_outcome.statement)}</p>`
          : '<p>No explicit outcome mapping found in CO lines.</p>'
      }
      <div style="margin-top: 10px;">
        <strong>Supporting market excerpts (${g.evidence?.length || 0}):</strong>
        ${(g.evidence || []).map(e => `<blockquote>${esc(e.excerpt)}<br>${jobLink(e.url, 'View supporting job posting')}</blockquote>`).join('')}
      </div>
    </details>`
          )
          .join('')
      : '<p class="report-warning" style="background:#f4f7ed;">No market-backed missing skills identified. All detected in-demand skills have mentions in the syllabus.</p>'
  }

  <h3>Optional weekly lab extensions (${labPatches.length})</h3>
  <p>Keep the original theory and outcomes. These 40-minute task outlines require faculty review and prepared starter environments.</p>
  <div class="result-grid">
    ${labPatches
      .map(
        l => `
      <article class="result-card">
        <span>40 MINUTES · FACULTY REVIEW</span>
        <h3>${esc(l.title)}</h3>
        <p>Related syllabus topic: p.${l.page || '?'}${l.course_outcome ? ' · ' + esc(l.course_outcome.id) : ''}</p>
        <p>${esc(l.prerequisites)}</p>
        ${bullets(l.tasks || [])}
        <h4>Suggested rubric</h4>
        ${bullets(Object.entries(l.rubric || {}).map(([k, v]) => `${k}: ${v}%`))}
        <h4>Verification checklist</h4>
        ${bullets(l.verification_checklist || [])}
        <p>${esc(l.faculty_notes)}</p>
      </article>`
      )
      .join('')}
  </div>

  <h3>Foundations to preserve</h3>
  <p>${esc(curriculum.concepts?.join(', ') || 'No catalog foundation matched. Faculty review is needed.')}</p>

  <details>
    <summary>Curriculum evidence and original course outcomes (${curriculum.skills?.length || 0} skills detected in PDF)</summary>
    ${(curriculum.skills || []).map(s => `<p><strong>${esc(s.skill)}</strong> · p.${s.page}<br><em>${esc(s.excerpt)}</em></p>`).join('')}
    ${(curriculum.course_outcomes || []).map(co => `<p><strong>${esc(co.id)}</strong> · p.${co.page}: ${esc(co.statement)}</p>`).join('') || '<p>No explicit CO-numbered outcome lines detected.</p>'}
  </details>

  ${
    curriculum.legacy_mentions?.length
      ? `
    <details>
      <summary>Legacy tooling mentions to review (${curriculum.legacy_mentions.length})</summary>
      ${curriculum.legacy_mentions.map(x => `<p><strong>${esc(x.tool)}</strong> · p.${x.page}: <em>${esc(x.excerpt)}</em><br>${esc(x.rationale)}</p>`).join('')}
    </details>`
      : ''
  }

  <h3>Data quality and source coverage</h3>
  ${bullets((market.sources || []).map(s => `${esc(s?.source || 'Source')}: ${esc(s?.status || 'done')} (${Number(s?.fetched) || 0} postings fetched)`))}
  <p>Excluded from analysis: ${
    Object.keys(market.excluded || {}).length
      ? esc(Object.entries(market.excluded).map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`).join(' · '))
      : 'None'
  }</p>
  ${bullets(warnings)}

  <details>
    <summary>Job evidence (${jobs.length} usable postings)</summary>
    ${
      jobs.length
        ? jobs.map(j => `<p>${jobLink(j.url, j.title)} · ${esc(j.company)} · ${esc(j.site)}<br>${esc(j.location)} · Posted: ${esc(j.date_posted || 'unknown')}</p>`).join('')
        : '<p style="color:#7b8672; font-size:12px;">No individual job postings available in this sample.</p>'
    }
  </details>

  <details>
    <summary>How this report is calculated and its limits</summary>
    <p>${esc(r.methodology || '')}</p>
    ${bullets(limitations)}
  </details>
  `;

  // Attach download handlers for both PDF buttons
  const downloads = [
    { id: 'download-report', version: 'full', filename: 'delta-analysis.pdf' },
    { id: 'download-summary', version: 'summary', filename: 'delta-executive-summary.pdf' },
  ];

  for (const { id, version, filename } of downloads) {
    const btn = section.querySelector(`#${id}`);
    if (btn && r.report_id) {
      btn.onclick = () => {
        try {
          const downloadUrl = getReportDownloadUrl(apiBase, r.report_id, version);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch (err) {
          console.error('Failed to trigger download', err);
          const note = section.querySelector('.download-note');
          if (note) {
            note.textContent = 'Could not generate download link. Please verify the backend connection and retry.';
            note.style.color = '#a44835';
          }
        }
      };
    }
  }

  // Bind Chart Filter Controls and interactive bar clicks
  const chartControls = section.querySelectorAll('#chart-filter-controls button');
  const chartContent = section.querySelector('#chart-content');

  function bindChartBarInteractions() {
    if (!chartContent) return;
    chartContent.querySelectorAll('.chart-bar-item').forEach(bar => {
      bar.style.cursor = 'pointer';
      const selectSkill = () => {
        const skillName = bar.dataset.skill;
        if (!skillName) return;
        if (searchInput) {
          searchInput.value = skillName;
        }
        tableFilterState.searchQuery = skillName;
        tableFilterState.statusFilter = 'all';
        tableFilterBtns.forEach(b => b.classList.toggle('active', b.dataset.tableFilter === 'all'));
        updateTable();

        const targetRow = Array.from(section.querySelectorAll('#skill-table-body tr')).find(
          tr => tr.getAttribute('data-skill-name') === skillName
        );
        if (targetRow) {
          targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetRow.classList.add('row-highlight');
          setTimeout(() => targetRow.classList.remove('row-highlight'), 2000);
        }
      };
      bar.addEventListener('click', selectSkill);
      bar.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectSkill();
        }
      });
    });
  }

  chartControls.forEach(btn => {
    btn.addEventListener('click', () => {
      chartControls.forEach(b => b.classList.toggle('active', b === btn));
      const filter = btn.dataset.chartFilter;
      if (chartContent) {
        chartContent.innerHTML = renderSkillDemandChart(skillDemand, totalJobs, filter);
        bindChartBarInteractions();
      }
    });
  });

  bindChartBarInteractions();

  // Bind Table Search & Filter Controls
  const searchInput = section.querySelector('#skill-search-input');
  const tableFilterBtns = section.querySelectorAll('#table-filter-controls button');
  const tableBody = section.querySelector('#skill-table-body');
  const countBadge = section.querySelector('#skill-table-count');

  function updateTable() {
    const filtered = filterSkillDemand(
      skillDemand,
      tableFilterState.searchQuery,
      tableFilterState.statusFilter
    );
    if (tableBody) {
      tableBody.innerHTML = renderSkillTableRows(filtered, totalJobs);
      // Bind reset button if empty state is showing
      const resetBtn = tableBody.querySelector('#clear-skill-search');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          tableFilterState = { searchQuery: '', statusFilter: 'all' };
          if (searchInput) searchInput.value = '';
          tableFilterBtns.forEach(b => b.classList.toggle('active', b.dataset.tableFilter === 'all'));
          updateTable();
        });
      }
    }
    if (countBadge) {
      countBadge.textContent = `Showing ${filtered.length} of ${totalSkills} skills`;
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', e => {
      tableFilterState.searchQuery = e.target.value;
      updateTable();
    });
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        tableFilterState.searchQuery = '';
        updateTable();
      }
    });
  }

  tableFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tableFilterBtns.forEach(b => b.classList.toggle('active', b === btn));
      tableFilterState.statusFilter = btn.dataset.tableFilter;
      updateTable();
    });
  });

  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Renders the Learning Roadmap view based on analyzed curriculum report data.
 *
 * @param {object|null} report - Current analysis report (or null if unanalyzed)
 * @param {HTMLElement} container - Target section container (`#roadmap-view`)
 * @param {Function} [onGoToUpload] - Callback to switch back to upload view
 */
export function renderRoadmapView(report, container, onGoToUpload) {
  if (!container) return;

  const labs = Array.isArray(report?.lab_patches) ? report.lab_patches : [];

  if (!report) {
    container.innerHTML = `
      <span class="tag">LEARNING ROADMAP</span>
      <h2>Your practical learning roadmap.</h2>
      <div class="empty-state-box">
        <p style="font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 8px;">No curriculum analyzed yet</p>
        <p>Upload a course outline or syllabus PDF on the Overview tab to generate sequenced 40-minute lab outlines anchored to your detected syllabus foundations and live industry demand.</p>
        <button class="primary-button" id="roadmap-go-upload" style="max-width: 240px; margin: 16px auto 0;">Go to Upload <span>↗</span></button>
      </div>
    `;
    const btn = container.querySelector ? container.querySelector('#roadmap-go-upload') : null;
    if (btn && onGoToUpload) {
      btn.onclick = onGoToUpload;
    }
    container.hidden = false;
    container.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (!labs.length) {
    container.innerHTML = `
      <span class="tag">LEARNING ROADMAP</span>
      <h2>Your practical learning roadmap.</h2>
      <div class="empty-state-box">
        <p style="font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 8px;">No supplemental lab patches required</p>
        <p>All in-demand skills in this market sample were detected in your syllabus text. Your course outcomes already cover the top requirements for this role.</p>
        <button class="primary-button" id="roadmap-go-overview" style="max-width: 260px; margin: 16px auto 0;">View Full Analysis in Overview <span>↗</span></button>
      </div>
    `;
    const btn = container.querySelector ? container.querySelector('#roadmap-go-overview') : null;
    if (btn && onGoToUpload) {
      btn.onclick = onGoToUpload;
    }
    container.hidden = false;
    container.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const concepts = report.curriculum?.concepts?.join(', ') || 'course foundations';

  container.innerHTML = `
    <div class="roadmap-hero">
      <span class="tag">LEARNING ROADMAP · SEQUENCED 40-MINUTE LAB EXTENSIONS</span>
      <h2>From syllabus theory to modern practice.</h2>
      <p>Target role: <strong>${esc(report.role || 'General')}</strong> · Preserving ${esc(concepts)} from <em>${esc(report.filename || 'syllabus')}</em></p>
    </div>

    <!-- Transparent Pedagogical Labeling -->
    <div class="roadmap-notice" role="note">
      <div class="notice-icon">📋</div>
      <div>
        <strong>Deterministic Curriculum Extensions (Delta Catalog)</strong>
        <p>These modular 40-minute lab patches build on your course outcomes without replacing foundational theory. They are deterministic, rule-based recommendations—<strong>not AI-generated</strong>—and require faculty confirmation and instructor-prepared environments before classroom assignment.</p>
      </div>
    </div>

    <div class="roadmap-steps">
      ${labs
        .map((l, index) => {
          const stepNum = String(index + 1).padStart(2, '0');
          const outcomeText = l.course_outcome
            ? `<div style="margin: 8px 0; color: #43533c; font-size: 11px;">
                <strong>Linked Course Outcome:</strong> ${esc(l.course_outcome.id)}: <em>${esc(l.course_outcome.statement)}</em>
               </div>`
            : '';

          return `
          <article class="roadmap-step-card">
            <div class="step-header">
              <span class="step-num">STEP ${stepNum} · 40 MINUTES</span>
              <span class="status-badge badge-gap">Extends ${esc(l.foundation || 'foundation')} (p.${l.page || '?'})</span>
            </div>
            <h3 class="step-title">${esc(l.title)}</h3>
            <p class="step-meta"><strong>Prerequisites:</strong> ${esc(l.prerequisites || 'Basic coursework prerequisites')}</p>
            ${outcomeText}

            <h4 style="margin: 14px 0 6px; font-size: 12px; color: var(--green);">Lab Tasks</h4>
            ${bullets(l.tasks || [])}

            <h4 style="margin: 14px 0 6px; font-size: 12px; color: var(--green);">Suggested Rubric</h4>
            <div class="rubric-breakdown">
              ${Object.entries(l.rubric || {})
                .map(([k, v]) => `<span class="rubric-pill"><strong>${esc(k)}</strong>: ${v}%</span>`)
                .join('')}
            </div>

            <h4 style="margin: 14px 0 6px; font-size: 12px; color: var(--green);">Verification Checklist</h4>
            ${bullets(l.verification_checklist || [])}

            <div style="margin-top: 12px; padding: 10px 14px; background: #fbfcf8; border-left: 3px solid #bac9a6; font-size: 11px; line-height: 1.6; color: #626e57;">
              <strong>Faculty Note:</strong> ${esc(l.faculty_notes || 'Verify prerequisites and prepare environments before assigning.')}
            </div>
          </article>
          `;
        })
        .join('')}
    </div>
  `;

  container.hidden = false;
  container.scrollIntoView({ behavior: 'smooth' });
}
