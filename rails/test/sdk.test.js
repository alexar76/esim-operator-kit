// The SDK an existing operator onboards with: its own system as the supplier (HTTP), webhooks for
// its CRM and billing, the contract's schemas, and the conformance check.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operatorBackend } from "../examples/operator-backend.mjs";
import { checkSeller } from "../src/check.js";
import { httpSupplier, signSupplierRequest } from "../src/http-supplier.js";
import { createNode, ed25519Signer } from "../src/node.js";
import { fileStore } from "../src/order.js";
import { validate } from "../src/schema.js";
import { SupplierError } from "../src/supplier.js";
import { createWebhooks, verifyWebhook } from "../src/webhooks.js";
import * as sdk from "../src/index.js";

// The fixtures' prices below were worked out at a 20 % margin with a $0.30 floor; the default is 100 % and $1.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };
const SECRET = "operator-shared-secret-0123456789";
const PLANS = [
  { id: "FR-3GB-15D", name: "France 3 GB · 15 days", countries: ["FR"], kind: "country", data_bytes: 3 * 1024 ** 3, days: 15, speed: "4G/5G", cost_usd: 1.9 },
  { id: "EU-10GB-30D", name: "Europe 10 GB · 30 days", countries: ["FR", "DE", "ES"], kind: "region", data_bytes: 10 * 1024 ** 3, days: 30, speed: "5G", cost_usd: 6.5 },
];
const listen = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const paymentHeader = (b = "22") => Buffer.from(JSON.stringify({
  x402Version: 2, payload: { authorization: { from: "0x" + "cd".repeat(20), nonce: "0x" + b.repeat(32) }, signature: "0x00" } })).toString("base64");

async function stack({ events, allocateAfterMs = 0 } = {}) {
  const backend = await listen(operatorBackend({ secret: SECRET, plans: PLANS, allocateAfterMs }));
  const supplier = httpSupplier({ url: `http://127.0.0.1:${backend.address().port}`, secret: SECRET });
  const dir = await mkdtemp(join(tmpdir(), "esim-sdk-"));
  let node;
  node = createNode({ pricing: PRICING, supplier, store: fileStore(join(dir, "o.json"), fs), secret: "node-status-secret-0123456789", signer: ed25519Signer(),
    publicUrl: "https://op.example/agents", events, orderWaitMs: 5_000, log: { warn() {}, error() {} },
    paywall: { middleware: (req, res, next) => (req.get("payment-signature") ? next() : res.status(402).json({ x402Version: 2 })) } });
  const server = await listen(node.app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, h = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
  return { supplier, base, post, close: () => Promise.all([new Promise((r) => server.close(r)), new Promise((r) => backend.close(r))]) };
}

test("the operator's own system as the supplier: quote, order once, status, cancel — every answer in the contract's shape", async () => {
  const sent = [];
  const t = await stack({ events: { emit: (type, data) => sent.push({ type, data }) } });
  try {
    const q = await (await t.post("/quote", { country: "FR", limit: 5 })).json();
    assert.deepEqual(validate("quote-result", q.result), []);
    assert.deepEqual(q.result.offers.map((o) => o.offer_id), ["FR-3GB-15D", "EU-10GB-30D"]);
    assert.equal(q.result.offers[0].price.usd, "2.28");                   // $1.90 + 20 %
    assert.ok(!JSON.stringify(q).includes("cost"), "the operator's cost never reaches a buyer");
    const got = (await (await t.post("/order", { offer_id: "FR-3GB-15D" }, { "payment-signature": paymentHeader() })).json()).result;
    assert.deepEqual(validate("delivery", got), []);
    const again = (await (await t.post("/order", { offer_id: "FR-3GB-15D" }, { "payment-signature": paymentHeader() })).json()).result;
    assert.equal(again.esim_tran_no, got.esim_tran_no, "the same payment is the same order at the operator too");
    const st = await (await t.post("/status", { esim_tran_no: got.esim_tran_no, status_token: got.status_token })).json();
    assert.deepEqual(validate("status-result", st.result), []);
    assert.equal(sent[0].type, "agent_order.delivered");
    assert.equal(sent[0].data.esim_tran_no, got.esim_tran_no);
    assert.ok(!JSON.stringify(sent).includes("LPA:"), "no activation code in an event");
    assert.equal(await t.supplier.cancel({ profileId: got.esim_tran_no }), true);
    assert.equal((await t.supplier.balance()).usd, 250);
  } finally { await t.close(); }
});

test("the operator's system says no: a moved price is a 409 to the agent and never charged; an unsigned request is refused", async () => {
  const t = await stack();
  try {
    await assert.rejects(t.supplier.order({ transactionId: "mm-test-0001", planId: "FR-3GB-15D", costUsd: 1.5 }),
      (e) => e instanceof SupplierError && e.code === "price_changed" && !e.retryable);
    assert.equal((await t.supplier.catalog()).length, 2);
  } finally { await t.close(); }
  const backend = await listen(operatorBackend({ secret: SECRET, plans: PLANS }));
  try {
    const port = backend.address().port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/catalog`)).status, 401, "no signature, no catalogue");
    const ts = String(Date.now());
    const wrong = signSupplierRequest("another-secret-0123456789", ts, "GET", "/catalog");
    assert.equal((await fetch(`http://127.0.0.1:${port}/catalog`, { headers: { "x-kit-timestamp": ts, "x-kit-signature": wrong } })).status, 401);
    const stale = String(Date.now() - 10 * 60_000);
    const old = signSupplierRequest(SECRET, stale, "GET", "/catalog");
    assert.equal((await fetch(`http://127.0.0.1:${port}/catalog`, { headers: { "x-kit-timestamp": stale, "x-kit-signature": old } })).status, 401, "a replay is refused");
  } finally { await new Promise((r) => backend.close(r)); }
});

test("a profile the operator is still making is reported as allocation_pending, never settled", async () => {
  const t = await stack({ allocateAfterMs: 60_000 });
  try {
    const res = await t.post("/order", { offer_id: "FR-3GB-15D" }, { "payment-signature": paymentHeader("33") });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "allocation_pending");
  } finally { await t.close(); }
});

test("webhooks: signed, verifiable, retried on a 5xx, not retried on a 4xx", async () => {
  const got = [];
  let failFirst = true;
  const fetchImpl = async (url, init) => {
    got.push(init);
    if (failFirst) { failFirst = false; return new Response("down", { status: 503 }); }
    return new Response("ok");
  };
  const wh = createWebhooks({ url: "https://crm.example/hooks", secret: "webhook-secret-0123456789", fetchImpl, delaysMs: [1, 1], log: { warn() {} } });
  wh.emit("order.delivered", { order_id: "x" });
  await wh.flush();
  assert.equal(got.length, 2, "retried once after the 503");
  const h = got[1].headers;
  assert.equal(h["X-Kit-Event"], "order.delivered");
  assert.ok(verifyWebhook({ secret: "webhook-secret-0123456789", timestamp: h["X-Kit-Timestamp"], signature: h["X-Kit-Signature"], body: got[1].body }));
  assert.ok(!verifyWebhook({ secret: "webhook-secret-0123456789", timestamp: h["X-Kit-Timestamp"], signature: h["X-Kit-Signature"], body: got[1].body + " " }));
  assert.deepEqual(validate("webhook-event", JSON.parse(got[1].body)), []);
  const refused = [];
  const wh2 = createWebhooks({ url: "https://crm.example/hooks", secret: "webhook-secret-0123456789", delaysMs: [1, 1], log: { warn() {} },
                               fetchImpl: async (_u, init) => { refused.push(init); return new Response("no", { status: 400 }); } });
  wh2.emit("order.created", {});
  await wh2.flush();
  assert.equal(refused.length, 1);
  assert.throws(() => createWebhooks({ url: "http://crm.example/hooks", secret: "webhook-secret-0123456789" }), /https/);
  assert.equal(createWebhooks({}).enabled, false);
});

test("the conformance check passes the kit's own node and names what a broken one gets wrong", async () => {
  const t = await stack();
  try {
    // The listing names the node's public order URL; here it is served on this machine.
    const local = (url, init) => fetch(String(url).replace("https://op.example/agents", t.base), init);
    const results = await checkSeller(t.base, { country: "FR", fetchImpl: local });
    const failed = results.filter((r) => !r.ok);
    // The fake paywall answers 402 without x402 terms: the check must say so, and nothing else.
    assert.deepEqual(failed.map((r) => r.name), ["x402 terms"]);
    const tampered = await checkSeller(t.base, { country: "FR", fetchImpl: async (url, init) => {
      const res = await local(url, init);
      if (!String(url).endsWith("/quote") || init?.method !== "POST") return res;
      const body = await res.json();
      if (body.result?.offers?.[0]) body.result.offers[0].price.usd = "0.01";
      return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
    } });
    assert.ok(tampered.find((r) => r.name === "signature" && !r.ok), "a changed answer fails the signature");
  } finally { await t.close(); }
});

test("the SDK's public surface", () => {
  for (const k of ["createNode", "httpSupplier", "esimAccessSupplier", "createWebhooks", "verifyWebhook", "verifySupplierRequest",
                   "offersFromPlans", "validate", "checkSeller", "nodeToml", "createEsimAccessClient"]) assert.equal(typeof sdk[k], "function", k);
});

test("the webhook relay posts each signed event to Telegram and Slack, and refuses an unsigned one", async () => {
  const { relay } = await import("../examples/webhook-relay.mjs");
  const { signWebhook } = await import("../src/webhooks.js");
  const out = [];
  const app = relay({ secret: "relay-secret-0123456789", telegram: { token: "T", chat: "42" }, slackUrl: "https://hooks.slack.example/x",
                      fetchImpl: async (url, init) => { out.push([url, JSON.parse(init.body)]); return new Response("ok"); } });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/hooks/esim`;
  try {
    const body = JSON.stringify({ id: "e1", type: "order.delivered", created_at: "x", data: { order_id: "o1", offer_name: "Japan 5GB", price_usd: "6.40", cost_usd: 3.2 } });
    const ts = String(Date.now());
    const ok = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", "x-kit-timestamp": ts, "x-kit-signature": signWebhook("relay-secret-0123456789", ts, body) } });
    assert.equal(ok.status, 204);
    assert.equal(out.length, 2);
    assert.equal(out[0][1].chat_id, "42");
    assert.match(out[1][1].text, /Delivered o1: Japan 5GB — \$6\.40/);
    assert.equal((await fetch(url, { method: "POST", body, headers: { "content-type": "application/json" } })).status, 401);
  } finally { await new Promise((r) => server.close(r)); }
});
