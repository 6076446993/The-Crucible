'use strict';

const { FAILURE_CODES, UNCODED, isCrucibleClassificationCode, operationalCodeFor } = require('./failureCodes');

function buildCruCodeCatalog({ sourceCommit = process.env.GITHUB_SHA || null } = {}) {
  const codes = Object.entries(FAILURE_CODES)
    .filter(([code]) => /^CRU-\d{4}$/.test(code))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) => ({
      code,
      status: code === UNCODED ? 'diagnosis-coverage-marker'
        : isCrucibleClassificationCode(code) ? 'active-classification'
        : 'operational-or-historical',
      operationalCode: code === UNCODED || isCrucibleClassificationCode(code) ? null : operationalCodeFor(code),
      category: entry.category,
      meaning: entry.meaning,
      next: entry.next,
      remedy: entry.remedy ? {
        kind: entry.remedy.kind,
        command: entry.remedy.command ?? null,
        verifyWith: entry.remedy.verifyWith ?? null,
        forbidden: entry.remedy.forbidden,
      } : null,
    }));
  const catalog = {
    schemaVersion: 1,
    authority: 'The-Crucible',
    ...(sourceCommit ? { sourceCommit } : {}),
    semantics: 'This catalog is an evolving snapshot of Crucible diagnostic vocabulary. New CRU entries are added as new error classes are identified. Entries declare whether they are active classifications, operational/historical mappings, or the diagnosis-coverage marker. The catalog is diagnostic vocabulary, not repair authorization, lifecycle state, governance approval, or proof.',
    codes,
  };
  return catalog;
}

function validateCruCodeCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || catalog.authority !== 'The-Crucible' || !Array.isArray(catalog.codes)) throw new Error('Invalid CRU catalog envelope.');
  const expected = buildCruCodeCatalog({ sourceCommit: catalog.sourceCommit || null });
  if (JSON.stringify(catalog) !== JSON.stringify(expected)) throw new Error('Published CRU catalog does not match The Crucible failure-code registry.');
  return true;
}

module.exports = { buildCruCodeCatalog, validateCruCodeCatalog };
