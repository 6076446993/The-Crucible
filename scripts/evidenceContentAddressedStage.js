'use strict';
/*
 * Authenticated raw-evidence content-addressed staging and roundtrip proof.
 * Does NOT change the source, delete history, promote candidates, or publish plaintext.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const SHA=/^[a-f0-9]{64}$/;
function shaFile(file){
 const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.allocUnsafe(1024*1024);
 try{for(;;){const n=fs.readSync(fd,buf,0,buf.length,null);if(!n)break;h.update(buf.subarray(0,n));}}
 finally{fs.closeSync(fd);}return h.digest('hex');
}
function assertSafeFile(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink())throw Error('Evidence cannot be a symlink or non-file');
 return st;
}
function validName(name){return typeof name==='string'&&name!=='.'&&name!=='..'&&name.length>0&&path.basename(name)===name&&!name.includes('/')&&!name.includes('\\')&&!name.includes('\0');}
function indexAndRoundtrip(root,reportPath) {
 const origin=fs.realpathSync(root);
 const manifestPath=path.join(origin,'manifest.json');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(!Array.isArray(manifest.sourceFiles)||!manifest.sourceFiles.length)throw Error('Manifest lacks source files');
 for(const k of ['queueSha256','learningSha256'])if(!SHA.test(manifest[k]))throw Error('Manifest lacks valid checksum: '+k);
 const queue=path.join(origin,'source-queue.json'),learning=path.resolve(origin,manifest.learningFile||'');
 if(path.dirname(learning)!==origin)throw Error('Learning path escapes origin');
 if(shaFile(queue)!==manifest.queueSha256||shaFile(learning)!==manifest.learningSha256)throw Error('Queue or learning-store integrity failed');
 const seenNames=new Set(),objects=new Map(),entries=[];
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-ephemeral-cas-'));
 fs.chmodSync(stage,0o700);
 let bytes=0,uniqueBytes=0,recovered=0;
 try {
  for(const record of manifest.sourceFiles){
   const {name,sha256,bytes:expectedBytes}=record;
   if(!validName(name)||seenNames.has(name))throw Error('Unsafe or duplicate manifest source name');
   seenNames.add(name);
   if(!SHA.test(sha256)||!Number.isSafeInteger(expectedBytes)||expectedBytes<0)throw Error('Invalid manifest source metadata');
   const original=path.join(origin,'sources',name);
   const st=assertSafeFile(original);
   if(st.size!==expectedBytes||shaFile(original)!==sha256)throw Error('Original source failed manifest integrity');
   bytes+=st.size;
   let object=objects.get(sha256);
   if(object&&object.bytes!==st.size)throw Error('Hash collision or manifest inconsistency');
   if(!object){
    const folder=path.join(stage,'objects',sha256.slice(0,2));fs.mkdirSync(folder,{recursive:true});
    const destination=path.join(folder,sha256);
    fs.copyFileSync(original,destination,fs.constants.COPYFILE_EXCL);
    if(shaFile(destination)!==sha256||assertSafeFile(destination).size!==st.size)throw Error('Content-addressed staging copy failed');
    object={file:destination,bytes:st.size};objects.set(sha256,object);uniqueBytes+=st.size;
   }
   entries.push({name,sha256,bytes:st.size});
  }
  // Rehydrate every original reference, not merely each distinct object.
  const restored=path.join(stage,'restored');fs.mkdirSync(restored,{recursive:true});
  for(const entry of entries){
   const object=objects.get(entry.sha256),file=path.join(restored,entry.name);
   fs.copyFileSync(object.file,file,fs.constants.COPYFILE_EXCL);
   if(assertSafeFile(file).size!==entry.bytes||shaFile(file)!==entry.sha256)throw Error('Reference restore verification failed');
   recovered++;
  }
  if(recovered!==manifest.sourceFiles.length||bytes<uniqueBytes)throw Error('Roundtrip did not preserve manifest references');
  const output={
   schemaVersion:1,provenance:'authenticated raw-intake staging',
   originalSourceReferences:entries.length,uniqueContentObjects:objects.size,
   originalLogicalSourceBytes:bytes,uniqueContentBytes:uniqueBytes,
   verifiedExactDuplicateBytes:bytes-uniqueBytes,
   restoredReferencesVerified:recovered,sourceManifestIntegrityVerified:true,
   queueSha256:manifest.queueSha256,learningSha256:manifest.learningSha256,
   fullCorpusRestored:false,sourceContentRoundtripVerified:true,
   subjectMapPreservedOutsideThisStaging:true,
   originalSourceMutated:false,originalCandidateMutated:false,
   runnerPlaintextRetained:false,productionMigrationPerformed:false,
   independentStorageVerified:false,historyRewriteAuthorized:false,
   note:'All content addressed objects and rehydrated source copies existed only in an isolated ephemeral staging directory. Current Git history and vetted encrypted custody are not changed.'
  };
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  fs.writeFileSync(reportPath,JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
  return output;
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
function selfTest(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-cas-fixture-'));
 try{
  fs.mkdirSync(path.join(root,'sources'));
  const files=[['x.txt','same'],['y.txt','same'],['z.txt','another']];
  const sourceFiles=[];
  for(const [name,value] of files){const file=path.join(root,'sources',name);fs.writeFileSync(file,value);sourceFiles.push({name,sha256:shaFile(file),bytes:Buffer.byteLength(value)});}
  const queue=path.join(root,'source-queue.json'),learn=path.join(root,'learning.json');
  fs.writeFileSync(queue,'{"documents":[],"links":[]}');fs.writeFileSync(learn,'{"payload":{"candidateRecords":[]}}');
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({sourceFiles,queueSha256:shaFile(queue),learningSha256:shaFile(learn),learningFile:'learning.json'}));
  const result=indexAndRoundtrip(root,path.join(root,'report.json'));
  if(result.uniqueContentObjects!==2||result.originalSourceReferences!==3||result.verifiedExactDuplicateBytes!==4)throw Error('CAS fixture failed');
  fs.writeFileSync(path.join(root,'sources','x.txt'),'tampered');
  try{indexAndRoundtrip(root,path.join(root,'failure.json'));throw Error('Tamper was not rejected');}
  catch(e){if(!/integrity/.test(e.message))throw e;}
  console.log('ephemeral CAS staging, restoration, tamper rejection passed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args[0]==='--self-test')selfTest();
 else if(args.length===2){
  const r=indexAndRoundtrip(args[0],args[1]);
  console.log(JSON.stringify({references:r.originalSourceReferences,uniqueObjects:r.uniqueContentObjects,duplicateBytes:r.verifiedExactDuplicateBytes,roundtripVerified:true}));
 }else throw Error('Usage: node scripts/evidenceContentAddressedStage.js ROOT REPORT or --self-test');
}
module.exports={indexAndRoundtrip,shaFile};
