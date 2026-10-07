'use strict';
const https=require('node:https');
const CRU='CRU-0056',STALE_MS=20*60*1000;
const newest=(a,p=()=>true)=>(a||[]).filter(p).sort((x,y)=>new Date(y.updated_at||y.created_at)-new Date(x.updated_at||x.created_at))[0]||null;
const after=(r,b)=>!!r&&!!b&&new Date(r.created_at)>=new Date(b.updated_at||b.created_at);
function evaluatePipeline({workerRuns,oversightRuns,proofRuns,now=Date.now()}){
 const w=newest(workerRuns,r=>r.status==='completed'); if(!w)return{state:'blocked',code:CRU,reason:'No completed Worker run.'};
 if(w.conclusion!=='success')return{state:'repair-required',code:CRU,stage:'worker',runId:w.id,reason:'Latest Worker run failed.'};
 const o=newest(oversightRuns,r=>r.status==='completed'&&after(r,w));
 if(!o){return now-new Date(w.updated_at||w.created_at)>STALE_MS?{state:'repair-required',code:CRU,stage:'oversight-handoff',runId:w.id,reason:'No completed Oversight run followed Worker within 20 minutes.'}:{state:'waiting',stage:'oversight-handoff',runId:w.id};}
 if(o.conclusion!=='success')return{state:'repair-required',code:CRU,stage:'oversight',runId:o.id,reason:'Fresh Oversight failed.'};
 const p=newest(proofRuns,r=>after(r,o)); if(!p)return{state:'dispatch-proof',oversightRunId:o.id};
 if(p.status!=='completed')return{state:'waiting',stage:'crucible-proof',runId:p.id};
 if(p.conclusion!=='success')return{state:'repair-required',code:CRU,stage:'crucible-proof',runId:p.id,reason:'Fresh durable proof failed.'};
 return{state:'healthy',workerRunId:w.id,oversightRunId:o.id,proofRunId:p.id};
}
function api(url,{method='GET',token,body}={}){return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null,req=https.request(url,{method,headers:{Accept:'application/vnd.github+json','User-Agent':'crucible-native-monitor','X-GitHub-Api-Version':'2022-11-28',Authorization:`Bearer ${token}`,'Content-Type':'application/json'}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>res.statusCode>=200&&res.statusCode<300?resolve(s?JSON.parse(s):{}):reject(new Error(`GitHub HTTP ${res.statusCode}: ${s.slice(0,400)}`)));});req.on('error',reject);if(data)req.write(data);req.end();});}
async function runs(repo,wf,token,branch){const q=new URLSearchParams({per_page:'20'});if(branch)q.set('branch',branch);return(await api(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?${q}`,{token})).workflow_runs||[];}
async function runGithubMonitor(token=process.env.GITHUB_TOKEN){if(!token)throw new Error(`[${CRU}] GITHUB_TOKEN missing`);
 const [workerRuns,oversightRuns,proofRuns]=await Promise.all([runs('6076446993/Learning-Worker','extract.yml',token),runs('6076446993/Vetting-and-Governance-oversite.','independent-oversight.yml',token),runs('6076446993/The-Crucible','hosted-learning-proof.yml',token,'development')]);
 const v=evaluatePipeline({workerRuns,oversightRuns,proofRuns});console.log(JSON.stringify(v));
 if(v.state==='dispatch-proof'){await api('https://api.github.com/repos/6076446993/The-Crucible/actions/workflows/hosted-learning-proof.yml/dispatches',{method:'POST',token,body:{ref:'development'}});console.log('[The Crucible] dispatched fresh durable proof');}
 if(v.state==='repair-required'||v.state==='blocked')throw new Error(`[${CRU}] ${v.stage||'monitor'}: ${v.reason}`);return v;}
module.exports={CRU,STALE_MS,evaluatePipeline,runGithubMonitor};
if(require.main===module)runGithubMonitor().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
