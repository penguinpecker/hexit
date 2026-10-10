// One sender per role (relayer, keeper): nonces kept here (Monad accepts nonce gaps at send time, so the chain will not
// tell us about one), transactions signed locally with fixed gas limits (Monad charges the LIMIT; never estimateGas),
// EIP-1559 fees, an access list from the pre-send simulation, and eth_sendRawTransactionSync (returns the receipt at
// Proposed). Every send is simulated first, so a predictable revert is never paid for. SPEC-MONAD §3.5, §5.2.
import { createAccessList, call, getTransactionCount, getTransactionReceipt } from 'viem/actions';
import { formatTransactionReceipt, keccak256, type AccessList, type Address, type Client, type Hex, type LocalAccount, type TransactionReceipt } from 'viem';
import { errorName } from '@hexit/monad';

export const MAX_FEE = 200_000_000_000n;   // 200 gwei cap; Monad charges min(maxFee, base + tip), so a higher cap costs nothing
export const TIP = 2_000_000_000n;         // 2 gwei, Monad's fixed tip

/** Local nonces. take() hands out consecutive nonces from the chain's count; release() returns one that never reached
 *  the chain (the next take() fills that gap first); resync() re-reads the chain before the next take(). */
export class Nonces {
  private next: number | undefined;
  private free: number[] = [];
  private sync: Promise<void> | undefined;
  private read: () => Promise<number>;
  constructor(read: () => Promise<number>) { this.read = read; }
  async take(): Promise<number> {
    while (this.next === undefined)
      await (this.sync ??= this.read().then((n) => { this.next = n; this.free = []; }).finally(() => { this.sync = undefined; }));
    return this.free.length ? this.free.shift()! : this.next++;
  }
  release(n: number) {
    if (this.next === undefined || n >= this.next || this.free.includes(n)) return;
    this.free.push(n);
    this.free.sort((a, b) => a - b);
  }
  resync() { this.next = undefined; this.free = []; }
}

export type TxStatus = { kind: string; status: 'pending' | 'confirmed' | 'failed'; block?: number; error?: string; at: number };
export type Sent = { kind: string; hash: Hex; gas: bigint; receipt: TransactionReceipt | null; error: string | null };
export type Sim = { ok: true; accessList: AccessList; gasUsed: bigint } | { ok: false; error: string };

export const errMsg = (e: unknown) => String((e as { details?: string })?.details ?? (e as Error)?.message ?? e).slice(0, 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * @param send   RPC for nonces, simulations and eth_sendRawTransactionSync (SPEC-MONAD §1: monadinfra for these)
 * @param onDone every outcome, once (service_tx rows, stats)
 */
export function makeSender(o: { account: LocalAccount; chainId: number; to: Address; send: Client;
  txs: Map<Hex, TxStatus>; log: (cls: string, msg: string) => void; onDone: (s: Sent) => void }) {
  const { account, to, send } = o, from = account.address;
  const nonces = new Nonces(() => getTransactionCount(send, { address: from, blockTag: 'latest' }));

  /** eth_createAccessList is the simulation (one call, and it yields the access list). On a revert, eth_call names it.
   *  `cap` is the gas the simulation may use; the caller picks the real limit from the result. */
  async function simulate(data: Hex, cap: bigint): Promise<Sim> {
    const req = { account: from, to, data, gas: cap, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: TIP };
    try {
      const r = await createAccessList(send, req);
      if (r.gasUsed > cap) return { ok: false, error: `gas ${r.gasUsed} over ${cap}` };
      return { ok: true, accessList: r.accessList, gasUsed: r.gasUsed };
    } catch (e) {
      const name = errorName(e) ?? await call(send, req).then(() => null, (e2) => errorName(e2) ?? errMsg(e2));
      return { ok: false, error: name ?? errMsg(e) };
    }
  }

  /** Receipt at Proposed via eth_sendRawTransactionSync. Polls for it (30 s) on the sync timeout (code 4), on a copy
   *  already in the pool, on a node without the method, and when no answer came back at all (it may be in the pool).
   *  Throws only when the node answered with a refusal. */
  async function land(raw: Hex, hash: Hex): Promise<TransactionReceipt | null> {
    try {
      const r = await send.request({ method: 'eth_sendRawTransactionSync' as never, params: [raw, 2000] as never });
      if (r) return formatTransactionReceipt(r as never);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code === -32601) await send.request({ method: 'eth_sendRawTransaction', params: [raw] });
      else if (typeof code === 'number' && code !== 4 && !/already known|known transaction/i.test(errMsg(e))) throw e;
    }
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const r = await getTransactionReceipt(send, { hash }).catch(() => null);
      if (r) return r;
    }
    return null;
  }

  /** Signs and sends in the background. Returns the hash at once and `landed`, which resolves with the outcome (never
   *  rejects). Status in o.txs; every outcome also goes to onDone. */
  async function submit(kind: string, data: Hex, gas: bigint, accessList: AccessList = []): Promise<{ hash: Hex; landed: Promise<Sent> }> {
    const nonce = await nonces.take();
    let raw: Hex;
    try {
      raw = await account.signTransaction({ chainId: o.chainId, type: 'eip1559', to, data, gas, nonce, value: 0n,
        maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: TIP, accessList });
    } catch (e) { nonces.release(nonce); throw e; }
    const hash = keccak256(raw), st: TxStatus = { kind, status: 'pending', at: Date.now() };
    o.txs.set(hash, st);
    const landed = land(raw, hash).then((receipt): Sent => {
      st.status = receipt?.status === 'success' ? 'confirmed' : 'failed';
      if (receipt) st.block = Number(receipt.blockNumber);
      if (!receipt) { st.error = 'not mined after 30 s'; nonces.resync(); }   // maybe dropped: the chain's count refills the gap
      else if (receipt.status === 'reverted') st.error = 'reverted';
      return { kind, hash, gas, receipt, error: st.error ?? null };
    }, (e): Sent => {
      const msg = errMsg(e);
      // the node refused it: the nonce is free again, unless the refusal was about the nonce itself
      if (/nonce/i.test(msg)) nonces.resync(); else nonces.release(nonce);
      st.status = 'failed'; st.error = msg;
      o.log(`send-${kind}`, `${hash} refused: ${msg}`);
      return { kind, hash, gas, receipt: null, error: msg };
    }).then((s) => { try { o.onDone(s); } catch (e) { o.log('send-done', errMsg(e)); } return s; });
    return { hash, landed };
  }

  return { address: from, client: send, nonces, simulate, submit };
}
export type Sender = ReturnType<typeof makeSender>;

/** The tightest limit among `limits` (GAS.md, measured + 10 %) that covers the simulated gas with 5 % to spare, or null. */
export const pickLimit = (gasUsed: bigint, limits: readonly bigint[]) => limits.find((l) => l * 100n >= gasUsed * 105n) ?? null;
