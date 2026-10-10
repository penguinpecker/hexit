export declare const COL_MS = 5000, TICK_MS = 100, HEX_R_S: number, LOCK_S = 5.1;
export declare const EDGE = 0.08, CAP_X100 = 10000, MIN_OFFER_X100 = 101;
export declare const MIX: ReadonlyArray<readonly [kappa: number, weight: number]>;
export declare const SIG_STEP = 0.06, NPH = 2, DXF = 4;
export declare const BOARD_COLS = 18, QUOTE_BANDS = 64, LOCK_MARGIN_MS = 500;
export declare function Phi(x: number): number;
export declare function hexHits(a0: number, b0: number, a1: number, b1: number): boolean;
export interface HexU {
    x: Float64Array;
    u: Float64Array;
    dx: number;
}
export declare function hexU(sig: number, nph: number, dxf: number): HexU;
export interface HexTable {
    sig: number;
    edges: Float64Array;
    w: Float64Array;
    cw: number;
}
export declare function compact(r: HexU, sig: number): HexTable;
export declare function buildTable(sigBands: number, nph?: number, dxf?: number): HexTable;
export declare const sigKey: (sig: number) => number;
export declare const keySig: (key: number) => number;
export declare class TableCache {
    readonly tables: Map<number, HexTable>;
    get(sig: number): HexTable;
}
export declare function hexP(t: HexTable, sigUsed: number, d: number, leadS: number): number;
export declare function mixtureP(cache: TableCache, sigB: number, d: number, leadS: number): number;
export declare const round3Down: (v: number) => number;
export declare function multX100(P: number, edge?: number): number;
export interface VolState {
    vFast: number;
    vSlow: number;
    vNow: number;
    sigBase: number;
}
export declare function volInit(price: number, volAnn: number): VolState;
export declare function volStep(s: VolState, dP: number): VolState;
export declare const sigmaUsd: (s: VolState) => number;
export declare const volHot: (s: VolState) => boolean;
export declare const firstOpenColumn: (nowMs: number, marginMs?: number) => number;
export interface QuoteCol {
    k: number;
    qJ0: number;
    sigBucket: number;
    mults: Uint16Array;
}
export declare function quoteColumn(a: {
    k: number;
    nowMs: number;
    priceE8: bigint;
    rowE8: bigint;
    sigBands: number;
    cache: TableCache;
    centreBand?: number;
}): QuoteCol;
export declare function quoteBoard(a: {
    nowMs: number;
    priceE8: bigint;
    rowE8: bigint;
    vol: VolState;
    cache: TableCache;
    centreBand?: number;
    marginMs?: number;
}): QuoteCol[];
export declare function hexCentreInt(k: bigint, j: bigint, row: bigint): [tc: bigint, pc2: bigint];
export declare function segHitsInt(T0: bigint, P0: bigint, T1: bigint, P1: bigint, k: bigint, j: bigint, row: bigint): boolean;
export type Outcome = 'WIN' | 'LOSS' | 'VOID' | 'PENDING';
export declare class ColumnSim {
    readonly k: bigint;
    readonly row: bigint;
    readonly bJ0: number;
    readonly gapMs: bigint;
    readonly tLo: bigint;
    readonly tHi: bigint;
    chainTs: bigint;
    gap: boolean;
    readonly touched: Uint8Array<ArrayBuffer>;
    constructor(k: bigint, row: bigint, bJ0: number, gapMs: number);
    apply(T0: bigint, P0: bigint, T1: bigint, P1: bigint): void;
    outcome(j: number, marketLastTs: bigint): Outcome;
}
