// Renders /demo to an MP4, frame by frame, with its synthesized soundtrack.
// Needs the server running, Google Chrome and ffmpeg. No npm packages.
//   node scripts/render-film.mjs [output.mp4] [--fps 30] [--url http://127.0.0.1:4173/demo]
//   60-second cut: --url 'http://127.0.0.1:4173/demo?cut=short'
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args.splice(i,2)[1]:fallback};
const fps=Number(opt('--fps',30));
const base=opt('--url','http://127.0.0.1:4173/demo');
const url=base+(base.includes('?')?'&':'?')+'render=1';
const output=path.resolve(args[0]||'campusbites-film.mp4');
const chrome=process.env.CHROME||'google-chrome';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'film-'));

// ---- Chrome DevTools protocol over --remote-debugging-pipe ----
const browser=spawn(chrome,['--headless=new','--remote-debugging-pipe','--no-sandbox','--hide-scrollbars','--mute-audio','--disable-gpu','--window-size=1920,1080','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
const toChrome=browser.stdio[3],fromChrome=browser.stdio[4];
let nextId=1,buffer='';const pending=new Map();
fromChrome.on('data',(chunk)=>{
  buffer+=chunk.toString();let end;
  while((end=buffer.indexOf('\0'))>=0){
    const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
    const p=pending.get(msg.id);if(!p)continue;pending.delete(msg.id);
    msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);
  }
});
function send(method,params={},sessionId){
  const id=nextId++;toChrome.write(JSON.stringify({id,method,params,sessionId})+'\0');
  return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
}
let session;
const page=(method,params)=>send(method,params,session);
async function evaluate(expression){
  const r=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
}

const {targetId}=await send('Target.createTarget',{url:'about:blank'});
({sessionId:session}=await send('Target.attachToTarget',{targetId,flatten:true}));
await page('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await page('Page.enable');
await page('Page.navigate',{url});
for(let i=0;!(await evaluate('window.__ready===true').catch(()=>false));i++){
  if(i>200)throw new Error(`Film did not load from ${url}. Is the server running?`);
  await new Promise(r=>setTimeout(r,100));
}

// ---- frames -> ffmpeg ----
const silent=path.join(tmp,'video.mp4');
const encoder=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','-','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p',silent],{stdio:['pipe','inherit','inherit']});
const encoded=new Promise((resolve,reject)=>encoder.on('close',c=>c===0?resolve():reject(new Error('ffmpeg failed: '+c))));
const started=Date.now();
for(let frame=0;;frame++){
  const done=await evaluate(`__step(${1000/fps})`);
  const {data}=await page('Page.captureScreenshot',{format:'jpeg',quality:94});
  if(!encoder.stdin.write(Buffer.from(data,'base64')))await new Promise(r=>encoder.stdin.once('drain',r));
  if(frame%fps===0)process.stdout.write(`\r${(frame/fps).toFixed(0)}s of film rendered (${((Date.now()-started)/1000).toFixed(0)}s elapsed)`);
  if(done)break;
}
encoder.stdin.end();await encoded;
console.log('\nVideo frames encoded. Rendering soundtrack…');

// ---- soundtrack ----
const size=await evaluate('__audio()'),chunk=1<<20,wav=path.join(tmp,'audio.wav');
const parts=[];for(let i=0;i*chunk<size;i++)parts.push(Buffer.from(await evaluate(`__wavChunk(${i},${chunk})`),'base64'));
fs.writeFileSync(wav,Buffer.concat(parts));
browser.kill();

await new Promise((resolve,reject)=>spawn('ffmpeg',['-y','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',output],{stdio:'inherit'}).on('close',c=>c===0?resolve():reject(new Error('mux failed'))));
fs.rmSync(tmp,{recursive:true,force:true});
console.log('Saved',output);
