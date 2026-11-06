/**
 * Werewolf, in two boards. The classic one is for twelve: four wolves, four villagers and four gods (seer, witch,
 * hunter, idiot). The crescent one is for eighteen, with two more cards under the table for the thief: guard, cupid,
 * thief, wild child, wolf beauty and hidden wolf join the usual roles.
 * This is the pure part, the rules and what each player may know. What a computer player does is in
 * `werewolfPlay.ts` and `werewolfMind.ts`; `werewolfRun.ts` plays a game through it.
 */

import type { PetId } from './pet';
import { cleanLine } from './petText';

export type Role =
  | 'wolf' | 'villager' | 'seer' | 'witch' | 'hunter' | 'idiot'
  | 'guard' | 'cupid' | 'thief' | 'wildchild' | 'beauty' | 'hidden';
export type Who = 'user' | PetId;
export type Mode = 'classic' | 'crescent';
/** The lovers win alone only when one of them is a wolf and the other is not, and nobody else is left. */
export type Side = 'wolves' | 'village' | 'lovers';
/**
 * How a player died: the wolves' knife, the witch's poison, a vote, the hunter's shot, a self-destruct, a broken heart
 * (the other lover died) or the wolf beauty's charm (she died).
 */
export type Cause = 'wolves' | 'poison' | 'exile' | 'shot' | 'boom' | 'grief' | 'charm';
/** Which side's goal was met: every wolf out (village), or every god or every villager out (wolves). */
export type WinReason = 'wolves' | 'gods' | 'villagers' | 'lovers';
/** What a speech is: the day's talk, a sheriff candidate's, a tie's second round, or a dead player's last words. */
export type Talk = 'day' | 'campaign' | 'pk' | 'last';

/** The seats of the classic board; the crescent board has `CRESCENT_SEATS`. */
export const SEATS = 12;
export const CRESCENT_SEATS = 18;
export const MODES: readonly Mode[] = ['classic', 'crescent'];
export const isMode = (raw: unknown): raw is Mode => (MODES as readonly unknown[]).includes(raw);
export const seatsOf = (mode: Mode): number => (mode === 'crescent' ? CRESCENT_SEATS : SEATS);
export const ROLES: readonly Role[] = [
  'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot',
];
export const CRESCENT_ROLES: readonly Role[] = [
  'seer', 'witch', 'hunter', 'guard', 'cupid', 'thief', 'wildchild', 'beauty', 'hidden', 'wolf', 'wolf',
  'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager',
];
/** The two cards the thief chooses between: one of them is a wolf, as in the usual rules. */
export const CRESCENT_EXTRAS: readonly Role[] = ['wolf', 'villager'];
export const rolesOf = (mode: Mode): readonly Role[] => (mode === 'crescent' ? CRESCENT_ROLES : ROLES);
const GODS: readonly Role[] = ['seer', 'witch', 'hunter', 'idiot', 'guard'];
export const isGod = (role: Role): boolean => GODS.includes(role);
/** Every role that wins with the wolves. The hidden wolf is one: the seer sees it as good. */
export const isWolfSide = (role: Role): boolean => role === 'wolf' || role === 'beauty' || role === 'hidden';
/** The wolves that may blow themselves up by day. */
export const canBoom = (role: Role): boolean => role === 'wolf' || role === 'beauty';
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
  /** The thief took one of the two cards under the table, and is that role now. */
  | { kind: 'thief'; seat: number; cards: Role[]; role: Role }
  | { kind: 'lovers'; cupid: number; seats: [number, number] }
  | { kind: 'model'; seat: number; target: number }
  | { kind: 'guard'; seat: number; target: number }
  | { kind: 'charm'; seat: number; target: number }
  /** The wild child's model died: he is a wolf now; `wolves` are the wolves he and they now know. */
  | { kind: 'turned'; seat: number; wolves: number[] }
  /** `seat` died with `of`: of grief for a lover, or charmed by the wolf beauty. */
  | { kind: 'follow'; seat: number; of: number; cause: 'grief' | 'charm' }
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
  | { kind: 'badge' }
  /** The thief: which of the two cards under the table to take. */
  | { kind: 'thief'; cards: Role[] }
  | { kind: 'couple' }
  | { kind: 'model' }
  | { kind: 'guard' }
  | { kind: 'charm' };

export type Answer =
  | { kind: 'card'; index: number }
  | { kind: 'pair'; seats: [number, number] }
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
  /** The two the cupid joined; each dies of grief with the other. */
  lovers: [number, number] | null = null;
  /** The wild child's model: when it dies, the wild child becomes a wolf. */
  model: number | null = null;
  /** Whom the guard guarded last night, who may not be guarded again tonight. */
  lastGuard: number | null = null;
  /** The players the wolf beauty charmed: they die with her. */
  readonly charmed: number[] = [];
  /** The two cards under the table, for the thief. */
  extras: Role[] = [];
  private result: { winner: Side; why: WinReason } | null = null;

  private constructor(players: Player[], readonly mode: Mode) {
    this.players = players;
  }

  /**
   * Deals the players their seats and roles, both shuffled so the user is not always the same one. With `wish` the user
   * gets that role and the others share what is left at random.
   */
  static deal(whos: readonly Who[], random: () => number, mode: Mode = 'classic', wish?: Role): WerewolfGame {
    const seats = seatsOf(mode);
    if (whos.length !== seats) throw new Error(`A game needs ${seats} players.`);
    const cards = [...rolesOf(mode)];
    const at = wish === undefined || !whos.includes('user') ? -1 : cards.indexOf(wish);
    if (at < 0) {
      const roles = shuffled(cards, random);
      return WerewolfGame.seat(shuffled(whos, random).map((who, i) => ({ who, role: roles[i] as Role })), mode);
    }
    cards.splice(at, 1);
    const roles = shuffled(cards, random);
    const others = shuffled(whos.filter((x) => x !== 'user'), random);
    const dealt = [
      { who: 'user' as Who, role: wish as Role },
      ...others.map((who, i) => ({ who, role: roles[i] as Role })),
    ];
    return WerewolfGame.seat(shuffled(dealt, random), mode);
  }

  /** Seats the players in the order given, each told its role and each wolf the other wolves. */
  static seat(dealt: readonly { who: Who; role: Role }[], mode: Mode = 'classic'): WerewolfGame {
    const game = new WerewolfGame(dealt.map((d, i) => ({
      seat: i + 1, who: d.who, role: d.role, alive: true, flipped: false, boomed: false,
    })), mode);
    if (mode === 'crescent') game.extras = [...CRESCENT_EXTRAS];
    for (const p of game.players) game.record([p.seat], { kind: 'start', seat: p.seat, role: p.role });
    // The wolves know one another but not the hidden wolf, who knows them.
    const wolves = game.players.filter((p) => p.role === 'wolf' || p.role === 'beauty').map((p) => p.seat);
    const hidden = game.players.filter((p) => p.role === 'hidden').map((p) => p.seat);
    game.record([...wolves, ...hidden], { kind: 'wolves', seats: wolves });
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
    return this.players.filter((p) => p.alive && isWolfSide(p.role));
  }

  /** The wolves that choose the night's victim: the hidden wolf joins only when no other wolf is left. */
  killers(): Player[] {
    const open = this.players.filter((p) => p.alive && (p.role === 'wolf' || p.role === 'beauty'));
    return open.length > 0 ? open : this.players.filter((p) => p.alive && p.role === 'hidden');
  }

  /** The wolves that may blow themselves up by day. */
  boomers(): Player[] {
    return this.players.filter((p) => p.alive && canBoom(p.role));
  }

  /** What the seer sees: a wolf or a wolf beauty, never the hidden wolf. */
  looksWolf(seat: number): boolean {
    const role = this.player(seat).role;
    return role === 'wolf' || role === 'beauty';
  }

  /** The other lover, to a lover. */
  partnerOf(seat: number): number | null {
    if (!this.lovers || !this.lovers.includes(seat)) return null;
    return this.lovers[0] === seat ? this.lovers[1] : this.lovers[0];
  }

  seatOfUser(): number | null {
    return this.players.find((p) => p.who === 'user')?.seat ?? null;
  }

  record(to: Logged['to'], entry: Entry): void {
    this.log.push({ to, entry });
  }

  /** Who has won as things stand, and why: no wolf is left, or no god is, or no villager is, or the lovers alone are. */
  decided(): { winner: Side; why: WinReason } | null {
    const alive = this.alive();
    if (this.lovers) {
      const [a, b] = this.lovers.map((s) => this.player(s));
      if (a && b && a.alive && b.alive && isWolfSide(a.role) !== isWolfSide(b.role) && alive.length === 2) {
        return { winner: 'lovers', why: 'lovers' };
      }
    }
    let wolves = 0;
    let villagers = 0;
    let gods = 0;
    for (const p of alive) {
      if (isWolfSide(p.role)) wolves++;
      else if (isGod(p.role)) gods++;
      else villagers++;
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

  /**
   * Ends the night: the wolves' victim dies unless saved or guarded (both together kill it), and so does whoever was
   * poisoned; one potion a night. Whoever dies of grief or a charm with them is named at dawn too.
   */
  endNight(night: { kill: number | null; saved: boolean; poisoned: number | null; guarded?: number | null }): number[] {
    const before = this.deaths.length;
    const dead = new Map<number, Cause>();
    const guarded = night.kill !== null && night.guarded === night.kill;
    if (night.kill !== null && night.saved === guarded) dead.set(night.kill, 'wolves');
    if (night.poisoned !== null && !night.saved) dead.set(night.poisoned, 'poison');
    for (const seat of [...dead.keys()].sort((a, b) => a - b)) this.die(seat, dead.get(seat) ?? 'wolves');
    const list = this.deaths.slice(before).map((d) => d.seat).sort((a, b) => a - b);
    this.record('all', { kind: 'dawn', day: this.day, died: list });
    return list;
  }

  /** A player dies; what follows from it (words, shot, badge) waits in `deaths`, and who dies with it dies now. */
  die(seat: number, cause: Cause): void {
    const p = this.player(seat);
    if (!p.alive) return;
    p.alive = false;
    this.deaths.push({ seat, cause, day: this.day });
    if (p.role === 'beauty') {
      for (const c of this.charmed) {
        if (!this.player(c).alive) continue;
        this.record('all', { kind: 'follow', seat: c, of: seat, cause: 'charm' });
        this.die(c, 'charm');
      }
    }
    const partner = this.partnerOf(seat);
    if (partner !== null && this.player(partner).alive) {
      this.record('all', { kind: 'follow', seat: partner, of: seat, cause: 'grief' });
      this.die(partner, 'grief');
    }
    if (this.model === seat) this.turn();
  }

  /** The wild child's model is dead: he becomes a wolf, and he and the wolves are told of one another. */
  private turn(): void {
    const child = this.players.find((q) => q.alive && q.role === 'wildchild');
    if (!child) return;
    const old = this.players.filter((q) => q.alive && (q.role === 'wolf' || q.role === 'beauty')).map((q) => q.seat);
    child.role = 'wolf';
    this.record([child.seat, ...old], { kind: 'turned', seat: child.seat, wolves: [...old, child.seat] });
  }

  /** The thief takes the card `index` of the two under the table, and is that role from now on. */
  steal(seat: number, index: number): Role {
    const p = this.player(seat);
    const cards = [...this.extras];
    const role = cards[index] ?? cards[0] ?? 'villager';
    p.role = role;
    this.record([seat], { kind: 'thief', seat, cards, role });
    if (role === 'wolf') {
      const wolves = this.players.filter((q) => q.alive && (q.role === 'wolf' || q.role === 'beauty')).map((q) => q.seat);
      const hidden = this.players.filter((q) => q.role === 'hidden').map((q) => q.seat);
      this.record(wolves.filter((s) => s !== seat), { kind: 'wolves', seats: wolves });
      this.record([seat, ...hidden], { kind: 'wolves', seats: wolves.filter((s) => s !== seat) });
    }
    return role;
  }

  /** The cupid joins two players, who learn of each other. */
  couple(cupid: number, a: number, b: number): void {
    this.lovers = [a, b];
    this.record([...new Set([cupid, a, b])], { kind: 'lovers', cupid, seats: [a, b] });
  }

  adopt(seat: number, target: number): void {
    this.model = target;
    this.record([seat], { kind: 'model', seat, target });
  }

  guardNight(seat: number, target: number): void {
    this.lastGuard = target;
    this.record([seat], { kind: 'guard', seat, target });
  }

  charm(seat: number, target: number): void {
    if (!this.charmed.includes(target)) this.charmed.push(target);
    this.record([seat], { kind: 'charm', seat, target });
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
    if (!canBoom(p.role) || !p.alive) throw new Error(`Player ${seat} cannot self-destruct.`);
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
      case 'couple':
      case 'guard': return q.kind === 'guard' ? alive.filter((s) => s !== this.lastGuard) : alive;
      case 'model':
      case 'charm': return others;
      case 'thief':
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
