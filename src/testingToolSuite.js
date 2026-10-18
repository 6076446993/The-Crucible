'use strict';
// Additive manifest/dispatch adapter for existing testingOrgan + testCadence.
// It does not execute tools, write code, grant claims, or approve recovery.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const HEX64 = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{2,63}$/;
const CATEGORIES = new Set(['code','security','utility','maintenance']);
function fail(message) {throw new Error('TOOL_SUITE_REFUSED:'+message);}
function safeFile(root, rel, prefix) {
  if(typeof rel !== 'string' || !rel.startsWith(prefix) || rel.includes('\\') || rel.includes('\0') || path.posix.normalize(rel)!==rel || rel.split('/').includes('..') || path.isAbsolute(rel))fail('invalid file path');
  const abs=path.resolve(root, rel);
  if(!abs.startsWith(path.resolve(root)+path.sep)) fail('file leaves project root');
  // No inherited symlinks, nor links inside the tool tree.
  let walk=path.resolve(root);
  for(const part of rel.split('/')) { walk=path.join(walk,part); const s=fs.lstatSync(walk); if(s.isSymbolicLink())fail('symlink refused:'+rel); }
  const stat=fs.statSync(abs); if(!stat.isFile() || stat.size>1024*1024) fail('invalid or oversized file:'+rel);
  return abs;
}
function validateManifest(manifest,{root=path.resolve(__dirname,'..'),verifyFiles=true}={}) {
  if(!manifest || manifest.schemaVersion!==1 || !Array.isArray(manifest.tools) || !manifest.tools.length) fail('empty/invalid manifest');
  const ids=new Set(), tests=new Set(), supported=[];
  for(const tool of manifest.tools) {
    if(!tool || !ID.test(tool.id) || ids.has(tool.id))fail('duplicate/invalid tool ID'); ids.add(tool.id);
    if(tool.mode!=='read-only' || tool.proofAuthority!==false || tool.promotionAuthority!==false)fail('tool authority must be read-only/non-promoting');
    if(!CATEGORIES.has(tool.category) || !ID.test(tool.ownerScope)) fail('invalid classification or scope');
    if(tool.code!==`tools/testing/${tool.id}.js` || tool.test!==`test/${tool.id}.test.js`)fail('unexpected code/test path');
    if(!HEX64.test(tool.codeSha256) || !HEX64.test(tool.testSha256))fail('missing pinned digest');
    if(tests.has(tool.test))fail('duplicate test mapping');tests.add(tool.test);
    if(!Array.isArray(tool.evidenceRequirements) || !tool.evidenceRequirements.length || !tool.evidenceRequirements.every(x=>typeof x==='string' && x.length>3 && x.length<180))fail('no evidence requirements');
    if(verifyFiles)for(const [file,expected,prefix] of [[tool.code,tool.codeSha256,'tools/testing/'],[tool.test,tool.testSha256,'test/']]){
      const actual=crypto.createHash('sha256').update(fs.readFileSync(safeFile(root,file,prefix))).digest('hex');
      if(actual!==expected)fail('pinned digest mismatch:'+file);
    }
    supported.push(Object.freeze({id:tool.id,category:tool.category,test:tool.test,ownerScope:tool.ownerScope}));
  }
  return Object.freeze({ok:true,tools:supported,tests:supported.map(x=>x.test),proofStageSatisfied:false,promotionAuthorized:false});
}
function readRegistry(root=path.resolve(__dirname,'..')) {
  return JSON.parse(fs.readFileSync(path.join(root,'tools/testing/registry.json'),'utf8'));
}
function selectToolTests(ids,{root=path.resolve(__dirname,'..'),manifest=readRegistry(root),available}={}) {
  const result=validateManifest(manifest,{root});
  if(!Array.isArray(ids) || !ids.length)fail('must explicitly name at least one tool');
  const requested=[];
  for(const id of ids){const tool=result.tools.find(x=>x.id===id);if(!tool)fail('unregistered tool:'+id);requested.push(tool.test);}
  const selected=[...new Set(requested)].sort();
  if(available && selected.some(t=>!available.includes(t)))fail('test not registered with testing organ');
  return Object.freeze({tests:selected,mainCategories:[],categories:[],reason:'registered-tool-exact-test-selection',coverageComplete:true,proofStageSatisfied:false,promotionAuthorized:false});
}
function toTestingOrganRequest(ids, options={}) {
  const selection=selectToolTests(ids, options);
  return Object.freeze({tests:selection.tests}); // payload.request consumed by existing testingOrgan
}
if(require.main===module){try{const result=validateManifest(readRegistry());process.stdout.write(JSON.stringify({state:'REGISTERED_TESTS_VALID',...result},null,2)+'\n');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={validateManifest,readRegistry,selectToolTests,toTestingOrganRequest,safeFile};
