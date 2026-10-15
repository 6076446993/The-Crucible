'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run, configuration } = require('./recoverySystemCli');
const { preservedReplace, assertFileRestart } = require('./recoverySystem');
const { operationalError } = require('./failureCodes');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The orchestrator chooses an approved operation ID, never paths or shell commands
// supplied by research/candidates. Provisioning this registry does not grant review,
// signing, main promotion, queue reset or deletion capabilities.
class RecoveryController {
  constructor({ projectId, operations, ledgerFile }) {
    if (!projectId || !Array.isArray(operations) || !path.isAbsolute(ledgerFile || '')) throw operationalError('OPS-0049', 'Recovery controller requires project-bound operations and durable diagnostic custody.');
    if (operations.some(o => !o.id || o.projectId !== projectId || !Array.isArray(o.argv) || !['checkpoint','verify','restore','authorize-restart','replay-file'].includes(o.argv[0])) || new Set(operations.map(o => o.id)).size !== operations.length) throw operationalError('OPS-0049', 'Invalid or cross-project recovery operation registry.');
    this.projectId = projectId; this.operations = structuredClone(operations); this.file = ledgerFile;
    assertFileRestart(this.file);
  }
  async recover(request) {
    if (!request || request.projectId !== this.projectId || typeof request.operationId !== 'string' || Object.keys(request).some(k => !['projectId','operationId'].includes(k))) throw operationalError('OPS-0049', 'Recovery request must name only a same-project approved operation.');
    const operation = this.operations.find(o => o.id === request.operationId);
    if (!operation) throw operationalError('OPS-0049', 'Recovery operation is not registered.');
    let outcome;
    try {
      if (operation.argv[0] === 'replay-file') {
        if (operation.argv[3] !== this.projectId) throw operationalError('OPS-0049','Recovery replay project binding differs.');
      } else if (configuration(operation.argv[1]).projectId !== this.projectId) {
        throw operationalError('OPS-0049','Recovery configuration project binding differs.');
      }
      const result = run(operation.argv);
      outcome = { operationId:operation.id, operationSha256:digest(operation), state:'completed', result, restartAuthorized:result.restartAuthorized === true, proofStageSatisfied:false, promotionAuthorized:false };
    } catch (error) {
      // The error itself can carry private source paths. Persist a bounded operational
      // diagnosis plus operation identity; original private custody holds the detail.
      outcome = { operationId:operation.id, operationSha256:digest(operation), state:'held', operationalCode:error.operationalCode || 'OPS-0049', nextAction:'retry-approved-recovery-after-missing-evidence-or-dependency-is-restored', restartAuthorized:false, proofStageSatisfied:false, promotionAuthorized:false };
    }
    assertFileRestart(this.file);
    const previous = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { schemaVersion:1, projectId:this.projectId, events:[] };
    if (previous.projectId !== this.projectId || !Array.isArray(previous.events)) throw operationalError('OPS-0049', 'Recovery diagnostic ledger identity mismatch.');
    previous.events.push({ ...outcome, at:new Date().toISOString() });
    const bytes = JSON.stringify(previous, null, 2) + '\n';
    preservedReplace(this.file, bytes, () => {
      const pending = `${this.file}.${crypto.randomUUID()}.tmp`; const fd = fs.openSync(pending, 'wx', 0o600);
      try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(pending,this.file);
    });
    return outcome;
  }
}
module.exports = { RecoveryController };
