import { parseWolfIn, type WolfIn } from '../../shared/gameIpc';
import { SEATS } from '../../shared/teammate/werewolf';
import { GameWindow } from './gameWindow';
import type { GameServices } from './gameServices';
import { SceneWindow } from './sceneWindow';
import { WerewolfRoom } from './werewolfRoom';
import { WEREWOLF_PAGE } from './werewolfPage';

/** The werewolf game the user plays or watches with the pets, and the scenes the pets act out: a window each. */
export class GameCenter {
  private readonly wolfWindow: GameWindow<WolfIn>;
  private readonly wolf: WerewolfRoom;
  private readonly scenes: SceneWindow;

  constructor(services: GameServices) {
    this.wolf = new WerewolfRoom(services, (msg) => this.wolfWindow.post(msg));
    this.scenes = new SceneWindow(services);
    this.wolfWindow = new GameWindow<WolfIn>({
      page: WEREWOLF_PAGE, title: () => services.words().g.werewolfTitle, width: 1040, height: 680,
      parse: (raw) => parseWolfIn(raw, SEATS), onReady: () => this.wolf.lobby(), onMessage: (m) => this.wolf.on(m),
      onClosed: () => this.wolf.stop(),
    });
  }

  openWerewolf(): void {
    this.wolfWindow.open();
  }

  openMahjong(): void {
    this.scenes.open('mahjong');
  }

  destroy(): void {
    this.wolf.stop();
    this.wolfWindow.destroy();
    this.scenes.destroy();
  }
}
