#!/usr/bin/env node
// An AI agent's side of an eSIM purchase, end to end, the way any agent outside the kit would do it:
// find sellers through a hub (or ask one seller directly), skip the ones in demo mode, take the cheapest
// offer, pay over x402 (a USDC authorization on Base, no gas) with the offer's quote_token so the quoted price
// holds while it is valid, and keep the same payment for a retry. A refused order (409, nothing charged) does
// not end the purchase: the fresh offer it brings replaces that seller's quote, and the agent orders the
// cheapest offer it now knows, within --max-usd: the same seller at its new price, or another seller whose
// quote still holds. Then it brings the seller's signed delivery receipt to the hub, and with --refund asks
// for the money back and brings that receipt too.
//
//   node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/wallet.json [--yes] [--refund]
//   node examples/agent-buy.mjs https://<seller>/agents TR --key-file ~/wallet.json [--yes]      (one seller)
//   options: --min-gb 1  --days 7  --max-usd 1  --output ./delivery.json  --no-share (keep the purchase from the hub)
//
// The key comes from --key-file ({"private_key": "0x…"}) or AGENT_PRIVATE_KEY and is never printed.
// Without --yes it only quotes. The activation code is the traveller's secret: printed shortened.
import { randomBytes } from "node:crypto";
import { readFileSync, openSync, writeSync, ftruncateSync, fsyncSync, closeSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const VALUE_OPTIONS = new Set(["hub", "key-file", "min-gb", "days", "max-usd", "output"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1]?.startsWith("--") && VALUE_OPTIONS.has(argv[i - 1].slice(2))));
const sellerArg = positional.find((a) => /^https?:\/\//.test(a));
const country = (positional.find((a) => /^[A-Za-z]{2}$/.test(a)) || "").toUpperCase();
const hub = (opt("hub", "") || "").replace(/\/+$/, "");
if (!country || (!sellerArg && !hub)) {
  console.error("usage: node examples/agent-buy.mjs <country> --hub https://modelmarket.dev --key-file <wallet.json> [--yes] [--refund]\n" +
                "       node examples/agent-buy.mjs <seller URL> <country> --key-file <wallet.json> [--yes] [--refund]");
  process.exit(1);
}
const want = { country, min_gb: Number(opt("min-gb", 0)), min_days: Number(opt("days", 0)), limit: 3 };
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { res, json };
};

// 1. Who sells: every eSIM seller the hub lists, quoted through the hub; or the one seller given.
const quotes = [];
if (sellerArg) {
  const { json } = await post(`${sellerArg.replace(/\/+$/, "")}/quote`, want);
  if (json?.success) quotes.push({ via: "direct", ...json.result });
} else {
  const found = await (await fetch(`${hub}/ai-market/v2/search?intent=esim&limit=50`)).json();
  const listings = (found.matches || []).filter((m) => String(m.capability_id).startsWith("esim.quote@"));
  for (const m of listings) {
    const { json } = await post(`${hub}/ai-market/v2/invoke`, { capability_id: m.capability_id, product_id: m.product_id,
      source_hub: m.source_hub, input: want, purpose: "esim-quote" });
    const r = json?.result?.result ?? json?.result;
    if (json?.success && r?.offers) quotes.push({ via: `${hub} → ${m.source_hub}`, ...r, deliveries_30d: m.deliveries_30d ?? null });
  }
}
for (const q of quotes) {
  console.log(`seller   ${q.seller?.name} (${q.via})${q.seller?.demo ? " — DEMO: sells nothing" : ""}`
    + `${q.deliveries_30d ? ` — buyers confirmed ${q.deliveries_30d.confirmed} deliveries in 30 days` : ""}`);
}
// Each seller that sells, with its cheapest offer that fits: what the agent compares, cheapest first.
const maxUsd = Number(opt("max-usd", 1));
const usd = (c) => Number(c.offer.price.usd);
const known = quotes.filter((q) => !q.seller?.demo && q.offers?.length).map((q) => ({ q, offer: q.offers[0] }));
const byPrice = (a, b) => usd(a) - usd(b) || Number(Boolean(b.fresh)) - Number(Boolean(a.fresh));   // a tie: the fresher offer
const cheapest = () => known.filter((c) => usd(c) <= maxUsd).sort(byPrice)[0];
if (!known.length) { console.error("\nno seller that sells has an offer for " + country); process.exit(1); }
let current = cheapest();   // { q: the seller's quote, offer }: what is being bought
const first = current ?? [...known].sort(byPrice)[0];
console.log(`\noffer    ${first.offer.offer_id} — ${first.offer.name} — ${first.offer.price.usd} USDC, from ${first.q.seller.name}`
  + (first.offer.price_valid_until ? `; price kept until ${first.offer.price_valid_until}` : ""));
console.log(`order at ${first.q.order.url}`);
if (!current) { console.error(`above --max-usd ${maxUsd}`); process.exit(1); }
if (!flag("yes")) { console.log("\nquote only: add --yes to pay"); process.exit(0); }

// Reserve a new private output file BEFORE paying. Never overwrite an earlier delivery or follow a symlink.
const output = opt("output", `esim-delivery-${Date.now()}.json`);
const outputFd = openSync(output, "wx", 0o600);
// One private recovery value per seller: a seller never learns the value that recovers another seller's order.
const recovery = new Map();
const recoveryFor = (url) => {
  if (!recovery.has(url)) recovery.set(url, randomBytes(32).toString("base64url"));
  return recovery.get(url);
};
const checkpoint = (data) => {
  const url = current.q.order.url;
  const text = JSON.stringify({ seller: url, offer_id: current.offer.offer_id, recovery_token: recoveryFor(url), ...data }, null, 2);
  ftruncateSync(outputFd, 0);
  writeSync(outputFd, text, 0, "utf8");
  fsyncSync(outputFd);
};
checkpoint({ status: "purchase_started" });
// 2. Pay over x402 from the agent's own wallet.
const keyFile = opt("key-file", "");
const key = keyFile ? String(JSON.parse(readFileSync(keyFile.replace(/^~/, process.env.HOME), "utf8")).private_key || "") : process.env.AGENT_PRIVATE_KEY || "";
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) { console.error("the key file (or AGENT_PRIVATE_KEY) must hold a 0x-prefixed private key"); process.exit(1); }
const account = privateKeyToAccount(key);
console.log(`payer    ${account.address}`);
let paidHeaders = null;   // the same payment for a retry: a new one would be a second order
let askedMore = null;     // a price a seller asked above the offer being bought: then nothing is signed
const keepPayment = (input, init) => {
  const req = new Request(input, init);
  if (req.headers.has("PAYMENT-SIGNATURE")) {
    paidHeaders = new Headers(req.headers);
    checkpoint({ status: "payment_submitted", payment_signature: req.headers.get("PAYMENT-SIGNATURE") });
  }
  return fetch(req);
};
const payingFetch = wrapFetchWithPaymentFromConfig(keepPayment, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
  // Sign no more than the offer being bought (the price the agent compared), and never above --max-usd.
  paymentRequirementsSelector: (_version, accepts) => {
    const terms = accepts.find((a) => a.network === "eip155:8453") ?? accepts[0];
    if (terms && BigInt(terms.amount) > BigInt(Math.round(usd(current) * 1e6))) {
      askedMore = (Number(terms.amount) / 1e6).toFixed(2);
      throw new Error(`the seller asks ${askedMore} USDC, more than its offer`);
    }
    return terms;
  },
  spendControls: { maxAmountPerPayment: `$${maxUsd}` },
});
// The quote_token keeps the quoted price until price_valid_until: the 402 asks at most that.
// null: the seller asked more than the offer, and nothing was signed.
async function order(c) {
  paidHeaders = null;
  askedMore = null;
  const url = c.q.order.url;
  const body = JSON.stringify({ offer_id: c.offer.offer_id, ...(c.offer.quote_token ? { quote_token: c.offer.quote_token } : {}) });
  let r;
  try {
    r = await payingFetch(url, { method: "POST", headers: { "content-type": "application/json", "X-Esim-Recovery": recoveryFor(url) }, body });
  } catch (err) {
    if (askedMore !== null) return null;
    throw err;
  }
  for (let i = 0; i < 6 && r.status === 503 && paidHeaders; i++) {
    console.log("allocating… retrying with the same payment");
    await new Promise((ok) => setTimeout(ok, 1000 * Number(r.headers.get("retry-after") || 20)));
    r = await fetch(url, { method: "POST", headers: paidHeaders, body });
  }
  return r;
}
// A refused order charged nothing: a 409 that says so (the quote expired after a price rise, the wholesale cost
// passed the quoted price, or the wholesaler said no), or terms above the offer, which the agent did not sign.
// What the seller offers now (current_offer, with a fresh token) replaces its quote; a seller that can only say
// no is dropped. Then the agent orders the cheapest offer it now knows, within --max-usd: the same seller at its
// new price, or another seller whose quote still holds its price. That needs no new quotes.
const NOT_CHARGED = /^(quote_expired|quote_below_cost|supplier_\w+)$/;
const MAX_ORDERS = 4;
let res = await order(current);
for (let n = 1; n < MAX_ORDERS && (res === null || res.status === 409); n++) {
  const refused = res === null
    ? { error: "asks_more", current_offer: { ...current.offer, price: { ...current.offer.price, usd: askedMore }, quote_token: undefined, price_valid_until: undefined } }
    : await res.clone().json().catch(() => null);
  if (refused?.error !== "asks_more" && !NOT_CHARGED.test(refused?.error ?? "")) break;   // not a refusal that charged nothing
  const next = refused.current_offer;
  const was = current;
  known.splice(known.indexOf(was), 1);
  if (next?.offer_id === was.offer.offer_id && refused.catalogue_changed !== false) known.push({ q: was.q, offer: next, fresh: true });
  console.log(`${refused.error}: not charged; ` + (known.some((c) => c.q === was.q)
    ? `${was.q.seller.name} now asks ${next.price.usd} USDC` + (next.price_valid_until ? `, kept until ${next.price_valid_until}` : "")
    : `${was.q.seller.name} cannot sell it now`));
  current = cheapest();
  if (!current) { current = was; console.error(`no offer left within --max-usd ${maxUsd}`); break; }
  console.log(current.q === was.q ? `ordering again from ${current.q.seller.name} at ${current.offer.price.usd} USDC`
    : `cheaper now: ${current.offer.offer_id} at ${current.offer.price.usd} USDC from ${current.q.seller.name}`
      + (current.offer.price_valid_until ? ` (its quote holds until ${current.offer.price_valid_until})` : "") + " — ordering there");
  checkpoint({ status: "requoted", offer: current.offer });
  res = await order(current);
}
if (res === null) { console.error(`${current.q.seller.name} asks ${askedMore} USDC, more than its offer: not signed`); process.exit(1); }
if (res.status === 402) {
  // A refused payment says why in the x402 header, not in the body.
  let why = "no reason given";
  try { why = JSON.parse(Buffer.from(res.headers.get("payment-required"), "base64").toString("utf8")).error || why; } catch { /* no header */ }
  console.error(`402 payment refused: ${why} (a payment was ${paidHeaders ? "" : "not "}attached)`);
  process.exit(1);
}
const answer = await res.json();
if (!res.ok) { console.error(`${res.status} ${answer.error}: ${answer.message}`); process.exit(1); }
const d = answer.result;
checkpoint({ status: "delivered", delivery: d });
closeSync(outputFd);
console.log(`saved      ${output} (private: activation code and status token)`);
let paidTx = null;
try { paidTx = JSON.parse(Buffer.from(res.headers.get("payment-response"), "base64").toString("utf8")).transaction; } catch { /* none */ }
console.log(`\ndelivered  esim_tran_no ${d.esim_tran_no} · iccid ${d.iccid} · apn ${d.apn}`);
console.log(`activation ${String(d.activation_code).slice(0, 14)}… (the traveller's secret)`);
console.log(`paid       ${paidTx ?? "(no transaction reported)"}`);

// 3. The seller's signed receipt and the transaction, to the hub: evidence this seller delivers.
const share = async (kind, receipt, signature, tx) => {
  if (flag("no-share") || !hub || !receipt || !signature || !tx) return;
  for (let n = 0; n < 6; n++) {
    const { res: r, json } = await post(`${hub}/ai-market/v2/reputation/deliveries`, { receipt, signature, transaction: tx });
    if (r.ok) { console.log(`hub        ${kind} counted: ${JSON.stringify(json.deliveries_30d)}`); return; }
    if (!/confirmation|not on chain/i.test(json?.detail || "") || n === 5) { console.log(`hub        ${kind} not counted: ${json?.detail ?? r.status}`); return; }
    await new Promise((ok) => setTimeout(ok, 10_000));
  }
};
await share("delivery", d.receipt, d.receipt_signature, paidTx);

// 4. Optional: the money back for the unused eSIM, and the refund receipt to the hub.
if (flag("refund")) {
  const base = current.q.order.url.replace(/\/order$/, "");
  const { json } = await post(`${base}/refund`, { esim_tran_no: d.esim_tran_no, status_token: d.status_token });
  if (!json?.success) { console.error(`refund refused: ${json?.error}: ${json?.message}`); process.exit(1); }
  const r = json.result;
  console.log(`\nrefund     ${r.status} · ${r.amount_usd} USDC to ${r.to} · ${r.transaction ?? "paid by the seller by hand"}`);
  await share("refund", r.receipt, r.receipt_signature, r.transaction);
}
