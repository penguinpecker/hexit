// Quoter (DECISIONS.md "Quotes are signed off-chain"), one per market: VolState from the market's index
// ticks, and every 250 ms the 18 board columns from firstOpenColumn(now, lockMarginMs) priced with packages/pricing
// quoteBoard at the market's band height, each signed as an EIP-712 Quote{asset, rowE8, ...} by the quoter key (the chain
// refuses a quote whose rowE8 is not the market's when the bet lands, so one priced before a row change is void). Sends nothing:
// the quotes go out on /stream and come back inside relayed bets.
import type { Hex, LocalAccount } from 'viem';
import { signQuote, type gameDomain } from '@hexit/monad';
import { quoteBoard, TableCache, volInit, volStep, type VolState } from '@hexit/pricing';
import type { Tick } from './tape.ts';

/** rowE8: the band height these quotes were priced at and signed with (the app draws the board with it and sends it back
 *  in quote.rowE8). */
export type QuoteMsg = { t: 'quotes'; asset: number; rowE8: string; refTsMs: string; refPriceE8: string; expiresMs: string;
  cols: { k: number; qJ0: number; sigBucket: number; mults: number[]; sig: Hex }[] };

const EVERY_MS = 250;
const TAPE_MAX_AGE_MS = 300;   // no index tick for this long: stop quoting (the signed quotes age out on chain)

/** market.rowE8 is read every round (a live MarketSet may change it); volAnn is the annual-vol prior, the VolState
 *  floor (sigBase), which sets the board most of the time (pricing sits on its floor 83-88 % of the time). */
export function startQuoter(o: { account: LocalAccount; domain: ReturnType<typeof gameDomain>;
  market: { asset: number; rowE8: bigint; volAnn: number }; lockMarginMs: number; quoteMaxAgeMs: number;
  last: () => Tick | undefined; publish: (m: QuoteMsg) => void; log: (cls: string, msg: string) => void }) {
  const { asset, volAnn } = o.market;
  const cache = new TableCache();
  let vol: VolState | null = null, prev: Tick | null = null, busy = false, at = 0;

  const timer = setInterval(async () => {
    const last = o.last(), now = Date.now();
    if (busy || !vol || !last || now - last.ts > TAPE_MAX_AGE_MS) return;
    busy = true;
    try {
      const rowE8 = o.market.rowE8, board = quoteBoard({ nowMs: now, priceE8: last.px, rowE8, vol, cache, marginMs: o.lockMarginMs });
      // expiresMs = the contract's own age limit, so the app drops a quote exactly when a bet on it would be QuoteStale
      const q = { refTsMs: BigInt(last.ts), refPriceE8: last.px, expiresMs: BigInt(last.ts + o.quoteMaxAgeMs) };
      const cols = await Promise.all(board.map(async (c) => {
        const mults = Array.from(c.mults);
        return { k: c.k, qJ0: c.qJ0, sigBucket: c.sigBucket, mults, sig: await signQuote(o.account, o.domain, { asset, rowE8, k: c.k, qJ0: c.qJ0, ...q }, mults) };
      }));
      o.publish({ t: 'quotes', asset, rowE8: String(rowE8), refTsMs: String(q.refTsMs), refPriceE8: String(q.refPriceE8), expiresMs: String(q.expiresMs), cols });
      at = now;
    } catch (e) { o.log(`quoter-error-${asset}`, String((e as Error).message ?? e).slice(0, 200)); }
    finally { busy = false; }
  }, EVERY_MS);

  return {
    /** One index tick; VolState steps once per consecutive 100 ms pair (a gap restarts the pairing). */
    onTick(t: Tick) {
      const p = Number(t.px) / 1e8;
      if (!vol) vol = volInit(p, volAnn);
      else if (prev && t.ts - prev.ts === 100) vol = volStep(vol, p - Number(prev.px) / 1e8);
      prev = t;
    },
    at: () => at,
    stop: () => clearInterval(timer),
  };
}
