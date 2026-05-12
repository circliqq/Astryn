# Security

## Private Keys

Private keys must never be sent to the frontend after import, logged, stored in localStorage, or persisted in plaintext.

The wallet vault stores only:

- `encryptedPrivateKey`
- `encryptionSalt`
- `encryptionIv`
- `encryptionAuthTag`
- `encryptionVersion`

Encryption uses Argon2id-derived AES-256-GCM keys with unique salt, unique IV, and authenticated tags.

## Runtime Signing

The worker decrypts keys only inside the mint execution path, signs a single transaction, then clears buffer memory where possible. Long-running runtime logic, tx signing, and RPC broadcast are never delegated to Supabase.

## Abuse Boundaries

Astryn does not include rate-limit bypass, stealth scraping, anti-bot evasion, tx flooding, or platform abuse logic. Integrations use official APIs, safe retries, gas caps, transparent logs, and simulation-first execution.

## Operational Controls

- Supabase Auth for identity.
- Service role key available only to the API.
- Secrets redacted in structured logs.
- Rate limiting through Nest throttling.
- Security audit logs for sensitive actions.
- 2FA-ready account model.
