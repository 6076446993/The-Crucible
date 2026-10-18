'use strict';
// Validates completeness of declared evidence; never pretends to certify live restoration.
const crypto=require('node:crypto');
const HEX64=/^[a-f0-9]{64}$/;
function inspectProof(evidence,knownHistory) {
 const held=[];
 if(!evidence || evidence.schemaVersion!==1 || evidence.mode!=='independent-cold-restore') held.push('SIGNED_INDEPENDENT_RESTORE_RECEIPT_MISSING');
 const required=['raw','vetted'];
 if(!evidence?.keyGenerations || !Array.isArray(evidence.keyGenerations))held.push('HISTORICAL_KEYS_UNINVENTORIED');
 const records=evidence?.keyGenerations||[];
 const allKnown=(knownHistory?.knownRawKeyFingerprints||[]).map(x=>x.sha256);
 for(const digest of allKnown){if(!records.some(x=>x.family==='raw'&&x.sha256===digest&&x.verifiedWithHistoricalCiphertext===true))held.push('RAW_GENERATION_DECRYPT_UNPROVEN:'+digest.slice(0,12));}
 for(const family of required){if(!records.some(x=>x.family===family && HEX64.test(x.sha256) && x.verifiedWithHistoricalCiphertext===true))held.push('NO_VERIFIED_'+family.toUpperCase()+'_KEY');}
 if(evidence?.integrity?.allOriginalBytesRehashed!==true || evidence?.integrity?.allHistoryRestored!==true)held.push('COMPLETE_HISTORICAL_BYTE_RESTORE_MISSING');
 if(evidence?.integrity?.candidateAndLineageReconciled!==true)held.push('CANDIDATE_LINEAGE_RECONCILIATION_MISSING');
 if(evidence?.custody?.distinctPrincipal!==true || evidence?.custody?.deletionDenied!==true || evidence?.custody?.independentSignedReceipt!==true)held.push('INDEPENDENT_CUSTODY_ATTESTATION_MISSING');
 if(typeof evidence?.originalHead!=='string'||!HEX64.test(evidence.originalHead))held.push('EXACT_HEAD_PROOF_MISSING');
 // Deliberately no authorizing success state. Even a syntactically complete receipt needs actual signature and host verification.
 return {status:'BLOCKED_UNTIL_INDEPENDENT_REVIEW',held:[...new Set(held)],completenessEvidenceOnly:true,signatureCryptographicallyVerified:false,fullRecoveryProven:false,proofStageSatisfied:false,promotionAuthorized:false};
}
if(require.main===module){console.log(JSON.stringify(inspectProof(null,null),null,2));process.exitCode=2;}
module.exports={inspectProof};
