import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createPublicKey, verify as edVerify } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupplierError } from "../src/esimaccess.js";
import { boundCanonical, canonicalJson, createNode, ed25519Signer, paymentRefOf } from "../src/node.js";
import { fileStore, transactionIdFor } from "../src/order.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const PACKAGES = fixture("package-list.json").obj.packageList;
const PROFILE = fixture("esim-query.json").obj.esimList[0];
const SECRET = "test-status-secret-0123456789";

test("the canonical JSON is byte for byte what the hub's Python writes", () => {
  const sample = { result: { offers: [{ data_gb: 0.49, usd_per_gb: 1.08, days: 7, name: "Côte d’Ivoire 1GB", ok: true, none: null }],
                             seller: { name: "x", product_id: "esim-rails" } }, b: [3, 2, 1], a: "é \u0001" };
  const py = execFileSync("python3", ["-c",
    "import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, separators=(',', ':'), ensure_ascii=False), end='')"],
    { input: JSON.stringify(sample) }).toString("utf8");
  assert.equal(canonicalJson(sample), py);
});

function verifies(pubkeyB64, text, sigB64) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubkeyB64, "base64")]);
  return edVerify(null, Buffer.from(text, "utf8"), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(sigB64, "base64"));
}

function fakeSupplier({ refuse = null, failCatalogue = false } = {}) {
  const orders = new Map();
  const calls = { order: 0, cancel: 0, packages: 0 };
  return {
    calls,
    async packages() { calls.packages++; if (failCatalogue) throw new SupplierError("http_503", "down", { retryable: true }); return PACKAGES; },
    async order({ transactionId }) {
      calls.order++;
      if (refuse) throw new SupplierError(refuse, "refused");
      if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}` });
      return { orderNo: orders.get(transactionId).orderNo, transactionId };
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

/** Stands in for @x402/express: no payment header → 402 with the dynamic price; with one → the order runs. */
const fakePaywall = (node) => ({
  middleware: (req, res, next) => (req.get("payment-signature")
    ? next() : res.status(402).json({ x402Version: 2, price: `$${node().priceOf(req.body?.offer_id)}` })),
});
const paymentHeader = (nonceByte = "11") => Buffer.from(JSON.stringify({
  x402Version: 2, payload: { authorization: { from: "0x" + "ab".repeat(20), nonce: "0x" + nonceByte.repeat(32) }, signature: "0x00" },
})).toString("base64");

async function serve({ supplier = fakeSupplier(), paid = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "esim-node-"));
  const storePath = join(dir, "orders.json");
  let node;
  node = createNode({ supplier, store: fileStore(storePath, fs), secret: SECRET, signer: ed25519Signer(), log: { warn() {}, error() {} },
                      publicUrl: "https://seller.example/esim", paywall: paid ? fakePaywall(() => node) : null, orderWaitMs: 5_000 });
  const server = await new Promise((r) => { const s = node.app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, headers = {}) => fetch(base + path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { node, supplier, storePath, call, close: () => new Promise((r) => server.close(r)) };
}

test("esim.quote answers as a hub provider: signed over the request it answers, offers cheapest first", async () => {
  const t = await serve();
  try {
    const listing = await (await t.call("/listing.json")).json();
    const pubkey = listing.listings[0].provider_pubkey;
    assert.deepEqual(listing.listings.map((l) => l.capability_id), ["esim.quote@v1", "esim.status@v1"]);
    assert.equal(listing.listings[0].invoke_url, "https://seller.example/esim/quote/invoke");
    assert.equal(listing.order.url, "https://seller.example/esim/order");
    const body = { capability_id: "esim.quote@v1", product_id: "esim-rails", input: { country: "ES", min_gb: 1 } };
    const res = await t.call("/quote/invoke", body);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.deepEqual(doc.result.offers.map((o) => o.offer_id), ["EU-30_3_7", "ES_5_30"]);
    assert.ok(!JSON.stringify(doc).includes("_wholesale"));
    assert.ok(verifies(pubkey, boundCanonical("esim.quote@v1", "esim-rails", body.input, doc.result), res.headers.get("x-provider-signature")),
              "the hub's request-bound canonical verifies");
    assert.equal((await t.call("/quote/invoke", { input: { country: "Spain" } })).status, 400);
  } finally { await t.close(); }
});

test("an order: unknown offers are refused before a price, unpaid gets the offer's price, paid gets the eSIM once", async () => {
  const t = await serve();
  try {
    assert.equal((await t.call("/order", { offer_id: "NOPE" })).status, 400);
    const unpaid = await t.call("/order", { offer_id: "ES_5_30" });
    assert.equal(unpaid.status, 402);
    assert.equal((await unpaid.json()).price, "$5.40");
    const res = await t.call("/order", { offer_id: "ES_5_30" }, { "payment-signature": paymentHeader("11") });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const got = (await res.json()).result;
    assert.equal(got.activation_code, PROFILE.ac);
    assert.equal(got.offer.offer_id, "ES_5_30");
    assert.ok(!("_wholesale_units" in got.offer));
    const again = (await (await t.call("/order", { offer_id: "ES_5_30" }, { "payment-signature": paymentHeader("11") })).json()).result;
    assert.equal(again.esim_tran_no, got.esim_tran_no);
    assert.equal(t.supplier.calls.order, 1, "the same payment ordered once");
    // The same payment naming another offer finds the same order: one payment, one profile.
    const other = (await (await t.call("/order", { offer_id: "SI_5_30" }, { "payment-signature": paymentHeader("11") })).json()).result;
    assert.equal(other.esim_tran_no, got.esim_tran_no);
    assert.ok(!(await readFile(t.storePath, "utf8")).includes("LPA:"), "no activation code on disk");
    const st = await t.call("/status/invoke", { input: { esim_tran_no: got.esim_tran_no, status_token: got.status_token } });
    assert.equal(st.status, 200);
    assert.equal((await st.json()).result.state, "GOT_RESOURCE");
    assert.equal((await t.call("/status/invoke", { input: { esim_tran_no: got.esim_tran_no, status_token: "x" } })).status, 404);
  } finally { await t.close(); }
});

test("a refused order is not charged, a node without a wallet takes no orders, a failed settlement cancels the profile", async () => {
  const refused = await serve({ supplier: fakeSupplier({ refuse: "200005" }) });
  try {
    const res = await refused.call("/order", { offer_id: "ES_5_30" }, { "payment-signature": paymentHeader() });
    assert.equal(res.status, 409);   // >= 400: the paywall does not settle
    assert.match((await res.json()).message, /not charged/);
  } finally { await refused.close(); }
  const unpaid = await serve({ paid: false });
  try {
    assert.equal((await unpaid.call("/order", { offer_id: "ES_5_30" })).status, 503);
  } finally { await unpaid.close(); }
  const t = await serve();
  try {
    await t.call("/order", { offer_id: "ES_5_30" }, { "payment-signature": paymentHeader("22") });
    const payload = JSON.parse(Buffer.from(paymentHeader("22"), "base64").toString());
    assert.equal(await t.node.settleFailed(payload), true);
    assert.equal(t.supplier.calls.cancel, 1);
    assert.equal((await fileStore(t.storePath, fs).get(transactionIdFor(paymentRefOf(payload)))).released, true);
    assert.equal(await t.node.settleFailed({}), false);
  } finally { await t.close(); }
});

test("a catalogue that cannot be read is a 503, never an empty list of offers", async () => {
  const t = await serve({ supplier: fakeSupplier({ failCatalogue: true }) });
  try {
    assert.equal((await t.call("/quote", { country: "FR" })).status, 503);
    assert.equal((await t.call("/order", { offer_id: "ES_5_30" })).status, 503);
    assert.equal((await (await t.call("/healthz")).json()).ok, false);
  } finally { await t.close(); }
});


test("demo mode quotes live prices and sells nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esim-demo-"));
  const node = createNode({ supplier: fakeSupplier(), store: fileStore(join(dir, "o.json"), fs), secret: SECRET, signer: ed25519Signer(),
                            publicUrl: "https://demo.example", demo: true, paywall: { middleware: (_q, _r, n) => n() }, log: { warn() {}, error() {} } });
  const server = await new Promise((r) => { const s = node.app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, h = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
  try {
    const q = await (await post("/quote", { country: "ES" })).json();
    assert.equal(q.result.seller.demo, true);
    assert.ok(q.result.offers.length > 0);
    const o = await post("/order", { offer_id: "ES_5_30" }, { "payment-signature": paymentHeader() });
    assert.equal(o.status, 403);
    assert.equal((await o.json()).error, "demo_mode");
    const h = await (await fetch(base + "/healthz")).json();
    assert.equal(h.demo, true);
    assert.equal(h.paid_orders, false);
  } finally { await new Promise((r) => server.close(r)); }
});
