// The supplier and the webhooks from the environment, the same way for the storefront and the node.
//
//   SUPPLIER=esimaccess (default)  ESIMACCESS_ACCESS_CODE_FILE, ESIMACCESS_SECRET_KEY_FILE
//   SUPPLIER=http                  SUPPLIER_URL, SUPPLIER_SECRET_FILE — your own system (spec/supplier-http.md)
//   SUPPLIER=airalo                AIRALO_CLIENT_ID_FILE, AIRALO_CLIENT_SECRET_FILE[, AIRALO_BASE_URL]
//   SUPPLIER=esimgo                ESIMGO_API_KEY_FILE[, ESIMGO_BASE_URL]
//   WEBHOOK_URL, WEBHOOK_SECRET_FILE  events for your CRM, billing, accounting (webhooks.js); off when unset
//   MARGIN_PCT, MIN_MARGIN_USD        your price = cost × (1 + MARGIN_PCT/100), at least cost + MIN_MARGIN_USD
//                                     (100 and 1.00 when unset)
//   PRICES_FILE                       your own price list, CSV or JSON, over the formula (prices.js)
import { existsSync, readFileSync } from "node:fs";
import { createClient, keysFromFiles } from "./esimaccess.js";
import { httpSupplier } from "./http-supplier.js";
import { DEFAULT_PRICING } from "./offers.js";
import { parsePriceList } from "./prices.js";
import { esimAccessSupplier } from "./supplier.js";
import { airaloSupplier, esimGoSupplier } from "./suppliers-more.js";
import { createWebhooks } from "./webhooks.js";

const fileValue = (f) => (f && existsSync(f) ? readFileSync(f, "utf8").trim() : "");

export function supplierFromEnv(env = process.env) {
  const kind = (env.SUPPLIER || "esimaccess").toLowerCase();
  if (kind === "http") return httpSupplier({ url: env.SUPPLIER_URL, secret: fileValue(env.SUPPLIER_SECRET_FILE) });
  if (kind === "airalo") {
    return airaloSupplier({ clientId: fileValue(env.AIRALO_CLIENT_ID_FILE), clientSecret: fileValue(env.AIRALO_CLIENT_SECRET_FILE),
                            ...(env.AIRALO_BASE_URL ? { base: env.AIRALO_BASE_URL } : {}) });
  }
  if (kind === "esimgo") return esimGoSupplier({ apiKey: fileValue(env.ESIMGO_API_KEY_FILE), ...(env.ESIMGO_BASE_URL ? { base: env.ESIMGO_BASE_URL } : {}) });
  if (kind !== "esimaccess") throw new Error(`SUPPLIER must be esimaccess, airalo, esimgo or http, not ${kind}`);
  return esimAccessSupplier(createClient(keysFromFiles({ accessCodeFile: env.ESIMACCESS_ACCESS_CODE_FILE, secretKeyFile: env.ESIMACCESS_SECRET_KEY_FILE })));
}

export function webhooksFromEnv(env = process.env, log = console) {
  return createWebhooks({ url: env.WEBHOOK_URL || "", secret: fileValue(env.WEBHOOK_SECRET_FILE), log });
}

const envNumber = (env, name, fallback) => {
  const v = String(env[name] ?? "").trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number of 0 or more, not "${v}"`);
  return n;
};

/**
 * The prices from the environment, the same for the storefront and the node: the margin, and the
 * price list when PRICES_FILE names one. A list that is missing or does not read stops the start —
 * selling at prices the operator did not mean is worse than not starting.
 */
export function pricingFromEnv(env = process.env, { readFile = (f) => readFileSync(f, "utf8"), exists = existsSync } = {}) {
  const pricing = {
    marginPct: envNumber(env, "MARGIN_PCT", DEFAULT_PRICING.marginPct),
    minMarginUsd: envNumber(env, "MIN_MARGIN_USD", DEFAULT_PRICING.minMarginUsd),
  };
  const file = String(env.PRICES_FILE || "").trim();
  if (!file) return pricing;
  if (!exists(file)) throw new Error(`PRICES_FILE=${file} does not exist`);
  return { ...pricing, rules: parsePriceList(readFile(file), file), file };
}
