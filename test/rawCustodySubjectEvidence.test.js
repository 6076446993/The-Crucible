'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {indexRestoredEvidence}=require('../scripts/rawCustodySubjectEvidence');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-subject-evidence-'));try{return fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}}
function make(root,items){
 const bytes=Buffer.from(JSON.stringify({payload:{candidateRecords:items}}));
 fs.writeFileSync(path.join(root,'learning.json'),bytes);
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({learningFile:'learning.json',learningSha256:sha(bytes)}));
 return bytes;
}
const candidate=(id,sourceId,contentSha256)=>({candidate:{id,provenance:{sourceId,contentSha256}}});
function subjects(items,groups){
 const ids=items.map(x=>x.candidate.id);
 return {identityDigest:sha(JSON.stringify([...ids].sort())),entries:items.map((item,i)=>({originalIndex:i,originalCandidateIdSha256:sha(item.candidate.id),suggestedSubjects:groups[i],primarySubject:groups[i][0]||'UNASSIGNED'}))};
}
test('one evidence digest can support two original candidates and two subjects without mutation',()=>fixture(root=>{
 const content=sha('exact evidence');
 const records=[candidate('id-one','source-one',content),candidate('id-two','source-two',content),candidate('id-three','source-one',sha('other evidence'))];
 const before=make(root,records);
 const {summary,privateRefs}=indexRestoredEvidence(root,subjects(records,[['S02'],['S06'],['S02','S06']]));
 assert.equal(summary.originalCandidates,3);
 assert.equal(summary.distinctEvidenceDigests,2);
 assert.equal(summary.reusedEvidenceDigests,1);
 assert.equal(summary.additionalReferencesToSharedEvidence,1);
 assert.equal(summary.crossSubjectEvidenceDigests,2);
 assert.equal(summary.subjects.S02.candidateReferences,2);
 assert.equal(summary.physicalDuplicateBytesVerified,null);
 assert.equal(summary.deduplicationPerformed,false);
 assert.equal(privateRefs.length,3);
 assert.deepEqual(fs.readFileSync(path.join(root,'learning.json')),before);
}));
test('rejects missing or reordered candidate identities',()=>fixture(root=>{
 const records=[candidate('a','source',sha('c'))];
 make(root,records);const index=subjects(records,[['S03']]);
 index.entries[0].originalCandidateIdSha256=sha('other');
 assert.throws(()=>indexRestoredEvidence(root,index),/identity or order/);
 index.entries[0].originalCandidateIdSha256=sha('a');
 index.entries=[];
 assert.throws(()=>indexRestoredEvidence(root,index),/population mismatch/);
}));
test('rejects missing content hashes and archive tampering',()=>fixture(root=>{
 const records=[candidate('a','source','invalid')];
 make(root,records);const index=subjects(records,[['S03']]);
 assert.throws(()=>indexRestoredEvidence(root,index),/provenance invalid/);
 fs.writeFileSync(path.join(root,'learning.json'),'tampered');
 assert.throws(()=>indexRestoredEvidence(root,index),/Authenticated learning hash mismatch/);
}));
