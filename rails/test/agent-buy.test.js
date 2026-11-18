import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SupplierError } from "../src/esimaccess.js";
import { createNode, ed25519Signer } from "../src/node.js";
import { fileStore } from "../src/order.js";

// examples/agent-buy.mjs end to end, with its real x402 client, against kit nodes whose wholesale price moves
// between the quote and the order. A refused order charges nothing; the example then orders the cheapest offer
// it knows: the same seller at its new price, or another seller whose quote still holds. Payments are signed,
// never settled.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };   // cost $0.40 sells at $0.70, .42 at .72, .45 at .75, .50 at .80, .75 at $1.05
const GIB = 1024 ** 3;
const PAY_TO = "0x1111111111111111111111111111111111111111";
const EXAMPLE = fileURLToPath(new URL("../examples/agent-buy.mjs", import.meta.url));

function wholesaler(cost) {
  const state = { cost, orders: new Map(), costs: [] };
  return {
    state, kind: "test",
    async catalog() {
      return [{ id: "FR-1GB-7D", name: "France 1GB 7 days", countries: ["FR"], kind: "country", data_bytes: GIB, days: 7, cost_usd: state.cost }];
    },
    async order({ transactionId, costUsd }) {
      state.costs.push(costUsd);
      if (Math.abs(costUsd - state.cost) > 1e-9) throw new SupplierError("price_changed", "the plan's cost changed since the quote");
      if (!state.orders.has(transactionId)) state.orders.set(transactionId, { orderRef: `O${state.orders.size + 1}` });
      return { orderRef: state.orders.get(transactionId).orderRef };
    },
    async profiles({ orderRef, profileId }) {
      const o = [...state.orders.values()].find((x) => x.orderRef === orderRef || x.profileId === profileId);
      if (!o) return [];
      o.profileId ||= "260000000000001";
      return [{ profileId: o.profileId, orderRef: o.orderRef, activationCode: "LPA:1$rsp.example$SECRET", iccid: "8900000000000000001" }];
    },
    async cancel() { return true; },
    async balance() { return null; },
  };
}

/** x402 v2 as @x402/express answers it: a 402 with PAYMENT-REQUIRED for the price priceOf gives this body. */
const x402 = (node, signed) => ({
  middleware: (req, res, next) => {
    const sig = req.get("payment-signature");
    if (sig) { signed.push(JSON.parse(Buffer.from(sig, "base64").toString("utf8"))); return next(); }
    const usd = node().priceOf(req.body);
    const required = { x402Version: 2, error: "Payment required", resource: { url: `${req.protocol}://${req.get("host")}/order` }, accepts: [{
      scheme: "exact", network: "eip155:8453", amount: String(Math.round(Number(usd) * 1e6)),
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }] };
    res.status(402).set("payment-required", Buffer.from(JSON.stringify(required)).toString("base64")).json({});
  },
});

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
};

/**
 * A kit node selling FR-1GB-7D at `cost` + margin. `moveTo`: the wholesale cost when its first order arrives
 * (after the quote). `tokens: false` is a node that keeps no quoted price (QUOTE_TTL_SECONDS=0, as before
 * kit 0.5) and reads its catalogue on every request, so its order asks today's price.
 */
async function sellerNode(dir, name, { cost, moveTo = null, tokens = true }) {
  const supplier = wholesaler(cost);
  const signed = [];
  const recoveries = new Set();
  let node;
  let moved = false;
  const s = await listen((req, res) => {
    if (req.url === "/order") {
      recoveries.add(req.headers["x-esim-recovery"]);
      if (!moved && moveTo !== null) { moved = true; supplier.state.cost = moveTo; }
    }
    node.app(req, res);
  });
  node = createNode({ pricing: PRICING, supplier, store: fileStore(join(dir, `${name.replace(/\W/g, "")}.json`), fs),
                      secret: "test-status-secret-0123456789", signer: ed25519Signer(), log: { warn() {}, error() {} },
                      publicUrl: s.url, paywall: x402(() => node, signed), orderWaitMs: 2_000, sellerName: name,
                      ...(tokens ? {} : { quoteTtlMs: 0, catalogTtlMs: 0 }) });
  return { ...s, supplier, signed, recoveries };
}

/** A hub as modelmarket.dev answers: /search lists each seller's esim.quote@v1, /invoke relays the quote. */
async function hub(sellers) {
  return listen(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const json = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith("/ai-market/v2/search")) {
      return json(200, { matches: sellers.map((s, i) => ({ capability_id: "esim.quote@v1", product_id: `esim-${i}`, source_hub: s.url })) });
    }
    if (req.url === "/ai-market/v2/invoke") {
      const s = sellers[Number(JSON.parse(body).product_id.split("-")[1])];
      const r = await fetch(`${s.url}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JSON.parse(body).input) });
      return json(200, { success: true, result: await r.json(), price_usd: 0, routed_via: "hub" });
    }
    return json(404, {});
  });
}

const run = (args, key) => new Promise((resolve) => execFile(process.execPath, [EXAMPLE, ...args],
  { env: { ...process.env, AGENT_PRIVATE_KEY: key }, timeout: 60_000 },
  (err, out, errOut) => resolve({ code: err ? err.code ?? 1 : 0, stdout: String(out), stderr: String(errOut) })));

test("agent-buy sends the quote's token, takes the fresh offer a refused order brings, and pays the kept price", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-agent-buy-"));
  const a = await sellerNode(dir, "eSIM seller", { cost: 0.4, moveTo: 0.45 });
  const key = generatePrivateKey();
  const output = join(dir, "delivery.json");
  try {
    const { code, stdout, stderr } = await run([a.url, "FR", "--yes", "--max-usd", "1", "--output", output, "--no-share"], key);
    assert.equal(code, 0, stderr || stdout);
    assert.match(stdout, /0\.70 USDC, from eSIM seller; price kept until \d{4}-/);
    assert.match(stdout, /supplier_price_changed: not charged; eSIM seller now asks 0\.70 USDC, kept until \d{4}-.*\nordering again from eSIM seller at 0\.70 USDC/);
    assert.match(stdout, /delivered {2}esim_tran_no 260000000000001/);
    assert.equal(a.signed.length, 2, "one refused payment, never settled, and the one that bought");
    assert.equal(a.signed[1].payload.authorization.value, "700000", "the quoted price, not today's $0.75");
    assert.equal(a.signed[1].payload.authorization.from, privateKeyToAccount(key).address);
    assert.deepEqual(a.supplier.state.costs, [0.4, 0.45]);
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal(saved.status, "delivered");
    assert.equal(saved.delivery.offer.price.usd, "0.70");
  } finally { await a.close(); }
});

test("agent-buy goes to another seller whose quote still holds when the refused seller's price rose above it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-agent-buy-"));
  const a = await sellerNode(dir, "Seller A", { cost: 0.4, moveTo: 0.75 });   // quotes 0.70; wholesale passes it: now 1.05
  const b = await sellerNode(dir, "Seller B", { cost: 0.42 });               // quotes 0.72
  const h = await hub([a, b]);
  const output = join(dir, "delivery.json");
  try {
    // --max-usd 2: Seller A's new price is within the cap, so the comparison, not the cap, makes the choice.
    const { code, stdout, stderr } = await run(["FR", "--hub", h.url, "--yes", "--max-usd", "2", "--output", output, "--no-share"], generatePrivateKey());
    assert.equal(code, 0, stderr || stdout);
    assert.match(stdout, /0\.70 USDC, from Seller A; price kept until/);
    assert.match(stdout, /supplier_price_changed: not charged; Seller A now asks 1\.05 USDC, kept until \d{4}-/);
    assert.match(stdout, /cheaper now: FR-1GB-7D at 0\.72 USDC from Seller B \(its quote holds until \d{4}-[^)]+\) — ordering there/);
    assert.equal(a.signed.length, 1, "Seller A: the refused order only (signed, never settled)");
    assert.deepEqual(a.supplier.state.costs, [0.4]);
    assert.equal(b.signed.length, 1);
    assert.equal(b.signed[0].payload.authorization.value, "720000", "Seller B's quoted price");
    assert.deepEqual(b.supplier.state.costs, [0.42]);
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal(saved.status, "delivered");
    assert.equal(saved.seller, `${b.url}/order`);
    // Each seller got its own recovery value: Seller A never saw the one that recovers Seller B's order.
    assert.deepEqual([...b.recoveries], [saved.recovery_token]);
    assert.equal(a.recoveries.size, 1);
    assert.ok(!a.recoveries.has(saved.recovery_token));
  } finally { await Promise.all([a.close(), b.close(), h.close()]); }
});

test("agent-buy stays with the refused seller when the price it keeps is still the cheapest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-agent-buy-"));
  const a = await sellerNode(dir, "Seller A", { cost: 0.4, moveTo: 0.45 });   // quotes 0.70 and keeps it: cost 0.45 is below it
  const b = await sellerNode(dir, "Seller B", { cost: 0.42 });               // quotes 0.72
  const h = await hub([a, b]);
  const output = join(dir, "delivery.json");
  try {
    const { code, stdout, stderr } = await run(["FR", "--hub", h.url, "--yes", "--max-usd", "2", "--output", output, "--no-share"], generatePrivateKey());
    assert.equal(code, 0, stderr || stdout);
    assert.match(stdout, /supplier_price_changed: not charged; Seller A now asks 0\.70 USDC, kept until .*\nordering again from Seller A at 0\.70 USDC/);
    assert.equal(a.signed.length, 2);
    assert.equal(a.signed[1].payload.authorization.value, "700000");
    assert.equal(b.signed.length, 0, "Seller B is not asked");
    assert.equal(JSON.parse(await readFile(output, "utf8")).seller, `${a.url}/order`);
  } finally { await Promise.all([a.close(), b.close(), h.close()]); }
});

test("agent-buy signs nothing for a seller that asks more than its quote, and buys the cheapest offer left", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-agent-buy-"));
  const a = await sellerNode(dir, "Seller A", { cost: 0.4, moveTo: 0.5, tokens: false });   // quotes 0.70, asks 0.80 at the order
  const b = await sellerNode(dir, "Seller B", { cost: 0.42 });
  const h = await hub([a, b]);
  const output = join(dir, "delivery.json");
  try {
    const { code, stdout, stderr } = await run(["FR", "--hub", h.url, "--yes", "--max-usd", "2", "--output", output, "--no-share"], generatePrivateKey());
    assert.equal(code, 0, stderr || stdout);
    assert.match(stdout, /0\.70 USDC, from Seller A\n/, "no quote_token: no kept price");
    assert.match(stdout, /asks_more: not charged; Seller A now asks 0\.80 USDC\ncheaper now: FR-1GB-7D at 0\.72 USDC from Seller B/);
    assert.equal(a.signed.length, 0, "nothing signed for Seller A");
    assert.deepEqual(a.supplier.state.costs, []);
    assert.equal(b.signed[0].payload.authorization.value, "720000");
  } finally { await Promise.all([a.close(), b.close(), h.close()]); }
});

test("agent-buy pays a seller's new price when no other offer is cheaper, and never above --max-usd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-agent-buy-"));
  const a = await sellerNode(dir, "Seller A", { cost: 0.4, moveTo: 0.75 });   // 0.70, then 1.05
  try {
    const within = await run([a.url, "FR", "--yes", "--max-usd", "2", "--output", join(dir, "d1.json"), "--no-share"], generatePrivateKey());
    assert.equal(within.code, 0, within.stderr || within.stdout);
    assert.match(within.stdout, /Seller A now asks 1\.05 USDC, kept until .*\nordering again from Seller A at 1\.05 USDC/);
    assert.equal(a.signed.at(-1).payload.authorization.value, "1050000");
  } finally { await a.close(); }
  const c = await sellerNode(dir, "Seller C", { cost: 0.4, moveTo: 0.75 });
  try {
    const above = await run([c.url, "FR", "--yes", "--max-usd", "1", "--output", join(dir, "d2.json"), "--no-share"], generatePrivateKey());
    assert.notEqual(above.code, 0);
    assert.match(above.stderr, /no offer left within --max-usd 1/);
    assert.equal(c.signed.length, 1, "only the refused order: nothing paid");
    assert.equal(JSON.parse(await readFile(join(dir, "d2.json"), "utf8")).status, "payment_submitted");
  } finally { await c.close(); }
});
