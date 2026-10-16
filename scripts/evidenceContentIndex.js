'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hashFile=file=>new Promise((resolve,reject)=>{const hash=crypto.createHash('sha256');let bytes=0;const stream=fs.createReadStream(file);stream.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length});stream.on('error',reject);stream.on('end',()=>resolve({sha256:hash.digest('hex'),bytes}))});
async function buildIndex(root,entries){
 if(!Array.isArray(entries))throw Error('Evidence entries must be an array');
 const base=fs.realpathSync(root),ids=new Set(),objects=new Map(),references=[];
 for(const entry of entries){
  if(typeof entry?.id!=='string'||!entry.id||ids.has(entry.id))throw Error('Missing or duplicate original identity');
  ids.add(entry.id);
  const rel=entry.relativePath;
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe evidence path');
  const file=path.resolve(base,rel),stat=fs.lstatSync(file);
  if(!file.startsWith(base+path.sep)||!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file)throw Error('Unsafe evidence file');
  const {sha256,bytes}=await hashFile(file);
  if(entry.expectedSha256&&entry.expectedSha256!==sha256)throw Error('Evidence digest mismatch');
  if(!Array.isArray(entry.subjects)||entry.subjects.some(s=>typeof s!=='string'||!s))throw Error('Invalid subject list');
  const key='sha256:'+sha256;
  if(!objects.has(key))objects.set(key,{key,bytes,referenceCount:0});
  objects.get(key).referenceCount++;
  references.push({originalId:entry.id,relativePath:rel,objectKey:key,bytes,subjects:[...new Set(entry.subjects)].sort()});
 }
 const unique=[...objects.values()].sort((a,b)=>a.key.localeCompare(b.key));
 const logicalBytes=references.reduce((n,x)=>n+x.bytes,0),uniqueBytes=unique.reduce((n,x)=>n+x.bytes,0);
 return {schemaVersion:1,mode:'read-only-preview',objects:unique,references,totals:{references:references.length,uniqueObjects:unique.length,logicalBytes,uniqueBytes,potentialDuplicateBytes:logicalBytes-uniqueBytes},evidenceModified:false,gitHistoryRewritten:false,migrationPerformed:false};
}
async function main(){
 if(process.argv[2]==='--self-test'){
  const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-index-'));
  try{
   fs.writeFileSync(path.join(dir,'a'),'same');fs.writeFileSync(path.join(dir,'b'),'same');
   const rows=[{id:'a',relativePath:'a',subjects:['memory','security']},{id:'b',relativePath:'b',subjects:['memory']}];
   const report=await buildIndex(dir,rows);
   if(report.totals.references!==2||report.totals.uniqueObjects!==1||report.totals.potentialDuplicateBytes!==4)throw Error('Deduplication test failed');
   let rejected=false;try{await buildIndex(dir,[rows[0],rows[0]])}catch{rejected=true}if(!rejected)throw Error('Duplicate ID accepted');
   rejected=false;try{await buildIndex(dir,[{...rows[0],relativePath:'../escape'}])}catch{rejected=true}if(!rejected)throw Error('Unsafe path accepted');
   rejected=false;try{await buildIndex(dir,[{...rows[0],expectedSha256:'wrong'}])}catch{rejected=true}if(!rejected)throw Error('Digest mismatch accepted');
   console.log('Evidence index self-test PASS');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}return;
 }
 if(process.argv.length!==5)throw Error('Usage: node scripts/evidenceContentIndex.js ROOT INPUT.json OUTPUT.json');
 const report=await buildIndex(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
 fs.writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report.totals));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={buildIndex};
