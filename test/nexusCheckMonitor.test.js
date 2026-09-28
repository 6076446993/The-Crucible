const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCheck,
  summarizeChecks,
  requiredCheckState,
  isLockedPullRequest,
  monitorConfiguredRepositories,
  waitForPullRequestChecks,
} = require('../src/nexusCheckMonitor');

test('classifies GitHub check states without treating skipped as a failure', () => {
  assert.equal(classifyCheck({ status:'queued', conclusion:null }), 'queued');
  assert.equal(classifyCheck({ status:'in_progress', conclusion:null }), 'in_progress');
  assert.equal(classifyCheck({ status:'completed', conclusion:'success' }), 'successful');
  assert.equal(classifyCheck({ status:'completed', conclusion:'skipped' }), 'skipped');
  assert.equal(classifyCheck({ status:'completed', conclusion:'failure' }), 'failing');
});

test('summarizes the exact check population', () => {
  const result = summarizeChecks([
    { id:1, name:'ok', status:'completed', conclusion:'success' },
    { id:2, name:'bad', status:'completed', conclusion:'failure' },
    { id:3, name:'running', status:'in_progress', conclusion:null },
    { id:4, name:'waiting', status:'queued', conclusion:null },
    { id:5, name:'skip', status:'completed', conclusion:'skipped' },
  ]);
  assert.deepEqual(result.counts, { failing:1, in_progress:1, queued:1, skipped:1, successful:1 });
});

test('tracks configured required checks separately from general check health', () => {
  const checks = [
    { name:'Required A', status:'completed', conclusion:'success' },
    { name:'Required B', status:'completed', conclusion:'failure' },
    { name:'Required C', status:'in_progress', conclusion:null },
  ];
  assert.deepEqual(requiredCheckState(checks, ['Required A','Required B','Required C','Missing']), {
    configured:true,
    unknown:['Missing'],
    failing:['Required B'],
    pending:['Required C'],
    successful:['Required A'],
  });
});

test('recognizes an explicitly locked PR and never treats it as writable', () => {
  assert.equal(isLockedPullRequest({
    number:11,
    title:'[LOCKED — DO NOT MERGE] Permanent CI-monitoring event hook',
    body:'Standing monitoring PR.',
  }, []), true);
  assert.equal(isLockedPullRequest({ number:99, title:'ordinary PR', body:'normal work' }, [99]), true);
  assert.equal(isLockedPullRequest({ number:100, title:'ordinary PR', body:'normal work' }, []), false);
});

test('monitors every configured repository and paginates open PRs and checks', async () => {
  const calls = [];
  const responses = new Map([
    ['https://api.github.com/repos/example/one/pulls?state=open&per_page=100&page=1', [
      { number:1, title:'one', state:'open', draft:false, html_url:'https://example/one/1', mergeable:true, mergeable_state:'clean', base:{ref:'main',sha:'base'}, head:{ref:'work',sha:'head-1'} },
      { number:2, title:'[LOCKED — DO NOT MERGE] monitor', body:'standing hook', state:'open', draft:true, html_url:'https://example/one/2', mergeable:false, mergeable_state:'blocked', base:{ref:'main',sha:'base'}, head:{ref:'locked',sha:'head-2'} },
    ]],
    ['https://api.github.com/repos/example/one/commits/head-1/check-runs?per_page=100&page=1', {
      check_runs:[{id:1,name:'ok',status:'completed',conclusion:'success',html_url:'https://example/ok'}],
    }],
    ['https://api.github.com/repos/example/one/commits/head-2/check-runs?per_page=100&page=1', {
      check_runs:[{id:2,name:'bad',status:'completed',conclusion:'failure',html_url:'https://example/bad'}],
    }],
    ['https://api.github.com/repos/example/two/pulls?state=open&per_page=100&page=1', []],
  ]);
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = responses.get(url);
    if (body === undefined) return new Response(JSON.stringify({message:'not found'}), {status:404});
    return new Response(JSON.stringify(body), {status:200});
  };
  const report = await monitorConfiguredRepositories({
    fetchImpl,
    token:'test-token',
    config:{schemaVersion:1,repositories:[
      {name:'example/one',enabled:true},
      {name:'example/two',enabled:true},
    ]},
  });
  assert.equal(report.monitoredRepositoryCount, 2);
  assert.equal(report.openPullRequestCount, 2);
  assert.equal(report.lockedPullRequestCount, 1);
  assert.equal(report.repositories[0].pullRequests[1].interactionPolicy, 'LOCKED_READ_ONLY');
  assert.equal(report.repositories[0].pullRequests[1].locked, true);
  assert.deepEqual(report.repositories[0].pullRequests[1].blockers, ['failing-checks','github-mergeable-state-blocked']);
  assert.equal(report.repositories[0].pullRequests[0].healthy, true);
  assert.ok(calls.some((url) => url.includes('/pulls?state=open')));
});

test('excludes the monitor check itself so a PR cannot become blocked by its own in-progress observation', async () => {
  const responses = new Map([
    ['https://api.github.com/repos/example/one/pulls?state=open&per_page=100&page=1', [
      { number:1, title:'one', state:'open', draft:false, html_url:'https://example/one/1', mergeable:true, mergeable_state:'clean', base:{ref:'main',sha:'base'}, head:{ref:'work',sha:'head'} },
    ]],
    ['https://api.github.com/repos/example/one/commits/head/check-runs?per_page=100&page=1', {
      check_runs:[
        {id:1,name:'Monitor all Crucible-monitored PRs',status:'in_progress',conclusion:null},
        {id:2,name:'The Crucible',status:'completed',conclusion:'success'},
      ],
    }],
  ]);
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.authorization, 'Bearer workflow-token');
    return new Response(JSON.stringify(responses.get(url) || {message:'not found'}), {status:responses.has(url) ? 200 : 404});
  };
  const report = await monitorConfiguredRepositories({
    fetchImpl, token:'workflow-token',
    config:{schemaVersion:1,repositories:[{name:'example/one',enabled:true}]},
  });
  assert.equal(report.repositories[0].pullRequests[0].checks.total, 1);
  assert.equal(report.repositories[0].pullRequests[0].healthy, true);
});


test('waits for non-monitor checks to settle while ignoring the required block gate', async () => {
  let first = true;
  const fetchImpl = async () => {
    const checkRuns = first ? [{id:1,name:'The Crucible',status:'in_progress',conclusion:null},{id:2,name:'block',status:'in_progress',conclusion:null}] : [{id:1,name:'The Crucible',status:'completed',conclusion:'success'},{id:2,name:'block',status:'in_progress',conclusion:null},{id:3,name:'Monitor all Crucible-monitored PRs',status:'in_progress',conclusion:null}];
    first = false;
    return new Response(JSON.stringify({check_runs:checkRuns}), {status:200});
  };
  const result = await waitForPullRequestChecks({fetchImpl,token:'workflow-token',repository:'example/one',sha:'head',timeoutMs:100,pollMs:1,settleMs:0});
  assert.equal(result.state,'settled');
  assert.equal(result.checks.some((check) => check.name === 'block'),false);
  assert.equal(result.checks.some((check) => check.name === 'Monitor all Crucible-monitored PRs'),false);
});
