import { CARD_NAMES, SUIT_SIGN, kindOf, rankLabel } from '../../shared/teammate/sanguoshaCards';
import { gamePage } from './gamePage';

/** Weapons, armour and horses look alike on a card. */
const KINDS = JSON.stringify(Object.fromEntries(CARD_NAMES.map((name) => {
  const kind = kindOf(name);
  return [name, kind === 'basic' || kind === 'trick' || kind === 'delayed' ? kind : 'gear'];
})));
const SUITS = JSON.stringify(SUIT_SIGN);
const RANKS = JSON.stringify(Array.from({ length: 13 }, (_, i) => rankLabel(i + 1)));

const CSS = `
#game{flex:1;display:flex;flex-direction:column;min-height:0}
#bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:7px 14px;border-bottom:1px solid var(--line);
  flex:none}
#bar b{font-size:15px}
#bar .gap{flex:1}
#mine{font-weight:600}
#main{flex:1;display:flex;min-height:0}
#table{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
#opps{flex:1;min-height:0;overflow-y:auto;padding:10px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;align-content:start}
.seat{position:relative;display:flex;flex-direction:column;gap:3px;padding:6px 8px;border:1px solid var(--line);
  border-radius:9px;background:var(--field);min-width:0}
.seat .sh{display:flex;align-items:center;gap:7px}
.seat .av{width:28px;height:28px;font-size:13px}
.seat .info{flex:1;min-width:0}
.seat .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seat .tags{display:flex;flex-wrap:wrap;gap:3px;min-height:15px}
.seat .st{font-size:11px}
.seat .gear{display:flex;flex-wrap:wrap;gap:3px}
.seat .dots{display:none;position:absolute;right:8px;top:3px;color:var(--accent);font-weight:700}
.seat.me{border-color:var(--accent)}
.seat.dead{opacity:.5}
.seat.dead .nm{text-decoration:line-through}
.seat.busy{border-color:var(--accent)}
.seat.busy .dots{display:block;animation:blink 1.1s infinite}
@keyframes blink{50%{opacity:.25}}
.seat.turn{box-shadow:0 0 0 2px #f5a623}
.seat.pick{cursor:pointer;border-style:dashed;border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.seat.pick:hover{background:rgba(74,144,226,.16)}
.seat.picked{cursor:pointer;border-color:#f5a623;background:rgba(245,166,35,.2);box-shadow:0 0 0 2px #f5a623}
.tg{font-size:10px;line-height:14px;padding:0 5px;border-radius:7px;background:rgba(127,127,127,.2);color:var(--dim);
  white-space:nowrap}
.tg.r-lord{background:rgba(217,164,50,.3);color:#b7791f}
.tg.r-loyalist{background:rgba(74,144,226,.2);color:#3b7dd8}
.tg.r-rebel{background:rgba(214,69,65,.2);color:#d64541}
.tg.r-traitor{background:rgba(142,84,176,.22);color:#8e54b0}
.tg.k-shu{background:rgba(214,69,65,.18);color:#d64541}
.tg.k-wei{background:rgba(74,144,226,.2);color:#3b7dd8}
.tg.k-wu{background:rgba(60,154,95,.2);color:#2f8a52}
.tg.k-qun{background:rgba(217,164,50,.25);color:#b7791f}
.hp{display:flex;gap:3px;min-height:11px}
.hp i{display:block;width:10px;height:10px;border-radius:50%;border:1px solid var(--dim)}
.hp i.f{background:#3c9a5f;border-color:#3c9a5f}
.hp.mid i.f{background:#d9a432;border-color:#d9a432}
.hp.low i.f{background:#d64541;border-color:#d64541}
.chip{font-size:11px;line-height:16px;padding:0 6px;border-radius:8px;background:rgba(127,127,127,.2);
  white-space:nowrap;cursor:default}
.chip.red{color:#d02b2b}
.chip.judge{border:1px dashed var(--dim);background:none}
.chip.ok{cursor:pointer;box-shadow:0 0 0 1px var(--accent)}
.chip.sel{background:rgba(245,166,35,.35);box-shadow:0 0 0 2px #f5a623}
.chip.skill{background:rgba(74,144,226,.16)}
#prompt{flex:none;border-top:1px solid var(--line);padding:8px 14px;display:flex;flex-direction:column;gap:6px;
  min-height:70px;max-height:46%;overflow-y:auto}
#prompt .q{font-weight:600}
#prompt .sub{color:var(--dim);font-size:12px}
#prompt .offer{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start}
#prompt .acts{display:flex;flex-wrap:wrap;gap:6px}
#prompt .heroes{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;width:100%}
.hero{padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--field);cursor:pointer}
.hero:hover{border-color:var(--accent)}
.hero .hn{font-weight:700}
.hero .sk{font-size:11px;margin-top:3px;color:var(--dim)}
.hero .sk b{color:var(--fg);font-weight:600}
#over{font-size:15px;font-weight:600}
#overText{white-space:pre-line}
#me{flex:none;border-top:1px solid var(--line);padding:6px 10px 8px;display:flex;flex-direction:column;gap:6px}
#meTop{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
#meTop .seat{flex:1;min-width:230px;max-width:420px}
#skills{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:1;min-width:160px}
#hand{display:flex;gap:6px;overflow-x:auto;padding:8px 2px 6px;min-height:112px}
.card{position:relative;flex:none;width:62px;height:92px;border:1px solid rgba(0,0,0,.25);border-radius:7px;
  background:#fbfbfd;color:#222;display:flex;flex-direction:column;align-items:center;overflow:hidden;
  user-select:none;transition:transform .1s}
.card .top{align-self:stretch;height:5px;background:#888}
.card.basic .top{background:#3c9a5f}
.card.trick .top{background:#d08a1f}
.card.delayed .top{background:#a255b0}
.card.gear .top{background:#4f79b5}
.card .cs{align-self:flex-start;font-weight:700;font-size:12px;padding:2px 0 0 4px}
.card.red .cs{color:#d02b2b}
.card .cn{flex:1;display:flex;align-items:center;text-align:center;font-weight:600;font-size:12px;line-height:1.15;
  padding:0 3px}
.card.ok{cursor:pointer;box-shadow:0 0 0 2px var(--accent)}
.card.ok:hover{transform:translateY(-3px)}
.card.dim{opacity:.5}
.card.sel{transform:translateY(-9px);box-shadow:0 0 0 3px #f5a623}
.card.back{background:repeating-linear-gradient(45deg,#4a6fa5,#4a6fa5 6px,#5a7fb5 6px,#5a7fb5 12px);color:#fff}
.card.back .cn{font-size:16px}
#side{flex:none;width:300px;border-left:1px solid var(--line);display:flex;flex-direction:column;min-width:0}
#log{flex:1;overflow-y:auto;padding:8px 12px;word-break:break-word}
.ln{margin:4px 0}
.ln.sys{color:var(--dim);font-style:italic;text-align:center}
.ln.turn{font-weight:700;border-top:1px solid var(--line);padding-top:6px;margin-top:10px}
.ln.hit{color:#d64541}
.ln.heal{color:#2f8a52}
.ln.secret{color:#b7791f;background:rgba(217,164,50,.12);padding:3px 8px;border-radius:6px}
@media(max-width:900px){
  #main{flex-direction:column}
  #side{width:auto;height:34%;border-left:0;border-top:1px solid var(--line)}
}
`;

const BODY = `<div id="game" hidden>
  <div id="bar">
    <b id="turn"></b><span id="who"></span><span id="phase" class="dim"></span><span id="pile" class="dim"></span>
    <span class="gap"></span><span id="mine"></span>
  </div>
  <div id="main">
    <div id="table">
      <div id="opps"></div>
      <div id="prompt"></div>
      <div id="me"><div id="meTop"><div id="meSeat"></div><div id="skills"></div></div><div id="hand"></div></div>
    </div>
    <div id="side"><div id="log"></div></div>
  </div>
</div>`;

const JS = `
const KIND=${KINDS},SUIT=${SUITS},RANK=${RANKS};
const dot=' \\u00b7 ';
let T={},seats=[],hand=[],pile=0,turn=-1,phase='start',turns=0,ask=null,sel=null,overMsg=null,busy=new Set();
const seatOf=n=>seats.find(s=>s.seat===n);
const me=()=>seats.find(s=>s.me);
const fill=(t,v)=>(t||'').replace('{n}',v);
const cname=n=>T['card_'+n]||n;
const sname=id=>T['skill_'+id]||id;
const hname=id=>T['hero_'+id]||'';
const isRed=c=>c.suit==='heart'||c.suit==='diamond';
const face=c=>SUIT[c.suit]+RANK[c.rank-1];
const tipOf=c=>cname(c.name)+': '+(T['tip_'+c.name]||'');
function cardEl(c,cls){
  const e=el('div','card '+(KIND[c.name]||'')+(isRed(c)?' red':'')+(cls?' '+cls:''));
  e.title=tipOf(c);
  e.append(el('div','top'),el('div','cs',face(c)),el('div','cn',cname(c.name)));
  return e;
}
function backEl(n){
  const e=el('div','card back');
  e.title=T.hiddenCard;
  e.append(el('div','cn',String(n)));
  return e;
}
function pips(hp,max){
  const p=el('div','hp'+(hp<=1?' low':hp===2?' mid':''));
  for(let i=0;i<max;i++)p.append(el('i',i<hp?'f':''));
  return p;
}
function canPickCard(id){
  return !!(ask&&ask.k==='play'&&sel&&sel.stage==='cards'&&sel.opt.cards.ids.includes(id));
}
function chip(c,mine,judge){
  const e=el('span','chip'+(isRed(c)?' red':'')+(judge?' judge':''),cname(c.name)+' '+face(c));
  e.title=tipOf(c);
  if(mine&&canPickCard(c.id)){
    e.classList.add('ok');
    if(sel.cards.includes(c.id))e.classList.add('sel');
    e.addEventListener('click',()=>toggleCard(c.id));
  }
  return e;
}
// The seats the user is picking from now: what may be picked, how many, and what has been picked.
function seatPick(){
  if(!ask)return null;
  if(ask.k==='seat')return {opts:ask.options,min:ask.min,max:ask.max,picked:sel.seats};
  if(ask.k==='play'&&sel&&sel.stage==='target'){
    const t=sel.use?sel.use.targets:sel.opt.targets;
    return {opts:t.options,min:t.min,max:t.max,picked:sel.targets};
  }
  return null;
}
function seatEl(s){
  const k=seatPick(),opt=!!k&&k.opts.includes(s.seat);
  const c=el('div','seat'+(s.me?' me':'')+(s.alive?'':' dead')+(s.seat===turn&&s.alive?' turn':'')
    +(busy.has(s.seat)?' busy':'')+(opt?(k.picked.includes(s.seat)?' picked':' pick'):''));
  const info=el('div','info'),tags=el('div','tags'),head=el('div','sh');
  info.append(el('div','nm',s.seat+'. '+s.name),tags);
  if(s.role)tags.append(el('span','tg r-'+s.role,T['role_'+s.role]));
  if(!s.alive)tags.append(el('span','tg',T.out));
  if(s.hero)tags.append(el('span','tg k-'+s.kingdom,hname(s.hero)+dot+T['kingdom_'+s.kingdom]));
  head.append(avatar(s.color,s.name),info);
  c.append(head);
  if(s.hero)c.append(pips(s.hp,s.maxHp));
  const st=[fill(T.hand,s.hand)];
  if(s.dist>0)st.push(fill(T.dist,s.dist));
  if(s.alive)st.push(fill(T.range,s.range));
  c.append(el('div','st dim',st.join(dot)));
  const gear=el('div','gear');
  s.equip.forEach(g=>gear.append(chip(g,s.me,false)));
  s.judges.forEach(j=>gear.append(chip({id:j.card.id,name:j.as,suit:j.card.suit,rank:j.card.rank},false,true)));
  if(gear.children.length)c.append(gear);
  if(opt)c.addEventListener('click',()=>clickSeat(s));
  c.append(el('div','dots','\\u2026'));
  if(busy.has(s.seat))c.title=T.thinking;
  return c;
}
function drawBar(){
  const t=seatOf(turn),m=me(),r=m&&m.role;
  $('turn').textContent=turns>0?fill(T.turnNo,turns):'';
  $('who').textContent=turns>0&&t?(t.me?T.yourTurn:t.name):'';
  $('phase').textContent=turns>0?(T['phase_'+phase]||''):'';
  $('pile').textContent=fill(T.pile,pile);
  $('mine').textContent=r?T['role_'+r]:'';
  $('mine').title=r?T['roleHint_'+r]:'';
}
function drawOpps(){
  const i=seats.findIndex(s=>s.me);
  const others=i<0?seats:seats.slice(i+1).concat(seats.slice(0,i));
  $('opps').replaceChildren(...others.map(seatEl));
}
function drawMe(){
  const m=me(),h=$('hand'),sk=$('skills');
  $('meSeat').replaceChildren();h.replaceChildren();sk.replaceChildren();
  if(!m)return;
  $('meSeat').append(seatEl(m));
  if(m.skills.length)sk.append(el('span','dim',T.yourSkills+':'));
  m.skills.forEach(id=>{const c=el('span','chip skill',sname(id));c.title=sname(id)+': '+(T['skillTip_'+id]||'');sk.append(c)});
  hand.forEach(c=>{
    let cls='';
    if(ask&&ask.k==='play'){
      if(sel&&sel.stage==='cards')cls=canPickCard(c.id)?'ok'+(sel.cards.includes(c.id)?' sel':''):'dim';
      else cls=ask.uses.some(u=>u.card===c.id)?'ok'+(sel&&sel.card===c.id?' sel':''):'dim';
    }
    const e=cardEl(c,cls);
    if(cls.startsWith('ok'))e.addEventListener('click',()=>clickHand(c));
    h.append(e);
  });
}
function toggleCard(id){
  const i=sel.cards.indexOf(id),max=sel.opt.cards.max;
  if(i>=0)sel.cards.splice(i,1);
  else if(sel.cards.length<max)sel.cards.push(id);
  else if(max===1)sel.cards.splice(0,1,id);
  else return;
  render();
}
function pickUse(u){
  sel.use=u;
  sel.stage=u.targets.max>0?'target':'ready';
}
function pickSkill(o){
  sel={stage:o.cards?'cards':o.targets?'target':'ready',opt:o,cards:[],targets:[]};
}
function clickHand(c){
  if(!ask||ask.k!=='play')return;
  if(sel&&sel.stage==='cards'){if(canPickCard(c.id))toggleCard(c.id);return}
  const us=ask.uses.filter(u=>u.card===c.id);
  if(!us.length)return;
  if(sel&&sel.card===c.id){sel=null;render();return}
  sel={stage:'choose',card:c.id,uses:us,cards:[],targets:[]};
  if(us.length===1)pickUse(us[0]);
  render();
}
function clickSeat(s){
  const k=seatPick();
  if(!k||!k.opts.includes(s.seat))return;
  const i=k.picked.indexOf(s.seat);
  if(i>=0)k.picked.splice(i,1);
  else if(k.picked.length<k.max)k.picked.push(s.seat);
  else if(k.max===1)k.picked.splice(0,1,s.seat);
  else return;
  if(ask.k==='play'&&k.min===1&&k.max===1&&k.picked.length===1){submit();return}
  render();
}
function reply(r){
  ask=null;sel=null;
  send({t:'reply',reply:r});
  render();
}
function submit(){
  if(sel.use){
    const r={k:'use',card:sel.use.card,as:sel.use.as,targets:sel.targets.slice()};
    if(sel.use.skill)r.skill=sel.use.skill;
    reply(r);
  }else reply({k:'skill',skill:sel.opt.skill,cards:sel.cards.slice(),targets:sel.targets.slice()});
}
function okReady(){
  if(ask.k==='cards')return sel.ids.length>=ask.min&&sel.ids.length<=ask.max;
  if(ask.k==='seat')return sel.seats.length>=ask.min&&sel.seats.length<=ask.max;
  if(!sel)return false;
  if(sel.stage==='ready')return true;
  if(sel.stage==='cards')return sel.cards.length>=sel.opt.cards.min&&sel.cards.length<=sel.opt.cards.max;
  if(sel.stage==='target'){const k=seatPick();return k.picked.length>=k.min&&k.picked.length<=k.max}
  return false;
}
function needOk(){
  if(ask.k!=='play')return true;
  if(!sel||sel.stage==='choose')return false;
  if(sel.stage==='target'){const k=seatPick();return !(k.min===1&&k.max===1)}
  return true;
}
function okClick(){
  if(ask.k==='cards')reply({k:'cards',ids:sel.ids.slice()});
  else if(ask.k==='seat')reply({k:'seat',seats:sel.seats.slice()});
  else if(sel.stage==='cards'&&sel.opt.targets){sel.stage='target';render()}
  else submit();
}
function toggleOffer(id){
  const i=sel.ids.indexOf(id);
  if(i>=0)sel.ids.splice(i,1);
  else if(sel.ids.length<ask.max)sel.ids.push(id);
  else if(ask.max===1)sel.ids.splice(0,1,id);
  else return;
  render();
}
function heroEl(h){
  const e=el('div','hero');
  e.append(el('div','hn',hname(h.id)+dot+T['kingdom_'+h.kingdom]),pips(h.hp,h.hp));
  h.skills.forEach(id=>{
    const r=el('div','sk');
    r.append(el('b','',sname(id)),document.createTextNode(': '+(T['skillTip_'+id]||'')));
    e.append(r);
  });
  e.addEventListener('click',()=>reply({k:'hero',hero:h.id}));
  return e;
}
function drawPrompt(){
  const p=$('prompt'),m=me();
  p.replaceChildren();
  if(overMsg){
    const head=el('div','',overMsg.title),again=el('button','primary',T.again);
    head.id='over';
    again.addEventListener('click',()=>send({t:'again'}));
    const text=el('div','dim',overMsg.text);
    text.id='overText';
    p.append(head,text,again);
    return;
  }
  if(!ask){
    p.append(el('div','sub',m&&!m.alive?T.spectating:T.waiting));
    return;
  }
  const hint=t=>p.append(el('div','sub',t));
  const acts=el('div','acts');
  const btn=(label,fn,cls,off,tip)=>{
    const b=el('button',cls||'',label);
    b.disabled=!!off;
    if(tip)b.title=tip;
    b.addEventListener('click',fn);
    acts.append(b);
  };
  p.append(el('div','q',ask.title));
  if(ask.k==='hero'){
    const row=el('div','offer heroes');
    row.append(...ask.heroes.map(heroEl));
    p.append(row);
    return;
  }
  if(ask.k==='area'){
    const row=el('div','offer');
    if(ask.hand>0){
      const b=backEl(ask.hand);
      b.classList.add('ok');
      b.addEventListener('click',()=>reply({k:'area',zone:'hand',card:null}));
      row.append(b);
    }
    ask.equip.forEach(c=>{
      const e=cardEl(c,'ok');
      e.addEventListener('click',()=>reply({k:'area',zone:'equip',card:c.id}));
      row.append(e);
    });
    ask.judges.forEach(j=>{
      const e=cardEl({id:j.card.id,name:j.as,suit:j.card.suit,rank:j.card.rank},'ok');
      e.addEventListener('click',()=>reply({k:'area',zone:'judge',card:j.card.id}));
      row.append(e);
    });
    p.append(row);
    return;
  }
  if(ask.k==='confirm'){
    btn(T.yes,()=>reply({k:'confirm',yes:true}),'primary');
    btn(T.no,()=>reply({k:'confirm',yes:false}),'ghost');
    p.append(acts);
    return;
  }
  if(ask.k==='cards'){
    const row=el('div','offer');
    ask.cards.forEach(c=>{
      const e=cardEl(c,'ok'+(sel.ids.includes(c.id)?' sel':''));
      e.addEventListener('click',()=>toggleOffer(c.id));
      row.append(e);
    });
    p.append(row);
    btn(T.ok,okClick,'primary',!okReady());
    if(ask.min===0)btn(T.pass,()=>reply({k:'cards',ids:[]}),'ghost');
    p.append(acts);
    return;
  }
  if(ask.k==='seat'){
    hint(ask.max===1?T.pickTarget:fill(T.pickTargets,ask.max));
    btn(T.ok,okClick,'primary',!okReady());
    if(ask.min===0)btn(T.pass,()=>reply({k:'seat',seats:[]}),'ghost');
    p.append(acts);
    return;
  }
  if(!sel){
    ask.skills.forEach(o=>btn(sname(o.skill),()=>{pickSkill(o);render()},'',false,T['skillTip_'+o.skill]));
    btn(T.endTurn,()=>reply({k:'end'}),'primary');
  }else{
    if(sel.stage==='choose'){
      const c=hand.find(x=>x.id===sel.card);
      hint((T.playAs||'').replace('{card}',c?cname(c.name):''));
      sel.uses.forEach(u=>btn(cname(u.as)+(u.skill?' ('+sname(u.skill)+')':''),()=>{pickUse(u);render()}));
    }else if(sel.stage==='target'){
      const k=seatPick();
      hint(k.max===1?T.pickTarget:fill(T.pickTargets,k.max));
    }else if(sel.stage==='cards')hint(T.pickCards);
    if(needOk())btn(T.ok,okClick,'primary',!okReady());
    btn(T.cancel,()=>{sel=null;render()},'ghost');
  }
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
    T=m.text;seats=[];hand=[];ask=null;sel=null;overMsg=null;turns=0;turn=-1;busy=new Set();
    document.title=m.text.title;
    $('log').replaceChildren();$('prompt').replaceChildren();
    showLobby(m,[$('game')]);
  }else if(m.kind==='state'){
    $('lobby').hidden=true;$('game').hidden=false;
    seats=m.seats;hand=m.hand;pile=m.pile;turn=m.turn;phase=m.phase;turns=m.turns;
    render();
  }else if(m.kind==='line')addLine(m);
  else if(m.kind==='thinking'){busy=new Set(m.seats);drawOpps()}
  else if(m.kind==='ask'){
    ask=m.ask;
    sel=ask&&ask.k==='cards'?{ids:[]}:ask&&ask.k==='seat'?{seats:[]}:null;
    render();
  }else if(m.kind==='over'){
    overMsg=m;ask=null;sel=null;
    render();
  }
});
`;

export const SANGUOSHA_PAGE = gamePage({ css: CSS, body: BODY, js: JS });
