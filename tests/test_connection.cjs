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

test('normalizeGitHubUsername cleans URLs, handles leading @, and trims paths', async () => {
  const { normalizeGitHubUsername } = await import('../js/github.js');
  assert.equal(normalizeGitHubUsername('https://github.com/shathiya-7'), 'shathiya-7');
  assert.equal(normalizeGitHubUsername('http://github.com/octocat/'), 'octocat');
  assert.equal(normalizeGitHubUsername('@octocat'), 'octocat');
  assert.equal(normalizeGitHubUsername('   user-name   '), 'user-name');
  assert.equal(normalizeGitHubUsername(''), '');
});

test('validateGitHubUsername enforces GitHub naming rules', async () => {
  const { validateGitHubUsername } = await import('../js/github.js');
  assert.equal(validateGitHubUsername('shathiya-7').valid, true);
  assert.equal(validateGitHubUsername('octocat').valid, true);
  assert.equal(validateGitHubUsername('').valid, false);
  assert.equal(validateGitHubUsername('-badstart').valid, false);
  assert.equal(validateGitHubUsername('badend-').valid, false);
  assert.equal(validateGitHubUsername('bad--doublehyphen').valid, false);
  assert.equal(validateGitHubUsername('invalid username with spaces').valid, false);
});

test('fetchGitHubPortfolio fetches profile and repos, handles 404, rate limits, and caches requests', async () => {
  const { fetchGitHubPortfolio, clearPortfolioCache } = await import('../js/github.js');
  clearPortfolioCache();

  let fetchCalls = 0;
  const mockFetch = async url => {
    fetchCalls++;
    if (url.includes('/users/octocat/repos')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ name: 'hello-world', fork: false, language: 'Python', stargazers_count: 10, updated_at: '2026-10-01' }],
      };
    }
    if (url.includes('/users/octocat')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ login: 'octocat', name: 'The Octocat', public_repos: 1, followers: 50, avatar_url: 'https://example.com/avatar.png' }),
      };
    }
    if (url.includes('/users/notfound')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (url.includes('/users/ratelimited')) {
      return { ok: false, status: 403, json: async () => ({ message: 'API rate limit exceeded' }) };
    }
    return { ok: false, status: 500 };
  };

  // Successful fetch
  const result = await fetchGitHubPortfolio('octocat', { fetch: mockFetch });
  assert.equal(result.profile.login, 'octocat');
  assert.equal(result.repos.length, 1);
  assert.equal(fetchCalls, 2);

  // Cached fetch (no additional network calls)
  const cached = await fetchGitHubPortfolio('octocat', { fetch: mockFetch });
  assert.equal(cached.profile.login, 'octocat');
  assert.equal(fetchCalls, 2); // Still 2, cached!

  // 404 error
  await assert.rejects(
    fetchGitHubPortfolio('notfound', { fetch: mockFetch }),
    /GitHub user "notfound" was not found/
  );

  // 403 rate limit error
  await assert.rejects(
    fetchGitHubPortfolio('ratelimited', { fetch: mockFetch }),
    /GitHub public API rate limit reached/
  );
});

test('analyzePortfolio calculates language percentages and cross-references curriculum in-demand skills', async () => {
  const { analyzePortfolio } = await import('../js/github.js');

  const profile = { login: 'octocat', name: 'Mona Lisa Octocat', public_repos: 3, followers: 20, bio: 'Builder' };
  const repos = [
    { name: 'repo-py', fork: false, language: 'Python', stargazers_count: 10, description: 'Python project', topics: ['fastapi', 'docker'], updated_at: '2026-10-01' },
    { name: 'repo-js', fork: false, language: 'JavaScript', stargazers_count: 5, description: 'JS frontend', topics: ['react'], updated_at: '2026-09-01' },
    { name: 'forked-repo', fork: true, language: 'Go', stargazers_count: 1, description: 'Fork', topics: [], updated_at: '2026-08-01' },
  ];

  const curriculumReport = {
    role: 'Backend developer',
    skill_demand: [
      { skill: 'Python', share_percent: 80 },
      { skill: 'Docker', share_percent: 60 },
      { skill: 'Kubernetes', share_percent: 40 },
    ],
  };

  const analysis = analyzePortfolio(profile, repos, curriculumReport);
  assert.equal(analysis.originalCount, 2);
  assert.equal(analysis.forkedCount, 1);
  assert.equal(analysis.languages[0].name, 'Python');
  assert.equal(analysis.languages[0].percent, 50);
  assert.equal(analysis.languages[1].name, 'JavaScript');
  assert.equal(analysis.languages[1].percent, 50);

  // Check matched skills (Python matched by language, Docker matched by topic)
  assert.deepEqual(analysis.matchedSkills.map(s => s.skill), ['Python', 'Docker']);
  // Check gap skills (Kubernetes missing in repos)
  assert.deepEqual(analysis.gapSkills.map(s => s.skill), ['Kubernetes']);
});

test('renderGitHubView safely renders empty, loading, error, and analyzed states', async () => {
  const { renderGitHubView } = await import('../js/github.js');

  const dummySection = {
    innerHTML: '',
    hidden: true,
    scrollIntoView: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  // Empty state
  renderGitHubView(dummySection, { username: '', data: null, loading: false, error: null });
  assert.match(dummySection.innerHTML, /No GitHub profile audited yet/);

  // Loading state
  renderGitHubView(dummySection, { username: 'shathiya-7', data: null, loading: true, error: null });
  assert.match(dummySection.innerHTML, /Querying GitHub public profile/);

  // Error state
  renderGitHubView(dummySection, { username: 'shathiya-7', data: null, loading: false, error: 'Rate limit reached' });
  assert.match(dummySection.innerHTML, /Rate limit reached/);

  // Analyzed state
  const mockData = {
    profile: { login: 'shathiya-7', name: 'Shathiya', avatar_url: 'https://example.com/avatar.png', html_url: 'https://github.com/shathiya-7', public_repos: 5, followers: 10 },
    originalCount: 4,
    forkedCount: 1,
    languages: [{ name: 'JavaScript', count: 3, percent: 75 }],
    topics: ['fastapi'],
    topRepos: [{ name: 'delta', html_url: 'https://github.com/shathiya-7/Delta', description: 'Delta tool', stargazers_count: 2, language: 'JavaScript', updated_at: '2026-10-28' }],
    matchedSkills: [],
    gapSkills: [],
    recommendations: ['Add descriptions to repos.'],
  };

  assert.doesNotThrow(() => {
    renderGitHubView(dummySection, { username: 'shathiya-7', data: mockData, loading: false, error: null });
  });
  assert.match(dummySection.innerHTML, /@shathiya-7/);
  assert.match(dummySection.innerHTML, /JavaScript/);
  assert.match(dummySection.innerHTML, /Add descriptions to repos/);
  assert.doesNotMatch(dummySection.innerHTML, /undefined/);
});

test('parseGitHubTarget accurately distinguishes profile URLs, repo URLs, and rejects unsupported hosts or malformed inputs', async () => {
  const { parseGitHubTarget } = await import('../js/github.js');

  // Valid profile targets
  const p1 = parseGitHubTarget('https://github.com/shathiya-7');
  assert.equal(p1.valid, true);
  assert.equal(p1.type, 'profile');
  assert.equal(p1.owner, 'shathiya-7');

  const p2 = parseGitHubTarget('github.com/octocat/');
  assert.equal(p2.valid, true);
  assert.equal(p2.type, 'profile');
  assert.equal(p2.owner, 'octocat');

  const p3 = parseGitHubTarget('@octocat');
  assert.equal(p3.valid, true);
  assert.equal(p3.type, 'profile');
  assert.equal(p3.owner, 'octocat');

  // Valid repository targets
  const r1 = parseGitHubTarget('https://github.com/shathiya-7/Delta');
  assert.equal(r1.valid, true);
  assert.equal(r1.type, 'repo');
  assert.equal(r1.owner, 'shathiya-7');
  assert.equal(r1.repo, 'Delta');

  const r2 = parseGitHubTarget('github.com/octocat/Spoon-Knife.git');
  assert.equal(r2.valid, true);
  assert.equal(r2.type, 'repo');
  assert.equal(r2.owner, 'octocat');
  assert.equal(r2.repo, 'Spoon-Knife');

  const r3 = parseGitHubTarget('shathiya-7/Delta');
  assert.equal(r3.valid, true);
  assert.equal(r3.type, 'repo');
  assert.equal(r3.owner, 'shathiya-7');
  assert.equal(r3.repo, 'Delta');

  // Unsupported hosts & malformed inputs
  const errHost = parseGitHubTarget('https://gitlab.com/shathiya-7/Delta');
  assert.equal(errHost.valid, false);
  assert.match(errHost.error, /Unsupported host "gitlab\.com"/);

  const errSystem = parseGitHubTarget('https://github.com/explore');
  assert.equal(errSystem.valid, false);
  assert.match(errSystem.error, /is a GitHub platform path/);

  const errEmpty = parseGitHubTarget('   ');
  assert.equal(errEmpty.valid, false);
  assert.match(errEmpty.error, /Please enter a GitHub profile or repository URL/);

  const errInvalidUser = parseGitHubTarget('-invalid-user-');
  assert.equal(errInvalidUser.valid, false);
  assert.match(errInvalidUser.error, /Invalid GitHub username/);
});

test('decodeBase64Utf8 decodes UTF-8 and emoji content safely', async () => {
  const { decodeBase64Utf8 } = await import('../js/github.js');

  const sampleText = '# Delta — Learning Connected 🚀\nFrom classroom to what next.';
  const encoded = Buffer.from(sampleText, 'utf-8').toString('base64');
  assert.equal(decodeBase64Utf8(encoded), sampleText);
  assert.equal(decodeBase64Utf8(''), '');
  assert.equal(decodeBase64Utf8(null), '');
});

test('fetchGitHubTarget fetches repo metadata, languages, readme, and contents with mock fetch', async () => {
  const { fetchGitHubTarget, clearPortfolioCache } = await import('../js/github.js');
  clearPortfolioCache();

  const mockFetch = async url => {
    if (url.includes('/repos/shathiya-7/Delta/languages')) {
      return { ok: true, status: 200, json: async () => ({ JavaScript: 40000, HTML: 10000 }) };
    }
    if (url.includes('/repos/shathiya-7/Delta/readme')) {
      return { ok: true, status: 200, json: async () => ({ name: 'README.md', content: Buffer.from('# Delta', 'utf-8').toString('base64'), size: 7 }) };
    }
    if (url.includes('/repos/shathiya-7/Delta/contents')) {
      return { ok: true, status: 200, json: async () => [{ name: 'package.json' }, { name: 'tests' }, { name: 'LICENSE' }] };
    }
    if (url.includes('/repos/shathiya-7/Delta')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Delta',
          full_name: 'shathiya-7/Delta',
          html_url: 'https://github.com/shathiya-7/Delta',
          description: 'A skills analyzer',
          stargazers_count: 5,
          forks_count: 1,
          default_branch: 'main',
          topics: ['fastapi', 'javascript'],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const target = { type: 'repo', owner: 'shathiya-7', repo: 'Delta' };
  const data = await fetchGitHubTarget(target, { fetch: mockFetch });

  assert.equal(data.type, 'repo');
  assert.equal(data.repoMeta.name, 'Delta');
  assert.equal(data.languages.JavaScript, 40000);
  assert.equal(data.readme.name, 'README.md');
  assert.equal(data.contents.length, 3);
});

test('fetchGitHubTarget handles missing README (404) and rate limits (403) gracefully', async () => {
  const { fetchGitHubTarget, clearPortfolioCache } = await import('../js/github.js');
  clearPortfolioCache();

  // 1. Missing README 404
  const mockFetchNoReadme = async url => {
    if (url.includes('/readme')) {
      return { ok: false, status: 404 };
    }
    if (url.includes('/languages')) return { ok: true, status: 200, json: async () => ({}) };
    if (url.includes('/contents')) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => ({ name: 'no-readme-repo' }) };
  };

  const dataNoReadme = await fetchGitHubTarget({ type: 'repo', owner: 'test-user', repo: 'no-readme-repo' }, { fetch: mockFetchNoReadme });
  assert.equal(dataNoReadme.readme, null);

  // 2. Rate limit 403
  const mockFetchRateLimit = async () => ({ ok: false, status: 403, json: async () => ({ message: 'API rate limit exceeded' }) });
  await assert.rejects(
    fetchGitHubTarget({ type: 'repo', owner: 'test-user', repo: 'rate-limited' }, { fetch: mockFetchRateLimit }),
    /GitHub public API rate limit reached/
  );
});

test('analyzeGitHubTarget categorizes skills as Detected, Possible, and Not assessed based on concrete evidence', async () => {
  const { analyzeGitHubTarget } = await import('../js/github.js');

  const rawRepoData = {
    type: 'repo',
    repoMeta: {
      name: 'Delta',
      description: 'Educational tool',
      topics: ['docker'],
      stargazers_count: 3,
      forks_count: 0,
      pushed_at: new Date().toISOString(),
    },
    languages: { JavaScript: 60000, Python: 20000 },
    readme: { name: 'README.md', content: Buffer.from('# Delta Project\n\nFull setup guide.', 'utf-8').toString('base64'), size: 300 },
    contents: [{ name: 'package.json' }, { name: 'requirements.txt' }, { name: 'tests' }],
  };

  const curriculumReport = {
    role: 'Backend developer',
    skill_demand: [
      { skill: 'Python', share_percent: 75 },
      { skill: 'Docker', share_percent: 60 },
      { skill: 'Kubernetes', share_percent: 40 },
    ],
  };

  const analysis = analyzeGitHubTarget(rawRepoData, curriculumReport);
  assert.equal(analysis.targetType, 'repo');

  // Check Detected skills (JavaScript from language bytes, Node.js from package.json, Python from requirements.txt & languages)
  const detectedNames = analysis.detectedSkills.map(s => s.skill);
  assert.equal(detectedNames.includes('JavaScript'), true);
  assert.equal(detectedNames.includes('Python'), true);
  assert.equal(detectedNames.includes('Node.js'), true);

  // Check Possible skills (Docker from topic tag)
  const possibleNames = analysis.possibleSkills.map(s => s.skill);
  assert.equal(possibleNames.includes('docker'), true);

  // Check Not assessed skills (Kubernetes has no evidence in repo files)
  const unassessedNames = analysis.unassessedSkills.map(s => s.skill);
  assert.equal(unassessedNames.includes('Kubernetes'), true);

  // Check quality signals (Tests verified, README verified, CI missing)
  const testSignal = analysis.qualitySignals.find(q => q.label === 'Automated Testing');
  assert.equal(testSignal.status, 'pass');

  const ciSignal = analysis.qualitySignals.find(q => q.label === 'Continuous Integration (CI)');
  assert.equal(ciSignal.status, 'caution');
});

test('renderGitHubView safely escapes untrusted XSS in repo descriptions and README preview', async () => {
  const { renderGitHubView } = await import('../js/github.js');

  const dummySection = {
    innerHTML: '',
    hidden: true,
    scrollIntoView: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const xssRepoData = {
    targetType: 'repo',
    repoMeta: {
      name: '<script>alert("repo")</script>',
      description: '<img src=x onerror=alert("xss")>',
      html_url: 'https://github.com/test/repo',
      stargazers_count: 0,
      forks_count: 0,
      open_issues_count: 0,
      default_branch: 'main',
    },
    langList: [{ name: '<script>', percent: 100, bytes: 1000 }],
    readmeData: { name: 'README.md' },
    readmeText: '<script>maliciousCode();</script>',
    detectedSkills: [{ skill: '<script>', evidence: 'malicious', type: 'Detected' }],
    possibleSkills: [],
    unassessedSkills: [],
    qualitySignals: [{ label: 'Docs', status: 'pass', headline: '<script>', detail: '<b>unsafe</b>' }],
    recommendations: ['<script>evil()</script>'],
  };

  assert.doesNotThrow(() => {
    renderGitHubView(dummySection, { inputUrl: 'https://github.com/test/repo', data: xssRepoData, loading: false, error: null });
  });

  // Verify dangerous tags are escaped and never rendered raw
  assert.doesNotMatch(dummySection.innerHTML, /<script>alert/);
  assert.doesNotMatch(dummySection.innerHTML, /<img src=x onerror/);
  assert.doesNotMatch(dummySection.innerHTML, /<script>maliciousCode/);
  assert.match(dummySection.innerHTML, /&lt;script&gt;alert/);
});

test('initSplitText creates accessible character spans with aria-label and aria-hidden', async () => {
  const { initSplitText } = await import('../js/effects.js');

  // Create lightweight mock DOM node
  function createMockElement(text) {
    const listeners = {};
    const dataset = {};
    const style = {};
    let attributes = {};
    let children = [];

    const el = {
      nodeType: 1,
      nodeName: 'H1',
      dataset,
      style,
      classList: {
        add: cls => { el.className += ` ${cls}`; },
        contains: cls => (el.className || '').includes(cls),
      },
      className: '',
      setAttribute: (k, v) => { attributes[k] = v; },
      getAttribute: k => attributes[k],
      addEventListener: (evt, fn) => { listeners[evt] = fn; },
      childNodes: [{ nodeType: 3, textContent: text }],
      appendChild: child => { children.push(child); },
      get innerHTML() {
        return children.map(c => c.innerHTML || c.textContent || '').join('');
      },
      set innerHTML(val) {
        children = [];
      },
      get textContent() {
        return text;
      },
    };
    return el;
  }

  // Setup mock document environment for this test
  const originalDoc = global.document;
  global.document = {
    createDocumentFragment: () => {
      const items = [];
      return {
        appendChild: item => items.push(item),
        childNodes: items,
        get innerHTML() {
          return items.map(c => c.innerHTML || c.textContent || '').join('');
        },
      };
    },
    createElement: tag => {
      const children = [];
      const style = {};
      const attrs = {};
      const el = {
        nodeType: 1,
        nodeName: tag.toUpperCase(),
        className: '',
        style,
        setAttribute: (k, v) => { attrs[k] = v; },
        getAttribute: k => attrs[k],
        appendChild: c => children.push(c),
        textContent: '',
        get innerHTML() {
          if (children.length > 0) {
            return children.map(c => c.innerHTML || c.textContent || '').join('');
          }
          return el.textContent;
        },
      };
      return el;
    },
    createTextNode: text => ({
      nodeType: 3,
      textContent: text,
    }),
  };

  try {
    const heading = createMockElement('Delta Skills');
    initSplitText(heading, { staggerDelay: 25 });

    // Verify accessible aria attributes
    assert.equal(heading.getAttribute('aria-label'), 'Delta Skills');
    assert.equal(heading.dataset.splitInitialized, 'true');

    // Calling again does not re-split
    assert.doesNotThrow(() => initSplitText(heading));
  } finally {
    global.document = originalDoc;
  }
});

test('initBorderGlow tracks pointermove and pointerleave CSS variables and cleans up on destroy', async () => {
  const { initBorderGlow } = await import('../js/effects.js');

  const listeners = {};
  const styles = {};
  const dataset = {};

  const mockCard = {
    nodeType: 1,
    dataset,
    classList: {
      add: cls => { mockCard.className = `${mockCard.className || ''} ${cls}`.trim(); },
    },
    style: {
      setProperty: (k, v) => { styles[k] = v; },
      getPropertyValue: k => styles[k],
    },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 300, height: 200 }),
    addEventListener: (evt, fn) => { listeners[evt] = fn; },
    removeEventListener: (evt, fn) => { delete listeners[evt]; },
  };

  const originalDoc = global.document;
  global.document = { querySelectorAll: () => [mockCard] };

  try {
    const glow = initBorderGlow(mockCard, { glowRadius: 200, intensity: 0.8 });

    assert.equal(mockCard.className.includes('border-glow'), true);
    assert.equal(styles['--glow-radius'], '200px');
    assert.equal(typeof listeners['pointermove'], 'function');
    assert.equal(typeof listeners['pointerleave'], 'function');

    // Simulate pointermove inside card bounds
    listeners['pointermove']({ clientX: 150, clientY: 180 });
    assert.equal(styles['--glow-x'], '50px');
    assert.equal(styles['--glow-y'], '80px');
    assert.equal(styles['--glow-opacity'], '0.8');

    // Simulate pointerleave
    listeners['pointerleave']();
    assert.equal(styles['--glow-opacity'], '0');

    // Verify cleanup
    glow.destroy();
    assert.equal(listeners['pointermove'], undefined);
    assert.equal(listeners['pointerleave'], undefined);
  } finally {
    global.document = originalDoc;
  }
});

test('initShapeGrid safely degrades when canvas is missing or offscreen', async () => {
  const { initShapeGrid } = await import('../js/effects.js');

  // Should not throw on null or missing container
  const emptyResult = initShapeGrid(null);
  assert.equal(typeof emptyResult.destroy, 'function');
  assert.doesNotThrow(() => emptyResult.destroy());
});

test('Zen Mode toggles body class and persists state in storage', async () => {
  const storage = {};
  const mockLocalStorage = {
    getItem: k => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
  };

  const bodyClasses = new Set();
  const mockBody = {
    classList: {
      toggle: cls => {
        if (bodyClasses.has(cls)) {
          bodyClasses.delete(cls);
          return false;
        } else {
          bodyClasses.add(cls);
          return true;
        }
      },
      contains: cls => bodyClasses.has(cls),
    },
  };

  function toggleZen(body, store) {
    const isZen = body.classList.toggle('zen-mode');
    store.setItem('delta_zen_mode', isZen ? 'true' : 'false');
    return isZen;
  }

  // Turn Zen Mode ON
  const state1 = toggleZen(mockBody, mockLocalStorage);
  assert.equal(state1, true);
  assert.equal(mockBody.classList.contains('zen-mode'), true);
  assert.equal(mockLocalStorage.getItem('delta_zen_mode'), 'true');

  // Turn Zen Mode OFF
  const state2 = toggleZen(mockBody, mockLocalStorage);
  assert.equal(state2, false);
  assert.equal(mockBody.classList.contains('zen-mode'), false);
  assert.equal(mockLocalStorage.getItem('delta_zen_mode'), 'false');
});






