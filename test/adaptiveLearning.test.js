const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OutcomeStore, learningPolicyCandidate, LearningPolicyStore } = require('../src/adaptiveLearning');
const { DurableScientificLearningStore } = require('../src/scientificLearning');

test('repair and prevention outcomes are durable evidence, not CRU classifications', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-outcomes-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new OutcomeStore(root, 'the-crucible');
  store.record({
    projectId:'the-crucible', outcomeId:'o-1', lifecycle:'prevention', outcome:'prevented',
    failureCode:'CRU-0008', preventionRuleId:'prevent-CRU-0008-v1', knowledgeVersion:1,
    changedPaths:['.github/workflows/release.yml'], completedChecks:[],
    expected:'workflow-lint required before execution', actual:'preflight prevented execution until workflow-lint', observedAt:'2026-09-29T17:10:00.000Z',
  });
  store.record({
    projectId:'the-crucible', outcomeId:'o-2', lifecycle:'repair', outcome:'repair-succeeded',
    failureCode:'CRU-0008', repairCandidateId:'repair-1', changedPaths:['.github/workflows/release.yml'], completedChecks:['workflow-lint'],
    expected:'repair restores valid workflow', actual:'workflow-lint passes after repair', observedAt:'2026-09-29T17:11:00.000Z',
  });
  store.record({
    projectId:'the-crucible', outcomeId:'o-3', lifecycle:'prevention', outcome:'triggered',
    failureCode:'CRU-0008', preventionRuleId:'prevent-CRU-0008-v1', knowledgeVersion:1,
    changedPaths:['.github/workflows/release.yml'], completedChecks:[],
    expected:'prevention evaluates precursor', actual:'prevention triggered', observedAt:'2026-09-29T17:11:30.000Z',
  });
  assert.equal(store.read().outcomes.length, 3);
  assert.equal(store.read().outcomes[0].outcome, 'prevented');
});

test('measured outcome improvement can propose but never directly activate a learning-policy change', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-meta-learning-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const candidate = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow failure learning',
    currentStrategy:'repair-only analysis', proposedStrategy:'repair plus precursor-outcome analysis',
    metricName:'bounded prevention detection rate', baseline:0.5, proposed:0.8,
    evidenceOutcomeIds:['o-1','o-2','o-3'], claimBoundary:'CRU-0008 within .github/workflows/',
    observedAt:'2026-09-29T17:12:00.000Z',
  });
  const learning = new DurableScientificLearningStore({ root, projectId:'the-crucible' });
  const record = learning.ingest(candidate);
  assert.equal(record.state, 'candidate');
  assert.equal(record.candidate.kind, 'learning-policy-candidate');
  assert.equal(learning.activeKnowledge().length, 0);
  assert.throws(() => learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow failure learning',
    currentStrategy:'current', proposedStrategy:'worse', metricName:'detection', baseline:0.8, proposed:0.7,
    evidenceOutcomeIds:['o-1','o-2','o-3'], claimBoundary:'workflow-only',
  }), /measured improvement/);
});


test('lower-is-better metrics and minimum distinct evidence are enforced', () => {
  const candidate = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'repair efficiency', currentStrategy:'slow', proposedStrategy:'faster',
    metricName:'mean repair latency', metricDirection:'minimize', baseline:12, proposed:8,
    evidenceOutcomeIds:['a','b','c'], claimBoundary:'internal repair',
  });
  assert.equal(candidate.kind, 'learning-policy-candidate');
  assert.throws(() => learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'repair efficiency', currentStrategy:'slow', proposedStrategy:'unsupported',
    metricName:'mean repair latency', metricDirection:'minimize', baseline:12, proposed:8,
    evidenceOutcomeIds:['a','a','b'], claimBoundary:'internal repair',
  }), /distinct outcome evidence/);
});

test('learning policy activation is verified versioned and rollbackable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-policy-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const policies = new LearningPolicyStore(root, 'the-crucible');
  const candidate = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow learning', currentStrategy:'v1', proposedStrategy:'v2',
    metricName:'detection', baseline:0.5, proposed:0.8, evidenceOutcomeIds:['a','b','c'], claimBoundary:'workflow-only',
    observedAt:'2026-09-29T18:10:00.000Z',
  });
  assert.throws(() => policies.activate({ verifiedRecord:{ state:'candidate', candidate }, knowledgeVersion:1, strategy:'v2', policyArea:'workflow learning', boundary:'workflow-only', approvedBy:'oversight' }), /scientifically verified/);
  const verified = { state:'verified', candidate, proof:{ experimentBoundary:'workflow-only', result:'verified' } };
  const v1 = policies.activate({ verifiedRecord:verified, knowledgeVersion:1, strategy:'v2', policyArea:'workflow learning', boundary:'workflow-only', approvedBy:'oversight', at:'2026-09-29T18:11:00.000Z' });
  const candidate2 = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow learning', currentStrategy:'v2', proposedStrategy:'v3',
    metricName:'detection', baseline:0.8, proposed:0.9, evidenceOutcomeIds:['d','e','f'], claimBoundary:'workflow-only',
    observedAt:'2026-09-29T18:12:00.000Z',
  });
  const v2 = policies.activate({ verifiedRecord:{ state:'verified', candidate:candidate2, proof:{ experimentBoundary:'workflow-only', result:'verified-v3' } }, knowledgeVersion:2, strategy:'v3', policyArea:'workflow learning', boundary:'workflow-only', approvedBy:'oversight', at:'2026-09-29T18:13:00.000Z' });
  assert.equal(v2.previousVersion, v1.version);
  assert.equal(policies.active()[0].strategy, 'v3');
  policies.rollback(v1.version, { reason:'regression evidence', approvedBy:'oversight', at:'2026-09-29T18:14:00.000Z' });
  assert.equal(policies.active()[0].strategy, 'v2');
});

test('Outcome store refuses recreation after a retained generation disappears', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-outcome-recovery-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new OutcomeStore(root, 'the-crucible');
  assert.equal(require('../src/recoverySystem').assertFileRestart(store.file).tracked, true);
  fs.unlinkSync(store.file);
  assert.throws(() => store.read(), /restart inhibited|committed state missing|integrity/i);
  assert.throws(() => new OutcomeStore(root, 'the-crucible'), /restart inhibited|committed state missing|integrity/i);
});

test('Legacy learning policy is journaled byte-for-byte before future changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-policy-recovery-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const projectId = 'the-crucible', { sha } = require('../src/scientificLearning');
  const file = path.join(root, `${sha(projectId)}.policies.json`);
  const original = Buffer.from(JSON.stringify({schemaVersion:1, projectId, revision:1, policies:[]}) + '\n');
  fs.writeFileSync(file, original);
  new LearningPolicyStore(root, projectId);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(require('../src/recoverySystem').assertFileRestart(file).tracked, true);
  fs.unlinkSync(file);
  assert.throws(() => new LearningPolicyStore(root, projectId), /restart inhibited|committed state missing|integrity/i);
});


for (const stage of ['before-publication', 'after-publication']) test(`native adaptation SIGKILL ${stage} replays exact outcomes without losing prior evidence`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-adaptation-kill-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const projectId='isolated-adaptation-fixture';
  const store=new OutcomeStore(root,projectId);
  const evidence=id=>({projectId,outcomeId:id,lifecycle:'repair',outcome:'repair-succeeded',expected:'retain complete observation',actual:'measured isolated observation',observedAt:'2026-10-16T09:00:00.000Z'});
  store.record(evidence('retained'));
  const original=store.read().outcomes[0], pending=evidence('interrupted');
  const {spawnSync}=require('node:child_process');
  const modulePath=require.resolve('../src/adaptiveLearning');
  const script=`const fs=require('node:fs'); const {OutcomeStore}=require(${JSON.stringify(modulePath)}); const store=new OutcomeStore(process.argv[1],process.argv[2]); const rename=fs.renameSync; const stop=()=>{fs.writeSync(1,'publication-cut:'+process.argv[3]);process.kill(process.pid,'SIGKILL');};fs.renameSync=(a,b)=>{if(b===store.file&&process.argv[3]==='before-publication')stop();rename(a,b);if(b===store.file)stop();};store.record(JSON.parse(process.argv[4]));`;
  const killed=spawnSync(process.execPath,['-e',script,root,projectId,stage,JSON.stringify(pending)],{encoding:'utf8',timeout:15000});
  assert.equal(killed.error,undefined);
  assert.equal(killed.stdout,'publication-cut:'+stage);
  assert.notEqual(killed.status,0);
  // Windows reports forced process termination as a nonzero exit status with no
  // POSIX signal. The exact cut marker, journal and replay checks apply on all OSes.
  if(process.platform==='win32')assert.equal(killed.signal,null);
  else assert.equal(killed.signal,'SIGKILL');
  const recovery=require('../src/recoverySystem');
  assert.throws(()=>store.read(),/interrupted transaction/);
  const intent=recovery.readJournal(store.file).at(-1);
  assert.equal(intent.phase,'intent');
  const fresh=spawnSync(process.execPath,['-e',`new (require(${JSON.stringify(modulePath)}).OutcomeStore)(process.argv[1],process.argv[2]);`,root,projectId],{encoding:'utf8'});
  assert.notEqual(fresh.status,0,'a fresh writer must refuse while the interrupted lock is too recent');
  for(const f of [store.file+'.lock',store.file+'.recovery.lock']) fs.utimesSync(f,new Date(Date.now()-31000),new Date(Date.now()-31000));
  recovery.withRecoveryWriterLock(store.file,()=>recovery.replayFile(store.file,intent.after));
  recovery.withRecoveryWriterLock(store.file,()=>recovery.replayFile(store.file,intent.after));
  const resumed=new OutcomeStore(root,projectId);
  assert.deepEqual(resumed.read().outcomes.map(x=>x.outcomeId),['retained','interrupted']);
  assert.deepEqual(resumed.read().outcomes[0],original);
  resumed.record(pending);
  assert.equal(resumed.read().outcomes.length,2);
});

test('adaptation refuses a competing native writer and retains exact committed bytes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-adaptation-lock-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const projectId='isolated-adaptation-fixture',store=new OutcomeStore(root,projectId);
  const original=fs.readFileSync(store.file);
  const {withRecoveryWriterLock}=require('../src/recoverySystem');
  withRecoveryWriterLock(store.file,()=>{
    assert.throws(()=>store.record({projectId,outcomeId:'competing',lifecycle:'repair',outcome:'repair-failed',expected:'serialize writers',actual:'lock refused',observedAt:'2026-10-16T09:00:00.000Z'}),/lock|concurren|running/i);
  });
  assert.deepEqual(fs.readFileSync(store.file),original);
});
