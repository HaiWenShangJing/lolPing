/**
 * The order of a Sanguosha game: choosing heroes, dealing, then turn after turn (start, judgement, draw, play, discard,
 * end) until a side has won. `runSanguosha` is the only way in.
 */
import { shuffle } from './sanguoshaCards';
import { HERO_IDS } from './sanguoshaHeroes';
import type { HeroId } from './sanguoshaHeroes';
import { Engine } from './sanguosha';
import { actSkill, drawPhase, endPhase, skillOptions, startPhase } from './sanguoshaSkills';
import { actUse, legalUses, negated } from './sanguoshaUse';
import { GameOver, Stopped, freshFlags } from './sanguoshaTypes';
import type { Deps, Outcome, Phase, Role, Size, Winner } from './sanguoshaTypes';

/** A game that has gone this many turns without a winner is called off, so a stalemate cannot run for ever. */
export const MAX_TURNS = 600;

/**
 * Plays one game to its end. `roles` is what each seat holds, in seat order, and the lord starts. Null when the game was
 * stopped from outside before it ended.
 */
export async function runSanguosha(deps: Deps, roles: readonly Role[]): Promise<Outcome | null> {
  const e = new Engine(deps, roles);
  let winner: Winner | null = null;
  try {
    await begin(e);
    await rounds(e);
  } catch (err) {
    if (err instanceof Stopped) return null;
    if (!(err instanceof GameOver)) throw err;
    winner = err.winner;
  }
  try {
    await e.emit({ k: 'end', winner });
  } catch (err) {
    if (err instanceof Stopped) return null;
    throw err;
  }
  return { winner, turns: e.turns };
}

/** The lord picks first from five heroes, then each of the others from three, and everyone draws four cards. */
async function begin(e: Engine): Promise<void> {
  await e.emit({ k: 'start', size: e.players.length as Size });
  const taken = new Set<HeroId>();
  for (const p of e.order(e.lord.seat)) {
    const pool = shuffle(HERO_IDS.filter((h) => !taken.has(h)), e.deps.random);
    const heroes = pool.slice(0, p.role === 'lord' ? 5 : 3);
    const reply = await e.ask(p.seat, { k: 'hero', heroes, lord: p.role === 'lord' });
    const hero = reply?.k === 'hero' && heroes.includes(reply.hero) ? reply.hero : heroes[0];
    if (!hero) throw new Error('no heroes left to choose from');
    taken.add(hero);
    await e.setHero(p.seat, hero);
  }
  for (const p of e.order(e.lord.seat)) await e.draw(p.seat, 4);
}

async function rounds(e: Engine): Promise<void> {
  let seat = e.lord.seat;
  while (e.turns < MAX_TURNS) {
    e.turns += 1;
    await turn(e, seat);
    const next = e.next(seat);
    if (!next) return;
    seat = next.seat;
  }
}

async function turn(e: Engine, seat: number): Promise<void> {
  const me = e.p(seat);
  e.turn = seat;
  e.flags = freshFlags();
  await e.emit({ k: 'turn', seat });
  const phases: [Phase, () => Promise<void>][] = [
    ['start', () => startPhase(e, seat)],
    ['judge', () => judgePhase(e, seat)],
    ['draw', async () => (e.flags.skipDraw ? e.emit({ k: 'skip', seat, phase: 'draw' }) : drawPhase(e, seat))],
    ['play', async () => (e.flags.skipPlay ? e.emit({ k: 'skip', seat, phase: 'play' }) : playPhase(e, seat))],
    ['discard', () => discardPhase(e, seat)],
    ['end', () => endPhase(e, seat)],
  ];
  for (const [phase, run] of phases) {
    if (!me.alive) return;
    e.phase = phase;
    await e.emit({ k: 'phase', seat, phase });
    await run();
  }
}

/** Delayed tricks work out last one first, each open to a 无懈可击. */
async function judgePhase(e: Engine, seat: number): Promise<void> {
  const me = e.p(seat);
  for (const trick of [...me.judges].reverse()) {
    if (!me.alive) return;
    await e.toLimbo([trick.card]);
    if (await negated(e, trick.as, null, seat)) {
      await e.toTrash([trick.card]);
      continue;
    }
    const flip = await e.judge(seat, trick.as);
    if (trick.as === 'lebu') {
      if (flip.suit !== 'heart') e.flags.skipPlay = true;
      await e.toTrash([trick.card]);
    } else if (trick.as === 'bing') {
      if (flip.suit !== 'club') e.flags.skipDraw = true;
      await e.toTrash([trick.card]);
    } else if (flip.suit === 'spade' && flip.rank >= 2 && flip.rank <= 9) {
      await e.toTrash([trick.card]);
      await e.damage(seat, 3, null);
    } else {
      const next = e.next(seat);
      if (next) await e.place(trick.card, 'shandian', next.seat);
      else await e.toTrash([trick.card]);
    }
  }
}

/** Asks for plays until the player ends the turn. Three answers in a row that cannot be played end it too. */
async function playPhase(e: Engine, seat: number): Promise<void> {
  const me = e.p(seat);
  for (let invalid = 0; me.alive && invalid < 3; ) {
    const uses = legalUses(e, seat);
    const skills = skillOptions(e, seat);
    if (!uses.length && !skills.length) return;
    const reply = await e.ask(seat, { k: 'play', uses, skills });
    if (!reply || reply.k === 'end') return;
    let done = false;
    if (reply.k === 'use') done = await actUse(e, seat, reply, uses);
    else if (reply.k === 'skill') done = await actSkill(e, seat, reply, skills);
    invalid = done ? 0 : invalid + 1;
  }
}

async function discardPhase(e: Engine, seat: number): Promise<void> {
  const me = e.p(seat);
  if (e.has(seat, 'keji') && !e.flags.shaPlayed) {
    await e.emit({ k: 'skip', seat, phase: 'discard' });
    return;
  }
  const excess = me.hand.length - Math.max(me.hp, 0);
  if (excess <= 0) return;
  await e.discard(seat, await e.askCards(seat, 'discard', { amount: excess }, me.hand, excess, excess));
}
