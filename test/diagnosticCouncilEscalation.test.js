'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {struggleReasons,createDiagnosticCouncilEscalation}=require('../src/diagnosticCouncilEscalation');

test('ordinary classified first-pass diagnosis does not spend council capacity',async()=>{
 const advisor=createDiagnosticCouncilEscalation({externalConsult:async()=>{throw new Error('should not run');},localConsult:async()=>{throw new Error('should not run');}});
 const result=await advisor.consultWhenStruggling({phase:'diagnostic',projectId:'p',boundary:'b',report:{conclusion:'failure',unclassifiedFailure:false,diagnoses:[{id:'CRU-0008'}]}});
 assert.equal(result.invoked,false);
});

test('unclassified diagnostics invoke both advisory paths without authorization',async()=>{
 const calls=[];
 const advisor=createDiagnosticCouncilEscalation({
  externalConsult:async(input)=>{calls.push(['external',input.phase]);return{available:true,source:'ai-collaboration-council',authorizationGranted:false};},
  localConsult:async(input)=>{calls.push(['local',input.phase]);return{available:true,source:'crucible-local-council',authorizationGranted:false};},
 });
 const result=await advisor.consultWhenStruggling({phase:'diagnostic',projectId:'p',boundary:'b',report:{conclusion:'failure',unclassifiedFailure:true,diagnoses:[]}});
 assert.equal(result.invoked,true);assert.deepEqual(calls,[['external','diagnostic'],['local','diagnostic']]);assert.equal(result.authorizationGranted,false);
});

test('failed repair and recurrence are struggle signals',()=>{
 const reasons=struggleReasons({phase:'repair',repairResult:{state:'rolled-back'},attempt:2,repeatedFailureCount:3,regression:true});
 for(const reason of ['repair-rolled-back','repeated-repair-attempt','recurrent-failure','repair-regression'])assert.ok(reasons.includes(reason));
});

test('council authority escalation is rejected',async()=>{
 const advisor=createDiagnosticCouncilEscalation({
  externalConsult:async()=>({available:true,source:'ai-collaboration-council',authorizationGranted:true}),
  localConsult:async()=>({available:true,source:'crucible-local-council',authorizationGranted:false}),
 });
 const result=await advisor.consultWhenStruggling({phase:'repair',projectId:'p',boundary:'b',repairResult:{state:'failed'}});
 assert.equal(result.invoked,true);
 // The aggregator preserves the violation as data; productionOrganism rejects any top-level
 // authorization and downstream consumers must never treat an individual consultation as authority.
 assert.equal(result.authorizationGranted,false);
 assert.equal(result.consultations[0].authorizationGranted,true);
});
