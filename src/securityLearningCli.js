'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { queueSecurityTechniques } = require('./securityLearning');

function run(argv = process.argv.slice(2), env = process.env) {
  if (argv[0] !== 'queue') throw new Error('Usage: securityLearningCli.js queue [techniques-json]');
  const file = path.resolve(argv[1] || path.join(__dirname, '..', 'governingDocuments', 'security-learning-techniques.json'));
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.evidenceStatus !== 'candidate-only') throw new Error('SECURITY_LEARNING_MANIFEST_NOT_CANDIDATE_ONLY');
  return queueSecurityTechniques({ learningRoot: env.CRUCIBLE_LEARNING_ROOT, projectId: env.CRUCIBLE_LEARNING_PROJECT_ID, repository: env.GITHUB_REPOSITORY || '6076446993/The-Crucible', techniques: manifest.techniques });
}

if (require.main === module) { try { console.log(JSON.stringify(run(), null, 2)); } catch (error) { console.error(`[The Crucible] Security learning failed closed: ${error.message}`); process.exitCode = 1; } }
module.exports = { run };
