'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { queueMappedPreventionCandidates } = require('./repairLearning');

function main() {
  const learningRoot = process.env.CRUCIBLE_REPAIR_LEARNING_ROOT || process.env.CRUCIBLE_LEARNING_ROOT;
  const projectId = process.env.CRUCIBLE_PROJECT_ID;
  if (!learningRoot || !projectId) throw new Error('CRUCIBLE_REPAIR_LEARNING_ROOT/CRUCIBLE_LEARNING_ROOT and CRUCIBLE_PROJECT_ID are required.');
  const file = process.env.CRUCIBLE_PREVENTION_MAPPINGS || path.join(process.cwd(), 'governingDocuments', 'prevention-candidate-mappings.json');
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.mappings)) throw new Error('prevention candidate mapping document is invalid.');
  const result = queueMappedPreventionCandidates({ learningRoot, projectId, mappings: document.mappings });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) main();
module.exports = { main };
