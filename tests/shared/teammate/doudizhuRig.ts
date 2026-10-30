import { botBid, botPlay } from '../../../src/shared/teammate/doudizhuAi';
import { PACK, RANKS, SMALL, SUITS } from '../../../src/shared/teammate/doudizhuCards';
import type { Card } from '../../../src/shared/teammate/doudizhuCards';
import type { Table } from '../../../src/shared/teammate/doudizhu';
import { runDoudizhu } from '../../../src/shared/teammate/doudizhuRun';
import type { Ask, Deps, Entry, Outcome, Reply, Size } from '../../../src/shared/teammate/doudizhuTypes';
import { viewFor } from '../../../src/shared/teammate/doudizhuView';
import { lcg } from '../../main/teammate/gameFakes';

const LABEL = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'S', 'B'];

/** Cards from a spelled-out hand such as '3 3 4 J S': every copy of a rank gets a card of its own. */
export function cards(spec: string): Card[] {
  const seen = new Array<number>(RANKS).fill(0);
  return spec.split(/\s+/).filter(Boolean).map((tok) => {
    const rank = LABEL.indexOf(tok);
    if (rank < 0) throw new Error(`bad card ${tok}`);
    const k = seen[rank]++ as number;
    if (rank >= SMALL) return { id: k * PACK + 52 + (rank - SMALL), rank, suit: null };
    const suit = SUITS[k % 4] as (typeof SUITS)[number];
    return { id: Math.floor(k / 4) * PACK + SUITS.indexOf(suit) * 13 + rank, rank, suit };
  });
}

export interface Played {
  outcome: Outcome;
  entries: Entry[];
  table: Table;
}

/** What a script says to a question: a reply, null for no answer, or undefined to leave it to the bot. */
export type Script = (seat: number, ask: Ask, table: Table) => Reply | null | undefined;

/** The deps of a table where every seat is a bot but for what the script takes over. */
export function botDeps(seed: number, entries: Entry[], script?: Script, tables: Table[] = []): Deps {
  return {
    random: lcg(seed),
    ask: async (seat, ask, table) => {
      const scripted = script?.(seat, ask, table);
      if (scripted !== undefined) return scripted;
      const v = viewFor(table, seat);
      return ask.k === 'bid' ? { k: 'bid', bid: botBid(v, ask.min, ask.max) } : { k: 'play', ids: botPlay(v) };
    },
    emit: (entry, table) => {
      tables[0] = table;
      entries.push(entry);
    },
    stopped: () => false,
  };
}

/** Plays a whole game of bots, with a script to take over some of the questions. */
export async function selfPlay(size: Size, seed: number, script?: Script): Promise<Played> {
  const entries: Entry[] = [];
  const tables: Table[] = [];
  const outcome = await runDoudizhu(botDeps(seed, entries, script, tables), size);
  if (!outcome || !tables[0]) throw new Error('the game did not finish');
  return { outcome, entries, table: tables[0] };
}
