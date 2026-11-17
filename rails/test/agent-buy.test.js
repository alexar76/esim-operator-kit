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

// examples/agent-buy.mjs end to end, with its real x402 client, against a kit node whose wholesaler moves its
// price between the quote and the order: the first order is refused (nothing charged) with current_offer,
// the example takes it once, and pays the quoted price the node keeps. Payments are signed, never settled.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };          // cost $0.40 sells at $0.70, $0.45 at $0.75
const GIB = 1024 ** 3;
const PAY_TO = "0x1111111111111111111111111111111111111111";
const EXAMPLE = fileURLToPath(new URL("../examples/agent-buy.mjs", import.meta.url));

function wholesaler() {
  const state = { cost: 0.4, orders: new Map(), costs: [], moveOnFirstOrder: true };
  return {
    state, kind: "test",
    async catalog() {
      return [{ id: "FR-1GB-7D", name: "France 1GB 7 days", countries: ["FR"], kind: "country", data_bytes: GIB, days: 7, cost_usd: state.cost }];
    },
    async order({ transactionId, costUsd }) {
      state.costs.push(costUsd);
      if (state.moveOnFirstOrder) { state.moveOnFirstOrder = false; state.cost = 0.45; }
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

test("agent-buy sends the quote's token, takes the fresh offer a refused order brings, and pays the kept price", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-agent-buy-"));
  const supplier = wholesaler();
  const signed = [];
  // The node names its own /order in every quote: listen first, then make the node with that address.
  let node;
  const server = createServer((req, res) => node.app(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const seller = `http://127.0.0.1:${server.address().port}`;
  node = createNode({ pricing: PRICING, supplier, store: fileStore(join(dir, "orders.json"), fs), secret: "test-status-secret-0123456789",
                      signer: ed25519Signer(), log: { warn() {}, error() {} }, publicUrl: seller, paywall: x402(() => node, signed), orderWaitMs: 2_000 });
  const key = generatePrivateKey();
  const output = join(dir, "delivery.json");
  try {
    const { code, stdout, stderr } = await new Promise((resolve) => execFile(process.execPath,
      [EXAMPLE, seller, "FR", "--yes", "--max-usd", "1", "--output", output, "--no-share"],
      { env: { ...process.env, AGENT_PRIVATE_KEY: key }, timeout: 60_000 },
      (err, out, errOut) => resolve({ code: err ? err.code ?? 1 : 0, stdout: String(out), stderr: String(errOut) })));
    assert.equal(code, 0, stderr || stdout);
    assert.match(stdout, /0\.70 USDC, from eSIM seller; price kept until \d{4}-/);
    assert.match(stdout, /supplier_price_changed: not charged; the offer is now 0\.70 USDC, kept until/);
    assert.match(stdout, /delivered {2}esim_tran_no 260000000000001/);
    assert.equal(signed.length, 2, "one refused payment, never settled, and the one that bought");
    assert.equal(signed[1].payload.authorization.value, "700000", "the quoted price, not today's $0.75");
    assert.equal(signed[1].payload.authorization.from, privateKeyToAccount(key).address);
    assert.deepEqual(supplier.state.costs, [0.4, 0.45]);
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal(saved.status, "delivered");
    assert.equal(saved.delivery.offer.price.usd, "0.70");
  } finally { await new Promise((r) => server.close(r)); }
});
