'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { acquireDurableLock } = require('./durableLock');
const { checkpoint, loadCheckpoint, restore, replayFile, readJournal, historyRoot, inventory, compare, authorizeRestart } = require('./recoverySystem');
const { operationalError } = require('./failureCodes');

const REQUIRED_ROLES = Object.freeze(['knowledge','research-source-logs','original-material','candidates','evidence','custody','learning-versions','extraction-progress','unfinished-work','plans']);
function fail(message) { throw operationalError('OPS-0049', `Recovery configuration refused: ${message}`); }
function configuration(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (c.repository !== '6076446993/The-Crucible' || c.branch !== 'development' || !['github:6076446993/The-Crucible','github:jonathanblunt1214-lgtm/The-Crucible'].includes(c.projectId) || !/^[a-f0-9]{40}$/.test(c.revision || '')) fail('exact development repository, project and revision required');
  if (!Array.isArray(c.populations) || !c.populations.length || !Array.isArray(c.lockFiles) || !c.lockFiles.length) fail('complete populations and all native writer locks required');
  const roles = new Set(c.populations.flatMap(p => p.roles || []));
  if (REQUIRED_ROLES.some(role => !roles.has(role))) fail('required preservation role is missing, including plans and unfinished work');
  for (const p of c.populations) if (!path.isAbsolute(p.root)) fail('population roots must be absolute');
  for (const l of c.lockFiles) if (!path.isAbsolute(l) || !c.populations.some(p => l.startsWith(path.resolve(p.root) + path.sep))) fail('native locks must be inside the exact populations');
  if (!path.isAbsolute(c.vault || '')) fail('absolute explicitly configured vault required');
  return c;
}
function locks(c) {
  const held = [];
  try {
    for (const file of [...new Set(c.lockFiles)].sort()) held.push(acquireDurableLock(file, { description:'Recovery consistent-checkpoint lock' }));
    return { lockFiles:[...c.lockFiles], release() { for (const lock of held.reverse()) lock.release(); } };
  } catch (error) { for (const lock of held.reverse()) lock.release(); throw error; }
}
function run(argv = process.argv.slice(2)) {
  const [action, configFile, id, target] = argv;
  if (action === 'replay-file') {
    if (!path.isAbsolute(configFile || '') || !/^[a-f0-9]{64}$/.test(id || '') || !['github:6076446993/The-Crucible','github:jonathanblunt1214-lgtm/The-Crucible'].includes(target)) fail('replay-file requires exact absolute target, intended SHA-256 and project identity');
    const lockFile = configFile.endsWith('.learning.json') ? `${configFile}.lock` : `${configFile}.claim-extraction.lock`;
    const held = acquireDurableLock(lockFile, { description:'Recovery exact-transaction replay lock' });
    try {
      const records = readJournal(configFile);
      if (!records.length || records.at(-1).after !== id) fail('recorded replay generation differs');
      const intended = JSON.parse(fs.readFileSync(path.join(historyRoot(configFile),id+'.blob'),'utf8'));
      if ((intended.payload?.projectId || intended.projectId) !== target) fail('replay target belongs to another project');
      return { ...replayFile(configFile, id), projectId:target };
    } finally { held.release(); }
  }
  if (!['checkpoint','verify','restore','authorize-restart'].includes(action)) fail('usage: recoverySystemCli.js checkpoint|verify|restore|authorize-restart CONFIG [CHECKPOINT_ID] [NEW_RESTORE_ROOT]');
  const c = configuration(configFile);
  if (action === 'checkpoint') return checkpoint({ ...c, acquireLocks:() => locks(c) });
  if (action === 'restore') return restore({ vault:c.vault, id, projectId:c.projectId, target });
  const held = locks(c);
  try {
    const m = loadCheckpoint(c.vault, id, c.projectId);
    if (m.revision !== c.revision || m.populations.length !== c.populations.length) fail('checkpoint revision or population count differs');
    for (const p of m.populations) {
      const current = c.populations.find(x => x.name === p.name);
      if (!current || !compare(p.inventory, inventory(current.root, held.lockFiles)).ok) fail('population differs; no restart authorized');
    }
    if (action === 'verify') return { verified:true, id, restartAuthorized:false };
    if (!c.receiptFile || !c.verifierPublicKeyFile || !c.workerIdentity) fail('separately provisioned verifier key, receipt and worker identity required');
    return authorizeRestart({ receipt:JSON.parse(fs.readFileSync(c.receiptFile, 'utf8')), publicKey:fs.readFileSync(c.verifierPublicKeyFile), id, projectId:c.projectId, revision:c.revision, workerIdentity:c.workerIdentity });
  } finally { held.release(); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(run(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { REQUIRED_ROLES, configuration, locks, run };
