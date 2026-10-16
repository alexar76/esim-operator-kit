# Security policy

## Supported versions

Security fixes go to the latest `main` and to the latest published `@aimarket/esim-rails`.

## Report privately

Do not open a public issue for a vulnerability. Use GitHub private vulnerability reporting on
`alexar76/esim-operator-kit` with the affected revision, a reproduction, the impact and a minimal
proof. We acknowledge within **72 hours** and coordinate disclosure within **90 days**.

Never include in a report: supplier keys (eSIM Access, Airalo, eSIM Go), a CDP key, a webhook or
supplier secret, a private key or seed phrase, an activation code (LPA string), an order token, or a
customer's data.

## What the kit guarantees, and where to look

| Guarantee | Where it is enforced |
|---|---|
| Buyer payments go to the operator; automatic refunds use a separate opt-in spending key | Payment receivers: `store/src/payments/*`, `rails/src/paywall.js`; optional refund key and durable caps: `rails/src/refund.js` |
| One payment buys one eSIM | `rails/src/order.js` `transactionIdFor`; supplier idempotency (eSIM Access) or the adapters' guard (`suppliers-more.js`) |
| An agent's payment settles only after delivery; an uncertain settlement is held for reconciliation | `rails/src/paywall.js`, `rails/src/node.js` `settleFailed` |
| The activation code goes to the payer only | never stored (`fileStore` strips it), never logged, never in a webhook (tests in `store/test/store.test.js`, `rails/test/sdk.test.js`) |
| A buyer's order page needs the order token; only its hash is kept | `store/src/orders.js` |
| Free answers are signed and bound to the request | `rails/src/node.js` `boundCanonical`, Ed25519 |
| Supplier calls and webhooks are signed with a timestamp; replays are refused | `rails/src/http-supplier.js`, `rails/src/webhooks.js` (five-minute window) |
| Pages render values as text; one script origin | storefront CSP `script-src 'self'`; `/kit` Markdown escapes every character |
| Payments in demo mode are refused before any address is shown | `DEMO_MODE=1` in `store/src/app.js`, `rails/src/node.js` |

## In scope

- Paying less than the price, paying once and receiving two eSIMs, or receiving an eSIM without a settled payment.
- Reading an activation code, an order or a status without its token.
- Forging a signed quote, a webhook, or a request to an HTTP supplier.
- Script injection in the storefront or the `/kit` pages.
- A key or secret reaching a log, an answer, a webhook or the disk unencrypted outside `secrets/`.

## Out of scope

- The security of the operator's own systems behind the HTTP supplier or a webhook receiver.
- Third-party services: eSIM Access, Airalo, eSIM Go, Coinbase CDP, blockchains, wallets, AIMarket hubs.
- The example shop at esim-shop.modelmarket.dev selling nothing (that is its purpose).

## For operators

- Keep `secrets/` readable by user 1000 only (`chmod 600`), and back up `data/` and `secrets/` off the server.
- Never put a private key or a seed phrase in `.env`: the kit needs addresses only.
- Rotate a supplier key, the CDP key or a webhook secret if it may have leaked, then restart the services.

## Audit and local corrections — 2026-10-15

Scope: storefront checkout, EVM/Tron payment matching, x402 authorization and settlement, order persistence, refunds, agent delivery, SDK examples, federation discovery and onboarding for five audiences. This was a source review plus offline regression tests, not a production deployment or a new real-money supplier/payment certification.

Before correction, all six scenarios in `audit/repro-2026-10-15.mjs` reproduced the original failures. The script now asserts the corrected behavior and is included in the storefront test suite.

| Finding | Local correction |
|---|---|
| **P1:** a buyer could claim another buyer's public EVM transaction hash | Require an off-chain signature binding the order, chain, token, receiver, amount and hash; match its signer to the on-chain sender. Unsigned pending claims cannot reserve someone else's payment. |
| **P1:** reusing a completed Tron's exact amount exposed the original buyer's activation code | Reserve amounts throughout the watch window, including completed orders; consume each payment reference once before delivery. The reference guard also covers the other pushed methods. |
| **P1:** concurrent authorization could cancel an already paid profile | Serialize storefront mutations. For agent orders, hold a per-payment lock through settlement and persist the outcome. |
| **P1:** a lost settlement response was treated as proof that money had not moved | Persist `settlement_pending` before settlement, keep the profile, block another charge, require reconciliation. A persisted checkpoint and read-only Base reconciler resolve new payments from finalized chain evidence. |
| **P1:** refund caps could be exceeded concurrently and reset on restart | Durable reservations in integer USDC units, serialized by the ledger, stable refund reference, nonce saved before settlement, validation of finite limits. Unknown outcomes remain reserved. |
| **P2:** one failed file write poisoned the queue; corrupt JSON looked like an empty database | Recover the queue after an individual write failure. Only ENOENT means empty; parse, permissions and shape errors fail closed. |
| **P2:** signed storefront authorization was not tied to its own order's nonce | Validate nonce and validity period against the stored intent. The displayed expiry now matches authorization expiry. |
| **P2:** agent delivery event preceded confirmed payment | Production paywall calls `onSettled`; only then is `agent_order.delivered` emitted. Failure emits `agent_order.settlement_pending`. |
| **P2:** agent CLI discarded full activation code and status token | Reserve a private output file before purchase, checkpoint the payment for recovery, and save full delivery. Never overwrite an existing output file. |
| **P2:** `--check` changed files and could succeed with missing secrets | Read-only checks, missing-secret failures, live seller health check, preserve configured hub mode on rerun. |
| **P2:** Airalo/eSIM Go secrets were written but not passed to containers | Explicit default secret-file paths in Compose for both services; HTTP onboarding asks for its shared secret. |
| **P2:** SDK example used `paywall` before initialization; shipped agent example needed a dev-only dependency | Fix initialization order in five languages, require settlement callbacks and durable refund budget, move `@x402/fetch` into runtime dependencies. |
| **P2:** hub discovery advertised a status call that hubs reject for carrying a private token | Publish quote only; advertise status as a direct endpoint. Update the conformance checker and generated node configuration. |
| **P2:** Stripe redirect could lose access if browser storage was blocked | Block checkout with an explanation before leaving the page when the order token cannot be retained. |

Settled agent delivery recovery requires a separate private `X-Esim-Recovery` value, supplied from the first request (at least 32 random base64url characters). A payment signature or nonce may become public on chain and is not a recovery secret. Only its hash is stored by the seller. The shipped agent example generates and privately saves this value. Clients without it can still buy, but cannot replay a settled delivery after losing the response; keep the returned status token.

Validation commands from the repository root:

```sh
npm test --prefix esim-kit/rails
npm test --prefix esim-kit/store
node esim-kit/audit/repro-2026-10-15.mjs
bash -n esim-kit/onboard.sh
git diff --check -- esim-kit
```

At the completed local validation: **60 rails tests + 38 storefront tests passed**. New coverage includes a fake facilitator/network, concurrent requests, a real refund-ledger file reopen, an isolated onboarding directory, and a mocked external agent purchase with a private output file. No real funds or live supplier profiles were used. A separate read-only smoke test matched an already finalized public Base USDC authorization to its exact transfer using dRPC (2026-10-15); the official public Base endpoint returned HTTP 429 for logs, and dRPC rejected wider log queries. A ten-block default scan was verified against an existing finalized payment directly from the deployed container. Public RPC history and rate limits still apply.

### Operational limits and rollout

- Release target: **0.3.0**. Existing installations must upgrade; publishing a new package does not update them automatically.
- Since 0.3.0, the supplied node and storefront automatically reconcile uncertain USDC/Base payments at startup and every 30 seconds. They read finalized chain evidence for the original sender, recipient, exact amount and authorization nonce; they never submit another charge. A confirmed transfer unlocks delivery. A finalized unused authorization past expiry (or cancellation) closes the unpaid order and retries supplier cancellation if needed. RPC errors and unfinalized results remain pending; finality can take longer than the polling interval. Set `BASE_RPC` to a reliable Base RPC that supports `finalized` blocks and historical logs. Older orders without a saved checkpoint require operator review. Uncertain **refund transfers** still require operator review and remain reserved against the refund budget. For an embedded SDK node, call `startReconciliation(() => node.reconcile())`; custom stores must implement `all()` as well as `get()` and `put()`. Keep the original private recovery token to retrieve an agent delivery. No operator reconciliation UI is included.
- Use **one writer process per JSON data directory**. The mutation/refund locks are in process. Multiple replicas require transactional storage with an atomic global payment reservation and refund budget. The storefront currently serializes mutations, so slow suppliers also limit throughput.
- Back up order and budget records together. Removing them also removes deduplication and refund-budget history. Corrupt files stop processing rather than erase history.
- Webhook retry queues remain in memory; reconcile CRM/accounting from orders after a crash. A durable event outbox is not implemented here.
- Existing EVM orders created before this change have no signed claim challenge: do not silently regenerate them or ask buyers to pay again. Reconcile already sent payments manually during migration. Expired/late exact-amount transfers also need operator review.
- Regenerate `node.toml` and remove previously registered status capabilities from hubs during rollout. `--check` does not change admission state or prove an actual card/crypto purchase.
- Airalo/eSIM Go credentials and contracts, external wallet UX, Stripe's real redirect/webhook flow and provider outages still need an operator-controlled staging smoke test. Historical real-purchase cases do not certify this changed build.

For production, configure an archive RPC in `BASE_RPC`: the default public `https://base.drpc.org` has rate and history limits, so recovery after a long outage can stay pending until an archive endpoint is supplied.
