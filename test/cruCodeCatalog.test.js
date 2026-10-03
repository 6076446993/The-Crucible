'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {buildCruCodeCatalog,validateCruCodeCatalog}=require('../src/cruCodeCatalog');
test('published CRU catalog matches the evolving Crucible registry',()=>{
 const published=JSON.parse(fs.readFileSync(path.join(__dirname,'..','governingDocuments','cru-code-catalog.json'),'utf8'));
 const generated=buildCruCodeCatalog({sourceCommit:null});
 assert.equal(published.schemaVersion,1);
 assert.equal(published.authority,'The-Crucible');
 assert.deepEqual(published,generated);
 assert.equal(validateCruCodeCatalog(published),true);
 assert.equal(new Set(published.codes.map(x=>x.code)).size,published.codes.length);
 assert.ok(published.codes.some((entry)=>entry.status==='active-classification'));
 assert.ok(published.codes.some((entry)=>entry.status==='operational-or-historical'));
});
test('CRU catalog keeps diagnostic meaning separate from authorization',()=>{
 const published=JSON.parse(fs.readFileSync(path.join(__dirname,'..','governingDocuments','cru-code-catalog.json'),'utf8'));
 assert.match(published.semantics,/not repair authorization/i);
 for(const entry of published.codes){assert.match(entry.code,/^CRU-\d{4}$/);assert.ok(entry.meaning);assert.ok(entry.remedy);assert.ok(entry.remedy.kind);assert.ok(['active-classification','operational-or-historical','diagnosis-coverage-marker'].includes(entry.status));}
});
