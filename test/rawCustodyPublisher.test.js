'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { prepare, publishCiphertext, approvedSeeds, assertPreserved } = require('../src/rawCustodyPublisher');
const { stage, sha256File, verifyRestored, encrypt, decrypt, splitEncrypted, joinEncrypted } = require('../src/hostedSourceBundle');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { SourceRetrievalWorker } = require('../src/sourceRetrievalWorker');
const { run: retrievalCli } = require('../src/sourceRetrievalWorkerCli');
const { run: extractionCli } = require('../src/claimExtractionWorkerCli');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const repository = 'owner/repo'; const ref = 'refs/heads/development'; const projectId = `github:${repository}`;

function fixture(t, urls = ['https://research.example.edu/paper']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-raw-publisher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = path.join(root, 'original'); fs.mkdirSync(original);
  const bytes = Buffer.from('An existing unrelated source must remain immutable through a bounded intake batch.');
  const sourceFile = path.join(original, `${sha(bytes)}.txt`); fs.writeFileSync(sourceFile, bytes);
  const oldSource = { id: 'old-source', url: 'https://old.example.edu/source', state: 'claim-extraction-complete', durablePath: sourceFile, contentSha256: sha(bytes), mediaType: 'text/plain', claimExtraction: { candidateIds: [] } };
  const queueFile = path.join(original, 'source-queue.json');
  fs.writeFileSync(queueFile, JSON.stringify({ schemaVersion: 1, projectId, documents: [], links: [oldSource, { id: 'unrelated-pending', url: 'https://old.example.edu/pending', state: 'research-approved-pending-retrieval' }] }));
  const worker = new ClaimExtractionWorker({ queueFile, projectId, learningRoot: original });
  worker.store.ingest(worker.candidate(oldSource, 'Existing candidates must not be rewritten during new source intake.', 'Original assertion only', new Date().toISOString()));
  // Existing version metadata is preserved, not used as a claim of verification.
  const payload = worker.store.read(); payload.knowledgeVersions.push({ projectId, version: 1, proofSha256: 'a'.repeat(64), state: 'active' }); payload.activeVersion = 1; worker.store.writeEnvelope(payload);
  const raw = path.join(root, 'raw'); stage({ sourceRoot: original, learningFile: worker.store.file, stagingRoot: raw, repository, ref });
  const register = path.join(root, 'register.json'); fs.writeFileSync(register, JSON.stringify({ candidateSourceSeeds: urls.map((url, index) => ({ id: `seed-${index}`, url })) }));
  return { root, raw, register, options: { root: raw, workingRoot: path.join(root, 'working'), repository, ref, sourceRegister: register, expectedRegisterSha256: sha256File(register), reportFile: path.join(root, 'report.json') } };
}

function boundedRetrieval(contentByUrl, calls) {
  return async (argv, env) => {
    if (argv[0] === 'admit') return retrievalCli(argv, env);
    const worker = new SourceRetrievalWorker({ queueFile: env.CRUCIBLE_SOURCE_QUEUE, projectId: env.CRUCIBLE_LEARNING_PROJECT_ID, auditRoot: path.join(env.CRUCIBLE_LEARNING_ROOT, 'retrieval'), sourceId: env.CRUCIBLE_RETRIEVAL_SOURCE_ID, maximumSources: 1, minimumIntervalMs: 0,
      retrieverFactory: () => ({ retrieve: async (url) => {
        calls.push(url); const value = contentByUrl[url];
        if (value instanceof Error) throw value;
        if (value === 'quarantined') return { record: { state: 'quarantined', retrievedAt: new Date().toISOString(), quarantineReasons: ['explicit prompt injection'] }, content: null };
        const content = Buffer.from(value); return { record: { state: 'retrieved-candidate-evidence', finalUrl: url, retrievedAt: new Date().toISOString(), author: 'Fixture author', license: 'Fixture terms', contentType: 'text/plain', contentLength: content.length, contentSha256: sha(content), retrievedContentSha256: sha(content), retrievedContentLength: content.length }, content };
      } }) });
    const outcomes = await worker.run(); return { processed: outcomes.length, outcomes };
  };
}

test('raw intake preserves unrelated queue/candidate/knowledge state and repeats without retrieval or duplicate candidates', async (t) => {
  const f = fixture(t); const calls = []; const retrieval = boundedRetrieval({ 'https://research.example.edu/paper': 'A bounded source assertion requires independent scientific verification before it can affect learned knowledge.' }, calls);
  const before = { queue: sha256File(path.join(f.raw, 'source-queue.json')), learning: sha256File(path.join(f.raw, read(path.join(f.raw, 'manifest.json')).learningFile)) };
  const report = await prepare({ ...f.options, retrieval });
  assert.equal(report.existingCandidatesPreserved, true); assert.equal(report.existingKnowledgePreserved, true); assert.equal(report.originalSnapshotUnchanged, true);
  assert.equal(report.sources[0].state, 'claim-extraction-complete'); assert.equal(report.sources[0].candidateIds.length, 1); assert.equal(report.authorizesPromotion, false);
  assert.deepEqual(calls, ['https://research.example.edu/paper']);
  assert.equal(sha256File(path.join(f.raw, 'source-queue.json')), before.queue); assert.equal(sha256File(path.join(f.raw, read(path.join(f.raw, 'manifest.json')).learningFile)), before.learning);
  const restored = verifyRestored({ root: f.options.workingRoot, repository, ref, reportFile: path.join(f.root, 'verified.json') }); assert.equal(restored.sourceFiles, 2); assert.equal(restored.vetted, false);
  const repeat = await prepare({ ...f.options, root: f.options.workingRoot, workingRoot: path.join(f.root, 'repeat'), reportFile: path.join(f.root, 'repeat-report.json'), retrieval });
  assert.equal(calls.length, 1); assert.equal(repeat.outcomes[0].created, false); assert.equal(repeat.sources[0].candidateIds.length, 1);
  assert.equal(repeat.changed, false);
  const learning = read(path.join(f.root, 'repeat', read(path.join(f.root, 'repeat', 'manifest.json')).learningFile));
  assert.equal(learning.payload.candidateRecords.length, 2); assert.equal(learning.payload.activeVersion, 1);
});

test('raw intake retains blocked and quarantined outcomes without unsafe bytes or retrying unrelated queues', async (t) => {
  const urls = ['https://research.example.edu/injection', 'https://research.example.edu/executable', 'https://research.example.edu/denied']; const f = fixture(t, urls); const calls = [];
  const retrieval = boundedRetrieval({ [urls[0]]: 'quarantined', [urls[1]]: new Error('Executable content quarantined'), [urls[2]]: new Error('HTTP 403.') }, calls);
  const report = await prepare({ ...f.options, retrieval });
  assert.deepEqual(report.sources.map((source) => source.state), ['quarantined', 'retrieval-blocked', 'retrieval-blocked']);
  assert.equal(report.sources.every((source) => source.contentSha256 === null && source.candidateIds.length === 0), true);
  assert.equal(report.after.sourceFiles, 1); assert.deepEqual(calls, urls);
  const repeated = await prepare({ ...f.options, root: f.options.workingRoot, workingRoot: path.join(f.root, 'repeat'), reportFile: path.join(f.root, 'repeat-report.json'), retrieval });
  assert.equal(calls.length, 3); assert.equal(repeated.sources[0].state, 'quarantined');
});

test('changed approval, arbitrary commercial source, foreign project, or in-place snapshot fail closed', async (t) => {
  const f = fixture(t); await assert.rejects(prepare({ ...f.options, expectedRegisterSha256: '0'.repeat(64) }), /approved hash/);
  await assert.rejects(prepare({ ...f.options, repository: 'foreign/repo' }), /project identity/);
  await assert.rejects(prepare({ ...f.options, workingRoot: f.raw }), /new and separate/);
  const bad = fixture(t, ['https://commercial.example.com/source']); await assert.rejects(prepare(bad.options), /positive trust allow-list/);
  assert.throws(() => approvedSeeds({ sourceRegister: f.register, expectedRegisterSha256: f.options.expectedRegisterSha256, maximumSources: 0 }), /approved bound/);
  fs.writeFileSync(path.join(f.raw, 'source-queue.json.claim-extraction.lock'), 'unresolved lock');
  await assert.rejects(prepare(f.options), /unresolved worker lock/);
  assert.equal(fs.readFileSync(path.join(f.raw, 'source-queue.json.claim-extraction.lock'), 'utf8'), 'unresolved lock');
});

test('a failed extractor preserves resumable error evidence without clearing earlier candidates', async (t) => {
  const f = fixture(t); const calls = []; const retrieval = boundedRetrieval({ 'https://research.example.edu/paper': 'A candidate remains unavailable until a bounded extraction attempt succeeds.' }, calls);
  const extraction = (argv, env) => {
    const worker = new ClaimExtractionWorker({ queueFile: env.CRUCIBLE_SOURCE_QUEUE, projectId: env.CRUCIBLE_LEARNING_PROJECT_ID, learningRoot: env.CRUCIBLE_LEARNING_ROOT, sourceId: env.CRUCIBLE_EXTRACTION_SOURCE_ID, maximumSources: 1, maximumDocuments: 1, extractText: () => { throw new Error('bounded parser failure'); } });
    const outcomes = worker.run(); return { processed: outcomes.length, blocked: outcomes.length, continuing: 0 };
  };
  const report = await prepare({ ...f.options, retrieval, extraction }); assert.equal(report.sources[0].state, 'claim-extraction-forced-pending'); assert.match(report.sources[0].extractionError, /bounded parser failure/);
  const resumed = await prepare({ ...f.options, root: f.options.workingRoot, workingRoot: path.join(f.root, 'resumed'), reportFile: path.join(f.root, 'resumed-report.json'), retrieval, extraction: extractionCli });
  assert.equal(calls.length, 1); assert.equal(resumed.sources[0].state, 'claim-extraction-complete'); assert.equal(resumed.existingCandidatesPreserved, true);
});

test('preservation guard rejects candidate changes, lost sources, and knowledge promotion', (t) => {
  const f = fixture(t); const manifest = read(path.join(f.raw, 'manifest.json')); const queue = read(path.join(f.raw, 'source-queue.json')); const learning = read(path.join(f.raw, manifest.learningFile));
  const missing = structuredClone(queue); missing.links.pop(); assert.throws(() => assertPreserved(queue, missing, learning, learning, new Set()), /removed/);
  const candidateChanged = structuredClone(learning); candidateChanged.payload.candidateRecords[0].candidate.claim = 'changed'; assert.throws(() => assertPreserved(queue, queue, learning, candidateChanged, new Set()), /existing candidate changed/);
  const promoted = structuredClone(learning); promoted.payload.activeVersion = null; assert.throws(() => assertPreserved(queue, queue, learning, promoted, new Set()), /learned state changed/);
});

test('ciphertext publication survives fresh-process restore, preserves rollback and rejects stale or tampered input', async (t) => {
  const f = fixture(t); const priorKey = process.env.CRUCIBLE_SOURCE_BUNDLE_KEY; process.env.CRUCIBLE_SOURCE_BUNDLE_KEY = crypto.randomBytes(32).toString('base64');
  t.after(() => { if (priorKey === undefined) delete process.env.CRUCIBLE_SOURCE_BUNDLE_KEY; else process.env.CRUCIBLE_SOURCE_BUNDLE_KEY = priorKey; });
  const state = path.join(f.root, 'state'); const incoming = path.join(f.root, 'incoming'); const oldPlain = path.join(f.root, 'old.bin'); const newPlain = path.join(f.root, 'new.bin');
  fs.writeFileSync(oldPlain, 'old encrypted custody'); fs.writeFileSync(newPlain, 'new candidate custody');
  for (const [plain, name, outputRoot] of [[oldPlain, 'old', state], [newPlain, 'new', incoming]]) {
    const encrypted = path.join(f.root, `${name}.enc`); await encrypt({ input: plain, output: encrypted, projectId, repository, ref }); splitEncrypted({ input: encrypted, outputRoot });
  }
  fs.writeFileSync(path.join(state, 'README.md'), 'unrelated metadata'); const oldManifestHash = sha256File(path.join(state, 'encrypted-chunks.json'));
  const published = publishCiphertext({ ciphertextRoot: incoming, stateRoot: state, expectedPriorManifestSha256: oldManifestHash, repository, ref });
  assert.equal(published.authorizesPromotion, false); assert.equal(sha256File(path.join(state, published.rollbackManifest)), oldManifestHash); assert.equal(fs.readFileSync(path.join(state, 'README.md'), 'utf8'), 'unrelated metadata');
  assert.equal(fs.existsSync(path.join(state, 'source-bundle.part-0000.enc')), true, 'previous ciphertext is retained');
  const joined = path.join(f.root, 'joined.enc'); const bundleCli = path.join(__dirname, '../src/hostedSourceBundle.js');
  execFileSync(process.execPath, [bundleCli, 'join', '--input-root', state, '--output', joined], { windowsHide: true });
  const restored = path.join(f.root, 'restored.bin');
  execFileSync(process.execPath, [bundleCli, 'decrypt', '--input', joined, '--output', restored, '--repository', repository, '--ref', ref, '--keys', 'CRUCIBLE_SOURCE_BUNDLE_KEY'], { windowsHide: true });
  assert.equal(fs.readFileSync(restored, 'utf8'), 'new candidate custody');
  assert.throws(() => publishCiphertext({ ciphertextRoot: incoming, stateRoot: state, expectedPriorManifestSha256: oldManifestHash, repository, ref }), /moved since restoration/);
  const currentHash = sha256File(path.join(state, 'encrypted-chunks.json')); const chunks = read(path.join(incoming, 'encrypted-chunks.json')).chunks; fs.appendFileSync(path.join(incoming, chunks[0].name), 'tampered');
  assert.throws(() => publishCiphertext({ ciphertextRoot: incoming, stateRoot: state, expectedPriorManifestSha256: currentHash, repository, ref }), /chunk failed custody verification/); assert.equal(sha256File(path.join(state, 'encrypted-chunks.json')), currentHash);
});

test('manual raw publisher cannot run automatically or write vetted custody', () => {
  const text = fs.readFileSync(path.join(__dirname, '../.github/workflows/raw-custody-publisher.yml'), 'utf8').replace(/\r\n/g, '\n'); const triggers = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
  assert.match(triggers, /workflow_dispatch:/); assert.doesNotMatch(triggers, /\bpush:|\bschedule:|workflow_run:/); assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.match(text, /source-register-sha256 "\$APPROVED_REGISTER_SHA256"/); assert.match(text, /--prior-manifest-sha256/); assert.match(text, /Crucible-Learning-State\.git/); assert.doesNotMatch(text, /VETTED|Vetted-Learning-State|force-with-lease|--force/);
  assert.match(text, /Destroy runner plaintext and credentials[\s\S]*if: always\(\)/);
});

test('complete candidate snapshot survives archive encryption and independent process restore without claiming vetted provenance', async (t) => {
  const f = fixture(t); const calls = [];
  await prepare({ ...f.options, retrieval: boundedRetrieval({ 'https://research.example.edu/paper': 'A retained source assertion requires controlled testing and distinct independent verification before promotion.' }, calls) });
  const manifest = read(path.join(f.options.workingRoot, 'manifest.json'));
  const archive = path.join(f.root, 'snapshot.tar.gz'); const encrypted = path.join(f.root, 'snapshot.enc'); const restoredArchive = path.join(f.root, 'restored.tar.gz'); const restoredRoot = path.join(f.root, 'fresh');
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-czf', archive, '-C', f.options.workingRoot, 'manifest.json', 'source-queue.json', 'sources', manifest.learningFile], { windowsHide: true });
  const priorKey = process.env.CRUCIBLE_SOURCE_BUNDLE_KEY; process.env.CRUCIBLE_SOURCE_BUNDLE_KEY = crypto.randomBytes(32).toString('base64');
  t.after(() => { if (priorKey === undefined) delete process.env.CRUCIBLE_SOURCE_BUNDLE_KEY; else process.env.CRUCIBLE_SOURCE_BUNDLE_KEY = priorKey; });
  await encrypt({ input: archive, output: encrypted, projectId, repository, ref });
  const bundleCli = path.join(__dirname, '../src/hostedSourceBundle.js');
  execFileSync(process.execPath, [bundleCli, 'decrypt', '--input', encrypted, '--output', restoredArchive, '--repository', repository, '--ref', ref, '--keys', 'CRUCIBLE_SOURCE_BUNDLE_KEY'], { windowsHide: true });
  fs.mkdirSync(restoredRoot); execFileSync(tar, ['-xzf', restoredArchive, '-C', restoredRoot], { windowsHide: true });
  execFileSync(process.execPath, [bundleCli, 'verify', '--root', restoredRoot, '--repository', repository, '--ref', ref, '--report', path.join(f.root, 'fresh-report.json'), '--provenance', 'raw-intake'], { windowsHide: true });
  assert.equal(read(path.join(f.root, 'fresh-report.json')).vetted, false);
  assert.equal(sha256File(path.join(restoredRoot, manifest.learningFile)), manifest.learningSha256);
  const candidates = read(path.join(restoredRoot, manifest.learningFile)).payload.candidateRecords;
  assert.equal(candidates.length, 2); assert.equal(candidates.every((record) => record.state === 'candidate' && Object.values(record.gates).every((gate) => gate === false)), true);
});
