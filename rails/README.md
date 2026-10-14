# esim-rails

Open rails for selling travel data eSIMs through an AIMarket hub. Anyone with a wholesale account
runs a **seller node**; buyers — AI agents booking trips, apps, a storefront for travellers — find
the cheapest plan across every connected seller and buy it with one x402 payment. The hub routes and
takes its routing fee; the seller is the merchant (its prices, its VAT, its refunds).

Status: **v0.1.** The wholesale client, offers, pricing, the order flow and the seller node (free
signed quote and status, the paid order behind x402) are written and tested; the client reads a live
eSIM Access catalogue. Not yet: hub listings, a test order (none has been placed).

## The three capabilities

| Capability | Price | Input | Answer |
|---|---|---|---|
| `esim.quote@v1` | free | `country` (ISO alpha-2), optional `min_gb`, `min_days`, `max_usd`, `limit` | offers covering the country, cheapest first — regional and global plans that include it count |
| `esim.order@v1` | the offer's price, x402 (USDC on Base) | `offer_id` | `activation_code` (the LPA string an eSIM is installed from), `qr_code_url`, `install_url`, `iccid`, `apn`, `expires`, `status_token` |
| `esim.status@v1` | free | `esim_tran_no`, `status_token` | state, installed or not, data used and total, expiry — and the activation code again |

An offer (`src/offers.js`) reads the same whichever wholesaler is behind it: `offer_id`, `name`,
`coverage {kind, countries}`, `data_bytes`, `data_gb`, `days`, `speed`, `networks`, `top_up`,
`unused_valid_days`, `price {usd, currency}`, `usd_per_gb`. The wholesale cost never leaves the node.
Ask with `min_gb` and `min_days`: without them the cheapest offer is often a 0.1 GB plan.

`scripts/catalog.mjs` shows a seller what it would sell, read-only: balance, plan count, the shape of
the supplier's fields, and the top offers for a few countries at its margin. The first live read
(2026-10-14) found 1 728 fixed plans, all with a slug, all USD and days; e.g. France 1 GB / 7 days at
$0.70 wholesale.

## What the order flow guarantees (`src/order.js`)

- **One payment, one profile.** The wholesaler's `transactionId` is derived from the payment, and the
  supplier treats a repeated id as the same order: a retry after a lost answer cannot buy twice.
- **The activation code goes to the payer only.** It is in the answer and nowhere else — not in the
  node's store (a test reads the file), not in logs, not in any receipt or feed. The payer gets a
  `status_token` (an HMAC of the profile number under the node's secret) to read the profile again.
- **Delivered, then settled.** The node verifies the payment, orders, waits for the profile (the
  supplier allocates it within ~30 s), and settles only after that. A refused order buys nothing; an
  allocation that is still running is reported and resumes on retry with the same payment; a payment
  that fails to settle cancels the profile, which the supplier refunds while it is unused.
- **The price is checked twice.** The order carries the wholesale price the offer was quoted at, so a
  plan whose price changed since the quote is refused by the supplier rather than charged.

## Suppliers

- **eSIM Access** (`src/esimaccess.js`): signed requests (`RT-AccessCode`, `RT-RequestID`,
  `RT-Timestamp`, `RT-Signature` = HMAC-SHA256 of timestamp + request id + access code + body under the
  secret key — the supplier's own test vector is in the tests), prices in 1/10 000 USD, 8 requests a
  second, no sandbox (a test order is cancelled and refunded). Keys are read from files and never
  logged, returned or sent anywhere but the supplier's host.
- Next: eSIM Go, Airalo Partners — each is one more client behind the same offers and order flow.

## The node (`src/node.js`, `src/server.js`)

| Route | |
|---|---|
| `POST /quote/invoke`, `POST /status/invoke` | the hub's provider contract: `{success, result}` with an Ed25519 `X-Provider-Signature` over the request-bound canonical the hub verifies |
| `POST /order` | `{offer_id}` — an unknown offer is a 400 before any price; then the x402 paywall (`src/paywall.js`: CDP facilitator, USDC on Base, the offer's price read from the request, paid to `PAY_TO`); the answer is released only after settlement |
| `GET /listing.json` | the two hub listings and where the order is bought |
| `GET /healthz` | catalogue loaded, provider key, whether orders are on |

Configuration is in `src/server.js` (keys as files; the status secret and the provider key are made on
first start). Without `PAY_TO` and `CDP_KEY_FILE` the node quotes but takes no orders.

## Connecting as a seller

1. A wholesale account (eSIM Access self-serve, no minimum) and its API keys in two files.
2. A payout wallet on Base, a CDP API key for the facilitator, and your margin (`MARGIN_PCT`,
   default 20 %, never below `MIN_MARGIN_USD`).
3. Run the node (`Dockerfile`; `deploy.sh` is how the operator runs its own) and publish its listings
   to a hub; buyers find you in the hub's catalogue and pay you directly over x402.

Selling to consumers makes you the merchant: in the EU that means VAT on telecom services in the
buyer's country (OSS). The rails do not hold anyone's money.

## Test

```bash
npm test     # node:test, no network, no keys
```
