const DEFAULT_REPOSITORY = 'jonathanblunt1214-lgtm/Nexus-';
const DEFAULT_PR = '136';

const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

function requireValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
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

function classifyCheck(check) {
  if (check.status !== 'completed') return check.status === 'queued' ? 'queued' : 'in_progress';
  if (check.conclusion === 'success') return 'successful';
  if (check.conclusion === 'skipped') return 'skipped';
  if (FAILURE_CONCLUSIONS.has(check.conclusion)) return 'failing';
  return 'failing';
}

function summarizeChecks(checkRuns) {
  const counts = { failing: 0, in_progress: 0, queued: 0, skipped: 0, successful: 0 };
  const groups = { failing: [], in_progress: [], queued: [], skipped: [], successful: [] };
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
  if (!value) return [];
  return value.split(',').map((name) => name.trim()).filter(Boolean);
}

function requiredCheckState(checkRuns, requiredNames) {
  if (!requiredNames.length) return { configured: false, unknown: [], failing: [], pending: [], successful: [] };
  const result = { configured: true, unknown: [], failing: [], pending: [], successful: [] };
  const byName = new Map(checkRuns.map((check) => [check.name, check]));
  for (const name of requiredNames) {
    const check = byName.get(name);
    if (!check) {
      result.unknown.push(name);
      continue;
    }
    const state = classifyCheck(check);
    if (state === 'successful' || state === 'skipped') result.successful.push(name);
    else if (state === 'failing') result.failing.push(name);
    else result.pending.push(name);
  }
  return result;
}

async function monitorNexusPr({
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
  repository = process.env.NEXUS_MONITOR_REPOSITORY || DEFAULT_REPOSITORY,
  prNumber = process.env.NEXUS_MONITOR_PR || DEFAULT_PR,
  requiredChecks = process.env.NEXUS_MONITOR_REQUIRED_CHECKS || '',
}) {
  requireValue(repository, 'repository');
  requireValue(String(prNumber), 'prNumber');

  const apiRoot = 'https://api.github.com';
  const pr = await githubGet(fetchImpl, `${apiRoot}/repos/${repository}/pulls/${encodeURIComponent(prNumber)}`, token);
  const checks = await githubGet(
    fetchImpl,
    `${apiRoot}/repos/${repository}/commits/${pr.head.sha}/check-runs?per_page=100`,
    token,
  );

  const summary = summarizeChecks(checks.check_runs || []);
  const required = requiredCheckState(checks.check_runs || [], normalizeRequiredNames(requiredChecks));
  const blockers = [];

  if (summary.counts.failing) blockers.push('failing-checks');
  if (summary.counts.in_progress || summary.counts.queued) blockers.push('checks-pending');
  if (pr.mergeable_state === 'blocked') blockers.push('github-mergeable-state-blocked');
  if (required.failing.length) blockers.push('configured-required-check-failing');
  if (required.pending.length || required.unknown.length) blockers.push('configured-required-check-not-green');

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    repository,
    pullRequest: {
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
    },
    checks: {
      total: checks.total_count || (checks.check_runs || []).length,
      ...summary,
    },
    required,
    blockers,
    healthy: blockers.length === 0 && pr.state === 'open',
    evidence: {
      checkRunApi: `${apiRoot}/repos/${repository}/commits/${pr.head.sha}/check-runs`,
      pullRequestApi: `${apiRoot}/repos/${repository}/pulls/${pr.number}`,
    },
  };
}

function formatReport(report) {
  const lines = [
    `Nexus PR #${report.pullRequest.number} monitor — ${report.pullRequest.headSha}`,
    `Mergeable: ${report.pullRequest.mergeable} (${report.pullRequest.mergeableState})`,
    `Checks: ${report.checks.counts.successful} successful, ${report.checks.counts.failing} failing, ${report.checks.counts.in_progress} in progress, ${report.checks.counts.queued} queued, ${report.checks.counts.skipped} skipped.`,
  ];
  if (report.blockers.length) lines.push(`Blockers: ${report.blockers.join(', ')}`);
  for (const state of ['failing', 'in_progress', 'queued']) {
    for (const check of report.checks.groups[state]) {
      lines.push(`- [${state}] ${check.name}${check.conclusion ? ` (${check.conclusion})` : ''} — ${check.detailsUrl || 'no details URL'}`);
    }
  }
  if (report.required.configured) {
    lines.push(`Configured required checks: ${report.required.successful.length} green, ${report.required.failing.length} failing, ${report.required.pending.length} pending, ${report.required.unknown.length} unknown.`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  monitorNexusPr()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`\n${formatReport(report)}\n`);
      if (!report.healthy) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`[The Crucible] Nexus CI monitor failed closed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  classifyCheck,
  summarizeChecks,
  requiredCheckState,
  monitorNexusPr,
  formatReport,
};
