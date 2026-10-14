// A seller node: node src/server.js — configured by environment, secrets read from files.
//
//   ESIMACCESS_ACCESS_CODE_FILE, ESIMACCESS_SECRET_KEY_FILE   the wholesale account
//   STATUS_SECRET_FILE        key of the buyers' status tokens (made on first start if missing)
//   PROVIDER_KEY_FILE         Ed25519 PEM that signs the free answers (made on first start if missing)
//   ORDER_STORE               JSON file of order records (no activation codes in it)
//   PUBLIC_URL                where buyers reach this node, e.g. https://modelmarket.dev/providers/esim
//   PAY_TO, CDP_KEY_FILE      the seller's wallet on Base and a CDP API key: without both, orders are off
//   MARGIN_PCT, MIN_MARGIN_USD, SELLER_NAME, PRODUCT_ID, HOST, PORT
//   DEMO_MODE=1               quotes and status answer, /order says "demo mode" and sells nothing
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { createClient, keysFromFiles } from "./esimaccess.js";
import { createNode, ed25519Signer } from "./node.js";
import { fileStore } from "./order.js";
import { buildPaywall } from "./paywall.js";

const env = process.env;
const once = (file, make) => {
  if (!existsSync(file)) writeFileSync(file, make(), { mode: 0o600, flag: "wx" });
  return readFileSync(file, "utf8").trim();
};
const statusSecret = once(env.STATUS_SECRET_FILE || "/data/status_secret", () => randomBytes(32).toString("base64url"));
const providerPem = once(env.PROVIDER_KEY_FILE || "/data/provider_ed25519.pem",
  () => generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));

const supplier = createClient(keysFromFiles({
  accessCodeFile: env.ESIMACCESS_ACCESS_CODE_FILE, secretKeyFile: env.ESIMACCESS_SECRET_KEY_FILE,
}));
const store = fileStore(env.ORDER_STORE || "/data/orders.json", fsp);
const publicUrl = (env.PUBLIC_URL || "").replace(/\/+$/, "");
let node = null;
// Demo mode: live quotes, no orders — the reference node integrators can call before running their own.
const demo = env.DEMO_MODE === "1";
const paywall = demo ? null : await buildPaywall({
  cdpKeyFile: env.CDP_KEY_FILE, payTo: env.PAY_TO, publicUrl,
  priceOf: (id) => node?.priceOf(id), onSettleFailure: (p) => node.settleFailed(p),
}).catch((err) => { console.error(`payments off: ${err.message}`); return null; });
node = createNode({
  supplier, store, secret: statusSecret, signer: ed25519Signer(providerPem), publicUrl, paywall,
  pricing: { marginPct: Number(env.MARGIN_PCT || 20), minMarginUsd: Number(env.MIN_MARGIN_USD || 0.3) },
  sellerName: env.SELLER_NAME || "eSIM seller", productId: env.PRODUCT_ID || "esim-rails", demo,
});
await node.offers().catch((err) => console.error(`catalogue not loaded yet: ${err.code || err.message}`));
const port = Number(env.PORT || 9490);
node.app.listen(port, env.HOST || "127.0.0.1", () =>
  console.log(`esim-rails node on ${port}; orders ${demo ? "off (demo mode)" : paywall ? `paid to ${paywall.payTo}` : "off (no PAY_TO / CDP_KEY_FILE)"}`));
