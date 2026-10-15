'use strict';
// Recovery is a circulation boundary shared by custody and learning, never a proof gate.
// Hashes detect accidental corruption. Only a separately pinned verifier signature can
// establish a recovery receipt; a directory copied by the worker is not independent custody.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { operationalError } = require('./failureCodes');
const { acquireDurableLock } = require('./durableLock');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
function refuse(message) { throw operationalError('OPS-0049', `Recovery refused: ${message}`); }
function regular(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) refuse('expected a regular unlinked file');
  return s;
}
function safePath(base, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(relative)) refuse('unsafe relative recovery path');
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep)) refuse('recovery path escapes root');
  return target;
}
function realDirectory(dir) {
  const absolute = path.resolve(dir);
  const actual = fs.realpathSync(absolute);
  const temp = path.resolve(os.tmpdir()), canonicalTemp = fs.realpathSync(temp);
  // macOS supplies /var/... as TMPDIR although that OS-owned prefix resolves to
  // /private/var/.... Accept only that exact inherited temporary-root mapping.
  // An additional symlink anywhere beneath it still fails this equality check.
  const underTemp = absolute === temp || absolute.startsWith(temp + path.sep);
  const expected = underTemp ? path.join(canonicalTemp, path.relative(temp, absolute)) : absolute;
  if (actual !== expected || fs.lstatSync(absolute).isSymbolicLink() || !fs.lstatSync(absolute).isDirectory()) refuse('directory contains a symbolic alias');
  return actual;
}
function assertNormalActivityAllowed(projectId) {
  if (!['github:6076446993/The-Crucible','github:jonathanblunt1214-lgtm/The-Crucible'].includes(projectId)) return;
  let policy;
  try { policy = JSON.parse(fs.readFileSync(path.join(__dirname,'..','governingDocuments','recovery-operation-policy.json'),'utf8')); }
  catch { refuse('recovery operating policy is missing or unreadable; normal activity held'); }
  if (policy.repository !== '6076446993/The-Crucible' || policy.branch !== 'development' || policy.mode !== 'normal' || policy.independentRecoveryAccepted !== true) refuse('owner P0 recovery-only hold; normal discovery, intake, extraction, learning and repairs remain inhibited');
}
function syncDirectory(dir) {
  // Unsupported directory flush is a hard stop, never silently upgraded to durable proof.
  let fd;
  let stage = 'open';
  try {
    // Windows FlushFileBuffers requires a write-capable handle. A read-only
    // directory handle cannot prove durability even if opening it succeeds.
    fd = fs.openSync(dir, process.platform === 'win32' ? 'r+' : 'r');
    stage = 'flush'; fs.fsyncSync(fd);
  }
  catch (error) { refuse(`directory durability is unavailable (${stage}:${error.code || 'SYNC_FAILED'}); mutation/restart inhibited`); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function immutable(file, bytes) {
  const parent = realDirectory(path.dirname(file));
  if (fs.existsSync(file)) {
    regular(file);
    if (!fs.readFileSync(file).equals(Buffer.from(bytes))) refuse('immutable generation collision');
    return;
  }
  const pending = path.join(parent, `.pending-${crypto.randomUUID()}`);
  const fd = fs.openSync(pending, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // Linking publishes a complete inode without overwriting an existing generation.
  try { fs.linkSync(pending, file); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { fs.unlinkSync(pending); }
  syncDirectory(parent);
  regular(file);
  if (!fs.readFileSync(file).equals(Buffer.from(bytes))) refuse('published generation differs');
}
function hashFile(file) {
  const before = regular(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== before.ino || opened.dev !== before.dev) refuse('file changed before hashing');
    let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n));
    const after = regular(file);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) refuse('file changed during hashing');
    return { size:before.size, sha256:hash.digest('hex') };
  } finally { fs.closeSync(fd); }
}
function immutableCopy(source, destination, expected) {
  if (fs.existsSync(destination)) {
    const found = hashFile(destination);
    if (found.sha256 !== expected.sha256 || found.size !== expected.size) refuse('immutable copy collision');
    return;
  }
  realDirectory(path.dirname(destination)); regular(source);
  const pending = path.join(path.dirname(destination), `.pending-${crypto.randomUUID()}`);
  // copyFile uses bounded native I/O rather than loading original PDFs into JS memory.
  fs.copyFileSync(source, pending, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(pending, 0o600);
  const fd = fs.openSync(pending, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const copied = hashFile(pending);
  if (copied.sha256 !== expected.sha256 || copied.size !== expected.size) refuse('source changed during copy');
  try { fs.linkSync(pending, destination); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { fs.unlinkSync(pending); }
  syncDirectory(path.dirname(destination));
  const found = hashFile(destination);
  if (found.sha256 !== expected.sha256 || found.size !== expected.size) refuse('published copy differs');
}
function inventory(root, excluded = []) {
  const base = realDirectory(root); const entries = [];
  const exclude = new Set(excluded.map(x => fs.realpathSync(path.resolve(x))));
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name); if (exclude.has(file)) continue;
      const s = fs.lstatSync(file); const relative = path.relative(base, file).split(path.sep).join('/');
      safePath(base, relative);
      if (s.isSymbolicLink()) refuse('symlink in recovery population');
      if (s.isDirectory()) { entries.push({ path:relative, type:'directory' }); walk(file); }
      else entries.push({ path:relative, type:'file', ...hashFile(file) });
    }
  }
  walk(base); return { schemaVersion:1, entries, digest:digest(json(entries)) };
}
function compare(before, after) {
  const a = new Map(before.entries.map(e => [e.path, json(e)]));
  const b = new Map(after.entries.map(e => [e.path, json(e)]));
  const missing = [...a.keys()].filter(k => !b.has(k));
  const changed = [...a.keys()].filter(k => b.has(k) && a.get(k) !== b.get(k));
  const added = [...b.keys()].filter(k => !a.has(k));
  return { ok:!missing.length && !changed.length && !added.length, missing, changed, added };
}

// Per-file write-ahead history closes the existing atomic-replace data-loss window.
// The caller already holds its native queue/store lock. No original bytes are deleted.
function historyRoot(file) { return path.join(path.dirname(file), '.crucible-recovery', digest(path.basename(file))); }
function ensureHistory(file) {
  const base = realDirectory(path.dirname(file));
  for (const dir of [path.join(base, '.crucible-recovery'), historyRoot(file)]) {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { mode:0o700 }); syncDirectory(path.dirname(dir)); }
    realDirectory(dir);
  }
  return historyRoot(file);
}
function readJournal(file) {
  const root = historyRoot(file);
  if (!fs.existsSync(root)) return [];
  realDirectory(root);
  const names = fs.readdirSync(root).filter(n => /^\d{12}\.json$/.test(n)).sort();
  let previous = null; const records = [];
  for (const [i, name] of names.entries()) {
    const p = path.join(root, name); regular(p); const record = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Number(name.slice(0, 12)) !== i || record.previous !== previous || record.file !== path.basename(file) || !['intent','commit','replayed'].includes(record.phase) || !/^[a-f0-9]{64}$/.test(record.after) || (record.before !== null && !/^[a-f0-9]{64}$/.test(record.before))) refuse('invalid or discontinuous write journal');
    if ((i % 2 === 0 && record.phase !== 'intent') || (i % 2 === 1 && (record.phase === 'intent' || record.after !== records[i - 1].after || record.before !== records[i - 1].before))) refuse('invalid write journal transition');
    if (i % 2 === 0 && i > 0 && record.before !== records[i - 1].after) refuse('journal preimage is not previous committed generation');
    for (const hash of [record.before, record.after].filter(Boolean)) {
      if (hashFile(path.join(root, `${hash}.blob`)).sha256 !== hash) refuse('recovery generation corrupt or missing');
    }
    previous = digest(fs.readFileSync(p)); records.push(record);
  }
  return records;
}
function assertFileRestart(file) {
  const records = readJournal(file); if (!records.length) return { tracked:false };
  if (records.length % 2) refuse('interrupted transaction requires exact-hash replay; restart inhibited');
  if (!fs.existsSync(file) || hashFile(file).sha256 !== records.at(-1).after) refuse('integrity check failed: committed state missing or changed; restart inhibited');
  return { tracked:true, generations:records.length / 2, sha256:records.at(-1).after };
}
function appendRecord(root, records, record) {
  const previous = records.length ? digest(fs.readFileSync(path.join(root, `${String(records.length - 1).padStart(12, '0')}.json`))) : null;
  immutable(path.join(root, `${String(records.length).padStart(12, '0')}.json`), Buffer.from(json({ ...record, previous }) + '\n'));
}
function preservedReplace(file, bytes, publish, fault = () => {}, { expectedMissing = false } = {}) {
  const held = acquireDurableLock(`${file}.recovery.lock`, { description:'Recovery journal writer lock' });
  try {
  assertFileRestart(file);
  if (expectedMissing && fs.existsSync(file)) refuse('initialization target already exists; retain existing generation');
  const root = ensureHistory(file); const records = readJournal(file);
  if (fs.existsSync(file)) regular(file);
  const beforeBytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const before = beforeBytes === null ? null : digest(beforeBytes); const after = digest(bytes);
  if (beforeBytes !== null) immutable(path.join(root, `${before}.blob`), beforeBytes);
  immutable(path.join(root, `${after}.blob`), Buffer.from(bytes));
  const record = { file:path.basename(file), before, after, phase:'intent' };
  appendRecord(root, records, record); fault('intent-durable');
  if ((fs.existsSync(file) ? hashFile(file).sha256 : null) !== before) refuse('target changed after durable intent');
  publish(); syncDirectory(path.dirname(file)); fault('target-durable');
  if (hashFile(file).sha256 !== after) refuse('published state differs from durable intent');
  appendRecord(root, [...records, record], { ...record, phase:'commit' }); fault('commit-durable');
  return { before, after };
  } finally { held.release(); }
}
function replayFile(file, expectedAfter) {
  const held = acquireDurableLock(`${file}.recovery.lock`, { description:'Recovery exact-transaction replay lock' });
  try {
  const records = readJournal(file);
  if (!records.length || records.at(-1).after !== expectedAfter) refuse('replay requires exact intended generation');
  if (records.length % 2 === 0) return assertFileRestart(file);
  const intent = records.at(-1); const current = fs.existsSync(file) ? hashFile(file).sha256 : null;
  // Never roll back a committed candidate batch or overwrite unknown bytes. Replay
  // only finishes the exact recorded operation; an older snapshot is not permission.
  if (current !== intent.before && current !== intent.after) refuse('unknown target generation; preserve for reconciliation');
  if (current !== intent.after) {
    const temp = `${file}.${crypto.randomUUID()}.replay`;
    immutable(temp, fs.readFileSync(path.join(historyRoot(file), `${intent.after}.blob`)));
    fs.renameSync(temp, file); syncDirectory(path.dirname(file));
  }
  appendRecord(historyRoot(file), records, { ...intent, phase:'replayed' });
  return assertFileRestart(file);
  } finally { held.release(); }
}

// Complete named populations, not a source-file sample. Locks are supplied by the
// existing architecture and remain held across capture, copy and second inventory.
function checkpoint({ populations, vault, projectId, revision, acquireLocks, fault = () => {} }) {
  if (!projectId || !/^[a-f0-9]{40}$/.test(revision || '') || typeof acquireLocks !== 'function' || !Array.isArray(populations) || !populations.length) refuse('checkpoint requires project, exact revision, populations and native locks');
  const destination = realDirectory(vault); const roots = populations.map(p => realDirectory(p.root));
  for (const root of roots) if (root === destination || destination.startsWith(root + path.sep) || root.startsWith(destination + path.sep)) refuse('vault must be outside every preserved population');
  if (new Set(populations.map(p => p.name)).size !== populations.length || populations.some(p => !/^[a-z][a-z0-9-]*$/.test(p.name))) refuse('unique population names required');
  const held = acquireLocks();
  if (!held || typeof held.release !== 'function' || !Array.isArray(held.lockFiles)) refuse('native lock receipt is missing');
  try {
    const before = populations.map(p => ({ name:p.name, inventory:inventory(p.root, held.lockFiles) }));
    // A consistent checkpoint may not bless an unresolved file transaction. The
    // journal's first entry binds back to its exact target; missing stores remain
    // missing instead of being certified as a smaller, apparently valid population.
    for (let i = 0; i < before.length; i++) for (const e of before[i].inventory.entries) {
      const match = /^(.*?)(?:^|\/)\.crucible-recovery\/([a-f0-9]{64})\/000000000000\.json$/.exec(e.path);
      if (!match) continue;
      const first = JSON.parse(fs.readFileSync(safePath(roots[i], e.path), 'utf8'));
      if (typeof first.file !== 'string' || path.basename(first.file) !== first.file || digest(first.file) !== match[2]) refuse('journal target binding mismatch');
      const parent = path.resolve(roots[i], match[1] || '.');
      assertFileRestart(path.join(parent, first.file));
    }
    const manifest = { schemaVersion:1, projectId, revision, populations:before };
    const bytes = Buffer.from(json(manifest) + '\n'); const id = digest(bytes);
    const objects = path.join(destination, 'objects'); if (!fs.existsSync(objects)) { fs.mkdirSync(objects, { mode:0o700 }); syncDirectory(destination); }
    realDirectory(objects);
    for (let i = 0; i < before.length; i++) for (const entry of before[i].inventory.entries) if (entry.type === 'file') {
      const source = safePath(roots[i], entry.path);
      // Verify the copied bytes too; a stable pre-inventory alone is not a snapshot.
      immutableCopy(source, path.join(objects, `${entry.sha256}.blob`), entry);
    }
    fault('objects-durable');
    for (let i = 0; i < before.length; i++) if (!compare(before[i].inventory, inventory(roots[i], held.lockFiles)).ok) refuse('population changed during checkpoint');
    immutable(path.join(destination, `${id}.manifest.json`), bytes); fault('manifest-durable');
    return { id, manifest, independentStorageVerified:false, restartAuthorized:false };
  } finally { held.release(); }
}
function loadCheckpoint(vault, id, projectId) {
  realDirectory(vault); if (!/^[a-f0-9]{64}$/.test(id || '')) refuse('invalid checkpoint digest');
  const file = path.join(vault, `${id}.manifest.json`); regular(file); const bytes = fs.readFileSync(file);
  if (digest(bytes) !== id) refuse('checkpoint manifest hash mismatch');
  const m = JSON.parse(bytes);
  if (m.schemaVersion !== 1 || m.projectId !== projectId || !Array.isArray(m.populations) || !m.populations.length) refuse('checkpoint identity mismatch');
  if (new Set(m.populations.map(p => p.name)).size !== m.populations.length) refuse('duplicate population names');
  for (const p of m.populations) {
    if (!/^[a-z][a-z0-9-]*$/.test(p.name) || !p.inventory || digest(json(p.inventory.entries)) !== p.inventory.digest) refuse('population manifest mismatch');
    const seen = new Set();
    for (const e of p.inventory.entries) {
      safePath(vault, e.path); if (seen.has(e.path)) refuse('duplicate manifest path'); seen.add(e.path);
      if (!['directory','file'].includes(e.type)) refuse('unsupported manifest type');
      if (e.type === 'file') {
        if (!/^[a-f0-9]{64}$/.test(e.sha256) || !Number.isSafeInteger(e.size) || e.size < 0) refuse('invalid manifest file');
        const object = hashFile(path.join(vault, 'objects', `${e.sha256}.blob`));
        if (object.sha256 !== e.sha256 || object.size !== e.size) refuse('checkpoint object corrupt');
      }
    }
  }
  return m;
}
function restore({ vault, id, projectId, target, fault = () => {} }) {
  const manifest = loadCheckpoint(vault, id, projectId);
  const base = realDirectory(target);
  const vaultRoot = realDirectory(vault);
  if (base === vaultRoot || base.startsWith(vaultRoot + path.sep) || vaultRoot.startsWith(base + path.sep)) refuse('restore must be isolated from vault');
  const marker = path.join(base, '.restore-binding.json');
  if (!fs.existsSync(marker) && fs.readdirSync(base).length) refuse('restore target must be empty or bound to this exact replay');
  immutable(marker, Buffer.from(json({ id, projectId }) + '\n'));
  for (const p of manifest.populations) {
    const root = path.join(base, p.name); if (!fs.existsSync(root)) fs.mkdirSync(root, { mode:0o700 }); realDirectory(root);
    for (const e of p.inventory.entries) {
      const destination = safePath(root, e.path);
      if (e.type === 'directory') { if (!fs.existsSync(destination)) fs.mkdirSync(destination, { mode:0o700 }); realDirectory(destination); }
      else immutableCopy(path.join(vault, 'objects', `${e.sha256}.blob`), destination, e);
      fault('restored-entry');
    }
    // Persist every recreated directory entry, including empty nested trees.
    // Flush children first so the completion marker cannot outrun their parents.
    for (const e of [...p.inventory.entries].reverse()) if (e.type === 'directory') syncDirectory(safePath(root, e.path));
    syncDirectory(root);
    if (!compare(p.inventory, inventory(root)).ok) refuse('restored population hash/count/path mismatch');
  }
  const result = { schemaVersion:1, id, projectId, populationDigests:manifest.populations.map(p => ({ name:p.name, digest:p.inventory.digest })), restored:true, independentStorageVerified:false, restartAuthorized:false };
  const allowed = new Set(['.restore-binding.json','.restore-complete.json',...manifest.populations.map(p => p.name)]);
  if (fs.readdirSync(base).some(name => !allowed.has(name))) refuse('unknown material at restore root; preserve for reconciliation');
  immutable(path.join(base, '.restore-complete.json'), Buffer.from(json(result) + '\n'));
  syncDirectory(base); return result;
}
function authorizeRestart({ receipt, publicKey, id, projectId, revision, workerIdentity, now = Date.now() }) {
  // Receipt creation is deliberately absent. The worker cannot sign its own review.
  if (!receipt || !receipt.statement || typeof receipt.signature !== 'string' || !publicKey) refuse('independent signed recovery receipt required');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.from(json(receipt.statement)), key, Buffer.from(receipt.signature, 'base64'))) refuse('recovery receipt signature invalid');
  const s = receipt.statement;
  if (s.id !== id || s.projectId !== projectId || s.revision !== revision || !workerIdentity || s.workerIdentity !== workerIdentity || !s.verifierIdentity || !s.backupIdentity || new Set([workerIdentity, s.verifierIdentity, s.backupIdentity]).size !== 3 || s.restoreVerified !== true || s.retentionLocked !== true || s.workerDeleteDenied !== true || s.populationVerified !== true || !Number.isFinite(Date.parse(s.verifiedAt)) || Date.parse(s.verifiedAt) > now || !Number.isFinite(Date.parse(s.expiresAt)) || Date.parse(s.expiresAt) <= now || !Number.isFinite(Date.parse(s.retentionUntil)) || Date.parse(s.retentionUntil) < Date.parse(s.expiresAt)) refuse('recovery receipt does not authorize exact protected state');
  return { restartAuthorized:true, id, projectId, revision, promotionAuthorized:false };
}
module.exports = { inventory, compare, hashFile, syncDirectory, preservedReplace, assertFileRestart, replayFile, readJournal, historyRoot, checkpoint, loadCheckpoint, restore, authorizeRestart, assertNormalActivityAllowed };
