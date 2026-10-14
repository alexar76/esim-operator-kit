// The seller node: one wholesale account behind three routes.
//
//   POST /quote/invoke   esim.quote@v1   free   the hub's provider contract, signed answer
//   POST /status/invoke  esim.status@v1  free   the same, for the holder of a status token
//   POST /order          esim.order@v1   x402   the offer's own price, USDC on Base, paid to the seller
//
// Free routes answer as every hub provider does — {success, result} with an Ed25519
// X-Provider-Signature over the request-bound canonical the hub verifies. The order is paid on the
// seller's own x402 route: each offer has its own price, and the payment goes straight to the
// seller's wallet. The paywall settles only after the handler answered below 400, and only then
// releases the buffered answer; a refused or still-allocating order is never charged, and an order
// whose settlement fails has its profile cancelled (onSettleFailure → release).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import express from "express";
import { SupplierError } from "./esimaccess.js";
import { offersFromEsimAccess, quote } from "./offers.js";
import { fulfil, release, status, transactionIdFor } from "./order.js";

export const CAPABILITIES = { quote: "esim.quote@v1", order: "esim.order@v1", status: "esim.status@v1" };

/** JSON as Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) writes it. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The bytes a hub checks a provider's answer against (aimarket_hub.supply_security._bound_response_canonical). */
export function boundCanonical(capabilityId, productId, input, result) {
  const inputSha = createHash("sha256").update(canonicalJson(input || {}), "utf8").digest("hex");
  return canonicalJson({ capability_id: capabilityId || "", product_id: productId || "", input_sha256: inputSha, result });
}

export function ed25519Signer(pem) {
  const key = pem ? createPrivateKey(pem) : generateKeyPairSync("ed25519").privateKey;
  const raw = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
  return {
    pubkey: raw.toString("base64"),
    sign: (text) => edSign(null, Buffer.from(text, "utf8"), key).toString("base64"),
  };
}

/** What makes one payment one order: the payer and the authorization's nonce, from the x402 payload. */
export function paymentRefOf(payload) {
  const auth = payload?.payload?.authorization ?? payload?.payload ?? {};
  const from = String(auth.from || "").toLowerCase();
  const nonce = String(auth.nonce || "").toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(from) && /^0x[0-9a-f]{64}$/.test(nonce) ? `${from}:${nonce}` : "";
}

export function paymentRefOfHeader(header) {
  try { return paymentRefOf(JSON.parse(Buffer.from(String(header), "base64").toString("utf8"))); } catch { return ""; }
}

export function createNode({
  supplier, store, secret, signer, publicUrl, paywall = null,
  pricing = {}, productId = "esim-rails", sellerName = "eSIM seller", catalogTtlMs = 15 * 60_000,
  now = () => Date.now(), orderWaitMs = 45_000, log = console, demo = false,
}) {
  if (!secret || String(secret).length < 16) throw new Error("the node needs a status secret of 16+ characters");
  const origin = String(publicUrl || "").replace(/\/+$/, "");
  let catalog = { at: 0, offers: [], byId: new Map() };
  let loading = null;

  async function offers() {
    if (now() - catalog.at < catalogTtlMs && catalog.offers.length) return catalog;
    loading ??= (async () => {
      try {
        const list = offersFromEsimAccess(await supplier.packages(), pricing);
        catalog = { at: now(), offers: list, byId: new Map(list.map((o) => [o.offer_id, o])) };
      } catch (err) {
        // A stale catalogue answers for up to six hours; past that, an empty one says so.
        if (!catalog.offers.length || now() - catalog.at > 6 * 3_600_000) throw err;
        log.warn?.(`catalogue refresh failed (${err.code || err.message}); serving the one from ${new Date(catalog.at).toISOString()}`);
      } finally { loading = null; }
      return catalog;
    })();
    return loading;
  }

  const signed = (res, capabilityId, input, result) =>
    res.set("X-Provider-Signature", signer.sign(boundCanonical(capabilityId, productId, input, result)))
      .json({ success: true, result });
  const refuse = (res, status, error, message) => res.status(status).json({ success: false, error, message });
  const inputOf = (req) => {
    const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    return b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input : b;
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, uniquelocal");
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", async (_req, res) => {
    let count = null;
    try { count = (await offers()).offers.length; } catch { count = null; }
    res.json({ ok: count !== null, offers: count, provider_pubkey: signer.pubkey, paid_orders: Boolean(paywall) && !demo, demo,
               capabilities: Object.values(CAPABILITIES) });
  });

  /** The hub listings for the two free capabilities, and where the paid one is bought. */
  app.get("/listing.json", (_req, res) => {
    const common = { product_id: productId, publisher_id: productId, provider_pubkey: signer.pubkey, version: "v1",
                     price_per_call_usd: 0, p50_latency_ms: 400 };
    res.json({
      listings: [
        { ...common, capability_id: CAPABILITIES.quote, name: `${sellerName} — travel data eSIM offers`,
          invoke_url: `${origin}/quote/invoke`,
          description: "Travel data eSIM plans that cover a country, cheapest first: data, days, networks, price in USDC. Each offer is bought at this seller's /order over x402.",
          input_schema: { type: "object", required: ["country"], properties: {
            country: { type: "string", description: "ISO 3166-1 alpha-2, e.g. FR" },
            min_gb: { type: "number" }, min_days: { type: "integer" }, max_usd: { type: "number" },
            limit: { type: "integer", minimum: 1, maximum: 50 } } } },
        { ...common, capability_id: CAPABILITIES.status, name: `${sellerName} — eSIM status`,
          invoke_url: `${origin}/status/invoke`,
          description: "State, data used and expiry of an eSIM bought from this seller, for the holder of its status token.",
          input_schema: { type: "object", required: ["esim_tran_no", "status_token"], properties: {
            esim_tran_no: { type: "string" }, status_token: { type: "string" } } } },
      ],
      order: { capability_id: CAPABILITIES.order, url: `${origin}/order`, method: "POST", body: { offer_id: "<from esim.quote>" },
               payment: "x402 exact, USDC on Base, the offer's price, paid to this seller" },
    });
  });

  async function quoteRoute(req, res) {
    const input = inputOf(req);
    let cat;
    try { cat = await offers(); } catch { return refuse(res, 503, "catalogue_unavailable", "the wholesale catalogue cannot be read right now"); }
    let list;
    try { list = quote(cat.offers, input); } catch (err) { return refuse(res, 400, "bad_input", err.message); }
    return signed(res, req.body?.capability_id || CAPABILITIES.quote, input, {
      seller: { name: sellerName, product_id: productId, ...(demo ? { demo: true } : {}) },
      offers: list,
      order: { url: `${origin}/order`, method: "POST", payment: "x402, USDC on Base" },
      catalogue_at: new Date(cat.at).toISOString(),
    });
  }
  app.post(["/quote", "/quote/invoke"], quoteRoute);

  async function statusRoute(req, res) {
    const input = inputOf(req);
    try {
      const st = await status({ client: supplier, secret, esimTranNo: input.esim_tran_no, token: input.status_token });
      return signed(res, req.body?.capability_id || CAPABILITIES.status, input, st);
    } catch (err) {
      if (err.code === "not_found") return refuse(res, 404, "not_found", err.message);
      return refuse(res, 502, "supplier_error", "the wholesaler did not answer; try again");
    }
  }
  app.post(["/status", "/status/invoke"], statusRoute);

  // The order: an unknown offer is a 400 before any price is asked; then the paywall; then the order.
  app.post("/order", async (req, res, next) => {
    const id = String(inputOf(req).offer_id || "");
    let cat;
    try { cat = await offers(); } catch { return refuse(res, 503, "catalogue_unavailable", "the wholesale catalogue cannot be read right now"); }
    const offer = cat.byId.get(id);
    if (!offer) return refuse(res, 400, "unknown_offer", "send offer_id from esim.quote");
    if (demo) return refuse(res, 403, "demo_mode", "demo mode: this node quotes live prices and sells nothing; run your own node to sell");
    if (!paywall) return refuse(res, 503, "payments_off", "this node does not take payments yet");
    req.offer = offer;
    return next();
  });
  if (paywall) app.use(paywall.middleware);
  app.post("/order", async (req, res) => {
    const paymentRef = paymentRefOfHeader(req.get("payment-signature") || req.get("x-payment") || "");
    if (!paymentRef) return refuse(res, 400, "no_payment_reference", "the payment carries no payer and nonce");
    try {
      const { delivery } = await fulfil({ client: supplier, store, secret, offer: req.offer, paymentRef, maxWaitMs: orderWaitMs });
      const { _wholesale_units: _w, ...offer } = req.offer;
      return res.set("Cache-Control", "no-store").json({ success: true, result: { ...delivery, offer } });
    } catch (err) {
      if (err.code === "allocation_pending") {
        return res.status(503).set("Retry-After", "20").json({ success: false, error: "allocation_pending", message: err.message });
      }
      if (err instanceof SupplierError) {
        // 2000xx: the plan, its price or the order was refused — the buyer is not charged.
        return refuse(res, err.retryable ? 503 : 409, `supplier_${err.code}`, "the wholesaler refused this order; you were not charged");
      }
      log.error?.(`order failed: ${err.message}`);
      return refuse(res, 500, "internal_error", "the order failed; you were not charged");
    }
  });

  /** For the paywall's onSettleFailure: the profile of an order that was delivered but not paid is cancelled. */
  async function settleFailed(paymentPayload) {
    const ref = paymentRefOf(paymentPayload);
    return ref ? release({ client: supplier, store, transactionId: transactionIdFor(ref) }) : false;
  }

  app.use((_req, res) => refuse(res, 404, "not_found", "see /listing.json"));
  return { app, offers, settleFailed, priceOf: (id) => catalog.byId.get(String(id))?.price.usd ?? null };
}
