import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../../rails/src/order.js";
import { createOrders, jsonDb } from "../src/orders.js";

async function scenario(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), "esim-recovery-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const external = new Map();
  const state = { ready: false, purchases: 0, cancels: 0, settles: 0, orderCalls: 0,
                  loseReply: false, loseRecord: false, loseStorefront: false, outcome: "pending", enabled: true };
  const supplier = {
    kind: "audit-supplier", balance: async () => ({ usd: 100 }),
    async order({ transactionId }) {
      state.orderCalls++;
      if (!external.has(transactionId)) {
        state.purchases++;
        external.set(transactionId, { orderRef: "wholesale-1", profileId: "profile-123456", cancelled: false });
      }
      if (state.loseReply) { state.loseReply = false; throw Error("supplier reply lost after purchase"); }
      return { orderRef: external.get(transactionId).orderRef };
    },
    async profiles() {
      if (!state.ready) return [];
      return [...external.values()].map(p => ({ ...p, activationCode: "PRIVATE-LPA",
        state: p.cancelled ? "CANCEL" : "NEW" }));
    },
    async cancel() { state.cancels++; for (const p of external.values()) p.cancelled = true; return true; },
  };
  const method = { id: "signed", kind: "authorize", enabled: () => state.enabled, intent: () => ({}),
    verify: async () => ({ ok: true, ref: "payer:nonce", payer: "payer" }),
    prepare: async () => ({ saved_before_purchase: true }),
    reconcile: async () => ({ status: state.outcome, reason: "finalized evidence", transaction: "paid-tx" }),
    settle: async () => { state.settles++; return { ok: true, tx: "paid-tx" }; },
  };
  const open = () => {
    const records = fileStore(join(dir, "rails.json"), fs);
    const base = jsonDb(join(dir, "orders.json"), fs);
    const railsStore = { ...records, async put(id, record) {
      if (state.loseRecord && record.orderRef) {
        state.loseRecord = false; throw Error("crash before saving supplier response");
      }
      return records.put(id, record);
    } };
    const db = { ...base, async put(id, record) {
      if (state.loseStorefront && record.status === "settlement_pending") {
        state.loseStorefront = false; throw Error("crash before storefront settlement checkpoint");
      }
      return base.put(id, record);
    } };
    return createOrders({ db, railsStore, supplier, statusSecret: "audit-only-key", methods: [method],
      offersById: () => ({ offer_id: "plan", name: "Test", price: { usd: "5.00" }, _cost_usd: 3 }),
      allocationWaitMs: 0 });
  };
  const orders = open();
  const created = await orders.create({ offerId: "plan", methodId: "signed" });
  return { state, orders, created, open };
}

for (const boundary of ["allocation-timeout", "lost-supplier-reply", "lost-supplier-record", "lost-storefront-record"]) {
  test(`unpaid purchase recovers and cancels after restart: ${boundary}`, async t => {
    const s = await scenario(t);
    s.state.loseReply = boundary === "lost-supplier-reply";
    s.state.loseRecord = boundary === "lost-supplier-record";
    s.state.loseStorefront = boundary === "lost-storefront-record";
    s.state.ready = s.state.loseStorefront;
    await s.orders.authorize(s.created.order.id, s.created.token, {}).catch(() => {});
    assert.equal(s.state.purchases, 1);
    assert.equal(s.state.settles, 0);
    const recovered = s.open();
    s.state.enabled = false; // Recovery must survive switching new sales off.
    await recovered.reconcile();
    assert.equal(s.state.cancels, 0, "unknown payment never cancels wholesale");
    s.state.outcome = "unpaid";
    s.state.ready = false;
    await recovered.reconcile();
    assert.equal((await recovered.get(s.created.order.id, s.created.token)).status, "procurement_pending");
    s.state.ready = true;
    await recovered.reconcile();
    await recovered.reconcile();
    assert.equal(s.state.purchases, 1, "supplier idempotency key preserves one purchase");
    assert.equal(s.state.cancels, 1);
    assert.equal(s.state.settles, 0);
    assert.equal((await recovered.get(s.created.order.id, s.created.token)).status, "payment_failed");
  });
}

test("finalized payment recovers late allocation without settling a second time", async t => {
  const s = await scenario(t);
  const first = await s.orders.authorize(s.created.order.id, s.created.token, {});
  assert.equal(first.error, "allocation_pending");
  s.state.outcome = "paid";
  const recovered = s.open();
  await recovered.reconcile();
  assert.equal((await recovered.get(s.created.order.id, s.created.token)).status, "procurement_pending");
  s.state.ready = true;
  await recovered.reconcile();
  await recovered.reconcile();
  const page = await recovered.get(s.created.order.id, s.created.token);
  assert.equal(page.status, "delivered");
  assert.equal(page.esim.activation_code, "PRIVATE-LPA");
  assert.equal(s.state.purchases, 1);
  assert.equal(s.state.settles, 0);
  assert.equal(s.state.cancels, 0);
});
