'use strict';
// Governed NVIDIA-only model-selection for R3 URL-pointer discovery.
// This module does not grant source authority, turn pointers into citations, or access paid providers.
const crypto = require('node:crypto');
const { endpointFor } = require('./aiProviderRegistry');

const DEFAULT_FREE_IDS = Object.freeze([
  'z-ai/glm-5.3-flash',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'meta/muse-glimmer-30b',
]);
const MODEL_ID = /^[a-z\d][a-z\d._-]{0,63}\/[a-z\d][a-z\d._-]{0,95}$/i;
const PROBE_PROMPT = 'For software supply-chain security research, provide two official HTTPS URLs to technical standards or project documentation on .gov or .org domains. URLs only. No explanation. These URLs will be verified independently.';
const ALLOWED_SUFFIXES = ['.gov', '.org', '.edu'];

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function boundedInteger(value, fallback, min, max, label) {
  const num = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) throw new Error(`R3 model selector: ${label} must be ${min}–${max}`);
  return num;
}
function requirements(env = {}) {
  // Different model choices may not weaken any of these Crucible invariants.
  return Object.freeze({ role:'candidate-url-pointer-discovery', provider:'nvidia-nim', protocol:'chat-completions',
    outputs:'HTTPS-authoritative-source-URL-pointers', allowlistedSuffixes:ALLOWED_SUFFIXES,
    sourceClassification:'Insufficient Evidence', corroborationAuthority:false, promotionAuthority:false,
    maxProbes:boundedInteger(env.NVIDIA_NIM_MAX_PROBES, 3, 1, 3, 'max probes'),
    maxDiscoveryTokens:boundedInteger(env.CRUCIBLE_DISCOVERY_MAX_OUTPUT_TOKENS, 1024, 128, 2048, 'max output tokens'),
    maxRequestMs:boundedInteger(env.CRUCIBLE_DISCOVERY_REQUEST_TIMEOUT_MS, 90000, 10000, 120000, 'request timeout'),
    billing:'pre-approved-free-endpoint-only' });
}
function urlPointers(text) {
  const matches = String(text || '').match(/https:\/\/[^\s<>"'`)\]}]+/g) || [];
  return [...new Set(matches.map(v=>v.replace(/[.,;:!?'"`]+$/, '')))].slice(0,10).filter(value => {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ALLOWED_SUFFIXES.some(s => u.hostname.toLowerCase().endsWith(s)); }
    catch { return false; }
  });
}
function allowedFreeIds(env) {
  const custom = String(env.NVIDIA_NIM_FREE_MODELS || '').trim();
  if (!custom) return [...DEFAULT_FREE_IDS];
  const ids = custom.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 15 || ids.some(x => !MODEL_ID.test(x)) || new Set(ids).size !== ids.length) throw new Error('Invalid approved-free model allowlist');
  return ids;
}
function modelInventoryUrl(env) {
  const endpoint = new URL(endpointFor('nvidia-nim', env));
  // Secret is never sent to another host or following redirects through this selector.
  const approvedHost = 'integrate.api.nvidia.com'; // Host is fixed: never send credentials to an environment-selected host.
  if (endpoint.protocol !== 'https:' || endpoint.hostname.toLowerCase() !== approvedHost || !endpoint.pathname.endsWith('/chat/completions') || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('Model inventory endpoint is not approved');
  endpoint.pathname = endpoint.pathname.slice(0, -'/chat/completions'.length) + '/models';
  return endpoint.toString();
}
function retirementError(error) {
  const msg = String(error?.message || error);
  return /(?:HTTP\s*410\b|HTTP\s*404\b[^\n]{0,240}\b(?:model|deployment|not\s+found)\b|\bmodel\s+(?:not\s+found|unavailable|retired|deprecated)\b)/i.test(msg);
}
function authorizationOrQuotaError(error) {
  return /(?:HTTP\s*(?:401|403|429)\b|insufficient[_ -]?quota|rate[_ -]?limit)/i.test(String(error?.message || error));
}

class NvidiaModelAutoSelector {
  constructor({ env=process.env, adapter, fetchImpl=globalThis.fetch, now=()=>new Date().toISOString(), onDiagnostic=()=>{} }={}) {
    if (!adapter?.run || typeof fetchImpl !== 'function') throw new Error('Model selector requires adapter and network transport');
    this.env=env; this.adapter=adapter; this.fetch=fetchImpl; this.now=now; this.log=onDiagnostic;
    this.requirements=requirements(env); this.approved=allowedFreeIds(env);
    this.inventory=null; this.selected=null; this.retired=new Set(); this.audit=[];
    this.probesUsed=0; this.ranked=[];
  }
  record(event, details={}) {
    const item = { at:this.now(), event, requirementsSha256:sha256(JSON.stringify(this.requirements)),
      ...details, authorizesPromotion:false };
    this.audit.push(item); this.log(item); return item;
  }
  async list() {
    const key=String(this.env.NVIDIA_NIM_API_KEY||'').trim();
    if (!key) throw new Error('NVIDIA_NIM_API_KEY missing; no model selected');
    const uri=modelInventoryUrl(this.env);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.min(10000,this.requirements.maxRequestMs));
    let response, raw;
    try {
      response=await this.fetch(uri,{method:'GET',headers:{authorization:`Bearer ${key}`,accept:'application/json'},signal:controller.signal,redirect:'error'});
      const announced = Number(response?.headers?.get?.('content-length') || 0);
      if (announced > 1000000) throw new Error('Inventory response is too large');
      raw=await response.text();
    } catch (e) { this.record('MODEL_INVENTORY_FAILED',{reason:'network_or_timeout'}); throw new Error('NVIDIA model inventory unavailable; discovery held'); }
    finally { clearTimeout(timer); }
    if (!response || response.status!==200 || raw.length>1000000) { this.record('MODEL_INVENTORY_FAILED',{status:response?.status||null}); throw new Error(`NVIDIA model inventory rejected (${response?.status||'invalid'})`); }
    let value;
    try { value=JSON.parse(raw); } catch { throw new Error('NVIDIA model inventory returned invalid JSON'); }
    if (!Array.isArray(value.data)) throw new Error('NVIDIA model inventory lacks model data');
    const observed=new Set(value.data.filter(x=>x && typeof x.id==='string' && MODEL_ID.test(x.id)).map(x=>x.id));
    const eligible=this.approved.filter(id=>observed.has(id) && !this.retired.has(id));
    this.inventory=eligible;
    this.record('MODEL_INVENTORY_OBSERVED',{ availableApproved:eligible, approvedMissing:this.approved.filter(id=>!observed.has(id)), unapprovedCount:[...observed].filter(id=>!this.approved.includes(id)).length, inventoryDigest:sha256(raw) });
    if (!eligible.length) throw new Error('No currently listed and preapproved free NIM model; needs governed free-eligibility review');
    return eligible;
  }
  async select() {
    if (this.selected && !this.retired.has(this.selected)) return this.selected;
    const eligible=await this.list();
    const preferred=String(this.env.NVIDIA_NIM_MODEL||'').trim();
    const order=preferred && eligible.includes(preferred) ? [preferred,...eligible.filter(x=>x!==preferred)] : eligible;
    const outcomes=this.ranked.filter(item=>eligible.includes(item.model));
    const remaining=this.requirements.maxProbes-this.probesUsed;
    for (const model of order.filter(id=>!outcomes.some(item=>item.model===id)).slice(0,remaining)) {
      this.probesUsed+=1;
      const start=Date.now();
      try {
        const answer=await this.adapter.run({prompt:PROBE_PROMPT,model});
        const pointers=urlPointers(answer.text);
        const latency=Date.now()-start;
        if (answer.model && answer.model !== model) { this.record('MODEL_PROBE_FAILED',{model,reason:'unexpected_served_model'}); continue; }
        if (!pointers.length) { this.record('MODEL_PROBE_FAILED',{model,reason:'no_authoritative_https_pointers'}); continue; }
        const score=pointers.length*100 - latency/1000 + (model===preferred?5:0);
        outcomes.push({model,score,latency,pointerCount:pointers.length});
        this.record('MODEL_PROBE_PASSED',{model,latencyMs:latency,pointerCount:pointers.length});
      } catch(e) {
        if (authorizationOrQuotaError(e)) { this.record('MODEL_PROBE_BLOCKED',{model,reason:'auth_or_quota'}); throw new Error('NVIDIA authentication/quota failure; do not bypass to other billed provider'); }
        if (retirementError(e)) this.retired.add(model);
        this.record('MODEL_PROBE_FAILED',{model,reason:retirementError(e)?'retired_or_unavailable':'invalid_or_timed_out'});
      }
    }
    if (!outcomes.length) throw new Error('No preapproved listed NVIDIA model passed bounded R3 probe');
    outcomes.sort((a,b)=>b.score-a.score || a.model.localeCompare(b.model));
    this.ranked=outcomes;
    this.selected=outcomes[0].model;
    this.record('MODEL_SELECTED',{model:this.selected,probeScore:outcomes[0].score, optionsProbed:outcomes.length});
    return this.selected;
  }
  async run(prompt) {
    for(let attempt=0;attempt<2;attempt++) {
      const model=await this.select();
      try {
        const response=await this.adapter.run({prompt,model});
        if (!String(response?.text||'').trim()) throw new Error('empty completion');
        if (response.model && response.model !== model) throw new Error('NVIDIA served unexpected model identity');
        return { ...response, model:response.model || model };
      } catch(e) {
        if (authorizationOrQuotaError(e)) throw e;
        if (!(retirementError(e) && attempt===0)) throw e;
        this.retired.add(model); this.selected=null;
        this.record('MODEL_RETIRED_DURING_RUN',{model,reason:'not_found_or_gone'});
      }
    }
    throw new Error('Model fallback exhausted');
  }
}
module.exports={NvidiaModelAutoSelector,requirements,allowedFreeIds,modelInventoryUrl,retirementError,authorizationOrQuotaError,urlPointers,DEFAULT_FREE_IDS,PROBE_PROMPT};
