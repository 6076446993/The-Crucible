'use strict';
const crypto=require('node:crypto');
const {crucibleError}=require('./failureCodes');
const SIGNAL_TYPES=Object.freeze(['observation','candidate-evidence','health','work-request','inhibition','verified-memory-reference','report']);
const hash=(value)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error(`${label} is required.`);};
class CardiopulmonaryCirculation{
  constructor({projectId,organs={},maximumSignals=100,now=()=>new Date().toISOString()}){text(projectId,'projectId');if(!Number.isInteger(maximumSignals)||maximumSignals<1||maximumSignals>1000)throw new Error('maximumSignals must be between 1 and 1000.');this.projectId=projectId;this.organs=organs;this.maximumSignals=maximumSignals;this.now=now;this.queue=[];this.audit=[];}
  admit(signal,payload){if(signal?.projectId!==this.projectId)throw new Error('Cross-project circulation is forbidden.');for(const key of ['type','sourceOrgan','targetOrgan','boundary'])text(signal?.[key],key);if(!SIGNAL_TYPES.includes(signal.type))throw new Error('Signal type is not allow-listed.');if(signal.type==='verified-memory-reference'&&!/^[a-f0-9]{64}$/.test(signal.payloadSha256||''))throw new Error('Verified memory circulates by content hash only.');if(this.queue.length>=this.maximumSignals)throw new Error('Circulation pressure limit reached; new work is inhibited, not dropped.');const payloadSha256=hash(payload);if(signal.payloadSha256&&signal.payloadSha256!==payloadSha256)throw new Error('Circulating payload custody mismatch.');const envelope=Object.freeze({schemaVersion:1,projectId:this.projectId,type:signal.type,sourceOrgan:signal.sourceOrgan,targetOrgan:signal.targetOrgan,boundary:signal.boundary,payloadSha256,createdAt:this.now(),proofStageSatisfied:false,promotionAuthorized:false});this.queue.push({envelope,payload:structuredClone(payload)});return envelope;}
  pump(){
    if(this.pumping)return this.pumping;
    this.pumping=this.deliverPending().finally(()=>{this.pumping=null;});
    return this.pumping;
  }
  async deliverPending(){
    const delivered=[];
    // A retained item is acknowledged only after handler output and its audit are valid.
    // This queue is transient; cross-restart custody belongs to DurableOrganismRuntime.
    for(const item of [...this.queue]){
      if(item.state==='quarantined')continue;
      const handler=this.organs[item.envelope.targetOrgan];
      item.attempts=(item.attempts||0)+1;
      if(typeof handler!=='function'){
        item.state=item.attempts>=3?'quarantined':'inhibited-missing-organ-handler';
        const gap={...item.envelope,state:item.state,nextAction:'route-bounded-repair-or-owner-evidence-request',attempts:item.attempts};
        this.audit.push(gap);delivered.push(gap);continue;
      }
      try{
        if(hash(item.payload)!==item.envelope.payloadSha256)throw new Error('Circulating payload custody mismatch.');
        const output=await handler(structuredClone(item.envelope),structuredClone(item.payload));
        if(!output||typeof output!=='object'||Array.isArray(output))throw new Error('Circulation requires bounded object output.');
        if(output.proofStageSatisfied===true||output.promotionAuthorized===true)throw new Error('Circulation cannot satisfy proof or promotion.');
        const result={...item.envelope,state:'delivered',outputSha256:hash(output),output:structuredClone(output)};
        this.audit.push({...result,output:undefined});
        this.queue.splice(this.queue.indexOf(item),1);delivered.push(result);
      }catch(error){
        item.state=item.attempts>=3?'quarantined':'delivery-failed';item.lastError=String(error.message||error);
        this.audit.push({...item.envelope,state:item.state,attempts:item.attempts,failureCode:'CRU-0057',reason:item.lastError});
        throw crucibleError('CRU-0057',`Circulation delivery retained without ACK: ${item.lastError}`);
      }
    }
    return delivered;
  }
  health(){const gaps=this.queue.filter(item=>item.state&&item.state!=='queued');return{projectId:this.projectId,state:gaps.length?'degraded':'healthy',queued:this.queue.length,delivered:this.audit.filter(item=>item.state==='delivered').length,gaps:gaps.map(item=>({targetOrgan:item.envelope.targetOrgan,boundary:item.envelope.boundary,state:item.state,nextAction:'route-bounded-repair-or-owner-evidence-request'})),circulationIsTruthSource:false};}
}
module.exports={SIGNAL_TYPES,CardiopulmonaryCirculation};
