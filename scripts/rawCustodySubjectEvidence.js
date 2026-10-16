'use strict';
// Read-only index: map authenticated candidates to evidence digests and research subjects.
// Digest reuse is not proof of duplicate files or recoverable storage bytes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const DIGEST=/^[a-f0-9]{64}$/;
function indexRestoredEvidence(root,subjects) {
 root=fs.realpathSync(root);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const location=path.resolve(root,manifest.learningFile);
 if(path.dirname(location)!==root)throw Error('Learning store escapes authenticated root');
 const bytes=fs.readFileSync(location),learnHash=hash(bytes);
 if(learnHash!==manifest.learningSha256)throw Error('Authenticated learning hash mismatch');
 const records=JSON.parse(bytes.toString('utf8'))?.payload?.candidateRecords;
 if(!Array.isArray(records)||!Array.isArray(subjects.entries)||subjects.entries.length!==records.length)throw Error('Candidate or subject population mismatch');
 const ids=records.map(x=>x?.candidate?.id);
 if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw Error('Original identities invalid');
 if(subjects.identityDigest!==hash(JSON.stringify([...ids].sort())))throw Error('Subject index identity checksum mismatch');
 const evidence=new Map(),sources=new Set(),perSubject=new Map(),privateRefs=[];
 for(let i=0;i<records.length;i++){
  const record=records[i],candidate=record.candidate,row=subjects.entries[i],id=ids[i],prov=candidate?.provenance;
  if(row?.originalIndex!==i||row.originalCandidateIdSha256!==hash(id))throw Error('Subject mapping changed identity or order');
  if(!DIGEST.test(prov?.contentSha256??'')||typeof prov?.sourceId!=='string'||!prov.sourceId)throw Error('Original evidence provenance invalid');
  if(!Array.isArray(row.suggestedSubjects)||new Set(row.suggestedSubjects).size!==row.suggestedSubjects.length||row.suggestedSubjects.some(s=>typeof s!=='string'||!s))throw Error('Malformed subjects');
  const digest=prov.contentSha256,sourceIdHash=hash(prov.sourceId);
  sources.add(sourceIdHash);
  const item=evidence.get(digest)||{references:0,subjects:new Set()};
  item.references++;for(const s of row.suggestedSubjects)item.subjects.add(s);
  evidence.set(digest,item);
  for(const s of row.suggestedSubjects.length?row.suggestedSubjects:[row.primarySubject]){
   if(typeof s!=='string'||!s)throw Error('Subject required');
   const v=perSubject.get(s)||{references:0,content:new Set(),sources:new Set()};
   v.references++;v.content.add(digest);v.sources.add(sourceIdHash);perSubject.set(s,v);
  }
  privateRefs.push({candidateIdHash:hash(id),contentHash:digest,sourceIdHash,subjects:row.suggestedSubjects,primarySubject:row.primarySubject});
 }
 let reused=0,extraRefs=0,crossSubject=0;
 for(const item of evidence.values()){if(item.references>1){reused++;extraRefs+=item.references-1;}if(item.subjects.size>1)crossSubject++;}
 const buckets=Object.fromEntries([...perSubject].sort((a,b)=>a[0].localeCompare(b[0])).map(([s,v])=>[s,{candidateReferences:v.references,distinctEvidenceDigests:v.content.size,distinctSources:v.sources.size}]));
 return {summary:{schemaVersion:1,learningSha256:learnHash,originalCandidates:records.length,originalCandidateIdentities:ids.length,distinctEvidenceDigests:evidence.size,distinctSourceIdentities:sources.size,reusedEvidenceDigests:reused,additionalReferencesToSharedEvidence:extraRefs,crossSubjectEvidenceDigests:crossSubject,subjects:buckets,physicalDuplicateBytesVerified:null,sourceOrCandidateMutated:false,deduplicationPerformed:false,migrationAuthorized:false,historicalCompletenessVerified:false},privateRefs};
}
function main(args){
 if(args.length!==4)throw Error('Usage: rawCustodySubjectEvidence.js RESTORED_ROOT SUBJECT_INDEX_JSON PUBLIC_SUMMARY_JSON PRIVATE_INDEX_JSON');
 const [root,indexFile,out,privateOut]=args;
 const result=indexRestoredEvidence(root,JSON.parse(fs.readFileSync(indexFile,'utf8')));
 fs.writeFileSync(out,JSON.stringify(result.summary,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.writeFileSync(privateOut,JSON.stringify({schemaVersion:1,entries:result.privateRefs})+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({candidates:result.summary.originalCandidates,subjectBuckets:Object.keys(result.summary.subjects).length,physicalByteSavings:'unverified'}));
}
if(require.main===module)main(process.argv.slice(2));
module.exports={indexRestoredEvidence};
