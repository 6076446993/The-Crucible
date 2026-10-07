'use strict';

// The sole raw-custody publisher used for the owner-authorized R8 executable-format
// canary. It deliberately handles only a restored, authenticated bundle and ciphertext;
// the workflow owns decryption, encryption, and runner cleanup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyRestored, hydrateRestored, restageRestored, chunkFile, sha256File } = require('./hostedSourceBundle');
const { run: runRetrievalCli } = require('./sourceRetrievalWorkerCli');

function required(value, name) { if (!value || !String(value).trim()) throw new Error(`${name} is required.`); return String(value).trim(); }
function readQueue(root) { return JSON.parse(fs.readFileSync(path.join(root, 'source-queue.json'), 'utf8')); }
function records(queue) { return [...queue.documents, ...queue.links]; }
function sourceFileNames(root) { const directory = path.join(root, 'sources'); return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []; }
function plainFile(root, name) { return path.resolve(root, name); }

async function prepare({ root, repository, ref, canaryUrl, reportFile, environment = process.env }) {
  const custody = verifyRestored({ root, repository, ref, reportFile: `${reportFile}.custody`, provenance: 'raw-intake' });
  const hydrated = hydrateRestored({ root, repository, ref });
  const beforeFiles = sourceFileNames(root);
  const runtime = {
    ...environment,
    CRUCIBLE_LEARNING_PROJECT_ID: custody.projectId,
    CRUCIBLE_LEARNING_ROOT: path.resolve(root),
    CRUCIBLE_SOURCE_QUEUE: hydrated.queueFile,
    CRUCIBLE_RETRIEVAL_SOURCE_ID: '',
    CRUCIBLE_RETRIEVAL_BATCH_SIZE: '1',
    CRUCIBLE_RETRIEVAL_MINIMUM_INTERVAL_MS: '0',
  };
  const admitted = await runRetrievalCli(['admit', required(canaryUrl, 'canary URL')], runtime);
  // A fresh R8 run must prove an actual retrieval, not re-label an old queue result.
  if (!admitted.created) throw new Error(`R8 canary URL is already present as ${admitted.sourceId}; supply the approved fresh canary URL rather than reusing prior evidence.`);
  runtime.CRUCIBLE_RETRIEVAL_SOURCE_ID = admitted.sourceId;
  const retrieval = await runRetrievalCli(['run'], runtime);
  if (retrieval.processed !== 1 || retrieval.blocked !== 1 || retrieval.outcomes.length !== 1) throw new Error('R8 canary did not produce exactly one retrieval-blocked real retrieval outcome.');
  const source = records(readQueue(root)).find((item) => item.id === admitted.sourceId);
  if (!source || source.state !== 'retrieval-blocked') throw new Error('R8 canary source was not recorded as retrieval-blocked.');
  if (!/Executable content quarantined/i.test(String(source.blocker || ''))) throw new Error('R8 canary source lacks the real executable-content quarantine reason.');
  for (const field of ['durablePath', 'contentSha256', 'retrievedContentSha256']) {
    if (source[field]) throw new Error(`R8 canary persisted forbidden executable custody field ${field}.`);
  }
  if (JSON.stringify(source).includes('MZ') || JSON.stringify(source).includes('PK\u0003\u0004')) throw new Error('R8 canary queue record contains executable bytes.');
  const afterFiles = sourceFileNames(root);
  if (JSON.stringify(beforeFiles) !== JSON.stringify(afterFiles)) throw new Error('R8 canary created durable source bytes.');
  const manifest = restageRestored({ root, repository, ref });
  const report = {
    schemaVersion: 1,
    projectId: custody.projectId,
    repository,
    ref,
    verifiedAt: new Date().toISOString(),
    sourceId: source.id,
    state: source.state,
    quarantineReason: source.blocker,
    executableContentPersisted: false,
    durableSourceFilesBefore: beforeFiles.length,
    durableSourceFilesAfter: afterFiles.length,
    queueSha256: manifest.queueSha256,
    plaintextRetained: false,
    authorizesPromotion: false,
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

function verifiedManifest(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'encrypted-chunks.json'), 'utf8'));
  if (!Array.isArray(manifest.chunks) || !manifest.chunks.length) throw new Error('Encrypted publisher manifest lists no chunks.');
  for (const chunk of manifest.chunks) {
    const file = chunkFile(root, chunk.name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== chunk.bytes || sha256File(file) !== chunk.sha256) throw new Error(`Encrypted publisher chunk failed verification: ${chunk.name}.`);
  }
  return manifest;
}

function publishCiphertext({ ciphertextRoot, stateRoot }) {
  const incoming = verifiedManifest(ciphertextRoot);
  const prior = verifiedManifest(stateRoot);
  const state = path.resolve(stateRoot);
  const pending = [];
  for (const chunk of incoming.chunks) {
    const destination = chunkFile(state, chunk.name);
    const temporary = `${destination}.r8-pending-${crypto.randomUUID()}`;
    fs.copyFileSync(chunkFile(ciphertextRoot, chunk.name), temporary, fs.constants.COPYFILE_EXCL);
    pending.push({ destination, temporary });
  }
  const manifestTemporary = path.join(state, `encrypted-chunks.json.r8-pending-${crypto.randomUUID()}`);
  fs.copyFileSync(path.join(ciphertextRoot, 'encrypted-chunks.json'), manifestTemporary, fs.constants.COPYFILE_EXCL);
  try {
    for (const chunk of prior.chunks) fs.rmSync(chunkFile(state, chunk.name), { force: false });
    fs.rmSync(path.join(state, 'encrypted-chunks.json'), { force: false });
    for (const file of pending) fs.renameSync(file.temporary, file.destination);
    fs.renameSync(manifestTemporary, path.join(state, 'encrypted-chunks.json'));
  } finally {
    for (const file of pending) fs.rmSync(file.temporary, { force: true });
    fs.rmSync(manifestTemporary, { force: true });
  }
  return { encryptedSha256: incoming.encryptedSha256, chunks: incoming.chunks.length };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const value = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  if (command === 'prepare') return console.log(JSON.stringify(await prepare({ root: required(value('--root'), '--root'), repository: required(value('--repository'), '--repository'), ref: required(value('--ref'), '--ref'), canaryUrl: required(process.env.CRUCIBLE_R8_EXECUTABLE_CANARY_URL, 'CRUCIBLE_R8_EXECUTABLE_CANARY_URL'), reportFile: required(value('--report'), '--report') })));
  if (command === 'publish-ciphertext') return console.log(JSON.stringify(publishCiphertext({ ciphertextRoot: required(value('--ciphertext-root'), '--ciphertext-root'), stateRoot: required(value('--state-root'), '--state-root') })));
  throw new Error('Usage: r8ExecutableCanaryPublisher.js prepare|publish-ciphertext ...');
}
if (require.main === module) main().catch((error) => { console.error(`[The Crucible] R8 publisher failed closed: ${error.message}`); process.exitCode = 1; });
module.exports = { prepare, publishCiphertext, verifiedManifest };
