import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupplierError } from "../src/esimaccess.js";
import { quoteTtlFromEnv } from "../src/config.js";
import { createNode, ed25519Signer, paymentRefOf } from "../src/node.js";
import { fileStore, transactionIdFor } from "../src/order.js";
import { issueQuote, priceForQuote, quoteKey, readQuote } from "../src/quote.js";
import { validate } from "../src/schema.js";

// A quoted price the seller keeps (whiteknightonhorse on DEV, 2026-11-17: "We honour the quoted price until
// it expires, then answer with a fresh quote instead of a failure"). Prices here: 20 % margin, $0.30 floor,
// so a $2.00 cost sells at $2.40, $2.20 at $2.64, $2.50 at $3.00 and $1.50 at $1.80.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };
const SECRET = "test-status-secret-0123456789";
const MIN = 60_000;
const GIB = 1024 ** 3;

/** A wholesaler whose cost moves, that refuses an order at a cost it no longer charges (as eSIM Access does). */
function movingSupplier({ cost = 2.0 } = {}) {
  const state = { cost, withdrawn: false, refuseOther: false, catalogueDown: false, orders: new Map(), costs: [] };
  const plan = (id, country) => ({ id, name: `${country} 3GB 15 days`, countries: [country], kind: "country",
                                   data_bytes: 3 * GIB, days: 15, cost_usd: state.cost });
  return {
    state, kind: "test",
    async catalog() {
      if (state.catalogueDown) throw new SupplierError("unreachable", "down", { retryable: true });
      return state.withdrawn ? [plan("DE-3GB-15D", "DE")] : [plan("FR-3GB-15D", "FR"), plan("DE-3GB-15D", "DE")]; },
    async order({ transactionId, planId, costUsd }) {
      state.costs.push(costUsd);
      if (state.withdrawn && planId === "FR-3GB-15D") throw new SupplierError("plan_unknown", "no such plan");
      if (state.refuseOther) throw new SupplierError("out_of_stock", "no stock");
      if (Math.abs(costUsd - state.cost) > 1e-9) throw new SupplierError("price_changed", "the plan's cost changed since the quote");
      if (!state.orders.has(transactionId)) state.orders.set(transactionId, { orderRef: `O${state.orders.size + 1}` });
      return { orderRef: state.orders.get(transactionId).orderRef };
    },
    async profiles({ orderRef, profileId }) {
      const o = [...state.orders.values()].find((x) => x.orderRef === orderRef || x.profileId === profileId);
      if (!o) return [];
      o.profileId ||= `P${o.orderRef.slice(1).padStart(12, "0")}`;
      return [{ profileId: o.profileId, orderRef: o.orderRef, activationCode: "LPA:1$rsp.example$ABC", iccid: "8900000000000000001" }];
    },
    async cancel() { return true; },
    async balance() { return null; },
  };
}

/** @x402/express in miniature: no payment header → 402 with the price priceOf gives for this very body. */
const fakePaywall = (node) => ({
  middleware: (req, res, next) => (req.get("payment-signature")
    ? next() : res.status(402).json({ x402Version: 2, price: `$${node().priceOf(req.body)}` })),
});
const paymentHeader = (nonceByte) => Buffer.from(JSON.stringify({
  x402Version: 2, payload: { authorization: { from: "0x" + "ab".repeat(20), nonce: "0x" + nonceByte.repeat(32) }, signature: "0x00" },
})).toString("base64");

async function serve({ supplier = movingSupplier(), catalogTtlMs = 15 * MIN, quoteTtlMs = 10 * MIN, demo = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "esim-quote-"));
  const storePath = join(dir, "orders.json");
  const clock = { t: Date.parse("2026-11-17T12:00:00Z") };
  let node;
  node = createNode({ pricing: PRICING, supplier, store: fileStore(storePath, fs), secret: SECRET, signer: ed25519Signer(),
                      log: { warn() {}, error() {} }, publicUrl: "https://seller.example/esim", demo,
                      paywall: demo ? null : fakePaywall(() => node), orderWaitMs: 2_000, now: () => clock.t, catalogTtlMs, quoteTtlMs });
  const server = await new Promise((r) => { const s = node.app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const quoteFR = async () => (await call("/quote", { country: "FR" })).json.result.offers[0];
  const record = async (nonceByte) => fileStore(storePath, fs).get(transactionIdFor(paymentRefOf(JSON.parse(Buffer.from(paymentHeader(nonceByte), "base64").toString()))));
  return { node, supplier, clock, call, quoteFR, record, close: () => new Promise((r) => server.close(r)) };
}

test("a token is bound to its offer, price and time; the rules for what an order pays", () => {
  const key = quoteKey(SECRET);
  const offer = { offer_id: "FR-3GB-15D", price: { usd: "2.40", currency: "USDC" } };
  const until = Date.parse("2026-11-17T12:10:00Z");
  const { quote_token: token, price_valid_until } = issueQuote(key, offer, until);
  assert.equal(price_valid_until, "2026-11-17T12:10:00.000Z");
  assert.deepEqual(readQuote(key, token, "FR-3GB-15D"), { cents: 240, untilMs: until });
  assert.equal(readQuote(key, token, "DE-3GB-15D"), null, "another offer");
  assert.equal(readQuote(key, token.replace(".240.", ".140."), "FR-3GB-15D"), null, "a lower price");
  assert.equal(readQuote(key, token.replace(/^q1\.(\d+)/, (_m, u) => `q1.${Number(u) + 3600}`), "FR-3GB-15D"), null, "a longer time");
  assert.equal(readQuote(quoteKey("another-secret-0123456789"), token, "FR-3GB-15D"), null, "another node");
  assert.equal(readQuote(key, 42, "FR-3GB-15D"), null);
  const q = { cents: 240, untilMs: until };
  const at = (usd, cost) => ({ offer_id: "FR-3GB-15D", price: { usd }, _cost_usd: cost });
  assert.deepEqual(priceForQuote(at("2.64", 2.2), q, until - 1), { kind: "honoured", cents: 240 });
  assert.deepEqual(priceForQuote(at("2.64", 2.2), q, until + 1), { kind: "expired", cents: 264 });
  assert.deepEqual(priceForQuote(at("3.00", 2.5), q, until - 1), { kind: "below_cost", cents: 300 });
  assert.deepEqual(priceForQuote(at("2.40", 2.4), q, until - 1), { kind: "current", cents: 240 }, "cost = quoted price: kept, nothing to honour");
  assert.deepEqual(priceForQuote(at("1.80", 1.5), q, until + 1), { kind: "current", cents: 180 }, "a lower price is paid, expired or not");
  assert.deepEqual(priceForQuote(at("2.64", 2.2), null, until), { kind: "current", cents: 264 });
});

test("every quoted offer carries a token and its validity, valid against the schema", async () => {
  const t = await serve();
  try {
    const { status, json } = await t.call("/quote", { country: "FR" });
    assert.equal(status, 200);
    assert.deepEqual(validate("quote-result", json.result), []);
    const [offer] = json.result.offers;
    assert.match(offer.quote_token, /^q1\./);
    assert.equal(offer.price_valid_until, "2026-11-17T12:10:00.000Z");
    assert.equal(offer.price.usd, "2.40");
    assert.ok(!("_cost_usd" in offer));
  } finally { await t.close(); }
});

test("the quoted price is kept after the price rose: the 402 asks it, the wholesaler gets today's cost", async () => {
  const t = await serve({ catalogTtlMs: MIN });
  try {
    const offer = await t.quoteFR();
    t.supplier.state.cost = 2.2;
    t.clock.t += 2 * MIN;                                   // the catalogue is read again: $2.64 now
    assert.equal((await t.quoteFR()).price.usd, "2.64");
    const body = { offer_id: offer.offer_id, quote_token: offer.quote_token };
    const terms = await t.call("/order", body);
    assert.equal(terms.status, 402);
    assert.equal(terms.json.price, "$2.40");
    assert.equal(t.node.priceOf({ ...body }), "2.40", "the paywall's price for the same body");
    const paid = await t.call("/order", body, { "payment-signature": paymentHeader("31") });
    assert.equal(paid.status, 200);
    assert.equal(paid.json.result.offer.price.usd, "2.40");
    assert.equal(paid.json.result.offer.usd_per_gb, 0.8);
    assert.ok(!Object.keys(paid.json.result.offer).some((k) => k.startsWith("_")), "no wholesale cost to the buyer");
    assert.deepEqual(t.supplier.state.costs, [2.2]);
    const rec = await t.record("31");
    assert.equal(rec.priceUsd, "2.40", "a refund pays back what was paid");
    assert.equal(rec.costUsd, 2.2);
    // Without the token the same offer costs today's price.
    assert.equal((await t.call("/order", { offer_id: offer.offer_id })).json.price, "$2.64");
  } finally { await t.close(); }
});

test("after it expires, a price rise answers with a fresh quote, not a dead end; a lower price is simply paid", async () => {
  const t = await serve({ catalogTtlMs: MIN });
  try {
    const offer = await t.quoteFR();
    t.supplier.state.cost = 2.2;
    t.clock.t += 11 * MIN;
    const refused = await t.call("/order", { offer_id: offer.offer_id, quote_token: offer.quote_token });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, "quote_expired");
    assert.match(refused.json.message, /not charged/);
    const fresh = refused.json.current_offer;
    assert.deepEqual(validate("offer", fresh), []);
    assert.equal(fresh.price.usd, "2.64");
    assert.equal(fresh.price_valid_until, new Date(t.clock.t + 10 * MIN).toISOString().replace(/\.\d{3}Z$/, ".000Z"));
    assert.equal(t.supplier.state.costs.length, 0, "nothing ordered");
    assert.equal((await t.call("/order", { offer_id: fresh.offer_id, quote_token: fresh.quote_token })).json.price, "$2.64");
    // The price fell instead: the token never makes an order dearer, expired or not.
    t.supplier.state.cost = 1.5;
    t.clock.t += 2 * MIN;
    assert.equal((await t.call("/order", { offer_id: offer.offer_id, quote_token: offer.quote_token })).json.price, "$1.80");
  } finally { await t.close(); }
});

test("a quoted price below today's wholesale cost is not kept: 409 quote_below_cost with the offer as it is now", async () => {
  const t = await serve({ catalogTtlMs: MIN });
  try {
    const offer = await t.quoteFR();
    t.supplier.state.cost = 2.5;
    t.clock.t += 2 * MIN;
    const refused = await t.call("/order", { offer_id: offer.offer_id, quote_token: offer.quote_token }, { "payment-signature": paymentHeader("41") });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, "quote_below_cost");
    assert.equal(refused.json.current_offer.price.usd, "3.00");
    assert.equal(t.supplier.state.costs.length, 0, "refused before the paywall and the wholesaler");
  } finally { await t.close(); }
});

test("a token that was changed or belongs to another offer is a 400 before any price", async () => {
  const t = await serve();
  try {
    const [fr, de] = await Promise.all(["FR", "DE"].map(async (c) => (await t.call("/quote", { country: c })).json.result.offers[0]));
    for (const token of [fr.quote_token.replace(".240.", ".100."), de.quote_token, "q1.1.1.x", 7]) {
      const r = await t.call("/order", { offer_id: fr.offer_id, quote_token: token });
      assert.equal(r.status, 400, String(token));
      assert.equal(r.json.error, "bad_quote_token");
    }
    assert.equal(t.node.priceOf({ offer_id: fr.offer_id, quote_token: de.quote_token }), null);
  } finally { await t.close(); }
});

test("a supplier refusal reads the catalogue again at once and answers with the offer as an order would get it now", async () => {
  const t = await serve();                                  // the catalogue is kept 15 minutes
  try {
    const offer = await t.quoteFR();
    t.supplier.state.cost = 2.2;                            // the wholesaler moved; the node does not know yet
    const body = { offer_id: offer.offer_id, quote_token: offer.quote_token };
    const refused = await t.call("/order", body, { "payment-signature": paymentHeader("51") });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, "supplier_price_changed");
    assert.equal(refused.json.catalogue_changed, true);
    assert.match(refused.json.message, /not charged/);
    // The buyer's quote still covers the new cost: the same token, the same price.
    assert.equal(refused.json.current_offer.quote_token, offer.quote_token);
    assert.equal(refused.json.current_offer.price.usd, "2.40");
    assert.equal((await t.quoteFR()).price.usd, "2.64", "the next quote is current, not 15 minutes old");
    const again = await t.call("/order", body, { "payment-signature": paymentHeader("52") });
    assert.equal(again.status, 200);
    assert.equal(again.json.result.offer.price.usd, "2.40");
    assert.deepEqual(t.supplier.state.costs, [2.0, 2.2]);
    // Without a token: a fresh one at today's price.
    t.supplier.state.cost = 2.3;
    const plain = await t.call("/order", { offer_id: offer.offer_id }, { "payment-signature": paymentHeader("53") });
    assert.equal(plain.json.current_offer.price.usd, "2.76");
    assert.notEqual(plain.json.current_offer.quote_token, offer.quote_token);
  } finally { await t.close(); }
});

test("a refusal with an unchanged catalogue says so; a withdrawn plan says it is gone", async () => {
  const t = await serve();
  try {
    const offer = await t.quoteFR();
    t.supplier.state.refuseOther = true;
    const other = await t.call("/order", { offer_id: offer.offer_id }, { "payment-signature": paymentHeader("61") });
    assert.equal(other.status, 409);
    assert.equal(other.json.catalogue_changed, false);
    assert.match(other.json.message, /another cause/);
    t.supplier.state.refuseOther = false;
    t.supplier.state.withdrawn = true;
    const gone = await t.call("/order", { offer_id: offer.offer_id }, { "payment-signature": paymentHeader("62") });
    assert.equal(gone.status, 409);
    assert.equal(gone.json.offer_withdrawn, true);
    assert.equal(gone.json.current_offer, undefined);
    // The supplier refuses and then cannot be read: the answer says so and offers nothing it cannot back.
    t.supplier.state.withdrawn = false;
    t.supplier.state.refuseOther = true;
    t.supplier.state.catalogueDown = true;
    const down = await t.call("/order", { offer_id: "DE-3GB-15D" }, { "payment-signature": paymentHeader("63") });
    assert.equal(down.status, 409);
    assert.match(down.json.message, /could not be read again/);
    assert.equal(down.json.current_offer, undefined);
  } finally { await t.close(); }
});

test("a demo node checks the token before it says it sells nothing; QUOTE_TTL_SECONDS=0 issues no tokens", async () => {
  const demo = await serve({ demo: true });
  try {
    const offer = await demo.quoteFR();
    assert.equal((await demo.call("/order", { offer_id: offer.offer_id, quote_token: offer.quote_token.replace(".240.", ".1.") })).json.error, "bad_quote_token");
    assert.equal((await demo.call("/order", { offer_id: offer.offer_id, quote_token: offer.quote_token })).json.error, "demo_mode");
  } finally { await demo.close(); }
  const off = await serve({ quoteTtlMs: 0 });
  try {
    const offer = await off.quoteFR();
    assert.equal(offer.quote_token, undefined);
    assert.equal(offer.price_valid_until, undefined);
  } finally { await off.close(); }
  assert.equal(quoteTtlFromEnv({}), 600_000);
  assert.equal(quoteTtlFromEnv({ QUOTE_TTL_SECONDS: "0" }), 0);
  assert.equal(quoteTtlFromEnv({ QUOTE_TTL_SECONDS: " 90 " }), 90_000);
  for (const bad of ["-1", "1.5", "ten", "86401"]) assert.throws(() => quoteTtlFromEnv({ QUOTE_TTL_SECONDS: bad }), /QUOTE_TTL_SECONDS/);
});
