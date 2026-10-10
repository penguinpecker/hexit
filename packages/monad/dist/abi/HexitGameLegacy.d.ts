export declare const legacyGameEvents: readonly [{
    readonly type: "event";
    readonly name: "BetPlaced";
    readonly inputs: readonly [{
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
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
        readonly name: "k";
        readonly type: "uint32";
        readonly indexed: true;
        readonly internalType: "uint32";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "HexTouched";
    readonly inputs: readonly [{
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
}];
