// SUPPLIER=sample: the made-up catalogue behind ./onboard.sh --try.
import { test } from "node:test";
import assert from "node:assert/strict";
import { supplierFromEnv } from "../src/config.js";
import { offersFromPlans, quote } from "../src/offers.js";
import { samplePlans, sampleSupplier } from "../src/sample-supplier.js";
import { SupplierError } from "../src/supplier.js";

test("every sample plan becomes an offer and is marked as a sample", async () => {
  const plans = await sampleSupplier().catalog();
  assert.equal(plans.length, samplePlans().length);
  const offers = offersFromPlans(plans);
  assert.equal(offers.length, plans.length, "no sample plan is dropped as malformed");
  for (const p of plans) {
    assert.match(p.id, /^SAMPLE-/);
    assert.match(p.name, /^Sample · /);
  }
  const jp = quote(offers, { country: "JP", min_gb: 3, limit: 5 });
  assert.ok(jp.length >= 2, "Japan has 3 GB and 10 GB sample plans");
});

test("the sample supplier sells nothing", async () => {
  const s = sampleSupplier();
  await assert.rejects(s.order({ transactionId: "t1", planId: "SAMPLE-JP-3-15", costUsd: 3 }), SupplierError);
  assert.deepEqual(await s.profiles({ orderRef: "x" }), []);
  assert.equal(await s.balance(), null);
});

test("SUPPLIER=sample only in demo mode", () => {
  assert.throws(() => supplierFromEnv({ SUPPLIER: "sample" }), /DEMO_MODE=1/);
  assert.throws(() => supplierFromEnv({ SUPPLIER: "sample", DEMO_MODE: "0" }), /DEMO_MODE=1/);
  assert.equal(supplierFromEnv({ SUPPLIER: "sample", DEMO_MODE: "1" }).kind, "sample");
});

test("a demo node on the sample catalogue says its prices are made up", async () => {
  const { createNode, ed25519Signer } = await import("../src/node.js");
  const { fileStore } = await import("../src/order.js");
  const fs = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await fs.mkdtemp(join(tmpdir(), "esim-sample-"));
  const node = createNode({ supplier: sampleSupplier(), store: fileStore(join(dir, "o.json"), fs), secret: "s".repeat(32),
                            signer: ed25519Signer(), publicUrl: "http://localhost:9490", demo: true,
                            paywall: { middleware: (_q, _r, n) => n() }, log: { warn() {}, error() {} } });
  const server = await new Promise((r) => { const s = node.app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const o = await fetch(`http://127.0.0.1:${server.address().port}/order`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer_id: "SAMPLE-JP-3-15" }) });
    assert.equal(o.status, 403);
    const body = await o.json();
    assert.equal(body.error, "demo_mode");
    assert.match(body.message, /made-up sample prices/);
    assert.doesNotMatch(body.message, /live prices/);
  } finally { await new Promise((r) => server.close(r)); }
});
