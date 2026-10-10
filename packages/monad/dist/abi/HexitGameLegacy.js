// The five bet and column events of the pre-markets HexitGame (implementation 0xba00953704615bBDBd2d32b0F54DB681B6F210e8,
// live on testnet until the markets upgrade), frozen from its ABI: they have no asset (it is SOL, 0) and other topic0s.
// An indexer decodes logs from before the upgrade with these. Do not regenerate.
export const legacyGameEvents = [
    {
        "type": "event",
        "name": "BetPlaced",
        "inputs": [
            {
                "name": "player",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "k",
                "type": "uint32",
                "indexed": true,
                "internalType": "uint32"
            },
            {
                "name": "j",
                "type": "int32",
                "indexed": false,
                "internalType": "int32"
            },
            {
                "name": "stake",
                "type": "uint64",
                "indexed": false,
                "internalType": "uint64"
            },
            {
                "name": "mult",
                "type": "uint16",
                "indexed": false,
                "internalType": "uint16"
            },
            {
                "name": "nonce",
                "type": "uint64",
                "indexed": false,
                "internalType": "uint64"
            },
            {
                "name": "slot",
                "type": "uint8",
                "indexed": false,
                "internalType": "uint8"
            }
        ],
        "anonymous": false
    },
    {
        "type": "event",
        "name": "BetSettled",
        "inputs": [
            {
                "name": "player",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "k",
                "type": "uint32",
                "indexed": true,
                "internalType": "uint32"
            },
            {
                "name": "j",
                "type": "int32",
                "indexed": false,
                "internalType": "int32"
            },
            {
                "name": "stake",
                "type": "uint64",
                "indexed": false,
                "internalType": "uint64"
            },
            {
                "name": "mult",
                "type": "uint16",
                "indexed": false,
                "internalType": "uint16"
            },
            {
                "name": "slot",
                "type": "uint8",
                "indexed": false,
                "internalType": "uint8"
            },
            {
                "name": "outcome",
                "type": "uint8",
                "indexed": false,
                "internalType": "uint8"
            },
            {
                "name": "credited",
                "type": "uint64",
                "indexed": false,
                "internalType": "uint64"
            }
        ],
        "anonymous": false
    },
    {
        "type": "event",
        "name": "ColumnSettled",
        "inputs": [
            {
                "name": "k",
                "type": "uint32",
                "indexed": true,
                "internalType": "uint32"
            },
            {
                "name": "bJ0",
                "type": "int32",
                "indexed": false,
                "internalType": "int32"
            },
            {
                "name": "gap",
                "type": "bool",
                "indexed": false,
                "internalType": "bool"
            },
            {
                "name": "touched",
                "type": "uint256",
                "indexed": false,
                "internalType": "uint256"
            }
        ],
        "anonymous": false
    },
    {
        "type": "event",
        "name": "ColumnVoided",
        "inputs": [
            {
                "name": "k",
                "type": "uint32",
                "indexed": true,
                "internalType": "uint32"
            }
        ],
        "anonymous": false
    },
    {
        "type": "event",
        "name": "HexTouched",
        "inputs": [
            {
                "name": "k",
                "type": "uint32",
                "indexed": true,
                "internalType": "uint32"
            },
            {
                "name": "j",
                "type": "int32",
                "indexed": false,
                "internalType": "int32"
            },
            {
                "name": "tsMs",
                "type": "uint64",
                "indexed": false,
                "internalType": "uint64"
            }
        ],
        "anonymous": false
    }
];
