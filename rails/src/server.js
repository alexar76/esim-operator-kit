// A seller node: node src/server.js — configured by environment, secrets read from files.
//
//   SUPPLIER=esimaccess        ESIMACCESS_ACCESS_CODE_FILE, ESIMACCESS_SECRET_KEY_FILE (the default)
//   SUPPLIER=http              SUPPLIER_URL, SUPPLIER_SECRET_FILE: your own system (spec/supplier-http.md)
//   WEBHOOK_URL, WEBHOOK_SECRET_FILE   events for your own systems (agent_order.delivered, …)
//   STATUS_SECRET_FILE        key of the buyers' status tokens (made on first start if missing)
//   PROVIDER_KEY_FILE         Ed25519 PEM that signs the free answers (made on first start if missing)
//   ORDER_STORE               JSON file of order records (no activation codes in it)
//   CATALOG_SNAPSHOT          the last catalogue, served when the supplier does not answer: for up to six
//                             hours when selling, for as long as needed in demo mode (/data/catalog-snapshot.json)
//   PUBLIC_URL                where buyers reach this node, e.g. https://modelmarket.dev/providers/esim
//   PAY_TO, CDP_KEY_FILE      the seller's wallet on Base and a CDP API key: without both, orders are off
//   REFUND_KEY_FILE           optional: the key of the wallet refunds of unused eSIMs are paid from, in USDC
//                             through the facilitator, no gas (refund.js); REFUND_MAX_USD, REFUND_DAILY_MAX_USD
//                             cap them (50 each). Without it a refund is recorded as due for you to pay.
//   MARGIN_PCT, MIN_MARGIN_USD, PRICES_FILE (your price list), SELLER_NAME, PRODUCT_ID, HOST, PORT
//   DEMO_MODE=1               quotes and status answer, /order says "demo mode" and sells nothing
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { pricingFromEnv, supplierFromEnv, webhooksFromEnv } from "./config.js";
import { createNode, ed25519Signer } from "./node.js";
import { fileStore } from "./order.js";
import { buildPaywall } from "./paywall.js";
import { buildRefunder } from "./refund.js";
import { snapshotCatalog } from "./snapshot.js";

const env = process.env;
const once = (file, make) => {
  if (!existsSync(file)) writeFileSync(file, make(), { mode: 0o600, flag: "wx" });
  return readFileSync(file, "utf8").trim();
};
const statusSecret = once(env.STATUS_SECRET_FILE || "/data/status_secret", () => randomBytes(32).toString("base64url"));
const providerPem = once(env.PROVIDER_KEY_FILE || "/data/provider_ed25519.pem",
  () => generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));

// Demo mode: live quotes, no orders — the reference node integrators can call before running their own.
const demo = env.DEMO_MODE === "1";
const supplier = snapshotCatalog(supplierFromEnv(env), { file: env.CATALOG_SNAPSHOT || "/data/catalog-snapshot.json", fs: fsp,
                                                         ...(demo ? { maxAgeMs: Infinity } : {}) });
const pricing = pricingFromEnv(env);
const events = webhooksFromEnv(env);
const store = fileStore(env.ORDER_STORE || "/data/orders.json", fsp);
const publicUrl = (env.PUBLIC_URL || "").replace(/\/+$/, "");
let node = null;
const paywall = demo ? null : await buildPaywall({
  cdpKeyFile: env.CDP_KEY_FILE, payTo: env.PAY_TO, publicUrl,
  priceOf: (id) => node?.priceOf(id), onSettleFailure: (p) => node.settleFailed(p),
}).catch((err) => { console.error(`payments off: ${err.message}`); return null; });
const refunder = demo || !env.REFUND_KEY_FILE ? null : await buildRefunder({
  keyFile: env.REFUND_KEY_FILE, cdpKeyFile: env.CDP_KEY_FILE, publicUrl,
  maxUsd: Number(env.REFUND_MAX_USD || 50), dailyMaxUsd: Number(env.REFUND_DAILY_MAX_USD || 50),
}).catch((err) => { console.error(`automatic refunds off: ${err.message}`); return null; });
node = createNode({
  supplier, store, secret: statusSecret, signer: ed25519Signer(providerPem), publicUrl, paywall, refunder, events,
  pricing,
  sellerName: env.SELLER_NAME || "eSIM seller", productId: env.PRODUCT_ID || "esim-rails", demo,
});
await node.offers().catch((err) => console.error(`catalogue not loaded yet: ${err.code || err.message}`));
const port = Number(env.PORT || 9490);
node.app.listen(port, env.HOST || "127.0.0.1", () =>
  console.log(`esim-rails node on ${port}; prices: ${pricing.marginPct} %, at least $${pricing.minMarginUsd}${pricing.rules ? `, ${pricing.rules.length} rules from ${pricing.file}` : ""}; orders ${demo ? "off (demo mode)" : paywall ? `paid to ${paywall.payTo}` : "off (no PAY_TO / CDP_KEY_FILE)"}`
    + `; refunds ${refunder ? `automatic from ${refunder.address}` : "by the operator"}`));
