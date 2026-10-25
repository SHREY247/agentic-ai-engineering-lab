// CampusBites cinematic office film.
// A scripted replay of real run 20261024095431-4fd735f: manager decisions, timestamps,
// code excerpts and test names come from runs/<id>/; the dialogue is dramatized.
(() => {
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const INITIAL = stage.innerHTML;

function fit(){stage.style.setProperty('--fit',Math.min(innerWidth/1920,innerHeight/1080))}
addEventListener('resize',fit);fit();

// ---- virtual time: every wait() pauses with the film ----
let vt=0,last=performance.now(),paused=false;
let waiters=[];const tickers=new Set();
function frame(now){
  const dt=Math.min(now-last,100);last=now;
  if(!paused){
    vt+=dt;
    const due=waiters.filter(w=>vt>=w.t);waiters=waiters.filter(w=>vt<w.t);due.forEach(w=>w.r());
    tickers.forEach(f=>f());
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// ?seek=ms fast-forwards the script (for previewing a moment, not for recording).
let filmT=0,seekTo=Number(new URLSearchParams(location.search).get('seek')||0);
function wait(ms){filmT+=ms;if(filmT<seekTo)return Promise.resolve();return new Promise(r=>waiters.push({t:vt+ms,r}))}

// ---- sound: everything synthesized, no files ----
const sfx=(()=>{
  let ctx,master,noiseBuf,pad=[];let muted=false;
  function init(){
    if(ctx)return;
    try{ctx=new AudioContext()}catch{return}
    master=ctx.createGain();master.gain.value=.6;master.connect(ctx.destination);
    noiseBuf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  }
  function out(node,t,a,dur,peak){
    const g=ctx.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+a+dur);
    node.connect(g);g.connect(master);return g;
  }
  function tone(type,f,dur,peak=.15,{a=.005,when=0,to}={}){
    if(!ctx)return;const t=ctx.currentTime+when,o=ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(f,t);
    if(to)o.frequency.exponentialRampToValueAtTime(to,t+dur);out(o,t,a,dur,peak);o.start(t);o.stop(t+a+dur+.05);
  }
  function hiss(dur,peak,type,f,{q=1,when=0,to}={}){
    if(!ctx)return;const t=ctx.currentTime+when,s=ctx.createBufferSource();s.buffer=noiseBuf;
    const fl=ctx.createBiquadFilter();fl.type=type;fl.frequency.setValueAtTime(f,t);fl.Q.value=q;if(to)fl.frequency.exponentialRampToValueAtTime(to,t+dur);
    s.connect(fl);out(fl,t,.01,dur,peak);s.start(t,Math.random());s.stop(t+dur+.1);
  }
  return {
    init,ctx:()=>ctx,
    toggle(){muted=!muted;if(master)master.gain.value=muted?0:.6;return muted},
    tick(){hiss(.025,.035,'highpass',3500+Math.random()*2500)},
    voice(p){tone('triangle',p*(0.9+Math.random()*.25),.07,.05)},
    ping(){tone('sine',988,.3,.09);tone('sine',1319,.4,.07,{when:.07})},
    whoosh(){hiss(.7,.16,'bandpass',260,{q:1.4,to:3200})},
    land(){tone('sine',740,.18,.1);tone('sine',1110,.25,.07,{when:.05})},
    boom(){tone('sine',70,2.2,.55,{to:38});hiss(1.2,.12,'lowpass',500,{to:80})},
    hit(){tone('sine',90,.9,.35,{to:45});hiss(.25,.06,'highpass',6000)},
    click(){tone('square',1600,.015,.04);hiss(.04,.05,'bandpass',2200)},
    holo(){tone('sine',420,.35,.05,{to:900})},
    pass(i){tone('triangle',620+i*28,.12,.07)},
    fail(){tone('square',170,.12,.04)},
    beat(){tone('sine',58,.22,.45,{to:40});tone('sine',56,.22,.35,{when:.22,to:40})},
    chord(){[523.25,659.25,783.99,1046.5,1318.5].forEach((f,i)=>tone('sine',f,2.8,.07,{a:.02,when:i*.06}));hiss(1.5,.05,'highpass',8000)},
    shimmer(){[1568,2093,2637,3136].forEach((f,i)=>tone('sine',f,.6,.03,{when:i*.07}))},
    padStart(){
      if(!ctx||pad.length)return;
      const fl=ctx.createBiquadFilter();fl.type='lowpass';fl.frequency.value=360;
      const g=ctx.createGain();g.gain.value=0;g.gain.linearRampToValueAtTime(.05,ctx.currentTime+4);
      fl.connect(g);g.connect(master);
      for(const f of [55,82.41,110.5]){const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=f;o.detune.value=Math.random()*12-6;o.connect(fl);o.start();pad.push(o)}
      const lfo=ctx.createOscillator(),lg=ctx.createGain();lfo.frequency.value=.07;lg.gain.value=160;lfo.connect(lg);lg.connect(fl.frequency);lfo.start();pad.push(lfo);
      pad.filter=fl;pad.gain=g;
    },
    padBright(){if(pad.filter)pad.filter.frequency.linearRampToValueAtTime(1400,ctx.currentTime+3)},
    padStop(){if(pad.gain)pad.gain.gain.linearRampToValueAtTime(0,ctx.currentTime+2.5);const old=pad;pad=[];setTimeout(()=>old.forEach(o=>{try{o.stop()}catch{}}),2800)},
  };
})();

// ---- cast & set ----
const CAST={
  Manager:{name:'Morgan',title:'Engineering Manager',model:'Gemini 3.5 Flash-Lite',c:'#f2b84b',letter:'M',pitch:330,line:'Never writes code. Never drops a handoff.'},
  Architect:{name:'Alex',title:'Architect',model:'Gemini 3.5 Flash-Lite',c:'#6ea8ff',letter:'A',x:330,side:1,pitch:420,line:'Turns “make it work” into acceptance criteria.'},
  QA:{name:'Robin',title:'QA Engineer',model:'Gemini 3.5 Flash-Lite',c:'#b48cff',letter:'Q',x:745,side:1,pitch:520,line:'Writes the tests before the code exists.'},
  Backend:{name:'Sam',title:'Backend Engineer',model:'Groq · GPT-OSS 120B',c:'#ff8a5c',letter:'B',x:1175,side:-1,pitch:260,line:'Never trusts a price from the browser.'},
  Frontend:{name:'Riya',title:'Frontend Engineer',model:'Groq · GPT-OSS 120B',c:'#3fd0b6',letter:'F',x:1590,side:-1,pitch:600,line:'Makes it look like it was always there.'},
};
const WORKERS=['Architect','QA','Backend','Frontend'];
const DESK_Y=930,FRONT_Y=1010,HOME={x:960,y:700};
const STICKIES=[['spec','SPEC','#6ea8ff'],['tests','TESTS','#b48cff'],['api','API','#ff8a5c'],['ui','UI','#3fd0b6'],['verify','VERIFY','#b48cff']];
const stickyCol={};

const bot=(letter,extra='')=>`<div class="bot"><div class="antenna"><i></i></div><div class="head"><div class="visor"><span class="eye l"></span><span class="eye r"></span><span class="mouth"></span></div></div><div class="torso"><span class="arm l"></span><span class="arm r"></span><span class="badge">${letter}</span></div><div class="legs"><span class="leg l"></span><span class="leg r"></span></div>${extra}</div>`;

function build(){
  $('stations').innerHTML=WORKERS.map(role=>{
    const a=CAST[role],s=a.side===1?'r':'l';
    return `<div class="station off" id="st-${role}" style="left:${a.x}px;top:${DESK_Y}px;--c:${a.c}">
      <div class="light-pool"></div><div class="chair"></div>${bot(a.letter)}
      <div class="desk"><div class="nameplate">${a.name.toUpperCase()} · ${a.title.toUpperCase()}</div></div>
      <div class="laptop ${s}"></div><div class="mug ${s}"><div class="steam"></div></div>
      <div class="holo ${s}"><div class="holo-head"><span class="dots"><i></i><i></i><i></i></span><span class="fname"></span><span class="status"></span></div><div class="holo-body"></div><div class="holo-foot"></div></div>
      <div class="bubble ${a.side===1?'toL':'toR'}"><small>${a.name.toUpperCase()}</small><span class="bt"></span></div></div>`;
  }).join('');
  const m=$('morgan');m.className='off';
  m.innerHTML=`<div class="shadow"></div>${bot('M','<div class="tablet"></div>')}<div class="bubble"><small>MORGAN · MANAGER</small><span class="bt"></span></div>`;
  morganAt(HOME.x,HOME.y,0);
  for(const el of document.querySelectorAll('.city')){
    let x=0,html='';
    while(x<500){const w=36+Math.random()*60,h=50+Math.random()*150;html+=`<div class="bld" style="left:${x}px;width:${w}px;height:${h}px;opacity:${.75+Math.random()*.25}"></div>`;x+=w+2+Math.random()*8}
    el.innerHTML=html;
  }
  for(const p of document.querySelectorAll('.plant'))p.innerHTML='<div class="pot"></div>'+[-38,-20,-4,12,30].map((r,i)=>`<div class="leaf" style="transform:rotate(${r}deg);height:${90+(i%3)*20}px"></div>`).join('');
  const board=$('board');
  STICKIES.forEach(([id,label,c])=>{const el=document.createElement('div');el.className='sticky';el.id='sk-'+id;el.style.background=`color-mix(in srgb,${c} 55%,white)`;el.innerHTML=`<i></i>${label}`;board.appendChild(el);stickyCol[id]=0});
  layoutStickies();
  drawGrain();
  setClock(0);
}
function layoutStickies(){
  const colW=(440-20-16)/3,slots=[0,0,0];
  for(const [id] of STICKIES){const col=stickyCol[id],el=$('sk-'+id);el.style.left=(10+col*(colW+8)+3)+'px';el.style.top=(60+slots[col]++*36)+'px';el.classList.toggle('done',col===2)}
}
function sticky(id,col){stickyCol[id]=col;layoutStickies()}
function drawGrain(){
  const c=$('grain');c.width=320;c.height=180;const g=c.getContext('2d'),img=g.createImageData(320,180);
  for(let i=0;i<img.data.length;i+=4){const v=Math.random()*255;img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255}
  g.putImageData(img,0,0);c.style.width='200%';c.style.height='200%';
}

// ---- camera ----
let chatOpen=false;
function cam(x,y,z,ms=1600,ease='cubic-bezier(.65,0,.35,1)'){
  const cx=chatOpen?735:960,w=$('world');
  w.style.transition=`transform ${ms}ms ${ease}, opacity 1.6s ease`;
  w.style.transform=`translate(${cx-x*z}px,${540-y*z}px) scale(${z})`;
}
const st=(role)=>$('st-'+role);
const botOf=(role)=>role==='Manager'?$('morgan').querySelector('.bot'):st(role).querySelector('.bot');
const shot=(role,z=1.22,ms=1500)=>{const a=CAST[role];cam(a.x+a.side*120,598,z,ms)};
const close=(role,z=2.3,ms=1100)=>role==='Manager'?cam(m.x,m.y-130,z,ms):cam(CAST[role].x,DESK_Y-170,z,ms);
const holoShot=(role,z=1.75,ms=1300)=>{const a=CAST[role];cam(a.x+a.side*254,470,z,ms)};

// ---- the manager walks ----
const m={x:HOME.x,y:HOME.y};
function morganAt(x,y,ms){
  const el=$('morgan');m.x=x;m.y=y;
  el.style.transitionDuration=ms+'ms';
  el.style.left=x+'px';el.style.top=y+'px';
  el.style.setProperty('--s',(.9+(y-HOME.y)/(FRONT_Y-HOME.y)*.15).toFixed(3));
  el.style.zIndex=y>800?20:8;
}
async function walk(x,y,ms=1700,follow=true){
  const el=$('morgan');el.classList.add('walking');
  if(follow)cam((m.x+x)/2+120,(m.y+y)/2-200,1.05,ms);
  morganAt(x,y,ms);await wait(ms);el.classList.remove('walking');
}
const standBy=(role)=>{const a=CAST[role];return {x:a.x-a.side*175,y:FRONT_Y}};
async function walkTo(role,ms=1700){
  const p=standBy(role);$('morgan').querySelector('.bubble').classList.toggle('flip',CAST[role].side===-1);
  await walk(p.x,p.y,ms,false);
}

// ---- dialogue ----
async function type(el,text,cps=46,sound){
  el.textContent='';const step=Math.max(1,Math.round(cps/55));
  for(let i=0;i<text.length;i+=step){
    el.textContent=text.slice(0,i+step);
    if(sound)sound(text[i],i);
    await wait(1000/cps*step);
  }
  el.textContent=text;
}
async function say(role,text,hold=1600,{keep=false}={}){
  const host=role==='Manager'?$('morgan'):st(role),b=host.querySelector('.bubble'),bt=b.querySelector('.bt'),body=botOf(role);
  bt.textContent='';b.classList.add('show');body.classList.add('talk');
  await type(bt,text,48,(ch,i)=>{if(i===0||text[i-1]===' ')sfx.voice(CAST[role].pitch)});
  body.classList.remove('talk');
  await wait(hold);
  if(!keep)b.classList.remove('show');
}
const hush=(role)=>(role==='Manager'?$('morgan'):st(role)).querySelector('.bubble').classList.remove('show');
const mood=(role,cls,on=true)=>botOf(role).classList.toggle(cls,on);

// ---- team chat ----
const PEOPLE={Shrey:{name:'Shrey',c:'#ff7a59',tag:'FOUNDER',human:true}};
for(const [k,v] of Object.entries(CAST))PEOPLE[k]={name:v.name,c:v.c,tag:'AI · '+v.title.toUpperCase().replace('ENGINEERING ','')};
async function post(who,html,typingMs=900){
  const p=PEOPLE[who],ty=$('typing');
  ty.querySelector('span').textContent=`${p.name} is typing…`;ty.classList.add('show');
  await wait(typingMs);ty.classList.remove('show');
  const list=$('chat-list'),el=document.createElement('div');el.className='msg';
  el.innerHTML=`<div class="av ${p.human?'':'ai'}" style="--c:${p.c}">${p.human?'S':''}</div><div class="msg-body"><div class="msg-meta"><b>${p.name}</b><span class="tag ${p.human?'human':''}">${p.tag}</span><span>${clockText().slice(0,5)}</span></div><div class="msg-text">${html}</div></div>`;
  list.appendChild(el);while(list.children.length>7)list.firstElementChild.remove();
  sfx.ping();
}
function openChat(open=true){chatOpen=open;$('chat').classList.toggle('open',open)}

// ---- run clock (real run timestamps) ----
const BASE=9*3600+54*60+31;let clockSec=0,calls=0;
const pad2=(n)=>String(n).padStart(2,'0');
function clockText(){const t=BASE+Math.floor(clockSec);return `${pad2(Math.floor(t/3600))}:${pad2(Math.floor(t/60)%60)}:${pad2(t%60)}`}
function setClock(sec){
  clockSec=sec;$('hud-clock').textContent=clockText();
  const s=Math.floor(sec);$('hud-run').textContent=`RUN 4fd735f · T+${pad2(Math.floor(s/60))}:${pad2(s%60)}`;
  const t=BASE+sec;$('clock-mn').style.transform=`rotate(${(t/3600%1)*360}deg)`;$('clock-hr').style.transform=`rotate(${(t/43200%1)*360}deg)`;
}
function clockTo(sec,ms=1200){
  const from=clockSec,start=vt;
  const f=()=>{const k=Math.min(1,(vt-start)/ms);setClock(from+(sec-from)*k);if(k>=1)tickers.delete(f)};tickers.add(f);
}
function setCalls(n){calls=n;$('hud-calls').textContent=`MODEL CALLS ${n} · GEMINI + GROQ`}

// ---- holo screens ----
const holo=(role)=>st(role).querySelector('.holo');
function holoOpen(role,fname,status='● WRITING'){
  const h=holo(role);h.querySelector('.fname').textContent=fname;h.querySelector('.holo-body').innerHTML='';h.querySelector('.holo-foot').innerHTML='';
  holoStatus(role,status,true);h.classList.add('show');sfx.holo();
}
function holoStatus(role,text,live=false){const s=holo(role).querySelector('.status');s.textContent=text;s.classList.toggle('live',live)}
const holoFoot=(role,html)=>{holo(role).querySelector('.holo-foot').innerHTML=html};
const holoClose=(role)=>holo(role).classList.remove('show');
const esc=(s)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const hl=(line)=>esc(line).replace(/(\/\/.*$)|('[^']*')|\b(export|function|return|const|let|if|for|of)\b|\b(\d+(?:\.\d+)?)\b/g,(all,c,s,k,n)=>c?`<span class="c">${c}</span>`:s?`<span class="s">${s}</span>`:k?`<span class="k">${k}</span>`:`<span class="n">${n}</span>`);
async function typeLines(role,lines,cps=70,code=false){
  const body=holo(role).querySelector('.holo-body');
  for(const line of lines){
    const el=document.createElement('div');el.className='caret';body.appendChild(el);
    if(!line){el.innerHTML='&nbsp;';el.className='';await wait(80);continue}
    body.scrollTop=body.scrollHeight;
    await type(el,line,cps,(ch,i)=>{if(i%2===0)sfx.tick()});
    el.className='';if(code)el.innerHTML=hl(line);
    await wait(code?40:110);
  }
}
function testRow(role,name,state){
  const body=holo(role).querySelector('.holo-body'),el=document.createElement('div');
  el.className='t-row '+state;el.innerHTML=`<span class="ic">${state==='pass'?'✓':state==='fail'?'✗':'○'}</span><span>${esc(name)}</span>`;
  body.appendChild(el);return el;
}

// ---- the ticket physically changes hands ----
const chest=(role)=>role==='Manager'?{x:m.x+(m.x<CAST.Frontend.x?60:-60),y:m.y-150}:{x:CAST[role].x,y:DESK_Y-190};
async function handoff(from,to,label,dur=1250){
  const a=chest(from),b=chest(to),tk=$('ticket'),c=CAST[to].c;
  $('tk-step').textContent=label;tk.style.setProperty('--tk',c);
  const ctrl={x:(a.x+b.x)/2,y:Math.min(a.y,b.y)-280},frames=[];
  for(let i=0;i<=30;i++){
    const t=i/30,x=(1-t)**2*a.x+2*(1-t)*t*ctrl.x+t*t*b.x,y=(1-t)**2*a.y+2*(1-t)*t*ctrl.y+t*t*b.y;
    frames.push({offset:t,transform:`translate(${x}px,${y}px) rotate(${(t-.5)*-16}deg) scale(${(.45+Math.sin(t*Math.PI)*.75).toFixed(3)})`,opacity:t<.04||t>.97?0:1});
  }
  sfx.whoosh();
  tk.animate(frames,{duration:dur,easing:'cubic-bezier(.45,0,.3,1)',fill:'forwards'});
  let n=0;const trail=()=>{if(n++%2)return;const mx=new DOMMatrix(getComputedStyle(tk).transform);if(!mx.e&&!mx.f)return;
    const d=document.createElement('div');d.className='trail';$('world').appendChild(d);
    d.animate([{transform:`translate(${mx.e}px,${mx.f}px) scale(1)`,opacity:.9},{transform:`translate(${mx.e}px,${mx.f+10}px) scale(.2)`,opacity:0}],{duration:650,fill:'forwards'}).onfinish=()=>d.remove()};
  tickers.add(trail);await wait(dur);tickers.delete(trail);
  const r=document.createElement('div');r.className='ring';r.style.setProperty('--c',c);$('world').appendChild(r);
  r.animate([{transform:`translate(${b.x}px,${b.y}px) scale(.4)`,opacity:1},{transform:`translate(${b.x}px,${b.y}px) scale(5)`,opacity:0}],{duration:700,easing:'ease-out',fill:'forwards'}).onfinish=()=>r.remove();
  sfx.land();
}

// ---- lower thirds ----
const DECISIONS=[
  ['Architect','No spec has been written yet, so the Architect must create the technical specification before any other work can begin.',1],
  ['QA','The Architect has completed the spec, so QA must now write the failing acceptance tests before development begins.',3],
  ['Backend','QA has written failing tests and Backend must implement the API first as Frontend depends on it.',6],
  ['Frontend','The Architect and Backend have completed their work, and the allowed next assignment is Frontend to implement the UI components.',7],
  ['QA','Backend and Frontend have completed implementation, so QA must run all tests to verify the feature before completion.',8],
  ['COMPLETE','All 17 acceptance tests have passed successfully without any failures, satisfying the QA gate requirement.',11],
];
async function decide(i,hold=3000){
  const [who,reason,call]=DECISIONS[i],d=$('decision');
  $('d-call').textContent=`GEMINI CALL ${call}/16`;
  $('d-assign').innerHTML=who==='COMPLETE'?'Mission <em>complete</em>':`Assign → <em>${CAST[who].name}</em>, ${CAST[who].title.toLowerCase()}`;
  $('d-reason').textContent=reason;
  mood('Manager','think');sfx.hit();d.classList.add('show');
  await wait(hold);d.classList.remove('show');mood('Manager','think',false);await wait(300);
}
async function chapter(num,title,hold=1900){
  $('ch-num').textContent=num;$('ch-ttl').textContent=title;$('chapter').classList.add('show');sfx.hit();
  await wait(hold);$('chapter').classList.remove('show');await wait(500);
}
function pipe(step,state){const el=document.querySelector(`#pipeline [data-step="${step}"]`);el.classList.remove('active','done');if(state)el.classList.add(state)}
async function flash(ms=500){$('flash').animate([{opacity:.85},{opacity:0}],{duration:ms,easing:'ease-out'});}
function confetti(){
  const box=$('confetti'),colors=['#ff7a59','#3fd0b6','#f2b84b','#6ea8ff','#b48cff','#4ade80','#fff'];
  for(let i=0;i<170;i++){
    const c=document.createElement('i');c.style.left=Math.random()*1920+'px';c.style.background=colors[i%colors.length];box.appendChild(c);
    const dx=(Math.random()-.5)*300,rot=Math.random()*900;
    c.animate([{transform:'translate(0,0) rotate(0)'},{transform:`translate(${dx}px,1180px) rotate(${rot}deg)`}],{duration:2600+Math.random()*2200,delay:Math.random()*900,easing:'cubic-bezier(.25,.6,.4,1)',fill:'forwards'}).onfinish=()=>c.remove();
  }
}

// ============================ THE FILM ============================
async function film(){
  // COLD OPEN
  await wait(700);
  $('center-text').classList.add('show');
  await type($('center-inner'),'Every feature starts with a message.',26,(ch,i)=>{if(i%2===0)sfx.tick()});
  await wait(1500);$('center-text').classList.remove('show');await wait(900);
  $('notif').classList.add('show');sfx.ping();
  await wait(4000);$('notif').classList.remove('show');await wait(800);

  // TITLE: the sign lights up, then the office wakes
  cam(960,175,2.25,0);stage.classList.add('rolling','boxed');sfx.padStart();
  await wait(1700);
  $('sign').classList.add('on');sfx.boom();
  await wait(1900);
  $('sign').classList.add('ai');sfx.shimmer();
  await wait(2300);
  cam(960,560,.96,4600,'cubic-bezier(.55,0,.15,1)');
  await wait(900);$('room-dark').classList.add('lit');$('world').classList.add('dawn');stage.classList.add('hud');
  for(const role of ['Manager',...WORKERS]){await wait(430);(role==='Manager'?$('morgan'):st(role)).classList.remove('off');sfx.click()}
  await wait(2200);

  // MEET THE TEAM
  $('spot').classList.add('show');
  for(const role of ['Manager',...WORKERS]){
    const a=CAST[role],c=$('cast');
    close(role,1.9,1000);await wait(750);
    c.style.setProperty('--c',a.c);$('c-name').textContent=a.name;
    $('c-role').innerHTML=`${a.title} <span>· ${a.model}</span>`;$('c-line').textContent=a.line;
    c.classList.add('show');mood(role,'happy');sfx.hit();
    await wait(1700);c.classList.remove('show');mood(role,'happy',false);await wait(200);
  }
  $('spot').classList.remove('show');
  cam(960,560,.96,1500);await wait(1600);

  // 01 · THE BRIEF
  await chapter('CHAPTER 01','The brief');
  openChat();cam(960,520,1.5,1600);
  post('Shrey','Students keep asking for a discount. Can we ship <code>STUDENT10</code> today? 10% off, min ₹299, capped at ₹100.',700);
  await wait(1900);
  STICKIES.forEach(([id],i)=>setTimeout(()=>$('sk-'+id).classList.add('show'),i*120));
  await say('Manager','New ticket from Shrey. Student discount, code STUDENT10.',1300);
  await say('Manager','House rule: no code until we have a spec and failing tests.',1500);
  post('Manager','On it. Spec → failing tests → API → UI → full test run. Nobody skips a step.');

  // ARCHITECT
  clockTo(12,1500);setCalls(1);
  await decide(0);
  $('morgan').querySelector('.bubble').classList.remove('flip');
  cam(560,700,1.05,1900);await walkTo('Architect',1900);
  shot('Architect');
  await say('Manager','Alex, spec first. What does “student discount” actually mean?',1200);
  sticky('spec',1);pipe('spec','active');
  await handoff('Manager','Architect','→ Alex · write the spec');
  await say('Architect','Give me five seconds.',500);
  mood('Architect','typing');holoOpen('Architect','spec.md');setCalls(2);clockTo(17,5200);
  await typeLines('Architect',['FEASIBLE: yes','NAME: Student Discount · SLOT: bag','API: apply-coupon → {valid, discount}','','ACCEPTANCE','1. STUDENT10 + 2 pizzas (₹518) → ₹52 off','2. 1 burger (₹179) → not eligible','3. ₹488 bag → −₹49 line in the bag','4. Invalid code → error, no discount','5. Bag changes → discount recalculates'],80);
  mood('Architect','typing',false);holoStatus('Architect','✓ SAVED');holoFoot('Architect','<span>5 acceptance criteria</span><b class="green">feasible</b>');
  mood('Architect','happy');
  await say('Architect','Spec’s done. Five criteria. A ₹518 bag gets ₹52 off.',1300);
  post('Architect','<code>spec.md</code> is up. Feasible: yes. 5 acceptance criteria.');
  sticky('spec',2);pipe('spec','done');mood('Architect','happy',false);

  // 02 · TESTS FIRST
  await chapter('CHAPTER 02','Tests first');
  clockTo(22,1200);setCalls(3);
  await decide(1);
  shot('QA',1.15,1700);
  holoClose('Architect');
  mood('Architect','lookR');
  await say('Architect','Robin, watch criterion 3. 10% of ₹488 is ₹48.80. It rounds to ₹49.',1300);
  mood('Architect','lookR',false);
  const walking=walkTo('QA',1700);
  await handoff('Architect','QA','→ Robin · tests before code');
  await walking;
  sticky('tests',1);pipe('tests','active');
  await say('Manager','Robin, tests before code. Make them fail.',1000);
  await say('QA','My favourite part of the job.',500);
  mood('QA','typing');holoOpen('QA','feature.acceptance.test.mjs');setCalls(5);clockTo(30,4200);
  const tests=['API: STUDENT10 + 2 pizzas → valid, ₹52','API: 1 burger below ₹299 → not eligible','UI: ₹488 bag shows a −₹49 line','UI: invalid code → error, no line','UI: bag changes recalculate discount'];
  for(const t of tests){await wait(650);testRow('QA',t,'fail');sfx.fail()}
  mood('QA','typing',false);holoStatus('QA','RAN · 0 PASS');holoFoot('QA','<span>no feature code exists yet</span><b class="red">5 failing ✓ expected</b>');
  await wait(600);mood('QA','happy');
  await say('QA','Five tests. All red. Exactly how it should be.',1300);
  post('QA','<code>tests/feature.acceptance.test.mjs</code>: 5 tests, 5 failing. Expected, there is no code yet.');
  sticky('tests',2);pipe('tests','done');mood('QA','happy',false);

  // 03 · BUILD: backend
  await chapter('CHAPTER 03','The build');
  clockTo(39,1200);setCalls(6);
  await decide(2);
  holoClose('QA');
  cam(960,700,1.05,1700);await walkTo('Backend',1700);
  shot('Backend');
  await say('Manager','Sam, API first. Riya’s UI depends on it.',1000);
  sticky('api',1);pipe('api','active');
  await handoff('Manager','Backend','→ Sam · build the API');
  await say('Backend','Say less.',400);
  mood('Backend','typing');holo('Backend').classList.add('wide');holoOpen('Backend','api/feature.mjs');setCalls(8);clockTo(42,6000);
  await typeLines('Backend',["export function handle(action, body, ctx) {","  if (action !== 'apply-coupon') return { status: 404 };","  let subtotal = 0;","  for (const item of body.items) {","    // price comes from the server, never the browser","    const p = ctx.products.find(x => x.id === item.id);","    subtotal += p.price * item.qty;","  }","  if (body.code !== 'STUDENT10' || subtotal < 299)","    return { status: 200, valid: false, discount: 0 };","  let discount = Math.round(subtotal * 0.10);","  if (discount > 100) discount = 100;","  return { status: 200, valid: true, discount };","}"],95,true);
  mood('Backend','typing',false);holoStatus('Backend','✓ SAVED · TESTS RUN');holoFoot('Backend','<span>API tests green · UI pending</span><b>8 pass / 9 fail</b>');
  await say('Backend','API’s live. Prices come from the server, never from the browser.',1300);
  post('Backend','<code>api/feature.mjs</code> ✓ <code>POST /api/feature/apply-coupon</code>');
  sticky('api',2);pipe('api','done');
  mood('Backend','lookR');
  await say('Backend','Riya, endpoint’s apply-coupon. Send me ids, not prices.',1100);
  mood('Backend','lookR',false);

  // frontend
  clockTo(55,1200);setCalls(9);
  await decide(3,2800);
  holoClose('Backend');
  const toRiya=walkTo('Frontend',1300);
  shot('Frontend',1.22,1500);
  sticky('ui',1);pipe('ui','active');
  await handoff('Backend','Frontend','→ Riya · put it in the bag');
  await toRiya;
  mood('Frontend','lookL');
  await say('Frontend','Wouldn’t dream of it.',500);
  mood('Frontend','lookL',false);
  mood('Frontend','typing');holoOpen('Frontend','site/feature.js · live preview');setCalls(11);clockTo(63,6500);
  holo('Frontend').querySelector('.holo-body').innerHTML=`<div class="ui-mock"><h4>🎓 Student discount</h4><div class="row"><div class="inp" id="ui-inp"></div><div class="btn" id="ui-btn">Apply</div></div><div class="msg" id="ui-msg">✓ STUDENT10 applied: 10% off</div><div class="lines"><div><span>Subtotal</span><span>₹518</span></div><div class="disc" id="ui-disc"><span>Student Discount (STUDENT10)</span><span>−₹52</span></div></div></div>`;
  await wait(900);
  await type($('ui-inp'),'STUDENT10',9,()=>sfx.tick());
  await wait(400);$('ui-btn').classList.add('press');sfx.click();await wait(160);$('ui-btn').classList.remove('press');
  await wait(400);$('ui-msg').classList.add('show');await wait(350);$('ui-disc').classList.add('show');sfx.land();
  mood('Frontend','typing',false);holoStatus('Frontend','✓ SAVED · TESTS RUN');holoFoot('Frontend','<span>every test in the repo</span><b class="green">17 pass / 0 fail</b>');
  await wait(500);mood('Frontend','happy');
  await say('Frontend','Panel’s in the bag. Change the bag, the discount follows.',1300);
  post('Frontend','<code>site/feature.js</code> ✓ discount line recalculates on every bag change');
  sticky('ui',2);pipe('ui','done');mood('Frontend','happy',false);

  // 04 · THE MOMENT OF TRUTH
  holoClose('Frontend');
  await chapter('CHAPTER 04','The moment of truth');
  clockTo(96,1500);setCalls(12);
  await decide(4);
  cam(900,700,1.05,1800);await walkTo('QA',1800);
  shot('QA',1.22,1200);
  await say('Manager','Robin. Run everything. Trust nobody, including me.',1100);
  sticky('verify',1);pipe('verify','active');
  await handoff('Frontend','QA','→ Robin · verify all 17');
  await say('QA','Running all seventeen.',300);
  stage.classList.add('tight');sfx.beat();
  mood('QA','think');holoOpen('QA','node --test · all suites','● RUNNING');setCalls(14);
  holoShot('QA',1.6,1400);
  await wait(900);sfx.beat();
  const all=['API: STUDENT10 with 2 pizzas returns valid discount','API: 1 burger below 299 is not eligible','UI: 488 subtotal shows a negative line','UI: invalid code shows an error','UI: bag changes recalculate the discount','Contract: frontend exports feature','Contract: initialState() is a plain object','Contract: render() handles empty + full bags','Contract: onAction ignores unknown actions','Contract: hooks have the right shape','Contract: backend 404s unknown actions','API: independent check rejects bad coupon','API: independent check, ₹49 on ₹488','API: independent check rejects ₹259','API: independent check caps at ₹100','UI: independent check survives bag changes','UI: independent check renders coupon section'];
  $('meter').classList.add('show');
  const body=holo('QA').querySelector('.holo-body');body.style.maxHeight='330px';body.style.overflow='hidden';
  for(let i=0;i<all.length;i++){
    const row=testRow('QA',all[i],'wait');
    while(body.scrollHeight>body.clientHeight&&body.firstElementChild)body.firstElementChild.remove();
    await wait(Math.max(110,520-i*32));
    row.className='t-row pass';row.querySelector('.ic').textContent='✓';sfx.pass(i);
    $('m-num').textContent=`${i+1} / 17`;$('m-fill').style.width=((i+1)/17*100)+'%';
    if(i%4===3)sfx.beat();
  }
  clockTo(102,400);
  await wait(500);
  $('m-num').classList.add('green');$('stamp').classList.add('show');flash(600);sfx.chord();sfx.padBright();
  mood('QA','think',false);mood('QA','happy');holoStatus('QA','PASS');holoFoot('QA','<span>independent release gate</span><b class="green">17 pass / 0 fail</b>');
  await wait(1800);$('stamp').classList.add('out');$('meter').classList.remove('show');stage.classList.remove('tight');
  shot('QA',1.22,1200);
  await say('QA','Seventeen for seventeen.',900);
  post('QA','Independent run: <b>17 pass / 0 fail</b>. Release gate: PASS.');
  sticky('verify',2);pipe('verify','done');
  clockTo(115,1200);setCalls(15);
  await decide(5,2600);
  await say('Manager','Mission complete. Ship it.',300,{keep:true});

  // celebration
  clockTo(116,600);holoClose('QA');
  cam(960,600,1,1400);
  confetti();
  ['Manager',...WORKERS].forEach((r,i)=>setTimeout(()=>{mood(r,'happy');mood(r,'bounce')},i*120));
  await wait(1700);hush('Manager');
  post('Shrey','wait… it’s already live?? 🔥',800);
  await wait(2400);
  post('Manager','17/17 green. Your students can use <code>STUDENT10</code> right now.',900);
  await wait(3300);
  ['Manager',...WORKERS].forEach(r=>mood(r,'bounce',false));

  // 05 · SHIPPED
  $('product').classList.add('show');sfx.whoosh();
  await wait(5200);

  // END CARD
  $('endcard').classList.add('show');sfx.boom();
  await wait(1700);
  for(const b of document.querySelectorAll('#endcard [data-count],#endcard [data-time]'))countUp(b);
  await wait(9000);sfx.padStop();
  document.body.classList.remove('playing');
}
async function countUp(el){
  const target=Number(el.dataset.count??el.dataset.time),isTime=el.dataset.time!=null;
  for(let i=0;i<=30;i++){
    const v=Math.round(target*i/30);
    el.textContent=isTime?`${Math.floor(v/60)}m ${pad2(v%60)}s`:v+(el.dataset.suffix||'');
    await wait(40);
  }
}

// ---- controls ----
let started=false;
function start(){
  if(started)return;started=true;
  sfx.init();$('start').classList.add('gone');document.body.classList.add('playing');
  film();
}
function restart(){
  waiters=[];filmT=0;seekTo=0;tickers.clear();
  for(const a of document.getAnimations())a.cancel();
  sfx.padStop();chatOpen=false;paused=false;document.body.classList.remove('paused');
  stage.className='';stage.innerHTML=INITIAL;fit();build();
  $('replay').addEventListener('click',restart);
  document.body.classList.add('playing');requestAnimationFrame(()=>film());
}
function togglePause(){
  if(!started)return;paused=!paused;document.body.classList.toggle('paused',paused);
  for(const a of document.getAnimations())paused?a.pause():a.play();
  const ctx=sfx.ctx();if(ctx)paused?ctx.suspend():ctx.resume();
}
$('play').addEventListener('click',start);
$('replay').addEventListener('click',restart);
addEventListener('keydown',(e)=>{
  if(e.code==='Space'){e.preventDefault();started?togglePause():start()}
  else if(e.key==='r'||e.key==='R'){started?restart():start()}
  else if(e.key==='m'||e.key==='M')sfx.toggle();
  else if(e.key==='f'||e.key==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.()}
});
build();
if(new URLSearchParams(location.search).has('autoplay'))start();
})();
