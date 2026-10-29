/**
 * What a game window's page is made of: the styles, the lobby where the user chooses to play or watch and picks the
 * pets, and the script's few helpers. Every string a page shows comes from main as text and is put in with
 * textContent, never as markup.
 */

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1c20;--dim:#7a7f8a;--line:rgba(0,0,0,.12);
  --field:#f4f5f7;--accent:#4a90e2}
@media(prefers-color-scheme:dark){:root{--bg:#1e1f24;--fg:#ececf0;--dim:#8d93a0;--line:rgba(255,255,255,.14);
  --field:#2a2c33}}
[hidden]{display:none!important}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);
  font:13px/1.45 'Segoe UI','Microsoft YaHei',system-ui,sans-serif}
body{display:flex;flex-direction:column}
button,input{font:inherit;color:inherit;background:var(--field);border:1px solid var(--line);border-radius:6px;
  height:30px}
button{padding:0 14px;cursor:pointer}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.5;cursor:default}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.ghost{background:none}
input{padding:0 10px;outline:none}
input:focus{border-color:var(--accent)}
.dim{color:var(--dim)}
.av{flex:none;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:600;font-size:15px}
#lobby{flex:1;overflow-y:auto;padding:22px 26px;display:flex;flex-direction:column;gap:12px;max-width:640px;
  margin:0 auto;width:100%}
#lobby h2{margin:0;font-size:20px}
#lobby p{margin:0}
#lMode{display:flex;gap:8px;flex-wrap:wrap}
#lMode label{display:flex;align-items:center;padding:6px 14px;border:1px solid var(--line);border-radius:8px;
  cursor:pointer;background:var(--field)}
#lMode label.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
#lMode input{display:none}
#lGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
#lGrid label{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;
  cursor:pointer;background:var(--field)}
#lGrid label.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
#lGrid label.off{opacity:.45;cursor:default}
#lGrid input{display:none}
#lStart{align-self:flex-start;height:34px;padding:0 22px}
`;

const LOBBY = `<div id="lobby" hidden>
  <h2 id="lTitle"></h2>
  <p id="lRules" class="dim"></p>
  <div id="lMode" hidden></div>
  <p id="lPick"></p>
  <div id="lGrid"></div>
  <p id="lMinds" class="dim"></p>
  <button id="lStart" class="primary"></button>
</div>`;

const JS = `
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!=null)e.textContent=text;
  return e;
};
const avatar=(color,name)=>{const a=el('div','av',[...name][0]||'?');a.style.background=color;return a};
const send=m=>gameApi.send(m);
const enter=e=>e.key==='Enter'&&!e.isComposing&&e.keyCode!==229;
function showLobby(m,rest){
  rest.forEach(e=>{e.hidden=true});
  $('lobby').hidden=false;
  $('lTitle').textContent=m.text.title;
  $('lRules').textContent=m.text.rules||'';
  $('lMinds').textContent=m.minds?m.text.mindsOn:m.text.mindsOff;
  $('lStart').textContent=m.text.start;
  const boxes=[],modes=[];
  let play=true;
  const cap=()=>play?m.seats:m.watchSeats;
  const fresh=()=>{
    $('lPick').textContent=(play?m.text.pickPlay:m.text.pickWatch)||m.text.pick||'';
    let n=boxes.filter(b=>b.checked).length;
    for(let i=boxes.length-1;i>=0&&n>cap();i--)if(boxes[i].checked){boxes[i].checked=false;n--}
    boxes.forEach(b=>{
      b.parentElement.className=b.checked?'on':(n>=cap()?'off':'');
      b.disabled=!b.checked&&n>=cap();
    });
    modes.forEach(r=>{r.parentElement.className=(r.value==='play')===play?'on':''});
  };
  const both=m.text.modePlay&&m.text.modeWatch;
  $('lMode').hidden=!both;
  $('lMode').replaceChildren(...(both?[['play',m.text.modePlay],['watch',m.text.modeWatch]]:[]).map(([v,label])=>{
    const l=el('label'),r=document.createElement('input');
    r.type='radio';r.name='mode';r.value=v;r.checked=(v==='play')===play;
    r.addEventListener('change',()=>{play=v==='play';fresh()});modes.push(r);
    l.append(r,el('span','',label));
    return l;
  }));
  let left=cap();
  $('lGrid').replaceChildren(...m.choices.map(c=>{
    const label=el('label'),box=document.createElement('input');
    box.type='checkbox';box.value=c.id;box.checked=c.on&&left>0;if(box.checked)left--;
    box.addEventListener('change',fresh);boxes.push(box);
    label.append(box,avatar(c.color,c.name),el('span','',c.name));
    return label;
  }));
  fresh();
  $('lStart').onclick=()=>send({t:'start',pets:boxes.filter(b=>b.checked).map(b=>b.value),play});
}
`;

/** One page: the shared styles and helpers, then the game's own. */
export function gamePage(o: { css: string; body: string; js: string }): string {
  const head = '<!doctype html><meta charset="utf-8"><title></title>';
  return `${head}<style>${CSS}${o.css}</style>${LOBBY}${o.body}<script>${JS}${o.js}</script>`;
}
