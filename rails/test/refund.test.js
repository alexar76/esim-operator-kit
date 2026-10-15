// A refund of an agent's eSIM (order.js refund, node.js POST /refund, refund.js): asked for with the
// status token, only while unused, cancelled at the supplier, paid back once to the address that paid.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode, ed25519Signer } from "../src/node.js";
import { fileStore } from "../src/order.js";
import { buildRefunder, refundTerms, usdcUnits } from "../src/refund.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const PACKAGES = fixture("package-list.json").obj.packageList;
const PROFILE = fixture("esim-query.json").obj.esimList[0];
const SECRET = "test-status-secret-0123456789";
const PAYER = "0x" + "ab".repeat(20);

function supplier() {
  const orders = new Map();
  const s = { cancels: 0, smdpStatus: "RELEASED", orderUsage: 0 };
  Object.assign(s, {
    async packages() { return PACKAGES; },
    async order({ transactionId }) {
      if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}` });
      return { orderNo: orders.get(transactionId).orderNo };
    },
    async profiles({ orderNo, esimTranNo }) {
      const o = [...orders.values()].find((x) => x.orderNo === orderNo || x.tran === esimTranNo);
      if (!o) return [];
      o.tran ||= `2${o.orderNo.slice(1).padStart(13, "0")}`;
      return [{ ...PROFILE, orderNo: o.orderNo, esimTranNo: o.tran, smdpStatus: s.smdpStatus, orderUsage: s.orderUsage,
                esimStatus: s.cancels ? "CANCEL" : "GOT_RESOURCE" }];
    },
    async cancel() { s.cancels++; return true; },
  });
  return s;
}

function refunder() {
  const r = { paid: [] };
  r.pay = async ({ to, usd, reference }) => {
    await new Promise((ok) => setTimeout(ok, 20));
    r.paid.push({ to, usd, reference });
    return { transaction: "0x" + "cd".repeat(32), nonce: "0x" + "ab".repeat(32), from: "0x" + "f4".repeat(20) };
  };
  return r;
}

async function serve({ refund = refunder() } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "esim-refund-"));
  const sup = supplier();
  const events = [];
  const node = createNode({
    pricing: { marginPct: 20, minMarginUsd: 0.3 }, supplier: sup, store: fileStore(join(dir, "orders.json"), fs), secret: SECRET,
    signer: ed25519Signer(), log: { warn() {}, error() {} }, publicUrl: "https://seller.example/esim", orderWaitMs: 5_000,
    paywall: { payTo: "0x" + "f4".repeat(20), middleware: (req, res, next) => (req.get("payment-signature") ? next() : res.status(402).end()) },
    refunder: refund, events: { emit: (name, data) => events.push([name, data]) },
  });
  const server = await new Promise((r) => { const s = node.app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const pay = Buffer.from(JSON.stringify({ x402Version: 2, payload: { authorization: { from: PAYER, nonce: "0x" + "11".repeat(32) }, signature: "0x00" } })).toString("base64");
  const bought = await call("/order", { offer_id: "ES_5_30" }, { "payment-signature": pay });
  assert.equal(bought.status, 200);
  return { sup, events, call, base, delivery: bought.body.result, close: () => new Promise((r) => server.close(r)) };
}

test("an unused eSIM is cancelled and its price paid back, once, to the address that paid", async () => {
  const r = refunder();
  const t = await serve({ refund: r });
  try {
    const { esim_tran_no, status_token } = t.delivery;
    assert.equal((await t.call("/refund", { esim_tran_no, status_token: "wrong" })).status, 404);
    const first = await t.call("/refund", { esim_tran_no, status_token });
    assert.equal(first.status, 200);
    assert.equal(first.body.result.status, "refunded");
    assert.equal(first.body.result.to, PAYER);
    assert.equal(first.body.result.amount_usd, t.delivery.offer.price.usd);
    assert.match(first.body.result.transaction, /^0x(cd){32}$/);
    assert.equal(t.sup.cancels, 1);
    assert.deepEqual(r.paid, [{ to: PAYER, usd: t.delivery.offer.price.usd, reference: esim_tran_no }]);
    assert.deepEqual(t.events.map(([n]) => n), ["agent_order.delivered", "agent_order.refunded"]);
    // asked again, or twice at once: the same answer, no second payment, no second cancel
    const again = await Promise.all([1, 2].map(() => t.call("/refund", { esim_tran_no, status_token })));
    assert.deepEqual(again.map((a) => a.body.result.transaction), [first.body.result.transaction, first.body.result.transaction]);
    assert.equal(r.paid.length, 1);
    assert.equal(t.sup.cancels, 1);
  } finally { await t.close(); }
});

test("the seller signs what a buyer can show a hub: a delivery receipt, then a refund receipt", async () => {
  const { createPublicKey, verify } = await import("node:crypto");
  const { canonicalJson } = await import("../src/node.js");
  const t = await serve();
  try {
    const d = t.delivery;
    assert.equal(d.receipt.kind, "delivery");
    assert.equal(d.receipt.capability, "esim.order@v1");
    assert.equal(d.receipt.payer, PAYER);
    assert.equal(d.receipt.nonce, "0x" + "11".repeat(32));
    assert.equal(d.receipt.chain_id, 8453);
    assert.ok(!JSON.stringify(d.receipt).includes(d.activation_code), "no secret in a receipt");
    const health = await (await fetch(t.base + "/healthz")).json();
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(health.provider_pubkey, "base64")]), format: "der", type: "spki" });
    const ok = (r, sig) => verify(null, Buffer.from(canonicalJson(r)), key, Buffer.from(sig, "base64"));
    assert.ok(ok(d.receipt, d.receipt_signature), "signed with the key the listing publishes");
    const back = await t.call("/refund", { esim_tran_no: d.esim_tran_no, status_token: d.status_token });
    const r = back.body.result;
    assert.equal(r.receipt.kind, "refund");
    assert.equal(r.receipt.payer, PAYER);
    assert.equal(r.receipt.refund_nonce, "0x" + "ab".repeat(32));
    assert.equal(r.receipt.delivery_nonce, "0x" + "11".repeat(32));
    assert.ok(ok(r.receipt, r.receipt_signature));
  } finally { await t.close(); }
});

test("an installed or used eSIM is not refunded, and nothing is cancelled", async () => {
  const r = refunder();
  const t = await serve({ refund: r });
  try {
    const { esim_tran_no, status_token } = t.delivery;
    t.sup.smdpStatus = "ENABLED";
    const installed = await t.call("/refund", { esim_tran_no, status_token });
    assert.equal(installed.status, 409);
    assert.equal(installed.body.error, "in_use");
    t.sup.smdpStatus = "RELEASED";
    t.sup.orderUsage = 1024;
    assert.equal((await t.call("/refund", { esim_tran_no, status_token })).status, 409);
    assert.equal(t.sup.cancels, 0);
    assert.equal(r.paid.length, 0);
  } finally { await t.close(); }
});

test("without a refund wallet the eSIM is cancelled and the refund recorded as due for the operator", async () => {
  const t = await serve({ refund: null });
  try {
    const { esim_tran_no, status_token } = t.delivery;
    const due = await t.call("/refund", { esim_tran_no, status_token });
    assert.equal(due.body.result.status, "due");
    assert.equal(due.body.result.to, PAYER);
    assert.equal(t.sup.cancels, 1);
    assert.equal(t.events.at(-1)[0], "agent_order.refund_due");
  } finally { await t.close(); }
});

test("a refund payment that fails is not tried again by itself: it may have landed", async () => {
  const failing = { tries: 0, pay: async () => { failing.tries++; throw new Error("settle timeout"); } };
  const t = await serve({ refund: failing });
  try {
    const { esim_tran_no, status_token } = t.delivery;
    const a = await t.call("/refund", { esim_tran_no, status_token });
    const b = await t.call("/refund", { esim_tran_no, status_token });
    assert.equal(a.body.result.status, "due");
    assert.equal(b.body.result.status, "due");
    assert.equal(failing.tries, 1);
    assert.equal(a.body.result.error, undefined, "the reason stays in the operator's records");
  } finally { await t.close(); }
});

test("the refund is an x402 'exact' transfer to the payer for the order's price, within the caps", async () => {
  assert.equal(usdcUnits("0.31"), "310000");
  assert.equal(usdcUnits("12.5"), "12500000");
  assert.throws(() => usdcUnits("1e3"));
  assert.deepEqual(refundTerms({ to: PAYER, usd: "0.31" }), {
    scheme: "exact", network: "eip155:8453", amount: "310000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: PAYER, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" },
  });
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(generatePrivateKey());
  const seen = [];
  const facilitator = { verify: async (p, t) => { seen.push({ p, t }); return { isValid: true }; }, settle: async () => ({ success: true, transaction: "0xfeed" }) };
  const ref = await buildRefunder({ signer: account, facilitator, maxUsd: 1, dailyMaxUsd: 1.5, log: {} });
  const paidBack = await ref.pay({ to: PAYER, usd: "0.90", reference: "T1" });
  const auth = seen[0].p.payload.authorization;
  assert.deepEqual(paidBack, { transaction: "0xfeed", nonce: auth.nonce, from: account.address }, "what a refund receipt names");
  assert.equal(auth.from, account.address);
  assert.equal(auth.to.toLowerCase(), PAYER);
  assert.equal(auth.value, "900000");
  await assert.rejects(ref.pay({ to: PAYER, usd: "1.50", reference: "T2" }), /REFUND_MAX_USD/);
  await assert.rejects(ref.pay({ to: PAYER, usd: "0.90", reference: "T3" }), /REFUND_DAILY_MAX_USD/);
  await assert.rejects(ref.pay({ to: account.address, usd: "0.10", reference: "T4" }), /cannot refund itself/);
  const refused = await buildRefunder({ signer: account, facilitator: { verify: async () => ({ isValid: false, invalidReason: "insufficient_funds" }) }, log: {} });
  await assert.rejects(refused.pay({ to: PAYER, usd: "0.10", reference: "T5" }), /insufficient_funds/);
});
