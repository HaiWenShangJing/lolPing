import * as PIXI from 'pixi.js';
import { STAGE, TABLE } from './layout';

type Ctx = CanvasRenderingContext2D;

/** The table and the dice are drawn at this many pixels to a pixel of the stage, so they stay sharp when it is zoomed. */
export const DECOR_SCALE = 2;
/** The table's art reaches this far past its edge, for the shadow. */
export const TABLE_PAD = 36;
export const DIE_SIZE = 28;

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  return { canvas, ctx };
}

const textureOf = (canvas: HTMLCanvasElement): PIXI.Texture =>
  PIXI.Texture.from(canvas, { scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.ON });

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The same noise every time, so the felt does not change from one start to the next. */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** The room: dark wood fading into the window's own colour at its edges, a warm light over the table, a lamp. */
function makeBackground(): PIXI.Texture {
  const { canvas, ctx } = canvasOf(STAGE.w, STAGE.h);
  ctx.fillStyle = '#1d1612';
  ctx.fillRect(0, 0, STAGE.w, STAGE.h);
  ctx.save();
  ctx.translate(STAGE.w / 2, 330);
  ctx.scale(1, 0.52);
  const wall = ctx.createRadialGradient(0, 0, 0, 0, 0, 700);
  wall.addColorStop(0, '#5b4230');
  wall.addColorStop(0.5, '#33241a');
  wall.addColorStop(0.9, '#1d1612');
  wall.addColorStop(1, '#1d1612');
  ctx.fillStyle = wall;
  ctx.fillRect(-STAGE.w, -700, STAGE.w * 2, 1400);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = 2;
  for (let x = 64; x < STAGE.w; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, STAGE.h);
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(STAGE.w / 2, 390, 0, STAGE.w / 2, 390, 470);
  glow.addColorStop(0, 'rgba(255, 214, 150, 0.22)');
  glow.addColorStop(1, 'rgba(255, 214, 150, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STAGE.w, STAGE.h);
  ctx.strokeStyle = '#2a1f17';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(STAGE.w / 2, 0);
  ctx.lineTo(STAGE.w / 2, 30);
  ctx.stroke();
  ctx.fillStyle = '#3a2a1e';
  ctx.beginPath();
  ctx.moveTo(STAGE.w / 2 - 20, 30);
  ctx.lineTo(STAGE.w / 2 + 20, 30);
  ctx.lineTo(STAGE.w / 2 + 44, 66);
  ctx.lineTo(STAGE.w / 2 - 44, 66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe2a8';
  ctx.beginPath();
  ctx.ellipse(STAGE.w / 2, 66, 44, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  return textureOf(canvas);
}

/** The table: a wooden rim with a shadow, and the green felt inside. */
function makeTable(): PIXI.Texture {
  const S = DECOR_SCALE;
  const { canvas, ctx } = canvasOf((TABLE.w + TABLE_PAD * 2) * S, (TABLE.h + TABLE_PAD * 2) * S);
  ctx.scale(S, S);
  const x = TABLE_PAD;
  const y = TABLE_PAD;
  const w = TABLE.w;
  const h = TABLE.h;
  const r = 44;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 26 * S;
  ctx.shadowOffsetY = 10 * S;
  const wood = ctx.createLinearGradient(0, y, 0, y + h);
  wood.addColorStop(0, '#a06b3f');
  wood.addColorStop(0.5, '#7a4c28');
  wood.addColorStop(1, '#4e301a');
  ctx.fillStyle = wood;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  const rnd = noise(7);
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 46; i++) {
    const gy = y + rnd() * h;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.bezierCurveTo(x + w * 0.3, gy + rnd() * 6 - 3, x + w * 0.7, gy + rnd() * 6 - 3, x + w, gy);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 230, 190, 0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r - 2);
  ctx.stroke();
  const fx = x + 16;
  const fy = y + 16;
  const fw = w - 32;
  const fh = h - 32;
  const fr = r - 14;
  const felt = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 40, x + w / 2, y + h * 0.45, w * 0.55);
  felt.addColorStop(0, '#26805a');
  felt.addColorStop(1, '#14513a');
  ctx.fillStyle = felt;
  roundRect(ctx, fx, fy, fw, fh, fr);
  ctx.fill();
  ctx.save();
  roundRect(ctx, fx, fy, fw, fh, fr);
  ctx.clip();
  for (let i = 0; i < 4200; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(fx + rnd() * fw, fy + rnd() * fh, 1.2, 1.2);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 3;
  roundRect(ctx, fx, fy, fw, fh, fr);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(230, 200, 120, 0.35)';
  ctx.lineWidth = 1.2;
  roundRect(ctx, fx + 8, fy + 8, fw - 16, fh - 16, fr - 6);
  ctx.stroke();
  return textureOf(canvas);
}

const PIP_CELLS: readonly (readonly [number, number][])[] = [
  [[1, 1]],
  [[0, 0], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 0], [2, 0], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
];

/** The six faces of a die. */
function makeDice(): PIXI.Texture[] {
  const S = DECOR_SCALE;
  return PIP_CELLS.map((cells, i) => {
    const { canvas, ctx } = canvasOf(DIE_SIZE * S, DIE_SIZE * S);
    ctx.scale(S, S);
    const body = ctx.createLinearGradient(0, 0, DIE_SIZE, DIE_SIZE);
    body.addColorStop(0, '#fffef6');
    body.addColorStop(1, '#e6dcc0');
    roundRect(ctx, 1, 1, DIE_SIZE - 2, DIE_SIZE - 2, 6);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.55)';
    ctx.stroke();
    const red = i === 0 || i === 3;
    for (const [cx, cy] of cells) {
      ctx.fillStyle = red ? '#c0262d' : '#2a2420';
      ctx.beginPath();
      ctx.arc(DIE_SIZE * (0.27 + cx * 0.23), DIE_SIZE * (0.27 + cy * 0.23), i === 0 ? 5.2 : 2.9, 0, Math.PI * 2);
      ctx.fill();
    }
    return textureOf(canvas);
  });
}

/** The room, the table and the dice: art that does not change, made once. */
export interface Decor {
  bg: PIXI.Texture;
  table: PIXI.Texture;
  dice: PIXI.Texture[];
  destroy(): void;
}

export function makeDecor(): Decor {
  const bg = makeBackground();
  const table = makeTable();
  const dice = makeDice();
  return {
    bg,
    table,
    dice,
    destroy: () => {
      bg.destroy(true);
      table.destroy(true);
      for (const d of dice) d.destroy(true);
    },
  };
}
