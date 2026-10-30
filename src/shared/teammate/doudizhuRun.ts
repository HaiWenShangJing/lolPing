/**
 * The order of a Dou Dizhu game: the deal, finding the landlords (by bidding for the seat, or by calling a card), then
 * turn after turn of plays and passes until a hand is empty. `runDoudizhu` is the only way in.
 */
import { Table } from './doudizhu';
import type { Card } from './doudizhuCards';
import { MAX_BID, MAX_DEALS, Stopped } from './doudizhuTypes';
import type { Deps, Outcome, Size } from './doudizhuTypes';

/** The deals tried for a card to call before any card in a hand will do. */
const MAX_CALL_DEALS = 20;

/** Plays one game to its end. Null when the game was stopped from outside before it ended. */
export async function runDoudizhu(deps: Deps, size: Size): Promise<Outcome | null> {
  const t = new Table(deps, size);
  try {
    await t.emit({ k: 'start', size });
    const leader = t.cfg.mode === 'bid' ? await bidding(t) : await calling(t);
    const out = await rounds(t, leader);
    const result = t.settle(out);
    await t.emit({ k: 'end', result });
    return { result, turns: t.turns, fallbacks: t.fallbacks };
  } catch (err) {
    if (err instanceof Stopped) return null;
    throw err;
  }
}

/**
 * Deals and bids until there is a landlord, who leads. A random seat bids first and each seat has one turn to outbid the
 * best so far, a bid of 3 ending it there. When nobody bids the cards are dealt again; after the last deal the seat that
 * bid first is made the landlord for 1.
 */
async function bidding(t: Table): Promise<number> {
  for (let deals = 1; ; deals++) {
    t.deal();
    await t.emit({ k: 'deal' });
    const first = Math.floor(t.deps.random() * t.size);
    let best = 0;
    let winner = -1;
    for (let i = 0; i < t.size && best < MAX_BID; i++) {
      const seat = (first + i) % t.size;
      const reply = await t.ask(seat, { k: 'bid', min: best + 1, max: MAX_BID });
      const pass = reply?.k === 'bid' && reply.bid === 0;
      const bid = reply?.k === 'bid' && Number.isInteger(reply.bid) && reply.bid > best && reply.bid <= MAX_BID ? reply.bid : 0;
      if (!pass && bid === 0) t.fallbacks += 1;
      await t.emit({ k: 'bid', seat, bid });
      if (bid > 0) {
        best = bid;
        winner = seat;
      }
    }
    if (winner < 0 && deals >= MAX_DEALS) {
      best = 1;
      winner = first;
      await t.emit({ k: 'bid', seat: first, bid: 1 });
    }
    if (winner >= 0) {
      t.crown(winner, best);
      await t.emit({ k: 'landlord', seat: winner, bid: best, holes: t.holes });
      return winner;
    }
    await t.emit({ k: 'redeal' });
  }
}

/** Deals and calls a card; the landlord in the open, who holds its first copy, leads. */
async function calling(t: Table): Promise<number> {
  for (let deals = 1; deals <= MAX_CALL_DEALS; deals++) {
    t.deal();
    const found = t.findCall(deals === MAX_CALL_DEALS);
    if (!found) continue;
    await t.emit({ k: 'deal' });
    t.setCall(found.card, found.held);
    const lord = t.lord as number;
    await t.emit({ k: 'call', seat: lord, card: found.card, holes: t.holes });
    return lord;
  }
  throw new Error('no card could be called');
}

/** Turn after turn from `first`: a play that beats the table or a pass, the last one to play leading again once the rest have passed. */
async function rounds(t: Table, first: number): Promise<number> {
  let seat = first;
  for (;;) {
    t.turn = seat;
    t.turns += 1;
    const lead = t.top === null;
    await t.emit({ k: 'turn', seat, lead });
    const play = t.accept(seat, await t.ask(seat, { k: 'play', lead }));
    if (play) {
      const cards = t.put(seat, play);
      await t.emit({ k: 'play', seat, play, cards });
      if (t.reveals(seat, cards)) {
        t.reveal(seat);
        await t.emit({ k: 'reveal', seat });
      }
      if (t.p(seat).hand.length === 0) return seat;
    } else {
      t.pass();
      await t.emit({ k: 'pass', seat });
    }
    seat = (seat + 1) % t.size;
  }
}
