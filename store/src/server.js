// The storefront: node src/server.js — configured by environment, secrets read from files.
//
//   SUPPLIER=esimaccess        ESIMACCESS_ACCESS_CODE_FILE, ESIMACCESS_SECRET_KEY_FILE (the default)
//   SUPPLIER=http              SUPPLIER_URL, SUPPLIER_SECRET_FILE: the operator's own system (rails/spec/supplier-http.md)
//   WEBHOOK_URL, WEBHOOK_SECRET_FILE   order events for the operator's own systems (CRM, billing)
//   STATUS_SECRET_FILE   key of the eSIM status tokens (made on first start if missing)
//   DATA_DIR             orders.json, the wholesale order records, and catalog-snapshot.json: the last
//                        catalogue, served when the supplier does not answer (six hours when selling,
//                        for as long as needed in demo mode)
//   PUBLIC_URL           the store's own origin, e.g. https://esim.example
//   STORE_NAME, STORE_CONTACT, STORE_TERMS_URL, STORE_PRIVACY_URL, HOST, PORT
//   MARGIN_PCT, MIN_MARGIN_USD, PRICES_FILE   the margin, and your own price list over it (rails/src/prices.js)
//   DEMO_MODE=1          a demo for integrators: live prices, a banner, payments off, the kit's guides at /kit
//                        (KIT_URL: where the banner links, the kit's landing; KIT_ORIGIN: the host the /kit
//                        guides are published on, when another host proxies them)
//   Payments, each on when configured:
//     USDC on Base   PAY_TO_EVM + CDP_KEY_FILE
//     TON            PAY_TO_TON (+ TONAPI_KEY_FILE for a higher rate limit)
//     Tron USDT      PAY_TO_TRON (+ TRONGRID_KEY_FILE)
//     Solana USDC    PAY_TO_SOLANA (+ SOLANA_RPC)
//     EVM USDC/USDT  PAY_TO_EVM (+ EVM_CHAINS=1,42161,10,137,56,43114 to choose, EVM_RPC_<chainId> to use your own RPC)
//     Cards          STRIPE_SECRET_KEY_FILE + STRIPE_WEBHOOK_SECRET_FILE  (webhook: <PUBLIC_URL>/api/stripe/webhook)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import { pricingFromEnv, supplierFromEnv, webhooksFromEnv } from "../../rails/src/config.js";
import { createBaseReconciler, startReconciliation } from "../../rails/src/reconcile.js";
import { fileStore } from "../../rails/src/order.js";
import { createApp, DEMO_OPTIONS } from "./app.js";
import { createCatalog } from "./catalog.js";
import { snapshotCatalog } from "../../rails/src/snapshot.js";
import { loadKit } from "./kit.js";
import { createOrders, jsonDb } from "./orders.js";
import { cdpFacilitator, usdcBase } from "./payments/usdc-base.js";
import { stripeCards } from "./payments/stripe.js";
import { tonPay } from "./payments/ton.js";
import { EVM_CHAINS, evmTransfer } from "./payments/evm.js";
import { solanaUsdc } from "./payments/solana.js";
import { tronUsdt } from "./payments/tron.js";
import QRCode from "qrcode";

const env = process.env;
const DATA = env.DATA_DIR || "/data";
const secretFile = (f) => (f && existsSync(f) ? readFileSync(f, "utf8").trim() : "");
const statusFile = env.STATUS_SECRET_FILE || join(DATA, "status_secret");
if (!existsSync(statusFile)) writeFileSync(statusFile, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
const origin = (env.PUBLIC_URL || "http://127.0.0.1:9495").replace(/\/+$/, "");

// Demo mode: live catalogue and prices, a banner on every page, and no payment of any kind.
const demo = env.DEMO_MODE === "1";
const supplier = snapshotCatalog(supplierFromEnv(env), { file: join(DATA, "catalog-snapshot.json"), fs: fsp,
                                                         ...(demo ? { maxAgeMs: Infinity } : {}) });
const events = webhooksFromEnv(env);
const catalog = createCatalog({ supplier, pricing: pricingFromEnv(env) });
const facilitator = !demo && env.PAY_TO_EVM && env.CDP_KEY_FILE
  ? await cdpFacilitator({ cdpKeyFile: env.CDP_KEY_FILE, payTo: env.PAY_TO_EVM, readFile: fsp.readFile })
      .catch((err) => { console.error(`USDC on Base off: ${err.message}`); return null; })
  : null;
const evmChains = (env.EVM_CHAINS || Object.keys(EVM_CHAINS).join(",")).split(",").map(Number).filter((c) => EVM_CHAINS[c]);
const rpcOverrides = Object.fromEntries(Object.keys(EVM_CHAINS).filter((c) => env[`EVM_RPC_${c}`]).map((c) => [c, env[`EVM_RPC_${c}`]]));
const reconciler = createBaseReconciler({ rpcUrl: env.BASE_RPC || env.EVM_RPC_8453 || undefined });
const methods = [
  usdcBase({ payTo: demo ? "" : env.PAY_TO_EVM || "", facilitator, reconciler }),
  tonPay({ address: demo ? "" : env.PAY_TO_TON || "", apiKey: secretFile(env.TONAPI_KEY_FILE) }),
  tronUsdt({ address: demo ? "" : env.PAY_TO_TRON || "", apiKey: secretFile(env.TRONGRID_KEY_FILE) }),
  solanaUsdc({ address: demo ? "" : env.PAY_TO_SOLANA || "", rpc: env.SOLANA_RPC || undefined, storeName: env.STORE_NAME || "eSIM" }),
  evmTransfer({ payTo: demo ? "" : env.PAY_TO_EVM || "", chains: evmChains, rpcOverrides }),
  stripeCards({ secretKey: secretFile(env.STRIPE_SECRET_KEY_FILE), webhookSecret: secretFile(env.STRIPE_WEBHOOK_SECRET_FILE), publicUrl: origin }),
];
const orders = createOrders({
  db: jsonDb(join(DATA, "orders.json"), fsp), supplier, railsStore: fileStore(join(DATA, "wholesale-orders.json"), fsp),
  statusSecret: readFileSync(statusFile, "utf8").trim(), methods, offersById: (id) => catalog.byId(id), events,
  qr: (uri) => QRCode.toDataURL(uri, { margin: 1, width: 440, errorCorrectionLevel: "M" }),
});

// One fixed window per address and route: enough for a person, not for a script.
const windows = new Map();
const allow = (key) => {
  const minute = Math.floor(Date.now() / 60_000);
  const w = windows.get(key);
  if (!w || w.minute !== minute) { if (windows.size > 20_000) windows.clear(); windows.set(key, { minute, n: 1 }); return true; }
  return ++w.n <= 20;
};

// eSIM Access asks every reseller's site for terms and a privacy policy: the footer links them.
const store = { name: env.STORE_NAME || "Travel eSIM", contact: env.STORE_CONTACT || "", demo, kitUrl: env.KIT_URL || "",
                termsUrl: env.STORE_TERMS_URL || "", privacyUrl: env.STORE_PRIVACY_URL || "" };
// The demo serves the kit's guides at /kit; a store that sells does not.
const kit = demo ? loadKit() : null;
const app = createApp({ store, origin, catalog, orders, methods, allow, demoOptions: DEMO_OPTIONS, kit,
                       kitOrigin: (env.KIT_ORIGIN || origin).replace(/\/+$/, "") });
await catalog.load().catch((err) => console.error(`catalogue not loaded yet: ${err.code || err.message}`));
// Pushed payments (TON) are looked for every 20 s; tonapi's free tier allows about one call a second.
let watching = false;
setInterval(async () => {
  if (watching) return;
  watching = true;
  try { await orders.watch(); } catch (err) { console.error(`watch: ${err.message}`); } finally { watching = false; }
}, 20_000).unref();
const reconciliationWorker = startReconciliation(() => orders.reconcile());
const port = Number(env.PORT || 9495);
app.listen(port, env.HOST || "127.0.0.1", () => console.log(`travel-esim on ${port} (${origin}); payments: ${
  demo ? "off (demo mode)" : methods.filter((m) => m.enabled()).map((m) => m.id).join(", ") || "none"}`));
