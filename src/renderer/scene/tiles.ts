import * as PIXI from 'pixi.js';
import {
  CIRCLES, DRAGON_CHARS, FACE_BOX, MAN_NUMERALS, STICKS, TILE_DEPTH, TILE_H, TILE_W, WIND_CHARS, describeTile, type Ink, type Pip,
} from './tileArt';

type Ctx = CanvasRenderingContext2D;

const INK: Record<Ink, string> = { green: '#1f7a46', red: '#c0262d', blue: '#1c4f9c' };
const BLACK = '#26211b';
const IVORY = '#f7f0d9';
const CJK = '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Noto Sans SC",sans-serif';
const RADIUS = 8;
const TAU = Math.PI * 2;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const outline = (ctx: Ctx, h: number): void => roundRect(ctx, 0.75, 0.75, TILE_W - 1.5, h - 1.5, RADIUS);

/** The back of a tile: green, with a pale cap along the top edge. */
function drawBack(ctx: Ctx): void {
  const green = ctx.createLinearGradient(0, 0, 0, TILE_H);
  green.addColorStop(0, '#3aac78');
  green.addColorStop(1, '#1a5c3f');
  outline(ctx, TILE_H);
  ctx.fillStyle = green;
  ctx.fill();
  ctx.save();
  outline(ctx, TILE_H);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 250, 225, 0.85)';
  ctx.fillRect(0, 0, TILE_W, 8);
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  roundRect(ctx, 6, 13, TILE_W - 12, TILE_H - 19, 4);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(30, 40, 20, 0.6)';
  outline(ctx, TILE_H);
  ctx.stroke();
}

/** The body of a face up tile: ivory, standing on its green edge. */
function drawFaceBody(ctx: Ctx): void {
  const edge = ctx.createLinearGradient(0, TILE_H - TILE_DEPTH, 0, TILE_H);
  edge.addColorStop(0, '#2f9a68');
  edge.addColorStop(1, '#19583b');
  outline(ctx, TILE_H);
  ctx.fillStyle = edge;
  ctx.fill();
  const face = ctx.createLinearGradient(0, 0, TILE_W * 0.6, TILE_H);
  face.addColorStop(0, '#fffef6');
  face.addColorStop(1, '#eee4c8');
  outline(ctx, TILE_H - TILE_DEPTH);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(48, 36, 18, 0.6)';
  outline(ctx, TILE_H);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(48, 36, 18, 0.3)';
  outline(ctx, TILE_H - TILE_DEPTH);
  ctx.stroke();
}

const at = (p: Pip): { x: number; y: number } => ({ x: FACE_BOX.x + p.x * FACE_BOX.w, y: FACE_BOX.y + p.y * FACE_BOX.h });
const middle = (): { x: number; y: number } => ({ x: FACE_BOX.x + FACE_BOX.w / 2, y: FACE_BOX.y + FACE_BOX.h / 2 });

function glyph(ctx: Ctx, s: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `700 ${size}px ${CJK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function drawMan(ctx: Ctx, n: number): void {
  const { x } = middle();
  glyph(ctx, MAN_NUMERALS[n - 1] ?? '', x, FACE_BOX.y + FACE_BOX.h * 0.27, 34, BLACK);
  glyph(ctx, '萬', x, FACE_BOX.y + FACE_BOX.h * 0.73, 32, INK.red);
}

function drawPins(ctx: Ctx, n: number): void {
  const spec = CIRCLES[n - 1];
  if (!spec) return;
  const r = spec.r * FACE_BOX.w;
  for (const p of spec.pips) {
    const { x, y } = at(p);
    dot(ctx, x, y, r, INK[p.ink]);
    dot(ctx, x, y, r * 0.64, IVORY);
    dot(ctx, x, y, r * 0.38, INK[p.ink]);
  }
}

/** The bird on the one of bamboo, made of a few shapes. */
function drawBird(ctx: Ctx, fw: number, fh: number): void {
  const { x, y } = middle();
  const w = fw * FACE_BOX.w;
  const h = fh * FACE_BOX.h;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.2;
  (['red', 'blue', 'green'] as const).forEach((ink, i) => {
    ctx.strokeStyle = INK[ink];
    ctx.beginPath();
    ctx.moveTo(x - w * 0.05, y + h * 0.05);
    ctx.quadraticCurveTo(x - w * 0.25, y + h * (0.28 + i * 0.04), x - w * (0.42 - i * 0.05), y + h * 0.46);
    ctx.stroke();
  });
  ctx.fillStyle = INK.green;
  ctx.beginPath();
  ctx.ellipse(x, y + h * 0.02, w * 0.28, h * 0.2, -0.5, 0, TAU);
  ctx.fill();
  dot(ctx, x + w * 0.26, y - h * 0.22, w * 0.12, INK.green);
  dot(ctx, x + w * 0.22, y - h * 0.38, w * 0.05, INK.red);
  ctx.fillStyle = INK.red;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.36, y - h * 0.26);
  ctx.lineTo(x + w * 0.5, y - h * 0.2);
  ctx.lineTo(x + w * 0.36, y - h * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK.blue;
  ctx.beginPath();
  ctx.ellipse(x - w * 0.02, y, w * 0.17, h * 0.1, -0.5, 0, TAU);
  ctx.fill();
  dot(ctx, x + w * 0.29, y - h * 0.24, w * 0.025, IVORY);
}

function drawSticks(ctx: Ctx, n: number): void {
  const spec = STICKS[n - 1];
  if (!spec) return;
  if (n === 1) {
    drawBird(ctx, spec.w, spec.h);
    return;
  }
  const w = spec.w * FACE_BOX.w;
  const h = spec.h * FACE_BOX.h;
  for (const p of spec.pips) {
    const { x, y } = at(p);
    ctx.fillStyle = INK[p.ink];
    roundRect(ctx, x - w / 2, y - h / 2, w, h, w / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    roundRect(ctx, x - w * 0.3, y - h / 2 + 3, w * 0.22, h - 6, w * 0.11);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x + w / 2, y);
    ctx.stroke();
  }
}

function drawDragon(ctx: Ctx, n: number): void {
  const { x, y } = middle();
  if (n === 3) {
    ctx.strokeStyle = INK.blue;
    ctx.lineWidth = 3.2;
    roundRect(ctx, FACE_BOX.x + 4, FACE_BOX.y + 6, FACE_BOX.w - 8, FACE_BOX.h - 12, 5);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    roundRect(ctx, FACE_BOX.x + 10, FACE_BOX.y + 12, FACE_BOX.w - 20, FACE_BOX.h - 24, 3);
    ctx.stroke();
    return;
  }
  glyph(ctx, DRAGON_CHARS[n - 1] ?? '', x, y, 52, n === 1 ? INK.red : INK.green);
}

function drawFace(ctx: Ctx, kind: number): void {
  drawFaceBody(ctx);
  const { suit, n } = describeTile(kind);
  if (suit === 'man') drawMan(ctx, n);
  else if (suit === 'sou') drawSticks(ctx, n);
  else if (suit === 'pin') drawPins(ctx, n);
  else if (suit === 'wind') glyph(ctx, WIND_CHARS[n - 1] ?? '', middle().x, middle().y, 50, BLACK);
  else drawDragon(ctx, n);
}

/** The pictures of the tiles, made once and shared by every sprite: a face for each of the 34 kinds, and the back. */
export interface TileSet {
  face(kind: number): PIXI.Texture;
  back: PIXI.Texture;
  destroy(): void;
}

export function makeTiles(): TileSet {
  const faces = new Map<number, PIXI.Texture>();
  const make = (draw: (ctx: Ctx) => void): PIXI.Texture => {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    draw(ctx);
    return PIXI.Texture.from(canvas, { scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.ON });
  };
  const back = make(drawBack);
  return {
    back,
    face: (kind) => {
      let t = faces.get(kind);
      if (!t) {
        t = make((ctx) => drawFace(ctx, kind));
        faces.set(kind, t);
      }
      return t;
    },
    destroy: () => {
      back.destroy(true);
      for (const t of faces.values()) t.destroy(true);
      faces.clear();
    },
  };
}
