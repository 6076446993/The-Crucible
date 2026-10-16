'use strict';
/*
 * Full-history, read-only evidence-cost analysis. Git shallow/reachability is
 * explicitly surfaced. No plaintext, ciphertext bytes, or full custody reports
 * leave the isolated runner; output is aggregate statistics only.
 */
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const {compare}=require('./vettedSnapshotEquivalence');
const SHA=/^[0-9a-f]{40,64}$/,SUM=/^[0-9a-f]{64}$/;
const git=(root,...args)=>cp.execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:24*1024*1024,timeout:120000}).trim();
function summarize(rows) {
 const byCipher=new Map(),byChunk=new Map(),semanticRuns=[],revisions=[];
 let redundantVersions=0,redundantBytes=0,changedVersions=0,unresolved=0,logicalBytes=0,chunkBytes=0;
 let previous=null,lastSemantic=null,hasNew=false;
 for(const row of rows){
  if(!row.report||!row.manifest){unresolved++;continue;}
  const r=row.report,m=row.manifest;
  if(!SUM.test(m.encryptedSha256)||m.encryptedSha256!==r.vettedCiphertextSha256||
     !Number.isSafeInteger(m.encryptedBytes)||m.encryptedBytes<0||!Array.isArray(m.chunks)||!m.chunks.length) {
    unresolved++;previous=null;continue;
  }
  let sum=0,integrity=true;
  for(const c of m.chunks){
    if(!SUM.test(c.sha256)||!Number.isSafeInteger(c.bytes)||c.bytes<0){integrity=false;break;}
    sum+=c.bytes;
  }
  if(!integrity||sum!==m.encryptedBytes){unresolved++;previous=null;continue;}
  let cmp;
  try{cmp=previous?compare(previous,r):null; if(!cmp)compare(r,r);}
  catch(e){unresolved++;previous=null;continue;}
  const repeat=cmp?.redundantEncryptedPayloadSuspected===true;
  logicalBytes+=m.encryptedBytes;
  if(!byCipher.has(m.encryptedSha256))byCipher.set(m.encryptedSha256,m.encryptedBytes);
  for(const c of m.chunks)if(!byChunk.has(c.sha256)){byChunk.set(c.sha256,c.bytes);chunkBytes+=c.bytes;}
  if(repeat){redundantVersions++;redundantBytes+=m.encryptedBytes;}else changedVersions++;
  previous=r;
  revisions.push({commit:row.commit,semanticSameAsPrevious:repeat,payloadBytes:m.encryptedBytes});
 }
 return {
  schemaVersion:1,scope:'metadata-only reachable vetted custody publication history',
  revisionsInspected:rows.length,validatedVersions:changedVersions+redundantVersions,
  unresolvedRevisions:unresolved,consecutiveRedundantSemanticVersions:redundantVersions,
  changedOrFirstSemanticVersions:changedVersions,
  logicalEncryptedBytesAcrossValidatedVersions:logicalBytes,
  logicalBytesAssociatedWithRedundantSemanticVersions:redundantBytes,
  distinctCiphertextDigestCount:byCipher.size,
  distinctEncryptedChunkDigestCount:byChunk.size,
  distinctEncryptedChunkLogicalBytes:chunkBytes,
  nonConsecutiveEquivalenceNotAudited:true,
  physicalGitStorageBytes:null,storagePriceSavingsVerified:false,
  historicalDeletionAuthorized:false,automaticPublicationSkipAuthorized:false,
  originalCustodyOrSignaturesMutated:false,
  plaintextRead:false,ciphertextPayloadRead:false,
  explanation:'A redundant semantic payload can still represent an independently signed custody event. Preserve all receipts and historical versions unless separately authorized, independently backed up, and recovery-tested.'
 };
}
function run(repo,out) {
 const root=path.resolve(repo);
 const shallow=git(root,'rev-parse','--is-shallow-repository')==='true';
 if(shallow)throw Error('Refuse to claim full history based on shallow checkout');
 const commits=git(root,'rev-list','--reverse','HEAD').split('\n').filter(Boolean);
 const rows=[];
 for(const commit of commits){
  if(!SHA.test(commit))throw Error('Unexpected commit identity');
  let report=null,manifest=null;
  try{report=JSON.parse(git(root,'show',commit+':encrypted-custody-report.json'))}catch(e){}
  try{manifest=JSON.parse(git(root,'show',commit+':encrypted-chunks.json'))}catch(e){}
  rows.push({commit,report,manifest});
 }
 const result=summarize(rows);
 result.repository='6076446993/Crucible-Vetted-Learning-State';
 result.headCommit=git(root,'rev-parse','HEAD');
 result.fullHistoryTraversal=true;
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({revisions:result.revisionsInspected,valid:result.validatedVersions,redundant:result.consecutiveRedundantSemanticVersions,unknown:result.unresolvedRevisions,payloadBytesForRepeatedSemantics:result.logicalBytesAssociatedWithRedundantSemanticVersions}));
}
function selfTest(){
 const c=n=>n.repeat(64);
 function report(n=0) {return {schemaVersion:1,projectId:'test',sourceCiphertextSha256:c('a'),vettedCiphertextSha256:c(n===0?'b':'f'),queueSha256:c('c'),learningSha256:c('d'),sourceCount:1,approvedCount:1,quarantinedCount:0,sourceReviews:[{sourceId:'1',decision:'approved'}],decision:'approved',scientificProofSatisfied:true,promotionAuthorized:false,independentOversight:true,generatedAt:String(n),enforcedQuarantine:true,workerCandidateExport:{workerSha:'1'.repeat(40),priorVettedStateSha:'2'.repeat(40),generatedAt:String(n),plaintextSha256:c('e'),candidateCount:1,queueSourceCount:1,candidateOnly:true,independentlyValidated:true}};}
 const m=(n)=>({encryptedSha256:c(n===0?'b':'f'),encryptedBytes:4,chunks:[{sha256:c(n===0?'b':'f'),bytes:4}]});
 const r=summarize([{commit:'x',report:report(0),manifest:m(0)},{commit:'y',report:report(1),manifest:m(1)}]);
 if(r.validatedVersions!==2||r.consecutiveRedundantSemanticVersions!==1||r.logicalBytesAssociatedWithRedundantSemanticVersions!==4)throw Error('History aggregation self-test failed');
 const changed=report(1);changed.sourceReviews[0].decision='rejected';
 const x=summarize([{commit:'x',report:report(0),manifest:m(0)},{commit:'y',report:changed,manifest:m(1)}]);
 if(x.consecutiveRedundantSemanticVersions!==0)throw Error('Governance decision changes masked as redundancy');
 console.log('vetted historical redundancy aggregation self-test passed');
}
if(require.main===module){
 const a=process.argv.slice(2);
 if(a.length===1&&a[0]==='--self-test')selfTest();
 else if(a.length===2)run(a[0],a[1]);
 else throw Error('Usage: node scripts/vettedHistoryAggregate.js GIT_ROOT REPORT_PATH or --self-test');
}
module.exports={summarize};
