'use strict';const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {ExternalOversightReflex,canonical}=require('../src/oversightReflex');const {DurableOrganismRuntime}=require('../src/organismRuntime');
const at='2026-09-01T06:00:00.000Z';function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'organism-runtime-')),{publicKey:oversightPublicKey,privateKey:oversightPrivateKey}=crypto.generateKeyPairSync('ed25519'),{publicKey:ownerPublicKey,privateKey:ownerPrivateKey}=crypto.generateKeyPairSync('ed25519'),calls=[],memory={retrieve:({boundary})=>[{boundary,claim:'active verified lesson'}]},organs={brain:async({payload,memory})=>{calls.push(['brain',payload,memory.length]);return{planned:true};},immune:async({payload})=>{calls.push(['immune',payload]);if(payload.fail)throw new Error('simulated verifier outage');return{contained:true,repair:'reversible',independentlyVerified:true};},reporting:async()=>({reported:true})},reflex=new ExternalOversightReflex({projectId:'p',oversightPublicKey,ownerPublicKey}),runtime=new DurableOrganismRuntime({projectId:'p',root,organs,learningStore:memory,oversightReflex:reflex,maximumQueue:2,now:()=>at});return{runtime,calls,oversightPrivateKey,ownerPrivateKey,root};}
function decision(runtime,privateKey,ownerPrivateKey,type){const payload={schemaVersion:1,projectId:'p',decision:type,reason:type==='STOP'?'unsafe organism state':'owner-reviewed recovery',issuedAt:at,stateSha256:runtime.stateHash()},result={...payload,oversightSignature:crypto.sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};if(type==='CLEAR')result.ownerSignature=crypto.sign(null,Buffer.from(canonical(payload)),ownerPrivateKey).toString('base64');return result;}
function attendedFixture() {
  const f=fixture(),events=[];let time=Date.parse(at);
  f.runtime.now=()=>new Date(time).toISOString();
  const session={sessionId:'owner-session',lastUserActivityAt:at,
    checkpoint:async request=>{events.push(['checkpoint',request]);return{checkpointId:'a'.repeat(64)};},
    disconnect:async request=>{events.push(['disconnect',request]);}};
  f.runtime.connectAttendedSession(session);
  return{...f,events,session,advance:ms=>{time+=ms;}};
}
test('thirty minutes of USER inactivity checkpoints before disconnect and preserves queued work',async()=>{
  const f=attendedFixture(),work={id:'pending',type:'observation',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'recovery',payload:{finding:'retained'}};
  f.runtime.submit(work);const before=f.runtime.read().queue;
  f.advance(30*60*1000);const result=await f.runtime.heartbeat();
  assert.equal(result.processed,0);assert.equal(f.calls.length,0);
  assert.deepEqual(f.events.map(e=>e[0]),['checkpoint','disconnect']);
  assert.deepEqual(f.runtime.read().queue,before);
  assert.equal(f.runtime.read().attendedSession.state,'disconnected');
  assert.throws(()=>f.runtime.submit({...work,id:'new'}),/idle or disconnected/);
  await f.runtime.checkUserInactivity();assert.equal(f.events.length,2);
});
test('worker heartbeat does not reset user idle time; trusted user activity does',async()=>{
  const f=attendedFixture();f.advance(29*60*1000);await f.runtime.heartbeat();
  assert.equal(f.runtime.read().attendedSession.lastUserActivityAt,at);
  f.runtime.recordUserActivity({sessionId:'owner-session',at:f.runtime.now()});
  f.advance(29*60*1000);assert.equal((await f.runtime.checkUserInactivity()).state,'connected');
  f.advance(60000);assert.equal((await f.runtime.checkUserInactivity()).state,'disconnected');
});
test('idle disconnect waits for an active task safe boundary and does not begin the next task',async()=>{
  const f=attendedFixture();let finish;f.runtime.organs.brain=async()=>{f.advance(30*60*1000);await new Promise(resolve=>{finish=resolve;});return{planned:true};};
  for(const id of ['first','second'])f.runtime.submit({id,type:'observation',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'recovery',payload:{}});
  const running=f.runtime.heartbeat();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.runtime.checkUserInactivity()).state,'disconnect-pending');assert.equal(f.events.length,0);
  finish();const result=await running;assert.equal(result.processed,1);
  assert.equal(f.runtime.read().queue.find(q=>q.id==='second').state,'queued');
  assert.equal(f.runtime.read().attendedSession.state,'disconnected');
});
test('failed checkpoint prevents disconnect and all new execution; retry preserves work',async()=>{
  const f=attendedFixture();f.runtime.attendedAdapters.checkpoint=async()=>{throw new Error('storage unavailable');};f.advance(30*60*1000);
  await assert.rejects(f.runtime.heartbeat(),/storage unavailable/);assert.equal(f.events.length,0);
  assert.equal(f.runtime.attendedWorkAllowed(),false);
  f.runtime.attendedAdapters.checkpoint=f.session.checkpoint;
  assert.equal((await f.runtime.checkUserInactivity()).state,'disconnected');
});
test('failed transport retries the same checkpoint and disconnect identity',async()=>{
  const f=attendedFixture();const ids=[];f.runtime.attendedAdapters.disconnect=async request=>{ids.push(request.disconnectId);if(ids.length===1)throw new Error('transport unavailable');};f.advance(30*60*1000);
  await assert.rejects(f.runtime.checkUserInactivity(),/transport unavailable/);
  await f.runtime.checkUserInactivity();assert.equal(f.events.length,1);assert.equal(ids[0],ids[1]);
});
test('restart cannot refresh idle clock or execute without host adapters',async()=>{
  const f=attendedFixture();f.advance(30*60*1000);
  const restarted=new DurableOrganismRuntime({projectId:'p',root:f.root,organs:f.runtime.organs,learningStore:f.runtime.learningStore,oversightReflex:f.runtime.oversightReflex,now:f.runtime.now});
  assert.equal((await restarted.heartbeat()).processed,0);
  assert.equal((await restarted.checkUserInactivity()).reason,'session-host-adapters-unavailable');
  assert.throws(()=>restarted.connectAttendedSession({...f.session,sessionId:'different'}),/identity/);
  assert.equal(restarted.read().attendedSession.lastUserActivityAt,at);
  clearTimeout(f.runtime.idleTimer);
});
test('invalid, foreign, stale and future user activity cannot extend a session',()=>{
  const f=attendedFixture();
  for(const value of [{sessionId:'different',at},{sessionId:'owner-session',at:'bad'},{sessionId:'owner-session',at:'2026-09-01T07:00:00Z'},{sessionId:'owner-session',at:'2026-08-31T00:00:00Z'}])assert.throws(()=>f.runtime.recordUserActivity(value));
  clearTimeout(f.runtime.idleTimer);
});
test('fresh user activity during checkpoint cancels the obsolete disconnect',async()=>{
  const f=attendedFixture();f.runtime.attendedAdapters.checkpoint=async()=>{f.runtime.recordUserActivity({sessionId:'owner-session',at:f.runtime.now()});return{checkpointId:'a'.repeat(64)};};
  f.advance(30*60*1000);assert.equal((await f.runtime.checkUserInactivity()).reason,'new-user-activity');
  assert.equal(f.runtime.read().attendedSession.state,'connected');assert.equal(f.events.length,0);clearTimeout(f.runtime.idleTimer);
});
test('idle timer checkpoints and disconnects without another heartbeat',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=attendedFixture();f.advance(30*60*1000);t.mock.timers.tick(60000);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.runtime.read().attendedSession.state,'disconnected');
  assert.deepEqual(f.events.map(e=>e[0]),['checkpoint','disconnect']);
});
test('heartbeat deduplicates, applies backpressure, routes verified memory, and persists restart-safe state',async()=>{const f=fixture(),work={id:'n1',type:'observation',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'exact runtime',payload:{finding:'failure'}};f.runtime.submit(work);f.runtime.submit(work);f.runtime.submit({...work,id:'n2',targetOrgan:'reporting'});assert.throws(()=>f.runtime.submit({...work,id:'n3'}),/backpressure/);const result=await f.runtime.heartbeat();assert.equal(result.processed,2);assert.deepEqual(f.calls[0],['brain',{finding:'failure'},1]);assert.equal(new DurableOrganismRuntime({projectId:'p',root:f.root,organs:{brain:async()=>({}),immune:async()=>({}),reporting:async()=>({})},learningStore:{retrieve:()=>[]},oversightReflex:f.runtime.oversightReflex,maximumQueue:2,now:()=>at}).read().completedKeys.length,2);});
test('oversight STOP immediately inhibits and CLEAR requires both oversight and owner signatures',()=>{const f=fixture();f.runtime.applyOversight(decision(f.runtime,f.oversightPrivateKey,null,'STOP'));assert.equal(f.runtime.health().state,'inhibited');assert.throws(()=>f.runtime.submit({id:'x',type:'health',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'x',payload:{}}),/STOP/);assert.throws(()=>f.runtime.applyOversight(decision(f.runtime,f.oversightPrivateKey,crypto.generateKeyPairSync('ed25519').privateKey,'CLEAR')),/Owner/);f.runtime.applyOversight(decision(f.runtime,f.oversightPrivateKey,f.ownerPrivateKey,'CLEAR'));assert.equal(f.runtime.health().oversight.state,'CLEAR');});
test('faults degrade and quarantine only the affected organ, then homeostasis resumes after authorized recovery',async()=>{const f=fixture();f.runtime.submit({id:'immune-fault',type:'work-request',sourceOrgan:'brain',targetOrgan:'immune',boundary:'repair',payload:{fail:true}});await f.runtime.heartbeat();await f.runtime.heartbeat();await f.runtime.heartbeat();assert.equal(f.runtime.health().organs.immune.state,'degraded');f.runtime.setOrganAvailability('immune',true,null,'governance+immune');f.runtime.recover();assert.equal(f.runtime.read().queue[0].state,'queued');});
