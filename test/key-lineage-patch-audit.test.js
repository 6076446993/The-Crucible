'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {inspectPatch,REQUIRED_SHA256,BASELINE_BLOBS}=require('../tools/testing/key-lineage-patch-audit');
const file=path.join(__dirname,'fixtures','key-lineage-fix.json');
test('existing isolated repair patch is pinned and scoped to expected source/tests',()=>{const x=inspectPatch(Buffer.from(JSON.parse(fs.readFileSync(file,'utf8')).content,'base64'));assert.equal(x.patchSha256,REQUIRED_SHA256);assert.equal(x.pinnedAndExpectedPaths,true);assert.equal(Object.keys(x.baselineBlobs).length,2);});
test('patch integrity does not imply owner integration or historical restore proof',()=>{const x=inspectPatch(Buffer.from(JSON.parse(fs.readFileSync(file,'utf8')).content,'base64'));assert.equal(x.patchIntegrated,false);assert.equal(x.historicalRecoveryProven,false);assert.equal(x.authorization,'ORIGINAL_OWNER_REQUIRED');});
test('changed patch bytes are not admitted into suite custody',()=>{const buf=Buffer.from(Buffer.from(JSON.parse(fs.readFileSync(file,'utf8')).content,'base64'));buf[buf.length-1]^=1;assert.equal(inspectPatch(buf).pinnedAndExpectedPaths,false);});
