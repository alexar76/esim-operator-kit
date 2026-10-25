import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Address, Cell } from "@ton/core";
import { SupplierError } from "../../rails/src/esimaccess.js";
import { offersFromEsimAccess } from "../../rails/src/offers.js";
import { fileStore } from "../../rails/src/order.js";
import { createOrders, jsonDb } from "../src/orders.js";
import { USDC_BASE, usdcBase } from "../src/payments/usdc-base.js";
import { tonPay, USDT_MASTER } from "../src/payments/ton.js";
import { stripeCards, verifyWebhook } from "../src/payments/stripe.js";

// The fixtures' prices below were worked out at a 20 % margin with a $0.30 floor; the default is 100 % and $1.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };
const rails = (name) => JSON.parse(readFileSync(new URL(`../../rails/test/fixtures/${name}`, import.meta.url), "utf8"));
const OFFERS = offersFromEsimAccess(rails("package-list.json").obj.packageList, PRICING);
const PROFILE = rails("esim-query.json").obj.esimList[0];
const PAY_TO = "0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a";
const STORE_TON = new Address(0, Buffer.alloc(32, 7)).toString({ bounceable: false });
const BUYER_TON = new Address(0, Buffer.alloc(32, 9)).toString({ bounceable: false });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeSupplier({ balance = 10_000_000, refuse = null } = {}) {
  const orders = new Map();
  const calls = { order: 0, cancel: 0 };
  return {
    calls,
    async balance() { return { units: balance }; },
    async order({ transactionId }) {
      calls.order++;
      if (refuse) throw new SupplierError(refuse, "refused");
      if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}` });
      return { orderNo: orders.get(transactionId).orderNo };
    },
    async profiles({ orderNo, esimTranNo }) {
      const o = [...orders.values()].find((x) => x.orderNo === orderNo || x.tran === esimTranNo);
      if (!o) return [];
      o.tran ||= `2${o.orderNo.slice(1).padStart(13, "0")}`;
      return [{ ...PROFILE, orderNo: o.orderNo, esimTranNo: o.tran }];
    },
    async cancel() { calls.cancel++; return true; },
  };
}

async function shop({ supplier = fakeSupplier(), facilitator, tonFetch, stripeFetch, now = () => Date.now(), events, reconciler } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "travel-esim-"));
  const methods = [
    usdcBase({ payTo: PAY_TO, facilitator, now, reconciler }),
    tonPay({ address: STORE_TON, fetchImpl: tonFetch, now }),
    stripeCards({ secretKey: stripeFetch ? "sk_test_x" : "", webhookSecret: stripeFetch ? "whsec_x" : "", fetchImpl: stripeFetch }),
  ];
  const byId = new Map(OFFERS.map((o) => [o.offer_id, o]));
  const orders = createOrders({ db: jsonDb(join(dir, "orders.json"), fs), supplier, railsStore: fileStore(join(dir, "rails.json"), fs),
                                statusSecret: "store-status-secret-0123456789", methods, offersById: (id) => byId.get(id),
                                now, log: { error() {} }, events });
  return { orders, supplier, dir };
}

const signedAuth = (intent, from = "0x" + "ab".repeat(20)) => ({
  authorization: { from, to: intent.typed_data.message.to, value: intent.typed_data.message.value,
                   validAfter: "0", validBefore: intent.typed_data.message.validBefore, nonce: intent.typed_data.message.nonce },
  signature: "0x" + "11".repeat(65),
});

test("USDC on Base: the buyer signs USDC's own domain for exactly the price, to the seller", async () => {
  const { orders } = await shop({ facilitator: {} });
  const { order } = await orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  const td = order.intent.typed_data;
  assert.deepEqual(td.domain, { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC_BASE });
  assert.equal(td.message.to, PAY_TO);
  assert.equal(td.message.value, "5400000");          // $5.40
  assert.match(td.message.nonce, /^0x[0-9a-f]{64}$/);
  assert.equal(order.intent.amount_display, "5.40 USDC");
});

test("USDC on Base: verified, delivered, then settled — and an uncertain settlement retains the eSIM", async () => {
  const seen = [];
  const facilitator = {
    verify: async (p, req) => { seen.push(["verify", p, req]); return { isValid: true }; },
    settle: async () => { seen.push(["settle"]); return { success: true, transaction: "0xtx" }; },
  };
  const { orders } = await shop({ facilitator });
  const { order, token } = await orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  assert.deepEqual(await orders.authorize(order.id, "wrong-token", {}), { error: "not_found" });
  const bad = await orders.authorize(order.id, token, { ...signedAuth(order.intent), authorization: { ...signedAuth(order.intent).authorization, value: "1" } });
  assert.equal(bad.error, "wrong_terms");
  assert.equal(seen.length, 0, "wrong terms never reach the facilitator");
  const ok = await orders.authorize(order.id, token, signedAuth(order.intent));
  assert.equal(ok.order.status, "delivered");
  assert.equal(ok.order.payment.tx, "0xtx");
  assert.deepEqual(seen.map((s) => s[0]), ["verify", "settle"]);
  assert.equal(seen[0][1].accepted.amount, "5400000");
  const page = await orders.get(order.id, token);
  assert.equal(page.esim.activation_code, PROFILE.ac);
  assert.equal(await orders.get(order.id, "nope"), null);

  const failing = await shop({ facilitator: { verify: async () => ({ isValid: true }), settle: async () => ({ success: false, errorReason: "nonce_used" }) } });
  const o2 = await failing.orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  const r2 = await failing.orders.authorize(o2.order.id, o2.token, signedAuth(o2.order.intent));
  assert.equal(r2.error, "settlement_pending");
  assert.equal(failing.supplier.calls.cancel, 0, "an uncertain payment never cancels the profile");
  assert.equal(r2.order.status, "settlement_pending");
});

test("USDC on Base: a refused wholesale order settles nothing", async () => {
  let settled = 0;
  const facilitator = { verify: async () => ({ isValid: true }), settle: async () => { settled++; return { success: true }; } };
  const { orders } = await shop({ supplier: fakeSupplier({ refuse: "200005" }), facilitator });
  const { order, token } = await orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  const r = await orders.authorize(order.id, token, signedAuth(order.intent));
  assert.equal(r.error, "200005");
  assert.equal(settled, 0);
});

test("an order is refused while the wholesale balance cannot cover it, before any address is shown", async () => {
  const { orders } = await shop({ supplier: fakeSupplier({ balance: 100 }), facilitator: {} });
  assert.deepEqual(await orders.create({ offerId: "ES_5_30", methodId: "ton", asset: "USDT" }), { error: "temporarily_unavailable" });
  const ok = await shop({ facilitator: {} });
  assert.deepEqual(await ok.orders.create({ offerId: "NOPE", methodId: "ton" }), { error: "unknown_offer" });
  assert.deepEqual(await ok.orders.create({ offerId: "ES_5_30", methodId: "stripe" }), { error: "unknown_method" }, "cards are off without keys");
});

function tonapi({ events = [], rate = 2.5, jettonBalance = "100000000" } = {}) {
  const raw = Address.parse(STORE_TON).toRawString();
  const fetchImpl = async (url) => {
    if (url.includes("/v2/rates")) return json({ rates: { TON: { prices: { USD: rate } } } });
    if (url.includes("/jettons/")) return json({ balance: jettonBalance, wallet_address: { address: "0:" + "cd".repeat(32) } });
    if (url.includes(`/v2/accounts/${encodeURIComponent(raw)}/events`)) return json({ events, next_from: 0 });
    return json({}, 404);
  };
  return { raw, fetchImpl };
}

test("TON: USD₮ and TON terms, the TON Connect message, and a jetton transfer that decodes to what was asked", async () => {
  const t = tonapi({ rate: 2.5 });
  const { orders } = await shop({ tonFetch: t.fetchImpl });
  const usdt = await orders.create({ offerId: "ES_5_30", methodId: "ton", asset: "USDT" });
  const i = usdt.order.intent;
  assert.equal(i.units, "5400000");
  assert.match(i.memo, /^ESIM-[A-Z0-9]{10}$/);
  assert.ok(i.deeplink.startsWith(`ton://transfer/${i.to}?jetton=${USDT_MASTER}&amount=5400000&text=`));
  const { message } = await orders.tonMessage(usdt.order.id, usdt.token, BUYER_TON);
  const body = Cell.fromBase64(message.messages[0].payload).beginParse();
  assert.equal(body.loadUint(32), 0x0f8a7ea5);
  body.loadUintBig(64);
  assert.equal(body.loadCoins(), 5400000n);
  assert.ok(body.loadAddress().equals(Address.parse(STORE_TON)));
  assert.ok(body.loadAddress().equals(Address.parse(BUYER_TON)));
  body.loadBit(); body.loadCoins(); body.loadBit();
  const comment = body.loadRef().beginParse();
  assert.equal(comment.loadUint(32), 0);
  assert.equal(comment.loadStringTail(), i.memo);
  const ton = await orders.create({ offerId: "ES_5_30", methodId: "ton", asset: "TON" });
  assert.equal(ton.order.intent.amount_display, "2.1924 TON");   // $5.40 / 2.5 × 1.015
  assert.equal(ton.order.intent.ton_connect.messages[0].amount, ton.order.intent.units);
});

test("TON: a paid order is found by its memo and delivered; wrong jetton, wrong memo, pending and short payments are not", async () => {
  let now = Date.now();
  const events = [];
  const t = tonapi({ events });
  const s = await shop({ tonFetch: t.fetchImpl, now: () => now });
  const a = await s.orders.create({ offerId: "ES_5_30", methodId: "ton", asset: "USDT" });
  const b = await s.orders.create({ offerId: "SI_5_30", methodId: "ton", asset: "USDT" });
  const transfer = (memo, amount, jetton = Address.parse(USDT_MASTER).toRawString(), extra = {}) => ({
    event_id: `e${events.length}`, timestamp: Math.floor(now / 1000), in_progress: false, ...extra,
    actions: [{ type: "JettonTransfer", status: "ok", JettonTransfer: { sender: { address: "0:" + "ee".repeat(32) },
      recipient: { address: t.raw }, amount: String(amount), comment: memo, jetton: { address: jetton } } }],
  });
  events.push(transfer(a.order.intent.memo, 5400000, "0:" + "12".repeat(32)));           // another jetton
  events.push(transfer("ESIM-WRONGMEMO1", 5400000));                                     // another order
  events.push(transfer(a.order.intent.memo, 5400000, undefined, { in_progress: true })); // not final yet
  await s.orders.watch();
  assert.equal((await s.orders.get(a.order.id, a.token)).status, "awaiting_payment");
  events.unshift(transfer(a.order.intent.memo, 5400000));
  events.unshift(transfer(b.order.intent.memo, 100));
  await s.orders.watch();
  const pa = await s.orders.get(a.order.id, a.token);
  assert.equal(pa.status, "delivered");
  assert.equal(pa.esim.activation_code, PROFILE.ac);
  assert.equal((await s.orders.get(b.order.id, b.token)).status, "underpaid");
  now += 25 * 3_600_000;
  const c = await s.orders.create({ offerId: "ES_5_30", methodId: "ton", asset: "USDT" });
  now += 25 * 3_600_000;
  await s.orders.watch();
  assert.equal((await s.orders.get(c.order.id, c.token)).status, "expired");
});

test("TON: money that arrived for an order the wholesaler then refused is marked for refund, not lost", async () => {
  const events = [];
  const t = tonapi({ events });
  const supplier = fakeSupplier();
  const s = await shop({ tonFetch: t.fetchImpl, supplier });
  const a = await s.orders.create({ offerId: "ES_5_30", methodId: "ton", asset: "USDT" });
  supplier.order = async () => { throw new SupplierError("200007", "insufficient balance"); };
  events.push({ event_id: "e1", timestamp: Math.floor(Date.now() / 1000), in_progress: false, actions: [{ type: "JettonTransfer", status: "ok",
    JettonTransfer: { sender: { address: "0:" + "ee".repeat(32) }, recipient: { address: t.raw }, amount: "5400000",
                      comment: a.order.intent.memo, jetton: { address: Address.parse(USDT_MASTER).toRawString() } } }] });
  await s.orders.watch();
  const page = await s.orders.get(a.order.id, a.token);
  assert.equal(page.status, "refund_due");
  assert.equal(page.payment.ref, "ton:e1");
});

test("Stripe: off without keys; with them a Checkout Session for the exact price, and only a signed, fresh webhook delivers", async () => {
  const sent = [];
  const stripeFetch = async (url, init) => { sent.push({ url, init }); return json({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }); };
  const s = await shop({ stripeFetch });
  const { order, token } = await s.orders.create({ offerId: "ES_5_30", methodId: "stripe" });
  assert.equal(order.intent, null);
  const { redirect } = await s.orders.cardCheckout(order.id, token, "https://shop.example/o/x");
  assert.equal(redirect, "https://checkout.stripe.com/c/cs_1");
  const params = new URLSearchParams(sent[0].init.body.toString());
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "540");
  assert.equal(params.get("client_reference_id"), order.id);
  assert.equal(sent[0].init.headers["Idempotency-Key"], `checkout-${order.id}`);

  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: {
    id: "cs_1", mode: "payment", currency: "usd", payment_status: "paid", client_reference_id: order.id, payment_intent: "pi_1", amount_total: 540 } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = (secret, ts = t, body = event) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
  assert.deepEqual(await s.orders.cardPaid(event, sig("wrong")), { error: "bad_signature" });
  assert.deepEqual(await s.orders.cardPaid(event, sig("whsec_x", t - 3600)), { error: "bad_signature" });
  assert.equal(verifyWebhook(event + " ", sig("whsec_x"), "whsec_x"), null, "a changed body fails");
  const ok = await s.orders.cardPaid(event, sig("whsec_x"));
  assert.equal(ok.order.status, "delivered");
  assert.equal(ok.order.payment.ref, "stripe:pi_1");
  assert.deepEqual(await s.orders.cardPaid(event, sig("whsec_x")), { ignored: true }, "a replayed webhook does nothing");
});

test("what a buyer's page receives never holds the order token or the wholesale cost", async () => {
  const { orders, dir } = await shop({ facilitator: {} });
  const { order, token } = await orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  const text = JSON.stringify(await orders.get(order.id, token));
  assert.ok(!text.includes(token) && !text.includes("wholesale") && !text.includes("45000"));
  const disk = await fs.readFile(join(dir, "orders.json"), "utf8");
  assert.ok(!disk.includes(token), "only the token's hash is stored");
});

test("the operator's systems hear every status change, without the order's token or the activation code", async () => {
  const sent = [];
  const facilitator = { verify: async () => ({ isValid: true }), settle: async () => ({ success: true, transaction: "0xtx" }) };
  const { orders } = await shop({ facilitator, events: { emit: (type, data) => sent.push({ type, data }) } });
  const { order, token } = await orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  await orders.authorize(order.id, token, signedAuth(order.intent));
  assert.deepEqual(sent.map((e) => e.type), ["order.created", "order.procurement_pending", "order.settlement_pending", "order.delivered"]);
  const d = sent.at(-1).data;
  assert.equal(d.order_id, order.id);
  assert.equal(d.price_usd, "5.40");
  assert.equal(d.offer_id, "ES_5_30");
  assert.ok(d.esim_tran_no && d.cost_usd > 0, "the operator's own systems get the profile and the cost");
  const all = JSON.stringify(sent);
  assert.ok(!all.includes(token) && !all.includes("LPA:") && !all.includes("status_token"), "no token, no activation code");
});


test("store reconciles pending payments across restart, preserving delivery access and cancelling only proven nonpayment", async () => {
  for (const status of ['paid', 'unpaid']) {
    let settles = 0, result = { status: 'pending' };
    const reconciler = { prepare: async a => ({ ...a, fromBlock: '0x1' }), resolve: async () => result };
    const facilitator = { verify: async () => ({ isValid: true }), settle: async () => { settles++; throw Error('lost response'); } };
    const t = await shop({ facilitator, reconciler });
    try {
      const { order, token } = await t.orders.create({ offerId: 'ES_5_30', methodId: 'usdc-base' });
      await t.orders.authorize(order.id, token, signedAuth(order.intent));
      const method = usdcBase({ payTo: PAY_TO, facilitator: null, reconciler }); // New sales off; old payments still recover.
      const restarted = createOrders({ db: jsonDb(join(t.dir, 'orders.json'), fs), railsStore: fileStore(join(t.dir, 'rails.json'), fs),
        supplier: t.supplier, statusSecret: 'store-status-secret-0123456789', methods: [method], offersById: () => null });
      await restarted.reconcile();
      assert.equal((await restarted.get(order.id, token)).status, 'settlement_pending');
      result = { status, transaction: '0xconfirmed', reason: status === 'unpaid' ? 'expired_unused' : undefined };
      await restarted.reconcile(); await restarted.reconcile();
      const recovered = await restarted.get(order.id, token);
      assert.equal(recovered.status, status === 'paid' ? 'delivered' : 'payment_failed');
      assert.equal(Boolean(recovered.esim?.activation_code), status === 'paid');
      assert.equal(t.supplier.calls.cancel, status === 'unpaid' ? 1 : 0);
      assert.equal(settles, 1);
      await restarted.authorize(order.id, token, signedAuth(order.intent));
      assert.equal(settles, 1);
    } finally { await fs.rm(t.dir, { recursive: true, force: true }); }
  }
});

test("every public order operation rejects an omitted, null or empty buyer token", async () => {
  const s = await shop({ facilitator: {} });
  const { order, token } = await s.orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  for (const missing of [undefined, null, ""]) {
    assert.equal(await s.orders.get(order.id, missing), null);
    for (const [name, args] of [
      ["authorize", [{}]], ["claim", ["0x" + "ab".repeat(32), "proof"]],
      ["tonMessage", [BUYER_TON]], ["cardCheckout", ["https://shop.example/o/x"]],
    ]) assert.deepEqual(await s.orders[name](order.id, missing, ...args), { error: "not_found" }, name);
  }
  assert.equal((await s.orders.get(order.id, token)).id, order.id);
  assert.equal(s.supplier.calls.order, 0);
});

test("signed Stripe events must name the issued session, USD payment terms and a Stripe order", async () => {
  let next = 0;
  const s = await shop({ stripeFetch: async () => json({ id: `cs_${++next}`, url: "https://checkout.stripe.com/c/test" }), facilitator: {} });
  const { order, token } = await s.orders.create({ offerId: "ES_5_30", methodId: "stripe" });
  await s.orders.cardCheckout(order.id, token, "https://shop.example/o/x");
  const base = { id: "cs_1", mode: "payment", currency: "usd", payment_status: "paid", client_reference_id: order.id,
    payment_intent: "pi_real", amount_total: 540 };
  const send = async (change) => {
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { ...base, ...change } } });
    const ts = Math.floor(Date.now() / 1000);
    return s.orders.cardPaid(body, `t=${ts},v1=${createHmac("sha256", "whsec_x").update(`${ts}.${body}`).digest("hex")}`);
  };
  for (const change of [
    { currency: "eur" }, { currency: undefined }, { mode: "subscription" },
    ...[undefined, null, "540", -1, 1.5].map(amount_total => ({ amount_total })),
    { id: "cs_other" }, { payment_intent: undefined }, { metadata: { order_id: "other-order" } },
  ]) assert.ok((await send(change)).error, JSON.stringify(change));
  const other = await s.orders.create({ offerId: "ES_5_30", methodId: "usdc-base" });
  assert.equal((await send({ client_reference_id: other.order.id })).error, "payment_order_mismatch");
  assert.equal((await s.orders.get(order.id, token)).status, "awaiting_payment");
  assert.equal(s.supplier.calls.order, 0, "unrelated signed events cannot trigger wholesale spending");
  assert.equal((await send({})).order.status, "delivered");
  assert.deepEqual(await send({}), { ignored: true });
  assert.equal(s.supplier.calls.order, 1);
});
