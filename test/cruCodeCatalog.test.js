'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {buildCruCodeCatalog}=require('../src/cruCodeCatalog');
test('published CRU catalog matches active Crucible classification registry',()=>{
 const published=JSON.parse(fs.readFileSync(path.join(__dirname,'..','governingDocuments','cru-code-catalog.json'),'utf8'));
 const generated=buildCruCodeCatalog({sourceCommit:null});
 assert.equal(published.schemaVersion,1);
 assert.equal(published.authority,'The-Crucible');
 assert.deepEqual(published.codes,generated.codes);
 assert.equal(new Set(published.codes.map(x=>x.code)).size,published.codes.length);
});
test('CRU catalog keeps diagnostic meaning separate from authorization',()=>{
 const published=JSON.parse(fs.readFileSync(path.join(__dirname,'..','governingDocuments','cru-code-catalog.json'),'utf8'));
 assert.match(published.semantics,/not repair authorization/i);
 for(const entry of published.codes){assert.match(entry.code,/^CRU-\d{4}$/);assert.ok(entry.meaning);assert.ok(entry.remedy);assert.ok(entry.remedy.kind);}
});
