// Cuts Doubao out of YChao18's sprite sheet, for tools/import-pets/import.mjs.
//
// The sheet is the art of https://github.com/YChao18/ChatGPT-Codex-Desktop-Pet-Doubao (MIT, Copyright (c) 2026 YChao18): a
// short brown-haired girl in black, in a grid of 192 × 208 cells, 8 columns by 11 rows. What is here is plain data and one
// drawing function, so the table can be read (and tested) on a checkout without @napi-rs/canvas: `ANIMS` says which cell
// each frame of each animation is, and `drawFrame` cuts it out.
//
// A frame is written `row.column` (counted from 0), then an `m` to mirror it, then `@dx,dy` to move it by that many
// pixels: `3.1m@0,-4` is the cell at row 3, column 1, turned around and 4 pixels up. An animation with a `mark` has it drawn
// over every frame, moving around the loop, so each of its frames is a file of its own.

/** The sheet at the commit lolPing was made against. */
export const SHEET_COMMIT = 'b5ede4730426f8fafecf0f0770ce41fd894138b7';
export const SHEET_BASE = `https://raw.githubusercontent.com/YChao18/ChatGPT-Codex-Desktop-Pet-Doubao/${SHEET_COMMIT}`;

const CELL_W = 192;
const CELL_H = 208;
/** How many cells each row of the sheet fills, from its first column. */
export const ROW_CELLS = [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];

// She spans pixels 23 to 168 of a cell and stands on pixel 202, so a frame takes 176 pixels from the 8th, and has room
// above her head for a hop and for the marks.
const CROP_X = 8;
const HEADROOM = 16;
export const FRAME_W = 176;
export const FRAME_H = CELL_H + HEADROOM;

const seq = (frames) => frames.split(' ');

export const ANIMS = {
  // One blink in sixteen frames; the cells 0.4 and 0.6 (a hair swing, a copy of 0.0) are left out.
  idle: { fps: 5, frames: seq('0.0 0.0 0.3 0.5 0.3 0.1 0.0 0.0 0.2 0.0 0.3 0.5 0.3 0.1 0.0 0.0') },
  walk: { fps: 16, frames: seq('1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7') },
  think: { fps: 4, frames: seq('8.0 8.1 8.4 8.4 8.2 8.2 8.4 8.3 8.4 8.1') },
  happy: { fps: 10, frames: seq('4.0 4.1@0,-6 4.2@0,-12 4.3@0,-8 4.4 6.3 6.3 0.0') },
  held: { fps: 8, frames: seq('4.2 4.3 4.2 4.1') },
  wave: { fps: 8, frames: seq('3.0 3.1 3.2 3.1 3.2 3.1 3.2 3.3') },
  dance: {
    fps: 10,
    frames: seq(
      '3.1 3.2@0,-4 3.1m 3.2m@0,-4 6.3@0,-4 4.2@0,-8 6.3@0,-4 4.3 3.1m 3.2m@0,-4 3.1 3.2@0,-4 6.3@0,-4 6.5 6.3@0,-4 0.0',
    ),
  },
  love: { fps: 8, mark: 'hearts', frames: seq('6.2 6.5 6.2 6.5 6.2@0,-2 6.5@0,-2 6.2 6.5 6.2 6.5 6.2@0,-2 6.5@0,-2') },
  shy: { fps: 6, frames: seq('9.0 9.1 9.2 9.3 9.4 9.5 9.6 9.7 9.7 9.6 9.5 9.4 9.3 9.2 9.1 9.0') },
  nap: { fps: 6, mark: 'zzz', frames: seq('5.0 5.0 5.1 5.1 5.3 5.3 5.4 5.4 5.3 5.3 5.1 5.1') },
  celebrate: {
    fps: 10,
    frames: seq('4.0 4.1@0,-6 4.2@0,-12 4.3@0,-8 4.4 6.3 4.0 4.1@0,-6 4.2@0,-12 4.3@0,-8 4.4 3.1 3.2 3.1 3.2 3.3'),
  },
  confused: { fps: 5, mark: 'question', frames: seq('6.1 6.1 8.2 8.2 8.2 6.1 6.1 8.2') },
  surprised: { fps: 8, mark: 'exclaim', frames: seq('0.0 7.3@0,-10 7.3@0,-14 7.3@0,-6 7.3 7.3 7.3 7.3') },
  sad: { fps: 5, frames: seq('5.0 5.1 5.2 5.3 5.4 5.5 5.6 5.7') },
  angry: { fps: 10, mark: 'anger', frames: seq('7.1@-2,0 7.1@2,0 7.1@-2,0 7.1@2,0 7.1@-2,0 7.1@2,0 8.2 8.2') },
  nod: { fps: 6, frames: seq('0.0 10.0 0.0 10.0 0.0 0.0') },
};

const STEP = /^(\d{1,2})\.(\d)(m?)(?:@(-?\d{1,3}),(-?\d{1,3}))?$/;

/** Reads a frame such as `3.1m@0,-4`; a cell the sheet does not have is an error. */
export function parseStep(step) {
  const match = STEP.exec(step);
  if (!match) throw new Error(`not a Doubao frame: ${step}`);
  const [, row, col, flip, dx, dy] = match;
  const cell = { row: Number(row), col: Number(col), flip: flip === 'm', dx: Number(dx ?? 0), dy: Number(dy ?? 0) };
  if (cell.row >= ROW_CELLS.length || cell.col >= ROW_CELLS[cell.row]) throw new Error(`the sheet has no cell ${row}.${col}`);
  return cell;
}

/** The file a frame is saved as: named for its cell when nothing is drawn over it, so the animations share the file. */
export function frameFile(name, index, step, mark) {
  if (mark) return `${name}-${String(index).padStart(2, '0')}.webp`;
  const { row, col, flip, dx, dy } = parseStep(step);
  return `r${row}c${col}${flip ? 'm' : ''}${dx || dy ? `_${dx}_${dy}` : ''}.webp`;
}

const TAU = Math.PI * 2;
const fade = (p) => Math.min(1, 3 * Math.sin(Math.PI * p));

// Marks are stickers: a white edge around a colour, so they show against her hair and against any desktop.
function sticker(g, color, width, trace) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  trace(g);
  g.strokeStyle = '#fff';
  g.lineWidth = width + 4;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  g.restore();
}

function dot(g, x, y, r, color) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = '#fff';
  g.fill();
  g.beginPath();
  g.arc(x, y, r - 1.5, 0, TAU);
  g.fillStyle = color;
  g.fill();
}

function heart(g, x, y, size, alpha) {
  const k = size / 18;
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.moveTo(x, y + 5 * k);
  g.bezierCurveTo(x - k, y + 4 * k, x - 9 * k, y - k, x - 9 * k, y - 5 * k);
  g.bezierCurveTo(x - 9 * k, y - 9 * k, x - 3 * k, y - 10 * k, x, y - 5 * k);
  g.bezierCurveTo(x + 3 * k, y - 10 * k, x + 9 * k, y - 9 * k, x + 9 * k, y - 5 * k);
  g.bezierCurveTo(x + 9 * k, y - k, x + k, y + 4 * k, x, y + 5 * k);
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = '#fff';
  g.lineWidth = 3.5;
  g.stroke();
  g.fillStyle = '#ff5c8a';
  g.fill();
  g.restore();
}

// What is drawn over an animation's frames; `phase` runs from 0 to 1 around the loop.
const MARKS = {
  // Four hearts rise beside her, each a quarter of the loop behind the one before.
  hearts(g, phase) {
    for (const [x, lag] of [[18, 0], [158, 0.25], [30, 0.5], [146, 0.75]]) {
      const p = (phase + lag) % 1;
      heart(g, x + 5 * Math.sin(TAU * p), 150 - 135 * p, 11 + 8 * Math.sin(Math.PI * p), fade(p));
    }
  },
  // Three z's float up from her head to the corner, growing as they go.
  zzz(g, phase) {
    for (let k = 0; k < 3; k++) {
      const p = (phase + k / 3) % 1;
      const s = 4 + 5 * p;
      const x = 112 + 44 * p;
      const y = 52 - 44 * p;
      g.save();
      g.globalAlpha = fade(p);
      sticker(g, '#6f9cff', 2.6 + p, (c) => {
        c.moveTo(x - s, y - s);
        c.lineTo(x + s, y - s);
        c.lineTo(x - s, y + s);
        c.lineTo(x + s, y + s);
      });
      g.restore();
    }
  },
  question(g, phase) {
    g.save();
    g.translate(140, 34 + 3 * Math.sin(TAU * phase));
    g.scale(1.3, 1.3);
    sticker(g, '#5b6cff', 3.4, (c) => {
      c.arc(0, -5, 7, Math.PI, Math.PI * 2.5);
      c.lineTo(0, 6);
    });
    dot(g, 0, 13, 3.4, '#5b6cff');
    g.restore();
  },
  exclaim(g, phase) {
    g.save();
    g.translate(140, 34);
    g.scale(1.2 + 0.15 * Math.sin(TAU * 2 * phase), 1.2 + 0.15 * Math.sin(TAU * 2 * phase));
    sticker(g, '#ff5a3c', 4.5, (c) => {
      c.moveTo(0, -13);
      c.lineTo(0, 3);
    });
    dot(g, 0, 10, 4, '#ff5a3c');
    g.restore();
  },
  // The comic anger mark: four arcs round a gap.
  anger(g, phase) {
    const d = 10 + 2.5 * Math.sin(TAU * 2 * phase);
    const r = d * 0.8;
    g.save();
    g.translate(138, 36);
    sticker(g, '#ff3b30', 3.6, (c) => {
      for (const [sx, sy, from] of [[-1, -1, 0], [1, -1, 0.5], [1, 1, 1], [-1, 1, 1.5]]) {
        c.moveTo(sx * d + r * Math.cos(from * Math.PI), sy * d + r * Math.sin(from * Math.PI));
        c.arc(sx * d, sy * d, r, from * Math.PI, (from + 0.5) * Math.PI);
      }
    });
    g.restore();
  },
};

export const MARK_NAMES = Object.keys(MARKS);

/** Draws one frame of an animation: the cell, moved or mirrored, with the animation's mark at `phase` (0 to 1) over it. */
export function drawFrame(createCanvas, sheet, step, mark, phase) {
  const { row, col, flip, dx, dy } = parseStep(step);
  const canvas = createCanvas(FRAME_W, FRAME_H);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.save();
  g.translate(dx, HEADROOM + dy);
  if (flip) {
    g.translate(FRAME_W, 0);
    g.scale(-1, 1);
  }
  g.drawImage(sheet, col * CELL_W + CROP_X, row * CELL_H, FRAME_W, CELL_H, 0, 0, FRAME_W, CELL_H);
  g.restore();
  if (mark) MARKS[mark](g, phase);
  return canvas;
}
