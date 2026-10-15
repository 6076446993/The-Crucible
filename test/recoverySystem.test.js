'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const r = require('../src/recoverySystem');
const { DurableScientificLearningStore, sha } = require('../src/scientificLearning');
const { AtomicClaimExtractionQueue } = require('../src/claimExtractionWorker');
const { REQUIRED_ROLES, configuration, run } = require('../src/recoverySystemCli');
const revision = 'a'.repeat(40), projectId = 'github:6076446993/The-Crucible';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-recovery-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const data = path.join(root, 'data'), vault = path.join(root, 'vault'), target = path.join(root, 'restore');
  for (const p of [data,vault,target]) fs.mkdirSync(p);
  const populations = [{ name:'custody', root:data }];
  const options = { populations, vault, projectId, revision, acquireLocks:() => ({ lockFiles:[], release() {} }) };
  return { root, data, vault, target, populations, options };
}
function replace(file, bytes, fault) {
  return r.preservedReplace(file, bytes, () => { const tmp = `${file}.new`; fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); }, fault);
}
test('native store deletion fails closed instead of creating an empty learner', t => {
  const f = fixture(t); const store = new DurableScientificLearningStore({ root:f.data, projectId });
  const before = fs.readFileSync(store.file); fs.unlinkSync(store.file);
  assert.throws(() => new DurableScientificLearningStore({ root:f.data, projectId }), /restart inhibited/);
  assert.equal(fs.existsSync(store.file), false);
  assert.equal(fs.readFileSync(path.join(r.historyRoot(store.file), hash(before) + '.blob')).equals(before), true);
});
test('native queue keeps exact preimages and rejects out-of-band truncation', t => {
  const f = fixture(t), file = path.join(f.data, 'queue.json');
  const q = { schemaVersion:1, projectId, documents:[{ id:'original', provenance:{ source:'private-source' } }], links:[] };
  fs.writeFileSync(file, JSON.stringify(q)); const before = fs.readFileSync(file);
  const queue = new AtomicClaimExtractionQueue(file, projectId); queue.write({ ...q, updatedAt:'later' });
  assert.equal(fs.readFileSync(path.join(r.historyRoot(file), hash(before) + '.blob')).equals(before), true);
  fs.writeFileSync(file, '{}'); assert.throws(() => queue.read(), /restart inhibited/);
});
for (const point of ['intent-durable','target-durable']) test(`exact replay after interruption at ${point} is idempotent`, t => {
  const f = fixture(t), file = path.join(f.data, 'state'); fs.writeFileSync(file, 'before');
  assert.throws(() => replace(file, 'after', stage => { if (stage === point) throw new Error('injected stop'); }), /injected stop/);
  assert.throws(() => r.assertFileRestart(file), /interrupted transaction/);
  assert.throws(() => r.replayFile(file, hash('other')), /exact intended/);
  r.replayFile(file, hash('after')); r.replayFile(file, hash('after'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'after'); assert.equal(r.readJournal(file).length, 2);
  assert.equal(fs.readFileSync(path.join(r.historyRoot(file), hash('before') + '.blob'), 'utf8'), 'before');
});
test('SIGKILL between durable intent and publication inhibits a fresh process', t => {
  const f = fixture(t), file = path.join(f.data, 'state'); fs.writeFileSync(file, 'before');
  const modulePath = require.resolve('../src/recoverySystem');
  const child = spawnSync(process.execPath, ['-e', `const r=require(${JSON.stringify(modulePath)});r.preservedReplace(process.argv[1],'after',()=>{},()=>process.kill(process.pid,'SIGKILL'));`, file]);
  assert.notEqual(child.status, 0);
  const probe = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).assertFileRestart(process.argv[1]);`, file], { encoding:'utf8' });
  assert.notEqual(probe.status, 0); assert.match(probe.stderr, /interrupted transaction/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'before');
});
test('unknown target bytes and corrupted recovery blobs prohibit replay', t => {
  const f = fixture(t), file = path.join(f.data, 'state'); fs.writeFileSync(file, 'before');
  assert.throws(() => replace(file, 'after', () => { throw new Error('stop'); }));
  fs.writeFileSync(file, 'unknown'); assert.throws(() => r.replayFile(file, hash('after')), /unknown target generation/);
  fs.writeFileSync(path.join(r.historyRoot(file), hash('after') + '.blob'), 'tampered');
  assert.throws(() => r.replayFile(file, hash('after')), /corrupt or missing/);
});
test('full population restore preserves bytes, identity, provenance and unimplemented plans', t => {
  const f = fixture(t);
  const plan = { activePlan:{ currentPrompt:'Implement the unfinished repair', currentStep:'not yet implemented', dependencies:['older-item'], priorities:['oldest-first'] }, workLedger:{ items:[{ id:'older-item', originatedAt:'2026-10-07', status:'blocked', nextAction:'verify backup' }] } };
  fs.writeFileSync(path.join(f.data, 'AI-HANDOFF.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(f.data, 'DEVLOG.md'), 'Original decisions, failures, command custody and partial work.');
  fs.writeFileSync(path.join(f.data, 'candidate.json'), JSON.stringify({ id:'retained-candidate', sourceHash:sha('original'), evidence:['original-source'], state:'candidate' }));
  fs.writeFileSync(path.join(f.data, 'original.pdf'), Buffer.from([0,1,2,3,255]));
  fs.mkdirSync(path.join(f.data, 'empty-progress'));
  const before = r.inventory(f.data), cp = r.checkpoint(f.options);
  assert.equal(cp.restartAuthorized, false); assert.equal(cp.independentStorageVerified, false);
  // Independent executable reconstruction from vault alone: source tree is gone.
  fs.rmSync(f.data, { recursive:true });
  const child = spawnSync(process.execPath, [require.resolve('../src/recoverySystemCli'), 'restore', path.join(f.root, 'config.json'), cp.id, f.target], { encoding:'utf8' });
  // A missing config is a refusal, never a false restoration pass.
  assert.notEqual(child.status, 0);
  const script = `const r=require(${JSON.stringify(require.resolve('../src/recoverySystem'))});r.restore(JSON.parse(process.argv[1]));`;
  const result = spawnSync(process.execPath, ['-e', script, JSON.stringify({ vault:f.vault, id:cp.id, projectId, target:f.target })], { encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const restoredRoot = path.join(f.target, 'custody');
  assert.deepEqual(r.compare(before, r.inventory(restoredRoot)), { ok:true, missing:[], changed:[], added:[] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restoredRoot, 'AI-HANDOFF.json'))), plan);
  assert.equal(JSON.parse(fs.readFileSync(path.join(restoredRoot, 'candidate.json'))).id, 'retained-candidate');
});
test('interrupted restore can resume exactly without overwriting existing material', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.data, 'a'), 'A'); fs.writeFileSync(path.join(f.data, 'b'), 'B');
  const cp = r.checkpoint(f.options); let count = 0;
  assert.throws(() => r.restore({ ...f, id:cp.id, projectId, fault:() => { if (++count === 1) throw new Error('stop'); } }), /stop/);
  const restored = r.restore({ ...f, id:cp.id, projectId }); assert.equal(restored.restored, true);
  assert.equal(r.restore({ ...f, id:cp.id, projectId }).restored, true);
  fs.writeFileSync(path.join(f.target, 'custody', 'a'), 'unknown');
  assert.throws(() => r.restore({ ...f, id:cp.id, projectId }), /collision/);
  assert.equal(fs.readFileSync(path.join(f.target, 'custody', 'a'), 'utf8'), 'unknown');
});
test('tampered independent-copy object, missing manifest and wrong project are refused', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.data, 'a'), 'A'); const cp = r.checkpoint(f.options);
  assert.throws(() => r.loadCheckpoint(f.vault, cp.id, 'other'), /identity mismatch/);
  assert.throws(() => r.loadCheckpoint(f.vault, 'b'.repeat(64), projectId));
  fs.writeFileSync(path.join(f.vault, 'objects', hash('A') + '.blob'), 'changed');
  assert.throws(() => r.restore({ ...f, id:cp.id, projectId }), /corrupt/);
  assert.equal(fs.readdirSync(f.target).length, 0);
});
test('concurrent population mutation aborts checkpoint and releases every lock', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.data, 'a'), 'A'); let released = false;
  assert.throws(() => r.checkpoint({ ...f.options, acquireLocks:() => ({ lockFiles:[], release() { released = true; } }), fault:() => fs.writeFileSync(path.join(f.data, 'new'), 'new') }), /changed during checkpoint/);
  assert.equal(released, true); assert.equal(fs.readdirSync(f.vault).some(n => n.endsWith('.manifest.json')), false);
});
test('symlinks, hardlink aliases and nested vaults fail closed', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.data, 'a'), 'A');
  fs.linkSync(path.join(f.data, 'a'), path.join(f.data, 'alias')); assert.throws(() => r.inventory(f.data), /unlinked/); fs.unlinkSync(path.join(f.data, 'alias'));
  if (process.platform !== 'win32') { fs.symlinkSync(f.data, path.join(f.data, 'loop')); assert.throws(() => r.inventory(f.data), /symlink/); fs.unlinkSync(path.join(f.data, 'loop')); }
  assert.throws(() => r.checkpoint({ ...f.options, vault:f.data }), /outside/);
});
test('complete configuration includes plans and unfinished work; unsigned restart is inhibited', t => {
  const f = fixture(t); const config = path.join(f.root, 'config.json');
  const c = { repository:'6076446993/The-Crucible', branch:'development', projectId, revision, vault:f.vault, populations:[{ name:'all', root:f.data, roles:REQUIRED_ROLES }], lockFiles:[path.join(f.data,'writer.lock')] };
  fs.writeFileSync(config, JSON.stringify(c)); assert.equal(configuration(config).projectId, projectId);
  const cp = run(['checkpoint',config]); assert.equal(run(['verify',config,cp.id]).verified,true);
  assert.throws(() => run(['authorize-restart',config,cp.id]), /separately provisioned/);
  c.populations[0].roles = REQUIRED_ROLES.filter(x => x !== 'plans'); fs.writeFileSync(config,JSON.stringify(c));
  assert.throws(() => configuration(config), /plans/);
});
test('signed restart requires distinct identities and exact non-expired protected restoration', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type:'spki',format:'pem' }); const now = Date.now();
  const statement = { id:'a'.repeat(64), projectId, revision, workerIdentity:'worker', verifierIdentity:'verifier', backupIdentity:'recovery-custodian', restoreVerified:true, retentionLocked:true, workerDeleteDenied:true, populationVerified:true, verifiedAt:new Date(now-1000).toISOString(), expiresAt:new Date(now+60000).toISOString(), retentionUntil:new Date(now+120000).toISOString() };
  const sign = s => ({ statement:s, signature:crypto.sign(null,Buffer.from(JSON.stringify(s)),privateKey).toString('base64') });
  const options = { receipt:sign(statement), publicKey:pem, id:statement.id, projectId, revision, workerIdentity:'worker', now };
  assert.equal(r.authorizeRestart(options).restartAuthorized,true);
  assert.throws(() => r.authorizeRestart({ ...options, revision:'b'.repeat(40) }), /exact protected state/);
  for (const patch of [{ verifierIdentity:'worker' }, { workerDeleteDenied:false }, { retentionLocked:false }, { restoreVerified:false }, { expiresAt:new Date(now-1).toISOString() }, { retentionUntil:'invalid' }]) assert.throws(() => r.authorizeRestart({ ...options, receipt:sign({ ...statement,...patch }) }), /exact protected state/);
  assert.throws(() => r.authorizeRestart({ ...options, receipt:{ ...sign(statement), statement:{ ...statement,id:'b'.repeat(64) } } }), /signature invalid/);
});
test('orchestrator autonomously replays only registered recovery operations and retains a hold', async t => {
  const f = fixture(t), file = path.join(f.data,'source-queue.json');
  const before = JSON.stringify({projectId,state:'before'}), after = JSON.stringify({projectId,state:'after'});
  fs.writeFileSync(file,before);
  assert.throws(() => replace(file,after, () => { throw new Error('interrupted'); }));
  const { RecoveryController } = require('../src/recoveryController');
  const controller = new RecoveryController({ projectId, operations:[{ id:'finish-exact-queue', projectId, argv:['replay-file',file,hash(after),projectId] }], ledgerFile:path.join(f.data,'recovery-events.json') });
  const { CrucibleLearningOrchestrator } = require('../src/learningOrchestrator');
  let extracted = 0; const events = [];
  const orchestrator = new CrucibleLearningOrchestrator({ store:{ projectId,read:() => ({}), retrieve:() => [] }, ledger:{ projectId,record:e => events.push(e) }, extractor:{ run() { extracted++; return []; } }, recoveryController:controller });
  const outcome = await orchestrator.coordinate({ recoveryTasks:[{ projectId, operationId:'finish-exact-queue' }], runExtraction:true });
  assert.equal(fs.readFileSync(file,'utf8'),after); assert.equal(outcome.recovery[0].state,'completed');
  assert.equal(outcome.state,'recovery-held'); assert.equal(extracted,0); assert.equal(events[0].extracted,0);
  await assert.rejects(() => controller.recover({ projectId,operationId:'finish-exact-queue', path:'/unapproved' }), /only/);
  const replay = await controller.recover({ projectId,operationId:'finish-exact-queue' }); assert.equal(replay.state,'completed');
  assert.equal(JSON.parse(fs.readFileSync(controller.file)).events.length,2);
});
test('missing recovery dependencies are durably diagnosed without resuming unrelated work', async t => {
  const f = fixture(t); const { RecoveryController } = require('../src/recoveryController');
  const controller = new RecoveryController({ projectId, operations:[{ id:'verify-protected',projectId,argv:['authorize-restart',path.join(f.root,'missing-config'),'a'.repeat(64)] }], ledgerFile:path.join(f.data,'events.json') });
  const result = await controller.recover({ projectId,operationId:'verify-protected' });
  assert.equal(result.state,'held'); assert.equal(result.restartAuthorized,false);
  const record = JSON.parse(fs.readFileSync(controller.file)).events[0]; assert.equal(record.operationId,'verify-protected'); assert.equal(record.operationalCode,'OPS-0049');
});
test('production circulation retains held recovery tasks and retries without operator resubmission', async t => {
  const f = fixture(t); const { createProductionOrganism, submitRecoveryTask } = require('../src/productionOrganism');
  let time = Date.parse('2026-10-15T19:00:00Z'), attempts = 0;
  const runtime = createProductionOrganism({ projectId, root:f.data, learningStore:{retrieve:()=>[]}, oversightReflex:{evaluate:()=>{}}, diagnosticPlanner:{plan:()=>{}}, repairActuator:{run:()=>{}}, experienceRecorder:{record:()=>{}}, reporter:{report:()=>{}}, digestiveWorker:{process:()=>{}}, testingOrgan:()=>{}, diagnosticOrgan:()=>{}, recoveryController:{ recover:async request => { assert.equal(request.operationId,'registered-restore'); attempts++; return {state:'held',operationalCode:'OPS-0049',restartAuthorized:false}; } }, now:()=>new Date(time).toISOString() });
  submitRecoveryTask(runtime,{taskId:'preserve-oldest-task',operationId:'registered-restore',boundary:'exact-custody'});
  const first = await runtime.heartbeat(); assert.equal(first.results[0].state,'recovery-held');
  assert.equal(runtime.read().queue[0].state,'queued'); assert.equal(runtime.read().completedKeys.length,0);
  await runtime.heartbeat(); assert.equal(attempts,1);
  time+=61000; await runtime.heartbeat(); assert.equal(attempts,2);
  assert.equal(runtime.read().queue[0].id,'preserve-oldest-task');
});
test('killed native candidate commit resumes exactly and preserves every candidate identity and provenance', t => {
  const f = fixture(t); const { makeCandidate } = require('../src/scientificLearning');
  const make = id => makeCandidate({ id,projectId,claim:'A bounded function returns a value.',claimBoundary:'recovery test',generalizationBoundary:'recovery test only',kind:'controlled-experiment',createdAt:'2026-10-15T19:00:00.000Z',provenance:{ sourceType:'test-source',sourceId:'original-retained-source',retrievedAt:'2026-10-15T19:00:00.000Z',author:'fixture',license:'private-fixture',contentSha256:sha('original-source') } });
  const store = new DurableScientificLearningStore({ root:f.data,projectId }); store.ingest(make('retained'));
  const before = store.read(), pending = make('interrupted');
  const script = `const fs=require('fs');const {DurableScientificLearningStore}=require(${JSON.stringify(require.resolve('../src/scientificLearning'))});const s=new DurableScientificLearningStore(JSON.parse(process.argv[1]));const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b===s.file)process.kill(process.pid,'SIGKILL');};s.ingest(JSON.parse(process.argv[2]));`;
  const killed = spawnSync(process.execPath,['-e',script,JSON.stringify({root:f.data,projectId}),JSON.stringify(pending)]);
  assert.notEqual(killed.status,0); assert.throws(() => new DurableScientificLearningStore({ root:f.data,projectId }),/interrupted transaction/);
  const intended = r.readJournal(store.file).at(-1).after;
  // Respect the normal dead-owner floor. Advancing only these disposable lock
  // mtimes models elapsed time without changing reclamation policy or live locks.
  for (const file of [store.lockFile,store.file+'.recovery.lock']) fs.utimesSync(file,new Date(Date.now()-31000),new Date(Date.now()-31000));
  run(['replay-file',store.file,intended,projectId]);
  const resumed = new DurableScientificLearningStore({ root:f.data,projectId }); const after = resumed.read();
  assert.deepEqual(after.candidateRecords.map(x => x.candidate.id),['retained','interrupted']);
  assert.deepEqual(after.candidateRecords[0],before.candidateRecords[0]);
  assert.deepEqual(after.candidateRecords[1].candidate.provenance,pending.provenance);
  assert.equal(resumed.ingestMany([pending]).length,0);
  assert.equal(resumed.read().candidateRecords.length,2);
  assert.deepEqual(resumed.read().knowledgeVersions,before.knowledgeVersions);
});
test('unsupported directory durability inhibits replacement without changing original bytes', t => {
  const f = fixture(t), file = path.join(f.data,'source-queue.json'); fs.writeFileSync(file,'retained');
  const original = fs.fsyncSync;
  fs.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) { const error = new Error('unsupported'); error.code='EINVAL'; throw error; } return original(fd); };
  try { assert.throws(() => replace(file,'replacement'), /directory durability is unavailable/); }
  finally { fs.fsyncSync = original; }
  assert.equal(fs.readFileSync(file,'utf8'),'retained');
});
test('OS-owned temporary-root aliases are canonicalized without allowing additional symlinks', t => {
  const f = fixture(t), alias = path.join(f.root,'os-temp-alias');
  fs.writeFileSync(path.join(f.data,'retained'),'original');
  fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
  const expected = r.inventory(f.data);
  const original = os.tmpdir; os.tmpdir = () => alias;
  try {
    assert.deepEqual(r.inventory(path.join(alias,'data')),expected);
    const lock = path.join(alias,'data','native.lock'); fs.writeFileSync(lock,'held');
    assert.deepEqual(r.inventory(path.join(alias,'data'),[lock]),expected);
    fs.symlinkSync(f.vault,path.join(f.data,'unapproved'),process.platform==='win32'?'junction':'dir');
    assert.throws(() => r.inventory(path.join(alias,'data')),/symlink/);
  } finally { os.tmpdir = original; }
});
test('P0 hold prevents real Crucible research before provider calls and keeps other projects independent', async () => {
  assert.throws(() => r.assertNormalActivityAllowed(projectId),/P0 recovery-only/);
  assert.throws(() => r.assertNormalActivityAllowed('github:jonathanblunt1214-lgtm/The-Crucible'),/P0 recovery-only/);
  assert.doesNotThrow(() => r.assertNormalActivityAllowed('github:other/project'));
  const { AutomatedModelPointerResearch } = require('../src/automatedModelPointerResearch');
  let searches=0,registrations=0,dueCalls=0;
  const research = new AutomatedModelPointerResearch({ store:{projectId,due(){dueCalls++;return[];},recordRun(){}},client:{search:async()=>{searches++;}},candidateSink:{register(){registrations++;}} });
  await assert.rejects(() => research.runDue(new Date().toISOString()),/P0 recovery-only/);
  assert.equal(searches,0);assert.equal(registrations,0);assert.equal(dueCalls,0);
});

test('late initialization cannot overwrite an existing learning generation', t => {
  const f = fixture(t), store = new DurableScientificLearningStore({ root:f.data, projectId });
  const original = fs.readFileSync(store.file), records = r.readJournal(store.file).length;
  assert.throws(() => store.writeEnvelope(store.read(),false), /initialization target already exists/);
  assert.deepEqual(fs.readFileSync(store.file),original);
  assert.equal(r.readJournal(store.file).length,records);
});
test('restoration flushes the parents of nested empty directories before completion', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.data,'outer','inner','empty'),{recursive:true});
  const checkpoint = r.checkpoint(f.options), descriptors = new Map(), flushed = new Set();
  const open = fs.openSync, sync = fs.fsyncSync;
  fs.openSync = function(file,...args) { const fd = open.call(this,file,...args); descriptors.delete(fd); if(fs.fstatSync(fd).isDirectory())descriptors.set(fd,fs.realpathSync(file)); return fd; };
  fs.fsyncSync = function(fd) { if(descriptors.has(fd))flushed.add(descriptors.get(fd)); return sync.call(this,fd); };
  try { r.restore({vault:f.vault,id:checkpoint.id,projectId,target:f.target}); }
  finally { fs.openSync=open;fs.fsyncSync=sync; }
  for(const relative of ['','custody','custody/outer','custody/outer/inner']) assert.ok(flushed.has(fs.realpathSync(path.join(f.target,relative))),`unflushed directory parent: ${relative}`);
});
