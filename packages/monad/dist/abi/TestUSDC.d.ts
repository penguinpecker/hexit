export declare const testUsdcAbi: readonly [{
    readonly type: "constructor";
    readonly inputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "DOMAIN_SEPARATOR";
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
    readonly name: "acceptOwnership";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "allowance";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "approve";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "balanceOf";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "decimals";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
        readonly internalType: "uint8";
    }];
    readonly stateMutability: "pure";
}, {
    readonly type: "function";
    readonly name: "eip712Domain";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "fields";
        readonly type: "bytes1";
        readonly internalType: "bytes1";
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly internalType: "string";
    }, {
        readonly name: "version";
        readonly type: "string";
        readonly internalType: "string";
    }, {
        readonly name: "chainId";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }, {
        readonly name: "verifyingContract";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "salt";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }, {
        readonly name: "extensions";
        readonly type: "uint256[]";
        readonly internalType: "uint256[]";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "initialize";
    readonly inputs: readonly [{
        readonly name: "owner_";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "mint";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "minters";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "name";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
        readonly internalType: "string";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "nonces";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
        readonly internalType: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
        readonly internalType: "uint256";
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
    readonly name: "permit";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint256";
        readonly internalType: "uint256";
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
    readonly name: "setMinter";
    readonly inputs: readonly [{
        readonly name: "m";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "on";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly outputs: readonly [];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "symbol";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
        readonly internalType: "string";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "totalSupply";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "transfer";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "transferFrom";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
        readonly internalType: "bool";
    }];
    readonly stateMutability: "nonpayable";
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
    readonly type: "event";
    readonly name: "Approval";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly indexed: false;
        readonly internalType: "uint256";
    }];
    readonly anonymous: false;
}, {
    readonly type: "event";
    readonly name: "EIP712DomainChanged";
    readonly inputs: readonly [];
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
    readonly name: "MinterSet";
    readonly inputs: readonly [{
        readonly name: "minter";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "on";
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
    readonly name: "Transfer";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
        readonly internalType: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly indexed: false;
        readonly internalType: "uint256";
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
    readonly type: "error";
    readonly name: "AddressEmptyCode";
    readonly inputs: readonly [{
        readonly name: "target";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "ECDSAInvalidSignature";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "ECDSAInvalidSignatureLength";
    readonly inputs: readonly [{
        readonly name: "length";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
}, {
    readonly type: "error";
    readonly name: "ECDSAInvalidSignatureS";
    readonly inputs: readonly [{
        readonly name: "s";
        readonly type: "bytes32";
        readonly internalType: "bytes32";
    }];
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
    readonly name: "ERC20InsufficientAllowance";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "allowance";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }, {
        readonly name: "needed";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC20InsufficientBalance";
    readonly inputs: readonly [{
        readonly name: "sender";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "balance";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }, {
        readonly name: "needed";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC20InvalidApprover";
    readonly inputs: readonly [{
        readonly name: "approver";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC20InvalidReceiver";
    readonly inputs: readonly [{
        readonly name: "receiver";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC20InvalidSender";
    readonly inputs: readonly [{
        readonly name: "sender";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC20InvalidSpender";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC2612ExpiredSignature";
    readonly inputs: readonly [{
        readonly name: "deadline";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
}, {
    readonly type: "error";
    readonly name: "ERC2612InvalidSigner";
    readonly inputs: readonly [{
        readonly name: "signer";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "owner";
        readonly type: "address";
        readonly internalType: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "FailedCall";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "InvalidAccountNonce";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
        readonly internalType: "address";
    }, {
        readonly name: "currentNonce";
        readonly type: "uint256";
        readonly internalType: "uint256";
    }];
}, {
    readonly type: "error";
    readonly name: "InvalidInitialization";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotInitializing";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotMinter";
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
