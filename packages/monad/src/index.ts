// Hexit Monad client (docs/monad/DECISIONS.md; the contract surface is contracts/README.md): chain, ABIs, deployment
// record, EIP-712 typed data and signing, calldata, events, error names, timing constants and gas limits.
// No node: imports, so it runs in Node 22 and bundles for the browser as is.
import {
  BaseError, ContractFunctionRevertedError, decodeErrorResult, defineChain, encodeAbiParameters, encodeFunctionData, encodePacked,
  getAddress, isAddressEqual, keccak256, parseEventLogs, parseSignature,
  type Address, type Hex, type LocalAccount, type Log,
} from 'viem';
import { monadTestnet as viemMonadTestnet } from 'viem/chains';
import { hexitGameAbi } from './abi/HexitGame.js';
import { legacyGameEvents } from './abi/HexitGameLegacy.js';
import { testUsdcAbi } from './abi/TestUSDC.js';

export { hexitGameAbi, legacyGameEvents, testUsdcAbi };

// ------------------------------------------------------------------ chain (SPEC-MONAD §1)

export const EXPLORER = 'https://testnet.monadvision.com';

/** viem's monadTestnet, corrected: 300 ms blocks, MonadVision, a WS URL, and no Multicall3 blockCreated (it predates the reset). */
export const monadTestnet = defineChain({
  ...viemMonadTestnet,
  blockTime: 300,
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'], webSocket: ['wss://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: EXPLORER } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export const txUrl = (hash: Hex) => `${EXPLORER}/tx/${hash}`;

// ------------------------------------------------------------------ timing and outcomes (contracts/src/HexGeo.sol)

export const COL_MS = 5000;
/** First ms of column k's hex span (`5000k − 834`). A bet needs `tLo(k) ≥ max(refTsMs, now) + 5100 + lockMarginMs`. */
export const tLo = (k: number) => COL_MS * k - 834;
/** Last ms of column k's hex span (`5000k + 5834`). The tape runs to the first tick at or after it. */
export const tHi = (k: number) => COL_MS * k + 5834;
/** `BetSettled.outcome`. */
export const OUTCOME = { WIN: 1, LOSS: 2, VOID: 3 } as const;

// ------------------------------------------------------------------ gas limits (contracts/GAS.md)

/**
 * Measured gasUsed × 1.10 on a local `anvil --network monad` (contracts/GAS.md, markets build: the higher of BTC and
 * MON). Monad charges the limit, and a revert pays all of it. Re-measure on testnet (`eth_simulateV1`) before fixing
 * them, the access-list figures above all. Bet figures are per (asset, k) column.
 */
export const GAS = {
  /** A column's first bet: the one fixed limit that covers every bet. */
  placeBetFor: 176_930n,
  /** The column already has a bet; first bet in this liability word (8 bands from bJ0). */
  placeBetForOpenColumn: 157_480n,
  /** The column and the liability word already have bets. */
  placeBetForWarm: 138_780n,
  placeBetForWarmAccessList: 106_117n,
  /** settleColumn, 1 bet, with an access list. Without one, use settleColumnGas. */
  settleColumnAccessList: 449_363n,
  grant: 468_832n,
  withdrawFor: 162_839n,
  depositFor: 229_072n,
} as const;

/** settleColumn limit (contracts/GAS.md): 1.1 × (438,000 + 19,750 per player, + 135,000 for a volatile tape). */
export const settleColumnGas = (players: number, volatile = false) =>
  BigInt(Math.ceil(1.1 * (438_000 + 19_750 * players + (volatile ? 135_000 : 0))));

// ------------------------------------------------------------------ deployment/monad.json (contracts/README.md)

const ROLES = ['admin', 'guardian', 'recorder', 'quoter', 'keeper', 'relayer'] as const;

export interface Deployment {
  chainId: number;
  rpc: { http: string; ws: string };
  game: Address;
  gameImpl: Address;
  usdc: Address;
  usdcImpl: Address;
  roles: Record<(typeof ROLES)[number], Address>;
  /** A lower bound for indexer backfill. */
  deployBlock: number;
  /** Amounts are decimal strings of micro-tUSDC; the *Ms fields and maxOpen are numbers. */
  params: {
    minStake: string; maxStake: string; maxPayout: string; maxHexLiab: string; maxColLiab: string;
    maxMarketLiab: string; dailyLossLimit: string; maxMoveE8: string; grant: string;
    voidAfterMs: number; gapMs: number; quoteMaxAgeMs: number; lockMarginMs: number; maxOpen: number;
  };
  /** The markets by asset id, read from the chain when the record was written. Live values: HexitGame.markets(asset). */
  markets?: Record<string, { rowE8: string; maxMoveE8: string; maxLiab: string; enabled: boolean }>;
  broadcast: string;
  buildInfo: string;
}

/** Types the parsed JSON of deployment/monad.json. Throws on a bad chain id or address; returns addresses checksummed. */
export function parseDeployment(json: unknown): Deployment {
  const d = json as Deployment;
  if (!Number.isSafeInteger(d?.chainId) || !Number.isSafeInteger(d.deployBlock)) throw new Error('deployment: bad chainId or deployBlock');
  const roles = Object.fromEntries(ROLES.map((r) => [r, getAddress(d.roles?.[r])])) as Deployment['roles'];
  return { ...d, game: getAddress(d.game), gameImpl: getAddress(d.gameImpl), usdc: getAddress(d.usdc), usdcImpl: getAddress(d.usdcImpl), roles };
}

// ------------------------------------------------------------------ EIP-712 (contracts/README.md, exact)

/** Same as contracts/README.md. deadline is unix seconds; refTsMs, expiresMs and tick timestamps are unix ms. asset is
 *  the market id (SOL 0, BTC 1, ETH 2, MON 3; markets upgrade); a Quote also signs its market's band height (rowE8). */
export const EIP712_TYPES = {
  Bet: [
    { name: 'player', type: 'address' }, { name: 'asset', type: 'uint8' }, { name: 'k', type: 'uint32' },
    { name: 'j', type: 'int32' }, { name: 'stake', type: 'uint64' }, { name: 'minMult', type: 'uint16' },
    { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
  ],
  Quote: [
    { name: 'asset', type: 'uint8' }, { name: 'rowE8', type: 'int64' }, { name: 'k', type: 'uint32' }, { name: 'qJ0', type: 'int32' },
    { name: 'refTsMs', type: 'uint64' }, { name: 'refPriceE8', type: 'uint64' }, { name: 'expiresMs', type: 'uint64' },
    { name: 'multsHash', type: 'bytes32' },
  ],
  ColumnTape: [{ name: 'asset', type: 'uint8' }, { name: 'k', type: 'uint32' }, { name: 'ticksHash', type: 'bytes32' }],
  Withdraw: [
    { name: 'player', type: 'address' }, { name: 'amount', type: 'uint64' }, { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
  Deposit: [
    { name: 'player', type: 'address' }, { name: 'amount', type: 'uint64' }, { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface Bet { player: Address; asset: number; k: number; j: number; stake: bigint; minMult: number; nonce: bigint; deadline: bigint }
/** The calldata Quote: no multsHash (the contract hashes the 64 mults passed next to it). rowE8: the band height it was
 *  priced at, which must equal markets(asset).rowE8 when the bet lands (else QuoteStale). */
export interface Quote { asset: number; rowE8: bigint; k: number; qJ0: number; refTsMs: bigint; refPriceE8: bigint; expiresMs: bigint }
export interface Withdraw { player: Address; amount: bigint; nonce: bigint; deadline: bigint }
export type Deposit = Withdraw;
/** mults[i] = multiplier × 100 for band qJ0 + i; 0–100 = not offered. Exactly 64. */
export type Mults = readonly number[];

export const gameDomain = (game: Address, chainId: number = monadTestnet.id) =>
  ({ name: 'Hexit', version: '1', chainId, verifyingContract: game }) as const;
export const usdcDomain = (usdc: Address, chainId: number = monadTestnet.id) =>
  ({ name: 'Hexit Test USDC', version: '1', chainId, verifyingContract: usdc }) as const;
type Domain = ReturnType<typeof gameDomain>;

/** keccak256(abi.encodePacked(uint16[64])) = keccak256(abi.encode(uint16[64])). Throws unless 64 values in uint16 range. */
export const multsHash = (mults: Mults): Hex => keccak256(encodeAbiParameters([{ type: 'uint16[64]' }], [mults as never]));

/** keccak256(abi.encodePacked(uint64 ts0, uint64 px0, uint64 ts1, ...)): 16 bytes per tick, not the padded uint64[]. */
export function ticksHash(ts: readonly bigint[], px: readonly bigint[]): Hex {
  if (ts.length !== px.length) throw new Error('ticks: ts and px differ in length');
  return keccak256(encodePacked(ts.flatMap(() => ['uint64', 'uint64']), ts.flatMap((t, i) => [t, px[i]])));
}

// Each builder returns { domain, types, primaryType, message } for signTypedData / hashTypedData / recoverTypedDataAddress.
export const betTypedData = (domain: Domain, message: Bet) =>
  ({ domain, types: { Bet: EIP712_TYPES.Bet }, primaryType: 'Bet', message }) as const;
export const quoteTypedData = (domain: Domain, q: Quote, mults: Mults) =>
  ({ domain, types: { Quote: EIP712_TYPES.Quote }, primaryType: 'Quote', message: { ...q, multsHash: multsHash(mults) } }) as const;
/** The recorder's signature over column (asset, k)'s tape: every grid tick from the last at/before tLo(k) to the first
 *  at/after tHi(k). */
export const tapeTypedData = (domain: Domain, asset: number, k: number, ts: readonly bigint[], px: readonly bigint[]) =>
  ({ domain, types: { ColumnTape: EIP712_TYPES.ColumnTape }, primaryType: 'ColumnTape', message: { asset, k, ticksHash: ticksHash(ts, px) } }) as const;
export const withdrawTypedData = (domain: Domain, message: Withdraw) =>
  ({ domain, types: { Withdraw: EIP712_TYPES.Withdraw }, primaryType: 'Withdraw', message }) as const;
export const depositTypedData = (domain: Domain, message: Deposit) =>
  ({ domain, types: { Deposit: EIP712_TYPES.Deposit }, primaryType: 'Deposit', message }) as const;
/** tUSDC EIP-2612 permit (usdcDomain). nonce = TestUSDC.nonces(owner). */
export const permitTypedData = (domain: ReturnType<typeof usdcDomain>,
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint }) =>
  ({ domain, types: PERMIT_TYPES, primaryType: 'Permit', message }) as const;

// ------------------------------------------------------------------ signing (any viem LocalAccount)

type Signer = Pick<LocalAccount, 'signTypedData'>;
export const signBet = (a: Signer, d: Domain, bet: Bet) => a.signTypedData(betTypedData(d, bet));
export const signQuote = (a: Signer, d: Domain, q: Quote, mults: Mults) => a.signTypedData(quoteTypedData(d, q, mults));
export const signTape = (a: Signer, d: Domain, asset: number, k: number, ts: readonly bigint[], px: readonly bigint[]) =>
  a.signTypedData(tapeTypedData(d, asset, k, ts, px));
export const signWithdraw = (a: Signer, d: Domain, w: Withdraw) => a.signTypedData(withdrawTypedData(d, w));

export interface DepositSigs { sig: Hex; v: number; r: Hex; s: Hex }
/**
 * Both signatures depositFor needs: the Deposit (game domain) and the tUSDC permit with spender = game, value = amount
 * and the Deposit's deadline. permitNonce = TestUSDC.nonces(player).
 */
export async function signDeposit(a: Signer, game: Domain, usdc: ReturnType<typeof usdcDomain>, dep: Deposit, permitNonce: bigint): Promise<DepositSigs> {
  const sig = await a.signTypedData(depositTypedData(game, dep));
  const permit = parseSignature(await a.signTypedData(permitTypedData(usdc,
    { owner: dep.player, spender: game.verifyingContract, value: dep.amount, nonce: permitNonce, deadline: dep.deadline })));
  return { sig, v: 27 + permit.yParity, r: permit.r, s: permit.s };
}

// ------------------------------------------------------------------ calldata (for locally signed raw transactions)
// grant, settleColumn and voidColumn take plain positional args: encodeFunctionData({ abi: hexitGameAbi, ... }).

export const placeBetForData = (bet: Bet, sig: Hex, q: Quote, mults: Mults, quoterSig: Hex) =>
  encodeFunctionData({ abi: hexitGameAbi, functionName: 'placeBetFor', args: [bet, sig, q, mults as never, quoterSig] });
export const withdrawForData = (w: Withdraw, sig: Hex) =>
  encodeFunctionData({ abi: hexitGameAbi, functionName: 'withdrawFor', args: [w.player, w.amount, w.nonce, w.deadline, sig] });
export const depositForData = (dep: Deposit, s: DepositSigs) =>
  encodeFunctionData({ abi: hexitGameAbi, functionName: 'depositFor', args: [dep.player, dep.amount, dep.nonce, dep.deadline, s.sig, s.v, s.r, s.s] });

// ------------------------------------------------------------------ events and errors

const LOG_ABI = [...hexitGameAbi, ...legacyGameEvents] as unknown as typeof hexitGameAbi;

/**
 * Decodes every HexitGame event among `logs` emitted by `game` (other addresses and unknown topics are skipped). The
 * five bet and column events from before the markets upgrade (other topic0s, no asset) decode too, with asset 0 (SOL),
 * so a range that spans the upgrade needs no upgrade block.
 */
export function decodeGameLogs<L extends Log>(logs: readonly L[], game: Address) {
  const out = parseEventLogs({ abi: LOG_ABI, logs: logs.filter((l) => isAddressEqual(l.address, game)) });
  for (const { args } of out) { const a = args as { k?: number; asset?: number }; if (a.k !== undefined) a.asset ??= 0; }
  return out;
}

export type HexitErrorName = Extract<(typeof hexitGameAbi)[number], { type: 'error' }>['name'];

// tUSDC errors too: depositFor bubbles TestUSDC's revert (e.g. ERC20InsufficientAllowance after a bad permit).
const ERRORS = [...hexitGameAbi, ...testUsdcAbi].filter((x) => x.type === 'error');

/**
 * The custom-error name of a revert: from a viem error (simulate, call, write, estimateGas) or raw revert data.
 * undefined when there is no decodable revert data (e.g. a network error).
 */
export function errorName(e: unknown): string | undefined {
  let data: unknown = e;
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    data = r ? r.raw : (e.walk((x) => typeof (x as { data?: unknown }).data === 'string') as { data?: unknown } | null)?.data;
  }
  if (typeof data !== 'string' || !data.startsWith('0x')) return undefined;
  try { return decodeErrorResult({ abi: ERRORS, data: data as Hex }).errorName; } catch { return undefined; }
}
