'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pack, prepare, stageRequest } = require('../src/ownerFileTransport');
const { stage, sha256File, encrypt, decrypt, splitEncrypted, joinEncrypted, verifyRestored } = require('../src/hostedSourceBundle');
const { publishCiphertext } = require('../src/rawCustodyPublisher');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const repository = '6076446993/The-Crucible', ref = 'refs/heads/development', projectId = 'github:jonathanblunt1214-lgtm/The-Crucible';
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex'); const read = (x) => JSON.parse(fs.readFileSync(x, 'utf8'));
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-transport-proof-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const priorKey = process.env.CRUCIBLE_SOURCE_BUNDLE_KEY; process.env.CRUCIBLE_SOURCE_BUNDLE_KEY = crypto.randomBytes(32).toString('base64'); t.after(()=>{if(priorKey===undefined)delete process.env.CRUCIBLE_SOURCE_BUNDLE_KEY;else process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=priorKey;});
 const original=path.join(root,'original');fs.mkdirSync(original);const prior=path.join(original,'prior.txt');fs.writeFileSync(prior,'Existing source bytes must remain unchanged during new owner intake.');
 const queueFile=path.join(original,'source-queue.json');const source={id:'prior',durablePath:prior,contentSha256:sha256File(prior),mediaType:'text/plain',state:'claim-extraction-complete',claimExtraction:{candidateIds:[]}};
 fs.writeFileSync(queueFile,JSON.stringify({schemaVersion:1,projectId,documents:[source],links:[]}));const worker=new ClaimExtractionWorker({queueFile,projectId,learningRoot:original});worker.store.ingest(worker.candidate(source,'Existing candidates must remain unchanged throughout owner file transport.','Existing evidence',new Date().toISOString()));
 const raw=path.join(root,'raw');stage({sourceRoot:original,learningFile:worker.store.file,stagingRoot:raw,repository,ref});
 const newFile=path.join(root,'new.txt');fs.writeFileSync(newFile,'A new supplied source requires independent verification before it can affect active knowledge.');const support=path.join(root,'catalog.json');fs.writeFileSync(support,JSON.stringify({status:'unverified',sources:[sha256File(newFile)]}));
 return {root,raw,newFile,support,request:path.join(root,'request.enc'),options:{root:raw,workingRoot:path.join(root,'working'),repository,ref,reportFile:path.join(root,'receipt.json')}};
}
async function request(f,files=[f.newFile]) {return pack({files,supportingFiles:[f.support],output:f.request,projectId,repository,ref});}
test('encrypted import retains migrated identity and existing candidates; repeat reports only duplicate',async t=>{
 const f=fixture(t);const p=await request(f);const m=read(path.join(f.raw,'manifest.json'));const before=sha256File(path.join(f.raw,'source-queue.json'));const learning=fs.readFileSync(path.join(f.raw,m.learningFile));
 const r=await prepare({...f.options,encryptedRequest:f.request,expectedRequestSha256:p.requestSha256});assert.equal(r.projectId,projectId);assert.equal(r.admitted.length,1);assert.equal(r.admitted[0].state,'claim-extraction-forced-pending');assert.equal(r.publicationStatus,'PREPARED_NOT_PUBLISHED');assert.equal(r.promotionAuthorized,false);assert.equal(r.supportingArtifacts.length,1);
 assert.equal(sha256File(path.join(f.raw,'source-queue.json')),before);assert.deepEqual(fs.readFileSync(path.join(f.options.workingRoot,m.learningFile)),learning);assert.equal(read(path.join(f.options.workingRoot,'source-queue.json')).documents.length,2);
 const repeat=await prepare({...f.options,root:f.options.workingRoot,workingRoot:path.join(f.root,'repeat'),encryptedRequest:f.request,expectedRequestSha256:p.requestSha256});assert.equal(repeat.admitted.length,0);assert.equal(repeat.alreadyPresent.length,1);assert.equal(repeat.changed,false);
 const content=fs.readFileSync(f.request);assert.equal(content.includes(Buffer.from('A new supplied source')),false);
});
test('request hash, tampering, wrong key and project mismatch refuse before a working queue exists',async t=>{
 const f=fixture(t);const p=await request(f);const opts={...f.options,encryptedRequest:f.request,expectedRequestSha256:p.requestSha256};
 await assert.rejects(prepare({...opts,expectedRequestSha256:'0'.repeat(64)}),/approved hash/);assert.equal(fs.existsSync(f.options.workingRoot),false);
 const k=process.env.CRUCIBLE_SOURCE_BUNDLE_KEY;process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=crypto.randomBytes(32).toString('base64');await assert.rejects(prepare(opts),/key|ciphertext/i);process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=k;
 await assert.rejects(prepare({...opts,repository:'foreign/repo'}),/identity/);
 fs.appendFileSync(f.request,'tamper');await assert.rejects(prepare(opts),/approved hash/);assert.equal(fs.existsSync(f.options.workingRoot),false);
});
test('live locks and in-place snapshots are preserved and refused',async t=>{
 const f=fixture(t);const p=await request(f);const opts={...f.options,encryptedRequest:f.request,expectedRequestSha256:p.requestSha256};
 const lock=path.join(f.raw,'source-queue.json.claim-extraction.lock');fs.writeFileSync(lock,'live-owner');await assert.rejects(prepare(opts),/unresolved worker lock/);assert.equal(fs.readFileSync(lock,'utf8'),'live-owner');fs.unlinkSync(lock);
 await assert.rejects(prepare({...opts,workingRoot:f.raw}),/new and separate/);assert.equal(fs.existsSync(f.options.workingRoot),false);
});
test('authenticated but malformed request cannot escape paths or forge source bytes',async t=>{
 const f=fixture(t);await request(f);const plain=path.join(f.root,'decoded.json');await decrypt({input:f.request,output:plain,repository,ref,keyNames:['CRUCIBLE_SOURCE_BUNDLE_KEY']});const r=read(plain);r.sources[0].originalName='../escape.txt';fs.writeFileSync(plain,JSON.stringify(r));const bad=path.join(f.root,'bad.enc');await encrypt({input:plain,output:bad,projectId,repository,ref});
 await assert.rejects(prepare({...f.options,encryptedRequest:bad,expectedRequestSha256:sha256File(bad)}),/filename/);assert.equal(fs.existsSync(f.options.workingRoot),false);
 r.sources[0].originalName='safe.txt';r.sources[0].sha256='f'.repeat(64);fs.writeFileSync(plain,JSON.stringify(r));const altered=path.join(f.root,'altered.enc');await encrypt({input:plain,output:altered,projectId,repository,ref});await assert.rejects(prepare({...f.options,encryptedRequest:altered,expectedRequestSha256:sha256File(altered)}),/approved metadata/);
});
test('candidate-only snapshot reencrypts and publishes by prior-hash lease with rollback intact',async t=>{
 const f=fixture(t);const p=await request(f);await prepare({...f.options,encryptedRequest:f.request,expectedRequestSha256:p.requestSha256});
 const state=path.join(f.root,'state'),incoming=path.join(f.root,'incoming');
 for(const [custody,stem,folder] of [[f.raw,'old',state],[f.options.workingRoot,'new',incoming]]){
  const m=read(path.join(custody,'manifest.json'));const archive=path.join(f.root,stem+'.tar.gz');const encrypted=path.join(f.root,stem+'.enc');
  execFileSync('tar',['-czf',archive,'-C',custody,'manifest.json','source-queue.json','sources',m.learningFile]);
  await encrypt({input:archive,output:encrypted,projectId,repository,ref});splitEncrypted({input:encrypted,outputRoot:folder});
 }
 const prior=sha256File(path.join(state,'encrypted-chunks.json'));const r=publishCiphertext({ciphertextRoot:incoming,stateRoot:state,expectedPriorManifestSha256:prior,repository,ref});assert.equal(r.authorizesPromotion,false);assert.equal(sha256File(path.join(state,r.rollbackManifest)),prior);
 assert.throws(()=>publishCiphertext({ciphertextRoot:incoming,stateRoot:state,expectedPriorManifestSha256:prior,repository,ref}),/moved since restoration/);
 const joined=path.join(f.root,'published.enc');joinEncrypted({inputRoot:state,output:joined});const archive=path.join(f.root,'published.tar.gz');await decrypt({input:joined,output:archive,repository,ref,keyNames:['CRUCIBLE_SOURCE_BUNDLE_KEY']});const restored=path.join(f.root,'fresh');fs.mkdirSync(restored);execFileSync('tar',['-xzf',archive,'-C',restored]);
 const verified=verifyRestored({root:restored,repository,ref,reportFile:path.join(f.root,'verified.json')});assert.equal(verified.documents,2);assert.equal(verified.projectId,projectId);assert.equal(verified.vetted,false);assert.equal(read(path.join(restored,'source-queue.json')).documents.filter(x=>x.state==='claim-extraction-forced-pending').length,1);
});

test('request staging stores ciphertext idempotently and never touches the queue manifest', async t => {
 const f=fixture(t),p=await request(f);const state=path.join(f.root,'state');fs.mkdirSync(state);fs.writeFileSync(path.join(state,'encrypted-chunks.json'),'{"retained":true}');const before=sha256File(path.join(state,'encrypted-chunks.json'));
 const options={encryptedRequest:f.request,expectedRequestSha256:p.requestSha256,stateRoot:state,repository,ref};const a=stageRequest(options);assert.equal(a.publicationStatus,'STAGED_NOT_PUSHED');assert.equal(stageRequest(options).relativePath,a.relativePath);assert.equal(sha256File(path.join(state,a.relativePath)),p.requestSha256);assert.equal(sha256File(path.join(state,'encrypted-chunks.json')),before);
 assert.throws(()=>stageRequest({...options,expectedRequestSha256:'0'.repeat(64)}),/approved hash/);
});
