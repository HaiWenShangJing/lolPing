import { parseSgsIn, parseWolfIn, type SgsIn, type WolfIn } from '../../shared/gameIpc';
import { SEATS } from '../../shared/teammate/werewolf';
import { GameWindow } from './gameWindow';
import type { GameServices } from './gameServices';
import { SanguoshaRoom } from './sanguoshaRoom';
import { SANGUOSHA_PAGE } from './sanguoshaPage';
import { SceneWindow } from './sceneWindow';
import { WerewolfRoom } from './werewolfRoom';
import { WEREWOLF_PAGE } from './werewolfPage';

/** The games the user plays or watches with the pets, and the scenes the pets act out: a window each. */
export class GameCenter {
  private readonly wolfWindow: GameWindow<WolfIn>;
  private readonly wolf: WerewolfRoom;
  private readonly sgsWindow: GameWindow<SgsIn>;
  private readonly sgs: SanguoshaRoom;
  private readonly scenes: SceneWindow;

  constructor(services: GameServices) {
    this.wolf = new WerewolfRoom(services, (msg) => this.wolfWindow.post(msg));
    this.sgs = new SanguoshaRoom(services, (msg) => this.sgsWindow.post(msg));
    this.scenes = new SceneWindow(services);
    this.wolfWindow = new GameWindow<WolfIn>({
      page: WEREWOLF_PAGE, title: () => services.words().g.werewolfTitle, width: 1040, height: 680,
      parse: (raw) => parseWolfIn(raw, SEATS), onReady: () => this.wolf.lobby(), onMessage: (m) => this.wolf.on(m),
      onClosed: () => this.wolf.stop(),
    });
    this.sgsWindow = new GameWindow<SgsIn>({
      page: SANGUOSHA_PAGE, title: () => services.words().g.sanguosha.title, width: 1180, height: 760,
      parse: parseSgsIn, onReady: () => this.sgs.lobby(), onMessage: (m) => this.sgs.on(m),
      onClosed: () => this.sgs.stop(),
    });
  }

  openWerewolf(): void {
    this.wolfWindow.open();
  }

  openSanguosha(): void {
    this.sgsWindow.open();
  }

  openMahjong(): void {
    this.scenes.open('mahjong');
  }

  destroy(): void {
    this.wolf.stop();
    this.sgs.stop();
    this.wolfWindow.destroy();
    this.sgsWindow.destroy();
    this.scenes.destroy();
  }
}
