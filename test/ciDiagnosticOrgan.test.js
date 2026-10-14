const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {diagnose,npmCliCandidates,npmCli,npmCiLogPath,captureNpmCi}=require('../src/ciDiagnosticOrgan');
const base={projectId:'github:owner/repo',repository:'owner/repo',commitSha:'a'.repeat(40),runId:'1',workflow:'Self-Test',job:'Windows Node 20',step:'Install locked dependencies',os:'Windows',nodeVersion:'v20.20.0',conclusion:'failure'};
test('diagnoses the exact tree-sitter Windows toolchain chain without authorizing repair or proof',()=>{const report=diagnose({...base,log:'npm ERR npm ci tree-sitter prebuild unavailable; native build node-gyp cannot recognize Visual Studio 18'});assert.equal(report.health.state,'degraded');assert.deepEqual(report.health.inhibitions,['claim-of-green','release','promotion']);assert.ok(report.diagnoses.some((item)=>item.id==='tree-sitter-windows-toolchain'));assert.equal(report.classification,'Insufficient Evidence');assert.equal(report.repairAuthorized,false);assert.equal(report.proofStageSatisfied,false);});
test('records checkout ownership separately and allows only bounded diagnosis',()=>{const report=diagnose({...base,step:'Checkout',log:'fatal: detected dubious ownership; use safe.directory'});assert.equal(report.diagnoses[0].category,'host-ownership');assert.match(report.diagnoses[0].next,/checkout-scoped/);});
test('rejects cross-project and unbound commit diagnosis',()=>{assert.throws(()=>diagnose({...base,projectId:'github:other/repo',log:''}),/Cross-project/);assert.throws(()=>diagnose({...base,commitSha:'latest',log:''}),/Exact commit/);});
test('unclassified failures remain degraded and explicitly uncertain without inventing a CRU classification',()=>{const report=diagnose({...base,log:'unknown failure'});assert.equal(report.unclassifiedFailure,true);assert.equal(report.health.state,'degraded');assert.equal(report.diagnoses[0].id,'OPS-0000');assert.equal(report.diagnoses[0].source,'coverage-gap');});
test('resolves the bundled npm CLI on this runtime and offers both supported Node layouts',()=>{const candidates=npmCliCandidates();assert.equal(candidates.length,2);assert.ok(candidates.some((candidate)=>candidate.endsWith(path.join('node_modules','npm','bin','npm-cli.js'))&&!candidate.includes(`${path.sep}lib${path.sep}`)));assert.ok(candidates.some((candidate)=>candidate.endsWith(path.join('lib','node_modules','npm','bin','npm-cli.js'))));assert.ok(fs.existsSync(npmCli()));});
test('reports an unresolvable npm CLI with every attempted layout instead of a single platform guess',()=>{assert.throws(()=>npmCli(path.join(path.sep,'nonexistent-node-root','bin','node')),(error)=>error.message.includes(path.join('node_modules','npm','bin','npm-cli.js'))&&error.message.includes(path.join('lib','node_modules','npm','bin','npm-cli.js')));});
test('preserves the wrapper\'s own start failure as typed, bounded evidence rather than an unclassified blank',(t)=>{const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'crucible-ci-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const execPath=process.execPath;Object.defineProperty(process,'execPath',{value:path.join(path.sep,'nonexistent-node-root','bin','node'),configurable:true});try{const result=captureNpmCi({RUNNER_TEMP:directory});assert.equal(result.status,1);assert.equal(result.file,npmCiLogPath({RUNNER_TEMP:directory}));const report=diagnose({...base,log:fs.readFileSync(result.file,'utf8')});assert.equal(report.unclassifiedFailure,false);assert.ok(report.diagnoses.some((item)=>item.id==='npm-cli-resolution'));assert.equal(report.repairAuthorized,false);}finally{Object.defineProperty(process,'execPath',{value:execPath,configurable:true});}});

const { diagnoseJob } = require('../src/ciDiagnosticOrgan');
function jobFixture() {
  const context = { ...base, attempt: 1, job: 'Prove R4-R8' };
  const evidence = { repository: context.repository, commitSha: context.commitSha, runId: context.runId, attempt: 1,
    job: { id: 123, name: context.job, conclusion: 'failure', steps: [
      { number: 1, name: 'Decrypt vetted custody and verify every restored hash', conclusion: 'success' },
      { number: 2, name: 'Run project-bound durable R4-R8 proof on the real corpus', conclusion: 'failure' },
      { number: 3, name: 'Destroy runner plaintext', conclusion: 'success' },
    ] } };
  return { context, evidence, logs: { '1': 'npm ERR stale installation error', '2': 'R8 pending: executable-content' } };
}
test('diagnoses successful decrypt followed by R8 failure without inventing key loss or inheriting earlier log errors', () => {
  const report = diagnoseJob(jobFixture());
  assert.equal(report.stepReports.length, 1);
  assert.equal(report.stepReports[0].stage, 'scientific-proof');
  assert.ok(report.observedSuccessfulSteps.some(s => s.stage === 'custody-decrypt-and-integrity'));
  assert.equal(report.stepReports[0].diagnoses.some(d => d.category === 'dependency-install'), false);
  assert.equal(report.keyRecoveryRequired, 'not-established');
  assert.equal(report.backupComplete, false);
  assert.equal(report.repairAuthorized, false);
});
test('rejects stale runs, different attempts, commits, repositories and jobs', () => {
  for (const [field, value] of [['runId', '2'], ['attempt', 2], ['commitSha', 'b'.repeat(40)], ['repository', 'other/repo']]) {
    const f = jobFixture(); f.evidence[field] = value;
    assert.throws(() => diagnoseJob(f), /exact repository/);
  }
  const f = jobFixture(); f.evidence.job.name = 'another job';
  assert.throws(() => diagnoseJob(f), /job evidence/);
});
test('preserves multiple failed stages, unknown coverage, and missing logs without manufacturing a cause', () => {
  const f = jobFixture(); f.evidence.job.steps[2].conclusion = 'failure'; delete f.logs['2'];
  const report = diagnoseJob(f);
  assert.equal(report.stepReports.length, 2);
  assert.equal(report.stepReports[0].logAvailable, false);
  assert.equal(report.stepReports[1].stage, 'unknown');
  assert.equal(report.stepReports[0].diagnoses[0].source, 'coverage-gap');
});
test('rejects inconsistent completed evidence and preserves failures before successful cleanup', () => {
  const f = jobFixture(); f.evidence.job.conclusion = 'success';
  assert.throws(() => diagnoseJob(f), /contradicts/);
  f.evidence.job.conclusion = 'failure'; f.evidence.job.steps[1].number = 1;
  assert.throws(() => diagnoseJob(f), /step evidence/);
});
test('completed failure without a failed step remains incomplete diagnosis', () => {
  const f = jobFixture(); f.evidence.job.steps = [];
  assert.equal(diagnoseJob(f).diagnosisComplete, false);
});
const { diagnoseProof } = require('../src/ciDiagnosticOrgan');
function proofFixture() {
  const context = { ...base, ref: 'refs/heads/development' };
  const common = { repository: context.repository, projectId: context.projectId, ref: context.ref };
  return { context, proof: { ...common, runId: context.runId, gates: [4,5,6,7,8].map(n => ({ id: `R${n}`, state: n === 8 ? 'pending' : 'satisfied' })) },
    corpus: { ...common, corpusProvenance: 'oversight-vetted', vetted: true, queueSha256: 'b'.repeat(64), learningSha256: 'c'.repeat(64) } };
}
test('producer-artifact diagnosis identifies pending gates without making recovery or backup claims', () => {
  const r = diagnoseProof(proofFixture());
  assert.deepEqual(r.unresolvedGates, [{ id: 'R8', state: 'pending' }]);
  assert.equal(r.stage, 'scientific-proof'); assert.equal(r.backupComplete, false);
  assert.equal(r.keyRecoveryRequired, 'not-established'); assert.equal(r.repairAuthorized, false);
});
test('proof diagnosis rejects wrong run, raw custody, missing gates and different project binding', () => {
  let f = proofFixture(); f.proof.runId = 'wrong'; assert.throws(() => diagnoseProof(f));
  f = proofFixture(); f.corpus.corpusProvenance = 'raw-intake'; assert.throws(() => diagnoseProof(f));
  f = proofFixture(); f.proof.gates.pop(); assert.throws(() => diagnoseProof(f));
  f = proofFixture(); f.corpus.projectId = 'github:other/repo'; assert.throws(() => diagnoseProof(f));
});
test('transferred custody retains only the exact authorized legacy project identity', () => {
  const f = proofFixture(); f.context.repository = '6076446993/The-Crucible'; f.context.projectId = `github:${f.context.repository}`;
  for (const a of [f.proof, f.corpus]) { a.repository = f.context.repository; a.projectId = 'github:jonathanblunt1214-lgtm/The-Crucible'; }
  assert.equal(diagnoseProof(f).observedCustody.family, 'oversight-vetted');
  f.corpus.projectId = 'github:other/The-Crucible'; assert.throws(() => diagnoseProof(f));
});
