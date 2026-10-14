'use strict';
// Encrypted owner evidence transport. It never extracts claims or promotes knowledge.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { operationalError } = require('./failureCodes');
const { encrypt, decrypt, readHeader, sha256File, validateIdentity, verifyRestored, hydrateRestored, restageRestored } = require('./hostedSourceBundle');
const { preflightOwnerFile, ingestOwnerFiles } = require('./ownerFileIntake');
const { AtomicClaimExtractionQueue } = require('./claimExtractionWorker');
const { assertPreserved } = require('./rawCustodyPublisher');
const MAX_BYTES = 192 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const fail = (m) => { throw operationalError('OPS-0044', `Owner-file transport refused: ${m}`); };
function regular(f, max = MAX_BYTES) { const s = fs.lstatSync(f); if (!s.isFile() || s.isSymbolicLink() || s.size < 1 || s.size > max) fail('requires a bounded regular non-symbolic file'); return s; }
function name(n) { if (typeof n !== 'string' || !n || n.includes('/') || n.includes('\\') || n === '.' || n === '..' || n.includes('\0')) fail('invalid original filename'); return n; }
function decode(record, max) {
  name(record.originalName);
  if (!HASH.test(record.sha256 || '') || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > max || typeof record.contentBase64 !== 'string') fail('invalid file metadata');
  if (record.contentBase64.length !== 4 * Math.ceil(record.bytes / 3)) fail('invalid encoded size');
  const bytes = Buffer.from(record.contentBase64, 'base64');
  if (bytes.toString('base64') !== record.contentBase64 || bytes.length !== record.bytes || hash(bytes) !== record.sha256) fail('file bytes do not match approved metadata');
  return bytes;
}
function validateRequest(request, repository, ref) {
  if (request.schemaVersion !== 1 || request.kind !== 'owner-file-request' || request.repository !== repository || request.ref !== ref || request.promotionAuthorized !== false) fail('request boundary mismatch');
  validateIdentity(request.projectId, repository, ref);
  if (!Array.isArray(request.sources) || request.sources.length < 1 || request.sources.length > 25 || !Array.isArray(request.supportingArtifacts) || request.supportingArtifacts.length > 5) fail('request count exceeded');
  const ids = new Set(); let size = 0;
  for (const r of request.sources) { decode(r, 128 * 1024 * 1024); if (ids.has(r.sha256)) fail('duplicate requested source'); ids.add(r.sha256); size += r.bytes; }
  for (const r of request.supportingArtifacts) { decode(r, 2 * 1024 * 1024); size += r.bytes; }
  if (size > 128 * 1024 * 1024) fail('total request exceeded');
  return request;
}
async function pack({ files, supportingFiles = [], output, projectId, repository, ref }) {
  validateIdentity(projectId, repository, ref);
  if (!Array.isArray(files) || files.length < 1 || files.length > 25 || !Array.isArray(supportingFiles) || supportingFiles.length > 5) fail('request count exceeded');
  const sources = files.map((file) => { const p = preflightOwnerFile(file); return { originalName: name(path.basename(file)), sha256: p.contentSha256, bytes: p.stat.size, contentBase64: fs.readFileSync(file).toString('base64') }; });
  const supportingArtifacts = supportingFiles.map((file) => { regular(file, 2 * 1024 * 1024); const b = fs.readFileSync(file); return { originalName: name(path.basename(file)), sha256: hash(b), bytes: b.length, contentBase64: b.toString('base64') }; });
  const request = validateRequest({ schemaVersion: 1, kind: 'owner-file-request', projectId, repository, ref, promotionAuthorized: false, sources, supportingArtifacts }, repository, ref);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-owner-pack-')); const input = path.join(temp, 'request.json');
  try { fs.writeFileSync(input, JSON.stringify(request), { mode: 0o600, flag: 'wx' }); await encrypt({ input, output, projectId, repository, ref }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
  return { requestSha256: sha256File(output), sourceHashes: sources.map((r) => r.sha256), supportingHashes: supportingArtifacts.map((r) => r.sha256), candidateOnly: true, promotionAuthorized: false };
}
function copyCustody(root, workingRoot, manifest) {
  const a = path.resolve(root), b = path.resolve(workingRoot);
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep) || fs.existsSync(b)) fail('working custody must be new and separate');
  regular(path.join(root, 'manifest.json'));
  for (const f of ['source-queue.json', manifest.learningFile]) { name(f); regular(path.join(root, f)); }
  for (const f of manifest.sourceFiles) { name(f.name); regular(path.join(root, 'sources', f.name)); }
  fs.mkdirSync(path.join(b, 'sources'), { recursive: true, mode: 0o700 });
  for (const f of ['manifest.json', 'source-queue.json', manifest.learningFile]) fs.copyFileSync(path.join(a, f), path.join(b, f), fs.constants.COPYFILE_EXCL);
  for (const f of manifest.sourceFiles) fs.copyFileSync(path.join(a, 'sources', f.name), path.join(b, 'sources', f.name), fs.constants.COPYFILE_EXCL);
}
async function prepare({ root, workingRoot, encryptedRequest, expectedRequestSha256, repository, ref, reportFile }) {
  regular(encryptedRequest);
  if (!HASH.test(expectedRequestSha256 || '') || sha256File(encryptedRequest) !== expectedRequestSha256) fail('encrypted request differs from exact approved hash');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-owner-import-')); const plaintext = path.join(temp, 'request.json');
  try {
    const header = await decrypt({ input: encryptedRequest, output: plaintext, repository, ref, keyNames: ['CRUCIBLE_SOURCE_BUNDLE_KEY', 'CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS'] });
    regular(plaintext);
    const request = validateRequest(read(plaintext), repository, ref);
    if (request.projectId !== header.projectId) fail('request and encrypted project identities differ');
    regular(path.join(root, 'manifest.json')); const manifest = read(path.join(root, 'manifest.json'));
    name(manifest.learningFile); for (const f of manifest.sourceFiles) name(f.name);
    const custody = verifyRestored({ root, repository, ref, reportFile: path.join(temp, 'before.json'), provenance: 'raw-intake' });
    if (custody.projectId !== request.projectId || manifest.learningFile !== hash(custody.projectId) + '.learning.json') fail('request differs from canonical project/store identity');
    if (fs.existsSync(path.join(root, 'source-queue.json.claim-extraction.lock')) || fs.existsSync(path.join(root, manifest.learningFile + '.lock'))) fail('unresolved worker lock; do not clear or restart');
    const beforeQueue = read(path.join(root, 'source-queue.json')); const beforeLearning = read(path.join(root, manifest.learningFile));
    const sourceFiles = request.sources.map((r) => { const f = path.join(temp, r.sha256 + path.extname(r.originalName).toLowerCase()); fs.writeFileSync(f, decode(r, 128 * 1024 * 1024), { flag: 'wx', mode: 0o600 }); preflightOwnerFile(f); return f; });
    copyCustody(root, workingRoot, manifest);
    const hydrated = hydrateRestored({ root: workingRoot, repository, ref });
    const intake = ingestOwnerFiles({ queueFile: hydrated.queueFile, projectId: custody.projectId, files: sourceFiles });
    const queue = new AtomicClaimExtractionQueue(hydrated.queueFile, custody.projectId); const held = queue.lock();
    try {
      const current = queue.read(); const admitted = new Set(intake.admitted.map((r) => r.sourceId));
      const entries = new Map(manifest.sourceFiles.map((f) => [f.name, f]));
      for (const r of current.documents) if (admitted.has(r.id)) {
        const requestRecord = request.sources.find((s) => s.sha256 === r.contentSha256);
        const old = r.durablePath; const dest = path.join(workingRoot, 'sources', path.basename(old));
        if (path.dirname(path.resolve(old)) !== path.resolve(workingRoot)) fail('intake escaped working custody');
        fs.copyFileSync(old, dest, fs.constants.COPYFILE_EXCL); fs.unlinkSync(old); r.durablePath = path.resolve(dest); r.originalName = requestRecord.originalName; r.title = path.basename(requestRecord.originalName, path.extname(requestRecord.originalName));
        entries.set(path.basename(dest), { name: path.basename(dest), sha256: r.contentSha256, bytes: fs.statSync(dest).size });
      }
      // Supporting catalogs stay encrypted in manifest custody, never in the extraction queue.
      for (const r of request.supportingArtifacts) {
        const fileName = 'owner-support-' + r.sha256 + '.bin'; const dest = path.join(workingRoot, 'sources', fileName);
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, decode(r, 2 * 1024 * 1024), { flag: 'wx', mode: 0o600 });
        if (sha256File(dest) !== r.sha256) fail('supporting artifact changed');
        entries.set(fileName, { name: fileName, sha256: r.sha256, bytes: r.bytes });
      }
      queue.write(current);
      fs.writeFileSync(path.join(workingRoot, 'manifest.json'), JSON.stringify({ ...manifest, sourceFiles: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + '\n', { mode: 0o600 });
      restageRestored({ root: workingRoot, repository, ref });
    } finally { held.release(); }
    assertPreserved(beforeQueue, read(hydrated.queueFile), beforeLearning, read(path.join(workingRoot, manifest.learningFile)), new Set());
    if (sha256File(path.join(root, 'source-queue.json')) !== custody.queueSha256 || sha256File(path.join(root, manifest.learningFile)) !== custody.learningSha256) fail('original custody changed concurrently');
    for (const f of manifest.sourceFiles) if (sha256File(path.join(root, 'sources', f.name)) !== f.sha256) fail('original source changed concurrently');
    const after = verifyRestored({ root: workingRoot, repository, ref, reportFile: path.join(temp, 'after.json'), provenance: 'raw-intake' });
    const receipt = (r) => ({ sourceId: r.sourceId, contentSha256: r.contentSha256, state: r.state });
    const result = { schemaVersion: 1, projectId: custody.projectId, requestSha256: expectedRequestSha256, publicationStatus: 'PREPARED_NOT_PUBLISHED', admitted: intake.admitted.map(receipt), alreadyPresent: intake.alreadyPresent.map(receipt), supportingArtifacts: request.supportingArtifacts.map(({ originalName, sha256 }) => ({ originalName, sha256 })), changed: custody.queueSha256 !== after.queueSha256 || JSON.stringify(manifest.sourceFiles.map((f) => f.sha256).sort()) !== JSON.stringify(read(path.join(workingRoot, 'manifest.json')).sourceFiles.map((f) => f.sha256).sort()), existingCandidatesPreserved: true, existingKnowledgePreserved: true, candidateOnly: true, promotionAuthorized: false, before: custody, after };
    fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); return result;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function stageRequest({ encryptedRequest, expectedRequestSha256, stateRoot, repository, ref }) {
  regular(encryptedRequest);
  if (!HASH.test(expectedRequestSha256 || '') || sha256File(encryptedRequest) !== expectedRequestSha256) fail('encrypted request differs from exact approved hash');
  validateIdentity(readHeader(encryptedRequest).header.projectId, repository, ref);
  const root = path.resolve(stateRoot); const folder = path.join(root, 'owner-intake');
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) fail('state checkout is not a real directory');
  regular(path.join(root, 'encrypted-chunks.json'));
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { mode: 0o700 });
  if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) fail('request folder is not a real directory');
  const destination = path.join(folder, expectedRequestSha256 + '.enc');
  if (!fs.existsSync(destination)) fs.copyFileSync(encryptedRequest, destination, fs.constants.COPYFILE_EXCL);
  regular(destination); if (sha256File(destination) !== expectedRequestSha256) fail('immutable request collision');
  return { requestSha256: expectedRequestSha256, relativePath: 'owner-intake/' + expectedRequestSha256 + '.enc', publicationStatus: 'STAGED_NOT_PUSHED', promotionAuthorized: false };
}
async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv; const get = (flag) => { const i = args.indexOf(flag); if (i < 0 || !args[i + 1]) fail(flag + ' is required'); return args[i + 1]; };
  const repository = get('--repository'), ref = get('--ref');
  if (command === 'stage-request') return stageRequest({ encryptedRequest: get('--request'), expectedRequestSha256: get('--request-sha256'), stateRoot: get('--state-root'), repository, ref });
  if (command === 'pack') { const list = read(get('--file-list')); return pack({ files: list.files, supportingFiles: list.supportingFiles || [], output: get('--output'), projectId: get('--project-id'), repository, ref }); }
  if (command === 'prepare') return prepare({ root: get('--root'), workingRoot: get('--working-root'), encryptedRequest: get('--request'), expectedRequestSha256: get('--request-sha256'), repository, ref, reportFile: get('--report') });
  fail('usage: pack|stage-request|prepare');
}
if (require.main === module) main().then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { pack, prepare, stageRequest, validateRequest };
