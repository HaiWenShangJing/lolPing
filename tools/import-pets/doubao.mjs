// Draws Doubao, a short-haired girl in a purple and blue hoodie, for tools/import-pets/import.mjs. She is an original
// character, not ByteDance's art: only the palette (the purple, blue and teal of Doubao's logo) is borrowed. Every frame
// is drawn with @napi-rs/canvas from a small rig (`Pose`), and an animation is a function from the loop's phase (0 to 1)
// to a pose.

const TAU = Math.PI * 2;
export const SIZE = 512;
const CX = SIZE / 2;
const GROUND = 468;
// The feet's resting line in the finished frame, and how much the drawing is scaled up to fill it.
const FLOOR = 482;
const ZOOM = 1;
const INK = '#1f2566';
const LINE = 6;
const PURPLE = '#a569ff';
const BLUE = '#1e37fc';
const TEAL = '#37e1be';
const SKIN = '#ffe3d1';
const HAIR = '#262c80';
const HAIR_INK = '#121850';
// A chibi: a wide head on a short hoodie, with the arms starting at the shoulders and the legs under the hem.
const HEAD = { cx: CX, top: 136, cheek: 266, bottom: 344, half: 114 };
const SHOULDER = { x: 64, y: 366 };
const HEM = 432;
const EYE_Y = 284;
const MOUTH_Y = 314;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wave = (p, phase = 0) => Math.sin(TAU * (p + phase));
/** 0 for a frame outside [from, to], rising to 1 and back inside it: the shape of one blink or one pop. */
const pulse = (p, from, to) => (p < from || p > to ? 0 : Math.sin((Math.PI * (p - from)) / (to - from)));
/** Where `p` is within a sliding window that wraps around the loop: 0 to 1 while it is inside, else -1. */
const windowAt = (p, start, length) => {
  const d = (((p - start) % 1) + 1) % 1;
  return d < length ? d / length : -1;
};

// ---- the shapes ----------------------------------------------------------------------------------------------------

function headPath(g) {
  const { cx, top, cheek, bottom, half } = HEAD;
  g.beginPath();
  g.moveTo(cx, top);
  g.bezierCurveTo(cx + half * 0.62, top, cx + half, cheek - 92, cx + half, cheek);
  g.bezierCurveTo(cx + half, cheek + 52, cx + half * 0.52, bottom, cx, bottom);
  g.bezierCurveTo(cx - half * 0.52, bottom, cx - half, cheek + 52, cx - half, cheek);
  g.bezierCurveTo(cx - half, cheek - 92, cx - half * 0.62, top, cx, top);
  g.closePath();
}

/** The hoodie: narrow at the shoulders, flaring a little to the hem. */
function torsoPath(g) {
  g.beginPath();
  g.moveTo(CX - 52, 350);
  g.lineTo(CX + 52, 350);
  g.quadraticCurveTo(CX + 70, 352, CX + 74, 380);
  g.lineTo(CX + 80, HEM - 18);
  g.quadraticCurveTo(CX + 82, HEM, CX + 62, HEM);
  g.lineTo(CX - 62, HEM);
  g.quadraticCurveTo(CX - 82, HEM, CX - 80, HEM - 18);
  g.lineTo(CX - 74, 380);
  g.quadraticCurveTo(CX - 70, 352, CX - 52, 350);
  g.closePath();
}

function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.95);
  g.bezierCurveTo(x - s * 1.55, y - s * 0.1, x - s * 0.75, y - s * 1.25, x, y - s * 0.5);
  g.bezierCurveTo(x + s * 0.75, y - s * 1.25, x + s * 1.55, y - s * 0.1, x, y + s * 0.95);
  g.closePath();
}

function sparklePath(g, x, y, r) {
  const k = r * 0.14;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + k, y - k, x + r, y);
  g.quadraticCurveTo(x + k, y + k, x, y + r);
  g.quadraticCurveTo(x - k, y + k, x - r, y);
  g.quadraticCurveTo(x - k, y - k, x, y - r);
  g.closePath();
}

function dropPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s * 1.5);
  g.bezierCurveTo(x + s * 0.2, y - s * 0.7, x + s * 0.95, y - s * 0.2, x + s * 0.95, y + s * 0.4);
  g.arc(x, y + s * 0.4, s * 0.95, 0, Math.PI, false);
  g.bezierCurveTo(x - s * 0.95, y - s * 0.2, x - s * 0.2, y - s * 0.7, x, y - s * 1.5);
  g.closePath();
}

/** The bob behind the head, ending in a soft curl at the jaw. `t` swings the two tips sideways, `d` lets them hang lower. */
function backHairPath(g, t, d) {
  g.beginPath();
  g.moveTo(CX, 108);
  g.bezierCurveTo(CX + 78, 108, CX + 140, 160, CX + 136, 252);
  g.bezierCurveTo(CX + 134, 300, CX + 128 + t, 330 + d, CX + 104 + t, 350 + d);
  g.quadraticCurveTo(CX + 70 + t, 356 + d, CX + 44, 338);
  g.lineTo(CX - 44, 338);
  g.quadraticCurveTo(CX - 70 + t, 356 + d, CX - 104 + t, 350 + d);
  g.bezierCurveTo(CX - 128 + t, 330 + d, CX - 134, 300, CX - 136, 252);
  g.bezierCurveTo(CX - 140, 160, CX - 78, 108, CX, 108);
  g.closePath();
}

/** A lock of hair that hangs down in front of the cheek; it starts under the fringe. */
function sideLockPath(g, side, t, d) {
  const x = (dx) => CX + side * dx;
  g.beginPath();
  g.moveTo(x(92), 236);
  g.bezierCurveTo(x(118), 234, x(130), 276, x(123 + t * side), 322 + d);
  g.bezierCurveTo(x(119 + t * side), 340 + d, x(97 + t * side), 340 + d, x(91 + t * side), 322 + d);
  g.bezierCurveTo(x(100), 296, x(98), 264, x(80), 244);
  g.closePath();
}

// The tips of the fringe, from the left to the right: [x from the middle, y].
const FRINGE = [[-120, 256], [-86, 242], [-48, 247], [-8, 239], [34, 247], [76, 240], [120, 256]];

/** The fringe over the forehead, its lower edge a row of scallops. Open, it is only that edge (to outline). */
function fringePath(g, dx, closed) {
  g.beginPath();
  g.moveTo(CX + dx + FRINGE[0][0], FRINGE[0][1]);
  for (let i = 1; i < FRINGE.length; i++) {
    const [x0, y0] = FRINGE[i - 1];
    const [x1, y1] = FRINGE[i];
    g.quadraticCurveTo(CX + dx + (x0 + x1) / 2, Math.min(y0, y1) - 38, CX + dx + x1, y1);
  }
  if (closed) {
    // Over the top of the head, inside the bob's outline.
    g.ellipse(CX + dx, 250, 126, 126, 0, 0.05, -Math.PI - 0.05, true);
    g.closePath();
  }
}

function hairFill(g) {
  const fill = g.createLinearGradient(CX - 90, 110, CX + 90, 340);
  fill.addColorStop(0, '#3d49c4');
  fill.addColorStop(0.5, HAIR);
  fill.addColorStop(1, '#1b2064');
  return fill;
}

/** A shape filled and then outlined, with the same path. */
function paint(g, fill, ink = INK, width = LINE) {
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (ink) {
    g.strokeStyle = ink;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
  }
}

// ---- the character -------------------------------------------------------------------------------------------------

// The hair is `tuft` in a pose: `sway` swings the ahoge and the bob's tips, `spread` lifts the ahoge, `droop` lets it all hang.

/** The ahoge: one strand standing up from the crown. It is drawn before the bob, which hides its root. */
function drawAhoge(g, tuft, faceX) {
  const { sway, spread, droop } = tuft;
  g.save();
  g.translate(CX + 10 + faceX * 0.3, 128);
  g.rotate(sway * 1.1 + droop * 0.9);
  g.scale(1 + 0.6 * (spread - 1), 1 + 0.6 * (spread - 1));
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-14, -26, -10, -50, 12, -62);
  g.lineCap = 'round';
  g.strokeStyle = HAIR_INK;
  g.lineWidth = 17;
  g.stroke();
  g.strokeStyle = '#3d49c4';
  g.lineWidth = 9;
  g.stroke();
  g.restore();
}

function drawBackHair(g, tuft) {
  backHairPath(g, tuft.sway * 40, tuft.droop * 8);
  paint(g, hairFill(g), HAIR_INK);
}

/** Everything of the hair that is in front of the face: the side locks, the fringe with its shine, and the clip. */
function drawFrontHair(g, tuft, faceX) {
  const dx = faceX * 0.3;
  for (const side of [-1, 1]) {
    sideLockPath(g, side, tuft.sway * 40, tuft.droop * 8);
    paint(g, hairFill(g), HAIR_INK, 5);
  }
  fringePath(g, dx, true);
  g.fillStyle = hairFill(g);
  g.fill();
  fringePath(g, dx, false);
  g.strokeStyle = HAIR_INK;
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
  g.beginPath();
  g.moveTo(CX + dx - 86, 204);
  g.quadraticCurveTo(CX + dx - 68, 152, CX + dx - 16, 144);
  g.strokeStyle = 'rgba(196,206,255,0.6)';
  g.lineWidth = 9;
  g.stroke();
  g.beginPath();
  g.moveTo(CX + dx + 34, 146);
  g.quadraticCurveTo(CX + dx + 62, 150, CX + dx + 82, 176);
  g.strokeStyle = 'rgba(196,206,255,0.4)';
  g.lineWidth = 6;
  g.stroke();
  // A teal bean (豆, as in 豆包) for a hair clip.
  g.save();
  g.translate(CX + dx + 74, 198);
  g.rotate(0.5);
  g.beginPath();
  g.ellipse(0, 0, 22, 10.5, 0, 0, TAU);
  paint(g, TEAL, INK, 4);
  g.beginPath();
  g.ellipse(-6, -3.5, 8, 2.8, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fill();
  g.restore();
}

/** A raised arm (a large `a`) is swung out and stretched, so that its hand clears the head instead of hiding behind it. */
function drawArm(g, side, arm) {
  const sx = CX + side * SHOULDER.x;
  const sy = SHOULDER.y;
  let tx;
  let ty;
  if (arm.to) {
    tx = arm.to.x;
    ty = arm.to.y;
  } else {
    const a = arm.a;
    const swing = a <= Math.PI / 2 ? a : Math.PI / 2 + (a - Math.PI / 2) * 0.62;
    const reach = (72 + 44 * clamp((a - 1.2) / 1.4, 0, 1)) * arm.len;
    tx = sx + side * Math.sin(swing) * reach;
    ty = sy + Math.cos(swing) * reach;
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(tx, ty);
  g.strokeStyle = INK;
  g.lineWidth = 38;
  g.stroke();
  g.strokeStyle = '#4d62ff';
  g.lineWidth = 27;
  g.stroke();
  g.beginPath();
  g.arc(tx, ty, 15, 0, TAU);
  paint(g, SKIN);
}

function drawFoot(g, side, foot) {
  const x = CX + side * 36 + foot.dx;
  const y = GROUND - 8 - foot.lift;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(CX + side * 36, HEM - 10);
  g.lineTo(x, y - 6);
  g.strokeStyle = INK;
  g.lineWidth = 30;
  g.stroke();
  g.strokeStyle = SKIN;
  g.lineWidth = 19;
  g.stroke();
  g.beginPath();
  g.ellipse(x + side * 3, y, 31, 17, 0, 0, TAU);
  paint(g, TEAL);
  g.beginPath();
  g.ellipse(x - 5, y - 6, 12, 4.5, -0.1, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fill();
}

function drawBody(g) {
  // The hood, behind the head: only its rim shows at the neck.
  g.beginPath();
  g.ellipse(CX, 352, 62, 19, 0, 0, TAU);
  paint(g, '#8566f0');
  torsoPath(g);
  const fill = g.createLinearGradient(CX - 80, 350, CX + 60, HEM);
  fill.addColorStop(0, '#b497ff');
  fill.addColorStop(0.45, '#7e8cff');
  fill.addColorStop(1, '#3452ff');
  g.fillStyle = fill;
  g.fill();
  g.save();
  torsoPath(g);
  g.clip();
  const shade = g.createLinearGradient(0, 380, 0, HEM);
  shade.addColorStop(0, 'rgba(20,28,150,0)');
  shade.addColorStop(1, 'rgba(20,28,150,0.34)');
  g.fillStyle = shade;
  g.fillRect(CX - 90, 380, 180, HEM - 376);
  // The ribbed hem.
  g.fillStyle = 'rgba(20,28,150,0.25)';
  g.fillRect(CX - 90, HEM - 13, 180, 16);
  g.restore();
  torsoPath(g);
  paint(g, null);
  // The pocket's seam and the two drawstrings.
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(CX - 48, 408);
  g.quadraticCurveTo(CX, 398, CX + 48, 408);
  g.strokeStyle = 'rgba(255,255,255,0.38)';
  g.lineWidth = 4;
  g.stroke();
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(CX + side * 13, 358);
    g.lineTo(CX + side * 15, 394);
    g.strokeStyle = INK;
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4.5;
    g.stroke();
  }
}

const EYE_X = 50;

function drawEye(g, side, eyes, faceX) {
  const x = CX + side * EYE_X + faceX + eyes.lx;
  const y = EYE_Y + eyes.ly;
  const k = eyes.size;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (eyes.kind === 'happy') {
    g.beginPath();
    g.arc(x, y + 9, 17 * k, Math.PI * 1.12, Math.PI * 1.88);
    g.strokeStyle = INK;
    g.lineWidth = 7.5;
    g.stroke();
    return;
  }
  if (eyes.kind === 'closed') {
    g.beginPath();
    g.arc(x, y - 5, 17 * k, Math.PI * 0.14, Math.PI * 0.86);
    g.strokeStyle = INK;
    g.lineWidth = 6.5;
    g.stroke();
    return;
  }
  if (eyes.kind === 'heart') {
    heartPath(g, x, y + 2, 17 * k);
    paint(g, '#ff4f86', '#c92a63', 4);
    g.beginPath();
    g.ellipse(x - 7 * k, y - 8 * k, 5 * k, 3.4 * k, -0.7, 0, TAU);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fill();
    return;
  }
  if (eyes.kind === 'shock') {
    g.beginPath();
    g.ellipse(x, y, 23 * k, 27 * k, 0, 0, TAU);
    paint(g, '#ffffff', INK, 5);
    g.beginPath();
    g.ellipse(x + eyes.lx * 0.2, y + 1, 8.5, 10, 0, 0, TAU);
    g.fillStyle = INK;
    g.fill();
    return;
  }
  const ry = 23 * k * Math.max(eyes.open, 0.07);
  g.beginPath();
  g.ellipse(x, y, 16 * k, ry, 0, 0, TAU);
  const iris = g.createLinearGradient(0, y - ry, 0, y + ry);
  iris.addColorStop(0, INK);
  iris.addColorStop(0.55, '#2f3fc4');
  iris.addColorStop(1, '#5a74ff');
  g.fillStyle = iris;
  g.fill();
  // The upper lash, with a flick at the outer corner.
  g.beginPath();
  g.ellipse(x, y, 16.5 * k, ry + 0.5, 0, Math.PI * 1.04, Math.PI * 1.96);
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.stroke();
  g.beginPath();
  g.moveTo(x + side * 15 * k, y - ry * 0.35);
  g.lineTo(x + side * 22 * k, y - ry * 0.62);
  g.lineWidth = 4.5;
  g.stroke();
  if (eyes.open > 0.45) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x - 5.5 * k, y - 9 * k * eyes.open, 6.4 * k, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(x + 5.5 * k, y + 9 * k * eyes.open, 3.2 * k, 0, TAU);
    g.fill();
  }
}

function drawBrows(g, brows, faceX, eyes) {
  if (!brows) return;
  g.lineCap = 'round';
  g.strokeStyle = INK;
  g.lineWidth = 5.5;
  for (const [side, ang] of [[-1, brows.l], [1, brows.r]]) {
    const x = CX + side * EYE_X + faceX + eyes.lx * 0.6;
    const y = EYE_Y - 30 + brows.y + eyes.ly * 0.4;
    // `ang` is how far the inner end is lowered: positive is angry, negative is worried.
    g.beginPath();
    g.moveTo(x - side * 15, y + ang * 15);
    g.lineTo(x + side * 15, y - ang * 15);
    g.stroke();
  }
}

function drawMouth(g, mouth, faceX) {
  const x = CX + faceX;
  const y = MOUTH_Y;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.lineWidth = 5.5;
  const o = mouth.open;
  switch (mouth.kind) {
    case 'cat':
      g.beginPath();
      g.moveTo(x - 20, y - 2);
      g.quadraticCurveTo(x - 10, y + 12, x, y - 1);
      g.quadraticCurveTo(x + 10, y + 12, x + 20, y - 2);
      g.stroke();
      break;
    case 'smile':
      g.beginPath();
      g.moveTo(x - 15, y);
      g.quadraticCurveTo(x, y + 17, x + 15, y);
      g.stroke();
      break;
    case 'grin': {
      const mouth = () => {
        g.beginPath();
        g.moveTo(x - 21, y - 4);
        g.lineTo(x + 21, y - 4);
        g.quadraticCurveTo(x + 20, y + 6 + 15 * o, x, y + 8 + 15 * o);
        g.quadraticCurveTo(x - 20, y + 6 + 15 * o, x - 21, y - 4);
        g.closePath();
      };
      mouth();
      g.fillStyle = '#93274f';
      g.fill();
      g.save();
      g.clip();
      g.beginPath();
      g.ellipse(x, y + 12 + 15 * o, 13, 9, 0, 0, TAU);
      g.fillStyle = '#ff7f9f';
      g.fill();
      g.restore();
      mouth();
      g.stroke();
      break;
    }
    case 'o':
      g.beginPath();
      g.ellipse(x, y + 6, 9 + 3.5 * o, 7 + 10 * o, 0, 0, TAU);
      paint(g, '#93274f', INK, 5);
      break;
    case 'flat':
      g.beginPath();
      g.moveTo(x - 13, y + 5);
      g.lineTo(x + 13, y + 5);
      g.stroke();
      break;
    case 'frown':
      g.beginPath();
      g.moveTo(x - 16, y + 14);
      g.quadraticCurveTo(x, y - 4, x + 16, y + 14);
      g.stroke();
      break;
    case 'squiggle':
      g.beginPath();
      g.moveTo(x - 20, y + 6);
      g.quadraticCurveTo(x - 10, y - 6, x, y + 6);
      g.quadraticCurveTo(x + 10, y + 18, x + 20, y + 6);
      g.stroke();
      break;
    default:
      break;
  }
}

function drawFace(g, pose) {
  const fx = pose.faceX;
  headPath(g);
  const fill = g.createLinearGradient(0, HEAD.top, 0, HEAD.bottom);
  fill.addColorStop(0, '#fff2e8');
  fill.addColorStop(0.6, SKIN);
  fill.addColorStop(1, '#ffcdb6');
  g.fillStyle = fill;
  g.fill();
  if (pose.flush > 0) {
    g.fillStyle = `rgba(255,90,90,${0.3 * pose.flush})`;
    g.fill();
  }
  // The fringe's shadow on the forehead.
  g.save();
  headPath(g);
  g.clip();
  g.translate(0, 9);
  fringePath(g, fx * 0.3, true);
  g.fillStyle = 'rgba(120,64,86,0.22)';
  g.fill();
  g.restore();
  headPath(g);
  paint(g, null);
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(CX + side * 74 + fx, EYE_Y + 24, 20, 11, 0, 0, TAU);
    g.fillStyle = `rgba(255,112,152,${clamp(pose.blush, 0, 1) * 0.6})`;
    g.fill();
  }
  drawEye(g, -1, pose.eyes, fx);
  drawEye(g, 1, pose.eyes, fx);
  drawBrows(g, pose.brows, fx, pose.eyes);
  drawMouth(g, pose.mouth, fx);
}

// ---- what floats around it -----------------------------------------------------------------------------------------

const PROPS = {
  sparkle: (g, p) => {
    sparklePath(g, p.x, p.y, p.size);
    paint(g, p.color ?? '#ffe45c', '#e0a800', 3);
  },
  heart: (g, p) => {
    heartPath(g, p.x, p.y, p.size);
    paint(g, '#ff5c8f', '#c92a63', 4);
  },
  note: (g, p) => {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot ?? 0);
    g.beginPath();
    g.ellipse(0, 0, p.size * 0.62, p.size * 0.46, -0.4, 0, TAU);
    g.fillStyle = p.color ?? PURPLE;
    g.fill();
    g.beginPath();
    g.moveTo(p.size * 0.5, -p.size * 0.1);
    g.lineTo(p.size * 0.5, -p.size * 1.7);
    g.quadraticCurveTo(p.size * 1.3, -p.size * 1.4, p.size * 1.1, -p.size * 0.7);
    g.strokeStyle = p.color ?? PURPLE;
    g.lineWidth = p.size * 0.22;
    g.lineCap = 'round';
    g.stroke();
    g.restore();
  },
  zee: (g, p) => {
    g.save();
    g.globalAlpha = p.alpha ?? 1;
    g.beginPath();
    g.moveTo(p.x - p.size, p.y - p.size);
    g.lineTo(p.x + p.size, p.y - p.size);
    g.lineTo(p.x - p.size, p.y + p.size);
    g.lineTo(p.x + p.size, p.y + p.size);
    g.strokeStyle = '#4d62ff';
    g.lineWidth = Math.max(4, p.size * 0.38);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
    g.restore();
  },
  question: (g, p) => {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot ?? 0);
    g.beginPath();
    g.arc(0, -p.size * 0.35, p.size * 0.62, Math.PI * 1.05, Math.PI * 2.55);
    g.quadraticCurveTo(p.size * 0.5, p.size * 0.5, 0, p.size * 0.7);
    g.strokeStyle = PURPLE;
    g.lineWidth = p.size * 0.36;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
    g.beginPath();
    g.arc(0, p.size * 1.25, p.size * 0.2, 0, TAU);
    g.fillStyle = PURPLE;
    g.fill();
    g.restore();
  },
  bang: (g, p) => {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot ?? 0);
    g.beginPath();
    g.moveTo(0, -p.size * 1.3);
    g.lineTo(0, p.size * 0.35);
    g.strokeStyle = '#ff6a3d';
    g.lineWidth = p.size * 0.55;
    g.lineCap = 'round';
    g.stroke();
    g.beginPath();
    g.arc(0, p.size * 1.05, p.size * 0.28, 0, TAU);
    g.fillStyle = '#ff6a3d';
    g.fill();
    g.restore();
  },
  sweat: (g, p) => {
    dropPath(g, p.x, p.y, p.size);
    paint(g, '#9fe3ff', '#3d8ed0', 3);
  },
  tear: (g, p) => {
    g.save();
    g.globalAlpha = p.alpha ?? 1;
    dropPath(g, p.x, p.y, p.size);
    paint(g, '#8fdcff', '#2f86c8', 3);
    g.restore();
  },
  puff: (g, p) => {
    g.save();
    g.globalAlpha = p.alpha ?? 1;
    g.beginPath();
    g.arc(p.x, p.y, p.size, 0, TAU);
    g.arc(p.x + p.size * 0.8, p.y + p.size * 0.2, p.size * 0.75, 0, TAU);
    g.arc(p.x - p.size * 0.7, p.y + p.size * 0.3, p.size * 0.7, 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
    g.strokeStyle = '#b9c0ff';
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  },
  vein: (g, p) => {
    g.save();
    g.translate(p.x, p.y);
    g.strokeStyle = '#ff4d4d';
    g.lineWidth = 6;
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 6, -4);
      g.quadraticCurveTo(s * 18, -6, s * 20, -20);
      g.moveTo(s * 6, 4);
      g.quadraticCurveTo(s * 18, 6, s * 20, 20);
      g.stroke();
    }
    g.restore();
  },
  confetti: (g, p) => {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.fillStyle = p.color;
    g.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
    g.restore();
  },
  dots: (g, p) => {
    // A thought bubble with `n` dots in it, and the two small bubbles that lead to it.
    g.beginPath();
    g.arc(p.x - 50, p.y + 46, 7, 0, TAU);
    paint(g, '#ffffff', '#b9c0ff', 3);
    g.beginPath();
    g.arc(p.x - 34, p.y + 26, 11, 0, TAU);
    paint(g, '#ffffff', '#b9c0ff', 3);
    g.beginPath();
    g.ellipse(p.x, p.y - 4, 52, 36, 0, 0, TAU);
    paint(g, '#ffffff', '#b9c0ff', 3.5);
    for (let i = 0; i < p.n; i++) {
      g.beginPath();
      g.arc(p.x - 25 + i * 25, p.y - 4, 7.5, 0, TAU);
      g.fillStyle = PURPLE;
      g.fill();
    }
  },
};

// ---- the rig ------------------------------------------------------------------------------------------------------

const arm = (a, over = {}) => ({ a, len: 1, front: false, to: null, ...over });

/** The resting pose; an animation overrides what it moves. Nested groups merge one level deep. */
function pose(over = {}) {
  const base = {
    dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, pivot: GROUND, faceX: 0, shadow: 1, blush: 0.55, flush: 0,
    eyes: { kind: 'dot', open: 1, lx: 0, ly: 0, size: 1 },
    brows: null,
    mouth: { kind: 'cat', open: 0 },
    armL: arm(0.42),
    armR: arm(0.42),
    footL: { lift: 0, dx: 0 },
    footR: { lift: 0, dx: 0 },
    tuft: { sway: 0, spread: 1, droop: 0 },
    props: [],
  };
  const out = { ...base, ...over };
  for (const key of ['eyes', 'mouth', 'footL', 'footR', 'tuft']) out[key] = { ...base[key], ...(over[key] ?? {}) };
  return out;
}

export function drawPose(g, p) {
  g.clearRect(0, 0, SIZE, SIZE);
  g.save();
  // The character is drawn in a SIZE-px space with its feet on GROUND, then scaled up so it fills the frame.
  g.translate(CX, FLOOR);
  g.scale(ZOOM, ZOOM);
  g.translate(-CX, -GROUND);
  // The shadow stays on the ground while the character leaves it.
  if (p.shadow > 0) {
    const lift = clamp(-p.dy, 0, 120);
    const k = p.shadow * (1 - lift / 260);
    g.beginPath();
    g.ellipse(CX + p.dx * 0.5, GROUND + 4, 104 * k, 14 * k, 0, 0, TAU);
    g.fillStyle = 'rgba(30,45,170,0.2)';
    g.fill();
  }
  for (const prop of p.props) if (prop.behind) PROPS[prop.kind](g, prop);
  g.save();
  g.translate(CX + p.dx, p.pivot + p.dy);
  g.rotate(p.rot);
  g.scale(p.sx, p.sy);
  g.translate(-CX, -p.pivot);
  drawFoot(g, -1, p.footL);
  drawFoot(g, 1, p.footR);
  if (!p.armL.front) drawArm(g, -1, p.armL);
  if (!p.armR.front) drawArm(g, 1, p.armR);
  drawAhoge(g, p.tuft, p.faceX);
  drawBackHair(g, p.tuft);
  drawBody(g);
  drawFace(g, p);
  drawFrontHair(g, p.tuft, p.faceX);
  if (p.armL.front) drawArm(g, -1, p.armL);
  if (p.armR.front) drawArm(g, 1, p.armR);
  g.restore();
  for (const prop of p.props) if (!prop.behind) PROPS[prop.kind](g, prop);
  g.restore();
}

// ---- the animations -----------------------------------------------------------------------------------------------

const blink = (p, at) => 1 - 0.93 * pulse(p, at, at + 0.11);

/** One hop: crouch, leave the ground, come down, squash. Returns the lift and the stretch at `p`. */
function hop(p, height) {
  if (p < 0.14) {
    const t = p / 0.14;
    return { dy: 0, sy: 1 - 0.11 * Math.sin((Math.PI * t) / 2), sx: 1 + 0.07 * t, air: 0 };
  }
  if (p > 0.86) {
    const t = (p - 0.86) / 0.14;
    return { dy: 0, sy: 0.9 + 0.1 * t, sx: 1.06 - 0.06 * t, air: 0 };
  }
  const t = (p - 0.14) / 0.72;
  const air = 4 * t * (1 - t);
  return { dy: -height * air, sy: 1.03 + 0.03 * air, sx: 1 - 0.02 * air, air };
}

const spark = (x, y, size, p, at, color) => {
  const w = windowAt(p, at, 0.5);
  return w < 0 ? [] : [{ kind: 'sparkle', x, y, size: size * Math.sin(Math.PI * w), color }];
};

const risingHearts = (p, base) => [0, 0.34, 0.67].flatMap((off, i) => {
  const w = windowAt(p, off, 0.6);
  if (w < 0) return [];
  return [{ kind: 'heart', x: base.x + [-36, 12, 46][i] + 10 * Math.sin(TAU * (w + i * 0.3)), y: base.y - 120 * w, size: 9 + 5 * Math.sin(Math.PI * w) }];
});

const confetti = (p, count) => Array.from({ length: count }, (_, i) => {
  const seed = (i * 0.6180339) % 1;
  const w = (p + seed) % 1;
  const colors = [PURPLE, BLUE, TEAL, '#ffd54a', '#ff7aa8'];
  return {
    kind: 'confetti', behind: true, color: colors[i % colors.length], size: 7 + (i % 3) * 2, rot: TAU * (w * 2 + seed),
    x: 70 + ((i * 97) % 372) + 18 * Math.sin(TAU * (w + seed)), y: 30 + w * 330,
  };
});

export const ANIMS = {
  idle: {
    frames: 20, fps: 10,
    at: (p) => pose({
      sx: 1 - 0.012 * wave(p), sy: 1 + 0.02 * wave(p),
      eyes: { open: blink(p, 0.8), lx: 2.5 * wave(p, 0.25) },
      armL: arm(0.4 + 0.04 * wave(p, 0.15)), armR: arm(0.4 + 0.04 * wave(p, 0.15)),
      tuft: { sway: 0.07 * wave(p, -0.12) },
    }),
  },
  walk: {
    frames: 12, fps: 12,
    at: (p) => pose({
      dy: -9 * Math.abs(wave(p)), rot: 0.06 * wave(p, 0.25), faceX: 12,
      sy: 1 + 0.025 * Math.cos(TAU * 2 * p), sx: 1 - 0.015 * Math.cos(TAU * 2 * p),
      eyes: { lx: 6 }, mouth: { kind: 'smile' },
      footL: { lift: 17 * Math.max(0, wave(p)), dx: 18 * Math.cos(TAU * p) },
      footR: { lift: 17 * Math.max(0, -wave(p)), dx: -18 * Math.cos(TAU * p) },
      armL: arm(0.55 + 0.45 * wave(p)), armR: arm(0.55 - 0.45 * wave(p)),
      tuft: { sway: 0.14 * wave(p, -0.2) },
    }),
  },
  think: {
    frames: 16, fps: 10,
    at: (p) => {
      const dots = 1 + Math.floor(3 * p);
      return pose({
        rot: 0.05 * wave(p), sy: 1 + 0.012 * wave(p),
        eyes: { lx: -7, ly: -9, open: blink(p, 0.84) },
        brows: { l: 0.35, r: -0.5, y: -2 },
        mouth: { kind: 'flat' },
        armR: arm(0, { front: true, to: { x: CX + 58, y: 336 + 3 * wave(p) } }),
        tuft: { sway: 0.06 * wave(p, -0.2) },
        props: [{ kind: 'dots', x: 418, y: 96 + 3 * wave(p), n: dots }],
      });
    },
  },
  happy: {
    frames: 14, fps: 12,
    at: (p) => {
      const h = hop(p, 32);
      return pose({
        dy: h.dy, sy: h.sy, sx: h.sx, shadow: 1,
        eyes: { kind: 'happy' }, mouth: { kind: 'grin', open: 0.55 + 0.4 * h.air }, blush: 0.9,
        armL: arm(Math.PI * 0.86 - 0.25 * h.air), armR: arm(Math.PI * 0.86 - 0.25 * h.air),
        footL: { lift: 12 * h.air }, footR: { lift: 12 * h.air },
        tuft: { sway: 0.16 * wave(p, -0.15), spread: 1 + 0.12 * h.air },
        props: [
          ...spark(96, 150, 20, p, 0.1), ...spark(420, 120, 24, p, 0.4, '#ff9ecb'), ...spark(60, 300, 14, p, 0.7, TEAL),
          ...spark(452, 280, 16, p, 0.25),
        ],
      });
    },
  },
  held: {
    frames: 12, fps: 12,
    at: (p) => pose({
      pivot: 350, dy: -30, rot: 0.1 * wave(p), sy: 1.07, sx: 0.97, shadow: 0,
      eyes: { kind: 'shock', ly: 2 }, brows: { l: -0.8, r: -0.8, y: -4 }, mouth: { kind: 'o', open: 0.8 + 0.2 * wave(p, 0.5) },
      armL: arm(2.45 + 0.35 * wave(p, 0.25)), armR: arm(2.45 - 0.35 * wave(p, 0.25)),
      footL: { lift: -8, dx: 12 * wave(p, 0.1) }, footR: { lift: -8, dx: -12 * wave(p, 0.35) },
      tuft: { sway: 0.2 * wave(p, 0.3), spread: 1.2 },
      props: [{ kind: 'sweat', x: 412, y: 212 + 4 * wave(p), size: 11 }],
    }),
  },
  wave: {
    frames: 16, fps: 12,
    at: (p) => pose({
      rot: 0.025 * wave(p), sy: 1 + 0.015 * wave(p, 0.5),
      eyes: { kind: p > 0.84 ? 'dot' : 'happy', open: p > 0.84 ? 0.3 : 1 },
      mouth: { kind: 'grin', open: 0.2 }, blush: 0.8,
      armR: arm(2.62 + 0.3 * wave(p * 2), { front: true }), armL: arm(0.4),
      tuft: { sway: 0.1 * wave(p, -0.2) },
    }),
  },
  dance: {
    frames: 16, fps: 12,
    at: (p) => pose({
      dy: -14 * Math.abs(wave(p)), rot: 0.13 * wave(p, 0.25), sy: 1 + 0.03 * Math.cos(TAU * 2 * p),
      eyes: { kind: 'happy' }, mouth: { kind: 'grin', open: 0.35 }, blush: 0.85,
      armL: arm(1.5 + 1.2 * wave(p)), armR: arm(1.5 - 1.2 * wave(p)),
      footL: { lift: 14 * Math.max(0, wave(p)) }, footR: { lift: 14 * Math.max(0, -wave(p)) },
      tuft: { sway: 0.2 * wave(p, -0.15) },
      props: [
        ...[0, 0.5].flatMap((off, i) => {
          const w = windowAt(p, off, 0.7);
          return w < 0 ? [] : [{ kind: 'note', x: (i ? 410 : 98) + 12 * Math.sin(TAU * w), y: 250 - 130 * w, size: 12, rot: 0.2, color: i ? TEAL : PURPLE }];
        }),
      ],
    }),
  },
  love: {
    frames: 16, fps: 12,
    at: (p) => {
      const beat = Math.max(0, wave(p * 2));
      return pose({
        rot: 0.04 * wave(p), sx: 1 + 0.035 * beat, sy: 1 + 0.035 * beat,
        eyes: { kind: 'heart', size: 1 + 0.12 * beat }, mouth: { kind: 'grin', open: 0.15 }, blush: 1,
        armL: arm(0, { front: true, to: { x: CX - 20, y: 394 } }), armR: arm(0, { front: true, to: { x: CX + 20, y: 394 } }),
        tuft: { sway: 0.08 * wave(p, -0.2) },
        props: risingHearts(p, { x: CX + 150, y: 200 }),
      });
    },
  },
  shy: {
    frames: 16, fps: 10,
    at: (p) => pose({
      rot: 0.05 * wave(p), dy: 2 * wave(p, 0.25), faceX: -6,
      eyes: { kind: 'dot', open: 0.75, lx: -8, ly: 6 }, mouth: { kind: 'squiggle' }, blush: 1, flush: 0.35,
      armL: arm(0, { front: true, to: { x: CX - 62, y: 312 + 2 * wave(p) } }),
      armR: arm(0, { front: true, to: { x: CX + 62, y: 312 + 2 * wave(p, 0.5) } }),
      tuft: { sway: 0.1 * wave(p, -0.2) },
      props: [{ kind: 'sweat', x: 410, y: 212 + 3 * wave(p), size: 9 }],
    }),
  },
  sad: {
    frames: 20, fps: 10,
    at: (p) => pose({
      dy: 5, sy: 0.96 + 0.012 * wave(p), sx: 1.02, rot: 0.025 * wave(p),
      eyes: { open: 0.85, ly: 5 }, brows: { l: -0.7, r: -0.7, y: 3 }, mouth: { kind: 'frown' }, blush: 0.15,
      armL: arm(0.12), armR: arm(0.12),
      tuft: { sway: 0.03 * wave(p), droop: 0.9 },
      props: [0, 0.5].flatMap((off) => {
        const w = windowAt(p, off, 0.5);
        return w < 0 ? [] : [-1, 1].map((side) => ({
          kind: 'tear', x: CX + side * EYE_X + side * 8, y: EYE_Y + 22 + 82 * w, size: 8, alpha: 1 - w * 0.6,
        }));
      }),
    }),
  },
  angry: {
    frames: 12, fps: 12,
    at: (p) => pose({
      dx: 3 * wave(p * 4), sx: 1.05, sy: 0.96,
      eyes: { open: 0.72, size: 0.95 }, brows: { l: 0.95, r: 0.95, y: 2 }, mouth: { kind: 'flat' }, blush: 0, flush: 0.9,
      armL: arm(0.18), armR: arm(0.18),
      footL: { lift: 9 * Math.max(0, wave(p * 2)) }, footR: { lift: 9 * Math.max(0, -wave(p * 2)) },
      tuft: { sway: 0.14 * wave(p * 2), spread: 1.3 },
      props: [
        { kind: 'vein', x: 174, y: 192 },
        ...[0, 0.5].flatMap((off, i) => {
          const w = windowAt(p, off, 0.6);
          return w < 0 ? [] : [{ kind: 'puff', x: (i ? 418 : 94) + (i ? 1 : -1) * 10 * w, y: 252 - 70 * w, size: 17 * (0.7 + 0.5 * w), alpha: 1 - w * 0.75 }];
        }),
      ],
    }),
  },
  surprised: {
    frames: 12, fps: 12,
    at: (p) => {
      const jump = pulse(p, 0, 0.4);
      return pose({
        dy: -26 * jump, sy: 1 + 0.05 * jump, sx: 1 - 0.03 * jump,
        eyes: { kind: 'shock', size: 1.05 }, brows: { l: -0.5, r: -0.5, y: -8 }, mouth: { kind: 'o', open: 1 },
        armL: arm(1.15 + 0.3 * jump), armR: arm(1.15 + 0.3 * jump),
        tuft: { sway: 0.05 * wave(p * 3), spread: 1.4 },
        props: [{ kind: 'bang', x: 414, y: 116 - 10 * jump, size: 19, rot: 0.15 * wave(p * 3) }],
      });
    },
  },
  nap: {
    frames: 24, fps: 8,
    at: (p) => pose({
      sy: 1 + 0.032 * wave(p), sx: 1 - 0.016 * wave(p), rot: 0.03 * wave(p, 0.1), dy: 2,
      eyes: { kind: 'closed' }, mouth: { kind: 'o', open: 0.3 + 0.25 * (0.5 + 0.5 * wave(p)) }, blush: 0.6,
      armL: arm(0.28), armR: arm(0.28),
      tuft: { sway: 0.04 * wave(p, -0.1), droop: 0.45 },
      props: [0, 0.33, 0.66].flatMap((off, i) => {
        const w = windowAt(p, off, 0.45);
        return w < 0 ? [] : [{ kind: 'zee', x: 410 + 26 * w + i * 6, y: 176 - 90 * w, size: 8 + 7 * w, alpha: Math.sin(Math.PI * w) }];
      }),
    }),
  },
  confused: {
    frames: 16, fps: 10,
    at: (p) => pose({
      rot: 0.09 * wave(p), sy: 1 + 0.01 * wave(p, 0.5),
      eyes: { lx: 8 * wave(p, 0.25), ly: -2, open: blink(p, 0.86) }, brows: { l: 0.4, r: -0.9, y: -3 }, mouth: { kind: 'squiggle' },
      armL: arm(0.4), armR: arm(0.4),
      tuft: { sway: 0.1 * wave(p, -0.3) },
      props: [
        { kind: 'question', x: 414, y: 112 + 5 * wave(p), size: 27, rot: 0.2 * wave(p, 0.1) },
        { kind: 'sweat', x: 100, y: 214 + 4 * wave(p, 0.5), size: 9 },
      ],
    }),
  },
  celebrate: {
    frames: 16, fps: 12,
    at: (p) => pose({
      dy: -20 * Math.abs(wave(p)), sy: 1 + 0.04 * Math.cos(TAU * 2 * p), sx: 1 - 0.02 * Math.cos(TAU * 2 * p),
      eyes: { kind: 'happy' }, mouth: { kind: 'grin', open: 0.9 }, blush: 0.9,
      armL: arm(Math.PI * 0.8 + 0.2 * wave(p * 2)), armR: arm(Math.PI * 0.8 - 0.2 * wave(p * 2)),
      footL: { lift: 8 * Math.abs(wave(p)) }, footR: { lift: 8 * Math.abs(wave(p)) },
      tuft: { sway: 0.2 * wave(p * 2, -0.1), spread: 1.2 },
      props: confetti(p, 14),
    }),
  },
  nod: {
    frames: 12, fps: 12,
    at: (p) => {
      const dip = Math.max(0, wave(p * 2, -0.25));
      return pose({
        dy: 9 * dip, sy: 1 - 0.05 * dip, sx: 1 + 0.025 * dip,
        eyes: { kind: dip > 0.55 ? 'closed' : 'dot' }, mouth: { kind: 'smile' }, blush: 0.7,
        tuft: { sway: 0.1 * dip },
      });
    },
  },
};

/** Draws every frame of an animation: calls `write(name, canvas)` once per frame, in order, with its file name. */
export async function drawAnim(createCanvas, name, write) {
  const { frames, at } = ANIMS[name];
  const files = [];
  for (let i = 0; i < frames; i++) {
    const canvas = createCanvas(SIZE, SIZE);
    drawPose(canvas.getContext('2d'), at(i / frames));
    const file = `${name}_${String(i).padStart(2, '0')}.png`;
    await write(file, canvas);
    files.push(file);
  }
  return files;
}
