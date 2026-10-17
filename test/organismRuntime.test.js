'use strict';const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {ExternalOversightReflex,canonical}=require('../src/oversightReflex');const {DurableOrganismRuntime}=require('../src/organismRuntime');
const at='2026-09-01T06:00:00.000Z';function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'organism-runtime-')),{publicKey:oversightPublicKey,privateKey:oversightPrivateKey}=crypto.generateKeyPairSync('ed25519'),{publicKey:ownerPublicKey,privateKey:ownerPrivateKey}=crypto.generateKeyPairSync('ed25519'),calls=[],memory={retrieve:({boundary})=>[{boundary,claim:'active verified lesson'}]},organs={brain:async({payload,memory})=>{calls.push(['brain',payload,memory.length]);return{planned:true};},immune:async({payload})=>{calls.push(['immune',payload]);if(payload.fail)throw new Error('simulated verifier outage');return{contained:true,repair:'reversible',independentlyVerified:true};},reporting:async()=>({reported:true})},reflex=new ExternalOversightReflex({projectId:'p',oversightPublicKey,ownerPublicKey}),runtime=new DurableOrganismRuntime({projectId:'p',root,organs,learningStore:memory,oversightReflex:reflex,maximumQueue:2,now:()=>at});return{runtime,calls,oversightPrivateKey,ownerPrivateKey,root};}
test('invalid sibling batch cannot acknowledge parent or partially admit children',async()=>{
  const f=fixture();f.runtime.maximumQueue=5;
  const child={id:'child',type:'report',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'outbox',payload:{original:1}};
  f.runtime.organs.brain=async()=>({signals:[child,{...child,id:'bad-child',type:'unregistered'}]});
  f.runtime.submit({id:'parent',type:'work-request',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'outbox',payload:{original:'parent'}});
  await f.runtime.heartbeat().catch(()=>{});const state=f.runtime.read();assert.equal(state.queue[0].state,'queued');assert.equal(state.completedKeys.length,0);assert.equal(state.queue.length,1);
});
test('held recovery and its reporting child commit atomically without parent completion',async()=>{
  const f=fixture();f.runtime.maximumQueue=4;
  f.runtime.organs.brain=async()=>({recoveryHeld:true,result:{operationalCode:'OPS-0049'},signals:[{id:'held-report',type:'report',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'outbox',payload:{held:true}}]});
  f.runtime.submit({id:'parent',type:'work-request',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'outbox',payload:{}});
  const original=f.runtime.write.bind(f.runtime);let heldGeneration;
  f.runtime.write=state=>{if(state.queue[0]?.notBefore&&!heldGeneration)heldGeneration=structuredClone(state);return original(state);};
  await f.runtime.heartbeat();assert.equal(heldGeneration.queue[0].state,'queued');assert.equal(heldGeneration.completedKeys.length,0);assert.ok(heldGeneration.queue.some(q=>q.id==='held-report'));
});
test('native writer ownership encloses runtime read-modify-write and preserves old generation',()=>{
  const f=fixture(),{acquireDurableLock}=require('../src/durableLock');const before=fs.readFileSync(f.runtime.file);const held=acquireDurableLock(f.runtime.file+'.lock');
  try{assert.throws(()=>f.runtime.submit({id:'competing',type:'health',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'lock',payload:{}}),/lock|held|running/i);assert.deepEqual(fs.readFileSync(f.runtime.file),before);}finally{held.release();}
});
test('real process interruption preserves parent ACK and every child through native journal replay',async t=>{
  const cp=require('node:child_process'),recovery=require('../src/recoverySystem');
  for(const phase of ['intent-durable','target-durable','commit-durable'])await t.test(phase,()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-outbox-cut-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const marker=path.join(root,'cut-marker');
    const script=`const fs=require('node:fs'),recovery=require(${JSON.stringify(require.resolve('../src/recoverySystem'))});
      let armed=false;const original=recovery.preservedReplace;
      recovery.preservedReplace=(file,bytes,publish)=>original(file,bytes,publish,stage=>{if(armed&&stage===process.argv[2]){fs.writeFileSync(process.argv[3],stage);process.kill(process.pid,'SIGKILL');}});
      const {DurableOrganismRuntime}=require(${JSON.stringify(require.resolve('../src/organismRuntime'))});
      const runtime=new DurableOrganismRuntime({projectId:'p',root:process.argv[1],organs:{brain:async()=>({signals:[{id:'child-one',type:'report',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'outbox',payload:{original:'ONE'}},{id:'child-two',type:'report',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'outbox',payload:{original:'two'}}]}),reporting:async()=>({reported:true})},learningStore:{retrieve:()=>[]},oversightReflex:{evaluate:()=>{throw Error('unused');}},maximumQueue:4});
      runtime.submit({id:'parent',type:'work-request',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'outbox',payload:{original:'Preserve parent'}});armed=true;
      runtime.heartbeat(1).catch(error=>{console.error(error);process.exitCode=1;});`;
    const killed=cp.spawnSync(process.execPath,['-e',script,root,phase,marker],{encoding:'utf8',timeout:15000});
    assert.ifError(killed.error);assert.notEqual(killed.status,0,killed.stderr);assert.equal(fs.readFileSync(marker,'utf8'),phase);
    const file=path.join(root,'organism-runtime.json'),journal=recovery.readJournal(file),intended=journal.at(-1).after;
    if(phase!=='commit-durable')assert.throws(()=>recovery.assertFileRestart(file),/interrupted/);
    // Only disposable dead-owner test locks have their age advanced; native 30s floor remains.
    for(const lock of [file+'.lock',file+'.recovery.lock'])if(fs.existsSync(lock))fs.utimesSync(lock,new Date(0),new Date(0));
    recovery.replayFile(file,intended);const state=JSON.parse(fs.readFileSync(file)).payload;
    assert.equal(state.queue.find(q=>q.id==='parent').state,'completed');assert.equal(state.completedKeys.length,1);
    assert.deepEqual(state.queue.filter(q=>q.state==='queued').map(q=>[q.id,q.payload.original]),[['child-one','ONE'],['child-two','two']]);
    assert.deepEqual(state.queue[0].delivery.childKeys,state.queue.slice(1).map(q=>q.key));assert.match(state.queue[0].delivery.outputSha256,/^[a-f0-9]{64}$/);
    const restarted=cp.spawnSync(process.execPath,['-e',`const fs=require('node:fs'),{DurableOrganismRuntime}=require(${JSON.stringify(require.resolve('../src/organismRuntime'))});const r=new DurableOrganismRuntime({projectId:'p',root:process.argv[1],organs:{brain:async()=>{throw Error('completed parent must not run');},reporting:async({payload})=>{fs.appendFileSync(process.argv[2],payload.original+'\\n');return{reported:true};}},learningStore:{retrieve:()=>[]},oversightReflex:{evaluate:()=>{}},maximumQueue:4});(async()=>{await r.heartbeat();const again=await r.heartbeat();if(again.processed!==0)throw Error('duplicate dispatch');console.log(JSON.stringify(r.read()));})().catch(e=>{console.error(e);process.exitCode=1;});`,root,path.join(root,'effects')],{encoding:'utf8',timeout:15000});
    assert.equal(restarted.status,0,restarted.stderr);assert.equal(JSON.parse(restarted.stdout).completedKeys.length,3);assert.equal(fs.readFileSync(path.join(root,'effects'),'utf8'),'ONE\ntwo\n');
  });
});
test('independent STOP during handler execution prevents parent ACK and child admission',async()=>{
  const f=fixture();f.runtime.maximumQueue=4;let finish;
  f.runtime.organs.brain=async()=>{await new Promise(resolve=>{finish=resolve;});return{signals:[{id:'child',type:'report',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'stop',payload:{}}]};};
  f.runtime.submit({id:'parent',type:'work-request',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'stop',payload:{original:'preserve'}});
  const running=f.runtime.heartbeat();await new Promise(resolve=>setImmediate(resolve));f.runtime.applyOversight(decision(f.runtime,f.oversightPrivateKey,null,'STOP'));finish();await running;
  const state=f.runtime.read();assert.ok(state.stopped);assert.equal(state.queue.length,1);assert.equal(state.queue[0].state,'queued');assert.equal(state.completedKeys.length,0);assert.equal(f.runtime.health().state,'inhibited');
});
test('child origin spoof and capacity refusal retain parent and the full original sibling set',async()=>{
  for(const kind of ['spoof','capacity']){
    const f=fixture(),children=[{id:'one',type:'report',sourceOrgan:'brain',targetOrgan:'reporting',boundary:'outbox',payload:{original:1}},{id:'two',type:'report',sourceOrgan:kind==='spoof'?'forged':'brain',targetOrgan:'reporting',boundary:'outbox',payload:{original:2}}];
    f.runtime.maximumQueue=kind==='capacity'?1:4;f.runtime.organs.brain=async()=>({signals:children});f.runtime.submit({id:'parent',type:'work-request',sourceOrgan:'nerves',targetOrgan:'brain',boundary:'outbox',payload:{original:'parent'}});
    await f.runtime.heartbeat();const state=f.runtime.read();assert.equal(state.queue.length,1);assert.equal(state.queue[0].state,'queued');assert.equal(state.completedKeys.length,0);assert.deepEqual(state.queue[0].payload,{original:'parent'});
  }
});
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
