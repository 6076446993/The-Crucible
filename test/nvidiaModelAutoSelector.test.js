'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// Use the real registry; only outbound NVIDIA transport is substituted.
const {NvidiaModelAutoSelector,requirements,allowedFreeIds,modelInventoryUrl,retirementError,urlPointers}=require('../src/nvidiaModelAutoSelector');
const A='z-ai/glm-5.3-flash',B='nvidia/nemotron-3-super-120b-a12b',C='nvidia/nemotron-3-ultra-550b-a55b',RETIRED='nvidia/nemotron-3-nano-30b-a3b';
const good='https://www.nist.gov/itl/ai-risk-management-framework https://owasp.org/www-project-top-ten/';
function env(v={}) {return {NVIDIA_NIM_API_KEY:'fake-key-local-only',NVIDIA_NIM_MODEL:A,...v};}
function fake({listed=[A,B,C],bad={},probe={},onRequest=()=>{}}={}){
 const calls=[];
 const adapter={async run({model,prompt}){calls.push({model,prompt});if(bad[model]){const e=new Error(bad[model]);delete bad[model];throw e;};return {model,text:probe[model]??good,evidence:[]}}};
 const fetch=async(url,options)=>{onRequest(url,options);return {status:200,text:async()=>JSON.stringify({object:'list',data:listed.map(id=>({id,object:'model'}))})};};
 return {adapter,fetch,calls};
}
function selector(set, overrides={}){return new NvidiaModelAutoSelector({env:env(overrides),adapter:set.adapter,fetchImpl:set.fetch,now:()=> '2026-10-11T20:00:00Z'});}
test('Crucible requirements deny truth or promotion authority',()=>{const r=requirements(env());assert.equal(r.promotionAuthority,false);assert.equal(r.corroborationAuthority,false);assert.equal(r.billing,'pre-approved-free-endpoint-only');});
test('model URL derived from same approved endpoint with no credential redirect',()=>{assert.equal(modelInventoryUrl(env()),'https://integrate.api.nvidia.com/v1/models');assert.equal(modelInventoryUrl(env({NVIDIA_NIM_BASE_URL:'https://integrate.api.nvidia.com/v1'})),'https://integrate.api.nvidia.com/v1/models');});
test('credentials never sent to unexpected model inventory hosts',()=>assert.throws(()=>modelInventoryUrl(env({NVIDIA_NIM_BASE_URL:'https://attacker.example/v1'}))));
test('query, hash, user info and plaintext non-HTTPS endpoints rejected',()=>{for(const x of ['http://integrate.api.nvidia.com/v1','https://integrate.api.nvidia.com/v1?x=1',['https://name:pass','integrate.api.nvidia.com/v1'].join('@')])assert.throws(()=>modelInventoryUrl(env({NVIDIA_NIM_BASE_URL:x})));});
test('unknown models discovered but never probed or switched to',async()=>{const f=fake({listed:[RETIRED,'bad/random-paid',B]});const s=selector(f);assert.equal(await s.select(),B);assert.deepEqual(f.calls.map(c=>c.model),[B]);assert.equal(s.audit[0].unapprovedCount,2);});
test('automatically selects nonretired approved model',async()=>{const f=fake({listed:[B,C]});const s=selector(f);assert.ok([B,C].includes(await s.select()));});
test('the preferred model is scored, not blindly used',async()=>{const f=fake({probe:{[A]:'https://nist.gov/x',[B]:good,[C]:'no valid pointers'}});const s=selector(f);assert.equal(await s.select(),B);});
test('chooses only when an allowed HTTPS URL pointer appears',async()=>{const f=fake({probe:{[A]:'There are no citations',[B]:'http://example.edu text https://example.com',[C]:'https://evil.com/'}});await assert.rejects(()=>selector(f).select(),/No preapproved/);});
test('provider citations are not independently verified',async()=>{const f=fake();const s=selector(f);await s.select();assert.equal(s.requirements.sourceClassification,'Insufficient Evidence');assert.equal(s.audit.at(-1).authorizesPromotion,false);});
test('unavailable configured model is automatically skipped',async()=>{const f=fake({listed:[B]});const s=selector(f);assert.equal(await s.select(),B);});
test('retired model rejection during probe switches model',async()=>{const f=fake({bad:{[A]:'HTTP 410 model retired'}});const s=selector(f);assert.ok([B,C].includes(await s.select()));assert.equal(s.retired.has(A),true);assert.notEqual(s.selected,A);});
test('404 model-not-found during actual work retries once with safe alternate',async()=>{const f=fake();const s=selector(f);await s.select();const old=s.selected;f.adapter.run=async({model,prompt})=>{if(model===old)throw Error('NVIDIA NIM HTTP 404 model not found');return {model,text:good,evidence:[]}};const res=await s.run('real topic');assert.notEqual(res.model,old);assert.equal(s.retired.has(old),true);});
test('authorization errors do not activate fallback',async()=>{const f=fake({bad:{[A]:'HTTP 401 invalid key'}});await assert.rejects(()=>selector(f).select(),/authentication\/quota/);assert.equal(f.calls.length,1);});
test('429 quota errors do not trigger workaround or paid provider',async()=>{const f=fake({bad:{[A]:'HTTP 429 rate limit'}});await assert.rejects(()=>selector(f).select(),/authentication\/quota/);assert.equal(f.calls.length,1);});
test('model inventory unsupported fails closed',async()=>{const f=fake();f.fetch=async()=>({status:404,text:async()=>''});await assert.rejects(()=>selector(f).select(),/inventory rejected/);});
test('all approved models retired holds rather than invents one',async()=>{const f=fake({listed:[RETIRED]});await assert.rejects(()=>selector(f).select(),/No currently listed/);});
test('no credential never calls provider or inventory',async()=>{let count=0;const f=fake({onRequest:()=>count++});const s=selector(f,{NVIDIA_NIM_API_KEY:''});await assert.rejects(()=>s.select(),/missing/);assert.equal(count,0);});
test('invalid allowlist cannot sneak in arbitrary endpoint ids',()=>{for(const value of ['evil','a/b,a/b','../x','a/b,https://attacker.com'])assert.throws(()=>allowedFreeIds(env({NVIDIA_NIM_FREE_MODELS:value})));});
test('latency, token, probe bounds enforce budget caps',()=>{for(const pair of [{NVIDIA_NIM_MAX_PROBES:99},{CRUCIBLE_DISCOVERY_REQUEST_TIMEOUT_MS:999999},{CRUCIBLE_DISCOVERY_MAX_OUTPUT_TOKENS:4096}])assert.throws(()=>requirements(env(pair)));});
test('catalog payload malformed is blocked',async()=>{const f=fake();f.fetch=async()=>({status:200,text:async()=>'<html/>'});await assert.rejects(()=>selector(f).select(),/invalid JSON/);});
test('external catalog includes unapproved free-looking model, still blocked',async()=>{const f=fake({listed:['attacker/model','unknown/instruct']});await assert.rejects(()=>selector(f).select(),/No currently listed/);});
test('URLs are no implicit truth: only HTTPS approved suffix survives preliminary filter',()=>{assert.deepEqual(urlPointers('https://bad.com/a https://nist.gov/path https://example.edu/b http://owasp.org https://attacker.org.evil.com/a'),['https://nist.gov/path','https://example.edu/b']);});
test('no model repeat probes for same work session',async()=>{const f=fake();const s=selector(f);await s.run('topic 1');const n=f.calls.length;await s.run('topic 2');assert.equal(f.calls.length,n+1);});
test('diagnostics describe selected model but never leak API key',async()=>{const f=fake();const s=selector(f);await s.run('hi');assert.ok(!JSON.stringify(s.audit).includes('fake-key-local-only'));});
test('cannot switch to unapproved paid provider through model id',async()=>{const f=fake({listed:['openai/gpt-5',RETIRED]});await assert.rejects(()=>selector(f).select(),/No currently listed/);});
test('retirement classification distinguishes failure from quota',()=>{assert.equal(retirementError(new Error('HTTP 410')),true);assert.equal(retirementError(new Error('HTTP 429')),false);});

test('an unrelated HTTP 404 is not automatically classified as model retirement',()=>{
  assert.equal(retirementError(new Error('HTTP 404 route unavailable')),false);
  assert.equal(retirementError(new Error('HTTP 404 model not found')),true);
  assert.equal(retirementError(new Error('HTTP 410 retired')),true);
});
test('environment override cannot redirect the inventory bearer token',()=>{
  assert.throws(()=>modelInventoryUrl(env({NVIDIA_NIM_MODEL_DISCOVERY_HOST:'evil.example',NVIDIA_NIM_BASE_URL:'https://evil.example/v1'})));
});
test('inventory rejects oversized declared body before loading text',async()=>{
  const f=fake();let loaded=false;
  f.fetch=async()=>({status:200,headers:{get:()=> '1000001'},text:async()=>{loaded=true;return '{}';}});
  await assert.rejects(()=>selector(f).select(),/inventory unavailable/);
  assert.equal(loaded,false);
});

test('retirement recovery reuses ranked survivors without exceeding the session probe budget',async()=>{
  const f=fake(); const s=selector(f);
  await s.select(); const retired=s.selected;
  let workCalls=0;
  f.adapter.run=async({model})=>{workCalls++; if(model===retired)throw Error('HTTP 410 model retired');return {model,text:good};};
  const result=await s.run('bounded real topic');
  assert.notEqual(result.model,retired);
  assert.equal(s.probesUsed,3);
  assert.equal(f.calls.length,3);
  assert.equal(workCalls,2);
});

test('exhausted probe budget holds when no previously qualified survivor exists',async()=>{
  const f=fake();const s=selector(f,{NVIDIA_NIM_MAX_PROBES:1});
  await s.select(); const retired=s.selected;
  f.adapter.run=async()=>{throw Error('HTTP 410 model retired');};
  await assert.rejects(()=>s.run('topic'),/No preapproved/);
  assert.equal(s.probesUsed,1);
  assert.equal(f.calls.length,1);
  assert.equal(s.retired.has(retired),true);
});

test('zero due topics never reports an automatic probe that did not execute',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {run}=require('../src/automatedModelPointerResearchCli');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-nvidia-empty-due-'));
  try {
    const reports=[];
    await run(['run','Cybersecurity'],env({NVIDIA_NIM_MODEL_POLICY:'auto',CRUCIBLE_DISCOVERY_PROVIDER:'nvidia-nim',CRUCIBLE_LEARNING_PROJECT_ID:'nvidia-empty-due-test',CRUCIBLE_LEARNING_ROOT:root,CRUCIBLE_SOURCE_QUEUE:path.join(root,'queue.json')}),value=>reports.push(JSON.parse(value)),{client:{search:async()=>{throw Error('No network expected');}},research:{runDue:async()=>[]}});
    const report=reports.at(-1);
    assert.equal(report.modelSelection,'NVIDIA_AUTO_NOT_RUN');
    assert.deepEqual(report.modelsUsed,[]);
    assert.equal(report.searched,0);
    assert.equal(report.authorizesPromotion,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
