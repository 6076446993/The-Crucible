const fs = require('node:fs');
const path = require('node:path');

const { readAuthorization, executeAuthorizedRepair } = require('./authorizedPrRepair');
const { crucibleError } = require('./failureCodes');

const DEFAULT_CONFIG = path.resolve(process.env.CRUCIBLE_MONITOR_CONFIG || 'governingDocuments/crucible-monitored-repositories.json');
const FAILURE_CONCLUSIONS = new Set(['failure','cancelled','timed_out','action_required','startup_failure','stale']);
const defaultFetch = (...args) => globalThis.fetch(...args);

function requireValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw crucibleError('CRU-0051', `${name} is required.`);
  return value.trim();
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function githubGet(fetchImpl, url, token) {
  if (typeof fetchImpl !== 'function') throw crucibleError('CRU-0051', 'A fetch implementation is required for Crucible PR monitoring.');
  const response = await fetchImpl(url, { headers: githubHeaders(token) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(`GitHub GET ${url} failed with HTTP ${response.status}: ${body.message || text}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function githubGetAll(fetchImpl, url, token, pageSize = 100) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const batch = await githubGet(fetchImpl, `${url}${separator}per_page=${pageSize}&page=${page}`, token);
    if (!Array.isArray(batch)) throw crucibleError('CRU-0051', `GitHub collection endpoint did not return an array: ${url}`);
    items.push(...batch);
    if (batch.length < pageSize) return items;
  }
}

function classifyCheck(check) {
  if (check.status !== 'completed') return check.status === 'queued' ? 'queued' : 'in_progress';
  if (check.conclusion === 'success') return 'successful';
  if (check.conclusion === 'skipped') return 'skipped';
  if (FAILURE_CONCLUSIONS.has(check.conclusion)) return 'failing';
  return 'failing';
}

function summarizeChecks(checkRuns) {
  const counts = { failing:0, in_progress:0, queued:0, skipped:0, successful:0 };
  const groups = { failing:[], in_progress:[], queued:[], skipped:[], successful:[] };
  for (const check of checkRuns) {
    const state = classifyCheck(check);
    counts[state] += 1;
    groups[state].push({
      name: check.name,
      conclusion: check.conclusion,
      status: check.status,
      detailsUrl: check.details_url || check.html_url || null,
      id: check.id,
    });
  }
  return { counts, groups };
}

function normalizeRequiredNames(value) {
  if (Array.isArray(value)) return value.map(String).map((name) => name.trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map((name) => name.trim()).filter(Boolean);
}

function requiredCheckState(checkRuns, requiredNames) {
  if (!requiredNames.length) return { configured:false, unknown:[], failing:[], pending:[], successful:[] };
  const result = { configured:true, unknown:[], failing:[], pending:[], successful:[] };
  const byName = new Map(checkRuns.map((check) => [check.name, check]));
  for (const name of requiredNames) {
    const check = byName.get(name);
    if (!check) { result.unknown.push(name); continue; }
    const state = classifyCheck(check);
    if (state === 'successful' || state === 'skipped') result.successful.push(name);
    else if (state === 'failing') result.failing.push(name);
    else result.pending.push(name);
  }
  return result;
}

function isLockedPullRequest(pr, configuredNumbers = []) {
  if (configuredNumbers.map(Number).includes(Number(pr.number))) return true;
  const title = String(pr.title || '');
  const body = String(pr.body || '');
  if (/\[\s*LOCKED\b/i.test(title) && /\bDO NOT MERGE\b/i.test(title)) return true;
  if (/\bLOCKED\b/i.test(title) && /\bDO NOT MERGE\b/i.test(body)) return true;
  return false;
}

function loadMonitorConfig(configPath = DEFAULT_CONFIG, readFile = fs.readFileSync) {
  if (!readFile(configPath, 'utf8')) throw crucibleError('CRU-0051', `Unable to read Crucible monitor configuration: ${configPath}`);
  const config = JSON.parse(readFile(configPath, 'utf8'));
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.repositories)) {
    throw crucibleError('CRU-0051', 'Crucible monitor configuration must use schemaVersion 1 and a repositories array.');
  }
  const repositories = config.repositories.filter((entry) => entry && entry.enabled !== false);
  if (!repositories.length) throw crucibleError('CRU-0051', 'Crucible monitor configuration contains no enabled repositories.');
  const names = new Set();
  for (const entry of repositories) {
    requireValue(entry.name, 'monitored repository name');
    if (names.has(entry.name.toLowerCase())) throw crucibleError('CRU-0051', `Duplicate monitored repository: ${entry.name}`);
    names.add(entry.name.toLowerCase());
    if (entry.lockedPullRequests !== undefined && !Array.isArray(entry.lockedPullRequests)) {
      throw crucibleError('CRU-0051', `lockedPullRequests for ${entry.name} must be an array.`);
    }
  }
  return { ...config, repositories };
}

async function githubGetCheckRuns(fetchImpl, repository, sha, token) {
  const checkRuns = [];
  for (let page = 1; ; page += 1) {
    const body = await githubGet(fetchImpl, `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100&page=${page}`, token);
    if (!body || !Array.isArray(body.check_runs)) throw crucibleError('CRU-0051', `GitHub check-runs endpoint did not return check_runs: ${repository} ${sha}`);
    checkRuns.push(...body.check_runs);
    if (body.check_runs.length < 100) return checkRuns;
  }
}

function failureCodeFromCheck(check) {
  const text = [check.name, check.output?.title, check.output?.summary, check.output?.text]
    .filter(Boolean)
    .join("\n");
  return (text.match(/\bCRU-\d{4}\b/) || [])[0] || null;
}

async function monitorPullRequest({
  fetchImpl,
  token,
  repository,
  pr,
  requiredChecks = [],
  lockedPullRequests = [],
  repairEnabled = false,
  repairAuthorization = null,
  repairRoot = process.cwd(),
} = {}) {
  const checkRuns = await githubGetCheckRuns(fetchImpl, repository, pr.head.sha, token);
  const summary = summarizeChecks(checkRuns);
  const required = requiredCheckState(checkRuns, requiredChecks);
  const locked = isLockedPullRequest(pr, lockedPullRequests);
  const blockers = [];
  const repairEvidence = [];

  if (summary.counts.failing) blockers.push('failing-checks');
  if (summary.counts.in_progress || summary.counts.queued) blockers.push('checks-pending');
  if (pr.mergeable_state === 'blocked') blockers.push('github-mergeable-state-blocked');
  if (required.failing.length) blockers.push('configured-required-check-failing');
  if (required.pending.length || required.unknown.length) blockers.push('configured-required-check-not-green');

  if (repairEnabled && !locked && summary.counts.failing && repairAuthorization) {
    const { describeCode } = require('./failureCodes');
    for (const check of checkRuns.filter((item) => classifyCheck(item) === 'failing')) {
      const code = failureCodeFromCheck(check);
      if (!code) continue;
      const definition = describeCode(code);
      if (!definition) continue;
      try {
        const result = await executeAuthorizedRepair({
          repository,
          pullRequest: pr.number,
          headSha: pr.head.sha,
          branch: pr.head.ref,
          failure: {
            locked: false,
            code,
            remedy: definition.remedy,
            finding: {
              checkName: check.name,
              conclusion: check.conclusion,
              status: check.status,
              detailsUrl: check.details_url || check.html_url || null,
              output: check.output || null,
            },
          },
          authorization: repairAuthorization,
          token,
          root: repairRoot,
          fetchImpl,
        });
        repairEvidence.push({ code, check: check.name, result });
      } catch (error) {
        repairEvidence.push({ code, check: check.name, result: { state: 'blocked', reason: error.message } });
      }
    }
  }

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    base: pr.base.ref,
    baseSha: pr.base.sha,
    head: pr.head.ref,
    headSha: pr.head.sha,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    url: pr.html_url,
    interactionPolicy: locked ? 'LOCKED_READ_ONLY' : 'MONITORED',
    locked,
    checks: { total: checkRuns.length, ...summary },
    required,
    blockers,
    healthy: blockers.length === 0,
    repairEvidence,
    evidence: {
      pullRequestApi: `https://api.github.com/repos/${repository}/pulls/${pr.number}`,
      checkRunApi: `https://api.github.com/repos/${repository}/commits/${pr.head.sha}/check-runs`,
    },
  };
}

async function monitorRepository({ fetchImpl = defaultFetch, token = process.env.CRUCIBLE_SECURITY_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '', repository, requiredChecks = [], lockedPullRequests = [], repairEnabled = false, repairAuthorization = null, repairRoot = process.cwd() }) {
  requireValue(repository, 'repository');
  const prs = await githubGetAll(fetchImpl, `https://api.github.com/repos/${repository}/pulls?state=open`, token);
  const pullRequests = [];
  for (const pr of prs) pullRequests.push(await monitorPullRequest({ fetchImpl, token, repository, pr, requiredChecks, lockedPullRequests, repairEnabled, repairAuthorization, repairRoot }));
  const blockers = pullRequests.flatMap((pr) => pr.blockers.map((blocker) => ({ pullRequest:pr.number, blocker, locked:pr.locked })));
  return {
    repository,
    openPullRequests:pullRequests.length,
    lockedPullRequests:pullRequests.filter((pr) => pr.locked).map((pr) => pr.number),
    pullRequests,
    blockers,
    healthy:blockers.length === 0,
  };
}

async function monitorConfiguredRepositories({
  fetchImpl = defaultFetch,
  token = process.env.GITHUB_TOKEN || process.env.CRUCIBLE_SECURITY_READ_TOKEN || process.env.GH_TOKEN || '',
  config = loadMonitorConfig(),
  requiredChecks = normalizeRequiredNames(process.env.NEXUS_MONITOR_REQUIRED_CHECKS || ''),
  repairEnabled = process.env.CRUCIBLE_REPAIR_ENABLED === 'true',
  repairAuthorization = null,
  repairRoot = process.cwd(),
} = {}) {
  if (repairEnabled && repairAuthorization == null) {
    const authorizationFile = process.env.CRUCIBLE_REPAIR_AUTHORIZATION_FILE || 'governingDocuments/active-repair-authorization.json';
    if (fs.existsSync(authorizationFile)) repairAuthorization = readAuthorization(authorizationFile);
  }
  const repositories = [];
  for (const entry of config.repositories) {
    repositories.push(await monitorRepository({
      fetchImpl,
      token,
      repository:entry.name,
      requiredChecks,
      lockedPullRequests:entry.lockedPullRequests || [],
      repairEnabled,
      repairAuthorization,
      repairRoot,
    }));
  }
  const blockers = repositories.flatMap((repo) => repo.blockers.map((blocker) => ({ repository:repo.repository, ...blocker })));
  return {
    schemaVersion:2,
    observedAt:new Date().toISOString(),
    monitoredRepositoryCount:repositories.length,
    openPullRequestCount:repositories.reduce((sum, repo) => sum + repo.openPullRequests, 0),
    lockedPullRequestCount:repositories.reduce((sum, repo) => sum + repo.lockedPullRequests.length, 0),
    repositories,
    blockers,
    healthy:blockers.length === 0,
    interactionPolicy:{
      locked:'LOCKED_READ_ONLY',
      unlocked:'MONITORED',
      mutationAuthority:'NONE',
    },
  };
}

function formatReport(report) {
  const lines = [`Crucible PR monitor — ${report.monitoredRepositoryCount} repositories, ${report.openPullRequestCount} open PRs, ${report.lockedPullRequestCount} locked PRs.`];
  for (const repo of report.repositories) {
    lines.push(`- ${repo.repository}: ${repo.openPullRequests} open, ${repo.lockedPullRequests.length} locked.`);
    for (const pr of repo.pullRequests) {
      const c = pr.checks.counts;
      lines.push(`  - PR #${pr.number} [${pr.interactionPolicy}] ${pr.healthy ? 'healthy' : 'blocked'} — ${c.successful} successful, ${c.failing} failing, ${c.in_progress} in progress, ${c.queued} queued, ${c.skipped} skipped.`);
    }
  }
  return lines.join('\n');
}

if (require.main === module) {
  monitorConfiguredRepositories()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write(`\n${formatReport(report)}\n`);
    })
    .catch((error) => {
      const failure = {
        schemaVersion: 2,
        observedAt: new Date().toISOString(),
        monitoredRepositoryCount: 0,
        openPullRequestCount: 0,
        lockedPullRequestCount: 0,
        repositories: [],
        blockers: [{ blocker: 'monitor-execution-failed', errorCode: error.code || 'CRU-0051', reason: error.message }],
        healthy: false,
        interactionPolicy: { locked: 'LOCKED_READ_ONLY', unlocked: 'MONITORED', mutationAuthority: 'NONE' },
      };
      process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
      process.stderr.write(`[The Crucible] PR monitor failed closed: ${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  failureCodeFromCheck,
  classifyCheck,
  summarizeChecks,
  requiredCheckState,
  isLockedPullRequest,
  loadMonitorConfig,
  githubGetCheckRuns,
  monitorPullRequest,
  monitorRepository,
  monitorConfiguredRepositories,
  formatReport,
};
