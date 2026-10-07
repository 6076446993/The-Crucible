'use strict';

// Manual raw intake only. Independent Oversight owns vetted publication and proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { operationalError } = require('./failureCodes');
const { verifyRestored, hydrateRestored, restageRestored, sourceFilename, sha256File, readHeader, validateIdentity, chunkFile, joinEncrypted } = require('./hostedSourceBundle');
const { run: retrieve } = require('./sourceRetrievalWorkerCli');
const { run: extract } = require('./claimExtractionWorkerCli');
const { AtomicClaimExtractionQueue } = require('./claimExtractionWorker');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const records = (queue) => [...queue.documents, ...queue.links];
function fail(message) { throw operationalError('OPS-0044', `Raw custody publication refused: ${message}`); }
function regular(file) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) fail('custody requires regular non-symbolic files'); return stat; }

function approvedSeeds({ sourceRegister, expectedRegisterSha256, maximumSources }) {
  regular(sourceRegister);
  if (!/^[a-f0-9]{64}$/.test(expectedRegisterSha256 || '') || sha256File(sourceRegister) !== expectedRegisterSha256) fail('source register differs from the exact approved hash');
  const seeds = read(sourceRegister).candidateSourceSeeds;
  if (!Number.isSafeInteger(maximumSources) || maximumSources < 1 || maximumSources > 25 || !Array.isArray(seeds) || !seeds.length || seeds.length > maximumSources) fail('source count exceeds the approved bound');
  if (new Set(seeds.map((seed) => seed.id)).size !== seeds.length || new Set(seeds.map((seed) => seed.url)).size !== seeds.length) fail('duplicate seed identities or URLs');
  for (const seed of seeds) if (typeof seed.id !== 'string' || !seed.id || typeof seed.url !== 'string') fail('invalid seed identity');
  return seeds;
}

function copySnapshot(root, workingRoot, manifest) {
  const source = path.resolve(root); const target = path.resolve(workingRoot);
  if (target === source || target.startsWith(`${source}${path.sep}`) || source.startsWith(`${target}${path.sep}`) || fs.existsSync(target)) fail('working snapshot must be new and separate from existing custody');
  fs.mkdirSync(path.join(target, 'sources'), { recursive: true, mode: 0o700 });
  for (const name of ['manifest.json', 'source-queue.json', manifest.learningFile]) {
    if (path.basename(name) !== name) fail('manifest file path escapes custody');
    regular(path.join(source, name)); fs.copyFileSync(path.join(source, name), path.join(target, name), fs.constants.COPYFILE_EXCL);
  }
  for (const file of manifest.sourceFiles) {
    if (path.basename(file.name) !== file.name) fail('source manifest path escapes custody');
    regular(path.join(source, 'sources', file.name)); fs.copyFileSync(path.join(source, 'sources', file.name), path.join(target, 'sources', file.name), fs.constants.COPYFILE_EXCL);
  }
}

function assertPreserved(beforeQueue, afterQueue, beforeLearning, afterLearning, selectedIds) {
  const after = new Map(records(afterQueue).map((item) => [item.id, item]));
  if (after.size !== records(afterQueue).length) fail('duplicate source identities');
  for (const prior of records(beforeQueue)) {
    if (!after.has(prior.id)) fail('an existing queue source was removed');
    if (!selectedIds.has(prior.id) && digest(prior) !== digest(after.get(prior.id))) fail('an unrelated queue source changed');
    if (prior.contentSha256 && after.get(prior.id).contentSha256 !== prior.contentSha256) fail('an existing content revision changed');
  }
  if (!beforeLearning.payload || !afterLearning.payload) fail('learning envelope is missing');
  for (const key of Object.keys(beforeLearning.payload)) {
    if (['candidateRecords', 'revision', 'auditLog'].includes(key)) continue;
    if (digest(beforeLearning.payload[key]) !== digest(afterLearning.payload[key])) fail(`existing learned state changed: ${key}`);
  }
  const afterCandidates = new Map(afterLearning.payload.candidateRecords.map((record) => [record.candidate.id, record]));
  for (const record of beforeLearning.payload.candidateRecords) if (digest(record) !== digest(afterCandidates.get(record.candidate.id))) fail('an existing candidate changed');
  const oldIds = new Set(beforeLearning.payload.candidateRecords.map((record) => record.candidate.id));
  for (const record of afterLearning.payload.candidateRecords) if (!oldIds.has(record.candidate.id)) {
    if (record.candidate.classification !== 'Insufficient Evidence' || record.state !== 'candidate' || Object.values(record.gates).some(Boolean) || !selectedIds.has(record.candidate.provenance.sourceId)) fail('new candidate is outside approved non-authoritative intake');
  }
  const priorAudit = beforeLearning.payload.auditLog;
  if (digest(afterLearning.payload.auditLog.slice(0, priorAudit.length)) !== digest(priorAudit)) fail('existing learning audit changed');
}

async function prepare({ root, workingRoot, repository, ref, sourceRegister, expectedRegisterSha256, reportFile, maximumSources = 9, maximumExtractionPasses = 4, retrieval = retrieve, extraction = extract }) {
  if (!Number.isSafeInteger(maximumExtractionPasses) || maximumExtractionPasses < 1 || maximumExtractionPasses > 10) fail('extraction pass bound must be 1-10');
  const seeds = approvedSeeds({ sourceRegister, expectedRegisterSha256, maximumSources });
  const custody = verifyRestored({ root, repository, ref, reportFile: `${reportFile}.before`, provenance: 'raw-intake' });
  const manifest = read(path.join(root, 'manifest.json'));
  const expectedLearningFile = `${crypto.createHash('sha256').update(custody.projectId).digest('hex')}.learning.json`;
  if (manifest.learningFile !== expectedLearningFile) fail('restored candidate store is not the project-bound worker store');
  if (fs.existsSync(path.join(root, 'source-queue.json.claim-extraction.lock')) || fs.existsSync(path.join(root, `${manifest.learningFile}.lock`))) fail('restored custody has an unresolved worker lock; do not clear or restart it');
  const originalQueueHash = sha256File(path.join(root, 'source-queue.json'));
  const originalLearningHash = sha256File(path.join(root, manifest.learningFile));
  const beforeQueue = read(path.join(root, 'source-queue.json')); const beforeLearning = read(path.join(root, manifest.learningFile));
  copySnapshot(root, workingRoot, manifest);
  const hydrated = hydrateRestored({ root: workingRoot, repository, ref });
  const runtime = {
    CRUCIBLE_LEARNING_PROJECT_ID: custody.projectId, CRUCIBLE_LEARNING_ROOT: path.resolve(workingRoot), CRUCIBLE_SOURCE_QUEUE: hydrated.queueFile,
    CRUCIBLE_RETRIEVAL_BATCH_SIZE: '1', CRUCIBLE_RETRIEVAL_MINIMUM_INTERVAL_MS: '1000',
    CRUCIBLE_EXTRACTION_BATCH_SIZE: '1', CRUCIBLE_EXTRACTION_MAX_DOCUMENTS: '1', CRUCIBLE_PDF_PAGES_PER_BATCH: '20',
  };
  const selected = []; const outcomes = [];
  for (const seed of seeds) {
    // Positive URL admission remains governed by the canonical scholarly registry and suffix rules.
    const admitted = await retrieval(['admit', seed.url], runtime); selected.push(admitted.sourceId);
    const scoped = { ...runtime, CRUCIBLE_RETRIEVAL_SOURCE_ID: admitted.sourceId, CRUCIBLE_EXTRACTION_SOURCE_ID: admitted.sourceId };
    const retrievalReport = await retrieval(['run'], scoped); const extractionReports = [];
    for (let pass = 0; pass < maximumExtractionPasses; pass += 1) {
      const result = extraction(['run'], scoped); extractionReports.push(result);
      if (!result.continuing || result.blocked || !result.processed) break;
    }
    outcomes.push({ seedId: seed.id, sourceId: admitted.sourceId, created: admitted.created, retrieval: retrievalReport, extraction: extractionReports });
  }
  const queue = new AtomicClaimExtractionQueue(hydrated.queueFile, custody.projectId); const held = queue.lock();
  try {
    const current = queue.read();
    for (const source of records(current)) if (source.durablePath) {
      const absolute = path.resolve(source.durablePath); const target = path.join(path.resolve(workingRoot), 'sources', sourceFilename(source));
      regular(absolute);
      if (absolute !== target) {
        if (path.dirname(absolute) !== path.resolve(workingRoot) || !selected.includes(source.id)) fail('new source bytes escaped the working snapshot');
        if (!fs.existsSync(target)) fs.copyFileSync(absolute, target, fs.constants.COPYFILE_EXCL);
        if (sha256File(target) !== source.contentSha256) fail('content-addressed destination changed');
        source.durablePath = target; fs.unlinkSync(absolute);
      }
    }
    queue.write(current);
    const sourceFiles = new Map(manifest.sourceFiles.map((entry) => [entry.name, entry]));
    for (const source of records(current)) if (source.durablePath) {
      const name = path.basename(source.durablePath); const file = path.join(workingRoot, 'sources', name); const stat = regular(file); const hash = sha256File(file);
      if (hash !== source.contentSha256) fail('source hash changed');
      if (!sourceFiles.has(name)) sourceFiles.set(name, { name, sha256: hash, bytes: stat.size });
    }
    // Only validated source records add manifest entries; arbitrary snapshot files cannot enter custody.
    fs.writeFileSync(path.join(workingRoot, 'manifest.json'), `${JSON.stringify({ ...manifest, sourceFiles: [...sourceFiles.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2)}\n`, { mode: 0o600 });
    restageRestored({ root: workingRoot, repository, ref });
  } finally { held.release(); }
  const afterQueue = read(hydrated.queueFile); const afterLearning = read(path.join(workingRoot, manifest.learningFile));
  assertPreserved(beforeQueue, afterQueue, beforeLearning, afterLearning, new Set(selected));
  if (sha256File(path.join(root, 'source-queue.json')) !== originalQueueHash || sha256File(path.join(root, manifest.learningFile)) !== originalLearningHash) fail('original custody changed concurrently');
  for (const file of manifest.sourceFiles) if (sha256File(path.join(workingRoot, 'sources', file.name)) !== file.sha256 || sha256File(path.join(root, 'sources', file.name)) !== file.sha256) fail('existing source content changed');
  const after = verifyRestored({ root: workingRoot, repository, ref, reportFile: `${reportFile}.after`, provenance: 'raw-intake' });
  const sources = records(afterQueue).filter((source) => selected.includes(source.id)).map((source) => ({ id: source.id, url: source.url, state: source.state, contentSha256: source.contentSha256, candidateIds: source.claimExtraction?.candidateIds || [], blocker: source.blocker, extractionError: source.claimExtraction?.lastError || null, quarantineReasons: source.quarantineReasons || [] }));
  const changed = after.queueSha256 !== custody.queueSha256 || after.learningSha256 !== custody.learningSha256;
  const report = { schemaVersion: 1, projectId: custody.projectId, repository, ref, sourceRegisterSha256: expectedRegisterSha256, seedCount: seeds.length, changed, sources, outcomes, before: custody, after, existingCandidatesPreserved: true, existingKnowledgePreserved: true, originalSnapshotUnchanged: true, candidateOnly: true, authorizesPromotion: false };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); return report;
}

function publishCiphertext({ ciphertextRoot, stateRoot, expectedPriorManifestSha256, repository, ref }) {
  const state = path.resolve(stateRoot); const priorFile = path.join(state, 'encrypted-chunks.json');
  regular(priorFile);
  const held = new AtomicClaimExtractionQueue(priorFile, `github:${repository}`).lock();
  try {
  if (!/^[a-f0-9]{64}$/.test(expectedPriorManifestSha256 || '') || sha256File(priorFile) !== expectedPriorManifestSha256) fail('raw custody moved since restoration');
  const incoming = read(path.join(ciphertextRoot, 'encrypted-chunks.json')); const prior = read(priorFile);
  const checkRoot = fs.mkdtempSync(path.join(path.dirname(state), 'raw-ciphertext-check-'));
  try {
    for (const [directory, name] of [[state, 'prior'], [ciphertextRoot, 'incoming']]) {
      for (const chunk of read(path.join(directory, 'encrypted-chunks.json')).chunks) regular(chunkFile(directory, chunk.name));
      const joined = path.join(checkRoot, `${name}.enc`); joinEncrypted({ inputRoot: directory, output: joined });
      const { header } = readHeader(joined); validateIdentity(header.projectId, repository, ref);
    }
    if (readHeader(path.join(checkRoot, 'prior.enc')).header.projectId !== readHeader(path.join(checkRoot, 'incoming.enc')).header.projectId) fail('incoming encrypted project identity changed');
    const chunks = incoming.chunks.map((chunk) => ({ ...chunk, name: `source-bundle-${chunk.sha256}.enc` }));
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]; const destination = chunkFile(state, chunk.name);
      if (fs.existsSync(destination)) { regular(destination); if (sha256File(destination) !== chunk.sha256) fail('immutable encrypted chunk collision'); }
      else fs.copyFileSync(chunkFile(ciphertextRoot, incoming.chunks[index].name), destination, fs.constants.COPYFILE_EXCL);
    }
    // Previous ciphertext is retained for rollback. The manifest switches only after all chunks verify.
    if (sha256File(priorFile) !== expectedPriorManifestSha256) fail('raw custody changed during staging');
    const rollbackName = `encrypted-manifest-${expectedPriorManifestSha256}.json`;
    if (!fs.existsSync(path.join(state, rollbackName))) fs.copyFileSync(priorFile, path.join(state, rollbackName), fs.constants.COPYFILE_EXCL);
    regular(path.join(state, rollbackName));
    if (sha256File(path.join(state, rollbackName)) !== expectedPriorManifestSha256) fail('rollback manifest changed');
    const temporary = path.join(state, `encrypted-chunks.${crypto.randomUUID()}.tmp`);
    try { fs.writeFileSync(temporary, `${JSON.stringify({ ...incoming, chunks }, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, priorFile); }
    finally { fs.rmSync(temporary, { force: true }); }
    return { encryptedSha256: incoming.encryptedSha256, priorEncryptedSha256: prior.encryptedSha256, rollbackManifest: rollbackName, chunks: chunks.length, authorizesPromotion: false };
  } finally { fs.rmSync(checkRoot, { recursive: true, force: true }); }
  } finally { held.release(); }
}

async function main() {
  const [command, ...args] = process.argv.slice(2); const value = (name) => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) fail(`${name} is required`); return args[i + 1]; };
  if (command === 'prepare') return prepare({ root: value('--root'), workingRoot: value('--working-root'), repository: value('--repository'), ref: value('--ref'), sourceRegister: value('--source-register'), expectedRegisterSha256: value('--source-register-sha256'), reportFile: value('--report') });
  if (command === 'publish-ciphertext') return publishCiphertext({ ciphertextRoot: value('--ciphertext-root'), stateRoot: value('--state-root'), expectedPriorManifestSha256: value('--prior-manifest-sha256'), repository: value('--repository'), ref: value('--ref') });
  fail('usage: prepare|publish-ciphertext');
}
if (require.main === module) main().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`[The Crucible] ${error.message}`); process.exitCode = 1; });
module.exports = { approvedSeeds, assertPreserved, prepare, publishCiphertext };
