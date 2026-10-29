import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { IS_LINUX, IS_MAC, preloadPath } from '../paths';
import { PET_CH, parsePetChat } from '../../shared/petIpc';
import type { PetId } from '../../shared/teammate/pet';
import { CHAT_SIZE, chatAt } from '../../shared/teammate/petHost';

type Rect = { x: number; y: number; width: number; height: number };

/** The box closes by itself if it is left open and unused this long. */
const IDLE_MS = 60_000;

/** The box's page; the hint is set as a JSON string, so nothing in it is read as markup. Enter sends (unless an IME is composing), Esc closes. */
const page = (hint: string): string => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:14px 'Segoe UI','Microsoft YaHei',system-ui,sans-serif}
body{display:flex;align-items:center;padding:6px;box-sizing:border-box}
input{flex:1;min-width:0;height:34px;box-sizing:border-box;padding:0 14px;border-radius:17px;border:1px solid rgba(0,0,0,.18);
background:#fff;color:#1c1c20;outline:none;box-shadow:0 4px 14px rgba(0,0,0,.25);font:inherit}
input:focus{border-color:#4a90e2}
</style><input id="i" maxlength="200" autofocus><script>
const i=document.getElementById('i');i.placeholder=${JSON.stringify(hint)};
i.addEventListener('keydown',e=>{
if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){if(i.value.trim())petApi.chat(i.value);petApi.closeChat()}
else if(e.key==='Escape')petApi.closeChat()});
</script>`;

/**
 * The little box a double tap on a pet opens: the user types a line to that pet, and the host agent answers in the
 * pet's bubble. It takes the keyboard, so unlike the pets it can be focused, and it goes away when it loses focus.
 */
export class PetChat {
  private win: BrowserWindow | null = null;
  private pet: PetId | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private captureExcluded = false;

  constructor(private readonly onSend: (pet: PetId, text: string) => void) {
    ipcMain.on(PET_CH.chat, this.onChat);
    ipcMain.on(PET_CH.chatClose, this.onClose);
  }

  /** Opens the box beside the pet whose window is `at`; one that is open goes away first. */
  open(pet: PetId, at: Rect, hint: string): void {
    this.close();
    const centre = { x: Math.round(at.x + at.width / 2), y: Math.round(at.y + at.height / 2) };
    const place = chatAt(at, screen.getDisplayNearestPoint(centre).workArea);
    const win = new BrowserWindow({
      x: place.x, y: place.y, width: CHAT_SIZE.width, height: CHAT_SIZE.height,
      transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      show: false, type: IS_MAC ? 'panel' : undefined,
      webPreferences: { preload: preloadPath('pet'), spellcheck: false },
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    if (this.captureExcluded) win.setContentProtection(true);
    if (IS_LINUX) win.setVisibleOnAllWorkspaces(true);
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('blur', () => {
      if (this.win === win) this.close();
    });
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    this.win = win;
    this.pet = pet;
    this.timer = setTimeout(() => this.close(), IDLE_MS);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(hint))}`).catch(() => this.close());
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const win = this.win;
    this.win = null;
    this.pet = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  setCaptureExcluded(on: boolean): void {
    this.captureExcluded = on;
    if (this.win && !this.win.isDestroyed()) this.win.setContentProtection(on);
  }

  destroy(): void {
    ipcMain.removeListener(PET_CH.chat, this.onChat);
    ipcMain.removeListener(PET_CH.chatClose, this.onClose);
    this.close();
  }

  private fromBox(event: IpcMainEvent): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.webContents.id === event.sender.id;
  }

  private readonly onChat = (event: IpcMainEvent, raw: unknown): void => {
    const pet = this.pet;
    const text = parsePetChat(raw);
    if (this.fromBox(event) && pet && text) this.onSend(pet, text);
  };

  private readonly onClose = (event: IpcMainEvent): void => {
    if (this.fromBox(event)) this.close();
  };
}
