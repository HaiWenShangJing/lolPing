import { BrowserWindow, screen } from 'electron';
import { IS_LINUX, IS_MAC } from '../paths';
import type { PetId } from '../../shared/teammate/pet';
import { SPEECH_SIZE, speechAt } from '../../shared/teammate/petControl';

type Rect = { x: number; y: number; width: number; height: number };

/** The bubble's page: the line and who says it are set by `say`, as text, so nothing an agent sends is read as markup. */
const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:14px/1.4 'Segoe UI','Microsoft YaHei',system-ui,sans-serif}
body{display:flex;align-items:flex-end;justify-content:center;padding-bottom:10px;box-sizing:border-box}
.b{position:relative;max-width:270px;padding:8px 12px;border-radius:14px;background:#fff;color:#1c1c20;
border:1px solid rgba(0,0,0,.14);box-shadow:0 4px 14px rgba(0,0,0,.25);word-break:break-word;white-space:pre-wrap}
.b::after{content:'';position:absolute;left:50%;bottom:-7px;width:12px;height:12px;background:#fff;
border-right:1px solid rgba(0,0,0,.14);border-bottom:1px solid rgba(0,0,0,.14);transform:translateX(-50%) rotate(45deg)}
#f{font-size:11px;opacity:.6;margin-bottom:2px}
#t{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
</style><div class="b"><div id="f"></div><div id="t"></div></div>
<script>window.say=(t,f)=>{document.getElementById('t').textContent=t;const e=document.getElementById('f');e.textContent=f;e.hidden=!f}</script>`;
const PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`;

interface Bubble {
  win: BrowserWindow;
  timer: ReturnType<typeof setTimeout> | null;
  /** The page has loaded and every line sent so far is on it; the next one chains after this. */
  ready: Promise<void>;
}

/**
 * The speech bubbles of the desktop pets: a small click-through window above a pet while it says what an agent told it
 * to. It is its own window, apart from the teammate's bubble, so an agent's pet never disturbs an ask on screen.
 */
export class PetSpeech {
  private readonly bubbles = new Map<PetId, Bubble>();
  private captureExcluded = false;

  /** `pet` is the pet's window; the bubble stays `ms` and follows it (see `move`). */
  show(id: PetId, text: string, from: string, pet: Rect, ms: number): void {
    let bubble = this.bubbles.get(id);
    if (bubble && !bubble.win.isDestroyed()) {
      if (bubble.timer) clearTimeout(bubble.timer);
    } else {
      bubble = this.create(pet);
      this.bubbles.set(id, bubble);
    }
    const open = bubble;
    open.timer = setTimeout(() => this.hide(id), ms);
    this.place(open.win, pet);
    const line = `window.say(${JSON.stringify(text)}, ${JSON.stringify(from)})`;
    open.ready = open.ready
      .then(() => (open.win.isDestroyed() ? undefined : open.win.webContents.executeJavaScript(line)))
      .then(() => {
        if (!open.win.isDestroyed()) open.win.showInactive();
      })
      .catch(() => undefined);
  }

  /** The pet moved: its bubble goes with it. */
  move(id: PetId, pet: Rect): void {
    const bubble = this.bubbles.get(id);
    if (bubble && !bubble.win.isDestroyed()) this.place(bubble.win, pet);
  }

  hide(id: PetId): void {
    const bubble = this.bubbles.get(id);
    if (!bubble) return;
    if (bubble.timer) clearTimeout(bubble.timer);
    this.bubbles.delete(id);
    if (!bubble.win.isDestroyed()) bubble.win.destroy();
  }

  hideAll(): void {
    for (const id of [...this.bubbles.keys()]) this.hide(id);
  }

  setCaptureExcluded(on: boolean): void {
    this.captureExcluded = on;
    for (const b of this.bubbles.values()) if (!b.win.isDestroyed()) b.win.setContentProtection(on);
  }

  destroy(): void {
    this.hideAll();
  }

  private place(win: BrowserWindow, pet: Rect): void {
    const centre = { x: Math.round(pet.x + pet.width / 2), y: Math.round(pet.y + pet.height / 2) };
    const at = speechAt(pet, screen.getDisplayNearestPoint(centre).workArea);
    win.setBounds({ x: at.x, y: at.y, width: SPEECH_SIZE.width, height: SPEECH_SIZE.height });
  }

  private create(pet: Rect): Bubble {
    const at = speechAt(pet, screen.getDisplayNearestPoint({ x: pet.x, y: pet.y }).workArea);
    const win = new BrowserWindow({
      x: at.x, y: at.y, width: SPEECH_SIZE.width, height: SPEECH_SIZE.height,
      transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, minimizable: false,
      maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, show: false, type: IS_MAC ? 'panel' : 'toolbar',
      webPreferences: { backgroundThrottling: false, spellcheck: false },
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setIgnoreMouseEvents(true);
    if (this.captureExcluded) win.setContentProtection(true);
    if (IS_LINUX) win.setVisibleOnAllWorkspaces(true);
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return { win, timer: null, ready: win.loadURL(PAGE_URL).then(() => undefined) };
  }
}
