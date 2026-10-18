'use strict';
// Bridges the EXISTING Testing Organ's exported selector. Does not run tests,
// create a runner, install tools, or turn test output into release authority.
const {toTestingOrganRequest,validateManifest,readRegistry} = require('./testingToolSuite');
const {requestTool} = require('./orchestratorToolBuilder');

function selectRegisteredChecks({toolIds, existingTestingOrgan, availableTests, root}) {
  if (!existingTestingOrgan || typeof existingTestingOrgan.selectRequestedTests !== 'function') {
    throw new Error('EXISTING_TESTING_ORGAN_REQUIRED');
  }
  if (!Array.isArray(availableTests) || !availableTests.length) throw new Error('NONEMPTY_DISCOVERED_TESTS_REQUIRED');
  const registry = readRegistry(root);
  validateManifest(registry,{root});
  const request = toTestingOrganRequest(toolIds,{root,manifest:registry,available:availableTests});
  const selected = existingTestingOrgan.selectRequestedTests(request,availableTests);
  if (selected.tests.length !== request.tests.length ||
      selected.tests.some(x=>!request.tests.includes(x))) throw new Error('TESTING_ORGAN_SELECTION_MISMATCH');
  return Object.freeze({request, selected, verificationOnly:true,
    proofStageSatisfied:false,promotionAuthorized:false});
}
function prepareToolAndTests({diagnosis,toolInventory,proposal,positiveControl,negativeControl,context,verificationToolIds,existingTestingOrgan,availableTests,root}) {
  const tool = requestTool({diagnosis,toolInventory,proposal,positiveControl,negativeControl,context});
  const tests = selectRegisteredChecks({toolIds:verificationToolIds,existingTestingOrgan,availableTests,root});
  return Object.freeze({tool, tests, state:'staged-unapproved',
    needsIndependentVerifier:true,ownerAuthorized:false,proofStageSatisfied:false,promotionAuthorized:false});
}
module.exports={selectRegisteredChecks,prepareToolAndTests};
