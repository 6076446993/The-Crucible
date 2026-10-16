'use strict';
// Read-only candidate subject suggestions; all source records and history remain untouched.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const SUBJECTS = [
  ['S01','Scientific learning, epistemology and R-gates',/\b(?:epistemolog\w*|falsifi\w*|scientific method|experimental design|reproducib\w*|causal inference)\b/i],
  ['S02','Memory, retrieval and cross-concept reasoning',/\b(?:memory|retriev\w*|rag|embedding\w*|vector search|semantic search|knowledge graph)\b/i],
  ['S03','Research ingestion, discovery and provenance',/\b(?:research|literature review|scholarly|citation\w*|provenance|ingest\w*|source discovery|pdf extraction)\b/i],
  ['S04','Security, isolation and adversarial robustness',/\b(?:prompt injection|malware|vulnerabilit\w*|sandbox\w*|isolat\w*|adversarial|threat model\w*|security|owasp|csrf|xss)\b/i],
  ['S05','Cryptography, custody and credential recovery',/\b(?:encrypt\w*|decrypt\w*|cryptograph\w*|custody|credential\w*|key recovery|key escrow|key rotation|aes.256|hkdf)\b/i],
  ['S06','Governance, accountability and human oversight',/\b(?:governance|accountab\w*|oversight|policy enforcement|ethical review|audit trail|human approval)\b/i],
  ['S07','Diagnostics, telemetry and causal analysis',/\b(?:diagnos\w*|telemetry|observab\w*|root cause|distributed trac\w*|incident analysis|monitoring)\b/i],
  ['S08','Autonomous repair, recovery and resilience',/\b(?:self.heal\w*|autonomous repair|automatic repair|disaster recover\w*|failover|restor\w*|rollback|resilien\w*|fault toleran\w*)\b/i],
  ['S09','Agent orchestration and distributed workflows',/\b(?:orchestrat\w*|workflow\w*|task schedul\w*|worker lease|distributed worker|dispatch\w*|camunda|zeebe|queue consumer)\b/i],
  ['S10','Multi-agent collaboration and council cognition',/\b(?:multi.agent|agent.to.agent|agent collaborat\w*|agent council|deliberat\w*|consensus|voting threshold)\b/i],
  ['S11','Evaluation, benchmarks and software testing',/\b(?:benchmark\w*|software test\w*|unit test\w*|integration test\w*|regression test\w*|model evaluation|test suite|formal verification|fuzz\w*|tevv)\b/i],
  ['S12','Data systems, databases and SQL optimization',/\b(?:database\w*|postgres\w*|sqlite|mysql|sql|query planner|transaction\w*|data warehouse|etl|data lake|index optimiz\w*)\b/i],
  ['S13','Resource efficiency and adaptive optimization',/\b(?:performance optimiz\w*|cost optimiz\w*|token budget|latency|throughput|resource allocat\w*|compress\w*|context budget)\b/i],
  ['S14','Synthetic intelligence and cognitive architectures',/\b(?:synthetic intelligence|cognitive architecture|world model|metacogn\w*|embodied cognition|neuro.symbolic|continual learning)\b/i],
  ['S15','Software engineering and DevOps quality',/\b(?:software engineer\w*|devops|continuous integration|ci\/cd|build pipeline|compiler\w*|lint\w*|code review|code quality|programming language\w*|javascript|typescript|python|golang|rust language|c\+\+|java language|php|ruby|swift|kotlin|algorithm\w*|programming|source code|runtime|debugg\w*)\b/i],
  ['S16','NIM inference, interface and provider execution',/\b(?:nvidia|nemotron|nim|model serving|model inferenc\w*|llm inference|inference engine|provider routing|gpu inference)\b/i],
  ['S17','Nexus platform integration and operations',/\b(?:nexus platform|nexus integration|cloud run|api gateway|platform integration|cross.engine contract\w*)\b/i],
  ['S18','Smoke Stack product and mobile reliability',/\b(?:smoke stack|smoke.stack|chargpt|cook timer|brisket|meat smoker|android|mobile app|progressive web app|pwa|push notification\w*)\b/i]
];
const REFERENCE = {count:29799, idDigest:'c18f1385cde3eb0b6930d52894e7296588a7f9a840b2b07695c14e36f7ad67e5', learningDigest:'d566d80f08cd0b199e48e697080178a46b66b5d3f12563751b1aa1de03ad5c59'};
function classify(records, learningDigest, expected = REFERENCE) {
  if (!Array.isArray(records)) throw Error('Candidate array missing');
  const ids = [], members = [], primary = {}, memberships = {}, states = {};
  for (const [i,r] of records.entries()) {
    const c = r?.candidate, id = c?.id;
    if (typeof id !== 'string' || !id.length || typeof c.claim !== 'string') throw Error('Invalid candidate at position '+i);
    ids.push(id);
    const t=[c.claim,c.claimBoundary,c.generalizationBoundary,c.kind].filter(v=>typeof v==='string').join(' ');
    const matches=SUBJECTS.filter(x=>x[2].test(t)).map(x=>x[0]);
    const subject=matches.length===1?matches[0]:matches.length?'MULTI_SUBJECT':'UNASSIGNED';
    primary[subject]=(primary[subject]||0)+1;
    for (const label of matches) memberships[label]=(memberships[label]||0)+1;
    const state=typeof r.state==='string'?r.state:'unknown';
    states[state]=(states[state]||0)+1;
    members.push({originalIndex:i,originalCandidateIdSha256:digest(id),primarySubject:subject,suggestedSubjects:matches,originalState:state});
  }
  if(new Set(ids).size!==ids.length) throw Error('Duplicate original candidate identity');
  const idDigest=digest(JSON.stringify([...ids].sort()));
  if(expected && (ids.length!==expected.count || idDigest!==expected.idDigest || learningDigest!==expected.learningDigest)) {
    throw Error('Authenticated candidate population differs from the preserved recovery baseline');
  }
  if(Object.values(primary).reduce((a,b)=>a+b,0)!==ids.length) throw Error('Grouping lost a candidate');
  return {summary:{schemaVersion:1,corpus:'authenticated raw intake',learningDigest,idDigest,candidateCount:ids.length,uniqueCandidateIds:ids.length,primarySubjectCounts:primary,overlappingSubjectMembershipCounts:memberships,states,subjectNames:Object.fromEntries(SUBJECTS.map(([k,n])=>[k,n])),needsReview:(primary.UNASSIGNED||0)+(primary.MULTI_SUBJECT||0),classificationMethod:'provisional keyword-only; uncertain and multi-topic records held for review',plainClaimsExported:false,originalCandidatesMutated:false,deduplicated:false,promoted:false},members};
}
function run(root, out) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const file=path.resolve(root,manifest.learningFile);
  if(path.dirname(file)!==path.resolve(root)) throw Error('Unsafe learning-file path');
  const bytes=fs.readFileSync(file),sha=digest(bytes);
  if(sha!==manifest.learningSha256) throw Error('Learning-store hash differs from authenticated manifest');
  const {summary,members}=classify(JSON.parse(bytes.toString('utf8'))?.payload?.candidateRecords,sha);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'subject-groups.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(out,'subject-index.json'),JSON.stringify({schemaVersion:1,identityDigest:summary.idDigest,entries:members})+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({candidateCount:summary.candidateCount,subjectBuckets:Object.keys(summary.primarySubjectCounts).length,needsReview:summary.needsReview,summarySha256:digest(fs.readFileSync(path.join(out,'subject-groups.json')))}));
}
if(require.main===module) {
  if(process.argv[2]==='--self-test'){
    const fixtures=[{candidate:{id:'a',claim:'JavaScript programming'},state:'candidate'},{candidate:{id:'b',claim:'No topical content'},state:'candidate'}];
    const {summary}=classify(fixtures,null,null);
    if(summary.candidateCount!==2||summary.primarySubjectCounts.S15!==1||summary.primarySubjectCounts.UNASSIGNED!==1) throw Error('Subject classifier fixture failed');
    console.log('subject classifier self-test PASS');
  } else if(process.argv.length===4) run(process.argv[2],process.argv[3]);
  else throw Error('Usage: node scripts/custodySubjectGrouping.js ROOT OUTPUT or --self-test');
}
module.exports={classify,SUBJECTS};
