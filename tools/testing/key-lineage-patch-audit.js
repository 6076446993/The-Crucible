'use strict';
// Validates custody of a staged *text patch* only; does not apply it or infer recovery.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const REQUIRED_SHA256='fb990bbb035e7d1a46b8ab6aa2afe1b1bdd72567f64019e3be48bf13e505dc4b';
const BASELINE_BLOBS=Object.freeze({
 'src/sourceBundleKeyAutomation.js':'033db790f014cdb76bde71e475dbc7ab108e28c1',
 'test/sourceBundleKeyAutomation.test.js':'f0e1e3d13860456f1448972f2c49c9953b569d92'
});
function inspectPatch(bytes){
 if(!Buffer.isBuffer(bytes) || bytes.length>128*1024)throw Error('INVALID_PATCH_BYTES');
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const content=bytes.toString('utf8');
 const valid=digest===REQUIRED_SHA256;
 const bounded=content.includes('src/sourceBundleKeyAutomation.js') && content.includes('test/sourceBundleKeyAutomation.test.js');
 return {patchSha256:digest,expectedSha256:REQUIRED_SHA256,pinnedAndExpectedPaths:valid&&bounded,baselineBlobs:BASELINE_BLOBS,patchIntegrated:false,hostedTested:false,historicalRecoveryProven:false,authorization:'ORIGINAL_OWNER_REQUIRED'};
}
if(require.main===module){let p=process.argv[2]||path.join(__dirname,'..','..','test','fixtures','key-lineage-fix.json');try{let r=inspectPatch(Buffer.from(JSON.parse(fs.readFileSync(p,'utf8')).content,'base64'));console.log(JSON.stringify(r,null,2));process.exitCode=r.pinnedAndExpectedPaths?0:2;}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={inspectPatch,REQUIRED_SHA256,BASELINE_BLOBS};
