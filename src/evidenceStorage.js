'use strict';
// Shared storage primitive: preserves native records and grants no custody cleanup authority.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { acquireDurableLock } = require('./durableLock');
const { syncDirectory, hashFile } = require('./recoverySystem');
const { operationalError } = require('./failureCodes');
const SHA = /^[a-f0-9]{64}$/;
const fail = message => { throw operationalError('OPS-0049', `Evidence storage refused: ${message}`); };
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  const result = JSON.stringify(value); if (result === undefined) fail('non-JSON identity'); return result;
}
const digest = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
function text(value) { if (typeof value !== 'string' || !value.trim()) fail('missing identity'); return value; }
function regular(file, allowLinks = false) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (!allowLinks && stat.nlink !== 1)) fail('non-exclusive regular object');
  return stat;
}
function directory(root, create = false) {
  const absolute = path.resolve(root);
  if (create && !fs.existsSync(absolute)) { fs.mkdirSync(absolute, { mode:0o700 }); syncDirectory(path.dirname(absolute)); }
  const actual=fs.realpathSync(absolute),temporary=path.resolve(os.tmpdir()),canonicalTemporary=fs.realpathSync(temporary);
  const expected=absolute===temporary||absolute.startsWith(temporary+path.sep)?path.join(canonicalTemporary,path.relative(temporary,absolute)):absolute;
  if (!fs.lstatSync(absolute).isDirectory() || fs.lstatSync(absolute).isSymbolicLink() || actual !== expected) fail('non-canonical storage directory');
  return actual;
}
function initialRegistry(projectId, securityDomain, catalog) {
  text(projectId); text(securityDomain);
  if (!catalog || !Array.isArray(catalog.subjects) || !Array.isArray(catalog.evidenceTypes) ||
      !catalog.subjects.length || !catalog.evidenceTypes.length ||
      catalog.subjects.some(x => !/^LEE-S-\d{3,}$/.test(x)) || catalog.evidenceTypes.some(x => !/^LEE-E-\d{3,}$/.test(x)) ||
      new Set(catalog.subjects).size !== catalog.subjects.length || new Set(catalog.evidenceTypes).size !== catalog.evidenceTypes.length) fail('reviewed unique subject/type catalog required');
  return { schemaVersion:1, projectId, securityDomain, catalog:structuredClone(catalog), entries:[], aliases:[], journal:[] };
}
function applyRegistration(state, input) {
  if (input.projectId !== state.projectId || input.securityDomain !== state.securityDomain ||
      !['source','candidate'].includes(input.kind) || !SHA.test(input.identitySha256) || !SHA.test(input.contentSha256) || !SHA.test(input.recordSha256)) fail('cross-domain or invalid registration');
  text(input.legacyId); text(input.observationId);
  if (!input.objectRef || input.objectRef.contentSha256 !== input.contentSha256 || !SHA.test(input.objectRef.ciphertextSha256) || typeof input.objectRef.keyId !== 'string' || !input.objectRef.keyId) fail('verified encrypted object reference required');
  if (!Number.isFinite(Date.parse(input.originatedAt))) fail('original observation time required');
  for (const [values, allowed] of [[input.subjectCodes,state.catalog.subjects],[input.evidenceTypeCodes,state.catalog.evidenceTypes]]) {
    if (!Array.isArray(values) || !values.length || values.some(x => !allowed.includes(x)) || new Set(values).size !== values.length) fail('classification review required');
  }
  const leeId = `LEE-${digest({ projectId:state.projectId, securityDomain:state.securityDomain, kind:input.kind, identitySha256:input.identitySha256 })}`;
  let entry = state.entries.find(x => x.id === leeId);
  if (entry && (entry.contentSha256 !== input.contentSha256 || entry.identitySha256 !== input.identitySha256 || entry.kind !== input.kind || canonical(entry.objectRef)!==canonical(input.objectRef))) fail('logical identity collision');
  if (!entry) { entry = { id:leeId, kind:input.kind, identitySha256:input.identitySha256, contentSha256:input.contentSha256, objectRef:structuredClone(input.objectRef), subjectCodes:[], evidenceTypeCodes:[] }; state.entries.push(entry); }
  for (const key of ['subjectCodes','evidenceTypeCodes']) entry[key] = [...new Set([...entry[key],...input[key]])].sort();
  let alias = state.aliases.find(x => x.kind === input.kind && x.legacyId === input.legacyId);
  if (alias && alias.leeId !== leeId) fail('legacy alias would change evidence identity');
  if (!alias) { alias = { kind:input.kind, legacyId:input.legacyId, leeId, originatedAt:input.originatedAt, recordSha256s:[] }; state.aliases.push(alias); }
  if (alias.originatedAt !== input.originatedAt) fail('original evidence age would change');
  if (!alias.recordSha256s.includes(input.recordSha256)) alias.recordSha256s.push(input.recordSha256);
  return leeId;
}
function validateRegistry(state) {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.journal) || !Array.isArray(state.entries) || !Array.isArray(state.aliases)) fail('invalid registry');
  const rebuilt = initialRegistry(state.projectId, state.securityDomain, state.catalog);
  let previous = '0'.repeat(64); const observations = new Set();
  for (const [index,event] of state.journal.entries()) {
    if (event.sequence !== index + 1 || event.previousSha256 !== previous || observations.has(event.registration?.observationId)) fail('journal gap, fork or duplicate observation');
    const { sha256, ...body } = event;
    if (digest(body) !== sha256) fail('journal checksum differs');
    if (applyRegistration(rebuilt, event.registration) !== event.leeId) fail('journal logical identity differs');
    observations.add(event.registration.observationId); previous = sha256;
  }
  if (canonical(rebuilt.entries) !== canonical(state.entries) || canonical(rebuilt.aliases) !== canonical(state.aliases)) fail('registry differs from journal replay');
  return { sequence:state.journal.length, sha256:previous };
}
function register(state, registration) {
  const tip = validateRegistry(state);
  const prior = state.journal.find(x => x.registration.observationId === registration.observationId);
  if (prior) { if (canonical(prior.registration) !== canonical(registration)) fail('observation ID conflict'); return { state:structuredClone(state), leeId:prior.leeId, changed:false }; }
  const next = structuredClone(state), leeId = applyRegistration(next, registration);
  const body = { sequence:tip.sequence + 1, previousSha256:tip.sha256, registration:structuredClone(registration), leeId };
  next.journal.push({ ...body, sha256:digest(body) }); validateRegistry(next);
  return { state:next, leeId, changed:true };
}
function signedStatement(signed, publicKey, signer, projectId, securityDomain) {
  if (!signed?.statement || typeof signed.signature !== 'string') fail('signed custody statement missing');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.from(canonical(signed.statement)), key, Buffer.from(signed.signature,'base64'))) fail('custody signature invalid');
  const s = signed.statement;
  if (s.signer !== signer || s.projectId !== projectId || s.securityDomain !== securityDomain) fail('custody authority or domain differs');
  return s;
}
function verifyCheckpoint(state, signed, { publicKey, signer, workerIdentity }) {
  text(signer); text(workerIdentity); if (signer === workerIdentity) fail('self-signed independent checkpoint');
  const current = validateRegistry(state), s = signedStatement(signed, publicKey, signer, state.projectId, state.securityDomain);
  if (s.schemaVersion !== 1 || s.catalogSha256!==digest(state.catalog) || s.purpose !== 'lee-journal-checkpoint' || !Number.isSafeInteger(s.sequence) || s.sequence < 0 || s.sequence > current.sequence || !SHA.test(s.sha256)) fail('checkpoint rollback or invalid binding');
  const historic = s.sequence ? state.journal[s.sequence-1].sha256 : '0'.repeat(64);
  if (historic !== s.sha256) fail('independently pinned journal fork');
  return { ...current, signedCheckpointVerified:true, independentStorageProtectionVerified:false, cleanupAuthorized:false };
}
function verifyNoChangePublication({ previous, current, receipt, publicKey, signer, workerIdentity, projectId, securityDomain, now=Date.now() }) {
  text(signer);text(workerIdentity);text(projectId);text(securityDomain);
  if(!Number.isFinite(now))fail('valid observation time required');
  if (signer === workerIdentity) fail('worker cannot approve its own publication');
  const a=signedStatement(previous,publicKey,signer,projectId,securityDomain), b=signedStatement(current,publicKey,signer,projectId,securityDomain);
  const contentKeys=['schemaVersion','projectId','securityDomain','signer','purpose','workerPlaintextSha256','queueSha256','learningSha256','decisionsSha256','eventSha256','ciphertextSha256','keyId'].sort();
  for (const s of [a,b]) {
    if (canonical(Object.keys(s).sort())!==canonical(contentKeys) || s.schemaVersion!==1 || s.purpose !== 'vetted-content-identity' || ['workerPlaintextSha256','queueSha256','learningSha256','decisionsSha256','eventSha256','ciphertextSha256'].some(k=>!SHA.test(s[k]))) fail('incomplete authenticated content identity');
  }
  const r=signedStatement(receipt,publicKey,signer,projectId,securityDomain);
  const receiptKeys=['schemaVersion','projectId','securityDomain','signer','purpose','previousStatementSha256','currentStatementSha256','previousEventSha256','currentEventSha256','reusedCiphertextSha256','issuedAt','expiresAt'].sort();
  if (canonical(Object.keys(r).sort())!==canonical(receiptKeys) || r.schemaVersion!==1 || r.purpose !== 'vetted-no-change-observation' || r.previousStatementSha256 !== digest(a) || r.currentStatementSha256 !== digest(b) ||
      r.previousEventSha256 !== a.eventSha256 || r.currentEventSha256 !== b.eventSha256 || r.reusedCiphertextSha256 !== a.ciphertextSha256 ||
      !Number.isFinite(Date.parse(r.issuedAt)) || Date.parse(r.issuedAt)>now || !Number.isFinite(Date.parse(r.expiresAt)) || Date.parse(r.expiresAt)<=now) fail('no-change receipt binding or lifetime differs');
  const unchanged=['workerPlaintextSha256','queueSha256','learningSha256','decisionsSha256','keyId'].every(k=>typeof a[k]==='string' && a[k]===b[k]);
  return { reuseCiphertext:unchanged, mustRetainSignedObservation:true, eventChanged:a.eventSha256!==b.eventSha256, ciphertextSha256:unchanged?a.ciphertextSha256:null, publisherMutationAuthorized:false, cleanupAuthorized:false };
}
class EncryptedEvidenceObjects {
  constructor({ root, projectId, securityDomain, key, keyId }) {
    text(projectId); text(securityDomain); text(keyId);
    if (!Buffer.isBuffer(key) || key.length !== 32) fail('authorized 32-byte object key required');
    this.projectId=projectId; this.securityDomain=securityDomain; this.keyId=keyId;
    const base=directory(root), domain=digest({projectId,securityDomain}); this.root=directory(path.join(base,domain),true);
    this.key=Buffer.from(crypto.hkdfSync('sha256',key,Buffer.alloc(0),Buffer.from(`CrucibleEvidenceObject/v1:${domain}`),32));
  }
  file(hash) { if (!SHA.test(hash)) fail('invalid object hash'); return path.join(this.root,hash+'.enc'); }
  read(hash) {
    return this.#readObject(hash);
  }
  #readObject(hash, allowLinks = false) {
    const file=this.file(hash);if(regular(file,allowLinks).size>256*1024*1024)fail('oversized encrypted object');const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
    if (envelope.schemaVersion!==1 || envelope.projectId!==this.projectId || envelope.securityDomain!==this.securityDomain || envelope.keyId!==this.keyId || envelope.contentSha256!==hash) fail('encrypted object binding differs');
    const decipher=crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(envelope.nonce,'base64'));
    decipher.setAAD(Buffer.from(canonical({projectId:this.projectId,securityDomain:this.securityDomain,keyId:this.keyId,contentSha256:hash})));
    decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
    let plaintext;try { plaintext=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]); } catch { fail('object authentication failed'); }
    if (digest(plaintext)!==hash || plaintext.length!==envelope.plaintextBytes) fail('object restoration digest differs');
    return plaintext;
  }
  #recoverPublication(hash, plaintext) {
    const file=this.file(hash),stat=regular(file,true);
    if(stat.nlink===1)return;
    const temporary=fs.readdirSync(this.root).filter(name=>/^\.pending-[a-f0-9-]{36}$/.test(name)).map(name=>path.join(this.root,name)).filter(name=>{const s=fs.lstatSync(name);return s.isFile()&&!s.isSymbolicLink()&&s.dev===stat.dev&&s.ino===stat.ino;});
    // Only finalize a publication whose complete set of temporary links is known,
    // and whose authenticated plaintext exactly matches the native source bytes.
    if(temporary.length!==stat.nlink-1||!this.#readObject(hash,true).equals(plaintext))fail('unknown interrupted object links; preserve for reconciliation');
    for(const name of temporary)fs.unlinkSync(name);
    syncDirectory(this.root);
  }
  put(plaintext) {
    if (!Buffer.isBuffer(plaintext) || !plaintext.length || plaintext.length>128*1024*1024) fail('bounded source bytes required');
    const hash=digest(plaintext),file=this.file(hash),held=acquireDurableLock(path.join(this.root,'objects.lock'),{description:'Domain evidence-object lock'});
    try {
      if(fs.existsSync(file)){this.#recoverPublication(hash,plaintext);if(!this.read(hash).equals(plaintext))fail('content collision');return{contentSha256:hash,created:false,ciphertextSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};}
      const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,nonce);
      cipher.setAAD(Buffer.from(canonical({projectId:this.projectId,securityDomain:this.securityDomain,keyId:this.keyId,contentSha256:hash})));
      const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
      const bytes=Buffer.from(JSON.stringify({schemaVersion:1,projectId:this.projectId,securityDomain:this.securityDomain,keyId:this.keyId,contentSha256:hash,plaintextBytes:plaintext.length,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')})+'\n');
      const pending=path.join(this.root,`.pending-${crypto.randomUUID()}`);let fd;
      try { fd=fs.openSync(pending,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(pending,file);syncDirectory(this.root); }
      finally { if(fd!==undefined)fs.closeSync(fd);fs.rmSync(pending,{force:true}); }
      if(!this.read(hash).equals(plaintext))fail('published object differs');
      return{contentSha256:hash,created:true,ciphertextSha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    } finally { held.release(); }
  }
}
function physicalInventory(root) {
  const base=directory(root),entries=[],inodes=new Set();let logicalBytes=0,allocatedBytes=0,allocationSupported=true;
  function walk(dir) { for(const name of fs.readdirSync(dir).sort()) {
    const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())fail('symbolic inventory path');
    if(stat.isDirectory()){walk(file);continue;}if(!stat.isFile())fail('non-file inventory path');
    const key=`${stat.dev}:${stat.ino}`,fresh=!inodes.has(key);inodes.add(key);logicalBytes+=stat.size;
    const blocks=Number.isSafeInteger(stat.blocks)?stat.blocks*512:null;if(blocks===null)allocationSupported=false;else if(fresh)allocatedBytes+=blocks;
    entries.push({path:path.relative(base,file).split(path.sep).join('/'),bytes:stat.size,allocatedBytes:blocks,sha256:hashFile(file).sha256,sharedInode:!fresh});
  }}walk(base);
  return{schemaVersion:1,scope:'explicit-local-root-files',entries,inventorySha256:digest(entries),logicalBytes,allocatedBytes:allocationSupported?allocatedBytes:null,remotePhysicalBytes:null,cleanupAuthorized:false};
}
module.exports={canonical,digest,initialRegistry,validateRegistry,register,verifyCheckpoint,verifyNoChangePublication,EncryptedEvidenceObjects,physicalInventory};
