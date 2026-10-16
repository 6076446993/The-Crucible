const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DurableScientificLearningStore } = require('./scientificLearning');
const { acquireDurableLock, inspectLock } = require('./durableLock');
const { extractPdfTextRange } = require('./pdfTextExtraction');
const { INJECTION_PATTERNS } = require('./safeInformationRetrieval');
const { documentFurniture } = require('./documentFurniture');
const { extractDocumentText } = require('./htmlTextExtraction');
const { candidatePacket } = require('./evidencePacket');
const { preservedReplace, assertFileRestart, assertNormalActivityAllowed } = require('./recoverySystem');
const evidenceStorage = require('./evidenceStorage');
const { operationalError } = require('./failureCodes');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizedClaimSha256(value) { return sha256(cleanText(value).toLowerCase()); }
// Bounded text extraction, not HTML sanitization. This returns the prose a reader sees, so it can
// be hashed, deduplicated and turned into candidate claims; nothing downstream renders it. Where
// each element ends is decided by the tokenizer in htmlTextExtraction, because deciding it with a
// regex family was tried twice here and leaked script and style bodies into the corpus both times.
// Entities are decoded only after the markup is gone, so an encoded `&lt;script&gt;` in the text
// cannot become a tag on the way out.
function cleanText(value) {
  return extractDocumentText(String(value || '')).replace(/&(?:nbsp|#160);/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function boundedAssertions(text) {
  const candidates = cleanText(text).split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length >= 40 && item.length <= 360);
  const seen = new Set(); const results = [];
  for (const sentence of candidates) {
    if (INJECTION_PATTERNS.some((pattern) => pattern.test(sentence))) continue;
    if (!/\b(?:is|are|uses?|requires?|returns?|creates?|provides?|supports?|allows?|can|must|should)\b/i.test(sentence)) continue;
    // A verb is not enough. "You are one step away from downloading ebooks" and "Footer
    // navigation Terms Privacy Security Status Community Docs Contact" both pass the verb
    // test, and furniture like that is exactly the text that repeats across independently
    // retrieved documents - so on the real corpus it was the only thing that corroborated.
    if (documentFurniture(sentence).furniture) continue;
    const fingerprint = sha256(sentence.toLowerCase()); if (seen.has(fingerprint)) continue;
    seen.add(fingerprint); results.push(sentence);
  }
  return results;
}

// A declared path is a claim about where content lives, not permission to read there. The queue can
// arrive from a repository Crucible does not control - the hosted proof restores exactly such a one
// - and extraction is the worst place for a tampered path to land: the file is read, shelled out to
// a PDF extractor, and its sentences become candidate claims. So content must sit inside the corpus
// this worker was pointed at, and anything resolving outside it is refused rather than read.
function containedSourcePath(corpusRoot, source) {
  const declared = String(source.durablePath || '').replaceAll('\\', '/');
  if (!declared) throw new Error(`Source ${source.id} has no stored content path.`);
  const root = path.resolve(corpusRoot);
  const resolved = path.resolve(root, declared);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Source ${source.id} declares content outside the trusted corpus root ${root}: ${declared}.`);
  return resolved;
}

// Three tiers, tried in order of fidelity. The first two are unchanged: the external
// `pdftotext` binary, then a configured CRUCIBLE_PYTHON + pypdf script. Previously a
// host with neither threw, which made extraction throughput a property of one
// workstation and stalled every PDF source on any other host. The third tier extracts
// in-process with no external dependency, so extraction degrades in fidelity instead of
// stopping. Every tier's failure is preserved in the final message, because losing the
// pdftotext or pypdf diagnosis would make a real toolchain fault look like a parser
// limitation.
function defaultExtractText(source, pageStart, pageEnd, environment = process.env, spawn = spawnSync) {
  if (!source.durablePath || !fs.existsSync(source.durablePath)) throw new Error('Durable source content is missing.');
  if (source.mediaType === 'application/pdf') {
    const attempts = [];
    const timeout = Number(environment.CRUCIBLE_PDF_TIMEOUT_MS ?? 60000);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('PDF extraction timeout must be a whole number from 1 through 120000 milliseconds.');
    // A deadline uses a hard termination signal: spawnSync can otherwise wait forever
    // for a child that ignores SIGTERM. Never learn from a timed-out partial window
    // or silently substitute a lower-fidelity parser for a slow but valid document.
    const processOptions = { encoding:'utf8', shell:false, windowsHide:true, maxBuffer:8 * 1024 * 1024, timeout, killSignal:'SIGKILL' };
    const requireWithinDeadline = (result, tier) => {
      if (result.error?.code === 'ETIMEDOUT') throw new Error(`PDF extraction timed out (${tier}) after ${timeout}ms for ${source.id}; the page window remains pending. ${attempts.join(' | ')}`);
    };
    const executable = environment.CRUCIBLE_PDFTOTEXT || 'pdftotext';
    const result = spawn(executable, ['-f', String(pageStart), '-l', String(pageEnd), '-enc', 'UTF-8', source.durablePath, '-'], processOptions);
    requireWithinDeadline(result, 'pdftotext');
    if (!result.error && result.status === 0) return result.stdout;
    attempts.push(`pdftotext: ${result.error?.message || `exited ${result.status}`}`);

    const python = environment.CRUCIBLE_PYTHON;
    if (python) {
      const fallback = spawn(python, [path.join(__dirname, '..', 'scripts', 'extractPdfText.py'), source.durablePath, String(pageStart), String(pageEnd)], processOptions);
      requireWithinDeadline(fallback, 'pypdf');
      if (!fallback.error && fallback.status === 0) return fallback.stdout;
      attempts.push(`pypdf: ${fallback.error ? fallback.error.message : `exited ${fallback.status}: ${String(fallback.stderr || '').trim()}`}`);
    } else {
      attempts.push('pypdf: CRUCIBLE_PYTHON is not configured');
    }

    try {
      return extractPdfTextRange(fs.readFileSync(source.durablePath), pageStart, pageEnd);
    } catch (error) {
      attempts.push(`in-process: ${error.message}`);
    }
    throw new Error(`PDF extraction unavailable for ${source.id}; every tier failed. ${attempts.join(' | ')}`);
  }
  return fs.readFileSync(source.durablePath, 'utf8');
}

class AtomicClaimExtractionQueue {
  constructor(file, projectId) { this.file = path.resolve(file); this.projectId = projectId; this.lockFile = `${this.file}.claim-extraction.lock`; }
  read() { assertFileRestart(this.file); const queue = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (queue?.schemaVersion !== 1 || queue.projectId !== this.projectId || !Array.isArray(queue.documents) || !Array.isArray(queue.links)) throw new Error('Source queue is invalid or belongs to another project.'); return queue; }
  write(queue, io = fs) {
    if (queue.leeRegistry) {
      evidenceStorage.validateRegistry(queue.leeRegistry);
      if(queue.projectId!==this.projectId||queue.leeRegistry.projectId!==this.projectId)throw operationalError('OPS-0049','Queue and registry project binding differs.');
    }
    const bytes = `${JSON.stringify(queue, null, 2)}\n`;
    const publish = () => {
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    let created = false;
    try {
      descriptor = io.openSync(temporary, 'wx', 0o600); created = true;
      io.writeFileSync(descriptor, bytes, 'utf8');
      // Flush the complete file before replacing the prior generation. This is not
      // a claim that the directory entry survives power loss on every filesystem.
      io.fsyncSync(descriptor);
      io.closeSync(descriptor); descriptor = undefined;
      io.renameSync(temporary, this.file);
    } finally {
      try { if (descriptor !== undefined) io.closeSync(descriptor); }
      finally { if (created) io.rmSync(temporary, { force:true }); }
    }
    };
    // Native writes preserve both generations before atomic replacement. Injected
    // filesystem tests continue to exercise the publisher's own failure behavior.
    return io === fs ? preservedReplace(this.file, bytes, publish) : publish();
  }
  lock() { return acquireDurableLock(this.lockFile, { description:'Source queue lock' }); }
  reconcileEvidence({ expectedQueueSha256, objectStore, learningStore }) {
    if (!(objectStore instanceof evidenceStorage.EncryptedEvidenceObjects) || objectStore.projectId!==this.projectId || !(learningStore instanceof DurableScientificLearningStore) || learningStore.projectId!==this.projectId) throw operationalError('OPS-0049','Native same-project stores required for complete reconciliation.');
    const held=this.lock();let learnerLock;
    try {
      learnerLock=acquireDurableLock(learningStore.lockFile,{description:'Learning reconciliation snapshot lock'});
      if(sha256(fs.readFileSync(this.file))!==expectedQueueSha256)throw operationalError('OPS-0049','Reconciliation queue generation changed.');
      const queue=this.read(),registry=queue.leeRegistry;
      evidenceStorage.validateRegistry(registry);
      if(registry.projectId!==this.projectId||registry.securityDomain!==objectStore.securityDomain)throw operationalError('OPS-0049','Reconciliation domain differs.');
      const expected=[...queue.documents,...queue.links].map(source=>({kind:'source',legacyId:source.id,contentSha256:source.contentSha256,recordSha256:evidenceStorage.digest({id:source.id,contentSha256:source.contentSha256,retrievedAt:source.retrievedAt,originalName:source.originalName||null,license:source.license||null,author:source.author||null})}));
      for(const {candidate} of learningStore.read().candidateRecords)expected.push({kind:'candidate',legacyId:candidate.id,contentSha256:candidate.provenance.contentSha256,recordSha256:evidenceStorage.digest(candidate)});
      const missing=[],verified=[];
      if(new Set(expected.map(x=>`${x.kind}:${x.legacyId}`)).size!==expected.length)throw operationalError('OPS-0049','Ambiguous native evidence identities.');
      for(const item of expected){
        const alias=registry.aliases.find(x=>x.kind===item.kind&&x.legacyId===item.legacyId);
        if(!alias){missing.push({kind:item.kind,legacyId:item.legacyId});continue;}
        const entry=registry.entries.find(x=>x.id===alias.leeId);
        if(entry.contentSha256!==item.contentSha256||!alias.recordSha256s.includes(item.recordSha256)||entry.objectRef.keyId!==objectStore.keyId)throw operationalError('OPS-0049','Native evidence record differs from retained alias.');
        objectStore.read(entry.contentSha256);
        if(sha256(fs.readFileSync(objectStore.file(entry.contentSha256)))!==entry.objectRef.ciphertextSha256)throw operationalError('OPS-0049','Restored ciphertext differs from registry.');
        verified.push({...item,leeId:entry.id});
      }
      const extra=registry.aliases.filter(x=>!expected.some(y=>y.kind===x.kind&&y.legacyId===x.legacyId)).map(x=>({kind:x.kind,legacyId:x.legacyId}));
      if(sha256(fs.readFileSync(this.file))!==expectedQueueSha256)throw operationalError('OPS-0049','Reconciliation queue changed despite held lock.');
      return{scope:'native-current-source-and-candidate-populations',expected:expected.length,verified:verified.length,missing,extra,complete:missing.length===0&&extra.length===0,identitySha256:evidenceStorage.digest(verified),independentRestorationVerified:false,cleanupAuthorized:false};
    }finally{if(learnerLock)learnerLock.release();held.release();}
  }
  registerEvidence({ expectedQueueSha256, sourceId, sourceBytes, securityDomain, catalog, subjectCodes, evidenceTypeCodes, observationId, objectStore, learningStore=null, candidateId=null }) {
    assertNormalActivityAllowed(this.projectId);
    if (!(objectStore instanceof evidenceStorage.EncryptedEvidenceObjects) || objectStore.projectId!==this.projectId || objectStore.securityDomain!==securityDomain) throw operationalError('OPS-0049','Evidence object store must bind this native queue and security domain.');
    const held=this.lock();let learnerLock;
    try {
      const assertHeld=()=>{const actual=JSON.parse(fs.readFileSync(this.lockFile,'utf8'));if(actual.token!==held.owner.token||actual.pid!==process.pid)throw operationalError('OPS-0049','Lost native evidence transaction lock.');};
      assertHeld();
      if(!/^[a-f0-9]{64}$/.test(expectedQueueSha256||'')||sha256(fs.readFileSync(this.file))!==expectedQueueSha256)throw operationalError('OPS-0049','Authoritative queue generation changed.');
      const queue=this.read(),matches=[...queue.documents,...queue.links].filter(x=>x.id===sourceId);
      if(matches.length!==1||!Buffer.isBuffer(sourceBytes)||sha256(sourceBytes)!==matches[0].contentSha256)throw operationalError('OPS-0049','Exact native source identity and verified original bytes required.');
      const source=matches[0];if(source.securityDomain&&source.securityDomain!==securityDomain)throw operationalError('OPS-0049','Source rights domain differs.');
      let kind='source',legacyId=source.id,originatedAt=source.retrievedAt;
      const sourceIdentity={id:source.id,contentSha256:source.contentSha256,retrievedAt:source.retrievedAt,originalName:source.originalName||null,license:source.license||null,author:source.author||null};
      let recordSha256=evidenceStorage.digest(sourceIdentity),identitySha256=evidenceStorage.digest({kind,contentSha256:source.contentSha256,mediaType:source.mediaType||null});
      if(candidateId!==null){
        if(!(learningStore instanceof DurableScientificLearningStore)||learningStore.projectId!==this.projectId)throw operationalError('OPS-0049','Native same-project learning store required for candidate references.');
        learnerLock=acquireDurableLock(learningStore.lockFile,{description:'Learning store evidence snapshot lock'});
        const record=learningStore.read().candidateRecords.find(x=>x.candidate.id===candidateId),candidate=record?.candidate;
        if(!candidate||candidate.provenance.contentSha256!==source.contentSha256)throw operationalError('OPS-0049','Candidate source identity differs.');
        kind='candidate';legacyId=candidate.id;originatedAt=candidate.createdAt;recordSha256=evidenceStorage.digest(candidate);
        identitySha256=evidenceStorage.digest({kind,claim:candidate.claim,claimBoundary:candidate.claimBoundary,generalizationBoundary:candidate.generalizationBoundary,evidenceKind:candidate.kind,provenance:candidate.provenance});
      }
      const registry=queue.leeRegistry||evidenceStorage.initialRegistry(this.projectId,securityDomain,catalog);
      if(registry.projectId!==this.projectId||registry.securityDomain!==securityDomain||(catalog&&evidenceStorage.canonical(registry.catalog)!==evidenceStorage.canonical(catalog)))throw operationalError('OPS-0049','Pinned registry domain or classification catalog differs.');
      const object=objectStore.put(sourceBytes);
      const result=evidenceStorage.register(registry,{projectId:this.projectId,securityDomain,kind,legacyId,originatedAt,identitySha256,contentSha256:source.contentSha256,recordSha256,subjectCodes,evidenceTypeCodes,observationId,objectRef:{contentSha256:object.contentSha256,ciphertextSha256:object.ciphertextSha256,keyId:objectStore.keyId}});
      assertHeld();
      if(sha256(fs.readFileSync(this.file))!==expectedQueueSha256)throw operationalError('OPS-0049','Queue changed despite held transaction lock.');
      if(result.changed){queue.leeRegistry=result.state;this.write(queue);}
      return{leeId:result.leeId,changed:result.changed,objectCreated:object.created,queueSha256:sha256(fs.readFileSync(this.file)),candidateOnly:true,promotionAuthorized:false};
    } finally {if(learnerLock)learnerLock.release();held.release();}
  }
}

function inspectClaimExtractionLock(queueFile, options = {}) {
  return inspectLock(`${path.resolve(queueFile)}.claim-extraction.lock`, options);
}

class ClaimExtractionWorker {
  constructor({ queueFile, projectId, learningRoot, corpusRoot = null, extractText = defaultExtractText, now = () => new Date().toISOString(), maximumSources = 25, maximumDocuments = 9, pdfPagesPerBatch = 20, sourceId = null }) {
    if (!projectId || !learningRoot) throw new Error('Repository-bound projectId and learningRoot are required.');
    if (!Number.isSafeInteger(maximumSources) || maximumSources < 1 || maximumSources > 100) throw new Error('maximumSources must be between 1 and 100.');
    if (!Number.isSafeInteger(maximumDocuments) || maximumDocuments < 1 || maximumDocuments > maximumSources) throw new Error('maximumDocuments must be between 1 and maximumSources.');
    if (!Number.isSafeInteger(pdfPagesPerBatch) || pdfPagesPerBatch < 1 || pdfPagesPerBatch > 100) throw new Error('pdfPagesPerBatch must be between 1 and 100.');
    // The trusted corpus root: the directory the queue itself lives in unless the caller names a
    // different one. Every source path is resolved against it and may not leave it.
    this.corpusRoot = path.resolve(corpusRoot || path.dirname(path.resolve(queueFile)));
    this.queue = new AtomicClaimExtractionQueue(queueFile, projectId); this.store = new DurableScientificLearningStore({ projectId, root:path.resolve(learningRoot) }); this.projectId = projectId; this.extractText = extractText; this.now = now; this.maximumSources = maximumSources; this.maximumDocuments = maximumDocuments; this.pdfPagesPerBatch = pdfPagesPerBatch; this.sourceId = sourceId ? String(sourceId).trim() : null;
  }

  candidate(source, assertion, boundary, createdAt) {
    const assertionSha = normalizedClaimSha256(assertion);
    return { schemaVersion:1, id:`extracted-${sha256(`${source.id}\n${assertionSha}`).slice(0, 32)}`, projectId:this.projectId, claim:assertion, claimBoundary:boundary, generalizationBoundary:'Untrusted source assertion only; no correctness, causation, current-version applicability, recommendation, or generalization is verified by extraction.', kind:'extracted-source-assertion', provenance:{ sourceType:source.mediaType || source.contentType || 'retrieved-web-document', sourceId:source.id, retrievedAt:source.retrievedAt || createdAt, author:source.author || source.publisher || 'not declared', license:source.license || 'not declared; verify source terms before redistribution', contentSha256:source.contentSha256 }, evidencePacket:candidatePacket({ id:`extracted-evidence-${sha256(`${source.id}\n${assertionSha}`).slice(0, 32)}`, projectId:this.projectId, component:'claim-extraction', claim:assertion, boundary, provenance:{ sourceIds:[source.id], contentSha256:source.contentSha256 }, observability:{ traceId:`extract-${sha256(source.id).slice(0, 24)}` }, createdAt }), classification:'Insufficient Evidence', createdAt };
  }

  run() {
    assertNormalActivityAllowed(this.projectId);
    const held = this.queue.lock(); const unlock = held.release; const outcomes = [];
    // A reclaimed queue lock means the previous run was forcibly interrupted. That is
    // recovery, not routine, so it is reported rather than silently absorbed.
    this.lastLockReclamation = held.reclaimedFrom;
    try {
      let queue = this.queue.read();
      const isEligible = (item) => item.state === 'claim-extraction-forced-pending' || item.state === 'claim-extraction-in-progress';
      const inScope = (item) => (!this.sourceId || item.id === this.sourceId) && isEligible(item);
      const eligibleDocuments = queue.documents.filter(inScope).slice(0, this.maximumDocuments);
      const eligibleLinks = queue.links.filter(inScope).slice(0, Math.max(0, this.maximumSources - eligibleDocuments.length));
      const eligible = [...eligibleDocuments, ...eligibleLinks];
      for (const selected of eligible) {
        const collection = queue.documents.some((item) => item.id === selected.id) ? queue.documents : queue.links;
        let source = collection.find((item) => item.id === selected.id); const startedAt = this.now();
        source.claimExtraction = source.claimExtraction || { attempts:0, candidateIds:[], classification:'Insufficient Evidence' };
        const currentContentSha = String(source.contentSha256 || '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(currentContentSha)) throw new Error('Source contentSha256 must be a SHA-256 digest.');
        if (source.claimExtraction.sourceContentSha256 && source.claimExtraction.sourceContentSha256 !== currentContentSha) {
          source.claimExtraction.previousRevisions = [...(source.claimExtraction.previousRevisions || []), { contentSha256:source.claimExtraction.sourceContentSha256, candidateIds:[...(source.claimExtraction.candidateIds || [])], completedAt:source.claimExtraction.completedAt || null }];
          source.claimExtraction.nextPage = 1; source.claimExtraction.candidateIds = []; source.claimExtraction.completedAt = null;
        }
        source.claimExtraction.sourceContentSha256 = currentContentSha;
        source.claimExtraction.windows = source.claimExtraction.windows || [];
        source.claimExtraction.attempts = Number(source.claimExtraction.attempts || 0) + 1; source.claimExtraction.startedAt = startedAt; source.state = 'claim-extraction-in-progress'; queue.updatedAt = startedAt; this.queue.write(queue);
        try {
          const pageStart = source.mediaType === 'application/pdf' ? Number(source.claimExtraction.nextPage || 1) : 1;
          const pageEnd = source.mediaType === 'application/pdf' ? Math.min(Number(source.pages || pageStart + this.pdfPagesPerBatch - 1), pageStart + this.pdfPagesPerBatch - 1) : 1;
          const priorWindow = source.claimExtraction.windows.find((window) => window.sourceContentSha256 === currentContentSha && window.pageStart === pageStart && window.pageEnd === pageEnd);
          let ids; let windowContentSha256; let comparison;
          if (priorWindow) {
            ids = [...priorWindow.candidateIds]; windowContentSha256 = priorWindow.windowContentSha256; comparison = 'unchanged-window-skipped';
          } else {
            const text = this.extractText({ ...source, durablePath: containedSourcePath(this.corpusRoot, source) }, pageStart, pageEnd); windowContentSha256 = sha256(Buffer.from(String(text), 'utf8')); const assertions = boundedAssertions(text); ids = []; const candidates = [];
            for (const assertion of assertions) {
              const boundary = source.mediaType === 'application/pdf' ? `${source.title || source.originalName || source.id}, SHA-256 ${source.contentSha256}, pages ${pageStart}-${pageEnd} only` : `${source.finalUrl || source.url || source.id}, SHA-256 ${source.contentSha256}, retrieved content only`;
              const candidate = this.candidate(source, assertion, boundary, startedAt); candidates.push(candidate); ids.push(candidate.id);
            }
            this.store.ingestMany(candidates); comparison = 'new-window-extracted';
          }
          queue = this.queue.read(); source = [...queue.documents, ...queue.links].find((item) => item.id === selected.id); source.claimExtraction.windows = source.claimExtraction.windows || [];
          if (!source.claimExtraction.windows.some((window) => window.sourceContentSha256 === currentContentSha && window.pageStart === pageStart && window.pageEnd === pageEnd)) source.claimExtraction.windows.push({ sourceContentSha256:currentContentSha, pageStart, pageEnd, windowContentSha256, candidateIds:[...ids], completedAt:this.now() });
          source.claimExtraction.candidateIds = [...new Set([...(source.claimExtraction.candidateIds || []), ...ids])]; source.claimExtraction.completedAt = this.now(); source.claimExtraction.classification = 'Insufficient Evidence'; delete source.claimExtraction.lastError; delete source.claimExtraction.failedAt;
          const morePdf = source.mediaType === 'application/pdf' && pageEnd < Number(source.pages || pageEnd);
          if (morePdf) { source.claimExtraction.nextPage = pageEnd + 1; source.claimExtraction.nextAction = 'extract-next-page-bounded-claims'; source.state = 'claim-extraction-forced-pending'; }
          else { source.claimExtraction.nextPage = null; source.claimExtraction.nextAction = ids.length ? 'evaluate-bounded-candidate-claims' : 'no-bounded-assertion-found'; source.state = 'claim-extraction-complete'; }
          queue.updatedAt = source.claimExtraction.completedAt; this.queue.write(queue); outcomes.push({ sourceId:source.id, state:source.state, candidateIds:ids, pages:source.mediaType === 'application/pdf' ? [pageStart, pageEnd] : null, comparison });
        } catch (error) {
          queue = this.queue.read(); source = [...queue.documents, ...queue.links].find((item) => item.id === selected.id); source.state = 'claim-extraction-forced-pending'; source.claimExtraction.lastError = String(error.message || error); source.claimExtraction.nextAction = 'retry-bounded-claim-extraction'; source.claimExtraction.failedAt = this.now(); queue.updatedAt = source.claimExtraction.failedAt; this.queue.write(queue); outcomes.push({ sourceId:source.id, state:'blocked', reason:source.claimExtraction.lastError, candidateIds:[] });
        }
      }
      return outcomes;
    } finally { unlock(); }
  }
}

module.exports = { containedSourcePath, cleanText, boundedAssertions, normalizedClaimSha256, defaultExtractText, AtomicClaimExtractionQueue, inspectClaimExtractionLock, ClaimExtractionWorker };
