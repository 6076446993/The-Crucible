#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {classifyNexusDiagnosis,verifyNexusRepair}=require('./nexusRepairBridge');
const action=process.argv[2];
let input={};try{input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');}catch(e){console.error(JSON.stringify({ok:false,error:'invalid JSON input'}));process.exit(2);}
try{
 const result=action==='classify'?classifyNexusDiagnosis(input):action==='verify'?verifyNexusRepair(input):null;
 if(!result) throw new Error('action must be classify or verify');
 process.stdout.write(JSON.stringify({ok:true,result})+'\n');
}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=1;}
