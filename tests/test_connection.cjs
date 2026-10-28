const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let resolveAnalysisServer, analyzeCurriculum, getReportDownloadUrl;
let CONFIG;
let validatePdfFile;
let esc, bullets, jobLink, filterSkillDemand, renderSkillDemandChart, renderRoadmapView;

before(async () => {
  const apiModule = await import('../js/api.js');
  const configModule = await import('../js/config.js');
  const uploadModule = await import('../js/upload.js');
  const renderModule = await import('../js/render.js');

  resolveAnalysisServer = apiModule.resolveAnalysisServer;
  analyzeCurriculum = apiModule.analyzeCurriculum;
  getReportDownloadUrl = apiModule.getReportDownloadUrl;
  CONFIG = configModule.CONFIG;
  validatePdfFile = uploadModule.validatePdfFile;
  esc = renderModule.esc;
  bullets = renderModule.bullets;
  jobLink = renderModule.jobLink;
  filterSkillDemand = renderModule.filterSkillDemand;
  renderSkillDemandChart = renderModule.renderSkillDemandChart;
  renderRoadmapView = renderModule.renderRoadmapView;
});

const healthy = () => ({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => ({ status: 'ok', service: 'bridgelabs', market: 'JobSpy / International' }),
});

function setup(fetch, origin = 'http://127.0.0.1:5500', extraOptions = {}) {
  const url = new URL(origin);
  return signal =>
    resolveAnalysisServer(signal, {
      window: { location: url },
      fetch,
      ...extraOptions,
    });
}

test('static preview discovers backend without uploading to static server', async () => {
  const urls = [];
  const resolve = setup(async url => {
    urls.push(url);
    return url.startsWith('http://127.0.0.1:5500') ? { ok: false, status: 404 } : healthy();
  });
  assert.equal(await resolve(new AbortController().signal), 'http://127.0.0.1:8000');
  assert.deepEqual(urls, ['http://127.0.0.1:5500/api/health', 'http://127.0.0.1:8000/api/health']);
});

test('backend-hosted frontend uses its own origin', async () => {
  const urls = [];
  const resolve = setup(async url => {
    urls.push(url);
    return healthy();
  }, 'http://127.0.0.1:8000');
  assert.equal(await resolve(new AbortController().signal), 'http://127.0.0.1:8000');
  assert.equal(urls.length, 1);
});

test('HTML responses produce actionable connection error', async () => {
  const resolve = setup(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) }));
  await assert.rejects(resolve(new AbortController().signal), /Cannot reach Delta analysis/);
});

test('hosted websites never automatically send data to loopback backend', async () => {
  const urls = [];
  const resolve = setup(async url => {
    urls.push(url);
    return { ok: false };
  }, 'https://example.org');
  await assert.rejects(resolve(new AbortController().signal), /temporarily unavailable/);
  assert.deepEqual(urls, ['https://example.org/api/health']);
});

test('supports configurable local development URL without hardcoding in caller', async () => {
  const urls = [];
  const customBackend = 'http://127.0.0.1:9000';
  const resolve = setup(
    async url => {
      urls.push(url);
      return url.startsWith('http://127.0.0.1:5500') ? { ok: false, status: 404 } : healthy();
    },
    'http://127.0.0.1:5500',
    { defaultBackendUrl: customBackend }
  );
  assert.equal(await resolve(new AbortController().signal), customBackend);
  assert.deepEqual(urls, ['http://127.0.0.1:5500/api/health', 'http://127.0.0.1:9000/api/health']);
});

test('PDF validation correctly enforces format, max size (10 MB), and non-empty content', () => {
  assert.deepEqual(validatePdfFile(null), { valid: false, error: null });
  assert.equal(validatePdfFile({ name: 'file.txt', size: 100, type: 'text/plain' }).error, CONFIG.MESSAGES.FILE_NOT_PDF);
  assert.equal(validatePdfFile({ name: 'huge.pdf', size: 10 * 1024 * 1024 + 1, type: 'application/pdf' }).error, CONFIG.MESSAGES.FILE_TOO_LARGE);
  assert.equal(validatePdfFile({ name: 'empty.pdf', size: 0, type: 'application/pdf' }).error, CONFIG.MESSAGES.FILE_EMPTY);
  assert.deepEqual(validatePdfFile({ name: 'valid.pdf', size: 1024, type: 'application/pdf' }), { valid: true, error: null });
});

test('safe HTML escaping sanitizes special characters and unsafe job link protocols', () => {
  assert.equal(esc('<script>alert("xss")&\'test\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;test&#39;&lt;/script&gt;');
  assert.equal(bullets(['item 1', '<item 2>']), '<ul><li>item 1</li><li>&lt;item 2&gt;</li></ul>');
  assert.equal(jobLink('javascript:alert(1)', 'Click me'), 'Click me');
  assert.equal(jobLink('https://example.com/job', 'View job'), '<a href="https://example.com/job" target="_blank" rel="noopener noreferrer">View job ↗</a>');
});

test('report download URLs are properly constructed for full and summary versions', () => {
  const fullUrl = getReportDownloadUrl('http://127.0.0.1:8000', 'report-123', 'full');
  assert.equal(fullUrl, 'http://127.0.0.1:8000/api/reports/report-123.pdf?version=full');

  const summaryUrl = getReportDownloadUrl('http://127.0.0.1:8000', 'report-123', 'summary');
  assert.equal(summaryUrl, 'http://127.0.0.1:8000/api/reports/report-123.pdf?version=summary');
});

// Sample fixture matching backend report schema
const sampleSkillDemand = [
  { skill: 'Python', job_count: 8, share_percent: 80.0, curriculum_status: 'mentioned', evidence: [{ url: 'https://example.com/1', excerpt: 'Python needed' }] },
  { skill: 'Docker', job_count: 6, share_percent: 60.0, curriculum_status: 'not found', evidence: [{ url: 'https://example.com/2', excerpt: 'Docker containerization' }] },
  { skill: 'SQL', job_count: 5, share_percent: 50.0, curriculum_status: 'mentioned', evidence: [] },
  { skill: 'Kubernetes', job_count: 3, share_percent: 30.0, curriculum_status: 'not found', evidence: [] },
];

test('filterSkillDemand filters by search query and curriculum status', () => {
  // Query only
  const pyMatches = filterSkillDemand(sampleSkillDemand, 'py', 'all');
  assert.equal(pyMatches.length, 1);
  assert.equal(pyMatches[0].skill, 'Python');

  // Gaps filter
  const gaps = filterSkillDemand(sampleSkillDemand, '', 'gap');
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps.map(g => g.skill), ['Docker', 'Kubernetes']);

  // Mentioned filter
  const mentioned = filterSkillDemand(sampleSkillDemand, '', 'mentioned');
  assert.equal(mentioned.length, 2);
  assert.deepEqual(mentioned.map(m => m.skill), ['Python', 'SQL']);

  // Combined search + status filter
  const combined = filterSkillDemand(sampleSkillDemand, 'dock', 'gap');
  assert.equal(combined.length, 1);
  assert.equal(combined[0].skill, 'Docker');

  // Unmatched query
  const empty = filterSkillDemand(sampleSkillDemand, 'nonexistent', 'all');
  assert.equal(empty.length, 0);
});

test('renderSkillDemandChart maps real values, status classes, and handles empty datasets', () => {
  const chartHtml = renderSkillDemandChart(sampleSkillDemand, 10, 'all');
  assert.match(chartHtml, /Python/);
  assert.match(chartHtml, /80%/);
  assert.match(chartHtml, /fill-covered/);
  assert.match(chartHtml, /Docker/);
  assert.match(chartHtml, /fill-gap/);

  // Empty state handling
  const emptyChart = renderSkillDemandChart([], 10, 'all');
  assert.match(emptyChart, /No skills to display/);
});

test('renderRoadmapView gracefully renders empty state or structured lab outlines', () => {
  const dummyContainer = { innerHTML: '', hidden: true, scrollIntoView: () => {}, querySelector: () => null };

  // Empty report test
  renderRoadmapView(null, dummyContainer);
  assert.equal(dummyContainer.hidden, false);
  assert.match(dummyContainer.innerHTML, /No curriculum analyzed yet/);

  // Valid report with lab patches
  const mockReport = {
    role: 'Backend developer',
    filename: 'syllabus.pdf',
    curriculum: { concepts: ['database', 'programming'] },
    lab_patches: [
      {
        skill: 'Docker',
        title: 'Docker: extend your existing operating system lab',
        duration_minutes: 40,
        foundation: 'operating system',
        page: 3,
        course_outcome: { id: 'CO2', statement: 'Understand process isolation' },
        prerequisites: 'Existing shell assignment',
        tasks: ['Build Dockerfile', 'Run container', 'Record results'],
        rubric: { 'Correctness': 40, 'Repeatability': 40, 'Documentation': 20 },
        verification_checklist: ['Container starts', 'Port responds', 'README updated'],
        faculty_notes: 'Prepare base image in advance',
      },
    ],
  };

  renderRoadmapView(mockReport, dummyContainer);
  assert.equal(dummyContainer.hidden, false);
  assert.match(dummyContainer.innerHTML, /STEP 01/);
  assert.match(dummyContainer.innerHTML, /Docker: extend your existing operating system lab/);
  assert.match(dummyContainer.innerHTML, /CO2/);
  assert.match(dummyContainer.innerHTML, /not AI-generated/i);
});

test('error and timeout messages map correctly to user-facing strings', () => {
  assert.match(CONFIG.MESSAGES.TIMEOUT, /Analysis timed out/);
  assert.match(CONFIG.MESSAGES.NETWORK_INTERRUPTED, /connection to the analysis service was interrupted/);
  assert.equal(CONFIG.MESSAGES.UNEXPECTED_RESPONSE(502), 'The analysis server returned an unexpected response (HTTP 502). Check the backend terminal and retry.');
});

test('PDF validation accepts application/x-pdf, uppercase .PDF, and empty MIME type', () => {
  assert.deepEqual(validatePdfFile({ name: 'CURRICULUM.PDF', size: 2048, type: 'application/pdf' }), { valid: true, error: null });
  assert.deepEqual(validatePdfFile({ name: 'syllabus.pdf', size: 2048, type: 'application/x-pdf' }), { valid: true, error: null });
  assert.deepEqual(validatePdfFile({ name: 'outline.pdf', size: 2048, type: '' }), { valid: true, error: null });
});

test('getReportDownloadUrl requires base URL and report ID', () => {
  assert.throws(() => getReportDownloadUrl('', 'rep-1'), /Backend base URL and report ID are required/);
  assert.throws(() => getReportDownloadUrl('http://127.0.0.1:8000', ''), /Backend base URL and report ID are required/);
});

test('filterSkillDemand gracefully handles items with missing or undefined properties', () => {
  const edgeCaseSkills = [
    { skill: 'Git', curriculum_status: 'mentioned' },
    { skill: null, curriculum_status: 'not found' },
    {},
  ];
  const results = filterSkillDemand(edgeCaseSkills, 'git', 'all');
  assert.equal(results.length, 1);
  assert.equal(results[0].skill, 'Git');
});

test('renderReport renders defensively with minimal/empty report data without crashing', async () => {
  const { renderReport } = await import('../js/render.js');
  const dummySection = {
    innerHTML: '',
    hidden: true,
    scrollIntoView: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const minimalReport = {
    filename: 'minimal.pdf',
    role: 'backend',
    summary: {},
    market: {},
    curriculum: {},
    skill_demand: [],
    gaps: [],
    lab_patches: [],
    jobs: [],
    warnings: [],
  };

  assert.doesNotThrow(() => {
    renderReport(minimalReport, 'http://127.0.0.1:8000', dummySection);
  });
  assert.equal(dummySection.hidden, false);
  assert.match(dummySection.innerHTML, /minimal\.pdf/);
});

test('renderReport handles skills with special characters (C++, Node.js, CI/CD) and assigns data-skill-name', async () => {
  const { renderReport } = await import('../js/render.js');
  const dummySection = {
    innerHTML: '',
    hidden: true,
    scrollIntoView: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const reportWithSpecialSkills = {
    filename: 'special.pdf',
    role: 'fullstack',
    summary: { analyzed_jobs: 10, detected_curriculum_skills: 3, missing_skills: 0 },
    market: { sources: [{ source: 'LinkedIn', status: 'done', fetched: 10 }] },
    curriculum: { concepts: ['OOP', 'Web'] },
    skill_demand: [
      { skill: 'C++', job_count: 5, share_percent: 50.0, curriculum_status: 'mentioned', evidence: [] },
      { skill: 'Node.js', job_count: 6, share_percent: 60.0, curriculum_status: 'mentioned', evidence: [] },
      { skill: 'CI/CD', job_count: 4, share_percent: 40.0, curriculum_status: 'not found', evidence: [] },
    ],
    gaps: [],
    lab_patches: [],
    jobs: [],
    warnings: [],
  };

  assert.doesNotThrow(() => {
    renderReport(reportWithSpecialSkills, 'http://127.0.0.1:8000', dummySection);
  });
  assert.match(dummySection.innerHTML, /data-skill-name="C\+\+"/);
  assert.match(dummySection.innerHTML, /data-skill-name="Node\.js"/);
  assert.match(dummySection.innerHTML, /data-skill-name="CI\/CD"/);
});

test('renderRoadmapView shows dedicated message when curriculum has 0 gaps', () => {
  const dummyContainer = { innerHTML: '', hidden: true, scrollIntoView: () => {}, querySelector: () => null };
  const mockReportNoGaps = {
    role: 'Backend developer',
    filename: 'complete.pdf',
    lab_patches: [],
  };

  renderRoadmapView(mockReportNoGaps, dummyContainer);
  assert.equal(dummyContainer.hidden, false);
  assert.match(dummyContainer.innerHTML, /No supplemental lab patches required/);
});

test('renderReport handles report with null or empty market details cleanly without displaying undefined', async () => {
  const { renderReport } = await import('../js/render.js');
  const dummySection = {
    innerHTML: '',
    hidden: true,
    scrollIntoView: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const reportWithNulls = {
    filename: 'test.pdf',
    role: 'backend',
    summary: null,
    market: { sources: null, excluded: null },
    curriculum: null,
    skill_demand: [],
    gaps: null,
    lab_patches: null,
    jobs: [],
    warnings: null,
  };

  assert.doesNotThrow(() => {
    renderReport(reportWithNulls, 'http://127.0.0.1:8000', dummySection);
  });
  assert.doesNotMatch(dummySection.innerHTML, /undefined/);
  assert.match(dummySection.innerHTML, /Excluded from analysis: None/);
});


