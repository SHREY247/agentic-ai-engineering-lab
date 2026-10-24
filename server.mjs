/** Tiny dependency-free local workshop server. No production claims. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
// Read only project-local env variables. Never send credentials to the browser.
const dotEnv=path.join(ROOT,'.env');
if(fs.existsSync(dotEnv)){
 for(const line of fs.readFileSync(dotEnv,'utf8').split(/\r?\n/)){
  const match=line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^(["'])(.*)\1$/,'$2');
 }
}
const GEMINI=process.env.GEMINI_MODEL||'gemini/gemini-3.5-flash-lite',GROQ=process.env.GROQ_MODEL||'groq/openai/gpt-oss-120b';
const ROLES={Manager:{provider:'Gemini',model:GEMINI},Architect:{provider:'Gemini',model:GEMINI},QA:{provider:'Gemini',model:GEMINI},Backend:{provider:'Groq',model:GROQ},Frontend:{provider:'Groq',model:GROQ}};
const DEFAULT_REQUEST='Implement the student discount section in my cart.';
const DISCOUNT_CRITERIA='PRODUCT OWNER REQUIREMENTS (not an implementation recipe): Add a visible coupon input and Apply action in the cart. STUDENT10 gives 10% off food subtotal of ₹299 or more, rounded to the nearest rupee (₹488 subtotal gives ₹49), maximum ₹100; no discount on delivery. Invalid codes and orders below ₹299 must not receive a discount. Recalculate when bag changes. Use API action apply-coupon with code and items; the server validates item prices from its own menu. The apply-coupon response must include valid (true or false) and discount (a number in ₹, 0 when not valid). Show the discount as a negative bag line; keep the shop working.';
function isStudentDiscountRequest(request){return /STUDENT10|student.{0,35}(coupon|discount|offer)|(coupon|discount).{0,35}student|discount section/i.test(request)}
function resolveRequest(request){return isStudentDiscountRequest(request)?request+'\n'+DISCOUNT_CRITERIA:request}

const RUN_DIR=path.join(ROOT,'runs');

const STATIC=path.join(ROOT,'site');
// The three files the AI team may write, and the facilitator's starter/reference copies.
const FEATURE_FILES={'site/feature.js':'feature.js','api/feature.mjs':'feature.mjs','tests/feature.acceptance.test.mjs':'feature.acceptance.test.mjs'};
const copySet=(set)=>{for(const [target,name] of Object.entries(FEATURE_FILES))fs.writeFileSync(path.join(ROOT,target),fs.readFileSync(path.join(ROOT,'facilitator',set,name),'utf8'))};
const matchesSet=(set)=>Object.entries(FEATURE_FILES).every(([target,name])=>fs.readFileSync(path.join(ROOT,target),'utf8')===fs.readFileSync(path.join(ROOT,'facilitator',set,name),'utf8'));
const featureInstalled=()=>fs.readFileSync(path.join(STATIC,'feature.js'),'utf8')!==fs.readFileSync(path.join(ROOT,'facilitator','starter','feature.js'),'utf8');
// A partial or failed agent run must not make an unverified feature appear in
// the shop. Reference mode is explicit and labelled MANUAL in the office.
function featurePublished(){
 if(!featureInstalled())return false;
 if(mode==='live')return runOutcome==='passed';
 if(mode==='reference')return true;
 if(mode==='preview')return false;
 return mode==='idle'; // For local manual student editing; not a real-agent success claim.
}
const host='127.0.0.1',port=Number(process.env.PORT||4173);
let events=[],mode='idle',running=false,child=null,seq=0,runId=null,runOutcome='idle',featureRequest='',featureStore={};
const event=(actor,title,detail='',type='info')=>{events.push({id:++seq,at:new Date().toLocaleTimeString('en-GB',{hour12:false}),actor,title,detail:String(detail).slice(0,1500),type});if(events.length>150)events.shift()};
function respond(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
function contentType(p){return p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.json')?'application/json':'application/octet-stream'}
function serveFile(res,base,p){const pathname=p.replace(/^\/+/, '');const full=path.resolve(base,pathname);if(!full.startsWith(path.resolve(base)+path.sep)&&full!==path.resolve(base)){res.writeHead(403);res.end();return;}fs.readFile(full,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'content-type':contentType(full),'cache-control':'no-cache'});res.end(data)})}
function reset(){if(running)return false;runOutcome='idle';runId=null;copySet('starter');featureStore={};featureRequest='';events=[];mode='idle';seq=0;return true;}
function runPreview(){if(running)return false;events=[];seq=0;mode='preview';runOutcome='preview';runId=null;running=true;
 const storyline=[
 ['System','Scripted preview','Illustration only. No model API is being called and no file changes.','info'],
 ['Manager','Scripted: feature request received','"Add a coupon box to the bag: STUDENT10 gives 10% off orders of ₹299+, max ₹100."','start'],
 ['Manager','Scripted manager decision','Assign Architect to turn the request into a spec.','decision'],
 ['Manager','Handoff to Architect','Spec first: UI, API, acceptance criteria.','handoff'],
 ['Architect','Spec drafted','FEASIBLE: yes · SLOT: bag · API: apply-coupon · 5 acceptance criteria.','done'],
 ['Manager','Scripted manager decision','Assign QA to write failing tests before any code exists.','decision'],
 ['Manager','Handoff to QA','Tests first.','handoff'],
 ['QA','Acceptance tests written (failing, as expected)','6 tests; all fail because no feature exists yet.','test'],
 ['Manager','Scripted manager decision','Assign Backend: the UI depends on the API.','decision'],
 ['Manager','Handoff to Backend','Backend work assigned.','handoff'],
 ['Backend','Ran tests after writing','First attempt: 1 API test fails (cap was wrong). Agent reads the failure and fixes it.','tool'],
 ['Backend','Ran tests after writing','Second attempt: all API tests pass.','done'],
 ['Manager','Scripted manager decision','Assign Frontend to build the coupon panel.','decision'],
 ['Manager','Handoff to Frontend','Frontend work assigned.','handoff'],
 ['Frontend','Ran tests after writing','All UI tests pass.','done'],
 ['Manager','Scripted manager decision','Assign QA to run every test.','decision'],
 ['Manager','Handoff to QA','Verification assigned.','handoff'],
 ['QA','Scripted test report','In a real run, the real test runner reports here.','test'],
 ['System','Preview complete','Nothing was changed. Start a real run to let the agents build a feature.','complete']
 ];
 let idx=0;const timer=setInterval(()=>{if(idx>=storyline.length){clearInterval(timer);running=false;return}event(...storyline[idx++])},650);return true;
}
function readBody(req,limit){return new Promise((resolve,reject)=>{let data='';req.on('data',c=>{data+=c;if(data.length>limit){reject(new Error('too large'));req.destroy()}});req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch(e){reject(e)}});req.on('error',reject)})}
// Runs the AI-written backend (api/feature.mjs) in a worker thread with a time
// limit, so a crash or an infinite loop in generated code cannot take down the shop.
function runFeature(action,body){return new Promise(resolve=>{
 const file=path.join(ROOT,'api','feature.mjs');
 const workerData={url:pathToFileURL(file).href+'?v='+fs.statSync(file).mtimeMs,catalogUrl:pathToFileURL(path.join(STATIC,'catalog.js')).href,action,body,store:featureStore};
 const code="const {parentPort,workerData:w}=require('node:worker_threads');(async()=>{try{const {handle}=await import(w.url);const {PRODUCTS}=await import(w.catalogUrl);const ctx={products:PRODUCTS,store:w.store};const result=await handle(w.action,w.body,ctx);parentPort.postMessage({ok:true,result:JSON.parse(JSON.stringify(result??{})),store:ctx.store})}catch(e){parentPort.postMessage({ok:false,error:String(e&&e.message||e)})}})()";
 const worker=new Worker(code,{eval:true,workerData,resourceLimits:{maxOldGenerationSizeMb:64}});
 const done=(status,payload)=>{clearTimeout(timer);worker.terminate();resolve({status,body:payload})};
 const timer=setTimeout(()=>done(500,{status:500,error:'Feature timed out'}),2000);
 worker.once('message',m=>{if(!m.ok)return done(500,{status:500,error:'Feature error: '+m.error});if(m.store&&typeof m.store==='object')featureStore=m.store;const st=Number.isInteger(m.result.status)&&m.result.status>=200&&m.result.status<600?m.result.status:200;done(st,m.result)});
 worker.once('error',e=>done(500,{status:500,error:'Feature error: '+e.message}));
})}
function liveManagerState(){
 if(!runId||mode!=='live')return {decisions:[],state:null};
 const dir=path.join(RUN_DIR,runId);
 const safeRead=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))}catch{return fallback}};
 return {decisions:safeRead('manager-decisions.json',[]),state:safeRead('supervisor-state.json',null)};
}
function runCrew(request){if(running)return {ok:false,error:'Another run is active.'};request=String(request||DEFAULT_REQUEST).replace(/\s+/g,' ').trim();if(request.length<12||request.length>600)return {ok:false,error:'Describe the feature in 12–600 characters.'};if(!process.env.GROQ_API_KEY||!(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY))return {ok:false,error:'Both GROQ_API_KEY and GEMINI_API_KEY are required for the two-provider Crew. Put them in local .env; never share keys with students.'};if(!matchesSet('starter'))return {ok:false,error:'A feature is already installed. Click Reset before a new run.'};
 featureRequest=request;const resolvedRequest=resolveRequest(request);featureStore={};events=[];seq=0;running=true;mode='live';runOutcome='running';runId=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+randomUUID().slice(0,7);event('System','Starting real manager-led Gemini + Groq CrewAI run','Feature request: '+request,'start');if(isStudentDiscountRequest(request))event('System','Product-owner ticket attached','Discount rules supplied as acceptance criteria. Agents choose the implementation.','info');
 child=spawn(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['-u','agent_demo/crew.py'],{cwd:ROOT,env:{...process.env,PYTHONUNBUFFERED:'1',PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',CAMPUSBITES_RUN_ID:runId,CAMPUSBITES_FEATURE_REQUEST:resolvedRequest,CAMPUSBITES_STUDENT_DISCOUNT_DEMO:isStudentDiscountRequest(request)?'1':'0'},stdio:['ignore','pipe','pipe']});let pending='';child.stdout.on('data',chunk=>{pending+=chunk.toString();let lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){if(line.startsWith('EVENT ')){try{const d=JSON.parse(line.slice(6));event(d.actor||'System',d.title||'',d.detail||'',d.type||'info')}catch{}}}});
 let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-5000)});child.on('error',err=>{event('System','Could not launch CrewAI',err.message,'error');runOutcome='failed';running=false;child=null});child.on('close',code=>{runOutcome=code===0?'passed':'failed';const scrub=x=>Object.entries({GROQ_API_KEY:process.env.GROQ_API_KEY,GEMINI_API_KEY:process.env.GEMINI_API_KEY,GOOGLE_API_KEY:process.env.GOOGLE_API_KEY}).reduce((a,[,key])=>key?a.replaceAll(key,'[REDACTED]'):a,x);event('System',code===0?'Crew passed release gate':'Crew failed release gate',code===0?'Inspect source diffs and independently executed tests in Run Evidence.':scrub(stderr.slice(-550)||`Exit code ${code}`),code===0?'complete':'error');running=false;child=null});return {ok:true};}
const server=http.createServer((req,res)=>{const url=new URL(req.url,`http://${host}:${port}`);
 if(url.pathname==='/api/release-status')return respond(res,200,{available:featurePublished(),source:mode==='reference'?'manual-reference':mode==='live'?(runOutcome==='passed'?'verified-live':'not-yet-verified'):'local-developer-mode',outcome:runOutcome});
 if(url.pathname==='/api/state')return respond(res,200,{events,running,mode,runId,runOutcome,roles:ROLES,manager:liveManagerState(),credentialsPresent:{groq:!!process.env.GROQ_API_KEY,gemini:!!(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY)},featureEnabled:featurePublished(),featureWritten:featureInstalled(),featureRequest,defaultRequest:DEFAULT_REQUEST});
 if(url.pathname==='/api/audit'){
  if(!runId)return respond(res,404,{error:'No real model run has been started. Scripted preview is not audit evidence.'});
  const dir=path.join(RUN_DIR,runId);
  const read=(name)=>{try{return fs.readFileSync(path.join(dir,name),'utf8')}catch{return null}};
  const summary=read('summary.json');
  return respond(res,200,{runId,mode,runOutcome,summary:summary?JSON.parse(summary):null,
   events:JSON.parse(read('events.json')||'[]'),managerDecisions:JSON.parse(read('manager-decisions.json')||'[]'),supervisorState:JSON.parse(read('supervisor-state.json')||'null'),
   spec:read('spec.md'),architect:read('architect-result.txt'),backend:read('backend-result.txt'),frontend:read('frontend-result.txt'),qa:read('qa-result.txt'),
   backendPatch:read('backend.patch'),frontendPatch:read('frontend.patch'),testsPatch:read('qa.patch'),qaTests:read('qa-tests.txt'),independentGate:read('release-gate.txt')});
 }
 if(req.method==='POST'&&url.pathname.startsWith('/api/feature/')){
  const action=decodeURIComponent(url.pathname.slice('/api/feature/'.length));
  if(!/^[a-z0-9_-]{1,40}$/i.test(action))return respond(res,400,{status:400,error:'Invalid action name'});
  readBody(req,8192).then(body=>runFeature(action,body)).then(r=>respond(res,r.status,r.body)).catch(()=>respond(res,400,{status:400,error:'Invalid JSON body'}));return;
 }
 if(req.method==='POST'&&url.pathname==='/api/preview')return respond(res,runPreview()?200:409,{ok:running,mode});
 if(req.method==='POST'&&url.pathname==='/api/run'){readBody(req,4096).then(body=>{const result=runCrew(body?.request);respond(res,result.ok?200:400,result)}).catch(()=>respond(res,400,{ok:false,error:'Invalid request'}));return}
 if(req.method==='POST'&&url.pathname==='/api/reset'){const ok=reset();return respond(res,ok?200:409,{ok})}
 if(req.method==='POST'&&url.pathname==='/api/apply-reference'){if(running)return respond(res,409,{ok:false,error:'Wait for the current run to finish.'});copySet('reference');featureStore={};featureRequest=DEFAULT_REQUEST;mode='reference';runOutcome='manual';runId=null;events=[];seq=0;event('Facilitator','Reference feature applied (Student coupon)','Manual copy of facilitator/reference — not an AI execution.','done');return respond(res,200,{ok:true})}
 if(url.pathname==='/office')return serveFile(res,ROOT,'office.html');
 if(url.pathname==='/office.css')return serveFile(res,ROOT,'office.css');
 if(url.pathname==='/office.js')return serveFile(res,ROOT,'office.js');
 if(url.pathname==='/studio')return serveFile(res,ROOT,'studio.html');
 if(url.pathname==='/studio.css')return serveFile(res,ROOT,'studio.css');
 if(url.pathname==='/studio.js')return serveFile(res,ROOT,'studio.js');
 return serveFile(res,STATIC,url.pathname==='/'?'index.html':url.pathname)
});
server.listen(port,host,()=>console.log(`CampusBites http://${host}:${port}\nAI Office http://${host}:${port}/office\nAI Team Studio http://${host}:${port}/studio`));
