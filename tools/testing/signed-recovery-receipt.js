'use strict';
// Ed25519 signature verification only; no independent custody or cold-restore claim.
// Pin the trusted public key OUTSIDE receipt/artifact, from independent custodian.
const crypto=require('node:crypto');
const HEX64=/^[a-f0-9]{64}$/;
function verifyReceipt({body,signature,externalPinnedPublicKeyPem,expectedRepository,expectedHead,expectedManifestSha256}){
  const findings=[];
  if(!Buffer.isBuffer(body) || body.length===0 || body.length>2*1024*1024) throw Error('RECEIPT_BODY_INVALID');
  if(typeof signature!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length>8192)throw Error('RECEIPT_SIGNATURE_INVALID');
  if(!externalPinnedPublicKeyPem || typeof externalPinnedPublicKeyPem!=='string')throw Error('INDEPENDENT_SIGNER_KEY_NOT_PINNED');
  if(!HEX64.test(expectedHead) || !HEX64.test(expectedManifestSha256) || !/^[\w.-]+\/[\w.-]+$/.test(expectedRepository))throw Error('RECEIPT_EXPECTED_CONTEXT_INVALID');
  let pub;try{pub=crypto.createPublicKey(externalPinnedPublicKeyPem);}catch{throw Error('INDEPENDENT_SIGNER_PUBLIC_KEY_INVALID');}
  if(pub.asymmetricKeyType!=='ed25519')throw Error('RECOVERY_RECEIPT_REQUIRES_ED25519');
  let valid;try{valid=crypto.verify(null,body,pub,Buffer.from(signature,'base64'));}catch{valid=false;}
  if(!valid)findings.push('SIGNATURE_MISMATCH');
  let parsed;try{parsed=JSON.parse(body.toString('utf8'));}catch{throw Error('RECEIPT_JSON_INVALID');}
  if(parsed.repository!==expectedRepository || parsed.head!==expectedHead || parsed.manifestSha256!==expectedManifestSha256) findings.push('RECEIPT_CONTEXT_MISMATCH');
  if(parsed.schemaVersion!==1 || parsed.scope!=='independent-historical-cold-restore')findings.push('RECEIPT_SCOPE_MISMATCH');
  return {
    state:findings.length?'BLOCKED':'SIGNATURE_VALID_ONLY',
    findings,
    signatureCryptographicallyVerified:valid,
    signerIdentityIndependentlyEstablished:false,
    physicalHistoricalRecoveryProven:false,
    keyPossessionProven:false,
    independentRecoveryAccepted:false
  };
}
module.exports={verifyReceipt};
