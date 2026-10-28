import { esc } from './render.js';

/**
 * Parses and validates user input into a GitHub target (profile or repository).
 * Supports URLs:
 *   - https://github.com/username
 *   - https://github.com/username/repository
 *   - github.com/username
 *   - username
 *   - username/repository
 *
 * @param {string} input - User input
 * @returns {{ valid: boolean, type?: 'profile'|'repo', owner?: string, repo?: string, originalUrl?: string, error?: string }}
 */
export function parseGitHubTarget(input) {
  if (!input || !String(input).trim()) {
    return { valid: false, error: 'Please enter a GitHub profile or repository URL.' };
  }
  let s = String(input).trim();

  // Validate protocol and host if provided
  if (/^[a-z]+:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();
      if (host !== 'github.com' && host !== 'www.github.com') {
        return {
          valid: false,
          error: `Unsupported host "${host}". Delta currently supports public GitHub URLs (github.com).`,
        };
      }
      s = u.pathname;
    } catch {
      return { valid: false, error: 'Invalid URL format.' };
    }
  } else if (/^(?:www\.)?github\.com\//i.test(s)) {
    s = s.replace(/^(?:www\.)?github\.com\//i, '/');
  }

  // Strip leading/trailing slashes and leading @
  s = s.replace(/^\/+|\/+$/g, '').replace(/^@/, '');
  const parts = s.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { valid: false, error: 'Please enter a valid GitHub profile or repository URL.' };
  }

  const owner = parts[0].trim();
  const githubUserRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
  if (!githubUserRegex.test(owner)) {
    return {
      valid: false,
      error: `Invalid GitHub username "${owner}". Usernames contain up to 39 alphanumeric characters or single hyphens and cannot begin or end with a hyphen.`,
    };
  }

  const reserved = [
    'features',
    'pricing',
    'explore',
    'topics',
    'trending',
    'collections',
    'events',
    'sponsors',
    'settings',
    'orgs',
    'marketplace',
  ];
  if (reserved.includes(owner.toLowerCase())) {
    return {
      valid: false,
      error: `"${owner}" is a GitHub platform path, not a public user or repository.`,
    };
  }

  if (parts.length === 1) {
    return {
      valid: true,
      type: 'profile',
      owner,
      originalUrl: `https://github.com/${owner}`,
    };
  }

  // If 2 or more parts, treat as repository (normalizing subpaths like /tree/main)
  const repo = parts[1].replace(/\.git$/i, '').trim();
  if (!repo || !/^[a-z\d_.-]+$/i.test(repo)) {
    return { valid: false, error: `Invalid repository name "${repo}".` };
  }

  return {
    valid: true,
    type: 'repo',
    owner,
    repo,
    originalUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Normalizes user input into a clean identifier string.
 * @param {string} input - User input
 * @returns {string} Normalized string
 */
export function normalizeGitHubUsername(input) {
  const parsed = parseGitHubTarget(input);
  if (!parsed.valid) return '';
  return parsed.type === 'repo' ? `${parsed.owner}/${parsed.repo}` : parsed.owner;
}

/**
 * Validates whether the given string is a valid GitHub profile username.
 * @param {string} username - Candidate username
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateGitHubUsername(username) {
  const parsed = parseGitHubTarget(username);
  if (!parsed.valid) {
    return { valid: false, error: parsed.error };
  }
  if (parsed.type !== 'profile') {
    return { valid: false, error: 'Expected a GitHub profile username, but received a repository path.' };
  }
  return { valid: true, error: null };
}

/**
 * Decodes base64-encoded UTF-8 strings safely across Node.js and modern browsers.
 * @param {string} base64Str - Base64 encoded string
 * @returns {string} Decoded plain text
 */
export function decodeBase64Utf8(base64Str) {
  if (!base64Str) return '';
  const clean = base64Str.replace(/\s+/g, '');
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(clean, 'base64').toString('utf-8');
    }
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    try {
      return atob(clean);
    } catch {
      return '';
    }
  }
}

// In-memory cache for API requests to conserve GitHub unauthenticated rate limits (60 req/hr)
const targetCache = new Map();

/**
 * Clears the in-memory cache.
 */
export function clearPortfolioCache() {
  targetCache.clear();
}

/**
 * Fetches public GitHub profile and repositories for a user.
 *
 * @param {string} username - GitHub username
 * @param {object} [options] - Fetch options
 * @returns {Promise<{ type: 'profile', profile: object, repos: Array<object> }>}
 */
export async function fetchGitHubPortfolio(username, options = {}) {
  const parsed = parseGitHubTarget(username);
  if (!parsed.valid || parsed.type !== 'profile') {
    throw new Error(parsed.error || 'Invalid GitHub username.');
  }
  return fetchGitHubTarget(parsed, options);
}

/**
 * Fetches public GitHub data for either a profile or repository target.
 *
 * @param {{ type: 'profile'|'repo', owner: string, repo?: string }} target - Parsed target
 * @param {object} [options] - Fetch overrides (fetch, signal, bypassCache)
 * @returns {Promise<object>} Raw API data
 */
export async function fetchGitHubTarget(target, options = {}) {
  const cacheKey = target.type === 'repo'
    ? `repo:${target.owner.toLowerCase()}/${target.repo.toLowerCase()}`
    : `profile:${target.owner.toLowerCase()}`;

  if (!options.bypassCache && targetCache.has(cacheKey)) {
    return targetCache.get(cacheKey);
  }

  const fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) {
    throw new Error('Fetch implementation is required to communicate with GitHub API.');
  }

  const headers = { Accept: 'application/vnd.github.v3+json' };

  if (target.type === 'profile') {
    // 1. Fetch user profile
    const userRes = await fetchFn(`https://api.github.com/users/${encodeURIComponent(target.owner)}`, {
      headers,
      signal: options.signal,
    });

    if (userRes.status === 404) {
      throw new Error(`GitHub user "${target.owner}" was not found. Please verify the username.`);
    }
    if (userRes.status === 403) {
      throw new Error('GitHub public API rate limit reached (60 requests/hour for unauthenticated access). Please wait a few minutes before trying again.');
    }
    if (!userRes.ok) {
      throw new Error(`GitHub API error (HTTP ${userRes.status}).`);
    }

    const profile = await userRes.json();

    // 2. Fetch public repos
    let repos = [];
    try {
      const reposRes = await fetchFn(
        `https://api.github.com/users/${encodeURIComponent(target.owner)}/repos?sort=updated&per_page=30`,
        { headers, signal: options.signal }
      );
      if (reposRes.ok) {
        repos = await reposRes.json();
        if (!Array.isArray(repos)) repos = [];
      } else if (reposRes.status === 403) {
        throw new Error('GitHub public API rate limit reached while fetching repository list.');
      }
    } catch (err) {
      if (options.signal?.aborted) throw err;
      // If repos fetch fails, continue with empty repos rather than crashing profile view
      repos = [];
    }

    const result = { type: 'profile', profile, repos };
    targetCache.set(cacheKey, result);
    return result;
  }

  if (target.type === 'repo') {
    const owner = encodeURIComponent(target.owner);
    const repo = encodeURIComponent(target.repo);

    // 1. Fetch repository metadata
    const repoRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: options.signal,
    });

    if (repoRes.status === 404) {
      throw new Error(`Public repository "${target.owner}/${target.repo}" was not found. It may be private or deleted.`);
    }
    if (repoRes.status === 403) {
      throw new Error('GitHub public API rate limit reached (60 requests/hour for unauthenticated access). Please retry in a few minutes.');
    }
    if (!repoRes.ok) {
      throw new Error(`GitHub API error (HTTP ${repoRes.status}).`);
    }

    const repoMeta = await repoRes.json();

    // 2. Fetch language breakdown
    let languages = {};
    try {
      const langRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/languages`, {
        headers,
        signal: options.signal,
      });
      if (langRes.ok) {
        languages = await langRes.json();
      }
    } catch {
      languages = {};
    }

    // 3. Fetch README (if available)
    let readme = null;
    try {
      const readmeRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/readme`, {
        headers,
        signal: options.signal,
      });
      if (readmeRes.ok) {
        readme = await readmeRes.json();
      }
    } catch {
      readme = null;
    }

    // 4. Fetch top-level contents/structure to detect manifests, tests, CI
    let contents = [];
    try {
      const contentsRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/contents`, {
        headers,
        signal: options.signal,
      });
      if (contentsRes.ok) {
        contents = await contentsRes.json();
        if (!Array.isArray(contents)) contents = [];
      }
    } catch {
      contents = [];
    }

    const result = {
      type: 'repo',
      repoMeta,
      languages,
      readme,
      contents,
    };
    targetCache.set(cacheKey, result);
    return result;
  }

  throw new Error('Unsupported GitHub target type.');
}

/**
 * Common configuration and manifest filenames associated with ecosystems.
 */
const MANIFEST_SIGNATURES = [
  { file: 'package.json', ecosystem: 'Node.js / JavaScript / TypeScript', skill: 'Node.js' },
  { file: 'package-lock.json', ecosystem: 'npm', skill: 'npm' },
  { file: 'pnpm-lock.yaml', ecosystem: 'pnpm', skill: 'pnpm' },
  { file: 'yarn.lock', ecosystem: 'Yarn', skill: 'Yarn' },
  { file: 'requirements.txt', ecosystem: 'Python (pip)', skill: 'Python' },
  { file: 'pyproject.toml', ecosystem: 'Python (Poetry/Flit)', skill: 'Python' },
  { file: 'pipfile', ecosystem: 'Python (Pipenv)', skill: 'Python' },
  { file: 'setup.py', ecosystem: 'Python Packaging', skill: 'Python' },
  { file: 'cargo.toml', ecosystem: 'Rust (Cargo)', skill: 'Rust' },
  { file: 'go.mod', ecosystem: 'Go Modules', skill: 'Go' },
  { file: 'pom.xml', ecosystem: 'Java (Maven)', skill: 'Java' },
  { file: 'build.gradle', ecosystem: 'Java/Kotlin (Gradle)', skill: 'Java' },
  { file: 'composer.json', ecosystem: 'PHP (Composer)', skill: 'PHP' },
  { file: 'gemfile', ecosystem: 'Ruby (Bundler)', skill: 'Ruby' },
  { file: 'dockerfile', ecosystem: 'Containerization', skill: 'Docker' },
  { file: 'docker-compose.yml', ecosystem: 'Multi-Container Docker', skill: 'Docker' },
  { file: 'docker-compose.yaml', ecosystem: 'Multi-Container Docker', skill: 'Docker' },
  { file: 'tsconfig.json', ecosystem: 'TypeScript', skill: 'TypeScript' },
  { file: 'vite.config.js', ecosystem: 'Vite', skill: 'Vite' },
  { file: 'vite.config.ts', ecosystem: 'Vite', skill: 'Vite' },
];

/**
 * Analyzes fetched GitHub data for quality signals, technologies, and curriculum alignment.
 *
 * @param {object} rawData - Data returned by fetchGitHubTarget
 * @param {object|null} [curriculumReport=null] - Active DELTA analysis report
 * @returns {object} Structured portfolio assessment
 */
export function analyzeGitHubTarget(rawData, curriculumReport = null) {
  if (rawData.type === 'profile') {
    return analyzeProfileData(rawData.profile, rawData.repos, curriculumReport);
  }
  if (rawData.type === 'repo') {
    return analyzeRepoData(rawData.repoMeta, rawData.languages, rawData.readme, rawData.contents, curriculumReport);
  }
  throw new Error('Unsupported target data for analysis.');
}

/**
 * Re-export wrapper matching Prompt 4/5 interface
 */
export function analyzePortfolio(profile, repos = [], curriculumReport = null) {
  return analyzeProfileData(profile, repos, curriculumReport);
}

/**
 * Analyzes a public user profile and their public repository list.
 */
function analyzeProfileData(profile, repos = [], curriculumReport = null) {
  const safeRepos = Array.isArray(repos) ? repos : [];
  const originalRepos = safeRepos.filter(r => !r.fork);
  const forkedRepos = safeRepos.filter(r => r.fork);

  // Language aggregation across non-fork repos
  const languageCounts = {};
  for (const r of originalRepos) {
    if (r.language) {
      languageCounts[r.language] = (languageCounts[r.language] || 0) + 1;
    }
  }

  const totalOriginalWithLang = Object.values(languageCounts).reduce((a, b) => a + b, 0);
  const languages = Object.entries(languageCounts)
    .map(([lang, count]) => ({
      name: lang,
      count,
      percent: totalOriginalWithLang > 0 ? Math.round((count / totalOriginalWithLang) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Collect topics
  const topicsSet = new Set();
  for (const r of safeRepos) {
    if (Array.isArray(r.topics)) {
      for (const t of r.topics) topicsSet.add(t.toLowerCase());
    }
  }
  const topics = Array.from(topicsSet);

  // Top public repos
  const topRepos = [...safeRepos]
    .sort((a, b) => {
      const starDiff = (b.stargazers_count || 0) - (a.stargazers_count || 0);
      if (starDiff !== 0) return starDiff;
      if (!a.fork && b.fork) return -1;
      if (a.fork && !b.fork) return 1;
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    })
    .slice(0, 6);

  // Skills categorization: Detected, Possible, Not assessed
  const detectedSkills = [];
  const possibleSkills = [];
  const unassessedSkills = [];

  // Directly detected from languages
  for (const l of languages) {
    detectedSkills.push({
      skill: l.name,
      evidence: `Primary language across ${l.count} ${l.count === 1 ? 'repository' : 'repositories'} (${l.percent}%)`,
      type: 'Detected',
    });
  }

  // Inferred from topics
  for (const t of topics) {
    if (!detectedSkills.some(d => d.skill.toLowerCase() === t.toLowerCase())) {
      possibleSkills.push({
        skill: t,
        evidence: `Tagged as repository topic #${t}`,
        type: 'Possible',
      });
    }
  }

  // Cross-reference with curriculum report in-demand skills (if available)
  const demandList = Array.isArray(curriculumReport?.skill_demand) ? curriculumReport.skill_demand : [];
  const matchedSkills = [];
  const gapSkills = [];

  for (const d of demandList) {
    const sLower = (d.skill || '').toLowerCase();
    const isDirect = detectedSkills.some(ds => ds.skill.toLowerCase() === sLower);
    const isPossible = possibleSkills.some(ps => ps.skill.toLowerCase() === sLower);

    if (isDirect || isPossible) {
      matchedSkills.push({ skill: d.skill, share_percent: d.share_percent });
    } else {
      const item = {
        skill: d.skill,
        share_percent: d.share_percent,
        evidence: 'No public repository or topic evidence found in this profile sample',
        type: 'Not assessed',
      };
      unassessedSkills.push(item);
      gapSkills.push(item);
    }
  }

  // Quality Signals
  const qualitySignals = [
    {
      label: 'Repository Independence',
      status: originalRepos.length > 0 ? 'pass' : 'caution',
      headline: `${originalRepos.length} original, ${forkedRepos.length} forked`,
      detail: originalRepos.length > 0
        ? 'Public profile contains original source repositories demonstrating individual work.'
        : 'All analyzed repositories are forks. Original implementations provide clearer individual evidence.',
    },
    {
      label: 'Documentation Coverage',
      status: safeRepos.filter(r => Boolean(r.description)).length >= Math.ceil(safeRepos.length / 2) ? 'pass' : 'caution',
      headline: `${safeRepos.filter(r => Boolean(r.description)).length} of ${safeRepos.length} with descriptions`,
      detail: 'Clear 1-2 sentence descriptions help peers and recruiters quickly assess project scope.',
    },
    {
      label: 'Topic Discoverability',
      status: topics.length > 0 ? 'pass' : 'info',
      headline: `${topics.length} tech topics tagged`,
      detail: topics.length > 0
        ? `Topics detected: ${topics.slice(0, 5).join(', ')}.`
        : 'Tagging repositories with topics (e.g. #fastapi, #docker) improves searchability.',
    },
    {
      label: 'Recent Maintenance',
      status: safeRepos.some(r => new Date(r.updated_at) > new Date(Date.now() - 90 * 86400000)) ? 'pass' : 'info',
      headline: 'Active within last 90 days',
      detail: 'Shows ongoing learning and version control usage.',
    },
  ];

  // Recommendations
  const recommendations = [];
  if (originalRepos.length === 0 && safeRepos.length > 0) {
    recommendations.push('Create and publish 1-2 original repositories demonstrating practical coursework tasks rather than only forks.');
  }
  const withoutDesc = safeRepos.filter(r => !r.description).length;
  if (withoutDesc > 0) {
    recommendations.push(`Add descriptions to ${withoutDesc} public repositories to explain project context, tools used, and problem solved.`);
  }
  if (topics.length === 0 && safeRepos.length > 0) {
    recommendations.push('Tag repositories with technology topics (e.g. #python, #docker, #fastapi) to highlight skills on GitHub search.');
  }
  if (unassessedSkills.length > 0) {
    const topGaps = unassessedSkills.slice(0, 3).map(g => g.skill).join(', ');
    recommendations.push(`Consider building a focused sample project demonstrating top in-demand skills not yet visible in your public code: ${topGaps}.`);
  }
  if (!profile.bio) {
    recommendations.push('Add a concise bio to your GitHub profile stating your learning goals and primary focus area.');
  }

  return {
    targetType: 'profile',
    profile,
    originalCount: originalRepos.length,
    forkedCount: forkedRepos.length,
    languages,
    topics,
    topRepos,
    detectedSkills,
    possibleSkills,
    unassessedSkills,
    matchedSkills,
    gapSkills,
    qualitySignals,
    recommendations,
  };
}

/**
 * Analyzes a specific public repository target.
 */
function analyzeRepoData(repoMeta, languages = {}, readmeData = null, contents = [], curriculumReport = null) {
  // 1. Languages breakdown
  const totalBytes = Object.values(languages || {}).reduce((a, b) => a + b, 0);
  const langList = Object.entries(languages || {})
    .map(([lang, bytes]) => ({
      name: lang,
      bytes,
      percent: totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  // 2. File list and manifest scanning
  const safeContents = Array.isArray(contents) ? contents : [];
  const fileNames = safeContents.map(c => (c.name || '').toLowerCase());

  // Detect manifests
  const detectedManifests = [];
  const manifestSkills = new Set();
  for (const sig of MANIFEST_SIGNATURES) {
    if (fileNames.includes(sig.file)) {
      detectedManifests.push(sig);
      manifestSkills.add(sig.skill);
    }
  }

  // Testing indicators
  const testItems = safeContents.filter(c => {
    const n = (c.name || '').toLowerCase();
    return ['test', 'tests', '__tests__', 'spec', 'specs'].includes(n) || n.includes('test') || n.includes('spec');
  });
  const hasTests = testItems.length > 0;

  // CI Workflows indicators
  const hasGithubDir = fileNames.includes('.github');
  const ciFiles = safeContents.filter(c => {
    const n = (c.name || '').toLowerCase();
    return n.startsWith('.travis') || n.includes('circleci') || n.includes('jenkins') || n.includes('gitlab-ci');
  });
  const hasCi = hasGithubDir || ciFiles.length > 0;

  // License indicator
  const hasLicense = Boolean(repoMeta.license && repoMeta.license.key !== 'other') || fileNames.some(f => f.startsWith('license'));

  // README analysis
  let readmeText = '';
  let readmeSize = 0;
  if (readmeData && readmeData.content) {
    readmeText = decodeBase64Utf8(readmeData.content);
    readmeSize = readmeText.length;
  } else if (readmeData && readmeData.size) {
    readmeSize = readmeData.size;
  }
  const hasReadme = Boolean(readmeData && readmeData.name);
  const isComprehensiveReadme = readmeSize > 300 && (readmeText.includes('#') || readmeText.includes('\n\n'));

  // Maintenance indicator
  const lastPush = repoMeta.pushed_at ? new Date(repoMeta.pushed_at) : new Date(repoMeta.updated_at || 0);
  const daysSincePush = Math.round((Date.now() - lastPush.getTime()) / 86400000);
  const isActive = daysSincePush <= 180;

  // 3. Skills and Technology Evidence Categorization
  const detectedSkills = [];
  const possibleSkills = [];
  const unassessedSkills = [];

  // Directly detected from language breakdown
  for (const l of langList) {
    detectedSkills.push({
      skill: l.name,
      evidence: `Codebase analysis (${l.percent}% of repository bytes)`,
      type: 'Detected',
    });
  }

  // Directly detected from manifests
  for (const m of detectedManifests) {
    if (!detectedSkills.some(ds => ds.skill.toLowerCase() === m.skill.toLowerCase())) {
      detectedSkills.push({
        skill: m.skill,
        evidence: `Project configuration file: ${m.file} (${m.ecosystem})`,
        type: 'Detected',
      });
    }
  }

  // Inferred from topics
  const topics = Array.isArray(repoMeta.topics) ? repoMeta.topics : [];
  for (const t of topics) {
    if (!detectedSkills.some(d => d.skill.toLowerCase() === t.toLowerCase())) {
      possibleSkills.push({
        skill: t,
        evidence: `Inferred from repository topic #${t}`,
        type: 'Possible',
      });
    }
  }

  // Cross-reference with curriculum report
  const demandList = Array.isArray(curriculumReport?.skill_demand) ? curriculumReport.skill_demand : [];
  for (const d of demandList) {
    const sLower = (d.skill || '').toLowerCase();
    const isDirect = detectedSkills.some(ds => ds.skill.toLowerCase() === sLower);
    const isPossible = possibleSkills.some(ps => ps.skill.toLowerCase() === sLower);

    if (!isDirect && !isPossible) {
      unassessedSkills.push({
        skill: d.skill,
        share_percent: d.share_percent,
        evidence: 'No configuration, code, or topic evidence found in this repository',
        type: 'Not assessed',
      });
    }
  }

  // 4. Quality Signals
  const qualitySignals = [
    {
      label: 'Documentation (README)',
      status: isComprehensiveReadme ? 'pass' : hasReadme ? 'caution' : 'fail',
      headline: hasReadme ? (isComprehensiveReadme ? 'Comprehensive documentation' : 'Basic README detected') : 'No README found',
      detail: hasReadme
        ? `Found ${readmeData.name} (${readmeSize} chars). README guides setup and usage for reviewers.`
        : 'A clear README is essential for prospective employers and collaborators to run and evaluate your project.',
    },
    {
      label: 'Automated Testing',
      status: hasTests ? 'pass' : 'fail',
      headline: hasTests ? 'Test suite structure found' : 'No test directory detected',
      detail: hasTests
        ? `Detected test indicators: ${testItems.map(t => t.name).join(', ')}.`
        : 'Automated tests prove that functionality works as intended and resists regressions.',
    },
    {
      label: 'Continuous Integration (CI)',
      status: hasCi ? 'pass' : 'caution',
      headline: hasCi ? 'CI workflow configured' : 'No CI pipeline found',
      detail: hasCi
        ? 'Automated build and test workflows confirm repeatability across environments.'
        : 'Adding GitHub Actions in .github/workflows automates tests on every push.',
    },
    {
      label: 'Dependency Manifest',
      status: detectedManifests.length > 0 ? 'pass' : 'caution',
      headline: detectedManifests.length > 0 ? `${detectedManifests.length} manifest file(s)` : 'No manifest file found',
      detail: detectedManifests.length > 0
        ? `Configured via ${detectedManifests.map(m => m.file).join(', ')}.`
        : 'Package manifests lock dependencies and make installations reproducible.',
    },
    {
      label: 'Active Maintenance',
      status: isActive ? 'pass' : 'info',
      headline: `Last pushed ${daysSincePush} days ago`,
      detail: isActive ? 'Recent repository activity observed.' : 'No commits in the past 6 months.',
    },
    {
      label: 'Open-Source License',
      status: hasLicense ? 'pass' : 'caution',
      headline: repoMeta.license ? repoMeta.license.name : hasLicense ? 'License file present' : 'No license specified',
      detail: hasLicense
        ? 'Clear licensing allows others to understand reuse and evaluation terms.'
        : 'Without a license, public code is by default all-rights-reserved.',
    },
  ];

  // 5. Actionable Recommendations
  const recommendations = [];
  if (!hasReadme) {
    recommendations.push('Add a README.md file covering project background, prerequisites, installation, and example commands.');
  } else if (!isComprehensiveReadme) {
    recommendations.push('Expand your README.md with architecture details, screenshots, and troubleshooting instructions.');
  }
  if (!hasTests) {
    recommendations.push('Add automated tests in a tests/ or test/ directory with sample unit test cases for core logic.');
  }
  if (!hasCi) {
    recommendations.push('Set up a GitHub Actions workflow in .github/workflows/ci.yml to run automated tests on pull requests.');
  }
  if (!hasLicense) {
    recommendations.push('Add an open-source LICENSE file (such as MIT or Apache 2.0) to clarify code usage permissions.');
  }
  if (!repoMeta.description) {
    recommendations.push('Add a concise description in the repository "About" settings to explain the project in 1-2 sentences.');
  }
  if (unassessedSkills.length > 0) {
    const topGap = unassessedSkills[0].skill;
    recommendations.push(`To strengthen career readiness for your target role, consider introducing ${topGap} into this codebase or creating a related extension.`);
  }

  return {
    targetType: 'repo',
    repoMeta,
    langList,
    readmeData,
    readmeText,
    hasReadme,
    hasTests,
    hasCi,
    hasLicense,
    detectedManifests,
    detectedSkills,
    possibleSkills,
    unassessedSkills,
    qualitySignals,
    recommendations,
  };
}

/**
 * Renders the GitHub portfolio view into the container element.
 *
 * @param {HTMLElement} container - Section container (`#github-view`)
 * @param {object} state - Current portfolio state `{ inputUrl, data, loading, error, curriculumReport }`
 * @param {object} callbacks - Actions `{ onSearch, onGoToOverview }`
 */
export function renderGitHubView(container, state, callbacks = {}) {
  if (!container) return;

  const { data = null, loading = false, error = null, curriculumReport = null } = state;
  const inputUrl = state.inputUrl || state.username || '';
  const currentRole = curriculumReport?.role ? esc(curriculumReport.role) : null;

  container.innerHTML = `
    <span class="tag">GITHUB PORTFOLIO · PUBLIC EVIDENCE AUDIT</span>
    <h2>Evidence beyond the résumé.</h2>
    <p>Analyze any public GitHub profile or repository URL to inspect observable technical evidence, documentation quality, test suites, and technology alignment with industry hiring demand.</p>

    <!-- Search / URL Form -->
    <div class="github-search-card">
      <form id="github-search-form" class="github-form" onsubmit="return false;">
        <div class="github-input-group">
          <span class="github-input-icon">⌘</span>
          <input
            type="text"
            id="github-username-input"
            placeholder="Enter public profile or repo URL (e.g. https://github.com/shathiya-7/Delta)..."
            value="${esc(inputUrl)}"
            aria-label="GitHub profile or repository URL"
            ${loading ? 'disabled' : ''}
          >
          <button type="submit" id="github-search-btn" class="primary-button github-btn" ${loading ? 'disabled' : ''}>
            ${loading ? 'Auditing evidence…' : 'Analyze portfolio <span>↗</span>'}
          </button>
        </div>
      </form>
      <div class="github-quick-examples">
        <span style="font-size: 11px; color: var(--text-muted);">Quick examples:</span>
        <button class="github-example-pill" data-example="https://github.com/shathiya-7/Delta">Delta (Repository)</button>
        <button class="github-example-pill" data-example="https://github.com/shathiya-7">shathiya-7 (Profile)</button>
        <button class="github-example-pill" data-example="https://github.com/octocat">octocat (Profile)</button>
      </div>
      <div class="github-rate-note">
        <small>ⓘ Public GitHub REST API · Unauthenticated rate limit: 60 requests/hour · No tokens or private repository access.</small>
      </div>
    </div>

    <!-- Feedback States -->
    ${
      loading
        ? `
        <div class="github-loading-state" role="status" aria-live="polite">
          <div class="spinner"></div>
          <p>Querying GitHub public profile and repository evidence for <strong>${esc(inputUrl)}</strong>…</p>
        </div>
      `
        : ''
    }

    ${
      error
        ? `
        <div class="github-error-box" role="alert">
          <strong>Analysis could not be completed:</strong>
          <p>${esc(error)}</p>
        </div>
      `
        : ''
    }

    <!-- Analysis Results -->
    ${
      !loading && !error && data
        ? renderAnalysisResults(data, currentRole, callbacks)
        : !loading && !error && !data
        ? `
        <div class="empty-state-box">
          <p style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">No GitHub profile audited yet</p>
          <p>Paste a public GitHub profile URL (e.g. <code>https://github.com/username</code>) or a specific repository URL (e.g. <code>https://github.com/username/repository</code>) above to verify documentation, testing, and skill evidence.</p>
        </div>
      `
        : ''
    }
  `;

  // Bind Form Submission
  const form = container.querySelector('#github-search-form');
  const input = container.querySelector('#github-username-input');

  const triggerSearch = url => {
    if (!url || !url.trim()) return;
    if (callbacks.onSearch) callbacks.onSearch(url.trim());
  };

  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (input) triggerSearch(input.value);
    });
  }

  // Bind Example Pills
  container.querySelectorAll('.github-example-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const exUrl = pill.dataset.example;
      if (input) input.value = exUrl;
      triggerSearch(exUrl);
    });
  });

  // Bind Go to Overview / Reset Actions
  const goOverviewBtn = container.querySelector('#github-go-overview');
  if (goOverviewBtn && callbacks.onGoToOverview) {
    goOverviewBtn.onclick = callbacks.onGoToOverview;
  }

  const resetBtn = container.querySelector('#github-reset-btn');
  if (resetBtn && callbacks.onReset) {
    resetBtn.onclick = callbacks.onReset;
  }

  container.hidden = false;
  container.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Renders the analysis results shell dispatching between profile and repo view.
 */
function renderAnalysisResults(data, currentRole, callbacks) {
  if (data.targetType === 'repo') {
    return renderRepoResults(data, currentRole, callbacks);
  }
  return renderProfileResults(data, currentRole, callbacks);
}

/**
 * Renders a comprehensive repository audit view.
 */
function renderRepoResults(data, currentRole, callbacks) {
  const repoMeta = data.repoMeta || {};
  const langList = Array.isArray(data.langList) ? data.langList : [];
  const readmeData = data.readmeData || null;
  const readmeText = data.readmeText || '';
  const detectedSkills = Array.isArray(data.detectedSkills) ? data.detectedSkills : [];
  const possibleSkills = Array.isArray(data.possibleSkills) ? data.possibleSkills : [];
  const unassessedSkills = Array.isArray(data.unassessedSkills) ? data.unassessedSkills : [];
  const qualitySignals = Array.isArray(data.qualitySignals) ? data.qualitySignals : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];

  const desc = repoMeta.description || 'No description provided in repository metadata.';
  const lastUpdate = repoMeta.pushed_at ? new Date(repoMeta.pushed_at).toLocaleDateString() : 'recently';

  return `
    <div class="github-results-shell">
      <!-- Repo Overview Header Card -->
      <div class="github-profile-card">
        <div class="file-icon" style="margin-bottom: 0; font-size: 26px;">📁</div>
        <div class="github-profile-meta">
          <div class="github-title-row">
            <h3>${esc(repoMeta.full_name || repoMeta.name)}</h3>
            <a href="${esc(repoMeta.html_url)}" target="_blank" rel="noopener noreferrer" class="github-profile-link">
              View on GitHub ↗
            </a>
          </div>
          <p class="github-bio">${esc(desc)}</p>
          <div class="github-stats-row">
            <span class="github-stat"><strong>★ ${repoMeta.stargazers_count || 0}</strong> stars</span>
            <span class="github-stat"><strong>⑂ ${repoMeta.forks_count || 0}</strong> forks</span>
            <span class="github-stat"><strong>☉ ${repoMeta.open_issues_count || 0}</strong> open issues</span>
            <span class="github-stat">Default branch: <code>${esc(repoMeta.default_branch || 'main')}</code></span>
            <span>Last push: ${esc(lastUpdate)}</span>
          </div>
        </div>
      </div>

      <!-- Evidence Limitations Alert -->
      <div class="coverage-explainer">
        <strong>Evidence Limitations:</strong> Public repository metrics, stars, and file presence are observational signals—they are not conclusive proof of code quality, architecture rigor, or runtime security. All assessments are derived directly from observable files and commits.
      </div>

      <!-- Project Quality Signals Grid -->
      <h3>Project Quality Signals</h3>
      <div class="quality-signals-grid">
        ${qualitySignals
          .map(
            q => `
          <div class="quality-signal-card signal-${q.status}">
            <div class="signal-header">
              <span class="signal-label">${esc(q.label)}</span>
              <span class="signal-badge badge-${q.status}">${q.status === 'pass' ? '✓ Verified' : q.status === 'fail' ? '✕ Missing' : 'ℹ Limited'}</span>
            </div>
            <strong class="signal-headline">${esc(q.headline)}</strong>
            <p class="signal-detail">${esc(q.detail)}</p>
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Language Breakdown -->
      <div class="chart-card">
        <div class="chart-header">
          <h4>Language Distribution (Repository Bytes)</h4>
        </div>
        ${
          langList.length > 0
            ? `
          <div class="github-lang-bars">
            ${langList
              .map(
                l => `
              <div class="github-lang-item">
                <div class="github-lang-info">
                  <strong>${esc(l.name)}</strong>
                  <span>${l.percent}% <small>(${(l.bytes / 1024).toFixed(1)} KB)</small></span>
                </div>
                <div class="chart-track">
                  <div class="chart-fill fill-covered" style="width: ${Math.max(5, l.percent)}%;">
                    ${l.percent >= 10 ? `${l.percent}%` : ''}
                  </div>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : '<p style="color:var(--text-muted); font-size:12px;">No language byte data reported by GitHub.</p>'
        }
      </div>

      <!-- Skills and Technology Evidence -->
      <div class="chart-card">
        <div class="chart-header">
          <h4>Skills & Technology Evidence</h4>
          ${currentRole ? `<span class="tag">CROSS-REFERENCED WITH ${currentRole.toUpperCase()}</span>` : ''}
        </div>
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:14px;">
          Technologies verified from repository configuration, code, and metadata:
        </p>
        <div class="skills-evidence-list">
          ${detectedSkills.map(s => `
            <div class="skill-evidence-row">
              <span class="status-badge badge-covered">✓ Detected</span>
              <strong>${esc(s.skill)}</strong>
              <span class="evidence-origin">${esc(s.evidence)}</span>
            </div>
          `).join('')}

          ${possibleSkills.map(s => `
            <div class="skill-evidence-row">
              <span class="status-badge badge-gap">? Possible</span>
              <strong>${esc(s.skill)}</strong>
              <span class="evidence-origin">${esc(s.evidence)}</span>
            </div>
          `).join('')}

          ${unassessedSkills.slice(0, 5).map(s => `
            <div class="skill-evidence-row">
              <span class="status-badge badge-priority" style="background:var(--surface-secondary); color:var(--text-muted); border: 1px solid var(--border-subtle);">- Not assessed</span>
              <strong>${esc(s.skill)}</strong>
              <span class="evidence-origin">${esc(s.evidence)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Safe README Excerpt Preview -->
      ${
        readmeData && readmeText
          ? `
        <details class="readme-details">
          <summary><strong>README Preview (${esc(readmeData.name)} · ${(readmeText.length / 1024).toFixed(1)} KB)</strong> ▾</summary>
          <pre class="readme-preview"><code>${esc(readmeText.slice(0, 3000))}${readmeText.length > 3000 ? '\n\n... [truncated for preview]' : ''}</code></pre>
        </details>
      `
          : ''
      }

      <!-- Actionable Recommendations -->
      ${
        recommendations.length > 0
          ? `
        <div class="roadmap-notice" style="margin-top: 22px;">
          <div class="notice-icon">💡</div>
          <div>
            <strong>Evidence-Based Recommendations for this Repository</strong>
            <ul style="margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--text-secondary); line-height: 1.8;">
              ${recommendations.map(r => `<li>${esc(r)}</li>`).join('')}
            </ul>
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}

/**
 * Renders a comprehensive public profile portfolio audit view.
 */
function renderProfileResults(data, currentRole, callbacks) {
  const profile = data.profile || {};
  const originalCount = Number(data.originalCount) || 0;
  const forkedCount = Number(data.forkedCount) || 0;
  const languages = Array.isArray(data.languages) ? data.languages : [];
  const topRepos = Array.isArray(data.topRepos) ? data.topRepos : [];
  const detectedSkills = Array.isArray(data.detectedSkills) ? data.detectedSkills : [];
  const possibleSkills = Array.isArray(data.possibleSkills) ? data.possibleSkills : [];
  const unassessedSkills = Array.isArray(data.unassessedSkills) ? data.unassessedSkills : [];
  const qualitySignals = Array.isArray(data.qualitySignals) ? data.qualitySignals : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];

  const nameDisplay = profile.name || profile.login;
  const bioDisplay = profile.bio ? `<p class="github-bio">${esc(profile.bio)}</p>` : '';
  const locationDisplay = profile.location ? `<span>📍 ${esc(profile.location)}</span>` : '';
  const reposCount = Number(profile.public_repos) || 0;
  const followersCount = Number(profile.followers) || 0;

  return `
    <div class="github-results-shell">
      <!-- Profile Summary Card -->
      <div class="github-profile-card">
        <img src="${esc(profile.avatar_url)}" alt="${esc(profile.login)}" class="github-avatar" loading="lazy">
        <div class="github-profile-meta">
          <div class="github-title-row">
            <h3>${esc(nameDisplay)}</h3>
            <a href="${esc(profile.html_url)}" target="_blank" rel="noopener noreferrer" class="github-profile-link">
              @${esc(profile.login)} ↗
            </a>
          </div>
          ${bioDisplay}
          <div class="github-stats-row">
            <span class="github-stat"><strong>${reposCount}</strong> public repos (${originalCount} original, ${forkedCount} forks)</span>
            <span class="github-stat"><strong>${followersCount}</strong> followers</span>
            ${locationDisplay}
          </div>
        </div>
      </div>

      <!-- Evidence Limitations Alert -->
      <div class="coverage-explainer">
        <strong>Evidence Limitations:</strong> Profile overview metrics summarize public repositories only. They reflect open-source and coursework activity—they are not proof of closed-source experience or total capability.
      </div>

      <!-- Project Quality Signals -->
      <h3>Portfolio Quality Signals</h3>
      <div class="quality-signals-grid">
        ${qualitySignals
          .map(
            q => `
          <div class="quality-signal-card signal-${q.status}">
            <div class="signal-header">
              <span class="signal-label">${esc(q.label)}</span>
              <span class="signal-badge badge-${q.status}">${q.status === 'pass' ? '✓ Verified' : q.status === 'caution' ? '⚠ Caution' : 'ℹ Limited'}</span>
            </div>
            <strong class="signal-headline">${esc(q.headline)}</strong>
            <p class="signal-detail">${esc(q.detail)}</p>
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Languages / Tech Stack Breakdown -->
      <div class="chart-card">
        <div class="chart-header">
          <h4>Public repository language distribution (${languages.length} detected)</h4>
        </div>
        ${
          languages.length > 0
            ? `
          <div class="github-lang-bars">
            ${languages
              .slice(0, 8)
              .map(
                l => `
              <div class="github-lang-item">
                <div class="github-lang-info">
                  <strong>${esc(l.name)}</strong>
                  <span>${l.percent}% <small>(${l.count} ${l.count === 1 ? 'repo' : 'repos'})</small></span>
                </div>
                <div class="chart-track">
                  <div class="chart-fill fill-covered" style="width: ${Math.max(6, l.percent)}%;">
                    ${l.percent >= 12 ? `${l.percent}%` : ''}
                  </div>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : '<p style="color:var(--text-muted); font-size:12px;">No primary programming languages detected across public source repositories.</p>'
        }
      </div>

      <!-- Skills and Technology Evidence -->
      <div class="chart-card">
        <div class="chart-header">
          <h4>Skills & Technology Evidence</h4>
          ${currentRole ? `<span class="tag">TARGET ROLE: ${currentRole.toUpperCase()}</span>` : ''}
        </div>
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:14px;">
          Categorized according to observable public GitHub evidence:
        </p>
        <div class="skills-evidence-list">
          ${detectedSkills.slice(0, 6).map(s => `
            <div class="skill-evidence-row">
              <span class="status-badge badge-covered">✓ Detected</span>
              <strong>${esc(s.skill)}</strong>
              <span class="evidence-origin">${esc(s.evidence)}</span>
            </div>
          `).join('')}

          ${possibleSkills.slice(0, 6).map(s => `
            <div class="skill-evidence-row">
              <span class="status-badge badge-gap">? Possible</span>
              <strong>${esc(s.skill)}</strong>
              <span class="evidence-origin">${esc(s.evidence)}</span>
            </div>
          `).join('')}

          ${unassessedSkills.slice(0, 4).map(s => `
            <div class="skill-evidence-row">
              <span class="status-badge badge-priority" style="background:var(--surface-secondary); color:var(--text-muted); border: 1px solid var(--border-subtle);">- Not assessed</span>
              <strong>${esc(s.skill)}</strong>
              <span class="evidence-origin">${esc(s.evidence)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Top Repositories Grid -->
      <h3>Top Public Repositories (${topRepos.length})</h3>
      <div class="github-repos-grid">
        ${
          topRepos.length > 0
            ? topRepos
                .map(
                  r => `
          <article class="github-repo-card">
            <div class="repo-card-top">
              <a href="${esc(r.html_url)}" target="_blank" rel="noopener noreferrer" class="repo-name">
                ${esc(r.name)} ↗
              </a>
              ${r.fork ? '<span class="status-badge" style="background:#f0f2eb; color:#68765f;">Fork</span>' : ''}
            </div>
            <p class="repo-desc">${esc(r.description || 'No description provided.')}</p>
            <div class="repo-card-footer">
              ${r.language ? `<span class="repo-lang-dot"></span><span>${esc(r.language)}</span>` : '<span>Text</span>'}
              <span>★ ${r.stargazers_count || 0}</span>
              <span>Updated ${new Date(r.updated_at).toLocaleDateString()}</span>
            </div>
          </article>
        `
                )
                .join('')
            : '<p>No public repositories found for this account.</p>'
        }
      </div>

      <!-- Recommendations -->
      ${
        recommendations.length > 0
          ? `
        <div class="roadmap-notice" style="margin-top: 24px;">
          <div class="notice-icon">💡</div>
          <div>
            <strong>Portfolio Readiness Recommendations</strong>
            <ul style="margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #4b5844; line-height: 1.8;">
              ${recommendations.map(rec => `<li>${esc(rec)}</li>`).join('')}
            </ul>
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}
