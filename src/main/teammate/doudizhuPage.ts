import { BIG, SMALL, SUIT_SIGN, rankLabel } from '../../shared/teammate/doudizhuCards';
import { MAX_DOUBLINGS } from '../../shared/teammate/doudizhuTypes';
import { gamePage } from './gamePage';

const SUITS = JSON.stringify(SUIT_SIGN);
const RANKS = JSON.stringify(Array.from({ length: 13 }, (_, i) => rankLabel(i)));

const CSS = `
#game{flex:1;display:flex;flex-direction:column;min-height:0}
#bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:7px 14px;border-bottom:1px solid var(--line);
  flex:none}
#bar b{font-size:15px}
#bar .gap{flex:1}
#bar .grp{display:flex;gap:4px;align-items:center}
#mine{font-weight:600}
#main{flex:1;display:flex;min-height:0}
#table{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
#opps{flex:1;min-height:0;overflow-y:auto;padding:10px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;align-content:start}
.seat{position:relative;display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid var(--line);
  border-radius:9px;background:var(--field);min-width:0}
.seat .sh{display:flex;align-items:center;gap:7px}
.seat .av{width:28px;height:28px;font-size:13px}
.seat .info{flex:1;min-width:0}
.seat .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seat .tags{display:flex;flex-wrap:wrap;gap:3px;min-height:15px}
.seat .st{font-size:11px}
.seat .dots{display:none;position:absolute;right:8px;top:3px;color:var(--accent);font-weight:700}
.seat.me{border-color:var(--accent)}
.seat.busy{border-color:var(--accent)}
.seat.busy .dots{display:block;animation:blink 1.1s infinite}
@keyframes blink{50%{opacity:.25}}
.seat.turn{box-shadow:0 0 0 2px #f5a623}
.tg{font-size:10px;line-height:14px;padding:0 5px;border-radius:7px;background:rgba(127,127,127,.2);color:var(--dim);
  white-space:nowrap}
.tg.r-landlord{background:rgba(217,164,50,.3);color:#b7791f}
.tg.r-hidden{background:rgba(217,164,50,.14);color:#b7791f;border:1px dashed #b7791f}
.tg.r-farmer{background:rgba(60,154,95,.2);color:#2f8a52}
.shown{display:flex;flex-direction:column;gap:3px;min-height:42px;padding:3px 4px;border-radius:7px;
  border:1px solid transparent}
.shown.top{border-color:var(--accent);background:rgba(74,144,226,.1)}
.shown.bomb{border-color:#d64541;background:rgba(214,69,65,.1)}
.shown .cards{display:flex;flex-wrap:wrap;gap:3px}
.mark{font-size:12px;font-weight:600}
.mark.bomb{color:#d64541}
.chip{font-size:12px;line-height:18px;min-width:26px;text-align:center;padding:0 4px;border-radius:5px;
  background:#fbfbfd;color:#222;border:1px solid rgba(0,0,0,.25);white-space:nowrap;cursor:default}
.chip.red{color:#d02b2b}
#prompt{flex:none;border-top:1px solid var(--line);padding:8px 14px;display:flex;flex-direction:column;gap:6px;
  min-height:84px}
#prompt .q{font-weight:600}
#prompt .sub{color:var(--dim);font-size:12px;min-height:18px}
#prompt .sub.good{color:#2f8a52}
#prompt .sub.bad{color:#d64541}
#prompt .acts{display:flex;flex-wrap:wrap;gap:6px}
#over{font-size:15px;font-weight:600}
#overText{white-space:pre-line}
#me{flex:none;border-top:1px solid var(--line);padding:6px 10px 8px;display:flex;flex-direction:column;gap:6px}
#meSeat .seat{max-width:420px}
#hand{display:flex;overflow-x:auto;padding:18px 10px 6px;min-height:118px;--ov:32px}
.card{position:relative;flex:none;width:58px;height:84px;border:1px solid rgba(0,0,0,.3);border-radius:7px;
  background:#fbfbfd;color:#222;padding:3px 0 0 5px;user-select:none;transition:transform .1s}
#hand .card+.card{margin-left:calc(var(--ov) - 58px)}
.card .cr{font-weight:700;font-size:17px;line-height:1}
.card .cs{font-size:16px;line-height:1.1}
.card.red{color:#d02b2b}
.card.joker .jk{writing-mode:vertical-rl;font-weight:700;font-size:13px;margin-top:2px}
.card.ok{cursor:pointer}
.card.ok:hover{transform:translateY(-3px)}
.card.sel{transform:translateY(-14px);box-shadow:0 0 0 3px #f5a623}
#side{flex:none;width:300px;border-left:1px solid var(--line);display:flex;flex-direction:column;min-width:0}
#log{flex:1;overflow-y:auto;padding:8px 12px;word-break:break-word}
.ln{margin:4px 0}
.ln.sys{color:var(--dim);font-style:italic;text-align:center}
.ln.head{font-weight:700;border-top:1px solid var(--line);padding-top:6px;margin-top:10px}
.ln.pass{color:var(--dim)}
.ln.bomb{color:#d64541;font-weight:600}
.ln.secret{color:#b7791f;background:rgba(217,164,50,.12);padding:3px 8px;border-radius:6px}
@media(max-width:900px){
  #main{flex-direction:column}
  #side{width:auto;height:34%;border-left:0;border-top:1px solid var(--line)}
}
`;

const BODY = `<div id="game" hidden>
  <div id="bar">
    <b id="who"></b><span id="phase" class="dim"></span><span id="stake" class="dim"></span>
    <span id="call" class="grp"></span><span id="holes" class="grp"></span>
    <span class="gap"></span><span id="mine"></span>
  </div>
  <div id="main">
    <div id="table">
      <div id="opps"></div>
      <div id="prompt"></div>
      <div id="me"><div id="meSeat"></div><div id="hand"></div></div>
    </div>
    <div id="side"><div id="log"></div></div>
  </div>
</div>`;

const JS = `
const SUIT=${SUITS},RANK=${RANKS},SMALL=${SMALL},BIG=${BIG},MAXD=${MAX_DOUBLINGS};
let T={},seats=[],hand=[],phase='bid',turn=null,topSeat=null,base=1,bombs=0,call=null,holes=[],busy=new Set();
let ask=null,sel=[],verdict=null,noHint=false,overMsg=null;
const seatOf=n=>seats.find(s=>s.seat===n);
const me=()=>seats.find(s=>s.me);
const known=()=>seats.some(s=>s.role||s.hidden);
const fill=(t,v)=>(t||'').replace(/\\{(\\w+)\\}/g,(_,k)=>v[k]==null?'':String(v[k]));
const isJoker=c=>c.rank>=SMALL;
const isRed=c=>c.rank===BIG||c.suit==='heart'||c.suit==='diamond';
const jokerName=c=>c.rank===BIG?T.bigJoker:T.smallJoker;
const face=c=>isJoker(c)?(c.rank===BIG?'\\u2605':'\\u2606'):SUIT[c.suit]+RANK[c.rank];
const sameIds=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
function chip(c){
  const e=el('span','chip'+(isRed(c)?' red':''),face(c));
  e.title=isJoker(c)?jokerName(c):face(c);
  return e;
}
function cardEl(c){
  const e=el('div','card'+(isRed(c)?' red':'')+(isJoker(c)?' joker':'')+(sel.includes(c.id)?' sel':''));
  e.dataset.id=c.id;
  if(isJoker(c)){
    e.append(el('div','jk',jokerName(c)));
    e.title=jokerName(c);
  }else e.append(el('div','cr',RANK[c.rank]),el('div','cs',SUIT[c.suit]));
  if(ask&&ask.k==='play'){
    e.classList.add('ok');
    e.addEventListener('click',()=>toggle(c.id));
    e.addEventListener('dblclick',()=>pickRank(c.rank));
  }
  return e;
}
function shownEl(s){
  const box=el('div','shown'+(s.seat===topSeat?' top':'')),m=s.shown;
  if(!m)return box;
  if(m.k==='bid')box.append(el('span','mark'+(m.bid?'':' dim'),m.bid?fill(T.bidOf,{n:m.bid}):T.bidNone));
  else if(m.k==='pass')box.append(el('span','mark dim',T.pass));
  else{
    const row=el('div','cards');
    m.cards.forEach(c=>row.append(chip(c)));
    box.append(row,el('span','mark'+(m.bomb?' bomb':''),m.label));
    if(m.bomb)box.classList.add('bomb');
  }
  return box;
}
function seatEl(s){
  const c=el('div','seat'+(s.me?' me':'')+(s.seat===turn&&phase!=='over'?' turn':'')+(busy.has(s.seat)?' busy':''));
  const info=el('div','info'),tags=el('div','tags'),head=el('div','sh');
  const r=s.hidden?'hidden':s.role;
  info.append(el('div','nm',s.name),tags);
  if(r)tags.append(el('span','tg r-'+r,T['role_'+r]));
  else if(known())tags.append(el('span','tg r-unknown',T.role_unknown));
  head.append(avatar(s.color,s.name),info);
  c.append(head,el('div','st dim',fill(T.count,{n:s.cards})),shownEl(s),el('div','dots','\\u2026'));
  if(busy.has(s.seat))c.title=T.thinking;
  return c;
}
function drawBar(){
  const t=turn===null?null:seatOf(turn),m=me(),r=m&&(m.hidden?'hidden':m.role);
  $('who').textContent=phase==='over'||!t?'':t.me?T.yourTurn:t.name;
  $('phase').textContent=T['phase_'+phase]||'';
  $('stake').textContent=phase!=='bid'&&known()?fill(T.stake,{base,mult:Math.pow(2,Math.min(MAXD,bombs))}):'';
  $('call').replaceChildren(...(call?[el('span','dim',T.called+':'),chip(call)]:[]));
  $('call').title=call?T.calledTip:'';
  $('holes').replaceChildren(...(holes.length?[el('span','dim',T.holes+':'),...holes.map(chip)]:[]));
  $('mine').textContent=r?T['role_'+r]:'';
  $('mine').title=r?T['roleHint_'+r]:'';
}
function drawOpps(){
  const i=seats.findIndex(s=>s.me);
  const others=i<0?seats:seats.slice(i+1).concat(seats.slice(0,i));
  $('opps').replaceChildren(...others.map(seatEl));
}
function drawMe(){
  const m=me(),h=$('hand');
  $('meSeat').replaceChildren(...(m?[seatEl(m)]:[]));
  h.style.setProperty('--ov',(hand.length>22?26:32)+'px');
  h.replaceChildren(...hand.map(cardEl));
}
function bidNow(n){
  ask=null;
  send({t:'bid',bid:n});
  render();
}
function playNow(ids){
  ask=null;sel=[];verdict=null;noHint=false;
  send({t:'play',ids});
  render();
}
// Each change of the picked cards asks main whether they make a play; the answer is used only if it is still the pick.
function setSel(next){
  sel=next;verdict=null;noHint=false;
  document.querySelectorAll('#hand .card').forEach(e=>e.classList.toggle('sel',sel.includes(Number(e.dataset.id))));
  drawPrompt();
  if(sel.length)send({t:'check',ids:sel.slice()});
}
function toggle(id){
  setSel(sel.includes(id)?sel.filter(x=>x!==id):sel.concat(id));
}
function pickRank(rank){
  const ids=hand.filter(c=>c.rank===rank).map(c=>c.id).filter(id=>!sel.includes(id));
  if(ids.length)setSel(sel.concat(ids));
}
function drawPrompt(){
  const p=$('prompt');
  p.replaceChildren();
  if(overMsg){
    const head=el('div','',overMsg.title),again=el('button','primary',T.again),text=el('div','dim',overMsg.text);
    head.id='over';
    text.id='overText';
    again.addEventListener('click',()=>send({t:'again'}));
    p.append(head,text,again);
    return;
  }
  if(!ask){
    p.append(el('div','sub',T.waiting));
    return;
  }
  const acts=el('div','acts');
  const btn=(label,fn,cls,off)=>{
    const b=el('button',cls||'',label);
    b.disabled=!!off;
    b.addEventListener('click',fn);
    acts.append(b);
  };
  p.append(el('div','q',ask.title));
  if(ask.k==='bid'){
    btn(T.bidNone,()=>bidNow(0),'ghost');
    for(let n=ask.min;n<=ask.max;n++)btn(fill(T.bidOf,{n}),()=>bidNow(n),n===ask.max?'primary':'');
    p.append(acts);
    return;
  }
  const v=verdict&&sameIds(verdict.ids,sel)?verdict:null;
  p.append(el('div','sub'+(v?(v.ok?' good':' bad'):''),sel.length===0?(noHint?T.noHint:T.pickHint):v?v.label:''));
  btn(T.play,()=>playNow(sel.slice()),'primary',!(v&&v.ok));
  btn(T.pass,()=>playNow([]),'ghost',ask.lead);
  btn(T.hint,()=>send({t:'hint'}));
  btn(T.clear,()=>setSel([]),'ghost',sel.length===0);
  p.append(acts);
}
function render(){
  drawBar();
  drawOpps();
  drawMe();
  drawPrompt();
}
function addLine(m){
  const r=el('div','ln '+m.tone),log=$('log');
  if(m.tone==='say'&&m.seat!==null){
    const s=seatOf(m.seat),who=el('b','',(s?s.name:String(m.seat))+': ');
    if(s)who.style.color=s.color;
    r.append(who,document.createTextNode(m.text));
  }else r.textContent=m.text;
  log.append(r);
  while(log.children.length>400)log.firstChild.remove();
  log.scrollTop=log.scrollHeight;
}
gameApi.onMsg(m=>{
  if(m.kind==='lobby'){
    T=m.text;seats=[];hand=[];holes=[];call=null;ask=null;sel=[];verdict=null;noHint=false;overMsg=null;busy=new Set();
    phase='bid';turn=null;topSeat=null;
    document.title=m.text.title;
    $('log').replaceChildren();$('prompt').replaceChildren();
    showLobby(m,[$('game')]);
  }else if(m.kind==='state'){
    $('lobby').hidden=true;$('game').hidden=false;
    seats=m.seats;hand=m.hand;phase=m.phase;turn=m.turn;topSeat=m.top;base=m.base;bombs=m.bombs;call=m.call;holes=m.holes;
    sel=sel.filter(id=>hand.some(c=>c.id===id));
    render();
  }else if(m.kind==='line')addLine(m);
  else if(m.kind==='thinking'){busy=new Set(m.seats);drawOpps()}
  else if(m.kind==='ask'){
    ask=m.ask;sel=[];verdict=null;noHint=false;
    render();
  }else if(m.kind==='verdict'){
    if(ask&&ask.k==='play'&&sameIds(m.ids,sel)){
      verdict=m;
      drawPrompt();
    }
  }else if(m.kind==='hint'){
    if(ask&&ask.k==='play'){
      sel=m.ids.slice();
      verdict=m.ids.length?{ids:m.ids,ok:true,label:m.label}:null;
      noHint=!m.ids.length;
      document.querySelectorAll('#hand .card').forEach(e=>e.classList.toggle('sel',sel.includes(Number(e.dataset.id))));
      drawPrompt();
    }
  }else if(m.kind==='over'){
    overMsg=m;ask=null;sel=[];verdict=null;
    render();
  }
});
`;

export const DOUDIZHU_PAGE = gamePage({ css: CSS, body: BODY, js: JS });
