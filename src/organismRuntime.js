const { preservedReplace, assertFileRestart } = require('./recoverySystem');
'use strict';const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');const {CardiopulmonaryCirculation}=require('./organismCirculation');const {repairOutcome}=require('./gradedOversightResponse');const {assessRecurrence,appendOutcome}=require('./findingLedger');
const sha=(value)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');const terminal=new Set(['completed','inhibited','rolled-back','quarantined','rejected']);
class DurableOrganismRuntime{
  // Only the trusted session host calls these methods. Job progress and heartbeats
  // never count as user activity. The host owns the actual transport disconnect.
  connectAttendedSession({sessionId,lastUserActivityAt,checkpoint,disconnect}) {
    if(this.idleTransition)throw new Error('Finish the pending disconnect before reconnecting.');
    const at=Date.parse(lastUserActivityAt),now=Date.parse(this.now());
    if(typeof sessionId!=='string'||!sessionId.trim()||!Number.isFinite(at)||!Number.isFinite(now)||at>now||typeof checkpoint!=='function'||typeof disconnect!=='function')throw new Error('Attended session requires trusted user activity, checkpoint and disconnect adapters.');
    const previous=this.read().attendedSession;
    if(previous&&(previous.sessionId!==sessionId||at<Date.parse(previous.lastUserActivityAt)))throw new Error('Attended session identity or activity would overwrite retained state.');
    if(previous&&['disconnecting','disconnect-held'].includes(previous.state)&&at===Date.parse(previous.lastUserActivityAt)){this.attendedAdapters={checkpoint,disconnect};this.scheduleIdleCheck();return;}
    if(previous&&previous.state!=='connected'&&at<=Date.parse(previous.lastUserActivityAt))throw new Error('Fresh user activity is required to reconnect an idle session.');
    this.attendedAdapters={checkpoint,disconnect};
    this.mutate('attended-session-connect',state=>{state.attendedSession={sessionId,lastUserActivityAt:new Date(at).toISOString(),timeoutMs:30*60*1000,state:'connected'};return state;});
    this.scheduleIdleCheck();
  }
  recordUserActivity({sessionId,at}) {
    const session=this.read().attendedSession,time=Date.parse(at),now=Date.parse(this.now());
    if(!session||session.sessionId!==sessionId||session.state!=='connected'||!Number.isFinite(time)||!Number.isFinite(now)||time<Date.parse(session.lastUserActivityAt)||time>now)throw new Error('User activity must bind the connected session and a monotonic non-future time.');
    this.mutate('user-activity',state=>{state.attendedSession.lastUserActivityAt=new Date(time).toISOString();return state;});
    this.scheduleIdleCheck();
  }
  scheduleIdleCheck() {
    clearTimeout(this.idleTimer);
    const session=this.read().attendedSession;
    if(!session||session.state==='disconnected')return;
    const remaining=Date.parse(session.lastUserActivityAt)+session.timeoutMs-Date.parse(this.now());
    this.idleTimer=setTimeout(()=>{this.checkUserInactivity().catch(error=>{this.lastIdleError=error;}).finally(()=>this.scheduleIdleCheck());},Number.isFinite(remaining)?Math.max(1000,Math.min(60000,remaining)):60000);
    this.idleTimer.unref();
  }
  attendedWorkAllowed() {
    const session=this.read().attendedSession;
    if(!session)return true;
    const elapsed=Date.parse(this.now())-Date.parse(session.lastUserActivityAt);
    return session.state==='connected'&&Number.isFinite(elapsed)&&elapsed>=0&&elapsed<session.timeoutMs;
  }
  async checkUserInactivity() {
    if(this.idleTransition)return this.idleTransition;
    const session=this.read().attendedSession;
    if(!session)return{state:'unattended'};
    if(session.state==='disconnected')return{state:'disconnected'};
    if(this.attendedWorkAllowed())return{state:'connected'};
    if(!Number.isFinite(Date.parse(this.now()))||Date.parse(this.now())<Date.parse(session.lastUserActivityAt))return{state:'disconnect-held',reason:'clock-skew'};
    if(this.inFlight)return{state:'disconnect-pending',reason:'finish-current-safe-boundary'};
    if(!this.attendedAdapters)return{state:'disconnect-held',reason:'session-host-adapters-unavailable'};
    this.idleTransition=(async()=>{
      const disconnectId=sha({sessionId:session.sessionId,lastUserActivityAt:session.lastUserActivityAt});
      try{
        // A completed current task and every remaining queue item are already durable.
        // The host must preserve unpublished work too and return its checkpoint identity.
        let checkpoint=session.checkpoint;
        if(!checkpoint){
          checkpoint=await this.attendedAdapters.checkpoint({sessionId:session.sessionId,disconnectId,state:this.read()});
          if(!/^[a-f0-9]{64}$/.test(checkpoint?.checkpointId||''))throw new Error('Idle disconnect requires a durable checkpoint identity.');
          if(this.read().attendedSession.lastUserActivityAt!==session.lastUserActivityAt)return{state:'connected',reason:'new-user-activity'};
          this.mutate('idle-checkpoint',state=>{state.attendedSession={...state.attendedSession,state:'disconnecting',checkpoint:{checkpointId:checkpoint.checkpointId},disconnectId};return state;});
        }
        await this.attendedAdapters.disconnect({sessionId:session.sessionId,disconnectId,checkpointId:checkpoint.checkpointId,reason:'user-inactive-30-minutes'});
        this.mutate('idle-disconnect',state=>{state.attendedSession={...state.attendedSession,state:'disconnected',disconnectedAt:this.now()};return state;});
        clearTimeout(this.idleTimer);
        return{state:'disconnected',checkpointId:checkpoint.checkpointId};
      }catch(error){
        this.mutate('idle-disconnect-held',state=>{state.attendedSession={...state.attendedSession,state:'disconnect-held'};return state;});
        throw error;
      }
    })();
    try{return await this.idleTransition;}finally{this.idleTransition=null;}
  }
  constructor({projectId,root,organs,learningStore,oversightReflex,maximumQueue=100,staleAfterMs=15*60*1000,now=()=>new Date().toISOString()}){if(!projectId||!root||!organs||!learningStore?.retrieve||!oversightReflex?.evaluate)throw new Error('Organism runtime requires project, organs, memory, and oversight reflex.');this.projectId=projectId;this.root=path.resolve(root);this.file=path.join(this.root,'organism-runtime.json');this.findingLedger=path.join(this.root,'finding-ledger.json');this.organs=organs;this.learningStore=learningStore;this.oversightReflex=oversightReflex;this.maximumQueue=maximumQueue;this.staleAfterMs=staleAfterMs;this.now=now;fs.mkdirSync(this.root,{recursive:true});assertFileRestart(this.file);if(!fs.existsSync(this.file))this.write({schemaVersion:1,projectId,revision:0,stopped:null,queue:[],completedKeys:[],organs:Object.fromEntries(Object.keys(organs).map((id)=>[id,{state:'healthy',dependency:null,lastSeenAt:this.now()}])),events:[],escalations:[]});this.read();}
  read(){assertFileRestart(this.file);const envelope=JSON.parse(fs.readFileSync(this.file,'utf8'));if(envelope.sha256!==sha(envelope.payload)||envelope.payload.projectId!==this.projectId)throw new Error('Organism runtime state is corrupt or cross-project.');return structuredClone(envelope.payload);}
  write(payload){const temp=`${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;const bytes=`${JSON.stringify({payload,sha256:sha(payload)},null,2)}\n`;preservedReplace(this.file,bytes,()=>{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});const fd=fs.openSync(temp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,this.file);});}
  mutate(action,fn){const state=this.read(),next=fn(structuredClone(state));next.revision=state.revision+1;next.events.push({at:this.now(),action});this.write(next);return structuredClone(next);}
  stateHash(){return sha(this.read());}
  applyOversight(envelope){const decision=this.oversightReflex.evaluate(envelope);if(decision.stateSha256!==this.stateHash())throw new Error('Oversight decision does not bind the current organism state.');return this.mutate(`oversight:${decision.decision}`,(state)=>{if(decision.decision==='STOP'){state.stopped=decision;
    // The brake reaches every governed organ, not only the pump. An organism whose queue is
    // halted while its organs still read healthy is one whose health view disagrees with its
    // own state, and the health view is what a person is trusting.
    for(const id of Object.keys(state.organs)){const prior=state.organs[id];state.organs[id]={...prior,state:'inhibited',dependency:`independent oversight STOP: ${decision.reason}`,priorState:prior.priorState||prior.state,lastSeenAt:this.now()};}
  }else{if(!state.stopped)throw new Error('Cannot clear an organism that is not stopped.');state.stopped=null;
    // A clear restores each organ to what it was before the stop; it never promotes an organ to
    // healthy that was degraded or unavailable when the brake came on.
    for(const id of Object.keys(state.organs)){const prior=state.organs[id];const restored=prior.priorState||'healthy';state.organs[id]={state:restored,dependency:restored==='healthy'?null:prior.dependency,lastSeenAt:this.now()};}
  }return state;});}
  setOrganAvailability(organId,available,dependency,authority){if(!this.organs[organId])throw new Error('Unknown organ.');const required=available?'governance+immune':'governance';if(authority!==required)throw new Error(`${required} authority is required to ${available?'recover':'inhibit'} an organ.`);return this.mutate(`organ:${organId}:${available?'recover':'unavailable'}`,(state)=>{state.organs[organId]={state:available?'healthy':'unavailable',dependency:available?null:(dependency||'unavailable dependency'),lastSeenAt:this.now()};return state;});}
  // Intake was already closed under a stop: submit refuses inside its own transaction. Left as
  // it was rather than duplicated here, where a second check would drift from the first.
  submit({id,type,sourceOrgan,targetOrgan,boundary,payload}){if(!this.inFlight&&!this.attendedWorkAllowed())throw new Error('Attended worker is idle or disconnected; preserve work and reconnect through the session host.');if(!id||!targetOrgan||!boundary)throw new Error('Bounded work identity, target, and boundary are required.');return this.mutate(`submit:${id}`,(state)=>{if(state.stopped)throw new Error('Independent oversight STOP inhibits the organism.');const key=sha({id,type,sourceOrgan,targetOrgan,boundary,payload});if(state.completedKeys.includes(key)||state.queue.some((item)=>item.key===key))return state;if(state.queue.length>=this.maximumQueue)throw new Error('Heartbeat backpressure limit reached; work is inhibited, not dropped.');state.queue.push({id,key,type,sourceOrgan,targetOrgan,boundary,payload,submittedAt:this.now(),attempts:0,state:'queued'});return state;});}
  async heartbeat(limit=25) {
    if(this.inFlight)throw new Error('A heartbeat is already executing in this worker.');
    await this.checkUserInactivity();
    if(this.inFlight)throw new Error('A heartbeat is already executing in this worker.');
    if(!this.attendedWorkAllowed())return{state:'attended-worker-disconnected',processed:0,sessionState:this.read().attendedSession?.state,health:this.health()};
    this.inFlight=1;let result,failure;
    try{result=await this.processHeartbeat(limit);}catch(error){failure=error;}
    this.inFlight=0;
    try{await this.checkUserInactivity();}catch(error){if(!failure)failure=error;}
    if(failure)throw failure;
    return{...result,sessionState:this.read().attendedSession?.state||null};
  }
  async processHeartbeat(limit=25){let state=this.read();if(state.stopped)return{state:'stopped-by-independent-oversight',processed:0,health:this.health()};const due=state.queue.filter((item)=>item.state==='queued'&&(!item.notBefore||Date.parse(item.notBefore)<=Date.parse(this.now()))).slice(0,limit),results=[];for(const item of due){if(!this.attendedWorkAllowed())break;state=this.read();const organ=state.organs[item.targetOrgan];if(!organ||organ.state!=='healthy'){this.mutate(`inhibit:${item.id}`,(next)=>{const queued=next.queue.find((value)=>value.key===item.key);queued.state='inhibited';queued.reason=organ?.dependency||'missing organ';return next;});results.push({id:item.id,state:'inhibited'});continue;}const circulation=new CardiopulmonaryCirculation({projectId:this.projectId,organs:{[item.targetOrgan]:async(envelope,payload)=>this.organs[item.targetOrgan]({envelope,payload,memory:this.learningStore.retrieve({boundary:item.boundary})})},maximumSignals:this.maximumQueue,now:this.now});circulation.admit({projectId:this.projectId,type:item.type,sourceOrgan:item.sourceOrgan,targetOrgan:item.targetOrgan,boundary:item.boundary},item.payload);try{const [result]=await circulation.pump();
      if(result.output?.recoveryHeld===true){
        this.mutate(`recovery-held:${item.id}`,(next)=>{const queued=next.queue.find(value=>value.key===item.key);queued.state='queued';queued.attempts++;queued.lastError=result.output.result?.operationalCode||'OPS-0049';queued.notBefore=new Date(Date.parse(this.now())+60000).toISOString();return next;});
        results.push({id:item.id,state:'recovery-held',output:result.output});continue;
      }
      this.mutate(`complete:${item.id}`,(next)=>{const queued=next.queue.find((value)=>value.key===item.key);queued.state='completed';queued.completedAt=this.now();next.completedKeys.push(item.key);next.organs[item.targetOrgan].lastSeenAt=this.now();return next;});results.push({id:item.id,state:result.state,output:result.output});}catch(error){this.mutate(`failure:${item.id}`,(next)=>{const queued=next.queue.find((value)=>value.key===item.key);queued.attempts++;queued.lastError=String(error.message||error);if(queued.attempts>=3){queued.state='quarantined';next.organs[item.targetOrgan]={state:'degraded',dependency:queued.lastError,lastSeenAt:this.now()};}return next;});if(this.read().queue.find((value)=>value.key===item.key)?.state==='quarantined')this.escalateRecurringFault(item,String(error.message||error));results.push({id:item.id,state:'failed',reason:String(error.message||error)});}}
    for(const result of results)if(result.output?.signals)for(const signal of result.output.signals)this.submit(signal);return{state:'heartbeat-complete',processed:results.length,results,health:this.health()};}
  // A quarantine is the moment a fault stops being an incident and becomes a pattern. The three
  // retries inside one run are the bounded repair attempt; whether that attempt *held* is a
  // question no single run can answer, so the fault is written down here and judged against
  // every previous time it happened. Without this the organism could degrade, be recovered,
  // degrade again on the same fault forever, and never once ask for a brake.
  escalateRecurringFault(item,failure){const observedAt=this.now();
    const {finding,decision,recurrence}=assessRecurrence({file:this.findingLedger,kind:'organ-work-failure',organ:item.targetOrgan,boundary:item.boundary,detail:failure,health:this.health(),observedAt});
    // Recorded before anything is decided, and recorded as unverified, because a repair the
    // organism checked itself is not a verified repair. That is what makes the next recurrence
    // of this same fault escalate instead of buying another window.
    appendOutcome({file:this.findingLedger,outcome:repairOutcome({finding,attempted:true,result:{organ:item.targetOrgan,boundary:item.boundary},independentVerification:null,observedAt})});
    if(!decision.escalate)return decision;
    this.mutate(`escalate:${item.id}`,(state)=>{state.escalations=state.escalations||[];const queued=state.queue.find((value)=>value.key===item.key);if(queued)queued.findingId=finding.findingId;
      if(!state.escalations.some((entry)=>entry.findingId===finding.findingId))state.escalations.push({findingId:finding.findingId,organ:item.targetOrgan,boundary:item.boundary,recurrence:recurrence+1,reason:decision.reason,requestedOfOversight:decision.requestedOfOversight,at:observedAt});
      return state;});
    return decision;}
  // Homeostasis recovers inhibited work of its own accord; under an oversight stop it may not.
  // Recovery from a STOP requires oversight clearance and the owner's authorisation, and an
  // organism that can quietly un-inhibit itself has neither.
  recover(){if(this.read().stopped)throw new Error('Independent oversight has stopped this organism; recovery requires oversight clearance and the owner authorisation, not homeostasis.');return this.mutate('homeostasis-recovery',(state)=>{const escalated=new Set((state.escalations||[]).map((entry)=>entry.findingId));for(const item of state.queue)if(['inhibited','quarantined'].includes(item.state)&&state.organs[item.targetOrgan]?.state==='healthy'){if(item.findingId&&escalated.has(item.findingId)){item.lastError='this fault recurred after an unverified repair and a STOP has been requested of independent oversight; homeostasis may not clear it';continue;}item.state='queued';item.lastError=null;}return state;});}
  health(){const state=this.read(),now=Date.parse(this.now()),organs={};for(const [id,status] of Object.entries(state.organs)){const stale=Number.isFinite(Date.parse(status.lastSeenAt))&&now-Date.parse(status.lastSeenAt)>this.staleAfterMs;organs[id]={state:status.state==='healthy'&&stale?'degraded':status.state,missingDependency:status.dependency||null,stale};}const queued=state.queue.filter((item)=>!terminal.has(item.state)).length;const escalations=state.escalations||[];return{projectId:this.projectId,escalations,state:state.stopped?'inhibited':Object.values(organs).some((item)=>item.state!=='healthy')?'degraded':queued>=this.maximumQueue?'backpressure':'healthy',oversight:state.stopped?{state:'STOP',reason:state.stopped.reason}:escalations.length?{state:'CLEAR',requestedOfOversight:'STOP',pending:escalations.length}:{state:'CLEAR'},queue:{active:queued,capacity:this.maximumQueue},organs,revision:state.revision};}
}
module.exports={DurableOrganismRuntime};
