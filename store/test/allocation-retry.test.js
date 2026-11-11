// Audit 2026-11-11, desks-stripe-1: a paid order whose profile the wholesaler was still allocating
// became a terminal refund_due after the allocation wait — the eSIM was already bought, the card was
// charged, and nothing ever retried the delivery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupplierError } from "../../rails/src/esimaccess.js";
import { offersFromEsimAccess } from "../../rails/src/offers.js";
import { fileStore } from "../../rails/src/order.js";
import { createOrders, jsonDb } from "../src/orders.js";
import { stripeCards } from "../src/payments/stripe.js";

const rails = (name) => JSON.parse(readFileSync(new URL(`../../rails/test/fixtures/${name}`, import.meta.url), "utf8"));
const OFFERS = offersFromEsimAccess(rails("package-list.json").obj.packageList, { marginPct: 20, minMarginUsd: 0.3 });
const PROFILE = rails("esim-query.json").obj.esimList[0];
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function slowSupplier({ readyAfter = 2, refuseOrder = null } = {}) {
  const calls = { order: 0, profiles: 0 };
  let placed = null;
  return {
    calls,
    async balance() { return { units: 10_000_000 }; },
    async order() {
      calls.order++;
      if (refuseOrder) throw new SupplierError(refuseOrder, "refused");
      placed ||= { orderNo: "B1" };
      return { orderNo: placed.orderNo };
    },
    async profiles() {
      calls.profiles++;
      if (!placed || calls.profiles <= readyAfter) return [];
      return [{ ...PROFILE, orderNo: placed.orderNo, esimTranNo: "20000000000001" }];
    },
    async cancel() { return true; },
  };
}

async function paidByCard(supplier, now = () => Date.now()) {
  const dir = await mkdtemp(join(tmpdir(), "esim-retry-"));
  const stripeFetch = async () => json({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" });
  const byId = new Map(OFFERS.map((o) => [o.offer_id, o]));
  const orders = createOrders({ db: jsonDb(join(dir, "orders.json"), fs), supplier, railsStore: fileStore(join(dir, "rails.json"), fs),
                                statusSecret: "store-status-secret-0123456789",
                                methods: [stripeCards({ secretKey: "sk_test_x", webhookSecret: "whsec_x", fetchImpl: stripeFetch })],
                                offersById: (id) => byId.get(id), now, log: { error() {} }, allocationWaitMs: 0 });
  const { order, token } = await orders.create({ offerId: "ES_5_30", methodId: "stripe" });
  await orders.cardCheckout(order.id, token, "https://shop.example/o/x");
  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: {
    id: "cs_1", mode: "payment", currency: "usd", payment_status: "paid", client_reference_id: order.id, payment_intent: "pi_1", amount_total: 540 } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac("sha256", "whsec_x").update(`${t}.${event}`).digest("hex")}`;
  const paid = await orders.cardPaid(event, sig);
  return { orders, order, token, paid };
}

test("a paid order still allocating waits and is delivered by reconcile, bought once", async () => {
  const supplier = slowSupplier({ readyAfter: 2 });
  const { orders, order, token, paid } = await paidByCard(supplier);
  assert.equal(paid.order.status, "procurement_pending");
  await orders.reconcile();
  assert.equal((await orders.get(order.id, token)).status, "procurement_pending");
  await orders.reconcile();
  assert.equal((await orders.get(order.id, token)).status, "delivered");
  assert.equal(supplier.calls.order, 1);
});

test("a definite refusal is still refund_due, and a day of waiting gives up", async () => {
  const refused = await paidByCard(slowSupplier({ refuseOrder: "200005" }));
  assert.equal(refused.paid.order.status, "refund_due");

  let clock = Date.now();
  const stuck = await paidByCard(slowSupplier({ readyAfter: 1_000 }), () => clock);
  assert.equal(stuck.paid.order.status, "procurement_pending");
  clock += 25 * 3_600_000;
  await stuck.orders.reconcile();
  const view = await stuck.orders.get(stuck.order.id, stuck.token);
  assert.equal(view.status, "refund_due");
  assert.equal(view.error, "allocation_timeout");
});
