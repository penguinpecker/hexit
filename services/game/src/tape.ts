// The price tape (docs/monad/DECISIONS.md "Column tape signature"): every 100 ms grid tick the index produced, kept in
// memory for a few minutes, and the per-column slice the recorder signs once the column's span has ended.
import { tHi, tLo } from '@hexit/monad';

export type Tick = { ts: number; px: bigint };

/**
 * Grid ticks, oldest first, strictly increasing; ticks older than keepMs behind the newest are dropped.
 * A tick that moves more than maxMoveE8 per 100 ms from the last kept one is refused (settleColumn would reject the
 * whole tape, MoveTooLarge); the allowance grows with the time since the last kept tick, so the tape heals itself and
 * the hole it leaves is a gap the contract VOIDs. maxMoveE8 0 = no check.
 */
export class TickRing {
  ticks: Tick[] = [];
  keepMs: number;
  maxMoveE8: bigint;
  constructor(keepMs = 300_000, maxMoveE8 = 0n) { this.keepMs = keepMs; this.maxMoveE8 = maxMoveE8; }
  push(t: Tick): boolean {
    const last = this.ticks.at(-1);
    if (last && t.ts <= last.ts) return false;
    if (last && this.maxMoveE8 > 0n) {
      const mv = t.px > last.px ? t.px - last.px : last.px - t.px;
      if (mv * 100n > this.maxMoveE8 * BigInt(t.ts - last.ts)) return false;
    }
    this.ticks.push(t);
    // ponytail: splice every 100 ticks instead of a shift per tick; a real ring buffer if this ever shows in a profile
    if (this.ticks[100] && this.ticks[100].ts < t.ts - this.keepMs) {
      const n = this.ticks.findIndex((x) => x.ts >= t.ts - this.keepMs);
      this.ticks.splice(0, n);
    }
    return true;
  }
  last(): Tick | undefined { return this.ticks.at(-1); }
  since(ts: number): Tick[] {
    let i = this.ticks.length;
    while (i > 0 && this.ticks[i - 1].ts >= ts) i--;
    return this.ticks.slice(i);
  }
}

/**
 * Column k's tape: every tick from the last at or before tLo(k) through the first at or after tHi(k). Null until a tick
 * at or after tHi(k) exists, or when the ticks no longer reach back to tLo(k) (then nobody can settle k: it VOIDs).
 * Missing ticks inside stay missing: the contract turns a segment over gapMs into a gap (untouched bands VOID).
 */
export function tapeFor(ticks: readonly Tick[], k: number): Tick[] | null {
  const lo = tLo(k), hi = tHi(k);
  let b = ticks.length - 1;
  if (b < 0 || ticks[b].ts < hi) return null;
  while (b > 0 && ticks[b - 1].ts >= hi) b--;
  let a = b;
  while (a >= 0 && ticks[a].ts > lo) a--;
  return a < 0 ? null : ticks.slice(a, b + 1);
}
