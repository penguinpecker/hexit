#!/usr/bin/env bash
# Rehearses the markets upgrade on a LOCAL anvil fork of Monad testnet. It reads the chain and never sends to it.
# The live proxy from ../deployment/monad.json is upgraded with script/Upgrade.s.sol, as the admin (impersonated).
# The pre-upgrade views must be unchanged afterwards. GasBench then grants, bets and settles on BTC and MON against
# the upgraded live storage. The fork runs as chain 31337, so its artifacts can't be mistaken for testnet records.
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-8547}
RPC=http://127.0.0.1:$PORT
D=../deployment/monad.json
GAME=$(jq -r .game $D)
ADMIN=$(jq -r .roles.admin $D)
anvil --network monad --fork-url "${HEXIT_FORK_RPC:-https://testnet-rpc.monad.xyz}" --chain-id 31337 --auto-impersonate --port "$PORT" > /dev/null 2>&1 &
APID=$!
trap 'kill $APID 2>/dev/null' EXIT
until cast chain-id --rpc-url "$RPC" > /dev/null 2>&1; do :; done
for r in admin relayer keeper; do cast rpc anvil_setBalance "$(jq -r ".roles.$r" $D)" 0x56BC75E2D63100000 --rpc-url "$RPC" > /dev/null; done
views() { for f in house houseLiab totalCredit totalOpen openLiability netLossToday day paused disabled rowE8 usdc owner getParams domainSeparator; do cast call "$GAME" "$f()" --rpc-url "$RPC"; done; }
BEFORE=$(views)
echo "fork block $(cast block-number --rpc-url "$RPC"), impl $(cast impl "$GAME" --rpc-url "$RPC"), open liability $(cast call "$GAME" 'openLiability()(uint64)' --rpc-url "$RPC")"
cp $D deployments/31337.json
export HEXIT_GAME=$GAME HEXIT_ADMIN=$ADMIN HEXIT_DEPLOY_OUT=deployments/31337.json HEXIT_KEEPER=$(jq -r .roles.keeper $D)
F="--rpc-url $RPC --broadcast --unlocked --sender $ADMIN --slow -q"
forge script script/Upgrade.s.sol $F
if [ "$(views)" = "$BEFORE" ]; then echo "pre-upgrade views unchanged"; else echo "VIEWS CHANGED BY THE UPGRADE"; exit 1; fi
forge script script/Upgrade.s.sol --sig 'record()' --rpc-url "$RPC" -q   # checks the chain, then writes the record
jq 'del(.market)' deployments/31337.json > deployments/31337.json.tmp && mv deployments/31337.json.tmp deployments/31337.json
jq -c '{gameImpl, markets, market}' deployments/31337.json
for phase in prep bets; do forge script script/GasBench.s.sol --sig "$phase()" $F; done
cast rpc evm_setNextBlockTimestamp "$(jq .settleAt deployments/gasbench-31337.json)" --rpc-url "$RPC" > /dev/null
cast rpc evm_mine --rpc-url "$RPC" > /dev/null
for phase in settle money; do forge script script/GasBench.s.sol --sig "$phase()" $F; done
python3 -I - <<'PY'
import json
def rows(path):
    d = json.load(open(path))
    fn = {t["hash"]: (t.get("function") or t.get("transactionType")) for t in d["transactions"]}
    return [(fn[r["transactionHash"]], int(r["gasUsed"], 16), r["status"]) for r in d["receipts"]]
for phase, path in [("upgrade", "broadcast/Upgrade.s.sol/31337/run-latest.json")] + [
        (p, f"broadcast/GasBench.s.sol/31337/{p}-latest.json") for p in ("prep", "bets", "settle", "money")]:
    for i, (f, g, st) in enumerate(rows(path)):
        assert st == "0x1", (phase, i, f)
        print(f"{phase:7} {i:>2} {str(f)[:58]:58} {g:>9} {int(g * 1.1):>9}")
PY
