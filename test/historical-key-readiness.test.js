'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {inspect}=require('../tools/testing/historical-key-readiness');
const input=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/historical-key-registry-history.json'),'utf8'));
test('five historical registry revisions: three RAW identities, oldest displaced',()=>{const x=inspect(input());assert.equal(x.revisionsInspected,5);assert.equal(x.knownRawKeyFingerprints.length,3);assert.equal(x.knownRawKeyFingerprints.filter(k=>!k.referencedInCurrentRegistry).length,1);});
test('cannot claim old-key possession, vetted key registration or independent restore',()=>{const x=inspect(input());assert.equal(x.readiness,'BLOCKED');assert.equal(x.historicalKeyMaterialVerified,false);assert.equal(x.independentRecoveryAccepted,false);assert.equal(x.knownVettedKeyFingerprints.length,0);});
test('corrupt registry fingerprint and repeated commit refused',()=>{const a=input();a.revisions.at(-1).rawCurrent.sha256='x';assert.throws(()=>inspect(a),/INVALID_KEY_METADATA/);const b=input();b.revisions.at(-1).sha=b.revisions.at(-2).sha;assert.throws(()=>inspect(b),/INVALID_REGISTRY_CHRONOLOGY/);});
