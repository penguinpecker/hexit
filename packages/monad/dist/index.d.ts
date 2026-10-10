import { type Address, type Hex, type LocalAccount, type Log } from 'viem';
import { hexitGameAbi } from './abi/HexitGame.js';
import { legacyGameEvents } from './abi/HexitGameLegacy.js';
import { testUsdcAbi } from './abi/TestUSDC.js';
export { hexitGameAbi, legacyGameEvents, testUsdcAbi };
export declare const EXPLORER = "https://testnet.monadvision.com";
/** viem's monadTestnet, corrected: 300 ms blocks, MonadVision, a WS URL, and no Multicall3 blockCreated (it predates the reset). */
export declare const monadTestnet: {
    blockExplorers: {
        readonly default: {
            readonly name: "MonadVision";
            readonly url: "https://testnet.monadvision.com";
        };
    };
    blockTime: 300;
    contracts: {
        readonly multicall3: {
            readonly address: "0xcA11bde05977b3631167028862bE2a173976CA11";
        };
    };
    ensTlds?: readonly string[] | undefined;
    id: 10143;
    name: "Monad Testnet";
    nativeCurrency: {
        readonly name: "Testnet MON Token";
        readonly symbol: "MON";
        readonly decimals: 18;
    };
    experimental_preconfirmationTime?: number | undefined;
    rpcUrls: {
        readonly default: {
            readonly http: readonly ["https://testnet-rpc.monad.xyz"];
            readonly webSocket: readonly ["wss://testnet-rpc.monad.xyz"];
        };
    };
    sourceId?: number | undefined;
    supportsTransactionReplacementDetection?: boolean | undefined;
    testnet: true;
    custom?: Record<string, unknown> | undefined;
    extendSchema?: Record<string, unknown> | undefined;
    fees?: import("viem").ChainFees<undefined> | undefined;
    prepareTransactionRequest?: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "afterFillParameters" | "beforeFillParameters" | "beforeFillTransaction";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | [fn: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "afterFillParameters" | "beforeFillParameters" | "beforeFillTransaction";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | undefined, options: {
        runAt: readonly ("afterFillParameters" | "beforeFillParameters" | "beforeFillTransaction")[];
    }] | undefined;
    serializers?: import("viem").ChainSerializers<undefined, import("viem").TransactionSerializable<bigint, number>> | undefined;
    verifyHash?: ((client: import("viem").Client, parameters: import("viem").VerifyHashActionParameters) => Promise<import("viem").VerifyHashActionReturnType>) | undefined;
    readonly formatters?: undefined;
};
export declare const txUrl: (hash: Hex) => string;
export declare const COL_MS = 5000;
/** First ms of column k's hex span (`5000k − 834`). A bet needs `tLo(k) ≥ max(refTsMs, now) + 5100 + lockMarginMs`. */
export declare const tLo: (k: number) => number;
/** Last ms of column k's hex span (`5000k + 5834`). The tape runs to the first tick at or after it. */
export declare const tHi: (k: number) => number;
/** `BetSettled.outcome`. */
export declare const OUTCOME: {
    readonly WIN: 1;
    readonly LOSS: 2;
    readonly VOID: 3;
};
/**
 * Measured gasUsed × 1.10 on a local `anvil --network monad` (contracts/GAS.md, markets build: the higher of BTC and
 * MON). Monad charges the limit, and a revert pays all of it. Re-measure on testnet (`eth_simulateV1`) before fixing
 * them, the access-list figures above all. Bet figures are per (asset, k) column.
 */
export declare const GAS: {
    /** A column's first bet: the one fixed limit that covers every bet. */
    readonly placeBetFor: 176930n;
    /** The column already has a bet; first bet in this liability word (8 bands from bJ0). */
    readonly placeBetForOpenColumn: 157480n;
    /** The column and the liability word already have bets. */
    readonly placeBetForWarm: 138780n;
    readonly placeBetForWarmAccessList: 106117n;
    /** settleColumn, 1 bet, with an access list. Without one, use settleColumnGas. */
    readonly settleColumnAccessList: 449363n;
    readonly grant: 468832n;
    readonly withdrawFor: 162839n;
    readonly depositFor: 229072n;
};
/** settleColumn limit (contracts/GAS.md): 1.1 × (438,000 + 19,750 per player, + 135,000 for a volatile tape). */
export declare const settleColumnGas: (players: number, volatile?: boolean) => bigint;
declare const ROLES: readonly ['admin', 'guardian', 'recorder', 'quoter', 'keeper', 'relayer'];
export interface Deployment {
    chainId: number;
    rpc: {
        http: string;
        ws: string;
    };
    game: Address;
    gameImpl: Address;
    usdc: Address;
    usdcImpl: Address;
    roles: Record<(typeof ROLES)[number], Address>;
    /** A lower bound for indexer backfill. */
    deployBlock: number;
    /** Amounts are decimal strings of micro-tUSDC; the *Ms fields and maxOpen are numbers. */
    params: {
        minStake: string;
        maxStake: string;
        maxPayout: string;
        maxHexLiab: string;
        maxColLiab: string;
        maxMarketLiab: string;
        dailyLossLimit: string;
        maxMoveE8: string;
        grant: string;
        voidAfterMs: number;
        gapMs: number;
        quoteMaxAgeMs: number;
        lockMarginMs: number;
        maxOpen: number;
    };
    /** The markets by asset id, read from the chain when the record was written. Live values: HexitGame.markets(asset). */
    markets?: Record<string, {
        rowE8: string;
        maxMoveE8: string;
        maxLiab: string;
        enabled: boolean;
    }>;
    broadcast: string;
    buildInfo: string;
}
/** Types the parsed JSON of deployment/monad.json. Throws on a bad chain id or address; returns addresses checksummed. */
export declare function parseDeployment(json: unknown): Deployment;
/** Same as contracts/README.md. deadline is unix seconds; refTsMs, expiresMs and tick timestamps are unix ms. asset is
 *  the market id (SOL 0, BTC 1, ETH 2, MON 3; markets upgrade); a Quote also signs its market's band height (rowE8). */
export declare const EIP712_TYPES: {
    readonly Bet: readonly [{
        readonly name: 'player';
        readonly type: 'address';
    }, {
        readonly name: 'asset';
        readonly type: 'uint8';
    }, {
        readonly name: 'k';
        readonly type: 'uint32';
    }, {
        readonly name: 'j';
        readonly type: 'int32';
    }, {
        readonly name: 'stake';
        readonly type: 'uint64';
    }, {
        readonly name: 'minMult';
        readonly type: 'uint16';
    }, {
        readonly name: 'nonce';
        readonly type: 'uint64';
    }, {
        readonly name: 'deadline';
        readonly type: 'uint64';
    }];
    readonly Quote: readonly [{
        readonly name: 'asset';
        readonly type: 'uint8';
    }, {
        readonly name: 'rowE8';
        readonly type: 'int64';
    }, {
        readonly name: 'k';
        readonly type: 'uint32';
    }, {
        readonly name: 'qJ0';
        readonly type: 'int32';
    }, {
        readonly name: 'refTsMs';
        readonly type: 'uint64';
    }, {
        readonly name: 'refPriceE8';
        readonly type: 'uint64';
    }, {
        readonly name: 'expiresMs';
        readonly type: 'uint64';
    }, {
        readonly name: 'multsHash';
        readonly type: 'bytes32';
    }];
    readonly ColumnTape: readonly [{
        readonly name: 'asset';
        readonly type: 'uint8';
    }, {
        readonly name: 'k';
        readonly type: 'uint32';
    }, {
        readonly name: 'ticksHash';
        readonly type: 'bytes32';
    }];
    readonly Withdraw: readonly [{
        readonly name: 'player';
        readonly type: 'address';
    }, {
        readonly name: 'amount';
        readonly type: 'uint64';
    }, {
        readonly name: 'nonce';
        readonly type: 'uint64';
    }, {
        readonly name: 'deadline';
        readonly type: 'uint64';
    }];
    readonly Deposit: readonly [{
        readonly name: 'player';
        readonly type: 'address';
    }, {
        readonly name: 'amount';
        readonly type: 'uint64';
    }, {
        readonly name: 'nonce';
        readonly type: 'uint64';
    }, {
        readonly name: 'deadline';
        readonly type: 'uint64';
    }];
};
export interface Bet {
    player: Address;
    asset: number;
    k: number;
    j: number;
    stake: bigint;
    minMult: number;
    nonce: bigint;
    deadline: bigint;
}
/** The calldata Quote: no multsHash (the contract hashes the 64 mults passed next to it). rowE8: the band height it was
 *  priced at, which must equal markets(asset).rowE8 when the bet lands (else QuoteStale). */
export interface Quote {
    asset: number;
    rowE8: bigint;
    k: number;
    qJ0: number;
    refTsMs: bigint;
    refPriceE8: bigint;
    expiresMs: bigint;
}
export interface Withdraw {
    player: Address;
    amount: bigint;
    nonce: bigint;
    deadline: bigint;
}
export type Deposit = Withdraw;
/** mults[i] = multiplier × 100 for band qJ0 + i; 0–100 = not offered. Exactly 64. */
export type Mults = readonly number[];
export declare const gameDomain: (game: Address, chainId?: number) => {
    readonly name: 'Hexit';
    readonly version: '1';
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
};
export declare const usdcDomain: (usdc: Address, chainId?: number) => {
    readonly name: 'Hexit Test USDC';
    readonly version: '1';
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
};
type Domain = ReturnType<typeof gameDomain>;
/** keccak256(abi.encodePacked(uint16[64])) = keccak256(abi.encode(uint16[64])). Throws unless 64 values in uint16 range. */
export declare const multsHash: (mults: Mults) => Hex;
/** keccak256(abi.encodePacked(uint64 ts0, uint64 px0, uint64 ts1, ...)): 16 bytes per tick, not the padded uint64[]. */
export declare function ticksHash(ts: readonly bigint[], px: readonly bigint[]): Hex;
export declare const betTypedData: (domain: Domain, message: Bet) => {
    readonly domain: {
        readonly name: 'Hexit';
        readonly version: '1';
        readonly chainId: number;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly Bet: readonly [{
            readonly name: 'player';
            readonly type: 'address';
        }, {
            readonly name: 'asset';
            readonly type: 'uint8';
        }, {
            readonly name: 'k';
            readonly type: 'uint32';
        }, {
            readonly name: 'j';
            readonly type: 'int32';
        }, {
            readonly name: 'stake';
            readonly type: 'uint64';
        }, {
            readonly name: 'minMult';
            readonly type: 'uint16';
        }, {
            readonly name: 'nonce';
            readonly type: 'uint64';
        }, {
            readonly name: 'deadline';
            readonly type: 'uint64';
        }];
    };
    readonly primaryType: 'Bet';
    readonly message: Bet;
};
export declare const quoteTypedData: (domain: Domain, q: Quote, mults: Mults) => {
    readonly domain: {
        readonly name: 'Hexit';
        readonly version: '1';
        readonly chainId: number;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly Quote: readonly [{
            readonly name: 'asset';
            readonly type: 'uint8';
        }, {
            readonly name: 'rowE8';
            readonly type: 'int64';
        }, {
            readonly name: 'k';
            readonly type: 'uint32';
        }, {
            readonly name: 'qJ0';
            readonly type: 'int32';
        }, {
            readonly name: 'refTsMs';
            readonly type: 'uint64';
        }, {
            readonly name: 'refPriceE8';
            readonly type: 'uint64';
        }, {
            readonly name: 'expiresMs';
            readonly type: 'uint64';
        }, {
            readonly name: 'multsHash';
            readonly type: 'bytes32';
        }];
    };
    readonly primaryType: 'Quote';
    readonly message: {
        readonly asset: number;
        readonly rowE8: bigint;
        readonly k: number;
        readonly qJ0: number;
        readonly refTsMs: bigint;
        readonly refPriceE8: bigint;
        readonly expiresMs: bigint;
        readonly multsHash: `0x${string}`;
    };
};
/** The recorder's signature over column (asset, k)'s tape: every grid tick from the last at/before tLo(k) to the first
 *  at/after tHi(k). */
export declare const tapeTypedData: (domain: Domain, asset: number, k: number, ts: readonly bigint[], px: readonly bigint[]) => {
    readonly domain: {
        readonly name: 'Hexit';
        readonly version: '1';
        readonly chainId: number;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly ColumnTape: readonly [{
            readonly name: 'asset';
            readonly type: 'uint8';
        }, {
            readonly name: 'k';
            readonly type: 'uint32';
        }, {
            readonly name: 'ticksHash';
            readonly type: 'bytes32';
        }];
    };
    readonly primaryType: 'ColumnTape';
    readonly message: {
        readonly asset: number;
        readonly k: number;
        readonly ticksHash: `0x${string}`;
    };
};
export declare const withdrawTypedData: (domain: Domain, message: Withdraw) => {
    readonly domain: {
        readonly name: 'Hexit';
        readonly version: '1';
        readonly chainId: number;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly Withdraw: readonly [{
            readonly name: 'player';
            readonly type: 'address';
        }, {
            readonly name: 'amount';
            readonly type: 'uint64';
        }, {
            readonly name: 'nonce';
            readonly type: 'uint64';
        }, {
            readonly name: 'deadline';
            readonly type: 'uint64';
        }];
    };
    readonly primaryType: 'Withdraw';
    readonly message: Withdraw;
};
export declare const depositTypedData: (domain: Domain, message: Deposit) => {
    readonly domain: {
        readonly name: 'Hexit';
        readonly version: '1';
        readonly chainId: number;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly Deposit: readonly [{
            readonly name: 'player';
            readonly type: 'address';
        }, {
            readonly name: 'amount';
            readonly type: 'uint64';
        }, {
            readonly name: 'nonce';
            readonly type: 'uint64';
        }, {
            readonly name: 'deadline';
            readonly type: 'uint64';
        }];
    };
    readonly primaryType: 'Deposit';
    readonly message: Withdraw;
};
/** tUSDC EIP-2612 permit (usdcDomain). nonce = TestUSDC.nonces(owner). */
export declare const permitTypedData: (domain: ReturnType<typeof usdcDomain>, message: {
    owner: Address;
    spender: Address;
    value: bigint;
    nonce: bigint;
    deadline: bigint;
}) => {
    readonly domain: {
        readonly name: 'Hexit Test USDC';
        readonly version: '1';
        readonly chainId: number;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly Permit: readonly [{
            readonly name: 'owner';
            readonly type: 'address';
        }, {
            readonly name: 'spender';
            readonly type: 'address';
        }, {
            readonly name: 'value';
            readonly type: 'uint256';
        }, {
            readonly name: 'nonce';
            readonly type: 'uint256';
        }, {
            readonly name: 'deadline';
            readonly type: 'uint256';
        }];
    };
    readonly primaryType: 'Permit';
    readonly message: {
        owner: Address;
        spender: Address;
        value: bigint;
        nonce: bigint;
        deadline: bigint;
    };
};
type Signer = Pick<LocalAccount, 'signTypedData'>;
export declare const signBet: (a: Signer, d: Domain, bet: Bet) => Promise<`0x${string}`>;
export declare const signQuote: (a: Signer, d: Domain, q: Quote, mults: Mults) => Promise<`0x${string}`>;
export declare const signTape: (a: Signer, d: Domain, asset: number, k: number, ts: readonly bigint[], px: readonly bigint[]) => Promise<`0x${string}`>;
export declare const signWithdraw: (a: Signer, d: Domain, w: Withdraw) => Promise<`0x${string}`>;
export interface DepositSigs {
    sig: Hex;
    v: number;
    r: Hex;
    s: Hex;
}
/**
 * Both signatures depositFor needs: the Deposit (game domain) and the tUSDC permit with spender = game, value = amount
 * and the Deposit's deadline. permitNonce = TestUSDC.nonces(player).
 */
export declare function signDeposit(a: Signer, game: Domain, usdc: ReturnType<typeof usdcDomain>, dep: Deposit, permitNonce: bigint): Promise<DepositSigs>;
export declare const placeBetForData: (bet: Bet, sig: Hex, q: Quote, mults: Mults, quoterSig: Hex) => `0x${string}`;
export declare const withdrawForData: (w: Withdraw, sig: Hex) => `0x${string}`;
export declare const depositForData: (dep: Deposit, s: DepositSigs) => `0x${string}`;
/**
 * Decodes every HexitGame event among `logs` emitted by `game` (other addresses and unknown topics are skipped). The
 * five bet and column events from before the markets upgrade (other topic0s, no asset) decode too, with asset 0 (SOL),
 * so a range that spans the upgrade needs no upgrade block.
 */
export declare function decodeGameLogs<L extends Log>(logs: readonly L[], game: Address): import("viem").ParseEventLogsReturnType<readonly [{
    readonly type: "constructor";
    readonly inputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "BET_TYPEHASH";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "DEPOSIT_TYPEHASH";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "GRANT";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "MAX_MULT";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint16";
        readonly internalType: "uint16";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "PAUSE_DEPOSIT";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "PAUSE_PLAY";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "QUOTE_TYPEHASH";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "TAPE_TYPEHASH";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "UPGRADE_INTERFACE_VERSION";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
        readonly internalType: "string";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "WITHDRAW_TYPEHASH";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "acceptOwnership";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "columnOf";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly internalType: "uint32";
    }];
    readonly outputs: readonly [{
        readonly name: "bJ0";
        readonly type: "int32";
        readonly internalType: "int32";
    }, {
        readonly name: "state";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "gap";
        readonly type: "bool";
        readonly internalType: "bool";
    }, {
        readonly name: "totalLiab";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "touched";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "day";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint32";
        readonly internalType: "uint32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "depositFor";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "nonce";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "deadline";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "sig";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }, {
        readonly name: "v";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "r";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }, {
        readonly name: "s";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "disabled";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "domainSeparator";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "getParams";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Params";
        readonly components: readonly [{
            readonly name: "recorders";
            readonly type: "address[3]";
            readonly internalType: "address[3]";
        }, {
            readonly name: "quoter";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxPayout";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "minStake";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "guardian";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxColLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxStake";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "relayer";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxMarketLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxHexLiab";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "dailyLossLimit";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxMoveE8";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "voidAfterMs";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "gapMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "quoteMaxAgeMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "lockMarginMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "maxOpen";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }];
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "grant";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "house";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "houseDeposit";
    readonly inputs: readonly [{
        readonly name: "amount";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "houseLiab";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "houseWithdraw";
    readonly inputs: readonly [{
        readonly name: "amount";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "initialize";
    readonly inputs: readonly [{
        readonly name: "owner_";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "usdc_";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "rowE8_";
        readonly type: "int64";
        readonly internalType: "int64";
    }, {
        readonly name: "p";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Params";
        readonly components: readonly [{
            readonly name: "recorders";
            readonly type: "address[3]";
            readonly internalType: "address[3]";
        }, {
            readonly name: "quoter";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxPayout";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "minStake";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "guardian";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxColLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxStake";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "relayer";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxMarketLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxHexLiab";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "dailyLossLimit";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxMoveE8";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "voidAfterMs";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "gapMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "quoteMaxAgeMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "lockMarginMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "maxOpen";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }];
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "initializeMarkets";
    readonly inputs: readonly [{
        readonly name: "assets";
        readonly type: "uint8[]";
        readonly internalType: "uint8[]";
    }, {
        readonly name: "cfgs";
        readonly type: "tuple[]";
        readonly internalType: "struct HexitGame.MarketConfig[]";
        readonly components: readonly [{
            readonly name: "rowE8";
            readonly type: "int64";
            readonly internalType: "int64";
        }, {
            readonly name: "maxMoveE8";
            readonly type: "uint56";
            readonly internalType: "uint56";
        }, {
            readonly name: "maxLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "enabled";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "markets";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "rowE8";
        readonly type: "int64";
        readonly internalType: "int64";
    }, {
        readonly name: "maxMoveE8";
        readonly type: "uint56";
        readonly internalType: "uint56";
    }, {
        readonly name: "enabled";
        readonly type: "bool";
        readonly internalType: "bool";
    }, {
        readonly name: "maxLiab";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "openLiab";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "netLossToday";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "int64";
        readonly internalType: "int64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "openLiability";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "owner";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "paused";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "pendingOwner";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "placeBet";
    readonly inputs: readonly [{
        readonly name: "b";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Bet";
        readonly components: readonly [{
            readonly name: "player";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "asset";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }, {
            readonly name: "k";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "j";
            readonly type: "int32";
            readonly internalType: "int32";
        }, {
            readonly name: "stake";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "minMult";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "nonce";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "deadline";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
    }, {
        readonly name: "q";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Quote";
        readonly components: readonly [{
            readonly name: "asset";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }, {
            readonly name: "rowE8";
            readonly type: "int64";
            readonly internalType: "int64";
        }, {
            readonly name: "k";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "qJ0";
            readonly type: "int32";
            readonly internalType: "int32";
        }, {
            readonly name: "refTsMs";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "refPriceE8";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "expiresMs";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
    }, {
        readonly name: "mults";
        readonly type: "uint16[64]";
        readonly internalType: "uint16[64]";
    }, {
        readonly name: "quoterSig";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "placeBetFor";
    readonly inputs: readonly [{
        readonly name: "b";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Bet";
        readonly components: readonly [{
            readonly name: "player";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "asset";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }, {
            readonly name: "k";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "j";
            readonly type: "int32";
            readonly internalType: "int32";
        }, {
            readonly name: "stake";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "minMult";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "nonce";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "deadline";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
    }, {
        readonly name: "sig";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }, {
        readonly name: "q";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Quote";
        readonly components: readonly [{
            readonly name: "asset";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }, {
            readonly name: "rowE8";
            readonly type: "int64";
            readonly internalType: "int64";
        }, {
            readonly name: "k";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "qJ0";
            readonly type: "int32";
            readonly internalType: "int32";
        }, {
            readonly name: "refTsMs";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "refPriceE8";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "expiresMs";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
    }, {
        readonly name: "mults";
        readonly type: "uint16[64]";
        readonly internalType: "uint16[64]";
    }, {
        readonly name: "quoterSig";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "playerOf";
    readonly inputs: readonly [{
        readonly name: "who";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "credit";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "openStake";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "nonceBase";
        readonly type: "uint48";
        readonly internalType: "uint48";
    }, {
        readonly name: "nonceMask";
        readonly type: "uint32";
        readonly internalType: "uint32";
    }, {
        readonly name: "openMask";
        readonly type: "uint32";
        readonly internalType: "uint32";
    }, {
        readonly name: "granted";
        readonly type: "bool";
        readonly internalType: "bool";
    }, {
        readonly name: "bets";
        readonly type: "uint256[16]";
        readonly internalType: "uint256[16]";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "proxiableUUID";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "renounceOwnership";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "rowE8";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "int64";
        readonly internalType: "int64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "setDisabled";
    readonly inputs: readonly [{
        readonly name: "bits";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "on";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "setMarket";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "c";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.MarketConfig";
        readonly components: readonly [{
            readonly name: "rowE8";
            readonly type: "int64";
            readonly internalType: "int64";
        }, {
            readonly name: "maxMoveE8";
            readonly type: "uint56";
            readonly internalType: "uint56";
        }, {
            readonly name: "maxLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "enabled";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "setParams";
    readonly inputs: readonly [{
        readonly name: "p";
        readonly type: "tuple";
        readonly internalType: "struct HexitGame.Params";
        readonly components: readonly [{
            readonly name: "recorders";
            readonly type: "address[3]";
            readonly internalType: "address[3]";
        }, {
            readonly name: "quoter";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxPayout";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "minStake";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "guardian";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxColLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxStake";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "relayer";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "maxMarketLiab";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxHexLiab";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "dailyLossLimit";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "maxMoveE8";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "voidAfterMs";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "gapMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "quoteMaxAgeMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "lockMarginMs";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }, {
            readonly name: "maxOpen";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }];
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "setPause";
    readonly inputs: readonly [{
        readonly name: "bits";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "on";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "settleColumn";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly internalType: "uint32";
    }, {
        readonly name: "ts";
        readonly type: "uint64[]";
        readonly internalType: "uint64[]";
    }, {
        readonly name: "px";
        readonly type: "uint64[]";
        readonly internalType: "uint64[]";
    }, {
        readonly name: "recorderSig";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }, {
        readonly name: "players";
        readonly type: "address[]";
        readonly internalType: "address[]";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "sweep";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "totalCredit";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "totalOpen";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "transferOwnership";
    readonly inputs: readonly [{
        readonly name: "newOwner";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "upgradeToAndCall";
    readonly inputs: readonly [{
        readonly name: "newImplementation";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "data";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "payable";
}, {
    readonly type: "function";
    readonly name: "usdc";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "voidColumn";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly internalType: "uint32";
    }, {
        readonly name: "players";
        readonly type: "address[]";
        readonly internalType: "address[]";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "withdraw";
    readonly inputs: readonly [{
        readonly name: "amount";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "withdrawFor";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "nonce";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "deadline";
        readonly type: "uint64";
        readonly internalType: "uint64";
    }, {
        readonly name: "sig";
        readonly type: "bytes";
        readonly internalType: "bytes";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "event";
    readonly name: "BetPlaced";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "asset";
        readonly type: "uint8";
        readonly indexed: true;
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly indexed: true;
        readonly internalType: "uint32";
    }, {
        readonly name: "j";
        readonly type: "int32";
        readonly indexed: false;
        readonly internalType: "int32";
    }, {
        readonly name: "stake";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }, {
        readonly name: "mult";
        readonly type: "uint16";
        readonly indexed: false;
        readonly internalType: "uint16";
    }, {
        readonly name: "nonce";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }, {
        readonly name: "slot";
        readonly type: "uint8";
        readonly indexed: false;
        readonly internalType: "uint8";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "BetSettled";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "asset";
        readonly type: "uint8";
        readonly indexed: true;
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly indexed: true;
        readonly internalType: "uint32";
    }, {
        readonly name: "j";
        readonly type: "int32";
        readonly indexed: false;
        readonly internalType: "int32";
    }, {
        readonly name: "stake";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }, {
        readonly name: "mult";
        readonly type: "uint16";
        readonly indexed: false;
        readonly internalType: "uint16";
    }, {
        readonly name: "slot";
        readonly type: "uint8";
        readonly indexed: false;
        readonly internalType: "uint8";
    }, {
        readonly name: "outcome";
        readonly type: "uint8";
        readonly indexed: false;
        readonly internalType: "uint8";
    }, {
        readonly name: "credited";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "ColumnSettled";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly indexed: true;
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly indexed: true;
        readonly internalType: "uint32";
    }, {
        readonly name: "bJ0";
        readonly type: "int32";
        readonly indexed: false;
        readonly internalType: "int32";
    }, {
        readonly name: "gap";
        readonly type: "bool";
        readonly indexed: false;
        readonly internalType: "bool";
    }, {
        readonly name: "touched";
        readonly type: "uint256";
        readonly indexed: false;
        readonly internalType: "uint256";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "ColumnVoided";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly indexed: true;
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly indexed: true;
        readonly internalType: "uint32";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Deposited";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Disabled";
    readonly inputs: readonly [{
        readonly name: "by";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "bits";
        readonly type: "uint8";
        readonly indexed: false;
        readonly internalType: "uint8";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Granted";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "HexTouched";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly indexed: true;
        readonly internalType: "uint8";
    }, {
        readonly name: "k";
        readonly type: "uint32";
        readonly indexed: true;
        readonly internalType: "uint32";
    }, {
        readonly name: "j";
        readonly type: "int32";
        readonly indexed: false;
        readonly internalType: "int32";
    }, {
        readonly name: "tsMs";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "HouseDeposit";
    readonly inputs: readonly [{
        readonly name: "amount";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "HouseWithdraw";
    readonly inputs: readonly [{
        readonly name: "amount";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Initialized";
    readonly inputs: readonly [{
        readonly name: "version";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "MarketSet";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "uint8";
        readonly indexed: true;
        readonly internalType: "uint8";
    }, {
        readonly name: "rowE8";
        readonly type: "int64";
        readonly indexed: false;
        readonly internalType: "int64";
    }, {
        readonly name: "maxMoveE8";
        readonly type: "uint56";
        readonly indexed: false;
        readonly internalType: "uint56";
    }, {
        readonly name: "maxLiab";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }, {
        readonly name: "enabled";
        readonly type: "bool";
        readonly indexed: false;
        readonly internalType: "bool";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "OwnershipTransferStarted";
    readonly inputs: readonly [{
        readonly name: "previousOwner";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "newOwner";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "OwnershipTransferred";
    readonly inputs: readonly [{
        readonly name: "previousOwner";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "newOwner";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "ParamsSet";
    readonly inputs: readonly [{
        readonly name: "by";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Paused";
    readonly inputs: readonly [{
        readonly name: "by";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "bits";
        readonly type: "uint8";
        readonly indexed: false;
        readonly internalType: "uint8";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Swept";
    readonly inputs: readonly [{
        readonly name: "amount";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Upgraded";
    readonly inputs: readonly [{
        readonly name: "implementation";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "Withdrawn";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint64";
        readonly indexed: false;
        readonly internalType: "uint64";
    }];
    readonly anonymous: false;
}, {
    readonly type: "error";
    readonly name: "AddressEmptyCode";
    readonly inputs: readonly [{
        readonly name: "target";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "AlreadyGranted";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "AssetCap";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BadParams";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BadSig";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BadTape";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "BelowMinMult";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "ColumnCap";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "DailyLossHalt";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "ERC1967InvalidImplementation";
    readonly inputs: readonly [{
        readonly name: "implementation";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC1967NonPayable";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "Expired";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "FailedCall";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "HexCap";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "HouseCapacity";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "InsufficientCredit";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "InvalidInitialization";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "IsPaused";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "Locked";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "MarketBusy";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "MarketCap";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "MarketClosed";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "MoveTooLarge";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NonceUsed";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotGuardian";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotInitializing";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotOffered";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotQuoted";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotQuoter";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotRecorder";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotRelayer";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "OffGrid";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "OwnableInvalidOwner";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "OwnableUnauthorizedAccount";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "PayoutCap";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "QuoteStale";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "ReserveBreach";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "StakeOutOfRange";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TickInFuture";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TickNotNewer";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TooEarly";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TooLate";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TooManyOpen";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TreasuryMismatch";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "UUPSUnauthorizedCallContext";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "UUPSUnsupportedProxiableUUID";
    readonly inputs: readonly [{
        readonly name: "slot";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
}], undefined, true, undefined>;
export type HexitErrorName = Extract<(typeof hexitGameAbi)[number], {
    type: 'error';
}>['name'];
/**
 * The custom-error name of a revert: from a viem error (simulate, call, write, estimateGas) or raw revert data.
 * undefined when there is no decodable revert data (e.g. a network error).
 */
export declare function errorName(e: unknown): string | undefined;
