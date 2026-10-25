import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Address } from "@ton/core";
import { fileStore } from "../../rails/src/order.js";
import { createApp, DEMO_OPTIONS } from "../src/app.js";
import { createCatalog } from "../src/catalog.js";
import { LANGS, STRINGS } from "../src/i18n.js";
import { KIT_PAGES, loadKit } from "../src/kit.js";
import { createOrders, jsonDb } from "../src/orders.js";
import { usdcBase } from "../src/payments/usdc-base.js";
import { tonPay } from "../src/payments/ton.js";
import { stripeCards } from "../src/payments/stripe.js";

const rails = (n) => JSON.parse(readFileSync(new URL(`../../rails/test/fixtures/${n}`, import.meta.url), "utf8"));
const PACKAGES = rails("package-list.json").obj.packageList;
const PROFILE = rails("esim-query.json").obj.esimList[0];

function shape(v, p = "", out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => shape(x, `${p}[${i}]`, out));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => shape(v[k], `${p}.${k}`, out));
  else out.push(p);
  return out;
}

test("every language has the English keys, none empty", () => {
  const ref = shape(STRINGS.en).sort();
  for (const l of LANGS) {
    assert.deepEqual(shape(STRINGS[l]).sort(), ref, l);
    for (const p of shape(STRINGS[l])) {
      const v = p.split(/\.|\[|\]/).filter(Boolean).reduce((o, k) => o[k], STRINGS[l]);
      assert.ok(typeof v === "string" && v.trim(), `${l}${p}`);
    }
  }
});

async function serve({ stripe = false, stripeFetch = null, demo = false, kit = null, kitOrigin } = {}) {
  const orders = new Map();
  const supplier = {
    packages: async () => PACKAGES,
    balance: async () => ({ units: 10_000_000 }),
    order: async ({ transactionId }) => { if (!orders.has(transactionId)) orders.set(transactionId, { orderNo: `B${orders.size + 1}` }); return orders.get(transactionId); },
    profiles: async ({ orderNo, esimTranNo }) => {
      const o = [...orders.values()].find((x) => x.orderNo === orderNo || x.tran === esimTranNo);
      if (!o) return [];
      o.tran ||= `2${o.orderNo.slice(1).padStart(13, "0")}`;
      return [{ ...PROFILE, orderNo: o.orderNo, esimTranNo: o.tran }];
    },
    cancel: async () => true,
  };
  const dir = await mkdtemp(join(tmpdir(), "travel-esim-http-"));
  const catalog = createCatalog({ supplier, pricing: { marginPct: 20, minMarginUsd: 0.3 } });   // amount_total 540 below: $4.50 + 20 %
  const methods = [
    usdcBase({ payTo: "0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a",
               facilitator: { verify: async () => ({ isValid: true }), settle: async () => ({ success: true, transaction: "0xtx" }) } }),
    tonPay({ address: new Address(0, Buffer.alloc(32, 7)).toString({ bounceable: false }),
             fetchImpl: async () => new Response(JSON.stringify({ rates: { TON: { prices: { USD: 2 } } } })) }),
    stripeCards(stripe ? { secretKey: "sk_test", webhookSecret: "whsec_t",
      fetchImpl: stripeFetch || (async () => new Response(JSON.stringify({ id: "cs", url: "https://checkout.stripe.com/c/cs" }))) } : {}),
  ];
  const store = createOrders({ db: jsonDb(join(dir, "o.json"), fs), supplier, railsStore: fileStore(join(dir, "r.json"), fs),
                               statusSecret: "http-status-secret-0123456789", methods, offersById: (id) => catalog.byId(id) });
  const app = createApp({ store: { name: "Test Store", demo, kitUrl: demo ? "https://kit.example/" : "" }, origin: "https://shop.example", catalog, orders: store, methods,
                         demoOptions: DEMO_OPTIONS, kit, ...(kitOrigin ? { kitOrigin } : {}) });
  await catalog.load();
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) => fetch(base + path, { redirect: "manual", ...init });
  const post = (path, body, headers = {}) => call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { call, post, dir, close: () => new Promise((r) => server.close(r)) };
}

test("pages: five languages, country pages, search, 404s, CSP, sitemap and robots", async () => {
  const s = await serve();
  try {
    for (const l of LANGS) {
      const pre = l === "en" ? "/" : `/${l}/`;
      for (const path of [pre, `${pre}c/es`]) {
        const res = await s.call(path);
        assert.equal(res.status, 200, path);
        assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
        const html = await res.text();
        assert.ok(html.includes(`<link rel="canonical" href="https://shop.example${path}">`), path);
        assert.equal(html.match(/<script/g).length, html.match(/<\/script>/g).length, path);
      }
    }
    const es = await (await s.call("/ru/c/es")).text();
    assert.ok(es.includes("Испания"), "the country's name in the page's language");
    assert.ok(es.includes('data-name="Испания · 5 ГБ · 30 дн."'));
    assert.equal((await s.call("/?q=spain")).headers.get("location"), "/c/es");
    assert.equal((await s.call("/ru/?q=" + encodeURIComponent("Испания"))).headers.get("location"), "/ru/c/es");
    assert.equal((await s.call("/c/zz")).status, 404);
    assert.equal((await s.call("/ru")).status, 301);
    const order = await s.call("/o/AAAAAAAAAAAAAAAA");
    assert.match(await order.text(), /noindex/);
    const sm = await (await s.call("/sitemap.xml")).text();
    assert.ok(sm.includes("https://shop.example/zh/c/es") && sm.includes('hreflang="ru"'));
    assert.match(await (await s.call("/robots.txt")).text(), /Disallow: \/o\//);
    const mf = await (await s.call("/tonconnect-manifest.json")).json();
    assert.deepEqual(Object.keys(mf).sort(), ["iconUrl", "name", "url"]);
    assert.equal((await s.call("/assets/tonconnect-ui.min.js")).status, 200);
    assert.equal((await s.call("/assets/icon-180.png")).headers.get("content-type"), "image/png");
  } finally { await s.close(); }
});

test("the order API: create, read only with the token, pay by signature, get the eSIM", async () => {
  const s = await serve();
  try {
    assert.equal((await s.post("/api/orders", { offer_id: "ES_5_30", method: "nope" })).status, 400);
    assert.equal((await s.post("/api/orders", { offer_id: "NOPE", method: "usdc-base" })).status, 400);
    const created = await s.post("/api/orders", { offer_id: "ES_5_30", method: "usdc-base" });
    assert.equal(created.status, 201);
    const { order, token } = await created.json();
    assert.equal((await s.call(`/api/orders/${order.id}`)).status, 404);
    assert.equal((await s.call(`/api/orders/${order.id}`, { headers: { "x-order-token": "wrong" } })).status, 404);
    const m = order.intent.typed_data.message;
    const paid = await s.post(`/api/orders/${order.id}/authorize`, {
      authorization: { from: "0x" + "ab".repeat(20), to: m.to, value: m.value, validAfter: "0", validBefore: m.validBefore, nonce: m.nonce },
      signature: "0x" + "11".repeat(65) }, { "x-order-token": token });
    assert.equal(paid.status, 200);
    const view = await (await s.call(`/api/orders/${order.id}`, { headers: { "x-order-token": token } })).json();
    assert.equal(view.status, "delivered");
    assert.equal(view.esim.activation_code, PROFILE.ac);
    const ton = await (await s.post("/api/orders", { offer_id: "ES_5_30", method: "ton-ton" })).json();
    assert.equal(ton.order.intent.asset, "TON");
    assert.equal((await s.post("/api/orders", { offer_id: "ES_5_30", method: "stripe" })).status, 400, "cards off without keys");
  } finally { await s.close(); }
});

test("Stripe's webhook reads the raw body and refuses a bad signature", async () => {
  const s = await serve({ stripe: true });
  try {
    const { order, token } = await (await s.post("/api/orders", { offer_id: "ES_5_30", method: "stripe" })).json();
    assert.equal((await (await s.post(`/api/orders/${order.id}/checkout`, { lang: "ru" }, { "x-order-token": token })).json()).redirect,
                 "https://checkout.stripe.com/c/cs");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs", mode: "payment", currency: "usd", payment_status: "paid", client_reference_id: order.id, payment_intent: "pi_9", amount_total: 540 } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", "whsec_t").update(`${t}.${body}`).digest("hex")}`;
    assert.equal((await s.call("/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body })).status, 400);
    assert.equal((await s.call("/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body })).status, 200);
    const view = await (await s.call(`/api/orders/${order.id}`, { headers: { "x-order-token": token } })).json();
    assert.equal(view.status, "delivered");
  } finally { await s.close(); }
});

test("legacy Stripe reconciliation failures return 503 so webhook delivery is retried", async () => {
  const s = await serve({ stripe: true, stripeFetch: async () => new Response("{}", { status: 503 }) });
  try {
    const { order } = await (await s.post("/api/orders", { offer_id: "ES_5_30", method: "stripe" })).json();
    const db = jsonDb(join(s.dir, "o.json"), fs);
    const old = await db.get(order.id);
    delete old.checkout_binding_required;
    await db.put(order.id, old);
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs", mode: "payment",
      currency: "usd", payment_status: "paid", client_reference_id: order.id, payment_intent: "pi_old", amount_total: 540 } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", "whsec_t").update(`${t}.${body}`).digest("hex")}`;
    const res = await s.call("/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "payment_reconciliation_pending");
    assert.equal((await db.get(order.id)).payment, undefined);
  } finally { await s.close(); }
});

test("the browser script never writes HTML", () => {
  const js = readFileSync(new URL("../public/store.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
});


test("demo mode: a banner on every page, the crypto methods on show, and every payment route says demo mode", async () => {
  const s = await serve({ demo: true });
  try {
    for (const path of ["/", "/ru/c/es", "/o/AAAAAAAAAAAAAAAA"]) {
      const html = await (await s.call(path)).text();
      assert.match(html, /class="demo-bar"/, path);
      assert.ok(html.includes('href="https://kit.example/"'), path);
    }
    const country = await (await s.call("/c/es")).text();
    for (const m of ["usdc-base", "ton-usdt", "ton-ton", "tron-usdt", "sol-usdc", "evm:1:USDT", "evm:56:USDC", "evm:43114:USDT"]) {
      assert.ok(country.includes(`value="${m}"`), m);
    }
    assert.ok(country.indexOf(">Base<") < country.indexOf(">Tron<") && country.indexOf(">Tron<") < country.indexOf(">Ethereum<"), "networks in order");
    assert.ok(!country.includes('value="evm:8453:USDC"'), "Base USDC is offered once, gasless");
    const r = await s.post("/api/orders", { offer_id: "ES_5_30", method: "usdc-base" });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, "demo_mode");
    assert.equal((await s.post("/api/orders/AAAAAAAAAAAAAAAA/authorize", {})).status, 403);
    assert.equal((await s.call("/api/stripe/webhook", { method: "POST", body: "{}" })).status, 403);
  } finally { await s.close(); }
  const live = await serve();
  try { assert.ok(!(await (await live.call("/")).text()).includes("demo-bar")); } finally { await live.close(); }
});

test("kit: the demo serves the guides in five languages; a store without them serves none", async () => {
  const s = await serve({ demo: true, kit: loadKit() });
  try {
    for (const l of LANGS) {
      const pre = l === "en" ? "/" : `/${l}/`;
      // Every page of the one list in kit.js is served: a page added there and missed by a route is a 404 here.
      for (const page of Object.keys(KIT_PAGES).map((p) => (p ? `kit/${p}` : "kit"))) {
        const res = await s.call(pre + page);
        assert.equal(res.status, 200, pre + page);
        const html = await res.text();
        assert.ok(html.includes(`<link rel="canonical" href="https://shop.example${pre}${page}">`), pre + page);
        assert.ok(html.includes(`<a href="${pre}${page}" aria-current="page">`), `${pre}${page}: its tab is current`);
        assert.ok(html.includes(`<html lang="${l === "zh" ? "zh-Hans" : l}">`));
      }
    }
    const ru = await (await s.call("/ru/kit/operator")).text();
    assert.ok(ru.includes("<title>Гайд оператора · Кит eSIM-оператора</title>"));
    assert.ok(ru.includes('<a href="/ru/kit/agents">гайд для агентов</a>'), "a link between guides stays in the language");
    assert.ok(ru.includes('<a href="https://github.com/alexar76/esim-operator-kit/blob/main/secrets/README.md">'), "other files point at the repo");
    assert.ok(ru.includes('class="demo-bar"') && ru.includes('<a href="https://kit.example/">'), "the banner leads to KIT_URL, the kit's landing");
    assert.equal((await s.call("/kit/")).status, 404);
    assert.equal((await s.call("/kit/other")).status, 404);
    const sm = await (await s.call("/sitemap.xml")).text();
    assert.ok(sm.includes("<loc>https://shop.example/zh/kit/agents</loc>"));
    assert.ok(sm.includes("<loc>https://shop.example/fr/kit/cases</loc>"));
    const cases = await (await s.call("/kit/cases")).text();
    assert.ok(cases.includes('<pre class="mermaid">') && cases.includes("/assets/mermaid.min.js"), "the cases page draws its diagrams");
    assert.ok(cases.includes("0x6dcfb7f075ad7fb6308064ac53e310dfb6adfd9b65d9f44b3c9a6dd39ca9ed4b"), "with the refund transaction");
  } finally { await s.close(); }
  const plain = await serve({ demo: true });
  try {
    assert.equal((await plain.call("/kit")).status, 404);
    assert.ok((await (await plain.call("/")).text()).includes('<a href="https://kit.example/">'), "without the guides the banner uses KIT_URL");
    assert.ok(!(await (await plain.call("/sitemap.xml")).text()).includes("/kit"));
  } finally { await plain.close(); }
});

test("kit: published on the landing's host, the guides point their canonical links there and leave the shop's sitemap", async () => {
  const s = await serve({ demo: true, kit: loadKit(), kitOrigin: "https://landing.example" });
  try {
    const html = await (await s.call("/ru/kit/integrations")).text();
    assert.ok(html.includes('<link rel="canonical" href="https://landing.example/ru/kit/integrations">'));
    assert.ok(html.includes('hreflang="zh-Hans" href="https://landing.example/zh/kit/integrations"'));
    const sm = await (await s.call("/sitemap.xml")).text();
    assert.ok(!sm.includes("/kit"), "the shop's sitemap lists the shop only");
    assert.ok(sm.includes("<loc>https://shop.example/c/es</loc>"));
  } finally { await s.close(); }
});
