'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verifyReceipt}=require('../tools/testing/signed-recovery-receipt');
function synthetic(){
  const pair=crypto.generateKeyPairSync('ed25519');
  const expected={expectedRepository:'6076446993/The-Crucible',expectedHead:'a'.repeat(64),expectedManifestSha256:'b'.repeat(64)};
  const body=Buffer.from(JSON.stringify({schemaVersion:1,scope:'independent-historical-cold-restore',repository:expected.expectedRepository,head:expected.expectedHead,manifestSha256:expected.expectedManifestSha256}));
  return {pair,expected,body,signature:crypto.sign(null,body,pair.privateKey).toString('base64'),externalPinnedPublicKeyPem:pair.publicKey.export({type:'spki',format:'pem'})};
}
test('signature-valid synthetic receipt remains signature-only, not a cold-restore proof',()=>{const a=synthetic();const r=verifyReceipt({body:a.body,signature:a.signature,externalPinnedPublicKeyPem:a.externalPinnedPublicKeyPem,...a.expected});assert.equal(r.state,'SIGNATURE_VALID_ONLY');assert.equal(r.signatureCryptographicallyVerified,true);assert.equal(r.physicalHistoricalRecoveryProven,false);assert.equal(r.independentRecoveryAccepted,false);});
test('tampered historical manifest bytes invalidate signature',()=>{const a=synthetic();const tampered=Buffer.from(a.body);tampered[12]^=1;let r;try{r=verifyReceipt({body:tampered,signature:a.signature,externalPinnedPublicKeyPem:a.externalPinnedPublicKeyPem,...a.expected});}catch(e){assert.match(e.message,/JSON/);return;}assert.ok(r.findings.includes('SIGNATURE_MISMATCH'));});
test('wrong pinned verifier public key fails authentication',()=>{const a=synthetic(),b=synthetic();const r=verifyReceipt({body:a.body,signature:a.signature,externalPinnedPublicKeyPem:b.externalPinnedPublicKeyPem,...a.expected});assert.equal(r.state,'BLOCKED');assert.ok(r.findings.includes('SIGNATURE_MISMATCH'));});
test('valid signature for different head cannot satisfy required exact head',()=>{const a=synthetic();const r=verifyReceipt({body:a.body,signature:a.signature,externalPinnedPublicKeyPem:a.externalPinnedPublicKeyPem,...{...a.expected,expectedHead:'c'.repeat(64)}});assert.ok(r.findings.includes('RECEIPT_CONTEXT_MISMATCH'));});
test('untrusted/unpinned signer blocks before signature verification',()=>{const a=synthetic();assert.throws(()=>verifyReceipt({body:a.body,signature:a.signature,...a.expected}),/INDEPENDENT_SIGNER_KEY_NOT_PINNED/);});
