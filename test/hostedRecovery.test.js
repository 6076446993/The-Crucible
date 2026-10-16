'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const recovery=require('../src/hostedRecovery');
const bundle=require('../src/hostedSourceBundle');
const {encryptWeeklyEnvelope,sha}=require('../src/scientificLearning');
const {learningBinding,STATE_CONTEXT}=require('../src/hostedLearningProof');
const repository='6076446993/The-Crucible',ref='refs/heads/development',projectId='github:jonathanblunt1214-lgtm/The-Crucible';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function git(root,...args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function commit(root){git(root,'add','.');git(root,'-c','user.name=Recovery test','-c','user.email=recovery@example.test','commit','-m','Retain fixture');return git(root,'rev-parse','HEAD');}
function rootFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'hosted-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function init(root){fs.mkdirSync(root);git(root,'init','--initial-branch=main');}
function payload(){return {projectId,revision:7,candidateRecords:[{candidate:{id:'retained-candidate',source:{id:'retained-source',hash:'b'.repeat(64)}},state:'candidate',evidence:[{id:'retained-evidence'}]}],knowledgeVersions:[{version:1,candidateId:'retained-candidate',status:'superseded'}],unfinishedWork:[{id:'original-plan',status:'pending'}]};}
async function corpus(root,name){
  const plain=path.join(root,`${name}-plain`),state=path.join(root,name);fs.mkdirSync(plain);fs.mkdirSync(path.join(plain,'sources'));init(state);
  const original=Buffer.from('Original recovery source; no instruction is executed.'),hash=digest(original),sourceName=`${hash}.txt`;
  fs.writeFileSync(path.join(plain,'sources',sourceName),original);
  const queue={schemaVersion:1,projectId,documents:[{id:'retained-source',state:'claim-extraction-in-progress',contentSha256:hash,durablePath:`sources/${sourceName}`,claimExtraction:{nextPage:9,windows:[{pageStart:1,pageEnd:8,candidateIds:['retained-candidate']}]}}],links:[]};
  fs.writeFileSync(path.join(plain,'source-queue.json'),JSON.stringify(queue));
  fs.writeFileSync(path.join(plain,'learning.json'),JSON.stringify({schemaVersion:1,payload:payload(),payloadSha256:sha(payload())}));
  const manifest={schemaVersion:1,projectId,repository,ref,queueSha256:bundle.sha256File(path.join(plain,'source-queue.json')),learningFile:'learning.json',learningSha256:bundle.sha256File(path.join(plain,'learning.json')),sourceFiles:[{name:sourceName,sha256:hash,bytes:original.length}]};
  fs.writeFileSync(path.join(plain,'manifest.json'),JSON.stringify(manifest));
  const archive=path.join(root,`${name}.tar.gz`),encrypted=path.join(root,`${name}.enc`);
  execFileSync('tar',['-czf',archive,'-C',plain,'.']);
  const current=process.env.CRUCIBLE_SOURCE_BUNDLE_KEY;
  if(name==='vetted')process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=process.env.CRUCIBLE_VETTED_BUNDLE_KEY;
  try{await bundle.encrypt({input:archive,output:encrypted,projectId,repository,ref});}finally{process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=current;}
  bundle.splitEncrypted({input:encrypted,outputRoot:state});commit(state);return state;
}
test('authenticated corpus checkpoint survives source removal and encrypted-backup restoration on a fresh process',async t=>{
  const root=rootFixture(t),keys=['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_VETTED_BUNDLE_KEY','CRUCIBLE_HOSTED_STORE_KEY'],prior=keys.map(k=>process.env[k]);
  keys.forEach(k=>process.env[k]=crypto.randomBytes(32).toString('base64'));
  t.after(()=>keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];}));
  const rawRoot=await corpus(root,'raw'),vettedRoot=await corpus(root,'vetted'),coreRoot=path.join(root,'core');init(coreRoot);
  fs.writeFileSync(path.join(coreRoot,'AI-HANDOFF.json'),JSON.stringify({unfinished:[{id:'original-plan',originalPriority:0}]}));
  fs.writeFileSync(path.join(coreRoot,'DEVLOG.md'),'Retain all research and unfinished work.');const revision=commit(coreRoot);
  const retainedRoot=path.join(root,'retained');fs.mkdirSync(retainedRoot);const binding=learningBinding(repository,ref);
  const env=encryptWeeklyEnvelope({schemaVersion:1,projectId,week:STATE_CONTEXT,candidateEvidence:[{durableState:payload()}],verifiedKnowledge:[]},{masterKey:Buffer.from(process.env.CRUCIBLE_HOSTED_STORE_KEY,'base64'),projectId,repository,week:STATE_CONTEXT,oidcSubject:binding.subject});
  fs.writeFileSync(path.join(retainedRoot,'store.envelope.json'),JSON.stringify(env));
  const researchRoot=path.join(root,'research');fs.mkdirSync(researchRoot);fs.writeFileSync(path.join(researchRoot,'pending-plan.json'),'["unimplemented research"]');
  const reportFile=path.join(root,'report.json'),work=path.join(root,'capture');
  const report=await recovery.capture({root:work,repository,ref,revision,coreRoot,rawRoot,vettedRoot,retainedRoot,researchRoots:[researchRoot],reportFile});
  assert.equal(report.state,'captured-and-isolated-restore-verified');assert.match(report.custodyHistoryCoverage,/historical Git replication remains held/);assert.equal(report.preDigest,report.postDigest);
  assert.equal(report.populations.raw.learning.candidates,1);assert.equal(report.populations.retained.learningVersions,1);assert.equal(report.researchCachesCaptured,1);
  assert.equal(report.independentStorageVerified,false);assert.equal(report.restartAuthorized,false);assert.equal(git(rawRoot,'status','--porcelain'),'');assert.equal(git(vettedRoot,'status','--porcelain'),'');
  const encrypted=path.join(root,'backup.enc');await recovery.seal({root:work,output:encrypted,repository,ref,reportFile});
  for(const item of [rawRoot,vettedRoot,coreRoot,retainedRoot,work,researchRoot])fs.rmSync(item,{recursive:true});
  const restored=await recovery.restoreBackup({input:encrypted,root:path.join(root,'fresh-runner'),repository,ref,revision,reportFile:path.join(root,'restored.json')});
  assert.equal(restored.state,'uploaded-backup-restored-and-replayed');assert.equal(restored.postDigest,report.preDigest);
  assert.equal(restored.populations.raw.sourceAndExtractionProgressDigest,report.populations.raw.sourceAndExtractionProgressDigest);
  assert.equal(restored.zeroKnowledgeLossVerified,false);assert.equal(restored.independentSecurityPrincipal,false);
  const altered=fs.readFileSync(encrypted);altered[altered.length-1]^=1;fs.writeFileSync(path.join(root,'tampered.enc'),altered);
  await assert.rejects(()=>recovery.restoreBackup({input:path.join(root,'tampered.enc'),root:path.join(root,'tampered-restore'),repository,ref,revision,reportFile:path.join(root,'bad-report.json')}));
});
test('same candidate count cannot conceal changed identities, evidence, versions or provenance',()=>{
  const original=payload(),changed=structuredClone(original);changed.candidateRecords[0].candidate.id='different';
  const a=recovery.semanticState(original),b=recovery.semanticState(changed);assert.equal(a.candidates,b.candidates);assert.notEqual(a.candidateIdentityDigest,b.candidateIdentityDigest);assert.notEqual(a.completePayloadDigest,b.completePayloadDigest);
  changed.candidateRecords.push(changed.candidateRecords[0]);assert.throws(()=>recovery.semanticState(changed),/duplicated/);
});
test('recovery extraction refuses traversal, symlinks and duplicate archive members',t=>{
  const root=rootFixture(t),python=process.env.CRUCIBLE_RECOVERY_PYTHON||(process.platform==='win32'?'python':'python3');
  for(const kind of ['traversal','symlink','duplicate']){
    const archive=path.join(root,`${kind}.tar.gz`);
    const code="import tarfile,io,sys\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n n='../escape' if sys.argv[2]=='traversal' else 'member'\n x=tarfile.TarInfo(n)\n if sys.argv[2]=='symlink': x.type=tarfile.SYMTYPE; x.linkname='../escape'; t.addfile(x)\n else:\n  x.size=1; t.addfile(x,io.BytesIO(b'x'))\n  if sys.argv[2]=='duplicate': t.addfile(x,io.BytesIO(b'y'))\n";
    const made=spawnSync(python,['-c',code,archive,kind],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
    const before=digest(fs.readFileSync(archive));assert.throws(()=>recovery.extract(archive,path.join(root,kind),'tar'),/refused/);assert.equal(digest(fs.readFileSync(archive)),before);assert.equal(fs.existsSync(path.join(root,'escape')),false);
  }
});
test('hosted recovery has no publication or R2 authority and fresh restore receives no custody deploy key',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'..','.github','workflows','recovery-custody.yml'),'utf8');
  assert.equal((workflow.match(/npm ci --ignore-scripts/g)||[]).length,2);assert.match(workflow,/contents: read/);assert.match(workflow,/actions: read/);assert.match(workflow,/cancel-in-progress: false/);
  assert.doesNotMatch(workflow,/git push|contents: write|secrets: write|r2FailoverProof|learning:.*run|source-bundle-key-manager/);
  const restored=workflow.split('  restore-uploaded-backup:')[1];assert.ok(restored);assert.doesNotMatch(restored,/DEPLOY_KEY|RAW_READ_KEY|VETTED_READ_KEY/);assert.match(restored,/restore-backup/);assert.doesNotMatch(workflow,/fetch --unshallow/);assert.match(workflow,/cat recovery-report\.json/);assert.match(workflow,/cat recovery-restoration-report\.json/);
});
