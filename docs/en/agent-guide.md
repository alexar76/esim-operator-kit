# Agent guide

This guide is for developers of AI agents that book trips, plan travel or run errands. Your agent
can find a travel data eSIM for a country, buy it with one x402 payment in USDC on Base, and hand the
traveller a QR code. No account, no API key, no checkout page.

Every seller running the [eSIM operator kit](../../README.md) answers the same three calls at
`https://<seller domain>/agents/`. To try them now, use the demo node
`https://modelmarket.dev/providers/esim`: it quotes live wholesale-backed prices and refuses orders
with `demo_mode`.

Other documents: [overview](../../README.md) · [operator guide](operator-guide.md) · [onboarding](rails.md) · [integrations](integrations.md) · [SDK](sdk.md)

## The three capabilities

| Capability | Route | Price | Does |
|---|---|---|---|
| `esim.quote@v1` | `POST /agents/quote` | free | Offers covering a country, cheapest first. Regional and global plans that include the country count too. |
| `esim.order@v1` | `POST /agents/order` | the offer's price, x402 | Buys one eSIM. Answers with the activation code, QR link, install link, ICCID and a status token. |
| `esim.status@v1` | `POST /agents/status` | free | State, data used, expiry, and the activation code again, for the holder of the status token. |
| refund | `POST /agents/refund` | free | Refunds an unused eSIM to the address that paid, for the holder of the status token. |

`GET /agents/listing.json` describes all three, with the seller's public key.

## 1. Find a seller

- **You know the seller.** Use `https://<domain>/agents/`.
- **Through an AIMarket hub.** Connect the hub's MCP server (`https://modelmarket.dev/mcp`) and call `market_search` with an intent such as `"travel eSIM data plan for France"`. Matches for `esim.quote@v1` give `product_id` and `source_hub`. Call `market_invoke` with them and the quote input: the answer is the same as below, and it names the seller's order URL. The hub lists sellers whose nodes it has admitted. The payment for the eSIM never goes through the hub: you pay the seller directly.

## 2. Get offers

```bash
curl -s -X POST https://modelmarket.dev/providers/esim/quote \
  -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

| Input | Type | |
|---|---|---|
| `country` | string, required | ISO 3166-1 alpha-2 code of the destination: `FR`, `JP`, `US`. |
| `min_gb` | number | Smallest data allowance. |
| `min_days` | integer | Shortest validity. |
| `max_usd` | number | Highest price. |
| `limit` | integer, 1 to 50 | How many offers. |

Always send `min_gb` and `min_days` from the trip. Without them, the cheapest offer is often a 0.5 GB one-day plan.

The answer (one offer, lists shortened):

```json
{
  "success": true,
  "result": {
    "seller": { "name": "modelmarket.dev demo seller", "product_id": "esim-modelmarket", "demo": true },
    "offers": [
      {
        "offer_id": "EU-33_3_15",
        "name": "Europe (33 areas) 3GB 15Days",
        "coverage": { "kind": "region", "countries": ["NO", "DE", "BE", "FI", "…"] },
        "data_bytes": 3221225472,
        "data_gb": 3,
        "days": 15,
        "speed": "3G/4G/5G",
        "networks": [{ "country": "Austria", "operators": [{ "name": "A1.net", "type": "5G" }] }],
        "top_up": true,
        "unused_valid_days": 180,
        "price": { "usd": "2.03", "currency": "USDC" },
        "usd_per_gb": 0.68
      }
    ],
    "order": { "url": "https://modelmarket.dev/providers/esim/order", "method": "POST", "payment": "x402, USDC on Base" },
    "catalogue_at": "2026-10-14T10:32:44.619Z"
  }
}
```

- `coverage.kind` is `country`, `region` or `global`.
- `unused_valid_days`: the eSIM must be installed and first used within this many days of purchase.
- `networks` lists the operators per country and their best network type.
- `order.url` is where this offer is bought.

## 3. Check the seller's signature (optional)

Free answers carry `X-Provider-Signature`: an Ed25519 signature, base64, over canonical JSON of
`{capability_id, product_id, input_sha256, result}`. The canonical form has sorted keys, no spaces,
and non-ASCII characters as they are. `input_sha256` is the hex SHA-256 of the canonical input. The
public key and `product_id` are in `/agents/listing.json`. Hubs check this signature themselves.
Check it yourself when you call a seller directly:

```js
import { createHash, createPublicKey, verify } from "node:crypto";

const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);

export function signedBySeller({ pubkey, capabilityId, productId, input, result, signature }) {
  const input_sha256 = createHash("sha256").update(canonical(input)).digest("hex");
  const bytes = Buffer.from(canonical({ capability_id: capabilityId, product_id: productId, input_sha256, result }));
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubkey, "base64")]);
  return verify(null, bytes, createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(signature, "base64"));
}
```

## 4. Buy

`POST <order.url>` with `{"offer_id": "<from the quote>"}`. The first answer is
`402 Payment Required` with x402 v2 terms: scheme `exact`, network `eip155:8453` (Base), USDC, the
offer's price, paid to the seller. Any x402 v2 client pays it. Your wallet signs an EIP-3009
authorization and pays no gas. In TypeScript with the x402 packages:

```bash
npm i @x402/fetch @x402/evm viem
```

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);   // a wallet with USDC on Base

// Keep the payment header the wrapper sends: a retry must carry the same payment, not a new one.
let paidHeaders = null;
const keepPayment = (input, init) => {
  const req = new Request(input, init);
  if (req.headers.has("PAYMENT-SIGNATURE")) paidHeaders = new Headers(req.headers);
  return fetch(req);
};
const payingFetch = wrapFetchWithPaymentFromConfig(keepPayment, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});

export async function buyEsim(orderUrl, offerId) {
  const body = JSON.stringify({ offer_id: offerId });
  let res = await payingFetch(orderUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  // 503 allocation_pending: the eSIM is ordered but not ready yet. Same payment, a little later.
  for (let i = 0; i < 6 && res.status === 503 && paidHeaders; i++) {
    await new Promise((r) => setTimeout(r, 1000 * Number(res.headers.get("retry-after") || 20)));
    res = await fetch(orderUrl, { method: "POST", headers: paidHeaders, body });
  }
  if (res.status === 402) {   // a refused payment says why in the x402 header, not in the body
    const terms = res.headers.get("payment-required");
    throw new Error(`402 ${terms ? JSON.parse(Buffer.from(terms, "base64").toString("utf8")).error : "payment required"}`);
  }
  const answer = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${answer.error}: ${answer.message}`);
  return answer.result;
}
```

**What you are charged for.** The seller verifies the payment, buys the eSIM, and settles the payment only after the eSIM exists. A refused order costs nothing. An order still being prepared (`503 allocation_pending`) is not charged yet; the same payment sent again collects the same eSIM, never a second one. A payment that fails to settle cancels the eSIM.

The answer:

```json
{
  "success": true,
  "result": {
    "order_no": "B26101410460022",
    "esim_tran_no": "26101410460022",
    "iccid": "8985…",
    "activation_code": "LPA:1$…",
    "qr_code_url": "https://…",
    "install_url": "https://…",
    "apn": "internet",
    "expires": "2027-04-12T10:46:24+0000",
    "status_token": "…",
    "offer": { "offer_id": "TR_0.5_1", "name": "Turkey 500MB 1Day", "…": "…" }
  }
}
```

**The activation code is a secret.** Anyone who has it can install the eSIM. Give it, the QR link
and the install link to the traveller only. Do not log them, and do not put them in a shared chat,
a ticket or a calendar event. Keep `esim_tran_no` and `status_token` to check the eSIM later.

## 5. Errors

| Status | `error` | Meaning | Do |
|---|---|---|---|
| 400 | `unknown_offer` | The `offer_id` is not in the catalogue (anymore). | Quote again. |
| 402 | (x402 terms) | Payment required, or the payment was refused: wrong amount, not enough USDC, expired. | Pay, or fix the wallet. |
| 402 | `self_send_not_allowed` | The paying wallet is the seller's own address: the facilitator refuses a payment to oneself. | Pay from another wallet. |
| 402 | `invalid_exact_evm_insufficient_balance` | The paying wallet holds less USDC on Base than the price. | Top the wallet up. |
| 403 | `demo_mode` | A demo node. It sells nothing. | Use a seller that sells. |
| 409 | `supplier_<code>` | The wholesaler refused the order: plan withdrawn, price changed. You were not charged. | Quote again. |
| 503 | `allocation_pending` | Ordered, not ready yet. Not charged yet. | Same payment after `Retry-After` seconds (example above). |
| 503 | `catalogue_unavailable`, `payments_off` | The seller cannot sell right now. | Another seller, or later. |
| 500 | `internal_error` | The order failed. You were not charged. | Later, or another seller. |

### A real purchase, step by step

A refused payment says why in the `error` field of the `PAYMENT-REQUIRED` header (base64 JSON), not
in the body. The kit's first agent purchase, on 2026-10-14 against a private test node, shows both
answers: paid from the seller's own wallet, it was refused; paid from another wallet, it was
delivered in seconds and settled on Base.

```text
$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
offer    TR_0.5_7 — Turkey 500MB 7Days — 0.31 USDC
payer    0x1218…Ad0a          ← the seller's own wallet
402 payment refused: self_send_not_allowed (a payment was attached)

$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
payer    0x9d24…66eF          ← another wallet
delivered  esim_tran_no 26101413070046 · iccid 8997… · apn internet
activation LPA:1$rsp-eu.s… (the traveller's secret)
settled    0xe61f194b44148c5aba91bde2dbe106d2b7e5317233881a8bd245b994cc280982
```

`rails/examples/agent-buy.mjs` is this buyer, ready to run. It quotes, shows the price, and pays
only with `--yes`:

```bash
cd rails
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json         # quotes every seller the hub lists
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json --yes   # buys from the cheapest seller that sells
node examples/agent-buy.mjs https://<seller>/agents TR --key-file ~/agent-wallet.json --yes        # one seller, no hub
```

| Option | What it does |
|---|---|
| `--hub <url>` | Finds sellers through this hub and skips the ones in demo mode. |
| `--key-file <file>` | The agent's wallet, `{"private_key": "0x…"}`. Never printed. `AGENT_PRIVATE_KEY` works too. |
| `--min-gb`, `--days` | The trip's needs. |
| `--max-usd` | The most one payment may cost, 1 by default. The x402 client refuses to sign more. |
| `--refund` | Asks for the money back right after the delivery: for a test. |
| `--no-share` | Keeps the purchase from the hub: no receipt goes to it. |

Keep the agent's key in its own wallet with a small balance, in a key file only you can read
(`chmod 600`), and never paste a private key into a chat, a ticket or a document. A purchase with
this command from a coding agent's terminal, with its refund and all transactions, is
[case 3](cases.md).

### The receipt: show the hub you got it

Every delivery carries `receipt` and `receipt_signature`: what the seller signs to say it delivered,
with no secret of the eSIM in it (the fields are in the [cases](cases.md), section 11.4). If you
found the seller through a hub, bring both to that hub with the payment's transaction. The hub checks
the signature and the transfer on chain, and counts one confirmed delivery for the seller:

```bash
curl -s -X POST https://modelmarket.dev/ai-market/v2/reputation/deliveries -H 'content-type: application/json' \
  -d '{"receipt": {…}, "signature": "<receipt_signature>", "transaction": "0x<the payment>"}'
```

```json
{"recorded": true, "seller": {"source_hub": "https://esim.modelmarket.dev", "product_id": "esim-modelmarket"},
 "kind": "delivery", "deliveries_30d": {"confirmed": 2, "distinct_buyers": 2, "refunded": 1}}
```

A fresh transfer needs a few seconds of confirmations: until then the answer is `422`, so try again
after ten seconds. The same transaction twice gets `recorded: false`, and receipts older than 30 days
are refused. Search results carry the same `deliveries_30d` on each of the seller's listings: how
many deliveries and refunds buyers confirmed in 30 days, and how many distinct wallets confirmed them.
Bringing receipts is your choice: the hub learns that this seller delivered, never the amount or your
address in the clear.

## 6. Help the traveller install it

- **Another screen shows the QR code** (`qr_code_url`), and the phone scans it. iPhone: Settings → Mobile Service → Add eSIM. Android: usually Settings → Network & internet → SIMs → Add eSIM.
- **On the phone itself**: `install_url` opens a page with the QR code and install instructions. Or the activation code is typed in by hand: "enter details manually" in the same menu.
- The phone must support eSIM and must not be locked to a carrier.
- Install before departure, on Wi-Fi. On arrival, switch mobile data to the eSIM line and turn data roaming on for that line. `apn` is the access point name, if the phone asks.
- Validity counts from the first connection in the coverage area, for most plans. `unused_valid_days` bounds how long the eSIM can wait.

## 7. Check usage

```bash
curl -s -X POST https://<seller>/agents/status -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101410460022","status_token":"…"}'
```

The answer has `state` (the wholesaler's own value: `GOT_RESOURCE` means not installed yet; others include `IN_USE`, `USED_UP` and `CANCEL`), `installed`, `data_used_bytes`, `data_total_bytes`, `activated`, `expires`, and the delivery fields again. A wrong token gets `404 not_found`, the same as an unknown eSIM.

## 8. Get a refund

While the eSIM is not installed and has spent no data, the payer can have it cancelled and the price paid back, with the same two values:

```bash
curl -s -X POST https://<seller>/agents/refund -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101505200012","status_token":"…"}'
```

`status` is `refunded` with the transaction of the USDC paid back to the address that paid, or `due` when the seller pays it by hand. An installed or used eSIM gets `409 in_use`. The seller refunds once per order, never more than the price. A refunded answer carries a refund receipt (`receipt`, `receipt_signature`): bring it to the hub with the refund's transaction, the same way as the delivery receipt. The [cases](cases.md) page shows real ones, from a purchase by an agent to the refund, with all transactions.

## 9. Good manners

- Quote with the trip's real needs, and show the traveller the price, data and days before you pay.
- One `offer_id`, one payment, one order. To buy two eSIMs, make two payments.
- A seller refreshes its catalogue every 15 minutes. If a price changed after your quote, the 402 asks the new amount, or the wholesaler refuses the order (`409`, nothing charged). The 402 states the amount: an x402 client can refuse to pay more than the quote.
