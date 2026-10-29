import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { preloadPath } from '../paths';
import {
  PET_CH, parseLoungeGroup, parseLoungeSend, type LoungeInit, type LoungeMsg, type LoungeText,
} from '../../shared/petIpc';
import type { PetId } from '../../shared/teammate/pet';
import { GROUP_MEMBERS_MIN, GROUP_NAME_MAX, MAIN_ROOM, type PetGroup } from '../../shared/teammate/petGroups';
import type { RoomLine } from '../../shared/teammate/petSociety';
import type { RoomEvent } from './petSociety';

/** What the lounge reads from and says to: the society of pets. */
export interface LoungeSource {
  transcript(): readonly RoomLine[];
  groups(): readonly PetGroup[];
  /** Who can be spoken to now in each room (`MAIN_ROOM` and every group id). */
  rosters(): Record<string, PetId[]>;
  onEvent(fn: (e: RoomEvent) => void): () => void;
  /** The user speaks in a room; false when there was nobody to hear it. */
  send(room: string, to: PetId | 'all', text: string): boolean;
  saveGroup(input: { id: string | null; name: string; members: readonly string[] }): PetGroup | null;
  deleteGroup(id: string): boolean;
  /** The words and the pets' names in the user's language, read each time the window opens. */
  words(): { text: LoungeText; names: Record<PetId, string> };
}

/** Everything in the page is put in with textContent, so nothing a pet or the user says is ever read as markup. */
const PAGE = `<!doctype html><meta charset="utf-8"><title></title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1c20;--dim:#7a7f8a;--line:rgba(0,0,0,.12);--field:#f4f5f7}
@media(prefers-color-scheme:dark){:root{--bg:#1e1f24;--fg:#ececf0;--dim:#8d93a0;--line:rgba(255,255,255,.14);--field:#2a2c33}}
[hidden]{display:none!important}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.45 'Segoe UI','Microsoft YaHei',system-ui,sans-serif}
body{display:flex;flex-direction:column;position:relative}
#tabs{display:flex;gap:4px;padding:6px 8px 0;border-bottom:1px solid var(--line);overflow-x:auto;flex:none}
#tabs button{height:28px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;background:none;padding:0 10px;white-space:nowrap}
#tabs button.cur{background:var(--field);border-color:var(--line);font-weight:600}
#tabs .gap{flex:1}
#tabs .tool{color:var(--dim);padding:0 8px}
#who{padding:5px 14px;color:var(--dim);font-size:12px;border-bottom:1px solid var(--line)}
#log{flex:1;overflow-y:auto;padding:10px 14px;word-break:break-word}
.row{margin:5px 0}
.t{color:var(--dim);font-size:11px;margin-right:6px}
.to,.note{color:var(--dim)}
.note{font-style:italic}
#empty{padding:12px 14px;color:var(--dim);border-top:1px solid var(--line)}
#form{display:flex;gap:6px;padding:8px;border-top:1px solid var(--line)}
select,input,button{font:inherit;color:inherit;background:var(--field);border:1px solid var(--line);border-radius:6px;height:30px;box-sizing:border-box}
select{max-width:130px;padding:0 4px}
input{flex:1;min-width:0;padding:0 10px;outline:none}
input:focus,select:focus{border-color:#4a90e2}
button{padding:0 14px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
#edit{position:absolute;inset:0;background:var(--bg);padding:16px 18px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}
#edit h3{margin:0 0 2px;font-size:15px}
#edit label.f{display:flex;flex-direction:column;gap:4px}
#eMembers{display:flex;flex-direction:column;gap:2px}
#eMembers label{display:flex;align-items:center;gap:8px;padding:3px 2px}
#eMembers input{flex:none;width:16px;height:16px;padding:0}
#eHint{color:var(--dim);font-size:12px}
#eBtns{display:flex;gap:6px;margin-top:6px}
#eBtns .sp{flex:1}
#eDel.arm{border-color:#d0463a;color:#d0463a}
</style><div id="tabs"></div><div id="who" hidden></div><div id="log"></div><div id="empty" hidden></div>
<div id="form" hidden><select id="to"></select><input id="box" maxlength="200" autofocus><button id="send"></button></div>
<div id="edit" hidden><h3 id="eTitle"></h3>
<label class="f"><span id="eNameL"></span><input id="eName" maxlength="${GROUP_NAME_MAX}"></label>
<div id="eMembersL"></div><div id="eMembers"></div><div id="eHint"></div>
<div id="eBtns"><button id="eDel" hidden></button><span class="sp"></span><button id="eCancel"></button><button id="eSave"></button></div></div>
<script>
const $=id=>document.getElementById(id);
const log=$('log'),to=$('to'),box=$('box'),btn=$('send'),empty=$('empty'),form=$('form'),tabs=$('tabs'),who=$('who'),edit=$('edit');
const eName=$('eName'),eMembers=$('eMembers'),eSave=$('eSave'),eDel=$('eDel');
const MAIN='${MAIN_ROOM}',MIN=${GROUP_MEMBERS_MIN};
const hue={user:'#7a828e',whale:'#2f8fd0',naiwa:'#3a9a4a',shenshen:'#8a5bd0',airi:'#d0568a',hiyori:'#d08a22',haru:'#2fa38a',mao:'#6a4fb0',rice:'#c0432b',senko:'#d9774a',mark:'#9a6b3f'};
let init=null,groups=[],rosters={},cur=MAIN,editing=null,making=null;
const store={},unread=new Set();
const nameOf=id=>id==='user'?init.text.you:(init.names[id]||id);
const roomName=r=>{const g=groups.find(x=>x.id===r);return r===MAIN?init.text.main:g?g.name:r};
function span(cls,text){const s=document.createElement('span');if(cls)s.className=cls;s.textContent=text;return s}
function button(text,cls,fn){const b=document.createElement('button');b.type='button';b.textContent=text;if(cls)b.className=cls;b.addEventListener('click',fn);return b}
function rowOf(l){
  const row=document.createElement('div');row.className='row '+l.kind;
  const name=document.createElement('b');name.textContent=nameOf(l.from);
  if(hue[l.from])name.style.color=hue[l.from];
  row.append(span('t',new Date(l.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})),name);
  if(l.kind==='note')row.append(span('',' '+init.text.noted+' '+l.text));
  else{
    if(l.to)row.append(span('to',' \\u2192 '+(l.to==='all'?init.text.everyone:nameOf(l.to))));
    row.append(span('',': '+l.text));
  }
  return row;
}
function addLine(l){
  const list=store[l.room]||(store[l.room]=[]);
  list.push(l);
  if(list.length>200)list.shift();
  if(l.room!==cur){
    if(l.kind==='say'&&l.from!=='user'){unread.add(l.room);renderTabs()}
    return;
  }
  const near=log.scrollHeight-log.scrollTop-log.clientHeight<40;
  log.append(rowOf(l));
  while(log.childElementCount>200)log.firstElementChild.remove();
  if(near||l.from==='user')log.scrollTop=log.scrollHeight;
}
function renderTabs(){
  const items=[MAIN,...groups.map(g=>g.id)].map(r=>button(roomName(r)+(unread.has(r)?' \\u2022':''),r===cur?'cur':'',()=>select(r)));
  const gap=document.createElement('span');gap.className='gap';
  const tools=[];
  if(cur!==MAIN){const e=button('\\u270e','tool',()=>openEditor(cur));e.title=init.text.editGroup;tools.push(e)}
  const add=button('+','tool',()=>openEditor(null));add.title=init.text.newGroup;
  tabs.replaceChildren(...items,gap,...tools,add);
}
function header(){
  const g=groups.find(x=>x.id===cur);
  who.hidden=!g;
  if(g)who.textContent=init.text.members+': '+g.members.map(nameOf).join(', ');
  renderTabs();setRoster();
}
function select(room){
  cur=room;unread.delete(room);
  log.replaceChildren(...(store[room]||[]).map(rowOf));
  log.scrollTop=log.scrollHeight;
  header();
}
function setRoster(){
  const r=rosters[cur]||[];
  const keep=to.value;
  to.replaceChildren();
  for(const id of ['all',...r]){const o=document.createElement('option');o.value=id;o.textContent=id==='all'?init.text.everyone:nameOf(id);to.append(o)}
  to.value=r.includes(keep)?keep:'all';
  form.hidden=r.length===0;empty.hidden=r.length!==0;
  empty.textContent=cur===MAIN?init.text.empty:init.text.groupEmpty;
}
function submit(){const text=box.value.trim();if(!text)return;petApi.loungeSend({room:cur,to:to.value,text});box.value='';box.focus()}
function picked(){return [...eMembers.querySelectorAll('input:checked')].map(i=>i.value)}
function check(){eSave.disabled=eName.value.trim()===''||picked().length<MIN}
function openEditor(id){
  editing=id;
  const g=groups.find(x=>x.id===id);
  $('eTitle').textContent=id?init.text.editGroup:init.text.newGroup;
  eName.value=g?g.name:'';
  eMembers.replaceChildren(...Object.keys(init.names).map(p=>{
    const label=document.createElement('label'),c=document.createElement('input');
    c.type='checkbox';c.value=p;c.checked=!!g&&g.members.includes(p);c.addEventListener('change',check);
    label.append(c,span('',init.names[p]));
    return label;
  }));
  eDel.hidden=!id;eDel.className='';eDel.textContent=init.text.delete;
  check();edit.hidden=false;eName.focus();
}
function closeEditor(){edit.hidden=true;editing=null;box.focus()}
function saveEditor(){
  if(eSave.disabled)return;
  if(editing===null)making=new Set(groups.map(g=>g.id));
  petApi.loungeGroup({op:'save',id:editing,name:eName.value.trim(),members:picked()});
  closeEditor();
}
petApi.onLounge(m=>{
  if(m.kind==='init'){
    init=m.init;groups=init.groups;rosters=init.rosters;
    box.placeholder=init.text.hint;btn.textContent=init.text.send;
    $('eNameL').textContent=init.text.groupName;$('eMembersL').textContent=init.text.members;
    $('eHint').textContent=init.text.membersHint;$('eCancel').textContent=init.text.cancel;eSave.textContent=init.text.save;
    init.lines.forEach(l=>(store[l.room]||(store[l.room]=[])).push(l));
    select(MAIN);
  }else if(init&&m.kind==='line')addLine(m.line);
  else if(init&&m.kind==='state'){
    groups=m.groups;rosters=m.rosters;
    for(const r of Object.keys(store))if(r!==MAIN&&!groups.some(g=>g.id===r)){delete store[r];unread.delete(r)}
    const fresh=making&&groups.find(g=>!making.has(g.id));
    if(fresh){making=null;select(fresh.id)}
    else if(cur!==MAIN&&!groups.some(g=>g.id===cur))select(MAIN);
    else header();
  }
});
box.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();submit()}});
btn.addEventListener('click',submit);
eName.addEventListener('input',check);
eName.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();saveEditor()}});
$('eCancel').addEventListener('click',closeEditor);
eSave.addEventListener('click',saveEditor);
eDel.addEventListener('click',()=>{
  if(eDel.className!=='arm'){eDel.className='arm';eDel.textContent=init.text.sure;return}
  petApi.loungeGroup({op:'delete',id:editing});closeEditor();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!edit.hidden)closeEditor()});
</script>`;

/**
 * The window where the pets' talk can be read and joined: every line they say to each other (and to the user), the
 * notes they keep dimmed, and a box to speak to one pet or to all of them. One tab for the room everybody hears and one
 * for each group the user made there, where only the group's pets hear. Not a pet: a normal window, one at a time.
 */
export class PetLounge {
  private win: BrowserWindow | null = null;
  private stopEvents: (() => void) | null = null;

  constructor(private readonly source: LoungeSource) {
    ipcMain.on(PET_CH.loungeSend, this.onSend);
    ipcMain.on(PET_CH.loungeGroup, this.onGroup);
  }

  /** Opens the window, or brings the open one to the front. */
  open(): void {
    const existing = this.win;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const { text, names } = this.source.words();
    const win = new BrowserWindow({
      width: 460, height: 600, minWidth: 360, minHeight: 420, title: text.title, show: false, autoHideMenuBar: true,
      backgroundColor: '#1e1f24', webPreferences: { preload: preloadPath('pet'), spellcheck: false },
    });
    win.removeMenu();
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('page-title-updated', (event) => event.preventDefault());
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    win.webContents.once('did-finish-load', () => {
      const init: LoungeInit = {
        text, names, groups: [...this.source.groups()], rosters: this.source.rosters(), lines: [...this.source.transcript()],
      };
      this.post({ kind: 'init', init });
    });
    this.stopEvents = this.source.onEvent((e) => {
      this.post(
        e.kind === 'line'
          ? { kind: 'line', line: e.line }
          : { kind: 'state', groups: [...this.source.groups()], rosters: this.source.rosters() },
      );
    });
    win.on('closed', () => {
      if (this.win === win) this.release();
    });
    this.win = win;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`).catch(() => this.close());
  }

  close(): void {
    const win = this.win;
    this.release();
    if (win && !win.isDestroyed()) win.destroy();
  }

  destroy(): void {
    ipcMain.removeListener(PET_CH.loungeSend, this.onSend);
    ipcMain.removeListener(PET_CH.loungeGroup, this.onGroup);
    this.close();
  }

  private release(): void {
    this.win = null;
    this.stopEvents?.();
    this.stopEvents = null;
  }

  private post(msg: LoungeMsg): void {
    const win = this.win;
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(PET_CH.lounge, msg);
  }

  /** Whether `event` came from the page of the open window. */
  private ours(event: IpcMainEvent): boolean {
    const win = this.win;
    return !!win && !win.isDestroyed() && win.webContents.id === event.sender.id;
  }

  private readonly onSend = (event: IpcMainEvent, raw: unknown): void => {
    if (!this.ours(event)) return;
    const msg = parseLoungeSend(raw);
    if (msg) this.source.send(msg.room, msg.to, msg.text);
  };

  private readonly onGroup = (event: IpcMainEvent, raw: unknown): void => {
    if (!this.ours(event)) return;
    const msg = parseLoungeGroup(raw);
    if (!msg) return;
    if (msg.op === 'delete') this.source.deleteGroup(msg.id);
    else this.source.saveGroup({ id: msg.id, name: msg.name, members: msg.members });
  };
}
