const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { ClaimExtractionWorker } = require('./claimExtractionWorker');
const { inspectLock } = require('./durableLock');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertIsolatedPaths({ proofRoot, queueFile, learningRoot }) {
  const root = path.resolve(proofRoot); const queue = path.resolve(queueFile); const learning = path.resolve(learningRoot);
  if (root === path.parse(root).root) throw new Error('R2 proof root may not be a filesystem root.');
  for (const target of [queue, learning]) if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`R2 proof path escapes isolated root: ${target}`);
  return { root, queue, learning };
}

function makeCanary(root, projectId) {
  fs.mkdirSync(root, { recursive:true }); const sourceDir = path.join(root, 'sources'); fs.mkdirSync(sourceDir, { recursive:true });
  const body = 'A durable learning worker must preserve persisted progress when execution ownership changes after an interruption. The resumed worker should continue bounded extraction without duplicating candidate identities.';
  const contentSha256 = sha256(body); const durablePath = path.join(sourceDir, `${contentSha256}.txt`); fs.writeFileSync(durablePath, body);
  const queueFile = path.join(root, 'source-queue.json'); const learningRoot = path.join(root, 'learning-store'); const sourceId = `r2-canary-${contentSha256.slice(0,16)}`;
  fs.writeFileSync(queueFile, `${JSON.stringify({schemaVersion:1,projectId,updatedAt:new Date().toISOString(),documents:[],links:[{id:sourceId,state:'claim-extraction-forced-pending',url:'https://r2-proof.invalid/canary',finalUrl:'https://r2-proof.invalid/canary',contentType:'text/plain',mediaType:'text/plain',contentSha256,durablePath,retrievedAt:new Date().toISOString()}]},null,2)}\n`);
  return { queueFile, learningRoot, sourceId, contentSha256 };
}

function childWorker(role, options) {
  const { queueFile, learningRoot, projectId, sourceId } = options; const lockFile = `${queueFile}.claim-extraction.lock`;
  if (role === 'primary') {
    const worker = new ClaimExtractionWorker({ queueFile, projectId, learningRoot, sourceId, maximumSources:1, maximumDocuments:1 });
    worker.extractText = () => { if (process.send) process.send({type:'checkpoint',pid:process.pid}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); };
    worker.run(); return;
  }
  if (role === 'standby') {
    (async()=>{ let announced=false; for (;;) { if (fs.existsSync(lockFile)) { const state=inspectLock(lockFile); if (!announced && state.owner) { announced=true; if(process.send) process.send({type:'standby-ready',ownerPid:state.owner.pid}); } if (state.reclaimable) break; } await sleep(250); }
      const worker=new ClaimExtractionWorker({queueFile,projectId,learningRoot,sourceId,maximumSources:1,maximumDocuments:1}); const outcomes=worker.run(); if(process.send) process.send({type:'standby-complete',outcomes,reclaimed:worker.lastLockReclamation});
    })().catch((error)=>{ if(process.send) process.send({type:'error',message:error.message}); process.exitCode=1; });
  }
}

async function runR2FailoverProof({ proofRoot = fs.mkdtempSync(path.join(os.tmpdir(),'crucible-r2-failover-')), projectId='github:6076446993/The-Crucible', reportFile=path.resolve('hosted-learning-proof/r2-failover.json') }={}) {
  const canary=makeCanary(proofRoot,projectId); assertIsolatedPaths({proofRoot,queueFile:canary.queueFile,learningRoot:canary.learningRoot});
  const options={...canary,projectId}; const env={...process.env,CRUCIBLE_R2_OPTIONS:Buffer.from(JSON.stringify(options)).toString('base64url')};
  const primary=fork(__filename,['child','primary'],{env,stdio:['ignore','inherit','inherit','ipc']});
  const checkpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Primary never persisted the R2 checkpoint.')),10000); primary.on('message',(m)=>{if(m?.type==='checkpoint'){clearTimeout(timer);resolve(m);}}); primary.on('exit',(c)=>{if(c!==null&&c!==0) reject(new Error(`Primary exited before checkpoint (${c}).`));});});
  const persisted=JSON.parse(fs.readFileSync(canary.queueFile,'utf8')).links[0]; if(persisted.state!=='claim-extraction-in-progress'||persisted.claimExtraction?.attempts!==1) throw new Error('Primary checkpoint was not durably persisted before failover.');
  const standby=fork(__filename,['child','standby'],{env,stdio:['ignore','inherit','inherit','ipc']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Standby never observed the live primary lock.')),10000); standby.on('message',(m)=>{if(m?.type==='standby-ready'){clearTimeout(timer);resolve(m);}});});
  primary.kill('SIGKILL'); await new Promise((resolve)=>primary.once('exit',resolve));
  const completed=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Standby did not complete bounded failover.')),60000); standby.on('message',(m)=>{if(m?.type==='standby-complete'){clearTimeout(timer);resolve(m);} if(m?.type==='error'){clearTimeout(timer);reject(new Error(m.message));}});});
  const finalQueue=JSON.parse(fs.readFileSync(canary.queueFile,'utf8')); const finalSource=finalQueue.links[0];
  const repeat=new ClaimExtractionWorker({queueFile:canary.queueFile,projectId,learningRoot:canary.learningRoot,sourceId:canary.sourceId,maximumSources:1,maximumDocuments:1}).run();
  const passed=finalSource.state==='claim-extraction-complete'&&finalSource.claimExtraction.attempts===2&&finalSource.claimExtraction.candidateIds.length>0&&new Set(finalSource.claimExtraction.candidateIds).size===finalSource.claimExtraction.candidateIds.length&&repeat.length===0&&completed.reclaimed?.pid===checkpoint.pid;
  const report={schemaVersion:1,gate:'R2',proof:'isolated-live-worker-failover',passed,productionStateWritable:false,productionStateReferenced:false,projectId,sourceId:canary.sourceId,contentSha256:canary.contentSha256,primaryPid:checkpoint.pid,reclaimedOwner:completed.reclaimed||null,attempts:finalSource.claimExtraction.attempts,candidateIds:finalSource.claimExtraction.candidateIds,idempotentRepeatProcessed:repeat.length,authorizesPromotion:false};
  fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile,`${JSON.stringify(report,null,2)}\n`); if(!passed) throw new Error('R2 isolated failover proof did not satisfy every invariant.'); return report;
}

if (require.main===module) { if(process.argv[2]==='child'){const options=JSON.parse(Buffer.from(process.env.CRUCIBLE_R2_OPTIONS,'base64url').toString('utf8')); childWorker(process.argv[3],options);} else runR2FailoverProof().then((r)=>console.log(JSON.stringify(r,null,2))).catch((e)=>{console.error(`[The Crucible] R2 failover proof failed closed: ${e.message}`);process.exitCode=1;}); }
module.exports={assertIsolatedPaths,makeCanary,runR2FailoverProof};
