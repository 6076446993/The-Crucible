'use strict';
const fs=require('node:fs');const path=require('node:path');
const {buildCruCodeCatalog}=require('./cruCodeCatalog');
const target=path.join(__dirname,'..','governingDocuments','cru-code-catalog.json');
const action=process.argv[2]||'check';
const generated=JSON.stringify(buildCruCodeCatalog({sourceCommit:null}),null,2)+'\n';
if(action==='sync'){fs.writeFileSync(target,generated,'utf8');console.log('[CRU catalog] synchronized from failure-code registry.');}
else if(action==='check'){const current=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';if(current!==generated){console.error('[CRU catalog] published catalog is stale; run npm run cru-catalog:sync.');process.exitCode=1;}else console.log('[CRU catalog] published catalog matches the evolving registry.');}
else{console.error('Usage: node src/cruCodeCatalogCli.js [check|sync]');process.exitCode=2;}
