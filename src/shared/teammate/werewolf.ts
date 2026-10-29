/**
 * Werewolf for twelve, the standard board: four wolves, four villagers and four gods (seer, witch, hunter, idiot).
 * This is the pure part, the rules and what each player may know. What a computer player does is in
 * `werewolfPlay.ts` and `werewolfMind.ts`; `werewolfRun.ts` plays a game through it.
 */

import type { PetId } from './pet';
import { cleanLine } from './petText';

export type Role = 'wolf' | 'villager' | 'seer' | 'witch' | 'hunter' | 'idiot';
export type Who = 'user' | PetId;
export type Side = 'wolves' | 'village';
/** How a player died: the wolves' knife, the witch's poison, a vote, the hunter's shot or a self-destruct. */
export type Cause = 'wolves' | 'poison' | 'exile' | 'shot' | 'boom';
/** Which side's goal was met: every wolf out (village), or every god or every villager out (wolves). */
export type WinReason = 'wolves' | 'gods' | 'villagers';
/** What a speech is: the day's talk, a sheriff candidate's, a tie's second round, or a dead player's last words. */
export type Talk = 'day' | 'campaign' | 'pk' | 'last';

export const SEATS = 12;
export const ROLES: readonly Role[] = [
  'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot',
];
const GODS: readonly Role[] = ['seer', 'witch', 'hunter', 'idiot'];
export const isGod = (role: Role): boolean => GODS.includes(role);
/** The roles a player may claim in a speech. */
export const CLAIMABLE: readonly Role[] = GODS;
/** The longest thing a player says in one turn. */
export const SAY_MAX = 240;
/** The sheriff's vote counts one and a half when the day's vote exiles. */
export const SHERIFF_WEIGHT = 1.5;

export interface Player {
  /** 1 to 12, as the players call each other. */
  seat: number;
  who: Who;
  role: Role;
  alive: boolean;
  /** The idiot, once exiled and revealed: alive and still a god, but without a vote. */
  flipped: boolean;
  /** A wolf that blew itself up. */
  boomed: boolean;
}

/** A seer's result as the table was told it. */
export interface Check {
  seat: number;
  wolf: boolean;
}

/** What a speech amounts to besides its words: who it accuses, which role it claims, what it reports. */
export interface Meaning {
  suspect: number | null;
  claim: Role | null;
  /** A seer's claim: every result so far. */
  checks: Check[];
  /** A witch's claim: the player her antidote saved. */
  saved: number | null;
}

export const noMeaning = (): Meaning => ({ suspect: null, claim: null, checks: [], saved: null });

export interface Ballot {
  target: number;
  voters: number[];
  /** The votes it got, the sheriff's counted one and a half in an exile vote. */
  total: number;
}

/** Everything that happens, as the rules see it; who may read an entry is in `Logged.to`. */
export type Entry =
  | { kind: 'start'; seat: number; role: Role }
  | { kind: 'wolves'; seats: number[] }
  | { kind: 'night'; day: number }
  | { kind: 'wolfPick'; seat: number; target: number }
  | { kind: 'wolfKill'; target: number }
  | { kind: 'check'; seat: number; target: number; wolf: boolean }
  | { kind: 'witchInfo'; seat: number; victim: number | null; save: boolean; poison: boolean }
  | { kind: 'witchDid'; seat: number; saved: number | null; poisoned: number | null }
  | { kind: 'dawn'; day: number; died: number[] }
  | { kind: 'say'; day: number; seat: number; talk: Talk; text: string; meaning: Meaning }
  | { kind: 'runners'; seats: number[] }
  | {
    kind: 'votes'; day: number; why: 'sheriff' | 'exile'; round: 1 | 2; ballots: Ballot[]; abstained: number[];
    out: number | null; tied: number[];
  }
  | { kind: 'sheriff'; seat: number | null; cancelled: boolean }
  | { kind: 'badge'; from: number; to: number | null }
  | { kind: 'flip'; seat: number }
  | { kind: 'boom'; seat: number }
  | { kind: 'shot'; hunter: number; target: number }
  | { kind: 'over'; winner: Side; why: WinReason };

export interface Logged {
  to: 'all' | readonly number[];
  entry: Entry;
}

/** What a player is asked in turn. */
export type Question =
  | { kind: 'kill' }
  | { kind: 'check' }
  /** `victim` is null when the witch is not told it: she has no antidote left. */
  | { kind: 'witch'; victim: number | null; save: boolean; poison: boolean }
  | { kind: 'run' }
  | { kind: 'speak'; talk: Talk }
  /** `among` limits the vote to those seats: the candidates, or the players a tie left. */
  | { kind: 'vote'; why: 'sheriff' | 'exile'; among: number[] | null }
  | { kind: 'shoot' }
  | { kind: 'badge' };

export type Answer =
  | { kind: 'target'; seat: number }
  | { kind: 'witch'; save: boolean; poison: number | null }
  | { kind: 'run'; run: boolean }
  | { kind: 'text'; text: string; meaning?: Partial<Meaning> }
  | { kind: 'vote'; seat: number | null }
  /** A shot or a badge: null for no shot, and for tearing the badge. */
  | { kind: 'pick'; seat: number | null };

/** A player who died and whose last words, shot and badge are still to settle. */
export interface Death {
  seat: number;
  cause: Cause;
  day: number;
}

export interface Tally {
  /** The seat that got the most votes, when there is one. */
  out: number | null;
  /** The seats that tied for the most. */
  tied: number[];
}

export const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};

export const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))];

/** The seat named most often; seats tied for it are told apart by chance. */
export function plurality(seats: readonly number[], random: () => number): number | null {
  const count = new Map<number, number>();
  for (const s of seats) count.set(s, (count.get(s) ?? 0) + 1);
  const best = Math.max(0, ...count.values());
  return pick([...count].filter(([, n]) => n === best).map(([s]) => s), random) ?? null;
}

export class WerewolfGame {
  readonly players: Player[];
  readonly log: Logged[] = [];
  /** Deaths whose last words, shot and badge are not settled yet, oldest first. */
  readonly deaths: Death[] = [];
  day = 0;
  antidote = true;
  poison = true;
  sheriff: number | null = null;
  private result: { winner: Side; why: WinReason } | null = null;

  private constructor(players: Player[]) {
    this.players = players;
  }

  /** Deals the twelve players their seats and roles, both shuffled so the user is not always the same one. */
  static deal(whos: readonly Who[], random: () => number): WerewolfGame {
    if (whos.length !== SEATS) throw new Error(`A game needs ${SEATS} players.`);
    const roles = shuffled(ROLES, random);
    return WerewolfGame.seat(shuffled(whos, random).map((who, i) => ({ who, role: roles[i] as Role })));
  }

  /** Seats the players in the order given, each told its role and each wolf the other wolves. */
  static seat(dealt: readonly { who: Who; role: Role }[]): WerewolfGame {
    const game = new WerewolfGame(dealt.map((d, i) => ({
      seat: i + 1, who: d.who, role: d.role, alive: true, flipped: false, boomed: false,
    })));
    for (const p of game.players) game.record([p.seat], { kind: 'start', seat: p.seat, role: p.role });
    const wolves = game.players.filter((p) => p.role === 'wolf').map((p) => p.seat);
    game.record(wolves, { kind: 'wolves', seats: wolves });
    return game;
  }

  player(seat: number): Player {
    const p = this.players[seat - 1];
    if (!p) throw new Error(`No player ${seat}.`);
    return p;
  }

  alive(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  wolves(): Player[] {
    return this.players.filter((p) => p.alive && p.role === 'wolf');
  }

  seatOfUser(): number | null {
    return this.players.find((p) => p.who === 'user')?.seat ?? null;
  }

  record(to: Logged['to'], entry: Entry): void {
    this.log.push({ to, entry });
  }

  /** Who has won as things stand, and why: no wolf is left, or no god is, or no villager is. */
  decided(): { winner: Side; why: WinReason } | null {
    let wolves = 0;
    let villagers = 0;
    let gods = 0;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.role === 'wolf') wolves++;
      else if (p.role === 'villager') villagers++;
      else gods++;
    }
    // If the last wolf and the last god fall together, the village has the last word.
    if (wolves === 0) return { winner: 'village', why: 'wolves' };
    if (gods === 0) return { winner: 'wolves', why: 'gods' };
    if (villagers === 0) return { winner: 'wolves', why: 'villagers' };
    return null;
  }

  /** The side that has won, or null while the game goes on; it is told to the log once, and then it stands. */
  winner(): Side | null {
    if (!this.result) {
      this.result = this.decided();
      if (this.result) this.record('all', { kind: 'over', winner: this.result.winner, why: this.result.why });
    }
    return this.result?.winner ?? null;
  }

  reason(): WinReason | null {
    this.winner();
    return this.result?.why ?? null;
  }

  startNight(): void {
    this.day += 1;
    this.record('all', { kind: 'night', day: this.day });
  }

  /** Whether the witch may save `victim`: she has the antidote, and herself only on the first night. */
  canSave(victim: number | null): boolean {
    if (!this.antidote || victim === null) return false;
    const witch = this.players.find((p) => p.role === 'witch');
    return witch !== undefined && (victim !== witch.seat || this.day === 1);
  }

  /** What the witch is asked: told the victim only while she has the antidote. */
  witchQuestion(victim: number | null): Extract<Question, { kind: 'witch' }> {
    return { kind: 'witch', victim: this.antidote ? victim : null, save: this.canSave(victim), poison: this.poison };
  }

  /** Ends the night: the wolves' victim dies unless saved, and so does whoever was poisoned; one potion a night. */
  endNight(night: { kill: number | null; saved: boolean; poisoned: number | null }): number[] {
    const dead = new Map<number, Cause>();
    if (night.kill !== null && !night.saved) dead.set(night.kill, 'wolves');
    if (night.poisoned !== null && !night.saved) dead.set(night.poisoned, 'poison');
    const list = [...dead.keys()].sort((a, b) => a - b);
    for (const seat of list) this.die(seat, dead.get(seat) ?? 'wolves');
    this.record('all', { kind: 'dawn', day: this.day, died: list });
    return list;
  }

  /** A player dies; what follows from it (words, shot, badge) waits in `deaths`. */
  die(seat: number, cause: Cause): void {
    const p = this.player(seat);
    if (!p.alive) return;
    p.alive = false;
    this.deaths.push({ seat, cause, day: this.day });
  }

  nextDeath(): Death | null {
    return this.deaths.shift() ?? null;
  }

  /** Dead players speak once more after the first night and when they are exiled; never when shot or blown up. */
  hasLastWords(d: Death): boolean {
    return d.cause === 'exile' || (d.day === 1 && (d.cause === 'wolves' || d.cause === 'poison'));
  }

  /** A hunter shoots when the wolves kill him or the table exiles him, not when he is poisoned. */
  mayShoot(d: Death): boolean {
    return this.player(d.seat).role === 'hunter' && (d.cause === 'wolves' || d.cause === 'exile');
  }

  shoot(hunter: number, target: number): void {
    this.record('all', { kind: 'shot', hunter, target });
    this.die(target, 'shot');
  }

  /** The exile of a player: the idiot's first time he only turns his card; anyone else dies. */
  exile(seat: number): 'flipped' | 'dead' {
    const p = this.player(seat);
    if (p.role === 'idiot' && !p.flipped) {
      p.flipped = true;
      this.record('all', { kind: 'flip', seat });
      return 'flipped';
    }
    this.die(seat, 'exile');
    return 'dead';
  }

  /** A wolf blows itself up: it dies at once, its role is out, and the day is over. */
  boom(seat: number): void {
    const p = this.player(seat);
    if (p.role !== 'wolf' || !p.alive) throw new Error(`Player ${seat} cannot self-destruct.`);
    p.boomed = true;
    this.record('all', { kind: 'boom', seat });
    this.die(seat, 'boom');
  }

  elect(seat: number | null, cancelled = false): void {
    this.sheriff = seat;
    this.record('all', { kind: 'sheriff', seat, cancelled });
  }

  /** The sheriff hands the badge to a living player, or tears it up (null). */
  passBadge(from: number, to: number | null): void {
    if (this.sheriff !== from) return;
    this.sheriff = to !== null && this.player(to).alive ? to : null;
    this.record('all', { kind: 'badge', from, to: this.sheriff });
  }

  say(seat: number, talk: Talk, text: string, meaning: Partial<Meaning> = {}): string {
    const clean = cleanLine(text, SAY_MAX);
    if (clean === '') return '';
    this.record('all', {
      kind: 'say', day: this.day, seat, talk, text: clean, meaning: this.meaningOf(seat, meaning),
    });
    return clean;
  }

  /** What a speech may claim: only a living player to accuse, a god to be, and the results a seer can have. */
  private meaningOf(seat: number, raw: Partial<Meaning>): Meaning {
    const other = (s: unknown): s is number =>
      typeof s === 'number' && Number.isInteger(s) && s >= 1 && s <= this.players.length && s !== seat;
    const claim = raw.claim && CLAIMABLE.includes(raw.claim) ? raw.claim : null;
    const checks = new Map<number, boolean>();
    for (const c of raw.checks ?? []) if (other(c.seat) && typeof c.wolf === 'boolean') checks.set(c.seat, c.wolf);
    return {
      suspect: other(raw.suspect) && this.player(raw.suspect).alive ? raw.suspect : null,
      claim,
      checks: claim === 'seer' ? [...checks].map(([s, wolf]) => ({ seat: s, wolf })) : [],
      saved: claim === 'witch' && other(raw.saved) ? raw.saved : null,
    };
  }

  /** The players who vote: everyone alive but a flipped idiot. */
  voters(): number[] {
    return this.players.filter((p) => p.alive && !p.flipped).map((p) => p.seat);
  }

  /** Counts a vote: who got the most, with the sheriff's vote one and a half when it is the exile; `tied` on a tie. */
  tally(why: 'sheriff' | 'exile', round: 1 | 2, votes: readonly { seat: number; target: number | null }[]): Tally {
    const by = new Map<number, Ballot>();
    const abstained: number[] = [];
    for (const v of votes) {
      if (v.target === null) {
        abstained.push(v.seat);
        continue;
      }
      const ballot = by.get(v.target) ?? { target: v.target, voters: [], total: 0 };
      ballot.voters.push(v.seat);
      ballot.total += why === 'exile' && v.seat === this.sheriff ? SHERIFF_WEIGHT : 1;
      by.set(v.target, ballot);
    }
    const ballots = [...by.values()].sort((a, b) => b.total - a.total || a.target - b.target);
    const top = ballots.filter((b) => b.total === ballots[0]?.total).map((b) => b.target);
    const out = top.length === 1 ? (top[0] ?? null) : null;
    const tied = top.length > 1 ? top : [];
    this.record('all', { kind: 'votes', day: this.day, why, round, ballots, abstained, out, tied });
    return { out, tied };
  }

  /** What `seat` may read from entry `from` on, and where to read from next time. */
  viewFrom(seat: number, from: number): { entries: Entry[]; next: number } {
    const entries = this.log.slice(from)
      .filter((l) => l.to === 'all' || l.to.includes(seat))
      .map((l) => l.entry);
    return { entries, next: this.log.length };
  }

  /** The players the seer `seat` has checked. */
  checked(seat: number): Set<number> {
    const seen = new Set<number>();
    for (const l of this.log) if (l.entry.kind === 'check' && l.entry.seat === seat) seen.add(l.entry.target);
    return seen;
  }

  /** The seats `seat` may name for `q`. */
  options(seat: number, q: Question): number[] {
    const alive = this.alive().map((p) => p.seat);
    const others = alive.filter((s) => s !== seat);
    switch (q.kind) {
      case 'kill': return alive;
      case 'check': {
        const seen = this.checked(seat);
        return others.filter((s) => !seen.has(s));
      }
      case 'witch': return q.poison ? others : [];
      case 'vote': {
        const open = q.among ?? others;
        return open.filter((s) => s !== seat && alive.includes(s) && !this.player(s).flipped);
      }
      case 'shoot':
      case 'badge': return others;
      case 'run':
      case 'speak': return [];
    }
  }

  /** The order of a day's talk: the living, from the seat after `after`. */
  talkOrder(after: number): number[] {
    const alive = this.alive().map((p) => p.seat);
    const first = alive.findIndex((s) => s > after);
    return first <= 0 ? alive : [...alive.slice(first), ...alive.slice(0, first)];
  }
}
