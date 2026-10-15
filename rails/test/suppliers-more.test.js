// The ready adapters for Airalo and eSIM Go, against answers shaped like their published examples.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode, ed25519Signer } from "../src/node.js";
import { fileStore } from "../src/order.js";
import { validate } from "../src/schema.js";
import { SupplierError } from "../src/supplier.js";
import { airaloSupplier, esimGoSupplier } from "../src/suppliers-more.js";

// The fixtures' prices below were worked out at a 20 % margin with a $0.30 floor; the default is 100 % and $1.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeAiralo() {
  const calls = [];
  const orders = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}`);
    if (u.pathname === "/v2/token") {
      assert.equal(init.headers["content-type"], "application/x-www-form-urlencoded");
      assert.match(init.body, /grant_type=client_credentials/);
      return json({ data: { token_type: "Bearer", expires_in: 31622400, access_token: "tok" }, meta: { message: "success" } });
    }
    assert.equal(init.headers.authorization, "Bearer tok");
    if (u.pathname === "/v2/packages") {
      return json({ data: [{ slug: "japan", country_code: "JP", title: "Japan", operators: [{ id: 1, title: "Moshi Moshi", type: "local",
        rechargeability: true, install_window_days: 365, countries: [{ country_code: "JP", title: "Japan" }],
        coverages: [{ name: "JP", code: "JP", networks: [{ name: "Docomo", types: ["5G"] }] }],
        packages: [
          { id: "moshi-moshi-7days-1gb", type: "sim", title: "1 GB - 7 days", price: 4.5, net_price: 1.8, amount: 1024, day: 7, is_unlimited: false, prices: { net_price: { USD: 1.8 } } },
          { id: "moshi-moshi-unlimited", type: "sim", title: "Unlimited", price: 30, net_price: 20, amount: 0, day: 30, is_unlimited: true },
          { id: "moshi-topup-1gb", type: "topup", title: "1 GB", price: 4, net_price: 1.6, amount: 1024, day: 7, is_unlimited: false },
        ] }] }], meta: { message: "success" } });
    }
    if (u.pathname === "/v2/orders") {
      const f = init.body;
      assert.equal(f.get("quantity"), "1");
      assert.equal(f.get("type"), "sim");
      orders.push(f.get("description"));
      return json({ data: { id: 9666, code: "20261014-009666", package_id: f.get("package_id"), currency: "USD", price: 1.8,
        sims: [{ id: 11047, iccid: "891000000000009125", lpa: "lpa.airalo.com", matching_id: "TEST", qrcode: "LPA:1$lpa.airalo.com$TEST",
                 qrcode_url: "https://sandbox.airalo.com/qr?x", direct_apple_installation_url: "https://esimsetup.apple.com/x", apn_value: null }] },
        meta: { message: "success" } });
    }
    if (u.pathname === "/v2/sims/891000000000009125") {
      return json({ data: { iccid: "891000000000009125", lpa: "lpa.airalo.com", matching_id: "TEST", qrcode: "LPA:1$lpa.airalo.com$TEST",
        qrcode_url: "https://sandbox.airalo.com/qr?x", simable: { id: 9666, code: "20261014-009666" } }, meta: { message: "success" } });
    }
    if (u.pathname === "/v2/sims/891000000000009125/usage") {
      return json({ data: { remaining: 767, total: 1024, expired_at: "2026-10-21 00:00:00", is_unlimited: false, status: "ACTIVE" }, meta: { message: "api.succes" } });
    }
    if (u.pathname === "/v2/refund") {
      assert.deepEqual(init.body.getAll("iccids[]"), ["891000000000009125"]);
      assert.equal(init.body.get("reason"), "OTHERS");
      return json({ data: { refund_id: "12345" }, meta: { message: "success" } }, 202);
    }
    return json({ meta: { message: "not found" } }, 404);
  };
  return { fetchImpl, calls, orders };
}

test("Airalo: the catalogue as plans, one order per payment, the profile with its usage, a refund request", async () => {
  const f = fakeAiralo();
  const s = airaloSupplier({ clientId: "id", clientSecret: "secret", fetchImpl: f.fetchImpl });
  const plans = await s.catalog();
  assert.equal(plans.length, 1, "unlimited and top-up packages are left out of v1");
  assert.deepEqual({ ...plans[0], networks: undefined }, { id: "moshi-moshi-7days-1gb", name: "Japan 1 GB - 7 days", countries: ["JP"], kind: "country",
    data_bytes: 1024 * 1024 * 1024, days: 7, speed: "", networks: undefined, top_up: true, unused_valid_days: 365, cost_usd: 1.8 });
  await assert.rejects(s.order({ transactionId: "mm1", planId: "moshi-moshi-7days-1gb", costUsd: 1.5 }), (e) => e instanceof SupplierError && e.code === "price_changed");
  const [a, b] = await Promise.all([s.order({ transactionId: "mm1", planId: "moshi-moshi-7days-1gb", costUsd: 1.8 }),
                                    s.order({ transactionId: "mm1", planId: "moshi-moshi-7days-1gb", costUsd: 1.8 })]);
  assert.equal(a.orderRef, b.orderRef);
  assert.deepEqual(f.orders, ["mm1"], "one Airalo order for one payment");
  const [p] = await s.profiles({ orderRef: a.orderRef });
  assert.equal(p.activationCode, "LPA:1$lpa.airalo.com$TEST");
  const [st] = await s.profiles({ profileId: "891000000000009125" });
  assert.equal(st.dataTotalBytes, 1024 * 1024 * 1024);
  assert.equal(st.dataUsedBytes, 257 * 1024 * 1024);
  assert.equal(st.state, "ACTIVE");
  assert.equal(await s.cancel({ profileId: "891000000000009125" }), true);
  assert.equal(f.calls.filter((c) => c === "POST /v2/token").length, 1, "the token is kept");
  assert.equal(await s.balance(), null);
});

test("Airalo behind the seller node: quote and order in the contract's shape", async () => {
  const f = fakeAiralo();
  const dir = await mkdtemp(join(tmpdir(), "esim-airalo-"));
  const node = createNode({ pricing: PRICING, supplier: airaloSupplier({ clientId: "id", clientSecret: "secret", fetchImpl: f.fetchImpl }),
    store: fileStore(join(dir, "o.json"), fs), secret: "node-status-secret-0123456789", signer: ed25519Signer(),
    publicUrl: "https://op.example/agents", log: { warn() {}, error() {} },
    paywall: { middleware: (req, res, next) => (req.get("payment-signature") ? next() : res.status(402).end()) } });
  const server = await new Promise((r) => { const x = node.app.listen(0, "127.0.0.1", () => r(x)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b, h = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });
  try {
    const q = await (await post("/quote", { country: "JP" })).json();
    assert.deepEqual(validate("quote-result", q.result), []);
    assert.equal(q.result.offers[0].price.usd, "2.16");
    const pay = Buffer.from(JSON.stringify({ payload: { authorization: { from: "0x" + "ab".repeat(20), nonce: "0x" + "77".repeat(32) } } })).toString("base64");
    const d = (await (await post("/order", { offer_id: "moshi-moshi-7days-1gb" }, { "payment-signature": pay })).json()).result;
    assert.deepEqual(validate("delivery", d), []);
    assert.equal(d.esim_tran_no, "891000000000009125");
  } finally { await new Promise((r) => server.close(r)); }
});

test("eSIM Go: paged catalogue in MB, one order per payment, LPA from SM-DP+ and matching id, usage in bytes, revoke with refund", async () => {
  const calls = [];
  let orders = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}${u.search}`);
    assert.equal(init.headers["X-API-Key"], "key");
    if (u.pathname === "/v2.5/catalogue") {
      const page = Number(u.searchParams.get("page"));
      return json(page === 1 ? [
        { name: "esim_1GB_7D_FR_V2", description: "eSIM, 1GB, 7 Days, France, V2", countries: [{ name: "France", region: "Europe", iso: "FR" }],
          dataAmount: 1000, duration: 7, speed: ["4G", "5G"], unlimited: false, price: 1.5, billingType: "FixedCost" },
        { name: "esim_UL_1D_FR_V2", description: "Unlimited", countries: [{ iso: "FR" }], dataAmount: -1, duration: 1, unlimited: true, price: 3 },
      ] : []);
    }
    if (u.pathname === "/v2.5/orders") {
      orders++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { type: "transaction", assign: true, order: [{ type: "bundle", quantity: 1, item: "esim_1GB_7D_FR_V2", allowReassign: false }] });
      return json({ order: [{ type: "bundle", item: "esim_1GB_7D_FR_V2", quantity: 1, esims: [{ iccid: "8944538532046590000", matchingId: "ABC-123", smdpAddress: "rsp.esim-go.example" }] }],
        total: 1.5, currency: "USD", status: "Completed", statusMessage: "Order completed", orderReference: "a1b2c3" });
    }
    if (u.pathname === "/v2.5/esims/8944538532046590000") {
      return json({ iccid: "8944538532046590000", matchingId: "ABC-123", smdpAddress: "rsp.esim-go.example", appleInstallUrl: "https://esimsetup.apple.com/y",
                    firstInstalledDateTime: 1760000000000, state: "active" });
    }
    if (u.pathname === "/v2.5/esims/8944538532046590000/bundles") {
      return json({ bundles: [{ name: "esim_1GB_7D_FR_V2", assignments: [{ id: "offer-9", initialQuantity: 1_000_000_000, remainingQuantity: 600_000_000,
        bundleState: "active", startTime: "2026-10-14T10:00:00Z", endTime: "2026-10-21T10:00:00Z" }] }] });
    }
    if (u.pathname === "/v2.5/esims/8944538532046590000/bundles/esim_1GB_7D_FR_V2" && init.method === "DELETE") {
      assert.equal(u.searchParams.get("refundToBalance"), "true");
      assert.equal(u.searchParams.get("offerId"), "offer-9");
      return json({ status: "ok" });
    }
    return json({ message: "not found" }, 404);
  };
  const s = esimGoSupplier({ apiKey: "key", fetchImpl, perPage: 2 });
  const plans = await s.catalog();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].speed, "4G/5G");
  assert.equal(plans[0].data_bytes, 1000 * 1024 * 1024);
  const a = await s.order({ transactionId: "mm2", planId: "esim_1GB_7D_FR_V2", costUsd: 1.5 });
  const b = await s.order({ transactionId: "mm2", planId: "esim_1GB_7D_FR_V2", costUsd: 1.5 });
  assert.equal(orders, 1);
  assert.equal(a.orderRef, b.orderRef);
  assert.equal((await s.profiles({ orderRef: "a1b2c3" }))[0].activationCode, "LPA:1$rsp.esim-go.example$ABC-123");
  const [p] = await s.profiles({ profileId: "8944538532046590000" });
  assert.equal(p.dataUsedBytes, 400_000_000);
  assert.equal(p.installed, true);
  assert.equal(p.expires, "2026-10-21T10:00:00Z");
  assert.equal(await s.cancel({ profileId: "8944538532046590000" }), true);
  assert.ok(calls.some((c) => c.startsWith("DELETE /v2.5/esims/8944538532046590000/bundles/esim_1GB_7D_FR_V2")));
});
