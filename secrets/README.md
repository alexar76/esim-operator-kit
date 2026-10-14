Put these files here (one value per file, no newline needed). This folder is mounted read-only and never committed.

| File | What | Needed |
|---|---|---|
| `esimaccess_access_code` | eSIM Access → Developer → AccessCode | yes |
| `esimaccess_secret_key` | eSIM Access → Developer → SecretKey | yes |
| `cdp_api_key.json` | Coinbase Developer Platform API key (JSON) — gasless USDC on Base and x402 for agents | for agents and gasless Base |
| `tonapi_key` | tonapi.io key — higher rate limit for finding TON payments | optional |
| `trongrid_key` | TronGrid API key — higher rate limit for Tron | optional |
| `stripe_secret_key`, `stripe_webhook_secret` | Stripe, to take cards | optional |
