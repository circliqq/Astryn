# BundleMint7702 — EIP-7702 atomic bundle-mint executor

Reference contract for Astryn's **Bundle Mint → EIP-7702** mode. One main
(sponsor) wallet mints from many sub-wallets in a single atomic transaction.

## Roles

- **Owner** — admin set at deploy; can rotate the relayer / owner (`setRelayer`,
  `setOwner`).
- **Relayer** — the only address allowed to trigger `orchestrate*` (the
  tx-sender / sponsor wallet that broadcasts the bundle). Defaults to the owner.
- **Executor** — this contract's own address (`SELF`); sub-wallets 7702-delegate
  to it and `mintExec`/`callExec` run in their context.

## Value Payer (`payFromSender`)

- **Tx Sender** (`true`) — the relayer forwards the mint ETH; sub-wallets need no
  balance.
- **Delegated Wallet** (`false`) — each sub-wallet pays the mint price from its
  own balance; the relayer only pays gas.

## How it works

1. Each sub-wallet signs a 7702 authorization delegating its EOA to the
   deployed `BundleMint7702` address (off-chain, gasless for the sub-wallet).
2. The sponsor wallet sends one **type-4** transaction:
   - `authorizationList` = every sub-wallet authorization
   - `to` = the deployed `BundleMint7702`
   - `data` = `orchestrateSeaDrop(...)` or `orchestrateCall(...)`
   - `value` = `pricePerMint * quantity * minters.length` (sponsor pays all)
3. The EVM applies the authorizations (each sub-wallet temporarily runs this
   contract's code), then `orchestrate*` loops and mints from each sub-wallet
   in its own context — atomic, same block.

## Security

- `mintExec` / `callExec` only accept calls from `SELF` (the canonical
  deployed address), so a delegated sub-wallet can only be driven by this
  orchestrator.
- The orchestrator forwards only the sponsor's ETH; it never spends a
  sub-wallet's balance.
- Executors write no storage (no EOA storage pollution); the reentrancy guard
  lives on the canonical instance only.

> ⚠️ Reference code — **audit before mainnet use**. Deploy with CREATE2 and use
> an immutable (non-proxy) deployment, per the EIP-7702 phishing guidance.

## Deploy

Requires Solidity ^0.8.24 (Cancun) on a 7702-enabled chain (Ethereum mainnet
since Pectra; Base since Isthmus).

Constructor args: `(address owner, address relayer)`. Pass `0x0` for either to
default owner→deployer and relayer→owner.

```bash
# Foundry example (owner = deployer, relayer = your sponsor wallet)
forge create contracts/BundleMint7702.sol:BundleMint7702 \
  --rpc-url $ETH_RPC_PRIMARY --private-key $DEPLOYER_KEY \
  --constructor-args 0x0000000000000000000000000000000000000000 $SPONSOR_ADDRESS
# (prefer CREATE2 via `forge script` + a deterministic deployer for production)
```

Then set the address in `.env`:

```
BUNDLE_MINT_7702_EXECUTOR_ETH=0x...    # deployed on Ethereum
BUNDLE_MINT_7702_EXECUTOR_BASE=0x...   # deployed on Base (same bytecode/address if CREATE2)
```

The address is also configurable per-task in the Bundle Mint UI.
