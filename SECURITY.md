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
| Buyers pay to the operator's addresses; the kit holds no key that can spend | `store/src/payments/*`, `rails/src/paywall.js`: addresses only, never a private key |
| One payment buys one eSIM | `rails/src/order.js` `transactionIdFor`; supplier idempotency (eSIM Access) or the adapters' guard (`suppliers-more.js`) |
| An agent's payment settles only after delivery; a failed settlement cancels the eSIM | `rails/src/paywall.js`, `rails/src/node.js` `settleFailed` |
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
