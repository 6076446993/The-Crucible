'use strict';

const crypto = require('node:crypto');
const { FAILURE_CODES, CRU_CLASSIFICATION_CODES, describeCode } = require('./failureCodes');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }

function buildCruCodeCatalog({ sourceCommit = process.env.GITHUB_SHA || null } = {}) {
  const codes = [...CRU_CLASSIFICATION_CODES].sort().map((code) => {
    const entry = describeCode(code);
    return {
      code,
      category: entry.category,
      meaning: entry.meaning,
      next: entry.next,
      remedy: entry.remedy ? {
        kind: entry.remedy.kind,
        command: entry.remedy.command ?? null,
        verifyWith: entry.remedy.verifyWith ?? null,
        forbidden: entry.remedy.forbidden,
      } : null,
    };
  });
  const catalog = {
    schemaVersion: 1,
    authority: 'The-Crucible',
    sourceCommit,
    semantics: 'CRU codes classify bug/error classes. They are diagnostic vocabulary, not repair authorization, lifecycle state, governance approval, or proof.',
    codes,
  };
  return { ...catalog, catalogSha256: sha256(catalog) };
}

function validateCruCodeCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || catalog.authority !== 'The-Crucible' || !Array.isArray(catalog.codes)) throw new Error('Invalid CRU catalog envelope.');
  const expected = buildCruCodeCatalog({ sourceCommit: catalog.sourceCommit });
  if (catalog.catalogSha256 !== expected.catalogSha256) throw new Error('CRU catalog digest or registry contents do not match The Crucible failure-code registry.');
  return true;
}

module.exports = { buildCruCodeCatalog, validateCruCodeCatalog, sha256 };
