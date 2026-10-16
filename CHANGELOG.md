# Changelog

## 0.3.0 — 2026-10-15

- **Payment safety audit (2026-10-15):** EVM claims require the sending wallet's signature bound to the order and transaction; no exchange withdrawals for this method. Payment references are consumed once, recent Tron amounts remain reserved, and storefront mutations are serialized. Signed payments are tied to the order nonce and validity window.
- **Automatic payment reconciliation:** persist Base USDC authorization terms and scan checkpoints before settlement. A non-overlapping worker runs at startup and every 30 seconds, checks finalized authorization/transfer evidence, unlocks paid deliveries or cancels proven unpaid orders, and resumes across restarts. RPC errors remain pending; never submit a second charge. Storefront waiting pages poll automatically. Older orders without checkpoints and uncertain refund transfers require operator review.
- **Uncertain settlement:** profiles are retained as `settlement_pending`, with repeat charges blocked. Agent delivery events follow confirmed settlement; an exact retry can recover a settled delivery. SDK integrators must wire `onSettled` as well as `onSettleFailure`. Automatic refunds require a durable `budgetStore`; reservations and caps survive restart.
- **Onboarding:** read-only `--check`, preserve hub mode on rerun, wire Airalo/eSIM Go/HTTP secrets, fix SDK initialization order, publish only quote capabilities through hubs, save complete agent deliveries in private output files, and retain access across Stripe redirects. Guides describe five audience-specific paths in all five languages.
- JSON read errors fail closed; transient write failures no longer poison the write queue. `@x402/fetch` is a runtime dependency for the shipped agent example. See `SECURITY.md` (audit section) for validation and remaining operational limitations.

- **Your own price list** (`PRICES_FILE`, CSV or JSON, `config/prices.example.csv`): fixed prices per plan or per country and size, a margin per country, region or global plans, plans turned off; the most specific line wins and the margin formula prices the rest. A fixed price below the wholesale cost falls back to the formula; a list with a mistake stops the start with its line number. Spreadsheet exports (semicolons, decimal commas) read. `esim-rails prices <file>` checks a list offline; `scripts/catalog.mjs` now works with every supplier and shows what each line priced.
- **Refunds to agents**: `POST /refund` with the eSIM's number and status token cancels an unused eSIM at the wholesaler and pays the price back to the address that paid, once, capped (`REFUND_MAX_USD`, `REFUND_DAILY_MAX_USD`). Automatic with an opt-in refund wallet (`REFUND_KEY_FILE`): the node signs an EIP-3009 transfer and the x402 facilitator settles it, so the wallet needs no ETH; otherwise recorded as due (`agent_order.refund_due`). Webhooks `agent_order.refunded` / `agent_order.refund_due`.
- **The first real case** (`docs/<lang>/cases.md`, the new "Cases" page of /kit, five languages): ARGUS, a personal AI agent, bought a Turkey eSIM for 0.31 USDC on a seller node, delivered it to its owner's Telegram, and got the money back 34 minutes later; both transactions on Base, no ETH spent by the agent or the seller.
- `scripts/fund-agent.mjs`: send USDC from a wallet you hold to an agent's wallet for a test purchase.
- **Case 2** on the same page: ARGUS found the seller through the modelmarket.dev hub (search, then `esim.quote@v1` through the hub), bought from our public node at its own `/order` and got the refund; the node sold for a 52-minute window (06:56:55–07:48:33 UTC, 15 October 2026) and was switched back to demo right after. The node is now named by its mode, so an agent is not misled by "demo" in the name of a node that sells; `rails/deploy.sh` can open such a window (`ESIM_NODE_DEMO=0`, `ESIM_NODE_REFUND_DIR`, `ESIM_NODE_MARGIN_PCT`).
- **Onboarding in one command: `./onboard.sh`.** It asks only for what is missing (domain, store name, offer id, the wholesaler's keys typed in hidden), sets folders and owners, starts store, seller node and HTTPS in demo mode, checks the seller node, writes `node.toml`, starts the federation node, runs the admission check, and asks before knocking on modelmarket.dev. Safe to run again; `--check` changes nothing. On a server whose ports 80/443 are taken by nginx it puts the kit behind it (services on `127.0.0.1`, the site and a certbot certificate, after asking); any other web server gets the routes printed.
- **Your own hub** (`./onboard.sh --hub`, `docs/<lang>/own-hub.md`): a whole aimarket hub on your domain instead of the federation node, in the compose profile `hub`. It lists your offers itself, gives agents your own search and MCP address, and federates with the other hubs; the signing key moves between node and hub both ways, so hubs that pinned your domain keep trusting it. Tested end to end as a third-party operator: a fresh server behind its own nginx, admitted by modelmarket.dev, quotes routed through the federation, drawn on the Alien Monitor; then removed.
- The node image installs `aimarket-hub` 3.15.27, which publishes the provider key, so buyers' signed receipts count for every operator.
- **Signed delivery and refund receipts**: every delivered order answers with a receipt signed by the node's provider key (payer, `pay_to`, the payment's EIP-3009 nonce, the offer), and every refund paid back with one of its own; neither holds a secret of the eSIM. `node.toml` (`scripts/node-toml.mjs`) now carries the node's `provider_pubkey`, so a hub ties the receipts to the listing and shows buyers' confirmed deliveries on it (`deliveries_30d`). The federation node needs `aimarket-hub` 3.15.27 to publish the key.
- **`examples/agent-buy.mjs` buys the way any outside agent would**: `--hub` finds sellers through a hub and skips demo ones, `--key-file` reads the agent's key (never printed), `--max-usd` caps a payment, `--refund` gets the money back, and the seller's receipts go to the hub unless `--no-share`. The old form, a seller URL and a country, still works.
- **Case 3**: two buyers, Claude Code in a terminal and ARGUS in Telegram, bought and got refunds from our public node during a 9-minute selling window (09:38:59–09:48:22 UTC, 15 October 2026); the hub counted 2 confirmed deliveries by 2 distinct buyers and 2 refunds. Four transactions on Base; the node is back in demo.
- `scripts/fund-agent.mjs` reads the transfer's receipt from Base's own RPC (`BASE_RPC` to change it): another public endpoint refused that call and the script ended in a stack trace after the transfer was sent.
- **The catalogue survives the supplier**: the store and the node remember the last catalogue (`catalog-snapshot.json` in their data folders) and serve it when the supplier does not answer: for up to six hours when selling, for as long as needed in demo mode, so a demo outlives its wholesale account. The node's `/healthz` says where the catalogue comes from (`catalog.source`: `live` or `snapshot`, and its time).
- **One default margin**: 100 % with at least $1.00, everywhere. `.env.example` and the guides already said so, but the code used 20 % and $0.30 when `MARGIN_PCT` was unset — so the demo showed prices no operator would get out of the box.
- Refined storefront and operator landing with warm light and evergreen dark palettes, a travel-card hero and responsive typography.
- Accessible theme controls in five languages; saved preferences apply before paint and override the system. Documentation diagrams follow the selected theme.
- Fixed country-search form navigation and hidden plan cards; English country names also work in translated storefronts.
- Fixed narrow-screen overflow in the landing diagram; landing content remains readable if its module cannot load.
- Local preview scripts now report binding failures instead of announcing a server that did not start.
- Added five browser-script regression tests for themes and country search.

## 0.2.0 — 2026-10-14

Onboarding for existing operators.

- **SDK `@aimarket/esim-rails`**: a neutral supplier interface (`catalog`, `order`, `profiles`, `cancel`, `balance`) under the storefront and the seller node.
- **Ready suppliers**: eSIM Access (live-tested), Airalo Partner API and eSIM Go (built to their published APIs), and the HTTP supplier for an operator's own system in any language (`rails/spec/supplier-http.md`, reference backend in `rails/examples/operator-backend.mjs`).
- **Webhooks** for the operator's systems: `order.*` and `agent_order.*`, HMAC-signed with a timestamp, retried; a Telegram/Slack relay and a Google Sheets receiver in `rails/examples/`.
- **The contract as JSON Schemas** (`rails/spec/esim-v1/`) and a conformance check, `esim-rails check <node URL>`.
- **CORS** on the seller node's free routes, so a web page can ask for live quotes.
- **Docs in five languages**: onboarding and use cases, integrations, SDK reference, operator guide, agent guide; rendered with diagrams at esim.modelmarket.dev/kit.
- **Landing** with the coverage globe at esim.modelmarket.dev (and GitHub Pages); the example shop moves to esim-shop.modelmarket.dev, the guides stay at esim.modelmarket.dev/kit.
- A live test order against eSIM Access: bought, read and cancelled; the same payment twice found the same profile.

## 0.1.0 — 2026-10-14

- The storefront: a page per country in five languages; USDC and USDT on seven EVM networks, USDT on Tron, USDC on Solana, USDT and TON on TON, cards through Stripe.
- The seller node for agents: `esim.quote` and `esim.status` signed, `esim.order` over x402.
- `docker compose` with Caddy, the federation node, demo mode.
