const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCheck,
  summarizeChecks,
  requiredCheckState,
  monitorNexusPr,
} = require('../src/nexusCheckMonitor');

test('classifies GitHub check states without treating skipped as a failure', () => {
  assert.equal(classifyCheck({ status: 'queued', conclusion: null }), 'queued');
  assert.equal(classifyCheck({ status: 'in_progress', conclusion: null }), 'in_progress');
  assert.equal(classifyCheck({ status: 'completed', conclusion: 'success' }), 'successful');
  assert.equal(classifyCheck({ status: 'completed', conclusion: 'skipped' }), 'skipped');
  assert.equal(classifyCheck({ status: 'completed', conclusion: 'failure' }), 'failing');
});

test('summarizes the exact check population', () => {
  const result = summarizeChecks([
    { id: 1, name: 'ok', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'bad', status: 'completed', conclusion: 'failure' },
    { id: 3, name: 'running', status: 'in_progress', conclusion: null },
    { id: 4, name: 'waiting', status: 'queued', conclusion: null },
    { id: 5, name: 'skip', status: 'completed', conclusion: 'skipped' },
  ]);
  assert.deepEqual(result.counts, {
    failing: 1,
    in_progress: 1,
    queued: 1,
    skipped: 1,
    successful: 1,
  });
});

test('tracks configured required checks separately from general check health', () => {
  const checks = [
    { name: 'Required A', status: 'completed', conclusion: 'success' },
    { name: 'Required B', status: 'completed', conclusion: 'failure' },
    { name: 'Required C', status: 'in_progress', conclusion: null },
  ];
  assert.deepEqual(requiredCheckState(checks, ['Required A', 'Required B', 'Required C', 'Missing']), {
    configured: true,
    unknown: ['Missing'],
    failing: ['Required B'],
    pending: ['Required C'],
    successful: ['Required A'],
  });
});

test('monitors a pull request and reports merge blockers from real GitHub responses', async () => {
  const responses = {
    '/pulls/136': {
      number: 136,
      title: 'Development branch',
      state: 'open',
      draft: false,
      html_url: 'https://github.com/example/Nexus-/pull/136',
      mergeable: true,
      mergeable_state: 'blocked',
      base: { ref: 'main', sha: 'base-sha' },
      head: { ref: 'Development-branch', sha: 'head-sha' },
    },
    '/commits/head-sha/check-runs?per_page=100': {
      total_count: 3,
      check_runs: [
        { id: 1, name: 'Failing check', status: 'completed', conclusion: 'failure', html_url: 'https://example/fail' },
        { id: 2, name: 'Queued check', status: 'queued', conclusion: null, html_url: 'https://example/queued' },
        { id: 3, name: 'Successful check', status: 'completed', conclusion: 'success', html_url: 'https://example/success' },
      ],
    },
  };
  const fetchImpl = async (url) => {
    const key = new URL(url).pathname + (new URL(url).search || '');
    const body = responses[key];
    if (!body) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const report = await monitorNexusPr({ fetchImpl, repository: 'example/Nexus-', prNumber: '136' });
  assert.equal(report.healthy, false);
  assert.deepEqual(report.blockers, ['failing-checks', 'checks-pending', 'github-mergeable-state-blocked']);
  assert.equal(report.checks.total, 3);
});
