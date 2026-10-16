'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const storage=require('../src/evidenceStorage');
const {AtomicClaimExtractionQueue,ClaimExtractionWorker}=require('../src/claimExtractionWorker');
const {preservedReplace,replayFile,hashFile}=require('../src/recoverySystem');
const catalog={subjects:['LEE-S-001'],evidenceTypes:['LEE-E-001']};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-evidence-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('A compiler returns another representation of source code.');
  const source={id:'original-source',durablePath:'original.txt',url:'https://example.org/source',contentSha256:storage.digest(bytes),mediaType:'text/plain',retrievedAt:'2026-08-30T20:00:00.000Z',state:'claim-extraction-forced-pending',claimExtraction:{attempts:0,candidateIds:[]},license:'retained terms'};
  const file=path.join(root,'queue.json');
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,projectId:'github:owner/repo',documents:[],links:[source]}));
  const objectStore=new storage.EncryptedEvidenceObjects({root,projectId:'github:owner/repo',securityDomain:'private-source',key:Buffer.alloc(32,7),keyId:'test-key'});
  const queue=new AtomicClaimExtractionQueue(file,'github:owner/repo');
  const args={sourceId:source.id,sourceBytes:bytes,securityDomain:'private-source',catalog,subjectCodes:catalog.subjects,evidenceTypeCodes:catalog.evidenceTypes,observationId:'observation-1',objectStore};
  return{root,bytes,source,file,objectStore,queue,args};
}
function sign(statement,privateKey){return{statement,signature:crypto.sign(null,Buffer.from(storage.canonical(statement)),privateKey).toString('base64')};}
test('native registration retains legacy sources, reuses encrypted bytes and rejects stale generations',t=>{
  const f=fixture(t),before=f.queue.read();
  const first=f.queue.registerEvidence({...f.args,expectedQueueSha256:hashFile(f.file).sha256});
  assert.equal(first.changed,true);assert.equal(first.objectCreated,true);
  const after=f.queue.read();assert.deepEqual(after.links,before.links);
  assert.equal(after.leeRegistry.aliases[0].legacyId,f.source.id);
  assert.equal(after.leeRegistry.aliases[0].originatedAt,f.source.retrievedAt);
  assert.deepEqual(f.objectStore.read(f.source.contentSha256),f.bytes);
  const retry=f.queue.registerEvidence({...f.args,expectedQueueSha256:first.queueSha256});
  assert.equal(retry.changed,false);assert.equal(retry.objectCreated,false);assert.equal(retry.leeId,first.leeId);
  assert.throws(()=>f.queue.registerEvidence({...f.args,expectedQueueSha256:'0'.repeat(64)}),/generation changed/);
  assert.throws(()=>f.queue.registerEvidence({...f.args,sourceBytes:Buffer.from('altered'),expectedQueueSha256:first.queueSha256}),/verified original bytes/);
  assert.deepEqual(f.queue.read(),after);
});
test('distinct native candidate claims retain identities while sharing one verified source object',t=>{
  const f=fixture(t),worker=new ClaimExtractionWorker({queueFile:f.file,projectId:'github:owner/repo',learningRoot:path.join(f.root,'learning'),extractText:()=>f.bytes.toString()+' A function returns a value to its caller.'});
  const ids=worker.run()[0].candidateIds;assert.equal(ids.length,2);
  const original=worker.store.read(),lee=[];
  for(const [i,id] of ids.entries())lee.push(f.queue.registerEvidence({...f.args,candidateId:id,learningStore:worker.store,observationId:`candidate-${i}`,expectedQueueSha256:hashFile(f.file).sha256}));
  assert.notEqual(lee[0].leeId,lee[1].leeId);assert.equal(lee[1].objectCreated,false);
  assert.deepEqual(worker.store.read(),original);
  assert.deepEqual(f.queue.read().leeRegistry.aliases.map(x=>x.legacyId),ids);
  const partial=f.queue.reconcileEvidence({expectedQueueSha256:hashFile(f.file).sha256,objectStore:f.objectStore,learningStore:worker.store});
  assert.equal(partial.complete,false);assert.deepEqual(partial.missing,[{kind:'source',legacyId:f.source.id}]);
  f.queue.registerEvidence({...f.args,expectedQueueSha256:hashFile(f.file).sha256});
  const complete=f.queue.reconcileEvidence({expectedQueueSha256:hashFile(f.file).sha256,objectStore:f.objectStore,learningStore:worker.store});
  assert.equal(complete.complete,true);assert.equal(complete.verified,3);assert.equal(complete.independentRestorationVerified,false);assert.equal(complete.cleanupAuthorized,false);
  const copy=path.join(f.root,'isolated-objects');fs.mkdirSync(copy);
  fs.cpSync(f.objectStore.root,path.join(copy,path.basename(f.objectStore.root)),{recursive:true});
  const restored=new storage.EncryptedEvidenceObjects({root:copy,projectId:'github:owner/repo',securityDomain:'private-source',key:Buffer.alloc(32,7),keyId:'test-key'});
  assert.deepEqual(f.queue.reconcileEvidence({expectedQueueSha256:hashFile(f.file).sha256,objectStore:restored,learningStore:worker.store}),complete);
});
test('held native locks and the production recovery hold cannot be bypassed',t=>{
  const f=fixture(t),held=f.queue.lock();
  try{assert.throws(()=>f.queue.registerEvidence({...f.args,expectedQueueSha256:hashFile(f.file).sha256}),/lock/i);}finally{held.release();}
  const real=new AtomicClaimExtractionQueue(f.file,'github:jonathanblunt1214-lgtm/The-Crucible');
  assert.throws(()=>real.registerEvidence(f.args),/recovery|restart|P0/i);
});
test('queue, registry and journal recover as one exact generation after an interrupted durable intent',t=>{
  const f=fixture(t);f.queue.registerEvidence({...f.args,expectedQueueSha256:hashFile(f.file).sha256});
  const before=fs.readFileSync(f.file),after=Buffer.from(JSON.stringify({...f.queue.read(),updatedAt:'retained recovery generation'}));
  assert.throws(()=>preservedReplace(f.file,after,()=>fs.writeFileSync(f.file,after),phase=>{if(phase==='intent-durable')throw Error('simulated interruption');}),/simulated/);
  assert.deepEqual(fs.readFileSync(f.file),before);assert.throws(()=>f.queue.read(),/replay|interrupted|incomplete/i);
  replayFile(f.file,storage.digest(after));
  const restored=f.queue.read();assert.equal(restored.updatedAt,'retained recovery generation');
  assert.equal(storage.validateRegistry(restored.leeRegistry).sequence,1);
  assert.deepEqual(restored.links[0],f.source);
});
test('journal replay rejects changed aliases, forks and observation conflicts',t=>{
  const f=fixture(t);f.queue.registerEvidence({...f.args,expectedQueueSha256:hashFile(f.file).sha256});
  const state=f.queue.read().leeRegistry,altered=structuredClone(state);altered.aliases[0].legacyId='rewritten';
  assert.throws(()=>storage.validateRegistry(altered),/replay/);
  const fork=structuredClone(state);fork.journal[0].previousSha256='f'.repeat(64);assert.throws(()=>storage.validateRegistry(fork),/fork/);
  assert.throws(()=>storage.register(state,{...state.journal[0].registration,recordSha256:'f'.repeat(64)}),/observation ID conflict/);
});
test('independent checkpoint verifies a historic anchor without granting retention or cleanup authority',t=>{
  const f=fixture(t);f.queue.registerEvidence({...f.args,expectedQueueSha256:hashFile(f.file).sha256});
  const state=f.queue.read().leeRegistry,{publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),pem=publicKey.export({type:'spki',format:'pem'});
  const checkpoint=sign({schemaVersion:1,projectId:state.projectId,securityDomain:state.securityDomain,signer:'independent',purpose:'lee-journal-checkpoint',catalogSha256:storage.digest(catalog),...storage.validateRegistry(state)},privateKey);
  const result=storage.verifyCheckpoint(state,checkpoint,{publicKey:pem,signer:'independent',workerIdentity:'worker'});
  assert.equal(result.signedCheckpointVerified,true);assert.equal(result.independentStorageProtectionVerified,false);assert.equal(result.cleanupAuthorized,false);
  assert.throws(()=>storage.verifyCheckpoint(state,checkpoint,{publicKey:pem,signer:'independent',workerIdentity:'independent'}),/self-signed/);
  checkpoint.statement.sha256='0'.repeat(64);assert.throws(()=>storage.verifyCheckpoint(state,checkpoint,{publicKey:pem,signer:'independent',workerIdentity:'worker'}),/signature/);
});
test('ciphertext authentication and domain binding reject corruption; physical inventory reports only local allocation',t=>{
  const f=fixture(t),object=f.objectStore.put(f.bytes),file=f.objectStore.file(object.contentSha256);
  const inventory=storage.physicalInventory(f.objectStore.root);assert.equal(inventory.entries.length,1);assert.equal(inventory.logicalBytes,fs.statSync(file).size);assert.equal(inventory.remotePhysicalBytes,null);assert.equal(inventory.cleanupAuthorized,false);
  const envelope=JSON.parse(fs.readFileSync(file));envelope.ciphertext=Buffer.from('corrupted').toString('base64');fs.writeFileSync(file,JSON.stringify(envelope));assert.throws(()=>f.objectStore.read(object.contentSha256),/authentication/);
});
test('signed no-change observations preserve new events and refuse content changes, expiry and tampering',()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),pem=publicKey.export({type:'spki',format:'pem'});
  const base={schemaVersion:1,projectId:'project',securityDomain:'private',signer:'oversight',purpose:'vetted-content-identity',workerPlaintextSha256:'a'.repeat(64),queueSha256:'b'.repeat(64),learningSha256:'c'.repeat(64),decisionsSha256:'d'.repeat(64),eventSha256:'e'.repeat(64),ciphertextSha256:'f'.repeat(64),keyId:'key'};
  function verify(changes={},receiptChanges={}){
    const current={...base,eventSha256:'1'.repeat(64),...changes};
    const receipt={schemaVersion:1,projectId:'project',securityDomain:'private',signer:'oversight',purpose:'vetted-no-change-observation',previousStatementSha256:storage.digest(base),currentStatementSha256:storage.digest(current),previousEventSha256:base.eventSha256,currentEventSha256:current.eventSha256,reusedCiphertextSha256:base.ciphertextSha256,issuedAt:'2026-10-16T20:00:00Z',expiresAt:'2026-10-16T22:00:00Z',...receiptChanges};
    return storage.verifyNoChangePublication({previous:sign(base,privateKey),current:sign(current,privateKey),receipt:sign(receipt,privateKey),publicKey:pem,signer:'oversight',workerIdentity:'worker',projectId:'project',securityDomain:'private',now:Date.parse('2026-10-16T21:00:00Z')});
  }
  const result=verify();assert.equal(result.reuseCiphertext,true);assert.equal(result.eventChanged,true);assert.equal(result.mustRetainSignedObservation,true);assert.equal(result.publisherMutationAuthorized,false);
  assert.equal(verify({workerPlaintextSha256:'2'.repeat(64)}).reuseCiphertext,false);
  assert.equal(verify({keyId:'rotated'}).reuseCiphertext,false);
  assert.throws(()=>verify({},{expiresAt:'2026-10-16T20:30:00Z'}),/lifetime/);
  assert.throws(()=>verify({},{currentEventSha256:base.eventSha256}),/binding/);
});
test('a killed object publisher resumes only authenticated known temporary links without replacing ciphertext',t=>{
  const f=fixture(t),script=`
    const fs=require('node:fs');
    const {EncryptedEvidenceObjects}=require(${JSON.stringify(require.resolve('../src/evidenceStorage'))});
    const store=new EncryptedEvidenceObjects({root:process.argv[1],projectId:'github:owner/repo',securityDomain:'private-source',key:Buffer.alloc(32,7),keyId:'test-key'});
    const original=fs.linkSync;
    fs.linkSync=function(from,to){original(from,to);if(to.endsWith('.enc'))process.kill(process.pid,'SIGKILL');};
    store.put(Buffer.from(process.argv[2]));
  `;
  const child=spawnSync(process.execPath,['-e',script,f.root,f.bytes.toString()],{timeout:15000,encoding:'utf8'});
  assert.notEqual(child.status,0,child.stderr);
  const hash=storage.digest(f.bytes),file=f.objectStore.file(hash),before=fs.readFileSync(file);
  assert.throws(()=>f.objectStore.read(hash),/non-exclusive/);
  const lock=path.join(f.objectStore.root,'objects.lock'),old=new Date(Date.now()-61000);fs.utimesSync(lock,old,old);
  const result=f.objectStore.put(f.bytes);assert.equal(result.created,false);
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(f.objectStore.read(hash),f.bytes);
  assert.equal(fs.readdirSync(f.objectStore.root).some(x=>x.startsWith('.pending-')),false);
  const foreign=path.join(f.root,'unknown-link');fs.linkSync(file,foreign);
  assert.throws(()=>f.objectStore.put(f.bytes),/unknown interrupted object links/);
  assert.deepEqual(fs.readFileSync(foreign),before);
});
