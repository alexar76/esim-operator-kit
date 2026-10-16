# Operator guide

This guide takes you from an empty server to your first sale, then covers the daily work: orders,
refunds, balance, backups, updates. Plan an hour for the setup. Most of that hour is waiting for the
wholesale account and the DNS record.

Other documents: [overview](../../README.md) · [agent guide](agent-guide.md) · [onboarding](rails.md) · [integrations](integrations.md) · [SDK](sdk.md)

## The short way

Once you have the server, the domain and the wholesale account (sections 2 to 4), one command does the rest of the setup in demo mode:

```bash
git clone https://github.com/alexar76/esim-operator-kit.git && cd esim-operator-kit
./onboard.sh            # store, seller node for agents, federation node; asks only for what is missing
./onboard.sh --hub      # the same with your own hub: own-hub.md
```

It asks for your domain, the store's name, an id for your offers and the wholesale keys (typed in hidden, written to `secrets/`, never printed). Then it starts everything in demo mode, waits for HTTPS, checks the seller node, writes `node.toml`, runs the admission check other hubs will run on you, and asks before joining the federation. What is left after it: payment addresses and keys (section 8), `DEMO_MODE=0`, then the test order (section 10). Run it again after any change: it does only what is missing. `./onboard.sh --check` changes nothing and says what is ready. The sections below are what it does, for anyone who would rather do it by hand.

**Already running nginx or another web server on ports 80 and 443?** The command notices and asks. With nginx it puts the kit behind it: it publishes the kit's services on `127.0.0.1` (`docker-compose.override.yml`, the kit's Caddy stays off), writes the site for your domain, and gets the certificate with certbot, each after asking. With any other server it prints the routes to add. `PROXY` in `.env` remembers the choice.

## 1. What you are setting up

```text
            https://esim.example.com
                      │
                   Caddy (80, 443, Let's Encrypt)
      ┌───────────────┼──────────────────────────────┐
      │               │                              │
   store          rails (/agents/*)              node (/.well-known/ai-market.json, /ai-market/*)
 people buy      agents buy over x402            hubs find your offers
      │               │
      └───── your eSIM Access balance ─────┘   payments go to your own wallets
```

- **store** is the website: pages per country, checkout, the order page with the QR code.
- **rails** is the seller node for AI agents: free quotes, paid orders over x402.
- **node** is `aimarket node`. It tells AIMarket hubs what you sell so that agents can find you. Start it last, once everything else works.
- **Caddy** gets and renews the HTTPS certificate and routes requests to the three services.

Both store and rails buy from the same wholesale account. Neither one holds money: buyers pay to your
addresses, and the kit only reads the networks to see the payments arrive.

## 2. Before you start

| You need | Notes |
|---|---|
| An eSIM Access account | Sign up at [esimaccess.com](https://esimaccess.com). Step 3. |
| $50 or more on its balance | The first top-up is at least $50 (card, PayPal or Alipay; bank transfer from $3,000). |
| A Linux server | Docker Engine with the compose plugin, a public IPv4 address, ports 80 and 443 open. 1 vCPU and 1 GB of memory are enough. |
| A domain or subdomain | For example `esim.example.com`, with an A record pointing at the server. |
| Wallet addresses | EVM (one address for all seven EVM networks), Tron, Solana, TON. Any subset will do. |
| Terms and a privacy policy | Two public pages. eSIM Access expects every reseller's site to link them. |
| Optional: a Coinbase Developer Platform key | Enables gasless USDC on Base for people, and agents' x402 orders. Step 8. |
| Optional: Stripe | Enables cards. Step 8. |

## 3. The wholesale account

1. Sign up at [esimaccess.com](https://esimaccess.com) and confirm your email.
2. Top up the balance (in the console: balance, then top up). The minimum is $50. Every eSIM you sell is paid from this balance at the wholesale price, so it is your stock, not a fee.
3. Open the developer (API) section of the console. It shows two values: the **AccessCode** and the **SecretKey**. Treat the SecretKey like a password.

There is no sandbox: every API order is real. Two ways to test cheaply:

- Order the cheapest plan (a few tens of cents), then cancel the unused profile. Unused profiles are refunded to the balance.
- Before your first top-up, ask support for a small test credit: Customer Support, then Submit ticket, type "Top Up". Explain that you are integrating the API and need a few dollars for test orders.

## 4. The server and the domain

1. Create an A record for your domain pointing at the server's IPv4 address. Check it from your computer:

```bash
dig +short esim.example.com
```

2. Install Docker on the server ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)) and check that compose works:

```bash
docker compose version
```

3. Open ports 80 and 443 in the server's firewall and in your hosting provider's panel. Let's Encrypt checks port 80 before it issues the certificate.

## 5. Get the kit and configure it

```bash
git clone https://github.com/alexar76/esim-operator-kit.git
cd esim-operator-kit
cp .env.example .env
nano .env
```

| Setting | What to put |
|---|---|
| `DOMAIN` | Your domain, without `https://`. |
| `STORE_NAME` | The name buyers see in the header, the title and wallet prompts. |
| `PRODUCT_ID` | A short slug for your offers in the federation, for example `esim-mytravel`. Letters, digits, dashes. |
| `STORE_CONTACT` | The email buyers write to. It is shown in the footer. |
| `STORE_TERMS_URL`, `STORE_PRIVACY_URL` | Your terms and privacy policy. They are linked in the footer. |
| `MARGIN_PCT` | Your markup on the wholesale price, in percent. `100` doubles it. |
| `MIN_MARGIN_USD` | The smallest margin per eSIM, in dollars. Cheap plans get at least this much on top. |
| `PRICES_FILE` | Optional: your own price list over the formula, `/config/prices.csv`. See below. |
| `DEMO_MODE` | `1` shows a banner and takes no payment. `0` sells. Keep `1` until step 10. |
| `PAY_TO_EVM`, `PAY_TO_TON`, `PAY_TO_TRON`, `PAY_TO_SOLANA` | Your receiving addresses. Leave a line empty to turn that network off. |
| `EVM_CHAINS` | Which EVM networks to offer, as chain ids: `8453` Base, `1` Ethereum, `42161` Arbitrum, `10` OP, `137` Polygon, `56` BNB Chain, `43114` Avalanche. |
| `EVM_RPC_<chain id>`, `SOLANA_RPC` | Optional: your own RPC endpoints. The public ones are rate limited. |
| `SUPPLIER` | Where the eSIMs come from: `esimaccess` (default), `airalo`, `esimgo`, or `http` for your own system. See [integrations](integrations.md). |
| `WEBHOOK_URL`, `WEBHOOK_SECRET_FILE` | Optional: every order's status, signed, to your CRM, billing, Telegram or a sheet. See [integrations](integrations.md). |
| `REFUND_KEY_FILE`, `REFUND_MAX_USD`, `REFUND_DAILY_MAX_USD` | Optional: automatic refunds of unused eSIMs to agents, from a wallet you choose. See [cases](cases.md). |

**How the price is made.** Price = wholesale × (1 + `MARGIN_PCT`/100), but never less than wholesale + `MIN_MARGIN_USD`. It is rounded up to the cent. With the defaults (100 % and $1.00), France 1 GB for 7 days costs $0.70 wholesale and sells for $1.70. A 20 GB plan at $9.00 wholesale sells for $18.00. Retail eSIM shops typically ask $4 to $8 for the small plans, so you have room.

**Your own price list.** If you already have retail prices, or want a different margin for some countries, put them in a price list. The formula above prices every plan the list does not pick.

```bash
cp config/prices.example.csv config/prices.csv
nano config/prices.csv                   # then uncomment PRICES_FILE=/config/prices.csv in .env
docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv
```

An example:

```csv
match,gb,days,price_usd,margin_pct,min_margin_usd
TR,1,7,4.50,,
TR,,,,80,
JP,,,,,2.00
global,,,,60,
US_0.1_7,,,off,,
```

| Column | What it says |
|---|---|
| `match` | Which plans: an offer id (`TR_1_7`, as the quote shows it), a country (`TR`: that country's own plans), `region` or `global` (multi-country plans), or `*` (every plan). |
| `gb`, `days` | Optional, beside a country, `region`, `global` or `*`: only plans of that size and length. `gb` matches give or take 10 %, since suppliers count a gigabyte as 1000 or 1024 MB. |
| `price_usd` | A fixed price, for example `4.50`, or `off`: the plan is not sold. |
| `margin_pct`, `min_margin_usd` | Or the formula with these numbers for the picked plans. One left empty keeps the value from `.env`. |

The most specific line wins: an offer id over a country, a country over `region` and `global`, those over `*`, then the line that fills more of `gb` and `days`; of two equally specific lines, the higher one. A fixed price never sells at a loss: if the wholesale cost rises above it, the formula prices that plan until you change the list, and the price check in step 7 says so. The file is read at start, and a list with a mistake stops the start with its line number, so a typo never sells at a price you did not mean. Spreadsheet exports work: semicolons and decimal commas are read. If your billing holds the prices, export them to this file on a schedule. Apply a change with `docker compose restart store rails`.

**Addresses only.** Every `PAY_TO_*` is an address you receive at. The kit never needs a private key or a seed phrase. If a guide or a person asks you to put one in `.env`, it is wrong.

## 6. Put the keys in place

The keys live in `secrets/`, one value per file. The folder is git-ignored and mounted read-only into the containers. Type the values in without them landing in your shell history:

```bash
cd ~/esim-operator-kit
umask 077
printf 'AccessCode: '; read -rs v; printf %s "$v" > secrets/esimaccess_access_code; echo
printf 'SecretKey: '; read -rs v; printf %s "$v" > secrets/esimaccess_secret_key; echo
unset v
```

The containers run as user 1000, so give that user the key files and the data folders:

```bash
mkdir -p data/store data/rails data/node data/caddy
sudo chown 1000:1000 secrets/*
sudo chown -R 1000:1000 data/store data/rails data/node
ls -l secrets
```

The folder itself stays yours, so you can add files later. Each new key file needs the same `sudo chown 1000:1000` and `chmod 600`.

[secrets/README.md](../../secrets/README.md) lists every optional file: the CDP key, the tonapi and TronGrid keys, and the Stripe keys.

## 7. Start in demo mode

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail 30 store rails
```

The first build takes a few minutes. Then check three things:

```bash
curl -s https://esim.example.com/agents/healthz
curl -s -X POST https://esim.example.com/agents/quote -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

- The health answer says `"ok":true` and gives the number of offers, about 1,700 with eSIM Access. `"demo":true` is expected for now.
- The quote lists real plans at your prices.
- `https://esim.example.com/` shows your store with the demo banner. Open a country and go through the checkout: every payment step answers "demo mode".

If the health answer says `"ok":false`, the wholesale keys are wrong or unreadable. See section 14.

**Check your prices.** This prints your balance and the top offers for any countries, at your prices, wholesale price beside each. With a price list it also shows what each line priced, and any line that picks no plan:

```bash
docker compose exec -T rails node scripts/catalog.mjs FR ES IT US JP TH
```

Change `MARGIN_PCT` or `MIN_MARGIN_USD` in `.env` and apply it with `docker compose up -d`. After editing the price list, `docker compose restart store rails`.

## 8. Payments

Each method is on once its address (and key, where one is needed) is set. Turn on the ones your
buyers use. USDT on Tron is the most common way to pay in crypto; USDT and USDC on EVM networks and USDT on TON follow.

| Method | Set | How the buyer pays | How the store confirms it |
|---|---|---|---|
| USDC on Base, gasless | `PAY_TO_EVM` + `secrets/cdp_api_key.json` | Signs one message in a browser wallet and pays no gas. | The CDP facilitator settles the signature. The eSIM is delivered first, then the payment settles; an uncertain result is held for reconciliation. |
| USDC / USDT on 7 EVM networks | `PAY_TO_EVM` (+ `EVM_CHAINS`) | Sends the transfer from a browser wallet, or from any wallet or exchange and pastes the transaction hash. | Reads the receipt: a transfer of that token to you, of at least the price, newer than the order. It waits for confirmations: 3 on Ethereum and BNB Chain, 10 on Polygon, 1 elsewhere. One transaction pays one order. |
| USDT on Tron | `PAY_TO_TRON` (+ `secrets/trongrid_key`) | Sends the exact amount shown, from TronLink on the page or from any wallet. | Each order asks for the price plus a few millionths of a dollar (at most $0.0099 more). That exact amount identifies the order among your confirmed USDT transfers. |
| USDC on Solana | `PAY_TO_SOLANA` (+ `SOLANA_RPC`) | Opens the Solana Pay link or scans its QR code (Phantom, Solflare, Backpack). | Each order has its own reference key, which the wallet adds to the transfer. The store finds the transaction by it. |
| USDT or TON on TON | `PAY_TO_TON` (+ `secrets/tonapi_key`) | Connects Tonkeeper or another wallet through TON Connect, or pays by hand with the comment shown. | Finds the transfer by the order's comment through tonapi.io. |
| Cards | `secrets/stripe_secret_key` + `secrets/stripe_webhook_secret` | Stripe Checkout. | The Stripe webhook. |

A pushed payment (every method except gasless Base and cards) is looked for during 24 hours after
the order is made.

**Coinbase Developer Platform key.** It enables gasless USDC on Base for people and the x402 orders from agents. Without it, the store still takes Base USDC as a plain transfer, but the agent node takes no orders.

1. Sign in at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com) and create a project.
2. API Keys: create a secret API key and download its JSON file.
3. Copy the file to `secrets/cdp_api_key.json` (it holds `id` and `privateKey`), then run `sudo chown 1000:1000 secrets/cdp_api_key.json && sudo chmod 600 secrets/cdp_api_key.json` and `docker compose up -d`.

**Stripe.** In the Stripe dashboard, add a webhook endpoint `https://<your domain>/api/stripe/webhook` with the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Put the secret key (`sk_live_…`) in `secrets/stripe_secret_key` and the endpoint's signing secret (`whsec_…`) in `secrets/stripe_webhook_secret`.

**Rate limits.** The public TronGrid, tonapi and RPC endpoints work for a small store. Once you have regular sales, add a free TronGrid key and a tonapi key, and point `EVM_RPC_<id>` and `SOLANA_RPC` at your own provider.

## 9. Agents and the federation

The rails node already answers agents at `https://<your domain>/agents/`. To let agents find you by
searching a hub, describe your node to the federation and announce it.

1. Write `node.toml` from your live catalogue. Use your own name, domain and `PRODUCT_ID`:

```bash
docker compose exec -T rails node scripts/node-toml.mjs \
  --name "My Travel eSIM" --url https://esim.example.com \
  --product esim-mytravel --upstream http://rails:9490 > node.toml
head -20 node.toml
```

2. Start the node:

```bash
docker compose --profile federation up -d --build node
curl -s https://esim.example.com/.well-known/ai-market.json | head -c 400; echo
```

3. Check it the way a hub will, then announce it:

```bash
docker compose exec node aimarket doctor --url https://esim.example.com
docker compose exec node aimarket node knock --config /node/node.toml --hub https://modelmarket.dev
```

The hub calls `esim.quote` with a real country before it lists you. Once listed, an agent that searches the hub for "eSIM France" gets your offers. Payment never goes through the hub: the agent pays your node over x402, straight to your wallet.

`data/node/` holds the node's signing key, which is its identity in the federation. Back it up. Rerun step 1 when the catalogue gains countries.

**Confirmed deliveries.** Every order and every refund your node answers carries a receipt signed with the node's provider key (`data/rails/provider_ed25519.pem`, the key that signs every free answer), and the `node.toml` of step 1 publishes its public half as `provider_pubkey`. A buyer that found you through a hub can bring the receipt and its transaction to that hub; the hub checks both on chain and counts a confirmed delivery. Your listings then show `deliveries_30d` (deliveries and refunds buyers confirmed in 30 days, and how many distinct buyers), and the hub's trust score for you counts one success per distinct buyer. Nothing to do beyond step 1; a `node.toml` written before 15 October 2026 has no key, so rerun step 1. Back the provider key up with the rest of `data/rails/`: receipts signed with a lost key no longer match your listing. The [cases](cases.md), case 3, show it with real buyers.

Check that the key is published:

```bash
curl -s https://esim.example.com/ai-market/v2/manifest | grep -o provider_pubkey | head -1    # provider_pubkey
```

This needs `aimarket-hub` 3.15.27 or later in the `node/` image, which the kit installs. An older node leaves the key out, and the hub then answers your buyers' receipts with `404`.

**Your own hub instead of the node.** `./onboard.sh --hub` runs a whole hub on your domain: it lists your offers itself, gives agents your own address for search and MCP, and federates with the other hubs. It keeps your domain's identity if you ran the node before. See [your own hub](own-hub.md).

## 10. The test order, then go live

1. In `.env`, set `DEMO_MODE=0` and check the `PAY_TO_*` addresses once more, character by character.
2. Apply it:

```bash
docker compose up -d
curl -s https://esim.example.com/agents/healthz
```

`"demo":false` should show. `"paid_orders":true` shows when the CDP key and `PAY_TO_EVM` are set.

3. Buy the cheapest plan for a country on your own store, with a wallet of yours that is not the store's address, on the network you expect buyers to use most. The order page should show the QR code within a minute. Do not pay from the `PAY_TO_EVM` wallet itself: the x402 facilitator refuses a payment from an address to itself (`self_send_not_allowed`).
4. Check the payment in your wallet, and the order in the eSIM Access console.
5. If you do not want to keep the eSIM, cancel the unused profile in the eSIM Access console. The wholesale price returns to your balance. The payment you made went to your own wallet anyway.

Test the agent channel the same way, with a small test wallet that holds a dollar of USDC on Base
(not your `PAY_TO_EVM` wallet). The command quotes, shows the price, and pays only with `--yes`:

```bash
cd rails && node examples/agent-buy.mjs https://esim.example.com/agents TR --key-file ~/test-wallet.json --yes --refund
```

The key file holds `{"private_key": "0x…"}` and is never printed. The answer names the eSIM
(`esim_tran_no`) and the settlement transaction on Base. `--refund` asks for the money back right away:
the node cancels the unused eSIM at the supplier (the cost returns to your balance) and, with refunds on
([cases](cases.md), section 7), pays the test wallet back; without them the refund is recorded as due.
Once a hub lists you, run the same with `--hub https://modelmarket.dev` in place of your URL: that is
the path agents take, receipts included. The [agent guide](agent-guide.md) shows a real run, a refusal
included.

Do the same for each network you turned on. Then you are live.

## 11. Daily work

**Orders.** The store keeps them in `data/store/orders.json`. List the ones that need you:

```bash
sudo jq -r '.[] | select(.status=="refund_due" or .status=="underpaid")
  | [.created_at, .id, .status, .method, (.price_cents/100), .payment.ref, (.payment.payer // "-"), (.error // "")] | @tsv' \
  data/store/orders.json
```

| Status | Meaning | What to do |
|---|---|---|
| `awaiting_payment` | The order is made and nothing has arrived yet. | Nothing. |
| `delivered` | Paid, and the eSIM is with the buyer. | Nothing. |
| `refund_due` | Paid, but the wholesaler did not deliver: the balance ran out, or the plan was withdrawn. | Refund the buyer to `payment.payer` on the same network, or top up and sell them the plan again by hand. |
| `underpaid` | A payment arrived below the price. | Refund it, or ask the buyer to send the difference and deliver by hand. |
| `expired` | Nothing arrived within 24 hours. | Nothing. A payment that arrives later is not matched; you will see it in your wallet with no order. |

Buyers write to `STORE_CONTACT`. Ask them for the order number from their page address (`/o/<number>`). Do not ask for the full link: it contains their token.

**Balance.** Keep the wholesale balance above a few days of sales. When it cannot cover an order, the checkout says the plan is "temporarily unavailable" instead of taking the money. Check it with:

```bash
docker compose exec -T rails node scripts/catalog.mjs | head -1
```

**Logs.**

```bash
docker compose logs -f --tail 100 store rails
```

The logs never contain an activation code or a key.

**Backups.** Back up `data/` and `secrets/` daily, somewhere other than the server:

- `data/store/`: the orders. Lose them and buyers' order pages stop working.
- `data/rails/`: agents' orders, their status-token key, and the node's provider key. Both folders also keep the last catalogue (`catalog-snapshot.json`): if the supplier stops answering, it is served for up to six hours, in demo mode for as long as needed.
- `data/node/`: the federation identity.
- `data/hub/`: your own hub, if you run one: its keys, database, settings and admin token.
- `data/caddy/`: certificates. They can be issued again, but backing them up avoids hitting Let's Encrypt's limits.

**Updates.**

```bash
git pull
docker compose up -d --build
docker compose --profile federation up -d --build node    # if you run the federation node
```

Read the release notes before you update a store that sells.

## 12. Agents' orders

Agents buy through `POST /agents/order` (see the [agent guide](agent-guide.md)). The node verifies the x402 payment, buys the profile, and settles only after the profile exists. If settlement is uncertain, it retains the profile for reconciliation; do not charge the buyer again. Agents' orders are recorded in `data/rails/orders.json`, without activation codes. The USDC arrives in `PAY_TO_EVM` on Base.

**Refunds.** An agent can ask for a refund of an eSIM it has not installed: `POST /agents/refund` with the eSIM's number and status token. The node cancels the eSIM at the wholesaler, which refunds your balance, and pays the price back to the address that paid. Paying back is automatic only when you give the node a refund wallet (`REFUND_KEY_FILE`, capped by `REFUND_MAX_USD` and `REFUND_DAILY_MAX_USD`); without it the refund is recorded as due and the `agent_order.refund_due` webhook tells you to pay it. Setup, rules and a real refund with its transactions: [cases](cases.md).

## 13. Law, taxes and terms

This is not legal or tax advice. Ask an accountant in your country before you sell.

- **You are the seller.** Your buyers buy from you, on your terms. eSIM Access is your supplier. Refunds, support and taxes are yours.
- **Terms and privacy.** eSIM Access expects your site to publish terms of sale and a privacy policy. Set `STORE_TERMS_URL` and `STORE_PRIVACY_URL`. The terms should cover refunds (an installed eSIM usually cannot be refunded), device compatibility (an unlocked phone that supports eSIM), and when validity starts.
- **VAT in the EU.** Telecommunication services sold to consumers are taxed in the buyer's country. The One-Stop Shop (OSS) lets you declare all EU countries in one return. Outside the EU, rules differ.
- **Crypto.** Whether you may take crypto, and how you book it, depends on your country. Keep the order records: the store has every payment's network, transaction and amount.
- **Personal data.** The store asks buyers for nothing: no name, no email. It keeps the order (plan, price, method) and the payment (transaction and payer address). A blockchain address can still be personal data under the GDPR, so mention it in your privacy policy.

## 14. Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| The browser says the certificate is invalid | DNS does not point here yet, or port 80 is closed | `dig +short <domain>`, open port 80, then `docker compose restart caddy` and read `docker compose logs caddy`. |
| `healthz` shows `"ok":false` or the store shows no countries | The wholesale keys are wrong or user 1000 cannot read them. The logs say `catalogue not loaded yet: <code>`. | `sudo rm secrets/esimaccess_*`, write them again as in step 6, then `docker compose restart store rails`. |
| `EACCES` or `permission denied` in the logs | The data folders are not owned by user 1000 | `sudo chown -R 1000:1000 data/store data/rails data/node` |
| The checkout says the plan is "temporarily unavailable" | The wholesale balance does not cover the plan | Top up eSIM Access. |
| Every payment answers "demo mode" | `DEMO_MODE=1` | Step 10. |
| A network is missing at checkout | Its `PAY_TO_*` is empty | Check `.env`, then `docker compose up -d`. |
| The store restarts again and again | A `PAY_TO_*` is not a valid address: the store refuses to start with one | `docker compose logs store` names it. Fix `.env`. |
| A Tron payment is not found | The amount was not exact, often because an exchange deducted its fee from it | Find the transfer in your wallet and refund it, or deliver by hand. Tell buyers to send the exact amount from a wallet. |
| A TON payment is not found | The comment was missing or changed | Same as above. With TON Connect the wallet fills the comment in. |
| `aimarket doctor` reports a private address | `url` in `node.toml` is not your public domain | Write `node.toml` again (step 9) with `--url https://<domain>`. |
| `node` does not start: `node.toml` is a directory | Compose created it because the file did not exist | `rmdir node.toml`, write it (step 9), start again. |
| A test payment is refused: `402 … self_send_not_allowed` | You paid from the store's own `PAY_TO_EVM` address; the facilitator refuses a payment to oneself | Pay from another wallet. |
| The node logs `bazaar … resource must start with 'https://'` | `PUBLIC_URL` is http (a local test) | Nothing to do on a test node; in production `PUBLIC_URL` is your https domain. |
| The store or the node stops at start: `…prices.csv, line N: …` | A line of the price list does not read | Fix that line; `docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv` checks the whole file. Then `docker compose restart store rails`. |
