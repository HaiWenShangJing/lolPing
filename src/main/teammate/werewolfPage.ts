import { gamePage } from './gamePage';

const CSS = `
#game{flex:1;display:flex;flex-direction:column;min-height:0}
#bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--line);
  flex:none}
#bar b{font-size:15px}
#bar .gap{flex:1}
#mine{font-weight:600}
#boom{background:#d64541;border-color:#d64541;color:#fff}
#main{flex:1;display:flex;min-height:0}
#seats{flex:none;width:430px;padding:8px;border-right:1px solid var(--line);display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:min-content;gap:6px;align-content:start;
  overflow-y:auto}
.seat{position:relative;display:flex;align-items:flex-start;gap:6px;padding:5px 6px;border:1px solid var(--line);
  border-radius:8px;background:var(--field);min-width:0}
.seat .av{width:26px;height:26px;font-size:13px}
.seat .info{flex:1;min-width:0}
.seat .nm{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seat .tags{display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;min-height:15px}
.seat.me{border-color:var(--accent)}
.seat.dead{opacity:.45}
.seat.dead .nm{text-decoration:line-through}
.seat.talk{background:rgba(74,144,226,.16)}
.seat.busy{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.seat .dots{display:none;position:absolute;right:6px;top:2px;color:var(--accent);font-weight:700}
.seat.busy .dots{display:block;animation:blink 1.1s infinite}
@keyframes blink{50%{opacity:.25}}
.tg{font-size:10px;line-height:14px;padding:0 5px;border-radius:7px;background:rgba(127,127,127,.2);color:var(--dim);
  white-space:nowrap}
.tg.wolf{background:rgba(214,69,65,.2);color:#d64541}
.tg.god{background:rgba(74,144,226,.2);color:var(--accent)}
.tg.sh{background:rgba(217,164,50,.25);color:#b7791f}
#side{flex:1;display:flex;flex-direction:column;min-width:0}
#log{flex:1;overflow-y:auto;padding:10px 14px;word-break:break-word}
.ln{margin:5px 0}
.ln.sys{color:var(--dim);font-style:italic;text-align:center}
.ln.secret{color:#b7791f;background:rgba(217,164,50,.12);padding:3px 8px;border-radius:6px}
.ln.vote{color:var(--dim);font-size:12px}
#ask{border-top:1px solid var(--line);padding:10px 14px;display:flex;flex-direction:column;gap:8px;flex:none;
  max-height:45%;overflow-y:auto}
#ask .q{font-weight:600}
#ask .opts{display:flex;flex-wrap:wrap;gap:6px}
#ask .sub{color:var(--dim);font-size:12px}
#ask form{display:flex;gap:6px}
#ask input{flex:1;min-width:0}
#over{font-size:15px;font-weight:600}
@media(max-width:860px){
  #main{flex-direction:column}
  #seats{width:auto;max-height:44%;border-right:0;border-bottom:1px solid var(--line);
    grid-template-columns:repeat(4,minmax(0,1fr))}
}
`;

const BODY = `<div id="game" hidden>
  <div id="bar">
    <b id="day"></b><span id="phase" class="dim"></span><span id="watch" class="dim"></span><span class="gap"></span>
    <span id="mine"></span><button id="boom" hidden></button>
  </div>
  <div id="main">
    <div id="seats"></div>
    <div id="side"><div id="log"></div><div id="ask" hidden></div></div>
  </div>
</div>`;

const JS = `
let T={},seats=[],busy=new Set(),speaker=0,over=false,armed=0;
const seatOf=n=>seats.find(s=>s.seat===n);
const nameOf=n=>{const s=seatOf(n);return s?s.name:String(n)};
const tag=n=>n+'. '+nameOf(n);
const tagsOf=s=>{
  const t=[];
  if(s.roleName)t.push(el('span','tg '+(s.role==='wolf'?'wolf':s.role==='villager'?'':'god'),s.roleName));
  if(s.sheriff)t.push(el('span','tg sh',T.sheriff));
  if(s.flipped)t.push(el('span','tg',T.flipped));
  if(!s.alive)t.push(el('span','tg',T.out));
  return t;
};
function drawSeats(){
  $('seats').replaceChildren(...seats.map(s=>{
    const c=el('div','seat'+(s.alive?'':' dead')+(s.me?' me':'')+(busy.has(s.seat)?' busy':'')
      +(speaker===s.seat?' talk':''));
    const tags=el('div','tags'),info=el('div','info');
    tags.append(...tagsOf(s));
    info.append(el('div','nm',tag(s.seat)),tags);
    c.append(avatar(s.color,s.name),info,el('div','dots','\\u2026'));
    if(busy.has(s.seat))c.title=T.thinking;
    return c;
  }));
}
function addLine(m){
  const r=el('div','ln '+m.tone),log=$('log');
  if(m.tone==='say'&&m.seat!==null){
    const s=seatOf(m.seat),who=el('b','',nameOf(m.seat)+': ');
    if(s)who.style.color=s.color;
    r.append(who,document.createTextNode(m.text));
    speaker=m.seat;drawSeats();
  }else r.textContent=m.text;
  log.append(r);log.scrollTop=log.scrollHeight;
}
function setBoom(on){
  $('boom').hidden=!on;
  if(!on&&armed){clearTimeout(armed);armed=0}
  $('boom').textContent=armed?T.boomSure:T.boomButton;
}
$('boom').addEventListener('click',()=>{
  if(!armed){
    armed=setTimeout(()=>{armed=0;$('boom').textContent=T.boomButton},3000);
    $('boom').textContent=T.boomSure;
    return;
  }
  clearTimeout(armed);armed=0;
  $('boom').textContent=T.boomButton;
  send({t:'boom'});
});
function showAsk(a){
  const p=$('ask');
  p.replaceChildren();
  if(!a){
    const wait=!over&&seats.some(s=>s.me&&s.alive);
    p.hidden=!wait;
    if(wait)p.append(el('div','sub',T.waiting));
    return;
  }
  p.hidden=false;
  p.append(el('div','q',a.title));
  const done=fn=>()=>{p.hidden=true;p.replaceChildren();fn()};
  const btn=(label,fn,cls)=>{const b=el('button',cls||'',label);b.addEventListener('click',done(fn));return b};
  const row=el('div','opts');
  const seatBtns=(box,fn)=>a.options.forEach(n=>box.append(btn(tag(n),()=>fn(n))));
  if(a.kind==='kill'||a.kind==='check')seatBtns(row,n=>send({t:'target',seat:n}));
  else if(a.kind==='vote'){
    seatBtns(row,n=>send({t:'vote',seat:n}));
    row.append(btn(T.abstain,()=>send({t:'vote',seat:null}),'ghost'));
  }else if(a.kind==='shoot'){
    seatBtns(row,n=>send({t:'pick',seat:n}));
    row.append(btn(T.noShot,()=>send({t:'pick',seat:null}),'ghost'));
  }else if(a.kind==='badge'){
    seatBtns(row,n=>send({t:'pick',seat:n}));
    row.append(btn(T.tearBadge,()=>send({t:'pick',seat:null}),'ghost'));
  }else if(a.kind==='run'){
    row.append(btn(T.runYes,()=>send({t:'run',run:true}),'primary'),
      btn(T.runNo,()=>send({t:'run',run:false}),'ghost'));
  }else if(a.kind==='witch'){
    if(a.save&&a.victim!==null){
      const save=T.saveHim.replace('{name}',nameOf(a.victim));
      row.append(btn(save,()=>send({t:'witch',save:true,poison:null}),'primary'));
    }else if(a.victim!==null)p.append(el('div','sub',T.noSelfSave));
    row.append(btn(T.noPotion,()=>send({t:'witch',save:false,poison:null}),'ghost'));
    p.append(row);
    if(a.poison){
      const poison=el('div','opts');
      seatBtns(poison,n=>send({t:'witch',save:false,poison:n}));
      p.append(el('div','sub',T.poisonHint),poison);
    }
    return;
  }else if(a.kind==='speak'){
    const f=el('form'),box=el('input');
    box.placeholder=T.sendHint;box.maxLength=240;
    const go=text=>{p.hidden=true;p.replaceChildren();send({t:'say',text})};
    const ok=el('button','primary',T.send);ok.type='submit';
    const pass=el('button','ghost',T.pass);pass.type='button';
    pass.addEventListener('click',()=>go(''));
    f.addEventListener('submit',e=>{e.preventDefault();go(box.value.trim())});
    f.append(box,ok,pass);p.append(f);box.focus();
    return;
  }
  p.append(row);
}
gameApi.onMsg(m=>{
  if(m.kind==='lobby'){
    T=m.text;busy=new Set();seats=[];speaker=0;over=false;
    document.title=m.text.title;
    $('log').replaceChildren();$('ask').replaceChildren();$('ask').hidden=true;
    setBoom(false);
    showLobby(m,[$('game')]);
  }else if(m.kind==='state'){
    $('lobby').hidden=true;$('game').hidden=false;
    seats=m.seats;
    if(m.phase==='night'||m.phase==='over')speaker=0;
    const me=seats.find(s=>s.me);
    $('day').textContent=m.label;
    $('phase').textContent=T['phase_'+m.phase]||'';
    $('mine').textContent=me&&me.roleName?me.roleName:'';
    $('watch').textContent=me?'':T.watching;
    setBoom(m.boom);
    drawSeats();
    $('log').scrollTop=$('log').scrollHeight;
  }else if(m.kind==='line')addLine(m);
  else if(m.kind==='thinking'){busy=new Set(m.seats);if(m.seats.length)speaker=0;drawSeats()}
  else if(m.kind==='ask')showAsk(m.ask);
  else if(m.kind==='over'){
    over=true;
    const p=$('ask'),head=el('div','',m.title),again=el('button','primary',T.again);
    p.replaceChildren();p.hidden=false;head.id='over';
    again.addEventListener('click',()=>send({t:'again'}));
    p.append(head,el('div','dim',m.text),again);
  }
});
`;

/** The werewolf window's page. */
export const WEREWOLF_PAGE = gamePage({ css: CSS, body: BODY, js: JS });
