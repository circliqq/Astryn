# Launch Checklist

- [ ] Supabase project created and migrations applied.
- [ ] Redis deployed with persistence.
- [ ] OpenSea API key configured on API and worker only.
- [ ] RPC primary and backups configured for Base and Ethereum.
- [ ] `ENCRYPTION_MASTER_KEY` generated and stored in a secrets manager.
- [ ] Mainnet signing disabled until Sepolia tests pass.
- [ ] Wallet import audited for plaintext leakage.
- [ ] Logs verified for secret redaction.
- [ ] Gas Guardian enabled by default.
- [ ] Simulation failures block transaction sending.
- [ ] Post-mint CSV export verified.
- [ ] Incident response contacts documented.
