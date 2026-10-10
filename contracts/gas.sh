#!/usr/bin/env bash
# Gas measurement on a LOCAL `anvil --network monad` (never a public network): deploys with script/Deploy.s.sol,
# runs script/GasBench.s.sol phase by phase, prints gasUsed per transaction from the broadcast receipts.
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-8546}
RPC=http://127.0.0.1:$PORT
anvil --network monad --port "$PORT" > /dev/null 2>&1 &
APID=$!
trap 'kill $APID 2>/dev/null' EXIT
until cast chain-id --rpc-url "$RPC" > /dev/null 2>&1; do :; done
CHAIN=$(cast chain-id --rpc-url "$RPC")
ACC=($(cast rpc eth_accounts --rpc-url "$RPC" | tr -d '[]"' | tr ',' ' '))
export HEXIT_ADMIN=${ACC[0]} HEXIT_RELAYER=${ACC[1]} HEXIT_KEEPER=${ACC[2]} HEXIT_GUARDIAN=${ACC[3]}
export HEXIT_RECORDER=${ACC[4]} HEXIT_QUOTER=${ACC[5]} HEXIT_RPC_HTTP=$RPC HEXIT_RPC_WS=ws://127.0.0.1:$PORT
F="--rpc-url $RPC --broadcast --unlocked --sender $HEXIT_ADMIN --slow -q"
forge script script/Deploy.s.sol $F
for phase in prep bets; do forge script script/GasBench.s.sol --sig "$phase()" $F; done
B=deployments/gasbench-$CHAIN.json
GAME=$(jq -r .game deployments/$CHAIN.json)
al() { cast send "$GAME" "$(jq -r ".$2" $B)" --from "$1" --unlocked --access-list --rpc-url "$RPC" --json | jq -r .gasUsed | cast to-dec; }
AL_BET=$(al "$HEXIT_RELAYER" betCalldata)
cast rpc evm_setNextBlockTimestamp "$(jq .settleAt $B)" --rpc-url "$RPC" > /dev/null
cast rpc evm_mine --rpc-url "$RPC" > /dev/null
for phase in settle money; do forge script script/GasBench.s.sol --sig "$phase()" $F; done
AL_SETTLE=$(al "$HEXIT_KEEPER" settleCalldata)
echo "with access list: placeBetFor (warm) $AL_BET, settleColumn (1 bet) $AL_SETTLE"
python3 -I - "$CHAIN" <<'PY'
import json, sys
c = sys.argv[1]
def rows(path):
    d = json.load(open(path))
    fn = {t["hash"]: (t.get("function") or t.get("transactionType")) for t in d["transactions"]}
    return [(fn[r["transactionHash"]], int(r["gasUsed"], 16), r["status"]) for r in d["receipts"]]
print(f"{'phase':7} {'#':>2} {'tx':58} {'gasUsed':>9} {'limit+10%':>9}")
for phase, path in [("deploy", f"broadcast/Deploy.s.sol/{c}/run-latest.json")] + [
        (p, f"broadcast/GasBench.s.sol/{c}/{p}-latest.json") for p in ("prep", "bets", "settle", "money")]:
    for i, (f, g, st) in enumerate(rows(path)):
        assert st == "0x1", (phase, i, f)
        print(f"{phase:7} {i:>2} {str(f)[:58]:58} {g:>9} {int(g * 1.1):>9}")
PY
