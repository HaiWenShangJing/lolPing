import { BrowserWindow } from 'electron';
import { IS_LINUX, IS_MAC, loadPage } from '../paths';
import { ringScript, type RingMsg } from '../../shared/ringMsg';

type Rect = { x: number; y: number; width: number; height: number };

/**
 * The overlay of a pet bout: a transparent click-through window over the two pets that draws their bars, the numbers
 * and the flashes. It is above the pets and their bubbles' level and takes nothing from the mouse.
 */
export class FightRing {
  private readonly win: BrowserWindow;
  /** The page has loaded and every message sent so far is on it; the next one chains after this. */
  private ready: Promise<void>;

  constructor(rect: Rect, captureExcluded: boolean) {
    this.win = new BrowserWindow({
      x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
      transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, minimizable: false,
      maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, show: false, type: IS_MAC ? 'panel' : 'toolbar',
      webPreferences: { backgroundThrottling: false, spellcheck: false },
    });
    this.win.setAlwaysOnTop(true, 'pop-up-menu');
    this.win.setIgnoreMouseEvents(true);
    if (captureExcluded) this.win.setContentProtection(true);
    if (IS_LINUX) this.win.setVisibleOnAllWorkspaces(true);
    if (IS_MAC) this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    this.win.webContents.on('will-navigate', (event) => event.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.ready = loadPage(this.win, 'ring').catch(() => undefined);
  }

  /** Delivers `msgs` to the page, in order; the window shows once the first have been drawn. */
  send(msgs: readonly RingMsg[]): void {
    const win = this.win;
    this.ready = this.ready
      .then(() => (win.isDestroyed() ? undefined : win.webContents.executeJavaScript(ringScript(msgs))))
      .then(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
      })
      .catch(() => undefined);
  }

  setCaptureExcluded(on: boolean): void {
    if (!this.win.isDestroyed()) this.win.setContentProtection(on);
  }

  close(): void {
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}
