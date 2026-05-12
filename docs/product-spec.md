# Astryn Product Spec

Astryn is an operations-focused NFT mint automation and monitoring console for OpenSea Drops on Base and Ethereum.

## Core Workflows

1. Create account with Supabase Auth.
2. Import wallets through the API only.
3. Encrypt private keys with Argon2id and AES-256-GCM before persistence.
4. Scan OpenSea drops through backend-only OpenSea API calls.
5. Check collection phases, wallet eligibility, wallet health, gas caps, RPC health, and nonce state.
6. Run simulation before signing any transaction.
7. Execute only if simulation and readiness checks pass.
8. Broadcast the same signed transaction to multiple RPC providers.
9. Monitor receipt, bump gas under user caps when needed, and record transparent logs.
10. Generate post-mint reports with CSV export.

## Networks

- Base
- Ethereum
- Base Sepolia for test execution
- Ethereum Sepolia for test execution

## Mint Types

- Public
- Allowlist / WL
- GTD
- FCFS
