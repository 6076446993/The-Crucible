'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {CardiopulmonaryCirculation}=require('../src/organismCirculation');
test('failed delivery retains exact payload custody and retries before acknowledging',async()=>{
  let calls=0;const unit=new CardiopulmonaryCirculation({projectId:'p',organs:{brain:async()=>{if(++calls===1)throw new Error('temporary handler failure');return{accepted:true};}}});
  const envelope=unit.admit({projectId:'p',type:'observation',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'retained delivery'},{original:'Keep CASE and bytes'});
  await assert.rejects(unit.pump(),/temporary handler failure/);
  assert.equal(unit.queue.length,1);assert.equal(unit.queue[0].envelope.payloadSha256,envelope.payloadSha256);assert.deepEqual(unit.queue[0].payload,{original:'Keep CASE and bytes'});
  assert.equal(unit.health().state,'degraded');await unit.pump();assert.equal(calls,2);assert.equal(unit.queue.length,0);
});
test('missing handlers retain their signal and cannot silently release backpressure',async()=>{
  const unit=new CardiopulmonaryCirculation({projectId:'p',maximumSignals:1});const signal={projectId:'p',type:'health',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'held'};
  unit.admit(signal,{original:1});await unit.pump();assert.equal(unit.queue.length,1);assert.throws(()=>unit.admit(signal,{original:2}),/pressure/);
  unit.organs.brain=async()=>({accepted:true});await unit.pump();assert.equal(unit.queue.length,0);
});
test('concurrent pumps share one bounded dispatch and unauthorized output remains retained',async()=>{
  let calls=0,finish;const unit=new CardiopulmonaryCirculation({projectId:'p',organs:{brain:async()=>{calls++;await new Promise(r=>{finish=r;});return{promotionAuthorized:true};}}});
  unit.admit({projectId:'p',type:'health',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'concurrent'},{original:1});
  const first=unit.pump(),second=unit.pump();await new Promise(r=>setImmediate(r));finish();const results=await Promise.allSettled([first,second]);
  assert.equal(calls,1);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(unit.queue.length,1);assert.equal(unit.queue[0].attempts,1);
});
test('bounded failed delivery quarantines without deleting original custody',async()=>{
  let calls=0;const unit=new CardiopulmonaryCirculation({projectId:'p',maximumSignals:1,organs:{brain:async()=>{calls++;throw new Error('persistent outage');}}});
  const signal={projectId:'p',type:'health',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'quarantine'};const original=unit.admit(signal,{original:'retain'});
  for(let i=0;i<3;i++)await assert.rejects(unit.pump(),/CRU-0057/);
  await unit.pump();assert.equal(calls,3);assert.equal(unit.queue[0].state,'quarantined');assert.equal(unit.queue[0].envelope.payloadSha256,original.payloadSha256);assert.deepEqual(unit.queue[0].payload,{original:'retain'});assert.throws(()=>unit.admit(signal,{}),/pressure/);
});
test('circulation moves typed bounded signals and reports gaps without inventing work',async()=>{const seen=[];const unit=new CardiopulmonaryCirculation({projectId:'p',organs:{brain:async(envelope,payload)=>{seen.push([envelope.type,payload.signal]);return{routed:true};}},now:()=> '2026-09-01T05:00:00.000Z'});unit.admit({projectId:'p',type:'observation',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'exact test run'}, {signal:'failure'});unit.admit({projectId:'p',type:'work-request',sourceOrgan:'brain',targetOrgan:'missing-handler',boundary:'bounded repair'}, {request:'diagnose'});const results=await unit.pump();assert.deepEqual(seen,[['observation','failure']]);assert.equal(results[1].state,'inhibited-missing-organ-handler');assert.equal(unit.health().state,'degraded');assert.equal(unit.health().gaps[0].nextAction,'route-bounded-repair-or-owner-evidence-request');});
test('circulation rejects cross-project flow, unknown signals, custody mismatch, and self-proof',async()=>{const unit=new CardiopulmonaryCirculation({projectId:'p',organs:{bad:async()=>({promotionAuthorized:true})}});assert.throws(()=>unit.admit({projectId:'other',type:'health',sourceOrgan:'a',targetOrgan:'b',boundary:'x'},{}),/Cross-project/);assert.throws(()=>unit.admit({projectId:'p',type:'command',sourceOrgan:'a',targetOrgan:'b',boundary:'x'},{}),/allow-listed/);assert.throws(()=>unit.admit({projectId:'p',type:'health',sourceOrgan:'a',targetOrgan:'b',boundary:'x',payloadSha256:'0'.repeat(64)},{value:1}),/custody mismatch/);unit.admit({projectId:'p',type:'health',sourceOrgan:'a',targetOrgan:'bad',boundary:'x'},{});await assert.rejects(()=>unit.pump(),/cannot satisfy proof/);});
