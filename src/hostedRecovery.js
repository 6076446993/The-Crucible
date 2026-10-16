'use strict';
// Recovery control plane only. Never hydrates, ingests, restages or starts a worker.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { RecoveryController } = require('./recoveryController');
const { inventory, compare } = require('./recoverySystem');
const { joinEncrypted, decrypt, verifyRestored, sha256File } = require('./hostedSourceBundle');
const { decryptWeeklyEnvelope, sha } = require('./scientificLearning');
const { learningBinding, STATE_CONTEXT } = require('./hostedLearningProof');
const { operationalError } = require('./failureCodes');
const REPOSITORY = '6076446993/The-Crucible', REF = 'refs/heads/development';
const ROLES = ['knowledge','research-source-logs','original-material','candidates','evidence','custody','learning-versions','extraction-progress','unfinished-work','plans'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw operationalError('OPS-0049', `Hosted recovery refused: ${message}`); };
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding:'utf8', shell:false, windowsHide:true, timeout:120000, maxBuffer:1024*1024, ...options });
  if (result.error || result.status !== 0) fail('bounded recovery subprocess failed; private detail withheld');
  return result.stdout.trim();
}
function extract(archive, target, kind) {
  execute(process.env.CRUCIBLE_RECOVERY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(__dirname,'..','scripts','recoveryArchive.py'),archive,target,kind]);
}
function recoveryCrypto(action,input,output,repository,ref) {
  const keys=['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_VETTED_BUNDLE_KEY'].map(n=>Buffer.from(process.env[n]||'','base64'));
  if(keys.some(k=>k.length!==32)||keys[0].equals(keys[1]))fail('two distinct existing custody key families required');
  const derived=Buffer.from(crypto.hkdfSync('sha256',Buffer.concat(keys),Buffer.from('CrucibleRecovery/v1'),Buffer.from(`${repository}:${ref}:dual-custody`),32)).toString('base64');
  const args=[path.join(__dirname,'hostedSourceBundle.js'),action,'--input',input,'--output',output,'--repository',repository,'--ref',ref];
  if(action==='encrypt')args.push('--project-id',`github:${repository}`);else args.push('--keys','CRUCIBLE_SOURCE_BUNDLE_KEY');
  // A child-only environment avoids changing either original key or process-global state.
  return JSON.parse(execute(process.execPath,args,{timeout:600000,env:{...process.env,CRUCIBLE_SOURCE_BUNDLE_KEY:derived}}));
}
function semanticState(payload) {
  if (!payload || !Array.isArray(payload.candidateRecords) || !Array.isArray(payload.knowledgeVersions)) fail('learning population schema unavailable');
  const ids = payload.candidateRecords.map(x => x.candidate?.id);
  if (ids.some(x => typeof x !== 'string') || new Set(ids).size !== ids.length) fail('candidate identity missing or duplicated');
  return { projectId:payload.projectId, revision:payload.revision, candidates:ids.length, candidateIdentityDigest:digest([...ids].sort()), candidateAndEvidenceDigest:digest(payload.candidateRecords), learningVersions:payload.knowledgeVersions.length, learningVersionDigest:digest(payload.knowledgeVersions), completePayloadDigest:digest(payload) };
}
function corpusState(root, provenance) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  if (path.basename(manifest.learningFile || '') !== manifest.learningFile) fail('unsafe learning-store member');
  if(!Array.isArray(manifest.sourceFiles)||manifest.sourceFiles.some(s=>typeof s.name!=='string'||path.basename(s.name)!==s.name||s.name.includes('..')||s.name.includes('\\')||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||s.bytes<0))fail('invalid original-source manifest');
  const queue = JSON.parse(fs.readFileSync(path.join(root,'source-queue.json')));
  const envelope = JSON.parse(fs.readFileSync(path.join(root,manifest.learningFile)));
  if (envelope.payloadSha256 !== sha(envelope.payload)) fail('learning envelope integrity mismatch');
  if (envelope.payload.projectId !== manifest.projectId || queue.projectId !== manifest.projectId) fail('corpus identity mismatch');
  const ids = [...queue.documents,...queue.links].map(x => x.id);
  if (ids.some(x => typeof x !== 'string') || new Set(ids).size !== ids.length) fail('source identity missing or duplicated');
  const diagnostic=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-recovery-read-'));
  try { verifyRestored({root,repository:REPOSITORY,ref:REF,reportFile:path.join(diagnostic,'verified.json'),provenance}); }
  finally { fs.rmSync(diagnostic,{recursive:true,force:true}); }
  for(const source of manifest.sourceFiles)if(fs.statSync(path.join(root,'sources',source.name)).size!==source.bytes)fail('original source byte count differs');
  return { provenance, sources:ids.length, sourceIdentityDigest:digest([...ids].sort()), sourceAndExtractionProgressDigest:digest(queue), originalSourceDigest:digest(manifest.sourceFiles), originalSourceFiles:manifest.sourceFiles.length, learning:semanticState(envelope.payload) };
}
function validateDownloadedBackup(root) {
  const entries=inventory(root).entries;
  if(entries.length!==2||entries.some(e=>e.type!=='file'||!['recovery-custody.enc','recovery-report.json'].includes(e.path)))fail('downloaded backup members differ');
}
function retainedState(root, env = process.env) {
  const envelope = JSON.parse(fs.readFileSync(path.join(root,'store.envelope.json')));
  const binding = learningBinding(REPOSITORY,REF), key = Buffer.from(env.CRUCIBLE_HOSTED_STORE_KEY || '', 'base64');
  if (key.length < 32) fail('existing hosted-state recovery key unavailable');
  const open = b => decryptWeeklyEnvelope(envelope,{masterKey:key,expectedProjectId:b.projectId,expectedRepository:b.repository,expectedWeek:STATE_CONTEXT,expectedOidcSubject:b.subject});
  let transport;
  try { transport = open(binding); } catch(error) {
    if (!binding.migratedFrom || error.message !== 'Weekly envelope binding mismatch.') throw error;
    transport = open(binding.migratedFrom);
  }
  const payload = transport.candidateEvidence?.[0]?.durableState;
  if (payload?.projectId !== binding.projectId) fail('retained learning identity differs');
  return semanticState(payload);
}
function copyTree(source, target) {
  // Inventory refuses links and special files before copying; source roots are snapshots.
  inventory(source); fs.cpSync(source,target,{recursive:true,errorOnExist:true,force:false});
}
async function capture({ root, repository, ref, revision, coreRoot, rawRoot, vettedRoot, retainedRoot, researchRoots = [], reportFile }) {
  if (repository !== REPOSITORY || ref !== REF || !/^[a-f0-9]{40}$/.test(revision || '')) fail('exact development identity required');
  if(execute('git',['-C',coreRoot,'rev-parse','HEAD'])!==revision)fail('checked-out development revision differs');
  if (!path.isAbsolute(root) || fs.existsSync(root)) fail('fresh absolute recovery workspace required');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const population = path.join(root,'population'), vault=path.join(root,'vault'), control=path.join(root,'control');
  for(const p of [population,vault,control])fs.mkdirSync(p,{mode:0o700});
  const report = {schemaVersion:2,repository,ref,revision,startedAt:new Date().toISOString(),state:'held',sourceCapture:'immutable Git revision vector; not a quorum of live writer locks',recoveryEncryption:'HKDF-SHA256 requires both existing raw and vetted key families; no generated replacement key',completeLiveInventory:false,independentStorageVerified:false,independentSecurityPrincipal:false,restartAuthorized:false,zeroKnowledgeLossVerified:false,normalActivityResumed:false};
  try {
    report.phase='immutable-repository-snapshots';
    report.custodyHistoryCoverage='current committed trees and exact tip commit metadata; complete historical Git replication remains held';
    fs.mkdirSync(path.join(population,'ciphertext')); fs.mkdirSync(path.join(population,'history'));
    for(const [name,source] of [['raw',rawRoot],['vetted',vettedRoot]]) {
      const head=execute('git',['-C',source,'rev-parse','HEAD']);
      if(!/^[a-f0-9]{40}$/.test(head))fail('custody commit unavailable');
      report[`${name}Revision`]=head;
      // Vetted history exceeds a hosted runner's disk. Preserve exact tip bytes now;
      // never label a shallow checkout as a complete historical Git backup.
      fs.writeFileSync(path.join(population,'history',`${name}-tip.commit`),execute('git',['-C',source,'cat-file','commit',head]),{mode:0o600});
      const archive=path.join(root,`${name}-tracked.tar.gz`);
      execute('git',['-C',source,'archive','--format=tar.gz','--output',archive,'HEAD']);
      extract(archive,path.join(population,'ciphertext',name),'tar');
      fs.unlinkSync(archive);
    }
    report.phase='development-and-retained-state';
    const code=path.join(root,'code.tar.gz');
    execute('git',['-C',coreRoot,'archive','--format=tar.gz','--output',code,revision]);
    extract(code,path.join(population,'development'),'tar');fs.unlinkSync(code);
    execute('git',['-C',coreRoot,'bundle','create',path.join(population,'history','development.bundle'),'--all']);
    copyTree(retainedRoot,path.join(population,'retained'));
    const origin=path.join(population,'retained','origin.json');
    if(fs.existsSync(origin)){const value=JSON.parse(fs.readFileSync(origin));if(!/^\d+$/.test(value.runId)||!/^\d+$/.test(value.artifactId))fail('retained artifact provenance unavailable');report.retainedArtifact=value;}
    for(const [i,source]of researchRoots.entries())if(fs.existsSync(source))copyTree(source,path.join(population,`research-${i}`));
    report.researchCachesCaptured=researchRoots.filter(p=>fs.existsSync(p)).length;
    fs.mkdirSync(path.join(population,'corpus'));
    for(const [name,keys,provenance]of [['raw',['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS'],'raw-intake'],['vetted',['CRUCIBLE_VETTED_BUNDLE_KEY','CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS'],'oversight-vetted']]) {
      report.phase=`authenticate-${name}-corpus`;
      const cipher=path.join(root,`${name}.enc`), archive=path.join(root,`${name}.tar.gz`);
      joinEncrypted({inputRoot:path.join(population,'ciphertext',name),output:cipher});
      const opened=await decrypt({input:cipher,output:archive,repository,ref,keyNames:keys});
      if(opened.provenance!==provenance)fail('decrypted custody provenance differs');
      report.authentication ||= {};report.authentication[name]={decryptedWith:opened.decryptedWith,plaintextSha256:opened.plaintextSha256,plaintextBytes:opened.plaintextBytes,provenance:opened.provenance};
      extract(archive,path.join(population,'corpus',name),'tar');
      fs.unlinkSync(cipher);fs.unlinkSync(archive);
    }
    report.phase='semantic-population-inventory';
    const before={raw:corpusState(path.join(population,'corpus','raw'),'raw-intake'),vetted:corpusState(path.join(population,'corpus','vetted'),'oversight-vetted'),retained:retainedState(path.join(population,'retained'))};
    const projectId=before.raw.learning.projectId;
    const config={repository,branch:'development',projectId,revision,populations:[{name:'captured-custody',root:population,roles:ROLES}],lockFiles:[path.join(population,'recovery-snapshot.lock')],vault};
    const configFile=path.join(control,'config.json');fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
    const operation={id:'capture-current-custody',projectId,argv:['checkpoint',configFile]};
    const controller=new RecoveryController({projectId,operations:[operation],ledgerFile:path.join(control,'diagnostics.json')});
    const captured=await controller.recover({projectId,operationId:operation.id});
    if(captured.state!=='completed')fail('checkpoint remains held');
    report.checkpointId=captured.result.id;
    report.phase='fresh-process-restoration';
    // Separate process restores into an empty target. The source remains intact.
    const target=path.join(root,'restored');fs.mkdirSync(target,{mode:0o700});
    execute(process.execPath,[path.join(__dirname,'recoverySystemCli.js'),'restore',configFile,report.checkpointId,target],{timeout:600000});
    const restored=path.join(target,'captured-custody');
    const after={raw:corpusState(path.join(restored,'corpus','raw'),'raw-intake'),vetted:corpusState(path.join(restored,'corpus','vetted'),'oversight-vetted'),retained:retainedState(path.join(restored,'retained'))};
    if(JSON.stringify(before)!==JSON.stringify(after))fail('candidate, source, version or provenance reconciliation differs');
    // Verification reports are generated outside the original corpus members.
    const pre=inventory(population),post=inventory(restored);
    if(!compare(pre,post).ok)fail('complete population byte/count verification differs');
    report.state='captured-and-isolated-restore-verified';report.populations=before;
    report.phase='captured';
    report.preDigest=pre.digest;report.postDigest=post.digest;
    report.files=pre.entries.filter(x=>x.type==='file').length;
    report.bytes=pre.entries.reduce((n,x)=>n+(x.size||0),0);
    report.remaining=['complete-custody-git-history-replication-to-capacity-appropriate-independent-storage','independent-retention-locked-storage-and-recovery-key-custody','distinct-principal-live-restore-and-signed-receipt','complete-operator-and-cache-history-root-inventory','deployed-bootstrap-binding'];
    fs.rmSync(target,{recursive:true});
    return report;
  } finally {
    report.finishedAt=new Date().toISOString();
    fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  }
}
async function seal({root,output,repository,ref,reportFile=path.resolve('recovery-report.json')}) {
  if(repository!==REPOSITORY||ref!==REF)fail('recovery encryption identity differs');
  const archive=`${output}.plaintext.tar.gz`;
  const complete=fs.readdirSync(path.join(root,'vault')).some(n=>/^[a-f0-9]{64}\.manifest\.json$/.test(n));
  if(fs.existsSync(reportFile))fs.copyFileSync(reportFile,path.join(root,'control','capture-report.json'),fs.constants.COPYFILE_EXCL);
  execute('tar',['-czf',archive,'-C',root,...(complete?['vault','control']:['population','vault','control'])],{timeout:600000});
  try { return recoveryCrypto('encrypt',archive,output,repository,ref); }
  finally { fs.rmSync(archive,{force:true}); }
}
async function restoreBackup({input,root,repository,ref,revision,reportFile}) {
  if(repository!==REPOSITORY||ref!==REF||!/^[a-f0-9]{40}$/.test(revision||'')||fs.existsSync(root))fail('fresh exact-development restore required');
  const archive=`${root}.tar.gz`;
  try {
    recoveryCrypto('decrypt',input,archive,repository,ref);
    extract(archive,root,'tar');
    const captured=JSON.parse(fs.readFileSync(path.join(root,'control','capture-report.json')));
    if(captured.schemaVersion!==2||captured.revision!==revision||captured.repository!==repository||captured.ref!==ref||captured.state!=='captured-and-isolated-restore-verified')fail('backup source capture incomplete or differs');
    const configFile=path.join(root,'control','config.json'),config=JSON.parse(fs.readFileSync(configFile));
    if(config.revision!==revision||config.repository!==repository)fail('backup configuration binding differs');
    config.vault=path.join(root,'vault');fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
    const target=path.join(root,'fresh-restore');fs.mkdirSync(target,{mode:0o700});
    execute(process.execPath,[path.join(__dirname,'recoverySystemCli.js'),'restore',configFile,captured.checkpointId,target],{timeout:600000});
    const restored=path.join(target,'captured-custody');
    const after={raw:corpusState(path.join(restored,'corpus','raw'),'raw-intake'),vetted:corpusState(path.join(restored,'corpus','vetted'),'oversight-vetted'),retained:retainedState(path.join(restored,'retained'))};
    const observed=inventory(restored);
    if(JSON.stringify(after)!==JSON.stringify(captured.populations)||observed.digest!==captured.preDigest||observed.entries.filter(x=>x.type==='file').length!==captured.files)fail('off-host restoration population differs');
    // Exact replay in a fresh process must leave the restored population unchanged.
    execute(process.execPath,[path.join(__dirname,'recoverySystemCli.js'),'restore',configFile,captured.checkpointId,target],{timeout:600000});
    if(inventory(restored).digest!==observed.digest)fail('restoration replay differs');
    const report={...captured,state:'uploaded-backup-restored-and-replayed',encryptedBackupSha256:sha256File(input),postDigest:observed.digest,separateRunnerRestoreVerified:true,independentSecurityPrincipal:false,independentStorageVerified:false,restartAuthorized:false,zeroKnowledgeLossVerified:false,finishedAt:new Date().toISOString()};
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});return report;
  } finally {fs.rmSync(archive,{force:true});}
}
async function main(argv=process.argv.slice(2)) {
  const [action]=argv, env=process.env, root=path.join(env.RUNNER_TEMP || '', 'crucible-recovery-capture');
  if(action==='capture')return capture({root,repository:env.GITHUB_REPOSITORY,ref:env.GITHUB_REF,revision:env.GITHUB_SHA,coreRoot:process.cwd(),rawRoot:path.join(env.RUNNER_TEMP,'recovery-input/raw'),vettedRoot:path.join(env.RUNNER_TEMP,'recovery-input/vetted'),retainedRoot:path.join(env.RUNNER_TEMP,'recovery-retained'),researchRoots:['.hosted-pointer-research-6076446993','.hosted-perplexity-research'].map(p=>path.resolve(p)),reportFile:path.resolve('recovery-report.json')});
  if(action==='seal')return seal({root,output:path.resolve('recovery-custody.enc'),repository:env.GITHUB_REPOSITORY,ref:env.GITHUB_REF});
  if(action==='restore-backup'){validateDownloadedBackup(path.join(env.RUNNER_TEMP,'recovery-downloaded'));return restoreBackup({input:path.join(env.RUNNER_TEMP,'recovery-downloaded','recovery-custody.enc'),root:path.join(env.RUNNER_TEMP,'crucible-backup-restoration'),repository:env.GITHUB_REPOSITORY,ref:env.GITHUB_REF,revision:env.GITHUB_SHA,reportFile:path.resolve('recovery-restoration-report.json')});}
  fail('unsupported hosted recovery operation');
}
module.exports={validateDownloadedBackup,semanticState,corpusState,retainedState,capture,seal,restoreBackup,extract};
if(require.main===module)main().then(r=>console.log(JSON.stringify({state:r.state||'encrypted',restartAuthorized:false}))).catch(()=>{console.error('[OPS-0049] Hosted recovery held; inspect bounded report.');process.exitCode=1;});
