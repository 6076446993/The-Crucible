'use strict';
// Read-only, metadata-only storage analysis. Never remove or rewrite evidence.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const run=(cmd,args)=>cp.execFileSync(cmd,args,{encoding:'utf8',maxBuffer:64*1024*1024,timeout:120000});
const git=(...args)=>run('git',args).trim();
const asBytes=x=>Number(x)||0;
const objectRows=git('rev-list','--objects','--all').split('\n').filter(Boolean);
const batch=cp.spawnSync('git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{input:objectRows.map(x=>x.slice(0,40)).join('\n')+'\n',encoding:'utf8',maxBuffer:128*1024*1024,timeout:180000});
if(batch.status!==0)throw Error('Git object inspection failed: '+String(batch.stderr).slice(0,500));
const paths=new Map(), sizes=new Map(), objectSizes=new Map();
const lines=batch.stdout.trim().split('\n');
if(lines.length!==objectRows.length)throw Error('Git object inventory incomplete');
let totalLogicalBytes=0,blobCount=0,largest=[];
for(let i=0;i<lines.length;i++){
 const m=/^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(lines[i]);
 if(!m)throw Error('Invalid object metadata');
 if(m[2]!=='blob')continue;
 blobCount++;const size=asBytes(m[3]),path=objectRows[i].slice(41);
 totalLogicalBytes+=size;
 if(path){const ext=(path.match(/\.([^.\/]+)$/)||[])[1]?.toLowerCase()||'(none)';const v=sizes.get(ext)||{objects:0,bytes:0};v.objects++;v.bytes+=size;sizes.set(ext,v);paths.set(path,(paths.get(path)||0)+size);}
 largest.push({path:path||'(unresolved)',bytes:size,oid:m[1]});
}
largest.sort((a,b)=>b.bytes-a.bytes);largest=largest.slice(0,30);
const output={schemaVersion:1,scope:'all locally fetched git refs; read-only metadata',completeHistoryCoverage:false,gitObjectsInspected:objectRows.length,uniqueBlobCount:blobCount,totalUniqueBlobLogicalBytes:totalLogicalBytes,byExtension:[...sizes].map(([extension,v])=>({extension,...v})).sort((a,b)=>b.bytes-a.bytes),largestBlobs:largest,gitObjectDiskBytes:null,lfsObjectDiskBytes:null,remoteArchiveBytes:null,workspaceBytes:null,duplicatePhysicalEvidenceVerified:false,contentAddressedMigrationPerformed:false,historyRewritten:false,candidateOrCustodyMutated:false,notes:['Git object sizes are logical uncompressed bytes, not disk usage or GitHub billing.','A shallow checkout cannot establish complete historical repository size.','File paths may contain source titles; only filenames and object metadata are recorded.','No evidence payloads or credentials are read or exported.']};
fs.mkdirSync('storage-audit',{recursive:true});
fs.writeFileSync('storage-audit/git-metadata.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({objects:output.gitObjectsInspected,blobs:blobCount,logicalBytes:totalLogicalBytes,historyComplete:false}));
