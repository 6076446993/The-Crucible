'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectWorkflow}=require('../tools/testing/key-workflow-order');
const prefix='name: Manage Crucible custody keys\n';
test('records unsafe secret-before-registry publication ordering',()=>{const x=inspectWorkflow(prefix+'gh secret set CRUCIBLE_SOURCE_BUNDLE_KEY\ngit add governingDocuments/source-bundle-key-registry.json\ngit push origin HEAD:development');assert.ok(x.findings.includes('SECRET_MUTATION_PRECEDES_REGISTRY_PUBLICATION'));assert.equal(x.liveWorkflowSafeToDispatch,false);});
test('missing audit trail never authorizes dispatch even when order reversed',()=>{const x=inspectWorkflow(prefix+'git push origin HEAD:development\ngh secret set CRUCIBLE_SOURCE_BUNDLE_KEY');assert.ok(x.findings.includes('COORDINATED_HANDOFF_DEVLOG_WRITE_NOT_EVIDENCED'));assert.equal(x.liveWorkflowSafeToDispatch,false);});
test('unknown workflow fails closed',()=>assert.throws(()=>inspectWorkflow('hello'),/UNRECOGNIZED/));
test('missing push is held as unproven',()=>{const x=inspectWorkflow(prefix+'gh secret set A');assert.ok(x.findings.includes('UNPROVEN_SECRET_OR_REGISTRY_COMMIT_ORDER'));});
