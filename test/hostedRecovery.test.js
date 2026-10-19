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
test('historical RAW audit covers retained manifests, missing keys and every advertised branch without mutating custody',async t=>{
  const root=rootFixture(t),names=['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS'];
  const saved=names.map(n=>process.env[n]);t.after(()=>names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i];}));
  process.env[names[0]]=crypto.randomBytes(32).toString('base64');delete process.env[names[1]];
  const state=await corpus(root,'raw');git(state,'remote','add','origin','git@github.com:6076446993/Crucible-Learning-State.git');
  const first=git(state,'rev-parse','HEAD');
  const oldManifest=fs.readFileSync(path.join(state,'encrypted-chunks.json'));
  const oldKey=process.env[names[0]];
  process.env[names[0]]=crypto.randomBytes(32).toString('base64');
  const newer=path.join(root,'newer.enc');await bundle.encrypt({input:path.join(root,'raw.tar.gz'),output:newer,projectId,repository,ref});
  const staged=path.join(state,'rebuild-incoming','retained');fs.mkdirSync(staged,{recursive:true});
  bundle.splitEncrypted({input:newer,outputRoot:staged});
  fs.writeFileSync(path.join(state,'encrypted-manifest-retained.json'),oldManifest);const second=commit(state);
  git(state,'update-ref','refs/remotes/origin/main',second);git(state,'update-ref','refs/remotes/origin/retained',first);
  const before=git(state,'status','--porcelain'),tree=git(state,'rev-parse','HEAD^{tree}');
  const report=await recovery.authenticateRawHistory({stateRoot:state,root:path.join(root,'history'),repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'report.json')});
  assert.equal(report.state,'held');assert.equal(report.coverageComplete,true);assert.equal(report.commits,2);
  assert.equal(report.distinctCiphertexts,2);assert.equal(report.authenticatedVersions,1);assert.equal(report.failedVersions,1);
  assert.equal(report.keySlots.find(k=>k.name===names[0]).fingerprint,digest(Buffer.from(process.env[names[0]],'base64')));
  assert.equal(report.keySlots.find(k=>k.name===names[1]).configured,false);
  assert.ok(report.occurrences.some(x=>x.manifestPath.startsWith('rebuild-incoming/')));
  assert.ok(report.occurrences.some(x=>x.manifestPath==='encrypted-manifest-retained.json'));
  assert.equal(report.occurrences.find(x=>x.manifestPath==='encrypted-manifest-retained.json').manifestSha256,digest(oldManifest));
  assert.equal(report.independentRecoveryAccepted,false);assert.equal(report.normalWorkResumptionAuthorized,false);
  assert.equal(report.completeHistoricalRecoveryVerified,false);assert.equal(report.independentOversightSignatureVerified,false);
  assert.ok(!JSON.stringify(report).includes(oldKey));assert.ok(!JSON.stringify(report).includes(process.env[names[0]]));
  assert.equal(git(state,'status','--porcelain'),before);assert.equal(git(state,'rev-parse','HEAD^{tree}'),tree);
  assert.equal(fs.existsSync(path.join(root,'history')),false);
  process.env[names[1]]=oldKey;
  const recovered=await recovery.authenticateRawHistory({stateRoot:state,root:path.join(root,'complete'),repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'complete.json')});
  assert.equal(recovered.state,'authenticated-advertised-raw-history');assert.equal(recovered.authenticatedVersions,2);
  assert.equal(recovered.versions.find(v=>v.decryptedWith===names[1]).population.learning.candidates,1);
  assert.equal(recovered.completeHistoricalRecoveryVerified,false);
  const cleanupRoot=path.join(fs.realpathSync(root),'cleanup-failure'),originalRemove=fs.rmSync;
  fs.rmSync=(target,...args)=>{if(target===cleanupRoot)throw new Error('synthetic cleanup refusal');return originalRemove(target,...args);};
  try {
    await assert.rejects(()=>recovery.authenticateRawHistory({stateRoot:state,root:cleanupRoot,repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'cleanup-failure.json')}));
    const failedCleanup=JSON.parse(fs.readFileSync(path.join(root,'cleanup-failure.json')));
    assert.equal(failedCleanup.state,'held');assert.equal(failedCleanup.cleanupVerified,false);
  }finally{fs.rmSync=originalRemove;}
  assert.equal(fs.readFileSync(path.join(state,'encrypted-chunks.json'),'utf8'),oldManifest.toString());
  const shallowFile=path.join(state,'.git','shallow');fs.writeFileSync(shallowFile,first+'\n');
  await assert.rejects(()=>recovery.authenticateRawHistory({stateRoot:state,root:path.join(root,'shallow'),repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'shallow.json')}),/shallow/);
  fs.unlinkSync(shallowFile);
  await assert.rejects(()=>recovery.authenticateRawHistory({stateRoot:state,root:state,repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'unsafe.json')}),/fresh isolated/);
  const alias=path.join(root,'custody-alias');fs.symlinkSync(state,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>recovery.authenticateRawHistory({stateRoot:state,root:path.join(alias,'scratch'),repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'alias-report.json')}),/fresh isolated/);
  await assert.rejects(()=>recovery.authenticateRawHistory({stateRoot:state,root:path.join(root,'overwrite'),repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'report.json')}),/fresh isolated/);
  const chunk=JSON.parse(oldManifest).chunks[0].name;fs.appendFileSync(path.join(state,chunk),'tampered');commit(state);
  const damaged=await recovery.authenticateRawHistory({stateRoot:state,root:path.join(root,'damaged'),repository,ref,revision:'a'.repeat(40),reportFile:path.join(root,'damaged.json')});
  assert.equal(damaged.state,'held');assert.ok(damaged.failedOccurrences>0);
  assert.ok(damaged.occurrences.some(o=>o.failureCode==='OPS-0049'&&o.phase==='ciphertext'));
  assert.equal(git(state,'status','--porcelain'),'');
});
test('historical diagnostic workflow stays RAW-only read-only and does not export plaintext or keys',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'..','.github/workflows/retained-custody-inventory.yml'),'utf8').split('  inventory:')[0];
  assert.match(workflow,/authenticate-raw-history/);assert.match(workflow,/--no-checkout --no-single-branch/);
  assert.match(workflow,/refs\/pull\/\*\/head/);assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/npm ci --ignore-scripts/);assert.match(workflow,/if: always\(\)/);
  assert.doesNotMatch(workflow,/git push|gh secret set|VETTED_BUNDLE_KEY|contents: write|learning:|r2FailoverProof/);
  assert.match(workflow,/path: custody-history\/raw-authentication\.json/);
});
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
  const root=rootFixture(t),keys=['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_VETTED_BUNDLE_KEY','CRUCIBLE_HOSTED_STORE_KEY','CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS','CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS'],prior=keys.map(k=>process.env[k]);
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
  const originalBackupHash=digest(fs.readFileSync(encrypted));await assert.rejects(()=>recovery.seal({root:work,output:encrypted,repository,ref,reportFile}),/fresh recovery capsule/);assert.equal(digest(fs.readFileSync(encrypted)),originalBackupHash);
  for(const key of ['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_VETTED_BUNDLE_KEY'])await assert.rejects(()=>bundle.decrypt({input:encrypted,output:path.join(root,`${key}-alone.tar.gz`),repository,ref,keyNames:[key]}));
  const saved=process.env.CRUCIBLE_VETTED_BUNDLE_KEY,savedPrevious=process.env.CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS;delete process.env.CRUCIBLE_VETTED_BUNDLE_KEY;delete process.env.CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS;
  await assert.rejects(()=>recovery.restoreBackup({input:encrypted,root:path.join(root,'missing-family'),repository,ref,revision,reportFile:path.join(root,'missing.json')}),/two distinct/);process.env.CRUCIBLE_VETTED_BUNDLE_KEY=saved;process.env.CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS=savedPrevious;
  for(const item of [rawRoot,vettedRoot,coreRoot,retainedRoot,work,researchRoot])fs.rmSync(item,{recursive:true});
  const restored=await recovery.restoreBackup({input:encrypted,root:path.join(root,'fresh-runner'),repository,ref,revision,reportFile:path.join(root,'restored.json')});
  assert.equal(restored.state,'uploaded-backup-restored-and-replayed');assert.equal(restored.postDigest,report.preDigest);
  assert.equal(restored.populations.raw.sourceAndExtractionProgressDigest,report.populations.raw.sourceAndExtractionProgressDigest);
  assert.equal(restored.zeroKnowledgeLossVerified,false);assert.equal(restored.independentSecurityPrincipal,false);
  const originalKeys=keys.map(k=>process.env[k]);
  for(const base of ['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_VETTED_BUNDLE_KEY']){process.env[`${base}_PREVIOUS`]=process.env[base];process.env[base]=crypto.randomBytes(32).toString('base64');}
  const rotated=await recovery.restoreBackup({input:encrypted,root:path.join(root,'rotated-restore'),repository,ref,revision,reportFile:path.join(root,'rotated.json')});
  assert.equal(rotated.postDigest,report.preDigest);assert.deepEqual(rotated.recoveryKeyFamiliesUsed,['CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS','CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS']);
  keys.forEach((key,i)=>process.env[key]=originalKeys[i]);
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

test('downloaded recovery artifact requires exactly two regular expected members',t=>{
  const root=rootFixture(t);fs.writeFileSync(path.join(root,'recovery-custody.enc'),'encrypted fixture');fs.writeFileSync(path.join(root,'recovery-report.json'),'{}');
  recovery.validateDownloadedBackup(root);fs.writeFileSync(path.join(root,'unexpected'),'extra');assert.throws(()=>recovery.validateDownloadedBackup(root),/members differ/);
  fs.unlinkSync(path.join(root,'unexpected'));fs.unlinkSync(path.join(root,'recovery-report.json'));assert.throws(()=>recovery.validateDownloadedBackup(root),/members differ/);
});
test('artifact ZIP members at archive root restore with exact original bytes',t=>{
  const root=rootFixture(t),archive=path.join(root,'artifact.zip'),target=path.join(root,'unpacked');
  const python=process.env.CRUCIBLE_RECOVERY_PYTHON||(process.platform==='win32'?'python':'python3');
  const code="import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('recovery-custody.enc',b'encrypted-original')\n z.writestr('recovery-report.json',b'{}')\n";
  const made=spawnSync(python,['-c',code,archive],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
  recovery.extract(archive,target,'backup-zip');assert.equal(fs.readFileSync(path.join(target,'recovery-custody.enc'),'utf8'),'encrypted-original');recovery.validateDownloadedBackup(target);
});
