export declare const hexitGameAbi: readonly [{
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
}];
