// node --test test/seams.test.ts : the pure seam helpers the app's board relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jOf, multAt, overPayout, nonceUsed, freeNonce, balanceMicro, mergeHistory, boardGeom, marketOf, activityOf, feedKey, feedView, ago, type Tap, type OpenBet, type History } from '../src/seams.ts';

const ROW = 0.05;

test('j from (c, L): prototype rows map to contract bands (odd columns half a band higher)', () => {
  // prototype: L = (r + 0.5*(c&1))*row; HexGeo: centre 2pc = (2j+1)row even k, (2j+2)row odd k  =>  j = r
  for (const c of [370000, 370001]) for (const r of [-3, 0, 2405, 2406]) {
    const L = (r + 0.5 * (c & 1)) * ROW;
    assert.equal(jOf(c, L, ROW), r, `c=${c} r=${r}`);
    const pc2 = (c & 1) === 0 ? 2 * r + 1 : 2 * r + 2;       // HexGeo.segHits centre, in half rows
    assert.ok(Math.abs((L + ROW / 2) * 2 - pc2 * ROW) < 1e-9);
  }
});

test('getMult from a signed quote: null off-quote or wrong k, 0 not offered, mult/100 inside', () => {
  const mults = Array.from({ length: 64 }, (_, i) => (i === 5 ? 0 : 101 + i));
  const col = { k: 101, qJ0: 2400, mults };
  const L = (j: number, c: number) => (j + 0.5 * (c & 1)) * ROW;
  assert.equal(multAt(col, 101, L(2400, 101), ROW), 1.01);
  assert.equal(multAt(col, 101, L(2463, 101), ROW), 1.64);
  assert.equal(multAt(col, 101, L(2405, 101), ROW), 0);
  assert.equal(multAt(col, 101, L(2399, 101), ROW), null);
  assert.equal(multAt(col, 101, L(2464, 101), ROW), null);
  assert.equal(multAt(col, 165, L(2400, 165), ROW), null);  // a quote for another column
  assert.equal(multAt(undefined, 101, L(2400, 101), ROW), null);
});

test('nonce window: bit i of the mask = base + i used; lowest free nonce skips used and held ones', () => {
  // contract _useNonce: base slides past a run of used nonces, so bit 0 is clear after any landing
  assert.equal(nonceUsed(10, 0b1010, 9), true);              // below the window
  assert.deepEqual([10, 11, 12, 13].map((n) => nonceUsed(10, 0b1010, n)), [false, true, false, true]);
  assert.equal(nonceUsed(10, 0xffffffff, 41), true);
  assert.equal(nonceUsed(10, 0xffffffff, 42), false);         // past the window: unused (the contract rejects it)
  assert.equal(freeNonce(10, 0b1010, () => false), 10);
  assert.equal(freeNonce(10, 0b1010, (n) => n === 10), 12);   // 10 is in flight, 11 landed
  assert.equal(freeNonce(0, 0, (n) => n < 32), -1);           // all 32 held: no nonce
});

test('payout cap matches placeBet integer math', () => {
  assert.equal(overPayout(25_000_000, 10000, 2_500_000_000), false);   // $25 x 100x = $2,500: allowed
  assert.equal(overPayout(50_000_000, 5001, 2_500_000_000), true);
});

test('one balance: a tap, its booking, a win shown before the keeper settles, then the settle: no jump back', () => {
  const tap: Tap = { c: 9, j: 4, stake: 1, mult: 2.5, state: 'pending' };
  const bet: OpenBet = { k: 9, j: 4, stake: 1_000_000, mult: 250 };
  const bal = (credit: number, base: number, open: OpenBet[]) => balanceMicro(credit, base, 0, open, [tap]);
  assert.equal(bal(100e6, 7, []), 99e6);                     // sent, not booked: the stake is held back at once
  tap.state = 'armed'; tap.n = 7;
  assert.equal(bal(100e6, 7, []), 99e6);                     // confirmed before the Player update: still held
  assert.equal(bal(99e6, 8, [bet]), 99e6);                   // booked: the chain took the stake
  tap.state = 'won';
  assert.equal(bal(99e6, 8, [bet]), 101.5e6);                // HexTouched: the payout shows before the keeper settles
  assert.equal(bal(101.5e6, 8, []), 101.5e6);                // settled (credit += 2.5): same number, nothing jumps
  // the booking update was lost: a win shows its payout at once, and a settle update before BetSettled is not held twice
  const late: Tap = { c: 9, j: 8, stake: 1, mult: 2.5, state: 'won', n: 8 };
  assert.equal(balanceMicro(100e6, 8, 0, [], [late]), 101.5e6); // HexTouched with the Player still pre-booking
  assert.equal(balanceMicro(101.5e6, 9, 0, [], [late]), 101.5e6);   // first update seen is the settled one
  const lost: Tap = { c: 9, j: 5, stake: 1, mult: 2, state: 'armed', n: 9 };
  assert.equal(balanceMicro(98e6, 10, 0, [{ ...bet, j: 5 }], [lost]), 98e6);   // booked
  assert.equal(balanceMicro(98e6, 10, 0, [], [lost]), 98e6);    // settled LOSS before its BetSettled lands: not held back twice
  assert.equal(balanceMicro(99e6, 10, 0, [{ ...bet, j: 6 }], [{ c: 9, j: 6, stake: 1, mult: 2.5, state: 'void', n: 9 }]), 100e6);   // refund shown early
  assert.equal(balanceMicro(99e6, 10, 0, [], [{ c: 9, j: 7, stake: 1, mult: 2, state: 'rejected' }]), 99e6);
  assert.equal(balanceMicro(99e6, 10, 0, [{ ...bet, j: 7 }], [{ c: 9, j: 7, stake: 1, mult: 2, state: 'rejected' }]), 99e6);   // reported failed, but it landed
  // out of order: nonce 12 landed and settled before 10 and 11 (base 10, bit 2 set); 11 still in flight
  const outOfOrder: Tap[] = [{ c: 9, j: 1, stake: 1, mult: 2, state: 'dud', n: 12 }, { c: 9, j: 2, stake: 1, mult: 2, state: 'pending', n: 11 }];
  assert.equal(balanceMicro(99e6, 10, 0b100, [], outOfOrder), 98e6);   // 12's loss is in credit already; 11 is held back
  // two markets, one credit: the same (k, j) on BTC (1) and MON (3) are two bets. MON's tap, not booked yet, still costs
  // its stake while BTC's open bet is booked; a win shown on MON pays MON's stake x mult, not BTC's
  const btc: OpenBet = { asset: 1, k: 9, j: 4, stake: 2_000_000, mult: 300 }, mon: Tap = { asset: 3, c: 9, j: 4, stake: 1, mult: 2.5, state: 'pending' };
  assert.equal(balanceMicro(98e6, 7, 0, [btc], [{ asset: 1, c: 9, j: 4, stake: 2, mult: 3, state: 'armed', n: 6 }, mon]), 97e6);
  mon.state = 'won';
  assert.equal(balanceMicro(98e6, 7, 0, [btc], [{ asset: 1, c: 9, j: 4, stake: 2, mult: 3, state: 'armed', n: 6 }, mon]), 99.5e6);
});

test('profile history: session taps + persisted bets, each once; stats = server all-time + what it has not counted yet', () => {
  const bet = (k: number, outcome: number | null, credited: string | null, mult = 200) =>
    ({ asset: 1, k, j: 1, stake: '1000000', mult, outcome, credited, placedAt: 1e12, settledAt: outcome ? 1e12 + 5000 : null });
  const h: History = { bets: [bet(4, null, null), bet(3, 1, '2000000'), bet(2, 2, '0'), bet(1, 3, '1000000')],
    stats: { taps: 9, wins: 3, losses: 4, bestMult: 300, pnl: '-500000' } };
  const live = [
    { asset: 1, mult: 4, stake: 1, state: 'won', pnl: 3, t: 2e9, k: 5, j: 1 },   // not on the server yet
    { asset: 1, mult: 2.5, stake: 1, state: 'won', pnl: 1.5, t: 2e9, k: 4, j: 1 },   // HexTouched; server still has it open
    { asset: 1, mult: 2, stake: 1, state: 'won', pnl: 1, t: 2e9, k: 3, j: 1 },   // server settled it too
  ];
  const m = mergeHistory(h, live);
  assert.deepEqual(m.trades.map((t) => [t.k, t.state]), [[5, 'won'], [4, 'won'], [3, 'won'], [2, 'dud'], [1, 'void']]);
  assert.equal(m.trades[3].pnl, -1);
  assert.deepEqual(m.stats, { taps: 10, hitRate: 5 / 9, best: 4, pnl: -0.5 + 3 + 1.5 });
  // no database (or not loaded yet): the session alone, as before
  assert.deepEqual(mergeHistory(null, live.slice(0, 1)).stats, { taps: 1, hitRate: 1, best: 4, pnl: 3 });
  assert.deepEqual(mergeHistory({ bets: [], stats: null }, []).stats, { taps: 0, hitRate: null, best: null, pnl: 0 });
  // a session longer than the list (60 losses, the server has all 60, the newest 50 came back): none counted twice
  const s60 = Array.from({ length: 60 }, (_, i) => ({ asset: 1, mult: 2, stake: 1, state: 'dud', pnl: -1, t: 2000 + 60 - i, placed: 1000 + 60 - i, k: 100 + 60 - i, j: 1 }));
  const b60 = s60.slice(0, 50).map((t) => ({ asset: 1, k: t.k, j: 1, stake: '1000000', mult: 200, outcome: 2, credited: '0', placedAt: t.placed * 1000, settledAt: t.t * 1000 }));
  const m60 = mergeHistory({ bets: b60, stats: { taps: 60, wins: 0, losses: 60, bestMult: null, pnl: '-60000000' } }, s60);
  assert.deepEqual([m60.stats.taps, m60.stats.pnl, m60.trades.length], [60, -60, 60]);
  // the newest first, whichever side it came from
  assert.deepEqual(mergeHistory({ bets: [bet(7, 2, '0')], stats: null }, [{ ...live[0], t: 1 }]).trades.map((t) => t.k), [7, 5]);
  // the same hex on the other market is another trade, and every trade keeps its market
  const two = mergeHistory({ bets: [bet(5, 2, '0')], stats: null }, [{ ...live[0], asset: 3 }]);
  assert.deepEqual(two.trades.map((t) => [t.asset, t.k, t.state]), [[3, 5, 'won'], [1, 5, 'dud']]);
});

test('board layout: phones keep the 390-wide design; wide screens fill the width with the quoted columns', () => {
  const p = boardGeom(412, 829);
  assert.deepEqual([p.desk, p.s, p.R, p.nowX, p.cy], [false, 1, 30, 412 * 0.22, 829 * 0.47]);
  for (const [w, h] of [[1366, 768], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160], [5120, 1440]]) {
    const g = boardGeom(w, h);
    assert.ok(g.desk && g.s >= 1 && g.s <= 1.8 && Math.abs(g.W * g.s - w) < 1e-9, `${w}x${h} scale`);
    assert.ok(g.nowX >= 0.22 * g.W - 1e-9 && (w / h > 2.4 || g.nowX <= 0.28 * g.W), `${w}x${h} now at ${(g.nowX / g.W).toFixed(3)}`);
    // the real quoter: 18 columns from the first open one (lock margin 1 s, deployment/monad.json). Over a 5 s cycle the
    // newest column's left tip runs from (28.5 + 0.3) R to 1.5 R less: it arrives past the right edge and, with its
    // half-band-offset neighbours, covers the edge at every height until the next one arrives
    for (let a = 0; a < 5; a += 0.25) {
      const tip = g.nowX + (95.1 + 1 - a) * 0.3 * g.R;
      assert.ok(a > 0 || tip > g.W, `${w}x${h} a new column arrives off-screen`);
      assert.ok(tip + 1.5 * g.R >= g.W - 1e-9, `${w}x${h} right edge covered ${a} s after an arrival`);
    }
    assert.ok((g.H - g.top - g.bot) / (Math.sqrt(3) * g.R) >= 8, `${w}x${h} bands`);
  }
  assert.ok(boardGeom(3840, 2160).R * 1.8 > boardGeom(1440, 900).R * 2, 'a 4K screen draws larger hexes');
});

test('marketOf: which market card a stream message feeds (the website)', () => {
  const ms = [{ asset: 1, symbol: 'BTC/USD' }, { asset: 3, symbol: 'MON/USD' }];   // GET /config markets
  assert.equal(marketOf({ asset: 1 }, ms), 'BTC/USD');
  assert.equal(marketOf({ asset: 3 }, ms), 'MON/USD');
  assert.equal(marketOf({ asset: '3' }, ms), 'MON/USD');
  assert.equal(marketOf({ asset: 0 }, ms), '');          // a SOL refund: no market card
  assert.equal(marketOf({}, ms), '');                    // no asset: no card claims it
  assert.equal(marketOf({ asset: 1 }), '');              // /config not loaded yet
});

test('live feed: only well-formed real items show; one card per entry and per player per settle tx; what each says', () => {
  const tx = '0x' + 'Ab'.repeat(32), P = '0x81aBcd00000000000000000000000000000E0402', Q = '0x' + '22'.repeat(20);
  const ok = { id: tx + ':3', kind: 'entry', tx, block: 9, ts: 1000, player: P, handle: '0x81…0402', asset: 1, symbol: 'BTC/USD', k: 5, j: 7, stake: '1000000', mult: 240, outcome: null, credited: null, payout: '0' };
  const e = activityOf(ok)!;
  assert.equal(e.tx, tx.toLowerCase()); assert.equal(e.stake, 1e6); assert.equal(e.outcome, null); assert.equal(e.payout, 0); assert.equal(e.backfill, false);
  for (const bad of [{ ...ok, tx: '0x12' }, { ...ok, player: 'nope' }, { ...ok, kind: 'grant' }, { ...ok, kind: 'settle', outcome: 4 }, null])
    assert.equal(activityOf(bad), null, JSON.stringify(bad));
  assert.equal(activityOf({ ...ok, handle: '<img onerror=x>' })!.handle, 'imgonerrorx');   // shown with textContent anyway
  assert.equal(activityOf({ ...ok, handle: '', symbol: 'evil' })!.handle, '0x81aB…0402');
  assert.equal(activityOf({ ...ok, symbol: 'evil' })!.symbol, '');
  assert.deepEqual([feedView([e]).badge, feedView([e]).title, feedView([e]).who], ['Entry', '$1 @ 2.40x', '0x81…0402']);
  assert.equal(feedView([e], P.toLowerCase()).who, 'You');
  const s = (o: number, payout: string, id: string, player = P) => activityOf({ ...ok, id, player, kind: 'settle', outcome: o, credited: payout, payout })!;
  const win = s(1, '2400000', 'a'), loss = s(2, '0', 'b'), refund = s(3, '1000000', 'c');
  assert.deepEqual([feedView([win]).tone, feedView([win]).title, feedView([win]).sub], ['win', '$2.40', '$1 @ 2.40x · BTC/USD']);
  assert.equal(feedView([e]).sub, 'BTC/USD');
  assert.deepEqual([feedView([refund]).badge, feedView([refund]).title], ['Refund', '$1.00']);
  assert.deepEqual([feedView([loss]).badge, feedView([loss]).title, activityOf({ ...ok, kind: 'settle', outcome: 2, payout: '5' })!.payout], ['No hit', '$1 @ 2.40x', 0]);
  assert.equal(feedKey(win), feedKey(loss));   // same player, same settle tx: one card
  assert.notEqual(feedKey(win), feedKey(s(1, '1', 'd', Q)));
  assert.notEqual(feedKey(e), feedKey(activityOf({ ...ok, id: tx + ':4' })!));
  assert.deepEqual([feedView([win, loss]).tone, feedView([win, loss]).title, feedView([win, loss]).sub], ['win', '$2.40', '2 bets · $2 · BTC/USD']);
  assert.equal(feedView([win, activityOf({ ...ok, id: 'e', kind: 'settle', outcome: 2, stake: '500000' })!]).sub, '2 bets · $1.50 · BTC/USD');
  assert.equal(feedView([refund, loss]).tone, 'loss');
  assert.deepEqual([0, 999, 1000, 59_999, 60_000, 7_200_000, 90_000_000, -5].map(ago), ['now', 'now', '1s', '59s', '1m', '2h', '1d', 'now']);
});
