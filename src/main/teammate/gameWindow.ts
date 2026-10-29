import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { preloadPath } from '../paths';
import { GAME_CH } from '../../shared/gameIpc';

export interface GameWindowOptions<In> {
  /** The page, plain HTML that talks through `gameApi`; everything in it is put in with textContent. */
  page: string;
  title: () => string;
  width: number;
  height: number;
  parse: (raw: unknown) => In | null;
  /** The page has loaded and is ready for its first message. */
  onReady: () => void;
  onMessage: (msg: In) => void;
  /** The window was closed by the user or by `close()`. */
  onClosed: () => void;
}

/** A normal window for one game, one at a time: it shows a page and passes messages both ways. */
export class GameWindow<In> {
  private win: BrowserWindow | null = null;

  constructor(private readonly options: GameWindowOptions<In>) {
    ipcMain.on(GAME_CH.send, this.onSend);
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
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
    const { options } = this;
    const win = new BrowserWindow({
      width: options.width, height: options.height, minWidth: 560, minHeight: 460, title: options.title(), show: false,
      autoHideMenuBar: true, backgroundColor: '#1e1f24', webPreferences: { preload: preloadPath('game'), spellcheck: false },
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
      if (this.win === win) options.onReady();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      options.onClosed();
    });
    this.win = win;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(options.page)}`).catch(() => this.close());
  }

  post(msg: unknown): void {
    const win = this.win;
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(GAME_CH.msg, msg);
  }

  close(): void {
    const win = this.win;
    if (!win) return;
    this.win = null;
    if (!win.isDestroyed()) win.destroy();
    this.options.onClosed();
  }

  destroy(): void {
    ipcMain.removeListener(GAME_CH.send, this.onSend);
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private readonly onSend = (event: IpcMainEvent, raw: unknown): void => {
    const win = this.win;
    if (!win || win.isDestroyed() || win.webContents.id !== event.sender.id) return;
    const msg = this.options.parse(raw);
    if (msg) this.options.onMessage(msg);
  };
}
