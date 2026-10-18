'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readRegistry,validateManifest,selectToolTests,toTestingOrganRequest}=require('../src/testingToolSuite');
const root=path.resolve(__dirname,'..'),input=()=>structuredClone(readRegistry(root));
test('registered tools are pinned read-only with test and evidence contract',()=>{const x=validateManifest(input(),{root});assert.equal(x.tools.length,6);assert.equal(x.proofStageSatisfied,false);assert.equal(x.promotionAuthorized,false);});
test('selects exact preexisting tests for existing testingOrgan; does not run a parallel runner',()=>{const x=selectToolTests(['historical-key-readiness','recovery-proof-readiness'],{root});assert.equal(x.tests.length,2);assert.ok(x.tests.every(f=>f.startsWith('test/')));assert.equal(x.proofStageSatisfied,false);});
test('adapts to existing testingOrgan request contract without writing tests',()=>{const x=toTestingOrganRequest(['key-workflow-order'],{root});assert.deepEqual(x,{tests:['test/key-workflow-order.test.js']});});
test('rejects unknown tool and unavailable test on existing organ',()=>{assert.throws(()=>selectToolTests(['not-registered'],{root}),/unregistered tool/);assert.throws(()=>selectToolTests(['historical-key-readiness'],{root,available:[]}),/test not registered/);});
test('registry duplicate, authority grant, traversal and digest mismatch are refused',()=>{let a=input();a.tools.push(structuredClone(a.tools[0]));assert.throws(()=>validateManifest(a,{root,verifyFiles:false}),/duplicate/);a=input();a.tools[0].mode='mutating';assert.throws(()=>validateManifest(a,{root,verifyFiles:false}),/authority/);a=input();a.tools[0].code='../escape.js';assert.throws(()=>validateManifest(a,{root,verifyFiles:false}),/path/);a=input();a.tools[0].testSha256='0'.repeat(64);assert.throws(()=>validateManifest(a,{root}),/digest mismatch/);});
test('symlink files cannot enter the manifest without matching native paths',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tool-suite-test-'));try{fs.mkdirSync(path.join(dir,'tools/testing'),{recursive:true});fs.mkdirSync(path.join(dir,'test'));fs.symlinkSync(__filename,path.join(dir,'test','historical-key-readiness.test.js'));assert.throws(()=>validateManifest(input(),{root:dir}),/ENOENT|symlink refused/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('Git checkout with autocrlf preserves the exact bytes pinned by the registry', t => {
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-pinned-checkout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = readRegistry(root);
  const files = [...new Set(manifest.tools.flatMap(tool => [tool.code, tool.test]))];
  for (const relative of [...files, 'test/.gitattributes', 'tools/testing/.gitattributes']) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(dir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  const git = args => execFileSync('git', ['-c', 'core.autocrlf=true', ...args], { cwd: dir, stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', '--all']);
  for (const relative of files) fs.rmSync(path.join(dir, relative));
  git(['checkout-index', '--all', '--force']);
  assert.equal(validateManifest(manifest, { root: dir }).ok, true);
});
