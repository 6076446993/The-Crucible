'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),path=require('node:path');
const {selectRegisteredChecks}=require('../src/recoveryTestIntegration');
const {readRegistry}=require('../src/testingToolSuite');
const root=path.join(__dirname,'..');
const available=readRegistry(root).tools.map(t=>t.test);
const originalOrgan=require('../src/testingOrgan');
test('registered checks route into existing testingOrgan selector',()=>{
  const r=selectRegisteredChecks({toolIds:['historical-key-readiness','signed-recovery-receipt'],existingTestingOrgan:originalOrgan,availableTests:available,root});
  assert.deepEqual(r.selected.tests,['test/historical-key-readiness.test.js','test/signed-recovery-receipt.test.js']);
  assert.equal(r.proofStageSatisfied,false);assert.equal(r.promotionAuthorized,false);
});
test('missing Testing Organ is refused',()=>assert.throws(()=>selectRegisteredChecks({toolIds:['historical-key-readiness'],availableTests:available,root}),/EXISTING_TESTING_ORGAN_REQUIRED/));
test('missing registered original-test installation is refused',()=>assert.throws(()=>selectRegisteredChecks({toolIds:['historical-key-readiness'],availableTests:['test/other.test.js'],existingTestingOrgan:originalOrgan,root}),/TOOL_SUITE_REFUSED/));
test('fake Testing Organ cannot quietly alter selected tests',()=>assert.throws(()=>selectRegisteredChecks({toolIds:['historical-key-readiness'],availableTests:available,existingTestingOrgan:{selectRequestedTests:()=>({tests:[]})},root}),/TESTING_ORGAN_SELECTION_MISMATCH/));
test('never accepts an empty discovered test set',()=>assert.throws(()=>selectRegisteredChecks({toolIds:['historical-key-readiness'],availableTests:[],existingTestingOrgan:originalOrgan,root}),/NONEMPTY_DISCOVERED_TESTS_REQUIRED/));
