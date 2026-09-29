'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATES = Object.freeze(['active', 'challenged', 'superseded', 'obsolete']);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}
function iso(value, label) {
  text(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
}

function validateEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('test lifecycle entry must be an object.');
  const state = text(value.state, 'state');
  if (!STATES.includes(state)) throw new Error(`test lifecycle state must be one of: ${STATES.join(', ')}.`);
  const entry = {
    test: text(value.test, 'test'),
    state,
    hypothesisId: text(value.hypothesisId, 'hypothesisId'),
    successorHypothesisId: value.successorHypothesisId ? text(value.successorHypothesisId, 'successorHypothesisId') : null,
    evidence: Array.isArray(value.evidence) ? value.evidence.map((item) => text(item, 'evidence item')) : [],
    reason: text(value.reason, 'reason'),
    reviewedAt: value.reviewedAt,
  };
  iso(entry.reviewedAt, 'reviewedAt');
  if ((state === 'superseded' || state === 'obsolete') && !entry.successorHypothesisId && !entry.evidence.length) throw new Error('superseded/obsolete tests require a successor hypothesis or explicit evidence.');
  return Object.freeze(entry);
}

function readTestLifecycle(file) {
  if (!file || !fs.existsSync(file)) return { schemaVersion:1, tests:[] };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.tests)) throw new Error('test lifecycle registry is invalid.');
  return { schemaVersion:1, tests:value.tests.map(validateEntry) };
}

function executableTests(tests, { registryFile = path.join('governingDocuments', 'test-lifecycle.json'), includeHistorical = false } = {}) {
  const registry = readTestLifecycle(registryFile);
  const byTest = new Map(registry.tests.map((entry) => [entry.test, entry]));
  const selected = [], skipped = [], challenged = [];
  for (const test of tests) {
    const lifecycle = byTest.get(test);
    if (!lifecycle || lifecycle.state === 'active') selected.push(test);
    else if (lifecycle.state === 'challenged') { selected.push(test); challenged.push(lifecycle); }
    else if (includeHistorical) selected.push(test);
    else skipped.push(lifecycle);
  }
  return { selected, skipped, challenged };
}

module.exports = { STATES, validateEntry, readTestLifecycle, executableTests };
