/**
 * How a computer player plays when it has no mind of its own to ask, or its mind gave no usable answer: simple rules
 * and a little chance. It reads the game only through `viewFrom`, so it knows what its own seat may know and no more.
 */

import {
  noMeaning, pick, type Answer, type Check, type Entry, type Meaning, type Player, type Question, type Role, type Talk,
  type WerewolfGame,
} from './werewolf';

/** What a computer player says without a mind: stock lines in the user's language. */
export interface Phrases {
  accuse(name: string): string;
  trust(name: string): string;
  innocent(): string;
  quiet(): string;
  defend(): string;
  campaign(): string;
  claimSeer(checks: readonly { name: string; wolf: boolean }[]): string;
  claimWitch(saved: string | null): string;
  claimHunter(): string;
  claimIdiot(): string;
  /** Last words, pointing at `suspect` when there is one. */
  last(suspect: string | null): string;
  join(parts: readonly string[]): string;
}

/** A role a player has said at the table that it holds. */
export interface Claim {
  seat: number;
  role: Role;
  /** A seer's results as last told. */
  checks: Check[];
  /** A witch's silver water: whom she says she saved. */
  saved: number | null;
}

/** The claims made in `entries`, one per player, in the order they were first made. */
export function claimsIn(entries: readonly Entry[]): Claim[] {
  const claims = new Map<number, Claim>();
  for (const e of entries) {
    if (e.kind !== 'say' || e.meaning.claim === null) continue;
    const before = claims.get(e.seat);
    claims.set(e.seat, {
      seat: e.seat,
      role: e.meaning.claim,
      checks: e.meaning.checks.length > 0 ? e.meaning.checks : (before?.checks ?? []),
      saved: e.meaning.saved ?? before?.saved ?? null,
    });
  }
  return [...claims.values()];
}

/** The seer's own results, in the order she got them. */
export const checksOf = (entries: readonly Entry[], seat: number): Check[] =>
  entries.flatMap((e) => (e.kind === 'check' && e.seat === seat ? [{ seat: e.target, wolf: e.wolf }] : []));

interface Mind {
  me: Player;
  /** Seats known to be wolves: a wolf's partners, what the seer found, a wolf that blew up. */
  wolves: Set<number>;
  /** The seer claimant believed, or for a wolf the real seer. */
  trusted: number | null;
  /** How much each living player is suspected (for a wolf: how much it is worth going after); more is likelier. */
  score: Map<number, number>;
  claims: Claim[];
  /** What has been said since the night fell. */
  today: Entry[];
}

/** What `seat` makes of the table: who it knows, who it believes, and how suspicious each player is. */
function think(game: WerewolfGame, seat: number): Mind {
  const me = game.player(seat);
  const { entries } = game.viewFrom(seat, 0);
  const isWolf = me.role === 'wolf';
  const wolves = new Set<number>();
  const good = new Set<number>();
  for (const e of entries) {
    if (e.kind === 'wolves') for (const s of e.seats) wolves.add(s);
    else if (e.kind === 'check' && e.seat === seat) (e.wolf ? wolves : good).add(e.target);
    else if (e.kind === 'witchDid' && e.seat === seat && e.saved !== null) good.add(e.saved);
    else if (e.kind === 'flip') good.add(e.seat);
    else if (e.kind === 'boom') wolves.add(e.seat);
  }
  wolves.delete(seat);

  const claims = claimsIn(entries);
  const others = claims.filter((c) => c.seat !== seat);
  const seers = others.filter((c) => c.role === 'seer');
  const fakes = new Set<number>();
  let trusted: number | null = null;
  if (me.role === 'seer') {
    for (const c of seers) {
      fakes.add(c.seat);
      wolves.add(c.seat);
    }
  } else if (isWolf) {
    for (const c of seers) {
      if (wolves.has(c.seat)) fakes.add(c.seat);
      else trusted ??= c.seat;
    }
  } else {
    // Only the real seer can truly say a player is a wolf or not, so a claimant who contradicts what is known lies.
    const lies = (c: Claim): boolean =>
      c.checks.some((k) => (k.wolf && (k.seat === seat || good.has(k.seat))) || (!k.wolf && wolves.has(k.seat)));
    const sound = seers.filter((c) => !lies(c));
    // A claimant whose wolf has since blown itself up has proved himself.
    const proven = sound.find((c) => c.checks.some((k) => k.wolf && wolves.has(k.seat)));
    const [first, second] = sound;
    // The table follows the claimant it made sheriff, else the first to speak; a few seats side with the other.
    const crowned = sound.find((c) => c.seat === game.sheriff);
    const doubting = first !== undefined && second !== undefined && (seat + first.seat) % 5 === 0;
    trusted = (proven ?? crowned ?? (doubting ? second : first))?.seat ?? null;
    for (const c of seers) if (c.seat !== trusted) fakes.add(c.seat);
  }

  const score = new Map<number, number>();
  for (const p of game.alive()) if (p.seat !== seat) score.set(p.seat, 0);
  const add = (s: number, v: number): void => {
    if (score.has(s)) score.set(s, (score.get(s) ?? 0) + v);
  };
  for (const s of wolves) add(s, isWolf ? -100 : 100);
  for (const s of fakes) add(s, isWolf ? -100 : 3.5);
  if (!isWolf) for (const s of good) add(s, -100);
  if (isWolf && trusted !== null) add(trusted, 4);
  const real = others.find((c) => c.seat === trusted);
  // Whoever goes after a player believed good is doubted; the more so for the seer, the one the wolves must be rid of.
  const shield = new Map<number, number>();
  for (const s of good) shield.set(s, 1.2);
  if (real && !isWolf) {
    add(real.seat, -4);
    shield.set(real.seat, 1.8);
    for (const k of real.checks) {
      add(k.seat, k.wolf ? 6 : -5);
      if (!k.wolf) shield.set(k.seat, 1.2);
    }
  }
  for (const c of others) {
    if (c.role === 'seer') continue;
    if (isWolf) add(c.seat, wolves.has(c.seat) ? 0 : 2);
    else if (c.role === me.role) add(c.seat, 100);
    else {
      add(c.seat, -2);
      if (c.saved !== null) add(c.saved, -2);
    }
  }
  // Old words and old votes count for less.
  const weightOf = (day: number): number => (game.day - day <= 0 ? 1 : game.day - day === 1 ? 0.5 : 0.25);
  if (!isWolf) {
    for (const e of entries) {
      if (e.kind !== 'votes' || e.why !== 'exile') continue;
      for (const b of e.ballots) {
        const guard = shield.get(b.target);
        if (guard === undefined) continue;
        for (const v of b.voters) if (v !== seat) add(v, 0.8 * guard * weightOf(e.day));
      }
    }
  }
  for (const e of entries) {
    if (e.kind !== 'say' || e.meaning.suspect === null || e.seat === seat) continue;
    const weight = weightOf(e.day);
    const guard = isWolf ? undefined : shield.get(e.meaning.suspect);
    if (guard !== undefined) {
      add(e.seat, guard * weight);
      continue;
    }
    const liar = !isWolf && (wolves.has(e.seat) || fakes.has(e.seat));
    add(e.meaning.suspect, (liar ? -0.4 : e.talk === 'last' ? 1.2 : 0.7) * weight);
  }

  const night = entries.map((e) => e.kind).lastIndexOf('night');
  return { me, wolves, trusted, score, claims, today: entries.slice(Math.max(0, night)) };
}

const scoreOf = (mind: Mind, seat: number): number => mind.score.get(seat) ?? 0;

/** The seat with the most `value` among `seats`, a little chance added so that equals are told apart. */
function best(
  seats: readonly number[], value: (seat: number) => number, random: () => number, jitter = 0.5,
): number | null {
  let top: number | null = null;
  let max = -Infinity;
  for (const s of seats) {
    const v = value(s) + random() * jitter;
    if (v > max) {
      max = v;
      top = s;
    }
  }
  return top;
}

const RUN_CHANCE: Record<Role, number> = {
  seer: 0.85, wolf: 0.45, hunter: 0.4, witch: 0.25, villager: 0.25, idiot: 0.1,
};
/** How much suspicion makes a case that a good player will vote on. */
const CASE = 1.5;

function killTarget(game: WerewolfGame, seat: number, random: () => number): number {
  const mind = think(game, seat);
  const options = game.options(seat, { kind: 'kill' });
  const partners = options.filter((s) => s !== seat && mind.wolves.has(s));
  // Now and then on the first night a wolf is knifed by its own side, to look like a victim.
  if (game.day === 1 && partners.length > 0 && random() < 0.05) return pick(partners, random) ?? seat;
  const foes = options.filter((s) => s !== seat && !mind.wolves.has(s));
  // The seer the table believes is the one every wolf wants dead first.
  const weights = foes.map((s) => 1 + Math.max(0, scoreOf(mind, s)) + (s === mind.trusted ? 4 : 0));
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  for (const [i, s] of foes.entries()) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return s;
  }
  return foes[foes.length - 1] ?? options.find((s) => s !== seat) ?? seat;
}

function witchAnswer(
  game: WerewolfGame, seat: number, q: Extract<Question, { kind: 'witch' }>, random: () => number,
): Answer {
  const mind = think(game, seat);
  const victimScore = q.victim === null ? 0 : scoreOf(mind, q.victim);
  const trusts = q.victim !== null && (victimScore < 0 || q.victim === mind.trusted);
  // The first night's victim is almost always saved; later the seer or someone trusted is worth the antidote.
  const wants = game.day === 1 ? 0.85 : trusts ? 0.9 : victimScore >= 3 ? 0 : 0.45;
  if (q.save && random() < wants) return { kind: 'witch', save: true, poison: null };
  const options = game.options(seat, q);
  const foe = best(options, (s) => scoreOf(mind, s), random, 0.2);
  const poison = q.poison && foe !== null && scoreOf(mind, foe) >= 3 ? foe : null;
  return { kind: 'witch', save: false, poison };
}

function voteAnswer(
  game: WerewolfGame, seat: number, q: Extract<Question, { kind: 'vote' }>, random: () => number,
): Answer {
  const options = game.options(seat, q);
  if (options.length === 0) return { kind: 'vote', seat: null };
  const mind = think(game, seat);
  const isWolf = mind.me.role === 'wolf';
  if (q.why === 'sheriff') {
    const partners = options.filter((s) => mind.wolves.has(s));
    if (isWolf && partners.length > 0 && random() < 0.6) return { kind: 'vote', seat: pick(partners, random) ?? null };
    // The candidate who looks the most trustworthy; a wolf keeps away from the one it would most like to be rid of.
    const pool = isWolf ? options.filter((s) => !mind.wolves.has(s)) : options;
    return { kind: 'vote', seat: best(pool.length > 0 ? pool : options, (s) => -scoreOf(mind, s), random) };
  }
  const target = best(options, (s) => scoreOf(mind, s), random, 0.6);
  if (target === null || scoreOf(mind, target) < -50 || random() < 0.03) return { kind: 'vote', seat: null };
  // Without a case against anyone a good player holds back: exiling a good player only helps the wolves.
  if (!isWolf && scoreOf(mind, target) < CASE && random() < 0.6) return { kind: 'vote', seat: null };
  return { kind: 'vote', seat: target };
}

function badgeAnswer(game: WerewolfGame, seat: number, random: () => number): Answer {
  // A flipped idiot has no vote, so the badge would be wasted on him.
  const voting = game.options(seat, { kind: 'badge' }).filter((s) => !game.player(s).flipped);
  const options = voting.length > 0 ? voting : game.options(seat, { kind: 'badge' });
  if (options.length === 0) return { kind: 'pick', seat: null };
  const mind = think(game, seat);
  const partners = options.filter((s) => mind.wolves.has(s));
  if (mind.me.role === 'wolf') {
    if (partners.length > 0 && random() < 0.55) return { kind: 'pick', seat: pick(partners, random) ?? null };
    const rest = options.filter((s) => !mind.wolves.has(s));
    return { kind: 'pick', seat: pick(rest.length > 0 ? rest : options, random) ?? null };
  }
  const heir = best(options, (s) => -scoreOf(mind, s), random);
  // A badge nobody deserves is better torn up than handed to a likely wolf.
  return { kind: 'pick', seat: heir === null || scoreOf(mind, heir) >= 3 ? null : heir };
}

function shootAnswer(game: WerewolfGame, seat: number, random: () => number): Answer {
  const options = game.options(seat, { kind: 'shoot' });
  const mind = think(game, seat);
  const target = best(options.filter((s) => scoreOf(mind, s) > -50), (s) => scoreOf(mind, s), random);
  return { kind: 'pick', seat: target };
}

/** A seer's report that is not true: one more result than last time, to hurt a good player or shield a wolf. */
function fakeChecks(game: WerewolfGame, seat: number, mind: Mind, random: () => number): Check[] {
  const before = mind.claims.find((c) => c.seat === seat && c.role === 'seer')?.checks ?? [];
  if (before.length >= Math.max(1, game.day)) return before;
  const used = new Set(before.map((c) => c.seat));
  const open = game.alive().map((p) => p.seat).filter((s) => s !== seat && !used.has(s));
  const partners = open.filter((s) => mind.wolves.has(s));
  const rest = open.filter((s) => !mind.wolves.has(s));
  const real = mind.trusted !== null && rest.includes(mind.trusted) && random() < 0.5 ? mind.trusted : null;
  if (real !== null) return [...before, { seat: real, wolf: true }];
  if (rest.length > 0 && (partners.length === 0 || random() < 0.6)) {
    return [...before, { seat: pick(rest, random) ?? seat, wolf: true }];
  }
  const shielded = pick(partners, random);
  return shielded === undefined ? before : [...before, { seat: shielded, wolf: false }];
}

interface Said {
  part: string;
  meaning: Partial<Meaning>;
}

/** What `seat` says for `talk`, with the claim it makes, if any. */
function speech(
  game: WerewolfGame, seat: number, talk: Talk, random: () => number, say: Phrases, nameOf: (seat: number) => string,
): Answer {
  const mind = think(game, seat);
  const { entries } = game.viewFrom(seat, 0);
  const me = mind.me;
  const mine = mind.claims.find((c) => c.seat === seat);
  const accused = mind.today.some((e) => e.kind === 'say' && e.meaning.suspect === seat);
  const living = game.alive().filter((p) => p.seat !== seat).map((p) => p.seat);
  const named = (checks: readonly Check[]): { name: string; wolf: boolean }[] =>
    checks.map((c) => ({ name: nameOf(c.seat), wolf: c.wolf }));

  const claim = ((): Said | null => {
    const last = talk === 'last';
    switch (me.role) {
      case 'seer': {
        const checks = checksOf(entries, seat);
        const fresh = checks.length > (mine?.checks.length ?? 0);
        const hit = checks.some((c) => c.wolf);
        const chance = last || talk === 'campaign'
          ? 0.95
          : mine ? (fresh ? 0.85 : 0.2) : 0.4 + (hit ? 0.4 : 0) + (game.day >= 2 ? 0.15 : 0);
        if (checks.length === 0 || random() >= chance) return null;
        return { part: say.claimSeer(named(checks)), meaning: { claim: 'seer', checks } };
      }
      case 'witch': {
        const did = entries.flatMap((e) => (e.kind === 'witchDid' && e.seat === seat ? [e] : []));
        const saved = did.find((e) => e.saved !== null)?.saved ?? null;
        const used = did.some((e) => e.saved !== null || e.poisoned !== null);
        if (random() >= (last ? 0.9 : accused ? 0.5 : used ? 0.3 : 0.06)) return null;
        return { part: say.claimWitch(saved === null ? null : nameOf(saved)), meaning: { claim: 'witch', saved } };
      }
      case 'hunter':
        if (random() >= (talk === 'pk' ? 0.7 : last ? 0.6 : accused ? 0.5 : 0.1)) return null;
        return { part: say.claimHunter(), meaning: { claim: 'hunter' } };
      case 'idiot':
        if (random() >= (talk === 'pk' ? 0.6 : last ? 0.7 : accused ? 0.4 : 0.05)) return null;
        return { part: say.claimIdiot(), meaning: { claim: 'idiot' } };
      case 'wolf': {
        // Once the real seer has spoken, a wolf may stand up against it, but only one wolf at a time.
        const standing = mind.claims.some((c) => c.role === 'seer' && mind.wolves.has(c.seat));
        const threatened = mind.trusted !== null && accused;
        const base = mind.trusted !== null ? 0.2 : 0.03;
        const chance = standing && !mine ? 0 : base + (threatened ? 0.3 : 0) + (mine ? 0.5 : 0);
        if (talk === 'last' || random() >= chance) return null;
        const checks = fakeChecks(game, seat, mind, random);
        return checks.length === 0 ? null : { part: say.claimSeer(named(checks)), meaning: { claim: 'seer', checks } };
      }
      default: return null;
    }
  })();

  const wolfFound = claim?.meaning.checks?.find((c) => c.wolf && living.includes(c.seat))?.seat;
  // A wolf that does not stand against the seer has no reason to go after him, and doing so gives it away.
  const standingFake = me.role === 'wolf' && (claim?.meaning.claim === 'seer' || mine?.role === 'seer');
  const leaveSeer = me.role === 'wolf' && !standingFake && random() < 0.75 ? mind.trusted : null;
  const suspectable = living.filter(
    (s) => s !== leaveSeer && (me.role === 'wolf' ? !mind.wolves.has(s) : scoreOf(mind, s) > -50),
  );
  const worst = best(suspectable, (s) => scoreOf(mind, s), random);
  const suspect = wolfFound ?? (worst !== null && (scoreOf(mind, worst) >= 0.6 || random() < 0.3) ? worst : null);

  const parts: string[] = [];
  if (talk === 'campaign') parts.push(say.campaign());
  if (accused && talk !== 'last' && random() < 0.6) parts.push(say.defend());
  if (claim) parts.push(claim.part);
  if (talk === 'last') parts.push(say.last(suspect === null ? null : nameOf(suspect)));
  else if (suspect !== null) parts.push(say.accuse(nameOf(suspect)));
  else if (mind.trusted !== null && me.role !== 'wolf' && random() < 0.5) parts.push(say.trust(nameOf(mind.trusted)));
  else parts.push(random() < 0.5 ? say.innocent() : say.quiet());
  return { kind: 'text', text: say.join(parts.slice(0, 3)), meaning: { ...noMeaning(), ...claim?.meaning, suspect } };
}

/** A computer player's own simple play. */
export function fallbackAnswer(
  game: WerewolfGame, seat: number, q: Question, random: () => number, say: Phrases, nameOf: (seat: number) => string,
): Answer {
  switch (q.kind) {
    case 'kill': return { kind: 'target', seat: killTarget(game, seat, random) };
    case 'check': {
      const mind = think(game, seat);
      const options = game.options(seat, q);
      return { kind: 'target', seat: best(options, (s) => scoreOf(mind, s), random, 1.2) ?? options[0] ?? seat };
    }
    case 'witch': return witchAnswer(game, seat, q, random);
    case 'run': return { kind: 'run', run: random() < RUN_CHANCE[game.player(seat).role] };
    case 'speak': return speech(game, seat, q.talk, random, say, nameOf);
    case 'vote': return voteAnswer(game, seat, q, random);
    case 'shoot': return shootAnswer(game, seat, random);
    case 'badge': return badgeAnswer(game, seat, random);
  }
}

/** Whether the wolf `seat` blows itself up now: rarely, more when the seer's word or the table is about to doom it. */
export function wantsBoom(
  game: WerewolfGame, seat: number, when: 'campaign' | 'talk' | 'vote', random: () => number,
): boolean {
  // The last wolf never gives up: its death would end the game on the spot.
  if (game.wolves().length < 2) return false;
  const mind = think(game, seat);
  const named = mind.trusted !== null && (mind.claims.find((c) => c.seat === mind.trusted)?.checks ?? [])
    .some((c) => c.seat === seat && c.wolf);
  const accusations = mind.today.filter((e) => e.kind === 'say' && e.meaning.suspect === seat).length;
  const base = when === 'vote' ? 0.002 : 0.0004;
  if (when === 'campaign') return random() < base;
  const voting = when === 'vote';
  const chance = base + (named ? (voting ? 0.04 : 0.003) : 0) + accusations * (voting ? 0.015 : 0.001);
  return random() < Math.min(0.4, chance);
}
