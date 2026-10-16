'use strict';
/*
 * Evidence-equivalence analysis only. This module cannot authorize a publication
 * skip: oversight signatures, retention, and lineage are independent controls.
 */
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const TOP_KEYS=['schemaVersion','projectId','sourceCiphertextSha256','vettedCiphertextSha256','queueSha256','learningSha256','sourceCount','approvedCount','quarantinedCount','sourceReviews','decision','scientificProofSatisfied','promotionAuthorized','independentOversight','generatedAt','enforcedQuarantine','workerCandidateExport'];
const WORKER_KEYS=['workerSha','priorVettedStateSha','generatedAt','plaintextSha256','candidateCount','queueSourceCount','candidateOnly','independentlyValidated'];
const SHA=/^[a-f0-9]{64}$/;
const GIT_OBJECT=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function exactShape(object,keys,label){
 if(!object||Array.isArray(object)||typeof object!=='object')throw Error(label+' must be an object');
 const actual=Object.keys(object).sort(),expected=[...keys].sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(label+' schema drift: refusing equivalence conclusion');
}
function canonical(v){
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
 return v;
}
function semantic(report) {
 exactShape(report,TOP_KEYS,'vetted custody report');
 exactShape(report.workerCandidateExport,WORKER_KEYS,'worker export');
 for(const field of ['sourceCiphertextSha256','vettedCiphertextSha256','queueSha256','learningSha256'])
   if(!SHA.test(report[field])) throw Error('Invalid custody hash '+field);
 if(!GIT_OBJECT.test(report.workerCandidateExport.workerSha)||!SHA.test(report.workerCandidateExport.plaintextSha256))
   throw Error('Invalid worker identity');
 if(!Array.isArray(report.sourceReviews)||report.sourceReviews.length!==report.sourceCount)
   throw Error('Incomplete oversight decisions');
 if(!Number.isSafeInteger(report.approvedCount)||!Number.isSafeInteger(report.quarantinedCount)||
    report.approvedCount+report.quarantinedCount!==report.sourceCount)
   throw Error('Oversight counts inconsistent');
 const {workerCandidateExport:worker,...rest}=report;
 const content={
   ...rest,
   workerCandidateExport:Object.fromEntries(WORKER_KEYS.filter(k=>!['priorVettedStateSha','generatedAt','plaintextSha256'].includes(k)).map(k=>[k,worker[k]]))
 };
 delete content.sourceCiphertextSha256;
 delete content.vettedCiphertextSha256;
 delete content.generatedAt;
 return content;
}
function compare(previous,current) {
 const a=semantic(previous),b=semantic(current);
 const oldFingerprint=hash(JSON.stringify(canonical(a)));
 const newFingerprint=hash(JSON.stringify(canonical(b)));
 return {
   schemaVersion:1,
   provenance:'oversight-vetted-custody',
   sameEvidenceAndDecision:oldFingerprint===newFingerprint,
   sameGovernedMetadata:oldFingerprint===newFingerprint,
   workerExportPlaintextSha256Changed:previous.workerCandidateExport.plaintextSha256!==current.workerCandidateExport.plaintextSha256,
   exactPayloadIdentityVerified:oldFingerprint===newFingerprint&&previous.workerCandidateExport.plaintextSha256===current.workerCandidateExport.plaintextSha256,
   historicalPlaintextEqualityUnproven:oldFingerprint===newFingerprint&&previous.workerCandidateExport.plaintextSha256!==current.workerCandidateExport.plaintextSha256,
   previousSemanticSha256:oldFingerprint,
   currentSemanticSha256:newFingerprint,
   ciphertextChanged:previous.vettedCiphertextSha256!==current.vettedCiphertextSha256,
   changeRequiresIndependentReview:oldFingerprint!==newFingerprint,
   redundantEncryptedPayloadSuspected:oldFingerprint===newFingerprint&&previous.vettedCiphertextSha256!==current.vettedCiphertextSha256,
   automaticSkipAuthorized:false,
   signingOrCustodyMutationAuthorized:false,
   historicalDeletionAuthorized:false,
   independentRecoveryVerified:false,
   explanation:'Matching governed metadata does not establish equal underlying plaintext when worker export digests differ. A signed custody event cannot be dropped; oversight must preserve event receipts and prove independent recovery before any publisher integration.'
 };
}
function fixture(){
 const h=c=>c.repeat(64);
 const x={schemaVersion:1,projectId:'test',sourceCiphertextSha256:h('a'),vettedCiphertextSha256:h('b'),queueSha256:h('c'),learningSha256:h('d'),sourceCount:1,approvedCount:1,quarantinedCount:0,sourceReviews:[{sourceId:'example',decision:'approved'}],decision:'approved',scientificProofSatisfied:true,promotionAuthorized:false,independentOversight:true,generatedAt:'2026-01-01',enforcedQuarantine:true,workerCandidateExport:{workerSha:h('e'),priorVettedStateSha:h('f'),generatedAt:'2026-01-01',plaintextSha256:h('1'),candidateCount:1,queueSourceCount:1,candidateOnly:true,independentlyValidated:true}};
 const y=JSON.parse(JSON.stringify(x));y.vettedCiphertextSha256=h('2');y.sourceCiphertextSha256=h('3');y.generatedAt='2026-01-02';y.workerCandidateExport.generatedAt='2026-01-02';y.workerCandidateExport.priorVettedStateSha=h('4');y.workerCandidateExport.plaintextSha256=h('5');
 if(!compare(x,y).redundantEncryptedPayloadSuspected||compare(x,y).automaticSkipAuthorized)throw Error('Equivalence fixture failed');
 y.sourceReviews[0].decision='rejected';
 if(compare(x,y).sameEvidenceAndDecision)throw Error('Decision change was ignored');
 y.sourceReviews[0].decision='approved';y.workerCandidateExport.candidateCount=2;
 if(compare(x,y).sameEvidenceAndDecision)throw Error('Candidate count change was ignored');
 const z={...x,newField:'unexpected'};try{compare(x,z);throw Error('Schema drift missed')}catch(e){if(!/schema drift/.test(e.message))throw e}
 console.log('vetted semantic equivalence tests passed');
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args[0]==='--self-test')fixture();
 else if(args.length===3){
   const previous=JSON.parse(fs.readFileSync(args[0],'utf8'));
   const next=JSON.parse(fs.readFileSync(args[1],'utf8'));
   const report=compare(previous,next);
   fs.writeFileSync(args[2],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
   console.log(JSON.stringify({sameEvidenceAndDecision:report.sameEvidenceAndDecision,redundantEncryptedPayloadSuspected:report.redundantEncryptedPayloadSuspected,automaticSkipAuthorized:false}));
 }else throw Error('Usage: node scripts/vettedSnapshotEquivalence.js previous.json current.json report.json OR --self-test');
}
module.exports={compare,semantic};
