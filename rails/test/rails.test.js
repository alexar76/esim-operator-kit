// Fixtures follow the response shapes in eSIM Access's own documentation (docs.esimaccess.com);
// package-list.json adds plans beyond the documented one (Spain, a regional and a day pass) so
// ranking and filtering have something to rank. The regional plan's comma-separated `location`
// is how the live catalogue reads (checked 2026-10-14: 234 of 1 728 plans, e.g. EU-42_3_30).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, sign, SupplierError } from "../src/esimaccess.js";
import { offersFromEsimAccess, priceCents, quote } from "../src/offers.js";
import { fileStore, fulfil, release, status, statusToken, transactionIdFor } from "../src/order.js";

// The fixtures' prices below were worked out at a 20 % margin with a $0.30 floor; the default is 100 % and $1.
const PRICING = { marginPct: 20, minMarginUsd: 0.3 };
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const PACKAGES = fixture("package-list.json").obj.packageList;
const PROFILE = fixture("esim-query.json").obj.esimList[0];

test("requests are signed the way the supplier documents it (its own test vector)", () => {
  const sig = sign({ timestamp: "1628670421", requestId: "4ce9d9cdac9e4e17b3a2c66c358c1ce2", accessCode: "11111",
                     body: '{"imsi":"326543826"}', secretKey: "1111" });
  assert.equal(sig, "7EB765E27DF5373DEA2DBC8C41A7D9557743E46C8054750F3D851B3FD01D0835".toLowerCase());
});

test("the client sends the four headers, the keys only to the supplier, and reports refusals by code", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.endsWith("/balance/query")) return new Response(JSON.stringify({ success: true, obj: { balance: 940000 } }));
    return new Response(JSON.stringify({ success: false, errorCode: "310404", errorMsg: "the merchant has not the iccid." }));
  };
  const client = createClient({ accessCode: "AC123456", secretKey: "SK-secret", fetchImpl, now: () => 1700000000000,
                                uuid: () => "11111111-2222-3333-4444-555555555555", base: "https://api.example" });
  assert.deepEqual(await client.balance(), { units: 940000, updated: null });
  const h = calls[0].headers;
  assert.equal(calls[0].url, "https://api.example/api/v1/open/balance/query");
  assert.equal(h["RT-AccessCode"], "AC123456");
  assert.equal(h["RT-RequestID"], "11111111222233334444555555555555");
  assert.equal(h["RT-Timestamp"], "1700000000000");
  assert.equal(h["RT-Signature"], sign({ timestamp: "1700000000000", requestId: "11111111222233334444555555555555",
                                         accessCode: "AC123456", body: "{}", secretKey: "SK-secret" }));
  assert.ok(!JSON.stringify(calls).includes("SK-secret"), "the secret key is never sent");
  await assert.rejects(client.cancel({ esimTranNo: "1" }), (e) => e instanceof SupplierError && e.code === "310404"
    && !e.retryable && !e.message.includes("SK-secret"));
});

test("the seller's price is wholesale plus a margin with a floor, rounded up to the cent", () => {
  assert.equal(priceCents(11.25, PRICING), 1350);               // $11.25 + 20 % = $13.50
  assert.equal(priceCents(1, PRICING), 130);                    // $1.00: the $0.30 floor beats 20 %
  assert.equal(priceCents(4.5, { marginPct: 10, minMarginUsd: 0 }), 495);
  assert.equal(priceCents(3.3333, PRICING), 400);               // $3.3333 × 1.2 = 3.99996 → $4.00
  // The default, what .env.example and the guides say: the price doubles, and at least $1 is added.
  assert.equal(priceCents(11.25), 2250);
  assert.equal(priceCents(0.7), 170);                           // France 1 GB / 7 days in the operator guide
  assert.equal(priceCents(9), 1800);
  assert.equal(priceCents(0), null);
  assert.equal(priceCents(NaN), null);
});

test("packages become offers: fixed plans only, no wholesale price in what a buyer sees", () => {
  const offers = offersFromEsimAccess(PACKAGES, PRICING);
  assert.deepEqual(offers.map((o) => o.offer_id), ["SI_5_30", "ES_5_30", "EU-30_3_7"]);   // the day pass is left out
  const es = offers.find((o) => o.offer_id === "ES_5_30");
  assert.equal(es.data_gb, 5);
  assert.equal(es.days, 30);
  assert.deepEqual(es.coverage, { kind: "country", countries: ["ES"] });
  assert.equal(es.price.usd, "5.40");
  assert.equal(es.usd_per_gb, 1.08);
  assert.equal(es.top_up, false);
  assert.deepEqual(es.networks[0].operators.map((o) => o.name), ["Movistar", "Vodafone"]);
  const eu = offers.find((o) => o.offer_id === "EU-30_3_7");
  assert.equal(eu.coverage.kind, "region");
  const quoted = quote(offers, { country: "es" });
  assert.deepEqual(quoted.map((o) => o.offer_id), ["EU-30_3_7", "ES_5_30"], "cheapest first, regional plans count");
  assert.ok(!JSON.stringify(quoted).includes("_wholesale") && !JSON.stringify(quoted).includes("45000"));
  assert.deepEqual(quote(offers, { country: "ES", min_gb: 4 }).map((o) => o.offer_id), ["ES_5_30"]);
  assert.deepEqual(quote(offers, { country: "ES", max_usd: 1 }), []);
  assert.throws(() => quote(offers, { country: "Spain" }), /alpha-2/);
});

function fakeSupplier({ allocateAfter = 1, refuse = null } = {}) {
  const orders = new Map();
  const calls = { order: 0, profiles: 0, cancel: 0 };
  return {
    calls,
    client: {
      async order({ transactionId, slug, priceUnits }) {
        calls.order++;
        if (refuse) throw new SupplierError(refuse, "refused");
        if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}`, slug, priceUnits, polls: 0 });
        return { orderNo: orders.get(transactionId).orderNo, transactionId };
      },
      async profiles({ orderNo, esimTranNo }) {
        calls.profiles++;
        const o = [...orders.values()].find((x) => x.orderNo === orderNo || (esimTranNo && x.tran === esimTranNo));
        if (!o) return [];
        o.polls++;
        if (o.polls <= allocateAfter && !o.tran) throw new SupplierError("200010", "allocating", { retryable: true });
        o.tran = o.tran || `2${o.orderNo.slice(1).padStart(13, "0")}`;
        return [{ ...PROFILE, orderNo: o.orderNo, esimTranNo: o.tran }];
      },
      async cancel() { calls.cancel++; return true; },
    },
  };
}

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "esim-rails-"));
  const path = join(dir, "orders.json");
  return { path, store: fileStore(path, fs) };
}

const OFFER = offersFromEsimAccess(PACKAGES, PRICING).find((o) => o.offer_id === "ES_5_30");
const fast = { sleep: async () => {}, maxWaitMs: 60_000 };

test("one payment buys one profile: a retry finds the same order, and no activation code is stored", async () => {
  const sup = fakeSupplier({ allocateAfter: 2 });
  const { path, store } = await tempStore();
  const first = await fulfil({ client: sup.client, store, secret: "s", offer: OFFER, paymentRef: "pay-1", ...fast });
  assert.equal(first.delivery.activation_code, PROFILE.ac);
  assert.equal(first.delivery.status_token, statusToken("s", first.delivery.esim_tran_no));
  const again = await fulfil({ client: sup.client, store, secret: "s", offer: OFFER, paymentRef: "pay-1", ...fast });
  assert.equal(again.delivery.esim_tran_no, first.delivery.esim_tran_no);
  assert.equal(sup.calls.order, 1, "the retry did not order again");
  const other = await fulfil({ client: sup.client, store, secret: "s", offer: OFFER, paymentRef: "pay-2", ...fast });
  assert.notEqual(other.delivery.esim_tran_no, first.delivery.esim_tran_no);
  const disk = await readFile(path, "utf8");
  assert.ok(!disk.includes("LPA:") && !disk.includes(PROFILE.ac) && !disk.includes("qrsim"), "the store never holds an activation code");
  assert.match(transactionIdFor("pay-1"), /^mm[0-9a-f]{40}$/);
});

test("the order carries the wholesale price, so a plan that changed price is refused rather than charged", async () => {
  const seen = [];
  const sup = fakeSupplier();
  const client = { ...sup.client, order: async (a) => { seen.push(a); return sup.client.order(a); } };
  const { store } = await tempStore();
  await fulfil({ client, store, secret: "s", offer: OFFER, paymentRef: "p", ...fast });
  assert.equal(seen[0].priceUnits, 45000);
  assert.equal(seen[0].slug, "ES_5_30");
});

test("a refused order buys nothing; a slow allocation is reported, not settled, and resumes on retry", async () => {
  const refused = fakeSupplier({ refuse: "200005" });
  const a = await tempStore();
  await assert.rejects(fulfil({ client: refused.client, store: a.store, secret: "s", offer: OFFER, paymentRef: "p", ...fast }),
                       (e) => e.code === "200005");
  assert.equal(await a.store.get(transactionIdFor("p")), null);
  const slow = fakeSupplier({ allocateAfter: 1000 });
  const b = await tempStore();
  let t = 0;
  await assert.rejects(fulfil({ client: slow.client, store: b.store, secret: "s", offer: OFFER, paymentRef: "p",
                                sleep: async (ms) => { t += ms; }, now: () => t, maxWaitMs: 10_000 }),
                       (e) => e.code === "allocation_pending");
  assert.ok((await b.store.get(transactionIdFor("p"))).orderRef, "the order is remembered for the retry");
});

test("an unsettled payment cancels the delivered profile", async () => {
  const sup = fakeSupplier();
  const { store } = await tempStore();
  const { transactionId } = await fulfil({ client: sup.client, store, secret: "s", offer: OFFER, paymentRef: "p", ...fast });
  assert.equal(await release({ client: sup.client, store, transactionId }), true);
  assert.equal(sup.calls.cancel, 1);
  assert.equal((await store.get(transactionId)).released, true);
  assert.equal(await release({ client: sup.client, store, transactionId: "unknown" }), false);
});

test("status answers the holder of the token only", async () => {
  const sup = fakeSupplier();
  const { store } = await tempStore();
  const { delivery } = await fulfil({ client: sup.client, store, secret: "s", offer: OFFER, paymentRef: "p", ...fast });
  const st = await status({ client: sup.client, secret: "s", esimTranNo: delivery.esim_tran_no, token: delivery.status_token });
  assert.equal(st.state, "GOT_RESOURCE");
  assert.equal(st.installed, false);
  assert.equal(st.data_total_bytes, 5368709120);
  for (const token of ["", "x", statusToken("other-secret", delivery.esim_tran_no)]) {
    await assert.rejects(status({ client: sup.client, secret: "s", esimTranNo: delivery.esim_tran_no, token }),
                         (e) => e.code === "not_found");
  }
});
